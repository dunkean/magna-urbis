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

export function wellFormedSeed(seed: string): boolean {
  for (let index = 0; index < seed.length; index++) {
    const code = seed.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = seed.charCodeAt(++index);
      if (!(following >= 0xdc00 && following <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export interface HouseView { mode: 'roof' | 'plan'; level: number; graph: boolean; dimensions: boolean }
export function encodeHouseReplay(config: HouseConfig, view: HouseView, generator: string): string {
  if (!wellFormedSeed(config.seed)) throw new Error('La graine contient une séquence Unicode invalide.');
  const bytes = new TextEncoder().encode(JSON.stringify({version: 1, generator_version: generator, config, view}));
  if (bytes.length > 12000) throw new Error('Configuration trop longue pour un lien rejouable.');
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeHouseReplay(encoded: string): {config: HouseConfig; view: HouseView; generator_version: string} {
  if (encoded.length > 16000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Lien maisons invalide ou trop long.');
  const raw = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const replay = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(raw, char => char.charCodeAt(0))));
  if (replay.version !== 1 || replay.config?.schema_version !== HOUSE_SCHEMA || typeof replay.config?.seed !== 'string' || !wellFormedSeed(replay.config.seed)) throw new Error('Version ou graine du lien maisons incompatible.');
  if (typeof replay.generator_version !== 'string' || replay.generator_version.length > 100) throw new Error('Version du générateur absente ou invalide dans le lien.');
  if (!['roof', 'plan'].includes(replay.view?.mode) || !Number.isInteger(replay.view?.level) || replay.view.level < 0 || replay.view.level > 11 || typeof replay.view?.graph !== 'boolean' || typeof replay.view?.dimensions !== 'boolean') throw new Error('Options de vue du lien maisons invalides.');
  return replay;
}
