import { describe, expect, it } from 'vitest';
import { landRings, waterRings } from '../../rust/bridge/urbanGeography';
import { decodeDecor, encodeDecor, type Decor } from '../src/ui/decor';

describe('shared vector urban geography', () => {
  it('retains a diagonal coast between coarse cells and physical water holes', () => {
    const n = 16, width = 160;
    const height = Float32Array.from({ length: n * n }, (_, i) => ((i % n) + Math.floor(i / n) + 1) * 10 - 150);
    const land = landRings(height, n, width);
    expect(land.length).toBe(1);
    const coast = land[0].filter(p => p.x > 20 && p.y > 20 && p.x < 120 && p.y < 120);
    expect(coast.length).toBeGreaterThan(5);
    expect(coast.every(p => Math.abs(p.x + p.y - 150) < 0.001)).toBe(true);
    const water = waterRings('<path fill="blue" d="M80,60L100,60L100,90L80,90Z M85,65L90,65L90,70L85,70Z"/><path fill="none" d="M0,0L160,160"/>');
    expect(water).toHaveLength(1);
    expect(water[0]).toHaveLength(2);
    const zero = new Float32Array(n * n);
    const decor: Decor = {
      raster: { width, n, height, water: new Uint8Array(n * n), waterLevel: height.slice(), riverWidth: zero, riverIds: new Int32Array(n * n), geometry: { land, water } },
      meta: { format: 'magna-decor', version: 1, id: 'vector', label: 'Vector', tags: {}, seed: 'vector', width, query: '', created: '', settlements: [], roadConfig: null, roads: null, waterSvg: '', stats: { land: 0.5, minHeight: -140, maxHeight: 160, riverKm: 0, roadKm: 0 } },
    };
    expect(decodeDecor(encodeDecor(decor)).raster.geometry).toEqual({ land, water });
    delete decor.raster.geometry;
    expect(decodeDecor(encodeDecor(decor)).raster.geometry?.land).toEqual(land);
  });
});
