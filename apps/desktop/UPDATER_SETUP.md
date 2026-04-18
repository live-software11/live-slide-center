# Updater Setup — Live SLIDE CENTER Desktop

> Sprint P3 (vedi `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22 storia sprint). **Predisposto, da attivare quando hosting GitHub Releases sara' configurato.**

---

## Architettura

```
SPA React (DesktopUpdateBanner.tsx)
       |
       | window.__TAURI__.core.invoke('cmd_check_for_update')
       v
Rust (src/main.rs::cmd_check_for_update)
       |
       | tauri-plugin-updater -> app.updater().check().await
       v
HTTPS GET https://github.com/live-software11/slide-center-desktop/releases/latest/download/latest.json
       |
       | (se available + signature valida)
       v
HTTPS GET <url installer .exe + .sig>
       |
       v
Installazione silenziosa (NSIS /UPDATE) + restart
```

---

## Passi per attivare l'auto-update

### 1. Genera coppia chiavi Ed25519

```powershell
cargo tauri signer generate -w "$env:USERPROFILE\.tauri\slidecenter-desktop.key"
```

Output:

- `~/.tauri/slidecenter-desktop.key` — **PRIVATA**, mai committare. Backup in 1Password/Bitwarden + USB cifrata.
- `~/.tauri/slidecenter-desktop.key.pub` — **PUBBLICA**, va incorporata nel binario.

> **ATTENZIONE password:** il prompt chiede una password opzionale. **Usala** per builds locali; per CI puoi usarla via env. Se dimentichi la password la chiave e' inutilizzabile.

### 2. Configura il `pubkey` nel signing config

```powershell
Copy-Item src-tauri/tauri.signing.example.json src-tauri/tauri.signing.json
```

Apri `tauri.signing.json` e sostituisci:

```jsonc
"pubkey": "REPLACE_WITH_CONTENT_OF_YOUR_TAURI_KEY_PUB_FILE"
```

con il contenuto del file `~/.tauri/slidecenter-desktop.key.pub` (intero, multi-linea ok).

### 3. Crea il repo GitHub `slide-center-desktop` (account `live-software11`)

```powershell
gh auth status
# Se non e' live-software11:
gh auth switch --user live-software11

gh repo create live-software11/slide-center-desktop --private --description "Releases binari Live SLIDE CENTER Desktop"
```

### 4. Build firmata + updater artifacts

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$env:USERPROFILE\.tauri\slidecenter-desktop.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<la password che hai scelto>"

pnpm --filter @slidecenter/desktop release:nsis -- --signing-config src-tauri/tauri.signing.json
```

Artifact prodotti in `src-tauri/target/release/bundle/nsis/`:

- `Live SLIDE CENTER Desktop_0.1.0_x64-setup.exe`
- `Live SLIDE CENTER Desktop_0.1.0_x64-setup.exe.sig` (firma updater Ed25519, ~88 byte)
- `latest.json` (manifest updater consumato dal client)

### 5. Crea il `latest.json`

Tauri NON genera automaticamente `latest.json` — va creato a mano (oppure via script CI). Esempio:

```jsonc
{
  "version": "0.1.0",
  "notes": "Prima release pubblica desktop. Auto-update attivato.",
  "pub_date": "2026-04-17T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contenuto file .exe.sig>",
      "url": "https://github.com/live-software11/slide-center-desktop/releases/download/v0.1.0/Live.SLIDE.CENTER.Desktop_0.1.0_x64-setup.exe",
    },
  },
}
```

> **Trick:** `signature` e' la stringa esatta dentro il file `.sig`. Su Windows: `Get-Content "src-tauri/target/release/bundle/nsis/*.sig" -Raw`.

### 6. Pubblica la release su GitHub

```powershell
$ver = "0.1.0"
$bundle = "src-tauri/target/release/bundle/nsis"

gh release create "v$ver" `
  --repo live-software11/slide-center-desktop `
  --title "Live SLIDE CENTER Desktop $ver" `
  --notes-file CHANGELOG.md `
  "$bundle/Live SLIDE CENTER Desktop_${ver}_x64-setup.exe" `
  "$bundle/Live SLIDE CENTER Desktop_${ver}_x64-setup.exe.sig" `
  "$bundle/latest.json"
```

L'endpoint configurato in `tauri.conf.json` e':

```
https://github.com/live-software11/slide-center-desktop/releases/latest/download/latest.json
```

GitHub Releases serve sempre `/latest/download/<nome-asset>` come redirect all'asset della release piu' recente. Quindi appena pubblichi una nuova release con `latest.json`, tutti i client lo trovano in automatico.

---

## Test locale dell'updater

Prima di pubblicare su GitHub, testa con un server HTTP locale:

```powershell
# 1. Crea un latest.json fake che punta a un .exe di prova (versione bumped)
# 2. Avvia un server statico:
cd src-tauri/target/release/bundle/nsis
python -m http.server 8080

# 3. Modifica TEMPORANEAMENTE tauri.conf.json:
#    "endpoints": ["http://localhost:8080/latest.json"]
# 4. Builda l'app con la versione 0.0.9 (precedente a quella nel manifest), installala.
# 5. Avvia l'app: il banner deve apparire.
# 6. ROLLBACK le modifiche temporanee a tauri.conf.json.
```

---

## Comportamento client

`apps/web/src/components/DesktopUpdateBanner.tsx`:

- **Boot:** check immediato.
- **Polling:** ogni 30 minuti.
- **Banner:** sticky top, full-width, color `bg-sc-primary`, dismissible per-versione (sessionStorage).
- **Click "Installa":** chiama `cmd_install_update_and_restart` → download + install silenzioso + restart automatico.
- **Click "Piu' tardi":** chiude il banner per la sessione corrente. Riapparira' a meno di nuova versione.

`apps/web/src/lib/desktop-bridge.ts`:

- `getUpdaterStatus()` → `{ configured, current_version, endpoint_hint }`.
- `checkForUpdate()` → `{ available, version?, notes?, error? }`.
- `installUpdateAndRestart()` → non torna se OK (app restarta), torna `{ success: false, error }` se fallisce.

`apps/desktop/src-tauri/src/main.rs`:

- `cmd_updater_status` — sincrono, info statiche.
- `cmd_check_for_update` — async, gestisce 404 / network error / signature mismatch graceful.
- `cmd_install_update_and_restart` — async, scarica + installa + restart con `app.restart()` (mai ritorna su success).

---

## Troubleshooting

| Errore                         | Causa                                                             | Fix                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `signature does not match`     | Chiave PUB nel binario non corrisponde a quella usata per firmare | Rebuild app con `pubkey` aggiornato in `tauri.signing.json`, poi rigenerare `latest.json` con la NUOVA `.sig`                 |
| `update endpoint returned 404` | URL `latest.json` errato o release privata                        | Verificare che la release esista e che il repo sia accessibile (private repo richiede token)                                  |
| `wrong password` quando firmi  | Password `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` non corrisponde     | Rigenera key con `cargo tauri signer generate` (digita password, non incollare)                                               |
| L'app non vede mai update      | `getUpdaterStatus().configured: false`                            | Verificare che `tauri-plugin-updater` sia in `Cargo.toml` E registrato in `main.rs` E permesso in `capabilities/default.json` |
| Update parte ma non installa   | NSIS bloccato (antivirus o utente senza diritti)                  | `installMode: "currentUser"` + `passive` dovrebbe bypassare. Controllare log antivirus.                                       |

---

## CI futura (Sprint S?)

Esempio GitHub Actions per build firmata automatica su tag:

```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Tauri CLI
        run: cargo install tauri-cli --version "^2.0" --locked
      - name: Build signed installer
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_KEY_PASSWORD }}
        run: pnpm --filter @slidecenter/desktop release:nsis -- --signing-config src-tauri/tauri.signing.json
      - name: Generate latest.json
        run: node scripts/generate-latest-json.mjs
      - name: Upload to release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release upload ${{ github.ref_name }} bundle/*.exe bundle/*.sig latest.json
```

(Da implementare in Sprint S — fuori scope P.)
