/**
 * Render passes of the composite V2 renderer: what each reads, owns and when it re-runs.
 * Keys are pure (resolved appearance + scene revisions + export layers); BenchRenderer runs a pass only when its key moved.
 */
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { ExportLayers } from '../../render/exportLayers';
import type { SceneRevisions } from '../renderScene';
import { isResourceDiagnostic } from '../../render/displayDiagnostics';

export type PassName = 'terrainData' | 'terrainLook' | 'forest' | 'water' | 'frame' | 'cartography' | 'overlays' | 'city';
/** Dependency order: each pass may read the outcome of the previous ones (the GPU/CPU mode, the uploaded terrain). */
export const PASS_ORDER: readonly PassName[] = ['terrainData', 'terrainLook', 'forest', 'water', 'frame', 'cartography', 'overlays', 'city'];
export interface PassSpec { readonly inputs: readonly string[]; readonly owns: readonly string[]; readonly invalidation: string }
/** Declarative contract of every pass (documentation checked by the unit test against passKeys). */
export const PASSES: Readonly<Record<PassName, PassSpec>> = {
  terrainData: { inputs: ['revisions.terrain', 'layers.terrain', 'mode'], owns: ['GPU height/cave/water-surface textures'], invalidation: 'new terrain product' },
  terrainLook: { inputs: ['keys.terrainLook', 'effective terrain settings', 'layers.terrain|decor|background', 'cpu: keys.terrainBase+forest+water'], owns: ['GPU look uniforms', 'cpu: terrain raster + background SVG'], invalidation: 'season, lighting, palette, contours, layers; never a GPU upload' },
  forest: { inputs: ['keys.forest', 'revisions.terrain', 'effective forest settings'], owns: ['GPU forest field'], invalidation: 'forest settings, terrain' },
  water: { inputs: ['keys.water', 'revisions.terrain', 'layers.water', 'mode'], owns: ['GPU water/overlay textures', 'water vector SVG'], invalidation: 'water colours, lakes, oxbows, diagnostic overlay (resource diagnostics also read revisions.settlements and the lazily fetched payload)' },
  frame: { inputs: ['ground style + palette', 'layers.decor'], owns: ['frame vector SVG'], invalidation: 'frame toggle, palette' },
  cartography: { inputs: ['keys.cartography', 'revisions.roads|landuse|settlements|names|terrain', 'layers.roads|landuse|city|labels|decor'], owns: ['CanvasRenderer (Path2D caches)', 'export overlay raster'], invalidation: 'palette, roads, land use, painted, vegetation, world products' },
  overlays: { inputs: ['keys.overlays', 'layers.labels|decor'], owns: [], invalidation: 'labels, legend, cartouche: toggles on the cartography renderer' },
  city: { inputs: ['keys.city', 'revisions.cities|settlements|terrain'], owns: ['NativeCityMap (plans, houses LOD)'], invalidation: 'city products; appearance is read per frame' },
};

export interface PassInput {
  r: ResolvedAppearance; revisions: SceneRevisions; layers: Partial<ExportLayers>; mode: 'gpu' | 'cpu';
  /** Terrain settings read by the look and the forest (climate, relief, refine, forest...). */
  effective: string; forestEffective: string;
  /** mapSize, seed, biome: read by the overlay renderer outside the products. */
  worldSig: string;
}
const j = (...parts: unknown[]): string => JSON.stringify(parts);
const rel = (i: PassInput): boolean => i.layers.terrain !== false && i.r.ground.layers.relief;
/** One cache key per pass. A pass re-runs exactly when its key changes. */
export function passKeys(i: PassInput): Record<PassName, string> {
  const { r, revisions: v, layers: l, mode } = i, k = r.keys;
  const cartLayers = j(l.roads, l.landuse, l.city, l.streets, l.labels, l.decor, l.background, l.terrain, l.water, l.decor);
  return {
    terrainData: j(v.terrain, rel(i), mode),
    terrainLook: j(k.terrainLook, i.effective, mode, rel(i), l.decor, l.background, v.terrain, ...(mode === 'cpu' ? [k.terrainBase, k.forest, k.water, l.water, i.forestEffective] : [])),
    forest: mode === 'cpu' ? 'in-terrain' : j(k.forest, v.terrain, i.forestEffective, rel(i)),
    water: j(k.water, v.terrain, l.water, mode, rel(i), isResourceDiagnostic(r.diagnostic) ? v.settlements : null),
    frame: j(r.ground.style, r.palette.colors, rel(i), r.ground.layers.frame, l.decor),
    cartography: j(k.cartography, v.roads, v.landuse, v.settlements, v.names, v.terrain, i.worldSig, cartLayers),
    overlays: j(k.overlays, l.labels, l.decor),
    city: j(k.city, JSON.stringify(v.cities), v.settlements, v.terrain),
  };
}

/** Last key of every pass; `plan` returns the passes to run now, in order. */
export class PassState {
  private keys: Partial<Record<PassName, string>> = {};
  /** Run the passes whose key moved; a failed pass keeps its previous key (it runs again next time). */
  async run(next: () => Record<PassName, string>, runners: Record<PassName, () => Promise<void> | void>, only?: readonly PassName[]): Promise<PassName[]> {
    const ran: PassName[] = [];
    for (const name of only ?? PASS_ORDER) {
      const key = next()[name];   // lazy: an earlier pass may have changed the GPU/CPU mode
      if (this.keys[name] === key) continue;
      await runners[name](); this.keys[name] = key; ran.push(name);
    }
    return ran;
  }
  reset(...names: PassName[]): void { if (!names.length) this.keys = {}; else for (const name of names) delete this.keys[name]; }
}

/** Small keyed cache of heavy derived resources, shared between the live renderer and its exports. */
export class ResourceCache {
  private entries = new Map<string, { value: unknown; dispose?: () => void }>();
  constructor(private limit = 6) {}
  get<T>(key: string, make: () => T, dispose?: (value: T) => void): T {
    const hit = this.entries.get(key);
    if (hit) { this.entries.delete(key); this.entries.set(key, hit); return hit.value as T; }
    const value = make();
    this.entries.set(key, { value, dispose: dispose && (() => dispose(value)) });
    while (this.entries.size > this.limit) { const [oldest, entry] = this.entries.entries().next().value!; this.entries.delete(oldest); entry.dispose?.(); }
    return value;
  }
  delete(key: string): void { this.entries.delete(key); }
  clear(): void { for (const entry of this.entries.values()) entry.dispose?.(); this.entries.clear(); }
}
