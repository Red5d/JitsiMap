/**
 * MessagingHub — the SPEC §7 endpoint-message state machine.
 *
 * Transport-agnostic and browser-free: it is handed send functions, the
 * store, a map-validation context, a clock, and (optionally) injectable
 * timers, so the whole join-time exchange / pose throttle / heartbeat /
 * expiry logic is unit-testable in node (test/messaging.test.ts). Only
 * client.ts touches lib-jitsi-meet events and feeds this class.
 *
 * Implements:
 *  - §7.2 typed payloads via protocol.decodeMessage (foreign → ignore).
 *  - §7.3 pose send: 8 Hz (POSE_SEND_INTERVAL_MS) + >2 px / dir / zone rule,
 *    immediate flush on stop & zone change, 20 s pose+avatar heartbeat,
 *    5 s pose-expiry sweep (store.expirePoses), emote limit ≤2/s.
 *  - §7.4 join-time exchange: hello + pose{spawn}, state-request after
 *    300 ms; direct state reply to hello/state-request from a peer whose
 *    map state we don't know; state replies build the world.
 *  - §7.5 USER_LEFT → participant removal (no goodbye message).
 *  - §7.3 self-message drop; validation/clamping lives in protocol.ts.
 */

import {
  type DecodedMessage,
  decodeMessage,
  EMOTE_RATE_LIMIT_MS,
  type EncodedMessage,
  encodeAvatar,
  encodeEmote,
  encodeHello,
  encodePose,
  encodeState,
  encodeStateRequest,
  POSE_HEARTBEAT_MS,
  POSE_MIN_MOVE_PX,
  POSE_SEND_INTERVAL_MS,
  STATE_REQUEST_DELAY_MS,
  type ValidationCtx,
} from '../protocol';
import type { Snapshot } from '../store';
import type { AvatarInfo, Emote, Pose, RemoteState } from '../types';

/** Pose-expiry sweep cadence (§7.3: expire at 45 s; sweep every 5 s). */
export const POSE_SWEEP_INTERVAL_MS = 5_000;

/** The slice of the store the hub uses; the real Store satisfies it (structurally). */
export interface MessagingStore {
  getParticipant(id: string): RemoteState | undefined;
  upsertParticipant(id: string, patch: Partial<Omit<RemoteState, 'id'>>): RemoteState;
  removeParticipant(id: string): void;
  setRemotePose(id: string, pose: Pose, now: number): void;
  expirePoses(now: number): void;
  emitEmote(e: Emote): void;
  getLocalPose(): Pose | null;
  getSnapshot(): Pick<Snapshot, 'local' | 'localZone'>;
}

/** Injectable clock source (fakeable in tests; defaults to the globals). */
export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const DEFAULT_TIMERS: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface MessagingDeps {
  /** conference.broadcastEndpointMessage(encode*) — poses/hello/emote/avatar/state-request. */
  sendBroadcast: (msg: EncodedMessage) => void;
  /** conference.sendEndpointMessage(to, encode*) — §7.4 direct state replies. */
  sendDirect: (to: string, msg: EncodedMessage) => void;
  /** Own endpoint id (conference.myUserId() at join time) — self-messages dropped. */
  selfId: string;
  /** Map bounds + zone ids for §7.3 validation (rebuilt per call; cheap). */
  getMapCtx: () => ValidationCtx;
  store: MessagingStore;
  /** Monotonic-enough wall clock (ms). */
  now: () => number;
  timers?: Timers;
}

type HelloDecoded = Extract<DecodedMessage, { type: 'hello' }>;
type StateDecoded = Extract<DecodedMessage, { type: 'state' }>;

export class MessagingHub {
  private readonly deps: MessagingDeps;
  private readonly timers: Timers;
  private started = false;
  /** Latest pose fed by the movement loop (drives the heartbeat). */
  private lastFed: Pose | null = null;
  /** Last pose actually put on the wire — the >2 px rule compares against it. */
  private lastSent: { pose: Pose; at: number } | null = null;
  private lastEmoteAt = 0;
  private stateRequestTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private sweepTimer: unknown = null;

  constructor(deps: MessagingDeps) {
    this.deps = deps;
    this.timers = deps.timers ?? DEFAULT_TIMERS;
  }

  /**
   * §7.4 newcomer side: broadcast hello + pose{spawn} immediately, then
   * state-request STATE_REQUEST_DELAY_MS later. Starts heartbeat + expiry
   * sweep. `spawn` defaults to the store's local pose (set by the game
   * module before join resolves).
   */
  start(spawn: Pose | null = null): void {
    if (this.started) return;
    this.started = true;
    const { store, sendBroadcast } = this.deps;
    const snap = store.getSnapshot();
    const pose = spawn ?? store.getLocalPose();
    this.lastFed = pose;
    sendBroadcast(encodeHello(snap.local.name, snap.local.avatar, snap.localZone?.id ?? pose?.zone ?? null));
    if (pose) this.sendPoseNow(pose);
    this.stateRequestTimer = this.timers.setTimeout(() => {
      this.stateRequestTimer = null;
      if (this.started) sendBroadcast(encodeStateRequest());
    }, STATE_REQUEST_DELAY_MS);
    this.heartbeatTimer = this.timers.setInterval(() => this.beat(), POSE_HEARTBEAT_MS);
    this.sweepTimer = this.timers.setInterval(() => store.expirePoses(this.deps.now()), POSE_SWEEP_INTERVAL_MS);
  }

  /** Tear down all timers (leave/rejoin — §6.2 "any rejoin is a fresh join"). */
  stop(): void {
    this.started = false;
    if (this.stateRequestTimer !== null) this.timers.clearTimeout(this.stateRequestTimer);
    if (this.heartbeatTimer !== null) this.timers.clearInterval(this.heartbeatTimer);
    if (this.sweepTimer !== null) this.timers.clearInterval(this.sweepTimer);
    this.stateRequestTimer = this.heartbeatTimer = this.sweepTimer = null;
  }

  // ---------------------------------------------------------------- sending

  /**
   * §7.3 pose send. Throttled to POSE_SEND_INTERVAL_MS while moving, only on
   * >2 px / direction / zone change; zone change and the moving→stopped
   * transition flush immediately (bypassing the throttle). Idle poses are
   * covered by the heartbeat.
   */
  feedPose(pose: Pose): void {
    if (!this.started) return;
    this.lastFed = pose;
    const sent = this.lastSent;
    if (!sent) {
      this.sendPoseNow(pose);
      return;
    }
    const zoneChanged = pose.zone !== sent.pose.zone;
    const stopped = sent.pose.moving && !pose.moving;
    if (zoneChanged || stopped) {
      this.sendPoseNow(pose);
      return;
    }
    if (!pose.moving) return; // idle → heartbeat covers us
    const movedPx = Math.hypot(pose.x - sent.pose.x, pose.y - sent.pose.y);
    const dirChanged = pose.dir !== sent.pose.dir;
    const significant = movedPx > POSE_MIN_MOVE_PX || dirChanged || zoneChanged;
    if (significant && this.deps.now() - sent.at >= POSE_SEND_INTERVAL_MS) {
      this.sendPoseNow(pose);
    }
    // Throttle window with a significant change: dropped — the stop flush
    // (above) guarantees peers end up with our final position.
  }

  /** §5.3 emote, rate-limited to ≤2/s. Returns false when dropped. */
  sendEmote(emoji: string): boolean {
    const t = this.deps.now();
    if (t - this.lastEmoteAt < EMOTE_RATE_LIMIT_MS) return false;
    this.lastEmoteAt = t;
    this.deps.sendBroadcast(encodeEmote(emoji));
    return true;
  }

  /** §7.2 avatar change mid-session. */
  sendAvatar(avatar: AvatarInfo): void {
    this.deps.sendBroadcast(encodeAvatar(avatar));
  }

  // ---------------------------------------------------------------- receiving

  /**
   * Entry point for ENDPOINT_MESSAGE_RECEIVED (client.ts has already mapped
   * the JitsiParticipant to its id). Drops self (§7.3) and foreign payloads
   * (§7.2 — returns null, never throws). Returns the decoded message for
   * diagnostics/tests.
   */
  onEndpointMessage(from: string, raw: unknown): DecodedMessage | null {
    if (!from || from === this.deps.selfId) return null;
    const msg = decodeMessage(raw, this.deps.getMapCtx());
    if (!msg) return null;
    switch (msg.type) {
      case 'hello':
        this.onHello(from, msg);
        break;
      case 'state-request':
        this.onStateRequest(from);
        break;
      case 'state':
        this.onState(from, msg);
        break;
      case 'pose':
        this.onPose(from, msg.pose);
        break;
      case 'emote':
        this.onEmote(from, msg.emoji);
        break;
      case 'avatar':
        this.onAvatar(from, msg.avatar);
        break;
    }
    return msg;
  }

  /** §7.5 — USER_LEFT is the single removal path (graceful + ungraceful). */
  onUserLeft(id: string): void {
    this.deps.store.removeParticipant(id);
  }

  private onHello(from: string, msg: HelloDecoded): void {
    this.deps.store.upsertParticipant(from, { name: msg.name, avatar: msg.avatar });
    this.replyStateIfUnknown(from);
  }

  private onStateRequest(from: string): void {
    this.replyStateIfUnknown(from);
  }

  private onState(from: string, msg: StateDecoded): void {
    const { store } = this.deps;
    store.upsertParticipant(from, { name: msg.name, avatar: msg.avatar });
    store.setRemotePose(from, msg.pose, this.deps.now());
  }

  private onPose(from: string, pose: Pose): void {
    const { store } = this.deps;
    // Hello can be lost (best-effort channel) — a pose from a stranger still
    // puts them on the map (§7.4 "ongoing poses").
    if (!store.getParticipant(from)) store.upsertParticipant(from, {});
    store.setRemotePose(from, pose, this.deps.now());
  }

  private onEmote(from: string, emoji: string): void {
    this.deps.store.emitEmote({ endpointId: from, emoji, ts: this.deps.now() });
  }

  private onAvatar(from: string, avatar: AvatarInfo): void {
    this.deps.store.upsertParticipant(from, { avatar });
  }

  // ---------------------------------------------------------------- internals

  /**
   * §7.4: reply our full state, direct, to a peer whose MAP STATE we don't
   * know. "Known" = the participant already has a pose — USER_JOINED creates
   * store entries for every endpoint (including stock Meet users), so
   * presence alone must not count as known.
   */
  private replyStateIfUnknown(from: string): void {
    const { store } = this.deps;
    if (store.getParticipant(from)?.pose) return;
    const pose = store.getLocalPose();
    if (!pose) return; // nothing to share yet
    const snap = store.getSnapshot();
    this.deps.sendDirect(from, encodeState(snap.local.name, snap.local.avatar, pose));
  }

  /** Heartbeat (§7.3): re-broadcast current pose (moving=false, we are idle) + avatar. */
  private beat(): void {
    const pose = this.lastFed;
    if (pose) this.sendPoseNow({ ...pose, moving: false });
    this.deps.sendBroadcast(encodeAvatar(this.deps.store.getSnapshot().local.avatar));
  }

  private sendPoseNow(pose: Pose): void {
    this.deps.sendBroadcast(encodePose(pose));
    this.lastSent = { pose, at: this.deps.now() };
  }
}
