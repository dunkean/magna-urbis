/**
 * The look of a town in the 2D map: what a town element looks like, stated once for the town's renderers.
 *
 * Who reads it: the exact Canvas 2D town (canvas/town.ts, canvas/roofs.ts: captures, exports, sheets, the fallback
 * display, every frame at rest the GPU town does not cover) and the GPU town (gl/styleTables.ts, gl/frame.ts: the live
 * compositor's town layer, and the plan renderer of City Bench and of the V2's exact output for the drawn plans).
 * Why: a rule held twice drifts, and every drift shows as a jump when the view comes to rest.
 *
 *   levels.ts        levels of detail: limits, hysteresis
 *   planLook.ts      palettes; footprint, blocks, parcels (fills, washes, outlines, hatching), quays, town walls,
 *                    lot-enclosure fade, canals
 *   streetLook.ts    streets: shown ranks, widths, casings, beds, sidewalks, wear, slush, ends, rails
 *   buildingLook.ts  buildings: bodies, roof pans (light, weathering, grain, rims, snow), cast shadows, mill marks
 *   canopyLook.ts    the canopy as discs (GPU town)
 *   farTown.ts       satellite far raster: fade band
 *   planPath.ts      where the GPU plan renderer on its own canvas reads these rules differently, and why
 *   restCoverage.ts  what of the town at rest the GPU town draws, per look and level (LiveLayer.restExact)
 *
 * What is not here, and is still stated by the module that draws it: the detailed fortifications (cityWalls.ts, with
 * its own Canvas and GL drawing), the lot enclosures' inks and widths (yardStyle.ts, read by both renderers; their
 * fade across the mid level is restated in cityLotEnclosures.ts for the Canvas town), the Canvas canopy
 * (cityGrove.ts), the far raster's tones (cityFarRaster.ts, one raster for both), night and cave ambience
 * (cityNight.ts, Canvas only), harbour furniture (harbourStyle.ts, read by both), activity-site ground
 * (v2/activitySites.ts, Canvas only), the diagnostic overlays, names and glyphs of canvas/town.ts, and the shaders'
 * render-background art of the plan path (gl/shaders.ts: setts, footways, bridge decks).
 * `web/tests/cityLook.test.ts` compares what the renderers draw from the same rules.
 */
export * from './levels';
export * from './planLook';
export * from './streetLook';
export * from './buildingLook';
export * from './farTown';
export * from './restCoverage';
export * from './planPath';
export * from './canopyLook';

/** Group opacity of the town over the map when the appearance gives none. */
const TOWN_OPACITY = 0.8;
/** Group opacity of the town for an appearance value. */
export const townOpacity = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : TOWN_OPACITY);
