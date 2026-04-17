# Script Screencast Onboarding — Live SLIDE CENTER

**Destinatario:** Andrea Rizzari (registrazione video).
**Versione:** 1.0 (Sprint 5b).
**Stato:** scaletta pronta per registrazione, codice gia' funzionante.

---

## Premessa

Questo documento contiene la **scaletta operativa parola-per-parola** dei 3
video di onboarding che chiuderanno la fase pre-vendita. Sono pensati per:

- **Riprodurre velocemente** il flusso al cliente che chiama "non capisco"
- **Allegare** alle email di consegna licenze
- **Pubblicare** su `liveworksapp.com/slide-center` come marketing tecnico

I tre video coprono i tre attori del sistema:

| #   | Titolo                                | Durata target | Attore                 |
| --- | ------------------------------------- | ------------- | ---------------------- |
| 1   | Setup workspace cloud (Admin)         | 5 - 6 min     | Admin tenant (cliente) |
| 2   | Mini-PC regia: install + pairing      | 4 - 5 min     | Tecnico regia          |
| 3   | PC sala: install + connessione + play | 3 - 4 min     | Tecnico sala           |

**Totale:** ~13 minuti per tutta la trilogia. Pubblicabili separati o uniti.

---

## Setup di registrazione (consigli tecnici)

### Hardware

- **Microfono:** USB cardioide (Blue Yeti, Rode NT-USB) o lavalier Lark M1.
  Se non disponibile, AirPods Pro 2 sono accettabili in stanza silenziosa.
- **Webcam:** opzionale. Se inserisci il talking head fai sempre PIP in basso destra.
- **Sfondo:** evita finestre dietro (controluce). Pareti chiare uniformi.

### Software

- **OBS Studio** (gratis, professionale): permette PIP webcam + scene multiple.
  Setup: 1 scena per ogni schermo (regia, sala, browser admin) + 1 transizione.
- **Cattura schermo a 1920×1080**, 30 fps, formato H.264 mp4.
- **Editing minimo:** CapCut Desktop (gratis) o DaVinci Resolve (gratis pro).
  Solo tagli, nessun effetto.
- **Audio:** normalizza a -16 LUFS (loudness standard YouTube/streaming).

### Branding finale

- Intro 3 sec con logo "Live SLIDE CENTER" + tagline ("Il backbone del tuo evento")
- Outro 5 sec con CTA: "Documentazione completa: docs.liveworksapp.com/slide-center"
  - email supporto: live.software11@gmail.com
- Lower-third con il tuo nome: "Andrea Rizzari, Live Software"

### Preparazione ambiente di demo

Prima di registrare prepara un workspace **vergine** con:

- Tenant fresco (signup con email demo, niente eventi residui)
- 1 evento "Demo Conferenza 2026" con 1 sala "Sala Plenaria"
- 1 sessione "Apertura lavori" con 2 speaker fittizi
- 2 PDF placeholder pronti su Desktop (uno per speaker)
- Local Agent installer + Room Agent installer scaricati pronti

> **Tip:** registra l'intera trilogia nello STESSO setup demo, in sequenza.
> Cosi' i video si concatenano logicamente: il cliente segue il workflow
> reale dell'evento.

---

## VIDEO 1 — Setup workspace cloud (Admin)

**Titolo file:** `01-slide-center-setup-admin.mp4`
**Durata target:** 5 - 6 min
**Attore narrato:** "Admin tenant" (esempio: organizzatore conferenza)

### Scena 1 (0:00 - 0:30) — Apertura

**[Schermo: pagina liveworksapp.com/slide-center con tasto "Inizia gratis"]**

> "Ciao, sono Andrea Rizzari di Live Software. In questo video ti mostro come
> attivare in 5 minuti il tuo workspace **Live SLIDE CENTER**, il sistema che
> sincronizza presentazioni e regia per i tuoi eventi live, senza piu' chiavette
> USB tra speaker e cabina di regia."

**[Click su "Prova gratis 14 giorni"]**

### Scena 2 (0:30 - 2:00) — Signup + provisioning tenant

**[Schermo: form /signup di slidecenter.liveworksapp.com]**

> "Inserisco la mia email aziendale, una password sicura, il nome
> dell'organizzazione: per esempio 'Live Software Eventi'. Conferma."

**[Click submit, attesa redirect su dashboard tenant]**

> "In background il sistema crea il mio tenant isolato — questo e' il punto
> chiave: tutti i miei dati restano divisi da quelli di qualsiasi altro
> cliente, livello security bancaria. Sono ora dentro la dashboard del piano
> demo, valido 14 giorni con tutte le funzionalita' attive."

**[Hover sul badge "Piano Demo - 14 giorni rimanenti" in alto a destra]**

### Scena 3 (2:00 - 3:30) — Creazione primo evento

**[Click sul tasto "+ Nuovo evento"]**

> "Creo il mio evento. Il nome: 'Conferenza Innovazione Roma 2026'. Date:
> dal 15 al 17 maggio. Tipo: 'Convention'. Salvo."

**[Riempie i campi e clicca "Crea"]**

> "Dentro l'evento aggiungo le mie sale. Per oggi una sola: 'Plenaria'."

**[Tab "Sale" → "+ Nuova sala" → "Plenaria" → Salva]**

> "Dentro la Plenaria aggiungo le sessioni programmate. La prima: 'Apertura
> lavori', dalle 9:00 alle 10:30."

**[Tab "Sessioni" → "+ Nuova sessione" → compila → Salva]**

### Scena 4 (3:30 - 4:30) — Aggiunta speaker + presentazioni

**[Click sulla sessione "Apertura lavori"]**

> "Aggiungo gli speaker. Mario Rossi parlera' alle 9:00 con la sua presentazione,
> Anna Bianchi alle 9:45."

**[Form aggiunta speaker, drag-and-drop di un PDF di esempio sull'avatar speaker]**

> "Posso fare upload diretto del PDF dello speaker da web. Drag and drop, attendi
> il caricamento — questo file viaggia su Supabase Storage europeo, criptato."

**[Mostra progress bar dell'upload]**

> "Una volta caricato, posso anche **trascinare** la presentazione da uno speaker
> all'altro o spostarla tra sessioni: tutta la regia vede il cambio in tempo reale."

### Scena 5 (4:30 - 5:30) — Inviti tecnici

**[Tab "Team" → "+ Invita membro"]**

> "Ora invito i miei tecnici. Il regista riceve ruolo 'Director', il tecnico
> sala 'Room Operator'. Inserisco le email, li mando l'invito: il sistema
> manda una mail con link sicuro che li fa accedere al loro pannello dedicato."

**[Mostra mail di invito ricevuta su tablet/secondo schermo]**

### Scena 6 (5:30 - 6:00) — Chiusura + transizione al video 2

**[Schermo: dashboard evento con sessioni + speaker pronti]**

> "Il workspace cloud e' pronto. Adesso passiamo alla regia: vediamo come
> installare il Local Agent sul mini-PC della cabina e abbinarlo a questo
> workspace. Vai al video 2."

**[Outro 5 sec con logo + CTA]**

---

## VIDEO 2 — Mini-PC regia: install + pairing

**Titolo file:** `02-slide-center-pairing-regia.mp4`
**Durata target:** 4 - 5 min
**Attore narrato:** Tecnico regia / direttore tecnico

### Scena 1 (0:00 - 0:30) — Apertura

**[Schermo: Desktop Win 11 con installer scaricato visibile]**

> "Bentornato. Sono in cabina di regia con il mio mini-PC Windows 11. Sul desktop
> ho l'installer 'Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe' che ho ricevuto via
> email da Andrea, insieme alla mia chiave licenza che inizia per LIVE-XXXX."

### Scena 2 (0:30 - 1:30) — Installazione NSIS

**[Doppio click sull'installer]**

> "Doppio click. Windows mi chiede privilegi admin: confermo."

**[UAC prompt → Si']**

> "L'installer parte. Cliccando Avanti il sistema fa **automaticamente** alcune
> cose importanti: configura il firewall, esclude la cartella di cache da Windows
> Defender per evitare scansioni che rallenterebbero il transfer dei PDF, e
> setta la rete LAN come 'Privata' cosi' la discovery delle sale funziona."

**[Scorre installer fino a fine, click Fine, l'app si avvia]**

> "L'installazione finita, l'icona Live SLIDE CENTER Agent compare nella tray
> di Windows in basso a destra."

### Scena 3 (1:30 - 2:30) — Attivazione licenza

**[Click sull'icona tray → si apre finestra dell'agent con QR + form licenza]**

> "Al primo avvio l'agent mi chiede la chiave licenza. La incollo: la chiave
> e' nel formato `LIVE-A1B2-C3D4-E5F6-G7H8`. Click su 'Attiva'."

**[Incolla, click Attiva]**

> "L'agent contatta il server Live WORKS APP, verifica che la chiave sia valida,
> registra l'**hardware fingerprint** di questo PC nel database licenze. Da
> questo momento la chiave e' legata a questa macchina: se la riusi su un altro
> PC, vedrai un errore di 'device limit raggiunto'."

**[Schermo dopo qualche secondo mostra "Licenza attiva - slot 1 di 1"]**

### Scena 4 (2:30 - 3:30) — Pairing con workspace cloud

**[Schermo: nella finestra agent appare un QR code grande + numero a 6 cifre]**

> "Adesso devo abbinare l'agent al mio workspace cloud. L'agent mostra un **QR
> code di pairing** valido 60 secondi e un codice di 6 cifre."

**[Sposta tablet/telefono davanti alla webcam, scannerizza il QR]**

> "Apro l'app Live SLIDE CENTER sul mio telefono — oppure dal browser sulla
> dashboard cloud, click su 'Aggiungi regia' — e scannerizzo questo QR.
> Conferma: il pairing e' fatto."

**[Schermo agent: notifica verde "Connesso al workspace [Nome] / [Evento attivo]"]**

> "L'agent ora dialoga col cloud: scarica le presentazioni dell'evento di oggi
> e le mette in cache locale. Cosi' anche se la connessione internet sparisce
> a meta' evento, le slide sono gia' qui sul disco."

### Scena 5 (3:30 - 4:30) — Discovery sale

**[Schermo: tab "Sale" della finestra agent vuota inizialmente]**

> "Adesso l'agent regia aspetta che le sale si annuncino. Apro il video 3
> dove installiamo il PC della sala plenaria, e tornero' qui per vedere la
> sala apparire automaticamente."

**[Bonus: Skip avanti di 30 sec a sala apparsa con check verde]**

> "Ecco: la sala 'Plenaria' e' apparsa automaticamente con discovery mDNS,
> stato 'Online', latenza 12ms. Sono pronto per regia."

### Scena 6 (4:30 - 5:00) — Chiusura

> "Mini-PC regia configurato. Vai al video 3 per vedere come si setta il PC
> di sala."

**[Outro]**

---

## VIDEO 3 — PC sala: install + connessione + play

**Titolo file:** `03-slide-center-sala-play.mp4`
**Durata target:** 3 - 4 min
**Attore narrato:** Tecnico sala plenaria

### Scena 1 (0:00 - 0:30) — Apertura

**[Schermo: PC sala con doppio monitor: principale per controllo, secondario verso platea]**

> "Eccoci nella sala plenaria. Ho un PC Windows 11 collegato a due schermi:
> il principale per me, il secondario per la platea collegato al ledwall HDMI."

### Scena 2 (0:30 - 1:30) — Installazione Room Agent

**[Doppio click su 'Live-SLIDE-CENTER-Room-Agent-Setup-0.1.0.exe']**

> "Lancio l'installer Room Agent. Anche qui UAC, conferma. Anche qui hooks
> automatici: firewall aperto sulla porta 5353 mDNS per discovery, esclusione
> Defender della cartella cache."

**[Scorre installer, lancia]**

### Scena 3 (1:30 - 2:30) — Licenza + scelta sala

**[Finestra Room Agent al primo avvio]**

> "Incollo la mia chiave Room Agent — diversa da quella della regia, ne ho
> una per ogni sala. Attivo."

**[Activation OK, mostra finestra di selezione sala]**

> "L'agent fa discovery automatica del Local Agent in regia e si connette.
> Mi chiede a quale sala questa macchina appartiene: scelgo 'Plenaria'."

**[Click su 'Plenaria' nella lista]**

> "Da questo momento il regista in cabina vede questa sala come 'Online' nel
> suo pannello, e potra' inviarmi le slide quando vuole."

### Scena 4 (2:30 - 3:30) — Modalita' presentazione

**[Schermo: finestra Room Agent in modalita' standby con messaggio "In attesa di slide"]**

> "Configuro l'output sul secondo monitor: tab Impostazioni, scelgo 'Schermo 2
>
> - HDMI ledwall'. Ora quando il regista pusha una presentazione, le slide
>   appaiono **direttamente sul ledwall**, full screen, senza prompt o popup."

**[Nel frattempo dal video 2 si vedeva il regista mandare la slide → schermo PC sala mostra slide attiva]**

> "Il regista ha appena inviato la presentazione di Mario Rossi: ecco la prima
> slide sul ledwall. Posso anche fare avanti/indietro localmente con frecce
> tastiera o telecomando, e il regista vede il **mio progresso** in tempo reale."

### Scena 5 (3:30 - 4:00) — Chiusura globale

**[Inquadratura panoramica: regia (video 2) + sala (video 3) sincronizzate]**

> "Ed eccoci pronti. Tre componenti: workspace cloud per il direttore,
> mini-PC regia, PC sala. Tutto sincronizzato, tutto offline-resilient. Per
> domande tecniche: live.software11@gmail.com. Buon evento."

**[Outro con loghi + CTA finale]**

---

## Checklist post-registrazione

- [ ] 3 video MP4 H.264 1080p30, durata totale ~13 min
- [ ] Audio normalizzato -16 LUFS, niente fruscio di fondo
- [ ] Caricati su YouTube come **non listed** (non public, non private)
- [ ] Trascrizioni generate (YouTube auto + correzione manuale)
- [ ] Sottotitoli IT esportati come `.srt` allegati alla mail consegna licenza
- [ ] Aggiunti link nelle email automatiche di Live WORKS APP dopo acquisto
      licenza Slide Center (modulo `customerEmailService`)
- [ ] Pubblicati come "Risorse di onboarding" su `liveworksapp.com/slide-center`
      sotto sezione dedicata
- [ ] Backup MP4 originali su Drive con prefix `slide-center/screencasts/v1.0/`

---

## Versionamento screencast

Quando rilascio una versione major dei prodotti che cambia UI in modo
significativo, ri-registrare con suffisso `-v2`. Mantenere link non listed
attivi alle versioni vecchie almeno 6 mesi (clienti su licenza vecchia).

| Versione documenti | Versione codice supportata | Data registrazione |
| ------------------ | -------------------------- | ------------------ |
| v1.0               | Slide Center 0.1.x         | da pianificare     |
| v1.1               | Slide Center 0.2.x         | TBD                |

---

**Riferimenti:**

- `docs/Manuali/Manuale_Distribuzione.md` — flusso operativo completo
- `docs/Manuali/Manuale_Installazione_Local_Agent.md` — passi installer regia
- `docs/Manuali/Manuale_Installazione_Room_Agent.md` — passi installer sala
- `docs/Commerciale/Listino_Prezzi.md` — pricing per CTA finale screencast
