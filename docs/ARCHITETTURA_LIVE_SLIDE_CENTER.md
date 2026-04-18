# ARCHITETTURA LIVE SLIDE CENTER

> **Documento UNICO di riferimento.** Questo file sostituisce e incorpora i precedenti `GUIDA_DEFINITIVA_PROGETTO.md`, `PIANO_FINALE_SLIDE_CENTER_v2.md`, `GUIDA_OPERATIVA_v3_FIELD_TEST_E_OFFLINE.md`. Per lo stato sprint corrente e le azioni pendenti vedi il documento gemello `docs/STATO_E_TODO.md`.
>
> **Versione:** 5.10 — 18 aprile 2026 (post-Sprint T-2)
> **Owner:** Andrea Rizzari (CTO/Imprenditore)
> **Stack:** React 19 + Vite 8 + TypeScript strict + Supabase + Tauri 2 (Rust) — monorepo pnpm + Turborepo
> **Sito:** `app.liveslidecenter.com` (cloud) / installabile NSIS Windows (desktop) / `apps/agent` + `apps/room-agent` (versione PWA + Local/Room Agent storica)
> **Riferimenti operativi:**
>
> - `docs/STATO_E_TODO.md` — cose da fare oggi e domani
> - `docs/Setup_Strumenti_e_MCP.md` — setup macchina di sviluppo
> - `docs/Istruzioni_Claude_Desktop.md` — prompt di avvio Claude Desktop
> - `docs/Manuali/` — manuali installazione, distribuzione, code-signing, email
> - `docs/Commerciale/` — SLA, listino, roadmap vendita esterna

---

## INDICE

0. [Identita prodotto e principi sovrani](#0-identita-prodotto-e-principi-sovrani)
1. [Tre modalita di esecuzione del prodotto](#1-tre-modalita-di-esecuzione-del-prodotto)
2. [Stato attuale (cosa funziona oggi)](#2-stato-attuale-cosa-funziona-oggi)
3. [Stack tecnologico](#3-stack-tecnologico)
4. [Topologia di rete e diagrammi](#4-topologia-di-rete-e-diagrammi)
5. [Mappa monorepo](#5-mappa-monorepo)
6. [Multi-tenancy, RLS, RBAC, GDPR](#6-multi-tenancy-rls-rbac-gdpr)
7. [Schema database (Postgres + SQLite)](#7-schema-database-postgres--sqlite)
8. [Storage layout](#8-storage-layout)
9. [Pairing dispositivi (Device Flow)](#9-pairing-dispositivi-device-flow)
10. [Flussi end-to-end](#10-flussi-end-to-end)
11. [Enforcement regola sovrana #2 (file da locale)](#11-enforcement-regola-sovrana-2-file-da-locale)
12. [Sistema licenze (Lemon Squeezy → Live WORKS APP → Slide Center)](#12-sistema-licenze-lemon-squeezy--live-works-app--slide-center)
13. [Modulo apps/web](#13-modulo-appsweb)
14. [Modulo apps/desktop (Tauri 2 + Axum + SQLite)](#14-modulo-appsdesktop-tauri-2--axum--sqlite)
15. [Modulo apps/agent + apps/room-agent (Local/Room Agent storici)](#15-modulo-appsagent--appsroom-agent-localroom-agent-storici)
16. [Modulo packages/shared](#16-modulo-packagesshared)
17. [Edge Functions Supabase](#17-edge-functions-supabase)
18. [i18n + accessibility](#18-i18n--accessibility)
19. [Quality gates + CI](#19-quality-gates--ci)
20. [Account, deploy, infrastruttura](#20-account-deploy-infrastruttura)
21. [Piani commerciali e quote](#21-piani-commerciali-e-quote)
22. [Sprint history sintetica](#22-sprint-history-sintetica)
23. [ADR sintetici](#23-adr-sintetici)
24. [Glossario](#24-glossario)

---

## 0. Identita prodotto e principi sovrani

**Live SLIDE CENTER** e un SaaS multi-tenant per la gestione di presentazioni in eventi live (congressi, corporate, fiere). Il prodotto sostituisce manualita tipiche dei tecnici slide di settore: raccolta file dai relatori via portale upload con QR, distribuzione automatica ai PC sala, vista regia in tempo reale, archiviazione fine evento.

### Differenziatori commerciali

| Differenziatore          | Vs Slidecrew (Olanda)                           | Vs SLIDEbit (Firenze) | Vs Preseria (Norvegia)   |
| ------------------------ | ----------------------------------------------- | --------------------- | ------------------------ |
| **SaaS flat-rate**       | €149/mese per 5 eventi vs €1.140/evento singolo | SaaS vs hardware      | Comparabile + ecosistema |
| **Zero-config PC sala**  | Codice 6 cifre vs setup tecnico                 | Codice vs e-lectern   | Codice vs app desktop    |
| **Offline-first nativo** | Architettura nativa vs caching add-on           | Comparabile           | Comparabile              |
| **Ecosistema Live**      | Timer + Teleprompter + CREW + PLAN              | Standalone            | Standalone               |

Risparmio cliente medio: 96% rispetto a pricing per-evento Slidecrew.

### Principi sovrani (NON negoziabili)

1. **Stabilita live > tutto.** Mai compromettere un evento in produzione per una feature nuova.
2. **File partono SEMPRE dal PC locale che li proietta.** Cloud e LAN sono solo per la SINCRONIZZAZIONE (download nel disco locale prima di aprirli). Non esiste streaming "in diretta" da cloud durante il live: sarebbe ostaggio della rete. Vedi §11 per l'enforcement programmatico.
3. **Esperienza utente identica fra cloud e offline.** Stessa UI, stessi flussi, stessi tasti. Cambia solo il backend (cloud Supabase vs server locale Rust). Niente fork del codice React.
4. **Persistenza assoluta.** Una volta configurato, un PC sala NON perde mai stato a un riavvio. Solo l'utente o l'admin possono disconnetterlo.
5. **Performance live invariante.** Quando un PC e in modalita LIVE, il sync deve essere talmente leggero da NON essere percepibile durante un video 4K a piena banda.
6. **Semplicita "Google Drive style".** Cartelle = sale, sottocartelle = sessioni, file = presentazioni. Click destro / multi-select / search funzionano come Drive.
7. **i18n parity.** Ogni stringa IT ha coppia EN professionale nello **stesso commit**.
8. **Mai dati senza `tenant_id`.** RLS attiva ovunque. Nessuna scorciatoia.
9. **Mai logica di sicurezza solo nel client.** Il guard piu importante e sempre lato Postgres (RLS) o Edge Function (auth).
10. **Mai vedere contenuto file clienti.** Andrea (super-admin) vede metadati, MAI il contenuto delle presentazioni — vincolo GDPR.
11. **Coerenza ecosistema desktop.** Lo stack offline e Tauri 2 (Rust) + WebView. Mai Electron.
12. **Stessa SPA React per tutte le modalita.** Dispatcher in `apps/web/src/lib/{backend-mode,backend-client,realtime-client}.ts`. I componenti consumano API neutre, non sanno mai quale backend hanno sotto.

---

## 1. Tre modalita di esecuzione del prodotto

Il Centro Slide viene venduto in **tre forme** che condividono il 100% della SPA React e differiscono solo nel backend e nel canale di sync. Ogni nuova feature deve funzionare in tutte e tre, oppure dichiarare esplicitamente in quale modalita e attiva.

| Modalita                        | Backend                                              | Canale sync admin → sala          | Quando si vende                                                                          |
| ------------------------------- | ---------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| **Cloud SaaS**                  | Supabase (Postgres + Auth + Storage + Realtime + EF) | Realtime Broadcast + PG triggers  | Eventi multi-sede, multi-tenant, condivisione speaker tra eventi, accesso da remoto      |
| **Desktop intranet**            | Server Rust Axum locale + SQLite + mDNS              | LAN push fan-out + long-poll      | Eventi single-site senza Internet affidabile (fiere, congressi remoti, navi)             |
| **Hybrid (Sprint Q opzionale)** | Desktop come master + Supabase come backup push-only | LAN intra-evento + cloud sync 60s | Aziende che vogliono backup cloud automatico + condivisione cross-sede su rete instabile |

**Vincoli sovrani applicati a tutte e tre:**

- **File partono SEMPRE dal PC locale** (regola §0.2). Vedi §11 per l'enforcement.
- **Stesso codice React** per tutte e tre. Cambia solo il client del backend (Supabase JS vs `getBackendClient()` REST mirror su Rust).
- **Stessa UI, stessi flussi, stessi tasti.** Un utente formato sul cloud usa il desktop senza retraining (e viceversa).
- **Nessun fork del codice.** Niente `if (mode === 'cloud') { ... } else { ... }` sparso nei componenti: l'astrazione vive in `apps/web/src/lib/backend-mode.ts`, `backend-client.ts`, `realtime-client.ts`.

### Quando vendere quale modalita

| Scenario                                          | Modalita consigliata          | Hardware Andrea porta                | Costo per cliente                   |
| ------------------------------------------------- | ----------------------------- | ------------------------------------ | ----------------------------------- |
| Evento piccolo (1-3 sale, WiFi buono)             | Cloud SaaS                    | Niente                               | €0 hardware + canone SaaS           |
| Evento medio (4-10 sale, WiFi incerto)            | Cloud SaaS o Desktop intranet | Router + mini-PC                     | ~€500 una tantum + canone SaaS      |
| Evento grande (10+ sale, centro congressi)        | Desktop intranet              | Router + AP + mini-PC                | ~€1.000 una tantum + canone SaaS    |
| Area senza internet (fiera, nave, deserto)        | Desktop intranet              | Router + mini-PC + file pre-caricati | Come sopra                          |
| Multi-sede su VPN instabile + voglio backup cloud | Hybrid (Sprint Q)             | Come intranet + Internet a tratti    | Come intranet + canone SaaS ridotto |

---

## 2. Stato attuale (cosa funziona oggi)

> **Tutti gli sprint A→I (cloud) e J→P + FT (desktop) sono DONE.** Il prodotto e' utilizzabile in produzione DHS oggi stesso. Field test reale rimandato (vedi `docs/STATO_E_TODO.md`).
>
> **Audit chirurgico 18/04/2026:** identificati 10 GAP funzionali rispetto agli obiettivi prodotto (vendita esterna, file management OneDrive-style, performance impatto-zero, competitivita PreSeria/Slidecrew/SLIDEbit). Roadmap dettagliata in **`docs/STATO_E_TODO.md` §0** (Sprint R/S/T pianificati, ~20 giorni dev totali). Quando si decide GO su uno degli sprint, leggere prima la sezione audit per evitare regressioni e mantenere la coerenza architetturale qui descritta.
>
> **Sprint Q+1 hardening (DONE 18/04/2026):** Supabase RLS least-privilege, 7 indici hot-path, PKCE flow, CSP completa Vercel, CI types drift + auto-deploy Edge Functions. Vedi `docs/STATO_E_TODO.md` §0.8.
>
> **Sprint R-1 chiuso (DONE 18/04/2026):** super-admin (Andrea) puo' creare nuovi tenant cliente + invito primo admin direttamente da `/admin/tenants` senza passare da CLI. Implementato via RPC SECURITY DEFINER `admin_create_tenant_with_invite` + `CreateTenantDialog`. **Gap G1 chiuso (1/10).** Vedi `docs/STATO_E_TODO.md` §0.9.
>
> **Sprint R-2 chiuso (DONE 18/04/2026):** integrazione bidirezionale Lemon Squeezy → Live WORKS APP. Edge Function `lemon-squeezy-webhook` riceve subscription events, idempotency strict via `lemon_squeezy_event_log`, mapping configurabile via `lemon_squeezy_plan_mapping`, RPC `lemon_squeezy_apply_subscription_event` crea/aggiorna/sospende tenant. Email automatica `kind='admin-invite'` IT/EN al primo admin (R-1.b inline). **Gap G2 chiuso (2/10).** Vedi `docs/STATO_E_TODO.md` §0.10.
>
> **Sprint R-3 chiuso (DONE 18/04/2026):** PC sala upload speaker check-in. Relatore last-minute carica/sostituisce file dal PC sala via `RoomDeviceUploadDropzone` (drag&drop + progress + SHA-256). Auth via `device_token` (no JWT), upload diretto a Storage via signed URL (bypass limite 6MB Edge Functions). 3 nuove RPC `SECURITY DEFINER` (`init/finalize/abort_upload_version_for_room_device`), 3 nuove Edge Functions (`room-device-upload-init/finalize/abort`). Trigger esistente `broadcast_presentation_version_change` propaga `presentation_changed` su `room:<id>` → admin live view aggiornata in <1s. Activity log con `actor='device'`, `actor_name='PC sala N'`. Enum `upload_source += 'room_device'`, `actor_type += 'device'`. **Gap G3 chiuso → famiglia R commercial readiness completa (3/10).** Vedi `docs/STATO_E_TODO.md` §0.11.
>
> **Sprint S-1 chiuso (DONE 18/04/2026):** drag&drop folder admin OneDrive-style. Nuova utility `apps/web/src/features/presentations/lib/folder-traversal.ts` (`extractFilesFromDataTransfer`, `extractFilesFromInputDirectory`) con traversal ricorsivo BFS via `webkitGetAsEntry()` + `<input webkitdirectory>`. Limiti hard 500 file/depth 10/255 char per filename (con truncation segmenti iniziali e prefisso `.../`). Path relativo preservato come prefisso del filename in `presentation_versions.file_name`, sanitizzazione regex applicata solo a `storage_key`. Zero modifiche schema DB. UI `SessionFilesPanel` aggiunge bottone "Sfoglia cartella" + feedback transient con conteggio file aggiunti + warning aggregati (vuoti/duplicati/nameTooLong/truncated). i18n IT/EN +10 chiavi (parita 1217/1217). **Gap G4 chiuso → famiglia S file-management avviata (4/10).** Vedi `docs/STATO_E_TODO.md` §0.12.
>
> **Sprint S-2 chiuso (DONE 18/04/2026):** drag&drop visivo PC ↔ sale. Nuovo componente `apps/web/src/features/devices/components/RoomAssignBoard.tsx` — lavagna Kanban-style (colonna "Non assegnati" + N colonne sala) con HTML5 drag&drop nativo (`dataTransfer` MIME custom `application/x-sc-device-id`), aggiornamento ottimistico locale + rollback su errore, busy-state per device durante mutation. `DevicesPanel` aggiunge un toggle persistente in localStorage "Lista | Lavagna" (default: list per retro-compatibilita, vista Lista resta invariata come fallback per touch/keyboard). Mutation tramite `updateDeviceRoom(deviceId, roomId)` esistente, RLS `tenant_isolation` invariata. Realtime listener `paired_devices` postgres_changes gia' attivo allinea altri admin connessi in <1s senza broadcast custom. Zero modifiche schema DB. i18n IT/EN +12 chiavi (parita 1229/1229). **Gap G5 chiuso → famiglia S avanza (5/10, 2/4 sprint S).** Vedi `docs/STATO_E_TODO.md` §0.13.
>
> **Sprint S-3 chiuso (DONE 18/04/2026):** export ZIP fine evento ordinato per sala/sessione. Refactor pure-function `apps/web/src/features/events/lib/event-export.ts`: `buildEventSlidesZip` ora accetta `EventSlidesZipOptions` (event, rooms, sessions, t, locale, generatedAtIso, onProgress, includeReadme) e produce uno ZIP **nested** `Sala/Sessione/Speaker_vN_filename.ext` con `info.txt` UTF-8 in root (metadata: nome evento, date, sale/sessioni totali, conteggio file per sala, totale bytes, ora generazione). `CurrentSlideExportRow` esteso con `roomId/roomName/sessionId`. Sostituisce il vecchio ZIP piatto `slides/Speaker_vN_file.ext`. Nessun toggle UI (Andrea ha richiesto esplicitamente "in modo ordinato" → semplificato). Zero modifiche schema DB, zero env vars, zero deploy. i18n IT/EN +14 chiavi `event.export.zip.*` (parita 1243/1243). **Gap G6 chiuso → famiglia S 3/4 (6/10 totali).** Vedi `docs/STATO_E_TODO.md` §0.14.
>
> **Sprint S-4 chiuso (DONE 18/04/2026):** ruolo device "Centro Slide" multi-room. Migration `20260418090000_paired_devices_role.sql` aggiunge `paired_devices.role TEXT NOT NULL DEFAULT 'room' CHECK (role IN ('room','control_center'))` + RPC `update_device_role(device_id, new_role) SECURITY INVOKER` (rispetta RLS `tenant_isolation_paired_devices`, super-admin escape hatch, force `room_id=NULL` su promote). Edge Function `room-player-bootstrap` esteso con branch `deviceRole === 'control_center'` → query `presentations` su **tutte** le sale dell'evento, `FileRow` arricchito con `roomId/roomName`, sort multi-room (`roomName → sessionScheduledStart → filename`), payload include `control_center: true` + `rooms[]`. `useFileSync` con `FileSyncItem.{roomId,roomName}` + flag `disableRealtime` (centri = polling-only, no per-room subscription) + path locale `Sala/Sessione/file`. UI: branch dedicato in `RoomPlayerView.tsx` (icona `Building2`, badge `CENTRO`, count sale, `RoomDeviceUploadDropzone` nascosto perche' centro = read-only); kebab promote/demote in `DeviceList.tsx`; sezione fixed "Centri Slide" sopra la lavagna in `RoomAssignBoard.tsx` (non draggable). 18 nuove chiavi i18n IT/EN sotto `devices.list.*`, `devices.board.*`, `roomPlayer.center.*` (parita 1260/1260). **Gap G7 chiuso → famiglia S COMPLETA (4/4) → 7/10 totali.** Vedi `docs/STATO_E_TODO.md` §0.15.
>
> **Sprint T-1 chiuso (DONE 18/04/2026):** badge versione "in onda" sempre visibile in sala + toast cambio versione. Edge Function `room-player-bootstrap` arricchita con `versionNumber` (= `presentation_versions.version_number` della current) + `versionTotal` (= MAX(`version_number`) per `presentation_id` filtrato `status IN ('ready','superseded')`). Nuovo componente riusabile `apps/web/src/features/devices/components/VersionBadge.tsx` con due varianti: `inline` (chip piccolo accanto al filename in `FileSyncStatus`, sempre visibile) + `overlay` (badge fluttuante top-right in `FilePreviewDialog` durante anteprima fullscreen, auto-fade 5s, ricompare on mouse/touch/keypress — UX video player). Color coding sovrano: VERDE (`CheckCircle2`) se corrente = latest, GIALLO (`History`) se admin ha rollbackato la corrente (esiste versione piu' nuova), neutro (`Layers`) se totale = 1. Pattern derived-state-from-props raccomandato React 19 per evitare `setState` in `useEffect`. `FilePreviewDialog` accetta nuovo prop opzionale `versionInfo?: { number, total }` + dispatch `wakeKey` su mouseMove/touchStart/keydown per "wake-up" del badge. `RoomPlayerView` aggiunge `useEffect` che traccia `presentationId → ultimo versionNumber visto` e dispatcha toast `info` (newer) o `warning` (rollback) via `useToast` (skip primo render per evitare spam). 10 nuove chiavi i18n IT/EN sotto `roomPlayer.versionBadge.*` + `roomPlayer.versionToast.*` (parita 1270/1270). Zero modifiche schema DB, zero env vars nuove, deploy obbligatorio solo della Edge Function. **Gap G8 chiuso → famiglia T 1/3 (8/10 totali).** Vedi `docs/STATO_E_TODO.md` §0.16.
>
> **Sprint T-2 chiuso (DONE 18/04/2026):** telemetria perf live PC sala (heap JS / storage quota / FPS / battery / network) ora visibile a colpo d'occhio in admin. Migration `20260418100000_device_metric_pings.sql`: nuova tabella append-only `device_metric_pings` (BIGSERIAL PK, `tenant_id/device_id/event_id/room_id`, `source IN ('browser','desktop')`, browser metrics + desktop metrics nullable + common metrics, CHECK ranges, indici hot-path `(device_id,ts DESC)` + `(event_id,ts DESC)` + `(ts)` per cleanup, RLS chiusa con SELECT solo super-admin/admin/tech del tenant, INSERT/UPDATE/DELETE bloccati). Tre RPC SECURITY DEFINER: `record_device_metric_ping(p_device_id,p_payload)` (rate-limit soft 3s, NULLIF safe-cast, exception handler best-effort), `fetch_device_metrics_for_event(p_event_id,p_window_min,p_max_pings_per_device)` (clamp parametri 1..60/1..200, auth `app_tenant_id() = events.tenant_id` + ruolo admin/tech), `cleanup_device_metric_pings()` (retention 24h via `pg_cron` daily `0 3 * * *`, idempotente). Edge Function `room-player-bootstrap` accetta nuovo body `metrics?: object`, enrich con `playback_mode` + `device_role` server-side (anti-spoofing), chiama RPC fire-and-forget. Nuovo hook PWA `useDevicePerformanceCollector` (FPS via `requestAnimationFrame` EMA 5s con auto-pause su `visibilitychange='hidden'`, heap via `performance.memory`, storage via `navigator.storage.estimate`, network via `navigator.connection`, battery via `navigator.getBattery()` con cache + listener `levelchange/chargingchange`, visibility, uptime via `Date.now() - performance.timeOrigin`, source `'browser'`/`'desktop'` se Tauri). Nuovo hook admin `useDeviceMetrics(eventId, options)` (polling default 8s, pausa su tab hidden + refresh immediato al rientro, anti-race via `reqIdRef`). Nuovo `<Sparkline>` SVG inline zero-deps (~200 byte) con color-coding soglia + marker current-value + supporto `inverted` (FPS, disk_free, battery). Nuovo widget `<LivePerfTelemetryPanel eventId enabled?>`: card per device con health-dot (healthy/warning/critical/unknown), badge `CENTRO` per control_center, status offline/network/source, battery badge colorato; grid metriche heap/storage/FPS sempre visibili, CPU/RAM solo `source='desktop'`; sparkline 30 min sotto ogni numero big colorato; footer compact uptime + playback mode + downlink. Pannello collassabile (default chiuso, summary header `X sani | Y attenzione | Z critici | W ignoti` sempre visibile, persistito `localStorage:sc:liveperftelemetry:open`). **Auto-hidden** quando 0 device pairati. **Toast alert debounced 30s**: stato critical/warning persiste >=30s → toast 1×, `recovered` (critical→healthy dopo notify) → toast `success`. Soglie sovrane (configurate inline per facile tuning field): heap >=85/95, storage >=90/95, FPS <30/15, CPU >=85/95, RAM >=90/95, disk_free <=10/5, battery <=20/10 (solo se `!charging`). Integrato in `EventDetailView.tsx` sotto `<DevicesPanel />`. 51 nuove chiavi i18n IT/EN sotto `deviceTelemetry.*` (parita 1312/1312). **Gap G9 chiuso → famiglia T 2/3 (9/10 totali).** Vedi `docs/STATO_E_TODO.md` §0.17.

| Area                                                       | Cloud (web)                               | Desktop offline (Tauri 2)                    |
| ---------------------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Auth multi-tenant + super-admin                            | DONE (Fase 1)                             | n/a (single-site)                            |
| Pairing PC sala                                            | Codice 6 cifre + QR (Fase 6)              | Pairing LAN diretto via mDNS (Sprint L)      |
| Auto-rejoin al boot                                        | `device_token` in IndexedDB               | `device.json` in `~/SlideCenter/` (Sprint M) |
| Persistenza handle cartella locale                         | FSA + IndexedDB                           | Stessa SPA, stesso path locale               |
| Sync file admin → sala                                     | Realtime Broadcast + polling (Sprint A+B) | LAN push fan-out + long-poll (Sprint N)      |
| Streaming download chunked + resume                        | Range + SHA-256 (Sprint C)                | Stessa pipeline, signed URL HMAC LAN         |
| Modalita LIVE / TURBO / AUTO                               | Throttle + priority hint (Sprint A1-A6)   | Identico (Sprint N4)                         |
| Struttura cartelle `<root>/<sala>/<sessione>/<file>`       | DONE                                      | DONE identico                                |
| Upload admin con drag & drop multi-file                    | Coda sequenziale + cancel (Sprint H)      | Stessa UI, REST mirror su Rust               |
| Anteprima inline (PDF / img / video / audio)               | `<FilePreviewDialog>` (Sprint I)          | Idem, con guard `enforceLocalOnly` per sala  |
| Search globale evento                                      | Combobox WAI-ARIA (Sprint F)              | Idem, query SQLite locale                    |
| Multi-select (ZIP, sposta, elimina)                        | Toolbar bulk con jszip (Sprint G)         | Idem, RPC mirror su Rust                     |
| Dashboard PC sala admin                                    | `RoomDevicesPanel` + Realtime (Sprint D)  | Idem + bottone "Aggiungi PC LAN" (Sprint L)  |
| Anteprima "in onda" (now playing badge)                    | `room_state.current_presentation_id` (I)  | Identico                                     |
| Storage usage + cleanup orfani                             | `<StorageUsagePanel>` (Sprint E)          | Identico (root locale)                       |
| Vista regia realtime                                       | `LiveRegiaView` (Fase 5)                  | Stessa UI, polling SQLite                    |
| Versioning + storico + review workflow                     | `presentation_versions` append-only       | Stessa UI                                    |
| Upload portal speaker (TUS resumable)                      | `/u/:token` + SHA-256 client (Fase 3)     | n/a (cloud-only)                             |
| Export fine evento                                         | ZIP + CSV + PDF (`EventExportPanel`)      | DONE locale                                  |
| Billing UI                                                 | `/billing` + Lemon Squeezy link (Fase 11) | n/a                                          |
| Sentry + ErrorBoundary + Playwright                        | DONE (Fase 14)                            | n/a                                          |
| RLS audit + rate limit pair-claim                          | DONE (Fase 14)                            | n/a (no RLS, single-tenant)                  |
| Inviti team + accept-invite                                | DONE (Sprint 1 / Fase 14)                 | n/a                                          |
| Password reset                                             | DONE (Sprint 1 / Fase 14)                 | n/a                                          |
| Hardening commerciale: SLA, listino, code-signing CI       | DONE (Sprint 5 + 5b)                      | DONE (`--features license`)                  |
| Onboarding wizard + demo data + healthcheck                | DONE (Sprint 6)                           | n/a                                          |
| Operativita interna 100% (GDPR + email + dashboard)        | DONE (Sprint 7)                           | n/a                                          |
| Audit log tenant + status page + welcome email + guida DHS | DONE (Sprint 8)                           | n/a                                          |
| Auto-update                                                | Vercel deploy on push                     | Tauri updater + banner (Sprint P)            |
| Build + distribuzione                                      | Vercel cloud                              | NSIS Windows x64 + portable ZIP (Sprint P)   |
| Field test readiness                                       | n/a                                       | Smoke test + script PowerShell (Sprint FT)   |
| Sync hybrid cloud↔offline                                  | n/a                                       | **Opzionale (Sprint Q, ready-to-code)**      |

---

## 3. Stack tecnologico

### Web (`apps/web`)

| Layer         | Tecnologia                | Versione |
| ------------- | ------------------------- | -------- |
| Framework UI  | React                     | 19       |
| Build tool    | Vite                      | 8        |
| Linguaggio    | TypeScript                | strict   |
| Styling       | Tailwind CSS              | 4        |
| Componenti    | shadcn/ui + Radix         | latest   |
| Routing       | React Router              | 7        |
| State         | Zustand                   | latest   |
| Tabelle       | TanStack Table            | latest   |
| Form          | Zod + React Hook Form     | latest   |
| i18n          | i18next + react-i18next   | latest   |
| Upload        | tus-js-client + use-tus   | latest   |
| PWA           | vite-plugin-pwa (Workbox) | Fase 6   |
| Observability | @sentry/react (lazy)      | Fase 14  |
| E2E           | @playwright/test          | Fase 14  |

### Backend cloud / Infrastruttura

| Layer          | Tecnologia          | Note                                                                       |
| -------------- | ------------------- | -------------------------------------------------------------------------- |
| Database       | Supabase PostgreSQL | RLS + trigger + RPC SECURITY DEFINER                                       |
| Auth           | Supabase Auth       | JWT custom claims con `tenant_id` + `role`                                 |
| Storage        | Supabase Storage    | TUS + S3 compatible, fino a 500GB/file                                     |
| Realtime       | Supabase Realtime   | `room_state`, `presentation_versions`, `local_agents`, `paired_devices`    |
| Edge Functions | Supabase + Deno     | Pairing, upload validation, cleanup, GDPR export, email, status, licensing |
| Deploy web     | Vercel              | Auto-deploy su push `main`                                                 |
| Email          | Resend              | Transactional + idempotency log (Sprint 7)                                 |
| Cron           | GitHub Actions      | Daily license expiry scan (Sprint 7)                                       |

### Desktop offline (`apps/desktop` — Sprint J-P, fonte unificata Fase 15)

| Layer           | Tecnologia                                        | Note                                                       |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Framework       | Tauri 2                                           | Rust backend + WebView (la stessa SPA React di `apps/web`) |
| HTTP server LAN | Axum                                              | Bind `0.0.0.0:7300` (admin) / `127.0.0.1:7301` (sala)      |
| Database locale | SQLite (rusqlite WAL)                             | Mirror schema Postgres essenziale, single-tenant           |
| Discovery LAN   | mDNS + UDP broadcast + UNC + IP manuale (4-tier)  | Sprint L                                                   |
| Sync engine     | tokio + reqwest                                   | Long-poll dal client + push fan-out dal server             |
| UI              | Stessa SPA React (`apps/web`) iframed nel WebView | Routing automatico via `backend-mode.ts`                   |
| Updater         | Tauri updater                                     | Manifest hostato su Vercel (Sprint P)                      |
| Build           | NSIS Windows x64                                  | `pnpm --filter @slidecenter/desktop release:nsis`          |
| Smoke test      | Node 22 script + PowerShell wrapper               | `apps/desktop/scripts/smoke-test.{mjs,ps1}` (Sprint FT)    |

### Local Agent + Room Agent (`apps/agent` + `apps/room-agent` — variante PWA storica)

Stack identico a `apps/desktop` ma con **due binari distinti** che vivono **fuori** dal WebView principale (un mini-PC regia "Local Agent" + un agent leggero per ogni PC sala "Room Agent" che fa polling LAN dal Local Agent). Resta valido per scenari intranet "puro" (modalita B di ADR-003) dove il PC sala usa il browser e non vuole il WebView Tauri integrato. Vedi §15.

### Linguaggi & toolchain

| Tool           | Versione minima | Note                                    |
| -------------- | --------------- | --------------------------------------- |
| Node.js        | 22 LTS          | Runtime monorepo                        |
| pnpm           | 9+              | Package manager monorepo                |
| Rust           | 1.77+           | Backend Tauri 2                         |
| Supabase CLI   | latest          | Migrations, types, local dev            |
| Tauri CLI      | 2.x             | Build desktop                           |
| GitHub CLI     | latest          | Push verifica account `live-software11` |
| Docker Desktop | (opzionale)     | Necessario per `supabase start` locale  |

Vedi `docs/Setup_Strumenti_e_MCP.md` per setup completo macchina di sviluppo.

---

## 4. Topologia di rete e diagrammi

```
                       [MODALITA A — CLOUD SAAS PURO]

    Sala 1 PC          Sala 2 PC          Sala N PC
   (Chrome PWA)        (Chrome PWA)       (Chrome PWA)
        |                  |                   |
        +--------- HTTPS / WSS ----------------+
                            |
                  +---------v----------+
                  |  Supabase + Vercel |     <-- Andrea (dashboard)
                  |  (Francoforte EU)  |         da qualsiasi luogo
                  +--------------------+


                   [MODALITA B — DESKTOP INTRANET LAN]

    Sala 1 PC           Sala 2 PC          Sala N PC
   (Tauri Desktop      (Tauri Desktop     (Tauri Desktop
    in modalita Sala)   in modalita Sala)  in modalita Sala)
        |                  |                   |
        +-------+----------+----------+--------+
                |   LAN HTTP :7300 (admin)
                |   LAN HTTP :7301 (sala)
                |   mDNS _slide-center._tcp.local
                v
          +-----+-------------------------+
          |  Tauri Desktop in modalita    |
          |  ADMIN (mini-PC regia)        |
          |  Axum + SQLite WAL            |
          +-------------------------------+
                  internet OPZIONALE


                  [MODALITA C — HYBRID push-only (Sprint Q)]

    Tauri Desktop ADMIN ---LAN--- PC sala (Tauri Desktop SALA)
            |
            | push-only ogni 60s, payload firmato HMAC
            v
       Supabase cloud (backup + dashboard remoto, NO write-back)
```

### Tabella scenari operativi

| Scenario                                   | Modalita        | Hardware Andrea                     | Costo HW one-time |
| ------------------------------------------ | --------------- | ----------------------------------- | ----------------- |
| Evento piccolo (1-3 sale, WiFi buono)      | A — Cloud       | Niente                              | €0                |
| Evento medio (4-10 sale, WiFi incerto)     | B — Desktop LAN | Router + mini-PC                    | ~€500             |
| Evento grande (10+ sale, centro congressi) | B — Desktop LAN | Router + AP + mini-PC               | ~€1.000           |
| Area senza internet                        | B — Desktop LAN | Router + mini-PC + file precaricati | Come sopra        |

---

## 5. Mappa monorepo

```
Live SLIDE CENTER/
├── apps/
│   ├── web/              # SPA React 19 (cloud + desktop WebView) — UI unica
│   ├── desktop/          # Tauri 2 wrapper + Axum + SQLite (Sprint J-P, Fase 15)
│   ├── agent/            # Local Agent legacy (mini-PC regia, PWA path) — Sprint 4 licenze
│   └── room-agent/       # Room Agent legacy (PC sala leggero) — Sprint 4 licenze
├── packages/
│   ├── shared/           # Types Database (Supabase), constants/plans, i18n IT/EN, hooks
│   └── ui/               # cn() + componenti shadcn condivisi
├── supabase/
│   ├── migrations/       # Schema SQL + RLS (~16 file ad oggi)
│   ├── functions/        # Edge Functions Deno (pair-*, room-player-bootstrap, gdpr-export, email-*, system-status, licensing-sync, team-invite-accept)
│   └── tests/            # rls_audit.sql + seed pgTAP
├── icons/                # Logo sorgente ufficiale (Sharp → public/ in prebuild)
├── .cursor/rules/        # Regole agent (00-project-identity → 04-git-workflow + supabase-db, web-react, web-supabase-client, desktop-tauri, architecture-deep, ...)
├── .github/workflows/    # ci.yml + playwright.yml + rls-audit.yml (pin supabase-cli 2.20.3)
├── release/              # Output build NSIS (gitignored)
├── release-licensed.bat  # Build di vendita con feature `license`
├── clean-and-build.bat   # Build dev senza licenze
└── docs/
    ├── ARCHITETTURA_LIVE_SLIDE_CENTER.md   ← QUESTO FILE (fonte di verita)
    ├── STATO_E_TODO.md                      ← cose da fare
    ├── Setup_Strumenti_e_MCP.md             ← setup macchina sviluppo
    ├── Istruzioni_Claude_Desktop.md         ← prompt avvio Claude Desktop
    ├── Manuali/                             ← installazione, distribuzione, code-signing, email Resend
    └── Commerciale/                         ← SLA, listino, roadmap vendita esterna
```

### Workspace pnpm (`pnpm-workspace.yaml`)

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### Pipeline Turborepo (`turbo.json`)

- `build` → `dist/**` cached, `^build` deps
- `dev` → cache: false, persistent: true
- `lint` / `lint:fix` / `typecheck` / `test` con `^build` deps
- `globalEnv`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_NAME`, `VITE_APP_VERSION`, `VITE_SENTRY_DSN`

---

## 6. Multi-tenancy, RLS, RBAC, GDPR

**Non esiste compromesso.** La separazione tra clienti e l'invariante sacra del prodotto.

### 6.1 Database (Postgres)

Ogni tabella business ha `tenant_id UUID NOT NULL REFERENCES tenants(id)`. RLS attiva ovunque con policy `tenant_id = public.app_tenant_id()`.

```sql
CREATE OR REPLACE FUNCTION public.app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(trim(both '"' from (auth.jwt() -> 'app_metadata' ->> 'tenant_id')), '')::uuid,
    NULLIF(trim(both '"' from (auth.jwt() -> 'user_metadata' ->> 'tenant_id')), '')::uuid
  );
$$;

CREATE POLICY tenant_isolation ON events
  FOR ALL USING (tenant_id = public.app_tenant_id());
```

Funzioni di guard correlate:

- `public.is_super_admin()` — `STABLE`, ritorna true se JWT ha `app_metadata.role = 'super_admin'`
- `public.current_tenant_suspended()` — `SECURITY DEFINER`, blocca dati operativi se il tenant ha `suspended = true` (Fase 14)

### 6.2 Storage

Path obbligatorio: `tenants/{tenant_id}/events/{event_id}/presentations/{id}/v{n}/{file}`. Edge Function verifica `tenant_id` dal JWT prima di firmare URL.

Bucket privati attivi:

- `presentations` (file presentazioni, RLS strict tenant)
- `tenant-exports` (GDPR export ZIP, retention 7gg, RLS prefix tenant — Sprint 7)

### 6.3 Auth signup

Trigger SQL al signup: crea `tenants` → crea `users` con `role='admin'` → aggiorna `auth.users.raw_app_meta_data` con `tenant_id` e `role`.

Il client **non** deve navigare verso route tenant-scoped finche il JWT non contiene `app_metadata.tenant_id`. Pattern: `signUp` → `refreshSession()` → `getUser()` → verifica claim, con retry breve. Implementazione: `apps/web/src/features/auth/lib/wait-for-tenant-jwt.ts`.

Gestione email confermata: se `signUp` non ritorna sessione (flusso conferma obbligatoria), il client mostra `auth.signupCheckEmail*` invece di entrare nel loop JWT.

### 6.4 RBAC

| Ruolo         | Tipo                                   | Accesso                                                               |
| ------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `super_admin` | `user_role` enum                       | Cross-tenant: tutti i tenant, quote, audit. NON contenuto file (GDPR) |
| `admin`       | `user_role` enum                       | Tutto nel proprio tenant                                              |
| `coordinator` | `user_role` enum                       | CRUD sessioni/speaker, vista regia                                    |
| `tech`        | `user_role` enum                       | Vista sala assegnata, download, stato sync                            |
| speaker       | Record in tabella `speakers` (NO auth) | Upload via `upload_token` univoco, scadenza 90gg                      |

**JWT custom claims** (Supabase `app_metadata`): `{ "tenant_id": "uuid", "role": "admin|coordinator|tech|super_admin" }`.

**Bootstrap super-admin (una volta sola):**

```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}'::jsonb
WHERE email = 'live.software11@gmail.com';
```

### 6.5 GDPR

- **Andrea NON puo** vedere contenuto file clienti (super-admin vede solo metadati).
- **Andrea NON puo** modificare dati eventi tenant o inviare email ai relatori.
- **GDPR export** disponibile per ogni admin tenant via `/settings/privacy` → ZIP con manifest JSON + 10 CSV (users/events/rooms/sessions/speakers/presentations/presentation_versions/local_agents/paired_devices/audit_log_90d) + signed URL 7gg + record in `tenant_data_exports`. Edge Function: `supabase/functions/gdpr-export/`.
- **Cancellazione dati**: documentata in `/settings/privacy` con riferimento a DPO (esterno, vedi `docs/Commerciale/Contratto_SLA.md`).
- **Sentry**: NEVER `sendDefaultPii: true`.

---

## 7. Schema database (Postgres + SQLite)

### 7.1 Tabelle Postgres (cloud)

| Tabella                  | Scopo                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `tenants`                | Organizzazioni SaaS con piano, quote storage, `suspended`, `license_key`/`expires_at`/`max_devices_per_room`, `onboarded_at` |
| `users`                  | Utenti con ruolo (admin/coordinator/tech/super_admin), FK a `auth.users`                                                     |
| `events`                 | Congressi/convegni con status workflow (draft → setup → active → closed → archived) + `network_mode` (cloud/intranet/hybrid) |
| `rooms`                  | Sale fisiche per evento (main/breakout/preview/poster)                                                                       |
| `sessions`               | Slot orari per sala (talk/panel/workshop/break/ceremony) + `display_order` per drag-and-drop                                 |
| `speakers`               | Relatori con `upload_token` per upload senza login                                                                           |
| `presentations`          | Collegamento speaker → versione corrente                                                                                     |
| `presentation_versions`  | **Append-only**, ogni upload = nuova riga, mai UPDATE (trigger `guard_versions_immutable`)                                   |
| `room_state`             | Stato realtime sala (sessione, sync status, agent connection, `current_presentation_id`)                                     |
| `local_agents`           | Agent registrati con IP LAN + heartbeat                                                                                      |
| `activity_log`           | Audit trail completo (Realtime disabilitato, polling 10s)                                                                    |
| `paired_devices`         | PC sala paired con `pair_token_hash` + status realtime + `role` ('room' default \| 'control_center') — Sprint S-4            |
| `pairing_codes`          | Codici 6 cifre TTL 10min, single-use                                                                                         |
| `pair_claim_rate_events` | Rate-limit anti-bruteforce su `pair-claim` (5/15min per IP hash, accesso solo `service_role`) — Fase 14                      |
| `team_invitations`       | Inviti email per nuovi membri tenant; token 7gg — Sprint 1 / Fase 14                                                         |
| `email_log`              | Idempotenza email (Sprint 7), UPSERT da `log_email_sent`                                                                     |
| `tenant_data_exports`    | Storico export GDPR (Sprint 7), signed URL 7gg + status                                                                      |

### 7.2 Migration files (in ordine)

| Migration                                                | Cosa fa                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `20250411090000_init_slide_center.sql`                   | Schema core (11 tabelle base + RLS + trigger)                                                      |
| `20250415120000_pairing_super_admin.sql`                 | `super_admin` enum + `paired_devices` + `pairing_codes` + RLS                                      |
| `20250415120100_quotas_enforcement.sql`                  | Trigger `check_storage_quota` + `update_storage_used`                                              |
| `20250415130000_handle_new_user_tenant.sql`              | Auto-provisioning tenant al signup                                                                 |
| `20250415140000_phase1_2_hardening.sql`                  | `super_admin_all` policies + quota enforcement                                                     |
| `20250416090000_phase3_upload_portal.sql`                | Bucket `presentations` + RPC upload TUS                                                            |
| `20250416120000_network_mode.sql`                        | ENUM `network_mode` su `events`                                                                    |
| `20250416120100_tenant_suspended.sql`                    | Colonna `tenants.suspended`                                                                        |
| `20250416140300_phase14_pair_claim_rate_limit.sql`       | Rate-limit `pair-claim`                                                                            |
| `20250416140301_phase14_rls_tenant_suspended.sql`        | RLS granulare con `current_tenant_suspended()`                                                     |
| `20260417100000_team_invitations.sql`                    | Inviti team + Edge Function `team-invite-accept`                                                   |
| `20260417110000_admin_uploads_and_move_presentation.sql` | Upload admin diretto + `rpc_move_presentation`                                                     |
| `20260417120000_tenant_license_sync.sql`                 | `licensing_apply_quota` SECURITY DEFINER + Edge Function `licensing-sync` (Sprint 4)               |
| `20260417130000_onboarding_and_demo_seed.sql`            | `tenants.onboarded_at` + 5 RPC seed/clear demo (Sprint 6)                                          |
| `20260417140000_sprint7_operations.sql`                  | `email_log` + `tenant_data_exports` + 8 RPC GDPR/email/storage                                     |
| `20260417150000_sprint8_tenant_audit.sql`                | `list_tenant_activity` RPC + 2 indici composti (Sprint 8)                                          |
| `20250417090000_phase4_versioning.sql`                   | `rpc_set_current_version`, `rpc_update_presentation_status`, `guard_versions_immutable`            |
| `20260418080000_room_device_upload_enum.sql`             | Enum `upload_source += 'room_device'` + `actor_type += 'device'` (Sprint R-3)                      |
| `20260418080100_room_device_upload_rpcs.sql`             | 3 RPC `init/finalize/abort_upload_version_for_room_device` (Sprint R-3)                            |
| `20260418090000_paired_devices_role.sql`                 | `paired_devices.role TEXT CHECK ('room','control_center')` + RPC `update_device_role` (Sprint S-4) |

### 7.3 RPC SECURITY DEFINER notevoli

| RPC                                                                                          | Scope                 | Cosa fa                                                                               |
| -------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `validate_upload_token(token)`                                                               | anon                  | Valida token speaker, ritorna metadata                                                |
| `init_upload_version(...)`                                                                   | anon                  | Apre `presentation_versions` in `uploading` per speaker                               |
| `finalize_upload_version(...)`                                                               | anon                  | Chiude upload speaker, marca `ready`, aggiorna `current_version_id`                   |
| `abort_upload_version(...)`                                                                  | anon                  | Aborto upload speaker, no decrement quota                                             |
| `init_upload_version_admin(...)`                                                             | authenticated         | Stessa cosa per admin/coordinator drag-and-drop                                       |
| `finalize_upload_version_admin(...)`                                                         | authenticated         | Idem                                                                                  |
| `abort_upload_version_admin(...)`                                                            | authenticated         | Idem                                                                                  |
| `rpc_move_presentation(p_presentation_id, p_target_speaker_id)`                              | authenticated         | Sposta presentation tra speaker stesso evento                                         |
| `rpc_set_current_version(...)`                                                               | authenticated         | Atomic: imposta corrente, demota altre `ready`, riattiva `superseded`                 |
| `rpc_update_presentation_status(...)`                                                        | authenticated         | Workflow review con note revisore                                                     |
| `rpc_reorder_sessions(...)`                                                                  | authenticated         | Drag-and-drop persistenza `display_order`                                             |
| `licensing_apply_quota(...)`                                                                 | service_role          | Sync quota dal Live WORKS APP (Sprint 4)                                              |
| `admin_create_tenant_with_invite(...)`                                                       | super_admin           | Crea tenant + invito primo admin in transazione atomica (Sprint R-1)                  |
| `record_lemon_squeezy_event(...)`                                                            | service_role          | Idempotency check + INSERT log evento Lemon Squeezy (Sprint R-2)                      |
| `mark_lemon_squeezy_event_processed(...)`                                                    | service_role          | Marca esito processing evento Lemon Squeezy (Sprint R-2)                              |
| `lemon_squeezy_apply_subscription_event(...)`                                                | service_role          | Crea/aggiorna/sospende tenant da subscription\_\* events (Sprint R-2)                 |
| `init_upload_version_for_room_device(p_token, p_session_id, ...)`                            | service_role          | PC sala: apre version 'uploading', validazione cross-room (Sprint R-3)                |
| `finalize_upload_version_for_room_device(p_token, p_version_id, p_sha256)`                   | service_role          | PC sala: promuove a 'ready' + supersedes altre versions (Sprint R-3)                  |
| `abort_upload_version_for_room_device(p_token, p_version_id)`                                | service_role          | PC sala: marca version 'failed' su cancel/error client (Sprint R-3)                   |
| `update_device_role(p_device_id, p_new_role)`                                                | authenticated         | Promuove/demuove device tra 'room' / 'control_center', RLS tenant-scoped (Sprint S-4) |
| `seed_demo_data()` / `clear_demo_data()`                                                     | authenticated         | Onboarding demo (Sprint 6)                                                            |
| `mark_tenant_onboarded()` / `reset_tenant_onboarding()`                                      | authenticated         | Wizard onboarding (Sprint 6)                                                          |
| `tenant_health()`                                                                            | super_admin           | Counter aggregati globali (Sprint 6)                                                  |
| `export_tenant_data()`                                                                       | authenticated (admin) | GDPR export ZIP (Sprint 7)                                                            |
| `tenant_storage_summary()`                                                                   | authenticated         | Threshold warning >=80% / critical >=95% (Sprint 7)                                   |
| `tenant_license_summary()`                                                                   | authenticated         | Threshold info <=30 / warning <=7 / critical <=1 (Sprint 7)                           |
| `create_tenant_data_export()`                                                                | authenticated (admin) | Apre record export, rate-limit 5min (Sprint 7)                                        |
| `list_tenant_data_exports()`                                                                 | authenticated         | Ultimi 10 export del tenant (Sprint 7)                                                |
| `log_email_sent(...)`                                                                        | service_role          | UPSERT idempotente su `email_log` (Sprint 7)                                          |
| `list_tenants_for_license_warning(min,max,kind)`                                             | super_admin           | Anti-spam scan licenze in scadenza (Sprint 7)                                         |
| `expire_old_data_exports()`                                                                  | super_admin           | Housekeeping ZIP scaduti (Sprint 7)                                                   |
| `list_tenant_activity(p_from, p_to, p_action, p_actor_id, p_entity_type, p_limit, p_offset)` | authenticated (admin) | Audit log paginato + filtri (Sprint 8)                                                |

### 7.4 Trigger principali

- `enforce_storage_quota` BEFORE INSERT su `presentation_versions` → `check_storage_quota()` (considera `storage_limit_bytes < 0` come illimitato)
- `track_storage_used` AFTER INSERT/DELETE su `presentation_versions` → aggiorna `tenants.storage_used_bytes`
- `on_auth_user_created` su `auth.users` → `handle_new_user()` (provisioning tenant)
- `tenant_apply_expiry` su UPDATE `tenants` → marca `suspended=true` se `expires_at < now()` (Sprint 4)
- `guard_versions_immutable` BEFORE UPDATE su `presentation_versions` → blocca modifiche ai campi identita/path

### 7.5 Realtime publication

Attivo su: `room_state`, `presentation_versions`, `local_agents`, `paired_devices`, `presentations`. **NON** su `activity_log` (polling 10s) ne su `tenants`/`users`.

### 7.6 SQLite locale (Tauri Desktop)

Schema mirror essenziale di Postgres, single-tenant (no `tenant_id`). Tabelle: `events`, `rooms`, `sessions`, `speakers`, `presentations`, `presentation_versions`, `room_state`, `paired_devices`, `activity_log`, `device` (riga unica con device_token + role + admin_server_url). Modalita WAL per concurrent reads. Path: `~/SlideCenter/<eventId>/db.sqlite`.

### 7.7 Tipi TypeScript

`packages/shared/src/types/database.ts` — generato da `supabase gen types typescript --local`. Aggiornare dopo ogni migration nuova. Le directory `supabase/migrations/` sono in `.prettierignore` per evitare alterazioni del SQL.

---

## 8. Storage layout

### 8.1 Cloud (Supabase Storage)

| Bucket           | Visibilita | Path pattern                                                               | Vita                 |
| ---------------- | ---------- | -------------------------------------------------------------------------- | -------------------- |
| `presentations`  | privato    | `tenants/{tenant_id}/events/{event_id}/presentations/{id}/v{n}/{filename}` | persistente          |
| `tenant-exports` | privato    | `tenants/{tenant_id}/exports/{uuid}.zip`                                   | 7gg (TTL signed URL) |

### 8.2 Desktop locale

```
~/SlideCenter/
  device.json                 # device_token + role + admin_server_url + event_id + room_id
  <eventId>/
    db.sqlite                 # mirror Postgres, WAL
    storage/
      <salaName>/
        <sessioneName>/
          <fileName>          # file effettivo, scritto da downloader
    logs/                     # log Tauri (rotated)
```

### 8.3 PC sala (PWA)

File scritti tramite **File System Access API (FSA)** in cartella scelta dal tecnico al primo avvio (handle persistito in IndexedDB origin). Path logico: `<root>/<sala>/<sessione>/<filename>`. Mai signed URL diretti per `<video>`/`<img>`/`<iframe>` — sempre blob da FSA (vedi §11).

---

## 9. Pairing dispositivi (Device Flow)

### 9.1 Flusso (RFC 8628 adattato)

```
ANDREA (dashboard)           PC SALA                 SUPABASE
       |                        |                        |
       | "+ Aggiungi PC"        |                        |
       |--------- Edge Function pair-init -------------->|
       |<--- codice "847291" + QR ----------------------|
       |                        |                        |
       | mostra codice + QR     | Tecnico apre           |
       |                        | app.liveslidecenter.com|
       |                        | /pair → digita 847291  |
       |                        |--- pair-claim -------->|
       |                        |<-- JWT permanente -----|
       |                        |                        |
       |--- pair-poll --------->| ok, consumed           |
       |<-- "PC1 connesso!" ----|                        |
       |                        |                        |
       | "Assegna a sala?"      | redirect /sala/:token  |
       | sceglie Auditorium A   | mostra UI sala         |
```

### 9.2 Edge Functions

| Funzione                | Trigger                          | Azione                                                                            |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| `pair-init`             | Andrea clicca "+ Aggiungi PC"    | Genera codice 6 cifre, salva in `pairing_codes`, ritorna codice + QR URL          |
| `pair-claim`            | Tecnico digita codice su `/pair` | Valida codice + rate-limit 5/15min IP, crea `paired_devices`, JWT, marca consumed |
| `pair-poll`             | Dashboard polling ogni 2s        | Ritorna stato: pending/consumed con info device                                   |
| `cleanup-expired-codes` | pg_cron ogni ora                 | Elimina codici scaduti da > 1 giorno                                              |

### 9.3 Sicurezza pairing

- Codice 6 cifre numerico, scadenza 10 minuti, single-use.
- Rate limit: 5 tentativi per IP per finestra di 15 minuti (`pair_claim_rate_events`, IP hash SHA-256, cleanup automatico 2x finestra).
- HTTPS only, nessun `client_secret` distribuito.
- JWT permanente con hash salvato in `paired_devices.pair_token_hash`.
- Andrea puo revocare JWT dalla dashboard (forza ri-pairing).

### 9.4 Discovery LAN (modalita desktop intranet)

Cascata 4-tier (Sprint L):

1. **UNC**: `\\<host>\SlideCenter$\agent.json` (se share Windows configurato)
2. **UDP broadcast**: `255.255.255.255:9999` con query `slide-center` → server risponde JSON `{ip, port, version, hostname}`
3. **mDNS**: browse `_slide-center._tcp.local.` con `mdns-sd` 0.13
4. **IP manuale**: input nell'UI Tauri Desktop (fallback rescue)

Cache 60s persistita in `device.json` per evitare re-discovery a ogni richiesta.

### 9.5 Reset / cambio sala

- **Tecnico**: menu Room Player → "Cambia sala" / "Disconnetti PC" / "Forza re-sync"
- **Andrea**: lista PC → riassegna sala / revoca JWT / rinomina PC

---

## 10. Flussi end-to-end

### 10.1 Upload relatore (cloud)

```
Relatore → /u/{token} → TUS resumable su Supabase Storage → Edge Function:
  → init_upload_version (anon) crea riga uploading
  → upload chunked TUS, hash SHA-256 client streaming
  → finalize_upload_version (anon) marca ready, aggiorna current_version_id
  → emette Realtime event su presentations + presentation_versions
  → logga in activity_log
```

### 10.2 Sync cloud → PWA sala (modalita A)

```
Supabase Realtime → PWA subscription
  → nuova versione → genera signed URL (5 min)
  → download streaming → FSA write su disco PC sala
  → overlay verde "Sul disco"
  → MAI lettura da signed URL diretto per <video>/<img>/<iframe>
```

### 10.3 Sync admin → sala (modalita B desktop intranet)

```
Tauri Desktop ADMIN:
  Axum endpoint POST /api/v1/sync/push (HMAC-firmato)
  → broadcast LAN fan-out a tutti i PC sala paired
  → SQLite update locale
PC sala (Tauri Desktop SALA):
  Long-poll GET /api/v1/sync/long-poll (timeout 30s)
  → ricevuto delta → download file via signed URL HMAC LAN
  → scrive su disco LOCALE PRIMA di aprirlo
```

### 10.4 Modalita LIVE / TURBO / AUTO (Sprint A)

Stato globale `playbackMode: 'auto' | 'live' | 'turbo'` in `RoomPlayerView.tsx` (persistito in localStorage `sc:rp:playbackMode`).

| Modalita | Polling | Concurrency download | Throttle download | Quando usarla                       |
| -------- | ------- | -------------------- | ----------------- | ----------------------------------- |
| AUTO     | 12s     | 1                    | nessuno           | Default, balance perfetto           |
| LIVE     | 60s     | 1                    | 50ms ogni 4MB     | Durante presentazione live, no jank |
| TURBO    | 5s      | 3                    | nessuno           | Sync iniziale, prima dell'evento    |

Implementazione `apps/web/src/features/devices/RoomPlayerView.tsx` + `apps/web/src/features/devices/hooks/useFileSync.ts` + `apps/web/src/lib/fs-access.ts` (con prop `priority: 'high'|'low'|'auto'` su `fetch`).

### 10.5 Scenari offline

| Scenario                | Comportamento            | Indicatore UI                  |
| ----------------------- | ------------------------ | ------------------------------ |
| Cloud + LAN OK          | Sync completo            | Verde: "v4 di 4 — Sync 14:32"  |
| Cloud OK, Agent offline | PWA cloud diretto        | Verde: "CLOUD DIRECT"          |
| Cloud offline, Agent OK | Agent serve cache        | Giallo: "LAN ONLY"             |
| Tutto offline           | PWA cache locale         | Rosso: "OFFLINE — v3 in cache" |
| Agent torna online      | Pull automatico mancanti | Giallo → Verde                 |

Hook: `apps/web/src/features/devices/hooks/useConnectivityMode.ts` (polling 15s su Local Agent health).

### 10.6 Auto-rejoin desktop

Sprint M: alla riapertura dell'app desktop, lettura di `~/SlideCenter/device.json` → discovery 4-tier admin server → re-pair automatico via `device_token` (no codice 6 cifre richiesto). Se discovery fallisce, banner "Admin server non raggiungibile, ritento ogni 30s".

### 10.7 Modalita LIVE su streaming hot-swap

Durante un cambio presentazione live (operatore clicca "Manda in onda" su una slide), il flusso e:

1. UI admin → POST a `room_state` (`current_presentation_id` = X)
2. Realtime push a Room Player
3. Room Player **NON scarica**, perche il file e gia su disco (download avvenuto prima)
4. Apre il file dal path locale (FSA o filesystem nativo)
5. Tempo "click → schermo" target: < 500ms

---

## 11. Enforcement regola sovrana #2 (file da locale)

> "I file partono SEMPRE dal PC locale che li proietta. Cloud e LAN sono solo per la sincronizzazione."

Questo NON e un dogma estetico: e l'unica garanzia che durante un evento live, **se la rete cade, il video non si interrompe a meta**. La regola e applicata programmaticamente in 6 zone:

| Zona                     | Strumento di enforcement                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anteprima inline PC sala | Hook `useFilePreviewSource({ enforceLocalOnly: true })` rifiuta `mode !== 'local'` con `sovereignViolation` (errore i18n + console.error con stack) |
| Download e cache PC sala | `useFileSync` scrive su FSA e rilegge SOLO da FSA per `<video>`/`<img>`/`<iframe>` (mai signed URL diretti)                                         |
| LAN download (Sprint N)  | `signLanDownloadUrl` ritorna URL HMAC che il client salva su disco PRIMA di aprirlo, mai stream diretto                                             |
| Hybrid sync (Sprint Q)   | Worker push-only: il desktop e sempre master, il cloud non puo rispondere a una `getFile()`                                                         |
| Lint statico             | Naming convention: hook che leggono dal cloud iniziano con `createXxxRemote` / `fetchXxxRemote` (visibilita)                                        |
| Test runtime             | Smoke test (Sprint FT) verifica `/info.role`: se `sala`, blocca qualsiasi tentativo di proxy verso Internet                                         |

### 11.1 Hook `useFilePreviewSource`

File: `apps/web/src/features/presentations/hooks/useFilePreviewSource.ts`

Prop chiave:

```typescript
export interface UseFilePreviewSourceArgs {
  enabled: boolean;
  mode: 'local' | 'remote';
  dirHandle?: FileSystemDirectoryHandle | null;
  segments?: string[];
  filename?: string;
  storageKey?: string;
  /**
   * Guard regola sovrana §0.2 — quando `true`, l'hook rifiuta `mode !== 'local'`.
   * Da impostare a `true` in tutti i wrapper PC sala (Room Player, anteprima
   * "in onda", futuro "Apri sul PC"). Default `false` per non rompere chiamate
   * admin esistenti che hanno bisogno di `mode: 'remote'`.
   */
  enforceLocalOnly?: boolean;
}
```

Quando `enforceLocalOnly: true && mode !== 'local'`, l'hook:

1. Logga `console.error` con stack e contesto (mode, hasDirHandle, hasFilename, storageKeyPresent)
2. Imposta `error: 'sovereignViolation'`
3. Ritorna immediatamente senza fare network calls

Wrapper PC sala che ATTIVANO il guard: `apps/web/src/features/devices/RoomPlayerView.tsx` → `RoomPreviewDialogContainer` passa `enforceLocalOnly: true`.

Chiavi i18n (parity IT/EN):

- IT: `"sovereignViolation": "Errore interno: il PC sala deve leggere i file SEMPRE dalla cartella locale, mai dalla rete. Segnala il bug a Live Software."`
- EN: `"sovereignViolation": "Internal error: the room PC must ALWAYS read files from its local folder, never from the network. Please report this bug to Live Software."`

### 11.2 Quando applicare il guard

Quando si aggiunge una feature che tocca i file (anteprima, riproduzione, ZIP, condivisione), **applicare `enforceLocalOnly`** in tutti i wrapper PC sala. Il guard NON e una protezione di sicurezza (l'utente puo aprire devtools) ma una **rete di sicurezza contro regressioni**: se un dev futuro per errore aggancia il Room Player a un signed URL, l'utente vede subito un errore chiaro invece di un video che si interrompe a meta evento.

---

## 12. Sistema licenze (Lemon Squeezy → Live WORKS APP → Slide Center)

### 12.1 Catena di sync

```
[Cliente checkout]
   ↓ Lemon Squeezy webhook (HMAC SHA-256)
[Live WORKS APP — Firebase Functions]
   ↓ generateLicenseKey + onLicenseChangedSyncSlideCenter trigger
   ↓ POST HMAC SHA-256 (anti-replay timestamp)
[Supabase Edge Function `licensing-sync`]
   ↓ verifica HMAC con SLIDECENTER_LICENSING_HMAC_SECRET
   ↓ chiama RPC `licensing_apply_quota` (service_role)
[Slide Center Postgres]
   ↓ trigger tenant_apply_expiry
[Slide Center tenant — quote applicate]
```

Single source of truth: Lemon Squeezy → Live WORKS APP. **Mai** un secondo webhook su Slide Center (causerebbe race condition + doppia fonte). ADR-013.

### 12.2 SKU prodotti

| SKU                       | Cosa licenzia                                            | Pricing tipico             |
| ------------------------- | -------------------------------------------------------- | -------------------------- |
| `slide-center-cloud`      | Tenant cloud Slide Center (piano Starter/Pro/Enterprise) | €149-€990/mese             |
| `slide-center-agent`      | Local Agent (mini-PC regia, 1 attivazione/evento)        | €490 una tantum            |
| `slide-center-room-agent` | Room Agent (PC sala, N attivazioni/evento)               | €190 una tantum            |
| `slide-center-suite`      | Bundle Cloud + Local + 5 Room                            | €1.500 una tantum + canone |

### 12.3 Client Tauri (Sprint 4)

Modulo `src/license/` (7 file Rust, ~600 LOC) duplicato **identico** in `apps/agent/src-tauri/src/license/` e `apps/room-agent/src-tauri/src/license/`. **NON** un crate Cargo condiviso per 3 motivi (vedi ADR-012):

1. Chiavi AES-256-GCM diverse per agent (impedisce copy/paste `license.enc`)
2. `PRODUCT_ID` + `APP_DATA_DIR` distinti (isolamento filesystem)
3. Evitare ristrutturazione invasiva del Cargo workspace dentro pnpm monorepo

**Compile-time gating:** feature Cargo `license` opzionale.

- Build dev: `cargo tauri build` (UI nasconde card e overlay)
- Build vendita: `cargo tauri build --features license` (include `aes-gcm`, `wmi`, `sha2`, `reqwest`, `dirs`, `chrono`)

**API client camelCase** (allineato a `Live WORKS APP/functions/src/types/index.ts`): `verifyBeforeDate`, `nextVerifyDate`, `expiresAt`, `pendingApproval`, `customerName`. Token opaco HMAC-SHA256 server-side, memorizzato cifrato AES-256-GCM in `license.enc`.

**Hook NSIS pre-uninstall**: l'eseguibile riconosce flag CLI `--deactivate` come early-return. `installer-hooks.nsi` chiama `<agent>.exe --deactivate` prima di rimuovere file → libera slot hardware su Live WORKS APP.

**Fingerprint hardware Windows**: SHA-256 di `MotherboardSerial || ProcessorId || DiskSerial` via WMI (`wmi` crate). Pattern identico a `Live 3d Ledwall Render/src-tauri/src/license/fingerprint.rs`.

**Grace period offline**: 30gg dopo ultima `verify` riuscita. UI mostra warning gialli da T-7 a T-1, errore rosso a scadenza.

### 12.4 UI gating

- Card "Licenza" in `apps/{agent,room-agent}/ui/index.html` con input chiave + status pill + bottoni Attiva/Disattiva/Verifica/Copia fingerprint + dettagli cliente/scadenza.
- Overlay full-screen di gating quando licenza non valida (blocca tutto).
- Polling 30s per stato `pendingApproval`.
- i18n IT/EN dinamico via `navigator.language`, fallback grazioso se feature `license` non compilata.

---

## 13. Modulo apps/web

### 13.1 Mappa rotte

| Rotta                   | Componente                                                                 | Accesso                  | Auth               |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------ | ------------------ |
| `/`                     | `DashboardView`                                                            | Tenant (autenticato)     | JWT tenant         |
| `/events`               | `EventsView` — lista + creazione evento                                    | Tenant                   | JWT tenant         |
| `/events/:eventId`      | `EventDetailView` — sale/sessioni/relatori/PC sala/regia/export            | Tenant                   | JWT tenant         |
| `/team`                 | `TeamView` — utenti tenant, invita membro, revoca inviti pendenti          | Admin tenant             | JWT admin          |
| `/storage`              | `StorageView`                                                              | Tenant                   | JWT tenant         |
| `/billing`              | `BillingView` (piano/quote, confronto piani, checkout Lemon da env)        | Admin tenant             | JWT admin          |
| `/settings`             | `SettingsView` (lingua UI IT/EN, demo data, integrazioni)                  | Tenant                   | JWT tenant         |
| `/settings/privacy`     | `PrivacyView` (GDPR export, cancellazione, note legali)                    | Admin tenant             | JWT admin          |
| `/audit`                | `AuditView` — audit log tenant paginato (Sprint 8)                         | Admin tenant             | JWT admin          |
| `/admin`                | `AdminDashboardView` — statistiche aggregate                               | Solo `super_admin`       | JWT super_admin    |
| `/admin/tenants`        | `AdminTenantsView` elenco tenant                                           | Solo `super_admin`       | JWT super_admin    |
| `/admin/tenants/:id`    | `AdminTenantDetailView` quote, sospensione, team, eventi, log              | Solo `super_admin`       | JWT super_admin    |
| `/admin/audit`          | `AdminAuditView` log cross-tenant                                          | Solo `super_admin`       | JWT super_admin    |
| `/admin/health`         | `AdminHealthView` — Supabase ping, Edge ping, counter aggregati (Sprint 6) | Solo `super_admin`       | JWT super_admin    |
| `/status`               | `StatusView` — pagina pubblica stato servizio (Sprint 8)                   | Pubblico                 | Nessuna            |
| `/pair`                 | `PairView` — tastierino codice 6 cifre                                     | Pubblico (tecnico)       | Nessuna            |
| `/sala/:token`          | `RoomPlayerView` — PWA file manager con FSA + `enforceLocalOnly`           | PC sala paired           | JWT sala (pairing) |
| `/u/:token`             | `UploadPortalView` — upload relatore TUS + SHA-256                         | Speaker esterno          | `upload_token`     |
| `/accept-invite/:token` | `AcceptInviteView` — accetta invito, crea utente con tenant predefinito    | Pubblico (token email)   | `invite_token`     |
| `/forgot-password`      | `ForgotPasswordView` — `auth.resetPasswordForEmail()`                      | Pubblico                 | Nessuna            |
| `/reset-password`       | `ResetPasswordView` — form nuova password                                  | Pubblico (link Supabase) | Recovery link      |
| `/login`                | `LoginView`                                                                | Pubblico                 | Nessuna            |
| `/signup`               | `SignupView`                                                               | Pubblico                 | Nessuna            |

### 13.2 Feature folders

```
apps/web/src/
├── app/                    # routes, layouts (root + admin)
├── components/             # ToastProvider, AppBrandLogo, ErrorBoundary, RequireAuth, RequireSuperAdmin, RequireTenantAdmin
├── features/
│   ├── auth/               # Login, Signup, ForgotPassword, ResetPassword, AcceptInvite, lib/wait-for-tenant-jwt.ts
│   ├── audit/              # AuditView (Sprint 8)
│   ├── admin/              # AdminDashboardView, AdminTenantsView, AdminTenantDetailView, AdminAuditView, AdminHealthView
│   ├── billing/            # BillingView + TenantQuotaPanel
│   ├── dashboard/          # DashboardView (Sprint 7 con card reali)
│   ├── devices/            # RoomPlayerView, RoomDevicesPanel, hooks/{useFileSync, useConnectivityMode, usePairingFlow, useDeviceToken}, repository.ts
│   ├── events/             # EventsView, EventDetailView, EventExportPanel, RoomsPanel, SessionsPanel, SpeakersPanel, LiveRegiaView
│   ├── notifications/      # TenantWarningBanners + repository + useTenantWarnings hook (Sprint 7)
│   ├── onboarding/         # OnboardingGate, OnboardingWizard (Sprint 6)
│   ├── presentations/      # FilePreviewDialog, useFilePreviewSource, AdminUploaderInline, MovePresentationDialog, PresentationVersionsPanel
│   ├── settings/           # SettingsView + privacy/PrivacyView (Sprint 7)
│   ├── status/             # StatusView (Sprint 8)
│   ├── storage/            # StorageUsagePanel
│   ├── team/               # TeamView (Sprint 1 / Fase 14)
│   └── upload/             # UploadPortalView + tus client
├── lib/
│   ├── supabase.ts         # createClient<Database>() singleton
│   ├── backend-mode.ts     # detect cloud/desktop/hybrid
│   ├── backend-client.ts   # dispatcher Supabase JS vs Rust REST mirror
│   ├── realtime-client.ts  # dispatcher Supabase Realtime vs LAN long-poll
│   ├── fs-access.ts        # File System Access API helpers + `priority`/`throttle`
│   ├── i18n.ts             # initI18n + LanguageDetector
│   └── init-sentry.ts      # lazy import @sentry/react
└── main.tsx                # ErrorBoundary + unhandledrejection listener + Providers
```

### 13.3 Quote piano (UI read-only)

Pannello in `/events` (storage + eventi/mese in mese di calendario locale corrente vs `max_events_per_month`) e in `/events/:eventId` (storage + sale per evento vs `max_rooms_per_event`). Soft block del submit form se quota saturata. Valori effettivi nel DB; nessun enforcement server-side aggiuntivo su INSERT `events`/`rooms` (solo storage hard-blocked da trigger).

### 13.4 Dual-mode runtime

Edge Function `room-player-bootstrap` legge `events.network_mode`:

- **cloud**: solo signed URL Supabase
- **intranet**: HTTP verso Local Agent `GET /api/v1/files/{event_id}/{filename}` (errore esplicito se nessun agent registrato)
- **hybrid**: tentativo LAN poi fallback cloud

Cache PWA: Workbox NetworkFirst su `*.supabase.co` e su path signed Storage; manifest file in `localStorage` come ripiego offline.

---

## 14. Modulo apps/desktop (Tauri 2 + Axum + SQLite)

### 14.1 Architettura

```
apps/desktop/
├── package.json                       # @slidecenter/desktop, scripts: dev, build, release:nsis
├── src-tauri/
│   ├── Cargo.toml                     # tauri 2 + axum + rusqlite + tokio + serde + mdns-sd + ...
│   ├── tauri.conf.json                # bundle.targets:["nsis"], updater enabled, hooks Win11
│   ├── installer-hooks.nsi            # firewall TCP 7300/7301, Defender, profilo Privato, WebView2
│   ├── icons/                         # alpha-channel RGBA verificate
│   ├── build.rs
│   └── src/
│       ├── main.rs                    # bootstrap + flag --deactivate (NSIS pre-uninstall)
│       ├── lib.rs
│       ├── server.rs                  # Axum bind + routes
│       ├── routes/
│       │   ├── auth.rs                # /api/v1/auth/* (device pairing LAN)
│       │   ├── files.rs               # /api/v1/files/* (signed URL HMAC LAN)
│       │   ├── sync.rs                # /api/v1/sync/{push, long-poll}
│       │   ├── info.rs                # /info (role, version, lan_ip, port)
│       │   └── health.rs              # /health (smoke test target)
│       ├── db.rs                      # rusqlite WAL pool
│       ├── state.rs                   # AppState shared
│       ├── discovery.rs               # mDNS responder + UDP broadcast advertiser
│       ├── motw.rs                    # rimuove Mark-of-the-Web post-download (sala only)
│       ├── downloader.rs              # tokio streaming + atomic rename .part → file
│       ├── role_picker.rs             # primo boot: choose admin vs sala
│       └── updater.rs                 # Tauri updater + banner
├── scripts/
│   ├── smoke-test.mjs                 # Node 22 script (curl /health, /info, /rest, firewall, mdns, disk)
│   └── smoke-test.ps1                 # PowerShell wrapper
└── ui/                                # WebView punta a apps/web build, no UI custom qui
```

### 14.2 Boot flow

1. App apre → controlla `~/SlideCenter/device.json`
2. Se non esiste: `role_picker.rs` mostra dialog "Sei admin (regia) o sala?"
3. Se admin: bind Axum su `0.0.0.0:7300`, advertise mDNS, scrivi `device.json` con `role=admin`
4. Se sala: bind Axum su `127.0.0.1:7301`, fai discovery 4-tier dell'admin, pair-claim LAN, salva `device.json` con `role=sala` + `admin_server_url` + `device_token`
5. Apri WebView puntato a `http://127.0.0.1:7300/` (admin) o a `https://app.liveslidecenter.com/sala/<token>` con `?backend=lan&adminUrl=<url>` (sala)
6. SPA React si avvia, `backend-mode.ts` rileva `?backend=lan` → usa `backend-client.ts` REST mirror invece di Supabase JS

### 14.3 Persistenza & resilienza

- `device.json` scritto atomico (`tempfile + rename`) per evitare corruzione su crash
- SQLite WAL per concurrent reads (sync engine + UI query)
- Handle FSA salvato in IndexedDB del WebView (origin: `tauri://localhost`)
- Auto-rejoin al boot tramite `device_token` (no codice 6 cifre, gia paired in passato)

### 14.4 Smoke test (Sprint FT)

Script `scripts/smoke-test.mjs`:

- `health` → GET `/health` ritorna `{ ok: true, role, version }`
- `info` → GET `/info` ritorna `{ role, lan_addresses[], port, version, hostname }`
- `rest` → GET `/api/v1/sync/long-poll?since=0` ritorna 200 (anche vuoto)
- `firewall` → `netstat -ano | findstr :7300` per admin / `:7301` per sala
- `mdns` → almeno un IPv4 NON-loopback in `lan_addresses`
- `rtt` → 5 round-trip su `/health`, mediana < 50ms (warn se > 50ms)
- `disk` → > 20GB liberi su `~/SlideCenter`
- `installer` → presenza installer NSIS in `release/` (warn-only su sale)

Output: console + JSON in `Documents\SlideCenterFieldTest\<host>_<timestamp>.json` per allegare al feedback.

### 14.5 Build & distribuzione

```powershell
# Da repo root
pnpm --filter @slidecenter/desktop release:nsis

# Output: apps/desktop/src-tauri/target/release/bundle/nsis/Live SLIDE CENTER Desktop_<ver>_x64-setup.exe
```

Tempo: 5-10 min al primo build, 1-2 min ai successivi (cache Rust).

---

## 15. Modulo apps/agent + apps/room-agent (Local/Room Agent storici)

Questi due binari **PRECEDONO** `apps/desktop` (sono nati nelle Fasi 7-9, prima della consolidazione Sprint J-P della Fase 15). Restano valide e in produzione per scenari intranet "puro" dove:

- I PC sala usano **browser Chrome/Edge** (Room Player PWA `/sala/:token`)
- C'e bisogno di un **mini-PC dedicato** in regia che fa solo da Local Agent (no UI complessa)
- Si vuole separare licensing del Local Agent (€490) dal Room Agent (€190 per PC sala)

### 15.1 Local Agent (`apps/agent/`)

Stack: Tauri 2 + Axum bind `0.0.0.0:8080` + rusqlite WAL + reqwest sync engine. UI HTML standalone (no React, dashboard stato + sync manuale).

Discovery responder: UDP `:9999` (rispondendo a query "slide-center" con announcement JSON `{ip, port, version, hostname}`) + advertiser mDNS su `_slide-center._tcp.local.` (thread dedicato `std::thread::Builder` per disaccoppiare dal runtime tokio).

Deps notevoli: `mdns-sd` 0.13, `local-ip-address` 0.6, `gethostname` 0.5.

Licenze: `PRODUCT_ID="slide-center-agent"`, `APP_DATA_DIR="com.livesoftware.slidecenter.agent"`. Vedi §12.3.

Build: `apps/agent/scripts/{clean,post-build}.mjs` → output `release/live-slide-center-agent/`.

### 15.2 Room Agent (`apps/room-agent/`)

Stack: Tauri 2 lite + reqwest polling LAN ogni 5s + tokio async download + autostart HKCU + tray icon (verde sync / giallo download / rosso offline).

Persistenza: `C:\Users\<user>\AppData\Local\SlideCenter\{roomId}\`.

Bypass Windows 11:

- HKCU autostart (no admin)
- Profilo rete "Privato" via `Set-NetConnectionProfile` (una tantum)
- Strip `Zone.Identifier` ADS via `winapi::um::fileapi::DeleteFileW` post-download (`motw.rs`) → no SmartScreen

Discovery 4-tier: UNC → UDP broadcast → mDNS → IP manuale (vedi §9.4). Cache 60s in `state.last_discovery`.

Comandi Tauri: `cmd_discover_agent`, `cmd_set_manual_agent`, `cmd_set_network_private`.

Licenze: `PRODUCT_ID="slide-center-room-agent"`, `APP_DATA_DIR="com.livesoftware.slidecenter.roomagent"`, **chiave AES-256-GCM diversa** (impedisce copy/paste `license.enc` Local↔Room).

Build: `apps/room-agent/scripts/{clean,post-build}.mjs` → output `release/live-slide-center-room-agent/`.

### 15.3 Quando preferire `apps/desktop` vs `apps/agent` + `apps/room-agent`

| Scenario                                                     | Soluzione consigliata                       |
| ------------------------------------------------------------ | ------------------------------------------- |
| Single-site, vogliamo "applicazione completa" su ogni PC     | `apps/desktop` (UI integrata, una sola app) |
| Single-site, mini-PC regia + tanti PC sala con browser       | `apps/agent` + Room Player PWA              |
| Single-site, mini-PC regia + Room Agent leggero su ogni sala | `apps/agent` + `apps/room-agent`            |
| Multi-site cloud-only                                        | Solo `apps/web` (modalita A)                |

Tutte e tre le soluzioni vendono gli **stessi SKU di licenza** (vedi §12.2).

---

## 16. Modulo packages/shared

Cartella `packages/shared/src/`:

- `types/database.ts` — types Supabase generati da CLI
- `constants/plans.ts` — `PLAN_LIMITS` (Trial/Starter/Pro/Enterprise)
- `i18n/locales/{it,en}.json` — bundle parity ~1135 chiavi (Sprint 8)
- `i18n/index.ts` — init i18next + LanguageDetector (localStorage + navigator)
- `hooks/` — hook condivisi tra apps
- `utils/` — `normalizeName`, `sanitizeForFirestore`, helper datetime

Convenzioni i18n:

- Una chiave per stringa, namespacing dot-notation: `audit.filters.action`
- Plurali ICU: `dashboard.events.count` → `{count, plural, one {# evento} other {# eventi}}`
- Verificatore parity in script (Sprint 7): `pnpm i18n:check` confronta keys IT vs EN, fallisce se diff

---

## 17. Edge Functions Supabase

Cartella `supabase/functions/`:

| Funzione                | verify_jwt   | Cosa fa                                                                                                                                                                                                                   |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pair-init`             | true         | Genera codice 6 cifre, salva in `pairing_codes` (Fase 6)                                                                                                                                                                  |
| `pair-claim`            | false        | Tecnico claim del codice + rate limit 5/15min IP hash (Fase 6 + 14)                                                                                                                                                       |
| `pair-poll`             | true         | Dashboard polling stato code (Fase 6)                                                                                                                                                                                     |
| `cleanup-expired-codes` | true         | pg_cron ogni ora, elimina codici scaduti                                                                                                                                                                                  |
| `room-player-bootstrap` | false        | Validazione `device_token` server-side, ritorna network_mode + agent online (Fase 9). Sprint S-4: branch `control_center` con files multi-room. Sprint T-1: ogni file include `versionNumber/versionTotal` per badge sala |
| `team-invite-accept`    | false        | Accetta invito, crea user con tenant + invio welcome email (Sprint 1 + 8)                                                                                                                                                 |
| `gdpr-export`           | true (admin) | ZIP manifest + 10 CSV + signed URL 7gg + record `tenant_data_exports` (Sprint 7)                                                                                                                                          |
| `email-send`            | false        | Resend transactional + idempotency `email_log` + 4 template inline IT/EN (Sprint 7)                                                                                                                                       |
| `email-cron-licenses`   | true (cron)  | Daily scan 3 soglie T-30/T-7/T-1 → dispatch a `email-send` (Sprint 7)                                                                                                                                                     |
| `system-status`         | false        | Probe paralleli Database/Auth/Storage/Edge + soglia degraded 1500ms (Sprint 8)                                                                                                                                            |
| `licensing-sync`        | false        | Riceve POST HMAC SHA-256 da Live WORKS APP, chiama `licensing_apply_quota` (Sprint 4)                                                                                                                                     |

`config.toml`: `verify_jwt = false` per `pair-claim`, `room-player-bootstrap`, `team-invite-accept`, `email-send`, `email-cron-licenses`, `system-status`, `licensing-sync` (tutte server-to-server o pubbliche).

---

## 18. i18n + accessibility

### 18.1 Regola sovrana i18n

Ogni stringa IT ha coppia EN nello **stesso commit**. Mai PR con solo IT o solo EN. Verifica automatica:

```bash
pnpm i18n:check
# Atteso: IT keys: NNNN, EN keys: NNNN (parity OK)
```

### 18.2 Stack

- `i18next` + `react-i18next` + `i18next-browser-languagedetector`
- Bundle in `packages/shared/src/i18n/locales/{it,en}.json`
- Detector: `localStorage` (chiave `i18nextLng`) + `navigator.language` (fallback)
- Init in `apps/web/src/lib/i18n.ts` con `await initI18n()` PRIMA del render

### 18.3 Accessibility

- WAI-ARIA su tutti i componenti shadcn (combobox, dialog, toast)
- Focus trap nei dialog (Radix native)
- Toast `role="status"` (info) / `role="alert"` (error)
- Tasti scorciatoia documentati in `apps/web/src/features/devices/RoomPlayerView.tsx` (LIVE / TURBO / AUTO chip + tooltip)
- Dark mode only (decisione di branding)
- Color contrast WCAG AA su tutte le UI

---

## 19. Quality gates + CI

### 19.1 Pre-commit (manuale o IDE)

```bash
pnpm lint
pnpm typecheck
pnpm --filter @slidecenter/web build
pnpm --filter @slidecenter/desktop build  # solo se tocchi apps/desktop
cargo check --all-features                # se tocchi Rust
cargo clippy --all-features -- -D warnings # se tocchi Rust
```

### 19.2 GitHub Actions

| Workflow                           | Trigger                                                                        | Cosa fa                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`         | PR + push main (paths-ignore docs/\*\*)                                        | Job `web` (Ubuntu, lint+typecheck, ~3min) + `agents-noFeatures` (Ubuntu, cargo check no license, ~10min) + `agents-licensed` (Windows, cargo check con license, ~15min). Concurrency cancel-in-progress.                      |
| `.github/workflows/playwright.yml` | PR su apps/web + push main + nightly cron 0 3 \* \* \* UTC + workflow_dispatch | Setup Supabase locale via `supabase/setup-cli@v1` versione **pinned 2.20.3** (NON `latest`), estrae API_URL+ANON_KEY, install Chromium, run `e2e/smoke.spec.ts --project=chromium`, upload `playwright-report/` retention 7gg |
| `.github/workflows/rls-audit.yml`  | PR + push main su `supabase/**`                                                | Avvia Supabase locale, applica migration, esegue seed minimo `supabase/tests/rls_audit_seed.sql`, esegue `psql -v ON_ERROR_STOP=1 -f rls_audit.sql`. Ogni `[FAIL]` blocca la PR. Upload log come artifact (retention 14gg)    |

**NOTA su `supabase/setup-cli`**: pinato a versione `2.20.3` (rif. supabase/cli#1737 — `latest` ha rotto piu volte `supabase start` su CI).

### 19.3 Sentry sourcemap upload

Script `apps/web/scripts/upload-sourcemaps.mjs` + `postbuild` in `apps/web/package.json`:

- Usa `npx @sentry/cli@latest` (no devDep aggiunta)
- **Skip silenzioso** se `SENTRY_AUTH_TOKEN` non settato (dev locali ok)
- Errore esplicito se token presente ma `SENTRY_ORG`/`SENTRY_PROJECT` mancanti
- Release identifier = `slide-center-web@<pkg-version>+<git-short-sha>` (auto da `git rev-parse`)
- Pipeline: `releases new` → `releases set-commits --auto --ignore-missing` → `upload-sourcemaps --rewrite --url-prefix "~/" --validate` → `releases finalize`
- Cancella `.map` da `dist/` dopo upload (non vanno serviti pubblicamente)

---

## 20. Account, deploy, infrastruttura

### 20.1 Account

| Servizio      | Account                     | Note                                                 |
| ------------- | --------------------------- | ---------------------------------------------------- |
| GitHub        | `live-software11`           | Repo: `github.com/live-software11/Live-SLIDE-CENTER` |
| Supabase      | `live.software11@gmail.com` | Region: EU Francoforte                               |
| Vercel        | `live.software11@gmail.com` | Domini: `app.liveslidecenter.com`                    |
| Sentry        | `live.software11@gmail.com` | Progetto: `slide-center-web`                         |
| Resend        | `live.software11@gmail.com` | Dominio: `liveworksapp.com` (verifica DNS pendente)  |
| Lemon Squeezy | gestito via Live WORKS APP  | Sync via Edge Function `licensing-sync`              |

**Verifica account prima di ogni push:** `gh auth status` → conferma `live-software11`.

### 20.2 Variabili ambiente

`.env` alla root del monorepo (gitignored). Vite legge da `envDir` configurato in `vite.config.ts`.

```bash
# --- Supabase ---
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# --- App ---
VITE_APP_NAME="Live SLIDE CENTER"
VITE_APP_VERSION=0.0.1

# --- Billing (opzionale) ---
# VITE_LEMONSQUEEZY_CHECKOUT_STARTER_URL=
# VITE_LEMONSQUEEZY_CHECKOUT_PRO_URL=
# VITE_LEMONSQUEEZY_CUSTOMER_PORTAL_URL=
# VITE_LIVE_WORKS_APP_URL=https://www.liveworksapp.com

# --- Integrazioni ecosistema (opzionale) ---
# VITE_LIVE_SPEAKER_TIMER_URL=
# VITE_LIVE_CREW_URL=

# --- Osservabilita (opzionale) ---
# VITE_SENTRY_DSN=
```

Secret server-side (Supabase Edge Functions secrets, NON nel repo):

- `SLIDECENTER_LICENSING_HMAC_SECRET` — >=32 char, condiviso con Live WORKS APP
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — Sprint 7
- `EMAIL_SEND_INTERNAL_SECRET` — >=32 char, generato via PowerShell `RandomNumberGenerator`
- `PUBLIC_APP_URL` — `https://app.liveslidecenter.com`
- `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` — postbuild sourcemap upload

### 20.3 Deploy

| Componente       | Strategia                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `apps/web`       | Vercel auto-deploy su push `main`. Preview URL su PR. **Fallback CLI** (vedi §20.3.1).    |
| Edge Functions   | `supabase functions deploy <nome>` da CLI; CI manuale (no auto-deploy intenzionale)       |
| Migrations       | `supabase db push` in produzione (manuale, dopo PR review). NESSUN auto-deploy migration. |
| Tauri Desktop    | Build NSIS → upload manuale a Tauri updater manifest (Vercel)                             |
| Local/Room Agent | Build NSIS → consegna manuale al cliente con licenza                                      |

#### 20.3.1 Vercel — fallback CLI quando l'auto-deploy si blocca

L'integrazione webhook GitHub → Vercel **puo' disconnettersi silenziosamente** (visto in produzione 18/04/2026 — vedi `STATO_E_TODO.md` §0.26). Sintomi: Vercel dashboard mostra "Updated Nd ago" mentre `git log` ha commit recenti; `gh api repos/.../deployments` ritorna vuoto; bundle servito ha hash vecchio.

**Sblocco manuale (1 deploy)** — preferibile dalla root del monorepo, account `livesoftware11-3449`:

```bash
# Una tantum (se Vercel CLI non installato)
npm install -g vercel
vercel whoami       # deve mostrare livesoftware11-3449
vercel link --yes --project live-slide-center

# Per ogni deploy manuale
vercel --prod --yes --archive=tgz
```

**Importante:** `--archive=tgz` e' **obbligatorio** perche' il monorepo ha 17.619 file (oltre il limite 15k file/upload di Vercel API). Il flag fa creare un tarball locale (~1.8GB) e lo carica come archivio singolo. Senza il flag il deploy fallisce con `missing_archive`.

**Risoluzione root** (richiede dashboard Vercel — non automatizzabile via CLI/MCP):

1. [vercel.com/dashboard](https://vercel.com/dashboard) → progetto `live-slide-center` → Settings → Git.
2. Verificare repo connesso `live-software11/live-slide-center` su branch `main`.
3. Se "Disconnected" → click **Connect Git Repository** → autorizzare Vercel sul GitHub `live-software11`.
4. Push trivial (`git commit --allow-empty -m "test ci" && git push`) per validare il webhook.

**Long-term (raccomandato):** workflow GitHub Actions `.github/workflows/vercel-deploy.yml` con `VERCEL_TOKEN` segreto → toglie il single-point-of-failure dell'integrazione webhook.

#### 20.3.2 MCP Vercel ufficiale (debug & monitoring da Cursor)

Aggiunto al file utente `C:\Users\andre\.cursor\mcp.json` il server MCP **`vercel`** (endpoint hosted ufficiale `https://mcp.vercel.com`, OAuth, supportato per Cursor da agosto 2025):

```json
"vercel": {
  "type": "http",
  "url": "https://mcp.vercel.com"
}
```

Tool utili in caso di dubbi su deploy:

- `list_deployments` — verifica readyState ultimi 5 deploy del progetto.
- `get_deployment_build_logs` — log completo build (debug fail pnpm install / Vite / postbuild Sentry).
- `get_deployment_runtime_logs` — runtime errors (5xx, edge functions).
- `get_project` — settings progetto (env vars nome, framework preset, build command).

Procedura attivazione: vedi `docs/Setup_Strumenti_e_MCP.md` §2c. Dettagli operativi: `.cursor/rules/mcp-vercel.mdc`.

### 20.4 Healthcheck

- **Statico**: `apps/web/public/healthcheck.json` per UptimeRobot/BetterUptime/Pingdom puntati su `https://app.liveslidecenter.com/healthcheck.json`
- **Dinamico admin**: `/admin/health` per super_admin con Supabase ping + Edge Functions ping + counter aggregati
- **Pubblico clienti**: `/status` (Sprint 8) con probe paralleli + polling 30s

---

## 21. Piani commerciali e quote

### 21.1 Piani SaaS cloud (DEFINITIVI — devono corrispondere a `packages/shared/src/constants/plans.ts`)

| Piano          | €/mese | Eventi/mese | Sale/evento | Storage | File max | Utenti     | Agent      |
| -------------- | ------ | ----------- | ----------- | ------- | -------- | ---------- | ---------- |
| **Trial**      | 0      | 2           | 3           | 5 GB    | 100 MB   | 3          | 1          |
| **Starter**    | 149    | 5           | 10          | 100 GB  | 1 GB     | 10         | 3          |
| **Pro**        | 399    | 20          | 20          | 1 TB    | 2 GB     | 50         | 10         |
| **Enterprise** | da 990 | illimitato  | illimitato  | custom  | 5 GB+    | illimitato | illimitato |

### 21.2 SKU Lemon Squeezy (vedi `Listino_Prezzi.md` per dettagli)

| SKU                             | Prezzo                     | Cosa licenzia                                     |
| ------------------------------- | -------------------------- | ------------------------------------------------- |
| `slide-center-cloud-starter`    | €149/mese o €1.500/anno    | Tenant cloud piano Starter                        |
| `slide-center-cloud-pro`        | €399/mese o €4.000/anno    | Tenant cloud piano Pro                            |
| `slide-center-cloud-enterprise` | da €990/mese               | Tenant cloud piano Enterprise                     |
| `slide-center-agent`            | €490 una tantum            | Local Agent (mini-PC regia, 1 attivazione/evento) |
| `slide-center-room-agent`       | €190 una tantum            | Room Agent (PC sala, 1 attivazione)               |
| `slide-center-suite`            | €1.500 una tantum + canone | Bundle Cloud Pro + Local + 5 Room                 |

### 21.3 Costi infrastruttura (partenza)

| Servizio      | Tier free                              | Quando passare al paid                      |
| ------------- | -------------------------------------- | ------------------------------------------- |
| Supabase      | 2 progetti free, 500MB DB, 1GB Storage | Quando primo cliente Starter (€25/mese Pro) |
| Vercel        | 100GB bandwidth/mese                   | Quando 10+ tenant attivi (€20/mese Pro)     |
| Sentry        | 5K events/mese free                    | Quando >5K errori/mese (€26/mese Team)      |
| Resend        | 3K email/mese free                     | Quando >3K email/mese (€20/mese Pro 50K)    |
| Lemon Squeezy | 5% transaction fee + €0.30/transazione | Sempre (vendor di pagamento)                |

Break-even atteso: **2 clienti Starter** coprono tutta l'infrastruttura paid mensile.

---

## 22. Sprint history sintetica

### 22.1 Fasi 0-14 (cloud) — DONE

| Fase | Nome                                       | Stato |
| ---- | ------------------------------------------ | ----- |
| 0    | Bootstrap monorepo                         | DONE  |
| 1    | Auth multi-tenant + signup + super-admin   | DONE  |
| 2    | CRUD Eventi/Sale/Sessioni/Speaker + quote  | DONE  |
| 3    | Upload Portal relatori (TUS resumable)     | DONE  |
| 4    | Versioning + storico + review workflow     | DONE  |
| 5    | Vista Regia realtime                       | DONE  |
| 6    | Pairing Device + Room Player PWA           | DONE  |
| 7    | Dual-Mode File Sync (Cloud + Intranet LAN) | DONE  |
| 8    | Dashboard Super-Admin + sospensione tenant | DONE  |
| 9    | Offline architecture + routing runtime     | DONE  |
| 10   | Export fine evento (ZIP/CSV/PDF)           | DONE  |
| 11   | Billing Lemon Squeezy (UI, link env)       | DONE  |
| 12   | i18n completamento (lingua UI, parity)     | DONE  |
| 13   | Integrazioni ecosistema (Timer/CREW/API)   | DONE  |
| 14   | Hardening + Sentry + E2E + RLS audit       | DONE  |

### 22.2 Sprint 1-8 (operativita commerciale post-Fase 14) — DONE

| Sprint | Nome                                                                                  | Stato |
| ------ | ------------------------------------------------------------------------------------- | ----- |
| 1      | Inviti team + accept-invite + password reset + ErrorBoundary + Playwright + RLS audit | DONE  |
| 2      | Intranet offline + bypass Win11 (firewall NSIS, mDNS, MOTW strip)                     | DONE  |
| 3      | Distribuzione desktop (`clean-and-build.bat` + NSIS + portable + manuali)             | DONE  |
| 4      | Sistema licenze Live WORKS APP (cloud + client Tauri AES-256-GCM)                     | DONE  |
| 5+5b   | Hardening commerciale (SLA, Listino, code-signing CI, screencast, manuali)            | DONE  |
| 6      | Onboarding wizard + demo data + healthcheck + AdminHealthView                         | DONE  |
| 7      | Operativita interna 100% (GDPR + Resend + cron licenze + warning banner + dashboard)  | DONE  |
| 8      | Audit log tenant + welcome email + status page + guida DHS                            | DONE  |

### 22.3 Fase 15 — Sprint A→Q (cloud hardening + desktop offline + sync hybrid) — DONE tranne Q opzionale

#### Cloud hardening (Sprint A-I)

| Sprint | Nome                                                            | Stato |
| ------ | --------------------------------------------------------------- | ----- |
| A      | Modalita LIVE/TURBO/AUTO + throttling download                  | DONE  |
| B      | Realtime Broadcast PG triggers (sync admin → sala < 1s mediana) | DONE  |
| C      | Streaming chunked + Resume + SHA-256 verifica                   | DONE  |
| D      | Dashboard PC sala admin + RoomDevicesPanel realtime             | DONE  |
| E      | Storage usage + cleanup orfani                                  | DONE  |
| F      | Search globale evento (combobox WAI-ARIA)                       | DONE  |
| G      | Multi-select bulk (ZIP, sposta, elimina) con jszip              | DONE  |
| H      | Upload admin drag & drop multi-file con coda + cancel           | DONE  |
| I      | Anteprima inline FilePreviewDialog + now playing badge          | DONE  |

#### Desktop offline (Sprint J-P)

| Sprint | Nome                                                            | Stato |
| ------ | --------------------------------------------------------------- | ----- |
| J      | Bootstrap `apps/desktop` Tauri 2 + Axum + SQLite + role picker  | DONE  |
| K      | REST mirror Rust di Supabase JS (events/rooms/sessions/...)     | DONE  |
| L      | Discovery LAN 4-tier (UNC + UDP + mDNS + IP manuale)            | DONE  |
| M      | Auto-rejoin al boot via `device.json` persistente               | DONE  |
| N      | LAN push fan-out + long-poll + signed URL HMAC LAN + MOTW strip | DONE  |
| O      | UI parity cloud vs desktop (BackendModeBadge, layout identico)  | DONE  |
| P      | NSIS Windows x64 + Tauri updater + installer hooks Win11        | DONE  |

#### Field test readiness (Sprint FT)

| Sprint | Nome                                                          | Stato |
| ------ | ------------------------------------------------------------- | ----- |
| FT     | Smoke test mjs + ps1 + healthcheck + JSON output per feedback | DONE  |

#### Sync hybrid (Sprint Q) — OPZIONALE, READY-TO-CODE

Sprint Q implementa push-only worker desktop → cloud (presentation_versions, room_state) per backup automatico + dashboard cloud che vede TUTTI gli eventi (anche offline). Il piano dettagliato e in `docs/STATO_E_TODO.md` § "Sprint Q — ready to code". Decisione GO/NO-GO basata su 5 domande post field-test (vedi STATO_E_TODO.md).

#### Hardening commerciale (Sprint Q+1) — DONE 18/04/2026

| Sprint | Nome                                                                                                  | Stato |
| ------ | ----------------------------------------------------------------------------------------------------- | ----- |
| Q+1    | Supabase RLS least-privilege + 7 indici hot-path + PKCE + CSP/HSTS + CI types drift + auto-deploy fns | DONE  |

Vedi `docs/STATO_E_TODO.md` §0.8 per dettaglio file modificati e azioni manuali Andrea (deploy migrations, env vars Vercel, secrets GitHub Actions).

#### Multi-tenant commercial readiness (Sprint R) — DONE

| Sprint | Gap | Nome                                                                                                         | Stato |
| ------ | --- | ------------------------------------------------------------------------------------------------------------ | ----- |
| R-1    | G1  | Super-admin crea tenant + invito primo admin da `/admin/tenants`                                             | DONE  |
| R-2    | G2  | Live WORKS APP integrazione bidirezionale (Lemon Squeezy webhook + email admin-invite)                       | DONE  |
| R-3    | G3  | PC sala upload speaker check-in (Edge `room-device-upload-init/finalize/abort` + `RoomDeviceUploadDropzone`) | DONE  |

Famiglia R chiusa: Slide Center e' ora **commercial-ready end-to-end** (purchase Lemon Squeezy → tenant zero-touch → admin invite email → operativita completa con upload da admin/speaker portal/PC sala).

#### File management OneDrive-style (Sprint S) — IN PROGRESS

| Sprint | Gap | Nome                                                                                             | Stato                                           |
| ------ | --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| S-1    | G4  | Drag&drop folder intera in upload admin (`folder-traversal.ts` + `<input webkitdirectory>`)      | DONE                                            |
| S-2    | G5  | Drag&drop visivo PC ↔ sale (`RoomAssignBoard` Kanban + toggle Lista/Lavagna)                     | DONE                                            |
| S-3    | G6  | Export ZIP fine evento ordinato per sala/sessione (`buildEventSlidesZip` v2 nested + `info.txt`) | DONE                                            |
| S-4    | G7  | Ruolo device "Centro Slide" multi-room (oggi: 1 device = 1 sala)                                 | **DONE** ✅ (vedi `docs/STATO_E_TODO.md` §0.15) |

| Sprint | Gap | Nome                                                                                                                | Stato                                           |
| ------ | --- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| T-1    | G8  | Badge versione "in onda" sempre visibile in sala + toast cambio versione (`VersionBadge` inline+overlay)            | **DONE** ✅ (vedi `docs/STATO_E_TODO.md` §0.16) |
| T-2    | G9  | Telemetria perf live PC sala heap/storage/FPS/battery (`device_metric_pings` + `LivePerfTelemetryPanel`)            | **DONE** ✅ (vedi `docs/STATO_E_TODO.md` §0.17) |
| T-3    | G10 | Features competitor parity (file checking, ePoster, mobile SRR, speaker timer integrato, email reminder schedulati) | pending                                         |

Sprint T (competitor parity, residuo G10) pianificato. Vedi `docs/STATO_E_TODO.md` §0.4 per il dettaglio dei 10 GAP e la roadmap.

---

## 23. ADR sintetici

| ADR | Decisione                                                            | Razionale breve                                                               |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 001 | Room Player = file manager ATTIVO con FSA download locale            | Zero integrazione COM Office, zero rischio crash, file sempre su disco        |
| 002 | Pairing = OAuth Device Flow (RFC 8628)                               | Pattern standard AppleTV/Netflix, funziona in qualsiasi rete                  |
| 003 | Tre modalita di rete (cloud / intranet / hybrid)                     | Cliente sceglie senza vendor-lock; vedi §1                                    |
| 004 | Supabase (non Firebase, non Next.js)                                 | Modello relazionale + TUS nativo + RLS potente + SQL analytics                |
| 005 | Due dashboard, un solo codice (`/admin/*` + `/`)                     | Stessa app React, guard su `role` JWT                                         |
| 006 | Supabase Storage per MVP, Cloudflare R2 quando egress > $50/mese     | TUS nativo + Auth integrata + un solo servizio                                |
| 007 | Dual-mode per evento (`network_mode` ENUM)                           | Cloud default, intranet/hybrid opt-in per evento                              |
| 008 | i18n parity rigorosa IT/EN nello stesso commit                       | Coerenza prodotto + stretto vincolo qualitativo                               |
| 009 | Append-only su `presentation_versions` (mai UPDATE)                  | Audit + rollback + integrita storico                                          |
| 010 | Super-admin NON vede contenuto file (solo metadati)                  | Vincolo GDPR non negoziabile                                                  |
| 011 | Integrazioni ecosistema via env-driven deep link (no API hard-coded) | Disaccoppiamento + opzionalita                                                |
| 012 | Licenze Tauri code-duplication intenzionale Local/Room Agent         | Chiavi AES diverse + isolamento `APP_DATA_DIR` + evita ristrutturazione Cargo |
| 013 | Webhook Lemon Squeezy SOLO in Live WORKS APP, NO in Slide Center     | Single source of truth, evita race condition + doppia fonte                   |
| 014 | Code-signing in `post-build.mjs` (NON in `release-licensed.bat`)     | Garantisce sequenza obbligatoria sign→zip→sha256                              |
| 015 | Onboarding via `tenants.onboarded_at` (NON localStorage o JWT)       | Persistenza tenant-wide, gating server-side via RPC SECURITY DEFINER          |
| 016 | GDPR export server-side via Edge (NON client-side)                   | Sicurezza + audit centralizzato + signed URL controllabile                    |
| 017 | Audit log via RPC SECURITY DEFINER (NON RLS diretta)                 | Filtri/paginazione/check ruolo a livello DB                                   |
| 018 | Stessa SPA React per cloud + desktop, dispatcher in `lib/`           | Zero fork del codice; backend astratto in `backend-mode.ts`                   |
| 019 | Smoke test desktop ritorna JSON per feedback automatizzato           | Sprint FT: validazione pre-evento riproducibile                               |
| 020 | `enforceLocalOnly` guard programmatico per regola sovrana #2         | Rete di sicurezza contro regressioni (vedi §11)                               |
| 021 | Sprint Q opzionale + framework decisionale GO/NO-GO                  | Evita over-engineering: hybrid solo se serve davvero                          |

---

## 24. Glossario

| Termine                | Significato                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| **Tenant**             | Organizzazione cliente (azienda, agenzia eventi). Isolato su Postgres via `tenant_id` + RLS    |
| **PC sala**            | Computer fisico in una sala di un evento, collegato a videoproiettore                          |
| **PC regia**           | Computer del tecnico che gestisce l'evento (admin)                                             |
| **Local Agent**        | Software Tauri sul mini-PC regia che fa da server LAN per tutti i PC sala                      |
| **Room Agent**         | Software Tauri leggero su ogni PC sala che fa polling LAN dal Local Agent                      |
| **Room Player**        | UI del PC sala (PWA web `/sala/:token` o WebView in Tauri Desktop)                             |
| **Vista Regia**        | UI dell'admin che vede in realtime cosa sta succedendo in ogni sala                            |
| **Speaker / Relatore** | Persona che presenta. NON ha account Supabase, accede solo a `/u/<upload_token>` per uploadare |
| **Upload Portal**      | Pagina `/u/:token` dove lo speaker carica il file (TUS resumable)                              |
| **Pair / Pairing**     | Procedura di collegamento PC sala alla regia tramite codice 6 cifre (OAuth Device Flow)        |
| **Device token**       | JWT permanente del PC sala paired, salvato in `paired_devices.pair_token_hash`                 |
| **FSA**                | File System Access API (Chrome 86+/Edge 86+), permette al browser di scrivere su disco utente  |
| **Network mode**       | Modalita rete per evento: `cloud` / `intranet` / `hybrid` (colonna su `events`)                |
| **MOTW**               | Mark-of-the-Web (ADS Windows `Zone.Identifier`), trigger SmartScreen. Strippato dal Room Agent |
| **mDNS**               | Multicast DNS (`.local`), discovery LAN. NON funziona da browser, solo da app native           |
| **TUS**                | Resumable upload protocol, supportato nativamente da Supabase Storage                          |
| **HMAC**               | Hash-based Message Authentication Code. Usato per firmare URL signed LAN + sync hybrid         |
| **Sprint A-Q**         | Sprint Fase 15 (cloud A-I + desktop J-P + field test FT + hybrid Q opzionale)                  |
| **Sovereign rule #2**  | "File partono SEMPRE dal PC locale". Vedi §11 per enforcement                                  |

---

**FINE.** Per cose da fare oggi e domani: vedi `docs/STATO_E_TODO.md`. Per setup macchina: `docs/Setup_Strumenti_e_MCP.md`. Per prompt Claude Desktop: `docs/Istruzioni_Claude_Desktop.md`.
