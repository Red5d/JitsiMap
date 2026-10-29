/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @jitsi/js-utils@12 (lib-jitsi-meet's pin) exposes subpaths through a
      // "./*" wildcard exports map, and its ESM dist uses extensionless
      // relative imports — Rollup fails to resolve the "@jitsi/js-utils/
      // browser-detection" subpath that @jitsi/rtcstats imports. Alias the
      // subpath to the concrete file; Vite resolves the extensionless imports.
      '@jitsi/js-utils/browser-detection': fileURLToPath(
        new URL('./node_modules/@jitsi/js-utils/dist/browser-detection/index.js', import.meta.url),
      ),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
