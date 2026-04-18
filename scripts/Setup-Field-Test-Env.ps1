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

  Le password sono DETERMINISTICHE (pattern: FieldTest!<Tenant><Role>2026) per due
  motivi: (a) Andrea le puo' ricostruire mentalmente senza copia/incolla, (b) sono
  identiche a quelle gia' provisionate via MCP Supabase il 2026-04-18 — lo script
  serve solo a ricreare l'ambiente in caso di reset Supabase o nuovo progetto.

  RICHIEDE 2 variabili d'ambiente (SET prima di lanciare lo script):
    - SUPABASE_URL                  https://<project_ref>.supabase.co (oppure VITE_SUPABASE_URL)
    - SUPABASE_SERVICE_ROLE_KEY     service role key (Supabase dashboard -> Settings -> API)

.EXAMPLE
  $env:SUPABASE_URL = "https://cdjxxxkrhgdkcpkkozdl.supabase.co"
  $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ...."
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Setup-Field-Test-Env.ps1

.NOTES
  - Account Supabase: live.software11@gmail.com (progetto live-slide-center).
  - Project ref attuale: cdjxxxkrhgdkcpkkozdl (eu-west-1).
  - SAFE: usa service_role solo lato locale, NON committare la key.
  - Pattern password: FieldTest!<Tenant><Role>2026 (es. FieldTest!AlphaAdmin2026).
  - Per pulire l'ambiente: cancella i 2 tenant da Supabase dashboard (cascade cancella tutto).
#>

[CmdletBinding()]
param(
  [switch]$Quiet  # se presente, sopprime banner e dettagli verbose
)

$ErrorActionPreference = 'Stop'

# =============================================================================
# 1) BANNER + ENV CHECK
# =============================================================================

if (-not $Quiet) {
  Write-Host ''
  Write-Host '======================================================================' -ForegroundColor Cyan
  Write-Host '  Setup-Field-Test-Env.ps1 -- Live SLIDE CENTER' -ForegroundColor Cyan
  Write-Host '  2 tenant + 8 utenti + 1 evento demo + 2 sale + 3 sessioni + 2 speaker' -ForegroundColor Cyan
  Write-Host '  Idempotente: rilancialo senza paura, non duplica nulla.' -ForegroundColor Cyan
  Write-Host '======================================================================' -ForegroundColor Cyan
  Write-Host ''
}

$SupabaseUrl = $env:SUPABASE_URL
if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) {
  $SupabaseUrl = $env:VITE_SUPABASE_URL
}
$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY

function Show-EnvHelp {
  Write-Host ''
  Write-Host 'COME RECUPERARE I VALORI VERI:' -ForegroundColor Yellow
  Write-Host '  1. Apri https://supabase.com/dashboard'
  Write-Host '  2. Login con live.software11@gmail.com'
  Write-Host '  3. Seleziona il progetto live-slide-center (ref: cdjxxxkrhgdkcpkkozdl)'
  Write-Host '  4. Sidebar: Settings (icona ingranaggio) -> API'
  Write-Host '  5. Project URL: https://cdjxxxkrhgdkcpkkozdl.supabase.co'
  Write-Host '  6. Project API keys -> service_role: click "Reveal" -> copia il JWT (inizia con eyJ, ~200 char)'
  Write-Host ''
  Write-Host 'POI ESEGUI (incolla i valori veri, NON i placeholder):' -ForegroundColor Yellow
  Write-Host '  $env:SUPABASE_URL = "https://cdjxxxkrhgdkcpkkozdl.supabase.co"'
  Write-Host '  $env:SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIs..."  # JWT lungo'
  Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Setup-Field-Test-Env.ps1'
  Write-Host ''
  Write-Host 'IMPORTANTE: la service_role key bypassa RLS. NON committarla nel repo, NON condividerla.' -ForegroundColor Red
  Write-Host ''
}

if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) {
  Write-Host '[X] SUPABASE_URL (o VITE_SUPABASE_URL) NON impostato.' -ForegroundColor Red
  Show-EnvHelp
  exit 1
}

if ([string]::IsNullOrWhiteSpace($ServiceRoleKey)) {
  Write-Host '[X] SUPABASE_SERVICE_ROLE_KEY NON impostato.' -ForegroundColor Red
  Show-EnvHelp
  exit 1
}

$SupabaseUrl = $SupabaseUrl.TrimEnd('/')

# Validazione formato URL: deve essere https://<ref>.supabase.co
$urlPattern = '^https://[a-z0-9]{15,30}\.supabase\.co$'
if ($SupabaseUrl -notmatch $urlPattern) {
  Write-Host '[X] SUPABASE_URL ha un formato non valido.' -ForegroundColor Red
  Write-Host ('    Valore ricevuto: ' + $SupabaseUrl) -ForegroundColor DarkGray
  if ($SupabaseUrl -match '<.*>') {
    Write-Host '    Hai lasciato il PLACEHOLDER letterale (<TUO_PROJECT_REF> o simile).' -ForegroundColor Yellow
    Write-Host '    Devi sostituirlo con il vero project ref di Supabase.' -ForegroundColor Yellow
  }
  else {
    Write-Host '    Formato atteso: https://<projectref>.supabase.co (15-30 char alfanumerici)' -ForegroundColor Yellow
  }
  Show-EnvHelp
  exit 1
}

# Validazione formato service_role key: JWT lungo (eyJ... > 100 char)
if ($ServiceRoleKey -notmatch '^eyJ' -or $ServiceRoleKey.Length -lt 100) {
  Write-Host '[X] SUPABASE_SERVICE_ROLE_KEY ha un formato non valido.' -ForegroundColor Red
  Write-Host ('    Lunghezza ricevuta: ' + $ServiceRoleKey.Length + ' char (atteso > 100)') -ForegroundColor DarkGray
  if ($ServiceRoleKey -match '\.\.\.\.|<.*>') {
    Write-Host '    Hai lasciato il PLACEHOLDER letterale (eyJ.... o <TUA_KEY>).' -ForegroundColor Yellow
    Write-Host '    Devi sostituirlo con la vera service_role key (JWT completo).' -ForegroundColor Yellow
  }
  else {
    Write-Host '    Formato atteso: JWT che inizia con "eyJ" e lungo circa 200+ caratteri.' -ForegroundColor Yellow
  }
  Show-EnvHelp
  exit 1
}

if (-not $Quiet) {
  Write-Host ('[OK] SUPABASE_URL: ' + $SupabaseUrl) -ForegroundColor Green
  Write-Host ('[OK] SUPABASE_SERVICE_ROLE_KEY: presente (' + $ServiceRoleKey.Length + ' char, prefisso eyJ OK)') -ForegroundColor Green
  Write-Host ''
}

# =============================================================================
# 2) HELPER FUNCTIONS -- REST PostgREST + Auth Admin API
# =============================================================================

$RestHeaders = @{
  'apikey'        = $ServiceRoleKey
  'Authorization' = 'Bearer ' + $ServiceRoleKey
  'Content-Type'  = 'application/json'
  'Accept'        = 'application/json'
  'Prefer'        = 'return=representation'
}

function Invoke-Sb-Get {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [hashtable]$Headers = $null
  )
  $h = if ($Headers) { $Headers } else { $RestHeaders }
  $url = $SupabaseUrl + $Path
  try {
    return Invoke-RestMethod -Method Get -Uri $url -Headers $h
  } catch {
    Write-Host ('[X] GET ' + $url + ' -- ' + $_.Exception.Message) -ForegroundColor Red
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
    try { $resp = $_.ErrorDetails.Message } catch { }
    Write-Host ('[X] POST ' + $url + ' failed:') -ForegroundColor Red
    Write-Host ('    Body: ' + $json) -ForegroundColor DarkGray
    if ($resp) { Write-Host ('    Response: ' + $resp) -ForegroundColor DarkGray }
    throw
  }
}

function Get-DeterministicPassword {
  # Pattern: FieldTest!<TenantPrefix><RoleSuffix>2026
  # Es: FieldTest!AlphaAdmin2026 -- 22 char, contiene maiusc/minusc/numero/symbol.
  param(
    [Parameter(Mandatory)] [ValidateSet('Alpha','Beta')] [string]$TenantPrefix,
    [Parameter(Mandatory)] [ValidateSet('Super','Admin','Coord','Tech')] [string]$RoleSuffix
  )
  return ('FieldTest!' + $TenantPrefix + $RoleSuffix + '2026')
}

# =============================================================================
# 3) ENSURE-TENANT
# =============================================================================

function Ensure-Tenant {
  param(
    [Parameter(Mandatory)] [string]$Slug,
    [Parameter(Mandatory)] [string]$Name,
    [string]$Plan = 'pro',
    [long]$StorageLimitBytes = 1099511627776,
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

# =============================================================================
# 4) ENSURE-AUTH-USER -- Auth Admin API + propagazione public.users via trigger
# =============================================================================
#
# Strategia (vedi 20260417100000_team_invitations.sql):
# - app_metadata.tenant_id + app_metadata.role IN ('admin','coordinator','tech')
#   -> trigger handle_new_user() crea la riga public.users dentro il tenant esistente.
# - Per super_admin: lo creiamo come 'admin' linkato al tenant (per avere riga in
#   public.users), poi facciamo PUT auth.users.app_metadata.role = 'super_admin'
#   in modo che il JWT lo elevi a super_admin (RLS is_super_admin() lo vede).

function Ensure-AuthUser {
  param(
    [Parameter(Mandatory)] [string]$Email,
    [Parameter(Mandatory)] [string]$Password,
    [Parameter(Mandatory)] [string]$FullName,
    [Parameter(Mandatory)] [string]$TenantId,
    [Parameter(Mandatory)] [ValidateSet('admin','coordinator','tech','super_admin')] [string]$Role
  )

  # Verifica esistenza via public.users (popolata dal trigger).
  $existing = Invoke-Sb-Get (
    '/rest/v1/users?email=eq.' + [uri]::EscapeDataString($Email) + '&select=id,tenant_id,role'
  )
  if ($existing -and $existing.Count -gt 0) {
    Write-Host ('    [=] Utente esistente: ' + $Email + ' (id=' + $existing[0].id + ', role=' + $existing[0].role + ')') -ForegroundColor DarkGray
    return $existing[0].id
  }

  # Crea via Auth Admin API. Per super_admin: trigger vuole 'admin' (la enum
  # public.user_role NON ha super_admin); poi promuoviamo nel JWT.
  $appRoleForTrigger = if ($Role -eq 'super_admin') { 'admin' } else { $Role }

  $authBody = @{
    email         = $Email
    password      = $Password
    email_confirm = $true
    user_metadata = @{ full_name = $FullName }
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

# =============================================================================
# 5) ENSURE-EVENT / ROOM / SESSION / SPEAKER
# =============================================================================

function Ensure-Event {
  param(
    [Parameter(Mandatory)] [string]$TenantId,
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$NameEn,
    [Parameter(Mandatory)] [string]$StartDate,
    [Parameter(Mandatory)] [string]$EndDate,
    [string]$Status = 'setup',
    [string]$Location = 'Roma, IT',
    [string]$Venue = 'Live Software HQ'
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
    tenant_id    = $TenantId
    name         = $Name
    name_en      = $NameEn
    location     = $Location
    venue        = $Venue
    start_date   = $StartDate
    end_date     = $EndDate
    status       = $Status
    network_mode = 'cloud'
    timezone     = 'Europe/Rome'
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
    [string]$NameEn = $null,
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
  if ($NameEn) { $body['name_en'] = $NameEn }
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
    [string]$TitleEn = $null,
    [Parameter(Mandatory)] [string]$ScheduledStart,
    [Parameter(Mandatory)] [string]$ScheduledEnd,
    [string]$SessionType = 'talk',
    [int]$DisplayOrder = 0,
    [string]$ChairName = $null
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
  if ($TitleEn)   { $body['title_en']   = $TitleEn }
  if ($ChairName) { $body['chair_name'] = $ChairName }
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
    [string]$Company = 'Live Software',
    [string]$JobTitle = 'Speaker'
  )
  $existing = Invoke-Sb-Get (
    '/rest/v1/speakers?session_id=eq.' + [uri]::EscapeDataString($SessionId) +
    '&full_name=eq.' + [uri]::EscapeDataString($FullName) + '&select=id'
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

# =============================================================================
# 6) DEFINIZIONE AMBIENTE FIELD TEST
# =============================================================================
# IMPORTANTE: i dati qui sotto devono essere ALLINEATI con quelli gia' provisionati
# via MCP Supabase (vedi docs/FIELD_TEST_CREDENTIALS.md). Se cambi nomi/date qui,
# il rilancio dello script crea nuovi record invece di trovare quelli esistenti.

$EventName     = 'Field Test Aprile 2026'
$EventNameEn   = 'Field Test April 2026'
$EventStart    = '2026-04-24'
$EventEnd      = '2026-04-25'

# Slot temporali (ISO 8601 con offset +02:00 = Europe/Rome estate)
$Day1Open      = '2026-04-24T09:00:00+02:00'
$Day1OpenEnd   = '2026-04-24T10:00:00+02:00'
$Day1Demo      = '2026-04-24T10:30:00+02:00'
$Day1DemoEnd   = '2026-04-24T12:00:00+02:00'
$Day2Close     = '2026-04-25T16:00:00+02:00'
$Day2CloseEnd  = '2026-04-25T17:00:00+02:00'

$Tenants = @(
  @{
    Slug         = 'field-test-alpha'
    Name         = 'Field Test Alpha'
    PassPrefix   = 'Alpha'
    Users = @(
      @{ EmailLocal = 'super.alpha';  Role = 'super_admin'; FullName = 'Super Admin Alpha'; PassRole = 'Super' }
      @{ EmailLocal = 'admin.alpha';  Role = 'admin';       FullName = 'Admin Alpha';       PassRole = 'Admin' }
      @{ EmailLocal = 'coord.alpha';  Role = 'coordinator'; FullName = 'Coord Alpha';       PassRole = 'Coord' }
      @{ EmailLocal = 'tech.alpha';   Role = 'tech';        FullName = 'Tech Alpha';        PassRole = 'Tech'  }
    )
  },
  @{
    Slug         = 'field-test-beta'
    Name         = 'Field Test Beta'
    PassPrefix   = 'Beta'
    Users = @(
      @{ EmailLocal = 'super.beta';   Role = 'super_admin'; FullName = 'Super Admin Beta';  PassRole = 'Super' }
      @{ EmailLocal = 'admin.beta';   Role = 'admin';       FullName = 'Admin Beta';        PassRole = 'Admin' }
      @{ EmailLocal = 'coord.beta';   Role = 'coordinator'; FullName = 'Coord Beta';        PassRole = 'Coord' }
      @{ EmailLocal = 'tech.beta';    Role = 'tech';        FullName = 'Tech Beta';         PassRole = 'Tech'  }
    )
  }
)

# Catalogo credenziali (output finale per Andrea).
$Credentials = New-Object System.Collections.ArrayList

# =============================================================================
# 7) ESECUZIONE
# =============================================================================

foreach ($tenant in $Tenants) {
  Write-Host ''
  Write-Host ('[*] Tenant: ' + $tenant.Slug) -ForegroundColor Cyan

  $tenantId = Ensure-Tenant -Slug $tenant.Slug -Name $tenant.Name `
    -Plan 'pro' -StorageLimitBytes 1099511627776 `
    -MaxEventsPerMonth 20 -MaxRoomsPerEvent 20

  Write-Host ('  Utenti:')
  foreach ($u in $tenant.Users) {
    $email    = $u.EmailLocal + '@fieldtest.local'
    $password = Get-DeterministicPassword -TenantPrefix $tenant.PassPrefix -RoleSuffix $u.PassRole
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

  Write-Host ('  Evento demo:')
  $eventId = Ensure-Event -TenantId $tenantId -Name $EventName -NameEn $EventNameEn `
    -StartDate $EventStart -EndDate $EventEnd -Status 'setup' `
    -Location 'Roma, IT' -Venue 'Live Software HQ'

  $roomPlenaria = Ensure-Room -TenantId $tenantId -EventId $eventId `
    -Name 'Sala Plenaria' -NameEn 'Plenary Room' -Capacity 300 -RoomType 'main' -DisplayOrder 0
  $roomWorkshop = Ensure-Room -TenantId $tenantId -EventId $eventId `
    -Name 'Sala Workshop' -NameEn 'Workshop Room' -Capacity 80 -RoomType 'breakout' -DisplayOrder 1

  # NB: il trattino e' em-dash U+2014 (--) per coerenza con quanto provisionato via MCP.
  $emDash      = [char]0x2014
  $titleOpenIt = 'Apertura ' + $emDash + ' Field Test 2026'
  $titleOpenEn = 'Opening ' + $emDash + ' Field Test 2026'
  $sessionOpen = Ensure-Session -TenantId $tenantId -EventId $eventId -RoomId $roomPlenaria `
    -Title $titleOpenIt -TitleEn $titleOpenEn `
    -ScheduledStart $Day1Open -ScheduledEnd $Day1OpenEnd `
    -SessionType 'ceremony' -DisplayOrder 0 -ChairName 'Andrea Rizzari'

  $sessionDemo = Ensure-Session -TenantId $tenantId -EventId $eventId -RoomId $roomWorkshop `
    -Title 'Demo Live SLIDE CENTER' -TitleEn 'Live SLIDE CENTER Demo' `
    -ScheduledStart $Day1Demo -ScheduledEnd $Day1DemoEnd `
    -SessionType 'workshop' -DisplayOrder 1

  $sessionClose = Ensure-Session -TenantId $tenantId -EventId $eventId -RoomId $roomPlenaria `
    -Title 'Chiusura e Q&A' -TitleEn 'Closing & Q&A' `
    -ScheduledStart $Day2Close -ScheduledEnd $Day2CloseEnd `
    -SessionType 'panel' -DisplayOrder 2 -ChairName 'Andrea Rizzari'

  Ensure-Speaker -TenantId $tenantId -EventId $eventId -SessionId $sessionOpen `
    -FullName 'Mario Rossi' -Email 'mario.rossi@fieldtest.local' `
    -Company 'Live Software' -JobTitle 'Founder & CTO' | Out-Null
  Ensure-Speaker -TenantId $tenantId -EventId $eventId -SessionId $sessionDemo `
    -FullName 'Anna Bianchi' -Email 'anna.bianchi@fieldtest.local' `
    -Company 'Live Software' -JobTitle 'Senior Solution Engineer' | Out-Null
}

# =============================================================================
# 8) OUTPUT FINALE
# =============================================================================

Write-Host ''
Write-Host '======================================================================' -ForegroundColor Green
Write-Host '  Setup completato.' -ForegroundColor Green
Write-Host '======================================================================' -ForegroundColor Green
Write-Host ''

if ($Credentials.Count -gt 0) {
  Write-Host 'CREDENZIALI (deterministiche, vedi anche docs/FIELD_TEST_CREDENTIALS.md):' -ForegroundColor Yellow
  Write-Host ''
  $Credentials | Format-Table -AutoSize Tenant, Email, Role, Password
  Write-Host ''
}
else {
  Write-Host 'Nessun nuovo utente creato (tutti gia esistenti).' -ForegroundColor DarkGray
  Write-Host 'Pattern password (ricostruibile a mente): FieldTest!<Tenant><Role>2026' -ForegroundColor DarkGray
  Write-Host '  Esempi: FieldTest!AlphaAdmin2026  -  FieldTest!BetaTech2026' -ForegroundColor DarkGray
  Write-Host ''
}

Write-Host 'PROSSIMI PASSI:' -ForegroundColor Cyan
Write-Host '  1. Le credenziali complete sono in docs/FIELD_TEST_CREDENTIALS.md.'
Write-Host '  2. Login web: https://app.liveslidecenter.com/login (o l URL dell ambiente).'
Write-Host '  3. Esegui i test T1-T19 seguendo docs/FIELD_TEST_CHECKLIST.md.'
Write-Host '  4. In caso di problemi durante l evento: docs/DISASTER_RECOVERY.md.'
Write-Host ''
Write-Host 'CLEANUP (quando hai finito il field test):' -ForegroundColor DarkGray
Write-Host '  - Cancella i 2 tenant (field-test-alpha, field-test-beta) da Supabase dashboard.'
Write-Host '  - CASCADE cancella eventi/sale/sessioni/speakers/users in public.'
Write-Host '  - Cancella manualmente gli 8 auth.users da Authentication -> Users.'
Write-Host ''
