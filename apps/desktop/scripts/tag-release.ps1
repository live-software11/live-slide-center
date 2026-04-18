#requires -Version 5.1
<#
.SYNOPSIS
    Crea tag desktop-v<version> per Live SLIDE CENTER Desktop release CI.
    Sprint D7 — automazione tag + push.

.DESCRIPTION
    Esegue in ordine:
      1. Pre-check: working tree pulito (no modifiche non committate),
         branch corrente = main, gh CLI loggato su live-software11.
      2. Bumpa la versione in:
            - apps/desktop/package.json
            - apps/desktop/src-tauri/Cargo.toml
            - apps/desktop/src-tauri/tauri.conf.json
      3. Commit del bump version (se -CommitVersion).
      4. Crea tag annotated `desktop-v<version>` e push (se -Push).
      5. Triggera workflow GitHub Actions `Desktop Release` automatico.

.PARAMETER Version
    Versione semver da assegnare (es. "0.1.0", "0.2.5"). Obbligatorio.

.PARAMETER DryRun
    Mostra cosa farebbe senza committare/pushare. Default per safety.

.PARAMETER Push
    Esegue git push del commit e del tag. Senza, fa solo locale.

.PARAMETER CommitVersion
    Crea un commit "chore(desktop): bump version to <version>" col bump.
    Senza, lascia le modifiche staged ma non committate.

.PARAMETER SkipChecks
    Salta i pre-check (working tree pulito, branch, gh auth).
    Da usare solo per test rapidi.

.EXAMPLE
    .\scripts\tag-release.ps1 -Version 0.1.0 -DryRun
    Vede cosa cambierebbe senza modificare nulla.

.EXAMPLE
    .\scripts\tag-release.ps1 -Version 0.1.0 -CommitVersion -Push
    Bumpa, committa, taggа e pusha. Triggera CI release automatica.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [switch]$DryRun = $true,
    [switch]$Push,
    [switch]$CommitVersion,
    [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"

# Disable default DryRun se l'utente passa -DryRun:$false esplicitamente
if (-not $PSBoundParameters.ContainsKey('DryRun')) {
    $DryRun = -not ($Push -or $CommitVersion)
}

function Write-Section { param([string]$M) Write-Host ""; Write-Host "==> $M" -ForegroundColor Cyan }
function Write-Ok    { param([string]$M) Write-Host "  [OK]   $M" -ForegroundColor Green }
function Write-Warn  { param([string]$M) Write-Host "  [WARN] $M" -ForegroundColor Yellow }
function Write-Fail  { param([string]$M) Write-Host "  [FAIL] $M" -ForegroundColor Red }
function Write-Info  { param([string]$M) Write-Host "  [INFO] $M" -ForegroundColor Gray }
function Write-Action {
    param([string]$M)
    if ($DryRun) {
        Write-Host "  [DRY]  $M" -ForegroundColor Magenta
    }
    else {
        Write-Host "  [DO]   $M" -ForegroundColor White
    }
}

# Path setup
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir
$repoRoot   = Resolve-Path (Join-Path $desktopDir "..\..") | Select-Object -ExpandProperty Path
$tag = "desktop-v$Version"

Write-Section "Live SLIDE CENTER Desktop — Tag release $tag (Sprint D7)"
Write-Info "Version:   $Version"
Write-Info "Tag:       $tag"
Write-Info "Repo root: $repoRoot"
Write-Info "Mode:      $(if ($DryRun) { 'DRY-RUN (nessuna modifica reale)' } else { 'LIVE (modifiche persistenti)' })"

# ── Pre-checks ─────────────────────────────────────────────────────────────
if (-not $SkipChecks) {
    Write-Section "Pre-check"

    Push-Location $repoRoot
    try {
        # 1. git working tree pulito
        $status = & git status --porcelain 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "git status fallito"
            exit 1
        }
        if ($status) {
            Write-Fail "Working tree non pulito. Commit o stash le modifiche prima:"
            $status | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
            exit 1
        }
        Write-Ok "Working tree pulito"

        # 2. branch main
        $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
        if ($branch -ne "main") {
            Write-Fail "Branch corrente: $branch (atteso: main)"
            Write-Info "Esegui: git checkout main && git pull"
            exit 1
        }
        Write-Ok "Branch: main"

        # 3. up-to-date con origin
        & git fetch origin main --quiet 2>&1 | Out-Null
        $local  = (& git rev-parse "@").Trim()
        $remote = (& git rev-parse "@{u}" 2>&1).Trim()
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Impossibile leggere upstream. Salto check up-to-date."
        }
        elseif ($local -ne $remote) {
            Write-Fail "Branch main non allineato con origin. Esegui: git pull"
            exit 1
        }
        else {
            Write-Ok "Branch main aggiornato con origin"
        }

        # 4. tag non esiste gia'
        $existing = & git tag -l $tag 2>&1
        if ($existing -eq $tag) {
            Write-Fail "Tag $tag esiste gia' localmente. Cancellalo: git tag -d $tag"
            exit 1
        }
        Write-Ok "Tag $tag libero"

        # 5. gh CLI live-software11
        try {
            $ghOut = & gh auth status 2>&1 | Out-String
            if ($ghOut -match "Logged in to github\.com.*as\s+(\S+)") {
                $user = $Matches[1]
                if ($user -eq "live-software11") {
                    Write-Ok "GitHub: $user"
                }
                else {
                    Write-Warn "GitHub user attuale: $user (atteso: live-software11)"
                    if (-not $DryRun) {
                        $confirm = Read-Host "Continuare? (y/N)"
                        if ($confirm -ne 'y') { exit 1 }
                    }
                }
            }
        }
        catch {
            Write-Warn "gh CLI non disponibile (skip check)"
        }
    }
    finally {
        Pop-Location
    }
}

# ── Step 1: Bump version files ─────────────────────────────────────────────
Write-Section "1. Bump version a $Version"

$packageJsonPath = Join-Path $desktopDir "package.json"
$cargoTomlPath   = Join-Path $desktopDir "src-tauri\Cargo.toml"
$tauriConfPath   = Join-Path $desktopDir "src-tauri\tauri.conf.json"

# package.json
$pkg = Get-Content $packageJsonPath -Raw
$pkgNew = $pkg -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
if ($pkgNew -ne $pkg) {
    Write-Action "package.json: $($pkg | Select-String '"version":\s*"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value }) -> $Version"
    if (-not $DryRun) {
        Set-Content -Path $packageJsonPath -Value $pkgNew -Encoding UTF8 -NoNewline
    }
}
else {
    Write-Ok "package.json gia' a $Version"
}

# Cargo.toml
$cargo = Get-Content $cargoTomlPath -Raw
$cargoNew = $cargo -replace '(?m)^version\s*=\s*"[^"]+"', "version = `"$Version`""
if ($cargoNew -ne $cargo) {
    Write-Action "Cargo.toml: $($cargo | Select-String '(?m)^version\s*=\s*"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value }) -> $Version"
    if (-not $DryRun) {
        Set-Content -Path $cargoTomlPath -Value $cargoNew -Encoding UTF8 -NoNewline
    }
}
else {
    Write-Ok "Cargo.toml gia' a $Version"
}

# tauri.conf.json
$conf = Get-Content $tauriConfPath -Raw
$confNew = $conf -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
if ($confNew -ne $conf) {
    Write-Action "tauri.conf.json: $($conf | Select-String '"version":\s*"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value }) -> $Version"
    if (-not $DryRun) {
        Set-Content -Path $tauriConfPath -Value $confNew -Encoding UTF8 -NoNewline
    }
}
else {
    Write-Ok "tauri.conf.json gia' a $Version"
}

# ── Step 2: Commit (opzionale) ─────────────────────────────────────────────
if ($CommitVersion) {
    Write-Section "2. Commit del bump version"
    Push-Location $repoRoot
    try {
        $relPkg   = "apps/desktop/package.json"
        $relCargo = "apps/desktop/src-tauri/Cargo.toml"
        $relConf  = "apps/desktop/src-tauri/tauri.conf.json"

        Write-Action "git add $relPkg $relCargo $relConf"
        Write-Action "git commit -m `"chore(desktop): bump version to $Version`""
        if (-not $DryRun) {
            & git add $relPkg $relCargo $relConf
            & git commit -m "chore(desktop): bump version to $Version"
            if ($LASTEXITCODE -ne 0) {
                Write-Fail "git commit fallito"
                exit 1
            }
            Write-Ok "Commit creato"
        }
    }
    finally {
        Pop-Location
    }
}

# ── Step 3: Crea tag ───────────────────────────────────────────────────────
Write-Section "3. Crea tag $tag"
Push-Location $repoRoot
try {
    Write-Action "git tag -a $tag -m `"Live SLIDE CENTER Desktop $tag`""
    if (-not $DryRun) {
        & git tag -a $tag -m "Live SLIDE CENTER Desktop $tag"
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "git tag fallito"
            exit 1
        }
        Write-Ok "Tag $tag creato localmente"
    }

    # ── Step 4: Push (opzionale) ────────────────────────────────────────
    if ($Push) {
        Write-Section "4. Push commit + tag su origin"
        if ($CommitVersion) {
            Write-Action "git push origin main"
            if (-not $DryRun) {
                & git push origin main
                if ($LASTEXITCODE -ne 0) {
                    Write-Fail "git push origin main fallito"
                    exit 1
                }
                Write-Ok "main pushato"
            }
        }
        Write-Action "git push origin $tag"
        if (-not $DryRun) {
            & git push origin $tag
            if ($LASTEXITCODE -ne 0) {
                Write-Fail "git push tag fallito"
                exit 1
            }
            Write-Ok "Tag pushato — workflow CI Desktop Release triggerato"
        }
    }
    else {
        Write-Section "4. Push (saltato — no -Push)"
        Write-Info "Per pushare manualmente:"
        if ($CommitVersion) {
            Write-Host "    git push origin main" -ForegroundColor White
        }
        Write-Host "    git push origin $tag" -ForegroundColor White
    }
}
finally {
    Pop-Location
}

# ── Riepilogo ──────────────────────────────────────────────────────────────
Write-Section "DONE"
if ($DryRun) {
    Write-Host "  Modalita DRY-RUN: nessuna modifica persistita." -ForegroundColor Magenta
    Write-Host "  Riesegui con -DryRun:`$false (e -CommitVersion -Push) per applicare." -ForegroundColor Gray
}
else {
    Write-Host "  Tag $tag creato. Workflow CI:" -ForegroundColor Green
    Write-Host "    https://github.com/live-software11/live-slide-center/actions/workflows/desktop-release.yml" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Tempo stimato build: 15-25 min (Windows runner)." -ForegroundColor Gray
    Write-Host "  Release pubblicata in:" -ForegroundColor Green
    Write-Host "    https://github.com/live-software11/live-slide-center/releases/tag/$tag" -ForegroundColor Cyan
}
