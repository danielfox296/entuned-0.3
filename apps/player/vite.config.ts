import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Service worker is hand-authored in src/sw.ts and processed via injectManifest
// so we can wire push + notificationclick handlers (used by the iOS 16.4+ web
// push "music paused, tap to resume" nudge). Workbox auto-injects the
// precache manifest of hashed asset paths into the SW at build time.
//
// Manifest is generated from this config (single source of truth). The legacy
// public/manifest.json is retained as a fallback for the brief deploy window
// where browsers may have cached the old <link rel="manifest" href> path.
export default defineConfig({
  base: './',
  server: { port: 5177, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false, // We register manually in main.tsx so we can wire push subscription on activation.
      manifest: {
        name: 'Entuned',
        short_name: 'Entuned',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#20201c',
        theme_color: '#20201c',
        icons: [
          { src: './favicon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: './apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      injectManifest: {
        // Audio is too large to precache; we hydrate it lazily into IndexedDB
        // via src/lib/audio-cache.ts. SW only precaches the app shell.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
})
