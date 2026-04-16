# Live SLIDE CENTER — Istruzioni per AI Agent

> **Fonte di verita unica:** `docs/GUIDA_DEFINITIVA_PROGETTO.md` — leggere SEMPRE prima di modifiche strutturali.
> Se questo file e la guida divergono, **la guida vince**.

---

## Identita

**Prodotto:** SaaS multi-tenant per gestione presentazioni in eventi live, congressi e conferenze.
**Proprietario:** Andrea Rizzari (Live Software).
**Lingua comunicazione:** Italiano. Tono da CTO senior verso imprenditore.

---

## Stack Tecnologico

| Layer         | Tecnologia                                                                          |
| ------------- | ----------------------------------------------------------------------------------- |
| Framework UI  | React 19 + TypeScript strict (SPA, no SSR)                                          |
| Build         | Vite 8                                                                              |
| Styling       | Tailwind CSS 4 + shadcn/ui + Radix — **Dark mode only**                             |
| Routing       | React Router 7 (`createBrowserRouter`)                                              |
| State         | Zustand                                                                             |
| Tabelle       | TanStack Table                                                                      |
| Form          | Zod + React Hook Form                                                               |
| i18n          | i18next + react-i18next (IT + EN obbligatori)                                       |
| Upload        | tus-js-client + use-tus (resumable TUS)                                             |
| Backend/DB    | Supabase (PostgreSQL + Auth + Realtime + Edge Functions + Storage) — EU Francoforte |
| Deploy web    | Vercel (auto-deploy su push main)                                                   |
| Desktop Agent | Tauri v2 + Axum (Rust) + SQLite — `apps/agent/` — Fase 7                            |
| Room Agent    | Tauri v2 lite (Rust) + polling LAN — `apps/room-agent/` — Fase 7                    |
| Monorepo      | Turborepo + pnpm                                                                    |

---

## Struttura Monorepo

```
Live SLIDE CENTER/
├── apps/
│   ├── web/                 # Dashboard + Upload Portal + Room Player PWA (React 19)
│   │   ├── scripts/         # generate-brand-icons.mjs — Sharp: icons/ → public/ (prebuild/predev)
│   │   ├── public/          # favicon, apple-touch, PWA PNG, logo JPEG (generati dallo script)
│   │   └── src/features/    # auth, events, rooms, sessions, speakers, presentations,
│   │                        # upload-portal, devices (lib/fs-access.ts, hooks/useFileSync.ts),
│   │                        # live-view, admin, billing; src/components/AppBrandLogo.tsx (marchio)
│   ├── agent/               # Local Agent (Tauri v2) — Fase 7 — mini-PC regia
│   │   ├── src-tauri/       # Rust: Axum HTTP :8080, SQLite WAL, sync engine (streaming)
│   │   └── ui/              # HTML standalone dashboard
│   └── room-agent/          # Room Agent (Tauri v2 lite) — Fase 7 — ogni PC sala
│       ├── src-tauri/       # Rust: polling LAN, download, autostart HKCU, tray, CancellationToken
│       └── ui/              # HTML standalone pannello configurazione
├── packages/
│   ├── shared/              # Types (database.ts), Zod, constants, i18n locales IT/EN
│   └── ui/                  # cn() utility, componenti shadcn condivisi
├── supabase/
│   ├── migrations/          # Schema SQL + RLS (9 file; vedi elenco sotto)
│   ├── functions/           # Edge Functions Deno (health, pair-init/claim/poll, cleanup)
│   └── config.toml
├── icons/                   # Logo sorgente ufficiale: Logo Live Slide Center.jpg (input asset brand)
├── docs/
│   └── GUIDA_DEFINITIVA_PROGETTO.md  ← UNICA FONTE DI VERITA
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

### Pattern moduli (apps/web)

```
src/features/{nome}/
├── components/     # UI del modulo
├── hooks/          # useMyData.ts, useMyActions.ts
├── types.ts        # Tipi TypeScript del modulo
├── repository.ts   # CRUD Supabase (query, insert, update, delete)
├── service.ts      # Logica business
└── MyView.tsx      # Page-level view
```

---

## Brand, favicon e PWA (web)

- **Sorgente:** `icons/Logo Live Slide Center.jpg` (unico file master, in git).
- **Pipeline:** `apps/web/scripts/generate-brand-icons.mjs` + devDependency `sharp`; eseguito da **`prebuild`** e **`predev`** su `@slidecenter/web` prima di Vite.
- **Output:** `apps/web/public/` — `logo-live-slide-center.jpg` (UI), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `pwa-192x192.png`, `pwa-512x512.png`.
- **React:** usare solo `AppBrandLogo` da `src/components/AppBrandLogo.tsx` e `t('app.displayName')` per il wordmark; chiavi i18n in `packages/shared/src/i18n/locales/`.
- **Dettaglio:** `docs/GUIDA_DEFINITIVA_PROGETTO.md` §13 (sottosezione Logo prodotto, favicon e PWA).

---

## Vincoli Assoluti (non negoziabili)

1. **Tenant isolation:** ogni tabella con dati business ha `tenant_id` + RLS (`tenant_isolation` + `super_admin_all`). Violazione = bug critico.
2. **`apps/player/` NON deve esistere** — Room Player = route `/sala/:token` in `apps/web/` (PWA).
3. **`presentation_versions` e append-only** — mai UPDATE, ogni modifica = nuova riga.
4. **Dark mode only** — ambiente operativo regia.
5. **Zero stringhe UI hardcoded** — tutto via `t('chiave')` con coppia IT/EN nello stesso commit.
6. **Supabase Storage** per MVP — Cloudflare R2 solo quando egress > $50/mese.
7. **Mai mDNS da browser** — Agent registra IP al cloud, PWA lo interroga dal cloud.
8. **Mai contenuto file clienti visibile a super_admin** — solo metadati (GDPR).

---

## Database e RLS

### Helper functions (gia in DB)

```sql
public.app_tenant_id()   -- estrae tenant_id dal JWT (app_metadata / user_metadata)
public.is_super_admin()  -- true se role = 'super_admin' nel JWT
```

### Pattern RLS per ogni tabella

```sql
ALTER TABLE nome_tabella ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nome_tabella FOR ALL USING (tenant_id = public.app_tenant_id());
CREATE POLICY super_admin_all ON nome_tabella FOR ALL USING (public.is_super_admin());
```

### Enforcement DB (trigger)

- `check_storage_quota()` — blocca INSERT su `presentation_versions` se quota storage superata
- `update_storage_used()` — aggiorna `tenants.storage_used_bytes` automaticamente
- `check_events_quota()` — blocca INSERT su `events` se max eventi/mese superato
- `check_rooms_quota()` — blocca INSERT su `rooms` se max sale/evento superato

### Query client

- RLS filtra automaticamente per tenant — **NON aggiungere `.eq('tenant_id', ...)` nel client**
- Sempre `limit()` sulle liste
- Join con sintassi embedded: `select('*, rooms(*)')`
- Delete con conferma UI a due passaggi e hint CASCADE (sala → sessioni+relatori)

---

## Ruoli RBAC

| Ruolo           | Accesso                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| `super_admin`   | Cross-tenant: vede tutti i tenant, quote, log audit. NON vede contenuto file (GDPR) |
| `admin`         | Tutto nel proprio tenant: CRUD eventi/sale/sessioni, team, billing                  |
| `coordinator`   | CRUD sessioni/speaker, vista regia, gestione upload                                 |
| `tech`          | Vista sala assegnata, download file, stato sync                                     |
| speaker (guest) | Solo upload via `upload_token` univoco — nessun account Supabase                    |

**Team invites:** schema previsto ma NON ancora implementato (rimandato a pre-vendita).

---

## i18n — Regole

- Libreria: `i18next` + `react-i18next`
- File traduzioni: `packages/shared/src/i18n/locales/it.json` + `en.json`
- Ogni nuova stringa UI in italiano DEVE avere traduzione EN professionale (terminologia eventi live/AV/congressi) nello STESSO commit
- Nessuna stringa hardcoded — ZERO eccezioni (include `aria-label`, tooltip, placeholder, messaggi errore)
- Validazione Zod: schema factory con `t: TFunction` per messaggi i18n

---

## Stato Progetto (Aprile 2026)

| Fase | Stato          | Contenuto                                                                                                                                                   |
| ---- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | **Completata** | Bootstrap monorepo                                                                                                                                          |
| 1    | **Completata** | Auth multi-tenant, signup, super_admin, RequireAuth, super_admin_all RLS su tutte le tabelle                                                                |
| 2    | **Completata** | CRUD completo eventi/sale/sessioni/speaker, DnD reorder, quota enforcement DB, Zod i18n, CSV import relatori                                                |
| 3    | **Completata** | Upload Portal TUS (`/u/:token`: TUS resumable, SHA-256 streaming, RPC init/finalize/abort, bucket privato)                                                  |
| 4    | **Completata** | Versioning + storico (pannello versioni per speaker, download firmato, rollback, workflow review, Realtime)                                                 |
| 5    | **Completata** | Vista Regia realtime (`/events/:eventId/live`: LiveRegiaView, RoomGrid, ActivityFeed, Realtime 5 tabelle)                                                   |
| 6    | **Completata** | Pairing Device + Room Player PWA ATTIVO (4 Edge Fn, modulo devices, `/pair` keypad, `/sala/:token` File System Access API download locale, vite-plugin-pwa) |
| 7    | **Completata** | Dual-Mode File Sync: Local Agent Tauri v2 (Axum+SQLite), Room Agent (polling+autostart+tray), `network_mode ENUM`, i18n IT/EN, ADR-007                      |
| 8    | **Completata** | Super-Admin: `/admin` stats, `/admin/tenants`, `/admin/tenants/:id` (quote + `suspended` + team + log), `/admin/audit`; guard login/`RequireAuth`; migration `20250416120100_tenant_suspended.sql` |
| 9    | Da fare        | Offline architecture + routing runtime (`network_mode` letto dal Room Player per scelta percorso cloud/LAN/hybrid)                                          |
| 10   | Da fare        | Export fine evento (ZIP + CSV + PDF)                                                                                                                        |
| 11   | Da fare        | Billing Lemon Squeezy                                                                                                                                       |
| 12   | In corso       | i18n completamento (~200 chiavi)                                                                                                                            |
| 13   | Futuro         | Integrazioni ecosistema (Timer, CREW, API pubblica)                                                                                                         |
| 14   | Pre-vendita    | Hardening + Sentry + E2E (rate limiting, audit RLS, Playwright)                                                                                             |

**MVP cloud = Fasi 0-6 (100%).** Con Fasi **7** e **8** completate, stima totale visione prodotto (roadmap 0-14): **circa 53-60%** (9/15 fasi). Dettaglio in `docs/GUIDA_DEFINITIVA_PROGETTO.md` §15.

### Gap dichiarati (rimandati)

- Inviti team (schema+UI) — pre-vendita
- Password reset UI — pre-vendita
- Timeline/calendario interattivo — nice-to-have
- Import CSV sale/sessioni — non richiesto MVP
- Routing runtime `network_mode` (Room Player sceglie automaticamente cloud vs LAN) — Fase 9

---

## Git e Deploy

### Account

| Servizio | Account                   | Verifica         |
| -------- | ------------------------- | ---------------- |
| GitHub   | **live-software11**       | `gh auth status` |
| Supabase | live.software11@gmail.com | Dashboard        |
| Vercel   | live.software11@gmail.com | Dashboard        |

**Prima di OGNI push:** `gh auth status` → deve essere **live-software11**. Mai push con account Andraven11 su questo repo.

### Commit format

```
feat: nuova funzionalita
fix: correzione bug
refactor: refactoring
chore: build/config/docs
db: migration SQL / schema
```

### Deploy

- **Web:** Vercel auto-deploy su push a main
- **Supabase:** `supabase db push` (migration) + `supabase functions deploy` (Edge Functions)
- **Local Agent:** `cd apps/agent/src-tauri && cargo tauri build` (NSIS installer Windows)
- **Room Agent:** `cd apps/room-agent/src-tauri && cargo tauri build` (NSIS installer Windows, autostart HKCU)

---

## Qualita Codice — Checklist Obbligatoria

Dopo OGNI modifica eseguire dalla root:

```bash
pnpm run typecheck    # TypeScript strict — zero errori
pnpm run lint         # ESLint — zero errori, zero warning
pnpm run build        # Build produzione — deve passare
```

### Standard

- View page-level: `*View.tsx`
- Hook dati: `use*.ts`
- Repository: `repository.ts` per ogni feature
- NO commenti che descrivono il codice — SI commenti sul PERCHE
- Ogni operazione Supabase in try/catch con log strutturato
- Error boundaries per ogni modulo

### Priorita

1. **Correttezza** — il codice fa quello che deve fare
2. **Stabilita** — non crasha in produzione per eventi live
3. **Tenant isolation** — nessun dato cross-tenant
4. **Performance** — query ottimizzate, bundle piccolo
5. **Manutenibilita** — leggibile, documentato

---

## Documentazione

Dopo modifiche strutturali (schema, RLS, Edge Functions, architettura, roadmap, ruoli, piani):
aggiornare `docs/GUIDA_DEFINITIVA_PROGETTO.md` **nello stesso intervento**.

---

## Migrations SQL (in ordine)

1. `20250411090000_init_slide_center.sql` — schema core, RLS base, tabelle principali
2. `20250415120000_pairing_super_admin.sql` — enum super_admin, pairing, super_admin_all (subset tabelle)
3. `20250415120100_quotas_enforcement.sql` — trigger quota storage
4. `20250415130000_handle_new_user_tenant.sql` — trigger auto-provisioning tenant su signup
5. `20250415140000_phase1_2_hardening.sql` — super_admin_all su tutte le tabelle, quota enforcement eventi/sale, RPC reorder sessioni
6. `20250416090000_phase3_upload_portal.sql` — bucket `presentations` privato, Storage RLS anon-insert su version `uploading`, RPC validate/init/finalize/abort, rework `update_storage_used` su `ready`, Realtime `presentations`
7. `20250417090000_phase4_versioning.sql` — review workflow, RPC `rpc_set_current_version`/`rpc_update_presentation_status`, guard append-only, indice storico
8. `20250416120000_network_mode.sql` — ENUM `network_mode(cloud|intranet|hybrid)` + colonna `events.network_mode NOT NULL DEFAULT 'cloud'`
9. `20250416120100_tenant_suspended.sql` — colonna `tenants.suspended` (blocco accesso tenant lato app; super_admin escluso)

### Edge Functions Supabase (supabase/functions/)

| Funzione                | Auth              | Descrizione                                                              |
| ----------------------- | ----------------- | ------------------------------------------------------------------------ |
| `health`                | nessuna           | Healthcheck ambiente                                                     |
| `pair-init`             | JWT tenant        | Genera codice 6 cifre + scadenza 10 min, INSERT `pairing_codes`          |
| `pair-claim`            | nessuna (tecnico) | Valida codice → INSERT `paired_devices` + token SHA-256 → marca consumed |
| `pair-poll`             | JWT tenant        | Polling stato pairing: pending / consumed / expired                      |
| `cleanup-expired-codes` | nessuna (cron)    | DELETE `pairing_codes` scaduti non consumed (>24h)                       |

---

## Ecosistema Live Software

```
Live SLIDE CENTER
  ├── Licenze ──> Live WORKS APP (Lemon Squeezy, Fase 11)
  ├── Timer ──> Live Speaker Timer (info sessione → countdown, Fase 13)
  ├── Tecnici ──> Live CREW (futuro)
  └── Eventi ──> Live PLAN (futuro)
```
