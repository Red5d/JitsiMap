/**
 * Track helpers — OVERWRITE this stub: implemented by the src/jitsi/ adapter
 * work package (SPEC §6.4/§6.5). These are the only sanctioned ways for code
 * outside src/jitsi/ to touch lib track objects.
 */

/** Casts an opaque store track back to its MediaStream (remote audio → Web Audio, §8.1). */
export function getTrackStream(_track: unknown): MediaStream | null {
  throw new Error('jitsi adapter not implemented yet');
}

export function getTrackVideoType(_track: unknown): 'camera' | 'desktop' | null {
  throw new Error('jitsi adapter not implemented yet');
}
