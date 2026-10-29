// Planner tests (SPEC §8.4 / §9.1 / §9.2 / §9.3) over a REAL Store instance:
// audible-set falloff boundary, zone blocking + directed audibleFrom,
// silent zones, mute controls, pose-less, deafen, off tier; video radius
// boundary, zone rule, MAX_VIDEO_SOURCES cap, on-stage 4-nearest, and the
// §9.3 stage-share visibility rule.

import { describe, expect, it, vi } from 'vitest';

import { Store } from '../src/store';
import {
  TILE_SIZE,
  type MapData,
  type Pose,
  type ReceivedPose,
  type RemoteState,
  type ZoneDef,
} from '../src/types';
import { MAX_VIDEO_SOURCES } from '../src/jitsi/constraints';
import { computeAudibleSourceNames, computeVideoPlan, debounce } from '../src/spatial/plan';

const zone = (id: string, x: number, y: number, w: number, h: number, extra: Partial<ZoneDef> = {}): ZoneDef => ({
  id,
  silent: false,
  audibleFrom: [],
  stage: false,
  x,
  y,
  w,
  h,
  ...extra,
});

const map: MapData = {
  id: 'test',
  width: 40,
  height: 30,
  widthPx: 1280,
  heightPx: 960,
  tileWidth: 32,
  tileHeight: 32,
  zones: [
    zone('hall', 0, 0, 640, 320),
    zone('stage', 640, 0, 640, 320, { audibleFrom: ['hall'], stage: true }),
    zone('breakout-1', 0, 320, 320, 320),
    zone('nook', 320, 320, 320, 320, { silent: true }),
  ],
  spawns: [{ id: 's1', x: 100, y: 100 }],
  collision: new Uint8Array(40 * 30),
};

const pose = (x: number, y: number, z: string | null = 'hall'): Pose => ({ x, y, dir: 0, zone: z, moving: false });
const received = (p: Pose): ReceivedPose => ({ target: p, prev: p, prevAt: 0, at: Date.now() });

function makeStore(): Store {
  const s = new Store();
  s.setMap(map);
  s.setLocalId('me');
  s.setLocalPose(pose(100, 100));
  return s;
}

/** Remote participant with an audio source. `poseAt: null` → pose-less. */
function addRemote(s: Store, id: string, over: Partial<RemoteState> & { poseAt?: Pose | null } = {}): void {
  const { poseAt, ...rest } = over;
  s.upsertParticipant(id, {
    name: id,
    hasAudio: true,
    audioSourceName: `${id}-a0`,
    joinedAt: Date.now(),
    pose: poseAt === null ? null : received(poseAt ?? pose(150, 100)),
    ...rest,
  });
}

function addVideo(s: Store, id: string, p: Pose, over: Partial<RemoteState> = {}): void {
  s.upsertParticipant(id, {
    name: id,
    hasVideo: true,
    videoSourceName: `${id}-v0`,
    joinedAt: Date.now(),
    pose: received(p),
    ...over,
  });
}

function addSharer(s: Store, id: string, p: Pose | null, over: Partial<RemoteState> = {}): void {
  s.upsertParticipant(id, {
    name: id,
    hasDesktop: true,
    desktopSourceName: `${id}-v0`,
    joinedAt: Date.now(),
    pose: p ? received(p) : null,
    ...over,
  });
}

describe('computeAudibleSourceNames (§8.4)', () => {
  it('distance falloff boundary: just inside 8 tiles audible, just outside not', () => {
    const s = makeStore();
    addRemote(s, 'in', { poseAt: pose(100 + 7.9 * TILE_SIZE, 100) });
    addRemote(s, 'out', { poseAt: pose(100 + 8.1 * TILE_SIZE, 100) });
    const names = computeAudibleSourceNames(s, 'me');
    expect(names).toContain('in-a0');
    expect(names).not.toContain('out-a0');
  });

  it('different zones block', () => {
    const s = makeStore();
    addRemote(s, 'room', { poseAt: pose(100, 340, 'breakout-1') }); // 7.5 tiles, pure zone rule
    expect(computeAudibleSourceNames(s, 'me')).toEqual([]);
  });

  it('audibleFrom is directed: hall hears stage, stage does not hear hall', () => {
    const s = makeStore();
    s.setLocalPose(pose(550, 100, 'hall')); // near the stage boundary (3.1 tiles)
    addRemote(s, 'onstage', { poseAt: pose(650, 100, 'stage') });
    expect(computeAudibleSourceNames(s, 'me')).toEqual(['onstage-a0']);

    const s2 = makeStore();
    s2.setLocalPose(pose(650, 100, 'stage'));
    addRemote(s2, 'inhall', { poseAt: pose(600, 100, 'hall') }); // 1.6 tiles, pure zone rule
    expect(computeAudibleSourceNames(s2, 'me')).toEqual([]);
    addRemote(s2, 'fellowstage', { poseAt: pose(700, 100, 'stage') }); // same zone → audible
    expect(computeAudibleSourceNames(s2, 'me')).toEqual(['fellowstage-a0']);
  });

  it('silent zone occupants are excluded', () => {
    const s = makeStore();
    s.setLocalPose(pose(400, 310)); // in hall, adjacent to the nook
    addRemote(s, 'nooker', { poseAt: pose(400, 340, 'nook') });
    expect(computeAudibleSourceNames(s, 'me')).toEqual([]);
  });

  it('micMuted and mutedForMe are excluded', () => {
    const s = makeStore();
    addRemote(s, 'micmuted', { micMuted: true });
    addRemote(s, 'mutedforme', { mutedForMe: true });
    addRemote(s, 'ok');
    expect(computeAudibleSourceNames(s, 'me')).toEqual(['ok-a0']);
  });

  it('participants without audio are excluded', () => {
    const s = makeStore();
    addRemote(s, 'noaudio', { hasAudio: false });
    addRemote(s, 'nosource', { audioSourceName: null });
    expect(computeAudibleSourceNames(s, 'me')).toEqual([]);
  });

  it('pose-less participants are included (§7.7), fresh pose-less ones are not', () => {
    const s = makeStore();
    addRemote(s, 'stock', { poseAt: null, joinedAt: Date.now() - 11_000 });
    addRemote(s, 'fresh', { poseAt: null, joinedAt: Date.now() });
    expect(computeAudibleSourceNames(s, 'me')).toEqual(['stock-a0']);
  });

  it('deafened ⇒ empty (unsubscribe all, §8.4)', () => {
    const s = makeStore();
    addRemote(s, 'near');
    s.setSettings({ deafened: true });
    expect(computeAudibleSourceNames(s, 'me')).toEqual([]);
  });

  it('tier off ⇒ every participant with audioSourceName + hasAudio (§8.5)', () => {
    const s = makeStore();
    addRemote(s, 'near');
    addRemote(s, 'far', { poseAt: pose(100 + 30 * TILE_SIZE, 100) });
    addRemote(s, 'muted', { micMuted: true });
    addRemote(s, 'mutedforme', { mutedForMe: true });
    addRemote(s, 'nooker', { poseAt: pose(400, 340, 'nook') });
    addRemote(s, 'poseless', { poseAt: null, joinedAt: Date.now() - 11_000 });
    addRemote(s, 'me'); // local id never appears
    s.setSettings({ tier: 'off' });
    // Sorted; the local id ('me') never appears.
    expect(computeAudibleSourceNames(s, 'me')).toEqual([
      'far-a0',
      'muted-a0',
      'mutedforme-a0',
      'near-a0',
      'nooker-a0',
      'poseless-a0',
    ]);
  });

  it('output is sorted for stability', () => {
    const s = makeStore();
    for (const id of ['zeta', 'alpha', 'mid']) addRemote(s, id);
    expect(computeAudibleSourceNames(s, 'me')).toEqual(['alpha-a0', 'mid-a0', 'zeta-a0']);
  });
});

describe('computeVideoPlan (§9.1/§9.2/§9.3)', () => {
  it('video radius boundary: inside 6 tiles selected, outside not', () => {
    const s = makeStore();
    addVideo(s, 'in', pose(100 + 5.9 * TILE_SIZE, 100));
    addVideo(s, 'out', pose(100 + 6.1 * TILE_SIZE, 100));
    const plan = computeVideoPlan(s, 'me', { stageDesktopOpen: false });
    expect(plan.selectedSources).toEqual(['in-v0']);
  });

  it('zone rule: stage source visible from hall; hall source not visible from stage', () => {
    const s = makeStore();
    s.setLocalPose(pose(550, 100, 'hall'));
    addVideo(s, 'onstage', pose(650, 100, 'stage'));
    expect(computeVideoPlan(s, 'me', { stageDesktopOpen: false }).selectedSources).toEqual(['onstage-v0']);

    const s2 = makeStore();
    s2.setLocalPose(pose(650, 100, 'stage'));
    addVideo(s2, 'inhall', pose(550, 100, 'hall'));
    expect(computeVideoPlan(s2, 'me', { stageDesktopOpen: false }).selectedSources).toEqual([]);
  });

  it('camera-off and pose-less participants are excluded', () => {
    const s = makeStore();
    addVideo(s, 'off', pose(150, 100), { camMuted: true });
    addVideo(s, 'poseless', pose(150, 100), { pose: null });
    expect(computeVideoPlan(s, 'me', { stageDesktopOpen: false }).selectedSources).toEqual([]);
  });

  it('caps at MAX_VIDEO_SOURCES (16), keeping the nearest', () => {
    const s = makeStore();
    for (let i = 0; i < 20; i++) addVideo(s, `p${i}`, pose(100 + 0.2 * i * TILE_SIZE, 100));
    const plan = computeVideoPlan(s, 'me', { stageDesktopOpen: false });
    expect(plan.selectedSources).toHaveLength(MAX_VIDEO_SOURCES);
    expect(plan.selectedSources[0]).toBe('p0-v0');
    expect(plan.selectedSources).toContain('p15-v0');
    expect(plan.selectedSources).not.toContain('p16-v0');
    expect(plan.selectedSources).not.toContain('p19-v0');
  });

  it('onStageSources = 4 nearest, hiResSources = nearest 4', () => {
    const s = makeStore();
    for (let i = 0; i < 10; i++) addVideo(s, `p${i}`, pose(100 + 0.5 * i * TILE_SIZE, 100));
    const plan = computeVideoPlan(s, 'me', { stageDesktopOpen: false });
    expect(plan.onStageSources).toEqual(['p0-v0', 'p1-v0', 'p2-v0', 'p3-v0']);
    expect(plan.hiResSources).toEqual(['p0-v0', 'p1-v0', 'p2-v0', 'p3-v0']);
  });

  it('empty plan when nothing is selected (tells the bridge to receive nothing)', () => {
    expect(computeVideoPlan(makeStore(), 'me', { stageDesktopOpen: false })).toEqual({
      selectedSources: [],
      onStageSources: [],
      hiResSources: [],
      stageDesktopSource: null,
    });
  });

  it('empty plan when the local avatar has no pose', () => {
    const s = new Store();
    s.setMap(map);
    s.setLocalId('me');
    addVideo(s, 'near', pose(150, 100));
    expect(computeVideoPlan(s, 'me', { stageDesktopOpen: true }).selectedSources).toEqual([]);
  });

  describe('stage desktop (§9.3)', () => {
    const sharerInStage = (s: Store): void => addSharer(s, 'sh', pose(700, 100, 'stage'));

    it('visible from a zone related by audibleFrom (hall hears stage)', () => {
      const s = makeStore();
      s.setLocalPose(pose(550, 100, 'hall'));
      sharerInStage(s);
      expect(computeVideoPlan(s, 'me', { stageDesktopOpen: true }).stageDesktopSource).toBe('sh-v0');
    });

    it('hidden from an unrelated zone (breakout-1) → null, not swallowed silently by plan', () => {
      const s = makeStore();
      s.setLocalPose(pose(100, 400, 'breakout-1'));
      sharerInStage(s);
      expect(computeVideoPlan(s, 'me', { stageDesktopOpen: true }).stageDesktopSource).toBeNull();
    });

    it('null when the panel is closed', () => {
      const s = makeStore();
      s.setLocalPose(pose(550, 100, 'hall'));
      sharerInStage(s);
      expect(computeVideoPlan(s, 'me', { stageDesktopOpen: false }).stageDesktopSource).toBeNull();
    });

    it('visible from the sharer zone itself', () => {
      const s = makeStore();
      s.setLocalPose(pose(700, 150, 'stage'));
      sharerInStage(s);
      expect(computeVideoPlan(s, 'me', { stageDesktopOpen: true }).stageDesktopSource).toBe('sh-v0');
    });

    it('pose-less sharer is always viewable (§7.7)', () => {
      const s = makeStore();
      s.setLocalPose(pose(100, 400, 'breakout-1'));
      addSharer(s, 'sh', null);
      expect(computeVideoPlan(s, 'me', { stageDesktopOpen: true }).stageDesktopSource).toBe('sh-v0');
    });
  });
});

describe('debounce', () => {
  it('trailing-edge: latest args win, cancel() drops the pending call', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = debounce(fn, 500);
      d(1);
      d(2);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(2);
      d(3);
      d.cancel();
      vi.advanceTimersByTime(500);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
