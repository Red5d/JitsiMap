/**
 * JitsiClient implementation — OVERWRITE this stub: implemented by the
 * src/jitsi/ adapter work package (SPEC §6/§7). See api.ts for the contract.
 */

import type { JitsiClient } from './api';
import type { RuntimeConfig } from '../config';
import type { Store } from '../store';

export function createJitsiClient(_config: RuntimeConfig, _store: Store): JitsiClient {
  throw new Error('jitsi adapter not implemented yet');
}
