import type { Vec2 } from '../gen/types';
import type { Palette } from './styles';
import type { CanvasLike } from './canvas';
import { brushHash } from './brushes';
import { hash3, insideArea, orchardMarks, type TextureLayer, type Mark } from './scene';
import { TileIndex, boxesOf } from './tileindex';
import { TREE_CELLS, treeMask } from './parchmentTrees';

export type VegetationStyle = 'classic' | 'canopy';
/** `conifer` is a forest crown drawn as an engraved star of boughs (cold and mixed woods). */
export type CanopyKind = 'forest' | 'orchard' | 'conifer';
/** A filled shape, or with `line` a closed ink contour of that width (glyph units). */
interface LeafShape { points: Vec2[]; fill: string; alpha: number; line?: number; /** Polyline: the contour stays open. */ open?: boolean }
export const CANOPY_MARGIN = 12;
const SPRITE_BYTES = 32 * 1024 * 1024;  // broadleaf, conifer and orchard atlases at 4x

function mix(a: string, b: string, t: number): string {
  if (!/^#[\da-f]{6}$/i.test(a) || !/^#[\da-f]{6}$/i.test(b)) return a;
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t)
    + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
}

/** Global candidates with a local exclusion radius: no repeated tile and no visible grid.
 * A tile owns centres, never clips crowns. Neighbours participate even outside the tile. */
export function canopyMarks(layer: TextureLayer, tile: number, seed: string): Mark[] {
  if (layer.kind === 'orchard') return orchardMarks(layer, tile, seed);
  const orchard = false, spacing = 6;
  const salt = Math.floor(brushHash(seed, 0, 0, orchard ? 211 : 101) * 0x7fffffff);
  const rect = layer.index.tileRect(tile), ids = layer.index.itemsOf(tile), out: Mark[] = [];
  const candidate = (i: number, j: number) => ({ x: (i + (orchard ? .5 : hash3(i, j, salt))) * spacing,
    y: (j + (orchard ? .5 : hash3(i, j, salt + 7))) * spacing, priority: hash3(i, j, salt + 17) });
  for (let j = Math.floor(rect.minY / spacing) - 1; j <= Math.ceil(rect.maxY / spacing); j++) {
    for (let i = Math.floor(rect.minX / spacing) - 1; i <= Math.ceil(rect.maxX / spacing); i++) {
      const p = candidate(i, j);
      if (p.x < rect.minX || p.x >= rect.maxX || p.y < rect.minY || p.y >= rect.maxY) continue;
      if (!orchard) {
        let crowded = false;
        for (let dy = -1; dy <= 1 && !crowded; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const q = candidate(i + dx, j + dy);
          if (q.priority < p.priority && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 4.5 ** 2) { crowded = true; break; }
        }
        if (crowded) continue;
      }
      for (const id of ids) if (insideArea(layer.areas[id], p.x, p.y)) {
        const size = hash3(i, j, salt + 23);
        // Wide spread of crown sizes, with a few emergent trees standing over the canopy.
        out.push({ x: p.x, y: p.y, r: size > .94 ? 1.35 + (size - .94) * 4 : .72 + .55 * size * size, k: hash3(i, j, salt + 29) }); break;
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
  return layer.index.tilesInRect({ minX: 0, minY: 0, maxX: mapSize, maxY: mapSize })
    .flatMap(tile => canopyMarks(layer, tile, seed)).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Small hue and lightness differences, while monochrome palettes stay monochrome. */
export function canopyColor(pal: Palette, tone: number): string {
  const hue = Math.floor(tone / 4), mono = ['engraving', 'blueprint', 'night'].includes(pal.name);
  const base = mono || !hue ? pal.treeFill : mix(pal.treeFill, hue === 1 ? '#b2ad63' : '#67998c', .14);
  return mix(base, pal.treeInk, .06 + (tone % 4) * .075);
}

export function canopyGlyph(kind: CanopyKind, variant: number, pal: Palette, tone: number): LeafShape[] {
  if (kind === 'conifer') return coniferGlyph(variant, pal, tone);
  const h = (salt: number): number => hash3(variant, kind === 'orchard' ? 211 : 101, salt);
  const r = kind === 'orchard' ? 3.8 : 6.1, phase = h(4) * Math.PI * 2, phase2 = h(7) * Math.PI * 2, stretch = 1 + .12 * h(5);
  // Engraved crown: an irregular round mass whose rim is a chain of small scallops (leaf clusters), never a smooth disc.
  const bumps = kind === 'orchard' ? 6 + Math.floor(h(6) * 2) : 7 + Math.floor(h(6) * 4), n = 72;
  const ring = Array.from({ length: n }, (_, k) => {
    const a = k * Math.PI * 2 / n;
    const mass = .8 + .1 * Math.sin(a * 2 + phase2) + .06 * Math.sin(a * 3 + phase) + .05 * h(40 + Math.floor(k * bumps / n));
    const scallop = Math.pow(Math.abs(Math.sin(a * bumps / 2 + phase)), .4);
    const lobe = mass * (.8 + .2 * scallop);
    return { x: Math.cos(a) * r * lobe * stretch, y: Math.sin(a) * r * lobe };
  });
  const mono = ['engraving', 'blueprint', 'night'].includes(pal.name);
  // On parchment the wash is let down toward the sepia of the sheet, so woods sit in the paper rather than on it.
  const crown = pal.name === 'parchment' ? mix(mix(canopyColor(pal, tone), mix(pal.paper, pal.ink, .42), .2), pal.treeInk, .14) : canopyColor(pal, tone);
  const ink = mono ? pal.treeInk : mix(pal.treeInk, pal.ink, .35);
  // Shadow side hatching, lower right (light from the upper left like the relief): short parallel pen strokes inside the crown.
  const hatch: LeafShape[] = [];
  for (let i = 0; i < (kind === 'orchard' ? 2 : 4); i++) {
    const d = r * (.3 + .15 * i), half = Math.sqrt(Math.max(0, (r * .74) ** 2 - d * d)) * .62;
    if (half < r * .08) continue;
    const cx = d * .7071, cy = d * .7071;
    hatch.push({ points: [{ x: cx - half * .7071, y: cy + half * .7071 }, { x: cx + half * .7071, y: cy - half * .7071 }], fill: ink, alpha: .42, line: .26, open: true });
  }
  // Pen and wash: cast shadow, wash, shaded lower side, lit upper side, hatching, then a fine ink contour.
  return [
    { points: ring.map(p => ({ x: p.x + .7, y: p.y + .95 })), fill: pal.treeInk, alpha: .22 },
    // Slightly translucent wash: the hill shading of the sheet still reads through the wood.
    { points: ring, fill: crown, alpha: pal.name === 'parchment' ? .9 : .96 },
    { points: ring.map(p => ({ x: p.x * .8 + r * .14, y: p.y * .8 + r * .16 })), fill: mix(crown, pal.treeInk, .5), alpha: .58 },
    { points: ring.map(p => ({ x: p.x * .58 - r * .2, y: p.y * .58 - r * .2 })), fill: mix(crown, pal.paper, .38), alpha: .82 },
    ...hatch,
    { points: ring, fill: ink, alpha: .72, line: kind === 'orchard' ? .3 : .34 },
  ];
}

/** Engraved conifer seen from above: a star of boughs, lit half and shaded half, ink rays and a dark leader at the centre. */
function coniferGlyph(variant: number, pal: Palette, tone: number): LeafShape[] {
  const h = (salt: number): number => hash3(variant, 307, salt);
  const r = 4.9 * (.9 + .2 * h(1)), points = 8 + Math.floor(h(2) * 4), phase = h(3) * Math.PI * 2;
  const star = Array.from({ length: points * 2 }, (_, k) => {
    const a = phase + k * Math.PI / points, out = k % 2 === 0, rr = r * (out ? .88 + .14 * h(10 + k) : .5 + .08 * h(10 + k));
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
  });
  const mono = ['engraving', 'blueprint', 'night'].includes(pal.name), base = canopyColor(pal, tone);
  const crown = mix(pal.name === 'parchment' ? mix(mix(base, mix(pal.paper, pal.ink, .42), .2), pal.treeInk, .14) : base, pal.treeInk, .22);
  const ink = mono ? pal.treeInk : mix(pal.treeInk, pal.ink, .35);
  // Shaded half towards the lower right, the side away from the light.
  const shade = [{ x: 0, y: 0 }, ...star.filter(p => p.x + p.y > -r * .15)];
  const rays: LeafShape[] = star.filter((_, k) => k % 2 === 0).map(p => ({ points: [{ x: p.x * .15, y: p.y * .15 }, { x: p.x * .8, y: p.y * .8 }], fill: ink, alpha: .34, line: .24, open: true }));
  return [
    { points: star.map(p => ({ x: p.x + .6, y: p.y + .85 })), fill: pal.treeInk, alpha: .26 },
    { points: star, fill: crown, alpha: .94 },
    { points: shade, fill: mix(crown, pal.treeInk, .45), alpha: .55 },
    ...rays,
    { points: star, fill: ink, alpha: .72, line: .3 },
    { points: Array.from({ length: 8 }, (_, k) => ({ x: Math.cos(k * Math.PI / 4) * .55, y: Math.sin(k * Math.PI / 4) * .55 })), fill: ink, alpha: .7 },
  ];
}

/** Full stamps at accepted centres, shared with Canvas. Only the page boundary clips them. */
export function canopySvg(marks: Mark[], kind: CanopyKind, seed: string, pal: Palette): string {
  const defs = new Map<string, string>(), uses: string[] = [];
  for (const m of marks) {
    const { variant, tone } = canopyAppearance(seed, m), id = `canopy-${kind}-${variant}-${tone}`;
    if (!defs.has(id)) defs.set(id, `<g id="${id}">${canopyGlyph(kind, variant, pal, tone).map(s =>
      `<path d="${s.points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('')}${s.open ? '' : 'Z'}" ${s.line ? `fill="none" stroke="${s.fill}" stroke-width="${s.line}" stroke-linejoin="round"` : `fill="${s.fill}"`} opacity="${s.alpha}"/>`).join('')}</g>`);
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
  constructor(private seed: string, private pal: Palette, private makeCanvas: (w: number, h: number) => CanvasLike | null) {
    this.engraved = pal.name === 'parchment';
  }

  /** One engraved tree in glyph units around the origin (the atlas cell is 20 units): the crown mask is washed in the
   * tone's colour and shaded from the upper-left light, then the ink strokes, and the cast shadow goes behind. */
  private paintEngraved(cx: CanvasRenderingContext2D, kind: CanopyKind, variant: number, tone: number): void {
    const pal = this.pal, h = (salt: number): number => hash3(variant, kind === 'orchard' ? 211 : kind === 'conifer' ? 307 : 101, salt + 500);
    const pick = (cells: readonly number[], t: number): number => cells[Math.min(cells.length - 1, Math.floor(t * cells.length))];
    let cell: number, span: number, rotate = true;
    if (kind === 'orchard') { cell = pick(TREE_CELLS.fruit, h(1)); span = 10; }
    else if (kind === 'conifer') { const side = h(2) < .4; cell = pick(side ? TREE_CELLS.coniferSide : TREE_CELLS.coniferPlan, h(1)); span = side ? 12.5 : 12; rotate = !side; }
    else if (variant === 23) { cell = pick(TREE_CELLS.clump, h(1)); span = 19; }
    else { cell = pick(TREE_CELLS.broadleaf, h(1)); span = 14.5; }
    span *= .9 + .2 * h(3);
    const angle = rotate ? (h(4) - .5) * .9 : 0, half = span / 2;
    const fill = treeMask(cell, 'fill', pal.treeInk, this.makeCanvas), ink = treeMask(cell, 'ink', mix(pal.treeInk, pal.ink, .4), this.makeCanvas);
    if (!fill || !ink) return;
    const crown = mix(mix(mix(canopyColor(pal, tone), mix(pal.paper, pal.ink, .42), .2), pal.treeInk, .14), pal.treeInk, kind === 'conifer' ? .34 : .2);
    const rgba = (hex: string, a: number): string => { const v = parseInt(hex.slice(1, 7), 16); return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`; };
    cx.save(); cx.beginPath(); cx.rect(-10, -10, 20, 20); cx.clip();
    cx.save(); cx.rotate(angle); cx.globalAlpha = .96; cx.drawImage(fill, -half, -half, span, span); cx.restore();
    cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-atop'; cx.fillStyle = crown; cx.fillRect(-10, -10, 20, 20);
    const light = cx.createLinearGradient(-half * .8, -half * .8, half * .8, half * .8);
    light.addColorStop(0, rgba(pal.paper, .2)); light.addColorStop(.45, rgba(pal.paper, 0)); light.addColorStop(.55, rgba(pal.treeInk, 0)); light.addColorStop(1, rgba(pal.treeInk, .5));
    cx.fillStyle = light; cx.fillRect(-10, -10, 20, 20);
    cx.globalCompositeOperation = 'source-over';
    // Twice: the fine engraved strokes stay a firm dark line once the sprite is reduced.
    cx.save(); cx.rotate(angle); cx.globalAlpha = 1; cx.drawImage(ink, -half, -half, span, span); cx.globalAlpha = .6; cx.drawImage(ink, -half, -half, span, span); cx.restore();
    cx.globalCompositeOperation = 'destination-over'; cx.globalAlpha = .18;
    cx.save(); cx.translate(.8, 1.05); cx.rotate(angle); cx.drawImage(fill, -half, -half, span, span); cx.restore();
    cx.restore();
  }

  private glyph(kind: CanopyKind, variant: number, tone: number): LeafShape[] {
    const key = `${kind}:${variant}:${tone}`;
    let shape = this.glyphs.get(key);
    if (!shape) { shape = canopyGlyph(kind, variant, this.pal, tone); this.glyphs.set(key, shape); }
    return shape;
  }

  /** `conifer(m)` picks an engraved conifer instead of a broadleaf crown for a forest mark (mixed stands). */
  draw(ctx: CanvasRenderingContext2D, marks: Mark[], kind: CanopyKind, scale: number, dpr: number, conifer?: (m: Mark) => boolean): void {
    if (!marks.length) return;
    // Engraved sprites stay in the atlas (at most 4 texels per metre): they are bitmaps, not paths.
    const resolution = Math.min(this.engraved ? 4 : Infinity, Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, scale * dpr)))));
    if (kind === 'forest' && conifer) {
      const needles = this.atlas('conifer', resolution), leaves = this.atlas('forest', resolution);
      for (const m of marks) {
        const k = conifer(m) ? 'conifer' : 'forest';
        this.stamp(ctx, m, k, k === 'conifer' ? needles : leaves, resolution);
      }
      ctx.globalAlpha = 1; return;
    }
    const atlas = this.atlas(kind, resolution);
    for (const m of marks) this.stamp(ctx, m, kind, atlas, resolution);
    ctx.globalAlpha = 1;
  }

  private stamp(ctx: CanvasRenderingContext2D, m: Mark, kind: CanopyKind, atlas: { image: CanvasImageSource } | undefined, resolution: number): void {
    const { variant, tone } = canopyAppearance(this.seed, m), cell = 20 * resolution;
    if (atlas) {
      ctx.globalAlpha = 1;
      ctx.drawImage(atlas.image, variant * cell, tone * cell, cell, cell, m.x - 10 * m.r, m.y - 10 * m.r, 20 * m.r, 20 * m.r);
    } else {
      ctx.save(); ctx.translate(m.x, m.y); ctx.scale(m.r, m.r);
      this.paint(ctx, this.glyph(kind, variant, tone)); ctx.restore();
    }
  }

  private atlas(kind: CanopyKind, resolution: number): { image: CanvasImageSource; bytes: number } | undefined {
    const key = `${kind}:${resolution}`, cell = 20 * resolution;
    let atlas = this.cache.get(key);
    // At extreme zoom keep the actual vector paths instead of enlarging bitmaps or allocating huge atlases.
    if (!atlas && resolution <= 4) {
      const width = 24 * cell, height = 12 * cell, canvas = this.makeCanvas(width, height), cx = canvas?.getContext('2d');
      if (canvas && cx) {
        for (let tone = 0; tone < 12; tone++) for (let variant = 0; variant < 24; variant++) {
          cx.setTransform(resolution, 0, 0, resolution, (variant + .5) * cell, (tone + .5) * cell);
          if (this.engraved) this.paintEngraved(cx, kind, variant, tone);
          else this.paint(cx, this.glyph(kind, variant, tone), 1.3 / resolution);
        }
        atlas = { image: canvas as unknown as CanvasImageSource, bytes: width * height * 4 };
        while (this.bytes + atlas.bytes > SPRITE_BYTES && this.cache.size) {
          const first = this.cache.keys().next().value!; this.bytes -= this.cache.get(first)!.bytes; this.cache.delete(first);
        }
        this.cache.set(key, atlas); this.bytes += atlas.bytes;
      }
    } else if (atlas) { this.cache.delete(key); this.cache.set(key, atlas); }
    return atlas;
  }

  private paint(ctx: CanvasRenderingContext2D, shapes: LeafShape[], minLine = 0): void {
    for (const s of shapes) {
      ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      if (!s.open) ctx.closePath();
      ctx.globalAlpha = s.alpha;
      if (s.line) { ctx.strokeStyle = s.fill; ctx.lineWidth = Math.max(s.line, minLine); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
      else { ctx.fillStyle = s.fill; ctx.fill(); }
    }
  }

  dispose(): void { this.cache.clear(); this.glyphs.clear(); this.bytes = 0; }
}
