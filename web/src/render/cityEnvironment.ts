import { NEAR_SCALE, TEXTURE_SCALE } from './lod';
/** Physical and display inputs shared by V2 and City Bench. */
import type { ResolvedAppearance } from './appearanceRecipe';
import type { LandKind } from '../gen/types';
import type { Terrain3dGroundSettings } from '../ui/terrain3d';
import type { City3dGround } from '../ui/city3d';
import { DEFAULT_FOREST_SETTINGS } from '../../../rust/bridge/terrainForest';
import type { ForestFieldInput } from '../../../rust/bridge/terrainForest';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import { terrainStyle } from './terrainStyle';
import { CONTOUR_INTERVAL } from './contours';

export const cityGroundLook = (r: ResolvedAppearance) => ({ ambience: r.composition.ambience, waterLook: r.composition.networks.water.look,
  waterVisible: r.ground.layers.water, groundCover: r.composition.vegetation.procedural });

export function cityGroundSettings(r: ResolvedAppearance, ground: City3dGround,
  source: Pick<Terrain3dGroundSettings, 'climate' | 'climateZone' | 'sourceCell'> & { seed: string; relief: string }): Terrain3dGroundSettings | undefined {
  if (ground === 'map' || !r.ground.layers.relief || !r.ground.layers.hypsometry) return;
  const style = terrainStyle(ground === 'render' ? 'render3d' : ground, r.palette.colors);
  const relief = source.relief === 'flat' || source.relief === 'hills' || source.relief === 'valley' ? source.relief : 'mountains';
  return { seed: seedHash(source.seed), climate: source.climate, climateZone: source.climateZone, sourceCell: source.sourceCell,
    lighting: { ...r.ground.lighting }, renderV2: style.traits.satelliteVariant, paperMap: !!style.traits.paperMap,
    v2Season: r.ground.season, v2Calendar: r.ground.calendar, ...cityGroundLook(r),
    displacement: r.city.refinement !== 'source', forestBrushes: style.traits.forestBrushes,
    contours: r.ground.contours && source.relief !== 'cavern' ? { step: CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1),
      color: style.palette.contour, opacity: style.palette.contourOpacity, flat: relief === 'flat' } : undefined };
}

export function cityForestInput(seed: string, climate: { temperature: number; precipitation: number },
  height: ForestFieldInput['height'], water: ForestFieldInput['water'], extra: Pick<ForestFieldInput, 'riverSegments' | 'clearingProfile'> = {}): ForestFieldInput {
  return { seed: seedHash(seed), climate: [climate.temperature, climate.precipitation], height, water, ...extra };
}

const VEGETATION: readonly LandKind[] = ['forest', 'meadow', 'marsh', 'commons'];
/** V2's vector overlay ownership: material/Illustrated grounds already paint their farmland. */
export function cityOverlayLandKinds(r: ResolvedAppearance): true | ((kind: LandKind) => boolean) {
  const symbols = r.composition.vegetation.cartographic;
  if (r.ground.traits.family === 'material') return kind => symbols && VEGETATION.includes(kind);
  if (r.ground.traits.fantasy) return () => false;
  return symbols ? true : kind => !VEGETATION.includes(kind);
}

/** A retained decor's physical forest controls, independent from display visibility. */
export function cityForestSettings(query: URLSearchParams) {
  const bounded = (name: string, fallback: number, max: number): number => query.has(name) && Number.isFinite(Number(query.get(name)))
    ? Math.max(0, Math.min(max, Number(query.get(name)))) : fallback;
  return { enabled: true, density: bounded('forestDensity', DEFAULT_FOREST_SETTINGS.density, 2),
    clearings: bounded('forestClearings', DEFAULT_FOREST_SETTINGS.clearings, 1) };
}

/** The vector water remains visible through opaque rural ground washes. */
export const cityWaterCutsLand = (r: ResolvedAppearance): boolean => r.composition.networks.water.visible && r.composition.networks.water.look === 'ink';
/** A cached vector scene must be rebuilt when its layer ownership changes. */
export const cityOverlayLandKey = (r: ResolvedAppearance): string => JSON.stringify([r.ground.traits.family, r.ground.traits.fantasy, r.composition.vegetation.cartographic]);

/** Both 2D hosts use the raster tile renderer and the retained map extent for decorative field scale. */
export function cityCountrysideCanvasOptions(r: ResolvedAppearance, mapSize: number) {
  return { transparentBackground: true, raster: true, vegetation: r.vegetation.symbols,
    furrowReferenceSize: mapSize, mask: { landuse: cityOverlayLandKinds(r) } };
}

/** Whole crowns remain readable at near town scale, including the narrower bench viewport. */
export const cityCountrysideTextureVisible = (kind: string, scale: number): boolean =>
  scale >= TEXTURE_SCALE || scale >= NEAR_SCALE && (kind === 'forest' || kind === 'orchard');
