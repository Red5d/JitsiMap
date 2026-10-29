// Runtime `.tmj` loader (SPEC §10.2): the shipped office fixture parses into
// the MapData contract, collision/zones/spawns match the validator's view,
// unknown props + the Phase-2 `exits` layer are ignored gracefully, the
// legacy `Collision` spelling works, and malformed maps throw readable errors.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseMapData, resolveGid, spawnPosition, tileBlocked } from '../src/game/maps';
import type { GameMapData } from '../src/game/maps';
import { TILE_SIZE } from '../src/types';

const mapsDir = fileURLToPath(new URL('../public/maps/', import.meta.url));
const officeJson = readFileSync(path.join(mapsDir, 'office.tmj'), 'utf8');

const parse = (id = 'office'): GameMapData => parseMapData(officeJson, id);
const clone = (): any => JSON.parse(officeJson);

describe('parseMapData(office.tmj) — MapData contract (§10.2)', () => {
  const map = parse();

  it('grid 40×30 tiles at 32 px → 1280×960 px', () => {
    expect([map.width, map.height]).toEqual([40, 30]);
    expect(map.tileWidth).toBe(TILE_SIZE);
    expect(map.tileHeight).toBe(TILE_SIZE);
    expect([map.widthPx, map.heightPx]).toEqual([1280, 960]);
    expect(map.collision.length).toBe(40 * 30);
    expect(map.id).toBe('office');
  });

  it('zones: ids, labels, silent/stage flags, audibleFrom', () => {
    expect(map.zones.map((z) => z.id)).toEqual([
      'hall',
      'breakout-1',
      'breakout-2',
      'breakout-3',
      'silent-nook',
      'stage',
    ]);
    const byId = new Map(map.zones.map((z) => [z.id, z]));
    expect(byId.get('stage')!.audibleFrom).toEqual(['hall']);
    expect(byId.get('stage')!.stage).toBe(true);
    expect(byId.get('silent-nook')!.silent).toBe(true);
    expect(byId.get('hall')!.silent).toBe(false);
    expect(byId.get('hall')!.label).toBe('Hall');
    expect(byId.get('hall')).toMatchObject({ x: 32, y: 320, w: 1216, h: 320 });
  });

  it('spawns: 3 points, all on non-colliding tiles', () => {
    expect(map.spawns.map((s) => s.id)).toEqual(['main-door', 'hall-west', 'hall-east']);
    for (const s of map.spawns) {
      expect(tileBlocked(map, Math.floor(s.x / TILE_SIZE), Math.floor(s.y / TILE_SIZE))).toBe(false);
    }
  });

  it('collision: walls are 1, spawn tiles are 0, outer ring solid', () => {
    expect(map.collision.some((c) => c === 1)).toBe(true);
    for (const s of map.spawns) {
      expect(map.collision[Math.floor(s.y / TILE_SIZE) * map.width + Math.floor(s.x / TILE_SIZE)]).toBe(0);
    }
    expect(tileBlocked(map, 0, 0)).toBe(true); // outer wall corner
    expect(tileBlocked(map, 39, 29)).toBe(true);
  });

  it('renderer metadata: single embedded 32px tileset + 3 render layers', () => {
    expect(map.tilesets).toHaveLength(1);
    const ts = map.tilesets[0]!;
    expect(ts).toMatchObject({ key: 'tiny-dungeon', firstgid: 1, tileWidth: 32, tileHeight: 32 });
    expect(ts.image).toBe('tilesets/tiny-dungeon.png');
    expect(map.layers.map((l) => l.name)).toEqual(['ground', 'furniture', 'above']);
    for (const l of map.layers) expect(l.data.length).toBe(40 * 30);
    // resolveGid: gid 1 = first tile of the set; 0 and out-of-range are null.
    expect(resolveGid(map, 1)).toEqual({ key: 'tiny-dungeon', frame: 0 });
    expect(resolveGid(map, ts.lastgid)).toEqual({ key: 'tiny-dungeon', frame: ts.tilecount - 1 });
    expect(resolveGid(map, 0)).toBeNull();
    expect(resolveGid(map, ts.lastgid + 1)).toBeNull();
  });
});

describe('graceful ignores (§10.2)', () => {
  it('the office `exits` layer is accepted and MapData has no exits field', () => {
    expect(officeJson).toContain('"exits"');
    const map = parse() as unknown as Record<string, unknown>;
    expect(map).not.toHaveProperty('exits');
  });

  it('an `exits` object layer with unknown props parses without touching anything', () => {
    const doc = clone();
    const exits = doc.layers.find((l: any) => l.name === 'exits');
    exits.objects = [{ name: 'to-lobby', x: 100, y: 100, properties: [{ name: 'exitTo', value: 'lobby' }] }];
    const map = parseMapData(JSON.stringify(doc), 'office');
    expect(map).not.toHaveProperty('exits');
    expect(map.zones.map((z) => z.id)).toContain('hall');
  });

  it('unknown tile and object properties are ignored, not fatal', () => {
    const doc = clone();
    doc.tilesets[0].tiles[0].properties.push({ name: 'hoverboard', type: 'bool', value: true });
    doc.layers.find((l: any) => l.name === 'zones').objects[0].properties.push({ name: 'quantum', value: 42 });
    doc.layers.find((l: any) => l.name === 'ground').properties = [{ name: 'parallax', value: 3 }];
    const map = parseMapData(JSON.stringify(doc), 'office');
    expect(map.zones[0]!.id).toBe('hall');
    expect(map.collision.length).toBe(1200);
  });

  it('flip/transpose flags are stripped from gids', () => {
    const doc = clone();
    doc.layers.find((l: any) => l.name === 'ground').data[0] = 1 | 0x2000_0000; // gid 1, v-flip
    const map = parseMapData(JSON.stringify(doc), 'office');
    expect(map.layers[0]!.data[0]).toBe(1);
  });

  it('unknown extra layers are ignored', () => {
    const doc = clone();
    doc.layers.push({ id: 99, name: 'deco-extra', type: 'objectgroup', objects: [] });
    expect(parseMapData(JSON.stringify(doc), 'office').width).toBe(40);
  });
});

describe('collision props: `collides` + legacy `Collision` (§10.2)', () => {
  /** Minimal 3×2 synthetic map; tile id 0 walkable, tile id 1 collides. */
  function syntheticMap(tilePropName: string): GameMapData {
    const gidSolid = 2; // firstgid 1 + tile id 1
    return parseMapData(
      {
        orientation: 'orthogonal',
        width: 3,
        height: 2,
        tilewidth: 32,
        tileheight: 32,
        layers: [
          { name: 'ground', type: 'tilelayer', data: [1, 1, 1, 1, 1, 1] },
          { name: 'furniture', type: 'tilelayer', data: [0, gidSolid, 0, 0, 0, 0] },
          { name: 'above', type: 'tilelayer', data: [0, 0, 0, 0, 0, 0] },
          { name: 'spawns', type: 'objectgroup', objects: [{ name: 's', x: 16, y: 48 }] },
        ],
        tilesets: [
          {
            firstgid: 1,
            name: 'mini',
            image: 'mini.png',
            imagewidth: 64,
            imageheight: 32,
            tilewidth: 32,
            tileheight: 32,
            tilecount: 2,
            columns: 2,
            tiles: [{ id: 1, properties: [{ name: tilePropName, type: 'bool', value: true }] }],
          },
        ],
      },
      'mini',
    );
  }

  it('accepts the canonical `collides` property', () => {
    const map = syntheticMap('collides');
    expect(Array.from(map.collision)).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('accepts the legacy `Collision` spelling', () => {
    const map = syntheticMap('Collision');
    expect(map.collision[1]).toBe(1);
  });

  it('the `above` layer never contributes collision', () => {
    const doc = clone();
    const wallGid = doc.tilesets[0].firstgid + doc.tilesets[0].tiles.find((t: any) => t.properties).id;
    const W = doc.width;
    doc.layers.find((l: any) => l.name === 'above').data[14 * W + 20] = wallGid; // main-door spawn tile
    const map = parseMapData(JSON.stringify(doc), 'office');
    const spawn = map.spawns[0]!;
    expect(tileBlocked(map, Math.floor(spawn.x / 32), Math.floor(spawn.y / 32))).toBe(false);
  });

  it('spawnPosition wraps the index and returns tile-centred px', () => {
    const map = parse();
    const a = spawnPosition(map, 0);
    const b = spawnPosition(map, map.spawns.length);
    expect(b).toEqual(a);
    expect(spawnPosition(map, -1)).toEqual(spawnPosition(map, map.spawns.length - 1));
  });
});

describe('malformed maps throw human-readable errors (§5.1)', () => {
  it('broken JSON string', () => {
    expect(() => parseMapData('{ "layers": [', 'broken')).toThrow(/Map "broken": not valid JSON/);
  });

  it('non-object JSON', () => {
    expect(() => parseMapData([1, 2, 3], 'notamap')).toThrow(/not a Tiled map object/);
  });

  it('missing required tile layer', () => {
    const doc = clone();
    doc.layers = doc.layers.filter((l: any) => l.name !== 'furniture');
    expect(() => parseMapData(doc, 'holey')).toThrow(/missing tile layer "furniture"/);
  });

  it('tile layer data length mismatch', () => {
    const doc = clone();
    doc.layers.find((l: any) => l.name === 'ground').data.pop();
    expect(() => parseMapData(doc, 'short')).toThrow(/tile layer "ground" has 1199 cells, expected 1200/);
  });

  it('no spawn objects', () => {
    const doc = clone();
    doc.layers.find((l: any) => l.name === 'spawns').objects = [];
    expect(() => parseMapData(doc, 'nospawn')).toThrow(/no spawn objects/);
  });

  it('zero-size zone', () => {
    const doc = clone();
    doc.layers.find((l: any) => l.name === 'zones').objects[0].width = 0;
    expect(() => parseMapData(doc, 'flat')).toThrow(/zone object #1 \(hall\): zone has zero size/);
  });

  it('non-orthogonal orientation', () => {
    const doc = clone();
    doc.orientation = 'isometric';
    expect(() => parseMapData(doc, 'iso')).toThrow(/orientation must be "orthogonal"/);
  });

  it('infinite maps are rejected', () => {
    const doc = clone();
    doc.infinite = true;
    expect(() => parseMapData(doc, 'inf')).toThrow(/infinite maps are not supported/);
  });

  it('wrong tile size is rejected with the sizes named', () => {
    const doc = clone();
    doc.tilewidth = 16;
    expect(() => parseMapData(doc, 'tiny')).toThrow(/tile size must be 32x32, got 16x32/);
  });
});
