// ════════════════════════════════════════════════════════════════════════════
// Sprint R-3 (G3) — room-device-upload-init
// ════════════════════════════════════════════════════════════════════════════
//
// OBIETTIVO: il PC sala (autenticato col solo `device_token`, no JWT utente)
// avvia l'upload di una nuova versione file su una sessione della propria sala.
//
// FLUSSO:
//   1) Verifica device_token + valida payload
//   2) Chiama RPC `init_upload_version_for_room_device`:
//        - hash token vs paired_devices.pair_token_hash
//        - check tenant suspended, evento closed/archived
//        - check session.room_id == device.room_id (NO cross-room)
//        - check file_size, storage quota
//        - crea presentation 'pending' + version 'uploading' (upload_source='room_device')
//        - activity log con actor='device' actor_id=device_id
//   3) Genera signed upload URL Storage (createSignedUploadUrl) con storage_key
//      restituito dalla RPC. Validita' 2h (default Supabase, sufficiente per
//      file fino a ~5GB su connessione 4G).
//   4) Risponde al PC sala con: { version_id, presentation_id, storage_key,
//      bucket, signed_url, token, path }
//
// SICUREZZA: la RPC `init_upload_version_for_room_device` ha
// GRANT EXECUTE solo a service_role. Solo questa Edge Function (con
// SUPABASE_SERVICE_ROLE_KEY) puo' chiamarla. Il PC sala non puo' bypassare
// la validazione tentando una chiamata supabase.rpc() diretta.
//
// LIMITI Edge Function: NON proxy del file (sarebbe 6MB max + raddoppio
// banda). Il client riceve signed URL e fa PUT diretto su Storage.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { checkAndRecordEdgeRate, clientIpFromRequest, hashIp } from '../_shared/rate-limit.ts';

interface InitInput {
  device_token?: string;
  session_id?: string;
  filename?: string;
  size?: number;
  mime?: string;
}

interface InitRpcResult {
  version_id: string;
  presentation_id: string;
  storage_key: string;
  bucket: string;
  room_id: string;
  device_id: string;
  session_id: string;
  tenant_id: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    const body = (await req.json()) as InitInput;

    const token = typeof body.device_token === 'string' ? body.device_token.trim() : '';
    const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
    const size = typeof body.size === 'number' ? body.size : NaN;
    const mime = typeof body.mime === 'string' && body.mime.trim().length > 0
      ? body.mime.trim()
      : 'application/octet-stream';

    if (!token) return jsonRes({ error: 'missing_device_token' }, 400);
    if (!sessionId) return jsonRes({ error: 'missing_session_id' }, 400);
    if (!filename) return jsonRes({ error: 'missing_filename' }, 400);
    if (filename.length > 255) return jsonRes({ error: 'filename_too_long' }, 400);
    if (!Number.isFinite(size) || size <= 0) return jsonRes({ error: 'invalid_size' }, 400);
    // Hard cap sicurezza: 5GB. Le RPC validano anche il cap del piano del tenant.
    if (size > 5 * 1024 * 1024 * 1024) return jsonRes({ error: 'file_too_large' }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Audit-fix AU-05: rate limit per IP. 30 richieste / 5 minuti / IP.
    // Sufficiente per upload normali (1 PC sala fa ~5-10 upload all'ora);
    // blocca brute-force token enumeration.
    const ipHash = await hashIp(clientIpFromRequest(req));
    const rate = await checkAndRecordEdgeRate(supabaseAdmin, {
      ipHash,
      scope: 'room-device-upload-init',
      maxPerWindow: 30,
      windowMinutes: 5,
    });
    if (rate && !rate.allowed) {
      console.warn('[room-device-upload-init] rate-limited', { ipHash, count: rate.count });
      return jsonRes({ error: 'rate_limited' }, 429);
    }

    // 1) Init nel DB (validazione completa lato RPC SECURITY DEFINER)
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'init_upload_version_for_room_device',
      {
        p_token: token,
        p_session_id: sessionId,
        p_filename: filename,
        p_size: size,
        p_mime: mime,
      },
    );

    if (rpcError) {
      const msg = rpcError.message ?? 'rpc_error';
      // Mappa errori funzionali su HTTP code coerenti per la UI
      if (msg.includes('device_not_found') || msg.includes('invalid_token')) {
        return jsonRes({ error: 'invalid_token' }, 401);
      }
      if (msg.includes('tenant_suspended')) return jsonRes({ error: 'tenant_suspended' }, 403);
      if (msg.includes('device_no_room_assigned')) {
        return jsonRes({ error: 'device_no_room_assigned' }, 409);
      }
      if (msg.includes('session_cross_room_not_allowed') || msg.includes('session_cross_event_not_allowed')) {
        return jsonRes({ error: 'session_cross_room' }, 403);
      }
      if (msg.includes('session_not_found_or_cross_tenant')) {
        return jsonRes({ error: 'session_not_found' }, 404);
      }
      if (msg.includes('event_closed_or_archived')) {
        return jsonRes({ error: 'event_closed' }, 403);
      }
      if (msg.includes('file_too_large')) return jsonRes({ error: 'file_too_large' }, 413);
      if (msg.includes('storage_quota_exceeded')) {
        return jsonRes({ error: 'storage_quota_exceeded' }, 507);
      }
      return jsonRes({ error: msg }, 400);
    }

    const init = rpcData as InitRpcResult;
    if (!init || !init.storage_key) {
      return jsonRes({ error: 'init_failed' }, 500);
    }

    // 2) Genera signed upload URL Storage. Validita' 2h (default).
    //    Il PC sala fara' PUT diretto qui senza credenziali (URL e' un JWT
    //    firmato da service_role). Storage RLS NON e' bypassata: l'URL e'
    //    valido solo per QUEL path con QUEL token.
    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from(init.bucket)
      .createSignedUploadUrl(init.storage_key);

    if (signedError || !signedData?.signedUrl || !signedData.token) {
      // Cleanup: aborta la version creata cosi' non lascia orfani.
      try {
        await supabaseAdmin.rpc('abort_upload_version_for_room_device', {
          p_token: token,
          p_version_id: init.version_id,
        });
      } catch {
        /* best-effort */
      }
      return jsonRes({ error: signedError?.message ?? 'signed_url_failed' }, 500);
    }

    return jsonRes(
      {
        ok: true,
        version_id: init.version_id,
        presentation_id: init.presentation_id,
        storage_key: init.storage_key,
        bucket: init.bucket,
        session_id: init.session_id,
        room_id: init.room_id,
        device_id: init.device_id,
        // Signed upload URL: il client fa PUT con questo URL.
        // `token` + `path` sono usati da supabase-js v2.uploadToSignedUrl.
        signed_url: signedData.signedUrl,
        token: signedData.token,
        path: signedData.path,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[room-device-upload-init] unhandled', message);
    return jsonRes({ error: 'internal_error' }, 500);
  }
});

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
