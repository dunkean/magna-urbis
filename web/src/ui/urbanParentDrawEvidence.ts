/** Bounded read-only counts for the SAME parents requested by this draw's
 * scheduler. Global detail cache totals are not evidence of this viewport. */
import type { ParentBounds } from '../../../rust/bridge/nativeParentOccupation';
export function currentParentDetailEvidence(input: { enabled: boolean; eligibleIds: readonly string[]; visibleIds: ReadonlySet<string>;
  status(id: string): string; sourceFingerprint: string; manifestFingerprint: string; viewport: ParentBounds; coverage: string }) {
  let ready = 0, pending = 0, failed = 0, idle = 0;
  for (const id of input.eligibleIds) {
    const status = input.status(id); if (status === 'ready') ready++; else if (status === 'pending') pending++; else if (status === 'idle') idle++; else failed++;
  }
  return { scope: 'current-draw', enabled: input.enabled, eligible: input.eligibleIds.length,
    visibleEligible: input.eligibleIds.filter(id => input.visibleIds.has(id)).length, ready, pending, failed, idle,
    sourceFingerprint: input.sourceFingerprint, manifestFingerprint: input.manifestFingerprint, viewport: [...input.viewport], coverage: input.coverage };
}
