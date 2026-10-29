// Runtime config parsing (SPEC §11/§12.3): derived defaults, the internal
// XMPP domain override (docker-jitsi-meet stacks), and the hard failure when
// no domain is configured.

import { describe, expect, it } from 'vitest';

import { ConfigError, parseRuntimeConfig } from '../src/config';

const base = { jitsi: { domain: 'meet.example.org' } };

describe('parseRuntimeConfig', () => {
  it('derives muc/websocket/bosh from the domain and falls back xmppDomain to it', () => {
    const c = parseRuntimeConfig(base, '');
    expect(c.jitsi.xmppDomain).toBe('meet.example.org');
    expect(c.jitsi.muc).toBe('conference.meet.example.org');
    expect(c.jitsi.websocket).toBe('wss://meet.example.org/xmpp-websocket');
    expect(c.jitsi.bosh).toBe('https://meet.example.org/http-bind');
    expect(c.auth.mode).toBe('anonymous');
    expect(c.defaultMap).toBe('office');
  });

  it('honors the internal XMPP/MUC domains of docker-jitsi-meet stacks', () => {
    const c = parseRuntimeConfig(
      {
        jitsi: {
          domain: 'localhost',
          xmppDomain: 'meet.jitsi',
          muc: 'muc.meet.jitsi',
          websocket: 'wss://localhost:8443/xmpp-websocket',
          bosh: 'https://localhost:8443/http-bind',
        },
      },
      '',
    );
    expect(c.jitsi.xmppDomain).toBe('meet.jitsi');
    expect(c.jitsi.muc).toBe('muc.meet.jitsi');
    expect(c.jitsi.websocket).toBe('wss://localhost:8443/xmpp-websocket');
  });

  it('throws a ConfigError with a deployment hint when the domain is missing', () => {
    expect(() => parseRuntimeConfig({ jitsi: {} }, '')).toThrow(ConfigError);
    expect(() => parseRuntimeConfig({}, '')).toThrow(/JITSI_DOMAIN/);
  });

  it('picks up the jwt from the URL in jwt-token mode', () => {
    const c = parseRuntimeConfig({ ...base, auth: { mode: 'jwt-token' } }, '?jwt=abc.def.ghi');
    expect(c.auth.mode).toBe('jwt-token');
    expect(c.auth.token).toBe('abc.def.ghi');
  });
});
