#!/usr/bin/env node
// Generates the bundled JitsiMap maps (SPEC §10.4, §10.5):
//
//   public/maps/office.tmj             the starter map (~40x30)
//   public/maps/templates/blank.tmj    the template new maps start from
//
// Maps are generated, never hand-written: tile arrays are long row-major gid
// lists (skills/jitsimap-map-maker/references/map-schema.md), so this script is
// the editable source of truth. Edit the layout below and re-run:
//
//   node scripts/make-starter-map.mjs
//
// Tile ids are the local ids of public/maps/tilesets/tiny-dungeon.png
// (12 columns of 32px tiles); gids = firstgid + local id. Names + index map in
// public/maps/CREDITS.md.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TILE_SIZE = 32;
export const SHEET_COLUMNS = 12;
export const TILESET_NAME = 'tiny-dungeon';
export const FIRSTGID = 1;

/** name → local tile id in the Tiny Dungeon sheet. */
export const TILES = {
  'floor-1': 48,
  'floor-2': 49,
  'floor-dark-1': 0,
  'floor-dark-2': 12,
  'floor-planks-1': 36,
  'floor-planks-2': 37,
  'floor-planks-3': 39,
  'floor-mat': 31,
  rug: 30,
  wall: 40,
  'wall-2': 14,
  'wall-3': 58,
  'wall-window': 16,
  door: 46,
  table: 54,
  'table-2': 55,
  chair: 73,
  shelf: 75,
  'shelf-2': 63,
  'shelf-3': 41,
  planter: 44,
  barrel: 68,
  crate: 70,
  banner: 29,
};

/** Tiles that block movement. Painted on `ground` or `furniture` (SPEC §10.2). */
export const COLLIDING_TILES = [
  'wall',
  'wall-2',
  'wall-3',
  'wall-window',
  'table',
  'table-2',
  'shelf',
  'shelf-2',
  'shelf-3',
  'planter',
  'barrel',
  'crate',
  'banner',
];

/** Human-readable index map for CREDITS.md (derived from TILES). */
export function tileIndexMap() {
  return Object.entries(TILES).map(([name, id]) => ({
    name,
    id,
    gid: FIRSTGID + id,
    col: id % SHEET_COLUMNS,
    row: Math.floor(id / SHEET_COLUMNS),
    collides: COLLIDING_TILES.includes(name),
  }));
}

/** gid for a named tile. */
export function gid(name) {
  const id = TILES[name];
  if (id === undefined) throw new Error(`unknown tile name "${name}"`);
  return FIRSTGID + id;
}

/** Embedded tileset object, as Tiled exports it (SPEC §10.1). */
export function tileset(image) {
  return {
    columns: SHEET_COLUMNS,
    firstgid: FIRSTGID,
    image,
    imagewidth: 384,
    imageheight: 352,
    margin: 0,
    name: TILESET_NAME,
    spacing: 0,
    tilecount: SHEET_COLUMNS * 11,
    tileheight: TILE_SIZE,
    tilewidth: TILE_SIZE,
    transparentcolor: '#ff00ff',
    type: 'tileset',
    version: '1.10',
    tiles: COLLIDING_TILES.map((name) => ({
      id: TILES[name],
      properties: [{ name: 'collides', type: 'bool', value: true }],
      type: name.startsWith('wall') ? 'wall' : name,
    })),
  };
}

/** Empty map document with the six required layers (SPEC §10.2). */
export function emptyMap(width, height, { image }) {
  const tileLayer = (id, name) => ({
    id,
    name,
    type: 'tilelayer',
    width,
    height,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data: new Array(width * height).fill(0),
  });
  const objectLayer = (id, name) => ({
    id,
    name,
    type: 'objectgroup',
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    objects: [],
  });
  return {
    type: 'map',
    version: '1.10',
    tiledVersion: 110,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width,
    height,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    nextlayerid: 7,
    nextobjectid: 1,
    layers: [
      tileLayer(1, 'ground'),
      tileLayer(2, 'furniture'),
      tileLayer(3, 'above'),
      objectLayer(4, 'spawns'),
      objectLayer(5, 'zones'),
      objectLayer(6, 'exits'),
    ],
    tilesets: [tileset(image)],
  };
}

/** Painting/viewing helpers over a map document. */
export function paint(map) {
  const layer = (name) => {
    const l = map.layers.find((x) => x.name === name);
    if (!l) throw new Error(`missing layer ${name}`);
    return l;
  };
  const set = (name, col, row, tileName) => {
    if (col < 0 || row < 0 || col >= map.width || row >= map.height) {
      throw new Error(`paint(${name}) out of bounds: ${col},${row}`);
    }
    layer(name).data[row * map.width + col] = tileName === null ? 0 : gid(tileName);
  };
  return {
    layer,
    set,
    ground: (col, row, tileName) => set('ground', col, row, tileName),
    furniture: (col, row, tileName) => set('furniture', col, row, tileName),
    /** Inclusive rectangle fill. */
    fill(layerName, col0, row0, col1, row1, tileName) {
      for (let row = row0; row <= row1; row++)
        for (let col = col0; col <= col1; col++) set(layerName, col, row, tileName);
    },
    /** Wall rectangle: every cell on the perimeter (inclusive coordinates). */
    wallRect(col0, row0, col1, row1, tileName = 'wall') {
      for (let col = col0; col <= col1; col++) {
        set('ground', col, row0, tileName);
        set('ground', col, row1, tileName);
      }
      for (let row = row0; row <= row1; row++) {
        set('ground', col0, row, tileName);
        set('ground', col1, row, tileName);
      }
    },
    addObject(layerName, obj) {
      const target = layer(layerName);
      const id = map.nextobjectid++;
      const props = Object.entries(obj.props ?? {}).map(([name, value]) => ({
        name,
        type: typeof value === 'boolean' ? 'bool' : 'string',
        value,
      }));
      target.objects.push({
        id,
        name: obj.name ?? '',
        type: obj.type ?? '',
        x: obj.x,
        y: obj.y,
        width: obj.width ?? 0,
        height: obj.height ?? 0,
        rotation: 0,
        visible: true,
        ...(obj.point ? { point: true } : {}),
        ...(Object.keys(props).length ? { properties: props } : {}),
      });
      return id;
    },
    /** Spawn point at the centre of a tile. */
    spawn(id, col, row) {
      return this.addObject('spawns', {
        name: id,
        x: col * TILE_SIZE + TILE_SIZE / 2,
        y: row * TILE_SIZE + TILE_SIZE / 2,
        point: true,
        props: { id },
      });
    },
    /** Zone rectangle from tile coordinates (inclusive, converted to pixels). */
    zone(id, col0, row0, col1, row1, props = {}) {
      return this.addObject('zones', {
        name: id,
        x: col0 * TILE_SIZE,
        y: row0 * TILE_SIZE,
        width: (col1 - col0 + 1) * TILE_SIZE,
        height: (row1 - row0 + 1) * TILE_SIZE,
        props: { zone: id, ...props },
      });
    },
  };
}

/** Deterministic pseudo-random 0/1 for floor speckling (stable across runs). */
function speckle(col, row) {
  const h = (col * 73856093) ^ (row * 19349663);
  return (h >>> 3) % 7 === 0;
}

/** Paint plain floor across the whole map. */
function floorEverything(p, width, height, base = 'floor-1', alt = 'floor-2') {
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) p.ground(col, row, speckle(col, row) ? alt : base);
  }
}

/** Outer wall ring so nobody walks off the map. */
function outerWalls(p, width, height) {
  for (let col = 0; col < width; col++) {
    p.ground(col, 0, 'wall');
    p.ground(col, height - 1, 'wall');
  }
  for (let row = 0; row < height; row++) {
    p.ground(0, row, 'wall');
    p.ground(width - 1, row, 'wall');
  }
  p.ground(0, 0, 'wall-2');
  p.ground(width - 1, 0, 'wall-2');
  p.ground(0, height - 1, 'wall-2');
  p.ground(width - 1, height - 1, 'wall-2');
}

/**
 * Enclosed room: walls on `ground`, floor inside, 2-tile door in one wall.
 * `side` is the wall the door sits in: 'north' | 'south' | 'west' | 'east';
 * `doorAt` is the first tile (col for north/south, row for west/east).
 */
function room(p, { col0, row0, col1, row1, side, doorAt, floor = 'floor-dark-1', alt = 'floor-dark-2' }) {
  p.wallRect(col0, row0, col1, row1, 'wall');
  for (let row = row0 + 1; row <= row1 - 1; row++) {
    for (let col = col0 + 1; col <= col1 - 1; col++) p.ground(col, row, speckle(col, row) ? alt : floor);
  }
  if (side === 'north') for (let i = 0; i < 2; i++) p.ground(doorAt + i, row0, 'door');
  if (side === 'south') for (let i = 0; i < 2; i++) p.ground(doorAt + i, row1, 'door');
  if (side === 'west') for (let i = 0; i < 2; i++) p.ground(col0, doorAt + i, 'door');
  if (side === 'east') for (let i = 0; i < 2; i++) p.ground(col1, doorAt + i, 'door');
}

/** Table block with chairs around it, centred so lanes stay ≥2 tiles wide. */
function tableWithChairs(p, col0, row0, w, h) {
  for (let row = row0; row < row0 + h; row++) {
    for (let col = col0; col < col0 + w; col++) p.furniture(col, row, (col + row) % 2 === 0 ? 'table' : 'table-2');
  }
  for (let col = col0; col < col0 + w; col++) {
    p.furniture(col, row0 - 1, 'chair');
    p.furniture(col, row0 + h, 'chair');
  }
}

/** The starter map: SPEC §10.4. */
export function buildOffice() {
  const width = 40;
  const height = 30;
  const map = emptyMap(width, height, { image: 'tilesets/tiny-dungeon.png' });
  const p = paint(map);

  floorEverything(p, width, height);
  outerWalls(p, width, height);

  // --- Rooms (walls on `ground`, doors are walkable door tiles) -------------
  room(p, { col0: 1, row0: 1, col1: 11, row1: 9, side: 'south', doorAt: 5 }); // breakout-1
  room(p, { col0: 26, row0: 1, col1: 36, row1: 9, side: 'south', doorAt: 30 }); // breakout-2
  room(p, { col0: 1, row0: 20, col1: 11, row1: 28, side: 'north', doorAt: 5 }); // breakout-3
  room(p, { col0: 16, row0: 1, col1: 20, row1: 5, side: 'south', doorAt: 18, floor: 'rug', alt: 'rug' }); // silent nook

  // --- Hall floor accents ---------------------------------------------------
  // Plank landings outside the three north doors, and in front of the stage.
  p.fill('ground', 12, 6, 15, 10, 'floor-planks-1');
  p.fill('ground', 21, 6, 25, 10, 'floor-planks-2');
  p.fill('ground', 16, 11, 24, 13, 'floor-planks-3');
  // Stage: a plank platform, bottom-right strip, open to the hall. The front
  // row is the stone "step" tile so the platform reads as raised.
  p.fill('ground', 20, 22, 37, 28, 'floor-planks-2');
  p.fill('ground', 20, 22, 37, 22, 'floor-mat');
  p.fill('ground', 19, 22, 19, 28, 'floor-mat');
  // Rugs marking the two hall seating corners.
  p.fill('ground', 13, 15, 15, 16, 'rug');
  p.fill('ground', 33, 15, 35, 16, 'rug');
  // A plank walkway from the hall to the stage step.
  p.fill('ground', 19, 14, 20, 21, 'floor-planks-1');

  // --- Furniture ------------------------------------------------------------
  // Breakout tables (3x2) with chairs.
  tableWithChairs(p, 5, 4, 3, 2); // breakout-1 (door lands on cols 5-6 below)
  tableWithChairs(p, 30, 4, 3, 2); // breakout-2
  tableWithChairs(p, 5, 24, 3, 2); // breakout-3 (door lands on cols 5-6 above)
  // Shelves + storage along the hall walls.
  for (const col of [22, 23, 24]) p.furniture(col, 2, 'shelf');
  for (const col of [22, 23, 24]) p.furniture(col, 3, 'crate');
  p.furniture(13, 2, 'shelf-2');
  p.furniture(14, 2, 'shelf-2');
  p.furniture(37, 11, 'shelf-3');
  p.furniture(37, 12, 'shelf-3');
  // Hall seating: small tables with chairs, on the rugs.
  p.furniture(14, 15, 'table');
  p.furniture(34, 15, 'table');
  p.furniture(13, 16, 'chair');
  p.furniture(15, 16, 'chair');
  p.furniture(33, 16, 'chair');
  p.furniture(35, 16, 'chair');
  p.furniture(17, 16, 'table');
  p.furniture(17, 17, 'chair');
  // Silent nook: two chairs and a plant on the rug, door tiles kept clear.
  p.furniture(17, 2, 'chair');
  p.furniture(19, 2, 'chair');
  p.furniture(18, 4, 'chair');
  p.furniture(17, 4, 'planter');
  // West hall: a reading corner with a table, and props along the walls.
  p.furniture(5, 14, 'table');
  p.furniture(4, 15, 'chair');
  p.furniture(6, 15, 'chair');
  p.furniture(5, 16, 'chair');
  p.furniture(7, 12, 'shelf-2');
  p.furniture(8, 12, 'shelf-2');
  p.furniture(9, 17, 'crate');
  p.furniture(10, 17, 'crate');
  // Stage furniture: presenter table behind the step, banner on the south wall.
  p.furniture(28, 24, 'table');
  p.furniture(29, 24, 'table');
  p.furniture(28, 23, 'chair');
  p.furniture(29, 25, 'chair');
  for (const col of [24, 25, 26]) p.furniture(col, 21, 'banner');
  // Plants, clear of walking lanes and doors.
  for (const [col, row] of [
    [2, 11],
    [10, 11],
    [12, 12],
    [25, 11],
    [16, 21],
    [36, 20],
    [30, 20],
    [13, 28],
    [18, 28],
  ]) {
    p.furniture(col, row, 'planter');
  }
  // Barrels in the west alcove (decor, colliding).
  p.furniture(2, 28, 'barrel');
  p.furniture(3, 28, 'barrel');

  // --- Zones (SPEC §10.2 / §8.3) -------------------------------------------
  // Hall = the open floor between the north rooms and the stage.
  p.zone('hall', 1, 10, 38, 19, { label: 'Hall' });
  p.zone('breakout-1', 1, 1, 11, 9, { label: 'Breakout 1' });
  p.zone('breakout-2', 26, 1, 36, 9, { label: 'Breakout 2' });
  p.zone('breakout-3', 1, 20, 11, 28, { label: 'Breakout 3' });
  p.zone('silent-nook', 16, 1, 20, 5, { label: 'Silent nook', silent: true });
  p.zone('stage', 20, 22, 37, 28, { label: 'Stage', stage: true, audibleFrom: 'hall' });

  // --- Spawns: three points in the hall, clear of furniture -----------------
  p.spawn('main-door', 20, 14);
  p.spawn('hall-west', 14, 12);
  p.spawn('hall-east', 32, 13);

  return map;
}

/** The blank template (SPEC §10.5): correct layers, one floor, one spawn. */
export function buildBlankTemplate() {
  const width = 20;
  const height = 15;
  const map = emptyMap(width, height, { image: '../tilesets/tiny-dungeon.png' });
  const p = paint(map);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) p.ground(col, row, 'floor-1');
  p.zone('hall', 1, 1, 18, 13, { label: 'Hall' });
  p.spawn('main-door', 10, 8);
  return map;
}

export async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const targets = [
    [path.join(repoRoot, 'public/maps/office.tmj'), buildOffice()],
    [path.join(repoRoot, 'public/maps/templates/blank.tmj'), buildBlankTemplate()],
  ];
  for (const [file, map] of targets) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(map, null, 2)}\n`);
    const zones = map.layers.find((l) => l.name === 'zones').objects.length;
    const spawns = map.layers.find((l) => l.name === 'spawns').objects.length;
    console.log(`${path.relative(repoRoot, file)}: ${map.width}x${map.height}, ${zones} zones, ${spawns} spawns`);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(String(err?.message ?? err));
    process.exitCode = 1;
  });
}
