import type { Vec2 } from '../gen/types';
import type { Palette } from './styles';
import type { CanvasLike } from './canvas';
import { brushHash } from './brushes';
import { hash3, insideArea, type TextureLayer, type Mark } from './scene';
import { TileIndex, boxesOf } from './tileindex';

export type VegetationStyle = 'classic' | 'canopy';
export type CanopyKind = 'forest' | 'orchard';
interface LeafShape { points: Vec2[]; fill: string; alpha: number }
export const CANOPY_MARGIN = 12;
const SPRITE_BYTES = 16 * 1024 * 1024;

function mix(a: string, b: string, t: number): string {
  if (!/^#[\da-f]{6}$/i.test(a) || !/^#[\da-f]{6}$/i.test(b)) return a;
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t)
    + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
}

/** Global candidates with a local exclusion radius: no repeated tile and no visible grid.
 * A tile owns centres, never clips crowns. Neighbours participate even outside the tile. */
export function canopyMarks(layer: TextureLayer, tile: number, seed: string): Mark[] {
  const orchard = layer.kind === 'orchard', spacing = orchard ? 11 : 6;
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
        out.push({ x: p.x, y: p.y, r: .8 + .3 * hash3(i, j, salt + 23), k: hash3(i, j, salt + 29) }); break;
      }
    }
  }
  return out;
}

export function canopyAppearance(seed: string, m: Mark): { variant: number; tone: number } {
  return { variant: Math.floor(m.k * 24), tone: Math.floor(brushHash(seed, m.x, m.y, 83) * 12) };
}

export function canopyAreaMarks(areas: TextureLayer['areas'], kind: CanopyKind, mapSize: number, seed: string): Mark[] {
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
  const h = (salt: number): number => hash3(variant, kind === 'orchard' ? 211 : 101, salt);
  const r = kind === 'orchard' ? 3.8 : 6.1, phase = h(4) * Math.PI * 2;
  const ring = Array.from({ length: 24 }, (_, k) => {
    const a = k * Math.PI / 12, lobe = .66 + .30 * h(40 + k) + .09 * Math.sin(a * 3 + phase);
    return { x: Math.cos(a) * r * lobe * (1 + .18 * h(5)), y: Math.sin(a) * r * lobe };
  });
  const crown = canopyColor(pal, tone);
  return [
    { points: ring.map(p => ({ x: p.x + .65, y: p.y + .9 })), fill: pal.treeInk, alpha: .18 },
    { points: ring, fill: crown, alpha: .96 },
    { points: ring.map(p => ({ x: p.x * .64 - r * .18, y: p.y * .64 - r * .18 })), fill: mix(crown, pal.paper, .28), alpha: .8 },
  ];
}

/** Full stamps at accepted centres, shared with Canvas. Only the page boundary clips them. */
export function canopySvg(marks: Mark[], kind: CanopyKind, seed: string, pal: Palette): string {
  const defs = new Map<string, string>(), uses: string[] = [];
  for (const m of marks) {
    const { variant, tone } = canopyAppearance(seed, m), id = `canopy-${kind}-${variant}-${tone}`;
    if (!defs.has(id)) defs.set(id, `<g id="${id}">${canopyGlyph(kind, variant, pal, tone).map(s =>
      `<path d="${s.points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('')}Z" fill="${s.fill}" opacity="${s.alpha}"/>`).join('')}</g>`);
    uses.push(`<use href="#${id}" xlink:href="#${id}" transform="translate(${m.x.toFixed(4)} ${m.y.toFixed(4)}) scale(${m.r.toFixed(4)})"/>`);
  }
  return `<defs>${[...defs.values()].join('')}</defs>${uses.join('')}`;
}

/** Cache glyph atlases, not placement tiles: trees never repeat a spatial motif. */
export class CanvasCanopy {
  private cache = new Map<string, { image: CanvasImageSource; bytes: number }>();
  private glyphs = new Map<string, LeafShape[]>();
  private bytes = 0;
  constructor(private seed: string, private pal: Palette, private makeCanvas: (w: number, h: number) => CanvasLike | null) {}

  private glyph(kind: CanopyKind, variant: number, tone: number): LeafShape[] {
    const key = `${kind}:${variant}:${tone}`;
    let shape = this.glyphs.get(key);
    if (!shape) { shape = canopyGlyph(kind, variant, this.pal, tone); this.glyphs.set(key, shape); }
    return shape;
  }

  draw(ctx: CanvasRenderingContext2D, marks: Mark[], kind: CanopyKind, scale: number, dpr: number): void {
    if (!marks.length) return;
    const resolution = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, scale * dpr))));
    const key = `${kind}:${resolution}`, cell = 20 * resolution;
    let atlas = this.cache.get(key);
    // At extreme zoom keep the actual vector paths instead of enlarging bitmaps or allocating huge atlases.
    if (!atlas && resolution <= 4) {
      const width = 24 * cell, height = 12 * cell, canvas = this.makeCanvas(width, height), cx = canvas?.getContext('2d');
      if (canvas && cx) {
        for (let tone = 0; tone < 12; tone++) for (let variant = 0; variant < 24; variant++) {
          cx.setTransform(resolution, 0, 0, resolution, (variant + .5) * cell, (tone + .5) * cell);
          this.paint(cx, this.glyph(kind, variant, tone));
        }
        atlas = { image: canvas as unknown as CanvasImageSource, bytes: width * height * 4 };
        while (this.bytes + atlas.bytes > SPRITE_BYTES && this.cache.size) {
          const first = this.cache.keys().next().value!; this.bytes -= this.cache.get(first)!.bytes; this.cache.delete(first);
        }
        this.cache.set(key, atlas); this.bytes += atlas.bytes;
      }
    } else if (atlas) { this.cache.delete(key); this.cache.set(key, atlas); }
    for (const m of marks) {
      const { variant, tone } = canopyAppearance(this.seed, m);
      if (atlas) {
        ctx.globalAlpha = 1;
        ctx.drawImage(atlas.image, variant * cell, tone * cell, cell, cell, m.x - 10 * m.r, m.y - 10 * m.r, 20 * m.r, 20 * m.r);
      } else {
        ctx.save(); ctx.translate(m.x, m.y); ctx.scale(m.r, m.r);
        this.paint(ctx, this.glyph(kind, variant, tone)); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  private paint(ctx: CanvasRenderingContext2D, shapes: LeafShape[]): void {
    for (const s of shapes) {
      ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.closePath(); ctx.fillStyle = s.fill; ctx.globalAlpha = s.alpha; ctx.fill();
    }
  }

  dispose(): void { this.cache.clear(); this.glyphs.clear(); this.bytes = 0; }
}
