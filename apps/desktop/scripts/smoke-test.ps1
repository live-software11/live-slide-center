#requires -Version 5.1
<#
.SYNOPSIS
    Smoke test pre-field-test per Live SLIDE CENTER Desktop (Sprint FT).

.DESCRIPTION
    Wrapper PowerShell user-friendly di scripts/smoke-test.mjs. Da lanciare
    SU OGNI PC (admin + sale) prima del field test della settimana 9.

    Cosa fa:
      1. Lancia smoke-test.mjs.
      2. Se trova problemi, stampa la lista dei FIX consigliati.
      3. Salva sempre un report JSON in ~\Documents\SlideCenterFieldTest\
         con nome `smoke_<COMPUTERNAME>_<timestamp>.json`.
      4. Apre la cartella in Explorer al termine (a meno di -Quiet).
      5. Exit code 0 se tutti i critici passano, 1 altrimenti.

.PARAMETER Port
    Porta del backend Rust (default 7300).

.PARAMETER SkipInstaller
    Non cerca l'installer NSIS (usalo sui PC field-test che non sono build box).

.PARAMETER Quiet
    Non apre Explorer al termine.

.EXAMPLE
    .\scripts\smoke-test.ps1
    Smoke test completo, salva report, apre cartella.

.EXAMPLE
    .\scripts\smoke-test.ps1 -SkipInstaller -Quiet
    Smoke test su PC sala (no installer check, no Explorer popup).

.NOTES
    Richiede Node 22+. Se manca, lo script lo segnala e suggerisce il fix.
#>

[CmdletBinding()]
param(
    [int]$Port = 7300,
    [switch]$SkipInstaller,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

# Risolvi la directory script (cross-Windows-PS-versione safe)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopRoot = Resolve-Path (Join-Path $ScriptDir "..")
$SmokeJs = Join-Path $ScriptDir "smoke-test.mjs"

if (-not (Test-Path $SmokeJs)) {
    Write-Host "[smoke-test] ERRORE: $SmokeJs non trovato. Reinstalla Live SLIDE CENTER Desktop." -ForegroundColor Red
    exit 1
}

# Verifica Node
$nodeVer = $null
try {
    $nodeVer = (& node --version) 2>$null
} catch {
    $nodeVer = $null
}
if (-not $nodeVer) {
    Write-Host "[smoke-test] ERRORE: Node non trovato in PATH." -ForegroundColor Red
    Write-Host "Installa Node 22+ da https://nodejs.org/it/download (LTS)" -ForegroundColor Yellow
    exit 1
}

# Cartella report
$ReportDir = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "SlideCenterFieldTest"
if (-not (Test-Path $ReportDir)) {
    New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
}

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Hostname = $env:COMPUTERNAME
if (-not $Hostname) { $Hostname = "unknown-host" }
$ReportFile = Join-Path $ReportDir ("smoke_{0}_{1}.json" -f $Hostname, $Stamp)

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host "  Live SLIDE CENTER — Smoke test field-test (Sprint FT)" -ForegroundColor Cyan
Write-Host "  PC : $Hostname" -ForegroundColor Cyan
Write-Host "  Node: $nodeVer | Backend port: $Port" -ForegroundColor Cyan
Write-Host "  Report → $ReportFile" -ForegroundColor Cyan
Write-Host "=============================================================" -ForegroundColor Cyan
Write-Host ""

# Costruisci args per smoke-test.mjs
$smokeArgs = @($SmokeJs, "--port", $Port, "--out", $ReportFile)
if ($SkipInstaller) { $smokeArgs += "--skip-installer" }

# Esegui (output testuale a console + report JSON salvato)
& node @smokeArgs
$ExitCode = $LASTEXITCODE

Write-Host ""

if ($ExitCode -eq 0) {
    Write-Host "[OK] Tutti i check critici PASSED. PC pronto per il field test." -ForegroundColor Green
    Write-Host "Report salvato in: $ReportFile" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Almeno un check critico e' fallito." -ForegroundColor Red
    Write-Host "Leggi i FIX suggeriti sopra e ripeti il test." -ForegroundColor Yellow
    Write-Host "Report salvato in: $ReportFile" -ForegroundColor Yellow
}

if (-not $Quiet) {
    Write-Host ""
    Write-Host "Apertura cartella report in Esplora risorse..." -ForegroundColor DarkGray
    try {
        Start-Process explorer.exe -ArgumentList "/select,`"$ReportFile`""
    } catch {
        # Fallback: apri solo la cartella
        try { Start-Process explorer.exe -ArgumentList $ReportDir } catch {}
    }
}

exit $ExitCode
