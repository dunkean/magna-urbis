import { describe, expect, it } from 'vitest';
import { vectorRivers } from '../src/ui/riverVectors';
import { computeHydrology } from '../src/ui/simpleHydrology';

const n = 256, width = 10000, cell = width / n;
// A wide gravel valley falling 1 % west to the sea, its floor tilted gently
// towards the axis, between steep hills: an unconfined braided reach.
const height = new Float32Array(n * n);
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const across = Math.abs(y - n / 2) * cell;
  height[y * n + x] = x < 4 ? -5 : 0.01 * x * cell + 0.002 * across + 0.1 * Math.max(0, across - 1500);
}

/** Distance from (x, y) to a polyline. */
function distance(x: number, y: number, p: number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1], dx = p[i + 2] - ax, dy = p[i + 3] - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

describe('braided reaches', () => {
  it('part from and rejoin their main channel', () => {
    const h = computeHydrology(height, n, width);
    const network = vectorRivers(h, new Uint8Array(n * n), {
      riverArea: 0.5, flatSlope: 1, sinuosity: 1.8, widthScale: 3, seed: 'braids',
      braiding: 1, anabranching: false, terrainInfluence: true, avulsions: false, deltas: false, aridity: 0.1,
    });
    const threads = network.braids.filter(line => line.kind[0] === 3);
    expect(threads.length).toBeGreaterThan(0);
    for (const thread of threads) {
      const main = network.rivers.find(line => line.id === thread.id)!, p = thread.points, m = p.length / 2;
      expect(distance(p[0], p[1], main.points)).toBeLessThan(1);
      expect(distance(p[2 * m - 2], p[2 * m - 1], main.points)).toBeLessThan(1);
    }
  });
});
