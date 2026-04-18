// ════════════════════════════════════════════════════════════════════════════
// Sprint R-3 (G3) — room-device-upload-abort
// ════════════════════════════════════════════════════════════════════════════
//
// Cleanup version 'uploading' su errore client (utente cancella, network drop,
// browser chiuso). Marca la version come 'failed' cosi' non rimane orfana.
// La RPC aborta anche su tenant suspended per garantire pulizia ordinata.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

interface AbortInput {
  device_token?: string;
  version_id?: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    const body = (await req.json()) as AbortInput;
    const token = typeof body.device_token === 'string' ? body.device_token.trim() : '';
    const versionId = typeof body.version_id === 'string' ? body.version_id.trim() : '';

    if (!token) return jsonRes({ error: 'missing_device_token' }, 400);
    if (!versionId) return jsonRes({ error: 'missing_version_id' }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await supabaseAdmin.rpc('abort_upload_version_for_room_device', {
      p_token: token,
      p_version_id: versionId,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      if (msg.includes('device_not_found') || msg.includes('invalid_token')) {
        return jsonRes({ error: 'invalid_token' }, 401);
      }
      return jsonRes({ error: msg }, 400);
    }

    return jsonRes(data ?? { ok: true }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return jsonRes({ error: message }, 500);
  }
});

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
