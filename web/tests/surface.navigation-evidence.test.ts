import { describe,expect,it } from 'vitest';
import { verifyMotionLiveDisplay } from '../scripts/surface_navigation_evidence';
function fixture(){
  const display={worldId:'live-new',source:{id:'registered-source',version:'actual-v1',sourceLODKnown:true},liveSerial:5,appliedTickMs:1500,sourceEpoch:'source',sceneEpoch:'scene'};
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
      (v:any)=>v.metrics.renderEvents=[],(v:any)=>v.metrics.liveAcceptance[0].tickMs=900]){const v=fixture();alter(v);expect(()=>verifyMotionLiveDisplay(v.proof,v.metrics)).toThrow();}
  });
  it('requires the versioned production display ledger and discard counts rather than summary booleans',()=>{
    const{proof,metrics}=fixture();expect(()=>verifyMotionLiveDisplay({...proof,version:1},metrics)).toThrow(/Missing/);
    expect(()=>verifyMotionLiveDisplay({...proof,sourceReplacedWhileMoving:true},{...metrics,renderEvents:[]})).toThrow();
    expect(()=>verifyMotionLiveDisplay(proof,{...metrics,discardedPreparations:undefined})).toThrow(/counters/);
  });
});
