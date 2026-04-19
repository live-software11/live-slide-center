# Documentazione Live SLIDE CENTER — Indice canonico

> Mappa navigabile di tutta la documentazione del progetto, organizzata per topic.
>
> **Ultima revisione:** 19 aprile 2026 (post Sprint W + Sentry + workspace cleanup + docs overhaul).
> **Aggiornare:** ogni volta che si crea, sposta, archivia o elimina un documento in `docs/`.

---

## Per topic — cerca cosa ti serve

### Devi capire **cosa fa** il prodotto e **com'e' fatto**

| Domanda                                                | Documento                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Cosa e' Live SLIDE CENTER? Quali sono i casi d'uso?    | [`ARCHITETTURA_LIVE_SLIDE_CENTER.md`](./ARCHITETTURA_LIVE_SLIDE_CENTER.md) (UNICA fonte di verita) |
| Quali tabelle Postgres? Quali Edge Functions? Quali RLS? | `ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 12-17                                |
| Architettura desktop Tauri 2 + LAN + mDNS?             | `ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 4-5 + § 11                           |
| Storia degli sprint (cosa e' stato fatto e quando)?    | `ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22                                   |
| Storia estesa sprint 0.1→0.29 (audit chirurgico, AU-01..09, Sprint W) | [`_archive/STATO_E_TODO_storia_sprint_0.1-0.29.md`](./_archive/STATO_E_TODO_storia_sprint_0.1-0.29.md) (read-only) |

### Devi sapere **cosa resta da fare**

| Domanda                                                 | Documento                                            |
| ------------------------------------------------------- | ---------------------------------------------------- |
| Cosa devo finire prima del primo evento live?           | [`STATO_E_TODO.md`](./STATO_E_TODO.md) § 1-2         |
| Sprint Q (sync hybrid cloud<->desktop) GO o NO-GO?     | `STATO_E_TODO.md` § 4 (framework decisionale)        |
| Field test desktop come pianificarlo?                   | `STATO_E_TODO.md` § 3 (procedura T-2 / T-1 / T / T+1) |
| Backlog vendite, legale, marketing pending?             | `STATO_E_TODO.md` § 5-7 + `Commerciale/README.md`    |

### Devi **configurare l'ambiente di sviluppo**

| Domanda                                                  | Documento                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| Quali tool installare? Node, pnpm, Rust, Tauri, Supabase CLI? | [`Setup_Strumenti_e_MCP.md`](./Setup_Strumenti_e_MCP.md) § 1 |
| Come configuro MCP Supabase / Vercel su Cursor?          | `Setup_Strumenti_e_MCP.md` § 2 + `2c`                           |
| Quali variabili `.env` servono?                          | `Setup_Strumenti_e_MCP.md` § 3 + `.env.example` (root)          |

### Devi **lavorare con un AI assistant** (Claude Desktop / Cursor agent)

| Domanda                                                | Documento                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Prompt di avvio per Claude Desktop?                    | [`Istruzioni_Claude_Desktop.md`](./Istruzioni_Claude_Desktop.md) § PROMPT DI AVVIO |
| Quando usare Claude Desktop vs Cursor agent?            | `Istruzioni_Claude_Desktop.md` § Divisione del lavoro         |
| Format atteso per `PLAN_*.md` di Claude Desktop?       | `Istruzioni_Claude_Desktop.md` § Formato output               |
| Mappa rapida progetto per AI (account, stack, comandi)?| [`../CLAUDE.md`](../CLAUDE.md) (root del repo)                 |
| Regole AI vincolanti (sempre attive su Cursor)?         | [`../.cursor/rules/`](../.cursor/rules/) (15 file `.mdc`)     |

### Devi **gestire un'emergenza** o **fare backup/restore**

| Domanda                                              | Documento                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| Il deploy Vercel e' rotto, come faccio rollback?     | [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) § Scenario 1   |
| Devo ripristinare Postgres a un punto precedente?    | `DISASTER_RECOVERY.md` § Scenario 2 (PITR Supabase)             |
| Edge Function critica giu' / latenza alta cold-start?| `DISASTER_RECOVERY.md` § Scenario 3 + Appendice warm-keep cron-job.org |
| Setup Sentry da zero (DSN, MCP, env vars)?           | `DISASTER_RECOVERY.md` § Setup Sentry                           |
| Workspace troppo grande? Pulizia artefatti?          | `DISASTER_RECOVERY.md` § Workspace cleanup                      |

### Devi **eseguire un evento live** (field test o produzione)

| Domanda                                              | Documento                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Checklist completa pre-evento + smoke E2E?           | [`FIELD_TEST_CHECKLIST.md`](./FIELD_TEST_CHECKLIST.md)     |
| Credenziali tenant/utenti/evento/sala demo?          | [`FIELD_TEST_CREDENTIALS.md`](./FIELD_TEST_CREDENTIALS.md) |
| Cosa fare se un PC sala va offline durante l'evento? | `DISASTER_RECOVERY.md` § Scenario 4                        |

### Devi **installare il prodotto** sul cliente o sul tuo PC

| Domanda                                                  | Documento                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Come installo Centro Slide Desktop (Tauri 2 unificato)?  | [`Manuali/Manuale_Centro_Slide_Desktop.md`](./Manuali/Manuale_Centro_Slide_Desktop.md) Parte A |
| Come faccio smoke test pre-release del desktop?          | `Manuali/Manuale_Centro_Slide_Desktop.md` Parte B                               |
| Come distribuisco l'installer firmato al cliente?        | [`Manuali/Manuale_Distribuzione.md`](./Manuali/Manuale_Distribuzione.md)        |
| Setup Tauri 1 legacy (Local Agent + Room Agent)?         | [`Manuali/Manuale_Installazione_Local_Agent.md`](./Manuali/Manuale_Installazione_Local_Agent.md) + [`Manuali/Manuale_Installazione_Room_Agent.md`](./Manuali/Manuale_Installazione_Room_Agent.md) (LEGACY) |
| Come acquisto e configuro il code-signing certificate?   | [`Manuali/Manuale_Code_Signing.md`](./Manuali/Manuale_Code_Signing.md)          |
| Setup Resend per email transazionali?                    | [`Manuali/Manuale_Email_Resend.md`](./Manuali/Manuale_Email_Resend.md)          |

### Devi **fare onboarding di un cliente o team interno**

| Domanda                                                  | Documento                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Wizard primo accesso admin tenant cloud?                  | [`Manuali/Manuale_Onboarding_Admin.md`](./Manuali/Manuale_Onboarding_Admin.md)  |
| Procedura quotidiana operativa per team DHS interno?     | [`Manuali/Guida_Uso_Interno_DHS.md`](./Manuali/Guida_Uso_Interno_DHS.md)        |
| Scaletta dei 3 video onboarding (admin/regia/sala)?      | [`Manuali/Script_Screencast.md`](./Manuali/Script_Screencast.md)                |

### Devi **vendere** (commerciale + legale)

| Domanda                                                  | Documento                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Indice generale + decisioni urgenti pre-primo cliente?   | [`Commerciale/README.md`](./Commerciale/README.md)                       |
| Listino piani SaaS (Trial / Starter / Pro / Enterprise)? | [`Commerciale/Listino_Prezzi.md`](./Commerciale/Listino_Prezzi.md)       |
| Bozza SLA tecnica (uptime, RPO/RTO, supporto)?           | [`Commerciale/Contratto_SLA.md`](./Commerciale/Contratto_SLA.md)         |
| 47 voci pending vendita esterna (legale, marketing)?      | [`Commerciale/Roadmap_Vendita_Esterna.md`](./Commerciale/Roadmap_Vendita_Esterna.md) |

---

## Mappa fisica `docs/`

```
docs/
├── README.md                                # questo file (indice canonico)
├── ARCHITETTURA_LIVE_SLIDE_CENTER.md        # FONTE UNICA DI VERITA (cosa e'/com'e' fatto + sprint history)
├── STATO_E_TODO.md                          # FONTE UNICA TO-DO (cosa resta da fare)
├── DISASTER_RECOVERY.md                     # backup, restore, Sentry, warm-keep, workspace cleanup
├── FIELD_TEST_CHECKLIST.md                  # checklist pre-evento + smoke E2E
├── FIELD_TEST_CREDENTIALS.md                # credenziali tenant/utenti demo
├── Setup_Strumenti_e_MCP.md                 # setup ambiente sviluppo
├── Istruzioni_Claude_Desktop.md             # prompt + workflow per AI assistant
│
├── Manuali/
│   ├── README.md                            # indice manuali + matrice ruolo→manuale
│   ├── Manuale_Centro_Slide_Desktop.md      # Tauri 2 unificato (Setup + Smoke Test)
│   ├── Manuale_Onboarding_Admin.md          # wizard primo accesso cloud
│   ├── Manuale_Distribuzione.md             # build + firma + delivery installer
│   ├── Manuale_Code_Signing.md              # cert OV Sectigo + integrazione build
│   ├── Manuale_Email_Resend.md              # setup Resend + cron schedulazioni
│   ├── Script_Screencast.md                 # scaletta 3 video onboarding
│   ├── Guida_Uso_Interno_DHS.md             # procedure operative team DHS
│   ├── Manuale_Installazione_Local_Agent.md # LEGACY Tauri 1 (regia)
│   ├── Manuale_Installazione_Room_Agent.md  # LEGACY Tauri 1 (PC sala)
│   └── build-pdf.ps1                        # script PowerShell per esportare in PDF (pandoc + xelatex)
│
├── Commerciale/
│   ├── README.md                            # indice + decisioni urgenti pre-primo cliente
│   ├── Listino_Prezzi.md                    # 4 piani SaaS + bundle desktop
│   ├── Contratto_SLA.md                     # bozza SLA (rivedere con avvocato)
│   ├── Roadmap_Vendita_Esterna.md           # 47 voci pending (legale, marketing, fiscale)
│   └── SlideHub_Live_Commerciale.docx       # documento commerciale executive Word
│
└── _archive/                                # storici read-only (NON usare come fonte di verita)
    ├── README.md                            # spiega lo scopo dell'archive + tabella contenuto
    ├── AUDIT_FINALE_E_PIANO_TEST_v1.md      # audit Sprint A→T-3 chiuso
    ├── QA_FIX_REPORT_2026-04-18.md          # tutti i fix elencati gia' applicati
    ├── SPRINT_W_CLOSURE_REPORT.md           # Sprint W chiuso, contenuto consolidato in ARCHITETTURA § 22
    └── STATO_E_TODO_storia_sprint_0.1-0.29.md # sprint 0.1→0.29 (storico DONE) tagliato da STATO_E_TODO.md
```

## Regole d'oro per la documentazione

1. **In conflitto vince sempre `ARCHITETTURA_LIVE_SLIDE_CENTER.md`.** Tutti gli altri doc devono essere coerenti con questo.
2. **Per cose da fare: solo `STATO_E_TODO.md`.** NON creare nuovi `TODO_*.md` sparsi nei vari moduli.
3. **Sprint chiusi vanno in `_archive/`** dopo aver consolidato il contenuto in `ARCHITETTURA § 22`. Vedi `_archive/README.md` per la regola completa.
4. **Manuali user-facing** (Manuali/) restano file separati per facilitare la generazione PDF e la consegna al cliente.
5. **Commerciale** (Commerciale/) e' separato perche' ha versioning indipendente (cambia con l'andamento delle vendite, non con il rilascio del software).
6. **`README.md`** in ogni sottocartella spiega cosa contiene + quando aggiornare.
7. **Quando archivi un doc:** aggiungi sempre una riga in `_archive/README.md` con file, data, motivo, sostituito da.
8. **Quando crei un nuovo doc canonico:** aggiungi sempre una riga in questo `README.md` (indice) + (se applicabile) in `Setup_Strumenti_e_MCP.md` § 0.

## Storia overhaul docs

- **2026-04-19** — Sprint W docs overhaul: 29 doc → 14 canonici + `_archive/` (5 storici). Merge: `Setup_PC_Centro_Slide.md` + `Smoke_Test_Centro_Slide.md` → `Manuali/Manuale_Centro_Slide_Desktop.md`. Merge: `EDGE_FUNCTIONS_WARM_KEEP.md` → appendice `DISASTER_RECOVERY.md`. Snellito `STATO_E_TODO.md` 304 KB → 37 KB (-88%) tagliando § 0 (sprint 0.1→0.29) ad archive. Nuovo `docs/README.md` indice canonico. Aggiornati: `CLAUDE.md` (600→240 righe), `ARCHITETTURA § 17` (11→26 EF), `ARCHITETTURA § 22` (Sprint W + AU-01..09 + U-1..U-7 + D1..D8 + Operations post-Sprint W), `Setup_Strumenti_e_MCP.md § 0`, `Istruzioni_Claude_Desktop.md`, `Manuali/README.md`, `Manuali/Manuale_Distribuzione.md`, banner LEGACY su 2 manuali Tauri 1, URL prod su `FIELD_TEST_CHECKLIST.md` + `FIELD_TEST_CREDENTIALS.md`. Eliminati: `.commit-msg.txt`, `COMMIT_MSG_TMP.txt`, `Setup_PC_Centro_Slide.md`, `Smoke_Test_Centro_Slide.md`, `EDGE_FUNCTIONS_WARM_KEEP.md`. Aggiornate 8 `.cursor/rules/*.mdc`.
