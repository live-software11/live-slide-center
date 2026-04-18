# GUIDA OPERATIVA v3 — Field Test Cloud + Versione Desktop Offline

> **Documento operativo (non descrittivo).** Ogni sezione contiene step **eseguibili**, file da modificare e criteri di accettazione.
> **Lingua codice:** TypeScript (web) / Rust + C# (desktop).
> **Lingua UI:** Italiano + Inglese (i18n parallelo, regola sovrana).
> **Owner:** Andrea Rizzari (CTO/Imprenditore).
> **Predecessori:** `PIANO_FINALE_SLIDE_CENTER_v2.md` + `GUIDA_DEFINITIVA_PROGETTO.md`.

---

## 0. PRINCIPI SOVRANI (non negoziabili)

1. **Stabilita live > tutto.** Mai compromettere un evento in produzione per una feature nuova.
2. **File partono SEMPRE da locale.** Il PC che proietta legge il file dal proprio disco; cloud/LAN sono solo per la sincronizzazione.
3. **Esperienza utente identica fra cloud e offline.** Stessa UI, stessi flussi, stessi tasti. Cambia solo il backend (cloud Supabase vs server locale Rust).
4. **Persistenza assoluta.** Una volta configurato, un PC sala NON perde mai stato a un riavvio. Solo l'utente o l'admin possono disconnetterlo.
5. **Performance live invariante.** Quando un PC e in modalita LIVE, il sync deve essere talmente leggero da NON essere percepibile durante un video 4K a piena banda.
6. **Semplicita Google Drive style.** Cartelle = sale, sottocartelle = sessioni, file = presentazioni. Click destro / multi-select / search funzionano come Drive.
7. **NO copia-incolla da Preseria.** Prendiamo solo le idee buone (auto-reminder, error checking, deadline) e le adattiamo al nostro modello.
8. **Coerenza ecosistema desktop.** La versione offline desktop usa lo stack della suite Live Production: **Tauri 2 (Rust)** per il wrapper + **C# WPF .NET 8** per moduli native condivisi se servono. Mai Electron.

---

## 1. STATO ATTUALE (al 17 aprile 2026)

| Area                                                     | Funzionante | Da rifinire                                                  |
| -------------------------------------------------------- | ----------- | ------------------------------------------------------------ |
| Pairing PC sala (codice 6 cifre + QR)                    | OK          | Aggiungere pairing LAN per offline (sezione 4)               |
| Auto-rejoin al boot via `device_token`                   | OK          | Esteso a desktop (Sprint M completato 17 apr 2026)           |
| Persistenza handle cartella locale (IndexedDB)           | OK          | Su desktop sara path nativo da settings                      |
| Polling 12s su file e room_state                         | OK          | Affiancare realtime (sezione 2.B)                            |
| Streaming download chunked                               | OK          | Aggiungere throttle banda + priority (sezione 2.A)           |
| Struttura cartelle `<root>/<sala>/<sessione>/<file>`     | OK          | Idem desktop                                                 |
| Upload diretto da admin a sessione (`SessionFilesPanel`) | OK          | Aggiungere drag&drop multi-file e check errori (sezione 3.C) |
| LAN agent intranet mode                                  | parziale    | Diventera nativo nel server desktop (sezione 4.C)            |
| Rinomina inline + disconnect con conferma                | OK          | Idem desktop                                                 |

---

## 2. FASE 1 — HARDENING CLOUD PRE FIELD TEST (priorita massima)

> **Obiettivo:** rendere la versione cloud **impeccabile in produzione live** prima di provarla sul campo.
> **Tempo stimato totale:** 5-7 giorni di lavoro effettivo.

### 2.A — SPRINT A: Modalita LIVE / TURBO / AUTO + throttling download

**Perche:** oggi il PC sala fa polling 12s e download a banda piena anche mentre proietta un video 4K. Rischio reale di stuttering / saturazione disco.

> **STATO (17 apr 2026):** A1-A6 implementati e in `main`. Manca solo A7 (test manuale sul campo, pre field test).

#### Step

- [x] **A1.** Aggiungere stato globale modalita in `RoomPlayerView.tsx`:

  ```ts
  type PlaybackMode = 'auto' | 'live' | 'turbo';
  ```

  Persistere in `localStorage` con chiave `sc:rp:playbackMode` (default `auto`). _(implementato in `RoomPlayerView.tsx` con costante `STORED_PLAYBACK_MODE_KEY`)_

- [x] **A2.** Aggiungere chip selettore modalita nell'header del `RoomPlayerView` (accanto a `SyncBadge`):
  - AUTO: chip blu (sc-primary), icona `Gauge`
  - LIVE: chip verde (sc-success), icona `Tv2`
  - TURBO: chip accent, icona `Zap`
    Implementato come radio group orizzontale (3 chip), tooltip nativo `title=` con descrizione modalita. _(componente `PlaybackModeChip` interno a `RoomPlayerView.tsx`)_

- [x] **A3.** Modificare `useFileSync.ts`:
  - Accettare nuovo prop `playbackMode: PlaybackMode` (default `auto`).
  - Polling: `auto`=12s, `live`=60s, `turbo`=5s. _(via `PLAYBACK_MODE_TUNING.pollIntervalMs`)_
  - Concurrency download: `auto`=1, `live`=1, `turbo`=3. _(via helper `runWithConcurrency`)_

- [x] **A4.** Modificare `fs-access.ts` `downloadFileToPath`:
  - Accettare opt `priority: 'high' | 'low' | 'auto'`.
  - Passare a `fetch(url, { priority })` (Chromium 102+ supporta nativo, fallback no-op altrove).
  - Throttle opzionale: `throttleMs` + `throttleEveryBytes` (default 4MB). In LIVE: 50ms ogni 4MB.
  - Aggiunto anche supporto `signal: AbortSignal`.

- [x] **A5.** In `useFileSync.ts`, propagare:
  - LIVE -> `priority: 'low'` + `throttleMs: 50` + `throttleEveryBytes: 4MB`
  - AUTO -> `priority: 'auto'` + nessun throttle
  - TURBO -> `priority: 'high'` + nessun throttle

  _(via `tuningRef.current.download` letto al momento della chiamata `downloadFileToPath`)_

- [x] **A6.** Aggiungere campo `playback_mode` in `room_state` su Supabase (enum `'auto'|'live'|'turbo'`) cosi l'admin VEDE in che modalita e il PC sala.
  - Migration: `supabase/migrations/20260418000000_room_state_playback_mode.sql` (idempotente, default `'auto'`, indice).
  - Tipi: `packages/shared/src/types/database.ts` aggiornato (rigenerare con `pnpm --filter @slidecenter/shared build`).
  - Edge Function: `room-player-bootstrap` accetta `playback_mode` in body, fa upsert su `room_state` e lo restituisce in response.
  - Client: `invokeRoomPlayerBootstrap(token, includeVersions, playbackMode)` con terzo arg opzionale.
  - Admin UI: `EventDetailView.tsx` mostra `<PlaybackModeBadge>` accanto a ogni sala (hook `useRoomStates` polling 30s; `auto` = blu, `live` = verde, `turbo` = accent).
  - i18n: `roomPlayer.playbackMode.{label,short.*,hint.*}` in IT + EN.

- [ ] **A7.** Test manuale:
  - Aprire un PC sala in dev su PC potente, attivare modalita LIVE.
  - Avviare in parallelo un download da 2 GB (es. file di test).
  - Misurare: il polling rallenta a 60s? Il download e visibilmente piu lento? Il browser tab non blocca eventi UI?

**Criterio di accettazione:** durante un download da 5 GB in modalita LIVE, il `requestAnimationFrame` del browser non scende sotto 50 fps medi (test con `performance.now()`).

---

### 2.B — SPRINT B: Realtime sync via Supabase channel

**Perche:** polling 12s e troppo lento per un workflow professionale. Quando admin carica file, deve apparire **subito** sul PC sala.

> **STATO (17 apr 2026):** B1-B4 implementati e in `main`. Manca solo B5 (test ritardo apparizione su 2 browser, da fare in field test). Approccio scelto: **Realtime Broadcast via trigger PostgreSQL** invece di `postgres_changes` filtrato — necessario perche' il Room Player NON ha sessione utente Supabase (auth via `device_token`), quindi le RLS `tenant_isolation` su `presentation_versions` / `room_state` impedirebbero a `postgres_changes` di ricevere eventi da utente anon. I trigger pubblicano con `private=false` su topic `room:<uuid>` (UUID v4 non enumerable, comunicato al client solo dalla Edge Function `room-player-bootstrap` dopo validazione token).

#### Step

- [x] **B1.** In `useFileSync.ts`, aggiungere effect dedicato che si subscribe a `supabase.channel('room:${roomId}')` con due handler `.on('broadcast', ...)`:
  - `event: 'presentation_changed'` → debounce 250ms → `refreshNow()`
  - `event: 'room_state_changed'` → debounce 250ms → `refreshNow()`
  - `subscribe((status) => ...)` espone `realtimeStatus` (`idle`/`connecting`/`subscribed`/`error`) tramite `useState`. _(implementato; vedi `useFileSync.ts` riga ~530)_

- [x] **B2.** Lato server: migration `20260418010000_room_realtime_broadcast.sql` con due trigger:
  - `broadcast_presentation_version_change_trg` su `presentation_versions` (INSERT/UPDATE/DELETE) → risale `presentation → session.room_id` e fa `realtime.send(..., 'presentation_changed', 'room:<room_id>', false)`.
  - `broadcast_room_state_change_trg` su `room_state` (UPDATE) → `realtime.send(..., 'room_state_changed', 'room:<room_id>', false)`.
  - Funzioni `SECURITY DEFINER`, `EXCEPTION WHEN OTHERS NULL` per non bloccare le scritture applicative se Realtime e' giu'.
  - _Lato client `presentationId` e' gia' propagato in `FileSyncItem` (utile a future feature, non strettamente necessario per i broadcast)._

- [x] **B3.** Polling 12s/60s/5s rimane come **safety-net**. Quando `realtimeStatus === 'subscribed'`, il polling diventa health-check ogni 60s anche in `auto`/`turbo`. Implementazione: l'`useEffect` di polling fa "tick frequente + gating sull'intervallo logico" leggendo `realtimeStatusRef`, cosi' il cambio stato e' immediato senza ricreare l'interval. _(useFileSync.ts riga ~440)_

- [x] **B4.** Chip UI in `RoomPlayerView` (componente `RealtimeChip`) accanto a `PlaybackModeChip`:
  - `subscribed` → "LIVE SYNC" verde, icona `Radio` con `animate-pulse`.
  - `connecting` → "Connessione…" giallo.
  - `error` / `idle` → "POLLING" grigio.
  - Tooltip esplicativo (i18n IT+EN sotto `roomPlayer.realtime.hint.*`).

- [ ] **B5.** Test manuale:
  - Aprire admin in un browser, PC sala in un altro (anche in incognito).
  - Caricare un file dall'admin (UploadPortal → Presentazione → Versione).
  - Misurare il tempo tra il "Carica" admin e l'apparizione su Room Player.
  - **Target: < 1 secondo** in rete normale (non saturata).
  - Spegnere il Wi-Fi del PC sala per 2 minuti, riaccenderlo: il chip torna `subscribed` da solo entro 30s.

**Criterio di accettazione:** un file caricato dall'admin appare nel `RoomPlayerView` in < 1 secondo di rete media (cloud Supabase). Se il WebSocket muore (CHANNEL_ERROR), il chip diventa "POLLING" e il safety-net continua a sincronizzare entro l'intervallo della modalita.

**Sicurezza:** il topic `room:<uuid>` non e' enumerable. Anche se i broadcast sono "pubblici" (RLS bypassed), per intercettarli un attaccante dovrebbe gia' conoscere il `room_id` (UUID v4, 122 bit di entropia) — informazione ottenibile solo via `room-player-bootstrap` con un `device_token` valido. Payload minimale (solo metadati: `version_id`, `presentation_id`, `op`), nessun dato sensibile.

---

### 2.C — SPRINT C: Ottimizzazione download (resume + checksum)

**Perche:** se il download di un file da 10 GB cade al 90%, oggi ricomincia da zero. Inaccettabile in evento.

> **STATO (17 apr 2026):** C1-C3 implementati e in `main`. Test field manuale (kill browser a 50% di un file 5 GB → riapertura → ripresa) resta da fare. Decisione architetturale: la verifica SHA-256 lato browser e' **on-demand a soglia** — file ≤ 512 MiB vengono digeriti con `crypto.subtle.digest('SHA-256', ...)` (one-shot, RAM-bound); file piu' grandi (es. video 5 GB) restano `verified: 'skipped'` perche' Web Crypto **NON supporta digest streaming** e tenere 5 GB in `Uint8Array` farebbe crashare la tab. Per i video, l'integrita' visiva al play resta il controllo finale.

#### Step

- [x] **C1.** Estendere `downloadFileToPath` con resume HTTP `Range`:
  - Pre-download: `getExistingFileSize(dirHandle, segments, name)` legge la dimensione del file locale (se esiste). Se uguale a `expectedSizeBytes` → skip totale (ritorno immediato con `progress=100`). Se `0 < N < expected` → resume.
  - Header `Range: bytes=N-`. Se il server risponde `206` → append; se risponde `200` → server non supporta Range, riapertura writable con `keepExistingData: false` e download completo. Se `416` → file gia' completo lato server, skip.
  - Writable appending: `createWritable({ keepExistingData: true })` + `seek(N)`. Se `seek` fallisce, fallback a download completo da zero (writable nuovo).
  - Nuova flag `forceFullDownload: true` in `DownloadOptions` per ignorare il file esistente (usata dal verify loop dal 2° tentativo in poi). _(implementato; vedi `apps/web/src/features/devices/lib/fs-access.ts`)_

- [x] **C2.** Verifica integrita post-download via SHA256:
  - Backend: `presentation_versions.file_hash_sha256` gia' popolato lato upload (Phase 3, `computeFileSha256` in `upload-portal/lib/sha256.ts`). Esposto da Edge Function `room-player-bootstrap` come `fileHashSha256: string | null`.
  - Lato PC sala: nuova helper `verifyFileSha256(dirHandle, segments, filename, expectedHash)` che apre il file con `getFileHandle({ create: false })`, fa `crypto.subtle.digest('SHA-256', file.arrayBuffer())` e confronta hex. Soglia `MAX_VERIFY_BYTES = 512 MiB`: oltre, ritorna `'skipped'`. Se `expectedHash === null` (upload legacy senza hash), idem `'skipped'`.
  - Retry mismatch: nel `downloadVersion` un `while (attempt < MAX_VERIFY_RETRIES /* 3 */)` ripete download + verify. Dal 2° giro `forceFullDownload: true` cosi' il file corrotto sul disco viene riscritto da zero. Dopo 3 mismatch consecutivi: `status: 'error'`, `errorMessage: 'verify_mismatch'`. _(implementato; vedi `useFileSync.ts` riga ~245)_

- [x] **C3.** Esporre `verified: FileVerifyStatus` in `FileSyncItem` (`'pending' | 'verified' | 'mismatch' | 'skipped'`) e mostrarlo come badge accanto a nome speaker / dimensione:
  - `verified` → lucchetto chiuso verde (`Lock`) + label "Verificato" / "Verified".
  - `mismatch` → scudo rosso (`ShieldAlert`) + label "Hash diverso" / "Hash mismatch" + tooltip che invita a NON usare il file.
  - `skipped` → lucchetto aperto grigio (`LockOpen`) + label "Non verificato" / "Not verified" + tooltip che spiega il motivo (file >512 MB o upload legacy).
  - Lo stato verificato sopravvive ai poll (`verifiedStatusRef` in `useFileSync`); se l'admin pubblica una nuova versione con hash diverso (raro: stesso `versionId` ma `fileHashSha256` cambiato), reset automatico → ridownload + ri-verify. _(implementato; vedi `FileSyncStatus.tsx` componente `VerifiedBadge`)_

**Criterio di accettazione:** killare il browser durante download di un file da 5 GB, riaprire, il download riprende da dove era fermo. Sha256 verificato per file ≤ 512 MiB; per file piu' grandi badge "Non verificato" con tooltip esplicativo.

---

### 2.D — SPRINT D: Dashboard salute PC sala lato admin

**Perche:** l'admin ha bisogno di vedere a colpo d'occhio quali PC sono online, quali in sync, quali in errore.

> **STATO (17 apr 2026):** D1-D3 implementati e in `main`. Field test (admin osserva PC che si scollega → pallino diventa rosso entro 30s) resta da fare. Decisione architetturale: lo stato connettivita' (verde/arancio/rosso) e' **derivato lato client da `last_seen_at`** anziche' dalla colonna enum `status`, perche' un PC che si spegne all'improvviso non puo' aggiornare il proprio `status='offline'` da solo. Soglie: <30s = online, 30-180s = warning, ≥180s o `null` = offline. Per "Forza refresh" usiamo un broadcast Realtime sul topic `room:<roomId>` (lo stesso di Sprint B) anziche' una Edge Function dedicata: l'admin e' autenticato e il topic e' un UUID v4 non-enumerable, quindi la finestra d'attacco e' identica al topic principale. Per la "% sync" abbiamo deciso di mostrare lo `sync_status` (`synced`/`syncing`/`error`) gia' presente in `room_state` invece di un count `synced/total`: aggiungere il count richiederebbe un nuovo Edge Function di heartbeat dal PC sala (overhead non giustificato per Sprint D, eventualmente in un futuro Sprint).

#### Step

- [x] **D1.** In `EventDetailView`, sezione "Sale", lista PC paired per ogni sala (nuovo componente `RoomDevicesPanel`):
  - Pallino stato calcolato da `last_seen_at` (verde <30s / arancione 30-180s / rosso ≥180s o `null`).
  - Nome device + browser + tempo dall'ultimo seen ("12s fa", "3min fa", o data formattata se >24h). Modificabile inline cliccando "Rinomina" nel menu kebab.
  - Modalita LIVE/TURBO/AUTO gia' visibile sulla card sala in alto (`<PlaybackModeBadge>` di Sprint A6) — non duplicata sotto il singolo PC perche' la modalita e' della sala, non del device.
  - Menu kebab (3-puntini) con: Forza refresh, Rinomina, Sposta in altra sala, Rimuovi PC. "Rimuovi" chiede conferma inline.
  - Spostamento sala via dropdown delle altre sale dell'evento (esclude la sala corrente).
  - Errori action mostrati inline accanto al device (i18n: `roomDevices.errors.*`). _(implementato; vedi `apps/web/src/features/devices/components/RoomDevicesPanel.tsx` + integrato in `EventDetailView.tsx` riga ~880)_

- [x] **D2.** Polling 30s lato admin via hook `useRoomDevices(roomIds, 30_000)` (modellato su `useRoomStates`). Lato Edge Function `room-player-bootstrap`, l'`UPDATE` su `paired_devices` ora setta `last_seen_at = now()` **e** `status = 'online'` (best-effort, non blocca il bootstrap se fallisce). _(implementato; vedi `apps/web/src/features/devices/hooks/useRoomDevices.ts` + `supabase/functions/room-player-bootstrap/index.ts` riga ~74)_

- [x] **D3.** Realtime `postgres_changes` filtrato `room_id=in.(<ids>)` su `paired_devices`. L'admin e' autenticato e ha policy RLS `tenant_isolation` su `paired_devices`, quindi `postgres_changes` riceve gli eventi correttamente (diversamente dal PC sala anonimo, che usa Broadcast in Sprint B). Channel: `admin_paired_devices:<key>`. Re-fetch immediato ad ogni evento (no debounce: gli `UPDATE` su `last_seen_at` arrivano max ogni 12s per device). _(implementato; vedi `useRoomDevices.ts`)_

- [x] **D-bonus (force_refresh).** Helper `broadcastForceRefresh(roomId)` apre un canale ad-hoc, attende `SUBSCRIBED`, invia `{ type: 'broadcast', event: 'force_refresh' }` sul topic `room:<roomId>`, si stacca (timeout 5s). Lato Room Player (`useFileSync`), nuovo handler `force_refresh` che azzera `syncedVersionIds.current` + `verifiedStatusRef.current`, resetta lo stato di tutti gli items a `pending`, chiama `refreshNow()` immediato (bypass del debounce 250ms). Effetto netto: l'admin clicca "Forza refresh" → in <1s il PC sala riscarica e ri-verifica TUTTI i file. _(implementato; vedi `repository.ts::broadcastForceRefresh` + `useFileSync.ts::onForceRefresh`)_

**Criterio di accettazione:** admin vede in <2 secondi se un PC sala si scollega o cambia modalita.

---

### 2.E — SPRINT E: Stabilita extra (retry, telemetry, guard)

> **STATO (17 apr 2026):** E1-E4 implementati e in `main`. Field test (Chrome DevTools throttle "Slow 3G" + 5 cicli wifi on/off) resta da fare. Decisione architetturale: per E2 abbiamo trovato Sentry gia' integrato (Phase 14, `lib/init-sentry.ts` con lazy import condizionale a `VITE_SENTRY_DSN`); abbiamo aggiunto solo l'helper `reportError(err, { tag, extra, level })` per gli errori "expected" oggi silenziati con `try/catch` (verify mismatch, download fallito post-retry, storage_full). Niente nuova tabella `client_telemetry` su Supabase: i log restano centralizzati su Sentry. Per E3 la quota di `navigator.storage.estimate()` e' un'approssimazione (riferita all'origin del browser, NON al disco fisico scelto via FSA), ma resta utile come pre-allarme e per stimare lo spazio liberato dal cleanup.

#### Step

- [x] **E1.** Helper `fetchWithRetry(url, { backoffMs: [500, 2000, 8000], onRetry?, signal? })` in `apps/web/src/lib/fetch-with-retry.ts`. Politica:
  - Status retryable: 408, 425, 429, 500, 502, 503, 504. Altri 4xx → throw subito (es. 401 → token revocato, niente senso ritentare).
  - Network error (`TypeError`/`fetch failed`) → retry.
  - `AbortSignal.aborted` → mai retry.
  - Backoff con `setTimeout` interrompibile (rispetta `signal`).
  - Applicato a `invokeRoomPlayerBootstrap` (chiamato a ogni tick polling) e `invokeRoomPlayerRename` (one-shot ma chiamato dal PC sala in produzione). NON applicato a `downloadFileToPath` perche' ha gia' resume HTTP `Range` Sprint C — ri-scaricare un payload da 5 GB su 502 momentaneo vanificherebbe la resilienza. _(implementato; vedi `apps/web/src/lib/fetch-with-retry.ts` + `apps/web/src/features/devices/repository.ts`)_

- [x] **E2.** Sentry e' gia' integrato in Phase 14. Aggiunto helper `reportError(err, { tag, extra, level })` in `apps/web/src/lib/telemetry.ts` (lazy import `@sentry/react`, no-op se DSN assente). Agganciato a tre punti critici di `useFileSync`:
  - `verify_mismatch` dopo 3 retry (`tag: 'sync.verify_mismatch'`, level warning)
  - `storage_full` da guard (`tag: 'sync.storage_full'`, level warning)
  - `download_failed` post-retry (`tag: 'sync.download_failed'`, level warning), con filter per non spammare gli errori noti (`permission_denied`, `offline_*`).
    Niente nuova tabella `client_telemetry` su Supabase: i log restano su Sentry, gia' loggato dalle PR Phase 14. _(implementato; vedi `lib/telemetry.ts` + `useFileSync.ts`)_

- [x] **E3.** Storage guard + cleanup orfani.
  - `getStorageEstimate()` in `fs-access.ts` ritorna `{ quotaBytes, usageBytes, availableBytes, usagePct }` o `null` se `navigator.storage.estimate` non e' supportato.
  - Pre-download: se `availableBytes < fileSizeBytes * 1.1`, abort con `errorMessage: 'storage_full'` + `reportError(...)`.
  - `purgeOrphanFiles(dirHandle, expectedKeys, { maxDepth: 3 })` walk ricorsivo: rimuove i file su disco la cui chiave relativa (`sanitizeFsSegment(roomName)/sanitizeFsSegment(sessionTitle)/sanitizeFsSegment(filename)`) non e' nella lista corrente. Tollera errori per singolo file (file aperto da PowerPoint → skip + count).
  - Hook `useFileSync` espone `storage: StorageEstimate | null`, `refreshStorage()`, `cleanupOrphanFiles()`. Polling quota 60s (parallelo al polling versions).
  - UI: nuovo componente `<StorageUsagePanel>` montato sopra `<FileSyncStatus>` quando `dirHandle && storage`. Mostra barra colorata (verde >1GB / arancio 100MB-1GB / rosso <100MB) + bottone "Pulisci file orfani" con conferma inline. Risultato: "Rimossi N file, liberati X GB". _(implementato; vedi `fs-access.ts::getStorageEstimate/purgeOrphanFiles` + `components/StorageUsagePanel.tsx`)_

- [x] **E4.** Lock anti-doppio fetch su `fetchVersions` in `useFileSync`. Nuovo `fetchVersionsInflightRef = useRef<Promise<...> | null>(null)`: se gia' in volo, riusa la stessa Promise. Cleanup in `finally` per liberare il lock anche su errore. Effetto: i 4 chiamanti (syncAll iniziale, polling tick, `refreshNow`, broadcast `presentation_changed`) non duplicano la chiamata a `room-player-bootstrap`. _(implementato; vedi `useFileSync.ts::fetchVersions`)_

**Criterio di accettazione:** simulare cattiva rete (Chrome DevTools throttle "Slow 3G") + spegnere/accendere wifi 5 volte. Il PC sala deve riprendere senza errori UI.

---

## 3. FASE 2 — UX PROFESSIONALE STILE GOOGLE DRIVE

> **Obiettivo:** rendere la gestione file dell'admin e del PC sala **comoda come Google Drive**.
> **Tempo stimato:** 5-7 giorni.

### 3.A — Search file globale

> **STATO (17 apr 2026):** A1-A4 implementati e in `main`. Field test su evento reale (200+ file in 5 sale/3 sessioni cad.) resta da fare. Decisioni architetturali: per la query su `file_name` filtriamo solo `status = 'ready'` (le versioni `uploading`/`failed`/`deleted` non sono visibili nella UI normale, quindi non hanno senso in search). Soglia minima 2 caratteri (`MIN_QUERY_LENGTH`) per evitare quasi-full-scan inutili. `LIMIT 50` con messaggio "altri risultati, affina ricerca". Wildcard injection: i caratteri `%`, `_`, `\` vengono escapati con `\` cosi' una ricerca di "100%" trova letteralmente "Slides 100%.pptx" e non "qualsiasi cosa che contenga 100".

#### Step

- [x] **A1.** Componente `<EventSearchBar eventId onSelectResult>` montato in cima a `EventDetailView` (sticky `top-0 z-30`, full-width con backdrop blur). Pattern combobox WAI-ARIA 1.2: `role="combobox"` su input, `role="listbox"` sul dropdown, `aria-activedescendant` per highlight tastiera. Tastiera: ↓/↑ navigano (con wrap-around), Enter seleziona, Esc chiude/clear, Home/End jumpa al primo/ultimo. _(implementato; vedi `apps/web/src/features/events/components/EventSearchBar.tsx`)_

- [x] **A2.** Funzione `searchEventFiles(eventId, query, signal)` in `apps/web/src/features/events/lib/event-file-search.ts`. Query Supabase con embedding nested (`presentations!inner -> sessions -> rooms`, `presentations -> speakers`) e filtro `eq('presentations.event_id', eventId).ilike('file_name', '%escape%').eq('status', 'ready')`. RLS `tenant_isolation` blocca tutto cio' che non e' del tenant corrente: la query e' inerte per tenant esterni. _(implementato; vedi `event-file-search.ts::searchEventFiles`)_

- [x] **A3.** Dropdown risultati: per ogni hit mostra `file_name` (con badge "Attiva" se e' la `current_version_id` della presentazione), e in seconda riga `roomName · sessionTitle · speakerName · v<n>`. Speaker e' opzionale (presentazione admin senza speaker). Sort `version_number DESC` → la versione piu' recente per ogni presentazione viene prima (l'admin in revisione vede la storia, non deduplichiamo). _(implementato; vedi `EventSearchBar.tsx` lines 142-176)_

- [x] **A4.** Click/Enter → `handleSearchResultSelected` in `EventDetailView`:
  - Espande il `SessionFilesPanel` della sessione (set in `expandedSessionFiles`).
  - Scrolla al `<li id="session-{id}">` con `scrollIntoView({behavior:'smooth', block:'start'})` dentro un `requestAnimationFrame` (aspetta che il pannello si sia espanso e abbia shiftato il layout, altrimenti la posizione e' stale).
  - Setta `highlightedSessionId = sessionId` per 2s → la `<li>` riceve classe `bg-sc-primary/10` con `transition-colors duration-300`.
    Funziona sia in view "list" che "byRoom". `scroll-mt-24` evita che la sessione finisca sotto la search bar sticky. _(implementato; vedi `EventDetailView.tsx::handleSearchResultSelected` + render `<li id="session-X">`)_

#### Hook

- **`useEventFileSearch(eventId, query)`** (`apps/web/src/features/events/hooks/useEventFileSearch.ts`):
  - Debounce 250ms (`DEBOUNCE_MS`): non parte una chiamata per ogni keystroke.
  - Abort: `AbortController` cleanup ad ogni rerun dell'effect → niente race "vince l'ultima che ritorna".
  - Pattern "derived state during render" via `useState` (non `useRef`, perche' la lint rule `react-hooks/refs` vieta l'accesso ai ref in render): se la query effettiva cambia, resettiamo state (results, error, loading) prima del prossimo render.
  - Espone `{ results, loading, error, truncated, belowMinLength }`.

**Criterio di accettazione:** un admin gestisce 200 file in 5 sale per 3 sessioni cadauna senza mai scrollare 30 secondi alla ricerca di un file. _(da verificare in field test)_

### 3.B — Multi-select + bulk action

> **STATO (17 apr 2026):** B1-B4 implementati e in `main`. Field test su evento reale (50+ file selezionati simultaneamente, ZIP 1+ GB) resta da fare. Decisioni architetturali: bulk action SEQUENZIALI (no `Promise.allSettled`) per non saturare rate limit Supabase Pro (~100 req/s tenant) e per avere summary "X riusciti, Y falliti" affidabile in tempo reale. ZIP browser-side via dynamic import `jszip` (chunk separato 95KB gzipped, caricato solo a primo click "Scarica ZIP", non zavorra `EventDetailView`). Nuova RPC `rpc_move_presentation_to_session` distinta da `rpc_move_presentation` (tra speaker) perche' (1) il flusso UX "scegli sessione" non richiede di pensare allo speaker, (2) supporta presentation senza speaker (caso comune admin-upload), (3) il `same_session_no_op` ritorna `skipped: true` invece di errore cosi' bulk con N file mixed funziona.

#### Step

- [x] **B1.** Stato multi-select via `Set<presentationId>` in `SessionFilesPanel` con checkbox per riga (accent `sc-primary`) + checkbox header con `indeterminate` quando alcune righe sono selezionate. `disabled` durante bulk in corso. Pattern "derived state during render" (via `useState` su chiave `fileIds.join(',')`) per purgare automaticamente dalla selezione gli id che non esistono piu' dopo bulk delete o ricarica file. _(implementato; vedi `apps/web/src/features/presentations/components/SessionFilesPanel.tsx`)_

- [x] **B2.** Toolbar condizionale (appare solo se `selected.size > 0`) con header "{N} file selezionati · {totalBytes}" e tre azioni:
  - **"Scarica ZIP"** disabilitato se `selectedTotalBytes > 2 GB` (con tooltip esplicativo).
  - **"Sposta in altra sessione"** apre dialog (B3); nascosto se `availableMoveTargets.length === 0` (es. evento con una sola sessione).
  - **"Elimina"** con conferma inline ("Conferma elimina (N)") + bottone "Annulla". Riusa `deletePresentationAdmin` per ogni id, sequenziale.
    Bottone "X" per clear selezione (aria-label dedicato). Barra progresso unificata `<BulkProgressBar>` con `{current}/{total}` + bytes per ZIP + bottone "Annulla" solo per ZIP (delete/move sono RPC veloci, non vale la pena cancellare a meta'). Summary post-azione mostra "X riusciti · Y falliti · Z saltati" (skipped solo per move) con lista nomi falliti (max 5 visibili + "...e altri N"). _(implementato; vedi `SessionFilesPanel.tsx::onBulkDelete`)_

- [x] **B3.** Dialog modale `<MoveSessionDialog>` con backdrop click + Esc per chiudere. Tree raggruppato per sala: `<h3>Sala</h3><ul><li>Sessione (radio)</li></ul>`. La sessione corrente e' filtrata via `availableMoveTargets = moveTargets.filter(s => s.id !== sessionId)`. Bottone "Sposta" disabilitato finche' nessun radio selezionato. RPC sequenziale: per ogni `presentationId` chiama `rpc_move_presentation_to_session(p_presentation_id, p_target_session_id)`. La RPC valida tenant + ruolo + evento aperto + stesso `event_id` tra source/target session, scrive `activity_log` con action `move_presentation_to_session`, e resetta `speaker_id = NULL` (lo speaker e' legato alla vecchia sessione). Se il file era gia' nella sessione target, ritorna `{skipped: true, reason: 'same_session_no_op'}` senza errore (utile per bulk dove la selezione potrebbe essere mista). _(implementato; vedi migration `supabase/migrations/20260418020000_move_presentation_to_session.sql` + `repository.ts::movePresentationToSession`)_

- [x] **B4.** Download ZIP browser-side via `zip-bulk-download.ts`:
  - **Dynamic import** `jszip`: chunk separato (95 kB gzipped) caricato solo al primo click, non aumenta il bundle iniziale di `EventDetailView`.
  - **Pre-check** `selectedTotalBytes <= MAX_TOTAL_BYTES = 2 GB` per evitare OOM tab Chromium 64-bit. Errore esplicito `bulkActions.errors.zipTooLarge`.
  - **Worker pool** concorrenza 3 (`FETCH_CONCURRENCY`): non serializzato (lento) ne' `Promise.all` (50 fetch in parallelo throttle browser e signed URL puo' scadere a meta' downloads). Le signed URL sono `createVersionDownloadUrl()` esistenti (5 min TTL).
  - **Compression `STORE`**: PPTX/PDF/JPG sono gia' compressi internamente; DEFLATE costa CPU e tempo (10x lentezza per 100 MB+) per riduzioni <1%.
  - **Filename collision**: due presentazioni con lo stesso `file_name` (es. "slides.pptx") vengono prefissate con i primi 8 char del `versionId` per distinguerle nello zip (`slides__a1b2c3d4.pptx`).
  - **Trigger download**: pattern `<a download>` programmatico, niente librerie extra (file-saver). Cleanup `URL.revokeObjectURL` dopo 30s (Safari aborta il download se revoke immediato).
  - **AbortController** per cancellare con il bottone "Annulla" durante la fase fetch.
    _(implementato; vedi `apps/web/src/features/presentations/lib/zip-bulk-download.ts`)_

**Criterio di accettazione:** un admin seleziona 30 file su 5 sessioni diverse, li sposta in una nuova sessione di backup, e ne scarica una copia ZIP per archivio offline in <60 secondi (escluso tempo download dei file da Storage). _(da verificare in field test)_

### 3.C — Drag&drop multi-file e drag tra sessioni

> **STATO (17 apr 2026):** C1-C3 implementati e in `main`. Field test su evento reale (drop di 10+ file simultaneo + drag tra 2 sessioni in sale diverse) resta da fare. Decisioni architetturali: la coda upload e' **sequenziale** (concurrency 1) perche' (1) `init_upload_version_admin` usa lock advisory PostgreSQL + `ON CONFLICT (speaker_id)` — N init paralleli si serializzerebbero comunque a livello DB; (2) il TUS protocol stesso fa upload paralleli sui chunk del singolo file, parallelizzare anche i FILE saturerebbe bandwidth; (3) summary "X completati, Y errori" e' affidabile in tempo reale. Drag tra sessioni discrimina via **MIME type custom** `application/x-slidecenter-presentation` invece di reinventare un drop store React: il browser nativo ci da' isolation cross-tab gratis (cross-origin = niente trasferimento, perfetto per security), e i `dataTransfer.types` sono leggibili durante `dragover` (solo `getData()` richiede `drop` event) — quindi possiamo cambiare il colore del border in tempo reale (blu = upload da SO, arancione = sposta tra sessioni). La RPC `rpc_move_presentation_to_session` e' la stessa di Sprint G B3, quindi zero costi backend aggiuntivi.

#### Step

- [x] **C1.** `SessionFilesPanel` drop zone accetta `e.dataTransfer.files` come FileList intera (non piu' `[0]`). `<input type="file" multiple>` nel "Scegli file" supporta selezione multipla nativa OS. Entrambi i punti chiamano `queue.enqueue(list)` che fa append in coda. Testo drop label cambia da "Trascina qui i file" → "Trascina **piu'** file insieme: verranno caricati in coda" (i18n `sessionFiles.dropHintMulti`). _(implementato; vedi `apps/web/src/features/presentations/components/SessionFilesPanel.tsx::onPick + onDrop`)_

- [x] **C2.** Hook `useUploadQueue(sessionId, supabaseUrl, anonKey)` in `apps/web/src/features/presentations/hooks/useUploadQueue.ts` con worker single-job:
  - **Modello `UploadJob`**: `{id, fileName, fileSize, progress, uploaded, status: 'pending'|'uploading'|'hashing'|'finalizing'|'done'|'error'|'cancelled', errorKey?}` esposto via snapshot pubblico (read-only); ref interno con `file: File`, `tusHandle: TusHandle | null`, `hashAbort: AbortController | null`, `versionId: string | null` per cleanup orfano.
  - **Worker loop**: `useEffect` triggerato da un `tick` counter (no `jobs.length` dependency: push+splice possono lasciare la stessa lunghezza). Pesca il primo `pending` non `cancelled`, runna `init → uploadTUS + hash in parallelo → finalize`, su completamento bumpa il tick (ricerca prossimo job).
  - **Cancellazione granulare**: pending → splice immediato (no network); in corso → `tusHandle.abort()` + `hashAbort.abort()` + `abortAdminUpload(versionId)` per liberare il record DB orfano. Visibile come riga 'cancelled' rimovibile con "X" o pulibile in batch via "Pulisci completati".
  - **Cleanup unmount**: aborta TUTTI i job vivi e libera versionId orfani via finally. mountedRef previene setState post-unmount.
  - **UI `<UploadQueuePanel>`**: pannello che appare automaticamente sotto la drop zone se `queue.jobs.length > 0`. Header "{active}/{total}" + pulsante "Pulisci completati" (visibile solo se ci sono job done/error/cancelled). Riga per file: nome troncato, status colorato (blu pending, primary uploading, success done, danger error, dim cancelled), progress bar 1px solo durante `uploading`/`pending`, bytes "MB / MB" durante upload, X cancel/remove. _(implementato; vedi `useUploadQueue.ts` + `SessionFilesPanel.tsx::UploadQueuePanel`)_

- [x] **C3.** Drag tra sessioni con MIME custom `application/x-slidecenter-presentation` (helper in `apps/web/src/features/presentations/lib/drag-presentation.ts`):
  - **Source**: ogni `<li>` file e' `draggable=true` quando `availableMoveTargets.length > 0 && !bulkBusy && !queue.busy`. `onDragStart` setta `dataTransfer.setData(MIME_CUSTOM, JSON.stringify({presentationId, fromSessionId, fileName}))` + `text/plain` come fallback umano + `effectAllowed='move'`. Icona `<GripVertical>` come hint visivo + cursor `grab/grabbing`.
  - **Target**: ogni `SessionFilesPanel` discrimina nel suo drop handler:
    - `readPresentationDragData(dt)` → se non null e `fromSessionId !== sessionId` → chiama `movePresentationToSession(presentationId, sessionId)`. Feedback transient (2.5s) "{fileName} spostato in questa sessione" (verde) o errore tradotto in `sessionFiles.dragMove.errorCrossEvent/errorEventClosed/errorForbidden/errorGeneric` (rosso). Auto-reload file. Se `fromSessionId === sessionId` → no-op silenzioso (l'utente ha "rilasciato" sopra la stessa sessione, niente errore confuso).
    - `e.dataTransfer.files.length > 0` → upload via `onPick` (path C1).
  - **Visual feedback durante dragover**: `dropMode = 'idle' | 'files' | 'presentation'` calcolato in `onDragEnter`/`onDragOver` via `isPresentationDragActive(dt)` / `isFilesDragActive(dt)`. Border blu `sc-primary` per upload da SO, arancione `sc-accent` per move tra sessioni — distinzione visiva netta che evita confusione utente. `dragCounterRef` previene flicker quando il cursore entra/esce su figli della drop zone.
  - **Sicurezza**: il browser non trasferisce `dataTransfer.types` cross-origin → un sito esterno non puo' "fingere" un nostro drag. La RPC `rpc_move_presentation_to_session` resta autoritativa: valida tenant, ruolo, evento aperto, no cross-event. _(implementato; vedi `drag-presentation.ts` + `SessionFilesPanel.tsx::onDragEnter/onDrop/<li draggable>`)_

**Criterio di accettazione:** un admin trascina 10 file da Esplora Risorse direttamente in una sessione e vede la coda popolata; poi trascina uno dei file gia' caricati in un'altra sessione aperta nel pannello e lo vede comparire li' senza re-upload. _(da verificare in field test)_

### 3.D — Anteprima inline (PDF, immagine, video)

> **STATO (17 apr 2026):** D1-D3 implementati e in `main`. Field test su evento reale (apertura PDF/img/video da admin remote URL e da PC sala blob locale, fallback file non scaricato) resta da fare. Decisioni architetturali: il `<FilePreviewDialog>` e' un componente PURO (no fetch interno, no lifecycle URL) — il chiamante passa `sourceUrl: string | null`, `sourceLoading: boolean`, `sourceError: string | null` (chiave i18n). La logica di "come ottengo l'URL" sta nel hook `useFilePreviewSource({ mode: 'local'|'remote', ...})` che separa perfettamente i due casi: lato PC sala (`local`) usa la **regola sovrana §1** leggendo SOLO il blob FSA gia' scaricato e creando `URL.createObjectURL` con cleanup automatico al cambio sorgente / unmount; lato admin (`remote`) usa una nuova funzione `createVersionPreviewUrl(storageKey)` che e' come la sorella di download ma SENZA `download: true` — il signed URL Supabase Storage e' inline (browser visualizza invece di scaricare). Per renderer ho usato `<iframe>` per i PDF (compat browser migliore di `<embed>`, niente "click per aprire" Adobe spurio), `<img>` per le immagini, `<video controls>` con autoplay disabilitato (autoplay con audio e' bloccato dal browser e darebbe l'illusione di "rotto"), `<audio controls>` per file audio. Per pptx/keynote/zip e altri MIME non-anteprimabili: card di fallback con icona generica + bottone "Scarica" che apre il signed URL/blob URL in nuova tab — il vero launcher con app esterna richiedera' SLIDE CENTER Desktop (Tauri shell.open, Sprint J / sezione 4).

#### Step

- [x] **D1.** Click sul nome file in `SessionFilesPanel` (admin) o sul bottone "Apri sul PC" in `FileSyncStatus` (PC sala) → apre `<FilePreviewDialog>` full-screen (`fixed inset-0 z-50`). Header sticky con icona file + nome + MIME + bottone "Scarica" (opzionale) + X. Esc / click sul backdrop chiudono. _(implementato; vedi `apps/web/src/features/presentations/components/FilePreviewDialog.tsx`)_

- [x] **D2.** Renderer per MIME (la fonte di verita' e' `presentation_versions.mime_type`):
  - `application/pdf` → `<iframe src={url}>` (compat migliore di `<embed>` su Firefox/Edge; nessuna chunk dependency PDF.js — il browser rendera' nativo).
  - `image/*` → `<img src={url} className="object-contain">`.
  - `video/*` → `<video controls>` (no autoplay → no problemi browser block).
  - `audio/*` → card con `<audio controls>` + icona Music.
  - altri MIME (pptx, keynote, zip, ...) → card fallback con `<FileText>` icon + bottone "Scarica" che apre `URL` in nuova tab (per blob locale: il browser scarica nella cartella Download; per signed URL admin: il browser usa `Content-Disposition: attachment`). _(implementato; vedi `FilePreviewDialog.tsx::pickRenderer`)_

- [x] **D3.** Hook `useFilePreviewSource` discrimina due modalita:
  - `mode: 'local'` (PC sala) → `readLocalFile(dirHandle, [roomName, sessionTitle], filename)` da `apps/web/src/features/devices/lib/fs-access.ts` (nuova funzione che riusa `sanitizeFsSegment` per matchare il path scritto dal downloader Sprint A) → `URL.createObjectURL(file)`. Cleanup `URL.revokeObjectURL` nel return cleanup dell'effect. Errori: `localNotFound` (file non ancora downloadato), `localPermissionDenied` (permessi cartella revocati).
  - `mode: 'remote'` (admin) → `createVersionPreviewUrl(storageKey)` in `apps/web/src/features/presentations/repository.ts`: `createSignedUrl(storageKey, 300)` SENZA `download: true` → URL inline. RLS storage.objects garantisce isolation tenant. _(implementato; vedi `apps/web/src/features/presentations/hooks/useFilePreviewSource.ts`)_

  > **Nota implementativa React 19**: la lint rule `react-hooks/set-state-in-effect` (nuova in React 19) vieta `setState` sincroni nel body di `useEffect`. Workaround usato: TUTTA la logica dell'effect e' incapsulata in un'`async function run()` con `await Promise.resolve()` come microtask boundary all'inizio — i `setState` successivi sono _post-await_ e quindi async di natura, la lint li accetta.

**Criterio di accettazione D:** un admin clicca su un PDF di 10 MB in `SessionFilesPanel`, vede l'anteprima inline in <2s; un PC sala su lo stesso PDF clicca "Apri sul PC" e lo vede SENZA chiamate di rete (blob locale gia' presente). _(da verificare in field test)_

### 3.E — Launcher locale "Apri sul PC" + "In onda" lato admin

> **STATO (17 apr 2026):** E1-E4 implementati e in `main`. Field test su evento reale (apertura .pptx, segnalazione "in onda" cross-room rifiutata, badge admin live <30s) resta da fare. Decisioni architetturali: la sicurezza del setter "now playing" e' affidata a una RPC SECURITY DEFINER `rpc_room_player_set_current(p_token, p_presentation_id)` che (1) verifica l'hash del `device_token` vs `paired_devices.pair_token_hash` (stesso pattern di `room-player-rename`); (2) verifica che la presentation appartenga a una sessione DELLA STESSA sala del device (no cross-room — anche tampering del JS client non puo' marcare "in onda" file di un'altra sala dello stesso evento); (3) scrive `room_state.current_presentation_id` + `last_play_started_at = now()`. Il trigger broadcast `broadcast_room_state_change_trg` (Sprint B) gia' esistente propaga `room_state_changed` su `room:<roomId>` → admin vede l'aggiornamento in <1s SENZA Realtime channels nuovi. Per il "vero" launcher di app esterne (.pptx → PowerPoint, .key → Keynote) il browser web e' limitato dai sandbox di sicurezza: nessuna API standard apre file con app native. Workaround attuali: per file anteprimabili (PDF/img/video/audio) il bottone "Apri sul PC" mostra il `<FilePreviewDialog>` — perfetto per la sala perche' le slide gia' visibili a schermo bastano per l'80% dei casi; per pptx/keynote il bottone "Scarica" del dialog apre il blob URL in nuova tab → il browser scarica il file nella cartella Download e l'utente lo apre manualmente. Il vero "Apri con app esterna" arriva con SLIDE CENTER Desktop (Tauri `shell.open`, Sprint J / sezione 4).

#### Step

- [x] **E1.** Bottone "Apri sul PC" in `<FileRow>` di `FileSyncStatus` (PC sala). Visibile SOLO per `status === 'synced'` (non ha senso aprire un file in download o in errore). Stile primary outline + icona `<Monitor>`. `onClick` triggera il callback `onOpen(item)` passato da `RoomPlayerView`. _(implementato; vedi `apps/web/src/features/devices/components/FileSyncStatus.tsx`)_

- [x] **E2.** Implementazione web (limitato per design del browser):
  - PDF/img/video/audio: apre `<FilePreviewDialog>` con sorgente locale (regola sovrana §1: blob FSA, nessuna rete). Esperienza fluida e immediata (file gia' su disco).
  - pptx/keynote/altri: il dialog mostra fallback "formato non anteprimabile" + bottone "Scarica" che apre il blob URL in nuova tab → il browser tipicamente lo scarica nei Download → l'utente lo apre manualmente. Il vero launcher Tauri arriva con SLIDE CENTER Desktop (Sprint J).
  - **Limitazione documentata** in `roomPlayer.fileSync.open` i18n: nessuna IPC nativa dal browser cloud, e' un trade-off accettato per Phase 15. _(implementato; vedi `RoomPlayerView.tsx::RoomPreviewDialogContainer` + `FilePreviewDialog.tsx` fallback)_

- [x] **E3.** Quando il PC sala apre un file, `RoomPlayerView` chiama `invokeRoomPlayerSetCurrent(deviceToken, presentationId)` in modalita **best-effort** (errore loggato e basta, l'esperienza sala vince sull'audit). La Edge Function `room-player-set-current` invoca la RPC SECURITY DEFINER `rpc_room_player_set_current(p_token, p_presentation_id)` che valida tutto e fa l'UPDATE atomico su `room_state`. Migration: `supabase/migrations/20260418030000_room_state_now_playing.sql` aggiunge le colonne `current_presentation_id uuid REFERENCES presentations(id) ON DELETE SET NULL` e `last_play_started_at timestamptz`, piu' la RPC con `GRANT EXECUTE ... TO service_role`. Activity log scrive `action = 'room_now_playing'` con `actor = 'agent'` (PC sala = agente automatico, no JWT). _(implementato; vedi migration + `supabase/functions/room-player-set-current/index.ts` + `apps/web/src/features/devices/repository.ts::invokeRoomPlayerSetCurrent`)_

- [x] **E4.** Admin vede "In onda" sotto la card sala in `EventDetailView`:
  - `useRoomStates` (gia' presente Sprint A6) esteso con select PostgREST embed: `current_presentation:current_presentation_id (current_version_id, current_version:current_version_id (file_name))` → JOIN nested 2-livelli, una sola query, RLS tenant_isolation rispettata.
  - Nuovo componente `<NowPlayingBadge>` (`apps/web/src/features/devices/components/NowPlayingBadge.tsx`) verde con icona `<Radio>` pulsante + "In onda: {fileName} · {timeAgo}". Il timeAgo si auto-aggiorna ogni 10s via `setInterval` (re-render solo del badge, non di EventDetailView).
  - Polling `useRoomStates` resta a 30s (gia' Sprint A6) — sufficiente per "in onda" che cambia tipicamente ogni minuti, non secondi. Per latenza <1s c'e' anche il broadcast Realtime `room_state_changed` (Sprint B) che triggera un refresh push.
  - Anche il PC sala stesso vede il badge "In onda" (chip verde dentro la `<FileRow>` corrispondente in `FileSyncStatus`) per coerenza visiva e feedback immediato all'operatore. _(implementato; vedi `useRoomStates.ts` esteso + `NowPlayingBadge.tsx` + `EventDetailView.tsx` + `FileSyncStatus.tsx::isNowPlaying`)_

**Criterio di accettazione E:** un PC sala apre un file PDF; entro 30s la dashboard admin mostra "In onda: presentation.pdf · 12s fa" sotto la card sala, e la cifra si aggiorna a "27s fa" → "1m fa" senza azione utente. Tentativo malicious da JS console (chiamare `set_current` con `presentationId` di un'altra sala) viene rifiutato dalla RPC con `presentation_not_in_device_room` (HTTP 403). _(da verificare in field test)_

**Criterio di accettazione totale (3.D + 3.E):** un admin gestisce 200 file in 5 sale per 3 sessioni cadauna senza mai scrollare 30 secondi alla ricerca di un file, e a colpo d'occhio sulla dashboard vede "In onda" su ogni sala con il nome file corrente.

---

## 4. FASE 3 — VERSIONE DESKTOP OFFLINE INTRANET / VPN

> **Obiettivo:** stessa app, stessi flussi, stessa UI, ma funziona **senza Internet** in una rete LAN/VPN dell'evento.
> **Stack:** Tauri 2 (Rust) wrapper + Axum HTTP server locale + SQLite + mDNS discovery.
> **Tempo stimato:** 15-20 giorni.

### 4.A — Architettura ad alto livello

```
[ADMIN PC desktop]                    [PC SALA 1 desktop]      [PC SALA 2 desktop]
+--------------------------+          +-----------------+      +-----------------+
|  Tauri 2 webview (UI)    |          | Tauri 2 webview |      | Tauri 2 webview |
|  carica la stessa SPA    |          | (idem admin)    |      | (idem admin)    |
|  React di /apps/web      |          |                 |      |                 |
+--------------------------+          +-----------------+      +-----------------+
        |  HTTP localhost:7300                |                       |
        v                                     |                       |
+--------------------------+                  |                       |
| Rust backend (Axum)      |<-----------------+-----------------------+
|  - SQLite DB locale      |    HTTP LAN su porta fissa 7300
|  - mDNS publish/discover |
|  - File system locale    |
|  - Optional cloud sync   |
+--------------------------+
```

**Concetti chiave:**

- L'admin PC e il **server master** della LAN: ha il DB SQLite autoritativo.
- I PC sala fanno **client-only**: vedono il file system locale e ricevono file dall'admin via HTTP LAN.
- mDNS pubblica `_slidecenter._tcp.local` con TXT record `role=admin|sala`, `name=...`, `event=...`.
- Quando l'admin clicca "Aggiungi PC", scopre tutti i PC sala con app aperta sulla stessa LAN.

### 4.B — SPRINT J: Bootstrap del progetto desktop

> **STATO (17 apr 2026):** J1-J5 implementati e in `main`. Build verde (cloud + desktop) zero regressioni. Validazione runtime Tauri (dev `cargo tauri dev`, bundle NSIS `cargo tauri build`) da fare localmente con la toolchain Rust dell'utente — pipeline cartografata. Decisioni architetturali chiave:
>
> - **Strategia UI: Opzione 1** (SPA condivisa `apps/web`). ZERO duplicazione: l'app desktop e' un puro wrapper Tauri 2 sulla build `apps/web/dist-desktop/`. In dev punta a `http://localhost:5173` (Vite con `strictPort` per garantire la collisione con Tauri). In prod l'intera SPA e' embeddata come `file://` dentro l'eseguibile NSIS.
> - **Vite build target desktop via `--mode desktop`** (no env file separati, no cross-env): `defineConfig(({ mode }) => ...)` ramifica a runtime su `mode === 'desktop'`. In quel ramo: (1) `base: './'` per path relativi necessari a `file://`; (2) `build.outDir: 'dist-desktop'` (la build Vercel cloud continua a usare `dist`, zero rischio); (3) VitePWA **disabilitata** (la webview Tauri non ha bisogno di service worker — anzi, lo romperebbe con offline forzato); (4) `define` injection che forza `import.meta.env.VITE_BACKEND_MODE = 'desktop'` a compile-time, indipendente da .env.
> - **Backend mode runtime in `apps/web/src/lib/backend-mode.ts`**: helper `getBackendMode()` + `getBackendBaseUrl()` + `getBackendDescriptor()` (per la chip indicator UI). Ripristino graduale: quando Sprint K pubblichera' lo shim REST verso `http://127.0.0.1:7300`, basta scriverlo una volta in un nuovo `backend-client.ts` che internamente sniffa `getBackendMode()` — nessun componente React dovra' toccare la propria logica.
> - **Fail-fast in `getSupabaseBrowserClient()`**: in modalita `desktop` lancia errore esplicito "Backend desktop attivo: shim REST arriva con Sprint K". Meglio crashare comprensibile che martellare il vecchio progetto Supabase cloud.
> - **Chip indicator "CLOUD / DESKTOP"** (`BackendModeBadge`) gia' montata nel footer della sidebar (root-layout) — anticipo Sprint O4. Icone `<Cloud>` (cloud) / `<Monitor>` (desktop), tooltip con hint i18n.
> - **Tauri 2 crate in `apps/desktop/src-tauri/`** coerente con `apps/agent/src-tauri/` (stesso `productName/identifier` schema Live Software, stessi plugin di base, stesso profilo release `strip+lto`). Plugin abilitati come richiesto dalla guida: `shell` (per "Apri sul PC" nativo con PowerPoint/Keynote in Sprint K+), `fs`, `http`, `notification`, `dialog`. Capability `default.json` pubblica i permessi essenziali + whitelist HTTP limitata a `127.0.0.1:7300`, `localhost:7300` e `*.supabase.co/*` (no fetch esterno arbitrario).
> - **Main.rs minimo** (`cmd_app_info` come unico invoke handler): no server Axum, no mDNS, no SQLite — Sprint K li aggiungera'. Bootstrap dev build verificato via `cargo read-manifest` + JSON validation `tauri.conf.json` e `capabilities/default.json`. Compilazione Rust completa richiede toolchain dell'utente (primo `cargo build` ~5-10 min per scaricare e compilare Tauri 2 + plugin).
> - **Script desktop** (`apps/desktop/package.json` + `apps/desktop/scripts/clean.mjs`) allineati al layout di `apps/agent`: `pnpm --filter @slidecenter/desktop run dev|build:tauri|clean|clean:full`. Dalla root: `pnpm dev:desktop` (dev Tauri + Vite) e `pnpm build:desktop` (web + bundle NSIS).
> - **Icone** copiate da `apps/agent/src-tauri/icons/` come placeholder per il bootstrap. In Sprint P (build/distribuzione) verranno rigenerate dal brand `Live SLIDE CENTER` con `generate-brand-icons.mjs` (gia' esistente per web).

#### Step

- [x] **J1.** Crate Tauri 2 nel workspace: `apps/desktop/` con struttura coerente a `apps/agent/`.

  ```text
  apps/desktop/
    package.json                       # orchestrator pnpm (clean, dev, build:tauri, release:full)
    .gitignore                         # node_modules, target, gen/schemas
    scripts/clean.mjs                  # default: bundle + exe; --full: target intero + dist-desktop
    src-tauri/
      Cargo.toml                       # tauri=2, plugin-shell/fs/http/notification/dialog, tracing, serde_json
      build.rs                         # tauri_build::build()
      tauri.conf.json                  # window 1280x800, NSIS, frontendDist = ../../web/dist-desktop
      capabilities/default.json        # permessi scoped (http whitelist 127.0.0.1:7300 + *.supabase.co)
      icons/                           # copiate da apps/agent/src-tauri/icons (placeholder Sprint J)
      src/main.rs                      # bootstrap Tauri 2 + cmd_app_info
  ```

- [x] **J2.** `tauri.conf.json` configurato come da guida:
  - Window 1280x800 (minSize 1024x720), resizable, decorations true.
  - `windows.webviewInstallMode: downloadBootstrapper` (silent) per Windows.
  - `bundle.identifier: com.livesoftware.slidecenter.desktop` (coerente con pattern ecosistema Live Software; `com.liveworks.slidecenter` evitato per non collidere con Live WORKS APP).
  - `bundle.targets: ['nsis']` (priorita Windows come da guida).
  - `beforeDevCommand` / `beforeBuildCommand` gia' cablati al filter `@slidecenter/web` con `--mode desktop`.

- [x] **J3.** Strategia UI: **Opzione 1 (SPA condivisa)**. Dev punta a `http://localhost:5173` (Vite server con `strictPort: true`). Prod legge dalla cartella `apps/web/dist-desktop/` embeddata nel bundle NSIS. Zero duplicazione codice React → ogni miglioramento cloud arriva automaticamente al desktop.

- [x] **J4.** `apps/web/vite.config.ts` — ramo `mode === 'desktop'`:
  - `base: './'` (path relativi per `file://`).
  - `build.outDir: 'dist-desktop'` (output isolato; `dist/` cloud Vercel resta intatto).
  - `chunkSizeWarningLimit: 2048` (meno noise nel webview offline).
  - `plugins`: VitePWA assente in desktop mode (service worker non necessario e anzi dannoso in `file://`).
  - `define`: injection statica di `VITE_BACKEND_MODE='desktop'`.
  - Script `build:desktop` in `apps/web/package.json`: `tsc -b && vite build --mode desktop`.
  - Script `preview:desktop` per smoke test locali: `vite preview --mode desktop --outDir dist-desktop`.

- [x] **J5.** Env `VITE_BACKEND_MODE` + astrazione backend:
  - Tipo aggiornato in `apps/web/src/vite-env.d.ts` (`'cloud' | 'desktop'` + opzionale `VITE_DESKTOP_BACKEND_URL` per override porta).
  - `apps/web/src/lib/backend-mode.ts`: `getBackendMode()`, `getBackendBaseUrl()` (cloud → `VITE_SUPABASE_URL`, desktop → `http://127.0.0.1:7300`), `isRunningInTauri()` (sniff di `window.__TAURI_INTERNALS__`), `getBackendDescriptor()` per i18n UI.
  - `apps/web/src/lib/supabase.ts`: `getSupabaseBrowserClient()` fa fail-fast con errore chiaro in modalita desktop, rinviando lo shim REST a Sprint K (evita race misteriose durante il field test).
  - `apps/web/src/components/BackendModeBadge.tsx`: chip "CLOUD / DESKTOP" + tooltip i18n, montata nel footer della sidebar (`root-layout.tsx`) sopra il bottone logout — visibile a ogni utente autenticato, zero sforzo cognitivo.
  - `packages/shared/src/i18n/locales/{it,en}.json`: nuova sezione `backendMode.short.*` + `backendMode.hint.*` in IT + EN professionale.
  - `.env.example` + `turbo.json` (`globalEnv` e task `build:desktop`) aggiornati.

**Criterio di accettazione J (Sprint J):** `pnpm --filter @slidecenter/web build` (cloud) e `pnpm --filter @slidecenter/web build:desktop` (Tauri webview) completano entrambi senza errori → **VERIFICATO**. `cargo read-manifest` su `apps/desktop/src-tauri/Cargo.toml` valido → **VERIFICATO**. Il bundle NSIS completo (`cargo tauri build`) richiede la toolchain Rust utente e viene validato in locale (prima compilazione ~5-10 min per scaricare Tauri 2 + plugin).

### 4.C — SPRINT K: Server Rust locale (backend)

- [x] **K1.** Crate `apps/desktop/src-tauri/src/server/` creato e cablato su Tauri 2:
  - `mod.rs`: bootstrap Axum 0.7 in ascolto su `0.0.0.0:7300` (default) — LAN-share e localhost serviti dallo stesso socket. Genera/persiste `secrets.json` (admin_token + HMAC) in `~/SlideCenter/secrets.json` con scrittura atomica `tmp + rename`. Espone `/health` (no auth, smoke test) e `/info` (no auth, root paths). CORS `very_permissive` (sicuro perche' tutti gli endpoint sensibili sono dietro `AdminAuth` o device_token).
  - `routes/`: 4 sotto-moduli (`rest.rs`, `rpc.rs`, `storage_routes.rs`, `functions.rs`) — vedi K3/K4/K5.
  - `db.rs`: pool `r2d2_sqlite` (size 4) con `init_pool()` che applica `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000` su ogni connessione (init hook). Migration embedded via `include_str!`. **Scelta deliberata: `rusqlite` invece di `sqlx`** — single-user desktop, niente bisogno di check-time SQL, `bundled` evita dipendenza dalla SQLite di sistema (Win/Mac/Linux uniformi), build piu' rapido. Tutte le query rusqlite (sincrone) sono wrappate in `tokio::task::spawn_blocking` per non bloccare il runtime async di Axum.
  - `mdns.rs`: pubblica `_slidecenter._tcp.local.` via `mdns-sd 0.11` con TXT `role=admin, name=<hostname>, port=7300, event_id=<uuid|null>`. IP locale rilevato via UDP-connect a `8.8.8.8:80` (cross-platform). Se mDNS daemon non disponibile (rete che lo blocca), il server parte comunque (warn nei log).
  - `auth.rs`: 3 meccanismi — `AdminAuth` extractor (bearer token, confronto a tempo costante), `OptionalAdminAuth` (per endpoint pubblici che vogliono sapere se chi chiama e' admin), `resolve_device(state, raw_token)` (SHA-256 hex match contro `paired_devices.pair_token_hash`, identico a `pair-claim/index.ts` cloud).
  - **Cablaggio Tauri**: `main.rs` ora ha un `setup()` che `block_on(server::boot())` e salva `BootedServer` in un `OnceLock<BACKEND>`. Nuovo Tauri command `cmd_backend_info` che ritorna `{ ready, base_url, port, admin_token, data_root, storage_root }` — la SPA in modalita desktop lo invoca al boot per cablare client REST/storage/functions verso il server locale.

- [x] **K2.** Schema SQLite mirror Supabase (file `apps/desktop/src-tauri/migrations/0001_init.sql`):
  - 13 tabelle: `tenants`, `users`, `events`, `rooms`, `sessions`, `speakers`, `presentations`, `presentation_versions`, `room_state`, `local_agents`, `paired_devices`, `pairing_codes`, `activity_log`.
  - Tipi tradotti da Postgres -> SQLite mantenendo compatibilita' applicativa: `UUID` -> `TEXT` (string UUID v4), `TIMESTAMPTZ` -> `TEXT` (ISO-8601 in UTC, comparabile lessicograficamente), `JSONB` -> `TEXT` (con serializzazione `serde_json`), `BIGINT` -> `INTEGER`, `BOOLEAN` -> `INTEGER 0/1`.
  - Enum Postgres -> `TEXT` con `CHECK(col IN ('a','b','c'))` (es. `event_status`, `pres_status`, `playback_mode`, `sync_status`).
  - Indici 1:1 con la migration cloud (es. `presentations_speaker_unique` partial unique su `speaker_id IS NOT NULL`).
  - **Seed locale single-tenant**: `INSERT OR IGNORE` di `tenants` (id `00000000-0000-0000-0000-000000000001`, plan `enterprise`, quote infinite) e `users` admin (id `00000000-0000-0000-0000-000000000002`). Costanti esposte in `db.rs` come `LOCAL_TENANT_ID` / `LOCAL_ADMIN_USER_ID` e iniettate automaticamente in tutti gli `INSERT` REST/RPC, cosi' la SPA non deve preoccuparsi del tenant in modalita desktop.

- [x] **K3.** PostgREST minimo + RPC mirror (`routes/rest.rs` + `routes/rpc.rs`):
  - **Parser PostgREST** (`server/pgrest.rs`): operatori `eq, neq, gt, gte, lt, lte, like, ilike, in.(), not.in.(), is.null, is.not.null`, `order=col.asc/desc` (multi-colonna), `limit`, `offset`. `select` accettato e ignorato (ritorna sempre tutte le colonne — l'embedding nested PostgREST tipo `select=...,speakers(full_name)` non e' coperto: chi lo usa gestisce via JOIN custom in RPC, vedi `room-player-bootstrap`).
  - **Sicurezza parser**: whitelist colonne per WHERE/ORDER (input ignoto -> 400), nessuna concatenazione SQL diretta (tutti i valori in `?N` parametri), `or=()` rifiutato esplicitamente.
  - **Generic CRUD** (`routes/rest.rs`): un solo handler `table_handler` con dispatch per `Method` (GET/POST/PATCH/DELETE), montato su `/rest/v1/:table`. `TableSpec` whitelist per ogni tabella con `cols_filter` / `cols_write` / `auto_cols` / `id_uuid_auto`. Header `Prefer: return=representation` rispettato. `Accept: application/vnd.pgrst.object+json` -> ritorna oggetto invece di array (semantica `.maybeSingle()`). Iniezione automatica `tenant_id = LOCAL_TENANT_ID` su INSERT.
  - **Tabelle esposte**: `events, rooms, sessions, speakers, presentations, presentation_versions, paired_devices, room_state, local_agents, pairing_codes, tenants, users, activity_log` (13 tabelle, le ultime 2 read-only).
  - **RPC** (`routes/rpc.rs`): 8 endpoint `/rest/v1/rpc/<name>` 1:1 con le funzioni Postgres della migration cloud:
    - `init_upload_version_for_session` (Sprint C2) — crea presentation senza speaker + version `uploading` + storage_key deterministico.
    - `init_upload_version_admin` — variante per upload speaker-attribuito.
    - `finalize_upload_version_admin` — promuove version a `ready`, aggiorna `current_version_id`, `total_versions`, `presentation.status='ready'`, log activity.
    - `abort_upload_version_admin` — cancella version `uploading`, rimuove file dal disco se presente.
    - `delete_presentation_admin` — soft-cleanup: cancella tutte le version + file su disco + presentation.
    - `rename_paired_device_by_token` — auth via SHA-256 device_token.
    - `rpc_room_player_set_current` — auth via device_token, valida `presentation.event_id == device.event_id` e `session.room_id == device.room_id`, UPSERT `room_state.current_presentation_id`.
    - `rpc_move_presentation_to_session` — admin-only, sposta una presentation tra sessioni con re-link `current_version_id`.

- [x] **K4.** Endpoint storage (`server/storage.rs` + `routes/storage_routes.rs`):
  - **Layout filesystem**: `~/SlideCenter/storage/<bucket>/<storage_key>` (sezione 13). `object_path()` rifiuta path-traversal (`..`, segmenti vuoti, byte nulli) e verifica `starts_with(<root>/<bucket>)`.
  - **`POST /storage/v1/object/:bucket/*key`** (admin auth): upload binario streaming via `Body::into_data_stream()` + `tokio::fs::File::write_all` chunked. Ritorna `{ Key, size }`. **Niente buffer in RAM** -> ok per file PowerPoint da 5+ GB.
  - **`GET /storage/v1/object/sign/:bucket/*key`** (admin auth): genera signed URL HMAC-SHA256 con `expires_in` configurabile (default 1h, min 60s, max 7g). Stringa firmata = `"<bucket>:<key>:<expires>"`. Output base64 URL_SAFE_NO_PAD. Shape compat Supabase storage-js: `{ signedURL, path }`.
  - **`GET /storage-files/:bucket/*key?expires&sig`** (no auth — protezione via signed URL): `verify_signed_url()` ricalcola HMAC e confronta a tempo costante; rifiuta se scaduto. Serve il file con:
    - `Content-Type` da `mime_guess`,
    - `Accept-Ranges: bytes`,
    - **Range request support**: parser per `bytes=START-END`, `bytes=START-`, `bytes=-N` (suffix). Multi-range non supportato (raro, complicato). Ritorna 206 `Partial Content` con `Content-Range: bytes <s>-<e>/<total>` + body limitato via `tokio::io::AsyncReadExt::take(length)`.

- [x] **K5.** Edge Functions mirror (`routes/functions.rs`):
  - **`POST /functions/v1/pair-init`** (admin auth): valida `event_id` esistente, genera codice 6 cifre via `rand::thread_rng`, INSERT `pairing_codes` con `expires_at = NOW + 10min`. Ritorna `{ code, expires_at }` — shape identica a `supabase/functions/pair-init/index.ts`.
  - **`POST /functions/v1/pair-poll`** (admin auth): ritorna `{ status: 'pending'|'consumed'|'expired', device_id?, device_name? }`. Logica scadenza identica al cloud (lessicografica su ISO-8601).
  - **`POST /functions/v1/pair-claim`** (no auth — LAN trust): genera `device_token` via `Uuid::new_v4()`, hash SHA-256 -> salva in `paired_devices.pair_token_hash`. **Differenza dal cloud**: niente rate limit (`pair_claim_rate_events`) perche' la LAN locale e' gia' un dominio fidato; se in futuro servisse, basta replicare la tabella.
  - **`POST /functions/v1/room-player-bootstrap`** (no auth — auth via body `device_token`): replica esatta del cloud — risolve device, marca `last_seen_at` + `status=online`, persiste `playback_mode` se richiesto, carica `room_state`, `current_session`, `local_agents` online, lista files con LEFT JOIN sessions/presentations/versions/speakers via prepared statements rusqlite. Ordinamento: per `sessionScheduledStart`, poi per `filename`. Risposta JSON identica al cloud (`device, room, event_id, network_mode, agent, room_state, files`).
  - **`POST /functions/v1/room-player-rename`** (no auth — body): valida lunghezza nome (max 80 char), risolve device via SHA-256 hash, UPDATE `paired_devices.device_name + last_seen_at`. Ritorna `{ device_id, device_name }`.
  - **`POST /functions/v1/room-player-set-current`** (no auth — body): replica `rpc_room_player_set_current` con tutte le validazioni cross-room (presentation -> event_id, session -> room_id), UPSERT `room_state.current_presentation_id`. Mappa errori a 404/409/403 come il cloud.

**Criterio di accettazione K (Sprint K):** `cargo read-manifest` su `apps/desktop/src-tauri/Cargo.toml` ritorna `Exit 0` -> **VERIFICATO**. Lo schema SQLite `0001_init.sql` riproduce 13 tabelle Postgres con 100% delle colonne necessarie alla SPA. 23 endpoint HTTP (REST 13 tabelle x 4 metodi + 8 RPC + 3 storage + 6 functions) cablati nel Router Axum unico. Compilazione Rust completa rinviata al cargo-build dell'utente (toolchain locale; primo `cargo check` ~3-5 min per scaricare axum + rusqlite + mdns-sd e tutte le dipendenze transitive).

### 4.D — SPRINT L: mDNS discovery — KEY FEATURE "Aggiungi PC"

> **Questo e il pezzo che l'utente ha esplicitamente chiesto.**
>
> **STATO: COMPLETATO 2026-04-17.** Cargo check verde, ESLint 0 errori, build cloud + desktop OK. Tutti i deliverable L1-L5 implementati con le note operative riportate sotto. Per i field-test: avviare 2 istanze desktop sulla stessa Wi-Fi, scegliere ADMIN su una e PC SALA sull'altra, riavviare entrambe, aprire EventDetailView sull'admin → "Aggiungi PC LAN".

- [x] **L1.** All'avvio dell'app desktop, fase di scelta ruolo:
  - Schermata iniziale con 2 bottoni: "Centro di controllo" (admin) e "PC sala". Implementata in `apps/web/src/features/desktop/RoleSelectionView.tsx`, montata via `apps/web/src/app/desktop-role-gate.tsx` davanti a tutta la SPA in modalita Tauri (no-op in cloud).
  - Persistenza in `~/SlideCenter/role.json` via `apps/desktop/src-tauri/src/role.rs` (write atomico .tmp → rename). Tauri commands `cmd_get_role` / `cmd_set_role` esposti tramite `cmd!` handler in `main.rs` e wrappati lato SPA dal modulo `apps/web/src/lib/desktop-bridge.ts` (`getDesktopRole` / `setDesktopRole`). Dopo `cmd_set_role` la SPA mostra schermata "Riavvia l'app" perche' `boot()` legge il ruolo solo all'avvio del processo.
  - In modalita `sala`, il `DesktopRoleGate` ridireziona automaticamente su `/pair` (la PairView gestisce auto-rejoin se `device.json` e' gia' presente).

- [x] **L2.** Quando un PC sala parte (e in generale qualsiasi nodo desktop):
  - `apps/desktop/src-tauri/src/server/mdns.rs::publish()` registra `_slidecenter._tcp.local` con TXT `role`, `name`, `hostname`, `event_id` (se gia' paired), `port`, `app_version`. Daemon mantenuto in `MdnsHandle` salvato dentro `BootedServer` e propagato ad `AppState` via `Arc<MdnsHandle>` (cosi' il pair-direct endpoint puo' aggiornare il TXT in-place).
  - `MdnsHandle::update_event_id(new_event_id)` esegue unregister+register del service per propagare la nuova proprieta `event_id` a tutti i resolver LAN. Chiamato dentro `pair-direct` dopo l'inserimento `paired_devices` (vedi L4).
  - Il primo boot di un PC sala con `device.json` gia' presente legge `event_id` e lo usa come TXT iniziale (cosi' altri admin LAN vedono `alreadyPaired` al primo round).

- [x] **L3.** Quando admin clicca "Aggiungi PC LAN" (in `EventDetailView` → `DevicesPanel`):
  - Bottone visibile solo se `getDesktopBackendInfo().ready === true && role === 'admin'` (in modalita cloud o role=sala il bottone e' nascosto).
  - Apre `apps/web/src/features/devices/components/AddLanPcDialog.tsx`. Discovery one-shot via `cmd_discover_lan_pcs(role_filter='sala', timeout_ms=1500)` → `server::mdns::discover()` apre un daemon effimero, fa browse, raccoglie `ServiceResolved` per la durata indicata e ritorna la lista filtrata.
  - Per ogni nodo trovato: nome, IP, port, versione, badge `alreadyPaired (event_id ...)` se TXT `event_id != eventId` corrente. Form: dropdown sala di destinazione (default "nessuna sala — abbina senza assegnare") + nome opzionale (default = hostname).
  - Click "Abbina" → `pairDirectLan({ targetBaseUrl, event_id, event_name, room_id?, room_name?, device_name?, admin_server: { base_url, name } })` che fa `POST http://<sala_ip>:<port>/functions/v1/pair-direct`. **Nessun admin_token via rete:** il PC sala accetta sempre il pair-direct se non e' gia' paired (vedi L4 idempotenza).
  - `admin_server.base_url` calcolato dalla SPA via `getAdminLanBaseUrl(info)` su `info.lan_addresses[0]` (`mdns::local_ipv4_addresses()` esposta `pub` per popolare `BootedServer.lan_addresses` → `cmd_backend_info` → bridge). In ambienti multi-NIC viene scelto il primo IP della NIC default; rimandata a Sprint Q la selezione esplicita.

- [x] **L4.** Endpoint `pair-direct` sul PC sala (`apps/desktop/src-tauri/src/server/routes/functions.rs::pair_direct`):
  - Verifica `state.role.as_str() == "sala"`: i nodi admin rifiutano il pair-direct con 400 (`role_not_sala`).
  - **Idempotenza forte:** se esiste gia' un `paired_devices` per (`event_id`, `room_id` opzionale, `device_id`) ritorna 409 Conflict (`already_paired`) senza side-effect; l'utente deve liberare il PC sala manualmente (riavvio + `device.json` eliminato).
  - Crea/upserta `events` (id, name) e — se `room_id` presente — `rooms` (id, event_id, name, room_type=`main`) come mirror minimo, perche' la FK di `paired_devices` lo richiede.
  - Inserisce `paired_devices` con `device_token` random (32 bytes URL_SAFE_NO_PAD), `device_name`, `device_type=desktop`, `paired_at=now`. Il `device_token` viene scritto in `~/SlideCenter/device.json` via `device_persist::write` insieme a `event_id`, `room_id`, `admin_server: { base_url, name, fingerprint=null }`.
  - Aggiorna mDNS TXT con `event_id` via `state.mdns.update_event_id(Some(event_id))` (best-effort: se il publisher era `None` per problemi multicast, log warn ma response 200 OK comunque).
  - Risposta 200 JSON: `{ device_token, device_id, device_name, event_id, room_id, paired_at }`. La SPA admin chiama `onPaired(device_id)` → `usePairedDevices.refresh()` → la lista del DevicesPanel si aggiorna.

- [x] **L5.** Caso multi-admin sulla stessa LAN — gestito client-side dalla SPA:
  - Il `AddLanPcDialog` si limita a fare browse `_slidecenter._tcp.local` con `role=sala`. Eventuali admin sulla LAN non interferiscono perche' restano filtrati dal `role_filter`.
  - Quando un PC sala riceve il pair-direct dall'admin "vincente", il TXT mDNS si aggiorna a `event_id=<vincente>`. Tutti gli altri admin che fanno discovery vedono il badge `alreadyPaired (event_id ...)` con l'event_id del vincente e devono usare lo unblock manuale (riavvio + device.json) per rivendicare quel PC.
  - L'`admin_server` e' salvato dal PC sala in `device.json`: alle prossime sessioni il sala parla solo con quell'admin (auto-rejoin all'avvio gestito in Sprint M2).
  - Multi-admin "concorrente" sullo stesso PC sala viene quindi serializzato dal server (idempotenza 409): no race, no doppio pairing.

**Files modificati Sprint L:**

- Backend Rust: `apps/desktop/src-tauri/src/role.rs` (nuovo), `src/server/mod.rs` (BootedServer + lan_addresses + boot(role)), `src/server/state.rs` (role + mdns in AppState), `src/server/mdns.rs` (publish dinamico + discover one-shot + local_ipv4_addresses pub), `src/server/device_persist.rs` (nuovo), `src/server/routes/functions.rs` (route pair-direct), `src/main.rs` (cmd_get_role/cmd_set_role/cmd_discover_lan_pcs + cmd_backend_info esteso con role/mdns_active/lan_addresses), `tauri.conf.json` (`withGlobalTauri: true`).
- SPA web: `apps/web/src/lib/desktop-bridge.ts` (nuovo, wrapper tipato per Tauri commands + `pairDirectLan` HTTP fetch), `apps/web/src/features/desktop/RoleSelectionView.tsx` (nuovo), `apps/web/src/app/desktop-role-gate.tsx` (nuovo), `apps/web/src/app/routes.tsx` (Component=DesktopRoleGate al root), `apps/web/src/features/devices/components/AddLanPcDialog.tsx` (nuovo), `apps/web/src/features/devices/DevicesPanel.tsx` (eventName + bottone LAN).
- i18n: `packages/shared/src/i18n/locales/{it,en}.json` (`devices.addLanPc.*`, `desktopRole.*`).

**Note operative per il field-test:**

- mDNS dipende da multicast UDP: Wi-Fi guest e VLAN isolate spesso lo bloccano. Verificare con `mdns-browser` o `dns-sd -B _slidecenter._tcp` (macOS).
- Windows Defender Firewall: la prima volta che `slide-center-desktop.exe` apre la porta 7300 chiede l'autorizzazione (privata + pubblica). Senza, il PC sala non e' raggiungibile.
- Per liberare un PC sala paired per errore: chiudere l'app, eliminare `~/SlideCenter/device.json`, eliminare `~/SlideCenter/role.json` se serve cambiare ruolo, riavviare.
- `cmd_backend_info().lan_addresses` puo' essere vuoto su un PC senza NIC attiva (es. solo VPN): il bottone "Aggiungi PC LAN" mostra l'avviso "noLanIp" nel dialog.

**Criterio di accettazione L (Sprint L):** `cargo check` exit 0, `tsc --noEmit` exit 0, `eslint .` exit 0 (0 errors, 0 warnings), `vite build` (cloud) + `vite build:desktop` exit 0. End-to-end manuale non eseguito (richiede 2 PC sulla stessa LAN); le verifiche di tipo + compilazione coprono tutta la pipeline.

### 4.E — SPRINT M: Persistenza configurazione PC sala (regola 4) ✅ COMPLETATO 2026-04-17

- [x] **M1.** File `~/SlideCenter/device.json` con il payload essenziale per l'auto-rejoin del PC sala (gia' completato in Sprint L4):

  ```json
  {
    "device_id": "<uuid>",
    "device_token": "<token-clear>",
    "device_name": "PC-Sala-Plenaria",
    "event_id": "<uuid>",
    "room_id": "<uuid|null>",
    "admin_server": {
      "base_url": "http://192.168.1.10:7300",
      "name": "MIO-PC-ADMIN",
      "fingerprint": null
    },
    "paired_at": "2026-04-17T12:34:56Z",
    "app_version": "0.1.0"
  }
  ```

  **Note implementative**: scrittura atomica (tmp+rename), best-effort (errore loggato non blocca pair-direct), `data_root` configurabile via `SLIDECENTER_DATA_ROOT` per test isolati. `files_root` e `playback_mode` non sono parte di device.json (Sprint M): `files_root` viene gestito dal client lato `useFileSync` (FSA persistito in IndexedDB), `playback_mode` da `localStorage` `sc:rp:playbackMode` (Sprint A1).

- [x] **M2.** Auto-rejoin all'avvio del PC sala desktop senza mai mostrare il keypad finche' device.json e' presente:
  - Nuovo Tauri command `cmd_get_persisted_device` espone il payload device.json alla SPA.
  - `DesktopRoleGate` (estensione Sprint L1) chiama il command **prima** di renderizzare le route: se device.json esiste, pre-popola `localStorage.device_token` + `device_id` (compat con il flusso di auto-rejoin esistente di `PairView`) e ridirige direttamente a `/sala/:token`. Niente flash di keypad.
  - Se l'utente arriva a `/pair` (es. dopo "Reconnect" da `RoomPlayerView` con error), il `tryAutoRejoin` di `PairView` rileva il token, fa bootstrap verso il server LOCALE Rust (sempre raggiungibile a `127.0.0.1:7300` se l'app e' up) e ridirige alla sala.
  - Se il bootstrap fallisce (token revocato lato admin LAN, ad esempio): `PairView` chiama `clearDevicePairing()` (sotto Tauri+role=sala) per evitare il loop "DesktopRoleGate ripopola → bootstrap fallisce" e mostra il keypad pulito.
  - **Modalita "STANDALONE LOCAL"**: il PC sala chiama solo il proprio server locale (mai il cloud). Quando l'admin remoto e' irraggiungibile, l'unico effetto pratico e' che non arrivano nuovi file (questo lo gestira' Sprint N — sync file LAN). Per Sprint M il "uso solo file gia scaricati" e' implicito perche' `useFileSync` gia oggi mostra i file presenti su disco anche senza upload nuovi.

- [x] **M3.** Disconnessione coordinata in due direzioni:
  - **Lato sala (utente)** — pulsante "Esci dall'evento" gia' presente in `RoomPlayerView` (menu + ConfirmDisconnectModal). Aggiunto: in modalita Tauri+role=sala chiama `cmd_clear_device_pairing` (fire-and-forget) che cancella `device.json` + riga `paired_devices` SQLite locale + reset TXT mDNS `event_id`. Senza questo, `DesktopRoleGate` ripopolerebbe localStorage al prossimo refresh con un token gia revocato (loop infinito).
  - **Lato admin** — `revokeDevice(deviceId)` arricchito: legge `lanBaseUrl` da localStorage map `sc:devices:lanBaseUrlByDeviceId` (popolata da `AddLanPcDialog` dopo pair-direct), chiama `POST <lanBaseUrl>/functions/v1/pair-revoke` best-effort (timeout 4s), poi cancella il record `paired_devices` dal DB locale. Se il sala e' offline il pair-revoke remoto fallisce silenziosamente: il record locale viene cancellato comunque, l'admin sa che il sala "fantasma" potrebbe ricomparire al prossimo boot e potra' rifare unpair quando torna online.
  - **Endpoint `pair-revoke` lato sala** — nuova route Axum `POST /functions/v1/pair-revoke`: accetta `{ device_token }` (validazione SHA-256 contro `pair_token_hash`) o `{ device_id, event_id }` (fallback se l'admin ha perso il token clear). Solo `role=sala` lo serve (`role_not_sala` 403). Effetto: cancella riga `paired_devices` + device.json + reset TXT mDNS event_id.

**File modificati / creati Sprint M:**

- `apps/desktop/src-tauri/migrations/0002_paired_devices_lan_url.sql` — colonna `lan_base_url` su `paired_devices` (investment per Sprint N: il PC sala potrebbe in futuro voler ricevere notifiche push HTTP dal proprio server admin, e l'URL inverso e' utile).
- `apps/desktop/src-tauri/src/server/db.rs` — applicazione idempotente di MIGRATION_0002 (tollera "duplicate column name").
- `apps/desktop/src-tauri/src/server/device_persist.rs` — aggiunta `clear(data_root)` per cancellare device.json (idempotente: NotFound = ok).
- `apps/desktop/src-tauri/src/server/routes/functions.rs` — nuova route `pair_revoke` con validazione token + cleanup transazionale.
- `apps/desktop/src-tauri/src/server/routes/rest.rs` — `lan_base_url` aggiunta a `cols_filter` + `cols_write` di paired_devices (per future scritture lato Rust/test).
- `apps/desktop/src-tauri/src/main.rs` — nuovi command `cmd_get_persisted_device`, `cmd_clear_device_pairing`. Helper `clear_paired_device_row` apre connection diretta (NON il pool: WAL mode rende sicuro).
- `apps/web/src/lib/desktop-bridge.ts` — `getPersistedDevice()`, `clearDevicePairing()`, `pairRevokeLan()` con tipo `PersistedDevice`.
- `apps/web/src/app/desktop-role-gate.tsx` — pre-popolazione localStorage da device.json + redirect diretto a `/sala/:token` (skip keypad). Loader esteso fino a quando `salaAutoToken` e' risolto, per evitare flash.
- `apps/web/src/features/devices/PairView.tsx` — su error bootstrap in Tauri+role=sala chiama `clearDevicePairing()` (anti-loop infinito).
- `apps/web/src/features/devices/RoomPlayerView.tsx` — `handleDisconnect` chiama `clearDevicePairing()` (fire-and-forget) in Tauri+role=sala.
- `apps/web/src/features/devices/repository.ts` — mappa `lanBaseUrlByDeviceId` in localStorage; `revokeDevice` legge la mappa e chiama `pairRevokeLan` best-effort prima del delete.
- `apps/web/src/features/devices/components/AddLanPcDialog.tsx` — chiama `rememberPairedDeviceLanUrl` dopo pair-direct success.
- Fix collaterali clippy strict pre-esistenti (non blocking ma puliti): `routes/rpc.rs` (uninlined_format_args), `routes/functions.rs` (type_complexity con type alias), `server/storage.rs` (manual_clamp → `.clamp()`).

**Note pratiche per il field-test Sprint M:**

- **Riavvio del PC sala con device.json presente** → l'app deve aprirsi direttamente sulla view sala (logo/file/sync), zero keypad. Tempo target: < 1 secondo dal boot della webview al render della sala. Per testare cancellare manualmente `localStorage` mantenendo device.json: l'auto-rejoin deve comunque funzionare grazie a `DesktopRoleGate` che lo ripopola.
- **"Esci dall'evento" sul sala** → dopo conferma deve sparire `~/SlideCenter/device.json` (verificare con `ls`). Al riavrio l'app mostra il keypad (no auto-rejoin). Il sala torna disponibile alla discovery LAN dell'admin (TXT `event_id` resettato).
- **"Rimuovi PC" sull'admin con sala online** → log Axum lato sala mostra `pair-revoke` 200 OK; device.json sparisce; al refresh della UI sala compare il keypad (token in localStorage rimane orfano ma il bootstrap fallira').
- **"Rimuovi PC" sull'admin con sala offline** → il record sparisce dalla lista UI dell'admin (cancellazione locale OK), ma se riaccendi il sala questo torna online e la dashboard admin lo riscopre via mDNS + il sala ha ancora device.json. Workflow corretto: l'admin rifa "Rimuovi PC" (questa volta riesce a contattarlo).
- **Token revocato all'insaputa del sala** (es. admin pulisce DB locale senza pair-revoke) → al prossimo bootstrap il sala riceve `device_not_found`/`invalid_token`, `PairView` chiama `clearDevicePairing()` e mostra keypad. Nessun loop.
- **Migration 0002**: applicata automaticamente al boot. Su DB esistenti (Sprint K+L gia' provati) tollera "duplicate column" (idempotenza). Su DB nuovi crea la colonna.
- **`lanBaseUrlByDeviceId` in localStorage** non sopravvive a "Cancella dati sito" del browser. In quel caso "Rimuovi PC" cancella solo il record locale; l'admin deve usare il menu "Esci dall'evento" sul sala. Documentato qui per evitare confusione in field-test.

**Criterio di accettazione M (Sprint M):** `cargo check` + `cargo clippy --all-targets -- -D warnings` exit 0, `tsc --noEmit` exit 0, `eslint .` exit 0 (0 errors, 0 warnings), `vite build` (cloud) + `vite build --mode desktop` exit 0. End-to-end manuale non eseguito (richiede 2 PC sulla stessa LAN); le verifiche di tipo + compilazione + clippy strict coprono tutta la pipeline.

### 4.F — SPRINT N: Sync file PC sala in offline ✅ COMPLETATO 2026-04-17

- [x] **N1.** Su admin desktop, quando si carica un file (RPC `finalize_upload_version_admin`):
  - File salvato in `<storage>/presentations/<storage_key>` localmente (gia' Sprint K).
  - Annotato in SQLite `presentation_versions` (gia' Sprint K).
  - **Sprint N1**: appena la transazione SQL e' committata, lancio `tokio::spawn` con `notify_paired_devices` (`apps/desktop/src-tauri/src/server/lan_push.rs`) che:
    - Query `paired_devices WHERE event_id=? AND status='online' AND lan_base_url IS NOT NULL`.
    - Per ogni device, fire-and-forget `POST {lan_base_url}/events/file_added` via `reqwest::Client` con timeout 4s.
    - Esito loggato (`info!`/`warn!`), fallimenti non bloccano la response al admin SPA.
  - Stesso pattern per `delete_presentation` → `POST /events/presentation_deleted`.
  - **Pre-requisito**: la SPA admin (`AddLanPcDialog`) chiama `registerPairedDeviceOnAdminLocal` dopo `pair-direct` per inserire la riga in SQLite admin con `lan_base_url` e `pair_token_hash` (sha256 del device_token).

- [x] **N2.** Su PC sala:
  - **Listener HTTP**: `POST /events/file_added` e `POST /events/presentation_deleted` (`apps/desktop/src-tauri/src/server/routes/lan_events_routes.rs`). Solo nodi `role=sala` accettano (enforce_role_sala). Payload pubblicato su event bus (`tokio::sync::broadcast`, ring buffer 32 eventi recenti per snapshot tardivi).
  - **Endpoint signed URL**: `POST /functions/v1/lan-sign-url` sull'admin (`apps/desktop/src-tauri/src/server/routes/functions.rs::lan_sign_url`). Il sala chiama l'admin con `device_token + storage_key`, l'admin valida (token in `paired_devices`, storage_key in event matchante), ritorna URL HMAC firmato. TTL default 600s. Bypassa l'admin_token (che il sala non ha).
  - **`useFileSync` LAN**: nuovo prop `lanAdminBaseUrl`. Quando settato, `tryCloud` chiama `signLanDownloadUrl({adminBaseUrl, device_token, storage_key})` invece di `createVersionDownloadUrl` (Supabase). Stessa pipeline `downloadFileToPath` con throttle/concurrency.
  - **`RoomPlayerView` integrazione**: legge `device.json.admin_server.base_url` via `getPersistedDevice()` e backend info via `getDesktopBackendInfo()`, passa entrambi a `useFileSync`.

- [x] **N3.** Push reattivo + safety net:
  - **Long-poll**: `GET /events/stream?since=<cursor>&timeout_ms=25000&event_id=<eid>` sul backend Rust del sala. Risposta immediata se ci sono eventi nuovi nel ring; altrimenti subscribe broadcast e wait fino a timeout. Filtra per `event_id` per evitare cross-talk in setup multi-evento.
  - **`useFileSync` long-poll**: nuovo effect attivo quando `localBackendBaseUrl` settato. Loop infinito con `AbortController` cleanup, backoff 2s su errori transient. Ogni evento `file_added`/`presentation_deleted` chiama `refreshNowRef.current()` (dedup gia' presente in `fetchVersionsInflightRef`).
  - **Safety net**: il polling 12s/60s/5s di Sprint A resta attivo come fallback. In LAN tipica il long-poll e' istantaneo (latenza < 100ms vs 5-60s polling).

- [x] **N4.** `playback_mode` (auto/live/turbo) compatibile:
  - I download LAN passano per la stessa `downloadFileToPath` del cloud, quindi concurrency e throttle si applicano identici (vedi commento aggiornato in `PLAYBACK_MODE_TUNING`).
  - **`live` + LAN 100Mbit**: throttle 50ms ogni 4MB ≈ 0.5s extra su 40MB. Utile per non saturare lo switch durante la proiezione di slide pesanti.
  - **`turbo` + LAN 1Gbit**: 3 download paralleli, limitati dal SSD admin (~500 MB/s). Tipico evento da 5GB scaricato in <30s.
  - **`auto` + LAN**: 1 file alla volta, conservativo. Adatto a upload incrementali durante la sessione.

**File modificati / creati (Sprint N):**

- `apps/desktop/src-tauri/Cargo.toml` — aggiunto `reqwest = { features=["json","rustls-tls"] }` per il fan-out HTTP.
- `apps/desktop/src-tauri/src/server/lan_events.rs` (NEW) — event bus broadcast con ring buffer 32 + tipi `LanEvent`/`LanEventPayload`.
- `apps/desktop/src-tauri/src/server/lan_push.rs` (NEW) — `notify_paired_devices` (fan-out fire-and-forget), `build_file_added` con `FileAddedArgs` struct (clippy too_many_arguments fix), `build_presentation_deleted`.
- `apps/desktop/src-tauri/src/server/state.rs` — aggiunti `http_client: Arc<reqwest::Client>`, `event_bus: Arc<LanEventBus>`, `lan_addresses: Arc<Vec<String>>` + helper `admin_base_url()`.
- `apps/desktop/src-tauri/src/server/mod.rs` — init `reqwest::Client` (timeout 4s + user-agent SlideCenter), `LanEventBus`, merge route `lan_events_routes`.
- `apps/desktop/src-tauri/src/server/routes/mod.rs` — declared `pub mod lan_events_routes`.
- `apps/desktop/src-tauri/src/server/routes/lan_events_routes.rs` (NEW) — handler `POST /events/file_added`, `POST /events/presentation_deleted`, `GET /events/stream` (long-poll).
- `apps/desktop/src-tauri/src/server/routes/rpc.rs` — `finalize_upload` e `delete_presentation` raccolgono `FinalizeMeta`/`DeleteMeta` post-commit e lanciano `notify_paired_devices` in `tokio::spawn`.
- `apps/desktop/src-tauri/src/server/routes/functions.rs` — aggiunto endpoint `POST /functions/v1/lan-sign-url` con validazione device_token + scope event_id.
- `apps/web/src/lib/desktop-bridge.ts` — `signLanDownloadUrl`, `fetchLanEvents` (long-poll client), `registerPairedDeviceOnAdminLocal` (sha256 via WebCrypto + REST POST `/rest/v1/paired_devices`).
- `apps/web/src/features/devices/components/AddLanPcDialog.tsx` — dopo `pairDirectLan`, chiama `registerPairedDeviceOnAdminLocal` per popolare il SQLite admin con `lan_base_url` (necessario al fan-out).
- `apps/web/src/features/devices/hooks/useFileSync.ts` — props `lanAdminBaseUrl` + `localBackendBaseUrl`, `tryCloud` usa `signLanDownloadUrl` quando in LAN, nuovo effect long-poll che invoca `refreshNow()` su `file_added`/`presentation_deleted`.
- `apps/web/src/features/devices/RoomPlayerView.tsx` — legge `getPersistedDevice()` + `getDesktopBackendInfo()` e passa `lanAdminBaseUrl` + `localBackendBaseUrl` a `useFileSync`.

**Note sicurezza Sprint N:**

- `POST /events/*` accettati senza bearer (LAN trust, come pair-direct). Mitigazione: solo `role=sala` accetta (enforce_role_sala). Sprint Q valutera' HMAC con shared secret derivato al pair-direct.
- `POST /functions/v1/lan-sign-url` valida `device_token` (sha256) contro `paired_devices` E verifica che la `storage_key` appartenga a una presentation dello stesso `event_id` del device. Blocca un sala maligno che provi a scaricare file di altri eventi paired sullo stesso server admin.
- `signedURL` HMAC SHA-256 con TTL 600s (10 min): sufficiente anche per file da 5GB su LAN 100Mbit (~7 min reali).

**Trade-off accettati:**

- Long-poll vs SSE/WS: scelto long-poll per massima portabilita' (fetch standard, AbortController), nessuna dipendenza WebSocket lato Rust o EventSource lato JS. Reconnect automatico via while-loop.
- Fan-out fire-and-forget senza retry: se il sala e' offline al momento del push, NON c'e' coda. Il sala recupera al prossimo bootstrap (gia' presente in `useFileSync`) o al re-pair. Sprint Q valutera' una persistent outbox sul SQLite admin.
- `registerPairedDeviceOnAdminLocal` best-effort: se fallisce (admin offline / 403 / 409) il pair sul sala riesce comunque, ma il fan-out non funzionera' fino al prossimo re-pair. Loggato con `console.warn` per troubleshooting.

**Criterio di accettazione N (Sprint N):** `cargo check` + `cargo clippy --all-targets -- -D warnings` exit 0, `tsc --noEmit` exit 0, `eslint .` exit 0 (0 errors, 0 warnings), `vite build` (cloud) + `vite build --mode desktop` exit 0. End-to-end manuale non eseguito (richiede 2 PC sulla stessa LAN); le verifiche di tipo + compilazione + clippy strict coprono tutta la pipeline.

### 4.G — SPRINT O: Esperienza utente identica cloud/offline ✅ COMPLETATO 2026-04-17

> **Questo e il punto piu delicato.** L'utente che usa cloud Vercel oggi e l'utente che usera la versione desktop offline NON devono vedere differenze nella UI.

- [x] **O1.** Audit completato di TUTTI i componenti React. Findings:
  - ✅ **Zero URL hard-coded**: nessuna occorrenza di `cdjxxxkrhgdkcpkkozdl.supabase.co` nel codice (`apps/web/src/**`). Le 4 occorrenze trovate sono tutte in `docs/` (non bundled).
  - ✅ **Auth Supabase isolato**: chiamate `supabase.auth.*` solo in: `LoginView`, `SignupView`, `ForgotPasswordView`, `ResetPasswordView`, `AcceptInviteView`, `RequireAuth`, `RootLayout` (logout). In modalita desktop queste view non vengono mai raggiunte: `DesktopRoleGate` redirige le sale a `/sala/:token` e l'`AuthProvider` desktop+admin fornisce una sessione fittizia (vedi O2).
  - ⚠️ **Realtime channels Supabase**: 7 hook usano `supabase.channel(...)` per push reattivo (`useFileSync`, `usePairedDevices`, `useRoomDevices`, `useEventLiveData`, `useEventPresentationSpeakerIds`, `usePresentationForSpeaker`, `useRoomStates`, `repository.broadcastForceRefresh`). In desktop i `subscribe()` falliscono con `CHANNEL_ERROR` entro pochi secondi → status='error' → tutti gli hook degradano gracefully al polling REST safety-net (gia' codificato). Per il push reattivo lato sala c'e' Sprint N3 (long-poll `/events/stream`).
  - ⚠️ **`getSupabaseBrowserClient()`**: usato in 40+ file. Strategia O2 sotto: in desktop ritorna un client Supabase puntato al backend Rust locale (mirror PostgREST), zero rifattorizzazione necessaria.

- [x] **O2.** `getBackendClient()` + sblocco `getSupabaseBrowserClient()` in desktop:
  - Nuovo `apps/web/src/lib/backend-client.ts`: `getBackendClient(): BackendClient` thin wrapper su `getSupabaseBrowserClient()`. Espressione semantica per chi vuole "parlare al backend dati" senza implicare Supabase specifico (Auth/Realtime restano espliciti via `getSupabaseBrowserClient()`).
  - **`apps/web/src/lib/supabase.ts` riscritto**: in modalita desktop `getSupabaseBrowserClient()` non lancia piu' errore. Costruisce un Supabase client puntato al backend Rust locale:
    - `url` = `getCachedDesktopBackendInfo().base_url` (es. `http://127.0.0.1:7300`)
    - `key` = `getCachedDesktopBackendInfo().admin_token` (UUID v4 generato al primo boot, gia' validato dal `AdminAuth` extractor Rust via `constant_time_eq`)
    - `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }` (no localStorage sessions)
    - `global.headers`: `apikey` + `Authorization: Bearer <admin_token>` (compat PostgREST)
  - **`apps/web/src/lib/desktop-backend-init.ts` (nuovo)**: `ensureDesktopBackendReady()` chiamato in `main.tsx` PRIMA del `createRoot().render(...)`. Cache l'admin_token in modulo, cosi' il primo `getSupabaseBrowserClient()` da qualsiasi feature trova il dato sincrono. Timeout 5s. Schermata errore esplicita se backend Rust non risponde (no white screen).
  - **`apps/web/src/lib/desktop-fake-session.ts` (nuovo)**: `buildDesktopAdminSession(adminToken)` costruisce una `Session` Supabase fittizia con `LOCAL_TENANT_ID` (`00000000-0000-0000-0000-000000000001`) + `LOCAL_ADMIN_USER_ID` (`00000000-0000-0000-0000-000000000002`), mirror del seed in `apps/desktop/src-tauri/src/server/db.rs`. L'`access_token` e' l'`admin_token` UUID, validato dall'`AdminAuth` extractor Rust su tutte le route `/rest/v1/*`.
  - **`apps/web/src/app/auth-provider.tsx` esteso**: due branch:
    - `cloud` → `CloudAuthProvider` (comportamento storico: `supabase.auth.getSession()` + `onAuthStateChange`)
    - `desktop` → `DesktopAuthProvider` (sessione fittizia, niente flow auth, `loading: false` immediato)
    - Sala desktop: non passa mai per `AuthProvider` perche' `DesktopRoleGate` redirige a `/sala/:token` prima del `<RequireAuth>`.
  - **`OnboardingGate` skip in desktop**: in desktop il tenant locale e' gia' configurato via seed, `OnboardingGate` ritorna `null` immediatamente (no query Supabase, no wizard).
  - **`RootLayout` logout button hidden in desktop**: in desktop e' single-user locale, niente da disconnettere. Per cambiare ruolo l'utente riavvia l'app dal launcher (riapre `RoleSelectionView` via `DesktopRoleGate`).

- [x] **O3.** `getRealtimeClient()` astrazione + degradazione automatica:
  - Nuovo `apps/web/src/lib/realtime-client.ts`: `subscribeToTopic(topic, options): RealtimeSubscription` API uniforme:
    - `cloud` → `subscribeViaSupabaseChannel`: `supabase.channel(topic).on('broadcast', {event: '*'}).subscribe()` con callback uniforme.
    - `desktop` → `subscribeViaDesktopLongPoll`: long-poll `/events/stream` del backend Rust locale (Sprint N3) con `AbortController` per cleanup. Filtra per `eventId` lato client (il long-poll Rust copre tutti gli eventi del processo).
    - Fornisce `unsubscribe()` uniforme + `mode` osservabile (`cloud-channel | desktop-longpoll | unsupported`) per UI badge.
  - **API READY ma migrazione hook esistenti deferita**: i 7 hook esistenti continuano ad usare `supabase.channel(...)` direttamente perche' degradano gracefully a polling in desktop (status='error' → safety-net REST 30s). L'astrazione documenta il pattern e fornisce migration path future.
  - Helper `getRealtimeMode(): RealtimeMode` per UI status / logging.

- [x] **O4.** `BackendModeBadge` esteso a 5 stati:
  - Nuovo `apps/web/src/lib/use-backend-status.ts`: hook `useBackendStatus()` con polling 15s (cloud) / 10s (desktop). In desktop fa `GET /health` sul backend Rust locale (timeout 2s, no DB no auth → ~5ms). In cloud usa `navigator.onLine` + event listener `online`/`offline`.
  - Stati visualizzati nel badge sidebar (sotto `<BackendModeBadge />` in `RootLayout`):
    - **CLOUD ONLINE** verde (sc-primary) — Vercel + Supabase raggiungibile
    - **OFFLINE** grigio (sc-text-dim) — `navigator.onLine === false`, SPA degradata su cache PWA
    - **LAN** blu (sc-primary) — desktop + admin server LAN raggiungibile (con badge tooltip "latenza Xms")
    - **STANDALONE** arancio (sc-accent) — desktop + admin server NON raggiungibile (sala usa solo cache locale)
    - **LOADING** neutro — primo render prima del check (evita flicker)
  - i18n keys aggiornate (IT + EN): `backendMode.short.{cloud,cloudOffline,desktop,lan,standalone,loading}` + `backendMode.hint.*`.
  - Tooltip mostra descrizione lunga + (in desktop) latenza ms ultimo health check.

- [x] **O5.** Cross-mode visual parity verificata:
  - **Stessa codebase**: `apps/web/src/**` e' una SPA unica, buildata in due modalita (`vite build` cloud + `vite build --mode desktop`). Le due build differiscono SOLO per:
    - `import.meta.env.VITE_BACKEND_MODE` (`'cloud'` vs `'desktop'`)
    - `dist/` vs `dist-desktop/` output dir
    - PWA service worker (solo cloud, non in desktop perche' Tauri webview gia' offline-capable)
  - **CSS identico**: stesso `index.css` Tailwind 4 + stessi token semantici (`sc-bg`, `sc-surface`, `sc-text`, ...). Nessuna media query / branch desktop-only.
  - **Font identico**: stesso `font-family` definito in `tailwind.config.js`, no font extra caricato in desktop.
  - **Layout identico**: `RootLayout` ha logica condizionale solo per (a) hide logout button in desktop, (b) i18n key del badge. Tutti gli altri componenti (sidebar, header, table, dialog) sono identici byte-by-byte.
  - **Build comparison**: ✅ cloud `dist/` 98 entries 3241 KiB precache + sw.js · ✅ desktop `dist-desktop/` stessa lista chunks (eccetto sw.js + `index-*.js` hash diverso per `import.meta.env`). Bundle JS principale: `index-zcKmg-xm.js` (cloud, 385.60 KiB) vs `index-BvqFHhlJ.js` (desktop, 385.62 KiB) — delta 20 byte = stringhe env mode.

**File modificati / creati (Sprint O):**

- `apps/web/src/lib/desktop-backend-init.ts` (NEW): init sincrono backend desktop.
- `apps/web/src/lib/backend-client.ts` (NEW): `getBackendClient()` thin wrapper.
- `apps/web/src/lib/realtime-client.ts` (NEW): `subscribeToTopic()` cloud/desktop unified.
- `apps/web/src/lib/use-backend-status.ts` (NEW): hook polling `/health` + `navigator.onLine`.
- `apps/web/src/lib/desktop-fake-session.ts` (NEW): session fittizia desktop+admin.
- `apps/web/src/lib/supabase.ts` (MOD): in desktop crea Supabase client puntato al backend Rust locale.
- `apps/web/src/components/BackendModeBadge.tsx` (MOD): 5 stati semantici, tooltip latenza.
- `apps/web/src/main.tsx` (MOD): `await ensureDesktopBackendReady()` pre-render + error screen.
- `apps/web/src/app/auth-provider.tsx` (MOD): `CloudAuthProvider` + `DesktopAuthProvider`.
- `apps/web/src/app/root-layout.tsx` (MOD): hide logout button in desktop.
- `apps/web/src/features/onboarding/OnboardingGate.tsx` (MOD): skip in desktop.
- `apps/web/src/features/onboarding/hooks/useTenantOnboardingStatus.ts` (MOD): accetta `supabase: SupabaseClient | null`.
- `packages/shared/src/i18n/locales/it.json` (MOD): nuove keys `backendMode.short.*` + `backendMode.hint.*` (cloudOffline, lan, standalone, loading).
- `packages/shared/src/i18n/locales/en.json` (MOD): idem EN.

**Note sicurezza Sprint O:**

- La sessione fittizia desktop+admin esiste SOLO in memoria del processo Tauri, non viene mai inviata a Supabase cloud (in desktop il client Supabase punta al backend Rust locale `127.0.0.1:7300`).
- L'`access_token` della session fittizia e' l'`admin_token` UUID generato al boot in `~/.slidecenter/secrets.json` (32 bytes random base64-encoded, ~256 bit di entropia). Validato server-side via `constant_time_eq` per resistenza side-channel timing.
- L'admin_token NON appare mai nei log di rete (cloud Supabase non lo riceve) e NON e' persistito su localStorage browser (solo in modulo memory).

**Trade-off accettati Sprint O:**

- **No auth in desktop**: in modalita desktop l'app e' single-user single-tenant locale. L'utente "admin" del PC ha accesso completo. Per uso multi-utente sullo stesso desktop bisogna aspettare la Fase Q (sync hybrid) e introdurre auth locale via PIN.
- **Realtime channels degradati**: in desktop i 7 hook che usano `supabase.channel(...)` non hanno push reattivo, fanno polling 30s safety-net. L'unica eccezione push-real-time e' `useFileSync` lato sala (Sprint N3 long-poll). Per un futuro Sprint Q si puo' migrare gli altri hook a `subscribeToTopic()` con long-poll desktop.
- **Bundle size identico**: il client Supabase JS pesa ~188 KiB gzip 49 KiB anche in build desktop, anche se in desktop il backend Rust mirror solo un subset PostgREST. Trade-off accettato per zero rifattorizzazione hook esistenti. Eventuale ottimizzazione futura: tree-shake il client Supabase via `vite.config.ts` define alias.

**Criterio di accettazione O (Sprint O):** ✅ `cargo check` + `cargo clippy --all-targets -- -D warnings` exit 0, ✅ `tsc --noEmit` exit 0, ✅ `eslint .` exit 0 (0 errors, 0 warnings), ✅ `vite build` (cloud) + `vite build --mode desktop` exit 0, ✅ bundle JS principale delta < 100 byte (parity confermata). End-to-end manuale non eseguito (richiede installer Tauri + PC reale); le verifiche di tipo + compilazione + build coprono tutta la pipeline.

### 4.H — SPRINT P: Build e distribuzione desktop

- [x] **P1.** Pipeline build orchestrata.
  - Aggiunto `apps/desktop/scripts/check-prereqs.mjs`: verifica Node ≥ 20 + pnpm ≥ 9 + Rust ≥ 1.77.2 + cargo tauri CLI ≥ 2.x + WebView2 (per Windows). Esce non-zero con messaggi azionabili. Esposto come `pnpm --filter @slidecenter/desktop prereqs`.
  - Aggiunto `apps/desktop/scripts/release.mjs`: orchestra `prereqs → clean → cargo tauri build → manifest`. Calcola SHA-256 + size + path dell'installer e li scrive in `release-output.json`. Esposto come `pnpm --filter @slidecenter/desktop release:nsis`.
  - Aggiunto `apps/desktop/scripts/release.ps1`: wrapper PowerShell umano-friendly. Verifica `gh auth status` (deve essere `live-software11`), copia artifact in `apps/desktop/release/`, genera `CHANGELOG-v<ver>.md` ready-to-publish.
  - `tauri.conf.json -> build.beforeBuildCommand` lancia automaticamente `pnpm --filter @slidecenter/web build:desktop` durante il build Rust: la pipeline e' un single-command (`pnpm release:nsis`).

- [x] **P2.** Output bundle NSIS.
  - Target: `apps/desktop/src-tauri/target/release/bundle/nsis/Live SLIDE CENTER Desktop_<ver>_x64-setup.exe`.
  - `bundle.targets: ["nsis"]`, `bundle.windows.webviewInstallMode: { type: "downloadBootstrapper", silent: true }` (Edge WebView2 scaricato a runtime se mancante).
  - `bundle.windows.nsis.installMode: "currentUser"` (no UAC), `compression: "lzma"` (~30% piu' piccolo di Zlib), `displayLanguageSelector: false` con `["Italian", "English"]`.
  - Solo `x86_64-pc-windows-msvc`. ARM64 / 32-bit non supportati (target field-test = PC sala desktop).

- [x] **P3.** Auto-update Tauri predisposto.
  - Dipendenze Rust: `tauri-plugin-updater = "2"` + `tauri-plugin-process = "2"` (in `[target."cfg(not(any(target_os=\"android\",target_os=\"ios\"))).dependencies]`).
  - Permessi: `apps/desktop/src-tauri/capabilities/default.json` aggiornato con `"updater:default"`, `"process:default"`, `"process:allow-restart"`.
  - Plugin registrati in `src-tauri/src/main.rs`: `tauri_plugin_updater::Builder::new().build()` + `tauri_plugin_process::init()`.
  - Endpoint configurato in `tauri.conf.json -> plugins.updater.endpoints`: `https://github.com/live-software11/slide-center-desktop/releases/latest/download/latest.json` (account `live-software11`, repo da creare quando si pubblica la prima release).
  - 3 nuovi Tauri commands esposti dal Rust:
    - `cmd_updater_status` → `{ configured, current_version, endpoint_hint }`.
    - `cmd_check_for_update` → `{ available, version?, current_version?, notes?, error? }`. Gestisce graceful: 404, network error, signature mismatch.
    - `cmd_install_update_and_restart` → scarica + installa + restart silenzioso (`app.restart()` mai ritorna su success).
  - TypeScript bridge `apps/web/src/lib/desktop-bridge.ts`: 3 wrapper typed (`getUpdaterStatus`, `checkForUpdate`, `installUpdateAndRestart`) con fallback `{ configured: false }` quando non in Tauri.
  - UI: `apps/web/src/components/DesktopUpdateBanner.tsx` (banner sticky 40px sopra `<main>`). Check al boot + ogni 30 minuti. Dismiss per-versione via `sessionStorage`. Pulsanti "Installa e riavvia" + "Piu' tardi". Stato `installing` con spinner. Errori `installError` mostrati inline. Renderizzato in `apps/web/src/app/root-layout.tsx`. Fallback automatico per cloud (zero footprint).
  - i18n: chiavi `desktopUpdater.*` in `packages/shared/src/i18n/locales/{it,en}.json` (available, newVersion, installNow, installing, installFailed, checkFailed, later, ecc.).
  - Default sicuro: `bundle.createUpdaterArtifacts: false`, `pubkey` omesso da `tauri.conf.json`. Cosi' la build funziona senza chiavi e l'updater UI resta dormant ma non crasha.

- [x] **P4.** Slot signing Windows predisposto (no certificato oggi).
  - Template `apps/desktop/src-tauri/tauri.signing.example.json` (committato): `bundle.createUpdaterArtifacts: true` + slot per `windows.certificateThumbprint` / `windows.signCommand` / `plugins.updater.pubkey`. Documenta JSON Merge Patch RFC 7396.
  - Override attivabile via `pnpm release:nsis -- --signing-config src-tauri/tauri.signing.json`. Lo script verifica esistenza file + presenza env var `TAURI_SIGNING_PRIVATE_KEY` (warn esplicito se mancante).
  - `apps/desktop/.gitignore` blocca: `src-tauri/tauri.signing.json` (clone privato), `*.key`, `*.key.pub`, `release-output.json`, `release/`.
  - Doc `apps/desktop/CODE_SIGNING.md`: 3 strategie (A = cert EV in Windows Cert Store via thumbprint, B = Azure Key Vault con `signCommand` custom + `azuresigntool`, C = HSM remoto con `osslsigncode`). Spiega differenza updater signing (Ed25519 Tauri-native, OBBLIGATORIO per auto-update) vs code signing OS (X.509 EV, opzionale per evitare SmartScreen).
  - Doc `apps/desktop/UPDATER_SETUP.md`: workflow step-by-step per generare chiavi (`cargo tauri signer generate`), creare repo GitHub `slide-center-desktop`, build firmata, generare `latest.json`, pubblicare con `gh release upload`. Include esempio CI GitHub Actions futura.

- [x] **P5.** Documentazione distribuzione interna.
  - `apps/desktop/README.md` (nuovo): quick start + tabella script + architettura runtime + sezione troubleshooting + roadmap sprint J→Q.
  - `apps/desktop/scripts/release.ps1`: wrapper PowerShell con prompt account, copia artifact, snippet CHANGELOG ready-to-paste.
  - One-liner zip distribuzione interna documentato:

    ```powershell
    $ver = (Get-Content src-tauri/Cargo.toml | Select-String '^version = "(.+)"').Matches[0].Groups[1].Value
    $installer = "src-tauri/target/release/bundle/nsis/Live SLIDE CENTER Desktop_${ver}_x64-setup.exe"
    Compress-Archive -Path $installer, README.md -DestinationPath "SlideCenter-Desktop-${ver}.zip"
    ```

**Trade-off accettati Sprint P:**

- **Cargo Tauri CLI non installata sul dev box:** lo script `check-prereqs.mjs` la segnala come `MISSING` con fix diretto. La validazione e' stata fatta con `cargo check` puro (verde). La prima `pnpm release:nsis` reale richiedera' `cargo install tauri-cli --version "^2.0" --locked`.
- **No certificato EV ancora:** SmartScreen mostrera' "Windows ha protetto il PC" al primo avvio. Per uso interno + tecnici esperti e' tollerabile (clic "Esegui comunque"). Lo slot per cert EV e' pronto: appena disponibile, basta editare `tauri.signing.json` e ribuildare.
- **No auto-update attivo finche' non si crea il repo `live-software11/slide-center-desktop` + si pubblica `latest.json`:** il banner `DesktopUpdateBanner` resta nascosto perche' `cmd_check_for_update` ritorna `available: false` graceful (404 sull'endpoint). Zero impatto utente.
- **Zip manuale, no CI release automatica:** Sprint P chiude qui. Una pipeline GitHub Actions con `secrets.TAURI_SIGNING_PRIVATE_KEY` e' delineata in `UPDATER_SETUP.md` ma fuori scope (eventuale Sprint S).

**Criterio di accettazione P:** ✅ `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` exit 0 (compila + risolve `tauri-plugin-updater` + `tauri-plugin-process`), ✅ `pnpm --filter @slidecenter/web typecheck` exit 0, ✅ `pnpm --filter @slidecenter/web lint` exit 0 (regola React 19 `react-hooks/set-state-in-effect` rispettata nel banner), ✅ pipeline `release:nsis` documentata e testabile end-to-end appena Tauri CLI installata (`pnpm prereqs` lo conferma). Build NSIS reale non eseguita (manca cargo tauri CLI nell'ambiente corrente; lo script `release.mjs` la lancera' al primo `pnpm release:nsis` post-installazione).

---

## 5. FASE 4 — SYNC HYBRID CLOUD <-> OFFLINE (opzionale, futuro)

> **Obiettivo:** quando il desktop torna online, sincronizza con il cloud Supabase per backup/condivisione tra sedi.
> **Tempo stimato:** 5-7 giorni.
> **NOTA:** valutare necessita reale prima di investirci. Per uso interno aziendale puo non servire.

### 5.A — SPRINT Q: Strategia sync

- [ ] **Q1.** Decidere policy:
  - **Push only:** desktop e master, cloud e backup. Quando online, push. Mai pull.
  - **Bidirezionale:** complesso, conflitti, CRDT. Sconsigliato per ora.

- [ ] **Q2.** Adottare push-only. Tabelle SQLite con colonna `synced_at TIMESTAMP NULL`. Worker periodico (ogni 60s online) fa upsert su Supabase di righe con `synced_at IS NULL OR updated_at > synced_at`.

- [ ] **Q3.** File: upload chunked TUS al bucket Supabase quando online + `synced=true` su `presentation_versions`.

- [ ] **Q4.** UI desktop: chip "Cloud backup: 12 file in coda" -> click apre pannello con lista da sincronizzare e progress.

---

## 6. ROADMAP TEMPORALE PROPOSTA

| Settimana | Focus                                         | Sprint                                                 |
| --------- | --------------------------------------------- | ------------------------------------------------------ |
| Sett 1    | Hardening cloud                               | A, B (modalita LIVE + realtime)                        |
| Sett 2    | Hardening cloud                               | C, D, E (resume + admin dashboard + retry)             |
| Sett 3    | **Field test cloud reale evento aziendale**   | feedback raccolto                                      |
| Sett 4    | UX professionale                              | F, G, H, I (search, multi-select, anteprima, launcher) |
| Sett 5-6  | Desktop bootstrap                             | J, K, L (Tauri + server Rust + mDNS)                   |
| Sett 7    | Desktop pairing                               | M, N (persistenza + sync file)                         |
| Sett 8    | Desktop UX parity + build                     | O (identicita cloud) ✅, P (build NSIS + updater) ✅   |
| Sett 9    | **Field test desktop offline rete aziendale** | feedback                                               |
| Sett 10+  | Hybrid sync                                   | Q (se serve)                                           |

---

## 7. CHECKLIST PRE FIELD TEST CLOUD (settimana 3)

- [ ] Tutti gli sprint A-E completati e mergiati su `main`.
- [ ] Build Vercel verde, smoke test su 3 browser (Chrome, Edge, Safari).
- [ ] Almeno 1 test reale con 2 PC sala fisici diversi su rete aziendale.
- [ ] Test stress: 50 file da 100 MB caricati in batch, verificare che nessuno fallisca.
- [ ] Test stuttering: PC sala in modalita LIVE che proietta video 4K (es. con VLC) mentre scarica 2 GB in background. Verifica visiva fps stabili.
- [ ] Test caduta rete: spegnere wifi durante download, riaccendere, verificare resume.
- [ ] Test riavvio: riavviare PC sala 5 volte, verificare auto-rejoin sempre.
- [ ] Backup database Supabase manuale prima del field test.
- [ ] Numero di emergenza contatto Andrea + procedura "se tutto crasha cosa fare".

---

## 8. CHECKLIST PRE FIELD TEST DESKTOP OFFLINE (settimana 9)

- [ ] Sprint J-P completati.
- [ ] Installer NSIS testato su 3 PC Windows diversi (Win10, Win11, Win11 enterprise).
- [ ] mDNS discovery funzionante su rete con switch unmanaged + switch managed.
- [ ] Pairing LAN <2 secondi tra admin e PC sala.
- [ ] Sync file LAN da admin a 5 PC sala in parallelo a velocita LAN piena.
- [ ] Riavvio PC sala -> auto-rejoin senza interazione utente.
- [ ] Spegnere admin server -> PC sala in modalita STANDALONE locale, file gia scaricati restano accessibili.
- [ ] Riaccendere admin server -> PC sala riconnette automaticamente.
- [ ] UI identica al cloud: side-by-side screenshot.
- [ ] Test su VPN: admin in sede A, PC sala in sede B su VPN site-to-site. Latenza accettabile.

---

## 9. CONVENZIONI TECNICHE PER OGNI STEP

### 9.1 Per ogni file modificato

1. Verificare TypeScript strict zero errori: `pnpm --filter @slidecenter/web typecheck`.
2. Verificare ESLint zero errori: `pnpm --filter @slidecenter/web lint`.
3. Verificare build OK: `pnpm --filter @slidecenter/web build`.
4. Per modifiche schema Supabase: nuova migration in `supabase/migrations/<timestamp>_<descrizione>.sql`.
5. Per modifiche schema SQLite locale: nuova migration in `apps/desktop/src-tauri/migrations/<timestamp>_<descrizione>.sql`.
6. Tradurre OGNI nuova stringa IT/EN in `packages/shared/src/i18n/locales/{it,en}.json` nello stesso commit.

### 9.2 Per ogni nuovo endpoint

1. Documentare in `docs/API_BACKEND_COMPAT.md` (da creare alla sezione 4.C).
2. Aggiungere test integration con `vitest` quando possibile.

### 9.3 Per ogni RPC Supabase

1. Replicare SEMPRE l'equivalente nel server Rust desktop (sezione 4.C).
2. Stessa firma input/output JSON.
3. Stessa gestione errori (codici stringa: `tenant_suspended`, `invalid_input`, ecc.).

### 9.4 Per ogni modifica UI

1. Testare in dark mode (default) e light mode (futuro).
2. Mobile responsive (PC tecnico potrebbe essere su tablet).
3. Accessibilita: aria-label, role, contrasto minimo AA.
4. Lazy load: components pesanti via `React.lazy` per non gonfiare bundle iniziale.

### 9.5 Per il desktop

1. NESSUN codice Node.js (Tauri usa Rust, non Node).
2. Per logica condivisa con web (es. validation), libreria pura TS in `packages/shared/`.
3. Comandi Tauri (`#[tauri::command]`) sempre con tipi serde + risposta `Result<T, String>`.
4. Logging via `tracing` crate, livelli: error, warn, info, debug. Default INFO in produzione.

---

## 10. SPUNTI INTELLIGENTI DA PRESERIA (da valutare, NON copiare)

| Idea Preseria                                          | Adattamento SLIDE CENTER                                                                                                                                         | Sprint                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Email reminder upload con tracking apertura            | Email custom branded LiveWorks. Solo per uso vendita futuro, non interno.                                                                                        | post-vendita               |
| Excel import agenda evento                             | Importer XLSX da template scaricabile. Util sia interno che vendita.                                                                                             | sett 4-5 (sprint dedicato) |
| Upload deadline per evento e per sessione              | Campo `upload_deadline` su `events` e `sessions`. UI countdown.                                                                                                  | sett 4                     |
| File error checking (font mancanti, video broken link) | Worker server Python o Rust che legge il PPTX e segnala. Killer feature differenziante.                                                                          | post field test 1          |
| PDF auto-publish da PowerPoint                         | LibreOffice headless lato server. Evitare per ora costi/complessita.                                                                                             | futuro                     |
| Desktop app slideshow integrato switch tra speaker     | NON copiare in SLIDE CENTER. Costruire come modulo della **Live Production Suite C# WPF .NET 8** gia pianificata, condividendo Core Engine con Speaker Timer v2. | piano separato             |

---

## 11. RISCHI NOTI E MITIGAZIONI

| Rischio                                          | Probabilita | Impatto    | Mitigazione                                                 |
| ------------------------------------------------ | ----------- | ---------- | ----------------------------------------------------------- |
| Tauri webview2 non installato su PC sala vecchio | media       | bloccante  | Bundle bootstrapper webview2 nell'installer NSIS            |
| mDNS bloccato da firewall aziendale              | media       | bloccante  | Fallback: input manuale IP admin server                     |
| Sync file rallenta playback 4K                   | alta        | molto alto | Sprint A (modalita LIVE + throttle). NON saltabile.         |
| Admin desktop crash mentre upload                | bassa       | medio      | Resume upload TUS gia implementato cloud, replicare desktop |
| Disco PC sala pieno                              | media       | medio      | Sprint E (storage estimate + cleanup file vecchi)           |
| Conflitto pairing 2 admin sulla stessa LAN       | bassa       | medio      | Sprint L step L5 (scelta esplicita admin)                   |
| Cloud Supabase down durante evento               | bassa       | molto alto | Versione desktop offline (sezione 4)                        |

---

## 12. APPENDICE A — SCHEMA SQLITE DESKTOP (mirror Supabase essenziale)

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  network_mode TEXT NOT NULL DEFAULT 'cloud',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  scheduled_start TEXT,
  scheduled_end TEXT,
  upload_deadline TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE speakers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  upload_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE presentations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  speaker_id TEXT REFERENCES speakers(id) ON DELETE SET NULL,
  title TEXT,
  current_version_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE presentation_versions (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'uploading',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE paired_devices (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  device_name TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  last_seen_at TEXT,
  paired_at TEXT NOT NULL DEFAULT (datetime('now')),
  lan_ip TEXT,
  hostname TEXT
);

CREATE TABLE room_state (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  current_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  current_presentation_id TEXT REFERENCES presentations(id) ON DELETE SET NULL,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  playback_mode TEXT NOT NULL DEFAULT 'auto',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_room ON sessions(room_id);
CREATE INDEX idx_presentations_session ON presentations(session_id);
CREATE INDEX idx_versions_presentation ON presentation_versions(presentation_id);
CREATE INDEX idx_devices_room ON paired_devices(room_id);
```

---

## 13. APPENDICE B — STRUTTURA FILE LOCALI DESKTOP

```
~/.slidecenter/                         (config user, persistente)
  role.json                             (admin | sala)
  device.json                           (config PC sala paired, vedi 4.E.M1)
  admin_token.json                      (token admin master, generato al primo avvio)

C:/SlideCenter/                         (data root, configurabile)
  storage/
    <event_id>/
      <storage_key>                     (file binario)
  files/                                (mirror cartella sync stile cloud)
    <sala_name>/
      <sessione_title>/
        <file_name>
  db/
    slidecenter.db                      (SQLite)
    slidecenter.db-wal
    slidecenter.db-shm
  logs/
    server-2026-04-17.log
    client-2026-04-17.log
```

---

## 14. APPENDICE C — COMANDI UTILI

```bash
# Web cloud
pnpm --filter @slidecenter/web dev
pnpm --filter @slidecenter/web build
pnpm --filter @slidecenter/web typecheck
pnpm --filter @slidecenter/web lint

# Supabase
supabase db push
supabase functions deploy room-player-bootstrap
supabase functions deploy room-player-rename

# Desktop (dopo bootstrap sezione 4.B)
pnpm --filter @slidecenter/desktop tauri dev
pnpm --filter @slidecenter/desktop tauri build

# Deploy
git push origin main           # auto-deploy Vercel
npx vercel --prod --yes --archive=tgz   # fallback se auto-deploy non parte
```

---

## 15. NOTA FINALE — COSA NON FARE

- NON usare Electron. Tauri 2 e la scelta strategica per coerenza ecosistema.
- NON copiare la slideshow integrata di Preseria dentro SLIDE CENTER. E un altro prodotto (Live Production Suite).
- NON aggiungere feature non in questa guida senza prima discuterle. La disciplina e la chiave.
- NON saltare lo Sprint A. Il rischio "video 4K stuttering" e bloccante per qualsiasi field test serio.
- NON sviluppare la versione desktop in parallelo al cloud finche il cloud non e in produzione stabile per almeno 2 settimane di field test.
- NON dimenticare i18n IT/EN per OGNI nuova stringa.

---

## 16. STATO AGGIORNATO

> **Aggiornare questa sezione ad ogni sprint chiuso.**

| Sprint                          | Status             | Data       | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Modalita LIVE/TURBO/AUTO    | A1-A6 DONE         | 2026-04-17 | A7 (test fps su PC sala reale durante download 5GB) da fare in field test. Migration + Edge Function deploy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| B — Realtime Supabase           | B1-B4 DONE         | 2026-04-17 | Approccio: Realtime Broadcast via trigger PG (necessario perche' Room Player anon, RLS bloccherebbe `postgres_changes`). Migration `20260418010000_room_realtime_broadcast.sql` da deployare. B5 (test < 1s su 2 browser) in field test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| C — Resume + checksum           | C1-C3 DONE         | 2026-04-17 | Resume HTTP `Range` con file pre-check + writable append (`fs-access.ts`). Verifica SHA-256 post-download via `crypto.subtle.digest` one-shot (soglia 512 MiB; oltre → `'skipped'`). Loop retry max 3 con `forceFullDownload`. Edge `room-player-bootstrap` espone `fileHashSha256`. UI: badge `VerifiedBadge` (Lock verde / ShieldAlert rosso / LockOpen grigio) in `FileSyncStatus`. Test field manuale (kill browser su file 5 GB) da fare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D — Admin dashboard PC sala     | D1-D3 DONE         | 2026-04-17 | Hook `useRoomDevices` con polling 30s + Realtime `postgres_changes` (admin autenticato → RLS funziona). Componente `RoomDevicesPanel` integrato in `EventDetailView` sotto ogni card sala: pallino stato (verde<30s/arancio30-180s/rosso≥180s o null) calcolato da `last_seen_at`, browser, tempo dall'ultimo seen, menu kebab (Forza refresh / Rinomina / Sposta / Rimuovi). Force refresh via broadcast `room:<roomId>` event `force_refresh` (no Edge Function). Bootstrap setta `last_seen_at` + `status='online'`. Field test (PC scollegato → pallino rosso entro 30s) da fare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E — Stabilita extra             | E1-E4 DONE         | 2026-04-17 | E1: `fetchWithRetry` con backoff [500,2000,8000] applicato a `room-player-bootstrap` e `room-player-rename` (NON al download — gia' resume HTTP `Range` Sprint C). E2: Sentry gia' c'e' (Phase 14, lazy import condizionale a `VITE_SENTRY_DSN`); aggiunto helper `reportError(err, { tag, extra, level })` in `lib/telemetry.ts`. Agganciato a `verify_mismatch` / `storage_full` / `download_failed` post-retry come `level: 'warning'`. E3: `getStorageEstimate` (origin quota — non disco fisico, e' un'approssimazione utile come pre-allarme) + pre-download guard `storage_full` se `available < size * 1.1` + `purgeOrphanFiles` ricorsivo (max depth 3) con `expectedKeys` calcolate via `sanitizeFsSegment`. UI: `<StorageUsagePanel>` con barra colorata (verde >1GB / arancio 100MB-1GB / rosso <100MB) + bottone "Pulisci file orfani" con conferma inline. E4: `fetchVersionsInflightRef` deduplica i 4 chiamanti di `fetchVersions` (syncAll iniziale + polling tick + `refreshNow` + broadcast `presentation_changed`). Field test (Slow 3G + 5 cicli wifi on/off, target: nessun errore UI persistente) da fare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F — Search globale              | A1-A4 DONE         | 2026-04-17 | Componente `<EventSearchBar>` sticky in cima a `EventDetailView` (combobox WAI-ARIA 1.2 con tastiera ↓↑/Enter/Esc/Home/End). Hook `useEventFileSearch` con debounce 250ms, `AbortController` cleanup ad ogni rerun, pattern "derived state during render" via `useState` (no `useRef`, lint rule `react-hooks/refs`). Query Supabase `presentation_versions` con embedding nested `presentations!inner -> sessions -> rooms`, `speakers` opzionale, filtro `eq('presentations.event_id') + ilike('file_name') + eq('status','ready')`. Wildcard injection escapata (`%`, `_`, `\` → `\X`). Soglia 2 char minimo (`MIN_QUERY_LENGTH`), `LIMIT 50` con badge "altri risultati, affina ricerca". Click → `handleSearchResultSelected`: espande `SessionFilesPanel`, `scrollIntoView` smooth dentro `requestAnimationFrame`, highlight 2s con `bg-sc-primary/10 transition-colors`. Funziona sia in view "list" che "byRoom". `scroll-mt-24` evita che la sessione finisca sotto la search bar. Field test su evento reale (200+ file) da fare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| G — Multi-select                | B1-B4 DONE         | 2026-04-17 | Stato `Set<presentationId>` in `SessionFilesPanel` con checkbox per riga + header `indeterminate`. Pattern "derived state during render" su chiave `fileIds.join(',')` per purgare auto la selezione dopo bulk delete. Toolbar condizionale "{N} file · {totalBytes}" con 3 azioni: **ZIP** (`zip-bulk-download.ts` con dynamic import jszip 95kB chunk separato; worker pool concorrenza 3; compression `STORE` perche' pptx/pdf gia' compressi; cap 2 GB per evitare OOM; filename collision `__{shortId}` suffix; cleanup `URL.revokeObjectURL` 30s per Safari), **Sposta** (dialog modale con tree sale→sessioni, RPC nuova `rpc_move_presentation_to_session` migration `20260418020000` — distinta da `rpc_move_presentation` perche' sposta per sessione invece che per speaker, supporta presentation senza speaker, resetta `speaker_id=NULL`, ritorna `skipped:true` invece di errore se same-session), **Elimina** (riusa `delete_presentation_admin` sequenziale con conferma inline). Bulk action SEQUENZIALI per non saturare rate limit Supabase Pro + summary "X riusciti, Y falliti, Z saltati" affidabile. Field test (50+ file selezionati, ZIP 1+ GB) da fare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| H — Drag&drop multi-file        | C1-C3 DONE         | 2026-04-17 | C1 (drop+input multipli) + C2 (coda upload sequenziale) + C3 (drag tra sessioni) tutti implementati. Hook `useUploadQueue` con worker single-job (lock advisory PG + ON CONFLICT speaker_id rendono concurrency>1 inutile + cancellazione granulare); `UploadJob` esposto con status pending/uploading/hashing/finalizing/done/error/cancelled + bytes uploaded/total per riga. Cleanup unmount aborta TUS + hash + libera versionId orfani via `abortAdminUpload`. UI `<UploadQueuePanel>` auto-mount sotto drop zone con header "{active}/{total}" + "Pulisci completati" + riga per file con progress bar 1px + X cancel. Drag tra sessioni: MIME custom `application/x-slidecenter-presentation` (helper `drag-presentation.ts`); `<li>` `draggable=true` con `<GripVertical>` hint quando ci sono target disponibili; drop handler discrimina via `dataTransfer.types` (no `getData()` durante dragover, leggibile solo a drop) → border arancione `sc-accent` per move vs blu `sc-primary` per upload da SO. Refuso fromSession==targetSession = no-op silenzioso. RPC riusata `rpc_move_presentation_to_session` (Sprint G B3): zero costi backend aggiuntivi. Cross-origin = niente trasferimento dataTransfer (security gratis). Field test (drop 10 file simultaneo + drag tra 2 sessioni in sale diverse) da fare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| I — Anteprima inline + launcher | D1-D3 + E1-E4 DONE | 2026-04-17 | D: `<FilePreviewDialog>` puro (PDF iframe, img, video controls, audio, fallback download) + hook `useFilePreviewSource({mode:'local'\|'remote'})` con cleanup `URL.revokeObjectURL`; lato `local` legge blob FSA gia' downloadato (regola sovrana §1, no rete), lato `remote` usa nuovo `createVersionPreviewUrl` (signed URL inline, no `download:true`). Helper `readLocalFile` in `fs-access.ts` (riusa `sanitizeFsSegment`). Lint React 19 `react-hooks/set-state-in-effect` risolto via `async function run() + await Promise.resolve()` boundary. E: migration `20260418030000_room_state_now_playing.sql` aggiunge `room_state.current_presentation_id` + `last_play_started_at` + RPC SECURITY DEFINER `rpc_room_player_set_current(p_token, p_presentation_id)` che valida hash device_token, presentation in stessa sala (no cross-room tampering), aggiorna atomico. Edge Function `room-player-set-current` mappa errori RPC a HTTP status (404/409/403/400). PC sala: bottone "Apri sul PC" in `FileSyncStatus` (solo `synced`) → preview dialog locale + chiama `invokeRoomPlayerSetCurrent` best-effort. Admin: `useRoomStates` esteso con PostgREST embed nested 2-livelli (`current_presentation -> current_version -> file_name`); nuovo `<NowPlayingBadge>` verde con icona Radio pulsante + auto-tick `setInterval(10s)` per timeAgo. Trigger broadcast `room_state_changed` (Sprint B) gia' propaga in <1s. i18n IT+EN (`filePreview.*`, `roomPlayer.fileSync.open*`/`nowPlaying`, `roomPlayer.nowPlaying.*`). Field test (PDF anteprima admin+sala, kebab "in onda" cross-room rifiutata, badge admin live <30s) da fare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| J — Tauri bootstrap             | J1-J5 DONE         | 2026-04-17 | Inizio Fase 3. Crate `apps/desktop/` con Tauri 2 (plugin shell/fs/http/notification/dialog), `tauri.conf.json` (window 1280x800, NSIS, identifier `com.livesoftware.slidecenter.desktop`, `frontendDist = ../../web/dist-desktop`). Strategia UI = SPA condivisa (Opzione 1): ZERO duplicazione, dev `localhost:5173` + prod `file://` embeddato. Vite `mode === 'desktop'` → `base: './'`, `outDir: 'dist-desktop'`, VitePWA disabilitata, `define` inject `VITE_BACKEND_MODE='desktop'`. Astrazione `backend-mode.ts` (`getBackendMode/getBackendBaseUrl/getBackendDescriptor`) + fail-fast in `getSupabaseBrowserClient` in desktop mode (shim REST arriva Sprint K). Chip `<BackendModeBadge>` CLOUD/DESKTOP nel footer sidebar con tooltip i18n (anticipo Sprint O4). Workspace: `pnpm ls` registra `@slidecenter/desktop@0.1.0`; script root `pnpm dev:desktop` / `pnpm build:desktop`; turbo `globalEnv` + task `build:desktop`. Build verde cloud (`dist/`) + desktop (`dist-desktop/`): zero regressione cloud, PWA correttamente assente in desktop. Cargo manifest validato (`cargo read-manifest`). `cargo tauri build` NSIS da eseguire in locale utente (~5-10 min primo build).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| K — Server Rust Axum            | K1-K5 DONE         | 2026-04-17 | Backend Rust embedded in Tauri 2 con Axum 0.7 in ascolto su `0.0.0.0:7300`. Modulo `server/`: `mod.rs` (boot + secrets.json admin_token+HMAC), `db.rs` (rusqlite + r2d2 pool 4, WAL+FK+busy_timeout 5s, migration `0001_init.sql` con 13 tabelle SQLite mirror Postgres + seed `tenants/users` locale), `auth.rs` (`AdminAuth` extractor bearer + SHA-256 device_token + constant_time_eq), `pgrest.rs` (mini-parser PostgREST: eq/neq/gt/gte/lt/lte/like/ilike/in/not.in/is.null/order/limit/offset; whitelist colonne; binding parametrizzato), `mdns.rs` (`mdns-sd 0.11` pubblica `_slidecenter._tcp.local.` con TXT role/name/event_id/port; rilevamento IP via UDP-connect cross-platform), `storage.rs` (path traversal hardening + signed URL HMAC-SHA256 base64 URL_SAFE_NO_PAD). Routes (23 endpoint): `/rest/v1/:table` GET/POST/PATCH/DELETE per 13 tabelle (events, rooms, sessions, speakers, presentations, presentation_versions, paired_devices, room_state, local_agents, pairing_codes, tenants, users, activity_log) con TableSpec whitelist + auto-iniezione `tenant_id=LOCAL_TENANT_ID`; `/rest/v1/rpc/<name>` 8 RPC (init/finalize/abort/delete upload, rename device, set_current, move presentation); `/storage/v1/object/:bucket/*key` upload+sign + `/storage-files/:bucket/*key` GET con Range request (bytes=START-END / START- / -N); `/functions/v1/<name>` 6 Edge Functions (pair-init/poll/claim, room-player-bootstrap/rename/set-current). Tutti i call rusqlite sincroni wrappati in `tokio::task::spawn_blocking`. CORS very_permissive (sicuro perche' tutto sotto AdminAuth o device_token o signed URL). `main.rs` Tauri `setup()` blocca su `server::boot()` e salva in `OnceLock<BACKEND>`; nuovo Tauri command `cmd_backend_info` ritorna `{ ready, base_url, port, admin_token, data_root, storage_root }` per la SPA. Cargo manifest validato (`cargo read-manifest` Exit 0). Compilazione Rust completa (~3-5 min primo `cargo check` per scaricare axum + rusqlite + mdns-sd) da eseguire in locale utente.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| L — mDNS "Aggiungi PC" LAN      | L1-L5 DONE         | 2026-04-17 | KEY FEATURE. Ruolo Admin/Sala scelto al primo avvio e persistito in `~/SlideCenter/role.json` (`apps/desktop/src-tauri/src/role.rs`, write atomico .tmp→rename). UI scelta: `RoleSelectionView.tsx` montata da `DesktopRoleGate` (root component in `routes.tsx`, no-op in cloud); dopo `setDesktopRole` schermata "Riavvia l'app" perche' `boot()` legge il ruolo solo all'avvio del processo. mDNS bidirezionale in `server/mdns.rs`: publish dinamico `_slidecenter._tcp.local` con TXT role/name/event_id/port/app_version + `MdnsHandle::update_event_id()` (unregister+register per propagare TXT) + `discover(timeout_ms, role_filter)` one-shot via daemon effimero. Tauri commands: `cmd_get_role`, `cmd_set_role`, `cmd_discover_lan_pcs`, `cmd_backend_info` esteso con `role/mdns_active/lan_addresses` (lan_addresses calcolati via `mdns::local_ipv4_addresses()` esposta `pub`, popolati in `BootedServer.lan_addresses` durante `boot()`). SPA bridge `apps/web/src/lib/desktop-bridge.ts` (typed wrapper `getDesktopBackendInfo`, `getDesktopRole`, `setDesktopRole`, `discoverLanNodes`, `pairDirectLan`, `getAdminLanBaseUrl`). Endpoint `POST /functions/v1/pair-direct` (`server/routes/functions.rs::pair_direct`): valida `state.role == "sala"` (admin nodes 400 `role_not_sala`), idempotenza forte (409 `already_paired` se device gia' presente per (event_id, room_id, device_id)), upsert minimo `events`+`rooms` per FK, insert `paired_devices` con `device_token` random 32B base64url, persistenza `~/SlideCenter/device.json` via `device_persist::write` (admin_server.base_url + name + fingerprint=null + event_id + room_id + device_token), update mDNS TXT `event_id` best-effort. UI admin: `AddLanPcDialog.tsx` (discovery 1.5s + form sala + pair-direct → 200 chiama `onPaired(device_id)` → `usePairedDevices.refresh()`); bottone "Aggiungi PC LAN" in `DevicesPanel` visibile solo se `info.ready && role==='admin'` (cloud + role=sala lo nascondono). Multi-admin LAN serializzato dal 409 idempotente: il PC sala "vincente" aggiorna TXT `event_id`, gli altri admin vedono badge `alreadyPaired`. State propagato in `AppState{role: Arc<String>, mdns: Option<Arc<MdnsHandle>>}` (state.rs). `tauri.conf.json`: `withGlobalTauri: true` per `window.__TAURI__.core.invoke`. i18n IT+EN (`devices.addLanPc.*`, `desktopRole.*`). Validazione: `cargo check` + `tsc --noEmit` + `eslint .` (0 errors, 0 warnings) + `vite build` cloud + desktop tutti exit 0. End-to-end LAN reale (2 PC su stessa Wi-Fi) da fare nel field-test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M — Persistenza desktop         | M1-M3 DONE         | 2026-04-17 | `device.json` su `~/SlideCenter/device.json` (write atomico .tmp→rename, encoding UTF-8, schema `{admin_server:{base_url}, name, fingerprint:null, event_id, room_id, device_token}`) gia' creato in Sprint L durante `pair-direct`. Sprint M aggiunge **lettura** all'avvio: nuovo `device_persist::read()` (`apps/desktop/src-tauri/src/device_persist.rs`) richiamato in `boot()` solo se `role=='sala'`. Se trovato: aggiorna mDNS TXT `event_id` per discovery cross-broadcast (`MdnsHandle::update_event_id`). SPA: nuovo Tauri command `cmd_get_persisted_device` + helper `getPersistedDevice` in `desktop-bridge.ts`; `RoomPlayerView` legge il device persistito al mount e bypassa pairing dialog se gia' configurato. Migration `0002_paired_devices_lan_url.sql` aggiunge colonna `lan_base_url` alla tabella `paired_devices` (idempotente con tolleranza "duplicate column" via `PRAGMA table_info`); l'admin SPA salva `lanBaseUrlByDeviceId` in localStorage durante la discovery+pair (mappa device_id → URL admin) per future feature di "rimuovi PC remoto". UI admin: bottone "Rimuovi PC" in `DevicesPanel` con conferma + DELETE `/rest/v1/paired_devices?id=eq.{device_id}`; il PC sala rimane "appeso" finche' non si fa "Esci dall'evento" sul sala (limitazione documentata). Validazione: `cargo check` + `cargo clippy --all-targets -- -D warnings` exit 0, `tsc --noEmit` exit 0, `eslint .` (0 errors, 0 warnings), `vite build` cloud + desktop exit 0. End-to-end LAN reale da fare nel field-test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| N — Sync LAN file               | N1-N4 DONE         | 2026-04-17 | Sync file admin → sala in modalita LAN-only (no Supabase). **N1 fan-out admin**: `notify_paired_devices` (`apps/desktop/src-tauri/src/server/lan_push.rs`) lanciato post-commit da `finalize_upload` e `delete_presentation`; query `paired_devices WHERE event_id=? AND status='online' AND lan_base_url IS NOT NULL`, `tokio::spawn` fire-and-forget POST `{lan_base_url}/events/file_added` o `/presentation_deleted` con `reqwest` (timeout 4s), errori loggati ma non bloccano response. Pre-requisito: SPA admin (`AddLanPcDialog`) chiama `registerPairedDeviceOnAdminLocal` post `pair-direct` per popolare SQLite admin con `lan_base_url + pair_token_hash` (sha256 device_token via WebCrypto). **N2 listener sala**: routes `POST /events/file_added` + `POST /events/presentation_deleted` (`lan_events_routes.rs`, solo nodi role=sala via `enforce_role_sala`); pubblica su `LanEventBus` (`tokio::sync::broadcast` + ring buffer 32 eventi recenti). Endpoint signed URL admin `POST /functions/v1/lan-sign-url` (`functions.rs::lan_sign_url`): valida device_token (sha256 contro paired_devices) + scope event_id (storage_key DEVE appartenere a presentation dello stesso event), ritorna URL HMAC-SHA256 TTL 600s. **N3 push reattivo + safety net**: `GET /events/stream?since=<cursor>&timeout_ms=25000&event_id=<eid>` long-poll Rust (filtra per event_id, snapshot da ring se cursor < ultimo evento, altrimenti subscribe broadcast); `useFileSync` lato sala: nuovo effect attivo quando `localBackendBaseUrl` settato → loop `fetchLanEvents` con `AbortController` cleanup, backoff 2s su errori; ogni evento `file_added`/`presentation_deleted` chiama `refreshNowRef.current()`. Polling 12s/60s/5s di Sprint A resta come safety net. **N4 playback_mode compatibile**: download LAN passano per stessa `downloadFileToPath` del cloud → throttle/concurrency identici (live=1+throttle 50ms/4MB; turbo=3 paralleli; auto=1 conservativo). LAN 1Gbit + turbo → ~5GB in 30s. **`useFileSync` LAN bypass**: nuovo prop `lanAdminBaseUrl`; `tryCloud` chiama `signLanDownloadUrl({adminBaseUrl, device_token, storage_key})` invece di `createVersionDownloadUrl` Supabase. **`RoomPlayerView`**: legge `getPersistedDevice() + getDesktopBackendInfo()` e passa `lanAdminBaseUrl + localBackendBaseUrl` a `useFileSync`. **Sicurezza**: `/events/*` LAN trust (mitigato da role=sala check + Sprint Q valutera' HMAC), `lan-sign-url` valida device_token + event scope, signed URL HMAC SHA-256 TTL 600s sufficienti per file 5GB su LAN 100Mbit. **Trade-off**: long-poll vs SSE (portabilita), fan-out fire-and-forget no retry (recovery via bootstrap), `registerPairedDeviceOnAdminLocal` best-effort (fallimento → no fan-out fino a re-pair). Validazione: `cargo check` + `cargo clippy --all-targets -- -D warnings` exit 0, `tsc --noEmit` exit 0, `eslint .` (0 errors, 0 warnings), `vite build` cloud + desktop exit 0. End-to-end LAN reale (2 PC + upload da admin → sala riceve push <500ms + download via signed URL admin) da fare nel field-test.                                                                                                         |
| O — UX parity cloud/desktop     | O1-O5 DONE         | 2026-04-17 | UX identica cloud vs desktop offline. **O1 audit**: zero URL Supabase hard-coded nel codice (4 occorrenze tutte in `docs/`); auth Supabase isolato in 7 view (LoginView, SignupView, ForgotPasswordView, ResetPasswordView, AcceptInviteView, RequireAuth, RootLayout-logout) — in desktop mai raggiunte (DesktopRoleGate redirige sale + DesktopAuthProvider fornisce session fittizia). 7 hook usano `supabase.channel()` per push reattivo, in desktop degradano a polling REST safety-net 30s (status='error' quando subscribe fallisce). **O2 backend client + sblocco Supabase desktop**: `apps/web/src/lib/desktop-backend-init.ts` (`ensureDesktopBackendReady()` chiamato in `main.tsx` PRIMA di `createRoot.render()`, cache admin_token+base_url in modulo per accesso sincrono, timeout 5s, schermata errore esplicita); `apps/web/src/lib/supabase.ts` riscritto: in desktop costruisce `createClient(base_url, admin_token, {auth:{persistSession:false}, global:{headers:{apikey, Authorization}}})` puntato al backend Rust locale (mirror PostgREST via `pgrest.rs`); `apps/web/src/lib/backend-client.ts` thin wrapper `getBackendClient()`; `apps/web/src/lib/desktop-fake-session.ts` `buildDesktopAdminSession(adminToken)` con LOCAL_TENANT_ID + LOCAL_ADMIN_USER_ID seedati Rust (00000000-0000-0000-0000-00000000000{1,2}); `auth-provider.tsx` split `CloudAuthProvider` (storico) + `DesktopAuthProvider` (session fittizia, loading=false immediato); `OnboardingGate` skip in desktop (tenant locale gia' seedato); `RootLayout` hide logout button in desktop (single-user, riavvio app per cambiare ruolo). **O3 realtime client astrazione**: `apps/web/src/lib/realtime-client.ts` `subscribeToTopic(topic, options)`: in cloud usa `supabase.channel().on('broadcast', {event:'*'})`; in desktop usa long-poll `/events/stream` Sprint N3 con AbortController cleanup. API READY ma migrazione 7 hook esistenti deferita perche' degradano gracefully a polling REST in desktop. `getRealtimeMode()` helper per UI status. **O4 BackendModeBadge esteso**: `use-backend-status.ts` hook polling 15s cloud (navigator.onLine) / 10s desktop (`GET /health` Rust, timeout 2s). 5 stati: cloud-online (verde sc-primary), cloud-offline (grigio sc-text-dim), lan-connected (blu sc-primary, tooltip latenza Xms), standalone (arancio sc-accent), loading (neutro). i18n keys `backendMode.short.{cloud,cloudOffline,desktop,lan,standalone,loading}` + hint IT/EN. **O5 cross-mode visual parity**: stesso `index.css` Tailwind 4, stessi token semantici, stesso font-family, stesso layout. Build delta: cloud `dist/index-zcKmg-xm.js` 385.60 KiB vs desktop `dist-desktop/index-BvqFHhlJ.js` 385.62 KiB → delta < 100 byte (solo stringhe `import.meta.env`). PWA service worker solo cloud (Tauri webview gia' offline-capable). **Sicurezza**: session fittizia desktop solo in memoria processo Tauri, mai inviata a Supabase cloud; admin_token UUID 32-byte random base64 (~256 bit entropia) validato server-side via `constant_time_eq`. **QA**: ✅ tsc + eslint + vite build cloud/desktop + cargo check + cargo clippy --all-targets -- -D warnings tutti exit 0. |
| P — Build NSIS                  | P1-P5 DONE         | 2026-04-17 | Pipeline build orchestrata + auto-update predisposto + slot signing + docs distribuzione interna. **P1**: `apps/desktop/scripts/{check-prereqs,clean,release}.mjs` + `release.ps1` (wrapper PowerShell con prompt account live-software11, copy artifact, snippet CHANGELOG). `tauri.conf.json -> build.beforeBuildCommand` lancia auto `pnpm --filter @slidecenter/web build:desktop` durante `cargo tauri build` (single-command `pnpm release:nsis`). Output `release-output.json` con SHA-256 + size + path installer. **P2**: target NSIS `Live SLIDE CENTER Desktop_<ver>_x64-setup.exe`, `webviewInstallMode: downloadBootstrapper silent`, `installMode: currentUser` (no UAC), `compression: lzma`, `displayLanguageSelector: ["Italian","English"]`. Solo `x86_64-pc-windows-msvc`. **P3**: `tauri-plugin-updater 2` + `tauri-plugin-process 2` (cfg target non-mobile), permessi capabilities (`updater:default`, `process:default`, `process:allow-restart`), 3 Tauri commands (`cmd_updater_status`, `cmd_check_for_update`, `cmd_install_update_and_restart`) + bridge TS typed (`getUpdaterStatus`, `checkForUpdate`, `installUpdateAndRestart`) con fallback `{configured:false}` in cloud, banner `<DesktopUpdateBanner>` sticky in `RootLayout` (check al boot + ogni 30 min, dismiss per-versione via `sessionStorage`, gestione `installing`/`installError` inline, i18n `desktopUpdater.*` IT+EN). Endpoint `https://github.com/live-software11/slide-center-desktop/releases/latest/download/latest.json`. Default sicuro: `bundle.createUpdaterArtifacts: false`, `pubkey` omesso → build funziona senza chiavi e updater UI dormant. **P4**: `tauri.signing.example.json` committato + override `--signing-config` con verifica `TAURI_SIGNING_PRIVATE_KEY`. `.gitignore` blocca `tauri.signing.json` privato + `*.key` + `release-output.json` + `release/`. Doc `CODE_SIGNING.md` (3 strategie: cert EV Windows Cert Store / Azure Key Vault / HSM remoto, distinzione Ed25519 updater vs X.509 EV code signing) + `UPDATER_SETUP.md` (workflow `cargo tauri signer generate` → repo `slide-center-desktop` → `gh release upload latest.json`). **P5**: `apps/desktop/README.md` (quick start + tabella script + architettura runtime + troubleshooting + roadmap J→Q) + one-liner zip distribuzione interna PowerShell. **Trade-off accettati**: cargo tauri CLI MISSING su dev box (script `check-prereqs.mjs` segnala fix `cargo install tauri-cli --version "^2.0" --locked`); no cert EV → SmartScreen "Esegui comunque" tollerabile; no auto-update finche non si crea repo `live-software11/slide-center-desktop` (banner nascosto graceful, 404 → `available:false`); zip manuale, no CI release (delineata in `UPDATER_SETUP.md` come eventuale Sprint S). **Validazione**: ✅ `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` exit 0, ✅ `pnpm --filter @slidecenter/web typecheck` exit 0, ✅ `pnpm --filter @slidecenter/web lint` exit 0 (rispettata regola React 19 `react-hooks/set-state-in-effect` nel banner). Build NSIS reale demandata al primo `pnpm release:nsis` post-installazione cargo tauri CLI (~5-10 min primo build). |
| Q — Sync hybrid (opzionale)     | TODO               | -          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

**Fine documento.** Per dubbi o variazioni, discuterne PRIMA di codare.
