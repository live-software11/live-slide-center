# Updater Setup — Live SLIDE CENTER Desktop

> Sprint P3 (configurazione iniziale) + **Sprint D3 (attivato, monorepo + CI)**.
> Vedi `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22.
>
> **Stato:** endpoint configurato sul monorepo `live-software11/live-slide-center`,
> `createUpdaterArtifacts: true`, workflow `.github/workflows/desktop-release.yml`
> attivo su push tag `desktop-v*`. Manca SOLO la generazione iniziale della
> coppia di chiavi Ed25519 (step manuale 1-2 sotto).

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
HTTPS GET https://github.com/live-software11/live-slide-center/releases/latest/download/latest.json
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

### 3. Configura i secrets su GitHub (monorepo `live-slide-center`)

Decisione architetturale Sprint D3: **stesso repo del monorepo** (no repo separato), tag dedicato `desktop-v<version>`.

```powershell
gh auth status
# Se non e' live-software11:
gh auth switch --user live-software11

# Setta i secrets della chiave privata (richiesti dal workflow CI)
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo live-software11/live-slide-center < "$env:USERPROFILE\.tauri\slidecenter-desktop.key"
# (opzionale, se hai messo password) :
$pwd = Read-Host "TAURI_SIGNING_PRIVATE_KEY_PASSWORD" -AsSecureString
$plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwd))
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo live-software11/live-slide-center --body $plain
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

### 5. Genera il `latest.json` (Sprint D3 — automatico)

```powershell
pnpm --filter @slidecenter/desktop release:latest-json
```

Lo script `apps/desktop/scripts/generate-latest-json.mjs`:

- legge `release-output.json` (size, sha, path installer)
- legge il file `.sig` accanto all'installer
- compila `apps/desktop/latest.json` con `version`, `notes`, `pub_date`,
  `platforms.windows-x86_64.{signature, url}` puntando a
  `https://github.com/live-software11/live-slide-center/releases/download/desktop-v<ver>/<installer>`

Override:

```powershell
node scripts/generate-latest-json.mjs --tag desktop-v0.1.1 --notes "fix sync LAN"
```

### 6. Pubblica la release (manuale)

```powershell
$ver = "0.1.0"
$bundle = "src-tauri/target/release/bundle/nsis"

gh release create "desktop-v$ver" `
  --repo live-software11/live-slide-center `
  --title "Live SLIDE CENTER Desktop v$ver" `
  --notes-file CHANGELOG.md `
  "$bundle/Live SLIDE CENTER Desktop_${ver}_x64-setup.exe" `
  "$bundle/Live SLIDE CENTER Desktop_${ver}_x64-setup.exe.sig" `
  "latest.json"
```

### 6-bis. Pubblica la release (CI automatica — consigliato)

```powershell
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Il workflow `.github/workflows/desktop-release.yml` esegue automaticamente
build firmata + generate-latest-json + gh release create. Vedi
`actions` tab del repo per i log.

L'endpoint configurato in `tauri.conf.json`:

```
https://github.com/live-software11/live-slide-center/releases/latest/download/latest.json
```

GitHub Releases serve sempre `/latest/download/<nome-asset>` come redirect
all'asset della release piu' recente. Quindi appena pubblichi (manualmente
o via CI) una nuova release `desktop-v*` con `latest.json`, tutti i client
lo trovano in automatico al prossimo polling (max 30 min).

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

## CI attiva (Sprint D3 — implementata)

Il workflow `.github/workflows/desktop-release.yml` esegue tutto il flusso
firmato in automatico su push tag `desktop-v*`:

1. checkout + setup pnpm/node/rust/tauri-cli
2. `pnpm install --frozen-lockfile`
3. validazione `tauri.signing.json` (rifiuta placeholder)
4. `pnpm release:nsis -- --signing-config tauri.signing.json --skip-prereqs`
5. `pnpm release:latest-json --tag <tag>`
6. `gh release create <tag>` con i 3 asset (`.exe`, `.sig`, `latest.json`)

Trigger:

```powershell
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Vedi `Actions > Desktop Release` per i log.
