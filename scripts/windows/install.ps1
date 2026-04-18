#Requires -RunAsAdministrator
<#
.SYNOPSIS
    HelloTable - Installer per Windows (LAN Server)
    Eseguire come Amministratore in PowerShell.

.DESCRIPTION
    Installa HelloTable come servizio Windows.
    Il server risponde su http://0.0.0.0:8080
    I telefoni del ristorante accedono via http://[IP-DEL-PC]:8080
#>

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

# Fix TLS 1.2 per Windows Server 2016 / Windows 10 vecchi (GitHub richiede TLS 1.2)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ─── Configurazione ─────────────────────────────────────────────────────────
$APP_NAME    = "HelloTable"
$INSTALL_DIR = "C:\HelloTable"
$PORT        = 8080
$SVC_NAME    = "HelloTable"
$REPO_URL    = "https://github.com/TeoAra/Restaurant-Touch-Manager.git"
$NSSM_URL    = "https://nssm.cc/release/nssm-2.24.zip"

# ─── Colori e output ────────────────────────────────────────────────────────
function Write-Step($msg)  { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "    [X]  $msg" -ForegroundColor Red; exit 1 }

Write-Host @"

  ██╗  ██╗███████╗██╗     ██╗      ██████╗ ████████╗ █████╗ ██████╗ ██╗     ███████╗
  ██║  ██║██╔════╝██║     ██║     ██╔═══██╗╚══██╔══╝██╔══██╗██╔══██╗██║     ██╔════╝
  ███████║█████╗  ██║     ██║     ██║   ██║   ██║   ███████║██████╔╝██║     █████╗
  ██╔══██║██╔══╝  ██║     ██║     ██║   ██║   ██║   ██╔══██║██╔══██╗██║     ██╔══╝
  ██║  ██║███████╗███████╗███████╗╚██████╔╝   ██║   ██║  ██║██████╔╝███████╗███████╗
  ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝

  Installer v1.0 — Windows Server LAN
"@ -ForegroundColor DarkCyan

# ─── 1. Prerequisiti ────────────────────────────────────────────────────────
Write-Step "Verifica prerequisiti"

# Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warn "Node.js non trovato. Installazione..."
    $nodeUrl = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
    $nodeMsi = "$env:TEMP\node_install.msi"
    Invoke-WebRequest $nodeUrl -OutFile $nodeMsi
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeMsi`" /qn ADDLOCAL=ALL"
    Remove-Item $nodeMsi -Force
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine")
}
$nodeVer = (node --version 2>&1)
Write-Ok "Node.js $nodeVer"

# Git
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Fail "Git non trovato. Installa Git da https://git-scm.com e rilancia questo script."
}
Write-Ok "Git $(git --version)"

# pnpm
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warn "pnpm non trovato. Installazione..."
    npm install -g pnpm | Out-Null
}
Write-Ok "pnpm $(pnpm --version)"

# ─── 2. Cartella di installazione ───────────────────────────────────────────
Write-Step "Preparazione directory $INSTALL_DIR"

if (Test-Path "$INSTALL_DIR\.git") {
    Write-Warn "Repo gia' presente. Aggiornamento in corso..."
    Push-Location $INSTALL_DIR
    git fetch --all
    git reset --hard origin/main
    Pop-Location
} else {
    if (Test-Path $INSTALL_DIR) { Remove-Item $INSTALL_DIR -Recurse -Force }
    Write-Host "    Clonazione repo..."
    git clone $REPO_URL $INSTALL_DIR
}
Write-Ok "Sorgenti pronti in $INSTALL_DIR"

# ─── 3. File .env ───────────────────────────────────────────────────────────
Write-Step "Configurazione .env"

$envFile = "$INSTALL_DIR\.env"
if (!(Test-Path $envFile)) {
    $dbUrl = Read-Host "    Inserisci il DATABASE_URL (PostgreSQL)"
    $sessionSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | % { [char]$_ })
    @"
# HelloTable — configurazione locale
DATABASE_URL=$dbUrl
SESSION_SECRET=$sessionSecret
PORT=$PORT
NODE_ENV=production
LOCAL_FRONTEND_DIR=$INSTALL_DIR\artifacts\pos-restaurant\dist\public
"@ | Set-Content $envFile
    Write-Ok ".env creato"
} else {
    Write-Ok ".env gia' presente, non sovrascritto"
}

# ─── 4. Dipendenze e build ──────────────────────────────────────────────────
Write-Step "Installazione dipendenze (pnpm install)"
Push-Location $INSTALL_DIR
pnpm install --frozen-lockfile
Write-Ok "Dipendenze installate"

Write-Step "Build API server"
pnpm --filter @workspace/api-server run build
Write-Ok "API server compilato"

Write-Step "Build frontend"
$env:PORT     = $PORT
$env:BASE_PATH = "/"
pnpm --filter @workspace/pos-restaurant run build
Write-Ok "Frontend compilato"

Write-Step "Sincronizzazione database"
pnpm --filter @workspace/db run push-force
Write-Ok "Schema DB aggiornato"

Pop-Location

# ─── 5. NSSM (gestore servizi) ──────────────────────────────────────────────
Write-Step "Scaricamento NSSM (Windows Service Manager)"

$nssmDir = "C:\nssm"
$nssmExe = "$nssmDir\win64\nssm.exe"

if (!(Test-Path $nssmExe)) {
    $nssmZip = "$env:TEMP\nssm.zip"
    Invoke-WebRequest $NSSM_URL -OutFile $nssmZip
    Expand-Archive $nssmZip -DestinationPath "$env:TEMP\nssm_extract" -Force
    New-Item $nssmDir -ItemType Directory -Force | Out-Null
    Copy-Item "$env:TEMP\nssm_extract\nssm-2.24" $nssmDir -Recurse -Force
    Remove-Item $nssmZip, "$env:TEMP\nssm_extract" -Recurse -Force
}
Write-Ok "NSSM pronto: $nssmExe"

# ─── 6. Registrazione servizio Windows ──────────────────────────────────────
Write-Step "Registrazione servizio Windows '$SVC_NAME'"

$nodeExe  = (Get-Command node).Source
$startCmd = "$INSTALL_DIR\artifacts\api-server\dist\index.mjs"

if ((& $nssmExe status $SVC_NAME 2>&1) -notmatch "SERVICE_") {
    & $nssmExe install $SVC_NAME $nodeExe "--enable-source-maps `"$startCmd`""
}

& $nssmExe set $SVC_NAME AppDirectory  $INSTALL_DIR
& $nssmExe set $SVC_NAME DisplayName   "HelloTable POS Server"
& $nssmExe set $SVC_NAME Description   "Server locale HelloTable — API + Frontend"
& $nssmExe set $SVC_NAME Start         SERVICE_AUTO_START
& $nssmExe set $SVC_NAME AppStdout     "$INSTALL_DIR\logs\hellotable.log"
& $nssmExe set $SVC_NAME AppStderr     "$INSTALL_DIR\logs\hellotable-error.log"
& $nssmExe set $SVC_NAME AppRotateFiles 1
& $nssmExe set $SVC_NAME AppRotateBytes 5242880

New-Item "$INSTALL_DIR\logs" -ItemType Directory -Force | Out-Null

# Variabili d'ambiente per il servizio
$envBlock = (Get-Content $envFile) -join "`n"
foreach ($line in Get-Content $envFile) {
    if ($line -match "^([^#=]+)=(.+)$") {
        & $nssmExe set $SVC_NAME AppEnvironmentExtra "$($Matches[1])=$($Matches[2])"
    }
}

Write-Ok "Servizio '$SVC_NAME' registrato"

# ─── 7. Regola firewall ─────────────────────────────────────────────────────
Write-Step "Apertura porta $PORT nel firewall"
$fwRule = Get-NetFirewallRule -DisplayName "HelloTable POS" -ErrorAction SilentlyContinue
if (!$fwRule) {
    New-NetFirewallRule -DisplayName "HelloTable POS" -Direction Inbound `
        -Protocol TCP -LocalPort $PORT -Action Allow | Out-Null
}
Write-Ok "Porta $PORT aperta"

# ─── 8. Avvio servizio ──────────────────────────────────────────────────────
Write-Step "Avvio servizio"
Start-Service $SVC_NAME -ErrorAction SilentlyContinue
Start-Sleep 2
$status = (Get-Service $SVC_NAME).Status
Write-Ok "Servizio: $status"

# ─── 9. IP locale ───────────────────────────────────────────────────────────
Write-Step "Riepilogo installazione"

$localIPs = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -ne "127.0.0.1" } |
    Select-Object -ExpandProperty IPAddress)

Write-Host ""
Write-Host "  ╔════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║       HelloTable installato con successo!          ║" -ForegroundColor Green
Write-Host "  ╠════════════════════════════════════════════════════╣" -ForegroundColor Green
foreach ($ip in $localIPs) {
Write-Host "  ║  Accedi da browser/telefono:                       ║" -ForegroundColor Green
Write-Host "  ║    http://${ip}:${PORT}                            ║" -ForegroundColor Yellow
}
Write-Host "  ╠════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  Servizio Windows: $SVC_NAME (avvio automatico)    ║" -ForegroundColor Green
Write-Host "  ║  Log: $INSTALL_DIR\logs\                           ║" -ForegroundColor Green
Write-Host "  ║  Aggiorna: esegui update.ps1                       ║" -ForegroundColor Green
Write-Host "  ╚════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
