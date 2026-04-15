import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  // Carica `.env` / `.env.local` dalla root del monorepo (come da `.env.example`), non solo da `apps/web/`.
  envDir: repoRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
