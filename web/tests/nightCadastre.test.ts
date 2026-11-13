import { describe, expect, it, vi } from 'vitest';
import { resolveAppearance } from '../src/render/appearanceRecipe';
import { presetComposition } from '../src/render/composition';
import { city3dPlanOptions } from '../src/render/cityDrawOptions';
import { cityGroundLook } from '../src/render/cityEnvironment';
import { drawNightBuildings, nightRoof } from '../src/render/cityNight';
import { cityContourInterval, cityContourPaths, cityContoursPending, topographicContourInterval, type ContourWorkerRequest, type ContourWorkerResponse } from '../src/render/cityContours';
import type { TerrainData } from '../../rust/bridge/terrain';
import type { CompactBuildingVisual } from '../src/render/urbanBuildingLod';

describe('night and cadastral rendering contract', () => {
  it('drapes cadastre footprints in perspective without structure meshes or raised lot boundaries', () => {
    const composition = presetComposition('cadastre');
    const r = resolveAppearance({ style: 'cadastre', composition }, { mapStyle: 'cadastre' }, { nativeCities: true }, 'view3d');
    expect(r.composition.buildings).toMatchObject({ visible: true, look: 'footprints', meshes: 'none' });
    expect(r.city).toMatchObject({ buildingStyle: 'silhouette', painted: false, view: 'buildings' });
    expect(city3dPlanOptions(r)).toMatchObject({ buildingsVisible: true, layers: { lotEnclosureMeshes: false }, appearance: { style: 'silhouette' } });
  });

  it('applies night to the whole map and perspective sky/terrain, keeping snow colours subdued', () => {
    for (const preset of ['parchment', 'satellite'] as const) for (const target of ['view2d', 'view3d', 'export'] as const) {
      const composition = presetComposition(preset); composition.effects.ambience = 'night';
      const r = resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
      expect(r.palette.mapStyle).toBe('night');
      expect(cityGroundLook(r).ambience).toBe('night');
      expect(city3dPlanOptions(r).night).toBe(true);
    }
    const snow = nightRoof('#ffffff', true);
    expect([1, 3, 5].map(i => parseInt(snow.slice(i, i + 2), 16)).every(c => c < 130)).toBe(true);
  });

  it('keeps warm window cores visible at town overview without increasing lamp counts', () => {
    const radii: number[] = [], context = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fill() {},
      arc(_x: number, _y: number, radius: number) { radii.push(radius); }, createRadialGradient() { return { addColorStop() {} }; } };
    const buildings = Array.from({ length: 20 }, (_, i) => ({ id: `house-${i}`, function: 'collective', footprint: [{ outer: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }], holes: [] }] })) as unknown as CompactBuildingVisual[];
    drawNightBuildings(context as unknown as CanvasRenderingContext2D, buildings, { minX: -20, minY: -20, maxX: 40, maxY: 40 }, 4, true);
    expect(radii.length).toBeGreaterThan(0);
    // Every lamp consists of one halo, one warm core and one smaller white centre.
    expect(radii.filter((_, i) => i % 3 === 1).every(r => r >= 2.4)).toBe(true);
  });
});

describe('topographic contour density', () => {
  it('halves the normal base interval while adapting to low relief, steep slopes and overview scale', () => {
    expect(topographicContourInterval('hills', 1)).toBe(cityContourInterval('hills', 1) / 2);
    expect(topographicContourInterval('mountains', 1)).toBe(cityContourInterval('mountains', 1) / 2);
    expect(topographicContourInterval('flat', 1, 0, 3)).toBe(.25);
    expect(topographicContourInterval('hills', .1, .2)).toBeGreaterThanOrEqual(18);
    expect(topographicContourInterval('flat', .05)).toBeGreaterThan(topographicContourInterval('flat', 1));
  });

  it('queues extraction off-thread, waits for completion and retains the finished geometry', () => {
    const messages: ContourWorkerRequest[] = [], ready = vi.fn();
    let worker: { onmessage?: (event: { data: ContourWorkerResponse }) => void };
    class WorkerStub {
      constructor() { worker = this as unknown as typeof worker; }
      postMessage(data: ContourWorkerRequest) { messages.push(data); }
      terminate() {}
    }
    vi.stubGlobal('document', {}); vi.stubGlobal('Worker', WorkerStub);
    try {
      const terrain = { height: Float32Array.from({ length: 64 }, (_, i) => i % 8), resolution: 8, width: 80, caveMask: new Uint8Array() } as TerrainData;
      const pending = cityContourPaths(terrain, 'hills', 1, true, ready);
      expect(pending.thin).toBe(''); expect(cityContoursPending(terrain)).toBe(1);
      cityContourPaths(terrain, 'hills', 1, true, ready);
      expect(messages).toHaveLength(1); expect(messages[0].topographic).toBe(true);
      const paths = { step: pending.step, thin: 'M5,5L15,5', index: 'M5,25L15,25' };
      // The worker sends UTF-8 typed path commands (cityContours.ts TypedContourPaths).
      const encoder = new TextEncoder();
      worker!.onmessage!({ data: { id: messages[0].id, paths: { step: paths.step, thin: encoder.encode(paths.thin), index: encoder.encode(paths.index) } } });
      expect(cityContoursPending(terrain)).toBe(0); expect(ready).toHaveBeenCalledOnce();
      expect(cityContourPaths(terrain, 'hills', 1, true, ready)).toEqual(paths);
    } finally { vi.unstubAllGlobals(); }
  });
});
