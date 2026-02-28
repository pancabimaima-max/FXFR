param(
  [ValidateSet("packaged", "dev")]
  [string]$Mode = "packaged",
  [double]$DurationHours = 24,
  [int]$SampleSeconds = 60,
  [int]$Port = 8765,
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
& (Join-Path $PSScriptRoot "doctor.ps1") -RepoRoot $repoRoot -ExpectedRoot $repoRoot

if ($DurationHours -le 0) {
  throw "DurationHours must be > 0"
}
if ($SampleSeconds -lt 5) {
  throw "SampleSeconds must be >= 5"
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $OutputDir = Join-Path $repoRoot (Join-Path "artifacts\soak\longrun" $stamp)
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$timeseriesPath = Join-Path $OutputDir "soak_timeseries.jsonl"
$summaryPath = Join-Path $OutputDir "soak_summary.json"
if (Test-Path $timeseriesPath) { Remove-Item $timeseriesPath -Force }

$desktopExe = Join-Path $repoRoot "apps\desktop\src-tauri\target\release\fxfr_desktop.exe"
$devScript = Join-Path $repoRoot "scripts\desktop\dev_fullstack.ps1"
$enginePython = Join-Path $repoRoot "services\engine\.venv\Scripts\python.exe"

if ($Mode -eq "packaged" -and -not (Test-Path $desktopExe)) {
  throw "Packaged target missing: $desktopExe"
}
if ($Mode -eq "dev") {
  if (-not (Test-Path $devScript)) {
    throw "Dev startup script missing: $devScript"
  }
  if (-not (Test-Path $enginePython)) {
    throw "Engine venv python missing: $enginePython"
  }
}

function Write-JsonLine {
  param(
    [string]$Path,
    [object]$Object
  )
  $line = $Object | ConvertTo-Json -Depth 8 -Compress
  Add-Content -Path $Path -Value $line
}

function Get-ListenerPid {
  param([int]$ListenPort)
  $conn = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $conn) {
    return $null
  }
  return [int]$conn.OwningProcess
}

function Stop-ByPort {
  param([int]$ListenPort)
  $rows = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
  if ($null -eq $rows) { return }
  $pids = @($rows | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($pidValue in $pids) {
    try {
      Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
    } catch {}
  }
}

function Stop-Stack {
  Get-Process -Name "fxfr_desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-Process -Name "fxfr-engine" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Stop-ByPort -ListenPort 5173
  Stop-ByPort -ListenPort $Port
  Start-Sleep -Milliseconds 500
}

function Get-ApiStatus {
  param([int]$ListenPort)

  $healthOk = $false
  $bootstrapOk = $false
  $token = ""
  $latencyMs = 0
  $lastError = ""

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/v1/health" -Method Get -TimeoutSec 3
    $healthOk = ($null -ne $health -and $null -ne $health.data -and $health.data.status -eq "ok")
  } catch {
    $lastError = $_.Exception.Message
  }

  try {
    $boot = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/v1/bootstrap" -Method Get -TimeoutSec 3
    $token = [string]($boot.data.session_token)
    $bootstrapOk = -not [string]::IsNullOrWhiteSpace($token)
  } catch {
    $lastError = $_.Exception.Message
  }
  $sw.Stop()
  $latencyMs = [int][Math]::Round($sw.Elapsed.TotalMilliseconds)

  return [ordered]@{
    health_ok = $healthOk
    bootstrap_ok = $bootstrapOk
    session_token = $token
    latency_ms = $latencyMs
    error = $lastError
  }
}

function Get-LogCounts {
  param(
    [int]$ListenPort,
    [string]$SessionToken
  )

  if ([string]::IsNullOrWhiteSpace($SessionToken)) {
    return $null
  }

  try {
    $headers = @{ "x-session-token" = $SessionToken }
    $uri = "http://127.0.0.1:$ListenPort/v1/logs?levels=WARN,ERROR&lookback_hours=1&limit=500&source=both"
    $resp = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 4
    $rows = @($resp.data.rows)
    $warnCount = @($rows | Where-Object {
      $lv = [string]($_.level)
      $lv -eq "WARN" -or $lv -eq "WARNING"
    }).Count
    $errorCount = @($rows | Where-Object { [string]($_.level) -eq "ERROR" }).Count
    return [ordered]@{ warn_count = $warnCount; error_count = $errorCount }
  } catch {
    return $null
  }
}

function Get-ProcessMetrics {
  param([int[]]$Pids)

  $memMb = 0.0
  $cpuSec = 0.0

  foreach ($pidValue in ($Pids | Where-Object { $_ -gt 0 } | Select-Object -Unique)) {
    try {
      $proc = Get-Process -Id $pidValue -ErrorAction Stop
      $memMb += [double]($proc.WorkingSet64 / 1MB)
      $cpuSec += [double]($proc.CPU)
    } catch {}
  }

  return [ordered]@{
    working_set_mb = [double]([Math]::Round($memMb, 2))
    cpu_seconds = [double]([Math]::Round($cpuSec, 2))
  }
}

function Start-Target {
  param([string]$Target)

  if ($Target -eq "packaged") {
    $proc = Start-Process -FilePath $desktopExe -WorkingDirectory (Split-Path $desktopExe -Parent) -PassThru
    return [ordered]@{ target = "packaged"; process = $proc }
  }

  $args = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $devScript,
    "-Port", "$Port",
    "-SkipInstall",
    "-NoUI"
  )

  $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $repoRoot -PassThru -WindowStyle Minimized
  return [ordered]@{ target = "dev"; process = $proc }
}

Stop-Stack
$started = Start-Target -Target $Mode
$durationSec = [int][Math]::Ceiling($DurationHours * 3600.0)
$endAt = (Get-Date).ToUniversalTime().AddSeconds($durationSec)

$sampleIndex = 0
$upSamples = 0
$healthFailureCount = 0
$bootstrapFailureCount = 0
$unexpectedExitCount = 0
$contiguousOutageSec = 0
$maxContiguousOutageSec = 0
$restartCount = 0
$maxMemoryMb = 0.0
$lastEnginePid = $null
$lastPrimaryPid = $null

try {
  while ((Get-Date).ToUniversalTime() -lt $endAt) {
    $sampleIndex++
    $nowUtc = (Get-Date).ToUniversalTime().ToString("o")

    $primaryPid = if ($started.process -and -not $started.process.HasExited) { [int]$started.process.Id } else { $null }
    if ($null -eq $primaryPid) {
      $unexpectedExitCount++
    }

    $enginePid = Get-ListenerPid -ListenPort $Port
    $vitePid = if ($Mode -eq "dev") { Get-ListenerPid -ListenPort 5173 } else { $null }

    if ($null -ne $lastEnginePid -and $null -ne $enginePid -and [int]$lastEnginePid -ne [int]$enginePid) {
      $restartCount++
    }
    if ($null -ne $lastPrimaryPid -and $null -ne $primaryPid -and [int]$lastPrimaryPid -ne [int]$primaryPid) {
      $restartCount++
    }
    $lastEnginePid = $enginePid
    $lastPrimaryPid = $primaryPid

    $api = Get-ApiStatus -ListenPort $Port
    if ($api.health_ok -and $api.bootstrap_ok) {
      $upSamples++
      $contiguousOutageSec = 0
    } else {
      if (-not $api.health_ok) { $healthFailureCount++ }
      if (-not $api.bootstrap_ok) { $bootstrapFailureCount++ }
      $contiguousOutageSec += $SampleSeconds
      if ($contiguousOutageSec -gt $maxContiguousOutageSec) {
        $maxContiguousOutageSec = $contiguousOutageSec
      }
    }

    $pids = @()
    if ($null -ne $enginePid) { $pids += [int]$enginePid }
    if ($null -ne $primaryPid) { $pids += [int]$primaryPid }
    if ($null -ne $vitePid) { $pids += [int]$vitePid }
    $metrics = Get-ProcessMetrics -Pids $pids
    if ([double]$metrics.working_set_mb -gt $maxMemoryMb) {
      $maxMemoryMb = [double]$metrics.working_set_mb
    }

    $logCounts = Get-LogCounts -ListenPort $Port -SessionToken ([string]$api.session_token)

    $row = [ordered]@{
      sample_index = $sampleIndex
      timestamp_utc = $nowUtc
      mode = $Mode
      health_ok = [bool]$api.health_ok
      bootstrap_ok = [bool]$api.bootstrap_ok
      latency_ms = [int]$api.latency_ms
      engine_pid = if ($null -eq $enginePid) { $null } else { [int]$enginePid }
      primary_pid = if ($null -eq $primaryPid) { $null } else { [int]$primaryPid }
      vite_pid = if ($null -eq $vitePid) { $null } else { [int]$vitePid }
      working_set_mb = [double]$metrics.working_set_mb
      cpu_seconds = [double]$metrics.cpu_seconds
      warn_count = if ($null -eq $logCounts) { $null } else { [int]$logCounts.warn_count }
      error_count = if ($null -eq $logCounts) { $null } else { [int]$logCounts.error_count }
      contiguous_outage_seconds = [int]$contiguousOutageSec
      note = if ([string]::IsNullOrWhiteSpace([string]$api.error)) { "" } else { [string]$api.error }
    }

    Write-JsonLine -Path $timeseriesPath -Object $row

    if ($unexpectedExitCount -gt 0) {
      break
    }

    Start-Sleep -Seconds $SampleSeconds
  }
}
finally {
  if ($started.process -and -not $started.process.HasExited) {
    Stop-Process -Id $started.process.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-Stack
}

$totalSamples = $sampleIndex
$uptimePercent = if ($totalSamples -gt 0) { [double]([Math]::Round(($upSamples / [double]$totalSamples) * 100.0, 2)) } else { 0.0 }
$pass = ($bootstrapFailureCount -eq 0 -and $unexpectedExitCount -eq 0 -and $maxContiguousOutageSec -le 180)

$summary = [ordered]@{
  schema_version = "1.0.0"
  generated_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  mode = $Mode
  duration_hours = [double]$DurationHours
  sample_seconds = $SampleSeconds
  total_samples = $totalSamples
  uptime_percent = $uptimePercent
  health_failures = $healthFailureCount
  bootstrap_failures = $bootstrapFailureCount
  unexpected_exit_count = $unexpectedExitCount
  max_contiguous_outage_seconds = $maxContiguousOutageSec
  restart_count = $restartCount
  max_memory_mb = [double]([Math]::Round($maxMemoryMb, 2))
  pass = $pass
  pass_rules = [ordered]@{
    bootstrap_failures_must_be_zero = ($bootstrapFailureCount -eq 0)
    unexpected_exit_must_be_zero = ($unexpectedExitCount -eq 0)
    max_contiguous_outage_seconds_must_be_lte_180 = ($maxContiguousOutageSec -le 180)
  }
  artifacts = [ordered]@{
    soak_timeseries_jsonl = $timeseriesPath
  }
}

$summary | ConvertTo-Json -Depth 10 | Set-Content -Path $summaryPath -Encoding UTF8
Write-Output "24h soak summary written: $summaryPath"

if (-not $pass) {
  throw "24h soak helper reported failure. Review $summaryPath"
}
