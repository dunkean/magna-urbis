/** Display body (world-coordinate SVG) of the resource diagnostics: payload decoding, block raster, markers. */
import type { World } from '../gen/types';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { isResourceDiagnostic } from '../render/displayDiagnostics';
import { decodeResources, type ResourceGrid, type ResourcePayload } from '../../../rust/bridge/resources';
import { depositsSvg, gridImageSvg, resourcePixels, sitesSvg } from '../render/resourceOverlay';
import { activitySitesOf } from './activitySites';

/** Fetches the payload of a world's terrain (StudioClient.resources); undefined without a Rust region. */
export type ResourceSource = (world: World) => Promise<ResourcePayload | undefined>;
const grids = new WeakMap<ResourcePayload, ResourceGrid>(), rasters = new WeakMap<ResourceGrid, Map<string, string>>();
const gridOf = (payload: ResourcePayload): ResourceGrid => { let g = grids.get(payload); if (!g) grids.set(payload, g = decodeResources(payload)); return g; };

function rasterUrl(grid: ResourceGrid, id: Parameters<typeof resourcePixels>[1], potential: string): string {
  const cache = rasters.get(grid) ?? new Map<string, string>(); rasters.set(grid, cache);
  const key = `${id}:${potential}`, hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas'); canvas.width = grid.nx; canvas.height = grid.ny;
  const pixels = resourcePixels(grid, id, potential);
  canvas.getContext('2d')!.putImageData(new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, grid.nx, grid.ny), 0, 0);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url); return url;
}

/** SVG body of the selected resource diagnostic ('' for any other); `error` when its data is unavailable. */
export async function resourceOverlayBody(world: World, r: ResolvedAppearance, source?: ResourceSource): Promise<{ svg: string; error?: string }> {
  const id = r.diagnostic;
  if (!isResourceDiagnostic(id)) return { svg: '' };
  const unit = world.mapSize / 350;
  if (id === 'res-sites') {
    const parents = new Map((world.settlements ?? []).map(s => [s.key, s.center] as const));
    return { svg: sitesSvg(activitySitesOf(world), parents, unit) };
  }
  let payload: ResourcePayload | undefined;
  try { payload = await source?.(world); } catch (error) { return { svg: '', error: String(error) }; }
  if (!payload) return { svg: '', error: 'No resource data: the Rust engine and a placed region are required.' };
  const grid = gridOf(payload);
  if (id === 'res-deposits') return { svg: depositsSvg(grid, unit) };
  return { svg: gridImageSvg(grid, rasterUrl(grid, id, r.resourcePotential), id !== 'res-geology' && id !== 'res-drainage') };
}
