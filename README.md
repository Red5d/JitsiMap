# JitsiMap

**Walk-up spatial audio meetings on a 2D RPG-style map, powered by self-hosted Jitsi.**

JitsiMap is a web app: people join a named space from a URL, appear as avatars
on a tile map, walk between rooms with WASD/arrows/click, and hear each other
by distance and zone — close is loud and clear, far is quiet, another room is
silent. Conversation groups form and dissolve by walking; there are no "join
breakout room" buttons. Video bubbles appear for nearby participants, screen
shares open on a stage panel, and chat rides the same Jitsi conference.

It is a custom [lib-jitsi-meet](https://github.com/jitsi/lib-jitsi-meet)
client (TypeScript + Vite + React + Phaser 3) with **no application backend**:
media, chat, and avatar state all travel through the Jitsi conference
(XMPP + WebRTC). Delivery is Docker Compose: an `app` container (static files
+ runtime config) and an optional `full` profile that also runs a pinned
[docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet) stack
(web/prosody/jicofo/jvb).

## Quickstart A — app only, pointed at an existing Jitsi deployment

You need a reachable Jitsi deployment (self-hosted docker-jitsi-meet, JaaS,
or any stack compatible with the pinned lib). Anonymous guest joins must be
allowed.

```bash
cp .env.example .env    # set JITSI_DOMAIN=meet.example.org
docker compose up -d --build
# app on http://APP_HOST:8080 → /s/<space> to join
```

The Jitsi deployment must accept requests from the app's origin (CORS) —
the simplest topology is one domain with a reverse proxy (see
[Caddyfile.example](Caddyfile.example) and §TLS below).

## Quickstart B — full mode (app + pinned Jitsi stack on one host)

Requirements: a 2 vCPU / 4 GB host is comfortable for ~20 users, a **real
domain with TLS** (getUserMedia needs a secure context), Docker Compose.

```bash
cp .env.example .env
# 1. Set PUBLIC_URL=https://meet.example.org (Jitsi) and JITSI_DOMAIN=meet.example.org (app).
# 2. Generate the stack secrets (containers refuse to start with defaults):
#    fetch https://raw.githubusercontent.com/jitsi/docker-jitsi-meet/stable-11248-2/gen-passwords.sh
#    then:  bash gen-passwords.sh .env
docker compose -f docker-compose.yml -f docker-compose.jitsi.yml --profile full up -d
```

The Jitsi services are the **vendored upstream compose** of the pinned
release `stable-11248-2` (see the header of `docker-compose.jitsi.yml`; the
env surface is that release's `env.example`, embedded in `.env.example`).
For single-machine testing you can skip the proxy and use the Jitsi web
container's own `https://localhost:8443` (self-signed) with the app on
`http://localhost:8080`; point `JITSI_DOMAIN` at `localhost:8443`
accordingly.

Pinned versions (see `docs/lib-surface.md` for hashes and the verified API
surface):

| Component | Pin |
|---|---|
| lib-jitsi-meet | `v2236.0.0+51058e35` (vendored `vendor/lib-jitsi-meet.tgz`) |
| docker-jitsi-meet | `stable-11248-2` |
| Phaser | `3.90.0` · Node `22` · nginx `1.27.5-alpine` |

Version bumps MUST pass the §16.2 smoke test (below) and
`docs/lib-surface.md` re-verification.

## Auth modes (no code change between them — runtime config)

- **anonymous** (default): open space, no account. Quickstart needs zero secrets.
- **jwt-guest**: the Jitsi stack runs `ENABLE_AUTH=1 AUTH_TYPE=jwt ENABLE_GUESTS=1`;
  unauthenticated users join **after** an authenticated user has opened the
  room (the lobby shows a distinct "waiting for a host" state).
- **jwt-token**: the app passes `?jwt=<token>` (param name configurable) to
  the connection; the token is stripped from the address bar after connecting.

JWT minting is the operator's concern: standard Jitsi JWTs with
`aud`/`iss` = `JWT_APP_ID`, `sub` = the Jitsi domain, `room` = the space name
(`*` for all rooms), `context.user.{name,avatar}`. The JWT secret lives
**only** in the Jitsi stack's env — never in the app container or client.

**meet.jit.si** is supported for throwaway prototypes only (set
`JITSI_DOMAIN=meet.jit.si`); do **not** use it in production. It appears in
no default configuration.

## Security & privacy facts

- No backend, no server-side storage. `localStorage` holds only your display
  name + settings.
- **Spaces are public to link-holders** unless JWT is enabled on the stack.
- Endpoint messages (poses/emotes) are validated & clamped before display;
  names and chat render as plain text, never HTML.
- The app ships a restrictive CSP with the minimum allowances the Jitsi
  domain + WebRTC need (WSS allowed — CSP blocking WSS is a release blocker).
- Client-side pose/emote rate limits are politeness, not security controls.

## Maps

Maps are Tiled JSON (`.tmj`) files in `public/maps/` — **data, not code**:
adding a map never requires a code change. The bundled starter map is
`office` (hall + 3 breakout rooms + stage + silent nook). Spaces use
`DEFAULT_MAP`; `?map=<map-id>` overrides per URL.

Four ways to author (all share one validator):

1. **Human guide**: [docs/map-guide.md](docs/map-guide.md) — Tiled, step by step.
2. **Agent Skill**: `skills/jitsimap-map-maker/` — a portable Agent Skill any
   coding agent can load to build maps from a description.
3. **Templates**: `public/maps/templates/blank.tmj` (+ the starter map).
4. **Tooling**:
   - `npm run validate:maps` — schema, zones, spawns, reachability.
   - `npm run preview:map -- public/maps/office.tmj` — PNG preview without
     launching the app.

Tileset: Kenney "Tiny Dungeon" (CC0) — see `public/maps/CREDITS.md`.

## TLS / reverse proxy

getUserMedia needs a secure context. Recommended topology: one domain, proxy
terminates TLS, `/` → app, Jitsi paths (`/http-bind`, `/xmpp-websocket`,
`/config.js`, `/libs/`, room paths) → jitsi `web` — app and Jitsi same-origin
(see [Caddyfile.example](Caddyfile.example)).

## Development

```bash
nvm use            # Node 22
npm ci
echo '{ "jitsi": { "domain": "localhost:8443" } }' > public/config.json
npm run dev        # http://localhost:3000 (camera/mic need https; shell works on http)
```

- `npm test` — unit/integration suites (protocol, distance model, maps,
  messaging, audio engine, planners, UI logic) — the §16.1 gate, in CI.
- `npm run validate:maps` / `npm run build` / `npx tsc --noEmit` — also in CI.
- Manual QA + sign-off template: [docs/qa-checklist.md](docs/qa-checklist.md).

### Smoke test for version bumps (§16.2, optional)

```bash
npm i -D @playwright/test && npx playwright install chromium
# start full mode + `npm run dev`, then:
npx playwright test
```

Two Chromium contexts (fake media) join one space: avatars appear, a scripted
move moves the peer, chat round-trips. **Any lib/Jitsi bump must pass this.**

## Operations

- App container: <128 MB, stateless, healthcheck `GET /healthz`.
- Runtime config is rendered at container start from env
  (`docker/render-config.sh (shell + awk, no node in the nginx image)`); the Jitsi domain is never baked into the build.
- Scaling envelope: 20 users/space target, 30 stretch (endpoint-message
  fan-out). Beyond that, the Phase-2 WebSocket position server (spec §4.3).

## Licensing & Phase 2

lib-jitsi-meet / jitsi-meet / docker-jitsi-meet: Apache-2.0. Phaser: MIT.
Tileset: CC0 (attribution in `public/maps/CREDITS.md`). JitsiMap: see
`LICENSE` (Apache-2.0). "Jitsi" is a trademark of its owners; referenced
factually only.

Phase 2 (designed, not built): WebSocket position server, multiple maps +
portals, photo/animated avatars, HRTF audio, touch controls, zone chat,
moderator roles — see `SPEC.md` §2.3.

*The full design specification lives in [SPEC.md](SPEC.md).*
