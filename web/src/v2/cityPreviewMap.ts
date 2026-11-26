/** Display geometry that a one-shot embed worker transfers to the shared Minimal painter. */
import type { MinimalFeature, MinimalPoint } from '../render/minimalMap';
import type { Rect4 } from '../render/view';
import type { CompositionRecipe, TownPlan } from '../render/composition';
import type { ExternalCityHints } from './externalCity/types';
import type { WasmThreadsInfo } from '../../../rust/bridge/wasmThreads';
import type { World } from '../gen/types';
import type { V2Settings, V2Progress } from './contracts';

export const cityEmbedStartsWithBlocks = (population = 2500): boolean => population >= 20_000;

export type CityPreviewMode = 'compact' | 'detailed' | 'houses';
export interface CityPreviewRequest {
  hints: ExternalCityHints;
  local: boolean;
  mode: CityPreviewMode;
}
export interface CityPreviewMap {
  size: number;
  bounds: Rect4;
  geometry: PackedFeatures;
  recipe: CompositionRecipe;
  plan: TownPlan;
}
export interface CityPreviewResult {
  type: 'city-preview';
  mode: 'compact';
  runtime: 'native' | 'wasm';
  wasm?: WasmThreadsInfo;
  town: { buildings: number; layouts: number; streets: number };
  map: CityPreviewMap;
}
export type DetailedCityResult = Omit<CityPreviewResult, 'mode' | 'map'> & { mode: 'detailed' | 'houses'; world: World; settings: V2Settings; bounds: Rect4 };
export type CityDetailStyle = 'satellite-light' | 'satellite-2';
export type CityPreviewResponse = { type: 'progress'; progress: V2Progress } | CityPreviewResult | DetailedCityResult | { type: 'error'; error: string };

interface PackedFeatures {
  layers: string[];
  rings: Uint32Array;
  coords: Float64Array;
}

/** Encode the shared painter's exact rings in order, including holes and open street segments. */
export function packMinimalFeatures(features: MinimalFeature[]): PackedFeatures {
  const layerIds = new Map<string, number>();
  let rings = 0,
    points = 0;
  for (const feature of features) {
    if (!layerIds.has(feature.layer)) layerIds.set(feature.layer, layerIds.size);
    rings += 1 + (feature.holes?.length ?? 0);
    points += feature.points.length;
    for (const hole of feature.holes ?? []) points += hole.length;
  }
  const headers = new Uint32Array(2 * features.length + rings),
    coords = new Float64Array(2 * points);
  let h = 0,
    c = 0;
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
  let h = 0,
    c = 0;
  const read = () => {
    const ring = new Array<MinimalPoint>(rings[h++]);
    for (let i = 0; i < ring.length; i++) ring[i] = { x: coords[c++], y: coords[c++] };
    return ring;
  };
  while (h < rings.length) {
    const tag = rings[h++],
      count = rings[h++],
      points = read();
    const holes = count > 1 ? Array.from({ length: count - 1 }, read) : undefined;
    yield { layer: layers[tag >>> 1], closed: !!(tag & 1), points, holes };
  }
}
