import { NATIVE_PARENT_SESSION_CAPABILITY, NATIVE_PARENT_SESSION_SCHEMA, type NativeParentSessionApi, type NativeParentEngineStatus } from './nativeParentSessionContract';
import { NATIVE_PARENT_CAPABILITY, NATIVE_PARENT_SCHEMA, type NativeParentApi } from './nativeParentContract';
import { parentWire, PARENT_LIMITS } from './nativeParentBudget';
import { NATIVE_ASSEMBLY_CAPABILITY, NATIVE_ASSEMBLY_RUNTIME_CAPABILITY, NATIVE_ASSEMBLY_TRANSPORT_CAPABILITY, type NativeAssemblyApi } from './nativeAssemblyContract';
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
type ArchitectureCall = 'placement' | 'profiles' | 'enrich' | 'plans' | 'realize-plan' | 'style-index' | 'assemble-pair' | 'unpack-assembly' | 'realize-assembly' | 'plan-parent-batch' | 'unpack-parent' | 'unpack-parent-batch' | 'realize-parent';
const isAssemblyCall = (kind: ArchitectureCall) => kind === 'assemble-pair' || kind === 'unpack-assembly' || kind === 'realize-assembly';
const isParentCall = (kind: ArchitectureCall) => kind === 'plan-parent-batch' || kind === 'unpack-parent' || kind === 'unpack-parent-batch' || kind === 'realize-parent';
/** Fresh capability check, never borrowed from a cached Single status. This is
 * also called before reading a selected site's native constraints. */
export async function requireNativeAssemblyCapability(runtime?: ExecutionRuntime, parent = false, session = false, qualified?: (value: NativeParentEngineStatus) => void): Promise<void> {
  if (runtime?.profile === 'local') {
    const response = await fetch(`${runtime.server.replace(/\/+$/, '')}/status`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Moteur natif inaccessible pour les assemblages.');
    const status = await response.json() as { service?: string; capabilities?: unknown };
    if (status.service !== 'magna-urbis-local' || !Array.isArray(status.capabilities)
      || !status.capabilities.includes(NATIVE_ASSEMBLY_RUNTIME_CAPABILITY) || !status.capabilities.includes(NATIVE_ASSEMBLY_TRANSPORT_CAPABILITY)
      || parent && !status.capabilities.includes(NATIVE_PARENT_CAPABILITY)
      || session && !status.capabilities.includes(NATIVE_PARENT_SESSION_CAPABILITY))
      throw new Error(`Moteur ancien : capabilities ${NATIVE_ASSEMBLY_RUNTIME_CAPABILITY} et ${NATIVE_ASSEMBLY_TRANSPORT_CAPABILITY}${parent ? ` et ${NATIVE_PARENT_CAPABILITY}` : ''}${session ? ` et ${NATIVE_PARENT_SESSION_CAPABILITY}` : ''} requises ; aucun appel d’assemblage effectué.`);
    const pair = await fetch(`${runtime.server.replace(/\/+$/, '')}/houses/native-assembly-capability`, { signal: AbortSignal.timeout(4000) });
    if (!pair.ok || parseArchitectureResult<string>(await pair.text()) !== NATIVE_ASSEMBLY_CAPABILITY)
      throw new Error(`Contrat natif incohérent : ${NATIVE_ASSEMBLY_CAPABILITY} attendu ; aucune lecture/assemblage effectué.`);
    qualified?.({ profile: 'local', service: status.service ?? null, capabilities: status.capabilities.filter((v: unknown): v is string => typeof v === 'string') });
    return;
  }
  ready ??= compileHousesModule().then(module => init({ module_or_path: module }));
  await ready;
  const api = wasm as ArchitectureWasm;
  const capabilities: unknown = typeof api.architecture_capabilities_json === 'function'
    ? parseArchitectureResult<unknown>(api.architecture_capabilities_json()) : undefined;
  if (!Array.isArray(capabilities) || !capabilities.includes(NATIVE_ASSEMBLY_RUNTIME_CAPABILITY)
    || !capabilities.includes(NATIVE_ASSEMBLY_TRANSPORT_CAPABILITY)
    || parent && (!capabilities.includes(NATIVE_PARENT_CAPABILITY) || typeof api.plan_parent_batch_json !== 'function'
      || typeof api.unpack_parent_json !== 'function' || typeof api.unpack_parent_batch_json !== 'function' || typeof api.realize_parent_json !== 'function')
    || session && (!capabilities.includes(NATIVE_PARENT_SESSION_CAPABILITY) || typeof api.begin_parent_session_json !== 'function'
      || typeof api.plan_parent_session_json !== 'function' || typeof api.ack_parent_session_json !== 'function'
      || typeof api.abort_parent_session_json !== 'function' || typeof api.release_parent_session_json !== 'function')
    || typeof api.native_assembly_capability_json !== 'function' || typeof api.assemble_pair_json !== 'function'
    || typeof api.unpack_assembly_json !== 'function' || typeof api.realize_assembly_json !== 'function'
    || parseArchitectureResult<string>(api.native_assembly_capability_json()) !== NATIVE_ASSEMBLY_CAPABILITY)
    throw new Error(`Module maisons ancien : ${NATIVE_ASSEMBLY_RUNTIME_CAPABILITY} et ${NATIVE_ASSEMBLY_TRANSPORT_CAPABILITY}${parent ? ` et ${NATIVE_PARENT_CAPABILITY}` : ''}${session ? ` et ${NATIVE_PARENT_SESSION_CAPABILITY}` : ''} requis ; aucun appel d’assemblage effectué.`);
  qualified?.({ profile: 'web', service: null, capabilities: capabilities.filter((v: unknown): v is string => typeof v === 'string') });
}
export interface ArchitectureCallOptions { signal?: AbortSignal }
export async function callArchitecture<T>(kind: ArchitectureCall, input: unknown, runtime?: ExecutionRuntime, options: ArchitectureCallOptions = {}): Promise<T> {
  options.signal?.throwIfAborted();
  let parentJson: string | undefined;
  if (isParentCall(kind)) {
    await requireNativeAssemblyCapability(runtime, true); options.signal?.throwIfAborted();
    const wire = parentWire(input);
    if (wire.bytes > PARENT_LIMITS.bytes || wire.floatSlots > PARENT_LIMITS.floatSlots || wire.rewrittenBytes > PARENT_LIMITS.rewrittenBytes)
      throw new Error('Native parent input exceeds scoped transport budgets; complete call refused.');
    parentJson = wire.json;
  }
  if (isAssemblyCall(kind)) {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 32 * 1024 * 1024) throw new Error('Native assembly input exceeds 32 MiB.');
    await requireNativeAssemblyCapability(runtime); options.signal?.throwIfAborted();
  }
  if (kind === 'placement' && hasNativeMinimumCandidates(input)) throw new Error('Les poses natives précalculées nécessitent la route de plans architecturaux.');
  if (runtime?.profile === 'local') {
    if (!isAssemblyCall(kind) && !isParentCall(kind)) await requireNativeArchitecture(runtime, input, kind);
    options.signal?.throwIfAborted();
    // Closing fetch does not cancel native geometry. Let a dispatched call drain
    // before releasing its scheduler slot, then discard superseded output. This
    // bounds actual server work during rapid camera/selection changes.
    const json = await (await nativeRequest(runtime, `/houses/${kind}`, parentJson ?? JSON.stringify(input))).text();
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
    : kind === 'style-index' ? api.architecture_style_index_json : kind === 'assemble-pair' ? api.assemble_pair_json
    : kind === 'unpack-assembly' ? api.unpack_assembly_json : kind === 'realize-assembly' ? api.realize_assembly_json
    : kind === 'plan-parent-batch' ? api.plan_parent_batch_json : kind === 'unpack-parent' ? api.unpack_parent_json
    : kind === 'unpack-parent-batch' ? api.unpack_parent_batch_json : kind === 'realize-parent' ? api.realize_parent_json : api.enrich_placement_json;
  if (typeof method !== 'function') throw new Error('Module d’architecture ancien. Reconstruisez le module maisons puis rechargez.');
  return parseArchitectureResult<T>(method(parentJson ?? JSON.stringify(input)));
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

/** Explicit experimental contract. A group never enters realize-plan/enrich. */
export function nativeAssemblyApi(runtime?: ExecutionRuntime): NativeAssemblyApi {
  return { require: () => requireNativeAssemblyCapability(runtime),
    assemble: input => callArchitecture('assemble-pair', input, runtime),
    unpack: archive => callArchitecture('unpack-assembly', archive, runtime),
    realize: archive => callArchitecture('realize-assembly', { assembly: archive, interiors: false }, runtime) };
}

/** Actual city parent API. New archives remain authoritative for world Singles too. */
export function nativeParentApi(runtime?: ExecutionRuntime): NativeParentApi {
  return { require: () => requireNativeAssemblyCapability(runtime, true),
    plan: input => callArchitecture('plan-parent-batch', input, runtime),
    unpack: archive => callArchitecture('unpack-parent', archive, runtime),
    unpackBatch: archives => callArchitecture('unpack-parent-batch', { schema_version: NATIVE_PARENT_SCHEMA, archives }, runtime),
    realize: (archive, interiors = false) => callArchitecture('realize-parent', { parent: archive, interiors }, runtime) };
}

/** One new API per generation run. Qualification is fresh before begin only;
 * all pages are pinned to the native incarnation+run nonce. No reconnect/rebegin
 * or legacy downgrade after failure; close calls ignore UI cancellation. */
export function nativeParentSessionApi(runtime?: ExecutionRuntime): NativeParentSessionApi {
  let qualification: Promise<void> | undefined, engine: NativeParentEngineStatus | null = null;
  const require = () => qualification ??= requireNativeAssemblyCapability(runtime, true, true, value => { engine = value; });
  const call = async <T>(kind: 'begin' | 'plan' | 'ack' | 'abort' | 'release', input: unknown): Promise<T> => {
    await require(); const wire = parentWire(input);
    if (wire.bytes > PARENT_LIMITS.bytes || wire.floatSlots > PARENT_LIMITS.floatSlots || wire.rewrittenBytes > PARENT_LIMITS.rewrittenBytes)
      throw new Error('Native parent session input exceeds transport limits; complete call refused.');
    if (runtime?.profile === 'local') {
      const response = await nativeRequest(runtime, `/houses/${kind}-parent-session`, wire.json);
      // Bound BEFORE decoding/parsing; close does not abort dispatched Rust CPU.
      const reader = response.body?.getReader(); if (!reader) throw new Error('Empty native parent session response.');
      const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = '';
      try { for (;;) { const piece = await reader.read(); if (piece.done) break;
        bytes += piece.value.byteLength; if (bytes > 64 * 1024 * 1024) { await reader.cancel(); throw new Error('Native parent session output exceeds64MiB.'); }
        text += decoder.decode(piece.value, { stream: true });
      } text += decoder.decode(); } finally { reader.releaseLock(); }
      return parseArchitectureResult<T>(text);
    }
    const api = wasm as ArchitectureWasm;
    const method = kind === 'begin' ? api.begin_parent_session_json : kind === 'plan' ? api.plan_parent_session_json
      : kind === 'ack' ? api.ack_parent_session_json : kind === 'abort' ? api.abort_parent_session_json : api.release_parent_session_json;
    if (typeof method !== 'function') throw new Error('Native parent session export is unavailable.');
    return parseArchitectureResult<T>(method(wire.json));
  };
  return { require, qualification: () => engine && { ...engine, capabilities: [...engine.capabilities] },
    begin: input => call('begin', input), plan: input => call('plan', input),
    ack: receipt => call('ack', { schema_version: NATIVE_PARENT_SESSION_SCHEMA, receipt }),
    abort: input => call('abort', input), release: input => call('release', input) };
}

/** Auto-routing probe only; missing capabilities are qualified legacy support,
 * while inaccessible/incoherent engines remain errors (no silent downgrade). */
export async function nativeParentSessionSupport(runtime?: ExecutionRuntime): Promise<{ supported: boolean; reason: string }> {
  const required = [NATIVE_ASSEMBLY_RUNTIME_CAPABILITY, NATIVE_ASSEMBLY_TRANSPORT_CAPABILITY, NATIVE_PARENT_CAPABILITY, NATIVE_PARENT_SESSION_CAPABILITY];
  if (runtime?.profile === 'local') {
    const response = await fetch(`${runtime.server.replace(/\/+$/, '')}/status`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Moteur local inaccessible pour qualifier la génération architecturale.');
    const status = await response.json() as { service?: string; capabilities?: unknown };
    if (status.service !== 'magna-urbis-local' || !Array.isArray(status.capabilities)) throw new Error('Statut natif invalide ; aucune génération de remplacement.');
    const capabilities = status.capabilities;
    const missing = required.filter(value => !capabilities.includes(value));
    if (missing.length) return { supported: false, reason: `Moteur sans ${missing.join(', ')} : génération héritée sans contrat d’assemblage des villes.` };
    return { supported: true, reason: 'Contrat parent/session natif disponible ; qualification figée à l’ouverture du run.' };
  }
  ready ??= compileHousesModule().then(module => init({ module_or_path: module })); await ready;
  const api = wasm as ArchitectureWasm;
  const capabilities: unknown = typeof api.architecture_capabilities_json === 'function' ? parseArchitectureResult(api.architecture_capabilities_json()) : [];
  if (!Array.isArray(capabilities)) throw new Error('Catalogue de capacités du module maisons invalide.');
  const missing = required.filter(value => !capabilities.includes(value));
  return missing.length ? { supported: false, reason: `Module sans ${missing.join(', ')} : génération héritée, assemblages de villes non pris en charge.` }
    : { supported: true, reason: 'Contrat parent/session du module disponible.' };
}
