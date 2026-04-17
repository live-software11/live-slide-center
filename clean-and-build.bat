@echo off
chcp 65001 >nul
title Live SLIDE CENTER - Clean and Build (Local Agent + Room Agent)
setlocal EnableDelayedExpansion

echo.
echo =====================================================================
echo   LIVE SLIDE CENTER - Clean ^& Build
echo   Genera installer NSIS + portable ZIP per i due Agent Tauri
echo =====================================================================
echo.

pushd "%~dp0"
if errorlevel 1 (
    echo ERRORE: cartella progetto non trovata.
    pause
    exit /b 1
)

REM ============================================================
REM   1/6 - Verifica toolchain
REM ============================================================
echo [1/6] Verifica toolchain (Node, pnpm, npm, cargo, cargo-tauri)...

where node >nul 2>nul
if errorlevel 1 (
    echo ERRORE: Node.js non trovato nel PATH.
    echo   Installa da https://nodejs.org/ ^(LTS^) e riapri la finestra.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo ERRORE: npm non trovato nel PATH.
    pause
    exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
    echo ERRORE: pnpm non trovato nel PATH.
    echo   Installa con: npm install -g pnpm
    pause
    exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo ERRORE: cargo non trovato nel PATH.
    echo   Installa Rust da https://rustup.rs/ poi riapri la finestra.
    pause
    exit /b 1
)

cargo tauri --version >nul 2>nul
if errorlevel 1 (
    echo ERRORE: cargo-tauri ^(Tauri CLI^) non installato.
    echo   Installa con: cargo install tauri-cli --version "^2.0" --locked
    pause
    exit /b 1
)
echo OK toolchain.
echo.

REM ============================================================
REM   2/6 - Install dipendenze pnpm workspace
REM ============================================================
echo [2/6] Installazione dipendenze pnpm workspace...
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo AVVISO: pnpm install --frozen-lockfile fallito, riprovo senza --frozen-lockfile...
    call pnpm install
    if errorlevel 1 (
        echo ERRORE: pnpm install fallito.
        pause
        exit /b 1
    )
)
echo OK pnpm install.
echo.

REM ============================================================
REM   3/6 - Pulizia cartella release\
REM ============================================================
echo [3/6] Pulizia release\ ...
if exist "release" (
    rmdir /s /q "release"
    if errorlevel 1 (
        echo ERRORE: impossibile rimuovere release\
        pause
        exit /b 1
    )
)
mkdir "release"
echo OK pulizia.
echo.

REM ============================================================
REM   4/6 - Build Local Agent (NSIS + portable ZIP)
REM ============================================================
echo [4/6] Build Local Agent ^(NSIS installer + portable ZIP^)...
echo       ^(prima compilazione: 5-15 minuti, successive: 1-3 minuti^)
pushd "apps\agent"
call npm run release:full
if errorlevel 1 (
    echo ERRORE: build Local Agent fallita.
    popd
    pause
    exit /b 1
)
popd
echo OK Local Agent.
echo.

REM ============================================================
REM   5/6 - Build Room Agent (NSIS + portable ZIP)
REM ============================================================
echo [5/6] Build Room Agent ^(NSIS installer + portable ZIP^)...
pushd "apps\room-agent"
call npm run release:full
if errorlevel 1 (
    echo ERRORE: build Room Agent fallita.
    popd
    pause
    exit /b 1
)
popd
echo OK Room Agent.
echo.

REM ============================================================
REM   6/6 - Verifica output
REM ============================================================
echo [6/6] Verifica artefatti generati...
echo.

set "AGENT_DIR=release\live-slide-center-agent"
set "ROOM_DIR=release\live-slide-center-room-agent"

set "ALL_OK=1"
call :check_file "%AGENT_DIR%\Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe"
call :check_file "%AGENT_DIR%\Live-SLIDE-CENTER-Agent-Portable-0.1.0.zip"
call :check_file "%AGENT_DIR%\SHA256SUMS.txt"
call :check_file "%ROOM_DIR%\Live-SLIDE-CENTER-Room-Agent-Setup-0.1.0.exe"
call :check_file "%ROOM_DIR%\Live-SLIDE-CENTER-Room-Agent-Portable-0.1.0.zip"
call :check_file "%ROOM_DIR%\SHA256SUMS.txt"

echo.
if "%ALL_OK%"=="1" (
    echo =====================================================================
    echo   BUILD COMPLETATO - tutti gli artefatti generati con successo
    echo =====================================================================
    echo.
    echo   Local Agent  -^> %AGENT_DIR%\
    echo   Room Agent   -^> %ROOM_DIR%\
    echo.
    echo   Distribuzione consigliata:
    echo     - Mini-PC regia:    Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe
    echo     - PC sala:          Live-SLIDE-CENTER-Room-Agent-Setup-0.1.0.exe
    echo.
    echo   Verifica integrita: confronta gli hash con SHA256SUMS.txt
) else (
    echo =====================================================================
    echo   ERRORE - alcuni artefatti sono mancanti, vedere log sopra
    echo =====================================================================
)
echo.
popd
pause
endlocal
exit /b 0

REM ============================================================
REM   Helper: verifica esistenza file
REM ============================================================
:check_file
if exist "%~1" (
    echo   [OK]  %~1
) else (
    echo   [!!]  MANCANTE: %~1
    set "ALL_OK=0"
)
exit /b 0
