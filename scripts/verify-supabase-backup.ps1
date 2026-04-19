#Requires -Version 5.1
<#
.SYNOPSIS
  Verifica giornaliera dei backup Supabase via Management API.

.DESCRIPTION
  Sprint W A3 — chiama https://api.supabase.com/v1/projects/{ref}/database/backups,
  controlla che esista almeno un backup completato nelle ultime 24h e produce un
  report JSON in `Documents/SlideCenterBackupReports/<YYYY-MM-DD>.json`.

  Exit code:
    0  = backup recente OK
    1  = nessun backup recente (oltre soglia ore o lista vuota)
    2  = errore configurazione (token/ref mancanti o env-var assente)
    3  = errore HTTP / parsing risposta

.PARAMETER ProjectRef
  Project ref Supabase (es. cdjxxxkrhgdkcpkkozdl). Default: env var
  SUPABASE_PROJECT_REF.

.PARAMETER AccessToken
  Personal Access Token Supabase (sbp_...). Default: env var
  SUPABASE_ACCESS_TOKEN. In CI passare come secret.

.PARAMETER MaxHours
  Soglia massima accettata in ore tra "ora corrente" e timestamp del backup
  piu' recente. Default 26 (24h + buffer 2h per scheduling shift).

.PARAMETER ReportDir
  Cartella dove salvare il report JSON. Default
  `$env:USERPROFILE\Documents\SlideCenterBackupReports` (in CI puo' essere
  passata `--report-dir ./backup-reports` per capture artifact).

.EXAMPLE
  pwsh ./scripts/verify-supabase-backup.ps1
  Esegue la verifica con env var locali.

.EXAMPLE
  pwsh ./scripts/verify-supabase-backup.ps1 -ProjectRef cdjxxxkrhgdkcpkkozdl `
       -AccessToken $env:SUPA_TOKEN -MaxHours 26 -ReportDir ./backup-reports
  Esegue in pipeline GitHub Actions.
#>

[CmdletBinding()]
param(
  [string]$ProjectRef = $env:SUPABASE_PROJECT_REF,
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [int]$MaxHours = 26,
  [string]$ReportDir = (Join-Path $env:USERPROFILE 'Documents\SlideCenterBackupReports')
)

$ErrorActionPreference = 'Stop'

function Write-Section {
  param([string]$Text)
  Write-Host ''
  Write-Host ('--- ' + $Text + ' ---') -ForegroundColor Cyan
}

# ── 1. Validate config ──────────────────────────────────────────────────────
Write-Section 'Verifica configurazione'

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  Write-Host '[X] ProjectRef mancante (passare -ProjectRef o impostare SUPABASE_PROJECT_REF)' -ForegroundColor Red
  exit 2
}
if ([string]::IsNullOrWhiteSpace($AccessToken)) {
  Write-Host '[X] AccessToken mancante (passare -AccessToken o impostare SUPABASE_ACCESS_TOKEN)' -ForegroundColor Red
  exit 2
}

Write-Host ('[OK] ProjectRef = ' + $ProjectRef)
Write-Host ('[OK] AccessToken length = ' + $AccessToken.Length)
Write-Host ('[OK] MaxHours = ' + $MaxHours)
Write-Host ('[OK] ReportDir = ' + $ReportDir)

# ── 2. Call Management API ──────────────────────────────────────────────────
Write-Section 'Chiamata Supabase Management API'

$apiUrl = "https://api.supabase.com/v1/projects/$ProjectRef/database/backups"
$headers = @{
  Authorization = "Bearer $AccessToken"
  Accept        = 'application/json'
}

try {
  $response = Invoke-RestMethod -Uri $apiUrl -Method Get -Headers $headers -TimeoutSec 30
}
catch {
  Write-Host ('[X] Errore HTTP: ' + $_.Exception.Message) -ForegroundColor Red
  exit 3
}

if ($null -eq $response) {
  Write-Host '[X] Risposta vuota dalla Management API' -ForegroundColor Red
  exit 3
}

# Risposta tipica:
#   { "backups": [ { "inserted_at": "2026-04-18T01:23:45.000Z", "status": "COMPLETED", ... } ], ... }
$backups = $response.backups
if ($null -eq $backups) {
  # Endpoint a volte ritorna direttamente array
  $backups = $response
}
if ($null -eq $backups -or $backups.Count -eq 0) {
  Write-Host '[X] Lista backup vuota (Free plan? PITR non attivo?)' -ForegroundColor Red
  $resultPayload = @{
    status         = 'fail'
    reason         = 'no_backups_found'
    project_ref    = $ProjectRef
    checked_at     = (Get-Date).ToUniversalTime().ToString('o')
    max_hours      = $MaxHours
    most_recent_at = $null
    backups_count  = 0
  }
}
else {
  $sorted = $backups | Sort-Object -Property inserted_at -Descending
  $latest = $sorted | Select-Object -First 1
  $latestTs = $null
  try {
    $latestTs = [datetime]::Parse($latest.inserted_at).ToUniversalTime()
  }
  catch {
    Write-Host ('[X] Impossibile parsare timestamp: ' + $latest.inserted_at) -ForegroundColor Red
    exit 3
  }
  $hoursAgo = ((Get-Date).ToUniversalTime() - $latestTs).TotalHours
  $hoursAgoRounded = [math]::Round($hoursAgo, 2)

  if ($hoursAgo -gt $MaxHours) {
    Write-Host ("[X] Backup piu' recente troppo vecchio: " + $hoursAgoRounded + 'h fa (soglia ' + $MaxHours + 'h)') -ForegroundColor Red
    $resultPayload = @{
      status         = 'fail'
      reason         = 'backup_too_old'
      project_ref    = $ProjectRef
      checked_at     = (Get-Date).ToUniversalTime().ToString('o')
      max_hours      = $MaxHours
      most_recent_at = $latestTs.ToString('o')
      hours_ago      = $hoursAgoRounded
      backups_count  = $backups.Count
    }
  }
  else {
    Write-Host ('[OK] Backup recente: ' + $hoursAgoRounded + 'h fa (totale backup ' + $backups.Count + ')') -ForegroundColor Green
    $resultPayload = @{
      status         = 'ok'
      project_ref    = $ProjectRef
      checked_at     = (Get-Date).ToUniversalTime().ToString('o')
      max_hours      = $MaxHours
      most_recent_at = $latestTs.ToString('o')
      hours_ago      = $hoursAgoRounded
      backups_count  = $backups.Count
    }
  }
}

# ── 3. Save JSON report ─────────────────────────────────────────────────────
Write-Section 'Salvataggio report'

if (-not (Test-Path $ReportDir)) {
  New-Item -Path $ReportDir -ItemType Directory -Force | Out-Null
}
$today = (Get-Date).ToString('yyyy-MM-dd')
$reportPath = Join-Path $ReportDir ($today + '.json')
$resultPayload | ConvertTo-Json -Depth 4 | Set-Content -Path $reportPath -Encoding UTF8
Write-Host ('[OK] Report salvato in ' + $reportPath)

# ── 4. Exit ─────────────────────────────────────────────────────────────────
if ($resultPayload.status -ne 'ok') {
  exit 1
}
exit 0
