/**
 * Look of the earth-sheltered buildings on a natural ground: turf roofs on earth walls (halfling smials, sod
 * longhouses), whatever the culture. A living roof is the meadow round it, so a town of them vanishes into a satellite
 * ground. Turf on timber or wattle (elven tree houses, fungal domes) is a canopy or a cap, not a burrow: not here.
 * Seen close, the turf is mown and drier than the grass and keeps a wider contrast with it; seen far, each mound
 * stands in its cut earth bank, its door and its path: a warmer, darker patch than the meadow, a little wider than the
 * mound. Close, the cut bank rings the mound. Discreet on purpose: earth and dry grass, no painted roof.
 *
 * Part of the town's look (city/look.ts). The close rule is applied by planBuildingColors (cityBuildingPalette.ts), so
 * the Canvas town, the GPU town, the drapes of the tilted view and the volumes' roof paint (volumeRoofPaint) all take
 * it; the bank ring by buildingBody (city/buildingLook.ts: its ink in both towns, its width in the Canvas town only,
 * the GPU town has one edge width per layer); the far rule by the far raster (cityFarRaster.ts), shared by the Canvas
 * town and the live compositor.
 */
import { roofAgainstGround, type Rgb01 } from '../roofContrast';

/** True for a turf roof on earth walls: a mound dug into the ground. */
export const turfCover = (cover: string | undefined, wall: string | undefined): boolean => cover === 'turf' && wall === 'earth';

export const TURF_LOOK = {
  /** Mown, drier grass the turf is pulled toward, and by how much. */
  mown: [0.64, 0.61, 0.42] as Rgb01,
  mownShare: 0.5,
  /** Minimum OKLab distance of the turf from the ground under it (other covers: roofContrast MIN_ROOF_CONTRAST). */
  contrast: 0.22,
  /** The mound in its cut bank, door and path seen from afar: earth tone and share of it in the mean tone, width of
   * the bank round the footprint (metres). */
  bank: { earth: [0.36, 0.29, 0.2] as Rgb01, share: 0.6, widthM: 2.5 },
  /** The cut bank seen close: the outline of the mound's body in dark earth, CSS px (its outer half shows round the
   * turf, the roof covers the rest). */
  ring: { ink: '#3b2f21', alpha: 0.9, widthPx: 1.6 },
} as const;

/** A turf roof colour (sRGB 0..1) on a natural ground: mown and drier, then held apart from `ground` when known. */
export function turfRoof(roof: Rgb01, ground?: readonly number[]): Rgb01 {
  const s = TURF_LOOK.mownShare,
    mown = roof.map((v, i) => v + (TURF_LOOK.mown[i] - v) * s) as Rgb01;
  return ground ? roofAgainstGround(mown, ground, TURF_LOOK.contrast) : mown;
}

/** Far tone of a turf building (0..255 channels, its mean roof tone): the mound with its earth bank. */
export function turfFarTone(c: [number, number, number]): [number, number, number] {
  const s = TURF_LOOK.bank.share;
  return c.map((v, i) => v + (TURF_LOOK.bank.earth[i] * 255 - v) * s) as [number, number, number];
}
