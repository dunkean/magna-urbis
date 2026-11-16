import { describe, expect, it } from 'vitest';
import { buildMinimalGeometry, emptyMinimalGeometry, paintMinimalMap, bakeMinimalRelief, minimalWaterPolygons, minimalContours, type MinimalFeature } from '../src/render/minimalMap';
import { presetComposition } from '../src/render/composition';
import { PALETTES } from '../src/render/styles';

class RecordingPath {
  points: number[][] = [];
  moveTo(x: number, y: number): void { this.points.push([x, y]); }
  lineTo(x: number, y: number): void { this.points.push([x, y]); }
  closePath(): void {}
}
const square = (x: number, y: number, size = 10) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];
function build(features: MinimalFeature[]) {
  const result = emptyMinimalGeometry(1000);
  for (const _ of buildMinimalGeometry(1000, features, result, RecordingPath as unknown as new () => Path2D)) { /* drain bounded steps */ }
  return result;
}
function context() {
  const calls: { kind: string; color: string | CanvasGradient | CanvasPattern; alpha: number; path?: Path2D }[] = [];
  const ctx = { canvas: { width: 1000, height: 1000 }, fillStyle: '', strokeStyle: '', globalAlpha: 1,
    setTransform() {}, clearRect() {}, fillRect() {},
    fill(this: CanvasRenderingContext2D, path: Path2D) { calls.push({ kind: 'fill', color: this.fillStyle, alpha: this.globalAlpha, path }); },
    stroke(this: CanvasRenderingContext2D, path: Path2D) { calls.push({ kind: 'stroke', color: this.strokeStyle, alpha: this.globalAlpha, path }); },
    measureText(text: string) { return { width: text.length * 6 }; },
    strokeText(this: CanvasRenderingContext2D) { calls.push({ kind: 'strokeText', color: this.strokeStyle, alpha: this.globalAlpha }); },
    fillText(this: CanvasRenderingContext2D) { calls.push({ kind: 'fillText', color: this.fillStyle, alpha: this.globalAlpha }); },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
const options = () => ({ view: { cx: 500, cy: 500, scale: 1 }, width: 1000, height: 1000, dpr: 1, recipe: presetComposition('minimal'), places: [], textLayout: { labels: [] } });

describe('Minimal retained painter', () => {
  it('retains sea and lake islands independently of ring winding', () => {
    const coast = square(0, 0, 100), island = square(20, 20, 60), pond = square(30, 30, 10), lake = square(200, 200, 30);
    const shapes = [...minimalWaterPolygons([island, lake, coast, pond])];
    expect(shapes).toHaveLength(3);
    expect(shapes.find(shape => shape.points === coast)?.holes).toEqual([island]);
    expect(shapes.find(shape => shape.points === pond)?.holes).toEqual([]);
  });

  it('batches thousands of footprints into the same draw calls and never rebuilds on navigation', () => {
    const a = build([{ layer: 'building', points: square(20, 20), closed: true }]);
    const many = build(Array.from({ length: 10000 }, (_, i) => ({ layer: 'building', points: square(20 + i % 20, 20 + i % 30), closed: true })));
    const small = context(), large = context(); paintMinimalMap(small.ctx, a, options()); paintMinimalMap(large.ctx, many, options());
    expect(large.calls.length).toBe(small.calls.length); expect(large.calls.length).toBe(2);
    const paths = [...many.cells.flatMap(cell => [...cell.values()].map(batch => batch.path))];
    paintMinimalMap(large.ctx, many, { ...options(), view: { cx: 35, cy: 35, scale: 3 } });
    expect(many.cells.flatMap(cell => [...cell.values()].map(batch => batch.path))).toEqual(paths);
    const far = context(); paintMinimalMap(far.ctx, many, { ...options(), view: { cx: 500, cy: 500, scale: .05 } });
    expect(far.calls).toHaveLength(0);
  });
  it('culls cells and honors water, road, land-use class/opacity and text controls', () => {
    const geometry = build([{ layer: 'building', points: square(20, 20), closed: true }, { layer: 'building', points: square(850, 850), closed: true },
      { layer: 'forest', points: square(20, 20, 60), closed: true }, { layer: 'field', points: square(20, 20, 60), closed: true },
      { layer: 'water', points: square(20, 20, 60), closed: true }, { layer: 'major', points: square(20, 20) }]);
    const full = context(); paintMinimalMap(full.ctx, geometry, options());
    const local = context(), o = options(); o.view = { cx: 40, cy: 40, scale: 5 }; o.width = o.height = 200;
    o.recipe.landuse.rural = 'categorical'; o.recipe.landuse.classes = { forest: false }; o.recipe.landuse.opacity = .23;
    o.recipe.networks.water.visible = false; o.recipe.networks.roads.visible = false;
    paintMinimalMap(local.ctx, geometry, o);
    expect(local.calls.filter(c => c.color === PALETTES.minimal.urban.mass)).toHaveLength(1);
    expect(local.calls.filter(c => c.color === PALETTES.minimal.land.field)).toMatchObject([{ alpha: .23 }]);
    expect(local.calls.some(c => c.color === PALETTES.minimal.land.forest || c.color === PALETTES.minimal.seaFill || c.color === PALETTES.minimal.roadFill)).toBe(false);
    const labels = context(), textOptions = { ...options(), places: [{ x: 100, y: 100, name: 'Town', population: 10 }, { x: 100, y: 100, name: 'Village', population: 1 }] };
    paintMinimalMap(labels.ctx, geometry, textOptions);
    expect(labels.calls.filter(c => c.kind === 'fillText')).toHaveLength(1);
    textOptions.recipe.text.groups.places = false; labels.calls.length = 0;
    paintMinimalMap(labels.ctx, geometry, textOptions); expect(labels.calls.some(c => c.kind === 'fillText')).toBe(false);
  });
  it('traces one fixed set of contour lines and draws it only when the recipe asks', () => {
    // A cone 100 m high on a 64 x 64 raster: closed rings at a round interval, an index line among them.
    const n = 64, data = Float32Array.from({ length: n * n }, (_, i) => 100 - Math.hypot(i % n - 31.5, Math.floor(i / n) - 31.5) * 4);
    const lines = [...minimalContours({ data, n, width: 1000, maxHeight: 100 })];
    expect(lines.length).toBeGreaterThan(5); expect(lines.every(line => line.closed)).toBe(true);
    expect(lines.some(line => line.layer === 'contourIndex')).toBe(true);
    const contours = build(lines), off = context(), on = context(), o = options();
    paintMinimalMap(off.ctx, build([]), { ...o, contours });
    expect(off.calls).toHaveLength(0);
    o.recipe.ground.contours = true; paintMinimalMap(on.ctx, build([]), { ...o, contours });
    expect(on.calls.length).toBeGreaterThan(0); expect(on.calls.every(c => c.kind === 'stroke' && c.color === PALETTES.minimal.inkSoft)).toBe(true);
    const zoomed = context(); paintMinimalMap(zoomed.ctx, build([]), { ...o, contours, view: { cx: 500, cy: 500, scale: .2 } });
    expect(zoomed.calls.length).toBe(on.calls.length);
  });
  it('bakes relief in bounded rows with transparent sea pixels and no image decoding', () => {
    let result: ImageData | undefined;
    const canvas = { width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: (image: ImageData) => { result = image; } }) } as unknown as HTMLCanvasElement;
    const work = bakeMinimalRelief({ data: [-1, 2, 3, 4], n: 2, width: 100, maxHeight: 4 }, canvas);
    expect(work.next().done).toBe(false); expect(result).toBeUndefined();
    for (const _ of work) { /* drain rows */ }
    expect(canvas.width).toBe(2); expect(result!.data[3]).toBe(0); expect(result!.data[7]).toBeGreaterThan(0);
  });
});
