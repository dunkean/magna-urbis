import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveIllustrationFile, serviceUrl, targetSize } from '../../illustration/web/index.mjs';
import { illustrationContext, illustrationTerrainFromDecor } from '../src/ui/illustrationContext';

afterEach(() => vi.unstubAllGlobals());

describe('shared illustration capture', () => {
  it('preserves landscape and portrait ratios within model alignment', () => {
    for (const [width, height] of [[1920, 1080], [768, 1024], [1000, 1000]]) {
      const size = targetSize(width, height);
      expect(size.width % 16).toBe(0); expect(size.height % 16).toBe(0);
      expect(Math.abs(size.width / size.height - width / height)).toBeLessThan(.04);
    }
  });
  it('does not transmit private API keys to arbitrary connector hosts', () => {
    expect(serviceUrl('http://127.0.0.1:8794/')).toBe('http://127.0.0.1:8794');
    for (const url of ['https://evil.example', 'http://127.0.0.1.evil.example', 'http://key@localhost:8794', 'http://localhost:8794/?key=secret']) expect(() => serviceUrl(url)).toThrow();
  });
  it('describes only settlements intersecting the captured viewport', () => {
    const context = illustrationContext({ sourceStyle: 'parchment', seed: 'test', view: { cx: 100, cy: 100, scale: 1 }, width: 100, height: 100,
      settlements: [{ name: 'Visible', culture: 'medieval', population: 200, center: { x: 100, y: 100 }, radius: 10 },
        { name: 'Outside', population: 200, center: { x: 500, y: 500 }, radius: 10 }] });
    expect((context.settlements as unknown[])).toHaveLength(1);
    expect(JSON.stringify(context)).toContain('Visible'); expect(JSON.stringify(context)).not.toContain('Outside');
  });
  it('describes used visible building materials rather than the full material catalogue', () => {
    const buildings = { materials: [{ id: 'tile', label: 'Clay tiles' }, { id: 'stone', label: 'Stone' }, { id: 'unused', label: 'Modern steel' }],
      buildings: [{ footprint: [{ outer: [{ x: 100, y: 100 }] }], culture: { culture: 'roman-core' },
        volumes: [{ roof_system: 'tiled_hip', materials: { cladding: 'tile' }, levels: [{ materials: { base: 'stone' } }] }] }] } as unknown as Parameters<typeof illustrationContext>[0]['buildings'];
    const context = illustrationContext({ sourceStyle: 'parchment', seed: 'test', view: { cx: 100, cy: 100, scale: 1 }, width: 100, height: 100,
      generation: { culture: 'roman-core', population: 30000 }, buildings });
    expect(JSON.stringify(context)).toContain('Clay tiles'); expect(JSON.stringify(context)).toContain('Stone');
    expect(JSON.stringify(context)).not.toContain('Modern steel');
    expect((context.generation as Record<string, unknown>).cultureDescription).toBe('Roman castrum core');
    expect((context.architecture as Record<string, unknown>).storeys).toEqual([1]);
  });
  it('uses the captured 3D framing rather than the inactive 2D viewport', () => {
    const context = illustrationContext({ sourceStyle: 'render', seed: 'view', view: { cx: -10000, cy: -10000, scale: 1 }, width: 800, height: 600,
      camera: { x: 1000, y: 1000, distance: 500, pitch: Math.PI / 4, yaw: 0, exaggeration: 1 },
      settlements: [{ name: 'Target village', culture: 'inca', population: 1000, center: { x: 1000, y: 1000 }, radius: 50 },
        { name: 'Behind camera', culture: 'roman-core', population: 30000, center: { x: 1000, y: 5000 }, radius: 50 }] });
    expect(context.projection).toBe('perspective');
    expect(JSON.stringify(context.settlements)).toContain('Target village');
    expect(JSON.stringify(context.settlements)).not.toContain('Behind camera');
    expect(context.extentMetres).toBeUndefined();
  });
  it('reads the retained climate and valley from the decor query', () => {
    const terrain = illustrationTerrainFromDecor({ query: 'relief=valley&climate=oceanic&biome=forest', tags: { relief: 'mixed' }, stats: { minHeight: 40, maxHeight: 900 } });
    expect(terrain).toMatchObject({ relief: 'valley', climate: 'oceanic', biome: 'forest', minHeight: 40, maxHeight: 900 });
  });
  it('opens Save As immediately with .png and writes the original image bytes', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    const write = vi.fn(), close = vi.fn(), picker = vi.fn().mockResolvedValue({ name: 'illustration-test.png', createWritable: async () => ({ write, close }) });
    vi.stubGlobal('showSaveFilePicker', picker);
    const saving = saveIllustrationFile(blob, 'illustration-test');
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'illustration-test.png', excludeAcceptAllOption: true,
      types: [{ description: 'Image PNG', accept: { 'image/png': ['.png'] } }] });
    expect(await saving).toContain('illustration-test.png');
    expect(write).toHaveBeenCalledWith(blob); expect(close).toHaveBeenCalledOnce();
  });
  it('does not download a file when Save As is cancelled', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue({ name: 'AbortError' }));
    expect(await saveIllustrationFile(new Blob(), 'image.png')).toBeUndefined();
  });
});
