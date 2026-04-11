# Live SLIDE CENTER — Guida Architetturale Completa

> **Versione:** 2.0 — Aprile 2026
> **Autore:** CTO Ecosistema Andrea Rizzari
> **Stato:** Pronto per implementazione da zero
> **Progetto:** SaaS multi-tenant per gestione presentazioni eventi live
> **Nome prodotto:** Live SLIDE CENTER
> **Account GitHub:** live-software11
> **Licenze:** via Live WORKS APP (Lemon Squeezy)

---

## 1. Vision & Obiettivo

Live SLIDE CENTER e il **Presentation & Projection Management System (PPMS)** dell'ecosistema Live Software. Gestisce l'intero ciclo di vita delle presentazioni in eventi live: raccolta file dai relatori, distribuzione alle sale, versioning in tempo reale, e funzionamento offline garantito.

**Problema risolto:** oggi la gestione slide in eventi si basa su cartelle condivise, USB, email. I tecnici non sempre hanno competenze IT avanzate. Serve un'interfaccia grafica professionale che crei automaticamente l'infrastruttura di rete, gestisca le versioni, e restituisca al cliente tutti i contenuti a fine evento.

**Target utenti:**

- **Aziende AV / service tecnici** (come DHS, Studio Visio, Tecnoconference)
- **Organizzatori congressi** (PCO, centri congressi)
- **Tecnici di sala** (operatori proiezione, regia)
- **Relatori/speaker** (upload e verifica presentazioni)

---

## 2. Analisi Competitiva

### Concorrenti diretti

| Prodotto         | Azienda                      | Punti di forza                                                                                 | Limiti                                                            |
| ---------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **SLIDEbit**     | TC Group / Meetbit (Firenze) | PPMS completo, e-lectern, SENDbit per upload remoto, 25+ anni nel settore congressi medicali   | Software proprietario chiuso, pricing opaco, no SaaS self-service |
| **Slidecrew**    | Slidecrew (Olanda)           | SaaS moderno, local caching server, app per tecnici/moderatori/kiosk, timer integrato, ePoster | Pricing per evento/sala/giorno, no controllo proiezione nativo    |
| **Preseria**     | Preseria (Norvegia)          | Upload intuitivo, desktop app Windows/Mac, sync veloce, offline mode                           | Meno funzionalita di regia, no multi-projection                   |
| **PresenterHub** | AVFX (USA)                   | Enterprise-grade, sync tra server e breakout rooms, network management                         | Solo mercato USA, non SaaS open                                   |

### Differenziatori di Live SLIDE CENTER

1. **SaaS self-service italiano** — primo PPMS SaaS in lingua italiana con UX moderna
2. **Offline-first architecture** — non un add-on, ma il principio architetturale
3. **Integrazione ecosistema Live Software** — Timer, Teleprompter, Ledwall Render, CREW
4. **Versioning granulare** — ogni modifica tracciata, rollback istantaneo, hash SHA-256
5. **Zero configurazione rete** — il Local Agent crea automaticamente l'infrastruttura LAN
6. **Export completo fine evento** — ZIP con tutti i file + report attivita + CSV log

---

## 3. Decisioni Architetturali (ADR)

### ADR-001: Supabase invece di Firebase

**Contesto:** L'ecosistema usa Firebase per PLAN/CREW/WORKS. Per SLIDE CENTER i requisiti sono diversi.

**Decisione:** Supabase (PostgreSQL + Auth + Realtime + Storage + Edge Functions).

**Motivazioni:**

- **Modello relazionale**: eventi → sale → sessioni → speaker → presentazioni → versioni. Questo e intrinsecamente relazionale con query complesse (join, aggregazioni, filtri multi-livello). PostgreSQL eccelle; Firestore richiederebbe denormalizzazione estrema.
- **Upload TUS nativo**: Supabase Storage implementa il protocollo TUS per upload resumable. Firebase Storage no.
- **RLS potente**: Row-Level Security di PostgreSQL per multi-tenancy e piu espressivo delle Firestore Security Rules per query complesse.
- **SQL per analytics**: query aggregate (quanti file per evento, storage per tenant, report) sono banali in SQL, complesse in Firestore.
- **Pricing prevedibile**: $25/mese Pro vs pay-per-operation Firebase. Con TB di dati, la prevedibilita e critica per un SaaS.
- **Self-hosting futuro**: Supabase e open-source (Apache 2.0). Se un giorno servisse on-premises per clienti enterprise, si puo.

**Trade-off accettato:** Andrea deve imparare Supabase. Ma i concetti (auth, storage, realtime, edge functions) mappano 1:1 su Firebase. La curva di apprendimento e minima.

### ADR-002: Supabase Storage per file blob (MVP e oltre)

**Contesto:** I file sono grandi (fino a 2GB/file, 1TB/evento). Lo storage deve essere economico e integrato con Auth/RLS.

**Decisione:** Supabase Storage come storage blob primario. Cloudflare R2 come upgrade futuro quando i costi lo giustificano.

**Motivazioni:**

- **Integrazione nativa Auth**: le Storage Policies usano lo stesso JWT tenant-scoped di Postgres. Zero configurazione aggiuntiva per isolare i file per tenant.
- **TUS nativo**: upload resumable fino a 500GB/file su piano Pro (chunk fissi 6MB).
- **S3 protocol compatibile**: presigned URL via SigV4, multipart upload, `@aws-sdk/client-s3` — identico a R2/S3.
- **Un solo servizio**: DB + Auth + Realtime + Storage + Edge Functions in un unico piano Supabase.
- **Migrazione futura trasparente**: cambia endpoint da `supabase.co/storage/v1/s3` a `r2.cloudflarestorage.com` — il codice non cambia.

**Perche non R2 adesso**: aggiunge un secondo account (Cloudflare), carte di credito separate, API keys separate, senza vantaggio reale fino a quando l'egress mensile non supera $50 (= 10+ clienti attivi con TB di scaricamenti). In fase MVP, Supabase Storage e gratuito fino a 50MB/file (Free tier) e $25/mese per Pro (500GB/file).

**Flusso upload**: Speaker → TUS endpoint Supabase Storage → Edge Function → `presentation_versions` + Realtime.

**Upgrade path**: quando egress > $50/mese → Cloudflare R2 (stesso SDK S3, migrazione 1 giorno). Vedere `docs/GUIDA_DEFINITIVA_PROGETTO.md` §2 per analisi completa.

### ADR-003: Tauri v2 per app desktop (Agent + Player)

**Contesto:** Serve un'app desktop per il Local Agent (server LAN) e per il Room Player.

**Decisione:** Tauri v2 con backend Rust (Axum per HTTP server).

**Motivazioni:**

- **Esperienza esistente**: Andrea ha gia Tauri v2 (Ledwall Render) e Tauri v1 + Axum (Speaker Timer).
- **Performance**: Rust per file I/O, HTTP server, e sync e significativamente piu performante di Electron/Node.js.
- **Dimensione installer**: ~10MB vs ~150MB di Electron.
- **Axum per LAN server**: il Local Agent espone un server HTTP sulla LAN per servire file alle sale. Axum in Rust e ideale.
- **SQLite nativo**: `rusqlite` nel processo principale, zero overhead.

**Struttura desktop:**

- **Local Agent**: Tauri v2 + Axum (0.0.0.0:8080) + rusqlite + file cache
- **Room Player**: Tauri v2 (leggero) → connesso ad Agent via LAN

### ADR-004: React 19 + Vite (non Next.js)

**Decisione:** React 19 + Vite 8 + React Router 7, non Next.js 15.

**Motivazioni:**

- **Coerenza ecosistema**: tutti i progetti usano React + Vite (PLAN, CREW, WORKS, Ledwall, Timer).
- **No SSR necessario**: e una dashboard operativa, non un sito pubblico. Non serve SEO. Non serve SSR.
- **DX superiore**: Vite e piu veloce, configurazione piu semplice, meno "magia" nascosta.
- **Deploy flessibile**: Firebase Hosting, Vercel, Netlify, qualsiasi CDN statica.

### ADR-005: Lemon Squeezy via Live WORKS APP per licensing

**Decisione:** Lemon Squeezy (non Stripe diretto) tramite la piattaforma Live WORKS APP.

**Motivazioni:**

- **Coerenza**: tutte le app desktop della suite usano Live WORKS APP per licenze.
- **Merchant of Record**: Lemon Squeezy gestisce IVA/tasse internazionali.
- **Infrastruttura esistente**: webhook, portale clienti, gestione abbonamenti gia implementati.

---

## 4. Stack Tecnologico

### Web Dashboard + Upload Portal

| Componente       | Tecnologia                  | Versione    |
| ---------------- | --------------------------- | ----------- |
| Framework UI     | React                       | 19          |
| Build tool       | Vite                        | 8           |
| Linguaggio       | TypeScript                  | strict mode |
| Styling          | Tailwind CSS                | 4           |
| Componenti UI    | shadcn/ui + Radix           | latest      |
| Routing          | React Router                | 7           |
| State management | Zustand                     | latest      |
| Table/list       | TanStack Table              | latest      |
| Form validation  | Zod + React Hook Form       | latest      |
| Backend/DB       | Supabase (PostgreSQL)       | latest      |
| Auth             | Supabase Auth               | latest      |
| Realtime         | Supabase Realtime           | latest      |
| Upload           | tus-js-client + use-tus     | latest      |
| Date/calendar    | date-fns + react-day-picker | latest      |
| i18n             | i18next + react-i18next     | latest      |

### File Storage

| Componente | Tecnologia | Note |
| ---- | --- | --- |
| Blob storage MVP e Pro | Supabase Storage | TUS nativo (6MB chunk), S3-compatible, fino a 500GB/file (Pro) |
| Blob storage a scala | Cloudflare R2 | Zero egress, stessa API S3 — upgrade quando egress > $50/mese |
| Upload protocol | TUS (RFC 7230) | Resumable, pause/resume, retry automatico |
| Integrity | SHA-256 client-side | Calcolato prima dell'upload, verificato al download |

### Desktop — Local Agent

| Componente        | Tecnologia           | Note                                                     |
| ----------------- | -------------------- | -------------------------------------------------------- |
| Framework         | Tauri v2             | Rust backend + webview                                   |
| HTTP server LAN   | Axum                 | Bind 0.0.0.0, serve file alle sale                       |
| Database locale   | SQLite (rusqlite)    | WAL mode, cache metadata + stato sync                    |
| File cache        | Filesystem locale    | Struttura: `{event_id}/{presentation_id}/{version}/file` |
| Sync engine       | Reqwest + tokio      | Pull periodico + realtime via WebSocket                  |
| Service discovery | mDNS (mdns-sd crate) | Agent si annuncia sulla rete locale                      |

### Desktop — Room Player

> **NOTA ARCHITETTURALE (Aprile 2026):** Il Room Player NON e un'app Tauri separata. E una **Progressive Web App (PWA)** — una route dedicata `/sala/:token` in `apps/web/`. Il tecnico apre un URL nel browser (Chrome/Edge propone "Installa come app"). Zero installazione, zero mDNS, zero compilazione Rust. Vedi `docs/GUIDA_DEFINITIVA_PROGETTO.md` §3 per dettagli. La directory `apps/player/` NON deve essere creata come progetto Tauri.

| Componente | Tecnologia | Note |
| --- | --- | --- |
| Runtime | Browser (Chrome/Edge/Safari) | PWA installabile — nessun binario da distribuire |
| Service worker | Workbox (via vite-plugin-pwa) | Cache offline, background sync |
| Connessione cloud | Supabase Realtime + REST | Connessione diretta se internet disponibile |
| Connessione LAN | HTTP fetch verso Agent | Fallback se Agent disponibile sulla LAN |
| Cache locale | Cache API (service worker) | File corrente disponibile offline |

### Deploy

| Deploy         | Piattaforma               | Note                                 |
| -------------- | ------------------------- | ------------------------------------ |
| Web dashboard  | Vercel                    | SPA statica                          |
| Room Player    | Vercel (PWA route /sala)  | Parte della stessa web app           |
| Edge Functions | Supabase Edge Functions   | Deno runtime                         |
| Local Agent    | Installer NSIS (Windows)  | Auto-update via tauri-plugin-updater |

---

## 5. Schema Database (PostgreSQL via Supabase)

### Migration iniziale: `supabase/migrations/20250411090000_init_slide_center.sql`

```sql
-- ============================================================
-- LIVE SLIDE CENTER — Schema Multi-Tenant
-- ============================================================

-- ENUM types
CREATE TYPE tenant_plan AS ENUM ('trial', 'starter', 'pro', 'enterprise');
CREATE TYPE user_role AS ENUM ('admin', 'tech', 'coordinator');
CREATE TYPE event_status AS ENUM ('draft', 'setup', 'active', 'closed', 'archived');
CREATE TYPE room_type AS ENUM ('main', 'breakout', 'preview', 'poster');
CREATE TYPE session_type AS ENUM ('talk', 'panel', 'workshop', 'break', 'ceremony');
CREATE TYPE presentation_status AS ENUM ('pending', 'uploaded', 'reviewed', 'approved', 'rejected');
CREATE TYPE version_status AS ENUM ('uploading', 'processing', 'ready', 'failed', 'superseded');
CREATE TYPE sync_status AS ENUM ('synced', 'syncing', 'outdated', 'offline');
CREATE TYPE connection_status AS ENUM ('online', 'offline', 'degraded');
CREATE TYPE actor_type AS ENUM ('user', 'speaker', 'agent', 'system');
CREATE TYPE upload_source AS ENUM ('web_portal', 'preview_room', 'agent_upload');

-- TENANTS
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan tenant_plan NOT NULL DEFAULT 'trial',
  ls_customer_id TEXT,
  ls_subscription_id TEXT,
  storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  storage_limit_bytes BIGINT NOT NULL DEFAULT 107374182400, -- 100 GB
  max_events_per_month INT NOT NULL DEFAULT 2,
  max_rooms_per_event INT NOT NULL DEFAULT 5,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- USERS (linked to Supabase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'tech',
  avatar_url TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_tenant ON users(tenant_id);

-- EVENTS
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  location TEXT,
  venue TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
  status event_status NOT NULL DEFAULT 'draft',
  settings JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_tenant ON events(tenant_id);
CREATE INDEX idx_events_status ON events(tenant_id, status);
CREATE INDEX idx_events_dates ON events(start_date, end_date);

-- ROOMS
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  floor TEXT,
  capacity INT,
  display_order INT NOT NULL DEFAULT 0,
  room_type room_type NOT NULL DEFAULT 'main',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rooms_event ON rooms(event_id);

-- SESSIONS
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_en TEXT,
  session_type session_type NOT NULL DEFAULT 'talk',
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  chair_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_room ON sessions(room_id);
CREATE INDEX idx_sessions_event ON sessions(event_id);
CREATE INDEX idx_sessions_schedule ON sessions(room_id, scheduled_start);

-- SPEAKERS
CREATE TABLE speakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  job_title TEXT,
  bio TEXT,
  upload_token TEXT UNIQUE,
  upload_token_expires_at TIMESTAMPTZ,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_speakers_session ON speakers(session_id);
CREATE INDEX idx_speakers_event ON speakers(event_id);
CREATE INDEX idx_speakers_token ON speakers(upload_token) WHERE upload_token IS NOT NULL;

-- PRESENTATIONS
CREATE TABLE presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  speaker_id UUID NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_version_id UUID,
  total_versions INT NOT NULL DEFAULT 0,
  status presentation_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_presentations_speaker ON presentations(speaker_id);
CREATE INDEX idx_presentations_session ON presentations(session_id);
CREATE INDEX idx_presentations_event ON presentations(event_id);

-- PRESENTATION VERSIONS (append-only, immutabile)
CREATE TABLE presentation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  file_hash_sha256 TEXT,
  mime_type TEXT NOT NULL,
  uploaded_by_speaker BOOLEAN NOT NULL DEFAULT true,
  uploaded_by_user_id UUID REFERENCES users(id),
  upload_source upload_source NOT NULL DEFAULT 'web_portal',
  status version_status NOT NULL DEFAULT 'uploading',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(presentation_id, version_number)
);
CREATE INDEX idx_versions_presentation ON presentation_versions(presentation_id);
CREATE INDEX idx_versions_status ON presentation_versions(status);

-- FK differita per evitare dipendenza circolare
ALTER TABLE presentations
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id) REFERENCES presentation_versions(id);

-- ROOM STATE (stato real-time di ogni sala)
CREATE TABLE room_state (
  room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_session_id UUID REFERENCES sessions(id),
  current_presentation_id UUID REFERENCES presentations(id),
  current_version_id UUID REFERENCES presentation_versions(id),
  sync_status sync_status NOT NULL DEFAULT 'offline',
  agent_connection connection_status NOT NULL DEFAULT 'offline',
  last_sync_at TIMESTAMPTZ,
  assigned_agent_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LOCAL AGENTS
CREATE TABLE local_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  machine_id TEXT,
  lan_ip TEXT,
  lan_port INT NOT NULL DEFAULT 8080,
  status connection_status NOT NULL DEFAULT 'offline',
  last_heartbeat TIMESTAMPTZ,
  cached_files_count INT NOT NULL DEFAULT 0,
  cached_size_bytes BIGINT NOT NULL DEFAULT 0,
  agent_version TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agents_event ON local_agents(event_id);

-- ACTIVITY LOG (audit trail)
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id),
  actor actor_type NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_event ON activity_log(event_id, created_at DESC);
CREATE INDEX idx_activity_tenant ON activity_log(tenant_id, created_at DESC);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Helper: tenant_id dal JWT (schema public — compatibile con PostgREST/Supabase).
-- EN: Reads tenant UUID from JWT `app_metadata.tenant_id` or `user_metadata.tenant_id`.
CREATE OR REPLACE FUNCTION public.app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(trim(both '"' from (auth.jwt() -> 'app_metadata' ->> 'tenant_id')), '')::uuid,
    NULLIF(trim(both '"' from (auth.jwt() -> 'user_metadata' ->> 'tenant_id')), '')::uuid
  );
$$;

-- Policy pattern: ogni tabella con tenant_id ha la stessa policy base
-- Esempio per events (replicare per tutte le tabelle con tenant_id):

CREATE POLICY tenant_isolation ON events
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON rooms
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON sessions
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON speakers
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON presentations
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON presentation_versions
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON room_state
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON local_agents
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON activity_log
  FOR ALL USING (tenant_id = public.app_tenant_id());

-- Users: accesso al proprio tenant
CREATE POLICY tenant_isolation ON users
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON tenants
  FOR ALL USING (id = public.app_tenant_id());

-- ============================================================
-- SUPABASE REALTIME
-- ============================================================
-- Abilitare realtime su queste tabelle per la dashboard live:
-- room_state, presentation_versions, local_agents, activity_log

-- ============================================================
-- FUNZIONI TRIGGER
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON presentations
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON local_agents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON room_state
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Auto-increment version_number
CREATE OR REPLACE FUNCTION auto_version_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version_number = COALESCE(
    (SELECT MAX(version_number) FROM presentation_versions
     WHERE presentation_id = NEW.presentation_id), 0
  ) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_version_number BEFORE INSERT ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION auto_version_number();
```

---

## 6. Architettura Sync & Offline

### Principio fondamentale

Il **cloud e la fonte di verita** per i metadati e le versioni. Il **Local Agent e la fonte di verita operativa** per la distribuzione in sala. Il **Room Player** e un consumatore che mostra sempre la versione piu recente disponibile.

### Flusso di upload

```
Speaker ──[internet]──> Upload Portal (web)
                              │
                              ▼
                      TUS Upload → Supabase Storage / R2
                              │
                              ▼
                      Edge Function:
                        • Crea record presentation_version
                        • Calcola/verifica SHA-256
                        • Aggiorna presentations.current_version_id
                        • Incrementa presentations.total_versions
                        • Emette evento Realtime
                        • Logga in activity_log
```

### Flusso di sync Cloud → Agent

```
Cloud (Supabase) ──[internet]──> Local Agent (Tauri v2)
                                       │
            ┌──────────────────────────┘
            ▼
    1. Agent si autentica con JWT (service token per tenant+evento)
    2. Agent sottoscrive Supabase Realtime:
       - presentation_versions (nuove versioni)
       - room_state (cambi assegnazione)
       - sessions (modifiche programma)
    3. Su nuova versione:
       a. Download file da Storage (presigned URL)
       b. Salva in filesystem locale: {cache_dir}/{event_id}/{pres_id}/v{n}/{filename}
       c. Verifica SHA-256
       d. Aggiorna SQLite locale
       e. Report sync_status = 'synced' al cloud
    4. Heartbeat ogni 30 secondi → aggiorna last_heartbeat su cloud
```

### Flusso di sync Agent → Room Player

```
Local Agent ──[LAN HTTP]──> Room Player (Tauri v2)
                                  │
           ┌──────────────────────┘
           ▼
   1. Player si connette all'Agent via mDNS discovery o IP manuale
   2. Player richiede manifesto: GET /api/v1/rooms/{room_id}/manifest
      Response: { current_version: {...}, session: {...}, sync_status: "synced" }
   3. Player scarica file se versione diversa dalla locale:
      GET /api/v1/files/{version_id}/download
   4. Player mostra in overlay:
      - Versione corrente e totale (es. "v4 di 4")
      - Stato sync (synced/outdated/offline)
      - Ultimo aggiornamento
   5. Polling ogni 5 secondi per aggiornamenti
      (futuro: WebSocket per push immediato)
```

### Scenari offline

| Scenario                                | Comportamento                                   | Indicatore UI                                                  |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| **Agent ONLINE, Room ONLINE**           | Sync completo, ultima versione                  | `ONLINE` verde — "v4 di 4 — Sync 14:32"                        |
| **Agent ONLINE, Room DISCONNESSA**      | Room usa cache locale                           | `DISCONNESSO` rosso — "v3 di 4 — Ultima sync 12:15"            |
| **Agent OFFLINE, Room su LAN**          | Agent serve cache, room aggiornata su LAN       | `LAN ONLY` giallo — "v3 di 3 locali — Cloud non raggiungibile" |
| **Speaker carica mentre Agent offline** | Cloud salva v4, Agent non la ha ancora          | Dashboard: "v4 disponibile, Agent offline"                     |
| **Agent torna online**                  | Pull automatico versioni mancanti → push a room | Transizione da giallo a verde                                  |
| **Room torna su LAN**                   | Auto-sync da Agent, verifica versione           | Transizione da rosso a verde                                   |

### Conflict resolution

**Regola semplice: il cloud vince sempre.** Non esiste editing concorrente — i file sono immutabili (append-only versions). L'unico "conflitto" e una versione mancante, risolvibile con sync.

- `version_number` e monotonicamente crescente per presentazione
- L'Agent confronta il suo `max_local_version` con il cloud `current_version_id`
- Se `cloud > local` → download mancanti
- Se `cloud == local` → niente da fare
- `cloud < local` non puo accadere (il cloud e l'unico writer di versioni)

---

## 7. Componenti del Sistema

### 7.1 Web Dashboard (apps/web)

**Ruolo:** Pannello di controllo centrale per admin/coordinatori. Gestione eventi, sale, sessioni, speaker. Vista realtime di tutte le sale.

**Pagine principali:**

| Route                  | Scopo                                            |
| ---------------------- | ------------------------------------------------ |
| `/login`               | Auth Supabase (email/password)                   |
| `/signup`              | Registrazione → crea tenant                      |
| `/dashboard`           | Overview eventi attivi, statistiche              |
| `/events`              | Lista eventi, CRUD                               |
| `/events/:id`          | Dettaglio evento: sale, sessioni, timeline       |
| `/events/:id/rooms`    | Gestione sale                                    |
| `/events/:id/sessions` | Calendario sessioni (drag & drop)                |
| `/events/:id/speakers` | Lista speaker, stato upload                      |
| `/events/:id/live`     | **Vista regia**: stato realtime di tutte le sale |
| `/events/:id/activity` | Feed attivita in tempo reale                     |
| `/events/:id/export`   | Export fine evento                               |
| `/settings`            | Impostazioni tenant, billing, team               |
| `/u/:token`            | **Upload Portal** (pubblico, token-based)        |

**Vista Regia** (pagina critica):

- Griglia di tutte le sale con stato live
- Per ogni sala: sessione corrente, speaker, file, versione, sync status
- Indicatori a colori inequivocabili: verde/giallo/rosso
- Activity log in tempo reale (scrolling)
- Stato di tutti i Local Agent (online/offline, heartbeat)

### 7.2 Upload Portal (parte di apps/web, route pubblica)

**Ruolo:** Pagina accessibile via QR code o link univoco. Il relatore carica la propria presentazione senza autenticazione (token-based).

**Flusso UX:**

1. Relatore scansiona QR / clicca link → `/u/{token}`
2. Vede: nome evento, sua sessione, sala assegnata, deadline
3. Drag & drop file (PPT, PPTX, KEY, PDF, MP4, MOV)
4. Upload TUS con barra progresso, pausa/riprendi
5. Upload completato → vede storico versioni, puo caricare nuova versione
6. Se file > 500MB: avviso "upload potrebbe richiedere tempo"

**Vincoli tecnici:**

- File max: 2GB (configurabile per tenant plan)
- Formati accettati: `.pptx`, `.ppt`, `.key`, `.pdf`, `.mp4`, `.mov`, `.avi`, `.wmv`
- SHA-256 calcolato client-side (Web Crypto API) prima dell'upload
- Token scade dopo l'evento o dopo N giorni configurabili

### 7.3 Local Agent (apps/agent — Tauri v2)

**Ruolo:** Server locale sull'infrastruttura di rete dell'evento. Cache di tutti i file, distribuzione LAN.

**Funzionalita:**

- **Auth**: login con credenziali utente tenant → riceve JWT con permessi
- **Sync engine**: sottoscrive Realtime, scarica nuove versioni, gestisce coda download
- **HTTP server LAN** (Axum su 0.0.0.0:8080):
  - `GET /api/v1/health` — stato agent
  - `GET /api/v1/rooms` — lista sale e stato sync
  - `GET /api/v1/rooms/:id/manifest` — manifest sala corrente (sessione, speaker, versione file)
  - `GET /api/v1/files/:version_id/download` — download file dalla cache
  - `GET /api/v1/files/:version_id/info` — metadata file (hash, size, name)
  - `POST /api/v1/files/upload` — upload diretto da preview room (TUS locale)
  - `WS /api/v1/ws` — WebSocket per push updates ai Player
- **SQLite locale**: copia dei metadati di sessioni, speaker, versioni. Funziona offline.
- **mDNS**: si annuncia come `_slidecenter._tcp.local` per discovery automatico
- **Heartbeat**: ping al cloud ogni 30 secondi
- **Dashboard locale**: UI React nel webview Tauri — stato sync, file cached, diagnostica rete

**Struttura cache filesystem:**

```
{user_data}/live-slide-center/
├── events/
│   └── {event_id}/
│       ├── metadata.json
│       └── presentations/
│           └── {presentation_id}/
│               └── v{version_number}/
│                   ├── {original_filename}
│                   └── .meta.json  (hash, size, status)
├── agent.db  (SQLite)
└── config.json
```

### 7.4 Room Player PWA (route /sala/:token in apps/web)

> **Architettura semplificata (Aprile 2026):** Il Room Player e una **Progressive Web App**, non un'app Tauri separata. Questo elimina installazione software su ogni PC sala, compilazione Rust e discovery mDNS. La PWA si connette direttamente al cloud (normale) o all'Agent LAN (se disponibile).

**Ruolo:** Ogni PC sala apre questa route nel browser. Chrome/Edge propone "Installa come app". Il tecnico vede sempre lo stato corrente della sua sala.

**Funzionalita:**

- **Connessione automatica**: conosce la sala dal token nell'URL — zero configurazione manuale
- **Auto-sync cloud**: subscribe a Supabase Realtime per aggiornamenti versione
- **Fallback LAN**: se Agent e raggiungibile, scarica file piu velocemente dalla LAN
- **Cache offline**: service worker Workbox mantiene file corrente in Cache API
- **Overlay informativo** (sempre visibile):
  ```
  +--------------------------------------------------+
  |  SALA 1 — Dr. Rossi — Cardiologia               |
  |  File: presentazione_rossi_v4.pptx              |
  |  Versione: 4 di 4 — SYNC OK — 14:32            |
  +--------------------------------------------------+
  ```
- **Indicatori di stato**: verde (cloud direct), giallo (LAN only), rosso (offline cache)
- **Installazione PWA**: banner "Installa come app" → icona sul desktop — si comporta come programma nativo

**Flusso installazione sala (3 click):**
1. Admin genera URL sala nella dashboard → condivide via QR code o link
2. Tecnico apre URL su Chrome/Edge nel PC sala
3. Clicca "Installa" nel banner → icona sul desktop
4. Fatto — nessun installer, nessun IP da configurare

---

## 8. Design System

### Palette

| Ruolo               | Colore                    | Uso                           |
| ------------------- | ------------------------- | ----------------------------- |
| Background primario | `#0A0A0B` (nero profondo) | Dark mode — ambiente regia    |
| Background card     | `#141416`                 | Pannelli, sidebar             |
| Background hover    | `#1C1C1F`                 | Stati hover                   |
| Accent primario     | `#0066FF` (blu elettrico) | CTA, link, selezione          |
| Success             | `#22C55E`                 | Synced, online, ready         |
| Warning             | `#F59E0B`                 | Syncing, LAN only, processing |
| Danger              | `#EF4444`                 | Offline, failed, outdated     |
| Text primario       | `#FAFAFA`                 | Titoli, contenuto             |
| Text secondario     | `#A1A1AA`                 | Label, metadata               |

### Tipografia

- **UI**: Inter (sans-serif)
- **Monospace** (hash, codici, version): JetBrains Mono
- **Scale**: 12px (caption) / 14px (body) / 16px (subtitle) / 20px (title) / 24px (h2) / 32px (h1)

### Principi UX

1. **Densita informativa alta**: target tecnici esperti, non consumer
2. **Stato SEMPRE visibile**: ogni entita mostra il suo stato con colore inequivocabile
3. **Zero ambiguita sulla versione**: numero versione + timestamp + hash troncato
4. **Feedback immediato**: ogni azione ha feedback visivo entro 200ms
5. **Dark mode only**: l'ambiente operativo e una regia buia
6. **Componenti**: solo shadcn/ui — zero CSS custom inline

---

## 9. Modello Commerciale

### Piani SaaS

| Piano          | Prezzo    | Target                              | Limiti                                                 |
| -------------- | --------- | ----------------------------------- | ------------------------------------------------------ |
| **Starter**    | €149/mese | Piccole aziende AV, 1-2 eventi/mese | 3 eventi/mese, 5 sale/evento, 50GB storage, 1 Agent    |
| **Pro**        | €399/mese | Aziende AV medie, congressi         | 10 eventi/mese, 20 sale/evento, 500GB storage, 3 Agent |
| **Enterprise** | Custom    | Grandi service tecnici, PCO         | Illimitato, SLA, supporto dedicato, white-label        |

### Incluso in tutti i piani

- Upload illimitati (dentro il limite storage)
- Upload Portal con QR code personalizzato
- Export fine evento (ZIP + report)
- Auto-cleanup dopo 30 giorni
- Aggiornamenti automatici Agent e Player

### Infrastruttura billing

- **Lemon Squeezy** come Merchant of Record (via Live WORKS APP)
- Webhook per aggiornamento piano tenant
- Customer Portal per self-service upgrade/downgrade
- Trial: 14 giorni, piano Starter completo

---

## 10. Roadmap Esecutiva (16 Fasi)

### FASE 0 — Bootstrap Monorepo (COMPLETATA — Aprile 2026)

- Monorepo Turborepo + pnpm workspace
- Setup progetto Supabase (cloud + CLI)
- Supabase Storage configurato (MVP — no R2 iniziale)
- `.env.example` con tutte le variabili
- CI base (lint + typecheck + build OK)

### FASE 1 — Schema Database + RLS

- Esegui migration iniziale PostgreSQL
- Genera types TypeScript con `supabase gen types`
- Scrivi test RLS (tenant A non vede dati tenant B)
- Seed data per sviluppo

### FASE 2 — Auth Multi-Tenant

- Supabase Auth (email + password)
- Signup → crea tenant automaticamente + assegna ruolo admin
- Custom claim `tenant_id` nel JWT (via Supabase hook o trigger)
- Login/signup UI con shadcn

### FASE 3 — Event Management Dashboard

- CRUD eventi con status workflow
- CRUD sale per evento
- CRUD sessioni con timeline/calendario
- CRUD speaker per sessione
- Import programma da Excel/CSV
- UI: sidebar, breadcrumb, tabelle TanStack, calendario

### FASE 4 — Speaker Upload Portal

- Generazione token univoci per speaker
- Pagina pubblica `/u/:token` con QR code
- Upload TUS resumable (`use-tus` + `tus-js-client`)
- Barra progresso, pausa/riprendi, retry
- Validazione formato e dimensione
- SHA-256 client-side (Web Crypto API)
- Preview file name + metadata dopo upload

### FASE 5 — Versioning System

- Ogni upload crea nuova `presentation_version` (append-only)
- UI storico versioni con diff metadata
- Rollback a versione precedente
- Status workflow: uploading → processing → ready
- Notifica in dashboard quando nuova versione disponibile

### FASE 6 — Realtime Dashboard (Vista Regia)

- Subscribe a canali Supabase Realtime (room_state, versions, agents)
- Griglia sale con stato live
- Activity feed scrolling
- Indicatori di stato Agent (heartbeat)
- Filtri per sala, sessione, stato

### FASE 6 — Room Player PWA

- Route `/sala/:token` nella web app esistente
- `vite-plugin-pwa` + Workbox service worker
- Manifest PWA: nome sala, icona, dark mode, display standalone
- Connessione Supabase Realtime per aggiornamenti versione
- Cache offline (Cache API service worker) per il file corrente
- Overlay informativo: sala, versione, stato verde/giallo/rosso
- Banner "Installa come app" (`beforeinstallprompt`)
- Fallback LAN: se Agent disponibile, usa HTTP Agent per file
- Test su Chrome Windows, Edge, Safari iOS

**Risultato:** il tecnico apre un URL, clicca Installa, ha l'app. Zero installazione tradizionale.

### FASE 7 — Local Agent (Tauri v2)

Solo quando hai almeno 1 cliente che opera in luoghi con rete inaffidabile.

- Progetto Tauri v2 in `apps/agent/`
- Auth con JWT tenant, selezione evento attivo
- Sync engine: Supabase Realtime → download file → SQLite locale
- HTTP API LAN su Axum (0.0.0.0:8080): health, rooms/manifest, files/download, WS
- mDNS: si annuncia come `_slidecenter._tcp.local`
- Heartbeat ogni 30 secondi al cloud
- UI locale: stato sync, file cached, diagnostica
- La PWA Room Player (Fase 6) si connette all'Agent automaticamente se disponibile

### FASE 8 — Offline Architecture Completa

- Agent: coda download con retry, sync recovery dopo disconnessione
- PWA: fallback graceful (cache → LAN Agent → cloud → offline)
- Dashboard: indicatore "Agent offline — ultimo contatto X"
- Test completi: disconnetti internet, disconnetti LAN, riconnetti
- Conflict resolution: cloud-wins sempre

### FASE 9 — Upload dalla Preview Room

- Agent accetta upload TUS locale (endpoint su LAN)
- Upload dalla preview room → Agent → Cloud
- Doppio percorso: speaker puo caricare da web O da preview room
- Versioning identico in entrambi i casi

### FASE 11 — Export Fine Evento

- Pulsante "Chiudi evento" nella dashboard
- Genera ZIP con: tutti i file ultima versione per sessione
- CSV activity_log completo
- PDF report riassuntivo (sessioni, speaker, versioni, log)
- Upload ZIP su Storage con link download (30 giorni)
- Auto-cleanup: Edge Function schedulata cancella file scaduti

### FASE 12 — Billing (Lemon Squeezy)

- Integrazione checkout per 3 piani
- Webhook LS → aggiorna `tenants.plan` + limiti
- Enforcement limiti (eventi/mese, storage, agent)
- Customer Portal per gestione abbonamento
- Trial 14 giorni

### FASE 13 — i18n

- `i18next` + `react-i18next` su web
- Tauri: i18n nel webview React
- Italiano primario, inglese professionale
- Agent e Player: lingua selezionabile al primo avvio
- Installer in inglese (coerente con ecosistema)

### FASE 14 — Integrazioni Ecosistema

- Link bidirezionale con Live Speaker Timer (info sessione → timer)
- API REST pubblica per integrazioni terze
- Webhook per notifiche esterne (email, Slack)
- Potenziale integrazione vMix/OBS (futuro)

### FASE 15 — Hardening & QA

- Sentry error tracking (web + desktop)
- Rate limiting su Edge Functions
- Audit sicurezza RLS (penetration test multi-tenant)
- E2E test Playwright (flussi critici: upload, sync, offline)
- Performance: Lighthouse, bundle size, query optimization
- Documentazione utente finale

---

## 11. Struttura Progetto

```
Live SLIDE CENTER/
├── .cursor/rules/                    # 12 regole Cursor (architettura, RLS, i18n, deploy...)
├── .editorconfig                     # Stile codice (UTF-8, LF, 2 spazi)
├── .env.example                      # Template variabili ambiente
├── .gitignore
├── .nvmrc                            # Node 22
├── .prettierrc + .prettierignore     # Prettier + plugin Tailwind
├── tsconfig.base.json                # Strict mode condiviso TS 6
├── turbo.json                        # Pipeline Turbo con globalEnv VITE_*
├── pnpm-workspace.yaml               # Workspace: apps/*, packages/*
├── package.json                      # Root: dev, build, lint, format, typecheck, test
│
├── apps/
│   ├── web/                          # Dashboard + Upload Portal (React 19 + Vite 8)
│   │   ├── index.html                # Dark mode, lang="it"
│   │   ├── vite.config.ts            # Tailwind 4 plugin, alias @/, sourcemaps
│   │   ├── tsconfig.app.json         # Extends base, paths @/*, references shared+ui
│   │   ├── tsconfig.node.json
│   │   ├── eslint.config.js          # ESLint 9 + Prettier + react-hooks
│   │   ├── package.json              # @slidecenter/web
│   │   └── src/
│   │       ├── main.tsx              # Entry: Router + Providers + i18n init
│   │       ├── index.css             # Tailwind 4 @import + dark vars
│   │       ├── vite-env.d.ts         # ImportMetaEnv tipizzata (VITE_*)
│   │       ├── app/
│   │       │   ├── routes.tsx        # React Router 7, lazy loading
│   │       │   ├── root-layout.tsx   # Sidebar + main + Suspense
│   │       │   └── providers.tsx     # Provider tree (pronto per Auth/Zustand)
│   │       ├── lib/
│   │       │   ├── supabase.ts       # Client tipizzato con validazione env
│   │       │   └── i18n.ts           # Top-level await initI18n()
│   │       └── features/             # Pattern feature-based
│   │           ├── dashboard/DashboardView.tsx
│   │           ├── events/EventsView.tsx
│   │           └── settings/SettingsView.tsx
│   │           # Fasi successive: auth/, rooms/, sessions/, speakers/,
│   │           # presentations/, upload-portal/, live-view/, activity/, export/
│   │
│   ├── agent/README.md               # Stub — Tauri v2 + Axum (Fase 7)
│   # Nota: NON esiste apps/player/ — il Room Player è una PWA route di apps/web/
│
├── packages/
│   ├── shared/                       # @slidecenter/shared
│   │   ├── package.json              # exports: ., ./validators, ./i18n
│   │   ├── tsconfig.json             # composite, declaration, declarationMap
│   │   ├── eslint.config.js
│   │   └── src/
│   │       ├── index.ts              # Re-export strutturato
│   │       ├── constants/
│   │       │   ├── app.ts            # APP_SLUG, MAX_UPLOAD_SIZE, TUS_CHUNK, HEARTBEAT
│   │       │   └── plans.ts          # PlanLimits per trial/starter/pro/enterprise
│   │       ├── types/
│   │       │   ├── index.ts
│   │       │   ├── database.ts       # Placeholder (supabase gen types sovrascrive)
│   │       │   └── enums.ts          # UserRole, EventStatus, SyncStatus, ecc.
│   │       ├── validators/
│   │       │   ├── index.ts
│   │       │   └── event.ts          # Zod 4: event, room, session, speaker
│   │       └── i18n/
│   │           ├── index.ts           # initI18n() + i18next config
│   │           └── locales/
│   │               ├── it.json        # ~150 chiavi IT
│   │               └── en.json        # ~150 chiavi EN (terminologia AV/eventi)
│   │
│   └── ui/                           # @slidecenter/ui
│       ├── package.json              # exports: ., ./lib/utils
│       ├── tsconfig.json             # composite, jsx react-jsx
│       ├── eslint.config.js
│       └── src/
│           ├── index.ts              # Export cn()
│           └── lib/utils.ts          # cn() = clsx + tailwind-merge (shadcn pattern)
│
├── supabase/
│   ├── config.toml                   # Project: Live_SLIDE_CENTER
│   ├── seed.sql                      # Seed minimale
│   ├── migrations/
│   │   └── 20250411090000_init_slide_center.sql  # Schema completo + RLS + Realtime + GRANT
│   └── functions/
│       ├── _shared/
│       │   ├── cors.ts               # CORS headers + preflight handler
│       │   └── auth.ts               # getSupabaseClient() + getTenantId()
│       └── health/index.ts           # Health check endpoint
│       # Fasi successive: validate-upload-token/, process-upload/, ecc.
│
└── docs/
    ├── SlideHub_Live_CURSOR_BUILD.md  # Questo documento
    ├── Istruzioni_Progetto_Claude_Live_Slide_Center.md
    ├── Primo_Prompt_Avvio_Chat_Claude_Desktop_Live_Slide_Center.md
    ├── Setup_Strumenti_e_MCP.md
    └── docs commerciali/
```

---

## 12. Configurazione Ambiente

### `.env.example` (attuale nel repo)

```bash
# --- Supabase ---
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# --- App ---
VITE_APP_NAME="Live SLIDE CENTER"
VITE_APP_VERSION=0.0.1

# (Fasi successive: SUPABASE_SERVICE_ROLE_KEY, R2, Lemon Squeezy, Sentry)
```

---

## 13. Account & Infrastruttura

| Risorsa          | Account                       | Note                                           |
| ---------------- | ----------------------------- | ---------------------------------------------- |
| GitHub repo      | **live-software11**           | `github.com/live-software11/live-slide-center` |
| Supabase project | **live.software11@gmail.com** | Project: `live-slide-center`                   |
| Cloudflare R2    | —                             | Upgrade futuro quando egress > $50/mese |
| Lemon Squeezy    | Via Live WORKS APP            | Prodotto "Live SLIDE CENTER"                   |
| Vercel deploy    | **live.software11@gmail.com** | Dominio: `app.liveslidecenter.com`             |
| Sentry           | **live.software11@gmail.com** | Progetto: `live-slide-center`                  |

---

## 14. Regole di Implementazione

### Per Cursor AI

1. **Mai inventare API o librerie**: verifica sempre documentazione ufficiale aggiornata (usa MCP context7)
2. **Mai saltare RLS**: ogni nuova tabella DEVE avere policy `tenant_id = public.app_tenant_id()` (EN: same invariant using `public.app_tenant_id()`.)
3. **Mai hardcodare secrets**: solo variabili ambiente
4. **TypeScript strict**: zero `any`, zero errori lint, zero warning
5. **i18n obbligatoria**: ogni stringa UI ha coppia IT/EN nello stesso commit
6. **Commit atomici**: messaggi convenzionali (`feat:`, `fix:`, `chore:`)
7. **Branch per fase**: `feat/fase-N-nome` — merge su `main` dopo review
8. **Test RLS**: per ogni nuova tabella, verifica che tenant A non veda dati tenant B
9. **Spiega in italiano**: ogni azione spiegata in modo chiaro
10. **Fermati e chiedi** se una scelta architetturale non e coperta da questo documento

### Definition of Done (per ogni fase)

1. Codice committato su branch dedicato `feat/fase-N`
2. Build passa senza errori TypeScript
3. RLS testata (multi-tenant isolation)
4. i18n: stringhe IT + EN
5. Demo funzionante
6. README aggiornato
7. Conferma esplicita dell'utente prima di passare alla fase successiva

---

## 15. Relazioni nell'Ecosistema

```
Live SLIDE CENTER
     │
     ├── Licenze ──> Live WORKS APP (Lemon Squeezy)
     │
     ├── Timer ──> Live Speaker Timer (info sessione → countdown)
     │
     ├── Tecnici ──> Live CREW (assegnazione tecnici alle sale)  [futuro]
     │
     └── Eventi ──> Live PLAN (pianificazione evento)  [futuro]
```

**Nota:** le integrazioni con PLAN e CREW sono future (Fase 14+). La priorita e un prodotto standalone funzionante.

---

## 16. Stato Bootstrap e Comando di Avvio

### Completato (operazioni preliminari)

- [x] Monorepo Turborepo + pnpm workspace
- [x] `tsconfig.base.json` condiviso (TS 6, strict)
- [x] ESLint 9 + Prettier + eslint-config-prettier
- [x] Vite 8 + Tailwind CSS 4 + @tailwindcss/vite
- [x] `packages/shared`: types, enums, constants, validators Zod 4, i18n IT/EN (~150 chiavi)
- [x] `packages/ui`: `cn()` utility (clsx + tailwind-merge), pronto per shadcn
- [x] `apps/web`: React Router 7, layout dark-mode, feature-based, Supabase client, i18n
- [x] Migration SQL completa: schema + RLS `public.app_tenant_id()` + Realtime + GRANT
- [x] Edge Functions: `_shared/cors` + `_shared/auth` + `health` endpoint
- [x] DX: `.editorconfig`, `.prettierrc`, `.nvmrc`, `.gitignore`, `.env.example`
- [x] Git init (branch `main`, autore `Andrea Rizzari` / `live.software11@gmail.com`)
- [x] `pnpm run typecheck` + `lint` + `build` tutti OK
- [x] MCP Supabase (**supabase-hosted** in `mcp.json` + `SUPABASE_ACCESS_TOKEN` utente Windows; verifica: `pnpm run verify:supabase-mcp`)
- [x] GitHub `origin` → `https://github.com/live-software11/live-slide-center.git` (branch `main` tracciata)

### Da fare al primo avvio sviluppo

- [ ] Docker Desktop + `npx supabase start` + `npx supabase db reset`
- [ ] `supabase link --project-ref <REF>` + copia `.env`
- [ ] `npx supabase gen types typescript` → `packages/shared/src/types/database.ts`

### Comando per iniziare una sessione

Apri `docs/GUIDA_DEFINITIVA_PROGETTO.md` e scrivi nel chat:

> "Leggi `docs/GUIDA_DEFINITIVA_PROGETTO.md`. E la fonte di verita master del progetto. Inizia la FASE 1 (Auth Multi-Tenant). Spiega ogni passo in italiano e chiedi conferma prima di procedere alla fase successiva."
