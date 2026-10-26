import{describe,it,expect,vi}from'vitest';
import{handleSurfaceWorkerWithTiming}from'../src/surface/workerTiming';
import{createSurfaceWorkerProcessor}from'../src/surface/workerProcessor';
import{SURFACE_WORKER_PROTOCOL,type SurfaceWorkerRequest,type SurfaceWorkerResponse,type PreparedSurfaceWorkerSource}from'../src/surface/workerProtocol';

const routing={protocol:SURFACE_WORKER_PROTOCOL,sessionId:'clock-proof',sourceEpoch:'s1',sceneEpoch:'scene1'};
function fixture(){
  const terrain={width:5,height:5,spacingM:20,originX:10,originZ:10,heights:new Float32Array(25).fill(100),source:{id:'source',version:'v1',sourceLOD:0,nativeSpacingM:20}};
  const source:PreparedSurfaceWorkerSource={input:{seed:17,terrain},providerId:'fixture'};
  const initialize:SurfaceWorkerRequest={...routing,kind:'initialize',payload:source};
  const compile:SurfaceWorkerRequest={...routing,kind:'compile',requestId:1,terrain,region:{x:0,y:0,extent:100,resolution:5}};
  return{initialize,compile,processor:()=>createSurfaceWorkerProcessor(value=>value as PreparedSurfaceWorkerSource)};
}
describe('opt-in synchronous Worker processor timing',()=>{
  it('keeps ordinary responses and clocks untouched when diagnostics are absent or the message initializes',()=>{
    const{initialize,compile,processor}=fixture(),p=processor(),now=vi.fn(()=>5),clock={now,timeOrigin:1000};
    const init=handleSurfaceWorkerWithTiming(p,initialize,clock);expect(init.processorTiming).toBeUndefined();
    expect(handleSurfaceWorkerWithTiming(p,compile,clock).processorTiming).toBeUndefined();expect(now).not.toHaveBeenCalled();
  });
  it('adds only a structured response envelope while keeping the actual compiled binary byte-identical',()=>{
    const{initialize,compile,processor}=fixture(),plain=processor(),timed=processor();plain.handle(initialize);timed.handle(initialize);
    const baseline=plain.handle(compile),clock={timeOrigin:1700000000000,now:vi.fn().mockReturnValueOnce(20).mockReturnValueOnce(27.5)};
    const result=handleSurfaceWorkerWithTiming(timed,{...compile,diagnosticTiming:true} as SurfaceWorkerRequest,clock);
    expect(result.kind).toBe('compiled');if(result.kind!=='compiled'||baseline.kind!=='compiled')throw Error('Expected real compiled fixture');
    expect(Buffer.from(result.binary).equals(Buffer.from(baseline.binary))).toBe(true);
    const{processorTiming,...rest}=result;expect(rest).toEqual(baseline);
    expect(processorTiming).toEqual({version:'surface-worker-processor-timing-1',timeOriginMs:1700000000000,startNowMs:20,finishNowMs:27.5,synchronousMs:7.5,startedUtcMs:1700000000020,finishedUtcMs:1700000000027.5});
    expect(clock.now).toHaveBeenCalledTimes(2);
  });
  it('times an error response without creating/changing its payload or swallowing a thrown processor failure',()=>{
    const{compile}=fixture(),response:SurfaceWorkerResponse={...routing,kind:'error',requestId:1,error:{name:'Error',message:'fixture failure'}};
    const clock={timeOrigin:1000,now:vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(3)};
    const result=handleSurfaceWorkerWithTiming({handle:()=>response},{...compile,diagnosticTiming:true} as SurfaceWorkerRequest,clock);
    if(result.kind!=='error')throw Error('Expected diagnostic error envelope');
    expect(result.error).toBe(response.error);expect(result.processorTiming?.synchronousMs).toBe(2);
    expect(()=>handleSurfaceWorkerWithTiming({handle:()=>{throw Error('unexpected');}},{...compile,diagnosticTiming:true} as SurfaceWorkerRequest)).toThrow('unexpected');
  });
});
