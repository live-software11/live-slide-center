#requires -Version 5.1
<#
.SYNOPSIS
    Wrapper PowerShell per release Live SLIDE CENTER Desktop.

.DESCRIPTION
    Sprint P5 (GUIDA_OPERATIVA_v3 §4.H). Wrapper umano-friendly per `pnpm --filter @slidecenter/desktop release:nsis`.
    Aggiunge:
      - check account GitHub corretto (live-software11)
      - prompt conferma prima di build firmata (consuma chiavi)
      - copia automatica artifact in cartella release/ con SHA-256
      - genera CHANGELOG-snippet.md pronto per GitHub Releases

.PARAMETER Signed
    Se presente, builda con signing config attivo (richiede src-tauri/tauri.signing.json + env vars).

.PARAMETER Debug
    Build debug (no optimizations, piu' veloce per smoke test).

.PARAMETER SkipPrereqs
    Skippa il check pre-build (Node, pnpm, Rust, Tauri CLI, WebView2).

.EXAMPLE
    .\scripts\release.ps1
    Build NSIS unsigned (sviluppo).

.EXAMPLE
    .\scripts\release.ps1 -Signed
    Build NSIS firmata + updater artifacts (richiede chiavi).
#>

[CmdletBinding()]
param(
    [switch]$Signed,
    [switch]$Debug,
    [switch]$SkipPrereqs
)

$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  [WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
}

# Trova root del repo (questo script vive in apps/desktop/scripts/)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir
$repoRoot = Resolve-Path (Join-Path $desktopDir "..\..") | Select-Object -ExpandProperty Path
$releaseDir = Join-Path $desktopDir "release"

Push-Location $desktopDir
try {
    Write-Section "Live SLIDE CENTER Desktop - Release script"
    Write-Host "  desktop dir: $desktopDir"
    Write-Host "  repo root:   $repoRoot"
    Write-Host "  signed:      $Signed"
    Write-Host "  debug:       $Debug"

    Write-Section "1. Account GitHub check"
    try {
        $ghStatus = & gh auth status 2>&1 | Out-String
        if ($ghStatus -match "Logged in to github\.com.*as\s+(\S+)") {
            $currentUser = $Matches[1]
            if ($currentUser -eq "live-software11") {
                Write-Ok "Account GitHub: $currentUser (corretto)"
            }
            else {
                Write-Warn "Account GitHub corrente: $currentUser - Atteso: live-software11"
                $confirm = Read-Host "Continuare comunque? (y/N)"
                if ($confirm -ne 'y') { exit 1 }
            }
        }
        else {
            Write-Warn "Impossibile parsare gh auth status. Continuo."
        }
    }
    catch {
        Write-Warn "gh CLI non disponibile o non loggato. Skip check account."
    }

    Write-Section "2. Build args"
    $args = @("--filter", "@slidecenter/desktop", "release:nsis", "--")
    if ($SkipPrereqs) { $args += "--skip-prereqs" }
    if ($Debug) { $args += "--debug" }
    if ($Signed) {
        $signingConfigPath = Join-Path $desktopDir "src-tauri\tauri.signing.json"
        if (-not (Test-Path $signingConfigPath)) {
            Write-Fail "Signing config non trovato: $signingConfigPath"
            Write-Host "  Crealo da template:" -ForegroundColor Yellow
            Write-Host "    Copy-Item src-tauri\tauri.signing.example.json src-tauri\tauri.signing.json" -ForegroundColor Yellow
            Write-Host "  Poi vedi apps/desktop/UPDATER_SETUP.md per generare le chiavi." -ForegroundColor Yellow
            exit 1
        }
        if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
            Write-Fail "TAURI_SIGNING_PRIVATE_KEY non settata in environment."
            Write-Host "  Esempio:" -ForegroundColor Yellow
            Write-Host "    `$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw `"$env:USERPROFILE\.tauri\slidecenter-desktop.key`"" -ForegroundColor Yellow
            exit 1
        }
        $args += "--signing-config"
        $args += "src-tauri/tauri.signing.json"
        Write-Ok "Signing config: $signingConfigPath"
        Write-Ok "TAURI_SIGNING_PRIVATE_KEY: presente ($($env:TAURI_SIGNING_PRIVATE_KEY.Length) chars)"
    }
    else {
        Write-Warn "Build UNSIGNED. Per release pubblica usare -Signed."
    }

    Write-Section "3. Esecuzione pnpm $($args -join ' ')"
    Push-Location $repoRoot
    try {
        & pnpm @args
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "pnpm release:nsis fallito (exit $LASTEXITCODE)"
            exit $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
    }

    Write-Section "4. Copia artifact in release/"
    if (-not (Test-Path $releaseDir)) {
        New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    }

    $bundleDir = Join-Path $desktopDir "src-tauri\target\release\bundle\nsis"
    if (-not (Test-Path $bundleDir)) {
        Write-Fail "Bundle NSIS non trovato in $bundleDir"
        exit 1
    }

    $installer = Get-ChildItem -Path $bundleDir -Filter "*-setup.exe" | Select-Object -First 1
    if (-not $installer) {
        Write-Fail "Installer .exe non trovato"
        exit 1
    }

    $destInstaller = Join-Path $releaseDir $installer.Name
    Copy-Item $installer.FullName $destInstaller -Force
    Write-Ok "Installer: $destInstaller"

    $sig = Get-ChildItem -Path $bundleDir -Filter "*-setup.exe.sig" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($sig) {
        $destSig = Join-Path $releaseDir $sig.Name
        Copy-Item $sig.FullName $destSig -Force
        Write-Ok "Signature: $destSig"
    }
    elseif ($Signed) {
        Write-Warn "Build firmata ma .sig non trovato (controllare tauri.signing.json)"
    }

    Write-Section "5. SHA-256 + size"
    $hash = Get-FileHash -Path $destInstaller -Algorithm SHA256
    $sizeMB = [math]::Round((Get-Item $destInstaller).Length / 1MB, 2)
    Write-Host "  SHA-256: $($hash.Hash)" -ForegroundColor White
    Write-Host "  Size:    $sizeMB MB" -ForegroundColor White

    Write-Section "6. CHANGELOG snippet"
    $verLine = (Get-Content (Join-Path $desktopDir "src-tauri\Cargo.toml") | Select-String '^version\s*=\s*"(.+)"').Matches[0].Groups[1].Value
    $changelogPath = Join-Path $releaseDir "CHANGELOG-v$verLine.md"
    $changelogContent = @"
# Live SLIDE CENTER Desktop v$verLine

**Build date:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
**Installer:** ``$($installer.Name)``
**SHA-256:** ``$($hash.Hash)``
**Size:** $sizeMB MB
**Signed:** $(if ($Signed) { 'Yes' } else { 'No (interno)' })

## Changes

- TODO: aggiungere note rilascio.

## Install

1. Scaricare ``$($installer.Name)``.
2. Eseguire (su Windows 10/11 x64).
3. Al primo avvio scegliere ruolo: ``admin`` (postazione regista) o ``sala`` (player).

## Verifica integrita

``````powershell
Get-FileHash -Path '$($installer.Name)' -Algorithm SHA256
# Deve combaciare con: $($hash.Hash)
``````
"@
    Set-Content -Path $changelogPath -Value $changelogContent -Encoding UTF8
    Write-Ok "CHANGELOG: $changelogPath"

    Write-Section "DONE"
    Write-Host "  Cartella release: $releaseDir" -ForegroundColor Green
    Write-Host "  Pronto per:" -ForegroundColor Green
    Write-Host "    - Distribuzione interna (zip della cartella)" -ForegroundColor Gray
    Write-Host "    - Upload su GitHub Releases (vedi apps/desktop/UPDATER_SETUP.md step 6)" -ForegroundColor Gray
}
finally {
    Pop-Location
}
