// Verifies: WASD types into the chat input while focused; avatar stays put;
// keyboard movement still works once the input is blurred.
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:8086';
const SPACE = process.env.SPACE ?? `kbd${Date.now()}`;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));

await page.goto(`${BASE}/s/${SPACE}?debugGame`);
await page
  .getByRole('textbox', { name: /name|display/i })
  .first()
  .fill('Kb');
await page.getByRole('button', { name: /^Join/i }).first().click();
await page.waitForTimeout(7000);

const pos = () =>
  page.evaluate(() => {
    const g = window.__jitmapGame;
    const s = g?.scene?.getScene?.('jitmap');
    return { x: Math.round(s?.controller?.x ?? -1), y: Math.round(s?.controller?.y ?? -1) };
  });

const before = await pos();

// Type WASD into the chat input (panel is open by default; only toggle if hidden).
const input = page.getByPlaceholder(/message/i);
if (!(await input.isVisible().catch(() => false))) {
  await page.getByRole('button', { name: /Chat/ }).first().click();
  await page.waitForTimeout(700);
}
await input.click();
await input.pressSequentially('wasd', { delay: 60 });
await page.waitForTimeout(600);
const typed = await input.inputValue();
console.log('typed in chat input:', JSON.stringify(typed), typed === 'wasd' ? 'OK' : 'FAIL');

const after = await pos();
console.log(
  'avatar while typing:',
  before,
  '→',
  after,
  before.x === after.x && before.y === after.y ? 'OK (no move)' : 'FAIL (moved)',
);

// Blur (click the map edge), then hold W — avatar must move again.
await page.locator('canvas').click({ position: { x: 640, y: 100 } });
await page.waitForTimeout(1200);
const p0 = await pos();
await page.keyboard.down('w');
await page.waitForTimeout(700);
await page.keyboard.up('w');
const p1 = await pos();
const moved = Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y);
console.log('keyboard walk after blur:', p0, '→', p1, moved > 8 ? 'OK (moved)' : 'FAIL (stuck)');

await browser.close();
