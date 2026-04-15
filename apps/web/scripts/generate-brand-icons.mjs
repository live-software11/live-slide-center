/**
 * Genera favicon, icone PWA e copia il logo sorgente in `public/`
 * da `icons/Logo Live Slide Center.jpg` (root monorepo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '../..');
const publicDir = path.join(webRoot, 'public');
const logoSrc = path.join(repoRoot, 'icons', 'Logo Live Slide Center.jpg');
const destJpg = path.join(publicDir, 'logo-live-slide-center.jpg');

if (!fs.existsSync(logoSrc)) {
  console.error(`[icons] File logo non trovato: ${logoSrc}`);
  process.exit(1);
}

await fs.promises.mkdir(publicDir, { recursive: true });

const base = sharp(logoSrc).rotate();

/** Logo usato in UI (sidebar, login): JPEG leggero, max lato 512px. */
await base
  .clone()
  .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(destJpg);

await base
  .clone()
  .resize(192, 192, { fit: 'cover', position: 'centre' })
  .png()
  .toFile(path.join(publicDir, 'pwa-192x192.png'));

await base
  .clone()
  .resize(512, 512, { fit: 'cover', position: 'centre' })
  .png()
  .toFile(path.join(publicDir, 'pwa-512x512.png'));

await base
  .clone()
  .resize(180, 180, { fit: 'cover', position: 'centre' })
  .png()
  .toFile(path.join(publicDir, 'apple-touch-icon.png'));

await base
  .clone()
  .resize(32, 32, { fit: 'cover', position: 'centre' })
  .png()
  .toFile(path.join(publicDir, 'favicon-32x32.png'));

await base
  .clone()
  .resize(16, 16, { fit: 'cover', position: 'centre' })
  .png()
  .toFile(path.join(publicDir, 'favicon-16x16.png'));

console.log('[icons] Brand assets generati in apps/web/public/');
