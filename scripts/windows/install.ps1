#Requires -RunAsAdministrator
<#
.SYNOPSIS
    HelloTable - Installer per Windows (LAN Server)
    Eseguire come Amministratore in PowerShell.
.DESCRIPTION
    Installa Node.js, PostgreSQL, HelloTable come servizio Windows.
    Il server risponde su http://0.0.0.0:8080
    Telefoni/tablet accedono via http://[IP-DEL-PC]:8080
#>

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ─── Configurazione ─────────────────────────────────────────────────────────
$INSTALL_DIR = "C:\HelloTable"
$PORT        = 8080
$SVC_NAME    = "HelloTable"
$REPO_URL    = "https://github.com/TeoAra/Restaurant-Touch-Manager.git"
$WINSW_URL   = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
$NODE_URL    = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
$PG_URL      = "https://get.enterprisedb.com/postgresql/postgresql-16.9-1-windows-x64.exe"
$PG_PASS     = "hellotable123"
$PG_PORT     = 5432
$PG_DB       = "hellotable"
$DB_URL      = "postgresql://postgres:${PG_PASS}@localhost:${PG_PORT}/${PG_DB}"

# ─── Helper ─────────────────────────────────────────────────────────────────
function Write-Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) {
    Write-Host "`n    [X]  $msg" -ForegroundColor Red
    Read-Host "`nPremi Invio per chiudere"
    exit 1
}
function Reload-Path {
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")
}
# Scrive file UTF-8 SENZA BOM (il BOM rompe JSON/YAML su Windows PowerShell)
$NoBom = [System.Text.UTF8Encoding]::new($false)
function Write-FileNoBom($path, $content) {
    [System.IO.File]::WriteAllText($path, $content, $NoBom)
}

Write-Host @"

  ██╗  ██╗███████╗██╗     ██╗      ██████╗ ████████╗ █████╗ ██████╗ ██╗     ███████╗
  ██║  ██║██╔════╝██║     ██║     ██╔═══██╗╚══██╔══╝██╔══██╗██╔══██╗██║     ██╔════╝
  ███████║█████╗  ██║     ██║     ██║   ██║   ██║   ███████║██████╔╝██║     █████╗
  ██╔══██║██╔══╝  ██║     ██║     ██║   ██║   ██║   ██╔══██║██╔══██╗██║     ██╔══╝
  ██║  ██║███████╗███████╗███████╗╚██████╔╝   ██║   ██║  ██║██████╔╝███████╗███████╗
  ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝

  Installer v1.2 — Windows LAN Server
"@ -ForegroundColor DarkCyan

# ─── 1. Node.js ─────────────────────────────────────────────────────────────
Write-Step "Node.js v22"
$nodeOk = $false
try { $nodeOk = (node --version) -match "v2[2-9]\." } catch {}
if (!$nodeOk) {
    Write-Warn "Installazione Node.js v22..."
    $nodeMsi = "$env:TEMP\node22.msi"
    Invoke-WebRequest $NODE_URL -OutFile $nodeMsi
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeMsi`" /qn ADDLOCAL=ALL"
    Remove-Item $nodeMsi -Force
    Reload-Path
}
$nodeVer = node --version
if (!($nodeVer -match "v2[2-9]\.")) { Write-Fail "Node.js v22+ richiesto. Versione trovata: $nodeVer" }
Write-Ok "Node.js $nodeVer"

# ─── 2. Git ─────────────────────────────────────────────────────────────────
Write-Step "Git"
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Fail "Git non trovato. Installa da https://git-scm.com e rilancia."
}
Write-Ok "Git $(git --version)"

# ─── 3. pnpm ────────────────────────────────────────────────────────────────
Write-Step "pnpm"
Reload-Path
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warn "Installazione pnpm..."
    npm install -g pnpm | Out-Null
    Reload-Path
    $env:PATH += ";$env:APPDATA\npm"
}
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) { Write-Fail "pnpm non trovato dopo installazione." }
Write-Ok "pnpm $(pnpm --version)"

# ─── 4. PostgreSQL ──────────────────────────────────────────────────────────
Write-Step "PostgreSQL 16"
$pgExe = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
if (!(Test-Path $pgExe)) {
    Write-Warn "Installazione PostgreSQL 16 (2-3 minuti)..."
    $pgInst = "$env:TEMP\pg_install.exe"
    Invoke-WebRequest $PG_URL -OutFile $pgInst
    Start-Process $pgInst -Wait -ArgumentList `
        "--mode unattended --superpassword `"$PG_PASS`" --servicename postgresql --serverport $PG_PORT"
    Remove-Item $pgInst -Force
    Reload-Path
}
$env:PATH += ";C:\Program Files\PostgreSQL\16\bin"
# Crea database se non esiste
$dbExists = & $pgExe -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" 2>$null
if ($dbExists -ne "1") {
    & $pgExe -U postgres -c "CREATE DATABASE $PG_DB;" | Out-Null
    Write-Ok "Database '$PG_DB' creato"
} else {
    Write-Ok "Database '$PG_DB' gia' esistente"
}
Write-Ok "PostgreSQL pronto"

# ─── 5. Clonazione repo ─────────────────────────────────────────────────────
Write-Step "Codice sorgente"
if (Test-Path "$INSTALL_DIR\.git") {
    Write-Warn "Aggiornamento repo esistente..."
    Push-Location $INSTALL_DIR
    git fetch --all
    git reset --hard origin/main
    Pop-Location
} else {
    if (Test-Path $INSTALL_DIR) { Remove-Item $INSTALL_DIR -Recurse -Force }
    git clone $REPO_URL $INSTALL_DIR
    if ($LASTEXITCODE -ne 0) { Write-Fail "git clone fallito. Controlla connessione e URL repo." }
}
Write-Ok "Sorgenti in $INSTALL_DIR"

# ─── 6. Patch per Windows ───────────────────────────────────────────────────
Write-Step "Compatibilita' Windows"

# Fix preinstall script (sh -> node)
$pkgPath = "$INSTALL_DIR\package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.scripts.preinstall = "node -e `"['package-lock.json','yarn.lock'].forEach(f=>{try{require('fs').unlinkSync(f)}catch(e){}})`""
Write-FileNoBom $pkgPath ($pkg | ConvertTo-Json -Depth 10)
Write-Ok "preinstall script aggiornato"

# Rimuovi le esclusioni Linux-only da pnpm-workspace.yaml
# (Replit esclude tutti i pacchetti nativi Windows per ridurre dimensioni su Linux)
$wsPath = "$INSTALL_DIR\pnpm-workspace.yaml"
$wsLines = Get-Content $wsPath
$wsFiltered = $wsLines | Where-Object {
    # Rimuovi righe che impostano pacchetti a "-" (esclusi su Linux)
    $_ -notmatch ":\s*[`"']?-[`"']?\s*$" -and
    # Rimuovi il commento correlato
    $_ -notmatch "replit uses linux"
}
Write-FileNoBom $wsPath ($wsFiltered -join "`n")
Write-Ok "pnpm-workspace.yaml: rimossi filtri Linux"

# Fix drizzle.config.ts per path relativo
$drizzlePath = "$INSTALL_DIR\lib\db\drizzle.config.ts"
$drizzle = Get-Content $drizzlePath -Raw
if ($drizzle -match "path\.join\(__dirname") {
    $drizzle = $drizzle -replace 'import path from "path";\r?\n', ''
    $drizzle = $drizzle -replace 'path\.join\(__dirname,\s*"\.\/src\/schema\/index\.ts"\)', '"./src/schema/index.ts"'
    Write-FileNoBom $drizzlePath $drizzle
    Write-Ok "drizzle.config.ts aggiornato"
}

# Rimuovi node_modules esistente per installazione pulita
if (Test-Path "$INSTALL_DIR\node_modules") {
    Write-Warn "Rimozione node_modules precedente per installazione pulita..."
    Remove-Item "$INSTALL_DIR\node_modules" -Recurse -Force
    Write-Ok "node_modules rimosso"
}

# ─── 7. File .env ───────────────────────────────────────────────────────────
Write-Step "Configurazione .env"
$envFile = "$INSTALL_DIR\.env"
$sessionSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 48 | % { [char]$_ })
@"
DATABASE_URL=$DB_URL
SESSION_SECRET=$sessionSecret
PORT=$PORT
NODE_ENV=production
LOCAL_FRONTEND_DIR=$INSTALL_DIR\artifacts\pos-restaurant\dist\public
"@ | ForEach-Object { Write-FileNoBom $envFile $_ }
Write-Ok ".env scritto"

# Carica variabili nel processo corrente
foreach ($line in Get-Content $envFile) {
    if ($line -match "^([^#=\s][^=]*)=(.+)$") {
        [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
    }
}

# ─── 8. Dipendenze ──────────────────────────────────────────────────────────
Write-Step "pnpm install"
Push-Location $INSTALL_DIR
pnpm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "pnpm install fallito." }
Write-Ok "Dipendenze installate"

# ─── 9. Build ───────────────────────────────────────────────────────────────
Write-Step "Build API server"
pnpm --filter @workspace/api-server run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "Build API server fallita." }
Write-Ok "API server compilato"

Write-Step "Build frontend"
$env:BASE_PATH = "/"
pnpm --filter @workspace/pos-restaurant run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "Build frontend fallita. Vedi errore sopra." }
Write-Ok "Frontend compilato"

Write-Step "Schema database"
pnpm --filter @workspace/db run push-force
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Fail "Push schema DB fallito. Controlla DATABASE_URL." }
Write-Ok "Schema DB aggiornato"

Pop-Location

# ─── 10. WinSW servizio Windows ─────────────────────────────────────────────
Write-Step "Servizio Windows (WinSW)"
$winswExe = "$INSTALL_DIR\winsw.exe"
if (!(Test-Path $winswExe)) {
    Invoke-WebRequest $WINSW_URL -OutFile $winswExe
}

# Batch di avvio — usa --env-file nativo di Node 22 (piu' robusto del parsing batch)
$startBat = "$INSTALL_DIR\start-server.bat"
@"
@echo off
node --env-file="$INSTALL_DIR\.env" --enable-source-maps "$INSTALL_DIR\artifacts\api-server\dist\index.mjs"
"@ | Set-Content $startBat -Encoding ASCII

New-Item "$INSTALL_DIR\logs" -ItemType Directory -Force | Out-Null

$winswXml = "$INSTALL_DIR\winsw.xml"
@"
<service>
  <id>$SVC_NAME</id>
  <name>HelloTable POS Server</name>
  <description>Server locale HelloTable - API + Frontend</description>
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
"@ | ForEach-Object { Write-FileNoBom $winswXml $_ }

$svc = Get-Service $SVC_NAME -ErrorAction SilentlyContinue
if ($svc) {
    Stop-Service $SVC_NAME -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    & $winswExe uninstall $winswXml 2>&1 | Out-Null
    Start-Sleep 2
}
& $winswExe install $winswXml
if ($LASTEXITCODE -ne 0) { Write-Fail "Registrazione servizio fallita." }
Write-Ok "Servizio registrato"

# ─── 11. Firewall ───────────────────────────────────────────────────────────
Write-Step "Firewall"
Remove-NetFirewallRule -DisplayName "HelloTable POS" -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "HelloTable POS" -Direction Inbound `
    -Protocol TCP -LocalPort $PORT -Action Allow | Out-Null
Write-Ok "Porta $PORT aperta"

# ─── 12. Avvio ──────────────────────────────────────────────────────────────
Write-Step "Avvio servizio"
Start-Service $SVC_NAME
Start-Sleep 4
$status = (Get-Service $SVC_NAME).Status
if ($status -ne "Running") {
    Write-Warn "Stato servizio: $status"
    Write-Warn "Controlla i log in $INSTALL_DIR\logs\"
} else {
    Write-Ok "Servizio in esecuzione"
}

# ─── 13. Utente admin iniziale ──────────────────────────────────────────────
Write-Step "Creazione utente admin"
Start-Sleep 3  # attendi che il server sia pronto
try {
    $apiBase = "http://localhost:$PORT/api"
    # Controlla se esistono gia' utenti
    $users = Invoke-RestMethod "$apiBase/auth/users" -ErrorAction Stop
    if ($users.Count -eq 0) {
        $adminPin  = "1234"
        Invoke-RestMethod "$apiBase/auth/users" -Method Post `
            -ContentType "application/json" `
            -Body "{`"name`":`"Admin`",`"pin`":`"$adminPin`",`"role`":`"admin`"}" | Out-Null
        Write-Ok "Utente Admin creato — PIN: $adminPin (cambialo dal backoffice)"
    } else {
        Write-Ok "Utenti gia' presenti nel database ($($users.Count))"
    }
} catch {
    Write-Warn "Impossibile creare utente admin automaticamente: $_"
    Write-Warn "Crealo manualmente da backoffice dopo il primo avvio."
}

# ─── 14. Collegamento desktop ────────────────────────────────────────────────
Write-Step "Collegamento sul Desktop"
try {
    $desktopPub = "$env:PUBLIC\Desktop"
    $desktopUsr = "$env:USERPROFILE\Desktop"
    $desktop = if (Test-Path $desktopPub) { $desktopPub } else { $desktopUsr }
    $enc = [System.Text.UTF8Encoding]::new($false)

    # Collegamento browser — file .url (formato testo semplice, funziona sempre)
    $urlContent = "[InternetShortcut]`r`nURL=http://localhost:$PORT`r`nIconIndex=0`r`n"
    [System.IO.File]::WriteAllText("$desktop\HelloTable POS.url", $urlContent, $enc)

    # Collegamento gestione servizio e aggiornamento
    $shell = New-Object -ComObject WScript.Shell

    $svcLink = $shell.CreateShortcut("$desktop\HelloTable Servizio.lnk")
    $svcLink.TargetPath = "services.msc"
    $svcLink.Description = "Gestione servizio HelloTable"
    $svcLink.Save()

    # Collegamento aggiornamento — esegue update.ps1 come amministratore
    $updLink = $shell.CreateShortcut("$desktop\HelloTable Aggiorna.lnk")
    $updLink.TargetPath = "powershell.exe"
    $updLink.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$INSTALL_DIR\scripts\windows\update.ps1`""
    $updLink.WorkingDirectory = $INSTALL_DIR
    $updLink.Description = "Aggiorna HelloTable da GitHub e riavvia il server"
    $updLink.Save()

    # Imposta "Esegui come amministratore" sul collegamento aggiornamento
    $bytes = [System.IO.File]::ReadAllBytes("$desktop\HelloTable Aggiorna.lnk")
    $bytes[0x15] = $bytes[0x15] -bor 0x20
    [System.IO.File]::WriteAllBytes("$desktop\HelloTable Aggiorna.lnk", $bytes)

    Write-Ok "Collegamento 'HelloTable POS' e 'HelloTable Aggiorna' creati sul Desktop"
} catch {
    Write-Warn "Collegamento desktop non creato: $_"
}

# ─── 15. Riepilogo ──────────────────────────────────────────────────────────
$localIPs = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -ne "127.0.0.1" } |
    Select-Object -ExpandProperty IPAddress

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║        HelloTable installato con successo!           ║" -ForegroundColor Green
Write-Host "  ╠══════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  Da questo PC:  http://localhost:$PORT               ║" -ForegroundColor Yellow
foreach ($ip in $localIPs) {
Write-Host "  ║  Da tablet/tel: http://${ip}:${PORT}                 ║" -ForegroundColor Yellow
}
Write-Host "  ╠══════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  PIN admin iniziale: 1234  (cambialo dal backoffice) ║" -ForegroundColor Cyan
Write-Host "  ║  Servizio: avvio automatico con Windows              ║" -ForegroundColor Green
Write-Host "  ║  Database: PostgreSQL locale (porta 5432)            ║" -ForegroundColor Green
Write-Host "  ║  Log: $INSTALL_DIR\logs\                             ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Read-Host "Premi Invio per chiudere"
