#!/usr/bin/env node
/**
 * Sprint X-1 (19 aprile 2026, audit chirurgico upload desktop).
 *
 * SMOKE TEST END-TO-END dell'upload file in modalita' DESKTOP.
 *
 * Replica esattamente il flusso che fa la SPA (`useUploadQueue.ts`) quando
 * gira dentro Tauri 2 webview con backend Rust embedded:
 *
 *   1. POST /rest/v1/rpc/init_upload_version_for_session
 *      → ottiene { version_id, presentation_id, storage_key, bucket }
 *   2. POST /storage/v1/object/{bucket}/{storage_key}
 *      → carica i bytes (NIENTE TUS: il server Rust non lo implementa)
 *   3. POST /rest/v1/rpc/finalize_upload_version_admin
 *      → marca status 'ready' + setta presentations.current_version_id
 *   4. GET  /rest/v1/presentations?id=eq.<id>&select=current_version_id,status
 *      → verifica che current_version_id sia popolato (UI lo richiede per
 *        mostrare la riga; vedi filtro in SessionFilesPanel.tsx).
 *   5. Cleanup: DELETE /rest/v1/presentation_versions?id=eq.<id> +
 *               DELETE /rest/v1/presentations?id=eq.<id>
 *      (best-effort, errori solo loggati)
 *
 * PRE-CONDIZIONE: Live SLIDE CENTER Desktop deve essere in esecuzione, con
 * almeno un evento + sessione di test creati nel DB SQLite locale. Le ID si
 * passano via flag (--session-id <uuid>) o env (SC_SESSION_ID). L'admin token
 * va passato via --admin-token <token> oppure letto direttamente dal file
 * `<data_root>/secrets.json` se presente (default su Windows:
 * `%USERPROFILE%\\SlideCenter\\secrets.json`).
 *
 * Uso:
 *   pnpm --filter @slidecenter/desktop smoke-upload \
 *        --session-id <uuid> \
 *        --admin-token <token> \
 *        [--port 7300] [--keep] [--json]
 *
 * Flags:
 *   --session-id   sessione di destinazione (creata via UI o REST)
 *   --admin-token  Bearer token desktop (UUID v4); auto-discover se omesso
 *   --port         porta backend Rust (default 7300)
 *   --data-root    path data root (default %USERPROFILE%\\SlideCenter)
 *   --keep         non cancella la presentation/version creata (utile per ispezione UI)
 *   --json         output strutturato
 *   --file <path>  file binario da caricare (default: 1 KB random)
 *
 * Exit code 0 se tutti gli step passano. 1 se almeno uno fallisce.
 */

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const args = new Set(argv);
function getFlag(name, fallback = null) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return fallback;
  return argv[idx + 1];
}

const wantJson = args.has('--json');
const keepData = args.has('--keep');
const port = parseInt(getFlag('--port', '7300'), 10);
const explicitToken = getFlag('--admin-token', null) ?? process.env.SC_ADMIN_TOKEN ?? null;
const sessionId = getFlag('--session-id', null) ?? process.env.SC_SESSION_ID ?? null;
const dataRootArg = getFlag('--data-root', null);
const filePathArg = getFlag('--file', null);

const BACKEND_BASE = `http://127.0.0.1:${port}`;

const steps = [];
function record(step) {
  steps.push(step);
  if (!wantJson) {
    const icon = step.status === 'pass' ? '[OK]  ' : step.status === 'fail' ? '[FAIL]' : '[INFO]';
    console.log(`${icon} ${step.label}${step.detail ? ` — ${step.detail}` : ''}`);
  }
}

function defaultDataRoot() {
  if (dataRootArg) return dataRootArg;
  if (platform() === 'win32') {
    return join(process.env.USERPROFILE ?? homedir(), 'SlideCenter');
  }
  return join(homedir(), 'SlideCenter');
}

function discoverAdminToken() {
  if (explicitToken) return explicitToken;
  const dataRoot = defaultDataRoot();
  const secretsPath = join(dataRoot, 'secrets.json');
  if (!existsSync(secretsPath)) {
    return null;
  }
  try {
    const raw = readFileSync(secretsPath, 'utf-8');
    const json = JSON.parse(raw);
    return json.admin_token ?? null;
  } catch {
    return null;
  }
}

async function jsonFetch(path, init = {}) {
  const start = performance.now();
  const res = await fetch(`${BACKEND_BASE}${path}`, init);
  const elapsed = performance.now() - start;
  let body = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, ok: res.ok, body, elapsed };
}

async function main() {
  if (!sessionId) {
    record({
      id: 'precheck',
      label: '--session-id mancante',
      status: 'fail',
      detail: 'usa: --session-id <uuid> oppure env SC_SESSION_ID',
    });
    return false;
  }
  const adminToken = discoverAdminToken();
  if (!adminToken) {
    record({
      id: 'precheck',
      label: 'Admin token non trovato',
      status: 'fail',
      detail: 'usa --admin-token <uuid> oppure crea secrets.json in data_root',
    });
    return false;
  }

  // 0. Health check: backend raggiungibile.
  const health = await jsonFetch('/health');
  if (!health.ok || health.body?.ok !== true) {
    record({
      id: 'health',
      label: 'Backend Rust desktop raggiungibile',
      status: 'fail',
      detail: `${BACKEND_BASE}/health → status=${health.status}`,
    });
    return false;
  }
  record({
    id: 'health',
    label: 'Backend Rust desktop raggiungibile',
    status: 'pass',
    detail: `${health.elapsed.toFixed(1)}ms`,
  });

  // Prepara file da caricare.
  let fileBytes;
  let fileName;
  if (filePathArg) {
    if (!existsSync(filePathArg)) {
      record({
        id: 'file',
        label: 'File da caricare',
        status: 'fail',
        detail: `non trovato: ${filePathArg}`,
      });
      return false;
    }
    fileBytes = readFileSync(filePathArg);
    fileName = basename(filePathArg);
  } else {
    fileBytes = randomBytes(1024); // 1 KB random
    fileName = `smoke-${Date.now()}.bin`;
  }
  record({
    id: 'file',
    label: 'File da caricare',
    status: 'info',
    detail: `${fileName} (${fileBytes.length} bytes)`,
  });

  // 1. RPC init_upload_version_for_session
  const init = await jsonFetch('/rest/v1/rpc/init_upload_version_for_session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      apikey: adminToken,
    },
    body: JSON.stringify({
      p_session_id: sessionId,
      p_filename: fileName,
      p_size: fileBytes.length,
      p_mime: 'application/octet-stream',
    }),
  });
  if (!init.ok || !init.body?.version_id) {
    record({
      id: 'init',
      label: 'RPC init_upload_version_for_session',
      status: 'fail',
      detail: `status=${init.status} body=${JSON.stringify(init.body).slice(0, 300)}`,
    });
    return false;
  }
  const { version_id, presentation_id, storage_key, bucket } = init.body;
  record({
    id: 'init',
    label: 'RPC init_upload_version_for_session',
    status: 'pass',
    detail: `version=${version_id.slice(0, 8)} presentation=${presentation_id.slice(0, 8)} bucket=${bucket}`,
  });

  // 2. POST simple upload (NON TUS).
  // L'endpoint Rust non implementa TUS — accetta body bytes diretto.
  const safeKey = storage_key.split('/').map(encodeURIComponent).join('/');
  const uploadUrl = `${BACKEND_BASE}/storage/v1/object/${encodeURIComponent(bucket)}/${safeKey}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      apikey: adminToken,
      'Content-Type': 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: fileBytes,
  });
  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) {
    record({
      id: 'upload',
      label: 'POST /storage/v1/object/{bucket}/{key} (simple upload)',
      status: 'fail',
      detail: `status=${uploadRes.status} body=${uploadText.slice(0, 200)}`,
    });
    return false;
  }
  record({
    id: 'upload',
    label: 'POST /storage/v1/object/{bucket}/{key} (simple upload)',
    status: 'pass',
    detail: `status=${uploadRes.status}`,
  });

  // 3. Calcola SHA-256 del file (richiesto dal finalize).
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');

  // 4. RPC finalize.
  const finalize = await jsonFetch('/rest/v1/rpc/finalize_upload_version_admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      apikey: adminToken,
    },
    body: JSON.stringify({
      p_version_id: version_id,
      p_sha256: sha256,
    }),
  });
  if (!finalize.ok) {
    record({
      id: 'finalize',
      label: 'RPC finalize_upload_version_admin',
      status: 'fail',
      detail: `status=${finalize.status} body=${JSON.stringify(finalize.body).slice(0, 300)}`,
    });
    return false;
  }
  record({
    id: 'finalize',
    label: 'RPC finalize_upload_version_admin',
    status: 'pass',
    detail: `sha256=${sha256.slice(0, 8)}…`,
  });

  // 5. VERIFICA: presentations.current_version_id deve essere settato.
  const verify = await jsonFetch(
    `/rest/v1/presentations?id=eq.${presentation_id}&select=id,current_version_id,status`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        apikey: adminToken,
      },
    },
  );
  if (!verify.ok || !Array.isArray(verify.body) || verify.body.length === 0) {
    record({
      id: 'verify',
      label: 'GET presentations: current_version_id popolato',
      status: 'fail',
      detail: `status=${verify.status} body=${JSON.stringify(verify.body).slice(0, 200)}`,
    });
    return false;
  }
  const pres = verify.body[0];
  if (pres.current_version_id !== version_id) {
    record({
      id: 'verify',
      label: 'GET presentations: current_version_id popolato',
      status: 'fail',
      detail: `expected ${version_id} got ${pres.current_version_id ?? 'NULL'}`,
    });
    return false;
  }
  record({
    id: 'verify',
    label: 'GET presentations: current_version_id popolato',
    status: 'pass',
    detail: `status=${pres.status} current_version=${(pres.current_version_id ?? '').slice(0, 8)}`,
  });

  // 6. VERIFICA: il file esiste fisicamente sul filesystem.
  const dataRoot = defaultDataRoot();
  const filePath = join(dataRoot, 'storage', 'presentations', storage_key);
  if (!existsSync(filePath)) {
    record({
      id: 'fs',
      label: 'File presente nel filesystem locale',
      status: 'fail',
      detail: `${filePath} non esiste`,
    });
    return false;
  }
  const stat = statSync(filePath);
  if (stat.size !== fileBytes.length) {
    record({
      id: 'fs',
      label: 'File presente nel filesystem locale',
      status: 'fail',
      detail: `size mismatch: expected ${fileBytes.length} got ${stat.size}`,
    });
    return false;
  }
  record({
    id: 'fs',
    label: 'File presente nel filesystem locale',
    status: 'pass',
    detail: `${filePath.replace(dataRoot, '<data_root>')} (${stat.size} bytes)`,
  });

  // 7. Cleanup (best-effort, non blocca lo stato finale).
  if (!keepData) {
    await jsonFetch(`/rest/v1/presentation_versions?id=eq.${version_id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        apikey: adminToken,
      },
    });
    await jsonFetch(`/rest/v1/presentations?id=eq.${presentation_id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        apikey: adminToken,
      },
    });
    record({
      id: 'cleanup',
      label: 'Cleanup test data',
      status: 'pass',
      detail: 'presentation + version eliminate',
    });
  } else {
    record({
      id: 'cleanup',
      label: 'Cleanup test data',
      status: 'info',
      detail: '--keep: dati lasciati per ispezione UI',
    });
  }

  return true;
}

const ok = await main().catch((err) => {
  record({
    id: 'fatal',
    label: 'Errore fatale',
    status: 'fail',
    detail: err instanceof Error ? err.message : String(err),
  });
  return false;
});

if (wantJson) {
  process.stdout.write(JSON.stringify({ ok, steps }, null, 2) + '\n');
} else {
  console.log('');
  console.log(ok ? '>>> SEMAFORO VERDE: upload desktop end-to-end OK.' : '>>> FAIL: upload desktop ROTTO.');
}

process.exit(ok ? 0 : 1);
