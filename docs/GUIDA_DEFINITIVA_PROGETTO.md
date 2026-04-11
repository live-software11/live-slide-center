# GUIDA DEFINITIVA PROGETTO — Live SLIDE CENTER

> **Documento master unico.** Sostituisce `PRE_CODE_PREPARATION.md`, `LIVE_SLIDE_CENTER_DEFINITIVO.md` e rappresenta la fonte di verita per tutto il progetto. In caso di conflitto con altri documenti, **questo vince**.
> **Versione:** 2.0 Definitiva — Aprile 2026
> **Autore:** Andrea Rizzari + CTO Senior AI Review
> **Stack tecnico:** React 19 + Vite 8 + TypeScript strict + Supabase (tutto-in-uno) + Vercel — gia nel repo, typecheck/lint/build OK.

---

## 1. Obiettivi Strategici

1. **SaaS multi-tenant puro** — ogni azienda cliente ha il proprio spazio isolato: dashboard, eventi, file. Zero contaminazioni tra clienti.
2. **Onboarding frictionless** — signup → tenant → primo evento → invito relatori: meno di 10 minuti.
3. **Zero-config per i PC sala** — il tecnico apre un URL (o scansiona un QR), la sala e configurata. Niente software da installare.
4. **Storage senza limiti pratici** — file fino a 500GB, eventi con TB di dati, zero paura dello spazio.
5. **Funzionamento offline garantito** — l'evento non si ferma mai, nemmeno se cade internet (Fase 7+).
6. **Partenza a costo zero** — infrastruttura gratuita fino al primo cliente pagante, scalabile senza riscrivere codice.

---

## 2. Analisi Alternative Storage (decisione definitiva)

Prima di costruire, sono state analizzate le alternative principali. Questa sezione documenta il ragionamento per evitare di ripercorrere la stessa strada.

### pCloud — SCARTATO

| Aspetto | Dettaglio |
|---------|-----------|
| Pro | Nessun limite dimensione file; piani lifetime (~200 EUR per 500GB); SDK JavaScript |
| Contro fatale | Prodotto consumer. Zero isolamento multi-tenant. Nessun presigned URL vincolato a tenant. Qualsiasi utente che conosce la struttura cartelle potrebbe accedere a file altrui. Tutta la sicurezza andrebbe costruita da zero. |
| Verdetto | Non adatto a SaaS con dati di terzi. |

### Google Drive — SCARTATO

| Aspetto | Dettaglio |
|---------|-----------|
| Pro | File fino a 5TB; upload resumable; API gratuita |
| Contro fatale | I relatori dovrebbero autenticarsi con un account Google. Il flusso "apri link → carica file → fatto" diventa "accedi a Google → autorizza app → carica". UX distrutta. Limite 750GB/giorno. Nessun isolamento tenant nativo. |
| Verdetto | L'OAuth Google e incompatibile con upload token-based anonimi per speaker. |

### AWS S3 — SOVRADIMENSIONATO

| Aspetto | Dettaglio |
|---------|-----------|
| Pro | Standard industriale; scalabile all'infinito; ecosistema enorme |
| Contro | Egress $0.09/GB (1TB scaricato = $90). Complessita IAM sproporzionata per la fase attuale. Costi imprevedibili senza esperienza. |
| Verdetto | Ottimo a scala enterprise, eccessivo per l'MVP e il primo anno. |

### Cloudflare R2 — OTTIMO MA RIMANDATO

| Aspetto | Dettaglio |
|---------|-----------|
| Pro | Zero egress (!); S3-compatible (`@aws-sdk/client-s3`); $0.015/GB storage; performance EU eccellente (benchmark Q1 2026 Backblaze) |
| Contro | Servizio aggiuntivo separato da Supabase. Nessuna integrazione nativa con Supabase Auth/RLS. Richiede account Cloudflare, carte di credito, API keys separate. |
| Verdetto | Migrazione quasi trasparente in futuro (stesso SDK S3). Si usa quando l'egress mensile supera $50, ovvero con 10+ clienti attivi. |

### Supabase Storage — VINCITORE per MVP e oltre

| Aspetto | Dettaglio |
|---------|-----------|
| File max | 500GB/file su piano Pro ($25/mese); 50MB su Free |
| Protocollo upload | TUS resumable nativo (chunk fissi 6MB); S3 multipart nativo |
| Compatibilita S3 | Completa: `@aws-sdk/client-s3`, presigned URL via SigV4, multipart upload |
| Integrazione Auth | Le Storage Policies usano lo stesso JWT tenant-scoped del database Postgres. Zero configurazione aggiuntiva. |
| Isolamento tenant | Path `tenants/{tenant_id}/events/{event_id}/...` + policy RLS-like su bucket. Un cliente non puo mai vedere i file di un altro. |
| Migrazione futura | Basta cambiare endpoint S3: `supabase.co/storage/v1/s3` diventa `r2.cloudflarestorage.com`. Il codice resta identico. |
| Costo iniziale | Free (prime demo), Pro $25/mese (quando gli speaker caricano file > 50MB) |

**Decisione definitiva:** Supabase Storage per tutto. Un solo servizio gestisce DB + Auth + Realtime + Storage + Edge Functions. R2 solo se e quando i costi di storage/egress lo giustificano.

---

## 3. Architettura Definitiva Semplificata

```
+----------------------------------------------------------+
|  CLOUD (Supabase EU - Francoforte + Vercel)              |
|                                                          |
|  Supabase                    Vercel                      |
|  - Postgres + RLS            - React 19 + Vite 8        |
|  - Auth multi-tenant         - Dashboard admin          |
|  - Storage S3-compatible     - Upload Portal (pubblico) |
|  - Realtime                  - Room Player PWA          |
|  - Edge Functions                                        |
+------------------+---------------------------------------+
                   |
     +-------------+-------------+
     |             |             |
  Admin         Relatore     Tecnico sala
  (browser)   (smartphone)   (browser/PWA)
                                  |
                          [se evento offline]
                                  |
                    +-------------+
                    |  Local Agent |
                    |  (Tauri v2)  |
                    |  mini-PC     |
                    |  regia       |
                    +-------------+
```

### Componente 1: Dashboard Web (apps/web — React 19 + Vite)

Gia nel repo, funzionante. Cuore del prodotto: gestione eventi, sale, sessioni, speaker, vista regia live. Accessibile da qualsiasi browser su qualsiasi dispositivo.

**Perche React + Vite e non Next.js:** questa e una SPA (Single Page Application) — tutto il rendering avviene nel browser. Non serve SEO, non serve SSR. React + Vite e gia nel repo, testato, funzionante. Next.js aggiungerebbe complessita senza vantaggi concreti. La coerenza con il resto dell'ecosistema Live Software (PLAN, CREW, WORKS, Ledwall) e un ulteriore vantaggio.

### Componente 2: Upload Portal (route /u/:token nella stessa web app)

Pagina pubblica accessibile via link o QR code. Il relatore carica il file senza login. Il token univoco identifica speaker + sessione. Upload via TUS resumable: se la connessione cade, riprende da dove si era fermato.

**Flusso relatore (2 minuti):**
1. Riceve email con link o QR code
2. Apre link sullo smartphone o laptop
3. Vede: nome evento, sua sessione, sala, orario
4. Carica il file (drag & drop o selezione)
5. Barra progresso in tempo reale
6. Conferma: "Presentazione v2 caricata"

### Componente 3: Room Player PWA (route /sala/:token nella stessa web app)

Una Progressive Web App e una pagina web che si comporta come un programma installato. Il browser (Chrome o Edge) propone autonomamente "Installa come app" quando l'utente visita la pagina alcune volte. Da quel momento ha una icona sul desktop.

**Perche PWA e non Tauri per il Room Player:**
- Zero installazione su ogni PC sala
- Zero compilazione Rust
- Funziona su Windows, Mac, Linux, tablet, telefono
- L'URL contiene gia il nome sala: nessun discovery mDNS necessario
- Aggiornamenti automatici (il browser scarica la nuova versione in background)
- Il tecnico vede sempre: nome sala, versione corrente, stato sync (verde/giallo/rosso)

**Flusso sala (3 click):**
1. Admin crea sala nella dashboard → sistema genera URL univoco + QR code
2. Tecnico in sala apre l'URL sul PC (o scansiona il QR)
3. La PWA si carica e mostra il nome della sala
4. Se vuole l'icona sul desktop: clicca "Installa" nel banner del browser
5. Fatto — nessun software da scaricare, nessun IP da configurare

**Modalita di connessione PWA:**
- **Online (normale):** si connette direttamente a Supabase cloud
- **LAN con Agent attivo:** si connette all'Agent locale via HTTP per file piu veloci
- **Offline puro:** mostra ultima versione in cache, indicatore rosso

### Componente 4: Local Agent (apps/agent — Tauri v2, SOLO Fase 7+)

App desktop installata SOLO sul mini-PC di regia (uno per evento). Non e il Room Player. E il "server di backup locale" che:
- Scarica tutti i file dell'evento in cache locale
- Serve i file alle sale via rete LAN (HTTP)
- Funziona anche senza internet

**Quando serve:** solo negli eventi dove la connessione internet e inaffidabile o assente. Per eventi con buona rete: il Local Agent e opzionale (la PWA si connette direttamente al cloud).

**Quando costruirlo:** Fase 7, dopo che le Fasi 1-6 hanno validato il prodotto con clienti reali.

### Cosa NON esiste piu (semplificazione rispetto all'architettura precedente)

| Eliminato | Motivo |
|-----------|--------|
| `apps/player/` (Tauri Room Player) | Sostituito dalla PWA — zero installazione, stesso risultato |
| Account Cloudflare R2 | Supabase Storage copre tutto fino a scala |
| mDNS discovery dal Player | Non serve: la PWA conosce gia il suo URL |
| Compilazione Rust per Player | Non serve: la PWA e codice web |

---

## 4. Isolamento Multi-Tenant (invariante sacra)

**Non esiste compromesso su questo punto.** La separazione tra clienti e il requisito fondamentale del prodotto.

### Livello Database (Postgres)

Ogni tabella con dati business ha `tenant_id UUID NOT NULL REFERENCES tenants(id)`. Row-Level Security attiva su tutte le tabelle con policy `tenant_id = public.app_tenant_id()`. La funzione helper legge il `tenant_id` dal JWT firmato da Supabase Auth.

```sql
-- Funzione helper nel JWT (schema public)
CREATE OR REPLACE FUNCTION public.app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(trim(both '"' from (auth.jwt() -> 'app_metadata' ->> 'tenant_id')), '')::uuid,
    NULLIF(trim(both '"' from (auth.jwt() -> 'user_metadata' ->> 'tenant_id')), '')::uuid
  );
$$;

-- Pattern policy (identico per ogni tabella con tenant_id)
CREATE POLICY tenant_isolation ON events
  FOR ALL USING (tenant_id = public.app_tenant_id());
```

### Livello Storage

Struttura path obbligatoria: `tenants/{tenant_id}/events/{event_id}/presentations/{id}/v{n}/{file}`. L'Edge Function che genera URL firmati per upload/download verifica il `tenant_id` dal JWT prima di firmare. Anche se un cliente scoprisse l'ID di un file altrui, non potrebbe accedervi.

### Livello Auth

Trigger SQL all'atto del signup:
1. Crea record in `tenants`
2. Crea record `users` con `role='admin'`
3. Inserisce `tenant_id` nel JWT `app_metadata` (immutabile lato client)

### RBAC (ruoli utenti)

| Ruolo | Tipo | Accesso |
|-------|------|---------|
| `admin` | `user_role` enum | Tutto nel tenant: eventi, team, billing |
| `coordinator` | `user_role` enum | CRUD sessioni/speaker, vista regia |
| `tech` | `user_role` enum | Vista sala, download, stato sync |
| speaker | Record in tabella `speakers` (NO auth) | Upload via `upload_token` univoco |

**Nota:** `speaker` NON e un ruolo utente. E un record nella tabella `speakers` con campo `upload_token`. I relatori non si autenticano con email/password.

---

## 5. Schema Database (PostgreSQL via Supabase)

Schema completo gia nella migration: `supabase/migrations/20250411090000_init_slide_center.sql`

### Tabelle principali

| Tabella | FK principali | Scopo |
|---------|--------------|-------|
| `tenants` | — | Organizzazioni SaaS |
| `users` | `tenant_id`, `auth.users(id)` | Utenti con ruolo (admin/coordinator/tech) |
| `events` | `tenant_id` | Congressi, convegni, eventi |
| `rooms` | `event_id`, `tenant_id` | Sale fisiche dell'evento |
| `sessions` | `room_id`, `event_id`, `tenant_id` | Slot orari (un talk, un panel, ecc.) |
| `speakers` | `session_id`, `event_id`, `tenant_id` | Relatori con `upload_token` |
| `presentations` | `speaker_id`, `session_id`, `tenant_id` | Collegamento speaker-versione corrente |
| `presentation_versions` | `presentation_id`, `tenant_id` | **Append-only.** Ogni upload = nuova riga. Mai UPDATE. |
| `room_state` | `room_id`, `tenant_id` | Stato realtime sala (sessione corrente, sync status) |
| `local_agents` | `event_id`, `tenant_id` | Agent registrati con IP LAN + heartbeat |
| `activity_log` | `event_id`, `tenant_id` | Audit trail completo |

### Invarianti immutabili

- `presentation_versions` e **append-only**: mai UPDATE su una versione esistente
- `version_number` e monotonicamente crescente per presentazione (trigger SQL auto-increment)
- Il cloud e sempre la fonte di verita: conflict resolution = cloud vince
- Ogni file ha `file_hash_sha256` calcolato client-side (Web Crypto API) prima dell'upload

### Realtime (Supabase Realtime)

Attivare SOLO su: `room_state`, `presentation_versions`, `local_agents`.
**NON** su `activity_log` (polling ogni 10 secondi — efficiente, economico, sufficiente).

---

## 6. Flussi Sistema

### Flusso Upload Relatore

```
Relatore → Upload Portal (/u/{token}) → TUS su Supabase Storage
                                              |
                                        Edge Function:
                                        - Crea presentation_version
                                        - Verifica SHA-256
                                        - Aggiorna current_version_id
                                        - Emette Realtime event
                                        - Logga in activity_log
```

### Flusso Sync Cloud → PWA Sala (scenario normale con internet)

```
Supabase Realtime → subscription in PWA sala
                      |
                      → Nuova versione disponibile
                      → Scarica presigned URL da Edge Function
                      → Download file in cache (IndexedDB / cache API)
                      → Mostra overlay aggiornato (versione, stato: verde)
```

### Flusso Sync Cloud → Agent → PWA Sala (scenario evento con rete inaffidabile)

```
Supabase Realtime → Local Agent (Tauri v2)
                      |
                      → Download file in cache locale
                      → Verifica SHA-256
                      → Aggiorna SQLite locale
                      → Report sync_status al cloud

PWA Sala → HTTP polling su Agent LAN (GET /api/v1/rooms/{id}/manifest ogni 5s)
             → Download file da Agent se versione piu recente
             → Overlay aggiornato
```

### Scenari Offline

| Scenario | Comportamento | Indicatore sala |
|----------|---------------|-----------------|
| Cloud + LAN OK | Sync completo, versione piu recente | Verde: "v4 di 4 — Sync 14:32" |
| Cloud OK, Agent offline | PWA si connette direttamente al cloud | Verde: "CLOUD DIRECT — v4 di 4" |
| Cloud offline, Agent OK | Agent serve cache, PWA aggiornata via LAN | Giallo: "LAN ONLY — v3 di 3 locali" |
| Tutto offline | PWA mostra cache locale IndexedDB | Rosso: "OFFLINE — v3 in cache" |
| Agent torna online | Pull automatico versioni mancanti | Transizione giallo → verde |

---

## 7. Stack Tecnologico (completo)

### Web (apps/web — gia nel repo)

| Layer | Tecnologia | Versione |
|-------|-----------|---------|
| Framework UI | React | 19 |
| Build tool | Vite | 8 |
| Linguaggio | TypeScript | strict |
| Styling | Tailwind CSS | 4 |
| Componenti | shadcn/ui + Radix | latest |
| Routing | React Router | 7 |
| State | Zustand | latest |
| Tabelle | TanStack Table | latest |
| Form | Zod + React Hook Form | latest |
| i18n | i18next + react-i18next | latest |
| Upload | tus-js-client + use-tus | latest |
| PWA | vite-plugin-pwa (Workbox) | latest (da aggiungere Fase 5) |

### Backend / Infrastruttura

| Layer | Tecnologia | Note |
|-------|-----------|------|
| Database | Supabase PostgreSQL | RLS + trigger |
| Auth | Supabase Auth | JWT custom claims |
| Storage | Supabase Storage | TUS + S3 compatible, fino a 500GB/file |
| Realtime | Supabase Realtime | room_state, versions, agents |
| Edge Functions | Supabase + Deno | validate-token, process-upload |
| Deploy web | Vercel | Auto-deploy su push main |

### Desktop (solo Local Agent, Fase 7+)

| Layer | Tecnologia | Note |
|-------|-----------|------|
| Framework | Tauri v2 | Rust backend + webview |
| HTTP server LAN | Axum | Bind 0.0.0.0:8080 |
| Database locale | SQLite (rusqlite) | WAL mode |
| Service discovery | mDNS (mdns-sd) | Si annuncia come `_slidecenter._tcp.local` |
| Sync engine | reqwest + tokio | Pull realtime + heartbeat 30s |

### Storage (decisione MVP vs futuro)

| Scenario | Storage | Quando |
|----------|---------|--------|
| MVP e primi clienti | Supabase Storage TUS/S3 | Adesso — zero config aggiuntiva |
| Scala (10+ clienti, TB/mese) | Cloudflare R2 | Quando egress > $50/mese — stessa API S3 |
| Archivio cold storage | Backblaze B2 + Cloudflare CDN | Solo se serve archiviazione a lungo termine |

---

## 8. Modello Commerciale

### Piani SaaS

| Piano | €/mese | Target | Limiti |
|-------|--------|--------|--------|
| **Starter** | 149 | Piccole aziende AV | 3 eventi/mese, 5 sale/evento, 100GB storage, 1 Agent |
| **Pro** | 399 | Aziende AV medie, congressi | 15 eventi/mese, 20 sale/evento, 1TB storage, 3 Agent |
| **Enterprise** | da 990 | Grandi service, PCO, centri congressi | Illimitato, SLA, white-label |

### Infrastruttura costi (Aprile 2026)

| Servizio | Piano iniziale | Costo | Upgrade quando |
|---------|---------------|-------|----------------|
| Supabase | Free | 0€ | Arrivi a 500MB DB o file > 50MB → Pro $25/mese |
| Vercel | Hobby | 0€ | Primo cliente paying → Pro $20/mese |
| Dominio `liveslidecenter.com` | — | ~12€/anno | — |
| GitHub | Free | 0€ | — |
| Lemon Squeezy | 0% fino prima vendita | 0€ | Automatico |
| Sentry | Developer free | 0€ | Fase 15 |
| Cloudflare R2 | — | — | Solo a scala (10+ clienti) |

**Costo mensile iniziale: ~1€/mese.** Primo upgrade realistico con il primo cliente pagante (~45€/mese totali).

### Billing infrastruttura

- **Lemon Squeezy** via Live WORKS APP (Merchant of Record, IVA europea gestita)
- Webhook LS → aggiorna `tenants.plan` + limiti
- Trial 14 giorni completo

---

## 9. Design System

### Palette (dark mode only)

| Ruolo | Colore | Uso |
|-------|--------|-----|
| Background primario | `#0A0A0B` | Dark mode — ambiente regia |
| Background card | `#141416` | Pannelli, sidebar |
| Accent | `#0066FF` | CTA, link, selezione |
| Success | `#22C55E` | Synced, online, ready |
| Warning | `#F59E0B` | Syncing, LAN only |
| Danger | `#EF4444` | Offline, failed |
| Text primario | `#FAFAFA` | Titoli |
| Text secondario | `#A1A1AA` | Label, metadata |

### Principi UX

1. **Stato sempre visibile** — ogni entita mostra il suo stato con colore inequivocabile
2. **Zero ambiguita sulla versione** — numero versione + timestamp + hash troncato
3. **Feedback immediato** — ogni azione ha risposta visiva entro 200ms
4. **Dark mode only** — ambiente operativo e una regia buia
5. **Componenti shadcn/ui** — zero CSS inline custom
6. **Densita informativa alta** — target sono tecnici esperti, non consumer

---

## 10. Roadmap Esecutiva (Fasi)

### FASE 0 — Bootstrap Monorepo (COMPLETATA)

- [x] Monorepo Turborepo + pnpm workspace
- [x] TypeScript strict, ESLint 9, Prettier
- [x] Vite 8 + Tailwind CSS 4
- [x] `packages/shared`: types, enums, Zod validators, i18n IT/EN (~150 chiavi)
- [x] `packages/ui`: `cn()` utility
- [x] `apps/web`: React Router 7, layout dark-mode, Supabase client, i18n
- [x] Migration SQL completa: schema + RLS + Realtime + GRANT
- [x] Edge Functions: cors, auth, health
- [x] Git + GitHub `origin` live-software11
- [x] MCP Supabase configurato in Cursor

### FASE 1 — Auth Multi-Tenant

Obiettivo: signup che crea tenant + utente admin, login funzionante, dashboard vuota protetta.

- Supabase Auth (email + password)
- Trigger signup → crea tenant → JWT custom claim `tenant_id`
- UI login/signup/forgot con shadcn
- Route guard: se non autenticato → redirect `/login`
- Deploy funzionante su Vercel

**Definition of Done:** login end-to-end funzionante, `tenant_id` nel JWT, dashboard protetta, deploy Vercel OK.

### FASE 2 — CRUD Eventi

- CRUD eventi con status workflow (`draft` → `setup` → `active` → `closed`)
- CRUD sale per evento
- CRUD sessioni con timeline/calendario (drag & drop orari)
- CRUD speaker per sessione (nome, email, genera `upload_token`)
- Import programma da CSV
- Validazione Zod + React Hook Form
- i18n IT/EN

### FASE 3 — Speaker Upload Portal

- Pagina pubblica `/u/:token`
- Verifica token (Edge Function): valido, non scaduto, recupera sessione+speaker
- Upload TUS resumable con `tus-js-client + use-tus`
- SHA-256 client-side (Web Crypto API) prima dell'upload
- Barra progresso, pausa, riprendi, retry automatico
- Formati accettati: `.pptx`, `.ppt`, `.key`, `.pdf`, `.mp4`, `.mov`
- Storico versioni caricabili

**Limiti upload per piano:**
- Starter: warning oltre 500MB, blocco oltre 1GB
- Pro: blocco oltre 2GB (hard limit Supabase Storage 500GB/file)
- Enterprise: configurabile

### FASE 4 — Versioning System

- Ogni upload crea nuova `presentation_version` (append-only: mai UPDATE)
- Edge Function `process-upload`: verifica SHA-256, aggiorna `current_version_id`, emette Realtime
- UI storico versioni nella dashboard
- Rollback visivo a versione precedente (crea nuova versione con file vecchio)
- Status: uploading → processing → ready → superseded

### FASE 5 — Realtime Dashboard (Vista Regia)

- Supabase Realtime: subscribe a `room_state`, `presentation_versions`, `local_agents`
- Griglia sale con stato live (colori inequivocabili)
- Activity feed scrolling (polling ogni 10 secondi su `activity_log`)
- Filtri per sala, sessione, stato
- Indicatore "Agent non necessario" quando rete OK

### FASE 6 — Room Player PWA

- Route dedicata `/sala/:token` nella web app
- Configurazione PWA: `vite-plugin-pwa` (Workbox service worker)
- Manifest: nome sala, icona, colori dark, display standalone
- Connessione cloud diretta via Supabase Realtime
- Cache locale: file corrente in Cache API (service worker)
- Overlay informativo: sala, versione, stato (verde/giallo/rosso)
- Banner "Installa come app" (gestione `beforeinstallprompt`)
- Test su Chrome Windows, Edge, Safari iOS

**Risultato:** il tecnico apre un URL, clicca Installa, ha l'app. Zero installazione tradizionale.

### FASE 7 — Local Agent (Tauri v2)

Solo quando hai almeno 1 cliente che opera in luoghi con rete inaffidabile.

- Progetto Tauri v2 in `apps/agent/`
- Auth con JWT tenant, selezione evento attivo
- Sync engine: Supabase Realtime → download file → SQLite locale
- HTTP API LAN su Axum (0.0.0.0:8080):
  - `GET /api/v1/health`
  - `GET /api/v1/rooms/{id}/manifest`
  - `GET /api/v1/files/{version_id}/download`
  - `WS /api/v1/ws` (push updates)
- mDNS: si annuncia come `_slidecenter._tcp.local`
- Heartbeat ogni 30 secondi al cloud
- UI locale: stato sync, file cached, diagnostica

**Nota:** la PWA Room Player (Fase 6) si connette automaticamente all'Agent se disponibile sulla LAN, altrimenti cade in fallback cloud.

### FASE 8 — Offline Architecture Completa

- Agent: coda download con retry esponenziale, recovery dopo disconnessione
- PWA: fallback graceful (cache → LAN Agent → cloud → offline)
- Dashboard: indicatori stato Agent (online/offline/degraded)
- Test completi: disconnetti internet, disconnetti LAN, riconnetti
- Conflict resolution: cloud-wins sempre

### FASE 9 — Export Fine Evento

- Pulsante "Chiudi evento" → ZIP con tutti i file (ultima versione per sessione)
- CSV activity_log completo
- PDF report riassuntivo
- Link download per 30 giorni su Supabase Storage
- Auto-cleanup: Edge Function schedulata

### FASE 10 — Billing Lemon Squeezy

Solo quando hai il primo cliente potenzialmente pagante.

- Checkout per i 3 piani
- Webhook LS → `tenants.plan` + limiti
- Enforcement limiti (eventi/mese, storage, agent)
- Customer Portal
- Trial 14 giorni

### FASE 11 — Upload dalla Preview Room

- Agent accetta upload TUS locale (endpoint LAN)
- Upload da preview room → Agent → cloud
- Versioning identico al flusso web

### FASE 12 — i18n Completa

- `i18next` + `react-i18next` ovunque
- Agent: lingua selezionabile al primo avvio, salvata alla chiusura
- Installer in inglese (coerente con ecosistema)

### FASE 13 — Integrazioni Ecosistema

- Link con Live Speaker Timer (info sessione → countdown)
- API REST pubblica per integrazioni terze
- Webhook per notifiche esterne (email, Slack)

### FASE 14 — Hardening & QA

- Sentry error tracking
- Rate limiting Edge Functions
- Audit sicurezza RLS (test penetrazione multi-tenant)
- E2E test Playwright (upload, sync, offline)
- Performance: Lighthouse, bundle size, query optimization
- Documentazione utente finale

---

## 11. Struttura Monorepo (attuale)

```
Live SLIDE CENTER/
├── apps/
│   ├── web/                 # Dashboard + Upload Portal + Room Player PWA
│   └── agent/               # Local Agent (Tauri v2) — stub, sviluppo Fase 7
├── packages/
│   ├── shared/              # Types, Zod validators, constants, i18n
│   └── ui/                  # cn() utility, pronto per shadcn
├── supabase/
│   ├── migrations/          # Schema SQL completo con RLS
│   ├── functions/           # Edge Functions Deno
│   └── config.toml
├── scripts/
│   ├── Setup-Supabase-MCP.ps1
│   └── Verifica-Supabase-MCP.ps1
├── docs/
│   ├── GUIDA_DEFINITIVA_PROGETTO.md  ← questo file
│   ├── SlideHub_Live_CURSOR_BUILD.md
│   └── Setup_Strumenti_e_MCP.md
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

**Nota:** `apps/player/` (Room Player Tauri) NON esiste nel repo. Il Room Player e una route PWA di `apps/web/`. Non crearla come progetto Tauri separato.

---

## 12. Account e Infrastruttura

| Risorsa | Account | Note |
|---------|---------|------|
| GitHub repo | **live-software11** | `github.com/live-software11/live-slide-center` |
| Supabase project | **live.software11@gmail.com** | Project: `live-slide-center` — Reference ID: `cdjxxxkrhgdkcpkkozdl` |
| Vercel deploy | **live.software11@gmail.com** | Dominio: `app.liveslidecenter.com` |
| Lemon Squeezy | Via Live WORKS APP | Fase 10 |
| Sentry | **live.software11@gmail.com** | Fase 14 |
| Cloudflare R2 | — | Solo a scala — non configurare adesso |

---

## 13. Checklist Pre-Codice (aggiornata)

### Conti da creare subito

- [ ] Supabase: progetto `live-slide-center` su regione EU (Francoforte), piano Free. Copia `Project URL` e `anon key` in `.env.local`.
- [ ] Vercel: account collegato a `live-software11@gmail.com`, repo collegato per auto-deploy.
- [ ] Dominio `liveslidecenter.com` (12€/anno su qualsiasi registrar). Configura DNS su Vercel.

### Conti da NON aprire ancora

- Cloudflare R2 — non serve fino a scala
- Sentry — non serve fino a Fase 14
- Lemon Squeezy (verifica che account WORKS APP sia attivo) — non serve fino a Fase 10

### Ambiente locale

```powershell
node --version          # deve essere 22.x
pnpm --version          # deve essere 9.x
supabase --version      # CLI Supabase
gh auth status          # deve mostrare live-software11
docker --version        # Docker Desktop (per supabase start)
```

### MCP Cursor (tutti verdi in Impostazioni → Tools & MCP)

- [ ] `supabase-hosted` — PAT configurato, `pnpm run verify:supabase-mcp` non segnala problemi
- [ ] `context7` — documentazione aggiornata librerie
- [ ] `sequential-thinking` — ragionamento strutturato
- [ ] `GitHub` — operazioni repo

### Variabili ambiente (`apps/web/.env.local`, non versionato)

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_APP_NAME="Live SLIDE CENTER"
VITE_APP_VERSION=0.0.1
```

### Database locale

```bash
# Con Docker Desktop attivo
supabase start
supabase db reset     # applica migration da zero
# Verifica in http://localhost:54323 che le 11 tabelle esistano
supabase gen types typescript --local > packages/shared/src/types/database.ts
supabase link --project-ref cdjxxxkrhgdkcpkkozdl
supabase db push      # applica migration al progetto cloud
```

### Design (non saltare)

- [ ] Wireframe a carta dei 5 schermi chiave: Dashboard eventi, Vista Regia live, Upload Portal, Room Player PWA, Export fine evento
- [ ] Scegli 1 layout dashboard da `https://ui.shadcn.com/examples/dashboard` come riferimento visivo
- [ ] Valida Vista Regia con almeno 1 tecnico del settore: "cosa ti mancherebbe in questa schermata?"

### FASE_1_KICKOFF.md

Quando tutte le voci sopra sono spuntate, crea `docs/FASE_1_KICKOFF.md` con:
1. **Obiettivo in 1 frase:** signup che crea tenant + admin, login funzionante, dashboard vuota protetta
2. **Definition of Done:** typecheck/lint/build verdi, RLS testata, deploy Vercel funzionante con login end-to-end
3. **Timeboxing:** massimo 3 giorni di sessioni Cursor

---

## 14. Regole Non Negoziabili

1. **Mai dati senza tenant_id** — ogni riga DB, ogni file Storage, ogni request API deve essere isolata per tenant
2. **Mai scorciatoie su RLS** — se una query funziona solo bypassando RLS, e un bug, non una feature
3. **Mai logica di sicurezza solo nel client** — tutti i check di permesso avvengono in Edge Function o Postgres, mai solo in React
4. **Mai promettere offline senza Agent attivo** — indicare chiaramente nell'UI: "Modalita cloud diretta" vs "Modalita offline resiliente"
5. **Mai spendere su infrastruttura senza clienti che la giustificano** — restare su Free tier finche possibile
6. **Mai stringa UI senza coppia IT/EN** — zero eccezioni, stesso commit
7. **Mai UPDATE su `presentation_versions`** — e append-only; ogni modifica crea una nuova riga
8. **Mai `apps/player/` come progetto Tauri** — il Room Player e una PWA in `apps/web/`

---

## 15. Prompt di Avvio per Cursor

Quando la checklist del §13 e completata:

> "Leggi `docs/GUIDA_DEFINITIVA_PROGETTO.md`. E la fonte di verita master del progetto. Inizia generando un `PLAN.md` per la FASE 1 (Foundation Auth Multi-Tenant). Non scrivere codice finche non confermo il piano. Spiega tutto in italiano semplice — io non sono un programmatore. Chiedi conferma prima di ogni fase."

---

## 16. Relazioni nell'Ecosistema Live Software

```
Live SLIDE CENTER
  |
  +-- Licenze ──> Live WORKS APP (Lemon Squeezy, Fase 10)
  |
  +-- Timer ──> Live Speaker Timer (info sessione → countdown, Fase 13)
  |
  +-- Tecnici ──> Live CREW (assegnazione tecnici alle sale, futuro)
  |
  +-- Eventi ──> Live PLAN (pianificazione evento, futuro)
```

Le integrazioni con PLAN e CREW sono future. La priorita e un prodotto standalone funzionante e vendibile.

---

**Questo documento e la bussola.** Ogni decisione non coperta qui: aggiorna prima questo file, poi scrivi il codice. Cosi tra 6 mesi avrai un unico posto dove leggere "perche ho scelto X".

**EN:** This document is the single source of truth for Live SLIDE CENTER. All architectural decisions, storage choices, PWA vs Tauri rationale, roadmap phases, and onboarding checklists are documented here. In case of conflict with any other document, this file wins.
