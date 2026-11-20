/**
 * Buildings of the town (urban.ts, after the planned grounds): masses with their cast shadow, individual buildings
 * within the budget, lit windows at night, the placeholder houses of a place whose plan is still to come, landmark
 * buildings and patios.
 * Reads: world, palette, the path cache, patterns, the lit window cache. Writes: buildingsCandidate, buildingsDrawn of the frame stats; litCache.
 */
import { CITY_LOD_LIMITS } from '../../cityCanvas';
import { drawPlaceholderRoofs } from '../../farmRoofs';
import { roadWidth, strokeNaturalRoad } from '../../roadStyle';
import { litDots } from '../../extras';
import type { CartographyContext } from '../context';
import type { VectorFrame } from '../frame';
import { mixHex, lumHex } from '../geometry';
import type { Rect4 } from '../../view';
import { type UrbanFrame, BUILDING_BUDGET_FULL, BUILDING_BUDGET_MAX, BUILDING_BUDGET_INDIV } from './frame';

export function paintBuildings(c: CartographyContext, f: VectorFrame, u: UrbanFrame): void {
  const { P, polyL, timedRec, getPattern } = c;
  const { ctx, dpr, sc, lod, rect, budgetRect, fs, px, lw, pathRect, polyPaths, fillPolys, strokePolys, roadStyle } = f;
  const { U, near, pave, restored, hatched } = u;
  // building masses (courtyards are holes -> evenodd), with a soft drop shadow when zoomed in
  const masses = polyL('u-masses');
  if (lod.buildings && masses) {
    let cand = 0;
    for (const t of masses.index.tilesInRect(budgetRect)) cand += masses.index.tileStart[t + 1] - masses.index.tileStart[t];
    cand += masses.index.bigInRect(budgetRect).length;
    fs.buildingsCandidate = cand;
    if (cand <= BUILDING_BUDGET_MAX) {
      fs.buildingsDrawn = true;
      const paths = polyPaths(masses);
      const sh = U.shadow;
      if (sh && lod.band >= 2 && cand <= BUILDING_BUDGET_FULL) {
        // styled cast shadow: solid sepia fringe, hatched once the fringe is wide enough on screen
        ctx.save();
        ctx.translate(sh.dx, sh.dy);
        ctx.fillStyle = sh.color;
        ctx.globalAlpha = sh.hatch && sc >= 1.1 ? sh.alpha * 0.4 : sh.alpha;
        for (const p of paths) ctx.fill(p, 'evenodd');
        if (sh.hatch && sc >= 1.1) {
          const hp = getPattern(ctx, 'shadowhatch', 2.6, 2.6, 45, (cx, k) => {
            cx.strokeStyle = sh.color;
            cx.globalAlpha = sh.alpha;
            cx.lineWidth = 0.9 * k;
            cx.beginPath();
            cx.moveTo(0, 1.3 * k);
            cx.lineTo(2.6 * k, 1.3 * k);
            cx.stroke();
          });
          if (hp) {
            ctx.fillStyle = hp;
            ctx.globalAlpha = 1;
            for (const p of paths) ctx.fill(p, 'evenodd');
          }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (lod.shadows && cand <= BUILDING_BUDGET_FULL) {
        ctx.save();
        ctx.translate(1.4, 1.7);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        for (const p of paths) ctx.fill(p, 'evenodd');
        ctx.restore();
      }
      const bl = polyL('u-bldg');
      let indiv = 0;
      if (lod.individual && bl) {
        for (const t of bl.index.tilesInRect(budgetRect)) indiv += bl.index.tileStart[t + 1] - bl.index.tileStart[t];
        indiv += bl.index.bigInRect(budgetRect).length;
      }
      if (lod.individual && bl && indiv <= BUILDING_BUDGET_INDIV) {
        // one building at a time (as in the SVG): roof fill, then a thin outline so party walls show as lines
        const lm = lumHex(U.mass);
        const roof = lm < 0.3 ? mixHex(U.mass, U.yard, 0.42) : U.mass;
        const ink = lm < 0.3 ? mixHex(U.mass, '#000000', 0.25) : lumHex(U.massEdge) < lm ? U.massEdge : mixHex(U.mass, '#000000', 0.6);
        const bp = polyPaths(bl);
        ctx.fillStyle = roof;
        // (the masses first: a megacity quarter not detailed yet has its stand-in masses and no buildings)
        for (const p of paths) ctx.fill(p, 'evenodd');
        for (const p of bp) ctx.fill(p, 'evenodd');
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw(Math.max(0.28, U.massEdgeW * 0.9), 0.45);
        ctx.lineJoin = 'miter';
        for (const p of bp) ctx.stroke(p);
        ctx.lineJoin = 'round';
      } else {
        ctx.fillStyle = U.mass;
        for (const p of paths) ctx.fill(p, 'evenodd');
        if (cand <= BUILDING_BUDGET_FULL) {
          ctx.strokeStyle = U.massEdge;
          ctx.lineWidth = lw(U.massEdgeW, 0.3);
          for (const p of paths) ctx.stroke(p);
        }
      }
      if (U.lit && lod.band >= 2) drawLit(c, ctx, rect, sc, U.lit.color, U.lit.density);
    }
  }
  // A place whose plan is still to come: on a natural ground its stand-in houses are houses of its culture under
  // the roof painter of the towns, along earth lanes (farmRoofs.ts), over the plain stand-in marks; other
  // grounds keep those marks.
  if (restored && px(1) <= CITY_LOD_LIMITS[1]) {
    const lanesOnly = c.deps.volumeBuildings?.();
    timedRec('place-roofs', () =>
      drawPlaceholderRoofs(ctx, c.world, {
        viewport: pathRect,
        mpp: px(1),
        dpr,
        palette: 'terrain',
        night: roadStyle.night,
        Path: P,
        lanesOnly,
        roofAppearance: lanesOnly ? undefined : c.deps.buildingRoofs?.(),
        lane: path => strokeNaturalRoad(ctx, path, 'lane', roadWidth('lane', 3, sc), sc, roadStyle),
      }),
    );
  }
  // landmark buildings: the landmark tone, outlined
  if (polyL('u-lmb')) {
    fillPolys('u-lmb', U.landmark);
    hatched('u-lmb');
    strokePolys('u-lmb', U.landmarkEdge, lw(0.7, near ? 0.5 : 1.4));
  }
  // courtyard houses: the patio as a paved court with a crisp inner edge
  if (polyL('u-patios') && lod.individual) {
    fillPolys('u-patios', U.place);
    if (near && pave) {
      const l = polyL('u-patios')!;
      ctx.fillStyle = pave;
      for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
    }
    strokePolys('u-patios', U.massEdge, lw(0.45, 0.6));
  }
}

/** Deterministic lit windows of the visible buildings (night style). */
function drawLit(c: CartographyContext, ctx: CanvasRenderingContext2D, rect: Rect4, sc: number, color: string, density: number): void {
  const d = (c.litCache ??= litDots(c.world, density));
  const path = new c.P();
  let n = 0;
  for (let i = 0; i < d.length; i += 2) {
    const x = d[i],
      y = d[i + 1];
    if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) continue;
    path.moveTo(x, y);
    path.lineTo(x, y);
    n++;
    if (n > 60000) break;
  }
  if (!n) return;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  const w = Math.max(1.3, 2 / sc);
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = w * 3.2;
  ctx.stroke(path);
  ctx.globalAlpha = 1;
  ctx.lineWidth = w;
  ctx.stroke(path);
}
