import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Audit-fix AU-09 (2026-04-18) — fixture E2E per `rpc_move_presentation_to_session`.
 *
 * SCENARIO:
 *   Admin sposta una presentation da uno speaker a un altro speaker (di un'altra
 *   sessione, eventualmente di un'altra sala). Verifica:
 *     1) presentation.session_id e speaker_id aggiornati
 *     2) activity_log entry creata con action='move_presentation_to_session'
 *        e metadata.from_session_id / metadata.to_session_id corretti
 *     3) i nomi colonna mappati correttamente (audit-fix CRITICAL del 18/04
 *        per `actor_kind → actor`, `target_kind → entity_type`, `target_id
 *        → entity_id`, `details → metadata`).
 *
 * REGRESSION GUARD:
 *   Prima del fix CRITICAL del 18/04, la INSERT INTO activity_log usava nomi
 *   colonna inesistenti, sicche' la RPC sollevava `column does not exist` e
 *   tutto il move falliva con rollback.
 *
 * REQUISITI:
 *   - VITE_SUPABASE_URL + service_role key in env (per bypassare RLS lato test)
 *     - SUPABASE_SERVICE_ROLE_KEY (preferito CI) oppure VITE_SUPABASE_ANON_KEY
 *       + utente autenticato (richiede login flow, qui omesso per semplicita')
 *   - E2E_MOVE_PRESENTATION_ID: presentation esistente con session_id valida
 *   - E2E_MOVE_TARGET_SESSION_ID: sessione destinazione (stesso evento o
 *     altro evento se la RPC lo permette, ma stesso tenant)
 *   - Il test sposta avanti e indietro per essere idempotente.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PRESENTATION_ID = process.env.E2E_MOVE_PRESENTATION_ID ?? '';
const TARGET_SESSION_ID = process.env.E2E_MOVE_TARGET_SESSION_ID ?? '';

const RUN = !!(SUPABASE_URL && SERVICE_KEY && PRESENTATION_ID && TARGET_SESSION_ID);

test.describe('Move presentation activity_log (AU-09)', () => {
  test.skip(
    !RUN,
    'Skip: imposta SUPABASE_SERVICE_ROLE_KEY + E2E_MOVE_PRESENTATION_ID + E2E_MOVE_TARGET_SESSION_ID',
  );

  test('move + activity_log row con colonne corrette', async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Snapshot iniziale: leggi session_id corrente per il return-to-original
    const { data: before, error: beforeErr } = await supabase
      .from('presentations')
      .select('id, session_id, speaker_id')
      .eq('id', PRESENTATION_ID)
      .maybeSingle();
    expect(beforeErr).toBeNull();
    expect(before).not.toBeNull();
    const originalSessionId = before!.session_id;
    expect(originalSessionId).toBeTruthy();
    expect(originalSessionId).not.toEqual(TARGET_SESSION_ID);

    const tsBeforeMove = new Date().toISOString();

    // 2) Esegui move via RPC
    const { error: moveErr } = await supabase.rpc('rpc_move_presentation_to_session', {
      p_presentation_id: PRESENTATION_ID,
      p_target_session_id: TARGET_SESSION_ID,
    });
    expect(moveErr, 'rpc_move_presentation_to_session must succeed').toBeNull();

    // 3) Verifica state aggiornato
    const { data: after, error: afterErr } = await supabase
      .from('presentations')
      .select('id, session_id')
      .eq('id', PRESENTATION_ID)
      .maybeSingle();
    expect(afterErr).toBeNull();
    expect(after?.session_id).toBe(TARGET_SESSION_ID);

    // 4) Verifica activity_log entry con colonne corrette
    const { data: logs, error: logErr } = await supabase
      .from('activity_log')
      .select('id, action, entity_type, entity_id, metadata, created_at')
      .eq('action', 'move_presentation_to_session')
      .eq('entity_id', PRESENTATION_ID)
      .gte('created_at', tsBeforeMove)
      .order('created_at', { ascending: false })
      .limit(1);
    expect(logErr).toBeNull();
    expect(logs).not.toBeNull();
    expect(logs!.length).toBeGreaterThan(0);

    const log = logs![0];
    expect(log.entity_type).toBe('presentation');
    expect(log.entity_id).toBe(PRESENTATION_ID);
    expect(log.metadata).toBeDefined();
    const meta = log.metadata as Record<string, unknown>;
    expect(meta.from_session_id).toBe(originalSessionId);
    expect(meta.to_session_id).toBe(TARGET_SESSION_ID);

    // 5) Cleanup: rimettiamo la presentation nella session originale
    const { error: rollbackErr } = await supabase.rpc('rpc_move_presentation_to_session', {
      p_presentation_id: PRESENTATION_ID,
      p_target_session_id: originalSessionId,
    });
    expect(rollbackErr).toBeNull();
  });
});
