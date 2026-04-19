# Setup Strumenti, MCP e Ambiente — Live SLIDE CENTER

> Guida completa per configurare l'ambiente di sviluppo ottimale.
>
> **Versione:** 3.0 — 19 aprile 2026 (post Sprint W + Sentry + workspace cleanup + docs overhaul).
> **Status:** allineata con `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` e `docs/STATO_E_TODO.md` v6.x.

---

## 0. Mappa documentazione

La documentazione canonica di **Live SLIDE CENTER** vive in `docs/` (14 doc canonici + sottocartelle `Manuali/`, `Commerciale/`, `_archive/`). Per l'**indice navigabile completo** vedi:

> **`docs/README.md`** — indice canonico aggiornato a ogni overhaul.

### Sintesi rapida (quale doc leggere prima)

| Topic                                                         | Documento                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Cosa e' / com'e' fatto il prodotto                            | `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` (UNICA fonte di verita)                           |
| Cosa resta da fare / sprint pending                           | `docs/STATO_E_TODO.md`                                                                     |
| Setup ambiente sviluppo (Node/pnpm/Rust/Tauri/Supabase CLI/MCP) | `docs/Setup_Strumenti_e_MCP.md` (questo file)                                              |
| Istruzioni AI (Claude Desktop / Cursor)                       | `docs/Istruzioni_Claude_Desktop.md`                                                        |
| Disaster recovery + Sentry + warm-keep + workspace cleanup    | `docs/DISASTER_RECOVERY.md`                                                                |
| Checklist pre-evento + smoke E2E                              | `docs/FIELD_TEST_CHECKLIST.md`                                                             |
| Manuale Centro Slide Desktop (Setup + Smoke Test)             | `docs/Manuali/Manuale_Centro_Slide_Desktop.md`                                             |
| Onboarding admin cloud SaaS                                   | `docs/Manuali/Manuale_Onboarding_Admin.md`                                                 |
| Email transazionali Resend                                    | `docs/Manuali/Manuale_Email_Resend.md`                                                     |
| Code signing OV Sectigo                                       | `docs/Manuali/Manuale_Code_Signing.md`                                                     |
| Distribuzione installer firmati                               | `docs/Manuali/Manuale_Distribuzione.md`                                                    |
| Listino + SLA + roadmap vendita                               | `docs/Commerciale/`                                                                        |
| Storici sprint chiusi (read-only)                             | `docs/_archive/`                                                                           |
| Mappa rapida per AI                                           | `CLAUDE.md` (root)                                                                         |

### Regole `.cursor/rules/` (vincoli per l'agente AI)

15 file `.mdc` in `.cursor/rules/` organizzati su 3 livelli (alwaysApply / globs mirati / agent-requestable). Per la mappa completa vedi `CLAUDE.md` § "Suite Cursor rules" oppure `.cursor/rules/docs-roadmap.mdc`.

---

## 1. Prerequisiti da installare

### Core

| Strumento        | Comando installazione              | Versione minima | Note                         |
| ---------------- | ---------------------------------- | --------------- | ---------------------------- |
| **Node.js**      | `winget install OpenJS.NodeJS.LTS` | 22 LTS          | Runtime per monorepo         |
| **pnpm**         | `npm install -g pnpm`              | 9+              | Package manager monorepo     |
| **Rust**         | `winget install Rustlang.Rustup`   | 1.77+           | Backend Tauri v2             |
| **Supabase CLI** | `pnpm add -g supabase`             | latest          | Migrations, types, local dev |
| **Tauri CLI**    | `pnpm add -D @tauri-apps/cli`      | 2.x             | Build desktop apps           |
| **Git**          | gia installato                     | latest          | Version control              |
| **GitHub CLI**   | `winget install GitHub.cli`        | latest          | `gh auth`, PR, issues        |
| **Vercel CLI**   | `npm install -g vercel`            | 51+             | Deploy `apps/web` cloud SaaS |

### Opzionali ma raccomandati

| Strumento                     | Uso                                                    |
| ----------------------------- | ------------------------------------------------------ |
| **Docker Desktop**            | `supabase start` usa Docker per DB locale              |
| **Turbo**                     | `pnpm add -g turbo` — CLI Turborepo globale            |
| **Visual Studio Build Tools** | Necessario per compilare moduli Rust nativi su Windows |

### Repository GitHub (sorgente)

- **URL:** `https://github.com/live-software11/live-slide-center`
- **Clone:** `git clone https://github.com/live-software11/live-slide-center.git`
- **Conventions di commit + PR:** vedi `.cursor/rules/04-git-workflow.mdc` (commit message, branch, account corretto).
- **Account GitHub:** SEMPRE `live-software11` per Live SLIDE CENTER. Verifica con `gh auth status` prima di ogni push remoto.

**EN:** Official monorepo is under org **live-software11**; use `gh auth status` before push.

---

## 2. Server MCP — Supabase (auth permanente, Aprile 2026)

### Se non hai competenze tecniche (tutto guidato)

1. Apri **PowerShell** o il terminale integrato in Cursor nella cartella del progetto **Live SLIDE CENTER**.
2. Esegui **una sola volta**:

```bash
pnpm run setup:supabase-mcp
```

3. Lo script apre il browser, ti chiede di incollare il token (senza mostrarlo), salva tutto in Windows e ti dice di **chiudere Cursor del tutto** e riaprirlo.
4. Per controllare che sia andato a buon fine:

```bash
pnpm run verify:supabase-mcp
```

**EN:** Run `pnpm run setup:supabase-mcp` once, then restart Cursor fully; run `pnpm run verify:supabase-mcp` to confirm env vars exist.

> L’agente AI **non puo** creare il token al posto tuo (serve login nel browser con la tua password Supabase). Lo script fa tutto il resto.

---

## 2b. Server MCP — Supabase (auth permanente, dettagli tecnici)

### Errore `{"message":"Unrecognized client_id"}`

Se durante **Authenticate** su Supabase MCP compare quel JSON nel browser, **non e un errore del tuo account**: e un problema noto del flusso **OAuth** tra Cursor e `mcp.supabase.com` (registrazione `client_id`). Riferimento: [supabase/supabase#43662](https://github.com/supabase/supabase/issues/43662).

**EN:** The hosted MCP OAuth flow can fail with `Unrecognized client_id`; use a **Personal Access Token (PAT)** instead — this is the official Supabase workaround for clients where OAuth is broken.

### Accesso completo vs solo un progetto (importante)

Con il PAT, l’URL del MCP puo essere:

| URL                                            | Effetto                                                                                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://mcp.supabase.com/mcp`                 | **Accesso completo** all’account: tool **account** (`list_projects`, organizzazioni, costi, ecc.) + DB/storage del progetto che indichi nei tool.                                                                                       |
| `https://mcp.supabase.com/mcp?project_ref=REF` | **Solo quel progetto**: riduce la superficie, ma **disabilita** i tool di gestione account elencati in [documentazione Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp#configuration-options) (project-scoped mode). |

Per “tutto sotto controllo da Cursor” usa l’URL **senza** `project_ref` (config attuale). Se in futuro vuoi solo Live SLIDE CENTER e zero tool account, aggiungi `?project_ref=...` e rimuovi l’esigenza di `list_projects`.

**EN:** Full org/project tooling → base URL + PAT. Scoped-only DB → add `?project_ref=<ref>` (account tools disabled by design).

### Configurazione attuale (stabile): solo PAT

Nel file globale **`C:\Users\andre\.cursor\mcp.json`** il server **`supabase-hosted`** e cosi (nessun segreto nel file):

```json
"supabase-hosted": {
  "type": "http",
  "url": "https://mcp.supabase.com/mcp",
  "headers": {
    "Authorization": "Bearer ${env:SUPABASE_ACCESS_TOKEN}"
  }
}
```

Cursor risolve **`${env:NOME}`** all’avvio (vedi [Config Interpolation](https://developertoolkit.ai/en/cursor-ide/quick-start/mcp-setup/)).

#### Passi (una tantum)

1. **Account** `live.software11@gmail.com` → [Access tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token** (es. `Cursor MCP Live SLIDE CENTER`). Copia il valore (spesso prefisso `sbp_`).
2. **Variabile utente Windows** `SUPABASE_ACCESS_TOKEN` = il PAT (solo questa e obbligatoria per la config sopra).
   - **Consigliato:** `pnpm run setup:supabase-mcp` (script guidato dalla root del repo).
   - GUI: _Impostazioni → Sistema → Informazioni → Impostazioni di sistema avanzate → Variabili d’ambiente_ → **Variabili utente** → Nuovo.
   - Oppure PowerShell: `[Environment]::SetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','incolla_il_PAT','User')` poi **esci del tutto da Cursor** (anche dalla tray) e riapri.
3. **Verifica che Windows veda il token** (PowerShell nuova, fuori da Cursor se serve):

```powershell
[Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
```

Se esce vuoto, la variabile non e impostata a livello **User** o non hai riavviato Cursor dopo averla salvata. Prova anche `pnpm run verify:supabase-mcp`.

4. **Settings → Tools & MCP**: **supabase-hosted** deve risultare connesso (non solo “Needs authentication”). Se resta in auth: controlla Output → **MCP: Supabase** per errori 401 / header mancante.

**Sicurezza:** non committare il PAT. Opzionale: `?read_only=true` sull’URL per query DB solo in lettura.

**Opzionale `SUPABASE_PROJECT_REF`:** non serve piu per l’URL base; conservala per `supabase link` nella CLI o per una seconda entry MCP “solo progetto” se la aggiungi in futuro.

### Alternativa: MCP stdio con `npx`

Se preferisci non usare l’HTTP hosted:

`npx -y @supabase/mcp-server-supabase@latest --project-ref TUO_REF` con env **`SUPABASE_ACCESS_TOKEN`** (stesso PAT).

---

## 2c. Server MCP — Vercel ufficiale (deploy + logs + projects)

A partire da v2.1 il file `C:\Users\andre\.cursor\mcp.json` include il server MCP **`vercel`** ufficiale di Vercel (endpoint hosted con OAuth, supportato ufficialmente per Cursor da agosto 2025).

### Config in `mcp.json` (gia attiva)

```json
"vercel": {
  "type": "http",
  "url": "https://mcp.vercel.com"
}
```

Nessun token / variabile d'ambiente. L'auth e' OAuth via browser.

### Procedura una tantum (dopo riavvio Cursor)

1. **Esci del tutto da Cursor** (anche dalla tray) e riapri.
2. **Settings → Tools & MCP**: la voce **`vercel`** appare con etichetta **"Needs login"**.
3. Click su **Needs login** → si apre il browser → login con `live.software11@gmail.com` (lo stesso account del progetto `live-slide-center`) → Authorize Cursor.
4. Tornato in Cursor, lo stato diventa connesso (lista tool visibile).

### Tool disponibili (selezione utile per SLIDE CENTER)

| Tool                          | Uso operativo                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `list_projects`               | Verificare che `live-slide-center` esista nello scope `livesoftware11-3449s-projects`.              |
| `list_deployments`            | Storico deploy del progetto (production + preview), per capire se l'ultimo push e' stato deployato. |
| `get_deployment`              | Dettagli singolo deploy (status, URL alias, build duration).                                        |
| `get_deployment_build_logs`   | Log build (per debug fallimenti pnpm install / Vite build / postbuild Sentry).                      |
| `get_deployment_runtime_logs` | Log runtime (errori 500, edge functions). Utile post-incidente.                                     |
| `get_project`                 | Settings progetto, framework preset, build command, env vars (nome, non valore).                    |
| `search_documentation`        | Cerca nei docs Vercel direttamente da chat (es. "vercel monorepo build").                           |
| `list_teams`                  | Switch tra scope se in futuro Andrea aggiunge team aziendale.                                       |

### Workflow consigliato post-incidente "deploy non aggiornato"

```
1. Chiedi al MCP vercel: list_deployments per progetto live-slide-center, ultimi 5
   -> verifica readyState e creator (Git vs CLI manuale)

2. Se l'ultimo deploy e' di giorni fa nonostante push recenti:
   -> integrazione GitHub probabilmente disconnessa
   -> apri https://vercel.com/dashboard -> Settings -> Git -> Reconnect

3. Per sblocco rapido senza dashboard:
   -> Vercel CLI: `vercel --prod --yes --archive=tgz` dalla root del monorepo
   (l'archive=tgz e' obbligatorio: il monorepo ha 17k+ file, oltre il limite 15k)
```

### Riferimento procedura completa

Vedi `.cursor/rules/mcp-vercel.mdc` per:

- Naming progetti Vercel per ogni app dell'ecosistema.
- Quando usare CLI vs MCP vs dashboard.
- Cosa fare quando il deploy automatico GitHub e' rotto (= storia 18/04/2026 sera, vedi `STATO_E_TODO.md` §0.26).

---

### Gia configurati nel workspace (verificare siano attivi)

| Server MCP                     | Priorita | Uso per SLIDE CENTER                                                                                                                                                                          |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **supabase-hosted**            | CRITICO  | Query DB, RLS, auth, storage (endpoint ufficiale Supabase MCP)                                                                                                                                |
| **vercel**                     | CRITICO  | Deploy + build logs + projects mgmt (endpoint ufficiale Vercel MCP, OAuth)                                                                                                                    |
| **user-context7**              | ALTO     | Documentazione aggiornata per TUTTE le librerie: React 19, Supabase, Tailwind 4, shadcn/ui, Tauri v2, i18next, Zustand, TanStack, Zod. Usalo SEMPRE prima di scrivere codice con una libreria |
| **user-sequential-thinking**   | ALTO     | Ragionamento step-by-step per task complessi (architettura, debug, sync logic)                                                                                                                |
| **user-GitHub**                | MEDIO    | Operazioni repo, PR, issues, review                                                                                                                                                           |
| **user-npm**                   | MEDIO    | Verificare versioni pacchetti, vulnerabilita, dipendenze                                                                                                                                      |
| **user-duckduckgo-mcp-server** | MEDIO    | Ricerca web per aggiornamenti API, best practices recenti                                                                                                                                     |
| **user-Fetch**                 | MEDIO    | Lettura diretta documentazione online                                                                                                                                                         |
| **user-filesystem**            | BASSO    | Operazioni file cross-progetto (leggere file da Live PLAN per riferimento)                                                                                                                    |

### Workflow MCP consigliato

```
Per QUALSIASI libreria/framework:
1. Prima chiedi a context7 la documentazione aggiornata
2. Poi scrivi il codice
3. Mai fidarsi della memoria — le API cambiano

Per task complessi:
1. Usa sequential-thinking per strutturare il piano
2. Poi esegui step by step

Per debug dati Supabase:
1. Usa **supabase-hosted** (MCP Supabase) per query dirette
2. Verifica RLS con query diverse per tenant

Per debug deploy cloud (live-slide-center.vercel.app):
1. Usa **vercel** MCP -> list_deployments per vedere ultimo deploy + readyState
2. Se fallisce -> get_deployment_build_logs per leggere errori build
3. Se runtime 5xx -> get_deployment_runtime_logs per stack trace

Per ricerche su pattern/best practices:
1. duckduckgo-mcp-server per cercare
2. Fetch per leggere articoli/docs trovati
```

---

## 3. Estensioni VSCode/Cursor raccomandate

### Essenziali

| Estensione                    | ID                          | Uso                            |
| ----------------------------- | --------------------------- | ------------------------------ |
| **Tailwind CSS IntelliSense** | `bradlc.vscode-tailwindcss` | Autocomplete classi Tailwind 4 |
| **ESLint**                    | `dbaeumer.vscode-eslint`    | Lint in tempo reale            |
| **Prettier**                  | `esbenp.prettier-vscode`    | Format on save                 |
| **rust-analyzer**             | `rust-lang.rust-analyzer`   | IDE Rust per Tauri backend     |
| **Tauri**                     | `tauri-apps.tauri-vscode`   | Supporto Tauri v2              |
| **Even Better TOML**          | `tamasfe.even-better-toml`  | Cargo.toml, tauri.conf.json    |

### Raccomandate

| Estensione             | ID                             | Uso                                     |
| ---------------------- | ------------------------------ | --------------------------------------- |
| **SQL Tools**          | `mtxr.sqltools`                | Query PostgreSQL diretto                |
| **SQL Tools Supabase** | Driver PostgreSQL per SQLTools | Connessione a Supabase                  |
| **i18n Ally**          | `Lokalise.i18n-ally`           | Visualizzazione traduzioni inline       |
| **Error Lens**         | `usernamehw.errorlens`         | Errori inline visibili                  |
| **GitLens**            | `eamodio.gitlens`              | Git avanzato (gia configurato come MCP) |
| **Thunder Client**     | `rangav.vscode-thunder-client` | Test API REST (Agent HTTP endpoints)    |

### Configurazione consigliata (`settings.json`)

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "relative",
  "tailwindCSS.experimental.classRegex": [["cn\\(([^)]*)\\)", "'([^']*)'"]],
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  }
}
```

---

## 4. Setup Supabase Locale

### Primo setup

```bash
# 1. Installa Supabase CLI
pnpm add -g supabase

# 2. Login
supabase login

# 3. Dalla root del progetto
cd "C:\Users\andre\Desktop\Andrea Rizzari Live Software\Live SLIDE CENTER"
supabase init

# 4. Avvia DB locale (richiede Docker)
supabase start

# 5. Applica migrations
supabase db push

# 6. Genera types TypeScript
supabase gen types typescript --local > packages/shared/src/types/database.ts
```

### Comandi quotidiani

```bash
supabase start              # Avvia stack locale (PostgreSQL, Auth, Storage, Realtime)
supabase stop               # Ferma stack
supabase db diff            # Mostra differenze schema
supabase db push            # Applica migrations al DB remoto
supabase migration new nome # Crea nuova migration
supabase gen types typescript --local > packages/shared/src/types/database.ts
supabase functions serve    # Dev server Edge Functions
supabase functions deploy   # Deploy Edge Functions
supabase test db            # Esegui test RLS (pgTAP)
```

### Dashboard locale

Dopo `supabase start`, la dashboard e disponibile su `http://localhost:54323`:

- **Table Editor**: visualizza/modifica dati
- **SQL Editor**: esegui query
- **Auth**: gestisci utenti test
- **Storage**: gestisci file
- **Logs**: vedi log Edge Functions

---

## 5. Setup Turborepo

### `pnpm-workspace.yaml` (root)

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### `turbo.json` (root — attuale)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local", ".env"],
  "globalEnv": [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_APP_NAME",
    "VITE_APP_VERSION",
    "VITE_SENTRY_DSN"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "lint:fix": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

### Comandi monorepo

```bash
pnpm run dev          # Avvia tutti i dev server
pnpm run build        # Build tutti i pacchetti
pnpm run lint         # Lint tutti i pacchetti
pnpm run typecheck    # Typecheck tutti i pacchetti

# Filtro per app specifica
pnpm --filter @slidecenter/web dev
pnpm --filter @slidecenter/web typecheck
pnpm --filter @slidecenter/web build
```

---

## 6. Setup Tauri v2 (Local Agent + Room Agent)

### Prerequisiti Windows

```bash
# Visual Studio Build Tools (C++ workload)
winget install Microsoft.VisualStudio.2022.BuildTools

# Rust
winget install Rustlang.Rustup
rustup default stable

# WebView2 (gia incluso in Windows 10/11 recenti)
```

### Dipendenze Rust (Local Agent e Room Agent)

Vedere i rispettivi `Cargo.toml` in `apps/agent/src-tauri/` e `apps/room-agent/src-tauri/` per le dipendenze aggiornate. Stack principale: Tauri v2, Axum (Local Agent HTTP :8080), rusqlite WAL (cache file + room agents), reqwest + tokio (sync engine).

---

## 7. Variabili Ambiente

### `.env.example` (root — aggiornato Fase 14)

```bash
# --- Supabase ---
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# --- App ---
VITE_APP_NAME="Live SLIDE CENTER"
VITE_APP_VERSION=0.0.1

# --- Billing (Lemon Squeezy / Live WORKS APP — Fase 11) ---
# VITE_LEMONSQUEEZY_CHECKOUT_STARTER_URL=
# VITE_LEMONSQUEEZY_CHECKOUT_PRO_URL=
# VITE_LEMONSQUEEZY_CUSTOMER_PORTAL_URL=
# VITE_LIVE_WORKS_APP_URL=https://www.liveworksapp.com

# --- Osservabilita / hardening (Fase 14) ---
# VITE_SENTRY_DSN=
```

**Nota:** `.env` alla root del monorepo. Vite legge da `envDir` configurato in `vite.config.ts`. NON committare `.env`.

---

## 8. Checklist Pre-Sviluppo

- [ ] Node.js 22 LTS installato
- [ ] pnpm installato globalmente
- [ ] Rust + cargo installato (per Tauri)
- [ ] Supabase CLI installata e autenticata
- [ ] Docker Desktop installato e avviato (per `supabase start`)
- [ ] GitHub CLI autenticata (`gh auth status` → live-software11)
- [ ] Vercel CLI autenticata (`vercel whoami` → livesoftware11-3449)
- [ ] Estensioni Cursor installate (Tailwind, ESLint, Prettier, rust-analyzer)
- [ ] MCP servers attivi in Cursor (Supabase, **Vercel**, context7, sequential-thinking)
- [ ] `.env` creato dalla `.env.example` con credenziali reali
- [ ] `supabase start` funziona correttamente
- [ ] Repository git inizializzato e collegato a GitHub
