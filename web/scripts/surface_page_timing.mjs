/** Self-contained Playwright init script. Store small monotonic PAGE events
 * locally; Node/CDP receipt time is a separate observation clock. */
export function installSurfacePageTiming() {
  const limit=4096,events=[];let dropped=0,sequence=0;
  const short=value=>typeof value==='string'?value.slice(0,256):undefined;
  const numbers=(value,keys)=>Object.fromEntries(keys.filter(key=>Number.isFinite(value?.[key])).map(key=>[key,value[key]]));
  const record=(phase,data={})=>{if(events.length>=limit){dropped++;return;}events.push({sequence:++sequence,phase,atMs:performance.now(),...data});};
  window.__surfacePageTimingSnapshot=()=>({version:'surface-page-timing-2',clock:'page-performance-now',timeOriginMs:performance.timeOrigin,limit,dropped,events:events.slice()});
  // Observe the producer's own SSE receipt, rather than CDP's later receipt.
  // Never consume/replace its event or attach source arrays to diagnostics.
  const NativeEventSource=window.EventSource;
  if(typeof NativeEventSource==='function')window.EventSource=class extends NativeEventSource {
    constructor(...args){
      super(...args);
      let url;try{url=new URL(String(args[0]),location.href);}catch{return;}
      if(url.pathname!=='/surface-live/events')return;
      for(const name of ['terrain','cancel'])this.addEventListener(name,event=>{
        try{
          if(typeof event.data!=='string'||event.data.length>8192)return;
          const value=JSON.parse(event.data),region=value?.region;
          record(name==='terrain'?'terrain-request':'terrain-cancel',{id:short(value?.id),
            ...(name==='terrain'&&region?{region:{...numbers(region,['x','y','extent','resolution']),...(typeof region.preview==='boolean'?{preview:region.preview}:{})}}:{})});
        }catch{/* Diagnostics must not affect the ordinary handler. */}
      });
    }
  };
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker {
    constructor(...args){super(...args);this.surfaceTimingURL=String(args[0]).slice(0,256);this.addEventListener('message',event=>{const m=event.data;if(m?.kind==='compiled'||m?.kind==='error')record('worker-received',{kind:m.kind,requestId:m.requestId,workerURL:this.surfaceTimingURL,binaryBytes:m.binary instanceof ArrayBuffer?m.binary.byteLength:undefined});});}
    postMessage(...args){const m=args[0];if(m?.kind==='compile'||m?.kind==='initialize')record('worker-post',{kind:m.kind,requestId:m.requestId,workerURL:this.surfaceTimingURL});return super.postMessage(...args);}
  };
  const nativeFetch=window.fetch.bind(window);
  window.fetch=(...args)=>{
    const[input,init]=args;let url;try{url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);}catch{return nativeFetch(...args);}
    if(url.pathname==='/refinement/tile'||url.pathname==='/refinement/register'){
      const request={operation:url.pathname.endsWith('/tile')?'tile':'register'};
      if(request.operation==='tile'&&typeof init?.body==='string'&&init.body.length<=8192){
        try{const value=JSON.parse(init.body);request.region=numbers(value,['x','y','width','resolution']);request.registrationId=short(value.id);}catch{}
      }
      record('refinement-start',request);
      return nativeFetch(...args).then(response=>{
        record('refinement-headers',{...request,status:response.status});
        // Only observe a body read actually requested by the consumer. No clone,
        // eager read, extra transfer, decoding or error normalization is allowed.
        if(request.operation==='tile'&&typeof response.arrayBuffer==='function'){
          const arrayBuffer=response.arrayBuffer.bind(response);
          response.arrayBuffer=async()=>{try{const bytes=await arrayBuffer();record('refinement-body',{...request,status:response.status,bytes:bytes.byteLength});return bytes;}
            catch(error){record('refinement-body-error',{...request,name:short(error?.name)});throw error;}};
        }
        return response;
      },error=>{record('refinement-error',{...request,name:short(error?.name)});throw error;});
    }
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
