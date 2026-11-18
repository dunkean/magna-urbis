/**
 * Water (drawVector, after the semantic land use): river fills and edges, sea and lakes with the water material image
 * and the water-line pattern, their edges, then the white water of steep rivers.
 * Reads: scene, palette, the water image.
 */
import { drawWhiteWater } from '../whiteWater';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';

export function paintWater(c: CartographyContext, f: VectorFrame): void {
  const { pal, S, u, P, polyL, linesOf, timedRec, getWater, getPattern } = c;
  const { ctx, sc, px, lw, pathRect, polyPaths, fillPolys, strokePolys, strokeLines, roadStyle } = f;
  // 3. rivers + water
  const rivers = polyL('rivers');
  if (rivers) {
    const paths = polyPaths(rivers);
    ctx.fillStyle = pal.riverEdge;
    ctx.strokeStyle = pal.riverEdge;
    ctx.lineWidth = lw(1.7 * u, 1.2);
    for (const p of paths) {
      ctx.fill(p, 'nonzero');
      ctx.stroke(p);
    }
    ctx.fillStyle = pal.riverFill;
    for (const p of paths) ctx.fill(p, 'nonzero');
    if (sc < 0.08)
      strokeLines(
        linesOf(l => l.name === 'river-centre'),
        pal.riverEdge,
        () => px(1.3),
      );
  }
  fillPolys('sea', pal.seaFill, 1, 'evenodd');
  fillPolys('lakes', pal.lakeFill, 1, 'nonzero');
  const waterImage = getWater();
  if (waterImage)
    for (const name of ['sea', 'lakes'] as const) {
      const layer = polyL(name);
      if (!layer) continue;
      for (const path of polyPaths(layer)) {
        ctx.save();
        ctx.clip(path, name === 'sea' ? 'evenodd' : 'nonzero');
        ctx.drawImage(waterImage, 0, 0, S, S);
        ctx.restore();
      }
    }
  const wl = pal.waterLines;
  if (wl && sc >= 0.11) {
    const gap = wl.gap;
    const wpat = getPattern(ctx, 'waterlines', gap, gap, 0, (cx, k) => {
      cx.globalAlpha = wl.opacity;
      cx.strokeStyle = wl.color;
      cx.lineWidth = Math.max(0.9, wl.width * k * 0.7);
      cx.beginPath();
      cx.moveTo(0, (gap * k) / 2);
      cx.lineTo(gap * k, (gap * k) / 2);
      cx.stroke();
    });
    if (wpat) {
      ctx.fillStyle = wpat;
      for (const name of ['sea', 'lakes'] as const) {
        const l = polyL(name);
        if (l) for (const p of polyPaths(l)) ctx.fill(p, name === 'sea' ? 'evenodd' : 'nonzero');
      }
    }
  }
  strokePolys('sea', pal.waterEdge, lw(1.5 * u, 1.2));
  strokePolys('lakes', pal.waterEdge, lw(1.3 * u, 1.1));
  // White water of steep rivers over a satellite ground (whiteWater.ts): above the water, under the roads and bridges.
  if (!roadStyle.night) timedRec('white-water', () => drawWhiteWater(ctx, P, pathRect, sc));
}
