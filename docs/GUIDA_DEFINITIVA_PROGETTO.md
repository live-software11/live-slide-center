# GUIDA DEFINITIVA PROGETTO � Live SLIDE CENTER

> **Documento UNICO di riferimento.** Questo file sostituisce e incorpora: `PIANO_MASTER_v3.md`, `SlideHub_Live_CURSOR_BUILD.md`, `PRE_CODE_PREPARATION.md`, `LIVE_SLIDE_CENTER_DEFINITIVO.md`. Nessun altro documento ha autorita su questo. Se trovi una contraddizione altrove, **questo vince**.
> **Versione:** 4.2.0 - 16 Aprile 2026 (Fase 7 completata: Dual-Mode File Sync � Blocco A: File System Access API nel Room Player PWA per download automatico su disco; Blocco B: Local Agent Tauri v2 `apps/agent/` con Axum HTTP :8080, SQLite WAL, sync engine da Supabase Storage; Blocco C: Room Agent Tauri v2 `apps/room-agent/` con polling LAN, autostart HKCU, tray icon; Blocco D: colonna `network_mode` ENUM `cloud|intranet|hybrid` sulla tabella `events`; i18n `event.networkMode_*` IT/EN; selettore modalita rete nel form modifica evento; ADR-007 dual-mode per evento. Fasi precedenti: 0-6 completate al 100% inclusi MVP Cloud, Upload Portal TUS, versioning presentazioni, Vista Regia realtime, Pairing Device + Room Player PWA. Brand: logo ufficiale `icons/Logo Live Slide Center.jpg`, generazione favicon/PWA/UI con Sharp in prebuild/predev, componente `AppBrandLogo` e i18n `app.displayName` — vedi §13.)
> **Autore:** Andrea Rizzari + CTO Senior AI Review
> **Nota release 4.2.0:** Fase 10 — export fine evento in `/events/:eventId`: ZIP slide versione corrente (`jszip` + signed URL Storage), CSV UTF-8 BOM `activity_log` per `event_id`, PDF report metadati (`jspdf`); `EventExportPanel` lazy-loaded; `createVersionDownloadUrlWithClient` in `presentations/repository.ts`; i18n `event.export.*` IT/EN.
> **Nota release 4.1.0:** Fase 9 — Edge `room-player-bootstrap`, routing Room Player cloud/LAN/hybrid, cache manifest offline + Workbox signed URL.
> **Stack:** React 19 + Vite 8 + TypeScript strict + Supabase + Vercel � gia funzionante nel repo

---

## INDICE

1. [Obiettivi Strategici](#1-obiettivi-strategici)
2. [Analisi Competitiva](#2-analisi-competitiva)
3. [Decisioni Architetturali](#3-decisioni-architetturali)
4. [Architettura e Scenari Network](#4-architettura-e-scenari-network)
5. [Stack Tecnologico](#5-stack-tecnologico)
6. [Isolamento Multi-Tenant](#6-isolamento-multi-tenant)
7. [Schema Database Completo](#7-schema-database-completo)
8. [Pairing Dispositivi](#8-pairing-dispositivi)
9. [Flussi di Sistema](#9-flussi-di-sistema)
10. [Dashboard Super-Admin](#10-dashboard-super-admin)
11. [Dashboard Tenant](#11-dashboard-tenant)
12. [Piani Commerciali e Quote](#12-piani-commerciali-e-quote)
13. [Design System](#13-design-system)
14. [Guida Networking Operativa](#14-guida-networking-operativa)
15. [Roadmap Esecutiva](#15-roadmap-esecutiva) (in coda: stima avanzamento % MVP e problemi noti toolchain)
16. [Struttura Monorepo](#16-struttura-monorepo)
17. [Account e Infrastruttura](#17-account-e-infrastruttura)
18. [Checklist Pre-Fase-1](#18-checklist-pre-fase-1)
19. [Regole Non Negoziabili](#19-regole-non-negoziabili)

---

## 1. Obiettivi Strategici

1. **SaaS multi-tenant puro** � ogni azienda cliente ha il proprio spazio isolato: dashboard, eventi, file. Zero contaminazioni tra clienti.
2. **Onboarding frictionless** � signup ? tenant ? primo evento ? invito relatori: meno di 10 minuti.
3. **Zero-config per i PC sala** � il tecnico digita un codice di 6 cifre, il PC e configurato. Niente software da installare.
4. **Due modalita di rete** � cloud puro (default) oppure rete locale gestita (per eventi grandi o senza internet).
5. **Funzionamento offline garantito** � con Local Agent attivo, l'evento non si ferma mai.
6. **Partenza a costo zero** � infrastruttura gratuita fino al primo cliente pagante, scalabile senza riscrivere codice.
7. **Due dashboard** � Super-Admin per Andrea (visione globale) + Dashboard Tenant per ogni cliente (solo i propri dati).

---

## 2. Analisi Competitiva

### Slidecrew (Olanda) � concorrente diretto piu forte

| Aspetto             | Dettaglio                                                                         |
| ------------------- | --------------------------------------------------------------------------------- |
| **Pricing**         | �76/sala/giorno + �10/25GB extra + �700/giorno supporto on-site (IVA esclusa)     |
| **Modello**         | Pay-per-event, NON SaaS subscription                                              |
| **Punti di forza**  | Local caching server, app tecnici/moderatori/timer/kiosk, e-poster, branding, API |
| **Clienti**         | ECR 2025 (27 sale, 3037 presentazioni), FESSH 2024 (8 sale, 780 presentazioni)    |
| **Limiti**          | No SaaS self-service, pricing opaco, no offline-first nativo                      |
| **Calcolo esempio** | Congresso 3 giorni, 5 sale = 5 � 3 � �76 = **�1.140** per evento singolo          |

### SLIDEbit (TC Group, Firenze)

Software proprietario + hardware (e-lectern), 25+ anni nel medicale, SENDbit per upload remoto. No SaaS, no self-service, pricing opaco.

### Preseria (Norvegia)

SaaS con app desktop Windows/Mac. Upload intuitivo, sync veloce, offline mode. Meno funzionalita di regia, no multi-projection.

### Posizionamento Live SLIDE CENTER

| Differenziatore    | Vs Slidecrew                                    | Vs SLIDEbit         | Vs Preseria              |
| ------------------ | ----------------------------------------------- | ------------------- | ------------------------ |
| **SaaS flat-rate** | �149/mese per 5 eventi vs �1.140/singolo evento | SaaS vs hardware    | Comparabile + ecosistema |
| **Zero-config PC** | Codice 6 cifre vs setup tecnico                 | Codice vs e-lectern | Codice vs app desktop    |
| **Offline-first**  | Architettura nativa vs caching add-on           | Comparabile         | Comparabile              |
| **Ecosistema**     | Timer + Teleprompter + CREW + PLAN              | Standalone          | Standalone               |

**Vantaggio prezzo:** cliente con 3 eventi/mese da 5 sale ? �149/mese (Starter) vs ~�3.420/mese su Slidecrew. Risparmio **96%**.

---

## 3. Decisioni Architetturali

### ADR-001: Room Player = file manager ATTIVO con download locale (Chrome/Edge)

Il Room Player e una PWA che mostra nome sala, file disponibili e li **scarica automaticamente su disco** tramite la **File System Access API** (Chrome 86+/Edge 86+). Il tecnico sceglie la cartella locale una sola volta (handle salvato in IndexedDB, persiste tra sessioni). Quando arriva una nuova versione via Realtime, la PWA genera un signed URL da Supabase Storage e scrive il file direttamente nella cartella scelta. Il tecnico apre il file manualmente dal suo software preferito. Zero integrazione COM Office, zero rischio crash.

**Flusso:**

1. Primo avvio ? banner "Scegli cartella locale per le slide"
2. Tecnico seleziona cartella (es. `D:\Slide Evento`) ? handle persistito in IndexedDB
3. Supabase Realtime notifica nuova versione `status='ready'` per la sala
4. PWA genera signed URL (5 min) + scarica con streaming + scrive su disco
5. UI mostra progresso per-file e stato (In attesa / Download xx% / Sul disco / Errore)

**Modalita intranet:** se l'evento ha `network_mode='intranet'`, usa Room Agent + Local Agent invece della PWA (vedi ADR-007).

### ADR-002: Pairing = OAuth Device Flow (RFC 8628)

Pattern standard AppleTV/Netflix/Disney+/GitHub CLI. Andrea genera un codice 6 cifre dalla dashboard, il tecnico lo digita su `app.liveslidecenter.com/pair`, riceve JWT permanente. Funziona in qualsiasi rete (cloud, LAN, NAT, proxy).

### ADR-003: Due modalita di rete, entrambe supportate

**Modalita A � Cloud Puro:** ogni PC usa internet della location. Zero hardware.
**Modalita B � Rete Locale Gestita:** router Andrea + mini-PC Agent in regia. File via LAN.
In entrambe, il pairing funziona con lo stesso codice 6 cifre. La rete locale e un acceleratore, non un prerequisito.

### ADR-004: Supabase (non Firebase, non Next.js)

**Supabase** perche: modello relazionale per eventi?sale?sessioni?speaker?versioni, TUS nativo, RLS potente, SQL per analytics, pricing prevedibile.
**React + Vite** perche: SPA senza bisogno di SEO/SSR, coerenza con ecosistema Live Software, DX superiore.
**Supabase Storage** per MVP, Cloudflare R2 quando egress > $50/mese (stesso SDK S3, migrazione 1 giorno).

### ADR-005: Due dashboard, un solo codice

`/admin/*` per Andrea (super-admin, vede tutti i tenant ma NON il contenuto dei file per GDPR).
`/dashboard/*` per i clienti (vedono solo i propri dati).
Stessa app React, guard basato su `role='super_admin'`.

### ADR-006: Analisi storage � perche Supabase e non altri

| Alternativa          | Verdetto          | Motivo                                                                  |
| -------------------- | ----------------- | ----------------------------------------------------------------------- |
| pCloud               | Scartato          | Consumer, zero isolamento tenant, sicurezza da costruire da zero        |
| Google Drive         | Scartato          | OAuth Google obbligatorio per speaker, UX distrutta                     |
| AWS S3               | Sovradimensionato | Egress $0.09/GB, IAM complesso, costi imprevedibili                     |
| Cloudflare R2        | Rimandato         | Zero egress ma servizio separato da Supabase � quando egress > $50/mese |
| **Supabase Storage** | **Vincitore**     | TUS nativo, Auth integrata, RLS-like su bucket, un solo servizio        |

### ADR-007: Dual-mode per evento � Cloud o Intranet LAN, selezionabili

Ogni evento ha una colonna `network_mode ENUM('cloud', 'intranet', 'hybrid')`:

- **cloud** (default): Room Player PWA + File System Access API. Ogni PC usa internet. Download diretto da Supabase Storage. Zero hardware aggiuntivo.
- **intranet**: Local Agent (mini-PC regia) + Room Agent (ogni PC sala). File via LAN HTTP (:8080). Internet opzionale per sincronizzazione iniziale. Router e access point di Andrea.
- **hybrid**: Room Agent usa il Local Agent se raggiungibile (LAN), fallback su cloud se assente.

Le due modalita coesistono nello stesso codebase. La scelta avviene al momento della creazione/modifica dell'evento nel form di dettaglio. **Stato attuale (Fase 9):** la colonna `network_mode` e salvata e mostrata nel form evento. Il Room Player PWA legge `network_mode` e l'ultimo `local_agents` online via Edge Function `room-player-bootstrap` (validazione `device_token` server-side), applica routing download: **cloud** = solo signed URL Supabase; **intranet** = HTTP verso Local Agent `GET /api/v1/files/{event_id}/{filename}` (nessun agent registrato → errore esplicito); **hybrid** = tentativo LAN poi fallback cloud. Il Room Agent Tauri resta il percorso desktop intranet dedicato. Cache PWA: Workbox NetworkFirst su `*.supabase.co` e su path signed Storage; manifest file in `localStorage` come ripiego offline.

**Bypass Windows 11 (intranet):**

- Installer Room Agent NSIS gira come Admin ? imposta regole firewall
- Room Agent gira come utente normale dopo l'installazione (no UAC ripetuto)
- Autostart via registro HKCU (no admin)
- Profilo rete su "Privato" via `Set-NetConnectionProfile` (una tantum)
- File scaricati dal Room Agent non hanno Mark-of-the-Web ? no blocco SmartScreen

---

## 4. Architettura e Scenari Network

```
                    [MODALITA A � CLOUD PURO]

  Sala 1 PC          Sala 2 PC          Sala N PC
  (Chrome PWA)      (Chrome PWA)       (Chrome PWA)
       |                 |                  |
       +--------- HTTPS / WSS --------------+
                         |
              +----------v-----------+
              |  Supabase + Vercel   |     <-- Andrea (dashboard)
              |  (Francoforte EU)    |         da qualsiasi luogo
              +----------------------+


                    [MODALITA B � RETE LOCALE + CLOUD]

  Sala 1 PC          Sala 2 PC          Sala N PC
  (Room Agent        (Room Agent        (Room Agent
   Tauri v2)          Tauri v2)          Tauri v2)
       |                 |                  |
       +-------+---------+----------+-------+
               | WiFi/LAN HTTP :8080|
               v     (router)       v
         +-----+--------------------+----+
         |       Local Agent (Tauri)     |
         |       mini-PC regia           |
         +---------------+---------------+
                         |
                    HTTPS (se disponibile)
                         |
              +----------v-----------+
              |  Supabase + Vercel   |
              +----------------------+


                    [MODALITA C � OFFLINE PURO]

  Sale PC (cache locale) --- LAN --- Local Agent (cache)
                                     internet assente
```

| Scenario                                   | Modalita        | Cosa porta Andrea                    | Costo             |
| ------------------------------------------ | --------------- | ------------------------------------ | ----------------- |
| Evento piccolo (1-3 sale, WiFi buono)      | A � Cloud       | Niente                               | �0                |
| Evento medio (4-10 sale, WiFi incerto)     | B � LAN + Cloud | Router + mini-PC                     | ~�500 una tantum  |
| Evento grande (10+ sale, centro congressi) | B � LAN + Cloud | Router + AP + mini-PC                | ~�1000 una tantum |
| Area senza internet                        | C � Offline     | Router + mini-PC + file pre-caricati | Come sopra        |

---

## 5. Stack Tecnologico

### Web (apps/web � gia nel repo)

| Layer        | Tecnologia                | Versione |
| ------------ | ------------------------- | -------- |
| Framework UI | React                     | 19       |
| Build tool   | Vite                      | 8        |
| Linguaggio   | TypeScript                | strict   |
| Styling      | Tailwind CSS              | 4        |
| Componenti   | shadcn/ui + Radix         | latest   |
| Routing      | React Router              | 7        |
| State        | Zustand                   | latest   |
| Tabelle      | TanStack Table            | latest   |
| Form         | Zod + React Hook Form     | latest   |
| i18n         | i18next + react-i18next   | latest   |
| Upload       | tus-js-client + use-tus   | latest   |
| PWA          | vite-plugin-pwa (Workbox) | Fase 6   |

### Backend / Infrastruttura

| Layer          | Tecnologia          | Note                                         |
| -------------- | ------------------- | -------------------------------------------- |
| Database       | Supabase PostgreSQL | RLS + trigger                                |
| Auth           | Supabase Auth       | JWT custom claims con tenant_id              |
| Storage        | Supabase Storage    | TUS + S3 compatible, fino a 500GB/file       |
| Realtime       | Supabase Realtime   | room_state, versions, agents, paired_devices |
| Edge Functions | Supabase + Deno     | Pairing, upload validation, cleanup          |
| Deploy web     | Vercel              | Auto-deploy su push main                     |

### Desktop (Local Agent � `apps/agent/` � implementato in Fase 7)

| Layer           | Tecnologia                     | Note                             |
| --------------- | ------------------------------ | -------------------------------- |
| Framework       | Tauri v2                       | Rust backend + webview HTML      |
| HTTP server LAN | Axum                           | Bind 0.0.0.0:8080                |
| Database locale | SQLite (rusqlite WAL)          | Cache file + room agents         |
| Discovery       | Agent registra IP LAN al cloud | PWA lo interroga dal cloud       |
| Sync engine     | reqwest + tokio + Supabase API | Pull versioni ready + signed URL |
| UI              | HTML standalone (no React)     | Dashboard stato + sync manuale   |

### Desktop (Room Agent � `apps/room-agent/` � implementato in Fase 7)

| Layer          | Tecnologia                  | Note                                                      |
| -------------- | --------------------------- | --------------------------------------------------------- |
| Framework      | Tauri v2 lite               | Rust backend + webview HTML minimale                      |
| Polling LAN    | reqwest (ogni 5s)           | Controlla nuovi file dal Local Agent                      |
| Download       | tokio async + streaming     | Salva in `C:\Users\�\AppData\Local\SlideCenter\{roomId}\` |
| Autostart      | Registro HKCU (no admin)    | `CurrentVersion\Run`                                      |
| Tray icon      | Tauri tray                  | Verde = sync, giallo = download, rosso = offline          |
| Windows bypass | HKCU + profilo rete Privato | No UAC ripetuto; no MOTW sui file                         |

---

## 6. Isolamento Multi-Tenant

**Non esiste compromesso.** La separazione tra clienti e l'invariante sacra del prodotto.

### Database (Postgres)

Ogni tabella con dati business ha `tenant_id UUID NOT NULL REFERENCES tenants(id)`. RLS attiva ovunque con policy `tenant_id = public.app_tenant_id()`.

```sql
CREATE OR REPLACE FUNCTION public.app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(trim(both '"' from (auth.jwt() -> 'app_metadata' ->> 'tenant_id')), '')::uuid,
    NULLIF(trim(both '"' from (auth.jwt() -> 'user_metadata' ->> 'tenant_id')), '')::uuid
  );
$$;

CREATE POLICY tenant_isolation ON events
  FOR ALL USING (tenant_id = public.app_tenant_id());
```

### Storage

Path obbligatorio: `tenants/{tenant_id}/events/{event_id}/presentations/{id}/v{n}/{file}`. Edge Function verifica tenant_id dal JWT prima di firmare URL.

### Auth

Trigger SQL al signup: crea `tenants` ? crea `users` con `role='admin'` ? aggiorna `auth.users.raw_app_meta_data` con `tenant_id` e `role`. Il client **non** deve navigare verso route tenant-scoped finche il JWT non contiene `app_metadata.tenant_id`: dopo `signUp`, eseguire `refreshSession()` (gestire errore di rete/race), poi `getUser()` e verificare il claim; in caso di ritardo trigger, **retry** breve (es. `waitForTenantIdAfterSignup` in `apps/web/src/features/auth/lib/wait-for-tenant-jwt.ts`). Se refresh fallisce o dopo i tentativi `tenant_id` manca ancora, mostrare errore e non reindirizzare alla dashboard.

**File migration:** `supabase/migrations/20250415130000_handle_new_user_tenant.sql` (`handle_new_user` + trigger `on_auth_user_created` su `auth.users`).

**Conferma email (progetto Supabase):** se `signUp` restituisce utente ma **nessuna** `session` (flusso conferma obbligatoria), il client **non** chiama il loop JWT: mostra istruzioni �controlla la posta� e link al login (`SignupView`, chiavi `auth.signupCheckEmail*`).

**Login tenant:** dopo `signInWithPassword`, `refreshSession()` + `getUser()`; consentire l�accesso alla dashboard tenant solo se `app_metadata.tenant_id` � valorizzato **oppure** `app_metadata.role === 'super_admin'` (policy `is_super_admin()` su `tenants` ecc.). In caso contrario, messaggio i18n e `signOut` (`LoginView`).

**EN:** After `signUp`, the SPA must obtain a JWT that includes `tenant_id` in `app_metadata` before running tenant-scoped queries: call `refreshSession()` (handle failures), then `getUser()` to validate claims, with short retries if the DB trigger lags. Do not navigate to the tenant app until `tenant_id` is present; surface a clear error otherwise (`SignupView` + i18n keys `auth.errorSessionRefresh` / `auth.errorTenantProvisioning`). If **email confirmation** is enabled and `signUp` returns **no session**, show the inbox + sign-in guidance instead of the JWT wait loop (`auth.signupCheckEmail*`). After **sign-in**, refresh + `getUser()` and allow navigation only when `tenant_id` is present **or** the user is `super_admin` (`LoginView`).

### RBAC

| Ruolo         | Tipo                                   | Accesso                            |
| ------------- | -------------------------------------- | ---------------------------------- |
| `super_admin` | `user_role` enum                       | Tutto cross-tenant (solo Andrea)   |
| `admin`       | `user_role` enum                       | Tutto nel proprio tenant           |
| `coordinator` | `user_role` enum                       | CRUD sessioni/speaker, vista regia |
| `tech`        | `user_role` enum                       | Vista sala, download, stato sync   |
| speaker       | Record in tabella `speakers` (NO auth) | Upload via `upload_token` univoco  |

---

## 7. Schema Database Completo

### Migration iniziale: `supabase/migrations/20250411090000_init_slide_center.sql`

**11 tabelle base + RLS + trigger** nella migration iniziale; estensioni successive aggiungono `paired_devices` e `pairing_codes` (vedi sotto).

| Tabella                 | Scopo                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `tenants`               | Organizzazioni SaaS con piano, quote storage, limiti, flag `suspended` (Fase 8, blocco accesso tenant in app)        |
| `users`                 | Utenti con ruolo (admin/coordinator/tech/super_admin), FK a auth.users                                               |
| `events`                | Congressi/convegni con status workflow (draft?setup?active?closed?archived) + `network_mode` (cloud/intranet/hybrid) |
| `rooms`                 | Sale fisiche per evento (main/breakout/preview/poster)                                                               |
| `sessions`              | Slot orari per sala (talk/panel/workshop/break/ceremony)                                                             |
| `speakers`              | Relatori con `upload_token` per accesso senza login                                                                  |
| `presentations`         | Collegamento speaker?versione corrente                                                                               |
| `presentation_versions` | **Append-only.** Ogni upload = nuova riga. Mai UPDATE.                                                               |
| `room_state`            | Stato realtime sala (sessione, sync status, agent connection)                                                        |
| `local_agents`          | Agent registrati con IP LAN + heartbeat                                                                              |
| `activity_log`          | Audit trail completo                                                                                                 |

**Invarianti immutabili:**

- `presentation_versions` e append-only: mai UPDATE
- `version_number` auto-increment via trigger SQL
- Cloud = fonte di verita, conflict resolution = cloud vince
- Ogni file ha `file_hash_sha256` calcolato client-side

**Realtime:** attivo su `room_state`, `presentation_versions`, `local_agents`, `paired_devices`. NON su `activity_log` (polling ogni 10s).

### Migration estensione � file nel repo: `supabase/migrations/20250415120000_pairing_super_admin.sql`

**Realtime:** la stessa migration aggiunge `paired_devices` alla publication `supabase_realtime` e rimuove `activity_log` (allineamento a quanto sopra: audit via polling, non Realtime).

```sql
-- Valore enum super_admin (nel repo: blocco DO $$ ... $$ su pg_enum, piu portabile di IF NOT EXISTS)
ALTER TYPE user_role ADD VALUE 'super_admin';

CREATE TABLE paired_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  device_name TEXT NOT NULL,
  device_type TEXT,
  browser TEXT,
  user_agent TEXT,
  pair_token_hash TEXT NOT NULL UNIQUE,
  last_ip INET,
  last_seen_at TIMESTAMPTZ,
  status connection_status NOT NULL DEFAULT 'offline',
  paired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paired_by_user_id UUID REFERENCES users(id),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_event ON paired_devices(event_id);
CREATE INDEX idx_devices_room ON paired_devices(room_id);
CREATE INDEX idx_devices_status ON paired_devices(tenant_id, status);

CREATE TABLE pairing_codes (
  code CHAR(6) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id),
  generated_by_user_id UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_device_id UUID REFERENCES paired_devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pairing_codes_expires ON pairing_codes(expires_at) WHERE consumed_at IS NULL;

ALTER TABLE paired_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON paired_devices FOR ALL USING (tenant_id = public.app_tenant_id());
CREATE POLICY tenant_isolation ON pairing_codes FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', false);
$$;

CREATE POLICY super_admin_all ON tenants FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON events FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON paired_devices FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON activity_log FOR ALL USING (public.is_super_admin());
```

**Nota implementazione:** sul database e stata aggiunta anche `CREATE POLICY super_admin_all ON pairing_codes` per consentire ispezione cross-tenant dei codici in fase di strumentazione admin (stesso criterio GDPR: metadati, non file).

### Migration quote � file nel repo: `supabase/migrations/20250415120100_quotas_enforcement.sql`

```sql
CREATE OR REPLACE FUNCTION public.check_storage_quota() RETURNS TRIGGER AS $$
DECLARE v_used BIGINT; v_limit BIGINT;
BEGIN
  SELECT storage_used_bytes, storage_limit_bytes INTO v_used, v_limit
  FROM tenants WHERE id = NEW.tenant_id;
  IF (v_used + NEW.file_size_bytes) > v_limit THEN
    RAISE EXCEPTION 'Storage quota exceeded for tenant';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_storage_quota BEFORE INSERT ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION public.check_storage_quota();

CREATE OR REPLACE FUNCTION public.update_storage_used() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tenants SET storage_used_bytes = storage_used_bytes + NEW.file_size_bytes WHERE id = NEW.tenant_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tenants SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.file_size_bytes) WHERE id = OLD.tenant_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER track_storage_used AFTER INSERT OR DELETE ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_storage_used();

ALTER TABLE tenants ALTER COLUMN storage_limit_bytes SET DEFAULT 5368709120;  -- 5 GB (Trial)
ALTER TABLE tenants ALTER COLUMN max_events_per_month SET DEFAULT 2;
ALTER TABLE tenants ALTER COLUMN max_rooms_per_event SET DEFAULT 3;
```

**Trigger quota:** la funzione `check_storage_quota()` nel repository considera `storage_limit_bytes < 0` come quota illimitata (Enterprise), cosi non si bloccano insert se il limite e segnato come illimitato nel dato tenant.

### Migration auth signup � file nel repo: `supabase/migrations/20250415130000_handle_new_user_tenant.sql`

Funzione `public.handle_new_user()` (SECURITY DEFINER) + trigger `on_auth_user_created` su `auth.users`: provisioning tenant + riga `public.users` + `raw_app_meta_data` con `tenant_id` e ruolo `admin`.

### Tipi TypeScript (`Database`)

`packages/shared/src/types/database.ts` � allineato alle migration finche `supabase gen types typescript --local` non e eseguibile (richiede Docker). Dopo ogni migration nuova: aggiornare il file o rigenerare e fare **diff**. Le directory `supabase/migrations/` sono in `.prettierignore` per evitare che Prettier alteri il SQL.

**EN:** `database.ts` mirrors the migrations for typed `createClient<Database>()`; regenerate from the CLI when local Supabase is available, then reconcile diffs. SQL under `supabase/migrations/` is listed in `.prettierignore` so formatting tools cannot break statements.

---

## 8. Pairing Dispositivi

### Flusso completo (RFC 8628 adattato)

```
ANDREA (dashboard)           PC SALA                 SUPABASE
       |                        |                        |
       | "+ Aggiungi PC"        |                        |
       |--------- Edge Function pair-init -------------->|
       |<--- codice "847291" + QR ----------------------|
       |                        |                        |
       | mostra codice + QR     | Tecnico apre           |
       |                        | app.liveslidecenter.com|
       |                        | /pair ? digita 847291  |
       |                        |--- pair-claim -------->|
       |                        |<-- JWT permanente -----|
       |                        |                        |
       |--- pair-poll --------->| ok, consumed           |
       |<-- "PC1 connesso!" ---|                        |
       |                        |                        |
       | "Assegna a sala? ?"    | redirect /sala/:token  |
       | sceglie Auditorium A   | mostra UI sala         |
```

### UX lato Andrea (dashboard)

1. Bottone `+ Aggiungi PC` in pagina evento
2. Modal con codice grande `8 4 7 2 9 1` + QR code
3. Testo: _"Sul PC sala vai su app.liveslidecenter.com/pair e digita questo codice. Valido 10 minuti."_
4. Spinner _"In attesa..."_
5. PC si connette ? checkmark verde ? dropdown _"Assegna a una sala"_
6. Conferma ? entry in lista: `PC1 � Auditorium A � online � Windows 11 Edge`

### UX lato tecnico (PC sala)

**Primo avvio (30 secondi):**

1. Apre Chrome/Edge ? `app.liveslidecenter.com/pair`
2. Campo grande per 6 cifre + tastierino numerico touch-friendly
3. Digita codice ? click "Connetti"
4. Andrea assegna sala ? redirect a `/sala/{room_token}`
5. Browser propone "Installa come app" ? icona desktop

**Riavvii successivi (0 secondi):** doppio click icona, parte fullscreen. Zero login.

### Sicurezza pairing

- Codice 6 cifre numerico, scadenza 10 minuti, single-use
- Rate limit: 5 tentativi errati per IP ? blocco 15 minuti
- HTTPS only, nessun client_secret distribuito
- JWT permanente con hash salvato in `paired_devices.pair_token_hash`
- Andrea puo revocare JWT dalla dashboard (forza ri-pairing)

### Discovery Agent locale (meccanismo corretto)

**I browser NON risolvono hostname mDNS `.local`.** Il meccanismo corretto:

1. Agent si avvia ? registra su Supabase: `local_agents.lan_ip = "192.168.1.100"`
2. PWA su PC sala chiede al cloud: `GET /local_agents?event_id=eq.{id}&status=eq.online`
3. Se trova Agent ? tenta `fetch("http://192.168.1.100:8080/api/v1/health")` con timeout 2s
4. Se risponde ? banner "Agent locale trovato, download piu veloci"
5. Se non risponde ? fallback silenzioso al cloud

### Edge Functions per pairing

| Funzione                | Trigger                          | Azione                                                                   |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `pair-init`             | Andrea clicca "+ Aggiungi PC"    | Genera codice 6 cifre, salva in `pairing_codes`, ritorna codice + QR URL |
| `pair-claim`            | Tecnico digita codice su `/pair` | Valida codice, crea record `paired_devices`, genera JWT, marca consumed  |
| `pair-poll`             | Dashboard polling ogni 2s        | Ritorna stato: pending/consumed con info device                          |
| `cleanup-expired-codes` | pg_cron ogni ora                 | Elimina codici scaduti da > 1 giorno                                     |

### Reset / cambio sala

**Tecnico:** menu Room Player ? "Cambia sala" / "Disconnetti PC" / "Forza re-sync"
**Andrea:** lista PC ? riassegna sala / revoca JWT / rinomina PC

---

## 9. Flussi di Sistema

### Upload Relatore

```
Relatore ? /u/{token} ? TUS su Supabase Storage ? Edge Function:
  ? crea presentation_version (append-only)
  ? verifica SHA-256
  ? aggiorna presentations.current_version_id
  ? emette Realtime event
  ? logga in activity_log
```

### Sync Cloud ? PWA Sala (Modalita A)

```
Supabase Realtime ? PWA subscription
  ? nuova versione ? download presigned URL ? cache locale ? overlay verde
```

### Sync Cloud ? Agent ? PWA Sala (Modalita B)

```
Supabase Realtime ? Agent download + cache locale + SQLite
PWA ? HTTP polling Agent LAN ogni 5s ? download se versione piu recente
```

### Scenari offline

| Scenario                | Comportamento            | Indicatore UI                  |
| ----------------------- | ------------------------ | ------------------------------ |
| Cloud + LAN OK          | Sync completo            | Verde: "v4 di 4 � Sync 14:32"  |
| Cloud OK, Agent offline | PWA cloud diretto        | Verde: "CLOUD DIRECT"          |
| Cloud offline, Agent OK | Agent serve cache        | Giallo: "LAN ONLY"             |
| Tutto offline           | PWA cache locale         | Rosso: "OFFLINE � v3 in cache" |
| Agent torna online      | Pull automatico mancanti | Giallo ? Verde                 |

---

## 10. Dashboard Super-Admin

Rotta `/admin/*`. Guard: se utente non ha `role='super_admin'`, redirect a `/dashboard`.

| Rotta                  | Contenuto                                                           |
| ---------------------- | ------------------------------------------------------------------- |
| `/admin`               | Tenant attivi, eventi in corso, storage totale, fatturato MTD       |
| `/admin/tenants`       | Lista clienti: nome, piano, storage (barra %), MRR, stato           |
| `/admin/tenants/:id`   | Dettaglio: team, eventi, fatture, log, "Sospendi", "Modifica quota" |
| `/admin/quotas`        | Override quote per cliente specifico                                |
| `/admin/system-health` | Stato Supabase, Vercel, errori                                      |
| `/admin/audit`         | Log cross-tenant (sicurezza, login, modifiche piano)                |

**Implementazione corrente (aprile 2026, Fase 8):** rotte live `/admin` (card riepilogo: numero tenant, eventi in stato setup/active, somma storage usato; placeholder fatturato MTD per Fase 11), `/admin/tenants` (tabella con link al dettaglio, badge sospeso/attivo), `/admin/tenants/:id` (piano e quote modificabili, sospensione tenant con colonna `tenants.suspended`, team `public.users`, eventi metadati soli, ultime 50 righe `activity_log` del tenant), `/admin/audit` (ultime 200 righe `activity_log` cross-tenant con link al tenant). Blocco accesso tenant: `LoginView` + `RequireAuth` verificano `suspended` via lettura `tenants` (gli utenti tenant non possono usare la dashboard fino a riattivazione; super_admin escluso). Migration `20250416120100_tenant_suspended.sql`.

**EN:** Phase 8 ships the super-admin console described above: aggregate dashboard cards, tenant list/detail with quota edits and suspend/reactivate, per-tenant and cross-tenant audit views, and login/session guards that read `tenants.suspended` (no presentation file content).

**Andrea NON puo (GDPR):** vedere contenuto file clienti, modificare dati eventi, inviare email ai relatori.

**Bootstrap super-admin (una volta sola):**

```sql
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}'::jsonb
WHERE email = 'live.software11@gmail.com';
```

---

## 11. Dashboard Tenant

```
+------------------------------------------------------+
� [Logo]  Studio Visio  ?              [IT/EN]  [User] �
+------------------------------------------------------�
� Dashboard   �  3 eventi � 12 file � 2.4 GB usati    �
� Eventi      �  [������������] 24% di 100 GB          �
� Team        �                                        �
� Storage     �  PROSSIMI EVENTI                        �
� Billing     �  > Congresso Cardiologia (in 12gg)     �
� Settings    �  > Workshop AI Medicale (in 28gg)      �
�             �  [+ Nuovo Evento]  [+ Invita Membro]  �
+------------------------------------------------------+
```

### Implementazione corrente (aprile 2026)

L'interfaccia tenant espone `/events` (lista + nuovo evento) e `/events/:eventId` con **Sale** (creazione, **modifica inline** nome + `room_type`, eliminazione a due passaggi), **Sessioni** (creazione + **modifica inline** titolo, sala, `session_type`, orari `datetime-local` ? UTC; `updateSessionById` con `eq('id', �)` sotto RLS; **riordino drag-and-drop** sull�elenco con persistenza `display_order` via `reorderSessionsDisplayOrder`; **commutatore vista** Elenco / **Per sala** � seconda modalit�: sessioni raggruppate per sala, ordinate per `scheduled_start`, **sola lettura** per orientamento operativo) e **Relatori** (creazione + **modifica inline** sessione, nome, email opzionale; `updateSpeakerById` con `eq('id', �)`). **Quote piano (read-only da riga `tenants` via RLS):** su `/events` pannello con storage usato/limite, conteggio **eventi con `start_date` nel mese di calendario locale corrente** rispetto a `max_events_per_month`, blocco soft del submit se il mese della `start_date` del form � gi� saturo; su `/events/:eventId` pannello con storage + **sale nell'evento** vs `max_rooms_per_event`, blocco creazione sala oltre limite. I valori effettivi restano quelli del DB (override super-admin possibili); nessun enforcement server-side aggiuntivo su INSERT `events`/`rooms` in questa iterazione. Alla creazione (o rigenerazione manuale su record legacy) il sistema assegna `upload_token` + `upload_token_expires_at` (90 giorni); in elenco compaiono **link assoluto** `/u/:token`, **copia negli appunti** e **QR** (`react-qr-code`). La pagina `/u/:token` e **live (Fase 3 completata)**: validazione token via RPC, upload TUS resumable a Supabase Storage (bucket privato `presentations`), hash SHA-256 client-side, finalize atomico con append-only `presentation_versions` e aggiornamento `presentations.current_version_id`+`status='uploaded'`. **Storico versioni (Fase 4 completata)** integrato nel dettaglio evento: ogni relatore espone un pannello con tutte le versioni (numero, timestamp, dimensione, hash troncato, stato), **download** via signed URL Storage (5 min, RLS tenant-only), **rollback/imposta come attuale** (RPC `rpc_set_current_version` � atomico: imposta `current_version_id`, marca `superseded` le altre `ready`, riattiva la selezionata se era `superseded`, logga `activity_log`), **workflow review** (RPC `rpc_update_presentation_status` con note revisore e timestamp), **Realtime** subscription su `presentations` + `presentation_versions` (il pannello si aggiorna automaticamente quando uno speaker completa un upload). Messaggi su CASCADE PostgreSQL (sala ? sessioni e relatori; sessione ? relatori). **Import CSV relatori (MVP):** in `/events/:eventId` sezione relatori con modello scaricabile (UTF-8 BOM), colonne `session_title`, `full_name`, `email` (opzionale); titolo sessione risolto su sessioni dell�evento con confronto case-insensitive e univocit�; massimo **200** righe dati; import **tutto-o-niente** su validazione righe; inserimenti via `createSpeakerForSession` (stesso flusso del form, token upload 90gg). **Fase 2 ancora da fare:** calendario/timeline **interattivo** (griglia oraria per sala, oltre all�elenco DnD e oltre alla vista Per sala read-only); eventuali altri import (sale/sessioni) non iniziati. **Fase 3 (completata):** portale `/u/:token` con upload TUS resumable, SHA-256 client-side e finalize via RPC.

**EN � Tenant UI:** Event detail supports **inline room edit** (name + room type) plus create/delete (two-step). **Sessions** and **speakers** support **inline edit** (same fields as create; updates scoped by row `id` under RLS). **Sessions list** supports **drag-and-drop reorder** persisted to `display_order` via `reorderSessionsDisplayOrder`, plus a **List / By room** toggle: **By room** is a **read-only** schedule grouped by room and sorted by `scheduled_start` (edits remain on the list view). **Plan quotas (read-only `tenants` row via RLS):** `/events` shows storage usage/limit plus **events whose `start_date` falls in the browser�s current calendar month** vs `max_events_per_month`, with a client-side guard on create when that month is already at capacity for the form�s start month; `/events/:eventId` shows storage plus **rooms in this event** vs `max_rooms_per_event`, blocking new rooms past the cap. DB values remain the source of truth; no extra server-side INSERT enforcement for `events`/`rooms` in this iteration. Speakers get the **90-day upload portal URL**, **copy**, and **QR** as above; `/u/:token` is **live (Phase 3 complete)**: token validation via SECURITY DEFINER RPC, resumable TUS upload to a private `presentations` bucket, client-side streaming SHA-256, atomic finalize appending a `presentation_versions` row and updating `presentations.current_version_id` / `status='uploaded'`. **Speaker CSV import (MVP):** on `/events/:eventId`, downloadable UTF-8 BOM template with `session_title`, `full_name`, `email` (optional); session titles are matched case-insensitively and must be unique within the event; **200** data rows max; validation is **all-or-nothing** before inserts; rows are created through `createSpeakerForSession` (same upload-token flow as manual create).

**EN:** Tenant UI exposes `/events` (list + create) and `/events/:eventId` with **Rooms** (inline edit), **Sessions** (inline edit), and **Speakers** (inline edit) as above. **Deletion:** two-step confirm; copy explains PostgreSQL `ON DELETE CASCADE` (room ? sessions and speakers; session ? speakers). Phase 2+ still pending: **interactive** calendar/timeline (time-grid per room, beyond DnD list and beyond read-only By room); broader CSV imports (rooms/sessions) are not started yet. Upload portal (Phase 3) is complete: `/u/:token` runs TUS resumable to a private `presentations` bucket with client-side SHA-256 and atomic RPC finalize. **Version history (Phase 4) is complete**: in `/events/:eventId` each speaker exposes a lazy-mounted, Realtime-backed panel listing every `presentation_version` (number, timestamp, size, short SHA-256, status) with **signed-URL download** (5 min, bucket stays private), **atomic rollback / set-as-current** via `rpc_set_current_version` (promotes the picked version, demotes other `ready` rows to `superseded`, restores from `superseded` when needed, logs `activity_log`), and a **review workflow** (`rpc_update_presentation_status` with reviewer note + timestamp + user id). Append-only invariants are enforced by the `guard_versions_immutable` trigger, which blocks UPDATEs of identity/path columns and locks the hash once set.

### Dettaglio evento � tab

| Tab             | Contenuto                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sale**        | CRUD sale, tipo, capacita, ordine                                                                                                                             |
| **Sessioni**    | Elenco con drag & drop su `display_order`; vista �Per sala� read-only (raggruppamento + `scheduled_start`); griglia calendario/timeline interattiva (da fare) |
| **Relatori**    | Lista speaker, QR upload, stato file                                                                                                                          |
| **PC Sala**     | Paired devices, stato live, "+ Aggiungi PC", drag & drop assegnazione                                                                                         |
| **Vista Regia** | Griglia realtime sale, fullscreen, colori stato inequivocabili                                                                                                |
| **Export**      | ZIP slide correnti + CSV log `activity_log` + PDF report metadati (`EventExportPanel`, lazy) — **Fase 10 completata**                                         |

**Fase 10 (dettaglio tecnico):** ZIP tramite signed URL Supabase (5 min) e `jszip`; CSV `activity_log` filtrato per `event_id` (max 5000 righe, UTF-8 BOM); PDF metadati con `jspdf`; `createVersionDownloadUrlWithClient` in `apps/web/src/features/presentations/repository.ts`; UI `apps/web/src/features/events/components/EventExportPanel.tsx` e `apps/web/src/features/events/lib/event-export.ts`; lazy import da `EventDetailView`.

### Flusso creazione evento (5 min)

1. "Nuovo Evento" ? form nome, date, location
2. Aggiungi sale (inline editing)
3. Aggiungi sessioni (orari + eventuale riordino elenco drag-and-drop)
4. Aggiungi speaker ? sistema genera `upload_token` + QR
5. "Pubblica" ? stato `setup` ? email automatica ai relatori
6. Tutti i file caricati ? stato `active`

### Rotte applicazione (mappa completa)

| Rotta                | Componente                                                                       | Accesso              | Auth                    |
| -------------------- | -------------------------------------------------------------------------------- | -------------------- | ----------------------- |
| `/`                  | `DashboardView`                                                                  | Tenant (autenticato) | JWT tenant              |
| `/events`            | `EventsView` � lista + creazione evento                                          | Tenant               | JWT tenant              |
| `/events/:eventId`   | `EventDetailView` � sale, sessioni, relatori (lista, creazione, delete conferma) | Tenant               | JWT tenant              |
| `/team`              | `TeamView`                                                                       | Admin tenant         | JWT admin               |
| `/storage`           | `StorageView`                                                                    | Tenant               | JWT tenant              |
| `/billing`           | `BillingView`                                                                    | Admin tenant         | JWT admin               |
| `/settings`          | `SettingsView`                                                                   | Tenant               | JWT tenant              |
| `/admin`             | `AdminDashboardView` statistiche aggregate + link                                | Solo `super_admin`   | JWT `app_metadata.role` |
| `/admin/tenants`     | `AdminTenantsView` elenco tenant                                                 | Solo `super_admin`   | JWT super_admin         |
| `/admin/tenants/:id` | `AdminTenantDetailView` quote, sospensione, team, eventi, log                    | Solo `super_admin`   | JWT super_admin         |
| `/admin/audit`       | `AdminAuditView` log cross-tenant                                                | Solo `super_admin`   | JWT super_admin         |
| `/admin/*`           | Estensioni roadmap (quote globali, health, ecc.)                                 | Solo `super_admin`   | JWT super_admin         |
| `/pair`              | `PairView` � tastierino codice 6 cifre                                           | Pubblico (tecnico)   | Nessuna                 |
| `/sala/:token`       | `RoomPlayerView` � PWA file manager                                              | PC sala paired       | JWT sala (pairing)      |
| `/u/:token`          | `UploadPortalView` � upload relatore                                             | Speaker esterno      | `upload_token`          |
| `/login`             | `LoginView`                                                                      | Pubblico             | Nessuna                 |
| `/signup`            | `SignupView`                                                                     | Pubblico             | Nessuna                 |

---

## 12. Piani Commerciali e Quote

### Piani (valori DEFINITIVI � devono corrispondere a `packages/shared/src/constants/plans.ts`)

| Piano          | �/mese | Eventi/mese | Sale/evento | Storage | File max | Utenti     | Agent      |
| -------------- | ------ | ----------- | ----------- | ------- | -------- | ---------- | ---------- |
| **Trial**      | 0      | 2           | 3           | 5 GB    | 100 MB   | 3          | 1          |
| **Starter**    | 149    | 5           | 10          | 100 GB  | 1 GB     | 10         | 3          |
| **Pro**        | 399    | 20          | 20          | 1 TB    | 2 GB     | 50         | 10         |
| **Enterprise** | da 990 | illimitato  | illimitato  | custom  | 5 GB+    | illimitato | illimitato |

**Nota Trial � Agent/evento:** il valore in produzione per il piano Trial � **1** agente per evento (coerente con `PLAN_LIMITS.trial` e enforcement futuro). Eventuali valori storici di bozza diversi vanno considerati deprecati.

**EN � Trial note:** the Trial plan caps **Local Agents per event at 1**, matching `packages/shared/src/constants/plans.ts` and future quota enforcement.

### TypeScript (`plans.ts`)

```typescript
export interface PlanLimits {
  storageLimitBytes: number;
  maxEventsPerMonth: number;
  maxRoomsPerEvent: number;
  maxAgentsPerEvent: number;
  maxUsersPerTenant: number;
  maxFileSizeBytes: number;
}

export const PLAN_LIMITS: Record<TenantPlan, PlanLimits> = {
  trial: {
    storageLimitBytes: 5 * 1024 ** 3,
    maxEventsPerMonth: 2,
    maxRoomsPerEvent: 3,
    maxAgentsPerEvent: 1,
    maxUsersPerTenant: 3,
    maxFileSizeBytes: 100 * 1024 ** 2,
  },
  starter: {
    storageLimitBytes: 100 * 1024 ** 3,
    maxEventsPerMonth: 5,
    maxRoomsPerEvent: 10,
    maxAgentsPerEvent: 3,
    maxUsersPerTenant: 10,
    maxFileSizeBytes: 1 * 1024 ** 3,
  },
  pro: {
    storageLimitBytes: 1024 * 1024 ** 3,
    maxEventsPerMonth: 20,
    maxRoomsPerEvent: 20,
    maxAgentsPerEvent: 10,
    maxUsersPerTenant: 50,
    maxFileSizeBytes: 2 * 1024 ** 3,
  },
  enterprise: {
    storageLimitBytes: -1,
    maxEventsPerMonth: -1,
    maxRoomsPerEvent: -1,
    maxAgentsPerEvent: -1,
    maxUsersPerTenant: -1,
    maxFileSizeBytes: -1,
  },
};
```

### Costi infrastruttura (partenza)

| Servizio      | Piano               | Costo     | Upgrade quando                          |
| ------------- | ------------------- | --------- | --------------------------------------- |
| Supabase      | Free                | 0�        | DB > 500MB o file > 50MB ? Pro $25/mese |
| Vercel        | Hobby               | 0�        | Primo cliente ? Pro $20/mese            |
| Dominio       | liveslidecenter.com | ~12�/anno | �                                       |
| GitHub        | Free                | 0�        | �                                       |
| Lemon Squeezy | Via Live WORKS APP  | 0�        | Automatico a prima vendita              |

**Costo iniziale: ~1�/mese.** Primo upgrade con primo cliente pagante (~45�/mese).

---

## 13. Design System

### Identita visiva

Allineata al sito marketing **www.liveworksapp.com**: navy profondo, blu brand, arancio accento, font DM Sans, superfici con bordi blu-tinti, card `rounded-2xl`. Dark mode only.

### Logo prodotto, favicon e PWA

- **Sorgente unica (versionata in git):** `icons/Logo Live Slide Center.jpg`. Non sostituire il marchio con placeholder testuali nelle schermate principali: usare il componente React dedicato.
- **Generazione asset:** `apps/web/scripts/generate-brand-icons.mjs` (Node + libreria **`sharp`** in `devDependencies` di `@slidecenter/web`). Lo script viene eseguito in **`prebuild`** e **`predev`** (`apps/web/package.json`) prima di Vite, cosi ogni build/deploy (incluso Vercel) rigenera le derivate dalla sorgente.
- **File generati in `apps/web/public/`:** `logo-live-slide-center.jpg` (JPEG ottimizzato, max ~512 px lato, usato in UI), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `pwa-192x192.png`, `pwa-512x512.png` (PNG da crop centrato ad alta qualita).
- **UI web:** `src/components/AppBrandLogo.tsx` — unico punto per `<img>` del marchio in sidebar tenant (`root-layout`), sidebar admin (`admin-root-layout`), login e signup. Il nome accanto al logo e sempre `t('app.displayName')` (chiavi `app.displayName` / `app.logoAlt` in `packages/shared/src/i18n/locales/it.json` e `en.json`).
- **HTML:** `apps/web/index.html` — `link rel="icon"` (16 + 32) e `apple-touch-icon` verso i PNG in `public/`.
- **PWA:** `vite.config.ts` (`vite-plugin-pwa`) — `manifest.icons` sui PNG 192/512; `includeAssets` elenca favicon, apple-touch e JPEG logo; Workbox `globPatterns` include estensione `jpg` per la precache.

**Workflow modifica logo:** sostituire il JPG in `icons/`, poi `pnpm --filter @slidecenter/web run icons:brand` oppure qualsiasi `pnpm run build` / `pnpm dev` dalla root (grazie a prebuild/predev). Verificare visivamente login, header e installazione PWA.

**EN — Brand & PWA assets:** One canonical JPG under `icons/` drives everything. A Sharp script runs on `prebuild`/`predev`, writes optimized web JPEG + favicon/apple-touch/PWA PNGs into `apps/web/public/`. Use `AppBrandLogo` plus `t('app.displayName')` for the wordmark—avoid ad-hoc `/logo...` URLs scattered across features.

### Palette (Tailwind 4 `@theme` tokens in `index.css`)

| Token Tailwind      | Valore hex | Uso                                                                          |
| ------------------- | ---------- | ---------------------------------------------------------------------------- |
| `sc-bg`             | `#07101f`  | Sfondo principale (navy profondo)                                            |
| `sc-surface`        | `#0d1c30`  | Card, sidebar, pannelli                                                      |
| `sc-elevated`       | `#132844`  | Superfici hover, elementi rialzati                                           |
| `sc-primary`        | `#3FA9F5`  | CTA, link, selezione, brand blue                                             |
| `sc-primary-deep`   | `#0B5ED7`  | Hover su primary, gradienti                                                  |
| `sc-accent`         | `#FF7A00`  | Badge admin, avvisi importanti                                               |
| `sc-accent-light`   | `#FF9A40`  | Accento secondario                                                           |
| `sc-navy`           | `#0A2540`  | Superfici brand compatte (non sostituiscono il logo immagine `AppBrandLogo`) |
| `sc-text`           | `#f0f2f5`  | Testo primario (titoli, contenuto)                                           |
| `sc-text-secondary` | `#b8c5d4`  | Testo secondario                                                             |
| `sc-text-muted`     | `#7a8da3`  | Label, metadata, placeholder                                                 |
| `sc-text-dim`       | `#556577`  | Testo terziario, hint                                                        |
| `sc-ring`           | `#3FA9F5`  | Focus ring                                                                   |
| `sc-success`        | `#4ade80`  | Synced, online, ready                                                        |
| `sc-warning`        | `#fbbf24`  | Syncing, LAN only, cap raggiunto                                             |
| `sc-danger`         | `#f87171`  | Offline, failed, errori                                                      |

### Bordi e opacita

- Bordi card/sezioni: `border-sc-primary/12` (blu al 12% — sottile, elegante)
- Bordi input/strong: `border-sc-primary/20`
- Bordi admin: `border-sc-accent/15`
- Divider: `divide-sc-primary/12`

### Tipografia

- **Font**: DM Sans (Google Fonts) — caricato in `index.html`
- **Stack CSS**: `'DM Sans', ui-sans-serif, system-ui, sans-serif`
- **Pesi**: 400 (body), 500 (label), 600 (titoli sezione), 700 (h1/h2)

### Componenti UI

- **Border radius**: `rounded-xl` per card, input, bottoni, sezioni. `rounded-2xl` per card principali (login, signup)
- **Sidebar**: `bg-sc-surface/80 backdrop-blur-xl` con bordo `border-sc-primary/10`
- **Bottoni primari**: `bg-sc-primary text-white shadow-lg shadow-sc-primary/20 hover:bg-sc-primary-deep`
- **Bottoni ghost**: `bg-sc-elevated text-sc-text-secondary hover:bg-sc-primary/8`
- **Input**: `bg-sc-bg border-sc-primary/15 rounded-xl focus:border-sc-primary/40 focus:ring-sc-ring/25`
- **Card**: `bg-sc-surface border-sc-primary/12 rounded-xl`
- **Glow decorativo** (login/signup): `bg-sc-primary/8 blur-3xl` + `bg-sc-accent/5 blur-3xl`

### App Tauri (agent + room-agent)

- Stesse variabili CSS (`--sc-bg`, `--sc-surface`, ecc.) in `<style>` inline
- Font DM Sans via Google Fonts `<link>`
- Card `.card { border-radius: 16px; }`
- Bottoni `.btn-primary { border-radius: 12px; box-shadow: ... }`
- Badge stato con classi `.badge-synced`, `.badge-offline`, ecc.

### Principi UX

1. Stato sempre visibile con colore inequivocabile
2. Zero ambiguita sulla versione (numero + timestamp + hash troncato)
3. Feedback entro 200ms
4. Dark mode only
5. Coerenza visiva con sito marketing www.liveworksapp.com
6. Densita informativa alta (target: tecnici esperti)

---

## 14. Guida Networking Operativa

### Modalita A � Cloud Puro (0 minuti setup)

**Prerequisiti:** ogni PC ha internet, banda minima 5 Mbps/sala.
**Andrea:** crea evento, genera codici pairing, comunica ai tecnici.
**Tecnico:** accende PC ? WiFi location ? browser ? `app.liveslidecenter.com/pair` ? codice ? fatto.

### Modalita B � Rete Locale (15-30 minuti setup)

**Hardware (una tantum, riutilizzabile):**

| Componente               | Esempio                                      | Prezzo        |
| ------------------------ | -------------------------------------------- | ------------- |
| Router WiFi              | TP-Link Archer AX55 / Ubiquiti UniFi Express | �80-150       |
| Access Point (opzionale) | Ubiquiti U6 Lite                             | �100-130 cad. |
| Mini-PC Agent            | Intel NUC / Beelink SER5                     | �250-400      |
| Cavi ethernet Cat6       | 5-10 cavi                                    | �10-30        |

**Setup fisico:** router in regia ? WAN a internet location ? mini-PC Agent via ethernet ? AP se sale lontane.
**Setup software:** apri Agent ? login ? seleziona evento ? Agent scarica file e registra IP al cloud.
**PC sala:** stessa procedura di Modalita A (WiFi del router Andrea invece che della location).

**NON serve VLAN:** il router crea rete isolata di default, DHCP automatico, Agent su 0.0.0.0:8080 raggiungibile da tutti.

### Rete hotel/centro congressi

**Opzione 1:** Usa rete hotel (Modalita A, zero hardware, qualita variabile).
**Opzione 2:** Rete parallela Andrea (Modalita B, controllo totale).
**Opzione 3:** Ibrido (internet hotel per cloud + rete Andrea per LAN file).

---

## 15. Roadmap Esecutiva

| Fase  | Nome                                       | Stato          | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Bootstrap monorepo                         | **Completata** | Stack funzionante nel repo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1     | Auth multi-tenant + signup + super-admin   | **Completata** | Trigger DB `handle_new_user`; `/login` `/signup` con Zod i18n; `RequireAuth` (con verifica `tenant_id` per non-super-admin); `/admin` + `RequireSuperAdmin`; `super_admin_all` RLS su **tutte** le tabelle operative; tipi `Database` in `packages/shared` (allineati migration). **Rimandati a pre-vendita:** inviti team (schema+UI), password reset UI, hardening JWT avanzato.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2     | CRUD Eventi/Sale/Sessioni/Speaker          | **Completata** | `/events` lista+insert+**update+delete** evento (header inline)+**UI quote**; `/events/:eventId` sale (update nome/tipo)+sessioni+relatori (lista+insert+update inline+delete conferma); **DnD sessioni** `display_order` via **RPC atomica** `rpc_reorder_sessions`; **vista Per sala** read-only; link+QR invite 90gg; **import CSV relatori** (max 200); **enforcement DB** `check_events_quota` + `check_rooms_quota` (trigger BEFORE INSERT). **Rimandati:** griglia calendario/timeline interattiva, import CSV sale/sessioni.                                                                                                                                                                                                                                                                                                                                                      |
| 3     | Upload Portal relatori (TUS)               | **Completata** | `/u/:token` live: validazione token via RPC `validate_upload_token` (SECURITY DEFINER), init draft version via RPC `init_upload_version` (enforcement cap file per piano + quota storage + trigger `check_storage_quota`), upload **TUS resumable** con `tus-js-client` verso `/storage/v1/upload/resumable` (chunk 6 MiB, retry esponenziale), **SHA-256 client-side** (Web Crypto streaming), finalize atomico via RPC `finalize_upload_version` (set `status='ready'`, hash, `presentations.current_version_id`+`status='uploaded'`, activity_log), abort via RPC `abort_upload_version`. Storage RLS: anon INSERT ammesso solo su path legati a version `status='uploading'`; SELECT solo tenant/super-admin. Contabilita `storage_used_bytes` spostata alla promozione a `ready` (drafts non bloccano quota). Realtime: tabella `presentations` pubblicata per Vista Regia (Fase 5). |
| 4     | Versioning + storico                       | **Completata** | Pannello storico versioni per speaker in `/events/:eventId`, download via Storage signed URL (5 min, bucket privato), rollback atomico via RPC `rpc_set_current_version` (auto-marca le altre `ready` come `superseded`, riattiva la selezionata se era `superseded`), workflow review via RPC `rpc_update_presentation_status` (`pending`/`uploaded`/`reviewed`/`approved`/`rejected`) con `reviewer_note` + `reviewed_at` + `reviewed_by_user_id`, guard DB **append-only** su `presentation_versions` (storage_key/file_name/version_number/hash immutabili dopo finalize), indice `(presentation_id, version_number DESC)`, Realtime attivo su `presentations` + `presentation_versions` (UI si auto-aggiorna quando lo speaker carica dal portale).                                                                                                                                  |
| 5     | Vista Regia realtime                       | **Completata** | Rotta `/events/:eventId/live` (lazy-loaded `LiveRegiaView`): griglia sale responsive con card per sala (sessione corrente/prossima, lista relatori con pallino stato presentazione, barra progresso upload/approvati), barra riepilogo evento (sale, relatori, upload, approvati, rifiutati), activity feed laterale con polling 10s su `activity_log`, Supabase Realtime su `presentations`+`presentation_versions`+`rooms`+`sessions`+`speakers` (auto-refresh snapshot), toggle fullscreen (Fullscreen API), bottone Vista Regia nell'header `EventDetailView`, chiavi i18n `liveView.*` IT/EN.                                                                                                                                                                                                                                                                                        |
| **6** | **Pairing Device + Room Player PWA**       | **Completata** | 4 Edge Functions Deno (pair-init/claim/poll/cleanup); modulo `devices` con PairingModal+DeviceList+DevicesPanel; rotta pubblica `/pair` (tastierino 6 cifre); `/sala/:token` RoomPlayerView file manager ATTIVO (File System Access API, download automatico su disco, progresso per-file, Realtime) + Realtime; vite-plugin-pwa manifest+Workbox; chiavi i18n IT/EN `devices.*`+`pair.*`+`roomPlayer.*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **7** | **Dual-Mode File Sync (Cloud + Intranet)** | **Completata** | Blocco A: File System Access API PWA; Blocco B: Local Agent Tauri v2 `apps/agent/` Axum+SQLite; Blocco C: Room Agent `apps/room-agent/` polling+autostart+tray; Blocco D: `network_mode ENUM(cloud/intranet/hybrid)` su `events`; i18n IT/EN; ADR-007                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8     | Dashboard Super-Admin completa             | **Completata** | `/admin` card aggregate; `/admin/tenants`+dettaglio `/admin/tenants/:id` (quote piano/storage/eventi/sale, sospendi/riattiva `suspended`, team users, eventi metadati, log tenant); `/admin/audit` cross-tenant; migration `tenants.suspended`; guard login+`RequireAuth`; i18n `admin.*` / `auth.errorTenantSuspendedLogin` IT+EN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **9** | **Offline architecture + routing runtime** | **Completata** | Edge `room-player-bootstrap` (token → sala + `network_mode` + agent LAN + lista versioni ready); Room Player: chip percorso + banner offline, `useFileSync` cloud/LAN/hybrid, polling 12s manifest/stato sala, `localStorage` ultimo manifest se cloud irraggiungibile; Workbox runtime cache REST + signed URL; `verify_jwt = false` su function (auth = token body); deploy: `supabase functions deploy room-player-bootstrap` + stessa voce in Dashboard se necessario                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 10    | Export fine evento                         | **Completata** | `/events/:eventId`: ZIP slide `current_version` ready (`jszip` + signed URL Storage), CSV `activity_log` per evento (UTF-8 BOM, max 5000 righe), PDF riepilogo metadati (`jspdf`); `EventExportPanel` lazy-loaded; `createVersionDownloadUrlWithClient`; i18n `event.export.*` IT/EN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 11    | Billing Lemon Squeezy                      | Da fare        | Solo a primo cliente pagante                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 12    | i18n completamento                         | In corso       | ~150 chiavi gia, completare                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 13    | Integrazioni ecosistema                    | Futuro         | Timer, CREW, API pubblica                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 14    | Hardening + Sentry + E2E                   | Pre-vendita    | Rate limiting, audit RLS, Playwright                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Logica:** Fasi 0-10 = MVP cloud + intranet + super-admin + Room Player offline-aware + **export fine evento** (ZIP/CSV/PDF). Fasi 11-14 = billing, i18n polish, integrazioni, hardening.

### Stima avanzamento e problemi noti

**Stima MVP (fasi 1�6, cfr. logica sopra):** ad aprile 2026, indicativamente **100%** del percorso verso il MVP cloud vendibile: fasi **0**, **1**, **2**, **3**, **4**, **5** e **6** completate. Per la Fase 3: portale `/u/:token` con validazione token via RPC SECURITY DEFINER (`validate_upload_token`), init draft version (`init_upload_version`) che applica cap file per piano + cap storage + trigger `check_storage_quota`, upload TUS resumable 6 MiB/chunk con retry esponenziale verso bucket privato `presentations`, SHA-256 client-side via Web Crypto, finalize atomico (`finalize_upload_version`) che promuove a `status='ready'`, scrive hash, aggiorna `presentations.current_version_id` + `status='uploaded'`, logga `activity_log`; abort best-effort (`abort_upload_version`) su errore client. Storage RLS: anon INSERT solo su path di version `uploading`; SELECT solo tenant/super-admin. Per la Fase 4: storico versioni per relatore in `/events/:eventId` (pannello espandibile lazy-mounted), download firmato `createSignedUrl` a 5 min dal bucket privato, rollback atomico via RPC `rpc_set_current_version` (promuove la versione selezionata, marca le altre `ready` come `superseded`, ripristina da `superseded` se necessario), workflow review `uploaded/reviewed/approved/rejected` via RPC `rpc_update_presentation_status` con `reviewer_note/reviewed_at/reviewed_by_user_id`, guard DB `guard_versions_immutable` append-only (blocca UPDATE su `storage_key/file_name/version_number/presentation_id/tenant_id` e sull'hash una volta scritto), Realtime `postgres_changes` su `presentations` + `presentation_versions` che aggiorna il pannello senza polling. Per la Fase 5: Vista Regia `/events/:eventId/live` (lazy-loaded `LiveRegiaView`) con griglia sale responsive (card per sala con sessione corrente/prossima, lista relatori con pallino stato, barra progresso), barra riepilogo evento, activity feed polling 10s su `activity_log`, Realtime su 5 tabelle, toggle fullscreen, bottone nell�header `EventDetailView`, chiavi i18n `liveView.*` IT/EN. Fase 6 live: 4 Edge Functions Deno per pairing device (pair-init/claim/poll/cleanup); modulo `devices` con PairingModal (codice 6 cifre + QR + countdown), DeviceList, DevicesPanel integrato in EventDetailView; rotta pubblica `/pair` con tastierino touch-friendly 6 cifre (auto-advance, auto-submit, rate-limit UI 3s), pair-claim, redirect `/sala/:token`; rotta `/sala/:token` RoomPlayerView con auth via token SHA-256, file manager ATTIVO con File System Access API (download automatico su disco, progresso per-file), Realtime su `room_state`+`presentations`, menu (openFolder placeholder ADR-001, changeRoom, disconnect); vite-plugin-pwa manifest dark+Workbox runtimeCaching Supabase; chiavi i18n `devices.*`+`pair.*`+`roomPlayer.*` IT/EN (52 chiavi). Se si considera l�intera roadmap **0-14** con pesi simili per fase, la percentuale lineare sul totale visione prodotto si colloca indicativamente attorno al **70-75%** (fasi **0-10** chiuse su quindici step 0-14). **Fase 10:** export ZIP/CSV/PDF in `/events/:eventId`. **Fase 9:** Edge `room-player-bootstrap` + routing download nel Room Player PWA. **Fase 8:** console super-admin (`/admin`, `/admin/tenants`, `/admin/tenants/:id`, `/admin/audit`), colonna `tenants.suspended`, guard su `LoginView`/`RequireAuth` (blocco UI tenant; eventuale enforcement RLS granulare su tutte le tabelle operativo rimandato a hardening Fase 14 se richiesto).

**Gap dichiarati (rimandati con scelta consapevole):**

- **Inviti team** (Fase 1): schema tabella `team_invitations`, Edge Function per invito email, UI in `/settings/team`. Rimandato a pre-vendita.
- **Password reset UI** (Fase 1): chiavi i18n presenti, flusso `resetPasswordForEmail` non ancora in UI. Rimandato a pre-vendita.
- **Griglia calendario/timeline interattiva** (Fase 2): la vista Per sala read-only copre l'orientamento operativo; timeline drag-and-drop e nice-to-have.
- **Import CSV sale/sessioni** (Fase 2): non richiesto per MVP. Import relatori gia funzionante.

**Problemi / vincoli (non necessariamente bug di codice):**

- **Docker / Supabase locale:** senza Docker Desktop (o stack equivalente) non si eseguono `supabase start`, `supabase db reset`, `supabase gen types typescript --local`. Le relative caselle in **�18** restano `[ ]` finch� l�ambiente non esiste: � un **debito di toolchain**, non una misura del codice nel repo.
- **Tipi TypeScript:** `packages/shared/src/types/database.ts` resta **allineato alle migration per revisione manuale** fino al primo `gen types` locale utile; poi diff controllato rispetto al file versionato.
- **Infra commerciale:** progetto Supabase EU, Vercel, dominio, `db push` remoto � stato in **�18 Account**; dipende da account e deploy, non solo dal monorepo.

**EN:** For **MVP phases 1�6**, the project is now **100%** complete (MVP fully delivered). Phase 3 is live: `/u/:token` runs TUS resumable uploads (6 MiB chunks, exponential retry) into a private `presentations` bucket; init/validate/finalize/abort run through SECURITY DEFINER RPCs that enforce the per-plan file cap, the `storage_limit_bytes` quota, and append-only `presentation_versions`; client-side streaming SHA-256 is persisted on finalize; `storage_used_bytes` is accounted only when a version is promoted to `ready` (drafts don't lock quota); Storage RLS allows anon INSERT solely on paths bound to a `presentation_versions` row in status `uploading`, SELECT is tenant-scoped (plus super-admin). Phase 4 is live: per-speaker version history panel in `/events/:eventId` (lazy-mounted, Realtime-backed), 5-minute signed download URLs from the private bucket, atomic rollback via `rpc_set_current_version` (promotes the picked version, demotes the other `ready` rows to `superseded`, restores from `superseded` when needed), review workflow `uploaded/reviewed/approved/rejected` via `rpc_update_presentation_status` with reviewer note + timestamp + user id, and a `guard_versions_immutable` trigger that makes `presentation_versions` append-only for identity/path fields and locks the SHA-256 hash once set. Phase 5 is live: `/events/:eventId/live` control room (lazy-loaded `LiveRegiaView`) with a responsive room grid (per-room card showing current/next session, speaker list with presentation-status dots, upload progress bar), event summary bar (room/speaker/uploaded/approved/rejected counters), activity feed sidebar (10s polling on `activity_log`), Supabase Realtime on `presentations`+`presentation_versions`+`rooms`+`sessions`+`speakers` (auto-refresh snapshot), Fullscreen API toggle, Control Room button in the `EventDetailView` header, and `liveView.*` i18n keys (IT/EN). Phase 6 is live: 4 Deno Edge Functions (pair-init/claim/poll/cleanup); `devices` module with PairingModal (6-digit code + QR + countdown), DeviceList, DevicesPanel in EventDetailView; public route `/pair` (6-digit numeric keypad, auto-advance, auto-submit, 3s rate-limit); `/sala/:token` RoomPlayerView with SHA-256 token auth, passive file manager, Realtime on `room_state`+`presentations`, menu (folder placeholder ADR-001, change room, disconnect); vite-plugin-pwa dark manifest + Workbox Supabase runtimeCaching; i18n keys `devices.*`/`pair.*`/`roomPlayer.*` IT/EN (52 keys). Across **all roadmap phases 0�14**, a naive equal-weight view is about **70–75%** (phases **0–10** closed of fifteen steps 0–14). **Phase 10:** end-of-event export (ZIP/CSV/PDF) on /events/:eventId. **Phase 9:** `room-player-bootstrap` + Room Player cloud/LAN/hybrid routing. **Phase 8:** super-admin console (/admin, /admin/tenants, /admin/tenants/:id, /admin/audit), `tenants.suspended`, and login/session guards; full RLS-wide suspension is deferred unlesss required in Phase 14.**. **Tooling:** without Docker, local Supabase CLI flows stay blocked; �18 checkboxes reflect that. **`database.ts`\*\* stays hand-synced with migrations until `gen types --local` is viable.

---

## 16. Struttura Monorepo

```
Live SLIDE CENTER/
+-- apps/
�   +-- web/                 # Dashboard + Upload Portal + Room Player PWA (React 19)
�   +-- agent/               # Local Agent (Tauri v2) � Fase 7 � mini-PC regia
�   �   +-- src-tauri/       # Rust: Axum HTTP :8080, SQLite WAL, sync engine
�   �   +-- ui/              # HTML standalone dashboard
�   +-- room-agent/          # Room Agent (Tauri v2 lite) � Fase 7 � ogni PC sala
�       +-- src-tauri/       # Rust: polling LAN, download, autostart HKCU, tray
�       +-- ui/              # HTML standalone pannello configurazione
+-- packages/
�   +-- shared/              # Types, Zod validators, constants, i18n IT/EN
�   +-- ui/                  # cn() utility, componenti shadcn
+-- supabase/
�   +-- migrations/          # Schema SQL + RLS
�   +-- functions/           # Edge Functions Deno (health, pair-init, pair-claim, pair-poll, cleanup, room-player-bootstrap)
�   +-- seed.sql
�   +-- config.toml
+-- icons/                   # Logo sorgente ufficiale (JPG) -> genera apps/web/public/* (script prebuild)
+-- scripts/                 # Setup PowerShell (MCP Supabase)
+-- docs/
�   +-- GUIDA_DEFINITIVA_PROGETTO.md  ? QUESTO FILE (unico)
+-- turbo.json
+-- pnpm-workspace.yaml
+-- .env.example
```

**ATTENZIONE:** `apps/player/` NON deve esistere come progetto Tauri. Il Room Player e la route `/sala/:token` in `apps/web/`.

---

## 17. Account e Infrastruttura

| Risorsa       | Account                       | Note                                                      |
| ------------- | ----------------------------- | --------------------------------------------------------- |
| GitHub        | **live-software11**           | `github.com/live-software11/live-slide-center`            |
| Supabase      | **live.software11@gmail.com** | Project: `live-slide-center`, Ref: `cdjxxxkrhgdkcpkkozdl` |
| Vercel        | **live.software11@gmail.com** | Dominio: `app.liveslidecenter.com`                        |
| Lemon Squeezy | Via Live WORKS APP            | Fase 11                                                   |
| Sentry        | **live.software11@gmail.com** | Fase 14                                                   |
| Cloudflare R2 | �                             | Solo quando egress > $50/mese                             |

**Prima di ogni push:** `gh auth status` ? deve essere **live-software11**.

---

## 18. Checklist Pre-Fase-1

### Documentazione

- [ ] Letto questo documento per intero
- [x] Logo / favicon / PWA: sorgente `icons/Logo Live Slide Center.jpg`, script `apps/web/scripts/generate-brand-icons.mjs`, componente `AppBrandLogo`, i18n `app.displayName` (dettaglio §13)
- [x] `.cursor/rules/project-architecture.mdc` � gia con riferimento esplicito a questo file
- [x] Regola Cursor **obbligatoria** allineamento guida/codice: `.cursor/rules/guida-definitiva-doc-sync.mdc` (`alwaysApply: true`)
- [x] Regola Cursor review + step successivo: `.cursor/rules/surgical-review-next-step.mdc` (`alwaysApply: true`)

### Account

- [ ] Supabase progetto EU Francoforte attivo
- [ ] Vercel collegato al repo
- [ ] Dominio `liveslidecenter.com` (o equivalente) acquisito

### Database

> **Nota:** assenza di Docker sulla workstation di sviluppo lascia `[ ]` su `supabase start` / `db reset` / `gen types --local` senza invalidare l�allineamento migration ? codice nel repo (tipi manutenuti a mano, �15 �problemi noti�).

- [ ] `supabase start` locale OK (Docker Desktop attivo + CLI Supabase nel PATH)
- [x] Migration iniziale nel repo: `20250411090000_init_slide_center.sql`
- [x] Migration pairing + super-admin + Realtime: `20250415120000_pairing_super_admin.sql`
- [x] Migration quote storage + default Trial: `20250415120100_quotas_enforcement.sql`
- [x] Migration auth signup ? tenant: `20250415130000_handle_new_user_tenant.sql`
- [x] Migration applicata manualmente al progetto remoto (SQL Editor) � trigger, tabelle, RLS, quote, RPC
- [ ] Verifica applicata: `supabase db reset` locale (Docker) senza errori SQL
- [x] Tipi `Database` per PostgREST: `packages/shared/src/types/database.ts` (manutenuti a mano in linea con le migration finche Docker non consente `supabase gen types typescript --local`)
- [ ] Dopo primo `supabase db reset` locale: rigenerare i tipi con CLI e **diff** rispetto al file corrente (funzioni/trigger extra da CLI vanno incorporate o documentate)
- [x] Bootstrap super-admin eseguito (sezione 10, `UPDATE auth.users`) dopo primo signup
- [x] Migration hardening fasi 1-2: `20250415140000_phase1_2_hardening.sql` (super_admin_all + quota enforcement + RPC reorder)
- [x] Migration Fase 3 Upload Portal: `20250416090000_phase3_upload_portal.sql` (bucket privato `presentations`, Storage RLS anon-insert vincolato a version `uploading`, RPC `validate_upload_token` / `init_upload_version` / `finalize_upload_version` / `abort_upload_version`, helper `tenant_max_file_size`, rework `update_storage_used` su transizione `ready`, Realtime su `presentations`)
- [x] Migration Fase 4 Versioning: `20250417090000_phase4_versioning.sql` (colonne review `reviewer_note` / `reviewed_at` / `reviewed_by_user_id`, RPC `rpc_set_current_version` e `rpc_update_presentation_status`, guard append-only `guard_versions_immutable`, indice storico versioni)
- [x] Migration Fase 7 Dual-Mode: `20250416120000_network_mode.sql` (ENUM `network_mode(cloud|intranet|hybrid)` + colonna `events.network_mode NOT NULL DEFAULT 'cloud'`)
- [x] Migration Fase 8 Super-Admin: `20250416120100_tenant_suspended.sql` (colonna `tenants.suspended BOOLEAN NOT NULL DEFAULT false`)
- [x] Edge Function Fase 9: `supabase/functions/room-player-bootstrap/` + `[functions.room-player-bootstrap] verify_jwt = false` in `config.toml`

### Codice

- [x] `packages/shared/src/types/enums.ts`: `UserRole` include `'super_admin'`
- [x] `packages/shared/src/constants/plans.ts`: valori allineati a sezione 12
- [x] `PlanLimits` include `maxFileSizeBytes`
- [x] `apps/player/` eliminato (non deve esistere) � fatto
- [x] `pnpm run typecheck` � verde in CI locale (aprile 2026)
- [x] `pnpm run lint && pnpm run build` � verde in locale (aprile 2026)

### Design

- [ ] Wireframe dashboard tenant
- [ ] Wireframe modal "Aggiungi PC" con codice 6 cifre + QR
- [ ] Wireframe pagina `/pair` con tastierino
- [ ] Wireframe Room Player fullscreen
- [ ] Wireframe dashboard super-admin

**EN � Checklist status:** Migrations are in-repo; tenant routes are auth-guarded; `SignupView` shows check-email when `signUp` returns no session, otherwise waits for `tenant_id` on the JWT via `refreshSession()` + `getUser()` with retries before navigating home; `LoginView` refreshes and requires `tenant_id` or `super_admin` before navigating. `database.ts` is hand-maintained until `supabase gen types --local` runs. Super-admin has `/admin` (aggregate stats), `/admin/tenants`, `/admin/tenants/:id` (quotas + `suspended` + team/events metadata + tenant-scoped `activity_log`), and `/admin/audit` (cross-tenant `activity_log`); tenant login is blocked when `tenants.suspended` is true. Tenant `/events` lists and creates events (RLS) with a **quota summary** (storage + events starting in the current calendar month vs `max_events_per_month`) and a **client-side create guard** when the selected start month is already at capacity; `/events/:eventId` shows the same **storage** plus **rooms in this event** vs `max_rooms_per_event`, with a **client-side room create guard** at capacity. Event detail still includes rooms (**inline edit** name/type), sessions and speakers (**inline edit** on the same fields as create), list + create + delete with two-step confirm and CASCADE hints; **sessions list** supports **HTML5 drag-and-drop** on a handle to reorder rows and persist **`display_order`** (`reorderSessionsDisplayOrder`); **upload invite link + QR** on each speaker; **`speaker-csv-import`** adds UTF-8 BOM **CSV import** (template + all-or-nothing validation, max 200 rows, `session_title` ? session match) before bulk `createSpeakerForSession`; `/u/:token` is a **stub** until TUS. **�15** now includes a quantitative MVP estimate and a �known issues / tooling� note (Docker vs checklist �18). Remaining: Docker `db reset` + type regen, wireframes, Phase 1 invites, **upload portal TUS + Storage**, advanced calendar/timeline UX, DB-level quota enforcement if required, further admin routes.

---

## 19. Regole Non Negoziabili

1. **Mai dati senza tenant_id** � ogni riga DB, ogni file Storage, ogni request API
2. **Mai scorciatoie su RLS** � se una query funziona solo bypassando RLS, e un bug
3. **Mai logica sicurezza solo nel client** � check in Edge Function o Postgres, mai solo React
4. **Mai promettere offline senza Agent** � indicare chiaramente: "Cloud diretto" vs "Offline resiliente"
5. **Mai spendere senza clienti che giustifichino** � Free tier finche possibile
6. **Mai stringa UI senza coppia IT/EN** � zero eccezioni, stesso commit
7. **Mai UPDATE su `presentation_versions`** � append-only, ogni modifica = nuova riga
8. **Mai `apps/player/` come progetto Tauri** � Room Player = PWA in `apps/web/`
9. **Mai vedere contenuto file clienti** � Super-Admin vede metadati, non binari (GDPR)
10. **Mai mDNS da browser** � Agent registra IP al cloud, PWA lo interroga dal cloud

---

## Ecosistema Live Software

```
Live SLIDE CENTER
  +-- Licenze --> Live WORKS APP (Lemon Squeezy, Fase 11)
  +-- Timer --> Live Speaker Timer (info sessione ? countdown, Fase 13)
  +-- Tecnici --> Live CREW (assegnazione tecnici, futuro)
  +-- Eventi --> Live PLAN (pianificazione, futuro)
```

Integrazioni future. Priorita: prodotto standalone vendibile.

---

**Questo e l'unico documento.** Ogni decisione futura non coperta qui: prima aggiorna questo file, poi scrivi il codice. Cosi tra 6 mesi hai un unico posto dove leggere "perche ho deciso X".

**EN:** This is the single source of truth for Live SLIDE CENTER. All architecture, storage, pairing, dashboards, plans, networking, and roadmap decisions are here. In case of conflict with any other document, this file wins.
