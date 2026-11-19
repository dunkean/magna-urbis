/**
 * What of the town at rest the GPU town draws: the list of elements the Canvas town paints and the GPU town does not
 * (or not identically), for one frame state.
 *
 * Part of the town's look (city/look.ts). The live town layer (live/cityLayer.ts) answers `restExact` from it: an empty
 * list means its frame is the picture of the town at rest and no Canvas repaint is needed; any entry keeps the Canvas
 * repaint for that frame. It is deliberately strict — a missing entry would show a degraded town at rest — and it is
 * the work list of the GPU town: an entry goes when cityGl draws that element from retained data.
 */
import type { CityLod, CityPalette, CityView } from './model/contract';
import { CROSSINGS, type StreetMode } from './streetLook';

/** What the towns hold that some rule below depends on (counted once per scene, not per frame). */
export interface TownContent {
  /** Canal ribbons, canal bridges or locks. */ waterways: boolean;
  /** Street roles present (bridge, stairs, ford, track, mole…). */ streetRoles: ReadonlySet<string>;
  /** Lot enclosures (fences, hedges, walls with their yard ground). */ enclosures: boolean;
  /** Town trees, tree dwellings or walkways. */ canopy: boolean;
  /** Activity sites with drawn ground (mills, quarries…). */ sites: boolean;
  /** Buildings drawn by the native house renderer (house plans). */ housePlans: boolean;
  /** Buildings with mill sails or water wheels. */ millMarks: boolean;
  /** Reserve blocks or parcels (dashed outline on the drawn plans). */ reserves: boolean;
}
export interface RestState {
  palette: CityPalette;
  view: CityView;
  lod: CityLod;
  /** Metres per CSS pixel, device pixel ratio. */ mpp: number;
  dpr: number;
  streets: StreetMode;
  /** Streets layer on. */ streetsShown: boolean;
  /** Translucent ground washes (planFrame.blend). */ blend: boolean;
  /** Textured materials asked for. */ textured: boolean;
  /** Road emphasis (1: opaque ink streets). */ emphasis: number;
  /** Snow on the ground (0: none). */ snow: number;
  /** Plan line width, CSS px. */ lineWidthPx: number;
  /** Buildings shown at this frame (buildingsShown) with their pans (roofPansShown). */ buildings: boolean;
  /** The far raster of a satellite town is in its fade band or beyond. */ farRaster: boolean;
  /** The procedural forest clears the town ground under its canopy (Canvas `beforeBuildings`). */ canopyClearing: boolean;
  /** An urban land use tints the districts (Canvas `beforeBuildings`). */ urbanLanduse: boolean;
  /** Diagnostic layers, selection or refused parcels asked for. */ diagnostics: boolean;
  /** The compositor draws the layer's pass over the group (canals at full strength). */ overPass: boolean;
  content: TownContent;
}

/** Elements of the Canvas town at rest that the GPU town does not draw identically for this state; empty: exact. */
export function townRestGaps(s: RestState): string[] {
  const gaps: string[] = [],
    c = s.content,
    detail = s.lod === 'near' || s.lod === 'close',
    device = s.dpr > 0 ? s.dpr : 1;
  // Outlines are one-device-pixel GL lines weighted by the Canvas stroke width: exact in tone up to one device pixel.
  const widest = s.lod === 'far' ? 1 : Math.max(s.lineWidthPx, s.buildings ? 0.55 : 0);
  if (widest * device > 1.001) gaps.push('outlines wider than a device pixel');
  if (s.blend) gaps.push('wash feather strokes');
  if (s.textured) gaps.push('textured materials');
  if (s.diagnostics) gaps.push('diagnostic layers and selection');
  if (s.view === 'uses' || s.view === 'roles') gaps.push('diagnostic view outlines');
  if (c.reserves && s.lod === 'close' && !s.blend) gaps.push('dashed reserve outlines');
  if (s.streetsShown) {
    if (s.streets === 'natural') gaps.push('ground-textured road paint, wear, grain, cobbles, kerbs and sidewalks');
    if (s.streets === 'natural' && s.snow > 0) gaps.push('street slush');
    if (s.streets === 'soft') gaps.push('street ground apron');
    if (s.streets === 'ink' && s.emphasis < 1) gaps.push('translucent ink streets');
    if (s.streets === 'ink' && s.emphasis > 1) gaps.push('emphasised casings');
    if (detail) gaps.push('street surface junctions and ends');
    if (c.streetRoles.has('bridge')) gaps.push('bridge rails');
    if (s.lod === 'close' && (c.streetRoles.has('stairs') || c.streetRoles.has('port-stairs'))) gaps.push('stair treads');
    // Far and mid: the Canvas town strokes a street at its mean width, rounded to a quarter metre; cityGl at each vertex's width.
    if (!detail && [...c.streetRoles].some(role => !CROSSINGS.has(role))) gaps.push('street widths along the way');
  }
  if (c.waterways && !s.overPass) gaps.push('canals at full strength over the town');
  if (c.enclosures && s.lod !== 'far') gaps.push('yard ground wash, enclosure dashes');
  if (c.canopy && s.buildings) gaps.push(s.palette === 'terrain' ? 'canopy sprites, walkways' : 'canopy outline order, walkways');
  if (c.sites) gaps.push('activity-site ground');
  if (c.housePlans && s.buildings) gaps.push('house plans');
  if (c.millMarks && s.buildings && s.palette === 'terrain') gaps.push('mill sails and wheels');
  // The grain marks are drawn (gl/shaders.ts FILL_VS uGrainMarks); the snow mantle is its mean tone only.
  if (s.buildings && s.palette === 'terrain' && s.snow > 0) gaps.push('uneven snow marks');
  if (s.farRaster) gaps.push('far raster filtering');
  if (s.canopyClearing) gaps.push('town ground cleared under the forest canopy');
  if (s.urbanLanduse) gaps.push('urban land-use tint');
  return gaps;
}
