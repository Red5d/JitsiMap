# JitsiMap QA & Sign-off Checklist (SPEC §16)

QA/integration pass run 2026-10-29 on `main` (node 22, Linux). Sign-off gate:
**every §16.3 item MUST be checked on current Chrome AND Firefox** (§16.3
header), the automated gates below MUST be re-run green at sign-off time, and
the CSP gate (§CSP below) MUST pass. Items this pass verified automatically are
prefilled **[x]** with their evidence; everything that needs a real browser +
real Jitsi stack is an open **[ ]** with exact repro steps.

Commands (repo root):

```bash
npx tsc --noEmit && npx vitest run && npm run build
npm run dev            # app on http://localhost:5173 (config.json from public/)
npm run preview        # built app on http://localhost:4173
```

---

## 1. Automated gates — results of this pass (all PASS)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | PASS — 0 errors |
| Unit + integration | `npx vitest run` | PASS — **229 / 229** across 11 files |
| Production build | `npm run build` | PASS — see bundle note below |
| Map validation | `npm run validate:maps` | PASS — `public/maps/office.tmj: OK`; broken copies rejected (see §16.3 item 12) |
| Preview probes | `npm run preview` + curl | PASS — see probe table below |
| §11 seam scan | `test/integration.test.ts` | PASS |
| §14 privacy/HTML scans | `test/integration.test.ts` | PASS |
| meet.jit.si scan | `grep -rn meet.jit.si src/ config.template.json README.md index.html docs/` | PASS — 0 hits |

`vitest run` per-file counts:

| File | Tests | File | Tests |
| --- | --- | --- | --- |
| protocol.test.ts | 13 | messaging.test.ts | 22 |
| distance.test.ts | 10 | plan.test.ts | 23 |
| interpolation.test.ts | 14 | audioEngine.test.ts | 26 |
| loader.test.ts | 23 | map.test.ts | 39 |
| lib-surface.test.ts | 5 | ui.test.ts | 30 |
| integration.test.ts | 24 | **total** | **229** |

Console warnings inside the run are expected (fake-lib
`setReceiverConstraints` warning, validator CLI output from loader tests) —
they are not failures.

Build (lazy chunks are intentional per §11 — lib-jitsi-meet and Phaser are
dynamic-imported, keeping the initial graph small):

```
dist/assets/index-DusLCDrF.js    193.24 kB │ gzip:  62.73 kB   (initial)
dist/assets/api-C4ukKUp8.js    1,174.36 kB │ gzip: 304.40 kB   (lazy: lib-jitsi-meet)
dist/assets/scene-D0guYWIQ.js  1,495.76 kB │ gzip: 343.34 kB   (lazy: Phaser)
```

The chunk-size warning is about the two lazy chunks and is **accepted**.

Preview probes (`vite preview`, port 4173):

| Probe | Result |
| --- | --- |
| `GET /` | 200, app HTML |
| `GET /s/qa-check` | 200, SPA fallback → Lobby |
| `GET /maps/office.tmj` | 200, 50 270 bytes |
| `GET /maps/previews/office.png`, tileset PNGs, JS/CSS chunks | 200 |
| `GET /config.json` (file absent from `public/`) | 200 **text/html** — vite preview SPA fallback; see Known issue 2 |

§11 seam (integration.test.ts, source scans):

- `lib-jitsi-meet` imported **only** under `src/jitsi/`; the only value import
  is `src/jitsi/client.ts` (`constraints.ts`/`tracks.ts` are `import type`,
  erased at compile time).
- No `src/ui|game|spatial` module references `lib-jitsi-meet` at all.
- `src/ui`, `src/game`, `src/spatial`, `App`, `Lobby`, `Room`, panels all
  import under plain node (no `window` at module scope) — the browser-only
  scene/lib code enters via dynamic `import()` only.

§14 scans (integration.test.ts):

- No `dangerouslySetInnerHTML` / `innerHTML` anywhere in `src/` — chat, names,
  notices render as text nodes.
- `localStorage` used only in `src/store.ts`, single key `jitsimap.v1`,
  persisting display name + settings only.
- Remote avatar URLs load only via `startsWith('https://')`
  (`src/game/avatars.ts`); `index.html` ships
  `<meta name="referrer" content="no-referrer" />`.

---

## 2. §16.3 Manual QA checklist — MVP sign-off (verbatim)

> ### 16.3 Manual QA checklist (MUST for MVP sign-off; Chrome + Firefox minimum)

Setup for all items: a Jitsi Meet stack (docker-compose per README) with
`JITSI_DOMAIN` in `public/config.json`, `npm run preview` (or the nginx
deploy) on HTTPS. Two machines = two browsers; the same machine with Chrome +
Firefox is acceptable for pair tests.

- [ ] Join same space from two machines: avatars, names, emojis correct both ways.
  - A: `/s/qa-1` → name “Ada”, 🧙 → Join. B: same space → “Grace”, 🐱 → Join.
  - Each sees the other’s name + emoji avatar within ~2 s; People panel matches.
  - Automated coverage: protocol.test (13), messaging.test (22).
- [ ] Walk together/apart: volume follows §8.2; pan follows left/right.
  - Full gain ≤ 2 tiles, silence ≥ 8 tiles, smooth between; walking right of
    the peer pans right (clamped ±0.8). Settings tier “Gain-only” kills pan only.
  - Coverage: distance.test (10), audioEngine.test (26).
- [ ] Adjacent across a breakout-room wall: other zone silent; same-zone conversation normal.
  - Stand at the hall side of the breakout-1 wall (office map): hall pair hears
    each other; the peer just inside breakout-1 is silent.
  - Coverage: plan.test (23), integration.test.ts (real office geometry).
- [ ] Stage: speaker on stage heard in hall; hall not heard on stage.
  - One peer on Stage, one in Hall: hall hears stage; stage does not hear hall
    (`stage.audibleFrom = [hall]`, one-way).
  - Coverage: distance.test audibleFrom, integration.test.ts.
- [ ] Silent zone: occupant inaudible; label shown.
  - Peer in “Silent nook”: nobody hears them; their zone chip + canvas
    aria-label show the label.
  - Coverage: plan.test, integration.test.ts; label = §5.2 zone chip.
- [ ] Video bubble appears inside video radius, disappears beyond; camera-off shows emoji.
  - Video radius = 6 tiles. Bubble detaches (stream released) beyond it;
    cam-off peers show the emoji avatar + speaking ring, never a black box.
  - Coverage: plan.test, ui.test (visibleBubbleSet), integration.test.ts.
- [ ] Screen share: stage panel for same-zone peer; notice for others.
  - Share from Hall peer while listener in Hall → stage panel opens; share
    from breakout-2 → People tab shows “X is sharing in Breakout 2”, panel
    never opens; second share queues behind the first.
  - Coverage: integration.test.ts (§9.3 chain), ui.test (selectStageShare).
- [ ] Late joiner sees correct positions/avatars within ~2 s.
  - B joins while A moves; B renders A at the live position/emoji.
  - Coverage: messaging.test (init-sync), protocol.test.
- [ ] Idle 60 s: heartbeat keeps avatars present. Close one tab: avatar disappears promptly.
  - Both idle 60 s → both remain; close B’s tab → A drops B’s avatar (+bubble)
    in a few seconds.
  - Coverage: messaging.test (heartbeat/expiry).
- [ ] Stock Jitsi Meet web client joins the same room name: call works, §7.7 handling, no chat spam.
  - `https://<stack>/#conference=qa-1` (stock client) joins the space: audio
    1:1 works; the stock user shows in People as **“in Meet, not on map”**,
    no avatar; no `jmap:` chat messages appear (custom bridge-message channel,
    §7.6).
  - Coverage: messaging.test (§7.7), lib-surface.test (5).
- [ ] Network drop 10 s (devtools offline): §6.2 reconnect behaviour.
  - DevTools → Network → Offline 10 s → back online: “Reconnecting…” banner,
    auto-rejoin, store/plan state recovers; if the room is JWT-guest the
    waiting-host message (§6.6) shows instead of a silent spinner.
  - Coverage: client-side reconnect is browser-only (src/jitsi/client.ts);
    integration.test.ts pins the in-room banners.
- [x] Map tooling: `validate:maps` passes the starter map and fails a deliberately broken copy; preview PNG matches the map.
  - `npm run validate:maps` → `public/maps/office.tmj: OK`. Rejected in tests:
    missing/NaN tilesize, missing/0 width/height, removed layers, no spawns
    (all produce `error:` lines; exit code non-zero — loader.test covers the
    runtime twin, 23 tests). `public/maps/previews/office.png` ships next to
    the map. **Caveat:** zone-object geometry/props are NOT validated — see
    Known issue 1.
- [x] meet.jit.si appears in no default or production example.
  - `grep -rln meet.jit.si src/ config.template.json README.md index.html docs/`
    → 0 matches. (Only the vendored lib bundle contains the string internally,
    and SPEC lists the prohibition itself.)

---

## 3. CSP release gate (§13, verbatim note)

> Serve a restrictive CSP from the app nginx (`default-src 'self'`, with the
> `connect-src`/`media-src`/`worker-src` allowances the Jitsi domain + WebRTC
> require). **A CSP that blocks WSS is a release blocker**; the exact header is
> part of §16 testing.

Status: the CSP header ships with the nginx deploy
(`deploy/nginx.conf`, Docker-agent deliverable — not in this repo at QA time,
so the gate below is OPEN).

- [ ] Deploy with the CSP header enabled; join a space in Chrome + Firefox.
- [ ] DevTools Console: **zero** `Refused to connect`/CSP violation entries.
- [ ] DevTools Network: the XMPP websocket (`wss://<domain>:5284/xmpp-websocket`)
      and the colibri websocket (`wss://<domain>:4443/xmpp-websocket`) show
      `101 Switching Protocols`.
- [ ] `connect-src` covers the configured `JITSI_DOMAIN` (+ STUN/TURN hosts
      served by config.json); `media-src` allows `mediastream:`;
      `worker-src 'self' blob:` (Phaser audio workers).

Any violation that blocks signalling, ICE, or media = **release blocker**.

---

## 4. Gaps found + fixed during this QA pass

1. `index.html` had no referrer policy → added
   `<meta name="referrer" content="no-referrer" />` (§14: remote avatar loads
   must not leak the space name) + a `description` meta.
2. Chat list had no screen-reader announcements → added `role="log"
   aria-live="polite"` (§5.5).
3. `test/integration.test.ts` added (24 tests): node-safe app-shell graph,
   §11/§14 seam scans, the wiring table (rAF sendPose/audio-diff/plans, join
   order, teardown/retry order, banner→resume, aria-labels), store↔planner
   chain over the real `office.tmj`.
4. Everything else probed (Room rAF loop, AudioBanner, bubbles cap/detach,
   §9.3 queue, join step order, stripJwt placement, teardown, §8.5
   deafen/master-volume, focus-visible CSS, localStorage scoping) was already
   correctly wired and is pinned by the new tests.

## 5. Known issues / notes

1. **Resolved:** `validate:maps` now rejects non-numeric zone geometry
   (`scripts/maplib.mjs` → “non-numeric geometry”, pinned by map.test), so the
   validator and the runtime loader share the same verdict (§10.5).
2. **Dev-only:** `vite preview` serves `/config.json` as 200 text/html (SPA
   fallback) when the file is absent — the app handles it (Lobby warning with
   the `JITSI_DOMAIN` hint, never a crash). The delivered nginx template serves
   a real rendered file with security headers and no fallback for that path.
3. `npm run lint` is `biome check .`; the per-directory rule policy lives in
   `biome.json` (custom ARIA-role controls, fixture `any`, lib-interop `any`).
4. Remaining open scope: the §16.3 manual two-browser matrix (needs a live
   Jitsi stack) and the Playwright e2e smoke (see README).

---

## 6. Sign-off

- [ ] §1 automated gates re-run green at sign-off time (paste commit SHA):
      `______`
- [ ] All 13 §16.3 items checked on **current Chrome** (tester/date): `______`
- [ ] All 13 §16.3 items checked on **current Firefox** (tester/date): `______`
- [ ] §3 CSP gate passed (tester/date): `______`
- [ ] MVP approved (name/date): `______`
