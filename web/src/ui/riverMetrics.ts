/**
 * Geomorphic statistics of a river network, to compare with the laws real
 * rivers follow (see docs/synthese_rivieres_heightmap.md, section 3.7):
 * - Hack (1957): main stream length L ∝ A^h, h ≈ 0.5–0.6;
 * - Flint (1974): channel slope S ∝ A^−θ, concavity θ ≈ 0.35–0.6;
 * - Horton–Strahler: bifurcation ratio N_k / N_k+1 ≈ 3–5;
 * - Leopold & Wolman (1960): meander wavelength ≈ 10–14 channel widths;
 * - Seybold, Rothman & Kirchner (2017): confluence angle ≈ 45° arid to 72° humid.
 */
import { channelWidth, type RiverNetwork } from './riverVectors';
import type { SimpleHydrology } from './simpleHydrology';

export interface RiverMetrics {
  hack?: number;
  flint?: number;
  bifurcation?: number;
  /** Highest Strahler order. */
  order: number;
  /** Median meander wavelength, in channel widths. */
  wavelength?: number;
  /** Mean sinuosity of meandering runs. */
  sinuosity?: number;
  /** Median confluence angle, degrees. */
  confluence?: number;
}

/** Least-squares slope of y on x. */
function slope(xs: number[], ys: number[]): number | undefined {
  const n = xs.length;
  if (n < 3) return undefined;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return sxx > 1e-9 ? sxy / sxx : undefined;
}

const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function riverMetrics(h: SimpleHydrology, still: Uint8Array, network: RiverNetwork | undefined, riverArea: number, widthScale: number): RiverMetrics {
  const { n, receiver, accumulation, filled, order } = h, total = n * n, cell = h.width / n, threshold = riverArea * 1e6;
  // Drainage network through lakes too: a lake does not start new first-order streams.
  const river = new Uint8Array(total), channel = new Uint8Array(total);
  for (let c = 0; c < total; c++) {
    river[c] = !h.sea[c] && accumulation[c] >= threshold ? 1 : 0;
    channel[c] = river[c] && !still[c] ? 1 : 0;
  }

  // Flint: median log slope per bin of log area along river cells.
  const bins = new Map<number, number[]>();
  for (let c = 0; c < total; c++) {
    const r = receiver[c];
    if (!channel[c] || r < 0) continue;
    const distance = (c % n !== r % n && Math.floor(c / n) !== Math.floor(r / n) ? Math.SQRT2 : 1) * cell;
    const s = (filled[c] - filled[r]) / distance;
    if (s <= 1e-4) continue;
    const key = Math.round(Math.log10(accumulation[c]) * 4);
    (bins.get(key) ?? bins.set(key, []).get(key)!).push(Math.log10(s));
  }
  const fx: number[] = [], fy: number[] = [];
  for (const [key, values] of bins) if (values.length >= 5) { fx.push(key / 4); fy.push(median(values)!); }
  const flintSlope = slope(fx, fy);

  // Strahler orders, upstream first; a segment starts where no donor has its order.
  const strahler = new Uint8Array(total), top = new Uint8Array(total), count = new Uint8Array(total);
  for (let k = total - 1; k >= 0; k--) {
    const c = order[k];
    if (!river[c]) continue;
    if (!strahler[c]) strahler[c] = 1;
    const r = receiver[c];
    if (r < 0 || !river[r]) continue;
    if (strahler[c] > top[r]) { top[r] = strahler[c]; count[r] = 1; } else if (strahler[c] === top[r]) count[r]++;
    strahler[r] = Math.max(strahler[r], count[r] >= 2 ? top[r] + 1 : top[r]);
  }
  const segments: number[] = [];
  for (let c = 0; c < total; c++) {
    if (!river[c]) continue;
    // A segment of order k starts at a cell none of whose donors carries order k.
    if (top[c] !== strahler[c]) segments[strahler[c]] = (segments[strahler[c]] ?? 0) + 1;
  }
  let maxOrder = 0;
  for (let k = 1; k < segments.length; k++) if (segments[k]) maxOrder = k;
  const ratios: number[] = [];
  for (let k = 1; k < maxOrder; k++) if (segments[k] && segments[k + 1]) ratios.push(Math.log(segments[k] / segments[k + 1]));
  const bifurcation = ratios.length ? Math.exp(ratios.reduce((a, b) => a + b, 0) / ratios.length) : undefined;

  // Hack: length of the main stream above each river cell, up the larger donor
  // to the divide (hillslope included), against its area; median length per area bin.
  const length = new Float32Array(total), mainDonor = new Int32Array(total).fill(-1);
  for (let k = total - 1; k >= 0; k--) {
    const c = order[k], r = receiver[c];
    if (r < 0 || h.sea[c]) continue;
    if (mainDonor[r] < 0 || accumulation[c] > accumulation[mainDonor[r]]) mainDonor[r] = c;
  }
  for (let k = total - 1; k >= 0; k--) {
    const c = order[k], d = mainDonor[c];
    if (d >= 0) length[c] = length[d] + (c % n !== d % n && Math.floor(c / n) !== Math.floor(d / n) ? Math.SQRT2 : 1) * cell;
  }
  const hack = new Map<number, number[]>();
  for (let c = 0; c < total; c++) {
    if (!river[c] || length[c] <= 0) continue;
    const key = Math.round(Math.log10(accumulation[c]) * 4);
    (hack.get(key) ?? hack.set(key, []).get(key)!).push(Math.log10(length[c]));
  }
  const hx: number[] = [], hy: number[] = [];
  for (const [key, values] of hack) if (values.length >= 5) { hx.push(key / 4); hy.push(median(values)!); }
  const metrics: RiverMetrics = { flint: flintSlope === undefined ? undefined : -flintSlope, bifurcation, order: maxOrder, hack: slope(hx, hy) };
  if (!network) return metrics;



  // Meanders: half wavelengths between inflections, and run sinuosity.
  const wavelengths: number[] = [], sinuosities: number[] = [];
  for (const line of network.rivers) {
    const p = line.points, m = line.kind.length;
    for (let i = 0; i < m; i++) {
      if (line.kind[i] !== 1) continue;
      let j = i;
      while (j + 1 < m && line.kind[j + 1] === 1) j++;
      if (j - i >= 8) {
        const width = channelWidth(line.area[(i + j) >> 1], widthScale);
        let arc = 0, last = -1, lastSign = 0;
        const arcAt: number[] = [0];
        for (let k = i + 1; k <= j; k++) { arc += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]); arcAt.push(arc); }
        sinuosities.push(arc / Math.max(1, Math.hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1])));
        // Curvature sign over a smoothing window of three vertices.
        for (let k = i + 3; k <= j - 3; k++) {
          const ax = p[2 * k] - p[2 * k - 6], ay = p[2 * k + 1] - p[2 * k - 5], bx = p[2 * k + 6] - p[2 * k], by = p[2 * k + 7] - p[2 * k + 1];
          const sign = Math.sign(ax * by - ay * bx);
          if (!sign || sign === lastSign) continue;
          if (lastSign && last >= 0) {
            const half = arcAt[k - i] - arcAt[last - i];
            if (half >= width) wavelengths.push(2 * half / width);
          }
          lastSign = sign; last = k;
        }
      }
      i = j;
    }
  }
  metrics.wavelength = median(wavelengths);
  metrics.sinuosity = sinuosities.length ? sinuosities.reduce((a, b) => a + b, 0) / sinuosities.length : undefined;

  // Confluences: direction of the tributary's last stretch against its parent's.
  const byId = new Map(network.rivers.map(line => [line.id, line]));
  const angles: number[] = [];
  for (const line of network.rivers) {
    if (line.joins === undefined || line.joins < 0) continue;
    const parent = byId.get(line.joins);
    if (!parent) continue;
    const p = line.points, m = p.length / 2 - 1, jx = p[2 * m], jy = p[2 * m + 1];
    let k = m, arc = 0;
    while (k > 0 && arc < 3 * cell) { arc += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]); k--; }
    if (arc < cell) continue;
    const tx = jx - p[2 * k], ty = jy - p[2 * k + 1];
    const q = parent.points;
    let best = Infinity, pk = -1;
    for (let i = 0; i + 3 < q.length; i += 2) {
      const d = Math.hypot((q[i] + q[i + 2]) / 2 - jx, (q[i + 1] + q[i + 3]) / 2 - jy);
      if (d < best) { best = d; pk = i; }
    }
    if (pk < 0 || best > 2 * cell) continue;
    const a0 = Math.max(0, pk - 6), a1 = Math.min(q.length - 2, pk + 8);
    const px = q[a1] - q[a0], py = q[a1 + 1] - q[a0 + 1];
    const cos = (tx * px + ty * py) / ((Math.hypot(tx, ty) * Math.hypot(px, py)) || 1);
    angles.push(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI);
  }
  metrics.confluence = median(angles);
  return metrics;
}
