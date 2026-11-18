/**
 * Woods as areas: the forest wash (stepped edge levels and the shade fringe on the rough ground around, a raster
 * distance field vectorised once per layer geometry and shared across renderers), the clip that keeps woods out of
 * clearings and orchards, the room woods leave for roads and farms, and the conifer share per climate.
 * Reads: scene, world, palette, the path cache. Writes: forestWashes, forestRoom (context caches).
 */
import { biomeName } from '../../gen/biomes';
import { FARM_MARGIN, ForestRoom, farmClearings, forestCorridors, growRing } from '../forestRoom';
import { FOREST_EDGE_WIDTH } from '../landuseForestTone';
import { rasterizePolys } from '../../gen/geo/raster';
import { distanceField } from '../../gen/core/field';
import { vectorizeRegions } from '../../../../rust/bridge/landuseNative';
import { TileIndex, boxesOf } from '../tileindex';
import { orientPos } from '../../gen/geo/poly';
import { unionMany } from '../../gen/geo/bool';
import { PolyLayer, type Mark } from '../scene';
import { Rect4 } from '../view';
import type { CartographyContext } from './context';
import { frac, clumpNoise, addRing, layerHash } from './geometry';

/** Share of conifers in the woods of each climate; a broad noise mixes the stands at the transitions. */
const CONIFER_SHARE: Partial<Record<string, number>> = { tundra: 0.88, forest: 0.5, steppe: 0.3, temperate: 0.14 };
export const indicator = (field: Float32Array, test: (value: number, index: number) => boolean): Float32Array => {
  const out = new Float32Array(field.length);
  for (let i = 0; i < out.length; i++) if (test(field[i], i)) out[i] = 1;
  return out;
};
export type ForestWash = { levels: PolyLayer[]; fringe: PolyLayer[]; depth: Float32Array; reach: Float32Array; n: number };
const sharedForestWashes = new Map<string, ForestWash>();
/** Quarter masks preserve explicit park/garden holes; their union remains exact across retained parts. */
export function forestClip(c: CartographyContext, rect: Rect4): Path2D | null {
  const { S, P, polyL, cached } = c;
  const l = polyL('u-forest-clearings');
  const orchard = c.scene.textures.find(t => t.kind === 'orchard');
  if (!l && !orchard) return null;
  const view = { minX: rect.minX - 20, minY: rect.minY - 20, maxX: rect.maxX + 20, maxY: rect.maxY + 20 };
  const tiles = l?.index.tilesInRect(view) ?? [],
    big = l?.index.bigInRect(view) ?? [];
  const orchards = orchard?.index.query(view) ?? [];
  const stamp = tiles.map(t => `${t}:${l!.tileKeys?.[t] ?? ''}`).join(';') + '|' + big.map(i => `${i}:${l!.bigKeys?.[Array.prototype.indexOf.call(l!.index.big, i)] ?? ''}`).join(';');
  return cached(`u-forest-clearings|clip|${stamp}|orchards:${orchards.join(',')}`, () => {
    const ids = new Set<number>(big);
    for (const t of tiles) for (const i of l!.index.itemsOf(t)) ids.add(i);
    const excluded = unionMany([...ids].map(i => ({ outer: l!.polys[i], holes: l!.holes?.[i] ?? [] })).concat(orchards.map(i => ({ outer: orchard!.areas[i].poly, holes: orchard!.areas[i].holes ?? [] }))), 24, true);
    const p = new P();
    addRing(p, [
      { x: 0, y: 0 },
      { x: S, y: 0 },
      { x: S, y: S },
      { x: 0, y: S },
    ]);
    for (const shape of excluded) {
      addRing(p, orientPos(shape.outer).slice().reverse());
      for (const h of shape.holes) addRing(p, orientPos(h));
    }
    return p;
  });
}
/** Fade inside the retained woodland boundary; no cover polygon is displaced. */
export function forestWash(c: CartographyContext, name: string): ForestWash | undefined {
  const steps = forestWashSteps(c, name);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
export function* forestWashSteps(c: CartographyContext, name: string): Generator<boolean, ForestWash | undefined> {
  const { S, forestWashes, polyL } = c;
  const retained = forestWashes.get(name);
  if (retained) return retained;
  const layer = polyL(name);
  if (!layer) return undefined;
  // The wash is a pure function of the layer geometry: share it across renderers and scene rebuilds (every progress frame builds a new scene).
  const shareKey = `${name}|${S}|${c.scene.tileSize}|${layerHash(layer)}`;
  const shared = sharedForestWashes.get(shareKey);
  if (shared) {
    forestWashes.set(name, shared);
    return shared;
  }
  const n = Math.min(1024, Math.max(128, Math.ceil(S / 6))),
    cell = S / n;
  const mask = new Uint8Array(n * n);
  for (let i = 0; i < layer.polys.length; i++) {
    rasterizePolys([layer.polys[i], ...(layer.holes?.[i] ?? [])], n, n, cell, mask);
    if ((i & 31) === 31) yield false;
  }
  yield false;
  const reach = distanceField(mask, n, n, cell).dist;
  yield false;
  // Tracks and streams cut narrow gaps: the wood carries on across them, only its true edges fade.
  const depth = distanceField(
    Uint8Array.from(mask, (v, j) => (v || reach[j] < 20 ? 0 : 1)),
    n,
    n,
    cell,
  ).dist;
  const layerOf = (suffix: string, ind: Float32Array): PolyLayer => {
    const regions = vectorizeRegions(ind, n, n, cell, 0, { x0: 0, y0: 0, x1: n - 1, y1: n - 1 });
    const polys = regions.map(r => r.outer),
      holes = regions.map(r => r.holes);
    return { name: `${name}-${suffix}`, polys, holes, index: new TileIndex(S, c.scene.tileSize, boxesOf(polys), 'center') };
  };
  yield false;
  const levels: PolyLayer[] = [],
    fringe: PolyLayer[] = [];
  for (const [i, fraction] of [0.125, 0.3125, 0.5625, 0.875].entries()) {
    levels.push(
      layerOf(
        `edge-${i}`,
        indicator(depth, (d, j) => mask[j] !== 0 && d >= FOREST_EDGE_WIDTH * fraction),
      ),
    );
    yield false;
  }
  // Shade of the woods on the rough ground around them, in steps like the V1 halo.
  for (const [i, distance] of [14, 30, 48, 68, 90, 114, 140].entries()) {
    fringe.push(
      layerOf(
        `fringe-${i}`,
        indicator(reach, d => d < distance),
      ),
    );
    yield false;
  }
  const result = { levels, fringe, depth, reach, n };
  forestWashes.set(name, result);
  sharedForestWashes.set(shareKey, result);
  if (sharedForestWashes.size > 3) sharedForestWashes.delete(sharedForestWashes.keys().next().value!);
  return result;
}
export function forestWeight(c: CartographyContext, x: number, y: number): number {
  const { S } = c;
  const wash = forestWash(c, 'lu-forest');
  if (!wash) return 0;
  const xx = Math.min(wash.n - 1, Math.max(0, Math.floor((x / S) * wash.n)));
  const yy = Math.min(wash.n - 1, Math.max(0, Math.floor((y / S) * wash.n)));
  const t = Math.min(1, wash.depth[yy * wash.n + xx] / (FOREST_EDGE_WIDTH * 1.4));
  return 0.3 + 0.7 * t * t * (3 - 2 * t);
}
/** Lone trees stepping out of the wood: frequent near the edge, gone within 120 m. */
export function forestStray(c: CartographyContext, x: number, y: number): number {
  const { S } = c;
  const wash = forestWash(c, 'lu-forest');
  if (!wash) return 0;
  const xx = Math.min(wash.n - 1, Math.max(0, Math.floor((x / S) * wash.n)));
  const yy = Math.min(wash.n - 1, Math.max(0, Math.floor((y / S) * wash.n)));
  const t = 1 - Math.min(1, wash.reach[yy * wash.n + xx] / 120);
  return 0.34 * t * t;
}
export const roomOf = (c: CartographyContext): ForestRoom =>
  (c.forestRoom ??= new ForestRoom(forestCorridors(c.world), [...farmClearings(c.world.landuse), ...(c.world.landuse?.areas ?? []).filter(a => a.kind === 'orchard'), ...(c.deps.buildingClearings?.() ?? []).map(r => growRing(r, FARM_MARGIN))]));
/** Conifer or broadleaf for a forest crown, from the climate and a broad mixing noise. */
export function coniferOf(c: CartographyContext, m: Mark): boolean {
  const share = CONIFER_SHARE[biomeName(c.world.options.biome)] ?? 0;
  return share > 0 && frac(m.k * 53.3) < Math.max(0, Math.min(1, share + (clumpNoise(m.x, m.y, 420, 9) - 0.5) * 1.3));
}
