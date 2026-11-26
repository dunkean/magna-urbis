import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armAutosave, clearAutosave, takeAutosave } from '../src/v2/autosave';
import { defaultSettings } from '../src/v2/settings';
import { V2_ENGINE_VERSION } from '../src/v2/cache';

const KEY = 'magna-urbis.v2.autosave',
  tag = `recipe:${V2_ENGINE_VERSION}`;
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('indexedDB', undefined);
});
afterEach(() => {
  clearAutosave();
  vi.unstubAllGlobals();
});

describe('V2 reload recovery', () => {
  it('retains settings through consecutive reloads before generation finishes', async () => {
    const settings = defaultSettings();
    settings.options.seed = 'keep-this-recipe';
    settings.extent = 12000;
    const raw = JSON.stringify({ tag, settings, mods: [], ui: { tab: 'cities' } });
    storage.set(KEY, raw);
    expect((await takeAutosave())?.settings).toEqual(settings);
    expect(storage.get(KEY)).toBe(raw);
    expect((await takeAutosave())?.settings.options.seed).toBe('keep-this-recipe');
    expect(storage.get(KEY)).toBe(raw);
  });
  it('keeps imported heightmap data in IndexedDB while restoring', async () => {
    const settings = defaultSettings();
    settings.extent = 1200;
    settings.options.importedHeight = { w: 16, h: 16, rgba: new Uint8Array(1024) };
    const entry = { tag, settings, mods: [] },
      marker = JSON.stringify({ tag, idb: true });
    const remove = vi.fn();
    vi.stubGlobal('indexedDB', {
      open: () => {
        const open: any = {};
        queueMicrotask(() => {
          open.result = {
            close() {},
            transaction: () => {
              const tx: any = {
                objectStore: () => ({
                  get: () => {
                    const request: any = { result: entry };
                    queueMicrotask(() => {
                      request.onsuccess?.();
                      tx.oncomplete?.();
                    });
                    return request;
                  },
                  delete: remove,
                }),
              };
              return tx;
            },
          };
          open.onsuccess();
        });
        return open;
      },
    });
    storage.set(KEY, marker);
    expect((await takeAutosave())?.settings.options.importedHeight?.rgba).toEqual(new Uint8Array(1024));
    expect((await takeAutosave())?.settings.options.importedHeight?.w).toBe(16);
    expect(storage.get(KEY)).toBe(marker);
    expect(remove).not.toHaveBeenCalled();
  });
  it('saves the current recipe on pagehide during generation and clears it only on explicit reset', async () => {
    const settings = defaultSettings();
    armAutosave(() => ({ settings, mods: [] }));
    settings.options.seed = 'edited-during-restore';
    window.dispatchEvent(new Event('pagehide'));
    expect((await takeAutosave())?.settings.options.seed).toBe('edited-during-restore');
    clearAutosave();
    window.dispatchEvent(new Event('pagehide'));
    expect(await takeAutosave()).toBeUndefined();
  });
  it('saves when a phone hides the page, with the time of the save', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', page);
    const settings = defaultSettings();
    armAutosave(() => ({ settings, mods: [], view: { cx: 1, cy: 2, scale: 3 } }));
    settings.options.seed = 'left-in-background';
    page.dispatchEvent(new Event('visibilitychange'));
    expect((await takeAutosave())?.settings.options.seed).not.toBe('left-in-background');
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    const saved = await takeAutosave();
    expect(saved?.settings.options.seed).toBe('left-in-background');
    expect(saved?.view).toEqual({ cx: 1, cy: 2, scale: 3 });
    expect(Math.abs(Date.now() - saved!.savedAt!)).toBeLessThan(60_000);
  });
  it('discards invalid and incompatible recipes', async () => {
    for (const raw of ['{', JSON.stringify({ tag: 'obsolete', settings: defaultSettings(), mods: [] }), JSON.stringify({ tag, settings: {}, mods: [] })]) {
      storage.set(KEY, raw);
      expect(await takeAutosave()).toBeUndefined();
      expect(storage.has(KEY)).toBe(false);
    }
  });
});
