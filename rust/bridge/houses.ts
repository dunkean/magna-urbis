import init, { catalogue_json, preflight_json, generate_houses_json } from '../pkg/houses/magna_urbis_houses_wasm.js';
import wasmUrl from '../pkg/houses/magna_urbis_houses_wasm_bg.wasm?url&inline';
import { HOUSE_SCHEMA, HOUSE_MAX_JSON_BYTES, type HouseRole, type HouseConfig, type HouseRequest, type Envelope, type CatalogueBundle } from './housesContract';
import { nativeRequest } from './nativeEngine';
export * from './housesContract';

export const ROLE_LABELS: Record<HouseRole, string> = {dwelling: 'habitation', residential_ensemble: 'ensemble résidentiel', communal_dwelling: 'habitat collectif', mixed_residential: 'habitat mixte', domestic_annex: 'annexe domestique', spatial_component: 'composant spatial', non_domestic: 'non résidentiel', landscape: 'paysage'};
export function defaultHouseConfig(): HouseConfig {
  return {schema_version: HOUSE_SCHEMA, seed: '42', pack: 'EUR-MED', recipe: null, mode: 'historical_inspired', era: 'any', allow_late: false, count: 10, size: 1, variation: 0.65, wealth: 0.5, orientation_deg: 0, overrides: {variant: null, footprint: null, roof: null, frame: null, infill: null, coating: null, cladding: null, floors: null, bodies: null, courtyard_ratio: null, overhang_m: null, roof_pitch_deg: null, site_slope_deg: null}};
}

let ready: Promise<unknown> | undefined;
let compiled: Promise<WebAssembly.Module> | undefined;
export function compileHousesModule(): Promise<WebAssembly.Module> {
  return compiled ??= fetch(wasmUrl).then(response => {
    if (!response.ok) throw new Error(`Module maisons indisponible (${response.status}).`);
    return response.arrayBuffer();
  }).then(bytes => WebAssembly.compile(bytes));
}
export async function callHouses(request: HouseRequest): Promise<string> {
  if (request.runtime?.profile === 'local') {
    const response = await nativeRequest(request.runtime, `/houses/${request.kind}`, JSON.stringify(request.kind === 'catalogue' ? {} : request.config));
    return response.text();
  }
  ready ??= (async () => init({module_or_path: request.module ?? await compileHousesModule()}))();
  await ready;
  const json = request.kind === 'catalogue' ? catalogue_json() : request.kind === 'preflight' ? preflight_json(JSON.stringify(request.config)) : generate_houses_json(JSON.stringify(request.config));
  if (new TextEncoder().encode(json).byteLength > HOUSE_MAX_JSON_BYTES) throw new Error('La réponse maisons dépasse le plafond de 64 Mio.');
  return json;
}
export function parseHouseEnvelope<T>(json: string): T {
  if (new TextEncoder().encode(json).byteLength > HOUSE_MAX_JSON_BYTES) throw new Error('Réponse maisons trop volumineuse.');
  const envelope = JSON.parse(json) as Envelope<T>;
  if (!envelope || typeof envelope.ok !== 'boolean') throw new Error('Enveloppe maisons invalide.');
  if (!envelope.ok) throw new Error(`[${envelope.error.code}] ${envelope.error.message}`);
  return envelope.data;
}
export function parseHouseCatalogue(json: string): CatalogueBundle {
  const bundle = parseHouseEnvelope<CatalogueBundle>(json);
  if (bundle.catalogue.schema_version !== HOUSE_SCHEMA || bundle.inventory.schema_version !== '1') throw new Error('Version du catalogue ou de l’inventaire maisons incompatible.');
  if (!Array.isArray(bundle.catalogue.packs) || !Array.isArray(bundle.catalogue.recipes) || !Array.isArray(bundle.inventory.entries)) throw new Error('Catalogue maisons incomplet.');
  if (bundle.catalogue.workshop_presets !== undefined && !Array.isArray(bundle.catalogue.workshop_presets)) throw new Error('Presets d’atelier invalides.');
  return bundle;
}

export { wellFormedSeed, encodeHouseReplay, decodeHouseReplay, type HouseView } from './housesReplay';
