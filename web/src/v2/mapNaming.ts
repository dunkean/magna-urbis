import { Rng } from '../gen/core/rng';
import { generateNames, settlementNames, setSettlementName } from '../gen/names';
import { cleanSettlementName } from '../gen/options';
import type { World, UrbanLayer } from '../gen/types';
import type { V2Settings } from './contracts';
import { cloneV2TerrainForStage } from './worldState';
import { applyLabelEdits } from './mapLabels';
import { presentName } from '../gen/names/displayNames';
import type { Language } from './languages';
import { appendNativeNames } from './nativeNames';
import { namingPolicy, namePolicyKey } from '../gen/names/policy';
import { generateToponymRecord } from '../gen/names/toponyms';
import { resolveToponymProfile } from '../gen/names/profiles';
import { vocabularyForProfile } from '../gen/names/culturalVocabulary';
import { VOCAB } from '../gen/names/grammar';
import type { NameParts } from '../gen/names/types';
import { nativeCityRecords } from './nativeProducts';
import { featureNameKey } from '../gen/names/identity';
import { renameParts } from '../gen/names/rename';

/** Detach only metadata that the names stage writes; physical geometry stays shared. */
function namingUrban(source: UrbanLayer | undefined): UrbanLayer | undefined {
  if (!source) return;
  return { ...source,
    streets:source.streets.map(street=>({...street})), quarters:source.quarters.map(quarter=>({...quarter})),
    sites: source.sites?.map(site => ({ ...site })),
    macro: source.macro ? { ...source.macro, nuclei: source.macro.nuclei.map(nucleus => ({ ...nucleus })) } : undefined,
  };
}

/** Rebuild only names. Retained geometry, heights and random streams are untouched. */
export function renameMap(source: World, settings: V2Settings, language: Language = 'en'): World {
  const presentation = { mode:settings.naming?.mode ?? 'localized' as const,
    language:settings.naming?.mapLanguage && settings.naming.mapLanguage!=='ui' ? settings.naming.mapLanguage : language, script:settings.naming?.script };
  const manual = new Map<string, string>();
  const specs = source.options.settlements;
  if (source.options.workflow === 'list' && specs && typeof specs === 'object' && 'list' in specs) {
    specs.list.forEach((spec, index) => { const name = cleanSettlementName(spec.name); if (name) manual.set(index === 0 ? 'main' : spec.key ?? String(index), name); });
  }
  const placement = settings.region?.placement;
  if (placement?.main?.name) manual.set('main', placement.main.name);
  for (const spec of placement?.list ?? []) if (spec.name) manual.set(spec.key, spec.name);
  for (const [key, name] of Object.entries(settings.naming?.places ?? {})) {
    const cleaned = cleanSettlementName(name);
    if (cleaned) manual.set(key, cleaned);
  }
  const settlements = source.settlements?.map(place => { const policy=namingPolicy(settings.naming,place.key);
    const spec=source.options.workflow==='list'&&specs&&typeof specs==='object'&&'list' in specs ? specs.list.find((s,index)=>(index===0?'main':s.key??String(index))===place.key)?.options : undefined;
    return ({ ...place,
    culture: settings.local[place.key]?.culture ?? (place.main ? settings.options.culture : place.culture),
    urban:namingUrban(place.urban),
    options: { ...place.options, ...settings.local[place.key], language:policy.profile ?? settings.local[place.key]?.language ?? spec?.language ?? settings.options.language ?? 'auto', nameSource:policy.source ?? settings.local[place.key]?.nameSource ?? spec?.nameSource ?? settings.options.nameSource },
  }); });
  // List names are an input to generation, so all derived references see the corrected destination.
  const main = settlements?.find(place => place.main);
  const ordered = main ? [main, ...settlements!.filter(place => !place.main)] : settlements;
  const world: World = { ...source,
    options: { ...source.options, language: settings.naming?.profile ?? settings.options.language ?? 'auto', nameSource:settings.naming?.source ?? settings.options.nameSource, culture: settings.options.culture },
    terrain: cloneV2TerrainForStage(source.terrain), urban: namingUrban(source.urban), settlements,
    roads:source.roads?.every(road=>(road as {nameKey?:string}).nameKey) ? source.roads : source.roads?.map(road=>({...road})),
    landuse:source.landuse ? {...source.landuse,areas:source.landuse.areas.map(area=>({...area})),farmsteads:source.landuse.farmsteads.map(farm=>({...farm}))} : undefined,
  };
  for(const city of [{key:'main',urban:world.urban},...(settlements??[]).filter(s=>!s.main)]){
    const layout=nativeCityRecords(world)?.[city.key]?.layouts[0];
    for(const [index,q]of(city.urban?.quarters??[]).entries()){
      const id=layout?`urban:${encodeURIComponent(city.key)}:quarter:${encodeURIComponent(layout.key)}:${q.nativeId??index}`:featureNameKey(q,'quarter',JSON.stringify(q.poly.outer));
      const policy=namingPolicy(settings.naming,city.key,id);
      q.nameProfile=policy.profile;q.nameSource=policy.source;q.nameScope=id;
    }
  }
  // The synthetic list belongs only to this naming view, never to the retained generation recipe.
  const variation=Object.entries(settings.naming?.variations ?? {}).sort(([a],[b])=>a.localeCompare(b));
  const namingView: World = { ...world, seed:variation.length ? `${source.seed}:names:${JSON.stringify(variation)}` : source.seed, options: { ...world.options,
    ...(ordered?.length ? { workflow: 'list' as const, settlements: { list: ordered.map(place => ({
      key: place.key, population: place.population, culture: place.culture, options: place.options, name: manual.get(place.main ? 'main' : place.key),
    })) } } : {}),
  } };
  const root = new Rng('magna-urbis:' + namingView.seed);
  const mainPolicy=namingPolicy(settings.naming,'main');
  world.names = generateNames({ ...namingView, options: { ...namingView.options, ...settings.local.main,
    culture: settings.local.main?.culture ?? main?.culture ?? settings.options.culture, language:mainPolicy.profile ?? main?.options?.language ?? world.options.language, nameSource:mainPolicy.source ?? main?.options?.nameSource ?? world.options.nameSource } }, root,
    presentation,{...namingPolicy(settings.naming),profile:namingPolicy(settings.naming).profile ?? settings.options.language ?? 'auto'});
  namingView.names = world.names;
  settlementNames(namingView, root);
  for(const place of settlements ?? []) {
    if(place.main || !place.urban)continue;
    const localView:World={...namingView,site:{...namingView.site!,center:place.center},urban:place.urban,
      settlements:[{...place,main:true}],options:{...namingView.options,...place.options,culture:place.culture,workflow:'list',settlements:{list:[{key:place.key,population:place.population,name:manual.get(place.key)}]}}};
    const names=generateNames(localView,root.fork(place.key),presentation);
    for(const entry of names.entries.filter(e=>['street','quarter','castle','church','gate','square'].includes(e.kind))) {
      entry.id=`city:${place.key}:${entry.id}`;entry.entityKey=entry.id;entry.cityKey=place.key;
      if(entry.reference?.key==='main')entry.reference.key=place.key;
      world.names.entries.push(entry);
    }
  }
  appendNativeNames(world,settings.naming,namingView.seed);
  // Apply per-object overrides using the same profile vocabulary as the rest of the map.
  for(const entry of world.names.entries) {
    const override=settings.naming?.features?.[entry.id] ?? (settings.naming?.variations?.[`feature:${entry.id}`] ? {} : undefined);
    if(!override || entry.id.startsWith('urban:') || entry.manual || entry.reference?.form==='name'&&manual.has(entry.reference.key))continue;
    const city=entry.cityKey ?? 'main';
    const place=settlements?.find(s=>s.key===city),natural=['river','lake','sea','forest','hill','farm'].includes(entry.kind), policy=namingPolicy(settings.naming,natural?undefined:city,entry.id,entry.parentKey);
    const culture=place?.culture ?? world.options.culture, profile=resolveToponymProfile(culture,policy.profile ?? (natural?settings.options.language:place?.options?.language) ?? world.options.language,world.seed);
    const kind=natural ? entry.kind as import('../gen/names/toponyms').ToponymKind : 'place';
    const record=generateToponymRecord({seed:namingView.seed,key:entry.id,kind,culture,language:profile.id,source:policy.source ?? place?.options?.nameSource ?? world.options.nameSource});
    entry.parts=natural ? {...entry.parts,proper:record.proper,cultural:record.cultural,kind:entry.kind,opaque:record.opaque,profile:profile.id,sourceMode:record.sourceMode,meaning:undefined}
      :renameParts({...entry.parts!,profile:profile.id,sourceMode:record.sourceMode},record.proper);
  }
  const previous=source.names?.bank ?? {};
  const bank={...previous};
  const citySources=new Map(settlements?.map(s=>[s.key,s.options?.nameSource]));
  const migrating=source.names?.algorithmVersion==='2'&&!source.names.bank&&!settings.naming?.profile&&!settings.naming?.source&&!settings.naming?.region&&!settings.naming?.local&&!settings.naming?.features;
  for(const entry of world.names.entries) {
    const city=entry.cityKey ?? (entry.sub?.startsWith('settlement:') ? entry.sub.slice(11) : 'main');
    const natural=['river','lake','sea','forest','hill','farm'].includes(entry.kind)&&!entry.id.startsWith('settlement:');
    const key=namePolicyKey(settings.naming,entry,city,(natural?settings.options.nameSource:citySources.get(city))??world.options.nameSource??'auto'), retained=previous[entry.id];
    const explicit=entry.reference?.form==='name' && manual.has(entry.reference.key);
    if(retained?.policyKey===key && !explicit)entry.parts={...retained.parts};
    else if(migrating&&!explicit&&entry.parts){
      const old=source.names?.entries.find(e=>e.id===entry.id||e.kind===entry.kind&&Math.hypot(e.anchor.x-entry.anchor.x,e.anchor.y-entry.anchor.y)<.01);
      const namedPlace=entry.kind==='town'||entry.kind==='village';
      if(old?.parts&&(!old.parts.opaque||namedPlace))entry.parts=renameParts(entry.parts,old.parts.proper);
      else if(old?.parts?.opaque&&['river','lake','sea','forest','hill'].includes(entry.kind))entry.parts={...entry.parts,proper:old.parts.proper,cultural:old.parts.cultural,opaque:true};
    }
    entry.policyKey=key;
    if(entry.parts){ entry.canonicalText=entry.parts.cultural;entry.text=presentName(entry.parts,presentation);if(!explicit)bank[entry.id]={parts:{...entry.parts},policyKey:key}; }
  }
  world.names.bank=bank;
  if(world.names.regionParts){
    const regional={id:'region',kind:'farm' as const,parts:world.names.regionParts};
    const key=namePolicyKey(settings.naming,regional as import('../gen/names/types').NameEntry,undefined,settings.options.nameSource??world.options.nameSource??'auto');
    world.names.regionParts=previous.region?.policyKey===key ? {...previous.region.parts} : world.names.regionParts;
    if(migrating&&source.names?.regionParts)world.names.regionParts=source.names.regionParts.opaque?{...world.names.regionParts,proper:source.names.regionParts.proper,cultural:source.names.regionParts.cultural,opaque:true}:renameParts(world.names.regionParts,source.names.regionParts.proper);
    bank.region={parts:{...world.names.regionParts},policyKey:key};
  }
  // References are composed after restoring frozen settlement identities.
  for(const entry of world.names.entries)if(entry.reference?.form==='name')setSettlementName(world,entry.reference.key,manual.get(entry.reference.key) ?? entry.parts?.proper ?? entry.text);
  world.names.region=world.names.regionParts ? presentName(world.names.regionParts,presentation) : world.names.region;
  if (settings.naming?.title?.trim()) world.names.town = settings.naming.title.trim();
  // Migrate ordinal label edits against the old retained feature's type and anchor, never its new ordinal.
  const edits=settings.naming?.labels;
  for(const [id,edit] of Object.entries(edits ?? {}))if(/^n\d+$/.test(id)){
    const old=source.names?.entries.find(e=>e.id===id);
    const next=old ? world.names.entries.find(e=>e.kind===old.kind&&Math.hypot(e.anchor.x-old.anchor.x,e.anchor.y-old.anchor.y)<.01) : undefined;
    if(next&&edits){edits[next.id]??=edit;delete edits[id];}
  }
  applyLabelEdits(world, settings.naming?.labels);
  return world;
}

/** A view of the retained names: never regenerate proper names when switching the UI. */
export function presentMapNames(source: World, language: Language, mode: 'cultural' | 'localized' = 'localized', script?: 'source' | 'latin'): World {
  if (!source.names) return source;
  const presentation = { mode, language,script };
  return { ...source, names: { ...source.names, presentation,
    region: source.names.regionParts ? presentName(source.names.regionParts, presentation) : source.names.region,
    entries: source.names.entries.map(entry => entry.parts && (!entry.manual || entry.generated)
      ? { ...entry, text: presentName(entry.parts, presentation) } : entry),
  } };
}
