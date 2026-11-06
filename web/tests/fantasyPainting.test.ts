import { describe, expect, it } from 'vitest';
import { planPainting, createBrushLibrary, brushFrame, paintingSvg, FAMILY_NAMES, type Atlas, type BrushFamily, type PaintSample, paintingCover } from '../../rust/bridge/fantasyPainting';
const sample = (x: number, y: number): PaintSample => ({ height: x < 1500 ? -10 : 300 + y * .04, slope: .08, temperature: 18, rain: 1600, water: y > 7000 && y < 7500 });
const options = { seed: 'fantasy-42', pitch: 150 };
// Overview raster: 1400 px for a map 65 brush pitches wide; stamp sizes clamp in px, then convert to metres.
const mpp = options.pitch * 65 / 1400, mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
describe('fantasy cartographic placement', () => {
  it('packs variable relief and fixed-width trees, preserving relief under a tight budget', () => {
    const bounds = { x: 0, y: 0, width: 10000, height: 10000 };
    const landscape = (x: number) => ({ height: x < 5000 ? 2200 : 300, slope: .03, temperature: 18, rain: 1800 });
    const stamps = planPainting(bounds, landscape, options);
    const summits = stamps.filter(s => s.brush === 5 || s.brush === 6);
    const trees = stamps.filter(s => s.brush < 4 || s.brush >= 12 && s.brush <= 14);
    expect(summits.length).toBeGreaterThan(40);
    // Summit widths vary (heavy-tailed) but stay within the mountain pixel clamp times the largest size multiplier.
    expect(summits.every(s => s.width > 0 && s.width <= 90 * mpp * 2.1)).toBe(true);
    expect(Math.max(...summits.map(s => s.width))).toBeGreaterThan(Math.min(...summits.map(s => s.width)) * 2);
    // Trees share one fixed width (the overview crown clamp).
    expect(new Set(trees.map(s => s.width)).size).toBe(1);
    expect(trees[0].width).toBeCloseTo(4.5 * mpp, 6);
    expect(trees.every(s => s.heightScale! >= .95 && s.heightScale! <= 1.05)).toBe(true);
    // Half the map alone contains several times the former whole-map forest count.
    expect(trees.length).toBeGreaterThan(5000);
    const limited = planPainting(bounds, landscape, { ...options, maxStamps: 512 });
    expect(limited).toHaveLength(512);
    expect(limited.every(s => s.brush === 5 || s.brush === 6)).toBe(true);
  });
  it('fills rolling terrain with many hills capped well below peak size', () => {
    const stamps = planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, () => ({ height: 500, slope: .3, temperature: 18, rain: 1500 }), options);
    expect(stamps.length).toBeGreaterThan(1000);
    const hills = stamps.filter(s => s.brush === 4);
    expect(hills.length).toBeGreaterThan(800);
    expect(hills.every(s => s.width <= 34 * mpp * 1.3)).toBe(true);
    expect(stamps.some(s => s.brush < 4)).toBe(true);
  });
  it('replays exactly and preserves world anchors between overlapping crops', () => {
    const a = planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, sample, options);
    expect(a.length).toBeGreaterThan(300);
    expect(planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, sample, options)).toEqual(a);
    const crop = planPainting({ x: 3000, y: 3000, width: 4000, height: 4000 }, sample, options);
    const inner = (s: typeof a[number]) => s.x > 3200 && s.x < 6800 && s.y > 3200 && s.y < 6800;
    expect(crop.filter(inner)).toEqual(a.filter(inner));
    expect(a.every(s => s.x > 1500 && !(s.y > 7000 && s.y < 7500))).toBe(true);
    expect(a.every((s, i) => i === 0 || s.y >= a[i - 1].y)).toBe(true);
  });
  it('keeps the budget spread across the map and rejects invalid inputs', () => {
    const result = planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, sample, { ...options, maxStamps: 20 });
    expect(result).toHaveLength(20);
    expect(result[0].y).toBeLessThan(2000); expect(result[19].y).toBeGreaterThan(8000);
    expect(planPainting({ x: 0, y: 0, width: 100, height: 100 }, sample, { ...options, pitch: NaN })).toEqual([]);
  });
  it('retains increasing brush density at the minimum spacing control', () => {
    const forest = () => ({ height: 300, slope: .03, temperature: 18, rain: 1800 });
    const bounds = { x: 0, y: 0, width: 10000, height: 10000 };
    const dense = planPainting(bounds, forest, { ...options, density: .5, pitch: 10000 / 65 * .3 });
    const loose = planPainting(bounds, forest, { ...options, density: .5, pitch: 10000 / 65 * .35 });
    expect(dense.length).toBeGreaterThan(loose.length);
  });
  it('renders flat land and uses six tree silhouettes in each style', () => {
    const stamps = planPainting({ x: 0, y: 0, width: 10000, height: 10000 }, () => ({ height: .3, slope: .01, temperature: 6, rain: 1500 }), options);
    expect(stamps.length).toBeGreaterThan(100);
    const atlas: Atlas = { url: 'data:image/png;base64,fixture', width: 400, height: 400, rows: [0,.25,.5,.75,1] };
    const families = Object.fromEntries(FAMILY_NAMES.map(family => [family, atlas])) as Record<BrushFamily, Atlas>;
    const ink = createBrushLibrary('fantasy-ink', families), color = createBrushLibrary('fantasy-color', families);
    expect(new Set(stamps.filter(s => s.brush === 0 || s.brush === 12).map(s => brushFrame(ink, s).index)).size).toBe(6);
    expect(stamps.every(s => brushFrame(color, s).index === brushFrame(ink, s).index + 8)).toBe(true);
    const svg = paintingSvg(stamps, color, 'fixture');
    expect(svg).toContain('data-brush="pines"'); expect(svg).toContain('data-variant="5"');
    expect((svg.match(/<image /g) ?? []).length).toBeLessThan(5);
  });
  it('keeps high valleys wooded while ridge brushes grow with relief towards the summits', () => {
    const valley = { height: 1800, slope: .08, tpi: -.12, relief: 900, temperature: 18, rain: 1600 };
    const ridge = { ...valley, tpi: .12, slope: .45 };
    expect(paintingCover(valley).woods).toBeGreaterThan(paintingCover(ridge).woods);
    expect(paintingCover(valley).mountain).toBeLessThan(.16);
    const mountains = (relief: number) => planPainting({ x: 0, y: 0, width: 3000, height: 3000 }, () => ({ ...ridge, height: 600, relief, temperature: 28 }), options).filter(s => s.brush === 5 || s.brush === 6);
    const low = mountains(500), high = mountains(900);
    expect(low.length).toBeGreaterThan(10); expect(high.length).toBeGreaterThan(10);
    // Hierarchy holds on average; individual sizes overlap because of the per-stamp variance.
    expect(mean(high.map(s => s.width))).toBeGreaterThan(mean(low.map(s => s.width)) * 1.4);
  });

  it('follows actual occupation optionally, with no invented woodland, crops or orchards', () => {
    const bounds = { x: 0, y: 0, width: 3000, height: 3000 };
    const occupied = (x: number): PaintSample => ({ height: 300, slope: .01, temperature: 18, rain: 1800,
      landuse: x < 1000 ? 'forest' : x < 2000 ? 'field' : x < 2500 ? 'orchard' : undefined });
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

  it('keeps tree silhouettes clear of mountains, including low forest anchors next to a ridge', () => {
    const landscape = (x: number): PaintSample => ({ height: x < 1400 ? 2000 : 300, slope: x < 1400 ? .4 : .01,
      relief: x < 1400 ? 900 : 0, temperature: 28, rain: 1800, landuse: 'forest' });
    const stamps = planPainting({ x: 0, y: 0, width: 3000, height: 3000 }, landscape, { ...options, followLanduse: true });
    const mountains = stamps.filter(s => s.brush === 5 || s.brush === 6), trees = stamps.filter(s => s.brush < 4);
    expect(mountains.length).toBeGreaterThan(10); expect(trees.length).toBeGreaterThan(100);
    expect(trees.every(t => t.x >= 1400 && !mountains.some(m => Math.abs(t.x - m.x) < (m.width + t.width) / 2
      && t.y > m.y - m.width * 1.1 && t.y - t.width * 1.9 < m.y + m.width * .1))).toBe(true);
  });

});
