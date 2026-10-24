/** A transport page never sets a native solve boundary. Retain one fitting
 * canonical prefix plus AT MOST one lookahead request (each <=24MiB encoded).
 * This bounds source geometry to <=48MiB encoded rather than64*24MiB; it is
 * not a measured JS heap bound. No lookahead triggers native generation. */
import type { ArchitectureRequestSource } from './architectureBatch';
import type { PlacementRequest } from './urbanArchitecture';
import { PARENT_LIMITS } from './nativeParentBudget';
interface Measurement { fits: boolean; wire: { bytes: number }; reason?: string }
export async function fillCanonicalParentPrefix(source: ArchitectureRequestSource, completed: number,
  pending: PlacementRequest[], seen: Set<string>, measure: (requests: PlacementRequest[]) => Measurement,
  cancelled: () => void): Promise<void> {
  while (pending.length < PARENT_LIMITS.parents && completed + pending.length < source.total) {
    cancelled();
    const current = measure(pending);
    // The last request may be the one bounded lookahead from the previous page.
    if (!current.fits) return;
    const limit = Math.min(PARENT_LIMITS.parents - pending.length, source.total - completed - pending.length);
    // Source maxBytes counts its JSON array; native input already owns [] and
    // adds one comma for a nonempty prefix. A two-byte conservative difference
    // is resolved by one exact lookahead, NEVER by a source-page solve boundary.
    const remaining = Math.min(PARENT_LIMITS.bytes, Math.max(2, PARENT_LIMITS.bytes - current.wire.bytes + 2 - (pending.length ? 1 : 0)));
    let page = await source.read(completed + pending.length, limit, remaining); cancelled();
    let allowed = limit;
    if (Array.isArray(page) && !page.length && pending.length) {
      // Read at most ONE full-budget request to decide the exact candidate.
      // Without this, an arbitrary source page size would alter the partition.
      page = await source.read(completed + pending.length, 1, PARENT_LIMITS.bytes); allowed = 1; cancelled();
    }
    if (!Array.isArray(page) || !page.length || page.length > allowed) throw new Error('Invalid native parent source page.');
    for (const request of page) {
      if (seen.has(request.id)) throw new Error('Duplicate native parent request.');
      seen.add(request.id); pending.push(request);
      if (!measure(pending).fits) return; // exactly one overflow lookahead, no remaining-page accumulation.
    }
  }
}
