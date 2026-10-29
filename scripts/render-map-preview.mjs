#!/usr/bin/env node
// Map preview renderer for JitsiMap (SPEC §10.5, `npm run preview:map`).
//
//   node scripts/render-map-preview.mjs <map.tmj> [-o out.png] [--scale N]
//
// Composites the ground / furniture / above tile layers (tile alpha honoured),
// then draws zone rectangles (translucent magenta fill + outline + label) and
// green spawn crosses, and writes an RGB PNG. Zero dependencies: the PNG is
// written by scripts/png.mjs and text uses the 5x7 bitmap font embedded below.
//
// Default output: <mapdir>/previews/<mapname>.png

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePngRgb } from './png.mjs';
import { gidOwner, loadMapDocument, resolveTilesets, layerByName, extractZones, extractSpawns, TILE_SIZE } from './maplib.mjs';

// ---------------------------------------------------------------- 5x7 font
// A-Z 0-9 '-' '_' ' ' (row 0 = top). '#' = lit pixel. Unknown characters are
// rendered as a small box so typos in labels stay visible.
const FONT = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '(': ['..##.', '.#...', '#....', '#....', '#....', '.#...', '..##.'],
  ')': ['.##..', '...#.', '....#', '....#', '....#', '...#.', '.##..'],
};
const UNKNOWN_GLYPH = ['#####', '#...#', '#.#.#', '#...#', '#.#.#', '#...#', '#####'];

export const GLYPH_W = 5;
export const GLYPH_H = 7;

// ---------------------------------------------------------------- canvas

/** Tiny RGB canvas: Float-free, integer maths, alpha blending by hand. */
function createCanvas(width, height, rgb) {
  const data = new Uint8ClampedArray(width * height * 3);
  if (rgb) data.set(rgb);
  return {
    width,
    height,
    data,
    set(x, y, r, g, b) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 3;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    },
    blend(x, y, r, g, b, a) {
      if (a >= 255) return this.set(x, y, r, g, b);
      if (a <= 0 || x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 3;
      data[i] = (data[i] * (255 - a) + r * a) >> 8;
      data[i + 1] = (data[i + 1] * (255 - a) + g * a) >> 8;
      data[i + 2] = (data[i + 2] * (255 - a) + b * a) >> 8;
    },
    fillRect(x, y, w, h, r, g, b, a = 255) {
      for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) this.blend(col, row, r, g, b, a);
    },
    strokeRect(x, y, w, h, t, r, g, b, a = 255) {
      this.fillRect(x, y, w, t, r, g, b, a);
      this.fillRect(x, y + h - t, w, t, r, g, b, a);
      this.fillRect(x, y, t, h, r, g, b, a);
      this.fillRect(x + w - t, y, t, h, r, g, b, a);
    },
  };
}

/** Draw text (top-left anchored). Returns the advance in pixels. */
export function drawText(canvas, text, x, y, scale = 1, color = [255, 255, 255]) {
  const chars = String(text).toUpperCase().split('');
  const step = (GLYPH_W + 1) * scale;
  for (const pass of [0, 1]) {
    const c = pass === 0 ? [0, 0, 0] : color;
    const dx = pass === 0 ? scale : 0;
    const dy = pass === 0 ? scale : 0;
    chars.forEach((ch, i) => {
      const glyph = FONT[ch] ?? UNKNOWN_GLYPH;
      const ox = x + i * step + dx;
      const oy = y + dy;
      for (let row = 0; row < GLYPH_H; row++) {
        const line = glyph[row] ?? '.....';
        for (let col = 0; col < GLYPH_W; col++) {
          if (line[col] !== '#') continue;
          canvas.fillRect(ox + col * scale, oy + row * scale, scale, scale, c[0], c[1], c[2]);
        }
      }
    });
  }
  return chars.length * step;
}

// ---------------------------------------------------------------- tiles

/** Load every tileset image and decode it into RGBA. */
async function loadTilesetImages(resolved) {
  const cache = new Map();
  for (const set of resolved) {
    const image = set.tileset?.image;
    if (typeof image !== 'string' || cache.has(image)) continue;
    const file = path.resolve(set.dir, image.replace(/^\.\//, ''));
    try {
      cache.set(image, { file, img: decodePng(await readFile(file)) });
    } catch (err) {
      console.warn(`warning: tileset image "${image}" could not be read (${/** @type {Error} */ (err).message}); rendering placeholders`);
      cache.set(image, null);
    }
  }
  return cache;
}

function blitTile(canvas, img, sx, sy, sw, sh, dx, dy, scale) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const src = ((sy + y) * img.width + (sx + x)) * 4;
      const a = img.data[src + 3];
      if (a === 0) continue;
      const r = img.data[src];
      const g = img.data[src + 1];
      const b = img.data[src + 2];
      if (scale === 1) canvas.blend(dx, dy, r, g, b, a);
      else canvas.fillRect(dx + x * scale, dy + y * scale, scale, scale, r, g, b, a);
    }
  }
}

/** Paint one tile layer onto the canvas. */
function drawTileLayer(canvas, doc, layer, resolved, images, scale) {
  const ts = Number(doc.tilewidth) || TILE_SIZE;
  const th = Number(doc.tileheight) || TILE_SIZE;
  const data = Array.isArray(layer.data) ? layer.data : [];
  for (let row = 0; row < Number(doc.height); row++) {
    for (let col = 0; col < Number(doc.width); col++) {
      const gid = data[row * Number(doc.width) + col];
      if (!gid) continue;
      const owner = gidOwner(resolved, gid);
      if (!owner) continue;
      const set = owner.set;
      const decoded = images.get(set.tileset.image);
      const cell = Number(set.tileset.tileheight) || th;
      const cellW = Number(set.tileset.tilewidth) || ts;
      const spacing = Number(set.tileset.spacing) || 0;
      const margin = Number(set.tileset.margin) || 0;
      const columns = Number(set.tileset.columns) || 1;
      const tx = margin + (owner.localId % columns) * (cellW + spacing);
      const ty = margin + Math.floor(owner.localId / columns) * (cell + spacing);
      const px = col * ts * scale;
      const py = row * th * scale;
      if (!decoded) {
        // Unknown tile: bright checker so it cannot be missed.
        for (let y = 0; y < th * scale; y += 8) {
          for (let x = 0; x < ts * scale; x += 8) {
            if (((x + y) / 8) % 2 === 0) canvas.fillRect(px + x, py + y, 8, 8, 255, 0, 255);
          }
        }
        continue;
      }
      const { img } = decoded;
      blitTile(canvas, img, tx, ty, Math.min(cellW, img.width - tx), Math.min(cell, img.height - ty), px, py, scale);
    }
  }
}

// ---------------------------------------------------------------- render

/**
 * Render a parsed map to an RGB buffer.
 * @param {any} doc parsed `.tmj`
 * @param {string} baseDir directory of the map (for tileset images)
 * @param {{ scale?: number }} [options]
 * @returns {Promise<{ width: number, height: number, rgb: Uint8Array, warnings: string[] }>}
 */
export async function renderMap(doc, baseDir, options = {}) {
  const scale = options.scale ?? 2;
  const warnings = [];
  const width = Number(doc.width);
  const height = Number(doc.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('map has no usable width/height');
  }
  const ts = Number(doc.tilewidth) || TILE_SIZE;
  const th = Number(doc.tileheight) || TILE_SIZE;
  const canvas = createCanvas(width * ts * scale, height * th * scale);
  canvas.fillRect(0, 0, canvas.width, canvas.height, 26, 26, 32);

  const resolved = await resolveTilesets(doc, baseDir);
  const images = await loadTilesetImages(resolved);

  for (const name of ['ground', 'furniture', 'above']) {
    const layer = layerByName(doc, name);
    if (!layer || layer.type !== 'tilelayer') {
      warnings.push(`layer "${name}" not found (skipped in preview)`);
      continue;
    }
    drawTileLayer(canvas, doc, layer, resolved, images, scale);
  }

  // Zones: translucent magenta fill, outline, label.
  const { zones, warnings: zoneWarnings, errors } = extractZones(doc);
  warnings.push(...zoneWarnings, ...errors);
  for (const zone of zones) {
    const x = Math.round(zone.x * scale);
    const y = Math.round(zone.y * scale);
    const w = Math.round(zone.w * scale);
    const h = Math.round(zone.h * scale);
    const alpha = zone.silent ? 46 : 30;
    canvas.fillRect(x, y, w, h, 255, 0, 255, alpha);
    canvas.strokeRect(x, y, w, h, 2 * scale, 255, 0, 255, 220);
    const label = zone.label || zone.id;
    const tags = [zone.silent ? 'SILENT' : '', zone.stage ? 'STAGE' : ''].filter(Boolean).join(' ');
    const text = tags ? `${label} (${tags})` : label;
    const tw = text.length * (GLYPH_W + 1) * scale + 2 * scale;
    canvas.fillRect(x + 2 * scale, y + 2 * scale, tw, GLYPH_H * scale + 4 * scale, 20, 8, 24, 190);
    drawText(canvas, text, x + 3 * scale, y + 3 * scale, scale, [255, 235, 255]);
  }

  // Spawns: green cross.
  const { spawns, warnings: spawnWarnings } = extractSpawns(doc);
  warnings.push(...spawnWarnings);
  for (const spawn of spawns) {
    const cx = Math.round((spawn.x / ts) * ts * scale);
    const cy = Math.round((spawn.y / th) * th * scale);
    const r = Math.round(ts * scale * 0.32);
    const t = Math.max(2, Math.round(ts * scale * 0.1));
    canvas.fillRect(cx - t / 2 - r, cy - t / 2, r * 2 + t, t, 0, 0, 0, 200);
    canvas.fillRect(cx - t / 2, cy - t / 2 - r, t, r * 2 + t, 0, 0, 0, 200);
    canvas.fillRect(cx - t / 2 - r + 1, cy - t / 2 + 1, r * 2 + t - 2, t - 2, 40, 220, 60, 255);
    canvas.fillRect(cx - t / 2 + 1, cy - t / 2 - r + 1, t - 2, r * 2 + t - 2, 40, 220, 60, 255);
    drawText(canvas, spawn.id, cx + r + 3 * scale, cy - GLYPH_H * scale / 2, scale, [180, 255, 190]);
  }

  return { width: canvas.width, height: canvas.height, rgb: canvas.data, warnings };
}

// ---------------------------------------------------------------- CLI

function usage() {
  console.log('usage: node scripts/render-map-preview.mjs <map.tmj> [-o out.png] [--scale N]');
}

export async function main(argv = process.argv.slice(2)) {
  const args = argv.slice();
  let mapFile = null;
  let outFile = null;
  let scale = 2;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-o' || arg === '--out') outFile = args[++i] ?? null;
    else if (arg === '--scale') scale = Number(args[++i]) || 2;
    else if (arg === '-h' || arg === '--help') {
      usage();
      return 0;
    } else if (!arg.startsWith('-') && mapFile === null) mapFile = arg;
    else {
      console.error(`unexpected argument: ${arg}`);
      usage();
      return 2;
    }
  }
  if (!mapFile) {
    usage();
    return 2;
  }
  scale = Math.max(1, Math.min(8, Math.round(scale)));
  const { doc, dir } = await loadMapDocument(mapFile);
  const { width, height, rgb, warnings } = await renderMap(doc, dir, { scale });
  for (const w of warnings) console.warn(`${mapFile}: warning: ${w}`);
  const target = outFile ? path.resolve(outFile) : path.join(dir, 'previews', `${path.basename(mapFile, path.extname(mapFile))}.png`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, encodePngRgb(width, height, Buffer.from(rgb)));
  console.log(`${mapFile}: wrote ${target} (${width}x${height})`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(String(/** @type {Error} */ (err).message ?? err));
    process.exitCode = 1;
  });
}
