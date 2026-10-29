// Debug reproducer: join the local stack headlessly, log console, screenshot.
// Headless two-peer probe for the running JitsiMap app (QA aid; not part of the test suite).
// Usage: BASE_URL=http://localhost:8086 SPACE=<id> node scripts/headless-probe.mjs
// Requires: npm i -D @playwright/test and a browser (uses /usr/bin/google-chrome-stable by default).
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:8086';
const SPACE = process.env.SPACE ?? 'e2e';
const OUT = process.env.OUT ?? '/tmp/opencode';

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctxOther = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const ctxSelf1 = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });

await ctxOther.addInitScript(() => {
  const W = window.WebSocket;
  window.WebSocket = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => {
        const d = String(typeof e?.data === 'string' ? e.data : '');
        if (d.includes('body') || d.includes('message')) console.log('WS-IN-A', d.slice(0, 400));
      });
    }
  };
});
await ctxSelf1.addInitScript(() => {
  const W = window.WebSocket;
  window.WebSocket = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => {
        const d = String(typeof e?.data === 'string' ? e.data : '');
        if (d.includes('body') || d.includes('message')) console.log('WS-IN-B', d.slice(0, 400));
      });
    }
  };
});
const mk = async (which) => {
  const ctx = which === 'a' ? ctxSelf1 : ctxOther;
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`));
  // Single goto; ?debugGame opts the page into window.__jitmapGame exposure.
  await page.goto(`${BASE}/s/${SPACE}?debugGame`);
  await page.waitForTimeout(1200);
  await page
    .getByRole('textbox', { name: /name|display/i })
    .first()
    .fill(which === 'a' ? 'Ada' : 'Grace');
  await page.getByRole('button', { name: /^Join/i }).first().click();
  await page.waitForTimeout(7000);
  return { page, logs };
};

const a = await mk('a');
const b = await mk('b');

// A walks: click a map tile far from spawn → A* path; wait; verify both see movement.
await a.page.locator('canvas').click({ position: { x: 300, y: 400 } });
await b.page.waitForTimeout(4000);

const statuses = [];
for (const [name, x] of [
  ['Ada', a.page],
  ['Grace', b.page],
]) {
  await x.getByRole('button', { name: /People|👥/ }).click();
  await x.waitForTimeout(500);
  const people = await x
    .locator('.jm-people, [class*=people]')
    .first()
    .innerText()
    .catch(() => 'n/a');
  statuses.push(`${name} sees: ${people.replace(/\s+/g, ' ').slice(0, 200)}`);
}

// Chat: A sends, B receives.
await a.page.getByRole('button', { name: /Chat|💬/ }).click();
await a.page.getByPlaceholder(/message/i).fill('hello from Ada');
await a.page.getByRole('button', { name: /Send/ }).click();
await b.page.waitForTimeout(2500);
await a.page.waitForTimeout(1500);
const aText = await a.page.locator('body').innerText();
console.log('A body has hello:', aText.includes('hello from Ada'));
const bText = await b.page.locator('body').innerText();
const bChat = bText.includes('hello from Ada') ? 'RECEIVED hello' : 'NO HELLO in body';

await a.page.screenshot({ path: `${OUT}/peerA.png` });
await b.page.screenshot({ path: `${OUT}/peerB.png` });

console.log(statuses.join('\n'));
console.log('B chat:', bChat.replace(/\s+/g, ' ').slice(0, 220));
const interesting = (l) =>
  /PAGEERROR|dropped|sendPose|hello|bridge/i.test(l) && !/ReadPixels|extdisco|Analytics/i.test(l);
console.log(
  '--- A notable:',
  a.logs
    .filter(interesting)
    .slice(-6)
    .map((l) => l.slice(0, 140)),
);
await b.page.waitForTimeout(1500);
await b.page.getByRole('button', { name: /Chat|💬/ }).click();
await b.page.waitForTimeout(700);
const bList = await b.page
  .locator('.jm-chat__list, ul[role=log]')
  .first()
  .innerText()
  .catch((e) => `ERR ${e.message.slice(0, 80)}`);
console.log('B chat list:', bList.replace(/\s+/g, ' ').slice(0, 300));
console.log(
  'A debug lines:',
  a.logs.filter((l) => /jitsimap-debug/.test(l)).map((l) => l.slice(0, 110)),
);
console.log(
  'B debug lines:',
  b.logs.filter((l) => /jitsimap-debug/.test(l)).map((l) => l.slice(0, 110)),
);
console.log(
  '--- B all last 25:',
  b.logs.slice(-25).map((l) => l.slice(0, 110)),
);
await browser.close();
