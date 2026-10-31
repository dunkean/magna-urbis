import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  loadNeuralManifest, listStoredNeuralModels, obtainNeuralModel, deleteStoredNeuralModel, neuralModelUrl,
  NEURAL_MODEL_NAMES, type NeuralManifest,
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
