# Manuali operatore Live SLIDE CENTER

Cartella che raccoglie i manuali destinati al cliente finale (operatore in regia,
operatore PC sala, IT del cliente). Tutti i documenti sono pensati per essere
convertiti in PDF prima della consegna al cliente.

## Generazione PDF (Sprint 5)

Script PowerShell `build-pdf.ps1` automatizza la conversione MD → PDF via `pandoc`

- `xelatex` (MiKTeX). Output in `docs/Manuali/pdf/` (gitignored).

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

| File                                   | Versione | Pubblico                 | Contenuto                                                                                                                                                                                                     |
| -------------------------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Manuale_Distribuzione.md`             | 0.1.1    | Andrea / IT del cliente  | Procedura interna `clean-and-build.bat` + build con feature `license` + verifica artefatti + checklist consegna licenze (Sprint 4).                                                                           |
| `Manuale_Installazione_Local_Agent.md` | 0.1.1    | Operatore regia          | Installazione mini-PC regia, firewall, autostart, troubleshooting LAN, **attivazione licenza** (Sprint 4) + cambio PC + grace 30gg.                                                                           |
| `Manuale_Installazione_Room_Agent.md`  | 0.1.1    | Operatore PC sala        | Installazione PC sala, pairing, discovery Local Agent, modalita intranet offline, **attivazione licenza** (Sprint 4) + slot per sala.                                                                         |
| `Manuale_Code_Signing.md`              | 1.0      | Andrea (build & release) | **Sprint 5b**: Acquisto cert OV Sectigo (~190 €/anno) + generazione CSR + integrazione `signFileIfConfigured()` in `post-build.mjs` + troubleshooting 8 casi + rinnovo annuale + checklist pre-vendita firma. |
| `Script_Screencast.md`                 | 1.0      | Andrea (registrazione)   | **Sprint 5b**: Scaletta parola-per-parola dei 3 video onboarding (admin web 5-6 min, regia 4-5 min, sala 3-4 min) + setup tecnico (mic, OBS, audio -16 LUFS) + branding + checklist post-registrazione.       |

Aggiornare questi documenti ogni volta che cambia uno dei seguenti file:

- `clean-and-build.bat`, `release-licensed.bat`
- `apps/agent/src-tauri/installer-hooks.nsi`
- `apps/agent/src-tauri/tauri.conf.json`
- `apps/room-agent/src-tauri/installer-hooks.nsi`
- `apps/room-agent/src-tauri/tauri.conf.json`
- `apps/{agent,room-agent}/scripts/post-build.mjs` (layout `release/`, code-signing flow)
- `apps/{agent,room-agent}/src-tauri/src/license/*` (Sprint 4 — flusso attivazione)
- `apps/{agent,room-agent}/ui/index.html` sezione `#license-card` o `#license-overlay`
- Cambio versione cert (rinnovo annuale Sectigo) → aggiornare sez. 8 di `Manuale_Code_Signing.md`
- Cambio UI rilevante → ri-registrare screencast con suffisso `-v2` (vedi `Script_Screencast.md` § Versionamento)
