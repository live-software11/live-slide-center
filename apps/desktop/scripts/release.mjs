#!/usr/bin/env node
/**
 * Sprint P1 + P5 (GUIDA_OPERATIVA_v3 §4.H) — Release pipeline orchestrator per
 * Live SLIDE CENTER Desktop.
 *
 * Pipeline:
 *   1. check-prereqs (node, pnpm, rust, tauri-cli, webview2)
 *   2. clean        (bundle precedente + dist-desktop SPA)
 *   3. cargo tauri build
 *      - tauri.conf.json `beforeBuildCommand` lancia gia' `pnpm build:desktop`
 *        sulla SPA, quindi non lo richiamiamo qui (evitiamo doppia build).
 *   4. Locate del bundle NSIS finale + sha256 + size + path stampato.
 *
 * Convenzioni:
 *   • Funziona cross-platform (Win/Mac/Linux): chiama solo `pnpm` e `node` in
 *     subprocess, niente PowerShell-only.
 *   • Exit non-zero su qualsiasi step fallito.
 *   • Output finale stampato anche in `release-output.json` per CI/log.
 *
 * Uso:
 *   pnpm --filter @slidecenter/desktop release:nsis
 *   node ./scripts/release.mjs --skip-prereqs   (per CI dove i tool sono gia' provisionati)
 *   node ./scripts/release.mjs --debug          (build con symbols + console)
 */
import { execSync, spawnSync } from 'node:child_process';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const repoRoot = resolve(root, '..', '..');

const argv = process.argv.slice(2);
const args = new Set(argv);
const skipPrereqs = args.has('--skip-prereqs');
const debug = args.has('--debug');

// Sprint P4 — flag `--signing-config <path>` per attivare la build firmata
// (NSIS + updater bundle). Se assente, la build resta unsigned e
// `createUpdaterArtifacts: false` di default.
function getFlagValue(name) {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1];
}
const signingConfig = getFlagValue('--signing-config');

function step(label) {
  const sep = '='.repeat(60);
  console.log(`\n${sep}\n[release] ${label}\n${sep}`);
}

function run(cmd, opts = {}) {
  console.log(`[release] $ ${cmd}`);
  const res = spawnSync(cmd, {
    cwd: opts.cwd || root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...opts.env },
  });
  if (res.status !== 0) {
    console.error(`[release] FAIL (${cmd})`);
    process.exit(res.status ?? 1);
  }
}

async function sha256OfFile(path) {
  const hash = createHash('sha256');
  await new Promise((res, rej) => {
    const s = createReadStream(path);
    s.on('data', (c) => hash.update(c));
    s.on('end', res);
    s.on('error', rej);
  });
  return hash.digest('hex');
}

async function findNsisInstaller(bundleDir) {
  if (!existsSync(bundleDir)) return null;
  const entries = await readdir(bundleDir);
  const exe = entries.find((e) => e.toLowerCase().endsWith('-setup.exe'));
  if (!exe) return null;
  const full = join(bundleDir, exe);
  const st = await stat(full);
  return { name: exe, path: full, size: st.size };
}

async function findUpdaterArtifacts(bundleDir) {
  if (!existsSync(bundleDir)) return [];
  const entries = await readdir(bundleDir);
  return entries
    .filter((e) => e.endsWith('.sig') || e === 'latest.json' || e.endsWith('.exe.zip') || e.endsWith('.nsis.zip'))
    .map((e) => join(bundleDir, e));
}

(async () => {
  step('1. check-prereqs');
  if (skipPrereqs) {
    console.log('[release] skip (flag --skip-prereqs)');
  } else {
    run('node scripts/check-prereqs.mjs');
  }

  step('2. clean precedenti bundle + dist-desktop SPA');
  run('node scripts/clean.mjs');

  step('3. cargo tauri build (frontend SPA + Rust + NSIS)');
  // tauri.conf.json `beforeBuildCommand` lancia automaticamente
  // `pnpm --filter @slidecenter/web build:desktop` quindi NON ripetiamo qui.
  const flags = ['--manifest-path', 'src-tauri/Cargo.toml'];
  if (debug) flags.push('--debug');
  if (signingConfig) {
    if (!existsSync(signingConfig)) {
      console.error(`[release] FAIL: signing config non trovato: ${signingConfig}`);
      process.exit(1);
    }
    if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
      console.warn('[release] WARN: --signing-config attivo ma TAURI_SIGNING_PRIVATE_KEY non settata.');
      console.warn('[release]       L\'updater signing fallira\'. Vedi apps/desktop/CODE_SIGNING.md');
    }
    flags.push('--config', signingConfig);
    console.log(`[release] signing config: ${signingConfig}`);
  }
  const tauriCmd = `cargo tauri build ${flags.join(' ')}`;
  run(tauriCmd);

  step('4. localizza bundle NSIS finale');
  const profileDir = debug ? 'debug' : 'release';
  const bundleDir = join(root, 'src-tauri', 'target', profileDir, 'bundle', 'nsis');
  const installer = await findNsisInstaller(bundleDir);
  if (!installer) {
    console.error(`[release] FAIL: bundle NSIS non trovato in ${bundleDir}`);
    process.exit(1);
  }
  const sizeMb = (installer.size / 1024 / 1024).toFixed(2);
  const sha = await sha256OfFile(installer.path);
  const updaterArtifacts = await findUpdaterArtifacts(bundleDir);

  console.log('\n[release] OK — bundle prodotto:');
  console.log(`  file       : ${installer.name}`);
  console.log(`  path       : ${installer.path}`);
  console.log(`  size       : ${sizeMb} MB (${installer.size} bytes)`);
  console.log(`  sha256     : ${sha}`);
  console.log(`  updater?   : ${updaterArtifacts.length > 0 ? updaterArtifacts.length + ' artifacts' : 'no (createUpdaterArtifacts=false oppure plugin non configurato)'}`);
  if (updaterArtifacts.length > 0) {
    for (const a of updaterArtifacts) {
      console.log(`             - ${a}`);
    }
  }

  // Salva un manifest JSON pronto per release notes / GitHub Actions.
  const outManifest = {
    productName: 'Live SLIDE CENTER Desktop',
    builtAt: new Date().toISOString(),
    profile: profileDir,
    bundle: {
      file: installer.name,
      path: installer.path,
      size: installer.size,
      sizeMb: Number(sizeMb),
      sha256: sha,
    },
    updater: {
      enabled: updaterArtifacts.length > 0,
      artifacts: updaterArtifacts,
    },
  };
  const outPath = join(root, 'release-output.json');
  await writeFile(outPath, JSON.stringify(outManifest, null, 2) + '\n', 'utf8');
  console.log(`\n[release] manifest scritto in ${outPath}`);

  // Hint distribuzione
  console.log('\n[release] Prossimi step (Sprint P5):');
  console.log('  • Test installer su 3 PC Windows diversi (Win10/Win11/Win11 enterprise).');
  console.log('  • Verifica che il PC sala faccia auto-rejoin dopo riavvio.');
  console.log('  • Pubblica installer su GitHub Releases (account live-software11)');
  console.log('    insieme a `latest.json` se updater abilitato.');
})().catch((e) => {
  console.error('[release] FAIL imprevisto:', e);
  process.exit(1);
});
