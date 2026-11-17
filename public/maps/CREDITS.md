# Map assets — credits and provenance

Everything under `public/maps/` (tilesets, maps, previews). Licensing rules:
CC0 / CC-BY only, no sprites ripped from commercial games (SPEC §10.3).

## Tileset: Kenney — Tiny Dungeon (base pack)

| | |
|---|---|
| Name | Tiny Dungeon (base pack), version 1.0 |
| Author | Kenney (https://kenney.nl) |
| Licence | **CC0 1.0 Universal (Public Domain)** — see `tilesets/tiny-dungeon-LICENSE.txt` (the licence file shipped in the pack) and https://creativecommons.org/publicdomain/zero/1.0/ |
| Source page | https://kenney.nl/assets/tiny-dungeon (the page states "Download this package … for free, CC0 licensed!") |
| Downloaded | 2026-10-29, official Kenney download (`kenney.nl/download-link/…`), archive `kenney_tiny-dungeon.zip` |
| Original file | `Tilemap/tilemap_packed.png` — 192×176 px, 12×11 grid of **16×16 px** tiles, 132 tiles |
| In this repo | `tilesets/tiny-dungeon-16.png` — the original sheet, pixels unmodified |
| Used by maps | `tilesets/tiny-dungeon.png` — **384×352 px, 12×11 grid of 32×32 px tiles** |

**Scaling note (why the shipped sheet is not the original pixels):** JitsiMap
maps are a 32×32 grid (SPEC §10.1) and this pack ships 16×16 tiles, so the
sheet was upscaled **2× with exact nearest-neighbour** (pixels duplicated, no
resampling, no artwork redrawn, alpha transparency preserved) by `scripts/make-tileset.mjs`:

```bash
node scripts/make-tileset.mjs public/maps/tilesets/tiny-dungeon-16.png \
  --out public/maps/tilesets/tiny-dungeon.png --tile 16 --scale 2
```

Credit is not required by CC0, given here anyway: *Tiny Dungeon* by Kenney.nl.

The pack contains no `collides` properties (as most tilesets ship them: none),
so the collision tile properties are **authored by us** in the embedded tileset
of every JitsiMap map — see `scripts/make-starter-map.mjs` (`COLLIDING_TILES`).

## Tile index map

Local tile id = `row * 12 + col` in the sheet (Tiled's tile id).
**gid = 1 + local id** (the tileset's `firstgid` is 1). Regenerate this table
with `node -e "import('./scripts/make-starter-map.mjs').then(m=>console.log(m.tileIndexMap()))"`.

| Name | Tile id | gid | Sheet col,row | Collides | Looks like |
|---|---|---|---|---|---|
| `floor-1` | 48 | 49 | 0,4 | no | warm tan floor (hall floor) |
| `floor-2` | 49 | 50 | 1,4 | no | warm tan floor, speckled variant |
| `floor-stones` | 42 | 43 | 6,3 | no | warm tan floor with flagstones |
| `floor-dark-1` | 0 | 1 | 0,0 | no | dark brown floor (room floor) |
| `floor-planks-left` | 36 | 37 | 0,3 | no | grey stone platform, left edge |
| `floor-planks-mid` | 37 | 38 | 1,3 | no | grey stone platform, middle |
| `floor-planks-right` | 38 | 39 | 2,3 | no | grey stone platform, right edge |
| `floor-steps` | 39 | 40 | 3,3 | no | vertical stone steps |
| `mat` | 66 | 67 | 6,5 | no | woven floor mat / rug |
| `wall` | 40 | 41 | 4,3 | **yes** | grey brick wall |
| `wall-pillar` | 58 | 59 | 10,4 | **yes** | grey brick wall with stone pillar trim |
| `wall-window` | 28 | 29 | 4,2 | **yes** | brick wall with barred window |
| `wall-banner` | 29 | 30 | 5,2 | **yes** | brick wall with red banner |
| `door-left` | 46 | 47 | 10,3 | no | wooden double door, left half (walkable) |
| `door-right` | 47 | 48 | 11,3 | no | wooden double door, right half (walkable) |
| `table` | 72 | 73 | 0,6 | **yes** | wooden table |
| `chair` | 73 | 74 | 1,6 | no | small wooden stool/chair (walk-over: people "sit") |
| `shelf` | 63 | 64 | 3,5 | **yes** | wooden shelf/cabinet |
| `chest` | 89 | 90 | 5,7 | **yes** | wooden storage chest |
| `crate` | 101 | 102 | 5,8 | **yes** | small wooden crate |
| `rail-left` | 76 | 77 | 4,6 | **yes** | iron/stone railing, left post |
| `rail-mid` | 77 | 78 | 5,6 | **yes** | iron/stone railing, middle |
| `rail-right` | 78 | 79 | 6,6 | **yes** | iron/stone railing, right post |

The other 108 tiles of the sheet are unused by the starter map but valid to
paint with; read them from the sheet, never invent ids (the map-maker Skill
says why).

## Maps

- `office.tmj` — the bundled starter map (SPEC §10.4), and
  `templates/blank.tmj` — the template, are **generated**, not hand-written:
  edit `scripts/make-starter-map.mjs` and re-run it.
- `previews/office.png`, `previews/blank.png` — rendered by
  `npm run preview:map -- <file>`; regenerate after any map change.

## Fallback artwork

If a CC0 download is ever unavailable, `scripts/make-tileset.mjs
--generate-flat <name>` writes a flat-coloured 32 px strip (floors, walls,
door, table, shelf, planter, chalkboard, rugs) in the same layout the tooling
expects, so map authoring keeps working offline. The starter map uses the
Kenney sheet above; the flat set is not referenced by any shipped map.
