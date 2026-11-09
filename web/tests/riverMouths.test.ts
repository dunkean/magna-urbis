import { describe, expect, it } from 'vitest';
import { coastalRiverMouths } from '../src/render/riverMouths';

const bank = '<path d="M9,10L9,35L9,48L11,48L11,35L11,10Z" stroke="none"/>';
const raster = { n:20,width:100,water:Uint8Array.from({ length:400 }, (_, i) => i >= 200 ? 1 : 0) };
describe('coastal river mouths', () => {
  it('overlaps the ocean beyond the smoothing radius and keeps the repair idempotent', () => {
    const svg = coastalRiverMouths(bank,raster,10);
    expect(svg).toContain('data-coastal-mouths="1"');
    const cap = /L9\.00,([\d.]+)L11\.00,\1/.exec(svg);
    expect(Number(cap?.[1])).toBeGreaterThanOrEqual(68);
    expect(coastalRiverMouths(svg,raster,10)).toBe(svg);
  });
  it('leaves inland termini, lake shores and cropped coordinates alone', () => {
    expect(coastalRiverMouths(bank,{ ...raster,water:new Uint8Array(400) },10)).toBe(bank);
    expect(coastalRiverMouths(bank,{ ...raster,water:new Uint8Array(400).fill(2) },10)).toBe(bank);
    const crop = `<svg viewBox="0 0 100 100">${bank}</svg>`;
    expect(coastalRiverMouths(crop,raster,10)).toBe(crop);
  });
});
