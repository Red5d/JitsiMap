/**
 * JitsiClient — the SPEC §6 connection/conference lifecycle over
 * lib-jitsi-meet. Together with its src/jitsi/ siblings this is the ONLY
 * code that imports 'lib-jitsi-meet' (SPEC §4.2 seam); everything else
 * consumes api.ts + the store.
 *
 * Not imported from node tests: the pinned lib is a browser-only UMD
 * bundle. Its pure logic lives in messaging.ts / constraints.ts /
 * protocol.ts (unit-tested); this file is lifecycle plumbing verified by
 * the §16.2/§16.3 browser matrices.
 *
 * Caller contract (§14): stripJwtFromUrl(config.auth.tokenParam) is the
 * UI's job after join resolves — the client never touches the address bar.
 * loadRuntimeConfig() is fetched by the caller; join() receives it via
 * the factory.
 */

import type { ILocalTrackOptions, JitsiConference, JitsiConnection, JitsiLocalTrack } from 'lib-jitsi-meet';
import JitsiMeetJS from 'lib-jitsi-meet';

import type { RuntimeConfig } from '../config';
import type { ValidationCtx } from '../protocol';
import type { Store } from '../store';
import type { AvatarInfo, MapData } from '../types';
import type { JitsiClient, JoinOptions, VideoPlan } from './api';
import { applyReceiverConstraints } from './constraints';
import { MessagingHub } from './messaging';
import { attachVideo, detachVideo, getTrackVideoType, stopUnderlyingTrack } from './tracks';

const CE = JitsiMeetJS.events.conference;
const COE = JitsiMeetJS.events.connection;
const TE = JitsiMeetJS.events.track;
const CErr = JitsiMeetJS.errors.conference;
const KErr = JitsiMeetJS.errors.connection;

/** Pin fallback if the bundle exposes no version string (docs/lib-surface.md). */
const LIB_VERSION_FALLBACK = 'v2236.0.0+51058e35';
/** §6.3: "throttle UI updates" for speaking indicators. */
const AUDIO_LEVEL_THROTTLE_MS = 100;

let libInited = false;

/** Analytics off + no external logging (§6.1/§14); console at warn. */
function initLibOnce(): void {
  if (libInited) return;
  libInited = true;
  JitsiMeetJS.init({
    // The lib keeps analytics alive ONLY when this is exactly true (lib-surface §1).
    enableAnalyticsLogging: false,
    disableThirdPartyRequests: true,
  });
  JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.WARN ?? 'warn');
}

function noop(): void {
  /* promise swallow */
}

/** Map → §7.3 validation context (bounds + known zone ids). */
function mapCtx(map: MapData): ValidationCtx {
  return {
    widthPx: map.widthPx,
    heightPx: map.heightPx,
    zoneIds: new Set(map.zones.map((z) => z.id)),
  };
}

interface HandlerRecord {
  target: {
    addEventListener(event: string, listener: (...args: any[]) => void): void;
    removeEventListener(event: string, listener?: (...args: any[]) => void): void;
  };
  event: string;
  fn: (...args: any[]) => void;
}

export function createJitsiClient(config: RuntimeConfig, store: Store): JitsiClient {
  let connection: JitsiConnection | null = null;
  let conference: JitsiConference | null = null;
  let messaging: MessagingHub | null = null;
  let optsRef: JoinOptions | null = null;

  let localAudio: JitsiLocalTrack | null = null;
  let localCamera: JitsiLocalTrack | null = null;
  let desktopTrack: JitsiLocalTrack | null = null;
  const previewEls = new Set<HTMLVideoElement>();

  let joinSettle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  let leavePromise: Promise<void> | null = null;
  let leaving = false;
  const handlers: HandlerRecord[] = [];

  // §6.3 TRACK_AUDIO_LEVEL_CHANGED throttle (per participant, trailing flush).
  const levelPending = new Map<string, number>();
  const levelLastFlush = new Map<string, number>();
  const levelTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---------------------------------------------------------------- helpers

  function on(target: HandlerRecord['target'], event: string, fn: (...args: any[]) => void): void {
    handlers.push({ target, event, fn });
    target.addEventListener(event, fn);
  }

  function settleJoin(ok: boolean, msg?: string): void {
    const s = joinSettle;
    joinSettle = null;
    if (!s) return;
    if (ok) s.resolve();
    else s.reject(new Error(msg ?? 'Conference join failed.'));
  }

  function humanConnectionError(err: string, msg?: string): string {
    switch (err) {
      case KErr.CONNECTION_DROPPED_ERROR:
        return 'Connection to the Jitsi server dropped. Check your network and Retry.';
      case KErr.SERVER_ERROR:
        return `The Jitsi server (${config.jitsi.domain}) is unreachable. Check JITSI_DOMAIN and Retry.`;
      case KErr.PASSWORD_REQUIRED:
        return 'The Jitsi server requires a password/token. Check JITSI_AUTH_MODE.';
      case KErr.NOT_LIVE_ERROR:
        return `The Jitsi deployment at ${config.jitsi.domain} is not live.`;
      case KErr.CONFERENCE_REQUEST_FAILED:
        return 'The room could not be opened by the Jitsi server. Retry.';
      case KErr.SHARD_CHANGED_ERROR:
        return 'The Jitsi shard changed mid-session. Retry to reconnect.';
      case KErr.TIME_LIMIT_ERROR:
        return 'The meeting time limit configured on the Jitsi server has been reached.';
      default:
        return `Connection to ${config.jitsi.domain} failed${msg ? `: ${msg}` : ''}.`;
    }
  }

  /** §5.1 human messages; returns the message used (status already set). */
  function handleConferenceFailure(error: string): string {
    // §6.6 best-effort: with ENABLE_AUTH + ENABLE_GUESTS, prosody gates guest
    // joins until an authenticated user opens the room. The lib surfaces that
    // as conference.passwordRequired / connectionError.membersOnly /
    // notAllowed / accessDenied — there is NO dedicated "waiting-for-host"
    // code in JitsiConferenceErrors (docs/lib-surface.md). All four map to
    // the distinct §5.1 waiting-host state in jwt-guest mode.
    const hostGated =
      error === CErr.PASSWORD_REQUIRED ||
      error === CErr.MEMBERS_ONLY_ERROR ||
      error === CErr.NOT_ALLOWED_ERROR ||
      error === CErr.CONFERENCE_ACCESS_DENIED;
    if (hostGated && config.auth.mode === 'jwt-guest') {
      const m = 'Waiting for a host to open this room. Ask a signed-in user to join first.';
      store.setStatus('waiting-host', m);
      return m;
    }
    if (hostGated) {
      const m = 'This space is access-restricted. Check JITSI_AUTH_MODE / token configuration.';
      store.setStatus('failed', m);
      return m;
    }
    switch (error) {
      case CErr.CONFERENCE_DESTROYED: {
        const m = 'The conference has been closed.';
        store.setStatus('failed', m);
        return m;
      }
      case CErr.CONNECTION_ERROR: {
        const m = 'Lost connection to the conference server. Retrying…';
        store.setStatus('reconnecting', m);
        return m;
      }
      case CErr.FOCUS_DISCONNECTED: {
        const m = 'The conference host (jicofo) temporarily disconnected. Waiting for recovery…';
        store.setStatus('reconnecting', m);
        return m;
      }
      case CErr.FOCUS_LEFT: {
        const m = 'The conference host (jicofo) left. The room cannot continue — Retry.';
        store.setStatus('failed', m);
        return m;
      }
      case CErr.GRACEFUL_SHUTDOWN: {
        const m = 'The Jitsi server is shutting down. Retry shortly.';
        store.setStatus('failed', m);
        return m;
      }
      case CErr.ICE_FAILED:
      case CErr.OFFER_ANSWER_FAILED: {
        const m = 'Media connection failed (ICE). Check firewalls/UDP 10000 and Retry.';
        store.setStatus('failed', m);
        return m;
      }
      case CErr.VIDEOBRIDGE_NOT_AVAILABLE: {
        const m = 'The media server (JVB) is not available. Retry.';
        store.setStatus('failed', m);
        return m;
      }
      case CErr.AUTHENTICATION_REQUIRED: {
        const m = 'Authentication required. Configure JITSI_AUTH_MODE / a JWT token.';
        store.setStatus('failed', m);
        return m;
      }
      case CErr.INCOMPATIBLE_SERVER_VERSIONS: {
        const m = 'Client/server version mismatch — pin lib-jitsi-meet to the stack release.';
        store.setStatus('failed', m);
        return m;
      }
      case CErr.CONFERENCE_MAX_USERS: {
        const m = 'This space is full (server max-users reached).';
        store.setStatus('failed', m);
        return m;
      }
      default: {
        const m = `Conference failed (${error}).`;
        store.setStatus('failed', m);
        return m;
      }
    }
  }

  // ---------------------------------------------------------------- tracks

  /**
   * Media-permission policy (§5.1: "mic/cam denied — joining muted/
   * camera-off is allowed"): api.ts is frozen and exposes no onMediaDenied
   * callback, so the decision is: camera denial → retry audio-only (join
   * camera-off); audio denial too → join with no local media (effectively
   * muted). Surfaced via console.warn only — no chat spam; the lobby
   * already lets users pre-mute/pre-hide.
   */
  async function createLocalMedia(opts: JoinOptions): Promise<JitsiLocalTrack[]> {
    const base: ILocalTrackOptions = {};
    if (opts.audioDeviceId) base.micDeviceId = opts.audioDeviceId; // lib-surface §5: micDeviceId/cameraDeviceId
    if (opts.videoDeviceId) base.cameraDeviceId = opts.videoDeviceId;
    const devices: Array<'audio' | 'video'> = ['audio'];
    if (opts.cam) devices.push('video');
    try {
      return await JitsiMeetJS.createLocalTracks({ ...base, devices });
    } catch (e) {
      console.warn('[jitsimap] createLocalTracks failed — joining with reduced media (§5.1):', e);
    }
    if (devices.length > 1) {
      try {
        return await JitsiMeetJS.createLocalTracks({ ...base, devices: ['audio'] });
      } catch (e2) {
        console.warn('[jitsimap] audio also denied — joining with no local media:', e2);
      }
    }
    return [];
  }

  async function createCameraTrack(): Promise<JitsiLocalTrack | null> {
    try {
      const opts: ILocalTrackOptions = { devices: ['video'] };
      if (optsRef?.videoDeviceId) opts.cameraDeviceId = optsRef.videoDeviceId;
      const tracks = await JitsiMeetJS.createLocalTracks(opts);
      return tracks.find((t) => t.isVideoTrack()) ?? null;
    } catch (e) {
      console.warn('[jitsimap] camera unavailable:', e);
      return null;
    }
  }

  function reattachPreviews(): void {
    const shown = desktopTrack ?? localCamera;
    for (const el of previewEls) {
      detachVideo(el, localCamera);
      detachVideo(el, desktopTrack);
      attachVideo(el, shown);
    }
  }

  // ---------------------------------------------------------------- events

  function registerConferenceHandlers(conf: JitsiConference, opts: JoinOptions): void {
    on(conf, CE.CONFERENCE_JOINED, () => {
      const id = conf.myUserId() ?? '';
      store.setLocalId(id);
      store.setStatus('joined');
      // §7.4 exchange starts the moment we are on the MUC. Endpoint messages
      // need the bridge data channel; sends are best-effort (swallow+warn)
      // until DATA_CHANNEL_OPENED fires.
      messaging = new MessagingHub({
        sendBroadcast: (p) => {
          try {
            conf.broadcastEndpointMessage(p);
          } catch (e) {
            console.warn('[jitsimap] broadcast dropped (bridge channel not open?):', e);
          }
        },
        sendDirect: (to, p) => {
          try {
            conf.sendEndpointMessage(to, p);
          } catch (e) {
            console.warn('[jitsimap] direct message dropped (bridge channel not open?):', e);
          }
        },
        selfId: id,
        getMapCtx: () => mapCtx(opts.map),
        store,
        now: () => Date.now(),
      });
      messaging.start(store.getLocalPose());
      settleJoin(true);
    });

    on(conf, CE.CONFERENCE_LEFT, () => {
      if (!leaving) store.setStatus('lobby');
    });

    on(conf, CE.CONFERENCE_FAILED, (error: string) => {
      const human = handleConferenceFailure(error);
      settleJoin(false, human);
    });

    on(conf, CE.CONFERENCE_JOIN_IN_PROGRESS, () => {
      console.info('[jitsimap] conference join already in progress');
    });

    // §6.2: NO automatic reconnect loop (the MAY). Surface the states; the
    // UI's Retry performs a fresh join (§7.4 handles the state re-sync).
    on(conf, CE.CONNECTION_INTERRUPTED, () => {
      store.setStatus('reconnecting', 'Network interrupted — trying to recover…');
    });
    on(conf, CE.CONNECTION_RESTORED, () => {
      store.setStatus('joined');
    });

    // §7.2 DISPLAY_NAME_CHANGED (setDisplayName presence) is authoritative
    // over the hello payload's name.
    on(conf, CE.USER_JOINED, (id: string, participant: any) => {
      if (id === conf.myUserId()) return;
      store.upsertParticipant(id, {
        joinedAt: Date.now(),
        name: participant?.getDisplayName() || '',
      });
    });

    on(conf, CE.USER_LEFT, (id: string) => {
      if (messaging) messaging.onUserLeft(id);
      else store.removeParticipant(id);
      levelPending.delete(id);
      levelLastFlush.delete(id);
    });

    on(conf, CE.DISPLAY_NAME_CHANGED, (id: string, displayName: string) => {
      if (id === conf.myUserId()) {
        store.setSettings({ displayName });
        return;
      }
      store.upsertParticipant(id, { name: displayName ?? '' });
    });

    // §6.5 remote tracks → store (audio engine §8 / bubbles §9 consume them).
    on(conf, CE.TRACK_ADDED, (track: any) => {
      if (track.isLocal()) return;
      const id = track.getParticipantId();
      if (!id || id === conf.myUserId()) return;
      if (track.isAudioTrack()) {
        store.upsertParticipant(id, {
          audioTrack: track,
          hasAudio: true,
          audioSourceName: track.getSourceName(),
          micMuted: track.isMuted(),
        });
      } else if (getTrackVideoType(track) === 'desktop') {
        store.upsertParticipant(id, {
          desktopTrack: track,
          hasDesktop: true,
          desktopSourceName: track.getSourceName(),
        });
      } else {
        store.upsertParticipant(id, {
          videoTrack: track,
          hasVideo: true,
          videoSourceName: track.getSourceName(),
          camMuted: track.isMuted(),
        });
      }
    });

    on(conf, CE.TRACK_REMOVED, (track: any) => {
      if (track.isLocal()) return;
      const id = track.getParticipantId();
      if (!id) return;
      if (track.isAudioTrack()) {
        store.upsertParticipant(id, { audioTrack: null, hasAudio: false, audioSourceName: null, audioLevel: 0 });
      } else if (getTrackVideoType(track) === 'desktop') {
        store.upsertParticipant(id, { desktopTrack: null, hasDesktop: false, desktopSourceName: null });
      } else {
        store.upsertParticipant(id, { videoTrack: null, hasVideo: false, videoSourceName: null });
      }
    });

    on(conf, CE.TRACK_MUTE_CHANGED, (track: any) => {
      if (track.isLocal()) return;
      const id = track.getParticipantId();
      if (!id) return;
      if (track.isAudioTrack()) store.upsertParticipant(id, { micMuted: track.isMuted() });
      else if (getTrackVideoType(track) === 'camera') store.upsertParticipant(id, { camMuted: track.isMuted() });
    });

    on(conf, CE.TRACK_AUDIO_LEVEL_CHANGED, (participantId: string, audioLevel: number) => {
      throttleAudioLevel(participantId, audioLevel, conf);
    });

    // §7.6 chat — positional args in this pin (docs/lib-surface.md §3).
    on(
      conf,
      CE.MESSAGE_RECEIVED,
      (
        participantId: string,
        txt: string,
        ts: number,
        displayName?: string,
        _isVisitor?: boolean,
        messageId?: string,
      ) => {
        const self = participantId === conf.myUserId();
        const name = displayName || store.getParticipant(participantId)?.name || participantId;
        store.addChat({
          id: messageId ?? `${ts}-${participantId}`,
          from: participantId,
          name,
          text: txt,
          ts,
          self,
        });
      },
    );

    // §7 — verified shape: (participant OBJECT, payload); drop self (§7.3).
    on(conf, CE.ENDPOINT_MESSAGE_RECEIVED, (participant: any, payload: unknown) => {
      const id = participant?.getId?.();
      if (!id || id === conf.myUserId()) return;
      messaging?.onEndpointMessage(id, payload);
    });

    // §6.3 diagnostic.
    on(conf, CE.DATA_CHANNEL_OPENED, () => {
      console.info('[jitsimap] bridge data channel opened — endpoint messages live');
    });
  }

  function throttleAudioLevel(id: string, level: number, conf: JitsiConference): void {
    if (!id || id === conf.myUserId()) return;
    if (!store.getParticipant(id)) return;
    levelPending.set(id, level);
    const now = Date.now();
    const elapsed = now - (levelLastFlush.get(id) ?? 0);
    if (elapsed >= AUDIO_LEVEL_THROTTLE_MS) {
      flushAudioLevel(id);
    } else if (!levelTimers.has(id)) {
      levelTimers.set(
        id,
        setTimeout(() => {
          levelTimers.delete(id);
          flushAudioLevel(id);
        }, AUDIO_LEVEL_THROTTLE_MS - elapsed),
      );
    }
  }

  function flushAudioLevel(id: string): void {
    const level = levelPending.get(id);
    if (level === undefined) return;
    levelLastFlush.set(id, Date.now());
    if (store.getParticipant(id)) store.upsertParticipant(id, { audioLevel: level });
  }

  function clearLevelTimers(): void {
    for (const t of levelTimers.values()) clearTimeout(t);
    levelTimers.clear();
    levelPending.clear();
    levelLastFlush.clear();
  }

  // ---------------------------------------------------------------- desktop

  function onDesktopStopped(): void {
    void restoreAfterShare();
  }

  /** §6.4: the browser's native "Stop sharing" ends the desktop track → share-off. */
  async function restoreAfterShare(): Promise<void> {
    const desk = desktopTrack;
    desktopTrack = null;
    if (!desk) return;
    try {
      desk.removeEventListener(TE.LOCAL_TRACK_STOPPED, onDesktopStopped);
    } catch {
      /* noop */
    }
    const conf = conference;
    let cam = localCamera && !localCamera.isEnded() ? localCamera : null;
    if (conf) {
      if (cam) {
        try {
          await conf.replaceTrack(desk, cam);
        } catch (e) {
          console.warn('[jitsimap] camera restore replaceTrack failed:', e);
        }
      } else {
        cam = await createCameraTrack();
        if (cam) {
          try {
            conf.addTrack(cam);
          } catch (e) {
            console.warn('[jitsimap] camera restore addTrack failed:', e);
          }
        }
      }
    }
    localCamera = cam;
    stopUnderlyingTrack(desk);
    void desk.dispose().catch(noop);
    reattachPreviews();
  }

  // ---------------------------------------------------------------- lifecycle

  function onEstablished(opts: JoinOptions): Promise<void> {
    const conn = connection;
    if (!conn) return Promise.reject(new Error('No connection.'));
    // p2p MUST stay disabled (§7.1/§12: poses travel the JVB bridge channel).
    // startAudioMuted/startVideoMuted intentionally unset (§2.1 proximity UX);
    // videoQuality left at lib defaults (§9.2 caps are receiver-side).
    const conf = conn.initJitsiConference(opts.space, { p2p: { enabled: false } });
    conference = conf;
    registerConferenceHandlers(conf, opts); // ALL §6.3 handlers BEFORE join()

    return createLocalMedia(opts).then((tracks) => {
      for (const t of tracks) {
        if (t.isAudioTrack()) {
          localAudio = t;
          try {
            conf.addTrack(t);
          } catch (e) {
            console.warn('[jitsimap] addTrack(audio) failed:', e);
          }
          if (!opts.mic) void t.mute().catch(noop); // §6.4 mute, never destroy
        } else {
          localCamera = t;
          try {
            conf.addTrack(t);
          } catch (e) {
            console.warn('[jitsimap] addTrack(video) failed:', e);
          }
          if (!opts.cam) void t.mute().catch(noop);
        }
      }
      conf.setDisplayName(opts.displayName);
      return new Promise<void>((resolve, reject) => {
        joinSettle = { resolve, reject };
        conf.join();
        // §14: stripJwtFromUrl(config.auth.tokenParam) is called by the UI
        // after join() resolves — the adapter never touches history.
      });
    });
  }

  async function doLeave(): Promise<void> {
    const conf = conference;
    const conn = connection;
    conference = null;
    connection = null;
    messaging?.stop();
    messaging = null;
    clearLevelTimers();
    settleJoin(false, 'Left the conference.');
    previewEls.clear();

    // §6.2 leave order: stop local tracks → conference.leave → disconnect.
    const locals = new Set<JitsiLocalTrack>();
    for (const t of conf?.getLocalTracks() ?? []) locals.add(t);
    for (const t of [localAudio, localCamera, desktopTrack]) if (t) locals.add(t);
    localAudio = localCamera = desktopTrack = null;
    for (const t of locals) {
      stopUnderlyingTrack(t);
      try {
        await t.dispose();
      } catch {
        /* already disposed */
      }
    }

    if (conf) {
      try {
        await conf.leave();
      } catch (e) {
        console.warn('[jitsimap] conference.leave failed:', e);
      }
    }
    if (conn) {
      try {
        await conn.disconnect();
      } catch (e) {
        console.warn('[jitsimap] connection.disconnect failed:', e);
      }
    }
    store.reset(); // §6.2: any rejoin is a fresh join — participants/chat/poses cleared
    optsRef = null;
  }

  // ---------------------------------------------------------------- api

  const client: JitsiClient = {
    join(opts: JoinOptions): Promise<void> {
      if (connection) return Promise.reject(new Error('Already connected — leave() first.'));
      optsRef = opts;
      leaving = false;
      store.setMap(opts.map);
      store.setLocalIdentity(opts.displayName, opts.avatar);
      store.setStatus('connecting');
      initLibOnce();
      return new Promise<void>((resolve, reject) => {
        // Divergence (docs/lib-surface.md §2): bosh is REMOVED in the pin —
        // serviceUrl carries the xmpp-websocket URL. `focus` is omitted;
        // the lib defaults it to 'focus.<domain>' (moderator.js).
        const conn = new JitsiMeetJS.JitsiConnection(
          config.jitsi.appId,
          config.auth.mode === 'jwt-token' ? config.auth.token : null,
          {
            hosts: {
              domain: config.jitsi.xmppDomain,
              muc: config.jitsi.muc,
            },
            serviceUrl: config.jitsi.websocket,
          },
        );
        connection = conn;
        let settled = false;
        const settle = (ok: boolean, msg?: string): void => {
          if (settled) return;
          settled = true;
          if (ok)
            onEstablished(opts).then(
              () => resolve(),
              (e: unknown) => reject(e instanceof Error ? e : new Error(String(e))),
            );
          else reject(new Error(msg ?? 'Connection failed.'));
        };
        on(conn, COE.CONNECTION_ESTABLISHED, () => settle(true));
        on(conn, COE.CONNECTION_FAILED, (err: string, msg?: string) => {
          const human = humanConnectionError(err, msg);
          store.setStatus('failed', human);
          settle(false, human);
        });
        on(conn, COE.CONNECTION_DISCONNECTED, () => {
          if (leaving) return;
          const human = 'Connection to the Jitsi server was lost. Retry to rejoin.';
          store.setStatus('failed', human);
          settle(false, human);
        });
        on(conn, COE.CONNECTION_TOKEN_EXPIRED, () => {
          const human = 'Your JWT token expired. Reload with a fresh token link.';
          store.setStatus('failed', human);
          settle(false, human);
        });
        conn.connect();
      });
    },

    leave(): Promise<void> {
      if (leavePromise) return leavePromise;
      leaving = true;
      leavePromise = doLeave().finally(() => {
        leavePromise = null;
        leaving = false;
      });
      return leavePromise;
    },

    setMicMuted(muted: boolean): void {
      if (!localAudio) {
        console.warn('[jitsimap] no microphone track (permission denied at join) — mute is a no-op');
        return;
      }
      void (muted ? localAudio.mute() : localAudio.unmute()).catch(noop); // §6.4: mute()/unmute(), never destroy
    },

    setCamMuted(muted: boolean): void {
      if (muted) {
        if (localCamera) void localCamera.mute().catch(noop);
        return;
      }
      if (localCamera) {
        void localCamera.unmute().catch(noop);
        return;
      }
      // Camera never opened (lobby cam-off / denial): create it on demand.
      void (async () => {
        if (!conference || localCamera) return;
        const cam = await createCameraTrack();
        if (!cam || !conference) return;
        localCamera = cam;
        try {
          conference.addTrack(cam);
        } catch (e) {
          console.warn('[jitsimap] addTrack(camera) failed:', e);
        }
        reattachPreviews();
      })();
    },

    async startDesktopShare(): Promise<void> {
      const conf = conference;
      if (!conf) throw new Error('Not in a conference.');
      if (desktopTrack) return; // idempotent
      const tracks = await JitsiMeetJS.createLocalTracks({
        devices: ['desktop'],
        desktopSharingSources: ['screen', 'window'],
      });
      const desk = tracks.find((t) => t.isVideoTrack());
      if (!desk) throw new Error('Desktop track was not created.');
      desktopTrack = desk;
      desk.addEventListener(TE.LOCAL_TRACK_STOPPED, onDesktopStopped); // native "Stop sharing"
      if (localCamera) {
        await conf.replaceTrack(localCamera, desk); // §6.4: replace the camera
      } else {
        conf.addTrack(desk);
      }
      reattachPreviews();
    },

    stopDesktopShare(): void {
      // Native-stops the MediaStreamTrack → LOCAL_TRACK_STOPPED →
      // restoreAfterShare() (camera restored via replaceTrack/create).
      stopUnderlyingTrack(desktopTrack);
    },

    setAudioOutput(deviceId: string): void {
      // lib-surface §10: setSinkId on attached elements (muted workaround,
      // previews). Spatialised Web Audio playback re-routes app-side via
      // AudioContext.setSinkId (§8.6) — not the lib's concern.
      JitsiMeetJS.mediaDevices
        .setAudioOutputDevice(deviceId)
        .catch((e) => console.warn('[jitsimap] speaker output selection unavailable:', e));
    },

    sendChat(text: string): void {
      const trimmed = text.trim();
      if (!trimmed || !conference) return;
      try {
        conference.sendTextMessage(trimmed); // §7.6: chat over MUC body only
      } catch (e) {
        console.warn('[jitsimap] sendTextMessage failed:', e);
      }
    },

    sendPose(pose): void {
      if (!messaging) {
        console.debug('[jitsimap] sendPose before join — ignored');
        return;
      }
      messaging.feedPose(pose);
    },

    sendEmote(emoji: string): void {
      messaging?.sendEmote(emoji);
    },

    setAvatar(avatar: AvatarInfo): void {
      const local = store.getSnapshot().local;
      store.setLocalIdentity(local.name, avatar);
      messaging?.sendAvatar(avatar);
    },

    attachLocalVideo(el: HTMLVideoElement): void {
      previewEls.add(el);
      el.playsInline = true;
      attachVideo(el, desktopTrack ?? localCamera);
    },

    detachLocalVideo(el: HTMLVideoElement): void {
      previewEls.delete(el);
      detachVideo(el, localCamera);
      detachVideo(el, desktopTrack);
    },

    isSharingDesktop(): boolean {
      return desktopTrack !== null;
    },

    applyAudioSubscriptions(audioSourceNames: string[]): void {
      const conf = conference;
      if (!conf) return;
      const list = audioSourceNames.filter((s) => typeof s === 'string' && s.trim().length > 0);
      // §8.4: the API EXISTS in the pinned lib (legacy shape normalised,
      // lib-surface §8) — the guards stay as the old-bridge fallback.
      if (typeof conf.setAudioSubscriptionMode !== 'function') {
        console.warn('[jitsimap] setAudioSubscriptionMode absent — falling back to local gain only (§8.4)');
        return;
      }
      try {
        conf.setAudioSubscriptionMode({ mode: 'Include', list }); // empty list = None (deafen)
      } catch (e) {
        console.warn('[jitsimap] setAudioSubscriptionMode failed — falling back to local gain only (§8.4):', e);
      }
    },

    applyReceiverConstraints(plan: VideoPlan): void {
      applyReceiverConstraints(conference, plan);
    },

    describe(): { conference: string; participantId: string; libVersion: string } | null {
      if (!conference) return null;
      return {
        conference: optsRef?.space ?? conference.getName(),
        participantId: conference.myUserId() ?? '',
        libVersion: JitsiMeetJS.version || LIB_VERSION_FALLBACK,
      };
    },

    dispose(): void {
      // leave() is idempotent and removes all registered listeners.
      void client.leave().catch(noop);
    },
  };

  return client;
}
