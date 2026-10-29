---
name: jitsimap-map-maker
description: Create or edit JitsiMap meeting-space maps (Tiled JSON .tmj files with rooms, acoustic zones, spawns, and collision). Use when a user asks to design, generate, modify, restyle, or review a JitsiMap map, add or change rooms/zones in a JitsiMap space, or fix a JitsiMap map that fails validation.
---

# JitsiMap Map Maker

You make floor-plan maps for JitsiMap, a spatial meeting app. A map is a
Tiled JSON file (`.tmj`) in `public/maps/`. People walk it as avatars;
**zones** (invisible rectangles) control who can hear whom, **colliding
tiles** control where people can walk, and **spawns** are where people
appear. The exact format contract is in
[references/map-schema.md](references/map-schema.md) — read it before your
first edit in a session, and re-read it if validation fails in a way you do
not understand.

## Ground rules

- **Never write a `.tmj` from scratch.** Start from
  `public/maps/templates/blank.tmj`, or copy the bundled starter map
  (`public/maps/office.tmj`) for a restyle. The template carries the correct
  layers, orientation, and tileset wiring.
- **Never invent tile gids.** A gid is only meaningful against the tileset
  in the repo. Read the tileset (its `.tsx`/`.tsj` JSON or the embedded
  tileset in an existing map) and build a name → gid table for the tiles you
  will use (floor, wall, door/floor accent, table, chair, plant, rug, stage
  floor) before placing anything. If you cannot identify a tile for
  something, use a floor/wall tile you *have* identified and say so.
- **Never hand-edit tile-layer data arrays in raw text.** They are long
  row-major integer arrays. Write a small script (Node or Python) that loads
  the template JSON, paints rectangles/rooms from your layout plan into the
  arrays, sets objects and properties, and writes the file. Keep the script
  in your working notes; you will re-run it on every iteration.
- **Collision is a tileset tile property (`collides: true`), not paint.**
  Verify the wall and furniture tiles you use actually carry it in the
  tileset. New tilesets have no collision set — flag that to the user and
  set the property, or choose tiles that already have it.
- **Zones are behaviour, looks are not.** A room without a zone rectangle is
  not private, however it is drawn. Every enclosed room the user calls
  private, quiet, or a stage needs its zone object.
- **Maps are data.** Your deliverable is the `.tmj` (plus any tileset files
  and a `CREDITS.md` entry for new artwork). Never change app code to make a
  map work.

## Workflow

### 1. Interview (brief)

Establish, asking only what you cannot infer from the request or the repo:

- Map name/id (lowercase, hyphens) and the space it is for.
- Rooms: how many, what kind (hall, breakout, stage, silent/focus, social),
  and rough capacity of each.
- Style/theme and whether the bundled tileset is acceptable (default: yes).
- Overall size in tiles if they care (default: fit the rooms, ≤ 50×40).

### 2. Sketch and get sign-off

Draw an ASCII layout at tile scale (1 char ≈ 1 tile, or state the scale),
showing walls, doors, zones labelled by id, and the spawn. Example shape:

```text
######################
# hall          # b1 #
#          S    D    #
#               #----#
####DDDD#########    #
# stage              #
######################
```

(S = spawn, D = door gap.) Show the sketch to the user and get agreement
before building. Call out capacities: a breakout for 4–6 is about 9×7
tiles; hearing fades out at 8 tiles, so halls much wider than ~16 tiles
split into separate conversations — mention this rather than silently
building an oversized hall.

### 3. Build

With your painting script, starting from the template:

1. Set map width/height to the sketch.
2. Paint `ground`: floors everywhere, a distinct floor/rug for special areas.
3. Paint walls on `ground` (or `furniture` where the template does) using
   colliding wall tiles; leave **2-tile door gaps**.
4. Paint `furniture`: tables (colliding) in room centres, chairs (usually
   non-colliding), plants, stage edging. Keep walking lanes ≥2 tiles wide.
5. Add `zones` objects (rectangles in pixel coordinates) for every room that
   needs acoustic behaviour, with properties per the schema. Non-overlapping
   except by design.
6. Add `spawns` objects on walkable tiles near the entrance/hall, each with
   an `id` property.
7. Save as `public/maps/<map-id>.tmj`.

Coordinate discipline: object `x/y/width/height` are **pixels** (tile × 32);
layer data index = `row * width + col`, row-major from the top-left;
`0` = empty cell.

### 4. Validate and preview (mandatory, in this order)

```bash
npm run validate:maps
npm run preview:map -- public/maps/<map-id>.tmj
```

- Fix **all** validator errors and re-run until clean. Its reachability
  check (flood fill from a spawn) catches sealed rooms and colliding doors;
  do not argue with it — open a door or clear the blockage.
- Open the rendered preview PNG and inspect it yourself: floors, walls,
  furniture, zone outlines, spawns. Compare it against the approved sketch.

### 5. Present and iterate

Show the user the preview image and a summary: map id, size, zone list with
labels and any special properties (`silent`, stage with its `audibleFrom`),
spawn locations, and the validator result. Offer the common edits as
concrete options (resize a room, add a room, move the stage, change theme)
and apply them by re-running your painting script, then re-validating and
re-rendering. Do not declare the map done until the user has seen a clean
validator run **and** the preview.

### 6. Hand off for live testing

Tell the user to run the two-browser test from `docs/map-guide.md` Part 3
(walk every room; check cross-wall silence, stage direction, silent zone,
~8-tile fade) before using the map for a real meeting, and how to make it
the default (`DEFAULT_MAP=<map-id>`) if they want that.

## Editing an existing map

- Load the existing `.tmj`; preserve its tileset references, layer names,
  zone ids (other spaces/docs may refer to them), and any properties you do
  not understand — unknown properties are ignored by the app but may matter
  to its owner.
- Prefer the smallest change that satisfies the request: extend a layer
  array for a resize rather than repainting, move a zone rectangle rather
  than recreating it.
- Re-run the full step 4 validation + preview, and diff the zone list
  before/after in your summary.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Validator: zone unreachable | No door, or door tiles collide | Cut a 2-tile gap with non-colliding floor tiles |
| People walk through walls (reported live) | Tiles used lack `collides: true` in the tileset | Set the tile property in the tileset; re-export |
| Room looks private, is not | Zone rectangle missing or wrong layer | Add the zone object on the `zones` layer |
| Stage/hall one-way audio reversed | `audibleFrom` on the wrong zone | It sits on the zone **being heard**: `stage` gets `audibleFrom: hall` |
| Map renders garbled | Hand-edited layer arrays or invented gids | Rebuild from the template with the script; read gids from the tileset |
| Spawn inside furniture | Spawn coordinates on a colliding tile | Move the spawn object to a clear walkable tile |

## References

- [references/map-schema.md](references/map-schema.md) — the format contract:
  layers, properties, encoding, validation rules, worked snippets.
- `docs/map-guide.md` in the repo — the human guide; your behaviour and its
  instructions must agree (the schema and validator outrank both).
