/**
 * Texture layers: the marks of woods, orchards and open land (vector circles, tufts and reeds, the parchment pen
 * symbols, lone trees at the wood edge) and their dispatch to the woods sprites or the layer tiles.
 * Reads: scene, world, palette, canopy, brushes, activeLight, activeDpr. Writes: the path cache, penMarks, penSheets,
 * strayMarks.
 */
import { cityCountrysideTextureVisible } from '../cityEnvironment';
import { isUnderdarkBiome } from '../../gen/biomes';
import { ParchmentSymbols, SYMBOL_CELLS } from '../parchmentSymbols';
import { CANOPY_MARGIN } from '../canopy';
import { brushTextureOn, isBrushKind } from '../brushes';
import { Palette } from '../styles';
import { orientPos } from '../../gen/geo/poly';
import { TextureLayer, textureMarks, type Mark } from '../scene';
import { Rect4 } from '../view';
import { appendUnderdarkMark, fungalBedLook, underdarkTextureSpec } from '../underdark';
import { RecordingContext } from '../gpu/recorder';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';
import { mixHex, growRect, TAU, frac, clumpNoise, smooth01, addRing } from './geometry';
import { forestClip, forestWeight, forestStray, roomOf } from './forest';
import { LAYER_TILE_REACH, GPU_SPRITE_BUDGET, treeMarksIn, recordTreeSpriteSteps, paintTrees, drawLayerTiles, drawDrapeCanopy } from './woods';

export interface PenMark {
  x: number;
  y: number;
  cell: number;
  size: number;
}
/** Symbol choice for one parchment mark: clumped by noise, sized in metres, or null in a gap. */
function penSymbol(kind: string, m: Mark): Omit<PenMark, 'x' | 'y'> | null {
  const h1 = frac(m.k * 7.31 + 0.17),
    h2 = frac(m.k * 13.7 + 0.41),
    h3 = frac(m.k * 31.3 + 0.73);
  const clump = clumpNoise(m.x, m.y, kind === 'marsh' ? 30 : 46, kind.length);
  const density = kind === 'pasture' ? 0.55 : kind === 'commons' ? 0.8 : 0.9;
  if (h1 > density * (0.06 + 0.94 * smooth01((clump - 0.3) / 0.38))) return null;
  const tuft = (big: number): Omit<PenMark, 'x' | 'y'> => {
    const cell = SYMBOL_CELLS.tuft[Math.floor(h3 * 4)];
    return { cell, size: big * (cell === 3 ? 1.25 : cell === 1 ? 0.8 : 1) * (0.75 + 0.5 * h2) };
  };
  if (kind === 'marsh') return h2 < 0.82 ? { cell: SYMBOL_CELLS.reed[Math.floor(h3 * 4)], size: 7 + 4 * frac(m.k * 5.3) } : tuft(6);
  if (kind === 'commons') {
    if (h2 < 0.38) return { cell: SYMBOL_CELLS.heath[Math.floor(h3 * 3)], size: 5.5 + 3 * frac(m.k * 5.3) };
    if (h2 < 0.52) return { cell: SYMBOL_CELLS.gorse, size: 5.5 + 2 * h3 };
    if (h2 < 0.58) return { cell: h3 < 0.6 ? SYMBOL_CELLS.stones : SYMBOL_CELLS.boulder, size: 4 + 2.5 * frac(m.k * 5.3) };
    return tuft(8);
  }
  if (kind === 'meadow' && h2 < 0.07) return { cell: SYMBOL_CELLS.heath[Math.floor(h3 * 3)], size: 5 + 2.5 * frac(m.k * 5.3) };
  if (kind === 'meadow' && h2 < 0.09) return { cell: SYMBOL_CELLS.gorse, size: 5 + 1.5 * h3 };
  return tuft(kind === 'pasture' ? 6.5 : 9);
}
/** Hand-drawn map symbols for the parchment sheet, in the convention of estate maps: curved grass fans, reed clumps over
 * water dashes, stippled heath. `k` (0-1) varies each mark; strokes only, so the paper shows through. */
function appendPenMark(path: Path2D, shape: 'tuft' | 'reed' | 'dot', x: number, y: number, r: number, k: number): void {
  const h1 = frac(k * 7.31 + 0.17),
    h2 = frac(k * 13.7 + 0.41),
    h3 = frac(k * 31.3 + 0.73);
  if (shape === 'tuft') {
    const n = 3 + Math.floor(h1 * 3),
      lean = (h2 - 0.5) * 0.45,
      size = r * (0.8 + 0.4 * h3);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5,
        j = frac(k * 17.9 + i * 0.618);
      const a = lean + t * 1.25 + (j - 0.5) * 0.18,
        len = size * (1.12 - Math.abs(t) * 0.55) * (0.85 + 0.3 * j);
      const bx = x + t * size * 0.3,
        tx = bx + Math.sin(a) * len,
        ty = y - Math.cos(a) * len;
      path.moveTo(bx, y);
      path.quadraticCurveTo(bx + Math.sin(a * 0.35) * len * 0.5, y - Math.cos(a * 0.35) * len * 0.62, tx, ty);
    }
    if (h3 < 0.4) {
      path.moveTo(x - size * 0.5, y + size * 0.04);
      path.lineTo(x + size * 0.45, y + size * 0.04);
    }
  } else if (shape === 'reed') {
    const n = 3 + Math.floor(h1 * 2),
      lean = (h2 - 0.5) * 0.3;
    for (let i = 0; i < n; i++) {
      const j = frac(k * 23.1 + i * 0.618),
        dx = (i - (n - 1) / 2) * r * 0.3 + (j - 0.5) * r * 0.12,
        hgt = r * (0.85 + 0.55 * j);
      const tx = x + dx + lean * hgt,
        ty = y - hgt;
      path.moveTo(x + dx, y);
      path.quadraticCurveTo(x + dx + lean * hgt * 0.2, y - hgt * 0.55, tx, ty);
      if (i === 1 && h3 > 0.35) {
        path.moveTo(tx + r * 0.07, ty + r * 0.2);
        path.ellipse(tx, ty + r * 0.2, r * 0.07, r * 0.2, 0, 0, TAU);
      }
    }
    path.moveTo(x - r * 0.95, y + r * 0.1);
    path.lineTo(x - r * 0.15, y + r * 0.1);
    path.moveTo(x + r * 0.05, y + r * 0.32);
    path.lineTo(x + r * 0.75, y + r * 0.32);
  } else {
    // Heath stipple: two or three specks, now and then a small ring of specks (a heather cushion).
    const dots = h1 < 0.2 ? 6 : 2 + Math.floor(h2 * 2),
      spread = h1 < 0.2 ? r * 2.1 : r * 1.6;
    for (let i = 0; i < dots; i++) {
      const a = (h1 < 0.2 ? i / dots : frac(k * 11.3 + i * 0.618)) * TAU + h3 * TAU,
        d = h1 < 0.2 ? spread : spread * frac(k * 5.7 + i * 0.382);
      const px = x + Math.cos(a) * d,
        py = y + Math.sin(a) * d,
        pr = r * (0.45 + 0.35 * frac(k * 3.1 + i * 0.29));
      path.moveTo(px + pr, py);
      path.arc(px, py, pr, 0, TAU);
    }
  }
}

interface TexSpec {
  sp: number;
  shape: 'circle' | 'tuft' | 'reed' | 'dot';
  r: number;
  fill?: keyof Palette;
  stroke: keyof Palette;
  alpha: number;
}
const TEX: Record<string, TexSpec> = {
  garden: { sp: 8, shape: 'circle', r: 1.7, fill: 'treeFill', stroke: 'treeInk', alpha: 0.95 },
  field: { sp: 14, shape: 'circle', r: 2.7, fill: 'treeFill', stroke: 'treeInk', alpha: 0.95 },
  forest: { sp: 9, shape: 'circle', r: 3.1, fill: 'treeFill', stroke: 'treeInk', alpha: 0.95 },
  orchard: { sp: 11, shape: 'circle', r: 2.3, fill: 'treeFill', stroke: 'orchardDot', alpha: 0.95 },
  meadow: { sp: 16, shape: 'tuft', r: 3, stroke: 'grass', alpha: 0.9 },
  pasture: { sp: 24, shape: 'tuft', r: 2.4, stroke: 'grass', alpha: 0.8 },
  marsh: { sp: 15, shape: 'reed', r: 3.2, stroke: 'reed', alpha: 0.9 },
  commons: { sp: 18, shape: 'dot', r: 0.7, fill: 'grass', stroke: 'grass', alpha: 0.75 },
};
const TEX_SALT: Record<string, number> = { forest: 11, orchard: 23, meadow: 37, pasture: 41, marsh: 53, commons: 67 };
export function drawTexture(c: CartographyContext, ctx: CanvasRenderingContext2D, tl: TextureLayer, rect: Rect4, band: number, lw: (w: number, m: number) => number, budgetRect: Rect4 = rect): number {
  const steps = drawTextureSteps(c, ctx, tl, rect, band, lw, budgetRect);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
function* drawTextureSteps(c: CartographyContext, ctx: CanvasRenderingContext2D, tl: TextureLayer, rect: Rect4, band: number, lw: (w: number, m: number) => number, budgetRect: Rect4 = rect): Generator<void, number> {
  const { pal, deps, canopy, brushes } = c;
  if (c.activeLight || (c.deps.fullLanduse && !c.deps.fullLanduse(tl.kind))) return 0;
  if ((canopy || brushes) && (tl.kind === 'forest' || tl.kind === 'orchard')) {
    // Select centres inside the cover, then draw whole trees, including overhanging crowns.
    const expanded = growRect(rect, CANOPY_MARGIN),
      count = tl.index.tilesInRect(expanded).length;
    ctx.save();
    if (tl.kind === 'forest') {
      const clip = forestClip(c, rect);
      if (clip) ctx.clip(clip, 'nonzero');
    }
    // GPU engine: the woods become one instanced sprite batch from cached per-tile data; failing that, few enough
    // marks are stamped directly, and more go through the layer tiles below.
    const batched = ctx instanceof RecordingContext && (yield* recordTreeSpriteSteps(c, ctx, tl, expanded, ctx.getTransform().a));
    const direct = !batched && ctx instanceof RecordingContext ? treeMarksIn(c, tl, expanded) : undefined;
    if (batched) {
      /* recorded as one sprite batch */
    } else if (direct && direct.length <= GPU_SPRITE_BUDGET) paintTrees(c, ctx, tl, direct, ctx.getTransform().a);
    // Thousands of sprites per view: stamp them once per density and tile, then reuse the bitmaps while panning and zooming.
    else if (!drawLayerTiles(c, ctx, tl, 'trees', rect, (target, area, pxPerMetre) => paintTrees(c, target, tl, treeMarksIn(c, tl, growRect(area, LAYER_TILE_REACH)), pxPerMetre))) paintTrees(c, ctx, tl, direct ?? treeMarksIn(c, tl, expanded), ctx.getTransform().a);
    ctx.restore();
    return count;
  }
  if (tl.kind !== 'forest') return drawTextureMarks(c, ctx, tl, rect, band, lw, budgetRect);
  ctx.save();
  const clip = forestClip(c, rect);
  if (clip) ctx.clip(clip, 'nonzero');
  try {
    return drawTextureMarks(c, ctx, tl, rect, band, lw, budgetRect);
  } finally {
    ctx.restore();
  }
}
/** Parchment symbol sheet tinted for one land kind, in the palette of the moment. */
function penSheet(c: CartographyContext, kind: string): ParchmentSymbols {
  const { pal, makeCanvas, penSheets } = c;
  const ink = mixHex(pal.inkSoft, kind === 'marsh' ? pal.reed : pal.grass, 0.3),
    wash = mixHex(pal.treeFill, pal.inkSoft, 0.3),
    key = `${ink}|${wash}`;
  let sheet = penSheets.get(key);
  if (!sheet) {
    sheet = new ParchmentSymbols(ink, wash, 0.6, makeCanvas);
    penSheets.set(key, sheet);
  }
  return sheet;
}
/** `area`: only the marks inside it (a layer tile and the reach of its sprites); all marks of `tiles` otherwise. */
function drawPenSymbols(c: CartographyContext, ctx: CanvasRenderingContext2D, tl: TextureLayer, tiles: number[], area?: Rect4): void {
  const sheet = penSheet(c, tl.kind),
    list = penMarkList(c, tl, tiles, area);
  list.sort((a, b) => a.y - b.y);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 0.8;
  for (const m of list) sheet.draw(ctx, m.cell, m.x, m.y, m.size);
  ctx.restore();
}
/** Pen symbol marks of `tiles` (inside `area` when given), unsorted. */
function penMarkList(c: CartographyContext, tl: TextureLayer, tiles: number[], area?: Rect4): PenMark[] {
  const { penMarks } = c;
  const sp = tl.kind === 'pasture' ? 9 : 7.5,
    list: PenMark[] = [];
  for (const t of tiles) {
    const key = `${tl.kind}|${tl.areas.length}|${t}`;
    let marks = penMarks.get(key);
    if (!marks) {
      marks = [];
      for (const m of textureMarks(tl, t, sp, (TEX_SALT[tl.kind] ?? 1) + 101, c.world.seed)) {
        const s = penSymbol(tl.kind, m);
        if (s && (tl.kind !== 'forest' || roomOf(c).keeps(m.x, m.y, m.k, s.size * 0.4))) marks.push({ x: m.x, y: m.y, ...s });
      }
      if (penMarks.size >= 4096) penMarks.delete(penMarks.keys().next().value!);
      penMarks.set(key, marks);
    }
    for (const m of marks) if (!area || (m.x >= area.minX && m.x <= area.maxX && m.y >= area.minY && m.y <= area.maxY)) list.push(m);
  }
  return list;
}
/** Canopy lone trees of an open land layer (cached per index tile); `area` keeps only the marks inside it. */
function drawStrays(c: CartographyContext, ctx: CanvasRenderingContext2D, tl: TextureLayer, tiles: number[], pxPerMetre: number, area?: Rect4): void {
  const { canopy } = c;
  const lone = strayMarkList(c, tl, tiles, area);
  if (!lone.length) return;
  lone.sort((a, b) => a.y - b.y || a.x - b.x);
  canopy!.draw(ctx, lone, 'forest', pxPerMetre, 1);
  ctx.globalAlpha = 1;
}
/** Lone-tree marks of `tiles` (inside `area` when given), unsorted. */
function strayMarkList(c: CartographyContext, tl: TextureLayer, tiles: number[], area?: Rect4): Mark[] {
  const { strayMarks } = c;
  let entries = strayMarks.get(tl);
  if (!entries) {
    entries = new Map();
    strayMarks.set(tl, entries);
  }
  const lone: Mark[] = [];
  for (const t of tiles) {
    let marks = entries.get(t);
    if (!marks) {
      marks = [];
      for (const m of textureMarks(tl, t, TEX.forest.sp, TEX_SALT.forest, c.world.seed)) if (m.k < forestStray(c, m.x, m.y) * 0.5) marks.push({ x: m.x, y: m.y, r: 0.55 + 0.22 * frac(m.k * 9.7), k: frac(m.k * 37.3) });
      if (entries.size >= 512) entries.delete(entries.keys().next().value!);
      entries.set(t, marks);
    }
    for (const m of marks) if (!area || (m.x >= area.minX && m.x <= area.maxX && m.y >= area.minY && m.y <= area.maxY)) lone.push(m);
  }
  return lone;
}
function drawTextureMarks(c: CartographyContext, ctx: CanvasRenderingContext2D, tl: TextureLayer, rect: Rect4, band: number, lw: (w: number, m: number) => number, budgetRect: Rect4): number {
  const { pal, deps, P, canopy, brushes, cached, brushIdOf } = c;
  if (brushes && isBrushKind(tl.kind) && tl.index.tilesInRect(budgetRect).length <= 500) {
    const k = tl.kind,
      sc = ctx.getTransform().a / (deps.dpr ?? 1);
    const pattern = brushes.pattern(ctx, k, sc, deps.dpr ?? 1);
    if (pattern) {
      const id = brushIdOf(tl);
      ctx.fillStyle = pattern;
      for (const i of tl.index.query(rect)) {
        const path = cached(`brush-clip:${id}:${i}`, () => {
          const a = tl.areas[i],
            p = new P();
          addRing(p, orientPos(a.poly));
          for (const h of a.holes ?? []) addRing(p, orientPos(h).slice().reverse());
          return p;
        });
        if (path) ctx.fill(path, 'nonzero');
      }
      return tl.index.tilesInRect(rect).length;
    }
  }
  const underground = isUnderdarkBiome(c.world.options.biome);
  const base = TEX[tl.kind];
  if (!base) return 0;
  const crown = !underground && pal.treeShape === 'crown' && (tl.kind === 'forest' || tl.kind === 'orchard');
  const metric = underdarkTextureSpec(tl.kind);
  const spec: TexSpec = underground
    ? { ...base, sp: metric.spacing, r: metric.radius, fill: ['forest', 'orchard', 'marsh', 'garden', 'field'].includes(tl.kind) ? 'treeFill' : undefined, stroke: ['forest', 'orchard', 'marsh', 'garden', 'field'].includes(tl.kind) ? 'treeInk' : 'grass' }
    : pal.treeShape === 'dot' && (tl.kind === 'forest' || tl.kind === 'orchard')
      ? { ...base, r: base.r * 0.5 }
      : base;
  const tiles = tl.index.tilesInRect(rect);
  if (tl.index.tilesInRect(budgetRect).length > 500) return 0;
  if (underground) {
    // New subterranean marks keep their entire silhouette out of water and reserved holes.
    const id = brushIdOf(tl);
    const clip = cached(`underdark-clip:${id}`, () => {
      const path = new P();
      for (const a of tl.areas) {
        addRing(path, orientPos(a.poly));
        for (const h of a.holes ?? []) addRing(path, orientPos(h).slice().reverse());
      }
      return path;
    });
    ctx.save();
    if (clip) ctx.clip(clip, 'nonzero');
  }
  // Parchment draws its small symbols with the pen of the trees: thin sepia-tinted strokes that sit in the paper.
  const pen = !underground && pal.name === 'parchment';
  // Hand-drawn sheet symbols (parchmentSymbols.ts) replace the vector marks of the open land kinds.
  const sprites = pen && spec.shape !== 'circle';
  // Lone trees at the edge of the woods, drawn as canopy sprites over the open land.
  const strayKind = !underground && (tl.kind === 'commons' || tl.kind === 'pasture' || tl.kind === 'meadow');
  const spriteStrays = strayKind && !!canopy;
  if (sprites) {
    // Thousands of small stamps per view: pre-composited per density and tile like the woods (drawLayerTiles).
    // GPU engine: few enough marks are stamped directly (instanced sprites); more go through the layer tiles.
    const direct = ctx instanceof RecordingContext && penMarkList(c, tl, tiles).length + (spriteStrays ? strayMarkList(c, tl, tiles).length : 0) <= GPU_SPRITE_BUDGET;
    const painted =
      !direct &&
      drawLayerTiles(c, ctx, tl, 'pen', rect, (target, area, pxPerMetre) => {
        const reach = growRect(area, LAYER_TILE_REACH),
          owners = tl.index.tilesInRect(reach);
        drawPenSymbols(c, target, tl, owners, reach);
        if (spriteStrays) drawStrays(c, target, tl, owners, pxPerMetre, reach);
      });
    if (!painted) {
      drawPenSymbols(c, ctx, tl, tiles);
      if (spriteStrays) drawStrays(c, ctx, tl, tiles, ctx.getTransform().a);
    }
  }
  const fillP: Path2D[] = [],
    strokeP: Path2D[] = [];
  for (const t of sprites ? [] : tiles) {
    const key = `tex-${tl.kind}|${band}|${pen ? 'pen' : 'mark'}|t${t}`;
    const p = cached(key, () => {
      const marks = textureMarks(tl, t, spec.sp, TEX_SALT[tl.kind] ?? 1, c.world.seed);
      if (!marks.length) return null;
      const path = new P();
      for (const m of marks) {
        if (tl.kind === 'forest' && (m.k >= forestWeight(c, m.x, m.y) || !roomOf(c).keeps(m.x, m.y, m.k, spec.r * m.r))) continue;
        const r = spec.r * m.r;
        if (underground) appendUnderdarkMark(path, tl.kind, m.x, m.y, r, pal);
        else if (pen && spec.shape !== 'circle') appendPenMark(path, spec.shape, m.x, m.y, r, m.k);
        else if (spec.shape === 'circle') {
          path.moveTo(m.x + r, m.y);
          path.arc(m.x, m.y, r, 0, TAU);
          if (crown) {
            // drawn crown: shadow arc on the lower right and a short trunk
            path.moveTo(m.x + r * 0.55, m.y - r * 0.5);
            path.arc(m.x, m.y, r * 0.78, -0.75, 2.2);
            path.moveTo(m.x, m.y + r);
            path.lineTo(m.x, m.y + r * 1.5);
          }
        } else if (spec.shape === 'dot') {
          path.moveTo(m.x + r, m.y);
          path.arc(m.x, m.y, r, 0, TAU);
        } else if (spec.shape === 'tuft') {
          path.moveTo(m.x, m.y);
          path.lineTo(m.x - r * 0.45, m.y - r);
          path.moveTo(m.x, m.y);
          path.lineTo(m.x, m.y - r * 1.1);
          path.moveTo(m.x, m.y);
          path.lineTo(m.x + r * 0.45, m.y - r);
        } else {
          path.moveTo(m.x - r * 0.8, m.y);
          path.lineTo(m.x + r * 0.8, m.y);
          path.moveTo(m.x, m.y);
          path.lineTo(m.x, m.y - r);
        }
      }
      return path;
    });
    if (p) {
      strokeP.push(p);
      if (spec.fill) fillP.push(p);
    }
  }
  const penInk = (c: string): string => (pen ? mixHex(c, pal.inkSoft, 0.32) : c),
    penAlpha = pen && spec.shape !== 'circle' ? (spec.shape === 'dot' ? 0.78 : 0.62) : 1;
  // Underdark fungal beds: small caps of the bed look (render/underdark.ts fungalBedLook), filled, no ink ring.
  const bed = underground && (tl.kind === 'garden' || tl.kind === 'field') ? fungalBedLook(pal) : undefined;
  if (bed) {
    ctx.globalAlpha = 0.8 * spec.alpha;
    ctx.fillStyle = bed.cap;
    for (const p of strokeP) ctx.fill(p, 'nonzero');
  } else if (spec.fill) {
    ctx.globalAlpha = spec.alpha * penAlpha;
    ctx.fillStyle = penInk(pal[spec.fill] as string);
    for (const p of fillP) ctx.fill(p, 'nonzero');
  }
  ctx.globalAlpha = spec.alpha * penAlpha;
  ctx.strokeStyle = penInk(pal[spec.stroke] as string);
  ctx.lineWidth = pen && spec.shape !== 'circle' ? lw(spec.shape === 'dot' ? 0.3 : 0.42, 0.5) : lw(spec.shape === 'circle' ? 0.5 : 0.55, 0.6);
  if (pen) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }
  if (!bed) for (const p of strokeP) ctx.stroke(p);
  if (pen) ctx.restore();
  if (strayKind) {
    const tree = TEX.forest,
      strays: Path2D[] = [];
    if (canopy) {
      if (!sprites) drawStrays(c, ctx, tl, tiles, ctx.getTransform().a);
    } else
      for (const t of tiles) {
        const p = cached(`stray-${tl.kind}|t${t}`, () => {
          const marks = textureMarks(tl, t, tree.sp, TEX_SALT.forest, c.world.seed);
          if (!marks.length) return null;
          const path = new P();
          for (const m of marks)
            if (m.k < forestStray(c, m.x, m.y)) {
              const r = tree.r * m.r;
              path.moveTo(m.x + r, m.y);
              path.arc(m.x, m.y, r, 0, TAU);
            }
          return path;
        });
        if (p) strays.push(p);
      }
    ctx.globalAlpha = tree.alpha;
    ctx.fillStyle = pal[tree.fill!] as string;
    for (const p of strays) ctx.fill(p, 'nonzero'); // empty when the canopy drew them
    ctx.strokeStyle = pal[tree.stroke] as string;
    ctx.lineWidth = lw(0.5, 0.6);
    for (const p of strays) ctx.stroke(p);
  }
  ctx.globalAlpha = 1;
  if (underground) ctx.restore();
  return tiles.length;
}
export function paintTextureLayers(c: CartographyContext, f: VectorFrame): void {
  for (const _ of paintTextureLayerSteps(c, f)) {
    /* Synchronous callers. */
  }
}
export function* paintTextureLayerSteps(c: CartographyContext, f: VectorFrame): Generator<void> {
  // Flat land-use polygons carry every light zoom; no tree symbols, brush sprites or open-land marks.
  if (c.activeLight) return;
  const { pal, canopy, brushes } = c;
  const { ctx, mode, dpr, sc, band, rect, budgetRect, fs, lw, luOn } = f;
  // The ground paints the woods (render/treeSymbols.ts).
  const groundTrees = !!c.deps.groundTrees?.();
  // textures (procedural marks, visible tiles only, cached per tile)
  if (mode === 'ground' && canopy && pal.name === 'parchment') {
    // 3D drape tiles come at many scales side by side: a scale-dependent choice of marks shows each tile as a rectangle.
    // Woods are drawn from world-space tree positions at every scale.
    if (luOn)
      for (const tl of c.scene.textures) {
        if (c.deps.fullLanduse && !c.deps.fullLanduse(tl.kind)) continue;
        if (tl.kind === 'forest' && groundTrees) continue;
        if (tl.kind === 'forest') fs.textureTiles += drawDrapeCanopy(c, ctx, tl, rect, sc * dpr);
        // Orchards and open-land symbols follow the 2D map's own scale rule: the moving 3D preview reuses the 2D raster
        // tiles, so a refined drape tile must keep every symbol its preview showed (never a uniform fill over them).
        else if (cityCountrysideTextureVisible(tl.kind, sc) && (pal.tex[tl.kind] || (brushes && isBrushKind(tl.kind) && brushTextureOn(tl.kind, pal, c.world.options.biome)))) fs.textureTiles += drawTexture(c, ctx, tl, rect, band, lw, budgetRect);
      }
  } else if (luOn) {
    for (const tl of c.scene.textures) {
      if (tl.kind === 'forest' && groundTrees) continue;
      if (cityCountrysideTextureVisible(tl.kind, sc) && (pal.tex[tl.kind] || (brushes && isBrushKind(tl.kind) && brushTextureOn(tl.kind, pal, c.world.options.biome)))) fs.textureTiles += yield* drawTextureSteps(c, ctx, tl, rect, band, lw, budgetRect);
      yield;
    }
  }
}
