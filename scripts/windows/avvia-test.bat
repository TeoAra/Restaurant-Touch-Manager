@echo off
REM HelloTable - Avvio rapido per test (senza servizio Windows)
REM Eseguire dalla cartella di installazione (es. C:\HelloTable)
REM Ctrl+C per fermare

cd /d C:\HelloTable

echo.
echo  HelloTable - Modalita' Test
echo  ===========================

REM Carica variabili dal .env
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set %%A=%%B
)

echo  API + Frontend su porta %PORT%
echo.

REM Mostra IP locale
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do (
    set IP=%%A
    setlocal enabledelayedexpansion
    set IP=!IP: =!
    if not "!IP!"=="127.0.0.1" (
        echo  Accedi da telefono/browser:
        echo    http://!IP!:%PORT%
    )
    endlocal
)

echo.
echo  Premi Ctrl+C per fermare il server.
echo.

node --enable-source-maps artifacts\api-server\dist\index.mjs
pause
