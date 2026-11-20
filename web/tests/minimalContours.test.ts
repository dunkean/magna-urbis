/** World-space extraction checks, independent of browser paths or view scale. */
import { describe, it, expect } from 'vitest';
import { minimalContours, minimalContourInterval, minimalContourSegments } from '../src/render/minimalContours';
describe('minimal terrain contours', () => {
  it('scales a dense round interval with height range and regional extent', () => {
    expect(minimalContourInterval(400, 6000)).toBe(5);
    expect(minimalContourInterval(800, 6000)).toBe(10);
    expect(minimalContourInterval(800, 40000)).toBe(20);
  });
  it('keeps absolute elevations on high plateaus and has no contours on flat or underwater fields', () => {
    expect([...minimalContours({ data: new Float32Array(16).fill(800), n: 4, width: 6000, maxHeight: 800 })]).toEqual([]);
    expect([...minimalContours({ data: new Float32Array(16).fill(-5), n: 4, width: 6000, maxHeight: 0 })]).toEqual([]);
    const n = 32,
      data = Float32Array.from({ length: n * n }, (_, i) => 800 + (i % n) * 2);
    const lines = [...minimalContours({ data, n, width: 6000, maxHeight: 862 })];
    expect(lines.length).toBe(12);
    expect(lines.filter(l => l.layer === 'contourIndex')).toHaveLength(2);
    // 805 m crosses between samples x=2 and x=3; cell centres are at x=(i+.5)*cell.
    expect(lines[0].points[0].x).toBe((3 * 6000) / n);
    expect(lines.every(l => !l.closed && l.points.every(p => p.x > 0 && p.x < 6000 && p.y > 0 && p.y < 6000))).toBe(true);
  });
  it('splits large rings into overlapping cullable chunks without losing the closing segment', () => {
    const n = 128,
      data = Float32Array.from({ length: n * n }, (_, i) => 300 - Math.hypot((i % n) - 63.5, Math.floor(i / n) - 63.5) * 5);
    const lines = [...minimalContours({ data, n, width: 6000, maxHeight: 300 })];
    expect(lines.some(l => !l.closed)).toBe(true);
    expect(lines.some(l => l.closed)).toBe(true);
    expect(lines.every(l => l.points.length <= 64)).toBe(true);
    const degree = new Map<string, number>();
    for (const line of lines) {
      const points = line.closed ? [...line.points, line.points[0]] : line.points;
      for (let i = 1; i < points.length; i++)
        for (const p of [points[i - 1], points[i]]) {
          const key = `${line.layer}:${p.x},${p.y}`;
          degree.set(key, (degree.get(key) ?? 0) + 1);
        }
    }
    expect([...degree.values()].every(n => n === 2)).toBe(true);
  });
});

it('retains simplified world segments with contour weights and closed rings', () => {
  const trace = (features: Parameters<typeof minimalContourSegments>[0], scale: number) => {
    const steps = minimalContourSegments(features, scale);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  };
  const points = Array.from({ length: 80 }, (_, x) => ({ x, y: Math.sin(x / 10) * 0.1 }));
  const coarse = trace([{ layer: 'contourIndex', points }], 0.1);
  expect(coarse.length).toBe(5);
  expect(coarse[4]).toBe(1);
  expect(trace([{ layer: 'contour', points }], 100).length).toBeGreaterThan(coarse.length);
  const ring = trace(
    [
      {
        layer: 'contour',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        closed: true,
      },
    ],
    10,
  );
  expect([...ring.slice(-5, -1)]).toEqual([10, 10, 0, 0]);
  expect(points).toHaveLength(80);
});
