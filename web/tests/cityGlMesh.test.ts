import { describe, expect, it } from 'vitest';
import { earcut } from '../src/render/cityGlEarcut';
import { buildCityGlMesh } from '../src/render/cityGlMesh';
import { buildCityScene } from '../src/render/cityCanvas';
import type { Layout, Partition } from '../../rust/bridge/urban';

const triArea = (data: number[], idx: number[]): number => {
  let s = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    s += Math.abs((data[2 * b] - data[2 * a]) * (data[2 * c + 1] - data[2 * a + 1]) - (data[2 * c] - data[2 * a]) * (data[2 * b + 1] - data[2 * a + 1])) / 2;
  }
  return s;
};

describe('cityGl earcut', () => {
  it('covers a square with a hole exactly', () => {
    const data = [0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 3, 7, 7, 7, 7, 3];
    const idx = earcut(data, [4]);
    expect(idx.length / 3).toBe(8);
    expect(triArea(data, idx)).toBeCloseTo(100 - 16, 6);
  });
  it('triangulates a concave L of either winding', () => {
    const l = [0, 0, 6, 0, 6, 2, 2, 2, 2, 6, 0, 6];
    expect(triArea(l, earcut(l))).toBeCloseTo(20, 6);
    const r: number[] = []; for (let i = l.length - 2; i >= 0; i -= 2) r.push(l[i], l[i + 1]);
    expect(triArea(r, earcut(r))).toBeCloseTo(20, 6);
  });
  it('triangulates a many-vertex ring (z-order hashing path)', () => {
    const ring: number[] = []; for (let i = 0; i < 200; i++) { const a = i / 200 * Math.PI * 2, r = i % 2 ? 50 : 40; ring.push(Math.cos(a) * r, Math.sin(a) * r); }
    const idx = earcut(ring);
    expect(idx.length / 3).toBe(198);
  });
});

describe('cityGl mesh', () => {
  it('builds fills, outlines and rank-sorted street instances relative to the origin', () => {
    const sq = (x: number, y: number, s: number) => ({ outer: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }], holes: [] });
    const layout = {
      key: 'k', blocks: [{ shape: sq(1000, 1000, 50), kind: 'urban', quarter: 0 }], quarters: [{ shape: sq(1000, 1000, 50), phase: 0 }],
      streets: [{ path: [{ x: 990, y: 990 }, { x: 1060, y: 990 }, { x: 1060, y: 1060 }], widths: [6], rank: 0, role: 'main' }, { path: [{ x: 1000, y: 1025 }, { x: 1050, y: 1025 }], widths: [3], rank: 3, role: 'lane' }],
      enclosures: [], phases: [], structure: undefined,
    } as unknown as Layout;
    const partition = { key: 'k', parcels: [{ shape: sq(1000, 1000, 25), use: 'plot', block: 0 }, { shape: sq(1025, 1000, 25), use: 'garden', block: 0 }] } as unknown as Partition;
    const scene = buildCityScene([layout], [partition]);
    const mesh = buildCityGlMesh(scene);
    expect(mesh.fillRanges.blocks.count).toBe(6);
    expect(mesh.fillRanges.parcels.count).toBe(12);
    expect(mesh.lineRanges.parcels.count).toBe(16);
    expect(mesh.stats.segments).toBe(3);
    // Minor street first: rank ≤ 1 is the suffix holding the two main segments.
    expect(mesh.segments[5]).toBe(3);
    expect(mesh.segments.length / 6 - mesh.rankStart[1]).toBe(2);
    expect(Math.max(...Array.from(mesh.positions).map(Math.abs))).toBeLessThan(100);
  });
});
