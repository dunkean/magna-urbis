/**
 * The live town layer: public types of render/city/live — what the owner of the towns (v2/nativeCityMap.ts) gives the
 * layer, and which appearances the layer covers.
 */
import type { ResolvedAppearance } from '../../appearanceRecipe';
import type { ExportLayers } from '../../exportLayers';
import type { Box, CityBuildings, CityLayers, CityScene } from '../model/contract';
import type { YardBoundary } from '../../cityLotEnclosures';
import type { CityCanopy } from '../../cityGrove';
import type { BuildingSet } from '../gl/buildingSet';
import type { LiveLayer } from '../../live/contract';

/** What the owner of the towns (v2/nativeCityMap.ts) gives the layer. */
export interface LiveCityTowns {
  /** Local snapshot transition; the renderer checks it against the currently uploaded content. */
  uploadOptions?: import('../gl/contract').CityGlSetOptions;
  /** Every town's plan and buildings merged as one GL scene (the GL path's plan; buildings of every town, those of the
   * native house renderer as their city volumes), in resumable steps. Run at rest, once per town content. */
  sceneSteps(planOnly?: boolean): Generator<void, { plan: CityScene; buildings?: BuildingSet }>;
  /** Merged buildings for a view when a town is prepared in tiers (more than LARGE_TOWN_BUILDINGS): the same object
   * while the tiers of that view do not change. Undefined: no tiered town. */
  buildingsFor?(viewport: Box, mpp: number): BuildingSet | undefined;
  /** Layers the exact town draws with this appearance and visibility (nativeCityMap townLayers). */
  layers(appearance: ResolvedAppearance, visibility: Partial<ExportLayers>): CityLayers;
  /** Towns drawn as a far raster on satellite grounds, with the whole town's buildings (drawFarTown's key). */
  farTowns(): readonly { plan: CityScene; buildings: CityBuildings }[];
  /** Each town's whole buildings (a tiered town's base), in entry order, for their night lights in the drape (also when
   * the buildings stand as volumes): the same array while the towns do not change. */
  houses(): readonly CityBuildings[];
  /** Each town's lot enclosures as the Canvas town last derived them (`scene.lotEnclosures`), in entry order. */
  enclosures(): readonly (readonly YardBoundary[] | undefined)[];
  /** Each town's canopy (finishCityFrame: cityCanopy of its layouts and buildings), in entry order. */
  canopies(): readonly CityCanopy[];
  /** Refused parcels of every town (access diagnostic). */
  refused(): ReadonlySet<string>;
  /** Some activity site has drawn ground (drawInstallations); some town is drawn by the native house renderer. */
  sites(): boolean;
  housePlans(): boolean;
}

/** The live town layer. `retarget` hands it the towns of the next map of the same world (a local edit): it keeps its
 * programs, its GPU data and the far rasters of the unchanged towns, draws the previous towns until the new scene is
 * uploaded, and triangulates only the polygons the edit changed. Without towns it is parked: it keeps drawing what it
 * holds and prepares nothing new (its map was disposed before the next one adopted it). */
export interface LiveCityLayer extends LiveLayer {
  retarget(towns: LiveCityTowns | undefined): void;
}

/** Why the live layer cannot stand for the exact town of this appearance (null: it can). Per-frame conditions are
 * checked in `ready`. */
export function liveCityBlock(appearance: ResolvedAppearance, visibility: Partial<ExportLayers> | undefined): string | null {
  const c = appearance.composition;
  // Partial exports keep Canvas 2D, which honours each layer switch.
  if (visibility?.city === false || visibility?.roads === false || visibility?.streets === false) return 'export-layers';
  // An urban land use is drawn without its tint (restCoverage: the town at rest is the Canvas town's): blocked, a look
  // such as the cadastre would show no town while the view moves nor in a tilted view.
  if (appearance.underdark || c.ambience === 'night') return 'night';
  return null;
}
