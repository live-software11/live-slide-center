# PRE_CODE_PREPARATION.md — Live SLIDE CENTER

> **⚠️ DEPRECATO — Aprile 2026**
> Questo documento e stato sostituito da **`docs/GUIDA_DEFINITIVA_PROGETTO.md`** che unifica tutto: analisi storage, architettura semplificata (PWA player, Supabase Storage), roadmap aggiornata e checklist pre-codice.
> **Non usare questo file.** Riferirsi esclusivamente a `docs/GUIDA_DEFINITIVA_PROGETTO.md`.

---

> **Scopo originale:** tutte le operazioni da completare **prima di scrivere la prima riga di codice applicativo** (Fase 1 del CURSOR_BUILD). Eseguire in ordine, spuntando ogni voce. Niente step può essere saltato.
> **Durata stimata:** 4-6 ore distribuite su 1-2 giorni.
> **Target:** Andrea Rizzari (vibe coder) con assistenza Cursor AI.

---

## PARTE A — Correzioni documentazione (30 min)

Prima di tutto allinea i 4 documenti esistenti. Ho rilevato 7 incongruenze da risolvere.

### A.1 — Allinea enum ruoli utenti
**File:** `docs/Istruzioni_Progetto_Claude_Live_Slide_Center.md` sezione RBAC.
**Azione:** chiarisci che `speaker` NON è un ruolo `users` ma un record in tabella `speakers` con `upload_token`. L'enum SQL `user_role` ha solo `admin|coordinator|tech`. Riscrivi così la tabella RBAC:
- **admin** (users.role) — tutto nel tenant
- **coordinator** (users.role) — CRUD sessioni/speaker, vista regia
- **tech** (users.role) — vista sala, download, stato sync
- **speaker** (tabella speakers, no auth) — upload via token univoco

### A.2 — Unifica funzione helper JWT
**File:** `docs/Istruzioni_Progetto_Claude_Live_Slide_Center.md`.
**Azione:** cerca ogni occorrenza di `auth.tenant_id()` e sostituisci con `public.app_tenant_id()`. È la funzione committata nella migration e va usata ovunque.

### A.3 — Allinea limiti piani SaaS (CRITICO)
Hai 3 valori diversi in 3 documenti. Decidi UN set canonico e propagalo ovunque. **Proposta consigliata:**

| Piano | €/mese | Eventi/mese | Storage | Sale/evento | Agent |
|-------|--------|-------------|---------|-------------|-------|
| Starter | 149 | 3 | 100 GB | 5 | 1 |
| Pro | 399 | 15 | 1 TB | 20 | 3 |
| Enterprise | da 990 | illimitati | custom | illimitate | illimitati |

**File da aggiornare:**
- `docs/SlideHub_Live_Commerciale.docx` (sezione Modello di Business)
- `docs/SlideHub_Live_CURSOR_BUILD.md` (sezione 9 + migration SQL default `storage_limit_bytes`)
- `packages/shared/src/constants/plans.ts` (se già creato)

### A.4 — Decisione storage MVP: salta Supabase Storage, vai direttamente su R2
**Razionale:** con file 1GB e 1TB/evento, Supabase Storage ti costa 90€ egress per evento grosso. R2 costa 0€ egress. Il setup R2 è di 20 minuti. Non vale la pena fare la migrazione dopo.
**Azione:** aggiorna `docs/SlideHub_Live_CURSOR_BUILD.md` ADR-002 eliminando la frase "Per MVP: si puo partire con Supabase Storage". Sostituiscila con "Per MVP: R2 direttamente, setup one-time da cruscotto Cloudflare."

### A.5 — Rimuovi Realtime da activity_log
**File:** `docs/SlideHub_Live_CURSOR_BUILD.md` sezione 5 commento Realtime + migration SQL.
**Azione:** abilita Supabase Realtime SOLO su `room_state`, `presentation_versions`, `local_agents`. Rimuovi `activity_log`. Per l'activity feed farai polling ogni 10 secondi (efficiente, economico, sufficiente per la vista regia).

### A.6 — Limite upload coerente
**Decisione:** limite tecnico hard a **2GB** (margine di sicurezza), ma enforce soft per piano:
- Starter: warning oltre 500MB, blocco oltre 1GB
- Pro: blocco oltre 2GB
- Enterprise: configurabile

Documenta in `packages/shared/src/constants/plans.ts`.

### A.7 — Valuta relazione session↔speaker
**Domanda da porti:** uno speaker può relazionare in più sessioni dello stesso evento? Se sì → serve tabella ponte `session_speakers(session_id, speaker_id)` con FK composite. Se no → l'attuale `speakers.session_id` va bene.
**Raccomandazione:** per MVP mantieni 1-a-1 (un record speaker per sessione, anche se la persona fisica è la stessa). Semplifica enormemente upload token e versioning. Nota questa decisione in ADR-006 del CURSOR_BUILD.

---

## PARTE B — Account e servizi esterni (60 min)

Verifica di avere TUTTI questi account attivi con l'email `live.software11@gmail.com`. Spunta ogni voce.

- [ ] **Supabase** — progetto `live-slide-center` creato, regione EU (Francoforte), piano Free OK per MVP. Copia `Project URL` e `anon key`.
- [ ] **Supabase CLI** — `supabase login` eseguito, `supabase link --project-ref <REF>` funziona dalla root monorepo.
- [ ] **Cloudflare** — account creato, carta aggiunta (R2 richiede metodo di pagamento anche se sotto soglia gratuita 10GB/mese).
- [ ] **Cloudflare R2** — bucket `live-slide-center-files` creato in EU, genera `R2 API Token` con permessi Object Read & Write, salva `Account ID`, `Access Key ID`, `Secret Access Key`, `S3 endpoint`.
- [ ] **GitHub** — account `live-software11` attivo, `gh auth status` mostra login corretto, repo `live-software11/live-slide-center` creato e `origin` collegato.
- [ ] **Vercel** — account collegato a `live-software11@gmail.com`, progetto `live-slide-center` creato (anche vuoto), collegato al repo GitHub per auto-deploy.
- [ ] **Lemon Squeezy** — store Live WORKS APP attivo (per fase 12, non serve subito ma verificalo per non trovarti bloccato).
- [ ] **Sentry** — progetto `live-slide-center` creato, DSN salvato (userai in Fase 15).

---

## PARTE C — Ambiente locale (90 min)

Verifica che questi comandi funzionino tutti, uno per uno. Se uno fallisce, risolvi prima di procedere.

### C.1 Core runtime
```powershell
node --version          # deve essere 22.x (LTS)
pnpm --version          # deve essere 9.x o superiore
rustc --version         # deve essere 1.77+
cargo --version         # incluso con rust
supabase --version      # CLI Supabase
gh auth status          # deve mostrare live-software11
docker --version        # Docker Desktop attivo
```

### C.2 MCP Cursor verificati attivi
Apri Cursor → Settings → Tools & MCP. Tutti devono essere **verde connesso** (non "Needs authentication"):
- [ ] `supabase-hosted` (PAT configurato, `pnpm run verify:supabase-mcp` passa)
- [ ] `context7` (documentazione aggiornata librerie)
- [ ] `sequential-thinking` (ragionamento strutturato)
- [ ] `GitHub` (operazioni repo)
- [ ] `filesystem` (accesso file locali)

### C.3 Estensioni Cursor installate
Checklist minima: `Tailwind CSS IntelliSense`, `ESLint`, `Prettier`, `rust-analyzer`, `Tauri`, `Even Better TOML`, `i18n Ally`, `Error Lens`.

### C.4 Variabili ambiente (`.env.local` in apps/web)
Crea il file da `.env.example` e riempi con valori VERI:
```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_APP_NAME="Live SLIDE CENTER"
VITE_APP_VERSION=0.0.1
```
**NON committare mai `.env.local`** (deve essere in `.gitignore`, verifica).

---

## PARTE D — Database e schema (60 min)

### D.1 Applica migration iniziale
```bash
cd "C:\Users\andre\Desktop\Andrea Rizzari Live Software\Live SLIDE CENTER"
supabase start                    # avvia stack locale (serve Docker)
supabase db reset                 # applica migration da zero
```
Verifica nella dashboard locale (`http://localhost:54323`) che tutte le 11 tabelle esistano.

### D.2 Test RLS manuale (CRITICO)
Apri SQL Editor locale ed esegui questo test di isolamento:
```sql
-- Crea 2 tenant fake
INSERT INTO tenants (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B', 'tenant-b');

-- Crea 1 evento per tenant A
INSERT INTO events (tenant_id, name, start_date, end_date)
VALUES ('11111111-1111-1111-1111-111111111111', 'Evento A', '2026-05-01', '2026-05-02');

-- Simula JWT di tenant B e verifica che NON veda l'evento di A
-- (test completo in Fase 3 con pgTAP, per ora basta verificare la policy esiste)
SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'events'::regclass;
-- Deve restituire: tenant_isolation | ALL
```

### D.3 Genera types TypeScript
```bash
supabase gen types typescript --local > packages/shared/src/types/database.ts
```
Verifica che il file contenga i types per tutte le 11 tabelle + enum.

### D.4 Link progetto remoto
```bash
supabase link --project-ref <TUO_REF>
supabase db push                  # applica migration al progetto cloud
```

---

## PARTE E — Design e UX (2 ore) — NON SALTARE

Questa è la parte più importante e quella che i vibe coder saltano sempre, pagandola carissima dopo. Investi 2 ore qui e risparmi 2 settimane dopo.

### E.1 Wireframe a mano dei 5 schermi chiave
Prendi carta e penna (sì, davvero) e disegna:
1. **Dashboard eventi** — lista eventi attivi, stato, numero sale/speaker
2. **Vista Regia live** — griglia sale con stato sync real-time (è IL killer feature)
3. **Upload Portal relatore** — pagina mobile-first con QR code, drag&drop, barra progresso
4. **Room Player overlay** — cosa vede il tecnico in sala (versione, stato, sala)
5. **Export fine evento** — pulsante "Chiudi evento", conferma, download ZIP

Non serve arte, servono box e frecce. 30 min a schermo.

### E.2 Valida la Vista Regia con 2 tecnici reali
Chiama 2 colleghi del settore (anche al telefono) e mostra il wireframe cartaceo della Vista Regia. Chiedi: *"Se avessi questa schermata davanti durante un evento di 5 sale, cosa ti mancherebbe?"*. Annota ogni risposta. Queste risposte valgono oro — sono le feature che ti differenzieranno.

### E.3 Scegli 1 componente shadcn di riferimento per stile
Vai su `https://ui.shadcn.com/examples/dashboard` e scegli il layout dashboard che ti piace di più. Sarà il tuo riferimento visivo per la Fase 3. Salvalo come screenshot in `docs/design/reference.png`.

---

## PARTE F — Piano di Fase 1 (15 min)

Quando hai completato A-E, scrivi in un file `docs/FASE_1_KICKOFF.md` queste 3 cose:
1. **Obiettivo Fase 1 in 1 frase:** "Signup che crea tenant + utente admin, login funzionante, dashboard vuota protetta da auth."
2. **Definition of Done:** typecheck/lint/build verdi, RLS testata manualmente, deploy Vercel funzionante con login end-to-end.
3. **Timeboxing:** massimo 3 giorni di lavoro Cursor. Se sfori, fermati e chiedi aiuto.

---

## ✅ Checklist finale pre-codice

Prima di scrivere il prompt "inizia Fase 1" a Cursor, verifica:

- [ ] Tutte le 7 incongruenze documentali risolte (Parte A)
- [ ] Tutti gli account creati e credenziali salvate in password manager (Parte B)
- [ ] Tutti i comandi della Parte C funzionano senza errori
- [ ] `supabase db reset` locale applica lo schema senza errori
- [ ] Types TypeScript generati e committati
- [ ] 5 wireframe cartacei fatti, fotografati, salvati in `docs/design/`
- [ ] Validato Vista Regia con almeno 1 tecnico reale
- [ ] `docs/FASE_1_KICKOFF.md` scritto

Quando TUTTE queste caselle sono spuntate, apri Cursor e scrivi:

> "Leggi `docs/SlideHub_Live_CURSOR_BUILD.md` e `docs/FASE_1_KICKOFF.md`. Inizia la FASE 1 generando un `PLAN.md` dettagliato. Non scrivere codice finché non confermo il piano. Spiega tutto in italiano."

---

## 🚨 Red flags che devono farti fermare

Se durante la preparazione incontri uno di questi, **fermati e chiedi aiuto** prima di procedere:

1. `supabase start` fallisce con errori Docker persistenti
2. MCP `supabase-hosted` resta in "Needs authentication" dopo 3 tentativi di restart Cursor
3. Migration SQL fallisce con errori su `auth.jwt()` (potrebbe essere versione Supabase CLI troppo vecchia)
4. `pnpm run typecheck` fallisce dopo la generazione dei types
5. Non riesci a trovare 2 tecnici per validare la Vista Regia (→ validalo con me in chat, ti faccio da tecnico devil's advocate)

---

**Tempo totale stimato:** 4-6 ore. Fallo in 2 sessioni, non tutto di corsa. La qualità della preparazione determina la velocità di esecuzione delle 15 fasi successive.
