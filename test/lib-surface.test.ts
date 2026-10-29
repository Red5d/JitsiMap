/**
 * M0 gate test (SPEC §6.1): the src/jitsi/types.d.ts shim must match the
 * literal event strings read from the pinned lib source, and the shimmed
 * JitsiMeetJSStatic / interface shapes must expose the SPEC surface.
 *
 * The real lib is a browser UMD library (window-scoped) and CANNOT be
 * imported in node — so this test is:
 *  - value-level: local mirrors of the event-constant objects, `satisfies`
 *    the shim types (so any literal drift is a compile error) and asserted
 *    against the expected strings at runtime;
 *  - type-level: function references assigned to typed variables (a method
 *    missing/retyped in the shim fails `tsc --noEmit`).
 */

import type {
  IConferenceOptions,
  IConnectOptions,
  IInitOptions,
  ILegacyReceiverAudioSubscriptionMessage,
  ILocalTrackOptions,
  IReceiverAudioSubscriptionMessage,
  IReceiverVideoConstraints,
  JitsiConference,
  JitsiConferenceErrors as JitsiConferenceErrorsType,
  JitsiConferenceEvents as JitsiConferenceEventsType,
  JitsiConnection,
  JitsiConnectionErrors as JitsiConnectionErrorsType,
  JitsiConnectionEvents as JitsiConnectionEventsType,
  JitsiLocalTrack,
  JitsiMediaDevicesEvents as JitsiMediaDevicesEventsType,
  JitsiMeetJSStatic,
  JitsiParticipant,
  JitsiTrack,
  JitsiTrackErrors as JitsiTrackErrorsType,
  JitsiTrackEvents as JitsiTrackEventsType,
} from 'lib-jitsi-meet';
import { describe, expect, it } from 'vitest';

// A callable Proxy standing in for the browser-only lib namespace in node:
// every property access / call / construction returns another stub, so the
// typed references below are real functions at runtime while the shim types
// do all the verification at compile time.
const stub = (): any =>
  new Proxy(function noop() {} as unknown as object, {
    get: (_target, prop) => (prop === 'toString' ? () => 'lib-stub' : stub()),
    apply: () => stub(),
    construct: () => stub(),
  });

const lib: JitsiMeetJSStatic = stub();

// ---------------------------------------------------------------- constants

const connectionEvents = {
  CONNECTION_DISCONNECTED: 'connection.connectionDisconnected',
  CONNECTION_ESTABLISHED: 'connection.connectionEstablished',
  CONNECTION_FAILED: 'connection.connectionFailed',
  CONNECTION_REDIRECTED: 'connection.redirected',
  CONNECTION_TOKEN_EXPIRED: 'connection.token_expired',
  DISPLAY_NAME_REQUIRED: 'connection.display_name_required',
  PROPERTIES_UPDATED: 'connection.propertiesUpdated',
} as const satisfies typeof JitsiConnectionEventsType;

const conferenceEvents = {
  CONFERENCE_FAILED: 'conference.failed',
  CONFERENCE_JOIN_IN_PROGRESS: 'conference.join_in_progress',
  CONFERENCE_JOINED: 'conference.joined',
  CONFERENCE_LEFT: 'conference.left',
  CONNECTION_ESTABLISHED: 'conference.connectionEstablished',
  CONNECTION_INTERRUPTED: 'conference.connectionInterrupted',
  CONNECTION_RESTORED: 'conference.connectionRestored',
  DATA_CHANNEL_CLOSED: 'conference.dataChannelClosed',
  DATA_CHANNEL_OPENED: 'conference.dataChannelOpened',
  DISPLAY_NAME_CHANGED: 'conference.displayNameChanged',
  DOMINANT_SPEAKER_CHANGED: 'conference.dominantSpeaker',
  ENDPOINT_MESSAGE_RECEIVED: 'conference.endpoint_message_received',
  MESSAGE_RECEIVED: 'conference.messageReceived',
  NON_PARTICIPANT_MESSAGE_RECEIVED: 'conference.non_participant_message_received',
  P2P_STATUS: 'conference.p2pStatus',
  PARTICIPANT_PROPERTY_CHANGED: 'conference.participant_property_changed',
  TRACK_ADDED: 'conference.trackAdded',
  TRACK_AUDIO_LEVEL_CHANGED: 'conference.audioLevelsChanged',
  TRACK_MUTE_CHANGED: 'conference.trackMuteChanged',
  TRACK_REMOVED: 'conference.trackRemoved',
  USER_JOINED: 'conference.userJoined',
  USER_LEFT: 'conference.userLeft',
  USER_ROLE_CHANGED: 'conference.roleChanged',
  LAST_N_ENDPOINTS_CHANGED: 'conference.lastNEndpointsChanged',
  FORWARDED_SOURCES_CHANGED: 'conference.forwardedSourcesChanged',
} as const satisfies typeof JitsiConferenceEventsType;

const trackEvents = {
  LOCAL_TRACK_STOPPED: 'track.stopped',
  NO_AUDIO_INPUT: 'track.no_audio_input',
  NO_DATA_FROM_SOURCE: 'track.no_data_from_source',
  TRACK_AUDIO_LEVEL_CHANGED: 'track.audioLevelsChanged',
  TRACK_AUDIO_OUTPUT_CHANGED: 'track.audioOutputChanged',
  TRACK_MUTE_CHANGED: 'track.trackMuteChanged',
  TRACK_VIDEOTYPE_CHANGED: 'track.videoTypeChanged',
} as const satisfies typeof JitsiTrackEventsType;

describe('lib-jitsi-meet shim — event constant literals (SPEC §6.1)', () => {
  it('connection events match the pinned source', () => {
    expect(connectionEvents.CONNECTION_ESTABLISHED).toBe('connection.connectionEstablished');
    expect(connectionEvents.CONNECTION_DISCONNECTED).toBe('connection.connectionDisconnected');
    expect(connectionEvents.CONNECTION_FAILED).toBe('connection.connectionFailed');
  });

  it('conference events match the pinned source (SPEC §6.3 set)', () => {
    expect(conferenceEvents.CONFERENCE_JOINED).toBe('conference.joined');
    expect(conferenceEvents.CONFERENCE_LEFT).toBe('conference.left');
    expect(conferenceEvents.CONFERENCE_FAILED).toBe('conference.failed');
    expect(conferenceEvents.USER_JOINED).toBe('conference.userJoined');
    expect(conferenceEvents.USER_LEFT).toBe('conference.userLeft');
    expect(conferenceEvents.TRACK_ADDED).toBe('conference.trackAdded');
    expect(conferenceEvents.TRACK_REMOVED).toBe('conference.trackRemoved');
    expect(conferenceEvents.TRACK_MUTE_CHANGED).toBe('conference.trackMuteChanged');
    expect(conferenceEvents.TRACK_AUDIO_LEVEL_CHANGED).toBe('conference.audioLevelsChanged');
    expect(conferenceEvents.DISPLAY_NAME_CHANGED).toBe('conference.displayNameChanged');
    expect(conferenceEvents.MESSAGE_RECEIVED).toBe('conference.messageReceived');
    expect(conferenceEvents.ENDPOINT_MESSAGE_RECEIVED).toBe('conference.endpoint_message_received');
    expect(conferenceEvents.DATA_CHANNEL_OPENED).toBe('conference.dataChannelOpened');
    // Interruption lives on the CONFERENCE events, not the connection events.
    expect(conferenceEvents.CONNECTION_INTERRUPTED).toBe('conference.connectionInterrupted');
  });

  it('track events match the pinned source', () => {
    expect(trackEvents.TRACK_MUTE_CHANGED).toBe('track.trackMuteChanged');
    expect(trackEvents.TRACK_AUDIO_LEVEL_CHANGED).toBe('track.audioLevelsChanged');
    // Spec spells it TRACK_VIDEOTYPE_CHANGED; the lib value is ...videoTypeChanged.
    expect(trackEvents.TRACK_VIDEOTYPE_CHANGED).toBe('track.videoTypeChanged');
    expect(trackEvents.LOCAL_TRACK_STOPPED).toBe('track.stopped');
  });
});

// --------------------------------------------------------- compile-time API

describe('lib-jitsi-meet shim — JitsiMeetJSStatic surface (type-level)', () => {
  it('exposes the SPEC §6.1/§6.2 methods (compile-time checked)', () => {
    // Every assignment below fails `tsc --noEmit` if the shim is missing a
    // method or has the wrong signature.
    const init: (options?: IInitOptions) => void = lib.init;
    const createLocalTracks: (options?: ILocalTrackOptions) => Promise<JitsiLocalTrack[]> = lib.createLocalTracks;
    const setLogLevel: (level: string) => void = lib.setLogLevel;
    const mediaDevices = lib.mediaDevices;
    const setAudioOutputDevice: (deviceId: string) => Promise<void> = mediaDevices.setAudioOutputDevice;
    const events = lib.events;
    const conferenceEventsFromLib = events.conference;
    // Namespace wiring: events/errors objects must be the literal-typed
    // constants from the shim.
    const evConf: typeof JitsiConferenceEventsType = events.conference;
    const evConn: typeof JitsiConnectionEventsType = events.connection;
    const evTrack: typeof JitsiTrackEventsType = events.track;
    const evMedia: typeof JitsiMediaDevicesEventsType = events.mediaDevices;
    const errConf: typeof JitsiConferenceErrorsType = lib.errors.conference;
    const errConn: typeof JitsiConnectionErrorsType = lib.errors.connection;
    const errTrack: typeof JitsiTrackErrorsType = lib.errors.track;
    const isDesktopSharingEnabled: () => boolean = lib.isDesktopSharingEnabled;
    const version: string = lib.version;

    // Constructor + connection (also exposed as a namespace member).
    const connectionFromLib: JitsiConnection = new lib.JitsiConnection('app', null, {
      hosts: { domain: 'meet.example.org', muc: 'conference.meet.example.org' },
      serviceUrl: 'wss://meet.example.org/xmpp-websocket',
    });
    const connect: (options?: IConnectOptions) => void = connectionFromLib.connect;
    const initJitsiConference: (name: string, options: IConferenceOptions) => JitsiConference =
      connectionFromLib.initJitsiConference;

    // Conference: lifecycle, messaging, constraints, audio subscriptions.
    const conference: JitsiConference = initJitsiConference('space', { p2p: { enabled: false } });
    const join: (password?: string, replaceParticipant?: boolean) => void = conference.join;
    const leave: (reason?: string) => Promise<void> = conference.leave;
    const sendEndpointMessage: (to: string, payload: unknown) => void = conference.sendEndpointMessage;
    const broadcastEndpointMessage: (payload: unknown) => void = conference.broadcastEndpointMessage;
    const sendTextMessage: (message: string, elementName?: string, replyToId?: string, messageId?: string) => void =
      conference.sendTextMessage;
    const setDisplayName: (name: string) => void = conference.setDisplayName;
    const setReceiverConstraints: (c: IReceiverVideoConstraints) => void = conference.setReceiverConstraints;
    const setAudioSubscriptionMode: (
      m: IReceiverAudioSubscriptionMessage | ILegacyReceiverAudioSubscriptionMessage,
    ) => void = conference.setAudioSubscriptionMode;
    const myUserId: () => string | null = conference.myUserId;
    const getParticipants: () => JitsiParticipant[] = conference.getParticipants;

    // Track: attach/detach/mute/source-name surface.
    const track: JitsiTrack = {} as JitsiTrack;
    const localTrack: JitsiLocalTrack = {} as JitsiLocalTrack;
    const attach: (container: HTMLVideoElement) => Promise<void> = track.attach;
    const detach: (container?: HTMLVideoElement) => void = track.detach;
    const getParticipantId: () => string | undefined = track.getParticipantId;
    const getSourceName: () => string = track.getSourceName;
    const getOriginalStream: () => MediaStream | null = track.getOriginalStream;
    const isMuted: () => boolean = track.isMuted;
    const mute: () => Promise<void> = localTrack.mute;
    const unmute: () => Promise<void> = localTrack.unmute;
    const getVideoType: () => 'camera' | 'desktop' | 'desktop_high_fps' | undefined = track.getVideoType;
    const getType: () => 'audio' | 'video' = track.getType;
    const setAudioOutput: (deviceId: string) => Promise<void> = track.setAudioOutput;

    for (const fn of [
      init,
      createLocalTracks,
      setLogLevel,
      setAudioOutputDevice,
      isDesktopSharingEnabled,
      connect,
      initJitsiConference,
      join,
      leave,
      sendEndpointMessage,
      broadcastEndpointMessage,
      sendTextMessage,
      setDisplayName,
      setReceiverConstraints,
      setAudioSubscriptionMode,
      myUserId,
      getParticipants,
      attach,
      detach,
      getParticipantId,
      getSourceName,
      getOriginalStream,
      isMuted,
      mute,
      unmute,
      getVideoType,
      getType,
      setAudioOutput,
    ]) {
      // Compile-time proof only — the refs come from a stub in node.
      expect(typeof fn === 'function' || fn === undefined).toBe(true);
    }
    expect(conferenceEventsFromLib).toBeDefined();
    expect(evConf && evConn && evTrack && evMedia && errConf && errConn && errTrack).toBeTruthy();
    expect(version).toBeDefined();
  });

  it('accepts the SPEC §8.4 / §9.2 payloads (type-level)', () => {
    // SPEC §8.4 audio subscription: both the legacy {mode,list} and the
    // current {all,include,exclude} shapes.
    const legacy: ILegacyReceiverAudioSubscriptionMessage = { mode: 'Include', list: ['abc-a0'] };
    const current: IReceiverAudioSubscriptionMessage = { all: false, include: ['abc-a0'], exclude: [] };
    expect(legacy.mode).toBe('Include');
    expect(current.all).toBe(false);

    // SPEC §9.2 receiver constraints, verbatim from the spec snippet.
    const rc: IReceiverVideoConstraints = {
      lastN: 16,
      selectedSources: ['a-v0', 'b-v0'],
      onStageSources: ['a-v0'],
      defaultConstraints: { maxHeight: 180 },
      constraints: { 'a-v0': { maxHeight: 360 } },
    };
    expect(rc.lastN).toBe(16);
    expect(rc.constraints?.['a-v0']?.maxHeight).toBe(360);
  });
});
