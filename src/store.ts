/**
 * Single typed store — SPEC §11. Owns truth (participants, poses, zones,
 * chat, settings, connection status). React subscribes via useSyncExternalStore
 * over getSnapshot(); Phaser reads imperatively each frame and writes the
 * local pose. The Jitsi adapter and spatial engine mutate via the methods below.
 * No module outside src/jitsi/ touches lib-jitsi-meet.
 */

import {
  type AvatarInfo,
  type ChatMessage,
  type Emote,
  type MapData,
  type Pose,
  type ReceivedPose,
  type RemoteState,
  type Settings,
  type Status,
  type ZoneDef,
  randomEmoji,
} from './types';
import { POSE_EXPIRE_MS } from './protocol';

const LS_KEY = 'jitsimap.v1';

export interface LocalState {
  id: string | null;
  name: string;
  avatar: AvatarInfo;
  /** Latest committed local pose (written by movement, read by pose loop). */
  pose: Pose | null;
}

export interface Snapshot {
  version: number;
  status: Status;
  lastError: string | null;
  map: MapData | null;
  participants: readonly RemoteState[];
  local: LocalState;
  chat: readonly ChatMessage[];
  settings: Settings;
  /** Zone the local avatar is currently in (for HUD label + aria). */
  localZone: ZoneDef | null;
}

interface Persisted {
  displayName?: string;
  settings?: Partial<Settings>;
}

function loadPersisted(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Persisted;
  } catch {
    return {};
  }
}

function defaultSettings(p: Persisted): Settings {
  return {
    displayName: typeof p.displayName === 'string' ? p.displayName : '',
    avatar: { emoji: randomEmoji() },
    tier: 'auto',
    masterVolume: 1,
    deafened: false,
    audioDeviceId: null,
    videoDeviceId: null,
    speakerDeviceId: null,
    ...p.settings,
  };
}

export class Store {
  private version = 0;
  private listeners = new Set<() => void>();
  private emoteListeners = new Set<(e: Emote) => void>();
  private snapshot: Snapshot | null = null;

  private status: Status = 'lobby';
  private lastError: string | null = null;
  private map: MapData | null = null;
  private participants = new Map<string, RemoteState>();
  private chat: ChatMessage[] = [];
  private local: LocalState = { id: null, name: '', avatar: { emoji: '🙂' }, pose: null };
  private settings: Settings;

  constructor() {
    this.settings = defaultSettings(loadPersisted());
  }

  // ------------------------------------------------ subscription (React)

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): Snapshot => {
    if (!this.snapshot) {
      this.snapshot = {
        version: this.version,
        status: this.status,
        lastError: this.lastError,
        map: this.map,
        participants: Object.freeze([...this.participants.values()]),
        local: { ...this.local },
        chat: Object.freeze([...this.chat]),
        settings: { ...this.settings, avatar: { ...this.settings.avatar } },
        localZone: this.zoneAt(this.local.pose),
      };
    }
    return this.snapshot;
  };

  onEmote(cb: (e: Emote) => void): () => void {
    this.emoteListeners.add(cb);
    return () => this.emoteListeners.delete(cb);
  }

  emitEmote(e: Emote): void {
    for (const cb of this.emoteListeners) cb(e);
  }

  private touch(): void {
    this.version++;
    this.snapshot = null;
    for (const cb of this.listeners) cb();
  }

  // ------------------------------------------------ map

  setMap(map: MapData | null): void {
    this.map = map;
    this.touch();
  }

  zoneAt(pose: Pose | null): ZoneDef | null {
    return pose ? this.zoneAtPoint(pose.x, pose.y) : null;
  }

  zoneAtPoint(x: number, y: number): ZoneDef | null {
    if (!this.map) return null;
    // Last match wins (zones added later sit "on top").
    for (let i = this.map.zones.length - 1; i >= 0; i--) {
      const z = this.map.zones[i]!;
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z;
    }
    return null;
  }

  zones(): ReadonlyMap<string, ZoneDef> {
    const m = new Map<string, ZoneDef>();
    for (const z of this.map?.zones ?? []) m.set(z.id, z);
    return m;
  }

  // ------------------------------------------------ status

  setStatus(status: Status, error: string | null = null): void {
    this.status = status;
    this.lastError = error;
    this.touch();
  }

  // ------------------------------------------------ participants

  getParticipant(id: string): RemoteState | undefined {
    return this.participants.get(id);
  }

  /** Create-from-partial + shallow patch. Never patches `pose` implicitly. */
  upsertParticipant(id: string, patch: Partial<Omit<RemoteState, 'id'>>): RemoteState {
    const existing = this.participants.get(id);
    const next: RemoteState = existing
      ? { ...existing, ...patch }
      : {
          id,
          name: '',
          avatar: { emoji: '🙂' },
          pose: null,
          lastSeen: Date.now(),
          joinedAt: Date.now(),
          micMuted: false,
          camMuted: false,
          hasAudio: false,
          hasVideo: false,
          hasDesktop: false,
          audioSourceName: null,
          videoSourceName: null,
          desktopSourceName: null,
          audioLevel: 0,
          volume: 1,
          mutedForMe: false,
          videoTrack: null,
          desktopTrack: null,
          ...patch,
        };
    this.participants.set(id, next);
    this.touch();
    return next;
  }

  removeParticipant(id: string): void {
    if (this.participants.delete(id)) this.touch();
  }

  /**
   * Record a received pose with interpolation history (§7.3): the current
   * target becomes `prev`; snap (>2 tiles divergence) is handled by the
   * interpolator, not here.
   */
  setRemotePose(id: string, pose: Pose, now: number): void {
    const p = this.participants.get(id);
    if (!p) return;
    const prev = p.pose?.target ?? pose;
    const received: ReceivedPose = {
      target: pose,
      prev,
      prevAt: p.pose?.at ?? now,
      at: now,
    };
    this.participants.set(id, { ...p, pose: received, lastSeen: now });
    this.touch();
  }

  /** Drop poses not refreshed within POSE_EXPIRE_MS → participant becomes pose-less (§7.3/§7.7). */
  expirePoses(now: number): void {
    let changed = false;
    for (const [id, p] of this.participants) {
      if (p.pose && now - p.pose.at > POSE_EXPIRE_MS) {
        this.participants.set(id, { ...p, pose: null });
        changed = true;
      }
    }
    if (changed) this.touch();
  }

  // ------------------------------------------------ local

  setLocalId(id: string): void {
    this.local = { ...this.local, id };
    this.touch();
  }

  setLocalIdentity(name: string, avatar: AvatarInfo): void {
    this.local = { ...this.local, name, avatar };
    this.settings = { ...this.settings, displayName: name, avatar };
    this.persist();
    this.touch();
  }

  /**
   * Hot path: called every movement tick. Only notifies listeners on zone
   * change (HUD label / aria) — the pose itself is read imperatively.
   */
  setLocalPose(pose: Pose): void {
    const prevZone = this.local.pose?.zone;
    this.local.pose = pose;
    if (prevZone !== pose.zone) this.touch();
  }

  getLocalPose(): Pose | null {
    return this.local.pose;
  }

  // ------------------------------------------------ chat

  addChat(msg: ChatMessage): void {
    this.chat = [...this.chat, msg].slice(-200);
    this.touch();
  }

  // ------------------------------------------------ settings

  getSettings(): Settings {
    return this.settings;
  }

  setSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.displayName !== undefined) this.local.name = patch.displayName;
    if (patch.avatar !== undefined) this.local.avatar = patch.avatar;
    this.persist();
    this.touch();
  }

  setParticipantControls(id: string, patch: { volume?: number; mutedForMe?: boolean }): void {
    const p = this.participants.get(id);
    if (!p) return;
    this.participants.set(id, { ...p, ...patch });
    this.touch();
  }

  /** Full reset for leave/rejoin (§6.2 "any rejoin is a fresh join"). */
  reset(keepSettings = true): void {
    this.participants.clear();
    this.chat = [];
    this.local = { id: null, name: this.local.name, avatar: this.local.avatar, pose: null };
    this.status = 'lobby';
    this.lastError = null;
    if (!keepSettings) this.settings = defaultSettings({});
    this.touch();
  }

  private persist(): void {
    try {
      const { avatar: _a, ...rest } = this.settings;
      localStorage.setItem(LS_KEY, JSON.stringify({ displayName: this.settings.displayName, settings: rest }));
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }
}

/** App-wide singleton. */
export const store = new Store();
