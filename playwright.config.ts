// @ts-nocheck — optional devDependency; see e2e/jitsimap.spec.ts header.
import { defineConfig } from '@playwright/test';

/**
 * §16.2 smoke config: Chromium with fake media devices so two contexts can
 * join one space headlessly against a local full-mode stack. This is the
 * release gate for lib-jitsi-meet / Jitsi image version bumps (§6.1).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    permissions: ['user-media'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-audio-capture',
      ],
    },
  },
});
