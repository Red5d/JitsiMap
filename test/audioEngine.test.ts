// Audio engine tests (SPEC §8.1/§8.5/§8.6) with a mocked AudioContext + a
// REAL Store: graph shape, tier behaviour, mute/deafen/master multiplication,
// distance gain + pan clamping from poses, pose-less/off-tier flats, teardown,
// late-track handling, and the setTargetAtTime change cache.
//
// Node index conventions of the mock: gains[0] is always the master (created
// in start()); per attach: spatial gain, then user gain (panners in a
// separate list).

import { describe, expect, it, vi } from 'vitest';
import { ATTACH_MUTED_ELEMENT, createAudioEngine } from '../src/spatial/audioEngine';
import { distanceGain, OFF_TIER_GAIN, POSELESS_GAIN } from '../src/spatial/distance';
import { Store } from '../src/store';
import { type MapData, type Pose, type RemoteState, TILE_SIZE, type ZoneDef } from '../src/types';

// ------------------------------------------------ AudioContext mock

class MockParam {
  value = 1;
  writes: { target: number; time: number; tau: number }[] = [];
  setTargetAtTime(target: number, time: number, tau: number): void {
    this.writes.push({ target, time, tau });
  }
}

class MockNode {
  outputs: MockNode[] = [];
  disconnects = 0;
  constructor(readonly kind: string) {}
  connect(dest: MockNode): MockNode {
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.disconnects += 1;
    this.outputs = [];
  }
}

class MockGain extends MockNode {
  gain = new MockParam();
}
class MockPanner extends MockNode {
  pan = new MockParam();
}

interface MockCtx {
  state: string;
  currentTime: number;
  destination: MockNode;
  resumeCount: number;
  gains: MockGain[];
  panners: MockPanner[];
  sources: MockNode[];
  createGain(): MockGain;
  createMediaStreamSource(stream: unknown): MockNode;
  createStereoPanner?: () => MockPanner;
  resume(): Promise<void>;
}

function makeCtx(opts: { stereoPanner?: boolean } = {}): MockCtx {
  const ctx: MockCtx = {
    state: 'suspended',
    currentTime: 1.5,
    destination: new MockNode('destination'),
    resumeCount: 0,
    gains: [],
    panners: [],
    sources: [],
    createGain(): MockGain {
      const g = new MockGain('gain');
      ctx.gains.push(g);
      return g;
    },
    createMediaStreamSource(stream: unknown): MockNode {
      const n = new MockNode('source');
      (n as MockNode & { stream: unknown }).stream = stream;
      ctx.sources.push(n);
      return n;
    },
    resume(): Promise<void> {
      ctx.resumeCount += 1;
      ctx.state = 'running';
      return Promise.resolve();
    },
  };
  if (opts.stereoPanner !== false) {
    ctx.createStereoPanner = (): MockPanner => {
      const p = new MockPanner('panner');
      ctx.panners.push(p);
      return p;
    };
  }
  return ctx;
}

type MockCtxT = MockCtx;
const asAudio = (c: MockCtxT): AudioContext => c as unknown as AudioContext;
const lastTarget = (p: MockParam): number | undefined => p.writes.at(-1)?.target;

// ------------------------------------------------ store fixtures

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
    zone('nook', 320, 320, 320, 320, { silent: true }),
  ],
  spawns: [{ id: 's1', x: 100, y: 100 }],
  collision: new Uint8Array(40 * 30),
};

const pose = (x: number, y: number, z: string | null = 'hall'): Pose => ({ x, y, dir: 0, zone: z, moving: false });

const liveTrack = (): unknown => ({
  getOriginalStream: () => ({ getAudioTracks: () => [{ id: 'a1' }] }),
});

function setup(tier: 'auto' | 'full' | 'gain' | 'off' = 'full', ctxOpts = {}) {
  const store = new Store();
  store.setMap(map);
  store.setLocalId('me');
  store.setLocalPose(pose(100, 100));
  store.setSettings({ tier });
  const ctx = makeCtx(ctxOpts);
  const engine = createAudioEngine(store);
  engine.start(asAudio(ctx));
  return { store, ctx, engine };
}

/** Speaker 1 tile right of the local user (x=132) in the hall, with a live track. */
function addSpeaker(store: Store, id: string, over: Partial<RemoteState> = {}): void {
  const p = pose(132, 100);
  store.upsertParticipant(id, {
    name: id,
    hasAudio: true,
    audioSourceName: `${id}-a0`,
    joinedAt: Date.now(),
    audioTrack: liveTrack(),
    pose: { target: p, prev: p, prevAt: 0, at: Date.now() },
    ...over,
  });
}

describe('lifecycle (§8.6)', () => {
  it('ctxState is null before start; start creates master→destination and resumes the ctx', () => {
    const store = new Store();
    const engine = createAudioEngine(store);
    expect(engine.ctxState()).toBeNull();
    const ctx = makeCtx();
    engine.start(asAudio(ctx));
    expect(ctx.gains).toHaveLength(1); // master only
    expect(ctx.gains[0]!.outputs).toEqual([ctx.destination]);
    expect(ctx.gains[0]!.gain.value).toBe(1); // masterVolume default
    expect(ctx.resumeCount).toBe(1);
    expect(engine.ctxState()).toBe('running');
  });

  it('resume() calls ctx.resume; dispose() nulls the state and is idempotent', () => {
    const { ctx, engine } = setup();
    engine.resume();
    expect(ctx.resumeCount).toBe(2);
    engine.dispose();
    expect(engine.ctxState()).toBeNull();
    expect(() => engine.dispose()).not.toThrow();
  });
});

describe('graph shape (§8.1)', () => {
  it('full tier: source → spatial → panner → user → master → destination', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    const [master, spatial, user] = ctx.gains;
    const source = ctx.sources[0]!;
    const panner = ctx.panners[0]!;
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.panners).toHaveLength(1);
    expect(source.outputs).toEqual([spatial]);
    expect(spatial!.outputs).toEqual([panner]);
    expect(panner.outputs).toEqual([user]);
    expect(user!.outputs).toEqual([master]);
    expect(master!.outputs).toEqual([ctx.destination]);
    expect(spatial!.gain.value).toBe(0); // silent until the first update()
  });

  it('gain tier skips the panner: source → spatial → user → master', () => {
    const { store, ctx, engine } = setup('gain');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    expect(ctx.panners).toHaveLength(0);
    const [, spatial, user] = ctx.gains;
    expect(spatial!.outputs).toEqual([user]);
  });

  it('auto resolves to full when StereoPannerNode exists, gain when it does not (§8.5)', () => {
    const a = setup('auto');
    addSpeaker(a.store, 'p1');
    a.engine.attachParticipant('p1');
    expect(a.ctx.panners).toHaveLength(1);

    const b = setup('auto', { stereoPanner: false });
    addSpeaker(b.store, 'p1');
    b.engine.attachParticipant('p1');
    expect(b.ctx.panners).toHaveLength(0);
    expect(b.ctx.sources).toHaveLength(1); // graph still built
  });

  it('ATTACH_MUTED_ELEMENT is false — no element attach by default (§8.6)', () => {
    expect(ATTACH_MUTED_ELEMENT).toBe(false);
  });
});

describe('update() gain + pan (§8.1/§8.2/§8.3/§8.5)', () => {
  it('applies distance gain and clamped pan via setTargetAtTime τ=0.05', () => {
    const { store, ctx, engine } = setup('full');
    store.setLocalPose(pose(100, 100));
    addSpeaker(store, 'p1');
    store.setRemotePose('p1', pose(100 + 4 * TILE_SIZE, 100), Date.now()); // 4 tiles right
    engine.attachParticipant('p1');
    engine.update(Date.now());
    const spatial = ctx.gains[1]!;
    const panner = ctx.panners[0]!;
    expect(lastTarget(spatial.gain)).toBeCloseTo(distanceGain(4), 10);
    expect(panner.pan.writes.at(-1)!.tau).toBe(0.05);
    expect(lastTarget(panner.pan)).toBeCloseTo(0.5, 10);
  });

  it('pan clamps to ±0.8', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    store.setRemotePose('p1', pose(100 + 200 * TILE_SIZE, 100), Date.now());
    engine.attachParticipant('p1');
    engine.update(Date.now());
    expect(lastTarget(ctx.panners[0]!.pan)).toBe(0.8);
  });

  it('muted mic ⇒ spatial gain 0 regardless of distance (§8.1)', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1', { micMuted: true });
    engine.attachParticipant('p1');
    engine.update(Date.now());
    expect(lastTarget(ctx.gains[1]!.gain)).toBe(0);
  });

  it('mutedForMe ⇒ spatial gain 0 (§8.5)', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1', { mutedForMe: true });
    engine.attachParticipant('p1');
    engine.update(Date.now());
    expect(lastTarget(ctx.gains[1]!.gain)).toBe(0);
  });

  it('per-user volume lands on the user node (0..2)', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    store.setParticipantControls('p1', { volume: 1.5 });
    engine.update(Date.now());
    expect(lastTarget(ctx.gains[2]!.gain)).toBe(1.5);
  });

  it('master node = masterVolume; deafen ⇒ 0 (§8.5)', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    store.setSettings({ masterVolume: 0.5 });
    engine.update(Date.now());
    expect(lastTarget(ctx.gains[0]!.gain)).toBe(0.5);
    store.setSettings({ deafened: true });
    engine.update(Date.now());
    expect(lastTarget(ctx.gains[0]!.gain)).toBe(0);
  });

  it('zone-blocked speaker ⇒ gain 0 (§8.3)', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    store.setRemotePose('p1', pose(400, 340, 'nook'), Date.now()); // silent zone, ~0.9 tiles
    engine.attachParticipant('p1');
    engine.update(Date.now());
    expect(lastTarget(ctx.gains[1]!.gain)).toBe(0);
  });

  it('pose-less: flat POSELESS_GAIN, pan 0, zones ignored (§7.7)', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1', { pose: null, joinedAt: Date.now() - 11_000 });
    engine.attachParticipant('p1');
    engine.update(Date.now());
    expect(lastTarget(ctx.gains[1]!.gain)).toBe(POSELESS_GAIN);
    expect(lastTarget(ctx.panners[0]!.pan) ?? 0).toBe(0);
  });

  it('off tier: flat OFF_TIER_GAIN for every attached participant, no panner (§8.5)', () => {
    const { store, ctx, engine } = setup('off');
    addSpeaker(store, 'near');
    addSpeaker(store, 'far');
    store.setRemotePose('far', pose(100 + 30 * TILE_SIZE, 100), Date.now());
    engine.attachParticipant('near'); // gains[1] spatial, gains[2] user
    engine.attachParticipant('far'); // gains[3] spatial, gains[4] user
    engine.update(Date.now());
    expect(ctx.panners).toHaveLength(0);
    expect(lastTarget(ctx.gains[1]!.gain)).toBe(OFF_TIER_GAIN);
    expect(lastTarget(ctx.gains[3]!.gain)).toBe(OFF_TIER_GAIN);
  });

  it('change cache: identical recomputation writes no setTargetAtTime', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    engine.update(Date.now());
    const spatial = ctx.gains[1]!;
    const writes = spatial.gain.writes.length;
    engine.update(Date.now() + 16);
    engine.update(Date.now() + 32);
    expect(spatial.gain.writes).toHaveLength(writes);
    store.setRemotePose('p1', pose(100 + 6 * TILE_SIZE, 100), Date.now());
    engine.update(Date.now() + 48);
    expect(spatial.gain.writes.length).toBe(writes + 1);
  });

  it('tier change full → gain rewires spatial → user and disconnects the panner', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    engine.update(Date.now());
    store.setSettings({ tier: 'gain' });
    engine.update(Date.now() + 16);
    expect(ctx.panners[0]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.gains[1]!.outputs).toEqual([ctx.gains[2]]);
  });

  it('update() before start and after dispose are no-ops; removed participants are skipped', () => {
    const engine = createAudioEngine(new Store());
    expect(() => engine.update(Date.now())).not.toThrow();
    const { store, ctx, engine: e } = setup('full');
    addSpeaker(store, 'p1');
    e.attachParticipant('p1');
    e.update(Date.now());
    const writes = ctx.gains[1]!.gain.writes.length;
    store.removeParticipant('p1');
    expect(() => e.update(Date.now())).not.toThrow();
    expect(ctx.gains[1]!.gain.writes).toHaveLength(writes);
    e.dispose();
    expect(() => e.update(Date.now())).not.toThrow();
    expect(e.ctxState()).toBeNull();
  });
});

describe('attach / detach', () => {
  it('attach before start is a no-op', () => {
    const store = new Store();
    store.setMap(map);
    store.setLocalId('me');
    addSpeaker(store, 'p1');
    const ctx = makeCtx();
    const engine = createAudioEngine(store);
    engine.attachParticipant('p1');
    expect(ctx.gains).toHaveLength(0);
    expect(ctx.sources).toHaveLength(0);
  });

  it('the local user never enters the graph (§6.4)', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'me');
    engine.attachParticipant('me');
    expect(ctx.sources).toHaveLength(0);
  });

  it('missing/late track: no-op, then attach succeeds when the track arrives', () => {
    const { store, ctx, engine } = setup('full');
    store.upsertParticipant('p1', { hasAudio: true, audioSourceName: 'p1-a0', audioTrack: null });
    engine.attachParticipant('p1');
    expect(ctx.sources).toHaveLength(0);
    store.upsertParticipant('p1', { audioTrack: liveTrack() });
    engine.attachParticipant('p1');
    expect(ctx.sources).toHaveLength(1);
  });

  it('track without a live stream: skipped, warned once (§8.6 no empty-source attach)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { store, ctx, engine } = setup('full');
      const dead = { getOriginalStream: () => null };
      store.upsertParticipant('p1', { audioTrack: dead });
      engine.attachParticipant('p1');
      engine.attachParticipant('p1');
      store.upsertParticipant('p1', { audioTrack: { getOriginalStream: () => ({ getAudioTracks: () => [] }) } });
      engine.attachParticipant('p1');
      expect(ctx.sources).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('re-attach while attached does not duplicate the graph', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    engine.attachParticipant('p1');
    expect(ctx.sources).toHaveLength(1);
  });

  it('detach disconnects every node in the chain', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    const source = ctx.sources[0]!;
    const spatial = ctx.gains[1]!;
    const panner = ctx.panners[0]!;
    const user = ctx.gains[2]!;
    engine.detachParticipant('p1');
    for (const n of [source, spatial, panner, user]) expect(n.disconnects).toBeGreaterThanOrEqual(1);
    expect(spatial.outputs).toEqual([]);
  });

  it('detach → re-attach builds a fresh graph; detach of unknown ids is a no-op', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    engine.attachParticipant('p1');
    engine.detachParticipant('p1');
    engine.attachParticipant('p1');
    expect(ctx.sources).toHaveLength(2); // old (disconnected) + new
    const [master, firstSpatial, firstUser, secondSpatial, secondUser] = ctx.gains;
    expect(ctx.sources[1]!.outputs).toEqual([secondSpatial]);
    expect(secondUser!.outputs).toEqual([master]);
    expect(firstSpatial!.outputs).toEqual([]); // detached chain stays disconnected
    expect(firstUser!.outputs).toEqual([]);
    expect(() => engine.detachParticipant('ghost')).not.toThrow();
  });

  it('dispose disconnects every chain and the master', () => {
    const { store, ctx, engine } = setup('full');
    addSpeaker(store, 'p1');
    addSpeaker(store, 'p2');
    engine.attachParticipant('p1');
    engine.attachParticipant('p2');
    engine.dispose();
    for (const n of [...ctx.sources, ...ctx.gains, ...ctx.panners]) {
      expect(n.disconnects).toBeGreaterThanOrEqual(1);
    }
    expect(engine.ctxState()).toBeNull();
  });
});
