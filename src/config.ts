/**
 * Runtime config loading + validation (SPEC §12.3, §13).
 * Fetch /config.json BEFORE any Jitsi code runs. No Jitsi domain baked in.
 */

import type { AuthMode } from './types';

export interface RuntimeConfig {
  jitsi: {
    domain: string;
    muc: string;
    websocket: string;
    bosh: string;
    appId: string | null;
  };
  auth: {
    mode: AuthMode;
    tokenParam: string;
    /** JWT for this session (jwt-token mode), from URL param. */
    token: string | null;
  };
  defaultMap: string;
}

export class ConfigError extends Error {}

interface RawConfig {
  jitsi?: {
    domain?: unknown;
    muc?: unknown;
    websocket?: unknown;
    bosh?: unknown;
    appId?: unknown;
  };
  auth?: { mode?: unknown; tokenParam?: unknown };
  defaultMap?: unknown;
}

const AUTH_MODES: readonly AuthMode[] = ['anonymous', 'jwt-guest', 'jwt-token'];

/** Space name normalisation — identical for URL and MUC room (§6.2). */
export function normalizeSpaceName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-');
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export function parseRuntimeConfig(raw: unknown, search: string = location.search): RuntimeConfig {
  const c = (raw ?? {}) as RawConfig;
  const j = c.jitsi ?? {};
  const domain = str(j.domain);
  if (!domain) {
    throw new ConfigError(
      'Jitsi domain is not configured. Set JITSI_DOMAIN (see .env.example) and redeploy the app container.',
    );
  }
  const authMode = str(c.auth?.mode) ?? 'anonymous';
  if (!AUTH_MODES.includes(authMode as AuthMode)) {
    throw new ConfigError(`Unknown auth mode "${authMode}" (expected anonymous | jwt-guest | jwt-token).`);
  }
  const tokenParam = str(c.auth?.tokenParam) ?? 'jwt';

  const params = new URLSearchParams(search);
  const token = (authMode as AuthMode) === 'jwt-token' ? params.get(tokenParam) : null;
  if ((authMode as AuthMode) === 'jwt-token' && !token) {
    throw new ConfigError(`Auth mode is jwt-token but no "?${tokenParam}=<token>" was found in the URL.`);
  }

  return {
    jitsi: {
      domain,
      muc: str(j.muc) ?? `conference.${domain}`,
      websocket: str(j.websocket) ?? `wss://${domain}/xmpp-websocket`,
      bosh: str(j.bosh) ?? `https://${domain}/http-bind`,
      appId: str(j.appId) ?? null,
    },
    auth: { mode: authMode as AuthMode, tokenParam, token },
    defaultMap: str(c.defaultMap) ?? 'office',
  };
}

let cached: RuntimeConfig | null = null;

/** Fetch and validate /config.json (§13). Cached after first success. */
export async function loadRuntimeConfig(url = '/config.json'): Promise<RuntimeConfig> {
  if (cached) return cached;
  let raw: unknown;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    throw new ConfigError(`Could not load runtime config from ${url}: ${String(e)}`);
  }
  cached = parseRuntimeConfig(raw);
  return cached;
}

/** Strip ?jwt= from the address bar after connecting (SPEC §14). */
export function stripJwtFromUrl(tokenParam: string): void {
  const url = new URL(location.href);
  if (url.searchParams.has(tokenParam)) {
    url.searchParams.delete(tokenParam);
    history.replaceState(null, '', url.toString());
  }
}
