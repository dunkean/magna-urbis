import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmNeuralDownload, prepareBrowserNeuralDownload } from '../../src/v2/neuralDownload';
import { neuralDownloadMessages } from '../../src/v2/neuralDownloadMessages';
import { translate } from '../../src/v2/i18n';
import { LANGUAGES } from '../../src/v2/languages';

afterEach(() => vi.unstubAllGlobals());
describe('on-demand browser neural downloads', () => {
  it('rejects CPU-only generation before GPU setup, consent, storage or model transfers', async () => {
    const fetch = vi.fn(), requestAdapter = vi.fn(), persist = vi.fn(), progress = vi.fn();
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('navigator', { gpu: { requestAdapter }, storage: { persist } });
    await expect(prepareBrowserNeuralDownload('https://example.test/neural/', new AbortController().signal, progress, 'cpu')).rejects.toThrow('Le relief procédural fonctionne sur CPU.');
    expect(fetch).not.toHaveBeenCalled(); expect(requestAdapter).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });
  it('does not contact the network or request storage when WebGPU is unavailable', async () => {
    const fetch = vi.fn(), persist = vi.fn();
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('navigator', { storage: { persist } });
    await expect(prepareBrowserNeuralDownload('https://example.test/neural/', new AbortController().signal, vi.fn())).rejects.toThrow('WebGPU is unavailable.');
    expect(fetch).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
  });
  it('checks device creation even if the warning was previously accepted', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'accepted' });
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => { throw Error('device denied'); } }) } });
    await expect(confirmNeuralDownload()).rejects.toThrow('No models were downloaded.');
  });
  it('remembers acceptance and requests persistence without fetching any model', async () => {
    const destroy = vi.fn(), persist = vi.fn(async () => false), fetch = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => 'accepted' }); vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => ({ destroy }) }) }, storage: { persist } });
    await confirmNeuralDownload();
    expect(destroy).toHaveBeenCalledOnce(); expect(persist).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it('translates every new source string into every V2 language', () => {
    for (const row of neuralDownloadMessages) for (const [index, language] of LANGUAGES.entries()) {
      expect(translate(row[0], language.code)).toBe(row[index]);
    }
  });
});
