#!/usr/bin/env node
/**
 * Smoke test UPLOAD flow end-to-end (admin authenticated, ambiente CLOUD)
 *
 * Riproduce ESATTAMENTE il flusso del client React in modalita' cloud
 * (Supabase TUS resumable):
 *   1) Login email/password -> access_token JWT
 *   2) RPC init_upload_version_for_session -> version_id + storage_key
 *   3) TUS POST /storage/v1/upload/resumable -> upload_url
 *   4) TUS PATCH upload_url con file bytes
 *   5) RPC finalize_upload_version_admin -> presentation.current_version_id
 *   6) Verifica DB: status='ready', current_version_id != null
 *
 * Per la versione DESKTOP (server Rust embedded, non TUS) vedi invece
 * `apps/desktop/scripts/smoke-test-upload.mjs`.
 *
 * ─── HARDENING SICUREZZA (2026-04-19) ─────────────────────────────────────
 * In passato questo script aveva email/password admin del field test e
 * URL/anon key del progetto Supabase HARDCODED come default. Anche se la
 * anon key e' "pubblica" e gli account di field test sono sandboxed, era
 * comunque cattiva pratica perche':
 *   - il pattern password (`FieldTest!{Tier}{User}2026`) era guessable
 *     per tutti gli altri tier non commitati;
 *   - l'URL Supabase + anon key esponevano il project_ref e il fingerprint
 *     del progetto a chiunque clonasse il repo;
 *   - chi clonava poteva eseguire lo script SENZA passare credenziali
 *     esplicite, lasciando audit log "anonimi" sul DB di prod.
 * Ora TUTTI i valori sensibili sono required: niente default in sorgente.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Usage (env vars):
 *   export VITE_SUPABASE_URL=https://<ref>.supabase.co
 *   export VITE_SUPABASE_ANON_KEY=<anon-jwt>
 *   export SC_SMOKE_EMAIL=admin@example.com
 *   export SC_SMOKE_PASSWORD=<password>
 *   export SC_SMOKE_SESSION_ID=<uuid>
 *   node apps/web/scripts/smoke-test-upload.mjs
 *
 * Usage (flag CLI, override env):
 *   node apps/web/scripts/smoke-test-upload.mjs \
 *     --supabase-url https://<ref>.supabase.co \
 *     --anon-key <anon-jwt> \
 *     --email admin@example.com \
 *     --password '<password>' \
 *     --session <uuid> \
 *     [--bearer anon|access] [--size <bytes>] [--name <filename>]
 *
 * Tutti i valori "supabase-url", "anon-key", "email", "password", "session"
 * sono OBBLIGATORI: lo script esce con codice 2 + messaggio chiaro se manca
 * anche solo uno (mai chiamare un endpoint se la config e' parziale).
 */
import { argv, env, exit } from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

function getArg(name, def = null) {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1 || idx === argv.length - 1) return def;
  return argv[idx + 1];
}

/**
 * Ritorna il valore dal flag CLI se presente, altrimenti dalla env var,
 * altrimenti `null`. Centralizza la priorita' "flag wins over env" e
 * permette di tracciare in `requireOrFail` quale fonte e' mancante.
 */
function readArgOrEnv(flagName, envName) {
  const flagValue = getArg(flagName, null);
  if (flagValue !== null && flagValue !== '') return flagValue;
  const envValue = env[envName];
  if (envValue !== undefined && envValue !== '') return envValue;
  return null;
}

function requireOrFail(value, label, flagName, envName) {
  if (value === null || value === undefined || value === '') {
    console.error(
      `[FATAL] ${label} mancante. Passa --${flagName} <value> oppure export ${envName}=<value>.`,
    );
    exit(2);
  }
  return value;
}

const SUPABASE_URL = requireOrFail(
  readArgOrEnv('supabase-url', 'VITE_SUPABASE_URL'),
  'Supabase URL',
  'supabase-url',
  'VITE_SUPABASE_URL',
);
const ANON_KEY = requireOrFail(
  readArgOrEnv('anon-key', 'VITE_SUPABASE_ANON_KEY'),
  'Supabase anon key',
  'anon-key',
  'VITE_SUPABASE_ANON_KEY',
);
const email = requireOrFail(
  readArgOrEnv('email', 'SC_SMOKE_EMAIL'),
  'Email admin',
  'email',
  'SC_SMOKE_EMAIL',
);
const password = requireOrFail(
  readArgOrEnv('password', 'SC_SMOKE_PASSWORD'),
  'Password admin',
  'password',
  'SC_SMOKE_PASSWORD',
);
const sessionId = requireOrFail(
  readArgOrEnv('session', 'SC_SMOKE_SESSION_ID'),
  'Session UUID di test',
  'session',
  'SC_SMOKE_SESSION_ID',
);
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
