import init, * as wasm from '../pkg/houses/magna_urbis_houses_wasm.js';
import { compileHousesModule } from './houses';
import { nativeRequest } from './nativeEngine';
import { parseArchitectureResult, type ArchitectureWasm, type PlacementBatch, type PlacementBatchRequest, type PlacedBuilding, type EnrichedPlacement } from './urbanArchitecture';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { placeArchitectureBatches } from './architectureBatch';

let ready: Promise<unknown> | undefined;
const nativeCapabilities = new Map<string, Promise<string[]>>();
async function requireNativeArchitecture(runtime: ExecutionRuntime, input: unknown): Promise<void> {
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
export async function callArchitecture<T>(kind: 'placement' | 'profiles' | 'enrich', input: unknown, runtime?: ExecutionRuntime): Promise<T> {
  if (runtime?.profile === 'local') {
    await requireNativeArchitecture(runtime, input);
    return parseArchitectureResult<T>(await (await nativeRequest(runtime, `/houses/${kind}`, JSON.stringify(input))).text());
  }
  ready ??= compileHousesModule().then(module => init({ module_or_path: module }));
  await ready;
  const api = wasm as unknown as ArchitectureWasm;
  const model = (input as PlacementBatchRequest | undefined)?.settings?.house_config;
  if (model) {
    const capabilities = typeof api.architecture_capabilities_json === 'function' ? parseArchitectureResult<string[]>(api.architecture_capabilities_json()) : [];
    if (!capabilities.includes(model.workshop ? 'houses.workshop-template' : 'houses.config-template')) throw new Error('Module maisons ancien : reconstruisez-le puis rechargez pour réutiliser un modèle du banc Maisons.');
  }
  const method = kind === 'placement' ? api.place_buildings_json : kind === 'profiles' ? api.architecture_profiles_json : api.enrich_placement_json;
  if (typeof method !== 'function') throw new Error('Module d’architecture ancien. Reconstruisez le module maisons puis rechargez.');
  return parseArchitectureResult<T>(kind === 'profiles' ? api.architecture_profiles_json() : method(JSON.stringify(input)));
}
export const placeUrbanBuildings = (input: PlacementBatchRequest, runtime?: ExecutionRuntime,
  options?: Parameters<typeof placeArchitectureBatches>[2]): Promise<PlacementBatch> =>
  placeArchitectureBatches(input, batch => callArchitecture<PlacementBatch>('placement', batch, runtime), options);
export const enrichUrbanBuilding = (building: PlacedBuilding, runtime?: ExecutionRuntime): Promise<EnrichedPlacement> => callArchitecture('enrich', building, runtime);
