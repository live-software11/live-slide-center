# Field Test — Credenziali e ID

**Generato:** 2026-04-18 (provisioning via MCP Supabase)
**Progetto Supabase:** `live-slide-center` (ref `cdjxxxkrhgdkcpkkozdl`, eu-west-1)
**Account proprietario:** `live.software11@gmail.com`
**Re-creabile con:** `scripts/Setup-Field-Test-Env.ps1` (idempotente, password identiche).

> Questo file contiene credenziali **solo per ambiente di test**. Le email sono su dominio fittizio `@fieldtest.local` (non risolvibile). Il pattern password è deterministico per facilità d'uso (`FieldTest!<Tenant><Role>2026`).
> **NON usare lo stesso pattern in produzione.** **NON committare la `service_role` key.**

---

## 1. Pattern password (memorizzabile)

```
FieldTest!<Tenant><Role>2026
```

- `<Tenant>` = `Alpha` oppure `Beta`
- `<Role>` = `Super` (super_admin), `Admin` (admin), `Coord` (coordinator), `Tech` (tech)

Esempi: `FieldTest!AlphaAdmin2026`, `FieldTest!BetaTech2026`.

---

## 2. Tenant

| Slug                | ID (UUID)                              | Plan | Storage | Eventi/mese |
|---------------------|----------------------------------------|------|---------|-------------|
| `field-test-alpha`  | `417b4439-0ac9-476f-bbb4-ffddd3b588bc` | pro  | 1 TB    | 20          |
| `field-test-beta`   | `b76d7776-611f-4147-9c3b-514ce1da4701` | pro  | 1 TB    | 20          |

Entrambi sono indipendenti (testano isolamento RLS). Beta serve a verificare che un utente di Alpha NON veda mai dati di Beta (test T6 della checklist).

---

## 3. Utenti — Tenant Alpha (`field-test-alpha`)

| Email                          | Ruolo         | Password                       |
|--------------------------------|---------------|--------------------------------|
| `super.alpha@fieldtest.local`  | super_admin   | `FieldTest!AlphaSuper2026`     |
| `admin.alpha@fieldtest.local`  | admin         | `FieldTest!AlphaAdmin2026`     |
| `coord.alpha@fieldtest.local`  | coordinator   | `FieldTest!AlphaCoord2026`     |
| `tech.alpha@fieldtest.local`   | tech          | `FieldTest!AlphaTech2026`      |

**Nota su `super_admin`:** in `public.users.role` appare come `admin` (la enum DB non ha `super_admin`). Il ruolo super è solo nel JWT (`app_metadata.role = 'super_admin'`) e viene letto dalla funzione RLS `is_super_admin()`.

---

## 4. Utenti — Tenant Beta (`field-test-beta`)

| Email                          | Ruolo         | Password                       |
|--------------------------------|---------------|--------------------------------|
| `super.beta@fieldtest.local`   | super_admin   | `FieldTest!BetaSuper2026`      |
| `admin.beta@fieldtest.local`   | admin         | `FieldTest!BetaAdmin2026`      |
| `coord.beta@fieldtest.local`   | coordinator   | `FieldTest!BetaCoord2026`      |
| `tech.beta@fieldtest.local`    | tech          | `FieldTest!BetaTech2026`       |

---

## 5. Eventi demo (uno per tenant)

| Tenant            | Event ID                                | Nome                       | Date                    | Status |
|-------------------|-----------------------------------------|----------------------------|-------------------------|--------|
| field-test-alpha  | `7e3af553-abd8-401f-bfd3-c81c1e90a9d2`  | Field Test Aprile 2026     | 2026-04-24 → 2026-04-25 | setup  |
| field-test-beta   | `cb6b01a2-0a04-4b16-924a-b71dbe790265`  | Field Test Aprile 2026     | 2026-04-24 → 2026-04-25 | setup  |

Stato `setup` = evento non ancora "andato in onda". Per simulare evento attivo: in app cambia stato a `active`.

---

## 6. Sale, sessioni, speaker — Alpha

**Event ID:** `7e3af553-abd8-401f-bfd3-c81c1e90a9d2`

### Sala Plenaria (`d7ba80de-adb9-4caf-a822-85abfc4c89d7`)
- **Apertura — Field Test 2026** (`746868d1-a939-4ebf-86a8-d9fcac2721fa`)
  *24/04/2026 09:00–10:00 · ceremony · chair: Andrea Rizzari*
  Speaker: **Mario Rossi** (`e1a0de2f-1d36-496e-a312-8645b67638ce`)
- **Chiusura e Q&A** (`d4ce9396-dead-448f-a10f-f39ba84b563c`)
  *25/04/2026 16:00–17:00 · panel · chair: Andrea Rizzari*

### Sala Workshop (`2d9cd62c-84cb-4002-b72c-a526f60ed2fe`)
- **Demo Live SLIDE CENTER** (`c0c9903f-7a81-48b9-89d8-44380628470d`)
  *24/04/2026 10:30–12:00 · workshop*
  Speaker: **Anna Bianchi** (`18ce8b16-9529-416c-9ae5-2da0e6ce5b58`)

---

## 7. Sale, sessioni, speaker — Beta

**Event ID:** `cb6b01a2-0a04-4b16-924a-b71dbe790265`

### Sala Plenaria (`7c3acb62-1cce-41b1-9f6d-573f1cf3a88e`)
- **Apertura — Field Test 2026** (`793645d9-755a-4a47-a1b8-1c30995d338f`)
  *24/04/2026 09:00–10:00 · ceremony · chair: Andrea Rizzari*
  Speaker: **Mario Rossi** (`99e9321e-4f87-433d-9957-8ac53b8b6321`)
- **Chiusura e Q&A** (`459828a9-0ad7-4fd8-b079-ad9983731fe6`)
  *25/04/2026 16:00–17:00 · panel · chair: Andrea Rizzari*

### Sala Workshop (`cd0e4222-a5e4-4437-b44d-649fa95415d9`)
- **Demo Live SLIDE CENTER** (`9d965fc2-a7eb-49cf-8aa3-5055c818d707`)
  *24/04/2026 10:30–12:00 · workshop*
  Speaker: **Anna Bianchi** (`0e393137-df21-4832-8dc4-eeef53bde344`)

---

## 8. Quick verify — login + isolamento

### A. Login web (T1)
1. Apri `https://app.liveslidecenter.com/login` (o l'URL preview/staging che usi).
2. Inserisci `admin.alpha@fieldtest.local` / `FieldTest!AlphaAdmin2026`.
3. Atteso: dashboard di **Field Test Alpha**, vedi 1 evento "Field Test Aprile 2026".
4. Logout.
5. Ripeti con `admin.beta@fieldtest.local` / `FieldTest!BetaAdmin2026`.
6. Atteso: dashboard di **Field Test Beta**, vedi 1 evento (stesso nome ma diverso UUID).

### B. Test isolamento RLS (T6)
- Loggato come `admin.alpha`, prova a navigare a `/events/cb6b01a2-0a04-4b16-924a-b71dbe790265` (event di Beta).
- Atteso: **404 / "Evento non trovato"**, mai i dati di Beta.

### C. Verifica via SQL (Supabase Studio → SQL Editor)
```sql
-- Veduta finale dell'ambiente field test
SELECT t.slug, count(DISTINCT u.id) AS users, count(DISTINCT e.id) AS events,
       count(DISTINCT r.id) AS rooms, count(DISTINCT s.id) AS sessions,
       count(DISTINCT sp.id) AS speakers
FROM public.tenants t
LEFT JOIN public.users u ON u.tenant_id = t.id
LEFT JOIN public.events e ON e.tenant_id = t.id
LEFT JOIN public.rooms r ON r.tenant_id = t.id
LEFT JOIN public.sessions s ON s.tenant_id = t.id
LEFT JOIN public.speakers sp ON sp.tenant_id = t.id
WHERE t.slug LIKE 'field-test-%'
GROUP BY t.slug;
```

Risultato atteso:
| slug              | users | events | rooms | sessions | speakers |
|-------------------|-------|--------|-------|----------|----------|
| field-test-alpha  | 4     | 1      | 2     | 3        | 2        |
| field-test-beta   | 4     | 1      | 2     | 3        | 2        |

---

## 9. Reset / cleanup post field test

### Opzione A — Cancella SOLO i dati public (mantieni utenti auth)
```sql
DELETE FROM public.tenants WHERE slug LIKE 'field-test-%';
-- CASCADE cancella events, rooms, sessions, speakers, users (public).
```
Gli utenti `auth.users` rimangono ma non hanno più tenant. Per riassociarli, cancellali e ricrea.

### Opzione B — Cancellazione completa (auth + public)
1. Da Supabase Dashboard → **Authentication → Users**: filtra `@fieldtest.local`, seleziona tutti, **Delete users**.
2. Esegui SQL del punto A sopra.

### Opzione C — Reset password singolo utente
Da **Authentication → Users** → click utente → **Send password recovery** (non funziona con dominio `.local`) oppure **Reset password** (set manuale).

### Opzione D — Riprovisionare da zero
1. Esegui Opzione B.
2. Lancia `scripts/Setup-Field-Test-Env.ps1` con env vars valide → ripristina tutto identico.

---

## 10. Recap operativo

| Cosa serve                      | Dove guardare                                                      |
|---------------------------------|--------------------------------------------------------------------|
| Lista test da eseguire          | `docs/FIELD_TEST_CHECKLIST.md`                                     |
| Cosa fare se qualcosa va male   | `docs/DISASTER_RECOVERY.md`                                        |
| Riprovisionare ambiente         | `scripts/Setup-Field-Test-Env.ps1`                                 |
| Schema DB / migrazioni          | `supabase/migrations/*.sql`                                        |
| Trigger handle_new_user         | `supabase/migrations/20260417100000_team_invitations.sql`          |
| Audit completo + piano test     | `docs/AUDIT_FINALE_E_PIANO_TEST_v1.md`                             |

---

**Andrea, in pratica:** apri questo file, copia email + password, fai login. Se una password non funziona, è perché qualcuno (forse tu, forse un cleanup) ha cancellato l'utente. In quel caso: rilancia lo script (15 secondi e tutto è di nuovo lì).

---

## Appendice A — Note tecniche sul provisioning del 2026-04-18

Il provisioning iniziale è stato fatto via MCP Supabase con `INSERT` SQL diretto in `auth.users` (non via Auth Admin API). Conseguenza: i campi `confirmation_token`, `recovery_token`, `email_change_token_new/current`, `email_change`, `phone_change`, `phone_change_token`, `reauthentication_token` erano `NULL`, ma gotrue li si aspetta come stringhe vuote `''` (errore Go: `converting NULL to string is unsupported` → HTTP 500 al login).

**Fix applicato (una tantum, già eseguito):**
```sql
UPDATE auth.users SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change               = COALESCE(email_change, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE email LIKE '%@fieldtest.local';
```

**Verifica login post-fix (5 utenti su 5 OK):**
| Utente                              | Esito | JWT role     | tenant_id   |
|-------------------------------------|-------|--------------|-------------|
| `super.alpha@fieldtest.local`       | OK    | super_admin  | alpha       |
| `coord.alpha@fieldtest.local`       | OK    | coordinator  | alpha       |
| `tech.alpha@fieldtest.local`        | OK    | tech         | alpha       |
| `admin.beta@fieldtest.local`        | OK    | admin        | beta        |
| `super.beta@fieldtest.local`        | OK    | super_admin  | beta        |

**Lo script PowerShell `Setup-Field-Test-Env.ps1` NON ha questo problema** perché crea utenti via Auth Admin API (`POST /auth/v1/admin/users`), che è gotrue stesso a fare l'INSERT con i token vuoti corretti. Il fix sopra serve solo se in futuro qualcuno ricreerà utenti via SQL diretto.
