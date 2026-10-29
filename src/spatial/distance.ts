/**
 * Spatial audio model — SPEC §8.2/§8.3. Pure functions, unit-tested (§16.1):
 * gain endpoints/midpoints, zone blocking, directed audibleFrom, silent zones,
 * pan clamping. No browser APIs here.
 */

import { TILE_SIZE, type Pose, type ZoneDef } from '../types';

export const FULL_RADIUS_TILES = 2;
export const HEAR_RADIUS_TILES = 8;
export const VIDEO_RADIUS_TILES = 6;
export const PAN_MAX = 0.8;
/** Gain applied to every subscribed participant in the "Off" tier (§8.5). */
export const OFF_TIER_GAIN = 0.9;
/** Gain for pose-less (stock Meet) participants, unpanned (§7.7). */
export const POSELESS_GAIN = 0.8;

export function distanceTiles(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy) / TILE_SIZE;
}

/**
 * Distance gain (§8.2): 1.0 at d ≤ 2 tiles, 0 at d ≥ 8,
 * gain = clamp((HEAR - d) / (HEAR - FULL), 0, 1) ^ 1.5.
 */
export function distanceGain(dTiles: number): number {
  if (!Number.isFinite(dTiles)) return 0;
  if (dTiles <= FULL_RADIUS_TILES) return 1;
  if (dTiles >= HEAR_RADIUS_TILES) return 0;
  const t = (HEAR_RADIUS_TILES - dTiles) / (HEAR_RADIUS_TILES - FULL_RADIUS_TILES);
  return Math.pow(Math.min(Math.max(t, 0), 1), 1.5);
}

/**
 * Stereo pan from the speaker's horizontal offset relative to the listener,
 * clamped to [-0.8, 0.8] (§8.3). Full deflection at the hear radius.
 */
export function panFor(speakerX: number, listenerX: number): number {
  const dx = speakerX - listenerX;
  if (!Number.isFinite(dx)) return 0;
  const p = dx / (HEAR_RADIUS_TILES * TILE_SIZE);
  return Math.min(Math.max(p, -PAN_MAX), PAN_MAX);
}

/**
 * Can an occupant of `listenerZone` hear an occupant of `speakerZone` at all?
 * (§8.3, zones are the wall model)
 * - silent speaker zone → never audible.
 * - same zone (including both zone-less) → yes.
 * - exactly one zone-less → yes (distance model).
 * - different non-null zones → yes only if the SPEAKER's zone lists the
 *   listener's zone in `audibleFrom` (one-way; e.g. stage.audibleFrom=[hall]
 *   means hall hears stage, not vice versa).
 */
export function zoneAudible(
  speakerZone: ZoneDef | null | undefined,
  listenerZone: ZoneDef | null | undefined
): boolean {
  if (speakerZone?.silent) return false;
  if (!speakerZone && !listenerZone) return true;
  if (!speakerZone || !listenerZone) return true;
  if (speakerZone.id === listenerZone.id) return true;
  return speakerZone.audibleFrom.includes(listenerZone.id);
}

/**
 * Spatial gain for one remote speaker as heard by the local listener (§8.2/§8.3).
 * Returns 0 when blocked; otherwise the distance curve. Multiplication with
 * per-user volume / master / mute happens in the audio engine (§8.1).
 */
export function spatialGain(
  listener: Pick<Pose, 'x' | 'y' | 'zone'>,
  speaker: Pick<Pose, 'x' | 'y' | 'zone'>,
  zones: ReadonlyMap<string, ZoneDef>
): number {
  const lz = listener.zone ? (zones.get(listener.zone) ?? null) : null;
  const sz = speaker.zone ? (zones.get(speaker.zone) ?? null) : null;
  if (!zoneAudible(sz, lz)) return 0;
  return distanceGain(distanceTiles(speaker.x, speaker.y, listener.x, listener.y));
}

/**
 * Full per-participant gain chain (§8.1/§8.5, tested in §16.1):
 * spatial × volume(0..2) × mutedForMe(0|1) × micMuted(0|1) × master(0..1)
 * × deafen(0|1). Tier 'off' → flat OFF_TIER_GAIN for subscribed participants
 * (mute/deafen/master still apply). Pose-less speakers: flat POSELESS_GAIN,
 * unpanned (pan = 0), ignoring zones (§7.7).
 */
export interface GainInput {
  tier: 'auto' | 'full' | 'gain' | 'off';
  spatial: number;
  volume: number;
  mutedForMe: boolean;
  micMuted: boolean;
  master: number;
  deafened: boolean;
}

export function finalGain(g: GainInput): number {
  if (g.deafened || g.mutedForMe || g.micMuted) return 0;
  const base = g.tier === 'off' ? OFF_TIER_GAIN : g.spatial;
  return Math.max(0, base * g.volume * g.master);
}
