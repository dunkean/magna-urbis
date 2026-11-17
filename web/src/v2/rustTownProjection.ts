// Display projection of a retained native town (the urban layer the V2 renderers read), shared by the engine worker
// (rustUrban.ts) and the page, which rebuilds it from the transferred town packs (urbanPack.ts) instead of receiving a clone.
import type { UrbanLayer, UrbanBuilding, UrbanZone, StreetRole } from '../gen/types';
import type { RustTownSnapshot } from './rustUrban';
import { harbourPlatform } from '../render/harbourStyle';

/** The last projection of each snapshot (urban layer, population, culture): a worker/page hop sends the urban layers that
 * share its arrays (naming copies included) without those arrays, and the receiver projects them again (urbanPack.ts). */
const projections = new WeakMap<RustTownSnapshot, { urban: UrbanLayer; population: number; culture: string }>();
export const lastProjection = (snapshot: RustTownSnapshot): { urban: UrbanLayer; population: number; culture: string } | undefined => projections.get(snapshot);
const zones = new Set<UrbanZone>(['core', 'middle', 'edge', 'faubourg', 'village']);
const zone = (value?: string): UrbanZone => zones.has(value as UrbanZone) ? value as UrbanZone : 'core';
const roles = new Set<StreetRole>(['radial', 'ring', 'street', 'lane', 'close', 'quay', 'wall-lane', 'track', 'boundary']);
const nativeRequestIndexes = new WeakMap<object, Map<string, string>>();
function requestIndex(requests?: readonly { id: string; parcel_id: string }[]): ReadonlyMap<string, string> {
  if (!requests) return new Map();
  let index = nativeRequestIndexes.get(requests);
  if (!index) {
    index = new Map(); for (const request of requests) if (!index.has(request.parcel_id)) index.set(request.parcel_id, request.id);
    nativeRequestIndexes.set(requests, index);
  }
  return index;
}

/** A display projection of retained native geometry. The complete Rust snapshots remain available for inspection. */
export function projectRustTown(snapshot: RustTownSnapshot, population: number, culture: string): UrbanLayer {
  const urban = projectTown(snapshot, population, culture);
  projections.set(snapshot, { urban, population, culture });
  return urban;
}
function projectTown(snapshot: RustTownSnapshot, population: number, culture: string): UrbanLayer {
  const layout = snapshot.layouts[0];
  if (!layout) throw new Error('Le moteur Rust a renvoyé un plan urbain vide.');
  const partition = snapshot.partitions?.[0];
  const footprintH = layout.structure?.allocated.length ? layout.structure.allocated : layout.quarters.map(q => q.shape);
  const buildings: UrbanBuilding[] = [], ids: string[] = [];
  // Preserve Array.find's first-match rule while avoiding a complete request
  // scan for every projected building/component of a large city.
  const requestByParcel = snapshot.scene?.buildings.length ? requestIndex(snapshot.sites ?? snapshot.requests) : new Map<string, string>();
  for (const building of snapshot.scene?.buildings ?? []) {
    const volumes = building.volumes, height = Math.max(0, ...volumes.map(v => v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m));
    const massing = (building as typeof building & { programme?: { massing?: {roof:string;eave_m:number;rise_m:number;floors:number;wall:string}[] } }).programme?.massing;
    for (const [pieceIndex,piece] of building.footprint.entries()) {
      const body=massing?.[pieceIndex];
      const nativeRoof = (volumes[0]?.roof_system ?? building.cartographic?.roof_system ?? body?.roof ?? '').toUpperCase();
      const roof: UrbanBuilding['roof'] = /FLAT|TERRACE/.test(nativeRoof) ? 'flat' : /DOME/.test(nativeRoof) ? 'dome'
        : /CONE|CONICAL/.test(nativeRoof) ? 'conical' : /HIP/.test(nativeRoof) ? 'hip' : /PYRAMID/.test(nativeRoof) ? 'pyramidal' : /BARREL/.test(nativeRoof) ? 'barrel' : /PAGODA|CURVED/.test(nativeRoof) ? 'pagoda' : 'gable';
      const projection: UrbanBuilding & { nativeId: string; nativeParcelId: string; nativeRequestId: string } = {
        // Native footprint holes already encode courts inside this exact component.
        // Adding the separate courtyard surface again would cancel even-odd holes in the V1 renderer.
        poly: piece.outer, courtyards: piece.holes,
        kind: building.function, height: height || building.cartographic?.height_m || (body ? body.eave_m+body.rise_m : undefined), arch: building.recipe_id, roof,
        storeys: body?.floors ?? Math.max(1, ...volumes.map(v => v.levels.length)), material: volumes[0]?.materials.infill ?? body?.wall,
        orientation: building.transform.orientation_deg * Math.PI / 180,
        nativeId: building.id, nativeParcelId: building.parcel_id,
        nativeRequestId: requestByParcel.get(building.parcel_id) ?? building.id,
      };
      buildings.push(projection); ids.push(building.id);
    }
  }
  snapshot.buildingIds = ids;
  const walls: UrbanLayer['walls'] = (layout.enclosures ?? []).map(wall => ({ path: wall.path, closed: true,
    towers: wall.towers ?? [], gates: wall.gates, thickness: wall.curtain_width_m ?? 2,
    towerShape: wall.towers_detail?.[0]?.shape === 'round' ? 'round' : 'square', role: wall.purpose ? 'castle' : 'town' }));
  const parcels = partition?.parcels ?? [];
  return {
    footprintH, footprint: footprintH.map(p => p.outer), population, culture, cultures: [culture],
    archetype: population < 200 ? 'hamlet' : population < 1200 ? 'nucleated-village' : 'town', morphology: `rust:${layout.structure?.family ?? layout.culture}`,
    blocks: layout.blocks.map(b => b.shape.outer),
    blockInfo: layout.blocks.map(b => ({ quarter: b.quarter, phase: b.phase ?? 0, zone: zone(b.zone),
      kind: b.kind === 'place' || b.kind === 'market' || b.kind === 'church' || b.kind === 'green' || b.kind === 'compound' ? b.kind : 'block', culture })),
    quarters: layout.quarters.map((q, index) => ({ poly: q.shape, phase: q.phase, zone: zone(q.zone), streetSpace: [], nativeId: String(index),culture:layout.config?.overrides?.quarters?.[String(index)]?.culture ?? layout.phases?.[q.phase]?.culture ?? layout.culture ?? culture })),
    phases: (layout.phases ?? []).map((phase, id) => ({ id, kind: phase.kind === 'village' ? 'village' : id === 0 ? 'core' : phase.kind === 'faubourg' ? 'faubourg' : 'ring', zone: zone(phase.zone), region: phase.shapes, walled: false, fossil: false })),
    streets: layout.streets.map(street => ({ path: street.path, width: street.widths.reduce((a, b) => a + b, 0) / Math.max(1, street.widths.length),
      widths: street.widths, rank: street.rank, kind: street.rank < 2 ? 'main' : street.rank < 4 ? 'street' : 'alley',
      role: roles.has(street.role as StreetRole) ? street.role as StreetRole : 'street', phase: 0 })),
    parcels: parcels.map(p => ({ poly: p.shape.outer, use: p.use === 'common' ? 'green' : p.use, block: p.block, front: p.front ?? undefined, nativeId: p.id })),
    buildings, masses: snapshot.scene?.buildings.flatMap(b => b.footprint) ?? [], walls,
    landmarks: [], squares: parcels.filter(p => ['place', 'market', 'court', 'common'].includes(p.use)).map(p => p.shape.outer),
    backLand: [...parcels.filter(p => ['garden', 'common', 'reserve', 'residual', 'court'].includes(p.use)).map(p => p.shape),
      ...(snapshot.scene?.open_spaces.flatMap(space => space.surface) ?? [])],
    ruralReserve: (layout.enclosures ?? []).flatMap(w => w.reserve ?? []),
    // The legacy scene keeps the platforms only; boats and the other harbour furniture are drawn from the layout (harbourStyle.ts).
    quays: layout.structure?.quays?.filter(quay => harbourPlatform(quay.kind)).map(quay => [...quay.shape.outer, quay.shape.outer[0]]),
  };
}
