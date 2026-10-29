/**
 * Pure UI logic — SPEC §5 UX rules expressed as DOM-free functions so the
 * node test environment (no jsdom) can cover them (test/ui.test.ts):
 * routing, invite links, bubble visibility (§9.1), People labels (§7.7),
 * volume slider mapping (§8.5), stage-share zone notices (§9.3), chat text
 * safety (§14) and the canvas aria label (§5.5).
 */

import { normalizeSpaceName } from '../config';
import { distanceTiles, zoneAudible, VIDEO_RADIUS_TILES } from '../spatial/distance';
import { isPoseLess, type Pose, type ReceivedPose, type RemoteState, type ZoneDef } from '../types';

// ---------------------------------------------------------------- routing (§5.1/§6.2)

export type Route =
  | { kind: 'root' }
  | { kind: 'space'; space: string }
  | { kind: 'notfound' };

/** `/s/<space>` → the space name; anything else → null. */
export function spaceFromPath(pathname: string): string | null {
  const m = /^\/s\/([^/]+)\/?$/.exec(pathname);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** `/` → lobby; `/s/<space>` → that space; everything else → notfound (§5.1: fall back to the lobby). */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { kind: 'root' };
  const space = spaceFromPath(pathname);
  if (space !== null) return { kind: 'space', space };
  return { kind: 'notfound' };
}

/** Canonical URL path for a space (same normalisation as the MUC room, §6.2). */
export function pathForSpace(space: string): string {
  return `/s/${normalizeSpaceName(space)}`;
}

/** Invite link for the copy button (origin passed in — DOM-free for tests). */
export function inviteLink(space: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}${pathForSpace(space)}`;
}

// ---------------------------------------------------------------- video bubbles (§9.1)

/** §11 design envelope: ≤16 video elements on screen. */
export const MAX_VIDEO_BUBBLES = 16;
/** Bubble content size (§9.1 ~96×72). */
export const BUBBLE_W = 96;
export const BUBBLE_H = 72;
/** World px above the avatar centre the bubble's bottom edge anchors at. */
export const BUBBLE_HEAD_OFFSET = 26;

export interface BubbleParticipant {
  id: string;
  videoTrack: unknown;
  camMuted: boolean;
  pose: { target: Pose } | null;
}

/**
 * Show a live video bubble for this participant? (§9.1)
 * Requires: a video track, camera unmuted, a known pose within
 * VIDEO_RADIUS_TILES, and an audible zone relationship (§8.3) to the local
 * listener. Pose-less peers never get a bubble (they have no avatar to sit on).
 */
export function bubbleVisible(
  p: BubbleParticipant,
  localPose: Pose | null,
  zones: ReadonlyMap<string, ZoneDef>,
): boolean {
  if (!p.videoTrack || p.camMuted) return false;
  const t = p.pose?.target;
  if (!t || !localPose) return false;
  if (distanceTiles(localPose.x, localPose.y, t.x, t.y) > VIDEO_RADIUS_TILES) return false;
  const speakerZone = t.zone ? zones.get(t.zone) ?? null : null;
  const listenerZone = localPose.zone ? zones.get(localPose.zone) ?? null : null;
  return zoneAudible(speakerZone, listenerZone);
}

/** Own preview bubble shows when the local camera is on (§5.2). */
export function ownPreviewVisible(camOn: boolean): boolean {
  return camOn;
}

// ---------------------------------------------------------------- people (§5.4/§7.7)

/** §7.7 stock-Meet marker — exact wording from the spec. */
export const POSELESS_LABEL = 'in Meet, not on map';

export interface PeopleStatusParticipant {
  pose: ReceivedPose | null;
  joinedAt: number;
}

/**
 * One-line status under a People row: pose-less marker, zone label, and
 * distance in tiles ("~5 tiles"), e.g. "Hall · ~5 tiles".
 */
export function peopleStatusLabel(
  p: PeopleStatusParticipant,
  localPose: Pose | null,
  zones: ReadonlyMap<string, ZoneDef>,
  now: number,
): string {
  const t = p.pose?.target ?? null;
  if (!t) return isPoseLess(p, now) ? POSELESS_LABEL : 'joining…';
  const parts: string[] = [];
  const zone = t.zone ? zones.get(t.zone) ?? null : null;
  if (zone) parts.push(zone.label ?? zone.id);
  if (localPose) parts.push(`~${Math.round(distanceTiles(localPose.x, localPose.y, t.x, t.y))} tiles`);
  return parts.length > 0 ? parts.join(' · ') : 'on the map';
}

// ---------------------------------------------------------------- volume (§8.5)

/** Per-user volume 0..2 (store) ↔ slider percent 0..200. */
export function volumeToSlider(volume: number): number {
  return Math.round(Math.min(Math.max(volume, 0), 2) * 100);
}

export function sliderToVolume(percent: number): number {
  return Math.min(Math.max(percent, 0), 200) / 100;
}

/** Master volume 0..1 (store) ↔ slider percent 0..100. */
export function masterToSlider(master: number): number {
  return Math.round(Math.min(Math.max(master, 0), 1) * 100);
}

export function sliderToMaster(percent: number): number {
  return Math.min(Math.max(percent, 0), 100) / 100;
}

// ---------------------------------------------------------------- stage shares (§9.3)

export interface ShareCandidate {
  id: string;
  name: string;
  /** Label of the sharer's zone (null: zone-less / pose-less → not blocked). */
  zoneLabel: string | null;
  /** Viewable by the local user under the §9.3 zone rule (= §8.3 audibility). */
  viewable: boolean;
}

/**
 * Classify remote desktop sharers against the §9.3 zone rule.
 * Pose-less sharers are treated as viewable (§7.7: audio is global).
 */
export function shareCandidates(
  sharers: RemoteState[],
  localPose: Pose | null,
  zones: ReadonlyMap<string, ZoneDef>,
  localId: string | null,
): ShareCandidate[] {
  const listenerZone = localPose?.zone ? zones.get(localPose.zone) ?? null : null;
  return sharers
    .filter((p) => p.desktopTrack && p.id !== localId)
    .map((p) => {
      const zone = p.pose?.target.zone ? zones.get(p.pose.target.zone) ?? null : null;
      return {
        id: p.id,
        name: p.name || 'Someone',
        zoneLabel: zone ? zone.label ?? zone.id : null,
        viewable: zoneAudible(zone, listenerZone),
      };
    });
}

/**
 * Notices for the People tab (§9.3): a blocked share shows "X is sharing in
 * <zone>" instead of being swallowed; a second viewable share queues.
 * `stageId` = the participant currently rendered on stage (null = none).
 */
export function shareNotices(candidates: ShareCandidate[], stageId: string | null): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (c.id === stageId) continue;
    if (!c.viewable) {
      out.push(`${c.name} is sharing in ${c.zoneLabel ?? 'a hidden zone'}`);
    } else {
      out.push(`${c.name} is sharing (queued — one stage share at a time)`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- chat (§7.6/§14)

/**
 * Chat text safety (§14): the exact string is what gets rendered — React
 * renders `{text}` as a text node, never HTML. Identity, and total: nothing
 * in a string can turn it into markup through this path.
 */
export function chatTextContent(text: string): string {
  return String(text);
}

/** Chat timestamp "HH:MM" (locale formatting). */
export function formatChatTime(ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(ts) || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------- emotes (§5.3)

/** Row of quick emotes for the bottom-bar picker (mirrors game EMOTE_BURST). */
export const EMOTE_ROW = ['👋', '❤️', '😂', '😮', '👏', '🔥', '🎉', '😢'] as const;

// ---------------------------------------------------------------- aria (§5.5)

/** Canvas aria-label: zone name + nearby count, e.g. "Hall · ~Stage — 3 people nearby". */
export function canvasAriaLabel(zoneLabel: string | null, nearby: number): string {
  const n = Number.isFinite(nearby) ? Math.max(0, Math.trunc(nearby)) : 0;
  return `${zoneLabel ?? 'Open map'} — ${n} ${n === 1 ? 'person' : 'people'} nearby`;
}

/** Distance label used in People rows, e.g. 5.4 → "~5 tiles". */
export function distanceLabel(dTiles: number): string {
  return `~${Math.max(0, Math.round(dTiles))} tiles`;
}
