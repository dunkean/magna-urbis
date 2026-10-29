import { encodeCompact, decodeCompact } from './recipeCodec';
import defaults from './recipeDefaults.json';
import type { DecorMeta } from './decor';

export const RECIPE_STAGES = ['terrain', 'settlements', 'urban', 'houses', 'city'] as const;
export type RecipeStage = typeof RECIPE_STAGES[number];
export interface RecipeTerrain {
  query: string;
  crops: { x: number; y: number; width: number }[];
  meta: Omit<DecorMeta, 'waterSvg' | 'waterMaterialSvg' | 'waterMaterial' | 'regeneration'>;
}
export interface MapRecipe { stage: RecipeStage; query: string; decor?: Uint8Array; terrain?: RecipeTerrain }

// Frozen with MU2: changing the schema requires a new format prefix.
const schema = { stage: 0, query: defaults.query, city: defaults.cityQuery,
  terrain: { query: defaults.query, crops: [], meta: { query: defaults.query } } };
function base64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function packQuery(query: string): unknown {
  const params = new URLSearchParams(query);
  if (new Set(params.keys()).size !== [...params].length) return [...params];
  return Object.fromEntries([...params].map(([k, v]) => {
    if (k === 'workshop' || k === 'case') {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))));
        if (base64Json(parsed) === v) return [k, { __base64json: parsed }];
      } catch { /* Keep unrecognized cases verbatim. */ }
      return [k, v];
    }
    try { const parsed = JSON.parse(v); if (typeof parsed !== 'string' && JSON.stringify(parsed) === v) return [k, parsed]; } catch { /* plain text */ }
    return [k, v];
  }));
}
function unpackQuery(packed: unknown): string {
  if (Array.isArray(packed)) {
    if (!packed.every(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'string'))) throw new Error();
    return new URLSearchParams(packed as [string, string][]).toString();
  }
  if (!packed || typeof packed !== 'object') throw new Error();
  return new URLSearchParams(Object.entries(packed).map(([k, v]) => {
    if ((k === 'workshop' || k === 'case') && v && typeof v === 'object' && '__base64json' in v)
      return [k, base64Json(v.__base64json)];
    return [k, typeof v === 'string' ? v : JSON.stringify(v)];
  })).toString();
}

/** Settings only; retained worlds belong in the complete .decor export. */
export function encodeRecipe(recipe: MapRecipe): string {
  if (!RECIPE_STAGES.includes(recipe.stage)) throw new Error('Atelier inconnu.');
  if (recipe.decor) throw new Error('Utilisez l’export complet .decor pour les données calculées.');
  const terrain = recipe.terrain && { ...recipe.terrain, query: packQuery(recipe.terrain.query), meta: { ...recipe.terrain.meta, query: packQuery(recipe.terrain.meta.query) } };
  return encodeCompact({ stage: RECIPE_STAGES.indexOf(recipe.stage),
    [recipe.stage === 'city' ? 'city' : 'query']: packQuery(recipe.query), ...(terrain ? { terrain } : {}) }, schema, 'MU2.');
}
export function decodeRecipe(text: string): MapRecipe {
  const value = decodeCompact(text, schema, 'MU2.') as { stage: number; query?: unknown; city?: unknown; terrain?: Record<string, any> };
  try {
    if (!Number.isInteger(value.stage) || !RECIPE_STAGES[value.stage]) throw new Error();
    let terrain: RecipeTerrain | undefined;
    if (value.terrain) {
      const t = value.terrain;
      if (!Array.isArray(t.crops) || !t.meta || typeof t.meta.id !== 'string') throw new Error();
      for (const c of t.crops) if (!c || ![c.x, c.y, c.width].every(Number.isFinite) || c.width <= 0) throw new Error();
      terrain = { query: unpackQuery(t.query), crops: t.crops, meta: { ...t.meta, query: unpackQuery(t.meta.query) } } as RecipeTerrain;
    }
    const stage = RECIPE_STAGES[value.stage];
    if (stage === 'city' ? value.query !== undefined : value.city !== undefined) throw new Error();
    return { stage, query: unpackQuery(stage === 'city' ? value.city : value.query), ...(terrain ? { terrain } : {}) };
  } catch { throw new Error('Code incomplet, corrompu ou trop volumineux.'); }
}
