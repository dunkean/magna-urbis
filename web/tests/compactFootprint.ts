/** Bounded completed-room exceptions to the ordinary 4.4 m / 3.05 OBB oracle. */
import type { Polygon, UrbanBuilding, World } from '../src/gen/types';
import { area, inscribed, isSimple, minAngle, minNeck, obb } from '../src/gen/geo/poly';
import { isConvex, polyInside } from '../src/gen/geo/split';
import { mpArea, tryDifference } from '../src/gen/geo/bool';

/** Final room reconstruction can retain a small whole room, including a triangular corner room. */
export function isCompactFinalFootprint(b: UrbanBuilding, owner: Polygon): boolean {
  if (b.ring || b.courtyards?.length || /courtyard|souk|ring/.test(b.arch ?? '')
    || /(?:^|-)longhouse(?:-|$)|^pueblo-room$|^roundhouse$|^wigwam$|^hogan$|^tipi$|^yurt$|^tree-(house|pod)$|^fungal-/.test(b.arch ?? '')
    || (!['house', 'rear', 'back'].includes(b.kind)
      && !(['barn', 'shed'].includes(b.kind) && ['gable', 'hip', 'flat'].includes(b.roof ?? '')))) return false;
  const p = b.poly, a = area(p);
  if (a < 12 || a > 50 || p.length < 3 || p.length > 6 || !isSimple(p) || !isConvex(p, 1e-3)) return false;
  const angle = minAngle(p);
  if (p.length === 3) {
    // A triangle has no reflex neck; its usable disk and corner angles bound the room.
    if (angle < 20 * Math.PI / 180 || 2 * inscribed(p, [], 0.02).r < 3.2) return false;
  } else {
    const quad = p.length === 4, box = obb(p);
    const short = Math.min(box.hu, box.hv), long = Math.max(box.hu, box.hv);
    if (angle < (quad ? 20 * Math.PI / 180 : Math.PI / 3) || 2 * short < 3.2
      || long / Math.max(short, 1e-6) > (quad ? 2.5 : 2.2)
      || 2 * inscribed(p, [], 0.05).r < 3.2 || (minNeck(p)?.w ?? Infinity) < 3.2) return false;
  }
  if (!polyInside(owner, p)) return false;
  const outside = tryDifference(p, owner);
  return !outside.failed && mpArea(outside.pieces) <= 1e-6;
}

/** Keep coverage.ts raw metrics intact; count only independently proved final-room exceptions. */
export function compactFootprintExceptions(w: World,
  ignoredKinds = new Set(['church', 'cathedral', 'landmark'])): { narrow: number; long: number; buildings: number[] } {
  const u = w.urban!, result = { narrow: 0, long: 0, buildings: [] as number[] };
  u.buildings.forEach((b, i) => {
    if (ignoredKinds.has(b.kind)) return;
    const box = obb(b.poly), narrow = 2 * box.hv < 4.4, long = box.hu / Math.max(1e-6, box.hv) > 3.05;
    const owner = b.parcel === undefined ? undefined : u.parcels[b.parcel];
    if ((!narrow && !long) || !owner || !isCompactFinalFootprint(b, owner.poly)) return;
    result.narrow += Number(narrow); result.long += Number(long); result.buildings.push(i);
  });
  return result;
}
