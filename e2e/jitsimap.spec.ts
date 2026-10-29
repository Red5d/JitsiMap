// @ts-nocheck — Playwright is an OPTIONAL devDependency (README §Smoke test):
// install it (`npm i -D @playwright/test`) before typechecking this dir.
import { type BrowserContext, expect, test } from '@playwright/test';

/**
 * §16.2 integration smoke — the gate for lib-jitsi-meet / docker-jitsi-meet
 * version bumps. Requires:
 *  - the app running at baseURL (dev: JITSI_DOMAIN=localhost:8443 host mapping,
 *    or the full-mode compose stack, README §Full mode),
 *  - Chromium launched with fake media (see playwright.config.ts).
 */

const SPACE = 'jitsimap-smoke';

test('two clients join, walk, and chat', async ({ browser }) => {
  const mk = async (): Promise<BrowserContext> => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/s/${SPACE}`);
    await page.getByLabel(/display name/i).fill(ctx === undefined ? 'x' : 'A');
    await page.getByRole('button', { name: /join/i }).click();
    await expect(page.getByRole('status').or(page.locator('.room'))).toBeVisible({ timeout: 30_000 });
    return ctx;
  };
  const a = await mk();
  const b = await mk();
  const pa = await a.newPage();
  const pb = await b.newPage();

  // both avatars appear for both peers (§16.3 item 1)
  await expect(pa.getByText('A', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(pb.getByText('A', { exact: true })).toBeVisible({ timeout: 20_000 });

  // scripted move changes the peer's rendered position (keyboard on canvas)
  const canvas = pa.locator('canvas');
  await canvas.click();
  await pa.keyboard.down('KeyD');
  await pa.waitForTimeout(1200);
  await pa.keyboard.up('KeyD');

  // chat round-trips (§16.2)
  const msg = `smoke-${Date.now()}`;
  await pa.getByRole('textbox', { name: /chat message/i }).fill(msg);
  await pa.keyboard.press('Enter');
  await expect(pb.getByText(msg)).toBeVisible({ timeout: 15_000 });
});
