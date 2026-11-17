import { describe, expect, it } from 'vitest';
import { vectorMouth } from '../src/v2/terrainProjection';

describe('vector course mouth label', () => {
  // 10 x 10 cells of 10 m: sea on row 9, a lake cell at (2, 2).
  const n = 10, width = 100, sea = new Uint8Array(n * n), lake = new Uint8Array(n * n);
  for (let x = 0; x < n; x++) sea[9 * n + x] = 1;
  lake[2 * n + 2] = 1;
  const water = { hydro: { n, sea }, lake };
  it('labels a course ending on the shore cell beside the sea "sea"', () => {
    expect(vectorMouth(water, { x: 55, y: 85 }, width)).toBe('sea');
    expect(vectorMouth(water, { x: 55, y: 95 }, width)).toBe('sea');
  });
  it('labels a course ending beside a lake "lake", and only a dry end "edge"', () => {
    expect(vectorMouth(water, { x: 35, y: 35 }, width)).toBe('lake');
    expect(vectorMouth(water, { x: 0, y: 50 }, width)).toBe('edge');
  });
});
