import { describe, expect, it } from 'vitest';
import { newPath } from '../src/render/gpu/path';
import { RecordingCanvas, type RecordingContext } from '../src/render/gpu/recorder';
import { CRISP_MARK, type FillOp, type PathGeometry, type StrokeOp } from '../src/render/gpu/contract';
import { clipGeometry, clipList, cullList, cullSegments, markIndex, splitList } from '../src/render/gpu/listTools';

const record = (w: number, h: number): { canvas: RecordingCanvas; ctx: CanvasRenderingContext2D } => {
  const canvas = new RecordingCanvas(w, h);
  return { canvas, ctx: canvas.getContext('2d')! };
};

describe('display list marks and split', () => {
  it('marks a section boundary, stops merging across it and splits there', () => {
    const { canvas, ctx } = record(100, 100);
    const a = newPath(),
      b = newPath();
    a.rect(0, 0, 10, 10);
    b.rect(20, 0, 10, 10);
    ctx.fillStyle = '#ff0000';
    ctx.fill(a);
    (ctx as unknown as RecordingContext).mark(CRISP_MARK);
    ctx.fill(b); // same state: it would have joined the first op without the mark
    const list = canvas.finish();
    expect(list.ops.length).toBe(2);
    expect(list.marks).toEqual([{ name: CRISP_MARK, at: 1 }]);
    expect(markIndex(list, CRISP_MARK)).toBe(1);
    expect(markIndex(list, 'other')).toBe(-1);
    const [prefix, suffix] = splitList(list, markIndex(list, CRISP_MARK));
    expect(prefix.ops.length).toBe(1);
    expect(prefix.ops[0]).toBe(list.ops[0]);
    expect(suffix.ops.length).toBe(1);
    expect(suffix.ops[0]).toBe(list.ops[1]);
    expect([prefix.width, prefix.height, suffix.width, suffix.height]).toEqual([100, 100, 100, 100]);
    expect(prefix.stats.ops + suffix.stats.ops).toBe(2);
  });

  it('records no mark unless asked: an unmarked list is as before', () => {
    const { canvas, ctx } = record(100, 100);
    const a = newPath(),
      b = newPath();
    a.rect(0, 0, 10, 10);
    b.rect(20, 0, 10, 10);
    ctx.fill(a);
    ctx.fill(b);
    const list = canvas.finish();
    expect(list.ops.length).toBe(1);
    expect(list.marks).toBeUndefined();
    expect(markIndex(list, CRISP_MARK)).toBe(-1);
    // A mark belongs to the list it was set in.
    (ctx as unknown as RecordingContext).mark(CRISP_MARK);
    ctx.fill(a);
    expect(canvas.finish().marks).toEqual([{ name: CRISP_MARK, at: 0 }]);
    ctx.fill(a);
    expect(canvas.finish().marks).toBeUndefined();
  });
});

describe('cullList', () => {
  it('drops the paths and ops that cannot touch the box and keeps the others as they are', () => {
    const { canvas, ctx } = record(200, 100);
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const inside = newPath(),
      outside = newPath(),
      line = newPath(),
      away = newPath();
    inside.rect(10, 10, 10, 10); // device 20..40
    outside.rect(10, 200, 10, 10); // device y 400..420
    line.moveTo(0, 60);
    line.lineTo(50, 60); // device y 120, 20 px under the box
    away.rect(0, 300, 10, 10);
    ctx.fillStyle = '#00ff00';
    ctx.fill(inside);
    ctx.fill(outside); // one op, two paths
    ctx.lineJoin = 'round';
    ctx.lineWidth = 30;
    ctx.stroke(line); // 60 px wide: reaches the box
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#0000ff';
    ctx.stroke(line); // 2 px wide: does not
    ctx.save();
    ctx.clip(away);
    ctx.fillStyle = '#ff0000';
    ctx.fill(inside);
    ctx.restore(); // clipped away
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fill(outside); // acts on the whole clip: kept
    const list = canvas.finish();
    expect(list.ops.length).toBe(5);
    const culled = cullList(list, [0, 0, 200, 100]);
    expect(culled.ops.length).toBe(3);
    const fill = culled.ops[0] as FillOp;
    expect(fill.paths.length).toBe(1);
    expect(fill.paths[0]).toBe(inside);
    expect((list.ops[0] as FillOp).paths.length).toBe(2); // the recorded op is not touched
    expect(culled.ops[1]).toBe(list.ops[1]);
    expect((culled.ops[1] as StrokeOp).width).toBe(30);
    expect(culled.ops[2]).toBe(list.ops[4]);
    expect((culled.ops[2] as FillOp).composite).toBe('destination-in');
    expect(culled.width).toBe(200);
    expect(culled.stats.ops).toBe(3);
  });

  it('returns the list itself when nothing is dropped', () => {
    const { canvas, ctx } = record(200, 100);
    const a = newPath();
    a.rect(10, 10, 10, 10);
    ctx.fill(a);
    ctx.lineWidth = 2;
    ctx.stroke(a);
    const list = canvas.finish();
    expect(cullList(list, [0, 0, 200, 100])).toBe(list);
  });
});

/** Crossings of the ray going right from (x, y) with the closed subpaths of `g` (odd: inside, for evenodd). */
const crossings = (g: PathGeometry, x: number, y: number): number => {
  let n = 0;
  for (let s = 0; s + 1 < g.starts.length; s++) {
    const from = g.starts[s],
      count = g.starts[s + 1] - from;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count,
        ax = g.points[(from + i) * 2],
        ay = g.points[(from + i) * 2 + 1],
        bx = g.points[(from + j) * 2],
        by = g.points[(from + j) * 2 + 1];
      if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) n++;
    }
  }
  return n;
};

describe('clipGeometry and clipList', () => {
  const square: PathGeometry = { points: new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]), starts: new Uint32Array([0, 4]), closed: new Uint8Array([1]), bbox: [0, 0, 10, 10] };

  it('keeps the runs of whole segments that meet the window', () => {
    // Of the closed square, the bottom and right sides meet the window: one open run of three vertices.
    const run = cullSegments(square, [8, -1, 20, 5])!;
    expect(Array.from(run.points)).toEqual([0, 0, 10, 0, 10, 10]);
    expect(Array.from(run.starts)).toEqual([0, 3]);
    expect(Array.from(run.closed)).toEqual([0]);
    expect(cullSegments(square, [20, 20, 30, 30])).toBeNull();
    const whole = cullSegments(square, [-1, -1, 11, 11])!;
    expect(Array.from(whole.closed)).toEqual([1]);
    expect(Array.from(whole.points)).toEqual(Array.from(square.points));
  });

  it('keeps the segments of a long solid stroke that can reach the box and never cuts a dashed one', () => {
    const { canvas, ctx } = record(100, 100);
    const line = newPath();
    // 201 vertices every 50 px from x = -5000 to 5000, zigzagging between y = 50 and 51.
    for (let i = 0; i <= 200; i++) {
      const x = -5000 + i * 50,
        y = 50 + (i % 2);
      if (i) line.lineTo(x, y);
      else line.moveTo(x, y);
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.stroke(line);
    ctx.setLineDash([4, 2]);
    ctx.stroke(line);
    const list = canvas.finish();
    expect(list.ops.length).toBe(2);
    const cut = clipList(list, [0, 0, 100, 100]);
    const solid = cut.ops[0] as StrokeOp,
      kept = solid.paths[0].geometry(1);
    expect(solid.paths[0]).not.toBe(line);
    // The window is the box, its 32 px margin and the 3.5 px reach of the stroke: the four segments from -50 to 150.
    expect(kept.points.length).toBe(10);
    expect(kept.bbox).toEqual([-50, 50, 150, 51]);
    expect(Array.from(kept.closed)).toEqual([0]);
    expect(solid.width).toBe(2);
    expect(cut.ops[1]).toBe(list.ops[1]); // dashes are measured from the start of the path
  });

  it('cuts a ring to the window and drops a ring outside it', () => {
    const cut = clipGeometry(square, [5, -100, 100, 100])!;
    expect(Array.from(cut.starts)).toEqual([0, 4]);
    expect(cut.bbox).toEqual([5, 0, 10, 10]);
    expect(crossings(cut, 7, 5)).toBe(1);
    expect(clipGeometry(square, [20, 20, 30, 30])).toBeNull();
    // Wholly inside: the same vertices.
    expect(Array.from(clipGeometry(square, [-1, -1, 11, 11])!.points)).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
  });

  it('cuts the map-sized polygons of fills and clips and keeps their winding in the box', () => {
    const { canvas, ctx } = record(100, 100);
    const big = newPath(),
      small = newPath(),
      away = newPath();
    // A 96-sided ring of radius 2000 around the box, with a square hole inside the box.
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2,
        x = 50 + 2000 * Math.cos(a),
        y = 50 + 2000 * Math.sin(a);
      if (i) big.lineTo(x, y);
      else big.moveTo(x, y);
    }
    big.closePath();
    big.rect(40, 40, 20, 20);
    small.rect(45, 45, 10, 10);
    away.rect(1000, 1000, 100, 100);
    ctx.fillStyle = '#00ff00';
    ctx.fill(big, 'evenodd');
    ctx.stroke(big);
    ctx.save();
    ctx.clip(big, 'evenodd');
    ctx.fillStyle = '#ff0000';
    ctx.fill(small);
    ctx.fillStyle = '#0000ff';
    ctx.fill(small);
    ctx.restore();
    ctx.save();
    ctx.clip(away);
    ctx.fill(small);
    ctx.restore(); // nothing of this clip is in the box
    const list = canvas.finish();
    expect(list.ops.length).toBe(5);
    const cut = clipList(list, [0, 0, 100, 100]);
    expect(cut.ops.length).toBe(4);
    const fill = cut.ops[0] as FillOp,
      outline = fill.paths[0].geometry(1);
    expect(fill.paths[0]).not.toBe(big);
    expect(fill.rule).toBe('evenodd');
    // The ring became the window (the box and its margin); the hole inside the box is untouched.
    expect(outline.bbox).toEqual([-32, -32, 132, 132]);
    expect(outline.points.length).toBeLessThan(40);
    expect(crossings(outline, 10, 10) % 2).toBe(1);
    expect(crossings(outline, 50, 50) % 2).toBe(0);
    // The stroke keeps the outlines whose segments can reach the box: the hole's, not the far ring's.
    const stroke = cut.ops[1] as StrokeOp;
    expect(stroke.paths[0]).not.toBe(big);
    expect(stroke.paths[0].geometry(1).bbox).toEqual([40, 40, 60, 60]);
    const a = cut.ops[2] as FillOp,
      b = cut.ops[3] as FillOp,
      before = (list.ops[2] as FillOp).clip!;
    expect(a.clip).toBe(b.clip); // one node for the ops that shared one
    expect(a.clip).not.toBe(before);
    expect(a.clip!.path).toBe(fill.paths[0]); // the same cut outline, made once
    expect([a.clip!.rule, a.clip!.id, a.clip!.parent]).toEqual([before.rule, before.id, null]);
    expect(a.paths[0]).toBe(small);
    expect((list.ops[0] as FillOp).paths[0]).toBe(big); // the recorded list is not touched
  });

  it('returns the list itself when no polygon is worth cutting', () => {
    const { canvas, ctx } = record(100, 100);
    const a = newPath();
    a.rect(-50, -50, 300, 300);
    ctx.fill(a);
    ctx.save();
    ctx.clip(a);
    ctx.fillStyle = '#ff0000';
    ctx.fill(a);
    ctx.restore();
    const list = canvas.finish();
    expect(clipList(list, [0, 0, 100, 100])).toBe(list);
  });
});
