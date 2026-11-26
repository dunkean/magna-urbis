/**
 * The shared part of the urban layers of one frame (urban.ts builds it once per drawVector call that reaches the
 * block level of detail): the street classes, the open / stilt ground flags, the patterns of paved, planted and
 * grave grounds and of landmarks, and the building budgets. Reads: world, palette, patterns.
 */
import { type MapInk } from '../../gpu/recorder';
import { isUnderdarkBiome } from '../../../gen/biomes';
import { LineLayer, type PolyLayer } from '../../scene';
import { drawPanelCanvas } from '../../legend';
import { underdarkMark } from '../../underdark';
import type { CartographyContext } from '../context';
import type { VectorFrame } from '../frame';
import { TAU } from '../geometry';
import type { Palette } from '../../styles';

/** Building masses in view up to which they are outlined and shadowed; past BUILDING_BUDGET_MAX none are drawn. */
export const BUILDING_BUDGET_FULL = 120_000;
export const BUILDING_BUDGET_MAX = 450_000;
/** Individually outlined buildings in view above which we fall back to merged masses. */
export const BUILDING_BUDGET_INDIV = 160_000;

/** What the urban layers of one frame share: the town palette, the street classes, the ground flags and the patterns. */
export interface UrbanFrame {
  readonly U: Palette['urban'];
  readonly uStreets: LineLayer[];
  /** Village and hamlet streets (layers 'vstreet-*'): never the far-zoom arterial strokes. */
  readonly isVillage: (l: LineLayer) => boolean;
  readonly isEarth: (l: LineLayer) => boolean;
  /** Streets up to a rank (r0 arterial, r1 primary...), covered ones excepted. */
  readonly mainsOf: (maxRank: number) => LineLayer[];
  /** A stilt town: no ground, boardwalks over the water. */
  readonly stilts: boolean;
  /** Open ground (camps, barbarian villages): no street space or block fill (same rules as render/urban.ts). */
  readonly open: boolean;
  /** Trampled earth of the open ground's paths. */
  readonly earth: MapInk;
  /** Close enough for patterns. */
  readonly near: boolean;
  /** A fill, then its pattern when near. */
  readonly paved: (name: string, base: MapInk, pat: CanvasPattern | null, patAlpha?: number) => void;
  readonly pave: CanvasPattern | null;
  readonly gardenPat: CanvasPattern | null;
  readonly gravePat: CanvasPattern | null;
  /** The natural ground restored inside the town ('u-landscape-ground' or 'u-natural-ground'), if any. */
  readonly restored: PolyLayer | undefined;
  readonly lmHatch: CanvasPattern | null;
  /** The landmark hatch over a layer. */
  readonly hatched: (name: string) => void;
}

function drawPaving(cx: CanvasRenderingContext2D, k: number): void {
  cx.globalAlpha = 0.55;
  cx.beginPath();
  cx.arc(1.5 * k, 1.5 * k, 0.28 * k, 0, TAU);
  cx.fill();
}

function drawGraves(cx: CanvasRenderingContext2D, k: number): void {
  cx.globalAlpha = 0.8;
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
}

function drawLandmarkHatch(cx: CanvasRenderingContext2D, k: number): void {
  cx.globalAlpha = 0.55;
  cx.lineWidth = 0.35 * k;
  cx.beginPath();
  cx.moveTo(0, 0.8 * k);
  cx.lineTo(1.6 * k, 0.8 * k);
  cx.stroke();
}

/** The urban frame of a drawVector call at the block level of detail. */
export function urbanFrame(c: CartographyContext, f: VectorFrame): UrbanFrame {
  const { pal, brushes, family, polyL, linesOf, getPattern } = c;
  const { ctx, sc, lod, dpr, polyPaths, fillPolys } = f;
  const U = pal.urban;
  const uStreets = linesOf(l => l.role === 'street');
  // (village and hamlet streets, layers 'vstreet-*', never get the far-zoom arterial strokes)
  const isVillage = (l: LineLayer): boolean => l.name.startsWith('vstreet-');
  const isEarth = (l: LineLayer): boolean => /e(?:c)?$/.test(l.kind);
  const mainsOf = (maxRank: number): LineLayer[] => uStreets.filter(l => Number(l.kind.slice(1, 2)) <= maxRank && !l.kind.endsWith('c'));
  const stilts = !!c.world.urban?.renderHints?.stilts;
  // open ground (camps, barbarian villages): no street space or block fill (same rules as render/urban.ts)
  const open = !!c.world.urban?.renderHints?.openGround && !stilts;
  const earth = c.ink('pathEarth');
  const near = lod.band >= 2;
  const paved = (name: string, base: MapInk, pat: CanvasPattern | null, patAlpha = 1): void => {
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
  const pave = near ? getPattern(ctx, 'pave', 3, 3, 0, drawPaving, 'placeInk') : null;
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
  const gravePat = near ? getPattern(ctx, 'grave', 5, 4, 0, drawGraves, 'gardenInk') : null;
  const natural = polyL('u-landscape-ground') ?? polyL('u-natural-ground');
  const lmHatch = lod.fine ? getPattern(ctx, 'lmhatch', 1.6, 1.6, 45, drawLandmarkHatch, 'landmarkEdge') : null;
  const hatched = (name: string): void => {
    const l = polyL(name);
    if (!l || !lmHatch) return;
    ctx.fillStyle = lmHatch;
    ctx.globalAlpha = 1;
    for (const p of polyPaths(l)) ctx.fill(p, 'evenodd');
  };
  return { U, uStreets, isVillage, isEarth, mainsOf, stilts, open, earth, near, paved, pave, gardenPat, gravePat, restored: natural, lmHatch, hatched };
}
