type Row=Record<string,any>;
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Godot's default JSON output rounds binary64 values to decimal text. Compare
 * the actual grid spacing across that boundary without requiring bit identity. */
export const sameDeliveredSpacing=(actual:unknown,expected:unknown):boolean=>typeof actual==='number'&&typeof expected==='number'
  &&Number.isFinite(actual)&&Number.isFinite(expected)&&actual>0&&expected>0&&Math.abs(actual-expected)<=1e-12*Math.max(1,Math.abs(expected));
const sourceMatches=(a:unknown,b:unknown):boolean=>record(a)&&record(b)&&['id','version','sourceLOD','nativeSpacingM','sourceLODKnown'].every(key=>a[key]===b[key]);
export const isDominantFineDisplay=(v:unknown):v is Row=>record(v)&&typeof v.worldId==='string'&&!!v.worldId&&record(v.source)
  &&v.source.sourceLODKnown===true&&v.focusInsideSource===true&&typeof v.source.id==='string'&&!!v.source.id&&typeof v.source.version==='string'&&!!v.source.version
  &&Number.isFinite(v.source.sourceLOD)&&Number.isFinite(v.source.nativeSpacingM)&&v.source.nativeSpacingM>0&&sourceMatches(v.source,v.tileSource)&&sourceMatches(v.source,v.sourceActualAtFocus)
  &&Number.isFinite(v.fineContributionWeight)&&v.fineContributionWeight>.5&&v.fineContributionWeight<=1
  &&Array.isArray(v.sourceContributionsAtFocus)&&v.sourceContributionsAtFocus.length>0
  &&v.sourceContributionsAtFocus.every((c:unknown)=>record(c)&&Number.isFinite(c.weight)&&c.weight>=0&&c.weight<=1&&record(c.source)&&typeof c.activeChild==='boolean')
  &&Math.abs(v.sourceContributionsAtFocus.reduce((sum:number,c:Row)=>sum+c.weight,0)-1)<1e-6
  &&Math.abs(v.sourceContributionsAtFocus.reduce((sum:number,c:Row)=>sum+(c.activeChild?c.weight:0),0)-v.fineContributionWeight)<1e-6
  &&v.sourceContributionsAtFocus.every((c:Row)=>!c.activeChild||sourceMatches(c.source,v.tileSource))
  &&Number.isSafeInteger(v.liveSerial)&&Number.isSafeInteger(v.appliedTickMs)&&typeof v.sourceEpoch==='string'&&!!v.sourceEpoch&&typeof v.sceneEpoch==='string'&&!!v.sceneEpoch;
const hasQuality=(v:Row,preview:boolean,resolution:number):boolean=>record(v.request)&&v.request.preview===preview&&v.request.resolution===resolution
  &&Number.isFinite(v.request.x)&&Number.isFinite(v.request.y)&&Number.isFinite(v.request.extent)&&v.request.extent>0;
const sameRequest=(a:unknown,b:unknown):boolean=>record(a)&&record(b)&&['x','y','extent','resolution','preview'].every(key=>a[key]===b[key]);
/** These are requested quality levels. Delivered n/nativeSpacingM remain the
 * authoritative source output and may be capped by the provider near the camera. */
export const isInteractiveQualityDisplay=(v:unknown):v is Row=>isDominantFineDisplay(v)&&hasQuality(v,true,128);
export const isFinalQualityDisplay=(v:unknown):v is Row=>isDominantFineDisplay(v)&&hasQuality(v,false,512);

const validBounds=(b:unknown):b is Row=>record(b)&&['minX','minZ','maxX','maxZ'].every(k=>Number.isFinite(b[k]))&&b.maxX>b.minX&&b.maxZ>b.minZ;
/** A cached source satisfies a new camera only when its actual coverage and
 * delivered density suffice. This is deliberately separate from fresh acceptance. */
export function verifyViewSatisfaction(value:unknown,display:unknown):Row {
  if(!record(value)||!isFinalQualityDisplay(display)||!Number.isSafeInteger(value.serial)||value.serial<0
    ||value.worldId!==display.worldId||value.requestSerial!==display.liveSerial||value.preview!==false
    ||!validBounds(value.viewBounds)||!validBounds(value.sourceBounds)
    ||!Number.isFinite(value.requiredSpacingM)||value.requiredSpacingM<=0
    ||!Number.isFinite(value.deliveredSpacingM)||value.deliveredSpacingM<=0
    ||value.deliveredSpacingM>value.requiredSpacingM*(1+1e-9)
    ||Math.abs(value.sourceBounds.minX-display.request.x)>1e-7||Math.abs(value.sourceBounds.minZ-display.request.y)>1e-7
    ||Math.abs(value.sourceBounds.maxX-(display.request.x+display.request.extent))>1e-7
    ||Math.abs(value.sourceBounds.maxZ-(display.request.y+display.request.extent))>1e-7
    ||value.sourceBounds.minX>value.viewBounds.minX||value.sourceBounds.minZ>value.viewBounds.minZ
    ||value.sourceBounds.maxX<value.viewBounds.maxX||value.sourceBounds.maxZ<value.viewBounds.maxZ)
    throw new Error('Camera satisfaction lacks final source coverage or delivered density');
  const region=value.region;
  if(!record(region)||!Number.isFinite(region.x)||!Number.isFinite(region.y)||!Number.isFinite(region.extent)||region.extent<=0||region.preview!==false||region.resolution!==512
    ||Math.abs(value.requiredSpacingM-Math.max(region.extent/512,display.source.nativeSpacingM))>1e-7)
    throw new Error('Camera density target differs from the requested final quality or physical source cap');
  if(Math.abs(value.viewBounds.minX-region.x)>1e-7||Math.abs(value.viewBounds.minZ-region.y)>1e-7
    ||Math.abs(value.viewBounds.maxX-region.x-region.extent)>1e-7||Math.abs(value.viewBounds.maxZ-region.y-region.extent)>1e-7)
    throw new Error('Camera satisfaction bounds differ from the requested view region');
  return value;
}

export function verifyTourQuality(captures:unknown):Row[] {
  if(!Array.isArray(captures)||captures.length!==7)throw new Error('Expected seven final-quality tour captures');
  let previousRequest=-1,previousCamera=-1;
  return captures.map((capture:unknown)=>{
    if(!record(capture)||!isFinalQualityDisplay(capture.renderedSnapshot))throw new Error('Tour captured preview or missing final source');
    const display=capture.renderedSnapshot,satisfaction=verifyViewSatisfaction(capture.viewSatisfaction,display);
    if(display.liveSerial<previousRequest||satisfaction.serial<=previousCamera||capture.viewSatisfiedSerial!==satisfaction.serial)
      throw new Error('Tour camera satisfaction did not progress or source request regressed');
    previousRequest=display.liveSerial;previousCamera=satisfaction.serial;
    return satisfaction;
  });
}

/** Independently join the probe observations to production renderer applications
 * and fresh accepted packets. Acceptance alone or an old parent redraw cannot pass. */
export function verifyMotionLiveDisplay(proof:unknown,metrics:unknown):{displayedLiveWorlds:Row[];discardedPreparations:unknown} {
  if(!record(proof)||proof.version!==2||!record(metrics)||!Array.isArray(proof.motionDisplayEvents)||!Array.isArray(metrics.renderEvents)||!Array.isArray(metrics.liveAcceptance)
    ||!Number.isSafeInteger(proof.motionStartTickMs)||!Number.isSafeInteger(proof.motionEndTickMs)||proof.motionEndTickMs<=proof.motionStartTickMs
    ||!record(proof.initial)||!record(proof.initial.rendered)||!Number.isSafeInteger(proof.initial.rendered.liveSerial)
    ||typeof proof.initial.rendered.worldId!=='string'||!proof.initial.rendered.worldId)throw new Error('Missing authoritative rendered navigation evidence');
  const displayedLiveWorlds:Row[]=[];
  for(const display of proof.motionDisplayEvents){
    if(!isInteractiveQualityDisplay(display)||display.worldId===proof.initial.rendered.worldId||display.liveSerial<=proof.initial.rendered.liveSerial||display.appliedTickMs<=proof.motionStartTickMs||display.appliedTickMs>proof.motionEndTickMs)continue;
    const actual=metrics.renderEvents.some((e:unknown)=>isInteractiveQualityDisplay(e)&&sameRequest(e.request,display.request)&&e.worldId===display.worldId&&e.liveSerial===display.liveSerial&&e.appliedTickMs===display.appliedTickMs
      &&e.source.id===display.source.id&&e.source.version===display.source.version&&e.sourceEpoch===display.sourceEpoch&&e.sceneEpoch===display.sceneEpoch);
    const freshAccepted=metrics.liveAcceptance.some((e:unknown)=>record(e)&&Number.isSafeInteger(e.tickMs)&&e.tickMs>proof.motionStartTickMs&&e.tickMs<=display.appliedTickMs
      &&sameRequest(e.request,display.request)&&e.worldId===display.worldId&&e.requestSerial===display.liveSerial&&e.sourceEpoch===display.sourceEpoch&&e.sceneEpoch===display.sceneEpoch);
    if(actual&&freshAccepted)displayedLiveWorlds.push(display);
  }
  if(!displayedLiveWorlds.length)throw new Error('No fresh accepted live world was actually rendered during continuous input');
  if(!record(metrics.discardedPreparations))throw new Error('Missing discarded-preparation counters');
  return{displayedLiveWorlds,discardedPreparations:metrics.discardedPreparations};
}

export function verifyFinalDisplay(proof:unknown,metrics:unknown):Row {
  if(!record(proof)||!record(metrics)||proof.finalReady!==true||!record(proof.final)||!isFinalQualityDisplay(proof.final.rendered)
    ||!isFinalQualityDisplay(metrics.renderedSnapshot)||proof.final.rendered.worldId!==metrics.renderedSnapshot.worldId
    ||!sameRequest(proof.final.rendered.request,metrics.renderedSnapshot.request)
    ||!Number.isSafeInteger(proof.final.viewSatisfiedSerial)||proof.final.viewSatisfiedSerial!==proof.final.liveSerial
    ||metrics.viewSatisfiedSerial!==proof.final.viewSatisfiedSerial)throw new Error('Settled navigation did not display final requested quality512 without preview');
  const satisfied=verifyViewSatisfaction(proof.final.viewSatisfaction,proof.final.rendered);
  const finalMetric=verifyViewSatisfaction(metrics.viewSatisfaction,metrics.renderedSnapshot);
  if(satisfied.serial!==proof.final.viewSatisfiedSerial||finalMetric.serial!==satisfied.serial)throw new Error('Settled view satisfaction did not match camera serial');
  return proof.final.rendered;
}
