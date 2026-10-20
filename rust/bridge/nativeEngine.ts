import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import type { SettlementRaster } from './settlements';

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

/** Upload a terrain once: 17 bytes/cell, without JSON number arrays or base64. */
export async function uploadNativeRaster(runtime: ExecutionRuntime, session: string, raster: SettlementRaster): Promise<void> {
  const header = new TextEncoder().encode(JSON.stringify({ session, width: raster.width, n: raster.n, geometry: raster.geometry }));
  const padded = new Uint8Array(Math.ceil(header.length / 4) * 4).fill(32); padded.set(header);
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, padded.length, true);
  const bytes = (array: ArrayBufferView): Uint8Array<ArrayBuffer> => new Uint8Array(array.buffer as ArrayBuffer, array.byteOffset, array.byteLength);
  await nativeRequest(runtime, '/raster', new Blob([length, padded,
    bytes(raster.height), bytes(raster.waterLevel), bytes(raster.riverWidth), bytes(raster.riverIds), bytes(raster.water)]));
}

export async function nativeJson<T>(runtime: ExecutionRuntime, path: string, value: unknown): Promise<T> {
  return (await nativeRequest(runtime, path, JSON.stringify(value))).json() as Promise<T>;
}

/** Serialize mutations of a single retained raster, while other benches run independently. */
export function nativeRasterClient() {
  let session: string | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(path: string, request: { runtime: ExecutionRuntime; raster?: SettlementRaster; [key: string]: unknown }): Promise<T> => {
    const result = queue.then(async () => {
      session ??= nativeSession();
      const { runtime, raster, ...input } = request;
      if (raster) await uploadNativeRaster(runtime, session, raster);
      return nativeJson<T>(runtime, path, { ...input, session });
    });
    queue = result.catch(() => undefined);
    return result;
  };
}
