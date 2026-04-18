# EDGE FUNCTIONS — WARM-KEEP SETUP (cron-job.org)

> **Riferimento audit:** `docs/AUDIT_FINALE_E_PIANO_TEST_v1.md` §2.3
> **Sprint:** SR (Security Review +1 mese)
> **Stato:** Documento operativo. Procedura DA APPLICARE solo se i log
> Sentry/Supabase mostrano cold-start sostenuti > 500ms su una funzione
> hot-path (vedi sezione "Quando attivare" sotto).

---

## 1. Perchè

Le Supabase Edge Functions girano su Deno Deploy. Quando una funzione non
riceve traffico per ~5 minuti, il container viene spento; alla prossima
chiamata Deno deve fare boot del v8, leggere il bundle, eseguire
`Deno.serve(...)` → tipicamente **150-400ms** in più sulla prima richiesta.

Per gli endpoint usati durante un evento live (cambio versione, upload
file, verifica licenza desktop), un cold-start sporadico è invisibile.
Diventa percettibile (≥ 1s di lag) quando un cold-start coincide con
un'azione critica osservata da molte sale contemporaneamente.

Mitigazione standard (non anti-pattern, prassi documentata da
Supabase/Cloudflare/Vercel): **fare un GET ogni 5 minuti** su ciascuna
funzione hot-path. Il container resta caldo, il primo evento dopo il ping
risponde in < 50ms.

---

## 2. Quando attivare

Attivare il warm-keep **solo** se almeno UNA delle condizioni seguenti è
vera per ≥ 7 giorni consecutivi in produzione:

1. **Sentry** (`tag: edge_function`) mostra p95 latency > 500ms su una
   delle funzioni hot-path elencate in §3.
2. Logs Supabase Edge Functions (Dashboard → Edge Functions → `<name>` →
   Logs) hanno > 5% di richieste con `cold_start: true` e durata > 300ms.
3. Tester sul campo riporta lag visibile sul cambio slide / cambio
   versione / upload non spiegato da rete LAN.

Se nessuna condizione è vera dopo il primo mese di field-test: **non
attivare**, è 5€/mese di costo evitabile.

---

## 3. Funzioni hot-path da tenere warm

Lista ordinata per criticità live:

| #   | Funzione                      | Frequenza chiamata reale         | Ping warm-keep  |
| --- | ----------------------------- | -------------------------------- | --------------- |
| 1   | `room-player-bootstrap`       | 1x al join, 1x ogni 12s polling  | sì              |
| 2   | `room-player-set-current`     | ogni cambio slide/versione admin | sì              |
| 3   | `room-device-upload-init`     | ogni upload file (PC sala/admin) | sì              |
| 4   | `room-device-upload-finalize` | ogni upload file completato      | sì              |
| 5   | `desktop-license-verify`      | 1x ogni 6h per PC desktop bound  | facoltativa     |
| 6   | `desktop-license-renew`       | 1x ogni 12 mesi per PC bound     | NO (rara)       |
| 7   | `email-cron-licenses`         | cron interno 1x/giorno           | NO (cron pgsql) |
| 8   | `email-cron-desktop-tokens`   | cron interno 1x/giorno           | NO (cron pgsql) |

> **Regola:** ping le funzioni 1-4 sempre; aggiungi `desktop-license-verify`
> se il fleet di PC desktop bound supera ~10 unità.

---

## 4. Endpoint di ping

Tutte le Edge Functions Live SLIDE CENTER hanno un GET di health check
gratuito che ritorna 200 con body minimo (`{ok:true}` o `method_not_allowed`
404 → entrambi tengono caldo il container).

Formato URL (sostituire `<func>` con il nome funzione):

```
https://cdjxxxkrhgdkcpkkozdl.supabase.co/functions/v1/<func>
```

Header obbligatorio: nessuno (CORS preflight è abbastanza).

> **Nota CORS:** alcune funzioni rispondono `405 method_not_allowed` al GET.
> È OK: il container resta caldo lo stesso. Non serve fare POST con body
> reali (sprecherebbe rate-limit RPC).

---

## 5. Setup operativo cron-job.org

### 5.1 Account

1. Crea account su <https://console.cron-job.org/signup>.
2. Verifica email.
3. Tier free = 50 jobs/account, sufficiente per Live SLIDE CENTER.

### 5.2 Job standard (template)

Per ogni funzione della tabella §3:

| Campo                  | Valore                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| **Title**              | `Slide Center warm — <func>`                                         |
| **URL**                | `https://cdjxxxkrhgdkcpkkozdl.supabase.co/functions/v1/<func>`       |
| **Schedule**           | Every 5 minutes (`*/5 * * * *`)                                      |
| **Request method**     | `GET`                                                                |
| **Request headers**    | (nessuno)                                                            |
| **Save responses**     | NO (saturerebbe lo storage)                                          |
| **Notification**       | Email solo se 3 fallimenti consecutivi                               |
| **Treat as failure**   | HTTP 5xx / timeout. **NON** trattare 404/405 come failure (sono OK). |
| **Max execution time** | 10s                                                                  |

> Tip: usa la feature "Folder" di cron-job.org per raggruppare i 4-6 ping
> sotto la cartella `live-slide-center` → più ordine.

### 5.3 Verifica primo run

1. Salva il job, attendi 5 minuti.
2. Apri Supabase Dashboard → Edge Functions → `<func>` → Logs.
3. Devi vedere una riga ogni 5 min con method GET e status 200/405/404.
4. Se vedi 401/403 → la funzione richiede `apikey` header. Aggiungilo nel
   job cron-job (`apikey: <SUPABASE_ANON_KEY>`). L'anon key è pubblica per
   design (vedi `apps/web/src/lib/supabaseClient.ts`).

---

## 6. Costo previsto

- **Free tier cron-job.org:** 50 jobs, intervallo minimo 1 min → sufficiente.
- **Tier "Plus" 5€/mese:** 200 jobs + 30s intervallo + report email + SLA.
  Necessario solo se vuoi monitoring formale.
- **Lato Supabase:** 6 funzioni × 12 ping/h × 24h × 30gg = **51.840 invocazioni/mese**.
  Rientra nei 500.000 inclusi nel piano Pro Supabase. Costo marginale ZERO.

---

## 7. Disattivazione (se decidi di non usare)

1. cron-job.org → seleziona tutti i job nel folder `live-slide-center`.
2. Bulk action → **Pause**.
3. Se non riprendi entro 30 giorni → **Delete**.

Nessuna modifica codice/DB richiesta lato Live SLIDE CENTER per
disattivare: i ping cessano, le funzioni tornano a fare cold-start
on-demand. Comportamento invariato vs oggi.

---

## 8. Riferimenti

- [Supabase Edge Functions cold start docs](https://supabase.com/docs/guides/functions/cold-starts)
- [cron-job.org docs](https://docs.cron-job.org/)
- Audit interno: `docs/AUDIT_FINALE_E_PIANO_TEST_v1.md` §2.3 + APPENDICE C
- Logs latency reali: Sentry project `live-slide-center` → Performance →
  Transaction filter `op:edge`

---

**Ultimo aggiornamento:** Sprint SR (2026-04-18). Da rivedere dopo i primi
30 giorni di produzione live.
