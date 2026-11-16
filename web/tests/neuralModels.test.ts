import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { obtainNeuralRuntime } from '../../rust/bridge/neuralRuntime';
import {
  loadNeuralManifest, listStoredNeuralModels, obtainNeuralModel, deleteStoredNeuralModel, neuralModelUrl,
  NEURAL_MODEL_NAMES, type NeuralManifest,
  hasStoredNeuralModels,
} from '../../rust/bridge/neuralModels';

const assets = 'https://example.test/neural/';
const payload = new Uint8Array([1, 2, 3, 4]);
let manifest: NeuralManifest;
let files: Map<string, Response>;
let put: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
const key = (value: string | URL | Request) => typeof value === 'string' ? value : value instanceof URL ? value.href : value.url;
beforeEach(async () => {
  files = new Map();
  vi.stubGlobal('crypto', webcrypto);
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', payload)).toString('hex');
  manifest = { profile: 'coarse4-nf4-b75-t2-distilled-decoder', engineRevision: 'test', runtimeSha256: 'a'.repeat(64), models: Object.fromEntries(NEURAL_MODEL_NAMES.map(name => [name, { file: `${name}.bin`, bytes: 4, sha256: hash }])) as NeuralManifest['models'] };
  put = vi.fn(async (url, response: Response) => { files.set(key(url), response.clone()); });
  vi.stubGlobal('caches', { open: vi.fn(async () => ({
    match: vi.fn(async url => files.get(key(url))?.clone()), put,
    delete: vi.fn(async url => files.delete(key(url))),
    keys: vi.fn(async () => [...files.keys()].map(url => new Request(url))),
  })) });
  fetcher = vi.fn(async () => new Response(payload)); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe('browser neural model storage shared by settings and inference', () => {
  it('opens setup for an absent or incomplete model set without contacting the network', async () => {
    expect(await hasStoredNeuralModels(assets)).toBe(false);
    files.set(new URL('models/manifest.json',assets).href,new Response(JSON.stringify(manifest)));
    await obtainNeuralModel(assets,manifest,'base');fetcher.mockClear();
    expect(await hasStoredNeuralModels(assets)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('recognizes a complete current set and notices deletion or a different model address', async () => {
    files.set(new URL('models/manifest.json',assets).href,new Response(JSON.stringify(manifest)));
    for(const name of NEURAL_MODEL_NAMES)await obtainNeuralModel(assets,manifest,name);
    fetcher.mockClear();
    expect(await hasStoredNeuralModels(assets)).toBe(true);
    expect(await hasStoredNeuralModels('https://example.test/other/')).toBe(false);
    await deleteStoredNeuralModel(neuralModelUrl(assets,manifest.models.coarse));
    expect(await hasStoredNeuralModels(assets)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('assembles ordered chunks, verifies them and the whole file, then reuses the whole cache offline', async () => {
    const chunks = [payload.slice(0, 2), payload.slice(2)];
    manifest.models.base.chunks = await Promise.all(chunks.map(async (bytes, i) => ({ file: `base.bin.part${i}`, bytes: bytes.length,
      sha256: Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex') })));
    fetcher.mockImplementation(async (url: string) => new Response(chunks[url.includes('part0') ? 0 : 1]));
    expect(await obtainNeuralModel(assets, manifest, 'base', { requireStorage: true })).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValue(new TypeError('Offline'));
    expect(await obtainNeuralModel(assets, manifest, 'base')).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects a corrupt chunk even when the whole-file hash would pass', async () => {
    manifest.models.base.chunks = [{ ...manifest.models.base, file: 'base.bin.part0', sha256: 'b'.repeat(64) }];
    await expect(obtainNeuralModel(assets, manifest, 'base')).rejects.toMatchObject({ code: 'integrity' });
    expect(files.size).toBe(0);
  });
  it('rejects a whole-file mismatch after valid chunk checks', async () => {
    manifest.models.base.chunks = [{ ...manifest.models.base, file: 'base.bin.part0' }];
    manifest.models.base.sha256 = 'b'.repeat(64);
    await expect(obtainNeuralModel(assets, manifest, 'base')).rejects.toMatchObject({ code: 'integrity' });
    expect(files.size).toBe(0);
  });
  it('rejects invalid chunk paths, totals and hashes in the downloaded catalogue', async () => {
    for (const part of [{ file: '../escape', bytes: 4, sha256: 'a'.repeat(64) }, { file: 'base.part0', bytes: 3, sha256: 'a'.repeat(64) }, { file: 'base.part0', bytes: 4, sha256: 'invalid' }]) {
      manifest.models.base.chunks = [part];
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(manifest)));
      await expect(loadNeuralManifest(assets)).rejects.toMatchObject({ code: 'manifest' });
    }
    expect(files.size).toBe(0);
  });
  it('verifies the runtime build and reuses the identified JS/WASM offline', async () => {
    manifest.runtimeSha256 = manifest.models.base.sha256; manifest.runtimeJsSha256 = manifest.models.base.sha256;
    expect((await obtainNeuralRuntime(assets, manifest)).wasm).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValue(new TypeError('Offline'));
    expect((await obtainNeuralRuntime(assets, manifest)).wasm).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects an incompatible runtime before accepting weights', async () => {
    await expect(obtainNeuralRuntime(assets, manifest)).rejects.toThrow('integrity check failed');
    expect([...files.keys()].some(url => url.includes('.wasm?'))).toBe(false);
  });
  it('downloads, verifies and reuses weights without another network request', async () => {
    const onProgress = vi.fn();
    expect(await obtainNeuralModel(assets, manifest, 'base', { requireStorage: true, onProgress })).toEqual(payload);
    expect(onProgress.mock.calls.map(call => call[0].phase)).toEqual(['download', 'verify', 'save']);
    expect(await obtainNeuralModel(assets, manifest, 'base')).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await listStoredNeuralModels(assets, manifest)).toEqual([expect.objectContaining({ name: 'base', bytes: 4, current: true })]);
  });
  it('rejects truncated, oversized and corrupt downloads without storing them', async () => {
    for (const bytes of [[1, 2], [1, 2, 3, 4, 5], [4, 3, 2, 1]]) {
      fetcher.mockImplementationOnce(async () => new Response(new Uint8Array(bytes)));
      await expect(obtainNeuralModel(assets, manifest, 'base', { requireStorage: true })).rejects.toMatchObject({ code: 'integrity' });
    }
    expect(files.size).toBe(0);
  });
  it('repairs corrupt cached weights before inference', async () => {
    files.set(neuralModelUrl(assets, manifest.models.base), new Response(new Uint8Array([4, 3, 2, 1])));
    expect(await obtainNeuralModel(assets, manifest, 'base')).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not mark a quota failure as downloaded; inference can still use the bytes', async () => {
    put.mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
    await expect(obtainNeuralModel(assets, manifest, 'base', { requireStorage: true })).rejects.toMatchObject({ code: 'storage' });
    expect(files.size).toBe(0);
    const onStorageFailure = vi.fn();
    expect(await obtainNeuralModel(assets, manifest, 'base', { onStorageFailure })).toEqual(payload);
    expect(onStorageFailure).toHaveBeenCalledOnce();
  });
  it('reports inaccessible browser storage before a manual download', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(obtainNeuralModel(assets, manifest, 'base', { requireStorage: true })).rejects.toMatchObject({ code: 'storage' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels before committing partial files and keeps completed models', async () => {
    await obtainNeuralModel(assets, manifest, 'coarse', { requireStorage: true });
    const controller = new AbortController();
    await expect(obtainNeuralModel(assets, manifest, 'base', { signal: controller.signal, requireStorage: true, onProgress: event => {
      if (event.phase === 'download') controller.abort();
    } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await listStoredNeuralModels(assets, manifest)).toEqual([expect.objectContaining({ name: 'coarse' })]);
  });
  it('saves the catalogue for inspection when the model server is offline', async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(manifest)));
    expect(await loadNeuralManifest(assets)).toEqual({ manifest, offline: false });
    fetcher.mockRejectedValueOnce(new TypeError('Offline'));
    expect(await loadNeuralManifest(assets)).toEqual({ manifest, offline: true });
    expect(await listStoredNeuralModels(assets, manifest)).toEqual([]);
  });
  it('lists other revisions separately and deletes only the selected model', async () => {
    await obtainNeuralModel(assets, manifest, 'base', { requireStorage: true });
    const updated = structuredClone(manifest); updated.models.base.sha256 = 'b'.repeat(64);
    expect(await listStoredNeuralModels(assets, updated)).toEqual([expect.objectContaining({ name: 'base', current: false, bytes: 4 })]);
    await deleteStoredNeuralModel(neuralModelUrl(assets, manifest.models.base));
    expect(files.size).toBe(0);
  });
  it('rejects invalid manifest paths and checksums', async () => {
    manifest.models.base.file = '../escape';
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(manifest)));
    await expect(loadNeuralManifest(assets)).rejects.toMatchObject({ code: 'manifest' });
    expect(files.size).toBe(0);
  });
});
