# JitsiMap map schema (`.tmj`) — reference

Authoritative source: `SPEC.md` §10 in the JitsiMap repo. This reference is a
working extract for map authors and agents; if they disagree, `SPEC.md` and
the validator (`scripts/validate-maps.mjs`) win.

## File basics

- Format: Tiled JSON export, extension `.tmj`. Not TMX/XML.
- Orientation: `orthogonal`. Tile size: `tilewidth = 32`, `tileheight = 32`.
- Location: `public/maps/<map-id>.tmj`; `<map-id>` is lowercase + hyphens and
  is how the app selects the map (`?map=<map-id>`, or the `DEFAULT_MAP` config).
- Tilesets: embedded in the export where tooling allows, with image files
  alongside. Every tileset used must be listed in `public/maps/CREDITS.md`
  with author, source, and licence (CC0/CC-BY only).

## Tile layer encoding

- Each tile layer has `width`, `height`, and `data`: a flat array of gids,
  **row-major, top-left origin**: `data[row * width + col]`.
- `0` = empty cell.
- A cell's gid = the tileset's `firstgid` + the tile's local id in that
  tileset. Gids are meaningless without the tileset — always resolve them
  from the tileset in the repo.
- Tile-flip flags live in the high bits of a gid (≥ 2^29). Do not set them;
  if copying cells from an existing map, copy gids verbatim.
- Infinite maps (`"infinite": true`) are not used. Keep `width`/`height`
  fixed and `data.length == width * height` for every tile layer.

## Layers (names are exact)

| Name | `type` | Contents |
|---|---|---|
| `ground` | `tilelayer` | Floors, ground decoration. Collision applies. |
| `furniture` | `tilelayer` | Tables, desks, plants. Drawn over `ground`, under avatars. Collision applies. |
| `above` | `tilelayer` | Roofs/canopy drawn over avatars. No collision role. |
| `spawns` | `objectgroup` | Spawn point objects. |
| `zones` | `objectgroup` | Zone rectangle objects. |
| `exits` | `objectgroup` | Reserved (Phase 2 portals). May be present; the app ignores it. |

Unknown layers and unknown properties are ignored by the app, not errors.

## Collision

- A tile blocks movement iff its **tile property** `collides` (bool) is
  `true` in the tileset. The legacy spelling `Collision` is also accepted.
- Collision is evaluated from the `ground` and `furniture` layers only.
- Tile properties live in the tileset definition, per tile id:

```jsonc
// inside a tileset object
"tiles": [
  { "id": 12, "properties": [ { "name": "collides", "type": "bool", "value": true } ] }
]
```

## Spawn objects

On the `spawns` layer. Point objects (`width`/`height` 0), `x`/`y` in pixels.

```jsonc
{
  "id": 7, "name": "main-door", "type": "",
  "x": 336, "y": 272, "width": 0, "height": 0,
  "properties": [ { "name": "id", "type": "string", "value": "main-door" } ]
}
```

Rules: at least one spawn per map; the spawn tile must be walkable
(non-colliding on both collision layers); leave clear space around it.

## Zone objects

On the `zones` layer. Rectangle objects, `x`/`y`/`width`/`height` in pixels
(multiples of 32 recommended — align to the tile grid).

```jsonc
{
  "id": 3, "name": "breakout-1", "type": "",
  "x": 640, "y": 64, "width": 288, "height": 224,
  "properties": [
    { "name": "zone",  "type": "string", "value": "breakout-1" },
    { "name": "label", "type": "string", "value": "Breakout 1" }
  ]
}
```

Properties:

| Name | Type | Required | Meaning |
|---|---|---|---|
| `zone` | string | yes | Unique id, lowercase + hyphens. |
| `label` | string | no | Display name shown in the app. |
| `silent` | bool | no | Occupants cannot be heard by anyone. |
| `stage` | bool | no | Marks a presentation zone. |
| `audibleFrom` | string | no | Comma-separated zone ids that **can hear this zone**, one-way. Set on the zone being heard. Example: zone `stage` with `audibleFrom: "hall"` — the hall hears the stage; the stage does not hear the hall. |

Acoustic model the map is designing against:

- Same zone (or both zone-less): volume by distance — full within 2 tiles,
  fading to zero at 8 tiles, stereo pan by horizontal offset.
- Different zones: silence, except the `audibleFrom` rule above.
- `silent` zone: its occupants are inaudible everywhere.
- Video: live video only within 6 tiles and an audible zone relationship.

## Validation rules (`npm run validate:maps`)

A map is valid when all of these hold:

1. File parses as Tiled JSON with the §"File basics" settings.
2. All layers in the layer table exist (empty is fine except as noted).
3. At least one spawn, on a walkable tile.
4. Zone ids are present and unique.
5. Every `audibleFrom` entry names an existing zone id.
6. Every tileset image path resolves to a file in the repo.
7. Reachability: flood fill over walkable tiles (collision layers +
   `collides`) from any spawn reaches at least one tile of every zone and
   does not reach tiles outside the map bounds through gaps in the outer
   wall… (outer-boundary leaks are a warning, not an error).

## Sizing guidance

- Tile = 32 px; walking speed ≈ 4 tiles/s; hearing radius 8 tiles; video
  radius 6 tiles.
- Breakout room for 4–6: ≈ 9×7 tiles, 3×2 table, 2-tile door.
- Hall for ~20: ≈ 20×14 tiles of open floor.
- Whole map: ≤ 50×40 tiles recommended.
- Doors: 2 tiles wide. Corridors: ≥2 tiles wide, avoid 1-tile anywhere.
- Zone rectangles: cover the room's interior; wall tiles may be inside or
  outside the rectangle — what matters is where avatars stand.
