#!/usr/bin/env node
/**
 * Sprint P1 (GUIDA_OPERATIVA_v3 §4.H) — Pre-flight prerequisites checker per la
 * build di Live SLIDE CENTER Desktop.
 *
 * Verifica che la macchina abbia tutto il necessario per produrre il bundle
 * NSIS firmabile prima di lanciare la pipeline pesante. Best-effort: stampa
 * tutti i problemi rilevati, non si ferma al primo. Exit code 1 se qualcosa
 * manca.
 *
 * Controlli:
 *   1. Node >= 22 (allineato alle Cloud Functions Live PLAN/CREW e a Vite 8).
 *   2. pnpm presente (workspace).
 *   3. Rust toolchain (`rustc` >= 1.77.2 — MSRV di tauri-plugin-updater 2.x).
 *   4. Cargo Tauri CLI (`cargo tauri --version`).
 *   5. Solo Windows: WebView2 runtime (HKLM oppure HKCU). Se assente, l'NSIS
 *      bundler scarica il bootstrapper webview2 a runtime
 *      (`webviewInstallMode: downloadBootstrapper`) — quindi e' un warning,
 *      non un errore bloccante per la build, ma e' un errore bloccante per il
 *      run sull'host stesso senza ulteriore download.
 *
 * Uso:
 *   node ./scripts/check-prereqs.mjs              → check normale
 *   node ./scripts/check-prereqs.mjs --json       → output JSON (per CI / log)
 *   node ./scripts/check-prereqs.mjs --strict     → trasforma warning in errori
 */
import { execSync } from 'node:child_process';
import { platform, release } from 'node:os';

const args = new Set(process.argv.slice(2));
const wantJson = args.has('--json');
const strict = args.has('--strict');

const issues = []; // { level: 'error' | 'warn', code, message, fix? }

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return null;
  }
}

function compareSemver(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

const NODE_MIN = '22.0.0';
const RUST_MIN = '1.77.2';

const nodeVersion = process.versions.node;
if (compareSemver(nodeVersion, NODE_MIN) < 0) {
  issues.push({
    level: 'error',
    code: 'node_too_old',
    message: `Node ${nodeVersion} < ${NODE_MIN} richiesto`,
    fix: 'Installa Node 22+ via nvm o downloads.nodejs.org',
  });
}

const pnpmVersion = tryExec('pnpm --version');
if (!pnpmVersion) {
  issues.push({
    level: 'error',
    code: 'pnpm_missing',
    message: 'pnpm non trovato',
    fix: 'npm i -g pnpm@9 (oppure corepack enable)',
  });
}

const rustcOut = tryExec('rustc --version');
let rustcVersion = null;
if (!rustcOut) {
  issues.push({
    level: 'error',
    code: 'rustc_missing',
    message: 'rustc non trovato',
    fix: 'Installa Rust via https://rustup.rs (rustup-init.exe su Windows)',
  });
} else {
  // "rustc 1.82.0 (..." → "1.82.0"
  const match = rustcOut.match(/rustc\s+(\d+\.\d+\.\d+)/);
  rustcVersion = match ? match[1] : null;
  if (rustcVersion && compareSemver(rustcVersion, RUST_MIN) < 0) {
    issues.push({
      level: 'error',
      code: 'rustc_too_old',
      message: `rustc ${rustcVersion} < ${RUST_MIN} richiesto da tauri-plugin-updater 2.x`,
      fix: 'rustup update stable',
    });
  }
}

const tauriCliOut = tryExec('cargo tauri --version');
let tauriCliVersion = null;
if (!tauriCliOut) {
  issues.push({
    level: 'error',
    code: 'tauri_cli_missing',
    message: 'cargo tauri CLI non installato',
    fix: 'cargo install tauri-cli --version "^2.0" --locked',
  });
} else {
  // "tauri-cli 2.x.y" oppure "cargo-tauri 2.x.y"
  const m = tauriCliOut.match(/(\d+\.\d+\.\d+)/);
  tauriCliVersion = m ? m[1] : null;
  if (tauriCliVersion && compareSemver(tauriCliVersion, '2.0.0') < 0) {
    issues.push({
      level: 'error',
      code: 'tauri_cli_v1',
      message: `tauri CLI v${tauriCliVersion} non compatibile (serve v2.x)`,
      fix: 'cargo install tauri-cli --version "^2.0" --locked --force',
    });
  }
}

// Solo Windows: controllo WebView2 (HKLM o HKCU)
let webview2Status = 'skipped';
if (platform() === 'win32') {
  const wvHklm = tryExec(
    'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv',
  );
  const wvHkcu = tryExec(
    'reg query "HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv',
  );
  webview2Status = wvHklm || wvHkcu ? 'present' : 'missing';
  if (webview2Status === 'missing') {
    issues.push({
      level: 'warn',
      code: 'webview2_missing',
      message: 'WebView2 runtime non rilevato sull\'host (la build NSIS lo scarichera comunque a runtime via downloadBootstrapper)',
      fix: 'Per testare l\'app installata: scarica MicrosoftEdgeWebview2Setup.exe da Microsoft',
    });
  }
}

const summary = {
  ok: issues.filter((i) => i.level === 'error' || (strict && i.level === 'warn')).length === 0,
  platform: `${platform()} ${release()}`,
  node: nodeVersion,
  pnpm: pnpmVersion ?? null,
  rustc: rustcVersion ?? null,
  tauri_cli: tauriCliVersion ?? null,
  webview2: webview2Status,
  issues,
};

if (wantJson) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else {
  console.log('--- Live SLIDE CENTER Desktop — pre-build prereqs ---');
  console.log(`platform   : ${summary.platform}`);
  console.log(`node       : ${summary.node}${compareSemver(nodeVersion, NODE_MIN) < 0 ? ' (TOO OLD)' : ''}`);
  console.log(`pnpm       : ${summary.pnpm ?? 'MISSING'}`);
  console.log(`rustc      : ${summary.rustc ?? 'MISSING'}`);
  console.log(`tauri cli  : ${summary.tauri_cli ?? 'MISSING'}`);
  console.log(`webview2   : ${summary.webview2}`);
  console.log('-----------------------------------------------------');
  if (issues.length === 0) {
    console.log('OK — tutti i prerequisiti soddisfatti, puoi lanciare la build.');
  } else {
    for (const i of issues) {
      const tag = i.level === 'error' ? '[ERROR]' : '[WARN] ';
      console.log(`${tag} ${i.code}: ${i.message}`);
      if (i.fix) console.log(`        fix → ${i.fix}`);
    }
  }
}

process.exit(summary.ok ? 0 : 1);
