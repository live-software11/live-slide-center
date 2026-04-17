-- ════════════════════════════════════════════════════════════════════════════
-- Performance: aggiunta indici su tutte le foreign key non indicizzate
-- (23 advisor INFO `unindexed_foreign_keys`).
-- ════════════════════════════════════════════════════════════════════════════
-- Motivazione: ogni FK senza indice causa seq-scan in caso di:
--   - DELETE/UPDATE sulla tabella referenziata (verifica ON DELETE/UPDATE)
--   - JOIN tra le due tabelle dal lato child senza filtro tenant
-- Costo: ~32 byte per riga + INSERT marginalmente piu' lento (~5%).
-- Beneficio: query ON DELETE CASCADE diventano O(log n) invece di O(n).
-- ════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_events_created_by ON public.events(created_by);
CREATE INDEX IF NOT EXISTS idx_local_agents_tenant ON public.local_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_paired_devices_paired_by_user ON public.paired_devices(paired_by_user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_consumed_by_device ON public.pairing_codes(consumed_by_device_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_event ON public.pairing_codes(event_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_generated_by_user ON public.pairing_codes(generated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_room ON public.pairing_codes(room_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_tenant ON public.pairing_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_presentation_versions_tenant ON public.presentation_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_presentation_versions_uploaded_by ON public.presentation_versions(uploaded_by_user_id);
CREATE INDEX IF NOT EXISTS idx_presentations_current_version ON public.presentations(current_version_id);
CREATE INDEX IF NOT EXISTS idx_presentations_reviewed_by ON public.presentations(reviewed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_presentations_tenant ON public.presentations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_room_state_current_presentation ON public.room_state(current_presentation_id);
CREATE INDEX IF NOT EXISTS idx_room_state_current_session ON public.room_state(current_session_id);
CREATE INDEX IF NOT EXISTS idx_room_state_current_version ON public.room_state(current_version_id);
CREATE INDEX IF NOT EXISTS idx_room_state_tenant ON public.room_state(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rooms_tenant ON public.rooms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON public.sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_speakers_tenant ON public.speakers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_accepted_by ON public.team_invitations(accepted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_invited_by ON public.team_invitations(invited_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_data_exports_requested_by ON public.tenant_data_exports(requested_by_user_id);
