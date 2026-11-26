/** Fixed-definition, unpigmented contour coverage. Paths remain canonical for vector exports. */
import { CONTOUR_THIN_OPACITY, opaqueContourPlates, type ContourTint } from './gpu/contract';
import { parseColor, RecordingContext } from './gpu/recorder';
import type { Palette } from './styles';
import { countWork } from './workCount';

export const CONTOUR_RASTER_MAX_SIDE = 8192;
export const contourRasterSide = (worldSize: number): number => Math.min(CONTOUR_RASTER_MAX_SIDE, Math.max(1024, Math.ceil(worldSize * 2)));

export interface ContourRaster {
  canvas: HTMLCanvasElement;
  worldSize: number;
  metresPerTexel: number;
  /** The SVG overlay encodes the same coverage pixels once. */
  url?: string;
}
type Paths = { thin: string; index: string };
const plates = new WeakMap<object, { paths: Paths; thin: number; index: number; plate: ContourRaster }>();

/** Effective widths are in plate texels. Changing pigment or opacity never changes this key. */
export function contourRaster(terrain: { width: number }, paths: Paths, palette: Pick<Palette, 'contourThinW' | 'contourIndexW'>, topographic: boolean): ContourRaster {
  const worldSize = terrain.width,
    thin = (topographic ? 0.6 : 0.85) * (palette.contourThinW ?? 1),
    index = ((topographic ? 1 : 1.4) * palette.contourIndexW) / 1.6,
    known = plates.get(terrain);
  if (known?.paths === paths && known.plate.worldSize === worldSize && known.thin === thin && known.index === index) return known.plate;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = contourRasterSide(worldSize);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Cannot create contour plate');
  const density = canvas.width / worldSize;
  // The opaque canvas starts black. Additive strokes encode the two white masks independently, including overlap.
  ctx.globalCompositeOperation = 'lighter';
  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = thin / density;
  if (paths.thin) ctx.stroke(new Path2D(paths.thin));
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = index / density;
  if (paths.index) ctx.stroke(new Path2D(paths.index));
  opaqueContourPlates.add(canvas);
  const plate = { canvas, worldSize, metresPerTexel: 1 / density };
  plates.set(terrain, { plate, paths, thin, index });
  countWork('contour.bake');
  return plate;
}

export function contourRasterUrl(plate: ContourRaster): string {
  return (plate.url ??= plate.canvas.toDataURL('image/png'));
}

export function contourTint(palette: Pick<Palette, 'contour' | 'contourOpacity'>, opacity: number): ContourTint {
  const [r, g, b, a] = parseColor(palette.contour) ?? [0, 0, 0, 1];
  return { rgba: [r, g, b, a * palette.contourOpacity * opacity] };
}

export function createContourTintFilter(id: string): SVGFilterElement {
  const ns = 'http://www.w3.org/2000/svg',
    filter = document.createElementNS(ns, 'filter');
  filter.id = id;
  filter.setAttribute('x', '0%');
  filter.setAttribute('y', '0%');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  for (const result of ['thin', 'index']) {
    const matrix = document.createElementNS(ns, 'feColorMatrix');
    matrix.setAttribute('in', 'SourceGraphic');
    matrix.setAttribute('result', result);
    filter.append(matrix);
  }
  const over = document.createElementNS(ns, 'feComposite');
  over.setAttribute('in', 'index');
  over.setAttribute('in2', 'thin');
  over.setAttribute('operator', 'over');
  filter.append(over);
  return filter;
}

export function setContourTintFilter(filter: SVGFilterElement, tint: ContourTint): void {
  const [r, g, b, a] = tint.rgba,
    rgb = `0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b}`;
  filter.children[0].setAttribute('values', `${rgb} ${a * CONTOUR_THIN_OPACITY} 0 0 0 0`);
  filter.children[1].setAttribute('values', `${rgb} 0 ${a} 0 0 0`);
}

/** Draw only the part used by the output. Recorded exact tiles and drape bands use the same shader as the live map. */
export function paintContourRaster(ctx: CanvasRenderingContext2D, plate: ContourRaster, tint: ContourTint, x: number, y: number, w: number, h: number): void {
  const density = 1 / plate.metresPerTexel,
    rect = [x * density, y * density, w * density, h * density, x, y, w, h] as const;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  if (ctx instanceof RecordingContext) ctx.drawContourImage(plate.canvas, tint, ...rect);
  else paintContourPixels(ctx, plate.canvas, tint, rect);
  ctx.restore();
}

const CANVAS_TINT_FILTER_ID = 'mapContourCoverageTint';
const CANVAS_TINT_FILTER_URL = `url(#${CANVAS_TINT_FILTER_ID})`;
let canvasTintFilter: SVGFilterElement | null | undefined;
let tintedRgba: ContourTint['rgba'] | undefined;

/** The cartography's software tiles are usually OffscreenCanvas. Test the filter on an HTML scratch canvas once. */
function canvasFilter(scratch: CanvasRenderingContext2D): SVGFilterElement | null {
  if (canvasTintFilter !== undefined) return canvasTintFilter;
  canvasTintFilter = null;
  if (!('filter' in scratch)) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    filter = createContourTintFilter(CANVAS_TINT_FILTER_ID);
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.append(filter);
  document.body.append(svg);
  setContourTintFilter(filter, { rgba: [0, 0, 1, 0.5] });
  scratch.filter = CANVAS_TINT_FILTER_URL;
  scratch.fillStyle = '#00ff00';
  scratch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = scratch.getImageData(0, 0, 1, 1).data;
  scratch.filter = 'none';
  if (r === 0 && g === 0 && b === 255 && Math.abs(a - 128) <= 1) canvasTintFilter = filter;
  else svg.remove();
  return canvasTintFilter;
}

const TINT_TILE = 1024;
let canvasScratch: CanvasRenderingContext2D | null | undefined;

function paintContourPixels(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, tint: ContourTint, [sx, sy, sw, sh, x, y, w, h]: readonly number[]): void {
  const m = ctx.getTransform();
  // Cartography's Canvas transform maps world metres to device pixels via translation and positive scale.
  const x0 = m.a * x + m.e,
    y0 = m.d * y + m.f,
    dw = m.a * w,
    dh = m.d * h,
    left = Math.max(0, Math.floor(x0)),
    top = Math.max(0, Math.floor(y0)),
    right = Math.min(ctx.canvas.width, Math.ceil(x0 + dw)),
    bottom = Math.min(ctx.canvas.height, Math.ceil(y0 + dh));
  if (left >= right || top >= bottom) return;
  if (canvasScratch === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TINT_TILE;
    canvasScratch = canvas.getContext('2d', { willReadFrequently: true });
  }
  const scratch = canvasScratch;
  if (!scratch) throw new Error('Cannot create contour tint surface');
  const filter = canvasFilter(scratch);
  if (filter && tintedRgba !== tint.rgba) {
    setContourTintFilter(filter, tint);
    tintedRgba = tint.rgba;
  }
  if (filter && ctx.canvas instanceof HTMLCanvasElement) {
    ctx.filter = CANVAS_TINT_FILTER_URL;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
    return;
  }
  const [r, g, b, a] = tint.rgba;
  const dxTexel = sw / dw,
    dyTexel = sh / dh;
  scratch.filter = filter ? CANVAS_TINT_FILTER_URL : 'none';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let py = top; py < bottom; py += TINT_TILE) {
    for (let px = left; px < right; px += TINT_TILE) {
      const width = Math.min(TINT_TILE, right - px),
        height = Math.min(TINT_TILE, bottom - py),
        // Keep sampling across interior tile edges without filtering the whole image at the output scale.
        fromX = Math.max(x0, px - 1),
        fromY = Math.max(y0, py - 1),
        cropW = Math.min(x0 + dw, px + width + 1) - fromX,
        cropH = Math.min(y0 + dh, py + height + 1) - fromY;
      scratch.clearRect(0, 0, width, height);
      scratch.drawImage(image, sx + (fromX - x0) * dxTexel, sy + (fromY - y0) * dyTexel, cropW * dxTexel, cropH * dyTexel, fromX - px, fromY - py, cropW, cropH);
      if (!filter) {
        const pixels = scratch.getImageData(0, 0, width, height),
          data = pixels.data;
        for (let i = 0; i < data.length; i += 4) {
          const index = data[i + 1] * a;
          data[i + 3] = index + data[i] * a * CONTOUR_THIN_OPACITY * (1 - index / 255);
          data[i] = r * 255;
          data[i + 1] = g * 255;
          data[i + 2] = b * 255;
        }
        scratch.putImageData(pixels, 0, 0);
      }
      ctx.drawImage(scratch.canvas, 0, 0, width, height, px, py, width, height);
    }
  }
}
