#requires -Version 5.1
<#
.SYNOPSIS
    Setup chiavi Ed25519 per firma updater Live SLIDE CENTER Desktop.
    Sprint D7 — wizard idempotente per primo setup signing.

.DESCRIPTION
    Esegue in ordine:
      1. Verifica Tauri CLI (cargo tauri) installato; se manca, lo installa.
      2. Genera coppia di chiavi Ed25519 in `~/.tauri/slidecenter-desktop.key`
         (skippa se esiste, a meno di -Force).
      3. Crea `apps/desktop/src-tauri/tauri.signing.json` da example.json
         con `pubkey` reale incollato dal file `.pub`.
      4. (Opzionale) Setta i secrets su GitHub repo `live-software11/live-slide-center`:
            - TAURI_SIGNING_PRIVATE_KEY
            - TAURI_SIGNING_PRIVATE_KEY_PASSWORD
         Richiede `gh auth status` su account live-software11 e `-PushSecrets`.

    Tutti gli step sono idempotenti: rieseguibile senza danni.

.PARAMETER Force
    Sovrascrivi chiave privata se gia' esistente (PERICOLOSO: invalida tutte
    le release precedenti firmate).

.PARAMETER PushSecrets
    Esegue `gh secret set` per caricare la chiave privata su GitHub Actions.
    Senza questo flag, lo script stampa solo i comandi da eseguire manualmente.

.PARAMETER Password
    Password della chiave privata. Se non passata, prompta in modo sicuro.
    Lasciare vuoto se non si vuole password (sconsigliato in produzione).

.EXAMPLE
    .\scripts\setup-signing-keys.ps1
    Setup interattivo: genera chiavi se mancanti, crea signing.json, mostra
    comandi gh secret set.

.EXAMPLE
    .\scripts\setup-signing-keys.ps1 -PushSecrets
    Setup completo + carica i secrets su GitHub (richiede gh CLI loggato su
    live-software11).
#>

[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$PushSecrets,
    [SecureString]$Password
)

$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok    { param([string]$M) Write-Host "  [OK]   $M" -ForegroundColor Green }
function Write-Warn  { param([string]$M) Write-Host "  [WARN] $M" -ForegroundColor Yellow }
function Write-Fail  { param([string]$M) Write-Host "  [FAIL] $M" -ForegroundColor Red }
function Write-Info  { param([string]$M) Write-Host "  [INFO] $M" -ForegroundColor Gray }

# ── Path setup ─────────────────────────────────────────────────────────────
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir  = Split-Path -Parent $scriptDir
$repoRoot    = Resolve-Path (Join-Path $desktopDir "..\..") | Select-Object -ExpandProperty Path
$keyDir      = Join-Path $env:USERPROFILE ".tauri"
$keyFile     = Join-Path $keyDir "slidecenter-desktop.key"
$pubFile     = "$keyFile.pub"
$signingExample = Join-Path $desktopDir "src-tauri\tauri.signing.example.json"
$signingFile    = Join-Path $desktopDir "src-tauri\tauri.signing.json"

Write-Section "Live SLIDE CENTER Desktop — Setup Signing Keys (Sprint D7)"
Write-Info "Key file:        $keyFile"
Write-Info "Pub file:        $pubFile"
Write-Info "Signing config:  $signingFile"
Write-Info "Repo root:       $repoRoot"

# ── Step 1: Verifica/installa tauri-cli ────────────────────────────────────
Write-Section "1. Verifica Tauri CLI"
$tauriCmd = Get-Command "cargo" -ErrorAction SilentlyContinue
if (-not $tauriCmd) {
    Write-Fail "cargo non trovato in PATH. Installa Rust da https://rustup.rs"
    exit 1
}

$tauriInstalled = $false
try {
    $cargoOut = & cargo tauri --version 2>&1 | Out-String
    if ($cargoOut -match "tauri-cli (\d+)") {
        Write-Ok "Tauri CLI v$($Matches[1]) installato"
        $tauriInstalled = $true
    }
}
catch { }

if (-not $tauriInstalled) {
    Write-Warn "Tauri CLI non installato. Installazione in corso (richiede ~5 min)..."
    & cargo install tauri-cli --version "^2.0" --locked
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Installazione tauri-cli fallita"
        exit 1
    }
    Write-Ok "Tauri CLI installato"
}

# ── Step 2: Genera coppia chiavi ───────────────────────────────────────────
Write-Section "2. Genera coppia chiavi Ed25519"
if (-not (Test-Path $keyDir)) {
    New-Item -ItemType Directory -Path $keyDir -Force | Out-Null
    Write-Ok "Cartella creata: $keyDir"
}

if ((Test-Path $keyFile) -and -not $Force) {
    Write-Ok "Chiave gia' esistente: $keyFile (skip)"
    Write-Info "Per rigenerare usa -Force (PERICOLOSO: invalida release precedenti)"
}
else {
    if (Test-Path $keyFile) {
        Write-Warn "Force attivo: backup vecchia chiave..."
        $backup = "$keyFile.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item $keyFile $backup -Force
        Write-Ok "Backup: $backup"
    }
    Write-Info "Genero coppia chiavi..."
    Write-Info "Verra' chiesta una password: usala per build locali, lasciala vuota solo per CI."
    & cargo tauri signer generate -w $keyFile
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Generazione chiavi fallita"
        exit 1
    }
    if (-not (Test-Path $keyFile)) {
        Write-Fail "Chiave non creata: $keyFile"
        exit 1
    }
    Write-Ok "Chiavi generate: $keyFile + $pubFile"
}

if (-not (Test-Path $pubFile)) {
    Write-Fail "Pubkey mancante: $pubFile"
    exit 1
}

$pubKeyContent = (Get-Content $pubFile -Raw).Trim()
Write-Ok "Pubkey letta ($($pubKeyContent.Length) char)"

# ── Step 3: Crea/aggiorna tauri.signing.json ────────────────────────────────
Write-Section "3. Configura tauri.signing.json"
if (-not (Test-Path $signingExample)) {
    Write-Fail "Template mancante: $signingExample"
    exit 1
}

$exampleContent = Get-Content $signingExample -Raw
$realContent = $exampleContent -replace 'REPLACE_WITH_CONTENT_OF_YOUR_TAURI_KEY_PUB_FILE', $pubKeyContent
Set-Content -Path $signingFile -Value $realContent -Encoding UTF8 -NoNewline
Write-Ok "Scritto: $signingFile"

# Verifica che non contenga piu' placeholder
$check = Get-Content $signingFile -Raw
if ($check -match "REPLACE_WITH_") {
    Write-Fail "Placeholder ancora presente in $signingFile (verifica example.json)"
    exit 1
}
Write-Ok "Placeholder rimossi correttamente"

# ── Step 4: GitHub secrets ─────────────────────────────────────────────────
Write-Section "4. GitHub Actions secrets"

$ghAvailable = $false
try {
    $ghOut = & gh auth status 2>&1 | Out-String
    if ($ghOut -match "Logged in to github\.com.*as\s+(\S+)") {
        $currentUser = $Matches[1]
        if ($currentUser -eq "live-software11") {
            Write-Ok "Account GitHub: $currentUser (corretto)"
            $ghAvailable = $true
        }
        else {
            Write-Warn "Account GitHub corrente: $currentUser - Atteso: live-software11"
            Write-Info "Esegui: gh auth switch --user live-software11"
        }
    }
}
catch {
    Write-Warn "gh CLI non disponibile o non loggato"
}

if ($PushSecrets -and $ghAvailable) {
    Write-Info "Push secrets su GitHub repo live-software11/live-slide-center..."

    $keyContent = Get-Content $keyFile -Raw
    $tmpKey = New-TemporaryFile
    Set-Content -Path $tmpKey -Value $keyContent -Encoding UTF8 -NoNewline
    try {
        & gh secret set TAURI_SIGNING_PRIVATE_KEY --repo live-software11/live-slide-center < $tmpKey
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Secret TAURI_SIGNING_PRIVATE_KEY caricato"
        }
        else {
            Write-Fail "gh secret set fallito (exit $LASTEXITCODE)"
        }
    }
    finally {
        Remove-Item $tmpKey -Force
    }

    if ($Password) {
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
        $plainPwd = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        try {
            & gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo live-software11/live-slide-center --body $plainPwd
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD caricato"
            }
        }
        finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
    else {
        Write-Warn "Password non fornita: ricordati di settare TAURI_SIGNING_PRIVATE_KEY_PASSWORD manualmente se la chiave ne ha una."
    }
}
else {
    Write-Info "Push secrets disabilitato. Comandi manuali da eseguire:"
    Write-Host ""
    Write-Host "    # 1. Switch GitHub account se necessario" -ForegroundColor DarkGray
    Write-Host "    gh auth switch --user live-software11" -ForegroundColor White
    Write-Host ""
    Write-Host "    # 2. Carica la chiave privata come secret" -ForegroundColor DarkGray
    Write-Host "    gh secret set TAURI_SIGNING_PRIVATE_KEY --repo live-software11/live-slide-center < `"$keyFile`"" -ForegroundColor White
    Write-Host ""
    Write-Host "    # 3. (Se hai messo password) Carica anche la password" -ForegroundColor DarkGray
    Write-Host "    gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo live-software11/live-slide-center" -ForegroundColor White
    Write-Host ""
    Write-Info "Riesegui con -PushSecrets per automatizzare gli step 2 e 3"
}

# ── Step 5: Riepilogo ──────────────────────────────────────────────────────
Write-Section "DONE — riepilogo"
Write-Host ""
Write-Host "  Pubkey (gia' configurata in tauri.signing.json):" -ForegroundColor White
Write-Host "  $pubKeyContent" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Backup chiave privata in luogo sicuro:" -ForegroundColor Yellow
Write-Host "    - 1Password / Bitwarden vault" -ForegroundColor Gray
Write-Host "    - USB cifrata in cassaforte" -ForegroundColor Gray
Write-Host "    - SE PERSA: tutti i client esistenti devono reinstallare l'app firmata con nuova chiave" -ForegroundColor Gray
Write-Host ""
Write-Host "  Prossimo step: build firmata locale o tag release CI" -ForegroundColor Cyan
Write-Host "    .\scripts\release.ps1 -Signed             # build locale firmata" -ForegroundColor White
Write-Host "    .\scripts\tag-release.ps1 -Version 0.1.0  # crea tag e triggera CI" -ForegroundColor White
Write-Host ""
