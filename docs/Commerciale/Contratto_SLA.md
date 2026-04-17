---
title: Live SLIDE CENTER — Service Level Agreement (SLA) e Condizioni di Licenza
version: 1.0 — Sprint 5 (17 Aprile 2026)
status: BOZZA da revisionare con consulente legale prima della firma cliente
fornitore: Andrea Rizzari Live Software (di seguito "il Fornitore")
prodotto: Live SLIDE CENTER (Cloud + Local Agent + Room Agent)
---

> **Avviso legale.** Questo documento e' una **bozza tecnica** redatta dal CTO
> per fornire al consulente legale (avvocato / commercialista) la struttura
> contrattuale del prodotto. **NON** e' un contratto pronto da firmare: prima
> della consegna al cliente finale richiede revisione legale (in particolare
> sulle clausole di limitazione responsabilita, indennizzo e foro competente).

---

## 1. Oggetto del contratto

Il Fornitore concede al Cliente l'uso non esclusivo e non trasferibile del
software **Live SLIDE CENTER** (di seguito "il Servizio") composto da:

1. **Workspace Cloud multi-tenant** (`live-slide-center.app` o sotto-dominio
   dedicato), accessibile via web da PC e tablet, ospitato su infrastruttura
   Supabase (UE — Francoforte/Stoccolma).

2. **Local Agent** — applicazione desktop Windows da installare sul mini-PC di
   regia (1 licenza per installazione).

3. **Room Agent** — applicazione desktop Windows da installare sui PC delle sale
   conferenze del cliente (1 licenza per ogni PC sala).

4. **Manuali operatore PDF** (Distribuzione, Installazione Local Agent,
   Installazione Room Agent) e supporto via email.

L'uso del Servizio e' subordinato all'attivazione di una **chiave di licenza
univoca** per ogni installazione desktop, gestita tramite il sistema centralizzato
di Live Software.

---

## 2. Modalita di attivazione e device limit

### 2.1 Chiave di licenza
Ogni licenza e' rappresentata da una stringa **`LIVE-XXXX-XXXX-XXXX-XXXX`**
generata univocamente dal sistema del Fornitore e legata a un **fingerprint
hardware** del dispositivo (SHA-256 di motherboard serial + CPU ID + disk
serial).

### 2.2 Device limit
- **Local Agent**: 1 licenza = 1 PC. Il cambio PC e' consentito ma richiede
  approvazione del Fornitore (max 3 cambi/anno gratuiti, oltre = 50 €/cambio).
- **Room Agent**: 1 licenza per ogni PC sala. Le licenze NON sono trasferibili
  tra sale diverse senza disattivazione preventiva.

### 2.3 Disattivazione
Il software desktop, durante la disinstallazione, libera automaticamente lo slot
hardware sul cloud del Fornitore (purche' il PC sia online). In caso di guasto
hardware o reinstallazione forzata, il Cliente puo' richiedere la disattivazione
manuale via email a `support@livesoftware11.com`.

---

## 3. Service Level Agreement — Cloud Workspace

### 3.1 Uptime garantito
| Componente              | SLA mensile | Downtime ammesso/mese |
|-------------------------|-------------|-----------------------|
| Workspace web (Cloud)   | **99.5%**   | < 3h 36'              |
| Edge Functions          | **99.5%**   | < 3h 36'              |
| Storage presentazioni   | **99.9%**   | < 44 minuti           |

Esclusi dal calcolo:
- manutenzione programmata (preavviso minimo 48h via email)
- downtime causato da provider terzi (Supabase, Cloudflare) certificati nei loro
  status page
- forza maggiore (DDoS estesi, blackout regionale, eventi normativi)

### 3.2 Latenza tipica
- Sincronizzazione metadata (sessione/speaker/slide): **< 2 secondi** in EU
- Upload presentazione (10 MB): **< 30 secondi** su connessione 50 Mbps up
- Pairing PC sala via codice 6-cifre: **< 5 secondi**

### 3.3 Backup
- Snapshot Postgres automatico Supabase: **giornaliero**, retention 30 giorni
- Storage Supabase: **versioning S3** sui file presentazioni, retention 90 giorni
- Backup mensile cifrato esportato dal Fornitore in storage offline (richiesta
  Cliente via PEC con preavviso 7 giorni)

### 3.4 Mancato rispetto SLA
In caso di uptime mensile inferiore al 99.5% verificabile, il Cliente ha diritto
a un **credito sul canone successivo** secondo la seguente scala:

| Uptime mensile      | Credito sul mese successivo |
|---------------------|------------------------------|
| 99.0% — 99.49%      | 5%                           |
| 95.0% — 98.99%      | 10%                          |
| < 95.0%             | 25% + recesso unilaterale    |

Il credito si applica solo previa segnalazione formale via email entro 30 giorni
dal mese di riferimento.

---

## 4. Service Level Agreement — Software desktop

### 4.1 Disponibilita licenza
Il sistema centralizzato di attivazione/verifica licenza deve essere disponibile
con SLA **99.5% mensile**. In caso di indisponibilita prolungata, le licenze
gia' attivate funzionano in **modalita offline grace period (30 giorni)** senza
necessita di chiamare il server.

### 4.2 Compatibilita
- **Windows 10** versione 1809 o superiore (10.0.17763)
- **Windows 11** tutte le versioni
- **PowerPoint** 2016 o superiore (versione MS 365 raccomandata)
- WebView2 Runtime (auto-installato dall'installer Local Agent)

### 4.3 Aggiornamenti
- **Patch di sicurezza**: gratuite e installate automaticamente entro 7 giorni
  dal rilascio (notifica Cliente).
- **Minor release** (es. 0.1 → 0.2): gratuite per la durata del contratto.
- **Major release** (es. 1.x → 2.x): possono richiedere upgrade a pagamento.

---

## 5. Sicurezza e protezione dati

### 5.1 Trattamento dati personali
Il Fornitore agisce come **Responsabile del Trattamento** ai sensi del GDPR
(art. 28). Il Cliente e' Titolare del Trattamento dei dati relativi a:
- relatori (nome, cognome, email, biografia)
- partecipanti (se inseriti dal Cliente)
- account utenti del Cliente (admin, coordinator, tech)

Tutti i dati sono ospitati su **Supabase EU** (Francoforte/Stoccolma) con cifratura
at-rest (AES-256) e in-transit (TLS 1.3). Nessun dato esce dall'Unione Europea.

Atto di nomina ex art. 28 GDPR: **allegato A** (separato).

### 5.2 Isolamento multi-tenant
Ogni Cliente opera in un tenant logico isolato tramite **Postgres Row Level
Security (RLS)** verificata in CI ad ogni rilascio (script `rls_audit.sql`).
Il Fornitore non accede ai dati del Cliente se non per troubleshooting esplicitamente
richiesto e tracciato.

### 5.3 Diritto all'oblio
Su richiesta scritta del Cliente, il Fornitore cancella tutti i dati del tenant
entro 30 giorni dalla richiesta (esclusi i dati conservati per obblighi fiscali
o difesa in giudizio, secondo art. 17 par. 3 GDPR).

### 5.4 Notifica data breach
Eventuali violazioni di sicurezza che impattino dati personali sono notificate
al Cliente entro **24h** dalla scoperta (art. 33 GDPR). Il Fornitore mantiene
un registro interno degli incidenti.

---

## 6. Limitazioni di responsabilita

### 6.1 Esclusioni
Il Fornitore NON e' responsabile per:
- danni indiretti, mancati guadagni, perdita di dati causata da malfunzionamento
  della rete del Cliente
- mancata visualizzazione di presentazioni dovute a corruzione del file PowerPoint
  fornito dal relatore o assenza/incompatibilita di font
- problemi causati da modifiche manuali al sistema operativo, al PC sala o alla
  cartella di output del Room Agent
- perdita di dati causata dal Cliente che disinstalla il Local Agent senza prima
  esportare la sessione attiva

### 6.2 Massimale
La responsabilita complessiva del Fornitore verso il Cliente e' limitata al
**100% del canone annuale** pagato dal Cliente nei 12 mesi precedenti l'evento
contestato.

### 6.3 Forza maggiore
Sospensione delle obbligazioni in caso di eventi al di fuori del ragionevole
controllo (DDoS estesi, blackout, sciopero generale, pandemia, atti governativi).

---

## 7. Durata, recesso e prezzo

### 7.1 Durata
- **Licenza desktop**: perpetua (acquisto una tantum) o annuale (subscription).
- **Workspace cloud**: subscription annuale tacitamente rinnovata salvo disdetta
  via email/PEC entro 30 giorni dalla scadenza.

### 7.2 Recesso anticipato
- Cliente: recesso per giusta causa (mancato rispetto SLA al 95%) senza penali.
- Fornitore: recesso per mancato pagamento dopo 30 giorni di solleciti.
- In caso di recesso, il Cliente puo' esportare i propri dati in formato CSV/JSON
  entro 30 giorni dalla disattivazione del workspace.

### 7.3 Prezzi
Vedi documento separato `docs/Commerciale/Listino_Prezzi.md` (versione corrente).
Variazioni di prezzo vengono comunicate con preavviso di **90 giorni** e si
applicano dal rinnovo successivo.

---

## 8. Supporto tecnico

### 8.1 Canali
- Email: `support@livesoftware11.com` (lun-ven 9:00-18:00 CET)
- WhatsApp business (solo eventi attivi): numero comunicato in fase di onboarding
- Hotline emergenza evento (solo Pro/Enterprise): numero dedicato 24/7 nei giorni
  di evento dichiarati con preavviso di 48h via email

### 8.2 Tempi di risposta
| Severita    | Definizione                                                  | Tempo prima risposta |
|-------------|--------------------------------------------------------------|----------------------|
| **P1**      | Servizio cloud down OR evento live in corso bloccato         | **< 1h** 24/7        |
| **P2**      | Funzione critica non utilizzabile (upload, sync, pairing)    | < 4h orario lavorativo |
| **P3**      | Bug non bloccante o richiesta di chiarimento                 | < 1 giorno lavorativo  |
| **P4**      | Suggerimento, miglioramento, documentazione                  | < 5 giorni lavorativi  |

### 8.3 Onboarding
Il primo evento del Cliente e' affiancato da una sessione formativa remota
(2h videocall) gratuita inclusa nel contratto.

---

## 9. Proprieta intellettuale

Il software Live SLIDE CENTER (codice sorgente, design, documentazione, marchio
"Live SLIDE CENTER") e' di esclusiva proprieta del Fornitore. Il Cliente acquisisce
unicamente un **diritto d'uso** non esclusivo. Vietati: reverse engineering,
decompilazione, redistribuzione, sublicenza a terzi.

I dati inseriti dal Cliente nel workspace (eventi, sessioni, presentazioni, foto,
biografie) restano di proprieta del Cliente.

---

## 10. Foro competente e legge applicabile

Il contratto e' regolato dalla **legge italiana**. Per ogni controversia il foro
esclusivo competente e' quello di **Roma**, fatta salva la giurisdizione del
foro del consumatore se applicabile.

---

## Allegati (separati)

- **Allegato A** — Atto di nomina Responsabile del Trattamento (DPA ex art. 28 GDPR)
- **Allegato B** — Listino prezzi corrente (`docs/Commerciale/Listino_Prezzi.md`)
- **Allegato C** — Manuale di Installazione Local Agent (`docs/Manuali/Manuale_Installazione_Local_Agent.md`)
- **Allegato D** — Manuale di Installazione Room Agent (`docs/Manuali/Manuale_Installazione_Room_Agent.md`)

---

**Data**: ____________________

**Per il Cliente**:
Ragione sociale: ____________________
Rappresentante legale: ____________________
Firma: ____________________

**Per il Fornitore**:
Andrea Rizzari Live Software
Firma: ____________________
