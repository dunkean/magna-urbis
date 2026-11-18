import type { ArchitectureBatchProgress, ArchitectureRequestSource } from '../../../rust/bridge/architectureBatch';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import { beginUrbanBuildingPages, URBAN_BUILDING_PAGE_BYTES, URBAN_BUILDING_PAGE_LIMIT } from '../../../rust/bridge/urbanBuildingPages';
import { architectureProfile } from '../../../rust/bridge/urbanArchitecture';
import { sceneMode, type UrbanSceneRequest, type UrbanSceneResponse } from './urbanSceneProtocol';
import type { UrbanSceneCompletion } from './urbanSceneProgress';
import { silhouetteScene, type CityPlacementRequest } from './urbanSilhouettes';

export interface SilhouettePageOptions {
  cancelled?(): boolean;
  progress?(completed: number, total: number): void;
  /** One ordered scene chunk; the caller hands it on and keeps no reference. */
  part(delta: PlacementBatch, progress: ArchitectureBatchProgress): void | Promise<void>;
}

/** Silhouettes of a paged native site source, page by page: each page is turned
 * into its silhouettes, handed to `part` in order, then dropped. Appending every
 * part gives exactly `silhouetteScene(allSites)`; no whole-city site list is held. */
export async function streamSilhouetteScene(pages: ArchitectureRequestSource, options: SilhouettePageOptions): Promise<UrbanSceneCompletion> {
  const counts = { schema_version: '1' as const, generator_version: 'silhouette', buildings: 0, refusals: 0, open_spaces: 0 };
  // An empty town still produces one (empty) part, so the receiver holds a scene.
  if (!pages.total) {
    await options.part(silhouetteScene([]), { start: 0, completed: 0, total: 0 });
    return counts;
  }
  for (let offset = 0; offset < pages.total;) {
    if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
    const page = await pages.read(offset, URBAN_BUILDING_PAGE_LIMIT, URBAN_BUILDING_PAGE_BYTES);
    if (options.cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
    if (!page.length) throw new Error('Retained building-site page made no progress.');
    const delta = silhouetteScene(page as CityPlacementRequest[]),
      progress = { start: offset, completed: offset + page.length, total: pages.total };
    counts.buildings += delta.buildings.length;
    counts.open_spaces += delta.open_spaces.length;
    await options.part(delta, progress);
    offset = progress.completed;
    options.progress?.(offset, pages.total);
  }
  return counts;
}

/** City Bench silhouettes of a retained local source, read by native pages
 * (worker and main-thread fallback). False: the engine has no paged site read,
 * so the caller keeps its whole-city read. Once Begin is attempted every error
 * propagates; there is never a whole-city fallback after that point. */
export async function pagedSilhouetteScene(request: UrbanSceneRequest, cancelled: () => boolean, post: (response: UrbanSceneResponse) => void | Promise<void>): Promise<boolean> {
  if (!request.source || request.runtime?.profile !== 'local' || sceneMode(request) !== 'silhouette') return false;
  const start = performance.now();
  const pages = await beginUrbanBuildingPages({ source: request.source, keys: request.keys, seed: request.seed, architectureCulture: architectureProfile(request.settings) }, request.runtime, { cancelled });
  if (!pages) return false;
  const complete = await streamSilhouetteScene(pages, {
    cancelled,
    progress: (completed, total) => {
      void post({ id: request.id, progress: { completed, total } });
    },
    part: (delta, progress) => post({ id: request.id, scenePart: { delta, progress } }),
  });
  if (cancelled()) return true;
  const sites = pages.timing.prepareMs + pages.timing.readMs;
  await post({ id: request.id, complete, timing: { sites, sitesPrepare: pages.timing.prepareMs, sitesRead: pages.timing.readMs, paged: true, placement: Math.max(0, performance.now() - start - sites) } });
  return true;
}
