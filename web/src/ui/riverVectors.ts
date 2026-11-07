/** V2 water types. Computation lives in magna-urbis-terrain::vector_water. */
export interface RiverSettings {
  /** Upstream area that starts a river, km². */
  riverArea: number;
  /** Gradient below which a reach meanders fully, m/km. */
  flatSlope: number;
  /** Target sinuosity of flat reaches (arc length / valley length). */
  sinuosity: number;
  /** Multiplier of the hydraulic-geometry channel width. */
  widthScale: number;
  seed: string;
  /**
   * Braided reaches: 0 none, 1 above the Leopold & Wolman (1957) slope–discharge
   * threshold in unconfined valleys, 2 more readily (high sediment supply).
   */
  braiding?: number;
  /** Anastomosing side channels on very flat, wet floodplains. */
  anabranching?: boolean;
  /** Valley sides slow bank migration (Paris et al. 2023) besides bounding the belt. */
  terrainInfluence?: boolean;
  /** Avulsions: a meander belt now and then takes a shorter course, leaving its old channel. */
  avulsions?: boolean;
  /** Confluence angle in degrees (Seybold, Rothman & Kirchner 2017); absent: the drainage's own. */
  confluenceAngle?: number;
  /** Distributary deltas where large rivers reach the sea across a low coastal plain. */
  deltas?: boolean;
  /** Bankfull discharge per unit of reference area, relative to a 300 mm runoff. */
  dischargeScale?: number;
  /** Aridity index P / PET: dry climates braid more, wet ones anastomose. */
  aridity?: number;
}

export interface RiverLine {
  /** Interleaved x, y in metres, upstream to mouth. */
  points: number[];
  /** Upstream area at each vertex, m². */
  area: number[];
  /** Water surface at each vertex, metres: the filled drainage level of the course. */
  level: number[];
  /**
   * How each vertex was traced: 0 smoothed course, 1 meander, 2 confluence join,
   * 3 braided reach, 4 anastomosing side channel, 5 delta distributary.
   */
  kind: number[];
  /** Stream id, and the stream this course joins (−1: sea, lake or map edge). */
  id?: number;
  joins?: number;
  /** Drainage terminal cell before shore clipping (lake/sea/map outlet). */
  outlet?: number;
  /** Number of channels sharing the flow at each vertex (braids), 1 by default. */
  threads?: number[];
}

export interface RiverNetwork {
  rivers: RiverLine[];
  /** Retained channels through standing lakes, drawn when lakes are hidden. */
  lakeLinks?: RiverLine[];
  /** Physical hydraulic width multiplier used to trace and draw this network. */
  widthScale?: number;
  /** Abandoned meander loops and avulsed channels; `area` is the river's upstream area when cut off. */
  oxbows: RiverLine[];
  /** Braided and anastomosing side channels. */
  braids: RiverLine[];
  /** Delta distributaries. */
  distributaries: RiverLine[];
  meanderRuns: number;
  lengthKm: number;
  meanderKm: number;
  braidedKm: number;
  avulsions: number;
  deltas: number;
  ms: number;
}

export interface MeanderResult {
  xs: number[]; ys: number[];
  oxbows: [number[], number[]][];
  iterations: number;
  /** False when no meandered channel fitted: the axis came back unchanged, or with a long stretch of it at the end. */
  meandered: boolean;
  avulsions: number;
}

export interface MeanderOptions {
  /**
   * Share (0–1] of the migration a bank keeps at (x, y) given the water level:
   * rising valley sides resist erosion, so bends slide along them (Paris,
   * Guérin, Collon & Galin 2023) rather than stopping dead at the belt bound.
   */
  resistance?: (x: number, y: number, water: number) => number;
  /** Now and then the channel avulses onto a shorter course across its belt. */
  avulsion?: boolean;
}

export { vectorRivers } from '../../../rust/bridge/waterNative';
/** Pure hydraulic width used by renderers. */
export function channelWidth(area: number, scale: number): number { return scale * 3 * Math.pow(area / 1e6, 0.45); }
