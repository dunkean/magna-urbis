import { layoutStreetPavements } from '../../roadPavement';
import type { CityScene } from '../model/contract';
import type { YardBoundary } from '../../cityLotEnclosures';

/** Compare plain render inputs across worker copies, including removed properties. */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameData(x, b[i]));
  const keys = Object.keys(a),
    x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y, k) && sameData(x[k], y[k]));
}
export function changedStreets(a: CityScene, b: CityScene): number[] {
  if (a === b) return [];
  const stable = b.layouts.map((l, i) => {
    const old = a.layouts[i];
    return old && old.streets === l.streets && old.programme?.population === l.programme?.population && sameData(layoutStreetPavements(old), layoutStreetPavements(l));
  });
  if (a.streets.length === b.streets.length && stable.length === a.layouts.length && stable.length && stable.every(Boolean)) return [];
  const changed: number[] = [];
  for (const [i, s] of b.streets.entries()) {
    const p = a.streets[i];
    if (!p) {
      changed.push(i);
      continue;
    }
    const l = b.layouts[s.layout],
      old = a.layouts[p.layout];
    if (s.layout === p.layout && s.index === p.index && stable[s.layout]) continue;
    if (
      p.width !== s.width ||
      p.rank !== s.rank ||
      p.role !== s.role ||
      !sameData(p.street.path, s.street.path) ||
      !sameData(p.joined, s.joined) ||
      old?.programme?.population !== l?.programme?.population ||
      layoutStreetPavements(l)?.[s.index] !== layoutStreetPavements(old)?.[p.index]
    )
      changed.push(i);
  }
  return changed;
}
function occupiedAttachments(plan: CityScene): string[] {
  const ids: string[] = [];
  for (const p of plan.parcels) if (p.allocation && !p.allocation.role?.startsWith('open.')) for (const tag of p.source.provenance ?? []) if (tag.startsWith('lean-to:')) ids.push(p.layout + '/' + tag);
  return ids;
}
export function sameWalls(a: CityScene, b: CityScene): boolean {
  if (a === b) return true;
  if (a.walls.length !== b.walls.length) return false;
  if (!a.walls.length) return true;
  if (!sameData(a.walls, b.walls) || a.layouts.length !== b.layouts.length || !a.layouts.every((l, i) => sameData(l.enclosures, b.layouts[i].enclosures))) return false;
  if (a.parcels === b.parcels || !b.layouts.some(l => l.enclosures?.some(e => e.attached?.length))) return true;
  return sameData(occupiedAttachments(a), occupiedAttachments(b));
}
export function sameYards(a: readonly (readonly YardBoundary[] | undefined)[], b: readonly (readonly YardBoundary[] | undefined)[]): boolean {
  return a === b || (a.length === b.length && a.every((list, i) => sameData(list, b[i])));
}
