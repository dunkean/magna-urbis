/**
 * Render composition: what the user picks, pass by pass. A preset only fills this recipe; changing one
 * pass leaves the others alone. No field here is decided by the ground: `styleTraits` may declare what a
 * backend can do (see `limitations`), it never hides semantic data.
 * Pure module: no DOM, no engine, no I/O.
 */
import { SEASON_CALENDAR_FIELDS, type SeasonCalendar } from '../../../rust/bridge/terrainRenderV2Zones';
import { TEXT_GROUPS, defaultText, type TextGroup, type TextSettings } from './textLayer';
import type { LandKind } from '../gen/types';
import { isMapStyle } from './styles';
import { isTerrainStyle, styleTraits, type StyleTraits, type TerrainStyle } from './terrainStyle';
import { DEFAULT_TERRAIN_LAYERS, DEFAULT_TERRAIN_LIGHTING, type TerrainLighting } from './terrainLighting';
import type { LanduseForestTone } from './landuseForestTone';
import type { AppearanceInput, RenderCapabilities, RenderTarget } from './appearanceRecipe';
import type { UrbanBuildingStyle } from './urbanBuildingStyle';

/** The six render styles: used both as presets and as the base look of the ground. */
export type StyleId = 'atlas' | 'cadastre' | 'topographic' | 'satellite' | 'satellite-2' | 'parchment' | 'illustration';
export type VegetationLook = 'none' | 'symbols' | 'painted' | 'procedural-canopy';
export type SemanticLook = 'off' | 'subtle' | 'categorical' | 'outlines';
export type SemanticDepth = 'surface' | 'readable';
export type NetworkLook = 'inherit' | 'ink' | 'natural' | 'wash';
/** How a road network is drawn: `wash` is the translucent earth of the parchment map (groundBlend.ts), roads only. */
export type RoadLook = 'ink' | 'natural' | 'wash';
export type BuildingLook = 'footprints' | 'cartographic-roofs' | 'simple-volumes' | 'detailed-volumes';
export type Ambience = 'day' | 'night';

export const STYLE_IDS: readonly StyleId[] = ['atlas', 'cadastre', 'topographic', 'satellite', 'satellite-2', 'parchment', 'illustration'];
export const VEGETATION_LOOKS: readonly VegetationLook[] = ['none', 'symbols', 'painted', 'procedural-canopy'];
export const SEMANTIC_LOOKS: readonly SemanticLook[] = ['off', 'subtle', 'categorical', 'outlines'];
export const SEMANTIC_DEPTHS: readonly SemanticDepth[] = ['surface', 'readable'];
export const NETWORK_LOOKS: readonly NetworkLook[] = ['inherit', 'ink', 'natural', 'wash'];
export const BUILDING_LOOKS: readonly BuildingLook[] = ['footprints', 'cartographic-roofs', 'simple-volumes', 'detailed-volumes'];
export const AMBIENCES: readonly Ambience[] = ['day', 'night'];
export const LAND_KINDS: readonly LandKind[] = ['field', 'meadow', 'pasture', 'forest', 'orchard', 'garden', 'marsh', 'commons'];
/** The historical styles live on as variants of a base look; the first one is the look's default. */
export const GROUND_VARIANTS: Readonly<Record<StyleId, readonly TerrainStyle[]>> = {
  atlas: ['atlas'], parchment: ['parchment', 'engraving', 'illuminated'], 'satellite-2': ['parchment-render'], cadastre: ['cadastre', 'watabou', 'blueprint'], topographic: ['topographic'], illustration: ['fantasy-color', 'fantasy-ink'],
  satellite: ['render-v2', 'render3d', 'render3d-brush', 'render', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow'],
};
export const lookOfVariant = (variant: TerrainStyle): StyleId => variant === 'night' ? 'atlas' : STYLE_IDS.find(look => GROUND_VARIANTS[look].includes(variant)) ?? 'parchment';

/** Global effects: they apply on top of any style. */
export interface RenderEffects { ambience: Ambience; /** 0-1 annual cycle. */ season: number; relief: boolean; lighting: TerrainLighting;
  /** Edits of the zone's year; an absent field keeps the zone's value. */ calendar?: SeasonCalendar }

/** The persisted recipe. Every field is explicit: a preset writes all of them. */
export interface CompositionRecipe {
  /** Last preset applied; 'custom' once a pass was changed by hand. */
  preset: StyleId | 'custom';
  ground: { look: StyleId; /** Concrete style, one of GROUND_VARIANTS[look]. */ variant: TerrainStyle; contours: boolean };
  vegetation: { look: VegetationLook; /** Forest class of the land-use plan: dark marked green or the ground colour. */ forestTone: LanduseForestTone };
  landuse: {
    rural: SemanticLook; urban: SemanticLook; /** 0–1, on the semantic layer only. */ opacity: number; depth: SemanticDepth;
    /** Rural classes shown by the semantic layer; absent = shown. */ classes?: Partial<Record<LandKind, boolean>>;
  };
  networks: { roads: { visible: boolean; look: NetworkLook; /** 0.5–1.5: contrast of the roads against their ground. */ emphasis: number }; water: { visible: boolean; look: NetworkLook } };
  buildings: { visible: boolean; look: BuildingLook; parcels: boolean; blocks: boolean; districts: boolean };
  text: TextSettings;
  annotations: { legend: boolean; cartouche: boolean };
  effects: RenderEffects;
}

interface PresetValues { blocks?: boolean; ground: StyleId; contours: boolean; vegetation: VegetationLook; rural: SemanticLook; urban: SemanticLook; depth: SemanticDepth; network: NetworkLook; building: BuildingLook; parcels: boolean; text: TextSettings }
/** Hides every text group but the listed ones. */
const only = (...shown: TextGroup[]) => Object.fromEntries(TEXT_GROUPS.map(g => [g, shown.includes(g)])) as Record<TextGroup, boolean>;
const PRESETS: Readonly<Record<StyleId, PresetValues>> = {
  atlas: { ground: 'atlas', contours: true, vegetation: 'symbols', rural: 'off', urban: 'subtle', depth: 'surface', network: 'inherit', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'sans' }) },
  'satellite-2': { blocks: false, ground: 'satellite-2', contours: true, vegetation: 'procedural-canopy', rural: 'off', urban: 'off', depth: 'surface', network: 'wash', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'inherit' }) },
  parchment: { ground: 'parchment', contours: true, vegetation: 'symbols', rural: 'off', urban: 'off', depth: 'surface', network: 'wash', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'inherit' }) },
  // Rural land use lives in the brushes (crops, orchards, heath, woods) over a painted wash, not in vector polygons.
  illustration: { ground: 'illustration', contours: false, vegetation: 'painted', rural: 'off', urban: 'subtle', depth: 'surface', network: 'inherit', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'inherit' }) },
  cadastre: { ground: 'cadastre', contours: false, vegetation: 'none', rural: 'categorical', urban: 'categorical', depth: 'readable', network: 'ink', building: 'footprints', parcels: true, text: defaultText({ look: 'sans', groups: only('city', 'landmarks', 'pins') }) },
  topographic: { blocks: false, ground: 'topographic', contours: true, vegetation: 'none', rural: 'outlines', urban: 'off', depth: 'readable', network: 'ink', building: 'footprints', parcels: false, text: defaultText({ look: 'sans', groups: only('places', 'water', 'nature', 'pins'), density: 'high' }) },
  satellite: { blocks: false, ground: 'satellite', contours: false, vegetation: 'procedural-canopy', rural: 'off', urban: 'off', depth: 'surface', network: 'natural', building: 'detailed-volumes', parcels: false, text: defaultText({ look: 'sans', halo: 'strong' }) },
};
/** A fresh recipe filled by a preset. */
export function presetComposition(id: StyleId): CompositionRecipe {
  const p = PRESETS[id];
  return { preset: id, ground: { look: p.ground, variant: GROUND_VARIANTS[p.ground][0], contours: p.contours }, vegetation: { look: p.vegetation, forestTone: 'marked' },
    landuse: { rural: p.rural, urban: p.urban, opacity: .4, depth: p.depth, ...(id === 'topographic' ? { classes: Object.fromEntries(LAND_KINDS.map(kind => [kind, kind === 'field'])) } : {}) }, networks: { roads: { visible: true, look: p.network, emphasis: 1 }, water: { visible: true, look: p.network === 'wash' ? 'ink' : p.network } },
    buildings: { visible: true, look: p.building, parcels: p.parcels, blocks: p.blocks ?? true, districts: false }, text: structuredClone(p.text), annotations: { legend: false, cartouche: false },
    effects: { ambience: 'day', season: .5, relief: id !== 'topographic', lighting: { ...DEFAULT_TERRAIN_LIGHTING } } };
}

/** One choice the current backend cannot honour. The recipe keeps the choice; the UI shows the reason. */
export interface Limitation {
  pass: 'ground' | 'vegetation' | 'landuse' | 'networks' | 'buildings' | 'annotations' | 'text' | 'ambience';
  kind: 'backend' | 'data'; reason: string; /** Optional precise control, relative to appearance. */ field?: string;
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
  };
  readonly landuse: { readonly rural: SemanticLook; readonly urban: SemanticLook; readonly opacity: number; readonly depth: SemanticDepth; readonly classes: Readonly<Record<LandKind, boolean>> };
  readonly networks: { readonly roads: { readonly visible: boolean; readonly look: RoadLook; readonly emphasis: number }; readonly water: { readonly visible: boolean; readonly look: 'ink' | 'natural' } };
  readonly buildings: { readonly visible: boolean; readonly look: BuildingLook; /** What the 3D view raises from the ground. */ readonly meshes: 'none' | 'simple' | 'detailed'; readonly parcels: boolean; readonly blocks: boolean; readonly districts: boolean };
  readonly text: Readonly<TextSettings>;
  readonly ambience: Ambience;
  readonly limitations: readonly Limitation[];
}

const BUILDING_2D: Readonly<Record<BuildingLook, { style: UrbanBuildingStyle; painted: boolean; meshes: 'none' | 'simple' | 'detailed' }>> = {
  footprints: { style: 'silhouette', painted: false, meshes: 'none' }, 'cartographic-roofs': { style: 'cartographic', painted: false, meshes: 'simple' },
  'simple-volumes': { style: 'geometric', painted: false, meshes: 'simple' }, 'detailed-volumes': { style: 'cartographic', painted: true, meshes: 'detailed' },
};
const effectiveVariant = (c: CompositionRecipe): TerrainStyle => c.effects.ambience === 'night' && styleTraits(c.ground.variant).family === 'map' ? 'night' : c.ground.variant;
const networkLook = (look: NetworkLook, traits: StyleTraits): RoadLook => look === 'inherit' ? traits.family === 'material' ? 'natural' : 'ink' : look;
const waterLook = (look: NetworkLook, traits: StyleTraits): 'ink' | 'natural' => { const resolved = networkLook(look, traits); return resolved === 'wash' ? 'ink' : resolved; };
/** `painted` on an Illustrated ground is the ground's own forest brushes, never the overlay's. */
const overlayPainted = (look: VegetationLook, traits: StyleTraits): boolean => look === 'painted' && !traits.fantasy;
const vectorVegetation = (look: VegetationLook, traits: StyleTraits): boolean => look === 'symbols' || overlayPainted(look, traits);

/** The low-level appearance a recipe stands for. Advanced fields not driven by the recipe stay as they are. */
export function applyComposition(a: AppearanceInput, c: CompositionRecipe): AppearanceInput {
  const variant = effectiveVariant(c), traits = styleTraits(variant), building = BUILDING_2D[c.buildings.look];
  const roads = networkLook(c.networks.roads.look, traits);
  const { enabled: _enabled, ...forest } = a.forest ?? {};
  const { ground: _ground, ...city } = a.city ?? {};
  // The map overlay follows the ambience on any ground: day-coloured fields on a night ground would float above it.
  // Parchment woods are dense hand-drawn crowns (canopy.ts) over a soft wash, in the ink of the sheet.
  const parchmentTrees = variant === 'parchment' ? { vegetation: 'canopy' as const } : {};
  return { ...a, ...parchmentTrees, style: isMapStyle(variant) ? variant : c.effects.ambience === 'night' ? 'night' : traits.paperMap ? 'parchment' : a.style, terrainStyle: variant, renderer: 'bench', contours: c.ground.contours,
    terrainLayers: { ...DEFAULT_TERRAIN_LAYERS, ...a.terrainLayers, relief: c.effects.relief, water: c.networks.water.visible },
    // The land-use painter is the physical look of the fields on a map ground: the semantic layer never switches it off.
    landuse: variant !== 'topographic', painted: overlayPainted(c.vegetation.look, traits), forest:c.vegetation.look === 'procedural-canopy' ? forest : { ...forest, enabled: false },
    roads: c.networks.roads.visible, buildings: c.buildings.visible, labels: c.text.visible, legend: c.annotations.legend, cartouche: c.annotations.cartouche,
    // A physical ground takes physical stone, earth and roofs: parchment inks would float over it.
    city: { ...city, ...(traits.family === 'material' && !traits.paperMap ? { palette: 'terrain' as const } : {}), buildingStyle: building.style, painted: building.painted, groundBlend: roads === 'ink' ? 'classic' : 'blended',
      layers: { ...city.layers, ...(variant === 'topographic' ? { domains: false, gardens: false, places: false } : {}), parcelOverlay: c.buildings.parcels, parcels: c.buildings.parcels, lotEnclosures: c.buildings.parcels && city.layers?.lotEnclosures !== false, blocks: c.buildings.blocks, quarters: c.buildings.districts } } };
}

function limitationsOf(c: CompositionRecipe, traits: StyleTraits, target: RenderTarget, capabilities: RenderCapabilities): Limitation[] {
  const out: Limitation[] = [];
  if (c.buildings.parcels && capabilities.parcels === false) out.push({ pass: 'buildings', kind: 'data', reason: 'No parcels in the retained products.' });
  if (capabilities.ruralLanduse === false) out.push({ pass: 'landuse', kind: 'data', field: 'composition.landuse.rural', reason: 'No rural land-use polygons in the retained products.' });
  if (capabilities.urbanLanduse === false) out.push({ pass: 'landuse', kind: 'data', field: 'composition.landuse.urban', reason: 'No urban land-use polygons in the retained products.' });
  if (capabilities.buildings === false) out.push({ pass: 'buildings', kind: 'data', reason: 'No buildings in the retained products.' });
  out.push(...capabilities.limitations ?? []);
  return out;
}

/** The composition of one target. Callers without a recipe retain the neutral pass configuration. */
export function resolveComposition(recipe: CompositionRecipe | undefined, traits: StyleTraits, target: RenderTarget, capabilities: RenderCapabilities): ResolvedComposition {
  const c = recipe ?? presetComposition('parchment'), classes = Object.fromEntries(LAND_KINDS.map(kind => [kind, c.landuse.classes?.[kind] !== false])) as Record<LandKind, boolean>;
  const look = c.vegetation.look;
  const buildingLook: BuildingLook = target !== 'view3d'
    ? c.ground.variant === 'cadastre' || c.ground.variant === 'topographic' ? 'footprints' : 'detailed-volumes'
    // Flat map tiers never suppress architecture in a perspective view.
    : c.buildings.look === 'footprints' ? 'detailed-volumes' : c.buildings.look;
  return Object.freeze({ recipe: c, variant: recipe ? effectiveVariant(c) : c.ground.variant,
    vegetation: recipe ? { look, forestTone: c.vegetation.forestTone, procedural: look === 'procedural-canopy', cartographic: vectorVegetation(look, traits), painted: overlayPainted(look, traits), groundForests: look === 'painted' }
      : { look, forestTone: c.vegetation.forestTone, procedural: traits.ground3d, cartographic: traits.cartographicVegetation, painted: false, groundForests: true },
    landuse: { rural: recipe ? c.landuse.rural : 'off', urban: recipe ? c.landuse.urban : 'off', opacity: c.landuse.opacity, depth: c.landuse.depth, classes },
    networks: { roads: { visible: c.networks.roads.visible, look: networkLook(c.networks.roads.look, traits), emphasis: c.networks.roads.emphasis }, water: { visible: c.networks.water.visible, look: waterLook(c.networks.water.look, traits) } },
    buildings: { visible: c.buildings.visible, look: buildingLook, meshes: recipe ? BUILDING_2D[buildingLook].meshes : 'detailed', parcels: c.buildings.parcels, blocks: c.buildings.blocks, districts: c.buildings.districts },
    text: c.text, ambience: c.effects.ambience, limitations: Object.freeze(recipe ? limitationsOf(c, traits, target, capabilities) : []) });
}

/** One manual change: the variant follows the look, the preset becomes 'custom', the other passes stay. */
export function withGroundVariant(c: CompositionRecipe, variant: TerrainStyle): CompositionRecipe {
  const look = lookOfVariant(variant);
  return { ...c, preset: 'custom', ground: { ...c.ground, look, variant: variant === 'night' ? GROUND_VARIANTS.atlas[0] : variant }, effects: { ...c.effects, ambience: variant === 'night' ? 'night' : c.effects.ambience } };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const oneOf = (value: unknown, choices: readonly unknown[], name: string): void => { if (!choices.includes(value)) throw new Error(`appearance.composition.${name}: unknown value.`); };
const flags = (value: unknown, keys: readonly string[], name: string): void => {
  if (!record(value)) throw new Error(`appearance.composition.${name}: expected an object.`);
  for (const key of keys) if (typeof value[key] !== 'boolean') throw new Error(`appearance.composition.${name}.${key}: expected a boolean.`);
};
const inRange = (value: unknown, min: number, max: number, name: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`appearance.composition.${name}: expected a number in ${min}–${max}.`);
};
function validateEffects(value: unknown): void {
  if (!record(value)) throw new Error('appearance.composition.effects: expected an object.');
  oneOf(value.ambience, AMBIENCES, 'effects.ambience'); inRange(value.season, 0, 1, 'effects.season');
  if (typeof value.relief !== 'boolean') throw new Error('appearance.composition.effects.relief: expected a boolean.');
  const lighting = value.lighting;
  if (!record(lighting)) throw new Error('appearance.composition.effects.lighting: expected an object.');
  if (typeof lighting.enabled !== 'boolean') throw new Error('appearance.composition.effects.lighting.enabled: expected a boolean.');
  for (const [key, min, max] of [['azimuth', 0, 360], ['elevation', 5, 90], ['strength', 0, 3], ['exaggeration', 0, 10]] as const) inRange(lighting[key], min, max, `effects.lighting.${key}`);
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
  oneOf(value.preset, [...STYLE_IDS, 'custom'], 'preset');
  const { effects, ground, vegetation, landuse, networks, buildings, annotations, text } = value as Record<string, Record<string, unknown>>;
  validateEffects(effects); flags(ground, ['contours'], 'ground'); oneOf(ground.look, STYLE_IDS, 'ground.look');
  if (typeof ground.variant !== 'string' || !isTerrainStyle(ground.variant)) throw new Error('appearance.composition.ground.variant: unknown style.');
  if (!record(vegetation)) throw new Error('appearance.composition.vegetation: expected an object.');
  oneOf(vegetation.look, VEGETATION_LOOKS, 'vegetation.look'); oneOf(vegetation.forestTone, ['ground', 'marked'], 'vegetation.forestTone');
  if (!record(landuse)) throw new Error('appearance.composition.landuse: expected an object.');
  oneOf(landuse.rural, SEMANTIC_LOOKS, 'landuse.rural'); oneOf(landuse.urban, SEMANTIC_LOOKS, 'landuse.urban'); oneOf(landuse.depth, SEMANTIC_DEPTHS, 'landuse.depth');
  if (typeof landuse.opacity !== 'number' || !(landuse.opacity >= 0 && landuse.opacity <= 1)) throw new Error('appearance.composition.landuse.opacity: expected a number in 0–1.');
  if (!record(networks)) throw new Error('appearance.composition.networks: expected an object.');
  for (const key of ['roads', 'water'] as const) { flags(networks[key], ['visible'], `networks.${key}`); oneOf((networks[key] as Record<string, unknown>).look, NETWORK_LOOKS, `networks.${key}.look`); }
  const emphasis = (networks.roads as Record<string, unknown>).emphasis;
  if (typeof emphasis !== 'number' || !(emphasis >= .5 && emphasis <= 1.5)) throw new Error('appearance.composition.networks.roads.emphasis: expected a number in 0.5–1.5.');
  flags(buildings, ['visible', 'parcels', 'blocks', 'districts'], 'buildings'); oneOf(buildings.look, BUILDING_LOOKS, 'buildings.look');
  flags(annotations, ['legend', 'cartouche'], 'annotations');
  flags(text, ['visible'], 'text'); flags(text.groups, TEXT_GROUPS, 'text.groups');
  oneOf(text.look, ['inherit', 'serif', 'sans'], 'text.look'); oneOf(text.density, ['low', 'normal', 'high'], 'text.density'); oneOf(text.halo, ['inherit', 'strong'], 'text.halo');
  if (typeof text.size !== 'number' || !(text.size >= .6 && text.size <= 1.8)) throw new Error('appearance.composition.text.size: expected a number in 0.6–1.8.');
}
