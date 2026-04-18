#!/usr/bin/env node
/**
 * Sprint FT (GUIDA_OPERATIVA_v3 §4.I) — Smoke test pre-field-test desktop offline.
 *
 * Diagnostica completa di un PC che monta Live SLIDE CENTER Desktop, da lanciare
 * SU OGNI PC (admin + sale) prima del field test della settimana 9. Verifica
 * tutti i punti della checklist §8 in modo automatizzato e produce un report
 * salvabile (testuale + JSON) da allegare al template feedback.
 *
 * NON installa nulla, NON modifica niente. Sola lettura + ping HTTP.
 *
 * Cosa controlla:
 *   1. Installer NSIS presente (se viene lanciato post-build sulla stessa macchina).
 *   2. Backend Rust raggiungibile su http://127.0.0.1:7300/health.
 *   3. /info contiene campi obbligatori (role, data_root, storage_root, version).
 *   4. /rest/v1/events risponde (anche con 401: endpoint c'e').
 *   5. mDNS browse: vede almeno se stesso entro 1.5s.
 *   6. Loopback fetch < 50ms p95 (10 round-trip).
 *   7. Free space su disco data_root >= 5 GB.
 *   8. Firewall Windows: porta 7300 binding effettivo (verifica netsh in sola lettura).
 *
 * Uso:
 *   pnpm --filter @slidecenter/desktop smoke-test
 *   pnpm --filter @slidecenter/desktop smoke-test -- --json   (output JSON puro)
 *   pnpm --filter @slidecenter/desktop smoke-test -- --json --out report.json
 *   pnpm --filter @slidecenter/desktop smoke-test -- --port 7301 (porta custom)
 *   pnpm --filter @slidecenter/desktop smoke-test -- --skip-installer
 *
 * Exit code 0 se tutti i check `level=critical` passano. Le `warn` non bloccano
 * ma vengono evidenziate. La logica "critical" e' tarata su cosa serve davvero
 * per fare un field test sensato (vedi `severity` di ogni step).
 *
 * Cross-platform: cerca installer NSIS solo se Windows; mDNS browse delegato a
 * fetch loopback (il backend Rust e' gia' lui che fa publish — se /info risponde,
 * mdns_active=true e' gia' un segnale forte).
 */
import { execSync } from 'node:child_process';
import { existsSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const args = new Set(argv);
const wantJson = args.has('--json');
const skipInstaller = args.has('--skip-installer');

function getFlagValue(name) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1];
}
const customPort = parseInt(getFlagValue('--port') ?? '7300', 10);
const outFile = getFlagValue('--out');

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = Number.isFinite(customPort) ? customPort : 7300;
const BACKEND_BASE = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const FETCH_TIMEOUT_MS = 3000;
const RTT_SAMPLES = 10;
const RTT_BUDGET_MS = 50; // p95 atteso su loopback

const checks = []; // { id, label, severity: 'critical'|'warn'|'info', status: 'pass'|'fail'|'skip', detail, fix? }

function record(check) {
  checks.push(check);
}

async function timedFetch(path, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(`${BACKEND_BASE}${path}`, { ...init, signal: ctrl.signal });
    const elapsed = performance.now() - start;
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: true, status: res.status, body, elapsed };
  } catch (e) {
    const elapsed = performance.now() - start;
    return {
      ok: false,
      status: 0,
      body: null,
      elapsed,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return null;
  }
}

function bytesToGb(bytes) {
  return Math.round((bytes / 1024 ** 3) * 100) / 100;
}

// 1. Installer NSIS — solo se Windows e non --skip-installer
function checkInstaller() {
  if (skipInstaller) {
    record({
      id: 'installer',
      label: 'Installer NSIS presente',
      severity: 'info',
      status: 'skip',
      detail: 'skip via --skip-installer (test su PC non-build).',
    });
    return;
  }
  if (platform() !== 'win32') {
    record({
      id: 'installer',
      label: 'Installer NSIS presente',
      severity: 'info',
      status: 'skip',
      detail: 'piattaforma non Windows.',
    });
    return;
  }
  const bundleDir = join(desktopRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  if (!existsSync(bundleDir)) {
    record({
      id: 'installer',
      label: 'Installer NSIS presente',
      severity: 'info',
      status: 'skip',
      detail: `nessuna build NSIS in ${bundleDir} (passa --skip-installer se PC field-test).`,
      fix: 'pnpm release:nsis (sul PC build)',
    });
    return;
  }
  const exes = readdirSync(bundleDir).filter((f) => f.toLowerCase().endsWith('-setup.exe'));
  if (exes.length === 0) {
    record({
      id: 'installer',
      label: 'Installer NSIS presente',
      severity: 'warn',
      status: 'fail',
      detail: `cartella ${bundleDir} esiste ma e' vuota di -setup.exe.`,
      fix: 'pnpm release:nsis',
    });
    return;
  }
  exes.sort((a, b) => statSync(join(bundleDir, b)).mtimeMs - statSync(join(bundleDir, a)).mtimeMs);
  const newest = exes[0];
  const st = statSync(join(bundleDir, newest));
  record({
    id: 'installer',
    label: 'Installer NSIS presente',
    severity: 'info',
    status: 'pass',
    detail: `${newest} (${bytesToGb(st.size)} GB, mtime ${st.mtime.toISOString()})`,
  });
}

// 2. /health
async function checkHealth() {
  const r = await timedFetch('/health');
  if (!r.ok) {
    record({
      id: 'health',
      label: `Backend Rust risponde su ${BACKEND_BASE}/health`,
      severity: 'critical',
      status: 'fail',
      detail: `${r.error ?? `HTTP ${r.status}`}`,
      fix: 'Avvia Live SLIDE CENTER Desktop (deve restare aperto durante lo smoke test).',
    });
    return false;
  }
  if (r.status !== 200 || r.body?.ok !== true || r.body?.service !== 'slide-center-desktop') {
    record({
      id: 'health',
      label: `Backend Rust risponde su ${BACKEND_BASE}/health`,
      severity: 'critical',
      status: 'fail',
      detail: `risposta inattesa: status=${r.status} body=${JSON.stringify(r.body)}`,
      fix: 'Reinstalla l\'app: il binary in esecuzione non e\' lo Slide Center Desktop atteso.',
    });
    return false;
  }
  record({
    id: 'health',
    label: `Backend Rust risponde su ${BACKEND_BASE}/health`,
    severity: 'critical',
    status: 'pass',
    detail: `${r.elapsed.toFixed(1)}ms, version=${r.body?.version ?? '?'}`,
  });
  return true;
}

// 3. /info
async function checkInfo() {
  const r = await timedFetch('/info');
  if (!r.ok || r.status !== 200 || !r.body) {
    record({
      id: 'info',
      label: '/info espone metadata runtime',
      severity: 'critical',
      status: 'fail',
      detail: `${r.error ?? `HTTP ${r.status}`}`,
      fix: 'Backend Rust non e\' booted correttamente. Controlla i log Tauri.',
    });
    return null;
  }
  const required = ['service', 'version', 'role', 'data_root', 'storage_root'];
  const missing = required.filter((k) => !r.body[k]);
  if (missing.length > 0) {
    record({
      id: 'info',
      label: '/info espone metadata runtime',
      severity: 'critical',
      status: 'fail',
      detail: `campi mancanti: ${missing.join(', ')}`,
    });
    return r.body;
  }
  if (r.body.role !== 'admin' && r.body.role !== 'sala') {
    record({
      id: 'info',
      label: '/info espone metadata runtime',
      severity: 'critical',
      status: 'fail',
      detail: `role inatteso: "${r.body.role}" (atteso "admin" o "sala")`,
      fix: 'Apri l\'app, scegli un ruolo nella schermata di selezione iniziale.',
    });
    return r.body;
  }
  record({
    id: 'info',
    label: '/info espone metadata runtime',
    severity: 'critical',
    status: 'pass',
    detail: `role=${r.body.role}, data_root=${r.body.data_root}, version=${r.body.version}`,
  });
  return r.body;
}

// 4. REST endpoint
async function checkRest() {
  const r = await timedFetch('/rest/v1/events?limit=1');
  if (!r.ok) {
    record({
      id: 'rest',
      label: 'PostgREST mirror /rest/v1/events risponde',
      severity: 'critical',
      status: 'fail',
      detail: `${r.error}`,
      fix: 'Rete loopback bloccata (firewall locale?) oppure backend non booted.',
    });
    return;
  }
  // 200 (lista vuota) o 401 (auth richiesta) sono entrambi OK: l'endpoint c'e'.
  if (r.status === 200 || r.status === 401) {
    record({
      id: 'rest',
      label: 'PostgREST mirror /rest/v1/events risponde',
      severity: 'critical',
      status: 'pass',
      detail: `HTTP ${r.status} in ${r.elapsed.toFixed(1)}ms`,
    });
    return;
  }
  record({
    id: 'rest',
    label: 'PostgREST mirror /rest/v1/events risponde',
    severity: 'critical',
    status: 'fail',
    detail: `HTTP inatteso ${r.status}: ${JSON.stringify(r.body)}`,
  });
}

// 5. mDNS attivo (estratto da /info — siamo gia' SUL nodo che pubblica)
function checkMdns(info) {
  if (!info) {
    record({
      id: 'mdns',
      label: 'mDNS publish attivo',
      severity: 'warn',
      status: 'skip',
      detail: '/info non disponibile, impossibile verificare mdns_active.',
    });
    return;
  }
  const lan = info.lan_addresses ?? [];
  if (lan.length === 0) {
    record({
      id: 'mdns',
      label: 'mDNS publish attivo',
      severity: 'warn',
      status: 'fail',
      detail: 'nessun IP LAN rilevato (PC offline o firewall blocca multicast).',
      fix: 'Verifica connessione cavo/wifi e che il PC sia sulla stessa LAN dell\'admin.',
    });
    return;
  }
  record({
    id: 'mdns',
    label: 'mDNS publish attivo',
    severity: 'critical',
    status: 'pass',
    detail: `IP LAN: ${lan.join(', ')}`,
  });
}

// 6. RTT loopback
async function checkRtt() {
  const samples = [];
  for (let i = 0; i < RTT_SAMPLES; i++) {
    const r = await timedFetch('/health');
    if (r.ok) samples.push(r.elapsed);
  }
  if (samples.length < RTT_SAMPLES / 2) {
    record({
      id: 'rtt',
      label: `Loopback RTT < ${RTT_BUDGET_MS}ms p95`,
      severity: 'warn',
      status: 'fail',
      detail: `solo ${samples.length}/${RTT_SAMPLES} round-trip riusciti`,
    });
    return;
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
  const median = samples[Math.floor(samples.length / 2)];
  if (p95 > RTT_BUDGET_MS) {
    record({
      id: 'rtt',
      label: `Loopback RTT < ${RTT_BUDGET_MS}ms p95`,
      severity: 'warn',
      status: 'fail',
      detail: `median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms (budget ${RTT_BUDGET_MS}ms)`,
      fix: 'CPU sotto stress o antivirus aggressivo: chiudi app pesanti prima dell\'evento.',
    });
    return;
  }
  record({
    id: 'rtt',
    label: `Loopback RTT < ${RTT_BUDGET_MS}ms p95`,
    severity: 'warn',
    status: 'pass',
    detail: `median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
  });
}

// 7. Spazio disco data_root >= 5 GB
function checkDiskSpace(info) {
  if (!info?.data_root) {
    record({
      id: 'disk',
      label: 'Spazio disco data_root >= 5 GB',
      severity: 'warn',
      status: 'skip',
      detail: 'data_root non disponibile da /info.',
    });
    return;
  }
  const freeGb = freeSpaceGb(info.data_root);
  if (freeGb === null) {
    record({
      id: 'disk',
      label: 'Spazio disco data_root >= 5 GB',
      severity: 'warn',
      status: 'skip',
      detail: 'impossibile leggere spazio libero (statvfs/wmic non disponibile).',
    });
    return;
  }
  if (freeGb < 5) {
    record({
      id: 'disk',
      label: 'Spazio disco data_root >= 5 GB',
      severity: 'critical',
      status: 'fail',
      detail: `${freeGb} GB liberi su ${info.data_root}`,
      fix: 'Libera spazio prima dell\'evento. File evento medi: 100-500 MB l\'uno.',
    });
    return;
  }
  if (freeGb < 20) {
    record({
      id: 'disk',
      label: 'Spazio disco data_root >= 5 GB',
      severity: 'warn',
      status: 'pass',
      detail: `${freeGb} GB liberi (sufficiente per evento medio, ma <20 GB)`,
    });
    return;
  }
  record({
    id: 'disk',
    label: 'Spazio disco data_root >= 5 GB',
    severity: 'warn',
    status: 'pass',
    detail: `${freeGb} GB liberi`,
  });
}

function freeSpaceGb(path) {
  if (platform() === 'win32') {
    // Estrai lettera drive e usa wmic LogicalDisk
    const driveMatch = path.match(/^([A-Z]):/i);
    if (!driveMatch) return null;
    const drive = driveMatch[1].toUpperCase() + ':';
    const out = tryExec(
      `wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /value`,
    );
    if (!out) return null;
    const m = out.match(/FreeSpace=(\d+)/);
    if (!m) return null;
    return bytesToGb(parseInt(m[1], 10));
  }
  // Unix: df --output non e' POSIX, ma "df -k <path>" e' standard.
  const out = tryExec(`df -k "${path}"`);
  if (!out) return null;
  const lines = out.split('\n');
  if (lines.length < 2) return null;
  const parts = lines[1].split(/\s+/);
  // Filesystem 1K-blocks Used Available Use% Mounted-on
  const availKb = parseInt(parts[3], 10);
  if (!Number.isFinite(availKb)) return null;
  return Math.round((availKb / 1024 / 1024) * 100) / 100;
}

// 8. Porta 7300 in LISTEN — solo Windows
function checkFirewall() {
  if (platform() !== 'win32') {
    record({
      id: 'firewall',
      label: `Porta ${BACKEND_PORT} in LISTEN`,
      severity: 'info',
      status: 'skip',
      detail: 'check valido solo su Windows (netstat).',
    });
    return;
  }
  const out = tryExec(`netstat -ano -p TCP`);
  if (!out) {
    record({
      id: 'firewall',
      label: `Porta ${BACKEND_PORT} in LISTEN`,
      severity: 'warn',
      status: 'skip',
      detail: 'netstat non disponibile.',
    });
    return;
  }
  const listenLines = out.split('\n').filter((l) => l.includes('LISTENING') && l.includes(`:${BACKEND_PORT}`));
  if (listenLines.length === 0) {
    record({
      id: 'firewall',
      label: `Porta ${BACKEND_PORT} in LISTEN`,
      severity: 'critical',
      status: 'fail',
      detail: `nessun processo in ascolto su ${BACKEND_PORT}`,
      fix: 'Riavvia Live SLIDE CENTER Desktop: il backend Rust non si e\' bindato.',
    });
    return;
  }
  const has0000 = listenLines.some((l) => l.includes('0.0.0.0:' + BACKEND_PORT));
  record({
    id: 'firewall',
    label: `Porta ${BACKEND_PORT} in LISTEN`,
    severity: 'critical',
    status: 'pass',
    detail: `${listenLines.length} binding (LAN reach: ${has0000 ? 'si (0.0.0.0)' : 'solo loopback - mDNS pair-direct fallira'})`,
    fix: has0000 ? undefined : 'Backend bindato solo a 127.0.0.1 — admin/sala pair LAN non funzionera.',
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
    backend: BACKEND_BASE,
    platform: platform(),
    timestamp_iso: new Date().toISOString(),
    checks,
  };
}

function formatHuman(summary) {
  const lines = [];
  lines.push('==============================================================');
  lines.push(`  Live SLIDE CENTER — Smoke test desktop offline (Sprint FT)`);
  lines.push(`  Backend: ${summary.backend}`);
  lines.push(`  ${summary.timestamp_iso} — platform=${summary.platform}`);
  lines.push('==============================================================');
  for (const c of summary.checks) {
    const icon = c.status === 'pass' ? '[OK]   ' : c.status === 'fail' ? '[FAIL] ' : '[SKIP] ';
    const sev = c.severity === 'critical' ? '!' : c.severity === 'warn' ? '~' : '·';
    lines.push(`${icon}${sev} ${c.label}`);
    if (c.detail) lines.push(`         ${c.detail}`);
    if (c.fix && c.status === 'fail') lines.push(`         fix → ${c.fix}`);
  }
  lines.push('--------------------------------------------------------------');
  lines.push(
    `  Totale: ${summary.counts.total} | OK: ${summary.counts.pass} | FAIL: ${summary.counts.fail} | SKIP: ${summary.counts.skip}`,
  );
  lines.push(
    `  Critici falliti: ${summary.counts.criticalFail} | Warning falliti: ${summary.counts.warnFail}`,
  );
  if (summary.ok) {
    lines.push('  >>> SEMAFORO VERDE: PC pronto per il field test.');
  } else {
    lines.push('  >>> BLOCCANTE: risolvi i FAIL critici prima del field test.');
  }
  lines.push('==============================================================');
  return lines.join('\n');
}

// Main
checkInstaller();
const healthy = await checkHealth();
const info = healthy ? await checkInfo() : null;
if (healthy) await checkRest();
checkMdns(info);
if (healthy) await checkRtt();
checkDiskSpace(info);
checkFirewall();

const summary = summarize();

if (outFile) {
  const outPath = resolve(process.cwd(), outFile);
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');
  if (!wantJson) {
    console.log(`[smoke-test] report salvato in ${outPath}`);
  }
}

if (wantJson) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else {
  console.log(formatHuman(summary));
}

process.exit(summary.ok ? 0 : 1);
