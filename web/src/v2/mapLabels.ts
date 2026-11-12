import type { World, Vec2 } from '../gen/types';
import type { NameEntry } from '../gen/names/types';
import { nativeCityRecords } from './nativeProducts';
import { roleLabel } from '../render/cityRoles';
import { renameParts } from '../gen/names/rename';
import { presentName, setSettlementName } from '../gen/names';

export interface LabelEdit {
  text?: string;
  mode?: 'label' | 'proper';
  anchor?: Vec2;
  style?: { color?: string; size?: number; bold?: boolean; italic?: boolean };
  /** New free labels and names attached to previously unnamed native city objects. */
  kind?: 'free' | 'quarter' | 'parcel' | 'building';
}
export interface LabelCandidate { id: string; text: string; anchor: Vec2; kind: string }
const center = (points: Vec2[]): Vec2 | undefined => points.length ? ({ x: points.reduce((a,p) => a+p.x,0)/points.length, y: points.reduce((a,p) => a+p.y,0)/points.length }) : undefined;
const centroid = (rings: Vec2[][]): Vec2 | undefined => {
  let a=0,x=0,y=0; for (const ring of rings) for (let i=0,j=ring.length-1;i<ring.length;j=i++) { const c=ring[j].x*ring[i].y-ring[i].x*ring[j].y; a+=c; x+=(ring[j].x+ring[i].x)*c; y+=(ring[j].y+ring[i].y)*c; }
  if (Math.abs(a)>1e-6) return {x:x/(3*a),y:y/(3*a)};
  const points=rings.flat(); if (!points.length) return undefined;
  return {x:(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,y:(Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))/2};
};
/** Native objects without generated names are available for naming without changing city geometry. */
export function nativeLabelCandidates(world: World): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const native = nativeCityRecords(world) ?? {};
  const towns = [{key:'main',urban:world.urban},...(world.settlements??[]).filter(s=>!s.main&&s.key!=='main')];
  for(const town of towns){
    if(native[town.key])continue;
    const urban=town.urban,prefix=town.key==='main'?'classic':`classic:${encodeURIComponent(town.key)}`;
    for (const [index, quarter] of (urban?.quarters ?? []).entries()) { const anchor = center(quarter.poly.outer); if (anchor) out.push({ id: `${prefix}:quarter:${index}`, text:'', anchor, kind:'quarter' }); }
    for (const [index, parcel] of (urban?.parcels ?? []).entries()) { const anchor = center(parcel.poly); if (anchor) out.push({ id: `${prefix}:parcel:${index}`, text:'', anchor, kind:'parcel' }); }
    for (const [index, building] of (urban?.buildings ?? []).entries()) { const anchor = center(building.poly); if (anchor) out.push({ id: `${prefix}:building:${index}`, text:'', anchor, kind:'building' }); }
  }
  for (const [cityKey, city] of Object.entries(nativeCityRecords(world) ?? {})) {
    const prefix = encodeURIComponent(cityKey);
    for (const layout of city.layouts ?? []) {
      for (const [index, quarter] of layout.quarters.entries()) {
        const anchor = center(quarter.shape.outer); if (anchor) out.push({ id: `urban:${prefix}:quarter:${encodeURIComponent(layout.key)}:${index}`, text: '', anchor, kind: 'quarter' });
      }
      const districtByQuarter = new Map<number, number>();
      const districtRings = new Map<number, Vec2[][]>();
      for (const district of layout.structure?.districts ?? []) for (const quarter of district.quarters) districtByQuarter.set(quarter, district.id);
      for (const block of layout.blocks) {
        if (block.kind.startsWith('reserve')) continue;
        const id = districtByQuarter.get(block.quarter); if (id === undefined) continue;
        let rings = districtRings.get(id); if (!rings) { rings = []; districtRings.set(id, rings); } rings.push(block.shape.outer);
      }
      for (const district of layout.structure?.districts ?? []) {
        const anchor=centroid(districtRings.get(district.id) ?? []);
        if (anchor && (district.label || district.role)) out.push({id:`urban:${prefix}:district:${encodeURIComponent(layout.key)}:${district.id}`, text:district.label || roleLabel(district.role!), anchor, kind:'district'});
      }
    }
    for (const partition of city.partitions ?? []) {
      const allocations = new Map((partition.programme?.allocations ?? []).map(a => [a.parcelId, a as typeof a & { label?:string; landmark?:boolean; role?:string }]));
      for (const [index, parcel] of partition.parcels.entries()) {
      const allocation = parcel.id ? allocations.get(parcel.id) : undefined;
      const landmark = allocation?.landmark || parcel.use === 'market' || !!allocation?.role && /^(defence\.(keep|castle|kasbah|fort|fortress)|elite\.palace|worship\.(cathedral|temple\.major)|commerce\.market)(\.|$)/.test(allocation.role);
      const anchor = landmark ? centroid([parcel.shape.outer]) : center(parcel.shape.outer);
      const text = landmark ? allocation?.label || (allocation?.role ? roleLabel(allocation.role) : parcel.use === 'market' ? 'Marché' : 'Monument') : '';
      if (anchor) out.push({ id: `urban:${prefix}:parcel:${encodeURIComponent(partition.key)}:${encodeURIComponent(parcel.id ?? String(index))}`, text, anchor, kind: 'parcel' });
      }
    }
    for (const building of city.scene?.buildings ?? []) {
      // City volumes carry no placement transform: anchor them on their footprint.
      const anchor = building.recipe_id === 'silhouette' ? building.footprint[0] && center(building.footprint[0].outer) : building.transform?.origin;
      if (anchor) out.push({ id: `urban:${prefix}:building:${encodeURIComponent(building.id)}`, text: '', anchor, kind: 'building' });
    }
  }
  return out;
}
export function labelCandidates(world: World): LabelCandidate[] {
  const entries = (world.names?.entries ?? []).map(e => ({ id: e.id, text: e.text, anchor: e.anchor, kind: e.sub ?? e.kind }));
  const ids = new Set(entries.map(e => e.id));
  return [...entries, ...nativeLabelCandidates(world).filter(e => !ids.has(e.id))];
}
/** Applied after generation so author text remains independent of display-language recomposition. */
export function applyLabelEdits(world: World, edits?: Record<string, LabelEdit>): void {
  if (!world.names || !edits || !Object.keys(edits).length) return;
  const originals = new Map(world.names.entries.map(e => [e.id, e]));
  const extra = new Map(nativeLabelCandidates(world).map(e => [e.id, e]));
  for (const [id, edit] of Object.entries(edits)) {
    const existing = originals.get(id), candidate = extra.get(id);
    if (existing) {
      if(edit.text?.trim()){
        if(edit.mode==='proper'&&existing.parts){
          if(existing.reference?.form==='name')setSettlementName(world,existing.reference.key,edit.text);
          else {existing.parts=renameParts(existing.parts,edit.text);existing.canonicalText=existing.parts.cultural;existing.text=presentName(existing.parts,world.names.presentation);setSettlementName(world,existing.entityKey ?? existing.id,edit.text);}
        }else{
          existing.text = edit.text; existing.canonicalText = edit.text;
          existing.parts = { kind: existing.kind, proper: edit.text, cultural: edit.text, opaque: true };
          existing.reference = undefined; existing.generated = false;
        }
      }
      if (edit.anchor) { existing.anchor = edit.anchor; existing.path = undefined; existing.span = undefined; existing.manual = true; }
      existing.labelStyle = edit.style;
    } else if (edit.text?.trim() && (candidate || edit.kind === 'free') && (edit.anchor || candidate?.anchor)) {
      const entry: NameEntry = { id, kind: candidate?.kind === 'quarter' ? 'quarter' : candidate?.kind==='building'?'building':'square', text: edit.text, rank: 0,
        anchor: edit.anchor ?? candidate!.anchor, manual: true, labelStyle: edit.style, sub: candidate?.kind ?? 'free', ...(candidate?.text ? { replacedAnchor:candidate.anchor } : {}) };
      world.names.entries.push(entry);
    }
  }
}
