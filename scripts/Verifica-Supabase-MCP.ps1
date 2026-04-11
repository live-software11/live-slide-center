#Requires -Version 5.1
<#
.SYNOPSIS
  Controlla se le variabili per il MCP Supabase in Cursor sono impostate.

  Esegui: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Verifica-Supabase-MCP.ps1
#>

$token = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
$ref = [Environment]::GetEnvironmentVariable('SUPABASE_PROJECT_REF', 'User')

Write-Host ''
Write-Host 'Verifica configurazione Supabase MCP (variabili UTENTE Windows)' -ForegroundColor Cyan
Write-Host ''

if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host '[X] SUPABASE_ACCESS_TOKEN: NON impostato' -ForegroundColor Red
  Write-Host '    Esegui: pnpm run setup:supabase-mcp' -ForegroundColor Yellow
}
else {
  Write-Host ('[OK] SUPABASE_ACCESS_TOKEN: presente (' + $token.Length + ' caratteri)') -ForegroundColor Green
  # I PAT Supabase sono stringhe lunghe (spesso prefisso sbp_). Un solo carattere = quasi sempre incolla sbagliata.
  if ($token.Length -lt 30) {
    Write-Host '[!] ATTENZIONE: il valore sembra troppo corto per un PAT Supabase.' -ForegroundColor Yellow
    Write-Host '    Rigenera il token in dashboard, poi: pnpm run setup:supabase-mcp (incolla tutto il valore).' -ForegroundColor Yellow
  }
}

if ([string]::IsNullOrWhiteSpace($ref)) {
  Write-Host '[--] SUPABASE_PROJECT_REF: opzionale, non impostato' -ForegroundColor DarkGray
}
else {
  $refTrim = $ref.Trim()
  if ($refTrim -match '^[a-z0-9]{15,30}$') {
    Write-Host ('[OK] SUPABASE_PROJECT_REF: ' + $refTrim) -ForegroundColor Green
  }
  else {
    Write-Host ('[OK] SUPABASE_PROJECT_REF: presente (' + $refTrim.Length + ' caratteri), verifica che sia il Reference ID del progetto') -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'File Cursor MCP globale:' -ForegroundColor DarkGray
Write-Host ($env:USERPROFILE + '\.cursor\mcp.json') -ForegroundColor White
Write-Host ''
Write-Host 'Se il token e a posto ma Cursor non vede il MCP: chiudi Cursor del tutto e riapri.' -ForegroundColor Yellow
Write-Host ''
