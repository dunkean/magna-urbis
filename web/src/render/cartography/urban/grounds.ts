/**
 * Town grounds (urban.ts, first at the block level): the open ground of camps and barbarian villages (tints, tufts,
 * mud, puddles, trampled paths), the boardwalks of a stilt town or the street space of a planned one; then paved
 * places, greens, yards, blocks, meadows and plazas.
 * Reads: world, palette, the path cache, patterns.
 */
import { type MapInk } from '../../gpu/recorder';
import { isUnderdarkBiome } from '../../../gen/biomes';
import { drawPanelCanvas } from '../../legend';
import { underdarkMark } from '../../underdark';
import type { CartographyContext } from '../context';
import type { VectorFrame } from '../frame';
import { TAU } from '../geometry';
import type { UrbanFrame } from './frame';

function drawMud(cx: CanvasRenderingContext2D, k: number): void {
  cx.globalAlpha = 0.55;
  cx.lineWidth = 0.35 * k;
  cx.lineCap = 'round';
  cx.beginPath();
  for (const [x0, y0, x1, y1] of [
    [1, 1.5, 2.6, 1.9],
    [5.5, 4.8, 6.7, 4.3],
    [2.4, 5.6, 3.3, 6.2],
    [7.2, 1.2, 7.7, 2.2],
  ]) {
    cx.moveTo(x0 * k, y0 * k);
    cx.lineTo(x1 * k, y1 * k);
  }
  cx.stroke();
  cx.beginPath();
  cx.arc(4.2 * k, 2.4 * k, 0.32 * k, 0, TAU);
  cx.arc(7.8 * k, 5.9 * k, 0.25 * k, 0, TAU);
  cx.fill();
}

/** Open ground, boardwalks or street space. */
export function paintStreetSpace(c: CartographyContext, f: VectorFrame, u: UrbanFrame): void {
  const { pal, family, polyL, getPattern } = c;
  const { ctx, sc, lw, polyPaths, fillPolys, strokePolys, strokeLines } = f;
  const { U, uStreets, stilts, open, earth, near } = u;
  if (open) {
    const tuft = near
      ? getPattern(ctx, 'tuft', 11, 9, 0, (cx, k) => {
          if (isUnderdarkBiome(c.world.options.biome)) {
            drawPanelCanvas(cx, { w: 0, h: 0, prims: [...underdarkMark('meadow', 2.5 * k, 3.5 * k, 1.4 * k, pal, k), ...underdarkMark('meadow', 8 * k, 7 * k, 1.4 * k, pal, k)] }, 0, 0, family);
            return;
          }
          cx.globalAlpha = 0.75;
          cx.strokeStyle = c.ink('grass').css;
          cx.lineWidth = 0.35 * k;
          cx.beginPath();
          for (const [x, y] of [
            [2.5, 4.5],
            [8, 8.4],
          ]) {
            cx.moveTo(x * k, y * k);
            cx.lineTo((x - 0.8) * k, (y - 1.9) * k);
            cx.moveTo(x * k, y * k);
            cx.lineTo((x + 0.8) * k, (y - 1.9) * k);
          }
          cx.stroke();
        })
      : null;
    const fungal =
      near && isUnderdarkBiome(c.world.options.biome)
        ? getPattern(ctx, 'fungal-open', 6, 6, 0, (cx, k) => drawPanelCanvas(cx, { w: 0, h: 0, prims: [...underdarkMark('garden', 2 * k, 2 * k, 1.1 * k, pal, k), ...underdarkMark('garden', 4.5 * k, 4.5 * k, 1.1 * k, pal, k)] }, 0, 0, family))
        : null;
    const tint = (name: string, color: MapInk, alpha: number, pat: CanvasPattern | null): void => {
      const l = polyL(name);
      if (!l) return;
      if (pal.landBlend === 'multiply') ctx.globalCompositeOperation = 'multiply';
      fillPolys(name, color, alpha);
      ctx.globalCompositeOperation = 'source-over';
      if (pat) {
        ctx.fillStyle = pat;
        for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
      }
    };
    // the settlement's ground (the footprint and a margin round it, off the water), opaque where it hides roads
    if (polyL('u-ground-solid')) fillPolys('u-ground-solid', c.ink('openGround'), 1, 'nonzero');
    tint('u-ground', c.ink('meadow'), pal.landOpacity * 0.8, tuft);
    tint('u-open-grass', c.ink('pasture'), pal.landOpacity * 0.85, tuft);
    tint('u-open-green', c.ink('meadow'), pal.landOpacity, tuft);
    tint('u-open-garden', c.ink('garden'), pal.landOpacity, fungal);
    tint('u-open-field', c.ink('field'), pal.landOpacity, fungal);
    if (!isUnderdarkBiome(c.world.options.biome) && polyL('u-open-field')) strokePolys('u-open-field', c.ink('furrow'), lw(0.4, 0.4), 0.4);
    tint('u-open-commons', c.ink('pasture'), pal.landOpacity * 0.8, null);
    // churned mud (a war camp), puddles
    const mud = polyL('u-mud');
    if (mud) {
      fillPolys('u-mud', c.ink('mudFill'), 0.75);
      const mudPat = near ? getPattern(ctx, 'mud', 9, 7, 17, drawMud, 'mudInk') : null;
      if (mudPat) {
        ctx.fillStyle = mudPat;
        for (const p of polyPaths(mud)) ctx.fill(p, 'evenodd');
      }
    }
    if (polyL('u-puddle')) {
      fillPolys('u-puddle', c.ink('riverFill'), 0.7);
      strokePolys('u-puddle', c.ink('puddleEdge'), lw(0.3, 0.3), 0.6);
    }
    fillPolys('u-yard-earth', c.ink('yardEarth'), 0.85);
    // paths: trampled earth (wide causeways keep the street colour)
    strokeLines(
      uStreets.filter(l => !(l.width >= 6.5 && Number(l.kind.slice(1, 2)) <= 1)),
      earth,
      l => Math.max(1.2, l.width * 0.92, 0.8 / sc),
      0.8,
    );
    strokeLines(
      uStreets.filter(l => l.width >= 6.5 && Number(l.kind.slice(1, 2)) <= 1),
      U.street,
      l => Math.max(1.2, l.width * 0.92, 0.8 / sc),
    );
  } else if (stilts) {
    // a stilt town has no ground: boardwalks as planks over the water and the marsh
    strokeLines(uStreets, pal.bridgeInk, l => Math.max(1.6, l.width + 0.2, 1.4 / sc), 1, [], 'butt');
    strokeLines(uStreets, pal.bridgeDeck, l => Math.max(1, l.width - 0.7, 0.9 / sc), 1, [], 'butt');
  } else {
    fillPolys('u-streets', U.street, 1, 'nonzero');
  }
}

/** Places, greens, yards, blocks, meadows, plazas. */
export function paintPavedGrounds(c: CartographyContext, f: VectorFrame, u: UrbanFrame): void {
  const { fillPolys } = f;
  const { U, stilts, open, paved, pave, gardenPat, gravePat } = u;
  paved('u-places', U.place, pave);
  if (!open) {
    paved('u-greens', U.garden, gardenPat, 0.6);
    paved('u-yards', U.garden, gravePat);
    if (!stilts) fillPolys('u-blocks', U.yard);
    paved('u-meadows', U.garden, gardenPat, 0.45);
  }
  paved('u-plazas', U.place, pave);
}
