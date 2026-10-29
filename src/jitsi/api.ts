/**
 * Public API of the Jitsi adapter — the ONLY module that touches
 * lib-jitsi-meet (SPEC §4.2). UI, game, and spatial code depend on this
 * interface, never on the lib. Implemented in src/jitsi/ (client.ts et al.).
 *
 * Data flow contract:
 *  - The adapter WRITES to the store: participants (names/avatars/mute/tracks/
 *    source names), remote poses (§7.4 exchange), chat, status, local id.
 *  - The UI calls the methods below.
 *  - The spatial engine computes the audible set / video selection from the
 *    store and pushes them via applyAudioSubscriptions / applyReceiverConstraints.
 */

import type { AvatarInfo, MapData, Pose } from '../types';

export interface JoinOptions {
  /** Normalised MUC room name (config.normalizeSpaceName). */
  space: string;
  displayName: string;
  avatar: AvatarInfo;
  /** Loaded map — protocol validation context (§7.3). */
  map: MapData;
  mic: boolean;
  cam: boolean;
  audioDeviceId: string | null;
  videoDeviceId: string | null;
}

/** Neutral description of the video plan; constraints.ts maps it to lib shape (§9.2). */
export interface VideoPlan {
  /** Video source names to receive at all (≤ MAX_VIDEO_SOURCES). */
  selectedSources: string[];
  /** 1–4 nearest source names (or the screenshare source while its stage panel is open). */
  onStageSources: string[];
  /** Source names that get { maxHeight: 360 }; everyone else defaultConstraints. */
  hiResSources: string[];
  /** True when a remote desktop share should render on stage (adds its source at 720p). */
  stageDesktopSource: string | null;
}

export interface JitsiClient {
  /** Full lifecycle per §6.2; resolves on CONFERENCE_JOINED. Throws ConfigError-grade messages for §5.1 UI. */
  join(opts: JoinOptions): Promise<void>;
  /** Graceful leave: stop tracks, conference.leave, disconnect. Idempotent. */
  leave(): Promise<void>;

  setMicMuted(muted: boolean): void;
  setCamMuted(muted: boolean): void;
  /** Desktop share via replaceTrack of the camera (§6.4); native stop → share off. */
  startDesktopShare(): Promise<void>;
  stopDesktopShare(): void;
  /** Speaker output selection (§8.6). */
  setAudioOutput(deviceId: string): void;

  sendChat(text: string): void;
  /** §7.3: adapter owns throttling (8 Hz, >2 px rule) + heartbeat + zone/moving semantics. */
  sendPose(pose: Pose): void;
  sendEmote(emoji: string): void;
  setAvatar(avatar: AvatarInfo): void;

  /** Attach the local camera preview (mic MUST NOT be attached audibly, §6.4). */
  attachLocalVideo(el: HTMLVideoElement): void;
  detachLocalVideo(el: HTMLVideoElement): void;
  isSharingDesktop(): boolean;

  /** Empty list = unsubscribe all (§8.4; deafen = []). Debounced by CALLER. */
  applyAudioSubscriptions(audioSourceNames: string[]): void;
  applyReceiverConstraints(plan: VideoPlan): void;

  /** Diagnostics for settings (§5.4): conference id, participant id, lib version. */
  describe(): { conference: string; participantId: string; libVersion: string } | null;

  dispose(): void;
}

export { createJitsiClient } from './client';
export { getTrackStream, getTrackVideoType } from './tracks';
