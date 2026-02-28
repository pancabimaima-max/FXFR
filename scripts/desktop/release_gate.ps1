param(
  [string]$StartupSummaryPath = "",
  [string]$SoakSummaryPath = "",
  [string]$AttestationPath = "",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
& (Join-Path $PSScriptRoot "doctor.ps1") -RepoRoot $repoRoot -ExpectedRoot $repoRoot

function Resolve-LatestSummaryPath {
  param(
    [string]$Root,
    [string]$Filter
  )

  if (-not (Test-Path $Root)) {
    return ""
  }

  $file = Get-ChildItem -Path $Root -Recurse -Filter $Filter -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

  if ($null -eq $file) { return "" }
  return $file.FullName
}

if ([string]::IsNullOrWhiteSpace($StartupSummaryPath)) {
  $StartupSummaryPath = Resolve-LatestSummaryPath -Root (Join-Path $repoRoot "artifacts\soak\startup") -Filter "startup_summary.json"
}

if ([string]::IsNullOrWhiteSpace($SoakSummaryPath)) {
  $SoakSummaryPath = Resolve-LatestSummaryPath -Root (Join-Path $repoRoot "artifacts\soak\longrun") -Filter "soak_summary.json"
}

if ([string]::IsNullOrWhiteSpace($AttestationPath)) {
  $AttestationPath = Join-Path $repoRoot "docs\templates\release-attestation.template.json"
}

foreach ($pathValue in @($StartupSummaryPath, $SoakSummaryPath, $AttestationPath)) {
  if ([string]::IsNullOrWhiteSpace($pathValue) -or -not (Test-Path $pathValue)) {
    throw "Required evidence file not found: $pathValue"
  }
}

$startup = Get-Content $StartupSummaryPath -Raw | ConvertFrom-Json
$soak = Get-Content $SoakSummaryPath -Raw | ConvertFrom-Json
$attestation = Get-Content $AttestationPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $OutputDir = Join-Path $repoRoot (Join-Path "artifacts\release-gate" $stamp)
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$checksAuto = @()
$checksManual = @()

$checksAuto += [ordered]@{ name = "startup_summary_present"; pass = $true; detail = $StartupSummaryPath }
$checksAuto += [ordered]@{ name = "soak_summary_present"; pass = $true; detail = $SoakSummaryPath }
$checksAuto += [ordered]@{ name = "startup_pass"; pass = [bool]$startup.pass; detail = "failed_runs=$($startup.failed_runs)" }
$checksAuto += [ordered]@{ name = "soak_pass"; pass = [bool]$soak.pass; detail = "bootstrap_failures=$($soak.bootstrap_failures); unexpected_exit_count=$($soak.unexpected_exit_count); max_contiguous_outage_seconds=$($soak.max_contiguous_outage_seconds)" }

$hasVersion = -not [string]::IsNullOrWhiteSpace([string]$attestation.version)
$hasChannel = -not [string]::IsNullOrWhiteSpace([string]$attestation.channel)

$checksManual += [ordered]@{ name = "attestation_has_version"; pass = $hasVersion; detail = [string]$attestation.version }
$checksManual += [ordered]@{ name = "attestation_has_channel"; pass = $hasChannel; detail = [string]$attestation.channel }
$checksManual += [ordered]@{ name = "sev1_sev2_zero_last_7d"; pass = [bool]$attestation.sev1_sev2_zero_last_7d; detail = "must be true" }
$checksManual += [ordered]@{ name = "paper_trading_7d_complete"; pass = [bool]$attestation.paper_trading_7d_complete; detail = "must be true" }
$checksManual += [ordered]@{ name = "approved_by_present"; pass = (-not [string]::IsNullOrWhiteSpace([string]$attestation.approved_by)); detail = [string]$attestation.approved_by }
$checksManual += [ordered]@{ name = "approved_at_utc_present"; pass = (-not [string]::IsNullOrWhiteSpace([string]$attestation.approved_at_utc)); detail = [string]$attestation.approved_at_utc }

$autoPass = @($checksAuto | Where-Object { -not $_.pass }).Count -eq 0
$manualPass = @($checksManual | Where-Object { -not $_.pass }).Count -eq 0
$overallPass = ($autoPass -and $manualPass)

$report = [ordered]@{
  schema_version = "1.0.0"
  generated_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  overall_pass = $overallPass
  automated_pass = $autoPass
  manual_pass = $manualPass
  inputs = [ordered]@{
    startup_summary_path = $StartupSummaryPath
    soak_summary_path = $SoakSummaryPath
    attestation_path = $AttestationPath
  }
  automated_checks = $checksAuto
  manual_checks = $checksManual
}

$reportJsonPath = Join-Path $OutputDir "release_gate_report.json"
$reportMdPath = Join-Path $OutputDir "release_gate_report.md"

$report | ConvertTo-Json -Depth 10 | Set-Content -Path $reportJsonPath -Encoding UTF8

$md = @()
$md += "# Release Gate Report"
$md += ""
$md += "Generated (UTC): $($report.generated_at_utc)"
$md += ""
$md += "Overall pass: **$($report.overall_pass)**"
$md += ""
$md += "## Inputs"
$md += ("- Startup summary: " + $StartupSummaryPath)
$md += ("- Soak summary: " + $SoakSummaryPath)
$md += ("- Attestation: " + $AttestationPath)
$md += ""
$md += "## Automated Checks"
$md += "| Check | Pass | Detail |"
$md += "|---|---|---|"
foreach ($row in $checksAuto) {
  $md += "| $($row.name) | $($row.pass) | $($row.detail) |"
}
$md += ""
$md += "## Manual Checks"
$md += "| Check | Pass | Detail |"
$md += "|---|---|---|"
foreach ($row in $checksManual) {
  $md += "| $($row.name) | $($row.pass) | $($row.detail) |"
}

Set-Content -Path $reportMdPath -Value ($md -join "`r`n") -Encoding UTF8

Write-Output "Release gate report written: $reportJsonPath"
Write-Output "Release gate report written: $reportMdPath"

if (-not $overallPass) {
  throw "Release gate failed. See report at $reportJsonPath"
}