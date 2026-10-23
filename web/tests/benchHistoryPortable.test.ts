import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Decor } from '../src/ui/decor';
import { decodeDecor } from '../src/ui/decor';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';

const saver = vi.hoisted(() => ({ download: vi.fn(async (decor: Decor | Promise<Decor>, _filename: string) => { await decor; }) }));
vi.mock('../src/ui/decorFile', () => ({ downloadDecorFile: saver.download, readDecorFile: vi.fn() }));
import { downloadHistory, readHistory, saveHistory } from '../src/ui/benchHistory';

const records = new Map<string, { entry: { id: string }; bytes: Uint8Array }>();
beforeAll(() => {
  const db = {
    createObjectStore() {},
    transaction(_name: string, mode: IDBTransactionMode) {
      const tx = { oncomplete: undefined as (() => void) | undefined, objectStore: () => ({
        get(id: string) {
          const request = { result: undefined as unknown };
          queueMicrotask(() => { request.result = structuredClone(records.get(id)); tx.oncomplete?.(); }); return request;
        },
        put(value: { entry: { id: string }; bytes: Uint8Array }) {
          expect(mode).toBe('readwrite'); const request = { result: value.entry.id };
          queueMicrotask(() => { records.set(value.entry.id, structuredClone(value)); tx.oncomplete?.(); }); return request;
        },
      }) }; return tx;
    },
  };
  vi.stubGlobal('indexedDB', { open() {
    const request = { result: db, onsuccess: undefined as (() => void) | undefined, onupgradeneeded: undefined as (() => void) | undefined };
    queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }); return request;
  } });
});
afterAll(() => { vi.unstubAllGlobals(); });

it('retains explicitly local cold history, but routes every download through portable saver before DB resolution', async () => {
  const zero = new Float32Array(1);
  const decor: Decor = { raster: { n: 1, width: 1, height: zero, water: new Uint8Array(1), waterLevel: zero,
    riverWidth: zero, riverIds: new Int32Array(1), geometry: { land: [], water: [] } },
  meta: { format: 'magna-decor', version: 1, id: 'local', label: 'Local C', tags: {}, seed: 'C', width: 1, query: '', created: '',
    settlements: [], roadConfig: null, roads: null, waterSvg: '', stats: { land: 1, minHeight: 0, maxHeight: 0, riverKm: 0, roadKm: 0 },
    pipeline: { stage: 'urban', urban: { layoutConfig: defaultLayoutConfig(), parcelConfig: defaultParcelConfig(), quarterSeed: 'q', parcelSeed: 'p',
      buildingState: { seed: 'b', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' }, cold: {
        store: { format: 'urban-building-chunks-1', sceneId: 'same-origin-only', fingerprint: '1'.repeat(64), sourceFingerprint: '2'.repeat(64) },
        counts: { schema_version: '1', generator_version: 'native', buildings: 6, refusals: 3, open_spaces: 0 } } } } } } };
  await saveHistory(decor, false);
  expect(decodeDecor(records.get('local')!.bytes).meta.pipeline!.urban!.buildingState!.cold).toEqual(decor.meta.pipeline!.urban!.buildingState!.cold);
  expect((await readHistory('local')).meta).toEqual(decor.meta);
  const download = downloadHistory('local');
  expect(saver.download).toHaveBeenCalledTimes(1);
  expect(saver.download.mock.calls[0][0]).toBeInstanceOf(Promise); // picker can open before this promise resolves
  expect(saver.download.mock.calls[0][1]).toBe('local.decor'); await download;
  await expect(saver.download.mock.calls[0][0]).resolves.toEqual(decor);
  await downloadHistory('missing', decor);
  expect(saver.download).toHaveBeenCalledTimes(2);
  await expect(downloadHistory('absent')).rejects.toThrow('Export absent');
});
