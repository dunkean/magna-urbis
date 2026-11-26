import './vectorWaterWasm';
import { splineSample } from '../src/v2/shoreline';
import { shoreOffset } from '../src/render/shoreDetail';
import { describe, expect, it } from 'vitest';
import { lakeField, lakeSample } from '../src/ui/lakeGeometry';
import { computeHydrology, waterBodies } from '../src/ui/simpleHydrology';
import { vectorRivers, channelWidth, type RiverLine } from '../src/ui/riverVectors';
import { ESTUARY_LENGTH, ESTUARY_PROFILE, ESTUARY_SEA, estuaryFlare, riverGeometry, riverSegments, riverWidths, vectorWaterSvg, type WaterDisplay } from '../src/ui/vectorWaterRender';
import type { VectorWater } from '../src/ui/vectorWater';
import { computeVectorWater } from '../src/ui/vectorWater';
import { waterBalance } from '../src/ui/waterBalance';

const display: WaterDisplay = { style: 'parchment', showLakes: true, showOxbows: true, riverArea: 0.1, riverMode: 'vector', overlay: 'none' };
const riverSettings = { riverArea: 0.1, flatSlope: 1, sinuosity: 1.4, widthScale: 3, seed: 'shore-regression' };
function distance(x: number, y: number, p: number[]): number {
  let best = Infinity;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const dx = p[k + 2] - p[k],
      dy = p[k + 3] - p[k + 1],
      length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - p[k]) * dx + (y - p[k + 1]) * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(x - p[k] - t * dx, y - p[k + 1] - t * dy));
  }
  return best;
}

async function basin(): Promise<VectorWater> {
  const n = 64,
    width = 6400,
    height = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const bowl = Math.max(0, 1 - ((x - 32) / 12) ** 2 - ((y - 32) / 9) ** 2);
      height[y * n + x] = x < 2 ? -2 : 2 + x * 0.2 + Math.abs(y - 32) * 0.6 - 9 * bowl;
    }
  const hydro = await computeHydrology(height, n, width);
  const bodies = await waterBodies(hydro, { riverArea: 0.1, lakeDepth: 0.5, lakeArea: 1 });
  const rivers = await vectorRivers(hydro, bodies.lake, riverSettings);
  return { hydro, ...bodies, rivers, lakeField: await lakeField(bodies.lake, n) } as VectorWater;
}

describe('continuous vector water', () => {
  it('preserves islands and makes long grid-aligned banks vary continuously below a cell', async () => {
    const n = 48,
      width = 4800,
      mask = new Uint8Array(n * n);
    for (let y = 5; y < 43; y++) for (let x = 5; x < 43; x++) mask[y * n + x] = 1;
    for (let y = 20; y < 28; y++) for (let x = 20; x < 28; x++) mask[y * n + x] = 0;
    const field = await lakeField(mask, n);
    expect(lakeSample(field, width, 1200, 1200)).toBeGreaterThan(0);
    expect(lakeSample(field, width, 2400, 2400)).toBeLessThan(0);
    expect(lakeSample(field, width, 200, 2400)).toBeLessThan(0);
    const banks: number[] = [];
    for (let y = 1000; y < 1800; y += 10) {
      let lo = 450,
        hi = 550;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        if (lakeSample(field, width, mid, y) > 0) hi = mid;
        else lo = mid;
      }
      banks.push((lo + hi) / 2);
    }
    expect(Math.max(...banks) - Math.min(...banks)).toBeGreaterThan(3);
    expect(Math.max(...banks) - Math.min(...banks)).toBeLessThan(40);
    expect(Math.max(...banks.slice(1).map((b, i) => Math.abs(b - banks[i])))).toBeLessThan(4);
  });

  it('mouths meet the continuous lakes and hidden lakes expose connected drainage', async () => {
    const water = await basin(),
      { hydro: h, rivers: network } = water;
    expect(water.lakes).toBeGreaterThan(0);
    expect(network!.lakeLinks!.length).toBeGreaterThan(0);
    const field = water.lakeField;
    expect(network!.rivers.some(line => lakeSample(field, h.width, line.points[0], line.points[1]) > 0)).toBe(true);
    for (const line of network!.rivers) {
      const [x, y] = line.points.slice(-2),
        c = Math.min(h.n - 1, Math.floor(y / 100)) * h.n + Math.min(h.n - 1, Math.floor(x / 100));
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

  it('preserves isolated wet centres and single-cell islands at sub-cell precision', async () => {
    const n = 16,
      width = 1600,
      mask = new Uint8Array(n * n);
    mask[4 * n + 4] = 1;
    for (let y = 8; y < 14; y++) for (let x = 8; x < 14; x++) mask[y * n + x] = 1;
    mask[10 * n + 10] = 0;
    const field = await lakeField(mask, n);
    expect(lakeSample(field, width, 450, 450)).toBeGreaterThan(0);
    expect(lakeSample(field, width, 1050, 1050)).toBeLessThan(0);
  });

  it('uses one sink for a closed lake instead of cutting rivers on its undrawn shallows', async () => {
    const fixture = await basin();
    const water = await computeVectorWater(
      fixture.hydro.height,
      64,
      6400,
      { ...riverSettings, lakeDepth: 0.5, lakeArea: 1, riverMode: 'vector', balance: true, braiding: 0, anabranching: false, terrainInfluence: true, avulsions: false, confluence: 'drainage', deltas: false },
      { temperature: 18, precipitation: 500 },
      'closed-regression',
    );
    const sinks: number[] = [];
    for (let c = 0; c < water.lakeKind!.length; c++) if (water.lakeKind![c] === 2 && water.hydro.receiver[c] < 0) sinks.push(c);
    expect(sinks.length).toBe(1);
    expect(water.closedLakes).toBe(1);
    const field = water.lakeField;
    for (const line of water.rivers!.rivers) {
      if (line.joins! >= 0) continue;
      const [x, y] = line.points.slice(-2);
      if (Math.min(x, y, 6400 - x, 6400 - y) < 0.01 || water.hydro.height[line.outlet!] <= 0) continue;
      expect(lakeSample(field, 6400, x, y)).toBeGreaterThan(-0.002);
    }
  });

  it('traces a receiving river before its larger tributary after downstream losses', async () => {
    const n = 32,
      width = 3200,
      height = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) height[y * n + x] = x < 2 ? -2 : 2 + x * 0.05 + Math.abs(y - 16) * 0.1;
    const h = await computeHydrology(height, n, width);
    h.accumulation.fill(0);
    for (let x = 2; x < n; x++) {
      h.receiver[16 * n + x] = 16 * n + x - 1;
      h.accumulation[16 * n + x] = x < 17 ? 2e5 : 1e6;
    }
    for (let y = 17; y <= 27; y++) {
      h.receiver[y * n + 17] = (y - 1) * n + 17;
      h.accumulation[y * n + 17] = 5e5;
    }
    const network = await vectorRivers(h, new Uint8Array(n * n), { ...riverSettings, sinuosity: 1 });
    expect(network.rivers.length).toBe(2);
    const tributary = network.rivers.find(l => l.joins! >= 0)!;
    expect(tributary).toBeDefined();
    const parent = network.rivers.find(l => l.id === tributary.joins)!;
    const [x, y] = tributary.points.slice(-2);
    expect(distance(x, y, parent.points)).toBeLessThan(0.01);
    expect(Math.max(...tributary.area)).toBeLessThanOrEqual(5e5);
  });

  it('keeps two closed pans separated below the dry saddle even when they share a depression id', async () => {
    const n = 32,
      width = 3200,
      height = new Float32Array(n * n).fill(10);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!x || !y || x === n - 1 || y === n - 1) height[y * n + x] = -2;
        else if (y >= 12 && y <= 20 && x >= 8 && x <= 24) height[y * n + x] = 8;
      }
    for (const cx of [11, 21]) for (let y = 15; y <= 17; y++) for (let x = cx - 1; x <= cx + 1; x++) height[y * n + x] = 1 + 0.1 * ((y - 15) * 3 + x - cx + 1);
    const water = await computeVectorWater(
      height,
      n,
      width,
      { ...riverSettings, lakeDepth: 0.5, lakeArea: 1, riverMode: 'vector', balance: true, braiding: 0, anabranching: false, terrainInfluence: false, avulsions: false, confluence: 'drainage', deltas: false },
      { temperature: 18, precipitation: 450 },
      'separate-pans',
    );
    const sinks: number[] = [];
    for (let c = 0; c < n * n; c++) if (water.lakeKind![c] === 2 && water.hydro.receiver[c] < 0) sinks.push(c);
    expect(sinks.length).toBe(2);
    expect(sinks.map(c => c % n).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(water.lakeKind![16 * n + 16]).toBe(0);
  });

  it('charges the full open-lake evaporation on the same routing relief as its budget', async () => {
    const fixture = await basin(),
      h = fixture.hydro,
      climate = { temperature: 18, precipitation: 1000 };
    const balance = await waterBalance(h.height, 64, 6400, h.sea, climate, 0.5, 1e4, h);
    const water = await computeVectorWater(
      h.height,
      64,
      6400,
      { ...riverSettings, lakeDepth: 0.5, lakeArea: 1, riverMode: 'grid', balance: true, braiding: 0, anabranching: false, terrainInfluence: false, avulsions: false, confluence: 'drainage', deltas: false },
      climate,
      'evaporation',
      h,
    );
    let input = 0,
      output = 0,
      evaporation = 0;
    for (let c = 0; c < h.height.length; c++) {
      input += balance.weight[c] * h.cellArea;
      evaporation += balance.loss[c];
      if (water.hydro.receiver[c] < 0) output += water.hydro.accumulation[c];
    }
    expect(evaporation).toBeGreaterThan(0);
    expect(Math.abs(input - output - evaporation)).toBeLessThan(input * 1e-6);
  });

  it('keeps the optical mixing fan separate from the physical river mouth and its SVG', async () => {
    const source = await basin(),
      line: RiverLine = { points: [600, 3250, 350, 3250, 150, 3250], area: [1e6, 8e6, 16e6], level: [3, 1, 0], kind: [0, 0, 0] },
      water = { ...source, rivers: { ...source.rivers!, rivers: [line], braids: [], oxbows: [], distributaries: [] } },
      wet: WaterDisplay = { ...display, style: 'render3d', material: true, season: { zone: 'tropical', season: 0.5 } },
      segments = riverSegments(water, wet);
    expect(segments.length).toBeGreaterThan(9);
    for (let i = 0; i < segments.length; i += 9) expect(segments[i + 8]).toBe(0);
    expect(segments[segments.length - 7]).toBeLessThan(195);
    const mouthMix: number[] = [];
    expect(riverSegments(water, wet, mouthMix)).toEqual(segments);
    expect(mouthMix).toHaveLength(9);
    expect(mouthMix[2]).toBeLessThan(mouthMix[0]);
    expect(mouthMix[5]).toBeGreaterThan(mouthMix[4]);
    expect(mouthMix[8]).toBe(-1);
    const [x, y, endX, endY, width] = mouthMix;
    const h = water.hydro, cell = h.width / h.n;
    const [height, dx, dy] = splineSample({ data: h.height, n: h.n }, h.width, x, y);
    expect(Math.abs(height + shoreOffset(x, y, height, Math.hypot(dx, dy), cell))).toBeLessThan(.001);
    expect(Math.hypot(endX - x, endY - y)).toBeGreaterThan(4 * width);
    const svg = vectorWaterSvg(water, { ...wet, material: false });
    expect(svg).toContain('class="water"');
    expect(svg).not.toContain('fill-opacity=');
  });

  it('uses downhill water levels for riffles and leaves upland pools and backwaters calm with the same draw count', async () => {
    const source = await basin(),
      line: RiverLine = { points: [1500, 3200, 1700, 3200, 1900, 3200, 2100, 3200], area: Array(4).fill(1e6), level: [1900, 1900, 1870, 1840], kind: [0, 0, 4, 4], joins: 0 },
      water = { ...source, rivers: { ...source.rivers!, rivers: [line], braids: [], oxbows: [], distributaries: [] } },
      segments = riverSegments(water, { ...display, style: 'render3d', material: true });
    expect(segments.length).toBe(3 * 9);
    expect(segments[8]).toBe(0);
    expect(segments[17]).toBeGreaterThan(0.4);
    expect(segments[26]).toBe(0);
  });

  it('varies the banks of a long dry reach even under constant discharge', async () => {
    const source = await basin();
    const line: RiverLine = { points: [1200, 3250, 2500, 3250, 4000, 3250], area: Array(3).fill(8e6), level: [5, 4, 3], kind: [0, 0, 0], joins: 0 };
    const geometry = (r0: number) => riverGeometry({ ...source, runoff: { ...source.runoff!, r0 } }, line, 0, display.riverArea);
    const dry = geometry(2), humid = geometry(300);
    expect(new Set(humid.widths).size).toBe(1);
    expect(dry.widths.length).toBeGreaterThan(line.area.length);
    const bankfull = humid.widths[0];
    expect(Math.min(...dry.widths)).toBeGreaterThan(.73 * bankfull);
    expect(Math.max(...dry.widths)).toBeLessThan(1.30 * bankfull);
    expect(Math.max(...dry.widths) - Math.min(...dry.widths)).toBeGreaterThan(.16 * bankfull);
    expect(new Set(dry.bankfullWidths)).toEqual(new Set(humid.widths));
  });

  it('retains seasonal pools in broad savanna beds and only damp silt in dry desert beds', async () => {
    const source = await basin();
    const line: RiverLine = { points: [1200, 3250, 2500, 3250, 4000, 3250], area: Array(3).fill(8e6), level: [5, 4, 3], kind: [0, 0, 0], joins: 0 };
    const water = { ...source, runoff: { ...source.runoff!, r0: 5 }, rivers: { ...source.rivers!, rivers: [line], braids: [], distributaries: [], oxbows: [] } };
    const retention = (zone: 'desert' | 'savanna', season: number) => {
      const segments = riverSegments(water, { ...display, material: true, thread: true, season: { zone, season } });
      const values: number[] = [];
      for (let i = 0; i < segments.length; i += 9) if (segments[i + 6] === 0) values.push(segments[i + 8] * (segments[i + 4] + segments[i + 5]) / (2 * .45));
      return values;
    };
    const rains = retention('savanna', .5);
    expect(Math.min(...rains)).toBeLessThan(.97);
    expect(Math.max(...rains)).toBeGreaterThan(1.14);
    expect(Math.max(...rains)).toBeGreaterThan(Math.max(...retention('savanna', 0)));
    expect(Math.max(...retention('desert', .5))).toBe(0);
  });

  it('keeps the full channel on a low-runoff steppe and refills Mediterranean beds in winter', async () => {
    const source = await basin();
    const line: RiverLine = { points: [1200, 3250, 2500, 3250, 4000, 3250], area: Array(3).fill(2e6), level: [5, 4, 3], kind: [0, 0, 0], joins: 0 };
    const water = { ...source, runoff: { ...source.runoff!, r0: 5 }, rivers: { ...source.rivers!, rivers: [line], braids: [], distributaries: [], oxbows: [] } };
    const running = (zone: 'steppe' | 'mediterranean', season: number) => {
      const segments = riverSegments(water, { ...display, material: true, thread: true, season: { zone, season, landIce: true } });
      return segments.filter((_, index) => index % 9 === 6);
    };
    for (const [zone, season] of [['steppe', 0], ['steppe', 0.5], ['mediterranean', 0]] as const) {
      expect(Math.min(...running(zone, season))).toBe(1);
    }
    expect(Math.min(...running('mediterranean', 0.5))).toBe(0);
  });

  it('tapers a dry tributary into the running thread between two vertices of its receiver', async () => {
    const source = await basin();
    const stream = (points: number[], area: number, id: number, joins: number): RiverLine => ({ points, area: Array(points.length / 2).fill(area), level: Array(points.length / 2).fill(5), kind: Array(points.length / 2).fill(0), id, joins });
    const host = stream([500, 1200, 2400, 1200, 4400, 1200], 300e6, 0, -1);
    const branch = stream([1850, 2350, 1850, 1700, 1850, 1200], 0.08e6, 1, 0);
    const water = { ...source, runoff: { ...source.runoff, r0: 18 }, rivers: { ...source.rivers!, rivers: [branch, host], braids: [], distributaries: [], oxbows: [] } } as VectorWater;
    const seg = riverSegments(water, { ...display, material: true, thread: true, season: { zone: 'mediterranean', season: 0.5 } });
    const wet: number[][] = [];
    for (let k = 0; k < seg.length; k += 9) if (seg[k + 6] > 0.99) wet.push([...seg.slice(k, k + 9)]);
    const inflow = wet.filter(s => Math.abs(s[2] - 1850) < 8 && s[1] > s[3] && s[3] >= 1200);
    expect(inflow.length).toBeGreaterThan(2);
    expect(inflow.at(-1)![3]).toBe(1200);
    expect(inflow[0][4]).toBeLessThan(inflow.at(-1)![5] * 0.5);
    expect(wet.some(s => s[0] <= 1850 && s[2] >= 1850 && distance(1850, 1200, s.slice(0, 4)) < 0.5 * s[5])).toBe(true);
  });

  it('widens the wet channel towards a visible lake and keeps an inlet across its exposed shore', async () => {
    const source = await basin(),
      y = 3250;
    let x = 600;
    while (x < 6000 && lakeSample(source.lakeField, 6400, x, y) < 0) x += 10;
    expect(x).toBeLessThan(6000);
    const line: RiverLine = { points: [x - 1100, y, x - 500, y, x, y], area: [0.08e6, 0.08e6, 0.08e6], level: [3.5, 3, 3], kind: [0, 0, 0], joins: -1 };
    const water = { ...source, runoff: { ...source.runoff, r0: 18 }, rivers: { ...source.rivers!, rivers: [line], braids: [], distributaries: [], oxbows: [], lakeLinks: [] } } as VectorWater;
    const d: WaterDisplay = { ...display, material: true, thread: true, season: { zone: 'mediterranean', season: 0.5 } };
    const mouths: number[] = [],
      seg = riverSegments(water, d, mouths),
      hidden: number[] = [];
    riverSegments(water, { ...d, showLakes: false }, hidden);
    expect(mouths.length).toBe(9);
    expect(mouths[8]).toBe(-2);
    expect(hidden).toEqual([]);
    const ends: number[] = [];
    for (let k = 0; k < seg.length; k += 9) if (seg[k + 6] === 1) ends.push(seg[k + 5]);
    expect(ends.at(-1)).toBeGreaterThan(ends[0]);
    expect(vectorWaterSvg(water, d)).toContain('mask="url(#water-inlets)"');
  });

  it('lets the thread of a wide bed wander inside it and stops the bare bed at the coastline', async () => {
    const source = await basin(),
      points = Array.from({ length: 30 }, (_, k) => [6000 - 200 * k, 3250])
        .flat()
        .concat(150, 3250),
      line: RiverLine = { points, area: points.filter((_, i) => i % 2 === 0).map(() => 16e6), level: new Array(31).fill(2), kind: new Array(31).fill(0) },
      water = { ...source, runoff: { r0: 50, e0: 900, aridity: 1 }, rivers: { ...source.rivers!, rivers: [line], braids: [], oxbows: [], distributaries: [] } } as VectorWater,
      segments = riverSegments(water, { ...display, style: 'render3d', material: true, thread: true, season: { zone: 'mediterranean', season: 0.5 } });
    let widest = 0,
      reach = 0,
      mouth = Infinity,
      bare = Infinity;
    for (let i = 0; i < segments.length; i += 9) {
      const [, , x1, y1, , w1, running] = segments.subarray(i, i + 9);
      if (running === 0) {
        widest = Math.max(widest, w1);
        bare = Math.min(bare, x1);
      } else {
        reach = Math.max(reach, Math.abs(y1 - 3250));
        mouth = Math.min(mouth, x1);
        expect(Math.abs(y1 - 3250)).toBeLessThan(widest / 2 + 1);
      }
    }
    expect(reach).toBeGreaterThan(1);
    expect(mouth).toBeLessThan(195);
    expect(bare).toBeGreaterThan(190);
  });

  it('uses physical widths, splits braid discharge and widens marine estuaries with river size', async () => {
    const water = await basin();
    const line: RiverLine = { points: [600, 3250, 150, 3250], area: [1e6, 16e6], level: [3, 0], kind: [0, 0], threads: [1, 2] };
    const widths = riverWidths(water, line);
    expect(widths[0]).toBeCloseTo(channelWidth(1e6, 3));
    // At the coastline (x = 195 m) the course has opened into an estuary of 2.5-4 widths; past it the funnel runs on
    // over the sea, so its last vertex (x = 150 m, in the sea) is wider still.
    const own = channelWidth(8e6, 3),
      most = 1 + (estuaryFlare(own, 1) - 1) * (1 + ESTUARY_SEA) ** ESTUARY_PROFILE;
    expect(estuaryFlare(own, 0)).toBeGreaterThan(2.5);
    expect(widths[1] / own).toBeGreaterThan(estuaryFlare(own, 0));
    expect(widths[1] / own).toBeLessThan(most + 1e-6);
    expect(riverWidths(water, { ...line, area: [1e6, 1e5], threads: [1, 1] })[1]).toBeGreaterThan(2 * channelWidth(1e5, 3));
    const segments = riverSegments({ ...water, rivers: { ...water.rivers!, rivers: [line], braids: [], oxbows: [], distributaries: [] } }, display);
    expect(segments.length % 9).toBe(0);
    expect(segments.length / 9).toBeGreaterThan(10);
    expect(segments[4]).toBeCloseTo(widths[0]);
    const funnel = 195 + ESTUARY_LENGTH[1] * own + 10;
    let coast = 0;
    for (let i = 0; i < segments.length; i += 9) {
      const [x0, , x1, , w0, w1] = segments.subarray(i, i + 6);
      // No widening above the funnel; inside it the banks open smoothly (subdivided, no step) and never narrow.
      if (x0 > funnel) expect(w0).toBeLessThan(own * 1.01);
      expect(w1).toBeGreaterThanOrEqual(w0 - 1e-6);
      expect(w1 / w0).toBeLessThan(1.3);
      if (x0 >= 195 && x1 < 195) coast = w0 + ((w1 - w0) * (x0 - 195)) / (x0 - x1);
    }
    expect(coast / own).toBeGreaterThan(2.1);
    // The ribbon ends just past the coastline, in the sea: no long ribbon drawn out over the water.
    const last = segments.length - 9;
    expect(segments[last + 2]).toBeLessThan(195);
    expect(segments[last + 2]).toBeGreaterThan(195 - ESTUARY_SEA * ESTUARY_LENGTH[1] * own - 5);
  });

  it('keeps following a channel when downstream losses take it below the display threshold', async () => {
    const n = 24,
      width = 2400,
      height = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) height[y * n + x] = 2 + x + 2 * Math.abs(y - 12);
    const h = await computeHydrology(height, n, width);
    h.accumulation.fill(0);
    for (let x = 0; x < n - 1; x++) h.accumulation[12 * n + x] = x < 10 ? 5e4 : 2e5;
    const network = await vectorRivers(h, new Uint8Array(n * n), { ...riverSettings, sinuosity: 1 });
    expect(network.rivers.length).toBeGreaterThan(0);
    for (const line of network.rivers) expect(line.points[line.points.length - 2]).toBe(0);
  });
});
