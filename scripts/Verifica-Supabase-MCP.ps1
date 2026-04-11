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
}

if ([string]::IsNullOrWhiteSpace($ref)) {
  Write-Host '[--] SUPABASE_PROJECT_REF: opzionale, non impostato' -ForegroundColor DarkGray
}
else {
  Write-Host ('[OK] SUPABASE_PROJECT_REF: ' + $ref) -ForegroundColor Green
}

Write-Host ''
Write-Host 'File Cursor MCP globale:' -ForegroundColor DarkGray
Write-Host ($env:USERPROFILE + '\.cursor\mcp.json') -ForegroundColor White
Write-Host ''
Write-Host "Se il token è OK ma Cursor non vede il MCP: chiudi Cursor del tutto e riapri." -ForegroundColor Yellow
Write-Host ''
