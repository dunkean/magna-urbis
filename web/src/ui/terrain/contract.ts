/**
 * Public types of the 2D ground renderers (TerrainGl, TerrainGpu): the inputs their callers build (height layers,
 * the look, water, overlay, retained water) and the surface sampler they hand to the 3D views.
 */
import type { WaterSurface } from '../../render/terrainWater';
import type { CrownDetail } from '../../render/crownClumpAtlas';
import type { TerrainLayers, TerrainLighting } from '../../render/terrainLighting';
import type { SeasonCalendar } from '../../../../rust/bridge/terrainRenderV2Zones';
import type { ClimateZone } from '../../../../rust/bridge/terrainClimate';
import type { TerrainStyle } from '../../render/terrainStyle';
import type { RenderColors } from '../../render/customColors';
import type { TreeSymbolLook } from '../../render/treeSymbols';
import type { WaterSeason } from '../../render/waterRegime';
import type { FractalDetail } from '../../../../rust/bridge/terrainAdjust';
import type { TerrainRefinement } from '../terrainRefinement';

/** Control points of a height layer: `n²` values at cell centres of the square `[x, x + width]²`. */
export interface HeightLayer {
  waterSurface?: WaterSurface;
  x: number;
  y: number;
  width: number;
  n: number;
  data: Float32Array;
  /** 1 where cavern rock (same grid), optional. */
  cave?: Uint8Array;
}

export interface TerrainLook {
  /** Internal draw policy; captures pin false, live readiness follows displayQuality when absent. */
  displayLight?: boolean;
  /** Static companion tile of the painted forest. */
  treePlane?: 'floor' | 'keys';
  ambience?: 'day' | 'night';
  waterLook?: 'ink' | 'natural';
  /** Satellite looks: swell crests and surf along exposed sea coasts (terrainRenderV2Coast). */
  coastWaves?: boolean;
  /** Close-zoom leaf-clump relief of the procedural broadleaf and orchard crowns (2D map only; composition
   * `vegetation.crownDetail`, render/crownClumpAtlas.ts). Absent: DEFAULT_CROWN_DETAIL. */
  crownDetail?: CrownDetail;
  groundCover?: boolean;
  /** Paper map woods drawn by the ground (render/treeSymbols.ts): the wash and the engraved tree symbols of the forest
   * land, in the palette of the overlay and with these species. Only the shaded paper ground (mode 0) draws them. */
  treeSymbols?: TreeSymbolLook;
  colors?: RenderColors;
  /** V2 composes the retained canopy over every ground; standalone benches keep their material-only canopy. */
  independentCanopy?: boolean;
  /** Explicit opt-in for perspective captures; ordinary 2D styles retain their surface. */
  mesh3d?: boolean;
  v2Season?: number;
  /** Edits of the zone's year (appearance panel). */
  v2Calendar?: SeasonCalendar;
  /** Internal premultiplied water/ink pass for the physically shaded flyover. */
  groundCapture?: boolean;
  refinement3d?: TerrainRefinement;
  climate?: { temperature: number; precipitation: number };
  /** V2 climate zone (Render v2 styles); absent keeps the climate-only look. */
  climateZone?: ClimateZone;
  /** Underdark world (biome 'underdark'): the satellite looks draw a cave floor, rock masses and cave water. */
  underdark?: boolean;
  /** Underdark: lantern glow on the cave floor around towns, x, y, radius (m) per town, up to 16. */
  townGlow?: Float32Array;
  /** Underdark: fungal farm lots (underdarkFarmBeds): x, y, half-size, angle per farm, up to 32. */
  farmBeds?: Float32Array;
  style: TerrainStyle;
  waterStyle?: TerrainStyle;
  mapWidth: number;
  lighting: TerrainLighting;
  layers: TerrainLayers;
  globalMin: number;
  globalMax: number;
  contours: boolean;
  contourStep: number;
  flatRelief: boolean;
  /** Fractal refinement below `sourceCell` (metres), seeded. */
  refine: boolean;
  sourceCell: number;
  seed: number;
  detail: FractalDetail;
  /** Lower clamp of the regional reliefs (the engine keeps land at ≥ 0.3 m). */
  floor: number;
  frame: boolean;
  background: string;
}

export interface WaterLayer {
  /** Prefiltered signed shore coefficients over the map (`n²`, drainage cells). */
  lake?: Float32Array;
  n: number;
  /** `procedural` (default) adds sub-cell shore detail; `exact` draws the B-spline's zero as is. */
  shore?: 'procedural' | 'exact';
  /** Instances: x0, y0, x1, y1, upstream/downstream width (m), r, g, b. */
  rivers?: Float32Array;
  /** The river colour carries the seasonal regime for the painted compositor (waterRegime.ts regimeRgb). */
  regime?: boolean;
  /** The satellite material includes colour-only estuary or lake inlet instances after its physical channels. */
  estuaries?: boolean;
}

/** Seasonal regime of retained water (City Bench): zone and season, and `city` for the city-zoom river colour. */
export interface RetainedWaterOptions {
  season?: WaterSeason;
  city?: boolean;
}

export interface OverlayLayer {
  rgba: Uint8Array;
  n: number;
}

/** Height (metres) at a world point, refined at `metresPerPixel`. */
export type SurfaceSample = (x: number, y: number, metresPerPixel?: number) => number;
