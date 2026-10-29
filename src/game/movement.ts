/**
 * Local movement — SPEC §5.3: WASD/arrows (continuous 8-dir, 4 tiles/s),
 * click-to-move over A* on the collision grid, circle-vs-tile collision with
 * wall sliding. The controller writes the local pose to the store every tick
 * (hot path, SPEC §11); it NEVER sends anything to the network — the Jitsi
 * adapter owns the §7.3 send loop.
 *
 * `astar`, `nearestWalkable` and the tile math are PURE exports (node-testable);
 * `MovementController` uses Phaser for input/sprites.
 */

import type Phaser from 'phaser';
import { store } from '../store';
import { type Pose, TILE_SIZE } from '../types';
import type { GameMapData } from './maps';
import { spawnPosition, tileBlocked } from './maps';

/** 4 tiles/sec at 32 px/tile (SPEC §5.3). */
export const MOVE_SPEED_PX = 4 * TILE_SIZE;
/** Avatar collision circle radius (< half a tile so 1-tile doors fit). */
export const AVATAR_RADIUS = 10;
/** Waypoint arrival distance for click-to-move. */
const WAYPOINT_EPS = 4;

/**
 * True when the active element is a DOM text field (input/textarea/select or
 * contentEditable): keyboard game input (WASD/arrows/E) must yield to typing
 * (§5.3). Duck-typed so it is node-testable.
 */
export function isTypingTarget(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const t = el as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

export interface TilePos {
  col: number;
  row: number;
}

// ---------------------------------------------------------------- A* (pure)

const DIRS8: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Min-heap keyed by f-score; (node, f) pairs, ≤ a few thousand entries. */
class Heap {
  private items: number[] = []; // flat [node, f, node, f, ...]
  get size(): number {
    return this.items.length / 2;
  }
  push(node: number, f: number): void {
    const items = this.items;
    items.push(node, f);
    let i = items.length / 2 - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent * 2 + 1]! <= items[i * 2 + 1]!) break;
      this.swap(parent, i);
      i = parent;
    }
  }
  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const lastNode = items.pop()!;
    const lastF = items.pop()!;
    if (items.length > 0) {
      items[0] = lastNode;
      items[1] = lastF;
      const n = items.length / 2;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && items[l * 2 + 1]! < items[m * 2 + 1]!) m = l;
        if (r < n && items[r * 2 + 1]! < items[m * 2 + 1]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const items = this.items;
    const an = items[a * 2]!;
    const af = items[a * 2 + 1]!;
    items[a * 2] = items[b * 2]!;
    items[a * 2 + 1] = items[b * 2 + 1]!;
    items[b * 2] = an;
    items[b * 2 + 1] = af;
  }
}

/**
 * A* over the collision grid: 8-directional, no corner cutting (a diagonal
 * requires both adjacent orthogonals to be open), octile distance heuristic.
 * Returns the path from `from` (exclusive) to `to` (inclusive), or null when
 * unreachable / blocked. The map is ~1200 nodes — a binary heap is plenty.
 */
export function astar(grid: Uint8Array, w: number, h: number, from: TilePos, to: TilePos): TilePos[] | null {
  const inBounds = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < w && r < h;
  if (!inBounds(from.col, from.row) || !inBounds(to.col, to.row)) return null;
  const start = from.row * w + from.col;
  const goal = to.row * w + to.col;
  if (grid[start] === 1 || grid[goal] === 1) return null;
  if (start === goal) return [];

  const g = new Float64Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const hCost = (idx: number): number => {
    const dx = Math.abs((idx % w) - to.col);
    const dy = Math.abs(Math.floor(idx / w) - to.row);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new Heap();
  g[start] = 0;
  open.push(start, hCost(start));

  while (open.size > 0) {
    const current = open.pop();
    if (current === goal) {
      const path: TilePos[] = [];
      for (let n = goal; n !== start && n !== -1; n = came[n]!) {
        path.push({ col: n % w, row: Math.floor(n / w) });
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;
    const cx = current % w;
    const cy = Math.floor(current / w);
    for (const [dx, dy, cost] of DIRS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const nIdx = ny * w + nx;
      if (grid[nIdx] === 1) continue;
      if (dx !== 0 && dy !== 0) {
        // no corner cutting through diagonal wall gaps
        if (grid[cy * w + nx] === 1 || grid[ny * w + cx] === 1) continue;
      }
      const tentative = g[current]! + cost;
      if (tentative < g[nIdx]!) {
        g[nIdx] = tentative;
        came[nIdx] = current;
        open.push(nIdx, tentative + hCost(nIdx));
      }
    }
  }
  return null;
}

/** Nearest walkable tile to (col,row) via an expanding ring search; null if none. */
export function nearestWalkable(grid: Uint8Array, w: number, h: number, col: number, row: number): TilePos | null {
  const clampC = Math.min(Math.max(col, 0), w - 1);
  const clampR = Math.min(Math.max(row, 0), h - 1);
  for (let radius = 0; radius < w + h; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue; // ring only
        const c = clampC + dc;
        const r = clampR + dr;
        if (c < 0 || r < 0 || c >= w || r >= h) continue;
        if (grid[r * w + c] !== 1) return { col: c, row: r };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- controller

export interface MovementOpts {
  /** Local emote request (E key / click own avatar) — scene wires it to the store. */
  onLocalEmote?: () => void;
}

/**
 * Drives the local avatar: keyboard + click-to-move with tile collision.
 * Publishes `Pose` to the store every tick (zone via `store.zoneAtPoint`).
 */
export class MovementController {
  private x: number;
  private y: number;
  private dir = 0; // facing degrees, 0 = up (SPEC types.ts) — initial: up
  private keys: Partial<Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>> =
    {};
  private path: { x: number; y: number }[] = [];
  private sprite: Phaser.GameObjects.Container | null = null;
  private pointerDown = (p: Phaser.Input.Pointer): void => this.onClick(p);
  private disposed = false;

  constructor(
    private scene: Phaser.Scene,
    private map: GameMapData,
    private opts: MovementOpts = {},
  ) {
    const spawn = spawnPosition(map, Math.floor(Math.random() * Math.max(1, map.spawns.length)));
    this.x = spawn.x;
    this.y = spawn.y;
    const kb = scene.input.keyboard;
    if (kb) {
      // enableCapture=false: Phaser's default preventDefault on captured keys
      // blocks typing WASD/arrows into DOM inputs (chat, settings).
      this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Partial<
        Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>
      >;
      kb.on('keydown-E', () => {
        if (!isTypingTarget(document.activeElement)) this.opts.onLocalEmote?.();
      });
    }
    scene.input.on('pointerdown', this.pointerDown);
  }

  /** The moving avatar container; movement sets its x/y each frame. */
  attach(sprite: Phaser.GameObjects.Container): void {
    this.sprite = sprite;
    sprite.setPosition(this.x, this.y);
  }

  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.input.off('pointerdown', this.pointerDown);
    if (this.scene.input.keyboard) this.scene.input.keyboard.off('keydown-E');
  }

  /** Per-frame step (delta in ms, from scene.update). */
  update(delta: number): void {
    const dt = Math.min(delta, 100) / 1000; // clamp tab-switch spikes
    let vx = 0;
    let vy = 0;
    const k = this.keys;
    // While the user types in a DOM text field (chat, settings…), keyboard
    // game input must yield (§5.3): WASD belongs to the message, not the map.
    if (!isTypingTarget(document.activeElement)) {
      if (k.W?.isDown || k.UP?.isDown) vy -= 1;
      if (k.S?.isDown || k.DOWN?.isDown) vy += 1;
      if (k.A?.isDown || k.LEFT?.isDown) vx -= 1;
      if (k.D?.isDown || k.RIGHT?.isDown) vx += 1;
    }

    const keyboardActive = vx !== 0 || vy !== 0;
    if (keyboardActive)
      this.path = []; // keyboard input cancels a click path
    else if (this.path.length > 0) {
      const wp = this.path[0]!;
      const dx = wp.x - this.x;
      const dy = wp.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= WAYPOINT_EPS) {
        this.path.shift();
        if (this.path.length > 0) {
          const next = this.path[0]!;
          vx = next.x - this.x;
          vy = next.y - this.y;
        }
      } else {
        vx = dx / dist;
        vy = dy / dist;
      }
    }

    const mag = Math.hypot(vx, vy);
    let moving = false;
    if (mag > 0) {
      vx /= mag;
      vy /= mag;
      const step = MOVE_SPEED_PX * dt;
      const nx = this.moveX(this.x + vx * step);
      const ny = this.moveY(this.y + vy * step);
      moving = nx !== this.x || ny !== this.y;
      this.x = nx;
      this.y = ny;
      this.dir = this.directionFor(vx, vy);
      if (moving && this.path.length > 0 && this.wallBlockedAhead()) {
        this.path = []; // slid into a wall on the way to a click target
      }
    }

    this.sprite?.setPosition(this.x, this.y);

    const zone = store.zoneAtPoint(this.x, this.y);
    const pose: Pose = { x: this.x, y: this.y, dir: this.dir, zone: zone?.id ?? null, moving };
    store.setLocalPose(pose); // hot path — store only notifies on zone change
  }

  // ------------------------------------------------------------- collision

  /** Circle-vs-tiles per axis: move on X, clamp at the wall, then Y (slide). */
  private moveX(target: number): number {
    const r = AVATAR_RADIUS;
    const top = Math.floor((this.y - r) / TILE_SIZE);
    const bottom = Math.floor((this.y + r) / TILE_SIZE);
    if (target - r < this.x - r) {
      // moving left
      const col = Math.floor((target - r) / TILE_SIZE);
      for (let row = top; row <= bottom; row++) {
        if (tileBlocked(this.map, col, row)) return (col + 1) * TILE_SIZE + r;
      }
    } else if (target + r > this.x + r) {
      const col = Math.floor((target + r) / TILE_SIZE);
      for (let row = top; row <= bottom; row++) {
        if (tileBlocked(this.map, col, row)) return col * TILE_SIZE - r;
      }
    }
    return target;
  }

  private moveY(target: number): number {
    const r = AVATAR_RADIUS;
    const left = Math.floor((this.x - r) / TILE_SIZE);
    const right = Math.floor((this.x + r) / TILE_SIZE);
    if (target - r < this.y - r) {
      const row = Math.floor((target - r) / TILE_SIZE);
      for (let col = left; col <= right; col++) {
        if (tileBlocked(this.map, col, row)) return (row + 1) * TILE_SIZE + r;
      }
    } else if (target + r > this.y + r) {
      const row = Math.floor((target + r) / TILE_SIZE);
      for (let col = left; col <= right; col++) {
        if (tileBlocked(this.map, col, row)) return row * TILE_SIZE - r;
      }
    }
    return target;
  }

  /** Is the tile we just stepped into blocked (path walk slid into a wall)? */
  private wallBlockedAhead(): boolean {
    const t = this.tileOf(this.x, this.y);
    return tileBlocked(this.map, t.col, t.row);
  }

  // ------------------------------------------------------------- click-to-move

  private tileOf(x: number, y: number): TilePos {
    return { col: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
  }

  private onClick(p: Phaser.Input.Pointer): void {
    // Only left-click moves; right-click (and middle) are ignored (§5.3).
    if (p.rightButtonDown() || p.button === 2) return;
    const wx = p.worldX;
    const wy = p.worldY;

    // Clicking a remote avatar routes you adjacent to them (SPEC §5.3 SHOULD).
    let target = this.tileOf(wx, wy);
    for (const part of store.getSnapshot().participants) {
      const pose = part.pose?.target;
      if (!pose) continue;
      if (Math.abs(pose.x - wx) <= TILE_SIZE / 2 && Math.abs(pose.y - wy) <= TILE_SIZE / 2) {
        target = this.tileOf(pose.x, pose.y);
        break;
      }
    }

    const walkable = nearestWalkable(this.map.collision, this.map.width, this.map.height, target.col, target.row);
    if (!walkable) return;
    const from = this.tileOf(this.x, this.y);
    const tiles = astar(this.map.collision, this.map.width, this.map.height, from, walkable);
    if (tiles) {
      this.path = tiles.map((t) => ({ x: t.col * TILE_SIZE + TILE_SIZE / 2, y: t.row * TILE_SIZE + TILE_SIZE / 2 }));
    } else {
      // A* failed → straight-line walk, stop-on-wall (minimum acceptable).
      this.path = [{ x: walkable.col * TILE_SIZE + TILE_SIZE / 2, y: walkable.row * TILE_SIZE + TILE_SIZE / 2 }];
    }
  }

  private directionFor(vx: number, vy: number): number {
    // 0 = up, 90 = right (src/types.ts Pose.dir)
    const deg = (Math.atan2(vx, -vy) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }
}
