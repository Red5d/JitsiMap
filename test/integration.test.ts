/**
 * Cross-module integration tests — the §16 QA pass over the seams.
 *
 * Two layers:
 *  1. RUNTIME: the real `office.tmj` flows through parseMapData → store →
 *     planners → stage-share chain, and every node-safe app module
 *     (App/Lobby/Room/panels/store/spatial) imports under plain node —
 *     proving the §4.2 seam keeps lib-jitsi-meet/Phaser out of the graph.
 *  2. WIRING TABLE: the browser-only wiring (rAF loop, join sequence,
 *     teardown, a11y attributes, §14 guards) is pinned by source
 *     inspection, because Room/game/jitsi need a real browser to run.
 *
 * Pure-helper logic (joinReducer, diffAudioTracks, visibleBubbleSet, …)
 * lives in test/ui.test.ts — nothing here duplicates it.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Static imports of the whole node-safe app graph = the import-smoke test.
import { App } from '../src/App';
import { Lobby } from '../src/ui/Lobby';
import { Room } from '../src/ui/Room';
import { BottomBar } from '../src/ui/BottomBar';
import { ChatPanel } from '../src/ui/panels/ChatPanel';
import { PeoplePanel } from '../src/ui/panels/PeoplePanel';
import { SettingsPanel } from '../src/ui/panels/SettingsPanel';
import { StagePanel } from '../src/ui/panels/StagePanel';
import { AudioBanner } from '../src/ui/AudioBanner';
import { VideoBubbles } from '../src/ui/VideoBubbles';
import { store } from '../src/store';
import { parseMapData, type GameMapData } from '../src/game/maps';
import { createAudioEngine } from '../src/spatial/audioEngine';
import { computeAudibleSourceNames, computeVideoPlan } from '../src/spatial/plan';
import { ON_STAGE_SOURCES, HIRES_SOURCES } from '../src/spatial/plan';
import { shareCandidates, shareNotices } from '../src/ui/util';
import { MAX_VIDEO_SOURCES } from '../src/jitsi/constraints';
import type { Pose } from '../src/types';

// ---------------------------------------------------------------- helpers

const readSource = (relFromTest: string): string =>
  readFileSync(new URL(relFromTest, import.meta.url), 'utf8');

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) yield* walk(rel);
    else if (/\.(ts|tsx)$/.test(e.name)) yield rel;
  }
}

const pose = (x: number, y: number, zone: string | null): Pose => ({
  x,
  y,
  dir: 0,
  zone,
  moving: false,
});

/** Real shipped map (SPEC §10.6) — the same bytes the browser fetches. */
function realOffice(): GameMapData {
  const json = JSON.parse(readFileSync(new URL('../public/maps/office.tmj', import.meta.url), 'utf8'));
  return parseMapData(json, 'office');
}

interface Seed {
  id: string;
  name: string;
  at: Pose | null;
  audio?: string;
  video?: string;
  desktop?: string;
  old?: boolean; // joined long ago with no pose → pose-less stock Meet user
}

function seed(s: Seed): void {
  store.upsertParticipant(s.id, {
    name: s.name,
    hasAudio: Boolean(s.audio),
    audioSourceName: s.audio ?? null,
    hasVideo: Boolean(s.video),
    videoSourceName: s.video ?? null,
    hasDesktop: Boolean(s.desktop),
    desktopSourceName: s.desktop ?? null,
    desktopTrack: s.desktop ? { sourceName: s.desktop } : null, // live-track stand-in (§6.5)
    joinedAt: Date.now() - (s.old ? 60_000 : 1_000),
  });
  if (s.at) store.setRemotePose(s.id, s.at, Date.now());
}

// ---------------------------------------------------------------- runtime seams

describe('office map → store → planner chain (§8/§9, §10.6)', () => {
  const map = realOffice();

  it('parses the shipped office.tmj with its zones (§10.6)', () => {
    store.reset();
    store.setMap(map);
    const zones = store.zones();
    expect(zones.has('hall')).toBe(true);
    expect(zones.get('stage')?.stage).toBe(true);
    expect(zones.get('stage')?.audibleFrom).toContain('hall');
    expect(zones.get('silent-nook')?.silent).toBe(true);
    expect(map.spawns.length).toBeGreaterThan(0);
    store.reset();
  });

  it('audible-source plan follows the zone model over the real map (§8.3/§8.4)', () => {
    store.reset();
    store.setMap(map);
    store.setLocalId('me');
    store.setLocalPose(pose(560, 620, 'hall')); // hall, near the stage corner

    seed({ id: 'hall-p', name: 'Hally', at: pose(600, 560, 'hall'), audio: 'A-hall' });
    seed({ id: 'break-p', name: 'Breaky', at: pose(200, 190, 'breakout-1'), audio: 'A-break' });
    seed({ id: 'nook-p', name: 'Nooky', at: pose(592, 112, 'silent-nook'), audio: 'A-nook' });
    seed({ id: 'stage-p', name: 'Stagy', at: pose(648, 712, 'stage'), audio: 'A-stage' });
    seed({ id: 'pose-p', name: 'Stocky', at: null, audio: 'A-pose', old: true });

    // Same zone + stage→hall audibleFrom + pose-less global (§7.7);
    // breakout-1 and the silent nook are walls (§8.3).
    expect(computeAudibleSourceNames(store, 'me')).toEqual(['A-hall', 'A-pose', 'A-stage']);

    // Deafen unsubscribes everything (§8.5) — the Room gates on this too.
    store.setSettings({ deafened: true });
    expect(computeAudibleSourceNames(store, 'me')).toEqual([]);
    store.setSettings({ deafened: false });

    // Off tier: flat model, zones are ignored (§8.5).
    store.setSettings({ tier: 'off' });
    expect(computeAudibleSourceNames(store, 'me')).toEqual([
      'A-break',
      'A-hall',
      'A-nook',
      'A-pose',
      'A-stage',
    ]);
    store.setSettings({ tier: 'auto' });

    // Per-user local mute unsubscribes (§8.5).
    store.setParticipantControls('hall-p', { mutedForMe: true });
    expect(computeAudibleSourceNames(store, 'me')).toEqual(['A-pose', 'A-stage']);
    store.reset();
  });

  it('video plan: radius + zone rule + budgets + stage desktop (§9.1/§9.2/§9.3)', () => {
    store.reset();
    store.setMap(map);
    store.setLocalId('me');
    store.setLocalPose(pose(400, 400, 'hall'));

    seed({ id: 'near', name: 'Near', at: pose(480, 400, 'hall'), video: 'V-near' });
    seed({ id: 'mid', name: 'Mid', at: pose(560, 400, 'hall'), video: 'V-mid' });
    seed({ id: 'far', name: 'Far', at: pose(1100, 400, 'hall'), video: 'V-far' }); // > 6 tiles
    seed({ id: 'bk', name: 'Bk', at: pose(360, 300, 'breakout-1'), video: 'V-bk' }); // zone wall
    seed({ id: 'ghost', name: 'Ghost', at: null, video: 'V-ghost', old: true }); // pose-less (§7.7)
    seed({ id: 'pres', name: 'Pres', at: pose(928, 816, 'stage'), desktop: 'D-pres' });

    const plan = computeVideoPlan(store, 'me', { stageDesktopOpen: false });
    expect(plan.selectedSources).toEqual(['V-near', 'V-mid']); // far out of radius, bk zone-blocked, pose-less out
    expect(plan.onStageSources.length).toBeLessThanOrEqual(ON_STAGE_SOURCES);
    expect(plan.hiResSources.length).toBeLessThanOrEqual(HIRES_SOURCES);
    expect(plan.selectedSources.length).toBeLessThanOrEqual(MAX_VIDEO_SOURCES);
    expect(plan.stageDesktopSource).toBe(null);

    // §9.3: the open stage share (stage zone, audibleFrom hall) enters the plan.
    const staged = computeVideoPlan(store, 'me', { stageDesktopOpen: true });
    expect(staged.stageDesktopSource).toBe('D-pres');
    store.reset();
  });

  it('a zone-blocked share becomes a "sharing in <zone>" notice, not a swallow (§9.3)', () => {
    store.reset();
    store.setMap(map);
    store.setLocalId('me');
    const localPose = pose(400, 400, 'hall');
    store.setLocalPose(localPose);

    seed({ id: 'zed', name: 'Zed', at: pose(1008, 176, 'breakout-2'), desktop: 'D-zed' });
    const cands = shareCandidates(
      [...store.getSnapshot().participants],
      localPose,
      store.zones(),
      'me',
    );
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ id: 'zed', zoneLabel: 'Breakout 2', viewable: false });
    expect(shareNotices(cands, null)).toEqual(['Zed is sharing in Breakout 2']);

    // The video plan refuses to receive it while the stage is "open".
    const plan = computeVideoPlan(store, 'me', { stageDesktopOpen: true });
    expect(plan.stageDesktopSource).toBe(null);
    store.reset();
  });
});

describe('module-graph seams (§4.2/§11/§14) — node imports + source scans', () => {
  it('the full app shell graph imports under plain node (§16.1 seam)', () => {
    for (const f of [App, Lobby, Room, BottomBar, ChatPanel, PeoplePanel, SettingsPanel, StagePanel, AudioBanner, VideoBubbles]) {
      expect(['function', 'object']).toContain(typeof f); // forwardRef components are objects
    }
    expect(typeof createAudioEngine).toBe('function');
    const engine = createAudioEngine(store); // no AudioContext until start()
    for (const m of ['start', 'attachParticipant', 'detachParticipant', 'update', 'ctxState', 'resume', 'dispose'] as const) {
      expect(typeof engine[m]).toBe('function');
    }
  });

  it('lib-jitsi-meet is imported by src/jitsi/ only, value import only in client.ts (§11)', () => {
    const importers = new Set<string>();
    const valueImporters = new Set<string>();
    for (const rel of walk('../src')) {
      for (const line of readSource(rel).split('\n')) {
        if (!/from\s+['"]lib-jitsi-meet['"]/.test(line)) continue;
        importers.add(rel);
        if (!/^\s*import\s+type\b/.test(line)) valueImporters.add(rel);
      }
    }
    expect([...importers].sort()).toEqual([
      '../src/jitsi/client.ts',
      '../src/jitsi/constraints.ts',
      '../src/jitsi/tracks.ts',
    ]);
    expect([...valueImporters]).toEqual(['../src/jitsi/client.ts']);
  });

  it('no src/ui|game|spatial module touches lib-jitsi-meet at all (§4.2)', () => {
    for (const rel of walk('../src')) {
      if (!/^..\/src\/(ui|game|spatial)\//.test(rel)) continue;
      expect(readSource(rel), rel).not.toMatch(/from\s+['"]lib-jitsi-meet['"]/);
    }
  });

  it('nothing in src/ renders HTML from remote data (§14)', () => {
    for (const rel of walk('../src')) {
      const text = readSource(rel);
      expect(text, rel).not.toContain('dangerouslySetInnerHTML');
      expect(text, rel).not.toMatch(/\binnerHTML\b/);
    }
  });

  it('remote avatar URLs are https-only (§14)', () => {
    expect(readSource('../src/game/avatars.ts')).toContain("startsWith('https://')");
  });

  it('index.html sends no referrer (avatar/invite privacy, §14)', () => {
    expect(readSource('../index.html')).toContain('<meta name="referrer" content="no-referrer" />');
  });

  it('localStorage is store-only and single-key (§14)', () => {
    expect(readSource('../src/store.ts')).toContain('jitsimap.v1');
    const usage = /localStorage\.(getItem|setItem|removeItem)/;
    for (const rel of walk('../src')) {
      if (rel === '../src/store.ts') continue;
      expect(usage.test(readSource(rel)), rel).toBe(false);
    }
  });

  it('keyboard focus styling + screen-reader utilities ship (§5.5)', () => {
    const css = readSource('../src/index.css');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('.jm-visually-hidden');
  });
});

// ---------------------------------------------------------------- wiring table

const WIRING: Readonly<Record<string, readonly string[]>> = {
  '../src/ui/Room.tsx': [
    // rAF loop (§7.3/§8.1/§6.5)
    'client.sendPose(pose)',
    'engine.update(Date.now())',
    'diffAudioTracks(audioRefs.current',
    'engine.attachParticipant(id)',
    'engine.detachParticipant(id)',
    // debounced plans, deafen gate, stage flag (§8.4/§8.5/§9.2/§9.3)
    's.settings.deafened ? [] : computeAudibleSourceNames(',
    'client.applyAudioSubscriptions(',
    'client.applyReceiverConstraints(computeVideoPlan(',
    'stageDesktopOpen: stageOpenRef.current',
    // audio-context banner (§8.6)
    'engine.ctxState()',
    'onEnable={() => engine.resume()}',
    // canvas a11y (§5.5) + debug zones (§10.6)
    'aria-label={canvasAriaLabel(aria.zone, aria.nearby)}',
    'role="img"',
    "has('debugZones')",
    // §9.3 queue → People notices, chat, emotes, controls
    'selectStageShare(cands, stageId, [...dismissedRef.current])',
    '<PeoplePanel localId={snap.local.id} notices={notices}',
    '<ChatPanel onSend={(text) => client.sendChat(text)}',
    'client.sendEmote(emoji)',
    'client.setMicMuted(!next)',
    'client.setCamMuted(!next)',
    'client.startDesktopShare()',
    // Phaser via dynamic import; StrictMode/leave-safe destroy
    "import('../game/scene')",
    'handle?.destroy()',
    // §6.6 waiting-host + §5.1 Retry surfaced in-room
    "'waiting-host'",
    'onRetry',
  ],
  '../src/ui/VideoBubbles.tsx': [
    'aria-hidden="true"', // canvas aria-label carries the scene (§5.5)
    'visibleBubbleSet(', // ≤16 nearest-first cap (§11)
    'e.video.srcObject = null;', // out-of-radius detach (§9.1)
    'getTrackStream(p.videoTrack)', // the §6.5 seam, shared with audio (§11)
  ],
  '../src/ui/BottomBar.tsx': [
    'aria-pressed={micOn}',
    'aria-pressed={camOn}',
    'aria-pressed={sharing}',
    'deafened', // §8.5 deafen
    'masterToSlider(settings.masterVolume)', // §8.5 master volume
    'role="menu"', // emote picker (§5.3)
    'onSendEmote(e)',
  ],
  '../src/ui/panels/ChatPanel.tsx': [
    'chatTextContent(m.text)', // plain-text render (§14)
    'aria-live="polite"', // screen-reader announcements (§5.5)
    'Chat is heard everywhere.', // §7.6 label
  ],
  '../src/ui/panels/PeoplePanel.tsx': [
    'peopleStatusLabel(', // §7.7 status incl. pose-less marker
    'Mute is client-side', // §8.5 labelling
    'aria-label={`Volume for', // §5.4 per-participant volume
  ],
  '../src/ui/panels/SettingsPanel.tsx': [
    'enumerateDevices()', // §5.4 device pickers
    'client.setAudioOutput(', // speaker output where supported
    'jm-set-tier', // spatial tier
    'libVersion', // connection info readout
  ],
  '../src/ui/panels/StagePanel.tsx': [
    'is sharing their screen', // §9.3 stage
    'onDismiss',
  ],
  '../src/ui/AudioBanner.tsx': ['onEnable'],
  '../src/game/avatars.ts': ["startsWith('https://')"],
};

describe('wiring table — every §16.3 consumer is in place', () => {
  for (const [file, subs] of Object.entries(WIRING)) {
    it(`${file} wires ${subs.length} required behaviours`, () => {
      const text = readSource(file);
      for (const s of subs) {
        expect(text, `${file} must contain ${JSON.stringify(s)}`).toContain(s);
      }
    });
  }
});

describe('join sequence + teardown order (§5.1/§6.2/§8.6/§14)', () => {
  it('Lobby.doJoin: gesture → config → map → lib-load → join → strip JWT → engine', () => {
    const text = readSource('../src/ui/Lobby.tsx');
    const audio = text.indexOf('new AudioContext()'); // §8.6: Join click is the gesture
    const config = text.indexOf("step: 'config'");
    const map = text.indexOf('loadMap(mapId)');
    const lib = text.indexOf("import('../jitsi/api')"); // §4.2: lib code at join time
    const join = text.indexOf('client.join({');
    const strip = text.indexOf('stripJwtFromUrl(cfg', join); // §14: after success
    const start = text.indexOf('engine.start(ctx)');
    const all = [audio, config, map, lib, join, strip, start];
    expect(all.every((n) => n >= 0), JSON.stringify(all)).toBe(true);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!, `${i}: ${JSON.stringify(all)}`).toBeGreaterThan(all[i - 1]!);
    }
    // §11: missing JITSI_DOMAIN surfaces before Join, not mid-join.
    expect(text).toContain('setConfigError(');
  });

  it('App teardown stops engine + client and resets the store (§5.1/§6.2)', () => {
    const text = readSource('../src/App.tsx');
    const engine = text.indexOf('s.engine.dispose()');
    const client = text.indexOf('s.client.dispose()');
    const reset = text.indexOf('store.reset()');
    expect(engine).toBeGreaterThan(-1);
    expect(client).toBeGreaterThan(engine);
    expect(reset).toBeGreaterThan(client);
    // Navigating away from a live session performs the same teardown (§5.1).
    expect(text).toContain('space !== s.space');
  });

  it('App retry is a fresh join with the same parameters (§6.2/§8.6)', () => {
    const text = readSource('../src/App.tsx');
    const leave = text.indexOf('s.client.leave()');
    const ctx = text.indexOf('new AudioContext()', leave); // Retry click = gesture (§8.6)
    const lib = text.indexOf("import('./jitsi/api')", leave);
    const client = text.indexOf('createJitsiClient(s.config', lib);
    const join = text.indexOf('await client.join({', client);
    const strip = text.indexOf('stripJwtFromUrl(s.config', join);
    const all = [leave, ctx, lib, client, join, strip];
    expect(all.every((n) => n >= 0), JSON.stringify(all)).toBe(true);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!, `${i}: ${JSON.stringify(all)}`).toBeGreaterThan(all[i - 1]!);
    }
  });
});
