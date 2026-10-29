/**
 * Unit tests for the §7 state machine (messaging.ts) and the §9.2
 * constraint mapping (constraints.ts) — the adapter's pure logic.
 * client.ts is browser-only (lib-jitsi-meet UMD) and is NOT imported here.
 */

import type { JitsiConference } from 'lib-jitsi-meet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoPlan } from '../src/jitsi/api';
import { applyReceiverConstraints, buildReceiverConstraints, MAX_VIDEO_SOURCES } from '../src/jitsi/constraints';
import { MessagingHub, type MessagingStore, POSE_SWEEP_INTERVAL_MS } from '../src/jitsi/messaging';
import {
  EMOTE_RATE_LIMIT_MS,
  type EncodedMessage,
  encodeAvatar,
  encodeHello,
  encodePose,
  encodeState,
  encodeStateRequest,
  POSE_HEARTBEAT_MS,
  STATE_REQUEST_DELAY_MS,
  type ValidationCtx,
} from '../src/protocol';
import type { AvatarInfo, Emote, Pose, RemoteState, ZoneDef } from '../src/types';

const CTX: ValidationCtx = {
  widthPx: 1280,
  heightPx: 960,
  zoneIds: new Set(['hall', 'stage']),
};

const poseAt = (x: number, y: number, zone: string | null = 'hall', moving = true): Pose => ({
  x,
  y,
  dir: 0,
  zone,
  moving,
});

// ---------------------------------------------------------------- fake store

function baseRemote(id: string, patch: Partial<RemoteState> = {}): RemoteState {
  return {
    id,
    name: '',
    avatar: { emoji: '🙂' },
    pose: null,
    lastSeen: 0,
    joinedAt: 0,
    micMuted: false,
    camMuted: false,
    hasAudio: false,
    hasVideo: false,
    hasDesktop: false,
    audioSourceName: null,
    videoSourceName: null,
    desktopSourceName: null,
    audioLevel: 0,
    volume: 1,
    mutedForMe: false,
    audioTrack: null,
    videoTrack: null,
    desktopTrack: null,
    ...patch,
  };
}

class FakeStore implements MessagingStore {
  participants = new Map<string, RemoteState>();
  emotes: Emote[] = [];
  expireCalls: number[] = [];
  local = {
    id: 'me',
    name: 'Me',
    avatar: { emoji: '🧙' } as AvatarInfo,
    pose: null as Pose | null,
  };
  localZone = null as ZoneDef | null;

  getParticipant(id: string): RemoteState | undefined {
    return this.participants.get(id);
  }
  upsertParticipant(id: string, patch: Partial<Omit<RemoteState, 'id'>>): RemoteState {
    const existing = this.participants.get(id);
    const next = existing ? { ...existing, ...patch } : baseRemote(id, patch);
    this.participants.set(id, next);
    return next;
  }
  removeParticipant(id: string): void {
    this.participants.delete(id);
  }
  setRemotePose(id: string, pose: Pose, now: number): void {
    const p = this.participants.get(id);
    if (!p) return;
    p.pose = { target: pose, prev: pose, prevAt: now, at: now };
    p.lastSeen = now;
  }
  expirePoses(now: number): void {
    this.expireCalls.push(now);
  }
  emitEmote(e: Emote): void {
    this.emotes.push(e);
  }
  getLocalPose(): Pose | null {
    return this.local.pose;
  }
  getSnapshot() {
    return { local: this.local, localZone: this.localZone };
  }
}

// ---------------------------------------------------------------- harness

interface Harness {
  hub: MessagingHub;
  store: FakeStore;
  broadcasts: EncodedMessage[];
  directs: Array<{ to: string; msg: EncodedMessage }>;
  sent: (type: string) => EncodedMessage[];
}

function makeHub(): Harness {
  const store = new FakeStore();
  const broadcasts: EncodedMessage[] = [];
  const directs: Array<{ to: string; msg: EncodedMessage }> = [];
  const hub = new MessagingHub({
    sendBroadcast: (m) => broadcasts.push(m),
    sendDirect: (to, m) => directs.push({ to, msg: m }),
    selfId: 'me',
    getMapCtx: () => CTX,
    store,
    now: () => Date.now(),
  });
  return {
    hub,
    store,
    broadcasts,
    directs,
    sent: (type) => broadcasts.filter((m) => m.type === type),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------- §7.4 join exchange

describe('join-time exchange (§7.4)', () => {
  it('start broadcasts hello + pose, then state-request exactly 300 ms later', () => {
    const { hub, broadcasts } = makeHub();
    hub.start(poseAt(64, 96));
    expect(broadcasts.map((m) => m.type)).toEqual(['hello', 'pose']);
    const hello = broadcasts[0] as Extract<EncodedMessage, { type: 'hello' }>;
    expect(hello).toMatchObject({ name: 'Me', avatar: '🧙', zone: 'hall' });
    const pose = broadcasts[1] as Extract<EncodedMessage, { type: 'pose' }>;
    expect(pose).toMatchObject({ x: 64, y: 96, zone: 'hall' });

    vi.advanceTimersByTime(STATE_REQUEST_DELAY_MS - 1);
    expect(broadcasts.map((m) => m.type)).toEqual(['hello', 'pose']);
    vi.advanceTimersByTime(1);
    expect(broadcasts.map((m) => m.type)).toEqual(['hello', 'pose', 'state-request']);
  });

  it('replies direct state to a hello from an unknown endpoint', () => {
    const { hub, store, directs } = makeHub();
    store.local.pose = poseAt(100, 120, 'hall', false);
    hub.start(store.local.pose);

    const decoded = hub.onEndpointMessage('peer-1', encodeHello('Peer', { emoji: '🐱' }, 'stage'));
    expect(decoded).toEqual({ type: 'hello', name: 'Peer', avatar: { emoji: '🐱' }, zone: 'stage' });
    expect(store.getParticipant('peer-1')?.name).toBe('Peer');
    expect(store.getParticipant('peer-1')?.avatar).toEqual({ emoji: '🐱' });
    expect(directs).toHaveLength(1);
    expect(directs[0]!.to).toBe('peer-1');
    expect(directs[0]!.msg).toMatchObject({
      type: 'state',
      name: 'Me',
      avatar: '🧙',
      x: 100,
      y: 120,
      zone: 'hall',
    });
  });

  it('replies direct state to a state-request from an unknown endpoint', () => {
    const { hub, store, directs } = makeHub();
    store.local.pose = poseAt(30, 40);
    hub.start(store.local.pose);
    // USER_JOINED created the participant, but WITHOUT a pose → still unknown.
    store.upsertParticipant('peer-2', { name: 'P2' });
    hub.onEndpointMessage('peer-2', encodeStateRequest());
    expect(directs).toHaveLength(1);
    expect(directs[0]!.to).toBe('peer-2');
  });

  it('does NOT reply to a peer whose map state is already known', () => {
    const { hub, store, directs } = makeHub();
    store.local.pose = poseAt(30, 40);
    hub.start(store.local.pose);
    store.participants.set(
      'peer-1',
      baseRemote('peer-1', { pose: { target: poseAt(9, 9), prev: poseAt(9, 9), prevAt: 0, at: 0 } }),
    );
    hub.onEndpointMessage('peer-1', encodeHello('Peer', { emoji: '🐱' }, null));
    hub.onEndpointMessage('peer-1', encodeStateRequest());
    expect(directs).toHaveLength(0);
  });

  it('state reply from an unknown endpoint upserts the participant + sets the pose', () => {
    const { hub, store } = makeHub();
    hub.start(poseAt(1, 1));
    const decoded = hub.onEndpointMessage(
      'peer-3',
      encodeState('Zoe', { emoji: '🦊' }, poseAt(200, 300, 'stage', true)),
    );
    expect(decoded?.type).toBe('state');
    const p = store.getParticipant('peer-3');
    expect(p?.name).toBe('Zoe');
    expect(p?.avatar).toEqual({ emoji: '🦊' });
    expect(p?.pose?.target).toEqual(poseAt(200, 300, 'stage', false)); // moving forced false by decode
  });
});

// ---------------------------------------------------------------- §7.3 pose sending

describe('pose send (§7.3)', () => {
  it('throttles movement to 8 Hz (POSE_SEND_INTERVAL_MS = 125)', () => {
    const { hub, broadcasts, sent } = makeHub();
    hub.start(poseAt(100, 100));
    broadcasts.length = 0;
    // Feed a 4 px step every 16 ms (>2 px per step, so significance is never
    // the limiter): 17 ticks span 272 ms → sends at 16 and 144 ms.
    let x = 100;
    for (let i = 0; i < 17; i++) {
      vi.advanceTimersByTime(16);
      x += 4;
      hub.feedPose(poseAt(x, 100));
    }
    expect(sent('pose')).toHaveLength(2);
    // Sends land at the first ticks ≥125 ms past the previous send:
    // t=128 (x=132) and t=256 (x=164); t=272 (x=168) is inside the window.
    expect((sent('pose')[0] as Extract<EncodedMessage, { type: 'pose' }>).x).toBe(132);
    expect((sent('pose')[1] as Extract<EncodedMessage, { type: 'pose' }>).x).toBe(164);
  });

  it('drops moves ≤2 px with unchanged dir/zone; sends when >2 px', () => {
    const { hub, broadcasts, sent } = makeHub();
    hub.start(poseAt(100, 100));
    broadcasts.length = 0;
    vi.advanceTimersByTime(200); // clear the throttle window
    hub.feedPose(poseAt(101, 100)); // 1 px → no send
    expect(sent('pose')).toHaveLength(0);
    hub.feedPose(poseAt(104.5, 100)); // >2 px from the LAST SENT pose → send
    expect(sent('pose')).toHaveLength(1);
  });

  it('flushes immediately on zone change, inside the throttle window', () => {
    const { hub, broadcasts, sent } = makeHub();
    hub.start(poseAt(100, 100));
    broadcasts.length = 0;
    vi.advanceTimersByTime(200);
    hub.feedPose(poseAt(110, 100)); // 10 px → sends, opens the window
    hub.feedPose(poseAt(111, 100, 'stage')); // same spot, new zone → immediate
    expect(sent('pose')).toHaveLength(2);
    expect((sent('pose')[1] as Extract<EncodedMessage, { type: 'pose' }>).zone).toBe('stage');
  });

  it('flushes immediately on stop, inside the throttle window', () => {
    const { hub, broadcasts, sent } = makeHub();
    hub.start(poseAt(100, 100));
    broadcasts.length = 0;
    vi.advanceTimersByTime(200);
    hub.feedPose(poseAt(110, 100, 'hall', true));
    vi.advanceTimersByTime(10);
    hub.feedPose(poseAt(112, 100, 'hall', false)); // stop → immediate final flush
    expect(sent('pose')).toHaveLength(2);
    expect(sent('pose')[1]).toMatchObject({ x: 112, moving: false });
  });

  it('sends nothing while idle; heartbeat re-broadcasts pose + avatar every 20 s', () => {
    const { hub, broadcasts } = makeHub();
    hub.start(poseAt(64, 64, 'hall', false));
    vi.advanceTimersByTime(STATE_REQUEST_DELAY_MS); // let the join-time state-request fire…
    broadcasts.length = 0; // …then start observing the idle period
    vi.advanceTimersByTime(POSE_HEARTBEAT_MS - STATE_REQUEST_DELAY_MS - 1);
    expect(broadcasts).toHaveLength(0);
    vi.advanceTimersByTime(1); // t = 20 s (interval anchored at start)
    expect(broadcasts.map((m) => m.type)).toEqual(['pose', 'avatar']);
    expect(broadcasts[0]).toMatchObject({ x: 64, y: 64, moving: false });
    expect(broadcasts[1]).toMatchObject({ avatar: '🧙' });
    vi.advanceTimersByTime(POSE_HEARTBEAT_MS);
    expect(broadcasts).toHaveLength(4);
    hub.stop();
    vi.advanceTimersByTime(POSE_HEARTBEAT_MS);
    expect(broadcasts).toHaveLength(4); // stop() kills the heartbeat
  });

  it('emote is rate-limited to ≤2/s (EMOTE_RATE_LIMIT_MS)', () => {
    const { hub, sent } = makeHub();
    hub.start(poseAt(1, 1));
    expect(hub.sendEmote('🔥')).toBe(true);
    expect(hub.sendEmote('🔥')).toBe(false); // same instant → dropped
    vi.advanceTimersByTime(EMOTE_RATE_LIMIT_MS - 1);
    expect(hub.sendEmote('🔥')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hub.sendEmote('🔥')).toBe(true);
    expect(sent('emote')).toHaveLength(2);
  });

  it('sendAvatar broadcasts the avatar message', () => {
    const { hub, sent } = makeHub();
    hub.start(poseAt(1, 1));
    hub.sendAvatar({ emoji: '🐧' });
    expect(sent('avatar').at(-1)).toMatchObject({ avatar: '🐧' });
  });
});

// ---------------------------------------------------------------- receiving

describe('receiving (§7.2/§7.3)', () => {
  it('drops messages from self', () => {
    const { hub, store, directs, broadcasts } = makeHub();
    hub.start(poseAt(1, 1));
    broadcasts.length = 0;
    expect(hub.onEndpointMessage('me', encodePose(poseAt(5, 5)))).toBeNull();
    expect(hub.onEndpointMessage('me', encodeHello('Me', { emoji: '🧙' }, null))).toBeNull();
    expect(directs).toHaveLength(0);
    expect(store.getParticipant('me')).toBeUndefined();
  });

  it('ignores foreign payloads without throwing', () => {
    const { hub, store } = makeHub();
    hub.start(poseAt(1, 1));
    for (const raw of [
      null,
      undefined,
      'pose',
      42,
      {},
      { ns: 'other', v: 1, type: 'pose', x: 1, y: 1 },
      { ns: 'jitsimap', v: 99, type: 'pose', x: 1, y: 1 }, // version mismatch
      { ns: 'jitsimap', v: 1, type: 'not-a-type' },
      { 'jwt-token': 'abc' }, // stock Meet endpoint message
      encodeAvatar({ emoji: '🙂', imageUrl: 'x'.repeat(600) }), // oversized non-https → drop
    ]) {
      expect(hub.onEndpointMessage('peer-1', raw)).toBeNull();
    }
    expect(store.getParticipant('peer-1')).toBeUndefined();
  });

  it('pose from a stranger creates the participant and sets the pose', () => {
    const { hub, store } = makeHub();
    hub.start(poseAt(1, 1));
    hub.onEndpointMessage('peer-9', encodePose(poseAt(40, 50, 'stage')));
    expect(store.getParticipant('peer-9')?.pose?.target).toEqual(poseAt(40, 50, 'stage'));
  });

  it('emote arrives as a store event; avatar change patches the participant', () => {
    const { hub, store } = makeHub();
    hub.start(poseAt(1, 1));
    hub.onEndpointMessage('peer-1', { ns: 'jitsimap', v: 1, type: 'emote', ts: 1, emoji: '🎃' });
    expect(store.emotes).toHaveLength(1);
    expect(store.emotes[0]).toMatchObject({ endpointId: 'peer-1', emoji: '🎃' });
    hub.onEndpointMessage('peer-1', encodeAvatar({ emoji: '⭐' }));
    expect(store.getParticipant('peer-1')?.avatar).toEqual({ emoji: '⭐' });
  });

  it('USER_LEFT removes the participant (§7.5)', () => {
    const { hub, store } = makeHub();
    hub.start(poseAt(1, 1));
    hub.onEndpointMessage('peer-1', encodePose(poseAt(40, 50)));
    expect(store.getParticipant('peer-1')).toBeDefined();
    hub.onUserLeft('peer-1');
    expect(store.getParticipant('peer-1')).toBeUndefined();
  });

  it('pose-expiry sweep runs on the 5 s interval', () => {
    const { hub, store } = makeHub();
    hub.start(poseAt(1, 1));
    expect(store.expireCalls).toHaveLength(0);
    vi.advanceTimersByTime(POSE_SWEEP_INTERVAL_MS);
    expect(store.expireCalls).toHaveLength(1);
    vi.advanceTimersByTime(POSE_SWEEP_INTERVAL_MS * 2);
    expect(store.expireCalls).toHaveLength(3);
    hub.stop();
    vi.advanceTimersByTime(POSE_SWEEP_INTERVAL_MS * 2);
    expect(store.expireCalls).toHaveLength(3); // stop() kills the sweep
  });
});

// ---------------------------------------------------------------- §9.2 mapping

describe('constraints.ts mapping (§9.2)', () => {
  const plan: VideoPlan = {
    selectedSources: ['a-v0', 'b-v0', 'c-v0'],
    onStageSources: ['a-v0'],
    hiResSources: ['a-v0', 'b-v0'],
    stageDesktopSource: null,
  };

  it('maps the plan to the lib payload', () => {
    expect(buildReceiverConstraints(plan)).toEqual({
      lastN: MAX_VIDEO_SOURCES,
      defaultConstraints: { maxHeight: 180 },
      constraints: { 'a-v0': { maxHeight: 360 }, 'b-v0': { maxHeight: 360 } },
      selectedSources: ['a-v0', 'b-v0', 'c-v0'],
      onStageSources: ['a-v0'],
    });
    expect(MAX_VIDEO_SOURCES).toBe(16);
  });

  it('puts the stage desktop share on stage at 720p and caps selectedSources at 16', () => {
    const many = Array.from({ length: 24 }, (_, i) => `s${i}-v0`);
    const rc = buildReceiverConstraints({
      selectedSources: many,
      onStageSources: [],
      hiResSources: ['s0-v0'],
      stageDesktopSource: 'd-v0',
    });
    expect(rc.selectedSources).toHaveLength(16);
    expect(rc.onStageSources).toEqual(['d-v0']);
    expect(rc.constraints?.['d-v0']).toEqual({ maxHeight: 720 });
    expect(rc.constraints?.['s0-v0']).toEqual({ maxHeight: 360 });
  });

  it('drops blank source names and de-duplicates', () => {
    const rc = buildReceiverConstraints({
      selectedSources: ['a-v0', '', '  ', 'a-v0', null as unknown as string, undefined as unknown as string],
      onStageSources: ['a-v0', 'a-v0'],
      hiResSources: ['', '  '],
      stageDesktopSource: '',
    });
    expect(rc.selectedSources).toEqual(['a-v0']);
    expect(rc.onStageSources).toEqual(['a-v0']);
    expect(rc.constraints).toEqual({});
  });

  it('applyReceiverConstraints: no-op on null conference; swallows setter failures', () => {
    expect(() => applyReceiverConstraints(null, plan)).not.toThrow();
    const boom = {
      setReceiverConstraints: () => {
        throw new Error('bridge channel closed');
      },
    } as unknown as JitsiConference;
    expect(() => applyReceiverConstraints(boom, plan)).not.toThrow();
    const missing = {} as unknown as JitsiConference;
    expect(() => applyReceiverConstraints(missing, plan)).not.toThrow();
    const calls: unknown[] = [];
    const fake = { setReceiverConstraints: (c: unknown) => calls.push(c) } as unknown as JitsiConference;
    applyReceiverConstraints(fake, plan);
    expect((calls[0] as { lastN: number }).lastN).toBe(16);
  });
});
