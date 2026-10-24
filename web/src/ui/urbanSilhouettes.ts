import type { ArchitectureProgramme, PlacementBatch, PlacedBuilding, PlacementRequest } from '../../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../../rust/bridge/housesContract';
import { projectUrbanSite, type UrbanSiteVisual } from './urbanSiteStore';

/** City-side programme of one lot (stream B contract, optional). */
export type CityProgramme = ArchitectureProgramme;
/** Placement request as emitted by the city: `preview` is the city-side building
 * footprint (stream A contract), `programme` its role. Both are optional and
 * ignored by `houses::PlacementRequest`. */
export type CityPlacementRequest = PlacementRequest & { preview?: Surface | null; programme?: CityProgramme | null };
/** A silhouette keeps the lot programme so the map can colour it by role. */
export type CityBuilding = PlacedBuilding & { programme?: CityProgramme };

const ringArea = (ring: { x: number; y: number }[]): number => Math.abs(ring.reduce((sum, p, i) => { const n = ring[(i + 1) % ring.length]; return sum + p.x * n.y - p.y * n.x; }, 0)) / 2;
const surfaceArea = (surface: Surface): number => surface.reduce((sum, shape) => sum + ringArea(shape.outer) - shape.holes.reduce((h, ring) => h + ringArea(ring), 0), 0);

/** Building silhouettes from the native lot requests, without the house generator:
 * the city preview footprint when Rust provides one, else the oriented admission
 * rectangle, else the buildable land. Open spaces stay open. */
export function silhouetteScene(requests: CityPlacementRequest[]): PlacementBatch {
  return siteVisualScene(requests.map(projectUrbanSite));
}
/** Same native preview, already projected in the worker; no site read or plan generation. */
export function siteVisualScene(sites: UrbanSiteVisual[]): PlacementBatch {
  const buildings: CityBuilding[] = [], open_spaces: PlacementBatch['open_spaces'] = [];
  for (const request of sites) {
    // A lot the house generator could not take (slope, missing source) keeps its
    // city building when the city sent its massing.
    const massed = !!(request.programme as { massing?: unknown } | undefined)?.massing && request.preview;
    if (request.function === 'open_space' && !massed) { open_spaces.push({ id: request.id, parcel_id: request.parcel_id, surface: request.surface }); continue; }
    const footprint = request.surface;
    if (!footprint.length) continue;
    buildings.push({ id: request.id, parcel_id: request.parcel_id, function: request.function, culture: request.culture,
      recipe_id: 'silhouette', variant_id: 'silhouette', transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 }, ground_z_m: request.ground_z_m,
      footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: request.entrance, access_id: request.access_id,
      volumes: [], useful_area_m2: surfaceArea(footprint), domestic_units: request.programme?.households ?? 0, structural_features: [],
      simplification: 'recipe_volumes', diagnostics: [request.preview ? 'silhouette:preview' : 'silhouette'], resolved: null,
      ...(request.programme ? { programme: request.programme } : {}) });
  }
  return { schema_version: '1', generator_version: 'silhouette', buildings, refusals: [], open_spaces };
}

