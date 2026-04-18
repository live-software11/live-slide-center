# DISASTER_RECOVERY.md — Live SLIDE CENTER

> **Per chi:** Andrea (operatore principale) + chiunque debba intervenire in emergenza durante un evento live.
> **Quando:** quando un componente critico (Supabase, Vercel, internet, app) cade durante un evento o nelle ore precedenti.
> **Filosofia:** ZERO teoria. Solo passi eseguibili sotto stress, con tempo medio di intervento dichiarato.
> **Versione:** 1.0 — 18 Aprile 2026.

---

## INDICE RAPIDO (CTRL+F qui dentro per non perdere tempo)

| Scenario                                                            | Tempo intervento | Sezione |
| ------------------------------------------------------------------- | ---------------- | ------- |
| Vercel deploy rotto, devo rollback                                  | 30 secondi       | §1      |
| Supabase down (RPC/Auth non risponde)                               | 5-15 minuti      | §2      |
| Internet venue down                                                 | 2 minuti         | §3      |
| Edge Function singola in errore                                     | 3 minuti         | §4      |
| Errore SSL/cert su `app.liveslidecenter.com`                        | 5 minuti         | §5      |
| Devo comunicare ai clienti durante un incident                      | 5 minuti         | §6      |
| App desktop Tauri non parte / pair_token rifiutato                  | 5 minuti         | §7      |
| Database Supabase corrotto (worst case)                             | 1-4 ore          | §8      |

---

## §1 — VERCEL DEPLOY ROTTO (rollback in 30 secondi)

**Sintomi:** SPA mostra pagina bianca, errore JS in console "Cannot read property of undefined", oppure `/healthcheck.json` ritorna 500. Causa probabile: ultimo deploy rotto.

**Strada A — Rollback dashboard (30s, raccomandato)**

1. Apri [vercel.com/dashboard](https://vercel.com/dashboard) → progetto `live-slide-center` (account `livesoftware11-3449`).
2. Tab **Deployments** → cerca l'ultimo deploy con stato **Ready** verde **PRECEDENTE** a quello rotto.
3. Click sui 3 puntini "•••" alla destra di quel deploy → **Promote to Production**.
4. Conferma. Vercel fa lo switch in <10s. Apri `https://app.liveslidecenter.com` per verificare.

**Strada B — Rollback CLI (1 minuto, se dashboard inaccessibile)**

```bash
cd "C:\Users\andre\Desktop\Andrea Rizzari Live Software\Live SLIDE CENTER"
vercel ls live-slide-center --token $env:VERCEL_TOKEN  # lista deploy recenti
vercel promote <DEPLOYMENT_URL_VECCHIO_FUNZIONANTE> --yes --token $env:VERCEL_TOKEN
```

**Strada C — Force re-deploy commit precedente (3 minuti, se rollback non basta)**

```bash
cd "C:\Users\andre\Desktop\Andrea Rizzari Live Software\Live SLIDE CENTER"
git log --oneline -10
git revert <COMMIT_ROTTO> --no-edit
git push origin main
# Vercel auto-deploya. Se webhook GitHub disconnesso (vedi §1.2), usa fallback CLI:
vercel --prod --yes --archive=tgz
```

### §1.1 Verifica post-rollback

- [ ] `https://app.liveslidecenter.com/healthcheck.json` → 200 + `{"status":"ok"}`.
- [ ] Login admin tenant funziona.
- [ ] Apri `/eventi` → vedi gli eventi.
- [ ] Sentry: ultimi 5 min → no nuovi errori critici.

### §1.2 Se webhook GitHub→Vercel disconnesso (visto 18/04/2026)

Sintomo: push su `main` non triggera deploy. Vercel dashboard mostra "Updated Nd ago".

```bash
# Fallback deploy diretto da CLI:
cd "C:\Users\andre\Desktop\Andrea Rizzari Live Software\Live SLIDE CENTER"
vercel --prod --yes --archive=tgz
```

`--archive=tgz` è obbligatorio: monorepo > 15k file.

Risoluzione root (NON durante evento, fai dopo): vercel.com/dashboard → progetto → Settings → Git → Reconnect repository.

---

## §2 — SUPABASE DOWN (RPC/Auth non risponde)

### §2.A — Down breve (< 1 ora) — modalità degradata cloud

**Sintomi:** login lento o fallisce, RPC timeout, banner "Sync error" diffuso.

**Diagnosi rapida (1 minuto):**

1. [status.supabase.com](https://status.supabase.com) → controlla se region EU (Frankfurt) è UP.
2. Se Supabase è in incident → conferma e passa a **§2.A.2 (modalità degradata)**.
3. Se Supabase OK ma il NOSTRO progetto è giù → vai a Supabase dashboard → progetto `live-slide-center` → Logs → Postgres → cerca errori CONNECTION/TIMEOUT.
4. Se DB pool esaurito → ai clienti di ridurre frequenza polling (raro, succede solo se hai un loop infinito attivo). Killa il client offending.

**§2.A.1 — Comunicazione ai clienti (vedi §6 per template):**

Pubblica banner pubblico se hai più clienti collegati. Per evento singolo, comunicazione diretta WhatsApp.

**§2.A.2 — Operatività degradata (cosa continua a funzionare):**

| Componente             | Funziona offline Supabase?               | Note                                                  |
| ---------------------- | ---------------------------------------- | ----------------------------------------------------- |
| PC sala già paired     | SÌ (cache `pair_token` localStorage)     | Continua a mostrare la slide attualmente in onda      |
| PC desktop Tauri admin | SÌ (cache `license.enc` valida 24h)      | Continua se license verificata < 24h fa               |
| Upload speaker         | NO                                       | Upload bloccati, speaker vede errore                  |
| Cambio versione regia  | NO (richiede Supabase Realtime)          | Sala resta sull'ultima versione mostrata              |
| Login nuovo            | NO                                       | Tutti i login richiedono Supabase Auth                |

**Workaround durante incident:**

- Se evento è già in corso e la slide attuale è quella giusta → **non toccare nulla, aspetta**. Le slide in onda restano visibili in sala.
- Se devi cambiare slide → usa modalità LAN su mini-PC desktop (vedi §3.B sotto).
- Se devi far caricare uno speaker → invia file via email/USB stick e carica manualmente quando Supabase torna.

### §2.B — Down lungo (1 ora < t < 1 giorno) — bridge LAN

Se l'incident dura > 1h e l'evento è in corso, switch a modalità LAN tramite il mini-PC desktop:

1. Apri Live SLIDE CENTER Desktop sul mini-PC regia.
2. Verifica server Axum risponde: PowerShell `Invoke-WebRequest http://127.0.0.1:7300/health` → 200.
3. Sul mini-PC: l'app già funziona offline grazie a `license.enc` cifrata. Tutti gli endpoint REST sono mirror locali (events/rooms/sessions/...).
4. Sui PC sala: cambia URL nel browser da `https://app.liveslidecenter.com/sala/<token>` a `http://<IP-mini-PC>:7300/sala/<token>` (vedi §3.B per IP discovery).
5. Speaker upload: cambia URL QR a `http://<IP-mini-PC>:7300/u/<speaker_token>`.
6. Tutto il file sync ora gira su LAN locale (mini-PC fa fan-out via push HTTP a tutti i PC sala registrati nel suo SQLite).
7. **Quando Supabase torna:** se Sprint Q chiuso → sync push automatico. Altrimenti → re-importazione manuale presentazioni dal mini-PC verso cloud (script `scripts/Sync-Desktop-To-Cloud.ps1` se esistente, altrimenti upload manuale).

### §2.C — Down permanente / progetto Supabase distrutto (worst case)

**Probabilità:** estremamente bassa (region failure + backup region failure simultaneo).

**Procedura:** vedi §8.

---

## §3 — INTERNET VENUE DOWN (2 minuti per failover)

**Sintomi:** ping `8.8.8.8` fallisce, browser non carica nulla, switch router luce rossa.

**Failover ordinato:**

1. **Hotspot smartphone Andrea** (raccomandato, sempre con te):
   - iPhone: Impostazioni → Hotspot personale → ON. Annota nome rete + password.
   - Android: Impostazioni → Hotspot Wi-Fi → ON.
   - Connetti **prima il mini-PC regia** (priorità assoluta), poi laptop sala 1, poi sala 2.
   - Banda condivisa: max 2 sale + regia su 1 hotspot 4G. Più dispositivi = lag visibile.

2. **Modem 4G dedicato** (se hai backup hardware):
   - Accendi → connetti via cavo Ethernet al router del venue (sostituisci WAN).
   - Tutti i dispositivi continuano sulla stessa rete LAN, solo il backhaul cambia.
   - Banda migliore di hotspot smartphone.

3. **Modalità LAN-only (se NESSUN backup internet)**:
   - Vedi §3.B sotto. Più lavoro manuale ma evento procede senza cloud.

### §3.A — Verifica failover funzionante

- [ ] `ping 1.1.1.1` da mini-PC regia → risposta < 100ms.
- [ ] Apri `https://app.liveslidecenter.com/healthcheck.json` → 200 OK.
- [ ] Realtime cambio versione: testa 1 cambio versione regia → arriva al PC sala in < 2s.

### §3.B — MODALITÀ LAN-ONLY DI EMERGENZA (no internet, no failover possibile)

**Quando usare:** internet venue down + nessun hotspot disponibile + evento DEVE continuare.

**Prerequisiti tecnici:**

- Mini-PC regia ha Live SLIDE CENTER Desktop installato e già paired (license.enc valida).
- Tutti i PC sala sono sulla stessa rete LAN del mini-PC (stesso router/switch).

**Steps (ordine critico):**

1. **Trova IP del mini-PC regia:**

   ```powershell
   # Sul mini-PC regia:
   ipconfig | Select-String "IPv4"
   # Esempio output: IPv4 Address. . . . . . . . . . . : 192.168.1.42
   ```

   Annota l'IP (es. `192.168.1.42`).

2. **Verifica server Axum risponde sulla LAN:**

   ```powershell
   # Da un altro PC sulla stessa rete:
   Invoke-WebRequest http://192.168.1.42:7300/health
   # Deve dare 200 OK
   ```

   Se NON risponde: `Test-NetConnection 192.168.1.42 -Port 7300`. Se fallisce, controlla firewall sul mini-PC (regola "Live SLIDE CENTER" deve essere attiva sul profilo Privato).

3. **Switch URL su PC sala (per ogni PC sala connesso):**
   - Browser: chiudi tab cloud `app.liveslidecenter.com/sala/<token>`.
   - Apri nuovo tab: `http://192.168.1.42:7300/sala/<token>` (riusa lo stesso `pair_token` dal cloud).
   - L'app ricarica e usa il backend locale Axum invece di Supabase.

4. **Switch URL upload speaker (se ne devi caricare):**
   - QR code originale punta a cloud → speaker non può usarlo offline.
   - Genera URL LAN manualmente: `http://192.168.1.42:7300/u/<speaker_token>` (recupera `speaker_token` dal mini-PC: `/centro-slide/relatori`).
   - Comunica URL allo speaker via WhatsApp / verbalmente.

5. **Tutti i cambi versione regia ora funzionano via LAN** — il mini-PC fa fan-out HTTP push a tutti i PC sala registrati. Latenza tipica: < 500ms su LAN gigabit.

6. **Quando l'internet torna:**
   - Se Sprint Q hybrid sync è chiuso → sync automatico verso cloud parte entro 60s.
   - Se Sprint Q non chiuso → backup manuale: copia cartella `~/.slidecenter/data/` dal mini-PC verso macchina con internet, poi import manuale.

**Limiti modalità LAN-only:**

- Nuovi speaker NON registrati prima del down NON possono caricare (no nuovo `speaker_token` senza Supabase Auth).
- Nuovi PC sala NON paired prima del down NON possono entrare (no nuovo `pair_token` senza Supabase RPC).
- Telemetria perf NON arriva al cloud (resta solo locale sul mini-PC).

**Tempo medio switch a LAN-only:** 5 minuti se hai già provato la procedura. 15 minuti la prima volta sotto stress.

---

## §4 — EDGE FUNCTION SINGOLA IN ERRORE (3 minuti)

**Sintomi:** funzionalità specifica fallisce (es. invio email warning, verify license desktop, claim pair token), ma il resto dell'app funziona.

**Diagnosi:**

1. Apri Supabase dashboard → Edge Functions → cerca la funzione (es. `desktop-license-verify`).
2. Tab **Logs** → ultimi 10 min → cerca stack trace.
3. Categorie comuni:
   - `secret missing` → vai a Settings → Edge Functions → Secrets, verifica chiave (`SLIDECENTER_LICENSING_HMAC_SECRET`, `RESEND_API_KEY`, `EMAIL_SEND_INTERNAL_SECRET`).
   - `RPC not found` → migration mancante o RPC droppata. Vedi §4.A.
   - `429 rate limit` → tu o un client stai hammerando l'endpoint. Throttling client necessario.
   - `500 generic` → bug runtime, leggi stack trace.

### §4.A — Rollback singola edge function

Se l'ultimo deploy della funzione è il problema:

```bash
cd "C:\Users\andre\Desktop\Andrea Rizzari Live Software\Live SLIDE CENTER"
git log --oneline supabase/functions/<NOME_FUNZIONE>/index.ts | head -5
git checkout <COMMIT_PRECEDENTE> -- supabase/functions/<NOME_FUNZIONE>/index.ts
supabase functions deploy <NOME_FUNZIONE> --project-ref <PROJECT_REF>
# Verifica:
curl -I https://<PROJECT_REF>.supabase.co/functions/v1/<NOME_FUNZIONE>
git checkout HEAD -- supabase/functions/<NOME_FUNZIONE>/index.ts  # ripristina locale
```

In alternativa via MCP plugin Supabase in Cursor: chiama tool `deploy_edge_function` con il codice precedente in plain text (vedi `mcps/plugin-supabase-supabase/tools/`).

### §4.B — Disable temporaneo (se rollback non basta)

Per funzioni email cron (`email-cron-licenses`, `email-cron-desktop-tokens`):

1. Vai a Settings → Cron jobs → trova la riga del cron della funzione.
2. Click "Pause" → cron disabilitato finché non lo riattivi.

Per funzioni HTTP attive (`desktop-license-verify`, `pair-claim`, etc.): NON disable, perché blocchi l'app. Fixa il bug e rideploya.

---

## §5 — ERRORE SSL/CERT su `app.liveslidecenter.com` (5 minuti)

**Sintomi:** browser mostra "NET::ERR_CERT_DATE_INVALID" o pagina insicura.

**Causa probabile:** dominio scaduto su Aruba (per il sito `liveworksapp.com`) o config DNS errata.

**Verifica DNS:**

```powershell
nslookup app.liveslidecenter.com
# Output atteso: punta a Vercel (es. cname.vercel-dns.com)
```

**Risoluzione:**

1. Apri Vercel dashboard → progetto → Settings → Domains.
2. Verifica `app.liveslidecenter.com` ha stato **Valid Configuration** (verde).
3. Se rosso: clicca "Refresh" → Vercel rinegozia cert Let's Encrypt automaticamente in ~2 min.
4. Se ancora rosso dopo 5 min → verifica record CNAME su Aruba dashboard punti a `cname.vercel-dns.com`.
5. Workaround temporaneo: usa URL Vercel diretto `https://live-slide-center.vercel.app` (sempre valido).

**Tempo medio:** 5-15 min se è solo DNS, fino a 24h se devi cambiare provider DNS (raro).

---

## §6 — COMUNICAZIONE CLIENTI DURANTE INCIDENT (5 minuti)

**Filosofia:** trasparenza onesta + tempi realistici + canale chiaro per ricontattare.

### §6.A — Template WhatsApp / Email cliente singolo

> **Per cliente con 1 evento in corso, problema confermato.**

```
Ciao [Nome],

Abbiamo un problema tecnico con [Vercel | Supabase | internet venue]
da [HH:MM]. Sto lavorando alla risoluzione, stima [15 min | 1 ora].

L'evento NON si ferma — ti spiego:
- Le slide attualmente in onda restano visibili
- [Se LAN attiva] Stiamo passando a backup LAN locale, nessun cambio per gli speaker
- [Se cloud-only down] Per ora non posso caricare nuove versioni, ma quelle già in onda continuano

Ti aggiorno entro [TIMESTAMP].

Per emergenze immediate: chiamami [+39 ...].

Andrea — Live SLIDE CENTER
```

### §6.B — Template status page pubblica (se hai più clienti)

Da pubblicare su `/status` (Sprint 8) o canale Telegram pubblico:

```
[🟡 INCIDENT IN CORSO] — [TIMESTAMP] CET

Stato: investigando
Servizio impattato: [Realtime sync | Login | Upload speaker | tutto]
Causa probabile: [Supabase region EU degradation | Vercel deploy | rete venue]
Workaround: [usa modalità LAN locale | aspettare il ripristino, slide in onda restano visibili]
ETA risoluzione: [HH:MM CET | sotto 1 ora | indeterminato]

Aggiornamenti ogni 15 min in questo canale.

Per assistenza diretta: andrea@liveworksapp.com
```

### §6.C — Quando NON comunicare (importante)

- **Errori interni risolti in <2 min senza impatto utente** → silenzio, log per audit.
- **Errori in test/staging** → silenzio totale.
- **Sentry alert su 1 utente con browser preistorico** → ignora, non scalare a panico generale.

### §6.D — Post-incident report (entro 48h dall'incident)

Per clienti enterprise + per audit interno:

1. **Cosa è successo** (1 paragrafo, fattuale).
2. **Quando** (timestamp inizio, identificazione, mitigation, risoluzione).
3. **Impatto** (chi è stato colpito, come, quanto).
4. **Root cause** (perché è successo, NO blame, sì sistema).
5. **Cosa abbiamo fatto subito** (i passi presi).
6. **Cosa cambieremo per prevenirlo** (action items con owner + deadline).

Salva in `docs/INCIDENT_REPORTS/YYYY-MM-DD-<short-name>.md`.

---

## §7 — APP DESKTOP TAURI NON PARTE / pair_token RIFIUTATO (5 minuti)

**Sintomi:** Tauri app mostra banner "Token in scadenza" o "Token non valido", oppure non parte affatto.

### §7.A — Pair token scaduto (Sprint SR ha introdotto scadenza 12 mesi)

Codice errore visibile in DevTools console: `pair_token_expired` (HTTP 410).

**Soluzione utente finale (1 min):**

1. Browser admin: vai a `/centri-slide` → trova il device → click "Estendi 12 mesi".
2. Sul desktop: chiudi e riapri l'app → auto-renew parte automaticamente.

**Soluzione manuale via Supabase (3 min, se UI admin non funziona):**

```sql
-- Estendi token a +12 mesi:
UPDATE public.desktop_devices
   SET pair_token_expires_at = now() + interval '12 months'
 WHERE id = '<DEVICE_ID>';
```

### §7.B — License.enc corrotto

Sintomi: app parte ma non mostra mai "License attiva", banner sticky permanente.

```powershell
# Sul desktop:
Get-Item $env:APPDATA\slidecenter\license.enc
# Se file > 1KB e mtime recente: ok
# Se 0 byte o mancante: cancella e riprova bind:
Remove-Item $env:APPDATA\slidecenter\license.enc -Force
# Riapri app → richiederà nuovo bind via magic link
```

### §7.C — Server Axum locale non parte (porta 7300 occupata)

```powershell
# Verifica chi occupa la porta:
netstat -ano | findstr :7300
# Esempio output: TCP 0.0.0.0:7300 ... LISTENING 12345
# Killa processo offending:
Stop-Process -Id 12345 -Force
# Riapri Live SLIDE CENTER Desktop
```

---

## §8 — DATABASE SUPABASE CORROTTO (worst case, 1-4 ore)

**Probabilità:** estremamente bassa. Documentato per completezza.

**Sintomi:** errori SQL random, dati incoerenti, RPC ritornano garbage.

### §8.A — Restore da Point-in-Time Recovery (PITR)

**Prerequisito:** Supabase project su piano **Pro** o superiore (PITR ultimi 7 giorni). Verifica: dashboard → Settings → Backups.

**Stato attuale (da verificare in DR test):** Live SLIDE CENTER è su piano [Free | Pro | Team]? Annota qui: ___________

**Steps:**

1. Apri Supabase dashboard → progetto `live-slide-center` → **Database** → **Backups**.
2. Tab **Point in Time** → seleziona timestamp PRIMA della corruzione.
3. Click **Restore** → conferma. Operazione richiede 30 min - 2 ore a seconda della size.
4. **ATTENZIONE:** restore SOSTITUISCE il database corrente. Tutti i dati scritti DOPO il timestamp scelto sono persi.
5. Per non perdere dati nuovi: PRIMA del restore, esporta tabelle critiche con `pg_dump` da SQL Editor (vedi §8.B).

### §8.B — Backup manuale dump pre-restore

Da SQL Editor Supabase:

```sql
-- NB: pg_dump nativo NON disponibile in SQL Editor.
-- Workaround: SELECT * FROM <tabella> e copia output CSV.
-- Tabelle critiche da salvare:
SELECT * FROM tenants;
SELECT * FROM users;
SELECT * FROM events;
SELECT * FROM rooms;
SELECT * FROM sessions;
SELECT * FROM speakers;
SELECT * FROM presentations;
SELECT * FROM presentation_versions;
SELECT * FROM paired_devices;
SELECT * FROM desktop_devices;
```

Per dump completo: usa Supabase CLI:

```bash
supabase db dump --project-ref <PROJECT_REF> --data-only > backup-$(date +%Y%m%d-%H%M).sql
```

### §8.C — Restore migrations (se schema corrotto)

```bash
cd "C:\Users\andre\Desktop\Andrea Rizzari Live Software\Live SLIDE CENTER"
supabase db reset --project-ref <PROJECT_REF>  # DROP + RECREATE schema
supabase db push --project-ref <PROJECT_REF>   # Riapplica tutte le migrations
# Importa dati da backup CSV/SQL pre-corruzione
```

### §8.D — Worst case totale: nuovo progetto Supabase

Se il progetto Supabase è perso completamente (estremamente improbabile):

1. Crea nuovo progetto Supabase EU Frankfurt.
2. `supabase link --project-ref <NEW_REF>`.
3. `supabase db push` → applica tutte le migrations.
4. `supabase functions deploy` su tutte le 24 edge functions.
5. Aggiorna `.env` Vercel: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
6. Re-deploy Vercel.
7. Importa backup dati (se disponibile).
8. Re-pair tutti i device desktop (license.enc invalida, serve nuovo bind).

**Tempo:** 4-8 ore. Se ti trovi qui, l'evento è GIÀ COMPROMESSO. Comunica ai clienti.

---

## CHECKLIST PRE-EVENTO (compilare 1 settimana prima)

- [ ] Backup Supabase abilitato + verificato (download + restore test su tenant test).
- [ ] Vercel deploy ultimo è su commit stabile (nessun warning).
- [ ] Hotspot smartphone Andrea testato.
- [ ] Mini-PC regia: license.enc valida, NON in scadenza < 30 giorni.
- [ ] Tutti i secret Supabase Edge Functions presenti (cross-check: `SLIDECENTER_LICENSING_HMAC_SECRET`, `RESEND_API_KEY`, `EMAIL_SEND_INTERNAL_SECRET`, `PUBLIC_APP_URL`).
- [ ] Sentry alert email Andrea attivi.
- [ ] UptimeRobot alert SMS Andrea attivi (raccomandato anche se non ancora setupato).
- [ ] Questo documento + `FIELD_TEST_CHECKLIST.md` aperti su tablet pinnato.
- [ ] Numero di telefono di emergenza Andrea condiviso con clienti.

---

## RIFERIMENTI

- Architettura sistema: `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` §20 (account, deploy, infrastruttura).
- Procedura test: `docs/FIELD_TEST_CHECKLIST.md`.
- Setup ambiente test: `scripts/Setup-Field-Test-Env.ps1`.
- Vercel CLI fallback: `docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md` §20.3.1.
- Supabase status: [status.supabase.com](https://status.supabase.com).
- Vercel status: [vercel-status.com](https://vercel-status.com).
- Account ecosystem: vedi `CLAUDE.md` "MAPPA PROGETTI COMPLETA".
