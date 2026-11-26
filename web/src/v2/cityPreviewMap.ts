/** Display geometry that a one-shot embed worker transfers to the shared Minimal painter. */
import type { MinimalFeature, MinimalHeight, MinimalPoint } from '../render/minimalMap';
import type { Rect4 } from '../render/view';
import type { CompositionRecipe, TownPlan } from '../render/composition';
import type { ExternalCityHints } from './externalCity/types';
import type { V2Progress } from './contracts';

export type CityPreviewMode = 'compact' | 'detailed';
export interface CityPreviewRequest {
  hints: ExternalCityHints;
  local: boolean;
  mode: CityPreviewMode;
}
export interface CityPreviewMap {
  size: number;
  bounds: Rect4;
  geometry: PackedFeatures;
  height?: MinimalHeight;
  recipe: CompositionRecipe;
  plan: TownPlan;
}
export type CityPreviewResponse =
  | { type: 'progress'; progress: V2Progress }
  | { type: 'city-preview'; mode: CityPreviewMode; runtime: 'native' | 'wasm'; town: { buildings: number; layouts: number; streets: number }; map: CityPreviewMap }
  | { type: 'error'; error: string };

interface PackedFeatures {
  layers: string[];
  rings: Uint32Array;
  coords: Float64Array;
}

/** Encode the shared painter's exact rings in order, including holes and open street segments. */
export function packMinimalFeatures(features: MinimalFeature[]): PackedFeatures {
  const layerIds = new Map<string, number>();
  let rings = 0, points = 0;
  for (const feature of features) {
    if (!layerIds.has(feature.layer)) layerIds.set(feature.layer, layerIds.size);
    rings += 1 + (feature.holes?.length ?? 0);
    points += feature.points.length;
    for (const hole of feature.holes ?? []) points += hole.length;
  }
  const headers = new Uint32Array(2 * features.length + rings), coords = new Float64Array(2 * points);
  let h = 0, c = 0;
  const write = (ring: readonly MinimalPoint[]) => {
    headers[h++] = ring.length;
    for (const p of ring) {
      coords[c++] = p.x;
      coords[c++] = p.y;
    }
  };
  for (const feature of features) {
    headers[h++] = 2 * layerIds.get(feature.layer)! + Number(!!feature.closed);
    headers[h++] = 1 + (feature.holes?.length ?? 0);
    write(feature.points);
    for (const hole of feature.holes ?? []) write(hole);
  }
  return { layers: [...layerIds.keys()], rings: headers, coords };
}

/** Materialise only the feature the painter is currently batching. */
export function* unpackMinimalFeatures({ layers, rings, coords }: PackedFeatures): Generator<MinimalFeature> {
  let h = 0, c = 0;
  const read = () => {
    const ring = new Array<MinimalPoint>(rings[h++]);
    for (let i = 0; i < ring.length; i++) ring[i] = { x: coords[c++], y: coords[c++] };
    return ring;
  };
  while (h < rings.length) {
    const tag = rings[h++], count = rings[h++], points = read();
    const holes = count > 1 ? Array.from({ length: count - 1 }, read) : undefined;
    yield { layer: layers[tag >>> 1], closed: !!(tag & 1), points, holes };
  }
}
