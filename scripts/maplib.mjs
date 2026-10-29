// Shared low-level helpers for the JitsiMap map tooling (SPEC §10).
//
// `validate-maps.mjs` and `render-map-preview.mjs` are built on this module so
// the rules humans, agents and the app all share exactly one implementation.
// Pure ESM, zero dependencies, Node >= 22.
//
// Conventions (skills/jitsimap-map-maker/references/map-schema.md):
//   - Tile layers: flat row-major gid arrays, `data[row * width + col]`, 0 = empty.
//   - gid = tileset.firstgid + local tile id; flip flags live in the high bits.
//   - Collision: tile property `collides` (legacy `Collision`) = true, evaluated
//     on the `ground` + `furniture` layers only.
//   - Objects: pixels, origin top-left.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const TILE_SIZE = 32;

/** Tile layers that must exist (collision is read from ground + furniture). */
export const REQUIRED_TILE_LAYERS = ['ground', 'furniture', 'above'];
/** Object layers that must exist. */
export const REQUIRED_OBJECT_LAYERS = ['spawns', 'zones'];
/** Object layers that may be missing (warning only). */
export const OPTIONAL_OBJECT_LAYERS = ['exits'];

/** Tiled stores flip/transpose flags in the high bits of a gid. */
export const FLIP_FLAGS = 0xf000_0000;
export const TILE_ID_MASK = 0x0fff_ffff;

/** Tiled layer/object property lists → plain object. */
export function parseProperties(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const p of list) {
    if (!p || typeof p.name !== 'string') continue;
    out[p.name] = p.value;
  }
  return out;
}

/**
 * Bool-ish coercion for zone `silent` / `stage` (documented, shared):
 *   true  ← true, "true"/"TRUE", 1, "1", "yes"
 *   false ← false, "false"/"FALSE", 0, "0", "no", null/undefined, ""
 * Anything else is false and reported as `coerced` so the validator can warn.
 * @param {unknown} value
 * @returns {{ value: boolean, coerced: boolean, coercedFrom?: string }}
 */
export function asBool(value) {
  if (value === true || value === false || value === undefined || value === null) {
    return { value: value === true, coerced: false };
  }
  if (typeof value === 'number') {
    if (value === 1) return { value: true, coerced: true, coercedFrom: String(value) };
    if (value === 0) return { value: false, coerced: true, coercedFrom: String(value) };
    return { value: false, coerced: true, coercedFrom: String(value) };
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === 'yes' || v === '1') {
      return { value: true, coerced: v !== 'true', coercedFrom: value };
    }
    if (v === 'false' || v === 'no' || v === '0' || v === '') {
      return { value: false, coerced: v !== 'false' && v !== '', coercedFrom: value };
    }
    return { value: false, coerced: true, coercedFrom: value };
  }
  return { value: false, coerced: true, coercedFrom: String(value) };
}

/**
 * `audibleFrom` is a comma-separated string of zone ids (a JSON list is also
 * accepted, since that is what a hand-written script tends to produce).
 * @param {unknown} value
 * @returns {string[]}
 */
export function asZoneList(value) {
  if (value === undefined || value === null) return [];
  const parts = Array.isArray(value)
    ? value.map((v) => String(v))
    : String(value).split(',');
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Read + JSON-parse a `.tmj`. Throws with the file name on parse failure. */
export async function loadMapDocument(file) {
  const text = await readFile(file, 'utf8');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${/** @type {Error} */ (err).message})`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error(`${file}: JSON is not a Tiled map object`);
  }
  return { doc, dir: path.dirname(path.resolve(file)) };
}

/**
 * Resolve the tilesets a map uses. Embedded tilesets (`image` present) are used
 * as-is; external references (`source`) are read from disk relative to the map.
 * @param {any} doc
 * @param {string} baseDir directory the map file lives in
 * @returns {Promise<Array<{ tileset: any, dir: string, firstgid: number, lastgid: number, source: string }>>}
 */
export async function resolveTilesets(doc, baseDir) {
  const list = Array.isArray(doc.tilesets) ? doc.tilesets : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const firstgid = Number(entry?.firstgid);
    if (!Number.isInteger(firstgid) || firstgid < 1) {
      out.push({ tileset: entry, dir: baseDir, firstgid: NaN, lastgid: NaN, source: `tilesets[${i}]` });
      continue;
    }
    if (typeof entry.source === 'string' && entry.source.length > 0) {
      const sourcePath = path.resolve(baseDir, entry.source);
      /** @type {any} */
      let tileset = entry;
      let dir = baseDir;
      try {
        tileset = JSON.parse(await readFile(sourcePath, 'utf8'));
        dir = path.dirname(sourcePath);
      } catch {
        /* left as the stub: the validator reports the unreadable collection */
      }
      out.push({
        tileset,
        dir,
        firstgid,
        lastgid: firstgid + tileCount(tileset) - 1,
        source: entry.source,
      });
      continue;
    }
    out.push({
      tileset: entry,
      dir: baseDir,
      firstgid,
      lastgid: firstgid + tileCount(entry) - 1,
      source: entry.name ? `embedded:${entry.name}` : `tilesets[${i}]`,
    });
  }
  return out;
}

/** Number of tiles in a tileset (explicit `tilecount`, else from the image grid). */
export function tileCount(tileset) {
  if (!tileset || typeof tileset !== 'object') return 0;
  if (Number.isInteger(tileset.tilecount) && tileset.tilecount > 0) return tileset.tilecount;
  const cols = Number(tileset.columns);
  const rows = Number(tileset.rows);
  if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) return cols * rows;
  return 0;
}

/** Tile properties of one local tile id inside a tileset. */
export function tileProperties(tileset, localId) {
  const tiles = Array.isArray(tileset?.tiles) ? tileset.tiles : [];
  for (const t of tiles) {
    if (Number(t?.id) === localId) return parseProperties(t.properties);
  }
  return {};
}

/**
 * Does the tile with this gid block movement?
 * Accepts `collides` and the legacy spelling `Collision`.
 */
export function gidCollides(resolved, gid) {
  const plain = gid & TILE_ID_MASK;
  for (const set of resolved) {
    if (!Number.isInteger(set.firstgid)) continue;
    if (plain < set.firstgid) continue;
    if (Number.isInteger(set.lastgid) && plain > set.lastgid) continue;
    const props = tileProperties(set.tileset, plain - set.firstgid);
    const raw = props.collides !== undefined ? props.collides : props.Collision;
    return asBool(raw).value;
  }
  return false;
}

/** Find the tileset (and local id) a gid belongs to; null when unknown. */
export function gidOwner(resolved, gid) {
  const plain = gid & TILE_ID_MASK;
  for (const set of resolved) {
    if (!Number.isInteger(set.firstgid)) continue;
    if (plain < set.firstgid) continue;
    if (Number.isInteger(set.lastgid) && plain > set.lastgid) continue;
    return { set, localId: plain - set.firstgid };
  }
  return null;
}

export function layerByName(doc, name) {
  const layers = Array.isArray(doc?.layers) ? doc.layers : [];
  return layers.find((l) => l && l.name === name) ?? null;
}

/**
 * Collision grid of a map: `blocked[row * width + col]`, from the ground and
 * furniture layers. Assumes a parsed map; malformed input yields an all-open
 * grid of the map size (the validator reports the structural problems).
 * @param {any} doc
 * @param {string} baseDir
 * @returns {Promise<{ width: number, height: number, blocked: Uint8Array }>}
 */
export async function collisionGrid(doc, baseDir) {
  const width = Number(doc?.width) || 0;
  const height = Number(doc?.height) || 0;
  const blocked = new Uint8Array(Math.max(0, width * height));
  if (width <= 0 || height <= 0) return { width, height, blocked };
  const resolved = await resolveTilesets(doc, baseDir);
  for (const name of ['ground', 'furniture']) {
    const layer = layerByName(doc, name);
    if (!layer || layer.type !== 'tilelayer' || !Array.isArray(layer.data)) continue;
    for (let i = 0; i < blocked.length; i++) {
      const gid = layer.data[i];
      if (typeof gid === 'number' && gid !== 0 && gidCollides(resolved, gid)) blocked[i] = 1;
    }
  }
  return { width, height, blocked };
}

/** 4-neighbour flood fill over walkable tiles. Returns a visited bitmap. */
export function floodFill(width, height, blocked, startCol, startRow) {
  const seen = new Uint8Array(Math.max(0, width * height));
  if (width <= 0 || height <= 0) return seen;
  if (startCol < 0 || startRow < 0 || startCol >= width || startRow >= height) return seen;
  const start = startRow * width + startCol;
  if (blocked[start]) return seen;
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const idx = /** @type {number} */ (queue[head]);
    const col = idx % width;
    const row = (idx - col) / width;
    const neighbours = [
      col > 0 ? idx - 1 : -1,
      col < width - 1 ? idx + 1 : -1,
      row > 0 ? idx - width : -1,
      row < height - 1 ? idx + width : -1,
    ];
    for (const n of neighbours) {
      if (n < 0 || seen[n] || blocked[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

/** Tiles a zone rectangle covers, clamped to the map, as `[col,row]` pairs. */
export function zoneTileRect(zone, width, height) {
  const col0 = Math.max(0, Math.floor(zone.x / TILE_SIZE));
  const row0 = Math.max(0, Math.floor(zone.y / TILE_SIZE));
  const col1 = Math.min(width - 1, Math.ceil((zone.x + zone.w) / TILE_SIZE) - 1);
  const row1 = Math.min(height - 1, Math.ceil((zone.y + zone.h) / TILE_SIZE) - 1);
  return { col0, row0, col1, row1, valid: col0 <= col1 && row0 <= row1 };
}

/**
 * Zone objects on the `zones` layer, normalised.
 * @returns {{ zones: Array<{ id: string, label: string, silent: boolean, stage: boolean, audibleFrom: string[], x: number, y: number, w: number, h: number, properties: Record<string, any> }>, warnings: string[], errors: string[] }}
 */
export function extractZones(doc) {
  /** @type {string[]} */ const warnings = [];
  /** @type {string[]} */ const errors = [];
  /** @type {any[]} */ const zones = [];
  const layer = layerByName(doc, 'zones');
  const objects = layer && layer.type === 'objectgroup' && Array.isArray(layer.objects) ? layer.objects : [];
  objects.forEach((obj, index) => {
    const props = parseProperties(obj?.properties);
    const where = `zone object #${index + 1}`;
    let id;
    if (typeof props.zone === 'string' && props.zone.trim() !== '') {
      id = props.zone.trim();
    } else if (props.zone !== undefined && props.zone !== null && String(props.zone).trim() !== '') {
      id = String(props.zone).trim();
      warnings.push(`${where}: zone id is not a string (coerced to "${id}")`);
    } else if (typeof obj?.name === 'string' && obj.name.trim() !== '') {
      id = obj.name.trim();
      warnings.push(`${where}: no "zone" property, using the object name "${id}"`);
    } else {
      errors.push(`${where}: missing required "zone" property`);
      return;
    }
    const silent = asBool(props.silent);
    const stage = asBool(props.stage);
    if (silent.coerced) warnings.push(`${where} (${id}): silent="${silent.coercedFrom}" coerced to ${silent.value}`);
    if (stage.coerced) warnings.push(`${where} (${id}): stage="${stage.coercedFrom}" coerced to ${stage.value}`);
    const badGeom = [];
    for (const key of ['x', 'y', 'width', 'height']) {
      const v = obj?.[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) badGeom.push(`${key}=${JSON.stringify(v)}`);
    }
    if (badGeom.length > 0) errors.push(`zone "${id}": non-numeric geometry: ${badGeom.join(', ')}`);
    zones.push({
      id,
      label: typeof props.label === 'string' ? props.label : '',
      silent: silent.value,
      stage: stage.value,
      audibleFrom: asZoneList(props.audibleFrom),
      x: Number(obj.x) || 0,
      y: Number(obj.y) || 0,
      w: Number(obj.width) || 0,
      h: Number(obj.height) || 0,
      properties: props,
    });
  });
  return { zones, warnings, errors };
}

/**
 * Spawn objects on the `spawns` layer, normalised to tile coordinates.
 * @returns {{ spawns: Array<{ id: string, x: number, y: number, col: number, row: number, properties: Record<string, any> }>, warnings: string[] }}
 */
export function extractSpawns(doc) {
  /** @type {string[]} */ const warnings = [];
  /** @type {any[]} */ const spawns = [];
  const layer = layerByName(doc, 'spawns');
  const objects = layer && layer.type === 'objectgroup' && Array.isArray(layer.objects) ? layer.objects : [];
  const width = Number(doc?.width) || 0;
  const height = Number(doc?.height) || 0;
  objects.forEach((obj, index) => {
    const props = parseProperties(obj?.properties);
    const where = `spawn object #${index + 1}`;
    let id;
    if (typeof props.id === 'string' && props.id.trim() !== '') id = props.id.trim();
    else if (typeof obj?.name === 'string' && obj.name.trim() !== '') {
      id = obj.name.trim();
      warnings.push(`${where}: no "id" property, using the object name "${id}"`);
    } else {
      id = `spawn-${index + 1}`;
      warnings.push(`${where}: no "id" property (the app needs one to identify spawns)`);
    }
    const x = Number(obj.x) || 0;
    const y = Number(obj.y) || 0;
    spawns.push({
      id,
      x,
      y,
      col: Math.floor(x / TILE_SIZE),
      row: Math.floor(y / TILE_SIZE),
      properties: props,
    });
    void width;
    void height;
  });
  return { spawns, warnings };
}
