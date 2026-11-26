/**
 * The parameter block of the ground's map program, written once for both backends: every uniform of a look, by name
 * and value, in the WebGL2 call order. TerrainGl writes them as glUniform* calls on the current program (unknown
 * names resolve to a null location and are ignored); TerrainGpu writes them into its storage block image (Params,
 * gpu/params.ts), where names absent from the layout (the variant constants uMode, uRenderV2, uForest, the GL
 * sampler units) are ignored the same way. Textures go through `texture` (GL: active unit and binding; WebGPU: the
 * view bound under that name) and `sampler` (GL sampler unit; nothing on WebGPU).
 * Light cartographic grounds use palette/hillshade only. Satellite fast keeps the full material, vegetation and
 * refinement parameters; its performance tier simplifies the buildings.
 */
import { mapLandSeason, waterSeasonUniforms } from '../../render/seasonPalette';
import { renderV2GlacierSources } from '../../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform, type SeasonCalendar } from '../../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../../rust/bridge/terrainClimate';
import { FRACTAL_ROTATIONS } from '../../../../rust/bridge/terrainAdjust';
import { styleTraits } from '../../render/terrainStyle';
import { terrainLights } from '../../render/terrainLighting';
import { waterBed } from '../../render/waterPalette';
import { waterUniforms } from '../../render/waterStyle';
import { groundCoverActive } from '../../render/materialLook';
import { CANVAS_MAP_STROKES, mapStrokeWidth } from '../../render/strokes';
import type { CrownDetail } from '../../render/crownClumpAtlas';
import type { WaterSurface } from '../../render/terrainWater';
import { isNeuralRefinement } from '../terrainRefinement';
import { treeSymbolSeason, treeSymbolSpecies, treeSymbolWash } from '../../render/treeSymbols';
import type { Palette } from '../../render/styles';
import { terrainDrawQuality, treeSymbolsOn } from './variant';
import { fadeProgress, lookFreshWater, waterBand, type LookPalettes, type RedrawFrame } from './redraw';
import type { HeightLayer, TerrainLook } from './contract';
import type { StackedLayer } from './layers';

/** Typed parameter writes, as glUniform* (vectors of floats unless named otherwise). */
export interface ParamWriter {
  int(name: string, value: number): void;
  uint(name: string, value: number): void;
  float(name: string, value: number): void;
  vec2(name: string, x: number, y: number): void;
  vec3(name: string, x: number, y: number, z: number): void;
  vec4(name: string, x: number, y: number, z: number, w: number): void;
  /** uniform{size}fv: a whole array (or vector) from a flat list. */
  floats(name: string, size: 1 | 2 | 3 | 4, values: Float32Array | readonly number[]): void;
}
/** The textures the look block binds, resolved by each backend to its own objects (empty when absent). */
export type LookTexture = 'refined' | 'previousRefined' | 'coast' | 'lake' | 'overlay' | 'emptyAux';
/** Backend bindings of the look block: textures and the helpers that bind them with their parameters. */
export interface LookBindings extends ParamWriter {
  texture(name: string, unit: number, texture: LookTexture): void;
  sampler(name: string, unit: number): void;
  /** Forest field, occupation, bank and beach (GL units 7, 8, 12, 13) and uForest. */
  forest(enabled: boolean): void;
  /** Holdings (GL unit 16 where the context has 17 units). */
  landDetail(): void;
  /** Baked shore ring and relief light (GL unit 14), uploaded first when `mode` >= 2 and it changed. */
  shoreRing(mode: number): void;
  /** With `on`, the paper map's lit land (render/treeSymbols.ts) on the shore ring's binding, and uHasLandBackdrop. */
  landBackdrop(on: boolean): void;
  /** Painted forest brushes, or the optional crown clumps, or given `treeSymbols` (its palette) the paper map's tree
   * symbols, on the same binding (GL unit 9). */
  brushes(enabled: boolean, crownDetail: CrownDetail | undefined, treeSymbols: Palette | undefined): void;
  seasonCalendar(zone: ClimateZone | undefined, calendar: SeasonCalendar | undefined): void;
}

/** What the look block reads besides the look: built once per redraw. */
export interface LookParamsState {
  look: TerrainLook;
  quality: number;
  frame: RedrawFrame;
  stylePixelRatio: number;
  /** Framebuffer pixel ratio and view scale (contour widths in device pixels). */
  dpr: number;
  scale: number;
  palettes: LookPalettes;
  mode: number;
  /** The variant draws the forest. */
  forest: boolean;
  base?: HeightLayer;
  refined?: StackedLayer;
  previousRefined?: StackedLayer;
  /** A coastal distance field is bound. */
  coastal: boolean;
  sea?: WaterSurface;
  /** uHasLake: 0 without lake, 1 procedural shore, 2 exact shore. */
  lake: number;
  lakeN: number;
  overlay: boolean;
  city: boolean;
}

/** '#rgb' or '#rrggbb' as linear 0-1 components (no colour-space conversion). */
const hex = (value: string): [number, number, number] => {
  const v = value.replace('#', '');
  const full =
    v.length === 3
      ? v
          .split('')
          .map(c => c + c)
          .join('')
      : v;
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
};
const hexCache = new Map<string, [number, number, number]>();
/** hex() of a palette colour, parsed once (the arrays are only read). */
const rgb = (value: string): [number, number, number] => {
  let c = hexCache.get(value);
  if (!c) hexCache.set(value, (c = hex(value)));
  return c;
};
const LIGHT_SATELLITE_STOPS: [number, string][] = [
  [0, '#7c8960'],
  [0.55, '#8e936f'],
  [1, '#b6af91'],
];
const townGlow = new Float32Array(64),
  NO_TOWN_GLOW = new Float32Array(0),
  NO_FARM_BEDS = new Float32Array(128),
  stopColors = new Float32Array(24),
  stopPositions = new Float32Array(8);

/** Every parameter of the look; written again for the auxiliary pass (same names, same values). Returns the
 * refinement's fade (uRefinedAlpha). */
export function writeLookParams(b: LookBindings, s: LookParamsState): number {
  const { look, frame, mode } = s,
    { definition, pal, water } = s.palettes;
  // Light ground has no procedural detail or auxiliary pass, even in close world tiles. The palette and
  // source-height hillshade carry the style; no crown atlas, shore-light bake, material or fractal octaves.
  const light = terrainDrawQuality(look, s.quality) > 0;
  b.int('uQuality', light ? s.quality : 0);
  b.vec2('uCanvas', frame.width, frame.height);
  b.vec2('uOrigin', frame.origin[0], frame.origin[1]);
  b.float('uPx', frame.px);
  b.float('uDpr', s.stylePixelRatio);
  b.floats('uWaterSeason', 2, waterSeasonUniforms(look.v2Season, look.climateZone, look.v2Calendar));
  b.floats('uFreshWater', 4, lookFreshWater(look, water));
  b.floats('uWaterBed', 3, waterBed(look.climateZone));
  b.vec4('uForestTrees', 0, 0, 0, look.treePlane === 'floor' ? -3 : look.treePlane === 'keys' ? -4 : 0);
  b.int('uGroundCapture', look.groundCapture ? 1 : 0);
  b.int('uNaturalWater', !light && look.waterLook === 'natural' ? 1 : 0);
  b.int('uNight', look.ambience === 'night' ? 1 : 0);
  b.int('uUnderdark', look.underdark ? 1 : 0);
  {
    const g = look.townGlow ?? NO_TOWN_GLOW,
      count = Math.min(16, (g.length / 3) | 0);
    townGlow.fill(0);
    for (let k = 0; k < count; k++) for (let c = 0; c < 3; c++) townGlow[k * 4 + c] = g[k * 3 + c];
    b.floats('uTownGlow[0]', 4, townGlow);
    b.int('uTownGlowCount', count);
  }
  {
    const f = look.farmBeds ?? NO_FARM_BEDS;
    b.floats('uFarmBeds[0]', 4, f);
    let n = 0;
    for (let k = 0; k < 32; k++) if (f[k * 4 + 2] > 0) n = k + 1;
    b.int('uFarmBedCount', n);
  }
  b.float('uMapW', look.mapWidth);
  b.int('uRelief', look.layers.relief ? 1 : 0);
  b.int('uWaterVisible', look.layers.water !== false ? 1 : 0);
  b.uint('uMaterialSeed', look.seed >>> 0);
  b.vec2('uMaterialClimate', look.climate?.temperature ?? 18, look.climate?.precipitation ?? 1000);
  b.int('uMode', mode);
  b.forest(!light && s.forest);
  b.landDetail();
  // RGBA16F: shore distance, openness, sky occlusion, horizon tangent toward the light (re-baked off the frame path
  // when the light azimuth changes; the previous texture stays until the new texels are ready).
  b.shoreRing(light ? 0 : mode);
  const brushes = !light && styleTraits(look.style).forestBrushes && mode === 3,
    symbols = treeSymbolsOn(look, mode) ? look.treeSymbols : undefined;
  b.brushes(brushes, light ? 'plain' : look.crownDetail, symbols?.palette);
  // The paper map's lit land takes the shore ring's binding (natural looks only, mode >= 2): uHasLandBackdrop.
  b.landBackdrop(!!symbols);
  if (symbols) {
    const land = mapLandSeason();
    b.floats('uLandTint', 4, land.tint);
    b.floats('uLandSnow', 4, land.snow);
    b.floats('uTreeWash', 4, treeSymbolWash(symbols.palette));
    b.floats('uTreeSeason', 4, treeSymbolSeason(symbols.palette));
    b.floats('uTreeSpecies', 4, treeSymbolSpecies(symbols));
  }
  b.int('uPaperMap', styleTraits(look.style).paperMap ? 1 : 0);
  b.int('uRenderV2', light ? 0 : styleTraits(look.style).satelliteVariant);
  b.int('uV2WaterVisible', look.layers.water === false ? 0 : 1);
  if (!light && s.base && look.climate) b.floats('uV2GlacierSources[0]', 4, renderV2GlacierSources(s.base, look.climate));
  b.float('uV2Season', look.v2Season ?? 0.5);
  b.seasonCalendar(look.climateZone, look.v2Calendar);
  b.int('uMaterialZone', renderV2ZoneUniform(look.climateZone));
  b.int('uCityWater', s.city ? 1 : 0);
  b.int('uEnhanced3d', !light && (look.mesh3d || styleTraits(look.style).ground3d) ? 1 : 0);
  b.int('uRefinementMode', look.refinement3d === 'source' ? 0 : isNeuralRefinement(look.refinement3d ?? 'noise') ? 2 : 1);
  const refined = s.refined,
    previous = s.previousRefined;
  b.texture('uRefined', 5, 'refined');
  b.sampler('uRefined', 5);
  b.int('uRefinedN', refined?.layer.n ?? 0);
  b.vec4('uRefinedRect', refined?.layer.x ?? 0, refined?.layer.y ?? 0, refined?.layer.width ?? 1, 0);
  b.texture('uPreviousRefined', 6, 'previousRefined');
  b.sampler('uPreviousRefined', 6);
  b.int('uPreviousRefinedN', previous?.layer.n ?? 0);
  b.vec4('uPreviousRefinedRect', previous?.layer.x ?? 0, previous?.layer.y ?? 0, previous?.layer.width ?? 1, 0);
  const enhancedAlpha = refined ? fadeProgress(performance.now(), refined.fadeStart) : 1;
  b.float('uRefinedAlpha', enhancedAlpha);
  b.floats('uPaper', 3, rgb(pal.paper));
  b.floats('uSea', 3, rgb(pal.seaFill));
  b.floats('uShore', 3, rgb(water.stops[0][1]));
  b.int('uCoastalSea', s.coastal ? 1 : 0);
  b.float('uCoastWaves', !light && look.coastWaves ? 1 : 0);
  const waterPalette = waterUniforms(water);
  b.floats('uWaterStops', 3, waterPalette.colors);
  b.floats('uWaterStopT', 1, waterPalette.positions);
  b.int('uWaterStopCount', water.stops.length);
  b.float('uSeaBand', waterBand(look, s.sea, water));
  b.vec2('uCoastOrigin', s.sea?.x ?? 0, s.sea?.y ?? 0);
  b.float('uCoastWidth', s.sea?.width ?? look.mapWidth);
  b.int('uCoastN', s.sea?.n ?? 1);
  b.floats('uBackground', 3, rgb(look.background));
  b.floats('uFrameColor', 3, rgb(styleTraits(look.style).elevation ? '#333333' : pal.frame));
  b.floats('uContourColor', 3, rgb(pal.contour));
  const hypsometry = look.layers.hypsometry || styleTraits(look.style).elevation,
    stops = hypsometry ? (light && definition.traits.satelliteVariant > 0 && !definition.traits.paperMap ? LIGHT_SATELLITE_STOPS : pal.hypso) : undefined,
    stopCount = stops ? Math.min(8, stops.length) : 2;
  for (let i = 0; i < 8; i++) {
    const stop = stops?.[Math.min(i, stopCount - 1)];
    stopColors.set(rgb(stop ? stop[1] : pal.paper), i * 3);
    stopPositions[i] = stop ? stop[0] : Math.min(i, 1);
  }
  b.floats('uStops', 3, stopColors);
  b.floats('uStopT', 1, stopPositions);
  b.int('uStopCount', stopCount);
  const lights = terrainLights(look.lighting);
  b.vec4('uGroundCover', lights.primary[0], lights.primary[2], lights.primary[1], groundCoverActive(definition.traits.satelliteVariant, definition.traits.forestBrushes, s.forest, mode === 3 && look.groundCover !== false));
  b.floats('uLight', 3, lights.primary);
  b.floats('uLight2', 3, lights.secondary);
  b.float('uRockStrength', look.lighting.enabled ? look.lighting.strength : 0);
  b.float('uFlatLight', lights.flat);
  b.float('uExaggeration', look.lighting.exaggeration);
  b.float('uShade', pal.shade * (look.lighting.enabled ? look.lighting.strength : 0));
  const coastal = look.globalMin < 0;
  b.float('uMinH', Math.max(0, look.globalMin));
  b.float('uMaxH', look.globalMax);
  b.float('uGlobalMin', look.globalMin);
  b.float('uFloor', look.floor);
  b.int('uCoastal', coastal ? 1 : 0);
  b.int('uFrame', look.frame ? 1 : 0);
  // Contour weights of the Canvas renderer, in device pixels.
  const thin = mapStrokeWidth(CANVAS_MAP_STROKES.contour, s.scale) * s.scale * s.dpr;
  const index = mapStrokeWidth(CANVAS_MAP_STROKES.contourIndex, s.scale, pal.contourIndexW / 1.6) * s.scale * s.dpr;
  b.int('uContours', look.contours && look.contourStep > 0 ? 1 : 0);
  b.float('uStep', Math.max(1e-3, look.contourStep));
  b.float('uThinW', thin);
  b.float('uIndexW', index);
  b.float('uThinA', pal.contourOpacity * 0.5);
  b.float('uIndexA', pal.contourOpacity * 0.75);
  b.float('uFlatSlope', look.flatRelief ? 0.004 : 0.012);
  b.int('uRefine', !light && look.refine ? 1 : 0);
  b.float('uSourceCell', look.sourceCell);
  b.uint('uSeed', look.seed >>> 0);
  const d = look.detail;
  b.vec4('uDetailA', d.amplitude, d.hurst, Math.max(1.1, d.lacunarity), d.start);
  b.vec3('uDetailB', d.slope, d.flat, d.shore);
  b.int('uOctaves', light ? 0 : Math.min(FRACTAL_ROTATIONS.length, Math.round(d.octaves)));
  // Textures: 0 field, 1 cave, 2 lake, 3 overlay, 4 coast distance.
  b.sampler('uField', 0);
  b.sampler('uCave', 1);
  b.sampler('uLake', 2);
  b.sampler('uOverlay', 3);
  b.sampler('uCoastDistance', 4);
  b.texture('uCoastDistance', 4, 'coast');
  b.texture('uLake', 2, 'lake');
  b.int('uHasLake', light && s.lake > 0 ? 2 : s.lake);
  b.float('uLakeN', s.lakeN);
  b.texture('uOverlay', 3, 'overlay');
  b.int('uHasOverlay', s.overlay ? 1 : 0);
  // Auxiliary texture unit: empty (integer) until the auxiliary pass binds its result, never its own render target.
  b.texture('uAux', 15, 'emptyAux');
  b.sampler('uAux', 15);
  b.int('uHasAux', 0);
  return enhancedAlpha;
}

/** The water layer pass: the premultiplied water of the base relief, without contours, overlay or frame. */
export function writeWaterLayerParams(w: ParamWriter): void {
  w.int('uGroundCapture', 1);
  w.int('uWaterVisible', 1);
  w.int('uContours', 0);
  w.int('uHasOverlay', 0);
  w.int('uFrame', 0);
}
/** Back to the look's own values for the map pass after the water layer. */
export function writeMapParamsAfterWaterLayer(w: ParamWriter, look: TerrainLook, overlay: boolean): void {
  w.int('uGroundCapture', 0);
  w.int('uWaterVisible', look.layers.water === false ? 0 : 1);
  w.int('uContours', look.contours && look.contourStep > 0 ? 1 : 0);
  w.int('uHasOverlay', overlay ? 1 : 0);
  w.int('uFrame', look.frame ? 1 : 0);
}
/** The height layer a draw samples (its texture is bound by the backend). */
export function writeFieldParams(w: ParamWriter, layer: StackedLayer & { cave?: unknown }, base: boolean): void {
  const l = layer.layer;
  w.int('uHasCave', layer.cave ? 1 : 0);
  w.int('uFieldN', l.n);
  w.vec2('uFieldOrigin', l.x, l.y);
  w.float('uFieldCell', l.width / l.n);
  w.int('uMaxLod', layer.levels.length - 1);
  w.int('uBase', base ? 1 : 0);
}
