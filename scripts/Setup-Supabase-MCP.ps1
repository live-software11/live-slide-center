#Requires -Version 5.1
<#
.SYNOPSIS
  Configura Cursor + Supabase MCP (token permanente, senza OAuth).

.DESCRIPTION
  1) Apre il browser sui token Supabase
  2) Chiede di incollare il PAT (input nascosto)
  3) Salva SUPABASE_ACCESS_TOKEN come variabile UTENTE Windows (profilo utente)
  4) Opzionale: salva SUPABASE_PROJECT_REF (Reference ID progetto)
  5) Spiega il riavvio di Cursor

  Esegui dalla root del repo:
    powershell -ExecutionPolicy Bypass -File .\scripts\Setup-Supabase-MCP.ps1
  oppure:
    pnpm run setup:supabase-mcp
#>

$ErrorActionPreference = 'Stop'

function Show-Step([string]$msg) {
  Write-Host ''
  Write-Host '=== ' -NoNewline -ForegroundColor Cyan
  Write-Host $msg -ForegroundColor Cyan
  Write-Host '===' -ForegroundColor Cyan
}

Write-Host ''
Write-Host 'Live SLIDE CENTER - Setup Supabase MCP per Cursor' -ForegroundColor Green
Write-Host 'Account: live.software11@gmail.com' -ForegroundColor DarkGray
Write-Host ''

Show-Step 'Passo 1: apriamo la pagina dei token'
Start-Process 'https://supabase.com/dashboard/account/tokens'
Write-Host 'Nel browser: accedi a Supabase, poi "Generate new token".' -ForegroundColor Yellow
Write-Host 'Dai un nome (es. Cursor MCP) e copia il valore del token (inizia spesso con sbp_).' -ForegroundColor Yellow
Write-Host ''

Show-Step 'Passo 2: incolla il token qui (non verra mostrato mentre digiti)'
$secure = Read-Host 'Token PAT Supabase' -AsSecureString
if ($null -eq $secure -or $secure.Length -eq 0) {
  Write-Host 'ERRORE: token vuoto. Riesegui lo script.' -ForegroundColor Red
  exit 1
}
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}
finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR) | Out-Null
}
if ([string]::IsNullOrWhiteSpace($plain)) {
  Write-Host 'ERRORE: token vuoto dopo la lettura.' -ForegroundColor Red
  exit 1
}

Show-Step 'Passo 3: salvo il token nelle variabili UTENTE Windows (permanente)'
try {
  [System.Environment]::SetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', $plain, 'User')
}
catch {
  Write-Host ('ERRORE: impossibile salvare il token: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
Write-Host 'OK: SUPABASE_ACCESS_TOKEN salvato (profilo utente Windows).' -ForegroundColor Green

Show-Step 'Passo 4 (facoltativo): Reference ID del progetto'
Start-Process 'https://supabase.com/dashboard/projects'
Write-Host 'Apri il progetto "live-slide-center" (o quello che usi).' -ForegroundColor Yellow
Write-Host 'Settings - General - Reference ID (stringa corta nell URL del progetto).' -ForegroundColor Yellow
Write-Host 'Premi INVIO per saltare se non lo hai sotto mano (serve per supabase link / CLI, non obbligatorio per MCP hosted).' -ForegroundColor DarkGray
$ref = Read-Host 'Reference ID (opzionale)'
if (-not [string]::IsNullOrWhiteSpace($ref)) {
  $ref = $ref.Trim()
  try {
    [System.Environment]::SetEnvironmentVariable('SUPABASE_PROJECT_REF', $ref, 'User')
    Write-Host 'OK: SUPABASE_PROJECT_REF salvato.' -ForegroundColor Green
  }
  catch {
    Write-Host ('ATTENZIONE: Reference ID non salvato: ' + $_.Exception.Message) -ForegroundColor Yellow
  }
}

Show-Step 'Verifica immediata (nuova lettura da registro utente)'
$check = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
if ([string]::IsNullOrWhiteSpace($check)) {
  Write-Host 'ATTENZIONE: il token non risulta ancora leggibile. Chiudi tutte le finestre PowerShell e riprova "Verifica" dopo un minuto.' -ForegroundColor Yellow
}
else {
  $len = $check.Length
  Write-Host "OK: token presente (lunghezza $len caratteri)." -ForegroundColor Green
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Magenta
Write-Host 'IMPORTANTE: chiudi CURSOR COMPLETAMENTE (anche icona in basso a destra)' -ForegroundColor Magenta
Write-Host 'e riaprilo. Solo cosi legge le nuove variabili.' -ForegroundColor Magenta
Write-Host '==============================================================' -ForegroundColor Magenta
Write-Host ''
Write-Host 'Dopo il riavvio: Impostazioni - Tools e MCP - controlla "supabase-hosted" (deve essere connesso).' -ForegroundColor White
Write-Host ''
pause
