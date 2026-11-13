import { CITY_GROUND_STYLES } from '../render/cityGroundModes';
export { CITY_GROUND_STYLES } from '../render/cityGroundModes';
/** Display-only validation and export preferences. This module never loads a generation engine. */
import { isMapStyle } from '../render/styles';
import { isTerrainStyle } from '../render/terrainStyle';
import { DIAGNOSTICS } from '../render/displayDiagnostics';
import { POTENTIAL_IDS } from '../../../rust/bridge/resources';
import { setLanduseForestTone } from '../render/landuseForestTone';
import { validateRenderColors } from '../render/customColors';
import type { CityLayers } from '../render/cityCanvas';
import type { DisplayOpts } from '../ui/protocol';
import type { VegetationStyle } from '../render/canopy';
import type { RenderOptions } from '../render/svg';
import type { SemanticLegendEntry } from '../render/legend';
import type { BrushSources } from '../render/brushes';
import type { V2Appearance, V2Settings } from './contracts';
import type { World } from '../gen/types';
import { resolveAppearance, type RenderTarget, type ResolveFlags, type ResolvedAppearance } from '../render/appearanceRecipe';
import { worldCapabilities } from './nativeProducts';
import { presetComposition, underdarkComposition, validateComposition, withoutHiddenStyle } from '../render/composition';

export const CITY_LAYER_NAMES = ['reserve', 'allocated', 'centers', 'domains', 'quarters', 'blocks', 'streets', 'enclosures', 'lotEnclosures', 'parcels', 'gardens', 'places', 'fronts', 'axes', 'access'] as const satisfies readonly (keyof CityLayers)[];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!record(value)) throw new Error(`${name}: expected an object.`);
}
function enumeration(value: unknown, choices: readonly unknown[], name: string): void {
  if (value !== undefined && !choices.includes(value)) throw new Error(`${name}: unknown value.`);
}
function boolean(value: unknown, name: string, required = false): void {
  if ((required || value !== undefined) && typeof value !== 'boolean') throw new Error(`${name}: expected a boolean.`);
}
function number(value: unknown, name: string, min: number, max: number, required = false): void {
  if ((required || value !== undefined) && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max))
    throw new Error(`${name}: expected a number in ${min}–${max}.`);
}
export function validateAppearance(value: unknown): asserts value is V2Appearance {
  object(value, 'appearance');
  if (value.composition !== undefined) validateComposition(value.composition);
  if (!isMapStyle(value.style as string)) throw new Error('appearance.style: unknown map palette.');
  if (value.terrainStyle !== undefined && (typeof value.terrainStyle !== 'string' || !isTerrainStyle(value.terrainStyle))) throw new Error('appearance.terrainStyle: unknown terrain style.');
  enumeration(value.renderer, ['classic', 'bench'], 'appearance.renderer');
  enumeration(value.vegetation, ['classic', 'canopy'], 'appearance.vegetation');
  enumeration(value.diagnostic, DIAGNOSTICS.map(diagnostic => diagnostic.id), 'appearance.diagnostic');
  enumeration(value.resourcePotential, POTENTIAL_IDS, 'appearance.resourcePotential');
  for (const key of ['contours', 'landuse', 'labels', 'legend', 'cartouche', 'textured', 'painted', 'lakes', 'oxbows', 'roads', 'buildings', 'unifiedDefaults']) boolean(value[key], `appearance.${key}`);
  if (value.colors !== undefined) validateRenderColors(value.colors);
  if (value.forest !== undefined) {
    object(value.forest, 'appearance.forest');
    boolean(value.forest.enabled, 'appearance.forest.enabled');
    number(value.forest.density, 'appearance.forest.density', 0, 2);
    number(value.forest.clearings, 'appearance.forest.clearings', 0, 1);
  }
  if (value.terrainLayers !== undefined) {
    object(value.terrainLayers, 'appearance.terrainLayers');
    for (const key of ['relief', 'hypsometry', 'frame'] as const) boolean(value.terrainLayers[key], `appearance.terrainLayers.${key}`, true);
    boolean(value.terrainLayers.water, 'appearance.terrainLayers.water');
  }
  if (value.fantasy !== undefined) {
    object(value.fantasy, 'appearance.fantasy');
    number(value.fantasy.density, 'appearance.fantasy.density', .3, 2, true);
    number(value.fantasy.size, 'appearance.fantasy.size', .1, 2, true);
    number(value.fantasy.spacing, 'appearance.fantasy.spacing', .3, 2, true);
    boolean(value.fantasy.followLanduse, 'appearance.fantasy.followLanduse');
  }
  if (value.city !== undefined) {
    object(value.city, 'appearance.city');
    enumeration(value.city.view, ['tissue', 'uses', 'parcels', 'buildings', 'roles'], 'appearance.city.view');
    enumeration(value.city.palette, ['growth', 'atlas', 'ink', 'terrain', 'parchment'], 'appearance.city.palette');
    enumeration(value.city.buildingStyle, ['geometric', 'cartographic', 'silhouette'], 'appearance.city.buildingStyle');
    enumeration(value.city.diagnostic, ['none', 'uses', 'height', 'access'], 'appearance.city.diagnostic');
    enumeration(value.city.groundBlend, ['classic', 'blended'], 'appearance.city.groundBlend');
    enumeration(value.city.ground, CITY_GROUND_STYLES, 'appearance.city.ground');
    enumeration(value.city.colors, ['materials', 'uses'], 'appearance.city.colors');
    enumeration(value.city.refinement, ['source', 'noise'], 'appearance.city.refinement');
    boolean(value.city.painted, 'appearance.city.painted'); boolean(value.city.plan, 'appearance.city.plan');
    number(value.city.opacity, 'appearance.city.opacity', 0, 1);
    number(value.city.width, 'appearance.city.width', 0, 5);
    number(value.city.exaggeration, 'appearance.city.exaggeration', 1, 5);
    if (value.city.layers !== undefined) {
      object(value.city.layers, 'appearance.city.layers');
      for (const [key, entry] of Object.entries(value.city.layers)) {
        if (!(CITY_LAYER_NAMES as readonly string[]).includes(key)) throw new Error(`appearance.city.layers.${key}: unknown layer.`);
        boolean(entry, `appearance.city.layers.${key}`, true);
      }
    }
  }
}

export interface V2ExportDisplay extends DisplayOpts { vegetation?: VegetationStyle; semanticLegend?: readonly SemanticLegendEntry[]; raster?: boolean; fieldOutlines?: boolean }
/** The one place that turns settings + retained products into a resolved appearance (call per change, never per frame). */
export function resolveSettingsAppearance(settings: V2Settings, world: World | undefined, target: RenderTarget, flags?: ResolveFlags): ResolvedAppearance {
  const o = settings.options;
  // V2 always renders a composition; a project without one starts from the preset of its map style.
  const appearance = { style: o.style, ...settings.appearance, composition: underdarkComposition(withoutHiddenStyle(settings.appearance?.composition) ?? presetComposition(o.style === 'atlas' ? 'atlas' : 'parchment'), o.biome) };
  // The land-use painters (2D canvas, SVG export, legend) read the shared value; the recipe is its source of truth.
  setLanduseForestTone(appearance.composition.vegetation.forestTone);
  return resolveAppearance(appearance, { mapStyle: o.style, contours: o.contours, landuse: o.landuse, labels: o.labels, legend: o.legend, forest: settings.terrain?.forest },
    worldCapabilities(world), target, flags);
}
/** Classic-renderer / export display options derived from the resolved cartography. */
export function resolvedDisplayOptions(r: ResolvedAppearance): V2ExportDisplay {
  const c = r.cartography;
  return { ...(r.palette.colors ? { colors: r.palette.colors } : {}), buildings: r.city.visible, layers: { roads: c.roads }, style: r.palette.mapStyle, contours: r.ground.contours,
    text: r.composition.text, landuse: c.landuse, labels: c.labels, legend: c.legend, cartouche: c.cartouche, painted: c.painted, vegetation: r.vegetation.symbols,
    ...(r.composition.variant === 'topographic' && !r.ground.layers.relief ? { raster: false } : {}),
    fieldOutlines: r.composition.variant === 'topographic' && r.composition.landuse.rural === 'outlines' && r.composition.landuse.classes.field };
}
/** Export starts from the same persisted preferences as the viewer, including explicit false values. */
export function appearanceDisplayOptions(settings: V2Settings, world?: World): V2ExportDisplay {
  return resolvedDisplayOptions(resolveSettingsAppearance(settings, world, 'export'));
}
/** Keep the legacy RenderOptions request valid while accepting an explicit display snapshot. */
export function svgOptionsForDisplay(options: RenderOptions, display?: Partial<V2ExportDisplay>, brushes?: BrushSources): RenderOptions {
  if (!display) return options;
  const result = { ...options };
  for (const key of ['text', 'style', 'colors', 'buildings', 'contours', 'landuse', 'labels', 'legend', 'cartouche', 'vegetation', 'semanticLegend', 'raster', 'fieldOutlines'] as const)
    if (display[key] !== undefined) Object.assign(result, { [key]: display[key] });
  result.layers = { ...display.layers, ...options.layers };
  if (display.painted !== undefined) {
    result.brushes = display.painted ? brushes ?? options.brushes : undefined;
    if (display.painted && !result.brushes) throw new Error('Painted textures are still loading.');
  }
  return result;
}
