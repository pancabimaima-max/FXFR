param(
  [int]$Port = 8765,
  [switch]$SkipInstall,
  [switch]$NoUI
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$repoRoot = $repoRoot.Path
& (Join-Path $PSScriptRoot "doctor.ps1") -RepoRoot $repoRoot

$engineDir = Join-Path $repoRoot "services\engine"
$desktopDir = Join-Path $repoRoot "apps\desktop"
$engineVenvPython = Join-Path $engineDir ".venv\Scripts\python.exe"
$engineLogOut = Join-Path $env:TEMP "fxfr_engine_fullstack.out.log"
$engineLogErr = Join-Path $env:TEMP "fxfr_engine_fullstack.err.log"
$engineProc = $null
$engineManaged = $false
$viteProc = $null

function Get-CommandLineByProcessId([int]$ProcessId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
  } catch {
    return ""
  }
}

function Get-ListenerPid([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $conn) {
    return $null
  }
  return [int]$conn.OwningProcess
}

if (-not (Test-Path $engineVenvPython)) {
  throw "Engine venv not found at $engineVenvPython. Run scripts\\desktop\\dev_engine.ps1 once first."
}

if (Test-Path $engineLogOut) { Remove-Item $engineLogOut -Force -ErrorAction SilentlyContinue }
if (Test-Path $engineLogErr) { Remove-Item $engineLogErr -Force -ErrorAction SilentlyContinue }

$vitePid = Get-ListenerPid -Port 5173
if ($null -ne $vitePid) {
  $viteCmd = Get-CommandLineByProcessId -ProcessId $vitePid
  if ($viteCmd -like "*fxfr_desktop*" -or $viteCmd -like "*vite*") {
    Write-Output "Port 5173 in use by stale dev process (PID $vitePid). Stopping it."
    Stop-Process -Id $vitePid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
  } else {
    throw "Port 5173 is occupied by PID $vitePid. Free the port before running dev:fullstack."
  }
}

# Stable sidecar mode: no --reload to avoid transient bootstrap races.
$enginePid = Get-ListenerPid -Port $Port
if ($null -ne $enginePid) {
  try {
    $probe = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/health" -Method Get -TimeoutSec 2
    if ($probe.data.status -eq "ok") {
      Write-Output "Using existing healthy engine on port $Port (PID $enginePid)."
    } else {
      throw "Port $Port is occupied by PID $enginePid but health check did not return ok."
    }
  } catch {
    throw "Port $Port is occupied by PID $enginePid and is not a healthy engine instance."
  }
} else {
  $engineArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$Port")
  $engineProc = Start-Process -FilePath $engineVenvPython -ArgumentList $engineArgs -WorkingDirectory $engineDir -WindowStyle Minimized -RedirectStandardOutput $engineLogOut -RedirectStandardError $engineLogErr -PassThru
  $engineManaged = $true
  Write-Output "Started engine sidecar (PID $($engineProc.Id)). Logs: $engineLogOut / $engineLogErr"
}

try {
  $healthUrl = "http://127.0.0.1:$Port/v1/health"
  $ready = $false
  $attemptCount = 60
  Write-Output "Waiting for engine health at $healthUrl (max attempts: $attemptCount)..."

  foreach ($i in 1..$attemptCount) {
    try {
      $resp = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
      if ($resp.data.status -eq "ok") {
        Write-Output "Engine became healthy after attempt $i."
        $ready = $true
        break
      }
    } catch {
      if ($i % 10 -eq 0) {
        Write-Output "Engine health still pending at attempt $i."
      }
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $ready -and $engineManaged) {
    if (Test-Path $engineLogOut) { Get-Content $engineLogOut -Tail 60 | Write-Output }
    if (Test-Path $engineLogErr) { Get-Content $engineLogErr -Tail 60 | Write-Output }
    throw "Engine did not become healthy at $healthUrl"
  }

  if (-not $ready -and -not $engineManaged) {
    throw "Existing engine on port $Port did not pass health check."
  }

  Set-Location $desktopDir
  if (-not $SkipInstall) {
    pnpm install
  }

  if ($NoUI) {
    Write-Output "NoUI mode enabled. Starting Vite only for automation support."
    $viteArgs = @("dev", "--host", "127.0.0.1", "--port", "5173")
    $viteProc = Start-Process -FilePath "pnpm.cmd" -ArgumentList $viteArgs -WorkingDirectory $desktopDir -PassThru -WindowStyle Minimized

    $viteReady = $false
    foreach ($i in 1..60) {
      $listener = Get-ListenerPid -Port 5173
      if ($null -ne $listener) {
        $viteReady = $true
        break
      }
      if ($viteProc.HasExited) {
        throw "Vite exited before opening port 5173."
      }
      Start-Sleep -Milliseconds 500
    }

    if (-not $viteReady) {
      throw "Vite did not open port 5173 in time."
    }

    while ($true) {
      if ($viteProc.HasExited) {
        throw "Vite process exited unexpectedly in NoUI mode."
      }
      Start-Sleep -Seconds 1
    }
  }

  $staleDesktop = Get-Process -Name "fxfr_desktop" -ErrorAction SilentlyContinue
  if ($staleDesktop) {
    Write-Output "Stopping stale fxfr_desktop process(es) before tauri:dev."
    $staleDesktop | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }

  pnpm tauri:dev
}
finally {
  if ($viteProc -and -not $viteProc.HasExited) {
    Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue
  }
  if ($engineManaged -and $engineProc -and -not $engineProc.HasExited) {
    Stop-Process -Id $engineProc.Id -Force
  }
}
