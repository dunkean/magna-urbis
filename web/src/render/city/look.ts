/**
 * The look of a town in the 2D map: the one description of what every town element looks like.
 *
 * Why it exists: the town has two renderers — the Canvas 2D one (render/cityCanvas.ts: captures, exports, sheets, the
 * fallback display, the looks the GPU does not cover) and the WebGL2 one (render/cityGl.ts with render/cityGlStyle.ts,
 * drawn by the live compositor's town layer, render/live/cityLayer.ts). Each used to carry its own colours, widths and
 * thresholds, and every difference between them showed as a jump when the view came to rest. Every rule now lives
 * here, taken from the Canvas town (the reference picture), and both renderers call it:
 *
 *   levels.ts        levels of detail: limits, hysteresis
 *   planLook.ts      palettes; footprint, blocks, parcels (fills, washes, outlines, hatching), quays, town walls
 *   streetLook.ts    streets: shown ranks, widths, casings, beds, sidewalks, wear, slush, ends, rails
 *   buildingLook.ts  buildings: bodies, roof pans (light, weathering, grain, rims, snow), cast shadows
 *   farTown.ts       satellite far raster: fade band
 *   restCoverage.ts  what of the town at rest the GPU town draws, per look and level (LiveLayer.restExact)
 *
 * A renderer holds no colour, width, opacity or threshold of its own: it asks for the paint of an element and draws
 * it with its own means. `web/tests/cityLook.test.ts` compares what the two renderers draw from the same rules.
 */
export * from './levels';
export * from './planLook';
export * from './streetLook';
export * from './buildingLook';
export * from './farTown';
export * from './restCoverage';

/** Group opacity of the town over the map when the appearance gives none. */
export const TOWN_OPACITY = 0.8;
/** Group opacity of the town for an appearance value. */
export const townOpacity = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : TOWN_OPACITY);
