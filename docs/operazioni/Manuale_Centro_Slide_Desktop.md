# Manuale Centro Slide Desktop — Setup + Smoke Test

> **Versione:** 1.0 (2026-04-19) — fusione di `Setup_PC_Centro_Slide.md` + `Smoke_Test_Centro_Slide.md`.
> **Lettori:** Parte A → tecnici/staff IT che installano sul campo. Parte B → sviluppatori (Andrea + AI agent) prima di ogni release.
> **Stack:** Tauri 2 + Rust (`apps/desktop`), Windows 10/11 x64, server locale porta 7300, mDNS `_slidecenter._tcp`.

---

## Indice

**Parte A — Setup operativo (tecnici)**
- [A.1 Cosa fa il PC Centro Slide](#a1-cosa-fa-il-pc-centro-slide)
- [A.2 Prerequisiti hardware e software](#a2-prerequisiti-hardware-e-software)
- [A.3 Download e installazione](#a3-download-e-installazione)
- [A.4 Primo avvio e scelta ruolo](#a4-primo-avvio-e-scelta-ruolo)
- [A.5 Bind licenza cloud](#a5-bind-licenza-cloud)
- [A.6 Verifica rete LAN](#a6-verifica-rete-lan)
- [A.7 Test 48 ore prima dell'evento](#a7-test-48-ore-prima-dellevento)
- [A.8 Aggiornamenti automatici](#a8-aggiornamenti-automatici)
- [A.9 Disinstallazione](#a9-disinstallazione)
- [A.10 Risoluzione problemi](#a10-risoluzione-problemi)

**Parte B — Smoke test QA pre-release (sviluppatori)**
- [B.1 Setup ambiente test](#b1-setup-ambiente-test)
- [B.2 Build & installer](#b2-build--installer)
- [B.3 Installazione PC1 admin](#b3-installazione-pc1-centro-slide)
- [B.4 Bind licenza cloud](#b4-bind-licenza-cloud-test)
- [B.5 Heartbeat e offline grace](#b5-heartbeat-e-offline-grace-sprint-d6)
- [B.6 Pannello admin Centri Slide](#b6-pannello-admin-centri-slide)
- [B.7 PC sala e toggle ruolo](#b7-pc-sala-e-toggle-ruolo)
- [B.8 Deep-link `/centro-slide/bind`](#b8-deep-link-centro-slidebind)
- [B.9 Aggiornamenti automatici (manuale)](#b9-aggiornamenti-automatici-manuale-opzionale)
- [B.10 Disinstallazione](#b10-disinstallazione-test)
- [B.11 Edge cases (regressione)](#b11-edge-cases-regressione)
- [B.12 RLS & isolation tenant](#b12-rls--isolation-tenant)
- [Output report da copiare in CHANGELOG](#output-report-da-copiare-in-changelog)

---

# PARTE A — Setup operativo

## A.1 Cosa fa il PC Centro Slide

Il PC Centro Slide è il **cervello dell'evento**: raccoglie i contributi (slide, video, foto, PDF) caricati dai relatori o dai PC sala e li **distribuisce ai PC sala** in tempo reale tramite la LAN dell'evento.

In pratica:

- **Funziona OFFLINE** — non serve internet durante l'evento, basta la LAN (cavo o WiFi privato).
- **Stessa interfaccia del cloud** — chi sa usare Live SLIDE CENTER su browser sa già usare il desktop.
- **Backup automatico** — i file restano sul PC anche dopo la disinstallazione (se scegli "Conserva dati").
- **Licenza condivisa col cloud** — un account Live SLIDE CENTER abilita anche il PC desktop. Niente costi extra.

## A.2 Prerequisiti hardware e software

### Hardware minimo

| Componente | Specifica |
|------------|-----------|
| **CPU**     | Intel i5 8a generazione o equivalente (4 core, 2 GHz) |
| **RAM**     | 8 GB (16 GB consigliati per eventi >50 sale) |
| **Storage** | SSD 256 GB minimo (file evento medi: 30-100 GB) |
| **Rete**    | Ethernet Gigabit (cavo consigliato, WiFi solo come fallback) |
| **Sistema** | Windows 10 build 19041+ o Windows 11, x64 |

### Hardware consigliato eventi grandi

- **CPU:** Intel i7 11a gen / AMD Ryzen 7 5000.
- **RAM:** 32 GB.
- **Storage:** SSD NVMe 1 TB (M.2 PCIe).
- **Rete:** doppia scheda Gigabit (LAN evento + uplink internet opzionale).
- **UPS:** gruppo di continuità per evitare crash da blackout.

### Software prerequisito

L'installer fa tutto. Verifiche manuali:

- Windows aggiornato all'ultima patch di sicurezza.
- Antivirus diverso da Defender → aggiungi esclusione per la cartella di installazione (vedi A.10).

## A.3 Download e installazione

### A.3.1 Scarica l'installer

Nome file: `Live SLIDE CENTER Desktop_<versione>_x64-setup.exe` (es. `Live SLIDE CENTER Desktop_0.1.0_x64-setup.exe`).

Reperibile da:
- **GitHub Releases:** <https://github.com/live-software11/live-slide-center/releases/latest>
- Oppure via Andrea Rizzari (link diretto / chiavetta USB).

Verifica integrità (consigliato):

```powershell
Get-FileHash -Path "Live SLIDE CENTER Desktop_0.1.0_x64-setup.exe" -Algorithm SHA256
```

L'hash deve corrispondere a quello pubblicato nelle release notes su GitHub.

### A.3.2 Esegui l'installer

1. Doppio click sull'installer.
2. SmartScreen avviserà ("Windows ha protetto il PC"): **Maggiori informazioni → Esegui comunque**.
3. Accetta l'EULA (italiano disponibile).
4. Conferma percorso (default `%LOCALAPPDATA%\Live SLIDE CENTER`).
5. L'installer:
   - copia i file dell'app,
   - crea eccezione firewall Windows porta 7300 su profilo Privato,
   - aggiunge esclusione Windows Defender,
   - forza il profilo di rete su **Privata** (necessario per mDNS),
   - crea collegamento desktop e voce nel menu Start.
6. Click **Fine**. Durata totale ~30-60 secondi.

## A.4 Primo avvio e scelta ruolo

1. Doppio click sull'icona **Live SLIDE CENTER**.
2. Al primo avvio appare il dialog "Che ruolo ha questo PC?"
   - **Centro Slide / Admin** — riceve e distribuisce contributi (scegli questa).
   - **PC sala / Player** — dietro il proiettore, mostra solo slide.
3. Scegli **Centro Slide / Admin** → **Conferma**.
4. L'app si riavvia col ruolo selezionato. Server locale porta 7300 in background, annuncio mDNS.
5. Schermata di **login**:
   - Account cloud esistente → email + password.
   - Niente account → contatta Andrea Rizzari per attivare la prima licenza tenant.
6. Dashboard identica al cloud. Da qui: crea evento, carica contributi, crea sale, genera magic-link PC sala.

## A.5 Bind licenza cloud

Il PC va collegato **una volta** al cloud per attivare la licenza, anche se userai offline durante l'evento. Bastano 30 secondi.

### Procedura veloce

**Sul tuo browser (laptop/tablet, NON il PC Centro Slide):**

1. Apri <https://live-slide-center.vercel.app/> e fai login come admin del tenant.
2. Menu sinistra → **Centri Slide**.
3. **Genera link** → "1 PC" + scadenza 24h + (opzionale) etichetta "Centro Slide sala plenaria".
4. Apparirà un dialog con **QR code + URL**: stampalo o copialo (mostrato UNA volta sola).

**Sul PC Centro Slide:**

1. Apri Live SLIDE CENTER Desktop.
2. **Centro Slide → Licenza** (link nel menu sinistra in basso, oppure URL `/centro-slide/licenza`).
3. Incolla l'URL del magic-link nel campo **Magic-link** → **Collega**.
4. In 1-2 secondi vedrai:
   > **Licenza attiva** — Tenant: <nome cloud>, Plan: <piano>
5. Da questo momento il PC è collegato. Verifica auto ogni 6 ore quando online.

### Cosa succede se il PC va offline

- Per **30 giorni** continua a funzionare normalmente in modalità LAN.
- Dopo 30 giorni offline, le funzioni cloud (sync utenti, billing) si disabilitano. La modalità LAN locale resta sempre attiva — i file dell'evento corrente continuano a essere distribuiti ai PC sala.

### Come scollegare il PC

Pannello **Centri Slide** sul cloud → cestino accanto al PC. Per ricollegarlo serve generare un nuovo magic-link.

## A.6 Verifica rete LAN

### Test 1: Server locale

Sul PC Centro Slide, apri il browser su:

```
http://127.0.0.1:7300/health
```

Risposta attesa:

```json
{ "ok": true, "role": "admin", "version": "0.1.0" }
```

Se non risponde → app non partita. Riavvia l'app o vedi A.10.

### Test 2: Discovery mDNS

Da un altro PC sulla stessa LAN, PowerShell:

```powershell
dns-sd -B _slidecenter._tcp local
```

(richiede Bonjour Apple o `dns-sd` installato). Devi vedere il PC Centro Slide elencato. Se non appare:
- Stessa rete (stesso router/switch)? Verifica.
- Profilo di rete Windows = "Privata"? Pannello → Rete e Internet.
- VPN client che cattura multicast? Disabilita temporaneamente.

### Test 3: Apertura porta da PC sala

Da un PC sala (browser, anche tablet):

```
http://<IP-LAN-Centro-Slide>:7300
```

Es. se Centro Slide ha IP 192.168.1.50 → `http://192.168.1.50:7300`. Deve aprirsi la **stessa interfaccia del cloud**. Da qui il PC sala fa il pairing con magic-link sala (vedi `Manuale_Installazione_Room_Agent.md` per il flusso storico Room Agent — superato dal nuovo desktop unificato in Sprint J-W).

## A.7 Test 48 ore prima dell'evento

Checklist da eseguire **48 ore prima** (non il giorno stesso):

- [ ] PC Centro Slide acceso, connesso a UPS, antivirus aggiornato e Defender exclusions OK.
- [ ] Windows aggiornato (riavvio se serve, prima dell'evento).
- [ ] Live SLIDE CENTER Desktop ultima versione (banner "Aggiornamento disponibile" in alto).
- [ ] Licenza cloud collegata (vedi A.5).
- [ ] Server locale risponde a `http://127.0.0.1:7300/health`.
- [ ] Almeno un PC sala riesce a fare pairing tramite magic-link.
- [ ] Evento di test creato sul cloud, almeno 5 file caricati.
- [ ] PC sala riceve i file (verifica progressivo download nella UI).
- [ ] **Failover test:** stacca cavo internet → l'app continua. Riattacca → riconnette senza intervento.
- [ ] **Restart test:** riavvia il PC Centro Slide → app si riavvia, server locale parte, PC sala riconnettono in <30s.

## A.8 Aggiornamenti automatici

Check al boot e ogni 30 minuti quando online. Banner sticky:

> **Aggiornamento disponibile: v0.1.5** — [Installa] [Più tardi]

**Installa** scarica l'aggiornamento firmato (Ed25519), installazione silenziosa (~1 minuto), riavvio automatico.

**Importante:** non installare aggiornamenti durante un evento in corso. Aspetta pausa pranzo o fine giornata.

## A.9 Disinstallazione

**Impostazioni → App → App installate** → "Live SLIDE CENTER" → **Disinstalla**.

Dialog "Conservare i dati dell'evento?":
- **Sì** (consigliato) — i file in `%USERPROFILE%\SlideCenter` restano. Reinstallando li ritrovi.
- **No** — cancella anche la cartella dati. Operazione irreversibile.

L'uninstaller inoltre:
- rimuove regola firewall Windows,
- rimuove esclusione Windows Defender,
- rimuove voci Start menu/desktop,
- **NON tocca** `~/.slidecenter/license.enc` (così reinstalli senza ribindare).

Per rimozione completa anche delle preferenze utente:

```powershell
Remove-Item -Recurse "$env:USERPROFILE\.slidecenter"
Remove-Item -Recurse "$env:USERPROFILE\SlideCenter"   # solo se hai scelto di non conservare i dati
```

## A.10 Risoluzione problemi

### App non parte / si chiude subito

**Cause:**
- **Antivirus aggressivo** (Norton/Kaspersky/McAfee). Esclusione: `%LOCALAPPDATA%\Live SLIDE CENTER\`.
- **Porta 7300 occupata** da altro processo:
  ```powershell
  Get-NetTCPConnection -LocalPort 7300
  ```
  Se occupata, kill del processo (di solito un'altra istanza Live SLIDE CENTER lasciata in background).

### PC sala non vede il Centro Slide

**Cause:**
1. **Firewall Windows** sta bloccando. Pannello → Windows Defender Firewall → Impostazioni avanzate → Connessioni in entrata. Cerca "Live SLIDE CENTER Desktop" → deve esserci, abilitata su Privata. Se manca: disinstalla e reinstalla.
2. **Profilo di rete su Pubblica.** Impostazioni → Rete e Internet → Wi-Fi/Ethernet → Proprietà → seleziona **Privata**.
3. **VPN client attivo** sul Centro Slide. Disattiva.
4. **PC sala su VLAN diversa.** Verifica sw/router.

### Bind licenza fallisce con `rate_limited`

Troppi tentativi. Aspetta 5 minuti e riprova. Se persiste, contatta Andrea.

### Bind licenza fallisce con `token_expired` / `token_exhausted`

Magic-link scaduto o già consumato. Genera nuovo magic-link dal pannello Centri Slide e riprova.

### Banner "Verifica licenza non riuscita da N giorni"

PC offline da troppo. Connetti a internet → click **Verifica ora** nel banner. Se i giorni superano 30, le funzioni cloud sono disabilitate ma la modalità LAN locale continua a funzionare.

### Aggiornamento installa ma l'app non riparte

Avvia manualmente da icona desktop o menu Start. Se persiste:
1. Disinstalla.
2. Reinstalla l'ultima versione da GitHub Releases.
3. La licenza resta intatta (file `license.enc` in `~/.slidecenter`).

### Supporto tecnico

- **Email:** Andrea Rizzari — `live.software11@gmail.com`
- **Issue tracker:** <https://github.com/live-software11/live-slide-center/issues>

Quando apri un ticket includi:
- Versione app (`Help → About` o footer in basso a destra).
- Versione Windows (`winver`).
- Log app: `%LOCALAPPDATA%\Live SLIDE CENTER\logs\app.log` (ultime 100 righe).
- Screenshot dell'errore.

---

# PARTE B — Smoke test QA pre-release

> **Tempo:** 30-45 minuti per il flusso completo. **Output:** documento compilato, copy/paste in CHANGELOG / release notes.

## B.1 Setup ambiente test

- [ ] **2 PC Windows 10/11** sulla stessa LAN privata (anche 1 PC fisico + 1 VM va bene).
- [ ] **1 dispositivo per browser admin** (laptop/tablet, anche il PC1 stesso).
- [ ] **1 account cloud Live SLIDE CENTER** (admin di test su `live-slide-center.vercel.app`).
- [ ] **PC1** = Centro Slide/admin desktop. **PC2** = sala/player desktop.
- [ ] **Rete:** stesso switch o router (no VLAN, no VPN).

## B.2 Build & installer

- [ ] `pnpm typecheck` → 0 errori.
- [ ] `pnpm lint` → 0 warning relativi al desktop o feature `desktop-devices`.
- [ ] `pnpm test` (se applicabile) → tutti i test passano.
- [ ] `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` → 0 errori.
- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin slide-center-desktop license::` → 7+ test passano.
- [ ] Build firmata locale: `apps/desktop/scripts/release.ps1 -Signed` → installer NSIS + `.sig` + `latest.json` in `apps/desktop/release/`.
- [ ] Verifica integrità: `Get-FileHash` sull'installer = hash registrato in CHANGELOG.

## B.3 Installazione PC1 (Centro Slide)

- [ ] Doppio click installer → SmartScreen warning (se signing self-signed) → "Esegui comunque".
- [ ] Selezione lingua: Italiano disponibile e default OK.
- [ ] EULA in italiano.
- [ ] Installazione completa in <60s.
- [ ] **Firewall:** `Get-NetFirewallRule -DisplayName "*SLIDE CENTER*"` → regola creata, profilo Privato.
- [ ] **Defender exclusion:** `Get-MpPreference | Select ExclusionPath` → cartella app inclusa.
- [ ] **Menu Start:** voce "Live SLIDE CENTER" + icona desktop creati.

### Primo avvio PC1

- [ ] Doppio click icona desktop → finestra Tauri si apre in <3s.
- [ ] Schermata "Scegli ruolo" appare al primo avvio. Selezionato "admin".
- [ ] Restart automatico dopo scelta ruolo.
- [ ] Server locale risponde: `Invoke-WebRequest http://127.0.0.1:7300/health` → 200 OK con `{role: "admin"}`.
- [ ] mDNS attivo: `Get-NetUDPEndpoint -LocalPort 5353` → processo listener presente.

## B.4 Bind licenza cloud (test)

- [ ] Browser su laptop separato → login admin tenant test su `live-slide-center.vercel.app`.
- [ ] Sidebar mostra voce **Centri Slide** (sezione Tools admin).
- [ ] Click "Centri Slide" → apre `/centri-slide` con 3 sezioni vuote (PC server, magic-link, ruoli).
- [ ] Click "Genera link" → dialog. Compila etichetta "Smoke Test PC1", scadenza 1h, max usi 1.
- [ ] Click "Genera" → dialog "Successo" mostra QR + URL.
- [ ] Click "Copia URL" → toast "Copiato!".
- [ ] Lista magic-link mostra 1 elemento "active".
- [ ] **Sul PC1 desktop:** apri Live SLIDE CENTER → menu sinistra → "Licenza" (o vai a `/centro-slide/licenza`).
- [ ] Banner sticky "Centro Slide non collegato al cloud" visibile in cima.
- [ ] Incolla magic-link nel campo input → click "Collega".
- [ ] Loader 1-2s → success: "Licenza attiva — Tenant: <nome>, Plan: <piano>".
- [ ] Banner sticky scompare.
- [ ] **Sul cloud admin:** refresh pagina Centri Slide → ora vedo PC1 nella lista "PC server collegati" con badge "Online".

## B.5 Heartbeat e offline grace (Sprint D6)

- [ ] **Su PC1:** wait 30 secondi dopo il primo bind → controllo log:
  ```powershell
  Get-Content "$env:LOCALAPPDATA\Live SLIDE CENTER\logs\app.log" -Tail 30 | Select-String "heartbeat"
  ```
  → deve apparire "heartbeat licenza desktop schedulato" e "heartbeat OK".
- [ ] **Test offline grace:** disconnetti PC1 da internet (cavo o WiFi off). Aspetta 1 min.
- [ ] In licenza pagina, badge resta "Active" (siamo in grace ben sotto le 24h).
- [ ] Riconnetti internet → click "Verifica ora" → toast success.
- [ ] **Su cloud admin:** `last_seen_at` di PC1 aggiornato (entro 60s).

## B.6 Pannello admin Centri Slide

- [ ] Genera nuovo magic-link → consumalo da un PC2 di test (o forza errore "exhausted" creando 2 PC con maxUses=1).
- [ ] Click "Revoca" su un magic-link inutilizzato → conferma → lista aggiornata.
- [ ] Stampa QR del magic-link → window di stampa si apre, QR visibile, no chiamate a `api.qrserver.com` (verifica Network tab DevTools — generazione client-side).

## B.7 PC sala e toggle ruolo

- [ ] **PC2:** installa Live SLIDE CENTER Desktop, scegli ruolo "sala".
- [ ] Genera magic-link sala dalla pagina evento (`RoomProvisionTokensPanel`) → apri su PC2 → bind automatico.
- [ ] **Sul cloud:** pannello Centri Slide → sezione "Ruolo PC sala" mostra PC2 con badge "Sala".
- [ ] Click "Promuovi a Centro Slide" → conferma → badge cambia in "Centro Slide", `room_id` viene azzerato.
- [ ] Refresh: stato persiste.
- [ ] Click "Riporta a sala" → conferma → badge torna "Sala".

## B.8 Deep-link `/centro-slide/bind`

- [ ] **In browser cloud:** apri direttamente `https://<dominio>/centro-slide/bind?t=<un_token_valido>` → vedi pagina "Stai aprendo questo link nel browser" (modalità cloud).
- [ ] **Sul PC1 desktop:** apri il magic-link nel browser interno → bind automatico parte → success → redirect a `/`.

## B.9 Aggiornamenti automatici (manuale, opzionale)

- [ ] Bumpa versione locale a 0.1.99 (test).
- [ ] Pubblica release fake con `latest.json` che punta alla versione attuale-1 → l'app **non** offre update.
- [ ] Pubblica release fake con `latest.json` che punta alla 0.2.0 → banner "Aggiornamento disponibile" appare in <30 min.
- [ ] Click "Installa" → download progress (silenzioso) → app si chiude → installer NSIS parte in modalità passive → app riapre automaticamente alla 0.2.0.
- [ ] Verifica `cmd_app_info` ritorna versione 0.2.0.

## B.10 Disinstallazione (test)

- [ ] **Impostazioni → App → Live SLIDE CENTER → Disinstalla.**
- [ ] Dialog "Conservare i dati dell'evento?" appare.
- [ ] Scegli "Sì" → uninstaller rimuove app ma `~/SlideCenter` resta.
- [ ] Reinstalla → al primo avvio i dati pre-esistenti sono visibili (eventi, file).
- [ ] Disinstalla di nuovo → scegli "No" → uninstaller cancella `~/SlideCenter`.
- [ ] **Firewall rules rimosse:** `Get-NetFirewallRule -DisplayName "*SLIDE CENTER*"` → 0 risultati.
- [ ] **Defender exclusions rimosse:** `Get-MpPreference | Select ExclusionPath` → cartella non più presente.
- [ ] **Menu Start vuoto:** voce "Live SLIDE CENTER" rimossa.
- [ ] **Verifica:** `~/.slidecenter/license.enc` resta sul disco (così reinstallando non serve ribindare).

## B.11 Edge cases (regressione)

- [ ] **Bind con token già consumato:** errore "token_exhausted" mostrato in italiano.
- [ ] **Bind con token revocato:** errore "token_revoked".
- [ ] **Verify dopo revoca PC dal cloud:** prossimo heartbeat ritorna "device_revoked", banner sticky "Questo PC è stato scollegato dal cloud" appare.
- [ ] **Verify con tenant sospeso:** banner "Account cloud sospeso" appare.
- [ ] **2 PC desktop legati allo stesso tenant:** entrambi visibili in lista admin, heartbeat indipendenti.
- [ ] **Restart PC senza internet:** app parte, server locale pronto, banner "Centro Slide offline" presente, modalità LAN funziona.

## B.12 RLS & isolation tenant

- [ ] **Tenant A admin** vede solo i propri PC desktop in `/centri-slide`.
- [ ] **Tenant B admin** non vede PC desktop di Tenant A.
- [ ] Magic-link generato da Tenant A non può essere usato per bindare PC sotto Tenant B (la RPC ritorna `tenant_mismatch`).

---

## Output report da copiare in CHANGELOG

```markdown
### Smoke test Centro Slide — v<X.Y.Z>

- **Data:** <YYYY-MM-DD>
- **Tester:** <nome>
- **Hardware:** PC1 = <CPU/RAM>, PC2 = <CPU/RAM>, switch = <modello>
- **OS:** PC1 = Windows <ver>, PC2 = Windows <ver>
- **Risultato:** PASS / FAIL

### Note / blocking issues

- [...]

### Tempo totale

- Setup: ___ min
- Test B.1-B.7: ___ min
- Test B.8-B.12: ___ min
- **Totale:** ___ min
```

---

## Riferimenti incrociati

- **Architettura desktop:** `../ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 14 (desktop) + § 15 (sicurezza) + § 22 (sprint history).
- **Stato attuale e TODO:** `../STATO_E_TODO.md`.
- **Disaster recovery + warm-keep Edge Functions:** `../DISASTER_RECOVERY.md`.
- **Distribuzione e build:** `Manuale_Distribuzione.md`.
- **Field test sul campo:** `../FIELD_TEST_CHECKLIST.md` + `../FIELD_TEST_CREDENTIALS.md`.
