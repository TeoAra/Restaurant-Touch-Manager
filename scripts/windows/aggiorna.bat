@echo off
setlocal
title HelloTable - Aggiornamento
chcp 65001 >nul 2>&1

:: ── Elevazione automatica ────────────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Richiesta elevazione Amministratore...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: ── Esecuzione script PowerShell ─────────────────────────────────────────────
echo.
echo   HelloTable ^| Aggiornamento in corso...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
set EXIT_CODE=%errorlevel%

if %EXIT_CODE% neq 0 (
    echo.
    echo   [ERRORE] Lo script si e' interrotto con codice %EXIT_CODE%
    echo   Controlla i messaggi sopra per capire cosa e' andato storto.
    echo.
    pause
    exit /b %EXIT_CODE%
)

exit /b 0
