/** The renderer adds bend at both ends and metres along the channel to each hydraulic segment.
 * Sample secants over a channel width: refining a polyline should not make its point bars disappear. */
export const RIVER_INSTANCE_FLOATS = 12;

export function riverInstances(segments: Float32Array, material: boolean): Float32Array {
  const count = segments.length / 9;
  const data = new Float32Array(count * RIVER_INSTANCE_FLOATS);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 9; k++) data[i * RIVER_INSTANCE_FLOATS + k] = segments[i * 9 + k];
  }
  if (!material) return data;

  const distance = new Float64Array(count + 1);
  // Locate a sample in a densely subdivided reach without walking all its vertices.
  const lowerBound = (lo: number, hi: number, target: number): number => {
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (distance[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // Keep the bed and the running thread as separate continuous profiles. Optical masks have no bed.
  const course = (i: number): number => {
    const blue = segments[9 * i + 8];
    return blue < 0 || blue >= 0.5 ? 0 : segments[9 * i + 6] > 0.1 ? 1 : 2;
  };
  for (let start = 0; start < count; ) {
    let end = start + 1;
    while (end < count && course(start) !== 0 && course(start) === course(end) && segments[9 * (end - 1) + 2] === segments[9 * end] && segments[9 * (end - 1) + 3] === segments[9 * end + 1]) end++;
    distance[start] = 0;
    for (let i = start; i < end; i++) {
      const p = 9 * i;
      data[i * RIVER_INSTANCE_FLOATS + 11] = distance[i];
      distance[i + 1] = distance[i] + Math.hypot(segments[p + 2] - segments[p], segments[p + 3] - segments[p + 1]);
    }
    for (let i = start + 1; i < end; i++) {
      const p = 9 * i, width = Math.max(3, segments[p + 4]);
      let a = i - 1, b = i + 1;
      if (a > start && distance[i] - distance[a] < width) a = Math.max(start, lowerBound(start, a, distance[i] - width) - 1);
      if (b < end && distance[b] - distance[i] < width) b = lowerBound(b, end, distance[i] + width);
      const last = 9 * (b - 1) + 2;
      const ax = segments[p] - segments[9 * a], ay = segments[p + 1] - segments[9 * a + 1];
      const bx = segments[last] - segments[p], by = segments[last + 1] - segments[p + 1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      // Signed Menger curvature times width, with positive values on left turns.
      const bend = Math.min(1, Math.max(-1, 4 * width * (ax * by - ay * bx) / Math.max(0.001, la * lb * Math.hypot(ax + bx, ay + by))));
      data[(i - 1) * RIVER_INSTANCE_FLOATS + 10] = data[i * RIVER_INSTANCE_FLOATS + 9] = bend;
    }
    start = end;
  }
  return data;
}
