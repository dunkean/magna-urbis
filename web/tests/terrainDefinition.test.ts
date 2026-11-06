import { describe, expect, it } from 'vitest';
import { sourceDefinition, terrainCapability, unsupportedExplicitGpuResolution } from '../../rust/bridge/terrainDefinition';
import { effectiveTerrainSettings } from '../src/v2/terrainSettings';
import { defaultSettings } from '../src/v2/settings';
import { validateSettings } from '../src/v2/project';
import { isTerrainExpertControl } from '../src/v2/terrainControlAccess';

describe('physical terrain definition', () => {
  it('derives the physical source from metres independently of overview pixels', () => {
    const settings = defaultSettings(); settings.extent = 200000;
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
    expect(unsupportedExplicitGpuResolution(explicit, 334)).toBe(true);
    expect(unsupportedExplicitGpuResolution(explicit, 1024)).toBe(false);
    expect(unsupportedExplicitGpuResolution({ source: 'procedural' }, 334)).toBe(false);
    expect(unsupportedExplicitGpuResolution({ ...explicit, source: 'neural-wasm' }, 6667)).toBe(false);
    expect(unsupportedExplicitGpuResolution({ ...explicit, sketch: { version: 1, resolution: 64, heights: [], processing: 'surface' } }, 64)).toBe(false);
    expect(unsupportedExplicitGpuResolution({ ...explicit, zones: { version: 1, resolution: 8, weights: Array(8 * 8 * 5).fill(0) } }, 334)).toBe(false);
  });
});
