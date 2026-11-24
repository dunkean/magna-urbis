/**
 * Fields (drawVector, inside the land-use pass of the field class and after it): plough furrows clipped to their
 * strips, strip tints and outlines, furlong edges; then the field network: headlands, field ways, hedges, hedge walls
 * and fences, hedge trees.
 * Reads: scene, palette, the furrow cache.
 */
import { isUnderdarkBiome } from '../../gen/biomes';
import { Palette, ruralInk } from '../styles';
import { fieldBoundaryStyle, fieldHedgeStyle } from '../hedges';
import { furrowSpacing } from '../furrows';
import { CANVAS_MAP_STROKES as MAP_STROKES, mapStrokeWidth } from '../strokes';
import { roadWidth, trackInk } from '../roadStyle';
import { WAY_SCALE, FURROW_MIN_PX, FURROW_HOLDER_BUDGET } from '../lod';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';

export function paintFieldTexture(c: CartographyContext, f: VectorFrame, kind: keyof Palette['land']): void {
  if (c.activeLight) return;
  const { pal, furrowSize, furrowPaths } = c;
  const { ctx, sc, lod, rect, budgetRect, fs, fillPolys, strokePolys, multiply } = f;
  // Actual parallel plough lines, anchored like the SVG pattern. Suppress subpixel moire at far zoom.
  if (kind === 'field' && !isUnderdarkBiome(c.world.options.biome) && lod.strips && pal.furrowAlpha > 0 && c.scene.furrows && furrowSpacing(furrowSize) * sc >= 1.5) {
    const fade = Math.min(1, (furrowSpacing(furrowSize) * sc - 1.5) / 1.5);
    const visible: number[] = [],
      boxes = c.scene.furrows.index.boxes;
    // TileIndex.query returns sorted unique ids. Cull by precomputed projected bbox before allocating paths.
    for (const i of c.scene.furrows.index.query(budgetRect)) {
      const b = i * 4;
      if (Math.min(boxes[b + 2] - boxes[b], boxes[b + 3] - boxes[b + 1]) * sc < FURROW_MIN_PX) continue;
      visible.push(i);
      if (visible.length > FURROW_HOLDER_BUDGET) break;
    }
    // Skip the entire plough texture over budget rather than rendering an arbitrary subset of fields.
    if (visible.length <= FURROW_HOLDER_BUDGET)
      for (const i of visible) {
        if (!c.scene.furrows.index.boxHits(i, rect)) continue;
        const { holder, strips, lines } = furrowPaths(i);
        ctx.save();
        ctx.clip(holder);
        ctx.clip(strips);
        ctx.strokeStyle = pal.furrow;
        ctx.lineWidth = mapStrokeWidth(MAP_STROKES.furrow, sc);
        ctx.globalAlpha = pal.furrowAlpha * fade;
        ctx.lineCap = 'butt';
        ctx.stroke(lines);
        ctx.restore();
        fs.furrowsDrawn = (fs.furrowsDrawn ?? 0) + 1;
      }
  }
  if (kind === 'field' && lod.strips && !isUnderdarkBiome(c.world.options.biome)) {
    // SVG tints the ploughed strips after their furrow texture; retain that compositing order.
    multiply(true);
    const mk = [0.5, 0.75, 0.3, 0.9];
    for (let k = 0; k < 4; k++) if (pal.stripAlpha[k & 1] > 0) fillPolys('stripT' + k, k & 1 ? pal.stripB : pal.stripA, Math.min(1, pal.stripAlpha[k & 1] * mk[k]));
    multiply(false);
  }
  if (kind === 'field' && !isUnderdarkBiome(c.world.options.biome) && lod.strips && lod.band >= 2) {
    for (let k = 0; k < 4; k++) strokePolys('stripT' + k, pal.furrow, mapStrokeWidth(MAP_STROKES.strip, sc), pal.furrowAlpha * 0.85);
  }
  if (kind === 'field' && !isUnderdarkBiome(c.world.options.biome) && lod.strips) strokePolys('furlong-edges', pal.furrow, mapStrokeWidth(MAP_STROKES.furlong, sc), pal.furlongAlpha ?? 0.55);
}
export function paintFieldNetwork(c: CartographyContext, f: VectorFrame): void {
  if (!c.activeLight && c.deps.fullLanduse && !c.deps.fullLanduse('field')) return;
  const { pal, u, brushes, polyL, linesOf } = c;
  const { sc, lod, px, lw, fillPolys, strokePolys, strokeLines, natural, inkAlpha, strokeEarthRoads, brushTrees, luOn } = f;
  const fu = Math.max(1, u);
  // field network: ways, headlands, hedgerows (+ trees near). Ways and headlands are subtle earth-toned hairlines
  // (never paper-white bands across the fields), and the ways only show from mid-close zoom on.
  if (luOn && lod.strips) {
    const rk = ruralInk(pal);
    strokeLines(
      linesOf(l => l.name === 'headlands'),
      pal.furrow,
      () => mapStrokeWidth(MAP_STROKES.headland, sc),
      pal.rural.headland,
      [],
      'butt',
    );
    if (sc >= WAY_SCALE) {
      const ways = linesOf(l => l.name === 'field-ways');
      if (natural) {
        if (ways.length) strokeEarthRoads(ways, 'path', roadWidth('path', ways[0].width * 0.7, sc));
      } else strokeLines(ways, trackInk(rk, pal.roadFill), () => lw(1.4, 0.8), Math.min(1, pal.rural.way * inkAlpha), [], 'butt');
    }
    if (pal.hedgeOn) {
      const hedge = fieldHedgeStyle(pal, u);
      strokeLines(
        linesOf(l => l.name === 'hedges'),
        hedge.color,
        () => lw(hedge.width, 0.35),
        hedge.alpha * Math.min(1, sc / 0.3),
      );
      for (const [name, material] of [
        ['hedge-walls', 'wall'],
        ['hedge-fences', 'fence'],
      ] as const) {
        const k = fieldBoundaryStyle(pal, u, material);
        strokeLines(
          linesOf(l => l.name === name),
          k.color,
          () => lw(k.width, 0.35),
          k.alpha * Math.min(1, sc / 0.3),
          [],
          'butt',
        );
      }
      if (!c.activeLight && lod.band >= 2 && polyL('hedge-trees')) {
        if (brushes) brushTrees('hedge-trees');
        else {
          fillPolys('hedge-trees', pal.treeFill, 0.75 * (0.3 + 0.7 * (pal.season?.leaf ?? 1)));
          strokePolys('hedge-trees', pal.treeInk, lw(0.3 * fu, 0.35), 0.5);
        }
      }
    }
  }
}
