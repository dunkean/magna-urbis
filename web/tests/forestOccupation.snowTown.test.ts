import { describe, expect, it } from 'vitest';
import type { ForestOccupation } from '../../rust/bridge/terrainForest';
import { GROUND_OCCUPATION_GLSL } from '../../rust/bridge/terrainMaterialOccupation';
import type { LandUseLayer } from '../src/gen/types';
import { forestOccupation, withOccupationShapes } from '../src/ui/forestOccupation';

const rect = (x: number, y: number, w: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + w },
  { x, y: y + w },
];
const town = [
  { x: 40, y: 30 },
  { x: 240, y: 130 },
  { x: 200, y: 220 },
  { x: 20, y: 120 },
];
const layer: LandUseLayer = { areas: [{ kind: 'forest', poly: rect(0, 0, 300) }], reserve: [town], ways: [], farmsteads: [] };
function distance(o: ForestOccupation, x: number, y: number, channel: number): number {
  const gx = ((x - o.x) / o.width) * o.n - 0.5,
    gy = ((y - o.y) / o.width) * o.n - 0.5;
  const i = Math.floor(gx),
    j = Math.floor(gy),
    fx = gx - i,
    fy = gy - j;
  let value = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) value += o.rgba[((j + dy) * o.n + i + dx) * 4 + channel] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
  return (((value - 128) / 16) * o.width) / o.n;
}

describe('snow on smooth town ground', () => {
  it.each([48, 128])('preserves an oblique reserve edge through a grid-changing building merge (%i)', maxN => {
    const source = forestOccupation(layer, maxN, 1)!;
    const merged = withOccupationShapes(source, [{ outer: rect(270, 250, 12), holes: [] }]);
    for (const o of [source, merged])
      for (let x = 85; x < 195; x += 2.7) {
        const edge = x * 0.5 + 10;
        // Both the open ground and the remaining woods must cross at the actual polygon, between cell centres.
        expect(distance(o, x, edge + 1, 0)).toBeGreaterThan(0);
        expect(distance(o, x, edge - 1, 0)).toBeLessThan(0);
        expect(distance(o, x, edge + 1, 1)).toBeLessThan(0);
        expect(distance(o, x, edge - 1, 1)).toBeGreaterThan(0);
      }
  });

  it('places every occupation material below snow without a town exemption', () => {
    const groundPass = GROUND_OCCUPATION_GLSL.slice(GROUND_OCCUPATION_GLSL.indexOf('void applyGroundOccupation('));
    const opacity = groundPass.match(/float a=([^;]+);/)?.[1];
    expect(opacity).toBeDefined();
    expect(opacity).toContain('(1.-snow)*covered');
    expect(opacity).not.toContain('wTown');
  });
});
