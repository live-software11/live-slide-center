// ════════════════════════════════════════════════════════════════════════════
// Sprint R-3 (G3) — room-device-upload-finalize
// ════════════════════════════════════════════════════════════════════════════
//
// Promuove la version 'uploading' a 'ready' dopo che il client ha completato
// l'upload diretto su Storage tramite signed upload URL. Verifica:
//  - device_token valido
//  - oggetto Storage realmente esistente (size confermato)
//  - sha256 in formato hex 64 char
//
// SIDE EFFECTS:
//  - presentation status: pending → uploaded
//  - altre versions 'ready' della stessa presentation → 'superseded'
//  - presentations.current_version_id aggiornato
//  - activity_log: actor='device' action='upload_finalize_room_device'
//
// REALTIME ADMIN NOTIFICATION:
//  Dopo finalize success, pubblichiamo broadcast `room:<roomId>` event
//  `room_device_upload_completed` per notificare l'admin in <1s.
//  La dashboard admin (RoomsAndDevicesView) puo' subscribersi al topic e
//  mostrare un toast "Sala A: nuovo file caricato dal PC sala (Mario Rossi.pdf)".
//
// SICUREZZA: la RPC ha GRANT EXECUTE solo a service_role.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

interface FinalizeInput {
  device_token?: string;
  version_id?: string;
  sha256?: string;
}

interface FinalizeRpcResult {
  ok: boolean;
  version_id: string;
  presentation_id: string;
  session_id: string | null;
  room_id: string;
  file_name: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    const body = (await req.json()) as FinalizeInput;
    const token = typeof body.device_token === 'string' ? body.device_token.trim() : '';
    const versionId = typeof body.version_id === 'string' ? body.version_id.trim() : '';
    const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : '';

    if (!token) return jsonRes({ error: 'missing_device_token' }, 400);
    if (!versionId) return jsonRes({ error: 'missing_version_id' }, 400);
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      return jsonRes({ error: 'invalid_sha256' }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'finalize_upload_version_for_room_device',
      {
        p_token: token,
        p_version_id: versionId,
        p_sha256: sha256,
      },
    );

    if (rpcError) {
      const msg = rpcError.message ?? 'rpc_error';
      if (msg.includes('device_not_found') || msg.includes('invalid_token')) {
        return jsonRes({ error: 'invalid_token' }, 401);
      }
      if (msg.includes('tenant_suspended')) return jsonRes({ error: 'tenant_suspended' }, 403);
      if (msg.includes('version_not_found_or_cross_tenant')) {
        return jsonRes({ error: 'version_not_found' }, 404);
      }
      if (msg.includes('version_not_uploading')) {
        return jsonRes({ error: 'version_not_uploading' }, 409);
      }
      if (msg.includes('object_missing')) {
        // Edge case: client ha chiamato finalize prima che lo Storage abbia
        // realmente persistito l'oggetto. Il client deve riprovare in 1-2s.
        return jsonRes({ error: 'object_missing' }, 409);
      }
      if (msg.includes('invalid_sha256')) return jsonRes({ error: 'invalid_sha256' }, 400);
      return jsonRes({ error: msg }, 400);
    }

    const result = rpcData as FinalizeRpcResult;
    if (!result?.ok) {
      return jsonRes({ error: 'finalize_failed' }, 500);
    }

    // Notifica realtime admin (best-effort, non blocchiamo la response al PC sala)
    try {
      const channel = supabaseAdmin.channel(`room:${result.room_id}`, {
        config: { broadcast: { self: false } },
      });
      // Subscribe + send + unsubscribe inline per evitare canale sospeso.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 2000); // max 2s
        channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            try {
              await channel.send({
                type: 'broadcast',
                event: 'room_device_upload_completed',
                payload: {
                  room_id: result.room_id,
                  presentation_id: result.presentation_id,
                  version_id: result.version_id,
                  session_id: result.session_id,
                  file_name: result.file_name,
                  at: new Date().toISOString(),
                },
              });
            } catch {
              /* best-effort */
            } finally {
              clearTimeout(timer);
              await supabaseAdmin.removeChannel(channel);
              resolve();
            }
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            clearTimeout(timer);
            await supabaseAdmin.removeChannel(channel);
            resolve();
          }
        });
      });
    } catch {
      /* notifica best-effort: il file e' comunque caricato e visibile */
    }

    return jsonRes(
      {
        ok: true,
        version_id: result.version_id,
        presentation_id: result.presentation_id,
        session_id: result.session_id,
        room_id: result.room_id,
        file_name: result.file_name,
      },
      200,
    );
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
