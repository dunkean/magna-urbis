/**
 * One drawVector call as an object: the target context in world coordinates, the view, the level of detail, the
 * culling rectangles, and the painters every layer family shares (paths of a layer for this frame, fills and strokes,
 * road and land-use painters). Built by vector.ts at each call; the layer modules (landuse, fields, water, roads,
 * farmsteads, urban, structures, symbols) take it with the renderer context.
 */
import { type MapInk } from '../gpu/recorder';
import type { Lod } from '../lod';
import type { Rect4, View } from '../view';
import type { LineLayer, PolyLayer } from '../scene';
import type { Palette } from '../styles';
import type { BrushKind } from '../brushes';
import type { RoadStyle, strokeNaturalRoad } from '../roadStyle';
import type { FrameStats } from './contract';
import type { CartographyContext, DrawMode } from './context';

export interface FrameBase {
  readonly ctx: CanvasRenderingContext2D;
  readonly view: View;
  readonly mode: DrawMode;
  readonly dpr: number;
  readonly cssW: number;
  readonly cssH: number;
  /** World to CSS pixels. */
  readonly sc: number;
  readonly lod: Lod;
  readonly band: number;
  /** The view in world units (with the paint margin when a tile is recorded inside a larger request). */
  readonly rect: Rect4;
  /** The rectangle the detail budgets are counted on: the whole request of a tile, else `rect`. */
  readonly budgetRect: Rect4;
  /** `rect` grown by the stamp and shadow reach: clipped paths keep their real borders. */
  readonly pathRect: Rect4;
  readonly fs: FrameStats;
  readonly minEdge: number;
  /** CSS pixels to world units. */
  readonly px: (n: number) => number;
  /** A width in metres with a minimum on-screen width. */
  readonly lw: (w: number, minPx: number) => number;
  readonly polyPaths: (l: PolyLayer) => Path2D[];
  readonly linePaths: (l: LineLayer) => Path2D[];
  readonly fillPolys: (name: string, color: MapInk, alpha?: number, rule?: CanvasFillRule) => PolyLayer | undefined;
  readonly strokePolys: (name: string, color: MapInk, width: number, alpha?: number, dash?: number[]) => void;
  readonly strokeLines: (ls: LineLayer[], color: MapInk, widthOf: (l: LineLayer) => number, alpha?: number, dash?: number[], cap?: CanvasLineCap) => void;
}

/** The road painters of a frame (roads.ts roadPainters). */
export interface RoadPainters {
  readonly edge: number;
  readonly roadGroup: (ls: LineLayer[], fillMinPx: (l: LineLayer) => number, edgeK?: (l: LineLayer) => number) => void;
  readonly roadStyle: RoadStyle;
  /** The roads take a natural-ground look (earth, gravel, asphalt) instead of map inks. */
  readonly natural: boolean;
  readonly inkAlpha: number;
  readonly merged: (ls: LineLayer[]) => Path2D;
  readonly canopyMerged: (ls: LineLayer[]) => (Path2D | undefined)[];
  readonly strokeEarthRoads: (ls: LineLayer[], rank: Parameters<typeof strokeNaturalRoad>[2], metres: number) => void;
  readonly drawRegionalRoads: (roads: LineLayer[], tracks: LineLayer[]) => void;
  readonly strokeCoveredTracks: (tracks: LineLayer[]) => void;
}

/** The land-use painters of a frame (landuse.ts landPainters). */
export interface LandPainters {
  readonly brushFill: (name: string, kind: BrushKind, scale: number) => void;
  readonly brushTrees: (name: string, orchard?: boolean) => void;
  /** Land use is drawn (the mask of another pass, or the world option). */
  readonly luOn: boolean;
  readonly fillLand: (name: string, kind: keyof Palette['land']) => void;
  readonly fillLandSteps: (name: string, kind: keyof Palette['land'], ink?: CartographyContext['ink']) => Generator<void>;
  readonly multiply: (on: boolean) => void;
}

export interface VectorFrame extends FrameBase, RoadPainters, LandPainters {
  /** The terrain bitmap (hillshade or the host's), drawn first. */
  readonly tex: CanvasImageSource | null;
  /** Draws the part of the terrain bitmap inside the view (a restored ground inside a clip). */
  readonly drawVisibleTerrain: () => void;
  /** The cave floor layer: drawVector clipped the map to it before the land use (structures.ts restores it). */
  readonly cavernFloor: PolyLayer | false | undefined;
  /** Land = the map minus the sea and lakes (landClip). */
  readonly land: Path2D | null;
  /** Regional roads and tracks shown at this level of detail. */
  readonly roads: LineLayer[];
  readonly tracks: LineLayer[];
}
