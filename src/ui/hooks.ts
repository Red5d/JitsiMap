/**
 * React glue — store subscription (SPEC §11: React subscribes via
 * useSyncExternalStore) and History-API routing ('/', '/s/<space>', §5.1).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { store, type Snapshot } from '../store';

/** Re-render on every store snapshot change. */
export function useStore(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export interface LocationView {
  pathname: string;
  search: string;
}

/** Live window location (popstate + our own navigate() events). */
export function useLocation(): LocationView {
  const [loc, setLoc] = useState<LocationView>(() => ({
    pathname: location.pathname,
    search: location.search,
  }));
  useEffect(() => {
    const sync = (): void =>
      setLoc({ pathname: location.pathname, search: location.search });
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return loc;
}

/** pushState navigation + a popstate event so useLocation re-renders. */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** True for keyboard-activation events (Enter/Space on buttons is native; this is for div-based controls). */
export function isActivateKey(e: { key: string }): boolean {
  return e.key === 'Enter' || e.key === ' ';
}
