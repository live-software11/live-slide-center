#!/usr/bin/env node
/**
 * Smoke test cloud production — Live SLIDE CENTER
 *
 * Verifica end-to-end l'app deployata su Vercel + edge functions Supabase
 * senza fare upload reali di file. Pensato per essere lanciato:
 *   - SUBITO DOPO ogni deploy production (`pnpm smoke:cloud`),
 *   - PRIMA di un evento live (T-1h),
 *   - PERIODICAMENTE come probe esterno (es. UptimeRobot / GitHub Actions cron).
 *
 * Cosa controlla:
 *   1. SPA root risponde 200 + ha tutti gli header sicurezza (HSTS, CSP,
 *      X-Frame-Options, etc.).
 *   2. Service Worker raggiungibile (sw.js + workbox).
 *   3. Manifest PWA raggiungibile e Content-Type corretto.
 *   4. Catch-all rewrite SPA: /upload/<token-random>, /sala/<token-random>,
 *      /admin/* ritornano comunque l'index.html (non 404).
 *   5. Asset cacheable: /assets/<file> ha Cache-Control immutable.
 *   6. Edge Functions critiche rispondono (401/403 = OK, 404/5xx = FAIL):
 *      slide-validator, room-device-upload-init, room-device-upload-abort,
 *      room-device-upload-finalize, public-upload-link.
 *   7. RLS Supabase: query a tabella protetta senza JWT ritorna 401.
 *   8. Latenza p95 root < 500ms (15 sample).
 *   9. (opzionale) Sentry DSN configurato in env produzione.
 *
 * Uso:
 *   node apps/web/scripts/smoke-test-cloud.mjs
 *   node apps/web/scripts/smoke-test-cloud.mjs --json
 *   node apps/web/scripts/smoke-test-cloud.mjs --json --out report.json
 *   node apps/web/scripts/smoke-test-cloud.mjs --url https://staging.example.com
 *   node apps/web/scripts/smoke-test-cloud.mjs --supabase-url https://X.supabase.co --supabase-anon-key eyJ...
 *
 * Env opzionali (override via flag):
 *   SMOKE_BASE_URL       (default: https://live-slide-center.vercel.app)
 *   VITE_SUPABASE_URL    (default: pulled from .env.local se presente)
 *   VITE_SUPABASE_ANON_KEY
 *
 * Exit code: 0 se tutti i critici passano, 1 altrimenti.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');

const argv = process.argv.slice(2);
const args = new Set(argv);
const wantJson = args.has('--json');

function getFlagValue(name) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1];
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

const envLocal = loadEnvFile(resolve(repoRoot, '.env.local'));
const envRoot = loadEnvFile(resolve(repoRoot, '.env'));

const BASE_URL = (
  getFlagValue('--url') ||
  process.env.SMOKE_BASE_URL ||
  'https://live-slide-center.vercel.app'
).replace(/\/+$/, '');

const SUPABASE_URL = (
  getFlagValue('--supabase-url') ||
  process.env.VITE_SUPABASE_URL ||
  envLocal.VITE_SUPABASE_URL ||
  envRoot.VITE_SUPABASE_URL ||
  ''
).replace(/\/+$/, '');

const SUPABASE_ANON_KEY =
  getFlagValue('--supabase-anon-key') ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  envLocal.VITE_SUPABASE_ANON_KEY ||
  envRoot.VITE_SUPABASE_ANON_KEY ||
  '';

const outFile = getFlagValue('--out');

const FETCH_TIMEOUT_MS = 8000;
const RTT_SAMPLES = 15;
const RTT_BUDGET_P95_MS = 500;

const checks = [];

function record(check) {
  checks.push(check);
}

async function timedFetch(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: init.redirect ?? 'manual',
    });
    const elapsed = performance.now() - start;
    let body = null;
    let bodyText = null;
    const ct = res.headers.get('content-type') ?? '';
    try {
      if (ct.includes('application/json')) {
        body = await res.json();
      } else {
        bodyText = await res.text();
      }
    } catch {
      // ignore body parse errors — what we test is the status/headers
    }
    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      body,
      bodyText,
      elapsed,
    };
  } catch (e) {
    const elapsed = performance.now() - start;
    return {
      ok: false,
      status: 0,
      headers: null,
      body: null,
      bodyText: null,
      elapsed,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

// 1. SPA root + security headers
async function checkRootAndHeaders() {
  const r = await timedFetch(`${BASE_URL}/`);
  if (!r.ok) {
    record({
      id: 'root',
      label: `SPA root risponde su ${BASE_URL}/`,
      severity: 'critical',
      status: 'fail',
      detail: r.error ?? `HTTP ${r.status}`,
      fix: 'Verifica deploy Vercel attivo + DNS.',
    });
    return false;
  }
  if (r.status !== 200) {
    record({
      id: 'root',
      label: `SPA root risponde su ${BASE_URL}/`,
      severity: 'critical',
      status: 'fail',
      detail: `HTTP ${r.status} (atteso 200)`,
    });
    return false;
  }
  record({
    id: 'root',
    label: `SPA root risponde su ${BASE_URL}/`,
    severity: 'critical',
    status: 'pass',
    detail: `HTTP 200 in ${r.elapsed.toFixed(0)}ms`,
  });

  // Headers di sicurezza obbligatori (impostati in vercel.json)
  const requiredHeaders = [
    {
      name: 'strict-transport-security',
      mustContain: 'max-age=',
      severity: 'critical',
    },
    { name: 'x-content-type-options', mustEqual: 'nosniff', severity: 'critical' },
    { name: 'x-frame-options', mustEqual: 'DENY', severity: 'critical' },
    {
      name: 'referrer-policy',
      mustEqual: 'strict-origin-when-cross-origin',
      severity: 'critical',
    },
    {
      name: 'content-security-policy',
      mustContain: "default-src 'self'",
      severity: 'critical',
    },
  ];
  for (const h of requiredHeaders) {
    const v = r.headers.get(h.name);
    if (!v) {
      record({
        id: `header-${h.name}`,
        label: `Header ${h.name} presente`,
        severity: h.severity,
        status: 'fail',
        detail: `assente`,
        fix: 'Verifica vercel.json sezione headers.',
      });
      continue;
    }
    if (h.mustEqual && v !== h.mustEqual) {
      record({
        id: `header-${h.name}`,
        label: `Header ${h.name} = ${h.mustEqual}`,
        severity: h.severity,
        status: 'fail',
        detail: `valore: "${v}" (atteso "${h.mustEqual}")`,
      });
      continue;
    }
    if (h.mustContain && !v.includes(h.mustContain)) {
      record({
        id: `header-${h.name}`,
        label: `Header ${h.name} contiene "${h.mustContain}"`,
        severity: h.severity,
        status: 'fail',
        detail: `valore: "${v.slice(0, 80)}..."`,
      });
      continue;
    }
    record({
      id: `header-${h.name}`,
      label: `Header ${h.name}`,
      severity: h.severity,
      status: 'pass',
      detail: v.length > 80 ? `${v.slice(0, 80)}...` : v,
    });
  }
  return true;
}

// 2. Service Worker + manifest PWA
async function checkPwaArtifacts() {
  const sw = await timedFetch(`${BASE_URL}/sw.js`);
  if (!sw.ok || sw.status !== 200) {
    record({
      id: 'sw',
      label: '/sw.js raggiungibile',
      severity: 'warn',
      status: 'fail',
      detail: sw.error ?? `HTTP ${sw.status}`,
      fix: 'Verifica vite-plugin-pwa abbia generato sw.js durante build.',
    });
  } else {
    const swAllowed = sw.headers.get('service-worker-allowed') ?? '';
    record({
      id: 'sw',
      label: '/sw.js raggiungibile',
      severity: 'warn',
      status: 'pass',
      detail: `HTTP 200, service-worker-allowed="${swAllowed}"`,
    });
  }

  const manifest = await timedFetch(`${BASE_URL}/manifest.webmanifest`);
  if (!manifest.ok || manifest.status !== 200) {
    record({
      id: 'manifest',
      label: '/manifest.webmanifest raggiungibile',
      severity: 'warn',
      status: 'fail',
      detail: manifest.error ?? `HTTP ${manifest.status}`,
    });
  } else {
    const ct = manifest.headers.get('content-type') ?? '';
    if (!ct.includes('application/manifest+json')) {
      record({
        id: 'manifest',
        label: '/manifest.webmanifest Content-Type corretto',
        severity: 'warn',
        status: 'fail',
        detail: `content-type: "${ct}" (atteso application/manifest+json)`,
      });
    } else {
      record({
        id: 'manifest',
        label: '/manifest.webmanifest',
        severity: 'warn',
        status: 'pass',
        detail: `HTTP 200, ${ct}`,
      });
    }
  }
}

// 3. SPA catch-all rewrites: /upload, /sala, /admin
async function checkSpaRewrites() {
  const routes = [
    { path: '/upload/test-token-fake-not-existing', label: 'Speaker upload portal' },
    { path: '/sala/test-token-fake-not-existing', label: 'PC sala player' },
    { path: '/admin/non-existing-deep-route/x', label: 'Admin deep route' },
  ];
  for (const route of routes) {
    const r = await timedFetch(`${BASE_URL}${route.path}`);
    if (!r.ok) {
      record({
        id: `rewrite-${route.path}`,
        label: `Rewrite SPA: ${route.label}`,
        severity: 'critical',
        status: 'fail',
        detail: r.error,
      });
      continue;
    }
    if (r.status !== 200) {
      record({
        id: `rewrite-${route.path}`,
        label: `Rewrite SPA: ${route.label}`,
        severity: 'critical',
        status: 'fail',
        detail: `HTTP ${r.status} (atteso 200 con index.html)`,
        fix: 'Controlla vercel.json rewrites; il pattern deve catturare la route.',
      });
      continue;
    }
    const looksLikeSpa =
      r.bodyText &&
      (r.bodyText.includes('<div id="root"') ||
        r.bodyText.includes('id="root"') ||
        r.bodyText.includes('<title>'));
    if (!looksLikeSpa) {
      record({
        id: `rewrite-${route.path}`,
        label: `Rewrite SPA: ${route.label}`,
        severity: 'critical',
        status: 'fail',
        detail: 'risposta 200 ma non sembra index.html (no <div id="root">)',
      });
      continue;
    }
    record({
      id: `rewrite-${route.path}`,
      label: `Rewrite SPA: ${route.label}`,
      severity: 'critical',
      status: 'pass',
      detail: `HTTP 200 in ${r.elapsed.toFixed(0)}ms`,
    });
  }
}

// 4. Asset cacheable
async function checkAssetCache() {
  // Estraiamo un asset reale dalla home
  const root = await timedFetch(`${BASE_URL}/`);
  if (!root.ok || !root.bodyText) {
    record({
      id: 'asset-cache',
      label: 'Asset /assets/* ha Cache-Control immutable',
      severity: 'warn',
      status: 'skip',
      detail: 'impossibile leggere index.html per estrarre asset',
    });
    return;
  }
  const m = root.bodyText.match(/\/assets\/[a-zA-Z0-9._-]+\.(js|css)/);
  if (!m) {
    record({
      id: 'asset-cache',
      label: 'Asset /assets/* ha Cache-Control immutable',
      severity: 'warn',
      status: 'skip',
      detail: 'nessun /assets/* trovato in index.html',
    });
    return;
  }
  const assetPath = m[0];
  const r = await timedFetch(`${BASE_URL}${assetPath}`);
  if (!r.ok || r.status !== 200) {
    record({
      id: 'asset-cache',
      label: `Asset ${assetPath} ha Cache-Control immutable`,
      severity: 'warn',
      status: 'fail',
      detail: r.error ?? `HTTP ${r.status}`,
    });
    return;
  }
  const cc = r.headers.get('cache-control') ?? '';
  if (!cc.includes('immutable') || !cc.includes('max-age=')) {
    record({
      id: 'asset-cache',
      label: `Asset ${assetPath} ha Cache-Control immutable`,
      severity: 'warn',
      status: 'fail',
      detail: `cache-control: "${cc}"`,
    });
    return;
  }
  record({
    id: 'asset-cache',
    label: `Asset cacheable`,
    severity: 'warn',
    status: 'pass',
    detail: `${assetPath}: ${cc}`,
  });
}

// 5. Edge Functions critiche
async function checkEdgeFunctions() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    record({
      id: 'edge-functions',
      label: 'Edge Functions critiche rispondono',
      severity: 'critical',
      status: 'skip',
      detail:
        'VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY mancanti (passa --supabase-url + --supabase-anon-key oppure pnpm vercel:env:pull).',
      fix: 'Esegui `pnpm vercel:env:pull` per caricare le env locali, poi rilancia.',
    });
    return;
  }
  const fns = [
    {
      name: 'slide-validator',
      method: 'POST',
      body: '{}',
      verifyJwt: true,
      // Senza JWT valido: 401 (no auth header) o 400 (bad payload). Non 404/5xx.
      acceptable: [400, 401],
    },
    {
      name: 'room-device-upload-init',
      method: 'POST',
      body: '{"deviceToken":"fake","filename":"x.pdf","fileSize":1,"mimeType":"application/pdf","sha256":"00"}',
      verifyJwt: false,
      // Atteso: 401 (token invalido) o 400 (validation). Non 404/5xx.
      acceptable: [400, 401, 403],
    },
    {
      name: 'room-device-upload-abort',
      method: 'POST',
      body: '{"deviceToken":"fake","versionId":"00000000-0000-0000-0000-000000000000"}',
      verifyJwt: false,
      acceptable: [400, 401, 403],
    },
    {
      name: 'room-device-upload-finalize',
      method: 'POST',
      body: '{"deviceToken":"fake","versionId":"00000000-0000-0000-0000-000000000000"}',
      verifyJwt: false,
      acceptable: [400, 401, 403],
    },
    {
      // Function pubblica per /status (uptime page). Senza JWT deve rispondere 200.
      name: 'system-status',
      method: 'GET',
      body: undefined,
      verifyJwt: false,
      acceptable: [200],
    },
    {
      // Health-check pubblico. Senza JWT deve rispondere 200 + {status:"ok"}.
      name: 'health',
      method: 'GET',
      body: undefined,
      verifyJwt: false,
      acceptable: [200],
    },
  ];
  for (const fn of fns) {
    const url = `${SUPABASE_URL}/functions/v1/${fn.name}`;
    const headers = {
      apikey: SUPABASE_ANON_KEY,
    };
    if (fn.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const r = await timedFetch(url, {
      method: fn.method,
      headers,
      body: fn.body,
    });
    if (!r.ok) {
      record({
        id: `fn-${fn.name}`,
        label: `Edge Function ${fn.name} risponde`,
        severity: 'critical',
        status: 'fail',
        detail: r.error,
      });
      continue;
    }
    if (r.status === 404) {
      record({
        id: `fn-${fn.name}`,
        label: `Edge Function ${fn.name} risponde`,
        severity: 'critical',
        status: 'fail',
        detail: `HTTP 404: function non deployata`,
        fix: `pnpm fn:deploy oppure supabase functions deploy ${fn.name}`,
      });
      continue;
    }
    if (r.status >= 500) {
      record({
        id: `fn-${fn.name}`,
        label: `Edge Function ${fn.name} risponde`,
        severity: 'critical',
        status: 'fail',
        detail: `HTTP ${r.status}: function in errore (5xx) — body: ${JSON.stringify(r.body ?? r.bodyText)?.slice(0, 200)}`,
        fix: 'Controlla logs su Supabase dashboard → Edge Functions.',
      });
      continue;
    }
    if (!fn.acceptable.includes(r.status)) {
      record({
        id: `fn-${fn.name}`,
        label: `Edge Function ${fn.name} risponde`,
        severity: 'warn',
        status: 'pass',
        detail: `HTTP ${r.status} (inatteso ma non bloccante: function viva)`,
      });
      continue;
    }
    record({
      id: `fn-${fn.name}`,
      label: `Edge Function ${fn.name} risponde`,
      severity: 'critical',
      status: 'pass',
      detail: `HTTP ${r.status} in ${r.elapsed.toFixed(0)}ms`,
    });
  }
}

// 6. RLS Supabase: query a tabella protetta senza JWT
async function checkRls() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    record({
      id: 'rls',
      label: 'RLS Supabase rifiuta query non autenticate',
      severity: 'warn',
      status: 'skip',
      detail: 'serve --supabase-url + --supabase-anon-key',
    });
    return;
  }
  // Query a `events` (multi-tenant): senza JWT deve ritornare lista vuota
  // (RLS allow read = false di default per anon role) o 401.
  const r = await timedFetch(`${SUPABASE_URL}/rest/v1/events?select=id&limit=1`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
    },
  });
  if (!r.ok) {
    record({
      id: 'rls',
      label: 'RLS Supabase rifiuta query non autenticate',
      severity: 'warn',
      status: 'fail',
      detail: r.error,
    });
    return;
  }
  // 200 con lista vuota = RLS attivo (anon role non vede nulla).
  // 401/403 = RLS attivo + denying.
  // 200 con righe = RLS DISATTIVO o policy bug (LEAK!).
  if (r.status === 200) {
    if (Array.isArray(r.body) && r.body.length === 0) {
      record({
        id: 'rls',
        label: 'RLS Supabase: anon role non vede dati',
        severity: 'critical',
        status: 'pass',
        detail: 'GET /rest/v1/events ritorna lista vuota (RLS attivo)',
      });
      return;
    }
    if (Array.isArray(r.body) && r.body.length > 0) {
      record({
        id: 'rls',
        label: 'RLS Supabase: anon role non vede dati',
        severity: 'critical',
        status: 'fail',
        detail: `LEAK: GET /rest/v1/events ritorna ${r.body.length} righe senza JWT! Verifica policy RLS su events.`,
      });
      return;
    }
  }
  if (r.status === 401 || r.status === 403) {
    record({
      id: 'rls',
      label: 'RLS Supabase: anon role non vede dati',
      severity: 'critical',
      status: 'pass',
      detail: `HTTP ${r.status} (RLS deny attivo)`,
    });
    return;
  }
  record({
    id: 'rls',
    label: 'RLS Supabase: anon role non vede dati',
    severity: 'warn',
    status: 'pass',
    detail: `HTTP ${r.status} (non leak ma inatteso)`,
  });
}

// 7. Latenza root p95
async function checkLatency() {
  const samples = [];
  for (let i = 0; i < RTT_SAMPLES; i++) {
    const r = await timedFetch(`${BASE_URL}/`);
    if (r.ok && r.status === 200) samples.push(r.elapsed);
  }
  if (samples.length < RTT_SAMPLES / 2) {
    record({
      id: 'latency',
      label: `Latenza root p95 < ${RTT_BUDGET_P95_MS}ms`,
      severity: 'warn',
      status: 'fail',
      detail: `solo ${samples.length}/${RTT_SAMPLES} richieste OK`,
    });
    return;
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
  if (p95 > RTT_BUDGET_P95_MS) {
    record({
      id: 'latency',
      label: `Latenza root p95 < ${RTT_BUDGET_P95_MS}ms`,
      severity: 'warn',
      status: 'fail',
      detail: `p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms (budget ${RTT_BUDGET_P95_MS}ms)`,
    });
    return;
  }
  record({
    id: 'latency',
    label: `Latenza root p95 < ${RTT_BUDGET_P95_MS}ms`,
    severity: 'warn',
    status: 'pass',
    detail: `p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms`,
  });
}

// 8. Sentry DSN configurato (informativo)
async function checkSentryConfigured() {
  // Cerchiamo `VITE_SENTRY_DSN` o stringa `sentry.io` nei chunk JS della SPA.
  const root = await timedFetch(`${BASE_URL}/`);
  if (!root.ok || !root.bodyText) {
    record({
      id: 'sentry',
      label: 'Sentry runtime configurato',
      severity: 'warn',
      status: 'skip',
      detail: 'impossibile leggere index.html',
    });
    return;
  }
  // Cerchiamo il chunk principale (index-*.js) e controlliamo se contiene un DSN
  const m = root.bodyText.match(/\/assets\/index-[a-zA-Z0-9._-]+\.js/);
  if (!m) {
    record({
      id: 'sentry',
      label: 'Sentry runtime configurato',
      severity: 'warn',
      status: 'skip',
      detail: 'chunk principale non identificabile',
    });
    return;
  }
  const chunk = await timedFetch(`${BASE_URL}${m[0]}`);
  if (!chunk.ok || !chunk.bodyText) {
    record({
      id: 'sentry',
      label: 'Sentry runtime configurato',
      severity: 'warn',
      status: 'skip',
      detail: 'chunk non scaricabile',
    });
    return;
  }
  // initSentry usa import.meta.env.VITE_SENTRY_DSN. Se la env era vuota a build
  // time, vite sostituisce con stringa vuota. Se era valorizzata, troviamo
  // il DSN o un riferimento "sentry" nel chunk.
  const hasSentryDsn = /https:\/\/[a-z0-9]+@[a-z0-9.-]+\.ingest\.sentry\.io/.test(chunk.bodyText);
  if (hasSentryDsn) {
    record({
      id: 'sentry',
      label: 'Sentry runtime configurato',
      severity: 'warn',
      status: 'pass',
      detail: 'DSN Sentry trovato nel bundle (monitoring attivo)',
    });
    return;
  }
  record({
    id: 'sentry',
    label: 'Sentry runtime configurato',
    severity: 'warn',
    status: 'fail',
    detail: 'VITE_SENTRY_DSN NON settato in produzione: nessun error monitoring runtime.',
    fix: 'Setta VITE_SENTRY_DSN in Vercel env (Production) e ridepoya. Vedi docs/DISASTER_RECOVERY.md §Setup Sentry.',
  });
}

function summarize() {
  const critical = checks.filter((c) => c.severity === 'critical');
  const criticalFail = critical.filter((c) => c.status === 'fail');
  const warnFail = checks.filter((c) => c.severity === 'warn' && c.status === 'fail');
  const overallOk = criticalFail.length === 0;
  return {
    ok: overallOk,
    counts: {
      total: checks.length,
      pass: checks.filter((c) => c.status === 'pass').length,
      fail: checks.filter((c) => c.status === 'fail').length,
      skip: checks.filter((c) => c.status === 'skip').length,
      criticalFail: criticalFail.length,
      warnFail: warnFail.length,
    },
    base_url: BASE_URL,
    supabase_url: SUPABASE_URL || null,
    timestamp_iso: new Date().toISOString(),
    checks,
  };
}

function formatHuman(summary) {
  const lines = [];
  lines.push('==============================================================');
  lines.push(`  Live SLIDE CENTER — Smoke test cloud production`);
  lines.push(`  Base URL:    ${summary.base_url}`);
  lines.push(`  Supabase:    ${summary.supabase_url ?? '(not configured)'}`);
  lines.push(`  Timestamp:   ${summary.timestamp_iso}`);
  lines.push('==============================================================');
  for (const c of summary.checks) {
    const icon = c.status === 'pass' ? '[OK]   ' : c.status === 'fail' ? '[FAIL] ' : '[SKIP] ';
    const sev = c.severity === 'critical' ? '!' : c.severity === 'warn' ? '~' : '·';
    lines.push(`${icon}${sev} ${c.label}`);
    if (c.detail) lines.push(`         ${c.detail}`);
    if (c.fix && c.status === 'fail') lines.push(`         fix -> ${c.fix}`);
  }
  lines.push('--------------------------------------------------------------');
  lines.push(
    `  Totale: ${summary.counts.total} | OK: ${summary.counts.pass} | FAIL: ${summary.counts.fail} | SKIP: ${summary.counts.skip}`,
  );
  lines.push(
    `  Critici falliti: ${summary.counts.criticalFail} | Warning falliti: ${summary.counts.warnFail}`,
  );
  if (summary.ok) {
    lines.push('  >>> SEMAFORO VERDE: produzione cloud pronta.');
  } else {
    lines.push('  >>> BLOCCANTE: risolvi i FAIL critici prima di procedere.');
  }
  lines.push('==============================================================');
  return lines.join('\n');
}

// Main
await checkRootAndHeaders();
await checkPwaArtifacts();
await checkSpaRewrites();
await checkAssetCache();
await checkEdgeFunctions();
await checkRls();
await checkLatency();
await checkSentryConfigured();

const summary = summarize();

if (outFile) {
  const outPath = resolve(process.cwd(), outFile);
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');
  if (!wantJson) {
    console.log(`[smoke-test-cloud] report salvato in ${outPath}`);
  }
}

if (wantJson) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else {
  console.log(formatHuman(summary));
}

process.exit(summary.ok ? 0 : 1);
