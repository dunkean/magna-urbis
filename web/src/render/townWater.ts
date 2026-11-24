/**
 * One water for towns: canal water (urban/lagoon.rs waterways) and wet moats (2D ditch, 3D sheet) take the colour the map gives its rivers, the colour
 * `hydrologyWaterColour` gives the vector rivers and lakes of the same look (vectorWaterRender waterInk):
 * - ink looks (parchment, topographic, cadastre...): the map's water ink;
 * - natural looks (satellite family, Render3D): the natural water stop ('render3d', #1a4d5c unless `colors.river`) in the
 *   climate and season of the map (waterPalette.ts),
 *   measured as the river colour of a V2 satellite town view (web/out/canals/NOTES.md).
 * Canal water is water, not plan ink: it must not take the town plan's opacity (nativeCityMap redraws it at full
 * strength over the plan layer, cityWaterways.drawCityWaterways). The 2D canvas (cityDrawOptions) and the 3D slabs
 * (city3dPlanOptions -> city3dWaterways) both read this function; the 3D material ground paints canals into its
 * water mask instead, so the terrain shader shades them as its rivers there.
 */
import type { ResolvedAppearance } from './appearanceRecipe';
import { hydrologyWaterColour } from '../../../rust/bridge/hydrologyRender';

export function townWaterColour(r: Pick<ResolvedAppearance, 'composition' | 'palette'>): string {
  return hydrologyWaterColour(r.composition.networks.water.look === 'ink' ? r.palette.mapStyle : 'render3d', r.palette.colors);
}
