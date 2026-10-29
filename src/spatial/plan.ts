/**
 * Audio-subscription + video planners — SPEC §8.4 / §9. Pure functions over
 * the store (node-testable, §16.1): computeAudibleSourceNames feeds
 * JitsiClient.applyAudioSubscriptions, computeVideoPlan feeds
 * applyReceiverConstraints; the UI loop debounces both via `debounce`
 * (§8.4/§9.2: 500 ms, never per frame, §11).
 *
 * MAX_VIDEO_SOURCES is a value import from src/jitsi/constraints.ts: that
 * module's lib-jitsi-meet import is `import type` (erased at compile time,
 * verified), so this stays node-testable and the §4.2 seam is intact.
 */

import type { VideoPlan } from '../jitsi/api';
import { MAX_VIDEO_SOURCES } from '../jitsi/constraints';
import type { Store } from '../store';
import { isPoseLess } from '../types';
import { distanceTiles, spatialGain, VIDEO_RADIUS_TILES, zoneAudible } from './distance';

/** §9.2: onStageSources = 1–4 nearest. */
export const ON_STAGE_SOURCES = 4;
/** §9.2: nearest sources get { maxHeight: 360 }. */
export const HIRES_SOURCES = 4;

export interface PlanDeps {
  /** True while the stage panel is open showing a share (UI owns dismiss, §9.3). */
  stageDesktopOpen: boolean;
}

/**
 * Audible set for bridge-side audio subscriptions (§8.4): source names of
 * participants with gain > 0 per §8.2/§8.3, plus pose-less per §7.7.
 * Deafened → [] (unsubscribe all). Tier 'off' → every participant the
 * bridge can send us (audioSourceName + hasAudio): distance/zone selection
 * is pointless when local gain is flat (§8.5); mute controls are flat
 * gains applied in the graph, not subscription filters. Sorted for
 * stability so the debounced bridge call sees no churn.
 */
export function computeAudibleSourceNames(store: Store, localId?: string): string[] {
  const { participants, settings } = store.getSnapshot();
  if (settings.deafened) return [];
  const now = Date.now();
  const zones = store.zones();
  const lp = store.getLocalPose();
  const out: string[] = [];
  for (const p of participants) {
    if (localId !== undefined && p.id === localId) continue;
    if (!p.hasAudio || !p.audioSourceName) continue;
    if (settings.tier === 'off') {
      out.push(p.audioSourceName);
      continue;
    }
    if (p.micMuted || p.mutedForMe) continue; // gain 0 ⇒ unsubscribed (§8.1/§8.4)
    if (isPoseLess(p, now)) {
      out.push(p.audioSourceName); // §7.7: heard globally, zones ignored
      continue;
    }
    if (!p.pose || !lp) continue; // no position on one side ⇒ no gain model
    if (spatialGain(lp, p.pose.target, zones) > 0) out.push(p.audioSourceName);
  }
  return out.sort();
}

/**
 * Receiver-constraint selection (§9.1/§9.2/§9.3). Video sources of
 * participants within VIDEO_RADIUS_TILES and in an audible zone relationship
 * (§8.3), capped at MAX_VIDEO_SOURCES; pose-less participants are excluded
 * (§7.7: included only for their screenshare). An empty plan is valid — it
 * tells the bridge to receive nothing.
 */
export function computeVideoPlan(store: Store, localId: string, deps: PlanDeps): VideoPlan {
  const plan: VideoPlan = {
    selectedSources: [],
    onStageSources: [],
    hiResSources: [],
    stageDesktopSource: null,
  };
  const lp = store.getLocalPose();
  if (!lp) return plan; // local avatar not on the map yet ⇒ nothing to select around
  const zones = store.zones();
  const lz = lp.zone ? (zones.get(lp.zone) ?? null) : null;
  const participants = store.getSnapshot().participants;

  const candidates: { source: string; d: number }[] = [];
  for (const p of participants) {
    if (p.id === localId) continue;
    if (!p.hasVideo || p.camMuted || !p.videoSourceName) continue; // camera-off shows emoji (§16.3)
    if (!p.pose) continue; // pose-less excluded from bubbles (§7.7)
    const t = p.pose.target; // audio/video target pose is fine (§11 smoothing covers it)
    const sz = t.zone ? (zones.get(t.zone) ?? null) : null;
    if (!zoneAudible(sz, lz)) continue; // §9.1 zone rule
    const d = distanceTiles(t.x, t.y, lp.x, lp.y);
    if (d > VIDEO_RADIUS_TILES) continue;
    candidates.push({ source: p.videoSourceName, d });
  }
  candidates.sort((a, b) => a.d - b.d || a.source.localeCompare(b.source));
  plan.selectedSources = candidates.slice(0, MAX_VIDEO_SOURCES).map((c) => c.source);
  plan.onStageSources = candidates.slice(0, ON_STAGE_SOURCES).map((c) => c.source);
  plan.hiResSources = candidates.slice(0, HIRES_SOURCES).map((c) => c.source);

  // §9.3: the open stage share joins onStageSources at maxHeight 720 — the
  // 720p constraint itself is added by constraints.ts when it maps this
  // plan. Viewable from the sharer's zone and zones related by audibleFrom;
  // a pose-less sharer has no zone ⇒ always viewable (§7.7). A share hidden
  // by the rule is NOT swallowed: the UI shows "X is sharing in <zone>" in
  // People. One stage share at a time (first sharer wins; a second share
  // queues as a UI notice).
  if (deps.stageDesktopOpen) {
    for (const p of participants) {
      if (p.id === localId || !p.hasDesktop || !p.desktopSourceName) continue;
      const sz = p.pose?.target.zone ? (zones.get(p.pose.target.zone) ?? null) : null;
      if (zoneAudible(sz, lz)) plan.stageDesktopSource = p.desktopSourceName;
      break;
    }
  }
  return plan;
}

/**
 * Trailing-edge debounce for the planner loops (§8.4/§9.2: 500 ms). The
 * latest call's arguments win; `cancel()` drops a pending call (leave).
 */
// biome-ignore lint/suspicious/noExplicitAny: generic over any-arity callbacks
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: Parameters<T>): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as T & { cancel(): void };
  wrapped.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}
