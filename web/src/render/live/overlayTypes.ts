/**
 * Recorded overlay data and coordinate predicates shared by the live layer, recorder, region store and drape adapter.
 * The cartography host supplies plans and bands; these contracts let each owner use them without sharing mutable control state.
 */
import type { Rect4, View } from '../view';
import type { BakedPrefix, DisplayList } from '../gpu/contract';
import type { OverlayInk } from './contourInk';

export interface OverlayPlan {
  key: string;
  rect: Rect4;
  scale: number;
  dpr: number;
  bands: Rect4[];
}
/** One recorded band: `w` x `h` device pixels at the plan's scale and pixel ratio, centred on (`cx`, `cy`). */
export interface OverlayBand {
  list: DisplayList;
  rect: Rect4;
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Drawn without a product still being made for the view (contour paths, the water raster): see `arrivals`. */
  provisional: boolean;
}

/** What the renderer that owns the map gives the layer (render/cartography/liveHost.ts). */
export interface OverlayHost {
  /** Retained world ink between the baked areas and the suffix. Its owner keeps it across look changes. */
  readonly ink?: OverlayInk;
  /** True while the GPU vector engine draws the live map; otherwise the layer is never ready (its stand-in shows). */
  active(): boolean;
  /** Everything a retained region depends on besides its rectangle and `arrivals`; undefined when it cannot be recorded. */
  key(scale: number, dpr: number, light: boolean): string | undefined;
  /** Changes when a product made per view arrives (contour paths, the water raster of the view): a region with a
   * provisional band, recorded before, is made again; the others stay valid. */
  arrivals(): number;
  plan(view: View, cssW: number, cssH: number, dpr: number, key: string): OverlayPlan;
  /** Records one band with the `crisp` mark; undefined when the recorder cannot represent the map. */
  record(plan: OverlayPlan, band: Rect4, light: boolean): OverlayBand | undefined;
  /** Resumable equivalent for drape recording; each yield leaves the recording context private to the job. */
  recordSteps?(plan: OverlayPlan, band: Rect4, light: boolean): Generator<void, OverlayBand | undefined>;
  /** Asks for a new frame (a region became ready). */
  invalidate(): void;
  /** Makes, until `deadline`, what a recording would otherwise make in one block (the tree marks of the woods); true
   * when nothing is left. Called while the view rests and no region is wanted. */
  warm(deadline: number): boolean;
  now(): number;
  /** A new region waits until the view has rested this long, or the need is older than `maxWaitMs`. */
  readonly settleMs: number;
  readonly maxWaitMs: number;
}

export type MutablePart = { list: DisplayList; post: [number, number, number, number, number, number]; scissor: [number, number, number, number]; baked?: BakedPrefix; prefix?: BakedPrefix; suffix?: DisplayList };
export interface Band {
  rect: Rect4;
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** The area ops, until they are baked. Absent: the band has none (outside the map, or a look without tints). */
  prefix?: DisplayList;
  suffix: DisplayList;
  /** Texels per recorded pixel of the bakes of this band. */
  density: number;
  /** Next step: 0 cut the suffix polygons to the band, 1 upload the prefix, 2 upload the suffix, 3 bake the prefix, 4 done. */
  stage: 0 | 1 | 2 | 3 | 4;
  baked?: BakedPrefix;
  /** The whole band (prefix then suffix): reused during motion and shown in place of replay far from its recorded scale. */
  snapshot?: BakedPrefix;
  snapshotFailed?: boolean;
  part: MutablePart;
}
export interface Region extends OverlayPlan {
  light: boolean;
  stale: boolean;
  parts: Band[];
  live: MutablePart[];
  building?: Band;
  /** Made while the view moved, with bounded bakes: shown, and made again at full quality once the view rests. */
  draft: boolean;
  /** A band was drawn without a product still being made; `arrivals` was this when the region began. */
  provisional: boolean;
  arrivals: number;
}

export const covers = (outer: Rect4, inner: Rect4): boolean => outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
export const meets = (a: Rect4, b: Rect4): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
export const beyond = (k: number, ratio: number): boolean => k >= ratio || k <= 1 / ratio;

/** Recorded pixels kept around a band for its bake gutter and antialiasing reach. */
const CULL_PAD = 16;
export const boxOf = (b: { w: number; h: number }): readonly [number, number, number, number] => [-CULL_PAD, -CULL_PAD, b.w + CULL_PAD, b.h + CULL_PAD];
