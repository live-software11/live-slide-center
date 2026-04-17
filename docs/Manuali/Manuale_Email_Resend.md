---
title: Manuale Email — Resend & Cron Licenze
version: 1.0 — Sprint 7
audience: Andrea (build & release)
ultimo aggiornamento: 2026-04-17
---

# Manuale Email — Resend & Cron Licenze

Guida operativa per configurare il sistema di **email transazionali** di Live
SLIDE CENTER (Sprint 7). Comprende:

1. Creazione account Resend e dominio mittente verificato.
2. Configurazione dei secret necessari su Supabase Edge Functions.
3. Deploy delle Edge Function `email-send` e `email-cron-licenses`.
4. Schedulazione del cron giornaliero per gli avvisi di scadenza licenza.
5. Test end-to-end e troubleshooting.

> **Audience.** Documento per Andrea (operations). Non destinato al cliente
> finale. I tenant non vedono mai questi step: ricevono solo le email risultanti.

## 1. Account Resend

1. Vai su [https://resend.com](https://resend.com) e registrati con
   `live.software11@gmail.com`.
2. Piano `Free`: 3.000 email/mese, 100/giorno. Sufficiente per uso interno DHS
   - warning licenze. Per produzione SaaS multi-tenant valutare il piano `Pro`
     (50.000 email/mese, ~$20/mese).
3. **Verifica dominio mittente** (consigliato `liveworksapp.com`):
   - Resend → `Domains` → `Add Domain` → `liveworksapp.com`.
   - Aggiungi i record DNS forniti (SPF + DKIM + DMARC) sul pannello Aruba
     dove e' registrato il dominio (vedi `docs/Riferimenti/DNS_liveworksapp.md`
     se esiste, altrimenti chiedi al provider DNS).
   - Attendi `Verified` (max 24h, di solito 5-10 minuti).
4. Crea API key: Resend → `API Keys` → `Create API Key` → permessi `Sending
access` su `liveworksapp.com`. Copia il valore (`re_...`) — non sara' piu'
   visualizzato.

> **Senza dominio verificato** Resend permette comunque l'invio dal mittente
> `onboarding@resend.dev`, utile solo per i test. In produzione e' obbligatorio
> il dominio proprio per evitare blocchi anti-spam.

## 2. Generazione `EMAIL_SEND_INTERNAL_SECRET`

Il secret protegge le chiamate server-to-server alle Edge Function (header
`x-internal-secret`). Genera un valore random >= 32 caratteri:

```powershell
# PowerShell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Esempio output:
`H6q8kF...verylongbase64string...==`

**Salvalo in 1Password / KeePass.** Lo userai sia per i secret Edge sia per il
cron esterno.

## 3. Configurazione secret Supabase Edge

Vai su Supabase Dashboard → progetto `slide-center` → `Edge Functions` →
`Secrets` → aggiungi:

| Secret                       | Valore                                                                |
| ---------------------------- | --------------------------------------------------------------------- |
| `RESEND_API_KEY`             | `re_xxx...` (dalla dashboard Resend)                                  |
| `RESEND_FROM_EMAIL`          | `Live Slide Center <noreply@liveworksapp.com>`                        |
| `EMAIL_SEND_INTERNAL_SECRET` | il valore generato al passo 2                                         |
| `PUBLIC_APP_URL`             | `https://app.liveworksapp.com` (URL pubblico Slide Center, opzionale) |

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sono iniettati automaticamente
> dal runtime Edge: non serve crearli a mano.

## 4. Deploy delle Edge Function

Dalla root del progetto Slide Center:

```powershell
# Una volta sola: link al progetto
supabase link --project-ref <PROJECT_REF>

# Deploy delle 3 nuove function Sprint 7
supabase functions deploy gdpr-export
supabase functions deploy email-send
supabase functions deploy email-cron-licenses
```

`gdpr-export` richiede JWT utente (admin) → `verify_jwt = true` (default).
`email-send` e `email-cron-licenses` sono server-to-server con
`verify_jwt = false` (gia' impostato in `supabase/config.toml`).

## 5. Test invio singolo (manuale)

Prima di schedulare il cron, verifica che l'invio funzioni:

```powershell
$secret = "<EMAIL_SEND_INTERNAL_SECRET>"
$url = "https://<PROJECT_REF>.supabase.co/functions/v1/email-send"

$body = @{
  tenant_id        = $null
  kind             = "welcome"
  recipient        = "tu@tuamail.it"
  data             = @{ full_name = "Andrea"; tenant_name = "Live Software"; language = "it" }
  idempotency_key  = "test_welcome_$(Get-Date -Format 'yyyyMMddHHmmss')"
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri $url -Method POST `
  -Headers @{ "x-internal-secret" = $secret; "Content-Type" = "application/json" } `
  -Body $body
```

Risposta attesa:

```json
{ "sent": true, "provider_message_id": "abc...", "log_id": "uuid-..." }
```

Verifica anche il log su DB:

```sql
SELECT * FROM public.email_log ORDER BY sent_at DESC LIMIT 5;
```

## 6. Schedulazione cron giornaliero (3 opzioni)

L'Edge `email-cron-licenses` deve essere chiamata **una volta al giorno** per
inviare gli avvisi T-30 / T-7 / T-1. Tre approcci, scegli quello piu' comodo:

### Opzione A — GitHub Actions (consigliato per Andrea)

Crea `.github/workflows/email-cron-licenses.yml`:

```yaml
name: Email Cron Licenses
on:
  schedule:
    - cron: '0 8 * * *' # 08:00 UTC = 09:00/10:00 IT
  workflow_dispatch: {}
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Supabase Edge
        env:
          SECRET: ${{ secrets.EMAIL_SEND_INTERNAL_SECRET }}
          PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
        run: |
          curl -fsSL -X POST \
            -H "x-internal-secret: $SECRET" \
            -H "Content-Type: application/json" \
            -d '{}' \
            "https://${PROJECT_REF}.supabase.co/functions/v1/email-cron-licenses"
```

Aggiungi i secret su GitHub: `Repository Settings → Secrets and variables →
Actions`:

- `EMAIL_SEND_INTERNAL_SECRET` (lo stesso del passo 2)
- `SUPABASE_PROJECT_REF` (es. `abcdefgh`)

### Opzione B — cron-job.org (gratuito, no GitHub)

1. Registrati su [https://cron-job.org](https://cron-job.org).
2. `Create cronjob` → URL = endpoint `email-cron-licenses`.
3. Schedule = `Daily at 08:00 UTC`.
4. Custom headers: `x-internal-secret: <secret>`, `Content-Type: application/json`.
5. Body: `{}`.
6. Timeout: 30s (default). Notifiche email su failure.

### Opzione C — pg_cron + http extension (richiede attivazione)

Solo se vuoi tutto on-Supabase senza dipendenze esterne:

```sql
-- Una volta sola, in Supabase Studio (richiede pg_cron + http)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http;

SELECT cron.schedule(
  'email-cron-licenses-daily',
  '0 8 * * *',
  $$
    SELECT http_post(
      'https://<PROJECT_REF>.supabase.co/functions/v1/email-cron-licenses',
      '{}'::text,
      'application/json',
      ARRAY[http_header('x-internal-secret', '<EMAIL_SEND_INTERNAL_SECRET>')]
    );
  $$
);
```

Verifica:

```sql
SELECT * FROM cron.job;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

## 7. Test cron in dry-run

Prima di abilitare l'invio reale, simula il cron senza inviare nulla:

```powershell
$body = '{ "dry_run": true }'
Invoke-RestMethod -Uri "$url-cron-licenses" -Method POST `
  -Headers @{ "x-internal-secret" = $secret; "Content-Type" = "application/json" } `
  -Body $body
```

Risposta:

```json
{
  "processed": { "license-expiring-30": 0, "license-expiring-7": 1, "license-expiring-1": 0 },
  "dry_run": true,
  "errors": []
}
```

Se vedi `processed` corretti e `errors: []`, togli `dry_run: true` e abilita
lo schedule reale.

## 8. Anti-spam idempotenza

L'RPC `list_tenants_for_license_warning` esclude automaticamente i tenant che
hanno gia' ricevuto un'email del tipo specificato per quella esatta data
`expires_at`. Significato pratico:

- Stesso tenant in scadenza T-7 → riceve **una sola** email per quella scadenza.
- Se l'admin rinnova (cambia `expires_at`) → la nuova scadenza ricomincia il
  conteggio idempotente.
- Anche eseguendo il cron 10 volte al giorno, non si generano duplicati.

Tabelle interessate:

```sql
SELECT * FROM public.email_log WHERE kind LIKE 'license-expiring%' ORDER BY sent_at DESC;
```

## 9. Troubleshooting

| Problema                                | Causa                                                | Risoluzione                                                                                                   |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 401 `unauthorized`                      | Secret non configurato o sbagliato                   | Verifica `EMAIL_SEND_INTERNAL_SECRET` lato Supabase E lato cron                                               |
| 502 `resend_failed`                     | API key Resend revocata o limite mensile             | Controlla dashboard Resend → API keys / Activity                                                              |
| Email finiscono in spam                 | Dominio non verificato o SPF/DKIM mancanti           | Verifica dominio su Resend (sez. 1.3); attendi propagazione DNS (max 24h)                                     |
| Cron fired ma `processed.{kind} = 0`    | Nessun tenant in scadenza in quel range              | Comportamento normale; verifica `SELECT id, name, expires_at FROM tenants WHERE expires_at < now() + 30 days` |
| `idempotency_key` duplicato             | Ritorna `{ skipped: true }` (non e' un errore)       | OK: l'email era gia' stata inviata, salta correttamente                                                       |
| `gdpr-export` 429 / `rate_limited_5min` | Admin ha gia' richiesto un export negli ultimi 5 min | Attendi 5 minuti prima di rifare la richiesta                                                                 |
| `expire_old_data_exports` non lanciato  | Funzione di housekeeping manuale                     | `SELECT public.expire_old_data_exports();` (o schedula via pg_cron)                                           |

## 10. Costi mensili stimati

| Voce                                | Free                          | Pro (>5k email/mese)       |
| ----------------------------------- | ----------------------------- | -------------------------- |
| Resend                              | 0 € (3.000 email/mese)        | $20/mese (50.000 email)    |
| Supabase Edge Functions invocations | 0 € (500k/mese inclusi Blaze) | 0 € (limiti molto alti)    |
| Storage `tenant-exports`            | conteggia su quota Storage    | conteggia su quota Storage |
| GitHub Actions schedule             | 0 € (illimitato per pubblici) | 0 € (privato 2.000 min/m)  |

**Per uso interno DHS:** rimani sul Free Resend; gli avvisi T-30/7/1 generano
~10 email/mese (1 admin + 4 tenant interni).

## 11. Estensioni future (Sprint 8+)

- Template email con `react-email` o `mjml` (oggi: HTML inline).
- `kind = 'event-published'`: gia' supportato dal backend, da invocare quando
  un evento passa da `draft` a `setup`/`active`.
- Endpoint admin `/admin/email-log` per super-admin (vedi
  `apps/web/src/features/admin/AdminAuditView.tsx`).
- Webhook Resend → tracking deliverability (bounces, opens) → DB.
- DSAR completo (Data Subject Access Request) con esportazione per singolo
  utente, oltre all'export tenant globale gia' presente.

---

**Mantenere aggiornato.** Quando cambia il flusso (nuovo `kind`, nuovo
template, nuovo schedule), aggiornare:

- Versione header (in alto)
- Sezioni 3 (secret), 6 (schedule), 9 (troubleshooting)
- File correlati: `supabase/functions/email-send/index.ts`,
  `supabase/functions/email-cron-licenses/index.ts`,
  `supabase/migrations/20260417140000_sprint7_operations.sql` (RPC
  `list_tenants_for_license_warning` e `log_email_sent`).
