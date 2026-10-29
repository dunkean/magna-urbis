import { describe, it, expect } from 'vitest';
import { Rng } from '../src/gen/core/rng';
import { layoutFarm, frameOf, placeFarm, type FarmContext } from '../src/gen/landuse/farms';
import { gardenDetails } from '../src/render/readableGardens';
import { ruralDetails, ruralDetailsSvg, type RuralRenderLayer } from '../src/render/ruralDetails';
import { PALETTES } from '../src/render/styles';
import { normalizeParcelConfig } from '../../rust/bridge/urbanConfig';
import { encodeSituation, decodeSituation } from '../src/ui/citySituation';

const context: FarmContext = {culture:'hanseatic',soil:.5,slope:.12,downhill:{x:1,y:0},wet:0,exposed:0,market:.1,west:0};
const box = {outer:[{x:0,y:0},{x:20,y:0},{x:20,y:26},{x:0,y:26}],holes:[]};
describe('Reddit rural options', () => {
  it('keeps the old farm layout when off and faces the track instead of sun or slope when on', () => {
    const frame = frameOf({x:0,y:-1},context.downhill);
    const run = (c: FarmContext) => layoutFarm('longere','family',c,frame,new Rng('rural-opts'));
    expect(JSON.stringify(run({...context,streetAlignedHomes:false}))).toBe(JSON.stringify(run(context)));
    const farm = run({...context,streetAlignedHomes:true});
    const house = farm.parts.find(p=>p.use==='house')!;
    expect(house.poly[1][1]).toBe(house.poly[0][1]);
    expect(house.poly[0][1]).toBeGreaterThan(farm.entry[1]);
  });
  it('opens the garden fence toward the house and splits planting into short beds', () => {
    const details = gardenDetails(box,{x:10,y:-8});
    expect(details.entry.y).toBe(0);
    expect(details.beds.length).toBeGreaterThan(8);
    expect(details.paths[0][0]).toEqual(details.entry);
    expect(details.fences.some(f=>f.some(p=>p.x===details.entry.x && p.y===details.entry.y))).toBe(false);
  });
  it('draws actual paddocks and practical holding boundaries as independent render options', () => {
    const lf = layoutFarm('vierkanthof','family',{...context,wet:.7},frameOf({x:0,y:1},null),new Rng('paddock'));
    const placed = placeFarm(lf,lf.type,{x:50,y:50},{x:0,y:1});
    const farm = {pos:{x:50,y:50},angle:placed.angle,buildings:placed.parts.map(p=>p.poly),yard:placed.yard,drive:[placed.gate,placed.entry],plots:placed.plots,parts:placed.parts,gate:placed.gate,entry:placed.entry};
    const lu: RuralRenderLayer = {areas:[{kind:'field',poly:box.outer}],farmsteads:[farm],reserve:[],ways:[[{x:0,y:26},{x:20,y:26}]]};
    expect(ruralDetailsSvg(lu,PALETTES.parchment)).toBe('');
    lu.ruralDetails={visiblePaddocks:true};
    const pens=ruralDetails(lu); expect(pens.some(m=>m.kind==='fence')).toBe(true); expect(pens.some(m=>m.kind==='stock')).toBe(true); expect(pens.some(m=>m.kind==='track')).toBe(false);
    lu.ruralDetails={concreteFieldBoundaries:true};
    const fields=ruralDetails(lu); expect(fields.some(m=>m.kind==='track')).toBe(true); expect(fields.some(m=>m.kind==='drain')).toBe(true); expect(fields.some(m=>m.kind==='stock')).toBe(false);
  });
  it('round-trips the engine, render and countryside options in the existing share query and MU1 code', async () => {
    const urban={parcelConfig:normalizeParcelConfig({streetAlignedHomes:true,denserSmallholdings:true}),render:{readableGardens:true}};
    const landuse={visiblePaddocks:true,concreteFieldBoundaries:true};
    const q=new URLSearchParams({urban:JSON.stringify(urban),landuse:JSON.stringify(landuse)}).toString();
    const decoded=await decodeSituation(await encodeSituation({v:1,q,pins:[]}));
    expect(decoded.q).toBe(q);
    expect(normalizeParcelConfig(JSON.parse(new URLSearchParams(decoded.q).get('urban')!).parcelConfig).streetAlignedHomes).toBe(true);
    expect(normalizeParcelConfig(JSON.parse(new URLSearchParams(decoded.q).get('urban')!).parcelConfig).denserSmallholdings).toBe(true);
    expect(normalizeParcelConfig({streetAlignedHomes:false,denserSmallholdings:false})).toEqual(normalizeParcelConfig());
  });
});
