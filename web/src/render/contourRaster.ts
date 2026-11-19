/** A single transparent, fixed-definition contour plate. Navigation only samples this image: it never traces or
 * strokes contours again. Paths remain the canonical data for vector exports. */
import { countWork } from './workCount';

export const CONTOUR_RASTER_MAX_SIDE = 8192;
export const contourRasterSide = (worldSize: number): number => Math.min(CONTOUR_RASTER_MAX_SIDE, Math.max(1024, Math.ceil(worldSize * 2)));

export interface ContourRasterLook {
  color: string;
  opacity: number;
  thinWeight: number;
  indexWeight: number;
  topographic: boolean;
}
export interface ContourRaster {
  canvas: HTMLCanvasElement;
  worldSize: number;
  /** Fixed definition, including the explicit close-zoom limit on large maps. */
  metresPerTexel: number;
  /** Only the bench's SVG overlay needs an encoded image; Canvas and WebGL share the original pixels. */
  url?: string;
}
type Paths = { thin: string; index: string };
const plates = new WeakMap<Paths, Map<string, ContourRaster>>();

/** Key: canonical path-set identity + extent + pigment, opacity and weights. No scale, DPR, viewport or quality tier. */
export function contourRaster(paths: Paths, worldSize: number, look: ContourRasterLook): ContourRaster {
  let styles = plates.get(paths);
  if (!styles) plates.set(paths, (styles = new Map()));
  const key = JSON.stringify([worldSize, look.color, look.opacity, look.thinWeight, look.indexWeight, look.topographic]);
  const known = styles.get(key);
  if (known) return known;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = contourRasterSide(worldSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create contour plate');
  const density = canvas.width / worldSize;
  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.strokeStyle = look.color;
  ctx.lineCap = ctx.lineJoin = 'round';
  // Weights are in plate texels, fixed at the initial bake. Indexed metres are only slightly stronger.
  ctx.lineWidth = ((look.topographic ? 0.6 : 0.85) * look.thinWeight) / density;
  ctx.globalAlpha = look.opacity * 0.7;
  if (paths.thin) ctx.stroke(new Path2D(paths.thin));
  ctx.lineWidth = ((look.topographic ? 1 : 1.4) * look.indexWeight) / density;
  ctx.globalAlpha = look.opacity;
  if (paths.index) ctx.stroke(new Path2D(paths.index));
  const plate = { canvas, worldSize, metresPerTexel: 1 / density };
  // Palette edits must not retain an unlimited number of 8192-square images for one path set.
  if (styles.size >= 2) styles.delete(styles.keys().next().value!);
  styles.set(key, plate);
  countWork('contour.bake');
  return plate;
}

export function contourRasterUrl(plate: ContourRaster): string {
  return (plate.url ??= plate.canvas.toDataURL('image/png'));
}
