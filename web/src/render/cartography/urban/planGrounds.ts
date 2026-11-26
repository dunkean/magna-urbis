/**
 * Planned grounds of the town (urban.ts, after the fringe): terraces, cornfields, chinampas, urban water and moats,
 * compound grounds, courts, garths, ditch parcels, cemeteries, castle bases and backlands.
 * Reads: palette, the path cache, patterns.
 */
import type { CartographyContext } from '../context';
import type { VectorFrame } from '../frame';
import { TAU } from '../geometry';
import type { UrbanFrame } from './frame';

export function paintPlanGrounds(c: CartographyContext, f: VectorFrame, u: UrbanFrame): void {
  const { pal, polyL, linesOf, getPattern } = c;
  const { ctx, lod, lw, fillPolys, strokePolys, strokeLines } = f;
  const { U, open, near, paved, pave, gardenPat, gravePat } = u;
  const cornPat = near
    ? getPattern(ctx, 'corn', 2.6, 2.6, 12, (cx, k) => {
        cx.globalAlpha = 0.75;
        cx.fillStyle = U.gardenInk;
        cx.beginPath();
        cx.arc(1.3 * k, 1.3 * k, 0.6 * k, 0, TAU);
        cx.fill();
      })
    : null;
  if (polyL('u-terraces')) {
    const tt = c.ink('terrace');
    fillPolys('u-terraces', tt);
    strokePolys('u-terraces', tt, lw(1.5, 0.5));
  }
  paved('u-cornfields', c.ink('cornfield'), cornPat);
  if (polyL('u-cornfields') && lod.band >= 1) strokePolys('u-cornfields', U.gardenInk, lw(0.45, 0.4), 0.55);
  if (polyL('u-chinampa-canals')) fillPolys('u-chinampa-canals', c.ink('riverFill'));
  paved('u-chinampas', U.garden, gardenPat);
  // urban water (moats, tanks, mill races) and the moat line outside a planned town's wall
  strokeLines(
    linesOf(l => l.role === 'uline' && (l.kind === 'moat' || l.kind === 'canal')),
    c.ink('riverFill'),
    l => lw(l.width, 1),
  );
  if (polyL('u-water')) {
    fillPolys('u-water', c.ink('riverFill'), 1, 'nonzero');
    strokePolys('u-water', pal.riverEdge, lw(0.5, 0.4));
  }
  // compound grounds, mosque courts (sahn), cloister garths, ditch parcels, cemeteries, castle bases
  fillPolys('u-grounds', U.place);
  if (polyL('u-sahn')) {
    paved('u-sahn', U.place, pave);
    strokePolys('u-sahn', U.plotLine, lw(0.2, 0.3));
  }
  if (polyL('u-garth')) {
    fillPolys('u-garth', U.garden);
    strokePolys('u-garth', U.plotLine, lw(0.25, 0.3));
  }
  if (polyL('u-ditch')) {
    paved('u-ditch', U.garden, gardenPat);
    strokePolys('u-ditch', U.plotLine, lw(0.3, 0.3));
  }
  paved('u-cemetery', U.garden, gravePat);
  if (polyL('u-bases')) {
    fillPolys('u-bases', U.wallFill);
    strokePolys('u-bases', U.wall, lw(0.4, 0.5));
  }
  if (!open) paved('u-backland', U.garden, c.world.urban?.renderHints?.graves ? gravePat : gardenPat);
}
