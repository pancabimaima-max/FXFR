param(
  [string]$RepoRoot = "",
  [string]$Channel = "stable",
  [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

& (Join-Path $PSScriptRoot "doctor.ps1") -RepoRoot $RepoRoot -ExpectedRoot $RepoRoot

$bundleRoot = Join-Path $RepoRoot "apps\desktop\src-tauri\target\release\bundle"
$resourcesExe = Join-Path $RepoRoot "apps\desktop\src-tauri\resources\engine\fxfr-engine.exe"

if (-not (Test-Path $resourcesExe)) {
  throw "Bundled sidecar staging executable not found: $resourcesExe"
}

$nsisExe = Get-ChildItem -Path (Join-Path $bundleRoot "nsis") -Filter *.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1
$msiPkg = Get-ChildItem -Path (Join-Path $bundleRoot "msi") -Filter *.msi -File -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -eq $nsisExe) {
  throw "NSIS executable was not produced under $bundleRoot\\nsis"
}
if ($null -eq $msiPkg) {
  throw "MSI package was not produced under $bundleRoot\\msi"
}

$artifactRoot = Join-Path $RepoRoot "artifacts"
if (Test-Path $artifactRoot) { Remove-Item $artifactRoot -Recurse -Force }
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

$stableChannel = if ($Channel -eq "beta") { "beta" } else { "stable" }
$nsisOut = Join-Path $artifactRoot ("fxfr-desktop-{0}-{1}-nsis.exe" -f $Version, $stableChannel)
$msiOut = Join-Path $artifactRoot ("fxfr-desktop-{0}-{1}-msi.msi" -f $Version, $stableChannel)

Copy-Item -Path $nsisExe.FullName -Destination $nsisOut -Force
Copy-Item -Path $msiPkg.FullName -Destination $msiOut -Force

Write-Output "Packaging artifacts verified."
Write-Output "NSIS: $nsisOut"
Write-Output "MSI : $msiOut"

