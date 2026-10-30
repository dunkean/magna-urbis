import { describe, expect, it } from 'vitest';
import { previewTerrainData, TERRAIN_STAGE_OUTPUTS } from '../src/v2/terrainStagePreview';
import { stagesForAction } from '../src/v2/stageRegistry';
import type { TerrainSettings } from '../../rust/bridge/terrain';

const settings = { width: 1000, motifSize: 3000 } as TerrainSettings;
describe('stage inspection', () => {
  it('limits the run scope to the selected output and leaves later stages unexecuted', () => {
    expect(stagesForAction('terrain', undefined, 'relief-source')).toEqual(['relief-source']);
    const regional = stagesForAction('terrain', undefined, 'relief-regional');
    expect(regional.at(-1)).toBe('relief-regional');
    expect(regional).not.toContain('water-hydrology');
    expect(regional).not.toContain('cover-climate');
    expect(TERRAIN_STAGE_OUTPUTS['relief-source']).toBe('initialize');
    expect(TERRAIN_STAGE_OUTPUTS['relief-regional']).toBe('regional');
    expect(stagesForAction('terrain')).toContain('cover-climate');
  });
  it('retains raw metre values and computes unit normals without adding water or cover', () => {
    const source = Float32Array.from({ length: 16 }, (_, i) => 10 + i % 4);
    const data = previewTerrainData(source, settings, 4, 12);
    expect(data.height).toEqual(source);
    expect(data.field?.data).toEqual(source);
    expect(data.field?.data).not.toBe(source);
    expect(data.normalX[5]).toBeLessThan(0);
    for (let i = 0; i < 16; i++) expect(Math.hypot(data.normalX[i], data.normalY[i], data.normalZ[i])).toBeCloseTo(1);
    expect(data.minHeight).toBe(10); expect(data.maxHeight).toBe(13);
    expect(data.water).toBeUndefined(); expect(data.hydrology).toBeUndefined();
    expect(Array.from(source)).toEqual(Array.from({ length: 16 }, (_, i) => 10 + i % 4));
  });
  it('resamples a flat buffer without inventing elevation and rejects invalid snapshots', () => {
    const data = previewTerrainData(new Float32Array(16).fill(1.25), settings, 8, 0);
    expect(data.height.length).toBe(64); expect(data.height.every(v => v === 1.25)).toBe(true);
    expect(data.normalZ.every(v => v === 1)).toBe(true);
    expect(() => previewTerrainData(new Float32Array([NaN]), settings, 4, 0)).toThrow();
    expect(() => previewTerrainData(new Float32Array(3), settings, 4, 0)).toThrow();
  });
});
