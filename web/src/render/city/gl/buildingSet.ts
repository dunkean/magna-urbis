import { snowLevelsOf } from '../model/buildings';
import type { CityBuildings, CityScene } from '../model/contract';

/** Towns keep their own spatial bins and roof-owner indices. The live uploader joins only the cells it needs. */
export interface BuildingTown {
  set: CityBuildings;
  itemOffset: number;
  faceOffset: number;
  parcelOffset: number;
}
export interface BuildingGroup {
  towns: BuildingTown[];
  roofs: boolean;
  first: CityBuildings['items'][number] | undefined;
}
export type BuildingSet = CityBuildings | BuildingGroup;
export function buildingTowns(set: BuildingSet): BuildingTown[] {
  return 'towns' in set ? set.towns : [{ set, itemOffset: 0, faceOffset: 0, parcelOffset: 0 }];
}
export function hasRoofs(set: BuildingSet | undefined) {
  return !!set?.roofs;
}
export const buildingTiers = new WeakMap<CityBuildings, string>();
export function sameBuildingTier(before: BuildingSet | undefined, next: BuildingSet): boolean {
  if (!before || hasRoofs(before) !== hasRoofs(next)) return false;
  const a = buildingTowns(before),
    b = buildingTowns(next);
  return a.length === b.length && a.every((x, i) => x.set === b[i].set || (hasRoofs(x.set) === hasRoofs(b[i].set) && buildingTiers.get(x.set) === buildingTiers.get(b[i].set) && snowLevelsOf.get(x.set.items) === snowLevelsOf.get(b[i].set.items)));
}
export function firstBuilding(set: BuildingSet | undefined) {
  return set && ('towns' in set ? set.first : set.items[0]);
}
export function buildingById(set: BuildingSet | undefined, id: string) {
  if (set)
    for (const town of buildingTowns(set)) {
      const i = town.set.byId.get(id);
      if (i !== undefined) return town.set.items[i];
    }
}
export function groupBuildings(parts: readonly { plan: CityScene; buildings?: CityBuildings }[]): BuildingSet {
  let itemOffset = 0,
    faceOffset = 0,
    parcelOffset = 0;
  const towns: BuildingTown[] = [];
  for (const part of parts) {
    const set = part.buildings;
    if (set?.items.length) {
      towns.push({ set, itemOffset, faceOffset, parcelOffset });
      itemOffset += set.items.length;
      faceOffset += set.roofs?.shapes.length ?? 0;
    }
    parcelOffset += part.plan.parcels.length;
  }
  if (towns.length === 1 && !towns[0].parcelOffset) return towns[0].set;
  return { towns, first: towns[0]?.set.items[0], roofs: towns.some(t => !!t.set.roofs) };
}
