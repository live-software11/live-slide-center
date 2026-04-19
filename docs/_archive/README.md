# Archivio storico — Live SLIDE CENTER

Questa cartella contiene documenti **storici, conclusi o superati** che vengono mantenuti
solo per riferimento (audit retrospettivi, post-mortem, tracce sprint chiusi).

## Regola

- **NON modificare** i file qui dentro: sono congelati alla data del loro ultimo update originale.
- **NON usarli come fonte di verità**: il contenuto è già stato consolidato nei doc canonici.
- Se serve recuperare qualcosa, **copia** in un nuovo file canonico nella `docs/` principale.

## Contenuto

| File | Data origine | Motivo archiviazione | Sostituito da |
|------|--------------|----------------------|---------------|
| `AUDIT_FINALE_E_PIANO_TEST_v1.md` | 2026-04-18 | Audit Sprint A→T-3 chiuso, contenuto consolidato | `../ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22 (storia) + `../STATO_E_TODO.md` § 1 (stato attuale) |
| `QA_FIX_REPORT_2026-04-18.md` | 2026-04-18 | Tutti i fix elencati sono stati applicati e validati | `../STATO_E_TODO.md` § 1 (riferimento sintetico) |
| `SPRINT_W_CLOSURE_REPORT.md` | 2026-04-19 | Sprint W chiuso, contenuto consolidato | `../CLAUDE.md` § stato + `../STATO_E_TODO.md` § 1 + `../ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22 |
| `STATO_E_TODO_storia_sprint.md` | 2026-04-19 | Sprint 0.1→0.29 (storico DONE) tagliato da `STATO_E_TODO.md` per snellirlo | `../ARCHITETTURA_LIVE_SLIDE_CENTER.md` § 22 (sintesi) |

## Quando archiviare un nuovo doc

Un documento va in `_archive/` quando **tutte** le condizioni sono vere:

1. Il contenuto è **storico** (sprint chiuso, audit retrospettivo, post-mortem completato).
2. Le informazioni utili sono già state **consolidate** in un doc canonico (ARCHITETTURA, STATO_E_TODO, CLAUDE).
3. Non viene **referenziato** da altri doc canonici, rules, o codice.

Aggiungi sempre una riga nella tabella sopra con: file, data, motivo, sostituito da.
