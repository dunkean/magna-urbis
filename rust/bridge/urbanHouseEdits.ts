import type { HouseConfig } from './housesContract';
import type { LayoutConfig, ParcelConfig } from './urbanConfig';
import type { Layout } from './urban';
import type { HouseMix, PlacementBatch, PlacementRequest, PlacementBatchSettings } from './urbanArchitecture';
import { pointInRing } from '../../web/src/gen/geo/poly';
import { blockEditId } from './urbanBlockEdits';

export type HouseEditConfig = Partial<HouseConfig> & { culture?: string };
export function mergeHouseEdits(...values: (Partial<HouseConfig> | undefined)[]): Partial<HouseConfig> {
  const result: Partial<HouseConfig> = {};
  for (const value of values) if (value) {
    const overrides = value.overrides ? { overrides: { ...result.overrides, ...value.overrides } } : {};
    Object.assign(result, value, overrides);
  }
  return result;
}
/** Geometry is the retained engine's authority, including IDs that contain slashes. */
export function siteQuarter(layouts: readonly Layout[], site: { surface?: PlacementRequest['cadastral']; cadastral?: PlacementRequest['cadastral'] }): string | undefined {
  const ring = (site.surface ?? site.cadastral)?.[0]?.outer;
  if (!ring?.length) return;
  const centre = ring.reduce((p, v) => ({ x: p.x + v.x / ring.length, y: p.y + v.y / ring.length }), { x: 0, y: 0 });
  for (const layout of layouts) {
    const index = layout.quarters.findIndex(q => pointInRing(q.shape.outer, centre) && !q.shape.holes.some(h => pointInRing(h, centre)));
    if (index >= 0) return String(index);
  }
}
export function siteBlock(layouts: readonly Layout[], site: { surface?: PlacementRequest['cadastral']; cadastral?: PlacementRequest['cadastral'] }): string | undefined {
  const ring = (site.surface ?? site.cadastral)?.[0]?.outer;
  if (!ring?.length) return;
  const centre = ring.reduce((p, v) => ({ x: p.x + v.x / ring.length, y: p.y + v.y / ring.length }), { x: 0, y: 0 });
  for (const layout of layouts) {
    const index = layout.blocks.findIndex(b => pointInRing(b.shape.outer, centre) && !b.shape.holes.some(h => pointInRing(h, centre)));
    if (index >= 0) return blockEditId(layout, layout.blocks[index].shape);
  }
}
/** House-only edits do not invalidate the street or cadastral stages. */
export function geometryConfigs(layout: LayoutConfig, parcels: ParcelConfig): { layout: LayoutConfig; parcels: ParcelConfig } {
  const result = { layout: { ...layout, ...(layout.overrides ? { overrides: { ...layout.overrides, quarters: Object.fromEntries(Object.entries(layout.overrides.quarters ?? {}).flatMap(([id, edit]) => {
    const { buildingCulture: _culture, houseConfig: _house, ...geometry } = edit;
    return Object.keys(geometry).length ? [[id, geometry]] : [];
  })) } } : {}) }, parcels: { ...parcels, ...(parcels.overrides ? { overrides: { ...parcels.overrides, parcels: Object.fromEntries(Object.entries(parcels.overrides.parcels ?? {}).flatMap(([id, edit]) => {
    const { culture: _culture, houseConfig: _house, ...geometry } = edit;
    return Object.keys(geometry).length ? [[id, geometry]] : [];
  })) } } : {}) } };
  if (result.parcels.overrides && parcels.overrides?.blocks) result.parcels.overrides.blocks = Object.fromEntries(Object.entries(parcels.overrides.blocks).flatMap(([id, edit]) => {
    const { houseConfig: _house, ...geometry } = edit;
    return Object.keys(geometry).length ? [[id, geometry]] : [];
  }));
  if (result.layout.overrides && !Object.values(result.layout.overrides).some(entries => Object.keys(entries ?? {}).length)) delete result.layout.overrides;
  if (result.parcels.overrides && !Object.values(result.parcels.overrides).some(entries => Object.keys(entries ?? {}).length)) delete result.parcels.overrides;
  return result;
}
export function localArchitectureSettings(settings: PlacementBatchSettings, layout: LayoutConfig, parcels: ParcelConfig, buildings: Record<string, HouseEditConfig>, massing = false): PlacementBatchSettings {
  const single = (culture: string): HouseMix => ({ styles: [{ culture, weight: 1 }], spread: 'lot' });
  const houses = { ...settings.houses, quarters: { ...settings.houses?.quarters }, blocks: { ...settings.houses?.blocks }, parcels: { ...settings.houses?.parcels }, buildings: { ...settings.houses?.buildings }, massing: { ...settings.houses?.massing } };
  for (const [id, edit] of Object.entries(layout.overrides?.quarters ?? {})) {
    const culture = edit.buildingCulture || edit.culture;
    if (culture) houses.quarters[id] = single(culture);
  }
  for (const [id, edit] of Object.entries(parcels.overrides?.blocks ?? {})) if (edit.culture) houses.blocks[id] = single(edit.culture);
  for (const [id, edit] of Object.entries(parcels.overrides?.parcels ?? {})) if (edit.culture) houses.parcels[id] = single(edit.culture);
  for (const [id, edit] of Object.entries(buildings)) if (edit.culture) houses.buildings[id] = single(edit.culture);
  if (massing) {
    for (const [id, edit] of Object.entries(layout.overrides?.quarters ?? {})) if (isMassingEdit(edit.houseConfig)) houses.massing[`q:${id}`] = edit.houseConfig!;
    for (const [id, edit] of Object.entries(parcels.overrides?.blocks ?? {})) if (isMassingEdit(edit.houseConfig)) houses.massing[`block:${id}`] = edit.houseConfig!;
    for (const [id, edit] of Object.entries(parcels.overrides?.parcels ?? {})) if (isMassingEdit(edit.houseConfig)) houses.massing[`p:${id}`] = edit.houseConfig!;
    for (const [id, edit] of Object.entries(buildings)) if (isMassingEdit(edit)) houses.massing[`b:${id}`] = edit;
  }
  return { ...settings, houses };
}
/** Vertical edits of a procedural body retain its native footprint and never invoke Houses placement. */
export function isMassingEdit(patch?: Partial<HouseConfig>): boolean {
  return !!patch && Object.keys(patch).every(key => key === 'overrides') && !!patch.overrides && Object.entries(patch.overrides).some(([,value]) => value != null)
    && Object.entries(patch.overrides).every(([key,value]) => value == null || ['roof','floors','roof_pitch_deg'].includes(key));
}
const massingRoofs: Record<string,string> = { 'RF-GABLE':'gable', 'RF-HIP':'hip', 'RF-FLAT':'flat', 'RF-DOME':'dome', 'RF-PYRAMID':'pyramid', 'RF-CONICAL':'cone', 'RF-CONE':'cone', 'RF-SHED':'shed', 'RF-BARREL':'barrel' };
export function massingEditApplied(programme: PlacementRequest['programme'], patch: Partial<HouseConfig>): boolean {
  const pieces=(programme as {massing?:any[]}|undefined)?.massing;
  const volumes=Array.isArray(pieces)?pieces.flatMap(piece=>piece.volumes?.filter((v:any)=>!v.minor)??[piece]):[];
  const roof=patch.overrides?.roof, floors=patch.overrides?.floors;
  return volumes.length>0 && (!roof || !!massingRoofs[roof] && volumes.every(volume=>volume.roof===massingRoofs[roof])) && (floors==null || volumes.every(volume=>volume.floors===floors));
}
export function scopedHouseEdit(layout: LayoutConfig, parcels: ParcelConfig, quarter: string | undefined, parcel: string, own?: HouseEditConfig, block?: string): Partial<HouseConfig> {
  const { culture: _culture, ...house } = own ?? {};
  const inherited = mergeHouseEdits(quarter === undefined ? undefined : layout.overrides?.quarters?.[quarter]?.houseConfig, block === undefined ? undefined : parcels.overrides?.blocks?.[block]?.houseConfig, parcels.overrides?.parcels?.[parcel]?.houseConfig);
  // A scope seed is a stream, so siblings get different houses within the same style.
  if (inherited.seed) inherited.seed = `${inherited.seed}/${parcel}/building`;
  return mergeHouseEdits(inherited, house);
}
/** A deliberate new pack chooses its own recipes, rather than retaining a recipe from the old pack. */
export function applyHouseEdit(request: PlacementRequest, config: HouseConfig): PlacementRequest {
  const changedPack = config.pack !== request.culture.pack;
  return { ...request, seed: config.seed, config,
    ...(changedPack ? { culture: { ...request.culture, pack: config.pack, mode: config.mode, borrowing: null } } : {}),
    native_minimum_candidates: undefined };
}
export function requireHouseEditSuccess(scene: PlacementBatch, requests: readonly Pick<PlacementRequest, 'id' | 'parcel_id'>[]): void {
  const success = new Set(scene.buildings.map(b => b.id));
  const parcels = new Set(scene.buildings.map(b => b.parcel_id));
  const missing = requests.filter(request => !success.has(request.id) && !parcels.has(request.parcel_id)).map(request => request.id);
  if (!missing.length) return;
  const refusal = scene.refusals.find(r => missing.includes(r.id));
  throw new Error(refusal ? `${refusal.code}: ${refusal.message}` : 'House edit refused. The previous buildings have been retained.');
}
