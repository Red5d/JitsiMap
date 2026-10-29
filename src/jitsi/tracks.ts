/**
 * Track helpers — SPEC §6.4/§6.5. These are the only sanctioned ways for
 * code outside src/jitsi/ to touch lib track objects (the store keeps them
 * opaque; see src/types.ts RemoteState). Browser-free casts + DOM plumbing
 * live here so client.ts stays about lifecycle.
 *
 * Verified surface (docs/lib-surface.md §5): getOriginalStream() exists on
 * JitsiTrack (returns MediaStream|null); getVideoType() gives
 * 'camera' | 'desktop' | 'desktop_high_fps' for video tracks.
 */

import type { JitsiTrack } from 'lib-jitsi-meet';

/**
 * Casts an opaque store track back to its MediaStream (remote audio →
 * Web Audio §8.1, video bubbles §9.1, stage panel §9.3). Defensive: track
 * objects are live lib instances that may be disposed under us — swallow
 * and return null rather than crash a render frame.
 */
export function getTrackStream(track: unknown): MediaStream | null {
  if (!track) return null;
  try {
    return (track as JitsiTrack).getOriginalStream();
  } catch {
    return null;
  }
}

/** Normalised video kind: desktop (§9.3 stage) vs camera (§9.1 bubble). */
export function getTrackVideoType(track: unknown): 'camera' | 'desktop' | null {
  if (!track) return null;
  try {
    const t = track as JitsiTrack;
    if (!t.isVideoTrack()) return null;
    const vt = t.getVideoType();
    if (vt === 'desktop' || vt === 'desktop_high_fps') return 'desktop';
    return vt === 'camera' ? 'camera' : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------ adapter-internal plumbing

/**
 * Attach a (video) track to a DOM element. playsinline is mandatory for
 * Safari autoplay policy; attach() returns a promise that rejects on
 * autoplay-gesture violations (§8.6 family) — the element keeps its
 * stream, so swallow the rejection.
 */
export function attachVideo(el: HTMLVideoElement, track: unknown): void {
  if (!track) return;
  el.playsInline = true;
  el.setAttribute('playsinline', '');
  try {
    const p = (track as JitsiTrack).attach(el);
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  } catch (e) {
    console.warn('[jitsimap] attach failed:', e);
  }
}

/** Detach from one element (stream release itself is via constraints, §11). */
export function detachVideo(el: HTMLVideoElement, track: unknown): void {
  if (!track) return;
  try {
    (track as JitsiTrack).detach(el);
  } catch {
    /* track already disposed — nothing to detach */
  }
}

/** Native stop of the underlying MediaStreamTrack (desktop-share end, §6.4). */
export function stopUnderlyingTrack(track: unknown): void {
  if (!track) return;
  try {
    (track as JitsiTrack).getTrack()?.stop();
  } catch {
    /* disposed */
  }
}
