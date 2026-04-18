# Setup PC Centro Slide — Guida operativa

> **Per chi:** tecnici di sala / regista / staff IT che installa Live SLIDE CENTER Desktop sul PC che fungerà da hub LAN per l'evento.
> **Tempo richiesto:** 15-20 minuti per la prima installazione.

---

## Indice

1. [Cosa fa il PC Centro Slide](#1-cosa-fa-il-pc-centro-slide)
2. [Prerequisiti hardware e software](#2-prerequisiti-hardware-e-software)
3. [Download e installazione](#3-download-e-installazione)
4. [Primo avvio](#4-primo-avvio)
5. [Collegamento al cloud (bind licenza)](#5-collegamento-al-cloud-bind-licenza)
6. [Verifica rete LAN](#6-verifica-rete-lan)
7. [Test prima dell'evento](#7-test-prima-dellevento)
8. [Aggiornamenti automatici](#8-aggiornamenti-automatici)
9. [Disinstallazione](#9-disinstallazione)
10. [Risoluzione problemi](#10-risoluzione-problemi)

---

## 1. Cosa fa il PC Centro Slide

Il PC Centro Slide è il **cervello dell'evento**: raccoglie i contributi (slide, video, foto, PDF) caricati dai relatori o dai PC sala e li **distribuisce ai PC sala** in tempo reale tramite la LAN dell'evento.

In pratica:

- **Funziona OFFLINE** — non serve internet durante l'evento, basta la rete LAN (cavo o WiFi privato).
- **Stessa interfaccia del cloud** — chi sa usare Live SLIDE CENTER su browser sa già usare il desktop.
- **Backup automatico** — i file restano sul PC anche dopo la disinstallazione (a meno di scelta esplicita contraria).
- **Licenza condivisa col cloud** — se hai un account Live SLIDE CENTER, lo stesso account abilita anche il PC desktop. Niente costi extra.

---

## 2. Prerequisiti hardware e software

### Hardware minimo

| Componente   | Specifica                                                            |
| ------------ | -------------------------------------------------------------------- |
| **CPU**      | Intel i5 di 8a generazione o equivalente (4 core, 2 GHz)             |
| **RAM**      | 8 GB (16 GB consigliati per eventi >50 sale)                         |
| **Storage**  | SSD da 256 GB minimo (file evento medi: 30-100 GB)                   |
| **Rete**     | Porta Ethernet Gigabit (consigliato cavo, WiFi solo come fallback)   |
| **Sistema**  | Windows 10 (build 19041+) o Windows 11, x64                          |

### Hardware consigliato per eventi grandi

- **CPU:** Intel i7 di 11a gen o AMD Ryzen 7 5000 series.
- **RAM:** 32 GB.
- **Storage:** SSD NVMe da 1 TB (M.2 PCIe).
- **Rete:** doppia scheda Gigabit (una per LAN evento, una per uplink internet opzionale).
- **UPS:** gruppo di continuità per evitare crash da blackout improvvisi.

### Software prerequisito

L'installer si occupa di tutto. Comunque verifica:

- Windows aggiornato all'ultima patch di sicurezza.
- Antivirus diverso da Defender? Aggiungi un'esclusione per la cartella di installazione (vedi sezione 10).

---

## 3. Download e installazione

### 3.1 Scarica l'installer

L'installer si chiama `Live SLIDE CENTER Desktop_<versione>_x64-setup.exe` (esempio: `Live SLIDE CENTER Desktop_0.1.0_x64-setup.exe`).

Lo trovi su:

- **Repository GitHub release:** [https://github.com/live-software11/live-slide-center/releases/latest](https://github.com/live-software11/live-slide-center/releases/latest)
- Oppure ti viene fornito direttamente da Andrea Rizzari (link diretto o chiavetta USB).

Verifica integrità (opzionale ma consigliato):

```powershell
Get-FileHash -Path "Live SLIDE CENTER Desktop_0.1.0_x64-setup.exe" -Algorithm SHA256
```

L'hash deve corrispondere a quello pubblicato nelle release notes su GitHub.

### 3.2 Esegui l'installer

1. Doppio click sull'installer.
2. Windows mostrerà un avviso SmartScreen ("Windows ha protetto il PC"). Click su **Maggiori informazioni** → **Esegui comunque**.
3. Accetta l'EULA (in italiano, lingua dell'installer selezionabile).
4. Conferma il percorso di installazione (default: `%LOCALAPPDATA%\Live SLIDE CENTER`).
5. L'installer:
   - copia i file dell'app,
   - crea un'eccezione firewall Windows per la porta locale (necessaria per i PC sala),
   - aggiunge un'esclusione Windows Defender per evitare scansioni rallentanti durante l'evento,
   - forza il profilo di rete Windows su **Privata** (necessario per la discovery mDNS),
   - crea collegamento desktop e voce nel menu Start.
6. Click **Fine**.

L'installazione dura circa 30-60 secondi.

---

## 4. Primo avvio

1. Doppio click sull'icona desktop **Live SLIDE CENTER**.
2. Al primo avvio l'app chiede:

   > **Che ruolo ha questo PC?**
   > - **Centro Slide / Admin** — questo PC riceve e distribuisce contributi (scegli questa)
   > - **PC sala / Player** — questo PC è dietro il proiettore e mostra solo le slide

   **Scegli "Centro Slide / Admin"** e clicca **Conferma**.

3. L'app riavvia automaticamente con il ruolo scelto. Il server locale parte in background (porta 7300) e annuncia la sua presenza in LAN tramite mDNS.

4. Vedrai la schermata di **login**:
   - Se hai già un account cloud Live SLIDE CENTER → fai login con email + password.
   - Se non hai un account → contatta Andrea Rizzari per attivare la prima licenza tenant.

5. Dopo il login arrivi alla **Dashboard**, identica a quella web. Da qui puoi:
   - Creare un nuovo evento,
   - Caricare i contributi,
   - Creare le sale,
   - Generare i magic-link per i PC sala.

---

## 5. Collegamento al cloud (bind licenza)

Anche se userai il PC offline durante l'evento, devi **collegarlo una volta** al cloud per attivare la licenza. Bastano 30 secondi.

### Procedura veloce

**Sul tuo browser** (es. laptop o tablet, NON sul PC Centro Slide):

1. Apri [https://live-slide-center.vercel.app/](https://live-slide-center.vercel.app/) e fai login come admin del tenant.
2. Nel menu sinistra clicca **Centri Slide**.
3. Click su **Genera link** → scegli "1 PC" + scadenza 24 ore + (opzionale) etichetta "Centro Slide sala plenaria".
4. Apparirà un dialog con un **QR code + URL**. **Stampalo o copialo** (il link è mostrato UNA volta sola).

**Sul PC Centro Slide:**

1. Apri Live SLIDE CENTER Desktop.
2. Vai in **Centro Slide → Licenza** (link nel menu sinistra in basso, oppure URL diretto `/centro-slide/licenza`).
3. Incolla l'URL del magic-link nel campo **Magic-link**.
4. Click **Collega**. In 1-2 secondi vedrai:

   > ✅ **Licenza attiva** — Tenant: <nome cloud>, Plan: <piano>

5. Da questo momento il PC è collegato al cloud. La verifica si rinnova automaticamente ogni 6 ore quando il PC è connesso a internet.

### Cosa succede se il PC va offline

- Per **30 giorni** continua a funzionare normalmente in modalità LAN.
- Dopo 30 giorni offline, le funzioni cloud (sync utenti, billing, etc.) si disabilitano. La modalità LAN locale resta sempre attiva — i file dell'evento corrente continuano a essere distribuiti ai PC sala.

### Come scollegare il PC

Dal pannello **Centri Slide** sul cloud → click sul cestino accanto al PC. Il PC verrà revocato e dovrai rigenerare un magic-link per ricollegarlo.

---

## 6. Verifica rete LAN

Dopo l'installazione e il bind, verifica che il PC Centro Slide sia visibile dalla LAN.

### Test 1: Server locale

Sul PC Centro Slide apri il browser e vai su:

```
http://127.0.0.1:7300/health
```

Deve rispondere con qualcosa tipo:

```json
{ "ok": true, "role": "admin", "version": "0.1.0" }
```

Se non risponde → l'app non è partita correttamente. Riavvia l'app o vedi sezione 10.

### Test 2: Discovery mDNS

Da un altro PC della stessa LAN (es. il tuo laptop), apri PowerShell:

```powershell
# Su Windows 10/11 (richiede installato dns-sd, oppure Bonjour from Apple)
dns-sd -B _slidecenter._tcp local
```

Devi vedere il PC Centro Slide elencato. Se non appare:

- Verifica che siano sulla stessa rete (stesso router/switch).
- Verifica che il profilo di rete Windows sia "Privata" (Pannello di controllo → Rete e Internet).
- Disabilita temporaneamente VPN client che catturano traffico multicast.

### Test 3: Apertura porta da PC sala

Da un PC sala (browser, anche tablet):

```
http://<IP-LAN-Centro-Slide>:7300
```

Esempio se il Centro Slide ha IP `192.168.1.50`:

```
http://192.168.1.50:7300
```

Deve aprirsi la **stessa interfaccia del cloud**. Da qui il tablet/PC sala può fare il pairing con il magic-link sala (vedi flusso "Sala / PC Player" nella documentazione separata).

---

## 7. Test prima dell'evento

Checklist da eseguire **48 ore prima** dell'evento (non il giorno stesso!):

- [ ] PC Centro Slide acceso, connesso a UPS, antivirus aggiornato e Defender exclusions OK.
- [ ] Windows aggiornato (riavvio se serve, sicuramente prima dell'evento).
- [ ] Live SLIDE CENTER Desktop ultima versione (controlla banner "Aggiornamento disponibile" in alto).
- [ ] Licenza cloud collegata (vedi sezione 5).
- [ ] Server locale risponde a `http://127.0.0.1:7300/health`.
- [ ] Almeno un PC sala riesce a connettersi e fare pairing tramite magic-link.
- [ ] Evento di test creato sul cloud, almeno 5 file caricati.
- [ ] PC sala riceve i file (verifica progressivo download nella UI).
- [ ] **Failover test:** stacca cavo internet → l'app deve continuare a funzionare. Riattacca → deve riconnettersi senza intervento.
- [ ] **Restart test:** riavvia il PC Centro Slide → l'app si riavvia, server locale parte, PC sala si riconnettono in <30s.

---

## 8. Aggiornamenti automatici

L'app controlla nuove versioni **al boot** e **ogni 30 minuti** quando online. Quando trova un aggiornamento mostra un banner sticky in alto:

> ⬆️ **Aggiornamento disponibile: v0.1.5** — [Installa] [Più tardi]

Click su **Installa** scarica l'aggiornamento firmato (verifica crittografica Ed25519), lo installa in modalità silenziosa (~1 minuto) e riavvia l'app automaticamente.

**Importante:** non installare aggiornamenti durante un evento in corso. Aspetta la pausa pranzo o fine giornata.

Per disabilitare temporaneamente il banner, click su **Più tardi** (riapparirà al prossimo cambio versione).

---

## 9. Disinstallazione

L'installer aggiunge una voce in **Pannello di controllo → Programmi e funzionalità**. Per disinstallare:

1. Apri **Impostazioni Windows → App → App installate**.
2. Cerca "Live SLIDE CENTER".
3. Click **Disinstalla**.

L'uninstaller chiede:

> **Conservare i dati dell'evento?**
> - **Sì** (consigliato) — i file in `%USERPROFILE%\SlideCenter` restano sul disco. Reinstallando l'app li ritrovi tutti.
> - **No** — elimina anche la cartella dati. Operazione irreversibile.

Inoltre l'uninstaller:

- rimuove l'eccezione firewall Windows,
- rimuove l'esclusione Windows Defender,
- rimuove le voci Start menu e desktop,
- **NON tocca** il file `~/.slidecenter/license.enc` (così se reinstalli puoi riprendere senza ribindare).

Per rimozione completa anche delle preferenze utente:

```powershell
Remove-Item -Recurse "$env:USERPROFILE\.slidecenter"
Remove-Item -Recurse "$env:USERPROFILE\SlideCenter"   # solo se hai scelto di non conservare i dati
```

---

## 10. Risoluzione problemi

### App non parte / si chiude subito

**Sintomo:** doppio click sull'icona, l'app appare per 1 secondo e si chiude.

**Cause possibili:**

- **Antivirus aggressivo** (Norton, Kaspersky, McAfee). Aggiungi esclusione per:
  ```
  %LOCALAPPDATA%\Live SLIDE CENTER\
  ```
- **Porta 7300 occupata** da altro processo. Verifica con:
  ```powershell
  Get-NetTCPConnection -LocalPort 7300
  ```
  Se occupata, kill del processo (di solito un'altra istanza Live SLIDE CENTER lasciata in background).

### PC sala non vede il Centro Slide

**Sintomo:** dal PC sala digiti l'IP del Centro Slide nel browser e ricevi "Sito irraggiungibile".

**Cause possibili:**

1. **Firewall Windows** sta bloccando. Verifica:
   - Pannello di controllo → Windows Defender Firewall → Impostazioni avanzate → Regole connessioni in entrata.
   - Cerca "Live SLIDE CENTER Desktop" → deve esserci, abilitata su rete Privata.
   - Se manca: disinstalla e reinstalla (l'installer aggiunge la regola automaticamente).

2. **Profilo di rete su Pubblica.** Apri **Impostazioni → Rete e Internet → Wi-Fi/Ethernet → Proprietà** e seleziona **Privata**.

3. **VPN client attivo** sul Centro Slide. Disattiva.

4. **PC sala su VLAN diversa.** Verifica in switch/router di rete.

### Bind licenza fallisce con "rate_limited"

Hai fatto troppi tentativi. Aspetta 5 minuti e riprova. Se persiste, contatta Andrea.

### Bind licenza fallisce con "token_expired" / "token_exhausted"

Il magic-link che hai usato è scaduto o è già stato consumato. Genera un nuovo magic-link dal pannello cloud Centri Slide e riprova.

### Banner "Verifica licenza non riuscita da N giorni"

Il PC è offline da troppo tempo. Connettilo a internet e click su **Verifica ora** nel banner. Se i giorni superano 30, le funzioni cloud sono disabilitate ma la modalità LAN locale continua a funzionare.

### Aggiornamento installa ma l'app non riparte

Avvia manualmente dall'icona desktop o dal menu Start. Se persiste:

1. Disinstalla.
2. Reinstalla l'ultima versione scaricata da GitHub Releases.
3. La licenza resta intatta (file `license.enc` in `~/.slidecenter`).

---

## Supporto

Per problemi non risolti dalla guida:

- **Tecnico:** Andrea Rizzari — `live.software11@gmail.com`
- **Repository issue tracker:** [https://github.com/live-software11/live-slide-center/issues](https://github.com/live-software11/live-slide-center/issues)

Quando apri un ticket includi:

- Versione app (`Help → About` o footer in basso a destra).
- Versione Windows (`winver`).
- Log app: `%LOCALAPPDATA%\Live SLIDE CENTER\logs\app.log` (ultimi 100 righe).
- Screenshot dell'errore.
