// Remote-pose interpolation + camera math (SPEC §7.3, §9.1): ~150 ms lerp
// prev→target, >2-tile (64 px) snap at receipt, zone/dir passthrough, and
// the world↔screen transforms the video-bubble overlay uses every frame.

import { describe, expect, it } from 'vitest';
import {
  applySnap,
  INTERPOLATION_MS,
  interpolatePose,
  lerpDir,
  MAX_ZOOM,
  MIN_ZOOM,
  readCamera,
  SNAP_DISTANCE_PX,
  screenToWorld,
  worldToScreen,
} from '../src/game/viewport';
import type { Pose, ReceivedPose } from '../src/types';

const pose = (x: number, y: number, over: Partial<Pose> = {}): Pose => ({
  x,
  y,
  dir: 90,
  zone: 'hall',
  moving: true,
  ...over,
});

const received = (prev: Pose, target: Pose, prevAt = 1000, at = 1050): ReceivedPose => ({
  prev,
  target,
  prevAt,
  at,
});

describe('interpolatePose (~150 ms window, SPEC §7.3)', () => {
  it('t = 0 (now = prevAt) → exactly prev', () => {
    const r = received(pose(0, 0), pose(100, 0), 1000, 1050);
    expect(interpolatePose(r, 1000)).toMatchObject({ x: 0, y: 0 });
  });

  it('mid-window ≈ linear lerp', () => {
    const r = received(pose(0, 0), pose(100, 200), 1000, 1050);
    const mid = interpolatePose(r, 1000 + INTERPOLATION_MS / 2);
    expect(mid.x).toBeCloseTo(50, 5);
    expect(mid.y).toBeCloseTo(100, 5);
    const q = interpolatePose(r, 1000 + INTERPOLATION_MS / 4);
    expect(q.x).toBeCloseTo(25, 5);
  });

  it('t ≥ 150 ms → exactly target, and holds past the window', () => {
    const r = received(pose(0, 0), pose(100, 200), 1000, 1050);
    expect(interpolatePose(r, 1150)).toMatchObject({ x: 100, y: 200 });
    expect(interpolatePose(r, 5000)).toMatchObject({ x: 100, y: 200 });
  });

  it('now < prevAt clamps to prev (no backwards extrapolation)', () => {
    const r = received(pose(10, 10), pose(50, 50), 1000, 1050);
    expect(interpolatePose(r, 500)).toMatchObject({ x: 10, y: 10 });
  });

  it('zone + moving pass through from the target; dir lerps the shortest arc', () => {
    const r = received(
      pose(0, 0, { dir: 350, zone: 'hall', moving: true }),
      pose(10, 0, { dir: 10, zone: 'stage', moving: false }),
      1000,
      1050,
    );
    const p = interpolatePose(r, 1000 + INTERPOLATION_MS / 2);
    expect(p.zone).toBe('stage');
    expect(p.moving).toBe(false);
    expect(p.dir).toBeCloseTo(0, 5); // 350 → 10 crosses 0/360, not the long way
    expect(interpolatePose(r, 1000).dir).toBeCloseTo(350, 5);
    expect(interpolatePose(r, 1150).dir).toBeCloseTo(10, 5);
  });

  it('returns a copy of the target (callers must not alias store state)', () => {
    const r = received(pose(0, 0), pose(100, 0), 1000, 1050);
    const p = interpolatePose(r, 2000);
    expect(p).not.toBe(r.target);
    expect(p).toEqual(r.target);
  });
});

describe('snap rule (>2 tiles = 64 px, SPEC §7.3)', () => {
  it('constants match the spec', () => {
    expect(INTERPOLATION_MS).toBe(150);
    expect(SNAP_DISTANCE_PX).toBe(64);
  });

  it('divergence ≤ 64 px: history untouched (same object)', () => {
    const r = received(pose(0, 0), pose(60, 0), 1000, 1050);
    expect(applySnap(r, 1050)).toBe(r);
  });

  it('divergence > 64 px: interpolation restarts from the target', () => {
    const r = received(pose(0, 0), pose(400, 0), 1000, 1050);
    const snapped = applySnap(r, 1050);
    expect(snapped.prev).toBe(r.target);
    expect(snapped.prevAt).toBe(1050);
    // → no 400 px glide: displayed immediately at the target.
    expect(interpolatePose(snapped, 1050)).toMatchObject({ x: 400, y: 0 });
  });

  it('exactly at the threshold is not a snap; 65 px is', () => {
    const at = received(pose(0, 0), pose(64, 0), 1000, 1050);
    expect(applySnap(at, 1050)).toBe(at);
    const over = received(pose(0, 0), pose(65, 0), 1000, 1050);
    expect(applySnap(over, 1050).prev).toBe(over.target);
  });
});

describe('lerpDir (shortest arc, wrapped to [0, 360))', () => {
  it('endpoints and wrap cases', () => {
    expect(lerpDir(0, 90, 0)).toBe(0);
    expect(lerpDir(0, 90, 1)).toBe(90);
    expect(lerpDir(0, 90, 0.5)).toBeCloseTo(45, 5);
    expect(lerpDir(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(lerpDir(10, 350, 0.5)).toBeCloseTo(0, 5);
    expect(lerpDir(300, 60, 0.5)).toBeCloseTo(0, 5);
  });
});

describe('camera math (§9.1 overlay)', () => {
  const cam = { scrollX: 100, scrollY: 50, zoom: 2, width: 800, height: 600 };

  it('readCamera snapshots a (structural) camera', () => {
    expect(readCamera(cam)).toEqual({ scrollX: 100, scrollY: 50, zoom: 2, width: 800, height: 600 });
  });

  it('worldToScreen / screenToWorld roundtrip', () => {
    const s = worldToScreen({ x: 300, y: 200 }, cam);
    expect(s).toEqual({ x: 400, y: 300 });
    expect(screenToWorld(s, cam)).toEqual({ x: 300, y: 200 });
    for (const w of [
      { x: 0, y: 0 },
      { x: 1280, y: 960 },
      { x: 656.5, y: 464.25 },
    ]) {
      expect(screenToWorld(worldToScreen(w, cam), cam)).toEqual(w);
    }
  });

  it('zoom clamps per SPEC §5.3', () => {
    expect(MIN_ZOOM).toBe(0.5);
    expect(MAX_ZOOM).toBe(2.5);
  });
});
