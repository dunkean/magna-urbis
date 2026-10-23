import { fingerprint } from './compiler';
import { sampleTerrainHeight } from './heightSampling';
import { DEFAULT_ROCK_UNITS } from './materials';
import { assertNotAborted, type GeologyInput, type RockUnit, type TerrainGrid } from './model';

export interface Stratum {
  readonly name: string; readonly unitId: number;
  /** True thickness along the plane normal; null ONLY for the final open cap. */
  readonly thicknessM: number | null;
}
export interface TiltedStrataScenario {
  readonly format: 'surface-geology-scenario'; readonly version: 1; readonly id: 'tilted-strata-v1';
  readonly originX: number; readonly originZ: number; readonly basalContactElevationM: number;
  /** Strike along a bedding contour, radians +X toward +Z. Dip is toward strike+pi/2. */
  readonly strikeRadians: number; readonly dipRadians: number;
  readonly basementUnitId: number; readonly strata: readonly Stratum[]; readonly units: readonly RockUnit[];
  readonly provenance: string;
}
export type ScenarioGeologyInput = GeologyInput & { scenario: TiltedStrataScenario };

/** Authored demonstration only, not inferred geology or a geological survey.
 * Choose its anchor ONCE in world coordinates and retain this same descriptor
 * for every tile, zoom and serialization. It never modifies terrain heights. */
export function createTiltedStrataScenario(options: Partial<Pick<TiltedStrataScenario,
  'originX'|'originZ'|'basalContactElevationM'|'strikeRadians'|'dipRadians'|'basementUnitId'|'strata'|'units'|'provenance'>> = {}): TiltedStrataScenario {
  const strikeRadians=options.strikeRadians??35*Math.PI/180;
  const scenario: TiltedStrataScenario={format:'surface-geology-scenario',version:1,id:'tilted-strata-v1',
    originX:options.originX??0,originZ:options.originZ??0,basalContactElevationM:options.basalContactElevationM??0,
    strikeRadians,dipRadians:options.dipRadians??8*Math.PI/180,basementUnitId:options.basementUnitId??1,
    strata:structuredClone(options.strata??[{name:'Lower quartz sandstone',unitId:3,thicknessM:120},
      {name:'Carbonate beds',unitId:2,thicknessM:80},{name:'Open marl cap',unitId:4,thicknessM:null}]),
    units:structuredClone(options.units??DEFAULT_ROCK_UNITS.filter(unit=>unit.id<=4)).map(unit=>({...unit,strikeRadians})),
    provenance:options.provenance??'Explicit authored tilted-strata-v1 demonstration: parallel physical beds over granite; no observed geology, climate inference or parent-colour noise claimed.'};
  validateGeologyScenario(scenario);return scenario;
}

export function validateGeologyScenario(value: unknown): asserts value is TiltedStrataScenario {
  const s=value as TiltedStrataScenario;
  if(!s||s.format!=='surface-geology-scenario'||s.version!==1||s.id!=='tilted-strata-v1'
    ||![s.originX,s.originZ,s.basalContactElevationM,s.strikeRadians,s.dipRadians].every(Number.isFinite)
    ||s.dipRadians<0||s.dipRadians>=Math.PI/2||typeof s.provenance!=='string'||!s.provenance.trim()
    ||!Array.isArray(s.units)||!s.units.length||s.units.length>65536||!Array.isArray(s.strata)||!s.strata.length)throw new Error('Invalid explicit tilted-strata scenario');
  const ids=new Set<number>(),lithologies=['granite','limestone','sandstone','mudstone','basalt'];
  for(const unit of s.units){
    if(!unit||!Number.isInteger(unit.id)||unit.id<0||unit.id>65535||ids.has(unit.id)||!lithologies.includes(unit.lithology)
      ||typeof unit.name!=='string'||!unit.name.trim()||![unit.sand,unit.silt,unit.clay,unit.hardness,unit.weatherability].every(n=>Number.isFinite(n)&&n>=0&&n<=1)
      ||Math.abs(unit.sand+unit.silt+unit.clay-1)>1e-5||!Number.isFinite(unit.strikeRadians)||!Array.isArray(unit.colorLinear)||unit.colorLinear.length!==3
      ||unit.colorLinear.some((n:number)=>!Number.isFinite(n)||n<0||n>1))throw new Error('Invalid scenario rock catalogue');
    ids.add(unit.id);
  }
  if(s.units.find(unit=>unit.id===s.basementUnitId)?.lithology!=='granite')throw new Error('tilted-strata-v1 requires an explicit granitic basement');
  for(let i=0;i<s.strata.length;i++){
    const layer=s.strata[i];
    if(!layer||!ids.has(layer.unitId)||typeof layer.name!=='string'||!layer.name.trim()
      ||(i===s.strata.length-1?layer.thicknessM!==null:!Number.isFinite(layer.thicknessM)||!(layer.thicknessM!>0)))throw new Error('Strata need positive normal thicknesses and exactly one final open cap');
  }
}

/** Signed distance above the basal plane, metres along its unit normal.
 * +q progresses through the stack. It depends on explicit position and actual
 * source elevation, never slope class, biome, camera or random values. */
export function stratumCoordinateM(s: TiltedStrataScenario,x:number,z:number,heightM:number):number {
  if(![x,z,heightM].every(Number.isFinite))throw new Error('Non-finite geological position');
  const across=(x-s.originX)*-Math.sin(s.strikeRadians)+(z-s.originZ)*Math.cos(s.strikeRadians);
  // Positive dip direction is DOWN the bedding plane, so its elevation falls
  // as across increases: h_contact=datum-across*tan(dip).
  return (heightM-s.basalContactElevationM)*Math.cos(s.dipRadians)+across*Math.sin(s.dipRadians);
}
/** Half-open intervals: a point exactly on a contact belongs to the upper bed. */
export function rockUnitAtScenario(s:TiltedStrataScenario,x:number,z:number,heightM:number):number {
  let q=stratumCoordinateM(s,x,z,heightM);if(q<0)return s.basementUnitId;
  for(const layer of s.strata){if(layer.thicknessM===null||q<layer.thicknessM)return layer.unitId;q-=layer.thicknessM;}
  throw new Error('Scenario is missing its required open cap');
}

export function geologyFromScenario(terrain:TerrainGrid,scenario:TiltedStrataScenario,options:{signal?:AbortSignal;memoryBudgetBytes?:number}={}):ScenarioGeologyInput {
  assertNotAborted(options.signal);validateGeologyScenario(scenario);
  const n=terrain.width*terrain.height;
  if(!Number.isSafeInteger(n)||!Number.isInteger(terrain.width)||!Number.isInteger(terrain.height)||terrain.width<2||terrain.height<2||!(terrain.heights instanceof Float32Array)||terrain.heights.length!==n
    ||![terrain.originX,terrain.originZ,terrain.spacingM].every(Number.isFinite)||terrain.spacingM<=0)throw new Error('Invalid source terrain for explicit geology scenario');
  if(n*2>(options.memoryBudgetBytes??128*1024*1024))throw new Error('Scenario bedrock exceeds memory budget before allocation');
  const bedrock=new Uint16Array(n);
  for(let i=0;i<n;i++){
    if(!(i%16384))assertNotAborted(options.signal);
    const x=terrain.originX+i%terrain.width*terrain.spacingM,z=terrain.originZ+Math.floor(i/terrain.width)*terrain.spacingM;
    bedrock[i]=rockUnitAtScenario(scenario,x,z,sampleTerrainHeight(terrain,x,z));
  }
  const retained=structuredClone(scenario);
  return {version:`tilted-strata-v1:${fingerprint(retained)}`,provenance:retained.provenance,units:structuredClone([...retained.units]),bedrock,scenario:retained};
}
