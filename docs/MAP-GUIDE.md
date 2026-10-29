# JitsiMap — Map Creator's Guide

*This file becomes `docs/map-guide.md` in the JitsiMap repo. It is written for
deployers and space owners. No programming or game-development experience is
assumed.*

A JitsiMap **map** is the floor plan of a meeting space: the rooms people walk
between, which rooms are private, where the stage is, and where people appear
when they join. Maps are ordinary files. You can:

1. **Edit one visually** in Tiled, a free map editor (Part 1), or
2. **Ask an AI coding agent to make one for you** from a description, using
   the bundled map-maker Skill (Part 2),

and in both cases you check the result with the same validator and preview
tool before anyone uses it (Part 3).

---

## How a map works (2 minutes)

- The map is a grid of **tiles**, 32×32 pixels each. Floors, walls, tables and
  decorations are tiles from a **tileset** (a picture containing many tiles).
- People walk on tiles. A tile marked with the property **`collides = true`**
  is a wall: nobody can walk through it, whatever it looks like. A pretty
  wall tile without `collides` is walk-through; an invisible tile with
  `collides` is an invisible wall. Looks and behaviour are separate.
- **Zones** are invisible rectangles you draw over rooms. A zone is what makes
  a room *sound* private: people in different zones cannot hear each other at
  all, even if their avatars are one tile apart through a wall. People in the
  same zone (or both out in the open, zone-less) hear each other by distance:
  full volume within 2 tiles, fading to silence at 8 tiles.
- **Spawns** are the points where people appear when they join. Put at least
  one in a sensible "front door" place.
- A map file is a **`.tmj` file** (Tiled's JSON export). It lives in
  `public/maps/` in the JitsiMap repo. Adding a map never requires changing
  any code.

Keep maps modest: at walking speed (about 4 tiles per second), crossing a
40-tile map takes ~10 seconds. **50×40 tiles is a good maximum**; most good
spaces are 30×25 to 45×35.

---

## Part 1 — Make or edit a map in Tiled

### 1. Get the tools

1. Install **Tiled** from <https://www.mapeditor.org> (free, Windows/macOS/Linux).
2. Get the JitsiMap starter files: from the repo, copy the whole
   `public/maps/` folder somewhere you can work. It contains:
   - `office.tmj` — the bundled starter map. **The best way to learn is to
     open this and change it.**
   - `templates/blank.tmj` — an empty map with all the required layers and
     the starter tileset already wired up. Start new maps from this.
   - the tileset image(s) and `CREDITS.md` (what the artwork is and its licence).

### 2. Open and look around

Open `office.tmj` in Tiled. On the right you will see the **Layers** panel.
From bottom to top when rendered:

| Layer | What it is | You edit it to… |
|---|---|---|
| `ground` | Floors and ground decoration | Paint floors |
| `furniture` | Tables, desks, plants (drawn over floors, under people) | Furnish rooms |
| `above` | Roofs/canopies drawn *over* people | Rarely needed indoors; leave empty at first |
| `spawns` | Join points (object layer) | Move/add spawn points |
| `zones` | Room rectangles (object layer) | Define which areas are private/stage/silent |
| `exits` | Future feature | Ignore for now |

Select a tile layer, pick a tile in the **Tilesets** panel, and paint with
the stamp tool (B). Select an object layer to move or resize rectangles and
points with the select tool (S).

### 3. Walls that actually block

Collision is a property of the **tile in the tileset**, not of where you paint it:

1. In the Tilesets panel, select the tileset, then select a wall tile.
2. In the Properties panel, add a custom property: name `collides`, type
   **bool**, value **true**. (The starter tileset already has this set on its
   wall tiles — check before adding duplicates.)
3. Anywhere that tile is painted on `ground` or `furniture`, it blocks movement.

Tables and counters usually should collide too, so people walk around them
rather than through them.

### 4. Build a room, step by step

1. On `ground`, paint the floor rectangle.
2. Paint walls around it with colliding wall tiles. **Leave a door gap
   2 tiles wide** — 1-tile doors work but are fiddly to walk through.
3. Furnish on `furniture`: a table in the middle, chairs as decoration
   (chairs normally do *not* collide; people "sit" by standing on the chair tile).
4. Make it private: select the `zones` layer, draw a rectangle covering the
   room's interior (walls included is fine), and set its properties
   (next section).

A room only *sounds* private once it has a zone. Walls alone do not block sound.

### 5. Zones: the properties that matter

Select a zone rectangle; in Properties set:

| Property | Type | Required | Meaning |
|---|---|---|---|
| `zone` | string | **Yes** | Unique id, lowercase with hyphens: `breakout-1`, `stage`, `quiet-corner` |
| `label` | string | No | Friendly name shown in the app: "Breakout 1" |
| `silent` | bool | No | Nobody inside can be heard. For quiet-focus areas |
| `stage` | bool | No | Marks a presentation area (used with `audibleFrom`) |
| `audibleFrom` | string | No | Comma-separated zone ids that can **hear this zone**, one-way. It sits on the zone being heard. Example: the `stage` zone gets `audibleFrom: hall` — people in the hall hear people on stage, but people on stage do **not** hear the hall (unless the hall also lists `stage`). Read it as "this zone is audible from…" |

Keep it simple at first: most maps need only `zone` + `label`, one `silent`
nook, and optionally one stage. Overlapping zones: the app uses the first
matching zone; avoid overlaps except where you mean it.

Rules the validator will enforce: zone ids are unique; every zone is
reachable on foot from a spawn (you cannot have a room with no door);
`audibleFrom` ids must exist.

### 6. Spawns

Select the `spawns` layer. Each point object is a possible join location;
give each a property `id` (string, e.g. `main-door`). Make sure the spawn
tile itself is walkable (not colliding, not inside furniture) and has room
around it — several people may arrive at once. One spawn is enough; 2–3
around an entrance hall is nicer.

### 7. Export

Tiled's native save *is* the format you need if you export correctly:

- **File → Export As → JSON map files (`*.tmj`)** into `public/maps/`,
  named with lowercase and hyphens: `team-office.tmj`.
- Keep the tileset embedded/exported the way the template does it; if Tiled
  asks about the tileset, export it alongside with the same settings as
  `office.tmj`. If in doubt, start from `templates/blank.tmj` — its settings
  are already right.
- The map's file name (without `.tmj`) is its **map id**: people open it with
  `?map=team-office`, or you make it the default with the `DEFAULT_MAP`
  setting.

### 8. Design guidance (learned the easy way)

- **Room sizes:** a breakout room for 4–6 people feels right at about
  9×7 tiles (a 3×2 table with walking space around it). A hall for 20 wants
  roughly 20×14 tiles of open floor. Beyond the 8-tile hearing radius,
  one big room naturally splits into separate conversations — that is a
  feature; do not fight it with huge empty halls.
- **Doors 2 tiles wide**, and put a small landing inside so people do not
  block the doorway while chatting.
- **Separate zones need real separation in behaviour, not looks:** two
  "rooms" painted side by side with no zone rectangles are one acoustic room.
- **Stage:** put it at one end of the hall, raised-look floor tiles, with
  the hall zone in front of it. Test the one-way audio with two browsers
  (one on stage, one in the hall, then swap).
- **Silent zones** are for focus/co-working corners: small, clearly signed
  with floor colour or a rug, at the edge of the map.
- **Signage:** use floor colour changes, rugs, and plants to suggest areas.
  Remember avatars are emoji — a map reads through its floors and furniture.
- **Do not** make maze-like maps, single-tile corridors, or rooms reachable
  only through other private rooms.

### 9. Artwork and licensing

- Use the bundled tileset, or any tileset you have the right to use —
  CC0 and CC-BY sets (for example from Kenney.nl or OpenGameArt) are the
  safe sources. **Never rip sprites from commercial games.**
- If you add a tileset, add its name, author, source URL, and licence to
  `public/maps/CREDITS.md`, and set `collides` on its wall/furniture tiles
  (§3) — new tilesets arrive with no collision set at all, which is the
  single most common cause of "people walk through walls".

---

## Part 2 — Ask an AI agent to make the map

Maps are JSON text files, so a coding agent can create and edit them without
ever opening Tiled — if it follows the rules. This repo ships a ready-made
**Agent Skill** for exactly that: `skills/jitsimap-map-maker/`.

### Use it

1. Open your agent (Claude Code, Muse, or any agent that supports
   Agent Skills) **in the JitsiMap repo**, so it can see `public/maps/`,
   the validator, and the preview tool.
2. Make sure the Skill is available to it: it lives in the repo at
   `skills/jitsimap-map-maker/`; copy or symlink it into wherever your agent
   loads skills from if it does not pick up repo skills automatically
   (for Claude Code: `.claude/skills/`; check your agent's docs).
3. Ask in plain language, for example:

   > "Make a JitsiMap map called `book-club`: a cosy hall for 12 with a
   > fireplace corner, two private breakout rooms for 4, and a small silent
   > reading nook. Use the bundled tileset."

4. A good agent run will: ask anything it is missing, show you an **ASCII
   layout sketch** for approval *before* building, build the `.tmj` from the
   blank template, run the validator, render a **preview image**, and show
   you that preview. Approve or ask for changes ("make breakout 2 bigger",
   "move the stage to the north end") and let it iterate.
5. Finish with Part 3 below — including a real two-browser test — before
   using the map for an actual meeting.

### What to check in the agent's work

- It started from `templates/blank.tmj` or the starter map (not a
  from-scratch file) and did not invent tile numbers — it read them from the
  tileset. If it says it "guessed" tile ids, send it back.
- The validator passes with no warnings skipped.
- The preview image actually looks like the sketch you approved.
- Zone list in its summary matches the rooms you asked for.

---

## Part 3 — Validate, preview, and test (both routes, always)

1. **Validate:**
   ```bash
   npm run validate:maps
   ```
   Fix everything it reports. It checks, among other things: the file
   parses, required layers exist, zone ids are unique, referenced artwork
   exists, the spawn is walkable, and every zone can be reached on foot
   from a spawn.
2. **Preview:**
   ```bash
   npm run preview:map -- public/maps/<your-map>.tmj
   ```
   Open the PNG it writes. Check floors, walls, furniture, zone rectangles,
   and spawn points look right.
3. **Test live with two browsers** (two windows on one machine is fine;
   use headphones to avoid feedback):
   - Join the space with `?map=<your-map>` in both.
   - Walk every room: can you get in and out? Do doors feel right?
   - Stand in a breakout room and talk: the other avatar, left in the hall,
     must hear **nothing**. Then stand together inside: normal volume.
   - Check the stage direction and the silent zone the same way.
   - Stand ~8 tiles apart in the open: you should just about fade out.
4. **Publish:** the file is already in `public/maps/` — rebuild/redeploy the
   app container (or copy the file into the running deployment's maps
   folder, if your setup mounts it) and, if it should be the default,
   set `DEFAULT_MAP=<your-map>`.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| People walk through walls | Wall tiles lack `collides = true`, or walls painted on `above` | Set the property on the tileset tiles (§3); collision reads `ground` + `furniture` only |
| A "private" room can be heard outside | No zone rectangle over the room, or zone id typo | Add/fix the zone (§5) and re-validate |
| People in the same room can't hear each other | The room's floor is split between two zones, or a `silent` zone covers it | Check zone rectangles; remove overlap |
| Map won't load / app shows an error | Exported as `.tmx` (XML) or tileset not embedded as the template does | Re-export as `.tmj` from the template (§7); run the validator — it names the problem |
| Validator says a zone is unreachable | No door gap, or the door tiles collide | Cut a 2-tile door; check the door floor tiles don't use a colliding tile |
| Everyone spawns inside a table/wall | Spawn point on a colliding tile | Move the spawn (§6) |
| Stage can hear the hall (wrong direction) | `audibleFrom` set on the wrong zone | Re-read §5 and re-test with two browsers |
| New tileset looks right but nothing collides | New tilesets have no `collides` properties at all | Set them per §9 — the most common gotcha |

---

*Guide ends. The authoritative format rules are §10 of `SPEC.md`; the
validator's output outranks this guide if they ever disagree — file the
discrepancy as a docs bug.*
