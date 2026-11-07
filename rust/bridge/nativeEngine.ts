import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import type { SettlementRaster } from './settlements';
import { validatePhysicalTerrain } from './settlements';

/** One ID per worker/bench; all native retained grids stay behind this handle. */
export function nativeSession(): string { return crypto.randomUUID(); }

export async function nativeRequest(runtime: ExecutionRuntime, path: string, body: BodyInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${runtime.server.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers: { 'Content-Type': body instanceof Blob ? 'application/octet-stream' : 'application/json' }, body,
    });
  } catch {
    throw new Error(`Moteur Rust local inaccessible (${runtime.server}). Lancez le profil local ou l’application de bureau.`);
  }
  if (!response.ok) {
    const message = await response.text();
    try { throw new Error((JSON.parse(message) as { error?: string }).error ?? message); }
    catch (error) { if (error instanceof SyntaxError) throw new Error(message || `Moteur local : HTTP ${response.status}`); throw error; }
  }
  return response;
}

/** `/raster` framing: u32 LE header length, JSON header padded with spaces to 4 bytes, then planes. */
function rasterFrame(header: unknown): Uint8Array<ArrayBuffer>[] {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(32); padded.set(json);
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, padded.length, true);
  return [length, padded];
}
/** One id per raster object (rasters are immutable once built): its content identity on the server. */
const rasterIds = new WeakMap<SettlementRaster, string>();
/** Uploads by server and raster id; resolves true once the server holds that terrain. */
const rasterUploads = new Map<string, Promise<boolean>>();

/**
 * Upload capped planning planes (17 bytes/cell), then optional physical metres (4 bytes/cell).
 * The same raster object sent to several sessions (the concurrent city lanes) crosses the wire and
 * is parsed once: later sessions attach the server's terrain by raster id, and upload in full only
 * when no session holds it any more (released or evicted).
 */
export async function uploadNativeRaster(runtime: ExecutionRuntime, session: string, raster: SettlementRaster): Promise<void> {
  validatePhysicalTerrain(raster.physical);
  let rasterId = rasterIds.get(raster);
  if (!rasterId) rasterIds.set(raster, rasterId = nativeSession());
  const key = `${runtime.server}|${rasterId}`;
  const prior = rasterUploads.get(key);
  if (prior && await prior) {
    try {
      await (await nativeRequest(runtime, '/raster', new Blob(rasterFrame({ session, rasterId, shared: true })))).arrayBuffer();
      return;
    } catch { /* no session holds it any more: upload it again */ }
  }
  const bytes = (array: ArrayBufferView): Uint8Array<ArrayBuffer> => new Uint8Array(array.buffer as ArrayBuffer, array.byteOffset, array.byteLength);
  const upload = (async () => {
    // Drain the reply so the keep-alive connection is free for the next request.
    await (await nativeRequest(runtime, '/raster', new Blob([...rasterFrame({ session, rasterId, width: raster.width, n: raster.n,
      physicalN: raster.physical?.n, physicalInterpolation: raster.physical?.interpolation,
      physicalFloor: raster.physical?.floor, geometry: raster.geometry, region: raster.region }),
    bytes(raster.height), bytes(raster.waterLevel), bytes(raster.riverWidth), bytes(raster.riverIds), bytes(raster.water),
    ...(raster.physical ? [bytes(raster.physical.height)] : [])]))).arrayBuffer();
  })();
  rasterUploads.delete(key);
  rasterUploads.set(key, upload.then(() => true, () => false));
  // Bounded: only the last few terrains are worth sharing.
  for (const old of rasterUploads.keys()) if (rasterUploads.size > 8) rasterUploads.delete(old);
  await upload;
}

export async function nativeJson<T>(runtime: ExecutionRuntime, path: string, value: unknown): Promise<T> {
  return (await nativeRequest(runtime, path, JSON.stringify(value))).json() as Promise<T>;
}

/** Serialize mutations of a single retained raster, while other benches run independently. */
export function nativeRasterClient() {
  let session: string | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const call = <T>(path: string, request: { runtime: ExecutionRuntime; raster?: SettlementRaster; [key: string]: unknown }): Promise<T> => {
    const result = queue.then(async () => {
      session ??= nativeSession();
      const { runtime, raster, ...input } = request;
      if (raster) await uploadNativeRaster(runtime, session, raster);
      return nativeJson<T>(runtime, path, { ...input, session });
    });
    queue = result.catch(() => undefined);
    return result;
  };
  /** Drop this client's retained native session (raster, urban products) once its owner is done. */
  const release = async (runtime: ExecutionRuntime): Promise<void> => {
    await queue; const id = session; session = undefined;
    if (id) try { await nativeJson(runtime, '/release', { session: id }); } catch { /* an exited or evicted session is already released */ }
  };
  return Object.assign(call, { release });
}
