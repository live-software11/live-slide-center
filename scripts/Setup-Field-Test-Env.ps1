#Requires -Version 5.1
<#
.SYNOPSIS
  Crea (o aggiorna) l'ambiente di field test su Supabase: 2 tenant + 4 utenti per
  tenant + 1 evento demo "Field Test Aprile 2026" con 2 sale, 3 sessioni, 2 speaker.

.DESCRIPTION
  Idempotente: puoi eseguirlo piu' volte senza creare duplicati. Verifica esistenza
  prima di INSERT, non aggiorna nulla che esiste gia' (no overwrite di password,
  niente reset di stato evento). Per resettare un utente serve cancellarlo manualmente
  da Supabase dashboard.

  Output: stampa a video le credenziali generate (password 16 char) — copia/incolla
  in `docs/FIELD_TEST_CHECKLIST.md` sezione "Setup pre-test" prima di procedere.

  RICHIEDE 2 variabili d'ambiente (SET prima di lanciare lo script):
    - SUPABASE_URL                  https://<project_ref>.supabase.co (oppure VITE_SUPABASE_URL)
    - SUPABASE_SERVICE_ROLE_KEY     service role key (Supabase dashboard → Settings → API)

.EXAMPLE
  $env:SUPABASE_URL = "https://abcd1234.supabase.co"
  $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ...."
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Setup-Field-Test-Env.ps1

.NOTES
  - Account Supabase: live.software11@gmail.com (progetto live-slide-center).
  - SAFE: usa service_role solo lato locale, NON committare la key.
  - Le password generate sono mostrate UNA SOLA VOLTA. Salvale subito.
  - Per pulire l'ambiente field test: vedi `Cleanup-Field-Test-Env.ps1` (TODO se servira').
#>

[CmdletBinding()]
param(
  [switch]$Quiet  # se presente, sopprime banner ASCII e dettagli verbose
)

$ErrorActionPreference = 'Stop'

# ─────────────────────────────────────────────────────────────────────────────
# 1) BANNER + ENV CHECK
# ─────────────────────────────────────────────────────────────────────────────

if (-not $Quiet) {
  Write-Host ''
  Write-Host '======================================================================' -ForegroundColor Cyan
  Write-Host '  Setup-Field-Test-Env.ps1 — Live SLIDE CENTER' -ForegroundColor Cyan
  Write-Host '  2 tenant + 8 utenti + 1 evento demo + 2 sale + 3 sessioni + 2 speaker' -ForegroundColor Cyan
  Write-Host '  Idempotente: puoi rilanciarlo senza creare duplicati.' -ForegroundColor Cyan
  Write-Host '======================================================================' -ForegroundColor Cyan
  Write-Host ''
}

$SupabaseUrl = $env:SUPABASE_URL
if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) {
  $SupabaseUrl = $env:VITE_SUPABASE_URL
}
$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY

if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) {
  Write-Host '[X] SUPABASE_URL (o VITE_SUPABASE_URL) NON impostato.' -ForegroundColor Red
  Write-Host '    Esegui prima: $env:SUPABASE_URL = "https://<project>.supabase.co"' -ForegroundColor Yellow
  exit 1
}

if ([string]::IsNullOrWhiteSpace($ServiceRoleKey)) {
  Write-Host '[X] SUPABASE_SERVICE_ROLE_KEY NON impostato.' -ForegroundColor Red
  Write-Host '    Recupera da Supabase dashboard → Settings → API → service_role key.' -ForegroundColor Yellow
  Write-Host '    Esegui: $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ...."' -ForegroundColor Yellow
  exit 1
}

$SupabaseUrl = $SupabaseUrl.TrimEnd('/')

if (-not $Quiet) {
  Write-Host ('[OK] SUPABASE_URL: ' + $SupabaseUrl) -ForegroundColor Green
  Write-Host ('[OK] SUPABASE_SERVICE_ROLE_KEY: presente (' + $ServiceRoleKey.Length + ' char)') -ForegroundColor Green
  Write-Host ''
}

# ─────────────────────────────────────────────────────────────────────────────
# 2) HELPER FUNCTIONS — REST PostgREST + Auth Admin API
# ─────────────────────────────────────────────────────────────────────────────

$RestHeaders = @{
  'apikey'        = $ServiceRoleKey
  'Authorization' = 'Bearer ' + $ServiceRoleKey
  'Content-Type'  = 'application/json'
  'Accept'        = 'application/json'
  'Prefer'        = 'return=representation'
}

function Invoke-Sb-Get {
  param(
    [Parameter(Mandatory)] [string]$Path,   # es. /rest/v1/tenants?slug=eq.foo
    [hashtable]$Headers = $null
  )
  $h = if ($Headers) { $Headers } else { $RestHeaders }
  $url = $SupabaseUrl + $Path
  try {
    return Invoke-RestMethod -Method Get -Uri $url -Headers $h
  } catch {
    Write-Host ('[X] GET ' + $url + ' — ' + $_.Exception.Message) -ForegroundColor Red
    throw
  }
}

function Invoke-Sb-Post {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [Parameter(Mandatory)] [object]$Body,
    [hashtable]$Headers = $null
  )
  $h = if ($Headers) { $Headers } else { $RestHeaders }
  $url = $SupabaseUrl + $Path
  $json = $Body | ConvertTo-Json -Depth 10 -Compress
  try {
    return Invoke-RestMethod -Method Post -Uri $url -Headers $h -Body $json
  } catch {
    $resp = $null
    try {
      $resp = $_.ErrorDetails.Message
    } catch { }
    Write-Host ('[X] POST ' + $url + ' failed:') -ForegroundColor Red
    Write-Host ('    Body: ' + $json) -ForegroundColor DarkGray
    if ($resp) { Write-Host ('    Response: ' + $resp) -ForegroundColor DarkGray }
    throw
  }
}

function Invoke-Sb-Patch {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [Parameter(Mandatory)] [object]$Body,
    [hashtable]$Headers = $null
  )
  $h = if ($Headers) { $Headers } else { $RestHeaders }
  $url = $SupabaseUrl + $Path
  $json = $Body | ConvertTo-Json -Depth 10 -Compress
  try {
    return Invoke-RestMethod -Method Patch -Uri $url -Headers $h -Body $json
  } catch {
    Write-Host ('[X] PATCH ' + $url + ' — ' + $_.Exception.Message) -ForegroundColor Red
    throw
  }
}

function New-RandomPassword {
  param([int]$Length = 16)
  $charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%'
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] $Length
  $rng.GetBytes($bytes)
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $Length; $i++) {
    [void]$sb.Append($charset[$bytes[$i] % $charset.Length])
  }
  return $sb.ToString()
}

# ─────────────────────────────────────────────────────────────────────────────
# 3) ENSURE-TENANT — INSERT idempotente su public.tenants
# ─────────────────────────────────────────────────────────────────────────────

function Ensure-Tenant {
  param(
    [Parameter(Mandatory)] [string]$Slug,
    [Parameter(Mandatory)] [string]$Name,
    [string]$Plan = 'pro',
    [long]$StorageLimitBytes = 1099511627776,  # 1 TB (default Pro)
    [int]$MaxEventsPerMonth = 20,
    [int]$MaxRoomsPerEvent = 20
  )

  $existing = Invoke-Sb-Get ('/rest/v1/tenants?slug=eq.' + [uri]::EscapeDataString($Slug) + '&select=id,name,plan')
  if ($existing -and $existing.Count -gt 0) {
    Write-Host ('  [=] Tenant esistente: ' + $Slug + ' (id=' + $existing[0].id + ')') -ForegroundColor DarkGray
    return $existing[0].id
  }

  $body = @{
    name                  = $Name
    slug                  = $Slug
    plan                  = $Plan
    storage_limit_bytes   = $StorageLimitBytes
    max_events_per_month  = $MaxEventsPerMonth
    max_rooms_per_event   = $MaxRoomsPerEvent
  }
  $created = Invoke-Sb-Post '/rest/v1/tenants' $body
  Write-Host ('  [+] Tenant creato: ' + $Slug + ' (id=' + $created[0].id + ')') -ForegroundColor Green
  return $created[0].id
}

# ─────────────────────────────────────────────────────────────────────────────
# 4) ENSURE-USER — Auth Admin API + propagazione public.users via trigger
# ─────────────────────────────────────────────────────────────────────────────
#
# Strategia (vedi 20260417100000_team_invitations.sql):
# - app_metadata.tenant_id + app_metadata.role IN ('admin','coordinator','tech')
#   → trigger handle_new_user() crea la riga public.users dentro il tenant esistente.
# - Per super_admin: lo creiamo come 'admin' linkato al tenant Alpha (per avere riga
#   in public.users), poi facciamo UPDATE auth.users.app_metadata.role = 'super_admin'
#   in modo che il JWT lo elevi a super_admin (RLS is_super_admin() lo vede).

function Ensure-AuthUser {
  param(
    [Parameter(Mandatory)] [string]$Email,
    [Parameter(Mandatory)] [string]$Password,
    [Parameter(Mandatory)] [string]$FullName,
    [Parameter(Mandatory)] [string]$TenantId,
    [Parameter(Mandatory)] [ValidateSet('admin','coordinator','tech','super_admin')] [string]$Role
  )

  # Auth Admin API: GET /auth/v1/admin/users — list/search non standard. Usiamo filter via REST diretta.
  # La REST Admin di Supabase non espone filter su email senza paginazione, quindi
  # verifichiamo lato DB su auth.users (tabella riservata) usando service_role.

  $existing = Invoke-Sb-Get (
    '/rest/v1/users?email=eq.' + [uri]::EscapeDataString($Email) + '&select=id,tenant_id,role'
  )
  if ($existing -and $existing.Count -gt 0) {
    Write-Host ('    [=] Utente esistente: ' + $Email + ' (id=' + $existing[0].id + ', role=' + $existing[0].role + ')') -ForegroundColor DarkGray
    return $existing[0].id
  }

  # Crea via Auth Admin API. Per super_admin, prima settiamo role='admin' linkato al
  # tenant, poi promuoviamo a super_admin nel JWT con un UPDATE successivo.
  $appRoleForTrigger = if ($Role -eq 'super_admin') { 'admin' } else { $Role }

  $authBody = @{
    email         = $Email
    password      = $Password
    email_confirm = $true
    user_metadata = @{
      full_name = $FullName
    }
    app_metadata  = @{
      tenant_id = $TenantId
      role      = $appRoleForTrigger
    }
  }
  $authHeaders = @{
    'apikey'        = $ServiceRoleKey
    'Authorization' = 'Bearer ' + $ServiceRoleKey
    'Content-Type'  = 'application/json'
  }
  $created = Invoke-Sb-Post '/auth/v1/admin/users' $authBody $authHeaders
  $authUserId = $created.id
  Write-Host ('    [+] Auth user creato: ' + $Email + ' (id=' + $authUserId + ', role-trigger=' + $appRoleForTrigger + ')') -ForegroundColor Green

  # Se super_admin, promuovi nel JWT (NON nella tabella public.users perche' la enum
  # public.user_role NON contiene 'super_admin'; super_admin vive solo nel JWT).
  if ($Role -eq 'super_admin') {
    $promoteBody = @{
      app_metadata = @{
        tenant_id = $TenantId
        role      = 'super_admin'
      }
    }
    $promoteUrl = '/auth/v1/admin/users/' + $authUserId
    Invoke-RestMethod -Method Put -Uri ($SupabaseUrl + $promoteUrl) -Headers $authHeaders -Body ($promoteBody | ConvertTo-Json -Depth 5 -Compress) | Out-Null
    Write-Host ('    [^] Promosso a super_admin (JWT app_metadata.role)') -ForegroundColor Magenta
  }

  return $authUserId
}

# ─────────────────────────────────────────────────────────────────────────────
# 5) ENSURE-EVENT / ROOM / SESSION / SPEAKER — INSERT idempotenti
# ─────────────────────────────────────────────────────────────────────────────

function Ensure-Event {
  param(
    [Parameter(Mandatory)] [string]$TenantId,
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$StartDate,  # YYYY-MM-DD
    [Parameter(Mandatory)] [string]$EndDate,
    [string]$Status = 'active',
    [string]$Location = 'Field Test Venue',
    [string]$Venue = 'Sala convegni demo'
  )
  $existing = Invoke-Sb-Get (
    '/rest/v1/events?tenant_id=eq.' + [uri]::EscapeDataString($TenantId) +
    '&name=eq.' + [uri]::EscapeDataString($Name) + '&select=id,name,status'
  )
  if ($existing -and $existing.Count -gt 0) {
    Write-Host ('    [=] Evento esistente: ' + $Name + ' (id=' + $existing[0].id + ')') -ForegroundColor DarkGray
    return $existing[0].id
  }
  $body = @{
    tenant_id  = $TenantId
    name       = $Name
    location   = $Location
    venue      = $Venue
    start_date = $StartDate
    end_date   = $EndDate
    status     = $Status
    timezone   = 'Europe/Rome'
  }
  $created = Invoke-Sb-Post '/rest/v1/events' $body
  Write-Host ('    [+] Evento creato: ' + $Name + ' (id=' + $created[0].id + ')') -ForegroundColor Green
  return $created[0].id
}

function Ensure-Room {
  param(
    [Parameter(Mandatory)] [string]$TenantId,
    [Parameter(Mandatory)] [string]$EventId,
    [Parameter(Mandatory)] [string]$Name,
    [int]$Capacity = 100,
    [string]$RoomType = 'main',
    [int]$DisplayOrder = 0
  )
  $existing = Invoke-Sb-Get (
    '/rest/v1/rooms?event_id=eq.' + [uri]::EscapeDataString($EventId) +
    '&name=eq.' + [uri]::EscapeDataString($Name) + '&select=id'
  )
  if ($existing -and $existing.Count -gt 0) {
    Write-Host ('      [=] Sala esistente: ' + $Name) -ForegroundColor DarkGray
    return $existing[0].id
  }
  $body = @{
    tenant_id     = $TenantId
    event_id      = $EventId
    name          = $Name
    capacity      = $Capacity
    room_type     = $RoomType
    display_order = $DisplayOrder
  }
  $created = Invoke-Sb-Post '/rest/v1/rooms' $body
  Write-Host ('      [+] Sala creata: ' + $Name) -ForegroundColor Green
  return $created[0].id
}

function Ensure-Session {
  param(
    [Parameter(Mandatory)] [string]$TenantId,
    [Parameter(Mandatory)] [string]$EventId,
    [Parameter(Mandatory)] [string]$RoomId,
    [Parameter(Mandatory)] [string]$Title,
    [Parameter(Mandatory)] [string]$ScheduledStart,  # ISO 8601
    [Parameter(Mandatory)] [string]$ScheduledEnd,
    [string]$SessionType = 'talk',
    [int]$DisplayOrder = 0
  )
  $existing = Invoke-Sb-Get (
    '/rest/v1/sessions?event_id=eq.' + [uri]::EscapeDataString($EventId) +
    '&title=eq.' + [uri]::EscapeDataString($Title) + '&select=id'
  )
  if ($existing -and $existing.Count -gt 0) {
    Write-Host ('        [=] Sessione esistente: ' + $Title) -ForegroundColor DarkGray
    return $existing[0].id
  }
  $body = @{
    tenant_id       = $TenantId
    event_id        = $EventId
    room_id         = $RoomId
    title           = $Title
    session_type    = $SessionType
    scheduled_start = $ScheduledStart
    scheduled_end   = $ScheduledEnd
    display_order   = $DisplayOrder
  }
  $created = Invoke-Sb-Post '/rest/v1/sessions' $body
  Write-Host ('        [+] Sessione creata: ' + $Title) -ForegroundColor Green
  return $created[0].id
}

function Ensure-Speaker {
  param(
    [Parameter(Mandatory)] [string]$TenantId,
    [Parameter(Mandatory)] [string]$EventId,
    [Parameter(Mandatory)] [string]$SessionId,
    [Parameter(Mandatory)] [string]$FullName,
    [Parameter(Mandatory)] [string]$Email,
    [string]$Company = 'Field Test Co',
    [string]$JobTitle = 'Speaker'
  )
  $existing = Invoke-Sb-Get (
    '/rest/v1/speakers?session_id=eq.' + [uri]::EscapeDataString($SessionId) +
    '&email=eq.' + [uri]::EscapeDataString($Email) + '&select=id'
  )
  if ($existing -and $existing.Count -gt 0) {
    Write-Host ('          [=] Speaker esistente: ' + $FullName) -ForegroundColor DarkGray
    return $existing[0].id
  }
  $body = @{
    tenant_id   = $TenantId
    event_id    = $EventId
    session_id  = $SessionId
    full_name   = $FullName
    email       = $Email
    company     = $Company
    job_title   = $JobTitle
  }
  $created = Invoke-Sb-Post '/rest/v1/speakers' $body
  Write-Host ('          [+] Speaker creato: ' + $FullName) -ForegroundColor Green
  return $created[0].id
}

# ─────────────────────────────────────────────────────────────────────────────
# 6) DEFINIZIONE AMBIENTE FIELD TEST — 2 tenant + utenti + evento
# ─────────────────────────────────────────────────────────────────────────────

# Date evento demo (forzate ad aprile 2026, modificabili).
$EventStart      = '2026-04-25'
$EventEnd        = '2026-04-26'
$Day1Morning     = '2026-04-25T09:30:00+02:00'
$Day1MorningEnd  = '2026-04-25T10:30:00+02:00'
$Day1Talk        = '2026-04-25T11:00:00+02:00'
$Day1TalkEnd     = '2026-04-25T12:00:00+02:00'
$Day2Workshop    = '2026-04-26T10:00:00+02:00'
$Day2WorkshopEnd = '2026-04-26T12:00:00+02:00'

$Tenants = @(
  @{
    Slug = 'field-test-alpha'
    Name = 'Field Test Alpha'
    Users = @(
      @{ EmailLocal = 'super.alpha';  Role = 'super_admin'; FullName = 'Super Admin Alpha' }
      @{ EmailLocal = 'admin.alpha';  Role = 'admin';       FullName = 'Admin Alpha' }
      @{ EmailLocal = 'coord.alpha';  Role = 'coordinator'; FullName = 'Coord Alpha' }
      @{ EmailLocal = 'tech.alpha';   Role = 'tech';        FullName = 'Tech Alpha' }
    )
    EventName = 'Field Test Aprile 2026 — Alpha'
  },
  @{
    Slug = 'field-test-beta'
    Name = 'Field Test Beta'
    Users = @(
      @{ EmailLocal = 'super.beta';   Role = 'super_admin'; FullName = 'Super Admin Beta' }
      @{ EmailLocal = 'admin.beta';   Role = 'admin';       FullName = 'Admin Beta' }
      @{ EmailLocal = 'coord.beta';   Role = 'coordinator'; FullName = 'Coord Beta' }
      @{ EmailLocal = 'tech.beta';    Role = 'tech';        FullName = 'Tech Beta' }
    )
    EventName = 'Field Test Aprile 2026 — Beta'
  }
)

# Catalogo credenziali generate (output finale per Andrea).
$Credentials = New-Object System.Collections.ArrayList

# ─────────────────────────────────────────────────────────────────────────────
# 7) ESECUZIONE — loop sui tenant
# ─────────────────────────────────────────────────────────────────────────────

foreach ($tenant in $Tenants) {
  Write-Host ''
  Write-Host ('[*] Tenant: ' + $tenant.Slug) -ForegroundColor Cyan

  $tenantId = Ensure-Tenant -Slug $tenant.Slug -Name $tenant.Name `
    -Plan 'pro' -StorageLimitBytes 1099511627776 `
    -MaxEventsPerMonth 20 -MaxRoomsPerEvent 20

  # Utenti
  Write-Host ('  Utenti:')
  foreach ($u in $tenant.Users) {
    $email = $u.EmailLocal + '@fieldtest.local'
    $password = New-RandomPassword 16
    $authUserId = Ensure-AuthUser -Email $email -Password $password `
      -FullName $u.FullName -TenantId $tenantId -Role $u.Role
    [void]$Credentials.Add([pscustomobject]@{
      Tenant   = $tenant.Slug
      Email    = $email
      Role     = $u.Role
      Password = $password
      AuthId   = $authUserId
    })
  }

  # Evento + sale + sessioni + speakers
  Write-Host ('  Evento demo:')
  $eventId = Ensure-Event -TenantId $tenantId -Name $tenant.EventName `
    -StartDate $EventStart -EndDate $EventEnd -Status 'active' `
    -Location 'Field Test Venue' -Venue 'Sala convegni demo'

  $roomA = Ensure-Room -TenantId $tenantId -EventId $eventId `
    -Name 'Sala A — Auditorium' -Capacity 200 -RoomType 'main' -DisplayOrder 0
  $roomB = Ensure-Room -TenantId $tenantId -EventId $eventId `
    -Name 'Sala B — Workshop' -Capacity 60 -RoomType 'breakout' -DisplayOrder 1

  $session1 = Ensure-Session -TenantId $tenantId -EventId $eventId -RoomId $roomA `
    -Title 'Apertura — Sala A' -ScheduledStart $Day1Morning -ScheduledEnd $Day1MorningEnd `
    -SessionType 'ceremony' -DisplayOrder 0
  $session2 = Ensure-Session -TenantId $tenantId -EventId $eventId -RoomId $roomA `
    -Title 'Talk principale — Sala A' -ScheduledStart $Day1Talk -ScheduledEnd $Day1TalkEnd `
    -SessionType 'talk' -DisplayOrder 1
  $session3 = Ensure-Session -TenantId $tenantId -EventId $eventId -RoomId $roomB `
    -Title 'Workshop pratico — Sala B' -ScheduledStart $Day2Workshop -ScheduledEnd $Day2WorkshopEnd `
    -SessionType 'workshop' -DisplayOrder 0

  Ensure-Speaker -TenantId $tenantId -EventId $eventId -SessionId $session2 `
    -FullName 'Mario Rossi' -Email ('mario.rossi+' + $tenant.Slug + '@fieldtest.local') `
    -Company 'Demo SpA' -JobTitle 'Keynote speaker' | Out-Null
  Ensure-Speaker -TenantId $tenantId -EventId $eventId -SessionId $session3 `
    -FullName 'Anna Bianchi' -Email ('anna.bianchi+' + $tenant.Slug + '@fieldtest.local') `
    -Company 'Workshop Lab' -JobTitle 'Trainer' | Out-Null
}

# ─────────────────────────────────────────────────────────────────────────────
# 8) OUTPUT FINALE — credenziali + prossimi passi
# ─────────────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '======================================================================' -ForegroundColor Green
Write-Host '  Setup completato.' -ForegroundColor Green
Write-Host '======================================================================' -ForegroundColor Green
Write-Host ''

if ($Credentials.Count -gt 0) {
  Write-Host 'CREDENZIALI GENERATE (salva subito — non saranno mostrate di nuovo):' -ForegroundColor Yellow
  Write-Host ''
  $Credentials | Format-Table -AutoSize Tenant, Email, Role, Password
  Write-Host ''
}
else {
  Write-Host 'Nessun nuovo utente creato (tutti gia esistenti).' -ForegroundColor DarkGray
  Write-Host 'Le password originali sono ottenibili solo da Supabase dashboard (reset password).' -ForegroundColor DarkGray
  Write-Host ''
}

Write-Host 'PROSSIMI PASSI:' -ForegroundColor Cyan
Write-Host '  1. Copia le credenziali in docs/FIELD_TEST_CHECKLIST.md sezione "Setup pre-test".'
Write-Host '  2. Verifica login per almeno 1 utente per ruolo:'
Write-Host '     - https://app.liveslidecenter.com/login'
Write-Host '     - email/password generata sopra'
Write-Host '  3. Esegui i test T1-T19 seguendo docs/FIELD_TEST_CHECKLIST.md.'
Write-Host '  4. In caso di problemi durante l''evento: docs/DISASTER_RECOVERY.md.'
Write-Host ''
Write-Host 'CLEANUP (quando hai finito il field test):' -ForegroundColor DarkGray
Write-Host '  - Cancella tenant da Supabase dashboard → tutti i dati derivati spariscono via CASCADE.'
Write-Host '  - Tenant da cancellare: field-test-alpha, field-test-beta.'
Write-Host '  - Auth users persistono: cancellali manualmente da Authentication → Users.'
Write-Host ''
