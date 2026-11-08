/** Exact retained water banks in the rebased map frame, including nested crops. */
export interface RetainedWaterPath { path: Path2D; rule: CanvasFillRule }
const cache = new Map<string, readonly RetainedWaterPath[]>();

/** Retained banks follow the terrain grid: a stream traced through 30 m cells turns in 45° steps and a ribbon jumps
 * where its width changes, which reads as a crenellated course at city zoom. Display only: each closed ring is
 * resampled every 3 m and low-passed along its length (three 27 m box passes, about 13 m sigma), so steps become bends
 * of a few tens of metres. Vertices on the map border stay put (a course still leaves the map square) and small rings
 * get a shorter window. Only plain absolute M/L/Z paths are rounded. */
const BANK_STEP = 3, BANK_HALF_WINDOW = 4, BANK_PASSES = 3;
function roundedPathData(d: string, width: number): string | undefined {
  if (!/^[MLZ\d\s.,eE+-]*$/.test(d)) return undefined;
  const tokens = d.match(/[MLZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const rings: { pts: [number, number][]; closed: boolean }[] = [];
  let ring: { pts: [number, number][]; closed: boolean } | undefined, command = '';
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i];
    if (t === 'M' || t === 'L' || t === 'Z') { command = t; i++; if (t === 'Z' && ring) { ring.closed = true; ring = undefined; } continue; }
    const x = Number(t), y = Number(tokens[i + 1]); i += 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    if (command === 'M' || !ring) { ring = { pts: [], closed: false }; rings.push(ring); command = 'L'; }
    ring.pts.push([x, y]);
  }
  const border = (x: number, y: number): boolean => x <= .01 || y <= .01 || x >= width - .01 || y >= width - .01;
  let out = '';
  for (const r of rings) {
    let pts = r.pts;
    if (r.closed && pts.length > 1 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1]) pts = pts.slice(0, -1);
    if (r.closed && pts.length >= 3) {
      // Uniform resampling; original vertices on the border are kept exactly.
      const xs: number[] = [], ys: number[] = [], pinned: boolean[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], length = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.round(length / BANK_STEP));
        const edge = border(ax, ay) && border(bx, by) && (Math.abs(ax - bx) < .02 || Math.abs(ay - by) < .02);
        for (let k = 0; k < steps; k++) { xs.push(ax + (bx - ax) * k / steps); ys.push(ay + (by - ay) * k / steps); pinned.push(edge || (k === 0 && border(ax, ay))); }
      }
      const n = xs.length, half = Math.min(BANK_HALF_WINDOW, Math.floor(n / 16));
      if (half > 0) for (let pass = 0; pass < BANK_PASSES; pass++) {
        const sx = xs.slice(), sy = ys.slice();
        for (let i = 0; i < n; i++) {
          if (pinned[i]) continue;
          let x = 0, y = 0;
          for (let k = -half; k <= half; k++) { const j = (i + k + n) % n; x += sx[j]; y += sy[j]; }
          xs[i] = x / (2 * half + 1); ys[i] = y / (2 * half + 1);
        }
      }
      pts = xs.map((x, i) => [x, ys[i]]);
    }
    out += pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('') + (r.closed ? 'Z' : '');
  }
  return out;
}

export function retainedWaterPaths(svg: string, width: number): readonly RetainedWaterPath[] {
  const key = `${width}:${svg}`, found = cache.get(key);
  if (found) return found;
  const paths: RetainedWaterPath[] = [];
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('width', String(width)); host.setAttribute('height', String(width));
  host.setAttribute('viewBox', `0 0 ${width} ${width}`);
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  host.innerHTML = svg; document.body.append(host);
  try {
    const toHost = host.getScreenCTM()?.inverse();
    for (const node of Array.from(host.querySelectorAll<SVGGraphicsElement>('path,circle,polygon,rect'))) {
      if (node.closest('defs,clipPath,mask') || node.getAttribute('fill') === 'none') continue;
      const path = new Path2D();
      if (node.tagName === 'path') { const d = node.getAttribute('d') ?? ''; path.addPath(new Path2D(roundedPathData(d, width) ?? d)); }
      else if (node.tagName === 'circle') path.arc(Number(node.getAttribute('cx')), Number(node.getAttribute('cy')), Number(node.getAttribute('r')), 0, Math.PI * 2);
      else if (node.tagName === 'rect') path.rect(Number(node.getAttribute('x')), Number(node.getAttribute('y')), Number(node.getAttribute('width')), Number(node.getAttribute('height')));
      else {
        const points = (node.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < points.length; i += 2) { if (i) path.lineTo(points[i], points[i + 1]); else path.moveTo(points[i], points[i + 1]); }
        path.closePath();
      }
      // getCTM stops at the nearest nested SVG viewport. Relative screen
      // matrices include every retained crop's viewBox and cancel CSS placement.
      const transformed = new Path2D(), screen = node.getScreenCTM();
      const matrix = screen && toHost ? toHost.multiply(screen) : node.getCTM();
      transformed.addPath(path, matrix ?? undefined);
      paths.push({ path: transformed, rule: node.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero' });
    }
  } finally { host.remove(); }
  cache.set(key, paths);
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  return paths;
}

/** Context dimensions are pixels, region dimensions are world metres. No readback. */
export function paintRetainedWater(context: CanvasRenderingContext2D, paths: readonly RetainedWaterPath[], region: { x: number; y: number; width: number; height: number }, pixels: { width: number; height: number }, color: string): void {
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, pixels.width, pixels.height);
  context.setTransform(pixels.width / region.width, 0, 0, pixels.height / region.height, -region.x * pixels.width / region.width, -region.y * pixels.height / region.height);
  context.fillStyle = color;
  for (const item of paths) context.fill(item.path, item.rule);
}
