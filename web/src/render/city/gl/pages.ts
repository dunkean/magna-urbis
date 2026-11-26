/** Spatial owners of live plan and building fills. The 256 m cells retain independent packings and source
 * ordinals. CellPageMesh combines their slots in 2048 m draw pages with the original 512 m culling chunks. */
import type { Shape } from '../../../../../rust/bridge/urban';
import { sameData } from './sceneChanges';
import { buildingTowns, hasRoofs, type BuildingSet, type BuildingTown } from './buildingSet';
import type { Box, CityBuildings, CityRoofs, CityScene } from '../model/contract';
import { SpatialBins } from '../model/geometry';
import type { CityFillPlan, CityGlPolygons, CityGlTriangulation } from '../../cityGlBuild';

/** Page side (metres): 4 × 4 chunk cells of CITY_GL_CELL. */
export const CITY_GL_PAGE = 2048;
export const CITY_EDIT_CELL = 256;
export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export function gridKey(x: number, y: number): number {
  return (y + 32768) * 65536 + x + 32768;
}
function gridXY(key: number): [number, number] {
  return [(key % 65536) - 32768, Math.floor(key / 65536) - 32768];
}
export function cellBox(key: number, size = CITY_EDIT_CELL): Box {
  const [x, y] = gridXY(key);
  return { minX: x * size, minY: y * size, maxX: (x + 1) * size, maxY: (y + 1) * size };
}
export function drawPageKey(cell: number): number {
  if (cell === -1) return -1;
  const [x, y] = gridXY(cell);
  return gridKey(Math.floor(x / 8), Math.floor(y / 8));
}
export function cellsInRects(rects: readonly CellRect[]): Set<number> {
  const result = new Set<number>();
  for (const r of rects) for (let y = Math.floor(r.y0 / CITY_EDIT_CELL); y <= Math.floor(r.y1 / CITY_EDIT_CELL); y++) for (let x = Math.floor(r.x0 / CITY_EDIT_CELL); x <= Math.floor(r.x1 / CITY_EDIT_CELL); x++) result.add(gridKey(x, y));
  return result;
}
/** Query the existing spatial bins of the affected draw pages. Source ordinals of their clean cells
 * preserve painter order when an insertion shifts the ordinals in an adjacent cell. */
export function cellCandidates(bins: CityBuildings['bins'], length: number, pages?: ReadonlySet<number>, size = CITY_GL_PAGE): Iterable<number> {
  if (!pages) return Array(length).keys();
  const result = new Set<number>();
  for (const key of pages) {
    const box = cellBox(key, size);
    for (const i of bins.query(box)) result.add(i);
  }
  return [...result].sort((a, b) => a - b);
}
/** Elements split between two pauses. */
const SPLIT_STEP = 2048;

type Waterway = NonNullable<NonNullable<CityScene['layouts'][number]['structure']>['waterways']>[number];
export interface CityGlPlanPage {
  key: number;
  order: number[];
  plan: CityFillPlan;
  /** The merged elements of the page, in merged order (what `samePlanPage` compares). */
  blocks: CityScene['blocks'];
  parcels: CityScene['parcels'];
  footprint: CityScene['footprint'];
  quays: NonNullable<CityScene['quays']>;
  waterways: Waterway[];
}
export interface CityGlBuildingPage {
  key: number;
  order: number[];
  buildings: CityBuildings;
}

const owners = new WeakMap<object, number>();
/** Owner of the outer rings' bounding-box centre. Immutable geometry shares its 256 m key across edits. */
export function pageOf(shapes: readonly (Shape | undefined)[], page: number): number {
  const source = shapes.length === 1 ? shapes[0] : shapes;
  const cached = source && owners.get(source);
  if (cached !== undefined && (page === CITY_EDIT_CELL || page === CITY_GL_PAGE)) return page === CITY_EDIT_CELL ? cached : drawPageKey(cached);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const s of shapes)
    for (const p of s?.outer ?? []) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  if (!Number.isFinite(x0)) return -1;
  const owner = gridKey(Math.floor((x0 + x1) / (2 * CITY_EDIT_CELL)), Math.floor((y0 + y1) / (2 * CITY_EDIT_CELL)));
  if (source) owners.set(source, owner);
  return (Math.floor((y0 + y1) / 2 / page) + 32768) * 65536 + Math.floor((x0 + x1) / 2 / page) + 32768;
}

/** Macro page draw order is the first occurrence in the original layer sequence. An insertion can change
 * that order across page boundaries. Only its owner key is needed for this pass. */
export function planDrawOrder(plan: CityScene): Map<number, number> {
  const order = new Map<number, number>(),
    take = (shapes: readonly Shape[]) => {
      const k = pageOf(shapes, CITY_GL_PAGE);
      if (k !== -1 && !order.has(k)) order.set(k, order.size);
    };
  for (const shape of plan.footprint) take([shape]);
  for (const b of plan.blocks) take(b.ground ?? [b.shape]);
  for (const p of plan.parcels) take(p.ground ?? [p.shape]);
  for (const q of plan.quays ?? []) take([q.shape]);
  for (const l of plan.layouts) for (const w of l.structure?.waterways ?? []) take([w.shape]);
  return order;
}
export function buildingDrawOrder(set: BuildingSet): Map<number, number> {
  const order = new Map<number, number>();
  for (const town of buildingTowns(set))
    for (const b of town.set.items) {
      const k = pageOf(b.surface?.length ? b.surface : (b.footprint ?? b.building.footprint), CITY_GL_PAGE);
      if (!order.has(k)) order.set(k, order.size);
    }
  return order;
}
/** Geometry rectangles omit some colour-only edits (allocations, lot-line visibility) and canal accessories.
 * Mark the owner cells of those records as well. The retained merge shares untouched columns and records. */
export function planEditCells(a: CityScene, b: CityScene, buildingCells?: Set<number>): Set<number> {
  const cells = new Set<number>(),
    mark = (shapes: readonly Shape[]) => {
      const key = pageOf(shapes, CITY_EDIT_CELL);
      if (key !== -1) cells.add(key);
    };
  function compare<T>(old: readonly T[], next: readonly T[], shapes: (v: T) => readonly Shape[], lot?: (v: T) => Shape) {
    if (old === next) return;
    const changed = (v: T) => {
      mark(shapes(v));
      if (!lot || !buildingCells) return;
      // Allocation can affect building paint anywhere in a wide lot, beyond its fill owner.
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const p of lot(v).outer) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      if (x0 <= x1) for (const k of cellsInRects([{ x0, y0, x1, y1 }])) buildingCells.add(k);
    };
    const before = new Map(old.map((v, i) => [v, i])),
      after = new Set(next);
    let last = -1,
      crossed: Int32Array | undefined;
    for (const v of next) {
      const i = before.get(v);
      if (i === undefined) changed(v);
      else if (i < last) {
        // Reordered retained items may overlap; every crossed owner cell must refresh its order.
        crossed ??= new Int32Array(old.length + 1);
        crossed[i]++;
        crossed[last + 1]--;
      } else last = i;
    }
    let overlaps = 0;
    for (const [i, v] of old.entries()) {
      overlaps += crossed?.[i] ?? 0;
      if (overlaps || !after.has(v)) changed(v);
    }
  }
  const areas = (v: CityScene['blocks'][number] | CityScene['parcels'][number]) => v.ground ?? [v.shape];
  compare(a.blocks, b.blocks, areas);
  compare(a.parcels, b.parcels, areas, p => p.shape);
  compare(a.footprint, b.footprint, s => [s]);
  compare(a.quays ?? [], b.quays ?? [], q => [q.shape]);
  if (a.layouts !== b.layouts)
    compare(
      a.layouts.flatMap(l => l.structure?.waterways ?? []),
      b.layouts.flatMap(l => l.structure?.waterways ?? []),
      w => [w.shape],
    );
  const profile = (p: CityScene, i: number) => !!p.enclosureProfiles?.[i]?.hideLotLines;
  for (let i = 0; i < Math.max(a.layouts.length, b.layouts.length); i++)
    if (profile(a, i) !== profile(b, i)) {
      for (const v of b.blocks) if (v.layout === i) mark(areas(v));
      for (const v of b.parcels) if (v.layout === i) mark(areas(v));
    }
  return cells;
}
/** The plan split by page (elements without geometry go nowhere: the packer skips them). */
export function* splitPlanSteps(plan: CityScene, page = CITY_GL_PAGE, drawPages?: ReadonlySet<number>, onlyCells?: ReadonlySet<number>): Generator<void, Map<number, CityGlPlanPage>> {
  const pages = new Map<number, CityGlPlanPage>();
  const at = (key: number): CityGlPlanPage | undefined => {
    if (key < 0 || (onlyCells && !onlyCells.has(key)) || (drawPages && !drawPages.has(drawPageKey(key)))) return undefined;
    let p = pages.get(key);
    if (!p) pages.set(key, (p = { key, order: [], plan: undefined!, blocks: [], parcels: [], footprint: [], quays: [], waterways: [] }));
    return p;
  };
  let n = 0;
  const tick = (): boolean => ++n % SPLIT_STEP === 0;
  for (const [i, s] of plan.footprint.entries()) {
    const cell = at(pageOf([s], page));
    if (cell) {
      cell.footprint.push(s);
      cell.order.push(i);
    }
    if (tick()) yield;
  }
  for (const i of cellCandidates(plan.bins?.blocks, plan.blocks.length, onlyCells ?? drawPages, onlyCells ? page : CITY_GL_PAGE)) {
    const b = plan.blocks[i],
      cell = at(pageOf(b.ground ?? [b.shape], page));
    if (cell) {
      cell.blocks.push(b);
      cell.order.push(i);
    }
    if (tick()) yield;
  }
  for (const i of cellCandidates(plan.bins?.parcels, plan.parcels.length, onlyCells ?? drawPages, onlyCells ? page : CITY_GL_PAGE)) {
    const p = plan.parcels[i],
      cell = at(pageOf(p.ground ?? [p.shape], page));
    if (cell) {
      cell.parcels.push(p);
      cell.order.push(i);
    }
    if (tick()) yield;
  }
  for (const [i, q] of (plan.quays ?? []).entries()) {
    const cell = at(pageOf([q.shape], page));
    if (cell) {
      cell.quays.push(q);
      cell.order.push(i);
    }
  }
  const canalPage = new Map<Waterway, number>(),
    bridgeOrder = new Map<Waterway, number>();
  let bridges = 0;
  for (const layout of plan.layouts)
    for (const w of layout.structure?.waterways ?? []) {
      const key = pageOf([w.shape], page),
        cell = at(key);
      cell?.order.push(canalPage.size);
      canalPage.set(w, key);
      bridgeOrder.set(w, bridges);
      bridges += w.crossings.length + (w.locks?.length ?? 0);
      cell?.waterways.push(w);
    }
  for (const cell of pages.values()) for (const w of cell.waterways) for (let i = 0; i < w.crossings.length + (w.locks?.length ?? 0); i++) cell.order.push(bridgeOrder.get(w)! + i);
  yield;
  for (const p of pages.values()) {
    p.plan = { extent: plan.extent, enclosureProfiles: plan.enclosureProfiles, waterways: p.waterways, footprint: p.footprint, blocks: p.blocks, parcels: p.parcels, quays: p.quays };
  }
  return pages;
}

const emptyBins = new SpatialBins([]);
/** The buildings split by page: items by their surface (or footprint), roof pans and cast shadows with their item. */
export function* splitBuildingsSteps(buildings: BuildingSet | undefined, page = CITY_GL_PAGE, drawPages?: ReadonlySet<number>, onlyCells?: ReadonlySet<number>): Generator<void, Map<number, CityGlBuildingPage>> {
  const pages = new Map<number, CityGlBuildingPage>();
  if (!buildings) return pages;
  const lists = new Map<number, { town: BuildingTown; index: number }[]>(),
    roofs = hasRoofs(buildings);
  for (const town of buildingTowns(buildings)) {
    const { set } = town;
    for (const i of cellCandidates(set.bins, set.items.length, onlyCells ?? drawPages, onlyCells ? page : CITY_GL_PAGE)) {
      const b = set.items[i],
        key = pageOf(b.surface?.length ? b.surface : (b.footprint ?? b.building.footprint), page);
      if ((drawPages && !drawPages.has(drawPageKey(key))) || (onlyCells && !onlyCells.has(key))) continue;
      let list = lists.get(key);
      if (!list) lists.set(key, (list = []));
      list.push({ town, index: i });
      if ((i + 1) % SPLIT_STEP === 0) yield;
    }
  }
  for (const [key, list] of lists) {
    const items: CityBuildings['items'] = [],
      order: number[] = [],
      faces: number[] = [],
      owners: number[] = [],
      source: CityRoofs[] = [],
      shadows: CityRoofs['shadows'] = [],
      faceOrder: number[] = [];
    for (const { town, index } of list) {
      const b = town.set.items[index],
        local = items.length;
      items.push(town.parcelOffset && b.parcel !== undefined ? { ...b, parcel: b.parcel + town.parcelOffset } : b);
      order.push(town.itemOffset + index);
      const r = town.set.roofs;
      if (roofs) shadows.push(r?.shadows[index] ?? []);
      if (!r) continue;
      // Both the model and the worker merge emit pans contiguously in ascending owner order.
      let lo = 0,
        hi = r.owner.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (r.owner[mid] < index) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < r.owner.length && r.owner[k] === index; k++) {
        faces.push(k);
        source.push(r);
        owners.push(local);
        faceOrder.push(town.faceOffset + k);
      }
    }
    const sub: CityBuildings = { items, byId: new Map(), bins: emptyBins };
    if (roofs) {
      const floats = (name: 'light' | 'tone' | 'dir' | 'snow') => Float32Array.from(faces, (k, j) => source[j][name]?.[k] ?? 0);
      const bytes = (name: 'flat' | 'patch' | 'rim' | 'grain') => Uint8Array.from(faces, (k, j) => source[j][name]?.[k] ?? 0);
      sub.roofs = {
        shapes: faces.map((k, j) => source[j].shapes[k]),
        owner: Uint32Array.from(owners),
        shadows,
        light: floats('light'),
        tone: floats('tone'),
        dir: floats('dir'),
        snow: floats('snow'),
        flat: bytes('flat'),
        patch: bytes('patch'),
        rim: bytes('rim'),
        grain: bytes('grain'),
        cover: faces.map((k, j) => source[j].cover[k]),
        wall: faces.map((k, j) => source[j].wall?.[k] ?? ''),
        tint: faces.map((k, j) => source[j].tint?.[k]),
      };
    }
    pages.set(key, { key, buildings: sub, order: roofs ? order.concat(faceOrder, order) : order });
    yield;
  }
  return pages;
}
/** Same own keys, same values (the merged copies of an unchanged element). */
function shallowSame(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a),
    va = a as Record<string, unknown>,
    vb = b as Record<string, unknown>;
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (va[k] !== vb[k] && k !== 'path' && !k.endsWith('Path') && !sameData(va[k], vb[k])) return false;
  return true;
}
const sameList = <T extends object>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((x, i) => shallowSame(x, b[i]));
const sameValues = (a: ArrayLike<unknown> | undefined, b: ArrayLike<unknown> | undefined): boolean => {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !sameData(a[i], b[i])) return false;
  return true;
};

/** A page draws the same fills as before: the same elements in the same order. */
export const samePlanPage = (a: CityGlPlanPage, b: CityGlPlanPage): boolean =>
  sameList(a.footprint, b.footprint) &&
  sameList(a.blocks, b.blocks) &&
  sameList(a.parcels, b.parcels) &&
  sameValues(a.quays, b.quays) &&
  sameValues(a.waterways, b.waterways) &&
  a.blocks.every(v => !!a.plan.enclosureProfiles?.[v.layout]?.hideLotLines === !!b.plan.enclosureProfiles?.[v.layout]?.hideLotLines) &&
  a.parcels.every(v => !!a.plan.enclosureProfiles?.[v.layout]?.hideLotLines === !!b.plan.enclosureProfiles?.[v.layout]?.hideLotLines);
export function sameBuildingPage(a: CityGlBuildingPage, b: CityGlBuildingPage): boolean {
  const x = a.buildings,
    y = b.buildings;
  if (!sameList(x.items, y.items)) return false;
  const r = x.roofs,
    s = y.roofs;
  if (!r || !s) return r === s;
  return (
    sameValues(r.shapes, s.shapes) &&
    sameValues(r.owner, s.owner) &&
    sameValues(r.light, s.light) &&
    sameValues(r.tone, s.tone) &&
    sameValues(r.dir, s.dir) &&
    sameValues(r.flat, s.flat) &&
    sameValues(r.snow, s.snow) &&
    sameValues(r.patch, s.patch) &&
    sameValues(r.rim, s.rim) &&
    sameValues(r.grain, s.grain) &&
    sameValues(r.cover, s.cover) &&
    sameValues(r.wall, s.wall) &&
    sameValues(r.tint, s.tint) &&
    sameValues(r.shadows, s.shadows)
  );
}

/** Several packings as one (vertex and ring indices shifted), so the dirty pages are triangulated in one run. */
export function concatPolygons(list: readonly CityGlPolygons[]): CityGlPolygons {
  if (list.length === 1) return list[0];
  let coords = 0,
    rings = 1,
    polys = 1;
  for (const p of list) {
    coords += p.coords.length;
    rings += p.rings.length - 1;
    polys += p.polys.length - 1;
  }
  const out: CityGlPolygons = { coords: new Float32Array(coords), rings: new Uint32Array(rings), polys: new Uint32Array(polys), features: new Uint32Array(polys - 1) };
  const hidden = list.some(p => p.hiddenEdges) ? new Uint8Array(polys - 1) : undefined;
  let c = 0,
    r = 0,
    q = 0;
  for (const p of list) {
    const v0 = c / 2;
    out.coords.set(p.coords, c);
    for (let i = 1; i < p.rings.length; i++) out.rings[r + i] = p.rings[i] + v0;
    for (let i = 1; i < p.polys.length; i++) out.polys[q + i] = p.polys[i] + r;
    out.features.set(p.features, q);
    if (hidden && p.hiddenEdges) hidden.set(p.hiddenEdges, q);
    c += p.coords.length;
    r += p.rings.length - 1;
    q += p.polys.length - 1;
  }
  if (hidden) out.hiddenEdges = hidden;
  return out;
}
/** The triangulation of `concatPolygons(list)` given back per packing (vertex indices local again). */
export function splitTriangulation(t: CityGlTriangulation, list: readonly CityGlPolygons[]): CityGlTriangulation[] {
  if (list.length === 1) return [t];
  const out: CityGlTriangulation[] = [];
  let q = 0,
    ti = 0,
    li = 0,
    v0 = 0;
  for (const p of list) {
    const n = p.polys.length - 1,
      polyTriangles = t.polyTriangles.slice(q, q + n),
      polyLines = t.polyLines.slice(q, q + n);
    let nt = 0,
      nl = 0;
    for (let i = 0; i < n; i++) {
      nt += polyTriangles[i];
      nl += polyLines[i];
    }
    const triangles = t.triangles.slice(ti, ti + nt),
      lines = t.lines.slice(li, li + nl);
    if (v0) {
      for (let i = 0; i < triangles.length; i++) triangles[i] -= v0;
      for (let i = 0; i < lines.length; i++) lines[i] -= v0;
    }
    out.push({ triangles, lines, polyTriangles, polyLines });
    q += n;
    ti += nt;
    li += nl;
    v0 += p.coords.length / 2;
  }
  return out;
}
