# Guida uso interno DHS — Live SLIDE CENTER

> **Versione:** 1.0 (Sprint 8 — 17 Aprile 2026)
> **Pubblico:** Andrea + team operativo DHS che usa Slide Center come strumento interno per gli eventi.
> **Stato:** Quick start operativo. Non sostituisce i manuali per cliente esterno (`Manuale_Onboarding_Admin.md`, `Manuale_Installazione_*.md`).

Questa guida e' la "checklist operativa" da usare **prima**, **durante** e **dopo** ogni evento gestito internamente da DHS con Slide Center. Tutto cio' che e' richiesto per la vendita esterna (DPA, sito marketing, primi clienti) e' nel documento separato `docs/Commerciale/Roadmap_Vendita_Esterna.md` e non blocca l'uso interno.

---

## 0. Setup una tantum (gia' fatto)

Da fare una sola volta nella vita del tenant DHS. Se uno dei punti non e' fatto, vedi il riferimento per recuperare:

| #   | Cosa                                                                 | Riferimento                               |
| --- | -------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Tenant DHS creato su Slide Center cloud                              | `https://app.liveworksapp.com/signup`     |
| 2   | Andrea = ruolo `super_admin` su Supabase + admin del tenant DHS      | Supabase Studio → Auth → Users → metadata |
| 3   | Sale registrate (Plenaria, Sala 1, Sala 2…)                          | UI: `/events/<id>` → "Sale"               |
| 4   | Local Agent installato sui mini-PC regia DHS (uno per evento)        | `Manuale_Installazione_Local_Agent.md`    |
| 5   | Room Agent installato sui PC sala DHS (uno per sala)                 | `Manuale_Installazione_Room_Agent.md`     |
| 6   | (Opzionale) Resend configurato → email welcome / scadenza licenza    | `Manuale_Email_Resend.md`                 |
| 7   | (Opzionale) Cert OV per firma installer → niente warning SmartScreen | `Manuale_Code_Signing.md`                 |

Se Resend e cert OV non sono configurati, l'app **funziona ugualmente** per uso interno. Le email transazionali saranno semplicemente saltate (warning visibili in dashboard) e gli installer mostreranno un avviso SmartScreen su PC vergini.

---

## 1. Pre-evento (T-7 / T-1 giorni prima)

### 1.1 Crea evento + sale + sessioni

1. Apri `https://app.liveworksapp.com/events`.
2. **Nuovo evento** → nome (es. "DHS Conference 2026"), date, location.
3. Dentro l'evento:
   - **Sale**: aggiungi tutte le sale fisiche (Plenaria, Workshop A, ecc.).
   - **Sessioni**: crea i blocchi temporali (es. "Mattina 9-13") con sala assegnata.
   - **Speaker**: aggiungi i relatori per ogni sessione. Per ognuno → "Genera link upload" → copia URL personalizzato `https://app.liveworksapp.com/u/<token>`.
4. Manda i link upload via email/WhatsApp ai relatori. Loro caricano slide senza account.

### 1.2 Verifica stato sistema

- Apri `/status` (anche senza login): verifica che tutti i servizi siano `Operational`.
- Apri Dashboard `/`: card Storage deve essere sotto 80% di capacita'. Se sopra, libera vecchi eventi via Settings → Demo & Onboarding → "Cancella eventi demo".
- Card Licenza deve essere `verde` (>30 giorni). Se gialla/rossa, vedi sez. 4.

### 1.3 Prepara hardware fisico

- **Mini-PC regia DHS**: avvia Local Agent → tray icon visibile + UI `http://localhost:3000` mostra "Connesso".
- **PC sala**: per ogni sala, avvia Room Agent → tray icon + scansione discovery → trovare Local Agent in LAN entro 30s. Se non trova, vedi `Manuale_Installazione_Room_Agent.md` § "Discovery 4-tier".
- Pairing PC sala ↔ tenant DHS: dalla regia (`/events/<id>/devices/pair`) genera codice 6 cifre, immettilo sul Room Agent.

---

## 2. Giorno dell'evento

### 2.1 Mattina (T-2h)

- **Apri Vista Regia** `/events/<id>/live`. Lascia aperta su un secondo monitor.
- **Verifica device pairing**: tutti i PC sala devono apparire `online` (pallino verde).
- **Verifica presentazioni**: per ogni speaker della prima sessione, lo stato deve essere `uploaded`, `reviewed` o `approved`. Se `pending` (mai caricato), contatta lo speaker o usa "Carica per conto suo" (drag-and-drop admin).

### 2.2 Durante l'evento

- Vista Regia mostra in real-time:
  - Slide corrente per ogni sala
  - Stato di sincronizzazione cloud ↔ Local Agent ↔ PC sala
  - Activity log live (ultime 50 azioni, polling 10s)
- **Cambio slide**: lo speaker controlla il proprio dispositivo. Se serve override regia → click sulla card sala → "Forza slide successiva/precedente".
- **Speaker ritardatario**: nuovo upload tardivo? Lo speaker carica via il suo link, l'aggiornamento appare in regia entro 5s. Se non appare, ricarica la pagina.

### 2.3 Modalita intranet (no internet)

Se la rete del venue va giu':

- Local Agent continua a servire le slide gia' sincronizzate.
- I PC sala continuano a leggere dal Local Agent via LAN.
- L'unico componente non disponibile e' la regia web (`/events/<id>/live`) → fallback: vai al Local Agent UI `http://<ip-mini-pc>:3000` per controllo manuale.

---

## 3. Post-evento

### 3.1 Subito dopo l'evento (entro 24h)

- **Export evento**: `/events/<id>` → "Export ZIP". Genera archivio con manifest, CSV speaker, CSV sessioni, PDF tutte le presentazioni. Archivia in cartella DHS Drive.
- **Audit log**: `/audit` → filtri data evento → esporta come prova di tracciabilita' (utile in caso di dispute con cliente o per fatturazione).
- **Cambio stato evento**: `closed` → archivia (read-only, non rimovibile dalla regia ma sempre consultabile).

### 3.2 Manutenzione (settimanale)

- **Backup workspace completo**: Settings → Privacy & GDPR → "Esporta dati workspace". Genera ZIP con tutti i dati del tenant (manifest + CSV + JSON + README). Conservare 4 copie (rotazione mensile).
- **Cleanup demo**: Settings → "Cancella eventi demo" se accumulati durante test.
- **Verifica storage**: Dashboard → card Storage. Se >80%, valutare upgrade piano o pulizia.

### 3.3 Manutenzione (mensile)

- **Aggiorna versione Slide Center**: pull main + `pnpm install` + deploy via `firebase deploy` (vedi `.cursor/rules/deploy-git-workflow.mdc`).
- **Aggiorna agent desktop**: `release-licensed.bat` → reinstalla su mini-PC + PC sala se ci sono fix critici.
- **Audit log review**: filtra per `action ILIKE '%failed%'` o `%denied%' per vedere errori ricorrenti.

---

## 4. Cosa fare se…

### 4.1 La licenza sta per scadere

- Banner giallo/rosso in cima all'app + email automatica (se Resend configurato) a T-30, T-7, T-1.
- Andrea → Live WORKS APP → rinnova licenza tenant → la sync arriva entro 5 minuti.
- Verifica avvenuto rinnovo: Dashboard → card Licenza torna verde.

### 4.2 Storage quasi pieno

- Banner giallo (>80%) o rosso (>95%) automatico.
- Cancella vecchie versioni di presentazioni: per ogni speaker, "Storico versioni" → mantenere solo le ultime 2-3.
- In emergenza: cancella eventi vecchi (`closed` da >6 mesi) via UI eventi.

### 4.3 Un PC sala non sincronizza

1. Verifica connessione LAN del PC sala con il mini-PC regia.
2. Local Agent in tray → UI → "Reset cache" + ricarica.
3. Su PC sala: Room Agent UI → "Re-discovery" (forza nuova scansione).
4. Se persiste: re-pairing del device dalla regia (`/events/<id>/devices`).

### 4.4 Una presentazione non apre

- Vista Regia → scheda speaker → "Storico versioni" → "Ripristina" su una versione precedente.
- Lo speaker ricarica dal suo link upload.
- Admin: drag-and-drop diretto da `EventDetailView` (carica per conto dello speaker).

### 4.5 Un sub-evento richiede credenziali secondarie

- `/team` → invita collaboratore con ruolo `editor` (puo' modificare eventi, NON puo' invitare nuovi utenti).
- L'utente riceve email automatica welcome (se Resend attivo) + link `accept-invite/:token`.
- Dopo l'evento, revoca: `/team` → "Rimuovi" sull'utente.

---

## 5. Test sul campo (raccomandato prima di ogni evento importante)

Lista checklist da eseguire 1-2 giorni prima di un evento DHS critico (>50 partecipanti o cliente VIP):

- [ ] Test pairing: pairing nuovo PC sala finisce entro 30 secondi.
- [ ] Test upload: speaker fittizio carica un .pptx 50 MB → appare in regia entro 10s.
- [ ] Test sync intranet: stacca cavo internet del mini-PC regia → PC sala continua a funzionare.
- [ ] Test backup: Privacy → Export workspace → ZIP scaricato ed apribile.
- [ ] Test status page: `/status` mostra tutti i servizi `Operational`.
- [ ] Test audit log: `/audit` mostra le ultime 10 azioni di test, filtri funzionano.
- [ ] Test email scadenza: Resend → simula T-7 con SQL `UPDATE tenants SET expires_at = now() + interval '6 days' WHERE id = '<dhs>'` + invoke `email-cron-licenses` → email arriva entro 5 minuti.
- [ ] Test rollback presentazione: carica v2 di una slide → "Ripristina v1" → versione corrente torna a v1.

Se un test fallisce → NON usare per l'evento critico. Aprire issue interna + fallback su processo manuale (PDF su USB).

---

## 6. Numeri utili (memorizzare)

- **Resend dashboard**: <https://resend.com/login> (account `live.software11@gmail.com`)
- **Supabase Studio Slide Center**: <https://supabase.com/dashboard/project/<project-id>>
- **GitHub repo Slide Center**: <https://github.com/live-software11/SLIDE-CENTER>
- **Live WORKS APP (licenze)**: <https://app.liveworksapp.com/admin/licenses>
- **Status page Slide Center**: <https://app.liveworksapp.com/status>
- **Email supporto**: live.software11@gmail.com (Andrea)

---

## 7. Cosa NON fare

- **NON** modificare manualmente i record `tenants.suspended` o `tenants.expires_at` da Supabase Studio durante un evento live (potrebbe sospendere l'accesso a meta' evento). Usa Live WORKS APP invece.
- **NON** revocare un user `admin` durante un evento (rischio di lock-out se sei tu l'unico admin).
- **NON** cancellare presentazioni "in uso" (status `approved` su sessione `active`). Usa "Sostituisci versione" se serve aggiornare.
- **NON** girare lo schedule cron `email-cron-licenses` piu' di una volta al giorno (anti-spam idempotente, ma sprecheresti quota Resend).
- **NON** mettere in repo file `.env*` con secret. Sono tutti gestiti via Supabase secret manager / GitHub Actions secrets.

---

## 8. Aggiornamento di questa guida

Aggiornare ad ogni:

- Cambio di processo operativo DHS interno
- Aggiunta di nuove feature significative al prodotto (es. nuovo Sprint)
- Cambio di hardware standard (es. nuovo modello mini-PC regia)

Versione corrente: `1.0` (Sprint 8 - chiusura piano). Prossima revisione attesa dopo i primi 3 eventi reali.
