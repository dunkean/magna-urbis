import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { parseTerrainSketch, type TerrainSketch } from '../../../rust/bridge/terrainSketch';
import { parseTerrainZones, type TerrainZones } from '../../../rust/bridge/terrainZones';

const encodedZones = new WeakMap<TerrainZones, string>();
export function encodeZones(z: TerrainZones): string {
  const cached = encodedZones.get(z); if (cached) return cached;
  const raw = new Uint8Array(z.weights.length + 2); new DataView(raw.buffer).setUint16(0, z.resolution, true); raw.set(z.weights, 2);
  const bytes = deflateSync(raw); let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const result = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (Object.isFrozen(z) && Object.isFrozen(z.weights)) encodedZones.set(z, result);
  return result;
}
export function decodeZones(raw: string | null): TerrainZones | undefined {
  if (!raw) return;
  if (raw.length > 120000) throw new Error('Masques du lien trop volumineux.');
  const data = inflateSync(Uint8Array.from(atob(raw.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)), { out: new Uint8Array(128 ** 2 * 5 + 3) });
  const n = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, true);
  const z = parseTerrainZones({ version: 1, resolution: n, weights: Array.from(data.subarray(2)) });
  Object.freeze(z.weights); Object.freeze(z); return z;
}

const encoded = new WeakMap<TerrainSketch, string>();
export const INLINE_SKETCH_LIMIT = 100000;
let inputDatabase: Promise<IDBDatabase> | undefined;
function sketchDatabase(): Promise<IDBDatabase> {
  return inputDatabase ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('magna-terrain-inputs', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('inputs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Stockage de la heightmap indisponible. Exportez son JSON pour la conserver.'));
  });
}
export async function storeSketch(s: TerrainSketch): Promise<string> {
  const value = encodeSketch(s), bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const database = await sketchDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('inputs', 'readwrite'); tx.objectStore('inputs').put(value, id);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('Échec de sauvegarde de la heightmap.'));
  });
  return id;
}
export async function readStoredSketch(id: string): Promise<TerrainSketch> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Référence de heightmap invalide.');
  const database = await sketchDatabase();
  const value = await new Promise<string | undefined>((resolve, reject) => {
    const request = database.transaction('inputs', 'readonly').objectStore('inputs').get(id);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (!value) throw new Error('Heightmap absente de ce navigateur. Importez le JSON, le PNG ou le fichier .decor partagé.');
  return decodeSketch(value)!;
}

/** Heightmaps live in the fragment: never send megabytes of elevations as an HTTP request line. */
export function sketchQuery(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search), fragment = new URLSearchParams(url.hash.slice(1));
  for (const key of ['sketch', 'zones']) { const value = fragment.get(key); if (value) params.set(key, value); }
  return params;
}
export function placeSketchInFragment(url: URL): URL {
  const fragment = new URLSearchParams();
  for (const key of ['sketch', 'zones']) { const value = url.searchParams.get(key); if (value) { url.searchParams.delete(key); fragment.set(key, value); } }
  if (fragment.size) url.hash = fragment.toString();
  return url;
}

export function encodeSketch(s: TerrainSketch): string {
  const immutable = Object.isFrozen(s) && Object.isFrozen(s.heights);
  const cached = immutable ? encoded.get(s) : undefined;
  if (cached) return cached;
  if (s.processing) {
    const raw = new Uint8Array(3 + s.heights.length * 4), view = new DataView(raw.buffer);
    raw[0] = s.processing === 'surface' ? 1 : 2; view.setUint16(1, s.resolution, true);
    s.heights.forEach((h, i) => view.setFloat32(3 + i * 4, h, true));
    const bytes = deflateSync(raw);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const result = 'h1.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    if (immutable) encoded.set(s, result);
    return result;
  }
  const json = JSON.stringify({ ...s, heights: s.heights.map(h => Math.round(h * 100) / 100) });
  const bytes = deflateSync(strToU8(json));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const result = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (immutable) encoded.set(s, result);
  return result;
}
export function decodeSketch(raw: string | null): TerrainSketch | undefined {
  if (!raw) return;
  if (raw.startsWith('h1.')) {
    if (raw.length > 6000000) throw new Error('Heightmap trop volumineuse.');
    const bytes = Uint8Array.from(atob(raw.slice(3).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const data = inflateSync(bytes, { out: new Uint8Array(3 + 1024 ** 2 * 4 + 1) });
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength), n = view.getUint16(1, true);
    if (![1, 2].includes(data[0]) || n < 8 || n > 1024 || data.length !== 3 + n * n * 4) throw new Error('Heightmap du lien invalide.');
    const s = parseTerrainSketch({ version: 1, resolution: n, processing: data[0] === 1 ? 'surface' : 'erosion', heights: Array.from({ length: n * n }, (_, i) => view.getFloat32(3 + i * 4, true)) });
    Object.freeze(s.heights); Object.freeze(s); return s;
  }
  if (raw.length > 300000) throw new Error('Lien d’esquisse trop volumineux.');
  const data = Uint8Array.from(atob(raw.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const json = inflateSync(data, { out: new Uint8Array(1000001) });
  if (json.length > 1000000) throw new Error('Lien d’esquisse trop volumineux.');
  const s = parseTerrainSketch(JSON.parse(strFromU8(json)));
  Object.freeze(s.heights); Object.freeze(s);
  return s;
}

