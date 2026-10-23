import { describe,expect,it } from 'vitest';
import { verifyMotionLiveDisplay } from '../scripts/surface_navigation_evidence';
function fixture(){
  const source={id:'registered-source',version:'actual-v1',sourceLODKnown:true,sourceLOD:-6,nativeSpacingM:.46875};
  const display={worldId:'live-new',source,tileSource:{...source},sourceActualAtFocus:{...source},fineContributionWeight:1,sourceContributionsAtFocus:[{source:{...source},activeChild:true,weight:1}],focusInsideSource:true,liveSerial:5,appliedTickMs:1500,sourceEpoch:'source',sceneEpoch:'scene'};
  return{proof:{version:2,motionStartTickMs:1000,motionEndTickMs:2000,initial:{rendered:{liveSerial:4}},motionDisplayEvents:[display]},
    metrics:{renderEvents:[display],liveAcceptance:[{worldId:'live-new',requestSerial:5,tickMs:1200,sourceEpoch:'source',sceneEpoch:'scene'}],discardedPreparations:{oldEpoch:0,newerPacket:2}}};
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
});
