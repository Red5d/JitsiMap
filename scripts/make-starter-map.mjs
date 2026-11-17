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
  'floor-stones': 42,
  'floor-dark-1': 0,
  'floor-planks-left': 36,
  'floor-planks-mid': 37,
  'floor-planks-right': 38,
  'floor-steps': 39,
  mat: 66,
  wall: 40,
  'wall-pillar': 58,
  'wall-window': 28,
  'wall-banner': 29,
  'door-left': 46,
  'door-right': 47,
  table: 72,
  chair: 73,
  shelf: 63,
  chest: 89,
  crate: 101,
  'rail-left': 76,
  'rail-mid': 77,
  'rail-right': 78,
};

/** Tiles that block movement. Painted on `ground` or `furniture` (SPEC §10.2). */
export const COLLIDING_TILES = [
  'wall',
  'wall-pillar',
  'wall-window',
  'wall-banner',
  'table',
  'shelf',
  'chest',
  'crate',
  'rail-left',
  'rail-mid',
  'rail-right',
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

/** Deterministic pseudo-random 0/1 for subtle floor speckling (stable across runs). */
function speckle(col, row) {
  const h = (col * 73856093) ^ (row * 19349663);
  return (h >>> 3) % 11 === 0;
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
  p.ground(0, 0, 'wall-pillar');
  p.ground(width - 1, 0, 'wall-pillar');
  p.ground(0, height - 1, 'wall-pillar');
  p.ground(width - 1, height - 1, 'wall-pillar');
}

/** Seamless stone/plank platform rectangle (width ≥ 2). */
function platformRect(p, col0, row0, col1, row1) {
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      const tile = col === col0 ? 'floor-planks-left' : col === col1 ? 'floor-planks-right' : 'floor-planks-mid';
      p.ground(col, row, tile);
    }
  }
}

/** Horizontal railing segment on `furniture` (width ≥ 2). */
function railing(p, col0, col1, row) {
  for (let col = col0; col <= col1; col++) {
    const tile = col === col0 ? 'rail-left' : col === col1 ? 'rail-right' : 'rail-mid';
    p.furniture(col, row, tile);
  }
}

/**
 * Enclosed room: walls on `ground`, clean floor inside, symmetric 2-tile double door.
 * `side` is the wall the door sits in: 'north' | 'south' | 'west' | 'east';
 * `doorAt` is the first tile (col for north/south, row for west/east).
 */
function room(p, { col0, row0, col1, row1, side, doorAt, floor = 'floor-dark-1', windows = [] }) {
  p.wallRect(col0, row0, col1, row1, 'wall');
  for (const [col, row] of [
    [col0, row0],
    [col1, row0],
    [col0, row1],
    [col1, row1],
  ]) {
    p.ground(col, row, 'wall-pillar');
  }
  for (const [col, row] of windows) p.ground(col, row, 'wall-window');
  for (let row = row0 + 1; row <= row1 - 1; row++) {
    for (let col = col0 + 1; col <= col1 - 1; col++) p.ground(col, row, floor);
  }
  if (side === 'north') {
    p.ground(doorAt - 1, row0, 'wall-pillar');
    p.ground(doorAt, row0, 'door-left');
    p.ground(doorAt + 1, row0, 'door-right');
    p.ground(doorAt + 2, row0, 'wall-pillar');
  }
  if (side === 'south') {
    p.ground(doorAt - 1, row1, 'wall-pillar');
    p.ground(doorAt, row1, 'door-left');
    p.ground(doorAt + 1, row1, 'door-right');
    p.ground(doorAt + 2, row1, 'wall-pillar');
  }
  if (side === 'west') {
    p.ground(col0, doorAt, 'door-left');
    p.ground(col0, doorAt + 1, 'door-right');
  }
  if (side === 'east') {
    p.ground(col1, doorAt, 'door-left');
    p.ground(col1, doorAt + 1, 'door-right');
  }
}

/** Conference table (w×1 wooden tables) with chairs along sides and ends. */
function conferenceTable(p, col0, row, w) {
  for (let col = col0; col < col0 + w; col++) {
    p.furniture(col, row, 'table');
    p.furniture(col, row - 1, 'chair');
    p.furniture(col, row + 1, 'chair');
  }
  p.furniture(col0 - 1, row, 'chair');
  p.furniture(col0 + w, row, 'chair');
}

/** The starter map: SPEC §10.4. */
export function buildOffice() {
  const width = 40;
  const height = 30;
  const map = emptyMap(width, height, { image: 'tilesets/tiny-dungeon.png' });
  const p = paint(map);

  floorEverything(p, width, height);
  outerWalls(p, width, height);

  // Outer wall windows and banners (grounded in actual walls, never floating).
  for (const col of [13, 14, 22, 24]) p.ground(col, 0, 'wall-window');
  p.ground(23, 0, 'wall-banner');
  for (const col of [14, 16]) p.ground(col, height - 1, 'wall-window');
  for (const col of [24, 27, 30, 33]) p.ground(col, height - 1, 'wall-banner');
  p.ground(0, 15, 'wall-banner');
  p.ground(width - 1, 15, 'wall-banner');

  // --- Rooms (walls on `ground`, doors are walkable double-door tiles) ------
  room(p, {
    col0: 1,
    row0: 1,
    col1: 11,
    row1: 9,
    side: 'south',
    doorAt: 5,
    windows: [
      [4, 1],
      [8, 1],
    ],
  }); // breakout-1
  room(p, {
    col0: 26,
    row0: 1,
    col1: 36,
    row1: 9,
    side: 'south',
    doorAt: 30,
    windows: [
      [29, 1],
      [33, 1],
    ],
  }); // breakout-2
  room(p, {
    col0: 1,
    row0: 20,
    col1: 11,
    row1: 28,
    side: 'north',
    doorAt: 5,
    windows: [
      [4, 28],
      [8, 28],
    ],
  }); // breakout-3
  room(p, { col0: 16, row0: 1, col1: 20, row1: 5, side: 'south', doorAt: 18 }); // silent nook

  // --- Door thresholds + walkways + lounge pads (`ground`) ------------------
  // Stone thresholds right outside each room's double door.
  for (const [col, row] of [
    [5, 10],
    [6, 10],
    [30, 10],
    [31, 10],
    [18, 6],
    [19, 6],
    [5, 19],
    [6, 19],
  ]) {
    p.ground(col, row, 'floor-stones');
  }
  // Central arrival plaza around main-door + aligned walkway up to Silent Nook.
  platformRect(p, 18, 7, 19, 11);
  platformRect(p, 18, 12, 21, 15);
  // Lounge floor pads in the hall + east alcove.
  platformRect(p, 22, 5, 24, 7); // east alcove lounge
  platformRect(p, 4, 14, 6, 16); // west hall lounge
  platformRect(p, 13, 15, 15, 17); // mid-west chat corner
  platformRect(p, 33, 14, 35, 16); // east hall lounge
  platformRect(p, 14, 24, 16, 26); // south-west reading corner
  // Stage platform + centered approach landing from the hall.
  for (const col of [27, 28, 29, 30]) p.ground(col, 19, 'floor-stones');
  platformRect(p, 27, 20, 30, 21);
  platformRect(p, 20, 22, 37, 28);

  // --- Furniture ------------------------------------------------------------
  // Breakout conference tables (3x1 wooden tables with 8 chairs each).
  conferenceTable(p, 5, 5, 3); // breakout-1
  conferenceTable(p, 30, 5, 3); // breakout-2
  conferenceTable(p, 5, 24, 3); // breakout-3
  // Room corner storage/cabinets (against interior walls, clear of lanes).
  p.furniture(2, 2, 'shelf');
  p.furniture(3, 2, 'shelf');
  p.furniture(10, 2, 'chest');
  p.furniture(34, 2, 'shelf');
  p.furniture(35, 2, 'shelf');
  p.furniture(27, 2, 'crate');
  p.furniture(2, 27, 'chest');
  p.furniture(3, 27, 'crate');
  // Silent nook: cozy 2-person table and woven floor mat, doorway kept clear.
  p.furniture(17, 2, 'chair');
  p.furniture(18, 2, 'table');
  p.furniture(19, 2, 'chair');
  p.furniture(18, 3, 'mat');
  // North alcove cabinets/storage tucked cleanly against the north outer wall.
  p.furniture(13, 1, 'shelf');
  p.furniture(14, 1, 'shelf');
  p.furniture(22, 1, 'shelf');
  p.furniture(23, 1, 'shelf');
  p.furniture(24, 1, 'shelf');
  p.furniture(21, 1, 'chest');
  p.furniture(25, 1, 'crate');
  // East alcove small chat table on its pad.
  p.furniture(23, 6, 'table');
  p.furniture(22, 6, 'chair');
  p.furniture(24, 6, 'chair');
  // Hall lounge seating clusters (on their stone pads).
  p.furniture(5, 15, 'table');
  p.furniture(4, 15, 'chair');
  p.furniture(6, 15, 'chair');
  p.furniture(5, 14, 'chair');
  p.furniture(5, 16, 'chair');

  p.furniture(14, 16, 'table');
  p.furniture(13, 16, 'chair');
  p.furniture(15, 16, 'chair');
  p.furniture(14, 15, 'chair');

  p.furniture(34, 15, 'table');
  p.furniture(33, 15, 'chair');
  p.furniture(35, 15, 'chair');
  p.furniture(34, 14, 'chair');
  p.furniture(34, 16, 'chair');

  p.furniture(15, 25, 'table');
  p.furniture(14, 25, 'chair');
  p.furniture(16, 25, 'chair');
  // Hall perimeter storage/cabinets along outer walls.
  p.furniture(1, 11, 'crate');
  p.furniture(1, 18, 'chest');
  p.furniture(38, 11, 'shelf');
  p.furniture(38, 12, 'shelf');
  p.furniture(38, 18, 'chest');
  p.furniture(13, 28, 'chest');
  p.furniture(14, 28, 'crate');
  // Stage: railing flanking a wide center entrance, presenter desk & chairs.
  railing(p, 20, 25, 22);
  railing(p, 32, 37, 22);
  p.furniture(28, 24, 'table');
  p.furniture(29, 24, 'table');
  p.furniture(28, 25, 'chair');
  p.furniture(29, 25, 'chair');

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
