/**
 * Farmsteads and rural details (drawVector, after water, before the regional roads): drives, lots (photographic on a
 * natural ground, plan symbols otherwise), gardens, pens, ponds, walls, trees, roofs; then the rural details.
 * Reads: world, scene, palette, the path cache, patterns.
 */
import { CITY_LOD_LIMITS } from '../cityCanvas';
import { drawFarmLots, drawFarmRoofs } from '../farmRoofs';
import { FARM_ENCLOSURES, FARM_PLATFORM_EARTH, isFarmEnclosureKind } from '../farms';
import { drawRuralDetails } from '../ruralDetails';
import { drawPanelCanvas } from '../legend';
import { fungalBedLook, fungalBedMarks } from '../underdark';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';

export function paintFarmsteads(c: CartographyContext, f: VectorFrame): void {
  const { pal, P, brushes, family, polyL, linesOf, timedRec, getPattern } = c;
  const { ctx, dpr, sc, lod, px, lw, pathRect, polyPaths, fillPolys, strokePolys, strokeLines, roadStyle, natural, inkAlpha, strokeEarthRoads, brushFill, brushTrees, luOn } = f;
  // 4. regional roads + farmsteads
  if (lod.farmsteads && polyL('farm-yards')) {
    const drives = linesOf(l => l.role === 'drive');
    if (natural) {
      if (drives.length) strokeEarthRoads(drives, 'track', drives[0].width);
    } else strokeLines(drives, c.ink('trackFill'), l => Math.min(lw(l.width * 0.7, 1), px(2.4)), 0.55 * Math.min(1, inkAlpha), [], 'butt');
    fillPolys('farm-platforms', FARM_PLATFORM_EARTH, 0.48);
    // On a natural ground the lot belongs to the photograph (farmRoofs.ts drawFarmLots): beaten earth that fades
    // at its edge, a muted garden with its bed rows, grass under the orchard, a dark pond in a wet bank; no plan
    // tint, no lot outline; all of it under the snow with the land around. Other grounds keep the plan symbols.
    if (natural) timedRec('farm-lots', () => drawFarmLots(ctx, c.world, { part: 'ground', viewport: pathRect, mpp: px(1), night: roadStyle.night, Path: P }));
    else {
      fillPolys('farm-gardens', c.ink('garden'));
      strokePolys('farm-gardens', c.ink('hedge'), lw(0.4, 0.3), 0.8);
      fillPolys('farm-orchards', c.ink('orchard'));
      fillPolys('farm-paddocks', c.ink('pasture'));
    }
    // Fungal beds (render/underdark.ts fungalBedLook): dark compost with small caps; a vector map rings them with its
    // farm ink, a material ground leaves them unlined in the cave floor.
    const bed = fungalBedLook(pal, natural, roadStyle.night);
    fillPolys('farm-fungal-gardens', natural ? bed.bed : c.ink('garden'), natural ? 0.85 : 1);
    if (bed.edge) strokePolys('farm-fungal-gardens', bed.edge, lw(0.3, 0.3), 0.45);
    if (brushes && lod.textures) {
      brushFill('farm-gardens', 'garden', sc);
      brushFill('farm-orchards', 'orchard', sc);
    }
    if (!c.activeLight && polyL('farm-fungal-gardens')?.polys.length && lod.textures) {
      const pat = getPattern(ctx, `fungal-farm:${bed.cap}`, 8, 8, 0, (cx, k) => drawPanelCanvas(cx, { w: 0, h: 0, prims: fungalBedMarks(4 * k, 4 * k, 3.4 * k, bed) }, 0, 0, family));
      const l = polyL('farm-fungal-gardens');
      if (pat && l) {
        ctx.fillStyle = pat;
        for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
      }
    }
    strokePolys('farm-platforms', c.ink('farmInk'), lw(0.5, 0.4), 0.7, [px(3), px(2)]);
    if (!natural) {
      fillPolys('farm-yards', c.ink('farmYard'), 0.9);
      fillPolys('farm-pens', c.ink('farmYard'));
      strokePolys('farm-pens', c.ink('farmInk'), lw(0.3, 0.3));
      fillPolys('farm-ponds', c.ink('waterShore'));
      strokePolys('farm-ponds', c.ink('waterEdge'), lw(0.5, 0.4));
    }
    const roofs = !c.deps.volumeBuildings?.();
    if (roofs)
      for (const line of linesOf(l => l.role === 'farm')) {
        if (!isFarmEnclosureKind(line.kind)) continue;
        const look = FARM_ENCLOSURES[line.kind];
        strokeLines([line], natural || line.kind !== 'wall' ? look.color : c.ink('farmInk'), () => lw(look.width, look.minPx), look.alpha, [], 'butt');
      }
    if (natural) {
      if (lod.band >= 2) timedRec('farm-trees', () => drawFarmLots(ctx, c.world, { part: 'trees', viewport: pathRect, mpp: px(1), night: roadStyle.night, Path: P }));
    } else if (!c.activeLight && lod.band >= 2 && polyL('farm-trees')) {
      if (brushes) brushTrees('farm-trees', true);
      else {
        fillPolys('farm-trees', c.ink('farmLeaves'));
        strokePolys('farm-trees', c.ink('treeInk'), lw(0.3, 0.3), 0.8);
      }
    }
    if (roofs && natural && px(1) <= CITY_LOD_LIMITS[1]) {
      // The roof and wall painter of the towns, at the scales where a town shows its buildings (cast shadow, pan
      // light, grain by cover and culture, weathering, snow); paths of the class this renderer records.
      timedRec('farm-roofs', () => drawFarmRoofs(ctx, c.world, { viewport: pathRect, mpp: px(1), dpr, palette: 'terrain', night: roadStyle.night, Path: P, roofAppearance: c.deps.buildingRoofs?.() }));
    } else if (roofs) {
      fillPolys('farm-buildings', c.ink('farmRoof'));
      // Further out a natural ground keeps the plain roof tint without ink, like the few pixels of a town roof.
      if (!natural && !c.activeLight) {
        strokePolys('farm-buildings', c.ink('farmInk'), lw(0.5, 0.6));
        if (lod.band >= 2)
          strokeLines(
            linesOf(l => l.name === 'farm-ridges'),
            c.ink('farmInk'),
            () => lw(0.35, 0.4),
            0.8,
            [],
            'butt',
          );
      }
    }
  }
  if (!c.activeLight && luOn && lod.strips) timedRec('rural', () => drawRuralDetails(ctx, c.world, pal, c.ink('furrow')));
}
