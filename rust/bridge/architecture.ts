import init, * as wasm from '../pkg/houses/magna_urbis_houses_wasm.js';
import { compileHousesModule } from './houses';
import { nativeRequest } from './nativeEngine';
import { parseArchitectureResult, type ArchitectureWasm, type PlacementBatch, type PlacementBatchRequest, type PlacedBuilding, type EnrichedPlacement } from './urbanArchitecture';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { placeArchitectureBatches, placeArchitectureSource, streamArchitectureBatches, streamArchitectureSource, type ArchitectureBatchHeader, type ArchitectureRequestSource, type ArchitectureBatchOptions, type ArchitectureStreamOptions, type ArchitectureStreamSummary } from './architectureBatch';
import { archivePlanBatch, resolveArchivedPlan, type PlanArchiveScene } from './compactPlanArchive';

let ready: Promise<unknown> | undefined;
const nativeCapabilities = new Map<string, Promise<string[]>>();
function hasNativeMinimumCandidates(input: unknown): boolean {
  const batch = input as Partial<PlacementBatchRequest> | undefined;
  return Array.isArray(batch?.requests) && batch.requests.some(r => Array.isArray(r?.native_minimum_candidates) && r.native_minimum_candidates.length > 0);
}
async function requireNativeArchitecture(runtime: ExecutionRuntime, input: unknown, kind: ArchitectureCall): Promise<void> {
  let pending = nativeCapabilities.get(runtime.server);
  if (!pending) {
    pending = fetch(`${runtime.server.replace(/\/$/, '')}/status`, { signal: AbortSignal.timeout(4000) }).then(async response => {
      if (!response.ok) throw new Error('Moteur Rust local inaccessible.');
      const status = await response.json() as { service?: string; capabilities?: string[] };
      if (status.service !== 'magna-urbis-local' || !status.capabilities?.includes('houses.placement')) throw new Error('Moteur Rust local ancien : reconstruisez le moteur local puis relancez les bancs pour activer les villes et les maisons.');
      return status.capabilities;
    });
    nativeCapabilities.set(runtime.server, pending);
  }
  try {
    const capabilities = await pending;
    if (hasNativeMinimumCandidates(input) && !capabilities.includes('houses.native-minimum-candidates-v1')) {
      throw new Error('Actualisez le moteur Rust local : cette demande contient des poses natives précalculées que cet ancien moteur ne sait pas vérifier.');
    }
    const feature = kind === 'plans' || kind === 'realize-plan' ? 'houses.compact-plans' : kind === 'style-index' ? 'houses.style-index' : undefined;
    if (feature && !capabilities.includes(feature)) { nativeCapabilities.delete(runtime.server); throw new Error('Actualisez le moteur Rust local pour activer les plans architecturaux compacts et leur catalogue.'); }
    if ((input as PlacementBatchRequest | undefined)?.settings?.culture && !capabilities.includes('urban.architecture-culture')) throw new Error('Actualisez le moteur Rust local pour choisir une culture architecturale indépendante.');
    if ((input as PlacementBatchRequest | undefined)?.settings?.parcel_fit && !capabilities.includes('houses.parcel-fit')) throw new Error('Actualisez le moteur Rust local pour adapter les bâtiments à leurs parcelles.');
    const model = (input as PlacementBatchRequest | undefined)?.settings?.house_config;
    if (model && !capabilities.includes(model.workshop ? 'houses.workshop-template' : 'houses.config-template')) {
      nativeCapabilities.delete(runtime.server);
      throw new Error('Ce moteur Rust doit être actualisé pour réutiliser les paramètres du banc Maisons.');
    }
  } catch (error) { nativeCapabilities.delete(runtime.server); throw error; }
}
/** Coarse native calls; this adapter neither chooses recipes nor moves geometry. */
type ArchitectureCall = 'placement' | 'profiles' | 'enrich' | 'plans' | 'realize-plan' | 'style-index';
export interface ArchitectureCallOptions { signal?: AbortSignal }
export async function callArchitecture<T>(kind: ArchitectureCall, input: unknown, runtime?: ExecutionRuntime, options: ArchitectureCallOptions = {}): Promise<T> {
  options.signal?.throwIfAborted();
  if (kind === 'placement' && hasNativeMinimumCandidates(input)) throw new Error('Les poses natives précalculées nécessitent la route de plans architecturaux.');
  if (runtime?.profile === 'local') {
    await requireNativeArchitecture(runtime, input, kind);
    options.signal?.throwIfAborted();
    // Closing fetch does not cancel native geometry. Let a dispatched call drain
    // before releasing its scheduler slot, then discard superseded output. This
    // bounds actual server work during rapid camera/selection changes.
    const json = await (await nativeRequest(runtime, `/houses/${kind}`, JSON.stringify(input))).text();
    options.signal?.throwIfAborted();
    return parseArchitectureResult<T>(json);
  }
  ready ??= compileHousesModule().then(module => init({ module_or_path: module }));
  await ready;
  options.signal?.throwIfAborted();
  const api = wasm as unknown as ArchitectureWasm;
  const model = (input as PlacementBatchRequest | undefined)?.settings?.house_config;
  if (model || hasNativeMinimumCandidates(input)) {
    const capabilities = typeof api.architecture_capabilities_json === 'function' ? parseArchitectureResult<string[]>(api.architecture_capabilities_json()) : [];
    if (model && !capabilities.includes(model.workshop ? 'houses.workshop-template' : 'houses.config-template')) throw new Error('Module maisons ancien : reconstruisez-le puis rechargez pour réutiliser un modèle du banc Maisons.');
    if (hasNativeMinimumCandidates(input) && !capabilities.includes('houses.native-minimum-candidates-v1')) throw new Error('Module maisons ancien : reconstruisez-le puis rechargez pour vérifier les poses natives précalculées.');
  }
  const method = kind === 'placement' ? api.place_buildings_json : kind === 'profiles' ? api.architecture_profiles_json
    : kind === 'plans' ? api.plan_buildings_json : kind === 'realize-plan' ? api.realize_plan_json
    : kind === 'style-index' ? api.architecture_style_index_json : api.enrich_placement_json;
  if (typeof method !== 'function') throw new Error('Module d’architecture ancien. Reconstruisez le module maisons puis rechargez.');
  return parseArchitectureResult<T>(method(JSON.stringify(input)));
}
export const placeUrbanBuildings = (input: PlacementBatchRequest, runtime?: ExecutionRuntime,
  options?: Parameters<typeof placeArchitectureBatches>[2]): Promise<PlacementBatch> =>
  placeArchitectureBatches(input, batch => callArchitecture<PlacementBatch>('placement', batch, runtime), options);
export const planUrbanBuildings = (input: PlacementBatchRequest & {footprints?: Record<string, import('./housesContract').Surface>}, runtime?: ExecutionRuntime,
  options?: Parameters<typeof placeArchitectureBatches>[2]): Promise<PlacementBatch> =>
  placeArchitectureBatches(input, async batch => archivePlanBatch(await callArchitecture<PlacementBatch>('plans', batch, runtime)), options);
/** Paged sites share one neighbour index and the same archive/ACK path as arrays. */
export const planUrbanBuildingSource = (input: ArchitectureBatchHeader, source: ArchitectureRequestSource,
  runtime?: ExecutionRuntime, options?: ArchitectureBatchOptions): Promise<PlacementBatch> =>
  placeArchitectureSource(input, source, async batch => archivePlanBatch(await callArchitecture<PlacementBatch>('plans', batch, runtime)), options);
/** Publish archived native chunks and retain only completion counts/occupations. */
export const streamUrbanBuildingPlans = (input: PlacementBatchRequest & { footprints?: Record<string, import('./housesContract').Surface> },
  runtime: ExecutionRuntime | undefined, options: ArchitectureStreamOptions): Promise<ArchitectureStreamSummary> =>
  streamArchitectureBatches(input, async batch => archivePlanBatch(await callArchitecture<PlacementBatch>('plans', batch, runtime)), options);
/** Non-collecting counterpart for revision-bound paged site readers. */
export const streamUrbanBuildingSource = (input: ArchitectureBatchHeader, source: ArchitectureRequestSource,
  runtime: ExecutionRuntime | undefined, options: ArchitectureStreamOptions): Promise<ArchitectureStreamSummary> =>
  streamArchitectureSource(input, source, async batch => archivePlanBatch(await callArchitecture<PlacementBatch>('plans', batch, runtime)), options);
/** Elaborate the retained plan; this never reruns recipe selection or parcel fitting. */
export const realizeUrbanBuilding = async (building: PlacedBuilding, runtime?: ExecutionRuntime, interiors = false, scene?: PlanArchiveScene, options: ArchitectureCallOptions = {}): Promise<EnrichedPlacement> => {
  options.signal?.throwIfAborted();
  return building.simplification === 'architectural_plan'
    ? callArchitecture('realize-plan', {building: {...building, resolved: await resolveArchivedPlan(building, scene)}, interiors}, runtime, options)
    : callArchitecture('enrich', building, runtime, options);
};
export const enrichUrbanBuilding = (building: PlacedBuilding, runtime?: ExecutionRuntime, scene?: PlanArchiveScene): Promise<EnrichedPlacement> =>
  building.simplification === 'architectural_plan' ? realizeUrbanBuilding(building, runtime, true, scene) : callArchitecture('enrich', building, runtime);
export const architecturalStyleIndex = (runtime?: ExecutionRuntime): Promise<import('./buildingStyles').BuildingStyleIndex> => callArchitecture('style-index', {}, runtime);
