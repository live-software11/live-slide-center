# Live SLIDE CENTER — Sintesi viva (CLAUDE.md)

> Questo file e' la **mappa rapida** del progetto per AI assistenti / nuovi developer.
> **Per architettura completa:** `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` (UNICA fonte di verita).
> **Per cose da fare:** `docs/STATO_E_TODO.md`.
> **Per setup ambiente:** `docs/Setup_Strumenti_e_MCP.md`.
> **Per regole AI:** `.cursor/rules/*.mdc`.
> **Per quotidianita':** comandi qui sotto.
>
> **Versione CLAUDE.md:** 2.0 — 18 aprile 2026.

## Cos'e'

SaaS multi-tenant per **gestione presentazioni in eventi live**. Nome commerciale: **Slide Center**.

- **Cloud:** dashboard React (`apps/web`) + Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions).
- **Desktop offline:** singolo binario Tauri 2 (`apps/desktop`) con server Rust Axum embedded — **stessa SPA** del cloud, backend locale + LAN + mDNS.
- **Owner:** Andrea Rizzari (CTO/imprenditore).

## Account (REGOLA SACRA — verificare PRIMA di ogni operazione remota)

| Servizio | Account                                        | Verifica         |
| -------- | ---------------------------------------------- | ---------------- |
| GitHub   | **live-software11**                            | `gh auth status` |
| Supabase | live.software11@gmail.com                      | Dashboard        |
| Vercel   | live.software11@gmail.com                      | Dashboard        |
| Repo     | `github.com/live-software11/live-slide-center` | `git remote -v`  |

Mai operare con account `Andraven11` (e' per Preventivi DHS / Gestionale FREELANCE).

## Stack in una riga

React 19 + TS strict + Vite 8 + Tailwind 4 + Tauri 2 + Rust Axum + Supabase (Postgres 17, project `cdjxxxkrhgdkcpkkozdl`) + pnpm + Turborepo.

## Struttura monorepo (alto livello)

```
live-slide-center/
├── apps/
│   ├── web/              # React 19 SPA (cloud + desktop) — feature folders
│   ├── desktop/          # Tauri 2 unico (Sprint J-Q): wrapper + server Rust Axum
│   ├── agent/            # Local Agent legacy Fase 7 (admin LAN, Tauri+Axum)
│   └── room-agent/       # Room Agent legacy Fase 7 (PC sala daemon, autostart)
├── packages/
│   └── shared/           # @slidecenter/shared — types DB + i18n + utility cross-app
├── supabase/
│   ├── migrations/       # 25+ SQL migration (Fasi 0-15)
│   ├── functions/        # 15 Edge Functions Deno
│   ├── tests/            # rls_audit.sql + pgTAP
│   └── config.toml
├── docs/                 # Vedere docs-roadmap.mdc per la mappa completa
├── icons/                # Sorgente brand (Logo Live Slide Center.jpg)
├── package.json          # workspace pnpm + script Turbo
├── turbo.json            # pipeline build/dev/lint/typecheck/test
├── pnpm-workspace.yaml
└── .cursor/rules/        # Suite rules AI (vedere sotto)
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

# Per modifiche apps/desktop/src-tauri:
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --all-targets -- -D warnings

# Build desktop NSIS (Sprint J-Q)
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
```

Per messaggi commit multilinea (PowerShell NON supporta heredoc bash): scrivere il messaggio con `Write` tool in `.commit-msg-tmp.txt`, poi `git commit -F .commit-msg-tmp.txt` + delete file.

## Suite Cursor rules (`.cursor/rules/`)

**3 livelli per minimizzare context overload:**

### alwaysApply (sempre attive — ~12K totali)

| File                      | Cosa garantisce                                                      |
| ------------------------- | -------------------------------------------------------------------- |
| `00-project-identity.mdc` | Identita progetto, fonti di verita, account, vincoli sovrani         |
| `01-data-isolation.mdc`   | Tenant isolation + RLS pattern obbligatori + RBAC + Storage path     |
| `02-quality-gate.mdc`     | Workflow chiusura task: typecheck/lint/build + standard senior       |
| `03-i18n.mdc`             | i18n IT/EN obbligatorio + terminologia dominio eventi live           |
| `04-git-workflow.mdc`     | Account live-software11, format commit, deploy Vercel/Supabase/Tauri |
| `mcp-supabase.mdc`        | Uso server MCP Supabase (project_id, capabilities)                   |

### Globs mirati (caricati solo quando matchi i file)

| File                      | Globs                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `web-react.mdc`           | `apps/web/src/**/*.{ts,tsx}` — pattern React 19, design system, perf   |
| `web-supabase-client.mdc` | `apps/web/src/lib/supabase.ts`, `repository.ts`, hooks `use*.ts`       |
| `supabase-db.mdc`         | `supabase/migrations/**`, `supabase/functions/**`, `supabase/tests/**` |
| `desktop-tauri.mdc`       | `apps/desktop/**`, `apps/web/src/lib/desktop-bridge.ts`                |
| `legacy-agents.mdc`       | `apps/agent/**`, `apps/room-agent/**` (Fase 7 legacy)                  |

### Agent-requestable (caricabili on-demand)

| File                    | Quando leggerla                                                         |
| ----------------------- | ----------------------------------------------------------------------- |
| `architecture-deep.mdc` | Feature cross-cloud-desktop-LAN o refactoring grande di un sottosistema |
| `field-test-fase15.mdc` | Pianificare/chiudere uno sprint A-Q o capire cosa fa quale sprint       |
| `docs-roadmap.mdc`      | Aggiornare docs o cercare quale guida usare                             |

## Stato progetto (aprile 2026)

### Cloud (Fasi 0-14): COMPLETATO 100%

Schema PostgreSQL maturo (RLS + custom claims JWT + 25+ migration), 15 Edge Functions, sistema pairing PC sala (cloud), Storage TUS resumable, Realtime postgres_changes + Broadcast, Auth con team invitations, GDPR export, billing redirect Live WORKS APP, status page pubblica, super_admin tenant management.

### Field test (Fase 15.1, Sprint A-I): COMPLETATO 100%

| Sprint | Tema                                                                 |
| ------ | -------------------------------------------------------------------- |
| A      | playback_mode (auto/live/turbo) — tuning polling sala                |
| B      | Realtime Broadcast `room:<uuid>` — PC sala anon                      |
| C      | Resume HTTP Range + verify SHA-256 + skip se completo                |
| D      | Bootstrap optimization (cached fields, manifest one-shot)            |
| E      | Retry/backoff (E1) + recovery offline (E2) + storage guard (E3)      |
| F      | Bulk actions admin (move, delete, change presentation)               |
| G      | Drag&drop file fra sessioni (RPC `rpc_move_presentation_to_session`) |
| H      | File preview universale (PPT/PDF/Keynote thumbnail + zoom)           |
| I      | "In onda" (`current_presentation_id` + RPC sicura)                   |

### Desktop offline (Fase 15.2, Sprint J-P + FT): TUTTI DONE

| Sprint | Tema                                                                       |
| ------ | -------------------------------------------------------------------------- |
| J      | Bootstrap Tauri 2 + plugin (shell/fs/http/notification/dialog) + NSIS      |
| K      | Server Rust Axum locale + SQLite (rusqlite WAL) + storage + Range          |
| L      | mDNS publish + browse `_slidecenter._tcp.local` + role admin/sala          |
| M      | Persistenza assoluta sala (`device.json` auto-rejoin)                      |
| N      | LAN push admin → sala (fan-out + ring buffer + long-poll `/events/stream`) |
| O      | Backend status hook + `BackendModeBadge` + astrazione Realtime             |
| P      | Updater Tauri + `DesktopUpdateBanner` + script PowerShell release          |
| FT     | Field Test Readiness Pack (smoke test + runbook + template feedback)       |

### Field test desktop (RINVIATO per scelta Andrea)

**Stato:** non in esecuzione. Quando Andrea avra' un evento DHS reale o un cliente esterno interessato alla versione desktop, eseguire la **procedura completa** descritta in `docs/STATO_E_TODO.md` § 3 (preparazione T-2 / smoke T-1 / esecuzione T / decisione T+1) + template feedback inline (§ 3.5) + procedura rollback (§ 3.6).

- **Pre-volo automatizzato:** `pnpm --filter @slidecenter/desktop smoke-test:sala` su ogni PC field-test (deve restituire `>>> SEMAFORO VERDE` su 100% dei PC).
- **Decisioni misurabili:** GO/NO-GO produzione + GO/NO-GO Sprint Q definite in `docs/STATO_E_TODO.md` § 3.5 e § 4.2 (5 domande SI/NO, soglia 2 SI per Sprint Q).

### Sprint Q (OPZIONALE): Sync hybrid cloud<->offline

**Stato:** **NON in progress.** Decisione GO/NO-GO vincolata al framework in `docs/STATO_E_TODO.md` § 4.2 (post-field-test).

**Goal (se GO):** quando il desktop torna online, sync con cloud Supabase per backup + condivisione cross-sede. Push-only (desktop master, cloud backup). Worker 60s, `synced_at` su SQLite, TUS upload bucket. **Piano operativo READY-TO-CODE** in `docs/STATO_E_TODO.md` § 4.3 (file da creare, RPC, schema migration, UI, costi stimati ~5€/mese-evento, test manuali).

**Quando NON serve:** uso interno single-site senza necessita di backup cloud o condivisione fra sedi.

**Hardening, code-signing, multi-OS:** **NON sono Sprint Q.** Code-signing OV Sectigo e' un'attivita esterna pianificabile (vedi `docs/STATO_E_TODO.md` § 2.2 + `docs/Manuali/Manuale_Code_Signing.md`).

### Audit chirurgico 18/04/2026 (Sprint R / S / T pianificati)

**Stato:** **audit completato, Sprint R-1 DONE (1/10 GAP chiusi), R-2 next.**

**Sintesi 10 GAP rilevati** rispetto agli obiettivi prodotto sovrani (parita cloud/desktop, file da locale, versioning chiaro, perf zero impatto, super-admin licenze, OneDrive-style, drag PC, upload da sala, export ordinato, competitor parity):

| Sprint  | Focus                             | Gap addressati    | Tempo dev | Stato                                      |
| ------- | --------------------------------- | ----------------- | --------- | ------------------------------------------ |
| **R-1** | Super-admin crea tenant + licenze | G1                | 1.5g      | **DONE 18/04/2026 (vedi §0.9)**            |
| **R-2** | Live WORKS APP integrazione bidir | G2                | 2g        | NEXT (in attesa GO Andrea)                 |
| **R-3** | PC sala upload speaker check-in   | G3                | 2g        | pending                                    |
| **S**   | OneDrive-style file management    | G4 + G5 + G6 + G7 | 5g        | pending (evento DHS reale > 3 sale)        |
| **T**   | Performance + competitor parity   | G8 + G9 + G10     | 4g        | pending (match feature PreSeria/Slidecrew) |

**Dettaglio dei 10 GAP, file coinvolti, soluzione tecnica, decisioni richieste ad Andrea:** `docs/STATO_E_TODO.md` § 0.

**Backward compatibility:** 100% (tutti gli sprint sono opt-in via flag, nessun breaking change). Nessun aumento di costi infra (Supabase Free + Vercel Free + Lemon Squeezy free tier sufficienti).

### Sprint R-1 (G1) — Super-admin crea tenant + licenze (DONE 18/04/2026)

**Stato:** **completato e verde.** Andrea (super_admin) puo' creare un nuovo tenant cliente + invitare il primo admin direttamente dal pannello `/admin/tenants` senza passare da CLI/Supabase Dashboard.

| Area                | Cosa                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migration           | `supabase/migrations/20260418060000_admin_create_tenant.sql` — RPC SECURITY DEFINER `admin_create_tenant_with_invite(...)` con `is_super_admin()` check, validazioni stringenti (slug, plan, storage, email, license format), INSERT atomico tenant+invite+activity_log. |
| Repository          | `apps/web/src/features/admin/repository.ts` — `createTenantWithInvite()` + `suggestSlug()` + mappa errori i18n.                                                                                                                                                          |
| UI                  | `apps/web/src/features/admin/components/CreateTenantDialog.tsx` — form completo (nome, slug auto-derivato, plan, quote per piano, expires_at, license_key opzionale, email primo admin) + schermata risultato con copy-to-clipboard dell'invite URL.                     |
| UI integration      | `apps/web/src/features/admin/AdminTenantsView.tsx` — bottone "Crea nuovo tenant" in header lista.                                                                                                                                                                        |
| i18n                | 36 chiavi nuove `admin.createTenant.*` IT/EN parity + `common.copy`/`common.copied` riusabili.                                                                                                                                                                           |
| Schema team_invites | `invited_by_user_id` ora nullable + nuovo `invited_by_role TEXT` per supportare inviti da super_admin (che non ha riga in `public.users`).                                                                                                                               |

**Quality gates verdi:** `pnpm typecheck` (5/5 OK), `pnpm --filter @slidecenter/web lint` (0 errors), `pnpm --filter @slidecenter/web build` (1.16s, AdminTenantsView 19.62 kB gzip 4.62 kB).

**Cosa NON e' incluso (delegato a sprint successivi):**

- Email automatica all'admin invitato → R-1.b (richiede nuovo template `kind='admin_invite'` su `email-send`). Per ora super-admin copia/incolla URL manualmente. Welcome email post-accept gia' funzionante.
- Sync con Live WORKS APP per registrare la licenza la' → R-2 (next).

### Hardening Supabase + Vercel (Sprint Q+1) — DONE 18/04/2026

**Stato:** **completato e verde.** Eseguito PRIMA degli sprint R/S/T per garantire backend production-ready.

| Area            | Cosa                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase DB     | 7 indici hot-path (`20260418040000_perf_hot_path_indexes.sql`) + revoke `anon` write least-privilege (`20260418050000_security_least_privilege.sql`)  |
| Supabase Client | PKCE flow + `storageKey` namespace + `x-application-name` header + Realtime rate limit (`apps/web/src/lib/supabase.ts`)                               |
| Vercel headers  | HSTS 2 anni preload, CSP completa Supabase+Sentry+Vercel Analytics, X-Frame-Options DENY, COOP/CORP same-origin, Permissions-Policy super-restrittiva |
| Vercel cache    | Assets immutable 1 anno, immagini 30 giorni, redirect SEO, cleanUrls                                                                                  |
| PWA cache       | NIENTE cache su `/auth/v1/*` e `/realtime/v1/*`; signed URL TTL ridotto a 60s                                                                         |
| CI/CD           | `db-types-drift.yml` (anti-regressione schema vs codice) + `deploy-supabase.yml` (auto-deploy Edge Functions, opt-in migrations)                      |
| DX              | 7 nuovi script: `pnpm db:types`, `db:types:local`, `db:diff`, `db:lint`, `db:push`, `fn:deploy`, `vercel:env:pull`, `vercel:deploy:prod`              |
| Documentazione  | `.env.example` riscritto con sezioni chiare (frontend/CLI/Edge secrets/Vercel)                                                                        |

**Quality gates verdi:** `pnpm typecheck` + `pnpm lint` + `pnpm --filter @slidecenter/web build` tutti OK.

**Cosa resta a Andrea (manuale, ~30 min):** vedi `docs/STATO_E_TODO.md` § 0.8.4 (apply migrations, set Edge secrets, set Vercel env vars, set GitHub Actions secrets).

### Tre modalita di esecuzione del prodotto (vedi ARCHITETTURA § 3)

Ogni feature deve funzionare in tutte e tre le modalita o dichiarare esplicitamente la sua compatibilita:

| Modalita         | Backend                                    | Sync sala       | Quando si vende                                            |
| ---------------- | ------------------------------------------ | --------------- | ---------------------------------------------------------- |
| Cloud SaaS       | Supabase (PG + Auth + Storage + Realtime)  | Realtime PG     | Eventi multi-sede, accesso da remoto, cross-tenant         |
| Desktop intranet | Rust Axum locale + SQLite + mDNS           | LAN push + poll | Eventi single-site senza Internet (fiere, navi, congressi) |
| Hybrid (post-Q)  | Desktop master + Supabase backup push-only | LAN + cloud 60s | Aziende che vogliono backup cloud + multi-sede             |

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

## Brand & favicon

- **Sorgente:** `icons/Logo Live Slide Center.jpg` (file unico in git).
- **Pipeline:** `apps/web/scripts/generate-brand-icons.mjs` (devDependency `sharp`) eseguita da `prebuild`/`predev` su `@slidecenter/web`.
- **Output:** `apps/web/public/` (favicon-16x16, favicon-32x32, apple-touch-icon, pwa-192x192, pwa-512x512, logo-live-slide-center.jpg).
- **In React:** sempre `AppBrandLogo` da `src/components/AppBrandLogo.tsx` + `t('app.displayName')`. Mai duplicare `<img>`.

## Documentazione (mappa rapida)

| Documento                                | Quando consultarlo                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` | **FONTE UNICA DI VERITA**: cos'e' / com'e' fatto (~90 KB, 24 sez.)                     |
| `docs/STATO_E_TODO.md`                   | **FONTE UNICA TO-DO**: cosa rimane da fare, field test, Sprint Q                       |
| `docs/Setup_Strumenti_e_MCP.md`          | Setup IDE, MCP servers, Cursor + mappa documentazione completa                         |
| `docs/Istruzioni_Claude_Desktop.md`      | Prompt + workflow per AI assistant (Claude Desktop / Cursor)                           |
| `docs/Manuali/`                          | 7 manuali operativi (admin, installer, distribuzione, code-signing, email, screencast) |
| `docs/Commerciale/`                      | Materiali vendita (Listino, SLA, Roadmap_Vendita_Esterna, README)                      |

In conflitto vince sempre **`ARCHITETTURA_LIVE_SLIDE_CENTER.md`**. Per dettagli su sprint specifici → `.cursor/rules/field-test-fase15.mdc`.

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
