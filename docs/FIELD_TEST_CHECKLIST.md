# FIELD_TEST_CHECKLIST.md — Live SLIDE CENTER

> **Per chi:** Andrea (operatore field test) + tecnico in sala.
> **Quando:** evento reale o simulato pre-cliente. Da compilare in **tempo reale** durante l'evento.
> **Tempo:** ~3-4 ore se tutto verde, fino a 1 giornata se emergono fix.
> **Output:** documento spuntato + log incidenti + lista fix prioritizzata per il commit post-evento.
>
> **Versione:** 1.0 — 18 Aprile 2026 (Sprint Field Test prep, livello 1)

---

## COME USARE QUESTO DOCUMENTO

1. **Pre-evento (T-1 giorno):** completa la sezione [Setup pre-test](#setup-pre-test-completare-1-volta-prima-dellevento). Lancia `scripts/Setup-Field-Test-Env.ps1`. Stampa o tieni aperto questo file su tablet.
2. **Durante l'evento:** spunta `[ ]` → `[x]` man mano che esegui ogni step. Per ogni test scrivi **PASS / FAIL / SKIP** + nota breve. Se FAIL: cattura screenshot/log e segnala in `Field Test Log` in fondo.
3. **Dopo l'evento:** sintetizza i FAIL in una sezione "Fix prioritari" + crea issue/commit per ognuno. Aggiorna `docs/STATO_E_TODO.md`.
4. **Convenzioni esito:**
   - **PASS** = funziona come atteso.
   - **FAIL** = comportamento errato/bloccante. Annota fix necessario.
   - **PARTIAL** = funziona ma con friction (es: ci sono voluti 3 click invece di 1). Annota miglioria UX.
   - **SKIP** = saltato perche prerequisito mancante o non applicabile.
   - **N/A** = non applicabile per questo evento (es: T19 LAN-only se internet sempre presente).

---

## SETUP PRE-TEST (completare 1 volta prima dell'evento)

### Account e ambiente

- [ ] `gh auth status` → conferma account `live-software11` su questa macchina.
- [ ] `firebase login:list` → conferma email `live.software11@gmail.com` per Supabase MCP.
- [ ] `vercel whoami` → conferma `livesoftware11-3449`.
- [ ] Apri Supabase dashboard `live-slide-center` → Settings → API → annota `service_role` key in `.env.local` (NON committare).
- [ ] Apri Vercel dashboard → progetto `live-slide-center` → Deployments → annota URL ultimo deploy production.

### Tenant + utenti + evento demo

- [x] **Ambiente già provisionato il 2026-04-18 via MCP Supabase.** Tutte le credenziali, ID tenant/event/room/session/speaker e procedura di reset sono in `docs/FIELD_TEST_CREDENTIALS.md`.
- [ ] (Solo se serve riprovisionare da zero) Esegui `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Setup-Field-Test-Env.ps1` con `$env:SUPABASE_URL` + `$env:SUPABASE_SERVICE_ROLE_KEY` validi (script idempotente, password identiche al provisioning corrente).
- [ ] Verifica login per almeno 1 utente per ruolo: `admin.alpha@fieldtest.local` / `FieldTest!AlphaAdmin2026`, `coord.alpha`, `tech.alpha`, `super.alpha`. Pattern password: `FieldTest!<Tenant><Role>2026`.
- [ ] Verifica isolamento RLS (T6 in anticipo): login `admin.beta`, controlla che NON veda l'evento di Alpha (event_id `7e3af553-abd8-401f-bfd3-c81c1e90a9d2`).

### Hardware fisico

- [ ] **Mini-PC regia** (Centro Slide desktop): Live SLIDE CENTER Desktop installato (NSIS), porte 7300/7301 aperte nel firewall (profilo Privato).
- [ ] **Laptop sala 1**: browser Chrome/Edge, scheda incognito pronta.
- [ ] **Laptop sala 2**: browser Chrome/Edge, scheda incognito pronta.
- [ ] **Tablet relatore**: connesso allo stesso WiFi, Chrome.
- [ ] **Smartphone Andrea**: per QR scanning + comms emergenza.
- [ ] **Switch/router LAN**: tutti i PC sulla stessa subnet (no VLAN, no VPN).
- [ ] **Backup internet**: hotspot 4G pronto come failover (vedi `docs/DISASTER_RECOVERY.md` §3).

### Pre-flight check (5 min)

- [ ] `https://app.liveslidecenter.com/healthcheck.json` → 200 OK + `status: "ok"`.
- [ ] Vercel ultimo deploy production: stato **Ready** (no error).
- [ ] Supabase dashboard → Logs → ultimi 60 min: 0 errori HTTP 5xx.
- [ ] Sentry dashboard → ultimi 24h: 0 errori critici unresolved.
- [ ] Apri questo documento + `docs/DISASTER_RECOVERY.md` su 2 tab pinnati nel browser di servizio.

---

## TEST CRITICI (ordine di esecuzione consigliato)

### T1 — Auth e isolamento RLS multi-tenant

**Cosa testa:** che un tenant non possa vedere dati di un altro tenant, anche manipolando URL.

**Passi:**

1. Browser principale: login come `admin.alpha@fieldtest.local` (`FieldTest!AlphaAdmin2026`) → vai a `/eventi`. Annota: vedi solo evento "Field Test Aprile 2026" del tenant Alpha (event_id `7e3af553-abd8-401f-bfd3-c81c1e90a9d2`).
2. Browser incognito: login come `admin.beta@fieldtest.local` (`FieldTest!BetaAdmin2026`) → vai a `/eventi`. Annota: vedi solo "Field Test Aprile 2026" del tenant Beta (event_id `cb6b01a2-0a04-4b16-924a-b71dbe790265`).
3. Dal browser principale (Alpha), naviga a `/eventi/cb6b01a2-0a04-4b16-924a-b71dbe790265` (event di Beta, copiato da `docs/FIELD_TEST_CREDENTIALS.md`).
4. Browser incognito: login come `super.alpha@fieldtest.local` (`FieldTest!AlphaSuper2026`) → vai a `/admin/tenants`. Annota: vedi entrambi i tenant.

**Output atteso:** step 3 mostra **404 / forbidden** (NON i dati di Beta). Step 4 mostra entrambi i tenant.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T2 — Signup → tenant auto-provisioning

**Cosa testa:** che un nuovo signup pubblico crei correttamente tenant + admin user + JWT con `tenant_id` valido.

**Passi:**

1. Browser incognito: vai a `/signup`. Compila: nome `Test Co Field`, email `signup-fieldtest+<timestamp>@example.com`, password >= 12 char.
2. Conferma email (apri inbox Resend o usa email reale che controlli).
3. Login con le credenziali appena create.
4. Verifica accesso a `/` (dashboard home) senza errori.
5. In Supabase dashboard → Tables → `tenants`: verifica nuova row creata con slug derivato dal nome.
6. Tabella `users`: verifica row admin con `tenant_id` corretto.

**Output atteso:** trigger `handle_new_user_tenant` ha creato 2 row coerenti. JWT contiene `app_metadata.tenant_id` = UUID nuovo tenant.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T3 — Quote storage enforcement

**Cosa testa:** che il sistema blocchi upload oltre quota e aggiorni `storage_used_bytes` correttamente.

**Passi:**

1. Login come `admin.alpha@fieldtest.local` (piano Pro = 1 TB, NON utile per stress quota: usa il signup di T2 → tenant Trial 5 GB).
2. Su tenant Trial: carica 1 file da 4 GB tramite `/eventi/<id>/upload` (usa file dummy generato con `fsutil file createnew dummy4gb.bin 4294967296`).
3. Verifica upload completato + `tenants.storage_used_bytes` = 4 GB circa.
4. Carica altro file 2 GB sullo stesso tenant.
5. Annota errore esatto.
6. Cancella la versione caricata via UI → verifica `storage_used_bytes` decrementato.

**Output atteso:** step 5 → errore `storage_quota_exceeded` (HTTP 413 o messaggio in UI). Step 6 → quota torna a ~0 GB.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T4 — Pairing PC sala via codice 6 cifre (cloud)

**Cosa testa:** che il flusso "genera codice → digita su PC sala → vedi connesso" funzioni in <30 secondi.

**Passi:**

1. Su browser regia: login `admin.alpha`, vai a `/eventi/<id>/centri-slide` o equivalente in EventDetailView.
2. Click "Aggiungi PC sala" → "Codice 6 cifre". Annota codice generato.
3. Su laptop sala 1: apri `/pair`, digita codice, conferma.
4. Cronometra: tempo da step 2 a "PC connesso" visibile in dashboard regia.
5. Drag PC nella board → assegna a "Sala Plenaria" (sala creata dal provisioning).
6. Riavvia laptop sala 1 (chiudi browser, riapri Live SLIDE CENTER).
7. Verifica: app si riapre nella sala assegnata SENZA chiedere re-pairing (cookie/localStorage `pair_token` persistente).

**Output atteso:** step 4 < 5s. Step 5 → drag funziona, realtime sync. Step 7 → riapertura automatica.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T5 — Pairing PC sala via magic link (Sprint U-4 zero-friction)

**Cosa testa:** che il magic link bypassi completamente il codice 6 cifre.

**Passi:**

1. Su regia: "Aggiungi PC sala" → "Magic Link". Copia URL `/sala-magic/<token>`.
2. Su laptop sala 2: incolla URL nel browser.
3. Cronometra: tempo da apertura URL → vista sala con QR speaker visibile.
4. Verifica `paired_devices` row creata + `activity_log` entry.

**Output atteso:** pairing automatico, redirect a `/sala/<pair_token>`, tempo < 5s.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T6 — Pairing PC desktop server (Sprint D1 + Sprint SR)

**Cosa testa:** che la Tauri app desktop si binda al cloud, salvi licenza cifrata e gestisca correttamente la scadenza `pair_token` 12 mesi (Sprint SR).

**Passi:**

1. Su regia browser: `/centri-slide` → "Nuovo Centro Slide Desktop" → "Magic Link". Copia URL.
2. Su mini-PC regia (Tauri app): apri Live SLIDE CENTER Desktop → menu sinistra "Licenza" → incolla URL → "Collega".
3. Verifica: 1-2s loader → "Licenza attiva — Tenant: Field Test Alpha, Plan: Pro".
4. File system: verifica `~/.slidecenter/license.enc` esiste (cifrato AES-256-GCM, NON leggibile in chiaro).
5. Apri DevTools Tauri → console → digita `await window.__TAURI_INTERNALS__.invoke('cmd_license_status')` → verifica risposta contiene `pair_token_expires_at` ~12 mesi nel futuro.
6. Riavvia mini-PC. Apri app. Verifica: parte automaticamente connessa, NO re-binding.
7. **Stress scadenza (opzionale, distruttivo):** simula scadenza imminente cambiando `pair_token_expires_at` in DB a `now() + 5 days` per quel device. Riavvia app. Verifica banner "Token in scadenza, rinnovo automatico in corso..." e dopo ~30s `pair_token_expires_at` aggiornato a `now() + 12 months` (auto-renew Tauri).

**Output atteso:** binding < 5s, file cifrato presente, auto-renew funzionante senza azione utente.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T7 — Drag&drop PC sala fra sale dell'evento (Sprint S-2)

**Cosa testa:** spostare un PC sala fra sale via drag&drop e verificare che il PC riceva il cambio realtime.

**Passi:**

1. Evento "Field Test Aprile 2026" del tenant Alpha attivo, 2 sale gia presenti ("Sala Plenaria", "Sala Workshop").
2. Pair laptop sala 1 (codice 6 cifre, T4) → assegna a Sala Plenaria.
3. Pair laptop sala 2 (magic link, T5) → assegna a Sala Workshop.
4. Da regia EventDetailView board: drag PC1 da Sala Plenaria → Sala Workshop.
5. Cronometra: tempo da drop → notifica realtime su PC1 (vista cambia, mostra Sala Workshop).

**Output atteso:** `paired_devices.room_id` aggiornato + realtime notify sul PC entro 1s.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T8 — Promozione device a Centro Slide (Sprint S-4)

**Cosa testa:** promuovere un PC sala a "control_center" (riceve file di tutte le sale).

**Passi:**

1. Su PC sala 1 (paired, già in Sala Plenaria): kebab menu → "Promuovi a Centro Slide".
2. Verifica conferma + `paired_devices.role = 'control_center'` + `room_id = NULL`.
3. Carica nuovo file su Sala Workshop → verifica che PC1 (ora control_center) riceva push del file.
4. Demuove a `room` da kebab → verifica torna single-room (riceve solo Sala Plenaria).

**Output atteso:** promote/demote funziona senza errori, fan-out file corretto.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T9 — Upload speaker via QR (Sprint R-3)

**Cosa testa:** flusso completo speaker → QR → upload → versioning.

**Passi:**

1. Su regia: vai a `/eventi/<id>/relatori`, prendi 1 speaker creato dallo script (es. "Mario Rossi").
2. Genera QR upload portal → mostra a smartphone Andrea (scan).
3. Smartphone: apri URL `/u/<speaker_token>` → carica file PowerPoint 50-500 MB (usa file demo presentazione reale).
4. Verifica progress bar avanza correttamente.
5. Carica nuova versione dello stesso file (modifica 1 byte) → verifica v1 + v2 visibili in storico.
6. Stacca WiFi telefono a metà upload → verifica retry automatico al ricollego.

**Output atteso:** upload chunked + retry funzionano, hash SHA-256 diversi per ogni versione, versioning visibile in UI tecnico.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T10 — Live regia realtime (OnAirView)

**Cosa testa:** che cambiare versione "in onda" dalla regia si propaghi al PC sala in <2s.

**Passi:**

1. 2 sale attive con PC sala paired (T4 + T5 completati).
2. Regia: vai a `/eventi/<id>/on-air`.
3. Seleziona Sala Plenaria → mostra grid versioni speaker. Click "Manda in onda" su versione X.
4. Cronometra: tempo da click → vista cambia su laptop sala 1.
5. Ripeti su Sala Workshop con versione Y → verifica laptop sala 2 cambia, sala 1 invariato.
6. Stacca cavo rete laptop sala 1 → verifica status diventa "offline" entro 15s nel widget telemetria regia.

**Output atteso:** latenza cambio versione < 2s P95. Status offline rilevato in 15s.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T11 — Telemetria live perf PC sala (Sprint T-2)

**Cosa testa:** che il pannello LivePerfTelemetryPanel mostri metriche real-time per ogni PC.

**Passi:**

1. Apri pannello `LivePerfTelemetryPanel` per evento Field Test Alpha (in regia).
2. Per ogni PC paired, verifica: heap JS (MB), FPS, battery %, network status, storage quota.
3. Stress test: su laptop sala 1 apri DevTools → Performance → "Heap snapshot" + carica file 1 GB → verifica spike heap visibile in dashboard regia.
4. Verifica retention `device_metric_pings`: dopo cleanup automatico (cron 0 3 * * *), record > 24h spariscono.

**Output atteso:** metriche aggiornate ogni 3s circa, no flooding RPC, cleanup notturno funziona.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T12 — File error checking (Sprint T-3-A)

**Cosa testa:** validazione lato server di file caricati (corruzione, dimensione).

**Passi:**

1. Speaker portal QR (T9): carica file PowerPoint corrotto (rinomina un .txt → .pptx, oppure usa file con header invalido).
2. Verifica warning visibile a tecnico in `/eventi/<id>/relatori` (badge colorato).
3. Carica file > 100 MB → verifica warning "size" (ma upload comunque permesso se sotto quota tenant).
4. Verifica `validation_warnings` table popolata.

**Output atteso:** validazione asincrona produce warning, UI evidenzia file problematici, tecnico può intervenire.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T13 — Next-Up file preview (Sprint T-3-E)

**Cosa testa:** anteprima della prossima slide in coda automatica.

**Passi:**

1. PC sala 1 in modalità coda automatica (3 versioni in queue dalla regia).
2. Verifica widget "Prossimo" in `RoomPlayerView` mostra preview thumbnail della versione successiva.
3. Cambia ordine coda da regia → verifica preview aggiornato realtime.

**Output atteso:** preview sempre visibile, aggiornato realtime.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T14 — Remote slide control da tablet (Sprint T-3-G)

**Cosa testa:** controllare le slide del PC sala da un tablet relatore.

**Passi:**

1. Su regia: in vista PC sala 1 → "Controllo remoto" → genera codice pairing per tablet.
2. Su tablet: apri `/remote/<code>` → conferma pairing.
3. Tap "Next slide" → cronometra arrivo comando al PC sala (target < 500ms).
4. Tap "Previous", "Pause", "Pointer mode" → verifica tutti i comandi funzionano.
5. Verifica `remote_control_pairings` row creata + `expires_at` ~4h.

**Output atteso:** latenza comandi < 500ms, scadenza automatica, no leak fra dispositivi.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T15 — errorElement + catch-all SPA (Sprint U-7)

**Cosa testa:** che URL inesistenti / token rotti mostrino RouteErrorView e non crashino l'app.

**Passi:**

1. Browser: apri URL inesistente `https://app.liveslidecenter.com/foo/bar/baz`.
2. Verifica vedi `RouteErrorView` con titolo "Pagina non trovata" + bottoni "Ricarica" / "Vai alla home". NON vedi banner React Router default.
3. Apri magic link rotto: `https://app.liveslidecenter.com/sala-magic/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` (UUID inventato).
4. Verifica vedi `RouteErrorView` + "Vai alla home" → click → torna a `/` correttamente.
5. Cambia lingua UI in EN → ripeti step 1 → verifica testo è in inglese ("Page not found").

**Output atteso:** zero crash, error UI sempre presente, i18n IT/EN OK.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T16 — Audit RLS cross-tenant + super_admin policies

**Cosa testa:** policy RLS Postgres sono effettivamente attive (no leak fra tenant via SQL diretto).

**Passi:**

1. Apri Supabase dashboard → SQL Editor.
2. Esegui:

```sql
-- Test isolamento tenant Alpha:
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "<UID-admin-alpha>", "app_metadata": {"tenant_id": "<TENANT-ALPHA-UUID>"}}';
SELECT count(*) AS events_visible FROM events;
SELECT count(*) AS paired_devices_visible FROM paired_devices;
SELECT count(*) AS desktop_devices_visible FROM desktop_devices;

-- Test super_admin (tutti):
SET request.jwt.claims = '{"sub": "<UID-super-alpha>", "app_metadata": {"role": "super_admin"}}';
SELECT count(*) AS events_total FROM events;
```

3. Sostituisci `<UID-…>` e `<TENANT-…-UUID>` con valori reali (recuperabili da `auth.users` e `tenants`).
4. Annota i count.

**Output atteso:** counts tenant-scoped = solo righe Alpha. Counts super_admin = totale completo. Zero leak.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T17 — Code-signing e SmartScreen (Sprint D7)

**Cosa testa:** che l'installer Tauri firmato passi SmartScreen senza warning bloccanti.

**Passi:**

1. Build installer firmato: `apps/desktop/scripts/release.ps1 -Signed` (richiede certificato Sectigo OV su questo PC).
2. Trasferisci installer NSIS su PC Windows 11 pulito (no Live SLIDE CENTER mai installato prima).
3. Doppio click installer.
4. Annota comportamento SmartScreen: warning iniziale è normale per certificati OV con poca reputation. Verifica passaggio "Esegui comunque" è 1 click (NON blocco completo).
5. Installa, verifica:
   - Firewall rules `Get-NetFirewallRule -DisplayName "*SLIDE CENTER*"` create.
   - Defender exclusion `Get-MpPreference | Select ExclusionPath` presente.
   - Shortcut menu Start "Live SLIDE CENTER".
6. Disinstalla da "App e funzionalità" → verifica cancella TUTTO (config dir vuota, no orphan).

**Output atteso:** SmartScreen passabile in 1 click, install + uninstall puliti.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A
**Nota / fix necessario:**

---

### T18 — Stress: 10 PC sala paralleli su 1 evento

**Cosa testa:** scalabilità realtime con molti device contemporanei.

**Prerequisito:** script Playwright headless `apps/web/tests/stress-10-rooms.spec.ts` (NON ancora esistente, da creare se vuoi eseguire — altrimenti SKIP).

**Passi (se script disponibile):**

1. `pnpm --filter @slidecenter/web test:e2e --grep "stress 10 rooms"` → 10 browser headless aprono `/sala/<token>` diversi.
2. Da regia, trigger 10 cambi versione contemporanei (1 per sala).
3. Misura latenza media e P95 (script logga JSON).
4. Verifica nessun errore Realtime, nessun timeout, nessun rate-limit hit.

**Output atteso:** P95 < 2s, P99 < 5s, zero errori.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A (script non esistente)
**Nota / fix necessario:**

---

### T19 — Modalità offline LAN (post Sprint Q se chiuso)

**Cosa testa:** funzionamento completo senza internet (ambiente "evento isolato in convention hall").

**Prerequisito:** Sprint Q hybrid sync chiuso. **Stato attuale: Sprint Q OPZIONALE non chiuso → questo test è N/A** salvo eventi reali che lo richiedano.

**Passi (se Sprint Q chiuso):**

1. Setup: mini-PC regia + 2 laptop sala su router locale, NO internet (stacca cavo WAN/spegni hotspot).
2. Pre-evento (online): crea evento "Test Offline" dalla cloud, lascia che desktop syncronizzi.
3. Stacca WAN.
4. Speaker carica file via portal LAN (`http://<IP-mini-PC>:7300/u/<token>`).
5. Sala riceve file via push LAN entro 30s.
6. Riconnetti WAN → verifica sync verso cloud automatica entro 60s.

**Output atteso:** evento procede senza internet, sync recovery automatico al reconnect.

**Esito:** ☐ PASS  ☐ FAIL  ☐ PARTIAL  ☐ SKIP  ☐ N/A (Sprint Q non chiuso)
**Nota / fix necessario:**

---

## ACCEPTANCE CRITERIA — production ready

Dopo aver eseguito tutti i test, l'app è considerata **production ready per il primo cliente paying** se:

- [ ] **T1-T18** tutti **PASS** o **PARTIAL** (no FAIL bloccanti).
- [ ] **T19** PASS se Sprint Q chiuso, **N/A** altrimenti (accettabile).
- [ ] Latenza T10/T18 P95 < 2s.
- [ ] Zero leak RLS in T16 (cross-tenant counts = 0).
- [ ] T17 SmartScreen non bloccante (1 click "Esegui comunque" tollerato per OV cert).
- [ ] **0 errori critici Sentry** durante tutto il field test.
- [ ] **0 alert UptimeRobot** durante l'evento.

Se ci sono FAIL bloccanti → **NON andare in produzione cliente**, fix prima di vendere.

---

## FIELD TEST LOG (compilare in tempo reale durante l'evento)

> Una riga per ogni incidente, scoperta, friction, idea. Anche le banalità sono utili: il pattern emerge solo a fine giornata.

| Ora (HH:MM) | Test ID | Severity | Descrizione | Action richiesta | Stato |
| ----------- | ------- | -------- | ----------- | ---------------- | ----- |
| 09:30 | T4 | LOW | Esempio: tempo pairing 7s invece di 5s, accettabile | Misurare con DevTools network panel | OPEN |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

**Severity:** CRITICAL (evento bloccato), HIGH (workaround necessario), MEDIUM (friction UX), LOW (nice-to-have).
**Stato:** OPEN, FIXED-LIVE (workaround applicato durante evento), DEFERRED (issue/commit post-evento).

---

## SINTESI POST-EVENTO

Compilare entro 24h dalla fine dell'evento.

### Risultato globale

- Test totali eseguiti: ___ / 19
- PASS: ___
- FAIL: ___
- PARTIAL: ___
- SKIP / N/A: ___

### Top 5 fix prioritari

1. _________________________________________________________
2. _________________________________________________________
3. _________________________________________________________
4. _________________________________________________________
5. _________________________________________________________

### Decisione go-to-market

- [ ] **GO** — pronto per vendere al primo cliente paying.
- [ ] **GO con caveat** — vendibile ma con liste fix da chiudere prima del 2° cliente. Caveat: ___________
- [ ] **NO-GO** — fix bloccanti necessari prima di qualsiasi vendita. Tempo stimato: ___ giorni.

### Lezioni apprese (per il prossimo field test)

_________________________________________________________
_________________________________________________________
_________________________________________________________

---

## RIFERIMENTI

- **Credenziali ambiente field test** (email + password + ID tenant/event/room/session): `docs/FIELD_TEST_CREDENTIALS.md`.
- Procedura test originale: `docs/AUDIT_FINALE_E_PIANO_TEST_v1.md` §4 (T1-T19 + acceptance criteria).
- Disaster recovery in caso di problemi durante l'evento: `docs/DISASTER_RECOVERY.md`.
- Setup ambiente test automatico (idempotente, da rilanciare se l'ambiente viene cancellato): `scripts/Setup-Field-Test-Env.ps1`.
- Architettura: `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md`.
- Storico stato sprint: `docs/STATO_E_TODO.md`.
