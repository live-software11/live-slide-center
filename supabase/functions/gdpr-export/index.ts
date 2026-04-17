/**
 * gdpr-export — Sprint 7
 *
 * POST {} (JWT admin obbligatorio nel header Authorization)
 *   → 200 { export_id, signed_url, expires_at, byte_size, ready_at }
 *   → 401 unauthorized | 403 forbidden_admin_only | 429 rate_limited_5min | 500 internal
 *
 * Flusso:
 *   1. Verifica JWT + ruolo admin via SDK auth client utente
 *   2. RPC create_tenant_data_export() crea record pending (rate limit 5min)
 *   3. RPC export_tenant_data() restituisce JSONB completo
 *   4. Costruisce ZIP con manifest + tenant-data.json + N CSV
 *   5. Upload ZIP su bucket "tenant-exports" con prefix tenant_id/{export_id}.zip
 *   6. UPDATE tenant_data_exports via service_role (status=ready, storage_path, byte_size)
 *   7. Genera signed URL 7 giorni
 *   8. Ritorna URL al client
 *
 * Configurazione: nessun secret extra (usa SUPABASE_URL + ANON + SERVICE_ROLE già presenti).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
// jszip 3.10 e' compatibile con Deno via npm: specifier (testato anche in Supabase Edge).
import JSZip from 'npm:jszip@3.10.1';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

interface ExportTenantData {
  meta: {
    tenant_id: string;
    exported_at: string;
    exported_by_user_id: string;
    schema_version: string;
  };
  tenant: Record<string, unknown> | null;
  users: Array<Record<string, unknown>>;
  team_invitations: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  speakers: Array<Record<string, unknown>>;
  presentations: Array<Record<string, unknown>>;
  presentation_versions: Array<Record<string, unknown>>;
  local_agents: Array<Record<string, unknown>>;
  paired_devices: Array<Record<string, unknown>>;
  audit_log_90d: Array<Record<string, unknown>>;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const jwt = authHeader.slice(7).trim();
    if (!jwt || jwt.split('.').length !== 3) return json({ error: 'unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRole) {
      return json({ error: 'env_misconfigured' }, 500);
    }

    // Validazione identita' via admin.getUser(jwt) - pattern stabile Deno.
    const adminAuth = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userInfo, error: userErr } = await adminAuth.auth.getUser(jwt);
    if (userErr || !userInfo?.user) {
      console.error('[gdpr-export] auth_get_user_failed', userErr?.message ?? 'no_user');
      return json({ error: 'unauthorized' }, 401);
    }

    const tenantId =
      (userInfo.user.app_metadata?.tenant_id as string | undefined) ??
      (userInfo.user.user_metadata?.tenant_id as string | undefined);
    if (!tenantId) return json({ error: 'missing_tenant' }, 400);

    // Client utente per le RPC che devono rispettare RLS.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // 1. Crea record export (rate limit 5 min via RPC).
    const { data: exportIdRaw, error: createErr } = await userClient.rpc('create_tenant_data_export');
    if (createErr) {
      const msg = createErr.message ?? '';
      if (msg.includes('rate_limited_5min')) return json({ error: 'rate_limited_5min' }, 429);
      if (msg.includes('forbidden_admin_only')) return json({ error: 'forbidden_admin_only' }, 403);
      return json({ error: msg || 'create_failed' }, 500);
    }
    const exportId = exportIdRaw as string;

    // 2. Carica payload completo via RPC (security definer).
    const { data: payload, error: exportErr } = await userClient.rpc('export_tenant_data');
    if (exportErr) {
      await markFailed(serviceRole, supabaseUrl, exportId, exportErr.message);
      return json({ error: exportErr.message }, 500);
    }
    const data = payload as ExportTenantData;

    // 3. Costruisci ZIP.
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      schema_version: data.meta.schema_version,
      tenant_id: data.meta.tenant_id,
      exported_at: data.meta.exported_at,
      exported_by_user_id: data.meta.exported_by_user_id,
      generator: 'Live SLIDE CENTER — gdpr-export',
      contents: [
        'manifest.json',
        'tenant-data.json',
        'csv/users.csv',
        'csv/events.csv',
        'csv/rooms.csv',
        'csv/sessions.csv',
        'csv/speakers.csv',
        'csv/presentations.csv',
        'csv/presentation_versions.csv',
        'csv/audit_log_90d.csv',
        'README.txt',
      ],
    }, null, 2));

    zip.file('tenant-data.json', JSON.stringify(data, null, 2));

    zip.file('README.txt', buildReadme(data));

    const csvFolder = zip.folder('csv');
    if (csvFolder) {
      csvFolder.file('users.csv', toCsv(data.users));
      csvFolder.file('events.csv', toCsv(data.events));
      csvFolder.file('rooms.csv', toCsv(data.rooms));
      csvFolder.file('sessions.csv', toCsv(data.sessions));
      csvFolder.file('speakers.csv', toCsv(data.speakers));
      csvFolder.file('presentations.csv', toCsv(data.presentations));
      csvFolder.file('presentation_versions.csv', toCsv(data.presentation_versions));
      csvFolder.file('audit_log_90d.csv', toCsv(data.audit_log_90d));
    }

    const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const byteSize = zipBytes.byteLength;

    // 4. Upload via service_role (RLS bucket privato).
    const adminClient = createClient(supabaseUrl, serviceRole);
    const storagePath = `${tenantId}/${exportId}.zip`;
    const { error: uploadErr } = await adminClient.storage
      .from('tenant-exports')
      .upload(storagePath, zipBytes, {
        contentType: 'application/zip',
        upsert: true,
      });
    if (uploadErr) {
      await markFailed(serviceRole, supabaseUrl, exportId, `upload_failed: ${uploadErr.message}`);
      return json({ error: uploadErr.message }, 500);
    }

    // 5. Update record export.
    const readyAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: updErr } = await adminClient
      .from('tenant_data_exports')
      .update({
        status: 'ready',
        storage_path: storagePath,
        byte_size: byteSize,
        ready_at: readyAt,
        expires_at: expiresAt,
      })
      .eq('id', exportId);
    if (updErr) {
      // Non blocchiamo: ZIP gia' caricato, log err lato server.
      console.error('gdpr-export: failed to update tenant_data_exports', updErr.message);
    }

    // 6. Signed URL 7gg.
    const { data: signed, error: signedErr } = await adminClient.storage
      .from('tenant-exports')
      .createSignedUrl(storagePath, 7 * 24 * 60 * 60); // secondi
    if (signedErr || !signed?.signedUrl) {
      return json({ error: signedErr?.message ?? 'signed_url_failed' }, 500);
    }

    return json({
      export_id: exportId,
      signed_url: signed.signedUrl,
      expires_at: expiresAt,
      ready_at: readyAt,
      byte_size: byteSize,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, 500);
  }
});

async function markFailed(serviceRole: string, supabaseUrl: string, exportId: string, message: string): Promise<void> {
  try {
    const admin = createClient(supabaseUrl, serviceRole);
    await admin
      .from('tenant_data_exports')
      .update({ status: 'failed', error_message: message })
      .eq('id', exportId);
  } catch (e) {
    console.error('gdpr-export: failed to mark export as failed', e);
  }
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows || rows.length === 0) return '';
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );
  const header = columns.map(escapeCsv).join(',');
  const body = rows
    .map((row) => columns.map((col) => escapeCsv(formatValue(row[col]))).join(','))
    .join('\n');
  return `${header}\n${body}\n`;
}

function escapeCsv(value: string): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildReadme(data: ExportTenantData): string {
  const lines: string[] = [];
  lines.push('Live SLIDE CENTER — Export dati tenant (GDPR data portability)');
  lines.push('================================================================');
  lines.push('');
  lines.push(`Tenant ID:      ${data.meta.tenant_id}`);
  lines.push(`Esportato il:   ${data.meta.exported_at}`);
  lines.push(`Esportato da:   ${data.meta.exported_by_user_id}`);
  lines.push(`Schema:         ${data.meta.schema_version}`);
  lines.push('');
  lines.push('Contenuto:');
  lines.push('  manifest.json              Metadata e indice contenuto');
  lines.push('  tenant-data.json           Snapshot completo JSON di tutto il tenant');
  lines.push('  csv/*.csv                  Tabelle principali in formato CSV (UTF-8)');
  lines.push('  README.txt                 Questo file');
  lines.push('');
  lines.push('Statistiche:');
  lines.push(`  Eventi:                ${data.events.length}`);
  lines.push(`  Sale:                  ${data.rooms.length}`);
  lines.push(`  Sessioni:              ${data.sessions.length}`);
  lines.push(`  Speaker:               ${data.speakers.length}`);
  lines.push(`  Presentazioni:         ${data.presentations.length}`);
  lines.push(`  Versioni file:         ${data.presentation_versions.length}`);
  lines.push(`  Utenti team:           ${data.users.length}`);
  lines.push(`  Audit log (90gg):      ${data.audit_log_90d.length}`);
  lines.push('');
  lines.push('Note GDPR:');
  lines.push('- Questo export e\' valido come "data portability" ex art. 20 GDPR.');
  lines.push('- I file binari delle presentazioni NON sono inclusi in questo ZIP:');
  lines.push('  ogni versione ha un campo storage_key che referenzia il bucket Supabase.');
  lines.push('- Per ottenere anche i blob, contattare supporto Live Software:');
  lines.push('  live.software11@gmail.com');
  lines.push('- I dati sensibili (password hash, token segreti, chiavi licenza) sono');
  lines.push('  esclusi per sicurezza.');
  lines.push('');
  lines.push('Per richiesta di cancellazione (right to be forgotten ex art. 17 GDPR):');
  lines.push('  scrivere a live.software11@gmail.com indicando il Tenant ID sopra.');
  lines.push('');
  return lines.join('\n');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
