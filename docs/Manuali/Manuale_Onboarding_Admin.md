---
title: "Live SLIDE CENTER — Manuale onboarding amministratore"
subtitle: "Guida al primo accesso e ai dati demo (versione 1.0)"
author: "Live Software — Andrea Rizzari"
date: "Aprile 2026"
lang: it
toc: true
toc-depth: 2
documentclass: article
geometry: margin=2.5cm
---

# Manuale onboarding amministratore

> **Pubblico:** chi attiva un nuovo tenant Live SLIDE CENTER (titolare/amministratore dell'organizzazione).
> **Tempo lettura:** ~7 minuti.
> **Prerequisito:** account Live SLIDE CENTER attivo, ruolo `admin` (solo l'amministratore vede il wizard di primo accesso).

---

## 1. Cosa succede al primo accesso

Quando entri per la prima volta nella dashboard `https://app.liveworksapp.com` (o sul tuo dominio personalizzato), Live SLIDE CENTER ti accoglie con un **wizard a 3 passi** in sovrimpressione che ti guida nella configurazione iniziale. Lo vedi solo tu (gli altri ruoli — coordinator, tech, super_admin — non lo vedono mai). Lo vedi solo una volta: dopo che lo chiudi (anche con "Salta"), non riappare al login successivo.

**Se preferisci non farlo subito**, puoi chiudere il wizard con la X in alto a destra o "Salta". Lo stato viene comunque marcato come "completato" per non disturbarti ad ogni navigazione. Puoi sempre **riaprirlo** da Settings (vedi §4).

---

## 2. I 3 passi del wizard

### Passo 1 — Benvenuto

Una pagina di introduzione che spiega in 3 punti cosa fa Live SLIDE CENTER:

1. **Carica le presentazioni dei relatori** in modo ordinato e versionato.
2. **Distribuiscile in tempo reale alle sale** via cloud o intranet locale.
3. **Coordina la regia** con vista live di stato sessioni e upload.

Bottone "Avanti" per procedere, "Salta" per chiudere senza configurare niente.

### Passo 2 — Crea il tuo primo evento (o genera dati demo)

Hai due alternative, scegli quella che preferisci:

**A) Crea il primo evento reale.** Compila il form inline:

- **Nome evento** (es: "Convegno Annuale 2026")
- **Data inizio** e **data fine** (date picker)
- **Modalita di rete**: `cloud` (default, slide servite da internet), `intranet` (solo rete locale, no internet richiesto), `hybrid` (entrambe, automatico)

Click "Crea evento" → l'evento appare nella tua lista, vai al passo 3.

**B) Genera dati demo.** Se vuoi prima vedere come funziona il prodotto senza preoccuparti di compilare campi reali, click "Genera dati demo". In ~2 secondi vengono creati:

- 1 evento "Demo Event" (etichettato come `demo` nei metadati)
- 2 sale (Sala A + Sala B)
- 3 sessioni distribuite nelle due sale
- 4 speaker assegnati alle sessioni
- 5 placeholder di presentazioni (vuoti, pronti per upload reale)

Bottone "Avanti" per andare al passo 3.

> **Nota:** `Genera dati demo` e' **idempotente**. Se la lanci una seconda volta non crea duplicati ma riusa lo stesso evento esistente. Per cancellare i dati demo (e tornare a un tenant pulito) usa "Cancella dati demo" in Settings (vedi §4).

### Passo 3 — Prossimi passi

Una pagina riepilogo che ti suggerisce cosa fare dopo la chiusura del wizard:

1. **Invita il team**: link rapido a `/team` per aggiungere coordinator + tech alla tua organizzazione (vedi `Manuale_Inviti_Team.md` se disponibile, altrimenti UI self-explanatory).
2. **Installa il Local Agent** sulla regia (mini-PC) — link al portale download Live WORKS APP per scaricare l'installer NSIS firmato.
3. **Installa il Room Agent** su ogni PC sala — stesso portale download.

Bottone "Vai alla dashboard" per chiudere il wizard.

---

## 3. Dopo la chiusura del wizard

### 3.1 Empty state della dashboard Eventi

Se hai chiuso il wizard senza creare niente (skip), nella pagina `/events` vedi una card centrata con:

- Titolo "Inizia da qui"
- Body esplicativo ("Crea il tuo primo evento o genera dati demo per esplorare il prodotto")
- Pulsante "Genera dati demo" che ti porta in Settings nella sezione dedicata

Stessa logica per `/team` (card "Invita il primo membro" con bottone diretto al dialog inviti).

### 3.2 Esplorazione tipica con dati demo

1. Vai in `/events` → click su "Demo Event"
2. Esplora le 2 sale, le 3 sessioni, i 4 speaker
3. Vai in vista regia (`/events/<id>/live`) per vedere come si presenta dal vivo
4. Click su `/sala/<token>` (token visibile in pannello Devices) per simulare un Room Player
5. Quando hai capito il flusso, **cancella i dati demo** (Settings → Demo & Onboarding → "Cancella dati demo") e crea i tuoi eventi reali

---

## 4. Sezione "Demo & Onboarding" in Settings

Vai in `Impostazioni` (icona ingranaggio in basso a sinistra) → scorri fino a "Demo & Onboarding". Solo l'admin vede questa sezione. Tre azioni disponibili:

### 4.1 Genera dati demo

Stesso comportamento del passo 2 del wizard. Idempotente: se gia' esistono dati demo, non crea duplicati ma ti ridice "gia presenti" (status `done` con messaggio dedicato).

**Quando usarla:**
- Per dimostrazioni commerciali in vivavoce a clienti potenziali
- Per testare configurazioni di rete (cloud vs intranet) senza creare eventi reali
- Per onboarding di nuovi membri del team che vogliono vedere il prodotto in azione

### 4.2 Cancella dati demo

Cancella SOLO gli eventi etichettati `demo` (creati da "Genera dati demo"), con cancellazione a cascata su sale, sessioni, speaker e presentazioni placeholder. **Gli eventi reali rimangono intatti.**

**Quando usarla:**
- Dopo aver finito di esplorare il prodotto, per partire pulito con i tuoi eventi reali
- Dopo una demo commerciale, per non lasciare l'evento demo visibile
- Se i dati demo sono stati creati piu' volte e vuoi resettarli

### 4.3 Riapri tour onboarding

Resetta il flag `onboarded_at` del tuo tenant. Al prossimo refresh della pagina riapparira' il wizard a 3 passi (utile se hai chiuso il wizard troppo in fretta o vuoi rivedere i passi per spiegarli ad altri).

**Nota tecnica:** non cancella nessun dato. Riapre solo l'overlay UI.

---

## 5. Stato del tenant — colonna `onboarded_at`

Per i tecnici curiosi: lo stato "wizard visto/non visto" e' memorizzato in una colonna `tenants.onboarded_at` nel database Supabase. Tre valori possibili:

- **`NULL`** (mai visto): il wizard appare automaticamente al primo accesso admin
- **timestamp** (es: `2026-04-17 14:32:11+00`): il wizard NON appare piu', il tenant ha gia completato l'onboarding (anche con skip)
- **resettato a NULL** via "Riapri tour": il wizard appare di nuovo

Lo stato e' single-source-of-truth nel DB, condiviso tra tutti i browser dello stesso admin (logout + login da altro device = stato preservato).

---

## 6. Domande frequenti

**D: Posso saltare il wizard e configurare il prodotto in totale autonomia?**
R: Si. Click su X o "Salta". L'esperienza e' identica a un admin che ha completato il wizard.

**D: Lo vede anche il team che invito?**
R: No. Solo i ruoli `admin` lo vedono. Coordinator, tech, super_admin non lo vedono mai.

**D: Se invito un secondo admin nella mia organizzazione, lo vede?**
R: No. Il flag `onboarded_at` e' per **tenant** (organizzazione), non per **utente**. Una volta che l'organizzazione ha completato l'onboarding (anche solo dal primo admin), nessun nuovo admin lo vedra' piu' al primo accesso.

**D: Posso forzare il wizard per il secondo admin?**
R: Si, vai in Settings → "Riapri tour onboarding". Al refresh, il wizard appare per il prossimo admin che entra (incluso quello che hai appena invitato).

**D: I dati demo influenzano le quote del piano (storage, eventi, sale)?**
R: Si, contano normalmente nelle quote. Per questo "Cancella dati demo" libera spazio. Sui piani Trial/Starter con quota bassa, valuta di cancellare i dati demo prima di sforare.

**D: Dove vedo lo stato di salute della piattaforma?**
R: Solo super_admin (livello operatore Live Software, non admin tenant) ha accesso a `/admin/health` con ping Supabase, Edge Functions e counter aggregati. Per uptime monitor esterni (UptimeRobot, BetterUptime) c'e' l'endpoint pubblico `https://app.liveworksapp.com/healthcheck.json` (configurato dal nostro team).

---

## 7. Versionamento del manuale

| Versione | Data       | Cambi                                                                          |
| -------- | ---------- | ------------------------------------------------------------------------------ |
| 1.0      | 17/04/2026 | Prima emissione (Sprint 6: wizard onboarding + dati demo + Settings)            |

**Da aggiornare quando:**

- Cambia il numero di passi del wizard (oggi 3) → §2
- Cambiano i contenuti dei passi → §2
- Cambia il comportamento di `Genera dati demo` o `Cancella dati demo` → §4
- Cambia il nome della sezione in Settings ("Demo & Onboarding") → §4
- Vengono aggiunti nuovi empty states con CTA → §3.1

---

**Fine manuale.**
