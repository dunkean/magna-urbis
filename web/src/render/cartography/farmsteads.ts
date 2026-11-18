/**
 * Farmsteads and rural details (drawVector, after water, before the regional roads): drives, lots (photographic on a
 * natural ground, plan symbols otherwise), gardens, pens, ponds, walls, trees, roofs; then the rural details.
 * Reads: world, scene, palette, the path cache, patterns.
 */
import { CITY_LOD_LIMITS } from '../cityCanvas';
import { drawFarmLots, drawFarmRoofs } from '../farmRoofs';
import { yardStyle } from '../yardStyle';
import { drawRuralDetails } from '../ruralDetails';
import { roadWidth, strokeNaturalRoad } from '../roadStyle';
import { drawPanelCanvas } from '../legend';
import { underdarkMark } from '../underdark';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';

export function paintFarmsteads(c: CartographyContext, f: VectorFrame): void {
  const { pal, P, brushes, family, polyL, linesOf, timedRec, getPattern } = c;
  const { ctx, dpr, sc, lod, px, lw, pathRect, polyPaths, fillPolys, strokePolys, strokeLines, roadStyle, natural, inkAlpha, merged, brushFill, brushTrees, luOn } = f;
  // 4. regional roads + farmsteads
  if (lod.farmsteads && polyL('farm-yards')) {
    const drives = linesOf(l => l.role === 'drive');
    if (natural) {
      if (drives.length) strokeNaturalRoad(ctx, merged(drives), 'track', roadWidth('track', drives[0].width, sc), sc, roadStyle);
    } else strokeLines(drives, pal.trackFill, l => Math.min(lw(l.width * 0.7, 1), px(2.4)), 0.55 * Math.min(1, inkAlpha), [], 'butt');
    // On a natural ground the lot belongs to the photograph (farmRoofs.ts drawFarmLots): beaten earth that fades
    // at its edge, a muted garden with its bed rows, grass under the orchard, a dark pond in a wet bank; no plan
    // tint, no lot outline; all of it under the snow with the land around. Other grounds keep the plan symbols.
    if (natural) timedRec('farm-lots', () => drawFarmLots(ctx, c.world, { part: 'ground', viewport: pathRect, mpp: px(1), night: roadStyle.night, Path: P }));
    else {
      fillPolys('farm-gardens', pal.land.garden);
      strokePolys('farm-gardens', pal.hedge, lw(0.4, 0.3), 0.8);
      fillPolys('farm-orchards', pal.land.orchard);
      fillPolys('farm-paddocks', pal.land.pasture);
    }
    fillPolys('farm-fungal-gardens', pal.land.garden);
    strokePolys('farm-fungal-gardens', pal.hedge, lw(0.4, 0.3), 0.8);
    if (brushes && lod.textures) {
      brushFill('farm-gardens', 'garden', sc);
      brushFill('farm-orchards', 'orchard', sc);
    }
    if (polyL('farm-fungal-gardens')?.polys.length && lod.textures) {
      const pat = getPattern(ctx, 'fungal-farm', 8, 8, 0, (cx, k) => drawPanelCanvas(cx, { w: 0, h: 0, prims: underdarkMark('garden', 4 * k, 4 * k, 1.7 * k, pal, k) }, 0, 0, family));
      const l = polyL('farm-fungal-gardens');
      if (pat && l) {
        ctx.fillStyle = pat;
        for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
      }
    }
    strokePolys('farm-platforms', pal.farmInk, lw(0.5, 0.4), 0.7, [px(3), px(2)]);
    // On a natural ground the walls take the yard-wall colour of the towns (no ink) and the buildings are city
    // buildings; yard, pens and ponds were painted with the lot above.
    if (!natural) {
      fillPolys('farm-yards', pal.farmYard, 0.9);
      fillPolys('farm-pens', pal.farmYard);
      strokePolys('farm-pens', pal.farmInk, lw(0.3, 0.3));
      fillPolys('farm-ponds', pal.water.stops[0][1]);
      strokePolys('farm-ponds', pal.waterEdge, lw(0.5, 0.4));
    }
    if (natural) {
      const wall = yardStyle('wall', '', 'terrain');
      strokeLines(
        linesOf(l => l.name === 'farm-walls'),
        wall.color,
        () => lw(wall.width, wall.minPx),
        wall.alpha,
        [],
        'butt',
      );
    } else
      strokeLines(
        linesOf(l => l.name === 'farm-walls'),
        pal.farmInk,
        () => lw(0.9, 0.7),
        1,
        [],
        'butt',
      );
    if (natural) {
      if (lod.band >= 2) timedRec('farm-trees', () => drawFarmLots(ctx, c.world, { part: 'trees', viewport: pathRect, mpp: px(1), night: roadStyle.night, Path: P }));
    } else if (lod.band >= 2 && polyL('farm-trees')) {
      if (brushes) brushTrees('farm-trees', true);
      else {
        fillPolys('farm-trees', pal.treeFill);
        strokePolys('farm-trees', pal.treeInk, lw(0.3, 0.3), 0.8);
      }
    }
    if (natural && px(1) <= CITY_LOD_LIMITS[1]) {
      // The roof and wall painter of the towns, at the scales where a town shows its buildings (cast shadow, pan
      // light, grain by cover and culture, weathering, snow); paths of the class this renderer records.
      timedRec('farm-roofs', () => drawFarmRoofs(ctx, c.world, { viewport: pathRect, mpp: px(1), dpr, palette: 'terrain', night: roadStyle.night, Path: P }));
    } else {
      fillPolys('farm-buildings', pal.farmRoof);
      // Further out a natural ground keeps the plain roof tint without ink, like the few pixels of a town roof.
      if (!natural) {
        strokePolys('farm-buildings', pal.farmInk, lw(0.5, 0.6));
        if (lod.band >= 2)
          strokeLines(
            linesOf(l => l.name === 'farm-ridges'),
            pal.farmInk,
            () => lw(0.35, 0.4),
            0.8,
            [],
            'butt',
          );
      }
    }
  }
  if (luOn && lod.strips) timedRec('rural', () => drawRuralDetails(ctx, c.world, pal));
}
