# Manuale Installazione — Local Agent (mini-PC regia) — LEGACY

> **STATO: LEGACY (Tauri 1).** Per nuove installazioni Centro Slide usare `Manuale_Centro_Slide_Desktop.md` (Tauri 2 unificato `apps/desktop`, single binary). Questo manuale resta valido per i clienti gia' installati con setup tradizionale a 2 binari (Local Agent + Room Agent). Per dettagli architetturali vedi `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 4.
>
> Pubblico: operatore di regia / IT del cliente con setup legacy.
> Versione: 0.1.1 — Sprint 4 (17 Aprile 2026)
> Banner LEGACY aggiunto: 19 aprile 2026 (Sprint W docs overhaul).

## 1. Cosa fa il Local Agent

Il Local Agent gira sul **mini-PC in regia** durante l'evento. Ha tre funzioni:

1. **Cache locale** delle presentazioni in `%LOCALAPPDATA%\LiveSLIDECENTER\` (SQLite WAL).
2. **Server HTTP locale** (`http://<lan-ip>:8080`) che serve i file ai Room Agent.
3. **Discovery LAN**: risponde a query UDP broadcast `:9999` e si annuncia via mDNS
   (`_slide-center._tcp.local.`) per essere trovato automaticamente dai Room Agent.

In **modalita intranet pura** (LAN senza internet) tutto continua a funzionare:
i Room Agent scaricano dal Local Agent e l'evento prosegue normalmente.

## 2. Requisiti hardware

| Componente       | Minimo               | Consigliato                     |
| ---------------- | -------------------- | ------------------------------- |
| CPU              | x86_64 dual-core     | quad-core (Intel N100, Ryzen 3) |
| RAM              | 4 GB                 | 8 GB                            |
| Disco            | 64 GB SSD            | 256 GB SSD                      |
| Rete             | Ethernet 100 Mbit    | Ethernet Gigabit                |
| OS               | Windows 10 22H2 / 11 | Windows 11 24H2                 |
| WebView2 Runtime | Si (gia su Win 11)   | (auto-installato dal setup)     |

## 3. Installazione (procedura standard)

1. Copia `Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe` sul mini-PC.
2. **Doppio click** sull'installer.
3. Se Windows mostra "SmartScreen ha bloccato un'app non riconosciuta": clicca
   "Maggiori informazioni" -> "Esegui comunque" (sparira con il code-signing
   in Sprint 5).
4. Conferma il prompt UAC ("Vuoi consentire a quest'app di apportare modifiche?")
   cliccando **Si**: serve UNA SOLA volta per:
   - aprire la regola firewall TCP 8080 + UDP 9999 + UDP 5353 (profili `private,domain`),
   - escludere `%LOCALAPPDATA%\LiveSLIDECENTER\` da Windows Defender,
   - settare il profilo di rete attivo a "Privato",
   - installare WebView2 Runtime se assente (silenzioso).
5. L'installer crea l'icona "Live SLIDE CENTER Agent" nel menu Start.
6. Avvia il Local Agent dal menu Start: si apre la finestra principale.

## 4. Attivazione licenza (build di vendita — `--features license`)

Se hai ricevuto un installer **con sistema licenze attivo**, al primo avvio
l'app mostra un overlay rosso a schermo intero con titolo "Attivazione licenza
richiesta". Senza licenza valida, **nessuna funzione e' disponibile**:
sync cloud, server HTTP locale, mDNS sono tutti spenti finche la licenza non
e' attiva.

Procedura di prima attivazione:

1. Recupera la chiave licenza dall'email di Andrea Rizzari Live Software:
   formato `LIVE-XXXX-XXXX-XXXX-XXXX`.
2. Incolla la chiave nel campo "Chiave licenza" della card "Licenza".
3. Clicca **"Attiva"**. L'app:
   - calcola un **fingerprint hardware** unico del PC (CPU + scheda madre + disco — SHA-256),
   - lo invia ai server Live WORKS APP insieme alla chiave,
   - aspetta la risposta.
4. **Caso A — attivazione automatica**: la card mostra "Licenza attiva" verde
   con nome cliente e data di scadenza. L'overlay sparisce e l'app e' operativa.
5. **Caso B — approvazione manuale richiesta** (default per nuovi clienti):
   la card mostra "In attesa di approvazione" giallo. Andrea / l'IT manager di
   Live Software riceve una notifica nella dashboard Live WORKS APP, verifica il
   fingerprint e approva. L'app **fa polling automatico ogni 30 secondi**: appena
   l'approvazione arriva, la licenza diventa attiva senza ulteriori azioni.

### 4.1 Cambio PC (rebinding)

Se il cliente cambia il mini-PC di regia o reinstalla Windows, la stessa chiave
licenza non puo' essere riusata se non si libera lo slot precedente:

1. Sul **vecchio PC** (se ancora accessibile): clicca **"Disattiva"** nella card
   licenza. L'app contatta Live WORKS APP, libera lo slot hardware e cancella
   `license.enc` locale.
2. Sul **nuovo PC**: incolla la chiave e clicca "Attiva" come al primo avvio.

Se il vecchio PC e' rotto / non accessibile, contatta Andrea Rizzari Live
Software via email: lo slot puo essere liberato manualmente da dashboard.

### 4.2 Fingerprint hardware

Per assistenza, puoi copiare il fingerprint del PC con il bottone **"Copia
fingerprint"** della card licenza. E' un hash SHA-256 a 64 caratteri esadecimali
calcolato su:

```
SHA256( SerialNumber_MotherBoard | ProcessorId_CPU | SerialNumber_PrimoDisco )
```

Non contiene dati personali, ma identifica univocamente il PC. Allegalo
all'email di assistenza: aiuta a verificare lo slot hardware su Live WORKS APP.

### 4.3 Modalita offline e grace period

Una licenza attivata non richiede internet ad ogni avvio: il file
`license.enc` (cifrato AES-256-GCM con chiave unica per agent) viene salvato in
`%APPDATA%\com.livesoftware.slidecenter.agent\license.enc` e ricaricato al
boot. **Verifica online ogni 7 giorni** (per controllare scadenza ed eventuali
revoche), con **grace period di 30 giorni** se non c'e internet: l'app continua
a funzionare anche per un evento intero senza connettivita.

Dopo 30 giorni offline consecutivi, la card mostra "Verifica richiesta"
e si chiede di tornare online almeno una volta.

## 5. Configurazione iniziale (sync cloud + LAN)

Una volta attivata la licenza (cap. 4) o se stai usando una build di sviluppo
senza feature `license`, configura il device:

1. Verifica che il **bind IP** sia su una scheda di rete LAN (non `127.0.0.1`).
   Tipicamente l'IP rilevato e mostrato nell'header (es. `192.168.1.50:8080`).
2. Inserisci l'**ID Tenant** ricevuto via email dopo l'attivazione della
   licenza Slide Center.
3. Inserisci la **chiave di pairing** generata dalla dashboard web Slide Center
   (`/admin/devices`).
4. Clicca **"Pair device"**: il Local Agent ottiene un token e inizia il sync
   continuo con il cloud.

## 6. Scenari di funzionamento

### Scenario A — Internet OK (cloud + LAN)

```
Cloud Supabase  <--- Local Agent ---> 2-N Room Agent (LAN)
                       (cache)           (download via http://<ip>:8080)
```

I Room Agent privilegiano la LAN per ridurre latenza e banda WAN. Se il Local
Agent non risponde, fanno fallback automatico sul cloud.

### Scenario B — Internet KO (intranet pura)

```
[Internet ASSENTE]
                     Local Agent ---> 2-N Room Agent (LAN)
                       (cache)
```

Il Local Agent serve solo file gia in cache. I Room Agent vedono il chip
"Solo intranet (offline)" e continuano a funzionare per le presentazioni gia
distribuite. Quando internet torna, il sync cloud riparte automaticamente
entro 30 secondi.

## 7. Troubleshooting

| Problema                                          | Causa probabile                 | Soluzione                                                                                                   |
| ------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Room Agent non trovano il Local Agent             | Profilo rete su "Pubblica"      | Pannello rete -> Imposta su "Privata" (l'installer lo fa, ma puo essere stato cambiato)                     |
| Firewall blocca le query UDP                      | Regola installer rimossa        | Esegui da PowerShell admin: `netsh advfirewall firewall show rule name="Live SLIDE CENTER Agent Discovery"` |
| Defender quarantine `local-agent.exe`             | Esclusione installer rimossa    | PowerShell admin: `Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\LiveSLIDECENTER" -Force`              |
| Bind IP `127.0.0.1` (loopback)                    | Solo scheda virtuale            | Connetti il mini-PC a una rete LAN reale e riavvia il Local Agent                                           |
| `Errore 401` durante pairing                      | Token scaduto                   | Genera una nuova chiave di pairing dalla dashboard web                                                      |
| Sync cloud bloccato a "ultimo tentativo: timeout" | Internet KO                     | Verifica connettivita; il sync ripartira automaticamente                                                    |
| Card licenza "Errore: dispositivi esauriti"       | Slot hardware tutti occupati    | Disattiva su un PC non piu in uso, o contatta Live Software per ampliare lo slot                            |
| Card licenza "Hardware diverso"                   | License.enc copiato da altro PC | Esegui "Disattiva" e "Attiva" da capo: il fingerprint nuovo verra' rebindato (consuma uno slot)             |
| Overlay rosso "Verifica richiesta"                | >30 giorni senza internet       | Connetti il PC a internet (anche tethering) e clicca "Verifica ora" sulla card                              |

## 8. Manutenzione

- **Aggiornamenti**: scaricare il nuovo `Live-SLIDE-CENTER-Agent-Setup-X.Y.Z.exe`
  dalla dashboard Live WORKS APP, doppio click. L'installer aggiorna senza
  perdere la cache locale, il pairing del device, ne la licenza attiva
  (`license.enc` viene preservato).
- **Disinstallazione pulita**: Pannello di controllo -> App -> "Live SLIDE
  CENTER Agent" -> Disinstalla. L'installer:
  - lancia `local-agent.exe --deactivate` (se feature `license` compilata):
    chiama `/license/deactivate` su Live WORKS APP per liberare lo slot hardware
    e cancella `license.enc`.
  - rimuove tutte le regole firewall e l'esclusione Defender.
- **Reset cache locale** (NON tocca licenza): chiudi il Local Agent, elimina
  manualmente `%LOCALAPPDATA%\LiveSLIDECENTER\` e riavvia. Il sync cloud rifara
  il download da Supabase Storage. La licenza in `%APPDATA%\com.livesoftware.slidecenter.agent\`
  resta intatta.

## 9. Modalita portable (rescue)

Se l'installer NSIS non puo essere usato (PC senza diritti admin, demo veloce
su PC altrui):

1. Scompatta `Live-SLIDE-CENTER-Agent-Portable-0.1.0.zip` su Desktop.
2. Doppio click su `live-slide-center-agent.exe`.
3. Al primo avvio, Windows chiedera "Vuoi consentire a quest'app sulla rete
   pubblica/privata?": spunta **entrambe** e clicca "Consenti l'accesso".
4. Il portable funziona come la versione installata, ma:
   - non setta il profilo rete a "Privato" (devi farlo a mano)
   - non esclude la cartella da Defender (puo rallentare il primo sync)
   - non ha autostart al login

Per produzione usare sempre la versione NSIS.
