/**
 * The plan path of the town's look: where the GPU plan renderer on its own canvas reads the look differently.
 *
 * Who: gl/renderer.ts `createCityGlRenderer` (through cityGlView.ts): City Bench, and the V2's exact output of the
 * drawn plans — palettes growth, atlas, ink, and terrain with ink roads; never parchment, flat footprints, natural
 * roads, night or the painted style (cityContract.cityGlBlockReason keeps those on the Canvas town). The live town
 * (the compositor's layer) and the Canvas town read the look without these differences.
 *
 * Why it exists: captures and sheets of those looks are made of this renderer, so its values are kept as they are
 * until the owner decides to align them. Each difference is a rule marked `planPath` where the look states it:
 *
 *  1. planLook.planFrame      raw ground washes on the terrain palette (no natural-ground cap), no slush on squares.
 *  2. planLook.blockOps       no block wash on the terrain palette when blended (outlines stay).
 *  3. planLook.blockOps/parcelOps   render background of City Bench (`painted`): district-tinted yards, paved squares.
 *  4. buildingLook.buildingBody     wall base without the wall tint a building asks for; `painted`: dark party-wall
 *                                   edges at 0.8, pale landmark edges.
 *  5. buildingLook.roofPansShown    pans and cast shadows in every view (shaded by the body colour in the roles view
 *                                   and the uses diagnostic).
 *  6. planPathPan (below)     pans in the shared plan colour on the terrain palette too (no capped pan light, no
 *                             weathering, no grain), the user's ink in every non-shaded state; pan edges in their own
 *                             ink with a strength per cover.
 *  7. castShadowTint          black cast shadows at 0.3 on the terrain palette whatever the snow; `painted` without
 *                             roof pans: the body shifted south-east as ground shadow (paintedGroundShadow).
 *  8. lineCoverage            outlines are one device pixel at full strength (the look's widths are not applied).
 *  9. streetLook.streetMinPx  minimum street widths of ranks 2 to 4 are 0.1 px narrower; street casings always take
 *                             the ink widths (streetEdgePx 'ink'), bridges their stone-deck art.
 * 10. the canals are left to the Canvas overlay drawn above this renderer (gl/hostTools.cityGlOverlayLayers).
 * 11. gl/styleTables.planColorsSteps   flat footprints show in the buildings and roles views only.
 */
import type { CityBuilding, CityPalette, CityRoofs, CityView } from './model/contract';
import type { RenderColors } from '../customColors';
import { planRoofColor, planShade } from '../cityBuildingPalette';

/** Present on a frame of the plan path. */
export interface PlanPath {
  /** Render background of City Bench: painted yards, squares and building edges. */ painted: boolean;
}
/** Alpha byte 253 in a fill colour table marks a paved square of the render background: the paved pass of the GPU
 * plan draws its setts and wear (close level only). Visually opaque. */
export const PAVED_ALPHA = 253 / 255;
/** Yards and courts under painted roofs (render background): trodden earth the district colour is mixed into at 0.45,
 * so districts still read once the blocks are covered with roofs (near, close). */
export const PAINTED_YARD = { earth: '#b3a27c', share: 0.45 } as const;
/** The render background paints the plan (not on parchment, ink or natural grounds). */
export const paintedPlan = (path: PlanPath | undefined, palette: CityPalette): boolean => !!path?.painted && palette !== 'parchment' && palette !== 'ink' && palette !== 'terrain';
/** The render background paints the building edges (not on parchment or ink, not in a diagnostic colouring). */
export const paintedBuildings = (path: PlanPath | undefined, palette: CityPalette, view: CityView, diagnostic: string): boolean => !!path?.painted && palette !== 'parchment' && palette !== 'ink' && view !== 'roles' && diagnostic !== 'uses';
/** Opacity of a pan's edge line on the plan path: crisp courses (tile, shingle, slate, bamboo) read as stripes, soft
 * ones (thatch, turf) as fuzz. Lines are drawn at one device pixel, so keep their opacity low. */
const COVER_EDGE: Record<string, number> = { tile: 0.72, shingle: 0.72, slate: 0.68, bamboo: 0.72, metal: 0.65, thatch: 0.35, reed: 0.35, palm: 0.4, turf: 0.3, bark: 0.45, hide: 0.4, felt: 0.4, snow: 0.3 };
const PAN_EDGE_INK = '#30271f';
/** Colour and edge of pan `k` on the plan path: the shared plan colour (the user's building ink when given), or the
 * body colour shaded by the pan light where the bodies are coloured by role or use; no edge on a snowed pan. */
export function planPathPan(f: { view: CityView; palette: CityPalette; diagnostic: string; colors?: RenderColors }, item: CityBuilding, roofs: CityRoofs, k: number, bodyFill: string): { color: string; edge: string; edgeAlpha: number } {
  const shaded = f.view === 'roles' || f.diagnostic === 'uses';
  return { color: shaded ? planShade(bodyFill, roofs.light[k] * 0.5) : planRoofColor(item, roofs, k, f.palette, f.colors?.building), edge: PAN_EDGE_INK, edgeAlpha: roofs.snow?.[k] ? 0 : 0.55 * Math.max(0.6, COVER_EDGE[roofs.cover[k]] ?? 0.55) };
}
/** Ground shadow of painted bodies without roof pans: the body shifted south-east by this offset (metres; a floor on screen). */
export function paintedGroundShadow(mpp: number): { dx: number; dy: number } {
  const dx = Math.max(1.6, 1.1 * mpp);
  return { dx, dy: 0.8 * dx };
}
/** Coverage of a one-device-pixel GL line standing for a stroke `widthPx` CSS px wide: the stroke's width in device
 * pixels (the town at rest draws thinner than a pixel); the plan path draws its lines at full strength. */
export const lineCoverage = (widthPx: number, dpr: number, path: PlanPath | undefined): number => (path ? 1 : Math.max(0.05, Math.min(1, widthPx * dpr)));
