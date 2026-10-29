import { expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import deficitFixture from './fixtures/open-deficit-roman04-bridge-native.json';
import parentFixture from './fixtures/native-parent-assembly-guest-plan.json';
import type { Partition, UrbanProgramme } from '../../rust/bridge/urban';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { createBuiltOutcomeBalance, hasBuiltOutcomeBalance } from '../../rust/bridge/urbanBuiltBalance';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import { reconcileColdBuiltBalance, reconcileCompactBuiltBalance, reconcileParentBuiltBalance } from '../src/ui/urbanBuiltBalance';
import { parentRecordSource, type ParentChunkBackend, type ParentSceneManifest, type StoredParentChunk } from '../src/ui/urbanParentChunkStore';
import type { NativeParentBatch } from '../../rust/bridge/nativeParentContract';
import { parentDigest } from '../../rust/bridge/nativeParentStream';
import { beginUrbanBuildingStage, exportUrbanBuildingChunks, importUrbanBuildingChunks } from '../src/ui/urbanBuildingChunkStore';
import { urbanBuildingPanelEvidence, urbanBuildingPanelOutcomeBalanceHtml } from '../src/ui/urbanBuildingsPanel';
import { programmeBalanceEvidence } from '../src/ui/urbanProgrammeEvidence';
import { ColdTestBackend } from './helpers/urbanBuildingColdTestBackend';
import { encodeDecor, decodeDecor, type Decor } from '../src/ui/decor';
import { carryUrbanOpenDeficits } from '../../rust/bridge/urbanOpenDeficits';
import type { PlacementRequest } from '../../rust/bridge/urbanArchitecture';

const raw = fixture.chunks.map(c => c.delta as unknown as PlacementBatch);
function partitions(): Partition[] {
  const outcomes = raw.flatMap(c => [...c.buildings.map(b => ({ id:b.parcel_id, function:b.function })),
    ...c.refusals.map(r => ({ id:r.parcel_id, function:'domestic' }))]);
  return [{ key:'city', parcels:outcomes.map(o => ({ id:o.id })), warnings:[], programme:{
    demands:['domestic','mixed'].map(fn => ({ id:fn, function:fn, unit:'domesticUnits', requested:900, parcelCapacity:900,
      builtCapacity:899, openCapacity:0, deficit:1, provenance:['original request'], reasons:[] })),
    allocations:outcomes.map(o => ({ parcelId:o.id, demandId:o.function, function:o.function, unit:'domesticUnits', capacity:100, households:100 })),
  } } as unknown as Partition];
}
const report = (p:Partition[]) => p[0].programme!;

it('reconciles real compact outcomes with full deficit and explicit unknowns; ignores area/household proxies', () => {
  const input = partitions(); input[0].programme!.demands[0].reasons=['model need retained','Building refusal: previous scene'];
  const before = JSON.stringify(input);
  const scene = { ...raw[0], buildings:raw.flatMap(c=>c.buildings).map(b=>({...b,useful_area_m2:1_000_000,domestic_units:999})), refusals:raw.flatMap(c=>c.refusals) };
  const p = report(reconcileCompactBuiltBalance(input,scene));
  expect(JSON.stringify(input)).toBe(before);
  expect(p.demands[0]).toMatchObject({ builtCapacity:0, openCapacity:0, deficit:900, provenance:['original request'] });
  expect(p.demands[0].reasons).toContain('model need retained'); expect(p.demands[0].reasons).not.toContain('Building refusal: previous scene');
  expect(p.builtBalance!.demands.reduce((n,d)=>n+d.admittedUnknown,0)).toBe(6);
  expect(p.builtBalance!.demands.reduce((n,d)=>n+d.refused,0)).toBe(3);
  expect(programmeBalanceEvidence(scene)(p)).toBe('outcomes_reconciled');
  const html = urbanBuildingPanelOutcomeBalanceHtml(p);
  expect(html).toContain('data-built-outcomes'); expect(html).toContain('>6 ');
  expect(html).toMatch(/inconnue|unknown/); expect(html).toMatch(/Déficit|Deficit/);
  expect(programmeBalanceEvidence({ ...scene, buildings:[] })(p)).toBe('not_calculated');
  const changed = structuredClone(p); changed.allocations[0].households = 1;
  expect(programmeBalanceEvidence(scene)(changed)).toBe('not_calculated');
});

it('save/restore reads every authenticated native chunk once without resolving plans; panel retains unknown capacity', async () => {
  const backend = new ColdTestBackend(), stage = await beginUrbanBuildingStage(backend,
    { sceneId:'original', sourceFingerprint:fixture.cliSha256, totalRequests:9 });
  for (let i=0;i<raw.length;i++) await stage.append(await archivePlanBatch(raw[i]),fixture.chunks[i].progress);
  await stage.commit();
  const saved:Uint8Array[]=[];
  for await (const part of exportUrbanBuildingChunks(backend,'original')) saved.push(part);
  const restored = new ColdTestBackend();
  const manifest = await importUrbanBuildingChunks(restored,(async function*(){ yield* saved; })(), { sceneId:'restored' });
  restored.reads.length=0;
  const p = report(await reconcileColdBuiltBalance(partitions(),restored,manifest.sceneId));
  expect(restored.reads).toEqual([0,1,2]);
  const zero = new Float32Array(1);
  const decor = { raster:{ n:1,width:1,height:zero,water:new Uint8Array(1),waterLevel:zero,riverWidth:zero,riverIds:new Int32Array(1) },
    meta:{ format:'magna-decor',version:1,waterSvg:'',pipeline:{ urban:{ partitions:[{...partitions()[0],programme:p}] } } } } as unknown as Decor;
  const savedProgramme = decodeDecor(encodeDecor(decor)).meta.pipeline!.urban!.partitions![0].programme!;
  expect(hasBuiltOutcomeBalance(savedProgramme,manifest.fingerprint)).toBe(true);
  const state = { cold:{ store:manifest, counts:{schema_version:'1',generator_version:manifest.generator_version,buildings:6,refusals:3,open_spaces:0} } };
  expect(urbanBuildingPanelEvidence(state as unknown as Parameters<typeof urbanBuildingPanelEvidence>[0])(savedProgramme)).toBe('outcomes_reconciled');
  expect(urbanBuildingPanelEvidence({ ...state, cold:{ ...state.cold, store:{...manifest,fingerprint:'changed'} } } as unknown as Parameters<typeof urbanBuildingPanelEvidence>[0])(savedProgramme)).toBe('not_calculated');
});

it('rejects duplicate/unallocated outcomes and keeps missing results explicitly unknown', () => {
  const balance=createBuiltOutcomeBalance(partitions()); balance.append(raw[0]);
  expect(()=>balance.append(raw[0])).toThrow('duplicated');
  const empty=createBuiltOutcomeBalance(partitions()).complete('no-outcomes');
  expect(report(empty).builtBalance!.demands.reduce((n,d)=>n+d.missing,0)).toBe(9);
  expect(report(empty).demands[0].deficit).toBe(900);
});

it('keeps actual Roman open-deficit declarations and their source reasons through compact reconciliation', () => {
  const f=structuredClone(deficitFixture) as unknown as { partitions:Partition[]; requests:PlacementRequest[]; scene:PlacementBatch };
  const scene=carryUrbanOpenDeficits(f.partitions,{...f.scene,generator_version:'architectural-plans-2',
    buildings:f.scene.buildings.map(b=>({...b,simplification:'architectural_plan'}))},f.requests);
  const p=reconcileCompactBuiltBalance(f.partitions,scene).flatMap(p=>p.programme?.demands??[]);
  expect(p.every(d=>d.builtCapacity===0&&d.deficit===d.requested)).toBe(true);
  for(const space of scene.open_spaces) if(space.deficit) expect(p.flatMap(d=>d.reasons).join('\n')).toContain(space.deficit.message);
  const changed=structuredClone(scene); changed.open_spaces.find(s=>s.deficit)!.deficit!.demand_id='different-demand';
  expect(()=>reconcileCompactBuiltBalance(f.partitions,changed)).toThrow('deficit differs');
});

it('reads an authenticated captured assembly header once; two physical members credit no household capacity', async () => {
  const batch=JSON.parse(parentFixture.data.batch_json) as NativeParentBatch;
  const source=parentRecordSource(batch.parents[0]), json=JSON.stringify({schema_version:batch.schema_version,
    generator_version:batch.generator_version,rows:[{kind:'parent',parent:source}],materials:batch.materials});
  const chunk:StoredParentChunk={index:0,json,sha256:await parentDigest(json),bytes:new TextEncoder().encode(json).byteLength,
    progress:{start:0,completed:1,total:1},nativeBatch:0,counts:batch.counts};
  const {json:_json,...descriptor}=chunk;
  const manifest:ParentSceneManifest={format:'urban-native-parent-chunks-1',sceneId:'actual-parent-header',sourceFingerprint:'a'.repeat(64),
    schema_version:batch.schema_version,generator_version:batch.generator_version,totalRequests:1,counts:batch.counts,
    chunks:[descriptor],boundaries:[{start:0,completed:1,inputBytes:1,floatSlots:0,rewrittenBytes:1,inputSha256:'a'.repeat(64)}],fingerprint:''};
  const {sceneId:_id,fingerprint:_fingerprint,...content}=manifest;manifest.fingerprint=await parentDigest(JSON.stringify(content));
  let reads=0;
  const backend={manifest:async()=>manifest,chunk:async()=>{reads++;return chunk;}} as unknown as ParentChunkBackend;
  const input=partitions();input[0].parcels=[{id:source.parcelId}] as Partition['parcels'];
  input[0].programme!.allocations=[{...input[0].programme!.allocations[0],parcelId:source.parcelId,demandId:'domestic',function:'domestic'}];
  const p=report(await reconcileParentBuiltBalance(input,backend,manifest.sceneId));
  expect(reads).toBe(1);expect(batch.counts.physical_members).toBe(2);
  expect(p.builtBalance!.demands[0].admittedUnknown).toBe(1);
  expect(p.demands[0]).toMatchObject({builtCapacity:0,deficit:900});
  const state={parent:{store:manifest}} as unknown as Parameters<typeof urbanBuildingPanelEvidence>[0];
  expect(urbanBuildingPanelEvidence(state)(JSON.parse(JSON.stringify(p)))).toBe('outcomes_reconciled');
});
