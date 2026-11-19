import { appBitmapTypographyPlugin } from './scripts/app-bitmap-typography.mjs';
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from 'node:url';
import { bundledBitmapFontPlugin } from './scripts/bundled-bitmap-font.mjs';
import { windowsPortableAssetsPlugin } from './scripts/windows-portable-assets.mjs';
import { PRIVATE_VISUAL_MODE, PRIVATE_COLOR_MODE, PRIVATE_LAYOUT_MODE, PRIVATE_ROLE_MODE, PRIVATE_LIGHT_MODE, privateVisualAssetsPlugin } from './scripts/private-visual-assets.mjs';

export default defineConfig(({ mode }) => ({
  // The isolated native test script sets these process-only paths on D:.
  cacheDir: process.env.SAVE_ASSET_VITE_CACHE_DIR,
  // Native bundles must not inherit public/data or web service workers.
  publicDir: mode === "android" || mode === 'windows-portable' || [PRIVATE_VISUAL_MODE, PRIVATE_COLOR_MODE, PRIVATE_LAYOUT_MODE, PRIVATE_ROLE_MODE, PRIVATE_LIGHT_MODE].some(value => value === mode) ? false : "public",
  build: { outDir: mode === PRIVATE_LIGHT_MODE ? '.local/mobile-visual-20261011/web-light-all' : mode === PRIVATE_ROLE_MODE ? '.local/mobile-visual-20261011/web-role-light' : mode === PRIVATE_LAYOUT_MODE ? '.local/mobile-visual-20261011/web-color-frames-revision' : mode === PRIVATE_COLOR_MODE ? '.local/mobile-visual-20261011/web-color' : mode === PRIVATE_VISUAL_MODE ? '.local/mobile-visual-20261011/web' : mode === "android" ? "dist-android" : "dist" },
  plugins: [react(), appBitmapTypographyPlugin(mode, fileURLToPath(new URL('.', import.meta.url))), bundledBitmapFontPlugin(mode, fileURLToPath(new URL('.', import.meta.url))), privateVisualAssetsPlugin(mode, fileURLToPath(new URL('.', import.meta.url))), windowsPortableAssetsPlugin(mode, fileURLToPath(new URL('.', import.meta.url)))],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:13252",
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            // Only a same-origin loopback development page may inherit the
            // agent's loopback origin. Do not launder foreign Host/Origin values.
            const host = incoming.headers.host ?? '';
            const origin = incoming.headers.origin;
            if (/^(localhost|127\.0\.0\.1):[0-9]{1,5}$/.test(host)
              && (origin === undefined || origin === `http://${host}`)) {
              outgoing.setHeader('Host', '127.0.0.1:13252');
              if (origin !== undefined) outgoing.setHeader('Origin', 'http://127.0.0.1:13252');
            }
          });
        },
      },
    },
  },
  test: {
    attachmentsDir: process.env.SAVE_ASSET_VITEST_ATTACHMENTS_DIR,
    coverage: { enabled: false, ...(process.env.SAVE_ASSET_VITEST_COVERAGE_DIR
      ? { reportsDirectory: process.env.SAVE_ASSET_VITEST_COVERAGE_DIR } : {}) },
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
}));
