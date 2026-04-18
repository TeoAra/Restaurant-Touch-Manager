<#
.SYNOPSIS
    Build standalone per esecuzione locale su Windows.
    Da eseguire nella cartella C:\HelloTable dopo aver fatto git pull.
#>

param(
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$INSTALL_DIR = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Write-Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }

Push-Location $INSTALL_DIR

Write-Step "Dipendenze"
pnpm install --frozen-lockfile
Write-Ok "ok"

Write-Step "API Server"
pnpm --filter @workspace/api-server run build
Write-Ok "ok"

Write-Step "Frontend (PORT=$Port BASE_PATH=/)"
$env:PORT      = $Port
$env:BASE_PATH = "/"
pnpm --filter @workspace/pos-restaurant run build
Write-Ok "ok"

Write-Step "Schema DB"
pnpm --filter @workspace/db run push-force
Write-Ok "ok"

Pop-Location

Write-Host "`n  Build completata." -ForegroundColor Green
Write-Host "  Avvia il server con: avvia-test.bat" -ForegroundColor Yellow
Write-Host "  oppure riavvia il servizio Windows HelloTable`n"
