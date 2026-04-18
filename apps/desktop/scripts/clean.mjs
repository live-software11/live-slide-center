#!/usr/bin/env node
/**
 * Pulizia artefatti di build per Live SLIDE CENTER Desktop (Sprint J).
 *
 * Default: rimuove SOLO il bundle finale + il binario release (riusa la cache di compilazione Rust → build incrementale).
 *   - src-tauri/target/release/bundle
 *   - src-tauri/target/release/slide-center-desktop.exe
 *   - src-tauri/target/release/slide-center-desktop.pdb
 *   - ../web/dist-desktop (output Vite riusato come frontendDist Tauri)
 *
 * --full: rimuove TUTTO src-tauri/target (clean Rust completo, ricompilazione da zero).
 *   Da usare solo per release definitive o quando si cambia la versione delle deps.
 *
 * Mirrora apps/agent/scripts/clean.mjs per coerenza ecosistema desktop.
 */
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const repoRoot = join(root, '..', '..');
const full = process.argv.includes('--full');

const targets = full
  ? [join(root, 'src-tauri', 'target'), join(repoRoot, 'apps', 'web', 'dist-desktop')]
  : [
    join(root, 'src-tauri', 'target', 'release', 'bundle'),
    join(root, 'src-tauri', 'target', 'release', 'slide-center-desktop.exe'),
    join(root, 'src-tauri', 'target', 'release', 'slide-center-desktop.pdb'),
    join(repoRoot, 'apps', 'web', 'dist-desktop'),
  ];

for (const path of targets) {
  if (existsSync(path)) {
    await rm(path, { recursive: true, force: true });
    console.log(`[clean] rimosso ${path}`);
  }
}

console.log(
  `[clean] OK${full ? ' (full: target Rust completo rimosso)' : ' (cache Rust mantenuta)'}`,
);
