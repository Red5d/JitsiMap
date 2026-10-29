/**
 * Camera/viewport math and pose interpolation — SPEC §7.3, §9.1.
 *
 * PURE module: no Phaser import (DOM-overlay code and node tests may use it).
 * The DOM video-bubble overlay (built by the UI) converts world px → screen px
 * per frame via `worldToScreen(pose, readCamera(cam))`.
 */

import type { Pose, ReceivedPose } from '../types';

/** Interpolation window for remote poses (~150 ms, SPEC §7.3). */
export const INTERPOLATION_MS = 150;
/** Snap threshold: >2 tiles of divergence at receipt (SPEC §7.3). */
export const SNAP_DISTANCE_PX = 64;
/** Zoom clamp (SPEC §5.3). */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;

/**
 * Structural camera shape (no Phaser import — this module stays node-testable).
 * Satisfied by `Phaser.Cameras.Scene2D.Camera` and by {@link CamView}.
 */
export interface CameraLike {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

/** Plain camera snapshot — safe to pass across the React/Phaser seam. */
export interface CamView {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Snapshot a Phaser camera into a plain object (called per frame by the UI). */
export function readCamera(cam: CameraLike): CamView {
  return { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom, width: cam.width, height: cam.height };
}

/**
 * World px → screen px. `cam.scrollX`/`scrollY` are treated as the view's
 * top-left in world space (the camera convention of this module).
 */
export function worldToScreen(world: Point, cam: CamView): Point {
  return { x: (world.x - cam.scrollX) * cam.zoom, y: (world.y - cam.scrollY) * cam.zoom };
}

/** Screen px → world px (inverse of {@link worldToScreen}). */
export function screenToWorld(screen: Point, cam: CamView): Point {
  return { x: screen.x / cam.zoom + cam.scrollX, y: screen.y / cam.zoom + cam.scrollY };
}

/** Shortest-arc lerp for facing degrees (0 = up, 90 = right), wrapped to [0, 360). */
export function lerpDir(from: number, to: number, t: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return (((from + delta * t) % 360) + 360) % 360;
}

/**
 * Snap check at pose receipt (SPEC §7.3): when the new target diverges from
 * `prev` by more than {@link SNAP_DISTANCE_PX}, restart the interpolation
 * from the target (no 400-px glide). Pure — the avatar manager calls it on
 * receipt; {@link interpolatePose} then reads prev/target only.
 */
export function applySnap(r: ReceivedPose, now: number): ReceivedPose {
  const dx = r.target.x - r.prev.x;
  const dy = r.target.y - r.prev.y;
  if (Math.hypot(dx, dy) > SNAP_DISTANCE_PX) {
    return { ...r, prev: r.target, prevAt: now };
  }
  return r;
}

/**
 * Display pose for a received remote pose: lerp `prev → target` over
 * {@link INTERPOLATION_MS} starting at `prevAt`, then hold `target`.
 * Zone/`moving` pass through from the target; `dir` follows the shortest arc.
 */
export function interpolatePose(r: ReceivedPose, now: number): Pose {
  const t = Math.min(Math.max((now - r.prevAt) / INTERPOLATION_MS, 0), 1);
  if (t >= 1) return { ...r.target };
  const { prev, target } = r;
  return {
    x: prev.x + (target.x - prev.x) * t,
    y: prev.y + (target.y - prev.y) * t,
    dir: lerpDir(prev.dir, target.dir, t),
    zone: target.zone,
    moving: target.moving,
  };
}
