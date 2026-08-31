# Documentazione Live SLIDE CENTER — Indice

> Mappa navigabile. I file stanno nelle cartelle canoniche Live Software (Andrea, 23/08/2026).
>
> **Ultima revisione:** 31 agosto 2026 — reorg `docs/` (niente codice prodotto).
> **In conflitto vince** [`architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md`](./architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md).

Entry-point agenti: [`../AGENTS.md`](../AGENTS.md) · sintesi Claude Code: [`../CLAUDE.md`](../CLAUDE.md) · regole: [`../.cursor/rules/`](../.cursor/rules/) (`docs-structure.mdc` = layout).

---

## Per topic

### Cosa fa il prodotto e com'è fatto

| Domanda | Documento |
| ------- | --------- |
| Cos'è Live SLIDE CENTER? Casi d'uso, stack, tre modalità | [`architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md`](./architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md) (fonte unica) |
| Tabelle Postgres, Edge Functions, RLS | stesso file § 12–17 |
| Desktop Tauri 2 + LAN + mDNS | stesso file § 4–5 + § 11 |
| Storia sprint (sintesi) | stesso file § 22 |
| Storia estesa sprint 0.1→0.29 | [`archivio/STATO_E_TODO_storia_sprint_0.1-0.29.md`](./archivio/STATO_E_TODO_storia_sprint_0.1-0.29.md) (read-only) |

### Cosa resta da fare

| Domanda | Documento |
| ------- | --------- |
| Prima del prossimo evento live | [`implementazioni-future/STATO_E_TODO.md`](./implementazioni-future/STATO_E_TODO.md) § 1–2 |
| Sprint Q (sync hybrid) GO o NO-GO | stesso file § 4 |
| Field test desktop (T-2 / T-1 / T / T+1) | stesso file § 3 |
| Backlog vendite / legale / marketing | stesso file § 5–7 + [`commerciali/README.md`](./commerciali/README.md) |

### Ambiente di sviluppo

| Domanda | Documento |
| ------- | --------- |
| Node, pnpm, Rust, Tauri, Supabase CLI | [`operazioni/Setup_Strumenti_e_MCP.md`](./operazioni/Setup_Strumenti_e_MCP.md) § 1 |
| MCP Supabase / Vercel su Cursor | stesso file § 2 + `2c` |
| Variabili `.env` | stesso file § 3 + `.env.example` in root (non committare secret) |

### AI assistant (Claude Desktop / Cursor / Codex / Continue)

| Domanda | Documento |
| ------- | --------- |
| Entry-point standard 2026 | [`../AGENTS.md`](../AGENTS.md) |
| Prompt di avvio Claude Desktop | [`agenti/Istruzioni_Claude_Desktop.md`](./agenti/Istruzioni_Claude_Desktop.md) |
| Cursor vs Claude Desktop | stesso file, sezione divisione del lavoro |

### Emergenza, backup, Sentry

| Domanda | Documento |
| ------- | --------- |
| Deploy Vercel rotto / PITR Postgres / Edge Fn giù | [`operazioni/DISASTER_RECOVERY.md`](./operazioni/DISASTER_RECOVERY.md) |
| Setup Sentry (progetto esistente, non crearne uno nuovo) | stesso file, Setup Sentry |
| Pulizia workspace | stesso file, Workspace cleanup |

### Evento live (field test o produzione)

| Domanda | Documento |
| ------- | --------- |
| Checklist pre-evento + smoke E2E | [`operazioni/FIELD_TEST_CHECKLIST.md`](./operazioni/FIELD_TEST_CHECKLIST.md) |
| Credenziali demo | [`operazioni/FIELD_TEST_CREDENTIALS.md`](./operazioni/FIELD_TEST_CREDENTIALS.md) (pattern + email `@fieldtest.local`; **niente tabella password**) |
| PC sala offline durante l'evento | [`operazioni/DISASTER_RECOVERY.md`](./operazioni/DISASTER_RECOVERY.md) Scenario 4 |

### Installazione, firma, email, onboarding

| File | Pubblico | Contenuto |
| ---- | -------- | --------- |
| [`operazioni/Manuale_Centro_Slide_Desktop.md`](./operazioni/Manuale_Centro_Slide_Desktop.md) | IT cliente / Andrea | Tauri 2 unificato: setup (A) + smoke pre-release (B) |
| [`operazioni/Manuale_Onboarding_Admin.md`](./operazioni/Manuale_Onboarding_Admin.md) | Admin tenant cloud | Wizard primo accesso |
| [`operazioni/Manuale_Distribuzione.md`](./operazioni/Manuale_Distribuzione.md) | Andrea / IT cliente | Build + firma + consegna installer |
| [`operazioni/Manuale_Code_Signing.md`](./operazioni/Manuale_Code_Signing.md) | Andrea | Cert OV Sectigo + `signtool` |
| [`operazioni/Manuale_Email_Resend.md`](./operazioni/Manuale_Email_Resend.md) | Andrea | Resend + cron email |
| [`operazioni/Script_Screencast.md`](./operazioni/Script_Screencast.md) | Andrea | 3 video onboarding |
| [`operazioni/Guida_Uso_Interno_DHS.md`](./operazioni/Guida_Uso_Interno_DHS.md) | Team DHS | Checklist operativa interna |
| [`operazioni/Manuale_Installazione_Local_Agent.md`](./operazioni/Manuale_Installazione_Local_Agent.md) | LEGACY Tauri 1 | Mini-PC regia (non per nuove installazioni) |
| [`operazioni/Manuale_Installazione_Room_Agent.md`](./operazioni/Manuale_Installazione_Room_Agent.md) | LEGACY Tauri 1 | PC sala (non per nuove installazioni) |

PDF: [`strumenti/build-pdf.ps1`](./strumenti/build-pdf.ps1) (`pandoc` + `xelatex`; output `strumenti/pdf/`, gitignored).

Matrice ruolo → manuale: Andrea build/release → Distribuzione + Code Signing; IT cliente → Centro Slide Desktop Parte A; admin SaaS → Onboarding Admin; operatori → Centro Slide Desktop (legacy: i due Agent); DHS → Guida uso interno.

### Commerciale e legale

| File | Stato | Contenuto |
| ---- | ----- | --------- |
| [`commerciali/README.md`](./commerciali/README.md) | indice | Decisioni urgenti pre-primo cliente + schema DPA |
| [`commerciali/Listino_Prezzi.md`](./commerciali/Listino_Prezzi.md) | bozza | 4 piani SaaS + bundle desktop |
| [`commerciali/Contratto_SLA.md`](./commerciali/Contratto_SLA.md) | bozza legale | Uptime, RPO/RTO, supporto |
| [`commerciali/Roadmap_Vendita_Esterna.md`](./commerciali/Roadmap_Vendita_Esterna.md) | Andrea | 47 voci pending |
| [`commerciali/SlideHub_Live_Commerciale.docx`](./commerciali/SlideHub_Live_Commerciale.docx) | Word | Executive commerciale (non convertire) |

### Archivio (read-only)

| File | Perché è qui |
| ---- | ------------ |
| [`archivio/README.md`](./archivio/README.md) | Regola di archiviazione |
| [`archivio/AUDIT_FINALE_E_PIANO_TEST_v1.md`](./archivio/AUDIT_FINALE_E_PIANO_TEST_v1.md) | Audit Sprint A→T-3 chiuso |
| [`archivio/QA_FIX_REPORT_2026-04-18.md`](./archivio/QA_FIX_REPORT_2026-04-18.md) | Fix già applicati |
| [`archivio/SPRINT_W_CLOSURE_REPORT.md`](./archivio/SPRINT_W_CLOSURE_REPORT.md) | Sprint W chiuso |
| [`archivio/STATO_E_TODO_storia_sprint_0.1-0.29.md`](./archivio/STATO_E_TODO_storia_sprint_0.1-0.29.md) | Sprint 0.1→0.29 tagliati da STATO_E_TODO |

---

## Mappa fisica

```
docs/
├── README.md                          # questo indice
├── architettura/
│   └── ARCHITETTURA_LIVE_SLIDE_CENTER.md
├── operazioni/                        # manuali + runbook + setup
├── implementazioni-future/
│   └── STATO_E_TODO.md
├── agenti/
│   └── Istruzioni_Claude_Desktop.md
├── commerciali/                       # kebab, non Commerciale/
├── archivio/                          # ex _archive + stub credenziali
└── strumenti/
    └── build-pdf.ps1
```

Root resta: `AGENTS.md`, `CLAUDE.md`, `package.json`, `apps/`, `packages/`, `supabase/`.

---

## Regole d'oro

1. In conflitto vince `architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md`.
2. Cose da fare: solo `implementazioni-future/STATO_E_TODO.md`.
3. Sprint chiusi → `archivio/` dopo consolidamento in ARCHITETTURA § 22.
4. Layout cartelle: `.cursor/rules/docs-structure.mdc` (alwaysApply).
5. Niente password / DSN / `.env` in git.

## Storia overhaul

- **2026-08-31** — Reorg layout canonico Live Software: `architettura/`, `operazioni/`, `implementazioni-future/`, `agenti/`, `commerciali/`, `archivio/`, `strumenti/`. Fuse l'indice `Manuali/README.md` in questo file. Credenziali field test svuotate (stub in archivio). Niente codice prodotto.
- **2026-05-06** — `AGENTS.md` entry-point; ARCHITETTURA v6.1 (Sprint XY licensing v3).
- **2026-04-19** — Sprint W: 29 doc → 14 canonici + archive; merge Setup/Smoke Centro Slide e warm-keep in DR.
