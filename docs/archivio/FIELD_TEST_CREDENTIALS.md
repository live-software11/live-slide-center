# Field Test — Credenziali (stub)

**Questo file non contiene password.**

Le credenziali live dell'ambiente field test (`@fieldtest.local`) stanno solo su macchina Raven / Andrea, **non in git**. Non copiare password, DSN, `service_role` o `.env` in questo repo.

**EN:** Live field-test passwords are not in git. They live only on Raven / Andrea.

## Come ottenere un ambiente di test

1. Chiedi ad Andrea le credenziali attuali (non sono versionate).
2. Oppure riprovisiona in locale con `scripts/Setup-Field-Test-Env.ps1` (idempotente; richiede env vars valide, mai committate).
3. Tenant attesi (slug, non secret): `field-test-alpha`, `field-test-beta` — servono a verificare isolamento RLS.
4. Email di test usano il dominio fittizio `@fieldtest.local` (non risolvibile). **NON riusare lo stesso schema password in produzione.**

## Dove altro guardare

| Cosa | Dove |
| ---- | ---- |
| Checklist T1–T19 + smoke | [`../operazioni/FIELD_TEST_CHECKLIST.md`](../operazioni/FIELD_TEST_CHECKLIST.md) |
| Emergenze durante l'evento | [`../operazioni/DISASTER_RECOVERY.md`](../operazioni/DISASTER_RECOVERY.md) |
| Cosa resta da fare | [`../implementazioni-future/STATO_E_TODO.md`](../implementazioni-future/STATO_E_TODO.md) |
| Piano test storico (read-only) | [`AUDIT_FINALE_E_PIANO_TEST_v1.md`](./AUDIT_FINALE_E_PIANO_TEST_v1.md) |

Una copia precedente di questo file (aprile 2026) conteneva password in chiaro ed è stata svuotata il 31/08/2026 in sede di reorg docs. Lo storico git le conserva: non reintrodurle nel working tree.
