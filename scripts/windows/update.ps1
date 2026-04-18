#Requires -RunAsAdministrator
<#
.SYNOPSIS
    HelloTable - Aggiornamento da git e ricostruzione
#>

$ErrorActionPreference = "Stop"
$INSTALL_DIR = "C:\HelloTable"
$SVC_NAME    = "HelloTable"
$PORT        = 8080

function Write-Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }

Write-Host "`n  HelloTable — Aggiornamento" -ForegroundColor DarkCyan

# ── 1. Ferma servizio ────────────────────────────────────────────────────────
Write-Step "Stop servizio Windows"
Stop-Service $SVC_NAME -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Write-Ok "Servizio fermato"

# ── 2. Git pull ──────────────────────────────────────────────────────────────
Write-Step "Download aggiornamenti (git pull)"
Push-Location $INSTALL_DIR
git fetch --all
git reset --hard origin/main
Write-Ok "Sorgenti aggiornati al commit: $(git log --oneline -1)"

# ── 3. Dipendenze ────────────────────────────────────────────────────────────
Write-Step "Aggiornamento dipendenze"
pnpm install --frozen-lockfile
Write-Ok "Dipendenze ok"

# ── 4. Build ─────────────────────────────────────────────────────────────────
Write-Step "Build API server"
pnpm --filter @workspace/api-server run build
Write-Ok "API server compilato"

Write-Step "Build frontend"
$env:PORT      = $PORT
$env:BASE_PATH = "/"
pnpm --filter @workspace/pos-restaurant run build
Write-Ok "Frontend compilato"

# ── 5. Migrazione DB ─────────────────────────────────────────────────────────
Write-Step "Sincronizzazione schema database"
pnpm --filter @workspace/db run push-force
Write-Ok "Schema aggiornato"

Pop-Location

# ── 6. Riavvia servizio ──────────────────────────────────────────────────────
Write-Step "Avvio servizio"
Start-Service $SVC_NAME
Start-Sleep 2
$status = (Get-Service $SVC_NAME).Status
Write-Ok "Servizio: $status"

$localIPs = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -ne "127.0.0.1" } |
    Select-Object -ExpandProperty IPAddress)

Write-Host ""
Write-Host "  Aggiornamento completato!" -ForegroundColor Green
foreach ($ip in $localIPs) {
    Write-Host "  Accedi: http://${ip}:${PORT}" -ForegroundColor Yellow
}
Write-Host ""
