/**
 * Genera le icone Tauri (PNG + ICO) per Local Agent e Room Agent partendo
 * da `icons/Logo Live Slide Center.jpg` (root monorepo).
 *
 * Output (per ciascuno dei due agent):
 *   apps/<agent>/src-tauri/icons/
 *     32x32.png
 *     128x128.png
 *     128x128@2x.png   (256x256, retina)
 *     icon.png         (512x512, usato anche da tray)
 *     icon.ico         (PNG embedded 256x256, formato ICO Vista+)
 *
 * Il formato ICO con PNG embedded è il più semplice e supportato da Windows
 * Vista in poi: header `ICONDIR` (6 byte) + `ICONDIRENTRY` (16 byte) + PNG raw.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '../..');
const logoSrc = path.join(repoRoot, 'icons', 'Logo Live Slide Center.jpg');

if (!fs.existsSync(logoSrc)) {
  console.error(`[agent-icons] File logo non trovato: ${logoSrc}`);
  process.exit(1);
}

const targets = [
  path.join(repoRoot, 'apps', 'agent', 'src-tauri', 'icons'),
  path.join(repoRoot, 'apps', 'room-agent', 'src-tauri', 'icons'),
];

/**
 * Costruisce un buffer ICO contenente UN PNG (256x256) embedded.
 * @param {Buffer} png256 buffer PNG già 256x256
 * @returns {Buffer}
 */
function buildIcoFromPng(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(6 + 16, 12);

  return Buffer.concat([header, entry, png256]);
}

const base = sharp(logoSrc).rotate().ensureAlpha();

async function generateForDir(outDir) {
  await fs.promises.mkdir(outDir, { recursive: true });

  await base
    .clone()
    .resize(32, 32, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(path.join(outDir, '32x32.png'));

  await base
    .clone()
    .resize(128, 128, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(path.join(outDir, '128x128.png'));

  await base
    .clone()
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(path.join(outDir, '128x128@2x.png'));

  await base
    .clone()
    .resize(512, 512, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(path.join(outDir, 'icon.png'));

  const png256Buffer = await base
    .clone()
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  await fs.promises.writeFile(
    path.join(outDir, 'icon.ico'),
    buildIcoFromPng(png256Buffer),
  );
}

for (const dir of targets) {
  await generateForDir(dir);
  console.log(`[agent-icons] generate -> ${path.relative(repoRoot, dir)}`);
}

console.log('[agent-icons] OK: icone Tauri generate per Local Agent e Room Agent.');
