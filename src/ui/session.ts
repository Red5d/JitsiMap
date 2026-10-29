/**
 * The joined-session bundle: created by the Lobby's join sequence
 * (SPEC §5.1/§6.2/§13 — config → map → client → audio context) and consumed
 * by the Room for its whole lifetime. Leave disposes engine + client and
 * drops the session (App returns to the lobby).
 */

import type { RuntimeConfig } from '../config';
import type { GameMapData } from '../game/maps';
import type { JitsiClient } from '../jitsi/api';
import type { AudioEngine } from '../spatial/audioEngine';

export interface Session {
  /** Normalised space name (MUC room id, §6.2). */
  space: string;
  /** Map the room runs on (already loaded + set in the store). */
  map: GameMapData;
  config: RuntimeConfig;
  client: JitsiClient;
  engine: AudioEngine;
  /** Lobby initial media choices (§5.1) — seed for the Room's mic/cam toggles. */
  join: { mic: boolean; cam: boolean };
}
