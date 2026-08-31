# Manuale Distribuzione — Live SLIDE CENTER

> Pubblico: Andrea (CTO) e IT del cliente che riceve il pacchetto.
> Versione: 1.0 — 19 aprile 2026 (Sprint W: aggiunto flusso Tauri 2 `apps/desktop` accanto al legacy Tauri 1).

## 1. Toolchain di build (una volta sola sul PC di sviluppo)

| Strumento      | Versione minima | Comando installazione                               |
| -------------- | --------------- | --------------------------------------------------- |
| Node.js LTS    | 22+             | `winget install OpenJS.NodeJS.LTS`                  |
| pnpm           | 9.x             | `npm install -g pnpm`                               |
| Rust toolchain | stable          | https://rustup.rs/                                  |
| Tauri CLI v2   | 2.10+           | `cargo install tauri-cli --version "^2.0" --locked` |

Verifica:

```powershell
node --version    # >= v22
pnpm --version    # >= 9
cargo --version   # qualsiasi stable
cargo tauri --version  # 2.10+
```

## 2. Build artefatti di distribuzione

Esistono **due flussi paralleli**: il Centro Slide Desktop unificato (Tauri 2, attuale) e gli agent storici (Tauri 1, legacy).

### 2.0 Tauri 2 unificato `apps/desktop` (FLUSSO ATTUALE)

Per nuove installazioni Centro Slide. Single binary che fa sia regia che PC sala (modalita scelta al primo boot).

```powershell
# Wrapper PowerShell user-friendly (raccomandato)
apps/desktop/scripts/release.ps1 -Signed

# Comando manuale equivalente
pnpm --filter @slidecenter/desktop release:nsis
```

Output: `apps/desktop/src-tauri/target/release/bundle/nsis/Live SLIDE CENTER Desktop_<version>_x64-setup.exe` (~10-15 MB, code-signed se `CERT_PFX_PATH` + `CERT_PASSWORD` env vars sono settate).

Per il manuale di installazione e smoke test del Centro Slide Desktop unificato vedi `Manuale_Centro_Slide_Desktop.md` (Parte A Setup + Parte B Smoke Test).

### 2.1 Tauri 1 legacy (Local Agent + Room Agent separati)

Per clienti gia' installati con il setup tradizionale a 2 binari. Doppio click sulla root del repo:

```
clean-and-build.bat
```

Lo script esegue 6 step:

1. Verifica toolchain (Node, pnpm, cargo, cargo-tauri).
2. `pnpm install --frozen-lockfile` (fallback senza lockfile se necessario).
3. Pulisce `release/`.
4. Build Local Agent: `pnpm --filter @slidecenter/agent-build run release:full`.
5. Build Room Agent: `pnpm --filter @slidecenter/room-agent-build run release:full`.
6. Verifica esistenza dei 6 file di output e stampa riepilogo.

> **Follow-up Sprint W (19 apr 2026):** lo script `clean-and-build.bat` e i due `package.json` legacy sono stati aggiornati a Tauri CLI 2.10 (rimosso `--manifest-path` deprecato) e a `installer-hooks.nsi` con backtick come delimitatore esterno (fix `ExecWait expects 1-2 parameters`). Build end-to-end verificato 19/04/2026 (6 artefatti Local Agent + Room Agent ~5-7 MB ciascuno).

### 2.1 Build CON sistema licenze (vendita)

Per produrre artefatti che richiedono attivazione su Live WORKS APP, builda
con la **Cargo feature opzionale `license`**:

```powershell
cd apps\agent\src-tauri
cargo tauri build --features license
cd ..\..\room-agent\src-tauri
cargo tauri build --features license
```

Differenze rispetto al build di sviluppo:

| Aspetto                     | `cargo tauri build` (default) | `--features license`                      |
| --------------------------- | ----------------------------- | ----------------------------------------- |
| Modulo Rust `src/license/`  | Compilato come no-op stub     | Compilato con AES-GCM + WMI + reqwest     |
| Comandi Tauri `license_*`   | Non registrati                | Registrati e invocabili dalla UI          |
| Card "Licenza" nella UI     | Nascosta automaticamente      | Visibile + overlay full-screen di gating  |
| Avvio app senza chiave      | Avvio normale                 | Bloccato: solo card "Attivazione licenza" |
| Dipendenze extra in binario | Nessuna                       | `aes-gcm`, `wmi`, `windows`               |

**`clean-and-build.bat` lancia il build di sviluppo** (default, senza feature
`license`). Per il build di vendita usa lo script Tauri direttamente o un
prossimo `release-licensed.bat` (in arrivo Sprint 5 con code-signing).

Tempi attesi (Win 11 / Ryzen 5 / 32 GB RAM):

| Tipo build         | Local Agent | Room Agent | Totale |
| ------------------ | ----------- | ---------- | ------ |
| Prima compilazione | 6-12 min    | 4-8 min    | 10-20  |
| Build incrementale | 1-2 min     | 1-2 min    | 2-4    |

## 3. Layout output `release/`

```
release/
├── live-slide-center-agent/
│   ├── Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe        # NSIS installer (regia)
│   ├── Live-SLIDE-CENTER-Agent-Portable-0.1.0.zip     # Portable ZIP (rescue / no-install)
│   └── SHA256SUMS.txt                                 # Hash anti-tamper
└── live-slide-center-room-agent/
    ├── Live-SLIDE-CENTER-Room-Agent-Setup-0.1.0.exe   # NSIS installer (PC sala)
    ├── Live-SLIDE-CENTER-Room-Agent-Portable-0.1.0.zip
    └── SHA256SUMS.txt
```

## 4. Differenza Setup vs Portable

| Caratteristica          | NSIS Setup `.exe`                                             | Portable `.zip`                 |
| ----------------------- | ------------------------------------------------------------- | ------------------------------- |
| Installazione           | Si (in `%LOCALAPPDATA%\...`)                                  | No (eseguibile diretto)         |
| UAC durante install     | Si (UNA volta sola)                                           | No                              |
| Hook installer NSIS     | **Si** (firewall + Defender + rete Private + WebView2 silent) | **No** (solo eseguibile)        |
| Autostart al login      | Si (HKCU, Room Agent)                                         | No (manuale)                    |
| Bundle WebView2 Runtime | Si (bootstrapper silent)                                      | No (richiede Edge gia presente) |
| Disinstallazione pulita | Si (Pannello di controllo)                                    | Cancellazione cartella          |
| Uso consigliato         | **Default**: produzione                                       | Rescue, demo offline, test      |

## 5. Verifica integrita prima della consegna

```powershell
cd release\live-slide-center-agent
Get-FileHash Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe -Algorithm SHA256
# Confronta con il valore in SHA256SUMS.txt
```

## 6. Code-signing SmartScreen (Sprint 5 — opzionale)

Senza certificato di code-signing, al primo lancio Windows mostrera "Windows
Defender SmartScreen ha bloccato l'avvio di un'app non riconosciuta". Soluzioni:

| Soluzione                   | Costo         | Tempo         | Risultato                                             |
| --------------------------- | ------------- | ------------- | ----------------------------------------------------- |
| Cert OV Sectigo             | ~190 EUR/anno | 1-2 settimane | "Esegui comunque" sparisce dopo ~3000 install         |
| Cert EV Sectigo (token USB) | ~310 EUR/anno | 1-2 settimane | "Esegui comunque" sparisce dal giorno 1               |
| Workaround temporaneo       | 0 EUR         | 0             | Operatore clicca "Maggiori info" -> "Esegui comunque" |

Comando di firma (quando il certificato sara disponibile):

```powershell
signtool sign /f cert.pfx /p $env:CERT_PWD `
    /tr http://timestamp.sectigo.com /td SHA256 /fd SHA256 `
    release\live-slide-center-agent\Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe
```

## 7. Checklist consegna licenza (Sprint 4 chiuso)

Quando un cliente acquista la suite Slide Center via Live WORKS APP:

- [ ] Genera la licenza dalla dashboard Live WORKS APP con i **productIds** corretti:
  - `slide-center-cloud` x 1 (workspace web del tenant)
  - `slide-center-agent` x 1 (mini-PC regia)
  - `slide-center-room-agent` x N (uno per ogni PC sala — N = sale del cliente)
- [ ] Verifica il **device limit** (`maxDevicesPerProduct`) impostato sulla licenza: deve coprire il numero di PC che il cliente attivera nel tempo (incluso eventuale change-PC).
- [ ] Spedisci al cliente il pacchetto:
  - `Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe` (1 copia, per il mini-PC regia) — **build con `--features license`**
  - `Live-SLIDE-CENTER-Room-Agent-Setup-0.1.0.exe` (1 copia, da installare su tutti i PC sala) — **build con `--features license`**
  - `SHA256SUMS.txt` (per verifica integrita)
  - `Manuale_Installazione_Local_Agent.pdf`
  - `Manuale_Installazione_Room_Agent.pdf`
  - Email con: chiave `LIVE-XXXX-XXXX-XXXX-XXXX`, URL workspace web, e procedura di prima attivazione (cap. 4 dei manuali installazione).
- [ ] In dashboard Live WORKS APP, monitora i **pending activations**:
  - Primo activate: la richiesta arriva con `pendingApproval=true` e fingerprint hardware. Approva manualmente dopo aver verificato che il fingerprint corrisponda al PC del cliente (su licenze a piano "auto-approval=on" la cosa e' automatica).
  - Activate successivi sullo stesso PC: automatici (token salvato in `license.enc`).
- [ ] Annota su CRM (Live WORKS APP `customers` o foglio interno):
  - Cliente, chiavi consegnate, fingerprint primi binding (per assistenza change-PC futuri).

## 8. Troubleshooting build

| Errore                                    | Causa probabile                        | Soluzione                                                           |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `cargo tauri --version` fallisce          | Tauri CLI non installato               | `cargo install tauri-cli --version "^2.0" --locked`                 |
| `pnpm install --frozen-lockfile` fallisce | Lockfile out-of-sync                   | Lo script ricade automaticamente su `pnpm install`                  |
| `[post-build] cartella NSIS mancante`     | Build Tauri ha fallito silenziosamente | Rilancia `npm run build:tauri` da `apps/agent` per vedere log       |
| `icon ... is not RGBA`                    | Icone vecchie senza alpha              | `pnpm --filter @slidecenter/web run icons:agents`                   |
| `OUT_DIR not set`                         | Run di `cargo` fuori da workspace      | Usa sempre `cargo tauri build --manifest-path src-tauri/Cargo.toml` |
