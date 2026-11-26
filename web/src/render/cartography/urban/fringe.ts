/**
 * Where the town meets the country (urban.ts, after the paved grounds): the country fringe bands (terrain, land tint
 * and ground pattern faded in steps, the fringe streets), then the natural ground restored inside the town (terrain,
 * contours, natural land use and textures, regional roads and earth streets replayed over it).
 * Reads: world, scene, palette, the path cache, patterns, the forest washes. Writes: textureTiles of the frame stats.
 */
import { setMapInk } from '../../gpu/recorder';
import { cityCountrysideTextureVisible } from '../../cityEnvironment';
import { isUnderdarkBiome } from '../../../gen/biomes';
import { brushTextureOn, isBrushKind } from '../../brushes';
import { CANVAS_MAP_STROKES as MAP_STROKES, mapStrokeWidth } from '../../strokes';
import { NATURAL_LAND_KINDS, countryKind, FRINGE_ORDER, FRINGE_PAINT } from '../../countryside';
import { drawPanelCanvas } from '../../legend';
import { underdarkMark } from '../../underdark';
import type { CartographyContext } from '../context';
import type { VectorFrame } from '../frame';
import { TAU, polyPath } from '../geometry';
import { forestClip } from '../forest';
import { drawTexture } from '../symbols';
import type { UrbanFrame } from './frame';

/** The country fringe bands and their streets. */
export function paintCountryFringe(c: CartographyContext, f: VectorFrame, u: UrbanFrame): void {
  const { pal, P, family, polyL, linesOf, cached, getPattern } = c;
  const { ctx, rect, strokeLines, tex, drawVisibleTerrain, luOn, multiply } = f;
  const { U, near } = u;
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
            cx.strokeStyle = c.ink('grass').css;
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
            cx.fillStyle = c.ink('grass').css;
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
          setMapInk(ctx, 'fillStyle', c.ink(kind));
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
}

/** The natural ground restored inside the town. */
export function paintRestoredGround(c: CartographyContext, f: VectorFrame, u: UrbanFrame): void {
  const { pal, brushes, linesOf, timedRec, visibleClip } = c;
  const { ctx, sc, band, rect, budgetRect, fs, lw, strokeLines, drawRegionalRoads, tex, drawVisibleTerrain, luOn, fillLand, multiply, land, roads, tracks } = f;
  const { U, uStreets, isEarth, open, earth, restored } = u;
  if (restored && restored.index.query(rect).length) {
    const clip = visibleClip(restored, rect);
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
      if (open && !c.scene.earthStreets && restored.name === 'u-landscape-ground') {
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
      if (c.scene.earthStreets && restored.name === 'u-landscape-ground') strokeLines(uStreets.filter(isEarth), c.ink('yardEarth'), l => Math.max(1.2, l.width * 0.92, 0.8 / sc), 0.8);
      ctx.restore();
    }
  }
}
