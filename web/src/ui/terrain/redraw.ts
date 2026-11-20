/**
 * Description of one ground redraw, shared by both backends (TerrainGl, TerrainGpu): the view-to-uniform geometry,
 * the palettes of a look, which passes run (water layer, rivers, retained water, painted-water composite, auxiliary
 * crowns/water pass, map), the detail fade, and the views of the world tiles and captures.
 *
 * Passes of a redraw, in order:
 * 1. water layer (separateWater): the base relief with uGroundCapture = 1 (premultiplied water only), then the rivers
 *    and the retained water composited over it; the map pass reads it on its water-layer texture;
 * 2. auxiliary pass (hasAuxPass): near crowns and Render v2 water into an RGBA32UI target, cached by AuxPassKey;
 * 3. map pass: the base layer, then the detail layers cross-faded over it;
 * 4. without a water layer: the rivers and the retained water over the map;
 * 5. WebGPU only: present (the map target holds GL rows, flipped onto the canvas).
 */
import { lightTerrainLook } from './variant';
import { styleTraits, terrainStyle } from '../../render/terrainStyle';
import { biomePalette } from '../../render/biomes';
import type { Rect4, View } from '../../render/view';
import type { WaterSurface } from '../../render/terrainWater';
import type { HeightLayer, TerrainLook } from './contract';

/** The view a redraw draws: camera and size in CSS pixels. */
export interface ViewState {
  view: View;
  width: number;
  height: number;
}

/** Style pixel ratio of the live 2D map (CSS-pixel strokes, river widths, banks): the live redraw's default.
 * World tiles key the material's detail on their own density and only take this ratio for those screen-sized strokes,
 * so a tile shown at its own tier matches the live view of the same device density. */
export const liveStyleRatio = (): number => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
/** Framebuffer pixel ratio of a redraw: two device pixels per CSS pixel at most, 4K stays cheap on modest GPUs. */
export const displayPixelRatio = (): number => Math.min(2, window.devicePixelRatio || 1);

/** Cross-fade of a new detail or refinement layer, ms. */
export const DETAIL_FADE_MS = 240;
export const fadeProgress = (now: number, fadeStart: number): number => Math.min(1, (now - fadeStart) / DETAIL_FADE_MS);

/** Device-pixel geometry of a redraw: framebuffer size, metres per device pixel, world position of the top-left corner. */
export interface RedrawFrame {
  width: number;
  height: number;
  px: number;
  origin: [number, number];
}
export function redrawFrame(state: ViewState, dpr: number): RedrawFrame {
  const { view } = state;
  return { width: Math.max(1, Math.round(state.width * dpr)), height: Math.max(1, Math.round(state.height * dpr)), px: 1 / (view.scale * dpr), origin: [view.cx - state.width / (2 * view.scale), view.cy - state.height / (2 * view.scale)] };
}
/** Device-pixel rectangle of a detail layer, inset by two cells: the clamped B-spline edge never shows. */
export function detailQuad(l: HeightLayer, frame: RedrawFrame, out: number[]): number[] {
  const inset = (2 * l.width) / l.n,
    { origin, px } = frame;
  out[0] = (l.x + inset - origin[0]) / px;
  out[1] = (l.y + inset - origin[1]) / px;
  out[2] = (l.x + l.width - inset - origin[0]) / px;
  out[3] = (l.y + l.width - inset - origin[1]) / px;
  return out;
}

/** Ground palette and water style of a look. Underdark map grounds take the underdark hypsometry (render/biomes.ts),
 * as the 2D overlay does; the natural water look takes the render3d water. */
export function lookPalettes(look: TerrainLook) {
  const definition = terrainStyle(look.style, look.colors),
    pal = look.underdark && definition.traits.family === 'map' ? biomePalette(definition.palette, 'underdark') : definition.palette,
    water = terrainStyle(look.waterLook === 'natural' ? 'render3d' : (look.waterStyle ?? look.style), look.waterLook === 'natural' ? undefined : look.colors).water;
  return { definition, pal, water };
}
export type LookPalettes = ReturnType<typeof lookPalettes>;

/** The look paints its water (depth, shelf, glint, wet banks: renderWaterShader.ts); other looks keep the flat ink. */
export const paintedWaterLook = (look: TerrainLook): boolean => !lightTerrainLook(look) && (look.waterLook === 'natural' || styleTraits(look.style).neuralEarth);
/** The painted-water program is part of the look (lookLinked / variantReady): a painted look with water to paint. */
export const needsPaintedWater = (look: TerrainLook, riverCount: number, retainedPaths: number): boolean => paintedWaterLook(look) && (riverCount > 0 || retainedPaths > 0);
/** Rivers and retained water are drawn: the water layer is shown, or the style always draws water. */
export const waterDrawn = (look: TerrainLook): boolean => look.layers.water !== false || styleTraits(look.style).waterAlwaysDrawn;
/** Water first rendered into its own layer, read by the map pass (natural water, 3D grounds with relief and
 * hypsometry, forest looks); never for the premultiplied water-only capture. */
export const separateWaterLayer = (look: TerrainLook, forest: boolean): boolean => (look.waterLook === 'natural' || (styleTraits(look.style).ground3d && look.layers.relief && look.layers.hypsometry) || forest) && waterDrawn(look) && !look.groundCapture;
/** Depth band of the sea and painted water, metres. */
export const waterBand = (look: TerrainLook, sea: WaterSurface | undefined, water: { bandFraction: number }): number => (sea?.referenceWidth ?? look.mapWidth) * water.bandFraction;

/** Layers at their final opacity: world tiles and captures are reproducible. */
export const settled = <T extends { fadeStart: number }>(layer: T): T => ({ ...layer, fadeStart: -Infinity });
/** The latest detail layer only, settled. */
export const settledDetails = <T extends { fadeStart: number }>(details: T[]): T[] => (details.length ? [settled(details[details.length - 1])] : []);

/** CSS view of the live redraw at the device density of a world tile: px = 1 / (scale * ratio) = size / px metres per
 * pixel, origin = box corner, width = round(px / ratio * ratio) = px device pixels. */
export function tileViewState(box: Rect4, px: number, ratio: number): ViewState {
  const size = box.maxX - box.minX;
  return { view: { cx: box.minX + size / 2, cy: box.minY + size / 2, scale: px / size / ratio }, width: px / ratio, height: px / ratio };
}
/** View of a world-space capture of `size`² pixels. */
export const captureViewState = (region: { x: number; y: number; width: number }, size: number): ViewState => ({ view: { cx: region.x + region.width / 2, cy: region.y + region.width / 2, scale: size / region.width }, width: size, height: size });
/** Look of a world-space capture: 3D ground constants, no frame; the ground overlay is the water-only pass. */
export const captureLook = (look: TerrainLook, groundOverlay: boolean): TerrainLook => ({ ...look, displayLight: false, frame: false, contours: groundOverlay ? false : look.contours, mesh3d: true, groundCapture: groundOverlay });

/** A value as JSON reads it back: undefined and non-finite numbers are null. */
const jsonScalar = (v: unknown): unknown => (v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? null : v);
/** Equality of `live` with `stored` (a JSON round trip of an earlier value), as comparing their JSON did, without
 * building strings. Key order is ignored: equal values give the same pass. */
function sameJson(live: unknown, stored: unknown): boolean {
  const a = jsonScalar(live),
    b = stored;
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], b[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  let count = 0;
  for (const key in x) {
    const value = x[key];
    if (value === undefined || typeof value === 'function') continue;
    count++;
    if (!(key in y) || !sameJson(value, y[key])) return false;
  }
  for (const _ in y) count--;
  return count === 0;
}

/** Inputs of the auxiliary pass the last time it was rendered into a target: the pass is skipped while they are
 * the same, compared by value against a JSON snapshot taken when the pass ran (inputs mutated in place since then
 * still count as changed). One per set of view targets. */
export class AuxPassKey {
  private stored?: unknown[];
  private readonly current: unknown[] = [];
  /** A reused array the caller fills with the current inputs. */
  scratch(): unknown[] {
    return this.current;
  }
  /** The inputs in scratch() differ from the ones the target was rendered for. */
  changed(): boolean {
    return !this.stored || !sameJson(this.current, this.stored);
  }
  /** The target now holds the pass for the inputs in scratch(). */
  store(): void {
    this.stored = JSON.parse(JSON.stringify(this.current)) as unknown[];
  }
  invalidate(): void {
    this.stored = undefined;
  }
}
