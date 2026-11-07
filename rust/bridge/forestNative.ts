// Thin client of the Rust forest field (`magna_urbis_terrain::forest_request`): the native engine's
// `/terrain/forest` in the local profile, the same code through WASM in the web profile.
// Request and reply framing: u32 LE header length, JSON header padded to a multiple of 4, then planes.
import { executionRuntime, type ExecutionRuntime } from '../../web/src/ui/executionProfile';

export interface ForestRustRequest {
  seed: number; climate: readonly [number, number];
  x: number; y: number; width: number; n: number; height: Float32Array;
  water?: Uint8Array; riverSegments?: Float32Array;
  enabled: boolean; density: number; clearings: number; progressive: boolean;
}
export interface ForestRustReply { n: number; rgba: Uint8Array; bank?: Uint8Array; beach?: { x: number; y: number; width: number; n: number; data: Uint8Array } }

function encode(r: ForestRustRequest): Uint8Array<ArrayBuffer> {
  const segments = r.riverSegments && r.riverSegments.length >= 9 ? r.riverSegments.subarray(0, Math.floor(r.riverSegments.length / 9) * 9) : undefined;
  const header = new TextEncoder().encode(JSON.stringify({ seed: r.seed >>> 0, climate: r.climate, x: r.x, y: r.y, width: r.width, n: r.n,
    water: !!r.water, segments: segments ? segments.length / 9 : 0, enabled: r.enabled, density: r.density, clearings: r.clearings, progressive: r.progressive }));
  const padded = Math.ceil(header.length / 4) * 4, cells = r.n * r.n, waterBytes = r.water ? Math.ceil(cells / 4) * 4 : 0;
  const out = new Uint8Array(4 + padded + cells * 4 + waterBytes + (segments ? segments.length * 4 : 0));
  out.fill(32, 4, 4 + padded); out.set(header, 4); new DataView(out.buffer).setUint32(0, padded, true);
  let at = 4 + padded;
  const put = (a: ArrayBufferView): void => { out.set(new Uint8Array(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength), at); at += a.byteLength; };
  put(r.height);
  if (r.water) { put(r.water); at = 4 + padded + cells * 4 + waterBytes; }
  if (segments) put(segments);
  return out;
}

function decode(bytes: Uint8Array, r: ForestRustRequest): ForestRustReply {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), headerLength = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))) as { n: number; bank: boolean; beachN: number };
  let at = 4 + headerLength;
  const take = (length: number): Uint8Array => { const part = bytes.slice(at, at + length); at += length; return part; };
  const rgba = take(header.n * header.n * 4), bank = header.bank ? take(header.n * header.n * 4) : undefined;
  const beach = header.beachN ? { x: r.x, y: r.y, width: r.width, n: header.beachN, data: take(header.beachN * header.beachN) } : undefined;
  return { n: header.n, rgba, bank, beach };
}

const capability = new Map<string, Promise<boolean>>();
function nativeForest(runtime: ExecutionRuntime): Promise<boolean> {
  if (runtime.profile !== 'local') return Promise.resolve(false);
  let known = capability.get(runtime.server);
  if (!known) {
    known = fetch(`${runtime.server.replace(/\/$/, '')}/status`, { cache: 'no-store' }).then(r => r.json())
      .then((status: { capabilities?: unknown }) => Array.isArray(status.capabilities) && status.capabilities.includes('terrain.forest-v1'), () => false);
    capability.set(runtime.server, known);
    void known.then(ok => { if (!ok) capability.delete(runtime.server); });
  }
  return known;
}

type ForestWasm = { build_forest_field(request: Uint8Array): Uint8Array };
/** Forest field planes, natively when the local engine offers it, else through WASM. */
export async function forestPlanes(request: ForestRustRequest, runtime: ExecutionRuntime = executionRuntime): Promise<ForestRustReply> {
  const body = encode(request);
  if (await nativeForest(runtime)) {
    const { nativeRequest } = await import('./nativeEngine');
    const response = await nativeRequest(runtime, '/terrain/forest', new Blob([body]));
    return decode(new Uint8Array(await response.arrayBuffer()), request);
  }
  const { loadCoreWasm } = await import('./wasmRuntime');
  const wasm = await loadCoreWasm() as unknown as ForestWasm;
  return decode(wasm.build_forest_field(body), request);
}
