import type { World, UrbanBuilding, UrbanLayer, Settlement, Vec2 } from '../gen/types';
import { pointInRing } from '../gen/geo/poly';
import { buildingCandidates } from './buildingPicker';

export interface BuildingEdit { type: 'building'; settlement: string; index: number; nativeId?:string; nativeRequestId?:string; signature: string; patch: Partial<UrbanBuilding> }
export function buildingSignature(b: UrbanBuilding): string { return b.poly.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';'); }
export function townUrban(w: World, key: string): UrbanLayer | undefined { return key === 'main' ? w.urban : w.settlements?.find(s => s.key === key)?.urban; }
export function buildingAt(w: World, p: Vec2): { settlement: string; index: number; building: UrbanBuilding } | null {
  const towns = [{ key: 'main', urban: w.urban }, ...(w.settlements ?? []).filter(s => !s.main && s.key !== 'main')];
  for (const s of towns) {
    if (!s.urban) continue;
    const candidates=buildingCandidates(s.urban.buildings,p);
    for (let k = candidates.length - 1; k >= 0; k--) { const i=candidates[k],building=s.urban.buildings[i]; if (pointInRing(building.poly, p) && !building.courtyards?.some(hole=>pointInRing(hole,p))) return { settlement: s.key, index: i, building }; }
  }
  return null;
}
export function applyBuildingEdits(source: World, edits: unknown[]): { world: World; applied: number; skipped: number } {
  if (!edits.length) return { world: source, applied: 0, skipped: 0 };
  const world:World = {...source,settlements:source.settlements?.map(s=>({...s}))}; let applied = 0, skipped = 0;
  const copied = new Map<string,UrbanLayer>(),geometryChanged=new Set<UrbanLayer>();
  function writableTown(key:string):UrbanLayer|undefined{
    if(copied.has(key))return copied.get(key);
    const original=townUrban(source,key);if(!original)return;
    const layer={...original,buildings:original.buildings.slice()};copied.set(key,layer);
    if(key==='main'){world.urban=layer;const main=world.settlements?.find(s=>s.main||s.key==='main');if(main)main.urban=layer;}
    else{const place=world.settlements?.find(s=>s.key===key);if(place)place.urban=layer;}
    return layer;
  }
  for (const value of edits) {
    if (!value || typeof value !== 'object' || (value as BuildingEdit).type !== 'building') { skipped++; continue; }
    const edit = value as BuildingEdit;
    const layer = writableTown(edit.settlement);
    const index=edit.nativeId?layer?.buildings.findIndex(b=>(b as UrbanBuilding&{nativeId?:string}).nativeId===edit.nativeId&&buildingSignature(b)===edit.signature)??-1:edit.index;
    const building=layer?.buildings[index];
    if (!building || buildingSignature(building) !== edit.signature) { skipped++; continue; }
    const patch = validateBuildingPatch(edit.patch);
    layer!.buildings[index]={...building,...patch}; applied++;
    if(patch.poly)geometryChanged.add(layer!);
  }
  for(const layer of geometryChanged)layer.masses=layer.buildings.map(b=>({outer:b.poly,holes:b.courtyards??[]}));
  return { world, applied, skipped };
}
export function validateBuildingPatch(input: unknown): Partial<UrbanBuilding> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Réglages de bâtiment invalides.');
  const p = input as Record<string, unknown>, out: Partial<UrbanBuilding> = {};
  if (p.storeys !== undefined) { if (!Number.isInteger(p.storeys) || Number(p.storeys) < 1 || Number(p.storeys) > 100) throw new Error('Nombre d’étages : 1 à 100.'); out.storeys = Number(p.storeys); }
  if (p.height !== undefined) { if (!Number.isFinite(p.height) || Number(p.height) < .5 || Number(p.height) > 1000) throw new Error('Hauteur : 0,5 à 1 000 mètres.'); out.height = Number(p.height); }
  const roofs = ['gable','hip','flat','dome','pyramidal','pagoda','thatch-round','none','tiled-hip','conical','barrel','terraced'];
  if (p.roof !== undefined) { if (!roofs.includes(String(p.roof))) throw new Error('Forme de toit inconnue.'); out.roof = p.roof as UrbanBuilding['roof']; }
  for (const key of ['kind', 'arch', 'material'] as const) if (p[key] !== undefined) { if (typeof p[key] !== 'string' || String(p[key]).length > 100) throw new Error('Texte de bâtiment invalide.'); out[key] = p[key] as string; }
  if (p.poly !== undefined) {
    if (!Array.isArray(p.poly) || p.poly.length < 3 || p.poly.length > 1000 || !p.poly.every(v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Math.abs(v.x) < 1e6 && Math.abs(v.y) < 1e6)) throw new Error('Emprise de bâtiment invalide.');
    out.poly = p.poly.map(v => ({ x: v.x, y: v.y }));
  }
  return out;
}
export function nearestSettlement(world: World, p: Vec2): Settlement | undefined {
  return world.settlements?.filter(s => Math.hypot(s.center.x - p.x, s.center.y - p.y) < Math.max(s.radius, world.mapSize * .025)).sort((a,b) => Math.hypot(a.center.x-p.x,a.center.y-p.y)-Math.hypot(b.center.x-p.x,b.center.y-p.y))[0];
}
