/**
 * App shell — SPEC §5.1/§11. History routing ('/', '/s/<space>', §5.1;
 * unknown routes fall back to the lobby): root → space picker; a space route
 * shows the Lobby, and on a successful join the Session (§6.2 bundle) lands in
 * App state → Room. Leave tears the session down (audio engine + client
 * disconnect + store reset) and returns to '/'; navigating away from a live
 * session (back/forward) performs the same teardown. Retry re-runs a fresh
 * join with the same parameters (§6.2: any rejoin is a fresh join).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizeSpaceName, stripJwtFromUrl } from './config';
import { store } from './store';
import { createAudioEngine } from './spatial/audioEngine';
import { navigate, useLocation } from './ui/hooks';
import { parseRoute } from './ui/util';
import { Lobby } from './ui/Lobby';
import { Room } from './ui/Room';
import type { Session } from './ui/session';

export function App() {
  const loc = useLocation();
  const route = parseRoute(loc.pathname); // notfound → treated as root (§5.1)
  const space = route.kind === 'space' ? normalizeSpaceName(route.space) : null;

  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const teardown = useCallback((s: Session) => {
    s.engine.dispose();
    s.client.dispose(); // stop tracks → conference.leave → disconnect (§5.1)
    store.reset();
  }, []);

  // Navigated away (back/forward/URL change) while a session is live → leave.
  useEffect(() => {
    const s = sessionRef.current;
    if (s && space !== s.space) {
      teardown(s);
      setSession(null);
    }
  }, [space, teardown]);

  const handleLeave = useCallback((): void => {
    const s = sessionRef.current;
    setSession(null);
    if (s) teardown(s);
    navigate('/');
  }, [teardown]);

  // §5.1 Retry: fresh join attempt with the session's parameters.
  const handleRetry = useCallback((): void => {
    const s = sessionRef.current;
    if (!s) return;
    s.engine.dispose();
    store.setStatus('connecting', 'Rejoining…');
    void (async () => {
      try {
        await s.client.leave().catch(() => undefined); // old client fully gone
        const ctx = new AudioContext();
        await ctx.resume().catch(() => undefined); // Retry click = the gesture (§8.6)
        const { createJitsiClient } = await import('./jitsi/api');
        const client = createJitsiClient(s.config, store);
        const settings = store.getSettings();
        await client.join({
          space: s.space,
          displayName: settings.displayName || 'Guest',
          avatar: settings.avatar,
          map: s.map,
          mic: s.join.mic,
          cam: s.join.cam,
          audioDeviceId: settings.audioDeviceId,
          videoDeviceId: settings.videoDeviceId,
        });
        stripJwtFromUrl(s.config.auth.tokenParam); // §14
        const engine = createAudioEngine(store);
        engine.start(ctx);
        setSession({
          space: s.space,
          map: s.map,
          config: s.config,
          client,
          engine,
          join: { ...s.join },
        });
      } catch (e) {
        store.setStatus('failed', e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div className="jm-app">
      {space !== null && session !== null && session.space === space ? (
        <Room session={session} onLeave={handleLeave} onRetry={handleRetry} />
      ) : (
        <Lobby space={space} onJoined={setSession} />
      )}
    </div>
  );
}
