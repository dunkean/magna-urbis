/**
 * Retained water of the 2D ground (City Bench style exports): exact SVG banks, including accumulated crop transforms.
 * The vector paths are parsed once per input (RetainedWaterSource); each set of view targets rasterizes only its
 * visible viewport on a Canvas 2D (RetainedWaterRaster), without readback, then the backend uploads that canvas.
 */
import { retainedWaterPaths, type RetainedWaterPath } from '../../render/retainedWaterGeometry';
import { waterClimate } from '../../render/waterRegime';
import { paintRetainedWaterView, retainedRegime, type RetainedRegime } from '../retainedWaterRegime';
import type { TerrainStyle } from '../../render/terrainStyle';
import type { RetainedWaterOptions } from './types';

/** The retained water input: its paths, seasonal regime and city-zoom river colour. */
export class RetainedWaterSource {
  /** The input as given, replayed after a device loss. */
  input?: { svg: string; width: number; options?: RetainedWaterOptions };
  paths: readonly RetainedWaterPath[] = [];
  regime?: RetainedRegime;
  /** uCityWater: x 1 grades a retained river's depth from the bank, y its sediment tint. */
  city: [number, number] = [0, 0];
  /** Identity of the input; part of the auxiliary pass key. */
  key = '';
  /** Replaces the input; false when it is the same. */
  set(svg: string | undefined, width: number, options?: RetainedWaterOptions): boolean {
    this.input = svg ? { svg, width, options } : undefined;
    const key = svg ? `${width}:${JSON.stringify(options ?? {})}:${svg}` : '';
    if (key === this.key) return false;
    this.key = key;
    this.paths = svg ? retainedWaterPaths(svg, width) : [];
    this.regime = retainedRegime(this.paths, width, options?.season);
    this.city = svg && options?.city ? [1, 0.5 * waterClimate(options.season ?? {}).sediment] : [0, 0];
    return true;
  }
  /** Forgets the input (device rebuilt: the next set() always applies). */
  clear(): void {
    this.key = '';
  }
}

/** The viewport raster of the retained water for one set of view targets, and the view it was painted for. */
export class RetainedWaterRaster {
  canvas?: HTMLCanvasElement;
  /** Encoded regime of the painted raster (uRegime of the painted-water composite). */
  coded = 0;
  private x = NaN;
  private y = NaN;
  private px = NaN;
  private width = 0;
  private height = 0;
  private stop = '';
  private painted = false;
  private style = '';
  /** Paints the viewport when it differs from the painted one (or `force`); true when the canvas changed. */
  paint(source: RetainedWaterSource, origin: [number, number], px: number, width: number, height: number, stop: string, painted: boolean, style: TerrainStyle, force = false): boolean {
    if (!force && origin[0] === this.x && origin[1] === this.y && px === this.px && width === this.width && height === this.height && stop === this.stop && painted === this.painted && style === this.style) return false;
    const canvas = (this.canvas ??= document.createElement('canvas'));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    this.coded = Number(paintRetainedWaterView(canvas.getContext('2d')!, source.paths, { x: origin[0], y: origin[1], width: width * px, height: height * px }, { width, height }, stop, source.regime, painted, style)) * (source.city[0] ? 2 : 1);
    this.x = origin[0];
    this.y = origin[1];
    this.px = px;
    this.width = width;
    this.height = height;
    this.stop = stop;
    this.painted = painted;
    this.style = style;
    return true;
  }
  /** The next paint() repaints. */
  invalidate(): void {
    this.x = NaN;
  }
}
