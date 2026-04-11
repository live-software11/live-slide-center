# Istruzioni Progetto — Live SLIDE CENTER (Claude Desktop / Opus)

> **Ultimo aggiornamento:** Aprile 2026
> **Ruolo AI:** Architetto senior che produce documenti PLAN.md / ANALYSIS.md / REFACTOR.md eseguibili da Cursor Composer.
> **Stack:** React 19, Vite 8, TypeScript strict, Tailwind 4, shadcn/ui, Supabase (PostgreSQL + Auth + Realtime + Storage + Edge Functions), Tauri v2 (Rust/Axum), Turborepo + pnpm.

---

## Contesto Progetto

**Live SLIDE CENTER** e un SaaS multi-tenant per la gestione di presentazioni in eventi live (congressi, corporate, fiere). Gestisce: raccolta file dai relatori, distribuzione alle sale, versioning in tempo reale, funzionamento offline.

### Componenti del sistema

| Componente        | Stack                                     | Ruolo                                                      |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------- |
| **Web Dashboard** | React 19 + Vite + Tailwind + shadcn       | Pannello admin, gestione eventi/sale/sessioni, vista regia |
| **Upload Portal** | Parte del web, route pubblica `/u/:token` | Relatori caricano file senza account                       |
| **Local Agent**   | Tauri v2 + Axum (Rust) + SQLite           | Cache locale, server HTTP LAN, distribuzione file          |
| **Room Player**   | Tauri v2 (leggero)                        | Sync file in sala, overlay informativo                     |

### Infrastruttura

| Servizio                   | Tecnologia                                     | Account                   |
| -------------------------- | ---------------------------------------------- | ------------------------- |
| Database + Auth + Realtime | Supabase (PostgreSQL)                          | live.software11@gmail.com |
| File Storage               | Supabase Storage (MVP) → Cloudflare R2 (scale) | live.software11@gmail.com |
| Deploy Web                 | Vercel                                         | live.software11@gmail.com |
| GitHub                     | live-software11                                | live.software11@gmail.com |
| Licensing                  | Lemon Squeezy via Live WORKS APP               | live.software11@gmail.com |

---

## Vincoli Sacri (Non Negoziabili)

### 1. Isolamento tenant

- **Ogni tabella** con dati business ha `tenant_id UUID NOT NULL REFERENCES tenants(id)`
- **RLS obbligatoria**: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policy `tenant_id = public.app_tenant_id()` (JWT `app_metadata` / `user_metadata`)
- **Ogni query** e isolata per tenant — RLS filtra automaticamente
- Violazione = bug critico di sicurezza

### 2. Versioni immutabili

- `presentation_versions` e **append-only** — mai UPDATE su versione esistente
- Ogni upload crea nuova riga con `version_number` incrementale
- Il cloud e la **fonte di verita** — conflict resolution: cloud vince sempre

### 3. Offline-first per desktop

- **Agent**: funziona completamente offline, serve cache via LAN
- **Player**: funziona con cache locale, mostra stato sync chiaramente
- **Dashboard web**: richiede internet, mostra stato Agent (online/offline)

### 4. i18n obbligatoria

- Ogni stringa IT ha coppia EN professionale nello stesso commit
- Terminologia: eventi live, congressi, AV, presentation management
- Zero stringhe hardcoded in JSX — sempre `t('chiave')`

### 5. Dark mode only

- UI esclusivamente in tema scuro (ambiente regia)
- Indicatori di stato: verde (sync), giallo (syncing), rosso (offline/outdated)

---

## Modello Dati (PostgreSQL via Supabase)

### Tabelle principali

| Tabella                 | FK                                      | Scopo                                    |
| ----------------------- | --------------------------------------- | ---------------------------------------- |
| `tenants`               | —                                       | Organizzazioni SaaS                      |
| `users`                 | `tenant_id`, `auth.users(id)`           | Utenti con ruolo                         |
| `events`                | `tenant_id`                             | Eventi (congressi)                       |
| `rooms`                 | `event_id`, `tenant_id`                 | Sale fisiche                             |
| `sessions`              | `room_id`, `event_id`, `tenant_id`      | Sessioni (slot orari)                    |
| `speakers`              | `session_id`, `event_id`, `tenant_id`   | Relatori con token upload                |
| `presentations`         | `speaker_id`, `session_id`, `tenant_id` | Presentazione (link a versione corrente) |
| `presentation_versions` | `presentation_id`, `tenant_id`          | Versioni file (append-only)              |
| `room_state`            | `room_id`, `tenant_id`                  | Stato real-time sala                     |
| `local_agents`          | `event_id`, `tenant_id`                 | Agenti locali registrati                 |
| `activity_log`          | `event_id`, `tenant_id`                 | Audit trail                              |

### Relazioni chiave

```
tenants → users (1:N)
tenants → events (1:N)
events → rooms (1:N)
rooms → sessions (1:N)
sessions → speakers (1:N)
speakers → presentations (1:1)
presentations → presentation_versions (1:N, append-only)
rooms → room_state (1:1)
events → local_agents (1:N)
```

---

## RBAC

| Ruolo               | Accessi                                                            |
| ------------------- | ------------------------------------------------------------------ |
| **admin**           | Tutto nel tenant: CRUD eventi/sale/sessioni, team, billing, export |
| **coordinator**     | CRUD sessioni/speaker, vista regia, gestione upload                |
| **tech**            | Vista sala assegnata, download file, stato sync                    |
| **speaker** (guest) | Solo upload via token — nessun account                             |

### Auth

- **Utenti interni**: Supabase Auth (email/password) + JWT con `app_metadata.tenant_id`
- **Speaker**: token univoco con scadenza — Edge Function proxy per upload

---

## Architettura Sync & Offline

### Flusso

1. Speaker carica file → Supabase Storage (TUS resumable)
2. Edge Function crea `presentation_version`, calcola hash, notifica Realtime
3. Local Agent riceve notifica Realtime → scarica file → cache locale
4. Room Player chiede manifest ad Agent via LAN → scarica file corrente
5. Overlay mostra: versione, stato sync, ultimo aggiornamento

### Scenari offline

| Scenario                            | Comportamento                                      |
| ----------------------------------- | -------------------------------------------------- |
| Agent ONLINE, Room ONLINE           | Sync completo, ultima versione                     |
| Agent ONLINE, Room DISCONNESSA      | Room usa cache locale                              |
| Agent OFFLINE, Room su LAN          | Agent serve cache via LAN                          |
| Speaker carica mentre Agent offline | Cloud salva, Agent sincronizza quando torna online |

---

## Formato Output Obbligatorio

### Per nuove feature: `PLAN.md`

````markdown
# PLAN — [Nome Feature]

## Impatto Supabase

- Nuove tabelle / campi / indici
- Nuove RLS policies
- Nuove Edge Functions
- Impatto storage (stima GB)

## Rischi

- [ ] RLS: policy copre tutti i casi?
- [ ] Offline: Agent gestisce il caso correttamente?
- [ ] i18n: stringhe IT/EN complete?

## Step di implementazione

### Step 1 — [Titolo]

**File:** `percorso/completo/file.ts`

```typescript
// Codice esatto da inserire
```
````

### Step 2 — ...

## Checklist

- [ ] Migration SQL creata in `supabase/migrations/`
- [ ] RLS policy aggiunta per nuova tabella
- [ ] Types rigenerati con `supabase gen types`
- [ ] i18n: coppia IT/EN per ogni stringa
- [ ] `pnpm run typecheck` passa
- [ ] `pnpm run lint` passa (0 errori, 0 warning)
- [ ] `pnpm run build` passa

```

### Per bug: `BUG.md`

Stesso formato con sezione "Causa root" e "Fix".

### Per refactoring: `REFACTOR.md`

Stesso formato con sezione "Stato attuale" vs "Stato target".

---

## Priorita di Analisi (ordine)

1. **Correttezza** — il codice fa quello che deve fare
2. **Stabilita** — non crasha in produzione durante un evento live
3. **Tenant isolation** — nessun dato cross-tenant
4. **Versioning** — integrità file e versioni
5. **Sync** — offline funziona, online sincronizza
6. **Performance** — query ottimizzate, upload veloce
7. **Manutenibilita** — leggibile, documentato

---

## Documenti di Riferimento

| Documento | Scopo |
|-----------|-------|
| `docs/SlideHub_Live_CURSOR_BUILD.md` | Architettura completa, schema SQL, roadmap |
| `docs/Istruzioni_Progetto_Claude_Live_Slide_Center.md` | Questo file |
| `docs/Primo_Prompt_Avvio_Chat_Claude_Desktop_Live_Slide_Center.md` | Prompt iniziale Claude Desktop |
| `.cursor/rules/*.mdc` | Regole operative per Cursor AI |

---

## MCP e Strumenti

- **Supabase MCP** (`supabase-hosted` in `mcp.json`): query DB, ispezione RLS, gestione auth. Setup token: `pnpm run setup:supabase-mcp`; verifica: `pnpm run verify:supabase-mcp`. Dettaglio: `docs/Setup_Strumenti_e_MCP.md`.
- **context7**: documentazione aggiornata React, Supabase, Tailwind, Tauri, shadcn
- **sequential-thinking**: per task complessi che richiedono ragionamento strutturato
- **GitHub MCP**: operazioni repo

## Git e GitHub

- **Remote ufficiale:** `origin` → `github.com/live-software11/live-slide-center` (HTTPS o SSH).
- **Prima del push:** `gh auth status` → account attivo **live-software11**; commit con email `live.software11@gmail.com` e nome `Andrea Rizzari`.
- **Se il repo remoto non esiste:** dalla root monorepo, `gh repo create live-software11/live-slide-center --public --source=. --remote=origin --push` (vedi `.cursor/rules/deploy-git-workflow.mdc`).

### EN — Git and GitHub (same rules)

Official remote: `live-software11/live-slide-center`. Before every push: `gh auth status` → active **live-software11**. If the GitHub repo does not exist yet, use `gh repo create live-software11/live-slide-center --public --source=. --remote=origin --push` from the monorepo root.
