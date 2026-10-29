/**
 * Receiver-constraint mapping — SPEC §9.2. Pure mapping from the neutral
 * VideoPlan (api.ts) to the lib's setReceiverConstraints payload, so the
 * shape is unit-tested without a conference. applyReceiverConstraints is
 * the defensive wrapper used by client.ts (no-op when conference is null).
 *
 * Verified surface (docs/lib-surface.md §7): the payload is passed through
 * verbatim to the bridge; lastN is additionally forced by the lib's CPU
 * limiter, which is fine — our lastN is the ceiling, not a floor.
 */

import type { IReceiverVideoConstraints, JitsiConference } from 'lib-jitsi-meet';
import type { VideoPlan } from './api';

/** ≤16 subscribed sources per client (SPEC §9.2 MAX_VIDEO_SOURCES, §15). */
export const MAX_VIDEO_SOURCES = 16;
/** Bubbles are ~96×72 — 180 px high is plenty for everyone (§9.2). */
export const DEFAULT_MAX_HEIGHT = 180;
/** Nearest / on-stage participants get a crisper bubble (§9.2). */
export const HIRES_MAX_HEIGHT = 360;
/** Stage screen-share panel (§9.3). */
export const STAGE_DESKTOP_MAX_HEIGHT = 720;

/** Drop blank/missing source names (defensive) and de-duplicate. */
function namedSources(list: readonly (string | null | undefined)[] | undefined): string[] {
  const out: string[] = [];
  for (const s of list ?? []) {
    if (typeof s === 'string' && s.trim().length > 0 && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Pure VideoPlan → lib payload mapping (§9.2/§9.3). */
export function buildReceiverConstraints(plan: VideoPlan): IReceiverVideoConstraints {
  const selectedSources = namedSources(plan.selectedSources).slice(0, MAX_VIDEO_SOURCES);
  const onStageSources = namedSources(plan.onStageSources);
  const constraints: Record<string, { maxHeight: number }> = {};
  for (const src of namedSources(plan.hiResSources)) {
    constraints[src] = { maxHeight: HIRES_MAX_HEIGHT };
  }
  const stageDesktop = namedSources(plan.stageDesktopSource ? [plan.stageDesktopSource] : [])[0];
  if (stageDesktop) {
    // §9.3: the share joins onStageSources at 720p while its panel is open.
    if (!onStageSources.includes(stageDesktop)) onStageSources.push(stageDesktop);
    constraints[stageDesktop] = { maxHeight: STAGE_DESKTOP_MAX_HEIGHT };
  }
  return {
    lastN: MAX_VIDEO_SOURCES,
    defaultConstraints: { maxHeight: DEFAULT_MAX_HEIGHT },
    constraints,
    selectedSources,
    onStageSources,
  };
}

/** No-op with no conference; a missing/throwing setter degrades to "no video", never a crash. */
export function applyReceiverConstraints(conference: JitsiConference | null, plan: VideoPlan): void {
  if (!conference) return;
  if (typeof conference.setReceiverConstraints !== 'function') {
    console.warn('[jitsimap] setReceiverConstraints absent — video will stay at server defaults (§9.2)');
    return;
  }
  try {
    conference.setReceiverConstraints(buildReceiverConstraints(plan));
  } catch (e) {
    console.warn('[jitsimap] setReceiverConstraints failed:', e);
  }
}
