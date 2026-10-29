/**
 * Room — SPEC §5.2/§8/§9. The joined-session host: Phaser canvas (via the
 * scene factory, loaded by dynamic import so this module stays node-safe for
 * test/ui.test.ts), the DOM bubble overlay, the stage panel (§9.3), the
 * Chat/People sidebar, the bottom bar, and the §8.4/§9.2 debounced planner
 * loop. The rAF loop drives: audio-engine update, pose send (§7), the
 * audio-track attach/detach diff (§6.5) and the 500 ms debounced bridge
 * plans (§8.4/§9.2 — never per frame, §11).
 *
 * Pure exports (diffAudioTracks / selectStageShare) are node-tested.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GameHandle } from '../game/scene';
import { type CameraLike, type CamView, readCamera } from '../game/viewport';
import { computeAudibleSourceNames, computeVideoPlan, debounce } from '../spatial/plan';
import { store } from '../store';
import type { RemoteState } from '../types';
import { AudioBanner } from './AudioBanner';
import { BottomBar } from './BottomBar';
import { useStore } from './hooks';
import { ChatPanel } from './panels/ChatPanel';
import { PeoplePanel } from './panels/PeoplePanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { StagePanel } from './panels/StagePanel';
import type { Session } from './session';
import { canvasAriaLabel, inviteLink, type ShareCandidate, shareCandidates, shareNotices } from './util';
import { VideoBubbles, type VideoBubblesHandle } from './VideoBubbles';

// ---------------------------------------------------------------- pure logic

export interface AudioTrackDiff {
  /** Ids needing engine.attachParticipant (new tracks + replaced refs). */
  attach: string[];
  /** Ids needing engine.detachParticipant (left/removed/replaced tracks). */
  detach: string[];
  /** The new per-id track-ref registry to keep. */
  refs: Map<string, unknown>;
}

/**
 * Diff the live audio tracks against the per-id refs we last attached
 * (§6.5): participants with an audioTrack, local user skipped (§6.4).
 * A replaced track ref lands in BOTH lists — callers detach, then attach.
 */
export function diffAudioTracks(
  prev: ReadonlyMap<string, unknown>,
  participants: readonly RemoteState[],
  localId: string | null,
): AudioTrackDiff {
  const attach: string[] = [];
  const detach: string[] = [];
  const refs = new Map<string, unknown>();
  for (const p of participants) {
    if (p.id === localId || !p.audioTrack) continue;
    refs.set(p.id, p.audioTrack);
    if (prev.get(p.id) !== p.audioTrack) attach.push(p.id);
  }
  for (const id of prev.keys()) {
    if (!refs.has(id)) detach.push(id);
  }
  return { attach, detach, refs };
}

export interface StageSelection {
  /** Participant rendered on the stage (§9.3: one at a time). */
  openId: string | null;
  /** People-tab notices for every other share ("sharing in <zone>", queued). */
  notices: string[];
}

/**
 * §9.3 stage-share selection over util.shareCandidates: the panel keeps its
 * current (still-sharing, undismissed) sharer; otherwise the first VIEWABLE
 * sharer opens; dismissed shares never auto-reopen; every other share becomes
 * a People notice via util.shareNotices.
 */
export function selectStageShare(
  candidates: readonly ShareCandidate[],
  currentOpenId: string | null,
  dismissed: readonly string[] = [],
): StageSelection {
  const isDismissed = (id: string): boolean => dismissed.includes(id);
  if (currentOpenId !== null) {
    const current = candidates.find((c) => c.id === currentOpenId);
    if (current && !isDismissed(current.id)) {
      return { openId: current.id, notices: shareNotices([...candidates], current.id) };
    }
  }
  const first = candidates.find((c) => c.viewable && !isDismissed(c.id));
  const openId = first ? first.id : null;
  return { openId, notices: shareNotices([...candidates], openId) };
}

// ---------------------------------------------------------------- component

export interface RoomProps {
  session: Session;
  onLeave: () => void;
  /** Fresh join with the same parameters (§5.1 Retry after failure). */
  onRetry: () => void;
}

export function Room({ session, onLeave, onRetry }: RoomProps) {
  const snap = useStore();
  const { client, engine, map } = session;

  const [micOn, setMicOn] = useState(session.join.mic);
  const [camOn, setCamOn] = useState(session.join.cam);
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<'chat' | 'people'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stageId, setStageId] = useState<string | null>(null);
  const [notices, setNotices] = useState<readonly string[]>([]);
  const [aria, setAria] = useState<{ zone: string | null; nearby: number }>({ zone: null, nearby: 0 });
  const [audioDown, setAudioDown] = useState(false);
  const [seenChat, setSeenChat] = useState(0);

  const canvasRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameHandle | null>(null);
  const cameraRef = useRef<CamView | null>(null);
  const audioRefs = useRef(new Map<string, unknown>());
  const bubblesRef = useRef<VideoBubblesHandle>(null);
  const stageOpenRef = useRef(false);
  const dismissedRef = useRef(new Set<string>());

  // ------------------------------------------------ Phaser (StrictMode-safe)

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let disposed = false;
    let handle: GameHandle | null = null;
    import('../game/scene')
      .then(({ createGame }) => {
        if (disposed) return;
        handle = createGame(
          el,
          map,
          {
            onEmote: (emoji) => client.sendEmote(emoji), // §7.2
            onZoneChange: (z) => setAria((a) => ({ ...a, zone: z ? (z.label ?? z.id) : null })),
            onNearbyChange: (n) => setAria((a) => ({ ...a, nearby: n })),
          },
          { debugZones: new URLSearchParams(window.location.search).has('debugZones') },
        );
        gameRef.current = handle;
      })
      .catch((e) => console.warn('[jitsimap] game failed to start:', e));
    return () => {
      disposed = true;
      gameRef.current = null;
      handle?.destroy();
    };
  }, [map, client]);

  // ------------------------------------------------ rAF loop (§8/§9/§11)

  useEffect(() => {
    const flushPlans = debounce(() => {
      const s = store.getSnapshot();
      const localId = s.local.id ?? '';
      // §8.4: deafen = unsubscribe all.
      client.applyAudioSubscriptions(s.settings.deafened ? [] : computeAudibleSourceNames(store, localId));
      // §9.2: planner inputs fresh at flush time; stage share at 720p when open.
      client.applyReceiverConstraints(computeVideoPlan(store, localId, { stageDesktopOpen: stageOpenRef.current }));
    }, 500);

    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      engine.update(Date.now()); // §8.1 gains/pans every rendered frame
      const pose = store.getLocalPose();
      if (pose) client.sendPose(pose); // adapter throttles (§7.3)

      const s = store.getSnapshot();
      const diff = diffAudioTracks(audioRefs.current, s.participants, s.local.id);
      if (diff.attach.length > 0 || diff.detach.length > 0) {
        for (const id of diff.detach) engine.detachParticipant(id);
        for (const id of diff.attach) engine.attachParticipant(id);
        audioRefs.current = diff.refs;
      }

      const cam = gameRef.current?.scene?.cameras?.main;
      if (cam) cameraRef.current = readCamera(cam as CameraLike);
      bubblesRef.current?.tick();
      setSharing(client.isSharingDesktop()); // same-value setState bails
      flushPlans();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      flushPlans.cancel();
    };
  }, [client, engine]);

  // ------------------------------------------------ audio ctx banner (§8.6)

  useEffect(() => {
    const t = window.setInterval(() => {
      const st = engine.ctxState();
      setAudioDown(st !== null && st !== 'running');
    }, 1000);
    return () => window.clearInterval(t);
  }, [engine]);

  // ------------------------------------------------ stage shares (§9.3)

  stageOpenRef.current = stageId !== null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: zones() is static after load; effect triggers on participants/pose/stageId
  useEffect(() => {
    const s = store.getSnapshot();
    const cands = shareCandidates([...s.participants], s.local.pose, store.zones(), s.local.id);
    const sel = selectStageShare(cands, stageId, [...dismissedRef.current]);
    setStageId((cur) => (cur === sel.openId ? cur : sel.openId));
    setNotices((cur) =>
      cur.length === sel.notices.length && cur.every((n, i) => n === sel.notices[i]) ? cur : sel.notices,
    );
  }, [snap.participants, snap.local.pose, snap.local.id, stageId]);

  const dismissStage = useCallback((id: string) => {
    dismissedRef.current.add(id);
    setStageId(null);
  }, []);

  // ------------------------------------------------ chat unread (§5.4)

  useEffect(() => {
    if (sidebarOpen && tab === 'chat') setSeenChat(snap.chat.length);
  }, [snap.chat.length, sidebarOpen, tab]);
  const unreadChat = Math.max(0, snap.chat.length - seenChat);

  // ------------------------------------------------ controls

  const toggleMic = (): void => {
    const next = !micOn;
    setMicOn(next);
    client.setMicMuted(!next); // §6.4 mute()/unmute(), never destroy
  };
  const toggleCam = (): void => {
    const next = !camOn;
    setCamOn(next);
    client.setCamMuted(!next);
  };
  const toggleShare = (): void => {
    void (async () => {
      try {
        if (client.isSharingDesktop()) client.stopDesktopShare();
        else await client.startDesktopShare(); // §6.4 replaceTrack of the camera
      } catch (e) {
        console.warn('[jitsimap] desktop share failed:', e);
      }
      setSharing(client.isSharingDesktop());
    })();
  };
  const toggleTab = (t: 'chat' | 'people'): void => {
    if (sidebarOpen && tab === t) setSidebarOpen(false);
    else {
      setTab(t);
      setSidebarOpen(true);
    }
  };
  const copyInvite = async (): Promise<boolean> => {
    const link = inviteLink(session.space, window.location.origin);
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      window.prompt('Invite link', link); // clipboard blocked — degrade politely
      return false;
    }
  };

  const stageParticipant = stageId ? snap.participants.find((p) => p.id === stageId && p.desktopTrack) : undefined;

  return (
    <div className="jm-room">
      {audioDown && <AudioBanner onEnable={() => engine.resume()} />}
      {snap.status === 'connecting' && (
        <div className="jm-banner jm-banner--reconnect" role="status">
          Connecting…
        </div>
      )}
      {snap.status === 'reconnecting' && (
        <div className="jm-banner jm-banner--reconnect" role="status">
          {snap.lastError ?? 'Reconnecting…'}
        </div>
      )}

      <div className="jm-room__main">
        <div className="jm-room__canvas">
          <div ref={canvasRef} role="img" aria-label={canvasAriaLabel(aria.zone, aria.nearby)} />
          <VideoBubbles ref={bubblesRef} client={client} camOn={camOn} cameraRef={cameraRef} />
          {stageParticipant && (
            <StagePanel participantId={stageParticipant.id} onDismiss={() => dismissStage(stageParticipant.id)} />
          )}
        </div>

        {sidebarOpen && (
          <aside className="jm-panel">
            <div className="jm-panel__tabs" role="tablist" aria-label="Sidebar">
              <button
                className="jm-tab"
                type="button"
                role="tab"
                aria-selected={tab === 'chat'}
                onClick={() => setTab('chat')}
              >
                Chat
                {tab === 'chat' && unreadChat > 0 && <span className="jm-bar__badge">{unreadChat}</span>}
              </button>
              <button
                className="jm-tab"
                type="button"
                role="tab"
                aria-selected={tab === 'people'}
                onClick={() => setTab('people')}
              >
                People
              </button>
            </div>
            <div className="jm-panel__body">
              {tab === 'chat' ? (
                <ChatPanel onSend={(text) => client.sendChat(text)} />
              ) : (
                <PeoplePanel localId={snap.local.id} notices={notices} />
              )}
            </div>
          </aside>
        )}
      </div>

      <BottomBar
        micOn={micOn}
        camOn={camOn}
        sharing={sharing}
        sidebarOpen={sidebarOpen}
        activeTab={tab}
        unreadChat={unreadChat}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleShare={toggleShare}
        onSendEmote={(emoji) => client.sendEmote(emoji)}
        onToggleTab={toggleTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onCopyInvite={copyInvite}
        onLeave={onLeave}
      />

      {settingsOpen && (
        /* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop click; Esc is the keyboard equivalent */
        <div
          className="jm-modal"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <SettingsPanel client={client} onClose={() => setSettingsOpen(false)} />
        </div>
      )}

      {(snap.status === 'failed' || snap.status === 'waiting-host') && (
        <div
          className="jm-overlay"
          role="alertdialog"
          aria-label={snap.status === 'waiting-host' ? 'Waiting for a host' : 'Connection lost'}
        >
          <div className="jm-overlay__card">
            <h2>{snap.status === 'waiting-host' ? '⏳ Waiting for a host' : '⚠️ Connection lost'}</h2>
            <p className="jm-lobby__subtitle">
              {snap.lastError ??
                (snap.status === 'failed'
                  ? 'The conference connection failed.'
                  : 'Waiting for a host to open this room.')}
            </p>
            <div className="jm-settings__actions">
              <button className="jm-btn" type="button" onClick={onLeave}>
                Leave
              </button>
              <button className="jm-btn jm-btn--primary" type="button" onClick={onRetry}>
                Retry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
