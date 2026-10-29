/**
 * Shared types — the contract between React UI, Phaser, the spatial engine,
 * and the Jitsi adapter. Keep this file dependency-free (types + constants only).
 *
 * Coordinate system: map pixels, origin top-left, 1 tile = 32 px (SPEC §10.1).
 */

export const TILE_SIZE = 32;

/** A movement pose as exchanged on the wire (SPEC §7.2). */
export interface Pose {
  x: number;
  y: number;
  /** Facing direction in degrees, 0 = up, 90 = right. */
  dir: number;
  /** Zone id the avatar centre is inside, or null when zone-less. */
  zone: string | null;
  moving: boolean;
}

/**
 * A received remote pose with the history needed for interpolation.
 * `at` = local receive time (ms). Expire when `now - at > POSE_EXPIRE_MS`.
 */
export interface ReceivedPose {
  target: Pose;
  prev: Pose;
  prevAt: number;
  at: number;
}

/** Zone rectangle extracted from the `zones` object layer (SPEC §10.2). */
export interface ZoneDef {
  id: string;
  label?: string;
  /** Occupants of this zone are inaudible to everyone (SPEC §8.3). */
  silent: boolean;
  /** Zone ids whose occupants can hear THIS zone's occupants (one-way, §8.3). */
  audibleFrom: string[];
  stage: boolean;
  /** Rectangle in map pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpawnPoint {
  id: string;
  x: number;
  y: number;
}

/**
 * Parsed map (SPEC §10). Produced by `game/maps.ts` loader, validated by
 * `scripts/validate-maps.mjs`. Consumed by Phaser scene, collision,
 * zone lookup, protocol validation (bounds + zone ids).
 */
export interface MapData {
  id: string;
  /** Grid size in tiles. */
  width: number;
  height: number;
  /** Pixel size (width * tileWidth). */
  widthPx: number;
  heightPx: number;
  tileWidth: number;
  tileHeight: number;
  zones: ZoneDef[];
  spawns: SpawnPoint[];
  /** width*height, row-major; 1 = solid. Evaluated on ground + furniture. */
  collision: Uint8Array;
}

/** Avatar: emoji is the MVP default path; imageUrl is https-only (SPEC §14). */
export interface AvatarInfo {
  emoji: string;
  imageUrl?: string;
}

export interface Emote {
  endpointId: string;
  emoji: string;
  ts: number;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  self: boolean;
}

/** Spatial audio tier (SPEC §5.4 / §8.5). */
export type AudioTier = 'auto' | 'full' | 'gain' | 'off';

export type AuthMode = 'anonymous' | 'jwt-guest' | 'jwt-token';

/** User-facing settings, persisted to localStorage (SPEC §14: name + settings only). */
export interface Settings {
  displayName: string;
  avatar: AvatarInfo;
  tier: AudioTier;
  /** 0..1 */
  masterVolume: number;
  deafened: boolean;
  audioDeviceId: string | null;
  videoDeviceId: string | null;
  speakerDeviceId: string | null;
}

/**
 * Connection lifecycle states (SPEC §5.1 / §6.2).
 * `waiting-host` = JWT+guests room not yet opened (§6.6).
 */
export type Status = 'lobby' | 'connecting' | 'joined' | 'reconnecting' | 'waiting-host' | 'failed';

/**
 * Everything the store knows about a remote participant (SPEC §7.7 includes
 * pose-less stock-Meet users). One per endpoint id.
 */
export interface RemoteState {
  id: string;
  name: string;
  avatar: AvatarInfo;
  /** null = pose-less (stock Meet participant, §7.7). */
  pose: ReceivedPose | null;
  lastSeen: number;
  joinedAt: number;
  micMuted: boolean;
  camMuted: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
  hasDesktop: boolean;
  /** Source names for constraints / audio subscriptions (§8.4 / §9.2). */
  audioSourceName: string | null;
  videoSourceName: string | null;
  desktopSourceName: string | null;
  /** 0..1 speaking level from TRACK_AUDIO_LEVEL_CHANGED (throttled). */
  audioLevel: number;
  /** Per-local-user controls (§8.5). */
  volume: number; // 0..2, default 1
  mutedForMe: boolean;
  /**
   * Live lib-jitsi-meet JitsiTrack objects for rendering. Untyped here to
   * keep this module lib-free; UI casts them at the `src/jitsi/` seam.
   */
  audioTrack: unknown | null;
  videoTrack: unknown | null;
  desktopTrack: unknown | null;
}

/** A participant is pose-less 10 s after joining with no JitsiMap state (§7.7). */
export function isPoseLess(p: Pick<RemoteState, 'pose' | 'joinedAt'>, now: number): boolean {
  return p.pose === null && now - p.joinedAt > 10_000;
}

/** Curated emoji set for the avatar picker (SPEC §5.1). */
export const EMOJI_SET = [
  '🧙',
  '🧝',
  '🧛',
  '🧟',
  '🧞',
  '🦸',
  '🦹',
  '🧜',
  '🧚',
  '👩‍🚀',
  '🐱',
  '🐶',
  '🦊',
  '🐻',
  '🐼',
  '🐸',
  '🦉',
  '🐙',
  '🦄',
  '🐧',
  '🍄',
  '🌵',
  '🌻',
  '⭐',
  '🌙',
  '🔥',
  '❄️',
  '🌈',
  '⚡',
  '💧',
  '🤖',
  '👻',
  '🎃',
  '🎩',
  '👑',
  '🕵️',
  '🧸',
  '🍕',
  '🚀',
  '🎧',
] as const;

export function randomEmoji(): string {
  return EMOJI_SET[Math.floor(Math.random() * EMOJI_SET.length)] as string;
}
