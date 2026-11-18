/**
 * Look of the town canopy (the grove, the crowns of tree dwellings) as discs: which discs a crown and its lobes are,
 * and the ordered passes that paint them for a palette and a scale.
 *
 * Part of the town's look (city/look.ts), for the GPU town (live/canopyDiscs.ts). It restates the disc layout of
 * `drawCityCanopy` (cityGrove.ts), which paints the Canvas town's canopy with its own code and the same ink table
 * (`INKS`, `SHADE`, read from there): the Canvas canopy does not call this module. On natural grounds the Canvas
 * canopy is sprites and walkways, which these discs only stand for (the look's townRestGaps says so).
 */
import { INKS, SHADE, type CityCanopy } from '../cityGrove';

export type CanopyDiscSet = 'shade' | 'crowns' | 'rim' | 'dark' | 'mid' | 'light';
/** Metres per pixel beyond which a crown is one disc instead of its lobes. */
const CANOPY_WHOLE_CROWNS_MPP = 2.5;
/** The discs (x, y, r triplets) of the canopies: cast shade (south-east by height), whole crowns, and per lobe the
 * stroked rim, the dark body, the mid tone and the lit top. */
export function canopyDiscs(canopies: readonly CityCanopy[]): Record<CanopyDiscSet, number[]> {
  const out: Record<CanopyDiscSet, number[]> = { shade: [], crowns: [], rim: [], dark: [], mid: [], light: [] };
  for (const c of canopies)
    for (const t of [...c.dwellings, ...c.trees]) {
      const k = (t.h + t.r * 0.6) * 0.35;
      out.shade.push(t.x + SHADE.x * k, t.y + SHADE.y * k, t.r * 0.95);
      out.crowns.push(t.x, t.y, t.r);
      for (const l of t.lobes) {
        out.rim.push(l.x + l.r * 0.08, l.y + l.r * 0.1, l.r * 1.04);
        out.dark.push(l.x + l.r * 0.1, l.y + l.r * 0.13, l.r);
        if (l.tone > 0.3) out.mid.push(l.x - l.r * 0.04, l.y - l.r * 0.05, l.r * (0.72 + 0.16 * l.tone));
        if (l.tone > 0.55) out.light.push(l.x - l.r * 0.2, l.y - l.r * 0.24, l.r * 0.5 * l.tone);
      }
    }
  return out;
}
/** One pass over a disc set: its ink, opacity, and how far the discs grow (CSS px: half the width of a stroked rim). */
interface CanopyPass {
  discs: CanopyDiscSet;
  color: string;
  alpha: number;
  growPx: number;
}
const passes = new Map<string, readonly CanopyPass[]>();
/** The passes of the canopy, bottom to top: shade, then whole crowns (far, and the flat inks) or the rim, dark, mid and
 * lit lobes. Each translucent pass covers a sample once. */
export function canopyPasses(palette: string, mpp: number): readonly CanopyPass[] {
  const ink = INKS[palette] ?? INKS.terrain,
    whole = !!ink.flat || mpp > CANOPY_WHOLE_CROWNS_MPP,
    key = `${palette}|${whole}`;
  let list = passes.get(key);
  if (!list) {
    const made: CanopyPass[] = [];
    if (!ink.flat) made.push({ discs: 'shade', color: ink.shade, alpha: 1, growPx: 0 });
    if (whole) {
      if (ink.stroke) made.push({ discs: 'crowns', color: ink.stroke, alpha: 1, growPx: (ink.flat ? 0.6 : 0.45) / 2 });
      made.push({ discs: 'crowns', color: ink.mid, alpha: 1, growPx: 0 });
    } else {
      if (ink.stroke) made.push({ discs: 'rim', color: ink.stroke, alpha: 1, growPx: 0.45 });
      made.push({ discs: 'dark', color: ink.dark, alpha: 1, growPx: 0 }, { discs: 'mid', color: ink.mid, alpha: 1, growPx: 0 }, { discs: 'light', color: ink.light, alpha: 0.85, growPx: 0 });
    }
    passes.set(key, (list = made));
  }
  return list;
}
