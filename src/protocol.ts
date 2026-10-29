/**
 * JitsiMap endpoint-message protocol — SPEC §7. Single source of truth for
 * encode/decode + validation. Pure module: unit-testable without a browser.
 *
 * Transport: conference.broadcastEndpointMessage / sendEndpointMessage.
 * Best-effort: no ordering or delivery guarantees. Payloads < 500 bytes.
 * Foreign payloads (stock Meet clients) decode to null, never throw.
 */

import type { AvatarInfo, Pose } from './types';

export const NS = 'jitsimap';
export const PROTOCOL_VERSION = 1;

// Wire constants (SPEC §7.3, §13)
export const POSE_SEND_INTERVAL_MS = 125; // 8 Hz while moving
export const POSE_HEARTBEAT_MS = 20_000; // idle re-broadcast
export const POSE_EXPIRE_MS = 45_000; // pose-less/expiry threshold (§7.7)
export const STATE_REQUEST_DELAY_MS = 300; // after hello (§7.4)
export const MAX_NAME_LEN = 64;
export const MAX_EMOJI_LEN = 8;
export const MAX_AVATAR_URL_LEN = 512;
export const EMOTE_RATE_LIMIT_MS = 500; // ≤2/s (§5.3)
export const POSE_MIN_MOVE_PX = 2; // only send if moved >2 px (§7.3)

export type MessageType = 'pose' | 'hello' | 'state-request' | 'state' | 'emote' | 'avatar';

export interface EnvelopeBase {
  ns: typeof NS;
  v: number;
  type: MessageType;
  ts: number;
}
export interface PoseMsg extends EnvelopeBase {
  type: 'pose';
  x: number;
  y: number;
  dir: number;
  zone: string | null;
  moving: boolean;
}
export interface HelloMsg extends EnvelopeBase {
  type: 'hello';
  name: string;
  avatar: string;
  zone: string | null;
}
export interface StateRequestMsg extends EnvelopeBase {
  type: 'state-request';
}
export interface StateMsg extends EnvelopeBase {
  type: 'state';
  name: string;
  avatar: string;
  x: number;
  y: number;
  dir: number;
  zone: string | null;
}
export interface EmoteMsg extends EnvelopeBase {
  type: 'emote';
  emoji: string;
}
export interface AvatarMsg extends EnvelopeBase {
  type: 'avatar';
  avatar: string;
}
export type EncodedMessage = PoseMsg | HelloMsg | StateRequestMsg | StateMsg | EmoteMsg | AvatarMsg;

/** Map-derived constraints for validation (SPEC §7.3 MUST rules). */
export interface ValidationCtx {
  widthPx: number;
  heightPx: number;
  zoneIds: ReadonlySet<string>;
}

/** Decoded + validated message (all fields already clamped/sanitized). */
export type DecodedMessage =
  | { type: 'pose'; pose: Pose }
  | { type: 'hello'; name: string; avatar: AvatarInfo; zone: string | null }
  | { type: 'state-request' }
  | { type: 'state'; name: string; avatar: AvatarInfo; pose: Pose }
  | { type: 'emote'; emoji: string }
  | { type: 'avatar'; avatar: AvatarInfo };

// ---------------------------------------------------------------- encoding

function envelope<T extends MessageType>(type: T): Omit<EnvelopeBase, 'type'> & { type: T } {
  return { ns: NS, v: PROTOCOL_VERSION, type, ts: Date.now() };
}

export function encodePose(pose: Pose): PoseMsg {
  return { ...envelope('pose'), x: Math.round(pose.x), y: Math.round(pose.y), dir: Math.round(pose.dir), zone: pose.zone, moving: pose.moving };
}

export function encodeHello(name: string, avatar: AvatarInfo, zone: string | null): HelloMsg {
  return { ...envelope('hello'), name, avatar: avatarToWire(avatar), zone };
}

export function encodeStateRequest(): StateRequestMsg {
  return envelope('state-request');
}

export function encodeState(name: string, avatar: AvatarInfo, pose: Pose): StateMsg {
  return {
    ...envelope('state'),
    name,
    avatar: avatarToWire(avatar),
    x: Math.round(pose.x),
    y: Math.round(pose.y),
    dir: Math.round(pose.dir),
    zone: pose.zone,
  };
}

export function encodeEmote(emoji: string): EmoteMsg {
  return { ...envelope('emote'), emoji };
}

export function encodeAvatar(avatar: AvatarInfo): AvatarMsg {
  return { ...envelope('avatar'), avatar: avatarToWire(avatar) };
}

export function avatarToWire(a: AvatarInfo): string {
  return a.imageUrl ?? a.emoji;
}

// ---------------------------------------------------------------- decoding

/** Cheap pre-check before full decode (e.g. for logging/diagnostics). */
export function isJitsiMapMessage(raw: unknown): raw is EnvelopeBase {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as EnvelopeBase).ns === NS &&
    (raw as EnvelopeBase).v === PROTOCOL_VERSION &&
    typeof (raw as EnvelopeBase).type === 'string'
  );
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Name ≤64 chars, trimmed; empty/null when invalid. */
function validName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, MAX_NAME_LEN);
  return s.length > 0 ? s : null;
}

/** Emoji ≤8 chars, or https: URL ≤512 chars (SPEC §14). null = reject. */
export function validAvatar(v: unknown): AvatarInfo | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0) return null;
  if (s.length <= MAX_EMOJI_LEN) return { emoji: s };
  if (s.length <= MAX_AVATAR_URL_LEN && s.startsWith('https://')) {
    return { emoji: '🙂', imageUrl: s };
  }
  return null;
}

function validZone(v: unknown, ctx: ValidationCtx): string | null {
  return typeof v === 'string' && ctx.zoneIds.has(v) ? v : null;
}

/** x/y clamped to map bounds; null when non-finite (drop message). */
function clampPos(x: unknown, y: unknown, ctx: ValidationCtx): { x: number; y: number } | null {
  const px = finiteNumber(x);
  const py = finiteNumber(y);
  if (px === null || py === null) return null;
  return {
    x: Math.min(Math.max(px, 0), ctx.widthPx),
    y: Math.min(Math.max(py, 0), ctx.heightPx),
  };
}

function validDir(v: unknown): number {
  const d = finiteNumber(v);
  if (d === null) return 0;
  return ((d % 360) + 360) % 360;
}

function decodePoseFields(x: unknown, y: unknown, dir: unknown, zone: unknown, ctx: ValidationCtx): Pose | null {
  const pos = clampPos(x, y, ctx);
  if (!pos) return null;
  return { x: pos.x, y: pos.y, dir: validDir(dir), zone: validZone(zone, ctx), moving: false };
}

/**
 * Decode a raw endpoint-message payload into a validated message.
 * Returns null for anything foreign, malformed, or from an unknown type —
 * callers MUST treat null as "ignore silently" (§7.2). Messages from self
 * must be dropped by the caller (endpoint id is not in the payload).
 */
export function decodeMessage(raw: unknown, ctx: ValidationCtx): DecodedMessage | null {
  if (!isJitsiMapMessage(raw)) return null;
  const m = raw as EnvelopeBase & Record<string, unknown>;
  switch (m.type) {
    case 'pose': {
      const pose = decodePoseFields(m.x, m.y, m.dir, m.zone, ctx);
      if (!pose) return null;
      pose.moving = m.moving === true;
      return { type: 'pose', pose };
    }
    case 'hello': {
      const name = validName(m.name);
      const avatar = validAvatar(m.avatar);
      if (!name || !avatar) return null;
      return { type: 'hello', name, avatar, zone: validZone(m.zone, ctx) };
    }
    case 'state-request':
      return { type: 'state-request' };
    case 'state': {
      const name = validName(m.name);
      const avatar = validAvatar(m.avatar);
      const pose = decodePoseFields(m.x, m.y, m.dir, m.zone, ctx);
      if (!name || !avatar || !pose) return null;
      pose.moving = false;
      return { type: 'state', name, avatar, pose };
    }
    case 'emote': {
      if (typeof m.emoji !== 'string') return null;
      const e = m.emoji.trim();
      if (e.length === 0 || e.length > MAX_EMOJI_LEN) return null;
      return { type: 'emote', emoji: e };
    }
    case 'avatar': {
      const avatar = validAvatar(m.avatar);
      if (!avatar) return null;
      return { type: 'avatar', avatar };
    }
    default:
      return null;
  }
}
