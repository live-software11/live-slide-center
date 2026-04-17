#!/usr/bin/env node
/**
 * Pulizia artefatti di build per Live SLIDE CENTER Local Agent.
 *
 * Default: rimuove SOLO il bundle finale (riusa la cache di compilazione Rust → build incrementale).
 *   - src-tauri/target/release/bundle
 *   - src-tauri/target/release/local-agent.exe
 *
 * --full: rimuove TUTTO src-tauri/target (clean Rust completo, ricompilazione da zero).
 *   Da usare solo per release definitive o quando si cambia la versione delle deps.
 *
 * Eseguito da `npm run clean` (default) o `npm run clean:full`.
 */
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const full = process.argv.includes('--full');

const targets = full
  ? [join(root, 'src-tauri', 'target')]
  : [
    join(root, 'src-tauri', 'target', 'release', 'bundle'),
    join(root, 'src-tauri', 'target', 'release', 'local-agent.exe'),
    join(root, 'src-tauri', 'target', 'release', 'local-agent.pdb'),
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
