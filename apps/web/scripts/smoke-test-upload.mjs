#!/usr/bin/env node
/**
 * Smoke test UPLOAD flow end-to-end (admin authenticated)
 *
 * Riproduce ESATTAMENTE il flusso del client React:
 *   1) Login email/password -> access_token JWT
 *   2) RPC init_upload_version_for_session -> version_id + storage_key
 *   3) TUS POST /storage/v1/upload/resumable -> upload_url
 *   4) TUS PATCH upload_url con file bytes
 *   5) RPC finalize_upload_version_admin -> presentation.current_version_id
 *   6) Verifica DB: status='ready', current_version_id != null
 *
 * Usage:
 *   node apps/web/scripts/smoke-test-upload.mjs --email admin.alpha@fieldtest.local \
 *        --password 'FieldTest!AlphaAdmin2026' --session 7e3af553-... \
 *        --bearer anon|access
 *
 * Default: usa anon key per TUS (come il client React).
 * Con --bearer access usa l access_token JWT (per testare se il bug e bearer).
 */
import { argv, exit } from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

const SUPABASE_URL = 'https://cdjxxxkrhgdkcpkkozdl.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkanh4eGtyaGdka2Nwa2tvemRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4OTc3MDgsImV4cCI6MjA5MTQ3MzcwOH0.5-DxsU6zyptxKsZG_oNNStD7MK3M1Ba6Se39sLkAAcM';

function getArg(name, def = null) {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1 || idx === argv.length - 1) return def;
  return argv[idx + 1];
}

const email = getArg('email', 'admin.alpha@fieldtest.local');
const password = getArg('password', 'FieldTest!AlphaAdmin2026');
const sessionId = getArg('session', '746868d1-a939-4ebf-86a8-d9fcac2721fa');
const bearerMode = getArg('bearer', 'anon');
const fileSize = parseInt(getArg('size', '524288'), 10);
const fileName = getArg('name', `smoke-test-${Date.now()}.pdf`);

function log(step, status, msg, extra = null) {
  const sym = status === 'OK' ? '[OK]' : status === 'FAIL' ? '[FAIL]' : '[..]';
  console.log(`${sym} ${step}: ${msg}`);
  if (extra) console.log(JSON.stringify(extra, null, 2));
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { ok: res.ok, status: res.status, body, headers: Object.fromEntries(res.headers) };
}

async function main() {
  console.log('=== SMOKE TEST UPLOAD ADMIN END-TO-END ===');
  console.log(`Email: ${email}`);
  console.log(`Session: ${sessionId}`);
  console.log(`Bearer mode: ${bearerMode}`);
  console.log(`File: ${fileName} (${fileSize} bytes)`);
  console.log('');

  // --- STEP 1: Login ---
  log('1. login', '..', 'POST /auth/v1/token?grant_type=password');
  const loginRes = await jsonFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    log('1. login', 'FAIL', `HTTP ${loginRes.status}`, loginRes.body);
    exit(1);
  }
  const accessToken = loginRes.body.access_token;
  log('1. login', 'OK', `JWT received (${accessToken.length} chars)`);

  // --- STEP 2: Init upload ---
  log('2. init_upload_version_for_session', '..', `RPC for session ${sessionId}`);
  const initRes = await jsonFetch(`${SUPABASE_URL}/rest/v1/rpc/init_upload_version_for_session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON_KEY,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      p_session_id: sessionId,
      p_filename: fileName,
      p_size: fileSize,
      p_mime: 'application/pdf',
    }),
  });
  if (!initRes.ok) {
    log('2. init_upload', 'FAIL', `HTTP ${initRes.status}`, initRes.body);
    exit(1);
  }
  const { version_id, presentation_id, storage_key, bucket } = initRes.body;
  log('2. init_upload', 'OK', `version_id=${version_id} storage_key=${storage_key}`);

  // --- STEP 3: TUS create upload ---
  // Bearer mode: anon (default replica client React) o access (test alternativo)
  const tusBearer = bearerMode === 'access' ? accessToken : ANON_KEY;
  log('3a. TUS create', '..', `POST /storage/v1/upload/resumable bearer=${bearerMode}`);

  const meta = {
    bucketName: bucket,
    objectName: storage_key,
    contentType: 'application/pdf',
    cacheControl: '3600',
  };
  const uploadMetadata = Object.entries(meta)
    .map(([k, v]) => `${k} ${Buffer.from(String(v)).toString('base64')}`)
    .join(',');

  const createRes = await fetch(`${SUPABASE_URL}/storage/v1/upload/resumable`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tusBearer}`,
      apikey: ANON_KEY,
      'tus-resumable': '1.0.0',
      'upload-length': String(fileSize),
      'upload-metadata': uploadMetadata,
      'x-upsert': 'true',
    },
  });
  if (!createRes.ok && createRes.status !== 201) {
    const body = await createRes.text();
    log('3a. TUS create', 'FAIL', `HTTP ${createRes.status}`, { body, headers: Object.fromEntries(createRes.headers) });
    exit(1);
  }
  const uploadUrl = createRes.headers.get('location');
  log('3a. TUS create', 'OK', `upload_url=${uploadUrl}`);

  // --- STEP 4: TUS PATCH upload bytes ---
  log('3b. TUS patch', '..', `PATCH ${uploadUrl} with ${fileSize} bytes`);
  const fileBuffer = Buffer.alloc(fileSize, 'A');
  fileBuffer.write('%PDF-1.4\n', 0);
  const patchRes = await fetch(uploadUrl, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${tusBearer}`,
      apikey: ANON_KEY,
      'tus-resumable': '1.0.0',
      'upload-offset': '0',
      'content-type': 'application/offset+octet-stream',
    },
    body: fileBuffer,
  });
  if (!patchRes.ok && patchRes.status !== 204) {
    const body = await patchRes.text();
    log('3b. TUS patch', 'FAIL', `HTTP ${patchRes.status}`, { body, headers: Object.fromEntries(patchRes.headers) });
    exit(1);
  }
  log('3b. TUS patch', 'OK', `HTTP ${patchRes.status}, upload-offset=${patchRes.headers.get('upload-offset')}`);

  // --- STEP 5: SHA-256 + finalize ---
  log('4. finalize', '..', 'computing SHA-256 + RPC finalize_upload_version_admin');
  const sha256 = createHash('sha256').update(fileBuffer).digest('hex');
  const finalizeRes = await jsonFetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_upload_version_admin`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON_KEY,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      p_version_id: version_id,
      p_sha256: sha256,
    }),
  });
  if (!finalizeRes.ok) {
    log('4. finalize', 'FAIL', `HTTP ${finalizeRes.status}`, finalizeRes.body);
    exit(1);
  }
  log('4. finalize', 'OK', 'version finalized', finalizeRes.body);

  // --- STEP 6: verify ---
  // Disambigua FK con `!fk_current_version` per evitare PGRST201
  // (presentations <-> presentation_versions ha 2 FK: current_version_id e
  // presentation_versions.presentation_id).
  log('5. verify', '..', 'GET presentation + version from DB');
  const verifyRes = await jsonFetch(
    `${SUPABASE_URL}/rest/v1/presentations?id=eq.${presentation_id}&select=id,current_version_id,status,current_version:presentation_versions!fk_current_version(id,status,file_name)`,
    {
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!verifyRes.ok) {
    log('5. verify', 'FAIL', `HTTP ${verifyRes.status}`, verifyRes.body);
    exit(1);
  }
  log('5. verify', 'OK', 'DB state', verifyRes.body);

  console.log('\n=== ALL STEPS PASSED ===');
  console.log(`Presentation: ${presentation_id}`);
  console.log(`Version: ${version_id}`);
}

main().catch((err) => {
  console.error('UNCAUGHT', err);
  exit(1);
});
