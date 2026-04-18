# Live SLIDE CENTER Desktop

**Versione installabile per uso offline su LAN aziendale.** Stesso bundle React della SaaS cloud, wrappato in **Tauri 2** + **server Rust locale Axum** (vedi `src-tauri/`).

> Documento operativo: `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 14 (architettura desktop) + § 22 (storia Sprint J-P).

---

## Quick start

```powershell
# 1. Pre-requisiti (Node 22, pnpm, Rust 1.77.2+, cargo tauri CLI, WebView2)
pnpm --filter @slidecenter/desktop prereqs

# 2. Build NSIS unsigned (sviluppo/test interno)
pnpm --filter @slidecenter/desktop release:nsis

# 3. Build firmata con auto-update (richiede chiavi — vedi sotto)
pnpm --filter @slidecenter/desktop release:nsis -- --signing-config src-tauri/tauri.signing.json
```

L'installer finale e' in `src-tauri/target/release/bundle/nsis/Live SLIDE CENTER Desktop_<versione>_x64-setup.exe`. Lo script `release:nsis` stampa al termine path, dimensione e SHA-256 e crea `release-output.json` con il manifest pronto per pubblicazione su GitHub Releases.

---

## Pipeline di build (Sprint P1)

| Step           | Cosa fa                                                  | Comando             |
| -------------- | -------------------------------------------------------- | ------------------- |
| `prereqs`      | Verifica Node, pnpm, rust, cargo tauri, WebView2         | `pnpm prereqs`      |
| `clean`        | Rimuove bundle precedenti + `apps/web/dist-desktop`      | `pnpm clean`        |
| `clean:full`   | Rimuove anche `target/` Rust (ricompilazione full)       | `pnpm clean:full`   |
| `build:tauri`  | Build SPA + Rust + bundle NSIS                           | `pnpm build:tauri`  |
| `release:nsis` | Pipeline orchestrata: prereqs → clean → build → manifest | `pnpm release:nsis` |
| `release:full` | Stesso ma senza orchestrator (solo CLI Tauri puro)       | `pnpm release:full` |

`tauri.conf.json -> build.beforeBuildCommand` lancia automaticamente `pnpm --filter @slidecenter/web build:desktop` prima del build Rust: NON serve eseguirlo a parte.

---

## Bundle NSIS (Sprint P2)

`tauri.conf.json -> bundle`:

```jsonc
{
  "targets": ["nsis"],
  "windows": {
    "webviewInstallMode": {
      "type": "downloadBootstrapper", // Edge WebView2 scaricato a runtime se mancante
      "silent": true, // Nessun prompt utente
    },
    "nsis": {
      "installMode": "currentUser", // Install per utente (no UAC)
      "compression": "lzma", // ~30% piu' piccolo di Zlib (~5-10 sec di build extra)
      "displayLanguageSelector": false, // Niente popup lingue: default IT
      "languages": ["Italian", "English"],
    },
  },
}
```

**Architettura:** solo `x86_64-pc-windows-msvc`. ARM64 / 32-bit non supportati (target field-test = PC sala con CPU x64 desktop, mai mobile).

**Output:** `Live SLIDE CENTER Desktop_<version>_x64-setup.exe`. Versione presa da `package.json` + `Cargo.toml` (allineate a 0.1.0 in Sprint J).

---

## Auto-update (Sprint P3)

Il plugin `tauri-plugin-updater` e' **registrato e pronto**, ma per attivarlo serve la coppia di chiavi di firma updater (vedi `UPDATER_SETUP.md`). Senza chiavi:

- `bundle.createUpdaterArtifacts: false` (default in `tauri.conf.json`).
- L'app installata mostra il banner solo quando `cmd_check_for_update` ritorna `available: true`. Senza endpoint configurato, `check()` ritorna `available: false, error: "..."` graceful e il banner resta nascosto.

Per **abilitare** l'auto-update:

1. Genera la coppia chiavi: `cargo tauri signer generate -w ~/.tauri/slidecenter-desktop.key`
2. Copia `src-tauri/tauri.signing.example.json` in `src-tauri/tauri.signing.json` (gitignored).
3. Riempi `plugins.updater.pubkey` con il contenuto del file `~/.tauri/slidecenter-desktop.key.pub`.
4. Esporta:
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$env:USERPROFILE\.tauri\slidecenter-desktop.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password se settata>"
   ```
5. Build firmata + updater artifacts: `pnpm release:nsis -- --signing-config src-tauri/tauri.signing.json`
6. Pubblica `*-setup.exe`, `*.exe.sig` e `latest.json` su GitHub Releases (account `live-software11`, repo `slide-center-desktop`).

UI: `apps/web/src/components/DesktopUpdateBanner.tsx` mostra un banner stripe di 40px in cima alla SPA quando `cmd_check_for_update` ritorna `available: true`. Il check parte al boot e si ripete ogni 30 minuti. Il dismiss e' per-versione (sessionStorage), quindi una nuova release ricomparira' automaticamente.

---

## Code signing Windows (Sprint P4 — predisposto, no cert oggi)

Senza certificato EV, l'installer NSIS funziona ma SmartScreen di Windows Defender mostrera' "App non riconosciuta" al primo avvio. Per uso interno aziendale e' tollerabile (Andrea + tecnici esperti); per distribuzione larga o demo a clienti, vale la pena investire in cert EV.

Vedi `CODE_SIGNING.md` per le 3 strategie supportate (cert thumbprint locale, Azure Key Vault, HSM cloud) e gli step di attivazione.

---

## Distribuzione interna (Sprint P5)

**Per ora:** zip con installer + breve README "scarica, installa, scegli ruolo".

```powershell
# Esempio one-liner per creare il pacchetto distribuibile:
$ver = (Get-Content src-tauri/Cargo.toml | Select-String '^version = "(.+)"').Matches[0].Groups[1].Value
$installer = "src-tauri/target/release/bundle/nsis/Live SLIDE CENTER Desktop_${ver}_x64-setup.exe"
Compress-Archive -Path $installer, README.md -DestinationPath "SlideCenter-Desktop-${ver}.zip"
```

**Pubblicazione su GitHub Releases (futuro):**

1. `gh auth status` -> conferma account `live-software11` (vedi `.cursor/rules/github-account-live-software11.mdc`).
2. `gh release create v0.1.0 --title "Live SLIDE CENTER Desktop 0.1.0" --notes-file CHANGELOG.md`.
3. `gh release upload v0.1.0 src-tauri/target/release/bundle/nsis/*.exe`.
4. Se updater attivo: `gh release upload v0.1.0 src-tauri/target/release/bundle/nsis/*.sig src-tauri/target/release/bundle/nsis/latest.json`.

---

## Architettura runtime

```
+-----------------------------------------------------+
|       Tauri 2 webview (WebView2 / Wry)              |
|       └ React SPA (apps/web/dist-desktop)           |
|         └ chiama window.__TAURI__.core.invoke('cmd_*')
|         └ chiama HTTP http://127.0.0.1:7300/* (Supabase shim)
+-----------------------------------------------------+
                |
                | tauri::command + axum::serve
                v
+-----------------------------------------------------+
|    Server Rust locale (apps/desktop/src-tauri)      |
|       ├ axum 0.7 -> /rest/v1, /storage, /functions  |
|       ├ rusqlite -> ~/SlideCenter/db.sqlite (WAL)   |
|       ├ mDNS publish/discover (mdns-sd)             |
|       └ tauri-plugin-updater (check + install)      |
+-----------------------------------------------------+
                |
                | filesystem
                v
       ~/SlideCenter/  (data root)
       ├── role.json          (admin | sala)
       ├── device.json        (paired event/room - solo sala)
       ├── secrets.json       (admin_token + HMAC HKDF)
       ├── db.sqlite          (mirror Supabase: events, rooms, ...)
       └── storage/           (file PPTX/PDF scaricati)
```

**Persistenza assoluta** (regola sovrana 4 della guida operativa): la cancellazione di `~/SlideCenter/` e' l'**unico modo** per resettare un PC sala. L'updater NON tocca `~/SlideCenter/` (lo Sprint P2 setta `installMode: "currentUser"` + flag NSIS `/UPDATE` automatico).

---

## Troubleshooting

| Sintomo                                                   | Causa probabile                                     | Fix                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cargo: no such command tauri`                            | Tauri CLI non installata                            | `cargo install tauri-cli --version "^2.0" --locked`                                                                    |
| Build fallisce su WebView2                                | WebView2 SDK non scaricato                          | `pnpm prereqs` dovrebbe segnalarlo. Su Win11 e' built-in; su Win10 scarica `MicrosoftEdgeWebview2Setup.exe`.           |
| `failed to decode secret key: Wrong password`             | Password updater key non corretta (typing vs paste) | Rigenerare con `cargo tauri signer generate` digitando la password (non incollare). Vedi issue tauri-apps/tauri#13485. |
| App si apre ma resta su "Backend desktop non disponibile" | Il server Rust locale non e' partito                | Controllare log in `~/SlideCenter/` (di default tracing-subscriber stampa su stderr). Verificare port 7300 libera.     |
| L'updater banner non appare mai                           | `pubkey` non configurato, oppure endpoint 404       | Verificare in console SPA: `cmd_check_for_update` dovrebbe ritornare `error` parlante.                                 |
| SmartScreen blocca l'installer                            | Installer non firmato con cert EV                   | Vedi `CODE_SIGNING.md` per attivare la firma.                                                                          |

Per debug avanzato:

```powershell
$env:RUST_LOG = "slide_center_desktop=debug,axum=debug,tower_http=debug"
pnpm dev
```

---

## File chiave del progetto

| File                                              | Ruolo                                                      |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `src-tauri/Cargo.toml`                            | Dipendenze Rust + plugin Tauri                             |
| `src-tauri/tauri.conf.json`                       | Config base (tutto unsigned, updater predisposto)          |
| `src-tauri/tauri.signing.example.json`            | Template per build firmata (copia in `tauri.signing.json`) |
| `src-tauri/capabilities/default.json`             | Permessi Tauri (fs, http, updater, process)                |
| `src-tauri/src/main.rs`                           | Entry: setup + Tauri commands                              |
| `src-tauri/src/server/`                           | Backend Axum locale                                        |
| `scripts/clean.mjs`                               | Pulizia bundle                                             |
| `scripts/check-prereqs.mjs`                       | Pre-flight checks pre-build                                |
| `scripts/release.mjs`                             | Pipeline release orchestrata                               |
| `apps/web/src/components/DesktopUpdateBanner.tsx` | UI banner update (lato SPA)                                |
| `apps/web/src/lib/desktop-bridge.ts`              | Wrapper typed dei Tauri commands                           |

---

## Roadmap

| Sprint | Stato | Cosa                                                                        |
| ------ | ----- | --------------------------------------------------------------------------- |
| J      | ✅    | Bootstrap Tauri 2 + plugin minimi                                           |
| K      | ✅    | Server Axum locale (rest/v1, storage, functions)                            |
| L      | ✅    | mDNS publish/discover LAN                                                   |
| M      | ✅    | Persistenza device.json + auto-rejoin                                       |
| N      | ✅    | Sync file LAN admin -> sala (push HTTP + long-poll)                         |
| O      | ✅    | UX parity cloud/desktop (auth bypass, supabase client locale, status badge) |
| **P**  | ✅    | **Build NSIS + updater predisposto + signing slot + docs**                  |
| Q      | TBD   | Hybrid sync cloud<->desktop (push-only)                                     |

---

## Owner

Andrea Rizzari (CTO/Imprenditore) — `live.software11@gmail.com` (Firebase + GitHub `live-software11`).
