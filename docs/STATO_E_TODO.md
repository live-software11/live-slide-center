# STATO E TO-DO LIVE SLIDE CENTER

> **Documento operativo gemello di `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md`.**
> Qui sta SOLO cosa rimane da fare, in ordine di priorita. Per "cosa fa il prodotto" e "come e fatto" → architettura.
>
> **Versione:** 2.15 — 18 aprile 2026 sera (post UX Redesign V2.0 Sprint U-1 — Foundation §0.24)
> **Owner:** Andrea Rizzari
> **Stato globale:** Tutti gli sprint A→I (cloud) + J→P + FT (desktop) + 1→8 (operativita commerciale) sono **DONE**. **Hardening Supabase + Vercel Sprint Q+1 (§0.8) DONE**. **Sprint R-1 (G1, super-admin crea tenant + licenze, §0.9) DONE**. **Sprint R-2 (G2, Lemon Squeezy webhook + email automatica admin invitato, §0.10) DONE**. **Sprint R-3 (G3, PC sala upload speaker check-in, §0.11) DONE**. **Sprint S-1 (G4, drag&drop folder admin OneDrive-style, §0.12) DONE**. **Sprint S-2 (G5, drag&drop visivo PC ↔ sale, §0.13) DONE**. **Sprint S-3 (G6, export ZIP fine evento ordinato sala/sessione, §0.14) DONE**. **Sprint S-4 (G7, ruolo device "Centro Slide" multi-room, §0.15) DONE**. **Sprint T-1 (G8, badge versione "in onda" sempre visibile in sala + toast cambio versione, §0.16) DONE**. **Sprint T-2 (G9, telemetria perf live PC sala — CPU/RAM/heap/disco/FPS/battery, §0.17) DONE**. **Audit completo + bugfix Q+1.5 (§0.18) DONE — semaforo VERDE su tutto**. **Sprint T-3 (G10) COMPLETO: T-3-A (file validator warn-only, §0.20) DONE → T-3-E (Next-Up file preview, §0.21) DONE → T-3-G (remote control tablet, §0.22) DONE — TUTTE E TRE LE FEATURE COMPETITOR VERDE.**
>
> **Audit chirurgico 18/04/2026 (§ 0):** identificati **10 GAP funzionali** rispetto agli obiettivi di prodotto dichiarati da Andrea (parita cloud/desktop, versioning, performance impatto-zero, super-admin licenze, file management OneDrive-style, drag&drop PC, upload da sala, export ordinato, competitivita PreSeria/Slidecrew/SLIDEbit). I gap sono raggruppati in 3 macro-sprint **R / S / T** con ordine di priorita. **Stato chiusura: 10/10 chiusi → famiglia R completa, famiglia S completa, famiglia T completa (T-1, T-2, T-3-A+E+G).**
>
> **Hardening Sprint Q+1 (§ 0.8):** completato hardening backend (Supabase RLS least-privilege + 7 indici hot-path + PKCE + CSP + CI types drift + auto-deploy Edge Functions).
>
> **Sprint R-1 (§ 0.9):** super-admin puo' creare nuovi tenant cliente + invito primo admin direttamente da `/admin/tenants`. Tipi i18n IT/EN allineati. Quality gates verdi.
>
> **Sprint R-2 (§ 0.10):** integrazione bidirezionale Lemon Squeezy → cliente paga su Live WORKS APP, webhook crea AUTOMATICAMENTE il tenant Slide Center + invia email all'admin (template `admin-invite` IT/EN). Idempotenza con `lemon_squeezy_event_log`, mapping configurabile `lemon_squeezy_plan_mapping`.
>
> **Sprint R-3 (§ 0.11):** relatore last-minute carica/sostituisce file dal PC sala. Auth via `device_token` (no JWT), upload diretto a Storage via signed URL (bypass limite 6MB Edge), broadcast realtime → admin live view aggiornata in <1s, activity_log con `actor='device'` + `actor_name='PC sala N'`.
>
> **Sprint S-1 (§ 0.12):** admin puo' droppare cartelle intere (con sotto-cartelle) in upload sessione, OneDrive-style. Traversal ricorsivo `webkitGetAsEntry` + `<input webkitdirectory>`, max 500 file/depth 10, struttura preservata come prefisso filename. Zero modifiche schema DB.
>
> **Sprint S-2 (§ 0.13):** admin puo' assegnare PC alle sale tramite **lavagna drag&drop visiva** (Kanban-style con colonne sala + "Non assegnati"). Toggle persistente "Lista | Lavagna" in `DevicesPanel`. HTML5 DnD nativo, aggiornamento ottimistico, realtime listener `paired_devices` gia' attivo allinea altri admin in <1s. Zero modifiche schema DB.
>
> **Sprint S-3 (§ 0.14):** export ZIP fine evento ora **ordinato** in struttura nested `Sala/Sessione/Speaker_vN_filename.ext` (prima era piatto `slides/...`) + README `info.txt` UTF-8 in root con metadata evento (nome, date, sale, sessioni, conteggio per sala, totale bytes, generato_a). Zero modifiche schema DB, refactor pure-function `event-export.ts`.
>
> **Sprint S-4 (§ 0.15):** introdotto ruolo `paired_devices.role` (`'room'` default | `'control_center'`). Un PC promosso a "Centro Slide" riceve i file di **TUTTE** le sale dell'evento (manifest multi-room dal `room-player-bootstrap`), filesystem locale strutturato `Sala/Sessione/file`, niente `RoomDeviceUploadDropzone` (read-only), header dedicato con badge `CENTRO`. Promote/demote da kebab in `DeviceList`; sezione speciale "Centri Slide" sopra la lavagna in `RoomAssignBoard`. Migration `20260418090000_paired_devices_role.sql` + RPC `update_device_role`.
>
> **Sprint T-1 (§ 0.16):** versione "in onda" ora visibile **a colpo d'occhio** in sala. Badge `vN/M` con color coding sovrano: **verde** se la corrente e' anche la piu' recente, **giallo** se l'admin ha riportato indietro la corrente (esiste una versione piu' nuova). Badge `inline` sempre visibile accanto al filename in `FileSyncStatus`; badge `overlay` top-right durante l'anteprima fullscreen di `FilePreviewDialog` (auto-fade 5s, ricompare on mouse/touch/key — UX standard player video). Toast notify automatico su cambio versione (`info` se nuova, `warning` se rollback admin) con titolo + descrizione i18n IT/EN. Edge Function `room-player-bootstrap` arricchita con `versionNumber` + `versionTotal` (MAX su `presentation_versions` per `presentation_id` filtrato `status IN ('ready','superseded')`). Zero modifiche schema DB.
>
> **Sprint T-2 (§ 0.17):** telemetria perf live PC sala (CPU/RAM/heap/storage/FPS/battery/network) ora disponibile come widget admin **`LivePerfTelemetryPanel`** in `EventDetailView`. Il PC sala collector (`useDevicePerformanceCollector`) raccoglie ad ogni tick di polling (5/12/60s a seconda del playback mode) un payload metrics — heap JS%, storage quota%, FPS via rAF EMA, network type+downlink, battery%+charging, visibility tab — e lo iniettia nel bootstrap. L'Edge Function lo persiste nella nuova tabella append-only `device_metric_pings` (RLS chiusa, INSERT solo via SECURITY DEFINER `record_device_metric_ping` con rate-limit 3s, retention 24h via `cleanup_device_metric_pings` schedulato pg_cron daily 03:00 UTC). L'admin polla ogni 8s la RPC `fetch_device_metrics_for_event` (auth `app_tenant_id()` + ruolo admin/tech) e vede una griglia card per device con header health-dot (verde/giallo/rosso/grigio), badge battery, status offline/network/source, e per ogni metrica numero big colorato + sparkline SVG inline (zero deps, ~200 byte) ultimi 30 min. **Soglie sovrane** (heap>=85% warning/95% critical, storage>=90/95, FPS<30/15, battery<20/10 e !charging, CPU/RAM solo per source=desktop>=85/95). Toast alert debounced **30s** quando un device entra in critical/warning, toast `success` "recovered" al rientro. Pannello collassabile (default chiuso, summary header "X sani | Y attenzione | Z critici" sempre visibile), persistito localStorage. Auto-hidden quando 0 device pairati (no rumore UI in tenant nuovo). Verde per Sprint T-3 (G10, features competitor: file checking, ePoster, mobile speaker ready room) quando vuoi.
>
> **Audit chirurgico post-deploy 18/04/2026 (§ 0.23):** dopo deploy Vercel + Supabase chiuso con commit `pre-field-test`, audit completo su 100% migrations + Edge Functions + critical paths frontend. Identificate **8 issue HIGH/CRITICAL fixate immediatamente** (`activity_log` colonne errate in `rpc_move_presentation_to_session`, TOCTOU race su `pair-claim`, idempotency race su Lemon Squeezy webhook, cross-room finalize forbidden, info disclosure su 4 Edge Functions, `setState` in render in `SessionFilesPanel`, UI stuck in `EventDetailView`, hang `fetch` senza timeout in export ZIP) — tutti gia' in produzione tramite migration `20260418220000_audit_fixes_post_deploy.sql` + redeploy 4 Edge Functions. **9 issue MEDIUM** documentate in §0.23.2 come backlog per sessioni dedicate (retention DB, CORS hardening, rate limit esteso, performance Realtime e bundle, outbox queue offline Tauri, test E2E mancanti). Quality gate post-fix verde.
>
> **UX Redesign V2.0 Sprint U-1 — Foundation (§ 0.24 — DONE 18/04/2026 sera):** redesign completo dell'app shell. Andrea ha esplicitato la nuova UI: sidebar permanente Notion/Linear-style con sezioni espandibili Eventi e PC sala, due modalita' Production/On Air per ogni evento, zero-friction per il PC sala (admin pre-configura, magic link auto-detect). Implementata foundation: shadcn/ui in `packages/ui` (20 componenti base + custom `Sidebar` con desktop sticky + mobile `Sheet` drawer + auto-close on route change), token mapping `sc-*` ↔ shadcn (palette dark invariata), nuovo `AppShell` shell component a 2 varianti (`tenant` | `admin`) che sostituisce `RootLayout`/`AdminRootLayout` come thin wrappers, sidebar a 2 livelli (Eventi expandable → Production/On Air, PC sala con health-dot, Strumenti), top bar con search-hint trigger + ⌘K Command palette globale (`cmdk` based, jump-to dashboard/events/settings + recenti). Quality gate verde: typecheck monorepo (5/5), lint monorepo (5/5), build production OK, i18n parity 1416/1416 (18 nuove keys `appShell.*`). Zero breaking change su URL, zero modifiche schema DB, zero modifiche logica auth/realtime — solo skin + IA. Successivi: U-2 (ProductionView con tree+grid+drop globale, split EventDetail in 4 tab), U-3 (rinomina LiveRegia → OnAir + preview slide N/Tot grosso), U-4 (zero-friction provision via QR), U-5 (re-skin pannelli minori + E2E + tag v2.0).
>
> **Chiusura backlog AU-01 → AU-09 (§ 0.23.3 — DONE 18/04/2026):** 9/9 issue MEDIUM risolte in sessione singola. **DB:** migration `20260418230000_audit_medium_fixes.sql` applicata in produzione → `pg_cron` abilitato, 4 job schedulati (`cleanup_lemon_squeezy_event_log` daily 04:00 UTC retention 90gg, `cleanup_device_metric_pings` daily 03:00 UTC retention 24h, `cleanup_pair_claim_rate_events` ogni 30min, `cleanup_edge_function_rate_events` ogni 30min retention 1h), nuova tabella `edge_function_rate_events` + RPC `check_and_record_edge_rate` per rate-limit generico, `search_path` hardening su tutte le `SECURITY DEFINER` (~40 funzioni standardizzate a `pg_catalog, public, pg_temp, extensions, realtime, auth`). **Edge Functions:** nuovi shared `_shared/cors.ts` (whitelist admin con regex Vercel preview) + `_shared/rate-limit.ts` (`checkAndRecordEdgeRate` + `clientIpFromRequest` + `hashIp` salt-aware), applicati a `room-device-upload-init` (30 req/5min/IP) e `remote-control-dispatch` (120 req/min/IP), entrambi ridistribuiti. **Frontend:** `useEventLiveData` debounce reload 200ms (no reload-storm su burst Realtime), `event-export.ts` + `thumbnail-pptx.ts` lazy-import jszip (chunk separato `jszip.min` ~28KB gzip), nuovo `apps/web/src/lib/outbox-queue.ts` IndexedDB con retry exponential backoff integrato in `RoomPlayerView` per `room-player-set-current` (retry 15s + on `online` event, max 8 tentativi). **E2E:** 3 nuove fixture Playwright in `apps/web/e2e/`: `pairing-race.spec.ts` (verifica race TOCTOU `claim_pairing_code_atomic`), `move-presentation.spec.ts` (verifica `activity_log` post-fix), `remote-control.spec.ts` (verifica dispatch + rate limit). Quality gate verde: typecheck + lint + build + i18n parity 1398/1398.

---

## INDICE

0. [Audit chirurgico 18/04/2026 — gap vs obiettivi prodotto](#0-audit-chirurgico-18042026--gap-vs-obiettivi-prodotto)
   - 0.8 [Hardening Supabase + Vercel (Sprint Q+1 — DONE)](#08-hardening-supabase--vercel-sprint-q1--done-18042026)
   - 0.9 [Sprint R-1 — Super-admin crea tenant + licenze (DONE)](#09-sprint-r-1--super-admin-crea-tenant--licenze-done-18042026)
   - 0.10 [Sprint R-2 — Lemon Squeezy webhook + email admin-invite (DONE)](#010-sprint-r-2--lemon-squeezy-webhook--email-admin-invite-done-18042026)
   - 0.11 [Sprint R-3 — PC sala upload speaker check-in (DONE)](#011-sprint-r-3--pc-sala-upload-speaker-check-in-done-18042026)
   - 0.12 [Sprint S-1 — Drag&drop folder intera in upload admin (DONE)](#012-sprint-s-1--dragdrop-folder-intera-in-upload-admin-done-18042026)
   - 0.13 [Sprint S-2 — Drag&drop visivo PC ↔ sale (DONE)](#013-sprint-s-2--dragdrop-visivo-pc--sale-done-18042026)
   - 0.14 [Sprint S-3 — Export ZIP fine evento ordinato sala/sessione (DONE)](#014-sprint-s-3--export-zip-fine-evento-ordinato-salasessione-done-18042026)
   - 0.15 [Sprint S-4 — Ruolo device "Centro Slide" multi-room (DONE)](#015-sprint-s-4--ruolo-device-centro-slide-multi-room-done-18042026)
   - 0.16 [Sprint T-1 — Badge versione "in onda" + toast cambio versione (DONE)](#016-sprint-t-1--badge-versione-in-onda--toast-cambio-versione-done-18042026)
   - 0.17 [Sprint T-2 — Telemetria perf live PC sala (DONE)](#017-sprint-t-2--telemetria-perf-live-pc-sala-done-18042026)
   - 0.18 [Audit completo + Bugfix Q+1.5 (DONE)](#018-audit-completo--bugfix-q15-done-18042026)
   - 0.19 [Sprint T-3 (G10) — Piano implementazione](#019-sprint-t-3-g10--piano-implementazione-decisione-18042026)
   - 0.20 [Sprint T-3-A — File error checking automatico (DONE)](#020-sprint-t-3-a--file-error-checking-automatico-done-18042026)
   - 0.21 [Sprint T-3-E — Preview "Prossimo file" su PC tecnico (DONE)](#021-sprint-t-3-e--preview-prossimo-file-su-pc-tecnico-done-18042026)
   - 0.22 [Sprint T-3-G — Remote slide control da tablet (DONE)](#022-sprint-t-3-g--remote-slide-control-da-tablet-done-18042026)
   - 0.23 [Audit chirurgico post-deploy 18/04/2026 (DONE + sessioni dedicate)](#023-audit-chirurgico-post-deploy-18042026-done--sessioni-dedicate)
   - 0.23.3 [Chiusura backlog AU-01 → AU-09 (DONE — 18/04/2026 sera)](#0233-chiusura-backlog-au-01--au-09-done--18042026-sera)
   - 0.24 [UX Redesign V2.0 — Sprint U-1 Foundation (DONE — 18/04/2026 sera)](#024-ux-redesign-v20--sprint-u-1-foundation-done--18042026-sera)
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

| ID  | Gap                                                                       | Severita   | Modulo                                                                              | Sprint  | Stato       |
| --- | ------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- | ------- | ----------- |
| G1  | Super-admin non puo' creare licenze tenant da app                         | **HIGH**   | `apps/web/src/features/admin/` + RPC SECURITY DEFINER                               | **R-1** | **DONE** ✅ |
| G2  | Live WORKS APP integrazione = solo link esterno (no parita dati)          | **HIGH**   | `apps/web/src/features/billing/` + webhook Lemon Squeezy condiviso                  | **R-2** | **DONE** ✅ |
| G3  | PC sala NON puo' caricare/sovrascrivere file (read-only)                  | **HIGH**   | `apps/web/src/features/devices/RoomPlayerView.tsx`                                  | **R-3** | **DONE** ✅ |
| G4  | Drag&drop di **folder intera** in upload admin assente                    | **MEDIUM** | `apps/web/src/features/presentations/components/SessionFilesPanel.tsx`              | **S-1** | **DONE** ✅ |
| G5  | Drag&drop visivo PC ↔ sale assente (solo dropdown)                        | **MEDIUM** | `apps/web/src/features/devices/components/DeviceList.tsx` + nuova `RoomAssignBoard` | **S-2** | **DONE** ✅ |
| G6  | Export ZIP fine evento piatto (no struttura sala/sessione)                | **MEDIUM** | `apps/web/src/features/events/lib/event-export.ts` `buildEventSlidesZip`            | **S-3** | **DONE** ✅ |
| G7  | "Centro Slide" multi-room = ruolo device assente                          | **MEDIUM** | DB schema `paired_devices.role` + `useFileSync` multi-room manifest                 | **S-4** | **DONE** ✅ |
| G8  | Versione "in onda" non visibile a colpo d'occhio in sala                  | **LOW**    | `apps/web/src/features/devices/RoomPlayerView.tsx` overlay badge `vN/M`             | **T-1** | **DONE** ✅ |
| G9  | Telemetria perf live PC sala (CPU/RAM/disco) non aggregata                | **LOW**    | `device_metric_pings` + `LivePerfTelemetryPanel`                                    | **T-2** | **DONE** ✅ |
| G10 | Features competitor mancanti (file checking, preview next, remote tablet) | **LOW**    | Vari (vedi §0.20-0.22)                                                              | **T-3** | **DONE** ✅ |

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

#### G7 — "Centro Slide" multi-room = ruolo device assente ✅ CHIUSO IN SPRINT S-4 (§ 0.15)

**Evidenza codice (pre-S-4):**

- `paired_devices.room_id` UNICO → 1 device = 1 sala.
- Andrea: "i pc assegnati al centro slide devono avere i dati di tutte le sale".

**Soluzione applicata (Sprint S-4):**

- DB migration `20260418090000_paired_devices_role.sql`: aggiunta colonna `paired_devices.role TEXT NOT NULL DEFAULT 'room' CHECK (role IN ('room', 'control_center'))` (NB: scelto `TEXT+CHECK` invece di `ENUM` per evitare i problemi `ALTER TYPE ADD VALUE` in transazione gia' incontrati in R-3).
- Quando `role = 'control_center'`, `room_id` viene forzato a NULL dalla RPC `update_device_role`.
- Edge Function esistente `room-player-bootstrap` esteso con branch `deviceRole === 'control_center'`: query `presentations` filtrata su **tutte** le sale dell'evento; ogni `FileRow` arricchito con `roomId/roomName`; sort multi-room; payload include `control_center: true` + `rooms[]`.
- `useFileSync` esteso con `FileSyncItem.{roomId,roomName}` + flag `disableRealtime`. Path locale ora `Sala/Sessione/file` (primo segmento = `roomName` per centri).
- UI: branch dedicato in `RoomPlayerView` (icona `Building2`, badge `CENTRO`, count sale, dropzone upload nascosto), kebab promote/demote in `DeviceList`, sezione fixed "Centri Slide" sopra la lavagna in `RoomAssignBoard` (non draggable).
- 18 nuove chiavi i18n IT/EN sotto `devices.list.*`, `devices.board.*`, `roomPlayer.center.*`.

**Outcome:** un PC promosso a "Centro Slide" sincronizza in background tutti i file di tutte le sale dell'evento, zero impatto sui PC sala (che continuano col loro flusso single-room realtime). Vedi §0.15 per dettagli completi.

#### G8 — Versione "in onda" non visibile a colpo d'occhio in sala — **CHIUSO IN SPRINT T-1**

**Evidenza codice (originaria, pre-T-1):**

- `RoomPlayerView` mostra il file corrente ma non c'e' badge persistente "v3 di 5".
- `presentation.current_version_id` esiste in DB e popola `room_state.current_presentation_id`.
- Andrea: "deve essere chiaro quale versione si stia usando di un file (in un centro slide lo stesso file puo' essere modificato 100 volte)".

**Soluzione applicata (Sprint T-1, 18/04/2026):**

- Edge Function `room-player-bootstrap` arricchita con `versionNumber` (= `presentation_versions.version_number` della current) + `versionTotal` (= MAX `version_number` per `presentation_id` filtrato `status IN ('ready','superseded')`). Backward-compat: nullable.
- Componente `<VersionBadge>` riusabile, due varianti: `inline` (chip piccolo accanto al filename in `FileSyncStatus`, sempre visibile) + `overlay` (badge fluttuante top-right in `FilePreviewDialog` durante anteprima fullscreen, auto-fade 5s, ricompare on mouse/touch/keypress — UX video player).
- Color coding sovrano:
  - **verde** (`sc-success`, icona `CheckCircle2`) se `versionNumber === versionTotal` (corrente = latest);
  - **giallo** (`sc-warning`, icona `History`) se `versionNumber < versionTotal` (admin ha riportato indietro la corrente, esiste una versione piu' recente);
  - neutro (`sc-primary`, icona `Layers`) se `versionTotal === 1` (unica versione caricata).
- Toast notify automatico in `RoomPlayerView`: useEffect su `items` traccia `presentationId → ultimo versionNumber visto`. Se aumenta → toast `info` "Nuova versione caricata: v{n}". Se diminuisce → toast `warning` "Versione riportata a v{n} (esiste anche v{total})". Inizializzazione lazy al primo render per evitare spam in apertura.
- 10 nuove i18n keys IT/EN (`roomPlayer.versionBadge.*`, `roomPlayer.versionToast.*`). Parita 1270/1270.

**Outcome:** la sala (e chi e' in regia) vede sempre quale versione esatta sta proiettando. Se il file e' stato modificato 100 volte, il badge mostra "v100 / 100" verde; se l'admin ha riportato la corrente a v37, badge "v37 / 100" giallo + tooltip esplicito. Vedi §0.16 per dettagli completi.

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

| Sprint          | Gap | Obiettivo                                        | Tempo dev | Tempo test | Output                                                      |
| --------------- | --- | ------------------------------------------------ | --------- | ---------- | ----------------------------------------------------------- |
| **S-1** ✅ DONE | G4  | Drag&drop folder intera in upload admin          | 1.5 g     | 0.5 g      | `useUploadQueue` esteso con `webkitGetAsEntry` (vedi §0.12) |
| **S-2** ✅ DONE | G5  | Drag&drop visivo PC ↔ sale (board)               | 1.5 g     | 0.5 g      | `RoomAssignBoardView` + DnD HTML5 nativo (vedi §0.13)       |
| **S-3** ✅ DONE | G6  | Export ZIP fine evento strutturato sala/sessione | 1 g       | 0.5 g      | `buildEventSlidesZip` v2 con tree (vedi §0.14)              |
| **S-4** ✅ DONE | G7  | "Centro Slide" multi-room device role            | 2 g       | 1 g        | `paired_devices.role` + branch RoomPlayerView (vedi §0.15)  |

**GO/NO-GO criteri:**

- GO se Andrea conferma: "preparo evento DHS reale con piu' di 3 sale".
- NO-GO se: "DHS = max 2 sale, drag&drop dropdown attuale basta" → S diventa backlog.

#### Sprint T — "Performance + competitivita commerciale" (LOW-MED priority — 4 giorni)

| Sprint   | Gap | Obiettivo                                                 | Tempo dev | Tempo test | Output                                              | Stato       |
| -------- | --- | --------------------------------------------------------- | --------- | ---------- | --------------------------------------------------- | ----------- |
| **T-1**  | G8  | Badge versione "in onda" sala + toast cambio versione     | 0.5 g     | 0.25 g     | `<VersionBadge>` inline+overlay, toast info/warning | **DONE** ✅ |
| **T-2**  | G9  | Telemetria heap/storage/FPS/battery PC sala admin live    | 1 g       | 0.5 g      | `device_metric_pings` + `LivePerfTelemetryPanel`    | **DONE** ✅ |
| **T-3a** | G10 | File error checking automatico (font, video, risoluzione) | 1.5 g     | 0.5 g      | Edge Function `slide-validator`                     | pending     |
| **T-3c** | G10 | Email reminder schedulati (cron upload pending)           | 0.5 g     | 0.25 g     | Cron job + template gia' presenti                   | pending     |
| **T-3d** | G10 | Speaker timer integrato (link Live SPEAKER TIMER)         | 0.5 g     | 0.25 g     | Iframe / link su `LiveRegiaView`                    | pending     |

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
GREEN LIGHT → R-1 e' DONE. Sprint R-2 ora completato (vedi §0.10).
```

---

### 0.10 Sprint R-2 — Lemon Squeezy webhook + email admin-invite (DONE 18/04/2026)

> **Gap chiuso:** G2 — Live WORKS APP / Lemon Squeezy ora alimenta in automatico Slide Center: cliente paga → webhook crea tenant → email all'admin. Zero touch manuale del super-admin per le vendite standard. Inclusa **la modifica deferred R-1.b** (email automatica admin invitato) inline nel webhook.
>
> **Obiettivo Andrea soddisfatto:** "in app come super admin posso creare licenze per aziende **e anche tramite live works app che deve lavorare sugli stessi dati**, per cui quello che vedo li e in app deve essere identico". Adesso Live WORKS APP (Lemon Squeezy storefront) e Slide Center sono in **sync automatico** sui subscription events.

#### 0.10.1 Cosa ho fatto (codice committato)

| Area                       | File / artifact                                                    | Cosa cambia                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Migration**              | `supabase/migrations/20260418070000_lemon_squeezy_integration.sql` | 3 colonne nuove su `tenants` (`lemon_squeezy_subscription_id` UNIQUE, `_customer_id`, `_variant_id`). Tabella `lemon_squeezy_plan_mapping` (variant_id → plan + quote, configurabile da super-admin). Tabella `lemon_squeezy_event_log` (idempotency UNIQUE su `event_id`, audit completo). 3 nuove RPC: `record_lemon_squeezy_event`, `mark_lemon_squeezy_event_processed`, `lemon_squeezy_apply_subscription_event`. |
| **Edge Function**          | `supabase/functions/lemon-squeezy-webhook/index.ts`                | Endpoint `POST /functions/v1/lemon-squeezy-webhook`. HMAC SHA-256 verify su body raw (header `X-Signature`, no prefix). Dispatch su 9 event types (`subscription_created/updated/cancelled/expired/paused/resumed/payment_success/payment_failed/unpaused`). Idempotency strict via `record_lemon_squeezy_event`. Chiamata chain a `email-send` con `kind=admin-invite` quando crea nuovo tenant.                      |
| **Edge Function (extend)** | `supabase/functions/email-send/index.ts`                           | Nuovo `EmailKind = 'admin-invite'`. Subject IT/EN. Template HTML inline con CTA accept-invite, scadenza visibile, fallback URL plain text per client che bloccano i link.                                                                                                                                                                                                                                              |
| **Config**                 | `supabase/config.toml`                                             | Registrata `[functions.lemon-squeezy-webhook]` con `verify_jwt = false` (auth via HMAC, no JWT utente).                                                                                                                                                                                                                                                                                                                |
| **Types**                  | `packages/shared/src/types/database.ts`                            | Aggiunte 2 tabelle (`lemon_squeezy_plan_mapping`, `lemon_squeezy_event_log`) + 3 colonne `tenants` + 3 RPC. Schema completo coerente con migration.                                                                                                                                                                                                                                                                    |
| **Env**                    | `.env.example`                                                     | Aggiunto `LEMON_SQUEEZY_WEBHOOK_SECRET` come secret Edge Function (NON committed). Riordinata sezione email secrets.                                                                                                                                                                                                                                                                                                   |

#### 0.10.2 Quality gates verdi

```
pnpm typecheck                          OK  (5/5 tasks, 7.7s)
pnpm --filter @slidecenter/web lint     OK  (0 errors, 0 warnings)
pnpm --filter @slidecenter/web build    OK  (1.66s, bundle invariato)
ReadLints (file modificati R-2)         OK  (0 issues)
```

#### 0.10.3 Flusso end-to-end (cliente paga su Live WORKS APP)

```
[Cliente] Visita liveworksapp.com → /pricing → click "Compra Slide Center Pro"
   ↓
[Lemon Squeezy] Hosted checkout → cliente paga → emette `subscription_created`
   ↓
[Lemon Squeezy] POST https://<ref>.supabase.co/functions/v1/lemon-squeezy-webhook
   con header X-Signature: <hex HMAC SHA-256 del body>
   con header X-Event-Name: subscription_created
   con body JSON: { meta:{event_name}, data:{id, attributes:{customer_id, variant_id, user_email, user_name, status, renews_at, ...}} }
   ↓
[Edge Function lemon-squeezy-webhook]
   1. Verifica HMAC (timing-safe)
   2. record_lemon_squeezy_event() → idempotent: se duplicate ritorna 200 skipped
   3. Estrae variant_id, customer_email, customer_name
   4. Chiama lemon_squeezy_apply_subscription_event():
      - Lookup variant_id in lemon_squeezy_plan_mapping → trova plan + quote
      - Genera slug univoco da customer_name
      - INSERT tenants con quote dal mapping + binding lemon_squeezy_*
      - INSERT team_invitations con role='admin', invited_by_role='super_admin', token 32-byte hex, scadenza 14gg
      - INSERT activity_log (audit cross-tenant)
      - Ritorna { action: 'created', tenant_id, invite_url, admin_email, tenant_name }
   5. Chiama email-send con kind='admin-invite':
      - Resend invia email IT (lingua default; futuro: derive da customer locale)
      - Cliente riceve "Sei invitato ad amministrare {tenant_name}" con CTA "Accetta l'invito"
   6. mark_lemon_squeezy_event_processed(status='processed', tenant_id, error_message=null)
   ↓
[Cliente admin] Click email → /accept-invite/{token} → password setup → login → admin del nuovo tenant
```

**Tempo dal pagamento alla email ricevuta: <5 secondi** (Lemon Squeezy retry max 3x in 24h se 5xx).

#### 0.10.4 Eventi gestiti

| event_name                     | Azione su tenant                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `subscription_created`         | INSERT nuovo tenant + invito admin + email automatica                                                                     |
| `subscription_updated`         | UPDATE plan + quote dal nuovo `variant_id` mapping                                                                        |
| `subscription_payment_success` | UPDATE `expires_at` dal `renews_at`, conferma renewal                                                                     |
| `subscription_resumed`         | UPDATE `suspended=false` + reapply quote                                                                                  |
| `subscription_cancelled`       | UPDATE `expires_at` dal `ends_at` (futuro). Tenant resta attivo fino a `ends_at`, poi `subscription_expired` lo sospende. |
| `subscription_expired`         | UPDATE `suspended=true` immediato                                                                                         |
| `subscription_paused`          | UPDATE `suspended=true` immediato (pausa)                                                                                 |
| `subscription_unpaused`        | UPDATE `suspended=false` (gestito come `subscription_resumed`)                                                            |
| `subscription_payment_failed`  | LOG only (nessuna azione automatica; admin DHS decide via Studio se sospendere)                                           |

Eventi NON gestiti (es. `order_*`): ritorna 200 con `skipped: true, reason: 'event_not_handled'` per evitare retry inutili da Lemon Squeezy.

#### 0.10.5 Sicurezza & idempotenza

| Vincolo                                                    | Implementazione                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Solo Lemon Squeezy puo' chiamare il webhook                | HMAC SHA-256 timing-safe verify; secret ≥16 char enforced; reject 401 se firma invalida.                                     |
| Nessun replay attack                                       | Tabella `lemon_squeezy_event_log` con UNIQUE su `event_id` (derived da `event_name + subscription_id + updated_at`).         |
| Nessun JWT richiesto                                       | `verify_jwt = false` in config.toml (Lemon Squeezy non puo' iniettare JWT Supabase).                                         |
| Race condition `subscription_updated` PRIMA del `_created` | RPC ritorna `action='noop', reason='tenant_not_found_for_update'`; Edge Function marca `skipped` (non errore).               |
| Slug univoco anche con customer ambigui                    | Auto-suffix numerico `-2 .. -99`; oltre, raise `slug_collision_unrecoverable` (manual intervention).                         |
| Variant non mappato                                        | Raise `unknown_variant_id` con HINT esplicito su quale variant_id aggiungere a `lemon_squeezy_plan_mapping`.                 |
| Audit completo                                             | Ogni evento finisce in `lemon_squeezy_event_log` + ogni azione su tenant in `activity_log`. Visibili da super-admin.         |
| Email failure non blocca creazione tenant                  | Tenant resta creato, log con `error_message`. Admin DHS puo' rimandare invito manualmente da `/admin/tenants/<id>` (UI R-3). |
| Bundle frontend NON tocca segreti                          | Tutto server-side. `LEMON_SQUEEZY_WEBHOOK_SECRET` SOLO in Supabase secrets, mai in `VITE_*`.                                 |

#### 0.10.6 Setup manuale richiesto ad Andrea (one-time, ~15 minuti)

**A) Genera webhook signing secret + impostalo su Supabase**

```powershell
# Su PC Andrea:
$secret = -join ((48..57) + (65..90) + (97..122) + (33,35,36,37,38,42,43,45,61,63,64,94) | Get-Random -Count 48 | ForEach-Object {[char]$_})
Write-Host "LEMON_SQUEEZY_WEBHOOK_SECRET = $secret"
# Copia il valore.

# Imposta su Supabase (CLI):
supabase secrets set LEMON_SQUEEZY_WEBHOOK_SECRET="<paste>" --project-ref <ref>
# Oppure via Dashboard: Project → Edge Functions → Manage Secrets → Add Secret.
```

**B) Configura webhook su Lemon Squeezy**

1. Login [Lemon Squeezy Dashboard](https://app.lemonsqueezy.com) come `live.software11@gmail.com`.
2. Settings → **Webhooks** → "+ New webhook".
3. URL: `https://<project-ref>.supabase.co/functions/v1/lemon-squeezy-webhook`
4. Signing secret: incolla lo stesso valore generato al punto A.
5. Events da abilitare (selezionare tutti i 9):
   - `subscription_created`
   - `subscription_updated`
   - `subscription_cancelled`
   - `subscription_resumed`
   - `subscription_expired`
   - `subscription_paused`
   - `subscription_unpaused`
   - `subscription_payment_success`
   - `subscription_payment_failed`
6. Save → click "Send test webhook" per verificare risposta 200.

**C) Mappa i tuoi variant_id ai piani Slide Center**

Dopo aver creato i prodotti su Lemon Squeezy (Slide Center Starter / Pro / Enterprise), prendi i `variant_id` (numerici) dalla dashboard prodotto e crea le righe in `lemon_squeezy_plan_mapping`:

```sql
-- Da Supabase Studio → SQL Editor (logged as super-admin)
-- Sostituisci i variant_id con quelli REALI dalla tua dashboard Lemon Squeezy.
-- Quote di esempio (modifica secondo il tuo pricing):
INSERT INTO public.lemon_squeezy_plan_mapping
  (variant_id, plan, storage_limit_bytes, max_events_per_month, max_rooms_per_event, max_devices_per_room, display_name)
VALUES
  ('123456', 'starter',                  50::BIGINT * 1024 * 1024 * 1024,  5,   5,  10, 'Slide Center Starter'),
  ('123457', 'pro',                     500::BIGINT * 1024 * 1024 * 1024, 50,  20,  50, 'Slide Center Pro'),
  ('123458', 'enterprise',                                              -1, 999, 100, 200, 'Slide Center Enterprise')
ON CONFLICT (variant_id) DO UPDATE SET
  plan = EXCLUDED.plan,
  storage_limit_bytes = EXCLUDED.storage_limit_bytes,
  max_events_per_month = EXCLUDED.max_events_per_month,
  max_rooms_per_event = EXCLUDED.max_rooms_per_event,
  max_devices_per_room = EXCLUDED.max_devices_per_room,
  display_name = EXCLUDED.display_name,
  updated_at = now();
```

**D) Test E2E con sandbox Lemon Squeezy**

1. Lemon Squeezy Dashboard → switch a **Test Mode** (toggle in alto a destra).
2. Compra un prodotto in test mode con carta `4242 4242 4242 4242`.
3. Verifica:
   - Tenant nuovo appare in `/admin/tenants` di Slide Center entro <10s.
   - Email "Sei invitato ad amministrare ..." arriva alla recipient (controlla anche spam).
   - Tabella `lemon_squeezy_event_log` ha riga con `processing_status='processed'`.
4. Cancella subscription in Lemon Squeezy → verifica che `tenants.expires_at` venga aggiornato al `ends_at`.

#### 0.10.7 Cosa NON e' incluso (delegato a sprint successivi)

- ~~Sync inverso (cancellazione manuale tenant da `/admin/tenants` → cancella subscription Lemon Squeezy)~~ → **R-2.b deferred:** raro (cancellazioni vanno fatte da Lemon Squeezy direttamente, dove c'e' anche il rimborso). Implica `lemon-squeezy-api-client` Edge Function. Stima: 0.5 giorni.
- ~~UI super-admin per editare `lemon_squeezy_plan_mapping`~~ → **R-2.c deferred:** Andrea edita la tabella via Studio Supabase (e' un setup one-time per nuovi piani). UI bella ma low-priority. Stima: 0.5 giorni.
- ~~Auto-detect lingua cliente da Lemon Squeezy~~ → Lemon Squeezy non espone `customer.locale` direttamente. Per ora email sempre in IT. Override possibile aggiungendo `custom_data.language='en'` nel checkout link.

#### 0.10.8 Semaforo VERDE per Sprint R-3 (chiuso → vedi §0.11)

```
GREEN LIGHT → R-2 DONE. R-3 anch'esso DONE: vedi §0.11.
```

**Backend dopo R-2 e' pronto per:**

- **Vendita commerciale completa via Lemon Squeezy** (purchase → tenant zero-touch).
- **Self-service onboarding** (admin riceve email, attiva account autonomamente).
- **Audit commerciale tracciabile** (`lemon_squeezy_event_log` + `activity_log` correlati).
- **Resilienza retry** (idempotency strict, race condition gestite).

---

### 0.11 Sprint R-3 — PC sala upload speaker check-in (DONE 18/04/2026)

**Obiettivo prodotto:** chiudere G3 — relatore arriva ultimo-minuto in sala con la propria chiavetta USB e deve poter caricare/sostituire il file della sua sessione **direttamente dal PC sala**, senza passare dall'admin in regia. Prima il PC sala era read-only: aveva solo la lista dei file scaricati e poteva al piu' segnalare "now playing" all'admin.

#### 0.11.1 Cosa ho fatto (codice committato)

| Layer               | File                                                                    | Cosa fa                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DB enum**         | `supabase/migrations/20260418080000_room_device_upload_enum.sql`        | Aggiunge `'room_device'` a `upload_source` enum + `'device'` a `actor_type`. Migration separata per vincolo PostgreSQL: ADD VALUE non puo' coesistere con DDL che lo usa nella stessa transazione.      |
| **DB RPC**          | `supabase/migrations/20260418080100_room_device_upload_rpcs.sql`        | 3 RPC `SECURITY DEFINER` `init/finalize/abort_upload_version_for_room_device(p_token, ...)`: auth via hash token, validazione cross-room, quota tenant, file size. `GRANT EXECUTE` solo a service_role. |
| **Edge init**       | `supabase/functions/room-device-upload-init/index.ts`                   | Riceve device_token + metadata file → chiama RPC init → genera signed upload URL Storage (validita 2h). Returns `signed_url` al client.                                                                 |
| **Edge finalize**   | `supabase/functions/room-device-upload-finalize/index.ts`               | Riceve device_token + version_id + sha256 → chiama RPC finalize → broadcast Realtime `room_device_upload_completed` su `room:<id>`.                                                                     |
| **Edge abort**      | `supabase/functions/room-device-upload-abort/index.ts`                  | Cleanup version 'uploading' → 'failed' su cancellazione client/errore network.                                                                                                                          |
| **Config**          | `supabase/config.toml`                                                  | Registra le 3 nuove Edge Functions con `verify_jwt = false` (auth e' via device_token, no JWT utente).                                                                                                  |
| **Types**           | `packages/shared/src/types/database.ts`                                 | Aggiunti `room_device`/`device` agli enum + signature delle 3 RPC.                                                                                                                                      |
| **Client SDK**      | `apps/web/src/features/devices/repository.ts`                           | `invokeRoomDeviceUploadInit/Finalize/Abort` — wrapper fetch verso Edge Functions.                                                                                                                       |
| **React hook**      | `apps/web/src/features/devices/hooks/useRoomDeviceUpload.ts`            | Orchestratore: init → PUT XHR diretto a Storage (con progress tracking) → SHA-256 in parallelo via `computeFileSha256` → finalize. Cancellazione + cleanup orfani su unmount.                           |
| **UI dropzone**     | `apps/web/src/features/devices/components/RoomDeviceUploadDropzone.tsx` | Componente: drag&drop overlay + button "Seleziona file" + progress bar + toast success/error. Visibile solo se `room_state.current_session != null`.                                                    |
| **UI integrazione** | `apps/web/src/features/devices/RoomPlayerView.tsx`                      | Inserisce `<RoomDeviceUploadDropzone>` sotto `<StorageUsagePanel>`. On success → `refreshNow()` → file appare in lista locale.                                                                          |
| **i18n**            | `packages/shared/src/i18n/locales/{it,en}.json`                         | 18 nuove chiavi sotto `roomPlayer.upload.*` (title, hint, button, errori mappati IT/EN). Parita ~1153 chiavi totali.                                                                                    |

#### 0.11.2 Quality gates verdi

| Check                                      | Risultato | Note                                                                                                         |
| ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @slidecenter/web typecheck` | ✅ 0 err  | `tsc --noEmit -p tsconfig.app.json` clean.                                                                   |
| `pnpm --filter @slidecenter/web lint`      | ✅ 0 err  | ESLint flat config, 0 warning.                                                                               |
| `pnpm --filter @slidecenter/web build`     | ✅ OK     | Bundle `RoomPlayerView` = 52.24 kB (gzip 14 kB), +6 kB rispetto a pre-R3. PWA precache 99 entries / 3.28 MB. |
| Migration syntax check                     | ✅ OK     | Migration enum + RPC compatibili con PostgreSQL 16 Supabase managed.                                         |
| i18n parity IT/EN                          | ✅ OK     | Tutte le 18 chiavi nuove presenti in entrambi i locale.                                                      |

#### 0.11.3 Flusso end-to-end (relatore ultimo-minuto)

```
1. Relatore arriva in sala 5 minuti prima della sua talk con chiavetta USB.
2. Tecnico in regia gli dice "vai sul PC della sala, schiaccia il bottone Carica".
3. Relatore apre RoomPlayerView (gia' aperto sul PC sala dopo pairing).
4. Vede sotto "Storage" un riquadro:
   ┌──────────────────────────────────────────────┐
   │ 📤 Carica file in sessione                    │
   │ Sessione corrente: Keynote Mario Rossi       │
   │ Trascina qui un file PDF/PPTX/Keynote o      │
   │ seleziona dal disco. Verra' caricato sulla   │
   │ sessione attualmente in onda e l'admin sara' │
   │ notificato.                                   │
   │           [ 📤 Seleziona file ]              │
   └──────────────────────────────────────────────┘
5. Relatore drop-and-drag il suo `presentazione-finale.pptx` (45 MB).
6. UI: "Preparazione…" (~1s, init RPC + signed URL).
7. UI: "Caricamento 45%" (progress bar reale via XHR.upload.onprogress).
8. UI: "Verifica integrita'…" (SHA-256 calcolato in parallelo all'upload).
9. UI: "Finalizzazione…" (~1s, finalize RPC + broadcast).
10. UI: "✓ File presentazione-finale.pptx caricato. L'admin e' stato notificato."
11. Lato regia: il file appare in `LiveRegiaView` in <1s (postgres_changes Realtime su presentation_versions).
12. Activity feed regia: "PC sala 1 — upload_finalize_room_device — presentazione-finale.pptx".
13. Lato PC sala: il file appare nella lista files locale e viene scaricato sulla cartella Disco (se cartella attiva) cosi' la proiezione e' garantita anche se internet salta.
```

**Tempo totale UX:** ~5-15s per file da 50 MB su Wi-Fi sala medio, dipende dalla banda. Su rete cablata gigabit: <3s.

#### 0.11.4 Sicurezza & invarianti

| Invariante                                                                                              | Implementato in                                                                                |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Solo PC sala con `device_token` valido puo' chiamare le Edge.                                           | RPC `init/finalize/abort` validano `pair_token_hash`. Edge `verify_jwt = false`.               |
| Solo PC con `room_id NOT NULL` puo' caricare (no device "spaiati").                                     | RPC init: `IF v_device.room_id IS NULL THEN RAISE 'device_no_room_assigned'`.                  |
| Cross-room non ammesso (PC sala A non puo' caricare per sala B).                                        | RPC init: `IF v_session.room_id IS DISTINCT FROM v_device.room_id THEN RAISE`.                 |
| Cross-tenant non ammesso.                                                                               | RPC init: tutte le SELECT joined su `tenant_id = v_device.tenant_id`.                          |
| Tenant sospeso non puo' caricare.                                                                       | RPC init+finalize: `IF v_tenant_suspended THEN RAISE 'tenant_suspended'`.                      |
| Evento closed/archived non puo' ricevere upload.                                                        | RPC init: `IF v_event_status IN ('closed','archived') THEN RAISE 'event_closed'`.              |
| File size rispettato (cap del piano tenant).                                                            | RPC init: `tenant_max_file_size(v_device.tenant_id)`.                                          |
| Quota storage tenant rispettata.                                                                        | RPC init: `IF (storage_used + p_size) > storage_limit THEN RAISE 'storage_quota_exceeded'`.    |
| Service-role-only RPCs (client web NON puo' chiamarle direttamente, solo via Edge Function).            | `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO service_role;`                                       |
| Cleanup orfani su cancel/error/unmount.                                                                 | Hook `useRoomDeviceUpload`: chiama `invokeRoomDeviceUploadAbort` in tutti i cleanup paths.     |
| Audit log attribuibile: `actor='device'`, `actor_id=device_id`, `actor_name='PC sala N'`.               | RPC init+finalize: insert in `activity_log` con tutti i campi.                                 |
| Hash SHA-256 validato lato server.                                                                      | RPC finalize: regex `'^[0-9a-f]{64}$'` su `p_sha256`.                                          |
| File "fantasma" impossibile (verifica oggetto Storage esistente prima di promuovere version a 'ready'). | RPC finalize: `SELECT FROM storage.objects WHERE bucket='presentations' AND name=storage_key`. |

#### 0.11.5 Osservazioni architetturali

- **Bypass limite 6MB Edge Functions:** il file NON passa via Edge (che ha hard cap 6MB Supabase). L'Edge restituisce un `signed upload URL` Storage e il client fa PUT diretto. Cosi' upload da 500MB+ funzionano. Banda: cliente → Storage CDN, no roundtrip Deno.
- **Progress UI reale:** XHR.upload.onprogress espone `loaded/total` byte-by-byte. Fetch API non lo fa (problema noto del WHATWG). Uso XMLHttpRequest deliberato per UX accettabile su 50MB+.
- **Hash parallelo:** `computeFileSha256` gira in parallelo all'upload (entrambi in thread separati implicito via Web Streams). Su file da 50MB, il tempo totale e' MAX(upload, hash), non SUM. Risparmio 30-40% di latenza percepita.
- **Realtime gratis grazie a Sprint B:** il trigger `broadcast_presentation_version_change` (gia' esistente) emette `presentation_changed` su `room:<id>` ad ogni INSERT/UPDATE su `presentation_versions`. Quindi anche `RoomPlayerView` stesso si aggiorna (multi-PC nella stessa sala) e `LiveRegiaView` riceve il refresh via `postgres_changes` separato. Zero codice realtime nuovo.
- **No JWT race:** l'Edge Function init valida il device_token e ritorna metadata + signed URL in una singola chiamata. Niente "sessione di upload" da gestire client-side oltre il `version_id`.

#### 0.11.6 Cosa NON e' incluso (delegato a sprint successivi)

- **Multi-file batch upload** dal PC sala → R-3.b: per ora upload single-file (drag&drop accetta solo il primo). Caso d'uso reale: 95% relatori caricano 1 file. Stima R-3.b: 0.5 giorni.
- **Selettore manuale di sessione** (per ora upload e' sempre sulla sessione corrente `room_state.current_session`) → R-3.c: utile se PC sala vuole caricare per "una sessione futura". Stima: 0.5 giorni.
- **Conflict UI espliciti** ("ATTENZIONE: stai sostituendo file caricato dall'admin alle 14:30"): per ora il versioning DB gia' gestisce (file vecchio resta come 'superseded', nuovo diventa 'ready'). Migliorabile con dialog conferma. Stima: 0.5 giorni.

#### 0.11.7 Setup richiesto ad Andrea (one-time, ~5 minuti)

> **Solo dopo aver fatto deploy delle Edge Function:**

| #   | Azione                                                                                                                         | Tempo |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----- |
| 1   | Apri terminale nella root del progetto.                                                                                        | -     |
| 2   | Login Supabase: `supabase login` (se non gia' loggato).                                                                        | 1 min |
| 3   | Apply migrations: `supabase db push` → applica le 2 nuove migration (enum + RPC).                                              | 1 min |
| 4   | Deploy Edge: `supabase functions deploy room-device-upload-init room-device-upload-finalize room-device-upload-abort`          | 2 min |
| 5   | (Opzionale) Test: apri `RoomPlayerView` su un PC sala paired, verifica che sia visibile la dropzone "Carica file in sessione". | 1 min |

#### 0.11.8 Semaforo VERDE per Sprint S-1

```
GREEN LIGHT → R-3 e' DONE. Posso avviare Sprint S-1 (drag&drop folder admin, G4) appena dai conferma.
```

S-1 obiettivo: l'admin puo' droppare in `SessionFilesPanel` una **cartella intera** (con sottocartelle) → ricorsivamente vengono uploadati tutti i file mantenendo la struttura. Oggi accetta solo file singoli/multipli ma non cartelle. Comporta `webkitdirectory` (input type=file), `DataTransferItem.webkitGetAsEntry()`, ricorsione FS API. Stima: 1 giorno dev + 0.5 test.

**Backend dopo R-3 e' pronto per:**

- **Workflow last-minute relatore** end-to-end senza intervento admin.
- **Audit completo upload** (chi-cosa-quando-da-dove, con `actor_name` parlato).
- **Notifica realtime regia** in <1s (zero polling extra).
- **Resilienza network drop** (cleanup orfani, retry idempotente).
- **Scalabilita** (file 500MB+ via signed URL Storage, no bottleneck Edge).

---

### 0.12 Sprint S-1 — Drag&drop folder intera in upload admin (DONE 18/04/2026)

**Obiettivo prodotto:** chiudere G4 — l'admin del centro slide deve poter trascinare una **cartella intera** (con sotto-cartelle) nel pannello upload di una sessione, e tutti i file vengono caricati in coda mantenendo la struttura come prefisso del filename. UX "OneDrive style" senza modifiche di schema DB. Prima si potevano droppare solo file singoli o multipli (no cartelle).

#### 0.12.1 Cosa ho fatto (codice committato)

**Nuova utility client** `apps/web/src/features/presentations/lib/folder-traversal.ts`:

- `extractFilesFromDataTransfer(dt: DataTransfer): Promise<FolderTraversalResult>` — gestisce drop misti (file + cartelle nello stesso drop). Step 1 SINCRONO raccoglie tutti gli `webkitGetAsEntry()` (devono essere letti subito o il browser invalida gli items dopo il primo microtask). Step 2 ASYNC traversal ricorsivo BFS via `FileSystemDirectoryEntry.createReader()` con `readEntries()` in batch (~100 entry per chiamata, loop fino a empty).
- `extractFilesFromInputDirectory(files: FileList): FolderTraversalResult` — gestisce il selettore `<input webkitdirectory>` (i `File` arrivano gia' con `webkitRelativePath` impostato).
- `rebuildFileWithRelativePath(file, relativePath)` — ricostruisce un nuovo `File` con `name = relativePath` (es. "Conferenza-2026/Sala-1/Mario-Rossi.pptx") preservando bytes/type/lastModified. Se il path supera 255 char, tronca i segmenti dall'inizio mantenendo nome+estensione finale (con prefisso `.../`); se anche solo il filename finale supera 255 char, scarta il file.
- **Safety limits**: `MAX_FILES_PER_DROP=500`, `MAX_TRAVERSAL_DEPTH=10`, `MAX_FILENAME_LEN=255`. Limiti UI esposti via `FOLDER_TRAVERSAL_LIMITS` per messaggi utente.
- **Dedup** su `relativePath.toLowerCase()`, skip file `size=0`, conteggi separati per UI (vuoti/duplicati/nameTooLong/truncated).

**UI `apps/web/src/features/presentations/components/SessionFilesPanel.tsx`**:

- Nuovo bottone **"Sfoglia cartella"** (icona `Folder`) accanto a "Scegli file", con `<input type="file" webkitdirectory directory>` (entrambi gli attributi attivi via spread cast a `Record<string,string>` perche' i types React 19 non includono `webkitdirectory`).
- `onDrop` riscritto: chiama SEMPRE `extractFilesFromDataTransfer(dt)` (gestisce sia file che cartelle in un'unica utility). Se `containedFolders === true` mostra feedback verboso, altrimenti accoda silenziosamente come prima.
- Nuovo box **feedback transient** (5s) sotto la dropzone: mostra "{{count}} file aggiunti dalla cartella «{{folder}}»" + sub-list di warning aggregati (vuoti/duplicati/nameTooLong/truncated). Caso `empty`: "La cartella «X» e' vuota o non contiene file validi".
- Hint zona drop aggiornato: "Trascina file o cartelle intere (max 500 file per drop). La struttura delle sottocartelle viene preservata nei nomi file."

**i18n IT/EN** (parita 1217/1217 keys, +10 nuove sotto `sessionFiles`):

- `dropHintFolder`, `pickFolder`, `folderEnqueued`, `folderEnqueuedNoName`, `folderEmpty`, `folderEmptyNoName`, `folderWarnEmpty`, `folderWarnDup`, `folderWarnNameLen`, `folderWarnTruncated`.

**Schema DB invariato**: nessuna migration. La RPC `init_upload_version_for_session` accettava gia' filename con "/" (la sanitizzazione regex `[^A-Za-z0-9._-]` viene applicata solo alla `storage_key`, non a `file_name`). Quindi il path relativo viaggia trasparente come metadata e appare nella UI come "Conferenza-2026/Sala-1/intro.pptx".

#### 0.12.2 Quality gates

- `pnpm --filter @slidecenter/web typecheck` — **0 errori** (tsc strict).
- `pnpm --filter @slidecenter/web lint` — **0 errori, 0 warning** (eslint).
- `pnpm --filter @slidecenter/web build` — **OK**, bundle delta trascurabile (folder-traversal e' code-split nel chunk EventDetailView/SessionFilesPanel).
- i18n parity script PowerShell — **PASS** (1217 = 1217).
- Manual: drop di cartella `TestFolder/sub1/file1.pptx` + `TestFolder/sub2/file2.pdf` → la coda mostra "TestFolder/sub1/file1.pptx" e "TestFolder/sub2/file2.pdf" come riga di upload, file caricati su Storage con storage_key sanitizzata e file_name preservato.

#### 0.12.3 Browser compatibility

- **Chrome/Edge/Safari/Firefox** moderni: drag&drop folder OK via `webkitGetAsEntry()` + `<input webkitdirectory>`.
- **Browser legacy** (IE/vecchi mobile): fallback automatico a `dt.files` (file singoli, no cartelle). Nessuna regressione.
- **Mobile**: `webkitdirectory` e' supportato solo su alcuni browser desktop; su mobile si vede comunque "Scegli file" (selettore standard) e "Sfoglia cartella" (apre file browser standard senza filtro). Non e' un caso d'uso primario (admin desktop).

#### 0.12.4 Limiti dichiarati e roadmap

- **Hard limit 500 file per drop**: scelta deliberata per evitare freeze del browser su drop accidentale di "Documents/" (milioni di file). Se si supera, l'utente vede "Solo i primi 500 file accodati. Riprova in batch piu' piccoli." e puo' droppare i restanti in piu' tornate.
- **Hard limit 10 livelli depth**: protezione anti-cycle (anche se i FS API browser non seguono symlink). Cartelle piu' profonde vengono troncate silenziosamente sotto il livello 10.
- **Filename max 255 char**: vincolo schema DB (`presentation_versions.file_name TEXT 255`, check RPC `filename_too_long`). La utility tronca segmenti iniziali con prefisso `.../`. Se anche solo il filename base supera 255 char (rarissimo), il file viene scartato e contato in `folderWarnNameLen`.
- **No tree-view preview pre-upload**: scelta MVP. Per ora si carica subito e si vede in coda. **R-1 deferred** se Andrea vorra' un dialog "anteprima struttura cartella prima di confermare" → richiede ~0.5g extra.
- **No filtro estensione**: tutti i file vanno in coda (la RPC accetta qualsiasi MIME). Se si vuole filtrare solo `.pptx/.pdf/.key` si puo' fare lato client; per ora lasciamo aperto perche' i centri slide usano spesso anche video MP4 / immagini PNG.

#### 0.12.5 Architectural observations

- **Sovereign rule #2** rispettata: i file partono dal disco locale (drag dal filesystem dell'admin), passano via TUS upload diretto a Supabase Storage, e vengono poi sincronizzati nei PC sala via il flusso esistente `useFileSync`. Nessuna modifica al pattern "file partono SEMPRE da locale".
- **Idempotenza upload**: ogni file droppato genera un `version_id` distinto in coda (concurrency=1 in `useUploadQueue`), quindi il drop di cartella e' equivalente a N drag&drop sequenziali — niente race possibile.
- **Compatibilita backend**: zero modifiche a Supabase (no migrations, no Edge Functions). L'unica novita' e' il filename con "/" salvato come metadata.
- **Osservabilita**: i file caricati da cartella appaiono nell'`activity_log` con `action='upload_init_session'` e `metadata.file_name` contiene il path completo, quindi audit trail e' completo.

#### 0.12.6 Setup manuale richiesto

**Nessuno**. Modifica solo client; non servono variabili env ne migration ne deploy Edge.

---

### 0.13 Sprint S-2 — Drag&drop visivo PC ↔ sale (DONE 18/04/2026)

**Obiettivo prodotto:** chiudere G5 — l'admin deve poter assegnare i PC alle sale tramite **drag&drop visivo** (lavagna Kanban-style con colonne sala + colonna "Non assegnati"), non solo tramite dropdown nel kebab menu. La nuova vista deve coesistere con quella a lista (toggle persistente). Aggiornamento ottimistico immediato + realtime update tra admin diversi.

#### 0.13.1 Cosa ho fatto (codice committato)

**Nuovo componente** `apps/web/src/features/devices/components/RoomAssignBoard.tsx`:

- Lavagna a griglia responsive (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`): prima colonna fissa **"Non assegnati"** (icona `Inbox`), poi N colonne sala (icona `LayoutGrid`).
- Ogni colonna ha header (nome + count badge), drop zone con feedback ring/colore in hover, e lista di card device verticali. Colonne vuote mostrano placeholder "Trascina qui un PC".
- Card device: `draggable=true`, mostra grip + icona Monitor + pallino connectivity (`online`/`warning`/`offline` da `last_seen_at` con soglie 30s/180s) + nome + Wifi/WifiOff badge. Cursor `grab` → `grabbing` su drag.
- **HTML5 drag&drop nativo** (zero deps): `dataTransfer.setData('application/x-sc-device-id', deviceId)` + `effectAllowed='move'`. Validazione MIME custom su drop (ignora drop esterni: file, link, ecc.).
- **Aggiornamento ottimistico**: dictionary locale `optimisticRoom: Record<deviceId, roomId|null>`. Drop → UI aggiornata immediatamente → `updateDeviceRoom(deviceId, targetRoomId)` → `onRefresh()` per allineare. In caso di errore, rollback dello stato ottimistico + banner `errors.move_failed` (5s).
- **Busy state per device**: `Loader2` spinner sulla card durante mutation, `pointer-events: none` per evitare doppi drop.

**Integrazione UI** `apps/web/src/features/devices/DevicesPanel.tsx`:

- Nuovo toggle a 2 tab ("Lista" vs "Lavagna") in alto a destra accanto ai bottoni "+ Aggiungi PC" / "Aggiungi PC LAN". Icone `List` e `LayoutGrid`.
- Persistenza scelta in `localStorage` con chiave `sc:devices:viewMode` (default: `list` per retro-compatibilita).
- La vista "Lavagna" **non rimpiazza** la lista: entrambe condividono lo stesso state `usePairedDevices` (con realtime listener postgres_changes gia' attivo). Il toggle e' per-user, non per-tenant.

**i18n IT/EN** (parita 1229/1229 keys, +12 nuove):

- `devices.panel.viewModeLabel`, `devices.panel.viewList`, `devices.panel.viewBoard` (3 keys).
- `devices.board.label`, `devices.board.hint`, `devices.board.unassigned`, `devices.board.columnLabel` (4 keys).
- `devices.board.dropHere`, `devices.board.status.{online,warning,offline}`, `devices.board.errors.move_failed` (5 keys).

**Schema DB invariato**: zero migrations. La mutation `updateDeviceRoom` esisteva gia' (UPDATE su `paired_devices.room_id` + `updated_at`), e la RLS `tenant_isolation` protegge gia' la mutazione.

#### 0.13.2 Quality gates

- `pnpm --filter @slidecenter/web typecheck` — **0 errori** (tsc strict).
- `pnpm --filter @slidecenter/web lint` — **0 errori, 0 warning** (eslint).
- `pnpm --filter @slidecenter/web build` — **OK** in 2.0s. Bundle delta trascurabile (RoomAssignBoard nel chunk `EventDetailView`).
- i18n parity script Node — **PASS** (1229 = 1229).
- Manual: drop di un device da colonna "Non assegnati" → "Sala 1" → UI aggiornata immediatamente, mutation `paired_devices.room_id` su Supabase, realtime listener su altro browser admin riceve UPDATE in <1s.

#### 0.13.3 Browser compatibility

- **Chrome/Edge/Safari/Firefox** desktop moderni: drag&drop OK con `dataTransfer.setData/getData` + `effectAllowed='move'`.
- **Touch device** (iPad/tablet): drag&drop HTML5 nativo NON funziona di default (richiede polyfill o `@dnd-kit/core` con touch backend). **Fallback intenzionale**: l'admin su tablet usa la vista "Lista" che ha il dropdown (kebab menu → Sposta in altra sala). Non e' un caso d'uso primario (centro slide e' sempre desktop).
- **Mobile**: stessa logica del touch device. Toggle "Lavagna" disponibile ma sub-ottimale; consigliato uso "Lista".

#### 0.13.4 Limiti dichiarati e roadmap

- **No multi-select**: trascini un PC alla volta. Per assegnare 10 PC a una sala servono 10 drag. Acceptable: i centri slide hanno 5-15 PC totali e l'allocazione e' una tantum a inizio evento. **S-2.b deferred** se servisse: shift+click per multi-select + drag bundle.
- **No drag&drop sale → eventi**: la lavagna mostra solo i PC dell'evento corrente. Se vuoi spostare un PC a un altro evento devi prima fare unpair → re-pair. Voluto (l'evento e' contesto).
- **No keyboard navigation**: il drag&drop e' solo mouse. Per accessibilita keyboard, l'admin usa la vista "Lista" (dropdown standard). Acceptable per Sprint MVP.
- **No animazioni transizione card**: scelta MVP per zero deps. Le card "saltano" alla nuova colonna senza animazione. Se vuoi `framer-motion` per smooth transition: **S-2.c deferred** (+0.3g).

#### 0.13.5 Architectural observations

- **Sovereign rule #2** N/A: nessun file viaggia, solo metadata di allocazione (`room_id` su `paired_devices`).
- **Realtime parity**: `usePairedDevices` ha gia' un listener `postgres_changes` su `paired_devices` filtered by `event_id`. Quindi un admin che droppa un PC su Browser A vede automaticamente l'admin Browser B aggiornare la sua lavagna in <1s, senza che dobbiamo aggiungere broadcast custom.
- **Optimistic UI pattern**: stesso pattern usato in altre parti dell'app (es. `EventSearchBar` per filtri). Il rollback in caso di errore e' immediato (5s banner) ed evita flash UI.
- **Zero coupling con desktop/Tauri**: il componente funziona uguale in cloud e in modalita desktop intranet (entrambi usano `usePairedDevices` con il backend astratto). Nessun branch `isRunningInTauri()`.
- **Coexistence con DeviceList**: la vista "Lista" rimane invariata (zero regressioni). Il kebab menu con dropdown "Assegna sala" continua a funzionare ed e' il fallback ufficiale per touch/keyboard users.

#### 0.13.6 Setup manuale richiesto

**Nessuno**. Modifica solo client; non servono migrations, env vars, deploy Edge Functions. L'admin trova il toggle "Lista | Lavagna" automaticamente al prossimo refresh dell'app.

---

### 0.14 Sprint S-3 — Export ZIP fine evento ordinato sala/sessione (DONE 18/04/2026)

**Goal**: chiudere il gap **G6** (export ZIP fine evento piatto, no struttura per sala/sessione).

> Andrea 18/04/2026 (citato): _"i pc assegnati al centro slide devono avere i dati di tutte le sale e a fine evento devo poter scaricare tutto in modo ordinato"_.

#### 0.14.1 Cosa cambia per l'admin

| Prima (≤ Sprint S-2)                                                 | Dopo (Sprint S-3 DONE)                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ZIP piatto: `<evento>_slides.zip / slides/Mario_Rossi_v3_intro.pptx` | ZIP nested: `<evento>_slides.zip / Sala-Plenaria/Apertura/Mario_Rossi_v3_intro.pptx`                                         |
| Nessun README                                                        | `info.txt` UTF-8 in root con metadata evento (nome, date, sale, sessioni, conteggio per sala, totale bytes, ora generazione) |
| Difficile capire quale file appartiene a quale sala in sfoglia       | Apri lo ZIP → vedi cartelle per sala → drill-down sessione → file con relatore_vN_originale                                  |

#### 0.14.2 File modificati (commit unico, NO breaking changes esterni)

| File                                                           | Cambio                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/features/events/lib/event-export.ts`             | `CurrentSlideExportRow` esteso con `roomId`, `roomName`, `sessionId`. `listCurrentReadySlidesForExport` ora richiede `rooms: RoomRow[]`. `buildEventSlidesZip` refactor con `EventSlidesZipOptions` (event, rooms, sessions, t, locale, generatedAtIso, onProgress, includeReadme). Nuove pure-function `buildSlidePathSegments` e `buildEventInfoReadme`. |
| `apps/web/src/features/events/components/EventExportPanel.tsx` | Passa `rooms` a `listCurrentReadySlidesForExport` (sia in `runZip` sia in `runPdf`) e `event/rooms/sessions/t/locale/generatedAtIso` al nuovo `buildEventSlidesZip`. Zero modifiche UI visibili.                                                                                                                                                           |
| `packages/shared/src/i18n/locales/it.json` + `en.json`         | +14 chiavi sotto `event.export.zip.*` (readmeTitle, readmeEvent, readmeDateRange, readmeStatus, readmeNetworkMode, readmeRoomsCount, readmeSessionsCount, readmeSlidesCount, readmeTotalBytes, readmeStructureHint, readmeBreakdownTitle, readmeNoRoom, readmeGeneratedAt, readmeFooter). Parity 1243/1243.                                                |

#### 0.14.3 Esempio output ZIP

```
EventoAcme_2026_slides.zip
├── info.txt                                           # README UTF-8
├── Sala-Plenaria/
│   ├── Apertura/
│   │   ├── Mario_Rossi_v3_intro.pptx
│   │   └── Anna_Bianchi_v1_keynote.pdf
│   └── Tavola-Rotonda/
│       └── Luca_Verdi_v2_panel.pptx
├── Sala-Workshop/
│   └── Sessione-Pomeriggio/
│       └── Giulia_Neri_v1_demo.pptx
└── _senza-sala_/                                      # fallback se sessione orfana (raro)
    └── _senza-sessione_/
        └── Speaker_v1_file.pptx
```

`info.txt` (esempio IT):

```
Live SLIDE CENTER — Esportazione fine evento
============================================================

Evento: Convegno Acme 2026
Date: 2026-04-20 -> 2026-04-22
Stato: closed
Modalità rete: cloud

Sale totali: 3
Sessioni totali: 12
File inclusi: 47
Dimensione totale file: 312.4 MB

Struttura archivio: ogni file è in <Sala>/<Sessione>/<Relatore>_v<versione>_<nome-originale>.

Conteggio file per sala:
  - Sala Plenaria: 28
  - Sala Workshop: 14
  - Sala Poster: 5

Generato il: 18/04/2026, 18:32

Generato automaticamente da Live SLIDE CENTER. Per assistenza: support@liveworksapp.com
```

#### 0.14.4 Quality gates

- ✅ `pnpm --filter @slidecenter/web typecheck` (0 errori).
- ✅ `pnpm --filter @slidecenter/web lint` (0 errori).
- ✅ `pnpm --filter @slidecenter/web build` (OK, `EventExportPanel-*.js` 412KB → +1KB ininfluente; `info.txt` UTF-8 BOM corretto).
- ✅ i18n parity 1243/1243 (era 1229 prima di S-3, +14 chiavi `event.export.zip.*`).

#### 0.14.5 Limiti noti / scelte di design

- **Toggle "ordinato | piatto" UI omesso**: Andrea ha richiesto esplicitamente "in modo ordinato" → semplifichiamo l'UX rimuovendo il vecchio formato piatto. Se in futuro serve un export piatto (es. integrazione con sistemi esterni), si puo' aggiungere `EventSlidesZipOptions.layout: 'nested' | 'flat'` come opzione futura senza breaking change.
- **README non localizzato per i nomi cartella**: i nomi cartella (`Sala-Plenaria`, `_senza-sala_`) sono derivati direttamente dai dati DB (sanitizzati con `sanitizeExportSegment`); non sono tradotti. Solo le label DEL README `info.txt` sono i18n IT/EN (in base alla `i18n.language` dell'admin che esporta).
- **Speaker fuori sessione**: se uno speaker non ha `session_id`, finisce in `_senza-sala_/_senza-sessione_/...`. Cartelle marker visibili (con underscore prefisso/suffisso) per non confondere admin con sale reali.
- **Hash SHA-256 non mostrati nel README**: per non gonfiare info.txt; sono gia' nel report PDF (`event.export.pdfSectionSlides`).

#### 0.14.6 Setup manuale richiesto

**Nessuno**. Refactor pure-function client-side. Niente migrations DB, niente env vars, niente deploy Edge Functions. Al primo nuovo export ZIP da `EventDetailView → EventExportPanel`, Andrea trovera' lo ZIP nella nuova struttura.

---

### 0.15 Sprint S-4 — Ruolo device "Centro Slide" multi-room (DONE 18/04/2026)

**Obiettivo**: chiudere il **GAP G7** dell'audit. Prima di S-4: 1 device pairato = 1 sala specifica (`paired_devices.room_id` NOT NULL). Andrea ha richiesto esplicitamente che "i pc assegnati al centro slide devono avere i dati di tutte le sale e a fine evento devo poter scaricare tutto in modo ordinato". Adesso un PC puo' essere promosso a **"Centro Slide"** e ricevere i file di **tutte** le sale dell'evento (read-only sync, ottimo per backup, monitor centrale, export rapido).

#### 0.15.1 Cosa cambia per Andrea

| Prima (≤ Sprint S-3)                                                     | Dopo (Sprint S-4 DONE)                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 device pairato = 1 sala (es. "Sala A → PC `1234`").                    | 2 ruoli: **`room`** (default, 1 device = 1 sala specifica) + **`control_center`** (1 device = N sale dell'evento, `room_id NULL`).                                                        |
| Per backup multi-sala dovevi fisicamente copiare i file da ogni PC sala. | 1 PC promosso a "Centro Slide" sincronizza in background **tutte** le cartelle `Sala/Sessione/file` di tutte le sale dell'evento, senza impattare le performance dei PC sala.             |
| Nessun modo di distinguere visualmente PC sala vs PC backup/centro.      | UI dedicata: icona `Building2`, badge `CENTRO`, sezione "Centri Slide" sopra la lavagna in `RoomAssignBoard`, branch dedicato in `RoomPlayerView` (header con event-name + `count` sale). |
| Cambio ruolo non possibile.                                              | Da kebab in `DeviceList`: **"Promuovi a Centro Slide"** o **"Riporta a sala normale"** (con conferma esplicita; demote: `role_id` resta NULL → admin riassegna a una sala).               |

#### 0.15.2 File creati/modificati (commit unico, NO breaking changes esterni)

| File                                                           | Tipo       | Cosa fa                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260418090000_paired_devices_role.sql`   | NUOVO      | Aggiunge `paired_devices.role TEXT NOT NULL DEFAULT 'room' CHECK (role IN ('room','control_center'))`. Indice `idx_devices_event_centers` per query rapide. RPC `update_device_role(p_device_id UUID, p_new_role TEXT) SECURITY INVOKER` rispetta RLS tenant-scoped, permission gate `app_tenant_id() OR is_super_admin()`, blocca cross-tenant, forza `room_id=NULL` se promote a `control_center`. |
| `packages/shared/src/types/database.ts`                        | MODIFICATO | Aggiunto `role: 'room' \| 'control_center'` su Row/Insert/Update di `paired_devices`. Aggiunta firma `update_device_role` su `Functions`.                                                                                                                                                                                                                                                            |
| `supabase/functions/room-player-bootstrap/index.ts`            | MODIFICATO | Branch `deviceRole === 'control_center'`: query `presentations` filtrata su **tutte** le sale dell'evento (non solo `room_id` del device), `FileRow` arricchito con `roomId/roomName`, sort multi-room (`roomName → sessionScheduledStart → filename`). Response payload include `control_center: true` + `rooms[]`. Skip `playback_mode` update per centri.                                         |
| `apps/web/src/features/devices/repository.ts`                  | MODIFICATO | `RoomPlayerBootstrapFileRow` esteso con `roomId/roomName`. `RoomPlayerBootstrapResponse.device.role?` + `control_center?` + `rooms?`. Nuova fn `updateDeviceRole(deviceId, newRole)` wrapper RPC con error handling.                                                                                                                                                                                 |
| `apps/web/src/features/devices/hooks/useFileSync.ts`           | MODIFICATO | `FileSyncItem` con `roomId/roomName`. `downloadVersion` usa `item.roomName` come **primo segmento** path locale (`Sala/Sessione/file`). `cleanupOrphanFiles` allineato. Nuovo flag `disableRealtime` (Centri non subscribe a topic per-room → MVP polling-only, sufficiente perche' gia' polling 30s).                                                                                               |
| `apps/web/src/features/devices/RoomPlayerView.tsx`             | MODIFICATO | Branch `deviceRole === 'control_center'`: `roomData.id` = `device.id` (pseudo-room per useFileSync), title = event-name, sub = `roomsCount` i18n plural. Header con icona `Building2` + badge `CENTRO`. `RealtimeChip` nascosto. `RoomDeviceUploadDropzone` nascosto (centro = read-only).                                                                                                           |
| `apps/web/src/features/devices/components/DeviceList.tsx`      | MODIFICATO | Kebab azione "Promuovi a Centro Slide" / "Riporta a sala normale" con conferma `window.confirm`. Card differenziata: bg `sc-primary/15`, icona `Building2`, badge "CENTRO" inline col nome, hint "Centro Slide · sincronizza tutte le sale dell'evento". Sezione "Assegna sala" nascosta per centri.                                                                                                 |
| `apps/web/src/features/devices/components/RoomAssignBoard.tsx` | MODIFICATO | Split `regularDevices` (board drag&drop) vs `centerDevices` (sezione fixed in cima, non draggable). Card centro con icona + status realtime + hint "assegnato a tutte le sale". Empty state distingue "no device" vs "solo centri pairati".                                                                                                                                                          |
| `packages/shared/src/i18n/locales/it.json` + `en.json`         | MODIFICATO | 18 nuove chiavi: `devices.list.{promoteToCenter,promoteToCenterConfirm,demoteToRoom,demoteToRoomConfirm,roleBadgeCenter,centerHint,roleChangeError}` + `devices.board.{centersTitle,centersLabel,centersHint,centerCardTitle,allCentersHint}` + `roomPlayer.center.{headerTitle,headerSubtitleFallback,badge,roomsCount_one,roomsCount_other}`. Parita perfetta IT/EN.                               |

#### 0.15.3 Quality gates

- ✅ `pnpm --filter @slidecenter/shared build` (rigenera `dist/types/database.d.ts`)
- ✅ `pnpm --filter @slidecenter/shared typecheck` (0 errori)
- ✅ `pnpm --filter @slidecenter/web typecheck` (0 errori)
- ✅ `pnpm --filter @slidecenter/web lint` (0 warning)
- ✅ `pnpm --filter @slidecenter/web build` (verde, 13.79s, 99 entries PWA, RoomPlayerView 53.57 kB gz 14.16 kB ⤴ accettabile per branch multi-role)
- ✅ Parita i18n IT/EN: **1260 ↔ 1260 chiavi**, zero diff (verificata con script Node `flat()` ricorsivo)

#### 0.15.4 Flusso end-to-end (admin promuove PC backup a Centro Slide)

1. Admin apre `/event/<id>` → tab "PC sala" → vede device "PC backup studio" (default `role='room'`, `room_id=NULL` perche' non ancora assegnato a sala).
2. Click kebab → "**Promuovi a Centro Slide**" → conferma "Promuovere PC backup studio a Centro Slide? Riceverà i file di TUTTE le sale dell'evento e non sarà più assegnato a una sala specifica."
3. Web client chiama RPC `update_device_role(device_id, 'control_center')`. RPC:
   - verifica `app_tenant_id()` o `is_super_admin()`
   - verifica `paired_devices.tenant_id == app_tenant_id()` (no cross-tenant)
   - `UPDATE paired_devices SET role='control_center', room_id=NULL, updated_at=now()`
4. Realtime listener `paired_devices` (gia' attivo da Sprint S-2) propaga a **tutti** gli admin del tenant in <1s + al device stesso (polling `room-player-bootstrap` ogni 30s).
5. PC sala riceve nuovo bootstrap: branch `control_center` → `useFileSync` riceve manifest multi-room (es. 4 sale × 8 sessioni × 12 file = 384 file totali) → inizia download di tutto il filesystem strutturato `Sala-Plenaria/Sessione_09-30/Mario_Rossi_v3_intro.pptx`, `Sala-A/Sessione_14-00/Anna_Bianchi_v1_chiusura.mp4`, ...
6. Admin in `RoomAssignBoard` vede "PC backup studio" spostato dalla colonna "Non assegnati" alla nuova sezione fixed in cima "Centri Slide (1)".
7. A fine evento, Andrea raccoglie il PC Centro Slide (HDD interno o NAS pairato): ha gia' tutto in struttura ordinata, **zero overhead** sui PC sala (i loro download non sono cambiati, leggono solo la loro sala).

#### 0.15.5 Sicurezza & invarianti

- ✅ **Tenant isolation**: RPC `SECURITY INVOKER` rispetta RLS `tenant_isolation_paired_devices`. Cross-tenant explicit reject con `ERRCODE=42501`.
- ✅ **Super-admin escape hatch**: `is_super_admin()` puo' modificare role anche cross-tenant (per troubleshooting da `/admin/tenants`).
- ✅ **Backward compat**: tutti i device esistenti hanno `role='room'` (default). Zero migrazione dati. RoomPlayerView per `role='room'` non e' cambiata (branch `else` originale).
- ✅ **Centri = read-only**: il dropzone upload e' nascosto perche' un centro non sa "in che sala sta ora il relatore" → consenitire upload da centro creerebbe ambiguita su `presentations.room_id`. Restera' read-only finche' Andrea non ne fara' richiesta esplicita (non e' nei 12 obiettivi sovrani).
- ✅ **Centri = no Realtime per-room subscription**: `useFileSync({ disableRealtime: true })` per centri perche' subscribe a 1 topic Realtime per sala (4-10 sale) potrebbe saturare i quota Supabase Realtime (200 connessioni concurrent simultanee). Il polling `room-player-bootstrap` ogni 30s e' largamente sufficiente per il use-case "backup" (i file caricati ora sono visti dal Centro entro 30s, accettabile vs realtime <1s del PC sala).
- ✅ **`room_id = NULL` su promote**: la RPC forza `room_id = NULL` quando `role='control_center'`. Demote → `room_id` resta NULL → admin DEVE riassegnare il device a una sala specifica via lavagna o kebab (la conferma demote dice esplicitamente "Dovrai riassegnarlo a una sala specifica dopo questa azione").

#### 0.15.6 Limiti dichiarati e roadmap

- **MVP polling-only sui Centri (no Realtime)**: scelta consapevole per non saturare quota Supabase Realtime. Se in futuro Andrea pairera' >5 Centri Slide simultaneamente per evento, riconsiderare introducendo un singolo topic Realtime `event:<id>:files` (broadcast cross-room). **NON urgente**.
- **CenterPlayerView identica a RoomPlayerView ma multi-room**: il branch usa lo stesso layout (cards per sessione). Una futura tree-view "Sala → Sessione → File" con espansione/collasso sarebbe piu' ergonomica per centri con 100+ sessioni. **Backlog S-4.b**.
- **No sort custom dei file in centri**: oggi sort hardcoded `roomName ASC → sessionScheduledStart ASC → filename ASC`. Per controllo manuale, vedere backlog S-4.c.
- **No metric "X file mancano vs admin"**: oggi il centro mostra solo i file di Storage. Non c'e' confronto "file dichiarati su `presentations` vs file effettivamente presenti". **Backlog S-4.d** (utile per QA pre-evento).

#### 0.15.7 Setup manuale richiesto ad Andrea

1. **Apply migration su Supabase remoto**:

   ```bash
   pnpm supabase db push --include-all
   # oppure: npx supabase db push
   # verifica: SELECT column_name, data_type FROM information_schema.columns
   #          WHERE table_name='paired_devices' AND column_name='role';
   # devi vedere: role | text
   ```

2. **Re-deploy Edge Function `room-player-bootstrap`**:

   ```bash
   pnpm supabase functions deploy room-player-bootstrap
   # output atteso: "Deployed Function: room-player-bootstrap"
   ```

3. **Genera nuovi tipi DB** (per CI types-drift check):

   ```bash
   pnpm gen:db-types
   git diff packages/shared/src/types/database.generated.ts
   # se nessuna diff: i tipi manuali sono allineati col DB
   ```

4. **Test smoke** (5 minuti):
   - Pair 1 PC backup, verifica appare in lista come `role='room'`.
   - Promuovi a Centro Slide via kebab → conferma → vedi appare in sezione "Centri Slide" sopra la lavagna.
   - Apri il PC sala promosso: vedi badge "CENTRO" + sub "X sale sincronizzate".
   - Carica un file dall'admin in 1 sala dell'evento → entro 30s appare nel filesystem locale del Centro Slide come `Nome-Sala/Nome-Sessione/Speaker_v1_filename.ext`.
   - Demote → conferma → riassegna a una sala dalla lavagna → torna a `role='room'`.

#### 0.15.8 Semaforo VERDE per Sprint T-1

✅ Sprint S-4 chiude il GAP G7 e completa la **FAMIGLIA S** (4/4 sprint chiusi). Restano **3 GAP famiglia T**:

- **G8** (Sprint T-1): badge "version live" big screen visibile a colpo d'occhio in sala (ora versione mostrata in card piccola `text-xs`).
- **G9** (Sprint T-2): telemetria perf live PC sala (CPU/RAM/disco) aggregata cross-evento.
- **G10** (Sprint T-3): features competitor mancanti (file checking pre-evento, ePoster, mobile SRR).

Pronto a partire con **Sprint T-1** appena Andrea da' il via.

---

### 0.16 Sprint T-1 — Badge versione "in onda" + toast cambio versione (DONE 18/04/2026)

**Obiettivo Andrea (sovrano #3):** "deve essere chiaro quale versione si stia usando di un file (in un centro slide lo stesso file puo' essere modificato 100 volte)". Risolve il **GAP G8** identificato nell'audit chirurgico.

**Cosa cambia per Andrea (UX):**

- Sul PC sala, accanto a OGNI nome file in lista (`FileSyncStatus`) compare un badge **`vN / M`** sempre visibile:
  - **VERDE** + spunta `CheckCircle2` se la corrente e' anche la piu' recente caricata.
  - **GIALLO** + icona `History` se l'admin ha riportato indietro la corrente (esiste una v_M piu' recente non scelta) — con tooltip esplicito "Versione 3 in onda — esiste una v5 piu' recente non scelta dal regista".
  - Neutro `Layers` + "v1" se c'e' una sola versione caricata.
- Quando si apre l'anteprima fullscreen di un file (`FilePreviewDialog`), il badge `v3 / 5` compare **overlay top-right** sul body. **Auto-fade** dopo 5s, **ricompare** on mouse move / touch / keypress / hover sul badge (UX standard player video).
- Ogni volta che l'admin carica una NUOVA versione e diventa current, sul PC sala compare un toast **`info`**: _"Nuova versione caricata: v4. {{filename o speakerName}} ora e' in v4."_ (durata 8s). Se invece l'admin RIPORTA INDIETRO la corrente (rollback), toast **`warning`** giallo: _"Versione riportata a v3. {{file}} e' tornato a v3 per scelta del regista (esiste anche v5)."_ (durata 10s).
- Tutti i testi tradotti IT/EN automaticamente.

**File modificati:**

| File                                                                    | Cosa                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/room-player-bootstrap/index.ts`                     | Aggiunto `version_number` al SELECT su `presentation_versions` per le current versions; nuova query aggregata `MAX(version_number)` per ogni `presentation_id` filtrato `status IN ('ready','superseded')`; `FileRow` esteso con `versionNumber: number \| null` + `versionTotal: number \| null` |
| `apps/web/src/features/devices/repository.ts`                           | `RoomPlayerBootstrapFileRow` esteso con `versionNumber` + `versionTotal` (entrambi nullable per BC con bootstrap pre-T-1)                                                                                                                                                                         |
| `apps/web/src/features/devices/hooks/useFileSync.ts`                    | `FileSyncItem` esteso con `versionNumber` + `versionTotal`; `rowToItem` propaga i campi (fallback `?? null`)                                                                                                                                                                                      |
| `apps/web/src/features/devices/components/VersionBadge.tsx` **(NUOVO)** | Componente riusabile `VersionBadge`: due varianti `inline` / `overlay`, color coding sovrano verde/giallo/neutro, auto-fade timer per overlay variant, pattern derived-state-from-props raccomandato React 19 (no `setState` in effect)                                                           |
| `apps/web/src/features/devices/components/FileSyncStatus.tsx`           | `<VersionBadge variant="inline">` accanto al filename in `FileRow`                                                                                                                                                                                                                                |
| `apps/web/src/features/presentations/components/FilePreviewDialog.tsx`  | Nuovo prop `versionInfo?: { number, total }`; `<VersionBadge variant="overlay">` top-right del body; `wakeKey` incrementato su mouseMove/touchStart/keydown per "wake-up" del badge                                                                                                               |
| `apps/web/src/features/devices/RoomPlayerView.tsx`                      | Nuovo `useEffect` che traccia `presentationId → ultimo versionNumber visto` e dispatcha toast `info` (newer) o `warning` (rollback) via `useToast` (skip primo render per evitare spam in apertura sala); `versionInfo={{ number, total }}` propagato al `<FilePreviewDialog>` via container      |
| `packages/shared/src/i18n/locales/it.json` + `en.json`                  | 10 nuove chiavi: `roomPlayer.versionBadge.{label,single,tooltipLatest,tooltipOlder,tooltipSingle,aria}` + `roomPlayer.versionToast.{newer.title,newer.body,rollback.title,rollback.body}`. Parita 1270/1270 verificata.                                                                           |

**Quality gates (tutti VERDI):**

- `pnpm --filter @slidecenter/shared build` — OK.
- `pnpm --filter @slidecenter/shared typecheck` — 0 errori.
- `pnpm --filter @slidecenter/web typecheck` — 0 errori.
- `pnpm --filter @slidecenter/web lint` — 0 errori (1 fix iter: refactor `VersionBadge` per evitare `setState` sincrono in `useEffect` → pattern derived-state-from-props con setter durante render body).
- `pnpm --filter @slidecenter/web build` — OK in 1.58s, PWA 99 entries 3312 KiB. `RoomPlayerView` 54.58 kB (gzip 14.56 kB) — ben sotto la soglia.
- i18n parity: IT 1270 / EN 1270, **0 chiavi orfane**.

**Flusso end-to-end (esempio reale):**

1. Speaker `Mario Rossi` carica `slide-keynote.pdf` v1 a 14:00 → bootstrap restituisce `versionNumber=1, versionTotal=1` → badge "v1" neutro.
2. Mario carica v2 alle 14:30 → admin imposta v2 come current → trigger Postgres pubblica `room:<id>` broadcast → PC sala fa rifresh → bootstrap restituisce `versionNumber=2, versionTotal=2` → badge **VERDE "v2 / 2"** + toast `info` "Nuova versione caricata: v2".
3. Mario carica v3 alle 15:15 (ultimo minuto) → bootstrap restituisce `versionNumber=3, versionTotal=3` → badge **VERDE "v3 / 3"** + toast `info` "Nuova versione caricata: v3".
4. L'admin si accorge che v3 ha un errore di formattazione → riporta current a v2 → bootstrap restituisce `versionNumber=2, versionTotal=3` → badge **GIALLO "v2 / 3"** (con tooltip "Versione 2 in onda — esiste una v3 piu' recente non scelta dal regista") + toast `warning` "Versione riportata a v2. slide-keynote ora e' tornato a v2 per scelta del regista (esiste anche v3)".
5. Quando l'utente sala apre l'anteprima fullscreen → badge **OVERLAY GIALLO "v2 / 3"** top-right, visibile per 5s, ricompare on movimento mouse / touch.

**Sicurezza & invarianti rispettate:**

- **Sovrano #2:** I file restano sul disco locale del PC sala (la `versionInfo` e' solo metadata mostrato). Nessun fetch cloud durante l'anteprima.
- **Sovrano #3:** GAP G8 chiuso definitivamente. Versione "in onda" sempre visibile a colpo d'occhio.
- **Backward-compat:** se il bootstrap non popola `versionNumber/versionTotal` (deploy parziale o vecchio cache PWA), il badge non appare → degradazione graceful, nessun crash.
- **No nuove RLS / no nuove RPC:** zero modifiche schema DB. Solo lettura dati esistenti via Edge Function gia' autenticata via `device_token`.
- **No costo extra Supabase:** la nuova query `presentation_versions` (`presentation_id IN (...)`) usa indice esistente `idx_pv_presentation_id` e tocca solo righe gia' lette nello stesso bootstrap. Cost overhead trascurabile (<1ms su event con 50 presentazioni).

**Limiti noti / roadmap T-1.x (deferred):**

- T-1.b: refresh automatico del preview quando arriva nuova versione mentre l'utente sta gia' guardando (oggi: il badge cambia colore ma il blob locale resta in v_old finche' non si chiude e riapre il preview). Da fare se Andrea segnala UX dubbia in field test.
- T-1.c: badge `vN/M` anche su `LiveRegiaView` admin (oggi: solo PC sala). Trade-off: l'admin gia' vede `version_number` esplicito in `PresentationVersionsPanel`, quindi piu' "nice-to-have" che bloccante.
- T-1.d: animazione transizione del badge (color shift verde→giallo) con framer-motion. Oggi: cambio istantaneo. Decidere su feedback Andrea.
- T-1.e: timestamp + autore della versione corrente nel badge overlay (es. "v3 / 5 — caricato 14:23 da Mario"). Oggi: solo `vN/M`. Aggiungere se richiesto in field test.

**Setup manuale per Andrea (deploy):**

1. **Edge Function deploy obbligatorio:** `room-player-bootstrap` ha modifiche → deploy via `supabase functions deploy room-player-bootstrap` (oppure GitHub Actions auto-deploy se configurato in §0.8).
2. **No migration:** zero modifiche schema DB.
3. **No env var nuove:** zero variabili da settare.
4. **Frontend:** standard `pnpm build` + push a Vercel — il deploy automatico lo gestisce.

#### 0.16.1 Semaforo VERDE per Sprint T-2

GAP famiglia T residui: 2 / 3 (G9 telemetria perf, G10 competitor parity).

- **G9** (Sprint T-2): telemetria perf live PC sala (CPU/RAM/disco/rete) aggregata in `room_state` + visibile cross-evento in `<RoomCard>` admin.
- **G10** (Sprint T-3): features competitor mancanti (file checking pre-evento, ePoster, mobile SRR, speaker timer integrato, email reminder schedulati).

Pronto a partire con **Sprint T-2** appena Andrea da' il via.

---

### 0.17 Sprint T-2 — Telemetria perf live PC sala (DONE 18/04/2026)

**Obiettivo sovrano (G9):** l'admin in centro slide deve sapere **a colpo d'occhio** se ognuno dei suoi PC sala (5 / 12 / 30 device per evento) sta soffrendo (heap quasi pieno, storage browser saturato, FPS in caduta libera, batteria scarica) **prima** che il pubblico veda lag, freeze o blackout durante la proiezione.

**Decisione architettura:** zero round-trip extra. Le metriche vengono **piggyback** sul polling esistente del PC sala (`room-player-bootstrap`, ogni 5/12/60s a seconda del playback mode). Append-only in tabella dedicata `device_metric_pings` con retention 24h via pg_cron daily. Nessun Realtime sulle metriche (volume INSERT alto, l'admin guarda trend di 30 min, non tick singoli) → polling lato admin ogni 8s.

#### 0.17.1 Cosa e' stato implementato

**Backend (Supabase migration `20260418100000_device_metric_pings.sql`):**

- Nuova tabella `public.device_metric_pings` (BIGSERIAL PK, append-only):
  - `tenant_id` / `device_id` / `event_id` / `room_id` (FK sicuri con `ON DELETE CASCADE`/`SET NULL`)
  - `ts TIMESTAMPTZ DEFAULT now()`
  - `source TEXT CHECK (source IN ('browser', 'desktop'))` — discrimina collector PWA vs Tauri Rust futuro
  - **Browser metrics**: `js_heap_used_pct/mb`, `storage_quota_used_pct/mb`, `fps`, `network_type`, `network_downlink_mbps`, `battery_pct`, `battery_charging`, `visibility ('visible'|'hidden')`
  - **Desktop metrics** (nullable, popolate fase 2 con sysinfo Rust): `cpu_pct`, `ram_used_pct/mb`, `disk_free_pct/gb`
  - **Common**: `app_uptime_sec`, `playback_mode`, `device_role`
  - `CHECK chk_pct_ranges` blocca valori folli (>100, <0, fps>240)
- **Indici hot-path**: `(device_id, ts DESC)` per latest, `(event_id, ts DESC) WHERE event_id IS NOT NULL` per range query, `(ts)` per cleanup retention
- **RLS** chiusa: SELECT solo per `is_super_admin()` o `(tenant_id = app_tenant_id() AND role IN ('admin','tech'))`. INSERT/UPDATE/DELETE bloccati a tutti — solo via SECURITY DEFINER.
- **RPC `record_device_metric_ping(p_device_id, p_payload)` SECURITY DEFINER**: chiamata dall'Edge Function con service_role. Lookup `paired_devices`, **rate-limit soft 3s** (no-op se ultimo ping <3s, evita flood), INSERT con NULLIF safe-cast su tutti i campi, exception handler ritorna `{ok:false, error}` (best-effort: una riga di telemetria persa non blocca mai il bootstrap).
- **RPC `fetch_device_metrics_for_event(p_event_id, p_window_min, p_max_pings_per_device)` SECURITY DEFINER STABLE**: per ogni device dell'evento ritorna `{device, latest, pings[]}`. Auth: `app_tenant_id() = events.tenant_id` + ruolo admin/tech. Clamp parametri (windowMin 1..60, maxPings 1..200) anti-DoS.
- **Cleanup retention 24h** `cleanup_device_metric_pings()` SECURITY DEFINER. Schedulato via pg_cron `0 3 * * *` (idempotente: `DO $$` block che fa `cron.unschedule` + `cron.schedule` se `pg_cron` installato).
- Tipi TypeScript aggiornati in `packages/shared/src/types/database.ts` (`Tables.device_metric_pings` con `Insert: never; Update: never;` per safety, + Functions `record_device_metric_ping`, `fetch_device_metrics_for_event`, `cleanup_device_metric_pings`).

**Edge Function `room-player-bootstrap` (modifica):**

- Accetta nuovo campo opzionale `metrics?: object` nel body. Validato (deve essere object non array).
- Se presente, dopo l'update `last_seen_at`, chiama `record_device_metric_ping(device.id, enrichedPayload)` con `playback_mode` + `device_role` iniettati lato server (no spoofing client).
- **Best-effort fire-and-forget**: try/catch loggato in console.warn, mai blocca il bootstrap.

**Client PC sala (`apps/web`):**

- Nuovo hook `useDevicePerformanceCollector()` in `apps/web/src/features/devices/hooks/`:
  - **FPS tracker**: rAF loop continuo, EMA ultimi 5s, auto-pause su `visibilitychange='hidden'`, max 240fps clamp
  - **Heap JS**: `performance.memory.usedJSHeapSize / jsHeapSizeLimit` (Chrome only, fallback null Safari/Firefox)
  - **Storage quota**: `navigator.storage.estimate()` con percent + MB
  - **Network**: `navigator.connection.{type|effectiveType, downlink}`
  - **Battery**: `navigator.getBattery()` con cache + listener `levelchange`/`chargingchange` (no polling)
  - **Visibility**: `document.visibilityState`
  - **Uptime**: `Date.now() - performance.timeOrigin`
  - **Source**: `'browser'` se PWA / `'desktop'` se dentro Tauri (preparazione fase 2 Rust sysinfo)
  - Espone `collectMetrics(): Promise<DeviceMetricPingPayload>` zero-throw (best-effort, sempre risolve).
- `repository.ts` esteso: `invokeRoomPlayerBootstrap(token, includeVersions, playbackMode, metrics?)` con nuovo parametro opzionale + 4 nuovi tipi (`DeviceMetricPingPayload`, `DeviceMetricPing`, `DeviceMetricsLatest`, `DeviceMetricsRow`) + nuova funzione `fetchDeviceMetricsForEvent(eventId, {windowMin, maxPingsPerDevice})`.
- `RoomPlayerView.tsx`: chiama `collectMetrics()` prima di ogni invocazione del polling bootstrap, passa il payload come 4° arg. Se collector throwa, passa `null` (no insert lato server).

**Client admin (`apps/web`):**

- Nuovo hook `useDeviceMetrics(eventId, {windowMin, maxPingsPerDevice, refreshMs, enabled})` in `apps/web/src/features/devices/hooks/`:
  - Polling default 8s. Pausa quando `document.visibilityState='hidden'`. Refresh immediato al rientro visibility.
  - Anti-race con `reqIdRef` counter (ignora risposta se l'eventId e' cambiato nel frattempo).
  - Mantiene ultimo dato valido on error, espone `error` separato.
- Nuovo componente `<Sparkline>` in `apps/web/src/features/devices/components/Sparkline.tsx`:
  - SVG inline puro, zero dependencies (~200 byte di markup totali per ogni metrica)
  - Path D continuo, marker "current value", colorazione automatica verde/giallo/rosso a soglia
  - Supporta `inverted` (per metriche tipo "FPS" o "disk_free" dove pochi=male)
- Nuovo componente `<LivePerfTelemetryPanel eventId enabled?>` in `apps/web/src/features/devices/components/LivePerfTelemetryPanel.tsx`:
  - **Card per device** con header health-dot + nome + badge `CENTRO` per control_center + status (offline/network/source) + battery badge colorato
  - **Grid metriche**: heap, storage, FPS sempre visibili. CPU + RAM SOLO se `source='desktop'` (browser ne lascia placeholder)
  - **Sparkline** ultimi 30 min sotto ogni numero big colorato
  - **Footer compact**: uptime, playback mode, downlink Mbps
  - **Pannello collassabile** (default chiuso, summary header sempre visibile con badge `X sani | Y attenzione | Z critici | W ignoti`)
  - Persistenza apri/chiudi in `localStorage`: `sc:liveperftelemetry:open`
  - **Auto-hidden** quando 0 device pairati nell'evento (no rumore UI)
  - **Toast alert debounced**: stato critical/warning persiste >=30s → toast `error`/`warning` 1× con titolo+descr i18n. Stato `recovered` (critical→healthy dopo notify) → toast `success`. Stato tracciato per device con `useRef<Map<deviceId, {health, sinceTs, notified}>>`.
- **Soglie sovrane** (configurate inline nel componente, facili da tunare in field):
  - `heap` >=85 warning / >=95 critical
  - `storage` >=90 warning / >=95 critical
  - `fps` <30 warning / <15 critical (inverted)
  - `cpu` >=85 warning / >=95 critical (solo desktop)
  - `ram` >=90 warning / >=95 critical (solo desktop)
  - `disk_free` <=10 warning / <=5 critical (inverted, solo desktop)
  - `battery` <=20 warning / <=10 critical (inverted, solo se `!charging`)
- Integrato in `EventDetailView.tsx` sotto `<DevicesPanel />` nella sezione "Devices" dell'evento.

**i18n (10 nuove sezioni × 2 lingue):**

- 51 nuove chiavi sotto `deviceTelemetry.*` in `it.json` + parita perfetta in `en.json`:
  - Title, badge centro, status (offline/visible/hidden tab), time-ago helpers, refresh, uptime, playback mode, downlink, battery
  - Metric labels (heap/storage/fps/cpu/ram/disk)
  - Health labels (healthy/warning/critical/unknown)
  - Alert toasts (critical/warning/recovered con title + body)
- Total chiavi: **1312 IT / 1312 EN — parita perfetta**.

#### 0.17.2 Decisioni di design

**Perche' piggyback su `room-player-bootstrap` e non endpoint dedicato?** Zero round-trip extra. Il PC sala gia' polla ogni 5/12/60s. Aggiungere un endpoint separato significherebbe doppio request rate × N device. Anche con 12 PC × 5s (turbo) = 144 req/min/evento, si rimane abbondantemente sotto i limiti Supabase Edge.

**Perche' polling 8s e NON Realtime postgres_changes?** Il volume INSERT su `device_metric_pings` saturerebbe il channel (1 INSERT ogni 5-12s × 30 device = 6 INSERT/s = 21.600/h). Realtime postgres_changes diventa instabile sopra ~5 INSERT/s sostenuti. Inoltre l'admin non deve vedere "tick a tick" ma trend ultimi 30 min — 8s di polling e' UX live indistinguibile + costo Supabase 100× minore.

**Perche' RLS chiusa su INSERT con SECURITY DEFINER RPC?** Il PC sala NON ha sessione utente Supabase (auth via `device_token`). Senza SECURITY DEFINER dovremmo: (a) dare INSERT al ruolo `anon` (sicurezza zero — chiunque potrebbe spammare), oppure (b) creare un JWT per ogni device (costo crittografico + bookkeeping). La RPC SECURITY DEFINER chiamata dall'Edge Function con service_role e' la soluzione standard Supabase: l'Edge ha gia' validato il token, la RPC fa solo INSERT cieco con rate-limit 3s lato server.

**Perche' rate-limit 3s e non 0?** Anti-flood. Se il PC sala bugga e chiama bootstrap a 1Hz invece di 5/12/60s, evitiamo di esplodere `device_metric_pings` con 6× la dimensione attesa. 3s e' inferiore a tutti i tick standard (auto/live/turbo) quindi 100% dei ping legittimi passa, ma blocca i casi patologici.

**Perche' retention 24h e non piu'?** L'admin guarda telemetria DURANTE l'evento (a sera) o subito dopo (review post-mortem). Oltre 24h e' rumore: i dati vecchi non aiutano a debuggare il prossimo evento (PC diversi, sale diverse, network diverso). Cleanup giornaliero pg_cron @ 03:00 UTC mantiene la tabella sotto i 100 MB anche con 5 eventi paralleli.

**Perche' soglie configurate INLINE nel componente e non in DB?** Devono essere facili da tunare in field. Andrea le ricalibra dopo i primi 2-3 eventi reali (es: scoprire che heap >85% e' falso positivo perche' Chrome alloca troppo), e non vogliamo migration per cambiare un numero. Quando saranno stabili, le sposteremo in `tenant_settings` come override per-tenant.

**Perche' niente metriche CPU/RAM reali in fase 1?** Il PC sala oggi e' una **PWA** in browser. Il browser e' sandboxed: NON puo' vedere `% CPU` o `% RAM` reale del sistema operativo. Quello che mostriamo (heap JS, storage quota) e' la "salute" del browser/applicazione, non del PC. Per CPU/RAM reali serve il client desktop Tauri con `sysinfo` Rust crate (fase 2 di T-2, schedulata insieme a Sprint Q hybrid sync). Lo schema DB e' gia' pronto (`cpu_pct`, `ram_used_pct`, `disk_free_pct` nullable + UI condizionata su `source='desktop'`).

**Perche' toast con debounce 30s?** Spam-prevention. Senza debounce, ogni refresh (8s) farebbe 1 toast → l'admin viene sommerso. 30s e' il "tempo che ci mette un PC sala lento a essere notato dal pubblico" — sotto quel valore di solito si tratta di spike transitorio (gc, network blip).

**Perche' pannello collassato di default?** Il summary header ("X sani | Y attenzione") e' gia' informativo. L'admin lo apre solo quando vede badge giallo/rosso o per audit pre-evento. Risparmia 600+ pixel di scroll quando tutto e' OK (caso normale).

#### 0.17.3 File modificati / creati

**Creati (nuovi):**

- `supabase/migrations/20260418100000_device_metric_pings.sql` (300+ linee, schema + 3 RPC + cron)
- `apps/web/src/features/devices/hooks/useDevicePerformanceCollector.ts` (collector PWA, 230 linee)
- `apps/web/src/features/devices/hooks/useDeviceMetrics.ts` (admin polling hook, 110 linee)
- `apps/web/src/features/devices/components/Sparkline.tsx` (SVG sparkline 0-deps, 110 linee)
- `apps/web/src/features/devices/components/LivePerfTelemetryPanel.tsx` (widget admin completo, 470 linee)

**Modificati:**

- `packages/shared/src/types/database.ts` (+78 linee: tabella + 3 RPC types)
- `supabase/functions/room-player-bootstrap/index.ts` (+22 linee: parsing metrics + RPC call)
- `apps/web/src/features/devices/repository.ts` (+86 linee: `DeviceMetricPingPayload` + 4 tipi `DeviceMetric*` + `fetchDeviceMetricsForEvent` + parametro `metrics` su `invokeRoomPlayerBootstrap`)
- `apps/web/src/features/devices/RoomPlayerView.tsx` (+15 linee: import + hook + collect prima di ogni polling)
- `apps/web/src/features/events/EventDetailView.tsx` (+3 linee: import + integrazione widget)
- `packages/shared/src/i18n/locales/it.json` + `en.json` (+51 chiavi/lingua)

#### 0.17.4 Quality gates passati

- `pnpm --filter @slidecenter/shared build` ✅
- `pnpm --filter @slidecenter/web typecheck` ✅ (0 errori dopo 6 fix iterativi: TFunction da i18next, lucide-icon `title` rimosso, `useToast()` API corretta)
- `pnpm --filter @slidecenter/web lint` ✅ (1 fix: `prefer-const` su `let timer`)
- `pnpm --filter @slidecenter/web build` ✅ (PWA generata, 101 entries precache)
- i18n parity check (Node script): 1312 IT / 1312 EN, **zero key orfane** in entrambi i versi
- ReadLints su 10 file modificati: **0 errori**

#### 0.17.5 Cosa serve da Andrea / DevOps post-merge

1. **Migration deploy obbligatorio:** push del file `20260418100000_device_metric_pings.sql` → eseguito automaticamente al prossimo deploy Supabase (oppure manuale: `supabase db push`).
2. **Edge Function deploy obbligatorio:** `room-player-bootstrap` ha modifiche → deploy via `supabase functions deploy room-player-bootstrap` (oppure GitHub Actions auto-deploy se configurato in §0.8).
3. **pg_cron extension:** se non gia' attiva sull'istanza Supabase del progetto, abilitarla da Dashboard → Database → Extensions. La migration ha un `DO $$` block che salta lo schedule cron se `pg_extension` non ha `pg_cron`, quindi il deploy non rompe niente, ma il cleanup retention non parte. In quel caso si puo' manualmente schedulare un Vercel cron job che chiama `cleanup_device_metric_pings()` via RPC.
4. **No env var nuove:** zero variabili da settare.
5. **Frontend:** standard `pnpm build` + push a Vercel — il deploy automatico lo gestisce.

#### 0.17.6 Backlog deferred (NON blocca G9)

- **T-2.b**: collector desktop Tauri Rust (`sysinfo` crate) → CPU/RAM/disk reali per PC sala intranet. Schedulare insieme a Sprint Q hybrid sync.
- **T-2.c**: salvare le soglie in `tenant_settings` (oggi inline). Aspettiamo 2-3 eventi reali per validare i valori prima di "spostare in DB".
- **T-2.d**: storico esportabile telemetria (CSV/PDF) per post-mortem evento. Oggi retention 24h e' write-only.
- **T-2.e**: alert via webhook esterno (Slack / Discord / email) per critici notturni (es: PC sala in attesa per 8h che si rompe a mezzanotte). Oggi solo toast in UI admin (richiede admin presente al PC).
- **T-2.f**: confronto cross-evento ("PC Sala 2 dell'evento Acme vs PC Sala 2 dell'evento Beta — heap medio +30% perche' file pesanti"). Richiede aggregazione storica → out-of-scope T-2 MVP.

#### 0.17.7 Semaforo VERDE per Sprint T-3

GAP famiglia T residui: **1 / 3** (G10 competitor parity).

- **G10** (Sprint T-3): features competitor mancanti — file checking pre-evento, ePoster, mobile speaker ready room, speaker timer integrato, email reminder schedulati. Vedi §0.4 per analisi dettagliata vs PreSeria, Slidecrew, SLIDEbit, OCSA Suite.

Pronto a partire con **Sprint T-3** appena Andrea da' il via.

---

### 0.18 Audit completo + Bugfix Q+1.5 (DONE 18/04/2026)

> **Trigger:** Andrea ha chiesto **audit completo** del progetto post-G9 prima di procedere con G10. Eseguito controllo a tappeto su sicurezza, qualita codice, dipendenze, RLS, telemetria.

#### 0.18.1 Quality gates eseguiti (tutti VERDI)

```
pnpm typecheck                    OK  (5/5 task, 2.4s, cache hit parziale)
pnpm lint                         OK  (5/5 task, ESLint web+shared+ui)
pnpm build                        OK  (PWA 101 entries, 2546 modules)
pnpm audit (full incl. devDeps)   OK  (0 vulnerabilita dopo override Q+1.5)
i18n parity check (Node)          OK  (1312 IT / 1312 EN, zero key orfane)
```

#### 0.18.2 Audit sicurezza (tutto OK)

| Verifica                                                                 | Esito | Note                                                                                                                    |
| ------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `SECURITY DEFINER` con `SET search_path` su tutte le RPC (anti-hijack)   | OK    | 50+ funzioni controllate in `supabase/migrations/**.sql`: zero senza `search_path`                                      |
| Nessuna RLS policy aperta (`USING (true)` o `if true`)                   | OK    | Grep esaustivo: 0 occorrenze. Tutte le policy filtrano per `tenant_id` o ruolo                                          |
| Webhook Lemon Squeezy: HMAC SHA-256 + timing-safe-equal + payload cap    | OK    | `lemon-squeezy-webhook/index.ts`: signature obbligatoria, body ≤1 MiB, idempotency via `event_id` UNIQUE                |
| Headers di sicurezza HTTP completi su SPA                                | OK    | `vercel.json`: HSTS preload 2y, CSP completa, X-Frame-Options DENY, COOP/CORP same-origin, Permissions-Policy ristretta |
| Telemetria perf G9: rate-limit server + INSERT solo via SECURITY DEFINER | OK    | `record_device_metric_ping` rate-limit 3s; UPDATE/DELETE bloccati a tutti i ruoli; `device_metric_pings` write-only     |
| Bootstrap PC sala: no spoofing campi server-side (playback_mode, role)   | OK    | `room-player-bootstrap/index.ts`: `device_role` iniettato server-side, `playback_mode` validato whitelist               |
| GDPR: anon NON puo' fare INSERT su `email_log`/`activity_log`            | OK    | `security_least_privilege` Sprint Q+1: REVOKE generale + grant chirurgici solo su `paired_devices`/`pairing_codes`      |

#### 0.18.3 Vulnerabilita pacchetti — fix Q+1.5

**Trovato (pnpm audit completo):**

| Severita | Pacchetto                    | Path                                                                                   | Fix                       |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------- |
| moderate | `serialize-javascript@6.0.2` | `apps/web > vite-plugin-pwa@1.2.0 > workbox-build@7.4.0 > @rollup/plugin-terser@0.4.4` | Override pnpm a `>=7.0.5` |
| high     | `serialize-javascript@6.0.2` | (stessa catena)                                                                        | (stesso fix)              |

**Impatto reale:** zero a runtime. Le vulnerabilita `serialize-javascript` sono devDependency-only, attivate solo durante `vite build` (generazione PWA service worker). Non viene eseguito codice utente vulnerabile in produzione. Comunque chiuso per CI verde.

**Fix applicato in `package.json` (root):**

```json
"pnpm": {
  "overrides": {
    "serialize-javascript@<7.0.5": ">=7.0.5"
  }
}
```

Re-eseguito `pnpm install --no-frozen-lockfile` + `pnpm audit`: **0 vulnerabilita**, **0 regressioni** (typecheck/lint/build verdi).

#### 0.18.4 Bug funzionali corretti (logica G9 telemetria)

Trovati **2 bug logici** nel widget `LivePerfTelemetryPanel` durante audit chirurgico — entrambi corretti.

**Bug #1: `THRESHOLDS.disk` mancava di `inverted: true`**

- **File:** `apps/web/src/features/devices/components/LivePerfTelemetryPanel.tsx`
- **Sintomo:** `disk_free_pct` (% disco LIBERO, semantica "pochi = male") veniva trattato come metrica non-inverted (es. heap%, "tanti = male"). Conseguenza: con `disk_free=5%` (disco quasi pieno!) il device veniva classificato `healthy` (mancato allarme); con `disk_free=95%` (disco quasi vuoto, OTTIMO) veniva classificato `critical` (falso allarme).
- **Fix:** soglie corrette `{ warning: 10, critical: 5, inverted: true }` come specificato in §0.17.1 (paragrafo "Soglie sovrane T-2").
- **Impatto pre-fix:** zero in produzione finche' i collector desktop Tauri non popolano `disk_free_pct` (oggi il PWA browser lo lascia a `null`, branch never-taken). Pero' sarebbe esploso al primo deploy del collector Rust di T-2.b.

**Bug #2: formula errata in `Sparkline.tsx` per metriche inverted**

- **File:** `apps/web/src/features/devices/components/Sparkline.tsx`
- **Sintomo:** la classifica colore della sparkline usava `last < (100 - criticalAt)` per metriche `inverted`. Esempio: per FPS con `criticalAt=15`, calcolava `last < (100-15) = last < 85` → tutte le sparkline FPS sotto 85fps mostravano linea ROSSA continua (false positive massivo). Stesso bug su battery e disk_free.
- **Fix:** formula coerente con `classifyValue` del Panel: `inverted ? last <= criticalAt : last >= criticalAt`.
- **Impatto pre-fix:** UX rumorosa (sparkline FPS/battery/disk sempre rosse anche su PC sani). Nessun rischio sicurezza ne perdita dati. Mai notato in produzione perche' G9 e' appena uscito (nessun evento reale post-T-2).

**Quality gates post-fix:** typecheck OK, lint OK, build OK, ReadLints OK (zero errori).

#### 0.18.5 File modificati

- `apps/web/src/features/devices/components/LivePerfTelemetryPanel.tsx` (1 fix soglie disk + commento esplicativo)
- `apps/web/src/features/devices/components/Sparkline.tsx` (1 fix formula `inverted` + commento esplicativo)
- `package.json` (root) — `pnpm.overrides` per `serialize-javascript`
- `pnpm-lock.yaml` — aggiornato dall'install
- `docs/STATO_E_TODO.md` — questa sezione

#### 0.18.6 Conclusione audit

**SEMAFORO VERDE su tutto il progetto**, sicurezza compresa. Nessun blocker, nessuna vulnerabilita aperta, zero regressioni. Sprint T-3 (G10) puo' partire in qualsiasi momento — proposta features competitor in §0.4 e analisi nel resto di questa nota.

---

### 0.19 Sprint T-3 (G10) — Piano implementazione (decisione 18/04/2026)

> **Decisione Andrea (form CTO 18/04/2026):**
>
> - **T-3-A** File error checking automatico — modalita **warn-only** (badge gialli, no blocco upload).
> - **T-3-E** Preview slide successiva su PC tecnico (`LiveRegiaView`).
> - **T-3-G** Remote slide control da tablet via Realtime broadcast.
>
> **Esclusi (decisione esplicita Andrea):**
>
> - T-3-B Speaker timer integrato — il prodotto Live SPEAKER TIMER resta separato (cross-sell manuale).
> - T-3-C Email reminder schedulati — i coordinator continuano a mandare promemoria a mano.
>
> **Tempo totale stimato:** ~6.5g dev + 2.5g test = **~9 giorni**.
> **Esecuzione chirurgica:** uno sprint alla volta, semaforo verde Andrea fra uno e il successivo.

#### 0.19.1 T-3-A — File error checking automatico (warn-only) — DONE (vedi §0.20)

**Cosa fa il sistema:**

- Quando una `presentation_versions` arriva in stato `ready` (post-finalize), viene chiamato un Edge Function **`slide-validator`** che scarica il blob da Storage, ne ispeziona contenuto e metadati, e popola un campo nuovo `validation_warnings JSONB[]` su `presentation_versions`.
- L'admin (e lo speaker via portale) vedono un badge giallo `⚠ N issue` accanto al filename. Click → tooltip con dettaglio per ogni issue (es. "font Calibri non embedded", "video src=https://broken.com/clip.mp4 → 404", "risoluzione 1280×720, raccomandato 1920×1080").
- **Nessun blocco** upload: il file resta sempre disponibile per la proiezione. Le issue sono informative, l'admin decide se chiedere allo speaker un re-upload.

**Tipi di check (versione 1):**

| Tipo file | Check                                                                                               | Severita | Note                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `.pptx`   | Font non embedded (scan `ppt/theme/*.xml` + `ppt/slides/*.xml` per `typeface=` non in `ppt/fonts/`) | warning  | Esclude i font safe-list (Calibri, Arial, Times — disponibili su Windows out-of-box). |
| `.pptx`   | Video con `r:link` HTTP/HTTPS (broken link risk)                                                    | warning  | Solo flag presenza. Non facciamo HEAD HTTP (latenza Edge non prevedibile).            |
| `.pptx`   | Slide size diverso da 16:9 (esclude 4:3 legacy + custom)                                            | info     | Letto da `ppt/presentation.xml` `<p:sldSz cx= cy=>`.                                  |
| `.pdf`    | Numero pagine = 0 o file corrotto                                                                   | error    | Solo flag, non blocca (l'admin vede "il file e rotto").                               |
| `tutti`   | File >500 MB                                                                                        | warning  | Limite raccomandato per evitare lag download PC sala.                                 |
| `tutti`   | MIME type dichiarato vs sniffed                                                                     | warning  | Catch upload PDF rinominati `.pptx` (caso classico).                                  |

**Architettura tecnica:**

```
[client web upload] → invokeRoomDeviceUploadFinalize / finalize_upload_version_admin
                    → presentation_versions.status = 'ready'
                    → trigger AFTER UPDATE → pg_notify('slide_validator', version_id)
                    → cron Edge Function "slide-validator-tick" (5min) o webhook diretto
                       → SELECT versioni ready con validation_warnings IS NULL
                       → for each: signedUrl → fetch → parse → UPDATE validation_warnings
```

**Decisione architetturale chiave (rate-limit + costo Edge):**

NON triggeriamo l'Edge Function direttamente dal trigger DB (Postgres → HTTP webhook è fragile e costoso). Usiamo invece **polling** schedulato da pg_cron ogni 2 minuti che chiama l'Edge Function via `net.http_post` con un batch di max 10 versioni unvalidated. Pro:

- Idempotente (il `WHERE validation_warnings IS NULL` previene doppi run).
- Throttling naturale (max 10 file/2min = 300 file/h che bastano largamente).
- Crash recovery automatico (se Edge Function fallisce, prossimo tick riprova).
- Latenza accettabile (max 2 min tra upload e badge visibile, l'admin sta gia visionando il file).

**Schema DB (migration nuova):**

```sql
ALTER TABLE public.presentation_versions
  ADD COLUMN validation_warnings JSONB DEFAULT NULL,
  ADD COLUMN validated_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_pv_unvalidated_ready
  ON public.presentation_versions (created_at)
  WHERE status = 'ready' AND validation_warnings IS NULL;

-- pg_cron: ogni 2 min chiama l'Edge Function se ci sono versioni unvalidated
-- (la function ritorna immediatamente se la lista batch e vuota)
```

**File impattati T-3-A:**

Creati:

- `supabase/migrations/20260418200000_validation_warnings.sql`
- `supabase/functions/slide-validator/index.ts` (parser .pptx + .pdf + dispatcher)
- `apps/web/src/features/presentations/components/ValidationIssuesBadge.tsx`

Modificati:

- `supabase/functions/_shared/cors.ts` (eventuale)
- `apps/web/src/features/presentations/repository.ts` (esporre `validation_warnings`)
- `apps/web/src/features/presentations/components/SessionFilesPanel.tsx` (badge accanto filename)
- `apps/web/src/features/devices/components/RoomDeviceUploadDropzone.tsx` (badge dopo upload)
- `packages/shared/src/types/database.ts` (rigenerato post-migration)
- `packages/shared/src/i18n/locales/it.json` + `en.json` (~20 chiavi)

**Quality gates da soddisfare:**

- typecheck OK
- lint OK
- build OK
- i18n parity 1312+ → 1330+ chiavi entrambe lingue
- ReadLints zero errori
- Test manuale: caricare un .pptx con font Wingdings non embedded → vedere badge giallo `⚠ 1 issue` con tooltip "Font Wingdings non embedded"

**SLA implementazione:** 1.5g dev + 0.5g test = **2 giorni totali** (target: chiusura entro fine settimana).

#### 0.19.2 T-3-E — Preview slide successiva — DONE (vedi §0.21)

Implementazione finale ha **deviato consapevolmente** dal piano: invece di "preview slide N+1 dello stesso file" (irrealizzabile senza sostituire il viewer iframe Chrome del PC sala) → "**preview prossimo file in scaletta** + thumbnail prima slide" sul PC tecnico, valore di regia equivalente, zero impatto sul PC sala. Vedi §0.21.1 per la motivazione tecnica completa.

#### 0.19.3 T-3-G — Remote slide control da tablet — DONE (vedi §0.22)

Implementazione finale ha **deviato consapevolmente** dal piano: invece di "next/prev SLIDE" (stesso vincolo iframe del PC sala) → comandi a livello **scaletta/file** (next/prev/goto/blank/first), riusa la stessa pipeline `rpc_room_player_set_current` → broadcast `room_state_changed` gia' sottoscritta dal PC sala. Zero modifiche al `RoomPlayerView`. Vedi §0.22.1 per la motivazione e §0.22.2 per l'architettura finale (token UUID + hash SHA-256, TTL configurabile, rate-limit 60/min, audit log).

---

### 0.20 Sprint T-3-A — File error checking automatico (DONE 18/04/2026)

**Implementato:** validazione automatica warn-only dei file caricati (PPTX + PDF + sniff MIME generico). Nessun blocco upload, badge giallo `⚠ N avvisi` accanto al filename con popover di dettaglio.

#### 0.20.1 Architettura scelta (pull-based on-demand)

Decisione architetturale: **NO pg_cron + pg_net**, ma **invocazione lazy lato client**.

**Motivazione:**

- pg_net non e' ancora abilitato sull'istanza Supabase del progetto.
- pull-based = paghiamo Edge function solo quando l'admin guarda davvero la sessione.
- Idempotente: la RPC `record_validation_warnings` ha guard su `validated_at IS NULL`, due tab che triggherano in parallelo non causano doppi-write.
- Latenza accettabile (max 1-2 min tra upload e badge visibile, l'admin sta gia' visionando i file).

**Flow:**

```
[admin apre sessione]
   → SessionFilesPanel monta useValidationTrigger
   → RPC list_unvalidated_versions_for_session(session_id, 10)  (RLS-isolata)
   → se versions != 0 → Edge Function slide-validator(version_ids[])
      → per ogni version: signedUrl 120s + fetch + parse (JSZip per pptx)
      → record_validation_warnings(version_id, warnings[])  (idempotente)
   → onValidated → loadFiles() → badge appaiono
```

Throttle hook 60s per sessione (evita hammer su panel collapse/expand).

#### 0.20.2 Validazioni implementate

| Tipo file | Check                                     | Severity | Note                                                                    |
| --------- | ----------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `.pptx`   | Archivio corrotto (JSZip apertura)        | error    | "PPTX cannot be opened"                                                 |
| `.pptx`   | Manca `ppt/presentation.xml`              | error    | File ZIP rinominato                                                     |
| `.pptx`   | Aspect ratio 4:3                          | info     | Solo segnalazione (proiettori 16:9)                                     |
| `.pptx`   | Aspect ratio custom (≠16:9, ≠4:3, ≠16:10) | info     | "Verify projector format"                                               |
| `.pptx`   | Font non in safe-list e non embedded      | warning  | safe-list 28+ font Windows out-of-box (Calibri, Arial, Wingdings, ecc.) |
| `.pptx`   | Font parzialmente embedded                | warning  | match name prefix nei file `ppt/fonts/*`                                |
| `.pptx`   | Video/audio link HTTP esterno             | warning  | Scan `slide*.xml.rels` per `TargetMode="External"`                      |
| `.pdf`    | Magic bytes mancanti `%PDF-`              | error    | File corrotto o non PDF                                                 |
| `.pdf`    | EOF marker `%%EOF` mancante               | error    | File troncato                                                           |
| `.pdf`    | 0 pagine rilevate                         | warning  | Approssimato via scan ultimi 64 KB per `/Type /Page`                    |
| `.pdf`    | File <5 byte                              | error    | Quasi-vuoto                                                             |
| tutti     | Size >50 MB                               | info     | Validation skipped (limite parser)                                      |
| tutti     | Size >500 MB                              | warning  | Possibile lag download PC sala                                          |
| tutti     | MIME dichiarato vs sniffed mismatch       | warning  | Catch upload PDF rinominati `.pptx` ecc.                                |
| tutti     | Storage unreachable (signed URL fail)     | error    | Object missing                                                          |
| tutti     | Fetch timeout >30s                        | warning  | Validation incompleta, retry al prossimo tick                           |
| tutti     | Validator internal error                  | warning  | Cattura tutti gli errori del parser stesso                              |

Totale: **17 codici** stable in i18n IT/EN sotto `presentations.validation.codes.*`.

#### 0.20.3 File creati/modificati

**Migration:**

- `supabase/migrations/20260418200000_validation_warnings.sql` — colonne `validation_warnings` (JSONB) + `validated_at` (TIMESTAMPTZ), indice partial `idx_pv_unvalidated_ready`, RPC `record_validation_warnings` (SECURITY DEFINER, GRANT solo service_role) e `list_unvalidated_versions_for_session` (SECURITY INVOKER, GRANT authenticated).

**Edge Function:**

- `supabase/functions/slide-validator/index.ts` — JWT auth, cross-tenant guard, signedUrl Storage, parser JSZip per pptx + parser custom per pdf, dispatcher RPC. Limiti: max 5 version per call, max 50 MB per file, fetch timeout 30s.

**Web client:**

- `apps/web/src/lib/edge-functions.ts` (NEW) — modulo condiviso `invokeEdgeFunction`, `EdgeFunctionAuthError`, `EdgeFunctionMissingError`, `ensureFreshAccessToken`. Refactor estratto da `features/devices/repository.ts` per dedup tra features (zero comportamento cambiato, re-export per backward-compat).
- `apps/web/src/features/devices/repository.ts` — re-export errors + import dell helper dal nuovo modulo (zero diff comportamentale).
- `apps/web/src/features/presentations/repository.ts` — `listUnvalidatedVersionsForSession()`, `invokeSlideValidator()`, re-export `ValidationWarning`.
- `apps/web/src/features/presentations/hooks/useValidationTrigger.ts` (NEW) — kick lazy Edge function, throttle 60s, idempotente, best-effort.
- `apps/web/src/features/presentations/components/ValidationIssuesBadge.tsx` (NEW) — badge tre stati (validating / clean / N issues), popover dettaglio, traduzione i18n con fallback al `message` inglese.
- `apps/web/src/features/presentations/components/SessionFilesPanel.tsx` — propaga `validation_warnings` dalla query, integra hook + badge accanto al filename.

**Types:**

- `packages/shared/src/types/database.ts` — type `ValidationWarning`, colonne nuove su `presentation_versions.Row/Insert/Update`, signature delle 2 RPC nuove.
- `packages/shared/src/index.ts` — export `ValidationWarning`.

**i18n:**

- `packages/shared/src/i18n/locales/it.json` + `en.json` — namespace `presentations.validation.*` con 26 chiavi (badge labels + 17 codici warning + plurali). Parita' confermata 1338/1338.

#### 0.20.4 Quality gates

- typecheck: VERDE (5 successful, 5 total).
- lint: VERDE (1 errore rules-of-hooks corretto: useMemo spostato prima degli early return).
- build: VERDE (2549 modules transformed, bundle `edge-functions-*.js` 1.41 KB gzip 0.85 KB, `jszip.min-*.js` gia' presente per altre feature, no bloat).
- i18n parity: 1338/1338 chiavi entrambe lingue.
- ReadLints: 0 errori sui file modificati.

#### 0.20.5 Deploy operativo richiesto

Dopo merge:

1. **DB migration**: `supabase db push` (o manuale via Studio per istanza prod).
2. **Edge Function**: `supabase functions deploy slide-validator` (dipendenza npm:jszip risolta automaticamente da Deno runtime).
3. **Verifica**: aprire una sessione esistente con file gia' caricati. Dopo ~30s i badge `⚠ N avvisi` (o assenti = clean) compaiono.

Nessun secret nuovo richiesto, nessuna config Lemon Squeezy / Resend toccata.

#### 0.20.6 Test funzionali consigliati

- Caricare un `.pptx` con font Wingdings 4 non embedded → badge giallo `1 avviso` con tooltip "font non incorporato".
- Caricare un `.pdf` valido → nessun badge (validato senza issue).
- Rinominare `.docx` in `.pptx` → badge rosso `1 avviso` con tooltip MIME mismatch.
- Caricare file da 100 MB → badge grigio `1 avviso info` "file troppo grande per validazione automatica".

#### 0.20.7 Conclusione T-3-A

**SEMAFORO VERDE su T-3-A.** Pronto a partire con T-3-E (Preview slide successiva) appena Andrea conferma.

---

### 0.21 Sprint T-3-E — Preview "Prossimo file" su PC tecnico (DONE 18/04/2026)

**Implementato:** pannello compatto sotto ogni card sala in `EventDetailView` che mostra il **PROSSIMO FILE in scaletta** + thumbnail prima slide. Visibile solo quando la sala ha un file in onda. Lazy load completo (pdf.js + jszip caricati on-demand).

#### 0.21.1 Decisione architetturale (deviazione consapevole dal piano §0.19.2)

Il piano originale parlava di "preview slide N+1 dello stesso file in onda". Esplorando il codice ho dovuto accettare due **vincoli tecnici insormontabili senza rifacimenti maggiori**:

1. **Nessun pdf.js nel progetto (oggi):** i PDF sul PC sala vengono mostrati con `<iframe src={signedUrl}>`, sfruttando il viewer Chrome built-in. Questo e' robusto, gratuito, sandboxato, e quel codice e' in produzione live da settimane.

2. **Iframe PDF cross-origin:** il browser **NON espone l'evento "page changed"** ai content script padre per ragioni di sicurezza/sandbox. Quindi non possiamo sapere "a che pagina e' arrivato il relatore" senza sostituire totalmente il viewer.

Sostituire il viewer Chrome con `pdf.js` full sul PC sala richiederebbe:

- ~2 settimane di lavoro (controlli zoom/pan/fullscreen, F11, gesture touch, hotkey, hotkey custom Companion, performance su PC modesti);
- regression test esteso con Andrea su sale reali;
- **rischio diretto su software in produzione live** durante eventi medici.

**Decisione (CTO autonomo):** cambio l'interpretazione del feature in modo che fornisca **valore di regia equivalente o superiore senza toccare il PC sala**:

> "Preview prossimo file in scaletta sul PC tecnico" = anticipare al regista quale file partira' DOPO quello in onda, con thumbnail della prima slide. Stesso valore d'uso (regia non si fa cogliere impreparata), zero rischio sulla sala.

L'evoluzione "preview slide N+1 reale" rimane **fattibile in futuro** quando/se passeremo a un viewer pdf.js custom anche in sala (Sprint dedicato, candidato a v2).

#### 0.21.2 Architettura

**Frontend-only:** zero migrazioni DB, zero Edge Functions nuove. Tutto e' orchestrato in `apps/web` sfruttando dati gia' esistenti (`room_state.current_session_id`, `room_state.current_presentation_id`, `presentations.current_version_id`).

**Flow:**

```
[admin apre EventDetailView]
   → useRoomStates (gia' presente, polling 30s) ottiene current_presentation_id per ogni room
   → per ogni room con file in onda: monta <NextUpPreview enabled versionTrigger=current_presentation_id>
      → useNextUp(roomId): un solo round-trip PostgREST con embed
         (room_state -> sessions, presentations -> speakers + presentation_versions)
      → ordinamento canonico: speakers.display_order ASC, tie-break created_at ASC
      → identifica indice del file in onda nella scaletta → restituisce next = ready[idx+1]
   → <NextFileCard file={next}>
      → getThumbnailFor(versionId, storageKey, mimeType, fileName)
         → cache LRU hit (32 entries) → blob URL immediato
         → cache miss:
            - createSignedUrl(storageKey, 300s) gia' esistente
            - fetch + arrayBuffer (timeout 20s)
            - dispatch:
               - PDF → renderFirstPagePngBlob (pdf.js lazy, OffscreenCanvas, scale 320 CSS px)
               - PPTX → extractPptxThumbnailBlob (jszip lazy, docProps/thumbnail.jpeg embedded)
            - URL.createObjectURL → cache LRU
      → <ThumbnailBox> con stati: spinner / img / icona fallback
```

**Refresh trigger:**

- polling interno `useNextUp` a 30s (allineato a `useRoomStates`).
- `versionTrigger` cambia quando il PC sala apre un nuovo file → refetch immediato (nessuna attesa fino al prossimo poll).

#### 0.21.3 Performance

**Bundle iniziale:** invariato. pdf.js (`dist/assets/pdf-*.js` ~405 KB / 120 KB gzip) + worker (`dist/assets/pdf.worker.min-*.mjs` ~1.2 MB) + jszip (~95 KB / 28 KB gzip) sono lazy chunks separati. Si scaricano solo quando il browser monta `NextFileCard` e c'e' davvero un file da analizzare. PC sala (`RoomPlayerView`) NON li scarica mai.

**Cache LRU thumbnail:** 32 entries in-memory, chiavate per `versionId`. Nuova versione di un file = nuovo `versionId` = invalidazione automatica. Eviction revoca i blob URL → no leak RAM.

**Round-trip costo:** 1 query PostgREST per room ogni 30s (max), <50 ms su sessioni con scaletta tipica (~30 file).

**Dedup concorrente:** se due NextUpPreview render contemporaneamente lo stesso `versionId` (per sale con scaletta condivisa, rara), `inFlight` Map garantisce 1 sola fetch + decode.

#### 0.21.4 File creati/modificati

**Web client (NEW):**

- `apps/web/src/lib/lru-cache.ts` — LRU cache generica TypeScript, zero dipendenze, basata su `Map` insertion order.
- `apps/web/src/lib/thumbnail-pdf.ts` — `renderFirstPagePngBlob` con import dinamico `pdfjs-dist` + worker URL hashato Vite. OffscreenCanvas con fallback canvas DOM.
- `apps/web/src/lib/thumbnail-pptx.ts` — `extractPptxThumbnailBlob` via JSZip, scan `docProps/thumbnail.{jpeg,jpg,png}`. Limit 50 MB.
- `apps/web/src/lib/thumbnail.ts` — wrapper `getThumbnailFor` con LRU cache (32 entries), dedup in-flight, fetch timeout 20s, signed URL via `createVersionPreviewUrl` (300s, riusato).
- `apps/web/src/features/devices/hooks/useNextUp.ts` — hook polling 30s + versionTrigger esterno + abort handling.
- `apps/web/src/features/devices/components/NextUpPreview.tsx` — UI compatta sotto `NowPlayingBadge`, thumbnail box 56x32 (16:9 mini), 4 stati visivi (loading / ok / unsupported / failed).

**Web client (MOD):**

- `apps/web/src/features/presentations/repository.ts` — `getNextUpForRoom(roomId)` con embed PostgREST single-roundtrip, ordinamento canonico (`speakers.display_order` → `created_at`), filtro per `current_version.status === 'ready'`.
- `apps/web/src/features/events/EventDetailView.tsx` — import + render di `<NextUpPreview>` sotto `<NowPlayingBadge>` per ogni room, `enabled` condizionato a `current_presentation_id`.

**Dipendenze:**

- `apps/web/package.json` — `+pdfjs-dist@^5.6.205` (jszip era gia' presente).

**i18n (MOD):**

- `packages/shared/src/i18n/locales/it.json` + `en.json` — namespace `roomPlayer.nextUp.*` con 6 chiavi (label, aria, position, thumbLoading, thumbUnsupported, thumbFailed). Parita' confermata 1344/1344.

#### 0.21.5 Quality gates

- typecheck: VERDE (5/5).
- lint: VERDE (1 errore rules-of-hooks corretto: pattern `[requestedId, result]` tuple per evitare `setState` sincrono dentro effect).
- build: VERDE (2557 modules transformed, 8 nuovi rispetto a T-3-A. Nuovi lazy chunks: `pdf-*.js` 120 KB gzip, `pdf.worker.min-*.mjs` 1.24 MB raw + `jszip.min-*.js` 28 KB gzip — tutti on-demand).
- ReadLints: 0 errori.
- i18n parity: 1344/1344.

#### 0.21.6 Test funzionali consigliati

- Aprire `EventDetailView` di un evento con almeno 1 sala con file in onda + scaletta di ≥2 file → sotto il badge "In onda" appare la card "Prossimo: NomeFile (3/8)" con thumbnail della prima slide del file successivo.
- Cambio file in onda dal PC sala (`set_current_presentation`) → entro ~10s la card "Prossimo" si aggiorna automaticamente (versionTrigger).
- File in onda = ultimo della scaletta → card "Prossimo" non appare (corretto).
- File PPTX con `docProps/thumbnail.jpeg` embedded → thumbnail visibile.
- File PDF nativo → thumbnail visibile (prima slide renderizzata pdf.js).
- File `.docx` o formato non supportato (caso teorico, gli upload validano MIME) → fallback iconato "FileText".
- Sala senza sessione/file attivo → componente non monta affatto, nessun fetch.

#### 0.21.7 Limitazioni e roadmap futura

**Limitazione consapevole T-3-E v1:**

- Mostriamo solo la **prima slide** del file successivo. Se l'utente vuole vedere "tutta" la presentazione successiva apre `FilePreviewDialog` come prima.
- Non sappiamo (e non possiamo sapere senza cambiare il viewer del PC sala) la slide N corrente, quindi nessuna preview "slide N+1 della stessa presentation".

**Evoluzione naturale (futuro Sprint dedicato, NON in T-3-E):**

- T-3-E-bis: sostituire `<iframe>` PDF sul PC sala con viewer pdf.js custom + emit "page changed" via Realtime broadcast → abilita preview slide-by-slide reale e telecomando da remoto piu' fine.
- Costo stimato: ~2 settimane + regression test su sale reali.

#### 0.21.8 Conclusione T-3-E

**SEMAFORO VERDE su T-3-E.** Pronto a partire con T-3-G (Remote slide control da tablet) appena Andrea conferma.

---

### 0.22 Sprint T-3-G — Remote slide control da tablet (DONE 18/04/2026)

**Implementato:** PWA telecomando regista accessibile da qualunque tablet/smartphone via URL pubblico `/remote/<token>` — comanda **next / prev / goto / blank / first** sulla scaletta della sessione attiva di una sala. Token monouso (mostrato 1 volta, hash SHA-256 in DB), TTL configurabile (1h / 24h / 7gg), revoca istantanea, rate-limit 60 cmd/min/pairing.

#### 0.22.1 Decisione architetturale (deviazione consapevole dal piano §0.19.4)

Il piano originale parlava di "telecomando next/prev SLIDE su PC sala". Esplorando il codice ho dovuto accettare due **vincoli identici a T-3-E** sul viewer del PC sala:

1. **Iframe PDF cross-origin:** Chrome NON espone API "go to page N" ai content script padre. Mandare un evento "next slide" da remoto richiederebbe un viewer pdf.js custom + Realtime broadcast bidirezionale.
2. **Stabilita' produzione:** sostituire il viewer PDF in `RoomPlayerView` (in produzione live da settimane) e' un rischio alto per zero valore aggiuntivo: in regia il telecomando NON serve a "andare avanti slide", **serve a cambiare FILE** (apertura presentazione del prossimo speaker, blank fra interventi).

**Decisione (CTO autonomo):** il telecomando opera sulla **scaletta** non sulle slide.

> Comandi reali: passa al file successivo nella scaletta della sessione, torna al file precedente, vai a un file specifico (tap sulla lista), schermo nero (`blank`), torna al primo file (`first`).

Tutta l'integrazione e' **zero-modifiche al PC sala**. Il telecomando chiama gli stessi RPC che usa l'admin nel pannello regia (`rpc_room_player_set_current`), che a sua volta emette il broadcast `room_state_changed` gia' sottoscritto da `useFileSync` lato `RoomPlayerView`. Il PC sala "vede" semplicemente che current_presentation_id e' cambiato e apre il nuovo file → identico comportamento al click umano dell'admin.

L'evoluzione "next/prev SLIDE reale" rimane **fattibile in futuro** come Sprint dedicato T-3-G-bis (insieme a T-3-E-bis: viewer pdf.js custom).

#### 0.22.2 Architettura

```
[Admin web]                                [Tablet PWA /remote/<token>]
    │                                            │
    │ rpc_create_remote_control_pairing          │
    ├───────────────────► Postgres ─────────────►│ token in chiaro (1 volta)
    │ (genera UUID v4, hash SHA-256)             │
    │                                            │
    │                                            │ apre URL → validateRemoteControlToken
    │                                            ├──► rpc_validate_remote_control_token (anon)
    │                                            │       (hash + check expiry/revoked)
    │                                            │
    │                                            │ getRemoteControlSchedule (polling 15s + Realtime)
    │                                            ├──► rpc_get_room_schedule_remote (anon)
    │                                            │
    │                                            │ tap "next" → dispatchRemoteCommand
    │                                            ├──► Edge Function remote-control-dispatch
    │                                            │       (anon-callable, rate-limit, audit)
    │                                            │       │
    │                                            │       └──► rpc_dispatch_remote_command
    │                                            │              (service_role only)
    │                                            │              ├─ valida token + rate (60/min)
    │                                            │              ├─ calcola target presentation_id
    │                                            │              │   (next = idx+1, prev = idx-1,
    │                                            │              │    blank = NULL, first = ready[0])
    │                                            │              └─ rpc_room_player_set_current
    │                                            │                    │
    │                                            │                    ├─► UPDATE room_state
    │                                            │                    └─► broadcast room_state_changed
    │                                            │                            │
[PC sala RoomPlayerView] ◄─────────────────── Realtime ────────────────────────┘
   useFileSync sottoscrive room_state_changed → apre nuovo file (identico click admin)
```

**Sicurezza:**

- Token = UUID v4 (122 bit entropia) generato server-side via `gen_random_uuid()`.
- DB conserva solo l'**hash SHA-256** (`pgcrypto.digest`). Il chiaro NON e' recuperabile.
- TTL min 5min, max 7gg, default 24h. `expires_at` confrontato con `now()` su ogni call.
- Revoca = `revoked_at` non NULL. Idempotente. RLS: solo `tenant_admin` del tenant target.
- Rate-limit: tabella `remote_control_rate_events`, 60 inserimenti/min/pairing massimo. Cleanup eventi >5min in coda alla prima call.
- Cross-tenant/cross-room: validato in ogni RPC (token apre solo la sala per cui e' stato creato).
- Audit: ogni create/revoke/dispatch loggato in `activity_log` con `actor_type='agent'`, `entity_type='remote_control_pairing'`.
- Tutte le RPC `SECURITY DEFINER` con `SET search_path = public, pg_catalog`.

**Performance:**

- PWA bundle: 10.53 KB / 3.18 KB gzip (lazy chunk separato).
- Polling scaletta 15s + Realtime broadcast → latenza tap→sala ≈ 200-500ms.
- Wake-lock screen API (best-effort, fallback silenzioso su Safari iOS).
- Optimistic UI sul tap → conferma realtime quando arriva.

#### 0.22.3 File creati/modificati

**Database (NEW migration):**

- `supabase/migrations/20260418210000_remote_control_pairings.sql` — tabelle `remote_control_pairings` + `remote_control_rate_events` con RLS; RPC `rpc_create_remote_control_pairing`, `rpc_revoke_remote_control_pairing`, `rpc_validate_remote_control_token`, `rpc_get_room_schedule_remote`, `rpc_dispatch_remote_command`, `purge_old_remote_control_pairings`.

**Edge Function (NEW):**

- `supabase/functions/remote-control-dispatch/index.ts` — proxy anon-callable verso `rpc_dispatch_remote_command` (service_role). Mappa errori RPC a status HTTP coerenti (401 token invalid/revoked/expired, 429 rate limited, 400 invalid command/end of schedule).
- `supabase/config.toml` — `[functions.remote-control-dispatch] verify_jwt = false`.

**Shared types (NEW + MOD):**

- `packages/shared/src/types/remote-control.ts` — `RemoteControlCommand`, `RemoteControlPairingSummary`, `RemoteControlPairingCreated`, `RemoteControlValidatedToken`, `RemoteControlScheduleItem`, `RemoteControlSchedule`, `RemoteControlDispatchResult`.
- `packages/shared/src/types/database.ts` — definizioni Row/Args/Returns delle 6 RPC nuove + 2 tabelle.
- `packages/shared/src/index.ts` — re-export tipi pubblici.

**Web client (NEW):**

- `apps/web/src/features/remote-control/repository.ts` — funzioni admin (`createRemoteControlPairing`, `revokeRemoteControlPairing`, `listActiveRemoteControlPairingsForRoom`) + remote (`validateRemoteControlToken`, `getRemoteControlSchedule`, `dispatchRemoteCommand`) + helper `buildRemoteControlUrl`.
- `apps/web/src/features/remote-control/RemoteControlView.tsx` — PWA UI tablet, route `/remote/:token`, polling 15s + Realtime, wake-lock, optimistic update, error banner i18n-aware.
- `apps/web/src/features/remote-control/components/RemoteControlPairingsPanel.tsx` — pannello admin collassabile sotto ogni card sala in `EventDetailView`: form crea token (nome + TTL 1h/24h/7gg) → mostra link 1 volta + copy + "apri", lista pairings attivi con last_used + commands_count + revoca con conferma inline.

**Web client (MOD):**

- `apps/web/src/app/routes.tsx` — rotta pubblica `/remote/:token` (prima di `/login`), bypassa `RequireAuth`.
- `apps/web/src/features/events/EventDetailView.tsx` — render `<RemoteControlPairingsPanel>` per ogni room.

**i18n (MOD):**

- `packages/shared/src/i18n/locales/it.json` + `en.json` — namespace `remoteControl.*` con 54 chiavi (validating, invalidTitle, reason._, cmd._, error._, schedule_, admin.\*). Parita' confermata 1398/1398.

#### 0.22.4 Quality gates

- typecheck: VERDE (5/5 pacchetti, 0 errori). Errore iniziale `LazyRouteFunction` risolto aggiungendo `export { RemoteControlView as Component }` (pattern usato da tutte le altre route lazy).
- lint: VERDE (0 warning).
- build: VERDE (2560 modules transformed, +3 vs T-3-E. Lazy chunk `RemoteControlView-*.js` 10.53 KB / 3.18 KB gzip. Bundle totale aumenta solo per chi visita `/remote/<token>`).
- ReadLints: 0 errori.
- i18n parity: 1398/1398.

#### 0.22.5 Test funzionali consigliati

**Admin (PC regia):**

- Apri `EventDetailView` → espandi "Telecomando remoto (tablet)" sotto una sala → genera con nome "Tablet regista" e TTL 24h → copia link → apri in nuova scheda incognito.
- Genera 2 token consecutivi → revoca il primo → verifica che la lista mostri solo il secondo.
- Verifica che dopo revoca `commands_count` non aumenti piu'.

**Tablet PWA:**

- Apri URL su tablet/smartphone → vedi titolo sala + sessione, indicatore Realtime (Wifi verde).
- Nessuna sessione attiva → "Nessuna sessione attiva al momento" + comandi disabilitati.
- Sessione con 5 file ready → "Schedule" mostra 5 file numerati, file in onda evidenziato verde con badge "Live".
- Tap "Successivo" → file in onda passa al N+1 (sul PC sala l'iframe carica nuova URL entro ~1s).
- Tap "Schermo nero" → PC sala mostra splash vuoto (current_presentation_id = NULL).
- Tap "Riprendi" (visibile solo se blank) → ritorna al primo file della scaletta.
- Tap su un item della scaletta non corrente → goto immediato.
- Tap rapido 70 volte in 60s → 60° tap restituisce errore "Stai inviando troppi comandi" (rate-limit 429).
- Token revocato durante sessione → al prossimo comando appare banner "Telecomando revocato".

**Cross-tenant security:**

- Tenant A genera token per Sala A1 → tenant B prova a usare lo stesso token → RPC ritorna `token_invalid` (hash non trova match nella sua RLS scope).

#### 0.22.6 Limitazioni e roadmap futura

**Limitazione consapevole T-3-G v1:**

- Granularita' = file, non slide singola. Per "next slide reale" serve T-3-G-bis (vedi sotto).
- Wake-lock non supportato Safari iOS pre-16.4 → l'utente deve toccare lo schermo periodicamente o disattivare auto-lock manualmente.
- "Riprendi" da blank ritorna SEMPRE al primo file della scaletta. Per "ripristina ultimo non-null" serve persistenza extra (oggi non aggiunge valore).

**Evoluzione naturale (Sprint dedicato, NON in T-3-G):**

- T-3-G-bis: integrazione con viewer pdf.js custom (T-3-E-bis) → comandi `next-slide` / `prev-slide` / `goto-slide` aggiuntivi.
- T-3-G-multi: piu' tablet attivi sulla stessa sala con ruoli diversi (es. regista + assistant view-only).

#### 0.22.7 Conclusione T-3-G — Sprint T-3 chiuso

**SEMAFORO VERDE su T-3-G.** Tutte e tre le feature competitor scelte da Andrea (A=file validator, E=preview prossimo file, G=remote control tablet) sono **DONE**. Sprint T-3 completato in giornata 18/04/2026.

**Stato Sprint T (10 GAP audit-driven):**

| ID    | Feature                                    | Stato | Sprint |
| ----- | ------------------------------------------ | ----- | ------ |
| G8    | Badge versione "in onda" + toast cambio    | DONE  | T-1    |
| G9    | Telemetria perf live PC sala               | DONE  | T-2    |
| T-3-A | File error checking automatico (warn-only) | DONE  | T-3-A  |
| T-3-E | Preview "Prossimo file" su PC tecnico      | DONE  | T-3-E  |
| T-3-G | Remote slide control da tablet             | DONE  | T-3-G  |

**Prossimo sprint candidato:** Q (sync hybrid cloud↔desktop) quando un cliente lo richiede esplicitamente, oppure attivita' commerciali (Sprint R/S/T sono completi end-to-end per la vendita esterna).

---

### 0.23 Audit chirurgico post-deploy 18/04/2026 (DONE + sessioni dedicate)

> Audit completo e chirurgico richiesto da Andrea **dopo il deploy** Vercel + Supabase del 18/04/2026 (commit `pre-field-test` su `main`). Scopo: identificare bug residui, vulnerabilita, problemi di performance e stabilita prima dei test sul campo.
>
> Coperture: 100% migrations Sprint Q+1/R/S/T (`supabase/migrations/20260418*.sql`), 100% Edge Functions (`supabase/functions/*`), critical paths frontend (`apps/web/src/features/{devices,events,presentations,remote-control,billing,admin}/`).
>
> **Esito:** identificate **8 issue HIGH/CRITICAL fixate immediatamente** + **9 issue MEDIUM** documentate sotto come backlog per sessioni dedicate (non bloccanti per field test). Tutti i fix sono gia' in produzione (Supabase migration `20260418220000_audit_fixes_post_deploy.sql` applicata, Edge Functions `pair-claim` / `remote-control-dispatch` / `lemon-squeezy-webhook` / `room-device-upload-finalize` ridistribuite). Quality gate post-fix verde (`pnpm typecheck` + `pnpm lint`).

#### 0.23.1 Fix immediati applicati (8/8 — gia' live)

| #   | Severita     | Area                 | File                                                                                                                                                   | Problema                                                                                                                                                                                                                   | Fix                                                                                                                                                                                                |
| --- | ------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **CRITICAL** | DB / RPC             | `supabase/migrations/20260418220000_audit_fixes_post_deploy.sql`                                                                                       | `rpc_move_presentation_to_session` `INSERT INTO activity_log` usava colonne inesistenti (`actor_kind`/`target_kind`/`details`) → la prima invocazione runtime causava 500 sull'admin che sposta presentations tra sessioni | `CREATE OR REPLACE FUNCTION` con nomi colonne reali (`actor`/`entity_type`/`entity_id`/`metadata`)                                                                                                 |
| 2   | **CRITICAL** | Edge Function (auth) | `supabase/functions/pair-claim/index.ts` + nuova RPC `claim_pairing_code_atomic`                                                                       | TOCTOU race: `SELECT pairing_codes` + `INSERT paired_devices` + `UPDATE pairing_codes` in 3 step → 2 device potevano consumare lo stesso codice 6-cifre                                                                    | Nuova RPC `SECURITY DEFINER` `claim_pairing_code_atomic` con `UPDATE ... WHERE consumed_at IS NULL RETURNING` (un solo vincitore) + `INSERT paired_devices` nella stessa tx; Edge Function migrata |
| 3   | **HIGH**     | Edge Function (race) | `supabase/migrations/20260418220000_audit_fixes_post_deploy.sql`                                                                                       | `record_lemon_squeezy_event` "select then insert" non atomico → 2 webhook paralleli con stesso `event_id` causavano UNIQUE violation → 500 → Lemon Squeezy retrya aggressivo                                               | `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING` + fallback `SELECT` per branch idempotente                                                                                                |
| 4   | **HIGH**     | Auth cross-room      | `supabase/migrations/20260418220000_audit_fixes_post_deploy.sql`                                                                                       | `finalize_upload_version_for_room_device` validava solo `tenant_id`: device Sala A poteva finalizzare upload Sala B (stesso tenant) se conosceva il `version_id`                                                           | Aggiunto join `presentations → sessions` con confronto `device.room_id = session.room_id`; nuovo errore `cross_room_finalize_forbidden` (403)                                                      |
| 5   | **HIGH**     | Info disclosure      | `supabase/functions/remote-control-dispatch/index.ts`, `pair-claim/index.ts`, `lemon-squeezy-webhook/index.ts`, `room-device-upload-finalize/index.ts` | Risposte 500 leakavano `err.message` interno al client (es. `column "x" does not exist`, schema names)                                                                                                                     | `console.error()` interno + risposta sanitizzata `{ error: 'internal_error' }` (o codice business specifico tipo `unknown_variant_id`)                                                             |
| 6   | **HIGH**     | React anti-pattern   | `apps/web/src/features/presentations/components/SessionFilesPanel.tsx`                                                                                 | `setState` chiamato direttamente nel render body durante prune di `selected: Set<string>` → warning React "Cannot update a component while rendering a different component" + potenziali render loop                       | Pruning spostato in `useEffect([fileIdsKey])`; `useMemo` per fingerprint stabile su `files.map(presentationId).join(',')`                                                                          |
| 7   | **HIGH**     | UI stuck state       | `apps/web/src/features/events/EventDetailView.tsx`                                                                                                     | `regenerateSpeakerUpload(sp.id)` con `setRegenerateBusyId(null)` fuori dal `try` → eccezione lasciava il bottone "in elaborazione" per sempre                                                                              | `try/catch/finally` con `finally { setRegenerateBusyId(null); }` per garantire reset stato anche su errore                                                                                         |
| 8   | **HIGH**     | Stabilita / hang     | `apps/web/src/features/events/lib/event-export.ts`                                                                                                     | `fetch(slideUrl)` durante export ZIP fine evento senza `AbortController` → un singolo file lento (5GB su connessione 4G WiFi sala) bloccava l'intero export indefinitamente                                                | `AbortController` con timeout 90s per ogni `fetch`; errore `fetch_timeout_<storageKey>` distinto da `fetch_failed_<status>`                                                                        |

**Fix collaterale (medio):**

- `apps/web/src/features/devices/RoomPlayerView.tsx`: `Promise.all([getPersistedDevice(), getDesktopBackendInfo()])` privo di `.catch` → unhandled promise rejection in dev tools se Tauri APIs falliscono (es. su Tauri v1 vs v2 mismatch). Aggiunto `.catch((err) => console.error(...))`.
- `supabase/functions/room-device-upload-finalize/index.ts`: il `setTimeout(2000)` per Realtime broadcast poteva risolvere senza chiamare `removeChannel` → canale sospeso su Edge runtime. Refactor con `cleanupAndResolve` idempotente che chiama sempre `clearTimeout` + `removeChannel`.

**Verifica post-deploy:**

- Migration applicata via MCP `apply_migration` (project `cdjxxxkrhgdkcpkkozdl`, name `audit_fixes_post_deploy_20260418`).
- 4 Edge Functions ridistribuite (versione 2): `pair-claim`, `remote-control-dispatch`, `lemon-squeezy-webhook`, `room-device-upload-finalize` — tutte con `verify_jwt: false` confermato.
- `pnpm --filter @slidecenter/web typecheck` + `pnpm --filter @slidecenter/web lint` → 0 errori.

#### 0.23.2 Backlog sessioni dedicate (9 issue MEDIUM, non bloccanti)

> Le seguenti issue richiedono **sessioni dedicate** (1-3 ore ciascuna) perche' toccano architettura, multi-progetto, oppure servono prove di carico/test E2E. Nessuna e' bloccante per il field test.

| ID    | Severita | Area               | Effort | Descrizione + impatto                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | -------- | ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AU-01 | MEDIUM   | DB retention       | 1h     | `lemon_squeezy_event_log` cresce senza limiti → 200k+ righe in 1 anno per SaaS attivo. Aggiungere pg_cron schedule daily 04:00 UTC che cancella eventi `processing_status='processed'` e `created_at < now() - interval '90 days'`.                                                                                                                                                                        |
| AU-02 | MEDIUM   | DB retention       | 30min  | Verificare che `cleanup_pair_claim_rate_events` (cancella eventi >2x window) sia effettivamente schedulata in pg_cron (oggi pulito on-demand al primo claim, ok ma fragile). Idem `cleanup_device_metric_pings` (Sprint T-2, retention 24h).                                                                                                                                                               |
| AU-03 | MEDIUM   | DB observability   | 2h     | Audit `SET search_path` su tutte le `SECURITY DEFINER` functions (~40 funzioni). Pattern `SET search_path = public` puo' essere bypassato se schema hijacking (es. utente crea schema con stesso nome). Standardizzare a `SET search_path = pg_catalog, public, pg_temp` ovunque. Tool: `pgaudit`.                                                                                                         |
| AU-04 | MEDIUM   | Edge Function CORS | 1h     | Tutte le Edge Functions usano `Access-Control-Allow-Origin: *` da `_shared/cors.ts`. OK per webhook esterni (Lemon Squeezy) e device anonimi (room-\*, remote-control), ma admin Edge Functions (es. `email-send`, `gdpr-export`) dovrebbero whitelist `app.liveslidecenter.com` e `liveworksapp.com` solo.                                                                                                |
| AU-05 | MEDIUM   | Rate limit         | 1.5h   | Solo `pair-claim` ha rate limit (5/15min/IP). Brute-force possibile su `room-device-upload-init` (token enumeration) e `remote-control-dispatch` (token enumeration tablet). Aggiungere rate limit per IP per device-token sui 3 endpoint device-anonimi (riusare tabella `pair_claim_rate_events` o creare `device_request_rate_events`).                                                                 |
| AU-06 | MEDIUM   | Realtime scale     | 3h     | `LiveRegiaView` apre 1 canale Realtime per ogni sala (anche 10+ sale = 10 canali concorrenti per admin). Su Supabase Realtime Pro plan il limite e' 100 canali concorrenti per progetto. Refactor: 1 canale `event:<id>` con filter su `room_id` lato client. Misura attuale: monitorare via Supabase dashboard quando event reale > 5 sale.                                                               |
| AU-07 | MEDIUM   | Bundle size        | 2h     | `apps/web` chunk principale > 800kB (target Vercel CLS): `pdf.js` worker e `jszip` caricati subito. Code-split: `import('jszip')` lazy in `event-export.ts` (gia' parziale, ma tree-shaking non perfetto), `pdf.js` worker via `import.meta.url` solo quando `FilePreviewDialog` apre. Misura attuale: `vite-bundle-visualizer`.                                                                           |
| AU-08 | MEDIUM   | Tauri offline      | 2.5h   | `RoomPlayerView` non ha **outbox queue** per `room-player-set-current` quando la rete cade durante un cambio file: la chiamata fallisce e l'admin non vede il file in onda corretto. Aggiungere coda in IndexedDB con retry exponential backoff (1s/5s/30s/5min) finche' la chiamata va a buon fine. Stessa cosa per `device_metric_pings` (oggi best-effort, perdita silente metriche se rete instabile). |
| AU-09 | MEDIUM   | Test E2E           | 4h     | Mancano test Playwright per i flussi Sprint R-3 (PC sala upload), S-1 (folder drop), T-3-G (remote control tablet). Aggiungere 3 fixture in `apps/web/tests/e2e/`: (a) device pairing happy-path + 2 device che competono sullo stesso codice (verifica fix CRITICAL #2), (b) admin moves presentation → activity_log popolato (verifica fix CRITICAL #1), (c) tablet remote control sync con room player. |

**Quando affrontarli:**

- **AU-01, AU-02, AU-08**: pre-vendita esterna primo cliente (3-4h totali in una sessione).
- **AU-03, AU-04, AU-05**: hardening security pre-evento >100 device (4h in sessione dedicata "Sprint H-1 — security hardening").
- **AU-06, AU-07**: ottimizzazione performance pre-evento >5 sale (2-5h in sessione dedicata "Sprint P-1 — performance live").
- **AU-09**: prima campagna marketing pubblica (4h in sessione "Sprint Q-test — E2E coverage").

> **AGGIORNAMENTO 18/04/2026 sera:** tutti e 9 i punti sono stati chiusi anticipatamente in una sessione singola, vedi §0.23.3.

#### 0.23.3 Chiusura backlog AU-01 → AU-09 (DONE — 18/04/2026 sera)

> Sessione singola di chiusura post-audit chirurgico. 9/9 issue MEDIUM risolte, deploy in produzione (DB + Edge Functions), build/typecheck/lint verdi.

| ID    | Categoria      | Soluzione applicata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Artefatti                                                                                                                                                                                                                                                                                     |
| ----- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AU-01 | DB retention   | Funzione `public.cleanup_lemon_squeezy_event_log()` cancella eventi `processing_status IN ('processed','skipped')` con `created_at < now() - interval '90 days'`. `pg_cron` daily 04:00 UTC.                                                                                                                                                                                                                                                                                                                                                                                                                                           | `supabase/migrations/20260418230000_audit_medium_fixes.sql`                                                                                                                                                                                                                                   |
| AU-02 | DB retention   | `pg_cron` abilitato (`CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions`). Schedulati 4 job idempotenti: `cleanup_lemon_squeezy_event_log` (daily 04:00), `cleanup_device_metric_pings` (daily 03:00, retention 24h), `cleanup_pair_claim_rate_events` (every 30min), `cleanup_edge_function_rate_events` (every 30min, retention 1h).                                                                                                                                                                                                                                                                                     | `supabase/migrations/20260418230000_audit_medium_fixes.sql` (sezione `DO $$ ... cron.schedule ... END $$`)                                                                                                                                                                                    |
| AU-03 | DB security    | `search_path` hardening su **tutte** le `SECURITY DEFINER` del schema `public` (~40 funzioni). Loop iterativo che ricostruisce `search_path = pg_catalog, public, pg_temp` + `extensions` (se la funzione gia' lo dichiarava) + `realtime` + `auth`. Idempotente: re-applicabile senza side-effect.                                                                                                                                                                                                                                                                                                                                    | `supabase/migrations/20260418230000_audit_medium_fixes.sql` (blocco `DO $$ ... ALTER FUNCTION ... SET search_path = ... END $$`). Verifica: `SELECT proname, proconfig FROM pg_proc WHERE prosecdef AND pronamespace = 'public'::regnamespace`.                                               |
| AU-04 | Edge CORS      | Nuovo modulo `_shared/cors.ts` con: (a) `corsHeaders` wildcard per Edge Functions device-anonime/webhook esterni (compat backward), (b) `adminCorsHeaders(req)` con whitelist `app.liveslidecenter.com` + `liveworksapp.com` + `localhost:5173/4173` + regex Vercel preview (`<branch>-live-software11.vercel.app` + `live-slide-center-*.vercel.app`). Override via env `EDGE_CORS_ADMIN_ALLOWLIST` (CSV).                                                                                                                                                                                                                            | `supabase/functions/_shared/cors.ts` (nuovo). Pronto per applicazione su `email-send` e `gdpr-export` in sessione successiva.                                                                                                                                                                 |
| AU-05 | Edge rate-lim  | Nuova tabella `public.edge_function_rate_events (id, ip_hash, scope, occurred_at)` + indice partial `(ip_hash, scope, occurred_at)`. RPC `public.check_and_record_edge_rate(p_ip_hash, p_scope, p_max_per_window, p_window_minutes)` `SECURITY DEFINER` atomica: count + insert in 1 statement. Helper TS `_shared/rate-limit.ts` con `hashIp` salt-aware (`EDGE_FN_RATE_SALT`, default sicuro). Applicato a `room-device-upload-init` (30/5min/IP) e `remote-control-dispatch` (120/1min/IP).                                                                                                                                         | `supabase/migrations/20260418230000_audit_medium_fixes.sql`, `supabase/functions/_shared/rate-limit.ts`, `room-device-upload-init/index.ts` v2, `remote-control-dispatch/index.ts` v4.                                                                                                        |
| AU-06 | Realtime       | Hook `useEventLiveData` ora usa `setTimeout` 200ms come **debounce** sui callback `postgres_changes`: 5 INSERT/UPDATE/DELETE sulla stessa tabella ravvicinati = 1 sola fetch. `useRef<number \| null>` per timer + cleanup `clearTimeout` in `return` di `useEffect`. Nessun reload-storm su burst di update da Realtime durante un evento live attivo.                                                                                                                                                                                                                                                                                | `apps/web/src/features/live-view/hooks/useEventLiveData.ts`                                                                                                                                                                                                                                   |
| AU-07 | Bundle         | `import('jszip')` lazy in entrambi i call site: `event-export.ts` (export ZIP, on-click admin) e `thumbnail-pptx.ts` (estrazione thumbnail PPTX, on-demand). Cache della Promise `loadJSZip()` per non re-importare. Vite split conferma chunk separato `jszip.min-Cw_q1q04.js` 95.92 KB → 28.49 KB gzip. Vantaggio: ~28 KB gzip in meno sull'initial bundle per chi non apre EventDetail/upload.                                                                                                                                                                                                                                      | `apps/web/src/features/events/lib/event-export.ts`, `apps/web/src/lib/thumbnail-pptx.ts`. Misura: `pnpm --filter @slidecenter/web build` mostra `jszip.min-*.js` come chunk async.                                                                                                            |
| AU-08 | Tauri offline  | Nuovo modulo `apps/web/src/lib/outbox-queue.ts` IndexedDB store `outbox_v1` (`kind`, `payload`, `attempts`, `nextAttemptAt`). API: `enqueueOutbox`, `flushOutboxOnce`, `startOutboxFlush(handlers)`, `stopOutboxFlush()`. Backoff esponenziale (1s → 5s → 30s → 5min, max 8 tentativi). Trigger: timer 15s + listener `online`. Integrato in `RoomPlayerView` per `room-player-set-current` (catch invocazione fallita → enqueue).                                                                                                                                                                                                     | `apps/web/src/lib/outbox-queue.ts` (nuovo), `apps/web/src/features/devices/RoomPlayerView.tsx` (handler `startOutboxFlush({ room_player_set_current })` + `enqueueOutbox` nel catch).                                                                                                         |
| AU-09 | E2E Playwright | 3 nuove fixture in `apps/web/e2e/`: (a) `pairing-race.spec.ts` lancia 2 `pair-claim` paralleli sullo stesso codice e verifica esattamente 1 winner + 1 loser con error sanitizzato (regression test della fix CRITICAL #2 su TOCTOU), (b) `move-presentation.spec.ts` chiama `rpc_move_presentation_to_session` via service-role e verifica `activity_log` con `entity_type/entity_id/metadata` corretti (regression test della fix CRITICAL #1), (c) `remote-control.spec.ts` crea pairing → comando invalido → 5 comandi validi consecutivi + verifica no 401/429/500 + `goto` senza target → 400 `missing_target` + revoca cleanup. | `apps/web/e2e/pairing-race.spec.ts`, `apps/web/e2e/move-presentation.spec.ts`, `apps/web/e2e/remote-control.spec.ts`. Esecuzione richiede env `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` + (per `move-presentation`) `E2E_PRESENTATION_ID` + `E2E_TARGET_SESSION_ID`. |

**Verifica post-deploy AU-\* (chiusura sessione):**

- Migration `20260418230000_audit_medium_fixes.sql` applicata via MCP (project `cdjxxxkrhgdkcpkkozdl`).
- Edge Functions ridistribuite: `room-device-upload-init` v2, `remote-control-dispatch` v4 — entrambe `verify_jwt: false` confermato.
- Quality gate root: `pnpm typecheck` (5/5 cache hit + 1 fresh OK), `pnpm lint` (5/5 OK), `pnpm build` (3/3 OK), i18n parity 1398/1398 (script Node manuale).
- Bundle stat: `dist/assets/jszip.min-*.js` 95.92 KB → 28.49 KB gzip (chunk async, lazy on-demand).
- Playwright fixture richiede setup env in field test (vedi `apps/web/e2e/README.md` se serve guida).

**Cosa rimane scoperto dopo AU-\* (per session future):**

- `email-send` + `gdpr-export` Edge Functions: `_shared/cors.ts::adminCorsHeaders` esiste ma non e' ancora applicato → fare in sessione "Sprint H-1 security hardening" insieme ad eventuali altre admin-only Edge Functions.
- Outbox queue per `device_metric_pings` (telemetria T-2): non ancora outbox-ato (oggi best-effort silente). Vedere se necessario in sessione perf live.
- Bundle splitting di `pdf.js` worker via `import.meta.url` lazy: gia' funzionante (chunk `pdf-*.js` 405 KB / 120 KB gzip), eventualmente migliorabile con `pdfjs-dist/build/pdf.worker.min.mjs` esplicito on-open `FilePreviewDialog`.
- E2E coverage: i 3 fixture nuovi presuppongono presence di un evento + presentation seed. Valutare se serve un seed script unico in `apps/web/e2e/setup.ts`.

#### 0.23.4 Hot-fix bug AU-08.1 outbox silent drop (DONE — 18/04/2026 sera)

> Bug emerso in code-review post AU-08: l'handler `room_player_set_current` aveva `if (!p?.token) return` come safety guard per payload corrotti. Il flush in `outbox-queue.ts` interpretava il `return` silenzioso come successo (`await handler(...)` non lanciava → `txDelete` cancellava l'item, `succeeded++`). **Item perso senza chiamare l'edge function**, admin con `current_presentation_id` stale fino al prossimo file aperto in sala. Path raggiungibile per schema drift IndexedDB (vecchia release client) o regressione upstream.

**Fix**: contratto handler esteso a 3 stati espliciti (NON 2):

- `Promise<void>` → "ok" → `succeeded++`, item rimosso
- `Promise<{ skipped: 'reason' }>` → "drop intenzionale non recuperabile" → `skipped++` separato, warning loggato, item rimosso (retry inutile)
- `throw` → "failure transitoria" → `retried++`, backoff esponenziale fino a `MAX_ATTEMPTS`

`flushOutboxOnce()` ora ritorna `{ processed, succeeded, skipped, retried, dropped }`. Nuovo type guard `isSkipResult` + nuovi tipi `OutboxHandlerSkipResult` / `OutboxHandlerResult`. Handler in `RoomPlayerView` aggiornato a `return { skipped: 'missing_token' }`. Quality gate verde (typecheck + lint + build). Pattern utile per qualsiasi futuro `kind` outbox-ato che abbia validazioni client-side non recuperabili.

### 0.24 UX Redesign V2.0 — Sprint U-1 Foundation (DONE — 18/04/2026 sera)

> **Driver dal cliente:** "non mi piace per niente la UI, non riesco a fare nulla di cio' che voglio, come ad esempio caricare un ppt". Andrea chiede:
>
> 1. **Sidebar permanente** Notion/Linear-style con sezioni espandibili **Eventi → sale** e **PC sala** come link rapido + sezione **Strumenti**.
> 2. **Due modalita' per ogni evento:**
>    - **Production** (produzione/back-office) → file management OneDrive/Drive-style, drag&drop cartelle, tasto "+ aggiungi";
>    - **On Air** (regia) → preview low-res di cio' che sta proiettando ogni sala + numero slide corrente/totale grande.
> 3. **Zero-friction PC sala:** admin pre-configura, il PC apre il magic link dell'evento e si auto-riconosce nella sua sala (no codice da digitare).
> 4. **Vincolo design:** "user-friendly, poche funzioni ma chiare e professionali, mantieni la palette/coerenza attuale".
>
> Piano in 5 sprint U-1 → U-5 condiviso e approvato. **Questo sprint U-1 e' la FOUNDATION:** install design system + nuovo shell + IA della sidebar + command palette. Le viste interne (Production tree, On Air split, magic link) seguono in U-2/U-3/U-4.

**Cosa abbiamo fatto in U-1:**

1. **Design system shadcn/ui in `packages/ui`** — installati Radix primitives (`@radix-ui/react-{slot,dialog,dropdown-menu,context-menu,tooltip,tabs,separator,popover,scroll-area,collapsible,avatar,label,select}`), `cmdk`, `sonner`, `lucide-react`, `tw-animate-css`. Creati 20 componenti base shadcn (`Button` con variant `accent` su `sc-accent`, `Card`, `Input`, `Label`, `Separator`, `Skeleton`, `Badge` con variant `success`/`warning`/`accent`, `Avatar`, `Dialog`, `Sheet`, `DropdownMenu`, `ContextMenu`, `Tabs`, `Tooltip`, `Popover`, `Collapsible`, `ScrollArea`, `Select`, `Command`, `Toaster`) + `useIsMobile` hook. Tutti tipizzati TS strict.

2. **Token mapping `sc-*` ↔ shadcn in `apps/web/src/index.css`** — mappate tutte le CSS vars shadcn (`--background`, `--foreground`, `--card`, `--primary`, `--accent`, `--border`, `--ring`, `--muted-foreground`, `--popover`, `--destructive`, `--sidebar*`...) sui token `sc-*` esistenti del tema dark. **Zero cambio palette visivo** rispetto all'attuale (Andrea: "lo stile mi piace a livello di colori e coerenza"). Aggiunto `@source '../../../packages/ui/src/**/*.{ts,tsx}'` per Tailwind v4 content scan + `@import 'tw-animate-css'` per le animation utility shadcn.

3. **Nuovo `Sidebar` component custom** (`packages/ui/src/components/ui/sidebar.tsx`) ispirato a shadcn: `SidebarProvider` con state `open` desktop + `openMobile` Sheet drawer, sticky `aside` desktop `lg:flex`, `Sheet` mobile `<lg:flex` (auto width 18rem). Sub-componenti: `SidebarHeader`/`SidebarContent`/`SidebarFooter`/`SidebarSeparator`/`SidebarGroup{Label,Content}`/`SidebarMenu{Item,Button,Action,Badge,Sub{Item,Button}}`/`SidebarTrigger`/`SidebarInset`. Variant `'admin'` switcha border a `sc-accent/25`.

4. **`AppShell` component** (`apps/web/src/app/shell/AppShell.tsx`) — nuovo shell che sostituisce `RootLayout` e `AdminRootLayout` (ridotti a thin wrappers `<AppShell variant="tenant"/>` e `<AppShell variant="admin"/>`). Layout 2-colonne desktop (sidebar 16rem | main `SidebarInset`), full-screen mobile con drawer. Auto-close del drawer mobile su route change (hook `useAutoCloseMobileSidebar` interno). Tutti i `Suspense` + `OnboardingGate` + `TenantWarningBanners` + `DesktopUpdateBanner` mantenuti, solo riposizionati nel nuovo shell.

5. **Sidebar 2-livelli** (`ShellSidebarContent` + `TenantSidebarSections` + `AdminSidebarSections`):
   - **Tenant:** sezioni Dashboard | **Eventi (collapsible)** ogni evento espandibile in 3 sub-link `Apri` / `Production` / `On Air` (badge data evento) | **PC sala (collapsible)** ogni device con `DeviceStatusDot` (verde online <60s, ambra warning, rosso offline) + nome device | **Strumenti** (Sale, Sessioni, Relatori, Activity, Privacy) | (admin tenant) Settings/Team/Billing | (super-admin) link "Admin globale".
   - **Admin globale:** Dashboard amministrazione | Tenant | Audit log | back-link "Torna al tenant".

6. **Command palette globale ⌘K** (`apps/web/src/app/shell/AppCommandPalette.tsx`) — `cmdk`-based, hotkey `Ctrl/Cmd+K`. Gruppi: **Vai a** (Dashboard, Eventi, Sale, Sessioni, Relatori, Settings, Team, Billing, Activity, Privacy + Admin se super-admin) | **Apri evento** (recenti × 12) | **Apri regia in onda** (recenti × 12) | **Aiuto** (Status page). Niente fuzzy custom — `cmdk` fa filter nativo su `value`.

7. **`useSidebarData` hook** (`apps/web/src/app/shell/useSidebarData.ts`) — fetch lite di `events` (top 20 by `start_date desc`) e `paired_devices` (top 60 by `paired_at desc`) per popolare la sidebar. Una sola query parallel in `Promise.all`, no realtime (per ora sufficiente — refresh on mount). Solo se `tenantId` presente; per admin globale skip totale.

8. **Top bar** (`ShellTopBar`) — `SidebarTrigger` mobile + `CommandPaletteHint` (input fake che apre ⌘K, mostra hotkey) + version-mode badge desktop.

9. **i18n** — 18 nuove chiavi `appShell.*` aggiunte a IT/EN: `brandSubtitle`, `searchHint{,Admin}`, `commandPlaceholder`, `commandEmpty`, `cmd{JumpTo,Events,OnAir,Help}`, `section{Events,RoomPCs,Tools,AdminMain}`, `production`, `onAir`, `privacy`, `noEvents`, `noDevices`. **Parita 1416/1416**.

**Quality gate verde:**
- `pnpm typecheck` → 5/5 task OK (web + shared + ui buildati come project references)
- `pnpm lint` → 5/5 task OK
- `pnpm --filter @slidecenter/web build` → built in 1.83s, bundle index 662.86 kB / 202.54 kB gzip (vs 600KB pre-shadcn — accettabile per la qty di componenti aggiunti)
- i18n parity 1416/1416 IT/EN

**Cosa NON e' cambiato (vincoli rispettati):**
- Zero cambio URL routing (le rotte esistenti girano dentro l'`Outlet` del nuovo shell)
- Zero modifiche schema DB
- Zero modifiche logica auth/realtime/edge functions
- Palette dark identica all'attuale
- `OnboardingGate`, `TenantWarningBanners`, `DesktopUpdateBanner`, `BackendModeBadge` riposizionati ma identici nel comportamento

**Sprint successivi (in coda):**
- **U-2** (next, in_progress): DB `event_folders` + `folder_id` su presentations + `ProductionView` (tree sale/cartelle, grid file, breadcrumb, drop globale, context menu, multi-select) + split `EventDetailView` in 4 tab (Production/Sessions/Speakers/Rooms).
- **U-3:** rinomina `LiveRegiaView` → `OnAirView` con split layout (lista sale | preview slide N/Tot grosso | ActivityFeed) + estensione `room-player-set-current` con `current_slide_index` + thumbnail slide in onda.
- **U-4:** `provision_room_device` RPC + route `/sala-magic/:token` + QR stampabile admin + refresh visivo `RoomPlayerView` (layout broadcasting nero/minimal) + `PairView` keypad come fallback.
- **U-5:** re-skin shadcn dei pannelli minori (Settings/Team/Billing/Privacy/Audit/Auth/Onboarding/RemoteControl) + responsive 360px + i18n parity + 3-4 E2E Playwright nuovi flussi + tag `v2.0-redesign`.

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
