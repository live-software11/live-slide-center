import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface FileRow {
  versionId: string;
  storageKey: string;
  filename: string;
  speakerName: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      device_token?: string;
      include_versions?: boolean;
    };

    const deviceToken = typeof body.device_token === 'string' ? body.device_token.trim() : '';
    const includeVersions = body.include_versions !== false;

    if (!deviceToken) {
      return new Response(JSON.stringify({ error: 'missing_device_token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const tokenHash = await sha256Hex(deviceToken);

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('paired_devices')
      .select('id, tenant_id, event_id, room_id, status')
      .eq('pair_token_hash', tokenHash)
      .maybeSingle();

    if (deviceError) {
      return new Response(JSON.stringify({ error: deviceError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!device) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('suspended')
      .eq('id', device.tenant_id)
      .maybeSingle();

    if (tenantError) {
      return new Response(JSON.stringify({ error: tenantError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (tenant?.suspended) {
      return new Response(JSON.stringify({ error: 'tenant_suspended' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!device.room_id) {
      return new Response(JSON.stringify({ error: 'no_room_assigned' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: room, error: roomError } = await supabaseAdmin
      .from('rooms')
      .select('id, name')
      .eq('id', device.room_id)
      .maybeSingle();

    if (roomError || !room) {
      return new Response(JSON.stringify({ error: roomError?.message ?? 'room_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('network_mode')
      .eq('id', device.event_id)
      .maybeSingle();

    if (eventError || !event) {
      return new Response(JSON.stringify({ error: eventError?.message ?? 'event_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roomState } = await supabaseAdmin
      .from('room_state')
      .select('sync_status, current_session_id')
      .eq('room_id', room.id)
      .maybeSingle();

    let currentSession: {
      id: string;
      title: string;
      scheduled_start: string;
      scheduled_end: string;
    } | null = null;

    if (roomState?.current_session_id) {
      const { data: session } = await supabaseAdmin
        .from('sessions')
        .select('id, title, scheduled_start, scheduled_end')
        .eq('id', roomState.current_session_id)
        .maybeSingle();
      if (session) currentSession = session;
    }

    const { data: agentRow } = await supabaseAdmin
      .from('local_agents')
      .select('lan_ip, lan_port')
      .eq('event_id', device.event_id)
      .eq('status', 'online')
      .not('lan_ip', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const agent = agentRow?.lan_ip
      ? { lan_ip: agentRow.lan_ip, lan_port: agentRow.lan_port ?? 8080 }
      : null;

    let files: FileRow[] = [];

    if (includeVersions) {
      const { data: sessions } = await supabaseAdmin
        .from('sessions')
        .select('id')
        .eq('room_id', room.id)
        .eq('event_id', device.event_id);

      const sessionIds = (sessions ?? []).map((s) => s.id);
      if (sessionIds.length > 0) {
        const { data: presentations } = await supabaseAdmin
          .from('presentations')
          .select('id, current_version_id, speakers!inner(full_name)')
          .in('session_id', sessionIds)
          .not('current_version_id', 'is', null);

        const versionIds = (presentations ?? [])
          .map((p) => p.current_version_id as string | null)
          .filter((id): id is string => !!id);

        if (versionIds.length > 0) {
          const { data: versions } = await supabaseAdmin
            .from('presentation_versions')
            .select('id, storage_key, file_name')
            .in('id', versionIds)
            .eq('status', 'ready');

          const versionMap = new Map((versions ?? []).map((v) => [v.id, v]));

          for (const pres of presentations ?? []) {
            const vid = pres.current_version_id as string;
            const version = versionMap.get(vid);
            if (!version?.storage_key) continue;

            const sp = pres.speakers as unknown;
            const speakerName = Array.isArray(sp)
              ? (sp[0] as { full_name: string })?.full_name ?? '—'
              : (sp as { full_name: string })?.full_name ?? '—';

            files.push({
              versionId: version.id,
              storageKey: version.storage_key,
              filename: version.file_name ?? `file_${version.id}`,
              speakerName,
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        room: { id: room.id, name: room.name },
        event_id: device.event_id,
        network_mode: event.network_mode,
        agent,
        room_state: {
          sync_status: roomState?.sync_status ?? 'offline',
          current_session: currentSession,
        },
        files,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
