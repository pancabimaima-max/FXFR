param(
  [string]$RepoRoot = "",
  [string]$ExpectedRoot = "C:\dev\fxfr_desktop",
  [string]$ExpectedRole = "desktop-clean-room"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$resolvedRoot = (Resolve-Path $RepoRoot).Path
$normalizedRoot = $resolvedRoot.TrimEnd('\').ToLowerInvariant()
$normalizedExpected = $ExpectedRoot.TrimEnd('\').ToLowerInvariant()

if ($normalizedRoot -ne $normalizedExpected) {
  throw "Wrong repository root: $resolvedRoot. Expected: $ExpectedRoot"
}

$rolePath = Join-Path $resolvedRoot ".repo-role"
if (-not (Test-Path $rolePath)) {
  throw "Missing repo marker file: $rolePath"
}

$roleValue = (Get-Content -Path $rolePath -Raw).Trim()
if ($roleValue -ne $ExpectedRole) {
  throw "Invalid repo marker value '$roleValue'. Expected '$ExpectedRole'."
}

Write-Output "Repo doctor passed: $resolvedRoot"
