# Setup Strumenti, MCP e Ambiente — Live SLIDE CENTER

> Guida completa per configurare l'ambiente di sviluppo ottimale.

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

### Opzionali ma raccomandati

| Strumento                     | Uso                                                    |
| ----------------------------- | ------------------------------------------------------ |
| **Docker Desktop**            | `supabase start` usa Docker per DB locale              |
| **Turbo**                     | `pnpm add -g turbo` — CLI Turborepo globale            |
| **Visual Studio Build Tools** | Necessario per compilare moduli Rust nativi su Windows |

---

## 2. Server MCP — Supabase (auth permanente, Aprile 2026)

### Errore `{"message":"Unrecognized client_id"}`

Se durante **Authenticate** su Supabase MCP compare quel JSON nel browser, **non e un errore del tuo account**: e un problema noto del flusso **OAuth** tra Cursor e `mcp.supabase.com` (registrazione `client_id`). Riferimento: [supabase/supabase#43662](https://github.com/supabase/supabase/issues/43662).

**EN:** The hosted MCP OAuth flow can fail with `Unrecognized client_id`; use a **Personal Access Token (PAT)** instead — this is the official Supabase workaround for clients where OAuth is broken.

### Configurazione consigliata (stabile): PAT + `project_ref`

Nel file globale **`C:\Users\andre\.cursor\mcp.json`** il server **`supabase-hosted`** e configurato cosi (senza segreti in chiaro nel JSON):

```json
"supabase-hosted": {
  "type": "http",
  "url": "https://mcp.supabase.com/mcp?project_ref=${env:SUPABASE_PROJECT_REF}",
  "headers": {
    "Authorization": "Bearer ${env:SUPABASE_ACCESS_TOKEN}"
  }
}
```

Cursor risolve **`${env:NOME}`** all’avvio (vedi [Config Interpolation](https://developertoolkit.ai/en/cursor-ide/quick-start/mcp-setup/)).

#### Passi (una tantum)

1. **Account Supabase** `live.software11@gmail.com` → [Access tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token** (es. nome `Cursor MCP Live SLIDE CENTER`). Copia il valore (inizia spesso con `sbp_`).
2. **Project ref**: Dashboard → progetto **live-slide-center** → **Settings → General** → campo **Reference ID** (stringa corta tipo `abcdefghijklmnop` nell’URL `https://supabase.com/dashboard/project/REF`).
3. **Variabili ambiente utente Windows** (consigliato, persistenti dopo riavvio):
   - `SUPABASE_ACCESS_TOKEN` = il PAT
   - `SUPABASE_PROJECT_REF` = il Reference ID
   - Da GUI: _Impostazioni Windows → Sistema → Informazioni → Impostazioni di sistema avanzate → Variabili d’ambiente_ → **Variabili utente** → Nuovo.
   - Oppure da PowerShell (nuova sessione Cursor dopo `setx`):

```powershell
setx SUPABASE_ACCESS_TOKEN "incolla_qui_il_PAT"
setx SUPABASE_PROJECT_REF "incolla_qui_il_project_ref"
```

4. **Chiudi completamente Cursor** e riaprilo (le variabili `setx` non aggiornano i processi gia aperti).
5. **Settings → MCP**: verifica che **supabase-hosted** sia verde / connesso. In chat: _«Elenca le tabelle del database con MCP Supabase»_.

**Sicurezza:** il PAT ha i permessi del tuo account — non committarlo, non metterlo in `.env` del repo se e pubblico. Usa solo variabili utente o un vault. Per ridurre la superficie in produzione si puo aggiungere `&read_only=true` all’URL MCP (solo query read-only).

### Alternativa: MCP stdio con `npx`

Se preferisci non usare l’HTTP hosted:

`npx -y @supabase/mcp-server-supabase@latest --project-ref TUO_REF` con env **`SUPABASE_ACCESS_TOKEN`** (stesso PAT).

### Gia configurati nel workspace (verificare siano attivi)

| Server MCP                     | Priorita | Uso per SLIDE CENTER                                                                                                                                                                          |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **supabase-hosted**            | CRITICO  | Query DB, RLS, auth, storage (endpoint ufficiale Supabase MCP)                                                                                                                                |
| **user-context7**              | ALTO     | Documentazione aggiornata per TUTTE le librerie: React 19, Supabase, Tailwind 4, shadcn/ui, Tauri v2, i18next, Zustand, TanStack, Zod. Usalo SEMPRE prima di scrivere codice con una libreria |
| **user-sequential-thinking**   | ALTO     | Ragionamento step-by-step per task complessi (architettura, debug, sync logic)                                                                                                                |
| **user-GitHub**                | MEDIO    | Operazioni repo, PR, issues, review                                                                                                                                                           |
| **user-npm**                   | MEDIO    | Verificare versioni pacchetti, vulnerabilita, dipendenze                                                                                                                                      |
| **user-duckduckgo-mcp-server** | MEDIO    | Ricerca web per aggiornamenti API, best practices recenti                                                                                                                                     |
| **user-Fetch**                 | MEDIO    | Lettura diretta documentazione online                                                                                                                                                         |
| **user-filesystem**            | BASSO    | Operazioni file cross-progetto (leggere file da Live PLAN per riferimento)                                                                                                                    |

### Da aggiungere (raccomandati)

| Server MCP          | Installazione                                                    | Uso                            |
| ------------------- | ---------------------------------------------------------------- | ------------------------------ |
| **supabase-hosted** | Endpoint ufficiale in `mcp.json` — collega il progetto da Cursor | Management DB, query, RLS test |

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

### `turbo.json` (root)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "typecheck": {}
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
pnpm --filter web dev
pnpm --filter agent dev
pnpm --filter player dev
```

---

## 6. Setup Tauri v2 (Agent + Player)

### Prerequisiti Windows

```bash
# Visual Studio Build Tools (C++ workload)
winget install Microsoft.VisualStudio.2022.BuildTools

# Rust
winget install Rustlang.Rustup
rustup default stable

# WebView2 (gia incluso in Windows 10/11 recenti)
```

### Dipendenze Rust per Agent

```toml
# apps/agent/src-tauri/Cargo.toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-updater = "2"
axum = "0.7"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.31", features = ["bundled"] }
reqwest = { version = "0.12", features = ["json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
mdns-sd = "0.11"
sha2 = "0.10"
```

---

## 7. Variabili Ambiente

### `.env.example` (root)

```bash
# === SUPABASE ===
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_PROJECT_REF=xxxxx

# === CLOUDFLARE R2 (fase scaling) ===
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=live-slide-center
R2_PUBLIC_URL=

# === LEMON SQUEEZY ===
LS_API_KEY=
LS_STORE_ID=
LS_WEBHOOK_SECRET=

# === APP ===
VITE_APP_URL=https://app.liveslidecenter.com
VITE_UPLOAD_MAX_SIZE_BYTES=2147483648
```

---

## 8. Checklist Pre-Sviluppo

- [ ] Node.js 22 LTS installato
- [ ] pnpm installato globalmente
- [ ] Rust + cargo installato (per Tauri)
- [ ] Supabase CLI installata e autenticata
- [ ] Docker Desktop installato e avviato (per `supabase start`)
- [ ] GitHub CLI autenticata (`gh auth status` → live-software11)
- [ ] Estensioni Cursor installate (Tailwind, ESLint, Prettier, rust-analyzer)
- [ ] MCP servers attivi in Cursor (Supabase, context7, sequential-thinking)
- [ ] `.env` creato dalla `.env.example` con credenziali reali
- [ ] `supabase start` funziona correttamente
- [ ] Repository git inizializzato e collegato a GitHub
