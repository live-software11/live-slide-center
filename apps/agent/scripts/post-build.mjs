#!/usr/bin/env node
/**
 * Post-build per Live SLIDE CENTER Local Agent.
 *
 * Copia gli artefatti prodotti da `cargo tauri build` in `release/live-slide-center-agent/`
 * con nomi standard, e produce un ZIP "portable" contenente l'eseguibile + README minimo.
 *
 * Output atteso (per ciascun build):
 *   release/live-slide-center-agent/
 *     Live-SLIDE-CENTER-Agent-Setup-0.1.0.exe        (NSIS installer, hooks Win11 attivi)
 *     Live-SLIDE-CENTER-Agent-Portable-0.1.0.zip     (eseguibile single-file + README)
 *     SHA256SUMS.txt                                 (hash SHA-256 dei due artefatti)
 *
 * Note implementative:
 *   - Niente dipendenze npm aggiuntive (no `archiver`): usiamo `Compress-Archive`
 *     built-in di PowerShell, gia' presente su qualsiasi Windows 11.
 *   - Hash SHA-256 calcolato in puro Node (`crypto`) per checklist anti-tamper operatore.
 *   - Il portable ZIP NON include WebView2 Runtime: l'installer NSIS lo bundle silenziosamente
 *     (vedi `tauri.conf.json` -> `webviewInstallMode.embedBootstrapper`); per il portable
 *     l'utente deve avere Edge / WebView2 gia' installato (default su Win 11).
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

const PRODUCT_SLUG = 'live-slide-center-agent';
const PRODUCT_PRETTY = 'Live SLIDE CENTER Agent';
const BIN_NAME = 'local-agent.exe';
const VERSION = '0.1.0';

/**
 * Code-signing opzionale (Sprint 5b) — skip silenzioso senza cert configurato.
 *
 * Variabili d'ambiente supportate (in ordine di preferenza):
 *   CERT_PFX_PATH + CERT_PASSWORD  → cert OV Sectigo / DigiCert su file .pfx (caso normale)
 *   CERT_THUMBPRINT                → cert installato in Windows Certificate Store (cert EV su token / HSM)
 *   CERT_SUBJECT                   → fallback se hai solo il Subject Name del cert
 *   TIMESTAMP_URL                  → default http://timestamp.sectigo.com
 *
 * Senza nessuna delle prime tre, la funzione e' un NO-OP totale: si stampa un
 * "[post-build] code-signing: SKIP" e si continua. Cosi' i build di sviluppo
 * locale di Andrea NON richiedono nulla di nuovo finche' il cert OV non arriva.
 *
 * Quando il cert arriva (vedi docs/Manuali/Manuale_Code_Signing.md), basta
 * settare le env nel terminale prima di lanciare release-licensed.bat:
 *   set CERT_PFX_PATH=C:\Certs\Sectigo-OV-2026.pfx
 *   set CERT_PASSWORD=<password-pfx>
 *   release-licensed.bat
 *
 * IMPORTANTE: il signing avviene PRIMA del calcolo SHA256, cosi' SHA256SUMS.txt
 * e' coerente con gli artefatti firmati che il cliente ricevera'.
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

  // Argomenti base condivisi
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
    console.error('  Assicurati che signtool.exe sia nel PATH (Windows SDK)');
    console.error('  e che il cert sia accessibile. Vedi docs/Manuali/Manuale_Code_Signing.md.');
    process.exit(1);
  }
}

const targetReleaseDir = join(root, 'src-tauri', 'target', 'release');
const nsisDir = join(targetReleaseDir, 'bundle', 'nsis');
const releaseDir = join(repoRoot, 'release', PRODUCT_SLUG);

const setupDest = join(releaseDir, `Live-SLIDE-CENTER-Agent-Setup-${VERSION}.exe`);
const portableZipDest = join(releaseDir, `Live-SLIDE-CENTER-Agent-Portable-${VERSION}.zip`);
const sumsDest = join(releaseDir, 'SHA256SUMS.txt');

await mkdir(releaseDir, { recursive: true });

// 1) Installer NSIS: cerchiamo *-setup.exe in bundle/nsis/
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

// 2) Portable ZIP: <bin>.exe + README.txt
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

// 2a) Code-signing (skip silenzioso senza cert): firma sia setup NSIS sia
// portable EXE PRIMA di Compress-Archive e PRIMA del calcolo SHA256.
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
  'Cache locale presentazioni:',
  '  %LOCALAPPDATA%\\LiveSLIDECENTER\\',
  '',
  'Note importanti:',
  '  - In modalita portable NON sono attivi gli hook installer NSIS (firewall',
  '    + esclusione Defender + set rete Private). Su LAN restrette il primo',
  '    avvio puo richiedere di accettare il prompt firewall di Windows.',
  '  - Per evitare ogni prompt usare invece l installer NSIS:',
  '    Live-SLIDE-CENTER-Agent-Setup-' + VERSION + '.exe',
  '',
  'Supporto: live.software11@gmail.com',
].join('\r\n');

await writeFile(join(stagingDir, 'README.txt'), readmeBody, 'utf8');

if (existsSync(portableZipDest)) {
  await rm(portableZipDest, { force: true });
}

// PowerShell built-in Compress-Archive: zero dipendenze npm.
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

// 3) SHA-256 anti-tamper checklist operatore.
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
