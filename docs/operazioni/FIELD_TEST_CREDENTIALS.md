# Field Test — Account demo

> File **tracciato** in git (AGENTS.md lo indicava come gitignored: **non lo era** — `gh contents` lo leggeva da `main`). Dal 31/08/2026: **solo pattern + email**. Niente tabelle password, niente `service_role`, niente DSN, niente `.env`.
>
> **EN:** Tracked. Password *pattern* + `@fieldtest.local` emails only. No password table. Never commit `service_role`.

## Pattern password

```
FieldTest!<Tenant><Role>2026
```

- `<Tenant>` = `Alpha` oppure `Beta`
- `<Role>` = `Super` (super_admin), `Admin` (admin), `Coord` (coordinator), `Tech` (tech)

Stesso pattern in `scripts/Setup-Field-Test-Env.ps1` (idempotente). **NON riusare in produzione.**

## Email (`@fieldtest.local`, dominio fittizio non risolvibile)

Due tenant isolati (test RLS): slug `field-test-alpha`, `field-test-beta`.

| Email | Ruolo | Tenant |
| ----- | ----- | ------ |
| `super.alpha@fieldtest.local` | super_admin | alpha |
| `admin.alpha@fieldtest.local` | admin | alpha |
| `coord.alpha@fieldtest.local` | coordinator | alpha |
| `tech.alpha@fieldtest.local` | tech | alpha |
| `super.beta@fieldtest.local` | super_admin | beta |
| `admin.beta@fieldtest.local` | admin | beta |
| `coord.beta@fieldtest.local` | coordinator | beta |
| `tech.beta@fieldtest.local` | tech | beta |

Niente colonna password. UUID tenant/evento/sala: checklist e script, non questo file.

## Riprovisioning

1. Env vars valide in locale (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) — **mai in git**.
2. `scripts/Setup-Field-Test-Env.ps1`
3. Checklist: [`FIELD_TEST_CHECKLIST.md`](./FIELD_TEST_CHECKLIST.md)
4. Emergenze: [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md)
