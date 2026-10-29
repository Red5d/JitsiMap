# JitsiMap — Design Specification

**Status:** Ready for implementation · **Date:** 2026-10-28
**Audience:** The coding agent / developer implementing this project.

> - **MUST / MUST NOT** = required for MVP. **SHOULD** = do it unless you note why not in the PR. **MAY** = Phase 2.
> - §19 lists open questions, each with a default already chosen. Implement the default; never block on them.
> - **Milestone 0 is a gate** (§17): verify every lib-jitsi-meet signature in the pinned release's source before writing product code against it.
> - This spec states decisions and requirements only. Background research is kept outside this document.

---

## 1. Product summary

Web app: users join a named space from a URL, appear as avatars on a 2D RPG-style tile map, walk between rooms, and hear/see each other by distance and zone — close is loud and clear, far is quiet, another room is silent. Conversation groups form and dissolve by walking; there are no "join breakout room" actions.

Stack in one line: custom **lib-jitsi-meet** client (TypeScript + Vite + React + Phaser 3) against a **self-hosted docker-jitsi-meet** stack, **no application backend** — media, chat, and avatar state all travel through the Jitsi conference. Shipped as Docker Compose: an `app` service, plus a `full` profile that also runs the Jitsi stack.

---

## 2. Scope

### 2.1 MVP (all MUST)

- [ ] Join flow: space name from URL (`/s/<space>`), display name + emoji avatar picker, no-account guest join; JWT join by config (§6.6).
- [ ] One bundled map (§10.4): spawn area, open hall, ≥3 enclosed breakout rooms as separate zones, 1 stage zone, ≥1 silent zone.
- [ ] Movement: WASD + arrow keys, click-to-move, tile collision, camera follow + zoom.
- [ ] Remote avatars on the map, interpolated, with display name, emoji/photo avatar, speaking/muted indicators.
- [ ] Position/state sync over conference endpoint messages (§7).
- [ ] Spatial audio (§8): distance gain, stereo pan, zone blocking, master volume, mute/deafen, per-participant volume.
- [ ] Video (§9): live video bubbles for nearby participants via receiver constraints; screen-share viewing in a stage panel.
- [ ] Text chat sidebar using the conference's MUC messages.
- [ ] Controls: mute mic, toggle camera, share screen, settings (mic/cam/speaker selection, spatial-audio tier), people list, copy invite link, leave.
- [ ] Map authoring support (§10.5): Tiled workflow, `docs/map-guide.md`, agent Skill at `skills/jitsimap-map-maker/`, map templates, validator + preview renderer.
- [ ] Docker Compose delivery (§12) and `.env.example` covering §13.
- [ ] Tests/QA per §16, including the two-client manual checklist.

### 2.2 Non-goals (MVP)

No accounts or database; no persistence of spaces/positions/chat; no recording, streaming, SIP, or native apps; no in-app map editor UI; no dedicated position/WebSocket server; no production use against meet.jit.si (throwaway prototypes only). Desktop browsers first: current Chrome/Edge and Firefox MUST work, Safari SHOULD work; touch/mobile is Phase 2 beyond basic join + listen.

### 2.3 Phase 2 (design for, do not build)

Dedicated WebSocket position server (§4.3); multiple maps + portal zones; custom-image avatars and animated sprites; HRTF spatialisation tier; touch controls; zone-scoped chat; moderator roles and locked spaces.

---

## 3. Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Jitsi integration | lib-jitsi-meet custom client |
| D2 | Jitsi backend | Self-hosted docker-jitsi-meet; config must also allow pointing at an existing deployment / JaaS |
| D3 | Position transport (MVP) | Conference endpoint messages (§7) |
| D4 | Map format | Tiled JSON (`.tmj`), 32×32 orthogonal, embedded tilesets |
| D5 | Rendering | Phaser 3 for map/avatars/camera/input; DOM for video bubbles + HUD |
| D6 | Client stack | TypeScript + Vite + React (HUD/lobby/settings/chat), Phaser embedded in a React component |
| D7 | lib-jitsi-meet consumption | Pinned GitHub-release `.tgz`, exact `vNNNN.0.0+<sha>` in `package.json`; local `.d.ts` shim for the used surface. Never a floating version, never third-party npm wrappers |
| D8 | Spatial audio | Web Audio per-participant gain + stereo pan (§8), plus bridge-side audio subscriptions |
| D9 | Video scaling | `setReceiverConstraints` (selected/on-stage sources, per-source `maxHeight`, `lastN`), updated debounced on pose/zone change |
| D10 | Auth | Anonymous/guest on own stack by default; JWT when configured (§6.6) |
| D11 | Serving | Static build via nginx in the app container; runtime config injected at container start (§12.3); same origin as Jitsi where deployed together |
| D12 | Map authoring | Tiled is the canonical editor; `.tmj` is plain JSON so agents edit it as text via the bundled Skill (§10.5); the validator is the shared source of truth for humans and agents |

---

## 4. Architecture

### 4.1 Diagram

```text
Browser
  React HUD (lobby, controls, chat, settings, people list)
       ▲ typed state/event bridge
  Phaser scene (Tiled map, avatars, camera, movement, zones)
       ▲ poses (local + remote, interpolated)
  Spatial engine (pose store -> distance/zone model)
       ▲                    ▲
  Web Audio graph      Receiver-constraint planner
  (per-participant     (selected / on-stage sources)
   gain + pan)               │
       └──── Jitsi client adapter (ONLY module importing
             lib-jitsi-meet) ───────────────┐
                                            │ XMPP (WSS) + WebRTC
                                            │ + bridge channel (endpoint msgs)
                             docker-jitsi-meet: web / prosody / jicofo / jvb
App static files + runtime config: served by the `app` container (nginx).
```

### 4.2 Module boundaries (MUST)

```text
src/
  jitsi/        # adapter over lib-jitsi-meet; no other module imports the lib
    client.ts         # connection + conference lifecycle (§6.2)
    tracks.ts         # local/remote track management
    messaging.ts      # endpoint-message encode/decode (§7), validation
    constraints.ts    # receiver constraints + audio subscriptions (§8/§9)
    types.d.ts        # local type shim for the lib surface used
  game/         # Phaser
    scene.ts          # map scene: tilemap, layers, camera
    avatars.ts        # local + remote avatar sprites, name labels
    movement.ts       # keyboard + click-to-move, collision
    maps.ts           # Tiled JSON loader, zone/spawn extraction (§10)
  spatial/
    poseStore.ts      # participantId -> {pose, zone, avatar, lastSeen}
    audioEngine.ts    # Web Audio graph (§8)
    distance.ts       # pure distance/zone -> gain/pan functions
  ui/           # React: lobby, HUD, chat, settings, people list, stage panel
  config.ts     # runtime config (§13) loading + validation
  protocol.ts   # shared message types + codec (single source of truth, §7)
public/
  maps/         # *.tmj + tileset images + templates/ (§10)
  config.template.json
docs/
  map-guide.md        # §10.5 (source file: MAP-GUIDE.md in the handoff)
skills/
  jitsimap-map-maker/ # §10.5 agent Skill (shipped in this handoff)
scripts/
  validate-maps.mjs   # §10.5
  render-map-preview.mjs  # §10.5
```

Rules:
- Only `src/jitsi/` imports lib-jitsi-meet; everything else consumes its typed events. This seam is what makes lib upgrades survivable.
- `distance.ts` and `protocol.ts` are pure and unit-tested without a browser or conference.
- Phaser and React communicate only through a small typed store/event bus. No reaching into Phaser objects from React.

### 4.3 Scaling envelope

Endpoint messages broadcast through the JVB to every participant; no server-side zone filtering; reliability/ordering/limits are undocumented, so §7 is designed as best-effort. MVP target: **20 concurrent users per space, 30 stretch**. Phase-2 trigger for the WebSocket position server: sustained rooms >30–50 active movers, measured bridge-channel message loss, or a need for persistent state. The §7 protocol is versioned JSON envelopes so it can move to a WebSocket unchanged.

---

## 5. User experience

### 5.1 Join flow

1. `/` → enter a space name, or follow `/s/<space>` directly to its lobby.
2. Lobby: space + map name, display-name input (prefilled from `localStorage`), emoji picker (default: random from a curated set), mic/camera initial state, Join button. Join MUST be an explicit click; it is also the gesture that unlocks the Web Audio context (§8.6).
3. On join: connect (§6.2), spawn at a spawn point (§10.2), camera centred on own avatar.
4. Failure states are explicit and recoverable, never an endless spinner: connection failed; conference failed (including "waiting for a host to open the room" under JWT+guests, §6.6); mic/cam denied (joining muted/camera-off is allowed); map failed to load. Each shows a human message + Retry.
5. Leave: disconnect, stop local tracks, return to lobby. Closing the tab MUST clean up on peers via `USER_LEFT` (§7.5).

### 5.2 Main view

```text
┌──────────────────────────────────────────────┬─────────────┐
│  Phaser canvas (map, avatars, zone labels)   │  Chat /     │
│  + DOM video bubbles positioned over avatars │  People tab │
│  + stage panel (screen share, §9.3)          │  (toggle)   │
├──────────────────────────────────────────────┴─────────────┤
│  Bottom bar: mute · camera · share · emote · settings ·    │
│  master volume · deafen · leave          [zone name label] │
└────────────────────────────────────────────────────────────┘
```

The local user's bubble shows their own camera preview when on. Zone name displays on entering a zone. No minimap in MVP.

### 5.3 Movement and interaction

- **WASD / arrows:** continuous 8-direction movement, ~4 tiles/sec, collision stops/slides along walls.
- **Click-to-move:** click a walkable tile → walk there; A* on the collision grid SHOULD be used (straight line + stop-on-wall is the minimum). Clicking another avatar SHOULD move you adjacent to them.
- **Zoom:** wheel/pinch, clamped 0.5×–2.5×; camera follows local avatar, clamped to map bounds.
- **Emotes:** click own avatar or press `E` → emoji burst above avatar, broadcast as `emote` (§7.2), expires ~2 s, send rate-limited to ≤2/s.
- Proximity is automatic. There are no call/join-room buttons.

### 5.4 People, chat, settings

- **People tab:** everyone in the conference, including pose-less stock-Meet participants marked "in Meet, not on map" (§7.7); distance/zone if known; per-participant volume slider; a local mute-other button labelled as client-side only.
- **Chat:** conference text messages, name + timestamp, plain text only (render as text, never HTML, §14). Room-wide regardless of zone; label it in the UI: "Chat is heard everywhere."
- **Settings:** mic/camera/speaker pickers (from `mediaDevices` enumeration); spatial-audio tier (Auto / Full pan+gain / Gain-only / Off); connection info readout (conference id, participant id, lib version).

### 5.5 Accessibility (MUST, lightweight)

All controls keyboard-focusable with visible focus; canvas container has an `aria-label` naming the current zone and nearby participant count; mute state never conveyed by colour alone.

---

## 6. Jitsi integration

### 6.1 Pinning and the Milestone-0 gate

- Pin exact versions: docker-jitsi-meet images and the lib-jitsi-meet `.tgz`. Starting points from research (Oct 2026): docker-jitsi-meet **stable-11248-1**, lib-jitsi-meet **v2236.0.0+51058e35**. Re-check latest stable at implementation time, then pin what you verified.
- In the pinned lib source, verify and record in `docs/lib-surface.md`: `JitsiMeetJS.init`; `JitsiConnection` constructor + events; `initJitsiConference`; `createLocalTracks` options; track `attach/detach/getParticipantId/getSourceName/getOriginalStream`; conference `sendEndpointMessage/broadcastEndpointMessage` + `ENDPOINT_MESSAGE_RECEIVED`; `setReceiverConstraints`; `setAudioSubscriptionMode` (source-name list semantics); `sendTextMessage`; `setDisplayName`; screenshare via `devices:['desktop']` / `TRACK_VIDEOTYPE_CHANGED`.
- Write `src/jitsi/types.d.ts` for exactly that verified surface. If a signature differs from this spec, adapt the shim and note it in `docs/lib-surface.md`.

### 6.2 Connection lifecycle

```text
loadRuntimeConfig()                        # §13, from /config.json
  -> deployment values: hosts/bosh/websocket from runtime config
     (or parsed from <jitsi-origin>/config.js)
  -> JitsiMeetJS.init({...})
  -> new JitsiConnection(appID|null, jwt|null,
       {hosts:{domain, muc, focus?}, bosh, websocket})
  -> connection.connect()
  -> CONNECTION_ESTABLISHED
       -> conference = connection.initJitsiConference(spaceName, confOptions)
       -> register conference handlers (§6.3) BEFORE join
       -> createLocalTracks({devices:['audio','video'], ...}) -> addTrack
       -> conference.setDisplayName(name); conference.join()
  -> CONFERENCE_JOINED -> start pose loop (§7), audio engine (§8),
     constraint planner (§9)
```

- Conference name = space name normalised: lowercase, `[a-z0-9-_]` only, others → `-`. Same normalisation for URL and MUC room.
- Reconnect: on `CONNECTION_DISCONNECTED` / `CONFERENCE_FAILED`, show §5.1 failure UI with Retry; automatic backoff retry (2 s, 5 s, 10 s, then manual) MAY be attempted for network drops only. Any rejoin is a fresh join for state sync (§7.4).

### 6.3 Conference events (minimum)

`CONFERENCE_JOINED`, `CONFERENCE_LEFT`, `CONFERENCE_FAILED`, `USER_JOINED`, `USER_LEFT`, `TRACK_ADDED`, `TRACK_REMOVED`, `TRACK_MUTE_CHANGED`, `TRACK_AUDIO_LEVEL_CHANGED` (speaking indicator; throttle UI updates), `DISPLAY_NAME_CHANGED`, `MESSAGE_RECEIVED` (chat), `ENDPOINT_MESSAGE_RECEIVED` (§7), `DATA_CHANNEL_OPENED` (diagnostic).

### 6.4 Local tracks

- Create audio+video on join per lobby choices and selected device ids.
- Mute toggles use track `mute()/unmute()`; never destroy/recreate for mute.
- Camera switch: create new video track + `replaceTrack`. Screenshare: create `desktop` track + `replaceTrack` the camera, restore on end; the browser's native "Stop sharing" counts as share-off.
- Local audio MUST NOT enter the spatial graph. A mic level meter MAY tap it at gain 0.

### 6.5 Remote tracks

- Audio track → audio engine (§8). Do NOT attach it to an audible element (§8.6).
- Video track → that participant's DOM bubble (§9); detach on track removal.
- Desktop track → stage panel (§9.3).

### 6.6 Authentication modes (runtime config, §13; no code change between modes)

1. **Anonymous (default):** no auth on the Jitsi stack; token = `null`.
2. **JWT:** stack with `ENABLE_AUTH=1`, `AUTH_TYPE=jwt`, `ENABLE_GUESTS=1` (§12.5).
   - *Guest join (default):* no token passed; guests join once an authenticated user has opened the room. Surface the waiting state distinctly (§5.1).
   - *Token join:* if the URL carries `?jwt=<token>` or runtime config names a token endpoint, pass it to `JitsiConnection`. Minting tokens is the operator's concern; document the expected claims in the README (`aud`/`iss` = app id, `sub` = domain, `room`, `context.user.{name,avatar}`).
3. **meet.jit.si:** MAY be configured for throwaway prototypes only; README MUST warn against production use.

---

## 7. Position and state sync protocol

### 7.1 Transport

`conference.broadcastEndpointMessage(payload)` for poses/heartbeats/emotes; `conference.sendEndpointMessage(participantId, payload)` for direct join-time tells; received via `ENDPOINT_MESSAGE_RECEIVED(endpointId, payload)`. Treat as best-effort: no ordering or delivery guarantee. Keep payloads < 500 bytes.

### 7.2 Envelope and message types

```jsonc
{ "ns": "jitsimap", "v": 1, "type": "<type>", "ts": 1730000000000 /* ... */ }
```

Ignore unknown `ns`/`v`/`type` — stock Meet clients also emit endpoint messages; never crash on foreign payloads.

| type | Direction | Fields | When |
|------|-----------|--------|------|
| `pose` | broadcast | `x`, `y` (map pixels), `dir`, `zone` (id or null), `moving` (bool) | While moving (throttled, §7.3), on stop, on zone change |
| `hello` | broadcast | `name`, `avatar` (emoji or image URL), `zone` | Immediately after `CONFERENCE_JOINED` |
| `state-request` | broadcast | — | Newcomer, 300 ms after `hello` |
| `state` | direct to requester | `name`, `avatar`, `x`, `y`, `dir`, `zone` | Reply to `state-request`, or to a `hello` from an unknown participant |
| `emote` | broadcast | `emoji` | On emote, rate-limited |
| `avatar` | broadcast | `avatar` | On avatar change mid-session |

Display name also travels via `setDisplayName`, which is authoritative on disagreement.

### 7.3 Rates, interpolation, validation

- While moving: `pose` at **8 Hz** (`POSE_SEND_INTERVAL_MS = 125`, named constant) only if moved >2 px or direction/zone changed; immediate send on stop and zone change.
- **Heartbeat:** re-broadcast `pose` + `avatar` every **20 s** while idle.
- **Receiving:** keep latest pose + receive timestamp per participant. Render toward it with ~150 ms interpolation; snap if divergence >2 tiles. **Expire** a pose after 45 s without messages (§7.7 fallback).
- **Validation (MUST, §14):** clamp `x/y` to map bounds; name ≤64 chars; avatar ≤8 chars (emoji) or ≤512 (URL); `zone` must be a known zone id or null; drop non-finite numbers and messages from self.

### 7.4 Join-time exchange

```text
Newcomer N joins
  N -> broadcast hello + pose{spawn}
  N -> (300 ms) broadcast state-request
  Each peer P, on hello/state-request from unknown N:
      P -> direct state{...P's full state...} to N
  N builds the world from state replies + ongoing poses.
```

### 7.5 Leave and rejoin

Graceful or ungraceful leave both resolve via `USER_LEFT`: remove avatar, audio chain, video bubble. Pose expiry (§7.3) covers delayed `USER_LEFT`. No goodbye message.

### 7.6 Chat

Chat uses `sendTextMessage` / `MESSAGE_RECEIVED` only. Poses never use chat; chat never uses endpoint messages.

### 7.7 Pose-less participants (stock Meet users)

A participant with no JitsiMap state 10 s after joining is pose-less: list in People as "in Meet, not on map"; no avatar; audio treated as global at gain 0.8, unpanned, if received; included in receiver constraints only for their screenshare or as dominant speaker.

---

## 8. Spatial audio

### 8.1 Graph (per remote participant, on audio TRACK_ADDED)

```text
MediaStreamSource(track.getOriginalStream())
  -> GainNode (spatial gain, §8.2)
  -> StereoPannerNode (pan, §8.3)        [omitted in Gain-only tier]
  -> GainNode (per-user volume, §8.5)
  -> GainNode (master / deafen)
  -> AudioContext.destination
```

One `AudioContext`, created/resumed on the Join click. Update gain/pan per rendered frame from the pose store, smoothed with `setTargetAtTime` (τ ≈ 0.05 s). Tear down on track removal / user left. A participant whose track is muted gets gain 0 regardless of distance.

### 8.2 Distance model (named constants, tunable)

Distances in tiles (1 tile = 32 px), avatar-centre to avatar-centre, `d`:

- `FULL_RADIUS_TILES = 2` → `d ≤ 2`: gain 1.0.
- `HEAR_RADIUS_TILES = 8` → gain falls to 0 at `d = 8`: `gain = clamp((HEAR - d) / (HEAR - FULL), 0, 1) ^ 1.5` (any smooth monotone curve meeting the endpoints is acceptable if unit-tested against them).
- `d > 8` → gain 0 and candidate for unsubscription (§8.4).

### 8.3 Pan and zones

- Pan from the speaker's horizontal offset relative to the listener, clamped to [-0.8, 0.8].
- Different non-null zones → gain 0, except: zone property `audibleFrom: [<zoneId>, …]`, set on the zone being heard, lists zones whose occupants can hear this zone's occupants, one-way. Example: `stage.audibleFrom = [hall]` → hall hears stage; stage does not hear hall (unless `hall.audibleFrom` also lists `stage`). `silent: true` zone → its occupants have gain 0 as speakers and see a "Silent zone" label.
- Same zone, or both zone-less → distance model. No within-zone wall attenuation in MVP; zones are the wall model.

### 8.4 Bridge-side audio subscriptions

Maintain the audible set (gain > 0 per §8.2/§8.3, plus pose-less per §7.7); debounced 500 ms on change, call (after §6.1 verification):

```ts
conference.setAudioSubscriptionMode({ mode: 'Include', list: [/* '<endpoint>-a0' source names */] })
```

Empty audible set → empty Include (= None). Deafen → unsubscribe all. If the API is absent in the pinned lib, fall back to local gain only and log a warning.

### 8.5 Controls

Master volume slider; **Deafen** (master gain 0 + unsubscribe all; mic unchanged); per-participant volume 0–200 % multiplying spatial gain; local mute-other per participant. Spatial tier setting: Full / Gain-only / Off (Off = flat 0.9 gain for all subscribed participants).

### 8.6 Browser quirks (verify in the §16 browser matrix)

- Resume the `AudioContext` on Join and on later pointer interaction if still suspended; show a "Click to enable audio" banner if `ctx.state !== 'running'` after join.
- Some browsers only feed a remote stream into Web Audio while it is also attached to a playing element. If proven in testing, attach the audio track to a **muted** element as well, behind a comment. An audio track MUST NOT be both audibly attached and in the graph (double audio).
- Speaker selection via the lib's audio-output API / `setSinkId` where supported (§6.1).

---

## 9. Video and receiver constraints

### 9.1 Video radius and bubbles

`VIDEO_RADIUS_TILES = 6` (< hear radius). Participants within it and in an audible zone relationship (§8.3) get a live DOM video bubble (~96×72 px, name label beneath) positioned over their avatar each frame from game coordinates. Beyond the radius or camera off: emoji/photo avatar only. Own bubble shows local preview when camera is on.

### 9.2 Constraint planner (debounced 500 ms on pose/zone/track change)

```ts
conference.setReceiverConstraints({
  lastN: 16,                                    // MAX_VIDEO_SOURCES
  selectedSources: [/* video sources of in-radius participants */],
  onStageSources:  [/* 1-4 nearest, or current screenshare source */],
  defaultConstraints: { maxHeight: 180 },
  constraints: { '<nearest sources>': { maxHeight: 360 } }
})
```

Bubbles never need 720/1080 (stage content excepted, §9.3). Map participantId → source names (`<endpoint>-v0`) from their tracks. Do not use the deprecated `setReceiverVideoConstraint`.

### 9.3 Screen share / stage

A remote `desktop` track renders in the stage panel (large, dismissible, sharer name shown); its source joins `onStageSources` at `maxHeight: 720` while open. Zone rule: viewable from the sharer's zone and zones related by `audibleFrom`; if the rule would hide it, show "X is sharing in <zone>" in People instead of swallowing it. One stage share at a time; a second share queues as a notice.

---

## 10. Maps

### 10.1 Authoring contract

- Editor: **Tiled**. Runtime format: **Tiled JSON export (`.tmj`)**; tileset images as separate files. Orthogonal, tile size **32×32**, tilesets embedded in the export where tooling allows.
- Coordinates: pixels, origin top-left — the protocol (§7) uses the same system.
- Files in `public/maps/<map-id>.tmj`; space→map mapping is the runtime-config default plus an optional `?map=<map-id>` URL parameter.

### 10.2 Layers and properties (MUST)

| Layer | Type | Meaning |
|---|---|---|
| `ground` | tile | Floor/background |
| `furniture` | tile | Decor above ground, below avatars |
| `above` | tile | Canopy/roofs above avatars |
| `spawns` | object | Spawn points (≥1), property `id` |
| `zones` | object (rectangles) | Per object: `zone` (id string, required), optional `label`, `silent` (bool), `audibleFrom` (comma-separated zone ids that can hear this zone, §8.3), `stage` (bool) |
| `exits` | object | Phase 2 (`exitTo` map id); loader MUST ignore gracefully in MVP |

- **Collision:** tile property **`collides` (bool) = true** in the tileset; loader MUST also accept the legacy spelling `Collision`. Evaluated on `ground` + `furniture`.
- Unknown tile/object properties MUST be ignored, not fatal.

### 10.3 Tileset

Ship one CC0/CC-BY top-down interior tileset (e.g. a Kenney.nl set); record the exact set + licence in `public/maps/CREDITS.md`. No ripped game sprites. MVP avatars are emoji text sprites; no character spriteset is required.

### 10.4 Bundled starter map (MUST)

One map, ~40×30 tiles: central hall (explicit zone `hall` is acceptable if it simplifies the stage rule), 3 enclosed rooms with 1–2-tile door gaps as zones `breakout-1..3`, a stage zone (`stage`, heard in `hall`), a small `silent` nook, spawn in the hall. Walls between zones are collision tiles. This map is the §16 test fixture.

### 10.5 Map authoring support (MUST ship all four)

Humans use a GUI; agents cannot. Both work on the same `.tmj` files and the same validator — that shared contract is the design.

1. **Human guide — `docs/map-guide.md`.** For a deployer with no game-dev experience: installing Tiled; opening the templates; the §10.2 rules in steps; drawing rooms/doors; adding zones, spawns, silent/stage areas; exporting `.tmj`; validating and previewing; testing in the running app; design guidance (room sizes, 2-tile doors, map ≤ ~50×40 tiles — at 4 tiles/sec a 40-tile crossing is ~10 s); asset licensing; troubleshooting. Source file in this handoff: `MAP-GUIDE.md`.
2. **Agent Skill — `skills/jitsimap-map-maker/`.** Portable Agent Skill (standard `SKILL.md` with `name`/`description` frontmatter) any coding agent used by a deployer can load. It teaches the agent to: interview for rooms/capacities/style; sketch the layout as an ASCII grid and get sign-off; **start from a template or the starter map and edit it programmatically** (never hand-write raw tile arrays, never invent tile gids — read them from the tileset); add zones/spawns as objects; run the validator and preview renderer; show the preview and iterate. `references/map-schema.md` carries the exact §10.2 schema, encoding notes (row-major layer data, `0` = empty, gid = `firstgid` + tile id), and examples. Shipped in this handoff; copy into the repo unchanged.
3. **Templates — `public/maps/templates/`:** `blank.tmj` (correct layers/properties, empty grid, starter tileset wired) and the starter map itself, so humans and agents start from a known-good file.
4. **Tooling:**
   - `scripts/validate-maps.mjs` (`npm run validate:maps`): JSON parses; required layers exist; ≥1 spawn; zone ids unique; tileset images exist; `audibleFrom` references resolve; collision sanity (spawn walkable; every zone reachable from a spawn via flood fill on the collision grid). Exit non-zero with useful messages.
   - `scripts/render-map-preview.mjs` (`npm run preview:map -- <file>`): renders tile layers + zone rectangles + spawns to a PNG without launching the app, so a map can be eyeballed before live testing.

Maps are data, not code: adding a map MUST NOT require a code change.

---

## 11. Client implementation notes

- TypeScript strict; Vite; Phaser 3 pinned to an exact minor; React 18+; npm with committed `package-lock.json`; Node version pinned via `.nvmrc` and the Dockerfile.
- One typed store (participant table, local settings, connection status) shared by React, Phaser, and the spatial engine. The store owns truth (poses, zones); Phaser owns only rendering state (sprite positions).
- Phaser's loop drives avatar rendering and supplies planner inputs; planners are debounced (§8.4/§9.2) and MUST NOT call lib-jitsi-meet per frame.
- Design envelope: ≤30 avatar sprites + ≤16 video elements. Video elements of out-of-radius participants MUST be detached (stream release itself is via constraints).
- All §13 values are fetched from `/config.json` before any Jitsi code runs, validated, with a visible error if the Jitsi domain is unset.

---

## 12. Docker and deployment

### 12.1 Deliverables (MUST)

```text
Dockerfile
docker-compose.yml        # app service + `full` profile (§12.5)
.env.example              # every variable in §13, commented
.dockerignore
README.md                 # quickstarts (app-only + full), JWT notes,
                          # map authoring (§10.5), TLS topology (§12.6)
```

### 12.2 App image

- Stage 1: `node:<pinned>-alpine` → `npm ci` → `npm run build`.
- Stage 2: `nginx:alpine` (pinned) serving `dist/` on **8080** (unprivileged); SPA fallback (`try_files … /index.html`); correct MIME for `.tmj`; long-cache for hashed assets; **no-cache** for `/config.json` and `/index.html`.
- Entrypoint renders `/config.json` from environment (§12.3), then execs nginx.
- Healthcheck: `wget -qO- http://localhost:8080/healthz` returning a static `ok`.

### 12.3 Runtime config injection

`public/config.template.json` holds `${VAR}` placeholders; the entrypoint renders the served `config.json` from the container environment (`envsubst` or a small node renderer — pick one, document it). No Jitsi domain is ever baked into the build.

### 12.4 Compose — app-only (default)

```yaml
# Illustrative shape; the agent MUST produce valid, tested YAML.
services:
  app:
    build: .
    image: jitsimap:latest
    ports:
      - "${APP_PORT:-8080}:8080"
    environment:
      JITSI_DOMAIN: "${JITSI_DOMAIN:?set to your Jitsi domain}"
      JITSI_MUC_DOMAIN: "${JITSI_MUC_DOMAIN:-conference.${JITSI_DOMAIN}}"
      JITSI_WEBSOCKET_URL: "wss://${JITSI_DOMAIN}/xmpp-websocket"
      JITSI_BOSH_URL: "https://${JITSI_DOMAIN}/http-bind"
      JITSI_AUTH_MODE: "${JITSI_AUTH_MODE:-anonymous}"  # anonymous | jwt-guest | jwt-token
      DEFAULT_MAP: "${DEFAULT_MAP:-office}"
    restart: unless-stopped
```

For an operator's existing Jitsi (or JaaS), only `JITSI_DOMAIN` and friends change. README notes the deployment must allow this origin (CORS) or be proxied same-origin (§12.6).

### 12.5 Compose — `full` profile (app + Jitsi stack)

- Jitsi services under compose profile **`full`**, using the **official docker-jitsi-meet images and service definitions** for the pinned stable (§6.1). Required core: `web`, `prosody`, `jicofo`, `jvb`. Out of scope: jigasi, jibri, etherpad.
- **Do not write these services from memory.** Vendor the upstream release's compose file (e.g. `docker-compose.jitsi.yml`, used with `-f docker-compose.yml -f docker-compose.jitsi.yml --profile full up -d`) and override only what this section lists; document that command in the README.
- Upstream env (in `.env.example` with generation instructions): `PUBLIC_URL`, `TZ`, and the internal passwords from upstream's `./gen-passwords.sh` — follow the pinned release's `env.example` exactly; containers refuse to start with defaults.
- Ports: `80/tcp`, `443/tcp`, `10000/udp` (JVB media). getUserMedia needs a secure context: full mode assumes a real domain + TLS (§12.6), or `https://localhost` for single-machine tests.
- JWT (optional, §6.6): `ENABLE_AUTH=1`, `AUTH_TYPE=jwt`, `JWT_APP_ID`, `JWT_APP_SECRET`, `ENABLE_GUESTS=1`, app `JITSI_AUTH_MODE` to match. `.env.example` defaults MUST be auth-off so the quickstart needs zero secrets.
- Volumes: upstream `${CONFIG}` layout for web/prosody/jicofo/jvb. The app is stateless.

### 12.6 TLS / reverse proxy (document, provide a Caddyfile example)

One domain, proxy terminates TLS: `/` → app container; Jitsi paths (`/http-bind`, `/xmpp-websocket`, `/libs/`, `/config.js`, room paths) → jitsi `web` service, making app + Jitsi same-origin (§6.2). Local dev may use `http://localhost` for the app shell, but camera/mic testing needs `https://localhost:8443` (upstream web default).

### 12.7 Resources

App container <128 MB. The Jitsi stack (esp. JVB) carries the real cost; a 20-user space is comfortable on 2 vCPU / 4 GB.

---

## 13. Configuration reference

App runtime config (`/config.json`, rendered from env per §12.3):

| Key | Env | Default | Notes |
|---|---|---|---|
| `jitsi.domain` | `JITSI_DOMAIN` | — (required) | e.g. `meet.example.org` |
| `jitsi.muc` | `JITSI_MUC_DOMAIN` | `conference.<domain>` | From the deployment's `config.js` |
| `jitsi.websocket` | `JITSI_WEBSOCKET_URL` | `wss://<domain>/xmpp-websocket` | Preferred XMPP transport |
| `jitsi.bosh` | `JITSI_BOSH_URL` | `https://<domain>/http-bind` | Fallback |
| `jitsi.appId` | `JITSI_APP_ID` | null | JaaS/JWT only |
| `auth.mode` | `JITSI_AUTH_MODE` | `anonymous` | `anonymous` \| `jwt-guest` \| `jwt-token` |
| `auth.tokenParam` | `JITSI_TOKEN_PARAM` | `jwt` | URL param read in jwt-token mode |
| `defaultMap` | `DEFAULT_MAP` | `office` | Map id in `public/maps/` |

Code constants (not env in MVP): `POSE_SEND_INTERVAL_MS` 125; `HEAR_RADIUS_TILES` 8; `VIDEO_RADIUS_TILES` 6.

Full-mode Jitsi env is upstream's own surface (§12.5): link the pinned release's `env.example`, do not duplicate it.

---

## 14. Security and privacy

- No backend, no server-side storage; `localStorage` holds only display name + settings. State this in the README.
- Validate/clamp all endpoint-message fields per §7.3 before they touch the pose store. Render names and chat as text, never HTML. Avatar image URLs, if used, MUST be `https:` `<img>` with `referrerpolicy="no-referrer"`; emoji is the default path.
- The JWT app secret exists only in the Jitsi stack's env — never in the app container or client. Strip `?jwt=` from the address bar (`history.replaceState`) after connecting.
- Serve a restrictive CSP from the app nginx (`default-src 'self'`, with the `connect-src`/`media-src`/`worker-src` allowances the Jitsi domain + WebRTC require). A CSP that blocks WSS is a release blocker; the exact header is part of §16 testing.
- Anyone with a space URL can join an anonymous space. README MUST say so plainly ("spaces are public to link-holders unless JWT is enabled"). Client-side pose/emote rate limits are politeness, not security controls.
- Licences: lib-jitsi-meet / jitsi-meet / docker-jitsi-meet Apache-2.0; Phaser MIT; tileset per §10.3. If any Calla code is adapted (none is required), preserve its MIT attribution. Avoid Jitsi trademarks in branding beyond factual references.

---

## 15. Performance targets

| Metric | Target |
|---|---|
| Concurrent users per space | 20 target, 30 stretch, graceful degradation beyond |
| Pose traffic | < 500 B per message, ≤8/s per moving user |
| Join-to-on-map | < 30 s on broadband |
| Audio updates | gain/pan applied within 1 frame of rendered pose |
| Video per client | ≤16 subscribed sources at ≤360 px (stage share excepted); measure and record at M5 |

---

## 16. Testing and acceptance

### 16.1 Unit tests (MUST, Vitest or equivalent)

- `distance.ts`: gain endpoints/midpoints (§8.2), zone blocking, directed `audibleFrom`, silent zones, per-user/master multiplication, pan clamping.
- `protocol.ts`: encode/decode round-trip; tolerance of foreign payloads (unknown ns/type, stock-Meet shapes); validation clamps (§7.3).
- Interpolation: lerps, snaps >2 tiles, expires at 45 s.
- Map loader + validator: starter map parses; zones/spawns extracted; one failing fixture per §10.2/§10.5 rule.

### 16.2 Automated integration (SHOULD)

Playwright, Chromium with fake media (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`): two contexts join one space against a local full-mode stack; assert both avatars appear, a scripted move changes the peer's rendered position, chat round-trips. This is the smoke test for any lib/Jitsi version bump — bumps MUST pass it.

### 16.3 Manual QA checklist (MUST for MVP sign-off; Chrome + Firefox minimum)

- [ ] Join same space from two machines: avatars, names, emojis correct both ways.
- [ ] Walk together/apart: volume follows §8.2; pan follows left/right.
- [ ] Adjacent across a breakout-room wall: other zone silent; same-zone conversation normal.
- [ ] Stage: speaker on stage heard in hall; hall not heard on stage.
- [ ] Silent zone: occupant inaudible; label shown.
- [ ] Video bubble appears inside video radius, disappears beyond; camera-off shows emoji.
- [ ] Screen share: stage panel for same-zone peer; notice for others.
- [ ] Late joiner sees correct positions/avatars within ~2 s.
- [ ] Idle 60 s: heartbeat keeps avatars present. Close one tab: avatar disappears promptly.
- [ ] Stock Jitsi Meet web client joins the same room name: call works, §7.7 handling, no chat spam.
- [ ] Network drop 10 s (devtools offline): §6.2 reconnect behaviour.
- [ ] Map tooling: `validate:maps` passes the starter map and fails a deliberately broken copy; preview PNG matches the map.
- [ ] meet.jit.si appears in no default or production example.

### 16.4 Definition of done

All §2.1 boxes checked; §16.1 passing in CI; §16.3 run and recorded; app-only and full-mode quickstarts verified from a clean checkout using only the README; `docs/lib-surface.md` present; `docs/map-guide.md` and the map-maker Skill in the repo.

---

## 17. Implementation milestones

- **M0 — Spike (GATE).** Pin versions; verify §6.1 lib surface; write `types.d.ts` + `docs/lib-surface.md`; minimal page connecting two tabs to a local full-mode stack that exchange one broadcast endpoint message. *Exit:* two tabs exchange a pose message; every signature used is verified.
- **M1 — Skeleton + Compose.** Vite/React/TS scaffold; app Dockerfile + app-only compose; runtime config (§12.3); lobby → join → conference, local mic/cam published, remote audio audible flat. *Exit:* two browsers can talk; §12.4 quickstart works.
- **M2 — Map + movement + map tooling.** Phaser scene; Tiled loader; starter map (§10.4); templates; `validate-maps` + `render-map-preview`; movement/collision/camera/zoom; zone extraction + label. *Exit:* you can walk the whole map alone; validator and preview work.
- **M3 — Pose sync.** Protocol (§7) end to end: broadcast, state exchange, heartbeat, interpolation, expiry, emotes, pose-less handling. *Exit:* §16.3 movement/late-join/idle items pass (audio still flat).
- **M4 — Spatial audio.** Web Audio graph (§8) with distance/pan/zones/silent/stage, tiers, master/deafen/per-user, audio subscriptions. *Exit:* §16.3 audio items pass in Chrome + Firefox.
- **M5 — Video.** Bubbles (§9.1), constraint planner (§9.2), stage panel (§9.3). *Exit:* §16.3 video/share items pass; bandwidth recorded per §15.
- **M6 — Chat, people, settings, polish.** MUC chat; people list; device settings; failure/reconnect states (§5.1/§6.2); CSP (§14). *Exit:* full §16.3 pass; §16.1 in CI.
- **M7 — Full mode + docs.** Pinned Jitsi stack profile (§12.5); JWT mode verified; proxy example (§12.6); `docs/map-guide.md` finalised; map-maker Skill shipped. *Exit:* §16.4 definition of done.

**Standing prohibitions:** no floating versions for lib-jitsi-meet / Phaser / Jitsi images; no pose data over chat; no audible `attach()` of spatialised audio tracks; no upstream Jitsi service definitions written from memory; no meet.jit.si in any default.

---

## 18. Risks (design responses in the sections cited)

- Endpoint-message reliability undocumented → best-effort protocol design (§7).
- lib-jitsi-meet not on npm, types incomplete, near-daily releases → pinned `.tgz`, local shim, adapter seam (§4.2), M0 gate, per-bump smoke test (§16.2).
- `setAudioSubscriptionMode` / `getOriginalStream` signatures may differ → M0 verification; gain-only fallback (§8.4).
- Chrome Web Audio stream-pumping quirk → browser matrix (§16.3); muted-element workaround only if proven (§8.6).
- JWT+guests room-opening semantics → distinct waiting state (§5.1).
- Safari Web Audio/autoplay differences → SHOULD-level support; gain-only tier; audio-enable banner (§8.6).
- Rooms outgrow endpoint-message fan-out → Phase-2 trigger (§4.3).

---

## 19. Open questions (defaults chosen — implement these)

| Question | Default |
|---|---|
| Audience | Private teams/friends; link is the invite; anonymous join on own stack |
| Maps at launch | One bundled map (§10.4) + templates; `?map=` override for testing |
| Avatars | Emoji in MVP; photo-by-URL MAY be added behind §14 rules |
| Chat scope | Room-wide in MVP, labelled as such (§5.4) |
| Jitsi hosting | Both supported; deliverable defaults to self-hosted full mode (§12.5) |
| Mobile | Desktop-first (§2.2); layout must not break on a phone |
| Recording/transcription | None; stock Meet in the same room covers users who need it |

*End of specification.*
