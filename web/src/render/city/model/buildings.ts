/**
 * Builds the buildings of a town (`CityBuildings`) from its placed buildings: plan links (parcel, role, family),
 * material culture, roof pans with their light, snow share and grain family, cast shadows, mill marks. Called once per
 * town by the pages, or per chunk by the parallel build (cityBuildingsParallel.ts).
 */
import type { Shape } from '../../../../../rust/bridge/urban';
import type { PlacementBatch, PlacedBuilding } from '../../../../../rust/bridge/urbanArchitecture';
import { buildingHeat, roofSnowPatches, roofSnowRidgeMelt, roofSnowShare } from '../../roofSnow';
import { COVER_GRAINS, roofGrain as roofGrainFamily } from '../../buildingMaterials';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { massingFootprint, massingTerraces, planRoof, pieceShadows, pieceVolumes, readMassing, stiltDeck, stiltSupports, roofLight as roofLight3, type ResolvedVolume } from '../../cityMassing';
import { differenceS, unionS } from '../../../gen/geo/bool';
import { ruinFootprint } from '../../cityRuins';
import { roleFamily } from '../look';
import { CityAllocation, CityScene, CityBuilding, CityBuildings, CityRoofShape } from './contract';
import { surfaceBox, SpatialBins } from './geometry';
import { AllocationContract } from './scene';

/** Sails and water wheels of a building's volumes (massing features), with their height above the building ground. */
function millMarks(volumes: readonly ResolvedVolume[] | undefined): CityBuilding['marks'] {
  const marks: NonNullable<CityBuilding['marks']> = [];
  for (const v of volumes ?? [])
    for (const f of v.detail?.features ?? []) {
      if (f.kind === 'sails') marks.push({ kind: 'sails', x: f.x, y: f.y, w: f.w, d: f.d, z: v.eave_m + f.h, angle: f.angle, turn: f.turn ?? 0 });
      else if (f.kind === 'wheel') marks.push({ kind: 'wheel', x: f.x, y: f.y, w: f.w, d: f.d, z: (v.base_m ?? 0) + f.h, angle: f.angle, turn: f.turn ?? 0 });
    }
  return marks.length ? marks : undefined;
}
/** Stable 0..1 value of a building id (one independent stream per salt). */
function idUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 8) & 0xffff) / 0xffff;
}
/** Buildings of a scene, linked to their parcel allocation for roles. `roofs: false` keeps the items (footprints, roles,
 * materials) without the roof pans, snow patches and cast shadows: the far view of a very large town, whose detail is
 * built later for the visible area only (v2/nativeCityMap.ts). */
/** Plan links of a building item (parcel, role, family, landmark): shared by `buildCityBuildings` and the parallel
 * build (cityBuildingsParallel.ts), whose workers have no plan. */
export function cityBuildingLink(building: PlacedBuilding, plan?: CityScene): Pick<CityBuilding, 'parcel' | 'role' | 'family' | 'landmark'> & { allocation?: CityAllocation } {
  const programme = (building as PlacedBuilding & { programme?: AllocationContract }).programme;
  const parcel = plan?.parcelById.get(building.parcel_id),
    allocation = parcel === undefined ? undefined : plan!.parcels[parcel].allocation;
  return { parcel, allocation, role: programme?.role ?? allocation?.role, family: roleFamily(programme?.role ?? allocation?.role, building.function), landmark: programme?.landmark === true || allocation?.landmark === true };
}
/** Material culture of a building: its own, else its parcel's allocation, else its town's. */
export function cityBuildingCulture(building: PlacedBuilding, plan?: CityScene): string {
  const { parcel, allocation } = cityBuildingLink(building, plan);
  return building.culture?.culture || allocation?.culture || (parcel === undefined ? '' : plan?.layouts[plan.parcels[parcel].layout]?.culture) || '';
}
/** Snow line of each item: the mean ground of its town. */
export function citySnowAltitudes(items: CityBuilding[], plan?: CityScene): void {
  const altitudes = new Map<number, { sum: number; count: number }>();
  for (const b of items) {
    const town = b.parcel === undefined ? -1 : (plan?.parcels[b.parcel]?.layout ?? -1);
    const a = altitudes.get(town) ?? { sum: 0, count: 0 };
    a.sum += b.building.ground_z_m || 0;
    a.count++;
    altitudes.set(town, a);
  }
  for (const b of items) {
    const town = b.parcel === undefined ? -1 : (plan?.parcels[b.parcel]?.layout ?? -1),
      a = altitudes.get(town)!;
    b.snowAltitude = a.sum / a.count;
  }
}
/** Spatial bins of the items (same boxes as `buildCityBuildings`). */
export const cityBuildingBins = (items: readonly CityBuilding[]): SpatialBins =>
  new SpatialBins(
    items.map(b => surfaceBox([...b.surface, ...(b.footprint ?? [])])),
    64,
  );
/** `cultures`: the material culture of each building of the batch, given by the caller (a worker chunk has no plan);
 * `rawRoofs`: the roof arrays are returned even when they hold no pan (a chunk's shadows stay aligned with its items). */
export function buildCityBuildings(batch: Pick<PlacementBatch, 'buildings'> | undefined, plan?: CityScene, options: { roofs?: boolean; cultures?: readonly string[]; rawRoofs?: boolean } = {}): CityBuildings {
  const withRoofs = options.roofs !== false;
  const items: CityBuilding[] = [],
    byId = new Map<string, number>();
  const roofShapes: CityRoofShape[] = [],
    roofOwner: number[] = [],
    roofLight: number[] = [],
    roofCover: string[] = [],
    roofWall: string[] = [],
    roofTone: number[] = [],
    roofDir: number[] = [],
    roofFlat: number[] = [],
    roofSnow: number[] = [],
    roofPatch: number[] = [],
    roofGrainOf: number[] = [],
    roofRim: number[] = [],
    roofTint: (string | undefined)[] = [],
    shadows: Shape[][] = [];
  let bi = -1;
  for (const building of batch?.buildings ?? []) {
    bi++;
    let surface = building.roof_footprint.length ? building.roof_footprint : building.footprint;
    if (!surface.length) continue;
    const programme = (building as PlacedBuilding & { programme?: AllocationContract }).programme;
    const link = cityBuildingLink(building, plan),
      parcel = link.parcel;
    const massing = readMassing(programme, building.footprint, building.id);
    const byPiece = massing && building.footprint.map((shape, i) => pieceVolumes(shape, massing[i])),
      volumes = byPiece?.flat(),
      first = volumes?.[0];
    if (volumes) {
      if (volumes.some(v => v.detail?.stilts_m || ['tree', 'mushroom', 'yurt', 'igloo', 'tower'].includes(v.detail?.form ?? '')))
        surface = volumes.flatMap(v =>
          v.detail?.stilts_m
            ? [
                { ...v.shape, outer: stiltDeck(v.shape.outer) },
                ...stiltSupports(v.shape.outer).map(p => ({
                  outer: [
                    { x: p.x - 0.16, y: p.y - 0.16 },
                    { x: p.x + 0.16, y: p.y - 0.16 },
                    { x: p.x + 0.16, y: p.y + 0.16 },
                    { x: p.x - 0.16, y: p.y + 0.16 },
                  ],
                  holes: [],
                })),
              ]
            : [v.shape],
        );
    }
    const culture = options.cultures ? options.cultures[bi] : cityBuildingCulture(building, plan);
    byId.set(building.id, items.length);
    items.push({
      id: building.id,
      surface,
      footprint: massingFootprint(building.footprint, massing),
      fn: building.function,
      role: link.role,
      family: link.family,
      landmark: link.landmark,
      parcel,
      building,
      ruins: ruinFootprint(building.footprint, programme, massing),
      stilts: volumes?.some(v => (v.detail?.stilts_m ?? 0) > 0),
      age: idUnit(building.id, 0x51ed),
      marks: millMarks(volumes),
      material: { culture, wall: first?.wall ?? '', cover: first?.cover ?? '', tone: first?.tone ?? 0.5, tint: first?.tint },
    });
    const terraces = massingTerraces(massing);
    if (terraces) items[items.length - 1].terraces = terraces;
    if (!massing || !withRoofs) {
      shadows.push([]);
      continue;
    }
    const owner = items.length - 1,
      heat = buildingHeat(building.function);
    let terraced = false;
    // Explicit pans come out of `planRoof` unchanged (no polygon boolean). A face of a small decorative volume is one
    // polygon carrying its own snow share (no inset snow patch, no ink edge): a third of the draws of a full face.
    // Every face keeps its own share of the mantle (pitch, cover, exposure, the heat of the building's use: one rule
    // for every roof). Its snow is one inset patch: eaves, hips and ridges stay free of snow, and a heated roof
    // leaves a wider bare strip below the ridge. Only the faces that reach the top of their volume open there: the
    // lower courses of a dome, a cone or a tent keep an even patch (no bare rings), the crown opens like a smoke hole.
    // The corners of each patch move a little (a hash of the building and the face, the same amplitude everywhere),
    // so the bare rim is not ruler-drawn; the patch never reaches the edge of its face.
    const planned = planRoof(building.footprint, massing),
      tops = new Map<number, number>();
    for (const face of planned) {
      const key = face.piece * 4096 + face.vol;
      let top = tops.get(key) ?? -Infinity;
      for (const p of face.points) if (p.z > top) top = p.z;
      tops.set(key, top);
    }
    const snowSeed = Math.round(idUnit(building.id, 0x2b7) * 0xffff);
    for (const face of planned.flatMap((face, fi) => {
      const light = face.light ?? roofLight3(face.normal),
        share = roofSnowShare(face.normal, light, heat, face.cover);
      const top = tops.get(face.piece * 4096 + face.vol)!,
        ridge = face.points.some(p => p.z > top - 0.05) ? roofSnowRidgeMelt(heat, light) : 0.055;
      return face.minor && share ? [{ ...face, snow: share }] : [{ ...face, snow: 0 }, ...(face.snow === 0 ? [] : roofSnowPatches(face.points, face.normal, 0.055, ridge, snowSeed + fi * 131, 0.09).map(p => ({ ...face, points: p.points, snow: share, patch: 1 })))];
    })) {
      if (face.normal[2] < 0.08 || face.points.length < 3) continue; // gable ends and walls are edge-on from above
      if (face.flat) items[owner].flat = true;
      terraced ||= !!face.terrace;
      // Grain family of the pan: by cover, flatness and culture; none on living crowns (tree dwellings) and on small
      // decorative volumes (chimneys, dormers: a few pixels).
      const grain = face.minor || byPiece![face.piece]?.[face.vol]?.tree ? undefined : roofGrainFamily(face.cover, !!face.flat || face.normal[2] > 0.995, culture);
      roofGrainOf.push(grain ? COVER_GRAINS.indexOf(grain) + 1 : 0);
      roofFlat.push(face.terrace ? 2 : face.flat ? 1 : 0);
      roofSnow.push(face.snow ?? 0);
      roofPatch.push('patch' in face ? face.patch : 0);
      roofRim.push(face.rim ? 1 : 0);
      roofTint.push(face.tint);
      const hiddenEdge = 'patch' in face ? undefined : face.hiddenEdge;
      roofShapes.push({ outer: face.points.map(p => ({ x: p.x, y: p.y })), holes: face.holes ?? [], ...(hiddenEdge === undefined ? {} : { hiddenEdge }) });
      roofOwner.push(owner);
      roofLight.push(face.light ?? roofLight3(face.normal));
      roofCover.push(face.cover);
      roofWall.push(face.wall);
      roofTone.push(face.tone);
      roofDir.push(Math.hypot(face.normal[0], face.normal[1]) > 1e-3 ? Math.atan2(face.normal[1], face.normal[0]) : 0);
    }
    const casts = building.footprint.flatMap((shape, i) => (massing[i] ? pieceShadows(shape, massing[i]) : []));
    // Terrace receivers already have their own opaque shade. The ground pass must
    // contain only the exterior SE cast, with no overlapping hulls or courtyard wash.
    shadows.push(
      terraced && casts.length
        ? differenceS(
            unionS(casts[0], ...casts.slice(1)),
            [...building.footprint, ...surface].map(s => ({ outer: s.outer, holes: [] })),
          )
        : casts,
    );
  }
  citySnowAltitudes(items, plan);
  const roofs =
    roofShapes.length || options.rawRoofs
      ? {
          shapes: roofShapes,
          owner: Uint32Array.from(roofOwner),
          light: Float32Array.from(roofLight),
          cover: roofCover,
          wall: roofWall,
          tone: Float32Array.from(roofTone),
          dir: Float32Array.from(roofDir),
          flat: Uint8Array.from(roofFlat),
          snow: Float32Array.from(roofSnow),
          patch: Uint8Array.from(roofPatch),
          grain: Uint8Array.from(roofGrainOf),
          rim: Uint8Array.from(roofRim),
          tint: roofTint,
          shadows,
        }
      : undefined;
  return { items, byId, bins: cityBuildingBins(items), ...(roofs ? { roofs } : {}) };
}
