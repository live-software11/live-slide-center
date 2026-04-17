# Live SLIDE CENTER - Conversione manuali operatore MD -> PDF
# Sprint 5 - script da eseguire prima di ogni release per il cliente.
#
# Requisiti (una volta sola sul PC):
#   1. Installare pandoc:
#        winget install --id JohnMacFarlane.Pandoc -e
#      Oppure: https://pandoc.org/installing.html
#   2. Installare un PDF engine (consigliato MiKTeX per xelatex su Windows):
#        winget install --id MiKTeX.MiKTeX -e
#      Al primo run xelatex chiede installazione pacchetti mancanti: confermare "Yes" per "Always".
#
# Output: 3 file PDF in docs\Manuali\pdf\
#   - Manuale_Distribuzione.pdf
#   - Manuale_Installazione_Local_Agent.pdf
#   - Manuale_Installazione_Room_Agent.pdf
#
# Esecuzione:
#   pwsh -File docs\Manuali\build-pdf.ps1
# Oppure dalla cartella docs\Manuali\:
#   .\build-pdf.ps1

[CmdletBinding()]
param(
    [string]$PdfEngine = 'xelatex',
    [string]$OutputDir = (Join-Path $PSScriptRoot 'pdf')
)

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '====================================================================='
Write-Host '  Live SLIDE CENTER - Build manuali operatore PDF (Sprint 5)'
Write-Host '====================================================================='
Write-Host ''

# 1) Verifica pandoc nel PATH
$pandoc = Get-Command pandoc -ErrorAction SilentlyContinue
if (-not $pandoc) {
    Write-Host 'ERRORE: pandoc non trovato nel PATH.' -ForegroundColor Red
    Write-Host '  Installa con: winget install --id JohnMacFarlane.Pandoc -e'
    Write-Host '  Oppure: https://pandoc.org/installing.html'
    exit 1
}
Write-Host "OK pandoc: $($pandoc.Source)" -ForegroundColor Green

# 2) Verifica PDF engine (xelatex via MiKTeX/TeXLive, o wkhtmltopdf in fallback)
$engineCmd = Get-Command $PdfEngine -ErrorAction SilentlyContinue
if (-not $engineCmd) {
    if ($PdfEngine -eq 'xelatex') {
        Write-Host 'AVVISO: xelatex non trovato, provo wkhtmltopdf (qualita inferiore ma rapido).' -ForegroundColor Yellow
        $engineCmd = Get-Command wkhtmltopdf -ErrorAction SilentlyContinue
        if ($engineCmd) {
            $PdfEngine = 'wkhtmltopdf'
        }
    }
}
if (-not $engineCmd) {
    Write-Host "ERRORE: PDF engine '$PdfEngine' non trovato." -ForegroundColor Red
    Write-Host '  Installa MiKTeX:    winget install --id MiKTeX.MiKTeX -e'
    Write-Host '  Oppure wkhtmltopdf: winget install --id wkhtmltopdf.wkhtmltopdf -e'
    exit 1
}
Write-Host "OK PDF engine: $PdfEngine ($($engineCmd.Source))" -ForegroundColor Green
Write-Host ''

# 3) Crea cartella output
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Host "Creata cartella output: $OutputDir"
}

# 4) Lista manuali da convertire
$manuals = @(
    @{ Source = 'Manuale_Distribuzione.md';             Title = 'Live SLIDE CENTER - Manuale Distribuzione (interno)' },
    @{ Source = 'Manuale_Installazione_Local_Agent.md'; Title = 'Live SLIDE CENTER - Installazione Local Agent (mini-PC regia)' },
    @{ Source = 'Manuale_Installazione_Room_Agent.md';  Title = 'Live SLIDE CENTER - Installazione Room Agent (PC sala)' }
)

$manualsDir = $PSScriptRoot
$success = 0
$failed = 0

foreach ($m in $manuals) {
    $sourcePath = Join-Path $manualsDir $m.Source
    if (-not (Test-Path $sourcePath)) {
        Write-Host "  [SKIP] Sorgente mancante: $($m.Source)" -ForegroundColor Yellow
        continue
    }

    $outName = [System.IO.Path]::ChangeExtension($m.Source, '.pdf')
    $outPath = Join-Path $OutputDir $outName

    Write-Host "  [...]  $($m.Source) -> $outName" -NoNewline
    try {
        # Argomenti pandoc:
        # -V geometry: margini 25mm
        # -V fontsize: 11pt
        # -V mainfont: DejaVu Serif (universale, supporta caratteri italiani/accentati)
        # --toc: indice automatico (i manuali sono lunghi)
        # --metadata title: titolo PDF visibile in lettore
        $pandocArgs = @(
            $sourcePath
            '-o', $outPath
            "--pdf-engine=$PdfEngine"
            '-V', 'geometry:margin=25mm'
            '-V', 'fontsize=11pt'
            '--toc'
            '--metadata', "title=$($m.Title)"
            '--metadata', 'author=Andrea Rizzari Live Software'
            '--metadata', "date=$(Get-Date -Format 'yyyy-MM-dd')"
        )
        if ($PdfEngine -eq 'xelatex') {
            # mainfont funziona solo con xelatex/lualatex
            $pandocArgs += @('-V', 'mainfont=DejaVu Serif', '-V', 'monofont=DejaVu Sans Mono')
        }

        & pandoc @pandocArgs 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "pandoc exit code $LASTEXITCODE"
        }

        $size = (Get-Item $outPath).Length
        $sizeKb = [math]::Round($size / 1024, 1)
        Write-Host "`r  [OK]   $($m.Source) -> $outName ($sizeKb KB)         " -ForegroundColor Green
        $success++
    } catch {
        Write-Host "`r  [!!]   $($m.Source) -> ERRORE: $_                    " -ForegroundColor Red
        $failed++
    }
}

Write-Host ''
Write-Host '====================================================================='
if ($failed -eq 0) {
    Write-Host "  BUILD PDF COMPLETATO - $success file generati in $OutputDir" -ForegroundColor Green
    Write-Host '====================================================================='
    Write-Host ''
    Write-Host '  Pronti per consegna al cliente:'
    Get-ChildItem $OutputDir -Filter '*.pdf' | ForEach-Object {
        $sizeKb = [math]::Round($_.Length / 1024, 1)
        Write-Host "    - $($_.Name) ($sizeKb KB)"
    }
    exit 0
} else {
    Write-Host "  BUILD PDF PARZIALE - $success ok / $failed errori" -ForegroundColor Yellow
    Write-Host '====================================================================='
    exit 1
}
