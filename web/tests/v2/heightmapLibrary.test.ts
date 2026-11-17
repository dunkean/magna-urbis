import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HEIGHTMAP_LIBRARY, loadLibraryHeightmap, mountHeightmapFit } from '../../src/v2/heightmapLibrary';
import { acceptHeightmap, setHeightmapDefinition } from '../../src/v2/heightmapModel';
import { defaultSettings } from '../../src/v2/settings';

afterEach(() => vi.unstubAllGlobals());

// The fit panel only needs element creation and edit events, not a browser renderer.
class FitElement extends EventTarget {
  children: FitElement[] = [];
  parent?: FitElement;
  hidden = false;
  classList = { add() {} };
  setAttribute() {}
  removeAttribute() {}
  append(...elements: FitElement[]) { for (const element of elements) { element.parent = this; this.children.push(element); } }
  prepend(...elements: FitElement[]) { for (const element of elements) element.parent = this; this.children.unshift(...elements); }
  closest() { return this.parent; }
}

describe('heightmap file-size note', () => {
  function panel() {
    const events = new Map<string, EventListener>();
    vi.stubGlobal('document', { createElement: () => new FitElement(), addEventListener: (kind: string, listener: EventListener) => events.set(kind, listener) });
    const settings = defaultSettings();
    const load = () => acceptHeightmap(settings, { width: 20000,
      terrain: { version: 1, resolution: 8, processing: 'surface', heights: Array(64).fill(100) } }, 'map.png');
    load();
    const mounted = mountHeightmapFit(new FitElement() as unknown as HTMLElement, { getSettings: () => settings, onChange() {} });
    const note = (mounted.summary as unknown as FitElement).children[1];
    return { settings, mounted, note, load, events };
  }

  for (const selector of ['[data-setting-path="extent"]', '[data-slider-path="extent"]', '[data-field-path="terrain.sampleSpacing"]', '[data-extent]'])
    it(`dismisses the note immediately on ${selector}, until a new import`, () => {
      const { mounted, note, load, events } = panel();
      expect(note.hidden).toBe(false);
      const type = selector === '[data-extent]' ? 'click' : 'input';
      events.get(type)!({ type, target: { closest: (query: string) => query.includes(selector) ? {} : null } } as unknown as Event);
      expect(note.hidden).toBe(true);
      mounted.sync(); expect(note.hidden).toBe(true);
      load(); mounted.sync(); expect(note.hidden).toBe(false);
    });

  it('keeps the note when Size is only focused by a click', () => {
    const { note, events } = panel();
    events.get('click')!({ type: 'click', target: { closest: (query: string) => query.includes('[data-setting-path="extent"]') ? {} : null } } as unknown as Event);
    expect(note.hidden).toBe(false);
  });

  it('also dismisses after a footprint change applied through settings or Definition', () => {
    const { settings, mounted, note, load } = panel();
    settings.extent = 10000; mounted.sync(); expect(note.hidden).toBe(true);
    settings.extent = 20000; mounted.sync(); expect(note.hidden).toBe(true);
    load(); mounted.sync(); expect(note.hidden).toBe(false);
    setHeightmapDefinition(settings, 1250); mounted.sync(); expect(note.hidden).toBe(true);
  });
});

describe('bundled Heightmap inputs', () => {
  it('loads each bundled PNG as an editable surface with its metre range and extent', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const entry = HEIGHTMAP_LIBRARY.find(item => url.endsWith(item.file))!;
      const bytes = readFileSync(new URL(`../../src/v2/assets/heightmaps/${entry.file}`, import.meta.url));
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }));
    for (const entry of HEIGHTMAP_LIBRARY) {
      const loaded = await loadLibraryHeightmap(entry);
      expect(loaded.terrain.processing).toBe('surface');
      expect(loaded.terrain.resolution).toBe(entry.size[0]);
      expect(loaded.width ?? entry.extentM).toBe(entry.extentM);
      let min = Infinity, max = -Infinity;
      for (const height of loaded.terrain.heights) { min = Math.min(min, height); max = Math.max(max, height); }
      expect(min).toBeCloseTo(entry.verticalRangeM[0], 1);
      expect(max).toBeCloseTo(entry.verticalRangeM[1], 1);
    }
  });

  it('reports a failed library fetch without accepting a surface', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(loadLibraryHeightmap(HEIGHTMAP_LIBRARY[0])).rejects.toThrow('HTTP 404');
  });
});
