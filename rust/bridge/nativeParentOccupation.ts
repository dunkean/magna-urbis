/** O(retained city leaves), no plans/archives/DTO graph. Land and roofs are
 * distinct native surfaces, never roofs disguised as land neighbours. */
import type { Point, Surface } from './housesContract';
import type { PlacementRequest } from './urbanArchitecture';
import type { NativeParentPlan, PriorParentOccupation } from './nativeParentContract';
import { parentIdentity } from './nativeParentContract';
export type ParentBounds = [number, number, number, number];
export interface ParentOccupationLeaf { ownerId: string; part: number; kind: 'land' | 'roof'; surface: Surface; bounds: ParentBounds }
const emptyBounds = (): ParentBounds => [Infinity, Infinity, -Infinity, -Infinity];
function point(b: ParentBounds, p: Point, margin = 0): void {
  if (![p.x, p.y, margin].every(Number.isFinite) || margin < 0) throw new Error('Invalid parent occupation coordinate.');
  b[0] = Math.min(b[0], p.x - margin); b[1] = Math.min(b[1], p.y - margin);
  b[2] = Math.max(b[2], p.x + margin); b[3] = Math.max(b[3], p.y + margin);
}
export function surfaceBounds(s: Surface): ParentBounds {
  const b = emptyBounds(); for (const polygon of s) for (const ring of [polygon.outer, ...polygon.holes]) for (const p of ring) point(b, p); return b;
}
export const parentBoundsOverlap = (a: ParentBounds, b: ParentBounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
/** Native land is constrained to site rights; access joins must also be included.
 * One envelope PER request, not one envelope spanning a batch of distant sites. */
export function parentRequestBounds(r: PlacementRequest): ParentBounds {
  const b = emptyBounds();
  for (const s of [r.cadastral, r.buildable, r.reserves, r.roof_domain, r.placement_hint]) if (s)
    for (const polygon of s) for (const ring of [polygon.outer, ...polygon.holes]) for (const p of ring) point(b, p);
  for (const a of r.accesses) for (const p of a.segment) point(b, p, a.width_m / 2);
  for (const segment of r.party_boundaries) for (const p of segment) point(b, p);
  for (const c of r.native_minimum_candidates ?? []) { point(b, c.transform.origin); point(b, c.contact); }
  if (!b.every(Number.isFinite)) throw new Error('Native parent request has no complete finite envelope.'); return b;
}
export function nativeParentSurfaces(p: NativeParentPlan): PriorParentOccupation {
  if (p.kind === 'single') { const b = p.building; return { land_parts: [b.footprint, b.courtyards, b.circulation,
    ...b.structural_features.map(f => f.surface)], roof_parts: [b.roof_footprint] }; }
  const a = p.assembly;
  return { land_parts: [...a.members.flatMap(m => [m.plan.footprint, m.plan.courtyards, ...m.plan.structural_features.map(f => f.surface)]),
    ...a.circulation.branches.flatMap(branch => [branch.path, branch.native_passage]), ...a.shared_context.map(f => f.surface)],
    roof_parts: a.members.map(m => m.plan.roof_footprint) };
}
export function nativeParentLeaves(p: NativeParentPlan): ParentOccupationLeaf[] {
  const ownerId = parentIdentity(p).id, parts = nativeParentSurfaces(p), leaves: ParentOccupationLeaf[] = [];
  for (const [kind, surfaces] of [['land', parts.land_parts], ['roof', parts.roof_parts]] as const)
    for (let part = 0; part < surfaces.length; part++) {
      const surface = surfaces[part]; if (!surface.length) continue;
      const bounds = surfaceBounds(surface); if (!bounds.every(Number.isFinite)) throw new Error('Invalid parent occupation surface.');
      leaves.push({ ownerId, part, kind, surface, bounds });
    }
  return leaves;
}
function keys(b: ParentBounds): string[] | undefined {
  const x0 = Math.floor(b[0] / 64), y0 = Math.floor(b[1] / 64), x1 = Math.floor(b[2] / 64), y1 = Math.floor(b[3] / 64);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return undefined;
  const out: string[] = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(`${x},${y}`); return out;
}
function freezeSurface(s: Surface): void {
  for (const poly of s) { for (const ring of [poly.outer, ...poly.holes]) { ring.forEach(Object.freeze); Object.freeze(ring); }
    Object.freeze(poly.holes); Object.freeze(poly); } Object.freeze(s);
}
export class NativeParentOccupationIndex {
  private all: ParentOccupationLeaf[] = []; private wide: ParentOccupationLeaf[] = [];
  private cells = new Map<string, ParentOccupationLeaf[]>(); private owners = new Set<string>(); private members = new Set<string>();
  get leafCount(): number { return this.all.length; }
  /** Validate all identities first: a rejected duplicate never partially installs context. */
  append(plans: readonly NativeParentPlan[]): void {
    const parents = new Set<string>(), members = new Set<string>();
    const entries: ParentOccupationLeaf[] = [];
    for (const p of plans) {
      const id = parentIdentity(p).id;
      if (parents.has(id) || this.owners.has(id)) throw new Error('Duplicate native parent across batches.'); parents.add(id);
      for (const id of p.kind === 'single' ? [p.building.id] : p.assembly.members.map(m => m.plan.id)) {
        if (members.has(id) || this.members.has(id)) throw new Error('Duplicate native member across parents.'); members.add(id);
      }
      entries.push(...nativeParentLeaves(p));
    }
    for (const e of entries) {
      freezeSurface(e.surface); this.positions.set(e, this.all.length); this.all.push(e); const cells = keys(e.bounds);
      if (!cells) { this.wide.push(e); continue; }
      for (const key of cells) { const list = this.cells.get(key); if (list) list.push(e); else this.cells.set(key, [e]); }
    }
    parents.forEach(id => this.owners.add(id)); members.forEach(id => this.members.add(id));
  }
  query(request: PlacementRequest): ParentOccupationLeaf[] {
    const b = parentRequestBounds(request), hit = new Set<ParentOccupationLeaf>(), cells = keys(b);
    for (const e of cells ? this.wide : this.all) if (parentBoundsOverlap(b, e.bounds)) hit.add(e);
    for (const key of cells ?? []) for (const e of this.cells.get(key) ?? []) if (parentBoundsOverlap(b, e.bounds)) hit.add(e);
    // Stable native insertion order, independent of tile enumeration and viewport.
    return [...hit].sort((a, b) => this.order(a) - this.order(b));
  }
  ordered(entries: Iterable<ParentOccupationLeaf>): ParentOccupationLeaf[] { return [...entries].sort((a, b) => this.order(a) - this.order(b)); }
  private positions = new WeakMap<ParentOccupationLeaf, number>();
  private order(e: ParentOccupationLeaf): number { let n = this.positions.get(e); if (n === undefined) {
    // Populate once per inserted leaf rather than scanning the entire city per query.
    for (let i = this.indexed; i < this.all.length; i++) this.positions.set(this.all[i], i); this.indexed = this.all.length; n = this.positions.get(e)!;
  } return n; }
  private indexed = 0;
}
