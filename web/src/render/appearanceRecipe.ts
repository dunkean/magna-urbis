/**
 * Appearance recipe: the user's visual intent split into typed components, resolved once per change
 * (never per frame) into a frozen, fully defaulted `ResolvedAppearance` for one target.
 * A named style is a preset of this recipe; its declared `StyleTraits` drive every decision, never its id.
 * Shared by V2 and the benches: no V2 import, no engine import, no I/O.
 */
import type { MapStyle } from './styles';
import { styleTraits, type StyleTraits, type TerrainStyle } from './terrainStyle';
import { DEFAULT_TERRAIN_LIGHTING, DEFAULT_TERRAIN_LAYERS, type TerrainLighting, type TerrainLayers } from './terrainLighting';
import type { DiagnosticId } from './displayDiagnostics';
import type { RenderColors } from './customColors';
import type { CityView, CityPalette, CityLayers } from './cityCanvas';
import type { UrbanBuildingStyle, UrbanBuildingDiagnostic } from './urbanBuildingStyle';
import { DEFAULT_FANTASY_OPTIONS, type FantasyOptions } from '../../../rust/bridge/fantasyPainting';
import { DEFAULT_FOREST_SETTINGS, type ForestSettings } from '../../../rust/bridge/terrainForest';
import { applyComposition, resolveComposition, withGroundVariant, type CompositionRecipe, type ResolvedComposition } from './composition';

export type RenderTarget = 'view2d' | 'view3d' | 'export';
export type RenderPath = 'classic' | 'composite';
export type CityGround = 'map' | 'render' | 'render3d' | 'render3d-brush' | 'render-v2' | 'render-v2-substrate' | 'render-v2-moisture' | 'render-v2-vegetation' | 'render-v2-snow';

export interface CityInput {
  view?: CityView; palette?: CityPalette; buildingStyle?: UrbanBuildingStyle; diagnostic?: UrbanBuildingDiagnostic; layers?: Partial<CityLayers>;
  groundBlend?: 'classic' | 'blended'; painted?: boolean; opacity?: number; width?: number; ground?: CityGround; plan?: boolean;
  colors?: 'materials' | 'uses'; exaggeration?: number; refinement?: 'source' | 'noise';
}
/** The persisted recipe: every field optional, nothing expanded. */
export interface AppearanceInput {
  /** The pass-by-pass recipe. When present it drives the fields it covers (see applyComposition); the rest are advanced settings. */
  composition?: CompositionRecipe;
  colors?: RenderColors; roads?: boolean; buildings?: boolean; forest?: Partial<ForestSettings>;
  style: MapStyle; terrainStyle?: TerrainStyle; renderer?: 'classic' | 'bench';
  contours?: boolean; landuse?: boolean; labels?: boolean; legend?: boolean; cartouche?: boolean; textured?: boolean; painted?: boolean;
  vegetation?: 'classic' | 'canopy'; terrainLayers?: TerrainLayers; diagnostic?: DiagnosticId; /** Potential id of the `res-potential` diagnostic. */ resourcePotential?: string;
  lakes?: boolean; oxbows?: boolean; fantasy?: FantasyOptions; city?: CityInput;
  /** To test (31/10): one default table for 2D, 3D and the classic canvas. Off keeps the previous per-view defaults. */
  unifiedDefaults?: boolean;
}
/** Defaults that come from the project, not from the appearance. */
export interface AppearanceBase { mapStyle: MapStyle; contours?: boolean; landuse?: boolean; labels?: boolean; legend?: boolean; forest?: Partial<ForestSettings> }
/** What the retained products can show. Absent means absent: nothing is approximated. */
export interface RenderCapabilities { nativeCities: boolean; paintedTextures?: boolean; nativeTerrain?: boolean; vectorWater?: boolean; hydrology?: boolean; parcels?: boolean; buildings?: boolean; ruralLanduse?: boolean; urbanLanduse?: boolean; limitations?: readonly import('./composition').Limitation[] }
export interface ResolveFlags {
  /** Stage preview: a metre-scale field is invisible in a finished style, so inspect its elevation without changing the saved recipe. */
  preview?: boolean;
}

export interface GroundComponent {
  /** Effective ground style ('copernicus' under the elevation diagnostic). */
  style: TerrainStyle; traits: StyleTraits;
  lighting: TerrainLighting; season: number; layers: TerrainLayers & { water: boolean }; contours: boolean; lakes: boolean; oxbows: boolean;
}
export interface VegetationComponent {
  /** Who draws forests: the ground material, the cartographic canopy, or classic symbols. */
  representation: 'material' | 'canopy' | 'classic';
  /** The persisted vector vegetation choice (canopy by default). */
  symbols: 'classic' | 'canopy';
  /** Forest overrides as persisted (empty when none). */
  forest: Readonly<Partial<ForestSettings>>;
  /** Defaults + project forest + overrides. */
  forestSettings: Readonly<ForestSettings>;
  fantasy: Readonly<FantasyOptions>;
}
export interface PaletteComponent {
  mapStyle: MapStyle; colors: RenderColors | undefined;
  /** The seven tokens the terrain renderers read (unfiltered, as the benches always passed them). */
  terrainColors: RenderColors | undefined;
  /** The subset of `colors` the selected style actually honours. */
  applicableColors: RenderColors;
}
export interface CartographyComponent { roads: boolean; landuse: boolean; labels: boolean; legend: boolean; cartouche: boolean; painted: boolean; landuseForestTone: 'ground' | 'marked' }
export interface CityComponent {
  visible: boolean; textured: boolean;
  view: CityView; palette: CityPalette; buildingStyle: UrbanBuildingStyle; diagnostic: UrbanBuildingDiagnostic; layers: Readonly<CityLayers>;
  groundBlend: 'classic' | 'blended'; painted: boolean; opacity: number; width: number; ground: CityGround; plan: boolean;
  colors: 'materials' | 'uses'; exaggeration: number; refinement: 'source' | 'noise';
}
export interface Incompatibility { field: string; reason: string }
/** Per-pass cache keys: each is computed only from the fields its pass reads. */
export interface PassKeys {
  /** Uniform-level look of the terrain material (style, tokens, lighting, season, layers, contours). */
  terrainLook: string;
  /** What forces a CPU re-rasterization of the terrain (not a look uniform). */
  terrainBase: string;
  water: string;
  forest: string;
  /** Structure of the map overlay (palette, roads, land use, painted, vegetation): rebuilds the overlay renderer. */
  cartography: string;
  /** Labels, legend, cartouche: toggles on the existing overlay renderer. */
  overlays: string;
  /** Road emphasis: a repaint of the roads, read per frame; no pass rebuilds anything for it. */
  roads: string;
  /** Semantic land use (rural and urban): looks, classes, opacity. Never moves any other key. */
  semantic: string;
  city: string;
}
export interface ResolvedAppearance {
  readonly target: RenderTarget;
  readonly path: RenderPath;
  /** Selected style (terrain style, else map style). */
  readonly styleId: TerrainStyle;
  readonly traits: StyleTraits;
  readonly ground: Readonly<GroundComponent>;
  readonly vegetation: Readonly<VegetationComponent>;
  readonly palette: Readonly<PaletteComponent>;
  readonly cartography: Readonly<CartographyComponent>;
  readonly city: Readonly<CityComponent>;
  /** What each pass draws, for this target. Read this rather than the style traits. */
  readonly composition: ResolvedComposition;
  readonly diagnostic: DiagnosticId | 'none';
  readonly resourcePotential: string;
  readonly incompatibilities: readonly Incompatibility[];
  readonly keys: Readonly<PassKeys>;
}

/** The single default table for 2D, 3D and export. */
export const DEFAULT_CITY_LAYERS: Readonly<CityLayers> = Object.freeze({ reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, lotEnclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false });
export const DEFAULT_CITY = { view: 'buildings', palette: 'parchment', buildingStyle: 'cartographic', diagnostic: 'none', opacity: .8, width: .6, plan: true, colors: 'materials', exaggeration: 1, refinement: 'noise', groundBlend: 'classic' } as const;
/** Previous 3D defaults, used while `unifiedDefaults` is off. */
const LEGACY_3D_CITY = { view: 'parcels', palette: 'terrain', opacity: 1 } as const;
const LEGACY_3D_LAYERS: Readonly<CityLayers> = Object.freeze({ ...DEFAULT_CITY_LAYERS, domains: false });
const TERRAIN_COLOR_KEYS = ['paper', 'groundLow', 'groundHigh', 'contour', 'waterShore', 'waterDeep', 'river'] as const;
const WATER_COLOR_KEYS = new Set<string>(['waterShore', 'waterDeep', 'river']);
const GROUND_COLOR_KEYS = new Set<string>(['groundLow', 'groundHigh']);
/** Tokens the map overlay never reads once water, ground and contours belong to other passes (the legend swatches and classic urban water do read them). */
const OVERLAY_FOREIGN_COLORS = ['waterShore', 'waterDeep', 'river', 'groundLow', 'groundHigh', 'contour'];
const omit = (colors: RenderColors | undefined, tokens: readonly string[]): unknown => {
  const kept = Object.entries(colors ?? {}).filter(([token, value]) => value !== undefined && !tokens.includes(token));
  return kept.length ? Object.fromEntries(kept) : undefined;
};
const key = (...parts: unknown[]): string => JSON.stringify(parts);

function applicable(colors: RenderColors | undefined, traits: StyleTraits): RenderColors {
  if (!colors) return {};
  const out: Record<string, string> = {};
  for (const [token, value] of Object.entries(colors)) {
    if (value === undefined || (WATER_COLOR_KEYS.has(token) && !traits.customWaterColors) || (GROUND_COLOR_KEYS.has(token) && !traits.customGroundColors)) continue;
    out[token] = value;
  }
  return out;
}

export function resolveAppearance(appearance: AppearanceInput | undefined, base: AppearanceBase, capabilities: RenderCapabilities, target: RenderTarget, flags: ResolveFlags = {}): ResolvedAppearance {
  const a = appearance?.composition ? applyComposition(appearance, appearance.composition) : appearance, preview = !!flags.preview;
  const mapStyle = a?.style ?? base.mapStyle, styleId = a?.terrainStyle ?? mapStyle, traits = styleTraits(styleId);
  const diagnostic: DiagnosticId | 'none' = preview ? 'elevation' : a?.diagnostic ?? 'none';
  const groundStyle: TerrainStyle = diagnostic === 'elevation' ? 'copernicus' : styleId, groundTraits = styleTraits(groundStyle);
  const path: RenderPath = preview ? 'composite' : a?.renderer === 'classic' ? 'classic' : a?.renderer === 'bench' ? 'composite'
    // A style picked in the terrain look selector (terrainStyle) is drawn by the composite renderer, map palettes included.
    : a?.terrainStyle !== undefined || traits.family !== 'map' || diagnostic !== 'none' || capabilities.nativeCities ? 'composite' : 'classic';

  // Global effects live in the recipe; a caller without one keeps the neutral defaults.
  const effects = appearance?.composition?.effects;
  const ground: GroundComponent = { style: groundStyle, traits: groundTraits, lighting: { ...DEFAULT_TERRAIN_LIGHTING, ...effects?.lighting }, season: effects?.season ?? .5,
    layers: { ...DEFAULT_TERRAIN_LAYERS, ...a?.terrainLayers, water: a?.terrainLayers?.water ?? true }, contours: a?.contours ?? base.contours ?? true, lakes: a?.lakes ?? true, oxbows: a?.oxbows ?? true };
  const unified = a?.unifiedDefaults === true, legacy3d = !unified && target === 'view3d';
  // Previously the classic 2D canvas drew classic vegetation symbols by default; export and composite used the canopy.
  const symbols = a?.vegetation ?? (!unified && target === 'view2d' && path === 'classic' ? 'classic' : 'canopy');
  const forest = { ...a?.forest };
  const composition = resolveComposition(appearance?.composition, traits, target, capabilities);
  const vegetation: VegetationComponent = { representation: composition.vegetation.procedural ? 'material' : symbols, symbols, forest,
    forestSettings: { ...DEFAULT_FOREST_SETTINGS, ...base.forest, ...forest }, fantasy: { ...DEFAULT_FANTASY_OPTIONS, followLanduse: false, ...a?.fantasy, forests: composition.vegetation.groundForests } };
  const terrainColors = a?.colors && Object.fromEntries(TERRAIN_COLOR_KEYS.map(token => [token, a.colors![token]])) as RenderColors;
  const palette: PaletteComponent = { mapStyle, colors: a?.colors, terrainColors, applicableColors: applicable(a?.colors, groundTraits) };
  const cartography: CartographyComponent = { landuseForestTone: composition.vegetation.forestTone, roads: a?.roads ?? true, landuse: a?.landuse ?? base.landuse ?? true, labels: preview ? false : a?.labels ?? base.labels ?? true,
    legend: a?.legend ?? base.legend ?? false, cartouche: a?.cartouche ?? false, painted: a?.painted ?? false };
  const c = a?.city;
  const city: CityComponent = { visible: a?.buildings ?? true, textured: a?.textured ?? false,
    view: c?.view ?? (legacy3d ? LEGACY_3D_CITY.view : DEFAULT_CITY.view), palette: c?.palette ?? (legacy3d ? LEGACY_3D_CITY.palette : DEFAULT_CITY.palette), buildingStyle: c?.buildingStyle ?? DEFAULT_CITY.buildingStyle, diagnostic: c?.diagnostic ?? DEFAULT_CITY.diagnostic,
    layers: { ...(legacy3d ? LEGACY_3D_LAYERS : DEFAULT_CITY_LAYERS), ...c?.layers }, groundBlend: c?.groundBlend ?? DEFAULT_CITY.groundBlend, painted: c?.painted ?? (traits.paintedCityByDefault || styleTraits(c?.ground ?? '').paintedCityByDefault),
    opacity: c?.opacity ?? (legacy3d ? LEGACY_3D_CITY.opacity : DEFAULT_CITY.opacity), width: c?.width ?? DEFAULT_CITY.width, ground: c?.ground ?? (traits.ground3d ? styleId as CityGround : 'map'), plan: c?.plan ?? DEFAULT_CITY.plan,
    colors: c?.colors ?? (c?.diagnostic === 'uses' ? 'uses' : DEFAULT_CITY.colors), exaggeration: c?.exaggeration ?? DEFAULT_CITY.exaggeration, refinement: c?.refinement ?? DEFAULT_CITY.refinement };

  const incompatibilities: Incompatibility[] = [];
  const reject = (field: string, reason: string): void => { incompatibilities.push({ field, reason }); };
  for (const token of Object.keys(a?.colors ?? {})) {
    if (WATER_COLOR_KEYS.has(token) && !groundTraits.customWaterColors) reject(`colors.${token}`, 'This ground draws its water from its own material.');
    else if (GROUND_COLOR_KEYS.has(token) && !groundTraits.customGroundColors) reject(`colors.${token}`, 'This ground colours itself from its material.');
  }
  if (cartography.painted && capabilities.paintedTextures === false) reject('painted', 'Painted textures are not available.');
  if (diagnostic !== 'none' && path === 'classic') reject('diagnostic', 'Diagnostics need the composite renderer.');
  if (target === 'view3d') {
    if (diagnostic !== 'none') reject('diagnostic', 'Diagnostics are 2D overlays.');
  }

  const keys: PassKeys = {
    terrainLook: key(ground.style, pick(palette.applicableColors, ['paper', 'contour', 'groundLow', 'groundHigh', 'waterShore', 'waterDeep', 'river']), ground.lighting, ground.season, ground.layers.relief, ground.layers.hypsometry, ground.layers.frame, ground.contours,composition.ambience,composition.networks.water.look),
    terrainBase: key(ground.style, ground.layers.relief, groundTraits.fantasy ? vegetation.fantasy : 0),
    water: key(ground.style, pick(palette.applicableColors, ['waterShore', 'waterDeep', 'river']), ground.layers.water, ground.lakes, ground.oxbows, composition.networks.water, diagnostic, diagnostic === 'res-potential' ? a?.resourcePotential ?? 'arable' : null),
    forest: key(vegetation.forest, groundTraits.forestClearingProfile, groundTraits.forestBrushes, ground.layers.water),
    cartography: key(groundTraits.satelliteVariant ? null : ground.season, mapStyle, capabilities.nativeCities && !cartography.legend ? omit(a?.colors, OVERLAY_FOREIGN_COLORS) : a?.colors, ground.style, cartography.roads, composition.networks.roads.look, cartography.landuse, cartography.painted, vegetation.symbols, composition.vegetation.cartographic, city.visible, cartography.landuseForestTone),
    overlays: key(composition.text, cartography.labels, cartography.legend, cartography.cartouche),
    roads: key(composition.networks.roads.emphasis),
    semantic: key(composition.landuse),
    city: key(city, a?.colors,composition.ambience),
  };
  const result: ResolvedAppearance = { target, path, styleId, traits, ground: Object.freeze(ground), vegetation: Object.freeze(vegetation), palette: Object.freeze(palette),
    cartography: Object.freeze(cartography), city: Object.freeze(city), composition, diagnostic, resourcePotential: a?.resourcePotential ?? 'arable', incompatibilities: Object.freeze(incompatibilities), keys: Object.freeze(keys) };
  return Object.freeze(result);
}
function pick(colors: RenderColors, tokens: readonly string[]): unknown[] { return tokens.map(token => (colors as Record<string, string | undefined>)[token]); }

/** The fully defaulted values as persisted-appearance shape (what the controls display). */
export function resolvedValues(r: ResolvedAppearance): AppearanceInput {
  return { composition: r.composition.recipe, style: r.palette.mapStyle, terrainStyle: r.styleId, renderer: r.path === 'composite' ? 'bench' : 'classic', colors: r.palette.colors,
    contours: r.ground.contours, landuse: r.cartography.landuse, labels: r.cartography.labels, legend: r.cartography.legend, cartouche: r.cartography.cartouche,
    painted: r.cartography.painted, textured: r.city.textured, vegetation: r.vegetation.symbols, diagnostic: r.diagnostic === 'none' ? 'none' as DiagnosticId : r.diagnostic, resourcePotential: r.resourcePotential,
    lakes: r.ground.lakes, oxbows: r.ground.oxbows, roads: r.cartography.roads, buildings: r.city.visible, terrainLayers: { ...r.ground.layers },
    fantasy: { ...r.vegetation.fantasy }, forest: { ...r.vegetation.forestSettings },
    city: { view: r.city.view, palette: r.city.palette, buildingStyle: r.city.buildingStyle, diagnostic: r.city.diagnostic, opacity: r.city.opacity, width: r.city.width, plan: r.city.plan,
      colors: r.city.colors, exaggeration: r.city.exaggeration, refinement: r.city.refinement, groundBlend: r.city.groundBlend, painted: r.city.painted, ground: r.city.ground, layers: { ...r.city.layers } } };
}

/** An interaction's request to change the recipe. Views emit patches; the orchestration applies them. */
export interface AppearancePatch { terrainStyle?: TerrainStyle; renderer?: 'classic' | 'bench'; city?: Partial<CityInput> }
export function applyAppearancePatch(appearance: AppearanceInput | undefined, mapStyle: MapStyle, patch: AppearancePatch): AppearanceInput {
  const next: AppearanceInput = { style: mapStyle, ...appearance };
  if (patch.city) next.city = { ...appearance?.city, ...patch.city };
  if (patch.terrainStyle !== undefined) next.terrainStyle = patch.terrainStyle;
  if (patch.terrainStyle !== undefined && next.composition) next.composition = withGroundVariant(next.composition, patch.terrainStyle);
  if (patch.renderer !== undefined) next.renderer = patch.renderer;
  return next;
}
