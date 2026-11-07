/** Shared urban eligibility predicate; the permission geometry lives in Rust landuse. */
import type { UrbanLayer } from '../types';

export function naturalGroundEligible(u: UrbanLayer): boolean {
  return !u.renderHints?.openGround && !u.renderHints?.stilts && !u.phases.some((p) => p.walled)
    && !u.walls?.some((w) => !w.role || w.role === 'town' || w.role === 'outer')
    && !u.lines?.some((l) => l.closed && ['hedge', 'palisade', 'turf-wall', 'kraal-fence', 'albarrada'].includes(l.kind));
}
