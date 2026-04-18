import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// Sprint J4 — build target desktop (Tauri 2 webview). `--mode desktop` triggera:
//   • base path relativo `./` (file:// dentro la webview)
//   • output isolato in `dist-desktop/` (cosi' la build cloud Vercel resta intatta)
//   • PWA disabilitata (Tauri webview non ha bisogno di service worker; servirebbe solo a confondere lo stato)
//   • `VITE_BACKEND_MODE=desktop` injectato in `import.meta.env` (override del valore .env)
// In modalita default (cloud) tutto resta come prima → zero rischio regressione su Vercel.
export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'desktop';

  const plugins: PluginOption[] = [react(), tailwindcss()];

  if (!isDesktop) {
    plugins.push(
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon-16x16.png',
          'favicon-32x32.png',
          'apple-touch-icon.png',
          'logo-live-slide-center.jpg',
        ],
        manifest: {
          name: 'Live SLIDE CENTER',
          short_name: 'SLIDE CENTER',
          description: 'Live event presentation management system',
          theme_color: '#07101f',
          background_color: '#07101f',
          display: 'standalone',
          orientation: 'portrait-primary',
          scope: '/',
          start_url: '/pair',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,jpg}'],
          // Sprint Hardening Pre-Field-Test §2.1: alza il cap precache da 2 MB
          // (default Workbox) a 5 MB. I chunk pdfjs-dist (~700 KB) e le icone
          // alta risoluzione altrimenti vengono silently skippati senza
          // warning loud nei log build, lasciando il primo load offline rotto.
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Sprint Q+1 hardening commerciale:
          //   - NIENTE cache su /auth/v1/* e /realtime/v1/* (sicurezza sessioni
          //     + websocket non cacheable).
          //   - PostgREST (REST API): NetworkFirst con TTL breve (10 min)
          //     SOLO su GET. Mutation (POST/PATCH/DELETE) bypassano la cache
          //     per non rischiare doppi invii dopo offline.
          //   - storage signed URL: TTL ridotto a 60s (i sign URL durano 5 min,
          //     evitiamo di servire cache scaduta dopo 4 minuti).
          navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
          runtimeCaching: [
            {
              urlPattern: ({ url, request }) =>
                /\.supabase\.co$/.test(url.hostname) &&
                url.pathname.startsWith('/rest/v1/') &&
                request.method === 'GET',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-rest-get',
                expiration: {
                  maxEntries: 80,
                  maxAgeSeconds: 60 * 10,
                },
                networkTimeoutSeconds: 8,
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url }) =>
                /\.supabase\.co$/.test(url.hostname) &&
                url.pathname.startsWith('/storage/v1/object/sign/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-signed-downloads',
                expiration: {
                  maxEntries: 40,
                  maxAgeSeconds: 60,
                },
                networkTimeoutSeconds: 25,
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    );
  }

  return {
    // Carica `.env` / `.env.local` dalla root del monorepo (come da `.env.example`), non solo da `apps/web/`.
    envDir: repoRoot,
    base: isDesktop ? './' : '/',
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      // Tauri 2 dev (apps/desktop) si aspetta il dev server qui (vedi tauri.conf.json devUrl).
      port: 5173,
      strictPort: true,
      fs: { allow: [repoRoot] },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      outDir: isDesktop ? 'dist-desktop' : 'dist',
      // Tauri webview non ha bisogno di chunk size warnings overzealous (e' tutto file://).
      chunkSizeWarningLimit: isDesktop ? 2048 : 1024,
    },
    define: isDesktop
      ? {
        // Forza la backend mode quando si builda per Tauri, indipendentemente da .env.
        // L'utente puo' comunque settare VITE_BACKEND_MODE=cloud nello shell per testare la SPA cloud dentro Tauri (es. demo).
        'import.meta.env.VITE_BACKEND_MODE': JSON.stringify(
          process.env.VITE_BACKEND_MODE ?? 'desktop',
        ),
      }
      : undefined,
  };
});
