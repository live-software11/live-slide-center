# Disaster Recovery — Live Slide Center

> Sprint W A4 — Runbook operativo per i 5 scenari di emergenza piu' probabili.
> Pensato per essere eseguito direttamente da Andrea o da un tech del team in
> meno di 15 minuti per scenario.

## Indice rapido

| Scenario                                | Severita | RTO target | Sezione                                 |
| --------------------------------------- | -------- | ---------- | --------------------------------------- |
| 1. Supabase down < 1h                   | Bassa    | passive    | [§1](#1-supabase-down--1h)              |
| 2. Supabase down > 1h                   | Media    | 30 min     | [§2](#2-supabase-down--1h-prolungato)   |
| 3. Supabase down > 24h o data-loss      | Critica  | 2-4h       | [§3](#3-supabase-down--24h-o-data-loss) |
| 4. Vercel down                          | Media    | 15 min     | [§4](#4-vercel-down)                    |
| 5. Perdita parziale DB / file storage   | Critica  | 1-3h       | [§5](#5-perdita-parziale-db--storage)   |

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

| Sorgente                                                                   | Cosa segnalare                                            | Dove arriva                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| GitHub Actions `Supabase Backup Verify (daily)`                            | Backup mancante > 26h                                     | Issue automatica `bug-backup` → email Andrea                               |
| GitHub Actions `DB Types Drift Check`                                      | Migration senza rigenerazione types                       | Fail PR (no merge possibile)                                               |
| [Supabase Status Page](https://status.supabase.com)                        | Incident regionale eu-west-1                              | RSS + bookmark Andrea                                                      |
| [Vercel Status Page](https://www.vercel-status.com)                        | Incident edge / deploy                                    | RSS + bookmark Andrea                                                      |
| Sentry web (cloud project Sentry)                                          | Spike di errori 500 / 5xx                                 | Email immediata Andrea                                                     |
| `https://app.liveslidecenter.com/healthz` (TODO Sprint X1, non ancora attivo) | Probe esterno UptimeRobot 5min                       | SMS Andrea                                                                 |

Tutti gli scenari sotto **partono dal presupposto** che almeno una delle
sorgenti sopra abbia confermato l'incident (no falsi positivi da rete domestica
o VPN).

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
       "rewrites": [
         { "source": "/(.*)", "destination": "/maintenance.html" }
       ]
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

| Data       | Scenario  | Durata | Note                                                    |
| ---------- | --------- | ------ | ------------------------------------------------------- |
| _(nessuno)_| _(n/a)_   | _(n/a)_| Documento creato in Sprint W A4, no incidenti reali ancora. |

---

## Riferimenti

- `scripts/verify-supabase-backup.ps1` — verifica backup giornaliero
- `.github/workflows/supabase-backup-verify.yml` — cron daily verify
- `docs/AUDIT_FINALE_E_PIANO_TEST_v1.md` — audit completo cloud + desktop
- `docs/STATO_E_TODO.md` — stato sprint corrente
- `.cursor/rules/01-data-isolation.mdc` — policy account & tenant isolation
