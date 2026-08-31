# AGENTS.md — Live SLIDE CENTER

> **Entry-point unico per agenti AI** (Cursor, Claude Code, Codex CLI, Continue, ecc.) su questo workspace.
> Compatibile con il formato standard `AGENTS.md` (2026). Letto a inizio di ogni sessione.
>
> **Ultimo aggiornamento:** 31 agosto 2026 (reorg docs layout canonico Live Software). Prima: 6 maggio 2026 (Sprint XY licensing v3).

---

## 0. Cosa e' questo workspace

- **Prodotto:** **Live SLIDE CENTER** (commerciale: **Slide Center**) — SaaS multi-tenant per gestione presentazioni in eventi live (congressi, corporate, fiere).
- **Tipo:** monorepo `pnpm` + `Turborepo` con 4 apps + 2 packages condivisi.
- **Modalita prodotto (3, vedi `docs/architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 1):**
  - **Cloud SaaS** (Supabase + Vercel) — eventi multi-sede, accesso remoto.
  - **Desktop intranet** (Tauri 2 + Rust Axum + SQLite + mDNS) — eventi single-site senza Internet.
  - **Hybrid** (post-Sprint Q opzionale) — desktop master + cloud backup push-only.
- **Owner:** Andrea Rizzari (CTO/imprenditore).
- **Lingua agente ↔ utente:** SEMPRE italiano. Tono CTO che parla a un imprenditore.
- **Account ufficiali (mai incrociare con `Andraven11` di Preventivi DHS / Gestionale FREELANCE):**
  - GitHub: **`live-software11`** · Repo `github.com/live-software11/live-slide-center` · Branch `main`. **Fonte di verità** (come le altre app Live). Origin = specchio opzionale; **non fare Detach**.
  - Supabase: **`live.software11@gmail.com`** · Project `cdjxxxkrhgdkcpkkozdl` (Postgres 17)
  - Vercel: **`live.software11@gmail.com`** · Scope `livesoftware11-3449s-projects` · Project `live-slide-center`
  - Sentry: **`live.software11@gmail.com`** · Org `live-work-app` · Project `live-slide-center-web` · Region EU (`de.sentry.io`)

---

## 0.1 Cursor Cloud e prep agenti (fatti 31/08/2026)

Non inventare altri ID.

- Cloud Agents environment già esistente: nome `live-slide-center`, id `cbcbfabc-a52f-11f1-a7d1-d6b4613131ce`.
- Install: `corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm install --frozen-lockfile`. Start vuoto. Nessun secret Firebase.
- Stack: **NON Firebase**. Supabase + Vercel. Desktop Tauri 2. `apps/agent/` e `apps/room-agent/` sono **LEGACY** — non rianimare se non richiesto.
- Sentry: org `live-work-app`, EU `de.sentry.io`, progetto esistente `live-slide-center-web`. SDK già in `apps/web` via `VITE_SENTRY_DSN`. **Non creare un nuovo progetto Sentry. Non stampare il DSN.** Al 31/08/2026: 0 issue in quel progetto.
- Lemon Squeezy: ADR-013 vs webhook in-repo — **[DA VERIFICARE]**. Non "fixare" il licensing in un PR di documentazione.

---

## 1. Mappa documentazione (dove guardare cosa)

In caso di conflitto vince sempre **`docs/architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md`**.

| Vuoi sapere…                                            | Apri questo file                                                |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| **Cos'e' / com'e' fatto** (24 sezioni, ~140 KB)         | `docs/architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md` (FONTE UNICA DI VERITA) |
| **Sintesi viva** (stato + comandi + mappa rules)        | `CLAUDE.md` (root, gemello di questo file lato Claude Code)     |
| **Indice canonico tutti i doc**                         | `docs/README.md`                                                |
| **Cose da fare oggi/domani** (TODO, field test, Sprint Q) | `docs/implementazioni-future/STATO_E_TODO.md`                                        |
| **Setup ambiente sviluppo + MCP**                       | `docs/operazioni/Setup_Strumenti_e_MCP.md`                                 |
| **Disaster recovery + Sentry + warm-keep + cleanup**    | `docs/operazioni/DISASTER_RECOVERY.md`                                     |
| **Checklist pre-evento + smoke E2E**                    | `docs/operazioni/FIELD_TEST_CHECKLIST.md`                                  |
| **Credenziali tenant/utenti demo**                      | `docs/operazioni/FIELD_TEST_CREDENTIALS.md` (pattern + email `@fieldtest.local`; **niente tabella password**, niente `service_role`) |
| **Prompt + workflow per AI assistant**                  | `docs/agenti/Istruzioni_Claude_Desktop.md`                             |
| **Manuali user-facing** (Centro Slide Desktop, code-signing, email, onboarding…) | `docs/operazioni/` |
| **Materiali commerciali** (listino, SLA, roadmap vendita) | `docs/commerciali/`                                           |
| **Storici sprint chiusi** (read-only)                   | `docs/archivio/`                                                |
| **Regole AI modulari** (16 file, suite a 3 livelli)     | `.cursor/rules/*.mdc`                                           |
| **Rules sempre attive** (alwaysApply: true)             | `00-project-identity`, `01-data-isolation`, `02-quality-gate`, `03-i18n`, `04-git-workflow`, `mcp-supabase`, `mcp-vercel`, `docs-structure` |
| **RLS / tenant-isolation pattern**                      | `.cursor/rules/01-data-isolation.mdc` + `supabase-db.mdc`       |
| **Storia commit messaggi multilinea** (template)        | radice: `.commit-msg-*.txt` / `.commit-msg-*.tmp` (gitignored)  |

---

## 2. Stack tecnologico (NON cambiare versioni senza approvazione)

| Layer                | Tecnologia                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Package manager      | pnpm 9.15.9 (workspaces) + Turborepo 2.9                                                                            |
| Frontend SPA         | React 19.2 + TypeScript 6 strict (mode `strict` + `noUnusedLocals`)                                                 |
| Bundler              | Vite 8 (per `apps/web`)                                                                                             |
| UI tokens            | Tailwind CSS 4 (token `sc-*`, dark-mode only) + Radix UI / shadcn (in `packages/ui`)                                |
| State                | Zustand-light + React context (no Redux)                                                                            |
| Forms / Validation   | react-hook-form + Zod (con i18n via `t` injection)                                                                  |
| Backend cloud        | Supabase: Postgres 17 + Auth + Storage + Realtime + 29 Edge Functions Deno                                          |
| Backend desktop      | Tauri 2 (Rust 1.80+) + Axum (REST embedded) + SQLite (mirror schema cloud) + mDNS (`_slidecenter._tcp.local`)       |
| Realtime             | Supabase Postgres changes + Broadcast topic `room:<roomId>` (cloud) / LAN push fan-out + long-poll (desktop)        |
| Cache                | `persistent` Supabase JS client cache + service worker PWA (autoUpdate + skipWaiting + clientsClaim)                |
| Upload               | TUS resumable (cloud, anon o admin) / `simple-upload.ts` POST diretto (desktop, server Rust non implementa TUS)     |
| Tests                | Vitest (unit) + Playwright (E2E) + pgTAP / `rls_audit.sql` (DB) + Cargo integration (Rust)                          |
| Hosting cloud        | Vercel (`live-slide-center.vercel.app`, alias futuro `app.liveslidecenter.com`)                                     |
| Distribuzione desktop| NSIS Windows x64 firmato + Tauri updater Ed25519 (signed-updater opzionale)                                         |
| Telemetria           | Sentry (init lazy se `VITE_SENTRY_DSN` presente, mai bloccante)                                                     |
| Licenze              | Lemon Squeezy (webhook → **Live WORKS APP**) → callback HMAC bidirezionale verso Slide Center. ADR-013 vs webhook in-repo: **[DA VERIFICARE]** |

---

## 3. Struttura monorepo

```
live-slide-center/
├── apps/
│   ├── web/              # @slidecenter/web — React 19 SPA (cloud + desktop) feature folders
│   ├── desktop/          # @slidecenter/desktop — Tauri 2 unico (server Rust Axum embedded)
│   ├── agent/            # Local Agent legacy Tauri 1 (admin LAN) — LEGACY
│   └── room-agent/       # Room Agent legacy Tauri 1 (PC sala daemon) — LEGACY
├── packages/
│   ├── shared/           # @slidecenter/shared — types DB + i18n IT/EN + utility cross-app
│   └── ui/               # @slidecenter/ui — design system Radix/shadcn (token sc-*) + cmdk + sonner
├── supabase/
│   ├── migrations/       # 30+ SQL migration (Fasi 0-15 + Sprint W + X-1 + X-2 + XY licensing)
│   ├── functions/        # 29 Edge Functions Deno
│   ├── tests/            # rls_audit.sql + pgTAP
│   └── config.toml       # verify_jwt per function (alcune verify_jwt=false con auth in-code per ES256)
├── docs/                 # layout canonico: architettura/ operazioni/ implementazioni-future/ agenti/ commerciali/ archivio/ strumenti/ (docs/README.md = indice)
├── icons/                # Logo Live Slide Center (sorgente)
├── scripts/              # PowerShell helpers (Setup-Supabase-MCP.ps1, Verifica-Supabase-MCP.ps1)
├── package.json          # workspace pnpm + script Turbo
├── turbo.json            # task graph (build/lint/typecheck/test/dev) + globalEnv VITE_*
├── pnpm-workspace.yaml
├── vercel.json           # framework=vite + rewrites SPA + cache headers + env runtime
├── .vercelignore         # esclude apps/desktop, apps/agent, apps/room-agent dal deploy cloud
├── .cursorindexingignore # esclude target/, dist/, node_modules/ dall'indexing semantico
└── .cursor/rules/        # 16 file rules AI (3 livelli: alwaysApply / globs / agent-requestable; docs-structure.mdc = layout docs)
```

---

## 4. Le invarianti SACRE (NON negoziabili — non violare mai)

> Riassunto operativo dei 13 vincoli sovrani in `.cursor/rules/00-project-identity.mdc` § "Vincoli sovrani". In conflitto vince sempre `docs/architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md`.

1. **Stabilita live > tutto.** Mai compromettere un evento in produzione per una feature nuova.
2. **Tenant isolation universale.** Ogni tabella business ha `tenant_id UUID NOT NULL` + RLS attiva (`tenant_isolation` + `super_admin_all`). Per le tabelle operative (eventi/sale/sessioni/presentazioni/storage) la policy include `AND NOT public.current_tenant_suspended()`. Vedi `01-data-isolation.mdc`.
3. **File partono SEMPRE dal PC che li proietta.** Cloud/LAN sono solo per sincronizzazione (download su disco prima di aprire). Enforcement programmatico via `useFilePreviewSource({ enforceLocalOnly: true })` su wrapper PC sala. Matrice in ARCHITETTURA § 11.
4. **Stessa SPA per cloud e desktop.** Codebase `apps/web/src/**` unica; il dispatcher `apps/web/src/lib/{backend-mode,backend-client,realtime-client}.ts` astrae il backend. Niente fork del codice React.
5. **Persistenza assoluta sala.** Riavvio non perde stato. Solo utente o admin disconnettono.
6. **i18n parity rigorosa.** Ogni stringa IT visibile ha coppia EN nello **stesso commit** (`packages/shared/src/i18n/locales/{it,en}.json`). Vedi `03-i18n.mdc`.
7. **Dark mode only.** Token Tailwind `sc-*` (`sc-bg`, `sc-surface`, `sc-primary`, `sc-accent`…). MAI `zinc-*`, `blue-600` o colori Tailwind diretti.
8. **`apps/player/` NON deve esistere.** Room Player = route `/sala/:token` in `apps/web/`.
9. **`presentation_versions` e' append-only.** Nuove versioni = nuove righe (mai UPDATE).
10. **MAI mDNS dal browser.** Solo da Rust via Tauri command (`apps/desktop/src-tauri/src/commands/discovery.rs`).
11. **MAI `@supabase/supabase-js` diretto in modalita desktop.** Sempre via `apps/web/src/lib/backend-client.ts` (auto-target server Rust locale via `getBackendMode()`).
12. **MAI contenuto file clienti visibile a `super_admin`** (GDPR — solo metadati).
13. **Sentry init lazy.** Solo se `VITE_SENTRY_DSN` presente; mai bloccare boot SPA. Errori "expected" via `reportError(err, { tag, extra })` da `apps/web/src/lib/telemetry.ts`.

### Invarianti tecniche derivate

- **Upload TUS solo in cloud, POST diretto in desktop** (Sprint X-1 ADR 022). Branching in `useUploadQueue.ts` su `getBackendMode()`. Stessa firma `UploadHandle.abort()`.
- **TUS abort gated da terminal-state nullification** (Sprint X-2 ADR 025). Nullare `uploadHandle` PRIMA di settare `done`/`error`/`cancelled`, altrimenti il cleanup React fa `DELETE` 403 RLS spuria.
- **Edge Functions ES256 con `verify_jwt = false` + auth in-code** (Sprint X-2 ADR 026). Pattern: `pair-init`, `pair-poll`, `slide-validator`. Verifica via `admin.auth.getUser(jwt)` (service-role) che supporta ES256.
- **RLS storage upload via `SECURITY DEFINER`** (Sprint X-1 ADR 023). Funzioni `storage_can_upload_object_anon/_tenant` per evitare subquery raw che fallivano con `anon` Bearer in TUS.
- **Webhook Lemon Squeezy SOLO in Live WORKS APP** (ADR 013). Slide Center riceve via callback HMAC bidirezionale (Sprint XY).
- **Append-only su `presentation_versions`** (ADR 009). Nessun UPDATE, solo INSERT.
- **PWA con `autoUpdate` + `skipWaiting` + `clientsClaim`** (Sprint X-2 ADR 027). Hard-reload Ctrl+Shift+R come safety net per casi edge.

---

## 5. RBAC — schema rapido

5 ruoli: `super_admin | admin | coordinator | tech | speaker (guest)` · JWT custom claims in `app_metadata`: `{tenant_id, role, user_id}`. Bootstrap super_admin via `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}'::jsonb`.

| Ruolo            | Scope                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| `super_admin`    | Cross-tenant: lista tenant, quote, audit. **NO contenuto file** (GDPR — solo metadati) |
| `admin`          | Tutto nel proprio tenant: CRUD eventi/sale/sessioni, team, billing, export             |
| `coordinator`    | CRUD sessioni/speaker, vista regia, gestione upload                                    |
| `tech`           | Vista sala assegnata, download file, stato sync                                        |
| `speaker` (guest) | Solo upload via `upload_token` univoco (Edge Function `verify_jwt = false`)           |

Eccezione PC sala anon: `room-player-bootstrap`, `room-player-rename`, `room-player-set-current`, `pair-claim`, `team-invite-accept` autenticano via token custom (sha256 hex contro `paired_devices.pair_token_hash` o `team_invitations.invite_token`).

---

## 6. Comportamento autonomo vs. conferma

### L'agente procede AUTONOMAMENTE

- Bug fix isolati, refactor di un singolo file, aggiunta UI minore (con coppia i18n IT/EN nello stesso commit)
- Aggiornamento testi / chiavi `it.json` + `en.json`
- Fix lint / typecheck / `cargo check`
- Migration additive su `supabase/migrations/**` (con RLS pattern obbligatorio)
- Documentazione interna (incluso `docs/implementazioni-future/STATO_E_TODO.md`)
- Comando "commit and push" / "deploy" → esegui subito (vedi `04-git-workflow.mdc`)

### L'agente si FERMA e chiede conferma (formato 3 righe: Cosa / Rischio / Beneficio)

- Modifiche allo schema Postgres che alterano colonne esistenti / vincoli / RLS deboli
- Refactor che tocca >10 file o cambia public API tra moduli
- Modifiche a `01-data-isolation.mdc` o ai pattern RLS canonici
- Modifiche al sistema licenze (ADR 013: webhook SOLO in WORKS APP) o sync licenze (Sprint XY)
- Deploy production fuori finestra (vedi `docs/implementazioni-future/STATO_E_TODO.md` per finestre evento)
- `git push --force` su `main`
- `git commit --amend` su commit gia' pushati
- Cambio `origin` o `gh auth switch` automatico
- Disinstallare/installare dipendenze pesanti (>50KB minified) senza valutare lazy chunking

### MAI fare (zero eccezioni)

- Operare con account `Andraven11` (e' per Preventivi DHS / Gestionale FREELANCE).
- Push da sessione `Andraven11` su `origin live-software11/live-slide-center`.
- Cambiare `origin` verso repo `Andraven11/*` senza richiesta esplicita.
- `git rebase -i` o `git add -i` (interattivo non supportato dal terminale agent).
- Hardcodare credenziali (anon key, `service_role`, password admin, DSN) in script committati. Field test: solo pattern + email in `docs/operazioni/FIELD_TEST_CREDENTIALS.md` — **niente tabella password**. (AGENTS.md lo diceva gitignored: non lo era; era su GitHub.)
- Disattivare Sentry init nei path produzione.
- Toccare `.env`, `.env.local`, `apps/desktop/src-tauri/tauri.signing.json`, `~/.cursor/mcp.json` in commit.
- Modificare `network_mode` ENUM, `tenant_id` su tabelle business, `super_admin_all` policy senza ADR.
- Aggiungere stringhe IT hardcoded in JSX (sempre `t('namespace.key')` con coppia EN nello stesso commit).

---

## 7. Checklist obbligatoria per nuove feature / migration / Edge Function

- [ ] **Tenant?** Tabella ha `tenant_id UUID NOT NULL REFERENCES tenants(id)`?
- [ ] **RLS?** `ENABLE ROW LEVEL SECURITY` + policy `tenant_isolation` (con `current_tenant_suspended()` se operativa) + `super_admin_all`?
- [ ] **Index?** Su `tenant_id` + ogni FK frequente?
- [ ] **Storage path?** Include `tenants/{tenant_id}/`?
- [ ] **Realtime?** Filtro `event=eq.{eventId}` / `room_id=in.(...)` o broadcast topic UUID v4 non enumerable?
- [ ] **Edge Function?** Verifica auth + `tenant_id` da `app_metadata` prima di operare? Se serve ES256, `verify_jwt = false` + auth in-code via `admin.auth.getUser(jwt)`?
- [ ] **i18n?** Ogni stringa IT visibile ha coppia EN in `it.json` + `en.json` nello stesso commit?
- [ ] **Token Tailwind `sc-*`?** Niente `zinc-*` o `blue-600` diretti?
- [ ] **Append-only?** Su `presentation_versions` solo INSERT, mai UPDATE?
- [ ] **Backend mode?** Branching `getBackendMode()` se la feature dipende da cloud/desktop (es. upload, realtime)?
- [ ] **Cloud-only?** Wrappato in `RequireCloudFeature` + nascosto in modalita desktop (`/team`, `/billing`, `/audit`, `/admin/*`)?
- [ ] **Sentry?** Errori critici via `reportError(err, { tag: 'feature.action', extra })` (`telemetry.ts`)?
- [ ] **Smoke?** Modifica cloud rilevante (Edge Fn, env vars, schema)? Lanciare `pnpm smoke:cloud` post-deploy (atteso 6 OK + 1 skip + 1 warn)?
- [ ] **Docs?** Aggiornato `docs/architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md` (header / § rilevante / § 22 sprint history) e/o `docs/implementazioni-future/STATO_E_TODO.md` se la modifica e' strutturale?

---

## 8. Comandi essenziali

> PowerShell: usa `;` al posto di `&&` per concatenare. Heredoc bash NON supportato → per messaggi commit multilinea scrivere in `.commit-msg-tmp.txt` (gitignored) e usare `git commit -F`.

```powershell
# Setup
pnpm install
firebase --version             # NON usato qui (workspace su Supabase, non Firebase)
supabase --version
vercel whoami                  # deve stampare livesoftware11-3449
gh auth status                 # deve mostrare live-software11 attivo

# Dev
pnpm dev                                       # tutti gli apps in parallelo (Turbo)
pnpm --filter @slidecenter/web dev             # solo cloud SPA (porta 5173)
pnpm dev:desktop                               # Tauri 2 desktop (Vite + webview)

# Quality gate (PRIMA di ogni commit/deploy — vedi 02-quality-gate.mdc)
pnpm typecheck                                 # tsc --noEmit (zero errori)
pnpm lint                                      # ESLint (zero errori, zero warning)
pnpm build                                     # Vite build (cloud + desktop bundle)
pnpm test                                      # solo se hai toccato logica business
pnpm smoke:cloud                               # E2E produzione (Sentry, Edge Fn, Vercel)

# Per modifiche apps/desktop/src-tauri:
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --all-targets -- -D warnings

# Build desktop NSIS
pnpm --filter @slidecenter/desktop release:nsis
# wrapper PowerShell user-friendly:
apps/desktop/scripts/release.ps1 -Signed

# Supabase
supabase db push                               # applica migration pendenti
supabase functions deploy <nome>               # deploy singola Edge Function
supabase functions deploy                      # deploy tutte
supabase gen types typescript --project-id cdjxxxkrhgdkcpkkozdl > packages/shared/src/types/database.ts

# Vercel (account livesoftware11-3449, project live-slide-center)
vercel --prod --yes --archive=tgz              # SBLOCCO MANUALE: --archive=tgz OBBLIGATORIO (monorepo)

# Git (account live-software11)
git status
git add <file>; git commit -m "feat: msg"; git push
# Per messaggi lunghi: Write -> .commit-msg-tmp.txt -> git commit -F .commit-msg-tmp.txt -> Delete
```

---

## 9. Ecosistema Live Software (per orientamento)

Live SLIDE CENTER e' una delle 10+ app di Andrea Rizzari. Questa cartella tratta SOLO Live SLIDE CENTER. Cross-project sync NON applicabile (Slide Center e' single-project Supabase). App correlate (cartelle separate, NON in questo workspace):

| Progetto                 | Account / stack                                                    | Relazione con Slide Center                                |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------- |
| **Live PLAN**            | `live-software11` · Firebase Blaze `live-plan-app`                 | Stesso ecosistema gestione produzioni (no integrazione diretta) |
| **Live CREW**            | `live-software11` · Firebase Blaze `live-crew-app`                 | Stesso ecosistema (no integrazione diretta)               |
| **Live WORKS APP**       | `live-software11` · Firebase Blaze `live-works-app`                | **INTEGRATO**: webhook Lemon Squeezy + callback licenze HMAC bidirezionale (Sprint XY) |
| Preventivi DHS           | `Andraven11` · Firebase Spark `preventivi-dhs`                     | Diverso tenant DHS, no integrazione                       |
| Gestionale FREELANCE     | `Andraven11` · Firebase Spark `dhs-freelance`                      | Diverso tenant DHS, no integrazione                       |
| Live 3d Ledwall Render   | Tauri 2 + Three.js (no Firebase, no Supabase)                       | Desktop standalone, ecosistema Live                       |
| Live Speaker Timer       | Tauri 1 + Axum (no Firebase, no Supabase)                           | Desktop standalone, ecosistema Live                       |
| Live Speaker Teleprompter| .NET 8 WPF (no Firebase, no Supabase)                              | Desktop standalone, ecosistema Live                       |
| Live Video Composer      | Python Tkinter (no Firebase, no Supabase)                           | Desktop standalone, ecosistema Live                       |
| Sito marketing           | `www.liveworksapp.com` · Vite + Tailwind + Aruba                    | Marketing del catalogo Live                               |

**Mai incrociare account.** Workspace Live SLIDE CENTER = SOLO `live-software11` + Supabase `cdjxxxkrhgdkcpkkozdl`.

---

## 10. Storia documentale (per chi legge in futuro)

- **31 agosto 2026** — Reorg documentazione al layout canonico Live Software (`docs/architettura|operazioni|implementazioni-future|agenti|commerciali|archivio|strumenti`). Indice `docs/README.md`. Rule `docs-structure.mdc`. Stub credenziali field test (password non in git).
- **6 maggio 2026** — Audit completo workspace + creato `AGENTS.md` come entry-point standard 2026 (gemello di `CLAUDE.md` lato Cursor / Codex / Continue). Aggiornati: `CLAUDE.md` v3.2 (EF count 26→29, packages/ui aggiunto, Sprint XY licensing v3 in roadmap), `docs/README.md` (riga AGENTS.md), `docs/architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md` v6.1 (header + § 22 nuova sottosezione "Sprint XY licensing v3"), `.cursor/rules/00-project-identity.mdc` (AGENTS.md tra le fonti di verita).
- **19 aprile 2026 sera tardi** — Sprint X-2 (TUS abort + ES256 edge function + cache PWA). Vedi `docs/architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22.
- **19 aprile 2026 sera** — Sprint X-1 (upload hardening: simple-upload desktop + race-cancel cloud + smoke env vars + storage RLS SECURITY DEFINER). Vedi `docs/architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22.
- **19 aprile 2026** — Sprint W chiuso, Sentry attivo, workspace cleanup (-11.83 GB), docs overhaul (29 → 14 doc canonici), nuovo `docs/README.md` indice canonico.

---

**Regola d'oro per tutta la sessione:**

> Ogni modifica deve essere trattata come se andasse in produzione domani mattina su un evento live di un cliente pagante. Se una soluzione e' veloce ma instabile, scartala. Meglio un intervento piccolo verificato che un salto grande non controllato.

Per dettagli operativi specifici → leggi la rule pertinente (`.cursor/rules/`) o il documento in `docs/`. Le rules `alwaysApply` coprono il 90% del lavoro quotidiano.
