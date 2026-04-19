-- Sprint W B1 (port di cloud `20260418250000_room_state_slide_index.sql`).
--
-- Aggiunge a `room_state` due colonne opzionali per posizione slide:
--   • `current_slide_index`  - 1-based, NULL se sconosciuto
--   • `current_slide_total`  - totale slide del file in onda, NULL se sconosciuto
--
-- Usato dalla `OnAirView` per mostrare "slide 12/87" della sala selezionata.
-- L'aggiornamento avviene da `rpc_room_player_set_current` esteso con due
-- parametri opzionali (vedi `server/rpc.rs` Sprint W C2). Backward-compat
-- preservata: se i parametri sono NULL, il comportamento resta identico.
--
-- ALTER TABLE non supporta IF NOT EXISTS su SQLite → tolleranza
-- "duplicate column name" gestita in `db.rs::run_migrations`.

ALTER TABLE room_state ADD COLUMN current_slide_index INTEGER;
ALTER TABLE room_state ADD COLUMN current_slide_total INTEGER;
