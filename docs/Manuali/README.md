# Manuali operatore Live SLIDE CENTER

Cartella che raccoglie i manuali destinati al cliente finale (operatore in regia, operatore PC sala, IT del cliente, admin tenant SaaS) e gli script di build/firma. Tutti i documenti sono pensati per essere convertiti in PDF prima della consegna al cliente.

> **Versione catalogo:** 2.0 — 19 aprile 2026 (post Sprint W + docs overhaul + nuovo `Manuale_Centro_Slide_Desktop.md`).

## Generazione PDF

Script PowerShell `build-pdf.ps1` automatizza la conversione MD → PDF via `pandoc` + `xelatex` (MiKTeX). Output in `docs/Manuali/pdf/` (gitignored).

```powershell
# Una volta sola: installazione toolchain
winget install --id JohnMacFarlane.Pandoc -e
winget install --id MiKTeX.MiKTeX -e

# Ad ogni release verso il cliente:
cd docs\Manuali
.\build-pdf.ps1
```

Comando manuale equivalente (singolo file):

```powershell
pandoc Manuale_Distribuzione.md -o Manuale_Distribuzione.pdf --pdf-engine=xelatex --toc
```

## Catalogo manuali (canonici aprile 2026)

### Manuali attivi (Tauri 2 + cloud SaaS)

| File                              | Versione | Pubblico                 | Contenuto                                                                                                                                                                                                                                          |
| --------------------------------- | -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Manuale_Centro_Slide_Desktop.md` | 1.0      | IT cliente / Andrea      | **CANONICO Tauri 2 unificato** (Sprint J-W). Setup PC Centro Slide (Parte A) + smoke test pre-release (Parte B). Sostituisce i due manuali legacy `Local_Agent` + `Room_Agent`.                                                                    |
| `Manuale_Onboarding_Admin.md`     | 1.0      | Admin tenant cloud       | Wizard primo accesso (welcome / primo evento o demo / finish), uso "Dati demo" da Settings, "Riapri tour", inviti team, installazione desktop, healthcheck.                                                                                        |
| `Manuale_Distribuzione.md`        | 0.1.1+   | Andrea / IT del cliente  | Procedura interna build + firma + verifica artefatti + checklist consegna licenze. Contiene sia `clean-and-build.bat` (Tauri 1 legacy) che `apps/desktop/scripts/release.ps1` (Tauri 2 attuale).                                                   |
| `Manuale_Code_Signing.md`         | 1.0      | Andrea (build & release) | Acquisto cert OV Sectigo (~190 €/anno) + generazione CSR + integrazione `signFileIfConfigured()` in `post-build.mjs` + troubleshooting 8 casi + rinnovo annuale + checklist pre-vendita firma.                                                     |
| `Manuale_Email_Resend.md`         | 1.0      | Andrea (build & release) | Configurazione Resend (account, dominio, API key) + secret Supabase Edge + deploy `email-send` / `email-cron-licenses` / `gdpr-export` / `email-cron-desktop-tokens` + schedulazione cron T-30/7/1 (GitHub Actions / cron-job.org) + troubleshooting. |
| `Script_Screencast.md`            | 1.0      | Andrea (registrazione)   | Scaletta parola-per-parola dei 3 video onboarding (admin web 5-6 min, regia 4-5 min, sala 3-4 min) + setup tecnico (mic, OBS, audio -16 LUFS) + branding + checklist post-registrazione.                                                            |
| `Guida_Uso_Interno_DHS.md`        | 1.0      | Andrea + team DHS        | Quick start operativo per uso interno DHS — checklist setup una tantum, pre-evento (T-7/T-1), giorno evento, post-evento, manutenzione settimanale/mensile, troubleshooting comune, do/don't.                                                      |

### Manuali legacy (Tauri 1 — `apps/agent` + `apps/room-agent`)

> **Stato:** mantenuti per clienti che hanno ancora installato il setup tradizionale a 2 binari separati (Local Agent + Room Agent). Per nuove installazioni usare `Manuale_Centro_Slide_Desktop.md` con `apps/desktop` Tauri 2 unificato.

| File                                   | Versione | Pubblico          | Note legacy                                                                                                                       |
| -------------------------------------- | -------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Manuale_Installazione_Local_Agent.md` | 0.1.1    | Operatore regia   | LEGACY Tauri 1. Installazione mini-PC regia, firewall, autostart, attivazione licenza, cambio PC + grace 30gg.                    |
| `Manuale_Installazione_Room_Agent.md`  | 0.1.1    | Operatore PC sala | LEGACY Tauri 1. Installazione PC sala, pairing, discovery Local Agent, modalita intranet offline, attivazione licenza per sala.   |

### Matrice ruolo → manuale (suggerito)

| Ruolo                    | Manuale primario                                                                                | Manuali complementari                              |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Andrea (build/release)** | `Manuale_Distribuzione.md` + `Manuale_Code_Signing.md`                                        | `Manuale_Email_Resend.md`, `Script_Screencast.md`  |
| **IT cliente (setup)**   | `Manuale_Centro_Slide_Desktop.md` (Parte A — Setup) — oppure `Manuale_Installazione_Local_Agent.md` se setup legacy 2-binari | `Manuale_Distribuzione.md`                         |
| **Admin tenant SaaS**    | `Manuale_Onboarding_Admin.md`                                                                  | —                                                  |
| **Operatore regia/sala** | `Manuale_Centro_Slide_Desktop.md` — oppure `Manuale_Installazione_Room_Agent.md` se legacy     | —                                                  |
| **Team interno DHS**     | `Guida_Uso_Interno_DHS.md`                                                                     | Tutti i sopra                                      |

## Quando aggiornare i manuali

Aggiornare questi documenti ogni volta che cambia uno dei seguenti file:

- `apps/desktop/scripts/release.ps1`, `apps/desktop/scripts/release.mjs` (Tauri 2 attuale)
- `apps/desktop/src-tauri/installer-hooks.nsi`, `apps/desktop/src-tauri/tauri.conf.json` (Tauri 2 attuale)
- `clean-and-build.bat`, `release-licensed.bat` (Tauri 1 legacy)
- `apps/{agent,room-agent}/src-tauri/installer-hooks.nsi`, `tauri.conf.json` (Tauri 1 legacy)
- `apps/{agent,room-agent}/scripts/post-build.mjs` (layout `release/`, code-signing flow)
- `apps/{desktop,agent,room-agent}/src-tauri/src/license/*` (flusso attivazione)
- `apps/{desktop,agent,room-agent}/ui/index.html` sezione `#license-card` o `#license-overlay`
- Cambio versione cert (rinnovo annuale Sectigo) → aggiornare sez. 8 di `Manuale_Code_Signing.md`
- Cambio UI rilevante → ri-registrare screencast con suffisso `-v2` (vedi `Script_Screencast.md` § Versionamento)
- Sprint W follow-up: aggiornata pipeline `clean-and-build.bat` (vedi `docs/Istruzioni_Claude_Desktop.md` § Build & release).

Per dettagli architetturali su `apps/desktop` (Tauri 2 unificato) vs `apps/agent` + `apps/room-agent` (Tauri 1 legacy), consultare `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 4 + § 5.
