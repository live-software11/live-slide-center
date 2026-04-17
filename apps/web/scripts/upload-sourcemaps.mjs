// Live SLIDE CENTER - Upload sourcemap a Sentry (Sprint 5)
// Eseguito automaticamente come `postbuild` di apps/web.
//
// COMPORTAMENTO:
//   - Skippa SILENZIOSAMENTE se SENTRY_AUTH_TOKEN non e' settato (dev locali ok).
//   - Se SENTRY_AUTH_TOKEN e' presente, richiede anche SENTRY_ORG e SENTRY_PROJECT
//     altrimenti errore esplicito (config mezza fatta = bug).
//   - Usa @sentry/cli via npx (auto-installato al primo uso, no devDep aggiunta).
//   - Versione release = git short SHA + npm package version.
//   - Dopo upload riuscito, ELIMINA i .map dalla dist/ (non vanno serviti
//     pubblicamente: sono caricati su Sentry, basta li').
//
// VARIABILI AMBIENTE (settare in CI / Aruba deploy):
//   SENTRY_AUTH_TOKEN  obbligatoria per attivare l'upload (token con scope project:write)
//   SENTRY_ORG         es: live-software
//   SENTRY_PROJECT     es: slide-center-web
//   SENTRY_RELEASE     opzionale, default: <pkg-version>+<git-short-sha>
//   SENTRY_URL         opzionale, default: https://sentry.io (per self-hosted)
//
// USO MANUALE:
//   pnpm --filter @slidecenter/web build
//   (postbuild scatta automatico se var d'ambiente settate)

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');
const distDir = join(webRoot, 'dist');

const log = (msg) => console.log(`[sentry-upload] ${msg}`);
const warn = (msg) => console.warn(`[sentry-upload] AVVISO: ${msg}`);
const fail = (msg) => {
  console.error(`[sentry-upload] ERRORE: ${msg}`);
  process.exit(1);
};

// ── 1) Skip silenzioso se token mancante ──────────────────────────────────
const token = process.env.SENTRY_AUTH_TOKEN;
if (!token) {
  log('SENTRY_AUTH_TOKEN non settato → skip upload (build locale, ok).');
  process.exit(0);
}

// ── 2) Validazione config completa ────────────────────────────────────────
const org = process.env.SENTRY_ORG;
const project = process.env.SENTRY_PROJECT;
if (!org || !project) {
  fail('SENTRY_AUTH_TOKEN settato ma SENTRY_ORG e/o SENTRY_PROJECT mancanti. Config incompleta.');
}

// ── 3) Verifica che la build esista e contenga sourcemap ──────────────────
if (!existsSync(distDir)) {
  fail(`dist/ non trovata in ${distDir}. Esegui prima 'pnpm build'.`);
}

const findSourcemaps = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findSourcemaps(full));
    } else if (entry.endsWith('.map')) {
      out.push(full);
    }
  }
  return out;
};

const maps = findSourcemaps(distDir);
if (maps.length === 0) {
  warn('Nessun file .map trovato in dist/. Verificare vite.config.ts (build.sourcemap=true).');
  process.exit(0);
}
log(`Trovati ${maps.length} sourcemap in dist/.`);

// ── 4) Calcola release identifier ─────────────────────────────────────────
let release = process.env.SENTRY_RELEASE;
if (!release) {
  const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8'));
  let sha = 'nogit';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: webRoot, encoding: 'utf8' }).trim();
  } catch {
    warn('git non disponibile, uso "nogit" come SHA.');
  }
  release = `slide-center-web@${pkg.version}+${sha}`;
}
log(`Release: ${release}`);

// ── 5) Esegui sentry-cli via npx ──────────────────────────────────────────
const sentryUrl = process.env.SENTRY_URL ?? 'https://sentry.io';
const env = {
  ...process.env,
  SENTRY_AUTH_TOKEN: token,
  SENTRY_ORG: org,
  SENTRY_PROJECT: project,
  SENTRY_URL: sentryUrl,
};

const run = (cmd) => {
  log(`> ${cmd}`);
  try {
    execSync(cmd, { cwd: webRoot, env, stdio: 'inherit' });
  } catch (err) {
    fail(`comando fallito: ${cmd}\n${err.message}`);
  }
};

run(`npx --yes @sentry/cli@latest releases new "${release}"`);
run(`npx --yes @sentry/cli@latest releases set-commits "${release}" --auto --ignore-missing`);
run(
  `npx --yes @sentry/cli@latest releases files "${release}" upload-sourcemaps ./dist ` +
    `--rewrite --url-prefix "~/" --validate`
);
run(`npx --yes @sentry/cli@latest releases finalize "${release}"`);

// ── 6) Cancella i .map da dist/ (non vanno pubblicati) ────────────────────
let removed = 0;
for (const m of maps) {
  try {
    unlinkSync(m);
    removed++;
  } catch (err) {
    warn(`impossibile cancellare ${m}: ${err.message}`);
  }
}
log(`Sourcemap pubblicate su Sentry e rimosse da dist/ (${removed}/${maps.length}).`);
log('Upload completato.');
