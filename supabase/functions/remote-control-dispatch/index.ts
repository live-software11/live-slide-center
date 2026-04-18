// Sprint T-3-G (G10) — Remote slide control da tablet (telecomando regista).
//
// Edge Function chiamata dalla PWA `/remote/<token>` (nessuna sessione utente
// Supabase, anonima + token nel body). Inoltra il comando alla RPC
// `rpc_dispatch_remote_command` SECURITY DEFINER, che:
//   - valida hash del token vs remote_control_pairings.token_hash
//   - rate-limit 60 cmd/min/pairing
//   - calcola target presentation_id (next/prev/goto/blank/first)
//   - aggiorna room_state -> trigger Sprint B propaga ad admin + sala
//   - logga in activity_log
//
// La RPC NON e' GRANTed ad anon: solo service_role. Quindi la chiamata
// MUST passare per questa Edge Function.
//
// Comandi accettati: next | prev | goto | blank | first.
// `goto` richiede `target_presentation_id`.
//
// Risposta:
//   200 { ok: true, room_id, command, presentation_id, started_at }
//   400 { error: 'invalid_command' | 'missing_target' | ... }
//   401 { error: 'token_invalid' | 'token_revoked' | 'token_expired' }
//   429 { error: 'rate_limited' }
//   500 { error: <internal> }
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const ALLOWED_COMMANDS = new Set(['next', 'prev', 'goto', 'blank', 'first']);

// Mappa codici di errore PostgreSQL -> HTTP status.
function mapErrorToStatus(message: string): number {
  if (
    message.includes('token_invalid') ||
    message.includes('token_revoked') ||
    message.includes('token_expired')
  ) {
    return 401;
  }
  if (message.includes('rate_limited')) {
    return 429;
  }
  if (
    message.includes('missing_token') ||
    message.includes('invalid_command') ||
    message.includes('missing_target') ||
    message.includes('target_not_in_event') ||
    message.includes('target_not_in_room') ||
    message.includes('target_not_ready') ||
    message.includes('no_active_session') ||
    message.includes('empty_schedule') ||
    message.includes('end_of_schedule') ||
    message.includes('start_of_schedule')
  ) {
    return 400;
  }
  return 500;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    const body = (await req.json()) as {
      token?: string;
      command?: string;
      target_presentation_id?: string | null;
    };

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return jsonRes({ error: 'missing_token' }, 400);

    const command = typeof body.command === 'string' ? body.command.trim().toLowerCase() : '';
    if (!ALLOWED_COMMANDS.has(command)) return jsonRes({ error: 'invalid_command' }, 400);

    let targetId: string | null = null;
    if (body.target_presentation_id !== undefined && body.target_presentation_id !== null) {
      if (typeof body.target_presentation_id !== 'string') {
        return jsonRes({ error: 'invalid_target_presentation_id' }, 400);
      }
      const trimmed = body.target_presentation_id.trim();
      // Validazione UUID basica per evitare query con stringhe arbitrarie.
      if (trimmed && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
        return jsonRes({ error: 'invalid_target_presentation_id' }, 400);
      }
      targetId = trimmed.length === 0 ? null : trimmed;
    }

    if (command === 'goto' && !targetId) {
      return jsonRes({ error: 'missing_target' }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await supabaseAdmin.rpc('rpc_dispatch_remote_command', {
      p_token: token,
      p_command: command,
      p_target_presentation_id: targetId,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      return jsonRes({ error: msg }, mapErrorToStatus(msg));
    }

    return jsonRes(data, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal_error';
    // Audit-fix 2026-04-18: NO leak `detail` al client (info disclosure). Log only.
    console.error('[remote-control-dispatch] unhandled', message);
    return jsonRes({ error: 'internal_error' }, 500);
  }
});
