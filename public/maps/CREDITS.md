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
resampling, no artwork redrawn) by `scripts/make-tileset.mjs`:

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
| `floor-dark-1` | 0 | 1 | 0,0 | no | dark brown floor (room floor) |
| `floor-dark-2` | 12 | 13 | 0,1 | no | dark brown floor, speckled variant |
| `floor-planks-1` | 36 | 37 | 0,3 | no | grey plank floor |
| `floor-planks-2` | 37 | 38 | 1,3 | no | grey plank floor, variant |
| `floor-planks-3` | 39 | 40 | 3,3 | no | grey plank floor, variant |
| `floor-mat` | 31 | 32 | 7,2 | no | stone slab / step |
| `rug` | 30 | 31 | 6,2 | no | pink rug |
| `wall` | 40 | 41 | 4,3 | **yes** | grey brick wall |
| `wall-2` | 14 | 15 | 2,1 | **yes** | grey brick wall, variant (corners) |
| `wall-3` | 58 | 59 | 10,4 | **yes** | brick wall, edging variant |
| `wall-window` | 16 | 17 | 4,1 | **yes** | wall with a window |
| `door` | 46 | 47 | 10,3 | no | wooden door in a brick wall (walkable) |
| `table` | 54 | 55 | 6,4 | **yes** | grey table, seen from above |
| `table-2` | 55 | 56 | 7,4 | **yes** | grey table, variant |
| `chair` | 73 | 74 | 1,6 | no | small stool/chair (walk-over: people "sit") |
| `shelf` | 75 | 76 | 3,6 | **yes** | wooden shelf/cabinet |
| `shelf-2` | 63 | 64 | 3,5 | **yes** | wooden shelf, variant |
| `shelf-3` | 41 | 42 | 5,3 | **yes** | supply shelf (doubles as a wall board) |
| `planter` | 44 | 45 | 8,3 | **yes** | planter with a green plant |
| `barrel` | 68 | 69 | 8,5 | **yes** | barrel |
| `crate` | 70 | 71 | 10,5 | **yes** | wooden crate |
| `banner` | 29 | 30 | 5,2 | **yes** | red banner (wall decoration) |

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
