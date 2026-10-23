import { describe,expect,it } from 'vitest';
import { isFinalQualityDisplay,verifyFinalDisplay,verifyMotionLiveDisplay,verifyTourQuality,verifyViewSatisfaction } from '../scripts/surface_navigation_evidence';
function fixture(){
  const source={id:'registered-source',version:'actual-v1',sourceLODKnown:true,sourceLOD:-6,nativeSpacingM:.46875};
  const request={x:0,y:0,extent:64,resolution:128,preview:true};
  const display={worldId:'live-new',request,source,tileSource:{...source},sourceActualAtFocus:{...source},fineContributionWeight:1,sourceContributionsAtFocus:[{source:{...source},activeChild:true,weight:1}],focusInsideSource:true,liveSerial:5,appliedTickMs:1500,sourceEpoch:'source',sceneEpoch:'scene'};
  return{proof:{version:2,motionStartTickMs:1000,motionEndTickMs:2000,initial:{rendered:{liveSerial:4,worldId:'warmup'}},motionDisplayEvents:[display]},
    metrics:{renderEvents:[display],liveAcceptance:[{worldId:'live-new',request,requestSerial:5,tickMs:1200,sourceEpoch:'source',sceneEpoch:'scene'}],discardedPreparations:{oldEpoch:0,newerPacket:2}}};
}
describe('rendered live evidence during motion',()=>{
  it('accepts a source-known application independently linked to a fresh accepted world',()=>{const{proof,metrics}=fixture();expect(verifyMotionLiveDisplay(proof,metrics).displayedLiveWorlds).toHaveLength(1);});
  it('rejects the former false positive: old geometry redrawn while newer data is accepted',()=>{const{proof,metrics}=fixture();proof.motionDisplayEvents[0]={...proof.motionDisplayEvents[0],worldId:'warmup-parent',liveSerial:4};
    expect(()=>verifyMotionLiveDisplay(proof,metrics)).toThrow(/actually rendered/);});
  it('rejects render applications after motion, before fresh acceptance, at unknown LOD or wrong epoch',()=>{
    for(const alter of [(v:any)=>v.proof.motionDisplayEvents[0].appliedTickMs=2100,(v:any)=>v.metrics.liveAcceptance[0].tickMs=1700,
      (v:any)=>v.proof.motionDisplayEvents[0].source.sourceLODKnown=false,(v:any)=>v.metrics.liveAcceptance[0].sceneEpoch='edited',
      (v:any)=>v.proof.motionDisplayEvents[0].focusInsideSource=false,(v:any)=>delete v.proof.motionDisplayEvents[0].focusInsideSource,
      (v:any)=>v.proof.motionDisplayEvents[0].fineContributionWeight=.5,(v:any)=>v.proof.motionDisplayEvents[0].sourceActualAtFocus.sourceLOD=0,
      (v:any)=>v.proof.motionDisplayEvents[0].sourceContributionsAtFocus[0].weight=.7,
      (v:any)=>v.metrics.renderEvents=[],(v:any)=>v.metrics.liveAcceptance[0].tickMs=900]){const v=fixture();alter(v);expect(()=>verifyMotionLiveDisplay(v.proof,v.metrics)).toThrow();}
  });
  it('requires the versioned production display ledger and discard counts rather than summary booleans',()=>{
    const{proof,metrics}=fixture();expect(()=>verifyMotionLiveDisplay({...proof,version:1},metrics)).toThrow(/Missing/);
    expect(()=>verifyMotionLiveDisplay({...proof,sourceReplacedWhileMoving:true},{...metrics,renderEvents:[]})).toThrow();
    expect(()=>verifyMotionLiveDisplay(proof,{...metrics,discardedPreparations:undefined})).toThrow(/counters/);
  });
  it('accepts a documented fine-dominant feather but rejects a coarse source labelled as a fine tile',()=>{
    const{proof,metrics}=fixture(),display=proof.motionDisplayEvents[0];display.fineContributionWeight=.75;
    display.sourceContributionsAtFocus=[{source:{...display.source},activeChild:true,weight:.75},{source:{...display.source,sourceLOD:0,nativeSpacingM:30},activeChild:false,weight:.25}];
    expect(verifyMotionLiveDisplay(proof,metrics).displayedLiveWorlds).toHaveLength(1);
    display.source.nativeSpacingM=30;expect(()=>verifyMotionLiveDisplay(proof,metrics)).toThrow(/actually rendered/);
  });
  it('rejects a fresh accepted serial that merely redisplays the warmup world or hides its preview quality',()=>{
    for(const alter of [(v:any)=>v.proof.initial.rendered.worldId='live-new',(v:any)=>v.proof.motionDisplayEvents[0].request.preview=false,
      (v:any)=>v.proof.motionDisplayEvents[0].request.resolution=512,(v:any)=>v.metrics.liveAcceptance[0].request={preview:true,resolution:128,x:1,y:0,extent:64}]){
      const v=fixture();alter(v);expect(()=>verifyMotionLiveDisplay(v.proof,v.metrics)).toThrow();
    }
  });
  it('requires actual settled final quality512 without changing the authoritative source output grid',()=>{
    const{proof,metrics}=fixture(),display={...proof.motionDisplayEvents[0],request:{x:0,y:0,extent:64,resolution:512,preview:false},deliveredGrid:{width:137,height:137,spacingM:64/137}};
    const viewSatisfaction={serial:9,worldId:display.worldId,requestSerial:display.liveSerial,preview:false,requiredSpacingM:.46875,deliveredSpacingM:.46875,
      sourceBounds:{minX:0,minZ:0,maxX:64,maxZ:64},viewBounds:{minX:20,minZ:20,maxX:44,maxZ:44}};
    const finalProof={...proof,finalReady:true,final:{rendered:display,viewSatisfiedSerial:9,liveSerial:9,viewSatisfaction}},finalMetrics={...metrics,renderedSnapshot:display,viewSatisfiedSerial:9,viewSatisfaction};
    expect(verifyFinalDisplay(finalProof,finalMetrics)).toBe(display);expect(isFinalQualityDisplay(display)).toBe(true);
    expect(()=>verifyFinalDisplay({...finalProof,final:{...finalProof.final,rendered:{...display,request:{...display.request,preview:true}}}},finalMetrics)).toThrow(/final/);
    expect(()=>verifyFinalDisplay({...finalProof,final:{...finalProof.final,viewSatisfiedSerial:8}},finalMetrics)).toThrow(/final/);
  });
  it('allows real final-source cache reuse across seven increasing camera satisfactions without claiming fresh acceptance',()=>{
    const{proof}=fixture(),display={...proof.motionDisplayEvents[0],request:{x:0,y:0,extent:64,resolution:512,preview:false}};
    const captures=Array.from({length:7},(_,i)=>({renderedSnapshot:display,viewSatisfiedSerial:10+i,viewSatisfaction:{serial:10+i,worldId:display.worldId,
      requestSerial:display.liveSerial,preview:false,requiredSpacingM:.46875,deliveredSpacingM:.46875,
      sourceBounds:{minX:0,minZ:0,maxX:64,maxZ:64},viewBounds:{minX:20,minZ:20,maxX:44-i,maxZ:44-i}}}));
    expect(verifyTourQuality(captures)).toHaveLength(7);
    expect(verifyViewSatisfaction(captures[0].viewSatisfaction,display)).toBe(captures[0].viewSatisfaction);
    const physicalCap={...captures[0].viewSatisfaction,region:{extent:64,preview:false,resolution:512}};
    expect(verifyViewSatisfaction(physicalCap,display)).toBe(physicalCap);
    expect(()=>verifyViewSatisfaction({...physicalCap,requiredSpacingM:1},display)).toThrow(/density target/);
    for(const alter of [(v:any)=>v[1].viewSatisfaction.serial=10,(v:any)=>v[1].viewSatisfaction.worldId='other',
      (v:any)=>v[1].viewSatisfaction.deliveredSpacingM=.5,(v:any)=>v[1].viewSatisfaction.sourceBounds.maxX=40,
      (v:any)=>v[1].viewSatisfiedSerial=999,(v:any)=>v[1].viewSatisfaction.preview=true,
      (v:any)=>v[1].viewSatisfaction.viewBounds.minX=NaN]){const copy=structuredClone(captures);alter(copy);expect(()=>verifyTourQuality(copy)).toThrow();}
    expect(()=>verifyTourQuality(captures.slice(1))).toThrow();
  });
});
