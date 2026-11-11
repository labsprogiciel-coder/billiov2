import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { resolve } from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/tax-bf.ts'],
      reporter: ['text', 'html'],
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Third-party libraries every page needs go in their own chunks: none
        // passes the 500 kB warning, and they stay cached across app deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase';
          if (/node_modules\/@sentry(-internal)?\//.test(id)) return 'vendor-sentry';
          if (id.includes('node_modules/posthog-js/')) return 'vendor-posthog';
          // The PDF engine (~1.5 MB) is only loaded when a PDF is generated
          // (src/lib/render-pdf.tsx). Split along its dependency order
          // (fonts & compression ← pdfkit ← React renderer) so no file passes
          // 500 kB and the chunks don't import each other in a cycle.
          if (/node_modules\/(fontkit|restructure|unicode-[a-z-]+|hyphen|linebreak|dfa|clone|pako|brotli|tiny-inflate|png-js|jay-peg)\//.test(id)) return 'pdf-fonts';
          if (/node_modules\/(@react-pdf\/pdfkit|@noble|crypto-js)\//.test(id)) return 'pdf-kit';
          if (id.includes('node_modules/@react-pdf/reconciler/')) return 'pdf-reconciler';
        },
      },
    },
  },
  plugins: [react(), sentryVitePlugin({
    org: process.env.VITE_SENTRY_ORG,
    project: process.env.VITE_SENTRY_PROJECT,
    authToken: process.env.VITE_SENTRY_AUTH_TOKEN,
    telemetry: false,
  }), VitePWA({
    registerType: 'autoUpdate',
    injectRegister: false,

    pwaAssets: {
      disabled: false,
      config: true,
    },

    manifest: {
      name: 'Billio — Invoicing',
      short_name: 'Billio',
      description: 'Professional invoicing for West African SMBs — create, send and track invoices with Mobile Money support.',
      theme_color: '#185FA5',
      background_color: '#EAEEF3',
      display: 'standalone',
      orientation: 'portrait-primary',
      categories: ['finance', 'business', 'productivity'],
    },

    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      // The assistant's optional diagram renderer (mermaid, from CopilotKit) is
      // large and only loads when a chat draws a diagram: don't precache it
      globIgnores: ['**/mermaid-*.js'],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      navigateFallback: 'index.html',
    },

    devOptions: {
      enabled: false,
      navigateFallback: 'index.html',
      suppressWarnings: true,
      type: 'module',
    },
  })],
})