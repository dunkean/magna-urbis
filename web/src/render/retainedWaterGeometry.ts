/** Exact retained water banks in the rebased map frame, including nested crops. */
export interface RetainedWaterPath { path: Path2D; rule: CanvasFillRule }
const cache = new Map<string, readonly RetainedWaterPath[]>();

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
      if (node.tagName === 'path') path.addPath(new Path2D(node.getAttribute('d') ?? ''));
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
