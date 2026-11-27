/**
 * The exact Canvas 2D town: public types of render/city/canvas (the options of a frame, its statistics, the hook of a
 * native house renderer).
 */
import { type TextSettings } from '../../textLayer';
import { type Palette } from '../../styles';
import { type UrbanBuildingAppearance } from '../../urbanBuildingStyle';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { Box, CityView, CityLod, CityPalette, CityLayers, CityBuildings } from '../model/contract';

export interface CityBuildingRenderer {
  draw(ctx: CanvasRenderingContext2D, options: { viewport: Box; metresPerPixel: number; appearance: UrbanBuildingAppearance; selectedId?: string }): { rasterTilesPending: number };
}
export interface CityDrawOptions {
  colors?: import('../../customColors').RenderColors;
  readableGardens?: boolean;
  /** Names, landmark glyphs and centre pins; omitted keeps the normal map. */
  labels?: boolean;
  text?: Readonly<TextSettings>;
  textPalette?: Palette;
  viewport: Box;
  mpp: number;
  dpr: number;
  lod: CityLod;
  view: CityView;
  palette: CityPalette;
  width: number;
  layers: CityLayers;
  buildings?: CityBuildings;
  buildingsVisible: boolean;
  renderer?: CityBuildingRenderer;
  appearance: UrbanBuildingAppearance;
  selectedBuilding?: string;
  selectedParcel?: number;
  refusedParcels?: ReadonlySet<string>;
  /** Textured materials (PBR patterns in world metres) on roofs, streets, plazas and walls; `onTexturesReady` asks for a redraw once the atlases are loaded. */
  textured?: boolean;
  onTexturesReady?: () => void;
  /** Blended ground and streets (groundBlend.ts): translucent washes, no outlines or casings. Default: the shared setting. */
  groundBlend?: boolean;
  /** Unlit physical albedo tile; lighting and night tint belong to the terrain shader. */
  materialGround?: boolean;
  /** The host draws stepped streets as 3D flights (city3dStairs.ts): the ground keeps a plain strip under them, painted as
   * an ordinary street, without the plan's tread hatching. */
  stairMeshes?: boolean;
  /** The host digs the moats in its 3D ground (ui/urbanGroundCuts.ts): the relief shows their scarps, so the plan paints
   * their bed and banks without hachures or near-view detail. */
  dugMoats?: boolean;
  roadLook?: import('../../composition').RoadLook;
  /** Contrast of the roads against their ground, 0.5–1.5 (roadStyle.ts). */
  roadEmphasis?: number;
  /** The same display water colour as the terrain rivers. */
  waterColor?: string;
  /** Ink streets of another palette than the blocks: the 3D plan keeps its ground plain but draws the streets of the 2D map. */
  streetPalette?: CityPalette;
  /** Night ambience: blocks, parcels and yards take dark slate tones whatever the palette (diagnostic views keep their colours). */
  night?: boolean;
  /** A host with a separate native building pass paints town lights after those roofs. */
  deferNightTown?: boolean;
  /** Painted above the streets, walls and waterways and below the buildings, in the same world-coordinate context (semantic district usage). */
  beforeBuildings?: (ctx: CanvasRenderingContext2D) => void;
  /** Puts the map's drawn water back over the town ground and its streets (world-coordinate context), before the
   * quays, bridges and fords: the river is above the roads, quays and bridges above the river. */
  waterAbove?: (ctx: CanvasRenderingContext2D, box: Box, over?: () => void) => void;
  /** Satellite grounds: below the scale of single roofs the town is its far raster (cityFarRaster.ts), cross-faded with the buildings. */
  farTown?: boolean;
  /** The whole town for that raster when `buildings` holds only the visible detail of a very large town (default: `buildings`). */
  farBuildings?: CityBuildings;
}
export interface CityFrameStats {
  lod: CityLod;
  blocks: number;
  parcels: number;
  streets: number;
  buildings: number;
  ms: number;
  pending: boolean;
}
