/**
 * Urban layers of the cartography (drawVector, after the regional roads): the density image, street space or open
 * ground, paved and planted grounds, the country fringe, the restored natural ground, terraces and fields, urban
 * water, compounds, building masses and individual buildings, placeholder roofs, landmarks, plan lines, trees,
 * churches, plot hairlines and the minimum-width main streets. One draw-order sequence over shared patterns and
 * flags; kept in one module for that reason (it is the longest family).
 * Reads: world, scene, palette, the path cache, patterns, the forest washes. Writes: stats of the frame (fs).
 */
import { cityCountrysideTextureVisible } from '../cityEnvironment';
import { CITY_LOD_LIMITS } from '../cityCanvas';
import { drawPlaceholderRoofs } from '../farmRoofs';
import { isUnderdarkBiome } from '../../gen/biomes';
import { brushTextureOn, isBrushKind } from '../brushes';
import { ruralInk } from '../styles';
import { CANVAS_MAP_STROKES as MAP_STROKES, mapStrokeWidth } from '../strokes';
import { NATURAL_LAND_KINDS, countryKind, FRINGE_ORDER, FRINGE_PAINT } from '../countryside';
import { TERRACE_STROKES as TS, terraceDetailAlpha } from '../terraces';
import { roadWidth, strokeNaturalRoad } from '../roadStyle';
import { LineLayer, WALL_LINE_W, CAMP_FENCE_W, FENCE_STYLE } from '../scene';
import { drawPanelCanvas } from '../legend';
import { underdarkMark } from '../underdark';
import { litDots } from '../extras';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';
import { mixHex, lumHex, TAU, polyPath } from './geometry';
import type { Rect4 } from '../view';
import { forestClip } from './forest';
import { drawTexture } from './symbols';

export const BUILDING_BUDGET_FULL = 120_000;
export const BUILDING_BUDGET_MAX = 450_000;
/** Individually outlined buildings in view above which we fall back to merged masses. */
export const BUILDING_BUDGET_INDIV = 160_000;

export function paintUrban(c: CartographyContext, f: VectorFrame): void {
  const { pal, S, P, brushes, family, polyL, linesOf, cached, timedRec, visibleClip, getDensity, getPattern } = c;
  const { ctx, dpr, sc, lod, band, rect, budgetRect, fs, px, lw, pathRect, polyPaths, linePaths, fillPolys, strokePolys, strokeLines, roadGroup, roadStyle, drawRegionalRoads, tex, drawVisibleTerrain, brushTrees, luOn, fillLand, multiply, land, roads, tracks } = f;
  // 5. urban
  const U = pal.urban;
  const uStreets = linesOf(l => l.role === 'street');
  // (village and hamlet streets, layers 'vstreet-*', never get the far-zoom arterial strokes)
  const isVillage = (l: LineLayer): boolean => l.name.startsWith('vstreet-');
  const isEarth = (l: LineLayer): boolean => /e(?:c)?$/.test(l.kind);
  const mainsOf = (maxRank: number): LineLayer[] => uStreets.filter(l => Number(l.kind.slice(1, 2)) <= maxRank && !l.kind.endsWith('c'));
  if (lod.densityAlpha > 0) {
    const dimg = getDensity();
    if (dimg) {
      ctx.globalAlpha = 0.9 * lod.densityAlpha;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(dimg, 0, 0, S, S);
      ctx.globalAlpha = 1;
    }
  }
  if (!lod.blocks) {
    // far: arterial and primary streets only, as thin cased lines
    ctx.save();
    if (land) ctx.clip(land, 'evenodd');
    roadGroup(
      mainsOf(1).filter(l => !isVillage(l)),
      l => (l.kind.startsWith('r0') ? 1.8 : 1.2),
    );
    ctx.restore();
  } else {
    // street space = the quarters; blocks, places and masses are laid on top
    const stilts = !!c.world.urban?.renderHints?.stilts;
    // open ground (camps, barbarian villages): no street space or block fill (same rules as render/urban.ts)
    const open = !!c.world.urban?.renderHints?.openGround && !stilts;
    const earth = mixHex(pal.trackFill, U.street, 0.52);
    const near = lod.band >= 2;
    if (open) {
      const tuft = near
        ? getPattern(ctx, 'tuft', 11, 9, 0, (cx, k) => {
            if (isUnderdarkBiome(c.world.options.biome)) {
              drawPanelCanvas(cx, { w: 0, h: 0, prims: [...underdarkMark('meadow', 2.5 * k, 3.5 * k, 1.4 * k, pal, k), ...underdarkMark('meadow', 8 * k, 7 * k, 1.4 * k, pal, k)] }, 0, 0, family);
              return;
            }
            cx.globalAlpha = 0.75;
            cx.strokeStyle = pal.grass;
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
      const tint = (name: string, color: string, alpha: number, pat: CanvasPattern | null): void => {
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
      if (polyL('u-ground-solid')) fillPolys('u-ground-solid', mixHex(pal.paper, pal.land.meadow, 0.35), 1, 'nonzero');
      tint('u-ground', pal.land.meadow, pal.landOpacity * 0.8, tuft);
      tint('u-open-grass', pal.land.pasture, pal.landOpacity * 0.85, tuft);
      tint('u-open-green', pal.land.meadow, pal.landOpacity, tuft);
      tint('u-open-garden', pal.land.garden, pal.landOpacity, fungal);
      tint('u-open-field', pal.land.field, pal.landOpacity, fungal);
      if (!isUnderdarkBiome(c.world.options.biome) && polyL('u-open-field')) strokePolys('u-open-field', pal.furrow, lw(0.4, 0.4), 0.4);
      tint('u-open-commons', pal.land.pasture, pal.landOpacity * 0.8, null);
      // churned mud (a war camp), puddles
      if (polyL('u-mud')) {
        const dk = mixHex(pal.trackFill, '#000000', 0.25);
        fillPolys('u-mud', mixHex(pal.trackFill, pal.farmYard, 0.62), 0.75);
        const mudPat = near
          ? getPattern(ctx, 'mud', 9, 7, 17, (cx, k) => {
              cx.globalAlpha = 0.55;
              cx.strokeStyle = dk;
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
              cx.fillStyle = dk;
              cx.beginPath();
              cx.arc(4.2 * k, 2.4 * k, 0.32 * k, 0, TAU);
              cx.arc(7.8 * k, 5.9 * k, 0.25 * k, 0, TAU);
              cx.fill();
            })
          : null;
        if (mudPat) {
          const l = polyL('u-mud')!;
          ctx.fillStyle = mudPat;
          for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
        }
      }
      if (polyL('u-puddle')) {
        fillPolys('u-puddle', pal.riverFill, 0.7);
        strokePolys('u-puddle', mixHex(pal.trackFill, '#000000', 0.2), lw(0.3, 0.3), 0.6);
      }
      fillPolys('u-yard-earth', mixHex(pal.farmYard, pal.trackFill, 0.12), 0.85);
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
    const paved = (name: string, base: string, pat: CanvasPattern | null, patAlpha = 1): void => {
      fillPolys(name, base);
      if (near && pat) {
        const l = polyL(name);
        if (l) {
          ctx.fillStyle = pat;
          ctx.globalAlpha = patAlpha;
          for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
          ctx.globalAlpha = 1;
        }
      }
    };
    const pave = near
      ? getPattern(ctx, 'pave', 3, 3, 0, (cx, k) => {
          cx.globalAlpha = 0.55;
          cx.fillStyle = U.placeInk;
          cx.beginPath();
          cx.arc(1.5 * k, 1.5 * k, 0.28 * k, 0, TAU);
          cx.fill();
        })
      : null;
    const gardenPat =
      near && brushes
        ? brushes.pattern(ctx, 'garden', sc, dpr)
        : near
          ? getPattern(ctx, 'garden', 6, 6, isUnderdarkBiome(c.world.options.biome) ? 0 : 28, (cx, k) => {
              if (isUnderdarkBiome(c.world.options.biome)) {
                drawPanelCanvas(cx, { w: 0, h: 0, prims: [...underdarkMark('garden', 2 * k, 2 * k, 1.1 * k, pal, k), ...underdarkMark('garden', 4.5 * k, 4.5 * k, 1.1 * k, pal, k)] }, 0, 0, family);
                return;
              }
              cx.globalAlpha = 0.7;
              cx.strokeStyle = U.gardenInk;
              cx.lineWidth = 0.35 * k;
              cx.beginPath();
              cx.moveTo(0.6 * k, 1.5 * k);
              cx.lineTo(3.4 * k, 1.5 * k);
              cx.moveTo(3.2 * k, 4.5 * k);
              cx.lineTo(5.6 * k, 4.5 * k);
              cx.stroke();
            })
          : null;
    const gravePat = near
      ? getPattern(ctx, 'grave', 5, 4, 0, (cx, k) => {
          cx.globalAlpha = 0.8;
          cx.strokeStyle = U.gardenInk;
          cx.lineWidth = 0.25 * k;
          cx.beginPath();
          cx.moveTo(1.2 * k, 1.2 * k);
          cx.lineTo(1.2 * k, 2.8 * k);
          cx.moveTo(0.6 * k, 1.8 * k);
          cx.lineTo(1.8 * k, 1.8 * k);
          cx.moveTo(3.7 * k, 3.1 * k);
          cx.lineTo(3.7 * k, 3.9 * k);
          cx.moveTo(3.3 * k, 3.4 * k);
          cx.lineTo(4.1 * k, 3.4 * k);
          cx.stroke();
        })
      : null;
    paved('u-places', U.place, pave);
    if (!open) {
      paved('u-greens', U.garden, gardenPat, 0.6);
      paved('u-yards', U.garden, gravePat);
      if (!stilts) fillPolys('u-blocks', U.yard);
      paved('u-meadows', U.garden, gardenPat, 0.45);
    }
    paved('u-plazas', U.place, pave);
    {
      const kind = countryKind(c.world.options.biome);
      const ruralPattern =
        near && luOn && pal.tex[kind]
          ? getPattern(ctx, 'country-ground', 26, 20, 0, (cx, k) => {
              if (isUnderdarkBiome(c.world.options.biome)) {
                drawPanelCanvas(cx, { w: 0, h: 0, prims: [...underdarkMark('commons', 5 * k, 8 * k, 2.5 * k, pal, k), ...underdarkMark('commons', 18 * k, 17 * k, 2 * k, pal, k)] }, 0, 0, family);
                return;
              }
              cx.globalAlpha = 0.6;
              cx.strokeStyle = pal.grass;
              cx.lineWidth = 0.4 * k;
              cx.lineCap = 'round';
              cx.beginPath();
              for (const [x, y] of [
                [5, 8],
                [18, 17],
              ]) {
                cx.moveTo(x * k, y * k);
                cx.lineTo((x - 1.2) * k, (y - 2.4) * k);
                cx.moveTo(x * k, y * k);
                cx.lineTo((x + 1.2) * k, (y - 2.4) * k);
              }
              cx.stroke();
              cx.globalAlpha = 0.5;
              cx.fillStyle = pal.grass;
              cx.beginPath();
              cx.arc(15 * k, 5 * k, 0.55 * k, 0, TAU);
              cx.fill();
            })
          : null;
      FRINGE_ORDER.forEach(i => {
        const alpha = FRINGE_PAINT[i];
        const l = polyL('u-country-fringe-' + i);
        if (!l) return;
        const ids = l.index.query(rect);
        if (!ids.length) return;
        const p = cached(l.name + '|clip', () =>
          polyPath(
            P,
            l,
            l.polys.map((_, id) => id),
            0,
          ),
        );
        if (p) {
          ctx.save();
          ctx.clip(p, 'evenodd');
          ctx.globalAlpha = alpha;
          if (tex) drawVisibleTerrain();
          else {
            ctx.fillStyle = pal.paper;
            ctx.fill(p, 'evenodd');
          }
          if (luOn) {
            multiply(true);
            ctx.globalAlpha = alpha * pal.landOpacity;
            ctx.fillStyle = pal.land[kind];
            ctx.fill(p, 'evenodd');
            multiply(false);
            if (ruralPattern) {
              ctx.fillStyle = ruralPattern;
              ctx.globalAlpha = alpha;
              ctx.fill(p, 'evenodd');
            }
          }
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      });
      ctx.globalAlpha = 1;
      const fringe = polyL('u-country-fringe');
      if (fringe && fringe.index.query(rect).length) {
        const clip = cached(fringe.name + '|clip', () =>
          polyPath(
            P,
            fringe,
            fringe.polys.map((_, id) => id),
            0,
          ),
        );
        if (clip) {
          ctx.save();
          ctx.clip(clip, 'evenodd');
          strokeLines(
            linesOf(x => x.role === 'fringe-street'),
            U.street,
            x => x.width,
          );
          ctx.restore();
        }
      }
    }

    const natural = polyL('u-landscape-ground') ?? polyL('u-natural-ground');
    if (natural && natural.index.query(rect).length) {
      const clip = visibleClip(natural, rect);
      if (clip) {
        ctx.save();
        ctx.clip(clip, 'nonzero');
        ctx.globalAlpha = 1;
        if (tex) drawVisibleTerrain();
        else {
          ctx.fillStyle = pal.paper;
          ctx.fill(clip, 'nonzero');
        }
        if (c.world.options.contours)
          for (const l of linesOf(x => x.role === 'contour')) {
            const index = l.kind === 'index';
            strokeLines([l], pal.contour, () => mapStrokeWidth(index ? MAP_STROKES.contourIndex : MAP_STROKES.contour, sc, index ? pal.contourIndexW / 1.6 : (pal.contourThinW ?? 1)), index ? pal.contourOpacity : pal.contourOpacity * 0.7);
          }
        if (luOn) {
          for (const kind of NATURAL_LAND_KINDS) {
            const name = 'lu-' + kind;
            if (kind === 'forest') {
              ctx.save();
              const clip = timedRec('forestClip', () => forestClip(c, rect));
              if (clip) ctx.clip(clip, 'nonzero');
            }
            multiply(true);
            fillLand(name, kind);
            multiply(false);
            multiply(true);
            fillLand('u-cover-' + kind, kind);
            multiply(false);
            if (kind === 'forest') ctx.restore();
          }
          for (const tl of c.scene.textures) {
            if (cityCountrysideTextureVisible(tl.kind, sc) && (NATURAL_LAND_KINDS as readonly string[]).includes(tl.kind) && (pal.tex[tl.kind] || (brushes && isBrushKind(tl.kind) && brushTextureOn(tl.kind, pal, c.world.options.biome))))
              fs.textureTiles += drawTexture(c, ctx, tl, rect, band, lw, budgetRect);
          }
        }
        // Keep the original cased/dashed regional-road rendering within the restored ground.
        if (land) ctx.clip(land, 'evenodd');
        drawRegionalRoads(roads, tracks);
        // Restore native paths only where this opaque replay covered their earlier earth/causeway strokes.
        if (open && !c.scene.earthStreets && natural.name === 'u-landscape-ground') {
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
        }
        if (c.scene.earthStreets && natural.name === 'u-landscape-ground') strokeLines(uStreets.filter(isEarth), mixHex(pal.farmYard, pal.trackFill, 0.12), l => Math.max(1.2, l.width * 0.92, 0.8 / sc), 0.8);
        ctx.restore();
      }
    }

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
      const tt = mixHex(pal.land.meadow, pal.land.garden, 0.4);
      fillPolys('u-terraces', tt);
      strokePolys('u-terraces', tt, lw(1.5, 0.5));
    }
    paved('u-cornfields', mixHex(pal.land.field, U.gardenInk, 0.14), cornPat);
    if (polyL('u-cornfields') && lod.band >= 1) strokePolys('u-cornfields', U.gardenInk, lw(0.45, 0.4), 0.55);
    if (polyL('u-chinampa-canals')) fillPolys('u-chinampa-canals', pal.riverFill);
    paved('u-chinampas', U.garden, gardenPat);
    // urban water (moats, tanks, mill races) and the moat line outside a planned town's wall
    strokeLines(
      linesOf(l => l.role === 'uline' && (l.kind === 'moat' || l.kind === 'canal')),
      pal.riverFill,
      l => lw(l.width, 1),
    );
    if (polyL('u-water')) {
      fillPolys('u-water', pal.riverFill, 1, 'nonzero');
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
    if (natural && px(1) <= CITY_LOD_LIMITS[1])
      timedRec('place-roofs', () => drawPlaceholderRoofs(ctx, c.world, { viewport: pathRect, mpp: px(1), dpr, palette: 'terrain', night: roadStyle.night, Path: P, lane: path => strokeNaturalRoad(ctx, path, 'lane', roadWidth('lane', 3, sc), sc, roadStyle) }));
    // landmark buildings: the landmark tone, outlined
    const lmHatch = lod.fine
      ? getPattern(ctx, 'lmhatch', 1.6, 1.6, 45, (cx, k) => {
          cx.globalAlpha = 0.55;
          cx.strokeStyle = U.landmarkEdge;
          cx.lineWidth = 0.35 * k;
          cx.beginPath();
          cx.moveTo(0, 0.8 * k);
          cx.lineTo(1.6 * k, 0.8 * k);
          cx.stroke();
        })
      : null;
    const hatched = (name: string): void => {
      const l = polyL(name);
      if (!l || !lmHatch) return;
      ctx.fillStyle = lmHatch;
      ctx.globalAlpha = 1;
      for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
    };
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
