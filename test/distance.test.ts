import { describe, expect, it } from 'vitest';
import {
  distanceGain,
  FULL_RADIUS_TILES,
  finalGain,
  HEAR_RADIUS_TILES,
  OFF_TIER_GAIN,
  panFor,
  spatialGain,
  zoneAudible,
} from '../src/spatial/distance';
import type { ZoneDef } from '../src/types';

const zone = (id: string, extra: Partial<ZoneDef> = {}): ZoneDef => ({
  id,
  silent: false,
  audibleFrom: [],
  stage: false,
  x: 0,
  y: 0,
  w: 320,
  h: 320,
  ...extra,
});

const zones = new Map<string, ZoneDef>(
  [zone('hall'), zone('stage', { audibleFrom: ['hall'] }), zone('breakout-1'), zone('silent', { silent: true })].map(
    (z) => [z.id, z],
  ),
);

describe('distance gain (§8.2)', () => {
  it('endpoints', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(FULL_RADIUS_TILES)).toBe(1);
    expect(distanceGain(HEAR_RADIUS_TILES)).toBe(0);
    expect(distanceGain(100)).toBe(0);
    expect(distanceGain(NaN)).toBe(0);
  });
  it('midpoint follows the specified curve, monotone decreasing', () => {
    const mid = distanceGain(5);
    expect(mid).toBeCloseTo(((8 - 5) / 6) ** 1.5, 10);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    let prev = 1;
    for (let d = 0; d <= 8; d += 0.25) {
      const g = distanceGain(d);
      expect(g).toBeLessThanOrEqual(prev + 1e-12);
      prev = g;
    }
  });
});

describe('zone model (§8.3)', () => {
  it('same zone and both zone-less use the distance model', () => {
    expect(zoneAudible(zones.get('hall'), zones.get('hall'))).toBe(true);
    expect(zoneAudible(null, null)).toBe(true);
    expect(zoneAudible(zones.get('hall'), null)).toBe(true);
    const g = spatialGain({ x: 0, y: 0, zone: null }, { x: 32, y: 0, zone: 'hall' }, zones);
    expect(g).toBe(1); // 1 tile apart, one is zone-less
  });
  it('different zones block', () => {
    expect(zoneAudible(zones.get('hall'), zones.get('breakout-1'))).toBe(false);
    expect(spatialGain({ x: 0, y: 0, zone: 'breakout-1' }, { x: 32, y: 0, zone: 'hall' }, zones)).toBe(0);
  });
  it('audibleFrom is directed: hall hears stage, stage does not hear hall', () => {
    expect(zoneAudible(zones.get('stage'), zones.get('hall'))).toBe(true);
    expect(zoneAudible(zones.get('hall'), zones.get('stage'))).toBe(false);
  });
  it('silent zone occupants are never audible', () => {
    expect(zoneAudible(zones.get('silent'), zones.get('hall'))).toBe(false);
    expect(zoneAudible(zones.get('silent'), zones.get('silent'))).toBe(false);
    expect(spatialGain({ x: 0, y: 0, zone: 'hall' }, { x: 0, y: 0, zone: 'silent' }, zones)).toBe(0);
  });
});

describe('pan (§8.3)', () => {
  it('clamps to [-0.8, 0.8] and follows left/right', () => {
    expect(panFor(640, 640)).toBe(0);
    expect(panFor(640 + 32 * 4, 640)).toBeCloseTo(0.5, 10);
    expect(panFor(640 + 32 * 100, 640)).toBe(0.8);
    expect(panFor(640 - 32 * 100, 640)).toBe(-0.8);
  });
});

describe('gain multiplication chain (§8.5)', () => {
  const base = {
    tier: 'full' as const,
    spatial: 0.5,
    volume: 1,
    mutedForMe: false,
    micMuted: false,
    master: 1,
    deafened: false,
  };
  it('multiplies spatial × volume × master', () => {
    expect(finalGain(base)).toBe(0.5);
    expect(finalGain({ ...base, volume: 2, master: 0.5 })).toBe(0.5);
  });
  it('mute-other, mic mute and deafen zero out', () => {
    expect(finalGain({ ...base, mutedForMe: true })).toBe(0);
    expect(finalGain({ ...base, micMuted: true })).toBe(0);
    expect(finalGain({ ...base, deafened: true })).toBe(0);
  });
  it('off tier → flat 0.9 for audible participants', () => {
    expect(finalGain({ ...base, tier: 'off', spatial: 0 })).toBe(OFF_TIER_GAIN);
    expect(finalGain({ ...base, tier: 'off', spatial: 0, deafened: true })).toBe(0);
  });
});
