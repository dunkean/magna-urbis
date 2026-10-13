import { describe, expect, it } from 'vitest';
import { conditionRelief } from '../src/ui/reliefConditioning';
import { computeHydrology } from '../src/ui/simpleHydrology';

const n = 256, width = 5000, cell = width / n;
const hash = (x: number, y: number): number => {
  let v = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  v ^= v >>> 13;
  return (Math.imul(v, 1103515245) >>> 0) / 4294967296;
};
// A plain rising from a western sea, a wide 25 m basin, metre-scale roughness:
// one lake holding many sub-basins, the case that split into new pits.
const relief = new Float32Array(n * n);
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const r = Math.hypot(x - 150, y - 128) * cell;
  relief[y * n + x] = x < 12 ? -5 : 30 + 0.004 * x * cell - 25 * Math.exp(-((r / 900) ** 2)) + 3 * (hash(x >> 1, y >> 1) - 0.5);
}

describe('relief conditioning', () => {
  it('breaching opens the sub-basins of a drained lake', () => {
    const result = conditionRelief(relief, n, width, { mode: 'breach', strength: 2, maxDepth: 30, maxLength: 3000 });
    expect(result.before.depressions).toBeGreaterThan(100);
    expect(result.after.depressions).toBeLessThanOrEqual(2);
  });

  it('erosion and breaching drain without new pits, keep the sea, return a matching flood', () => {
    const result = conditionRelief(relief, n, width, { mode: 'both', strength: 2, maxDepth: 30, maxLength: 3000 });
    expect(result.after.depressions).toBeLessThanOrEqual(2);
    expect(result.after.volume).toBeLessThan(0.01 * result.before.volume);
    for (let c = 0; c < n * n; c++) if (relief[c] <= 0) expect(result.delta[c]).toBe(0);
    const fresh = computeHydrology(result.height, n, width);
    let mismatches = 0;
    for (let c = 0; c < n * n; c++) if (fresh.filled[c] !== result.hydrology.filled[c] || fresh.receiver[c] !== result.hydrology.receiver[c]) mismatches++;
    expect(mismatches).toBe(0);
  });

  it('breaches along the drowned valley floor, not across the lake', () => {
    // A 30 m plain draining west to the sea; a lake on a 20 m floor sloping to its channel, whose
    // outlet is a notch in its western rim; a sinuous drowned channel climbing
    // from the lake bottom, at its eastern end, to the notch.
    const axis = (x: number): number => 128 + 30 * Math.sin(2 * Math.PI * (x - 60) / 140);
    const lake = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const plain = 30 + 0.004 * x * cell;
      let z = x < 12 ? -5 : plain;
      if (x >= 60 && x <= 200 && Math.abs(y - 128) < 70) z = Math.abs(y - axis(x)) <= 1.5 ? 16 + 2 * (200 - x) / 140 : 20 + 0.02 * Math.abs(y - axis(x));
      else if (x >= 12 && x < 60 && Math.abs(y - 128) <= 1) z = Math.min(plain, 25 - 0.1 * (59 - x));
      lake[y * n + x] = z;
    }
    const result = conditionRelief(lake, n, width, { mode: 'breach', strength: 2, maxDepth: 30, maxLength: 5000 });
    // Share of the cut inside the lake lying away from the channel.
    let volume = 0, far = 0;
    for (let y = 0; y < n; y++) for (let x = 60; x <= 200; x++) {
      const cutDepth = -result.delta[y * n + x];
      if (cutDepth <= 0) continue;
      volume += cutDepth;
      if (Math.abs(y - axis(x)) > 3) far += cutDepth;
    }
    expect(result.after.depressions).toBe(0);
    expect(volume).toBeGreaterThan(0);
    expect(far / volume).toBeLessThan(0.1);
  });
});
