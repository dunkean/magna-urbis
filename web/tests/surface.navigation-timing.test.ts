import {describe,it,expect} from 'vitest';
import {verifyNavigationTiming,verifyMotionLiveDisplay} from '../scripts/surface_navigation_evidence';

function stalled(){
  return {version:2,timingVersion:'navigation-timing-1',continuousSeconds:20,motionStartTickMs:105262,motionEndTickMs:125262,actualMotionEndTickMs:132277,
    motionActualWallSeconds:27.015,inputSamples:[0,4.511,15.06,18.091].map(elapsedSeconds=>({elapsedSeconds})),
    lastInputElapsedSeconds:18.091,terminalInputGapSeconds:8.924,maximumInputGapSeconds:10.549,
    maximumInputGapInterval:{fromElapsedSeconds:4.511,toElapsedSeconds:15.06,gapSeconds:10.549,terminal:false},
    motionApplications:[{elapsedSeconds:1.236},{elapsedSeconds:15.869}],motionApplicationCount:2,longestMotionApplicationGapSeconds:14.633,
    initial:{liveAcceptedSerial:0,liveAppliedSerial:0},motionEnd:{elapsedSeconds:27.015,liveAcceptedSerial:90,liveAppliedSerial:90},
    drainSeconds:8.741,final:{elapsedSeconds:35.756,liveAcceptedSerial:129,liveAppliedSerial:129},
    liveAcceptance:[{tickMs:80086},{tickMs:121222},{tickMs:132206},{tickMs:134792}],motionLiveAcceptedCount:1,motionActualLiveAcceptedCount:2,motionLiveApplicationCount:1,
    counterSemantics:{version:'navigation-counters-1'},compatibilityAliases:{'snapshot.liveAppliedSerial':'snapshot.liveAcceptedSerial',motionLiveApplicationCount:'motionLiveAcceptedCount'}};
}
describe('honest nominal and actual navigation intervals',()=>{
  it('includes the second8.924s terminal stall without extending the nominal20s qualification window',()=>{
    const proof=stalled(),v=verifyNavigationTiming(proof,20);
    expect(v.actualDurationSeconds).toBe(27.015);expect(v.terminalInputGapSeconds).toBeCloseTo(8.924,12);
    expect(v.maximumInputGapSeconds).toBeCloseTo(10.549,12);expect(v.motionAcceptedCount).toBe(1);expect(v.motionActualAcceptedCount).toBe(2);
    expect(proof.motionEndTickMs-proof.motionStartTickMs).toBe(20000);
  });
  it('rejects a formerly hidden terminal stall even when the first maximum gap is still reported correctly',()=>{
    const proof=stalled();proof.terminalInputGapSeconds=20-18.091;
    expect(()=>verifyNavigationTiming(proof,20)).toThrow(/terminal interval/);
    proof.terminalInputGapSeconds=8.924;proof.motionEnd.elapsedSeconds=20;
    expect(()=>verifyNavigationTiming(proof,20)).toThrow(/hide the actual/);
  });
  it('reports a terminal gap larger than all earlier samples and rejects truncating its maximum at nominal duration',()=>{
    const proof=stalled();proof.lastInputElapsedSeconds=19.8;
    // A separate dense-input fixture makes the terminal interval the maximum.
    proof.inputSamples=Array.from({length:199},(_,i)=>({elapsedSeconds:i/10}));proof.terminalInputGapSeconds=7.215;
    proof.maximumInputGapSeconds=7.215;proof.maximumInputGapInterval={fromElapsedSeconds:19.8,toElapsedSeconds:27.015,gapSeconds:7.215,terminal:true};
    expect(verifyNavigationTiming(proof).maximumInputGapInterval.terminal).toBe(true);
    proof.maximumInputGapSeconds=.2;expect(()=>verifyNavigationTiming(proof)).toThrow(/terminal interval/);
  });
  it('rejects forged clocks, out-of-order samples, undeclared aliases and acceptance counts presented as applications',()=>{
    for(const alter of [(v:any)=>delete v.actualMotionEndTickMs,(v:any)=>v.actualMotionEndTickMs=125261,(v:any)=>v.motionActualWallSeconds=20,
      (v:any)=>v.motionEndTickMs=v.actualMotionEndTickMs,(v:any)=>v.continuousSeconds=27.015,(v:any)=>v.inputSamples.reverse(),
      (v:any)=>v.inputSamples[1].elapsedSeconds=NaN,(v:any)=>v.maximumInputGapInterval.terminal=true,
      (v:any)=>delete v.compatibilityAliases,(v:any)=>v.motionLiveAcceptedCount=2,(v:any)=>v.motionLiveApplicationCount=0,
      (v:any)=>v.motionEnd.liveAppliedSerial=37,(v:any)=>v.final.elapsedSeconds=28.741]){
      const proof=stalled();alter(proof);expect(()=>verifyNavigationTiming(proof,20)).toThrow();
    }
  });
  it('does not turn truthful acceptance diagnostics into proof that a new world was actually rendered',()=>{
    const proof=stalled();expect(verifyNavigationTiming(proof,20).motionAcceptedCount).toBe(1);
    expect(()=>verifyMotionLiveDisplay({...proof,initial:{...proof.initial,rendered:{worldId:'warmup',liveSerial:0}},motionDisplayEvents:[]},
      {renderEvents:[],liveAcceptance:proof.liveAcceptance,discardedPreparations:{}})).toThrow(/actually rendered/);
  });
  it('rejects a genuine fine preview displayed only after20s even when it falls inside the measured actual input interval',()=>{
    const source={id:'source',version:'v1',sourceLODKnown:true,sourceLOD:-6,nativeSpacingM:.46875},request={x:0,y:0,extent:64,resolution:128,preview:true};
    const display={worldId:'new',liveSerial:37,appliedTickMs:127262,source,tileSource:source,sourceActualAtFocus:source,focusInsideSource:true,
      fineContributionWeight:1,sourceContributionsAtFocus:[{source,activeChild:true,weight:1}],sourceEpoch:'s',sceneEpoch:'scene',request};
    const proof=stalled(),acceptance={worldId:'new',requestSerial:37,tickMs:121222,request,sourceEpoch:'s',sceneEpoch:'scene'};
    expect(display.appliedTickMs).toBeLessThan(proof.actualMotionEndTickMs);
    expect(()=>verifyMotionLiveDisplay({...proof,initial:{...proof.initial,rendered:{worldId:'warmup',liveSerial:0}},motionDisplayEvents:[display],motionLiveDisplayCount:1,sourceReplacedWhileMoving:true},
      {renderEvents:[display],liveAcceptance:[acceptance],discardedPreparations:{}})).toThrow(/actually rendered/);
  });
});
