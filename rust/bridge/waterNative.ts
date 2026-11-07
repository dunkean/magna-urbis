/** V2 vector water, with one binary call per stage and no JS computation fallback. */
import { executionRuntime, type ExecutionRuntime } from '../../web/src/ui/executionProfile';
import type { ConditioningResult, ConditioningSettings } from '../../web/src/ui/reliefConditioning';
import type { SimpleHydrology, WaterSettings, WaterBodies } from '../../web/src/ui/simpleHydrology';
import type { VectorWater, VectorWaterSettings } from '../../web/src/ui/vectorWater';
import type { ClimateInput, WaterBalance } from '../../web/src/ui/waterBalance';
import type { LakeField } from '../../web/src/ui/lakeGeometry';
import type { RiverSettings, RiverNetwork, RiverLine } from '../../web/src/ui/riverVectors';

type Plane = Float32Array | Float64Array | Int32Array | Uint8Array;
interface Reply { planes: Record<string, Plane>; meta: Record<string, any> }
function encode(header: object, planes: ArrayBufferView[]): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(header)), padded = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(4 + padded + planes.reduce((sum, p) => sum + p.byteLength, 0));
  new DataView(bytes.buffer).setUint32(0, padded, true); bytes.fill(32, 4, 4 + padded); bytes.set(json, 4);
  let at = 4 + padded;
  for (const plane of planes) { bytes.set(new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength), at); at += plane.byteLength; }
  return bytes;
}
function decode(bytes: Uint8Array): Reply {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
  const planes: Record<string, Plane> = {};
  const decoded = new Map<string, Plane>();
  for (const p of meta.planes as { name: string; kind: string; length: number; offset: number; encoding?: 'runs'; byteLength?: number }[]) {
    const size = p.kind === 'u8' ? 1 : p.kind === 'f64' ? 8 : 4, at = 4 + length + p.offset;
    const byteLength = p.byteLength ?? p.length * size;
    if (at < 0 || at + byteLength > bytes.length) throw new Error('Incomplete Rust water plane.');
    const key = `${at}:${p.kind}:${p.length}:${p.encoding ?? ''}`, cached = decoded.get(key);
    if (cached) { planes[p.name] = cached; continue; }
    if (p.encoding === 'runs') {
      const plane = p.kind === 'f32' ? new Float32Array(p.length) : p.kind === 'i32' ? new Int32Array(p.length) : new Uint8Array(p.length);
      const data = new DataView(bytes.buffer, bytes.byteOffset + at, byteLength);
      let cell = 0;
      for (let pos = 0; pos < byteLength; pos += 4 + size) {
        const count = data.getUint32(pos, true), end = cell + count;
        if (!count || end > p.length) throw new Error('Invalid Rust water run.');
        const value = p.kind === 'f32' ? data.getFloat32(pos + 4, true) : p.kind === 'i32' ? data.getInt32(pos + 4, true) : data.getUint8(pos + 4);
        plane.fill(value, cell, end); cell = end;
      }
      if (cell !== p.length) throw new Error('Incomplete Rust water runs.');
      planes[p.name] = plane; decoded.set(key, plane); continue;
    }
    const offset = bytes.byteOffset + at;
    // Native replies are aligned; a WASM-owned byte view can start at another offset.
    const view = offset % size ? bytes.slice(at, at + p.length * size) : bytes.subarray(at, at + p.length * size);
    planes[p.name] = p.kind === 'f64' ? new Float64Array(view.buffer, view.byteOffset, p.length)
      : p.kind === 'f32' ? new Float32Array(view.buffer, view.byteOffset, p.length)
      : p.kind === 'i32' ? new Int32Array(view.buffer, view.byteOffset, p.length) : view;
    decoded.set(key, planes[p.name]);
  }
  delete meta.planes;
  return { planes, meta };
}
const capabilities = new Map<string, Promise<boolean>>();
async function nativeAvailable(runtime: ExecutionRuntime): Promise<boolean> {
  if (runtime.profile !== 'local') return false;
  let known = capabilities.get(runtime.server);
  if (!known) {
    known = fetch(`${runtime.server.replace(/\/$/, '')}/status`, { cache: 'no-store' }).then(r => r.json())
      .then(s => Array.isArray(s.capabilities) && s.capabilities.includes('terrain.water-v1'), () => false);
    capabilities.set(runtime.server, known);
    void known.then(ok => { if (!ok) capabilities.delete(runtime.server); });
  }
  return known;
}
async function call(header: object, planes: ArrayBufferView[], runtime = executionRuntime): Promise<Reply> {
  const bytes = encode(header, planes);
  if (await nativeAvailable(runtime)) {
    const { nativeRequest } = await import('./nativeEngine');
    return decode(new Uint8Array(await (await nativeRequest(runtime, '/terrain/water', new Blob([bytes]))).arrayBuffer()));
  }
  const { loadCoreWasm } = await import('./wasmRuntime');
  const wasm = await loadCoreWasm() as unknown as { vector_water_request(bytes: Uint8Array): Uint8Array };
  return decode(wasm.vector_water_request(bytes));
}
const drainagePlanes = (h: SimpleHydrology): ArrayBufferView[] => [h.filled, h.receiver, h.accumulation, h.order, h.basin, h.sea];
function hydro(reply: Reply, height: Float32Array): SimpleHydrology {
  const h = { ...reply.meta.hydro, height } as SimpleHydrology;
  for (const name of ['filled', 'receiver', 'accumulation', 'sea'] as const) (h as any)[name] = reply.planes[`hydro.${name}`];
  // Conditioning's basin IDs have no TS reader and are derived in Rust if needed.
  h.basin = reply.planes['hydro.basin'] as Int32Array ?? new Int32Array(0);
  // Flood order is an intermediate input, with no final water/render consumer.
  h.order = reply.planes['hydro.order'] as Int32Array ?? new Int32Array(0);
  return h;
}
function network(reply: Reply, meta: any): RiverNetwork | undefined {
  if (!meta) return undefined;
  const values = reply.planes['rivers.values'] as Float64Array, index = reply.planes['rivers.lines'] as Int32Array;
  const { groups, ...summary } = meta;
  let lineAt = 0;
  for (const [g, name] of ['rivers', 'lakeLinks', 'oxbows', 'braids', 'distributaries'].entries()) {
    summary[name] = Array.from({ length: groups[g] }, () => {
      const at = lineAt++ * 13, line: Partial<RiverLine> = {};
      for (const [k, name] of ['points', 'area', 'level', 'kind', 'threads'].entries()) {
        const start = index[at + k * 2], length = index[at + k * 2 + 1];
        // serde_json represented non-finite diagnostic values as null.
        if (length >= 0) (line as any)[name] = Array.from(values.subarray(start, start + length), v => Number.isFinite(v) ? v : null);
      }
      if (index[at + 10] >= 0) line.id = index[at + 10];
      if (index[at + 11] !== -2147483648) line.joins = index[at + 11];
      if (index[at + 12] >= 0) line.outlet = index[at + 12];
      return line as RiverLine;
    });
  }
  return summary as RiverNetwork;
}
function water(reply: Reply, height: Float32Array): VectorWater {
  const h = hydro(reply, height), p = reply.planes;
  return { ...reply.meta.water, rivers: network(reply, reply.meta.water.rivers), confluenceAngle: reply.meta.water.confluenceAngle ?? undefined, hydro: h, lake: p.lake as Uint8Array, lakeLevel: p.lakeLevel as Float32Array | undefined,
    lakeKind: p.lakeKind as Uint8Array | undefined,
    lakeField: { n: h.n, values: p['field.values'] as Float32Array, distance: p['field.distance'] as Float32Array } };
}
export async function computeHydrology(height: Float32Array, n: number, width: number, runtime?: ExecutionRuntime): Promise<SimpleHydrology> {
  const started = performance.now(), reply = await call({ operation: 'hydrology', n, width }, [height], runtime);
  return { ...hydro(reply, height), ms: performance.now() - started };
}
export function conditionRelief(height: Float32Array, n: number, width: number, conditioning: ConditioningSettings, options?: { stats?: true; drainage?: true }, runtime?: ExecutionRuntime): Promise<ConditioningResult>;
export function conditionRelief(height: Float32Array, n: number, width: number, conditioning: ConditioningSettings, options: { stats?: boolean; drainage?: boolean }, runtime?: ExecutionRuntime): Promise<Omit<ConditioningResult, 'hydrology'> & { hydrology?: SimpleHydrology }>;
export async function conditionRelief(height: Float32Array, n: number, width: number, conditioning: ConditioningSettings, options: { stats?: boolean; drainage?: boolean } = {}, runtime?: ExecutionRuntime): Promise<Omit<ConditioningResult, 'hydrology'> & { hydrology?: SimpleHydrology }> {
  const started = performance.now(), reply = await call({ operation: 'condition', n, width, conditioning, stats: options.stats !== false, drainage: options.drainage ?? options.stats !== false }, [height], runtime);
  return { ...reply.meta.conditioning, height: reply.planes.height as Float32Array, delta: reply.planes.delta as Float32Array,
    hydrology: reply.meta.hydro ? hydro(reply, reply.planes.height as Float32Array) : undefined, ms: performance.now() - started };
}
export async function conditionAndWater(height: Float32Array, n: number, width: number, conditioning: ConditioningSettings, settings: VectorWaterSettings, climate: ClimateInput, seed: string, runtime?: ExecutionRuntime) {
  const reply = await call({ operation: 'chain', n, width, conditioning, settings, climate, seed, stats: false }, [height], runtime);
  const conditionedHeight = reply.planes.height as Float32Array;
  return { conditioning: { ...reply.meta.conditioning, census: false, height: conditionedHeight, delta: reply.planes.delta as Float32Array } as Omit<ConditioningResult, 'hydrology'> & { census: false }, water: water(reply, conditionedHeight) };
}
export async function computeVectorWater(height: Float32Array, n: number, width: number, settings: VectorWaterSettings, climate: ClimateInput, seed: string, drainage?: SimpleHydrology, runtime?: ExecutionRuntime): Promise<VectorWater> {
  const reply = await call({ operation: 'water', n, width, settings, climate, seed, drainageOutlets: drainage?.outlets, drainageBasin: !!drainage?.basin.length },
    [height, ...(drainage ? drainagePlanes(drainage) : [])], runtime);
  return water(reply, height);
}
export async function computeLakeField(mask: Uint8Array, n: number, runtime?: ExecutionRuntime): Promise<LakeField> {
  const reply = await call({ operation: 'field', n, width: n }, [Float32Array.from(mask)], runtime);
  return { n, values: reply.planes.values as Float32Array, distance: reply.planes.distance as Float32Array };
}
export async function interpolateDelta(delta: Float32Array, m: number, n: number, mapWidth: number, region?: { x: number; y: number; width: number }, runtime?: ExecutionRuntime): Promise<Float32Array> {
  const reply = await call({ operation: 'delta', n: m, width: mapWidth, targetN: n, x: region?.x, y: region?.y, sampleWidth: region?.width }, [delta], runtime);
  return reply.planes.values as Float32Array;
}
export async function upsampleDelta(delta: Float32Array, m: number, n: number, runtime?: ExecutionRuntime): Promise<Float32Array> {
  return m === n ? delta : interpolateDelta(delta, m, n, n, undefined, runtime);
}
const diagnosticSettings = (s: Partial<VectorWaterSettings>): VectorWaterSettings => ({ riverArea: 1, lakeDepth: 1, lakeArea: 10, riverMode: 'vector', flatSlope: 1, sinuosity: 1.4, widthScale: 1, balance: false,
  braiding: 0, anabranching: false, terrainInfluence: false, avulsions: false, confluence: 'drainage', deltas: false, ...s });
/** Standalone diagnostic adapters also run the Rust implementation. */
export async function vectorRivers(h: SimpleHydrology, lake: Uint8Array, settings: RiverSettings): Promise<RiverNetwork> {
  const reply = await call({ operation: 'rivers', n: h.n, width: h.width, settings: diagnosticSettings(settings), seed: settings.seed,
    aridity: settings.aridity, dischargeScale: settings.dischargeScale, confluenceAngle: settings.confluenceAngle, drainageOutlets: h.outlets, drainageBasin: !!h.basin.length }, [h.height, ...drainagePlanes(h), lake]);
  return network(reply, reply.meta.rivers)!;
}
export async function waterBodies(h: SimpleHydrology, settings: WaterSettings): Promise<WaterBodies> {
  const reply = await call({ operation: 'bodies', n: h.n, width: h.width, settings: diagnosticSettings(settings), drainageOutlets: h.outlets, drainageBasin: !!h.basin.length }, [h.height, ...drainagePlanes(h)]);
  return { ...reply.meta.bodies, lake: reply.planes.lake as Uint8Array };
}
export async function waterBalance(height: Float32Array, n: number, width: number, sea: Uint8Array, climate: ClimateInput, minDepth = 1, minArea = 1e5, drainage?: SimpleHydrology): Promise<WaterBalance> {
  const h = drainage ?? await computeHydrology(height, n, width);
  const reply = await call({ operation: 'balance', n, width, settings: diagnosticSettings({ lakeDepth: minDepth, lakeArea: minArea / 1e4 }), climate, drainageOutlets: h.outlets, drainageBasin: !!h.basin.length }, [height, ...drainagePlanes({ ...h, sea })]);
  return { ...reply.meta.balance, ...reply.planes } as unknown as WaterBalance;
}
