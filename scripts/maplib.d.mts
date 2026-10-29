// Type surface for maplib.mjs, for TypeScript consumers (tests).
// Keep in sync with maplib.mjs when changing shared helpers.

export const TILE_SIZE: number;
export const REQUIRED_TILE_LAYERS: string[];
export const REQUIRED_OBJECT_LAYERS: string[];
export const OPTIONAL_OBJECT_LAYERS: string[];
export const FLIP_FLAGS: number;
export const TILE_ID_MASK: number;

export function parseProperties(list: unknown): Record<string, unknown>;

export interface BoolResult {
  value: boolean;
  coerced: boolean;
  coercedFrom?: string;
}
export function asBool(value: unknown): BoolResult;

/** `audibleFrom`: comma-separated string (JSON list also accepted). */
export function asZoneList(value: unknown): string[];

export function loadMapDocument(file: string): Promise<{ doc: any; dir: string }>;

export interface ResolvedTileset {
  tileset: any;
  dir: string;
  firstgid: number;
  lastgid: number;
  source: string;
}
export function resolveTilesets(doc: any, baseDir: string): Promise<ResolvedTileset[]>;
export function tileCount(tileset: any): number;
export function tileProperties(tileset: any, localId: number): Record<string, unknown>;
export function gidCollides(resolved: ResolvedTileset[], gid: number): boolean;
export function gidOwner(resolved: ResolvedTileset[], gid: number): { set: ResolvedTileset; localId: number } | null;
export function layerByName(doc: any, name: string): any | null;

export interface CollisionGrid {
  width: number;
  height: number;
  blocked: Uint8Array;
}
export function collisionGrid(doc: any, baseDir: string): Promise<CollisionGrid>;

/** 4-neighbour flood fill over walkable tiles; returns a visited bitmap. */
export function floodFill(
  width: number,
  height: number,
  blocked: Uint8Array,
  startCol: number,
  startRow: number,
): Uint8Array;

export interface ZoneTileRect {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
  valid: boolean;
}
export function zoneTileRect(
  zone: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): ZoneTileRect;

export interface ZoneDef {
  id: string;
  label: string;
  silent: boolean;
  stage: boolean;
  /** Source ids of zones whose audio this zone receives. */
  audibleFrom: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  properties: Record<string, unknown>;
}
export function extractZones(
  doc: any,
): { zones: ZoneDef[]; warnings: string[]; errors: string[] };

export interface SpawnDef {
  id: string;
  x: number;
  y: number;
  col: number;
  row: number;
  properties: Record<string, unknown>;
}
export function extractSpawns(doc: any): { spawns: SpawnDef[]; warnings: string[] };
