import { bareLimbs } from '../../../rust/bridge/bareTree';
import type { Vec2 } from '../gen/types';
import type { Palette } from './styles';
import type { CanvasLike } from './canvas';
import { brushHash } from './brushes';
import { hash3, insideArea, orchardMarks, type TextureLayer, type Mark } from './scene';
import { TileIndex, boxesOf } from './tileindex';
import { TREE_CELLS, treeMask } from './parchmentTrees';

export type VegetationStyle = 'classic' | 'canopy';
/** `conifer` is a dense rounded conifer crown seen from above (cold and mixed woods). */
export type CanopyKind = 'forest' | 'orchard' | 'conifer';
/** Symbols of the ground's woods (treeSymbols.ts), in the order of their atlas layers. `bare`: a leafless broadleaf. */
export const TREE_SPECIES = ['broadleaf', 'conifer', 'bare', 'palm'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];
/** A filled shape, or with `line` a closed ink contour of that width (glyph units). */
interface LeafShape {
  points: Vec2[];
  fill: string;
  alpha: number;
  line?: number;
  /** Polyline: the contour stays open. */ open?: boolean;
}
export const CANOPY_MARGIN = 12;
const SPRITE_BYTES = 48 * 1024 * 1024; // broadleaf, conifer, mixed and orchard atlases at 4x

function mix(a: string, b: string, t: number): string {
  if (!/^#[\da-f]{6}$/i.test(a) || !/^#[\da-f]{6}$/i.test(b)) return a;
  return (
    '#' +
    [1, 3, 5]
      .map(i =>
        Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Global candidates with a local exclusion radius: no repeated tile and no visible grid.
 * A tile owns centres, never clips crowns. Neighbours participate even outside the tile. */
export function canopyMarks(layer: TextureLayer, tile: number, seed: string): Mark[] {
  if (layer.kind === 'orchard') return orchardMarks(layer, tile, seed);
  const orchard = false,
    spacing = 6;
  const salt = Math.floor(brushHash(seed, 0, 0, orchard ? 211 : 101) * 0x7fffffff);
  const rect = layer.index.tileRect(tile),
    ids = layer.index.itemsOf(tile),
    out: Mark[] = [];
  const candidate = (i: number, j: number) => ({ x: (i + (orchard ? 0.5 : hash3(i, j, salt))) * spacing, y: (j + (orchard ? 0.5 : hash3(i, j, salt + 7))) * spacing, priority: hash3(i, j, salt + 17) });
  for (let j = Math.floor(rect.minY / spacing) - 1; j <= Math.ceil(rect.maxY / spacing); j++) {
    for (let i = Math.floor(rect.minX / spacing) - 1; i <= Math.ceil(rect.maxX / spacing); i++) {
      const p = candidate(i, j);
      if (p.x < rect.minX || p.x >= rect.maxX || p.y < rect.minY || p.y >= rect.maxY) continue;
      if (!orchard) {
        let crowded = false;
        for (let dy = -1; dy <= 1 && !crowded; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const q = candidate(i + dx, j + dy);
            if (q.priority < p.priority && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 4.5 ** 2) {
              crowded = true;
              break;
            }
          }
        if (crowded) continue;
      }
      for (const id of ids)
        if (insideArea(layer.areas[id], p.x, p.y)) {
          const size = hash3(i, j, salt + 23);
          // Wide spread of crown sizes, with a few emergent trees standing over the canopy.
          out.push({ x: p.x, y: p.y, r: size > 0.94 ? 1.35 + (size - 0.94) * 4 : 0.72 + 0.55 * size * size, k: hash3(i, j, salt + 29) });
          break;
        }
    }
  }
  return out;
}

export function canopyAppearance(seed: string, m: Mark): { variant: number; tone: number } {
  return { variant: Math.floor(m.k * 24), tone: Math.floor(brushHash(seed, m.x, m.y, 83) * 12) };
}

export function canopyAreaMarks(areas: TextureLayer['areas'], kind: 'forest' | 'orchard', mapSize: number, seed: string): Mark[] {
  const layer: TextureLayer = { kind, areas, index: new TileIndex(mapSize, 256, boxesOf(areas.map(a => a.poly)), 'overlap') };
  return layer.index
    .tilesInRect({ minX: 0, minY: 0, maxX: mapSize, maxY: mapSize })
    .flatMap(tile => canopyMarks(layer, tile, seed))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Turned crowns by hue family: gold, orange and rust. */
const TURNED = ['#d3a23c', '#cb7a2e', '#a94c2b'] as const,
  SNOW = '#f5f6f2';
/** Small hue and lightness differences, while monochrome palettes stay monochrome. */
export function canopyColor(pal: Palette, tone: number): string {
  const hue = Math.floor(tone / 4),
    mono = ['engraving', 'blueprint', 'night'].includes(pal.name);
  const leaf = mono || !hue ? pal.treeFill : mix(pal.treeFill, hue === 1 ? '#b2ad63' : '#67998c', 0.14),
    base = mix(leaf, TURNED[hue], 0.5 * (pal.season?.autumn ?? 0));
  return mix(base, pal.treeInk, 0.06 + (tone % 4) * 0.075);
}
/** The palette of the trees that keep their leaves: the authored foliage, with the snow of the date. */
const evergreenPalette = (pal: Palette): Palette => (pal.season ? { ...pal, treeFill: pal.season.fill, treeInk: pal.season.ink, season: { ...pal.season, leaf: 1, autumn: 0 } } : pal);
/** A deciduous symbol that stands bare at the date: the leafless share of the season, always the same trees first. */
const isBare = (kind: CanopyKind, variant: number, pal: Palette): boolean => kind !== 'conifer' && !!pal.season && hash3(variant, 557, 3) >= pal.season.leaf;

/** A leafless crown seen from above: the same tapered limbs as the close model, lighter under snow. */
export function bareGlyph(kind: 'forest' | 'orchard', variant: number, pal: Palette): LeafShape[] {
  const h = (salt: number): number => hash3(variant, kind === 'orchard' ? 433 : 431, salt),
    r = kind === 'orchard' ? 3.6 : 5.8,
    mono = ['engraving', 'blueprint', 'night'].includes(pal.name),
    bark = mono ? pal.treeInk : mix(pal.season?.ink ?? pal.treeInk, '#6a5a48', 0.55),
    snow = pal.season?.snow ?? 0,
    turn = h(2) * Math.PI * 2;
  const project = ([x, , z]: readonly number[]) => ({ x: r * (x * Math.cos(turn) - z * Math.sin(turn)), y: r * (x * Math.sin(turn) + z * Math.cos(turn)) });
  const shapes: LeafShape[] = [];
  for (const [a, b] of bareLimbs) {
    const start = project(a),
      end = project(b),
      dx = end.x - start.x,
      dy = end.y - start.y,
      len = Math.hypot(dx, dy);
    const nx = (-dy / len) * r,
      ny = (dx / len) * r;
    shapes.push({
      points: [
        { x: start.x + nx * a[3], y: start.y + ny * a[3] },
        { x: end.x + nx * b[3], y: end.y + ny * b[3] },
        { x: end.x - nx * b[3], y: end.y - ny * b[3] },
        { x: start.x - nx * a[3], y: start.y - ny * a[3] },
      ],
      fill: mix(bark, SNOW, snow * 0.55),
      alpha: 0.9,
    });
  }
  return shapes;
}

/** A palm seen from above: arched fronds around a dark heart. Kept green all year. */
export function palmGlyph(variant: number, pal: Palette, tone: number): LeafShape[] {
  const h = (salt: number): number => hash3(variant, 619, salt),
    tree = evergreenPalette(pal),
    crown = mix(mix(canopyColor(tree, tone), '#7f9a4e', 0.3), tree.treeInk, 0.12),
    ink = mix(tree.treeInk, pal.ink, 0.35),
    fronds = 9 + Math.floor(h(1) * 3),
    turn = h(2) * Math.PI * 2,
    r = 5.4 * (0.9 + 0.2 * h(3));
  const frond = (i: number, dx: number, dy: number): Vec2[] => {
    const a = turn + ((i + 0.35 * (h(10 + i) - 0.5)) * Math.PI * 2) / fronds,
      len = r * (0.8 + 0.25 * h(30 + i)),
      at = (d: number, side: number): Vec2 => ({ x: dx + Math.cos(a) * d - Math.sin(a) * side, y: dy + Math.sin(a) * d + Math.cos(a) * side });
    return [at(0.3, 0), at(len * 0.35, 0.62), at(len * 0.75, 0.5), at(len, 0.05), at(len * 0.75, -0.42), at(len * 0.35, -0.55)];
  };
  const all = Array.from({ length: fronds }, (_, i) => i);
  return [
    ...all.map((i): LeafShape => ({ points: frond(i, 0.6, 0.85), fill: tree.treeInk, alpha: 0.2 })),
    ...all.map((i): LeafShape => ({ points: frond(i, 0, 0), fill: i % 3 ? crown : mix(crown, pal.paper, 0.22), alpha: 0.95 })),
    ...all.map((i): LeafShape => ({ points: frond(i, 0, 0), fill: ink, alpha: 0.65, line: 0.22 })),
    { points: Array.from({ length: 8 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 4) * 0.9, y: Math.sin((k * Math.PI) / 4) * 0.9 })), fill: ink, alpha: 0.6 },
  ];
}

export function canopyGlyph(kind: CanopyKind, variant: number, pal: Palette, tone: number): LeafShape[] {
  if (kind === 'conifer') return coniferGlyph(variant, evergreenPalette(pal), tone);
  if (isBare(kind, variant, pal)) return bareGlyph(kind, variant, pal);
  const snow = pal.season?.snow ?? 0;
  const h = (salt: number): number => hash3(variant, kind === 'orchard' ? 211 : 101, salt);
  const r = kind === 'orchard' ? 3.8 : 6.1,
    phase = h(4) * Math.PI * 2,
    phase2 = h(7) * Math.PI * 2,
    stretch = 1 + 0.12 * h(5);
  // Engraved crown: an irregular round mass whose rim is a chain of small scallops (leaf clusters), never a smooth disc.
  const bumps = kind === 'orchard' ? 6 + Math.floor(h(6) * 2) : 7 + Math.floor(h(6) * 4),
    n = 72;
  const ring = Array.from({ length: n }, (_, k) => {
    const a = (k * Math.PI * 2) / n;
    const mass = 0.8 + 0.1 * Math.sin(a * 2 + phase2) + 0.06 * Math.sin(a * 3 + phase) + 0.05 * h(40 + Math.floor((k * bumps) / n));
    const scallop = Math.pow(Math.abs(Math.sin((a * bumps) / 2 + phase)), 0.4);
    const lobe = mass * (0.8 + 0.2 * scallop);
    return { x: Math.cos(a) * r * lobe * stretch, y: Math.sin(a) * r * lobe };
  });
  const mono = ['engraving', 'blueprint', 'night'].includes(pal.name);
  // On parchment the wash is let down toward the sepia of the sheet, so woods sit in the paper rather than on it.
  const crown = pal.name === 'parchment' ? mix(mix(canopyColor(pal, tone), mix(pal.paper, pal.ink, 0.42), 0.2), pal.treeInk, 0.14) : canopyColor(pal, tone);
  const ink = mono ? pal.treeInk : mix(pal.treeInk, pal.ink, 0.35);
  // Shadow side hatching, lower right (light from the upper left like the relief): short parallel pen strokes inside the crown.
  const hatch: LeafShape[] = [];
  for (let i = 0; i < (kind === 'orchard' ? 2 : 4); i++) {
    const d = r * (0.3 + 0.15 * i),
      half = Math.sqrt(Math.max(0, (r * 0.74) ** 2 - d * d)) * 0.62;
    if (half < r * 0.08) continue;
    const cx = d * 0.7071,
      cy = d * 0.7071;
    hatch.push({
      points: [
        { x: cx - half * 0.7071, y: cy + half * 0.7071 },
        { x: cx + half * 0.7071, y: cy - half * 0.7071 },
      ],
      fill: ink,
      alpha: 0.42,
      line: 0.26,
      open: true,
    });
  }
  // Pen and wash: cast shadow, wash, shaded lower side, lit upper side, hatching, then a fine ink contour.
  return [
    { points: ring.map(p => ({ x: p.x + 0.7, y: p.y + 0.95 })), fill: pal.treeInk, alpha: 0.22 },
    // Slightly translucent wash: the hill shading of the sheet still reads through the wood.
    { points: ring, fill: crown, alpha: pal.name === 'parchment' ? 0.9 : 0.96 },
    { points: ring.map(p => ({ x: p.x * 0.8 + r * 0.14, y: p.y * 0.8 + r * 0.16 })), fill: mix(crown, pal.treeInk, 0.5), alpha: 0.58 },
    { points: ring.map(p => ({ x: p.x * 0.58 - r * 0.2, y: p.y * 0.58 - r * 0.2 })), fill: mix(crown, pal.paper, 0.38), alpha: 0.82 },
    ...(snow > 0 ? [{ points: ring.map(p => ({ x: p.x * 0.7 - r * 0.15, y: p.y * 0.7 - r * 0.17 })), fill: SNOW, alpha: 0.8 * snow }] : []),
    ...hatch,
    { points: ring, fill: ink, alpha: 0.72, line: kind === 'orchard' ? 0.3 : 0.34 },
  ];
}

/** Conifer crown seen from above (satellite view): a dense, slightly irregular rounded mass with a soft rim of
 * bough clusters, a lit upper-left flank, a darker shaded lower right and a dark core. No radiating spikes. */
function coniferGlyph(variant: number, pal: Palette, tone: number): LeafShape[] {
  const h = (salt: number): number => hash3(variant, 307, salt);
  const r = 4.7 * (0.92 + 0.16 * h(1)),
    phase = h(3) * Math.PI * 2,
    phase2 = h(5) * Math.PI * 2,
    n = 56,
    stretch = 1 + 0.1 * h(6);
  const clusters = 9 + Math.floor(h(2) * 4);
  const ring = (scale: number, dx = 0, dy = 0): Vec2[] =>
    Array.from({ length: n }, (_, k) => {
      const a = (k * Math.PI * 2) / n;
      const mass = 0.86 + 0.07 * Math.sin(a * 2 + phase2) + 0.04 * Math.sin(a * 3 + phase) + 0.04 * h(40 + Math.floor((k * clusters) / n));
      const soft = 0.93 + 0.07 * Math.pow(Math.abs(Math.sin((a * clusters) / 2 + phase)), 0.6);
      const rr = r * mass * soft * scale;
      return { x: Math.cos(a) * rr * stretch + dx, y: Math.sin(a) * rr + dy };
    });
  const mono = ['engraving', 'blueprint', 'night'].includes(pal.name),
    base = canopyColor(pal, tone);
  const crown = mix(mix(base, pal.treeInk, 0.38), '#1f3a24', mono ? 0 : 0.22);
  const ink = mono ? pal.treeInk : mix(pal.treeInk, pal.ink, 0.35);
  const dark = mix(crown, pal.treeInk, 0.55),
    light = mix(crown, mono ? pal.paper : '#6f8f4e', 0.32);
  // Needle clusters: small lit and shaded blobs scattered inside the crown give the dense textured look.
  const tufts: LeafShape[] = [];
  for (let i = 0; i < 9; i++) {
    const a = h(60 + i) * Math.PI * 2,
      d = r * 0.62 * Math.sqrt(h(80 + i)),
      tr = r * (0.17 + 0.08 * h(100 + i));
    const lit = Math.cos(a) + Math.sin(a) < 0.2;
    tufts.push({ points: Array.from({ length: 10 }, (_, k) => ({ x: Math.cos(a) * d + Math.cos((k * Math.PI) / 5) * tr, y: Math.sin(a) * d + Math.sin((k * Math.PI) / 5) * tr * 0.85 })), fill: lit ? light : dark, alpha: lit ? 0.34 : 0.3 });
  }
  return [
    { points: ring(1, 0.6, 0.85), fill: pal.treeInk, alpha: 0.28 },
    { points: ring(1), fill: crown, alpha: 0.97 },
    { points: ring(0.82, 0.5, 0.6), fill: dark, alpha: 0.5 },
    { points: ring(0.62, -r * 0.16, -r * 0.18), fill: light, alpha: 0.5 },
    ...tufts,
    ...(pal.season?.snow ? [{ points: ring(0.68, -r * 0.14, -r * 0.16), fill: SNOW, alpha: 0.8 * pal.season.snow }] : []),
    { points: ring(0.3, 0.15, 0.2), fill: dark, alpha: 0.6 },
    { points: ring(1), fill: ink, alpha: 0.3, line: 0.22 },
  ];
}

/** Full stamps at accepted centres, shared with Canvas. Only the page boundary clips them. */
export function canopySvg(marks: Mark[], kind: CanopyKind, seed: string, pal: Palette): string {
  const defs = new Map<string, string>(),
    uses: string[] = [];
  for (const m of marks) {
    const { variant, tone } = canopyAppearance(seed, m),
      id = `canopy-${kind}-${variant}-${tone}`;
    if (!defs.has(id))
      defs.set(
        id,
        `<g id="${id}">${canopyGlyph(kind, variant, pal, tone)
          .map(s => `<path d="${s.points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('')}${s.open ? '' : 'Z'}" ${s.line ? `fill="none" stroke="${s.fill}" stroke-width="${s.line}" stroke-linejoin="round"` : `fill="${s.fill}"`} opacity="${s.alpha}"/>`)
          .join('')}</g>`,
      );
    uses.push(`<use href="#${id}" xlink:href="#${id}" transform="translate(${m.x.toFixed(4)} ${m.y.toFixed(4)}) scale(${m.r.toFixed(4)})"/>`);
  }
  return `<defs>${[...defs.values()].join('')}</defs>${uses.join('')}`;
}

/** Cache glyph atlases, not placement tiles: trees never repeat a spatial motif. */
export class CanvasCanopy {
  private cache = new Map<string, { image: CanvasImageSource; bytes: number }>();
  private glyphs = new Map<string, LeafShape[]>();
  private bytes = 0;
  /** Parchment draws real engraved tree shapes (parchmentTrees.ts) instead of the procedural crowns. */
  private engraved: boolean;
  constructor(
    private seed: string,
    private pal: Palette,
    private makeCanvas: (w: number, h: number) => CanvasLike | null,
  ) {
    this.engraved = pal.name === 'parchment';
  }

  /** The snow of the date over what is painted so far (`cx` in glyph units, upper-left light). */
  private paintSnow(cx: CanvasRenderingContext2D, half: number): void {
    const snow = this.pal.season?.snow ?? 0;
    if (!snow) return;
    const cap = cx.createLinearGradient(-half * 0.8, -half * 0.8, half * 0.75, half * 0.75);
    cap.addColorStop(0, `rgba(246,247,243,${0.92 * snow})`);
    cap.addColorStop(0.45, `rgba(246,247,243,${0.6 * snow})`);
    cap.addColorStop(0.75, 'rgba(246,247,243,0)');
    cx.globalCompositeOperation = 'source-atop';
    cx.globalAlpha = 1;
    cx.fillStyle = cap;
    cx.fillRect(-10, -10, 20, 20);
    cx.globalCompositeOperation = 'source-over';
  }
  /** One engraved tree in glyph units around the origin (the atlas cell is 20 units): the crown mask is washed in the
   * tone's colour and shaded from the upper-left light, then the ink strokes, and the cast shadow goes behind. */
  private paintEngraved(cx: CanvasRenderingContext2D, kind: CanopyKind, variant: number, tone: number): void {
    if (kind !== 'conifer' && isBare(kind, variant, this.pal)) {
      this.paint(cx, bareGlyph(kind, variant, this.pal));
      cx.globalAlpha = 1;
      return;
    }
    const pal = this.pal,
      h = (salt: number): number => hash3(variant, kind === 'orchard' ? 211 : kind === 'conifer' ? 307 : 101, salt + 500);
    const pick = (cells: readonly number[], t: number): number => cells[Math.min(cells.length - 1, Math.floor(t * cells.length))];
    let cell = 0,
      span: number;
    if (kind === 'orchard') {
      cell = pick(TREE_CELLS.fruit, h(1));
      span = 10;
    } else if (kind === 'conifer') {
      this.paintConiferCrown(cx, variant, tone, 11 * (0.9 + 0.2 * h(3)), h);
      return;
    } else {
      cell = pick(TREE_CELLS.broadleaf, h(1));
      span = 14.5;
    }
    span *= 0.9 + 0.2 * h(3);
    const angle = (h(4) - 0.5) * 0.9,
      half = span / 2;
    const fill = treeMask(cell, 'fill', pal.treeInk, this.makeCanvas),
      ink = treeMask(cell, 'ink', mix(pal.treeInk, pal.ink, 0.4), this.makeCanvas);
    if (!fill || !ink) return;
    const crown = mix(mix(mix(canopyColor(pal, tone), mix(pal.paper, pal.ink, 0.42), 0.2), pal.treeInk, 0.14), pal.treeInk, 0.2);
    const rgba = (hex: string, a: number): string => {
      const v = parseInt(hex.slice(1, 7), 16);
      return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
    };
    cx.save();
    cx.beginPath();
    cx.rect(-10, -10, 20, 20);
    cx.clip();
    cx.save();
    cx.rotate(angle);
    cx.globalAlpha = 0.96;
    cx.drawImage(fill, -half, -half, span, span);
    cx.restore();
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = crown;
    cx.fillRect(-10, -10, 20, 20);
    const light = cx.createLinearGradient(-half * 0.8, -half * 0.8, half * 0.8, half * 0.8);
    light.addColorStop(0, rgba(pal.paper, 0.2));
    light.addColorStop(0.45, rgba(pal.paper, 0));
    light.addColorStop(0.55, rgba(pal.treeInk, 0));
    light.addColorStop(1, rgba(pal.treeInk, 0.5));
    cx.fillStyle = light;
    cx.fillRect(-10, -10, 20, 20);
    cx.globalCompositeOperation = 'source-over';
    this.paintSnow(cx, half);
    // Twice: the fine engraved strokes stay a firm dark line once the sprite is reduced.
    cx.save();
    cx.rotate(angle);
    cx.globalAlpha = 1;
    cx.drawImage(ink, -half, -half, span, span);
    cx.globalAlpha = 0.6;
    cx.drawImage(ink, -half, -half, span, span);
    cx.restore();
    cx.globalCompositeOperation = 'destination-over';
    cx.globalAlpha = 0.18;
    cx.save();
    cx.translate(0.8, 1.05);
    cx.rotate(angle);
    cx.drawImage(fill, -half, -half, span, span);
    cx.restore();
    cx.restore();
  }

  /** Conifer seen from above: a compact filled crown with 5 to 7 short pointed lobes (three variants), washed, shaded and
   * inked like the round engraved crowns so both read as one family. */
  private paintConiferCrown(cx: CanvasRenderingContext2D, variant: number, tone: number, span: number, h: (salt: number) => number): void {
    const pal = evergreenPalette(this.pal),
      teeth = [8, 10, 11][Math.min(2, Math.floor(h(1) * 3))],
      R = span * 0.44,
      angle = h(4) * Math.PI * 2;
    const trace = (dx: number, dy: number): void => {
      cx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const outer = i % 2 === 0,
          step = Math.PI / teeth,
          a = angle + i * step + (h(30 + i) - 0.5) * step * 0.45;
        const rr = R * (outer ? 0.98 + 0.16 * (h(10 + i) - 0.5) : 0.82 + 0.04 * (h(50 + i) - 0.5));
        const x = dx + Math.cos(a) * rr,
          y = dy + Math.sin(a) * rr;
        if (i === 0) cx.moveTo(x, y);
        else cx.lineTo(x, y);
      }
      cx.closePath();
    };
    const base = mix(mix(mix(canopyColor(pal, tone), mix(pal.paper, pal.ink, 0.42), 0.2), pal.treeInk, 0.14), pal.treeInk, 0.34);
    const crown = mix(base, '#2c4a52', 0.28);
    const rgba = (hex: string, a: number): string => {
      const v = parseInt(hex.slice(1, 7), 16);
      return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
    };
    cx.save();
    cx.beginPath();
    cx.rect(-10, -10, 20, 20);
    cx.clip();
    cx.fillStyle = crown;
    cx.globalAlpha = 0.96;
    trace(0, 0);
    cx.fill();
    cx.globalAlpha = 1;
    const light = cx.createLinearGradient(-R * 0.8, -R * 0.8, R * 0.8, R * 0.8);
    light.addColorStop(0, rgba(pal.paper, 0.2));
    light.addColorStop(0.45, rgba(pal.paper, 0));
    light.addColorStop(0.55, rgba(pal.treeInk, 0));
    light.addColorStop(1, rgba(pal.treeInk, 0.5));
    cx.fillStyle = light;
    trace(0, 0);
    cx.fill();
    cx.fillStyle = rgba(mix(pal.treeInk, '#1c3038', 0.5), 0.38);
    cx.beginPath();
    cx.arc(0, 0, R * 0.36, 0, Math.PI * 2);
    cx.fill();
    this.paintSnow(cx, R);
    cx.strokeStyle = mix(pal.treeInk, pal.ink, 0.4);
    cx.lineWidth = 0.28;
    cx.lineJoin = 'round';
    trace(0, 0);
    cx.stroke();
    cx.globalCompositeOperation = 'destination-over';
    cx.globalAlpha = 0.18;
    cx.fillStyle = pal.treeInk;
    trace(0.8, 1.05);
    cx.fill();
    cx.restore();
  }

  /** One symbol around the origin in glyph units (a 20-unit cell): the ground's tree symbol atlas (treeSymbols.ts) is
   * painted with it. */
  paintSymbol(cx: CanvasRenderingContext2D, species: TreeSpecies, variant: number, tone: number): void {
    if (species === 'bare' || species === 'palm') {
      this.paint(cx, species === 'bare' ? bareGlyph('forest', variant, this.pal) : palmGlyph(variant, this.pal, tone));
      cx.globalAlpha = 1;
    } else this.paintEngraved(cx, species === 'conifer' ? 'conifer' : 'forest', variant, tone);
  }

  private glyph(kind: CanopyKind, variant: number, tone: number): LeafShape[] {
    const key = `${kind}:${variant}:${tone}`;
    let shape = this.glyphs.get(key);
    if (!shape) {
      shape = canopyGlyph(kind, variant, this.pal, tone);
      this.glyphs.set(key, shape);
    }
    return shape;
  }

  /** `conifer(m)` picks an engraved conifer instead of a broadleaf crown for a forest mark (mixed stands). */
  draw(ctx: CanvasRenderingContext2D, marks: Mark[], kind: CanopyKind, scale: number, dpr: number, conifer?: (m: Mark) => boolean): void {
    if (!marks.length) return;
    // Engraved sprites stay in the atlas (at most 4 texels per metre): they are bitmaps, not paths.
    const resolution = this.resolutionFor(scale, dpr);
    if (kind === 'forest' && conifer) {
      // One atlas for both crowns (conifers in the lower half): a mixed stand stays one image source, one GPU sprite batch.
      const mixed = this.mixedAtlas(resolution);
      if (mixed) {
        for (const m of marks) {
          const c = conifer(m);
          this.stamp(ctx, m, c ? 'conifer' : 'forest', mixed, resolution, c ? 12 : 0);
        }
      } else {
        const needles = this.atlas('conifer', resolution),
          leaves = this.atlas('forest', resolution);
        for (const m of marks) {
          const k = conifer(m) ? 'conifer' : 'forest';
          this.stamp(ctx, m, k, k === 'conifer' ? needles : leaves, resolution);
        }
      }
      ctx.globalAlpha = 1;
      return;
    }
    const atlas = this.atlas(kind, resolution);
    for (const m of marks) this.stamp(ctx, m, kind, atlas, resolution);
    ctx.globalAlpha = 1;
  }

  /** Atlas texels per metre `draw` uses at this scale. */
  resolutionFor(scale: number, dpr: number): number {
    return Math.min(this.engraved ? 4 : Infinity, Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, scale * dpr)))));
  }
  /** What `draw` stamps for `marks`, as data: the atlas and 8 floats per mark (sx, sy, sw, sh, dx, dy, dw, dh), same
   * order, alpha 1. Undefined where `draw` paints vector glyphs instead (no atlas at this resolution). */
  spriteData(marks: readonly Mark[], kind: CanopyKind, scale: number, dpr: number, conifer?: (m: Mark) => boolean): { image: CanvasImageSource; data: Float32Array } | undefined {
    const resolution = this.resolutionFor(scale, dpr),
      mixed = kind === 'forest' && !!conifer;
    const atlas = mixed ? this.mixedAtlas(resolution) : this.atlas(kind, resolution);
    if (!atlas) return undefined;
    const cell = 20 * resolution,
      data = new Float32Array(marks.length * 8);
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i],
        { variant, tone } = canopyAppearance(this.seed, m),
        o = i * 8;
      data[o] = variant * cell;
      data[o + 1] = (tone + (mixed && conifer!(m) ? 12 : 0)) * cell;
      data[o + 2] = cell;
      data[o + 3] = cell;
      data[o + 4] = m.x - 10 * m.r;
      data[o + 5] = m.y - 10 * m.r;
      data[o + 6] = 20 * m.r;
      data[o + 7] = 20 * m.r;
    }
    return { image: atlas.image, data };
  }

  private stamp(ctx: CanvasRenderingContext2D, m: Mark, kind: CanopyKind, atlas: { image: CanvasImageSource } | undefined, resolution: number, row = 0): void {
    const { variant, tone } = canopyAppearance(this.seed, m),
      cell = 20 * resolution;
    if (atlas) {
      ctx.globalAlpha = 1;
      ctx.drawImage(atlas.image, variant * cell, (tone + row) * cell, cell, cell, m.x - 10 * m.r, m.y - 10 * m.r, 20 * m.r, 20 * m.r);
    } else {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.scale(m.r, m.r);
      this.paint(ctx, this.glyph(kind, variant, tone));
      ctx.restore();
    }
  }

  /** Broadleaf atlas over the conifer atlas, rows 0-11 and 12-23; undefined where either is. */
  private mixedAtlas(resolution: number): { image: CanvasImageSource; bytes: number } | undefined {
    const key = `mixed:${resolution}`,
      cell = 20 * resolution;
    let atlas = this.cache.get(key);
    if (atlas) {
      this.cache.delete(key);
      this.cache.set(key, atlas);
      return atlas;
    }
    const leaves = this.atlas('forest', resolution),
      needles = this.atlas('conifer', resolution);
    if (!leaves || !needles) return undefined;
    const width = 24 * cell,
      height = 24 * cell,
      canvas = this.makeCanvas(width, height),
      cx = canvas?.getContext('2d');
    if (!canvas || !cx) return undefined;
    cx.drawImage(leaves.image, 0, 0);
    cx.drawImage(needles.image, 0, 12 * cell);
    atlas = { image: canvas as unknown as CanvasImageSource, bytes: width * height * 4 };
    while (this.bytes + atlas.bytes > SPRITE_BYTES && this.cache.size) {
      const first = this.cache.keys().next().value!;
      this.bytes -= this.cache.get(first)!.bytes;
      this.cache.delete(first);
    }
    this.cache.set(key, atlas);
    this.bytes += atlas.bytes;
    return atlas;
  }

  private atlas(kind: CanopyKind, resolution: number): { image: CanvasImageSource; bytes: number } | undefined {
    const key = `${kind}:${resolution}`,
      cell = 20 * resolution;
    let atlas = this.cache.get(key);
    // At extreme zoom keep the actual vector paths instead of enlarging bitmaps or allocating huge atlases.
    if (!atlas && resolution <= 4) {
      const width = 24 * cell,
        height = 12 * cell,
        canvas = this.makeCanvas(width, height),
        cx = canvas?.getContext('2d');
      if (canvas && cx) {
        for (let tone = 0; tone < 12; tone++)
          for (let variant = 0; variant < 24; variant++) {
            cx.setTransform(resolution, 0, 0, resolution, (variant + 0.5) * cell, (tone + 0.5) * cell);
            if (this.engraved) this.paintEngraved(cx, kind, variant, tone);
            else this.paint(cx, this.glyph(kind, variant, tone), 1.3 / resolution);
          }
        atlas = { image: canvas as unknown as CanvasImageSource, bytes: width * height * 4 };
        while (this.bytes + atlas.bytes > SPRITE_BYTES && this.cache.size) {
          const first = this.cache.keys().next().value!;
          this.bytes -= this.cache.get(first)!.bytes;
          this.cache.delete(first);
        }
        this.cache.set(key, atlas);
        this.bytes += atlas.bytes;
      }
    } else if (atlas) {
      this.cache.delete(key);
      this.cache.set(key, atlas);
    }
    return atlas;
  }

  private paint(ctx: CanvasRenderingContext2D, shapes: LeafShape[], minLine = 0): void {
    for (const s of shapes) {
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      if (!s.open) ctx.closePath();
      ctx.globalAlpha = s.alpha;
      if (s.line) {
        ctx.strokeStyle = s.fill;
        ctx.lineWidth = Math.max(s.line, minLine);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      } else {
        ctx.fillStyle = s.fill;
        ctx.fill();
      }
    }
  }

  dispose(): void {
    this.cache.clear();
    this.glyphs.clear();
    this.bytes = 0;
  }
}
