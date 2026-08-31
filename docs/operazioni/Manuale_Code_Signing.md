# Manuale Code-Signing — Live SLIDE CENTER Agent + Room Agent

**Destinatario:** Andrea Rizzari (operativo, build & release).
**Versione documento:** 1.0 (Sprint 5b).
**Stato:** integrazione codice gia' pronta, certificato da acquistare.

---

## 1. Perche' firmare gli installer

Senza firma digitale, ogni volta che un cliente esegue
`Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe` Windows 11 mostra:

> Microsoft Defender SmartScreen ha impedito l'avvio di un'applicazione non riconosciuta
> Editore sconosciuto

L'utente deve cliccare "Ulteriori informazioni" → "Esegui comunque". E' un blocco
psicologico fortissimo nei contesti **eventi corporate**: il committente vede
"sconosciuto" e ti chiama prima di installare, costando 30-60 minuti per call.

**Con firma OV Sectigo:**

- Sparisce "Editore sconosciuto" → appare "Andrea Rizzari" / "Live Software"
- SmartScreen costruisce reputazione nelle prime ~50 installazioni e poi smette di avvisare
- Pre-requisito di vendita per qualsiasi cliente >= medio (banche, eventi farma, PA)

**Costo / tempo:**

- Sectigo OV Code Signing: ~190 €/anno (oppure 240 € via reseller IT come Sklep)
- Validazione organizzazione: 3-7 giorni lavorativi (servono visura camerale + chiamata)
- File `.pfx` consegnato via portale + password generata da te alla prima installazione

> **EV vs OV:** EV (~330 €/anno) costruisce reputazione SmartScreen istantaneamente
> ma viene consegnato su token USB (SafeNet) **non esportabile**: ogni build richiede
> token fisicamente collegato + password. Per Slide Center (build manuale, 2-3 release/mese)
> OV su file `.pfx` e' molto piu' pratico. Riconsidera EV solo se i clienti ti dicono
> "il tuo software lampeggia rosso al primo install".

---

## 2. Cosa e' gia' pronto in repo (Sprint 5b)

L'integrazione signtool e' **gia' implementata** in:

- `apps/agent/scripts/post-build.mjs` → funzione `signFileIfConfigured()`
- `apps/room-agent/scripts/post-build.mjs` → funzione `signFileIfConfigured()`
- `release-licensed.bat` → preflight check signtool + log stato

**Comportamento attuale (senza cert):**

> `[post-build] code-signing: SKIP <file> (nessuna env CERT_* settata, build di sviluppo)`

→ build continua identico a oggi, output non firmato. Zero friction per dev locale.

**Comportamento dopo aver settato `CERT_PFX_PATH` + `CERT_PASSWORD`:**

> `[post-build] code-signing: sign Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe (timestamp http://timestamp.sectigo.com)`
> `[post-build] code-signing: OK`

→ NSIS setup E exe portable firmati prima dello zip e PRIMA di SHA256SUMS.

---

## 3. Acquisto certificato OV Sectigo (passo a passo)

### 3.1 Reseller consigliato

- **SSLs.com** (reseller ufficiale Sectigo, fattura USD ~$200/anno, accetta SEPA)
- **GoGetSSL.com** (reseller IT, fattura EUR ~190 €/anno)
- **Sectigo store** (diretto, ~330 € oppure ~190 € con coupon)

### 3.2 Documenti richiesti per validazione organizzazione (OV)

1. **Visura camerale aggiornata** (entro 6 mesi) — scaricabile da `registroimprese.it` (~3 €)
2. **Numero di telefono fisso aziendale** verificabile via call automatica Sectigo
   - Se non hai un fisso: usa Skype Number IT a 5 €/mese, basta funzioni per la chiamata
3. **Email aziendale** (NON gmail/outlook personali) → `info@liveworksapp.com` o simile
4. **Indirizzo legale** registrato in visura

### 3.3 Workflow tipico

| Giorno | Azione                                                        |
| ------ | ------------------------------------------------------------- |
| 0      | Acquisto online + invio docs                                  |
| 1-3    | Sectigo verifica visura                                       |
| 3-5    | Call telefonica automatica al numero pubblico → digiti codice |
| 5-7    | Email con link download portale + istruzioni generazione CSR  |
| 7      | Generi CSR + scarichi `.pfx` (imposti TU la password)         |

### 3.4 Generazione CSR (richiesta certificato)

Il portale Sectigo ti chiedera' di generare una **Certificate Signing Request**.
Su Windows, dal terminale (PowerShell admin):

```powershell
# 1) Genera chiave privata RSA 3072 bit (raccomandato 2026)
$cert = New-SelfSignedCertificate `
  -Subject "CN=Andrea Rizzari, O=Live Software, L=Roma, C=IT" `
  -KeyAlgorithm RSA -KeyLength 3072 `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature `
  -Type CodeSigningCert

# 2) Esporta CSR (Sectigo te lo chiede in formato Base64)
$csrPath = "$env:USERPROFILE\Desktop\sectigo_csr.txt"
# Sectigo accetta CSR PKCS#10. Strumento alternativo: openssl req -new ...
```

**Alternativa con OpenSSL** (piu' diffusa, Sectigo la accetta):

```powershell
# Installa OpenSSL: scoop install openssl  oppure  choco install openssl
openssl req -new -newkey rsa:3072 -nodes `
  -keyout "C:\Certs\sectigo_private.key" `
  -out "C:\Certs\sectigo.csr" `
  -subj "/C=IT/ST=Lazio/L=Roma/O=Live Software/CN=Andrea Rizzari/emailAddress=live.software11@gmail.com"
```

Carichi il contenuto di `sectigo.csr` nel portale Sectigo, ricevi il certificato
in formato `.crt` o `.cer` via email. Per la firma serve il `.pfx` che combina
chiave privata + certificato:

```powershell
openssl pkcs12 -export `
  -out "C:\Certs\Sectigo-OV-2026.pfx" `
  -inkey "C:\Certs\sectigo_private.key" `
  -in "C:\Certs\sectigo.crt" `
  -name "Live Software Code Signing 2026"
# → ti chiede una password. SCEGLI E SALVA in password manager.
```

> **CRITICO:** la chiave privata `.key` e la `.pfx` non vanno mai pushate in git,
> mai inviate via email, mai messe su Drive condiviso. Conservale in password
> manager (1Password / Bitwarden) e in backup offline criptato (USB stick).

---

## 4. Installazione signtool sul PC di build

`signtool.exe` fa parte del **Windows SDK**, non e' nel PATH di default.

### 4.1 Installazione (gia' presente con Visual Studio Build Tools)

Se hai gia' installato `cargo tauri build`, hai gia' VS Build Tools → hai gia' signtool.
Verifica:

```powershell
where signtool
# Dovresti vedere qualcosa tipo:
# C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe
```

Se `where signtool` non trova nulla:

1. Apri **Visual Studio Installer** → Modifica → "Desktop development with C++"
2. Verifica che "Windows 11 SDK (10.0.26100 o superiore)" sia spuntato
3. Riavvia il PC dopo l'installazione

### 4.2 Aggiungi signtool al PATH (raccomandato)

Cosi' `release-licensed.bat` lo trova senza dover aprire il "Developer Command Prompt".

```powershell
# Trova la versione installata piu' recente
$kit = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\10.*" |
       Sort-Object Name -Descending | Select-Object -First 1

# Aggiungi al PATH utente (permanente)
$signtoolDir = "$($kit.FullName)\x64"
[Environment]::SetEnvironmentVariable(
  'PATH',
  "$([Environment]::GetEnvironmentVariable('PATH','User'));$signtoolDir",
  'User'
)
# Chiudi e riapri PowerShell, poi: where signtool → ora deve funzionare
```

---

## 5. Configurazione del build firmato

Una volta che hai `Sectigo-OV-2026.pfx` + password + signtool, modifica il
build di vendita in 3 righe:

### 5.1 Setup permanente (raccomandato)

Salva un file `release-licensed-signed.bat` in radice progetto:

```bat
@echo off
REM Setup env code-signing prima del build di vendita firmato
set CERT_PFX_PATH=C:\Certs\Sectigo-OV-2026.pfx
set CERT_PASSWORD=<la-tua-password-pfx>
REM Opzionale: cambia timestamp server se Sectigo down
REM set TIMESTAMP_URL=http://timestamp.digicert.com

call release-licensed.bat
```

> **NON pushare questo file in git** (lo aggiunge gia' .gitignore se chiamato `*-signed.bat`).
> Mettilo in `C:\Users\andre\BuildScripts\` o simile.

### 5.2 Setup temporaneo (singola sessione)

Da PowerShell prima del build:

```powershell
$env:CERT_PFX_PATH = "C:\Certs\Sectigo-OV-2026.pfx"
$env:CERT_PASSWORD = "la-tua-password"
.\release-licensed.bat
```

### 5.3 Cosa vedi nel log

```
[1b/6] Code-signing: ATTIVO (CERT_PFX_PATH=C:\Certs\Sectigo-OV-2026.pfx)
OK signtool trovato.
...
[post-build] NSIS installer -> release\live-slide-center-agent\Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe
[post-build] code-signing: sign Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe (timestamp http://timestamp.sectigo.com)
Done Adding Additional Store
Successfully signed and timestamped: ...
[post-build] code-signing: OK Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe
[post-build] code-signing: sign live-slide-center-agent.exe (timestamp http://timestamp.sectigo.com)
[post-build] code-signing: OK live-slide-center-agent.exe
[post-build] Portable ZIP -> ...
[post-build] SHA256SUMS -> ...
```

### 5.4 Verifica firma sul file generato

```powershell
# Da PowerShell
Get-AuthenticodeSignature "release\live-slide-center-agent\Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe"

# Output atteso:
#   Status: Valid
#   StatusMessage: Signature verified.
#   SignerCertificate: [Subject] CN=Andrea Rizzari, O=Live Software, ...
```

In alternativa: **click destro sul file** → Proprieta' → tab "Firme digitali" → la
firma di "Andrea Rizzari" / "Live Software" deve apparire con timestamp valido.

---

## 6. Variabili d'ambiente supportate (riferimento)

Il modulo `signFileIfConfigured()` in `post-build.mjs` accetta in ordine di
priorita':

| Variabile         | Tipo cert           | Esempio                                    |
| ----------------- | ------------------- | ------------------------------------------ |
| `CERT_PFX_PATH`   | OV su file `.pfx`   | `C:\Certs\Sectigo-OV-2026.pfx`             |
| `CERT_PASSWORD`   | password del `.pfx` | (qualsiasi)                                |
| `CERT_THUMBPRINT` | EV su token / store | `0123456789ABCDEF0123456789ABCDEF01234567` |
| `CERT_SUBJECT`    | qualsiasi by name   | `Live Software`                            |
| `TIMESTAMP_URL`   | server timestamp    | `http://timestamp.sectigo.com` (default)   |

**Selezione automatica:** se hai `CERT_PFX_PATH` settato, gli altri vengono
ignorati. Se hai solo `CERT_THUMBPRINT`, signtool cerca il cert nello store di
Windows. Se hai solo `CERT_SUBJECT`, signtool fa match per Subject Name (utile
quando hai un solo cert valido nel `Cert:\CurrentUser\My`).

**Timestamp server:** raccomandiamo Sectigo per consistenza. Mirror disponibili
in caso di down:

- `http://timestamp.sectigo.com` (default)
- `http://timestamp.digicert.com` (fallback affidabile)
- `http://time.certum.pl` (terza opzione)

---

## 7. Troubleshooting

### 7.1 `signtool` non trovato

> ERRORE: signtool.exe non nel PATH ma CERT_PFX_PATH e' settato.

→ Vedi sezione 4. Apri "Developer Command Prompt for VS 2022" da menu Start
e lancia `release-licensed.bat` da li' (signtool e' gia' nel PATH dentro quel terminale).

### 7.2 `SignerSign() failed: 0x80092009 (Cannot find object or property)`

→ Il `.pfx` esiste ma la password e' sbagliata. Riprova.
→ Oppure il `.pfx` e' corrotto (riscarica da portale Sectigo).

### 7.3 `SignerSign() failed: 0x80700000`

→ Timestamp server irraggiungibile. Cambia con env `TIMESTAMP_URL=http://timestamp.digicert.com`.

### 7.4 `Error: SignerTimeStamp() failed`

→ Conflitto firewall / proxy aziendale. Verifica che PowerShell raggiunga `timestamp.sectigo.com:80`:

```powershell
Test-NetConnection -ComputerName timestamp.sectigo.com -Port 80
```

### 7.5 Cliente vede ancora SmartScreen dopo firma

→ **Normale per le prime 30-50 installazioni.** SmartScreen costruisce reputazione
contando i clienti che cliccano "Esegui comunque". Dopo soglia, l'avviso sparisce.
Per accelerare: invia il file a `submit.smartscreen.com` (Microsoft submission site)
chiedendo di whitelistare il publisher.

→ Se l'avviso persiste DOPO 100+ install distinte: probabile che hai usato il cert su
un solo PC (fingerprint). Sectigo OV non penalizza questo. EV invece assegna la
reputazione al token, non al publisher.

### 7.6 Errore `0x80090020` (NTE_FAIL) durante import del .pfx

→ Apri PowerShell admin (NON utente normale) per importare il certificato:

```powershell
$pwd = ConvertTo-SecureString -String 'la-tua-password' -Force -AsPlainText
Import-PfxCertificate -FilePath C:\Certs\Sectigo-OV-2026.pfx `
  -CertStoreLocation Cert:\CurrentUser\My -Password $pwd -Exportable
```

---

## 8. Rinnovo annuale

Il cert OV Sectigo dura 1 anno. Calendarizza:

- **Mese 11:** Sectigo invia email di rinnovo. Comprare PRIMA della scadenza
  per evitare di rifare validazione organizzazione (puoi "rekey" in ~24h).
- **Mese 12 - 7 giorni:** scarichi il nuovo `.pfx` e cambi `CERT_PFX_PATH`.
- I file firmati con il vecchio cert restano validi grazie al **timestamp**:
  Windows verifica "il cert era valido al momento della firma" anche se oggi e'
  scaduto. Questo e' il motivo per cui usiamo SEMPRE `--tr` su signtool.

---

## 9. Costi totali stimati anno 1 (per la sola firma)

| Voce                             | Costo annuo |
| -------------------------------- | ----------- |
| Sectigo OV Code Signing          | ~190 €      |
| Visura camerale (una tantum)     | ~3 €        |
| Skype Number IT (se serve fisso) | ~60 €       |
| **Totale anno 1**                | **~253 €**  |
| Anni successivi (rinnovo solo)   | ~190 €      |

**ROI:** una sola call cliente evitata (1h × tariffa) ripaga ~10 mesi di certificato.

---

## 10. Checklist rapida pre-vendita firma

- [ ] Cert OV `.pfx` acquistato e scaricato
- [ ] Password salvata in 1Password / Bitwarden
- [ ] `signtool` nel PATH (verifica `where signtool`)
- [ ] `release-licensed-signed.bat` creato in cartella locale (NON in git)
- [ ] Build di test eseguito → log mostra `code-signing: OK` per entrambi i file
- [ ] Verifica firma con `Get-AuthenticodeSignature` → `Status: Valid`
- [ ] Doppio click sull'installer su PC pulito → SmartScreen mostra "Andrea Rizzari"
      (NON "Editore sconosciuto")
- [ ] SHA256SUMS.txt rigenerato (gli hash cambiano dopo firma)

Quando spuntato tutto, sei pronto per spedire al primo cliente di produzione.

---

**Riferimenti:**

- `apps/agent/scripts/post-build.mjs` — implementazione signing
- `apps/room-agent/scripts/post-build.mjs` — implementazione signing
- `release-licensed.bat` — preflight + orchestratore
- `.cursor/rules/project-architecture.mdc` — ADR-014 motivazione tecnica
- Sectigo: https://www.sectigo.com/knowledge-base
