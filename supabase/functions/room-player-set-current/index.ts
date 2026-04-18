// Sprint I (GUIDA_OPERATIVA_v3 §3.E E3) — il PC sala segnala quale file
// sta proiettando in questo momento (o "stop": presentation_id null).
//
// Auth: hash del device_token vs paired_devices.pair_token_hash via RPC
// `rpc_room_player_set_current` SECURITY DEFINER (stesso pattern di
// `room-player-rename`).
//
// Side effect: l'UPDATE su `room_state` triggera il broadcast Realtime
// `room_state_changed` (Sprint B) → admin riceve la notifica in tempo
// reale e mostra "In onda: {file_name}" sotto la card sala.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonRes({ error: 'method_not_allowed' }, 405);
  }

  try {
    const body = (await req.json()) as {
      device_token?: string;
      presentation_id?: string | null;
      // Sprint U-3: opzionali, retrocompatibili. Il PC sala li passa solo
      // se sa la posizione corrente nella slide deck (es. PowerPoint COM,
      // LibreOffice headless). I PC vecchi continuano a funzionare senza.
      current_slide_index?: number | null;
      current_slide_total?: number | null;
    };
    const token = typeof body.device_token === 'string' ? body.device_token.trim() : '';
    if (!token) return jsonRes({ error: 'missing_device_token' }, 400);

    // `presentation_id` puo' essere `null` per "fermare" la trasmissione.
    let presentationId: string | null = null;
    if (body.presentation_id !== undefined && body.presentation_id !== null) {
      if (typeof body.presentation_id !== 'string') {
        return jsonRes({ error: 'invalid_presentation_id' }, 400);
      }
      presentationId = body.presentation_id.trim();
      if (presentationId.length === 0) presentationId = null;
    }

    // Slide counters (Sprint U-3): cast difensivo a int. Numeri negativi o
    // non-int → NULL (la RPC ha gia' una sanity-check secondario).
    const slideIndex = normalizeSlideCounter(body.current_slide_index);
    const slideTotal = normalizeSlideCounter(body.current_slide_total);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await supabaseAdmin.rpc('rpc_room_player_set_current', {
      p_token: token,
      p_presentation_id: presentationId,
      p_current_slide_index: slideIndex,
      p_current_slide_total: slideTotal,
    });

    if (error) {
      const msg = error.message ?? 'rpc_error';
      // Mappiamo i RAISE EXCEPTION della RPC ai codici HTTP corretti, cosi'
      // il client puo' distinguere "device sconosciuto" (rotto pairing) da
      // "presentation cross-room" (bug applicativo o tampering).
      const code =
        msg.includes('device_not_found') ? 404
        : msg.includes('device_not_in_room') ? 409
        : msg.includes('presentation_not_in_event') ? 404
        : msg.includes('presentation_not_in_device_room') ? 403
        : msg.includes('missing_device_token') ? 400
        : 400;
      return jsonRes({ error: msg }, code);
    }

    return jsonRes(data, 200);
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

function normalizeSlideCounter(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  if (n < 1) return null;
  return n;
}
