import { describe, expect, it } from 'vitest';
import { gpuCapacityError, hydrologyGrid, maxGpuSource, openSeaBand, openSeaRadius, physicalPlan, physicalPlanSummary, preferCpuGeneration, sourceDefinition, surfaceGrid, terrainCapability, unsupportedExplicitGpuResolution } from '../../rust/bridge/terrainDefinition';
import { finalizePhysicalSurfacePlan } from '../../rust/bridge/terrainGenerationRecipe';
import { effectiveTerrainSettings } from '../src/v2/terrainSettings';
import { defaultSettings } from '../src/v2/settings';
import { validateSettings } from '../src/v2/project';
import { isTerrainExpertControl } from '../src/v2/terrainControlAccess';

describe('physical terrain definition', () => {
  it('derives the physical source from metres independently of overview pixels', () => {
    const settings = defaultSettings(); settings.extent = 200000; settings.runtime = { ...settings.runtime!, source: 'neural-wasm' };
    settings.terrain = { sampleSpacing: 30, resolution: 64 };
    const first = sourceDefinition(effectiveTerrainSettings(settings, 200000));
    settings.terrain.resolution = 1024;
    const second = sourceDefinition(effectiveTerrainSettings(settings, 200000));
    expect(first).toEqual(second);
    expect(first.n).toBe(6667);
    expect(first.spacing).toBeCloseTo(200000 / 6667);
    expect(first.nativeSpacing).toBe(30);
    expect(() => validateSettings(settings)).not.toThrow();
  });

  it('rejects incompatible technology, definition and working raster budgets', () => {
    expect(() => sourceDefinition({ width: 200001, source: 'neural' })).toThrow(/largeur/);
    expect(() => sourceDefinition({ width: 100001, source: 'procedural' })).toThrow(/largeur/);
    expect(() => sourceDefinition({ width: 10000, source: 'neural', sampleSpacing: 10 })).toThrow(/pas/);
    expect(() => sourceDefinition({ width: 500, source: 'neural', sampleSpacing: 1000 })).toThrow(/pas/);
    expect(() => sourceDefinition({ width: 500, source: 'neural', sampleSpacing: 100 })).toThrow(/pas/);
    expect(() => sourceDefinition({ width: 10000, source: 'procedural', sampleSpacing: 2 })).toThrow(/budget/);
    expect(() => sourceDefinition({ width: 100000, source: 'procedural', sampleSpacing: 1 })).toThrow(/maximum/);
    expect(() => sourceDefinition({ width: NaN, source: 'neural' })).toThrow();
  });

  it('retains fixed profile constraints and the actual information in imported sources', () => {
    expect(terrainCapability({ source: 'neural-python', baseModel: 'residual8k' })).toMatchObject({ minWidth: 40000, maxWidth: 40000 });
    const fixed = sourceDefinition({ width: 40000, source: 'neural-python', baseModel: 'residual8k' });
    expect(fixed.n).toBe(1024);
    expect(() => sourceDefinition({ width: 40000, source: 'neural-python', baseModel: 'residual8k', sampleSpacing: 30 })).toThrow(/Tile40/);
    const sketch = { version: 1 as const, processing: 'surface' as const, resolution: 64, heights: [] };
    expect(sourceDefinition({ width: 10000, sketch }).n).toBe(64);
    expect(() => sourceDefinition({ width: 10000, sketch, sampleSpacing: 30 })).toThrow(/native/);
    expect(sourceDefinition({ width: 2400, sourceNativeResolution: 2048 }).n).toBe(2048);
  });

  it('keeps all erosion budgets in super advanced controls while physical definition stays ordinary', () => {
    for (const path of ['terrain.erosion', 'terrain.erosionTuning.incision', 'terrain.procedural.regionalN', 'terrain.procedural.surfaceN', 'terrain.procedural.posterior.strength', 'terrain.hydrology.condDepth'])
      expect(isTerrainExpertControl(path), path).toBe(true);
    expect(isTerrainExpertControl('terrain.sampleSpacing')).toBe(false);
    expect(isTerrainExpertControl('terrain.motifSize')).toBe(false);
  });

  it('keeps automatic generation and imported or painted sources out of the explicit GPU rejection', () => {
    const explicit = { source: 'procedural' as const, generationCompute: 'gpu-erosion' as const };
    expect(unsupportedExplicitGpuResolution(explicit, 334)).toBe(false);
    expect(unsupportedExplicitGpuResolution(explicit, 4096)).toBe(false);
    expect(unsupportedExplicitGpuResolution(explicit, 4097)).toBe(true);
    expect(unsupportedExplicitGpuResolution({ source: 'procedural' }, 4097)).toBe(false);
    expect(unsupportedExplicitGpuResolution({ ...explicit, source: 'neural-wasm' }, 6667)).toBe(false);
    expect(unsupportedExplicitGpuResolution({ ...explicit, sketch: { version: 1, resolution: 64, heights: [], processing: 'surface' } }, 64)).toBe(false);
    expect(unsupportedExplicitGpuResolution({ ...explicit, zones: { version: 1, resolution: 8, weights: Array(8 * 8 * 5).fill(0) } }, 8192)).toBe(false);
  });

  it('sizes the erosion and water grids from the source without exceeding it', () => {
    expect(surfaceGrid(640, 200)).toBe(200);
    expect(surfaceGrid(640, 1024)).toBe(640);
    expect(surfaceGrid(640, 2048)).toBe(1229);
    expect(surfaceGrid(640, 4096)).toBe(2048);
    expect(surfaceGrid(640, 512, 300)).toBe(300);
    expect(hydrologyGrid(1024, 200)).toBe(256);
    expect(hydrologyGrid(1024, 80)).toBe(256);
    expect(hydrologyGrid(1024, 300)).toBe(512);
    expect(hydrologyGrid(512, 4096)).toBe(512);
  });

  it('keeps one physical time per surface iteration, and leaves the plan grid untouched', () => {
    const plan = () => Float32Array.from([664, 50, -600, 12, .85, .1125, .4, .025]);
    const settings = { width: 32000 } as Parameters<typeof finalizePhysicalSurfacePlan>[1];
    const same = plan(); finalizePhysicalSurfacePlan(same, settings, 1024);
    expect(Array.from(same)).toEqual(Array.from(plan()));
    const coarse = plan(); finalizePhysicalSurfacePlan(coarse, settings, 320);
    expect(coarse[0]).toBe(344); expect(coarse[1]).toBe(100);
    expect(coarse[6]).toBeCloseTo(.4); expect(coarse[5]).toBeCloseTo(.1125 / 4); expect(coarse[7]).toBeCloseTo(.025 / 4);
    const fine = plan(); finalizePhysicalSurfacePlan(fine, settings, 4096);
    expect(fine[1]).toBeCloseTo(32000 / 2048); expect(fine[7]).toBeCloseTo(.025 * (2048 / 640) ** 2);
  });

  it('keeps open sea beyond what the skipped stages reach', () => {
    const reach = { surfaceSteps: 12, surfaceCell: 50, regionalCell: 72, sourceCell: 32, warp: 10 };
    expect(openSeaBand(reach)).toBe(14 * 50 + 2 * 72 + 10 + 32);
    expect(openSeaRadius(886, 32768)).toBe(5);
    expect(openSeaRadius(32768, 32768)).toBeUndefined();
  });

  it('reports what an adapter cannot bind, and the size it can', () => {
    const defaults = { maxBufferSize: 256 * 1048576, maxStorageBufferBindingSize: 128 * 1048576 };
    expect(gpuCapacityError(defaults, 1024, 664)).toBeUndefined();
    expect(gpuCapacityError(defaults, 2048, 1253)).toMatch(/2896²/);
    expect(maxGpuSource(defaults)).toBe(2896);
    const wide = { maxBufferSize: 2 ** 32, maxStorageBufferBindingSize: 2 ** 31 };
    expect(gpuCapacityError(wide, 4096, 2072)).toBeUndefined();
    expect(maxGpuSource(wide)).toBe(4096);
  });

  it('chooses the backend by estimated cost, not by size', () => {
    const work = { sourceN: 200, regionalN: 320, regionalSteps: 22, surfaceN: 224, surfaceSteps: 12, pipelinesReady: false };
    expect(preferCpuGeneration(work)).toBe(false);
    expect(preferCpuGeneration({ ...work, sourceN: 4096, surfaceN: 2072 })).toBe(false);
    const tiny = { sourceN: 80, regionalN: 64, regionalSteps: 12, surfaceN: 0, surfaceSteps: 0, pipelinesReady: false };
    expect(preferCpuGeneration(tiny)).toBe(true);
  });

  it('summarises the same plan for every interface', () => {
    const definition = sourceDefinition({ width: 6000, source: 'procedural', sampleSpacing: 30 });
    const plan = physicalPlan({ definition, motifSize: 3000, hydrology: { engine: 'vector', resolution: 512, vectorResolution: 1024 } });
    expect(plan).toMatchObject({ sourceN: 200, erosionN: 200, hydrologyN: 256, backend: 'auto' });
    expect(physicalPlanSummary(plan, false)).toContain('hydrology 256² · 23.44 m');
    expect(physicalPlan({ definition, motifSize: 3000, compute: 'wasm' }).backend).toBe('cpu');
    expect(physicalPlan({ definition, motifSize: 3000, compact: true }).erosionN).toBeUndefined();
  });
});
