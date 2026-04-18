import { test, expect, request } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Audit-fix AU-09 (2026-04-18) — fixture E2E per remote-control-dispatch.
 *
 * SCENARIO:
 *   Tablet pairato come telecomando regista: invia comandi `next`, `prev`,
 *   `goto`, `blank`, `first` all'Edge Function `remote-control-dispatch`.
 *   La RPC `rpc_dispatch_remote_command` valida hash token, applica rate limit
 *   60 cmd/min/pairing, calcola target presentation_id, aggiorna room_state
 *   e logga in activity_log.
 *
 * REGRESSION GUARD:
 *   - Verifica che il token plain ottenuto da `rpc_create_remote_control_pairing`
 *     sia accettato dall'Edge Function (hash matching corretto).
 *   - Verifica che command 'invalid_command' ritorni 400, non 500.
 *   - Verifica che il rate limit globale 120/min/IP (audit-fix AU-05) NON
 *     blocchi una sequenza normale di 5 comandi consecutivi (next/prev/...).
 *
 * REQUISITI:
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: per emettere il pairing
 *   - VITE_SUPABASE_ANON_KEY: per chiamare l'Edge Function come anon
 *   - E2E_REMOTE_ROOM_ID: room_id valida (con almeno 1 sessione + 1 presentation)
 *
 * Il test crea il pairing all'inizio e lo revoca alla fine (cleanup).
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ROOM_ID = process.env.E2E_REMOTE_ROOM_ID ?? '';

const RUN = !!(SUPABASE_URL && ANON_KEY && SERVICE_KEY && ROOM_ID);

interface DispatchResponse {
  status: number;
  body: {
    ok?: boolean;
    room_id?: string;
    command?: string;
    presentation_id?: string | null;
    started_at?: string;
    error?: string;
  };
}

async function dispatch(token: string, command: string, target?: string): Promise<DispatchResponse> {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/functions/v1/remote-control-dispatch`, {
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    data: {
      token,
      command,
      target_presentation_id: target ?? null,
    },
  });
  const body = (await res.json().catch(() => ({}))) as DispatchResponse['body'];
  await ctx.dispose();
  return { status: res.status(), body };
}

test.describe('Remote control dispatch (AU-09)', () => {
  test.skip(
    !RUN,
    'Skip: imposta SUPABASE_SERVICE_ROLE_KEY + E2E_REMOTE_ROOM_ID per abilitare',
  );

  test('pairing → dispatch sequence happy path + invalid command + cleanup', async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Crea pairing remote control. Service role ha permessi diretti su
    //    rpc_create_remote_control_pairing; in produzione lo chiama l'admin
    //    autenticato dalla pagina sala.
    const { data: pairing, error: pairingErr } = await supabase.rpc(
      'rpc_create_remote_control_pairing',
      {
        p_room_id: ROOM_ID,
        p_name: 'e2e-remote-test',
        p_ttl_minutes: 60,
      },
    );
    expect(pairingErr, 'rpc_create_remote_control_pairing must succeed').toBeNull();
    expect(pairing).toBeDefined();
    const p = pairing as { pairing_id?: string; token?: string };
    const pairingId = p.pairing_id;
    const token = p.token;
    expect(pairingId).toBeTruthy();
    expect(token).toBeTruthy();

    try {
      // 2) Comando invalido → 400, NON 500
      const invalid = await dispatch(token!, 'fly_to_the_moon');
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toBe('invalid_command');

      // 3) Sequenza di 5 comandi validi consecutivi (rate limit 120/min/IP).
      //    Non assert sul body presentation_id (dipende dalla schedule live);
      //    l'importante e' che NESSUNO sia 429 o 500.
      const cmds = ['first', 'next', 'next', 'prev', 'blank'];
      for (const cmd of cmds) {
        const r = await dispatch(token!, cmd);
        // Accettiamo 200 (ok) o 400 funzionali (es. 'no_active_session',
        // 'empty_schedule', 'end_of_schedule'). NON 401/429/500.
        expect([200, 400]).toContain(r.status);
        expect(r.status).not.toBe(401);
        expect(r.status).not.toBe(429);
        expect(r.status).not.toBe(500);
      }

      // 4) Goto senza target → 400 'missing_target'
      const goto = await dispatch(token!, 'goto');
      expect(goto.status).toBe(400);
      expect(goto.body.error).toBe('missing_target');
    } finally {
      // 5) Cleanup: revoca il pairing
      const { error: revokeErr } = await supabase.rpc('rpc_revoke_remote_control_pairing', {
        p_pairing_id: pairingId,
      });
      // Non bloccante: log only (cleanup best-effort)
      if (revokeErr) {
        console.warn('[e2e remote-control] cleanup revoke failed', revokeErr.message);
      }
    }
  });
});
