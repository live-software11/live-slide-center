import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  // Carica `.env` / `.env.local` dalla root del monorepo (come da `.env.example`), non solo da `apps/web/`.
  envDir: repoRoot,
  plugins: [
    react(),
    tailwindcss(),
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
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 10,
              },
              networkTimeoutSeconds: 8,
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-signed-downloads',
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 60 * 4,
              },
              networkTimeoutSeconds: 25,
            },
          },
        ],
      },
    }),
  ],
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
