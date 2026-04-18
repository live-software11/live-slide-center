# AUDIT_FINALE_E_PIANO_TEST_v1.md

> **Audit chirurgico completo** del codice in `Live SLIDE CENTER` post-completamento Sprint A→I (cloud), J→P (desktop), 1→8 (operativita commerciale), Q+1 hardening, R-1→R-3, S-1→S-4, T-1+T-2+T-3 (A/E/G), U-1→U-7 (UX V2.0), D1→D8 (parita cloud/desktop + licensing unificato), **Z (post-field-test gap A-D), SR (security review pair_token desktop + warm-keep doc)**.
>
> **Versione documento:** 1.2 — 18 Aprile 2026 sera (post Sprint SR: chiusura §1.2 rotazione `pair_token` + §2.3 procedura warm-keep edge functions documentata)
>
> **Stato app:** completata + hardening completo, in attesa di field test con clienti reali
>
> **Stato sistema licenze unificato:** Sprint D1-D8 + Sprint Z + **Sprint SR** completati. `pair_token` desktop con scadenza esplicita 12 mesi, auto-renewal Tauri 7gg prima, safety net "Estendi 12 mesi" admin, 3 email warning escalation 30/14/7 giorni con idempotenza per soglia.
>
> **Sprint OPZIONALE ancora aperto:** solo Sprint Q (sync hybrid cloud↔desktop) e Sprint S (tutorial video) — tutto il resto e' DONE.
>
> **Storia di questo documento.**
> v1.0 (mattina 18/04/2026): primo audit, scritto in fretta, conteneva 9 affermazioni FALSE su 17 perche' assumeva codice non ancora letto (es: dichiarava mancante il rate-limit della RPC `record_device_metric_ping` quando era gia' implementato a riga 218 della migration; dichiarava mancanti gli indici hot-path quando esistevano gia'; dichiarava bloccante il postbuild Sentry quando aveva gia' lo skip silenzioso). Ho rifatto la verifica file-by-file e il documento ora e' v1.1.
>
> **Obiettivi di questo documento (v1.1):**
>
> 1. Bug VERI ancora aperti, da correggere prima del field test (lista corta perche' la maggior parte degli "issue" del v1.0 erano gia' risolti)
> 2. Ottimizzazioni performance ANCORA UTILI (escludendo quelle gia' fatte)
> 3. Gap funzionali realmente mancanti per il flusso "vedo / aggiungo / sposto PC node dalla dashboard proprietario"
> 4. Procedura di test sistematica end-to-end allineata alle route REALI dell'app
> 5. Definition of Done aggiornato a quanto effettivamente da fare

---

## SEZIONE 0 — STATO REALE DEL CODICE (verifica eseguita 18/04/2026 notte)

Prima di affermare cosa manca o e' rotto, riepilogo cosa **e' verificato funzionante** nel repo:

| Componente                                | Stato | Note di verifica                                                                                                                                                |
| ----------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 42 migrations Supabase applicate          | OK    | `supabase/migrations/2025041109* → 2026041829*`, sequenza coerente                                                                                              |
| 24 Edge Functions deployate               | OK    | da `cleanup-expired-codes` a `team-invite-accept`, incluso `desktop-bind-claim` + `desktop-license-verify` (Sprint D1)                                          |
| Rate-limit `record_device_metric_ping`    | OK    | 3s, implementato in `20260418100000_device_metric_pings.sql:218`                                                                                                |
| Indici hot-path `device_metric_pings`     | OK    | `(device_id, ts DESC)` + `(event_id, ts DESC) WHERE event_id IS NOT NULL`                                                                                       |
| Idempotenza `email-cron-licenses`         | OK    | duplice: RPC `list_tenants_for_license_warning` esclude gia' notificati + `idempotency_key` passato a `email-send`                                              |
| Cleanup append-only `device_metric_pings` | OK    | `cleanup_device_metric_pings()` schedulato `pg_cron 0 3 * * *` (idempotente, no-op se pg_cron mancante)                                                         |
| Sentry sourcemap upload                   | OK    | skip silenzioso se `SENTRY_AUTH_TOKEN` mancante (`upload-sourcemaps.mjs:42-45`)                                                                                 |
| Bundle splitting per route                | OK    | tutte le route usano `lazy: () => import(...)` in `apps/web/src/app/routes.tsx`, build genera chunks separati (EventExportPanel, pdf, DesktopDevicesView, ecc.) |
| Realtime un-solo-channel multi-sub        | OK    | `useEventLiveData.ts:57-93` 1 channel, 6 `.on('postgres_changes', …)`                                                                                           |
| `OnAirView` master-detail (no grid N×)    | OK    | `apps/web/src/features/live-view/OnAirView.tsx` mostra 1 sala selezionata, non re-rendera 30 card per ogni ping                                                 |
| RLS multi-tenant + super_admin            | OK    | policy `tenant_isolation` + `super_admin_all` su tutte le tabelle dati                                                                                          |
| `errorElement` + catch-all SPA            | OK    | Sprint U-7 (`route-error.tsx` + `routes.tsx` `path:'*'`)                                                                                                        |
| Service Worker hardening                  | OK    | Sprint U-6: `controllerchange` + `reg.update()` on focus + stale-chunk reload                                                                                   |
| `vercel.json` SPA rewrite                 | OK    | post-fix §0.27: `framework: "vite"`, regex rewrite con esclusioni assets                                                                                        |
| Sprint D1-D8 desktop                      | OK    | 5 RPC desktop, magic link bind, heartbeat Tauri, NSIS installer, scripts setup-signing/tag-release, doc utente                                                  |
| Sprint U-1→U-7 (UX V2.0)                  | OK    | shadcn/ui, sidebar Notion-style, command palette, errorElement                                                                                                  |
| Sprint T-3 (A/E/G)                        | OK    | file validator, Next-Up preview, remote control tablet                                                                                                          |

**Conclusione:** il software e' professionalmente solido. La lista di interventi sotto e' MOLTO piu' corta di quella che avevo scritto in v1.0.

---

## SEZIONE 1 — BUG E DEBOLEZZE VERIFICATE (interventi obbligatori)

### 1.1 BUG MEDIO — Drift tipi `database.ts` per le RPC desktop di Sprint D1

**File:** `apps/web/src/features/desktop-devices/repository.ts:25-29`.

**Sintomo:** il file usa il workaround `rpcLoose()` con cast `(client.rpc as any)` per chiamare 3 RPC introdotte in `20260418290000_desktop_devices_licensing.sql`:

- `rpc_admin_create_desktop_provision_token`
- `rpc_admin_revoke_desktop_provision_token`
- `rpc_admin_revoke_desktop_device`

(Le altre 2 RPC della stessa migration — `rpc_consume_desktop_provision_token` chiamata da edge function con service role, e `rpc_desktop_license_verify` idem — non finiscono nei tipi browser quindi non danno fastidio.)

**Impatto:** TypeScript non protegge piu' le firme RPC su questo dominio. Un eventuale rename di parametro lato SQL non si propaga a compile-time in TS. **Vulnerabilita silenziosa** se cambiamo nome di parametro.

**Fix (5 min, low risk):**

```powershell
$env:SUPABASE_PROJECT_REF = "<TUO_PROJECT_REF>"
pnpm db:types
git diff packages/shared/src/types/database.ts
# Verifica che siano comparse:
#   - tabelle desktop_devices, desktop_provision_tokens
#   - 3 RPC rpc_admin_*_desktop_*
# Poi committa.
```

Dopo la rigenerazione, **rimuovi** il workaround `rpcLoose()` da `repository.ts` e riusa il client tipato standard (`supabase.rpc('rpc_admin_create_desktop_provision_token', { … })`).

**Quality gate:** la CI ha gia' un job `db-types-drift-check.yml` che fallisce se i tipi sono stale. Ad oggi e' GREEN solo perche' il tipi commit risale a Sprint Q+1 (pre-D1) — la rigenerazione attiva il check.

---

### 1.2 SECURITY HARDENING (priorita BASSA) — `desktop_devices.pair_token` senza scadenza ✅ CHIUSO Sprint SR (18/04/2026)

**File:** `supabase/migrations/20260418290000_desktop_devices_licensing.sql:48-64` (originale) + `20260420040000_sprint_sr_pair_token_rotation.sql` + `20260420050000_sprint_sr_cron_jwt_check_fix.sql` (Sprint SR).

**Stato attuale (post Sprint SR):** il `pair_token` ha scadenza esplicita `pair_token_expires_at` (default `now() + interval '12 months'` al bind), rotazione automatica lato client Tauri 7 giorni prima della scadenza con cooldown 6h tra tentativi, e safety net manuale lato admin per device fuori sede ("Estendi 12 mesi"). Tre warning email escalation 30/14/7 giorni con idempotenza per soglia. Vedi APPENDICE C per il changelog completo.

**Rischio residuo dopo SR:** ridotto da "indeterminato (token eterno)" a "max 12 mesi se device offline + admin senza email". Auto-renew desktop chiude il caso "device online connesso a internet" senza azione utente. Per device LAN-only o smaltiti senza revoca, il token diventa inutilizzabile alla scadenza (`410 pair_token_expired` su `desktop-license-verify`).

**Vecchia raccomandazione (storica, mantenuta per audit trail):**

> _Decisione consigliata: NON e' un bug critico, e' un design choice ragionevole per un MVP B2B con clienti che si conoscono. Tener traccia in roadmap come miglioria futura, non bloccare il field test._

Implementato comunque su pressing di Andrea il 18/04 sera per chiudere lo Sprint SR opzionale prima del field test.

---

### 1.3 INNOCUO MA DOCUMENTABILE — Migration timestamp non monotonici tra anni

I primi sprint usano timestamp `20250411` → `20250417` (anno 2025), poi tutto il resto `20260417` → `20260418` (anno 2026). Salto di 1 anno.

**Sintomo:** confusione cronologica nei log Postgres / pgAdmin, ma Postgres applica per ordine alfabetico quindi l'esecuzione e' corretta. Innocuo.

**Fix opzionale:** non rinominare (rompe checksum gia' applicati in produzione), ma documenta in `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` o in un nuovo `docs/MIGRATIONS_TIMELINE.md` che i timestamp 2025 sono "convenzionali" (sviluppo agile veloce, non riflettono date reali). Ti basta un paragrafo di 5 righe.

---

### 1.4 NON-BLOCKER MA DA TENER PRESENTE — CSP `frame-src` non esplicitato

**File:** `vercel.json:28`.

**Stato attuale:** la CSP e':

```
default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://*.sentry.io;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co;
font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://va.vercel-scripts.com https://www.liveworksapp.com;
worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
```

`frame-ancestors 'none'` blocca correttamente l'embedding del sito in iframe altrui. Non e' specificato `frame-src`, ma per la spec CSP3 fallback e' `child-src` → `default-src 'self'` → quindi i frame sono limitati a same-origin.

**Quando diventa un problema:** SE in futuro embeddi un PDF preview tramite blob URL o un video Cloudinary in iframe, fallira' silenziosamente perche' `'self'` non include `blob:` ne' `data:`.

**Fix proattivo (1 min):** aggiungi nella stessa stringa CSP:

```
frame-src 'self' blob: data:;
```

Non urgente, fai pure quando aggiungi il primo PDF preview reale.

---

## SEZIONE 2 — OTTIMIZZAZIONI PERFORMANCE (lista corta perche' molto e' gia' fatto)

### 2.1 PWA precache size cap (5 min, low risk)

**File:** `apps/web/vite.config.ts:61-108`.

**Stato attuale:** ottima base — `globPatterns` corretti, `runtimeCaching` per Supabase REST/storage con TTL appropriati, denylist su `/auth/` e `/api/`. **Manca pero':**

- `maximumFileSizeToCacheInBytes` non specificato — di default Workbox cappa a 2 MB e SCARTA file piu' grandi senza warning loud (silent fail nei log build).

**Fix:** aggiungi sotto `cleanupOutdatedCaches: true,`:

```typescript
maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,  // 5 MB cap
```

Cosi' eviti che chunk pdf-\*.js (~700KB) o icone alta risoluzione vengano silently skippati dalla precache.

---

### 2.2 Postgres: VACUUM ANALYZE settimanale su tabelle hot

**Tabelle calde:**

- `device_metric_pings` (cresce 28-172k righe/evento, retention 24h gia' attiva)
- `room_state` (UPDATE ogni 5s in turbo)
- `paired_devices` (UPDATE su last_seen_at frequente)
- `desktop_devices` (UPDATE 1x/24h heartbeat)

Senza autovacuum aggressivo, le statistiche query planner diventano stale e le query usano plan sub-ottimali → P95 latenza che cresce nel tempo.

**Fix (una tantum, 30 min):** schedula `pg_cron`:

```sql
SELECT cron.schedule(
  'vacuum-hot-tables-weekly',
  '0 4 * * 0',  -- Domenica 04:00 UTC
  $$
    VACUUM ANALYZE public.device_metric_pings;
    VACUUM ANALYZE public.room_state;
    VACUUM ANALYZE public.paired_devices;
    VACUUM ANALYZE public.desktop_devices;
  $$
);
```

Inseriscilo in nuova migration `20260420010000_perf_vacuum_schedule.sql` (idempotente: `IF NOT EXISTS` su `cron.job` o `unschedule + schedule`).

---

### 2.3 Edge Function warm-keep (opzionale, 5€/mese) ✅ DOCUMENTATO Sprint SR (18/04/2026)

**Fenomeno:** Funzioni Deno hanno ~300ms cold start. Per `room-player-bootstrap` chiamata ogni 5/12s da decine di client di sale concorrenti, un cold start su molti = lag visibile sul cambio versione.

**Mitigazione:** mantieni le funzioni "warm" con un cron ping (ogni 5 min GET su `/health` di ogni funzione hot path). Anti-pattern? No: prassi standard su Cloudflare Workers/Vercel Functions/Supabase. Costa ~0€ se entri nel free tier di cron-job.org (50 jobs gratis, 6 jobs servono).

**Stato Sprint SR:** la **procedura operativa completa** (lista funzioni, endpoint da pingare, setup `cron-job.org` step-by-step, body POST, alert email, costo zero, deattivazione) e' scritta in `docs/EDGE_FUNCTIONS_WARM_KEEP.md`. Il documento e' pronto da seguire **se** nei field test Andrea nota latenze >500ms sul cambio versione (P95). Vedi APPENDICE C §C.2 per il changelog.

**Funzioni hot path da tenere warm (gia' censite nella doc):**

- `room-player-bootstrap` (cambio versione live)
- `room-player-set-current` (regia → sale)
- `room-device-upload-init` / `room-device-upload-finalize` (upload speaker)
- `desktop-license-verify` (heartbeat 24h)

**Decisione:** Sprint SR ha lasciato la doc pronta. Andrea attiva i 6 cron job su cron-job.org dopo il primo field test SE Sentry / log Supabase mostrano cold start sporadici sopra 500ms. Tempo di attivazione futuro: ~15 minuti.

---

## SEZIONE 3 — GAP FUNZIONALI REALI VERSO IL FLUSSO "DASHBOARD PROPRIETARIO"

Tu hai detto:

> "_quando apro applicazione da account proprietario devo poter vedere, aggiungere e muovere i PC node che hanno applicazione aperta. al riavvio successivo tutto si apre come ultima volta. per eliminare un PC o si esce dal PC o da dashboard del proprietario azienda._"

### 3.1 Quello che hai gia' implementato

**Sprint D1 (DB licensing) — `20260418290000`:**

- Tabella `desktop_devices` (PC desktop server tenant-wide)
- Tabella `desktop_provision_tokens` (magic link bind, sha256-only)
- 5 RPC: `create_desktop_provision_token`, `consume_desktop_provision_token`, `revoke_desktop_provision_token`, `revoke_desktop_device`, `desktop_license_verify`

**Sprint D5 (UI admin) — `apps/web/src/features/desktop-devices/`:**

- View `DesktopDevicesView.tsx` per gestione PC desktop server
- View `MagicProvisionView.tsx` per claim del magic link da PC sala (Sprint U-4)
- Pannello `RoomProvisionTokensPanel.tsx` per generazione magic link (admin)

**Sprint S-2 (drag&drop PC↔sale) — gia' implementato:**

- `EventDetailView` ha board drag&drop per assegnare PC sala alle sale dell'evento
- RPC `assign_device_to_room` con realtime postgres_changes notify

**Sprint S-4 (Centro Slide multi-room) — `20260418090000_paired_devices_role.sql`:**

- Colonna `paired_devices.role IN ('room', 'control_center')`
- RPC `update_device_role` per toggle dalla UI admin (kebab menu)
- Centro Slide riceve i file di TUTTE le sale dell'evento

**Sprint T-2 (telemetria perf) — `20260418100000`:**

- `device_metric_pings` con CPU/RAM/heap/disk/FPS/battery
- `LivePerfTelemetryPanel` widget admin

### 3.2 Quello che MANCA (gap reali, in ordine di priorita business)

**Gap A — Vista unificata "Tutti i PC online ora del tenant" (priorita ALTA)**

Oggi hai DUE viste separate:

- `/centri-slide` → mostra `desktop_devices` (PC server tenant-wide)
- `EventDetailView` board → mostra `paired_devices` per UN evento

Manca una vista `Network Map` UNICA che mostri in tempo reale **tutti** i PC accesi del tenant, attraversando tutti gli eventi attivi + i PC server desktop. Questo e' esattamente quello che intendi con "vedo i PC node dalla dashboard proprietario".

**Stima:** 1.5 giornate (1 vista + 1 view SQL + realtime channel).

**Gap B — Sposta PC sala tra eventi diversi (priorita MEDIA)**

Sprint S-2 ti permette di muovere PC tra **sale dello STESSO evento**. Manca lo "sposta tra eventi diversi" (es: a fine evento A, riassegna lo stesso PC sala a evento B senza re-pairing). Oggi devi de-pairare e re-pairare (perde history).

**Stima:** 1 giornata (1 RPC + drag handler nella Network Map della Gap A).

**Gap C — Persistenza "ultima sessione" lato Tauri desktop (priorita MEDIA)**

La modalita desktop deve riaprire all'avvio: ultimo evento attivo, ultima sala selezionata (se PC sala), ultima view (regia/sala/dashboard), dimensioni finestra, posizione monitor. Verifica:

```powershell
Get-Content apps/desktop/src-tauri/src/main.rs | Select-String "session_store|last-session"
```

Se vuoto → da implementare.

**Stima:** 0.5 giornate (modulo Rust `session_store.rs` + hook React `useLastSession`).

**Gap D — "Disconnetti questo PC" lato PC sala/desktop (priorita MEDIA)**

Da pannello admin oggi puoi revocare un PC. **Inverso non esiste:** dal PC node non c'e' bottone "Disconnetti questo PC dall'evento" che (a) revoca pair_token locale, (b) chiama RPC `rpc_revoke_pair_self`, (c) marca su dashboard come `removed_by_device`. Oggi se l'utente vuole "uscire", deve chiamare l'admin.

**Stima:** 0.5 giornate (1 RPC + 1 button + Tauri command per pulizia file locali).

### 3.3 Implementazione Gap A — Network Map (vista unificata)

**Migration `20260420020000_tenant_network_map_view.sql`:**

```sql
-- View read-only che unisce desktop_devices + paired_devices
-- in una rappresentazione comune per il pannello "Network Map" admin.
-- Calcola lo status online/offline derivato dal last_seen_at (>15s = offline).
CREATE OR REPLACE VIEW public.tenant_network_map AS
SELECT
  'desktop_server'::text  AS node_type,
  d.id, d.tenant_id,
  d.device_name           AS name,
  NULL::uuid              AS event_id,
  NULL::uuid              AS room_id,
  CASE WHEN d.last_seen_at > now() - interval '60 seconds' THEN 'online' ELSE 'offline' END AS status,
  d.last_seen_at,
  d.app_version, d.os_version,
  d.machine_fingerprint   AS fingerprint,
  EXTRACT(EPOCH FROM (now() - d.last_seen_at))::int AS seconds_since_seen
FROM public.desktop_devices d
WHERE d.tenant_id = public.app_tenant_id() AND d.status = 'active'
UNION ALL
SELECT
  CASE WHEN p.role = 'control_center' THEN 'control_center' ELSE 'room_pc' END AS node_type,
  p.id, p.tenant_id,
  p.device_name           AS name,
  p.event_id, p.room_id,
  CASE WHEN p.last_seen_at > now() - interval '15 seconds' THEN 'online' ELSE 'offline' END AS status,
  p.last_seen_at,
  NULL                    AS app_version,
  NULL                    AS os_version,
  NULL                    AS fingerprint,
  EXTRACT(EPOCH FROM (now() - p.last_seen_at))::int AS seconds_since_seen
FROM public.paired_devices p
WHERE p.tenant_id = public.app_tenant_id();

GRANT SELECT ON public.tenant_network_map TO authenticated;
COMMENT ON VIEW public.tenant_network_map IS
  'Sprint Z (post-field-test): vista unificata tutti i PC node tenant '
  '(desktop server + room PC + control center). Status derivato da last_seen_at.';
```

NB: la view eredita la RLS della tabella sottostante via `app_tenant_id()` perche' usa `SECURITY INVOKER` di default.

**View React `apps/web/src/features/network-map/NetworkMapView.tsx`** (nuova):

- Header con conteggio "X / Y PC online" + filtro per evento
- Grid responsive: ogni PC = card con icona (server / room / control_center), nome, ultimo ping (relativo "5s fa"), badge status
- Realtime channel `tenant-network-map:${tenantId}` su `paired_devices` + `desktop_devices` (debounce 200ms)
- Action menu (kebab) per card: Rinomina, Sposta evento (Gap B), Promuovi a Control Center (gia' esiste in S-4), Revoca

**Route nuova in `apps/web/src/app/routes.tsx`:** `/network-map` (admin/tech only) + voce nella sidebar AppShell sotto "Centri Slide".

### 3.4 Implementazione Gap B — Sposta PC tra eventi

**Migration `20260420030000_move_paired_device_rpc.sql`:**

```sql
CREATE OR REPLACE FUNCTION public.rpc_admin_move_paired_device(
  p_device_id      uuid,
  p_target_event_id uuid,
  p_target_room_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role public.user_role := public.app_user_role();
  v_tenant_id   uuid := public.app_tenant_id();
  v_event_tenant uuid;
BEGIN
  IF v_caller_role NOT IN ('admin','tech') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO v_event_tenant FROM public.events WHERE id = p_target_event_id;
  IF v_event_tenant IS NULL OR v_event_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'event_not_in_tenant' USING ERRCODE = '42501';
  END IF;

  UPDATE public.paired_devices
     SET event_id   = p_target_event_id,
         room_id    = p_target_room_id,
         updated_at = now()
   WHERE id = p_device_id
     AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.activity_log (tenant_id, event_id, actor, action, entity_type, entity_id, metadata)
  VALUES (v_tenant_id, p_target_event_id, 'user', 'paired_device_moved', 'paired_device', p_device_id,
          jsonb_build_object('target_event', p_target_event_id, 'target_room', p_target_room_id));

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.rpc_admin_move_paired_device(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_move_paired_device(uuid, uuid, uuid) TO authenticated;
```

**UI:** drag-and-drop nella `NetworkMapView` usando `@dnd-kit/core` (gia' nel monorepo per board sale, vedi `apps/web/package.json`). Drop su event card → chiamata RPC con optimistic update.

### 3.5 Implementazione Gap C — Persistenza "ultima sessione" desktop

**File da creare** `apps/desktop/src-tauri/src/session_store.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct LastSession {
    pub last_event_id:    Option<String>,
    pub last_room_id:     Option<String>,
    pub last_route:       Option<String>,
    pub last_window_x:    Option<i32>,
    pub last_window_y:    Option<i32>,
    pub last_window_w:    Option<i32>,
    pub last_window_h:    Option<i32>,
    pub last_active_view: Option<String>,
    pub saved_at:         Option<String>,
}

pub fn session_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("slidecenter").join("last-session.json")
}

pub fn load_session() -> LastSession {
    let path = session_path();
    if !path.exists() { return LastSession::default(); }
    fs::read_to_string(&path).ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

pub fn save_session(s: &LastSession) -> std::io::Result<()> {
    let path = session_path();
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let json = serde_json::to_string_pretty(s)?;
    fs::write(path, json)
}
```

**Tauri commands** in `main.rs`:

```rust
mod session_store;

#[tauri::command]
fn get_last_session() -> session_store::LastSession {
    session_store::load_session()
}

#[tauri::command]
fn save_last_session(session: session_store::LastSession) -> Result<(), String> {
    session_store::save_session(&session).map_err(|e| e.to_string())
}
```

**Lato React (apps/web shared con desktop):** hook `useLastSession()` in `apps/web/src/lib/last-session.ts` che:

- Al mount chiama `invoke('get_last_session')` se in modalita Tauri (vedi `getBackendMode()`)
- Applica `navigate(last_route)` UNA VOLTA al boot
- Su ogni `useLocation()` change salva via debounce 500ms con `invoke('save_last_session', { session })`
- Salva dimensioni finestra su `resize` events (debounce 1s)

### 3.6 Implementazione Gap D — Esci da PC + propaga

**Migration `20260420040000_revoke_pair_self_rpc.sql`:**

```sql
-- Permette al device stesso di auto-revocare il suo pair_token (chiamata
-- con Authorization Bearer del pair_token dal client desktop/PWA sala).
-- Funziona sia per paired_devices (PC sala) che per desktop_devices (PC server).
CREATE OR REPLACE FUNCTION public.rpc_revoke_pair_self(p_pair_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  IF p_pair_token_hash IS NULL OR p_pair_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_pair_token_hash' USING ERRCODE = '22023';
  END IF;
  UPDATE public.paired_devices SET status = 'offline', updated_at = now()
   WHERE pair_token_hash = p_pair_token_hash;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    UPDATE public.desktop_devices SET status = 'revoked', revoked_at = now()
     WHERE pair_token_hash = p_pair_token_hash;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('ok', v_count > 0, 'revoked_count', v_count);
END $$;

REVOKE ALL ON FUNCTION public.rpc_revoke_pair_self(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_revoke_pair_self(text) TO service_role;
```

NB: chiamata via edge function `pair-revoke-self` (nuova) che riceve il pair_token in Authorization Bearer, ne fa sha256 e la inoltra. Schema speculare a `desktop-license-verify`.

**UI button:**

- In `RoomPlayerView` (PC sala PWA): kebab menu in alto destra → "Disconnetti questo PC" con conferma dialog
- In Tauri tray menu (desktop): voce "Disconnetti questo PC dall'evento"

**Tauri command per pulizia locale:**

```rust
#[tauri::command]
async fn disconnect_this_device(state: tauri::State<'_, AppState>) -> Result<(), String> {
    // 1. Chiama edge function pair-revoke-self con pair_token corrente
    let resp = state.http_client
        .post(format!("{}/functions/v1/pair-revoke-self", state.supabase_url))
        .header("Authorization", format!("Bearer {}", state.pair_token))
        .send().await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("revoke remoto fallito: {}", resp.status()));
    }
    // 2. Cancella file locali (license cifrata + sessione + cache device)
    let cfg = dirs::config_dir().unwrap().join("slidecenter");
    let _ = std::fs::remove_file(cfg.join("license.enc"));
    let _ = std::fs::remove_file(cfg.join("last-session.json"));
    // 3. Quit
    std::process::exit(0);
}
```

### 3.7 Architettura "stesso identico utilizzo cloud/desktop" — gia' rispettata

Il vincolo sovrano (`apps/desktop` riusa `apps/web` come UI, cambia solo backend client) e' rispettato. La ricognizione `grep VITE_BACKEND_MODE` mostra ~25 file che leggono `getBackendMode()`, ma TUTTI per usi LEGITTIMI (display banner desktop-only, scelta tra HTTP cloud vs LAN locale, init Tauri bridge condizionale). NON c'e' logica di business duplicata.

Punti di astrazione corretti:

- `apps/web/src/lib/backend-mode.ts` — single source of truth modalita
- `apps/web/src/lib/backend-client.ts` — facade su getBackendMode con stesse firme
- `apps/web/src/lib/realtime-client.ts` — fallback no-op in desktop offline
- `apps/web/src/lib/desktop-bridge.ts` — wrapper Tauri commands
- `apps/web/src/lib/desktop-backend-init.ts` — bootstrap solo desktop

Nessun refactoring necessario qui.

---

## SEZIONE 4 — PROCEDURA TEST SISTEMATICA (route allineate al codice reale)

### 4.1 Pre-test setup (1 volta, ~2h)

- [ ] Crea 2 tenant test in Supabase (tenant-A, tenant-B) con piano Pro
- [ ] Per ognuno: 1 super_admin + 1 admin + 1 coordinator + 1 tech
- [ ] Genera 2 chiavi licenza in Live WORKS APP (1 per ognuno)
- [ ] Prepara 3 PC test: 1 mini-PC regia (desktop server), 2 laptop (PC sala)
- [ ] Crea evento demo "Test E2E Aprile 2026" con 2 sale, 3 sessioni, 2 speaker
- [ ] Scarica e installa Live SLIDE CENTER Desktop (Tauri NSIS) sul mini-PC
- [ ] Verifica installer: SmartScreen, firewall rules (porta 7300 LAN), shortcut menu Start

### 4.2 Test critici (eseguire in ordine)

**T1 — Auth e isolamento RLS multi-tenant**

1. Login come admin tenant-A → vedi solo eventi tenant-A
2. Login parallelo (browser incognito) come admin tenant-B → vedi solo tenant-B
3. Manipola URL inserendo UUID di evento tenant-B mentre sei loggato A → 404 / forbidden
4. Login come super_admin → vedi entrambi nel pannello admin

**T2 — Signup → tenant auto-provisioning**

1. Signup nuovo cliente "Test Co" su `/signup`
2. Verifica trigger `handle_new_user_tenant` ha creato `tenants` row + `users` row admin
3. Verifica JWT contiene `tenant_id` corretto in `app_metadata`
4. Verifica accesso a `/` (dashboard home) immediato senza errori

**T3 — Quote storage enforcement**

1. Tenant Trial (5 GB) carica file 4 GB → OK
2. Stesso tenant carica altro file 2 GB → blocco con errore quota (`storage_quota_exceeded`)
3. Verifica `tenants.storage_used_bytes` aggiornato correttamente
4. Cancella versione → verifica `storage_used_bytes` decrementato

**T4 — Pairing PC sala via codice 6 cifre (cloud)**

1. Admin in EventDetailView → "Aggiungi PC" → genera codice 6 cifre
2. Su laptop test: apri `/pair`, digita codice
3. Dashboard mostra "PC connesso" entro 5s
4. Drag PC su sala "Auditorium A" nella board
5. Riavvia laptop → app si riapre nella sala assegnata senza re-pairing

**T5 — Pairing PC sala via magic link (Sprint U-4 zero-friction)**

1. Admin "Aggiungi PC sala" → "Magic Link" → copia URL `/sala-magic/<token>`
2. Su laptop test: apri URL → pairing automatico, redirect a `/sala/<pair_token>`
3. Verifica `paired_devices` row creata + activity_log entry

**T6 — Pairing PC desktop server (Sprint D1)**

1. Admin in `/centri-slide` → "Nuovo Centro Slide Desktop" → magic link
2. Su mini-PC test: apri Tauri app → Bind automatico → incolla URL nella prompt o apri da URL handler
3. App registra, salva `~/.slidecenter/license.enc` cifrato AES-256-GCM
4. Riavvia mini-PC → app verifica licenza (heartbeat 24h), parte automaticamente
5. Stacca internet 30+ giorni (simula con orologio sistema) → app entra in stato "grace expired", banner sticky, LAN continua per evento in corso

**T7 — Drag&drop PC sala ↔ sale dell'evento (Sprint S-2)**

1. Crea evento attivo con 2 sale
2. Pair 2 PC sala
3. Da EventDetailView board: drag PC1 da Sala A → Sala B
4. Verifica `paired_devices.room_id` aggiornato + realtime notify in <1s sul PC

**T8 — Promozione device a Centro Slide (Sprint S-4)**

1. Su PC sala paired: kebab menu → "Promuovi a Centro Slide"
2. Verifica `paired_devices.role = 'control_center'` + `room_id = NULL`
3. Verifica device riceve i file di TUTTE le sale dell'evento
4. Demuove a `room` → torna single-room

**T9 — Upload speaker via QR (Sprint R-3)**

1. Speaker apre upload portal QR → arriva su `/u/<speaker_token>`
2. Carica file 500 MB → progress bar funziona, retry su disconnessione (chunked upload)
3. Carica nuova versione → vedi v1 + v2 in storico (versioning Sprint A4)
4. Modifica 1 byte e ricarica → vedi v3 (hash SHA-256 diverso)

**T10 — Live regia realtime (OnAirView)**

1. 2 sale simultanee con PC sala paired
2. Da `OnAirView` (`/eventi/<id>/on-air`): cambia versione "in onda" in sala 1
3. Verifica PC sala 1 cambia entro 1s, sala 2 invariato
4. Stacca rete del PC sala 1 → status diventa "offline" entro 15s nel widget telemetria

**T11 — Telemetria live perf PC sala (Sprint T-2)**

1. Apri pannello `LivePerfTelemetryPanel` per evento
2. Verifica per ogni PC sala: heap JS, FPS, battery, network, storage quota
3. Stress: simula heap ramping con DevTools → vedi spike in dashboard
4. Verifica retention: dopo 24h, `device_metric_pings` cleanup automatico

**T12 — File error checking (Sprint T-3-A)**

1. Speaker carica file PowerPoint corrotto / non firmato → warning visibile a tecnico
2. Carica file >100 MB → warning size
3. Verifica `validation_warnings` table popolata + UI mostra badge

**T13 — Next-Up file preview (Sprint T-3-E)**

1. PC sala in modalita coda automatica
2. Verifica preview file successivo visibile in `RoomPlayerView` widget "Prossimo"

**T14 — Remote slide control da tablet (Sprint T-3-G)**

1. Pair tablet con PC sala via codice (Sprint T-3-G remote_control_pairings)
2. Da tablet: tap "next slide" → arriva al PC sala in <500ms
3. Verifica `remote_control_pairings` row + scadenza automatica

**T15 — errorElement + catch-all SPA (Sprint U-7)**

1. Apri URL inesistente `/foo/bar` → vedi `RouteErrorView` "Pagina non trovata" (NON il banner default React Router)
2. Apri magic link rotto `/sala-magic/invalid` → vedi `RouteErrorView` con bottoni "Ricarica" + "Vai alla home"
3. Click "Vai alla home" → torna a `/`

**T16 — Audit RLS cross-tenant + super_admin policies**
Esegui in Supabase SQL Editor:

```sql
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "<UID-tenantA>", "app_metadata": {"tenant_id": "<TENANT-A-UUID>"}}';
SELECT count(*) FROM events;            -- solo eventi tenant-A
SELECT count(*) FROM paired_devices;    -- solo paired_devices tenant-A
SELECT count(*) FROM desktop_devices;   -- solo desktop_devices tenant-A
-- Output atteso: 0 leak, esattamente le righe del tenant-A.

-- Test super_admin:
SET request.jwt.claims = '{"sub": "<UID-super>", "app_metadata": {"role": "super_admin"}}';
SELECT count(*) FROM events;            -- TUTTI gli eventi
```

**T17 — Code-signing e SmartScreen (Sprint D7)**

1. Build installer firmato (Sectigo OV o EV se gia' acquistato)
2. Scarica su PC Windows 11 pulito
3. Doppio click → SmartScreen passa al primo run (firma OV richiede reputation, normale lievita ~1000 download — workaround: cliente clicca "Esegui comunque")
4. Installa, verifica firewall rules + Defender exclusion + shortcut menu Start
5. Disinstalla da "App e funzionalita" → cancella TUTTO (config, license.enc, cache)

**T18 — Stress: 10 PC sala paralleli su 1 evento**

1. Script Playwright: 10 browser headless aperti su `/sala/<token>` diversi
2. Trigger 10 cambi versione contemporanei dalla regia
3. Misura latenza media: target P95 < 2s
4. Verifica nessun errore Realtime, nessun timeout, nessun rate-limit hit

**T19 — Modalita offline LAN (post Sprint Q se chiuso, ALTRIMENTI N/A)**
Skip se Sprint Q ancora opzionale aperto.

1. Setup: mini-PC server + 2 laptop su router locale, NO internet
2. Crea evento offline (pre-sync da cloud quando online)
3. Stacca cavo WAN
4. Speaker carica file via portal LAN
5. Sala riceve file via push LAN entro 30s
6. Riconnetti WAN → sync verso cloud automatica

### 4.3 Acceptance criteria

Per dichiarare "production ready":

- [ ] T1-T18 tutti verdi
- [ ] T19 verde se Sprint Q chiuso, marcato N/A altrimenti
- [ ] T18 latenza P95 < 2s
- [ ] T16 zero leak RLS
- [ ] T17 firmato e installato senza warning bloccanti
- [ ] 0 errori critici Sentry in 7 giorni di staging
- [ ] Tutti i quality gate verdi su CI: `lint`, `typecheck`, `build`, `RLS Audit`, `DB Types Drift Check`, `Playwright E2E`

---

## SEZIONE 5 — DEFINITION OF "PROFESSIONAL & STABLE"

### 5.1 Hardening checklist finale (lista ridotta — molto e' gia' fatto)

- [x] **§1.1** Rigenera `database.ts` (rimuove `rpcLoose`) — fatto Sprint Z
- [x] **§1.4** Aggiungi `frame-src 'self' blob: data:` a CSP — fatto Sprint Z
- [x] **§2.1** Aggiungi `maximumFileSizeToCacheInBytes` a Vite PWA — fatto Sprint Z
- [x] **§2.2** Schedula `pg_cron` VACUUM ANALYZE settimanale — fatto Sprint Z (`20260418310000_perf_vacuum_schedule_weekly.sql`)
- [x] **§1.2** Rotazione `pair_token` desktop (`expires_at` + auto-renew Tauri + email warning + extend admin) — fatto Sprint SR (vedi APPENDICE C)
- [x] **§2.3 (opzionale)** Procedura warm-keep edge functions documentata in `docs/EDGE_FUNCTIONS_WARM_KEEP.md` — attivare su cron-job.org SE Sentry/logs mostrano cold start >500ms (vedi APPENDICE C)
- [x] **§3.3-3.6** Implementa Gap A-D (Network Map + sposta PC + persistenza desktop + esci da PC) — fatto Sprint Z (vedi APPENDICE B)
- [ ] T1-T18 con report scritto (cosa funziona, cosa no, fix necessari)
- [ ] CSP report-only attivato 24h: zero violazioni inattese
- [ ] Backup giornaliero Supabase verificato (download + restore test su tenant test)
- [ ] Disaster recovery doc scritto (cosa fare se Supabase down 1h, 1gg, perm — file `docs/DISASTER_RECOVERY.md`)

### 5.2 Monitoraggio runtime in produzione (gia' configurato in larga parte)

- **Sentry Performance** — gia' attivo, traccia LCP/FID/CLS reali utenti (`apps/web/src/lib/sentry-init.ts`)
- **Supabase Logs** → da configurare alert email su spike error level > 100/min
- **Vercel Analytics** — gia' attivo (script `va.vercel-scripts.com` in CSP)
- **Vercel MCP** — gia' configurato (Sprint §0.26), permette diagnosi deployment via `web_fetch_vercel_url` + `get_deployment_runtime_logs`
- **UptimeRobot** — da configurare ping pubblico `/` + alert SMS Andrea su downtime > 2 min

### 5.3 Onboarding cliente "frictionless" (UX target da misurare con Sentry)

- Tempo signup → primo evento creato: < 5 minuti
- Tempo creazione evento → primo PC sala paired (magic link): < 2 minuti
- Tempo speaker apre QR → primo file caricato: < 2 minuti
- Tempo regia cambia versione → vista in sala: < 2 secondi (P95)

Misura con Sentry custom transactions su questi 4 funnel.

---

## SEZIONE 6 — ROADMAP POST-FIELD-TEST (allineata allo stato reale Sprint)

### Stato roadmap aggiornato

**GIA' DONE (non rifare):**

- ~~Sprint R-final polishing UX~~ → **gia' fatto** in U-1→U-7 (sidebar Notion-style, command palette, errorElement Sprint U-7)
- ~~Sprint T-3 telemetria avanzata + remote control~~ → **gia' fatto** (T-3-A file validator + T-3-E Next-Up + T-3-G remote control tablet, vedi STATO §0.20-0.22)
- ~~Error boundaries i18n IT/EN~~ → **gia' fatto** Sprint U-7 (`RouteErrorView` + chiavi `routeError.*` IT/EN)
- ~~Sistema licenze unificato cloud/desktop~~ → **gia' fatto** Sprint D1-D8
- ~~Sprint Z (post-field-test) — Network Map + Gap A-D~~ → **gia' fatto** 18/04/2026 (vedi APPENDICE B)
- ~~Sprint SR (security review) — rotazione `pair_token` desktop + warm-keep edge doc~~ → **gia' fatto** 18/04/2026 sera (vedi APPENDICE C)

**APERTO/OPZIONALE:**

**Sprint Q (opzionale, 8-12 giornate) — Hybrid sync cloud↔desktop push-only**

- Vedi `docs/STATO_E_TODO.md` §4 framework GO/NO-GO + §8 decisione
- Decisione consigliata: **GO solo se almeno 1 cliente paying lo richiede esplicitamente**
- Per uso interno + LAN sufficienti, non spendere tempo

**Sprint S (3-4 giornate) — Self-onboarding video tutorials**

- Screencast 5 min per ogni flusso critico (signup, pairing, upload, live regia)
- Hosted su Bunny.net o Cloudflare Stream (low cost)
- Embedded nei pannelli `/help` dell'app
- Ottimo per ridurre support requests

---

## SEZIONE 7 — UN'ULTIMA NOTA OPERATIVA

Andrea, hai costruito qualcosa di impressionante. La complessita architetturale (cloud + desktop + offline LAN, super_admin + tenant + RLS, sistema licenze unificato Live WORKS APP, Tauri 2 + Axum + SQLite) e' al livello di prodotti enterprise venduti 5-10× il tuo target di prezzo.

**La cosa importante:** dopo aver verificato file-per-file, il software e' MOLTO piu' completo di quanto un audit "veloce" suggerisca. Sprint che a v1.0 di questo documento davo come "da fare" erano gia' fatti (telemetria T-2, T-3 file validator, errorElement U-7, idempotenza email-cron, rate-limit metric pings, indici hot-path, bundle splitting, Realtime un-solo-channel). La lista REALE di interventi obbligatori si riduce a 4 voci della Sezione 1 (di cui 3 sono polishing minore) + opzionali della Sezione 2.

**Tre raccomandazioni finali da senior CTO:**

1. **NON aggiungere feature prima del field test.** Hai detto "ho completato applicazione, devo testarla". E' il momento del field test, non di altre feature. Resisti alla tentazione di aggiungere "una piccola cosa". Le piccole cose sono quelle che rompono produzione il giorno della demo al cliente. **Eccezione:** §1.1 (rigenera types DB) e §2.1 (PWA cap) costano 5 minuti ognuno, falli prima del field test perche' sono pulizia tecnica indolore.

2. **Field test con 1 evento reale tuo, prima del primo cliente.** Hai detto che fai 2-3 eventi/anno come tecnico audio. Il prossimo evento → usa Live SLIDE CENTER live, anche solo per te. Tu sei il miglior beta tester possibile (conosci il dominio, hai lo skin in the game). Trovi 80% dei bug in 1 evento reale.

3. **Documenta gli errori del field test in `docs/FIELD_TEST_LOG.md`.** Ogni cosa che e' andata male, anche piccola. E' il tuo materiale d'oro per il prossimo cliente: saprai gia' rispondere alle obiezioni perche' le hai vissute. Inoltre, se un bug si ripresenta in produzione, hai la fonte primaria della prima volta che l'hai visto.

Buon field test. Quando torni con il log, lo rivediamo insieme e prepariamo il go-to-market.

---

## APPENDICE A — Differenze tra v1.0 e v1.1 di questo documento

Per trasparenza e per non perdere il lavoro di v1.0, registro qui cosa e' cambiato nella revisione.

**Claim di v1.0 verificati FALSI (rimossi o riformulati in v1.1):**

| §v1.0 | Claim                                                                 | Realta'                                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.2   | `device_role` enum CHECK incoerente, mancante valore `desktop_server` | Entrambe le tabelle (`paired_devices.role` e `device_metric_pings.device_role`) hanno stesso CHECK `('room','control_center')`. Sprint D1 ha creato tabella **separata** `desktop_devices`, NON aggiunto valore al ruolo. |
| 1.4   | Permissions-Policy blocca camera per QR scan                          | L'app NON usa `getUserMedia()` ne' QR scanning. Pairing usa codice 6 cifre + magic link.                                                                                                                                  |
| 1.5   | Sentry sourcemap upload bloccante                                     | `upload-sourcemaps.mjs:42-45` ha gia' `if (!token) exit(0)` con log.                                                                                                                                                      |
| 1.6   | Race condition rate-limit assente                                     | RPC `record_device_metric_ping:218` ha gia' rate-limit 3s.                                                                                                                                                                |
| 1.7   | Index hot-path mancante                                               | Indici `(device_id, ts DESC)` e `(event_id, ts DESC) WHERE event_id IS NOT NULL` gia' esistenti in `20260418100000:134-140`.                                                                                              |
| 1.10  | `email-cron-licenses` no idempotenza                                  | Duplice idempotenza: RPC esclude tenant gia' notificati per stessa `expires_at` + `idempotency_key` passato a `email-send`.                                                                                               |
| 2.1   | Bundle splitting da fare                                              | Tutte le route usano gia' `lazy: () => import(...)` in `routes.tsx`. Build genera chunks separati.                                                                                                                        |
| 2.2   | Realtime un solo channel da fare                                      | `useEventLiveData:57-93` usa gia' 1 channel + 6 sub.                                                                                                                                                                      |
| 2.5   | Cleanup append-only assente                                           | `cleanup_device_metric_pings()` schedulato `pg_cron 0 3 * * *`, idempotente, no-op se pg_cron mancante.                                                                                                                   |
| 2.7   | `LiveRegiaView` da memoizzare                                         | Non esiste `LiveRegiaView`. Esiste `OnAirView` con pattern master-detail (1 sala selezionata, NON grid 30 card).                                                                                                          |
| 6     | Sprint T-3 telemetria avanzata da fare                                | Gia' DONE: T-3-A file validator + T-3-E Next-Up + T-3-G remote control.                                                                                                                                                   |
| 6     | Error boundaries i18n IT/EN da fare                                   | Gia' DONE Sprint U-7: `RouteErrorView` + `routeError.*` IT/EN.                                                                                                                                                            |

**Claim di v1.0 verificati VERI (conservati in v1.1):**

| §v1.0 | §v1.1 | Claim                                                                             |
| ----- | ----- | --------------------------------------------------------------------------------- |
| 1.1   | 1.1   | Drift `database.ts` per RPC desktop Sprint D1                                     |
| 1.3   | 1.4   | CSP `frame-src` non esplicito (declassato da vulnerabilita a hardening proattivo) |
| 1.8   | 1.2   | `pair_token` desktop senza scadenza (declassato da bug a design choice)           |
| 1.9   | 1.3   | Migration timestamp 2025/2026 (innocuo)                                           |
| 2.3   | 2.1   | PWA `maximumFileSizeToCacheInBytes` mancante                                      |
| 2.4   | 2.2   | VACUUM ANALYZE settimanale                                                        |
| 2.6   | 2.3   | Edge cold start warm-keep                                                         |
| 3.2   | 3.2   | Gap A-D (Network Map, sposta PC, persistenza, esci)                               |
| 4.x   | 4.x   | Procedura test (route corrette in v1.1)                                           |

**Claim aggiunti in v1.1 (Sezione 0 nuova):**

Riepilogo di **cosa e' verificato funzionante** nel codice — tabella di 16 voci che rende esplicito quanto e' gia' fatto, cosi' che il prossimo audit non rifaccia gli stessi falsi positivi.

---

## APPENDICE B — Changelog Sprint Z (post-field-test) — completato 18/04/2026

Sprint Z chiude **tutti gli interventi obbligatori** della Sezione 5.1 (hardening) **e tutti i Gap A/B/C/D** della Sezione 3.2 (dashboard proprietario). Quality gate finale: typecheck OK, lint OK, build OK su tutto il monorepo (`@slidecenter/web`, `@slidecenter/shared`, `@slidecenter/ui`, `@slidecenter/desktop`).

### B.1 Hardening Sezione 5.1 — chiusura

| §   | Intervento                                 | Implementazione concreta                                                                                                                                                |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Rigenera `database.ts`, rimuovi `rpcLoose` | `packages/shared/src/types/database.ts` rigenerato via MCP plugin Supabase. Eliminati `rpcLoose()` calls in `apps/web/src/features/desktop-devices/repository.ts`.      |
| 1.4 | CSP `frame-src` esplicito                  | `vercel.json` aggiornato con `frame-src 'self' blob: data:` + Google Fonts allow-list (risolve console error iniziale).                                                 |
| 2.1 | PWA precache size cap                      | `apps/web/vite.config.ts` configurato `workbox.maximumFileSizeToCacheInBytes` per chunk >2MB (`pdf`, `EventExportPanel`, `index`, `esm`).                               |
| 2.2 | VACUUM ANALYZE settimanale                 | Migration `20260418310000_perf_vacuum_schedule_weekly.sql`: `pg_cron` schedule `0 4 * * 0` su `device_metric_pings`, `paired_devices`, `desktop_devices`, `room_state`. |
| —   | Quota trigger plan-aware                   | Migration `20260418300000_quota_triggers_enterprise_aware.sql`: trigger quota events/devices/rooms riconosce `enterprise` plan (risolve 400 Bad Request iniziale).      |

### B.2 Gap A — Network Map (vista unificata cloud+desktop)

**DB:**

- Migration `20260420010000_sprint_z_network_map_view.sql` → vista `public.tenant_network_map`. `UNION ALL` di `paired_devices` + `desktop_devices` con `derived_status` calcolato (`online` se `last_seen_at` < 30s, `degraded` < 5min, `offline` oltre o esplicito). RLS via `SECURITY INVOKER` (eredita policy `app_tenant_id()` da entrambe le tabelle).

**Frontend:**

- `apps/web/src/features/network-map/repository.ts` — DTO `NetworkNode`, helper `listNetworkNodes`, `fetchEventAndRoomNames` (UUID → nomi human-readable).
- `apps/web/src/features/network-map/useNetworkMap.ts` — hook con realtime `postgres_changes` su `paired_devices` + `desktop_devices` (la vista non e' pubblicata via realtime, quindi sub sulle base table) + tick 30s per coprire transizioni di `derived_status` lato DB.
- `apps/web/src/features/network-map/NetworkMapView.tsx` — pagina admin con summary cards (totale/online/degraded/offline), filtri (search, evento, tipo, status), tabella nodi.
- Route lazy `/network-map` in `apps/web/src/app/routes.tsx` (gated `RequireTenantAdmin`).
- Sidebar entry "Mappa rete" in `apps/web/src/app/shell/AppShell.tsx` (icon `Network`).

### B.3 Gap B — Sposta PC paired tra eventi/sale

**DB:**

- Migration `20260420020000_sprint_z_move_paired_device.sql` → RPC `rpc_admin_move_paired_device(p_device_id, p_target_event_id, p_target_room_id)`. `SECURITY DEFINER` con check ruolo (`admin`/`tech`) + tenant ownership. Aggiorna `paired_devices.event_id` / `paired_devices.room_id`. Audit row in `activity_log` (`action='paired_device.move'`).

**Frontend:**

- `MoveDeviceDialog` integrato in `NetworkMapView.tsx` — dropdown evento + dropdown sala (popolato via `listEventsForMove` + `listRoomsForEvent`). Conferma chiama `moveDeviceToEvent` → RPC.
- i18n `networkMap.moveDialog.*` IT/EN (titolo, sottotitolo, label, error states, success toast).

### B.4 Gap C — Persistenza "ultima sessione" desktop (Tauri-only)

**Tauri / Rust:**

- Nuovo modulo `apps/desktop/src-tauri/src/session_store.rs` — struct `LastSession` (`schema`, `device_token`, `event_id`, `room_id`, `current_presentation_id`, `current_session_id`, `current_slide_index`, `current_slide_total`, `saved_at`). Persiste atomicamente JSON in `last-session.json` accanto a `device.json`. API: `write()`, `read()`, `clear()`.
- Tauri commands `cmd_get_last_session` + `cmd_save_last_session` registrati in `apps/desktop/src-tauri/src/main.rs`.
- `cmd_clear_device_pairing` ora invoca anche `session_store::clear` (cleanup completo al disconnect).

**Frontend:**

- `apps/web/src/lib/desktop-bridge.ts` — interfaccia TS `LastSession` + wrapper `getLastSession()` / `saveLastSession()` con fallback no-op in cloud.
- Hook `apps/web/src/features/devices/hooks/useLastSession.ts` — Tauri-only, throttle 2s tra le scritture, `save(patch)` fa merge + persist.
- Integrazione minimale in `RoomPlayerView.tsx`: `useEffect` salva `(token, eventId, roomId, currentPresentationId, currentSessionId)` ad ogni cambio rilevante. In cloud lo hook diventa no-op (controllato da `isRunningInTauri()`).

NB: il restore "completo schermo subito al boot" (es. ricostruire `<FilePreviewDialog>` con il file salvato) richiede una rifattorizzazione di `useFileSync` fuori scope Sprint Z. Per ora la **persistenza c'e'** e abilita future feature (tray menu "Resume", diagnostica, supporto crash recovery client-side).

### B.5 Gap D — Esci da PC + propagazione cloud

**DB:**

- Migration `20260420030000_sprint_z_revoke_pair_self.sql` → RPC `rpc_revoke_pair_self(p_pair_token_hash)`. `SECURITY DEFINER`, `GRANT EXECUTE` solo a `service_role`. Marca `paired_devices.status='offline'` o `desktop_devices.revoked_at=now() / status='revoked'` a seconda della tabella matchata dall'hash.

**Edge Function:**

- Nuova funzione `supabase/functions/pair-revoke-self/index.ts` (Deno). Riceve `pair_token` plaintext via header `Authorization: Bearer`, calcola SHA256, chiama RPC con `service_role` key. CORS + rate limit (`check_and_record_edge_rate` scope `pair_revoke_self`).
- `supabase/config.toml`: `[functions.pair-revoke-self] verify_jwt = false` (la funzione fa auth via pair token, non via JWT utente).
- Smoke test deploy: chiamata curl senza bearer ritorna correttamente `401 {"error":"missing_bearer"}`.

**Frontend:**

- `revokePairTokenSelf(pairToken)` in `apps/web/src/features/devices/repository.ts` — fetch verso edge function.
- `RoomPlayerView.tsx`: in `handleDisconnect`, **prima** del cleanup locale (`localStorage` + `clearDevicePairing` Tauri), chiama `revokePairTokenSelf` fire-and-forget. Cosi' il pannello admin "Centri Slide" / "Mappa rete" vede il PC sparire dal riquadro online entro 1-2s, senza dover aspettare il timeout 30s di `derived_status='offline'`.

### B.6 Quality gate

- `npm run typecheck` → 5/5 task green
- `npm run lint` → 5/5 task green (1 fix lungo strada in `useNetworkMap.ts`: rimosso `setLoading(true)` dentro effect per regola `react-hooks/set-state-in-effect`).
- `npm run build` → 3/3 task green. NetworkMapView 18.17 kB / RoomPlayerView 62.15 kB.
- `ReadLints` su tutti i file modificati: 0 errori.

### B.7 File toccati (riepilogo)

```
supabase/migrations/
  20260418300000_quota_triggers_enterprise_aware.sql      [nuovo]
  20260418310000_perf_vacuum_schedule_weekly.sql          [nuovo]
  20260420010000_sprint_z_network_map_view.sql            [nuovo]
  20260420020000_sprint_z_move_paired_device.sql          [nuovo]
  20260420030000_sprint_z_revoke_pair_self.sql            [nuovo]

supabase/functions/pair-revoke-self/index.ts              [nuovo]
supabase/config.toml                                      [+ block verify_jwt=false]

apps/desktop/src-tauri/src/
  session_store.rs                                         [nuovo]
  main.rs                                                  [+ mod, + 2 commands]

apps/web/src/
  app/routes.tsx                                           [+ /network-map]
  app/shell/AppShell.tsx                                   [+ sidebar entry]
  features/network-map/repository.ts                       [nuovo]
  features/network-map/useNetworkMap.ts                    [nuovo]
  features/network-map/NetworkMapView.tsx                  [nuovo]
  features/devices/hooks/useLastSession.ts                 [nuovo]
  features/devices/repository.ts                           [+ revokePairTokenSelf]
  features/devices/RoomPlayerView.tsx                      [+ handleDisconnect cloud-side, + useLastSession integration]
  lib/desktop-bridge.ts                                    [+ LastSession types & wrappers]

packages/shared/src/
  types/database.ts                                        [rigenerato]
  types/validation-warning.ts                              [nuovo]
  i18n/locales/it.json + en.json                           [+ networkMap.* + nav.networkMap]

vercel.json                                               [CSP frame-src]
apps/web/vite.config.ts                                   [PWA cap]
```

### B.8 Note operative per il field test

- Il PC sala adesso si **disconnette in tempo reale** dal pannello admin appena l'operatore clicca "Esci dall'evento" (Gap D). Niente piu' "fantasmi online" per 30s.
- L'admin puo' **spostare** un PC paired tra eventi/sale dalla Mappa rete senza chiedere all'operatore di sala di rifare il pairing (Gap B). Utile se un'aula viene swappata last-minute.
- La **Mappa rete** unifica in un'unica vista PC sala (paired_devices) + Centro Slide promossi + provisioning desktop tokens registrati (desktop_devices). Filtri rapidi per evento/tipo/status (Gap A).
- I PC sala Tauri salvano in background l'ultima sessione (`~/.slidecenter/last-session.json`). Anche senza UX di restore al boot in questo sprint, il dato c'e' per le prossime iterazioni e per eventuale diagnostica post-mortem (Gap C).

---

## APPENDICE C — Changelog Sprint SR (Security Review) — completato 18/04/2026 sera

Sprint SR chiude i due interventi opzionali della Sezione 5.1 ancora aperti dopo Sprint Z: **§1.2** (rotazione `pair_token` desktop con scadenza esplicita) e **§2.3** (procedura operativa warm-keep delle Edge Functions hot path). Quality gate finale: typecheck OK (5/5 turbo task), lint OK (5/5 turbo task), `cargo check` Tauri OK, **10/10 unit test Rust** modulo `license` (inclusi 4 nuovi sui pair token expiry), build SPA OK, `ReadLints` 0 errori sui file modificati.

### C.1 §1.2 — Rotazione `pair_token` desktop_devices

#### DB

- **Migration `20260420040000_sprint_sr_pair_token_rotation.sql`** [nuovo]:
  - Colonna `desktop_devices.pair_token_expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '12 months'`. Backfill su righe esistenti `+12 months from now()`.
  - Indice parziale `idx_desktop_devices_active_token_expiry` su `(pair_token_expires_at)` `WHERE status='active'` per query email-cron O(N attivi).
  - **RPC `rpc_desktop_renew_token(p_old_pair_token_hash, p_new_pair_token_hash)`** — `SECURITY DEFINER`, `GRANT EXECUTE` solo a `service_role`. Atomic swap: verifica device attivo, sostituisce hash, resetta `pair_token_expires_at = now() + 12 months`, audit `activity_log` (`action='desktop_device.token_renew'`).
  - **RPC `rpc_admin_extend_desktop_token(p_device_id, p_extra_months DEFAULT 12)`** — admin/tech del tenant. Cap `extra_months` in `[1,60]`. Estende `pair_token_expires_at` (se gia' scaduto, riparte da `now()`). Audit log con `extra_months` e nuova scadenza.
  - **RPC `rpc_admin_list_expiring_desktop_devices(p_days_min, p_days_max, p_email_kind)`** — usata dal cron email. Ritorna devices con `pair_token_expires_at` nella finestra `[now()+days_min, now()+days_max)` E senza email gia' inviata per quella scadenza+kind (`email_log` join). Restituisce `tenant_id, tenant_name, device_id, device_name, machine_fingerprint, pair_token_expires_at, days_remaining, admin_email, admin_full_name`. Usata anche in solo lettura admin futuri.
  - Modifica `rpc_desktop_license_verify`: ora intercetta `pair_token_expires_at < now()` e ritorna `{error:'pair_token_expired', expires_at, days_overdue}` PRIMA del check `revoked` per dare un errore semanticamente corretto al client.
- **Migration `20260420050000_sprint_sr_cron_jwt_check_fix.sql`** [nuovo, fix authorization]:
  - Le RPC `list_tenants_for_license_warning` e `rpc_admin_list_expiring_desktop_devices` usavano solo `auth.jwt()->'app_metadata'->>'role' = 'super_admin'`. Quel check fallisce quando le chiama un'Edge Function con JWT `service_role` (no `app_metadata`). Patch: aggiunto `OR auth.jwt()->>'role' = 'service_role'`. Cosi' le funzioni cron non incorrono piu' in `forbidden_super_admin_only`.

#### Edge Functions (Deno)

- **`supabase/functions/desktop-license-renew/index.ts`** [nuova]:
  - POST con header `Authorization: Bearer <old_pair_token>` + body `{ new_pair_token_hash, app_version?, machine_fingerprint? }`.
  - Calcola SHA256 dell'old token, chiama `rpc_desktop_renew_token` con `service_role`. Rate limit (`check_and_record_edge_rate` scope `desktop_license_renew`). CORS allow-list standard. Mappa errori RPC → HTTP code (`pair_token_not_found`→404, `pair_token_revoked`→409, `pair_token_expired`→410, `service_unavailable`→503).
  - `verify_jwt: false` (auth via pair token, non via JWT utente).
- **`supabase/functions/desktop-license-verify/index.ts`** [modifica]:
  - `errorCodeMap` esteso con `pair_token_expired: 410`. Cosi' il client Tauri riceve uno status code semantico per attivare il flow di rinnovo (auto-renew o banner UI).
- **`supabase/functions/email-cron-desktop-tokens/index.ts`** [nuova]:
  - Cron giornaliero (suggerito 09:00 CEST tramite `pg_cron` esterno o Supabase Cron). Chiama `rpc_admin_list_expiring_desktop_devices` per ognuna delle 3 finestre 30/14/7 giorni con `email_kind` distinto (`desktop-token-expiring-30/14/7`). Per ogni riga manda mail tramite `email-send` con `idempotency_key = sha256(device_id||expires_at||kind)`.
  - `verify_jwt: false` (chiamata da cron HTTP).
- **`supabase/functions/email-send/index.ts`** [estensione]:
  - `EmailKind` union allargato + `KIND_DEFAULTS` con i 3 nuovi `desktop-token-expiring-30 / -14 / -7`. Stesso template `desktop_token_expiring` riusa l'email body con segments per giorni residui. Idempotenza intatta su `(tenant_id, kind, idempotency_key)` in `email_log`.

#### Frontend admin SPA

- **`apps/web/src/features/desktop-devices/repository.ts`** [estensione]:
  - DTO `DesktopDevice` aggiunge `pair_token_expires_at: string`.
  - Funzione helper `classifyDesktopTokenExpiry(device, nowMs): 'expired'|'expiring_soon'|'ok'|'na'` per la badge logica (≤30g = warning, scaduto = danger).
  - Wrapper RPC `extendDesktopDeviceToken({ deviceId, extraMonths })` → `rpc_admin_extend_desktop_token`.
- **`apps/web/src/features/desktop-devices/components/DesktopDevicesView.tsx`** [estensione]:
  - Nuova colonna "Scadenza pair_token" con badge stato (verde/giallo/rosso/grigio) e formattazione `it-IT` data + giorni residui.
  - Pulsante "Estendi 12 mesi" per device `expiring_soon`/`expired`. Mostra success toast con nuova `pair_token_expires_at`.
- **`apps/web/src/components/DesktopLicenseBanner.tsx`** [estensione]:
  - 2 nuove varianti `pairTokenExpiring` (warn, CTA "Rinnova ora") e `pairTokenExpired` (danger, CTA "Vai a licenza").
  - "Rinnova ora" chiama `renewDesktopLicenseNow()` (Tauri command) con spinner.
- **`apps/web/src/features/desktop-license/DesktopLicenseView.tsx`** [estensione]:
  - `StatusCard` mostra `pair_token_expires_at` formattato + giorni residui per i nuovi stati.
  - Bottone "Rinnova chiave" disponibile per stato `active`/`pairTokenExpiring` (anche manuale, non solo auto).

#### Tauri client (Rust)

- **`apps/desktop/src-tauri/src/license/types.rs`** [estensione]:
  - `LicenseData` + `pair_token_expires_at: Option<String>` + `last_renew_attempt_at: Option<String>`.
  - `VerifyResponse` + `pair_token_expires_at`, `pair_token_expires_in_days`, `pair_token_status`.
  - Nuove struct `RenewRequest` + `RenewResponse`.
  - `LicenseStatus` + variant `PairTokenExpiring { days_remaining, expires_at }` + `PairTokenExpired { expires_at }`.
- **`apps/desktop/src-tauri/src/license/client.rs`** [estensione]:
  - `LicenseClientError::PairTokenExpired` + map error code.
  - Metodo `renew(&self, old_pair_token, RenewRequest) -> RenewResponse` chiama `desktop-license-renew`.
- **`apps/desktop/src-tauri/src/license/manager.rs`** [refactor + nuova logica]:
  - Costanti `PAIR_TOKEN_EXPIRING_SOON_DAYS = 7` e `RENEW_COOLDOWN_SECONDS = 6 * 3600`.
  - `bind` inizializza `pair_token_expires_at = now() + 12 months`.
  - `verify_now` persiste `pair_token_expires_at` ricevuto dal verify response.
  - **`renew_now()` [nuovo metodo async pubblico]**: genera nuovo pair_token random (32 bytes hex), calcola sha256, chiama `client.renew()`, su 200 OK aggiorna atomicamente `LicenseData.pair_token` + `pair_token_hash` + `pair_token_expires_at` su disco; su errore aggiorna solo `last_renew_attempt_at` per cooldown.
  - `classify` interpreta `pair_token_expires_at`: `<=0gg` → `PairTokenExpired`, `<=7gg` → `PairTokenExpiring`, altrimenti stato precedente.
  - **`should_attempt_auto_renew()` [nuovo metodo]**: ritorna `true` solo se stato `PairTokenExpiring`/`PairTokenExpired` AND ultimo tentativo > cooldown. Cosi' evitiamo retry burst su rete instabile.
  - Helper privati: `parse_pair_token_expiry`, `sha256_hex`, `hex_encode`.
  - **Test unitari** [4 nuovi]: `pair_token_expiring_soon_within_7_days`, `pair_token_expired_when_past`, `pair_token_unknown_when_field_missing`, `pair_token_ok_when_far_in_future`, `sha256_hex_known_vector`. Tutti verdi (10/10 nel modulo `license`).
- **`apps/desktop/src-tauri/src/license/heartbeat.rs`** [estensione]:
  - Background loop dopo `verify_now()` chiama `should_attempt_auto_renew()` e se `true` invoca `renew_now()` con timeout. Log success/failure/timeout taggati.
- **`apps/desktop/src-tauri/src/license/commands.rs`** [estensione]:
  - Tauri command `cmd_license_renew_now` esposto al SPA (per il bottone manuale e per la CTA del banner).
- **`apps/desktop/src-tauri/src/main.rs`** [+ registrazione]:
  - `cmd_license_renew_now` aggiunto a `tauri::generate_handler!`.

#### Web bridge SPA

- **`apps/web/src/lib/desktop-bridge.ts`** [estensione]:
  - `DesktopLicenseStatus` union estesa con `pairTokenExpiring` + `pairTokenExpired`.
  - `renewDesktopLicenseNow(): Promise<void>` wrapper di `cmd_license_renew_now`. In cloud (`isRunningInTauri()` false) lancia `Error('not_in_tauri')` per rendere il bottone safe.

#### i18n

- **`packages/shared/src/i18n/locales/it.json` + `en.json`** [estensioni]:
  - `desktopLicense.banner.pairTokenExpiringTitle/Hint/Cta`
  - `desktopLicense.banner.pairTokenExpiredTitle/Hint/Cta`
  - `desktopLicense.status.pairTokenExpiring/pairTokenExpired/pairTokenExpiresAt/pairTokenDaysRemaining`
  - `desktopLicense.actions.renewNow/renewing/renewOk/renewError/renewTooltip`
  - Stringhe IT scritte da Andrea, EN ottenute con stesso pattern professionale del resto della doc i18n.

#### Tipi DB rigenerati

- **`packages/shared/src/types/database.ts`** rigenerato via MCP plugin Supabase post-migration. Verificato presence di:
  - `desktop_devices.pair_token_expires_at: string` (Row + Insert)
  - `rpc_desktop_renew_token`, `rpc_admin_extend_desktop_token`, `rpc_admin_list_expiring_desktop_devices` con firme tipate.
- Risolto problema di stale `dist/` durante quality gate: la directory `packages/shared/dist` precedente conteneva `database.d.ts` vecchio e i project references TS lo prendevano al posto del source. Fix: `Remove-Item -Recurse packages/shared/dist` + `tsc --build --force`. Nota per il futuro: se rigeneri `database.ts`, rebuilda anche `@slidecenter/shared` o cancella `dist/` prima del typecheck.

### C.2 §2.3 — Documentazione warm-keep Edge Functions

- **`docs/EDGE_FUNCTIONS_WARM_KEEP.md`** [nuovo].
- Contenuto:
  - Razionale (Deno cold start ~300ms + esperienza P95 reale)
  - Trigger di attivazione: latenza P95 sostained >500ms su almeno 1 funzione hot path (criterio go/no-go) + costo zero (cron-job.org free tier 50 jobs)
  - Lista funzioni hot path: `room-player-bootstrap`, `room-player-set-current`, `room-device-upload-init`, `room-device-upload-finalize`, `desktop-license-verify`, `email-cron-licenses` (tap occasionale, opzionale)
  - Endpoint da pingare (URL pattern Supabase + body POST minimale per ogni funzione, con header `Authorization: Bearer <anon_key>` quando `verify_jwt=true`)
  - Setup cron-job.org passo-passo (signup gratuito, creazione job, schedule `*/5 * * * *`, alert email su fail)
  - Stima costi: 0€ entro free tier (6 jobs su 50 disponibili). Tempo setup: ~15 min.
  - Procedura di **disattivazione** (in caso di refactor o spostamento su Supabase Cron interno).
  - Riferimenti tecnici: Deno cold start docs, Supabase Edge Functions limits, cron-job.org HTTP timeouts.

### C.3 Quality gate finale Sprint SR

- `pnpm typecheck` → 5/5 task green (`@slidecenter/shared`, `@slidecenter/ui`, `@slidecenter/web`, `@slidecenter/agent-build`, `@slidecenter/room-agent-build`).
- `pnpm lint` → 5/5 task green.
- `pnpm --filter @slidecenter/web build` → OK (135 entries precache, sw.js generato, sentry skip silent).
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` → OK 0 warning rilevanti.
- `cargo test --bin slide-center-desktop license::manager::` → **10/10 passed** (inclusi 4 nuovi test pair_token + 1 sha256_hex + 5 preesistenti). 0 failed, 0 ignored.
- `ReadLints` su 18 file modificati → 0 errori.

### C.4 File toccati Sprint SR (riepilogo)

```
supabase/migrations/
  20260420040000_sprint_sr_pair_token_rotation.sql        [nuovo]
  20260420050000_sprint_sr_cron_jwt_check_fix.sql         [nuovo, patch authorization]

supabase/functions/
  desktop-license-renew/index.ts                          [nuovo]
  desktop-license-verify/index.ts                         [+ pair_token_expired:410]
  email-cron-desktop-tokens/index.ts                      [nuovo, cron 30/14/7gg]
  email-send/index.ts                                     [+ 3 nuove EmailKind + KIND_DEFAULTS]

apps/desktop/src-tauri/src/license/
  types.rs                                                [+ expires_at, RenewRequest/Response, 2 nuovi LicenseStatus]
  client.rs                                               [+ PairTokenExpired, renew()]
  manager.rs                                              [+ renew_now, classify expiry, should_attempt_auto_renew, 4 test]
  heartbeat.rs                                            [+ auto-renew dopo verify]
  commands.rs                                             [+ cmd_license_renew_now]
apps/desktop/src-tauri/src/main.rs                        [+ register cmd_license_renew_now]

apps/web/src/
  features/desktop-devices/repository.ts                  [+ pair_token_expires_at, classify, extendDesktopDeviceToken]
  features/desktop-devices/components/DesktopDevicesView.tsx [+ colonna scadenza + estendi 12 mesi]
  features/desktop-license/DesktopLicenseView.tsx         [+ render expiry + bottone Rinnova chiave]
  components/DesktopLicenseBanner.tsx                     [+ 2 varianti pairTokenExpiring/Expired + CTA renew]
  lib/desktop-bridge.ts                                   [+ DesktopLicenseStatus expiry, renewDesktopLicenseNow]

packages/shared/src/
  types/database.ts                                       [rigenerato post-migration SR]
  i18n/locales/it.json + en.json                          [+ desktopLicense.banner/status/actions x SR]

docs/EDGE_FUNCTIONS_WARM_KEEP.md                          [nuovo - procedura cron-job.org]
docs/AUDIT_FINALE_E_PIANO_TEST_v1.md                      [v1.1 → v1.2: §1.2 + §2.3 chiusi, APPENDICE C aggiunta]
```

### C.5 Note operative per il field test

- **Bind nuovi PC desktop**: il `pair_token` adesso ha scadenza esplicita 12 mesi visibile nella colonna "Scadenza" della tab Centri Slide. Nessuna azione manuale richiesta al bind: la scadenza si imposta da default DB.
- **Auto-renew silenzioso**: i PC desktop sotto Tauri tentano il rinnovo da soli 7 giorni prima della scadenza durante l'heartbeat 24h. Se il PC e' offline il giorno dello scadere, alla prima riconnessione il rinnovo parte. Cooldown 6h tra tentativi falliti per non bersagliare l'edge function su rete instabile.
- **Email warning escalation**: a 30/14/7 giorni dalla scadenza l'admin del tenant riceve email idempotente. Se rinnova prima della soglia successiva, le mail successive non partono (RPC `rpc_admin_list_expiring_desktop_devices` esclude device gia' rinnovati).
- **Safety net manuale**: dal pannello "Centri Slide" admin/tech possono cliccare "Estendi 12 mesi" su qualsiasi device per spostare avanti la scadenza. Utile per device "fuori sede" senza accesso internet stabile o per device legacy che faticano a fare auto-renew.
- **Banner UI Tauri**: se la scadenza e' < 7 giorni e l'auto-renew non e' riuscito, l'utente vede banner sticky giallo "La chiave sta scadendo" con bottone "Rinnova ora". Se gia' scaduto, banner rosso "Chiave scaduta" che porta a Licenza per intervento.
- **Warm-keep edge functions**: NON ancora attivato. Andrea attiva i 6 cron job su cron-job.org (15 minuti di setup, costo zero) **solo se** durante il field test reale Sentry mostra cold start sopra 500ms. Vedi `docs/EDGE_FUNCTIONS_WARM_KEEP.md`.

### C.6 Cosa rimane fuori scope Sprint SR

- **Fingerprint binding**: il pair_token non e' legato al `machine_fingerprint`. Se qualcuno ruba `device.json` da un PC e lo mette su un altro PC con stesso `pair_token`, l'altro PC funziona finche' non si tenta il rinnovo (che potrebbe accorgersene se passassimo il fingerprint al renew RPC e validassimo). Questo e' fuori scope SR perche' richiederebbe cambi cross-funzione di policy. Da considerare in uno Sprint security review +6 mesi se rilevato come rischio reale.
- **Audit dashboard centralizzato eventi licenza**: `activity_log` accumula `desktop_device.token_renew` / `desktop_device.token_extend` / `desktop_device.revoke`, ma non c'e' una vista admin "ultimi 30 eventi licenza tenant X". Per ora si interroga via SQL o pannello Supabase. Buon candidato per uno Sprint UX successivo se il volume di clienti cresce.
- **Forced rotation policy custom per tenant**: tutti i tenant ereditano default 12 mesi. Se enterprise B2B chiedesse 6 o 24 mesi, richiede `tenants.desktop_pair_token_ttl_months` + lettura nel default. Non urgente con clientela attuale.
