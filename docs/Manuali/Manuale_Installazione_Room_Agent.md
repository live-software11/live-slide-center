# Manuale Installazione — Room Agent (PC sala)

> Pubblico: operatore PC sala / IT del cliente.
> Versione: 0.1.1 — Sprint 4 (17 Aprile 2026)

## 1. Cosa fa il Room Agent

Il Room Agent gira sul **PC della sala** dove avviene la presentazione (palco,
auditorium, sala riunioni). Ha quattro funzioni:

1. **Discovery automatica** del Local Agent in regia (4 metodi: file UNC -> UDP
   broadcast -> mDNS -> IP manuale).
2. **Polling** continuo verso il Local Agent (ogni 5s) per scaricare nuove
   versioni dei file della sala assegnata.
3. **Salvataggio locale** in `%LOCALAPPDATA%\SlideCenter\<roomId>\` con strip
   automatico del Mark-of-the-Web (i file aperti da PowerPoint/Acrobat non
   vedranno il banner "Visualizzazione protetta").
4. **Tray icon** Windows con stato: verde (sync OK), giallo (download in corso),
   rosso (offline), grigio (non configurato).

## 2. Requisiti hardware

| Componente       | Minimo                      | Consigliato                 |
| ---------------- | --------------------------- | --------------------------- |
| CPU              | x86_64 dual-core            | qualsiasi PC della sala     |
| RAM              | 4 GB                        | 8 GB                        |
| Disco            | spazio per le presentazioni | SSD                         |
| Rete             | Ethernet o WiFi             | Ethernet                    |
| OS               | Windows 10 22H2 / 11        | Windows 11 24H2             |
| WebView2 Runtime | Si (gia su Win 11)          | (auto-installato dal setup) |

## 3. Installazione (procedura standard)

1. Copia `Live-SLIDE-CENTER-Room-Agent-Setup-0.1.0.exe` sul PC della sala.
2. **Doppio click** sull'installer.
3. Se appare SmartScreen: "Maggiori informazioni" -> "Esegui comunque"
   (sparira con il code-signing in Sprint 5).
4. Conferma l'UAC: serve UNA SOLA volta per:
   - escludere `%LOCALAPPDATA%\SlideCenter\` da Windows Defender (PowerPoint
     apre file da li, lo scan continuo causa lag visibile sulle slide grandi),
   - settare il profilo di rete attivo a "Privato" (necessario per ricevere
     pacchetti UDP broadcast e mDNS dalla LAN),
   - aprire UDP 5353 in entrata sull'eseguibile per le risposte mDNS,
   - installare WebView2 Runtime se assente.
5. Il Room Agent **NON** apre porte HTTP in entrata: e solo client verso il
   Local Agent.
6. Il Room Agent si registra in autostart HKCU (parte automaticamente al login
   utente, niente UAC al boot).

## 4. Attivazione licenza (build di vendita — `--features license`)

Se hai ricevuto un Room Agent **con sistema licenze attivo**, al primo avvio
la finestra mostra un overlay rosso a schermo intero con il messaggio
"Attivazione licenza richiesta". **Discovery, polling, autostart e tray icon
restano spenti** finche la licenza non e' attiva.

Procedura di attivazione (identica al Local Agent ma con chiave separata per il PC sala):

1. Recupera la chiave licenza per **questo PC sala specifico** dall'email di
   Andrea Rizzari Live Software. Ogni PC sala consuma uno slot del
   product `slide-center-room-agent` della licenza del cliente.
2. Incolla la chiave `LIVE-XXXX-XXXX-XXXX-XXXX` nella card "Licenza".
3. Clicca **"Attiva"**:
   - viene calcolato il fingerprint hardware del PC sala (CPU + scheda madre + disco, SHA-256),
   - inviato a Live WORKS APP insieme alla chiave,
   - la risposta puo essere "Attiva" oppure "In attesa di approvazione" (in
     quest'ultimo caso il Room Agent fa polling automatico ogni 30 secondi).
4. Quando lo stato diventa "Licenza attiva" (pillola verde), l'overlay sparisce
   e tray + discovery partono normalmente.

> **Suggerimento operativo**: per clienti con N sale, prepara N chiavi licenza
> distinte gia in fase di vendita su Live WORKS APP, etichettandole "Sala 1",
> "Sala 2"... cosi l'IT del cliente sa quale chiave incollare su quale PC.

### 4.1 Cambio PC sala / sostituzione hardware

Se sostituisci il PC sala 3 con uno nuovo:

1. **Vecchio PC** (se accessibile): apri Room Agent, card "Licenza", clicca
   **"Disattiva"**. Lo slot hardware viene liberato in cloud.
2. **Nuovo PC**: incolla la stessa chiave della Sala 3 e clicca "Attiva".

Se il vecchio PC e' rotto, contatta Andrea Rizzari Live Software: lo slot puo
essere liberato manualmente da dashboard.

### 4.2 Fingerprint hardware

Bottone **"Copia fingerprint"** sulla card licenza copia un hash SHA-256 a 64
caratteri (CPU + MotherBoard + Primo disco). Allegalo all'email di assistenza
per debug rapido degli slot hardware.

### 4.3 Modalita offline

Una licenza attivata viene salvata cifrata (AES-256-GCM, chiave unica per Room
Agent) in `%APPDATA%\com.livesoftware.slidecenter.roomagent\license.enc`.
Verifica online ogni 7 giorni con grace period di 30 giorni: durante un evento
di una settimana senza internet la sala continua a funzionare regolarmente.

## 5. Prima configurazione (al primo avvio)

Una volta attivata la licenza (cap. 4) o se stai usando una build di sviluppo
senza feature `license`:

1. La finestra principale si apre con il pannello "Local Agent — discovery"
   in alto.
2. Clicca **"Cerca ora"**: il Room Agent prova in cascata:
   1. file UNC `\\<host-regia>\SlideCenter$\agent.json` (Sprint 5 — opzionale)
   2. broadcast UDP `255.255.255.255:9999`
   3. mDNS browse `_slide-center._tcp.local.`
   4. IP manuale (se configurato)
3. Quando trova il Local Agent, mostra:
   - metodo usato (es. "Broadcast UDP")
   - indirizzo (es. `192.168.1.50:8080`)
   - hostname e versione del Local Agent
4. Inserisci **ID Sala** e **ID Evento** (li ricevi dall'amministratore
   workspace via dashboard `/admin/devices`).
5. Clicca **"Connetti e avvia sync"**.
6. Da quel momento ogni 5 secondi il Room Agent scarica eventuali aggiornamenti.

## 6. Modalita di connettivita (badge UI)

| Stato               | Badge  | Significato                                              |
| ------------------- | ------ | -------------------------------------------------------- |
| Cloud diretto       | Verde  | Internet OK, scarica direttamente da Supabase Storage    |
| LAN via Local Agent | Verde  | Internet OK + Local Agent risponde: download via LAN     |
| Solo intranet       | Giallo | Internet KO ma Local Agent OK: presentazioni disponibili |
| Offline (cache)     | Rosso  | Tutto KO: serve solo dalla cache locale                  |

In modalita "Solo intranet" la sala continua a funzionare: il Local Agent in
regia ha gia tutta la cache, e il Room Agent la scarica via LAN senza chiamate
a internet.

## 7. Discovery — fallback IP manuale

Se la discovery automatica fallisce (LAN molto restritta, AP che blocca
broadcast):

1. Trova l'IP del Local Agent: in regia apri il Local Agent, leggi l'IP
   nell'header (es. `192.168.1.50:8080`).
2. Sul PC sala: inserisci `192.168.1.50:8080` nel campo "IP manuale Local Agent".
3. Clicca **"Salva indirizzo manuale"**.
4. La cache discovery (60s) viene invalidata e il sync riparte usando l'IP fisso.

## 8. Troubleshooting

| Problema                                     | Causa probabile                  | Soluzione                                                                                   |
| -------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| Discovery non trova il Local Agent           | Broadcast UDP bloccato dall'AP   | Inserisci IP manuale (vedi sezione 7)                                                       |
| File non si scaricano nonostante "Connesso"  | Pairing scaduto / ID Sala errato | Verifica ID Sala + ID Evento. Rigenera dalla dashboard `/admin/devices`                     |
| PowerPoint mostra "Visualizzazione protetta" | MOTW non rimosso                 | Verifica `apps/room-agent/src-tauri/src/motw.rs` attivo (default ON dalla v0.1)             |
| Lag aprendo le presentazioni                 | Defender scan continuo           | PowerShell admin: `Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\SlideCenter" -Force`  |
| Tray icon grigia / nessuna interazione       | Profilo rete "Pubblica"          | Pannello rete -> Imposta su "Privata"                                                       |
| Tray icon rossa "Offline"                    | Local Agent non risponde         | Vedi Manuale Local Agent, sezione 7                                                         |
| File scaricati incompleti dopo crash         | Rename atomico funziona          | Riavvia il Room Agent: i file `.part` vengono ignorati e ridownloadati                      |
| Card licenza "Errore: dispositivi esauriti"  | Slot hardware tutti occupati     | Disattiva la licenza su un PC sala non piu in uso, o richiedi piu slot a Live Software      |
| Card licenza "Hardware diverso"              | License.enc copiato da altro PC  | Esegui "Disattiva" e "Attiva" da capo: il fingerprint nuovo verra' rebindato (consuma slot) |
| Overlay rosso "Verifica richiesta"           | >30 giorni senza internet        | Connetti il PC sala a internet (anche tethering) e clicca "Verifica ora"                    |

## 9. Manutenzione

- **Aggiornamenti**: scaricare il nuovo `Live-SLIDE-CENTER-Room-Agent-Setup-X.Y.Z.exe`,
  doppio click. La cartella delle presentazioni, l'autostart e la licenza
  attivata (`license.enc`) vengono preservati.
- **Disinstallazione pulita**: Pannello di controllo -> App -> "Live SLIDE
  CENTER Room Agent" -> Disinstalla. L'installer:
  - lancia `room-agent.exe --deactivate` (se feature `license` compilata):
    libera lo slot hardware su Live WORKS APP e cancella `license.enc`.
  - rimuove tutte le regole firewall e l'esclusione Defender.
- **Reset cache locale** (NON tocca licenza): chiudi il Room Agent dal tray,
  elimina manualmente `%LOCALAPPDATA%\SlideCenter\<roomId>\` e riavvia. Il
  prossimo poll verso il Local Agent rifara il download.

## 10. Modalita portable (rescue)

Se non e possibile installare (PC del cliente con regole IT restritte):

1. Scompatta `Live-SLIDE-CENTER-Room-Agent-Portable-0.1.0.zip` su Desktop.
2. Doppio click su `live-slide-center-room-agent.exe`.
3. Al primo avvio Windows mostrera due prompt:
   - "Consenti accesso rete pubblica/privata?" -> spunta **entrambe**.
   - "Consenti modifiche al sistema?" -> **No** (il portable non ne ha bisogno).
4. La discovery automatica potrebbe non trovare il Local Agent (profilo rete
   non impostato a Private). Usa l'IP manuale (sezione 6).
5. Il Room Agent in modalita portable **non** ha autostart: deve essere lanciato
   manualmente ad ogni boot.

Per produzione usare sempre la versione NSIS.
