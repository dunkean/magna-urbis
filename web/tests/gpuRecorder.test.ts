import { describe, expect, it } from 'vitest';
import { RecPath2D, isRecordedPath, newPath } from '../src/render/gpu/path';
import { RecordingCanvas, parseColor } from '../src/render/gpu/recorder';
import { SPRITE_STRIDE, type FillOp, type PathGeometry, type SpriteOp, type StrokeOp } from '../src/render/gpu/displayList';

const subpaths = (g: PathGeometry): [number, number][][] => {
  const out: [number, number][][] = [];
  for (let i = 0; i + 1 < g.starts.length; i++) {
    const pts: [number, number][] = [];
    for (let v = g.starts[i]; v < g.starts[i + 1]; v++) pts.push([g.points[v * 2], g.points[v * 2 + 1]]);
    out.push(pts);
  }
  return out;
};
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const polyDist = (pts: [number, number][], x: number, y: number): number => {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
};
const record = (): { canvas: RecordingCanvas; ctx: CanvasRenderingContext2D } => {
  const canvas = new RecordingCanvas(256, 128);
  return { canvas, ctx: canvas.getContext('2d')! };
};
const image = (w: number, h: number): CanvasImageSource => ({ width: w, height: h }) as unknown as CanvasImageSource;

describe('RecPath2D flattening', () => {
  it('flattens a rect into one closed subpath', () => {
    const p = newPath(); p.rect(1, 2, 10, 5);
    const g = p.geometry(0.25);
    expect(subpaths(g)).toEqual([[[1, 2], [11, 2], [11, 7], [1, 7]]]);
    expect(Array.from(g.closed)).toEqual([1]);
    expect(g.bbox).toEqual([1, 2, 11, 7]);
    expect(isRecordedPath(p)).toBe(true);
    expect(newPath().geometry(1).bbox).toEqual([Infinity, Infinity, -Infinity, -Infinity]);
  });

  it('flattens arcs within tolerance, with the implicit line and anticlockwise sweeps', () => {
    const tol = 0.1, p = newPath();
    p.moveTo(0, 0); p.arc(20, 0, 10, 0, Math.PI);
    const [pts] = subpaths(p.geometry(tol));
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1][0]).toBeCloseTo(30, 4); expect(pts[1][1]).toBeCloseTo(0, 4);
    const last = pts[pts.length - 1];
    expect(last[0]).toBeCloseTo(10, 4); expect(last[1]).toBeCloseTo(0, 4);
    for (let i = 1; i + 1 < pts.length; i++) {
      expect(Math.hypot(pts[i][0] - 20, pts[i][1])).toBeCloseTo(10, 3);
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      expect(10 - Math.hypot(mx - 20, my)).toBeLessThan(tol);
      expect(pts[i][1]).toBeGreaterThanOrEqual(-1e-4); // clockwise from 0 to pi goes through +y (canvas y down)
    }
    const q = newPath(); q.arc(0, 0, 10, 0, Math.PI / 2, true);
    const [arc] = subpaths(q.geometry(tol));
    // Anticlockwise from 0 to pi/2 sweeps 3pi/2 through (0, -10).
    expect(Math.min(...arc.map(([, y]) => y))).toBeLessThan(-10 + tol);
    expect(arc[arc.length - 1][1]).toBeCloseTo(10, 4);
  });

  it('flattens a cubic within tolerance', () => {
    const tol = 0.5, p = newPath();
    p.moveTo(0, 0); p.bezierCurveTo(0, 100, 100, 100, 100, 0);
    const [pts] = subpaths(p.geometry(tol));
    expect(pts.length).toBeGreaterThan(4);
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000, mt = 1 - t;
      const x = 3 * mt * t * t * 100 + t * t * t * 100, y = 3 * mt * mt * t * 100 + 3 * mt * t * t * 100;
      expect(polyDist(pts, x, y)).toBeLessThan(tol);
    }
    // Cached per bucket and invalidated by mutation.
    expect(p.geometry(0.6)).toBe(p.geometry(0.5));
    const v = p.version; p.lineTo(0, 0);
    expect(p.version).toBeGreaterThan(v);
    expect(subpaths(p.geometry(tol))[0].length).toBe(pts.length + 1);
  });

  it('starts a new subpath at the closed start, and appends transformed paths', () => {
    const p = newPath();
    p.moveTo(0, 0); p.lineTo(10, 0); p.lineTo(10, 10); p.closePath(); p.lineTo(20, 20);
    const g = p.geometry(1);
    expect(subpaths(g)).toEqual([[[0, 0], [10, 0], [10, 10]], [[0, 0], [20, 20]]]);
    expect(Array.from(g.closed)).toEqual([1, 0]);

    const a = newPath(); a.rect(0, 0, 1, 1);
    const b = newPath(); b.addPath(a, { a: 2, b: 0, c: 0, d: 2, e: 10, f: 0 });
    expect(b.geometry(0.1).bbox).toEqual([10, 0, 12, 2]);
    expect(b.bounds()).toEqual([10, 0, 12, 2]);
    expect(b.readable).toBe(true);
    const copy = new RecPath2D(b);
    expect(copy.geometry(0.1).bbox).toEqual([10, 0, 12, 2]);
    b.addPath({} as Path2D);
    expect(b.readable).toBe(false);
  });
});

describe('RecordingContext', () => {
  it('saves and restores state', () => {
    const { ctx } = record();
    ctx.fillStyle = '#ff0000'; ctx.globalAlpha = 0.5; ctx.translate(5, 6); ctx.lineWidth = 3;
    ctx.save();
    ctx.fillStyle = 'blue'; ctx.globalAlpha = 0.2; ctx.scale(2, 2); ctx.lineWidth = 7; ctx.setLineDash([1, 2]);
    expect(ctx.getTransform().a).toBe(2);
    ctx.restore();
    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.getLineDash()).toEqual([]);
    const t = ctx.getTransform();
    expect([t.a, t.b, t.c, t.d, t.e, t.f]).toEqual([1, 0, 0, 1, 5, 6]);
    ctx.globalAlpha = 2; // out of range: ignored like Canvas
    expect(ctx.globalAlpha).toBe(0.5);
  });

  it('merges consecutive fills with identical state only', () => {
    const { canvas, ctx } = record();
    const p1 = newPath(), p2 = newPath(), p3 = newPath(), p4 = newPath();
    p1.rect(0, 0, 1, 1); p2.rect(2, 0, 1, 1); p3.rect(4, 0, 1, 1); p4.rect(6, 0, 1, 1);
    ctx.fillStyle = '#ff0000'; ctx.fill(p1);
    ctx.fillStyle = 'rgb(255, 0, 0)'; ctx.fill(p2); // same colour, other spelling
    ctx.globalAlpha = 0.5; ctx.fill(p3);
    ctx.translate(1, 0); ctx.fill(p4);
    ctx.fill(p4, 'evenodd');
    const list = canvas.finish();
    expect(list.unsupported).toBeUndefined();
    const ops = list.ops as FillOp[];
    expect(ops.map((o) => o.paths.length)).toEqual([2, 1, 1, 1]);
    expect(ops[0].paint).toEqual({ kind: 'color', rgba: [1, 0, 0, 1] });
    expect(ops[1].alpha).toBe(0.5);
    expect(ops[2].transform).toEqual([1, 0, 0, 1, 1, 0]);
    expect(ops[3].rule).toBe('evenodd');
    expect(list.stats).toMatchObject({ ops: 4, paths: 5 });
  });

  it('records the default path in the frame of its CTM and copies it on write', () => {
    const { canvas, ctx } = record();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.beginPath(); ctx.rect(0, 0, 1, 1); ctx.fill();
    ctx.rect(3, 0, 1, 1); ctx.fill(); // the held path must not change
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineTo(5, 5);
    ctx.fillStyle = 'white'; ctx.fill();
    const ops = canvas.finish().ops as FillOp[];
    expect(ops[0].transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(ops[0].paths.map((p) => p.geometry(0.1).bbox)).toEqual([[0, 0, 1, 1], [0, 0, 4, 1]]);
    expect(ops[1].transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(subpaths(ops[1].paths[0].geometry(0.1))).toEqual([[[0, 0], [5, 5]]]);
  });

  it('records stroke parameters and strokes the default path in the stroke-time CTM', () => {
    const { canvas, ctx } = record();
    ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'bevel'; ctx.miterLimit = 4;
    ctx.setLineDash([1, 2, 3]); ctx.setLineDash([1, -1]); ctx.lineDashOffset = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0);
    ctx.scale(2, 2); ctx.stroke();
    const [op] = canvas.finish().ops as StrokeOp[];
    expect(op).toMatchObject({ type: 'stroke', width: 3, cap: 'round', join: 'bevel', miterLimit: 4, dash: [1, 2, 3, 1, 2, 3], dashOffset: 2 });
    expect(op.paint).toEqual({ kind: 'color', rgba: [0, 0, 1, 0.5] });
    expect(op.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(subpaths(op.paths[0].geometry(0.1))).toEqual([[[0, 0], [5, 0]]]);
  });

  it('batches sprites with per-instance alpha and never merges destination-in', () => {
    const { canvas, ctx } = record();
    const atlas = image(64, 32), mask = image(8, 8);
    ctx.globalAlpha = 1; ctx.drawImage(atlas, 1, 2);
    ctx.globalAlpha = 0.5; ctx.drawImage(atlas, 0, 0, 10, 20);
    ctx.translate(3, 4); ctx.drawImage(atlas, 16, 0, 16, 16, 5, 6, 7, 8);
    ctx.globalAlpha = 0; ctx.drawImage(atlas, 0, 0); // invisible: skipped
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0); ctx.drawImage(mask, 0, 0); // alpha 0 still clears with destination-in
    const ops = canvas.finish().ops as SpriteOp[];
    expect(ops.map((o) => [o.composite, o.count])).toEqual([['source-over', 3], ['destination-in', 1], ['destination-in', 1]]);
    const v = Array.from(ops[0].instances);
    expect(v.length).toBe(3 * SPRITE_STRIDE);
    expect(v.slice(0, 8)).toEqual([0, 0, 64, 32, 1, 2, 64, 32]);
    expect(v[SPRITE_STRIDE - 1]).toBe(1);
    expect(v.slice(SPRITE_STRIDE + 4, SPRITE_STRIDE + 8)).toEqual([0, 0, 10, 20]);
    expect(v[2 * SPRITE_STRIDE - 1]).toBe(0.5);
    expect(v.slice(2 * SPRITE_STRIDE)).toEqual([16, 0, 16, 16, 5, 6, 7, 8, 1, 0, 0, 1, 3, 4, 0.5]);
  });

  it('builds an immutable clip chain restored by restore()', () => {
    const { canvas, ctx } = record();
    const a = newPath(), b = newPath(), shape = newPath();
    a.rect(0, 0, 100, 100); b.rect(10, 10, 50, 50); shape.rect(0, 0, 5, 5);
    ctx.save(); ctx.clip(a); ctx.clip(b, 'evenodd');
    ctx.fill(shape);
    ctx.restore();
    ctx.fill(shape);
    const ops = canvas.finish().ops as FillOp[];
    expect(ops.length).toBe(2);
    const clip = ops[0].clip!;
    expect(clip.path).toBe(b); expect(clip.rule).toBe('evenodd');
    expect(clip.parent!.path).toBe(a); expect(clip.parent!.parent).toBeNull();
    expect(clip.id).toBeGreaterThan(clip.parent!.id);
    expect(ops[1].clip).toBeNull();
  });

  it('parses colours', () => {
    expect(parseColor('#abc')).toEqual([0xaa / 255, 0xbb / 255, 0xcc / 255, 1]);
    expect(parseColor('#11223344')).toEqual([0x11 / 255, 0x22 / 255, 0x33 / 255, 0x44 / 255]);
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual([1, 0, 0, 0.5]);
    expect(parseColor(' RGBA(0, 0, 255, 0.25) ')).toEqual([0, 0, 1, 0.25]);
    const green = parseColor('hsl(120, 100%, 50%)')!;
    expect(green[0]).toBeCloseTo(0); expect(green[1]).toBeCloseTo(1); expect(green[2]).toBeCloseTo(0);
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(parseColor('white')).toEqual([1, 1, 1, 1]);
    expect(parseColor('nope')).toBeNull();
    expect(parseColor('#12')).toBeNull();
  });

  it('marks unsupported calls, first reason wins', () => {
    let { canvas, ctx } = record();
    ctx.fillText('a', 0, 0);
    ctx.fill({} as Path2D);
    expect(canvas.finish().unsupported).toBe('text');
    ({ canvas, ctx } = record());
    ctx.fill({} as Path2D);
    expect(canvas.finish().unsupported).toBe('native Path2D');
    ({ canvas, ctx } = record());
    ctx.fillStyle = ctx.createLinearGradient(0, 0, 1, 1);
    expect(canvas.finish().unsupported).toBe('gradient');
    ({ canvas, ctx } = record());
    ctx.globalCompositeOperation = 'lighter'; ctx.fillRect(0, 0, 1, 1);
    expect(canvas.finish().unsupported).toBe('composite lighter');
  });

  it('skips ops that cannot change pixels', () => {
    const { canvas, ctx } = record();
    ctx.clearRect(0, 0, 10, 10); // nothing drawn yet
    ctx.globalAlpha = 0; ctx.fillRect(0, 0, 10, 10);
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, 10, 10);
    ctx.fillStyle = 'black'; ctx.beginPath(); ctx.fill(); // empty path
    ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = 0; ctx.fillRect(0, 0, 4, 4); // clears: kept
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, 2, 2); // after drawing: kept
    const list = canvas.finish();
    expect(list.ops.map((o) => o.type)).toEqual(['fill', 'clear']);
    expect((list.ops[0] as FillOp).composite).toBe('destination-in');
  });
});
