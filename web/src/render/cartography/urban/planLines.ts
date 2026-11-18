/**
 * Plan lines and street minimums (urban.ts, last): enclosure walls, fences, terraces, hedges, footpaths, footbridges,
 * bazaar roofs, qanats and stair treads by kind; tree canopies; churches and their crosses; plot hairlines; the main
 * streets at a legible minimum width; the landmark sites.
 * Reads: palette, the path cache.
 */
import { ruralInk } from '../../styles';
import { TERRACE_STROKES as TS, terraceDetailAlpha } from '../../terraces';
import { LineLayer, WALL_LINE_W, CAMP_FENCE_W, FENCE_STYLE } from '../../scene';
import type { CartographyContext } from '../context';
import type { VectorFrame } from '../frame';
import { mixHex } from '../geometry';
import type { UrbanFrame } from './frame';

export function paintPlanLines(c: CartographyContext, f: VectorFrame, u: UrbanFrame): void {
  const { pal, brushes, polyL, linesOf, visibleClip } = c;
  const { ctx, sc, lod, rect, px, lw, polyPaths, linePaths, fillPolys, strokePolys, strokeLines, brushTrees, land } = f;
  const { U, isVillage, isEarth, mainsOf, stilts, open, earth, near, hatched } = u;
  // plan lines (same rules per kind as render/urban.ts): enclosure walls, fences, terraces, hedges, footpaths,
  // canal footbridges, bazaar roofs, qanats, stair treads. Unlisted kinds fall back to the wall-like stroke.
  {
    const treeInk = pal.treeInk ?? '#4a6a3a';
    const fine = lod.fine;
    const terraceDetail = terraceDetailAlpha(sc);
    strokeLines(
      linesOf(x => x.role === 'uline' && x.kind === 'andene-riser'),
      U.wallFill,
      () => TS.face.width,
      TS.face.alpha,
      [],
      'butt',
    );
    for (const l of linesOf(x => x.role === 'uline')) {
      const k = l.kind,
        w = l.width;
      const one = (color: string, width: number, alpha = 1, dash: number[] = [], cap: CanvasLineCap = 'round'): void => strokeLines([l], color, () => width, alpha, dash, cap);
      if (k === 'moat' || k === 'canal') continue;
      else if (k === 'hedge') one(treeInk, lw(2.6, 0.8), 0.8, fine ? [3, 1.5] : [], 'butt');
      else if (k === 'track') {
        const rural = !open && !stilts;
        one(rural ? ruralInk(pal) : open ? earth : U.street, lw(rural ? 1.6 : open ? 2.6 : 3, rural ? 0.9 : 0.6), rural ? pal.rural.track : open ? 0.75 : 1, rural ? [6, 3.5] : [], rural ? 'butt' : 'round');
      } else if (k === 'weir') one(U.wall, lw(1.4, 0.5), 1, fine ? [1.2, 0.6] : [], 'butt');
      else if (k === 'parterre') {
        if (fine) one(U.plotLine, lw(0.5, 0.4));
      } else if (k === 'footpath') {
        if (fine) one(open ? earth : U.street, lw(1.4, 0.6));
      } else if (k === 'roof-line') {
        if (near) one(U.massEdge, lw(0.2, 0.3), 0.7, [], 'butt');
      } else if (k === 'garden-hedge') one(treeInk, lw(1.2, 0.5), 0.7, fine ? [1.6, 0.7] : [], 'butt');
      else if (k === 'bund') {
        if (fine) one(U.plotLine, lw(0.4, 0.3), 0.35, [], 'butt');
      } else if (k === 'turf-wall') {
        one(mixHex(pal.grass, U.wall, 0.35), lw(2.2, 0.8), 0.42);
        if (fine) one(U.wall, lw(0.16, 0.3), 0.45);
      } else if (k === 'albarrada') one(U.wall, lw(0.85, 0.4), 0.4, fine ? [0.9, 0.45] : []);
      else if (k === 'ghat-steps') {
        if (fine) one(U.plotLine, lw(0.3, 0.4));
      } else if (k === 'terrace') one(U.wall, lw(TS.wall.width, TS.wall.minPx), TS.wall.alpha);
      else if (k === 'andene') one(U.wall, lw(TS.andene.width, TS.andene.minPx), TS.andene.alpha);
      else if (k === 'andene-riser') continue;
      else if (k === 'andene-hachure' || k === 'terrace-tread') {
        if (terraceDetail > 0) one(U.wall, lw(TS.hatch.width, TS.hatch.minPx), TS.hatch.alpha * terraceDetail, [], 'butt');
      } else if (k === 'terrace-stair') one(U.wall, lw(TS.stair.width, TS.stair.minPx), TS.stair.alpha);
      else if (k === 'thorn-fence') one(treeInk, lw(2.2, 0.8), 0.85, near ? [1.3, 0.9] : []);
      else if (k === 'rampart') {
        one(U.garden, lw(7, 1.4), 0.9);
        one(U.wall, lw(0.6, 0.4));
      } else if (k === 'ditch') one(U.wall, lw(4, 0.9), 0.35);
      else if (k === 'footbridge') {
        // the deck between its parapets
        const dw = w || 2.5;
        one(pal.bridgeInk, Math.max(dw + 0.9, 2.2 / sc), 1, [], 'butt');
        one(pal.bridgeDeck, Math.max(dw, 1.4 / sc), 1, [], 'butt');
      } else if (k === 'bazaar-roof') {
        // the vaulted bazaar street: a roof over the street's own width
        const rw = Math.max(2, (w || 5) - 0.6);
        one(U.landmarkEdge, Math.max(rw + 0.8, 2.2 / sc), 1, [], 'butt');
        one(U.landmark, Math.max(rw, 1.4 / sc), 1, [], 'butt');
      } else if (k === 'qanat') one(U.wall, lw(1, 0.6), 0.7, [4, 3], 'butt');
      else if (k === 'qanat-shaft') {
        ctx.fillStyle = U.garden;
        for (const p of linePaths(l)) ctx.fill(p, 'evenodd');
        one(U.wall, lw(0.7, 0.5));
      } else if (k === 'hachure') {
        if (terraceDetail > 0) one(U.wall, lw(TS.hatch.width, TS.hatch.minPx), TS.hatch.alpha * terraceDetail, [], 'butt');
      } else if (CAMP_FENCE_W[k] !== undefined) {
        // a rail with its posts (stakes close together for a palisade); zoomed out, a thin line
        const st = FENCE_STYLE[k] ?? FENCE_STYLE['yard-fence'];
        const far = !fine && k !== 'palisade' && k !== 'kraal-fence';
        if (far) {
          if (lod.band >= 1) one(U.wall, lw(st[0], 0.3), 0.6);
        } else {
          one(U.wall, lw(st[0], 0.35), 0.8);
          if (near) one(U.wall, st[1], 0.9, [st[2], st[3]], 'butt');
          else if (k === 'palisade' || k === 'kraal-fence') one(U.wall, lw(st[1], 0.5), 0.75);
        }
      } else one(U.wall, lw(WALL_LINE_W[k] ?? 1, 0.8), 1, [], 'square');
    }
    // tree canopies (elven towns)
    const trees = polyL('u-trees');
    if (trees && lod.individual) {
      if (brushes) brushTrees('u-trees');
      else {
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = pal.treeFill ?? '#7f9a5a';
        for (const p of polyPaths(trees)) ctx.fill(p, 'evenodd');
        ctx.globalAlpha = 1;
        strokePolys('u-trees', treeInk, lw(0.35, 0.4));
      }
    }
  }
  // churches: distinct outlined mass with a cross
  if (polyL('u-church')) {
    fillPolys('u-church', U.landmark);
    hatched('u-church');
    // (zoomed out, a small church keeps a legible outline: at least ~1.6 px)
    strokePolys('u-church', U.landmarkEdge, lw(0.8, near ? 0.6 : 1.6));
    if (lod.band >= 2)
      strokeLines(
        linesOf(l => l.role === 'cross'),
        U.landmarkEdge,
        l => lw(l.width, 0.6),
      );
  }
  // plot hairlines: a dark pass (reads on yards) and a light pass (reads on roofs)
  if (lod.parcels) {
    const plots = linesOf(l => l.role === 'plot');
    strokeLines(plots, U.plotLine, () => lw(U.plotW, 0.4), U.plotAlpha * 0.7, [], 'butt');
    if (U.plotLightAlpha > 0) strokeLines(plots, U.massEdge, () => lw(U.plotW, 0.4), U.plotLightAlpha * 0.7, [], 'butt');
  }
  // hierarchy: arterial / primary streets keep a legible minimum width in street colour
  const minPx = (l: LineLayer): number => (isVillage(l) ? (lod.band >= 2 ? 1.2 : 0.8) : l.kind.startsWith('r0') ? 2.6 : l.kind.startsWith('r1') ? 1.8 : 1.0);
  const thin = mainsOf(lod.band === 1 ? 2 : 1).filter(l => l.width * sc < minPx(l));
  ctx.save();
  if (land && !stilts) ctx.clip(land, 'evenodd');
  if (thin.length && !stilts && !open) {
    const space = polyL('u-stroke-space');
    const clip = space && visibleClip(space, rect);
    if (clip) ctx.clip(clip, 'nonzero');
    else thin.length = 0;
  }
  strokeLines(
    thin.filter(l => !isEarth(l)),
    open ? earth : U.street,
    l => minPx(l) / sc,
    open ? 0.8 : 1,
  );
  strokeLines(thin.filter(isEarth), mixHex(pal.farmYard, pal.trackFill, 0.12), l => minPx(l) / sc, 0.8);
  ctx.restore();
  if (polyL('landmarks') && near) strokePolys('landmarks', U.landmark, lw(0.6, 0.6), 0.5, [px(5), px(3)]);
  // zoomed out: the landmark sites (wells, crosses, markets, compounds' named buildings) as a solid outline of at
  // least ~1.8 px, so the small ones stay visible on the full map
  else if (polyL('landmarks')) strokePolys('landmarks', U.landmarkEdge, lw(0.6, 1.8), 0.9);
}
