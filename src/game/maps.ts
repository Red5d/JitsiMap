/**
 * Tiled JSON (`.tmj`) loader — SPEC §10.2. Produces the `MapData` the store,
 * collision, zones, and protocol validation all consume.
 *
 * Two entry points:
 *  - `parseMapData(json, id)` — PURE (no Phaser, no DOM): safe for node tests.
 *  - `loadMap(id)` — browser: `fetch('/maps/<id>.tmj')` then parse.
 *
 * Rules mirrored from `scripts/maplib.mjs` (the validator is the shared
 * source of truth; this runtime loader is independent — no cross-imports):
 *  - row-major tile data, `0` = empty, gid = firstgid + local tile id,
 *    flip/transpose flags stripped from the high bits;
 *  - collision from tile property `collides` (legacy `Collision` accepted),
 *    evaluated on `ground` + `furniture` only;
 *  - zone props: `zone` (required, object name as fallback), `label`,
 *    `silent`/`stage` bool coercion, `audibleFrom` CSV (JSON arrays ok);
 *  - unknown layers/properties are ignored, the `exits` layer is accepted
 *    and ignored gracefully (Phase 2, §10.2);
 *  - malformed maps throw `Error` with a human message → the §5.1
 *    "map failed to load" state.
 */

import { TILE_SIZE, type MapData, type SpawnPoint, type ZoneDef } from '../types';

/** Tiled stores flip/transpose flags in the high bits of a gid. */
const FLIP_FLAGS = 0xf000_0000;
const TILE_ID_MASK = 0x0fff_ffff;

/** One embedded tileset, reduced to what the Phaser renderer needs (MVP: image tilesets only). */
export interface RenderTileset {
  /** Stable key for texture naming: tileset `name` (fallback: index). */
  key: string;
  /** Image path relative to `/maps/` (as written in the `.tmj`). */
  image: string;
  firstgid: number;
  lastgid: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tilecount: number;
  margin: number;
  spacing: number;
}

/**
 * `MapData` plus renderer metadata (embedded tileset images/grid). Extra
 * fields are additive — everything typed as `MapData` accepts a `GameMapData`.
 */
export interface GameMapData extends MapData {
  tilesets: RenderTileset[];
  /** The three tile layers in draw order (ground, furniture, above). */
  layers: RenderLayer[];
}

/** One static tile layer, reduced to raw (flip-stripped) row-major gids. */
export interface RenderLayer {
  name: string;
  /** Row-major gids, flip/transpose flags stripped; 0 = empty. */
  data: number[];
}

// ---------------------------------------------------------------- parsing

type Doc = Record<string, unknown>;

function parseJson(input: unknown, id: string): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch (err) {
    throw new Error(`Map "${id}": not valid JSON (${(err as Error).message})`);
  }
}

/** Tiled property lists → plain object. Unknown/malformed entries skipped. */
function properties(list: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(list)) return out;
  for (const p of list) {
    const o = p as { name?: unknown; value?: unknown };
    if (o && typeof o.name === 'string') out[o.name] = o.value;
  }
  return out;
}

/** Bool-ish coercion (mirrors the validator): true ← true/"true"/"TRUE"/1/"1"/"yes". */
function asBool(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === 'yes' || v === '1';
  }
  return false;
}

/** `audibleFrom`: comma-separated string, or JSON list. */
function asZoneList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const parts = Array.isArray(value) ? value.map((v) => String(v)) : String(value).split(',');
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function layerByName(doc: Doc, name: string): Doc | null {
  const layers = Array.isArray(doc.layers) ? (doc.layers as Doc[]) : [];
  return layers.find((l) => l && l.name === name) ?? null;
}

function tileLayerData(doc: Doc, name: string, cells: number, id: string): number[] {
  const layer = layerByName(doc, name);
  if (!layer || layer.type !== 'tilelayer') {
    throw new Error(`Map "${id}": missing tile layer "${name}" (expected layers: ground, furniture, above)`);
  }
  if (!Array.isArray(layer.data) || layer.data.length !== cells) {
    const got = Array.isArray(layer.data) ? layer.data.length : 'no data';
    throw new Error(`Map "${id}": tile layer "${name}" has ${got} cells, expected ${cells}`);
  }
  return layer.data as number[];
}

/** Resolve embedded tilesets: firstgid ranges + per-tile properties. */
function resolveTilesets(doc: Doc): { render: RenderTileset[]; collide: Map<number, (localId: number) => boolean> } {
  const render: RenderTileset[] = [];
  const collide = new Map<number, (localId: number) => boolean>();
  const list = Array.isArray(doc.tilesets) ? (doc.tilesets as Doc[]) : [];
  list.forEach((ts, i) => {
    const firstgid = Number(ts?.firstgid);
    if (!Number.isInteger(firstgid) || firstgid < 1) return;
    // External `source` tilesets: the runtime format is embedded (SPEC §10.1);
    // a `source` stub carries no tiles, so it contributes no collision/render.
    const tilecount = Number.isInteger(ts.tilecount) && Number(ts.tilecount) > 0 ? Number(ts.tilecount) : 0;
    const name = typeof ts.name === 'string' && ts.name ? ts.name : `tileset-${i}`;
    if (typeof ts.image === 'string' && ts.image) {
      const tileWidth = Number(ts.tilewidth) || TILE_SIZE;
      const tileHeight = Number(ts.tileheight) || TILE_SIZE;
      const cols =
        Number.isInteger(ts.columns) && Number(ts.columns) > 0
          ? Number(ts.columns)
          : Math.max(1, Math.floor(Number(ts.imagewidth) / tileWidth));
      const count = tilecount || cols * Math.max(1, Math.floor(Number(ts.imageheight) / tileHeight));
      render.push({
        key: name,
        image: ts.image,
        firstgid,
        lastgid: firstgid + count - 1,
        tileWidth,
        tileHeight,
        columns: Math.max(1, cols),
        tilecount: count,
        margin: Number(ts.margin) || 0,
        spacing: Number(ts.spacing) || 0,
      });
    }
    const props = new Map<number, Record<string, unknown>>();
    const tiles = Array.isArray(ts.tiles) ? (ts.tiles as Doc[]) : [];
    for (const t of tiles) {
      const id = Number(t?.id);
      if (Number.isInteger(id) && id >= 0) props.set(id, properties(t.properties));
    }
    collide.set(firstgid, (localId: number) => {
      const p = props.get(localId);
      if (!p) return false;
      return asBool(p.collides !== undefined ? p.collides : p.Collision);
    });
  });
  return { render, collide };
}

function buildCollision(data: number[][], width: number, height: number, collide: Map<number, (id: number) => boolean>): Uint8Array {
  const grid = new Uint8Array(width * height);
  // Highest firstgid first: a gid belongs to the tileset with the largest
  // firstgid that is ≤ gid.
  const sets = [...collide.entries()].sort((a, b) => b[0] - a[0]);
  for (const layer of data) {
    for (let i = 0; i < grid.length; i++) {
      if (grid[i]) continue;
      const raw = layer[i];
      if (typeof raw !== 'number' || raw === 0) continue;
      const gid = raw & TILE_ID_MASK; // strip flip/transpose flags (maplib convention)
      for (const [firstgid, test] of sets) {
        if (gid >= firstgid) {
          if (test(gid - firstgid)) grid[i] = 1;
          break;
        }
      }
    }
  }
  return grid;
}

function extractZones(doc: Doc, id: string): ZoneDef[] {
  const layer = layerByName(doc, 'zones');
  const objects = layer && layer.type === 'objectgroup' && Array.isArray(layer.objects) ? (layer.objects as Doc[]) : [];
  const zones: ZoneDef[] = [];
  objects.forEach((obj, index) => {
    const props = properties(obj.properties);
    const where = `Map "${id}": zone object #${index + 1}`;
    let zoneId: string | null = null;
    if (typeof props.zone === 'string' && props.zone.trim() !== '') zoneId = props.zone.trim();
    else if (props.zone !== undefined && props.zone !== null && String(props.zone).trim() !== '') zoneId = String(props.zone).trim();
    else if (typeof obj.name === 'string' && obj.name.trim() !== '') zoneId = obj.name.trim();
    else throw new Error(`${where}: missing required "zone" property`);
    const w = num(obj.width);
    const h = num(obj.height);
    if (w <= 0 || h <= 0) throw new Error(`${where} (${zoneId}): zone has zero size`);
    zones.push({
      id: zoneId,
      label: typeof props.label === 'string' && props.label ? props.label : undefined,
      silent: asBool(props.silent),
      audibleFrom: asZoneList(props.audibleFrom),
      stage: asBool(props.stage),
      x: num(obj.x),
      y: num(obj.y),
      w,
      h,
    });
  });
  return zones;
}

function extractSpawns(doc: Doc, id: string): SpawnPoint[] {
  const layer = layerByName(doc, 'spawns');
  const objects = layer && layer.type === 'objectgroup' && Array.isArray(layer.objects) ? (layer.objects as Doc[]) : [];
  if (objects.length === 0) {
    throw new Error(`Map "${id}": no spawn objects on the "spawns" layer — nobody can join`);
  }
  const spawns: SpawnPoint[] = [];
  objects.forEach((obj, index) => {
    const props = properties(obj.properties);
    let spawnId: string;
    if (typeof props.id === 'string' && props.id.trim() !== '') spawnId = props.id.trim();
    else if (typeof obj.name === 'string' && obj.name.trim() !== '') spawnId = obj.name.trim();
    else spawnId = `spawn-${index + 1}`;
    spawns.push({ id: spawnId, x: num(obj.x), y: num(obj.y) });
  });
  return spawns;
}

/**
 * Parse a `.tmj` (JSON string or already-parsed object) into `MapData`.
 * Pure: no Phaser, no DOM. Throws `Error` with a human message on anything
 * malformed — the UI surfaces it as the §5.1 "map failed to load" state.
 */
export function parseMapData(json: unknown, id: string): GameMapData {
  const doc = parseJson(json, id);
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error(`Map "${id}": JSON is not a Tiled map object`);
  }
  const d = doc as Doc;
  if (d.orientation !== undefined && d.orientation !== 'orthogonal') {
    throw new Error(`Map "${id}": orientation must be "orthogonal" (got ${String(d.orientation)})`);
  }
  if (d.infinite === true) {
    throw new Error(`Map "${id}": infinite maps are not supported`);
  }
  const width = Number(d.width);
  const height = Number(d.height);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error(`Map "${id}": width/height must be positive integers`);
  }
  const tileWidth = Number(d.tilewidth) || TILE_SIZE;
  const tileHeight = Number(d.tileheight) || TILE_SIZE;
  if (tileWidth !== TILE_SIZE || tileHeight !== TILE_SIZE) {
    throw new Error(`Map "${id}": tile size must be ${TILE_SIZE}x${TILE_SIZE}, got ${tileWidth}x${tileHeight}`);
  }

  const cells = width * height;
  const ground = tileLayerData(d, 'ground', cells, id);
  const furniture = tileLayerData(d, 'furniture', cells, id);
  // The `exits` object layer (Phase 2 portals) is accepted and ignored here;
  // unknown layers of any kind are likewise ignored — §10.2.

  const { render, collide } = resolveTilesets(d);
  const collision = buildCollision([ground, furniture], width, height, collide);
  const above = tileLayerData(d, 'above', cells, id);
  const strip = (data: number[]): number[] => data.map((gid) => (typeof gid === 'number' ? gid & TILE_ID_MASK : 0));

  return {
    id,
    width,
    height,
    widthPx: width * tileWidth,
    heightPx: height * tileHeight,
    tileWidth,
    tileHeight,
    zones: extractZones(d, id),
    spawns: extractSpawns(d, id),
    collision,
    tilesets: render,
    layers: [
      { name: 'ground', data: strip(ground) },
      { name: 'furniture', data: strip(furniture) },
      { name: 'above', data: strip(above) },
    ],
  };
}

// ---------------------------------------------------------------- browser

/** Browser loader: fetch `/maps/<id>.tmj` and parse. Rejects with a human message (§5.1). */
export async function loadMap(id: string): Promise<GameMapData> {
  const url = `/maps/${encodeURIComponent(id)}.tmj`;
  let text: string;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Map "${id}" not found (${res.status} from ${url})`);
    text = await res.text();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`Map "${id}"`)) throw err;
    throw new Error(`Map "${id}" could not be loaded (${(err as Error).message})`);
  }
  return parseMapData(text, id);
}

// ---------------------------------------------------------------- grid helpers

/** Tile solidity from the collision grid; out-of-bounds is solid. */
export function tileBlocked(map: MapData, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) return true;
  return map.collision[row * map.width + col] === 1;
}

/** Pixel → tile solidity (point lookup). */
export function blockedAtPx(map: MapData, x: number, y: number): boolean {
  return tileBlocked(map, Math.floor(x / map.tileWidth), Math.floor(y / map.tileHeight));
}

/** Spawn point for a round-robin/seeded index: tile-centred pixel position. */
export function spawnPosition(map: MapData, index: number): { x: number; y: number } {
  const spawn = map.spawns[((index % map.spawns.length) + map.spawns.length) % map.spawns.length]!;
  return { x: spawn.x, y: spawn.y };
}

/**
 * Resolve a (flip-stripped) gid to its tileset + 0-based local frame index.
 * Highest firstgid wins (same rule as collision). Returns null for empty
 * tiles and gids outside every tileset — the renderer skips those.
 */
export function resolveGid(map: GameMapData, gid: number): { key: string; frame: number } | null {
  if (!gid) return null;
  let best: RenderTileset | null = null;
  for (const ts of map.tilesets) {
    if (gid >= ts.firstgid && (!best || ts.firstgid > best.firstgid)) best = ts;
  }
  if (!best || gid > best.lastgid) return null;
  return { key: best.key, frame: gid - best.firstgid };
}
