import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveIllustrationFile, serviceUrl, targetSize } from '../../illustration/web/index.mjs';
import { illustrationContext, illustrationTerrainFromDecor } from '../src/ui/illustrationContext';
import { groundFrame, battlemapAvailability, battlemapCamera } from '../../illustration/web/framing.mjs';
import { neighbourView } from '../../illustration/web/atlas.mjs';

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
    expect(context.extentMetres).toMatchObject({ approximate: true });
    expect((context.extentMetres as { width: number }).width).toBeGreaterThan(1000);
  });
  it('reads the retained climate and valley from the decor query', () => {
    const terrain = illustrationTerrainFromDecor({ query: 'relief=valley&climate=oceanic&biome=forest', tags: { relief: 'mixed' }, stats: { minHeight: 40, maxHeight: 900 } });
    expect(terrain).toMatchObject({ relief: 'valley', climate: 'oceanic', biome: 'forest', minHeight: 40, maxHeight: 900 });
  });
  it('allows readable encounter scales and explains invalid battlemap framing', () => {
    const context = { projection: 'orthographic', extentMetres: { width: 60, height: 45 }, viewport: { width: 800, height: 600 } };
    expect(battlemapAvailability(context)).toMatchObject({ eligible: true, columns: 40, rows: 30, cellMetres: 1.5 });
    expect(battlemapAvailability({ ...context, extentMetres: { width: 600, height: 450 } }).eligible).toBe(false);
    expect(battlemapAvailability({ ...context, extentMetres: { width: 2, height: 2 } }).reason).toContain('Dézoomez');
    expect(battlemapAvailability({ projection: 'globe' }).eligible).toBe(false);
    expect(battlemapAvailability({ ...context, extentMetres: { width: NaN, height: 30 } }).eligible).toBe(false);
  });
  it('checks the far edge pixel density and actual 3D pitch independently of 2D zoom', () => {
    const context = { projection: 'perspective', viewport: { width: 800, height: 600 },
      camera: { x: 0, y: 0, distance: 50, pitch: 1.48, yaw: 0, exaggeration: 1 } };
    expect(battlemapAvailability(context)).toMatchObject({ eligible: true, approximate: true });
    expect(battlemapAvailability({ ...context, camera: { ...context.camera, pitch: Math.PI / 4 } }).reason).toContain('75°');
    expect(battlemapAvailability({ ...context, camera: { ...context.camera, navigation: 'walk' } }).eligible).toBe(false);
    expect(groundFrame({ ...context, camera: { ...context.camera, pitch: 0.1 } })).toBeUndefined();
    const large = { projection: 'orthographic', extentMetres: { width: 120, height: 90 }, viewport: context.viewport };
    expect(battlemapAvailability(large, 393216)).toMatchObject({ eligible: true, warning: expect.stringContaining('Cases fines') });
    expect(battlemapAvailability(large, 2097152).eligible).toBe(true);
    const vertical = groundFrame({ ...context, camera: { ...context.camera, distance: 20, pitch: Math.PI / 2, verticalFovDegrees: 90 } });
    expect(vertical?.width).toBeCloseTo(160 / 3);
    expect(vertical?.height).toBeCloseTo(40);
  });
  it('allows wider battlemap crops and configurable cells without using export upscaling as extra detail', () => {
    const context = { projection: 'orthographic', viewport: { width: 1200, height: 800 }, extentMetres: { width: 450, height: 300 } };
    expect(battlemapAvailability(context)).toMatchObject({ eligible: true, warning: expect.any(String) });
    const distant = { ...context, extentMetres: { width: 1200, height: 800 } };
    expect(battlemapAvailability(distant).eligible).toBe(false);
    expect(battlemapAvailability(distant, 1048576, 6).eligible).toBe(true);
    for (const size of [NaN, 0, 101]) expect(battlemapAvailability(context, 1048576, size).eligible).toBe(false);
  });
  it('moves neighbouring views by pixel-aligned overlaps without changing zoom', () => {
    const job = { outputSize: [900, 600], context: { projection: 'orthographic', camera: { cx: 500, cy: 500, scale: 3 }, extentMetres: { width: 60, height: 40 } } };
    expect(neighbourView(job, 'east')).toEqual({ cx: 548, cy: 500, scale: 3 });
    expect(neighbourView(job, 'north')).toEqual({ cx: 500, cy: 468, scale: 3 });
    expect(() => neighbourView({ ...job, context: { projection: 'perspective' } }, 'east')).toThrow('2D');
  });
  it('frames a 3D battlemap from oblique, distant, walking and excessively close cameras', () => {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
      for (const distance of [2.5, 80, 10000]) for (const cellMetres of [.5, 1.5, 6, 100]) for (const pixels of [393216, 1048576, 8294400]) {
        const camera = { x: 1000, y: 2000, distance, yaw: .7, pitch: .6, exaggeration: 3, navigation: 'walk' as const,
          heightAboveTargetMetres: 99999, altitudeMetres: 99999, viewAngleDegrees: 20, verticalFovDegrees: 180 / 3.7 };
        const prepared = battlemapCamera(camera,viewport,pixels,cellMetres);
        expect(prepared).toMatchObject({ x: camera.x, y: camera.y, yaw: camera.yaw, exaggeration: camera.exaggeration, navigation: 'orbit' });
        expect(prepared.heightAboveTargetMetres).toBeUndefined();
        expect(prepared.viewAngleDegrees).toBeUndefined();
        expect(battlemapAvailability({ projection: 'perspective', camera: prepared, viewport },pixels,cellMetres).eligible).toBe(true);
        expect(camera.distance).toBe(distance);
      }
    }
    const camera = { x: 1000, y: 2000, distance: 80, yaw: .7, pitch: 1.48, exaggeration: 1 };
    expect(battlemapCamera(camera,{ width: 1200, height: 800 })).toMatchObject(camera);
  });
  it('samples a close crop without importing distant terrain and building materials', () => {
    const layer = { height: { w: 100, h: 100, cell: 10, data: new Float32Array(10000).fill(50) }, water: new Uint8Array(10000).fill(1) } as unknown as Parameters<typeof illustrationContext>[0]['terrainLayer'];
    layer!.water[50 * 100 + 50] = 0;
    const buildings = { buildings: [{ footprint: [{ outer: [{ x: 560, y: 500 }, { x: 570, y: 510 }] }], culture: { culture: 'roman-core' }, materials: { base: 'remote' } }],
      materials: [{ id: 'remote', label: 'Distant marble' }] } as unknown as Parameters<typeof illustrationContext>[0]['buildings'];
    const context = illustrationContext({ sourceStyle: 'render', seed: 'close', view: { cx: 505, cy: 505, scale: 100 }, width: 600, height: 600, terrainLayer: layer, buildings });
    expect(context.visibleScene).toMatchObject({ sampledTerrainCells: 1, water: { land: 1 }, sampledBuildings: 0 });
    expect(JSON.stringify(context)).not.toContain('Distant marble');
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
