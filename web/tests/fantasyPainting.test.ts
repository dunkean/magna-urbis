import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { planPainting, createBrushLibrary, brushFrame, paintingSvg, BRUSH, isReliefBrush, FAMILY_NAMES, type Atlas, type BrushFamily, type PaintSample, paintingCover } from '../../rust/bridge/fantasyPainting';
const sample = (x: number, y: number): PaintSample => ({ height: x < 1500 ? -10 : 300 + y * 0.04, slope: 0.08, temperature: 18, rain: 1600, water: y > 7000 && y < 7500 });
const options = { seed: 'fantasy-42', pitch: 150 };
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const isSummit = (s: { brush: number }) => s.brush === BRUSH.ridges || s.brush === BRUSH.snow || s.brush === BRUSH.peaks;
describe('fantasy cartographic placement', () => {
  it('plants small single trees on stable parcel rows, excluding holes and keeping them in the 3D overview', () => {
    const angle = 0.61,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const point = (u: number, v: number) => ({ x: 150 + u * c - v * s, y: 150 + u * s + v * c });
    const poly = [point(-100, -60), point(100, -60), point(100, 60), point(-100, 60)];
    const holes = [[point(-18, -18), point(18, -18), point(18, 18), point(-18, 18)]];
    const bounds = { x: 0, y: 0, width: 300, height: 300 };
    const orchard = (): PaintSample => ({ height: 300, slope: 0.01, temperature: 18, rain: 1800, landuse: 'orchard' });
    const opts = { ...options, parcels: [{ kind: 'orchard', poly, holes }], followLanduse: true, vegetation: 'coarse' as const };
    const trees = planPainting(bounds, orchard, opts).filter(t => t.brush === 11);
    expect(trees.length).toBeGreaterThan(180);
    expect(trees.every(t => t.width >= 5 && t.width <= 8)).toBe(true);
    for (const tree of trees) {
      const u = (tree.x - 150) * c + (tree.y - 150) * s,
        v = -(tree.x - 150) * s + (tree.y - 150) * c;
      expect(Math.abs(u)).toBeLessThan(100);
      expect(Math.abs(v)).toBeLessThan(60);
      expect(Math.abs(u) > 18 || Math.abs(v) > 18).toBe(true);
      // The long parcel edge defines the rows: jitter stays below 0.3 m on each axis.
      const across = -tree.x * s + tree.y * c;
      expect(Math.abs(across / 9 - 0.5 - Math.round(across / 9 - 0.5))).toBeLessThan(0.034);
    }
    const cropped = planPainting({ x: 80, y: 80, width: 120, height: 120 }, orchard, opts).filter(t => t.brush === 11 && t.x >= 80 && t.x <= 200 && t.y >= 80 && t.y <= 200);
    expect(cropped).toEqual(trees.filter(t => t.x >= 80 && t.x <= 200 && t.y >= 80 && t.y <= 200));
    expect(planPainting(bounds, orchard, { ...opts, vegetation: 'fine' }).some(t => t.brush === 11)).toBe(false);
  });

  it('uses only round single broadleaf atlas cells for orchard brushes in both palettes', () => {
    const atlas: Atlas = { url: 'test', width: 400, height: 400, rows: [0, 0.25, 0.5, 0.75, 1] };
    const families = Object.fromEntries(FAMILY_NAMES.map(n => [n, atlas])) as Record<BrushFamily, Atlas>;
    for (const style of ['fantasy-ink', 'fantasy-color'] as const) {
      const library = createBrushLibrary(style, families),
        offset = style === 'fantasy-color' ? 8 : 0;
      for (let variant = 0; variant < 32; variant++) {
        const frame = brushFrame(library, { x: 0, y: 0, width: 6.5, height: 8, brush: 11, variant, flip: false, opacity: 1 });
        expect(frame.family).toBe('broadleaf');
        expect([0, 1, 4].map(v => v + offset)).toContain(frame.index);
      }
    }
  });

  it('packs metre-scale trees and variable massifs, prioritizing relief under a tight budget', () => {
    const bounds = { x: 0, y: 0, width: 10000, height: 10000 };
    const landscape = (x: number, y: number) => (x < 5000 ? { height: 2200, slope: 0.5, relief: 400 + 0.075 * y, tpi: 0.1, temperature: 18, rain: 1800 } : { height: 300, slope: 0.03, relief: 1, temperature: 18, rain: 1800 });
    const view = { ...options, heightRange: [300, 2200] as const };
    const stamps = planPainting(bounds, landscape, view);
    const summits = stamps.filter(isSummit);
    const trees = stamps.filter(s => s.brush < 4 || (s.brush >= 12 && s.brush <= 14));
    expect(summits.length).toBeGreaterThan(10);
    expect(summits.every(s => s.width >= 700 * 0.85 && s.width <= 4500)).toBe(true);
    expect(Math.max(...summits.map(s => s.width))).toBeGreaterThan(Math.min(...summits.map(s => s.width)) * 1.1);
    expect(trees.every(s => s.width >= 11 * 0.8 && s.width <= 11 * 1.25)).toBe(true);
    expect(trees.every(s => s.heightScale! >= 0.9 && s.heightScale! <= 1.1)).toBe(true);
    // Half the map alone contains several times the former whole-map forest count.
    expect(trees.length).toBeGreaterThan(5000);
    const reliefCount = stamps.filter(s => isReliefBrush(s.brush)).length;
    const limited = planPainting(bounds, landscape, { ...view, maxStamps: reliefCount + 40 });
    expect(limited).toHaveLength(reliefCount + 40);
    expect(limited.filter(s => isReliefBrush(s.brush))).toHaveLength(reliefCount);
    expect(limited.filter(isSummit)).toEqual(summits);
    const tight = planPainting(bounds, landscape, { ...view, maxStamps: 40 });
    expect(tight).toHaveLength(40);
    expect(tight.every(s => isReliefBrush(s.brush))).toBe(true);
  });
  it('fills rolling terrain with many hills capped well below peak size', () => {
    const stamps = planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, () => ({ height: 100, slope: 0.12, relief: 50, tpi: 0.08, temperature: 18, rain: 1500 }), { ...options, heightRange: [0, 400], reliefRef: 500 });
    expect(stamps.length).toBeGreaterThan(1000);
    const hills = stamps.filter(s => s.brush === 4);
    expect(hills.length).toBeGreaterThan(100);
    expect(hills.every(s => s.width >= 400 * 0.85 && s.width <= 2000)).toBe(true);
    expect(stamps.some(s => s.brush < 4)).toBe(true);
  });
  it('replays exactly and preserves world anchors between overlapping crops', () => {
    const view = { ...options, mapWidth: 10000 };
    const bounds = { x: 0, y: 0, width: view.mapWidth, height: view.mapWidth };
    const a = planPainting(bounds, sample, view);
    const digest = (stamps: typeof a) => createHash('sha256').update(JSON.stringify(stamps)).digest('hex');
    expect(a.length).toBeGreaterThan(300);
    expect(digest(planPainting(bounds, sample, view))).toBe(digest(a));
    const crop = planPainting({ x: 3000, y: 3000, width: 4000, height: 4000 }, sample, view);
    const inner = (s: (typeof a)[number]) => s.x > 3200 && s.x < 6800 && s.y > 3200 && s.y < 6800;
    const fullInterior = a.filter(inner),
      cropInterior = crop.filter(inner);
    expect(cropInterior).toHaveLength(fullInterior.length);
    expect(digest(cropInterior)).toBe(digest(fullInterior));
    expect(a.every(s => s.x > 1500 && !(s.y > 7000 && s.y < 7500))).toBe(true);
    expect(a.every((s, i) => i === 0 || s.y >= a[i - 1].y)).toBe(true);
  });
  it('retains fine-tree identities across two offset detail tiles on the same map', () => {
    const view = { ...options, mapWidth: 20000, raster: 3400, lod: 'detail' as const, vegetation: 'fine' as const, maxStamps: 400000 };
    const common = (x: number, width: number) => planPainting({ x, y: 3000, width, height: 5000 }, sample, view).filter(s => s.x > 5200 && s.x < 6800 && s.y > 3200 && s.y < 6800);
    const left = common(2000, 5000);
    const right = common(5000, 6600);
    expect(left.length).toBeGreaterThan(100);
    expect(right).toHaveLength(left.length);
    expect(createHash('sha256').update(JSON.stringify(right)).digest('hex')).toBe(createHash('sha256').update(JSON.stringify(left)).digest('hex'));
  });
  it('bounds sampling work for an extremely long narrow request', () => {
    let calls = 0;
    const stamps = planPainting(
      { x: -500, y: -1, width: 1e12, height: 2 },
      () => {
        calls++;
        return undefined;
      },
      { ...options, mapWidth: 10000 },
    );
    expect(stamps).toEqual([]);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(3000);
  });
  it('keeps the budget spread across the map and rejects invalid inputs', () => {
    const result = planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, sample, { ...options, maxStamps: 20 });
    expect(result).toHaveLength(20);
    expect(result[0].y).toBeLessThan(2000);
    expect(result[19].y).toBeGreaterThan(8000);
    expect(planPainting({ x: 0, y: 0, width: 100, height: 100 }, sample, { ...options, pitch: NaN })).toEqual([]);
  });
  it('retains increasing brush density at the minimum spacing control', () => {
    const forest = () => ({ height: 300, slope: 0.03, temperature: 18, rain: 1800 });
    const bounds = { x: 0, y: 0, width: 10000, height: 10000 };
    const dense = planPainting(bounds, forest, { ...options, density: 0.5, pitch: (10000 / 65) * 0.3 });
    const loose = planPainting(bounds, forest, { ...options, density: 0.5, pitch: (10000 / 65) * 0.35 });
    expect(dense.length).toBeGreaterThan(loose.length);
  });
  it('renders flat land and uses six tree silhouettes in each style', () => {
    const stamps = planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, () => ({ height: 0.3, slope: 0.01, temperature: 6, rain: 1500 }), options);
    expect(stamps.length).toBeGreaterThan(100);
    const atlas: Atlas = { url: 'data:image/png;base64,fixture', width: 400, height: 400, rows: [0, 0.25, 0.5, 0.75, 1] };
    const families = Object.fromEntries(FAMILY_NAMES.map(family => [family, atlas])) as Record<BrushFamily, Atlas>;
    const ink = createBrushLibrary('fantasy-ink', families),
      color = createBrushLibrary('fantasy-color', families);
    expect(new Set(stamps.filter(s => s.brush === 0 || s.brush === 12).map(s => brushFrame(ink, s).index)).size).toBe(6);
    expect(stamps.every(s => brushFrame(color, s).index === brushFrame(ink, s).index + 8)).toBe(true);
    const svg = paintingSvg(stamps, color, 'fixture');
    expect(svg).toContain('data-brush="pines"');
    expect(svg).toContain('data-variant="5"');
    expect((svg.match(/<image /g) ?? []).length).toBeLessThan(5);
  });
  it('keeps high valleys wooded while ridge brushes grow with relief towards the summits', () => {
    const valley = { height: 1800, slope: 0.08, tpi: -0.12, relief: 900, temperature: 18, rain: 1600 };
    const ridge = { ...valley, tpi: 0.12, slope: 0.45 };
    expect(paintingCover(valley).woods).toBeGreaterThan(paintingCover(ridge).woods);
    expect(paintingCover(valley).mountain).toBeLessThan(0.16);
    const mountains = (relief: number) => planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, () => ({ ...ridge, height: 600, relief, temperature: 28 }), { ...options, heightRange: [0, 600] }).filter(isSummit);
    const low = mountains(500),
      high = mountains(900);
    expect(low.length).toBeGreaterThan(10);
    expect(high.length).toBeGreaterThan(10);
    // Hierarchy holds on average; individual sizes overlap because of the per-stamp variance.
    expect(mean(high.map(s => s.width))).toBeGreaterThan(mean(low.map(s => s.width)) * 1.4);
  });

  it('follows actual occupation optionally, with no invented woodland, crops or orchards', () => {
    const bounds = { x: 0, y: 0, width: 3000, height: 3000 };
    const occupied = (x: number): PaintSample => ({ height: 300, slope: 0.01, temperature: 18, rain: 1800, landuse: x < 1000 ? 'forest' : x < 2000 ? 'field' : x < 2500 ? 'orchard' : undefined });
    const followed = planPainting(bounds, occupied, { ...options, followLanduse: true });
    const trees = followed.filter(s => s.brush < 4);
    expect(trees.length).toBeGreaterThan(100);
    expect(trees.every(s => s.x < 1000)).toBe(true);
    expect(followed.filter(s => s.brush === 10).every(s => s.x >= 1000 && s.x < 2000)).toBe(true);
    expect(followed.some(s => s.brush === 11)).toBe(true);
    expect(followed.filter(s => s.brush === 11).every(s => s.x >= 2000 && s.x < 2500)).toBe(true);
    expect(planPainting(bounds, occupied, options).some(s => s.brush < 4 && s.x > 2500)).toBe(true);
    expect(planPainting(bounds, () => ({ ...occupied(0), landuse: undefined }), { ...options, followLanduse: true })).toEqual([]);
  });

  it('draws a tree on a wooded slope above the underlying relief brush', () => {
    const landscape = (x: number): PaintSample => ({ height: x < 1400 ? 2000 : 300, slope: x < 1400 ? 0.4 : 0.01, relief: x < 1400 ? 900 : 0, temperature: 28, rain: 1800, landuse: 'forest' });
    const stamps = planPainting({ x: 0, y: 0, width: 3000, height: 3000 }, landscape, { ...options, followLanduse: true });
    const mountains = stamps.filter(isSummit),
      trees = stamps.filter(s => s.brush < 4);
    expect(mountains.length).toBeGreaterThan(0);
    expect(trees.length).toBeGreaterThan(100);
    const tree = trees.find(t => mountains.some(m => Math.abs(t.x - m.x) < m.width / 2 && t.y > m.y - m.height && t.y < m.y))!;
    expect(tree).toBeDefined();
    const mountain = mountains.find(m => Math.abs(tree.x - m.x) < m.width / 2 && tree.y > m.y - m.height && tree.y < m.y)!;
    const atlas: Atlas = { url: 'data:image/png;base64,fixture', width: 400, height: 400, rows: [0, 0.25, 0.5, 0.75, 1] };
    const families = Object.fromEntries(FAMILY_NAMES.map(family => [family, atlas])) as Record<BrushFamily, Atlas>;
    const svg = paintingSvg([tree, mountain], createBrushLibrary('fantasy-color', families), 'ridge');
    expect(svg).toMatch(/<use class="fantasy-relief"[^>]+\/><use class="fantasy-landuse"/);
  });
});
