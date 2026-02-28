param(
  [ValidateSet("both", "packaged", "dev")]
  [string]$Mode = "both",
  [int]$Cycles = 10,
  [int]$TimeoutSec = 60,
  [int]$Port = 8765,
  [ValidateSet("stable", "beta")]
  [string]$Channel = "stable",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
& (Join-Path $PSScriptRoot "doctor.ps1") -RepoRoot $repoRoot -ExpectedRoot $repoRoot

if ($Cycles -lt 1) {
  throw "Cycles must be >= 1"
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $OutputDir = Join-Path $repoRoot (Join-Path "artifacts\soak\startup" $stamp)
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$startupJsonlPath = Join-Path $OutputDir "startup_cycles.jsonl"
$startupSummaryPath = Join-Path $OutputDir "startup_summary.json"
if (Test-Path $startupJsonlPath) { Remove-Item $startupJsonlPath -Force }

$desktopExe = Join-Path $repoRoot "apps\desktop\src-tauri\target\release\fxfr_desktop.exe"
$devScript = Join-Path $repoRoot "scripts\desktop\dev_fullstack.ps1"
$enginePython = Join-Path $repoRoot "services\engine\.venv\Scripts\python.exe"

$targets = switch ($Mode) {
  "packaged" { @("packaged") }
  "dev" { @("dev") }
  default { @("packaged", "dev") }
}

if ($targets -contains "packaged") {
  if (-not (Test-Path $desktopExe)) {
    throw "Packaged target missing: $desktopExe"
  }
}

if ($targets -contains "dev") {
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

function Get-ListenerPids {
  param([int]$ListenPort)
  $rows = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
  if ($null -eq $rows) {
    return @()
  }
  return @($rows | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-ByPort {
  param([int]$ListenPort)
  $pids = Get-ListenerPids -ListenPort $ListenPort
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

function Wait-PortsClosed {
  param(
    [int[]]$Ports,
    [int]$Retries = 20,
    [int]$DelayMs = 250
  )

  for ($i = 1; $i -le $Retries; $i++) {
    $active = @()
    foreach ($p in $Ports) {
      $listeners = @(Get-ListenerPids -ListenPort $p)
      if ($listeners.Count -gt 0) {
        $active += $p
        Stop-ByPort -ListenPort $p
      }
    }
    if ($active.Count -eq 0) {
      return $true
    }
    Start-Sleep -Milliseconds $DelayMs
  }

  return $false
}

function Wait-ApiReady {
  param(
    [int]$ListenPort,
    [int]$WaitTimeoutSec
  )

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $healthOk = $false
  $bootstrapOk = $false
  $token = ""
  $lastError = ""

  while ($sw.Elapsed.TotalSeconds -lt $WaitTimeoutSec) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/v1/health" -Method Get -TimeoutSec 2
      $healthOk = ($null -ne $health -and $null -ne $health.data -and $health.data.status -eq "ok")
    } catch {
      $healthOk = $false
      $lastError = $_.Exception.Message
    }

    try {
      $boot = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/v1/bootstrap" -Method Get -TimeoutSec 2
      $token = [string]($boot.data.session_token)
      $bootstrapOk = -not [string]::IsNullOrWhiteSpace($token)
    } catch {
      $bootstrapOk = $false
      $lastError = $_.Exception.Message
    }

    if ($healthOk -and $bootstrapOk) {
      $sw.Stop()
      return [ordered]@{
        success = $true
        health_ok = $true
        bootstrap_ok = $true
        startup_latency_ms = [int][Math]::Round($sw.Elapsed.TotalMilliseconds)
        bootstrap_token = $token
        error = ""
      }
    }

    Start-Sleep -Milliseconds 500
  }

  $sw.Stop()
  return [ordered]@{
    success = $false
    health_ok = $healthOk
    bootstrap_ok = $bootstrapOk
    startup_latency_ms = [int][Math]::Round($sw.Elapsed.TotalMilliseconds)
    bootstrap_token = $token
    error = if ([string]::IsNullOrWhiteSpace($lastError)) { "timeout waiting for health/bootstrap" } else { $lastError }
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

function Stop-Target {
  param([object]$Started)

  if ($null -ne $Started -and $null -ne $Started.process) {
    try {
      if (-not $Started.process.HasExited) {
        Stop-Process -Id $Started.process.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }

  Stop-Stack
  return (Wait-PortsClosed -Ports @(5173, $Port))
}

$records = @()

for ($cycle = 1; $cycle -le $Cycles; $cycle++) {
  foreach ($target in $targets) {
    $started = $null
    $ready = $null
    $stopClean = $false
    $errorMessage = ""
    $startedAtUtc = (Get-Date).ToUniversalTime().ToString("o")

    try {
      Stop-Stack
      $started = Start-Target -Target $target
      $ready = Wait-ApiReady -ListenPort $Port -WaitTimeoutSec $TimeoutSec
      if (-not $ready.success) {
        $errorMessage = [string]$ready.error
      }
    } catch {
      $errorMessage = $_.Exception.Message
      if ($null -eq $ready) {
        $ready = [ordered]@{
          success = $false
          health_ok = $false
          bootstrap_ok = $false
          startup_latency_ms = 0
          bootstrap_token = ""
          error = $errorMessage
        }
      }
    } finally {
      $stopClean = Stop-Target -Started $started
    }

    $success = ($ready.success -and $stopClean)
    if (-not $stopClean -and [string]::IsNullOrWhiteSpace($errorMessage)) {
      $errorMessage = "cleanup verification failed"
    }

    $row = [ordered]@{
      cycle = $cycle
      target = $target
      mode = $Mode
      channel = $Channel
      started_at_utc = $startedAtUtc
      startup_latency_ms = [int]$ready.startup_latency_ms
      health_ok = [bool]$ready.health_ok
      bootstrap_ok = [bool]$ready.bootstrap_ok
      success = [bool]$success
      stop_clean = [bool]$stopClean
      error = [string]$errorMessage
    }

    $records += [pscustomobject]$row
    Write-JsonLine -Path $startupJsonlPath -Object $row
  }
}

$latencies = @($records | Where-Object { $_.startup_latency_ms -gt 0 } | ForEach-Object { [int]$_.startup_latency_ms })
$totalRuns = $records.Count
$passedRuns = @($records | Where-Object { $_.success -eq $true }).Count
$failedRuns = $totalRuns - $passedRuns
$avgLatency = if ($latencies.Count -gt 0) { [int][Math]::Round((($latencies | Measure-Object -Average).Average)) } else { 0 }
$maxLatency = if ($latencies.Count -gt 0) { ($latencies | Measure-Object -Maximum).Maximum } else { 0 }
$minLatency = if ($latencies.Count -gt 0) { ($latencies | Measure-Object -Minimum).Minimum } else { 0 }

$summary = [ordered]@{
  schema_version = "1.0.0"
  generated_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  mode = $Mode
  channel = $Channel
  cycles = $Cycles
  targets = $targets
  timeout_sec = $TimeoutSec
  port = $Port
  total_runs = $totalRuns
  passed_runs = $passedRuns
  failed_runs = $failedRuns
  pass = ($failedRuns -eq 0)
  startup_latency_ms = [ordered]@{
    min = [int]$minLatency
    avg = [int]$avgLatency
    max = [int]$maxLatency
  }
  artifacts = [ordered]@{
    startup_cycles_jsonl = $startupJsonlPath
  }
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $startupSummaryPath -Encoding UTF8
Write-Output "Startup soak summary written: $startupSummaryPath"

if ($failedRuns -gt 0) {
  throw "Startup soak failed ($failedRuns/$totalRuns runs failed)."
}