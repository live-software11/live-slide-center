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
  presentationId: string;
  storageKey: string;
  filename: string;
  speakerName: string | null;
  sessionId: string;
  sessionTitle: string;
  sessionScheduledStart: string | null;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  // Sprint C2 (GUIDA_OPERATIVA_v3 §2.C): hash SHA-256 calcolato lato upload.
  // Se null, il PC sala non verifica e segna `verified: 'skipped'`.
  fileHashSha256: string | null;
  // Sprint S-4 (G7): id e nome della sala di appartenenza del file. Per i
  // device 'room' (default) corrispondono alla sala assegnata. Per i device
  // 'control_center' variano per file (1 device = N sale).
  roomId: string;
  roomName: string;
  // Sprint T-1 (G8): version_number della versione attualmente "in onda" su
  // questo file (i.e. quella servita al PC sala = current_version_id), e
  // versionTotal = MAX(version_number) tra tutte le versioni 'ready' o
  // 'superseded' della stessa presentation. Il PC sala mostra un badge
  // overlay/inline `vN / M`: verde se N === M (current = latest), giallo se
  // N < M (admin ha riportato indietro la corrente, esiste una piu' recente).
  // Entrambi nullable per backward compat con bootstrap pre-T-1.
  versionNumber: number | null;
  versionTotal: number | null;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as {
      device_token?: string;
      include_versions?: boolean;
      // Sprint A (GUIDA_OPERATIVA_v3 §2.A6): il PC sala dichiara la propria
      // modalita di playback ad ogni bootstrap (polling 5/12/60s a seconda
      // del mode). Validato qui e UPSERT su room_state per la dashboard admin.
      playback_mode?: string;
    };

    const deviceToken = typeof body.device_token === 'string' ? body.device_token.trim() : '';
    const includeVersions = body.include_versions !== false;
    const requestedPlaybackMode =
      body.playback_mode === 'auto' || body.playback_mode === 'live' || body.playback_mode === 'turbo'
        ? body.playback_mode
        : null;

    if (!deviceToken) {
      return jsonRes({ error: 'missing_device_token' }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const tokenHash = await sha256Hex(deviceToken);

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('paired_devices')
      .select('id, tenant_id, event_id, room_id, status, device_name, role')
      .eq('pair_token_hash', tokenHash)
      .maybeSingle();

    if (deviceError) return jsonRes({ error: deviceError.message }, 500);
    if (!device) return jsonRes({ error: 'invalid_token' }, 404);

    // Sprint S-4 (G7): un device 'control_center' ignora room_id (sempre NULL
    // by design) e riceve i file di TUTTE le sale dell'evento. Tutto il resto
    // del flow (bootstrap event, network_mode, agent LAN, files) e' branchato
    // su `deviceRole` piu' giu'.
    const deviceRole: 'room' | 'control_center' =
      (device.role as 'room' | 'control_center' | undefined) ?? 'room';

    // Sprint D2 (GUIDA_OPERATIVA_v3 §2.D2): aggiorniamo `last_seen_at` e
    // marchiamo `status='online'`. Best-effort: se la scrittura fallisce
    // (es. RLS lato realtime broadcast giu') NON blocchiamo il bootstrap,
    // perche' il PC sala deve poter caricare comunque la lista files.
    await supabaseAdmin
      .from('paired_devices')
      .update({ last_seen_at: new Date().toISOString(), status: 'online' })
      .eq('id', device.id);

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('suspended')
      .eq('id', device.tenant_id)
      .maybeSingle();

    if (tenantError) return jsonRes({ error: tenantError.message }, 500);
    if (tenant?.suspended) return jsonRes({ error: 'tenant_suspended' }, 403);

    if (deviceRole !== 'control_center' && !device.room_id) {
      // Device pairato ma senza sala assegnata: rispondiamo 200 con `room: null`
      // cosi' il client puo' mostrare un placeholder utile e non si rompe il flusso.
      return jsonRes(
        {
          device: { id: device.id, name: device.device_name, role: deviceRole },
          room: null,
          event_id: device.event_id,
          network_mode: null,
          agent: null,
          room_state: {
            sync_status: 'offline',
            current_session: null,
            playback_mode: requestedPlaybackMode ?? 'auto',
          },
          files: [],
          warning: 'no_room_assigned',
        },
        200,
      );
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('network_mode, name')
      .eq('id', device.event_id)
      .maybeSingle();

    if (eventError || !event) {
      return jsonRes({ error: eventError?.message ?? 'event_not_found' }, 404);
    }

    // Sprint S-4 (G7): per device 'control_center' carichiamo TUTTE le sale
    // dell'evento (cosi' possiamo arricchire ogni file con roomName e
    // determinare quali sessioni includere). Per device 'room' carichiamo
    // solo la sala assegnata, comportamento invariato.
    let roomsList: Array<{ id: string; name: string }> = [];
    let primaryRoom: { id: string; name: string } | null = null;
    if (deviceRole === 'control_center') {
      const { data: rooms, error: roomsError } = await supabaseAdmin
        .from('rooms')
        .select('id, name')
        .eq('event_id', device.event_id);
      if (roomsError) {
        return jsonRes({ error: roomsError.message }, 500);
      }
      roomsList = rooms ?? [];
    } else {
      const { data: room, error: roomError } = await supabaseAdmin
        .from('rooms')
        .select('id, name')
        .eq('id', device.room_id!)
        .maybeSingle();
      if (roomError || !room) {
        return jsonRes({ error: roomError?.message ?? 'room_not_found' }, 404);
      }
      roomsList = [room];
      primaryRoom = room;
    }

    // Sprint A6: persistiamo la modalita di playback dichiarata dal PC sala
    // PRIMA di leggere lo stato, cosi' la response include sempre il valore
    // piu' fresco (utile alla dashboard admin che osserva room_state).
    // Per device 'control_center' lo skippiamo: non c'e' una single room_state
    // a cui scriverlo (ne avrebbe N, e il control_center NON proietta).
    if (requestedPlaybackMode && deviceRole === 'room' && primaryRoom) {
      await supabaseAdmin
        .from('room_state')
        .update({ playback_mode: requestedPlaybackMode })
        .eq('room_id', primaryRoom.id);
    }

    let roomStatePlaybackMode: 'auto' | 'live' | 'turbo' = 'auto';
    let roomStateSyncStatus: 'synced' | 'syncing' | 'outdated' | 'offline' = 'offline';
    let currentSession: {
      id: string;
      title: string;
      scheduled_start: string;
      scheduled_end: string;
    } | null = null;

    if (deviceRole === 'room' && primaryRoom) {
      const { data: roomState } = await supabaseAdmin
        .from('room_state')
        .select('sync_status, current_session_id, playback_mode')
        .eq('room_id', primaryRoom.id)
        .maybeSingle();
      roomStatePlaybackMode =
        (roomState?.playback_mode as 'auto' | 'live' | 'turbo' | undefined) ?? 'auto';
      roomStateSyncStatus =
        (roomState?.sync_status as
          | 'synced'
          | 'syncing'
          | 'outdated'
          | 'offline'
          | undefined) ?? 'offline';
      if (roomState?.current_session_id) {
        const { data: session } = await supabaseAdmin
          .from('sessions')
          .select('id, title, scheduled_start, scheduled_end')
          .eq('id', roomState.current_session_id)
          .maybeSingle();
        if (session) currentSession = session;
      }
    } else {
      // Per control_center il playback_mode dichiarato e' eco-only
      // (non viene scritto da nessuna parte, ma lo restituiamo cosi' la UI
      // mantiene il comportamento atteso).
      roomStatePlaybackMode = requestedPlaybackMode ?? 'auto';
      roomStateSyncStatus = 'synced'; // un Centro Slide non "proietta", quindi non e' mai outdated.
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

    if (includeVersions && roomsList.length > 0) {
      const roomIds = roomsList.map((r) => r.id);
      const roomNameById = new Map(roomsList.map((r) => [r.id, r.name]));
      const { data: sessions } = await supabaseAdmin
        .from('sessions')
        .select('id, title, scheduled_start, room_id')
        .in('room_id', roomIds)
        .eq('event_id', device.event_id);

      const sessionList = sessions ?? [];
      const sessionMap = new Map(sessionList.map((s) => [s.id, s]));
      const sessionIds = sessionList.map((s) => s.id);

      if (sessionIds.length > 0) {
        // LEFT JOIN: speaker_id puo' essere NULL (upload diretto su sessione).
        const { data: presentations } = await supabaseAdmin
          .from('presentations')
          .select('id, current_version_id, session_id, speakers(full_name)')
          .in('session_id', sessionIds)
          .not('current_version_id', 'is', null);

        const versionIds = (presentations ?? [])
          .map((p) => p.current_version_id as string | null)
          .filter((id): id is string => !!id);

        if (versionIds.length > 0) {
          const { data: versions } = await supabaseAdmin
            .from('presentation_versions')
            .select(
              'id, storage_key, file_name, file_size_bytes, file_hash_sha256, mime_type, created_at, version_number',
            )
            .in('id', versionIds)
            .eq('status', 'ready');

          const versionMap = new Map((versions ?? []).map((v) => [v.id, v]));

          // Sprint T-1 (G8): per ogni presentation calcoliamo il MAX
          // version_number tra le versioni 'ready' OR 'superseded' (cioe' tutte
          // le versioni effettivamente caricate, escludendo solo
          // 'failed'/'aborted'/'uploading'). Serve a mostrare il badge "vN/M":
          //   N = version_number del current_version_id (in onda)
          //   M = MAX(version_number) per la presentation
          // Se N === M: la corrente e' anche la piu' recente (badge verde).
          // Se N < M: l'admin ha riportato indietro la corrente, esiste una
          //           versione piu' recente (badge giallo, "non e' la latest").
          const presentationIds = (presentations ?? []).map((p) => p.id as string);
          const maxVersionByPresentation = new Map<string, number>();
          if (presentationIds.length > 0) {
            const { data: allVersions } = await supabaseAdmin
              .from('presentation_versions')
              .select('presentation_id, version_number')
              .in('presentation_id', presentationIds)
              .in('status', ['ready', 'superseded']);
            for (const row of allVersions ?? []) {
              const pid = row.presentation_id as string;
              const vn = (row.version_number as number | null) ?? 0;
              const cur = maxVersionByPresentation.get(pid) ?? 0;
              if (vn > cur) maxVersionByPresentation.set(pid, vn);
            }
          }

          for (const pres of presentations ?? []) {
            const vid = pres.current_version_id as string;
            const version = versionMap.get(vid);
            if (!version?.storage_key) continue;

            const sp = pres.speakers as unknown;
            const speakerName = Array.isArray(sp)
              ? ((sp[0] as { full_name?: string } | undefined)?.full_name ?? null)
              : ((sp as { full_name?: string } | null)?.full_name ?? null);

            const session = sessionMap.get(pres.session_id as string);
            const sessionRoomId = (session?.room_id as string | undefined) ?? '';
            const sessionRoomName = roomNameById.get(sessionRoomId) ?? '';

            const currentVersionNumber = (version.version_number as number | null) ?? null;
            const totalForPresentation = maxVersionByPresentation.get(pres.id as string);
            const versionTotal =
              totalForPresentation !== undefined
                ? totalForPresentation
                : (currentVersionNumber ?? null);

            files.push({
              versionId: version.id,
              presentationId: pres.id as string,
              storageKey: version.storage_key,
              filename: version.file_name ?? `file_${version.id}`,
              speakerName,
              sessionId: pres.session_id as string,
              sessionTitle: session?.title ?? '—',
              sessionScheduledStart: (session?.scheduled_start ?? null) as string | null,
              fileSizeBytes: Number(version.file_size_bytes ?? 0),
              mimeType: version.mime_type ?? 'application/octet-stream',
              createdAt: version.created_at as string,
              fileHashSha256: (version.file_hash_sha256 as string | null) ?? null,
              roomId: sessionRoomId,
              roomName: sessionRoomName,
              versionNumber: currentVersionNumber,
              versionTotal,
            });
          }
        }
      }

      // Sprint S-4: ordinamento per (roomName, sessionScheduledStart, filename).
      // Per device 'room' c'e' una sola roomName, quindi e' equivalente al
      // vecchio ordinamento per (sessionScheduledStart, filename). Per
      // device 'control_center' raggruppa visivamente per sala in dashboard.
      files.sort((a, b) => {
        if (a.roomName !== b.roomName) return a.roomName.localeCompare(b.roomName);
        const ta = a.sessionScheduledStart ?? '';
        const tb = b.sessionScheduledStart ?? '';
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.filename.localeCompare(b.filename);
      });
    }

    return jsonRes(
      {
        device: { id: device.id, name: device.device_name, role: deviceRole },
        room: deviceRole === 'control_center' ? null : primaryRoom,
        event_id: device.event_id,
        event_name: event.name,
        network_mode: event.network_mode,
        agent,
        room_state: {
          sync_status: roomStateSyncStatus,
          current_session: currentSession,
          playback_mode: roomStatePlaybackMode,
        },
        files,
        ...(deviceRole === 'control_center'
          ? { rooms: roomsList, control_center: true as const }
          : {}),
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
