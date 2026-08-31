# Archivio storico — Live SLIDE CENTER

Documenti **storici, conclusi o superati**. Solo per audit retrospettivi. **Non sono fonte di verità.**

Layout 31/08/2026: questa cartella era `docs/_archive/`. I path nei file congelati possono ancora citare i vecchi nomi; i link utili nell'indice puntano ai doc canonici nuovi.

## Regola

- Non usare questi file per decisioni operative.
- Recuperare un pezzo utile = copiarlo in un doc canonico (`architettura/`, `operazioni/`, `implementazioni-future/`), non editare l'archivio come se fosse vivo.
- Nuovo storico: sposta qui **dopo** aver consolidato in ARCHITETTURA § 22 e/o STATO_E_TODO, e aggiungi una riga in tabella.

## Contenuto

| File | Data origine | Motivo | Sostituito da |
| ---- | ------------ | ------ | ------------- |
| `AUDIT_FINALE_E_PIANO_TEST_v1.md` | 2026-04-18 | Audit Sprint A→T-3 chiuso | [`../architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md`](../architettura/ARCHITETTURA_LIVE_SLIDE_CENTER.md) § 22 + [`../implementazioni-future/STATO_E_TODO.md`](../implementazioni-future/STATO_E_TODO.md) § 1 |
| `QA_FIX_REPORT_2026-04-18.md` | 2026-04-18 | Fix già applicati e validati | STATO_E_TODO § 1 |
| `SPRINT_W_CLOSURE_REPORT.md` | 2026-04-19 | Sprint W chiuso | [`../../CLAUDE.md`](../../CLAUDE.md) + STATO_E_TODO § 1 + ARCHITETTURA § 22 |
| `STATO_E_TODO_storia_sprint_0.1-0.29.md` | 2026-04-19 | Sprint 0.1→0.29 tagliati da STATO_E_TODO | ARCHITETTURA § 22 (sintesi) |
| `FIELD_TEST_CREDENTIALS.md` | 2026-04-18 / stub 2026-08-31 | Conteneva password; svuotato in reorg docs | Credenziali live solo su Raven/Andrea. Riprovisioning: `scripts/Setup-Field-Test-Env.ps1` |
