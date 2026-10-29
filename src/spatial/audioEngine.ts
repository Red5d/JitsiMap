/**
 * Spatial audio engine — SPEC §8.1/§8.5/§8.6. Owns the Web Audio graph:
 *
 *   MediaStreamAudioSource(track stream)              per remote participant
 *     -> GainNode          spatial gain (§8.2 distance, §8.3 zones,
 *                          §8.5 tier + mic-mute + mute-other ⇒ 0, §8.1)
 *     -> StereoPannerNode  pan (§8.3)                  [full tier only]
 *     -> GainNode          per-user volume (§8.5, 0..2)
 *     -> GainNode          shared master: masterVolume, 0 when deafened (§8.5)
 *     -> AudioContext.destination
 *
 * The AudioContext is created/resumed on the Join click gesture (§8.6);
 * `update()` runs every rendered frame and pushes new gains/pans through
 * setTargetAtTime (τ ≈ 50 ms, §8.1) with a per-node change cache so idle
 * frames never touch AudioParams (§15 audio budget).
 *
 * All spatial math lives in ./distance (pure, unit-tested). Tracks are
 * opaque in the store (src/types.ts RemoteState); the ONLY unwrap is the
 * src/jitsi/tracks.ts seam (getTrackStream). The local user's own audio
 * never enters this graph (§6.4).
 */

import { getTrackStream } from '../jitsi/tracks';
import type { Store } from '../store';
import { type AudioTier, isPoseLess } from '../types';
import { finalGain, POSELESS_GAIN, panFor, spatialGain } from './distance';

/** Gain/pan smoothing time constant (§8.1: τ ≈ 0.05 s). */
const SMOOTH_TAU_S = 0.05;
/** Frame cost guard: deltas below this never reach an AudioParam. */
const EPS = 1e-4;

/**
 * §8.6 Chrome stream-pumping workaround switch. IF — and only if — the
 * §16.3 browser matrix proves that a remote stream feeds Web Audio solely
 * while the stream is also attached to a playing media element, flip this
 * constant to true. The guarded block in attachParticipant() then wires the
 * stream to a MUTED, volume-0, playsInline <audio> element (detachParticipant
 * tears it down). The track is never attached audibly: audible attach() +
 * graph is the double-audio violation banned by §8.6/§17.
 * Default false: no element is attached.
 */
export const ATTACH_MUTED_ELEMENT = false;

export interface AudioEngine {
  /** Called on the Join click gesture (§8.6); creates master bus + resumes ctx. */
  start(ctx: AudioContext): void;
  /**
   * Build the §8.1 graph from the store's audioTrack (getTrackStream).
   * No-ops — and are safe to call again when the track arrives (UI calls on
   * the TRACK_ADDED diff) — when: not started, the id is the local user
   * (§6.4), the track is missing/late, the track has no live stream
   * (warned once), or the participant is already attached.
   */
  attachParticipant(id: string): void;
  /** Full node teardown for one participant (USER_LEFT / TRACK_REMOVED). */
  detachParticipant(id: string): void;
  /** Per rendered frame: recompute spatial gain + pan from store poses, smooth-apply (§8.1). */
  update(now: number): void;
  /** §8.6 "Click to enable audio" banner: null = engine not started. */
  ctxState(): AudioContextState | null;
  /** ctx.resume() — call on later pointer interaction while suspended (§8.6). */
  resume(): void;
  /** Full teardown (leave/dispose). Idempotent. */
  dispose(): void;
}

interface Chain {
  source: AudioNode;
  spatial: GainNode;
  /** null in gain/off tiers (§8.1: the gain-only tier skips the panner). */
  panner: StereoPannerNode | null;
  user: GainNode;
  /** Last values written to the AudioParams; sentinels force the first write. */
  last: { spatial: number; pan: number; user: number };
}

export function createAudioEngine(store: Store): AudioEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let lastMaster = -1;
  const chains = new Map<string, Chain>();
  const warned = new Set<string>();
  const mutedEls = new Map<string, HTMLAudioElement>();

  /** §8.5: 'auto' resolves to full when StereoPannerNode is supported. */
  function effectiveTier(tier: AudioTier): AudioTier {
    if (tier === 'auto') return ctx && typeof ctx.createStereoPanner === 'function' ? 'full' : 'gain';
    return tier;
  }

  /** setTargetAtTime only when the value actually moved (frame cost guard). */
  function apply(param: AudioParam, value: number, previous: number, time: number): number {
    if (Math.abs(value - previous) < EPS) return previous;
    param.setTargetAtTime(value, time, SMOOTH_TAU_S);
    return value;
  }

  function start(context: AudioContext): void {
    if (ctx === context) {
      resume();
      return;
    }
    dispose(); // replacing a context: tear the old graph down first
    ctx = context;
    const settings = store.getSettings();
    const g = ctx.createGain();
    g.gain.value = settings.deafened ? 0 : settings.masterVolume;
    g.connect(ctx.destination);
    master = g;
    lastMaster = g.gain.value;
    resume(); // §8.6: resume on the Join click gesture
  }

  function resume(): void {
    // §8.6: resume() is a gesture-driven promise; an autoplay-policy
    // rejection is surfaced through ctxState() (the banner), never thrown.
    try {
      ctx?.resume().catch(() => undefined);
    } catch {
      /* context closed — nothing to resume */
    }
  }

  function attachParticipant(id: string): void {
    if (!ctx || !master) return; // not started: safe to re-attach after start
    if (id === store.getSnapshot().local.id) return; // local audio never enters the graph (§6.4)
    if (chains.has(id)) return; // already attached
    const p = store.getParticipant(id);
    if (!p || !p.audioTrack) return; // missing/late track: UI re-calls on TRACK_ADDED
    const stream = getTrackStream(p.audioTrack);
    if (!stream || stream.getAudioTracks().length === 0) {
      // No live stream — do NOT build a node from an empty/absent stream.
      if (!warned.has(id)) {
        warned.add(id);
        console.warn(
          `[jitsimap] audioEngine: no live audio stream for ${id}; graph skipped (re-attach on TRACK_ADDED)`,
        );
      }
      return;
    }
    const tier = effectiveTier(store.getSettings().tier);
    try {
      const source = ctx.createMediaStreamSource(stream);
      const spatial = ctx.createGain();
      spatial.gain.value = 0; // silent until the first update() (no click)
      const user = ctx.createGain();
      user.gain.value = p.volume;
      source.connect(spatial);
      let panner: StereoPannerNode | null = null;
      if (tier === 'full') {
        panner = ctx.createStereoPanner();
        spatial.connect(panner);
        panner.connect(user);
      } else {
        spatial.connect(user);
      }
      user.connect(master);
      chains.set(id, { source, spatial, panner, user, last: { spatial: -1, pan: 0, user: -1 } });

      if (ATTACH_MUTED_ELEMENT) {
        // §8.6 (proven Chrome quirk, §16.3 matrix): the stream pumps into
        // Web Audio only while also attached to a playing element. Muted,
        // volume-0 element — NEVER an audible attach() (double audio, §17).
        const el = document.createElement('audio');
        el.muted = true;
        el.volume = 0;
        el.srcObject = stream;
        el.play().catch(() => undefined);
        mutedEls.set(id, el);
      }
    } catch (e) {
      if (!warned.has(id)) {
        warned.add(id);
        console.warn(`[jitsimap] audioEngine: attach failed for ${id}:`, e);
      }
    }
  }

  function detachParticipant(id: string): void {
    warned.delete(id);
    const el = mutedEls.get(id);
    if (el) {
      mutedEls.delete(id);
      el.pause();
      el.srcObject = null;
    }
    const c = chains.get(id);
    if (!c) return;
    chains.delete(id);
    c.source.disconnect();
    c.spatial.disconnect();
    c.panner?.disconnect();
    c.user.disconnect();
  }

  function update(now: number): void {
    if (!ctx || !master) return;
    const settings = store.getSettings();
    const tier = effectiveTier(settings.tier);
    const t = ctx.currentTime;
    // Shared master: masterVolume, 0 when deafened (§8.5).
    lastMaster = apply(master.gain, settings.deafened ? 0 : settings.masterVolume, lastMaster, t);

    const lp = store.getLocalPose();
    const zones = store.zones();
    for (const [id, c] of chains) {
      const p = store.getParticipant(id);
      if (!p) continue; // left: the UI calls detachParticipant on USER_LEFT
      const sp = p.pose?.target ?? null; // remote audio at the target pose is fine (§11 τ-smoothing)
      const poseless = isPoseLess(p, now);
      let spatial: number;
      if (poseless)
        spatial = POSELESS_GAIN; // §7.7: flat, pan 0, zones ignored
      else if (!sp || !lp)
        spatial = 1; // listener not on the map yet: flat
      else spatial = spatialGain(lp, sp, zones);
      // Spatial node = distance/zone × tier × mic-mute × mute-other;
      // per-user volume and master live on their own nodes (§8.1 chain).
      const gain = finalGain({
        tier,
        spatial,
        volume: 1,
        mutedForMe: p.mutedForMe,
        micMuted: p.micMuted,
        master: 1,
        deafened: false,
      });
      const pan = tier === 'full' && sp && lp && !poseless ? panFor(sp.x, lp.x) : 0;
      // The panner exists only in the full tier (§8.1); rebuild the middle
      // of the chain when the tier setting changes mid-session.
      if (tier === 'full' && !c.panner) {
        const panner = ctx.createStereoPanner();
        c.spatial.disconnect();
        c.spatial.connect(panner);
        panner.connect(c.user);
        c.panner = panner;
      } else if (tier !== 'full' && c.panner) {
        c.panner.disconnect();
        c.spatial.disconnect();
        c.spatial.connect(c.user);
        c.panner = null;
      }
      c.last.spatial = apply(c.spatial.gain, gain, c.last.spatial, t);
      if (c.panner) c.last.pan = apply(c.panner.pan, pan, c.last.pan, t);
      c.last.user = apply(c.user.gain, p.volume, c.last.user, t);
    }
  }

  function ctxState(): AudioContextState | null {
    return ctx ? ctx.state : null;
  }

  function dispose(): void {
    for (const id of [...chains.keys()]) detachParticipant(id);
    for (const [id, el] of mutedEls) {
      mutedEls.delete(id);
      el.pause();
      el.srcObject = null;
    }
    master?.disconnect();
    master = null;
    ctx = null;
    lastMaster = -1;
    warned.clear();
  }

  return { start, attachParticipant, detachParticipant, update, ctxState, resume, dispose };
}
