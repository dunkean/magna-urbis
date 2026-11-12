import { describe, expect, it } from 'vitest';
import { DEFAULTS, fromQuery, toQuery } from '../src/gen/options';
import { generateNames, settlementNames, presentName } from '../src/gen/names';
import { Rng } from '../src/gen/core/rng';
import type { World } from '../src/gen/types';
import { renameMap, presentMapNames } from '../src/v2/mapNaming';
import { defaultSettings } from '../src/v2/settings';
import { resolveToponymProfile, TOPONYM_PROFILES } from '../src/gen/names/profiles';
import { generateToponymRecord } from '../src/gen/names/toponyms';
import { varyNames } from '../src/gen/names/policy';
import { vocabularyForProfile } from '../src/gen/names/culturalVocabulary';
import { VOCAB } from '../src/gen/names/grammar';
import { applyLabelEdits } from '../src/v2/mapLabels';
import { defaultText, selectNameLevels, cityTextLabels, NAME_LEVELS } from '../src/render/textLayer';
import { kindStyles } from '../src/render/labelStyles';
import { PALETTES } from '../src/render/styles';
import { buildMapLabels, layoutGlyphs, type MapLabel } from '../src/render/mapLabels';
import { validateSettings } from '../src/v2/project';
import { presetComposition, validateComposition } from '../src/render/composition';
import { latinReading } from '../src/gen/names/writing';

const box=(x:number,y:number)=>[{x,y},{x:x+100,y},{x:x+100,y:y+100},{x,y:y+100}];
function fixture(culture='bastide'):World {
  const grid={w:8,h:8,cell:125,data:new Float32Array(64)};
  const world={seed:'naming-system',mapSize:1000,stats:{},options:{...DEFAULTS,culture,language:'auto'},
    terrain:{height:grid,slope:grid,water:new Uint8Array(64),rivers:[{id:1,main:true,path:[{x:0,y:100},{x:1000,y:100}],width:[8,8]},{id:2,path:[{x:0,y:200},{x:150,y:200}],width:[1,1]}],lakes:[],seaFraction:0},
    site:{center:{x:500,y:500},reserveRadius:100},roads:[],
    settlements:[{key:'main',main:true,population:3000,culture,center:{x:500,y:500},detail:'main'}],
    urban:{population:3000,footprint:[],quarters:[{zone:'core',phase:0,poly:{outer:box(300,300),holes:[]},streetSpace:[]},{zone:'edge',phase:1,poly:{outer:box(700,700),holes:[]},streetSpace:[]}],streets:[{path:[{x:400,y:500},{x:600,y:500}],rank:0,role:'street',width:8,phase:0}],squares:[box(600,600)],landmarks:[],sites:[{id:'keep',kind:'castle',anchor:{x:500,y:500},lot:[]}],walls:[]},
  } as unknown as World;
  const root=new Rng('magna-urbis:'+world.seed);world.names=generateNames(world,root);settlementNames(world,root);return world;
}
function settings(culture='bastide'){const s=defaultSettings();s.options.culture=culture;return s;}

describe('unified names and durable edits',()=>{
  it('localizes generated legacy descriptions in every interface language',()=>{
    for(const culture of ['bastide','medina','chinese','norse-ringfort','elven']){
      const w=renameMap(fixture(culture),settings(culture));
      const street=w.names!.entries.find(e=>e.kind==='street')!;
      expect(street.parts?.opaque).toBe(false);
      for(const language of ['en','fr','ja','ar','es','pt','zh','ru'] as const){
        expect(presentMapNames(w,language).names!.entries.find(e=>e.id===street.id)?.text).toBe(presentName(street.parts!,{mode:'localized',language}));
      }
      expect(presentMapNames(w,'fr').names!.entries.find(e=>e.id===street.id)?.text).toBe('Rue Principale');
    }
  });
  it('records known trades before composing the cultural label',()=>{
    const profile=resolveToponymProfile('bastide'),v=vocabularyForProfile(profile,VOCAB.french);
    const cultural=v.st.craft(v.crafts.smith),d=v.describeName!(cultural)!;
    const parts={...d,kind:'street' as const,cultural};
    expect(presentName(parts,{mode:'localized',language:'en'})).toBe('Blacksmiths Street');
    expect(presentName(parts,{mode:'localized',language:'fr'})).toBe('Rue des Forgerons');
  });
  it('honours explicit profiles and regional independence',()=>{
    const s=settings();s.options.language='persian';s.naming={local:{main:{profile:'japanese'}}};
    const w=renameMap(fixture(),s);
    expect(w.names!.profile).toBe('japanese');
    expect(w.names!.regionParts?.profile).toBe('persian');
    s.naming.region={profile:'swahili'};
    expect(renameMap(w,s).names!.regionParts?.profile).toBe('swahili');
    s.naming={};s.options.language='german';
    expect(renameMap(w,s).names!.profile).toBe('german');
  });
  it('makes european-organic independent of seed and recognizes native aliases',()=>{
    for(const seed of ['a','b','c'])expect(resolveToponymProfile('european-organic',undefined,seed).id).toBe('french');
    expect(resolveToponymProfile('west').id).toBe('french');expect(resolveToponymProfile('mongol').id).toBe('mongolian');
    expect(resolveToponymProfile('unknown').id).toBe('english');expect(resolveToponymProfile('unknown').diagnostic).toContain('Unknown culture');
  });
  it('supports invented/geographic sources with an explicit unavailable-source diagnostic',()=>{
    const base={seed:'sources',key:'place',kind:'town' as const,culture:'bastide'};
    expect(generateToponymRecord({...base,source:'geographic'}).sourceMode).toBe('country');
    expect(generateToponymRecord({...base,source:'invented'}).sourceMode).toBe('constructed');
    expect(generateToponymRecord({...base,culture:'maya',source:'geographic'}).diagnostic).toContain('No geographic corpus');
  });
  it('keeps label ids and author text attached when a river is inserted or reordered',()=>{
    const s=settings(),first=renameMap(fixture(),s),town=first.names!.entries.find(e=>e.kind==='town')!;
    s.naming={labels:{[town.id]:{text:'Author town'}}};
    first.terrain.rivers.unshift({id:42,path:[{x:0,y:300},{x:500,y:300}],width:[1,1]});
    const next=renameMap(first,s);
    expect(next.names!.entries.find(e=>e.id===town.id)?.text).toBe('Author town');
    expect(next.names!.entries.find(e=>e.id==='river:1')?.parts).toEqual(first.names!.entries.find(e=>e.id==='river:1')?.parts);
  });
  it('restores frozen records instead of silently adopting new generator output',()=>{
    const s=settings(),first=renameMap(fixture(),s),record=first.names!.bank!['river:1'];
    record.parts={...record.parts,proper:'Retained',cultural:'Retained',opaque:true};
    const next=renameMap(first,s);expect(next.names!.entries.find(e=>e.id==='river:1')?.text).toBe('Retained');
    expect(first.names!.entries.find(e=>e.id==='river:1')?.text).not.toBe('Retained');
  });
  it('migrates known proper names from algorithm 2 while rebuilding generated descriptions',()=>{
    const source=fixture(),town=source.names!.entries.find(e=>e.kind==='town')!;
    source.names!.algorithmVersion='2';town.parts={...town.parts!,proper:'Oldenburg',cultural:'Oldenburg'};town.text='Oldenburg';
    const next=renameMap(source,settings());
    expect(next.names!.entries.find(e=>e.kind==='town')?.text).toBe('Oldenburg');
    expect(next.names!.entries.find(e=>e.kind==='castle')?.text).toBe('Oldenburg Castle');
    expect(next.names!.bank?.['settlement:main'].parts.proper).toBe('Oldenburg');
  });
  it('regenerates only the selected scope and protects author replacements',()=>{
    const s=settings(),first=renameMap(fixture(),s),before=first.names!.entries.find(e=>e.kind==='town')!.text;
    s.naming={source:'invented'};const invented=renameMap(first,s),river=invented.names!.entries.find(e=>e.kind==='river')!.text;
    varyNames(s.naming,'city:main');const next=renameMap(invented,s);
    expect(next.names!.entries.find(e=>e.kind==='town')!.text).not.toBe(invented.names!.entries.find(e=>e.kind==='town')!.text);
    expect(next.names!.entries.find(e=>e.kind==='river')!.text).toBe(river);
    s.naming.labels={'settlement:main':{text:'Pinned'}};varyNames(s.naming,'all');expect(renameMap(next,s).names!.entries.find(e=>e.kind==='town')!.text).toBe('Pinned');
  });
  it('can regenerate a descriptive street as another name without changing its neighbours',()=>{
    const s=settings(),first=renameMap(fixture(),s),street=first.names!.entries.find(e=>e.kind==='street')!;
    s.naming={};varyNames(s.naming,`feature:${street.id}`);
    const next=renameMap(first,s);
    expect(next.names!.entries.find(e=>e.id===street.id)?.text).not.toBe(street.text);
    expect(next.names!.entries.find(e=>e.id==='river:1')?.text).toBe(first.names!.entries.find(e=>e.id==='river:1')?.text);
  });
  it('keeps mixed-source choices frozen outside the regenerated scope',()=>{
    const s=settings();s.naming={source:'mixed'};const source=fixture();
    for(let id=3;id<30;id++)source.terrain.rivers.push({id,path:[{x:0,y:id*25},{x:1000,y:id*25}],width:[1,1]});
    const first=renameMap(source,s),before=first.names!.entries.filter(e=>e.kind==='river').map(e=>[e.id,e.parts]);
    varyNames(s.naming,'city:main');const next=renameMap(first,s);
    expect(next.names!.entries.filter(e=>e.kind==='river').map(e=>[e.id,e.parts])).toEqual(before);
  });
  it('keeps generated text localizable when only styling or placement is edited',()=>{
    const w=renameMap(fixture(),settings()),street=w.names!.entries.find(e=>e.kind==='street')!;
    applyLabelEdits(w,{[street.id]:{anchor:{x:123,y:456},style:{bold:true}}});
    expect(street.parts?.opaque).toBe(false);expect(street.reference).toBeUndefined();
    expect(presentMapNames(w,'fr').names!.entries.find(e=>e.id===street.id)?.text).toBe('Rue Principale');
    expect(street.anchor).toEqual({x:123,y:456});
  });
  it('distinguishes changing a proper name from replacing a complete label',()=>{
    const w=renameMap(fixture(),settings());
    applyLabelEdits(w,{'settlement:main':{text:'Valmont',mode:'proper'}});
    expect(w.names!.entries.find(e=>e.kind==='castle')?.text).toBe('Valmont Castle');
    const castle=w.names!.entries.find(e=>e.kind==='castle')!;
    applyLabelEdits(w,{[castle.id]:{text:'The untranslatable keep',mode:'label'}});
    expect(presentMapNames(w,'fr').names!.entries.find(e=>e.id===castle.id)?.text).toBe('The untranslatable keep');
  });
  it('migrates ordinal edits using their retained object, not their new position',()=>{
    const source=fixture(),town=source.names!.entries.find(e=>e.kind==='town')!;town.id='n99';
    const s=settings();s.naming={labels:{n99:{text:'Migrated'}}};const next=renameMap(source,s);
    expect(s.naming.labels?.n99).toBeUndefined();expect(next.names!.entries.find(e=>e.kind==='town')?.text).toBe('Migrated');
  });
  it('round trips all profiles and source options through the legacy URL',()=>{
    for(const p of TOPONYM_PROFILES)expect(fromQuery(toQuery({...DEFAULTS,language:p.id,nameSource:'invented'})).language).toBe(p.id);
    expect(fromQuery(toQuery({...DEFAULTS,nameSource:'mixed'})).nameSource).toBe('mixed');
  });
  it('validates scoped policies, display preferences and style-only edits',()=>{
    const s=settings();s.naming={profile:'swahili',source:'mixed',mapLanguage:'ja',script:'latin',region:{profile:'japanese'},local:{main:{profile:'persian'}},features:{'river:1':{source:'invented'}},variations:{all:1},labels:{'river:1':{style:{bold:true}}}};
    expect(()=>validateSettings(s)).not.toThrow();
    expect(()=>validateSettings({...s,naming:{profile:'made-up-profile'}})).toThrow();
    expect(()=>validateSettings({...s,naming:{variations:{all:NaN}}})).toThrow();
  });
});

describe('importance sliders and international text',()=>{
  const st=kindStyles('atlas',PALETTES.atlas);
  const rivers:Array<MapLabel>=Array.from({length:20},(_,i)=>({id:`river:${i}`,kind:'river',text:`River ${i}`,x:0,y:0,detail:i/20,st:st.river,path:[{x:0,y:0},{x:1000-i*10,y:0}]}));
  it('selects none, the most important, and all candidates, monotonically',()=>{
    const text=defaultText();let previous:string[]=[];
    for(let level=0;level<=100;level++){
      const ids=selectNameLevels(rivers,{...text,levels:{rivers:level}}).map(l=>l.id);
      for(const id of previous)expect(ids).toContain(id);
      previous=ids;
      if(level===0)expect(ids).toHaveLength(0);if(level===1)expect(ids).toEqual(['river:0']);
    }
    expect(previous).toHaveLength(20);
  });
  it('separates categories and never modifies generated names',()=>{
    const labels=[...rivers,{id:'town',kind:'town',text:'Town',x:0,y:0,st:st.town}];
    const before=structuredClone(labels);
    expect(selectNameLevels(labels,{...defaultText(),levels:{rivers:0,places:100}}).map(l=>l.id)).toEqual(['town']);
    expect(labels).toEqual(before);
  });
  it('includes short streams at maximum detail and uses the common render filter',()=>{
    const w=renameMap(fixture(),settings());expect(w.names!.entries.filter(e=>e.kind==='river')).toHaveLength(2);
    const text=defaultText({levels:Object.fromEntries(NAME_LEVELS.map(k=>[k,100]))});
    expect(buildMapLabels(w,'atlas',PALETTES.atlas,text).filter(l=>l.kind==='river')).toHaveLength(2);
    text.levels!.rivers=0;expect(buildMapLabels(w,'atlas',PALETTES.atlas,text).some(l=>l.kind==='river')).toBe(false);
  });
  it('validates slider ranges while accepting older compositions',()=>{
    const c=presetComposition('atlas');c.text.levels={rivers:100,buildings:0};expect(()=>validateComposition(c)).not.toThrow();
    c.text.levels.rivers=101;expect(()=>validateComposition(c)).toThrow();delete c.text.levels;expect(()=>validateComposition(c)).not.toThrow();
  });
  it('shapes joining scripts as a complete run and preserves unknown source scripts',()=>{
    const text='شارع \u2068Valmont\u2069',layout=layoutGlyphs(text,st.street,12,1,()=>90);
    expect(layout.glyphs).toHaveLength(1);expect(layout.glyphs[0].ch).toBe(text);expect(layout.total).toBe(90);
    expect(latinReading('Москва')).toBe('Moskva');expect(latinReading('東京')).toBeUndefined();
    expect(presentName({kind:'town',proper:'東京',cultural:'東京',opaque:true},{script:'latin'})).toBe('東京');
  });
});

describe('native names use the same presentation as the map',()=>{
  it('replaces French engine descriptions with cultural records, including quarters and buildings',()=>{
    const w=fixture('chinese');w.debug={v2RustCities:{main:{layouts:[{key:'main',culture:'chinese',quarters:[{shape:{outer:box(300,300),holes:[]},phase:0}],blocks:[{quarter:0,kind:'block',shape:{outer:box(300,300),holes:[]}}],streets:[],structure:{districts:[{id:3,quarters:[0],label:'Quartier de la Paix-Éternelle',role:'commoner'}]}}],partitions:[{key:'main',parcels:[{id:'temple',shape:{outer:box(500,500),holes:[]},use:'plot'}],programme:{allocations:[{parcelId:'temple',role:'worship.temple.major',culture:'chinese'}]}}],scene:{buildings:[{id:'house',parcel_id:'house-parcel',function:'domestic',culture:{culture:'chinese'},footprint:[{outer:box(700,700),holes:[]}]}]}}}} as unknown as World['debug'];
    const next=renameMap(w,settings('chinese'));
    expect(next.names!.nativeManaged).toBe(true);
    const native=next.names!.entries.filter(e=>e.id.startsWith('urban:'));
    expect(native.some(e=>e.kind==='quarter')).toBe(true);expect(native.some(e=>e.kind==='building')).toBe(true);
    expect(native.map(e=>e.text).join(' ')).not.toMatch(/Quartier|Éternelle|Château|Bâtiment/);
    const temple=native.find(e=>e.parts?.role==='worship.temple.major')!;expect(temple.text).toContain('Temple');
    expect(presentMapNames(next,'ja').names!.entries.find(e=>e.id===temple.id)?.text).toContain('寺院');
    expect(cityTextLabels({} as never,defaultText(),PALETTES.atlas,next)).toEqual([]);
  });
});
