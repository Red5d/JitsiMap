/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
      // lib-jitsi-meet's ESM build imports Node's "events"; node's resolver
      // prefers the builtin (unusable in browsers), so alias to the explicit
      // npm polyfill file (dependency: events@3.3.0, MIT). Without this the
      // production bundle externalizes it and rollup-on-alpine hard-fails.
      events: fileURLToPath(new URL('./node_modules/events/events.js', import.meta.url)),
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
