# Live SLIDE CENTER — Sintesi viva (CLAUDE.md)

> Mappa rapida del progetto per AI assistenti / nuovi developer.
>
> **Architettura completa:** `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` (UNICA fonte di verita).
> **Indice docs canonico:** `docs/README.md`.
> **Cose da fare:** `docs/STATO_E_TODO.md`.
> **Setup ambiente:** `docs/Setup_Strumenti_e_MCP.md`.
> **Disaster recovery + Sentry + warm-keep + workspace cleanup:** `docs/DISASTER_RECOVERY.md`.
> **Regole AI:** `.cursor/rules/*.mdc`.
>
> **Versione CLAUDE.md:** 3.1 — 19 aprile 2026 (post Sprint X-1 upload hardening: desktop simple-upload + cloud TUS race-cancel fix + smoke test secrets via env).

## Cos'e'

SaaS multi-tenant per **gestione presentazioni in eventi live**. Nome commerciale: **Slide Center**.

- **Cloud:** dashboard React (`apps/web`) + Supabase (PostgreSQL + Auth + Storage + Realtime + 26 Edge Functions).
- **Desktop offline:** singolo binario Tauri 2 (`apps/desktop`) con server Rust Axum embedded — **stessa SPA** del cloud, backend locale + LAN + mDNS.
- **Owner:** Andrea Rizzari (CTO/imprenditore).

## Account (REGOLA SACRA — verificare PRIMA di ogni operazione remota)

| Servizio | Account                                                                                       | Verifica         |
| -------- | --------------------------------------------------------------------------------------------- | ---------------- |
| GitHub   | **live-software11**                                                                           | `gh auth status` |
| Supabase | live.software11@gmail.com (project `cdjxxxkrhgdkcpkkozdl`)                                    | Dashboard        |
| Vercel   | live.software11@gmail.com (scope `livesoftware11-3449s-projects`, project `live-slide-center`) | `vercel whoami`  |
| Sentry   | live.software11@gmail.com (org `live-work-app`, project `live-slide-center-web`, region EU)   | Dashboard        |
| Repo     | `github.com/live-software11/live-slide-center`                                                 | `git remote -v`  |

Mai operare con account `Andraven11` (e' per Preventivi DHS / Gestionale FREELANCE).

## Stack in una riga

React 19 + TS strict + Vite 8 + Tailwind 4 + Tauri 2 + Rust Axum + Supabase (Postgres 17, project `cdjxxxkrhgdkcpkkozdl`) + Sentry + pnpm + Turborepo.

## Struttura monorepo (alto livello)

```
live-slide-center/
├── apps/
│   ├── web/              # React 19 SPA (cloud + desktop) — feature folders
│   ├── desktop/          # Tauri 2 unico (Sprint J-W): wrapper + server Rust Axum
│   ├── agent/            # Local Agent legacy Tauri 1 (admin LAN)
│   └── room-agent/       # Room Agent legacy Tauri 1 (PC sala daemon)
├── packages/
│   └── shared/           # @slidecenter/shared — types DB + i18n + utility cross-app
├── supabase/
│   ├── migrations/       # 30+ SQL migration (Fasi 0-15 + AU-01..09 + Sprint W)
│   ├── functions/        # 26 Edge Functions Deno
│   ├── tests/            # rls_audit.sql + pgTAP
│   └── config.toml
├── docs/                 # 14 doc canonici + _archive/ (vedere docs/README.md)
├── icons/                # Sorgente brand (Logo Live Slide Center.jpg)
├── package.json          # workspace pnpm + script Turbo
├── turbo.json
├── pnpm-workspace.yaml
├── .vercelignore         # esclude apps/desktop, apps/agent, apps/room-agent
├── .cursorindexingignore # esclude target/, dist/, node_modules/ dall'indexing semantico
└── .cursor/rules/        # 15 file rules AI (suite a 3 livelli)
```

## Comandi quotidiani

```powershell
# Dev (PowerShell — usare ; non &&)
pnpm install
pnpm dev                                       # tutti gli apps in parallelo (Turbo)
pnpm --filter @slidecenter/web dev             # solo cloud SPA (porta 5173)
pnpm dev:desktop                               # Tauri 2 desktop (Vite + webview)

# Quality gate (PRIMA di chiudere ogni task — vedi 02-quality-gate.mdc)
pnpm typecheck
pnpm lint
pnpm build
pnpm test                                      # se hai toccato logica business
pnpm smoke:cloud                               # smoke test E2E produzione (DSN Sentry, Edge Fn, Vercel)

# Per modifiche apps/desktop/src-tauri:
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --all-targets -- -D warnings

# Build desktop NSIS
pnpm --filter @slidecenter/desktop release:nsis
# oppure wrapper PowerShell user-friendly:
apps/desktop/scripts/release.ps1 -Signed

# Supabase
supabase db push                               # applica migration pendenti
supabase functions deploy <nome>               # deploy singola Edge Function
supabase gen types typescript --project-id cdjxxxkrhgdkcpkkozdl > packages/shared/src/types/database.ts

# Git (account live-software11)
gh auth status                                 # verifica account
git status; git add <file>; git commit -m "feat: msg"; git push

# Vercel (account livesoftware11-3449, project live-slide-center)
vercel whoami                                  # verifica account
vercel --prod --yes --archive=tgz              # SBLOCCO MANUALE: deploy production
                                               # --archive=tgz OBBLIGATORIO (monorepo > 15k file)
```

Per messaggi commit multilinea (PowerShell NON supporta heredoc bash): scrivere il messaggio con `Write` tool in `.commit-msg-tmp.txt`, poi `git commit -F .commit-msg-tmp.txt` + delete file.

## Suite Cursor rules (`.cursor/rules/`)

**3 livelli per minimizzare context overload:**

### alwaysApply (sempre attive)

| File                      | Cosa garantisce                                                              |
| ------------------------- | ---------------------------------------------------------------------------- |
| `00-project-identity.mdc` | Identita progetto, fonti di verita, account, vincoli sovrani                 |
| `01-data-isolation.mdc`   | Tenant isolation + RLS pattern obbligatori + RBAC + Storage path             |
| `02-quality-gate.mdc`     | Workflow chiusura task: typecheck/lint/build + standard senior + Sentry      |
| `03-i18n.mdc`             | i18n IT/EN obbligatorio + terminologia dominio eventi live                   |
| `04-git-workflow.mdc`     | Account live-software11, commit format, deploy Vercel/Supabase/Tauri/smoke   |
| `mcp-supabase.mdc`        | Uso server MCP Supabase (project_id, capabilities)                           |
| `mcp-vercel.mdc`          | Uso server MCP Vercel (deploy + build/runtime logs + workflow CLI fallback)  |

### Globs mirati (caricati solo quando matchi i file)

| File                      | Globs                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `web-react.mdc`           | `apps/web/src/**/*.{ts,tsx}` — pattern React 19, design system, perf   |
| `web-supabase-client.mdc` | `apps/web/src/lib/supabase.ts`, `repository.ts`, hooks `use*.ts`       |
| `supabase-db.mdc`         | `supabase/migrations/**`, `supabase/functions/**`, `supabase/tests/**` |
| `desktop-tauri.mdc`       | `apps/desktop/**`, `apps/web/src/lib/desktop-bridge.ts`                |
| `legacy-agents.mdc`       | `apps/agent/**`, `apps/room-agent/**` (Tauri 1 legacy)                 |

### Agent-requestable (caricabili on-demand)

| File                    | Quando leggerla                                                         |
| ----------------------- | ----------------------------------------------------------------------- |
| `architecture-deep.mdc` | Feature cross-cloud-desktop-LAN o refactoring grande di un sottosistema |
| `field-test-fase15.mdc` | Pianificare/chiudere uno sprint A-W o capire cosa fa quale sprint       |
| `docs-roadmap.mdc`      | Aggiornare docs o cercare quale guida usare                             |

## Stato progetto (aprile 2026 — post Sprint W)

**SEMAFORO VERDE per primo evento live in produzione.** Cloud Vercel READY su `https://live-slide-center.vercel.app`. Desktop NSIS firmato Tauri 2 distribuibile. Sentry attivo. Smoke `pnpm smoke:cloud` 6 OK + 1 skip + 1 warn.

| Area              | Stato     | Note                                                                                                |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------- |
| Cloud (Fasi 0-14) | DONE 100% | Schema RLS + 26 EF + pairing + Storage TUS + Realtime + GDPR + super_admin                          |
| Field test (A-I)  | DONE 100% | 9 sprint chiusi (playback_mode, broadcast, range/SHA, bootstrap, retry, bulk, drag, preview, in onda) |
| Desktop Tauri 2 (J-P+FT) | DONE 100% | Single binary + Axum + SQLite + mDNS + LAN push + updater Ed25519                            |
| Audit chirurgico (R-1..S-4 + T-1..T-3) | DONE 100% | 10/10 GAP risolti, parity feature competitor (PreSeria/Slidecrew/SLIDEbit) |
| Backlog medium (AU-01..09) | DONE 100% | Retention pg_cron + search_path hardening + idempotency + TOCTOU fix + rate-limit EF + CORS hardening + perf FE + outbox offline + E2E Playwright |
| UX Redesign V2.0 (U-1..U-7) | DONE 100% | shadcn AppShell + Command Palette + ProductionView + OnAirView + provisioning QR + fix deploy Vercel + 404 SPA |
| Parity cloud/desktop (D1..D8) | DONE 100% | Licensing unificato + NSIS vendor + Tauri updater + ruolo control_center desktop + heartbeat |
| Sprint W (cloud finale + desktop allineato) | DONE 100% | 7 migration SQLite mirror + folder_routes + UI cloud-only conditional + deploy verde |
| Sentry runtime monitoring | DONE     | Org `live-work-app`, region EU, init lazy `apps/web/src/lib/init-sentry.ts`                          |
| Workspace cleanup | DONE      | -11.83 GB (96% reduction) + ignore files harden                                                     |
| Docs overhaul     | DONE      | 29 doc → 14 canonici + `_archive/`, indice `docs/README.md`                                         |
| Sprint X-1 (upload hardening) | DONE 100% | (a) desktop usava TUS contro server Rust che non lo implementa → nuovo `simple-upload.ts` POST diretto; (b) cloud TUS partiva comunque dopo cancel utente durante `getSession()` → fix race con `uploadCancelledRef` / `job.cancelled` check; (c) smoke test cloud aveva email/password/anon-key hardcoded → ora obbligatori via env vars `VITE_SUPABASE_*` + `SC_SMOKE_*`. Migration `20260419093026_sprint_x1_fix_admin_upload_storage_rls` (SECURITY DEFINER `storage_can_upload_object_anon`/`_tenant`) GIA' applicata in cloud |

**Dettagli storici:** `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22 (sprint history sintetica).
**Dettagli storici estesi (sprint 0.1→0.29):** `docs/_archive/STATO_E_TODO_storia_sprint_0.1-0.29.md` (read-only).
**Cose da fare ora:** `docs/STATO_E_TODO.md`.

### Sprint Q (OPZIONALE): Sync hybrid cloud<->offline

**Stato:** **NON in progress.** Decisione GO/NO-GO vincolata al framework in `docs/STATO_E_TODO.md` § 4.2 (post-field-test desktop reale).

**Goal (se GO):** quando il desktop torna online, sync con cloud Supabase per backup + condivisione cross-sede. Push-only (desktop master, cloud backup). Worker 60s, `synced_at` su SQLite, TUS upload bucket. **Piano operativo READY-TO-CODE** in `docs/STATO_E_TODO.md` § 4.3 (file da creare, RPC, schema migration, UI, costi stimati ~5€/mese-evento).

**Quando NON serve:** uso interno single-site senza necessita di backup cloud o condivisione fra sedi.

**Hardening, code-signing, multi-OS:** **NON sono Sprint Q.** Code-signing OV Sectigo e' un'attivita esterna pianificabile (vedi `docs/STATO_E_TODO.md` § 2.2 + `docs/Manuali/Manuale_Code_Signing.md`).

## Tre modalita di esecuzione del prodotto (vedi ARCHITETTURA § 3)

Ogni feature deve funzionare in tutte e tre le modalita o dichiarare esplicitamente la sua compatibilita:

| Modalita         | Backend                                    | Sync sala       | Quando si vende                                            |
| ---------------- | ------------------------------------------ | --------------- | ---------------------------------------------------------- |
| Cloud SaaS       | Supabase (PG + Auth + Storage + Realtime)  | Realtime PG     | Eventi multi-sede, accesso da remoto, cross-tenant         |
| Desktop intranet | Rust Axum locale + SQLite + mDNS           | LAN push + poll | Eventi single-site senza Internet (fiere, navi, congressi) |
| Hybrid (post-Q)  | Desktop master + Supabase backup push-only | LAN + cloud 60s | Aziende che vogliono backup cloud + multi-sede             |

In modalita desktop, le route cloud-only (`/team`, `/billing`, `/audit`, `/admin/tenants`, `/admin/devices`, `/admin/usage`, `/admin/credentials`, `/admin/webhooks`) sono nascoste e protette da `RequireCloudFeature` route guard con CTA verso `app.liveworksapp.com`. Vedi `apps/web/src/lib/feature-availability.ts`.

## Vincoli sovrani (NON negoziabili)

1. **Stabilita live > tutto.** Mai compromettere un evento in produzione per una feature nuova.
2. **Tenant isolation** — RLS sempre attivo. Vedi `01-data-isolation.mdc`.
3. **File partono sempre da locale.** Il PC sala legge dal proprio disco; cloud/LAN solo per sync. **Enforcement programmatico:** wrapper PC sala devono passare `enforceLocalOnly: true` a `useFilePreviewSource` (rifiuta `mode: 'remote'` con `sovereignViolation`). Vedi `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 11 per la matrice di enforcement completa.
4. **UI identica fra cloud e desktop.** Stessa codebase `apps/web/src/**`.
5. **Persistenza assoluta sala.** Riavvio non perde stato. Solo utente o admin disconnettono.
6. **i18n completezza:** ogni stringa IT visibile in UI ha coppia EN nello stesso commit.
7. **Dark mode only** — token Tailwind `sc-*`. MAI `zinc-*` o `blue-600` diretti.
8. **`apps/player/` NON deve esistere** — Room Player = route `/sala/:token` in `apps/web/`.
9. **`presentation_versions` append-only** — nuove versioni = nuove righe (mai UPDATE).
10. **MAI mDNS dal browser** — solo da Rust via Tauri command.
11. **MAI Supabase JS client diretto in modalita desktop** — sempre via `lib/backend-client.ts`.
12. **MAI contenuto file clienti visibile a super_admin** (GDPR — solo metadati).
13. **Sentry init lazy** — solo se `VITE_SENTRY_DSN` presente, mai bloccare boot SPA.

## Brand & favicon

- **Sorgente:** `icons/Logo Live Slide Center.jpg` (file unico in git).
- **Pipeline:** `apps/web/scripts/generate-brand-icons.mjs` (devDependency `sharp`) eseguita da `prebuild`/`predev` su `@slidecenter/web`.
- **Output:** `apps/web/public/` (favicon-16x16, favicon-32x32, apple-touch-icon, pwa-192x192, pwa-512x512, logo-live-slide-center.jpg).
- **In React:** sempre `AppBrandLogo` da `src/components/AppBrandLogo.tsx` + `t('app.displayName')`. Mai duplicare `<img>`.

## Documentazione canonica (vedi `docs/README.md` per indice completo)

| Documento                                | Quando consultarlo                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `docs/README.md`                         | **INDICE CANONICO**: mappa di tutti i doc per topic                         |
| `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` | **FONTE UNICA DI VERITA**: cos'e' / com'e' fatto / sprint history (~100KB)  |
| `docs/STATO_E_TODO.md`                   | **FONTE UNICA TO-DO**: cosa rimane da fare, field test, Sprint Q            |
| `docs/DISASTER_RECOVERY.md`              | Backup, restore, Sentry setup, Edge Fn warm-keep, workspace cleanup runbook |
| `docs/FIELD_TEST_CHECKLIST.md`           | Checklist pre-evento + smoke E2E + URL produzione                           |
| `docs/Setup_Strumenti_e_MCP.md`          | Setup IDE, MCP servers, Cursor                                              |
| `docs/Istruzioni_Claude_Desktop.md`      | Prompt + workflow per AI assistant (Claude Desktop / Cursor)                |
| `docs/Manuali/`                          | Manuali operativi (Centro Slide Desktop, distribuzione, code-signing, ecc.) |
| `docs/Commerciale/`                      | Materiali vendita (Listino, SLA, Roadmap_Vendita_Esterna)                   |
| `docs/_archive/`                         | Storici sprint chiusi e audit retrospettivi (read-only)                     |

In conflitto vince sempre **`ARCHITETTURA_LIVE_SLIDE_CENTER.md`**.

## Ecosistema Live Software (cross-project)

Live SLIDE CENTER e' parte di un ecosistema piu' ampio (10 app + 1 sito) — gestito da CTO Andrea Rizzari. App correlate:

- **Live PLAN + Live CREW** (Firebase Blaze, GitHub `live-software11`) — gestione produzioni live multi-tenant.
- **Live WORKS APP** (Firebase Blaze) — piattaforma licenze + checkout Lemon Squeezy. **SLIDE CENTER e' integrato qui** per validare licenze (Edge Fn `licensing-sync`).
- **Preventivi DHS + Gestionale FREELANCE** (Firebase Spark, account separato `Andraven11`).
- Desktop nativi: Live 3d Ledwall Render (Tauri+Three.js), Live Speaker Timer (Tauri+Axum), Live Speaker Teleprompter (.NET WPF), Live Video Composer (Python).
- Sito marketing: `www.liveworksapp.com` (Vite + Tailwind + Aruba).

**REGOLA:** quando lavori in questo workspace (`Live SLIDE CENTER/`), usa solo account `live-software11` + Supabase project `cdjxxxkrhgdkcpkkozdl`. Cross-project sync NON applicabile (Slide Center e' single project Supabase).

## Mentalita

Ogni modifica deve essere trattata come se andasse in produzione domani mattina su un evento live di un cliente pagante. Se una soluzione e' veloce ma instabile, scartala. Meglio un intervento piccolo verificato che un salto grande non controllato.

Per dettagli operativi specifici → leggi la rule pertinente (`.cursor/rules/`) o il documento in `docs/`. Le rules `alwaysApply` coprono il 90% del lavoro quotidiano.
