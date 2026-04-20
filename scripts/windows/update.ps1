<#
.SYNOPSIS
    HelloTable - Aggiornamento da git e ricostruzione
    Lanciato da aggiorna.bat (gia elevato come Amministratore)
#>

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$INSTALL_DIR = "C:\HelloTable"
$SVC_NAME    = "HelloTable"
$PORT        = 8080

function Write-Step($msg) { Write-Host "" ; Write-Host ">>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [ATTENZIONE] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) {
    Write-Host ""
    Write-Host "[ERRORE] $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "Premi Invio per chiudere"
    exit 1
}

try {

    # Carica .env nel processo corrente
    $envFile = "$INSTALL_DIR\.env"
    if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile) {
            if ($line -match "^([^#=\s][^=]*)=(.+)$") {
                [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
            }
        }
    } else {
        Write-Fail "File .env non trovato in $INSTALL_DIR. Reinstalla HelloTable."
    }

    Write-Host ""
    Write-Host "  HelloTable - Aggiornamento" -ForegroundColor DarkCyan
    Write-Host "  Cartella: $INSTALL_DIR" -ForegroundColor DarkGray

    # 1. Ferma servizio
    Write-Step "1/6  Stop servizio Windows"
    Stop-Service $SVC_NAME -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    Write-Ok "Servizio fermato (o non era attivo)"

    # 2. Git pull
    Write-Step "2/6  Download aggiornamenti"
    Push-Location $INSTALL_DIR

    if (-not (Test-Path "$INSTALL_DIR\.git")) {
        Write-Warn "Repository git non trovato - inizializzazione..."
        git init
        if ($LASTEXITCODE -ne 0) { Write-Fail "git init fallito. Git e installato e nel PATH?" }
        git remote add origin https://github.com/TeoAra/Restaurant-Touch-Manager.git
    }

    git fetch --all
    if ($LASTEXITCODE -ne 0) { Write-Fail "git fetch fallito. Controlla la connessione internet." }
    git reset --hard origin/main
    if ($LASTEXITCODE -ne 0) { Write-Fail "git reset fallito." }
    Write-Ok "Codice aggiornato: $(git log --oneline -1)"

    # 3. Dipendenze
    Write-Step "3/6  Aggiornamento dipendenze"
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Write-Fail "pnpm install fallito." }
    Write-Ok "Dipendenze ok"

    # 4. Build
    Write-Step "4a/6  Build API server"
    pnpm --filter @workspace/api-server run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "Build API server fallita." }
    Write-Ok "API server compilato"

    Write-Step "4b/6  Build frontend"
    $env:PORT      = $PORT
    $env:BASE_PATH = "/"
    pnpm --filter @workspace/pos-restaurant run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "Build frontend fallita." }
    Write-Ok "Frontend compilato"

    # 5. Migrazione DB
    Write-Step "5/6  Sincronizzazione schema database"
    pnpm --filter @workspace/db run push-force
    if ($LASTEXITCODE -ne 0) { Write-Fail "Migrazione database fallita." }
    Write-Ok "Schema aggiornato"

    Pop-Location

    # 6. Riavvia servizio
    Write-Step "6/6  Avvio servizio"
    Start-Service $SVC_NAME
    Start-Sleep 2
    $status = (Get-Service $SVC_NAME).Status
    Write-Ok "Servizio: $status"

    $localIPs = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -ne "127.0.0.1" } |
        Select-Object -ExpandProperty IPAddress)

    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "   HelloTable aggiornato con successo!" -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "   Da questo PC:  http://localhost:$PORT" -ForegroundColor Yellow
    foreach ($ip in $localIPs) {
        Write-Host "   Da tablet/tel: http://${ip}:${PORT}" -ForegroundColor Yellow
    }
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    Read-Host "Premi Invio per chiudere"

} catch {
    Write-Host ""
    Write-Host "[ERRORE IMPREVISTO]" -ForegroundColor Red
    Write-Host $_.ToString() -ForegroundColor Red
    Write-Host ""
    Read-Host "Premi Invio per chiudere"
    exit 1
}
