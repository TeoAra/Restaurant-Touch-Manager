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
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ─── Configurazione ─────────────────────────────────────────────────────────
$APP_NAME    = "HelloTable"
$INSTALL_DIR = "C:\HelloTable"
$PORT        = 8080
$SVC_NAME    = "HelloTable"
$REPO_URL    = "https://github.com/TeoAra/Restaurant-Touch-Manager.git"
$WINSW_URL   = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"

# ─── Colori e output ────────────────────────────────────────────────────────
function Write-Step($msg)  { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "`n    [X]  $msg" -ForegroundColor Red; Read-Host "`nPremi Invio per chiudere"; exit 1 }

Write-Host @"

  ██╗  ██╗███████╗██╗     ██╗      ██████╗ ████████╗ █████╗ ██████╗ ██╗     ███████╗
  ██║  ██║██╔════╝██║     ██║     ██╔═══██╗╚══██╔══╝██╔══██╗██╔══██╗██║     ██╔════╝
  ███████║█████╗  ██║     ██║     ██║   ██║   ██║   ███████║██████╔╝██║     █████╗
  ██╔══██║██╔══╝  ██║     ██║     ██║   ██║   ██║   ██╔══██║██╔══██╗██║     ██╔══╝
  ██║  ██║███████╗███████╗███████╗╚██████╔╝   ██║   ██║  ██║██████╔╝███████╗███████╗
  ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝

  Installer v1.1 — Windows Server LAN
"@ -ForegroundColor DarkCyan

# ─── 1. Prerequisiti ────────────────────────────────────────────────────────
Write-Step "Verifica prerequisiti"

# Node.js
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warn "Node.js non trovato. Installazione v22..."
    $nodeUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
    $nodeMsi = "$env:TEMP\node_install.msi"
    Invoke-WebRequest $nodeUrl -OutFile $nodeMsi
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeMsi`" /qn ADDLOCAL=ALL"
    Remove-Item $nodeMsi -Force
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine")
}
Write-Ok "Node.js $(node --version)"

# Git
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Fail "Git non trovato. Installa Git da https://git-scm.com, riapri PowerShell e rilancia."
}
Write-Ok "Git $(git --version)"

# pnpm
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warn "pnpm non trovato. Installazione..."
    npm install -g pnpm | Out-Null
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                "$env:APPDATA\npm"
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
    if ($LASTEXITCODE -ne 0) { Write-Fail "git clone fallito. Controlla URL repo e connessione." }
}
Write-Ok "Sorgenti pronti in $INSTALL_DIR"

# ─── 3. File .env ───────────────────────────────────────────────────────────
Write-Step "Configurazione database e variabili ambiente"

$envFile = "$INSTALL_DIR\.env"
if (!(Test-Path $envFile)) {
    Write-Host ""
    Write-Host "  Hai bisogno di un DATABASE_URL PostgreSQL." -ForegroundColor Yellow
    Write-Host "  Opzione A (consigliata): usa il database cloud di Replit:" -ForegroundColor Yellow
    Write-Host "    1. Apri Replit nel browser" -ForegroundColor Gray
    Write-Host "    2. Vai su Tools > Database" -ForegroundColor Gray
    Write-Host "    3. Copia il valore 'DATABASE_URL'" -ForegroundColor Gray
    Write-Host "  Opzione B: installa PostgreSQL locale da https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    Write-Host "    e usa: postgresql://postgres:PASSWORD@localhost:5432/hellotable" -ForegroundColor Gray
    Write-Host ""
    $dbUrl = Read-Host "    Incolla il DATABASE_URL"
    if ([string]::IsNullOrWhiteSpace($dbUrl)) { Write-Fail "DATABASE_URL obbligatorio." }
    $sessionSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | % { [char]$_ })
    @"
# HelloTable — configurazione locale
DATABASE_URL=$dbUrl
SESSION_SECRET=$sessionSecret
PORT=$PORT
NODE_ENV=production
LOCAL_FRONTEND_DIR=$INSTALL_DIR\artifacts\pos-restaurant\dist\public
"@ | Set-Content $envFile -Encoding UTF8
    Write-Ok ".env creato"
} else {
    Write-Ok ".env gia' presente, non sovrascritto"
}

# Carica le variabili env nella sessione PowerShell corrente
foreach ($line in Get-Content $envFile) {
    if ($line -match "^([^#=\s][^=]*)=(.+)$") {
        [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
    }
}

# ─── 4. Dipendenze e build ──────────────────────────────────────────────────
Write-Step "Installazione dipendenze (pnpm install)"
Push-Location $INSTALL_DIR
pnpm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "pnpm install fallito." }
Write-Ok "Dipendenze installate"

Write-Step "Build API server"
pnpm --filter @workspace/api-server run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "Build API server fallita. Vedi errore sopra." }
Write-Ok "API server compilato"

Write-Step "Build frontend"
$env:PORT      = "$PORT"
$env:BASE_PATH = "/"
pnpm --filter @workspace/pos-restaurant run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Fail "Build frontend fallita. Vedi errore sopra."
}
Write-Ok "Frontend compilato"

Write-Step "Sincronizzazione schema database"
pnpm --filter @workspace/db run push-force
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "Sync DB fallita. Controlla che DATABASE_URL sia corretto." }
Write-Ok "Schema DB aggiornato"

Pop-Location

# ─── 5. WinSW (gestore servizi) ─────────────────────────────────────────────
Write-Step "Scaricamento WinSW (Windows Service Wrapper)"

$winswExe = "$INSTALL_DIR\winsw.exe"
if (!(Test-Path $winswExe)) {
    Invoke-WebRequest $WINSW_URL -OutFile $winswExe
}
Write-Ok "WinSW pronto"

# Script di avvio che carica le variabili dal .env
$startBat = "$INSTALL_DIR\start-server.bat"
@"
@echo off
for /f "usebackq tokens=1,* delims==" %%A in (`type "$INSTALL_DIR\.env" ^| findstr /v "^#" ^| findstr /v "^$"`) do (
    set "%%A=%%B"
)
node --enable-source-maps "$INSTALL_DIR\artifacts\api-server\dist\index.mjs"
"@ | Set-Content $startBat -Encoding ASCII

# Config XML per WinSW
New-Item "$INSTALL_DIR\logs" -ItemType Directory -Force | Out-Null
$winswXml = "$INSTALL_DIR\winsw.xml"
@"
<service>
  <id>$SVC_NAME</id>
  <name>HelloTable POS Server</name>
  <description>Server locale HelloTable — API + Frontend</description>
  <executable>$INSTALL_DIR\start-server.bat</executable>
  <workingdirectory>$INSTALL_DIR</workingdirectory>
  <logpath>$INSTALL_DIR\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>5120</sizeThreshold>
    <keepFiles>3</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="20 sec"/>
  <onfailure action="restart" delay="60 sec"/>
</service>
"@ | Set-Content $winswXml -Encoding UTF8

# ─── 6. Registrazione servizio Windows ──────────────────────────────────────
Write-Step "Registrazione servizio Windows '$SVC_NAME'"

$svcExists = Get-Service $SVC_NAME -ErrorAction SilentlyContinue
if ($svcExists) {
    Stop-Service $SVC_NAME -Force -ErrorAction SilentlyContinue
    & $winswExe uninstall $winswXml 2>&1 | Out-Null
    Start-Sleep 2
}

& $winswExe install $winswXml
if ($LASTEXITCODE -ne 0) { Write-Fail "Registrazione servizio fallita." }
Write-Ok "Servizio '$SVC_NAME' registrato"

# ─── 7. Regola firewall ─────────────────────────────────────────────────────
Write-Step "Apertura porta $PORT nel firewall"
Remove-NetFirewallRule -DisplayName "HelloTable POS" -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "HelloTable POS" -Direction Inbound `
    -Protocol TCP -LocalPort $PORT -Action Allow | Out-Null
Write-Ok "Porta $PORT aperta"

# ─── 8. Avvio servizio ──────────────────────────────────────────────────────
Write-Step "Avvio servizio"
Start-Service $SVC_NAME
Start-Sleep 3
$status = (Get-Service $SVC_NAME).Status
if ($status -ne "Running") { Write-Warn "Servizio stato: $status — controlla i log in $INSTALL_DIR\logs\" }
else { Write-Ok "Servizio in esecuzione" }

# ─── 9. Riepilogo ───────────────────────────────────────────────────────────
Write-Step "Riepilogo installazione"

$localIPs = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -ne "127.0.0.1" } |
    Select-Object -ExpandProperty IPAddress)

Write-Host ""
Write-Host "  ╔════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║       HelloTable installato con successo!          ║" -ForegroundColor Green
Write-Host "  ╠════════════════════════════════════════════════════╣" -ForegroundColor Green
foreach ($ip in $localIPs) {
Write-Host "  ║  Accedi da browser/telefono/tablet:                ║" -ForegroundColor Green
Write-Host "  ║    http://${ip}:${PORT}                            ║" -ForegroundColor Yellow
}
Write-Host "  ╠════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  Servizio: $SVC_NAME (avvio automatico con Windows)║" -ForegroundColor Green
Write-Host "  ║  Log: $INSTALL_DIR\logs\                           ║" -ForegroundColor Green
Write-Host "  ║  Aggiorna: esegui update.ps1                       ║" -ForegroundColor Green
Write-Host "  ╚════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Read-Host "Premi Invio per chiudere"
