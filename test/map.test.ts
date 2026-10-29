// Map system tests (SPEC §10): the shipped maps validate, the zone/spawn
// contract matches map-schema.md, and the validator catches every structural
// rule violation. Runs against the same code `npm run validate:maps` uses.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decodePng, encodePngRgb } from '../scripts/png.mjs';
import {
  asBool,
  collisionGrid,
  extractSpawns,
  extractZones,
  floodFill,
  gidCollides,
  resolveTilesets,
  zoneTileRect,
} from '../scripts/maplib.mjs';
import { defaultMapFiles, main, validateMap, validateMapFile } from '../scripts/validate-maps.mjs';

const mapsDir = fileURLToPath(new URL('../public/maps/', import.meta.url));
const officeFile = path.join(mapsDir, 'office.tmj');
const blankFile = path.join(mapsDir, 'templates/blank.tmj');
const tilesetFile = path.join(mapsDir, 'tilesets/tiny-dungeon.png');

let dir: string; // temp dir holding fixture .tmj files + a copy of the tileset

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'jitsimap-maps-'));
  mkdirSync(path.join(dir, 'tilesets'), { recursive: true });
  copyFileSync(tilesetFile, path.join(dir, 'tilesets/tiny-dungeon.png'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const officeDoc = () => JSON.parse(readFileSync(officeFile, 'utf8')) as any;
const clone = (doc: any) => structuredClone(doc);

/** Write a mutated copy of office into the temp dir and validate it on disk. */
async function fixture(name: string, doc: any) {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(doc));
  return validateMapFile(file);
}

const objectLayer = (doc: any, name: string) => doc.layers.find((l: any) => l.name === name);
const setProp = (obj: any, name: string, value: unknown) => {
  const props = (obj.properties ??= []);
  const p = props.find((q: any) => q.name === name);
  if (p) p.value = value;
  else props.push({ name, type: typeof value === 'boolean' ? 'bool' : 'string', value });
};

describe('shipped maps', () => {
  it('office.tmj validates with no errors', async () => {
    const { errors } = await validateMapFile(officeFile);
    expect(errors).toEqual([]);
  });

  it('office.tmj has no warnings', async () => {
    const { warnings } = await validateMapFile(officeFile);
    expect(warnings).toEqual([]);
  });

  it('templates/blank.tmj validates with no errors (border warning allowed)', async () => {
    const { errors, warnings } = await validateMapFile(blankFile);
    expect(errors).toEqual([]);
    expect(warnings.every((w) => w.includes('map border'))).toBe(true);
  });

  it('defaultMapFiles bundles public/maps/*.tmj and excludes templates', async () => {
    const files = await defaultMapFiles();
    expect(files.map((f) => path.basename(f))).toContain('office.tmj');
    expect(files.some((f) => f.includes('templates'))).toBe(false);
  });

  it('CLI main() exits 0 on the bundled maps', async () => {
    expect(await main([officeFile])).toBe(0);
  });
});

describe('tileset (map-schema.md)', () => {
  it('embedded tileset: 32px grid, firstgid 1, image on disk', async () => {
    const doc = officeDoc();
    expect(doc.tilewidth).toBe(32);
    expect(doc.tileheight).toBe(32);
    expect(doc.tilesets).toHaveLength(1);
    const set = doc.tilesets[0];
    expect(set.firstgid).toBe(1);
    expect(set.tilewidth).toBe(32);
    expect(set.tileheight).toBe(32);
    const png = decodePng(readFileSync(tilesetFile));
    // 2x upscale of the 192x176 Kenney packed sheet → 12x11 of 32px tiles.
    expect(png.width).toBe(384);
    expect(png.height).toBe(352);
    expect((png.width / 32) * (png.height / 32)).toBe(set.tilecount);
    const resolved = await resolveTilesets(doc, mapsDir);
    expect(resolved[0]!.lastgid).toBe(set.firstgid + set.tilecount - 1);
  });

  it('walls and furniture collide, floors and doors do not', async () => {
    const doc = officeDoc();
    const resolved = await resolveTilesets(doc, mapsDir);
    const colliding = doc.tilesets[0].tiles.filter((t: any) =>
      (t.properties ?? []).some((p: any) => p.name === 'collides' && p.value === true)
    );
    expect(colliding.length).toBeGreaterThan(0);
    for (const t of colliding) expect(gidCollides(resolved, 1 + t.id)).toBe(true);
    // gid 1 = floor-1, gid 4 = door-open (both walkable by schema).
    expect(gidCollides(resolved, 1)).toBe(false);
    expect(gidCollides(resolved, 4)).toBe(false);
    expect(gidCollides(resolved, 0)).toBe(false); // empty
  });

  it('office collision grid: outer ring blocked, spawn tiles walkable', async () => {
    const doc = officeDoc();
    const { width, height, blocked } = await collisionGrid(doc, mapsDir);
    expect([width, height]).toEqual([40, 30]);
    expect(blocked[0]).toBe(1); // (0,0) outer wall
    expect(blocked[width - 1]).toBe(1);
    expect(blocked[(height - 1) * width]).toBe(1);
    for (const s of extractSpawns(doc).spawns) expect(blocked[s.row * width + s.col]).toBe(0);
  });
});

describe('zone + spawn extraction (map-schema.md contract)', () => {
  it('office zones: ids, labels, silent/stage flags, audibleFrom', () => {
    const { zones, warnings, errors } = extractZones(officeDoc());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(zones.map((z: any) => z.id)).toEqual([
      'hall',
      'breakout-1',
      'breakout-2',
      'breakout-3',
      'silent-nook',
      'stage',
    ]);
    const byId = new Map(zones.map((z: any) => [z.id, z]));
    expect(byId.get('hall')!.label).toBe('Hall');
    expect(byId.get('stage')!.stage).toBe(true);
    expect(byId.get('stage')!.audibleFrom).toEqual(['hall']); // comma-string → list
    expect(byId.get('silent-nook')!.silent).toBe(true);
    expect(byId.get('hall')!.silent).toBe(false);
    expect(byId.get('hall')!.audibleFrom).toEqual([]);
  });

  it('zone rects convert to inclusive tile rectangles', () => {
    const stage = extractZones(officeDoc()).zones.find((z: any) => z.id === 'stage')!;
    expect(zoneTileRect(stage, 40, 30)).toEqual({ col0: 20, row0: 22, col1: 37, row1: 28, valid: true });
  });

  it('office spawns: ids at tile centers', () => {
    const { spawns, warnings } = extractSpawns(officeDoc());
    expect(warnings).toEqual([]);
    expect(spawns.map((s: any) => s.id)).toEqual(['main-door', 'hall-west', 'hall-east']);
    expect(spawns[0]).toMatchObject({ x: 656, y: 464, col: 20, row: 14 }); // tile center 20,14
    expect(spawns[1]).toMatchObject({ col: 14, row: 12 });
    expect(spawns[2]).toMatchObject({ col: 32, row: 13 });
  });

  it('zone id falls back to the object name with a warning', () => {
    const doc = officeDoc();
    const zones = objectLayer(doc, 'zones');
    zones.objects[0].properties = [];
    zones.objects[0].name = 'lobby';
    const out = extractZones(doc);
    expect(out.zones[0]!.id).toBe('lobby');
    expect(out.warnings.some((w: string) => w.includes('no "zone" property'))).toBe(true);
  });

  it('a zone object with neither "zone" property nor name is an error', () => {
    const doc = officeDoc();
    const zones = objectLayer(doc, 'zones');
    zones.objects[0].properties = [];
    zones.objects[0].name = '';
    expect(extractZones(doc).errors.some((e: string) => e.includes('missing required "zone" property'))).toBe(true);
  });
});

describe('asBool coercion (documented in the validator header)', () => {
  it('true values', () => {
    expect(asBool(true)).toMatchObject({ value: true, coerced: false });
    expect(asBool('true')).toMatchObject({ value: true, coerced: false });
    expect(asBool('TRUE')).toMatchObject({ value: true, coerced: false });
    expect(asBool('yes')).toMatchObject({ value: true, coerced: true });
    expect(asBool(1)).toMatchObject({ value: true, coerced: true });
  });
  it('false values', () => {
    expect(asBool(false)).toMatchObject({ value: false, coerced: false });
    expect(asBool('false')).toMatchObject({ value: false, coerced: false });
    expect(asBool('')).toMatchObject({ value: false, coerced: false });
    expect(asBool(undefined)).toMatchObject({ value: false, coerced: false });
    expect(asBool(0)).toMatchObject({ value: false, coerced: true });
    expect(asBool('no')).toMatchObject({ value: false, coerced: true });
    expect(asBool('maybe')).toMatchObject({ value: false, coerced: true, coercedFrom: 'maybe' });
  });
});

describe('floodFill', () => {
  it('4-neighbour fill stops at walls and blocked starts', () => {
    const blocked = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0]); // 3x3, (1,0) walled
    const seen = floodFill(3, 3, blocked, 0, 0);
    expect(Array.from(seen).filter(Boolean)).toHaveLength(8);
    expect(seen[1]).toBe(0);
    expect(floodFill(3, 3, blocked, 1, 0)).toEqual(new Uint8Array(9)); // start in wall
    expect(floodFill(3, 3, blocked, 9, 9)).toEqual(new Uint8Array(9)); // start outside
  });
});

describe('validator catches broken maps', () => {
  it('missing tile layer', async () => {
    const doc = officeDoc();
    doc.layers = doc.layers.filter((l: any) => l.name !== 'furniture');
    const { errors } = await fixture('no-furniture.tmj', doc);
    expect(errors.some((e: string) => e.includes('missing layer "furniture"'))).toBe(true);
  });

  it('tile layer data length mismatch', async () => {
    const doc = officeDoc();
    objectLayer(doc, 'ground').data.pop();
    const { errors } = await fixture('short-ground.tmj', doc);
    expect(errors.some((e: string) => e.includes('tile layer "ground" has 1199 cells, expected 1200'))).toBe(true);
  });

  it('no spawn objects', async () => {
    const doc = officeDoc();
    objectLayer(doc, 'spawns').objects = [];
    const { errors } = await fixture('no-spawns.tmj', doc);
    expect(errors.some((e: string) => e.includes('no spawn objects'))).toBe(true);
  });

  it('spawn outside the map', async () => {
    const doc = officeDoc();
    objectLayer(doc, 'spawns').objects[0].x = 2000;
    const { errors } = await fixture('off-map-spawn.tmj', doc);
    expect(errors.some((e: string) => e.includes('spawn "main-door" is outside the map'))).toBe(true);
  });

  it('spawn on a colliding tile', async () => {
    const doc = officeDoc();
    const { width, blocked } = await collisionGrid(doc, mapsDir);
    const idx = blocked.findIndex((b, i) => b === 1 && i % width > 0 && i % width < width - 1);
    expect(idx).toBeGreaterThan(-1);
    const spawn = objectLayer(doc, 'spawns').objects[0];
    spawn.x = (idx % width) * 32 + 16;
    spawn.y = Math.floor(idx / width) * 32 + 16;
    const { errors } = await fixture('spawn-in-wall.tmj', doc);
    expect(errors.some((e: string) => e.includes('spawn "main-door" is on a colliding tile'))).toBe(true);
  });

  it('duplicate zone id', async () => {
    const doc = officeDoc();
    setProp(objectLayer(doc, 'zones').objects[1], 'zone', 'hall'); // breakout-1 → hall
    const { errors } = await fixture('dupe-zone.tmj', doc);
    expect(errors.some((e: string) => e.includes('duplicate zone id "hall"'))).toBe(true);
  });

  it('zero-size zone', async () => {
    const doc = officeDoc();
    const zone = objectLayer(doc, 'zones').objects[0];
    zone.width = 0;
    zone.height = 0;
    const { errors } = await fixture('flat-zone.tmj', doc);
    expect(errors.some((e: string) => e.includes('zone "hall" has zero size'))).toBe(true);
  });

  it('zone outside the map bounds', async () => {
    const doc = officeDoc();
    objectLayer(doc, 'zones').objects[0].x = 1280; // map is 40*32 = 1280 wide
    const { errors } = await fixture('zone-out-of-bounds.tmj', doc);
    expect(errors.some((e: string) => e.includes('zone "hall" is outside the map bounds'))).toBe(true);
  });

  it('audibleFrom references unknown zone', async () => {
    const doc = officeDoc();
    const stage = objectLayer(doc, 'zones').objects.find((o: any) => o.name === 'stage');
    setProp(stage, 'audibleFrom', 'atrium');
    const { errors } = await fixture('bad-audible.tmj', doc);
    expect(
      errors.some((e: string) => e.includes('zone "stage": audibleFrom references unknown zone "atrium"'))
    ).toBe(true);
  });

  it('sealed-off zone is not reachable on foot', async () => {
    const doc = officeDoc();
    const furniture = objectLayer(doc, 'furniture');
    const wall = doc.tilesets[0].tiles.find((t: any) =>
      (t.properties ?? []).some((p: any) => p.name === 'collides' && p.value === true)
    );
    const gid = doc.tilesets[0].firstgid + wall.id;
    const W = doc.width;
    // Wall the stage ring (tiles 19..38 x 21..28; stage covers 20..37 x 22..27).
    for (let col = 19; col <= 38; col++) {
      furniture.data[21 * W + col] = gid;
      furniture.data[28 * W + col] = gid;
    }
    for (let row = 21; row <= 28; row++) {
      furniture.data[row * W + 19] = gid;
      furniture.data[row * W + 38] = gid;
    }
    const { errors } = await fixture('sealed-stage.tmj', doc);
    expect(errors.some((e: string) => e.includes('zone "stage" is not reachable on foot'))).toBe(true);
  });

  it('unreachable spawn is reported', async () => {
    const doc = officeDoc();
    const furniture = objectLayer(doc, 'furniture');
    const wall = doc.tilesets[0].tiles.find((t: any) =>
      (t.properties ?? []).some((p: any) => p.name === 'collides' && p.value === true)
    );
    const gid = doc.tilesets[0].firstgid + wall.id;
    // Fully split the map on column 15 (rows 1..28): hall-west (col 14) ends up
    // west of the wall, the main-door spawn east of it.
    for (let row = 1; row <= 28; row++) furniture.data[row * doc.width + 15] = gid;
    const { errors } = await fixture('sealed-spawn.tmj', doc);
    expect(errors.some((e: string) => e.includes('spawn "hall-west" is not reachable from spawn'))).toBe(true);
  });

  it('missing tileset image is an error', async () => {
    const doc = officeDoc();
    doc.tilesets[0].image = 'tilesets/does-not-exist.png';
    const { errors } = await fixture('no-image.tmj', doc);
    expect(errors.some((e: string) => e.includes('image "tilesets/does-not-exist.png" not found'))).toBe(true);
  });

  it('tile flips and unknown gids are warnings, not errors', async () => {
    const doc = officeDoc();
    const ground = objectLayer(doc, 'ground');
    ground.data[5 * doc.width + 5] = 1 | 0x2000_0000; // floor-1, vertically flipped
    ground.data[6 * doc.width + 6] = 999; // gid outside the tileset
    const { errors, warnings } = await validateMap(doc, { baseDir: dir });
    expect(errors).toEqual([]);
    expect(warnings.some((w: string) => w.includes('flip/transpose flags'))).toBe(true);
    expect(warnings.some((w: string) => w.includes('gid 999 is not in any tileset'))).toBe(true);
  });

  it('non-boolean silent is coerced with a warning', async () => {
    const doc = officeDoc();
    const nook = objectLayer(doc, 'zones').objects.find((o: any) => o.name === 'silent-nook');
    setProp(nook, 'silent', 'maybe');
    const { errors, warnings } = await validateMap(doc, { baseDir: mapsDir });
    expect(errors).toEqual([]);
    expect(warnings.some((w: string) => w.includes('silent="maybe" coerced to false'))).toBe(true);
  });

  it('missing exits layer is a warning only (Phase 2 reservation)', async () => {
    const doc = officeDoc();
    doc.layers = doc.layers.filter((l: any) => l.name !== 'exits');
    const { errors, warnings } = await validateMap(doc, { baseDir: mapsDir });
    expect(errors).toEqual([]);
    expect(warnings.some((w: string) => w.includes('layer "exits" is missing'))).toBe(true);
  });

  it('overlapping zones warn without failing', async () => {
    const doc = officeDoc();
    const breakout = objectLayer(doc, 'zones').objects[1]; // breakout-1
    const hall = objectLayer(doc, 'zones').objects[0];
    breakout.x = hall.x;
    breakout.y = hall.y;
    const { errors, warnings } = await validateMap(doc, { baseDir: mapsDir });
    expect(errors).toEqual([]);
    expect(warnings.some((w: string) => w.includes('overlapping zones (hall+breakout-1)'))).toBe(true);
  });

  it('non-orthogonal and non-32px maps are rejected', async () => {
    const doc = officeDoc();
    doc.orientation = 'isometric';
    doc.tilewidth = 16;
    const { errors } = await validateMap(doc, { baseDir: mapsDir });
    expect(errors.some((e: string) => e.includes('orientation must be "orthogonal"'))).toBe(true);
    expect(errors.some((e: string) => e.includes('tile size must be 32x32, got 16x32'))).toBe(true);
  });

  it('broken JSON is reported per file', async () => {
    const file = path.join(dir, 'broken.tmj');
    writeFileSync(file, '{ "layers": [');
    const { errors } = await validateMapFile(file);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('not valid JSON');
  });

  it('validateMap rejects non-map JSON', async () => {
    expect((await validateMap([1, 2, 3])).errors).toEqual(['JSON is not a Tiled map object']);
  });

  it('CLI main() exits 1 when a map fails', async () => {
    const doc = officeDoc();
    doc.layers = doc.layers.filter((l: any) => l.name !== 'above');
    const file = path.join(dir, 'cli-fails.tmj');
    writeFileSync(file, JSON.stringify(doc));
    expect(await main([file])).toBe(1);
  });
});

describe('png codec (scripts/png.mjs)', () => {
  it('encode/decode roundtrip preserves pixels', () => {
    const width = 5;
    const height = 3;
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = i * 3;
      rgb[i * 3 + 1] = 200 - i;
      rgb[i * 3 + 2] = (i * 37) % 256;
    }
    const png = encodePngRgb(width, height, rgb);
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const back = decodePng(png);
    expect([back.width, back.height]).toEqual([width, height]);
    for (let i = 0; i < width * height; i++) {
      expect(Array.from(back.data.subarray(i * 4, i * 4 + 3))).toEqual([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
      expect(back.data[i * 4 + 3]).toBe(255);
    }
  });

  it('encoder rejects size mismatches', () => {
    expect(() => encodePngRgb(2, 2, Buffer.alloc(3))).toThrow(/expected 12 bytes, got 3/);
  });

  it('the shipped tileset PNG decodes with intact chunks', () => {
    const png = decodePng(readFileSync(tilesetFile));
    expect(png.width * png.height).toBeGreaterThan(0);
    expect(png.data.length).toBe(png.width * png.height * 4);
  });
});
