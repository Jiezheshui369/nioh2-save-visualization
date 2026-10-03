import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // Native bundles must not inherit public/data or web service workers.
  publicDir: mode === "android" ? false : "public",
  build: { outDir: mode === "android" ? "dist-android" : "dist" },
  plugins: [react()],
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
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
}));
