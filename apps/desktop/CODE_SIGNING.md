# Code Signing — Live SLIDE CENTER Desktop

> Sprint P4 (`docs/GUIDA_OPERATIVA_v3_FIELD_TEST_E_OFFLINE.md` §4.H). **Predisposto, non attivato:** non abbiamo certificato EV oggi.

Senza signing, l'installer NSIS funziona ma SmartScreen mostra "Windows ha protetto il PC" al primo download/avvio. Per uso interno (Andrea + tecnici esperti) si bypassa con "Esegui comunque". Per distribuzione larga o demo a clienti, attivare una delle 3 strategie sotto.

---

## Strategia A — Certificato EV nel Windows Cert Store (consigliata x USB key)

**Quando:** hai un certificato EV su token USB (es. SafeNet) o un CSP installato sul PC build.

**Setup:**

1. Inserisci il token USB con cert EV.
2. Trova il thumbprint:
   ```powershell
   Get-ChildItem -Path Cert:\CurrentUser\My | Where-Object { $_.Subject -match "Live Software" }
   ```
   Copia la stringa SHA-1 di 40 caratteri esadecimali.
3. Copia il template:
   ```powershell
   Copy-Item src-tauri/tauri.signing.example.json src-tauri/tauri.signing.json
   ```
4. In `tauri.signing.json`, sostituisci `REPLACE_WITH_YOUR_CERT_SHA1_THUMBPRINT_40_HEX_CHARS` con il valore reale.
5. Lascia `signCommand: null` (non serve).
6. Build:
   ```powershell
   pnpm release:nsis -- --signing-config src-tauri/tauri.signing.json
   ```

`signtool.exe` (incluso in Windows SDK, parte dei prereq Tauri) si occupa di:

- Firmare l'installer NSIS finale.
- Marcare temporalmente la firma con `timestampUrl` (default: `http://timestamp.digicert.com`).

**Costo:** cert EV ~250-500 USD/anno (SSL.com, Sectigo, DigiCert).

---

## Strategia B — Azure Key Vault con `signCommand` custom

**Quando:** preferisci HSM cloud-native (no token fisico) e hai gia' Azure subscription.

**Setup:**

1. Crea un Azure Key Vault e importa il cert EV come "Certificate".
2. Crea Service Principal con `Certificate Sign` permission.
3. Installa `azuresigntool`:
   ```powershell
   dotnet tool install --global AzureSignTool
   ```
4. Esporta credenziali:
   ```powershell
   $env:AZ_CLIENT_ID = "<sp-client-id>"
   $env:AZ_CLIENT_SECRET = "<sp-secret>"
   $env:AZ_TENANT_ID = "<tenant-id>"
   $env:CERT_NAME = "<nome-cert-in-vault>"
   $env:VAULT_URL = "https://<vault-name>.vault.azure.net"
   ```
5. In `tauri.signing.json`, **rimuovi** `certificateThumbprint` e setta:
   ```jsonc
   "signCommand": "azuresigntool sign -kvu \"%VAULT_URL%\" -kvi \"%AZ_CLIENT_ID%\" -kvs \"%AZ_CLIENT_SECRET%\" -kvc \"%CERT_NAME%\" -kvt \"%AZ_TENANT_ID%\" -tr http://timestamp.digicert.com -td sha256 -fd sha256 %1"
   ```
   Il placeholder `%1` viene sostituito da Tauri con il path del file da firmare.
6. Build identica:
   ```powershell
   pnpm release:nsis -- --signing-config src-tauri/tauri.signing.json
   ```

**Costo:** Key Vault Premium (HSM) ~5 USD/mese + cert EV.

---

## Strategia C — HSM remoto via `osslsigncode`

**Quando:** hai un HSM dedicato (Yubico HSM2, Entrust nShield) o vuoi tenere tutto on-prem in Italia.

**Setup:** identico a Strategia B ma con `osslsigncode` al posto di `azuresigntool`. Esempio:

```jsonc
"signCommand": "osslsigncode sign -pkcs11engine /usr/lib/engines/pkcs11.so -pkcs11module /usr/lib/libCryptoki2_64.so -h sha256 -t http://timestamp.digicert.com -in %1 -out %1.signed && mv %1.signed %1"
```

(Su Windows servono build di MSYS2 o WSL — questa strategia e' meno frequente per workflow Tauri.)

---

## Updater signing (separato dal code signing OS!)

Anche senza cert EV puoi attivare l'**updater signing**, che e' un meccanismo Tauri-native (Ed25519, NON un cert X.509). Questo NON aiuta SmartScreen ma **e' obbligatorio** per gli auto-update funzionanti.

```powershell
# 1. Genera coppia chiavi
cargo tauri signer generate -w "$env:USERPROFILE\.tauri\slidecenter-desktop.key"
# Output:
#   ~/.tauri/slidecenter-desktop.key      (PRIVATA — non committare!)
#   ~/.tauri/slidecenter-desktop.key.pub  (PUBBLICA — va in tauri.signing.json)

# 2. Esporta la privata in env var (NON in file di config!)
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$env:USERPROFILE\.tauri\slidecenter-desktop.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password se settata>"

# 3. Copia il contenuto della pubblica in tauri.signing.json -> plugins.updater.pubkey
notepad "$env:USERPROFILE\.tauri\slidecenter-desktop.key.pub"
notepad src-tauri/tauri.signing.json
```

**Backup chiavi:** salvarle in 1Password / Bitwarden personale di Andrea + copia offline su USB cifrata. Se perse, gli utenti gia' installati NON potranno piu' ricevere aggiornamenti automatici e dovranno reinstallare manualmente la versione con la nuova pubkey.

---

## Workflow consigliato (futuro, post-cert EV)

1. **Sviluppo locale:** unsigned (`pnpm release:nsis` senza flag).
2. **Pre-release / canary:** updater signed, NSIS unsigned (basta `tauri.signing.json` con `pubkey` ma senza `certificateThumbprint`).
3. **Release production:** entrambe firmate (`tauri.signing.json` completo + chiavi env).

CI futura (Sprint S?): GitHub Actions con secrets per `TAURI_SIGNING_PRIVATE_KEY` + `AZ_CLIENT_SECRET`. Job che builda solo per tag `v*.*.*` e pubblica su Release con `gh release upload`.

---

## File sensibili — non committare MAI

`apps/desktop/.gitignore` blocca:

```
src-tauri/tauri.signing.json   ← contiene pubkey + thumbprint (semi-pubblici, ma piu' sicuri off-repo)
*.key                           ← chiavi private updater
*.key.pub                       ← chiavi pubbliche updater (queste possono andare in repo, ma per simmetria stanno fuori)
release-output.json             ← manifest con SHA-256 + path locali
```

Se per errore committi `tauri.signing.json` o `*.key`:

1. **Revoca subito:**
   ```powershell
   git rm --cached src-tauri/tauri.signing.json
   git commit -m "remove leaked signing config"
   git push
   ```
2. **Ruota le chiavi:** rigenera con `cargo tauri signer generate` e aggiorna `pubkey`.
3. **Pulisci la history:** `git filter-repo --path src-tauri/tauri.signing.json --invert-paths` (richiede force-push, coordinare con team).
