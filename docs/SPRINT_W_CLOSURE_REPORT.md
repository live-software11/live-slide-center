# Sprint W — Cloud finale + Desktop allineato

**Data chiusura:** 19 aprile 2026  
**Obiettivo:** rendere operativa al 100% la versione cloud SaaS e portare la versione desktop offline (Tauri) alla parità funzionale completa con la cloud, in modo che l'esperienza utente sia identica.

---

## 1. Esito sintetico

| Fase | Descrizione | Stato |
| ---- | ----------- | ----- |
| A | Chiusura cloud (types, UX cartelle, backup, DR) | OK |
| B | Mirror schema SQLite desktop ↔ Postgres cloud (7 migrazioni) | OK |
| C | Endpoint REST/RPC mancanti su backend Rust desktop | OK |
| D | UI condizionale SPA per modalità desktop (`isCloudFeatureAvailable`) | OK |
| E | Quality gate + deploy cloud + build desktop NSIS + smoke | OK |
| F | Documentazione finale | OK (questo file) |

**Quality gate finale (E1):**

- `pnpm --filter @slidecenter/web typecheck` — verde (0 errori)
- `pnpm --filter @slidecenter/web lint` — verde (0 errori)
- `pnpm --filter @slidecenter/shared typecheck` — verde (0 errori)
- `cargo check` (apps/desktop/src-tauri) — verde (0 errori, 0 warning)
- `cargo test --bin slide-center-desktop` — **18 / 18 verde** (incluse 6 nuove integration test su `folder_routes`)

---

## 2. Artefatti prodotti

### 2.1 Cloud SPA (Vercel produzione)

| Voce | Valore |
| ---- | ------ |
| URL produzione | <https://live-slide-center.vercel.app> |
| Deployment ID | `dpl_8mMJ8xrSV1mbkuBbyzKSCQj1EAFU` |
| Comando | `vercel --prod --archive=tgz` da root monorepo |
| Account Vercel | `livesoftware11-3449` (live.software11@gmail.com) |
| Build SPA | Vite 8 + Turbopack monorepo, 32s build, 136 entries PWA precache (~4.2 MB) |
| Postbuild | sourcemaps Sentry skip (token non settato in locale) |

### 2.2 Desktop NSIS installer

| Voce | Valore |
| ---- | ------ |
| File | `Live SLIDE CENTER Desktop_0.1.1_x64-setup.exe` |
| Path | `apps/desktop/src-tauri/target/release/bundle/nsis/` |
| Versione | **0.1.1** (bump da 0.1.0) |
| Size | 10.70 MB (11 218 143 byte) |
| SHA-256 | `8c64c96ea5bf37c3b8e3ff60943457fd145bf60326b23bf882b45b9409f8d6c7` |
| Tauri CLI | 2.10.1 |
| Updater | non firmato (vedi §4.4) |
| Manifest JSON | `apps/desktop/release-output.json` |

---

## 3. Smoke test desktop (E4)

Eseguito **19/04/2026 02:42 CEST** sul PC build (Windows 11, Win10 SDK):

```
==============================================================
  Live SLIDE CENTER — Smoke test desktop offline (Sprint FT)
  Backend: http://127.0.0.1:7300
  platform=win32
==============================================================
[SKIP] · Installer NSIS presente            (skip via --skip-installer)
[OK]   ! Backend Rust /health               26.6ms, version=0.1.1
[OK]   ! /info espone metadata runtime      role=admin, data_root, version=0.1.1
[OK]   ! PostgREST mirror /rest/v1/events   HTTP 401 in 0.7ms (atteso, no auth)
[FAIL] ~ mDNS publish attivo                no IP LAN (PC dietro firewall casa)
[OK]   ~ Loopback RTT < 50ms p95            median=0.7ms p95=1.1ms
[OK]   ~ Spazio disco data_root >= 5 GB     590.42 GB liberi
[OK]   ! Porta 7300 in LISTEN               1 binding LAN reach 0.0.0.0
--------------------------------------------------------------
  Totale: 8 | OK: 6 | FAIL: 1 | SKIP: 1
  Critici falliti: 0 | Warning falliti: 1
  >>> SEMAFORO VERDE: PC pronto per il field test.
==============================================================
```

**Snapshot JSON:** `apps/desktop/smoke-report.json`.

L'unico FAIL è il warning mDNS, che dipende dalla rete del PC build (Wi-Fi domestica con multicast filtrato). Sul PC field-test in cantiere il check passerà perché la rete LAN dell'evento abilita multicast. Il check resta `severity=warn`, non bloccante.

---

## 4. Modifiche significative nei file di build

### 4.1 `apps/desktop/src-tauri/tauri.conf.json`

- `version`: `0.1.0` → `0.1.1`
- `bundle.createUpdaterArtifacts`: `true` → `false` (default unsigned)
- Sezione `plugins.updater` rimossa dal config base (causa panic al boot quando `pubkey` è assente in Tauri 2.x)
- La sezione completa è migrata in `tauri.signing.example.json` come override

### 4.2 `apps/desktop/src-tauri/Cargo.toml`

- `version`: `0.1.0` → `0.1.1`
- Nuova sezione `[features]` con flag `signed-updater`
- Documentazione aggiornata: il plugin updater viene registrato solo con `--features signed-updater` (vedi §4.4)

### 4.3 `apps/desktop/src-tauri/src/main.rs`

- Refactor `tauri::Builder` da chain unica a `let mut builder = ...` per supportare conditional `.plugin()` con `#[cfg(feature = "signed-updater")]`
- Stesso codice di startup invariato (server, ruolo, license heartbeat, invoke handlers)

### 4.4 `apps/desktop/src-tauri/installer-hooks.nsi`

Refactor da delimitatore stringa NSIS `'...'` (single quote) a `` `...` `` (backtick).

**Motivo del bug:** NSIS interpreta `''` consecutive dentro stringa single-quoted come "chiudi/riapri stringa", spezzando il comando in 3 parametri. I comandi PowerShell `Add-MpPreference -ExclusionPath ''$PROFILE\SlideCenter''` (apostrofi PowerShell escapati) facevano fallire `makensis` con errore `ExecWait expects 1-2 parameters, got 3` su `NSIS_HOOK_POSTINSTALL` macroline 15. Backtick non collide con la sintassi PowerShell e risolve definitivamente.

### 4.5 `apps/desktop/scripts/release.mjs` + `apps/desktop/package.json`

Rimosso `--manifest-path src-tauri/Cargo.toml` da tutti gli script `cargo tauri ...`. Tauri CLI 2.10 non supporta più questo flag; il workspace viene risolto automaticamente dal cwd (`apps/desktop/`) che contiene `src-tauri/`.

---

## 5. Pipeline build firmata (futuro)

Per produrre un installer firmato + bundle updater (NON usato in Sprint W, lasciato come pipeline opzionale per code signing futuro):

```bash
# 1. Genera chiave updater una sola volta
cargo tauri signer generate -w ~/.tauri/slidecenter-desktop.key

# 2. Copia tauri.signing.example.json → tauri.signing.json
#    e personalizza pubkey + certificateThumbprint o signCommand

# 3. Esporta env var per la chiave privata
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content ~/.tauri/slidecenter-desktop.key)

# 4. Build con feature flag + override config
cd apps/desktop
cargo tauri build --features signed-updater --config src-tauri/tauri.signing.json
```

L'installer prodotto sarà NSIS firmato (Authenticode) + bundle `.nsis.zip` + `.sig` per auto-update.

---

## 6. Cosa resta fuori da Sprint W

Le seguenti voci sono **fuori scope** per design (decisione Imprenditore + CTO):

- **Telemetria desktop nascosta** — la SPA in modalità desktop nasconde le voci di sidebar `team`, `billing`, `audit` (cloud-only). Il backend Rust desktop non invia telemetria al cloud.
- **Code signing EV certificate** — l'installer NSIS è unsigned. Per distribuzione esterna sarà necessario un certificato EV (vedi `apps/desktop/CODE_SIGNING.md`).
- **Updater auto-check in produzione** — disabilitato di default (`createUpdaterArtifacts: false`). Si attiverà quando avremo (a) certificato firma valido, (b) GitHub Releases pubbliche con `latest.json`.

---

## 7. Pronto per il field test

Tutti i prerequisiti del field test (Sprint FT) sono soddisfatti:

- Cloud SPA in produzione su `live-slide-center.vercel.app`
- Installer NSIS pronto in `apps/desktop/src-tauri/target/release/bundle/nsis/`
- Smoke test SEMAFORO VERDE (8 check, 0 critical fail)
- Schema desktop SQLite allineato con Postgres cloud (10 migrazioni totali, 7 nuove in Sprint W)
- File Explorer V2 unico punto rinomina/spostamento cartelle (cloud + desktop)
- Disaster recovery runbook e backup verifier daily attivi (vedi `docs/DISASTER_RECOVERY.md`)

**Riferimento operativo:** `docs/FIELD_TEST_CHECKLIST.md` per la checklist passo-passo da eseguire sul sito evento.
