import { describe, expect, it } from 'vitest';
import {
  decodeMessage,
  encodeAvatar,
  encodeEmote,
  encodeHello,
  encodePose,
  encodeState,
  encodeStateRequest,
  isJitsiMapMessage,
  MAX_NAME_LEN,
  type ValidationCtx,
} from '../src/protocol';
import type { Pose } from '../src/types';

const ctx: ValidationCtx = { widthPx: 1280, heightPx: 960, zoneIds: new Set(['hall', 'stage', 'silent']) };
const pose: Pose = { x: 100, y: 200, dir: 90, zone: 'hall', moving: true };

describe('protocol round-trip (§7.2)', () => {
  it('pose', () => {
    expect(decodeMessage(encodePose(pose), ctx)).toEqual({ type: 'pose', pose });
  });
  it('hello', () => {
    expect(decodeMessage(encodeHello('Ann', { emoji: '🧙' }, 'stage'), ctx)).toEqual({
      type: 'hello',
      name: 'Ann',
      avatar: { emoji: '🧙' },
      zone: 'stage',
    });
  });
  it('state-request', () => {
    expect(decodeMessage(encodeStateRequest(), ctx)).toEqual({ type: 'state-request' });
  });
  it('state', () => {
    const m = encodeState('Bob', { emoji: '🐱' }, pose);
    expect(decodeMessage(m, ctx)).toEqual({
      type: 'state',
      name: 'Bob',
      avatar: { emoji: '🐱' },
      pose: { ...pose, moving: false },
    });
  });
  it('emote', () => {
    expect(decodeMessage(encodeEmote('🔥'), ctx)).toEqual({ type: 'emote', emoji: '🔥' });
  });
  it('avatar', () => {
    expect(decodeMessage(encodeAvatar({ emoji: '🙂', imageUrl: 'https://x.dev/a.png' }), ctx)).toEqual({
      type: 'avatar',
      avatar: { emoji: '🙂', imageUrl: 'https://x.dev/a.png' },
    });
  });
  it('stays under 500 bytes', () => {
    const longName = 'x'.repeat(MAX_NAME_LEN);
    const size = JSON.stringify(encodeState(longName, { emoji: '🧙' }, pose)).length;
    expect(size).toBeLessThan(500);
  });
});

describe('foreign payload tolerance (§7.2)', () => {
  it('ignores stock Meet shapes and junk', () => {
    for (const raw of [
      null,
      undefined,
      'string',
      42,
      {},
      { ns: 'other', v: 1, type: 'pose' },
      { ns: 'jitsimap', v: 2, type: 'pose', x: 1, y: 1 },
      { ns: 'jitsimap', v: 1, type: 'unknown-type' },
      { ns: 'jitsimap', v: 1 },
      { 'jwt-token': 'abc' }, // stock Meet endpoint message
    ]) {
      expect(decodeMessage(raw, ctx)).toBeNull();
    }
    expect(isJitsiMapMessage({ ns: 'jitsimap', v: 1, type: 'pose' })).toBe(true);
    expect(isJitsiMapMessage({ type: 'pose' })).toBe(false);
  });
});

describe('validation (§7.3)', () => {
  it('clamps x/y to map bounds', () => {
    const m = decodeMessage(
      { ns: 'jitsimap', v: 1, type: 'pose', ts: 1, x: -50, y: 99999, dir: 0, zone: null, moving: false },
      ctx,
    );
    expect(m).toEqual({ type: 'pose', pose: { x: 0, y: 960, dir: 0, zone: null, moving: false } });
  });
  it('drops non-finite coordinates', () => {
    for (const bad of [NaN, Infinity, '12', null]) {
      expect(
        decodeMessage(
          { ns: 'jitsimap', v: 1, type: 'pose', ts: 1, x: bad, y: 5, dir: 0, zone: null, moving: false },
          ctx,
        ),
      ).toBeNull();
    }
  });
  it('truncates names to 64 chars', () => {
    const m = decodeMessage(
      { ns: 'jitsimap', v: 1, type: 'hello', ts: 1, name: 'y'.repeat(100), avatar: '🐱', zone: null },
      ctx,
    );
    expect(m && m.type === 'hello' && m.name.length).toBe(MAX_NAME_LEN);
  });
  it('rejects oversized emoji and non-https avatar URLs', () => {
    const ctx2: ValidationCtx = ctx;
    const longEmoji = '🧙'.repeat(9);
    expect(decodeMessage(encodeHello('A', { emoji: longEmoji }, null), ctx2)).toBeNull();
    expect(
      decodeMessage({ ns: 'jitsimap', v: 1, type: 'avatar', ts: 1, avatar: 'http://evil.dev/a.png' }, ctx2),
    ).toBeNull();
    expect(
      decodeMessage({ ns: 'jitsimap', v: 1, type: 'avatar', ts: 1, avatar: 'https://ok.dev/a.png' }, ctx2),
    ).not.toBeNull();
    expect(
      decodeMessage({ ns: 'jitsimap', v: 1, type: 'avatar', ts: 1, avatar: `https://ok.dev/${'a'.repeat(512)}` }, ctx2),
    ).toBeNull();
  });
  it('drops unknown zone ids to null', () => {
    const m = decodeMessage(
      { ns: 'jitsimap', v: 1, type: 'pose', ts: 1, x: 1, y: 2, dir: 0, zone: 'not-a-zone', moving: true },
      ctx,
    );
    expect(m && m.type === 'pose' && m.pose.zone).toBeNull();
    const h = decodeMessage(encodeHello('A', { emoji: '🐱' }, 'hall'), ctx);
    expect(h && h.type === 'hello' && h.zone).toBe('hall');
  });
});
