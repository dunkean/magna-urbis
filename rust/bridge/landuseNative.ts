/** Rust landuse. Only the raster planes and World properties consumed by this stage cross the bridge. */
import type { LandUseLayer, PolyH, Polygon, TerrainLayer, UrbanLayer, Vec2, World } from '../../web/src/gen/types';
import type { Rng } from '../../web/src/gen/core/rng';
import { biomeName } from '../../web/src/gen/biomes';
import { executionRuntime, type ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { nativeRequest } from './nativeEngine';
import { loadCoreWasm, synchronousCoreWasm, recoverCoreWasm, onCoreWasmReset } from './wasmRuntime';
import type { GroundAppearance } from '../../web/src/gen/landuse/groundAppearance';

export interface Region { outer: Polygon; holes: Polygon[] }
export interface FieldNetExtras { ways: Polygon[]; headlands: Polygon[] }
export interface RuralPlan {
  footprint: PolyH[]; population: number; farmsteads?: boolean; naturalForest?: Float32Array;
  settlementFootprints?: Record<string, PolyH[]>; streetAlignedHomes?: boolean; denserSmallholdings?: boolean;
  fieldEnclosure?: number; fieldMaterial?: 'hedge' | 'wall' | 'fence'; outbuildings?: number;
  /** Cultivated budget = settled people x base ha per head x (1 + cropSurplus); 0 = subsistence (Rust default 0.2). */
  cropSurplus?: number;
}
export interface SoilGrid { w: number; h: number; cell: number; x0: number; y0: number; data: Float32Array }
export type RuralSoil = ((x: number, y: number) => number) & { landuseGrid?: SoilGrid };
type Output = { layer: LandUseLayer; stats: Record<string, number> };
type Wasm = {
  landuse_stage(header: string, planes: Uint8Array): Uint8Array;
  landuse_vectorize(ind: Float32Array, w: number, h: number, cell: number, minArea: number, x0: number, y0: number, x1: number, y1: number): Uint8Array;
  landuse_farm(request: string): string;
};

/** Exactly the former rural.ts vectorize signature. Always synchronous, including on the main thread.
 * Requires prior asynchronous loadCoreWasm(). */
export function vectorizeRegions(ind: Float32Array, w: number, h: number, cell: number, minArea: number,
  win: { x0: number; y0: number; x1: number; y1: number }): Region[] {
  return containGround(() => {
    const wasm = synchronousCoreWasm() as unknown as Wasm;
    return decodeLanduse<Region[]>(wasm.landuse_vectorize(ind, w, h, cell, minArea, win.x0, win.y0, win.x1, win.y1));
  });
}

const urban = (u?: UrbanLayer, appearance = false): unknown => {
  if (!u) return undefined;
  const parcelOwners = appearance ? new Map(u.parcels.map((p, i) => [p.poly, i] as const)) : undefined;
  return ({ population: u.population, archetype: u.archetype,
  renderHints: u.renderHints, phases: u.phases.map(p => ({ walled: p.walled })),
  walls: u.walls?.map(w => ({ role: w.role, path: w.path, closed: w.closed, thickness: w.thickness })),
  lines: u.lines?.map(l => ({ kind: l.kind, closed: l.closed })),
  footprintH: u.footprintH, ruralReserve: u.ruralReserve, buildings: u.buildings.map(b => ({ poly: b.poly })), masses: u.masses,
  parcels: u.parcels.map(p => ({ poly: p.poly, use: p.use, block: p.block })), backLand: u.backLand,
  backLandOwners: parcelOwners && u.backLand.map(b => parcelOwners.get(b.outer) ?? -1),
  squares: u.squares, blocks: u.blocks, blockInfo: u.blockInfo.map(b => ({ kind: b.kind, zone: appearance ? b.zone : undefined, culture: appearance ? b.culture : undefined })),
  landmarks: u.landmarks.map(l => ({ kind: l.kind, poly: l.poly })), water: u.water,
  streets: u.streets.map(s => ({ path: s.path, width: s.width, widths: s.widths, role: s.role, private: s.private })),
  macro: u.macro && { quarters: u.macro.quarters.map(q => ({ id: q.id, kind: q.kind, district: q.district, pts: q.pts, lab: q.lab })) },
  openEdgeGround: u.openEdgeGround, culture: appearance ? u.culture : undefined, morphology: appearance ? u.morphology : undefined,
  sites: appearance ? u.sites?.map(s => ({ role: s.role, lot: s.lot })) : undefined,
});
};
function geometry(w: World, appearance = false): unknown {
  return { site: w.site && { center: w.site.center, reserveRadius: w.site.reserveRadius }, urban: urban(w.urban, appearance),
    settlements: w.settlements?.map(s => ({ key: s.key, main: s.main, index: s.index, population: s.population,
      center: s.center, culture: s.culture, detail: s.detail, extent: s.extent, urban: urban(s.urban, appearance) })),
    megaDetail: w.megaDetail && Object.fromEntries(Object.entries(w.megaDetail).map(([k, u]) => [k, urban(u, appearance)])),
    roads: w.roads?.map(r => ({ path: r.path, width: r.width, kind: r.kind })) ?? [],
    terrain: { coastline: w.terrain.coastline, islands: w.terrain.islands, lakes: w.terrain.lakes,
      rivers: w.terrain.rivers.map(r => ({ path: r.path, width: r.width, main: r.main, edgeFed: r.edgeFed })) },
  };
}
type Plane = readonly [string, Float32Array | Uint8Array];
/** Shared geometry framing for stage and standalone tools; all coordinates remain f64. */
export function landuseRequest(header: unknown, arrays: Plane[] = []): { header: string; planes: Uint8Array<ArrayBuffer> } {
  let offset = 0;
  const planes = arrays.map(([name, a]) => {
    const plane = { name, offset, length: a.length, kind: a instanceof Uint8Array ? 'u8' : 'f32' };
    offset += Math.ceil(a.byteLength / 8) * 8; return plane;
  });
  const rings: { offset: number; points: (Vec2 | [number, number])[]; xy: boolean }[] = [];
  const numeric: { offset: number; values: number[] }[] = [];
  const json = JSON.stringify(arrays.length ? { ...header as object, planes } : header, (key, v: unknown) => {
    if (['width', 'widths'].includes(key) && Array.isArray(v) && v.length && v.every(Number.isFinite)) {
      const start = offset; offset += v.length * 8;
      numeric.push({ offset: start, values: v }); return { $f64: [start, v.length] };
    }
    if (!Array.isArray(v) || !v.length) return v;
    const first = v[0] as unknown;
    const xy = typeof first === 'object' && first !== null && !Array.isArray(first)
      && Object.keys(first).length === 2 && 'x' in first && 'y' in first;
    const uv = Array.isArray(first) && first.length === 2;
    if (!xy && !uv) return v;
    const points = v as (Vec2 | [number, number])[];
    if (!points.every(p => xy ? !Array.isArray(p) && Object.keys(p).length === 2 && Number.isFinite(p.x) && Number.isFinite(p.y)
      : Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return v;
    const start = offset; offset += points.length * 16;
    rings.push({ offset: start, points, xy });
    return { [xy ? '$xy' : '$uv']: [start, points.length] };
  });
  const bytes = new Uint8Array(offset), view = new DataView(bytes.buffer);
  arrays.forEach(([, a], i) => bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), planes[i].offset));
  for (const plane of numeric) plane.values.forEach((v, i) => view.setFloat64(plane.offset + i * 8, v, true));
  for (const ring of rings) {
    let offset = ring.offset;
    for (const point of ring.points) {
      view.setFloat64(offset, (ring.xy ? (point as Vec2).x : (point as [number, number])[0]), true);
      view.setFloat64(offset + 8, (ring.xy ? (point as Vec2).y : (point as [number, number])[1]), true);
      offset += 16;
    }
  }
  return { header: json, planes: bytes };
}
const request = landuseRequest;
const decoder = new TextDecoder();
export function decodeLanduse<T>(bytes: Uint8Array): T {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = 4 + view.getUint32(0, true);
  if (end > bytes.byteLength) throw new Error('Incomplete landuse header');
  const value: unknown = JSON.parse(decoder.decode(bytes.subarray(4, end)));
  const expand = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = expand(value[i]); return value; }
    const object = value as Record<string, unknown>;
    const key = '$xy' in object ? '$xy' : '$uv' in object ? '$uv' : undefined;
    if (key && Object.keys(object).length === 1) {
      const [offset, count] = object[key] as number[];
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(count) || offset < 0 || count < 0 || end + offset + count * 16 > bytes.byteLength)
        throw new Error('Invalid landuse coordinate plane');
      const points: unknown[] = new Array(count);
      for (let i = 0, at = end + offset; i < count; i++, at += 16) {
        const x = view.getFloat64(at, true), y = view.getFloat64(at + 8, true);
        points[i] = key === '$xy' ? { x, y } : [x, y];
      }
      return points;
    }
    for (const key of Object.keys(object)) object[key] = expand(object[key]);
    return object;
  };
  return expand(value) as T;
}
function base(t: TerrainLayer, root: Rng, biome: string | undefined): Record<string, unknown> {
  return { seed: root.seedKey, w: t.height.w, h: t.height.h, cell: t.height.cell, biome: biomeName(biome),
    seaLevel: t.seaLevel, seaFraction: t.seaFraction };
}
function ruralRequest(world: World, root: Rng, mainRoads?: number, stripLod?: { center: Vec2; radius: number }, plan?: RuralPlan, soilField?: RuralSoil) {
  const t = world.terrain, fields = world.site!.fields, soil = soilField?.landuseGrid, travel = world.site!.travel;
  if (soilField && !soil) throw new Error('A rural soil sampler must expose its source landuseGrid.');
  const { naturalForest, ...scalars } = plan ?? {};
  return request({ ...base(t, root, world.options.biome), operation: 'rural', mapSize: world.mapSize,
    options: { mapSize: world.options.mapSize, size: world.options.size, culture: world.options.culture, relief: world.options.relief },
    geometry: geometry(world), plan: plan && scalars, mainRoads, stripLod,
    soilContext: soil && { w: soil.w, h: soil.h, cell: soil.cell, x0: soil.x0, y0: soil.y0 },
    travelFrom: travel?.from,
  }, [['height', t.height.data], ['slope', t.slope.data], ['water', t.water],
    travel ? ['pass', travel.pass] as const : ['cost', world.site!.cost.data] as const,
    ['hab', fields.hab], ['dWater', fields.dWater], ['dSea', fields.dSea],
    ...(naturalForest ? [['naturalForest', naturalForest] as const] : []), ...(soil ? [['soil', soil.data] as const] : [])]);
}
function naturalRequest(t: TerrainLayer, biome: string | undefined, root: Rng, naturalForest?: Float32Array) {
  return request({ ...base(t, root, biome), operation: 'natural' }, [['height', t.height.data], ['slope', t.slope.data], ['water', t.water],
    ...(naturalForest ? [['naturalForest', naturalForest] as const] : [])]);
}
const capability = new Map<string, Promise<boolean>>();
async function native(runtime: ExecutionRuntime): Promise<boolean> {
  if (runtime.profile !== 'local' || !runtime.server) return false;
  let known = capability.get(runtime.server);
  if (!known) {
    known = fetch(`${runtime.server.replace(/\/$/, '')}/status`, { cache: 'no-store' }).then(r => r.json())
      .then((s: { capabilities?: string[] }) => !!s.capabilities?.includes('landuse.stage-v1'), () => false);
    capability.set(runtime.server, known); void known.then(ok => { if (!ok) capability.delete(runtime.server); });
  }
  return known;
}
function sync<T>(r: ReturnType<typeof request>): T {
  return decodeLanduse<T>((synchronousCoreWasm() as unknown as Wasm).landuse_stage(r.header, r.planes));
}
async function run<T>(r: ReturnType<typeof request>, runtime: ExecutionRuntime): Promise<T> {
  if (await native(runtime)) {
    const json = new TextEncoder().encode(r.header), padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(32); padded.set(json);
    const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, padded.length, true);
    const bytes = await (await nativeRequest(runtime, '/landuse', new Blob([length, padded, r.planes]))).arrayBuffer();
    return decodeLanduse<T>(new Uint8Array(bytes));
  }
  const wasm = await loadCoreWasm() as unknown as Wasm;
  return decodeLanduse<T>(wasm.landuse_stage(r.header, r.planes));
}
/** Synchronous classic pipeline and fixtures use the same Rust stage through WASM. */
export function generateRural(world: World, root: Rng, mainRoads?: number, stripLod?: { center: Vec2; radius: number }, plan?: RuralPlan, soilField?: RuralSoil): Output {
  return sync(ruralRequest(world, root, mainRoads, stripLod, plan, soilField));
}
export function generateRuralNative(world: World, root: Rng, mainRoads?: number, stripLod?: { center: Vec2; radius: number }, plan?: RuralPlan, soilField?: RuralSoil, runtime = executionRuntime): Promise<Output> {
  return run(ruralRequest(world, root, mainRoads, stripLod, plan, soilField), runtime);
}
export function generateNaturalCover(terrain: TerrainLayer, biome: string | undefined, root: Rng, naturalForest?: Float32Array): LandUseLayer {
  return naturalLayer(sync(naturalRequest(terrain, biome, root, naturalForest)));
}
function naturalLayer(layer: LandUseLayer): LandUseLayer {
  for (const area of layer.areas) area.holes ??= [];
  return layer;
}
export async function generateNaturalCoverNative(terrain: TerrainLayer, biome: string | undefined, root: Rng, naturalForest?: Float32Array, runtime = executionRuntime): Promise<LandUseLayer> {
  return naturalLayer(await run(naturalRequest(terrain, biome, root, naturalForest), runtime));
}
let landscapeCache = new WeakMap<World, Map<boolean, { signature: string; ground: PolyH[] }>>();
onCoreWasmReset(() => { landscapeCache = new WeakMap(); });
export function urbanLandscapeGround(world: World, appearance = false): PolyH[] {
  const fields = world.site?.fields;
  const open = [world.urban, ...(world.settlements ?? []).filter(s => !s.main).map(s => s.urban), ...Object.values(world.megaDetail ?? {})]
    .some(u => u?.renderHints?.openGround);
  const g = { ...geometry(world, appearance) as object, ...(appearance && open ? { landuse: world.landuse } : {}) };
  const signature = JSON.stringify([world.mapSize, world.options.biome, g, appearance && fields && [fields.hab, fields.dWater]]);
  const modes = landscapeCache.get(world) ?? new Map();
  const cached = modes.get(appearance); if (cached?.signature === signature) return cached.ground;
  const ground = containGround(() => sync<PolyH[]>(request({ ...base(world.terrain, { seedKey: '' } as Rng, world.options.biome), operation: 'landscape',
    mapSize: world.mapSize, geometry: g, appearance,
  }, appearance && fields ? [['hab', fields.hab], ['dWater', fields.dWater]] : [])));
  modes.set(appearance, { signature, ground }); landscapeCache.set(world, modes); return ground;
}
export function urbanNaturalGround(world: World): PolyH[] {
  return containGround(() => sync(request({ ...base(world.terrain, { seedKey: '' } as Rng, world.options.biome), operation: 'natural-ground',
    mapSize: world.mapSize, geometry: geometry(world) }, [])));
}
export function landscapeCoverGround(world: World, ground: PolyH[]): PolyH[] {
  return groundOperation('cover-ground', world, { ground });
}
function withMaterial(u: UrbanLayer, m?: GroundAppearance, appearance = false): unknown {
  return { ...urban(u, appearance) as object, ...(m ? { groundMaterial: { gardens: m.gardens, natural: m.natural,
    naturalParcels: u.parcels.flatMap((p, i) => m.naturalParcels.has(p.poly) ? [i] : []), earthStreets: m.earthStreets } } : {}) };
}
function containGround(call: () => PolyH[]): PolyH[] {
  try { return call(); } catch (error) { void recoverCoreWasm(error).catch(e => console.warn('WASM recovery failed', e)); return []; }
}
function groundOperation(operation: string, world?: World, extra: object = {}): PolyH[] {
  const fields = world?.site?.fields;
  const context = world && (operation === 'water-ground' ? { terrain: {
    coastline: world.terrain.coastline, islands: world.terrain.islands, lakes: world.terrain.lakes,
    rivers: world.terrain.rivers.map(r => ({ path: r.path, width: r.width, main: r.main, edgeFed: r.edgeFed })),
  } } : operation === 'cover-ground' ? { urban: urban(world.urban),
    settlements: world.settlements?.filter(s => !s.main).map(s => ({ main: false, urban: urban(s.urban) })),
    megaDetail: world.megaDetail && Object.fromEntries(Object.entries(world.megaDetail).map(([k, u]) => [k, urban(u)])),
  } : { landuse: [((extra as { urban?: UrbanLayer }).urban), ((extra as { owner?: UrbanLayer }).owner)]
    .some(u => u?.renderHints?.openGround) ? world.landuse : undefined });
  const header = world ? { ...base(world.terrain, { seedKey: '' } as Rng, world.options.biome), mapSize: world.mapSize,
    geometry: context, appearance: true }
    : { seed: '', w: 2, h: 2, cell: 8, mapSize: 1600, geometry: {}, appearance: false };
  return containGround(() => sync(request({ ...header, operation, ...extra }, fields && ['protected-ground', 'layer-ground'].includes(operation) ? [['hab', fields.hab], ['dWater', fields.dWater]] : [])));
}
export const waterGround = (world: World): PolyH[] => groundOperation('water-ground', world);
export const protectedGround = (u: UrbanLayer, appearance?: World, material?: GroundAppearance): PolyH[] =>
  groundOperation('protected-ground', appearance, { urban: withMaterial(u, material, !!appearance) });
export const layerGround = (u: UrbanLayer, replaced = new Set<number>(), appearance?: World, footprint?: Polygon, owner?: UrbanLayer): PolyH[] =>
  groundOperation('layer-ground', appearance, { urban: urban(u, !!appearance), replaced: [...replaced], footprint, owner: urban(owner, !!appearance) });
export const dryGround = (source: PolyH[], protection: PolyH[], water: PolyH[]): PolyH[] => {
  if (!source.length) return [];
  const bounds = (p: Polygon) => p.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y),
    x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const boxes = source.map(p => bounds(p.outer));
  const near = (a: PolyH[]) => a.filter(p => { const b = bounds(p.outer);
    return boxes.some(a => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0); });
  return groundOperation('dry-ground', undefined, { source, protection: near(protection), water: near(water) });
};
/** Standalone farm witness: planning and placement are both performed in Rust. */
export function farmGeometry(type: string, size: string, context: unknown, origin: Vec2, inward: Vec2, root: Rng): {
  lot: Polygon; parts: NonNullable<World['landuse']>['farmsteads'][number]['parts'] & {}; yard: Polygon;
  walls: Polygon[]; plots: NonNullable<World['landuse']>['farmsteads'][number]['plots']; trees: Vec2[]; gate: Vec2; entry: Vec2; angle: number;
} { return JSON.parse((synchronousCoreWasm() as unknown as Wasm).landuse_farm(JSON.stringify({ type, size, context, origin, inward, seed: root.seedKey }))); }
