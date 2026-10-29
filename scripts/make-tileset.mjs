#!/usr/bin/env node
// Build the bundled JitsiMap tileset from a Kenney sheet (SPEC §10.3).
//
//   node scripts/make-tileset.mjs <source-sheet.png> [--out <png>]
//        [--tile 16] [--scale 2] [--cols 12]
//
// JitsiMap maps are a 32x32 grid (SPEC §10.1), Kenney's Tiny series ships
// 16x16 tiles, so this performs an exact nearest-neighbour upscale
// (integer factor) using scripts/png.mjs — no image libraries.
//
// Provenance is recorded in public/maps/CREDITS.md. The tileset's `collides`
// tile properties are authored in the maps themselves (embedded tileset), see
// scripts/make-starter-map.mjs.
//
// Fallback (no network / no suitable pack): `--generate-flat <name>` writes a
// hand-coloured 32x32 strip (floors, walls, door, furniture) in the same style
// the validator/preview expect, so tooling keeps working offline.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePngRgb } from './png.mjs';

/**
 * Nearest-neighbour upscale of an RGBA image by an integer factor.
 * @param {{ width: number, height: number, data: Buffer }} img
 * @param {number} factor
 */
export function scaleNearest(img, factor) {
  if (!Number.isInteger(factor) || factor < 1) throw new Error(`scaleNearest: factor must be a positive integer, got ${factor}`);
  const width = img.width * factor;
  const height = img.height * factor;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcY = Math.floor(y / factor);
    for (let x = 0; x < width; x++) {
      const srcX = Math.floor(x / factor);
      const s = (srcY * img.width + srcX) * 4;
      const d = (y * width + x) * 4;
      data[d] = img.data[s];
      data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2];
      data[d + 3] = img.data[s + 3];
    }
  }
  return { width, height, data };
}

/** RGBA buffer → RGB buffer (the PNG encoder writes truecolor RGB). */
function rgbaToRgb(data, width, height) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    rgb[j] = data[i * 4];
    rgb[j + 1] = data[i * 4 + 1];
    rgb[j + 2] = data[i * 4 + 2];
  }
  return rgb;
}

/** RGBA buffer helpers for the flat fallback generator. */
function putPixel(data, width, x, y, [r, g, b, a = 255]) {
  const i = (y * width + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
}
function fillRect(data, width, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) putPixel(data, width, x, y, color);
}

const FLAT_TILES = [
  { name: 'floor-1', colors: ['#d9b38c', '#d2a87f'] },
  { name: 'floor-2', colors: ['#d6ad84', '#cfa478'] },
  { name: 'floor-wood', colors: ['#a9743f', '#9c6a39'] },
  { name: 'floor-wood-2', colors: ['#b07b45', '#a4713d'] },
  { name: 'floor-brick', colors: ['#8f8f9c', '#85858f'] },
  { name: 'rug', colors: ['#8e3b57', '#843650'] },
  { name: 'wall', colors: ['#5c5c6b', '#4e4e5b'] },
  { name: 'wall-2', colors: ['#6a6a79', '#585866'] },
  { name: 'wall-3', colors: ['#51515f', '#45454f'] },
  { name: 'door', colors: ['#7d4a24', '#8f5629'] },
  { name: 'table', colors: ['#7a5230', '#8a5d38'] },
  { name: 'plant', colors: ['#3f8f4f', '#357a44'] },
  { name: 'shelf', colors: ['#6b4a2a', '#7a5531'] },
  { name: 'chalkboard', colors: ['#25423a', '#2e5047'] },
  { name: 'rug-hall', colors: ['#3f5d8f', '#395482'] },
];

/** Flat, readable fallback tileset: one 32x32 tile per entry, `--cols` wide. */
export function makeFlatTileset(cols = 5) {
  const size = 32;
  const rows = Math.ceil(FLAT_TILES.length / cols);
  const width = cols * size;
  const height = rows * size;
  const data = Buffer.alloc(width * height * 4);
  FLAT_TILES.forEach((tile, index) => {
    const ox = (index % cols) * size;
    const oy = Math.floor(index / cols) * size;
    const [base, alt] = tile.colors;
    const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    fillRect(data, width, ox, oy, size, size, rgb(base));
    // Subtle checker so tiles read as tiles, plus a 1px darker edge.
    for (let y = 0; y < size; y += 8) for (let x = 0; x < size; x += 8) {
      if (((x + y) / 8) % 2 === 0) fillRect(data, width, ox + x, oy + y, 8, 8, rgb(alt));
    }
    fillRect(data, width, ox, oy, size, 1, [0, 0, 0, 60]);
    fillRect(data, width, ox, oy + size - 1, size, 1, [0, 0, 0, 60]);
  });
  return { width, height, data, names: FLAT_TILES.map((t) => t.name) };
}

function usage() {
  console.log(
    'usage: node scripts/make-tileset.mjs <source-sheet.png> [--out <png>] [--tile 16] [--scale 2]\n' +
      '       node scripts/make-tileset.mjs --generate-flat <name> [--out <png>] [--cols 5]'
  );
}

export async function main(argv = process.argv.slice(2)) {
  const args = argv.slice();
  let src = null;
  let out = null;
  let tile = 16;
  let scale = 2;
  let cols = 5;
  let flat = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out' || a === '-o') out = args[++i] ?? null;
    else if (a === '--tile') tile = Number(args[++i]);
    else if (a === '--scale') scale = Number(args[++i]);
    else if (a === '--cols') cols = Number(args[++i]);
    else if (a === '--generate-flat') flat = args[++i] ?? 'interior';
    else if (a === '-h' || a === '--help') {
      usage();
      return 0;
    } else if (!a.startsWith('-')) src = a;
    else {
      console.error(`unknown argument: ${a}`);
      usage();
      return 2;
    }
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (flat) {
    const { width, height, data, names } = makeFlatTileset(cols);
    const target = out ? path.resolve(out) : path.join(repoRoot, 'public/maps/tilesets', `${flat}.png`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, encodePngRgb(width, height, rgbaToRgb(data, width, height)));
    console.log(`${target}: ${width}x${height}, ${names.length} flat tiles (local ids 0..${names.length - 1})`);
    return 0;
  }

  if (!src) {
    usage();
    return 2;
  }
  const img = decodePng(await readFile(src));
  if (img.width % tile !== 0 || img.height % tile !== 0) {
    throw new Error(`${src}: ${img.width}x${img.height} is not a whole number of ${tile}px tiles`);
  }
  const scaled = scale === 1 ? img : scaleNearest(img, scale);
  const outTile = tile * scale;
  if (outTile !== 32) console.warn(`note: tiles are ${outTile}px, maps require 32px (SPEC §10.1)`);
  const target = out ? path.resolve(out) : path.join(repoRoot, 'public/maps/tilesets', path.basename(src, path.extname(src)) + '.png');
  await mkdir(path.dirname(target), { recursive: true });

  // Drop the alpha channel: the tile sheet is opaque, and the encoder writes RGB.
  const rgb = rgbaToRgb(scaled.data, scaled.width, scaled.height);
  await writeFile(target, encodePngRgb(scaled.width, scaled.height, rgb));
  console.log(
    `${target}: ${scaled.width}x${scaled.height}, ${scaled.width / 32}x${scaled.height / 32} tiles of 32px` +
      ` (from ${img.width}x${img.height} ${tile}px tiles, ${scale}x nearest-neighbour)`
  );
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(String(err?.message ?? err));
    process.exitCode = 1;
  });
}
