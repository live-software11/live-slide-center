# STATO E TO-DO LIVE SLIDE CENTER

> **Documento operativo gemello di `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md`.**
> Qui sta SOLO cosa rimane da fare, in ordine di priorita. Per "cosa fa il prodotto" e "come e fatto" → architettura.
>
> **Versione:** 2.2 — 18 aprile 2026 (post-Sprint R-1)
> **Owner:** Andrea Rizzari
> **Stato globale:** Tutti gli sprint A→I (cloud) + J→P + FT (desktop) + 1→8 (operativita commerciale) sono **DONE**. **Hardening Supabase + Vercel Sprint Q+1 (§0.8) DONE**. **Sprint R-1 (G1, super-admin crea tenant + licenze, §0.9) DONE**.
>
> **Audit chirurgico 18/04/2026 (§ 0):** identificati **10 GAP funzionali** rispetto agli obiettivi di prodotto dichiarati da Andrea (parita cloud/desktop, versioning, performance impatto-zero, super-admin licenze, file management OneDrive-style, drag&drop PC, upload da sala, export ordinato, competitivita PreSeria/Slidecrew/SLIDEbit). I gap sono raggruppati in 3 macro-sprint **R / S / T** con ordine di priorita. **Stato chiusura: 1/10 chiuso (G1 in R-1).**
>
> **Hardening Sprint Q+1 (§ 0.8):** completato hardening backend (Supabase RLS least-privilege + 7 indici hot-path + PKCE + CSP + CI types drift + auto-deploy Edge Functions).
>
> **Sprint R-1 (§ 0.9):** super-admin puo' creare nuovi tenant cliente + invito primo admin direttamente da `/admin/tenants`. Tipi i18n IT/EN allineati. Quality gates verdi. Verde per partire con Sprint R-2 (Live WORKS APP integration) quando vuoi.

---

## INDICE

0. [Audit chirurgico 18/04/2026 — gap vs obiettivi prodotto](#0-audit-chirurgico-18042026--gap-vs-obiettivi-prodotto)
   - 0.8 [Hardening Supabase + Vercel (Sprint Q+1 — DONE)](#08-hardening-supabase--vercel-sprint-q1--done-18042026)
   - 0.9 [Sprint R-1 — Super-admin crea tenant + licenze (DONE)](#09-sprint-r-1--super-admin-crea-tenant--licenze-done-18042026)
1. [Stato attuale (tutto DONE)](#1-stato-attuale-tutto-done)
2. [Cose da fare ORA (azioni esterne Andrea, NON automatizzabili)](#2-cose-da-fare-ora-azioni-esterne-andrea-non-automatizzabili)
3. [Field test desktop (quando vorrai farlo)](#3-field-test-desktop-quando-vorrai-farlo)
4. [Sprint Q — Sync hybrid cloud↔desktop (opzionale, ready-to-code)](#4-sprint-q--sync-hybrid-clouddesktop-opzionale-ready-to-code)
5. [Backlog post-vendita (sales + legale + marketing)](#5-backlog-post-vendita-sales--legale--marketing)
6. [Backlog post-MVP (idee future, NON urgenti)](#6-backlog-post-mvp-idee-future-non-urgenti)
7. [Comandi rapidi (cheat-sheet quotidiano)](#7-comandi-rapidi-cheat-sheet-quotidiano)

---

## 0. Audit chirurgico 18/04/2026 — gap vs obiettivi prodotto

> Audit effettuato sul 100% del codice in `apps/web`, `apps/desktop`, `supabase/`, contro gli obiettivi sovrani dichiarati da Andrea il 18/04/2026:
>
> 1. Cloud e desktop **identici** dal punto di vista fruizione (cambia solo backend).
> 2. **File partono SEMPRE dal PC locale** che li proietta.
> 3. **Versione "in onda" sempre chiara** (lo stesso file puo' essere modificato 100 volte).
> 4. **Impatto sui PC di messa in onda = 0** (performance app + sync = "iper stabile").
> 5. **Super-admin in app crea licenze tenant** (e Live WORKS APP usa gli STESSI dati).
> 6. **Admin azienda → evento → sale → sessioni** (gia' OK) + **PC si allocano nelle sale via drag&drop**.
> 7. **File management stile OneDrive**: cartelle/sottocartelle, upload drag&drop di file E folder intere.
> 8. **PC "Centro Slide"** che ha i dati di **TUTTE le sale** dell'evento.
> 9. **PC sala puo' caricare/sovrascrivere** verso centro slide (relatore arriva all'ultimo minuto).
> 10. **Export fine evento ordinato** (cartelle per sala/sessione, non un piatto singolo).
> 11. **Competitivita** vs PreSeria, Slidecrew, SLIDEbit (TC Group), OCSA Suite.

### 0.1 Sintesi GAP (10 totali, prioritizzati)

| ID  | Gap                                                               | Severita   | Modulo                                                                              | Sprint  | Stato       |
| --- | ----------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- | ------- | ----------- |
| G1  | Super-admin non puo' creare licenze tenant da app                 | **HIGH**   | `apps/web/src/features/admin/` + RPC SECURITY DEFINER                               | **R-1** | **DONE** ✅ |
| G2  | Live WORKS APP integrazione = solo link esterno (no parita dati)  | **HIGH**   | `apps/web/src/features/billing/` + webhook Lemon Squeezy condiviso                  | **R-2** | next        |
| G3  | PC sala NON puo' caricare/sovrascrivere file (read-only)          | **HIGH**   | `apps/web/src/features/devices/RoomPlayerView.tsx`                                  | **R-3** | pending     |
| G4  | Drag&drop di **folder intera** in upload admin assente            | **MEDIUM** | `apps/web/src/features/presentations/components/SessionFilesPanel.tsx`              | **S-1** | pending     |
| G5  | Drag&drop visivo PC ↔ sale assente (solo dropdown)                | **MEDIUM** | `apps/web/src/features/devices/components/DeviceList.tsx` + nuova `RoomAssignBoard` | **S-2** | pending     |
| G6  | Export ZIP fine evento piatto (no struttura sala/sessione)        | **MEDIUM** | `apps/web/src/features/events/lib/event-export.ts` `buildEventSlidesZip`            | **S-3** | pending     |
| G7  | "Centro Slide" multi-room = ruolo device assente                  | **MEDIUM** | DB schema `paired_devices.role` + `useFileSync` multi-room manifest                 | **S-4** | pending     |
| G8  | Versione "in onda" non visibile a colpo d'occhio in sala          | **LOW**    | `apps/web/src/features/devices/RoomPlayerView.tsx` overlay badge `vN/M`             | **T-1** | pending     |
| G9  | Telemetria perf live PC sala (CPU/RAM/disco) non aggregata        | **LOW**    | `room_state` schema + `<RoomCard>` overlay realtime                                 | **T-2** | pending     |
| G10 | Features competitor mancanti (file checking, ePoster, mobile SRR) | **LOW**    | Vari (vedi §0.4)                                                                    | **T-3** | pending     |

### 0.2 Cosa funziona GIA' bene (non toccare)

| Obiettivo Andrea             | Stato attuale                                                                                    | File chiave                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Stessa SPA cloud + desktop   | DONE — `apps/web/src/lib/{backend-mode,backend-client,realtime-client}.ts` astraggono il backend | `apps/web/src/lib/backend-mode.ts`                                             |
| File partono da locale       | DONE — `enforceLocalOnly: true` enforced runtime su PC sala, log violazioni                      | `apps/web/src/features/presentations/hooks/useFilePreviewSource.ts:58, 108`    |
| Versioning DB                | DONE — append-only `presentation_versions` + `current_version_id` + rollback                     | `apps/web/src/features/presentations/components/PresentationVersionsPanel.tsx` |
| Performance live mode        | DONE — polling 60s, throttle 50ms/4MB, priority `low`, concurrency 1 (no impatto playback 4K)    | `apps/web/src/features/devices/hooks/useFileSync.ts:89-105`                    |
| Drag&drop file singoli/multi | DONE — drop su SessionFilesPanel + drag tra sessioni con MIME custom anti-spoof                  | `apps/web/src/features/presentations/lib/drag-presentation.ts`                 |
| Multi-select bulk + ZIP      | DONE — toolbar bulk con jszip, action move/delete/zip con concurrency 1                          | `apps/web/src/features/presentations/lib/zip-bulk-download.ts`                 |
| Search globale evento        | DONE — combobox WAI-ARIA cross-sessione                                                          | `apps/web/src/features/events/components/EventSearchBar.tsx`                   |
| Vista regia multi-sala       | DONE — `LiveRegiaView` mostra grid di tutte le sale dell'evento + activity feed                  | `apps/web/src/features/live-view/LiveRegiaView.tsx`                            |
| Hash SHA-256 + verifica      | DONE — verify post-download con 3 retry, badge "verificato" UI                                   | `apps/web/src/features/devices/hooks/useFileSync.ts:41`                        |
| Auto-rejoin PC sala al boot  | DONE — `device_token` IndexedDB + `device.json` per Tauri                                        | `apps/web/src/features/devices/RoomPlayerView.tsx:54-71`                       |

### 0.3 Dettaglio dei 10 GAP — analisi tecnica e soluzione

#### G1 — Super-admin non puo' creare licenze tenant da app

**Evidenza codice:**

- `apps/web/src/features/admin/AdminTenantsView.tsx`: lista tenant esistenti + cambio quota plan, **nessun bottone "Crea nuovo tenant"**.
- `apps/web/src/features/admin/AdminTenantDetailView.tsx:69-77`: solo `UPDATE` su `tenants`, niente `INSERT`.
- Tenant viene creato esclusivamente dal trigger `handle_new_user_tenant` quando un utente fa signup.
- Andrea (super-admin DHS) non ha un flusso UI per: "voglio vendere licenza Pro a azienda X, creo io il tenant + invito admin".

**Soluzione tecnica:**

- Nuova Edge Function `admin-create-tenant` (idempotente, gated su `app_metadata.role === 'super_admin'`).
- Form `apps/web/src/features/admin/AdminTenantCreateView.tsx`: nome azienda + slug + plan + storage_limit + max_events + max_rooms + email primo admin (genera invite email automaticamente).
- Chiama Edge Function → `INSERT INTO tenants` + `INSERT INTO tenant_invites` (riusa Sprint 7 invite system).
- License key generata via Lemon Squeezy API o manuale (super-admin puo' digitare key esterna).

**Tempo stima:** 1.5 giorni dev + 0.5 test.

#### G2 — Live WORKS APP integrazione = solo link esterno

**Evidenza codice:**

- `apps/web/src/features/billing/lib/billing-env.ts:5,20`: `liveWorksApp` e' SOLO un URL `VITE_LIVE_WORKS_APP_URL`.
- Nessun webhook bidirezionale: una licenza creata su Live WORKS APP NON appare in Slide Center come tenant attivo.
- Andrea: "in app come super admin posso creare licenze per aziende (e anche tramite live works app che deve lavorare sugli stessi dati, per cui quello che vedo li e in app deve essere identico)".

**Soluzione tecnica:**

- Tabella condivisa `companies` su un Supabase project comune (es. `liveworks-shared`) o, piu' realisticamente: **Lemon Squeezy come single source of truth**.
- Edge Function `lemon-webhook-licenses` (idempotente con dedupe su `event_id`) in **ENTRAMBE** le app:
  - Live WORKS APP riceve webhook → scrive su `licenses_master` (Live WORKS APP DB).
  - Slide Center riceve stesso webhook → crea tenant via `admin-create-tenant` (G1) automaticamente.
- Sync bidirezionale realtime: quando admin DHS crea tenant in Slide Center → POST verso Live WORKS APP API per registrare la licenza la'.
- Tabella `tenant_external_refs` in Slide Center: `{tenant_id, live_works_license_id, lemon_squeezy_subscription_id}`.

**Tempo stima:** 2 giorni dev + 1 test (richiede sync con Live WORKS APP repo).

**Decisione architettonica:** scegliere fra:

- **Opzione A (consigliata):** Lemon Squeezy = single source of truth → entrambe le app subiscono i webhook. Vantaggio: zero accoppiamento dirètto.
- **Opzione B:** Live WORKS APP espone `/api/licenses` REST consumata da Slide Center (`apps/web/src/features/admin/` chiama ad ogni mount). Vantaggio: controllo unico in Live WORKS APP. Svantaggio: Slide Center diventa client di Live WORKS APP, fragile in offline.

#### G3 — PC sala NON puo' caricare/sovrascrivere file

**Evidenza codice:**

- `apps/web/src/features/devices/RoomPlayerView.tsx`: 972 righe SOLO downloader+display.
- Nessun import di `AdminUploaderInline` o `useUploadQueue`.
- Pairing PC sala usa `device_token`, NON ha sessione utente Supabase → `init_upload_version_admin` (che valida `auth.jwt() ->> 'tenant_id'`) **rifiuterebbe** la chiamata.
- Andrea: "i pc in sala possono caricare e sovrascrivere i dati caricati in centro slide (relatore viene a ultimo minuto in sala e aggiunge o modifica qualcosa)".

**Soluzione tecnica:**

- Nuova Edge Function `room-device-upload-init` (autenticata via `device_token` invece che JWT user):
  - Verifica `paired_devices.device_token` valido + non revocato.
  - Estrae `tenant_id` dal device → bypassa il guard JWT.
  - Crea `presentation_version` con `uploaded_by_device_id` (nuovo campo audit).
- Componente `apps/web/src/features/devices/components/RoomSpeakerCheckIn.tsx`: bottone "Aggiungi/aggiorna slide del relatore X" → seleziona file → upload via `room-device-upload-init`.
- UX: mostrato SOLO sui PC sala (non sui PC admin), tipico flusso "Speaker Ready Room" (cosi' si chiama nei competitor).
- Sync inverso: il file caricato dal PC sala diventa nuova versione + push realtime al Centro Slide → admin vede "nuova versione caricata da Sala 3 alle 14:23".

**Tempo stima:** 2 giorni dev + 1 test.

#### G4 — Drag&drop di folder intera in upload admin assente

**Evidenza codice:**

- `apps/web/src/features/presentations/components/SessionFilesPanel.tsx`: drop accepta `DataTransfer.files` (file singoli/multipli) ma NON usa `webkitGetAsEntry()` per ricorsione folder.
- `apps/web/src/features/devices/lib/fs-access.ts`: usa FSA Directory ma SOLO per cartella locale del PC sala, non per upload.
- Andrea: "carico tramite stato o drag and drop files o cartelle intere".

**Soluzione tecnica:**

- Estendere `useUploadQueue` con helper `enqueueFromDataTransferItems(items: DataTransferItem[])`:
  - Per ogni `item.webkitGetAsEntry()`: se file → enqueue diretto, se directory → ricorsione asincrona con `DirectoryReader.readEntries()`.
  - Path relativo `subfolder/file.pdf` → diventa nome file sanitizzato `subfolder_file.pdf` (o crea subentita "session" automaticamente).
- Decidere mapping: una folder droppata diventa **nuova sessione** dentro la sala? O tutti i file vanno in sessione corrente con prefix? **Consigliata opzione 1**: matcha mental model "folder = sessione".
- UI feedback: durante drag, badge "12 file in 3 cartelle pronti per upload".

**Tempo stima:** 1.5 giorni dev + 0.5 test.

#### G5 — Drag&drop visivo PC ↔ sale assente

**Evidenza codice:**

- `apps/web/src/features/devices/components/DeviceList.tsx:91-101`: assegnazione sala via menu dropdown `<button onClick={handleRoomChange(room.id)}>`.
- Nessun `draggable` o `onDrop` handler.
- Andrea: "si aggiungono pc e si allocano nelle sale (tramite anche drag and drop)".

**Soluzione tecnica:**

- Nuova vista `apps/web/src/features/devices/RoomAssignBoardView.tsx` (route `/devices/board`):
  - Pannello sx: lista PC paired non assegnati ("Disponibili").
  - Pannello dx: griglia sale con drop-zones colorate.
  - HTML5 DnD nativo (senza librerie esterne, coerente con `drag-presentation.ts`).
  - MIME custom `application/x-slidecenter-device` per evitare conflitti.
  - Dropdown attuale RIMANE come fallback keyboard-only (a11y).
- Bonus: drag PC tra due sale (sposta), drag PC fuori sala (libera).

**Tempo stima:** 1.5 giorni dev + 0.5 test (incluso a11y check).

#### G6 — Export ZIP fine evento piatto

**Evidenza codice:**

- `apps/web/src/features/events/lib/event-export.ts:367-391` `buildEventSlidesZip`: tutti i file vanno in `slides/<speakerName>_v<n>_<filename>`.
- Andrea: "i pc assegnati al centro slide devono avere i dati di tutte le sale e a fine evento devo poter scaricare tutto in modo ordinato".

**Soluzione tecnica:**

- Refactor `buildEventSlidesZip(supabase, slides, rooms, sessions, onProgress)`:
  - Struttura nuovo zip:
    ```
    <event_name>/
      Sala_Plenaria/
        Sessione_09:00_Keynote/
          Mario_Rossi_v3_intro.pptx
          Mario_Rossi_v3_intro.pdf  (PDF auto-generato, opzionale)
        Sessione_10:30_Tavola_Rotonda/
          ...
      Sala_Workshop_A/
        ...
      _Manifest.csv  (CSV con file → versione → hash → uploader → timestamp)
      _Activity_Log.csv
      _Report.pdf
    ```
- `sanitizeExportSegment` gia' presente, riutilizzabile.
- Backward compat: aggiungere flag `flat: boolean` al chiamante per modalita legacy.

**Tempo stima:** 1 giorno dev + 0.5 test.

#### G7 — "Centro Slide" multi-room = ruolo device assente

**Evidenza codice:**

- `paired_devices.room_id` UNICO → 1 device = 1 sala.
- Andrea: "i pc assegnati al centro slide devono avere i dati di tutte le sale".

**Soluzione tecnica:**

- DB migration: aggiungere `paired_devices.role text not null default 'room_player' check (role in ('room_player', 'control_center'))`.
- Quando `role = 'control_center'`, `room_id` puo' essere NULL.
- Nuovo Edge Function / RPC `control_center_bootstrap`: ritorna manifest di TUTTE le sale dell'evento (no filtro `room_id`).
- `useFileSync` esteso con param `multiRoom: boolean`: se true, scarica file di tutte le sale e li deposita in subfolder `<sala>/<sessione>/<file>`.
- UI: vista `apps/web/src/features/devices/ControlCenterView.tsx` con tab per sala + filtro globale.

**Tempo stima:** 2 giorni dev + 1 test.

#### G8 — Versione "in onda" non visibile a colpo d'occhio in sala

**Evidenza codice:**

- `RoomPlayerView` mostra il file corrente ma non c'e' badge persistente "v3 di 5".
- `presentation.current_version_id` esiste in DB e popola `room_state.current_presentation_id`.
- Andrea: "deve essere chiaro quale versione si stia usando di un file (in un centro slide lo stesso file puo' essere modificato 100 volte)".

**Soluzione tecnica:**

- Overlay top-right su `RoomPlayerView` durante playback: badge `v3 / 5 — caricato 14:23 da Mario`.
- Auto-fade dopo 5s, ricompare on hover/tap.
- Toast notify quando admin cambia `current_version_id`: "Nuova versione caricata: v4 (slide 12 modificata)".
- Color coding: verde se versione corrente, giallo se non e' la piu' recente.

**Tempo stima:** 0.5 giorni dev + 0.25 test.

#### G9 — Telemetria perf live PC sala non aggregata

**Evidenza codice:**

- `room_state` ha `sync_status`, `current_presentation_id`, `last_seen_at` ma NON cpu/ram/disk/net.
- Andrea: "impatto sui pc di messa in onda deve essere 0 per cui performance applicazione desktop e sincronizzazione files deve essere perfetta".

**Soluzione tecnica:**

- Migration: aggiungere `room_state.cpu_pct smallint, ram_pct smallint, disk_free_gb int, net_kbps_in int` (tutti nullable per backward compat).
- PC sala (Tauri): comando Rust `get_system_metrics()` via crate `sysinfo`, push ogni 30s in live mode.
- PC sala (Web SPA): non ha accesso ai system metrics → resta NULL (graceful).
- `<RoomCard>` overlay: badge `CPU 18% · RAM 1.2GB · 95Mbps` sotto nome sala.
- Alert dashboard: highlight rosso se CPU > 80% o RAM > 90% per > 60s.

**Tempo stima:** 1 giorno dev + 0.5 test.

#### G10 — Features competitor mancanti (PreSeria, Slidecrew, SLIDEbit)

**Riferimento ricerca web:**

- **PreSeria** (preseria.com): file error checking automatico (font mancanti, video non embedded), email tracking aperture, PDF auto-publish post-conferenza, mobile companion app per Speaker Ready Room, email reminder schedulati con template.
- **Slidecrew** (slidecrew.com): ePoster interactive (poster digitali interattivi), speaker timer integrato, preview screen per prossima slide, remote slide control da tablet, branding fully customizable, post-event media library.
- **SLIDEbit (TC Group meetbit.it)**: gestione speaker remoti+presenza+streaming, recording integrato, multi-room ESOT-scale (12+ sale), upload multi-canale.
- **OCSA Suite**: workflow editoriale review multi-stadio (director/track director/reviewer/author), gestione abstract submission, certificate of attendance auto.

**Features rilevanti per Slide Center (priorita commerciale):**

| Feature                                               | Ispirato da                   | Difficolta tech | Priorita | Sprint   |
| ----------------------------------------------------- | ----------------------------- | --------------- | -------- | -------- |
| **File error checking automatico**                    | PreSeria                      | Media           | **HIGH** | T-3a     |
| Verifica font embedded in .pptx                       |                               |                 |          |          |
| Verifica video presenti (non broken link)             |                               |                 |          |          |
| Verifica risoluzione min 1920x1080                    |                               |                 |          |          |
| Warning aspect ratio errato (4:3 vs 16:9)             |                               |                 |          |          |
| Implementazione: Edge Function Deno + python-pptx     |                               |                 |          |          |
| **PDF auto-generato lato server**                     | PreSeria, Slidecrew           | Alta            | MED      | T-3b     |
| Conversione .pptx → PDF via LibreOffice headless      |                               |                 |          |          |
| Hosting su Supabase Storage bucket pubblico           |                               |                 |          |          |
| Speaker puo' opt-out dal pubblicare                   |                               |                 |          |          |
| **Email reminder schedulati**                         | PreSeria                      | Bassa           | **HIGH** | T-3c     |
| Cron giornaliero su sessioni con upload pending       |                               |                 |          |          |
| Template gia' presente (Sprint 7), aggiungere job     |                               |                 |          |          |
| **Email tracking (open + click)**                     | PreSeria                      | Bassa           | LOW      | post-MVP |
| Resend ha gia' `tracking: { opens, clicks }`          |                               |                 |          |          |
| Dashboard `<EmailTrackingPanel>` admin                |                               |                 |          |          |
| **Speaker timer integrato**                           | Slidecrew, Live SPEAKER TIMER | Bassa           | **HIGH** | T-3d     |
| Iframe / link diretto al Live SPEAKER TIMER           |                               |                 |          |          |
| Sync sessione corrente → durata pianificata           |                               |                 |          |          |
| **Preview screen prossima slide**                     | Slidecrew                     | Media           | MED      | T-3e     |
| Mostra anteprima slide successiva sul PC tecnico      |                               |                 |          |          |
| Richiede pdf.js render headless                       |                               |                 |          |          |
| **Remote slide control da tablet**                    | Slidecrew                     | Media           | LOW      | post-MVP |
| App PWA mobile per scrollare slide remoto via WebRTC  |                               |                 |          |          |
| **Mobile companion Speaker Ready Room**               | PreSeria                      | Alta            | LOW      | post-MVP |
| App React Native per check-in speaker + verifica file |                               |                 |          |          |
| **ePoster interactive**                               | Slidecrew                     | Alta            | LOW      | post-MVP |
| Bucket dedicato + tag `kind: 'eposter'`               |                               |                 |          |          |
| Vista pubblica con search + filtri                    |                               |                 |          |          |
| **Certificate of attendance auto**                    | OCSA Suite                    | Bassa           | LOW      | post-MVP |
| PDF generato a fine evento per ogni partecipante      |                               |                 |          |          |
| **Multi-stage review workflow**                       | OCSA Suite                    | Media           | LOW      | post-MVP |
| presentations.status gia' ha approved/rejected        |                               |                 |          |          |
| Aggiungere ruoli `reviewer` separato da `coordinator` |                               |                 |          |          |

### 0.4 Roadmap GAP — Sprint R / S / T (proposta)

> **Decisione GO/NO-GO Andrea richiesta** prima di iniziare ciascuno sprint. Tutti gli sprint sono **opzionali** rispetto al "vendere oggi a DHS". Servono per **rendere il prodotto competitivo** verso PreSeria/Slidecrew (~€1.140/evento) e portarlo a livello di vendita esterna.

#### Sprint R — "Multi-tenant commercial readiness" (HIGH priority — 5 giorni)

| Sprint  | Gap | Obiettivo                                                    | Tempo dev | Tempo test | Output                                                |
| ------- | --- | ------------------------------------------------------------ | --------- | ---------- | ----------------------------------------------------- |
| **R-1** | G1  | Super-admin crea tenant da app                               | 1.5 g     | 0.5 g      | `AdminTenantCreateView` + Edge `admin-create-tenant`  |
| **R-2** | G2  | Live WORKS APP ↔ Slide Center sync via Lemon Squeezy webhook | 2 g       | 1 g        | Webhook condiviso + tabella `tenant_external_refs`    |
| **R-3** | G3  | PC sala upload speaker check-in                              | 2 g       | 1 g        | `RoomSpeakerCheckIn` + Edge `room-device-upload-init` |

**GO/NO-GO criteri:**

- GO se Andrea conferma: "voglio iniziare a vendere a clienti esterni nei prossimi 30 giorni".
- NO-GO se: "DHS basta, niente vendita esterna a breve" → mantieni stato attuale, R rimane backlog.

#### Sprint S — "OneDrive-style file management" (MEDIUM priority — 5 giorni)

| Sprint  | Gap | Obiettivo                                        | Tempo dev | Tempo test | Output                                         |
| ------- | --- | ------------------------------------------------ | --------- | ---------- | ---------------------------------------------- |
| **S-1** | G4  | Drag&drop folder intera in upload admin          | 1.5 g     | 0.5 g      | `useUploadQueue` esteso con `webkitGetAsEntry` |
| **S-2** | G5  | Drag&drop visivo PC ↔ sale (board)               | 1.5 g     | 0.5 g      | `RoomAssignBoardView` + DnD HTML5 nativo       |
| **S-3** | G6  | Export ZIP fine evento strutturato sala/sessione | 1 g       | 0.5 g      | `buildEventSlidesZip` v2 con tree              |
| **S-4** | G7  | "Centro Slide" multi-room device role            | 2 g       | 1 g        | `paired_devices.role` + `ControlCenterView`    |

**GO/NO-GO criteri:**

- GO se Andrea conferma: "preparo evento DHS reale con piu' di 3 sale".
- NO-GO se: "DHS = max 2 sale, drag&drop dropdown attuale basta" → S diventa backlog.

#### Sprint T — "Performance + competitivita commerciale" (LOW-MED priority — 4 giorni)

| Sprint   | Gap | Obiettivo                                                 | Tempo dev | Tempo test | Output                                        |
| -------- | --- | --------------------------------------------------------- | --------- | ---------- | --------------------------------------------- |
| **T-1**  | G8  | Badge versione "in onda" sala + toast cambio versione     | 0.5 g     | 0.25 g     | Overlay `RoomPlayerView`                      |
| **T-2**  | G9  | Telemetria CPU/RAM/disco/rete PC sala in `room_state`     | 1 g       | 0.5 g      | Migration + comando Tauri Rust + `<RoomCard>` |
| **T-3a** | G10 | File error checking automatico (font, video, risoluzione) | 1.5 g     | 0.5 g      | Edge Function `slide-validator`               |
| **T-3c** | G10 | Email reminder schedulati (cron upload pending)           | 0.5 g     | 0.25 g     | Cron job + template gia' presenti             |
| **T-3d** | G10 | Speaker timer integrato (link Live SPEAKER TIMER)         | 0.5 g     | 0.25 g     | Iframe / link su `LiveRegiaView`              |

**GO/NO-GO criteri:**

- GO se Andrea conferma: "voglio competere su pricing con PreSeria, devo avere file checking + reminder".
- NO-GO se: "differenziatore = ecosistema Live + €149/mese, non serve match feature-by-feature" → T diventa nice-to-have.

### 0.5 Sintesi quantitativa post-audit

| Metrica                                         | Valore                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Sprint completati (A→I + J→P + FT + 1→8)        | 24 / 24                                                                    |
| Sprint backlog identificato (R + S + T)         | 11 sub-sprint                                                              |
| Tempo dev totale stimato (R+S+T completi)       | ~14 giorni dev + 6 giorni test = **20 giorni totali**                      |
| Costo cloud/infra incrementale (R+S+T completi) | €0 (tutto resta su Supabase Free + Vercel Free + Lemon Squeezy free)       |
| File da modificare (R+S+T)                      | ~25 file `apps/web` + 4 nuove Edge Functions + 3 migrations                |
| Backward compatibility                          | 100% (nessun breaking change, tutto opt-in via flag)                       |
| Quality gates da soddisfare                     | typecheck, lint, build, cargo check, cargo clippy, i18n parity, Playwright |

### 0.6 Decisioni richieste ad Andrea

Prima di iniziare qualsiasi sprint dell'audit, decidere:

1. **Sprint R (commercial readiness):** GO o NO-GO? Senza R, il prodotto resta "DHS-only" (nessuna vendita esterna automatizzabile).
2. **Sprint S (file management OneDrive-style):** GO o NO-GO? Senza S, l'esperienza upload resta a livello Slidecrew base (no drag folder, no centro slide multi-sala).
3. **Sprint T (perf + competitor parity):** GO o NO-GO? Senza T, mancano differenziatori vs PreSeria su file validation e reminder.
4. **Live WORKS APP integration (G2):** Opzione A (Lemon Squeezy single source) o Opzione B (Live WORKS APP REST API)?
5. **Folder upload (G4):** Una folder droppata diventa **nuova sessione** dentro la sala, oppure file con prefix `<folder>_` nella sessione corrente?
6. **Centro Slide (G7):** Un PC `control_center` puo' caricare/sovrascrivere file (delegando G3 a tutti i PC) oppure solo download multi-sala?

### 0.7 Cosa NON fare (decisioni gia' prese, ribadite)

- ~~NON aggiungere streaming live da cloud~~: violerebbe regola sovrana #2 (file da locale).
- ~~NON splittare il codice React in 2 fork (cloud vs desktop)~~: viola §0.12. La SPA e' UNA.
- ~~NON usare Electron al posto di Tauri 2~~: viola §0.11.
- ~~NON aggirare RLS con `service_role` lato client~~: viola §0.9.
- ~~NON mostrare contenuto file ad Andrea super-admin~~: viola §0.10 (GDPR).

### 0.8 Hardening Supabase + Vercel (Sprint Q+1 — DONE 18/04/2026)

> **Eseguito prima degli sprint R/S/T** per assicurarsi che il backend produzione sia pronto a sostenere carico commerciale e audit di sicurezza.
> **Stato:** TUTTO COMMITTATO E TYPECHECK/LINT/BUILD VERDI. Resta solo **deploy** (azioni manuali Andrea, vedi §0.8.4).

#### 0.8.1 Cosa ho fatto (codice committato)

| Area               | File / artifact                                                   | Cosa cambia                                                                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase DB**    | `supabase/migrations/20260418040000_perf_hot_path_indexes.sql`    | 7 indici hot-path per query ricorrenti: dashboard regia, ultima versione READY, eventi futuri, heartbeat device online, codici pairing attivi, audit per entity, GDPR exports.                                    |
| **Supabase DB**    | `supabase/migrations/20260418050000_security_least_privilege.sql` | REVOKE INSERT/UPDATE/DELETE da `anon` su tutte le tabelle public; re-grant solo su `paired_devices` (pair flow) e `pairing_codes`. Defense-in-depth contro bug futuri nelle policy RLS.                           |
| **Supabase Auth**  | `apps/web/src/lib/supabase.ts`                                    | `flowType: 'pkce'` (best practice SPA 2026), `storageKey: 'sb-slidecenter-auth'` (no collisioni multi-tab), `x-application-name` header (audit Postgres logs), `realtime eventsPerSecond=10` (anti-flood client). |
| **Vercel headers** | `vercel.json`                                                     | HSTS 2 anni preload, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict, Permissions-Policy super-restrittiva, COOP/CORP same-origin, CSP completa (Supabase+Sentry+Vercel Analytics).  |
| **Vercel cache**   | `vercel.json`                                                     | Cache 1 anno immutable per `/assets/*` + font; cache 30 giorni per immagini; `cleanUrls`+`trailingSlash:false`; redirect SEO `/index` `/home` → `/`.                                                              |
| **PWA cache**      | `apps/web/vite.config.ts`                                         | NIENTE cache su `/auth/v1/*` e `/realtime/v1/*`; signed URL con TTL 60s (era 4 min, troppo vicino alla scadenza 5 min Supabase); REST GET cache 10 min con cacheableResponse statuses [0,200].                    |
| **CI/CD**          | `.github/workflows/db-types-drift.yml`                            | Nuovo workflow: rileva drift tra `supabase/migrations/**.sql` e `packages/shared/src/types/database.ts`. Blocca PR se i types non sono allineati alle migration.                                                  |
| **CI/CD**          | `.github/workflows/deploy-supabase.yml`                           | Nuovo workflow: deploy automatico migrations + Edge Functions su push `main` (functions auto, migrations dietro `workflow_dispatch` con flag esplicito per safety).                                               |
| **DX scripts**     | `package.json`                                                    | 7 nuovi script: `db:types` (remote), `db:types:local`, `db:diff`, `db:lint`, `db:push`, `fn:deploy`, `vercel:env:pull`, `vercel:deploy:prod`.                                                                     |
| **DX docs**        | `.env.example`                                                    | Riscritto con sezioni chiare: (1) bundle frontend Vite/Vercel, (2) Supabase CLI script, (3) Edge Function secrets (NON committare!), (4) Vercel env vars management.                                              |

#### 0.8.2 Quality gates verdi

```
pnpm typecheck    OK  (5/5 tasks, 6.7s)
pnpm lint         OK  (5/5 tasks, 7.9s)
pnpm --filter @slidecenter/web build    OK  (1.6s, 97 PWA precache entries)
```

#### 0.8.3 Stato sicurezza/perf POST-hardening

| Verifica                                                 | Stato                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| RLS attivo su 100% tabelle multi-tenant                  | YES (init + phase1_2_hardening + perf_consolidate_policies)      |
| FK indicizzate                                           | YES (perf_fk_indexes 23/23) + 7 hot-path indici aggiuntivi (Q+1) |
| Anon scrittura limitata al minimo                        | YES (security_least_privilege Q+1 — solo paired_devices/codes)   |
| HMAC SHA-256 su licensing-sync (server-to-server)        | YES (32-byte secret + replay protection 5min + payload cap 1MiB) |
| HSTS preload + CSP completa su SPA                       | YES (vercel.json Q+1)                                            |
| PWA NON cacha auth/realtime                              | YES (vite.config Q+1)                                            |
| PKCE flow Supabase Auth                                  | YES (supabase.ts Q+1)                                            |
| Drift DB types vs migrations bloccato in CI              | YES (db-types-drift.yml Q+1)                                     |
| Deploy Edge Functions automatizzato                      | YES (deploy-supabase.yml Q+1, opt-in per migrations)             |
| Sentry SDK con sourcemap upload                          | OK (skip se SENTRY_AUTH_TOKEN assente — comportamento corretto)  |
| Storage RLS su bucket `presentations` + `tenant-exports` | YES (gia' definite in phase3 + sprint7)                          |

#### 0.8.4 COSA RESTA AD ANDREA (azioni manuali, NON automatizzabili)

> **Tempo stimato totale: 30-45 minuti** (la prima volta).

**A. Supabase Dashboard (5 min)**

1. **Apply migrations Q+1** sul progetto produzione:
   - via UI: Supabase Dashboard → Database → Migrations → "Apply pending migrations" (riconosce automaticamente le 2 nuove `20260418040000_*` e `20260418050000_*`).
   - via CLI: `pnpm db:push` (richiede `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` in `.env`).
2. **Verifica advisor** post-migration: Dashboard → Database → Advisors → confermare 0 errori, ≤5 warning informativi.
3. **Settare Edge Function secrets** (Dashboard → Edge Functions → Manage secrets):
   - `SLIDECENTER_LICENSING_HMAC_SECRET` = stringa casuale ≥32 char (CONDIVIDI con Live WORKS APP Cloud Function).
   - `EMAIL_SEND_INTERNAL_SECRET` = stringa casuale ≥32 char (per cron `email-cron-licenses`).
   - `RESEND_API_KEY` = chiave da Resend.com.
   - `RESEND_FROM_ADDRESS` = `noreply@<tuo-dominio>`.
   - `PUBLIC_APP_URL` = URL produzione Vercel (es. `https://app.liveslidecenter.com`).

**B. Vercel Dashboard (10 min)**

1. **Env vars produzione** (Project → Settings → Environment Variables):
   - `VITE_SUPABASE_URL` = URL Supabase produzione (`https://<ref>.supabase.co`).
   - `VITE_SUPABASE_ANON_KEY` = anon key (Settings → API).
   - `VITE_APP_NAME` = `"Live SLIDE CENTER"`.
   - `VITE_APP_VERSION` = `0.0.1` (aggiorna a ogni release).
   - **(Opzionale)** `VITE_SENTRY_DSN`, `VITE_LIVE_WORKS_APP_URL`, `VITE_LEMONSQUEEZY_*` se attivati.
2. **Custom domain** (se non gia' fatto): Project → Domains → Add Domain.
3. **Redeploy** dopo aver salvato le env vars (UI: Deployments → ultimo → Redeploy).

**C. GitHub Repository Secrets (10 min)** — solo se vuoi attivare il deploy automatico Supabase

1. Repository Settings → Secrets and variables → Actions → New repository secret:
   - `SUPABASE_PROJECT_REF` = project ref alfanumerico.
   - `SUPABASE_ACCESS_TOKEN` = personal access token Supabase.
   - `SUPABASE_DB_PASSWORD` = password DB Supabase.
2. **Test workflow**: Actions → "Deploy Supabase" → Run workflow → `deploy_functions=true`, `deploy_migrations=false` (la prima volta).

**D. Verifiche post-deploy (10 min)**

1. Apri `https://<tuo-dominio>/status` → tutti i servizi devono essere `operational`.
2. Apri Chrome DevTools → Network → Headers su `/index.html` → verifica:
   - `Strict-Transport-Security` presente.
   - `Content-Security-Policy` presente.
   - `X-Frame-Options: DENY` presente.
3. Apri DevTools → Application → Storage → verifica chiave `sb-slidecenter-auth` dopo login (non `sb-<ref>-auth-token` default).
4. Apri Supabase Dashboard → Database → Query Performance → verifica query lente <100ms p95.

#### 0.8.5 Semaforo VERDE per partire con Sprint R/S/T

**Quando hai completato A+B (anche senza C/D):**

```
GREEN LIGHT → puoi avviare Sprint R-1 (super-admin crea licenze) in sicurezza.
```

---

### 0.9 Sprint R-1 — Super-admin crea tenant + licenze (DONE 18/04/2026)

> **Gap chiuso:** G1 — Super-admin (Andrea) puo' ora creare un nuovo tenant cliente + invitare il primo admin direttamente dal pannello `/admin/tenants`, senza passare da CLI o Supabase Dashboard.

#### 0.9.1 Cosa ho fatto (codice committato)

| Area               | File / artifact                                                       | Cosa cambia                                                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Migration**      | `supabase/migrations/20260418060000_admin_create_tenant.sql`          | RPC `admin_create_tenant_with_invite(...)` SECURITY DEFINER. Verifica `is_super_admin()` via JWT, validazioni stringenti (slug regex, plan enum, storage range, email RFC, license format `XXXX-XXXX-XXXX-XXXX`). INSERT atomico tenant + team_invitation + activity_log. Ritorna invite_url copiabile. |
| **Migration**      | `supabase/migrations/20260418060000_admin_create_tenant.sql` (stessa) | `team_invitations.invited_by_user_id` ora nullable (super_admin non ha riga in `public.users`). Nuovo campo `invited_by_role TEXT` per tracciare provenienza (admin tenant vs super_admin).                                                                                                             |
| **Types**          | `packages/shared/src/types/database.ts`                               | Aggiunto `admin_create_tenant_with_invite` in `Functions`. Aggiornato `team_invitations` Row/Insert/Update con `invited_by_user_id: string \| null` e `invited_by_role: string`.                                                                                                                        |
| **Repository**     | `apps/web/src/features/admin/repository.ts`                           | `createTenantWithInvite()` chiama la RPC. `suggestSlug()` deriva slug da nome (NFD-normalize, lowercase, dash). `CREATE_TENANT_ERROR_KEYS` mappa codici errore SQL a chiavi i18n.                                                                                                                       |
| **UI dialog**      | `apps/web/src/features/admin/components/CreateTenantDialog.tsx`       | Form completo (nome, slug auto-derivato override-able, plan dropdown, storage GB, max events/rooms/devices, expires_at + checkbox "senza scadenza", license_key opzionale, email primo admin). Validazione client + server-side. Schermata risultato con copy-to-clipboard dell'invite URL.             |
| **UI integration** | `apps/web/src/features/admin/AdminTenantsView.tsx`                    | Bottone "Crea nuovo tenant" in header lista tenant. Auto-refresh lista dopo creazione.                                                                                                                                                                                                                  |
| **i18n**           | `packages/shared/src/i18n/locales/{it,en}.json`                       | 36 chiavi nuove sotto `admin.createTenant.*` (form, errori, success). Aggiunto `common.copy` / `common.copied` riusabile.                                                                                                                                                                               |

#### 0.9.2 Quality gates verdi

```
pnpm typecheck    OK  (5/5 tasks, 7.7s)
pnpm --filter @slidecenter/web lint    OK  (0 errors)
pnpm --filter @slidecenter/web build   OK  (1.16s, AdminTenantsView 19.62 kB gzip 4.62 kB)
```

#### 0.9.3 Flusso utente end-to-end

1. Andrea fa login come super_admin → naviga `/admin/tenants` → click **"Crea nuovo tenant"** in header.
2. Compila form: nome azienda (es. "Studio Eventi XYZ"), lo slug viene auto-derivato (`studio-eventi-xyz`), seleziona plan **Pro**, modifica eventualmente storage/quote (default sensati per piano), imposta scadenza (default +1 anno), opzionalmente incolla `license_key` da Lemon Squeezy / Live WORKS APP, inserisce email primo admin.
3. Click **"Crea tenant + invio invito"** → la RPC esegue tutto in transazione atomica:
   - INSERT in `tenants` con tutte le quote.
   - INSERT in `team_invitations` con `role='admin'`, `invited_by_role='super_admin'`, token 32-byte hex, scadenza 14 giorni.
   - INSERT in `activity_log` (audit cross-tenant visibile in `/admin/audit`).
4. Dialog mostra schermata di successo: invite URL `https://app.../accept-invite/<token>` con bottone "Copia". Andrea lo invia via email/Telegram all'admin del cliente.
5. L'admin clicca il link, compila password/nome → `team-invite-accept` Edge Function lo crea in `auth.users` con `app_metadata.tenant_id` + `app_metadata.role='admin'`. Trigger `handle_new_user` lo collega al tenant esistente (NON crea nuovo tenant).

#### 0.9.4 Sicurezza & idempotenza

| Vincolo                                                 | Implementazione                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Solo super_admin puo' chiamare la RPC                   | `is_super_admin()` check FIRST nell'RPC; `REVOKE FROM anon`; `GRANT EXECUTE TO authenticated`.           |
| Slug univoco                                            | Check pre-INSERT + UNIQUE constraint DB-level (errore `slug_already_exists` chiaro).                     |
| License key univoca cross-tenant                        | Check pre-INSERT su `tenants.license_key` + UNIQUE INDEX gia' esistente (Sprint 4).                      |
| Email primo admin valida                                | Regex RFC-lite server-side + `type="email"` HTML5 client-side.                                           |
| Tenant scaduto auto-suspended                           | Trigger `tenant_apply_expiry()` esistente (Sprint 4) sospende se `expires_at < now`.                     |
| Audit trail completo                                    | `activity_log` con `actor='user'`, `actor_name='super_admin'`, `action='tenant.created_by_super_admin'`. |
| Invite token crittograficamente sicuro                  | `gen_random_bytes(32)` hex (256 bit entropy, brute-force impossibile).                                   |
| Form errors mappati a i18n (no Postgres internals leak) | 14 codici errore stabili → chiavi `admin.createTenant.errors.*` IT/EN.                                   |

#### 0.9.5 Cosa NON e' incluso (delegato a sprint successivi)

- ~~Email automatica all'admin invitato~~ → **Sprint R-1.b (deferred):** richiede nuovo template Resend `kind='admin_invite'` su Edge Function `email-send`. Per ora super-admin copia/incolla URL manualmente. Il sistema attuale invia gia' la welcome email ALL'ACCETTAZIONE dell'invito (`team-invite-accept` chiama `email-send` con `kind='welcome'`).
- ~~Sync con Live WORKS APP per registrare la licenza la'~~ → **Sprint R-2 (next):** quando R-2 sara' pronto, l'RPC chiamera' Live WORKS APP API per creare la licenza Lemon Squeezy in parallelo.
- ~~Modifica/cancellazione tenant da super-admin~~ → gia' presenti (form quote in AdminTenantDetailView + sospensione). Cancellazione hard-delete intenzionalmente NON esposta in UI (si puo' fare solo via SQL per safety GDPR).

#### 0.9.6 Manuale Andrea per testare R-1

```
1. pnpm db:push                       # applica le 3 migration Q+1 + R-1 sul progetto produzione
2. cd apps/web && pnpm dev            # avvia SPA su localhost:5173
3. Login come super_admin              # account live.software11@gmail.com
4. Vai su /admin/tenants               # vedi lista tenant esistenti
5. Click "Crea nuovo tenant"           # apre il dialog
6. Compila: name="Test Cliente", plan=Pro, license_key vuoto, email=tua@email
7. Click "Crea tenant + invio invito"  # vedi schermata successo + URL invito
8. Apri URL invito in finestra incognito → accetta con password
9. Login con quella password → sei admin del tenant "Test Cliente"
10. Vai su /admin/tenants come super_admin → vedi il nuovo tenant nella lista
11. (Opzionale) Click "Sospendi organizzazione" → l'admin appena creato non riesce piu' a loggarsi
```

#### 0.9.7 Semaforo VERDE per Sprint R-2

```
GREEN LIGHT → R-1 e' DONE. Posso avviare Sprint R-2 (Live WORKS APP integration) appena dai conferma.
```

R-2 obiettivo: bidirezionalita' Lemon Squeezy webhook condiviso (Slide Center riceve webhook → crea tenant via R-1, Live WORKS APP riceve stesso webhook → registra licenza). Stima 2 giorni dev + 1 test.

Il backend e' pronto per:

- **Multi-tenant commerciale** (RLS hardenata + license sync HMAC).
- **Vendita esterna** (CSP + HSTS + PKCE = audit OWASP-ready).
- **Performance produzione** (indici hot-path + cache PWA chirurgica).
- **Deploy continuo** (CI types drift + auto-deploy functions).

---

## 1. Stato attuale (tutto DONE)

| Macro-area                                     | Stato | Riferimento architettura |
| ---------------------------------------------- | ----- | ------------------------ |
| Cloud SaaS (apps/web)                          | DONE  | ARCHITETTURA §13         |
| Desktop offline (apps/desktop Tauri 2)         | DONE  | ARCHITETTURA §14         |
| Local + Room Agent storici                     | DONE  | ARCHITETTURA §15         |
| Multi-tenancy + RLS + RBAC + GDPR              | DONE  | ARCHITETTURA §6          |
| Pairing PC sala (cloud + LAN)                  | DONE  | ARCHITETTURA §9          |
| Sistema licenze Live WORKS APP                 | DONE  | ARCHITETTURA §12         |
| i18n IT/EN parity (~1135 chiavi)               | DONE  | ARCHITETTURA §18         |
| Quality gates + CI (web + agent + Playwright)  | DONE  | ARCHITETTURA §19         |
| Email transazionali Resend (4 template)        | DONE  | ARCHITETTURA §17         |
| GDPR export ZIP + status page pubblica         | DONE  | ARCHITETTURA §17         |
| Audit log tenant + welcome email               | DONE  | ARCHITETTURA §17         |
| Code-signing CI ready (env-driven)             | DONE  | ARCHITETTURA §19         |
| Smoke test desktop + healthcheck               | DONE  | ARCHITETTURA §14.4       |
| Enforcement regola sovrana #2 (file da locale) | DONE  | ARCHITETTURA §11         |

**Conseguenza pratica:** non c'e' nulla di bloccante per usare il prodotto in produzione DHS. Tutto cio' che segue e:

- **Azione esterna NON automatizzabile** (acquisti, contratti, video, listing) → §2.
- **Opzionale ma ready-to-code** (Sprint Q hybrid) → §4.
- **Audit-driven 18/04/2026** (Sprint R/S/T per vendita esterna + competitivita) → §0.

**Roadmap ad alto livello (post-audit):**

| Sprint | Focus                                        | Tempo | Quando partire                                       |
| ------ | -------------------------------------------- | ----- | ---------------------------------------------------- |
| R      | Multi-tenant commercial readiness (G1+G2+G3) | 5g    | Quando Andrea decide "vendo a clienti esterni"       |
| S      | OneDrive-style file management (G4+G5+G6+G7) | 5g    | Quando evento DHS reale > 3 sale o richiesta cliente |
| T      | Performance + competitor parity (G8+G9+G10)  | 4g    | Quando Andrea vuole match feature PreSeria/Slidecrew |
| Q      | Sync hybrid cloud↔desktop                    | 5g    | Quando cliente chiede backup cloud automatico        |

---

## 2. Cose da fare ORA (azioni esterne Andrea, NON automatizzabili)

### 2.1 Email transazionali (Sprint 7) — sblocca welcome + license expiring + storage warning

**Stato:** infrastruttura DONE, manca solo configurazione esterna.

| #   | Azione                                                                                                                                                                                    | Tempo  | Costo                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------- |
| 1   | Registra account Resend su <https://resend.com> con `live.software11@gmail.com`                                                                                                           | 5 min  | €0 (free 3.000 email/mese) |
| 2   | Aggiungi dominio `liveworksapp.com` → segui istruzioni DNS (TXT + CNAME)                                                                                                                  | 30 min | €0 (uso Aruba esistente)   |
| 3   | Genera API key Resend → annota in password manager                                                                                                                                        | 2 min  | €0                         |
| 4   | Genera `EMAIL_SEND_INTERNAL_SECRET` (>=32 char): `[Convert]::ToBase64String((New-Object byte[] 32 \| % { (New-Object Random).NextBytes($_); $_ }))` da PowerShell                         | 1 min  | €0                         |
| 5   | Imposta 4 secrets su Supabase Edge Functions: `RESEND_API_KEY`, `RESEND_FROM_EMAIL=info@liveworksapp.com`, `EMAIL_SEND_INTERNAL_SECRET`, `PUBLIC_APP_URL=https://app.liveslidecenter.com` | 5 min  | €0                         |
| 6   | Deploy Edge Functions: `supabase functions deploy email-send email-cron-licenses gdpr-export`                                                                                             | 5 min  | €0                         |
| 7   | Schedule cron giornaliero su GitHub Actions (consigliato) — vedi `docs/Manuali/Manuale_Email_Resend.md` § "Schedulazione"                                                                 | 10 min | €0                         |
| 8   | Test: invita un membro team → ricevi welcome email entro 5s                                                                                                                               | 1 min  | €0                         |

Totale: ~1 ora. **Costo:** €0 (Resend free tier basta per primi 6 mesi).

> Riferimento dettagliato: `docs/Manuali/Manuale_Email_Resend.md` (10 sezioni con screenshot e troubleshooting).

### 2.2 Code-signing certificato OV Sectigo — elimina SmartScreen warning

**Stato:** integrazione build DONE (env-driven), manca solo certificato fisico.

| #   | Azione                                                                                               | Tempo                                   | Costo                |
| --- | ---------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------- |
| 1   | Acquista cert OV Sectigo via reseller (consigliato: ssl.com o ksoftware.net)                         | 30 min ordine + 1-2 settimane emissione | ~€190/anno           |
| 2   | Genera CSR via OpenSSL (vedi `docs/Manuali/Manuale_Code_Signing.md` § 2)                             | 10 min                                  | €0                   |
| 3   | Validazione OV: documenti azienda DHS (visura camerale, ecc.)                                        | 3-5 giorni                              | €0 (vendor verifica) |
| 4   | Ricezione `.pfx` + password via email                                                                | -                                       | -                    |
| 5   | Installa `signtool` (Windows SDK) + add to PATH                                                      | 15 min                                  | €0                   |
| 6   | Setta env permanenti: `CERT_PFX_PATH`, `CERT_PASSWORD`, `TIMESTAMP_URL=http://timestamp.sectigo.com` | 5 min                                   | €0                   |
| 7   | Test build: `release-licensed.bat` → output firmato + `SHA256SUMS.txt` corrispondente                | 10 min                                  | €0                   |

Totale: ~1 giornata setup + 1-2 settimane emissione cert. **Costo:** €190/anno.

> Riferimento: `docs/Manuali/Manuale_Code_Signing.md` (10 sezioni: acquisto, CSR, signtool, env, test, troubleshooting, rinnovo).

### 2.3 Screencast onboarding (3 video, ~5 min ciascuno)

**Stato:** scaletta parola-per-parola pronta, manca registrazione.

| #   | Video                                                                        | Durata target | Tools                      |
| --- | ---------------------------------------------------------------------------- | ------------- | -------------------------- |
| 1   | Onboarding admin web (signup → primo evento → invita relatori → vista regia) | 5-6 min       | OBS Studio + microfono USB |
| 2   | Setup regia con Local Agent (download installer → primo boot → pair PC sala) | 4-5 min       | Idem                       |
| 3   | Setup PC sala con Room Agent (installer → discovery LAN → ricezione file)    | 3-4 min       | Idem                       |

Totale: 1 giornata di registrazione + 1 giornata di editing leggero. **Costo:** €0 (OBS gratuito).

> Riferimento: `docs/Manuali/Script_Screencast.md` (scaletta completa parola-per-parola + setup tecnico OBS + audio target -16 LUFS + checklist post).

### 2.4 Revisione legale SLA + DPA art. 28

**Stato:** bozza tecnica SLA DONE, manca revisione legale.

| #   | Azione                                                                                                 | Tempo         | Costo (preventivo)    |
| --- | ------------------------------------------------------------------------------------------------------ | ------------- | --------------------- |
| 1   | Trova avvocato GDPR/contratti SaaS B2B (consigliato: tramite ordine Roma o Camera Civile)              | 1 settimana   | -                     |
| 2   | Brief: invia `docs/Commerciale/Contratto_SLA.md` v1.0 + `docs/Commerciale/README.md` con schema DPA    | 30 min        | -                     |
| 3   | Revisione SLA + redazione DPA Allegato A (10 punti raccomandati nel README)                            | 1-2 settimane | €300-800 forfait      |
| 4   | Iterazione modifiche con avvocato                                                                      | -             | (incluso nel forfait) |
| 5   | Pubblica versione finale in `docs/Commerciale/Contratto_SLA.md` + `docs/Commerciale/DPA_Allegato_A.md` | 30 min        | €0                    |

Totale: 2-3 settimane elapsed. **Costo:** €300-800.

### 2.5 Listing prodotti su sito marketing `liveworksapp.com`

| #   | Azione                                                                                                                | Tempo  | Costo               |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------ | ------------------- |
| 1   | Pagina prodotto Slide Center con: descrizione + 3 piani (Starter/Pro/Enterprise) + screenshot UI + 3 screencast embed | 4 ore  | €0 (riuso template) |
| 2   | Pagina prodotto Local Agent + Room Agent con: cosa fa + bundle Suite + checkout Lemon Squeezy                         | 2 ore  | €0                  |
| 3   | CTA "Prova Trial gratis" → link a `https://app.liveslidecenter.com/signup`                                            | 15 min | €0                  |
| 4   | Footer: link a `/status` + email supporto + link a Contratto_SLA.md + DPA_Allegato_A.md                               | 30 min | €0                  |

Totale: 1 giornata. **Costo:** €0 (lavoro su sito esistente Aruba).

### 2.6 Approvazione listino prezzi

| #   | Azione                                                                                                 | Tempo  | Costo |
| --- | ------------------------------------------------------------------------------------------------------ | ------ | ----- |
| 1   | Leggi `docs/Commerciale/Listino_Prezzi.md` v1.0 (4 piani + bundle + sconti)                            | 30 min | €0    |
| 2   | Decidi prezzi DEFINITIVI (eventuali modifiche al file) e firma sotto "Approvato Andrea Rizzari + data" | 15 min | €0    |
| 3   | Configura prodotti su Lemon Squeezy con prezzi approvati (oppure delega a Live WORKS APP)              | 1 ora  | €0    |

Totale: 2 ore. **Costo:** €0.

---

## 3. Field test desktop (quando vorrai farlo)

> **Stato:** opzionale per uso interno DHS, **bloccante** per vendita esterna della versione desktop.

### 3.1 Quando ha senso fare il field test

- Hai un evento DHS reale tra 2+ settimane → test su quell'evento
- Vuoi vendere `slide-center-agent` + `slide-center-room-agent` a clienti esterni
- Vuoi decidere GO/NO-GO Sprint Q (vedi §4)

### 3.2 Pre-requisiti hardware

| Macchina   | Ruolo                 | Specifiche minime                                                       |
| ---------- | --------------------- | ----------------------------------------------------------------------- |
| PC-ADMIN   | admin (regia)         | Win 10 64-bit, 8 GB RAM, SSD 100 GB liberi, Ethernet 1 Gbps             |
| PC-SALA-1  | sala A (proiezione)   | Win 10/11, 4 GB RAM, GPU integrata, HDMI/DP collegato a videoproiettore |
| PC-SALA-2  | sala B (proiezione)   | Win 11 enterprise (con AppLocker o policy aziendali se possibile)       |
| PC-SALA-3  | sala C (proiezione)   | Win 10 anziano (4 anni+), 4 GB RAM, HDD meccanico se possibile          |
| Switch     | rete LAN              | Switch 1 Gbps managed o unmanaged. NO Wi-Fi only.                       |
| Cavi RJ45  | x4                    | Cat5e o superiore                                                       |
| Dataset    | 200 file              | Mix PPTX/PDF/MP4 4K, totale 8-10 GB                                     |
| Proiettore | x1 collegato a SALA-1 | Per validare riproduzione video 4K reale                                |

### 3.3 Procedura sintetica (T-2, T-1, T, T+1)

**T-2 giorni (preparazione):**

```powershell
gh auth status                                  # deve mostrare live-software11
git pull origin main                            # main aggiornato
pnpm --filter @slidecenter/desktop prereqs      # toolchain OK
pnpm --filter @slidecenter/desktop release:nsis # build NSIS

# Crea zip distribuibile
$ver = (Get-Content apps\desktop\src-tauri\tauri.conf.json | ConvertFrom-Json).version
$out = "release\SlideCenterDesktop_v${ver}_fieldtest.zip"
Compress-Archive -Force -Path `
    "apps\desktop\src-tauri\target\release\bundle\nsis\Live SLIDE CENTER Desktop_${ver}_x64-setup.exe", `
    "apps\desktop\scripts\smoke-test.mjs", `
    "apps\desktop\scripts\smoke-test.ps1" `
    -DestinationPath $out
```

Copia su chiavetta USB → installa su 4 PC field test.

**T-1 giorno (smoke test):**

Su OGNI PC (admin + 3 sale):

```powershell
# Apri l'app manualmente, scegli "Sala" o "Admin" al primo boot
cd "C:\path\al\zip\estratto"
.\smoke-test.ps1 -SkipInstaller   # sale
# oppure
.\smoke-test.ps1                   # admin
```

Atteso: `>>> SEMAFORO VERDE: PC pronto per il field test.` JSON salvato in `Documents\SlideCenterFieldTest\`.

Se anche **uno solo** dei 4 PC fallisce con critici falliti → **posporre field test**, fixare, ripetere.

**Giorno T (test ~5 ore: 1h setup + 4h test):**

| Fase | Cosa                                                                                                             | Durata |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| A    | Setup iniziale (apri 4 PC, crea evento "Field Test", 3 sale + 5 sessioni/sala, pair 3 PC sala via discovery LAN) | 60 min |
| B    | Sync file LAN parallelo (drag&drop 50 file × 50MB su 3 sessioni in parallelo, misura MB/s — target > 50 MB/s)    | 60 min |
| C    | Stress playback 4K + download in modalita LIVE (verifica FPS ≥ 50 in DevTools Performance)                       | 45 min |
| D    | Resilienza rete (stacca cavo PC-SALA-2 → pallino rosso entro 30s; stacca cavo PC-ADMIN → sale in STANDALONE)     | 30 min |
| E    | Riavvii e persistenza (5 riavvii consecutivi PC-SALA-1 → auto-rejoin sempre OK via `device.json`)                | 45 min |
| F    | UI parity cloud vs desktop (apri cloud Vercel + desktop side-by-side → identici visivamente?)                    | 30 min |
| G    | (Opzionale) VPN site-to-site (PC-ADMIN sede A + PC-SALA-1 sede B via VPN)                                        | 60 min |

**Giorno T+1 (decisione GO/NO-GO):**

Compila il **template feedback** (vedi §3.5) e decidi:

- **GO produzione** se: 4 criteri OK (no crash, no perdita stato, no stuttering 4K, mediana sync < 3s)
- **NO-GO produzione** se: 1+ fallisce → apri sprint hardening dedicato

### 3.4 Troubleshooting rapido

| Problema                                     | Causa probabile                                 | Fix                                                                     |
| -------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Smoke FAIL su `firewall` (porta 7300/7301)   | Backend Rust crashed al boot                    | `Get-Process                                                            | Where { $\_.Name -like "_slide_" }` → kill all → riapri 1 sola istanza |
| Smoke FAIL su `mdns` (no IP LAN)             | Cavo staccato o VPN attiva                      | `ipconfig                                                               | findstr IPv4` → almeno 1 NON 127.x                                     |
| PC sala non si pareggia (timeout discovery)  | Switch managed blocca multicast / IGMP snooping | Abilita IGMP querier o passa a switch unmanaged; fallback IP manuale    |
| Video 4K stuttering durante download in LIVE | Sprint A throttle non attivo                    | Verifica chip "LIVE" verde attivo; se no fix → bug critico bloccante    |
| Riavvio PC sala chiede pairing di nuovo      | `~/SlideCenter/device.json` non scritto         | `Get-Content "$env:USERPROFILE\SlideCenter\device.json"` → bug Sprint M |

### 3.5 Template feedback (compilazione obbligatoria)

Crea `docs/feedback/<YYYY-MM-DD>_field_test_desktop/REPORT.md` con queste sezioni (compila DURANTE il test, non dopo):

```markdown
# Field Test Desktop — Report

## 1. Metadata

- Data field test:
- Versione app testata (`/info` → `version`):
- Commit SHA: (`git rev-parse --short HEAD`)
- Tester:
- Sede:
- Tipo rete: (LAN unmanaged 1Gbit / managed / VPN site-to-site)
- Durata totale (h reali):
- File test totali (n + GB):

## 2. Inventario PC

| Hostname  | Ruolo  | OS  | RAM | Disco libero | Note (antivirus, dominio, AppLocker) |
| --------- | ------ | --- | --- | ------------ | ------------------------------------ |
| PC-ADMIN  | admin  |     |     |              |                                      |
| PC-SALA-1 | sala A |     |     |              |                                      |
| ...       | ...    |     |     |              |                                      |

## 3. Smoke test esiti (allega JSON `Documents\SlideCenterFieldTest\` di ogni PC)

| PC       | Exit code | Critici falliti | Warning | File JSON |
| -------- | --------- | --------------- | ------- | --------- |
| PC-ADMIN |           |                 |         |           |
| ...      |           |                 |         |           |

## 4. Esiti checklist (10 punti)

| #   | Punto                                                             | Esito | Misura concreta              |
| --- | ----------------------------------------------------------------- | ----- | ---------------------------- |
| 1   | Sprint J-P completati                                             |       | (SI/NO)                      |
| 2   | Installer NSIS testato su 3 Win diversi                           |       | (Win10/11/11-ent: tutti OK)  |
| 3   | mDNS discovery su switch unmanaged + managed                      |       | (unmanaged OK / managed OK)  |
| 4   | Pairing LAN < 2 secondi                                           |       | (media ms su 5 pair)         |
| 5   | Sync file LAN admin → 5 PC sala in parallelo a velocita LAN piena |       | (MB/s misurato; target > 50) |
| 6   | Riavvio PC sala → auto-rejoin senza interazione                   |       | (5 riavvii: tutti OK)        |
| 7   | Spegnere admin → PC sala in STANDALONE                            |       | (SI/NO + sec di degrado)     |
| 8   | Riaccendere admin → PC sala riconnette automaticamente            |       | (secondi auto-rejoin)        |
| 9   | UI identica cloud vs desktop side-by-side                         |       | (diff visibile? SI/NO)       |
| 10  | VPN site-to-site (opzionale)                                      |       | (ms pair / MB/s)             |

## 5. Stress playback 4K

| Misura                                                | Valore | Esito               |
| ----------------------------------------------------- | ------ | ------------------- |
| FPS medio durante video 4K + 5×500MB download in LIVE |        | (≥50 OK / <50 FAIL) |
| Frame drop visibili a occhio?                         |        | (SI/NO)             |
| Audio sincronizzato?                                  |        | (SI/NO)             |

## 6. Bug rilevati

### Bug #1

- Severita: CRIT / MAJOR / MINOR
- Componente: (backend Rust / room player UI / mDNS / installer)
- Riproducibile: SI/NO + frequenza
- Step: 1. ... 2. ...
- Atteso vs Osservato:
- Log/screenshot allegati: (path)
- Bloccante per produzione? SI/NO

## 7. Decisione GO/NO-GO produzione

- [ ] Tutti i 10 punti checklist OK o OK con note (mai FAIL)
- [ ] 0 crash app durante 4 ore
- [ ] 0 perdita stato post-riavvio
- [ ] FPS medio playback 4K + download in LIVE ≥ 50
- [ ] Mediana "upload → visibile su sala" LAN < 3s
- [ ] Nessun bug CRIT in §6

> ☐ GO PRODUZIONE — versione desktop offline utilizzabile su prossimi eventi reali
> ☐ NO-GO PRODUZIONE — apri sprint hardening dedicato. Bug bloccanti: \***\*\_\_\*\***
> Firma: \***\*\_\_\_\*\*** Data: \***\*\_\_\_\*\***

## 8. Decisione GO/NO-GO Sprint Q

Vedi §4 di questo documento.
```

### 3.6 Procedura rollback "tutto crasha" durante field test

Se l'app diventa inutilizzabile durante il test simulato:

1. **Su PC sala interessato**: chiudi Live SLIDE CENTER Desktop dal task manager
2. **Apri il browser** e vai su `https://app.liveslidecenter.com` (versione cloud)
3. **Esegui pairing tradizionale** (codice 6 cifre / QR) come da workflow Fase 6
4. **Continua l'evento sulla versione cloud** — UI identica (Sprint O), zero retraining

Recupero dati post-crash:

1. Su tutti i PC sala: zip `~/SlideCenter/` (contiene SQLite + device.json + storage locale dei file)
2. Salva log Tauri: `%APPDATA%\com.livesoftware.slidecenter.desktop\logs\` (se esistono)
3. Salva report smoke-test JSON
4. Apri immediatamente issue su GitHub `live-software11/Live-SLIDE-CENTER` con label `bug-field-test` + allega tutto
5. Sospendi field test, riprendi dopo fix verificato

---

## 4. Sprint Q — Sync hybrid cloud↔desktop (opzionale, ready-to-code)

### 4.1 Cosa fa

Push-only worker desktop → cloud (presentation_versions + room_state + paired_devices) per:

- Backup automatico dei file su cloud durante un evento offline
- Dashboard cloud che vede TUTTI gli eventi (anche quelli desktop)
- Multi-sede senza VPN (admin in sede A vede stato sala in sede B via cloud)

**Sempre push-only**: il desktop e' SEMPRE master, il cloud non puo' rispondere a una `getFile()` (regola sovrana §0.2 in §11 architettura).

### 4.2 Quando deciderlo (framework GO/NO-GO post field test)

Compila durante/dopo il field test:

| #   | Domanda                                                                             | SI/NO |
| --- | ----------------------------------------------------------------------------------- | ----- |
| 1   | Ho avuto bisogno, durante il field test, di vedere file da un PC NON sulla LAN?     |       |
| 2   | Ho avuto bisogno di backup automatico dei file su cloud?                            |       |
| 3   | Ho clienti che useranno la versione desktop in piu' sedi distribuite (no VPN)?      |       |
| 4   | Voglio un'unica dashboard cloud che vede TUTTI gli eventi (anche quelli offline)?   |       |
| 5   | Sono disposto a investire 5-7 giorni di sviluppo + tenant linking + auth cross-sys? |       |

**Regola:**

- Almeno **2 SI** → **GO Sprint Q** (apri sprint con priorita media)
- 0-1 SI → **NO-GO Sprint Q** (uso interno aziendale + LAN sono sufficienti, non spendere tempo)

Esempi:

- "Field test su 4 PC stessa LAN, evento single-site, no clienti esterni interessati" → 0-1 SI → **NO-GO**
- "Field test su VPN multi-sede + cliente interessato a backup automatico" → 3+ SI → **GO**

### 4.3 Plan ready-to-code (5-7 giorni)

#### Giorno 1: schema + policy

Migration `supabase/migrations/<YYYYMMDD>_sprint_q_hybrid_sync.sql`:

```sql
-- Tabella per tracciare last sync per (tenant, device, table)
CREATE TABLE hybrid_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  table_name TEXT NOT NULL,
  last_pushed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_pushed_pk UUID,
  total_pushed BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT uq_hybrid_sync_device_table UNIQUE (tenant_id, device_id, table_name)
);

ALTER TABLE hybrid_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hybrid_sync_state FOR ALL USING (tenant_id = public.app_tenant_id());

-- RPC SECURITY DEFINER per push batch
CREATE OR REPLACE FUNCTION public.hybrid_sync_push(
  p_tenant_id UUID,
  p_device_id UUID,
  p_table TEXT,
  p_rows JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted INT := 0; v_skipped INT := 0;
BEGIN
  -- valida tenant + device
  -- per ogni riga in p_rows: UPSERT con ON CONFLICT DO NOTHING (idempotente)
  -- aggiorna hybrid_sync_state
  -- ritorna {inserted, skipped, last_pushed_at}
END; $$;

GRANT EXECUTE ON FUNCTION hybrid_sync_push TO service_role;
```

Schema SQLite locale (`apps/desktop/src-tauri/migrations/`):

```sql
CREATE TABLE IF NOT EXISTS hybrid_sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  payload TEXT NOT NULL,         -- JSON serialized
  created_at INTEGER NOT NULL,    -- unix timestamp
  pushed_at INTEGER,              -- nullable, set quando confermato cloud
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON hybrid_sync_outbox(pushed_at) WHERE pushed_at IS NULL;
```

Trigger SQLite su INSERT/UPDATE in `presentation_versions`, `room_state`, `paired_devices` → INSERT in `hybrid_sync_outbox`.

#### Giorno 2-3: worker Rust

`apps/desktop/src-tauri/src/hybrid_sync.rs`:

```rust
pub struct HybridSyncWorker {
    state: Arc<AppState>,
    cloud_url: String,
    cloud_service_key: String,  // service_role token per RPC hybrid_sync_push
    interval_secs: u64,         // default 60
}

impl HybridSyncWorker {
    pub async fn run_loop(self) {
        loop {
            tokio::time::sleep(Duration::from_secs(self.interval_secs)).await;
            if let Err(e) = self.push_pending().await {
                eprintln!("[hybrid_sync] error: {e:?}");
            }
        }
    }

    async fn push_pending(&self) -> Result<()> {
        // 1. SELECT batch da hybrid_sync_outbox WHERE pushed_at IS NULL LIMIT 100
        // 2. Group by table_name
        // 3. Per ogni gruppo: POST a Supabase RPC hybrid_sync_push con HMAC + service_role
        // 4. Su success: UPDATE hybrid_sync_outbox SET pushed_at = strftime('%s','now')
        // 5. Su failure: UPDATE attempts++, last_error
        // 6. Backoff esponenziale dopo 3 fallimenti
        Ok(())
    }
}
```

Spawn nel `main.rs` SOLO se `device.json` ha `hybrid_sync.enabled = true` (opt-in).

#### Giorno 4: UI toggle + status

`apps/web/src/features/settings/SettingsView.tsx` aggiungi sezione "Sync hybrid cloud" (visibile solo in modalita desktop):

```tsx
<HybridSyncSection
  enabled={hybridSyncEnabled}
  lastSyncAt={hybridSyncLastSyncAt}
  pendingRows={hybridSyncPendingRows}
  onToggle={async (next) => {
    await invoke('cmd_set_hybrid_sync_enabled', { enabled: next });
    refresh();
  }}
/>
```

Comandi Tauri da esporre: `cmd_get_hybrid_sync_status`, `cmd_set_hybrid_sync_enabled`, `cmd_force_hybrid_sync_now`.

#### Giorno 5: tenant linking + auth cross-system

Configurazione: il desktop deve sapere CHE TENANT cloud usare. Soluzioni:

- **Opzione A (semplice)**: settings UI "Connetti a cloud" → utente fa login Supabase → ottiene JWT con tenant_id → desktop salva tenant_id + service_role token in `device.json` cifrato. Sicuro perche' service_role non lascia mai il PC desktop.
- **Opzione B (sicura)**: dashboard cloud admin "Genera token desktop" → pair-code 6 cifre come per le sale → desktop fa pair → riceve JWT scoped a `tenant_id + table_name IN (presentation_versions, room_state, paired_devices)` con scadenza 365gg.

Consigliato: **Opzione B** (no service_role su disco).

#### Giorno 6-7: test + docs

- Test E2E: simula crash di rete durante push, riprende dopo
- Test idempotenza: ripeti push stesso payload, verifica `inserted=0, skipped=N`
- Test conflitti: desktop e cloud entrambi modificano `room_state` → desktop vince (push-only)
- Aggiorna `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22.3 con "Sprint Q DONE"
- Aggiorna `docs/STATO_E_TODO.md` § 4 con "DONE"

### 4.4 Costi stimati Sprint Q

| Voce                                   | Costo                              |
| -------------------------------------- | ---------------------------------- |
| Sviluppo (5-7 giorni Andrea + AI)      | €0 diretto (tempo opportunita)     |
| Storage cloud aggiuntivo (backup)      | ~€0.021/GB/mese su Supabase Pro    |
| Bandwidth push (60s × 200 file × 50MB) | ~€2/mese per evento attivo         |
| Maintenance ongoing                    | ~1 ora/mese (monitoring + bug fix) |

Totale: **negligibile in costi diretti** se hai gia Supabase Pro per il cloud SaaS.

### 4.5 File impattati Sprint Q

```
NEW:
  supabase/migrations/<YYYYMMDD>_sprint_q_hybrid_sync.sql
  apps/desktop/src-tauri/migrations/<YYYYMMDD>_hybrid_sync_outbox.sql
  apps/desktop/src-tauri/src/hybrid_sync.rs
  apps/web/src/features/settings/components/HybridSyncSection.tsx
  apps/web/src/features/settings/hooks/useHybridSyncStatus.ts

MODIFY:
  apps/desktop/src-tauri/src/main.rs                    (spawn worker se opt-in)
  apps/desktop/src-tauri/src/lib.rs                     (pub mod hybrid_sync)
  apps/desktop/src-tauri/Cargo.toml                     (no nuove deps, riusa reqwest+tokio+rusqlite)
  apps/web/src/features/settings/SettingsView.tsx       (aggiungi sezione)
  packages/shared/src/i18n/locales/{it,en}.json         (~15 chiavi nuove `hybridSync.*`)
  packages/shared/src/types/database.ts                 (RPC + tabella nuova)
  docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md                 (§ 22.3 mark DONE)
  docs/STATO_E_TODO.md                                  (§ 4 mark DONE)
```

---

## 5. Backlog post-vendita (sales + legale + marketing)

> Per le azioni esterne dettagliate vedi `docs/Commerciale/Roadmap_Vendita_Esterna.md` (10 sezioni, 47 voci, budget complessivo €3.700-€7.000 one-time + €1.090-€3.930/anno).

### 5.1 Macro-aree pending

| Area             | Cosa fare                                                | Tempo          | Costo                  |
| ---------------- | -------------------------------------------------------- | -------------- | ---------------------- |
| Legale           | DPA art. 28, T&C, DPIA, nomina DPO esterno               | 4-6 settimane  | €1.500-€3.500          |
| Fiscale          | P.IVA verifica VIES, Lemon Squeezy fatturazione          | 1 settimana    | €0 (esistente)         |
| Marketing        | Sito + materiale + 3 video + SEO + social                | 8-12 settimane | €2.000-€4.000 one-time |
| Pricing          | Approvare listino, configurare Lemon Squeezy             | 1 settimana    | €0                     |
| Operations       | Help desk + docs + status page brandizzata + UptimeRobot | 4 settimane    | €600-€1.500/anno       |
| Pipeline clienti | Prospect 5 + demo + early-adopter program                | 3-6 mesi       | €0 diretto             |

**5 decisioni urgenti pre-primo-cliente** (vedi `Roadmap_Vendita_Esterna.md` § "Decisioni urgenti"):

1. Pricing definitivo (mensile vs annuale, sconti)
2. Modalita di vendita (self-service vs assistita)
3. Target verticale (medicale / corporate / fiere / generalista)
4. Geografia (solo Italia / EU / mondo)
5. Margine target (per dimensionare costo acquisizione cliente)

---

## 6. Backlog post-MVP (idee future, NON urgenti)

### 6.1 Idee dal piano commerciale

| Idea                                          | Effort                 | Quando guardarla                             |
| --------------------------------------------- | ---------------------- | -------------------------------------------- |
| API pubblica REST per integratori esterni     | 2-3 settimane          | Quando 5+ clienti la chiedono                |
| Mobile app companion (React Native o Flutter) | 4-6 settimane          | Quando 10+ clienti la chiedono               |
| Multi-lingua oltre IT/EN (FR, DE, ES, NL)     | 1 settimana per lingua | Quando primo cliente non IT/EN               |
| White-label (logo + colori cliente)           | 1-2 settimane          | Quando primo cliente Enterprise lo chiede    |
| Integrazione calendar (Google/Outlook)        | 1 settimana            | Quando 3+ clienti la chiedono                |
| OBS plugin per regia AV avanzata              | 3-4 settimane          | Quando si entra nel mercato AV professionale |

### 6.2 Hardening tecnico opzionale

| Idea                                                         | Effort     | Beneficio                               |
| ------------------------------------------------------------ | ---------- | --------------------------------------- |
| Migrazione Storage da Supabase a Cloudflare R2 (zero egress) | 1 giornata | Quando egress > $50/mese                |
| Database read replicas (Supabase Pro+ feature)               | 2 ore      | Quando >100 tenant o 1M+ righe/giorno   |
| pgBouncer proxy per connection pooling avanzato              | 1 giornata | Quando >50 concurrent users             |
| Sentry source maps server (replace Vercel built-in)          | 4 ore      | Quando vuoi traceback piu' dettagliati  |
| OpenTelemetry tracing distribuito                            | 2-3 giorni | Quando debug cross-system diventa lungo |

### 6.3 Cose che PROBABILMENTE non faremo mai

- Migrazione a Next.js (SSR non serve per SaaS dashboard)
- Migrazione a Electron (Tauri 2 e' migliore in tutto)
- Self-hosting Supabase (perdi gestita, complessita esplode)
- Versione Linux/macOS desktop (target di vendita 95% Windows aziendale)

---

## 7. Comandi rapidi (cheat-sheet quotidiano)

### 7.1 Account check (PRIMA di qualsiasi push remoto)

```powershell
gh auth status                      # deve mostrare live-software11
firebase login:list                 # deve includere live.software11@gmail.com
supabase projects list              # deve mostrare slidecenter (Frankfurt)
```

### 7.2 Sviluppo cloud

```powershell
pnpm install                                                    # primo setup
pnpm dev                                                        # tutti i dev server
pnpm --filter @slidecenter/web dev                              # solo web
pnpm --filter @slidecenter/web typecheck                        # only web
pnpm --filter @slidecenter/web lint                             # only web
pnpm --filter @slidecenter/web build                            # only web
pnpm --filter @slidecenter/web build:desktop                    # build per Tauri desktop
pnpm --filter @slidecenter/shared build                         # rebuild types/i18n
pnpm i18n:check                                                 # verifica parity IT/EN
```

### 7.3 Sviluppo desktop (Tauri 2)

```powershell
pnpm --filter @slidecenter/desktop prereqs                      # check toolchain
pnpm --filter @slidecenter/desktop dev                          # dev mode con hot reload
pnpm --filter @slidecenter/desktop release:nsis                 # build NSIS x64
.\release-licensed.bat                                          # build con feature license (vendita)
.\clean-and-build.bat                                           # build dev senza license
```

### 7.4 Sviluppo desktop (Local + Room Agent storici)

```powershell
pnpm --filter @slidecenter/agent dev
pnpm --filter @slidecenter/room-agent dev
pnpm --filter @slidecenter/agent build:tauri:licensed           # build con feature license
pnpm --filter @slidecenter/room-agent build:tauri:licensed
```

### 7.5 Database (Supabase)

```powershell
# Comandi nativi CLI
supabase start                                                  # avvia stack locale (Docker)
supabase stop                                                   # ferma stack
supabase db diff                                                # diff schema
supabase db push                                                # applica migrations REMOTE
supabase migration new <nome>                                   # nuova migration
supabase gen types typescript --local > packages/shared/src/types/database.ts
supabase functions serve                                         # dev Edge Functions
supabase functions deploy <nome>                                 # deploy Edge Function
supabase test db                                                 # esegui test RLS pgTAP

# Wrapper pnpm (Sprint Q+1) — aggiunti per ridurre errori
pnpm db:types                                                   # rigenera DB types da REMOTE (richiede SUPABASE_PROJECT_REF)
pnpm db:types:local                                             # rigenera DB types da LOCAL (richiede `supabase start`)
pnpm db:diff                                                    # alias di supabase db diff --schema public
pnpm db:lint                                                    # supabase db lint
pnpm db:push                                                    # supabase db push (DDL su prod, attenzione)
pnpm fn:deploy                                                  # deploy Edge Functions (tutte)
```

### 7.5.1 Vercel (Sprint Q+1)

```powershell
pnpm vercel:env:pull                                            # scarica env produzione in .env.local
pnpm vercel:deploy:prod                                         # deploy produzione manuale (normalmente auto via git push)
```

### 7.6 Quality gates

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm i18n:check

# Rust
cd apps\desktop\src-tauri
cargo check --all-features
cargo clippy --all-features -- -D warnings
cargo test --all-features
```

### 7.7 Git workflow

```powershell
git status                                                      # before commit
git diff                                                        # what changed
git log --oneline -10                                           # last 10 commits
git add .
git commit -m "$(cat <<'EOF'
fix(desktop): timeout discovery LAN su switch managed

Problema: switch managed bloccavano IGMP snooping aggressivo.
Soluzione: aumentato timeout da 2s a 5s + retry exponenziale.

Fix #42 (field test feedback)
EOF
)"
git push origin main                                            # solo dopo gh auth status verde
```

---

**FINE.** Per architettura: `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md`. Per setup: `docs/Setup_Strumenti_e_MCP.md`. Per Claude Desktop: `docs/Istruzioni_Claude_Desktop.md`.
