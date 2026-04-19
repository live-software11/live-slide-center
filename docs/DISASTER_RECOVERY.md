# Disaster Recovery — Live Slide Center

> Sprint W A4 — Runbook operativo per i 5 scenari di emergenza piu' probabili.
> Pensato per essere eseguito direttamente da Andrea o da un tech del team in
> meno di 15 minuti per scenario.

## Indice rapido

| Scenario                              | Severita | RTO target | Sezione                                       |
| ------------------------------------- | -------- | ---------- | --------------------------------------------- |
| 0. Hotfix rotto in produzione         | Critica  | 2-5 min    | [§0](#0-rollback-rapido-deploy-vercel-rotto)  |
| 1. Supabase down < 1h                 | Bassa    | passive    | [§1](#1-supabase-down--1h)                    |
| 2. Supabase down > 1h                 | Media    | 30 min     | [§2](#2-supabase-down--1h-prolungato)         |
| 3. Supabase down > 24h o data-loss    | Critica  | 2-4h       | [§3](#3-supabase-down--24h-o-data-loss)       |
| 4. Vercel down                        | Media    | 15 min     | [§4](#4-vercel-down)                          |
| 5. Perdita parziale DB / file storage | Critica  | 1-3h       | [§5](#5-perdita-parziale-db--storage)         |

> **RTO** = Recovery Time Objective (tempo target per ripristino servizio).
> **RPO** = Recovery Point Objective (massima perdita di dati accettabile).
> Per Live Slide Center cloud: RTO < 4h, RPO < 24h (backup giornaliero verificato).

---

## Pre-requisiti operativi

Prima di intervenire su uno scenario serve:

1. **Account Supabase** — `live.software11@gmail.com` con MFA. Project
   `cdjxxxkrhgdkcpkkozdl` ("Live Slide Center", region eu-west-1).
2. **Personal Access Token Supabase** (`SUPABASE_ACCESS_TOKEN`, prefisso `sbp_…`)
   salvato in 1Password sotto "Live Slide Center / Supabase PAT".
3. **Account Vercel** collegato all'org `andrea-rizzari` con accesso al
   progetto `live-slide-center`.
4. **Account GitHub** `live-software11` con permessi `admin` sul repo
   `live-software11/Live-SLIDE-CENTER`.
5. **DNS Aruba** del dominio `liveslidecenter.com` — credenziali Aruba root
   in 1Password. Necessarie solo per scenario 4 (DNS swap a fallback host).
6. **Repo locale** clonato su almeno una macchina fidata, con `pnpm 9.15.x`
   e `supabase` CLI 2.20+ installati.

> **REGOLA SACRA:** prima di qualsiasi operazione distruttiva su Supabase o
> Vercel, `firebase login:use live.software11@gmail.com` e `gh auth status`
> devono confermare l'account corretto. Vedi `.cursor/rules/01-data-isolation.mdc`.

---

## Monitoraggio e detection

| Sorgente                                                                      | Cosa segnalare                      | Dove arriva                                  |
| ----------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| GitHub Actions `Supabase Backup Verify (daily)`                               | Backup mancante > 26h               | Issue automatica `bug-backup` → email Andrea |
| GitHub Actions `DB Types Drift Check`                                         | Migration senza rigenerazione types | Fail PR (no merge possibile)                 |
| [Supabase Status Page](https://status.supabase.com)                           | Incident regionale eu-west-1        | RSS + bookmark Andrea                        |
| [Vercel Status Page](https://www.vercel-status.com)                           | Incident edge / deploy              | RSS + bookmark Andrea                        |
| Sentry web (cloud project Sentry)                                             | Spike di errori 500 / 5xx           | Email immediata Andrea                       |
| `pnpm smoke:cloud` (T-1h evento)                                              | Smoke test pre-evento manuale       | Output console + exit code                   |
| `https://app.liveslidecenter.com/healthz` (TODO Sprint X1, non ancora attivo) | Probe esterno UptimeRobot 5min      | SMS Andrea                                   |

Tutti gli scenari sotto **partono dal presupposto** che almeno una delle
sorgenti sopra abbia confermato l'incident (no falsi positivi da rete domestica
o VPN).

---

## 0. Rollback rapido (deploy Vercel rotto)

**Severita:** critica. Un deploy appena promosso a produzione ha rotto qualcosa
di essenziale (login, upload, route). Tutti i tenant vedono un'app inutilizzabile
o con errori 5xx. Si tratta del caso piu' frequente in real-world: bug
introdotto da un fix, dipendenza che non builda, env-var mancante.

### Sintomi

- Smoke test cloud fallisce (`pnpm smoke:cloud`).
- Errori 5xx generici sulla homepage o sulle route principali.
- Utenti tenant segnalano "app non si apre" subito dopo un push GitHub.
- Sentry (se attivo) mostra spike di errori `[release=slidecenter-web@N+1]`.

### Procedura veloce (2-5 min, ZERO codice)

Vercel mantiene tutti i deploy precedenti come immutabili e permette di
ri-promuoverli istantaneamente. Non serve `git revert` ne' redeploy: si
ri-aliasea il dominio produzione su un deploy precedente sano.

#### Opzione A — Da CLI (preferita, 60 secondi)

```powershell
# 1. Lista i 10 deploy piu' recenti del progetto live-slide-center.
#    Ti serve il PROJECT_NAME = "live-slide-center" e il TEAM_SCOPE
#    (di solito "livesoftware11-3449s-projects").
vercel ls live-slide-center --scope livesoftware11-3449s-projects | Select-Object -First 15

# Output esempio:
#  Age   Deployment                                         Status     Environment
#  3m    https://live-slide-center-abc123.vercel.app        Ready      Production    <-- rotto, in alias ora
#  2h    https://live-slide-center-xyz789.vercel.app        Ready      Preview       <-- ultimo verde
#  3h    https://live-slide-center-def456.vercel.app        Ready      Production    <-- precedente verde

# 2. Identifica l'ULTIMO deploy "Production" verde (il penultimo Production di norma).
#    Copia la URL completa (https://live-slide-center-def456.vercel.app).

# 3. Promuoviloa produzione (rimappa app.liveslidecenter.com).
vercel promote https://live-slide-center-def456.vercel.app --scope livesoftware11-3449s-projects --yes

# 4. Verifica.
pnpm smoke:cloud
```

> **Tempo totale:** 60-120 secondi. Nessuna build, nessun rebuild Vercel:
> `vercel promote` cambia solo il routing edge.

#### Opzione B — Da dashboard Vercel (90 secondi, funziona da telefono)

1. Apri <https://vercel.com/livesoftware11-3449s-projects/live-slide-center/deployments>.
2. Trova la riga del deploy **precedente** marcato **Production / Ready**
   (NON quello attuale, ma il penultimo).
3. Click sui tre puntini "..." a destra → **"Promote to Production"**.
4. Conferma. La rotazione DNS edge avviene in 5-10 secondi.
5. `pnpm smoke:cloud` per verifica.

### Cosa NON fare

- **NO** `git revert HEAD && git push`: dura 3-5 minuti per buildare e ridepoyare,
  e ti lascia senza la modifica anche per gli ambienti `preview`. Usa il revert
  solo DOPO aver fatto il rollback CLI/dashboard, per allineare il repo.
- **NO** `vercel rollback`: il comando esiste ma e' deprecato e in alcuni
  contesti non rispetta lo scope team. `promote <url>` e' piu' affidabile.
- **NO** togliere `vercel.json` per "tornare al default": lascia gli header
  di sicurezza fuori, e' un'altra emergenza.

### Dopo il rollback

1. Apri una issue GitHub `incident: rollback {data} ` con:
   - SHA del commit incriminato (`git log --oneline -5`).
   - Output dello smoke test fallito.
   - Causa root identificata.
2. Crea un branch `hotfix/{descrizione}` con il fix corretto.
3. **Verifica in preview** prima di rimergiare a `main`:
   `pnpm smoke:cloud --url https://live-slide-center-{preview-hash}.vercel.app`.
4. Promuovi a produzione solo dopo smoke verde.

### Perche' funziona

I deploy Vercel sono **immutabili**: ogni push genera un nuovo URL univoco
(`live-slide-center-{hash}.vercel.app`) che resta vivo per sempre. L'alias
produzione (`live-slide-center.vercel.app`) e' solo un puntatore mutabile.
`vercel promote` riassegna il puntatore senza ricostruire nulla.

> **TODO Sprint X3:** automazione "auto-rollback se smoke fail" via GitHub
> Action post-deploy. Per ora resta manuale ma documentato qui.

---

## 1. Supabase down < 1h

**Severita:** bassa. Probabile incident transitorio della regione `eu-west-1`
o manutenzione programmata.

### Sintomi

- Dashboard Supabase mostra incident attivo.
- App Live Slide Center ritorna 500/timeout su login o caricamento eventi.
- I PC sala in modalita LAN/desktop continuano a funzionare (sono offline-first).

### Azioni

1. **Aprire** la [status page Supabase](https://status.supabase.com) e verificare
   l'ETA pubblicato.
2. **Comunicare** sul gruppo WhatsApp tecnico l'incident e l'ETA (es. "Supabase
   down, ETA 30 min, riproveremo in autonomo. PC sala continuano a girare.").
3. **Non fare** rollback / restore. L'app cloud reagisce automaticamente
   appena Supabase torna su (Realtime riconnette, query si ritentano lato client).
4. **Verificare** dopo 30-60 min:
   - Login admin funziona.
   - Lista eventi ritorna dati.
   - Realtime ri-sottoscrive (osservare contatore in `OnAirView` / `RegistaView`
     che torna a "online").
5. Se l'evento e' in corso e l'ETA cresce oltre 60 min → escalare a §2.

### NO-GO

- Non eseguire `supabase db reset` o restore senza prima verificare in §3
  che ci sia effettivo data-loss.

---

## 2. Supabase down > 1h prolungato

**Severita:** media. Il servizio cloud e' degradato per un tempo che impatta
gli eventi in corso. Le installazioni desktop offline LAN restano operative.

### Azioni

1. **Attivare** la maintenance page statica.
   - Aggiungere alla configurazione Vercel un rewrite verso `/maintenance.html`:

     ```bash
     # da repo locale
     git checkout -b maintenance-banner
     # editare apps/web/public/maintenance.html (gia' versionato in Sprint Q+1)
     # poi vercel.json: aggiungere rewrites
     ```

   - Editare `apps/web/vercel.json` aggiungendo `rewrites` temporaneo:

     ```json
     {
       "rewrites": [{ "source": "/(.*)", "destination": "/maintenance.html" }]
     }
     ```

   - `git commit -m "ops: maintenance banner attivo"` + `git push`.
   - Vercel auto-deploy in 60s, oppure forzare con
     `vercel --prod --yes --archive=tgz` dalla root monorepo.

2. **Comunicare** ai tenant (email manuale) che lavorino in modalita desktop
   LAN per gli eventi in corso. Nessuna perdita dati: gli upload restano in coda
   locale e si sincronizzano automaticamente al ripristino.

3. **Stand-by** finche' Supabase non torna up. Evitare di ipotizzare data-loss
   prematuramente.

4. **Ripristino:**
   - Verificare Supabase tornato up via dashboard + status page.
   - Revert del rewrite in `vercel.json` (commit + push).
   - Verifica end-to-end: login, lista eventi, upload file, realtime.

### NO-GO

- Non spostare il DNS Aruba prima di aver almeno tentato §2 step 1-2.
- Non eliminare il project Supabase. Pazienza > impulsivita'.

---

## 3. Supabase down > 24h o data-loss

**Severita:** critica. Si attiva il piano "Project Restore" su nuovo project
con migrazione DNS e re-issue token.

### Pre-requisiti

- Backup giornaliero `verify-supabase-backup.ps1` ha confermato un backup
  recente (entro 26h dal disastro).
- Accesso admin Supabase + email per creare nuovo progetto.

### Azioni

1. **Creare nuovo project Supabase** in regione `eu-west-1` (stessa per non
   richiedere modifica CSP / latenze):
   - Nome: `Live Slide Center DR <data>`.
   - DB password: NUOVA, salvata in 1Password.
   - PostgreSQL version: stessa del project precedente (vedi
     `database.version` in `list_projects` MCP).

2. **Restore backup** dal vecchio project:

   ```bash
   # 1. scarica latest backup dal vecchio project (Supabase dashboard → Database → Backups)
   # 2. ripristina su nuovo project:
   psql -h db.<NEW_REF>.supabase.co -U postgres -d postgres < backup.sql
   ```

   Se il vecchio project e' totalmente irraggiungibile, usare l'ultimo backup
   esportato in `Documents/SlideCenterBackupReports/` (riportato dal cron
   `verify-supabase-backup.ps1`).

3. **Riapplicare migrazioni recenti** non incluse nel backup:

   ```bash
   pnpm supabase db push --project-ref <NEW_REF>
   ```

   Verifica con `pnpm db:diff` che non ci siano divergenze.

4. **Re-deploy Edge Functions** sul nuovo project:

   ```bash
   pnpm fn:deploy --project-ref <NEW_REF>
   ```

5. **Aggiornare env Vercel** del progetto `live-slide-center`:

   ```bash
   vercel env rm VITE_SUPABASE_URL production
   vercel env add VITE_SUPABASE_URL production
   # → incolla il nuovo URL https://<NEW_REF>.supabase.co
   vercel env rm VITE_SUPABASE_ANON_KEY production
   vercel env add VITE_SUPABASE_ANON_KEY production
   # → incolla la nuova anon key dal nuovo project
   ```

   Stesso giro per ogni env-var Supabase referenced (es. service-role key per
   Edge Functions, se presente in env Vercel).

6. **Re-deploy SPA** Vercel: `vercel --prod --yes --archive=tgz` dalla root.

7. **Notificare tenant** via email automatica (template in
   `supabase/functions/email-send/templates/`):
   - "Servizio ripristinato. I PC desktop server collegati richiedono
     riautenticazione (logout + magic-link nuovo)."
   - Allegato: PDF con istruzioni.

### Stima downtime

- Provisioning nuovo project: 5-10 min.
- Restore backup (DB ~500MB): 10-20 min.
- Migrazioni + Edge Functions: 5-10 min.
- DNS / env Vercel: 5 min (propagazione 1-5 min).
- **Totale: 30-60 min** per servizio nuovamente accessibile.

### NO-GO

- Non eliminare il vecchio project finche' non sono passati 7 giorni dal
  ripristino e non e' confermato che il nuovo e' stabile (backup compresi).

---

## 4. Vercel down

**Severita:** media. Solo l'edge globale Vercel e' down. Supabase + desktop LAN
funzionano. La SPA cloud non e' raggiungibile.

### Sintomi

- `https://app.liveslidecenter.com` ritorna 5xx o timeout.
- Dashboard Vercel mostra incident.

### Azioni

1. **Verificare** [Vercel status](https://www.vercel-status.com).
2. Se downtime previsto < 30 min → attendere senza intervenire.
3. Se downtime > 30 min e c'e' evento attivo:
   - **Attivare host fallback** (servizio statico mirror).
   - TODO Sprint X2: setup Cloudflare Pages mirror auto-deploy. Per ora il
     fallback e' manuale: caricare `dist/` su un altro hosting (Aruba sottocartella
     o Cloudflare Pages free).
   - Cambiare DNS Aruba → A record `app` da Vercel IP a fallback.
   - **TTL DNS attuale: 1h** (definito in pannello Aruba). Pianificare propagazione.
4. Comunicare ai tenant: "App cloud temporaneamente al fallback. Stessa URL,
   funzionalita pari salvo Realtime (potrebbe essere intermittente).".

### Ripristino

- Verificare Vercel status risolto.
- Riportare DNS Aruba A record a IP Vercel.
- Attendere propagazione DNS (1h max con TTL attuale).

### NO-GO

- Non cambiare il dominio principale. Se serve, comunicare via email/WhatsApp,
  non cambiare la URL pubblicata.

---

## 5. Perdita parziale DB / Storage

**Severita:** critica. Una collection o uno storage bucket ha perso dati ma il
servizio e' altrimenti up.

### Casi tipici

- Tenant cancellato per errore (cascade delete su tabella `tenants`).
- Bucket Storage `slidecenter-files` con file mancanti dopo migrazione.
- Tabella `presentations` con righe orfane (es. session cancellata).

### Azioni

1. **Identificare scope perdita**:

   ```sql
   -- Esempio: contare righe per tenant negli ultimi 7 giorni
   SELECT
     tenant_id,
     COUNT(*) as total,
     MAX(created_at) as latest
   FROM presentations
   WHERE created_at > NOW() - interval '7 days'
   GROUP BY tenant_id;
   ```

   Confronta con il backup giornaliero piu' recente (download dal pannello
   Supabase → Backups).

2. **Restore parziale** (Supabase Pro: PITR — Point-In-Time Recovery):
   - Pannello Supabase → Database → PITR → scegliere timestamp pre-incident.
   - PITR crea automaticamente un branch temporaneo da cui esportare i dati
     mancanti.
   - **Restore manuale** delle sole tabelle/righe perse (NON sostituire l'intero
     DB, perdi i dati nuovi).

3. **Restore Storage** (file mancanti):

   ```bash
   # 1. lista file nel bucket attuale
   supabase storage ls slidecenter-files --project-ref <REF> > current.txt
   # 2. confronta con lista da backup precedente
   diff current.txt backup-files-YYYY-MM-DD.txt
   # 3. ricarica solo i file mancanti dal backup locale o richiedi re-upload speakers
   ```

4. **Notifica tenant impattati** via email se i file persi non sono
   recuperabili da backup (es. file caricati nelle ultime 6h pre-incident).
   Template: "Si e' verificata una perdita parziale di dati per il tuo evento
   `<NOME>`. Ti chiediamo di ricaricare i file <ELENCO>. Il servizio resta
   operativo per tutto il resto. Ci scusiamo per il disagio."

5. **Post-mortem**: aprire issue GitHub con label `incident`, taggare cause
   root, aggiungere alle prevention checklist (es. pre-flight checks Sprint
   field-test).

### Strumenti utili

- **Supabase MCP plugin** (gia' attivo in Cursor): permette query veloci tipo
  `execute_sql` o `list_tables` per diagnosi.
- **`supabase db dump --schema public --file backup.sql`**: backup manuale
  on-demand prima di interventi rischiosi.

### NO-GO

- Non eseguire `TRUNCATE` o `DELETE` su tabelle senza backup garantito.
- Non spegnere PITR (e' la safety net principale).

---

## Checklist pre/post DR action

Prima di ogni operazione critica:

- [ ] Verificato account Supabase corretto (`live.software11@gmail.com`).
- [ ] Verificato account GitHub corretto (`gh auth status` → `live-software11`).
- [ ] Backup manuale del DB prima dell'intervento
      (`supabase db dump --file pre-action-YYYYMMDDHHMM.sql`).
- [ ] Comunicato ai tenant impattati l'inizio intervento.

Dopo:

- [ ] Verificato login + lista eventi + upload + realtime.
- [ ] Comunicato ai tenant la conclusione.
- [ ] Aggiornato questo doc se sono emerse lezioni nuove.
- [ ] Aperto post-mortem GitHub issue (label `incident`) con timeline + cause.

---

## Storia incident reali

> Aggiornare a ogni intervento DR per accumulare conoscenza.

| Data        | Scenario | Durata  | Note                                                        |
| ----------- | -------- | ------- | ----------------------------------------------------------- |
| _(nessuno)_ | _(n/a)_  | _(n/a)_ | Documento creato in Sprint W A4, no incidenti reali ancora. |

---

## Setup Sentry (runtime error monitoring)

Senza Sentry siamo "ciechi" rispetto agli errori in produzione: scopriamo i bug
solo quando un tenant chiama o quando li riproduciamo a posteriori. Setup
una-tantum di 5 minuti, gratis fino a 5k eventi/mese.

### Step 1 — Crea progetto Sentry

1. <https://sentry.io/signup/> (account gratuito; o GitHub login con
   `live-software11`).
2. **Create Project** → Platform: **React** → Project name: `live-slide-center-web`.
3. Copia il DSN dalla schermata setup. Formato:
   `https://<key>@o<org-id>.ingest.sentry.io/<project-id>`.

### Step 2 — Aggiungi env-var su Vercel

```powershell
vercel env add VITE_SENTRY_DSN production
# Incolla il DSN quando richiesto.

# (opzionale ma consigliato)
vercel env add VITE_SENTRY_DSN preview
vercel env add VITE_SENTRY_DSN development
```

### Step 3 — Redeploy produzione

```powershell
vercel deploy --prod --yes --archive=tgz
```

### Step 4 — Verifica

```powershell
pnpm smoke:cloud
# Cerca la riga: [OK]   ~ Sentry runtime configurato
```

In alternativa: apri devtools del browser su <https://app.liveslidecenter.com>,
network tab, filtra per "sentry.io" → al primo errore vedrai una richiesta
POST verso `ingest.sentry.io`.

### Cosa NON fare

- **NO** mettere il DSN nel repo: e' env-var pubblica ma comunque preferibile
  passarla solo via Vercel env per poterla ruotare.
- **NO** alzare `tracesSampleRate` sopra 0.1 senza monitorare il consumo: la
  performance tracing consuma quota in fretta su un'app con molti `useEffect`.

### Quota gratuita

Sentry free: 5k errori/mese + 10k transactions. Per Live Slide Center attuale
(~10 tenant test, evento da 50-100 speakers) bastano largamente. Se la quota
satura → upgrade a Team ($26/mese) o passare a Sentry self-hosted.

---

## Riferimenti

- `scripts/verify-supabase-backup.ps1` — verifica backup giornaliero
- `.github/workflows/supabase-backup-verify.yml` — cron daily verify
- `apps/web/scripts/smoke-test-cloud.mjs` — smoke test cloud production
  (`pnpm smoke:cloud`)
- `apps/desktop/scripts/smoke-test.mjs` — smoke test desktop offline pre-evento
- `docs/AUDIT_FINALE_E_PIANO_TEST_v1.md` — audit completo cloud + desktop
- `docs/STATO_E_TODO.md` — stato sprint corrente
- `.cursor/rules/01-data-isolation.mdc` — policy account & tenant isolation
