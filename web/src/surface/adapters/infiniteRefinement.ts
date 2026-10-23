import type { TerrainProvider } from '../provider';
import { assertNotAborted, type TerrainGrid } from '../model';

export interface InfiniteRefinementRegistration { id: string; version: string; minMpp: number; nativeMpp: number; decoderUsed: boolean }
type Registration = InfiniteRefinementRegistration;
export interface InfiniteRefinementOptions {
  seed: string; source?: string; neuralToken?: string;
  neuralWindow?: { x: number; y: number; width: number; heightScale: number };
}
/** Real retained Infinite/Neural Earth refinement HTTP service, shared with
 * TerrainRefinementSession. Consume raw sample values, never B-spline coefficients
 * produced for the current display shader. Registration field is that shader's
 * existing retained B-spline control grid (interpolation='bspline'). */
export async function createInfiniteRefinementProvider(server: string,
  field: { width: number; n: number; data: Float32Array }, options: InfiniteRefinementOptions,
  transport: typeof fetch = fetch): Promise<TerrainProvider & { readonly registration: Readonly<Registration> }> {
  if (!Number.isInteger(field.n) || field.n < 8 || field.n > 4096 || field.data.length !== field.n ** 2 || !(field.width > 0) || !Number.isFinite(field.width)
    || field.data.some(v => !Number.isFinite(v)) || !/^[+-]?\d+$/.test(options.seed)) throw new Error('Refinement registration requires a finite 8–4096 grid and integer seed string.');
  const bytes = new Uint8Array(field.data.buffer, field.data.byteOffset, field.data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const body = JSON.stringify({ ...options, width: field.width, n: field.n, heights: btoa(binary), interpolation: 'bspline' });
  const connect = async (): Promise<Registration> => {
    const response = await transport(`${server}/refinement/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!response.ok) throw new Error(`Infinite refinement registration: ${await response.text()}`);
    const value = await response.json() as Registration;
    if (typeof value.id !== 'string' || !value.id || typeof value.version !== 'string' || !value.version
      || ![value.minMpp, value.nativeMpp].every(Number.isFinite) || !(value.minMpp > 0) || !(value.nativeMpp > 0)
      || typeof value.decoderUsed !== 'boolean') throw new Error('Invalid refinement registration.');
    return value;
  };
  let registration = await connect();
  return { get id() { return `infinite-refinement:${options.seed}:${registration.id}`; },
    get registration() { return Object.freeze({ ...registration }); }, async request(request): Promise<TerrainGrid> {
    assertNotAborted(request.signal);
    const b = request.bounds, width = b.maxX - b.minX;
    if (![b.minX, b.minZ, b.maxX, b.maxZ, request.spacingM].every(Number.isFinite) || !(width > 0) || Math.abs(width - b.maxZ + b.minZ) > 1e-6 || !(request.spacingM > 0)) throw new Error('Refinement requires finite square bounds and positive spacing.');
    const resolution = Math.max(8, Math.min(1024, Math.ceil(width / Math.max(registration.minMpp, request.spacingM))));
    let tileRegistration = registration;
    const send = () => transport(`${server}/refinement/tile`, { method: 'POST', signal: request.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: tileRegistration.id, x: b.minX, y: b.minZ, width, resolution }) });
    let response = await send();
    if (response.status === 400) {
      const message = await response.text();
      if (!message.includes('source expired or unknown')) throw new Error(message);
      registration = await connect(); tileRegistration = registration; assertNotAborted(request.signal); response = await send();
    }
    if (!response.ok) throw new Error(`Infinite refinement tile: ${await response.text()}`);
    const meta = JSON.parse(response.headers.get('X-Neural-Meta') ?? '{}') as {
      x: number; y: number; width: number; n: number; sourceCell: number; lod: number; version: string; decoderUsed: boolean;
    };
    const heights = new Float32Array(await response.arrayBuffer());
    assertNotAborted(request.signal);
    const tolerance = Math.max(1, Math.abs(width)) * 1e-8;
    if (!Number.isInteger(meta.n) || meta.n !== resolution || heights.length !== meta.n ** 2
      || heights.some(v => !Number.isFinite(v)) || !(meta.width > 0) || !(meta.sourceCell > 0)
      || ![meta.x, meta.y, meta.width, meta.sourceCell, meta.lod].every(Number.isFinite) || typeof meta.version !== 'string' || !meta.version || typeof meta.decoderUsed !== 'boolean'
      || Math.abs(meta.x - b.minX) > tolerance || Math.abs(meta.y - b.minZ) > tolerance || Math.abs(meta.width - width) > tolerance) throw new Error('Invalid refinement tile metadata or samples.');
    const spacingM = meta.width / meta.n;
    return { width: meta.n, height: meta.n, originX: meta.x + spacingM / 2, originZ: meta.y + spacingM / 2,
      spacingM, heights, source: { id: `infinite:${options.seed}:${tileRegistration.id}`, version: meta.version,
        sourceLOD: meta.lod, sourceLODKnown: true, nativeSpacingM: meta.sourceCell,
        provenance: `Infinite retained refinement; seed=${options.seed}; decoderUsed=${meta.decoderUsed}; registrationNativeMpp=${tileRegistration.nativeMpp}` } };
  } };
}
