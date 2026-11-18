/**
 * World-coordinate SVG bodies as rasterizable documents.
 *
 * The ground, the water and the 3D background keep their vector products as SVG bodies in map metres; a region of the
 * map (render/viewRaster.ts) at a density turns one into a document for `rasterizeSvg`.
 */
import type { World } from '../../gen/types';
import type { ViewRasterRegion } from '../../render/viewRaster';

/** A world-coordinate SVG body as a document rasterizing `region` at its density. */
export const svgOf = (body: string, region: ViewRasterRegion): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round(region.width * region.density))}" height="${Math.max(1, Math.round(region.height * region.density))}" viewBox="${region.x} ${region.y} ${region.width} ${region.height}" preserveAspectRatio="none">${body}</svg>`;
/** svgOf as Blob parts around a body encoded once: a view raster never re-encodes megabytes of water paths. */
export const svgPartsOf = (body: Uint8Array, region: ViewRasterRegion): BlobPart[] => {
  const [head, tail] = svgOf('', region).split('');
  return [head, body as BlobPart, tail];
};
/** The whole map at 2048 pixels. */
export const wholeMap = (width: number): ViewRasterRegion => ({ x: 0, y: 0, width, height: width, density: 2048 / width });
