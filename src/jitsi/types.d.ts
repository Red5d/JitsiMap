/**
 * Local type shim for the lib-jitsi-meet surface JitsiMap uses (SPEC §6.1 / D7).
 *
 * Pin: lib-jitsi-meet v2236.0.0+51058e35 (vendor/lib-jitsi-meet.tgz)
 *      sha256 da17ece512ff383556e7b91e5a3723dd250f952590f4c199224a0cb378946014
 *      vendored strophe.js 1.5.0 jitsi-3 (vendor/strophe.js-1.5.0.tgz,
 *      sha256 e513885e0a74cec88f8df6b8b295572c87a4875f9d5d74ea8c7dd18e75a52b46)
 * Verified against dist/esm source on 2026-10-29 — full record in docs/lib-surface.md.
 *
 * This is the ONLY place the lib's surface is typed. Only `src/jitsi/` may
 * import 'lib-jitsi-meet' (SPEC §4.2). The package ships no consumable types
 * (its generated types/index.d.ts is a typedoc bundle of ambient module
 * declarations); this shim covers exactly what SPEC §6.1 verified, with the
 * literal event-string values read from the pinned source.
 */

declare module 'lib-jitsi-meet' {
  // ------------------------------------------------------------------ enums
  // Typed as objects with literal string values matching the lib's string
  // enums verbatim (verified in service/RTC/*.js and top-level *Events.js),
  // so consumers can `switch` on them and compare against event payloads.

  /** Values read from JitsiConnectionEvents.js (pinned dist/esm). */
  export const JitsiConnectionEvents: {
    readonly CONNECTION_DISCONNECTED: 'connection.connectionDisconnected';
    readonly CONNECTION_ESTABLISHED: 'connection.connectionEstablished';
    readonly CONNECTION_FAILED: 'connection.connectionFailed';
    readonly CONNECTION_REDIRECTED: 'connection.redirected';
    readonly CONNECTION_TOKEN_EXPIRED: 'connection.token_expired';
    readonly DISPLAY_NAME_REQUIRED: 'connection.display_name_required';
    readonly PROPERTIES_UPDATED: 'connection.propertiesUpdated';
  };

  /**
   * Values read from JitsiConferenceEvents.js (pinned dist/esm). SPEC §6.3
   * subset plus the extras the adapter consumes (join-in-progress, connection
   * interrupted/restored, data-channel closed, dominant speaker, P2P status,
   * forwarded sources). NOTE: there is NO `CONNECTION_INTERRUPTED` on the
   * connection — interruption is a conference event (SPEC §6.2).
   */
  export const JitsiConferenceEvents: {
    readonly CONFERENCE_FAILED: 'conference.failed';
    readonly CONFERENCE_JOIN_IN_PROGRESS: 'conference.join_in_progress';
    readonly CONFERENCE_JOINED: 'conference.joined';
    readonly CONFERENCE_LEFT: 'conference.left';
    readonly CONNECTION_ESTABLISHED: 'conference.connectionEstablished';
    readonly CONNECTION_INTERRUPTED: 'conference.connectionInterrupted';
    readonly CONNECTION_RESTORED: 'conference.connectionRestored';
    readonly DATA_CHANNEL_CLOSED: 'conference.dataChannelClosed';
    readonly DATA_CHANNEL_OPENED: 'conference.dataChannelOpened';
    readonly DISPLAY_NAME_CHANGED: 'conference.displayNameChanged';
    readonly DOMINANT_SPEAKER_CHANGED: 'conference.dominantSpeaker';
    /** Listener args: (participant: JitsiParticipant, payload: unknown) — participant object, NOT id. */
    readonly ENDPOINT_MESSAGE_RECEIVED: 'conference.endpoint_message_received';
    /** Listener args: (participantId, txt, ts, displayName, isVisitor, messageId, source, replyToId). */
    readonly MESSAGE_RECEIVED: 'conference.messageReceived';
    readonly NON_PARTICIPANT_MESSAGE_RECEIVED: 'conference.non_participant_message_received';
    readonly P2P_STATUS: 'conference.p2pStatus';
    readonly PARTICIPANT_PROPERTY_CHANGED: 'conference.participant_property_changed';
    readonly TRACK_ADDED: 'conference.trackAdded';
    readonly TRACK_AUDIO_LEVEL_CHANGED: 'conference.audioLevelsChanged';
    readonly TRACK_MUTE_CHANGED: 'conference.trackMuteChanged';
    readonly TRACK_REMOVED: 'conference.trackRemoved';
    readonly USER_JOINED: 'conference.userJoined';
    readonly USER_LEFT: 'conference.userLeft';
    readonly USER_ROLE_CHANGED: 'conference.roleChanged';
    readonly LAST_N_ENDPOINTS_CHANGED: 'conference.lastNEndpointsChanged';
    readonly FORWARDED_SOURCES_CHANGED: 'conference.forwardedSourcesChanged';
  };

  /** Values read from JitsiTrackEvents.js (pinned dist/esm). */
  export const JitsiTrackEvents: {
    /** Desktop "stop sharing" / track ended (local tracks). */
    readonly LOCAL_TRACK_STOPPED: 'track.stopped';
    readonly NO_AUDIO_INPUT: 'track.no_audio_input';
    readonly NO_DATA_FROM_SOURCE: 'track.no_data_from_source';
    readonly TRACK_AUDIO_LEVEL_CHANGED: 'track.audioLevelsChanged';
    readonly TRACK_AUDIO_OUTPUT_CHANGED: 'track.audioOutputChanged';
    readonly TRACK_MUTE_CHANGED: 'track.trackMuteChanged';
    readonly TRACK_VIDEOTYPE_CHANGED: 'track.videoTypeChanged';
  };

  /** Values read from JitsiMediaDevicesEvents.js (pinned dist/esm). */
  export const JitsiMediaDevicesEvents: {
    readonly DEVICE_LIST_CHANGED: 'mediaDevices.devicechange';
    readonly PERMISSIONS_CHANGED: 'rtc.permissions_changed';
    readonly PERMISSION_PROMPT_IS_SHOWN: 'mediaDevices.permissionPromptIsShown';
  };

  /** Values read from JitsiConferenceErrors.js (pinned dist/esm). */
  export const JitsiConferenceErrors: {
    readonly AUTHENTICATION_REQUIRED: 'conference.authenticationRequired';
    readonly CHAT_ERROR: 'conference.chatError';
    readonly CONFERENCE_ACCESS_DENIED: 'conference.connectionError.accessDenied';
    readonly CONFERENCE_DESTROYED: 'conference.destroyed';
    readonly CONFERENCE_MAX_USERS: 'conference.max_users';
    readonly CONFERENCE_TIME_LIMIT: 'conference.time_limit';
    readonly CONNECTION_ERROR: 'conference.connectionError';
    readonly DISPLAY_NAME_REQUIRED: 'conference.display_name_required';
    readonly FOCUS_DISCONNECTED: 'conference.focusDisconnected';
    readonly FOCUS_LEFT: 'conference.focusLeft';
    readonly GRACEFUL_SHUTDOWN: 'conference.gracefulShutdown';
    readonly ICE_FAILED: 'conference.iceFailed';
    readonly INCOMPATIBLE_SERVER_VERSIONS: 'conference.incompatible_server_versions';
    readonly MEMBERS_ONLY_ERROR: 'conference.connectionError.membersOnly';
    readonly NOT_ALLOWED_ERROR: 'conference.connectionError.notAllowed';
    readonly OFFER_ANSWER_FAILED: 'conference.offerAnswerFailed';
    readonly PASSWORD_NOT_SUPPORTED: 'conference.passwordNotSupported';
    readonly PASSWORD_REQUIRED: 'conference.passwordRequired';
    readonly RESERVATION_ERROR: 'conference.reservationError';
    readonly SETTINGS_ERROR: 'conference.settingsError';
    readonly VIDEOBRIDGE_NOT_AVAILABLE: 'conference.videobridgeNotAvailable';
  };

  /** Values read from JitsiConnectionErrors.js (pinned dist/esm). */
  export const JitsiConnectionErrors: {
    readonly CONFERENCE_REQUEST_FAILED: 'connection.conferenceRequestFailed';
    readonly CONNECTION_DROPPED_ERROR: 'connection.droppedError';
    readonly NOT_LIVE_ERROR: 'connection.notLiveError';
    readonly OTHER_ERROR: 'connection.otherError';
    readonly PASSWORD_REQUIRED: 'connection.passwordRequired';
    readonly SERVER_ERROR: 'connection.serverError';
    readonly SHARD_CHANGED_ERROR: 'connection.shardChangedError';
    readonly TIME_LIMIT_ERROR: 'connection.timeLimitError';
  };

  /** Values read from JitsiTrackErrors.js (pinned dist/esm). */
  export const JitsiTrackErrors: {
    readonly CONSTRAINT_FAILED: 'gum.constraint_failed';
    readonly GENERAL: 'gum.general';
    readonly NOT_FOUND: 'gum.not_found';
    readonly PERMISSION_DENIED: 'gum.permission_denied';
    readonly SCREENSHARING_GENERIC_ERROR: 'gum.screensharing_generic_error';
    readonly SCREENSHARING_NOT_SUPPORTED_ERROR: 'gdm.screen_sharing_not_supported';
    readonly SCREENSHARING_USER_CANCELED: 'gum.screensharing_user_canceled';
    readonly TIMEOUT: 'gum.timeout';
    readonly TRACK_IS_DISPOSED: 'track.track_is_disposed';
    readonly TRACK_NO_STREAM_FOUND: 'track.no_stream_found';
    readonly TRACK_NO_STREAM_TRACKS_FOUND: 'track.no_stream_tracks_found';
    readonly TRACK_TOO_MANY_TRACKS_IN_STREAM: 'track.too_many_tracks_in_stream';
    readonly UNSUPPORTED_RESOLUTION: 'gum.unsupported_resolution';
  };

  /** MediaType (service/RTC/MediaType.js). */
  export const MediaType: {
    readonly AUDIO: 'audio';
    readonly VIDEO: 'video';
  };

  /** VideoType (service/RTC/VideoType.js). Desktop tracks: getVideoType() === 'desktop'. */
  export const VideoType: {
    readonly CAMERA: 'camera';
    readonly DESKTOP: 'desktop';
    readonly DESKTOP_HIGH_FPS: 'desktop_high_fps';
  };

  // ------------------------------------------------------------------ options

  /** JitsiMeetJS.init(options) — options consumed by JitsiMeetJS.init/Statistics.init/RTC.init. */
  export interface IInitOptions {
    /** Analytics namespace (Statistics passes through; lib disposes analytics unless enableAnalyticsLogging). */
    analytics?: Record<string, unknown>;
    /** Disables audio-level collection (Statistics.audioLevelsEnabled). */
    disableAudioLevels?: boolean;
    /** Disables third-party requests (analytics/logging endpoints). */
    disableThirdPartyRequests?: boolean;
    /** localStorage-like store for persistent lib settings. */
    externalStorage?: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
    };
    /** Analytics + rtcstats are disposed unless this is exactly true. */
    enableAnalyticsLogging?: boolean;
    /** Store logs to rtcstats (init reads these two keys off options). */
    rtcstatsStoreLogs?: boolean;
    rtcstatsLogFlushSizeBytes?: number;
    pcStatsInterval?: number;
    audioLevelsInterval?: number;
    [key: string]: unknown;
  }

  /**
   * JitsiConnection constructor options (modules/xmpp/xmpp.js).
   * DIVERGENCE: `bosh` is REMOVED — the constructor throws
   * 'The "bosh" option is no longer supported, please use "serviceUrl" instead'.
   * Use `serviceUrl` (the xmpp-websocket URL, e.g. wss://host/xmpp-websocket).
   */
  export interface IConnectionOptions {
    hosts: {
      /** XMPP main domain (also ping target). */
      domain: string;
      /** MUC component domain, e.g. conference.example.org. Required at runtime. */
      muc?: string;
      /** Jicofo focus component (conference-iq). */
      focus?: string;
      /** Domain used for anonymous login. */
      anonymousdomain?: string;
      [key: string]: string | undefined;
    };
    /** XMPP-over-websocket URL. REQUIRED in this version (bosh removed). */
    serviceUrl: string;
    /** XEP-0198 stream management (websocket resume). */
    enableWebsocketResume?: boolean;
    websocketKeepAlive?: number;
    websocketKeepAliveUrl?: string;
    xmppPing?: { domain?: string; [key: string]: unknown };
    p2pStunServers?: unknown[];
    bridgeChannel?: { ignoreDomain?: string; preferSctp?: boolean };
    disableFocus?: boolean;
    deploymentInfo?: { userRegion?: string; shard?: string };
    flags?: Record<string, unknown>;
    audioTranslation?: { enabled?: boolean };
    [key: string]: unknown;
  }

  /** JitsiConnection.connect(options). */
  export interface IConnectOptions {
    id?: string;
    password?: string;
    /** Room name — enables the HTTP conference-request flow (JaaS/room-opening). */
    name?: string;
  }

  /**
   * initJitsiConference(roomName, confOptions) — the object is the lib's
   * `options.config` (JitsiConference `_init`/IConferenceOptions.config).
   */
  export interface IConferenceOptions {
    p2p?: {
      /** SPEC: keep false — spatial model assumes bridge relay (endpoint msgs via JVB). */
      enabled?: boolean;
      backToP2PDelay?: number;
      codecPreferenceOrder?: string[];
      disabledCodec?: string;
      preferredCodec?: string;
      screenshareCodec?: string;
    };
    videoQuality?: {
      codecPreferenceOrder?: string[];
      disabledCodec?: string;
      enableAdaptiveMode?: boolean;
      preferredCodec?: string;
      screenshareCodec?: string;
    };
    /** Requested video count ceiling (-1 = unlimited; QualityController ramps to this). */
    channelLastN?: number;
    /** Initial lastN applied on media session start. */
    startLastN?: number;
    /** Start-muted thresholds (participant counts). */
    startAudioMuted?: number;
    startVideoMuted?: number;
    /** Join without audio (silent). */
    startSilent?: boolean;
    /** Disable the no-audio-input / noisy-mic detection events. */
    enableNoAudioDetection?: boolean;
    enableNoisyMicDetection?: boolean;
    enableTalkWhileMuted?: boolean;
    disableAudioLevels?: boolean;
    disableLocalStats?: boolean;
    pcStatsInterval?: number;
    e2eping?: { enabled?: boolean };
    enableIceRestart?: boolean;
    deploymentInfo?: { userRegion?: string };
    statisticsDisplayName?: string;
    statisticsId?: string;
    applicationName?: string;
    testing?: {
      allowMultipleTracks?: boolean;
      enableFirefoxP2p?: boolean;
      lastNRampupTime?: number;
      p2pTestMode?: boolean;
      enableGracefulReconnect?: boolean;
    };
    [key: string]: unknown;
  }

  /**
   * JitsiMeetJS.createLocalTracks(options) (RTC/RTCUtils.obtainAudioAndVideoPermissions).
   * DIVERGENCE: device ids are `micDeviceId` / `cameraDeviceId` (NOT
   * audioDeviceId/videoDeviceId); `fireMouseEvent` does not exist in this
   * version (Chrome-extension desktop sharing removed; desktop uses
   * getDisplayMedia).
   */
  export interface ILocalTrackOptions {
    devices?: Array<'audio' | 'video' | 'desktop'>;
    micDeviceId?: string;
    cameraDeviceId?: string;
    /** Resolution shortcut, e.g. '720p' (Resolutions table). */
    resolution?: string;
    /** Raw GUM constraints (base object for audio/video). */
    constraints?: MediaStreamConstraints;
    /** Effects array (noise suppression etc.). */
    effects?: unknown[];
    /** Screen-share fps bounds (passed to getDisplayMedia). */
    desktopSharingFrameRate?: { min?: number; max?: number };
    /** Source types offered in the picker: 'screen' | 'window' | ... */
    desktopSharingSources?: string[];
    /** Device id/label to use as the share source (virtual-device flows). */
    desktopSharingSourceDevice?: string;
    /** GUM timeout (ms). */
    timeout?: number;
    [key: string]: unknown;
  }

  /** Per-source frame-height constraint. */
  export interface IReceiverVideoConstraint {
    maxHeight: number;
  }

  /**
   * conference.setReceiverConstraints(obj) — passed through to the bridge
   * (RTC.setReceiverVideoConstraints → BridgeChannel.sendReceiverVideoConstraintsMessage).
   * `selectedSources` / `onStageSources` are documented in
   * JitsiConference.setReceiverConstraints' JSDoc; `startLastN` is read by
   * ReceiveVideoController. The lib's generated TS interface lists only
   * lastN/constraints/defaultConstraints/assumedBandwidthBps — the full
   * runtime set is wider (pass-through), documented in docs/lib-surface.md.
   */
  export interface IReceiverVideoConstraints {
    lastN?: number;
    constraints?: Record<string, IReceiverVideoConstraint>;
    defaultConstraints?: IReceiverVideoConstraint;
    startLastN?: number;
    startSources?: string[];
    selectedSources?: string[];
    onStageSources?: string[];
    assumedBandwidthBps?: number;
  }

  /** Current audio-subscription message shape (service/RTC/ReceiverAudioSubscription.js). */
  export interface IReceiverAudioSubscriptionMessage {
    /** Baseline: subscribe to all regular remote audio sources. Default true. */
    all?: boolean;
    /** Source names to drop from the baseline. */
    exclude?: string[];
    /** Source names forwarded on top of the baseline. */
    include?: string[];
  }

  /** Legacy { mode, list } shape — accepted and normalised by the lib. */
  export interface ILegacyReceiverAudioSubscriptionMessage {
    mode: 'All' | 'Exclude' | 'Include' | 'None';
    list?: string[];
  }

  // ------------------------------------------------------------------ classes

  /**
   * JitsiTrack (modules/RTC/JitsiTrack.js). NOTE: no `getName()`; use
   * getTrackLabel()/getUsageLabel(). getParticipantId() exists on both local
   * and remote tracks.
   */
  export interface JitsiTrack {
    attach(container: HTMLAudioElement | HTMLVideoElement): Promise<void>;
    detach(container?: HTMLAudioElement | HTMLVideoElement): void;
    dispose(): Promise<void>;
    addEventListener(event: string, listener: (...args: any[]) => void): void;
    removeEventListener(event: string, listener?: (...args: any[]) => void): void;
    getId(): number;
    /** Endpoint id of the track owner (local: own id; remote: owner). */
    getParticipantId(): string | undefined;
    /** Source name ('<endpoint>-a0' / '<endpoint>-v0'), the constraints/subscription key. */
    getSourceName(): string;
    getOriginalStream(): MediaStream | null;
    getStreamId(): string | null;
    getTrack(): MediaStreamTrack | null;
    getTrackId(): string;
    getTrackLabel(): string;
    getUsageLabel(): string;
    getSsrc(): number | undefined;
    getType(): 'audio' | 'video';
    /** 'camera' | 'desktop' | 'desktop_high_fps' (video tracks; audio → undefined). */
    getVideoType(): 'camera' | 'desktop' | 'desktop_high_fps' | undefined;
    getHeight(): number;
    getWidth(): number;
    isActive(): boolean;
    isAudioTrack(): boolean;
    isVideoTrack(): boolean;
    isLocal(): boolean;
    isMuted(): boolean;
    isWebRTCTrackMuted(): boolean;
    /** setSinkId on attached elements; emits TRACK_AUDIO_OUTPUT_CHANGED. */
    setAudioOutput(audioOutputDeviceId: string): Promise<void>;
  }

  /** JitsiLocalTrack (modules/RTC/JitsiLocalTrack.js). */
  export interface JitsiLocalTrack extends JitsiTrack {
    /** Resolves when the mute has been signalled. Never destroy/recreate for mute (SPEC §6.4). */
    mute(): Promise<void>;
    unmute(): Promise<void>;
    getDeviceId(): string;
    getCameraFacingMode(): string | undefined;
    getCaptureResolution(): { width: number; height: number } | undefined;
    getDuration(): number;
    isEnded(): boolean;
    isReceivingData(): boolean;
    applyConstraints(constraints: Record<string, unknown>): Promise<void>;
  }

  /** JitsiParticipant (JitsiParticipant.js). */
  export interface JitsiParticipant {
    getId(): string;
    getDisplayName(): string | undefined;
    getJid(): string;
    getConnectionJid(): string | undefined;
    getRole(): string | undefined;
    getStatus(): string;
    getProperty(name: string): string | string[] | undefined;
    getSources(): Record<string, Array<{ muted: boolean; sourceName: string; videoType?: string }>>;
    getTracks(): JitsiTrack[];
    getTracksByMediaType(mediaType: 'audio' | 'video'): JitsiTrack[];
    isAudioMuted(): boolean;
    isVideoMuted(): boolean;
    isModerator(): boolean;
    isHidden(): boolean;
    isSilent(): boolean;
    hasFeature(feature: string): boolean;
    getFeatures(): string[];
  }

  /** JitsiConference (JitsiConference.js) — SPEC §6/§7/§8/§9 surface. */
  export interface JitsiConference {
    // lifecycle
    join(password?: string, replaceParticipant?: boolean): void;
    leave(reason?: string): Promise<void>;
    isJoined(): boolean;
    getName(): string;
    getConnection(): JitsiConnection;
    getRole(): string;
    isModerator(): boolean;
    isP2PActive(): boolean;
    isP2PEnabled(): boolean;
    myUserId(): string | null;

    // events (Listenable) — typed overloads for the SPEC §6.3 set, plus a loose
    // fallback for everything else.
    addEventListener(event: 'conference.joined', listener: () => void): void;
    addEventListener(event: 'conference.join_in_progress', listener: () => void): void;
    addEventListener(event: 'conference.left', listener: () => void): void;
    addEventListener(
      event: 'conference.failed',
      listener: (error: string, ...params: any[]) => void,
    ): void;
    addEventListener(event: 'conference.connectionEstablished', listener: () => void): void;
    addEventListener(event: 'conference.connectionInterrupted', listener: () => void): void;
    addEventListener(event: 'conference.connectionRestored', listener: () => void): void;
    addEventListener(event: 'conference.dataChannelOpened', listener: () => void): void;
    addEventListener(event: 'conference.dataChannelClosed', listener: () => void): void;
    addEventListener(
      event: 'conference.userJoined',
      listener: (id: string, participant: JitsiParticipant) => void,
    ): void;
    addEventListener(
      event: 'conference.userLeft',
      listener: (id: string, participant?: JitsiParticipant, reason?: string) => void,
    ): void;
    addEventListener(event: 'conference.roleChanged', listener: (id: string, role: string) => void): void;
    addEventListener(
      event: 'conference.displayNameChanged',
      listener: (id: string, displayName: string) => void,
    ): void;
    addEventListener(event: 'conference.trackAdded', listener: (track: JitsiTrack) => void): void;
    addEventListener(event: 'conference.trackRemoved', listener: (track: JitsiTrack) => void): void;
    addEventListener(event: 'conference.trackMuteChanged', listener: (track: JitsiTrack) => void): void;
    addEventListener(
      event: 'conference.audioLevelsChanged',
      listener: (participantId: string, audioLevel: number) => void,
    ): void;
    addEventListener(event: 'conference.dominantSpeaker', listener: (id: string, previous: string | null) => void): void;
    /** Verified shape: POSITIONAL args (participantId, txt, ts, displayName, isVisitor, messageId, source, replyToId) — NOT a single object. */
    addEventListener(
      event: 'conference.messageReceived',
      listener: (
        participantId: string,
        txt: string,
        ts: number,
        displayName?: string,
        isVisitor?: boolean,
        messageId?: string,
        source?: string,
        replyToId?: string,
      ) => void,
    ): void;
    /** Verified shape: (participant, payload) — participant object, NOT endpoint id (SPEC §7.1 assumed id). */
    addEventListener(
      event: 'conference.endpoint_message_received',
      listener: (participant: JitsiParticipant, payload: unknown) => void,
    ): void;
    addEventListener(
      event: 'conference.non_participant_message_received',
      listener: (id: string, payload: unknown) => void,
    ): void;
    addEventListener(event: 'conference.p2pStatus', listener: (isP2PActive: boolean) => void): void;
    addEventListener(
      event: 'conference.participant_property_changed',
      listener: (participant: JitsiParticipant, name: string, value: string | string[]) => void,
    ): void;
    addEventListener(
      event: 'conference.lastNEndpointsChanged',
      listener: (
        enteringEndpoints: string[],
        leavingEndpoints: string[],
        currentEndpoints: string[],
      ) => void,
    ): void;
    addEventListener(
      event: 'conference.forwardedSourcesChanged',
      listener: (
        forwardedSources: string[],
        creatingSources: string[],
        expiredSources: string[],
      ) => void,
    ): void;
    addEventListener(event: string, listener: (...args: any[]) => void): void;
    removeEventListener(event: string, listener?: (...args: any[]) => void): void;

    // tracks
    addTrack(track: JitsiLocalTrack): void;
    removeTrack(track: JitsiLocalTrack): void;
    replaceTrack(oldTrack: JitsiLocalTrack | null, newTrack: JitsiLocalTrack | null): Promise<void>;
    getLocalTracks(mediaType?: 'audio' | 'video'): JitsiLocalTrack[];
    getLocalAudioTrack(): JitsiLocalTrack | null;
    getLocalVideoTrack(): JitsiLocalTrack | null;
    getLocalVideoTracks(): JitsiLocalTrack[];

    // participants
    getParticipants(): JitsiParticipant[];
    getParticipantCount(countHidden?: boolean): number;
    getParticipantById(id: string): JitsiParticipant | undefined;
    setDisplayName(name: string): void;
    setLocalParticipantProperty(name: string, value: string, useRawKeys?: boolean): void;
    setLocalParticipantProperties(properties: Record<string, string | string[]>, useRawKeys?: boolean): void;

    // messaging (SPEC §7.1/§7.6). sendEndpointMessage/broadcastEndpointMessage/
    // sendTextMessage are marked @deprecated in favour of sendMessage; they
    // remain public and functional in the pinned version.
    sendEndpointMessage(to: string, payload: unknown): void;
    broadcastEndpointMessage(payload: unknown): void;
    sendMessage(
      message: string | Record<string, unknown>,
      to?: string,
      sendThroughVideobridge?: boolean,
      replyToId?: string,
    ): void;
    /** DIVERGENCE: 2nd arg is elementName (XMPP stanza element, default 'body'), NOT a video-channel flag. */
    sendTextMessage(message: string, elementName?: string, replyToId?: string, messageId?: string): void;

    // video / audio subscriptions (SPEC §8.4/§9.2)
    setReceiverConstraints(videoConstraints: IReceiverVideoConstraints): void;
    /** @deprecated per SPEC §9.2 — do not use; setReceiverConstraints replaces it. */
    setReceiverVideoConstraint(maxFrameHeight: number): void;
    setSenderVideoConstraint(maxFrameHeight: number): Promise<void>;
    setLastN(lastN: number): void;
    getLastN(): number;
    getForwardedSources(): string[];
    /** Exists in the pinned version (SPEC §8.4 assumption holds). */
    setAudioSubscriptionMode(message: IReceiverAudioSubscriptionMessage | ILegacyReceiverAudioSubscriptionMessage): void;
  }

  /** JitsiConnection (JitsiConnection.js). Constructor is the exported const. */
  export interface JitsiConnection {
    readonly options: IConnectionOptions;
    connect(options?: IConnectOptions): void;
    disconnect(): Promise<void>;
    initJitsiConference(name: string, options: IConferenceOptions): JitsiConference;
    getJid(): string;
    refreshToken(token: string): Promise<void>;
    addFeature(feature: string, submit?: boolean): void;
    removeFeature(feature: string, submit?: boolean): void;
    addEventListener(event: 'connection.connectionEstablished', listener: (id: string) => void): void;
    addEventListener(event: 'connection.connectionDisconnected', listener: (message?: string) => void): void;
    addEventListener(
      event: 'connection.connectionFailed',
      listener: (
        error: string,
        message?: string,
        credentials?: Record<string, unknown>,
        details?: Record<string, unknown>,
      ) => void,
    ): void;
    addEventListener(event: string, listener: (...args: any[]) => void): void;
    removeEventListener(event: string, listener?: (...args: any[]) => void): void;
  }

  /** Constructor type for the exported JitsiConnection class. */
  export const JitsiConnection: new (
    appID: string | null,
    token: string | null,
    options: IConnectionOptions,
  ) => JitsiConnection;

  /** JitsiMeetJS.mediaDevices namespace (JitsiMediaDevices.js). */
  export interface JitsiMediaDevices {
    enumerateDevices(callback: (devices: MediaDeviceInfo[]) => void): void;
    isDeviceChangeAvailable(deviceType: 'input' | 'output'): boolean;
    isDevicePermissionGranted(type: 'audio' | 'video'): Promise<boolean>;
    isMultipleAudioInputSupported(): boolean;
    getAudioOutputDevice(): string;
    /** setSinkId-based output selection (SPEC §8.6). */
    setAudioOutputDevice(deviceId: string): Promise<void>;
    addEventListener(event: string, listener: (...args: any[]) => void): void;
    removeEventListener(event: string, listener?: (...args: any[]) => void): void;
  }

  /** The default-exported JitsiMeetJS namespace (JitsiMeetJS.js). */
  export interface JitsiMeetJSStatic {
    /** The connection class, also exposed as a namespace member. */
    JitsiConnection: new (
      appID: string | null,
      token: string | null,
      options: IConnectionOptions,
    ) => JitsiConnection;
    init(options?: IInitOptions): void;
    createLocalTracks(options?: ILocalTrackOptions): Promise<JitsiLocalTrack[]>;
    isDesktopSharingEnabled(): boolean;
    isWebRtcSupported(): boolean;
    isMultipleAudioInputSupported(): boolean;
    isCollectingLocalStats(): boolean;
    /** Log levels object: 'trace' | 'debug' | 'info' | 'log' | 'warn' | 'error'. */
    logLevels: Record<string, string>;
    setLogLevel(level: string): void;
    setLogLevelById(level: string, id: string): void;
    setGlobalLogOptions(options: Record<string, unknown>): void;
    setNetworkInfo(state: { isOnline: boolean }): void;
    mediaDevices: JitsiMediaDevices;
    events: {
      conference: typeof JitsiConferenceEvents;
      connection: typeof JitsiConnectionEvents;
      track: typeof JitsiTrackEvents;
      mediaDevices: typeof JitsiMediaDevicesEvents;
    };
    errors: {
      conference: typeof JitsiConferenceErrors;
      connection: typeof JitsiConnectionErrors;
      track: typeof JitsiTrackErrors;
    };
    constants: Record<string, unknown>;
    util: {
      browser: { getName(): string; getVersion(): string };
      [key: string]: unknown;
    };
    /** Short commit hash of the pinned build (version.js COMMIT_HASH). */
    version: string;
  }

  const JitsiMeetJS: JitsiMeetJSStatic;
  export default JitsiMeetJS;
}
