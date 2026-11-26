/**
 * Spatial pages of the GPU town's fills: the plan polygons (footprint, blocks, parcels, quays, canals) and the building
 * polygons (bodies, roof pans, cast shadows) of a merged scene split by the page of each element's centre. Each page is
 * a scene of its own (local feature numbering, its own colour tables and buffers, renderer.ts), so a local edit packs,
 * triangulates, colours and uploads again only the pages whose elements changed (`samePlanPage`, `sameBuildingPage`);
 * the other pages keep their GPU data.
 *
 * Pure data (no DOM, no WebGL). A page's scene shares the merged scene's arrays it does not split (layouts' indices,
 * enclosure profiles, streets...): fills read only the split ones.
 */
import type { Shape } from '../../../../../rust/bridge/urban';
import type { CityBuildings, CityRoofs, CityScene } from '../model/contract';
import type { CityGlPolygons, CityGlTriangulation } from '../../cityGlBuild';

/** Page side (metres): 4 × 4 chunk cells of CITY_GL_CELL. */
export const CITY_GL_PAGE = 2048;
/** Elements split between two pauses. */
const SPLIT_STEP = 2048;

type Waterway = NonNullable<NonNullable<CityScene['layouts'][number]['structure']>['waterways']>[number];
export interface CityGlPlanPage {
  key: number;
  plan: CityScene;
  /** The merged elements of the page, in merged order (what `samePlanPage` compares). */
  blocks: CityScene['blocks'];
  parcels: CityScene['parcels'];
  footprint: CityScene['footprint'];
  quays: NonNullable<CityScene['quays']>;
  waterways: Waterway[];
}
export interface CityGlBuildingPage {
  key: number;
  buildings: CityBuildings;
}

/** Page of a list of shapes: the cell of its outer rings' box centre (-1: no point). */
function pageOf(shapes: readonly (Shape | undefined)[], page: number): number {
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
  return (Math.floor((y0 + y1) / 2 / page) + 32768) * 65536 + Math.floor((x0 + x1) / 2 / page) + 32768;
}

/** The plan split by page (elements without geometry go nowhere: the packer skips them). */
export function* splitPlanSteps(plan: CityScene, page = CITY_GL_PAGE): Generator<void, Map<number, CityGlPlanPage>> {
  const pages = new Map<number, CityGlPlanPage>();
  const at = (key: number): CityGlPlanPage | undefined => {
    if (key < 0) return undefined;
    let p = pages.get(key);
    if (!p) pages.set(key, (p = { key, plan: undefined!, blocks: [], parcels: [], footprint: [], quays: [], waterways: [] }));
    return p;
  };
  let n = 0;
  const tick = (): boolean => ++n % SPLIT_STEP === 0;
  for (const s of plan.footprint) {
    at(pageOf([s], page))?.footprint.push(s);
    if (tick()) yield;
  }
  for (const b of plan.blocks) {
    at(pageOf(b.ground ?? [b.shape], page))?.blocks.push(b);
    if (tick()) yield;
  }
  for (const p of plan.parcels) {
    at(pageOf(p.ground ?? [p.shape], page))?.parcels.push(p);
    if (tick()) yield;
  }
  for (const q of plan.quays ?? []) at(pageOf([q.shape], page))?.quays.push(q);
  // A canal goes with its bridges and lock gates (packPlanSteps reads them from the layouts).
  const canalPage = new Map<Waterway, number>();
  for (const layout of plan.layouts)
    for (const w of layout.structure?.waterways ?? []) {
      const key = pageOf([w.shape], page);
      canalPage.set(w, key);
      at(key)?.waterways.push(w);
    }
  yield;
  for (const p of pages.values()) {
    const layouts = canalPage.size ? plan.layouts.map(layout => (layout.structure?.waterways?.length ? { ...layout, structure: { ...layout.structure, waterways: layout.structure.waterways.filter(w => canalPage.get(w) === p.key) } } : layout)) : plan.layouts;
    p.plan = { ...plan, layouts, footprint: p.footprint, blocks: p.blocks, parcels: p.parcels, quays: p.quays };
  }
  return pages;
}

/** The buildings split by page: items by their surface (or footprint), roof pans and cast shadows with their item. */
export function* splitBuildingsSteps(buildings: CityBuildings | undefined, page = CITY_GL_PAGE): Generator<void, Map<number, CityGlBuildingPage>> {
  const pages = new Map<number, CityGlBuildingPage>();
  const items = buildings?.items ?? [];
  if (!buildings || !items.length) return pages;
  const itemPage = new Float64Array(items.length),
    local = new Uint32Array(items.length),
    lists = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const b = items[i],
      key = pageOf(b.surface?.length ? b.surface : (b.footprint ?? b.building.footprint), page);
    itemPage[i] = key;
    let list = lists.get(key);
    if (!list) lists.set(key, (list = []));
    local[i] = list.length;
    list.push(i);
    if ((i + 1) % SPLIT_STEP === 0) yield;
  }
  const roofs = buildings.roofs,
    faces = new Map<number, number[]>();
  if (roofs)
    for (let k = 0; k < roofs.shapes.length; k++) {
      const key = itemPage[roofs.owner[k]];
      let list = faces.get(key);
      if (!list) faces.set(key, (list = []));
      list.push(k);
    }
  yield;
  for (const [key, list] of lists) {
    const sub: CityBuildings = { items: list.map(i => items[i]), byId: new Map(), bins: buildings.bins };
    if (roofs) sub.roofs = sliceRoofs(roofs, faces.get(key) ?? [], list, local);
    pages.set(key, { key, buildings: sub });
    yield;
  }
  return pages;
}
function sliceRoofs(r: CityRoofs, faces: readonly number[], items: readonly number[], local: Uint32Array): CityRoofs {
  const pick = <T extends Float32Array | Uint8Array>(a: T | undefined, make: new (n: number) => T): T | undefined => {
    if (!a) return undefined;
    const out = new make(faces.length);
    for (let j = 0; j < faces.length; j++) out[j] = a[faces[j]];
    return out;
  };
  const owner = new Uint32Array(faces.length);
  for (let j = 0; j < faces.length; j++) owner[j] = local[r.owner[faces[j]]];
  return {
    shapes: faces.map(k => r.shapes[k]),
    owner,
    light: pick(r.light, Float32Array)!,
    tone: pick(r.tone, Float32Array)!,
    dir: pick(r.dir, Float32Array)!,
    flat: pick(r.flat, Uint8Array),
    snow: pick(r.snow, Float32Array),
    patch: pick(r.patch, Uint8Array),
    rim: pick(r.rim, Uint8Array),
    grain: pick(r.grain, Uint8Array),
    cover: faces.map(k => r.cover[k]),
    wall: r.wall && faces.map(k => r.wall![k]),
    tint: r.tint && faces.map(k => r.tint![k]),
    shadows: items.map(i => r.shadows[i] ?? []),
  };
}

/** Same own keys, same values (the merged copies of an unchanged element). */
function shallowSame(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a),
    va = a as Record<string, unknown>,
    vb = b as Record<string, unknown>;
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (va[k] !== vb[k]) return false;
  return true;
}
const sameList = <T extends object>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((x, i) => shallowSame(x, b[i]));
const sameValues = (a: ArrayLike<unknown> | undefined, b: ArrayLike<unknown> | undefined): boolean => {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** A page draws the same fills as before: the same elements in the same order. */
export const samePlanPage = (a: CityGlPlanPage, b: CityGlPlanPage): boolean => sameList(a.footprint, b.footprint) && sameList(a.blocks, b.blocks) && sameList(a.parcels, b.parcels) && sameValues(a.quays, b.quays) && sameValues(a.waterways, b.waterways);
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
