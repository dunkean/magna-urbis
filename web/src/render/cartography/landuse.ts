/**
 * Land use as areas (drawVector, in this order): the contour lines under the tints, the land-use tints multiplied
 * over the hillshade (forest washes and their clips, brush fills, orchard and garden
 * hedges; the field class hands over to fields.ts), and the mask that keeps the tints off the water on a transparent
 * sheet. The tint painters (landPainters: fillLand, multiply, brush fills and trees) are part of the frame because
 * the farmsteads, the field network and the urban natural ground use them too.
 * Reads: world, scene, palette, the path cache, patterns, the forest washes, activeLight, terrainImg.
 */
import { brushTextureOn, type BrushKind } from '../brushes';
import { isUnderdarkBiome } from '../../gen/biomes';
import { forestLandPaint } from '../landuseForestTone';
import { CANVAS_MAP_STROKES as MAP_STROKES, mapStrokeWidth } from '../strokes';
import { LAND_ORDER } from '../scene';
import type { Palette } from '../styles';
import type { CartographyContext } from './context';
import type { FrameBase, LandPainters, VectorFrame } from './frame';
import { forestClip, forestWash } from './forest';
import { paintFieldTexture } from './fields';

export function paintContours(c: CartographyContext, f: VectorFrame): void {
  const { pal, linesOf } = c;
  const { sc, strokeLines } = f;
  if (c.world.options.contours) {
    for (const l of linesOf(x => x.role === 'contour')) {
      const idx = l.kind === 'index';
      strokeLines([l], pal.contour, () => mapStrokeWidth(idx ? MAP_STROKES.contourIndex : MAP_STROKES.contour, sc, idx ? pal.contourIndexW / 1.6 : (pal.contourThinW ?? 1)), idx ? pal.contourOpacity : pal.contourOpacity * 0.7);
    }
  }
}

export function* paintLandUseSteps(c: CartographyContext, f: VectorFrame): Generator<void> {
  const { pal, brushes, polyL, timedRec } = c;
  const { ctx, sc, lod, rect, lw, strokePolys, brushFill, luOn, fillLandSteps, multiply } = f;
  for (const kind of LAND_ORDER) {
    if (!luOn) break;
    if (!c.activeLight && c.deps.fullLanduse && !c.deps.fullLanduse(kind)) continue;
    const name = 'lu-' + kind;
    if (!polyL(name)) continue;
    // The ground paints the woods (render/treeSymbols.ts).
    if (kind === 'forest' && c.deps.groundTrees?.()) continue;
    if (kind === 'forest' && !c.activeLight) {
      ctx.save();
      const clip = timedRec('forestClip', () => forestClip(c, rect));
      if (clip) ctx.clip(clip, 'nonzero');
    }
    multiply(true);
    yield* fillLandSteps(name, kind);
    multiply(false);
    if (kind === 'field') paintFieldTexture(c, f, kind);
    if (!c.activeLight && brushes && lod.textures && (kind === 'field' || (kind === 'garden' && brushTextureOn(kind, pal, c.world.options.biome)))) brushFill(name, kind, sc);
    if ((kind === 'orchard' || kind === 'garden') && lod.strips) strokePolys(name, pal.hedge, lw(0.8, 0.8), 0.7);
    if (kind === 'forest' && !c.activeLight) ctx.restore();
    yield;
  }
}

export function paintLandMask(c: CartographyContext, f: VectorFrame): void {
  const { deps, S } = c;
  const { ctx, luOn } = f;
  // On a transparent sheet the backdrop's alpha is the land: the tints stay off the water below.
  // The land with the woods the ground paints (terrain() leaves them out: render/treeSymbols.ts punchWoods).
  const land = deps.land?.() ?? c.terrainImg;
  if (luOn && deps.transparentBackground && land) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(land as CanvasImageSource, 0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
  }
}

export function landPainters(c: CartographyContext, f: FrameBase): LandPainters {
  const { pal, deps, brushes, polyL, visibleClip } = c;
  const { ctx, sc, rect, dpr, polyPaths, fillPolys } = f;
  const world = c.world;
  const brushFill = (name: string, kind: BrushKind, scale: number): void => {
    if (c.activeLight) return;
    const l = polyL(name);
    if (!l?.polys.length) return;
    const pattern = brushes?.pattern(ctx, kind, scale, dpr);
    if (!pattern) return;
    ctx.fillStyle = pattern;
    for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
  };
  const brushTrees = (name: string, orchard = false): void => {
    if (c.activeLight) return;
    const l = polyL(name);
    if (!l || !brushes) return;
    for (const i of l.index.query(rect)) {
      const p = l.polys[i];
      if (!p.length) continue;
      const x0 = Math.min(...p.map(v => v.x)),
        x1 = Math.max(...p.map(v => v.x));
      const y0 = Math.min(...p.map(v => v.y)),
        y1 = Math.max(...p.map(v => v.y));
      brushes.tree(ctx, (x0 + x1) / 2, (y0 + y1) / 2, Math.min(x1 - x0, y1 - y0) / 2, orchard);
    }
  };
  const luOn = deps.mask?.landuse !== undefined ? deps.mask.landuse !== false : world.options.landuse;
  const luAlpha = pal.landOpacity;
  // Forest class: tone chosen by the shared « forest land use » setting (landuseForestTone.ts).
  const landFill = (kind: keyof Palette['land']): string => (kind === 'forest' ? forestLandPaint(pal).color : pal.land[kind]);
  const landAlpha = (kind: keyof Palette['land']): number => (kind === 'forest' ? forestLandPaint(pal).alpha : luAlpha);
  const fillLandSteps = function* (name: string, kind: keyof Palette['land']): Generator<void> {
    if (c.activeLight) {
      fillPolys(name, landFill(kind), landAlpha(kind));
      return;
    }
    if (kind === 'forest' && !isUnderdarkBiome(world.options.biome)) {
      const wash = forestWash(c, name);
      if (wash) {
        const clip = visibleClip(polyL(name)!, rect);
        if (!clip) return;
        ctx.save();
        ctx.clip(clip, 'nonzero');
        yield;
        fillPolys(name, landFill(kind), landAlpha(kind) * 0.18);
        yield;
        const gains = [0.2, 0.24, 0.32, 0.46];
        for (let i = 0; i < wash.levels.length; i++) {
          ctx.globalAlpha = landAlpha(kind) * gains[i];
          ctx.fillStyle = landFill(kind);
          for (const path of polyPaths(wash.levels[i])) ctx.fill(path, 'evenodd');
          yield;
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    } else {
      fillPolys(name, landFill(kind), landAlpha(kind));
      yield;
      const engraved = pal.name === 'parchment' && (kind === 'meadow' || kind === 'pasture' || kind === 'marsh');
      const layer = polyL(name),
        wash = layer && (kind === 'commons' || engraved) && !isUnderdarkBiome(world.options.biome) ? forestWash(c, 'lu-forest') : undefined;
      if (wash) {
        const clip = visibleClip(layer!, rect);
        if (!clip) return;
        ctx.save();
        ctx.clip(clip, 'nonzero');
        ctx.fillStyle = landFill('forest');
        // Parchment: one narrow engraved rim instead of the stepped halo (the steps read as contour rings).
        if (pal.name !== 'parchment')
          for (const level of wash.fringe) {
            ctx.globalAlpha = landAlpha('forest') * 0.06;
            for (const path of polyPaths(level)) ctx.fill(path, 'evenodd');
          }
        else {
          // The 14 m band stamped at small offsets: a smooth gradient, dark on the shadow side (south-east), faintly lit north-west.
          const stamp = (dx: number, dy: number, color: string, alpha: number, op: GlobalCompositeOperation): void => {
            ctx.save();
            ctx.globalCompositeOperation = op;
            ctx.translate(dx, dy);
            ctx.fillStyle = color;
            ctx.globalAlpha = alpha;
            for (const path of polyPaths(wash.fringe[0])) ctx.fill(path, 'evenodd');
            ctx.restore();
          };
          if (wash.fringe[0]) {
            for (let k = 1; k <= 3; k++) stamp(-3.5 * k, -4 * k, pal.paper, 0.05, 'source-over');
            for (let k = 0; k <= 6; k++) stamp(1.8 * k, 2.1 * k, pal.treeInk, 0.042, 'multiply');
          }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  };
  const fillLand = (name: string, kind: keyof Palette['land']): void => {
    for (const _ of fillLandSteps(name, kind)) {
      /* Synchronous painter. */
    }
  };
  const multiply = (on: boolean): void => {
    ctx.globalCompositeOperation = on && pal.landBlend === 'multiply' ? 'multiply' : 'source-over';
  };
  return { brushFill, brushTrees, luOn, landFill, landAlpha, fillLand, fillLandSteps, multiply };
}
