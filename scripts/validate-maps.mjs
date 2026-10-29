#!/usr/bin/env node
// JitsiMap map validator — the shared contract for humans, agents and the app
// (SPEC §10.5). `npm run validate:maps`, or:
//
//   node scripts/validate-maps.mjs                    # all public/maps/*.tmj
//   node scripts/validate-maps.mjs public/maps/x.tmj  # one file
//
// Exits 1 when any map has errors. Warnings are printed and do not fail.
//
// The functions are exported (validateMap / validateMapFile / the extractors in
// scripts/maplib.mjs) so `test/map.test.ts` and the app's loader test the exact
// same rules.
//
// Documented coercions (shared with the app loader):
//   - `silent` / `stage`: true ← true, "true", "yes", 1, "1";
//     false ← false, "false", "no", 0, "0", "" ; anything else is false and is
//     reported as a warning.
//   - `audibleFrom`: a comma-separated string of zone ids (a JSON list also
//     works); entries are trimmed and empties dropped.
//   - Collision: tile property `collides`, legacy spelling `Collision`
//     accepted, from the `ground` + `furniture` layers only.
//   - Unknown tile/object properties and unknown layers are ignored.

import fs from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collisionGrid,
  extractSpawns,
  extractZones,
  FLIP_FLAGS,
  floodFill,
  layerByName,
  loadMapDocument,
  OPTIONAL_OBJECT_LAYERS,
  REQUIRED_OBJECT_LAYERS,
  REQUIRED_TILE_LAYERS,
  resolveTilesets,
  TILE_SIZE,
  zoneTileRect,
} from './maplib.mjs';

/**
 * Validate a parsed `.tmj`.
 * @param {any} obj parsed Tiled JSON
 * @param {{ baseDir?: string }} [options] directory used to resolve tileset images
 *   (the map's own directory). Defaults to the process cwd.
 * @returns {Promise<{ errors: string[], warnings: string[] }>}
 */
export async function validateMap(obj, options = {}) {
  /** @type {string[]} */ const errors = [];
  /** @type {string[]} */ const warnings = [];
  const baseDir = path.resolve(options.baseDir ?? process.cwd());

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { errors: ['JSON is not a Tiled map object'], warnings };
  }

  // --- File basics ---------------------------------------------------------
  if (obj.infinite === true) errors.push('infinite maps are not supported (keep "infinite": false)');
  if (obj.orientation !== 'orthogonal')
    errors.push(`orientation must be "orthogonal", got ${JSON.stringify(obj.orientation)}`);
  if (Number(obj.tilewidth) !== TILE_SIZE || Number(obj.tileheight) !== TILE_SIZE) {
    errors.push(`tile size must be ${TILE_SIZE}x${TILE_SIZE}, got ${obj.tilewidth}x${obj.tileheight}`);
  }
  const width = Number(obj.width);
  const height = Number(obj.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    errors.push(`map size must be positive integers, got ${JSON.stringify(obj.width)}x${JSON.stringify(obj.height)}`);
    return { errors, warnings };
  }

  // --- Layers --------------------------------------------------------------
  if (!Array.isArray(obj.layers)) errors.push('no "layers" array');
  for (const name of REQUIRED_TILE_LAYERS) {
    const layer = layerByName(obj, name);
    if (!layer) {
      errors.push(`missing layer "${name}" (required: ${REQUIRED_TILE_LAYERS.join(', ')})`);
      continue;
    }
    if (layer.type !== 'tilelayer') {
      errors.push(`layer "${name}" must be a tilelayer, got ${JSON.stringify(layer.type)}`);
      continue;
    }
    if (!Array.isArray(layer.data)) {
      errors.push(`tile layer "${name}" has no "data" array`);
      continue;
    }
    if (layer.data.length !== width * height) {
      errors.push(
        `tile layer "${name}" has ${layer.data.length} cells, expected ${width * height} (${width}x${height})`,
      );
    }
  }
  for (const name of REQUIRED_OBJECT_LAYERS) {
    const layer = layerByName(obj, name);
    if (!layer) errors.push(`missing layer "${name}" (required: ${REQUIRED_OBJECT_LAYERS.join(', ')})`);
    else if (layer.type !== 'objectgroup')
      errors.push(`layer "${name}" must be an objectgroup, got ${JSON.stringify(layer.type)}`);
  }
  for (const name of OPTIONAL_OBJECT_LAYERS) {
    const layer = layerByName(obj, name);
    if (!layer) warnings.push(`layer "${name}" is missing (reserved for Phase 2 exits; add an empty object layer)`);
    else if (layer.type !== 'objectgroup')
      warnings.push(`layer "${name}" should be an objectgroup, got ${JSON.stringify(layer.type)}`);
  }

  // --- Tilesets ------------------------------------------------------------
  const resolved = await resolveTilesets(obj, baseDir);
  if (resolved.length === 0) warnings.push('no tilesets: the map has no tiles to paint with');
  for (const set of resolved) {
    const label = set.source;
    if (!Number.isInteger(set.firstgid)) {
      errors.push(`tileset ${label}: missing/invalid "firstgid"`);
      continue;
    }
    const image = set.tileset?.image;
    if (typeof image !== 'string' || image === '') {
      errors.push(`tileset ${label}: no image (embedded tileset image is required in MVP)`);
      continue;
    }
    const file = path.resolve(set.dir, image.replace(/^\.\//, ''));
    if (!fs.existsSync(file)) errors.push(`tileset ${label}: image "${image}" not found (looked for ${file})`);
    const tileCount = Number(set.tileset?.tilecount) || 0;
    if (tileCount > 0 && set.lastgid - set.firstgid + 1 !== tileCount) {
      warnings.push(`tileset ${label}: tilecount ${tileCount} does not match columns x rows`);
    }
  }

  // --- Gid sanity (warnings: the app renders what it can) -------------------
  for (const name of REQUIRED_TILE_LAYERS) {
    const layer = layerByName(obj, name);
    if (!layer || layer.type !== 'tilelayer' || !Array.isArray(layer.data)) continue;
    const known = new Set();
    for (const set of resolved) {
      if (!Number.isInteger(set.firstgid)) continue;
      for (let g = set.firstgid; g <= set.lastgid; g++) known.add(g);
    }
    const unknown = new Set();
    let flipped = 0;
    for (const raw of layer.data) {
      if (typeof raw !== 'number' || raw === 0) continue;
      if (!Number.isInteger(raw) || raw < 0) {
        warnings.push(`tile layer "${name}": non-integer gid ${JSON.stringify(raw)} (the app reads it as empty)`);
        continue;
      }
      if (raw & FLIP_FLAGS) flipped++;
      if (resolved.length > 0 && !known.has(raw & 0x0fff_ffff)) unknown.add(raw & 0x0fff_ffff);
    }
    if (flipped > 0)
      warnings.push(`tile layer "${name}": ${flipped} tile(s) use flip/transpose flags (avoid; copy gids verbatim)`);
    for (const g of unknown) warnings.push(`tile layer "${name}": gid ${g} is not in any tileset (renders as a hole)`);
  }

  // --- Spawns --------------------------------------------------------------
  const { spawns, warnings: spawnWarnings } = extractSpawns(obj);
  warnings.push(...spawnWarnings);
  if (spawns.length === 0) errors.push('no spawn objects on the "spawns" layer (at least 1 is required)');
  const spawnIds = new Map();
  for (const spawn of spawns) {
    if (spawnIds.has(spawn.id)) warnings.push(`duplicate spawn id "${spawn.id}"`);
    spawnIds.set(spawn.id, spawn);
    if (spawn.col < 0 || spawn.row < 0 || spawn.col >= width || spawn.row >= height) {
      errors.push(`spawn "${spawn.id}" is outside the map (tile ${spawn.col},${spawn.row} of ${width}x${height})`);
    }
  }

  // --- Zones ---------------------------------------------------------------
  const { zones, warnings: zoneWarnings, errors: zoneErrors } = extractZones(obj);
  warnings.push(...zoneWarnings);
  errors.push(...zoneErrors);
  const byId = new Map();
  for (const zone of zones) {
    if (byId.has(zone.id)) {
      errors.push(`duplicate zone id "${zone.id}" (zone ids must be unique)`);
      continue;
    }
    byId.set(zone.id, zone);
    if (![zone.x, zone.y, zone.w, zone.h].every((n) => Number.isFinite(n))) {
      errors.push(
        `zone "${zone.id}" has non-numeric geometry (${zone.x},${zone.y} ${zone.w}x${zone.h}); rectangle objects need numeric x/y/width/height`,
      );
      continue;
    }
    if (zone.w <= 0 || zone.h <= 0)
      errors.push(`zone "${zone.id}" has zero size (${zone.w}x${zone.h}); zone objects must be rectangles`);
    if (zone.x < 0 || zone.y < 0 || zone.x + zone.w > width * TILE_SIZE || zone.y + zone.h > height * TILE_SIZE) {
      errors.push(
        `zone "${zone.id}" is outside the map bounds: rect ${zone.x},${zone.y} ${zone.w}x${zone.h} ` +
          `vs map ${width * TILE_SIZE}x${height * TILE_SIZE}`,
      );
    }
    if (zone.x % TILE_SIZE !== 0 || zone.y % TILE_SIZE !== 0 || zone.w % TILE_SIZE !== 0 || zone.h % TILE_SIZE !== 0) {
      warnings.push(`zone "${zone.id}" is not aligned to the ${TILE_SIZE}px tile grid (recommended)`);
    }
    if (zone.audibleFrom.includes(zone.id)) warnings.push(`zone "${zone.id}": audibleFrom lists itself (no effect)`);
    for (const ref of zone.audibleFrom) {
      if (byId.has(ref)) continue;
      if (zones.some((z) => z.id === ref)) continue; // resolves against a later object
      errors.push(`zone "${zone.id}": audibleFrom references unknown zone "${ref}"`);
    }
  }
  const overlapping = [];
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlapping.push(`${a.id}+${b.id}`);
    }
  }
  if (overlapping.length > 0)
    warnings.push(`overlapping zones (${overlapping.join(', ')}); the app uses the first match`);

  // --- Collision + reachability -------------------------------------------
  const { blocked } = await collisionGrid(obj, baseDir);
  const inBounds = (s) => s.col >= 0 && s.row >= 0 && s.col < width && s.row < height;
  const walkable = spawns.filter((s) => inBounds(s) && !blocked[s.row * width + s.col]);
  for (const spawn of spawns) {
    if (inBounds(spawn) && blocked[spawn.row * width + spawn.col]) {
      errors.push(
        `spawn "${spawn.id}" is on a colliding tile (tile ${spawn.col},${spawn.row}) — move it onto walkable floor`,
      );
    }
  }
  if (walkable.length > 0) {
    const start = walkable[0];
    const seen = floodFill(width, height, blocked, start.col, start.row);
    const unreachableSpawns = spawns.filter((s) => inBounds(s) && !seen[s.row * width + s.col]);
    for (const spawn of unreachableSpawns) {
      if (blocked[spawn.row * width + spawn.col]) continue; // already reported
      errors.push(`spawn "${spawn.id}" is not reachable from spawn "${start.id}" (tile ${spawn.col},${spawn.row})`);
    }
    for (const zone of zones) {
      const rect = zoneTileRect(zone, width, height);
      if (!rect.valid) continue; // outside bounds: already an error
      let reachable = false;
      let walkableTiles = 0;
      for (let row = rect.row0; row <= rect.row1; row++) {
        for (let col = rect.col0; col <= rect.col1; col++) {
          const idx = row * width + col;
          if (!blocked[idx]) walkableTiles++;
          if (seen[idx]) reachable = true;
        }
      }
      if (!reachable) {
        errors.push(
          `zone "${zone.id}" is not reachable on foot from spawn "${start.id}" ` +
            `(tiles ${rect.col0},${rect.row0}–${rect.col1},${rect.row1}${walkableTiles === 0 ? '; the zone contains no walkable tiles' : '; no door?'}).`,
        );
      }
    }
    let border = 0;
    for (let col = 0; col < width; col++) {
      if (seen[col]) border++;
      if (seen[(height - 1) * width + col]) border++;
    }
    for (let row = 0; row < height; row++) {
      if (seen[row * width]) border++;
      if (seen[row * width + width - 1]) border++;
    }
    if (border > 0)
      warnings.push(`${border} walkable tile(s) on the map border: avatars can reach the edge (wall the outer ring)`);
  }

  return { errors, warnings };
}

/**
 * Validate a `.tmj` file on disk.
 * @param {string} file
 * @returns {Promise<{ file: string, errors: string[], warnings: string[] }>}
 */
export async function validateMapFile(file) {
  let doc;
  let dir;
  try {
    ({ doc, dir } = await loadMapDocument(file));
  } catch (err) {
    return {
      file,
      errors: [String(err?.message ?? err).replace(/^.*?: /, (m) => (m.includes(file) ? '' : m))],
      warnings: [],
    };
  }
  const { errors, warnings } = await validateMap(doc, { baseDir: dir });
  return { file, errors, warnings };
}

/** All bundled maps: `public/maps/*.tmj`, templates excluded. */
export async function defaultMapFiles() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.join(repoRoot, 'public/maps');
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.tmj'))
    .map((e) => path.join(dir, e.name))
    .sort();
}

export async function main(argv = process.argv.slice(2)) {
  const files = argv.length > 0 ? [path.resolve(argv[0])] : await defaultMapFiles();
  let failed = 0;
  let warned = 0;
  for (const file of files) {
    const { errors, warnings } = await validateMapFile(file);
    const shown = path.relative(process.cwd(), file) || file;
    for (const message of errors) console.log(`${shown}: error: ${message}`);
    for (const message of warnings) console.log(`${shown}: warning: ${message}`);
    if (errors.length > 0) failed++;
    else if (warnings.length > 0) warned++;
    else console.log(`${shown}: OK`);
  }
  const noun = files.length === 1 ? 'map' : 'maps';
  if (failed > 0) {
    console.log(`${failed}/${files.length} ${noun} failed validation`);
    return 1;
  }
  console.log(`${files.length} ${noun} valid${warned > 0 ? ` (${warned} with warnings)` : ''}`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(String(err?.message ?? err));
      process.exitCode = 1;
    });
}
