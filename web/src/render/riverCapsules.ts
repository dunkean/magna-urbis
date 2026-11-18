/** Axis-aligned box in map metres. */
export interface CapsuleBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Floats per segment of the `riverSegments` layout: x0, y0, x1, y1, full width at each end, then colour/regime. */
const STRIDE = 9;

/**
 * The segments (`riverSegments` layout) whose capsule (full widths) touches the box. A town's water clip only needs
 * the rivers around it: the whole map's network turned into one clip path per town and frame froze the 2D view.
 */
export function riverSegmentsInBox(rivers: Float32Array, box: CapsuleBox): Float32Array {
  const keep: number[] = [];
  for (let i = 0; i + STRIDE <= rivers.length; i += STRIDE) {
    const x0 = rivers[i],
      y0 = rivers[i + 1],
      x1 = rivers[i + 2],
      y1 = rivers[i + 3],
      r = Math.max(rivers[i + 4], rivers[i + 5]) / 2;
    if (Math.max(x0, x1) + r < box.minX || Math.min(x0, x1) - r > box.maxX || Math.max(y0, y1) + r < box.minY || Math.min(y0, y1) - r > box.maxY) continue;
    keep.push(i);
  }
  const out = new Float32Array(keep.length * STRIDE);
  keep.forEach((at, k) => out.set(rivers.subarray(at, at + STRIDE), k * STRIDE));
  return out;
}

/** The union of the river capsules (`riverSegments` layout, full widths) as one non-zero path. */
export function riverCapsules(rivers: Float32Array): Path2D {
  const path = new Path2D();
  for (let i = 0; i + STRIDE <= rivers.length; i += STRIDE) {
    const x0 = rivers[i],
      y0 = rivers[i + 1],
      x1 = rivers[i + 2],
      y1 = rivers[i + 3],
      r0 = rivers[i + 4] / 2,
      r1 = rivers[i + 5] / 2;
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l > 1e-6) {
      // The same winding as the end discs: the union keeps every overlap filled. No closePath: fill and clip close
      // each subpath, and Path2D.closePath grew with the path (30 s for one 40 km network in Chrome 157).
      const nx = -(y1 - y0) / l,
        ny = (x1 - x0) / l;
      path.moveTo(x0 - nx * r0, y0 - ny * r0);
      path.lineTo(x1 - nx * r1, y1 - ny * r1);
      path.lineTo(x1 + nx * r1, y1 + ny * r1);
      path.lineTo(x0 + nx * r0, y0 + ny * r0);
    }
    if (r0 > 0) {
      path.moveTo(x0 + r0, y0);
      path.arc(x0, y0, r0, 0, Math.PI * 2);
    }
    if (r1 > 0) {
      path.moveTo(x1 + r1, y1);
      path.arc(x1, y1, r1, 0, Math.PI * 2);
    }
  }
  return path;
}
