/** Top-down underground cover, shared by SVG patterns, Canvas paths and the legend. */
import type { LandKind } from '../gen/types';
import type { Palette } from './styles';
import { panelSvg, type Prim } from './legend';

/** Look of a cultivated fungal bed (farm plots, fungal land use, town gardens): `bed` fill, small mushroom `cap`s, a rare
 * faint `glow`, the `edge` ink of a vector map (none on a material ground). */
export interface FungalBedLook {
  bed: string;
  cap: string;
  glow: string;
  edge?: string;
}
/** The cultivated fungal bed of the Underdark: a dark compost of the cave floor's own tones with small irregular caps,
 * never a pale patch or a purple glyph. A vector map keeps its palette's bed tone (render/biomes.ts) and its ink; a
 * material ground (`natural`, the satellite looks) takes the compost of the floor shader (rust/bridge/
 * terrainRenderUnderdark.ts) with no outline. Engraving and blueprint keep their single ink. */
export function fungalBedLook(pal: Palette, natural = false, night = pal.name === 'night'): FungalBedLook {
  if (pal.name === 'engraving' || pal.name === 'blueprint') return { bed: pal.land.garden, cap: pal.treeInk, glow: pal.treeInk, edge: pal.farmInk };
  if (natural) return { bed: night ? '#15120f' : '#231e19', cap: night ? '#6c6354' : '#877b66', glow: '#4f9f98' };
  return { bed: pal.land.garden, cap: night ? '#a3967e' : '#c4b595', glow: night ? '#5fb3a9' : '#7dbfb3', edge: pal.farmInk };
}
/** Caps of one bed mark (offset x, y and radius, in units of the mark radius): uneven sizes and spacing, all inside it. */
const BED_CAPS: readonly [number, number, number][] = [
  [-0.5, -0.35, 0.3],
  [0.42, -0.5, 0.22],
  [0.35, 0.38, 0.34],
  [-0.4, 0.5, 0.18],
];
/** Small mushroom caps seen from above, and one faint glowing spore head; no outline, no geometric symbol. */
export function fungalBedMarks(x: number, y: number, r: number, look: FungalBedLook): Prim[] {
  return [...BED_CAPS.map(([dx, dy, rr]): Prim => ({ t: 'circle', x: x + dx * r, y: y + dy * r, r: rr * r, fill: look.cap, op: 0.8 })), { t: 'circle', x: x - 0.02 * r, y, r: 0.09 * r, fill: look.glow, op: 0.55 }];
}

export function underdarkMark(kind: LandKind, x: number, y: number, r: number, pal: Palette, strokeScale = 1): Prim[] {
  if (kind === 'garden' || kind === 'field') return fungalBedMarks(x, y, r, fungalBedLook(pal));
  if (kind === 'commons')
    return [
      {
        // A small closed pebble seen from above; no forked interior resembling a broken plant.
        t: 'poly',
        pts: [
          [x - r, y - r * 0.1],
          [x - r * 0.8, y - r * 0.6],
          [x - r * 0.15, y - r * 0.8],
          [x + r * 0.6, y - r * 0.55],
          [x + r, y],
          [x + r * 0.65, y + r * 0.6],
          [x - r * 0.1, y + r * 0.8],
          [x - r * 0.8, y + r * 0.5],
        ],
        stroke: pal.grass,
        sw: 0.5 * strokeScale,
      },
    ];
  if (kind === 'meadow' || kind === 'pasture')
    return [
      [-0.4, -0.3, 0.48],
      [0.38, -0.1, 0.4],
      [0, 0.4, 0.42],
    ].map(([dx, dy, rr]) => ({ t: 'circle', x: x + dx * r, y: y + dy * r, r: rr * r, stroke: pal.grass, sw: 0.5 * strokeScale }));
  // Scalloped caps and spores, without a side-view trunk or an outdoor canopy.
  const pts: [number, number][] = Array.from({ length: 18 }, (_, i) => {
    const a = (i * Math.PI) / 9,
      rr = r * (i % 3 === 1 ? 0.82 : 1);
    return [x + Math.cos(a) * rr, y + Math.sin(a) * rr];
  });
  return [
    { t: 'poly', pts, fill: pal.treeFill, stroke: pal.treeInk, sw: 0.5 * strokeScale },
    ...[
      [-0.35, -0.25],
      [0.35, -0.15],
      [0, 0.35],
    ].map(([dx, dy]): Prim => ({ t: 'circle', x: x + dx * r, y: y + dy * r, r: r * 0.13, stroke: pal.treeInk, sw: 0.4 * strokeScale })),
  ];
}

export function appendUnderdarkMark(path: Path2D, kind: LandKind, x: number, y: number, r: number, pal: Palette): void {
  for (const p of underdarkMark(kind, x, y, r, pal)) {
    if (p.t === 'circle') {
      path.moveTo(p.x + p.r, p.y);
      path.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    } else if (p.t === 'poly' || p.t === 'line') {
      p.pts.forEach(([px, py], i) => (i ? path.lineTo(px, py) : path.moveTo(px, py)));
      if (p.t === 'poly') path.closePath();
    }
  }
}

export const underdarkMarkSvg = (kind: LandKind, x: number, y: number, r: number, pal: Palette, strokeScale = 1): string => panelSvg({ w: 0, h: 0, prims: underdarkMark(kind, x, y, r, pal, strokeScale) }, 0, 0, 1, pal.fontFamily, `underdark-${kind}`);

/** Sizes are metres, independent of the extent of the map or its export width. */
export function underdarkTextureSpec(kind: LandKind): { spacing: number; radius: number } {
  const specs: Partial<Record<LandKind, [number, number]>> = { commons: [28, 2.5], garden: [8, 2.8], field: [14, 3.4], forest: [9, 3.1], orchard: [11, 2.3], meadow: [16, 3], pasture: [24, 2.4], marsh: [15, 3.2] };
  const [spacing, radius] = specs[kind] ?? [16, 2.7];
  return { spacing, radius };
}
export function underdarkPatterns(pal: Palette, _s = 1): string {
  return (['commons', 'meadow', 'pasture', 'forest', 'orchard', 'marsh', 'garden', 'field'] as LandKind[])
    .map(kind => {
      const { spacing: size, radius: r } = underdarkTextureSpec(kind);
      return `<pattern id="p-${kind}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">${underdarkMarkSvg(kind, size / 2, size / 2, r, pal)}</pattern>`;
    })
    .join('');
}
