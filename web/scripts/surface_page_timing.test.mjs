import test from'node:test';import assert from'node:assert/strict';import vm from'node:vm';import{installSurfacePageTiming}from'./surface_page_timing.mjs';
function setup(fetch=async()=>Response.json({accepted:true,received:16})){let tick=0;class NativeWorker extends EventTarget{postMessage(...args){this.sent=args;}}class NativeEventSource extends EventTarget{constructor(url){super();this.url=url;}}const window={Worker:NativeWorker,EventSource:NativeEventSource,fetch};const context={window,performance:{now:()=>++tick,timeOrigin:123456},URL,location:{href:'http://localhost/'},Headers,Request,ArrayBuffer};vm.runInNewContext('('+installSurfacePageTiming.toString()+')()',context);return window;}
test('page clock records worker and HTTP milestones without cloning transferred buffers or acknowledgement',async()=>{const window=setup(),worker=new window.Worker('/surfaceCompiler.worker.ts'),binary=new ArrayBuffer(16);const message={kind:'compile',requestId:7,binary};worker.postMessage(message,[binary]);assert.equal(worker.sent[0],message);assert.equal(worker.sent[1][0],binary);worker.dispatchEvent(new MessageEvent('message',{data:{kind:'compiled',requestId:7,binary}}));const response=await window.fetch('/surface-live/reply/job',{method:'POST',headers:{'X-Surface-Offset':'0','X-Surface-Total':'16'},body:new Uint8Array(binary)});assert.deepEqual(await response.json(),{accepted:true,received:16});const result=window.__surfacePageTimingSnapshot();assert.deepEqual(Array.from(result.events,e=>e.phase),['worker-post','worker-received','upload-start','upload-headers','upload-ack']);assert.equal(result.events[1].binaryBytes,16);assert.equal(result.clock,'page-performance-now');assert.equal(result.timeOriginMs,123456);assert.ok(JSON.stringify(result).length<2048);});
test('timing history is bounded even when a session emits more events',()=>{const window=setup(),worker=new window.Worker('/worker');for(let i=0;i<5000;i++)worker.postMessage({kind:'compile',requestId:i});const result=window.__surfacePageTimingSnapshot();assert.equal(result.events.length,4096);assert.equal(result.dropped,904);});
test('SSE producer receipt precedes its ordinary listener without replacing the event',()=>{
  const window=setup(),source=new window.EventSource('/surface-live/events'),region={x:12,y:30,extent:64,resolution:128,preview:true};
  const event=new MessageEvent('terrain',{data:JSON.stringify({id:'job',region})});let received;
  source.addEventListener('terrain',value=>{received=value;assert.equal(window.__surfacePageTimingSnapshot().events[0].phase,'terrain-request');});
  source.dispatchEvent(event);assert.equal(received,event);
  source.dispatchEvent(new MessageEvent('cancel',{data:JSON.stringify({id:'job'})}));
  const result=JSON.parse(JSON.stringify(window.__surfacePageTimingSnapshot()));
  assert.equal(result.version,'surface-page-timing-2');assert.deepEqual(result.events.map(value=>value.phase),['terrain-request','terrain-cancel']);assert.deepEqual(result.events[0].region,region);
  new window.EventSource('/other').dispatchEvent(event);assert.equal(window.__surfacePageTimingSnapshot().events.length,2);
  source.dispatchEvent(new MessageEvent('terrain',{data:'invalid JSON'}));assert.equal(window.__surfacePageTimingSnapshot().events.length,2);
});
test('refinement body is read only on demand, returns the original buffer and preserves fetch arguments',async()=>{
  const buffer=new Float32Array([1,2,3,4]).buffer;let reads=0,called;
  const response={status:200,arrayBuffer:async()=>{reads++;return buffer;}};
  const window=setup(async(...args)=>{called=args;return response;});
  const init={method:'POST',body:JSON.stringify({id:'registration',x:1,y:2,width:40,resolution:128})};
  const actual=await window.fetch('http://neural/refinement/tile',init);
  assert.equal(actual,response);assert.equal(called[1],init);assert.equal(reads,0);
  assert.equal(await actual.arrayBuffer(),buffer);assert.equal(reads,1);
  const events=JSON.parse(JSON.stringify(window.__surfacePageTimingSnapshot())).events;
  assert.deepEqual(events.map(value=>value.phase),['refinement-start','refinement-headers','refinement-body']);
  assert.deepEqual(events[0].region,{x:1,y:2,width:40,resolution:128});assert.equal(events[2].bytes,16);assert.equal(events[2].registrationId,'registration');
});
test('refinement errors keep their identity and register diagnostics never inspect source arrays',async()=>{
  const error=new DOMException('stopped','AbortError'),window=setup(async()=>{throw error;});
  await assert.rejects(window.fetch('/refinement/tile',{body:'invalid'}),value=>value===error);
  assert.equal(window.__surfacePageTimingSnapshot().events[1].name,'AbortError');
  let reads=0;const response={status:200,arrayBuffer:async()=>{reads++;throw error;}};
  const bodyWindow=setup(async()=>response);await bodyWindow.fetch('/refinement/tile');
  await assert.rejects(response.arrayBuffer(),value=>value===error);assert.equal(reads,1);
  assert.equal(bodyWindow.__surfacePageTimingSnapshot().events[2].phase,'refinement-body-error');
  const registerWindow=setup(async()=>Response.json({id:'registered'}));
  const registration=await registerWindow.fetch('/refinement/register',{body:JSON.stringify({heights:'sensitive-source-array'.repeat(10000)})});
  assert.deepEqual(await registration.json(),{id:'registered'});
  const snapshot=registerWindow.__surfacePageTimingSnapshot();assert.equal(snapshot.events.length,2);assert.ok(JSON.stringify(snapshot).length<1024);assert.ok(!JSON.stringify(snapshot).includes('sensitive-source-array'));
});
