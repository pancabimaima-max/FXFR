param(
  [string]$RepoRoot = "",
  [string]$Channel = "stable"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

& (Join-Path $PSScriptRoot "doctor.ps1") -RepoRoot $RepoRoot -ExpectedRoot $RepoRoot

$engineDir = Join-Path $RepoRoot "services\engine"
$venvPython = Join-Path $engineDir ".venv\Scripts\python.exe"
$entrypoint = Join-Path $engineDir "sidecar_main.py"
$distRoot = Join-Path $engineDir "dist"
$buildRoot = Join-Path $engineDir "build"
$targetRoot = Join-Path $RepoRoot "apps\desktop\src-tauri\resources\engine"

if (-not (Test-Path $entrypoint)) {
  throw "Missing sidecar entrypoint: $entrypoint"
}

if (-not (Test-Path $venvPython)) {
  throw "Engine venv not found: $venvPython"
}

Push-Location $engineDir
try {
  & $venvPython -m pip install --upgrade pip
  & $venvPython -m pip install -r requirements.txt
  & $venvPython -m pip install pyinstaller==6.13.0

  if (Test-Path $distRoot) { Remove-Item $distRoot -Recurse -Force }
  if (Test-Path $buildRoot) { Remove-Item $buildRoot -Recurse -Force }

  & $venvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --name fxfr-engine `
    sidecar_main.py

  $sidecarExe = Join-Path $distRoot "fxfr-engine\fxfr-engine.exe"
  if (-not (Test-Path $sidecarExe)) {
    throw "PyInstaller build did not produce executable: $sidecarExe"
  }

  if (Test-Path $targetRoot) {
    Remove-Item $targetRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

  Copy-Item -Path (Join-Path $distRoot "fxfr-engine\*") -Destination $targetRoot -Recurse -Force

  $copiedExe = Join-Path $targetRoot "fxfr-engine.exe"
  if (-not (Test-Path $copiedExe)) {
    throw "Sidecar executable missing after copy: $copiedExe"
  }

  Write-Output "Engine sidecar built and staged for channel '$Channel': $copiedExe"
}
finally {
  Pop-Location
}

