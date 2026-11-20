/**
 * Render composition: what the user picks, pass by pass. A preset only fills this recipe; changing one
 * pass leaves the others alone. No field here is decided by the ground: `styleTraits` may declare what a
 * backend can do (see `limitations`), it never hides semantic data.
 * Light presets keep the saved recipe and text, but displayQuality applies a deliberately flat live rendering:
 * one palette/hillshade ground pass, no crowns, material noise or relief refinement; flat land-use fills and
 * essential roads, rivers, contours and field edges, without brushes, symbols, furrows, hatches or washes.
 * Town display uses roof-coloured footprints and tilted boxes, without textures or 3D trees. Coarser ground
 * tiers and unmultisampled targets bound pixel work on integrated/software GPUs. Captures remain full quality.
 * Pure module: no DOM, no engine, no I/O.
 */
import { SEASON_CALENDAR_FIELDS, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';
import { TEXT_GROUPS, TEXT_AMOUNTS, NAME_LEVELS, defaultText, type TextGroup, type TextSettings } from './textLayer';
import type { LandKind } from '../gen/types';
import { isMapStyle } from './styles';
import { isTerrainStyle, styleTraits, type StyleTraits, type TerrainStyle } from './terrainStyle';
import { DEFAULT_TERRAIN_LAYERS, DEFAULT_TERRAIN_LIGHTING, type TerrainLighting } from './terrainLighting';
import type { LanduseForestTone } from './landuseForestTone';
import type { AppearanceInput, RenderCapabilities, RenderTarget } from './appearanceRecipe';
import type { UrbanBuildingStyle } from './urbanBuildingStyle';
import type { ResolvedDisplayQuality } from './displayQuality';
import { UNDERDARK_CAVERN_LIMITS, type UnderdarkCavern3d } from './underdarkCavern';
import type { ContourDetail } from './cityContours';
import { CROWN_DETAILS, DEFAULT_CROWN_DETAIL, type CrownDetail } from './crownClumpAtlas';
import { DEFAULT_ROOF_MODE, ROOF_MODES, type RoofMode } from './roofMode';

/** Base looks of the ground; light presets reuse these renderers. */
export type StyleId = 'minimal' | 'atlas' | 'cadastre' | 'topographic' | 'satellite' | 'satellite-2' | 'parchment' | 'illustration';
export type PresetId = StyleId | 'satellite-light' | 'parchment-light';
export type VegetationLook = 'none' | 'symbols' | 'painted' | 'procedural-canopy';
export type SemanticLook = 'off' | 'subtle' | 'categorical' | 'outlines';
export type SemanticDepth = 'surface' | 'readable';
export type NetworkLook = 'inherit' | 'ink' | 'natural' | 'wash';
/** How a road network is drawn: `wash` is the translucent earth of the parchment map (groundBlend.ts), roads only;
 * `rendered` is the painted road surface of the satellite family (roadStyle.ts, `look: 'rendered'`). */
export type RoadLook = 'ink' | 'natural' | 'wash' | 'rendered';
/** Road surface of a recipe: the plan look of the style (`networks.roads.look`) or the painted surface. The painted
 * surface belongs to the material grounds (satellite family); a vector style keeps its plan look. */
export type RoadSurfaceMode = 'plan' | 'rendered';
export const ROAD_SURFACE_MODES: readonly RoadSurfaceMode[] = ['plan', 'rendered'];
/** The three-state road control of the top bar: plan look, no roads, painted surface. */
export type RoadDisplay = 'plan' | 'none' | 'rendered';
export const ROAD_DISPLAYS: readonly RoadDisplay[] = ['plan', 'none', 'rendered'];
/** Natural and rendered roads share the ground-following painters (roadStyle.ts); `rendered` only changes their marks. */
export const groundRoadLook = (look: RoadLook | undefined): boolean => look === 'natural' || look === 'rendered';
export type BuildingLook = 'footprints' | 'cartographic-roofs' | 'simple-volumes' | 'detailed-volumes';
export type Ambience = 'day' | 'night';

export const STYLE_IDS: readonly StyleId[] = ['minimal', 'atlas', 'cadastre', 'topographic', 'satellite', 'satellite-2', 'parchment', 'illustration'];
export const PRESET_IDS: readonly PresetId[] = STYLE_IDS.flatMap(id => (id === 'satellite' || id === 'parchment' ? [id, `${id}-light` as PresetId] : [id]));
export const VEGETATION_LOOKS: readonly VegetationLook[] = ['none', 'symbols', 'painted', 'procedural-canopy'];
/** Close-zoom detail of the procedural crowns: the leaf-clump relief of the elven town crowns (render/crownClumpAtlas.ts). */
export { CROWN_DETAILS, DEFAULT_CROWN_DETAIL, type CrownDetail } from './crownClumpAtlas';
/** The crown detail every page draws: the recipe's, else the default. Presets leave it unset (the default). */
export const crownDetailOf = (c: Pick<CompositionRecipe, 'vegetation'> | undefined): CrownDetail => c?.vegetation.crownDetail ?? DEFAULT_CROWN_DETAIL;
export const SEMANTIC_LOOKS: readonly SemanticLook[] = ['off', 'subtle', 'categorical', 'outlines'];
export const SEMANTIC_DEPTHS: readonly SemanticDepth[] = ['surface', 'readable'];
export const NETWORK_LOOKS: readonly NetworkLook[] = ['inherit', 'ink', 'natural', 'wash'];
export const BUILDING_LOOKS: readonly BuildingLook[] = ['footprints', 'cartographic-roofs', 'simple-volumes', 'detailed-volumes'];
export const AMBIENCES: readonly Ambience[] = ['day', 'night'];
export const CONTOUR_DETAILS: readonly ContourDetail[] = ['fixed', 'zoom'];
/** Contour behaviour of a recipe: the V1 fixed set unless the recipe asks for the per-zoom one. */
export const contourDetailOf = (c: Pick<CompositionRecipe, 'ground'> | undefined): ContourDetail => c?.ground.contourDetail ?? 'fixed';
/** Topographic and parchment contours retain a fixed physical interval; a cadastre carries half the lines, fainter (a hint of relief, not a survey sheet). */
export function contourDrawOf(c: Pick<CompositionRecipe, 'ground'> | undefined): { detail: ContourDetail; sparse: boolean; opacity: number } {
  const look = c?.ground.look,
    cadastre = look === 'cadastre';
  return { detail: look === 'topographic' || look === 'parchment' ? 'fixed' : contourDetailOf(c), sparse: cadastre, opacity: cadastre ? 0.55 : 1 };
}
export const LAND_KINDS: readonly LandKind[] = ['field', 'meadow', 'pasture', 'forest', 'orchard', 'garden', 'marsh', 'commons'];
/** The historical styles live on as variants of a base look; the first one is the look's default. */
export const GROUND_VARIANTS: Readonly<Record<StyleId, readonly TerrainStyle[]>> = {
  minimal: ['minimal'],
  atlas: ['atlas'],
  parchment: ['parchment', 'engraving', 'illuminated'],
  'satellite-2': ['parchment-render'],
  cadastre: ['cadastre', 'watabou', 'blueprint'],
  topographic: ['topographic'],
  illustration: ['fantasy-color', 'fantasy-ink'],
  satellite: ['render-v2', 'render3d', 'render3d-brush', 'render', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow'],
};
export const lookOfVariant = (variant: TerrainStyle): StyleId => (variant === 'night' ? 'atlas' : (STYLE_IDS.find(look => GROUND_VARIANTS[look].includes(variant)) ?? 'parchment'));

/** Coastal swell and surf of the satellite seas when a recipe does not say. */
export const COAST_WAVES_DEFAULT = true;

/** Global effects: they apply on top of any style. */
export interface RenderEffects {
  ambience: Ambience;
  /** 0-1 annual cycle. */ season: number;
  relief: boolean;
  lighting: TerrainLighting;
  /** Edits of the zone's year; an absent field keeps the zone's value. */ calendar?: SeasonCalendar;
  /** 3D Underdark display (render/underdarkCavern.ts); an absent field keeps its default. */ underdark?: Partial<UnderdarkCavern3d>;
}

/** The persisted recipe. Every field is explicit: a preset writes all of them. */
export interface CompositionRecipe {
  /** Last preset applied; 'custom' once a pass was changed by hand. */
  preset: PresetId | 'custom';
  /** Live display tier; captures always use full quality. Absent means full. */
  quality?: ResolvedDisplayQuality;
  ground: { look: StyleId; /** Concrete style, one of GROUND_VARIANTS[look]. */ variant: TerrainStyle; contours: boolean; /** `fixed` (absent): the V1 set, traced once, thin and dense from the start; `zoom`: re-selected per zoom band. */ contourDetail?: ContourDetail };
  vegetation: { look: VegetationLook; /** Forest class of the land-use plan: dark marked green or the ground colour. */ forestTone: LanduseForestTone; /** Close-zoom detail of the procedural crowns; absent means DEFAULT_CROWN_DETAIL. */ crownDetail?: CrownDetail };
  landuse: { rural: SemanticLook; urban: SemanticLook; /** 0–1, on the semantic layer only. */ opacity: number; depth: SemanticDepth; /** Rural classes shown by the semantic layer; absent = shown. */ classes?: Partial<Record<LandKind, boolean>> };
  networks: {
    roads: { visible: boolean; look: NetworkLook; /** 0.5–1.5: contrast of the roads against their ground. */ emphasis: number; /** Plan look (absent) or painted surface; the painted surface applies on material grounds only. */ surface?: RoadSurfaceMode };
    water: { visible: boolean; look: NetworkLook; /** Swell crests and surf along exposed sea coasts on the satellite grounds; absent = COAST_WAVES_DEFAULT. */ waves?: boolean };
  };
  buildings: { visible: boolean; look: BuildingLook; roof?: RoofMode; parcels: boolean; blocks: boolean; districts: boolean };
  text: TextSettings;
  annotations: { legend: boolean; cartouche: boolean };
  effects: RenderEffects;
}

interface PresetValues {
  blocks?: boolean;
  ground: StyleId;
  contours: boolean;
  vegetation: VegetationLook;
  rural: SemanticLook;
  urban: SemanticLook;
  depth: SemanticDepth;
  network: NetworkLook;
  building: BuildingLook;
  parcels: boolean;
  text: TextSettings;
}
/** Hides every text group but the listed ones. */
const only = (...shown: TextGroup[]) => Object.fromEntries(TEXT_GROUPS.map(g => [g, shown.includes(g)])) as Record<TextGroup, boolean>;
const PRESETS: Readonly<Record<StyleId, PresetValues>> = {
  minimal: { ground: 'minimal', contours: true, vegetation: 'none', rural: 'off', urban: 'off', depth: 'surface', network: 'ink', building: 'footprints', parcels: false, text: defaultText({ look: 'sans', groups: only('places') }) },
  // A physical-geography plate: hypsometric tints, relief, water and names; no land-use zones (woods are a faint wash, cityOverlayLandKinds).
  atlas: { blocks: false, ground: 'atlas', contours: false, vegetation: 'none', rural: 'off', urban: 'off', depth: 'surface', network: 'inherit', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'sans' }) },
  'satellite-2': { blocks: false, ground: 'satellite-2', contours: true, vegetation: 'procedural-canopy', rural: 'off', urban: 'off', depth: 'surface', network: 'wash', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'inherit' }) },
  parchment: { ground: 'parchment', contours: true, vegetation: 'symbols', rural: 'off', urban: 'off', depth: 'surface', network: 'wash', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'inherit' }) },
  // Rural land use lives in the brushes (crops, orchards, heath, woods) over a painted wash, not in vector polygons.
  illustration: { ground: 'illustration', contours: false, vegetation: 'painted', rural: 'off', urban: 'subtle', depth: 'surface', network: 'inherit', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'inherit' }) },
  cadastre: { ground: 'cadastre', contours: false, vegetation: 'none', rural: 'categorical', urban: 'categorical', depth: 'readable', network: 'ink', building: 'footprints', parcels: true, text: defaultText({ look: 'sans', groups: only('city', 'landmarks', 'pins') }) },
  topographic: {
    blocks: false,
    ground: 'topographic',
    contours: true,
    vegetation: 'none',
    rural: 'outlines',
    urban: 'off',
    depth: 'readable',
    network: 'ink',
    building: 'footprints',
    parcels: false,
    text: defaultText({ look: 'sans', groups: only('places', 'water', 'nature', 'pins'), density: 'high' }),
  },
  satellite: { blocks: false, ground: 'satellite', contours: false, vegetation: 'procedural-canopy', rural: 'off', urban: 'off', depth: 'surface', network: 'natural', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'sans', halo: 'strong' }) },
};
/** Styles kept in the code but removed from every selector until they are tuned: the single switch. */
export const HIDDEN_STYLE_IDS: readonly StyleId[] = ['illustration'];
/** Minimal is exclusive to the dedicated V2 renderer until benches can share its retained input. */
export const styleAvailableOnPage = (id: string, page: 'v2' | 'bench'): boolean => page === 'v2' || id !== 'minimal';
export const isHiddenPreset = (id: PresetId): boolean => (HIDDEN_STYLE_IDS as readonly string[]).includes(id);
/** A saved recipe that asks for a hidden style falls back to the default preset. */
export function withoutHiddenStyle(recipe: CompositionRecipe | undefined): CompositionRecipe | undefined {
  return recipe && (HIDDEN_STYLE_IDS.includes(recipe.ground.look) || isHiddenPreset(recipe.preset as PresetId)) ? presetComposition('parchment') : recipe;
}
/** A fresh recipe filled by a preset. */
export function presetComposition(id: PresetId): CompositionRecipe {
  const base = id === 'satellite-light' ? 'satellite' : id === 'parchment-light' ? 'parchment' : id;
  const p = PRESETS[base];
  return {
    preset: id,
    quality: id === base ? 'full' : 'light',
    ground: { look: p.ground, variant: GROUND_VARIANTS[p.ground][0], contours: p.contours },
    vegetation: { look: p.vegetation, forestTone: 'marked' },
    landuse: { rural: p.rural, urban: p.urban, opacity: 0.4, depth: p.depth, ...(id === 'topographic' ? { classes: Object.fromEntries(LAND_KINDS.map(kind => [kind, kind === 'field'])) } : {}) },
    networks: { roads: { visible: true, look: p.network, emphasis: 1, surface: base === 'satellite' || base === 'satellite-2' ? 'rendered' : 'plan' }, water: { visible: true, look: base === 'satellite-2' ? 'natural' : p.network === 'wash' ? 'ink' : p.network } },
    buildings: { visible: true, look: p.building, roof: DEFAULT_ROOF_MODE, parcels: p.parcels, blocks: p.blocks ?? true, districts: false },
    text: structuredClone(p.text),
    annotations: { legend: false, cartouche: false },
    effects: { ambience: 'day', season: 0.5, relief: id !== 'topographic' && id !== 'minimal', lighting: { ...DEFAULT_TERRAIN_LIGHTING } },
  };
}

/** Change only the display tier, preserving every pass and any advanced customization. */
export function withCompositionQuality(c: CompositionRecipe, quality: ResolvedDisplayQuality): CompositionRecipe {
  const base = c.preset === 'satellite-light' ? 'satellite' : c.preset === 'parchment-light' ? 'parchment' : c.preset;
  const preset = quality === 'light' && (base === 'satellite' || base === 'parchment') ? (`${base}-light` as PresetId) : base;
  return { ...c, preset, quality };
}

/** One choice the current backend cannot honour. The recipe keeps the choice; the UI shows the reason. */
export interface Limitation {
  pass: 'ground' | 'vegetation' | 'landuse' | 'networks' | 'buildings' | 'annotations' | 'text' | 'ambience';
  kind: 'backend' | 'data';
  reason: string;
  /** Optional precise control, relative to appearance. */ field?: string;
}
/** The composition as each pass reads it: concrete, for one target. */
export interface ResolvedComposition {
  readonly recipe: Readonly<CompositionRecipe>;
  /** Ground style actually drawn (the night palette under a night ambience on map grounds). */
  readonly variant: TerrainStyle;
  readonly vegetation: {
    readonly look: VegetationLook;
    readonly forestTone: LanduseForestTone;
    /** The procedural canopy shows: the GPU shader, or its raster on a CPU ground (Illustrated, relief hidden). */ readonly procedural: boolean;
    /** The vector overlay draws the vegetation classes (forest, meadow, marsh, commons). */ readonly cartographic: boolean;
    /** Painted brushes on the vector overlay. */ readonly painted: boolean;
    /** An Illustrated ground paints its forest brushes: its own form of the `painted` look. */ readonly groundForests: boolean;
    /** Close-zoom detail of the procedural broadleaf and orchard crowns (crownDetailOf: the default when unset). */ readonly crownDetail: CrownDetail;
  };
  readonly landuse: { readonly rural: SemanticLook; readonly urban: SemanticLook; readonly opacity: number; readonly depth: SemanticDepth; readonly classes: Readonly<Record<LandKind, boolean>> };
  readonly networks: { readonly roads: { readonly visible: boolean; readonly look: RoadLook; readonly emphasis: number }; readonly water: { readonly visible: boolean; readonly look: 'ink' | 'natural'; readonly waves: boolean } };
  readonly buildings: {
    readonly visible: boolean;
    readonly look: BuildingLook;
    readonly roof: RoofMode;
    /** What the 3D view raises from the ground. */
    readonly meshes: 'none' | 'simple' | 'detailed';
    readonly parcels: boolean;
    readonly blocks: boolean;
    readonly districts: boolean;
  };
  readonly text: Readonly<TextSettings>;
  readonly ambience: Ambience;
  readonly limitations: readonly Limitation[];
}

const BUILDING_2D: Readonly<Record<BuildingLook, { style: UrbanBuildingStyle; painted: boolean; meshes: 'none' | 'simple' | 'detailed' }>> = {
  footprints: { style: 'silhouette', painted: false, meshes: 'none' },
  'cartographic-roofs': { style: 'cartographic', painted: false, meshes: 'simple' },
  'simple-volumes': { style: 'geometric', painted: false, meshes: 'simple' },
  'detailed-volumes': { style: 'cartographic', painted: true, meshes: 'detailed' },
};
const effectiveVariant = (c: CompositionRecipe, underdark = false): TerrainStyle => (!underdark && c.ground.look !== 'minimal' && c.effects.ambience === 'night' && styleTraits(c.ground.variant).family === 'map' ? 'night' : c.ground.variant);
const networkLook = (look: NetworkLook, traits: StyleTraits): RoadLook => (look === 'inherit' ? (traits.family === 'material' ? 'natural' : 'ink') : look);
const waterLook = (look: NetworkLook, traits: StyleTraits): 'ink' | 'natural' => {
  const resolved = networkLook(look, traits);
  return resolved === 'wash' ? 'ink' : resolved === 'rendered' ? 'natural' : resolved;
};
/** The road look actually drawn: the painted surface on a material ground when the recipe asks for it, else the plan look. */
const roadLookOf = (roads: CompositionRecipe['networks']['roads'], traits: StyleTraits): RoadLook => (roads.surface === 'rendered' && traits.family === 'material' ? 'rendered' : networkLook(roads.look, traits));
/** The top-bar state of a recipe. */
export const roadDisplayOf = (c: Pick<CompositionRecipe, 'networks'>): RoadDisplay => (!c.networks.roads.visible ? 'none' : c.networks.roads.surface === 'rendered' ? 'rendered' : 'plan');
/** Whether a recipe's ground can draw the painted surface (a vector style falls back to its plan look). */
export const roadRenderAvailable = (c: Pick<CompositionRecipe, 'ground' | 'effects'>): boolean => styleTraits(effectiveVariant(c as CompositionRecipe)).family === 'material';
/** `painted` on an Illustrated ground is the ground's own forest brushes, never the overlay's. */
const overlayPainted = (look: VegetationLook, traits: StyleTraits): boolean => look === 'painted' && !traits.fantasy;
const vectorVegetation = (look: VegetationLook, traits: StyleTraits): boolean => look === 'symbols' || overlayPainted(look, traits);

/** The low-level appearance a recipe stands for. Advanced fields not driven by the recipe stay as they are. */
export function applyComposition(a: AppearanceInput, c: CompositionRecipe, underdark = false): AppearanceInput {
  const variant = effectiveVariant(c, underdark),
    traits = styleTraits(variant),
    building = BUILDING_2D[c.buildings.look];
  const roads = roadLookOf(c.networks.roads, traits);
  const { enabled: _enabled, ...forest } = a.forest ?? {};
  const { ground: _ground, ...city } = a.city ?? {};
  // The map overlay follows the ambience on any ground: day-coloured fields on a night ground would float above it.
  // Parchment woods are dense hand-drawn crowns (canopy.ts) over a soft wash, in the ink of the sheet.
  const parchmentTrees = variant === 'parchment' ? { vegetation: 'canopy' as const } : {};
  return {
    ...a,
    ...parchmentTrees,
    style: isMapStyle(variant) ? variant : !underdark && c.effects.ambience === 'night' ? 'night' : traits.paperMap ? 'parchment' : a.style,
    terrainStyle: variant,
    renderer: 'bench',
    contours: c.ground.look !== 'atlas' && c.ground.contours,
    terrainLayers: { ...DEFAULT_TERRAIN_LAYERS, ...a.terrainLayers, relief: c.effects.relief, water: c.networks.water.visible },
    // The land-use painter is the physical look of the fields on a map ground: the semantic layer never switches it off.
    landuse: variant !== 'topographic',
    painted: overlayPainted(c.vegetation.look, traits),
    forest: c.vegetation.look === 'procedural-canopy' ? forest : { ...forest, enabled: false },
    roads: c.networks.roads.visible,
    buildings: c.buildings.visible,
    labels: c.text.visible,
    legend: c.annotations.legend,
    cartouche: c.annotations.cartouche,
    // A physical ground takes physical stone, earth and roofs: parchment inks would float over it.
    city: {
      ...city,
      ...(traits.family === 'material' && !traits.paperMap ? { palette: 'terrain' as const } : {}),
      buildingStyle: building.style,
      painted: building.painted,
      groundBlend: roads === 'ink' ? 'classic' : 'blended',
      layers: {
        ...city.layers,
        ...(variant === 'topographic' ? { domains: false, gardens: false, places: false } : {}),
        parcelOverlay: c.buildings.parcels,
        parcels: c.buildings.parcels,
        lotEnclosures: c.buildings.visible && city.layers?.lotEnclosures !== false,
        blocks: c.buildings.blocks,
        quarters: c.buildings.districts,
      },
    },
  };
}

function limitationsOf(c: CompositionRecipe, traits: StyleTraits, target: RenderTarget, capabilities: RenderCapabilities): Limitation[] {
  const out: Limitation[] = [];
  if (c.buildings.parcels && capabilities.parcels === false) out.push({ pass: 'buildings', kind: 'data', reason: 'No parcels in the retained products.' });
  if (capabilities.ruralLanduse === false) out.push({ pass: 'landuse', kind: 'data', field: 'composition.landuse.rural', reason: 'No rural land-use polygons in the retained products.' });
  if (capabilities.urbanLanduse === false) out.push({ pass: 'landuse', kind: 'data', field: 'composition.landuse.urban', reason: 'No urban land-use polygons in the retained products.' });
  if (capabilities.buildings === false) out.push({ pass: 'buildings', kind: 'data', reason: 'No buildings in the retained products.' });
  out.push(...(capabilities.limitations ?? []));
  return out;
}

/** The composition of one target. Callers without a recipe retain the neutral pass configuration. */
export function resolveComposition(recipe: CompositionRecipe | undefined, traits: StyleTraits, target: RenderTarget, capabilities: RenderCapabilities, underdark = false): ResolvedComposition {
  const c = recipe ?? presetComposition('parchment'),
    classes = Object.fromEntries(LAND_KINDS.map(kind => [kind, c.landuse.classes?.[kind] !== false])) as Record<LandKind, boolean>;
  const look = c.vegetation.look;
  const buildingLook: BuildingLook =
    target !== 'view3d'
      ? c.ground.variant === 'minimal' || c.ground.variant === 'cadastre' || c.ground.variant === 'topographic'
        ? 'footprints'
        : 'detailed-volumes'
      : // Cadastre is a ground diagram in perspective too; other map tiers retain their 3D architecture.
        c.ground.variant === 'cadastre'
        ? 'footprints'
        : c.buildings.look === 'footprints'
          ? 'detailed-volumes'
          : c.buildings.look;
  return Object.freeze({
    recipe: c,
    variant: recipe ? effectiveVariant(c, underdark) : c.ground.variant,
    vegetation: recipe
      ? { look, forestTone: c.vegetation.forestTone, procedural: look === 'procedural-canopy', cartographic: vectorVegetation(look, traits), painted: overlayPainted(look, traits), groundForests: look === 'painted', crownDetail: crownDetailOf(c) }
      : { look, forestTone: c.vegetation.forestTone, procedural: traits.ground3d, cartographic: traits.cartographicVegetation, painted: false, groundForests: true, crownDetail: crownDetailOf(c) },
    landuse: { rural: recipe ? c.landuse.rural : 'off', urban: recipe && c.ground.look !== 'atlas' ? c.landuse.urban : 'off', opacity: c.landuse.opacity, depth: c.landuse.depth, classes },
    networks: {
      roads: { visible: c.networks.roads.visible, look: roadLookOf(c.networks.roads, traits), emphasis: c.networks.roads.emphasis },
      water: { visible: c.networks.water.visible, look: waterLook(c.networks.water.look, traits), waves: c.networks.water.waves ?? COAST_WAVES_DEFAULT },
    },
    buildings: { visible: c.buildings.visible, look: buildingLook, roof: c.buildings.roof ?? DEFAULT_ROOF_MODE, meshes: recipe ? BUILDING_2D[buildingLook].meshes : 'detailed', parcels: c.buildings.parcels, blocks: c.buildings.blocks, districts: c.buildings.districts },
    text: c.text,
    ambience: !underdark && c.ground.look === 'minimal' ? 'day' : c.effects.ambience,
    limitations: Object.freeze(recipe ? limitationsOf(c, traits, target, capabilities) : []),
  });
}

/** One manual change: the variant follows the look, the preset becomes 'custom', the other passes stay. */
export function withGroundVariant(c: CompositionRecipe, variant: TerrainStyle): CompositionRecipe {
  const look = lookOfVariant(variant);
  return { ...c, preset: 'custom', ground: { ...c.ground, look, variant: variant === 'night' ? GROUND_VARIANTS.atlas[0] : variant }, effects: { ...c.effects, ambience: variant === 'night' ? 'night' : c.effects.ambience } };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const oneOf = (value: unknown, choices: readonly unknown[], name: string): void => {
  if (!choices.includes(value)) throw new Error(`appearance.composition.${name}: unknown value.`);
};
const flags = (value: unknown, keys: readonly string[], name: string): void => {
  if (!record(value)) throw new Error(`appearance.composition.${name}: expected an object.`);
  for (const key of keys) if (typeof value[key] !== 'boolean') throw new Error(`appearance.composition.${name}.${key}: expected a boolean.`);
};
const inRange = (value: unknown, min: number, max: number, name: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`appearance.composition.${name}: expected a number in ${min}–${max}.`);
};
function validateEffects(value: unknown): void {
  if (!record(value)) throw new Error('appearance.composition.effects: expected an object.');
  oneOf(value.ambience, AMBIENCES, 'effects.ambience');
  inRange(value.season, 0, 1, 'effects.season');
  if (typeof value.relief !== 'boolean') throw new Error('appearance.composition.effects.relief: expected a boolean.');
  const lighting = value.lighting;
  if (!record(lighting)) throw new Error('appearance.composition.effects.lighting: expected an object.');
  if (typeof lighting.enabled !== 'boolean') throw new Error('appearance.composition.effects.lighting.enabled: expected a boolean.');
  for (const [key, min, max] of [
    ['azimuth', 0, 360],
    ['elevation', 5, 90],
    ['strength', 0, 3],
    ['exaggeration', 0, 10],
  ] as const)
    inRange(lighting[key], min, max, `effects.lighting.${key}`);
  if (value.underdark !== undefined) {
    if (!record(value.underdark)) throw new Error('appearance.composition.effects.underdark: expected an object.');
    for (const [key, v] of Object.entries(value.underdark)) {
      const range = UNDERDARK_CAVERN_LIMITS[key as keyof typeof UNDERDARK_CAVERN_LIMITS];
      if (!range) throw new Error(`appearance.composition.effects.underdark.${key}: unknown field.`);
      if (v !== undefined && v !== null) inRange(v, range[0], range[1], `effects.underdark.${key}`);
    }
  }
  if (value.calendar === undefined) return;
  if (!record(value.calendar)) throw new Error('appearance.composition.effects.calendar: expected an object.');
  const calendar = value.calendar;
  for (const key of Object.keys(calendar)) {
    const field = SEASON_CALENDAR_FIELDS.find(entry => entry.key === key);
    if (!field) throw new Error(`appearance.composition.effects.calendar.${key}: unknown field.`);
    if (calendar[key] !== undefined && calendar[key] !== null) inRange(calendar[key], field.min, field.max, `effects.calendar.${key}`);
  }
}
export function validateComposition(value: unknown): asserts value is CompositionRecipe {
  if (!record(value)) throw new Error('appearance.composition: expected an object.');
  oneOf(value.preset, [...PRESET_IDS, 'custom'], 'preset');
  if (value.quality !== undefined) oneOf(value.quality, ['full', 'light'], 'quality');
  const { effects, ground, vegetation, landuse, networks, buildings, annotations, text } = value as Record<string, Record<string, unknown>>;
  validateEffects(effects);
  flags(ground, ['contours'], 'ground');
  oneOf(ground.look, STYLE_IDS, 'ground.look');
  if (ground.contourDetail !== undefined) oneOf(ground.contourDetail, CONTOUR_DETAILS, 'ground.contourDetail');
  if (typeof ground.variant !== 'string' || !isTerrainStyle(ground.variant)) throw new Error('appearance.composition.ground.variant: unknown style.');
  if (!record(vegetation)) throw new Error('appearance.composition.vegetation: expected an object.');
  oneOf(vegetation.look, VEGETATION_LOOKS, 'vegetation.look');
  oneOf(vegetation.forestTone, ['ground', 'marked'], 'vegetation.forestTone');
  if (vegetation.crownDetail !== undefined) oneOf(vegetation.crownDetail, CROWN_DETAILS, 'vegetation.crownDetail');
  if (!record(landuse)) throw new Error('appearance.composition.landuse: expected an object.');
  oneOf(landuse.rural, SEMANTIC_LOOKS, 'landuse.rural');
  oneOf(landuse.urban, SEMANTIC_LOOKS, 'landuse.urban');
  oneOf(landuse.depth, SEMANTIC_DEPTHS, 'landuse.depth');
  if (typeof landuse.opacity !== 'number' || !(landuse.opacity >= 0 && landuse.opacity <= 1)) throw new Error('appearance.composition.landuse.opacity: expected a number in 0–1.');
  if (!record(networks)) throw new Error('appearance.composition.networks: expected an object.');
  for (const key of ['roads', 'water'] as const) {
    flags(networks[key], ['visible'], `networks.${key}`);
    oneOf((networks[key] as Record<string, unknown>).look, NETWORK_LOOKS, `networks.${key}.look`);
  }
  const waves = (networks.water as Record<string, unknown>).waves;
  if (waves !== undefined && typeof waves !== 'boolean') throw new Error('appearance.composition.networks.water.waves: expected a boolean.');
  const emphasis = (networks.roads as Record<string, unknown>).emphasis,
    surface = (networks.roads as Record<string, unknown>).surface;
  if (surface !== undefined) oneOf(surface, ROAD_SURFACE_MODES, 'networks.roads.surface');
  if (typeof emphasis !== 'number' || !(emphasis >= 0.5 && emphasis <= 1.5)) throw new Error('appearance.composition.networks.roads.emphasis: expected a number in 0.5–1.5.');
  flags(buildings, ['visible', 'parcels', 'blocks', 'districts'], 'buildings');
  oneOf(buildings.look, BUILDING_LOOKS, 'buildings.look');
  if (buildings.roof !== undefined) oneOf(buildings.roof, ROOF_MODES, 'buildings.roof');
  flags(annotations, ['legend', 'cartouche'], 'annotations');
  flags(text, ['visible'], 'text');
  flags(text.groups, TEXT_GROUPS, 'text.groups');
  oneOf(text.look, ['inherit', 'serif', 'sans'], 'text.look');
  oneOf(text.density, ['low', 'normal', 'high'], 'text.density');
  oneOf(text.halo, ['inherit', 'strong'], 'text.halo');
  if (text.amount !== undefined) oneOf(text.amount, TEXT_AMOUNTS, 'text.amount');
  if (typeof text.size !== 'number' || !(text.size >= 0.6 && text.size <= 1.8)) throw new Error('appearance.composition.text.size: expected a number in 0.6–1.8.');
  if (text.levels !== undefined) {
    if (!record(text.levels)) throw new Error('appearance.composition.text.levels: expected an object.');
    for (const [key, level] of Object.entries(text.levels)) if (!(NAME_LEVELS as readonly string[]).includes(key) || typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 100) throw new Error('appearance.composition.text.levels: expected values in 0–100.');
  }
}
