// UI-shell tests (SPEC §5/§9/§11) — pure logic only, node env (no jsdom):
// routing (§5.1), the Lobby join-state reducer (mic/cam seed, steps, fail /
// waiting-host / retry), §9.3 stage-share queue selection, the §6.5 audio
// attach/detach diff, bubble placement math + the §9.1 visibility/cap set,
// and the frozen util helpers the shell wires.

import { describe, expect, it } from 'vitest';

import type { CamView } from '../src/game/viewport';
import { VIDEO_RADIUS_TILES } from '../src/spatial/distance';
import { store as storeSingleton } from '../src/store'; // node-safety smoke
import { type Pose, type ReceivedPose, type RemoteState, TILE_SIZE, type ZoneDef } from '../src/types';
import { initialJoinState, JOIN_STEPS, joinReducer } from '../src/ui/Lobby';
import { diffAudioTracks, selectStageShare } from '../src/ui/Room';
import {
  BUBBLE_H,
  BUBBLE_HEAD_OFFSET,
  BUBBLE_W,
  bubbleVisible,
  canvasAriaLabel,
  chatTextContent,
  distanceLabel,
  EMOTE_ROW,
  formatChatTime,
  inviteLink,
  MAX_VIDEO_BUBBLES,
  masterToSlider,
  ownPreviewVisible,
  POSELESS_LABEL,
  parseRoute,
  pathForSpace,
  peopleStatusLabel,
  type ShareCandidate,
  shareCandidates,
  sliderToMaster,
  sliderToVolume,
  volumeToSlider,
} from '../src/ui/util';
import { bubblePlacement, visibleBubbleSet } from '../src/ui/VideoBubbles';

// ---------------------------------------------------------------- fixtures

void storeSingleton; // importing the app store must not explode in node

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

const pose = (x: number, y: number, z: string | null = null): Pose => ({
  x,
  y,
  dir: 0,
  zone: z,
  moving: false,
});

const received = (x: number, y: number, z: string | null = null): ReceivedPose => {
  const p = pose(x, y, z);
  return { target: p, prev: p, prevAt: 0, at: 0 };
};

const participant = (id: string, extra: Partial<RemoteState> = {}): RemoteState => ({
  id,
  name: id,
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
  ...extra,
});

const cam = (extra: Partial<CamView> = {}): CamView => ({
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: 800,
  height: 600,
  ...extra,
});

// ---------------------------------------------------------------- routing (§5.1)

describe('routing', () => {
  it('parses root, space and unknown routes', () => {
    expect(parseRoute('/')).toEqual({ kind: 'root' });
    expect(parseRoute('')).toEqual({ kind: 'root' });
    expect(parseRoute('/s/office-party')).toEqual({ kind: 'space', space: 'office-party' });
    expect(parseRoute('/s/office-party/')).toEqual({ kind: 'space', space: 'office-party' });
    expect(parseRoute('/rooms/nope')).toEqual({ kind: 'notfound' });
    expect(parseRoute('/s/')).toEqual({ kind: 'notfound' });
  });

  it('decodes percent-encoded space names', () => {
    expect(parseRoute('/s/caf%C3%A9')).toEqual({ kind: 'space', space: 'café' });
  });

  it('normalises canonical paths + invite links (§6.2)', () => {
    expect(pathForSpace('Office Party!')).toBe('/s/office-party-');
    expect(inviteLink('Café Meets', 'https://map.example.com/')).toBe('https://map.example.com/s/caf--meets');
    expect(inviteLink('x', 'https://map.example.com')).toBe('https://map.example.com/s/x');
  });
});

// ---------------------------------------------------------------- join reducer (§5.1)

describe('joinReducer', () => {
  it('seeds mic on / cam off and toggles both', () => {
    expect(initialJoinState.mic).toBe(true);
    expect(initialJoinState.cam).toBe(false);
    const s = joinReducer(joinReducer(initialJoinState, { type: 'toggle', media: 'cam' }), {
      type: 'toggle',
      media: 'mic',
    });
    expect(s).toMatchObject({ mic: false, cam: true, phase: 'idle' });
  });

  it('begin starts at the first step; steps advance while joining only', () => {
    const joining = joinReducer(initialJoinState, { type: 'begin' });
    expect(joining).toMatchObject({ phase: 'joining', step: JOIN_STEPS[0]!.id });
    expect(joinReducer(joining, { type: 'step', step: 'map' }).step).toBe('map');
    expect(joinReducer(initialJoinState, { type: 'step', step: 'map' })).toBe(initialJoinState);
  });

  it('keeps the mic/cam seed across begin → fail → retry (Session.join seed)', () => {
    const toggled = joinReducer(initialJoinState, { type: 'toggle', media: 'cam' });
    const failed = joinReducer(toggled, { type: 'fail', step: 'connect', message: 'boom' });
    expect(failed).toMatchObject({ phase: 'failed', step: 'connect', message: 'boom', mic: true, cam: true });
    const retried = joinReducer(failed, { type: 'retry' });
    expect(retried).toMatchObject({ phase: 'idle', step: null, message: null, mic: true, cam: true });
  });

  it('surfaces the §6.6 waiting-host phase distinctly from failed', () => {
    const joining = joinReducer(initialJoinState, { type: 'begin' });
    const waiting = joinReducer(joining, {
      type: 'fail',
      step: 'connect',
      message: 'Waiting for a host to open this room.',
      kind: 'waiting-host',
    });
    expect(waiting.phase).toBe('waiting-host');
  });
});

// ---------------------------------------------------------------- stage shares (§9.3)

describe('selectStageShare + shareCandidates/shareNotices', () => {
  const cand = (id: string, viewable = true, zoneLabel: string | null = null): ShareCandidate => ({
    id,
    name: id,
    zoneLabel,
    viewable,
  });

  it('keeps the current sharer while they keep sharing; others queue', () => {
    const sel = selectStageShare([cand('a'), cand('b')], 'a');
    expect(sel.openId).toBe('a');
    expect(sel.notices).toEqual(['b is sharing (queued — one stage share at a time)']);
  });

  it('promotes the first viewable undismissed sharer when the stage frees up', () => {
    expect(selectStageShare([cand('a'), cand('b')], 'a', ['a']).openId).toBe('b');
    expect(selectStageShare([cand('a'), cand('b')], null).openId).toBe('a');
  });

  it('never auto-opens a zone-blocked share — it becomes a "sharing in <zone>" notice', () => {
    const sel = selectStageShare([cand('x', false, 'Gallery')], null);
    expect(sel.openId).toBe(null);
    expect(sel.notices).toEqual(['x is sharing in Gallery']);
  });

  it('dismissed shares never auto-reopen', () => {
    expect(selectStageShare([cand('b')], null, ['b']).openId).toBe(null);
  });

  it('shareCandidates classifies sharers with the §8.3 zone rule', () => {
    const zones = new Map([
      ['gallery', zone('gallery', 0, 0, 8, 8)],
      ['hall', zone('hall', 20, 0, 8, 8)],
    ]);
    const sharers = [
      participant('a', { hasDesktop: true, desktopTrack: {}, pose: received(1, 1, 'gallery') }),
      participant('me', { hasDesktop: true, desktopTrack: {} }),
      participant('plain'),
    ];
    const cands = shareCandidates(sharers, pose(1, 1, 'hall'), zones, 'me');
    expect(cands.map((c) => c.id)).toEqual(['a']); // local + non-sharers filtered
    expect(cands[0]).toMatchObject({ zoneLabel: 'gallery', viewable: false });
  });

  it('pose-less sharers are viewable (§7.7: audio is global)', () => {
    const cands = shareCandidates([participant('p', { desktopTrack: {} })], pose(0, 0, 'hall'), new Map(), 'me');
    expect(cands[0]?.viewable).toBe(true);
  });
});

// ---------------------------------------------------------------- audio attach diff (§6.5)

describe('diffAudioTracks', () => {
  const track = () => ({ label: `t${Math.random()}` });

  it('attaches new tracks, skips self, detaches departures', () => {
    const tA = track();
    const d = diffAudioTracks(
      new Map([['a', tA]]),
      [
        participant('me', { audioTrack: track() }),
        participant('a', { audioTrack: tA }),
        participant('b', { audioTrack: track() }),
      ],
      'me',
    );
    expect(d.attach).toEqual(['b']);
    expect(d.detach).toEqual([]);
    const d2 = diffAudioTracks(d.refs, [participant('a', { audioTrack: tA })], 'me');
    expect(d2.attach).toEqual([]);
    expect(d2.detach).toEqual(['b']);
  });

  it('re-attaches a replaced track ref and updates the registry', () => {
    const tA = track();
    const tA2 = track();
    const d = diffAudioTracks(new Map([['a', tA]]), [participant('a', { audioTrack: tA2 })], 'me');
    expect(d.attach).toEqual(['a']);
    expect(d.refs.get('a')).toBe(tA2);
  });

  it('no churn when refs are unchanged', () => {
    const tA = track();
    const d = diffAudioTracks(new Map([['a', tA]]), [participant('a', { audioTrack: tA })], 'me');
    expect(d.attach).toEqual([]);
    expect(d.detach).toEqual([]);
  });
});

// ---------------------------------------------------------------- video bubbles (§9.1)

describe('bubblePlacement + visibleBubbleSet', () => {
  it('anchors the bubble centred above the projected head', () => {
    const p = bubblePlacement(pose(100, 50), cam());
    expect(p.left).toBe(100 - BUBBLE_W / 2);
    expect(p.top).toBe(50 - BUBBLE_HEAD_OFFSET - BUBBLE_H);
  });

  it('placement follows camera zoom and scroll', () => {
    const p = bubblePlacement(pose(100, 50), cam({ zoom: 2, scrollX: 50 }));
    expect(p.left).toBe((100 - 50) * 2 - BUBBLE_W / 2);
    expect(p.top).toBe(50 * 2 - BUBBLE_HEAD_OFFSET * 2 - BUBBLE_H);
  });

  const viewer = pose(0, 0);
  const camPeer = (id: string, xTiles: number, extra: Partial<RemoteState> = {}): RemoteState =>
    participant(id, { videoTrack: {}, hasVideo: true, pose: received(xTiles * TILE_SIZE, 0), ...extra });

  it('bubbleVisible requires a live unmuted track within radius (§9.1)', () => {
    const zones = new Map<string, ZoneDef>();
    const near = camPeer('near', 1);
    expect(bubbleVisible(near, viewer, zones)).toBe(true);
    expect(bubbleVisible(camPeer('far', VIDEO_RADIUS_TILES + 2), viewer, zones)).toBe(false);
    expect(bubbleVisible(camPeer('cam-off', 1, { camMuted: true }), viewer, zones)).toBe(false);
    expect(bubbleVisible(camPeer('no-track', 1, { videoTrack: null }), viewer, zones)).toBe(false);
    expect(bubbleVisible(camPeer('pose-less', 1, { pose: null }), viewer, zones)).toBe(false);
    expect(bubbleVisible(near, null, zones)).toBe(false);
  });

  it('zone audibility gates bubbles (§8.3)', () => {
    const zones = new Map([
      ['booth', zone('booth', 0, 0, 4, 4)],
      ['hall', zone('hall', 10, 0, 4, 4)],
    ]);
    const inBooth = camPeer('booth-dweller', 1, { pose: received(32, 0, 'booth') });
    expect(bubbleVisible(inBooth, pose(64, 0, 'hall'), zones)).toBe(false);
    expect(bubbleVisible(inBooth, pose(33, 0, 'booth'), zones)).toBe(true);
  });

  it('visibleBubbleSet caps at MAX_VIDEO_BUBBLES, nearest first (§11)', () => {
    const zones = new Map<string, ZoneDef>();
    const peers = Array.from({ length: MAX_VIDEO_BUBBLES + 3 }, (_, i) => camPeer(`p${i}`, 0.3 + i * 0.25));
    const set = visibleBubbleSet(peers, viewer, zones);
    expect(set).toHaveLength(MAX_VIDEO_BUBBLES);
    expect(set.map((p) => p.id)).toEqual(peers.slice(0, MAX_VIDEO_BUBBLES).map((p) => p.id));
  });

  it('own preview follows the camera (§5.2)', () => {
    expect(ownPreviewVisible(true)).toBe(true);
    expect(ownPreviewVisible(false)).toBe(false);
  });
});

// ---------------------------------------------------------------- bottom bar / settings helpers

describe('people + volume helpers (§7.7/§8.5)', () => {
  it('peopleStatusLabel: pose-less marker, zone + distance, open map', () => {
    const zones = new Map([['hall', zone('hall', 0, 0, 8, 8)]]);
    const now = 100_000;
    expect(peopleStatusLabel({ pose: null, joinedAt: now - 60_000 }, null, zones, now)).toBe(POSELESS_LABEL);
    expect(peopleStatusLabel({ pose: null, joinedAt: now }, null, zones, now)).toBe('joining…');
    const peer = { pose: received(96, 0, 'hall'), joinedAt: 0 };
    expect(peopleStatusLabel(peer, pose(64, 0, 'hall'), zones, now)).toBe('hall · ~1 tiles');
    expect(peopleStatusLabel({ pose: received(64, 0, null), joinedAt: 0 }, pose(64, 0, null), zones, now)).toBe(
      '~0 tiles',
    );
    expect(peopleStatusLabel({ pose: received(64, 0, null), joinedAt: 0 }, null, zones, now)).toBe('on the map');
  });

  it('distanceLabel rounds to whole tiles', () => {
    expect(distanceLabel(5.4)).toBe('~5 tiles');
    expect(distanceLabel(-1)).toBe('~0 tiles');
  });

  it('per-user volume 0..2 maps to a 0..200 slider (§8.5)', () => {
    expect(volumeToSlider(1)).toBe(100);
    expect(volumeToSlider(2)).toBe(200);
    expect(sliderToVolume(150)).toBeCloseTo(1.5);
    expect(sliderToVolume(900)).toBe(2); // clamped
    expect(sliderToVolume(volumeToSlider(0.37))).toBeCloseTo(0.37, 1);
  });

  it('master volume 0..1 maps to a 0..100 slider (§8.5)', () => {
    expect(masterToSlider(1)).toBe(100);
    expect(sliderToMaster(50)).toBeCloseTo(0.5);
    expect(sliderToMaster(-5)).toBe(0);
  });

  it('the emote row is the quick-picker catalog (§5.3)', () => {
    expect(EMOTE_ROW.length).toBeGreaterThan(4);
    expect(EMOTE_ROW[0]).toBe('👋');
  });
});

// ---------------------------------------------------------------- aria + chat safety (§5.5/§14)

describe('accessibility + chat helpers', () => {
  it('canvasAriaLabel describes zone and nearby count (§5.5)', () => {
    expect(canvasAriaLabel('Hall', 3)).toBe('Hall — 3 people nearby');
    expect(canvasAriaLabel('Hall', 1)).toBe('Hall — 1 person nearby');
    expect(canvasAriaLabel(null, 0)).toBe('Open map — 0 people nearby');
  });

  it('chatTextContent is identity — text nodes, never markup (§14)', () => {
    const nasty = '<img src=x onerror="alert(1)">';
    expect(chatTextContent(nasty)).toBe(nasty);
  });

  it('formatChatTime renders HH:MM and tolerates garbage', () => {
    expect(formatChatTime(new Date(2026, 0, 2, 9, 5).getTime())).toMatch(/0?9:05/);
    expect(formatChatTime(Number.NaN)).toBe('');
  });
});
