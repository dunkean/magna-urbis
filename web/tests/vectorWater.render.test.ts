import { describe, expect, it } from 'vitest';
import { lakeField, lakeSample } from '../src/ui/lakeGeometry';
import { computeHydrology, waterBodies } from '../src/ui/simpleHydrology';
import { vectorRivers, channelWidth, type RiverLine } from '../src/ui/riverVectors';
import { riverSegments, riverWidths, vectorWaterSvg, type WaterDisplay } from '../src/ui/vectorWaterRender';
import type { VectorWater } from '../src/ui/vectorWater';
import { computeVectorWater } from '../src/ui/vectorWater';
import { waterBalance } from '../src/ui/waterBalance';

const display: WaterDisplay = { style: 'parchment', showLakes: true, showOxbows: true, riverArea: 0.1, riverMode: 'vector', overlay: 'none' };
const riverSettings = { riverArea: 0.1, flatSlope: 1, sinuosity: 1.4, widthScale: 3, seed: 'shore-regression' };
function distance(x: number, y: number, p: number[]): number {
  let best = Infinity;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const dx = p[k + 2] - p[k], dy = p[k + 3] - p[k + 1], length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - p[k]) * dx + (y - p[k + 1]) * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(x - p[k] - t * dx, y - p[k + 1] - t * dy));
  }
  return best;
}

function basin(): VectorWater {
  const n = 64, width = 6400, height = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const bowl = Math.max(0, 1 - ((x - 32) / 12) ** 2 - ((y - 32) / 9) ** 2);
    height[y * n + x] = x < 2 ? -2 : 2 + x * 0.2 + Math.abs(y - 32) * 0.6 - 9 * bowl;
  }
  const hydro = computeHydrology(height, n, width);
  const bodies = waterBodies(hydro, { riverArea: 0.1, lakeDepth: 0.5, lakeArea: 1 });
  const rivers = vectorRivers(hydro, bodies.lake, riverSettings);
  return { hydro, ...bodies, rivers } as VectorWater;
}

describe('continuous vector water', () => {
  it('preserves islands and makes long grid-aligned banks vary continuously below a cell', () => {
    const n = 48, width = 4800, mask = new Uint8Array(n * n);
    for (let y = 5; y < 43; y++) for (let x = 5; x < 43; x++) mask[y * n + x] = 1;
    for (let y = 20; y < 28; y++) for (let x = 20; x < 28; x++) mask[y * n + x] = 0;
    const field = lakeField(mask, n);
    expect(lakeSample(field, width, 1200, 1200)).toBeGreaterThan(0);
    expect(lakeSample(field, width, 2400, 2400)).toBeLessThan(0);
    expect(lakeSample(field, width, 200, 2400)).toBeLessThan(0);
    const banks: number[] = [];
    for (let y = 1000; y < 1800; y += 10) {
      let lo = 450, hi = 550;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        if (lakeSample(field, width, mid, y) > 0) hi = mid; else lo = mid;
      }
      banks.push((lo + hi) / 2);
    }
    expect(Math.max(...banks) - Math.min(...banks)).toBeGreaterThan(3);
    expect(Math.max(...banks) - Math.min(...banks)).toBeLessThan(40);
    expect(Math.max(...banks.slice(1).map((b, i) => Math.abs(b - banks[i])))).toBeLessThan(4);
  });

  it('mouths meet the continuous lakes and hidden lakes expose connected drainage', () => {
    const water = basin(), { hydro: h, rivers: network } = water;
    expect(water.lakes).toBeGreaterThan(0);
    expect(network!.lakeLinks!.length).toBeGreaterThan(0);
    const field = lakeField(water.lake, h.n);
    expect(network!.rivers.some(line => lakeSample(field, h.width, line.points[0], line.points[1]) > 0)).toBe(true);
    for (const line of network!.rivers) {
      const [x, y] = line.points.slice(-2), c = Math.min(h.n - 1, Math.floor(y / 100)) * h.n + Math.min(h.n - 1, Math.floor(x / 100));
      if (h.sea[c] || h.height[c] <= 0 || Math.min(x, y, h.width - x, h.width - y) < 0.01) continue;
      const parent = network!.rivers.find(l => l.id === line.joins);
      if (parent) expect(distance(x, y, parent.points), `channel ${line.id} -> ${parent.id}, nearest ${Math.min(...network!.rivers.filter(l => l !== line).map(l => distance(x, y, l.points)))}`).toBeLessThan(0.01);
      else expect(lakeSample(field, h.width, x, y)).toBeGreaterThan(-0.002);
    }
    for (const link of network!.lakeLinks!) {
      const [x, y] = link.points;
      expect(Math.min(...network!.rivers.map(l => distance(x, y, l.points)))).toBeLessThan(0.01);
      const parent = network!.rivers.find(l => l.id === link.joins);
      if (parent) {
        const [ex, ey] = link.points.slice(-2);
        expect(distance(ex, ey, parent.points)).toBeLessThan(0.01);
      }
    }
    expect(riverSegments(water, { ...display, showLakes: false }).length).toBeGreaterThan(riverSegments(water, display).length);
    const svg = vectorWaterSvg(water, display);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain('NaN');
  });

  it('preserves isolated wet centres and single-cell islands at sub-cell precision', () => {
    const n = 16, width = 1600, mask = new Uint8Array(n * n);
    mask[4 * n + 4] = 1;
    for (let y = 8; y < 14; y++) for (let x = 8; x < 14; x++) mask[y * n + x] = 1;
    mask[10 * n + 10] = 0;
    const field = lakeField(mask, n);
    expect(lakeSample(field, width, 450, 450)).toBeGreaterThan(0);
    expect(lakeSample(field, width, 1050, 1050)).toBeLessThan(0);
  });

  it('uses one sink for a closed lake instead of cutting rivers on its undrawn shallows', () => {
    const fixture = basin();
    const water = computeVectorWater(fixture.hydro.height, 64, 6400, {
      ...riverSettings, lakeDepth: 0.5, lakeArea: 1, riverMode: 'vector', balance: true,
      braiding: 0, anabranching: false, terrainInfluence: true, avulsions: false, confluence: 'drainage', deltas: false,
    }, { temperature: 18, precipitation: 500 }, 'closed-regression');
    const sinks: number[] = [];
    for (let c = 0; c < water.lakeKind!.length; c++) if (water.lakeKind![c] === 2 && water.hydro.receiver[c] < 0) sinks.push(c);
    expect(sinks.length).toBe(1);
    expect(water.closedLakes).toBe(1);
    const field = lakeField(water.lake, 64);
    for (const line of water.rivers!.rivers) {
      if (line.joins! >= 0) continue;
      const [x, y] = line.points.slice(-2);
      if (Math.min(x, y, 6400 - x, 6400 - y) < 0.01 || water.hydro.height[line.outlet!] <= 0) continue;
      expect(lakeSample(field, 6400, x, y)).toBeGreaterThan(-0.002);
    }
  });

  it('traces a receiving river before its larger tributary after downstream losses', () => {
    const n = 32, width = 3200, height = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) height[y * n + x] = x < 2 ? -2 : 2 + x * 0.05 + Math.abs(y - 16) * 0.1;
    const h = computeHydrology(height, n, width);
    h.accumulation.fill(0);
    for (let x = 2; x < n; x++) { h.receiver[16 * n + x] = 16 * n + x - 1; h.accumulation[16 * n + x] = x < 17 ? 2e5 : 1e6; }
    for (let y = 17; y <= 27; y++) { h.receiver[y * n + 17] = (y - 1) * n + 17; h.accumulation[y * n + 17] = 5e5; }
    const network = vectorRivers(h, new Uint8Array(n * n), { ...riverSettings, sinuosity: 1 });
    expect(network.rivers.length).toBe(2);
    const tributary = network.rivers.find(l => l.joins! >= 0)!;
    expect(tributary).toBeDefined();
    const parent = network.rivers.find(l => l.id === tributary.joins)!;
    const [x, y] = tributary.points.slice(-2);
    expect(distance(x, y, parent.points)).toBeLessThan(0.01);
    expect(Math.max(...tributary.area)).toBeLessThanOrEqual(5e5);
  });

  it('keeps two closed pans separated below the dry saddle even when they share a depression id', () => {
    const n = 32, width = 3200, height = new Float32Array(n * n).fill(10);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!x || !y || x === n - 1 || y === n - 1) height[y * n + x] = -2;
      else if (y >= 12 && y <= 20 && x >= 8 && x <= 24) height[y * n + x] = 8;
    }
    for (const cx of [11, 21]) for (let y = 15; y <= 17; y++) for (let x = cx - 1; x <= cx + 1; x++) height[y * n + x] = 1 + 0.1 * ((y - 15) * 3 + x - cx + 1);
    const water = computeVectorWater(height, n, width, {
      ...riverSettings, lakeDepth: 0.5, lakeArea: 1, riverMode: 'vector', balance: true,
      braiding: 0, anabranching: false, terrainInfluence: false, avulsions: false, confluence: 'drainage', deltas: false,
    }, { temperature: 18, precipitation: 450 }, 'separate-pans');
    const sinks: number[] = [];
    for (let c = 0; c < n * n; c++) if (water.lakeKind![c] === 2 && water.hydro.receiver[c] < 0) sinks.push(c);
    expect(sinks.length).toBe(2);
    expect(sinks.map(c => c % n).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(water.lakeKind![16 * n + 16]).toBe(0);
  });

  it('charges the full open-lake evaporation on the same routing relief as its budget', () => {
    const fixture = basin(), h = fixture.hydro, climate = { temperature: 18, precipitation: 1000 };
    const balance = waterBalance(h.height, 64, 6400, h.sea, climate, 0.5, 1e4, h);
    const water = computeVectorWater(h.height, 64, 6400, {
      ...riverSettings, lakeDepth: 0.5, lakeArea: 1, riverMode: 'grid', balance: true,
      braiding: 0, anabranching: false, terrainInfluence: false, avulsions: false, confluence: 'drainage', deltas: false,
    }, climate, 'evaporation', h);
    let input = 0, output = 0, evaporation = 0;
    for (let c = 0; c < h.height.length; c++) {
      input += balance.weight[c] * h.cellArea; evaporation += balance.loss[c];
      if (water.hydro.receiver[c] < 0) output += water.hydro.accumulation[c];
    }
    expect(evaporation).toBeGreaterThan(0);
    expect(Math.abs(input - output - evaporation)).toBeLessThan(input * 1e-6);
  });

  it('uses physical widths, splits braid discharge and widens marine estuaries with river size', () => {
    const water = basin();
    const line: RiverLine = { points: [600, 3250, 150, 3250], area: [1e6, 16e6], level: [3, 0], kind: [0, 0], threads: [1, 2] };
    const widths = riverWidths(water, line);
    expect(widths[0]).toBeCloseTo(channelWidth(1e6, 3));
    // At the mouth the flare reaches 1 + 0.8 s²(3 − 2s), s from 0 (a 4 m brook) to 1 (a 60 m river).
    const own = channelWidth(8e6, 3), size = Math.min(1, Math.log(own / 4) / Math.log(15));
    expect(widths[1]).toBeCloseTo(own * (1 + 0.8 * size * size * (3 - 2 * size)));
    expect(riverWidths(water, { ...line, area: [1e6, 1e5], threads: [1, 1] })[1]).toBeCloseTo(channelWidth(1e5, 3));
    const segments = riverSegments({ ...water, rivers: { ...water.rivers!, rivers: [line], braids: [], oxbows: [], distributaries: [] } }, display);
    expect(segments.length).toBe(9);
    expect(segments[4]).toBeCloseTo(widths[0]);
    expect(segments[5]).toBeCloseTo(widths[1]);
  });

  it('keeps following a channel when downstream losses take it below the display threshold', () => {
    const n = 24, width = 2400, height = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) height[y * n + x] = 2 + x + 2 * Math.abs(y - 12);
    const h = computeHydrology(height, n, width);
    h.accumulation.fill(0);
    for (let x = 0; x < n - 1; x++) h.accumulation[12 * n + x] = x < 10 ? 5e4 : 2e5;
    const network = vectorRivers(h, new Uint8Array(n * n), { ...riverSettings, sinuosity: 1 });
    expect(network.rivers.length).toBeGreaterThan(0);
    for (const line of network.rivers) expect(line.points[line.points.length - 2]).toBe(0);
  });
});
