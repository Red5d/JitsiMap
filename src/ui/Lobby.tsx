/**
 * Lobby — SPEC §5.1/§6.6/§8.6. Root route: pick a space. Space route: space +
 * map name, display name (store-prefilled), emoji picker, mic/cam initial
 * toggles, explicit Join click (which doubles as the Web-Audio unlock
 * gesture, §8.6). The join sequence is step-labelled; every failure is an
 * explicit message + Retry, never an endless spinner (§5.1). JWT-guest
 * host-gated rooms get the distinct waiting-host message (§6.6).
 *
 * The join reducer is a pure exported state machine — node-tested in
 * test/ui.test.ts. lib-jitsi-meet code is loaded via dynamic import at join
 * time, keeping this module graph node-safe (§4.2 seam lives in src/jitsi/).
 */

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { ConfigError, loadRuntimeConfig, normalizeSpaceName, stripJwtFromUrl } from '../config';
import type { RuntimeConfig } from '../config';
import { loadMap } from '../game/maps';
import { store } from '../store';
import { createAudioEngine } from '../spatial/audioEngine';
import { EMOJI_SET, type AvatarInfo } from '../types';
import { navigate, useLocation, useStore } from './hooks';
import { pathForSpace } from './util';
import type { Session } from './session';

// ---------------------------------------------------------------- join state machine

export const JOIN_STEPS = [
  { id: 'audio', label: 'Unlocking audio…' },
  { id: 'config', label: 'Loading configuration…' },
  { id: 'map', label: 'Loading map…' },
  { id: 'connect', label: 'Connecting to the space…' },
] as const;

export type JoinStepId = (typeof JOIN_STEPS)[number]['id'];

export interface JoinState {
  phase: 'idle' | 'joining' | 'failed' | 'waiting-host';
  /** Current step while joining; the failed step while failed. */
  step: JoinStepId | null;
  message: string | null;
  /** Lobby media seeds — become Session.join (§5.1). */
  mic: boolean;
  cam: boolean;
}

export const initialJoinState: JoinState = {
  phase: 'idle',
  step: null,
  message: null,
  mic: true,
  cam: false,
};

export type JoinAction =
  | { type: 'toggle'; media: 'mic' | 'cam' }
  | { type: 'begin' }
  | { type: 'step'; step: JoinStepId }
  | { type: 'fail'; step: JoinStepId; message: string; kind?: 'failed' | 'waiting-host' }
  | { type: 'retry' };

export function joinReducer(s: JoinState, a: JoinAction): JoinState {
  switch (a.type) {
    case 'toggle':
      return a.media === 'mic' ? { ...s, mic: !s.mic } : { ...s, cam: !s.cam };
    case 'begin':
      // Seeds survive; the join starts at the first step.
      return { ...s, phase: 'joining', step: JOIN_STEPS[0]!.id, message: null };
    case 'step':
      return s.phase === 'joining' ? { ...s, step: a.step } : s;
    case 'fail':
      return {
        ...s,
        phase: a.kind === 'waiting-host' ? 'waiting-host' : 'failed',
        step: a.step,
        message: a.message,
      };
    case 'retry':
      // Fresh attempt: keeps toggles + entered identity, clears the error.
      return { ...s, phase: 'idle', step: null, message: null };
  }
}

function humanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- component

export interface LobbyProps {
  /** Normalised space from `/s/<space>`; null = root (space picker). */
  space: string | null;
  onJoined: (session: Session) => void;
}

export function Lobby({ space, onJoined }: LobbyProps) {
  const loc = useLocation();
  const snap = useStore();
  const [name, setName] = useState(() => store.getSettings().displayName);
  const [avatar, setAvatar] = useState<AvatarInfo>(() => store.getSettings().avatar);
  const [join, dispatch] = useReducer(joinReducer, initialJoinState);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [spaceInput, setSpaceInput] = useState('');
  const stepRef = useRef<JoinStepId>('audio');

  const mapId = useMemo(() => {
    const raw = new URLSearchParams(loc.search).get('map')?.trim() ?? '';
    const clean = raw.toLowerCase().replace(/[^a-z0-9-_]/g, '');
    return clean || config?.defaultMap || 'office';
  }, [loc.search, config]);

  // Prefetch + validate the runtime config so a missing JITSI_DOMAIN shows a
  // visible error before Join (§11). ConfigError messages carry the hint.
  useEffect(() => {
    if (!space) return;
    let on = true;
    loadRuntimeConfig()
      .then((c) => {
        if (on) {
          setConfig(c);
          setConfigError(null);
        }
      })
      .catch((e) => {
        if (on) setConfigError(e instanceof ConfigError ? e.message : humanError(e));
      });
    return () => {
      on = false;
    };
  }, [space]);

  const doJoin = async (): Promise<void> => {
    if (!space || join.phase === 'joining') return;
    dispatch({ type: 'begin' });
    store.reset(); // any join is a fresh join (§6.2)
    store.setStatus('connecting');

    const displayName = name.trim() || 'Guest';
    const normalized = normalizeSpaceName(space);
    stepRef.current = 'audio';
    let ctx: AudioContext | null = null;
    let engine: ReturnType<typeof createAudioEngine> | null = null;
    let client: Session['client'] | null = null;
    try {
      // §8.6: the Join click is the gesture — create + resume right now.
      ctx = new AudioContext();
      await ctx.resume().catch(() => undefined);

      dispatch({ type: 'step', step: 'config' });
      stepRef.current = 'config';
      const cfg = config ?? (await loadRuntimeConfig());
      setConfig(cfg);

      dispatch({ type: 'step', step: 'map' });
      stepRef.current = 'map';
      const map = await loadMap(mapId);
      store.setMap(map);

      dispatch({ type: 'step', step: 'connect' });
      stepRef.current = 'connect';
      const { createJitsiClient } = await import('../jitsi/api');
      client = createJitsiClient(cfg, store);
      const settings = store.getSettings();
      await client.join({
        space: normalized,
        displayName,
        avatar,
        map,
        mic: join.mic,
        cam: join.cam,
        audioDeviceId: settings.audioDeviceId,
        videoDeviceId: settings.videoDeviceId,
      });

      stripJwtFromUrl(cfg.auth.tokenParam); // §14
      engine = createAudioEngine(store);
      engine.start(ctx);

      onJoined({
        space: normalized,
        map,
        config: cfg,
        client,
        engine,
        join: { mic: join.mic, cam: join.cam },
      });
    } catch (e) {
      engine?.dispose();
      client?.dispose(); // fresh join on Retry (§5.1/§6.2)
      void ctx?.close().catch(() => undefined);
      const status = store.getSnapshot().status;
      const lastError = store.getSnapshot().lastError;
      store.reset();
      dispatch({
        type: 'fail',
        step: stepRef.current,
        message: lastError ?? humanError(e),
        kind: status === 'waiting-host' ? 'waiting-host' : 'failed',
      });
    }
  };

  if (!space) {
    return (
      <main className="jm-lobby">
        <form
          className="jm-lobby__card"
          onSubmit={(e) => {
            e.preventDefault();
            const n = spaceInput.trim();
            if (n) navigate(pathForSpace(n));
          }}
        >
          <h1 className="jm-lobby__title">JitsiMap</h1>
          <p className="jm-lobby__subtitle">
            Walk up to people to talk, walk away to leave the conversation. Pick a space to drop in.
          </p>
          <label className="jm-label" htmlFor="jm-space">
            Space name
          </label>
          <div className="jm-lobby__row">
            <input
              id="jm-space"
              className="jm-input"
              style={{ flex: 1 }}
              value={spaceInput}
              onChange={(e) => setSpaceInput(e.target.value)}
              placeholder="e.g. friday-standup"
              autoFocus
            />
            <button className="jm-btn jm-btn--primary" type="submit" disabled={spaceInput.trim().length === 0}>
              Go
            </button>
          </div>
        </form>
      </main>
    );
  }

  const joining = join.phase === 'joining';
  const stepIndex = JOIN_STEPS.findIndex((s) => s.id === join.step);

  return (
    <main className="jm-lobby">
      <div className="jm-lobby__card">
        <div className="jm-lobby__head">
          <h1 className="jm-lobby__title">{space}</h1>
          <button className="jm-btn" type="button" onClick={() => navigate('/')}>
            ← Spaces
          </button>
        </div>
        <p className="jm-lobby__subtitle">
          <span className="jm-lobby__map">Map: {mapId}</span>
          {config?.auth.mode === 'jwt-guest' && (
            <> · this space requires a host to open it first</>
          )}
        </p>

        <label className="jm-label" htmlFor="jm-name">
          Display name
        </label>
        <input
          id="jm-name"
          className="jm-input"
          style={{ width: '100%' }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={64}
          disabled={joining}
        />

        <span className="jm-label">Avatar</span>
        <div className="jm-emoji" role="group" aria-label="Choose an emoji avatar">
          {EMOJI_SET.map((e) => (
            <button
              key={e}
              className="jm-emoji__btn"
              type="button"
              aria-pressed={avatar.emoji === e}
              aria-label={`Avatar ${e}`}
              disabled={joining}
              onClick={() => setAvatar({ emoji: e })}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="jm-lobby__row" style={{ marginTop: 14 }}>
          <button
            className="jm-btn"
            type="button"
            aria-pressed={join.mic}
            disabled={joining}
            onClick={() => dispatch({ type: 'toggle', media: 'mic' })}
          >
            <span aria-hidden="true">{join.mic ? '🎙️' : '🔇'}</span>
            {join.mic ? 'Microphone on' : 'Join muted'}
          </button>
          <button
            className="jm-btn"
            type="button"
            aria-pressed={join.cam}
            disabled={joining}
            onClick={() => dispatch({ type: 'toggle', media: 'cam' })}
          >
            <span aria-hidden="true">{join.cam ? '📹' : '📷'}</span>
            {join.cam ? 'Camera on' : 'Camera off'}
          </button>
        </div>

        <button
          className="jm-btn jm-btn--primary jm-lobby__join"
          type="button"
          disabled={joining}
          onClick={() => void doJoin()}
        >
          {joining ? 'Joining…' : 'Join space'}
        </button>

        {joining && (
          <div role="status">
            <div className="jm-lobby__status">
              <span className="jm-spinner" aria-hidden="true" />
              {JOIN_STEPS[stepIndex]?.label ?? 'Joining…'}
            </div>
            <ul className="jm-steps">
              {JOIN_STEPS.map((s, i) => (
                <li
                  key={s.id}
                  className={
                    i < stepIndex
                      ? 'jm-steps__item jm-steps__item--done'
                      : i === stepIndex
                        ? 'jm-steps__item jm-steps__item--active'
                        : 'jm-steps__item'
                  }
                >
                  {i < stepIndex ? '✓ ' : ''}
                  {s.label.replace('…', '')}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(join.phase === 'failed' || join.phase === 'waiting-host') && (
          <div
            className={join.phase === 'waiting-host' ? 'jm-alert jm-alert--warn' : 'jm-alert'}
            role="alert"
          >
            {join.phase === 'waiting-host' ? '⏳ ' : '⚠️ '}
            {join.message ?? snap.lastError ?? 'The join failed. Check your connection and Retry.'}
            <div className="jm-alert__actions">
              <button className="jm-btn jm-btn--primary" type="button" onClick={() => dispatch({ type: 'retry' })}>
                Retry
              </button>
              <button className="jm-btn" type="button" onClick={() => navigate('/')}>
                Back to spaces
              </button>
            </div>
          </div>
        )}

        {configError && join.phase !== 'joining' && (
          <div className="jm-alert jm-alert--warn" role="alert">
            ⚠️ {configError}
          </div>
        )}
      </div>
    </main>
  );
}
