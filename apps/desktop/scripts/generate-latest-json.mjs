#!/usr/bin/env node
/**
 * Sprint D3 — Generazione manifest updater Tauri (`latest.json`).
 *
 * Tauri NON produce `latest.json` automaticamente: lo facciamo qui dopo aver
 * letto `release-output.json` (prodotto da `release.mjs`) e i file `.sig`
 * generati dalla build firmata.
 *
 * Pre-requisiti:
 *   • `pnpm release:nsis -- --signing-config src-tauri/tauri.signing.json`
 *     deve essere stato eseguito con successo (env `TAURI_SIGNING_PRIVATE_KEY`
 *     valorizzato).
 *   • Il bundle deve contenere `<installer>.sig` (firma Ed25519 ~88 byte).
 *
 * Output:
 *   `apps/desktop/latest.json` con shape:
 *   {
 *     "version": "0.1.0",
 *     "notes": "...",
 *     "pub_date": "2026-04-18T10:00:00Z",
 *     "platforms": {
 *       "windows-x86_64": {
 *         "signature": "<contenuto file .sig>",
 *         "url": "https://github.com/live-software11/live-slide-center/releases/download/desktop-v0.1.0/Live.SLIDE.CENTER.Desktop_0.1.0_x64-setup.exe"
 *       }
 *     }
 *   }
 *
 * Uso:
 *   node scripts/generate-latest-json.mjs
 *   node scripts/generate-latest-json.mjs --notes "Changelog v0.1.1: fix sync LAN."
 *   node scripts/generate-latest-json.mjs --tag desktop-v0.1.1
 *
 * Il tag default e' `desktop-v<version>` letto da `tauri.conf.json`. Lo
 * stesso schema viene usato dal workflow `.github/workflows/desktop-release.yml`.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const REPO_OWNER = 'live-software11';
const REPO_NAME = 'live-slide-center';
const RELEASE_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download`;

function getFlagValue(name, fallback = null) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return fallback;
  return argv[idx + 1];
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

(async () => {
  const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json');
  const releaseOutPath = join(root, 'release-output.json');

  if (!existsSync(tauriConfPath)) {
    console.error(`[latest-json] FAIL: ${tauriConfPath} non trovato.`);
    process.exit(1);
  }
  if (!existsSync(releaseOutPath)) {
    console.error(`[latest-json] FAIL: ${releaseOutPath} non trovato. Esegui prima 'pnpm release:nsis'.`);
    process.exit(1);
  }

  const tauriConf = await readJson(tauriConfPath);
  const releaseOut = await readJson(releaseOutPath);

  if (!releaseOut.updater?.enabled) {
    console.error('[latest-json] FAIL: updater non abilitato nella build (createUpdaterArtifacts=false). Riesegui con --signing-config.');
    process.exit(1);
  }

  const version = tauriConf.version;
  const tag = getFlagValue('--tag', `desktop-v${version}`);
  const notes = getFlagValue('--notes', `Live SLIDE CENTER Desktop v${version} — vedi CHANGELOG.md per i dettagli.`);

  const installerName = releaseOut.bundle.file;
  if (!installerName.toLowerCase().endsWith('-setup.exe')) {
    console.error(`[latest-json] FAIL: bundle.file inatteso (${installerName}); attesa estensione -setup.exe.`);
    process.exit(1);
  }

  const bundleDir = dirname(releaseOut.bundle.path);
  const sigCandidates = (await readdir(bundleDir)).filter((f) => f.toLowerCase().endsWith('-setup.exe.sig'));
  if (sigCandidates.length === 0) {
    console.error(`[latest-json] FAIL: nessun file .sig trovato in ${bundleDir}. Build firmata non eseguita?`);
    process.exit(1);
  }
  if (sigCandidates.length > 1) {
    console.warn(`[latest-json] WARN: piu' file .sig trovati (${sigCandidates.length}); uso il primo: ${sigCandidates[0]}`);
  }
  const sigPath = join(bundleDir, sigCandidates[0]);
  const signature = (await readFile(sigPath, 'utf8')).trim();
  if (signature.length < 50) {
    console.error(`[latest-json] FAIL: signature troppo corta (${signature.length} char). File .sig corrotto?`);
    process.exit(1);
  }

  const installerUrl = `${RELEASE_BASE}/${tag}/${encodeURIComponent(installerName)}`;

  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: installerUrl,
      },
    },
  };

  const outPath = join(root, 'latest.json');
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log('[latest-json] OK — manifest generato:');
  console.log(`  file       : ${outPath}`);
  console.log(`  version    : ${version}`);
  console.log(`  tag        : ${tag}`);
  console.log(`  installer  : ${installerName}`);
  console.log(`  url        : ${installerUrl}`);
  console.log(`  signature  : ${signature.length} char`);
  console.log('\n[latest-json] Prossimo step:');
  console.log(`  gh release create ${tag} --title "Desktop v${version}" --notes-file CHANGELOG.md \\`);
  console.log(`    "${releaseOut.bundle.path}" "${sigPath}" "${outPath}"`);
})().catch((e) => {
  console.error('[latest-json] FAIL imprevisto:', e);
  process.exit(1);
});
