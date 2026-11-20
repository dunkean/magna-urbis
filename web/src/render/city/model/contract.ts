/**
 * The town model: public types of render/city/model.
 *
 * A town is a `CityScene` (its plan: blocks, parcels, streets, walls, districts, landmarks, indexed in spatial bins)
 * and a `CityBuildings` (its buildings with their roof pans and cast shadows). Built once per town by scene.ts and
 * buildings.ts, read by every town renderer (canvas/, gl/, the 3D city) and by the look (render/city/look.ts), none
 * of which alters it.
 */
import type { Layout, Parcel, Point, Quay, Shape, Street } from '../../../../../rust/bridge/urban';
import type { Surface } from '../../../../../rust/bridge/housesContract';
import type { JoinedStreet } from '../../roadSurface';
import type { PlacedBuilding } from '../../../../../rust/bridge/urbanArchitecture';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { type CityGround } from '../../cityGround';
import { SpatialBins } from './geometry';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export type CityView = 'tissue' | 'uses' | 'parcels' | 'buildings' | 'roles';
export type CityLod = 'far' | 'mid' | 'near' | 'close';
export type CityPalette = 'growth' | 'atlas' | 'ink' | 'terrain' | 'parchment';
export interface CityLayers {
  waterways?: boolean;
  reserve: boolean;
  allocated: boolean;
  centers: boolean;
  domains: boolean;
  quarters: boolean;
  blocks: boolean;
  streets: boolean;
  enclosures: boolean;
  /** Composition visibility for all parcel types and details; retained on the GPU's Canvas overlay. */ parcelOverlay?: boolean;
  /** Walls, hedges and fences of the lots; absent = shown. */ lotEnclosures?: boolean;
  /** Abstract outlines of lots, blocks and squares; absent = shown. */ planLines?: boolean;
  /** The fences stand as 3D meshes: the plan paints the yard ground only. */ lotEnclosureMeshes?: boolean;
  /** Streets as a ground surface (square junctions, curb returns, tapers); absent = on, off = round-capped strokes. */ roadSurface?: boolean;
  parcels: boolean;
  gardens: boolean;
  places: boolean;
  fronts: boolean;
  axes: boolean;
  access: boolean;
}

export interface CityDistrict {
  layout: number;
  id: number;
  role?: string;
  label?: string;
  wealth?: number;
  tissue: string;
  phase: number;
  anchor?: Point;
}
export interface CityAllocation {
  role?: string;
  label?: string;
  wealth?: number;
  function: string;
  landmark: boolean;
  households?: number;
  residents?: number;
  demandId: string;
  culture: string;
}
export interface CityBlock {
  ground?: Shape[];
  groundPath?: Path2D;
  layout: number;
  index: number;
  shape: Shape;
  kind: string;
  zone: string;
  phase: number;
  quarter: number;
  district?: CityDistrict;
  peripheral: boolean;
  path?: Path2D;
}
export interface CityParcel {
  ground?: Shape[];
  groundPath?: Path2D;
  layout: number;
  index: number;
  shape: Shape;
  use: string;
  block: number;
  zone: string;
  id?: string;
  allocation?: CityAllocation;
  district?: CityDistrict;
  peripheral: boolean;
  source: Parcel;
  path?: Path2D;
}
/** `joined`: its ends as both renderers draw them (roadSurface.ts joinStreets), decided once per layout. */
export interface CityStreet {
  layout: number;
  index: number;
  street: Street;
  width: number;
  rank: number;
  role: string;
  joined: JoinedStreet;
  path?: Path2D;
}
export interface CityWall {
  kind: string;
  pieces: Point[][];
  gates: Point[];
  gateTowers: Point[];
  towers: Point[];
}
export interface CityLandmark {
  point: Point;
  family: string;
  label: string;
  parcel?: number;
  box: Box;
}
export interface CityScene {
  layouts: readonly Layout[];
  blocks: CityBlock[];
  parcels: CityParcel[];
  streets: CityStreet[];
  walls: CityWall[];
  districts: CityDistrict[];
  landmarks: CityLandmark[];
  footprint: Shape[];
  ground?: CityGround;
  extent: Box;
  quays?: Quay[];
  /** Walls, hedges and fences round the lots (enclosures hook). */
  lotEnclosures?: import('../../../../../rust/bridge/urban').LotEnclosure[];
  enclosureProfiles?: (import('../../../../../rust/bridge/urban').ResolvedEnclosure | undefined)[];
  lotYards?: import('../../cityLotEnclosures').Yard[];
  bins: { blocks: SpatialBins; parcels: SpatialBins; streets: SpatialBins; landmarks: SpatialBins };
  parcelById: Map<string, number>;
}
export interface CityBuilding {
  ruins?: Surface;
  /** Level terraces under hillside pieces (massing `footing.terrace`), drawn below the building in the detail styles. */ terraces?: Surface;
  terracePath?: Path2D;
  stilts?: boolean;
  /** Some volume has a flat roof (bevelled rim in plan; parchment draws its ground shadow). */ flat?: boolean;
  snowAltitude?: number;
  /** Weathering of the roof, 0 (new cover) to 1 (old, mossy), stable per building. */ age?: number;
  /** Mill works seen from above on a natural ground: sails (hub at (x, y), `z` above the ground, blades `w` long and `d` wide in the vertical plane facing `angle`) and water wheels (axle centre, radius `w`, width `d`, axle along `angle`). */ marks?: {
    kind: 'sails' | 'wheel';
    x: number;
    y: number;
    w: number;
    d: number;
    z: number;
    angle: number;
    turn: number;
  }[];
  id: string;
  surface: Surface;
  footprint?: Surface;
  fn: string;
  family: string;
  role?: string;
  landmark: boolean;
  parcel?: number;
  building: PlacedBuilding;
  material?: { culture: string; wall: string; cover: string; tone: number; /** Wall colour the building asks for ("#rrggbb"). */ tint?: string };
  path?: Path2D;
  footprintPath?: Path2D;
}
/** Roof pans of the massing (cityMassing.ts): one polygon per sloped face, its
 * building and its light; height shadows per building (sun from the north-west). */
/** `dir`: downslope direction of each pan in plan (radians, atan2 of the face normal's horizontal part; 0 when flat). */
export interface CityRoofs {
  shapes: CityRoofShape[];
  owner: Uint32Array;
  light: Float32Array;
  cover: string[];
  wall?: string[];
  tone: Float32Array;
  dir: Float32Array;
  /** 0 = pitched, 1 = single flat slab, 2 = terrace. */ flat?: Uint8Array;
  /** Share of a full snow mantle the pan keeps (0: never snowed). */ snow?: Float32Array;
  /** 1: inset snow patch of the pan before it (drawn only with snow on the ground). */ patch?: Uint8Array;
  /** 1: bevel of the rim around a flat roof (parapet or kerb). */ rim?: Uint8Array;
  /** Wall colour asked for the pan's volume ("#rrggbb"). */ tint?: (string | undefined)[];
  /** Grain family of the pan: 1 + its index in COVER_GRAINS (buildingMaterials.ts), 0 for none. */ grain?: Uint8Array;
  shadows: Shape[][];
}
export interface CityRoofShape extends Shape {
  /** Side from this outer-ring vertex to the next, internal to a roof pan. */
  hiddenEdge?: number;
}
export interface CityBuildings {
  items: CityBuilding[];
  bins: SpatialBins;
  byId: Map<string, number>;
  roofs?: CityRoofs;
  /** Class of the retained roof and shadow paths (default: the native Path2D); the vector recorder needs paths it can read. */ pathClass?: new () => Path2D;
}
export interface CityPick {
  building?: CityBuilding;
  parcel?: CityParcel;
  block?: CityBlock;
}
