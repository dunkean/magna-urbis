/** Self-contained Playwright init script. Store small monotonic PAGE events
 * locally; Node/CDP receipt time is a separate observation clock. */
export function installSurfacePageTiming() {
  const limit=4096,events=[];let dropped=0,sequence=0;
  const short=value=>typeof value==='string'?value.slice(0,256):undefined;
  const record=(phase,data={})=>{if(events.length>=limit){dropped++;return;}events.push({sequence:++sequence,phase,atMs:performance.now(),...data});};
  window.__surfacePageTimingSnapshot=()=>({version:'surface-page-timing-1',clock:'page-performance-now',timeOriginMs:performance.timeOrigin,limit,dropped,events:events.slice()});
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker {
    constructor(...args){super(...args);this.surfaceTimingURL=String(args[0]).slice(0,256);this.addEventListener('message',event=>{const m=event.data;if(m?.kind==='compiled'||m?.kind==='error')record('worker-received',{kind:m.kind,requestId:m.requestId,workerURL:this.surfaceTimingURL,binaryBytes:m.binary instanceof ArrayBuffer?m.binary.byteLength:undefined});});}
    postMessage(...args){const m=args[0];if(m?.kind==='compile'||m?.kind==='initialize')record('worker-post',{kind:m.kind,requestId:m.requestId,workerURL:this.surfaceTimingURL});return super.postMessage(...args);}
  };
  const nativeFetch=window.fetch.bind(window);
  window.fetch=(...args)=>{
    const[input,init]=args;let url;try{url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);}catch{return nativeFetch(...args);}
    if(!url.pathname.startsWith('/surface-live/reply/'))return nativeFetch(...args);
    const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
    const request={id:url.pathname.split('/').at(-1),offset:headers.get('X-Surface-Offset'),total:headers.get('X-Surface-Total'),method:init?.method??(input instanceof Request?input.method:'GET')};
    record('upload-start',request);
    return nativeFetch(...args).then(response=>{
      record('upload-headers',{...request,status:response.status});
      const json=response.json.bind(response);
      response.json=async()=>{try{const acknowledgement=await json();record('upload-ack',{...request,status:response.status,accepted:acknowledgement?.accepted,received:acknowledgement?.received});return acknowledgement;}catch(error){record('upload-ack-error',{...request,name:short(error?.name)});throw error;}};
      return response;
    },error=>{record('upload-error',{...request,name:short(error?.name)});throw error;});
  };
  if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
    const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())record('page-long-task',{startMs:entry.startTime,durationMs:entry.duration});});observer.observe({type:'longtask',buffered:true});
  }
}
