$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
& (Join-Path $PSScriptRoot "doctor.ps1") -RepoRoot $repoRoot

Write-Warning "Canonical startup is 'pnpm dev:fullstack' from repo root."
Set-Location (Join-Path $repoRoot "apps\desktop")
pnpm install
pnpm tauri:dev
