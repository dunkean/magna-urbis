import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { parseTerrainSketch, type TerrainSketch } from '../../../rust/bridge/terrainSketch';

const encoded = new WeakMap<TerrainSketch, string>();

export function encodeSketch(s: TerrainSketch): string {
  const immutable = Object.isFrozen(s) && Object.isFrozen(s.heights);
  const cached = immutable ? encoded.get(s) : undefined;
  if (cached) return cached;
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
  if (raw.length > 300000) throw new Error('Lien d’esquisse trop volumineux.');
  const data = Uint8Array.from(atob(raw.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const json = inflateSync(data, { out: new Uint8Array(1000001) });
  if (json.length > 1000000) throw new Error('Lien d’esquisse trop volumineux.');
  const s = parseTerrainSketch(JSON.parse(strFromU8(json)));
  Object.freeze(s.heights); Object.freeze(s);
  return s;
}

