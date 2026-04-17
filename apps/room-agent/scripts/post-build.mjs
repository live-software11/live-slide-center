#!/usr/bin/env node
/**
 * Post-build per Live SLIDE CENTER Room Agent.
 *
 * Copia gli artefatti prodotti da `cargo tauri build` in `release/live-slide-center-room-agent/`
 * con nomi standard, e produce un ZIP "portable" contenente l'eseguibile + README minimo.
 *
 * Output atteso (per ciascun build):
 *   release/live-slide-center-room-agent/
 *     Live-SLIDE-CENTER-Room-Agent-Setup-0.1.0.exe        (NSIS installer, hooks Win11 attivi)
 *     Live-SLIDE-CENTER-Room-Agent-Portable-0.1.0.zip     (eseguibile single-file + README)
 *     SHA256SUMS.txt                                      (hash SHA-256 dei due artefatti)
 *
 * Note implementative: vedi commento equivalente in `apps/agent/scripts/post-build.mjs`.
 */
import { mkdir, copyFile, readdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const repoRoot = join(root, '..', '..');

const PRODUCT_SLUG = 'live-slide-center-room-agent';
const PRODUCT_PRETTY = 'Live SLIDE CENTER Room Agent';
const BIN_NAME = 'room-agent.exe';
const VERSION = '0.1.0';

/**
 * Code-signing opzionale (Sprint 5b). Stesso pattern del Local Agent.
 * Vedi commento esteso in `apps/agent/scripts/post-build.mjs` e
 * `docs/Manuali/Manuale_Code_Signing.md`.
 */
function signFileIfConfigured(filePath) {
  const pfxPath = process.env.CERT_PFX_PATH;
  const password = process.env.CERT_PASSWORD;
  const subject = process.env.CERT_SUBJECT;
  const thumbprint = process.env.CERT_THUMBPRINT;
  const tsServer = process.env.TIMESTAMP_URL || 'http://timestamp.sectigo.com';

  if (!pfxPath && !subject && !thumbprint) {
    console.log(`[post-build] code-signing: SKIP ${basename(filePath)} (nessuna env CERT_* settata, build di sviluppo)`);
    return;
  }

  if (process.platform !== 'win32') {
    console.warn(`[post-build] code-signing: piattaforma non Windows (${process.platform}), signtool non disponibile, SKIP.`);
    return;
  }

  if (!existsSync(filePath)) {
    console.error(`[post-build] code-signing: file inesistente ${filePath}`);
    process.exit(1);
  }

  const args = ['sign', '/fd', 'sha256', '/tr', tsServer, '/td', 'sha256'];

  if (pfxPath) {
    if (!existsSync(pfxPath)) {
      console.error(`[post-build] code-signing: CERT_PFX_PATH non trovato: ${pfxPath}`);
      process.exit(1);
    }
    args.push('/f', pfxPath);
    if (password) {
      args.push('/p', password);
    }
  } else if (thumbprint) {
    args.push('/sha1', thumbprint);
  } else if (subject) {
    args.push('/n', subject);
  }

  args.push(filePath);

  console.log(`[post-build] code-signing: sign ${basename(filePath)} (timestamp ${tsServer})`);
  try {
    execFileSync('signtool', args, { stdio: 'inherit' });
    console.log(`[post-build] code-signing: OK ${basename(filePath)}`);
  } catch (err) {
    console.error(`[post-build] code-signing: FAIL ${basename(filePath)} -> ${err.message}`);
    console.error('  Vedi docs/Manuali/Manuale_Code_Signing.md per troubleshooting.');
    process.exit(1);
  }
}

const targetReleaseDir = join(root, 'src-tauri', 'target', 'release');
const nsisDir = join(targetReleaseDir, 'bundle', 'nsis');
const releaseDir = join(repoRoot, 'release', PRODUCT_SLUG);

const setupDest = join(releaseDir, `Live-SLIDE-CENTER-Room-Agent-Setup-${VERSION}.exe`);
const portableZipDest = join(releaseDir, `Live-SLIDE-CENTER-Room-Agent-Portable-${VERSION}.zip`);
const sumsDest = join(releaseDir, 'SHA256SUMS.txt');

await mkdir(releaseDir, { recursive: true });

// 1) Installer NSIS
if (!existsSync(nsisDir)) {
  console.error(`[post-build] ERRORE: cartella NSIS mancante: ${nsisDir}`);
  console.error('  Hai eseguito `npm run build:tauri` prima del post-build?');
  process.exit(1);
}
const nsisFiles = await readdir(nsisDir);
const setupFile = nsisFiles.find((f) => f.toLowerCase().endsWith('-setup.exe'));
if (!setupFile) {
  console.error(`[post-build] ERRORE: nessun *-setup.exe in ${nsisDir}`);
  console.error(`  Trovati: ${nsisFiles.join(', ') || '(vuoto)'}`);
  process.exit(1);
}
await copyFile(join(nsisDir, setupFile), setupDest);
console.log(`[post-build] NSIS installer -> ${setupDest}`);

// 2) Portable ZIP
const exeSrc = join(targetReleaseDir, BIN_NAME);
if (!existsSync(exeSrc)) {
  console.error(`[post-build] ERRORE: eseguibile non trovato: ${exeSrc}`);
  process.exit(1);
}

const stagingDir = join(releaseDir, '_portable-staging');
if (existsSync(stagingDir)) {
  await rm(stagingDir, { recursive: true, force: true });
}
await mkdir(stagingDir, { recursive: true });

const portableExeName = `${PRODUCT_SLUG}.exe`;
const portableExePath = join(stagingDir, portableExeName);
await copyFile(exeSrc, portableExePath);

// 2a) Code-signing opzionale: firma setup NSIS + portable EXE PRIMA di
// Compress-Archive e PRIMA di SHA256.
signFileIfConfigured(setupDest);
signFileIfConfigured(portableExePath);

const readmeBody = [
  `${PRODUCT_PRETTY} — Portable v${VERSION}`,
  '='.repeat(60),
  '',
  'Modalita portable: nessuna installazione, nessuna chiave di registro,',
  'nessuna scrittura permanente in Program Files.',
  '',
  'Requisiti minimi:',
  '  - Windows 10/11 64-bit',
  '  - Microsoft Edge / WebView2 Runtime (preinstallato su Win 11)',
  '',
  'Avvio:',
  `  Doppio click su ${portableExeName}.`,
  '',
  'Cartella locale presentazioni:',
  '  %LOCALAPPDATA%\\SlideCenter\\<roomId>\\',
  '',
  'Note importanti:',
  '  - In modalita portable NON sono attivi gli hook installer NSIS (esclusione',
  '    Defender + set rete Private + apertura UDP 5353 mDNS). In LAN restrette',
  '    la discovery automatica del Local Agent puo fallire: usare l indirizzo',
  '    IP manuale del Local Agent dalla schermata "Discovery".',
  '  - Per evitare ogni prompt usare invece l installer NSIS:',
  '    Live-SLIDE-CENTER-Room-Agent-Setup-' + VERSION + '.exe',
  '',
  'Supporto: live.software11@gmail.com',
].join('\r\n');

await writeFile(join(stagingDir, 'README.txt'), readmeBody, 'utf8');

if (existsSync(portableZipDest)) {
  await rm(portableZipDest, { force: true });
}

execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${portableZipDest}' -CompressionLevel Optimal -Force`,
  ],
  { stdio: 'inherit' },
);

await rm(stagingDir, { recursive: true, force: true });
console.log(`[post-build] Portable ZIP -> ${portableZipDest}`);

// 3) SHA-256
async function sha256(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

const setupHash = await sha256(setupDest);
const portableHash = await sha256(portableZipDest);
const sumsBody = [
  `# ${PRODUCT_PRETTY} v${VERSION} — SHA-256`,
  `# Generato: ${new Date().toISOString()}`,
  '',
  `${setupHash}  ${basename(setupDest)}`,
  `${portableHash}  ${basename(portableZipDest)}`,
  '',
].join('\r\n');
await writeFile(sumsDest, sumsBody, 'utf8');
console.log(`[post-build] SHA256SUMS -> ${sumsDest}`);

console.log('[post-build] OK');
