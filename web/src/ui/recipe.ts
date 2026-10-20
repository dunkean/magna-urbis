import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';
import defaultQuery from './recipeDictionary.json';
import type { DecorMeta } from './decor';

export const RECIPE_STAGES = ['terrain', 'settlements', 'urban', 'houses'] as const;
export type RecipeStage = typeof RECIPE_STAGES[number];
export interface RecipeTerrain {
  query: string;
  crops: { x: number; y: number; width: number }[];
  meta: Omit<DecorMeta, 'waterSvg' | 'waterMaterialSvg' | 'waterMaterial' | 'regeneration'>;
}
export interface MapRecipe { stage: RecipeStage; query: string; decor?: Uint8Array; terrain?: RecipeTerrain }

// Shared vocabulary makes even small recipes compress well. No server or lookup table of maps.
const dictionary = strToU8(JSON.stringify([0, packQuery(new URLSearchParams(defaultQuery).toString())]));
const PREFIX = 'MU.';
const MAX_BYTES = 32 * 1024 * 1024;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length;) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) { a += data[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function packQuery(query: string): unknown[][] {
  const entries = [...new URLSearchParams(query)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return entries.map(([key, value]) => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'string' && JSON.stringify(parsed) === value) return [key, parsed];
    } catch { /* Plain text is already compact. */ }
    return [key, value];
  });
}

function unpackQuery(packed: unknown): string {
  if (!Array.isArray(packed)) throw new Error();
  const params = new URLSearchParams();
  for (const pair of packed) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') throw new Error();
    params.append(pair[0], typeof pair[1] === 'string' ? pair[1] : JSON.stringify(pair[1]));
  }
  return params.toString();
}

/** All query properties, including unknown ones, survive without URL percent-encoding. */
export function encodeRecipe(recipe: MapRecipe): string {
  if (!RECIPE_STAGES.includes(recipe.stage)) throw new Error('Atelier inconnu.');
  const terrain = recipe.terrain && { ...recipe.terrain, query: packQuery(recipe.terrain.query), meta: { ...recipe.terrain.meta, query: packQuery(recipe.terrain.meta.query) } };
  const header = strToU8(JSON.stringify([RECIPE_STAGES.indexOf(recipe.stage), packQuery(recipe.query), ...(terrain ? [terrain] : [])]));
  const length = 4 + header.length + (recipe.decor?.length ?? 0);
  if (length > MAX_BYTES) throw new Error('Recette trop volumineuse (32 Mo maximum).');
  const data = new Uint8Array(length);
  new DataView(data.buffer).setUint32(0, header.length, true);
  data.set(header, 4); if (recipe.decor) data.set(recipe.decor, 4 + header.length);
  return PREFIX + base64(zlibSync(data, { level: 9, dictionary }));
}

/** Whitespace may be added by email/chat wrapping. Reject corruption before changing any state. */
export function decodeRecipe(text: string): MapRecipe {
  const code = text.trim().replace(/\s/g, '');
  if (!code.startsWith(PREFIX) || !/^[A-Za-z0-9_-]+$/.test(code.slice(PREFIX.length))) throw new Error('Code invalide : collez un code MU.…');
  if (code.length > MAX_BYTES * 1.4) throw new Error('Code trop volumineux.');
  try {
    const bytes = Uint8Array.from(atob(code.slice(PREFIX.length).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const data = unzlibSync(bytes, { dictionary, out: new Uint8Array(MAX_BYTES + 1) });
    if (data.length > MAX_BYTES || data.length < 4) throw new Error();
    // fflate's decoder does not verify the zlib checksum itself.
    if (new DataView(bytes.buffer).getUint32(bytes.length - 4) !== adler32(data)) throw new Error();
    const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
    if (length > data.length - 4) throw new Error();
    const header = JSON.parse(strFromU8(data.subarray(4, 4 + length)));
    if (!Array.isArray(header) || ![2, 3].includes(header.length) || !Number.isInteger(header[0]) || !RECIPE_STAGES[header[0]]) throw new Error();
    let terrain: RecipeTerrain | undefined;
    if (header.length === 3) {
      const source = header[2];
      if (!source || !Array.isArray(source.crops) || !source.meta || typeof source.meta.id !== 'string') throw new Error();
      for (const crop of source.crops) if (!crop || ![crop.x, crop.y, crop.width].every(Number.isFinite) || crop.width <= 0) throw new Error();
      terrain = { query: unpackQuery(source.query), crops: source.crops, meta: { ...source.meta, query: unpackQuery(source.meta.query) } };
    }
    const decor = data.slice(4 + length);
    if (terrain && decor.length) throw new Error();
    return { stage: RECIPE_STAGES[header[0]], query: unpackQuery(header[1]), ...(decor.length ? { decor } : {}), ...(terrain ? { terrain } : {}) };
  } catch {
    throw new Error('Code incomplet, corrompu ou trop volumineux.');
  }
}
