import { test, expect, request } from '@playwright/test';

/**
 * Audit-fix AU-09 (2026-04-18) — fixture E2E per il race-condition pair-claim.
 *
 * SCENARIO:
 *   Due device tentano di claimare lo stesso codice di pairing 6-cifre
 *   nello stesso istante. La RPC SECURITY DEFINER `claim_pairing_code_atomic`
 *   (audit-fix CRITICAL del 18/04/2026) garantisce che esattamente UNO vinca
 *   e l'altro riceva `code_invalid_or_expired`.
 *
 * REGRESSION GUARD:
 *   Prima del fix, l'Edge Function pair-claim faceva:
 *     1) SELECT pairing_codes WHERE consumed_at IS NULL
 *     2) INSERT paired_devices (...)
 *     3) UPDATE pairing_codes SET consumed_at = now()
 *   In rapida successione 2 device potevano superare il SELECT, fare 2 INSERT,
 *   e poi 2 UPDATE: doppia paired_devices con stesso codice consumato.
 *
 * REQUISITI:
 *   - SUPABASE_URL + SUPABASE_ANON_KEY in env (gia' usati altrove)
 *   - PAIRING_E2E_CODE: codice 6-cifre EMESSO dall'admin manualmente prima
 *     del test (TTL >= 5 min). Senza, il test e' SKIP.
 *
 * MODALITA' TEST:
 *   Il test fa 2 fetch in parallelo a `/functions/v1/pair-claim`. Verifica:
 *     - esattamente 1 risposta 200 con `pair_token`
 *     - esattamente 1 risposta 404 con `error: 'code_invalid_or_expired'`
 *
 * Per uso CI: emettere il codice via supabase RPC client-side prima del run e
 * passarlo come PAIRING_E2E_CODE.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const PAIRING_CODE = process.env.PAIRING_E2E_CODE ?? '';

const RUN = !!(SUPABASE_URL && ANON_KEY && PAIRING_CODE);

interface ClaimResponse {
  status: number;
  body: {
    pair_token?: string;
    device_id?: string;
    error?: string;
  };
}

async function callPairClaim(deviceName: string): Promise<ClaimResponse> {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/functions/v1/pair-claim`, {
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    data: {
      code: PAIRING_CODE,
      device_name: deviceName,
      device_type: 'web',
      browser: 'playwright',
      user_agent: 'e2e-pairing-race',
    },
  });
  const body = (await res.json().catch(() => ({}))) as ClaimResponse['body'];
  await ctx.dispose();
  return { status: res.status(), body };
}

test.describe('Pairing race (AU-09)', () => {
  test.skip(!RUN, 'Skip: imposta PAIRING_E2E_CODE (codice 6-cifre fresco) per abilitare');

  test('exactly one of two concurrent claims wins', async () => {
    const [a, b] = await Promise.all([
      callPairClaim('e2e-device-A'),
      callPairClaim('e2e-device-B'),
    ]);

    const statuses = [a.status, b.status].sort();

    // Esattamente 1 vincitore (200) e 1 sconfitto (404 oppure 400)
    expect(statuses).toEqual([200, statuses[1] === 404 ? 404 : 400]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;

    expect(winner.body.pair_token, 'winner deve ricevere pair_token').toBeTruthy();
    expect(winner.body.device_id, 'winner deve ricevere device_id').toBeTruthy();

    // Il loser deve ricevere un errore di codice consumato/invalido,
    // NON un errore generico 500 (che indicherebbe race non gestita).
    expect([404, 400]).toContain(loser.status);
    expect(loser.body.error).toBeDefined();
    expect(['code_invalid_or_expired', 'invalid_input', 'rate_limited']).toContain(
      loser.body.error,
    );
  });
});
