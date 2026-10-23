import type { TerrainProvider } from '../provider';
import { assertNotAborted, type TerrainGrid } from '../model';
import { assertCanonicalRegistrationField, assertRefinementTerrainRegion, compareRefinementParent,
  registrationFieldFingerprint, validateRegistrationField, type RefinementParentComparison, type RegistrationField, type SurfaceRegistrationBinding } from '../registrationBinding';

export interface InfiniteRefinementRegistration { id: string; version: string; minMpp: number; nativeMpp: number; decoderUsed: boolean; retainedSourceCell?: number }
export interface InfiniteRefinementOptions {
  seed: string; source?: string; neuralToken?: string;
  neuralWindow?: { x: number; y: number; width: number; heightScale: number };
  signal?: AbortSignal;
}
export interface InfiniteRefinementProvider extends TerrainProvider {
  readonly registration: Readonly<InfiniteRefinementRegistration>;
  /** Always current after re-registration; do not retain a stale provider id/binding. */
  readonly registrationBinding: Readonly<SurfaceRegistrationBinding>;
  /** Fresh independent copy of the exact retained controls, labelled with the current registration identity.
   * Read once when initializing a consumer; getters deliberately never expose mutable provider storage. */
  readonly registrationParent: TerrainGrid & { reconstruction: 'cubic-bspline-controls' };
  readonly parentComparison: Readonly<RefinementParentComparison> | undefined;
  bindCanonicalField(field: RegistrationField): Readonly<SurfaceRegistrationBinding>;
  dispose(): void;
}
interface Flight { controller: AbortController; promise: Promise<InfiniteRefinementRegistration>; waiters: number; settled: boolean }

/** Registration snapshots the actual B-spline control field, never the displayed mesh.
 * Cubic reconstruction deliberately smooths control centres. Diagnostics separate
 * this parent change from learned/procedural residuals. No noise fallback exists. */
export async function createInfiniteRefinementProvider(server: string, field: RegistrationField, options: InfiniteRefinementOptions,
  transport: typeof fetch = fetch): Promise<InfiniteRefinementProvider> {
  assertNotAborted(options.signal);
  validateRegistrationField(field);
  if (field.n < 8 || !/^[+]?\d+$/.test(options.seed) || BigInt(options.seed) >= 2n ** 64n) throw new Error('Refinement registration requires an 8–4096 grid and unsigned 64-bit seed');
  const retained: RegistrationField = { width: field.width, n: field.n, data: new Float32Array(field.data) };
  const fieldFingerprint = registrationFieldFingerprint(retained);
  let canonicalField = retained;
  let canonical = { width: retained.width, n: retained.n, fingerprint: fieldFingerprint, derivation: 'identity' as SurfaceRegistrationBinding['canonicalDerivation'] };
  const sourceOptions = { seed: options.seed, source: options.source, neuralToken: options.neuralToken, neuralWindow: options.neuralWindow && { ...options.neuralWindow } };
  const bytes = new Uint8Array(retained.data.buffer, retained.data.byteOffset, retained.data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const body = JSON.stringify({ ...sourceOptions, width: retained.width, n: retained.n, heights: btoa(binary), interpolation: 'bspline' });
  let registration: InfiniteRefinementRegistration | undefined, revision = 0, flight: Flight | undefined, disposed = false;
  let comparison: RefinementParentComparison | undefined;
  const connect = async (signal: AbortSignal): Promise<InfiniteRefinementRegistration> => {
    assertNotAborted(signal);
    const response = await transport(`${server}/refinement/register`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body });
    assertNotAborted(signal);
    if (!response.ok) throw new Error(`Infinite refinement registration: ${await response.text()}`);
    const value = await response.json() as InfiniteRefinementRegistration;
    if (typeof value.id !== 'string' || !value.id || typeof value.version !== 'string' || !value.version
      || ![value.minMpp, value.nativeMpp].every(Number.isFinite) || value.minMpp <= 0 || value.nativeMpp <= 0 || typeof value.decoderUsed !== 'boolean'
      || value.retainedSourceCell !== undefined && (!Number.isFinite(value.retainedSourceCell) || Math.abs(value.retainedSourceCell - retained.width / retained.n) > 1e-6)) throw new Error('Invalid refinement registration');
    return value;
  };
  const register = (signal?: AbortSignal): Promise<InfiniteRefinementRegistration> => {
    assertNotAborted(signal);
    if (disposed) return Promise.reject(new DOMException('Refinement provider disposed', 'AbortError'));
    if (!flight) {
      const active: Flight = { controller: new AbortController(), promise: undefined!, waiters: 0, settled: false };
      flight = active;
      active.promise = connect(active.controller.signal).then(value => {
        assertNotAborted(active.controller.signal);
        if (disposed || flight !== active) throw new DOMException('Stale refinement registration', 'AbortError');
        registration = value; revision++; return value;
      }).finally(() => { active.settled = true; if (flight === active) flight = undefined; });
      void active.promise.catch(() => {});
    }
    const active = flight; active.waiters++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, value?: InfiniteRefinementRegistration) => {
        if (done) return; done = true; signal?.removeEventListener('abort', abort); active.waiters--;
        if (!active.waiters && !active.settled) { if (flight === active) flight = undefined; active.controller.abort(); }
        error ? reject(error) : resolve(value!);
      };
      const abort = () => finish(new DOMException('Refinement registration cancelled', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      active.promise.then(value => finish(undefined, value), error => finish(error));
      if (signal?.aborted) abort();
    });
  };
  await register(options.signal);
  const binding = (): SurfaceRegistrationBinding => ({ expectedSourceId: `infinite:${sourceOptions.seed}:${registration!.id}`,
    providerId: `infinite-refinement:${sourceOptions.seed}:${registration!.id}`, registrationId: registration!.id, sourceVersion: registration!.version,
    fieldFingerprint, width: retained.width, n: retained.n, interpolation: 'cell-centred-cubic-bspline-controls',
    canonicalFieldFingerprint: canonical.fingerprint, canonicalWidth: canonical.width, canonicalN: canonical.n, canonicalDerivation: canonical.derivation });
  return {
    get id() { return binding().providerId; }, get registration() { return Object.freeze({ ...registration! }); },
    get registrationBinding() { return Object.freeze(binding()); }, get parentComparison() { return comparison && Object.freeze({ ...comparison }); },
    get registrationParent() {
      const current = binding(), spacingM = retained.width / retained.n;
      return { width: retained.n, height: retained.n, originX: spacingM / 2, originZ: spacingM / 2, spacingM,
        heights: new Float32Array(retained.data), reconstruction: 'cubic-bspline-controls' as const,
        source: { id: current.expectedSourceId, version: current.sourceVersion, sourceLOD: 0, sourceLODKnown: false,
          nativeSpacingM: registration!.retainedSourceCell ?? spacingM,
          provenance: `Exact retained registration controls; fieldFingerprint=${fieldFingerprint}; reconstruction=cubic-bspline-controls; sourceLOD unknown` } };
    },
    bindCanonicalField(capture) {
      const verified = assertCanonicalRegistrationField(retained, capture);
      canonicalField = { width: capture.width, n: capture.n, data: new Float32Array(capture.data) };
      canonical = { width: capture.width, n: capture.n, fingerprint: verified.fingerprint, derivation: verified.derivation };
      return Object.freeze(binding());
    },
    dispose() { disposed = true; flight?.controller.abort(); flight = undefined; },
    async request(request): Promise<TerrainGrid> {
      assertNotAborted(request.signal);
      if (disposed) throw new DOMException('Refinement provider disposed', 'AbortError');
      const b = request.bounds, width = b.maxX - b.minX;
      if (![b.minX, b.minZ, b.maxX, b.maxZ, request.spacingM].every(Number.isFinite) || width <= 0 || Math.abs(width - b.maxZ + b.minZ) > 1e-6 || request.spacingM <= 0) throw new Error('Refinement requires finite square bounds and positive spacing');
      let tileRegistration = registration!, tileRevision = revision;
      const resolutionFor = () => Math.max(8, Math.min(1024, Math.ceil(width / Math.max(tileRegistration.minMpp, request.spacingM))));
      let resolution = resolutionFor();
      const send = () => transport(`${server}/refinement/tile`, { method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tileRegistration.id, x: b.minX, y: b.minZ, width, resolution }) });
      try {
        let response = await send();
        if (response.status === 400) {
          const message = await response.text();
          if (!message.includes('source expired or unknown')) throw new Error(message);
          // Share one refresh per revision, even when the server returns the same deterministic registration id.
          if (revision === tileRevision) await register(request.signal);
          assertNotAborted(request.signal); tileRegistration = registration!; tileRevision = revision; resolution = resolutionFor(); response = await send();
        }
        assertNotAborted(request.signal);
        if (disposed) throw new DOMException('Refinement provider disposed', 'AbortError');
        if (!response.ok) throw new Error(`Infinite refinement tile: ${await response.text()}`);
        const meta = JSON.parse(response.headers.get('X-Neural-Meta') ?? '{}') as {
          id: string; x: number; y: number; width: number; n: number; sourceCell: number; lod: number; version: string; decoderUsed: boolean;
        };
        const heights = new Float32Array(await response.arrayBuffer()); assertNotAborted(request.signal);
        const tolerance = Math.max(1, Math.abs(width)) * 1e-8;
        if (!Number.isInteger(meta.n) || meta.n !== resolution || heights.length !== meta.n ** 2 || heights.some(v => !Number.isFinite(v))
          || ![meta.x, meta.y, meta.width, meta.sourceCell, meta.lod].every(Number.isFinite) || meta.sourceCell <= 0 || meta.width <= 0
          || meta.id !== tileRegistration.id || meta.version !== tileRegistration.version || typeof meta.decoderUsed !== 'boolean' || meta.decoderUsed && !tileRegistration.decoderUsed
          || Math.abs(meta.x - b.minX) > tolerance || Math.abs(meta.y - b.minZ) > tolerance || Math.abs(meta.width - width) > tolerance) throw new Error('Invalid refinement tile metadata or samples');
        const spacingM = meta.width / meta.n;
        const grid: TerrainGrid = { width: meta.n, height: meta.n, originX: meta.x + spacingM / 2, originZ: meta.y + spacingM / 2,
          spacingM, heights, source: { id: `infinite:${sourceOptions.seed}:${tileRegistration.id}`, version: meta.version,
            sourceLOD: meta.lod, sourceLODKnown: true, nativeSpacingM: meta.sourceCell } };
        assertRefinementTerrainRegion(grid, b);
        const measured = compareRefinementParent(retained, grid, canonicalField);
        if (tileRevision === revision) comparison = measured;
        grid.source.provenance = `Infinite retained refinement; seed=${sourceOptions.seed}; decoderUsed=${meta.decoderUsed}; registrationNativeMpp=${tileRegistration.nativeMpp}; fieldFingerprint=${fieldFingerprint}; parent=cell-centred cubic B-spline control reconstruction (not interpolation through control centres); parentComparison=${JSON.stringify(measured)}`;
        return grid;
      } catch (error) { if (request.signal?.aborted || disposed) throw new DOMException('Refinement request cancelled', 'AbortError'); throw error; }
    },
  };
}
