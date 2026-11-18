/** Shared by the settings UI and inference worker. Only complete, verified weights enter the cache. */
export const NEURAL_MODEL_CACHE = 'magna-urbis-neural-models-v1';
export const NEURAL_MODEL_NAMES = ['coarse', 'base', 'decoder'] as const;
export type NeuralModelName = typeof NEURAL_MODEL_NAMES[number];
export interface NeuralModelFile { file: string; bytes: number; sha256: string }
export interface NeuralModelEntry extends NeuralModelFile { chunks?: NeuralModelFile[]; selection?: string; release?: string; solverSteps?: number }
export interface NeuralManifest {
  profile: string; engineRevision: string; runtimeSha256: string; runtimeJsSha256?: string;
  models: Record<NeuralModelName, NeuralModelEntry>;
}
export interface StoredNeuralModel { url: string; name: string; bytes?: number; current: boolean; profile?: string }
export interface ModelTransfer { name: NeuralModelName; phase: 'download' | 'verify' | 'save'; received: number; total: number }
export class NeuralModelError extends Error {
  constructor(public readonly code: 'manifest' | 'storage' | 'integrity' | 'download', message: string, options?: ErrorOptions) { super(message, options); }
}

function validateManifest(value: unknown): NeuralManifest {
  const manifest = value as NeuralManifest;
  if (!manifest || typeof manifest.profile !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.runtimeSha256)) throw new NeuralModelError('manifest', 'Invalid neural model manifest.');
  if (manifest.runtimeJsSha256 !== undefined && !/^[a-f0-9]{64}$/.test(manifest.runtimeJsSha256)) throw new NeuralModelError('manifest', 'Invalid neural runtime manifest.');
  for (const name of NEURAL_MODEL_NAMES) {
    const entry = manifest.models?.[name];
    if (!entry || !/^[\w.-]+$/.test(entry.file) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new NeuralModelError('manifest', `Invalid ${name} model manifest.`);
    if (entry.chunks !== undefined && (!Array.isArray(entry.chunks) || !entry.chunks.length
      || entry.chunks.some(chunk => !chunk || !/^[\w.-]+$/.test(chunk.file) || !Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes >= 50_000_000 || !/^[a-f0-9]{64}$/.test(chunk.sha256))
      || new Set(entry.chunks.map(chunk => chunk.file)).size !== entry.chunks.length
      || entry.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0) !== entry.bytes)) throw new NeuralModelError('manifest', `Invalid ${name} model chunks.`);
  }
  return manifest;
}

export async function neuralModelCache(required = true): Promise<Cache | undefined> {
  try {
    if (!globalThis.caches) throw new Error('Cache Storage unavailable');
    return await caches.open(NEURAL_MODEL_CACHE);
  } catch (cause) {
    if (required) throw new NeuralModelError('storage', 'Cannot access browser model storage.', { cause });
  }
}

/** A saved manifest permits inspection of downloaded weights when hosting is unreachable. */
export async function loadNeuralManifest(assets: string, signal?: AbortSignal): Promise<{ manifest: NeuralManifest; offline: boolean }> {
  const url = new URL('models/manifest.json', assets), cache = await neuralModelCache(false);
  const timeout = AbortSignal.timeout(15000);
  try {
    const response = await fetch(url, { cache: 'no-cache', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = validateManifest(await response.json());
    await cache?.put(url, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })).catch(() => {});
    return { manifest, offline: false };
  } catch (cause) {
    signal?.throwIfAborted();
    const saved = await cache?.match(url);
    if (saved) return { manifest: validateManifest(await saved.json()), offline: true };
    throw new NeuralModelError('manifest', 'Neural model catalogue unavailable on this address.', { cause });
  }
}

export function neuralModelUrl(assets: string, entry: NeuralModelEntry): string {
  const url = new URL(`models/${entry.file}`, assets);
  url.searchParams.set('sha256', entry.sha256);
  return url.href;
}

function matchesModel(url: URL, response: Response, entry: NeuralModelEntry, name: NeuralModelName): boolean {
  return url.searchParams.get('sha256') === entry.sha256
    && Number(response.headers.get('X-Magna-Model-Bytes')) === entry.bytes
    && (response.headers.get('X-Magna-Model-Name') === name || url.pathname.split('/').pop() === entry.file);
}

/** Reuse identified weights throughout this site's storage, independently of the hosting path or filename. */
async function storedModel(cache: Cache, assets: string, entry: NeuralModelEntry, name: NeuralModelName): Promise<{ url: string; response: Response } | undefined> {
  const url = neuralModelUrl(assets, entry), response = await cache.match(url);
  if (response) return { url, response };
  for (const request of await cache.keys()) {
    const candidate = new URL(request.url);
    if (candidate.searchParams.get('sha256') !== entry.sha256) continue;
    const saved = await cache.match(request);
    if (saved && matchesModel(candidate, saved, entry, name)) return { url: request.url, response: saved };
  }
}

/** Selection preflight: inspect saved metadata without reading weight bytes. Fetch only the small catalogue
 * if weights exist but this hosting address has no saved catalogue. Inference still verifies all bytes. */
export async function hasStoredNeuralModels(assets: string): Promise<boolean> {
  try {
    const cache = await neuralModelCache(false);
    if (!cache) return false;
    const saved = await cache.match(new URL('models/manifest.json', assets).href);
    if (!saved && !(await cache.keys()).some(request => new URL(request.url).searchParams.has('sha256'))) return false;
    const manifest = saved ? validateManifest(await saved.json()) : (await loadNeuralManifest(assets)).manifest;
    for (const name of NEURAL_MODEL_NAMES) {
      const entry = manifest.models[name], model = await storedModel(cache, assets, entry, name);
      if (!model || Number(model.response.headers.get('X-Magna-Model-Bytes')) !== entry.bytes) return false;
    }
    return true;
  } catch { return false; }
}

export async function listStoredNeuralModels(assets: string, manifest?: NeuralManifest): Promise<StoredNeuralModel[]> {
  const cache = await neuralModelCache();
  const result: StoredNeuralModel[] = [];
  for (const request of await cache!.keys()) {
    const url = new URL(request.url);
    if (!url.searchParams.has('sha256')) continue;
    const response = await cache!.match(request);
    if (!response) continue;
    const name = manifest && NEURAL_MODEL_NAMES.find(name => matchesModel(url, response, manifest.models[name], name));
    const size = Number(response?.headers.get('X-Magna-Model-Bytes'));
    result.push({ url: request.url, name: name ?? response?.headers.get('X-Magna-Model-Name') ?? url.pathname.split('/').pop()!,
      bytes: name ? manifest!.models[name].bytes : size > 0 ? size : undefined, current: !!name,
      profile: response?.headers.get('X-Magna-Model-Profile') ?? undefined });
  }
  return result;
}

export async function verifyNeuralFile(bytes: Uint8Array, entry: Pick<NeuralModelFile, 'bytes' | 'sha256'>): Promise<boolean> {
  if (bytes.byteLength !== entry.bytes) return false;
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('') === entry.sha256;
}

export async function obtainNeuralModel(assets: string, manifest: NeuralManifest, name: NeuralModelName, options: {
  signal?: AbortSignal; requireStorage?: boolean; onProgress?: (event: ModelTransfer) => void; onStorageFailure?: () => void;
} = {}): Promise<Uint8Array<ArrayBuffer>> {
  const { signal, onProgress } = options, entry = manifest.models[name], url = neuralModelUrl(assets, entry);
  signal?.throwIfAborted();
  const cache = await neuralModelCache(options.requireStorage ?? false);
  if (!cache) options.onStorageFailure?.();
  const stored = cache && await storedModel(cache, assets, entry, name);
  if (stored) {
    const bytes = new Uint8Array(await stored.response.arrayBuffer());
    onProgress?.({ name, phase: 'verify', received: bytes.length, total: entry.bytes });
    const valid = await verifyNeuralFile(bytes, entry); signal?.throwIfAborted();
    if (valid) return bytes;
    await cache?.delete(stored.url);
  }
  const bytes = new Uint8Array(entry.bytes);
  let received = 0;
  for (const part of entry.chunks ?? [entry]) {
    const partUrl = new URL(`models/${part.file}`, assets); partUrl.searchParams.set('sha256', part.sha256);
    const response = await fetch(partUrl.href, { signal });
    if (!response.ok) throw new NeuralModelError('download', `Cannot download ${name} weights: HTTP ${response.status}`);
    const start = received;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          signal?.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (received + value.byteLength > start + part.bytes) throw new NeuralModelError('integrity', `Invalid ${name} model size.`);
          bytes.set(value, received); received += value.byteLength;
          onProgress?.({ name, phase: 'download', received, total: entry.bytes });
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    } else {
      const buffer = new Uint8Array(await response.arrayBuffer());
      received += buffer.byteLength;
      if (buffer.byteLength === part.bytes) bytes.set(buffer, start);
    }
    if (received - start !== part.bytes || (entry.chunks && !await verifyNeuralFile(bytes.subarray(start, received), part))) throw new NeuralModelError('integrity', `Invalid ${name} model chunk: integrity check failed.`);
  }
  signal?.throwIfAborted();
  onProgress?.({ name, phase: 'verify', received, total: entry.bytes });
  if (received !== entry.bytes || !await verifyNeuralFile(bytes, entry)) throw new NeuralModelError('integrity', `Invalid ${name} model: integrity check failed.`);
  signal?.throwIfAborted();
  if (cache) {
    onProgress?.({ name, phase: 'save', received, total: entry.bytes });
    try {
      await cache.put(url, new Response(bytes, { headers: { 'X-Magna-Model-Name': name, 'X-Magna-Model-Bytes': String(entry.bytes), 'X-Magna-Model-Profile': manifest.profile } }));
    } catch (cause) {
      if (options.requireStorage) throw new NeuralModelError('storage', 'Cannot save model: browser storage is full or unavailable.', { cause });
      options.onStorageFailure?.();
    }
  }
  return bytes;
}

/** Only this app's model cache is affected; projects and other site data are untouched. */
export async function deleteStoredNeuralModel(url: string): Promise<void> {
  const cache = await neuralModelCache();
  try { await cache!.delete(url); }
  catch (cause) { throw new NeuralModelError('storage', 'Cannot remove model from browser storage.', { cause }); }
}
