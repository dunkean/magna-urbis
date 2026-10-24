import type { PlacementRequest } from '../../../rust/bridge/urbanArchitecture';
import type { Point, Surface } from '../../../rust/bridge/housesContract';
import { copyBuildingSiteQuery, readUrbanBuildingSite, type UrbanBuildingSiteQuery } from '../../../rust/bridge/urbanBuildingSite';
import type { ExecutionRuntime } from './executionProfile';

/** Exactly what the original city preview needs, not the native admission input.
 * Surface holes/coordinates are retained without rounding or fitting. */
export interface UrbanSiteVisual {
  id: string; parcel_id: string; offset: number; function: PlacementRequest['function']; culture: PlacementRequest['culture'];
  programme?: PlacementRequest['programme']; surface: Surface; preview: boolean;
  ground_z_m: number; entrance: Point; access_id: string;
}
export function projectUrbanSite(request: PlacementRequest & { preview?: Surface | null }, offset: number): UrbanSiteVisual {
  const preview = Boolean(request.preview?.length);
  const surface = preview ? request.preview! : request.function !== 'open_space' && request.placement_hint?.length ? request.placement_hint : request.buildable;
  const access = request.accesses[0];
  return { id: request.id, parcel_id: request.parcel_id, offset, function: request.function, culture: request.culture,
    ...(request.programme ? { programme: request.programme } : {}), surface, preview, ground_z_m: request.terrain.ground_z_m,
    entrance: access ? { x: (access.segment[0].x + access.segment[1].x) / 2, y: (access.segment[0].y + access.segment[1].y) / 2 }
      : surface[0]?.outer[0] ?? { x: 0, y: 0 }, access_id: access?.id ?? '' };
}
export const SITE_CACHE_ENTRIES = 16, SITE_CACHE_BYTES = 8 * 1024 * 1024;
const runtimeKey = (runtime: ExecutionRuntime) => `${runtime.profile}:${runtime.server.replace(/\/+$/, '')}`;
export interface UrbanSiteStore {
  /** Stable identity used by comparison. Never store native handles in snapshots. */
  readonly visuals: UrbanSiteVisual[];
  has(id: string): boolean;
  matchesRuntime(runtime: ExecutionRuntime): boolean;
  read(id: string): Promise<PlacementRequest>;
  dispose(): void;
  readonly stats: { cached: number; bytes: number; inFlight: number; disposed: boolean };
}
type StoreOptions = { maxEntries?: number; maxBytes?: number;
  originLookup?(id: string): Promise<{ offset: number; parcelId: string } | undefined>;
  read?(query: UrbanBuildingSiteQuery, runtime: ExecutionRuntime, offset: number, id: string, total: number): Promise<PlacementRequest> };
/** One committed scene's sites; callers keep this store on rollback and dispose
 * it only on replacement/invalidation. No request is retained for drawing. */
export function createNativeSiteStore(visuals: UrbanSiteVisual[], descriptor: UrbanBuildingSiteQuery,
  execution: ExecutionRuntime, options: StoreOptions = {}): UrbanSiteStore {
  const query = copyBuildingSiteQuery(descriptor), runtime = { ...execution }, key = runtimeKey(runtime);
  const maxEntries = options.maxEntries ?? SITE_CACHE_ENTRIES, maxBytes = options.maxBytes ?? SITE_CACHE_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid site cache budget.');
  const byId = new Map<string, UrbanSiteVisual>(), cache = new Map<string, { request: PlacementRequest; bytes: number }>();
  const inFlight = new Map<string, Promise<PlacementRequest>>();
  let disposed = false, bytes = 0;
  visuals.forEach((site, offset) => {
    if (site.offset !== offset || !site.id || byId.has(site.id)) throw new Error('Invalid retained site projection order.');
    byId.set(site.id, site);
  });
  const check = () => { if (disposed) throw new Error('Site d’implantation remplacé ou périmé.'); };
  return { visuals, has: id => !disposed && byId.has(id), matchesRuntime: current => !disposed && runtimeKey(current) === key,
    async read(id) {
      check(); const site = byId.get(id); if (!site) throw new Error('Site d’implantation absent.');
      const hit = cache.get(id);
      if (hit) { cache.delete(id); cache.set(id, hit); return hit.request; }
      const pending = inFlight.get(id); if (pending) return pending;
      // Editing is user-driven; cap dispatched reads as well as retained bytes.
      if (inFlight.size >= 2) throw new Error('Deux lectures de sites sont déjà en cours.');
      const work = Promise.resolve().then(async () => {
        check();
        // Only this live worker query is a constraint capability. A derivative
        // lookup can confirm its offset, never manufacture a restored query.
        let origin: { offset: number; parcelId: string } | undefined;
        if (options.originLookup) {
          try { origin = await options.originLookup(id); } catch { /* Disposable cache miss: retain the already-live original site. */ }
        }
        if (origin && (origin.offset !== site.offset || origin.parcelId !== site.parcel_id)) throw new Error('Derived site offset differs from the live original site.');
        check();
        const request = await (options.read ?? readUrbanBuildingSite)(query, runtime, origin?.offset ?? site.offset, id, visuals.length);
        check();
        if (request.id !== id || request.parcel_id !== site.parcel_id) throw new Error('Retained building-site identity changed.');
        const cost = new TextEncoder().encode(JSON.stringify(request)).byteLength;
        if (maxEntries && cost <= maxBytes) {
          while (cache.size >= maxEntries || bytes + cost > maxBytes) {
            const oldest = cache.keys().next().value!; bytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
          }
          cache.set(id, { request, bytes: cost }); bytes += cost;
        }
        return request;
      }).finally(() => inFlight.delete(id));
      inFlight.set(id, work); return work;
    },
    dispose() { disposed = true; cache.clear(); bytes = 0; byId.clear(); },
    get stats() { return { cached: cache.size, bytes, inFlight: inFlight.size, disposed }; },
  };
}

/** Restored projected metadata is display-only until an actual CURRENT native
 * query is bound. URL/revision values recovered from storage cannot do that. */
export function createUnboundSiteStore(visuals: UrbanSiteVisual[]): UrbanSiteStore {
  let disposed = false; const ids = new Set(visuals.map(site => site.id));
  return { visuals, has: id => !disposed && ids.has(id), matchesRuntime: () => false,
    async read() { throw new Error('Origine native actuelle non liée : les surfaces projetées ne sont pas des contraintes d’édition.'); },
    dispose() { disposed = true; ids.clear(); }, get stats() { return { cached: 0, bytes: 0, inFlight: 0, disposed }; } };
}
export function translateSiteVisuals(visuals: UrbanSiteVisual[], dx: number, dy: number): UrbanSiteVisual[] {
  if (!dx && !dy) return visuals;
  const point = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return visuals.map(site => ({ ...site, entrance: point(site.entrance),
    surface: site.surface.map(shape => ({ outer: shape.outer.map(point), holes: shape.holes.map(ring => ring.map(point)) })) }));
}
/** Compatibility path for old servers/WASM. These already delivered full sites. */
export function createLegacySiteStore(requests: PlacementRequest[]): UrbanSiteStore {
  const byId = new Map(requests.map(request => [request.id, request]));
  const visuals = requests.map(projectUrbanSite); let disposed = false;
  return { visuals, has: id => !disposed && byId.has(id), matchesRuntime: () => !disposed,
    async read(id) { const request = !disposed && byId.get(id); if (!request) throw new Error('Site d’implantation absent ou remplacé.'); return request; },
    dispose() { disposed = true; byId.clear(); }, get stats() { return { cached: byId.size, bytes: 0, inFlight: 0, disposed }; } };
}
