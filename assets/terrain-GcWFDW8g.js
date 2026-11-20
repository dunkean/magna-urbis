import{bI as fr,bJ as yt,bK as wt,bL as br,bM as je,bN as Qr,bO as wn,n as Dr,bP as er,bQ as jr,bR as xn,bS as bn,bT as kn,bU as ie,bV as At,bW as Sn,bX as xt,bY as xr,bZ as ai,b_ as xe,b$ as bt,c0 as _n,c1 as Dt,c2 as oi,c3 as si,c4 as jt,c5 as Xr,c6 as wr,C as Mn,K as li,c7 as ci,c8 as ui,c9 as fi,ca as di,cb as pi,cc as hi,cd as lt,ce as Cr,cf as Ar,cg as mi,ch as $t,ci as gi,cj as Pn,ck as vi,cl as yi,cm as wi,v as xi,cn as bi,co as ki,cp as Wt,cq as Si,cr as _i,t as Mi,cs as Pi,ct as Yt,cu as Vt,cv as zi,cw as Ui,cx as Ci,cy as Ai,cz as Ei,cA as Ri,cB as Ni}from"./__vite-browser-external-Bmk8_KO9.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const zn="magna-urbis-neural-models-v1",kr=["coarse","base","decoder"];class Le extends Error{constructor(t,i,n){super(i,n),this.code=t}}function kt(r){const t=r;if(!t||typeof t.profile!="string"||!/^[a-f0-9]{64}$/.test(t.runtimeSha256))throw new Le("manifest","Invalid neural model manifest.");if(t.runtimeJsSha256!==void 0&&!/^[a-f0-9]{64}$/.test(t.runtimeJsSha256))throw new Le("manifest","Invalid neural runtime manifest.");for(const i of kr){const n=t.models?.[i];if(!n||!/^[\w.-]+$/.test(n.file)||!Number.isSafeInteger(n.bytes)||n.bytes<=0||!/^[a-f0-9]{64}$/.test(n.sha256))throw new Le("manifest",`Invalid ${i} model manifest.`);if(n.chunks!==void 0&&(!Array.isArray(n.chunks)||!n.chunks.length||n.chunks.some(a=>!a||!/^[\w.-]+$/.test(a.file)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>=5e7||!/^[a-f0-9]{64}$/.test(a.sha256))||new Set(n.chunks.map(a=>a.file)).size!==n.chunks.length||n.chunks.reduce((a,o)=>a+o.bytes,0)!==n.bytes))throw new Le("manifest",`Invalid ${i} model chunks.`)}return t}async function Sr(r=!0){try{if(!globalThis.caches)throw new Error("Cache Storage unavailable");return await caches.open(zn)}catch(t){if(r)throw new Le("storage","Cannot access browser model storage.",{cause:t})}}async function Et(r,t){const i=new URL("models/manifest.json",r),n=await Sr(!1),a=AbortSignal.timeout(15e3);try{const o=await fetch(i,{cache:"no-cache",signal:t?AbortSignal.any([t,a]):a});if(!o.ok)throw new Error(`HTTP ${o.status}`);const l=kt(await o.json());return await n?.put(i,new Response(JSON.stringify(l),{headers:{"Content-Type":"application/json"}})).catch(()=>{}),{manifest:l,offline:!1}}catch(o){t?.throwIfAborted();const l=await n?.match(i);if(l)return{manifest:kt(await l.json()),offline:!0};throw new Le("manifest","Neural model catalogue unavailable on this address.",{cause:o})}}function Rt(r,t){const i=new URL(`models/${t.file}`,r);return i.searchParams.set("sha256",t.sha256),i.href}function Un(r,t,i,n){return r.searchParams.get("sha256")===i.sha256&&Number(t.headers.get("X-Magna-Model-Bytes"))===i.bytes&&(t.headers.get("X-Magna-Model-Name")===n||r.pathname.split("/").pop()===i.file)}async function Cn(r,t,i,n){const a=Rt(t,i),o=await r.match(a);if(o)return{url:a,response:o};for(const l of await r.keys()){const u=new URL(l.url);if(u.searchParams.get("sha256")!==i.sha256)continue;const s=await r.match(l);if(s&&Un(u,s,i,n))return{url:l.url,response:s}}}async function Bi(r){try{const t=await Sr(!1);if(!t)return!1;const i=await t.match(new URL("models/manifest.json",r).href);if(!i&&!(await t.keys()).some(a=>new URL(a.url).searchParams.has("sha256")))return!1;const n=i?kt(await i.json()):(await Et(r)).manifest;for(const a of kr){const o=n.models[a],l=await Cn(t,r,o,a);if(!l||Number(l.response.headers.get("X-Magna-Model-Bytes"))!==o.bytes)return!1}return!0}catch{return!1}}async function Ti(r,t){const i=await Sr(),n=[];for(const a of await i.keys()){const o=new URL(a.url);if(!o.searchParams.has("sha256"))continue;const l=await i.match(a);if(!l)continue;const u=t&&kr.find(e=>Un(o,l,t.models[e],e)),s=Number(l?.headers.get("X-Magna-Model-Bytes"));n.push({url:a.url,name:u??l?.headers.get("X-Magna-Model-Name")??o.pathname.split("/").pop(),bytes:u?t.models[u].bytes:s>0?s:void 0,current:!!u,profile:l?.headers.get("X-Magna-Model-Profile")??void 0})}return n}async function Ir(r,t){if(r.byteLength!==t.bytes)return!1;const i=await crypto.subtle.digest("SHA-256",r);return Array.from(new Uint8Array(i),n=>n.toString(16).padStart(2,"0")).join("")===t.sha256}async function An(r,t,i,n={}){const{signal:a,onProgress:o}=n,l=t.models[i],u=Rt(r,l);a?.throwIfAborted();const s=await Sr(n.requireStorage??!1);s||n.onStorageFailure?.();const e=s&&await Cn(s,r,l,i);if(e){const d=new Uint8Array(await e.response.arrayBuffer());o?.({name:i,phase:"verify",received:d.length,total:l.bytes});const y=await Ir(d,l);if(a?.throwIfAborted(),y)return d;await s?.delete(e.url)}const c=new Uint8Array(l.bytes);let f=0;for(const d of l.chunks??[l]){const y=new URL(`models/${d.file}`,r);y.searchParams.set("sha256",d.sha256);const x=await fetch(y.href,{signal:a});if(!x.ok)throw new Le("download",`Cannot download ${i} weights: HTTP ${x.status}`);const b=f;if(x.body){const w=x.body.getReader();try{for(;;){a?.throwIfAborted();const{done:P,value:m}=await w.read();if(P)break;if(f+m.byteLength>b+d.bytes)throw new Le("integrity",`Invalid ${i} model size.`);c.set(m,f),f+=m.byteLength,o?.({name:i,phase:"download",received:f,total:l.bytes})}}catch(P){throw await w.cancel().catch(()=>{}),P}finally{w.releaseLock()}}else{const w=new Uint8Array(await x.arrayBuffer());f+=w.byteLength,w.byteLength===d.bytes&&c.set(w,b)}if(f-b!==d.bytes||l.chunks&&!await Ir(c.subarray(b,f),d))throw new Le("integrity",`Invalid ${i} model chunk: integrity check failed.`)}if(a?.throwIfAborted(),o?.({name:i,phase:"verify",received:f,total:l.bytes}),f!==l.bytes||!await Ir(c,l))throw new Le("integrity",`Invalid ${i} model: integrity check failed.`);if(a?.throwIfAborted(),s){o?.({name:i,phase:"save",received:f,total:l.bytes});try{await s.put(u,new Response(c,{headers:{"X-Magna-Model-Name":i,"X-Magna-Model-Bytes":String(l.bytes),"X-Magna-Model-Profile":t.profile}}))}catch(d){if(n.requireStorage)throw new Le("storage","Cannot save model: browser storage is full or unavailable.",{cause:d});n.onStorageFailure?.()}}return c}async function Oi(r){const t=await Sr();try{await t.delete(r)}catch(i){throw new Le("storage","Cannot remove model from browser storage.",{cause:i})}}const za=Object.freeze(Object.defineProperty({__proto__:null,NEURAL_MODEL_CACHE:zn,NEURAL_MODEL_NAMES:kr,NeuralModelError:Le,deleteStoredNeuralModel:Oi,hasStoredNeuralModels:Bi,listStoredNeuralModels:Ti,loadNeuralManifest:Et,neuralModelCache:Sr,neuralModelUrl:Rt,obtainNeuralModel:An,verifyNeuralFile:Ir},Symbol.toStringTag,{value:"Module"}));async function Li(r,t,i){const n=await globalThis.caches?.open("magna-urbis-neural-runtime-v1");async function a(u,s){const e=new URL(u,r);e.searchParams.set("sha256",s??t.runtimeSha256);const c=b=>s?Ir(b,{bytes:b.length,sha256:s}):Promise.resolve(!0);let f=e.href,d=await n?.match(e);if(n&&!d)for(const b of await n.keys()){const w=new URL(b.url);if(!(w.pathname.split("/").pop()!==u||w.searchParams.get("sha256")!==e.searchParams.get("sha256"))&&(d=await n.match(b),d)){f=b.url;break}}if(d){const b=new Uint8Array(await d.arrayBuffer());if(await c(b))return b;await n?.delete(f)}const y=await fetch(e,{signal:i});if(!y.ok)throw new Error("Neural runtime unavailable. Check your connection and retry.");const x=new Uint8Array(await y.arrayBuffer());if(i?.throwIfAborted(),!await c(x))throw new Error("Neural runtime integrity check failed. Please retry.");return await n?.put(e,new Response(x)),x}const o=await a("magna_urbis_neural_wasm.js",t.runtimeJsSha256),l=await a("magna_urbis_neural_wasm_bg.wasm",t.runtimeSha256);return{javascript:o,wasm:l}}const St=["initialize","regional","regionalFinish","reconstruct","amplitude","ridged","surface","normalize"];function tt(r){const t=[...St];return t.splice(t.indexOf(r.procedural?.coastAfter??"initialize")+1,0,"coastCut"),t}function _t(r){return JSON.stringify(r,(t,i)=>i&&typeof i=="object"&&!Array.isArray(i)&&!ArrayBuffer.isView(i)?Object.fromEntries(Object.keys(i).sort().map(n=>[n,i[n]])):i)}function et(r){const t=r.procedural??{},i={...r.erosionTuning,...t.erosionTuning},n=(...s)=>s.map(e=>i[e]??null),a=[r.climate,r.climateZone,r.climateValues],o={initialize:[r.seed,r.width,r.sampleSpacing,r.source,r.relief,r.environment,r.motifSize,r.mountainMix,r.erosion,br(r),br(r)?r.phasor?.quality??"balanced":null,t.regionalN,t.noiseScale,t.crest,t.biome&&a,r.generationCompute,r.compute,r.sketch,r.zones,r.source?.startsWith("neural")?[a,r.fidelity,r.neuralServer,r.neuralTuning,r.neuralFit,r.neuralSlopes,r.coarseModel,r.baseModel,r.decoderModel]:null],regional:[t.uplift,t.regionalThermal,t.regionalDiffusion,n("iterations","incision","incisionSlope","fill","carve","talus","thermal","diffusion")],regionalFinish:[t.regionalThermal,t.regionalDiffusion,n("finalCarve","thermal","talus","fill")],reconstruct:[t.reconstruction,n("warp")],amplitude:[],ridged:[n("detail")],surface:[t.surfaceN,n("talus","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion")],normalize:[],phasor:[r.phasor,a],posterior:wt(r),wind:yt(r),coastCut:[r.coastMask??0,r.islandMode??"island",fr(r),t.coastAfter??"initialize"],coasts:[r.coastMask??0,r.islandMode??"island",fr(r),t.surfaceN,t.coastIterations,t.coastIncision,t.coastThermal,t.coastDiffusion,n("surfaceIncision","surfaceThermal","surfaceDiffusion","surfaceCarve","talus")],sampling:[r.resolution,r.refine,r.detailNoise],hydrology:[r.hydrology,a]},l=new Map,u=[];if(r.generalSeed)for(const[s,e]of[["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"],["phasor","relief-phasor"],["hydrology","water-hydrology"]]){const c=je(r.generalSeed,e);c!==r.seed&&(o[s]=[o[s],c])}for(const s of[...tt(r),"phasor","posterior","wind","coasts","sampling","hydrology"]){const e=Qr(r,s);u.push([s,e,e?o[s]:null]),l.set(s,_t(u))}return l.set("grids",_t([r.seed,r.width,r.sampleSpacing,r.procedural?.regionalN,r.resolution])),l}class Nt{constructor(){this.fields=new Map}get(t,i){const n=this.fields.get(t);return n?.key===i?n.height.slice():void 0}put(t,i,n){this.fields.set(t,{key:i,height:n.slice()})}clear(){this.fields.clear()}}class En{a=2166136261;b=2654435769;c=2246822507;d=3266489909;word(t,i){this.a=Math.imul(this.a^t,16777619),this.b=Math.imul(this.b^t^i,2246822507),this.c=Math.imul(this.c^(t>>>16|t<<16),3266489909),this.d=Math.imul(this.d^t^Math.imul(i,2654435769),668265261)}finish(t){this.word(t,2147483647);const i=n=>(n^=n>>>16,n=Math.imul(n,2246822507),n^=n>>>13,n=Math.imul(n,3266489909),((n^n>>>16)>>>0).toString(16).padStart(8,"0"));return`${t}:${[this.a,this.b,this.c,this.d].map(i).join("")}`}}function Gi(r){const t=new En,i=new DataView(r.buffer,r.byteOffset,r.byteLength);let n=0;for(;n+4<=r.length;n+=4)t.word(i.getUint32(n,!0),n);let a=0;for(let o=0;n<r.length;n++,o+=8)a|=r[n]<<o;return r.length%4&&t.word(a,n),t.finish(r.length)}function ct(r){const t=new En,i=new DataView(new ArrayBuffer(8));for(let n=0;n<r.length;n++)i.setFloat64(0,r[n],!0),t.word(i.getUint32(0,!0),n*2),t.word(i.getUint32(4,!0),n*2+1);return t.finish(r.length)}function Jt(r,t,i,n){r.set_coast(t,i,JSON.stringify(n))}function Kt(r,t,i,n){r.configure_coast(t,i,JSON.stringify(n))}function Fi(r,t,i,n){r.cut_coast(t,i,JSON.stringify(n))}function Ii(r,t,i,n,a,o,l,u,s,e,c,f){return r.cut_field(t,i,n,a,o,l,u,s,e,c,JSON.stringify(f))}let Ve;const ut=new Map;let Mt=Promise.resolve();const Pt=new Nt;function zt(r=!1){const t=Ve;Ve=void 0,Pt.clear(),r||t?.pipeline?.free(),t?.runtime&&(Mt=Mt.then(async()=>{await Dr(t.runtime,"/terrain/stage",JSON.stringify({session:t.session,command:"cancel"})).catch(()=>{})}))}wn(()=>zt(!0));async function Hi(r,t,i,n,a){t?.backend?.(i?"native":"cpu");const o=er(r),l=t?.previews!==!1&&o.n<=1024,u=br(r),s=jr.erosion_at_resolution(r.seed,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix,o.n),e=s.parameters();s.free();const{parameters:c,surface:f}=u?xn(e,r):{parameters:e,surface:e.slice(24,32)};bn(c,f,r,u),kn(f,r,o.n),u&&ie(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural?.erosionTuning?.detail===void 0&&(c[16]=e[16]);const d=(S,U=!0)=>Number(ie(r,S,U)),y=Uint32Array.from([Number(u),d("regional"),d("regionalFinish"),d("amplitude"),d("ridged",!u),d("surface",!u||r.relief==="canyon"),d("normalize"),+(r.procedural?.regionalThermal!==!1),+(r.procedural?.regionalDiffusion!==!1),r.procedural?.reconstruction==="cubic"?1:r.procedural?.reconstruction==="bspline"?2:0,+(r.relief==="canyon")]);a?.(y[5]&&c[23]>0&&f[3]>0?f[1]:void 0,y[1]&&r.erosion>0?c[4]:void 0);const x=_t([r.seed,r.width,o.n,c[2],i?.server??"wasm",!!n]);(o.n>1024||Ve?.root!==x)&&zt();const b=tt(r),w=et(r),P=b.map(S=>w.get(S));let m=0;for(;Ve&&m<P.length&&Ve.keys[m]===P[m];)m++;const g=async S=>{try{return await Dr(i,"/terrain/stage",JSON.stringify({session:Ve.session,...S}))}catch(U){throw["coast","restore","preview"].includes(S.command)&&U instanceof Error&&U.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):U}},h=r.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([S,U])=>[S,je(r.generalSeed,U)])):void 0,p={parameters:Array.from(c),surface:Array.from(f),flags:Array.from(y),stepSeeds:h??{}},N=async S=>{const U=await g(S),j=await U.json();if(h&&Object.values(h).some(W=>W!==r.seed)&&!j.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!Ve||m===0?(zt(),i&&!ut.has(i.server)&&ut.set(i.server,At()),Ve={root:x,keys:[],runtime:i,...i?{session:ut.get(i.server)}:{}},await t?.before("grids",`Rust ${i?"natif":"WASM"} · régional ${c[2]}² · surface ${f[0]}² · source ${o.n}² à ${o.spacing.toFixed(2)} m`),i?(await Mt,await N({command:"start",seed:r.seed,...p})):Ve.pipeline=new Sn(r.seed,c,f,y),await t?.after("grids")):t?.cached?await t.cached("grids"):(await t?.before("grids"),await t?.after("grids"));const C=Ve;i||C.pipeline.set_step_seeds(JSON.stringify(h??{}));let E;for(let S=0;S<b.length;S++){const U=b[S],j=S<m;if(!j&&S===m&&S>0&&(i?await N({command:"restore",checkpoint:S-1,...p}):C.pipeline.restore(S-1,c,f,y),C.keys.length=S),j){(l||S===b.length-1)&&(E=i?new Float32Array(await(await g({command:"preview",checkpoint:S})).arrayBuffer()):C.pipeline.checkpoint_height(S)),t?.cached?await t.cached(U,l?E:void 0):(await t?.before(U),await t?.after(U,l?E:void 0));continue}await t?.before(U);const W=U==="coastCut"&&Qr(r,"coastCut");if(i){const F=await(await g({command:U==="coastCut"?"coast":"advance",stage:St.indexOf(U),checkpoint:S,mask:W?r.coastMask:0,mode:r.islandMode??"island",coastProfile:fr(r),preview:l||S===b.length-1})).arrayBuffer();F.byteLength&&(E=new Float32Array(F))}else{if(U==="initialize"&&n){const B=await n();C.pipeline.set_noise(B.coarse,B.fine)}U==="coastCut"?W&&Fi(C.pipeline,r.coastMask,r.islandMode??"island",fr(r)):C.pipeline.advance(St.indexOf(U)),C.pipeline.checkpoint(S),(l||S===b.length-1)&&(E=C.pipeline.height())}C.keys[S]=P[S],await t?.after(U,l?E:void 0)}const G=`${x}|${w.get("phasor")}`,_=o.n<=1024?Pt.get("phasor",G):void 0;return _?(t?.cached?await t.cached("phasor",l?_:void 0):(await t?.before("phasor"),await t?.after("phasor",_)),_):(await t?.before("phasor"),ie(r,"phasor",u)&&(E=xt(E,r)),o.n<=1024&&Pt.put("phasor",G,E),await t?.after("phasor",l?E:void 0),E)}const qi=`
struct Params{n:u32,cell:f32,dx:f32,dy:f32,amount:f32,pad:vec3<f32>}
@group(0) @binding(0) var<storage,read_write> height:array<f32>;
@group(0) @binding(1) var<storage,read_write> flux:array<f32>;
@group(0) @binding(2) var<uniform> p:Params;
fn neighbor(i:u32,axis:u32,sign:i32)->u32{let x=i%p.n;let y=i/p.n;return u32(clamp(i32(y)+select(0,sign,axis==1u),0,i32(p.n)-1))*p.n+u32(clamp(i32(x)+select(0,sign,axis==0u),0,i32(p.n)-1));}
@compute @workgroup_size(256)
fn entrain(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=id.y*groups.x*256u+id.x;if(i>=p.n*p.n){return;}let x=i%p.n;let y=i/p.n;
 if(x==0u||y==0u||x==p.n-1u||y==p.n-1u||height[i]<=.3){flux[i]=0.;return;}
 let gx=(height[i+1u]-height[i-1u])/(2.*p.cell);let gy=(height[i+p.n]-height[i-p.n])/(2.*p.cell);
 let slope=gx*p.dx+gy*p.dy;
 let mobility=.75+.25*sin((f32(x)*p.dx+f32(y)*p.dy)*p.cell/64.+height[i]*.03);
 flux[i]=min(max(0.,height[i]-.3),p.amount*clamp(.55+2.*slope,.1,1.)*mobility);
}
@compute @workgroup_size(256)
fn deposit(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
 let i=id.y*groups.x*256u+id.x;if(i>=p.n*p.n){return;}let sx=select(-1,1,p.dx>=0.);let sy=select(-1,1,p.dy>=0.);
 let wx=abs(p.dx)/max(.00001,abs(p.dx)+abs(p.dy));let wy=1.-wx;
 let a=neighbor(i,0u,-sx);let b=neighbor(i,1u,-sy);
 let incoming=select(0.,flux[a]*wx,a!=i)+select(0.,flux[b]*wy,b!=i);
 height[i]=height[i]-flux[i]+incoming;
}`,Xt=new WeakMap;function Di(r,t,i){if(!i.iterations||!i.transport)return r;const n=r.slice(),a=Math.sqrt(n.length),o=t/a,l=new Float32Array(n.length),u=i.azimuth*Math.PI/180,s=Math.cos(u),e=Math.sin(u),c=s>=0?1:-1,f=e>=0?1:-1,d=Math.abs(s)/(Math.abs(s)+Math.abs(e)),y=1-d;for(let x=0;x<i.iterations;x++){l.fill(0);for(let b=1;b<a-1;b++)for(let w=1;w<a-1;w++){const P=b*a+w;if(n[P]<=.3)continue;const m=((n[P+1]-n[P-1])*s+(n[P+a]-n[P-a])*e)/(2*o),g=.75+.25*Math.sin((w*s+b*e)*o/64+n[P]*.03);l[P]=Math.min(Math.max(0,n[P]-.3),i.transport*Math.max(.1,Math.min(1,.55+2*m))*g)}for(let b=0;b<a;b++)for(let w=0;w<a;w++){const P=b*a+w,m=b*a+Math.max(0,Math.min(a-1,w-c)),g=Math.max(0,Math.min(a-1,b-f))*a+w;n[P]=n[P]-l[P]+(m!==P?l[m]*d:0)+(g!==P?l[g]*y:0)}}return n}async function ji(r,t,i,n){if(!n.iterations||!n.transport)return t;const a=r.device,o=Math.sqrt(t.length);let l=Xt.get(a);l||(l=(async()=>{const d=a.createShaderModule({code:qi}),x=(await d.getCompilationInfo()).messages.filter(g=>g.type==="error");if(x.length)throw new Error(x.map(g=>`${g.lineNum}: ${g.message}`).join(`
`));const b=a.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),w=a.createPipelineLayout({bindGroupLayouts:[b]}),[P,m]=await Promise.all(["entrain","deposit"].map(g=>a.createComputePipelineAsync({layout:w,compute:{module:d,entryPoint:g}})));return{layout:b,a:P,b:m}})(),Xt.set(a,l));const{layout:u,a:s,b:e}=await l,c=[],f=(d,y)=>{const x=a.createBuffer({size:d,usage:y});return c.push(x),x};try{const d=f(t.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),y=f(t.byteLength,GPUBufferUsage.STORAGE),x=f(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),b=f(t.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);a.queue.writeBuffer(d,0,t);const w=new ArrayBuffer(48),P=new Float32Array(w);new Uint32Array(w)[0]=o;const m=n.azimuth*Math.PI/180;P[1]=i/o,P[2]=Math.cos(m),P[3]=Math.sin(m),P[4]=n.transport,a.queue.writeBuffer(x,0,w);const g=a.createBindGroup({layout:u,entries:[d,y,x].map((_,S)=>({binding:S,resource:{buffer:_}}))}),h=Math.ceil(t.length/256),p=Math.ceil(h/a.limits.maxComputeWorkgroupsPerDimension),N=Math.ceil(h/p),C=a.createCommandEncoder(),E=C.beginComputePass();E.setBindGroup(0,g);for(let _=0;_<n.iterations;_++)E.setPipeline(s),E.dispatchWorkgroups(N,p),E.setPipeline(e),E.dispatchWorkgroups(N,p);E.end(),C.copyBufferToBuffer(d,0,b,0,t.byteLength),a.queue.submit([C.finish()]),await b.mapAsync(GPUMapMode.READ);const G=new Float32Array(b.getMappedRange()).slice();return b.unmap(),G}finally{c.forEach(d=>d.destroy())}}const $i=`// FP32 sampling of the retained Rust erosion field.\r
struct Params { values: array<vec4<f32>, 9> }\r
override FAMILY: u32 = 0u;\r
@group(0) @binding(0) var<uniform> p: Params;\r
@group(0) @binding(1) var<storage, read> field: array<f32>;\r
@group(0) @binding(2) var<storage, read> perm: array<u32>;\r
@group(0) @binding(3) var<storage, read> gradients: array<vec2<f32>>;\r
@group(0) @binding(4) var<storage, read_write> output: array<vec4<f32>>;\r
@group(0) @binding(5) var<storage, read> branches: array<vec4<f32>>;\r
\r
// NOISE_KERNEL\r
fn volcanicParams(i:u32)->vec4<f32>{return p.values[5u+i];}\r
// VOLCANIC_KERNEL\r
// COAST_KERNEL\r
fn weights(t: f32) -> vec4<f32> {\r
  let t3=t*t*t; let omt=1.0-t;\r
  return vec4<f32>(omt*omt*omt,3.0*t3-6.0*t*t+4.0,-3.0*t3+3.0*t*t+3.0*t+1.0,t3)/6.0;\r
}\r
fn at_level_offset(uv: vec2<f32>, level: u32, start:u32) -> f32 {\r
  var n=u32(p.values[4].z); var offset=start;\r
  for(var l=0u;l<level;l++){offset+=n*n;n=max(1u,n/2u);}\r
  let pos=uv*f32(n)-0.5; let origin=vec2<i32>(floor(pos));\r
  let wx=vec4<f32>(weights(pos.x-f32(origin.x))); let wy=vec4<f32>(weights(pos.y-f32(origin.y)));\r
  var value=f32(0.0);\r
  for(var j=0u;j<4u;j++) {\r
    let row=u32(clamp(origin.y+i32(j)-1,0,i32(n)-1));\r
    for(var i=0u;i<4u;i++) {\r
      let col=u32(clamp(origin.x+i32(i)-1,0,i32(n)-1));\r
      value+=f32(field[offset+row*n+col])*wx[i]*wy[j];\r
    }\r
  }\r
  return f32(value);\r
}\r
fn at_level(uv:vec2<f32>,level:u32)->f32{return at_level_offset(uv,level,0u);}\r
fn pyramid_size()->u32 {\r
  var n=u32(p.values[4].z); var size=0u;\r
  loop {size+=n*n;if(n<=1u){break;}n=max(1u,n/2u);}\r
  return size;\r
}\r
fn filteredSurface(uv:vec2<f32>,footprint:f32,start:u32)->f32 {\r
  let maxLevel=u32(p.values[4].w);\r
  let lod=clamp(log2(max(1.0,footprint*p.values[4].z)),0.0,f32(maxLevel));let l=u32(floor(lod));\r
  return mix(at_level_offset(uv,l,start),at_level_offset(uv,min(l+1u,maxLevel),start),fract(lod));\r
}\r
fn surface(uv: vec2<f32>) -> f32 {\r
  if(p.values[1].z == 0.0){return 0.0;}\r
  let lower=u32(p.values[3].x); let upper=u32(p.values[3].y); let t=p.values[3].z;\r
  let a=at_level(uv,lower);\r
  if(t==0.0){return a;}\r
  return a*(1.0-t)+at_level(uv,upper)*t;\r
}\r
fn valley_wall(along: f32, across: f32, footprint: f32) -> f32 {\r
  let motif=p.values[0].y;\r
  let center=branches[0].y+motif*(2.8*fbm(vec2<f32>(along/(motif*12.0),branches[0].x),0u,2u,0.5,0.0)\r
    +0.65*fbm(vec2<f32>(along/(motif*3.2),7.1),1u,2u,0.5,0.0)\r
    +0.10*fbm(vec2<f32>(along/motif,3.7),0u,2u,0.5,0.0));\r
  let floor_width=motif*0.065; let slope=max(motif*0.32,footprint);\r
  var wall=smooth01((abs(across-center)-floor_width)/slope);\r
  let cell=i32(floor(along/(motif*2.6)));\r
  for(var index=cell-1;index<=cell+2;index++) {\r
    let slot=index-i32(branches[0].z);\r
    if(slot<0 || slot>=i32(branches[0].w)){continue;}\r
    for(var bank=0u;bank<2u;bank++) {\r
      let branch=branches[1u+u32(slot)*2u+bank];\r
      let side=select(-1.0,1.0,bank==1u);\r
      let r=side*(across-branch.y);\r
      if(r < -motif*0.25 || r > branch.z){continue;}\r
      let t=max(0.0,r/branch.z);\r
      let bend=motif*0.22*sin(t*3.141592653589793)*sin(branch.w+t*3.0)*smooth01(t/0.15);\r
      let branch_along=branch.x-0.85*r+bend;\r
      let d=abs(along-branch_along)/1.31;\r
      let taper=1.0-smooth01((t-0.45)/0.55);\r
      let branch_wall=smooth01((d-floor_width*0.65*taper)/(slope*0.7));\r
      let entrance=smooth01((r+motif*0.25)/(motif*0.25));\r
      let other=1.0-(1.0-branch_wall)*taper*entrance;\r
      let width=0.22*smooth01((1.0-wall)/0.15)*smooth01((1.0-other)/0.15);\r
      var blend=0.0;\r
      if(width>1e-9){blend=max(0.0,(width-abs(wall-other))/width);}\r
      wall=max(0.0,min(wall,other)-width*0.25*blend*blend);\r
    }\r
  }\r
  return wall;\r
}\r
fn height_at(xy: vec2<f32>) -> f32 {\r
  // This signed physical surface was cut before its final erosion pass.\r
  // It is retained at camera changes: no second analytic coast cut at zoom.\r
  if(p.values[1].y==4.0){return surface(xy/p.values[0].x);}\r
  let map=p.values[0].x; let motif=p.values[0].y; let phase=p.values[0].z; let amp=p.values[0].w;\r
  let cell=p.values[2].w; var h=0.0;\r
  if(FAMILY == 0u) {\r
    let scale=motif/2400.0;\r
    let shifted=xy+vec2<f32>(phase,0.0);\r
    let swell=fbm(shifted/(1200.0*scale),0u,4u,0.42,cell/(1200.0*scale));\r
    let rough=fbm(shifted/(720.0*scale),0u,4u,0.5,cell/(720.0*scale));\r
    let uv=0.5+0.44*vec2<f32>(fbm(xy/motif+vec2<f32>(11.3,0.0),1u,2u,0.5,0.0),fbm(xy/motif+vec2<f32>(-4.7,2.9),1u,2u,0.5,0.0));\r
    h=amp*(0.45+0.275*swell+0.065*rough)+surface(uv);\r
  } else if(FAMILY == 3u) {\r
    // Complete local and regional mip chains; physical motif scale survives map enlargement.\r
    let start=pyramid_size();\r
    let surroundings=filteredSurface(xy/map,cell/map,start);\r
    let origin=volcanicParams(3u).yz;\r
    let uv=(xy-origin)/motif;\r
    let edge=min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y));\r
    let plateau=volcanicParams(2u).z==2.0;\r
    var weight=0.0;\r
    if(plateau){\r
      let t=clamp(edge/0.045,0.0,1.0);\r
      weight=t*t*t*(t*(6.0*t-15.0)+10.0)*plateauInfluence(uv*motif);\r
    }else{weight=volcanoInfluence(uv*motif);}\r
    if(weight==0.0){h=surroundings;}else{\r
      let foundation=filteredSurface((origin+motif*0.5)/map,motif*0.35/map,start);\r
      let local=filteredSurface(uv,cell/motif,0u)+foundation;\r
      let protection=volcanoProtection(uv*motif);let k=amp*0.18;\r
      let overlap=max(0.0,1.0-abs(local-surroundings)/k);\r
      let joined=mix(max(local,surroundings)+k*overlap*overlap*0.25,local,protection);\r
      h=mix(surroundings,joined,weight);\r
    }\r
  } else {\r
    h=surface(xy/map);\r
    if(FAMILY == 2u) {\r
      let delta=xy-map*0.5; let down=p.values[4].xy;\r
      let along=dot(delta,down); let across=dot(delta,vec2<f32>(-down.y,down.x));\r
      let rough=fbm((xy+vec2<f32>(phase,0.0))/(720.0*motif/2400.0),0u,4u,0.5,cell/(720.0*motif/2400.0));\r
      h=amp*(0.06+0.012*rough)+h*pow(valley_wall(along,across,cell),1.2);\r
    }\r
  }\r
  return coastalHeight(xy,clamp(h,0.3,p.values[1].x));\r
}\r
@compute @workgroup_size(8,8)\r
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {\r
  let n=u32(p.values[1].w); if(gid.x>=n || gid.y>=n){return;}\r
  let xy=p.values[2].xy+(vec2<f32>(gid.xy)+0.5)*p.values[2].w;\r
  let eps=p.values[3].w;\r
  let gx=(height_at(xy+vec2<f32>(eps,0.0))-height_at(xy-vec2<f32>(eps,0.0)))/(2.0*eps);\r
  let gy=(height_at(xy+vec2<f32>(0.0,eps))-height_at(xy-vec2<f32>(0.0,eps)))/(2.0*eps);\r
  let normal=normalize(vec3<f32>(-gx,-gy,1.0));\r
  output[gid.y*n+gid.x]=vec4<f32>(vec4<f32>(height_at(xy),normal));\r
}\r
`,Bt=`// Shared FP32 simplex and FBM kernels.\r
fn smooth01(t0: f32) -> f32 {\r
  let t = clamp(t0, 0.0, 1.0); return t*t*(3.0-2.0*t);\r
}\r
fn simplex(xy: vec2<f32>, which: u32) -> f32 {\r
  let f2 = 0.3660254037844386; let g2 = 0.21132486540518713;\r
  let ij = vec2<i32>(floor(xy + (xy.x + xy.y)*f2));\r
  let a = xy - (vec2<f32>(ij) - f32(ij.x + ij.y)*g2);\r
  let step = select(vec2<i32>(0,1), vec2<i32>(1,0), a.x > a.y);\r
  let ii = u32(ij.x & 255); let jj = u32(ij.y & 255); let base = which*512u;\r
  let coords = array<vec2<f32>,3>(a, a-vec2<f32>(step)+g2, a-1.0+2.0*g2);\r
  let indices = array<u32,3>(ii+perm[base+jj], ii+u32(step.x)+perm[base+jj+u32(step.y)], ii+1u+perm[base+jj+1u]);\r
  var result = 0.0;\r
  for(var k=0u; k<3u; k++) {\r
    let v = coords[k]; let q = 0.5-v.x*v.x-v.y*v.y;\r
    if(q > 0.0) {\r
      let grad = gradients[which*32u+(perm[base+indices[k]] & 31u)];\r
      result += q*q*q*q*dot(grad,v);\r
    }\r
  }\r
  return 75.0*result;\r
}\r
fn fbm(xy: vec2<f32>, which: u32, octaves: u32, gain: f32, footprint: f32) -> f32 {\r
  var amp=1.0; var freq=1.0; var sum=0.0; var norm=0.0;\r
  for(var o=0u; o<octaves; o++) {\r
    let weight = 1.0-smooth01((footprint*freq-0.125)/0.125);\r
    if(weight > 0.0) { sum += amp*weight*simplex(xy*freq+vec2<f32>(f32(o)*17.3,-f32(o)*9.1),which); }\r
    norm += amp; amp *= gain; freq *= 2.0;\r
  }\r
  return sum/norm;\r
}\r
\r
fn ridge(xy:vec2<f32>,octaves:u32)->f32 {\r
  var amp=1.0;var freq=1.0;var sum=0.0;var norm=0.0;var weight=1.0;\r
  for(var o=0u;o<octaves;o++){let r=1.0-abs(simplex(xy*freq+vec2<f32>(f32(o)*31.7,f32(o)*5.3),1u));let v=r*r*weight;weight=clamp(v*1.6,0.0,1.0);sum+=amp*(0.5+(v-0.5));norm+=amp;amp*=0.5;freq*=2.0;}\r
  return sum/norm;\r
}\r
`,Wi=`// Same noise octaves and physical wavelengths as erosion::mountain.\r
struct Params { values: array<vec4<f32>, 3> }\r
@group(0) @binding(0) var<uniform> p: Params;\r
@group(0) @binding(1) var<storage, read> perm: array<u32>;\r
@group(0) @binding(2) var<storage, read> gradients: array<vec2<f32>>;\r
@group(0) @binding(3) var<storage, read_write> output: array<vec4<f32>>;\r
// NOISE_KERNEL\r
@compute @workgroup_size(8,8)\r
fn coarse(@builtin(global_invocation_id) id: vec3<u32>) {\r
  let n=u32(p.values[0].z);\r
  if(id.x>=n || id.y>=n){return;}\r
  let xy=vec2<f32>(id.xy)*p.values[1].x+(0.5*p.values[1].x+p.values[1].y);\r
  output[id.y*n+id.x]=vec4<f32>(\r
    fbm(xy/p.values[1].z+vec2<f32>(3.1,-1.7),0u,3u,0.5,0.0),\r
    fbm(xy/(2700.0*p.values[0].w)+vec2<f32>(8.4,0.0),1u,3u,0.5,0.0),\r
    fbm(xy/p.values[1].w,1u,3u,0.5,0.0),ridge(xy/p.values[1].z+vec2<f32>(5.7,-3.2),3u));\r
}\r
@compute @workgroup_size(8,8)\r
fn fine(@builtin(global_invocation_id) id: vec3<u32>) {\r
  let n=u32(p.values[0].y);\r
  if(id.x>=n || id.y>=n){return;}\r
  let xy=(vec2<f32>(id.xy)+0.5)*p.values[2].w;\r
  output[id.y*n+id.x]=vec4<f32>(\r
    fbm(xy/p.values[2].x+vec2<f32>(11.3,0.0),1u,2u,0.5,0.0),\r
    fbm(xy/p.values[2].x+vec2<f32>(-4.7,2.9),1u,2u,0.5,0.0),\r
    ridge(xy/p.values[2].y,u32(p.values[2].z)),0.0);\r
}\r
`,Rn=`// Seeded finite volcanic geometry. Shared by generation and camera sampling.\r
fn volcanoGeometry(xy:vec2<f32>)->vec3<f32> {\r
  let a=volcanicParams(0u); let b=volcanicParams(1u); let c=volcanicParams(2u);\r
  let d=xy-a.xy; let rotated=vec2<f32>(d.x*b.x+d.y*b.y,(-d.x*b.y+d.y*b.x)/a.w);\r
  let outline=fbm(xy/(900.0*c.y)+vec2<f32>(c.x,-2.3),0u,3u,0.5,0.0);\r
  let geographic=fbm((xy+vec2<f32>(c.x,0.0))/(620.0*c.y),1u,3u,0.5,0.0);\r
  let wobble=1.0+select(0.12,0.18,c.z!=0.0)*outline+0.055*geographic;\r
  let radius=length(rotated)/(a.z*wobble);\r
  let azimuth=atan2(rotated.y,rotated.x);\r
  // Low azimuthal harmonics: lobed or elongated rims, as VolcanoShape::geometry.\r
  let lobes=1.0+(0.04+0.08*volcanoVariety(0u))*cos(2.0*(azimuth-6.283185307*volcanoVariety(1u)))\r
    +0.06*volcanoVariety(2u)*cos(3.0*(azimuth-6.283185307*volcanoVariety(3u)));\r
  let rim=(select(0.255,0.55,c.z!=0.0)+select(0.030,0.045,c.z!=0.0)*fbm(xy/(420.0*c.y)+vec2<f32>(c.x,0.0),1u,3u,0.5,0.0))*lobes;\r
  return vec3<f32>(radius,rim,azimuth);\r
}\r
// Seeded shape variety in [0, 1) from the phase; VolcanoShape::variety.\r
fn volcanoVariety(k:u32)->f32 {\r
  let keys=array<f32,6>(0.618034,0.414214,0.732051,0.236068,0.645751,0.302776);\r
  return fract(volcanicParams(2u).x*keys[k]);\r
}\r
fn volcanoOpening(g:vec3<f32>)->f32 {\r
  if(volcanicParams(2u).z==0.0){return 0.0;}\r
  let b=volcanicParams(1u); let angle=abs(atan2(sin(g.z-b.z),cos(g.z-b.z)));\r
  return (1.0-smooth01((angle-b.w*0.40)/(b.w*0.60)))*smooth01((g.x/g.y-0.30)/0.30);\r
}\r
fn volcanoProtection(xy:vec2<f32>)->f32 {\r
  if(volcanicParams(2u).z==2.0){return 1.0-smooth01((plateauBoundary(xy).y+0.03)/0.10);}\r
  let g=volcanoGeometry(xy);\r
  return (1.0-smooth01((g.x-g.y)/(g.y*0.12)))*(1.0-volcanoOpening(g));\r
}\r
fn volcanoInfluence(xy:vec2<f32>)->f32 {\r
  let c=volcanicParams(2u);let g=volcanoGeometry(xy);\r
  let apron=select(1.05,1.18,c.z!=0.0);\r
  let t=clamp((g.x-(apron-0.25))/0.40,0.0,1.0);\r
  let outline=1.0-t*t*t*(t*(6.0*t-15.0)+10.0);\r
  // Circular support vanishes before the local raster edge, including corners.\r
  let s=clamp((length(xy/(2400.0*c.y)-0.5)-0.39)/0.10,0.0,1.0);\r
  return outline*(1.0-s*s*s*(s*(6.0*s-15.0)+10.0));\r
}\r
fn volcanoElevation(xy:vec2<f32>)->f32 {\r
  if(volcanicParams(2u).z==2.0){return plateauElevation(xy);}\r
  let g=volcanoGeometry(xy); let b=volcanicParams(1u); let c=volcanicParams(2u); let collapsed=c.z!=0.0;\r
  let v0=volcanoVariety(0u); let v1=volcanoVariety(1u); let v2=volcanoVariety(2u);\r
  let v3=volcanoVariety(3u); let v4=volcanoVariety(4u); let v5=volcanoVariety(5u);\r
  var floor=select(0.26+0.20*v0,0.03+0.12*v2,collapsed); let start=select(0.36,0.58,collapsed);\r
  let sag=0.5+0.5*cos(g.z-6.283185307*v5);\r
  let crest=select(0.98,0.96,collapsed)*(1.0-0.18*v4*sag*sag); let apron=select(1.05,1.18,collapsed);\r
  let exponent=select(1.6,1.45,collapsed)*(0.8+0.45*v1);\r
  let uw=g.x*vec2<f32>(cos(g.z),sin(g.z));\r
  let tilt=select(6.283185307*v2,b.z,collapsed);\r
  floor+=0.035*(0.4+v4)*dot(uw,vec2<f32>(cos(tilt),sin(tilt)))/g.y;\r
  let t=clamp((g.x/g.y-start)/(1.0-start),0.0,1.0);\r
  let bowl=floor+(crest-floor)*t*t*t*(t*(6.0*t-15.0)+10.0);\r
  let outer=crest*pow(max(0.0,1.0-(g.x-g.y)/(apron-g.y)),exponent);\r
  let crown=smooth01((g.x/g.y-0.94)/0.12);\r
  var cone=mix(bowl,outer,crown);\r
  if(v3>0.4){\r
    let base=select(0.255,0.55,collapsed); let angle=6.283185307*v0+1.3;\r
    let offset=(0.15+0.45*v4)*base;\r
    let size=base*select(0.30+0.20*v5,0.14+0.12*v5,collapsed);\r
    let d=length(uw-offset*vec2<f32>(cos(angle),sin(angle)))/size;\r
    let inside=1.0-smooth01((g.x/g.y-0.70)/0.20);\r
    let height=0.10+0.25*v1;\r
    let vent=select(-(0.06+0.10*v1)*(1.0-smooth01(d)),height*(1.0-smooth01(d))-0.45*height*(1.0-smooth01(d/0.35)),collapsed);\r
    cone+=vent*inside;\r
  }\r
  let opening=volcanoOpening(g);\r
  if(collapsed){let outlet=floor*(1.0-smooth01((g.x-g.y*0.65)/(1.18-g.y*0.65)));cone=mix(cone,outlet,opening);}\r
  let flutes=ridge(xy/(360.0*c.y),3u)-0.5;\r
  let wall=fbm(xy/(150.0*c.y),0u,3u,0.5,0.0);\r
  let interior=1.0-smooth01((g.x/g.y-0.82)/0.18);\r
  let crater=fbm(xy/(380.0*c.y),1u,3u,0.5,0.0);\r
  let warp=g.z+0.45*fbm(vec2<f32>(cos(g.z)*1.3+c.x,sin(g.z)*1.3),0u,2u,0.5,0.0);\r
  let gate=smooth01((fbm(vec2<f32>(cos(g.z)*2.6-c.x,sin(g.z)*2.6+g.x*1.4),1u,2u,0.5,0.0)+0.15)/0.45);\r
  let gullies=(ridge(vec2<f32>(cos(warp)*4.5+c.x,sin(warp)*4.5+g.x*2.3),3u)-0.5)*gate;\r
  let flank=crown*(1.0-smooth01(((g.x-g.y)/(apron-g.y)-0.55)/0.40));\r
  let rough=fbm((xy+vec2<f32>(volcanicParams(3u).x,0.0))/(720.0*c.y),0u,4u,0.5,0.0);\r
  let texture=(0.018*rough+(0.055*flutes+0.025*wall)*cone+(0.02+0.05*v5)*gullies*flank)*(1.0-interior)+0.012*crater*interior;\r
  return c.w*(0.035+cone+texture*(1.0-opening));\r
}\r
\r
// Signed union of lobes, bays and detached mesas; shared with the CPU shape.\r
fn plateauBoundary(xy:vec2<f32>)->vec2<f32>{\r
  let a=volcanicParams(0u);let b=volcanicParams(1u);let c=volcanicParams(2u);let d=(xy-a.xy)/a.z;\r
  let rotated=vec2<f32>(d.x*b.x+d.y*b.y,(-d.x*b.y+d.y*b.x)/a.w);\r
  let warped=rotated+0.10*vec2<f32>(fbm(xy/(700.0*c.y)+vec2<f32>(c.x,0.0),0u,3u,0.5,0.0),fbm(xy/(700.0*c.y)-vec2<f32>(0.0,c.x),1u,3u,0.5,0.0));\r
  let detached=b.w>0.72;var boundary=select(length(warped)-0.31,10.0,detached);\r
  let count=3u+u32(floor(b.w*5.0));\r
  for(var i=0u;i<count;i++){\r
    let f=f32(i);let angle=c.x*0.13+f*2.399963;\r
    let radius=0.28+0.29*(0.5+0.5*sin(c.x*0.37+f*1.71));\r
    let lobe=select(0.20,0.14,detached)+0.10*(0.5+0.5*sin(c.x*0.83+f*2.31));\r
    boundary=min(boundary,length(warped-radius*vec2<f32>(cos(angle),sin(angle)))-lobe);\r
  }\r
  if(b.w<0.45){let angle=c.x*0.21;boundary=max(boundary,0.27-length(warped-0.44*vec2<f32>(cos(angle),sin(angle))));}\r
  boundary=max(boundary,length(d)-0.80);\r
  return vec2<f32>(rotated.x,boundary);\r
}\r
fn plateauInfluence(xy:vec2<f32>)->f32{return 1.0-smooth01((plateauBoundary(xy).y+0.01)/0.15);}\r
fn plateauElevation(xy:vec2<f32>)->f32{\r
  let a=volcanicParams(0u);let b=volcanicParams(1u);let c=volcanicParams(2u);\r
  let apron=1.0-smooth01((plateauBoundary(xy).y+0.03)/0.10);\r
  // Former summit shelves/detail inside the retained multi-lobe footprint.\r
  let d=(xy-a.xy)/a.z;\r
  let rotated=vec2<f32>(d.x*b.x+d.y*b.y,(-d.x*b.y+d.y*b.x)/a.w);\r
  let radial=length(rotated);\r
  let summitBoundary=radial+0.12*fbm(xy/(840.0*c.y)+vec2<f32>(c.x,0.0),0u,4u,0.5,0.0)+0.025*fbm(xy/(500.0*c.y),1u,2u,0.5,0.0);\r
  let upper=(1.0-smooth01((summitBoundary-b.z)/0.11))*apron;\r
  let lobe=smooth01((fbm(xy/(650.0*c.y)+vec2<f32>(c.x,0.0),1u,3u,0.5,0.0)-0.03)/0.22);\r
  let buttes=smooth01((fbm(xy/(510.0*c.y)-vec2<f32>(c.x,0.0),0u,3u,0.5,0.0)-0.16)/0.22)*(1.0-smooth01((radial-1.0)/0.22));\r
  let remnant=ridge(xy/(250.0*c.y),4u);\r
  let rough=fbm((xy+vec2<f32>(volcanicParams(3u).x,0.0))/(720.0*c.y),0u,4u,0.5,0.0);\r
  return c.w*(0.06+0.60*apron+0.20*upper+0.035*lobe*apron+0.08*buttes*(1.0-apron)+0.012*remnant*upper+0.010*rough);\r
}\r
`,Yi=`// The dedicated third simplex stream matches Rust's shore-noise fork.\r
// Sixteen header vec4s (profile, unused offsets and turns, character, six bumps, then the\r
// relief fit: shift/median/inverse spread/drowning and band/shelf/sea count/field n), then\r
// the sea capsules, two vec4s each (endpoints; radii), then the optional row-major n*n\r
// sea field padded to a vec4, then each land capsule is three vec4s:\r
// endpoints; radii/scale/phase; islet height/center/apron. Same layout as Rust \`Coast\`.\r
@group(0) @binding(6) var<storage, read> coast: array<vec4<f32>>;\r
fn coastFieldValue(base:u32,k:u32)->f32 {\r
  return coast[base+k/4u][k%4u];\r
}\r
// Cell-centred bilinear sea distance, with constant extension beyond the grid.\r
fn coastSeaField(point:vec2<f32>,n:u32,base:u32)->f32 {\r
  let f=clamp(point*f32(n)-vec2<f32>(0.5),vec2<f32>(0.0),vec2<f32>(f32(n-1u)));\r
  let i0=vec2<u32>(floor(f));let i1=min(i0+vec2<u32>(1u),vec2<u32>(n-1u));\r
  let t=f-vec2<f32>(i0);\r
  let north=mix(coastFieldValue(base,i0.y*n+i0.x),coastFieldValue(base,i0.y*n+i1.x),t.x);\r
  let south=mix(coastFieldValue(base,i1.y*n+i0.x),coastFieldValue(base,i1.y*n+i1.x),t.x);\r
  return mix(north,south,t.y);\r
}\r
// The same C2 width field as Rust smoothing_width, from the shore-noise permutation.\r
fn coastSplineWeights(t:f32)->vec4<f32> {\r
  let t2=t*t;let t3=t2*t;\r
  return vec4<f32>((1.0-t)*(1.0-t)*(1.0-t),3.0*t3-6.0*t2+4.0,-3.0*t3+3.0*t2+3.0*t+1.0,t3)/6.0;\r
}\r
fn coastWidthWave(xy:vec2<f32>)->f32 {\r
  let point=xy/1200.0;let cell=vec2<i32>(floor(point));let f=fract(point);\r
  let wx=coastSplineWeights(f.x);let wy=coastSplineWeights(f.y);var wave=0.0;\r
  for(var j=0u;j<4u;j++){for(var i=0u;i<4u;i++){\r
    let cx=u32((cell.x+i32(i)-1)&255);let cy=u32((cell.y+i32(j)-1)&255);\r
    let value=f32(perm[1024u+cx+perm[1024u+cy]])/127.5-1.0;\r
    wave+=wx[i]*wy[j]*value;\r
  }}\r
  return tanh(2.0*wave);\r
}\r
fn coastalHeight(xy:vec2<f32>, terrainHeight:f32)->f32 {\r
  let config=coast[0];let mask=u32(config.x);\r
  if(mask==0u){return terrainHeight;}\r
  // Same marine datum and smooth positive floor as Rust coastal plains.\r
  var height=terrainHeight;\r
  let datum=coast[1].w;\r
  if(datum>0.0){let relative=height-datum;height=0.3+0.5*(relative+sqrt(relative*relative+1.0));}\r
  let uv=xy/p.values[0].x;let footprint=p.values[2].w/p.values[0].x;\r
  let seaCount=u32(coast[15].z);let fieldN=u32(coast[15].w);\r
  let fieldBase=16u+2u*seaCount;\r
  var distance=-2.0;var scale=0.2;var isletHeight=0.0;var apron=1.0;\r
  if(mask!=255u){\r
    let character=coast[6];let fine=coast[7];\r
    let warped=uv+character.x*vec2<f32>(fbm(uv/character.y+vec2<f32>(5.2,1.3),2u,3u,0.5,footprint/character.y),\r
      fbm(uv/character.y+vec2<f32>(-7.7,9.1),2u,3u,0.5,footprint/character.y));\r
    // Union of the traced field and edge-sea capsules, positive in the sea.\r
    var sea=-10.0;\r
    if(fieldN>0u){\r
      sea=coastSeaField(warped,fieldN,fieldBase);\r
    }\r
    for(var k=0u;k<seaCount;k++){\r
      let ends=coast[16u+k*2u];let radii=coast[17u+k*2u];let delta=ends.zw-ends.xy;\r
      let t=clamp(dot(warped-ends.xy,delta)/max(dot(delta,delta),1e-12),0.0,1.0);\r
      sea=max(sea,mix(radii.x,radii.y,t)-length(warped-ends.xy-t*delta));\r
    }\r
    distance=-sea\r
      +character.z*fbm(uv/character.w,2u,7u,0.56,footprint/character.w)\r
      +fine.x*fbm(uv/fine.y,2u,5u,0.55,footprint/fine.y);\r
  }\r
  var cachedPhase=-1.0;var detail=0.0;\r
  let land=fieldBase+(fieldN*fieldN+3u)/4u;\r
  for(var i=0u;i<u32(config.y);i++){\r
    let ends=coast[land+i*3u];let shape=coast[land+1u+i*3u];let geology=coast[land+2u+i*3u];let delta=ends.zw-ends.xy;\r
    let t=clamp(dot(uv-ends.xy,delta)/max(dot(delta,delta),1e-12),0.0,1.0);\r
    let base=mix(shape.x,shape.y,t)-length(uv-ends.xy-t*delta);let s=shape.z;\r
    if(base+s*0.165<=distance){continue;}\r
    if(shape.w!=cachedPhase){\r
      detail=s*(0.14*fbm(uv/(s*1.1)+vec2<f32>(shape.w,-shape.w),2u,7u,0.56,footprint/(s*1.1))\r
        +0.025*fbm(uv/(s*0.13)+vec2<f32>(-shape.w,shape.w),2u,4u,0.55,footprint/(s*0.13)));\r
      cachedPhase=shape.w;\r
    }\r
    if(base+detail>distance){\r
      distance=base+detail;scale=s;apron=geology.w;\r
      // Same shared rise as Rust: a few meters, no tiny-islet or rocky relief.\r
      isletHeight=geology.x;\r
      if(apron>1.0){\r
        let size=smooth01((s/3.0-0.009)/0.016);\r
        let radial=length(uv-geology.yz)/(s*0.6);\r
        let rise=8.0*(0.75+0.25*cos(shape.w));\r
        isletHeight+=rise*size*(1.0-smooth01(radial));\r
      }\r
    }\r
  }\r
  // Seeded bays and headlands, as in Rust; islets keep their own outline.\r
  if(isletHeight==0.0){\r
    for(var k=0u;k<min(u32(coast[7].z),6u);k++){\r
      let bump=coast[8u+k];let d2=dot(uv-bump.xy,uv-bump.xy)/(bump.z*bump.z);\r
      if(d2<1.0){distance+=bump.w*(1.0-d2)*(1.0-d2);}\r
    }\r
    // Fitted shift and relief drowning, as Rust \`Coast::distance\`.\r
    let fit=coast[14];distance+=fit.x;\r
    if(fit.z!=0.0){distance+=fit.w*tanh(clamp((height-fit.y)*fit.z,-9.0,9.0))*smooth01(1.0-abs(distance)/coast[15].x);}\r
  }\r
  if(isletHeight>0.0){height=isletHeight;}\r
  let widthVariation=0.65+1.1*smooth01(fbm(uv/0.21+vec2<f32>(11.7,-4.2),2u,3u,0.5,0.0)+0.5);\r
  let ramp=min(max(config.z,height/(p.values[0].x*0.45)),scale*0.18)*widthVariation*apron;\r
  if(distance<=0.0){return -config.w*smooth01(-distance/(ramp*4.0*coast[15].y));}\r
  // Smooth low-frequency stretches of variable width, matching Rust smoothing_width.\r
  let profile=coast[1];\r
  var band=profile.x;\r
  if(profile.y>0.0){band*=1.0+profile.y*coastWidthWave(xy);}\r
  if(band<=0.0){return height;}\r
  return height*smooth01(distance*p.values[0].x/band);\r
}\r
`;let ft;const Vi=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Tt(){return ft??=(async()=>{const r=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!r)return;const{maxBufferSize:t,maxStorageBufferBindingSize:i}=r.limits,n=await r.requestDevice({requiredFeatures:r.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:t,maxStorageBufferBindingSize:i}}),a={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{a.lost=!0,ft=void 0}),a})().catch(()=>{}),ft}async function Ji(r,t){if(r==="wasm")return;const i=await Tt();if(!i||i.lost)return;const n=t==="flat"?0:t==="valley"?2:t==="volcano"||t==="caldera"||t==="plateau"?3:1,a=`${r}:${n}`;let o=i.pipelines.get(a);return o||(o=(async()=>{const l=$i.replace("// NOISE_KERNEL",Bt).replace("// VOLCANIC_KERNEL",Rn).replace("// COAST_KERNEL",Yi),u=i.device.createShaderModule({code:l});return i.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),o.catch(()=>{}),i.pipelines.set(a,o)),{context:i,pipeline:o}}const Ki=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Zt(r,t,i){const n=r.device,a=er(t).n,o=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),l=t.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=l.map(c=>{const f=`generation:${c}`;let d=r.pipelines.get(f);if(!d){const y=n.createShaderModule({code:Wi.replace("// NOISE_KERNEL",Bt)});d=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[o]}),compute:{module:y,entryPoint:c}}),r.pipelines.set(f,d)}return d}),s=jr.generation_at_resolution(t.seed,t.width,t.relief,t.motifSize,a),e=[];try{const c=s.parameters();t.procedural?.regionalN&&(c[2]=t.procedural.regionalN,c[4]=t.width*1.44/c[2]),c[6]*=t.procedural?.noiseScale??1;const f=(m,g)=>{const h=n.createBuffer({size:m.byteLength,usage:g|GPUBufferUsage.COPY_DST});return e.push(h),n.queue.writeBuffer(h,0,m),h},d=[f(c,GPUBufferUsage.UNIFORM),f(s.permutations(),GPUBufferUsage.STORAGE),f(s.gradients(),GPUBufferUsage.STORAGE)];i?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const y=await xr(Promise.all(u));i?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const b=l.map(m=>m==="coarse"?c[2]:c[1]).map((m,g)=>{const h=m*m*16,p=n.createBuffer({size:h,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),N=n.createBuffer({size:h,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});e.push(p,N);const C=n.createBindGroup({layout:y[g].getBindGroupLayout(0),entries:[...d,p].map((_,S)=>({binding:S,resource:{buffer:_}}))}),E=n.createCommandEncoder(),G=E.beginComputePass();return G.setPipeline(y[g]),G.setBindGroup(0,C),G.dispatchWorkgroups(Math.ceil(m/8),Math.ceil(m/8)),G.end(),E.copyBufferToBuffer(p,0,N,0,h),n.queue.submit([E.finish()]),N}),w=n.queue.onSubmittedWorkDone().then(()=>i?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),P=await Promise.all(b.map(async m=>{await m.mapAsync(GPUMapMode.READ);const g=new Float32Array(m.getMappedRange().slice(0));return m.unmap(),g}));return await w,{coarse:l.length===2?P[0]:new Float32Array,fine:P[P.length-1]}}finally{s.free(),e.forEach(c=>c.destroy())}}class Qt{constructor(t,i,n,a){this.state=t,this.pipeline=i,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=a.sampling_parameters(),this.sourceN=a.source_resolution();let o=0;for(let e=this.sourceN;e>=1;e=Math.floor(e/2))o+=e*e;const l=this.parameters[5]===3?2:1;if(o*l*4>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=a.sampling_field();this.hasField=u.length>0;const s=u.length?u:new Float32Array(1);if(s.byteLength>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(s),this.perm=this.upload(a.sampling_permutations()),this.gradients=this.upload(a.sampling_gradients()),this.branches=this.upload(a.sampling_branches()),this.coast=this.upload(a.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(t,i=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,t.byteLength),usage:i|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,t),n}prepareCoastField(t){return this.dispatchField({x:0,y:0,extent:t.width,resolution:this.sourceN},t),this.output}dispatchField(t,i){const{x:n,y:a,extent:o,resolution:l}=t;if(![n,a,o,l].every(Number.isFinite)||n<0||a<0||o<=0||n+o>i.width+1e-4||a+o>i.width+1e-4||!Number.isInteger(l)||l<16||l>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,s=o/l,e=Math.max(i.motifSize/65536,s*.5),c=this.parameters,f=Math.floor(Math.log2(this.sourceN)),d=Math.min(f,Math.log2(Math.max(1,s*(i.relief==="flat"&&c[5]!==4?2/i.motifSize:1/i.width)*this.sourceN))),y=new Float32Array([c[0],c[1],c[2],c[3],c[4],c[5],this.hasField?1:0,l,n,a,o,s,Math.floor(d),Math.min(f,Math.floor(d)+1),d-Math.floor(d),e,c[6],c[7],this.sourceN,f,...Array.from({length:16},(P,m)=>c[8+m]??0)]),x=l*l*16;x>this.capacity&&(this.output?.destroy(),this.capacity=x,this.output=u.createBuffer({size:x,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((P,m)=>({binding:m,resource:{buffer:P}}))})),u.queue.writeBuffer(this.uniform,0,y);const b=u.createCommandEncoder(),w=b.beginComputePass();w.setPipeline(this.pipeline),w.setBindGroup(0,this.group),w.dispatchWorkgroups(Math.ceil(l/8),Math.ceil(l/8)),w.end(),u.queue.submit([b.finish()])}async sample(t,i,n,a){const o=performance.now(),l=this.state.device,{x:u,y:s,extent:e,resolution:c}=t;this.dispatchField(t,i);const f=c*c*16,d=l.createCommandEncoder();(!this.readback||this.readback.size<f)&&(this.readback?.destroy(),this.readback=l.createBuffer({size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),d.copyBufferToBuffer(this.output,0,this.readback,0,f),l.queue.submit([d.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,f);const y=this.readback.getMappedRange(0,f).slice(0);this.readback.unmap();const x=new Float32Array(y),b=new Float32Array(c*c),w=new Float32Array(c*c),P=new Float32Array(c*c),m=new Float32Array(c*c);let g=1/0,h=-1/0;for(let p=0;p<c*c;p++){const N=p*4;b[p]=x[N],w[p]=x[N+1],P[p]=x[N+2],m[p]=x[N+3],g=Math.min(g,b[p]),h=Math.max(h,b[p])}if(!Number.isFinite(g)||!Number.isFinite(h))throw new Error("Sortie GPU non finie.");return{x:u,y:s,width:e,resolution:c,minHeight:g,maxHeight:h,globalMinHeight:n,globalMaxHeight:a,motifSize:i.motifSize,height:b,normalX:w,normalY:P,normalZ:m,caveMask:new Uint8Array,generationMs:performance.now()-o,backend:this.mode,samplingMs:performance.now()-o}}dispose(){this.buffers.forEach(t=>t.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}const Xi=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
fn compactWeights(t:f32)->vec4<f32>{let q=1.0-t;return vec4<f32>(q*q*q,3.0*t*t*t-6.0*t*t+4.0,-3.0*t*t*t+3.0*t*t+3.0*t+1.0,t*t*t)/6.0;}\r
fn compactRegional(pos:vec2<f32>)->f32{\r
  let xy=vec2<i32>(floor(pos));let wx=compactWeights(fract(pos.x));let wy=compactWeights(fract(pos.y));var value=0.0;\r
  for(var y=0u;y<4u;y++){for(var x=0u;x<4u;x++){value+=wx[x]*wy[y]*at(xy+vec2<i32>(i32(x)-1,i32(y)-1),false);}}\r
  return value;\r
}\r
\r
// Unlike the old smoothstep, regional mountain coverage has no clipped upper band.\r
fn compactMountainWeight(distribution:f32,mix:f32)->f32{\r
  let x=(distribution+(mix-.5)*1.4)/.28;\r
  return .5+.5*x/sqrt(1.0+x*x);\r
}\r
@compute @workgroup_size(256)\r
fn compactInitialize(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count()){return;}let n=size();\r
  let xy=(vec2<f32>(f32(i%n),f32(i/n))+.5)*p.values[1].x+p.values[1].y;\r
  let env=fbm(xy/p.values[1].z+vec2<f32>(3.1,-1.7),0u,3u,.5,0.0);\r
  let distribution=fbm(xy/(2700.0*p.values[0].w)+vec2<f32>(8.4,0.0),1u,3u,.5,0.0);\r
  let mix=p.values[3].z;\r
  let mountains=select(smooth01((distribution+(mix-.5)*1.4+.28)/.56),compactMountainWeight(distribution,mix),p.values[7].x>0.0);\r
  let q=dot(xy-p.values[0].x*.5,p.values[5].xy)/p.values[0].x;\r
  let skeleton=ridge(xy/p.values[1].z+vec2<f32>(5.7,-3.2),3u);\r
  let crest=1.0+p.values[7].x*mountains*(.24+1.8*skeleton*skeleton-1.0);\r
  let u=max(.12,.7+.5*env-.25*q)*(.20+.80*mountains)*crest;\r
  let border=f32(min(min(i%n,i/n),min(n-1u-i%n,n-1u-i/n)))/(.1*f32(n));\r
  nodes[i].uplift=u*(.25+.75*smooth01(border));\r
  nodes[i].routingPriority=seededRoutingPriority(i);\r
  nodes[i].h=select(2.5*u+.6*fbm(xy/p.values[1].w,1u,3u,.5,0.0),0.0,edge(i));nodes[i].acc=1.0;\r
}\r
\r
// Compact-source detail. Same scalar equations as terrainPhasor.ts.\r
fn phSmooth(a:f32,b:f32,v:f32)->f32{let t=clamp((v-a)/(b-a),0.0,1.0);return t*t*(3.0-2.0*t);}\r
fn phHash(x:i32,y:i32,seed:u32)->f32{\r
  var h=(bitcast<u32>(x)*0x1f123bb5u) ^ (bitcast<u32>(y)*0x5f356495u) ^ seed;\r
  h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return f32(h^(h>>16u))/4294967296.0;\r
}\r
fn phHeight(pos:vec2<f32>)->f32{\r
  let n=sourceSize();let q=clamp(pos/p.values[8].x-0.5,vec2<f32>(0.0),vec2<f32>(f32(n-1u)));let a=vec2<u32>(floor(q));let t=fract(q);\r
  let b=min(a+1u,vec2<u32>(n-1u));\r
  return mix(mix(fine[a.y*n+a.x].x,fine[a.y*n+b.x].x,t.x),mix(fine[b.y*n+a.x].x,fine[b.y*n+b.x].x,t.x),t.y);\r
}\r
fn compactPhasor(i:u32)->f32{\r
  let h=fine[i].x;let intensity=p.values[8].z;if(intensity<=0.0){return h;}\r
  let cell=p.values[8].x;let n=sourceSize();let pos=(vec2<f32>(f32(i%n),f32(i/n))+0.5)*cell;\r
  let span=max(cell,p.values[8].w*.3);\r
  let ex=vec2<f32>(span,0.0);let ey=vec2<f32>(0.0,span);\r
  let l=phHeight(pos-ex);let r=phHeight(pos+ex);let t=phHeight(pos-ey);let b=phHeight(pos+ey);\r
  let slope=length(vec2<f32>(r-l,b-t))/(2.0*span);let curvature=(l+r+t+b-4.0*h)/(span*span);\r
  let mask=phSmooth(.012,.20,slope)*(1.0-phSmooth(.0005,.004,curvature))*phSmooth(1.0,12.0,h);\r
  if(mask<=0.0){return h;}\r
  let seed=u32(p.values[8].y);var delta=0.0;var parent=1.0;var wave=p.values[8].w;\r
  for(var octave=0u;octave<3u;octave++){\r
    let resolved=phSmooth(4.0,7.0,wave/cell);\r
    if(resolved>0.0){\r
      let c=vec2<i32>(floor(pos/wave));var re=0.0;var im=0.0;var weight=0.0;\r
      for(var dy=-2;dy<=2;dy++){for(var dx=-2;dx<=2;dx++){\r
        let ix=c.x+dx;let iy=c.y+dy;let key=seed+octave*17u;\r
        let point=(vec2<f32>(f32(ix),f32(iy))+.15+.7*vec2<f32>(phHash(ix,iy,key),phHash(ix,iy,key+1u)))*wave;\r
        let off=(pos-point)/wave;let radius=length(off);if(radius>=2.0){continue;}\r
        let step=max(cell,wave*.4);let ox=vec2<f32>(step,0.0);let oy=vec2<f32>(0.0,step);\r
        let g=vec2<f32>(phHeight(point+ox)-phHeight(point-ox),phHeight(point+oy)-phHeight(point-oy));let len=max(1e-6,length(g));\r
        let jitter=(phHash(ix,iy,key+2u)-.5)*.5;let cs=cos(jitter);let sn=sin(jitter);\r
        let across=vec2<f32>(-g.y*cs-g.x*sn,-g.y*sn+g.x*cs)/len;\r
        let angle=6.28318530718*(dot(off,across)*(.85+.3*phHash(ix,iy,seed+3u))+phHash(ix,iy,seed+4u));\r
        let w=exp(-2.0*dot(off,off))*(1.0-phSmooth(1.3,2.0,radius));re+=w*cos(angle);im+=w*sin(angle);weight+=w;\r
      }}\r
      let cosine=clamp(re/sqrt(re*re+im*im+.015*weight*weight+1e-12),-1.0,1.0);let pattern=.636619772368*asin(cosine);\r
      delta+=min(wave*.025,slope*wave*.12)*intensity*mask*resolved*parent*pattern;\r
      parent*=.2*phSmooth(-.8,.7,pattern);\r
    }\r
    wave/=3.0;\r
  }\r
  return max(.3,h+delta);\r
}\r
\r
// Optional inspector reconstruction warp; the compact fast default remains zero.\r
fn compactReconstructionPoint(xy:vec2<f32>)->vec2<f32>{\r
 let warp=p.values[13].y*min(16.0*p.values[0].w,p.values[1].x*.9);\r
 if(warp==0.0){return xy;}\r
 return xy+warp*vec2<f32>(fbm(xy/p.values[2].x+vec2<f32>(11.3,0.),1u,2u,.5,0.),fbm(xy/p.values[2].x+vec2<f32>(-4.7,2.9),1u,2u,.5,0.));\r
}\r
\r
// The compact preset's positive reconstruction, selected by the shared scheduler.\r
@compute @workgroup_size(256)\r
fn compactReconstruct(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);let n=sourceSize();if(i>=n*n){return;}let xy=(vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[2].w;var r=0.0;if(p.values[4].x>0.0 && !openSeaSource(i)){r=ridge(xy/p.values[2].y,u32(p.values[2].z));}fine[i]=vec4<f32>(compactRegional((compactReconstructionPoint(xy)-p.values[1].y)/p.values[1].x-0.5),1.0,r,0.0);}\r
`,Zi=`// Inspector-only readout. It never modifies simulation heights or drainage.\r
@compute @workgroup_size(256)\r
fn generationPreview(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){\r
  let i=cellId(id,groups);let n=sourceSize();if(i>=n*n){return;}let mode=p.values[7].w;\r
  if(mode==1.0){outputHeight[i]=fine[i].x;}\r
  else if(mode==2.0){outputHeight[i]=fine[i].w;}\r
  // Show the calibrated height now, without changing fine.x read by detail's gradients.\r
  else if(mode==4.0){outputHeight[i]=max(.3,fine[i].x*p.values[3].x*(1.-.2*p.values[4].z)/control.p99);}\r
  else if(mode==5.0){outputHeight[i]=fine[i].x*p.values[3].x*(1.-.2*p.values[4].z)/control.p99;}\r
  else{let xy=(vec2<f32>(f32(i%n),f32(i/n))+.5)*p.values[2].w;outputHeight[i]=sample((xy-p.values[1].y)/p.values[1].x-.5,false);}\r
}\r
\r
@compute @workgroup_size(256)\r
fn generationPlainPack(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);if(i<sourceCount()){outputHeight[i]=fine[i].x;}}\r
\r
// Preserve the other simulation channels when applying an early coast.\r
@compute @workgroup_size(256)\r
fn generationRegionalRead(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<count()){outputHeight[id.x]=nodes[id.x].h;}}\r
@compute @workgroup_size(256)\r
fn generationCut(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){\r
  let i=cellId(id,groups);let mode=p.values[7].w;\r
  if(mode==0.0){if(i<count()){nodes[i].h=outputHeight[i];}return;}\r
  if(i>=sourceCount()){return;}\r
  if(mode==4.0){fine[i].x=outputHeight[i]*control.p99/max(.0001,p.values[3].x*(1.-.2*p.values[4].z));}\r
  else if(mode==2.0){fine[i].w=outputHeight[i];}\r
  else{fine[i].x=outputHeight[i];}\r
}\r
@compute @workgroup_size(256)\r
fn generationPhasorPack(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);if(i>=sourceCount()){return;}if(openSeaSource(i)){outputHeight[i]=fine[i].x;}else{outputHeight[i]=compactPhasor(i);}}\r
\r
@compute @workgroup_size(1)\r
fn generationUnitScale(){control.p99=max(.0001,p.values[3].x*(1.0-.2*p.values[4].z));}\r
@compute @workgroup_size(256)\r
fn generationKeepDatum(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);if(i<sourceCount()){fine[i].x=max(.3,fine[i].w);}}\r
@compute @workgroup_size(256)\r
fn generationReconstruct(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){\r
 let i=cellId(id,groups);let n=sourceSize();if(i>=n*n){return;}let xy=(vec2<f32>(f32(i%n),f32(i/n))+.5)*p.values[2].w;\r
 let pos=(compactReconstructionPoint(xy)-p.values[1].y)/p.values[1].x-.5;\r
 var h=0.;if(p.values[7].w==1.0){h=compactRegional(pos);}else{h=sample(pos,false);}\r
 var r=.5;if(p.values[4].x>0. && !openSeaSource(i)){r=ridge(xy/p.values[2].y,u32(p.values[2].z));}\r
 let drainage=sample((xy-p.values[1].y)/p.values[1].x-.5,true);\r
 fine[i]=vec4<f32>(h,1.-.85*p.values[4].z*smooth01((drainage-4.)/max(12.,f32(count())*.001-4.)),r,0.);\r
}\r
`,Qi=`// Full FP32 regional erosion. Dispatches are global synchronization boundaries.\r
// values[12..14]: overridable settings (fill ×, sill carve, final carve, incision\r
// slope | thermal ×, warp ×, routed surface, surface carve); see GenerationNoisePlan.\r
struct Params { values: array<vec4<f32>, 14> }\r
struct Node {\r
  h: f32, uplift: f32, acc: f32, receiver: i32,\r
  flood: array<vec2<f32>,2>, flow: vec4<f32>, state: array<vec2<f32>,2>,\r
  thermal: vec2<f32>, nextH: f32, routingPriority: f32,\r
  parent: atomic<u32>, bottom: atomic<u32>, spill: atomic<u32>, pour: atomic<u32>,\r
  breached: atomic<u32>,\r
}\r
struct Control {\r
  flags: array<atomic<u32>,2>, errors: atomic<u32>, seaReady: u32,\r
  histogram: array<atomic<u32>,256>,\r
  prefix: u32, quantileIndex: u32, selected: u32, pad: u32,\r
  p99: f32, p1: f32,\r
  solveSteps:u32, maxSolveSteps:array<u32,4>,\r
  // 128² bits over the map. They travel with stage checkpoints, as \`control\` does.\r
  seaLand:array<atomic<u32>,512>, openSea:array<u32,512>,\r
}\r
@group(0) @binding(0) var<uniform> p: Params;\r
@group(0) @binding(1) var<storage, read> perm: array<u32>;\r
@group(0) @binding(2) var<storage, read> gradients: array<vec2<f32>>;\r
@group(0) @binding(3) var<storage, read_write> nodes: array<Node>;\r
@group(0) @binding(4) var<storage, read_write> fine: array<vec4<f32>>;\r
@group(0) @binding(5) var<storage, read_write> control: Control;\r
@group(0) @binding(6) var<storage, read_write> outputHeight: array<f32>;\r
@group(0) @binding(7) var<storage, read_write> tileFlags: array<atomic<u32>>;\r
// NOISE_KERNEL\r
fn volcanicParams(i:u32)->vec4<f32>{return p.values[8u+i];}\r
// VOLCANIC_KERNEL\r
const directions = array<vec2<i32>,8>(vec2<i32>(1,0),vec2<i32>(1,1),vec2<i32>(0,1),vec2<i32>(-1,1),vec2<i32>(-1,0),vec2<i32>(-1,-1),vec2<i32>(0,-1),vec2<i32>(1,-1));\r
const distances = array<f32,8>(1.0,1.4142135623730951,1.0,1.4142135623730951,1.0,1.4142135623730951,1.0,1.4142135623730951);\r
fn size() -> u32 {return u32(p.values[0].z);}\r
fn count() -> u32 {return size()*size();}\r
// Physical source grid, read from the uniform: changing it recompiles nothing.\r
fn sourceSize() -> u32 {return u32(p.values[0].y);}\r
fn sourceCount() -> u32 {return sourceSize()*sourceSize();}\r
// Above 65535 workgroups a source dispatch spills into y; the linear index is unchanged.\r
fn cellId(id:vec3<u32>,groups:vec3<u32>) -> u32 {return id.y*groups.x*256u+id.x;}\r
// Open sea: farther from land than the stages it skips can reach. \`seaReady\` stays\r
// zero until a coast is cut, so maps without sea pay one uniform-like load. A mask\r
// cell spans whole waves on large sources, which then skip together.\r
fn seaCell(xy:vec2<f32>)->i32 {\r
  let q=vec2<i32>(floor(xy/p.values[0].x*128.0));\r
  if(any(q<vec2<i32>(0)) || any(q>=vec2<i32>(128))){return -1;}\r
  return q.y*128+q.x;\r
}\r
fn openSeaAt(xy:vec2<f32>)->bool {\r
  if(control.seaReady==0u){return false;}\r
  let k=seaCell(xy);if(k<0){return false;}\r
  return (control.openSea[u32(k)>>5u]&(1u<<(u32(k)&31u)))!=0u;\r
}\r
fn openSeaSource(i:u32)->bool {let n=sourceSize();return openSeaAt((vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[2].w);}\r
fn edge(i:u32) -> bool {let n=size();return i%n==0u || i/n==0u || i%n==n-1u || i/n==n-1u;}\r
fn neighbor(i:u32,d:u32) -> i32 {\r
  let n=i32(size());let q=vec2<i32>(i32(i)%n,i32(i)/n)+directions[d];\r
  if(any(q<vec2<i32>(0)) || any(q>=vec2<i32>(n))){return -1;}\r
  return q.y*n+q.x;\r
}\r
fn ordered(v:f32)->u32 {let b=bitcast<u32>(v);return select(b^0x80000000u,~b,(b&0x80000000u)!=0u);}\r
fn decoded(v:u32)->f32{return bitcast<f32>(select(~v,v^0x80000000u,(v&0x80000000u)!=0u));}\r
fn rootOf(i:u32)->u32 {\r
  var r=i;\r
  // Parents decrease monotonically; at most count() hops, with an explicit\r
  // final return for compilers which conservatively analyze loop exits.\r
  for(var step=0u;step<count();step++) {\r
    let next=atomicLoad(&nodes[r].parent);\r
    if(next==r || next==0xffffffffu){return next;}\r
    r=next;\r
  }\r
  atomicAdd(&control.errors,1u);\r
  return r;\r
}\r
fn lower(a:vec2<f32>,b:vec2<f32>)->bool {return a.x<b.x || (a.x==b.x && a.y<b.y);}\r
fn seededRoutingPriority(i:u32)->f32 {\r
  var tie=i^perm[(i>>8u)&255u];tie=(tie^(tie>>16u))*0x7feb352du;tie=(tie^(tie>>15u))*0x846ca68bu;tie^=tie>>16u;\r
  return 0.5+f32(tie&65535u)/65535.0;\r
}\r
@compute @workgroup_size(256)\r
fn initialize(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count()){return;}let n=size();\r
  let xy=(vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[1].x+p.values[1].y;\r
  let env=fbm(xy/p.values[1].z+vec2<f32>(3.1,-1.7),0u,3u,0.5,0.0);\r
  let distribution=fbm(xy/(2700.0*p.values[0].w)+vec2<f32>(8.4,0.0),1u,3u,0.5,0.0);\r
  let mountains=smooth01((distribution+(p.values[3].z-0.5)*1.4+0.28)/0.56);\r
  let q=dot(xy-p.values[0].x*0.5,p.values[5].xy)/p.values[0].x;\r
  let skeleton=ridge(xy/p.values[1].z+vec2<f32>(5.7,-3.2),3u);\r
  let crest=1.0+p.values[7].x*mountains*(0.24+1.8*skeleton*skeleton-1.0);\r
  let u=max(0.12,0.7+0.5*env-0.25*q)*(0.20+0.80*mountains)*crest;\r
  let border=f32(min(min(i%n,i/n),min(n-1u-i%n,n-1u-i/n)))/(0.1*f32(n));\r
  nodes[i].uplift=u*(0.25+0.75*smooth01(border));\r
  // Seeded tie priority replaces the CPU heap's incidental order on equal\r
  // water levels. It affects routing only, never physical height/noise.\r
  nodes[i].routingPriority=seededRoutingPriority(i);\r
  nodes[i].h=select(2.5*u+0.6*fbm(xy/p.values[1].w,1u,3u,0.5,0.0),0.0,edge(i));nodes[i].acc=1.0;\r
}\r
@compute @workgroup_size(256)\r
fn uplift(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}nodes[i].h=select(nodes[i].h+nodes[i].uplift*p.values[4].w,0.0,edge(i));}\r
@compute @workgroup_size(1)\r
fn start(){atomicStore(&control.flags[0],1u);atomicStore(&control.flags[1],1u);control.solveSteps=0u;}\r
@compute @workgroup_size(1)\r
fn clearNext(){let phase=u32(p.values[6].x);if(atomicLoad(&control.flags[phase])!=0u){control.solveSteps++;}atomicStore(&control.flags[1u-phase],0u);}\r
@compute @workgroup_size(1)\r
fn solveStats(){let mode=u32(p.values[6].y);control.maxSolveSteps[mode]=max(control.maxSolveSteps[mode],control.solveSteps);}\r
@compute @workgroup_size(256)\r
fn floodInit(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;let tiles=(size()+15u)/16u;let tileCount=tiles*tiles;\r
  if(i<tileCount){atomicStore(&tileFlags[i],1u);atomicStore(&tileFlags[tileCount+i],0u);}\r
  if(i>=count()){return;}nodes[i].flood[0]=select(vec2<f32>(3.4e38,1e9),vec2<f32>(nodes[i].h,0.0),edge(i));nodes[i].flood[1]=nodes[i].flood[0];\r
}\r
var<workgroup> tileA:array<vec2<f32>,324>;\r
var<workgroup> tileB:array<vec2<f32>,324>;\r
var<workgroup> tileH:array<f32,324>;\r
var<workgroup> tileCost:array<f32,324>;\r
var<workgroup> tileFlow:array<vec4<f32>,324>;\r
var<workgroup> tileActive:u32;\r
var<workgroup> tileChanged:atomic<u32>;\r
var<workgroup> roundChanged:atomic<u32>;\r
override SOLVE_MODE:u32=0u;\r
fn tileState(k:u32,step:u32)->vec2<f32>{if((step&1u)==0u){return tileA[k];}return tileB[k];}\r
// 16x16 interior plus a one-cell halo. Halo is immutable for one dispatch.\r
@compute @workgroup_size(16,16)\r
fn solveTile(@builtin(local_invocation_id) local:vec3<u32>,@builtin(workgroup_id) group:vec3<u32>){\r
  let lane=local.y*16u+local.x;let phase=u32(p.values[6].x);let mode=SOLVE_MODE;\r
  let tiles=(size()+15u)/16u;let tileId=group.y*tiles+group.x;let epoch=control.solveSteps;\r
  if(lane==0u){\r
    tileActive=atomicLoad(&control.flags[phase]);atomicStore(&tileChanged,0u);\r
    if(tileActive!=0u){\r
      tileActive=select(0u,1u,atomicLoad(&tileFlags[phase*tiles*tiles+tileId])==epoch);\r
    }\r
  }\r
  let run=workgroupUniformLoad(&tileActive);if(run==0u){return;}\r
  if(mode!=0u){\r
    let xy=group.xy*16u+local.xy;let valid=all(xy<vec2<u32>(size()));let i=xy.y*size()+xy.x;\r
    var state=vec2<f32>(0.0,1.0);if(valid){state=nodes[i].state[phase];}\r
    if(state.y==0.0){atomicStore(&tileChanged,1u);}workgroupBarrier();\r
    if(lane==0u){tileActive=atomicLoad(&tileChanged);}\r
    let unresolved=workgroupUniformLoad(&tileActive);\r
    if(unresolved==0u){\r
      // A completed graph cell never changes again. Synchronize the opposite\r
      // global phase before skipping this tile's halo loads and local rounds.\r
      if(valid){nodes[i].state[1u-phase]=state;}return;\r
    }\r
    if(lane==0u){atomicStore(&tileChanged,0u);}workgroupBarrier();\r
  }\r
  let base=vec2<i32>(group.xy*16u)-1;let n=i32(size());\r
  for(var k=lane;k<324u;k+=256u){\r
    let xy=base+vec2<i32>(i32(k%18u),i32(k/18u));\r
    var state=vec2<f32>(3.4e38,1e9);var h=3.4e38;var cost=1.0;var flow=vec4<f32>(-1.0);\r
    if(all(xy>=vec2<i32>(0)) && all(xy<vec2<i32>(n))){let i=u32(xy.y*n+xy.x);if(mode==0u){h=nodes[i].h;cost=nodes[i].routingPriority;state=nodes[i].flood[phase];}else{if(mode==1u){flow=nodes[i].flow;}state=nodes[i].state[phase];}}\r
    tileA[k]=state;tileB[k]=state;\r
    if(mode==0u){tileH[k]=h;tileCost[k]=cost;}else if(mode==1u){tileFlow[k]=flow;}\r
  }\r
  workgroupBarrier();\r
  let xy=group.xy*16u+local.xy;let valid=all(xy<vec2<u32>(size()));let i=xy.y*size()+xy.x;let k=(local.y+1u)*18u+local.x+1u;\r
  let original=tileA[k];\r
  var incisionFactor=0.0;var ownFlow=vec4<f32>(-1.0);var ownHeight=0.0;\r
  if(valid && mode>=2u){incisionFactor=nodes[i].nextH;ownFlow=nodes[i].flow;ownHeight=nodes[i].h;}\r
  var value=original;\r
  for(var step=0u;step<16u;step++){\r
    if((step&3u)==0u){if(lane==0u){atomicStore(&roundChanged,0u);}workgroupBarrier();}\r
    let previous=value;\r
    if(valid){\r
      if(mode==0u){\r
        if(!edge(i)){\r
          for(var d=0u;d<8u;d++){let j=u32(i32(k)+directions[d].y*18+directions[d].x);let a=tileState(j,step);let level=max(tileH[k],a.x);\r
            if(level>value.x){continue;}\r
            // Prefer existing low terrain inside a filled basin. A positive\r
            // seeded cost breaks equal-level routing ties without raising h.\r
            var distance=0.0;\r
            if(tileH[k]<=a.x){\r
              if(level==value.x && a.y>=value.y){continue;}\r
              let depthCost=1.0+8.0*exp(-max(0.0,level-(tileH[k]+tileH[j])*0.5)/max(0.1,p.values[1].x*0.1));\r
              let tieCost=(tileCost[k]+tileCost[j])*0.5;\r
              distance=a.y+distances[d]*depthCost*tieCost;\r
            }\r
            let candidate=vec2<f32>(level,distance);if(lower(candidate,value)){value=candidate;}}\r
        }\r
      } else if(value.y==0.0){\r
        var ready=true;var result=1.0;\r
        if(mode==1u){\r
          for(var d=0u;d<8u;d++){let j=u32(i32(k)+directions[d].y*18+directions[d].x);let f=tileFlow[j];var weight=0.0;if(f.x==f32(i)){weight+=1.0-f.z;}if(f.y==f32(i)){weight+=f.z;}if(weight>0.0){let state=tileState(j,step);if(state.y==0.0){ready=false;break;}result+=state.x*weight;}}\r
        } else {\r
          let f=ownFlow;result=ownHeight;\r
          if(f.x>=0.0){\r
            let a=u32(f.x);let offset=vec2<i32>(i32(a%size())-i32(xy.x),i32(a/size())-i32(xy.y));let j=u32(i32(k)+offset.y*18+offset.x);let state=tileState(j,step);var low=state.x;ready=state.y!=0.0;\r
            if(f.y>=0.0 && f.z>0.0){let b=u32(f.y);let off=vec2<i32>(i32(b%size())-i32(xy.x),i32(b/size())-i32(xy.y));let s=u32(i32(k)+off.y*18+off.x);let other=tileState(s,step);low=(1.0-f.z)*low+f.z*other.x;ready=ready && other.y!=0.0;}\r
            result=min(result,(result+incisionFactor*low)/(1.0+incisionFactor));\r
          }\r
        }\r
        if(ready){value=vec2<f32>(result,1.0);}\r
      }\r
    }\r
    // Identical Jacobi rounds, alternating the two shared arrays. Both halos\r
    // remain immutable. A fixed point over four rounds needs no further work.\r
    if(any(value!=previous)){atomicStore(&roundChanged,1u);}\r
    if((step&1u)==0u){tileB[k]=value;}else{tileA[k]=value;}workgroupBarrier();\r
    if((step&3u)==3u){\r
      if(lane==0u){tileActive=atomicLoad(&roundChanged);}\r
      let changed=workgroupUniformLoad(&tileActive);if(changed==0u){break;}\r
    }\r
  }\r
  if(valid){\r
    if(mode==0u){nodes[i].flood[1u-phase]=value;}else{nodes[i].state[1u-phase]=value;}\r
    if(any(value!=original)){\r
      // Wake self to continue propagation and synchronize both global phases.\r
      // Only changed halo cells can affect another tile: edge/corner bits name\r
      // the corresponding destinations in a row-major 3x3 neighborhood.\r
      var mask=16u;\r
      if(local.x==0u){mask|=8u;}if(local.x==15u){mask|=32u;}\r
      if(local.y==0u){mask|=2u;}if(local.y==15u){mask|=128u;}\r
      if(local.x==0u && local.y==0u){mask|=1u;}if(local.x==15u && local.y==0u){mask|=4u;}\r
      if(local.x==0u && local.y==15u){mask|=64u;}if(local.x==15u && local.y==15u){mask|=256u;}\r
      atomicOr(&tileChanged,mask);\r
    }\r
  }\r
  // Convergence is a Boolean OR: one device-wide write per changed tile avoids\r
  // hundreds of thousands of contenders on the same global flag.\r
  workgroupBarrier();\r
  if(lane==0u && atomicLoad(&tileChanged)!=0u){\r
    atomicStore(&control.flags[1u-phase],1u);\r
    let mask=atomicLoad(&tileChanged);\r
    for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){\r
      let xy=vec2<i32>(group.xy)+vec2<i32>(dx,dy);let bit=u32((dy+1)*3+dx+1);\r
      if((mask&(1u<<bit))!=0u && all(xy>=vec2<i32>(0)) && all(xy<vec2<i32>(i32(tiles)))){\r
        atomicStore(&tileFlags[(1u-phase)*tiles*tiles+u32(xy.y)*tiles+u32(xy.x)],epoch+1u);\r
      }\r
    }}\r
  }\r
}\r
// Filled height controls real slopes. A weighted outlet potential orders flats\r
// without changing elevations; steepest potential and D-infinity split avoid\r
// the fixed-direction channels produced by unit D8 hop counts.\r
@compute @workgroup_size(256)\r
fn receivers(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count()){return;}let current=nodes[i].flood[0];\r
  var best=0.0;var bestFlat=0.0;var receiver=-1;var lowest=3.4e38;\r
  if(!edge(i)){for(var d=0u;d<8u;d++){\r
    let r=neighbor(i,d);if(r<0){continue;}let other=nodes[u32(r)].flood[0];if(!lower(other,current)){continue;}\r
    let drop=(current.x-other.x)/distances[d];let flatDrop=(current.y-other.y)/distances[d];let h=nodes[u32(r)].h;\r
    if(drop>best || (drop==0.0 && best==0.0 && (flatDrop>bestFlat || (flatDrop==bestFlat && h<lowest)))){\r
      receiver=r;best=drop;bestFlat=flatDrop;lowest=h;\r
    }\r
  }}\r
  nodes[i].receiver=receiver;\r
}\r
@compute @workgroup_size(256)\r
fn flow(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count()){return;}let r=nodes[i].receiver;var f=vec4<f32>(f32(r),-1.0,0.0,1.0);\r
  if(r>=0){let a=u32(r);let diag=abs(i32(i%size())-i32(a%size()))+abs(i32(i/size())-i32(a/size()))==2;f.w=select(1.0,1.4142135623730951,diag);let center=nodes[i].flood[0];let outlet=nodes[a].flood[0];let flat=center.x==outlet.x;\r
    var best=select(center.x-outlet.x,center.y-outlet.y,flat)/f.w;\r
    for(var d=0u;d<8u;d++){let ar=neighbor(i,d);let br=neighbor(i,(d+1u)&7u);if(ar<0 || br<0){continue;}\r
      let af=nodes[u32(ar)].flood[0];let bf=nodes[u32(br)].flood[0];\r
      if(!lower(af,center) || !lower(bf,center)){continue;}\r
      if(flat && (af.x!=center.x || bf.x!=center.x)){continue;}\r
      let u=vec2<f32>(directions[d]);let v=vec2<f32>(directions[(d+1u)&7u]);\r
      let da=select(center.x-af.x,center.y-af.y,flat);let db=select(center.x-bf.x,center.y-bf.y,flat);let det=u.x*v.y-u.y*v.x;\r
      let g=vec2<f32>((da*v.y-db*u.y)/det,(db*u.x-da*v.x)/det);let ca=u.x*g.y-u.y*g.x;let cb=g.x*v.y-g.y*v.x;if(ca<0.0 || cb<0.0){continue;}let slope=length(g);if(slope<=best){continue;}let t=clamp(atan2(ca,dot(u,g))/0.7853981633974483,0.0,1.0);best=slope;f=vec4<f32>(f32(ar),f32(br),t,(1.0-t)*distances[d]+t*distances[(d+1u)&7u]);\r
    }\r
  }nodes[i].flow=f;\r
}\r
@compute @workgroup_size(256)\r
fn graphInit(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;let tiles=(size()+15u)/16u;let tileCount=tiles*tiles;\r
  if(i<tileCount){atomicStore(&tileFlags[i],1u);atomicStore(&tileFlags[tileCount+i],0u);}\r
  if(i>=count()){return;}let mode=u32(p.values[6].y);\r
  // Surface graphs take open sea as a resolved, fixed base level: its tiles leave the solve at once.\r
  let n=size();let fixedSea=p.values[7].w==1.0 && openSeaAt((vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[1].x+p.values[1].y);\r
  let value=select(1.0,nodes[i].h,mode>=2u);nodes[i].state[0]=vec2<f32>(value,select(0.0,1.0,fixedSea));nodes[i].state[1]=nodes[i].state[0];\r
  // Heights, accumulation and receivers remain fixed throughout this solve.\r
  // Cache the coefficient in scratch consumed only later by thermal/diffusion.\r
  var factor=0.0;let f=nodes[i].flow;\r
  if(mode>=2u && f.x>=0.0){\r
    factor=min(6.0,p.values[5].z*min(sqrt(nodes[i].acc),4.0*sqrt(0.004)*p.values[0].w*2400.0/p.values[1].x)/f.w);\r
    var originalLow=nodes[u32(f.x)].h;\r
    if(f.y>=0.0 && f.z>0.0){originalLow=mix(originalLow,nodes[u32(f.y)].h,f.z);}\r
    let slope=max(0.0,(nodes[i].h-originalLow)/(p.values[1].x*f.w));\r
    let response=slope*slope/(slope*slope+p.values[12].w*p.values[12].w);\r
    if(mode==3u){\r
      let threshold=p.values[3].w*0.10;\r
      let localResponse=0.08+0.92*slope*slope/(slope*slope+threshold*threshold);\r
      factor=min(4.0,p.values[5].z*min(sqrt(nodes[i].acc),4.0*sqrt(0.004)*p.values[0].w*2400.0/p.values[1].x)*localResponse/f.w);\r
    }else{factor*=response;}\r
  }\r
  nodes[i].nextH=factor;\r
}\r
@compute @workgroup_size(256)\r
fn graphFinish(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}let s=nodes[i].state[0];if(s.y==0.0){atomicAdd(&control.errors,1u);}if(p.values[6].y==1.0){nodes[i].acc=s.x;}else{nodes[i].h=select(s.x,0.0,edge(i) && p.values[6].y==2.0);}}\r
@compute @workgroup_size(1)\r
fn floodCheck(){if(atomicLoad(&control.flags[0])!=0u){atomicAdd(&control.errors,1u);}}\r
@compute @workgroup_size(256)\r
fn pitInit(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}atomicStore(&nodes[i].parent,select(0xffffffffu,i,nodes[i].flood[0].x-nodes[i].h>0.05));atomicStore(&nodes[i].bottom,0xffffffffu);atomicStore(&nodes[i].spill,0xffffffffu);atomicStore(&nodes[i].pour,0xffffffffu);}\r
@compute @workgroup_size(256)\r
fn pitUnion(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count() || atomicLoad(&nodes[i].parent)==0xffffffffu){return;}for(var d=0u;d<8u;d++){let r=neighbor(i,d);if(r<0 || atomicLoad(&nodes[u32(r)].parent)==0xffffffffu){continue;}let a=rootOf(i);let b=rootOf(u32(r));atomicMin(&nodes[max(a,b)].parent,min(a,b));}}\r
@compute @workgroup_size(256)\r
fn pitCompress(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count() || atomicLoad(&nodes[i].parent)==0xffffffffu){return;}atomicStore(&nodes[i].parent,rootOf(i));}\r
@compute @workgroup_size(256)\r
fn pitReduce(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}let root=atomicLoad(&nodes[i].parent);if(root==0xffffffffu){return;}atomicMin(&nodes[root].bottom,ordered(nodes[i].h));let r=nodes[i].receiver;if(r>=0 && atomicLoad(&nodes[u32(r)].parent)!=root){atomicMin(&nodes[root].spill,ordered(nodes[i].flood[0].x));}for(var d=0u;d<8u;d++){let r=neighbor(i,d);if(r>=0){let parent=atomicLoad(&nodes[u32(r)].parent);if(parent!=0xffffffffu && parent!=root){atomicAdd(&control.errors,1u);}}}}\r
@compute @workgroup_size(256)\r
fn pitPour(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}let root=atomicLoad(&nodes[i].parent);if(root==0xffffffffu){return;}let r=nodes[i].receiver;if(r>=0 && atomicLoad(&nodes[u32(r)].parent)!=root && ordered(nodes[i].flood[0].x)==atomicLoad(&nodes[root].spill)){atomicMin(&nodes[root].pour,i);}}\r
@compute @workgroup_size(256)\r
fn pitFill(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}let root=atomicLoad(&nodes[i].parent);if(root!=0xffffffffu && atomicLoad(&nodes[root].pour)!=0xffffffffu){let spill=decoded(atomicLoad(&nodes[root].spill));if(nodes[i].h<spill){nodes[i].h+=p.values[4].z*p.values[7].z*p.values[12].x*(spill-nodes[i].h);}}}\r
@compute @workgroup_size(256)\r
fn breachInit(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<count()){atomicStore(&nodes[i].breached,ordered(nodes[i].h));}}\r
// CPU sill_phase / sill_flow: physical wavelengths and a small bearing perturbation on gentle, descending ground.\r
fn sillPhase(pour:u32)->f32 {\r
  let hash=pour*747796405u+2891336453u;\r
  return f32((hash^(hash>>16u))&65535u)*(6.283185307179586/65536.0);\r
}\r
fn sillFlow(c:u32,arc:f32,phase:f32)->vec4<f32> {\r
  let f=nodes[c].flow;if(f.x<0.0){return f;}\r
  var d=0u;for(var k=0u;k<8u;k++){if(neighbor(c,k)==i32(f.x)){d=k;break;}}\r
  let current=nodes[c].flood[0];\r
  let slope=(current.x-nodes[u32(f.x)].flood[0].x)/(p.values[1].x*distances[d]);\r
  if(slope<=0.0 || slope>=0.01){return f;}\r
  let wave=0.7*sin(6.283185307179586*arc/1000.0+phase)+0.3*sin(6.283185307179586*arc/430.0+2.0*phase);\r
  var bearing=f32(d)+select(f.z,0.0,f.y<0.0)+0.8*(1.0-slope/0.01)*wave;\r
  bearing=min(7.999999,bearing-8.0*floor(bearing/8.0));\r
  let a=u32(floor(bearing));let b=(a+1u)&7u;let ar=neighbor(c,a);let br=neighbor(c,b);\r
  if(ar<0 || br<0){return f;}\r
  if(!lower(nodes[u32(ar)].flood[0],current) || !lower(nodes[u32(br)].flood[0],current)){return f;}\r
  let t=bearing-f32(a);\r
  return vec4<f32>(f32(ar),f32(br),t,(1.0-t)*distances[a]+t*distances[b]);\r
}\r
@compute @workgroup_size(256)\r
fn breach(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count() || atomicLoad(&nodes[i].parent)!=i){return;}let pour=atomicLoad(&nodes[i].pour);if(pour==0xffffffffu){return;}let frac=p.values[7].z;let spill=decoded(atomicLoad(&nodes[i].spill));let bottom=decoded(atomicLoad(&nodes[i].bottom));var current=min(nodes[pour].h,spill-frac*(spill-bottom));atomicMin(&nodes[pour].breached,ordered(current));var r=nodes[pour].receiver;\r
  // CPU \`carve_sills\`: the reach never descends under the depression's own floor (nor 0.5 m), and follows the\r
  // D-infinity pair with metre-scaled winding on gentle slopes; only already drained neighbours are eligible.\r
  // The outlet and the reach are cut to the profile itself, three cells wide: the eight neighbours of a reach cell\r
  // are lowered by its cut, never under its level (a one-cell cut does not survive the resampling to the source grid).\r
  let bed=max(0.5,bottom);var turn=0.0;var arc=0.0;let phase=sillPhase(pour);\r
  for(var k=0u;k<400u;k++){if(r<0){break;}current=max(bed,current-0.01*p.values[1].x);let old=nodes[u32(r)].h;if(old<=current){break;}atomicMin(&nodes[u32(r)].breached,ordered(current));for(var d=0u;d<8u;d++){let q=neighbor(u32(r),d);if(q>=0){atomicMin(&nodes[u32(q)].breached,ordered(max(current,nodes[u32(q)].h-(old-current))));}}let here=u32(r);let f=sillFlow(here,arc,phase);if(f.y<0.0){r=nodes[here].receiver;}else{turn+=f.z;if(turn>=0.5){turn-=1.0;r=i32(f.y);}else{r=i32(f.x);}}if(r>=0){let to=u32(r);let diagonal=here%size()!=to%size() && here/size()!=to/size();arc+=p.values[1].x*select(1.0,1.4142135623730951,diagonal);}}\r
}\r
@compute @workgroup_size(256)\r
fn breachFinish(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<count()){nodes[i].h=decoded(atomicLoad(&nodes[i].breached));}}\r
@compute @workgroup_size(256)\r
fn thermalFlux(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}var total=0.0;var maximum=0.0;if(!edge(i)){for(var d=0u;d<8u;d++){let r=neighbor(i,d);let excess=max(0.0,nodes[i].h-nodes[u32(r)].h-p.values[3].w*p.values[6].z*p.values[1].x*distances[d]);total+=excess;maximum=max(maximum,excess);}}nodes[i].thermal=vec2<f32>(0.1*p.values[4].z*p.values[13].x*maximum,total);}\r
@compute @workgroup_size(256)\r
fn thermalApply(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}var change=-nodes[i].thermal.x;for(var d=0u;d<8u;d++){let r=neighbor(i,d);if(r<0){continue;}let f=nodes[u32(r)].thermal;if(f.y>0.0){let excess=max(0.0,nodes[u32(r)].h-nodes[i].h-p.values[3].w*p.values[6].z*p.values[1].x*distances[d]);change+=f.x*excess/f.y;}}nodes[i].nextH=nodes[i].h+change;}\r
@compute @workgroup_size(256)\r
fn copyHeight(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<count()){nodes[i].h=nodes[i].nextH;}}\r
@compute @workgroup_size(256)\r
fn bounds(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<count()){nodes[i].h=select(nodes[i].h,0.0,edge(i));if(p.values[7].w!=0.0){nodes[i].h=max(0.0,nodes[i].h);}}}\r
@compute @workgroup_size(256)\r
fn diffuse(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}var value=nodes[i].h;if(!edge(i)){var average=0.0;for(var d=0u;d<8u;d++){average+=nodes[u32(neighbor(i,d))].h*select(0.2,0.05,(d&1u)!=0u);}let weight=p.values[6].w*select(1.0,0.75,nodes[i].acc>=f32(count())*0.001);value=(1.0-weight)*value+weight*average;}nodes[i].nextH=value;}\r
fn at(i:vec2<i32>,drain:bool)->f32 {let n=i32(size());let j=u32(clamp(i.y,0,n-1)*n+clamp(i.x,0,n-1));return select(nodes[j].h,nodes[j].acc,drain);}\r
fn cubic(a:f32,b:f32,c:f32,d:f32,t:f32)->f32{return b+0.5*t*(c-a+t*(2.0*a-5.0*b+4.0*c-d+t*(3.0*(b-c)+d-a)));}\r
fn sample(pos:vec2<f32>,drain:bool)->f32 {\r
  let xy=vec2<i32>(floor(pos));let t=fract(pos);\r
  if(drain){return mix(mix(at(xy,true),at(xy+vec2<i32>(1,0),true),t.x),mix(at(xy+vec2<i32>(0,1),true),at(xy+1,true),t.x),t.y);}\r
  var rows:array<f32,4>;var lo=3.4e38;var hi=-3.4e38;\r
  for(var y=0u;y<4u;y++){var values:array<f32,4>;for(var x=0u;x<4u;x++){let v=at(xy+vec2<i32>(i32(x)-1,i32(y)-1),false);values[x]=v;lo=min(lo,v);hi=max(hi,v);}rows[y]=cubic(values[0],values[1],values[2],values[3],t.x);}\r
  return clamp(cubic(rows[0],rows[1],rows[2],rows[3],t.y),lo,hi);\r
}\r
@compute @workgroup_size(256)\r
fn reconstruct(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);let n=sourceSize();if(i>=n*n){return;}let xy=(vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[2].w;let warp=p.values[13].y*min(16.0*p.values[0].w,p.values[1].x*0.9);let w=xy+warp*vec2<f32>(fbm(xy/p.values[2].x+vec2<f32>(11.3,0.0),1u,2u,0.5,0.0),fbm(xy/p.values[2].x+vec2<f32>(-4.7,2.9),1u,2u,0.5,0.0));let drainage=sample((xy-p.values[1].y)/p.values[1].x-0.5,true);var r=0.5;if(!openSeaSource(i)){r=ridge(xy/p.values[2].y,u32(p.values[2].z));}fine[i]=vec4<f32>(sample((w-p.values[1].y)/p.values[1].x-0.5,false),1.0-0.85*p.values[4].z*smooth01((drainage-4.0)/max(12.0,f32(count())*0.001-4.0)),r,0.0);}\r
// The amplitude percentile reads a lattice of at least 65536 cells, one in 16 from 1024² up.\r
fn percentileMask()->u32{return min(16u,1u<<firstLeadingBit(max(1u,sourceCount()>>16u)))-1u;}\r
fn percentileCount()->u32{\r
  let n=sourceSize();let mask=percentileMask();let stride=mask+1u;var total=0u;\r
  for(var row=0u;row<stride;row++){let column=(stride-((7u*row)&mask))&mask;total+=((n+mask-row)/stride)*((n+mask-column)/stride);}\r
  return total;\r
}\r
@compute @workgroup_size(1)\r
fn percentileInit(){control.prefix=0u;control.quantileIndex=select(u32(floor(0.99*f32(percentileCount()))),u32(floor(0.01*f32(sourceCount()))),p.values[7].x==1.0);}\r
@compute @workgroup_size(256)\r
fn histogramClear(@builtin(local_invocation_id) id:vec3<u32>){atomicStore(&control.histogram[id.x],0u);}\r
@compute @workgroup_size(256)\r
fn histogram(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>,@builtin(local_invocation_id) local:vec3<u32>){\r
  atomicStore(&localHistogram[local.x],0u);workgroupBarrier();\r
  let i=cellId(id,groups);let n=sourceSize();\r
  if(i<n*n && (p.values[7].x!=0.0 || ((i%n+(i/n)*7u)&percentileMask())==0u)){\r
    let value=select(fine[i].x,fine[i].w,p.values[7].x==1.0);let bits=ordered(value);let shift=u32(p.values[7].y);let mask=select(0xffffffffu,0u,shift==24u)<<min(31u,shift+8u);\r
    if((bits&mask)==control.prefix){atomicAdd(&localHistogram[(bits>>shift)&255u],1u);}\r
  }\r
  workgroupBarrier();let frequency=atomicLoad(&localHistogram[local.x]);\r
  if(frequency!=0u){atomicAdd(&control.histogram[local.x],frequency);}\r
}\r
var<workgroup> localHistogram:array<atomic<u32>,256>;\r
@compute @workgroup_size(1)\r
fn percentileSelect(){let shift=u32(p.values[7].y);var quantileIndex=control.quantileIndex;var selected=0u;for(var bin=0u;bin<256u;bin++){let frequency=atomicLoad(&control.histogram[bin]);if(quantileIndex<frequency){selected=bin;break;}quantileIndex-=frequency;}control.quantileIndex=quantileIndex;control.prefix|=selected<<shift;if(shift==0u){let value=decoded(control.prefix);if(p.values[7].x==0.0){control.p99=max(0.0001,value);}else{control.p1=value;}}}\r
@compute @workgroup_size(256)\r
fn detail(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);let n=sourceSize();if(i>=n*n){return;}if(openSeaSource(i)){fine[i].w=max(0.3,fine[i].x*p.values[3].x*(1.0-0.2*p.values[4].z)/control.p99);return;}let x=i%n;let y=i/n;let gx=fine[y*n+min(x+1u,n-1u)].x-fine[y*n+select(x-1u,0u,x==0u)].x;let gy=fine[min(y+1u,n-1u)*n+x].x-fine[select(y-1u,0u,y==0u)*n+x].x;let amplitude=p.values[3].x*(1.0-0.2*p.values[4].z);let scale=amplitude/control.p99;let slope=length(vec2<f32>(gx,gy))*scale/(2.0*p.values[2].w);let extra=(fine[i].z-0.5)*p.values[4].x*amplitude*smooth01((slope-0.015)/0.3)*fine[i].y;fine[i].w=max(0.3,fine[i].x*scale+extra);}\r
@compute @workgroup_size(256)\r
fn normalize(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);if(i<sourceCount()){fine[i].x=max(0.3,1.0+fine[i].w-control.p1);}}\r
@compute @workgroup_size(256)\r
fn packHeight(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);if(i<sourceCount()){outputHeight[i]=fine[i].x;}}\r
\r
@compute @workgroup_size(256)\r
fn volcanicInitial(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){\r
  let i=cellId(id,groups);let n=sourceSize();if(i>=n*n){return;}\r
  let xy=(vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[2].w;\r
  fine[i].w=volcanoElevation(xy);\r
}\r
fn fineAt(xy:vec2<i32>)->f32{let n=i32(sourceSize());return fine[u32(clamp(xy.y,0,n-1)*n+clamp(xy.x,0,n-1))].w;}\r
fn fineSample(pos:vec2<f32>)->f32{\r
  let last=f32(sourceSize()-1u);let q=clamp(pos,vec2<f32>(0.0),vec2<f32>(last));let xy=vec2<i32>(floor(q));let t=fract(q);\r
  var value=mix(mix(fineAt(xy),fineAt(xy+vec2<i32>(1,0)),t.x),mix(fineAt(xy+vec2<i32>(0,1)),fineAt(xy+1),t.x),t.y);\r
  if(pos.x!=q.x){let a=vec2<f32>(max(0.0,q.x-1.0),q.y);let b=vec2<f32>(min(last,q.x+1.0),q.y);value+=(pos.x-q.x)*(fineAt(vec2<i32>(b))-fineAt(vec2<i32>(a)))/(b.x-a.x);}\r
  if(pos.y!=q.y){let a=vec2<f32>(q.x,max(0.0,q.y-1.0));let b=vec2<f32>(q.x,min(last,q.y+1.0));value+=(pos.y-q.y)*(fineAt(vec2<i32>(b))-fineAt(vec2<i32>(a)))/(b.y-a.y);}\r
  return value;\r
}\r
@compute @workgroup_size(256)\r
fn surfaceLoad(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=count()){return;}let xy=(vec2<f32>(f32(i%size()),f32(i/size()))+0.5)*p.values[1].x+p.values[1].y;let h=fineSample(xy/p.values[2].w-0.5);nodes[i].h=h;nodes[i].uplift=h;nodes[i].acc=1.0;nodes[i].routingPriority=seededRoutingPriority(i);}\r
// Coast assembly uses x for height. Preserve signed meters throughout erosion.\r
@compute @workgroup_size(256)\r
fn coastLoad(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);if(i<sourceCount()){fine[i].w=fine[i].x;}}\r
@compute @workgroup_size(256)\r
fn coastResult(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);if(i<sourceCount()){fine[i].x=fine[i].w;}}\r
@compute @workgroup_size(256)\r
fn surfaceFlowInit(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<count()){nodes[i].flood[0]=vec2<f32>(nodes[i].h,0.0);}}\r
@compute @workgroup_size(256)\r
fn surfaceDelta(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<count()){nodes[i].h-=nodes[i].uplift;}}\r
@compute @workgroup_size(256)\r
fn surfaceReconstruct(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){let i=cellId(id,groups);let n=sourceSize();if(i>=n*n || openSeaSource(i)){return;}let xy=(vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[2].w;fine[i].w+=surfaceSample((xy-p.values[1].y)/p.values[1].x-0.5);}\r
\r
// Marks mask cells holding land, from the field a coast was just cut into.\r
// p.values[7].w names that field: 0 regional heights, 2 fine.w, otherwise fine.x.\r
@compute @workgroup_size(256)\r
fn seaLandMark(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){\r
  let i=cellId(id,groups);let kind=p.values[7].w;var h=0.0;var xy=vec2<f32>(0.0);\r
  if(kind==0.0){\r
    if(i>=count()){return;}let n=size();h=nodes[i].h;xy=(vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[1].x+p.values[1].y;\r
  } else {\r
    if(i>=sourceCount()){return;}let n=sourceSize();h=select(fine[i].x,fine[i].w,kind==2.0);xy=(vec2<f32>(f32(i%n),f32(i/n))+0.5)*p.values[2].w;\r
  }\r
  if(h<=0.0){return;}\r
  let k=seaCell(xy);if(k<0){return;}\r
  let word=u32(k)>>5u;let bit=1u<<(u32(k)&31u);\r
  if((atomicLoad(&control.seaLand[word])&bit)==0u){atomicOr(&control.seaLand[word],bit);}\r
}\r
// A cell is open sea when no land lies within p.values[7].y mask cells. One thread per word.\r
@compute @workgroup_size(256)\r
fn seaMaskGrow(@builtin(global_invocation_id) id:vec3<u32>){\r
  let word=id.x;if(word>=512u){return;}let radius=i32(p.values[7].y);var bits=0u;\r
  for(var b=0u;b<32u;b++){\r
    let k=i32(word*32u+b);let x=k%128;let y=k/128;var open=true;\r
    for(var yy=max(0,y-radius);open && yy<=min(127,y+radius);yy++){\r
      for(var xx=max(0,x-radius);xx<=min(127,x+radius);xx++){\r
        let c=u32(yy*128+xx);\r
        if((atomicLoad(&control.seaLand[c>>5u])&(1u<<(c&31u)))!=0u){open=false;break;}\r
      }\r
    }\r
    if(open){bits|=1u<<b;}\r
  }\r
  control.openSea[word]=bits;\r
  if(word==0u){control.seaReady=1u;}\r
}\r
\r
fn surfaceWeights(t:f32)->vec4<f32>{let t3=t*t*t;let omt=1.0-t;return vec4<f32>(omt*omt*omt,3.0*t3-6.0*t*t+4.0,-3.0*t3+3.0*t*t+3.0*t+1.0,t3)/6.0;}\r
fn surfaceSample(pos:vec2<f32>)->f32{\r
  let xy=vec2<i32>(floor(pos));let wx=surfaceWeights(fract(pos.x));let wy=surfaceWeights(fract(pos.y));var result=0.0;\r
  for(var y=0u;y<4u;y++){for(var x=0u;x<4u;x++){result+=at(xy+vec2<i32>(i32(x)-1,i32(y)-1),false)*wx[x]*wy[y];}}\r
  return result;\r
}\r
\r
// Trunk-river incision: physical catchment drives depth and bank width, not a\r
// pre-drawn polyline or the eight directions of a grid-breach operation.\r
@compute @workgroup_size(256)\r
fn canyonSeed(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count()){return;}\r
  let motif=p.values[0].w*2400.0;\r
  let area=nodes[i].acc*p.values[1].x*p.values[1].x/(motif*motif);\r
  let importance=smooth01((sqrt(area)-0.10)/0.30);\r
  nodes[i].nextH=importance;\r
  nodes[i].state[0]=select(vec2<f32>(-1.0),vec2<f32>(f32(i%size()),f32(i/size())),importance>0.0);\r
  nodes[i].state[1]=nodes[i].state[0];\r
}\r
fn canyonScore(xy:vec2<f32>,seed:vec2<f32>)->f32{\r
  if(seed.x<0.0){return 0.0;}\r
  let importance=nodes[u32(seed.y)*size()+u32(seed.x)].nextH;\r
  let dose=p.values[5].w;let motif=p.values[0].w*2400.0;\r
  let width=motif*(0.008+0.065*sqrt(importance))*sqrt(dose);\r
  let distance=length(xy-seed)*p.values[1].x;\r
  return p.values[3].x*0.90*dose*importance*(1.0-smooth01(distance/width));\r
}\r
@compute @workgroup_size(256)\r
fn canyonSpread(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count()){return;}\r
  let phase=u32(p.values[6].x);let jump=i32(p.values[6].y);let xy=vec2<i32>(i32(i%size()),i32(i/size()));\r
  var best=nodes[i].state[phase];var value=canyonScore(vec2<f32>(xy),best);\r
  for(var d=0u;d<8u;d++){\r
    let q=xy+directions[d]*jump;if(any(q<vec2<i32>(0)) || any(q>=vec2<i32>(i32(size())))){continue;}\r
    let seed=nodes[u32(q.y)*size()+u32(q.x)].state[phase];let candidate=canyonScore(vec2<f32>(xy),seed);\r
    if(candidate>value || (candidate==value && seed.x>=0.0 && (best.x<0.0 || seed.y<best.y || (seed.y==best.y && seed.x<best.x)))){best=seed;value=candidate;}\r
  }\r
  nodes[i].state[1u-phase]=best;\r
}\r
@compute @workgroup_size(256)\r
fn canyonApply(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count()){return;}\r
  let xy=vec2<f32>(f32(i%size()),f32(i/size()));\r
  nodes[i].h-=canyonScore(xy,nodes[i].state[u32(p.values[6].x)]);\r
}\r
`,Yr=new WeakMap,dt=new WeakMap,en=new Set;function Vr(r){r.nodes?.destroy(),r.fine?.destroy(),r.control.destroy()}const rn=new WeakMap,pt=new WeakMap,tn=new WeakMap,nn=new WeakMap,Nn=new WeakSet,ea=512*1048576,an=1024,ra=1088,ht=ra+4096;function Bn(r,t){const i=(tn.get(r.device)??Promise.resolve()).then(t);return tn.set(r.device,i.then(()=>{},()=>{})),i}async function ta(r,t,i,n){let a=rn.get(r);a||(a=(async()=>{const e=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(x=>({binding:x,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(x=>({binding:x,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),c=r.createShaderModule({code:Qi.replace("// NOISE_KERNEL",Bt).replace("// VOLCANIC_KERNEL",Rn)+Xi+Zi}),d=(await xr(c.getCompilationInfo())).messages.filter(x=>x.type==="error");if(d.length)throw new Error(d.map(x=>`${x.lineNum}: ${x.message}`).join(`
`));const y=r.createPipelineLayout({bindGroupLayouts:[e]});return{layout:e,module:c,pipelineLayout:y,values:new Map,pending:new Map}})(),rn.set(r,a)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const o=await xr(a),l=[],u=[...t].reduce((e,c)=>e+(c==="solveTile"?i.size:1),0);let s=0;for(const e of t)for(const c of e==="solveTile"?i:[void 0]){const f=c===void 0?e:`solveTile:${c}`;let d=o.pending.get(f);d||(d=r.createComputePipelineAsync({layout:o.pipelineLayout,compute:{module:o.module,entryPoint:e,...c===void 0?{}:{constants:{SOLVE_MODE:c}}}}),d=d.then(y=>(o.values.set(f,y),y)),o.pending.set(f,d)),l.push(d.then(y=>(s++,n?.(`GPU · shaders d’érosion prêts ${s}/${u}`,{stage:"gpu-erosion-compile",completed:s,total:u}),y)))}return await xr(Promise.all(l)),Nn.add(r),o}class Hr extends Error{}class na extends Error{}function Tn(r,t,i,n,a){const o=jr.erosion_at_resolution(r.seed,r.width,i,r.erosion,r.motifSize,r.mountainMix,t);try{const l=o.parameters(),u=n?xn(l,r,a):{parameters:l,surface:(a??l.slice(24,32)).slice()};return bn(u.parameters,u.surface,r,n,!!a),kn(u.surface,r,t),{noise:o,parameters:u.parameters,surface:u.surface,original:l}}catch(l){throw o.free(),l}}const ia=["hills","mountains","mixed","high-mountains","valley","canyon"];function aa(r,t){const i=er(t).n,n=br(t),a=ia.includes(t.relief)?t.relief:t.relief==="flat"?"hills":"mixed",{noise:o,parameters:l,surface:u}=Tn(t,i,a,n);o.free();const s=l[2],e=u[0],c=u[3],f=ai(r.device.limits,i,Math.max(s,t.erosion>0&&(!n||c>0)?e:0));return{sourceN:i,regionalN:s,regionalSteps:l[13],surfaceN:e,surfaceSteps:c,pipelinesReady:Nn.has(r.device),error:f}}async function oa(r,t,i,n,a){return Bn(r,()=>sa(r,t,i,n,a))}async function sa(r,t,i,n,a){const o=er(t).n;for(const l of[1,2,4,8,16])try{return await On(r,t,o,l,void 0,{source:i,tuning:n},void 0,a)}catch(u){if(!(u instanceof Hr)||l===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function on(r,t,i,n){return i?.control?.backend?.("gpu"),Bn(r,()=>la(r,t,i,n))}async function la(r,t,i,n){const a=er(t).n;if(t.relief==="volcano"||t.relief==="caldera"||t.relief==="plateau"){const o=jr.finite_shape(t.seed,t.motifSize,t.relief,t.erosion),l=o.parameters();o.free();const u=t.environment??"mixed",s=t.motifSize*l[15];let e;if(u==="flat"){const d=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),e=xe.prepare_environment_at_resolution(t.seed,t.width,u,t.erosion,s,a),i&&(i.nativeEnvironmentMs=performance.now()-d)}else e=await mt(r,{...t,motifSize:s,relief:u,mountainMix:.5},a,void 0,i,n);const c=await mt(r,{...t,width:t.motifSize},a,l,i,n),f=new Float32Array(c.length+e.length);return f.set(c),f.set(e,c.length),f}return mt(r,t,a,void 0,i,n)}async function mt(r,t,i,n,a,o){for(const l of[1,2,4,8,16])try{return await On(r,t,i,l,n,void 0,a,o)}catch(u){if(!(u instanceof Hr)||l===16)throw u}throw new Error("Érosion GPU non convergée.")}async function On(r,t,i,n,a,o,l,u){const s=r.device,e=o?void 0:l?.control,c=br(t),f=!!t.generalSeed&&bt(t.generalSeed,h=>h.startsWith("relief-"))!==_n(t.generalSeed),{noise:d,parameters:y,surface:x,original:b}=Tn(t,i,o||c&&t.relief==="flat"?"hills":a?"mixed":t.relief,c,o?.tuning);let w=pt.get(s);if(!w){w=[],pt.set(s,w);const h=w;s.lost.then(()=>h.forEach(p=>p.destroy()))}const P=!!e&&e.previews!==!1&&i<=an;let m=!!e&&e.previews!==!1,g=0;try{c&&t.procedural&&ie(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural.erosionTuning?.detail===void 0&&(y[16]=b[16]);const h=y.slice(0,24),p=h[2],N=h[13],C=h[18],E=o?[1,0,0,.2,1,1,0,0]:Array.from(y.slice(33,41)),G=E.slice();G[4]=1;const _=!o&&E[6]>.5,S=Math.min(n,4),U=h.slice();U[2]=x[0],U[4]=x[1],U[5]=x[2],U[15]=a&&!o?a[13]:x[4],U[18]=x[5],U[22]=x[6];const j=Math.max(1,U[2]/1048),W=Math.ceil(Math.min((a||o||t.relief==="mixed"?64:32)*n,512)*j),B=!o&&ie(t,"phasor",c)?"generationPhasorPack":"packHeight",F=c?"compactInitialize":"initialize",Z=!!o||ie(t,"surface",!c||t.relief==="canyon")&&(!c||t.relief==="canyon"||x[3]>0),pe=()=>{o||l?.onPhysicalPlan?.(t.erosion>0&&Z&&x[3]>0?x[1]:void 0,!a&&t.erosion>0&&(ie(t,"regional")||ie(t,"regionalFinish"))?h[4]:void 0)},K=t.procedural?.reconstruction&&t.procedural.reconstruction!=="default"?"generationReconstruct":c?"compactReconstruct":"reconstruct",he=new Set([B,...ie(t,"amplitude")?[]:["generationUnitScale"],...ie(t,"normalize")?[]:["generationKeepDatum"],...e?["generationPreview"]:[],...!o&&!a&&t.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),X=new Set,oe=(...v)=>v.forEach(z=>he.add(z));f&&!o&&!a&&oe("generationCut","generationRegionalRead","generationPreview"),(o||!a&&(f||t.procedural))&&oe("seaLandMark","seaMaskGrow");const Ue=()=>oe("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");o?oe("coastLoad","coastResult"):oe("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!o&&!a?(oe(F,"uplift","bounds",K,"detail"),C>0&&(Ue(),oe("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(v=>X.add(v)))):a&&!o&&oe("volcanicInitial"),t.erosion>0&&Z&&(Ue(),oe("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),X.add(1),X.add(3),t.relief==="canyon"&&!o&&(oe("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),X.add(0)),_&&(oe("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),X.add(0))),e&&await e.before("grids",`Budget ×${n} · régional ${p}² · surface ${U[2]}² · sortie ${i}²`);const me=performance.now(),ge=await ta(s,he,X,u),Ge=performance.now()-me,Ce=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let Pe=!1;const se=(v,z)=>{const T=g++;let O=w[T];return(!O||O.size<v||O.usage!==z)&&(O?.destroy(),O=s.createBuffer({size:v,usage:z}),w[T]=O,Pe=!0),O},be=v=>{const z=se(v.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return s.queue.writeBuffer(z,0,v),z},Ee=t.erosion>0&&Z?Math.max(p,U[2]):p,ve=i**2,te=ve*4,Ae=ve*16,ke=Math.max(ve,p*p)*4;s.pushErrorScope("out-of-memory");const Se=se(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),$e=se(Ee**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Re=se(Ae,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),He=se(ht,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Fe=se(ke,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),fe=se(ke+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),qe=se(Math.ceil(Ee/16)**2*8,GPUBufferUsage.STORAGE),or=s.popErrorScope();if(Pe&&await or)throw m=!0,new na(`WebGPU : mémoire insuffisante pour la source ${i}² et la grille d’érosion ${Ee}².`);m||=w.reduce((v,z)=>v+z.size,0)>ea;const Je=v=>fe.mapAsync(GPUMapMode.READ,0,v),dr=v=>fe.getMappedRange(0,v),ye=!o&&!a&&!!(t.procedural||f),M=ye&&i<=an,k=P||ye;let R=k?void 0:nn.get(s);if(!k&&!R&&s.features.has("timestamp-query")){R=s.createQuerySet({type:"timestamp",count:6}),nn.set(s,R);const v=R;s.lost.then(()=>v.destroy())}const Q=R?se(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,J=R?se(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,de=(v,z)=>s.createBindGroup({layout:ge.layout,entries:[{binding:0,resource:{buffer:Se,size:224}},...[be(v),be(z),$e,Re,He,Fe,qe].map((T,O)=>({binding:O+1,resource:{buffer:T}}))]});let A=de(d.permutations(),d.gradients());const L=new Map([[t.seed,A]]),le=v=>{const z={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[v];if(!z||!t.generalSeed)return;const T=je(t.generalSeed,z);let O=L.get(T);if(!O){const ce=jr.erosion(T,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix);try{O=de(ce.permutations(),ce.gradients())}finally{ce.free()}L.set(T,O)}A=O},H=new Map;let ne=E;const ee=(v,z)=>{const T=[...z,...v,...ne].join(",");let O=H.get(T);if(O===void 0){if(O=H.size*256,O+224>65536)throw new Error("Too many GPU variants.");H.set(T,O),s.queue.writeBuffer(Se,O,new Float32Array([...z,...v,...c?Dt(t,!!o):!a&&!o&&ie(t,"phasor",!1)?Dt(t):a??new Float32Array(16),...ne]))}return O};let D=s.createCommandEncoder();D.clearBuffer(He),o&&D.copyBufferToBuffer(o.source,0,Re,0,Ae);const _e=v=>D.beginComputePass(R?{timestampWrites:{querySet:R,beginningOfPassWriteIndex:v,endOfPassWriteIndex:v+1}}:void 0);let $=_e(0);const V=[0,0,1,0,0,0,.6,0];V[4]=y[32];const Ne=[0,0,.95,C*.5,0,0,.5,0];let ae=h;const q=(v,z=V,T=Math.ceil(ae[2]**2/256),O=1)=>{$.setPipeline(ge.values.get(v==="solveTile"?`solveTile:${z[1]}`:v)),$.setBindGroup(0,A,[ee(z,ae)]),$.dispatchWorkgroups(T,O)},pr=Math.ceil(ve/256),$r=Math.ceil(pr/s.limits.maxComputeWorkgroupsPerDimension),ze=(v,z=V)=>q(v,z,Math.ceil(pr/$r),$r),Ke=(v,z,T=!1)=>{const O=V.slice();O[1]=v,O[7]=T?1:0,q(v===0?"floodInit":"graphInit",O),q("start",O,1);const ce=[0,1].map(we=>(O[0]=we,ee(O,ae)));for(let we=0;we<z;we++){const sr=[ce[we&1]];$.setPipeline(ge.values.get("clearNext")),$.setBindGroup(0,A,sr),$.dispatchWorkgroups(1),$.setPipeline(ge.values.get(`solveTile:${v}`)),$.dispatchWorkgroups(Math.ceil(ae[2]/16),Math.ceil(ae[2]/16))}O[0]=0,q("solveStats",O,1),v===0?(q("floodCheck",O,1),q("receivers")):q("graphFinish",O)},nt=(v=V,z=!0)=>{q("pitInit");for(let T=0;T<8*S+Math.ceil(Math.log2(Math.max(1,ae[2]/1048)));T++)q("pitUnion"),q("pitCompress");for(const T of z?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])q(T,v)},it=v=>{if(v<=0)return;const z=V.slice();z[6]=v,q("breachInit"),q("breach",z),q("breachFinish")},at=(v,z=V)=>{if(!(ae===h&&t.procedural?.regionalThermal===!1))for(let T=0;T<v;T++)for(const O of["thermalFlux","thermalApply","copyHeight"])q(O,z)},Wr=(v,z=V)=>{if(ae===h&&t.procedural?.regionalDiffusion===!1)return;const T=z.slice();T[3]=v,q("diffuse",T),q("copyHeight",T)},Ft=v=>{const z=oi(si({surfaceSteps:x[3],surfaceCell:x[1],regionalCell:h[4],sourceCell:h[11],warp:E[5]*Math.min(16*h[3],h[4]*.9)}),t.width);if(z===void 0)return;const T=V.slice();T[7]=v,v===0?q("seaLandMark",T):ze("seaLandMark",T),T[5]=z,q("seaMaskGrow",T,2)},It=v=>{const z=V.slice();z[4]=v,q("percentileInit",z,1);for(const T of[24,16,8,0])z[5]=T,q("histogramClear",z,1),ze("histogram",z),q("percentileSelect",z,1)},Ht=async(v,z,T)=>{if(!e)return;if(!P){await e.after(v,void 0,T);return}if(z!==3){const sr=V.slice();sr[7]=z,ze("generationPreview",sr)}$.end(),D.copyBufferToBuffer(Fe,0,fe,0,te),D.copyBufferToBuffer(He,0,fe,te,1088),s.queue.submit([D.finish()]),await Je(te+1088);const O=dr(te+1088),ce=new Uint32Array(O,te,272)[2],we=new Float32Array(O,0,ve).slice();if(fe.unmap(),ce)throw new Hr("Érosion GPU non convergée pendant une étape.");if(!we.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await e.after(v,we,T),D=s.createCommandEncoder(),$=_e(0)},hr=tt(t),Wn=et(t);let Be=M?Yr.get(s):void 0;if(M&&!Be){Be=new Map,Yr.set(s,Be),en.add(s);const v=Be;s.lost.then(()=>{v.forEach(Vr),v.clear(),en.delete(s)})}const _r=v=>`${n}|${Wn.get(v)}`;let rr=0;for(;Be&&rr<hr.length&&Be.get(hr[rr])?.key===_r(hr[rr]);)rr++;if(Be)for(const v of[...hr.slice(rr),"phasor"]){const z=Be.get(v);z&&(v!=="phasor"||z.key!==_r(v)||rr<hr.length)&&(Vr(z),Be.delete(v))}const Yn=v=>{$.end(),v.nodes&&D.copyBufferToBuffer(v.nodes,0,$e,0,v.nodes.size),v.fine&&D.copyBufferToBuffer(v.fine,0,Re,0,v.fine.size),D.copyBufferToBuffer(v.control,0,He,0,ht),$=_e(0)},Vn=(v,z)=>{if(!Be)return;$.end();const T=(ce,we=ce.size)=>{const sr=s.createBuffer({size:we,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return D.copyBufferToBuffer(ce,0,sr,0,we),sr},O=Be.get(v);O&&Vr(O),Be.set(v,{key:_r(v),kind:z,...z===0?{nodes:T($e,p*p*112)}:{fine:T(Re,Ae)},control:T(He,ht)}),s.queue.submit([D.finish()]),D=s.createCommandEncoder(),$=_e(0)},Jn=async(v,z)=>{if(!e)return;if(!P){e.cached?await e.cached(v):(await e.before(v),await e.after(v));return}const T=V.slice();T[7]=z.kind,ze("generationPreview",T),$.end(),D.copyBufferToBuffer(Fe,0,fe,0,te),s.queue.submit([D.finish()]),await Je(te);const O=new Float32Array(dr(te),0,ve).slice();fe.unmap(),e.cached?await e.cached(v,O):(await e.before(v),await e.after(v,O)),D=s.createCommandEncoder(),$=_e(0)},Xe=async(v,z,T)=>{const O=hr.indexOf(v),ce=Be?.get(v);if(ce&&O>=0&&O<rr){(P||O===rr-1)&&Yn(ce),await Jn(v,ce);return}await e?.before(v),le(v),await T(),Vn(v,z),await Ht(v,z)},Kn=t.procedural?.coastAfter??"initialize",mr=async(v,z)=>{!ye||v!==Kn||await Xe("coastCut",z===4?5:z,async()=>{if(!Qr(t,"coastCut"))return;const T=V.slice();T[7]=z,z===0?q("generationRegionalRead",T,Math.ceil(p*p/256)):ze("generationPreview",T),$.end();const O=z===0?p*p:ve;D.copyBufferToBuffer(Fe,0,fe,0,O*4),s.queue.submit([D.finish()]),await Je(O*4);const ce=new Float32Array(dr(O*4),0,O).slice();fe.unmap();const we=Ii(Sn,je(t.generalSeed??t.seed,"relief-coast-cut"),t.width,y[3]*2400,y[12],t.coastMask,t.islandMode??"island",z===0?p:i,z===0?h[5]:0,z===0?h[4]:h[11],ce,fr(t));s.queue.writeBuffer(Fe,0,we),D=s.createCommandEncoder(),$=_e(0),z===0?q("generationCut",T,Math.ceil(p*p/256)):ze("generationCut",T),Ft(z)})};e&&await e.after("grids",void 0,`Budget ×${n} · régional ${p}² · surface ${U[2]}² · ${(w.reduce((v,z)=>v+z.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${N} cycles de relief et ${x[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),o?(ae=U,ze("coastLoad"),Ft(2)):a?(e&&await e.before("initialize"),ae=U,ze("volcanicInitial"),e&&await Ht("initialize",2)):(await Xe("initialize",0,()=>{q(F)}),await mr("initialize",0),await Xe("regional",0,()=>{for(let v=0;v<(ie(t,"regional")?N:0);v++){if(q("uplift"),C>0){Ke(0,64*S),nt(),q("flow"),it(E[1]),Ke(1,128*S),Ke(2,128*S),at(3);const z=h[17]*3*C;for(let T=0;T<Math.floor(z);T++)Wr(.5);z%1>0&&Wr(.5*(z%1))}q("bounds")}}),await Xe("regionalFinish",0,()=>{const v=V.slice();if(v[7]=1,q("bounds",v),C>0&&ie(t,"regionalFinish")){at(4,Ne);for(let z=0;z<6;z++)Ke(0,64*S),nt(Ne),q("flow"),it(E[2]);Wr(C*.5,Ne)}}),await mr("regionalFinish",0),await Xe("reconstruct",1,()=>{const v=V.slice();v[7]=t.procedural?.reconstruction==="bspline"?1:0,ze(K,v)}),await Xe("amplitude",4,()=>{ie(t,"amplitude")?It(0):q("generationUnitScale",V,1)}),await mr("amplitude",4),await Xe("ridged",2,()=>{ze("detail")}),await mr("ridged",2)),$.end(),$=_e(2),await Xe("surface",2,()=>{if(t.erosion>0&&Z){if(ae=U,ne=G,q("surfaceLoad"),t.relief==="canyon"&&!o){const v=Math.ceil(128*S*j);Ke(0,v),q("flow"),Ke(1,v),q("canyonSeed");let z=0;const T=[];for(let ce=2**(Math.ceil(Math.log2(U[2]))-1);ce>=1;ce/=2)T.push(ce);T.push(1,1);for(const ce of T){const we=V.slice();we[0]=z,we[1]=ce,q("canyonSpread",we),z=1-z}const O=V.slice();O[0]=z,q("canyonApply",O)}for(let v=0;v<x[3];v++)_?(Ke(0,W),nt(V,!1),q("flow"),it(E[7])):(q("surfaceFlowInit"),q("receivers"),q("flow")),Ke(1,W,!0),Ke(3,W,!0),at(1),Wr(x[7]);q("surfaceDelta"),ze("surfaceReconstruct")}}),await mr("surface",2),$.end(),$=_e(4),await Xe("normalize",1,()=>{o?ze("coastResult"):ie(t,"normalize")?(It(1),ze("normalize")):ze("generationKeepDatum")}),await mr("normalize",1);let Mr=dt.get(s);Mr||(Mr=new Nt,dt.set(s,Mr));const Pr=M?Mr.get("phasor",_r("phasor")):void 0;if(Pr)return $.end(),s.queue.submit([D.finish()]),e?.cached?await e.cached("phasor",P?Pr:void 0):(await e?.before("phasor"),await e?.after("phasor",Pr)),pe(),Pr;Pr||await e?.before("phasor"),ze(B),$.end();const zr=te;D.copyBufferToBuffer(Fe,0,fe,0,zr),D.copyBufferToBuffer(He,0,fe,zr,1088),R&&Q&&J&&(D.resolveQuerySet(R,0,6,Q,0),D.copyBufferToBuffer(Q,0,J,0,48));const Xn=D.finish(),Zn=performance.now()-Ce;u?.(o?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const Qn=performance.now();s.queue.submit([Xn]);const ei=s.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([Je(zr+1088),J?.mapAsync(GPUMapMode.READ),ei]);const ri=performance.now()-Qn,ti=performance.now(),qt=dr(zr+1088),ot=new Uint32Array(qt,zr,272),ni=Array.from(ot.slice(267,271)),st={factor:n,sourceSize:i,coarseSize:p,surfaceSize:U[2],pipelineMs:Ge,encodeMs:Zn,submitReadbackMs:ri,unpackMs:0,maxSolveSteps:ni,allocatedBytes:w.reduce((v,z)=>v+z.size,0)};if(J){const v=new BigUint64Array(J.getMappedRange());st.gpuStagesMs={coarse:Number(v[1]-v[0])/1e6,surface:Number(v[3]-v[2])/1e6,normalization:Number(v[5]-v[4])/1e6},J.unmap()}if(l&&(l.profiles??=[]).push(st),ot[2]!==0)throw fe.unmap(),new Hr(`Érosion GPU non convergée (${ot[2]} cellules/étapes, budget ×${n}).`);const Ur=new Float32Array(qt,0,ve).slice();fe.unmap(),st.unpackMs=performance.now()-ti;const ii=o||ye&&Qr(t,"coastCut")?-1/0:.3-1e-7;for(let v=0;v<ve;v++)if(!Number.isFinite(Ur[v])||Ur[v]<ii)throw new Error("Champ GPU invalide.");return pe(),M&&Mr.put("phasor",_r("phasor"),Ur),e&&await e.after("phasor",P?Ur:void 0,"Sortie GPU lue et validée"),Ur}catch(h){throw h instanceof Hr&&(Yr.get(s)?.forEach(Vr),Yr.get(s)?.clear(),dt.delete(s)),h}finally{d.free(),w.forEach(h=>{h.mapState!=="unmapped"&&h.unmap(),m&&h.destroy()}),m&&pt.delete(s)}}const ca=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
// Dispatch boundaries synchronize all tiles and each pointer-doubling pass.\r
struct Params { grid: vec4<u32>, physical: vec4<f32> }\r
struct Node {\r
  h: f32,\r
  priority: f32,\r
  flood: array<vec2<f32>, 2>,\r
  receiver: u32,\r
  pointer: array<u32, 2>,\r
  area: array<atomic<u32>, 2>,\r
}\r
struct Control {\r
  changes: array<atomic<u32>, 2>,\r
  errors: atomic<u32>,\r
  rootArea: atomic<u32>,\r
}\r
struct Output { filled: f32, receiver: u32, accumulation: f32, potential: f32 }\r
@group(0) @binding(0) var<uniform> p: Params;\r
@group(0) @binding(1) var<storage, read> height: array<f32>;\r
@group(0) @binding(2) var<storage, read> sea: array<u32>;\r
@group(0) @binding(3) var<storage, read_write> nodes: array<Node>;\r
@group(0) @binding(4) var<storage, read_write> control: Control;\r
@group(0) @binding(5) var<storage, read_write> output: array<Output>;\r
\r
const OUTLET: u32 = 0xffffffffu;\r
const INF: f32 = 3.4e38;\r
const directions = array<vec2<i32>, 8>(\r
  vec2<i32>(1, 0), vec2<i32>(1, 1), vec2<i32>(0, 1), vec2<i32>(-1, 1),\r
  vec2<i32>(-1, 0), vec2<i32>(-1, -1), vec2<i32>(0, -1), vec2<i32>(1, -1));\r
const distances = array<f32, 8>(1.0, 1.41421356, 1.0, 1.41421356, 1.0, 1.41421356, 1.0, 1.41421356);\r
\r
fn count() -> u32 { return p.grid.x * p.grid.x; }\r
fn edge(i: u32) -> bool {\r
  let n = p.grid.x;\r
  return i % n == 0u || i / n == 0u || i % n == n - 1u || i / n == n - 1u;\r
}\r
fn isSea(i: u32) -> bool { return p.grid.w != 0u && sea[i] != 0u; }\r
fn outlet(i: u32) -> bool { return edge(i) || isSea(i); }\r
fn neighbor(i: u32, d: u32) -> u32 {\r
  let n = i32(p.grid.x);\r
  let xy = vec2<i32>(i32(i) % n, i32(i) / n) + directions[d];\r
  if (any(xy < vec2<i32>(0)) || any(xy >= vec2<i32>(n))) { return OUTLET; }\r
  return u32(xy.y * n + xy.x);\r
}\r
fn lower(a: vec2<f32>, b: vec2<f32>) -> bool {\r
  return a.x < b.x || (a.x == b.x && a.y < b.y);\r
}\r
fn routingPriority(i: u32) -> f32 {\r
  var value = i ^ p.grid.y;\r
  value = (value ^ (value >> 16u)) * 0x7feb352du;\r
  value = (value ^ (value >> 15u)) * 0x846ca68bu;\r
  value ^= value >> 16u;\r
  return 0.5 + f32(value & 65535u) / 65535.0;\r
}\r
fn candidate(h: f32, otherH: f32, priority: f32, otherPriority: f32, other: vec2<f32>, d: u32) -> vec2<f32> {\r
  let level = max(h, other.x);\r
  // Prefer the bottom of a pond instead of shortest diagonal lattice routes.\r
  let depth = max(0.0, level - (h + otherH) * 0.5);\r
  let cost = (1.0 + 8.0 * exp(-depth / p.physical.z)) * (priority + otherPriority) * 0.5;\r
  let potential = select(other.y + distances[d] * cost, 0.0, h > other.x);\r
  return vec2<f32>(level, potential);\r
}\r
\r
@compute @workgroup_size(1)\r
fn reset() {\r
  atomicStore(&control.changes[0], 1u);\r
  atomicStore(&control.changes[1], 1u);\r
  atomicStore(&control.errors, 0u);\r
  atomicStore(&control.rootArea, 0u);\r
}\r
@compute @workgroup_size(256)\r
fn initialize(@builtin(global_invocation_id) id: vec3<u32>) {\r
  let i = id.x;\r
  if (i >= count()) { return; }\r
  nodes[i].h = height[i];\r
  nodes[i].priority = routingPriority(i);\r
  let state = select(vec2<f32>(INF, 1e30), vec2<f32>(height[i], 0.0), outlet(i));\r
  nodes[i].flood[0] = state;\r
  nodes[i].flood[1] = state;\r
}\r
@compute @workgroup_size(1)\r
fn clearNext() { atomicStore(&control.changes[1u - p.grid.z], 0u); }\r
\r
var<workgroup> tileA: array<vec2<f32>, 324>;\r
var<workgroup> tileB: array<vec2<f32>, 324>;\r
var<workgroup> tileH: array<f32, 324>;\r
var<workgroup> tilePriority: array<f32, 324>;\r
var<workgroup> tileChanged: atomic<u32>;\r
var<workgroup> tileActive: u32;\r
\r
// Each 16² tile relaxes its interior with a fixed, one-cell halo.\r
@compute @workgroup_size(16, 16)\r
fn solveTile(@builtin(local_invocation_id) local: vec3<u32>, @builtin(workgroup_id) group: vec3<u32>) {\r
  let lane = local.y * 16u + local.x;\r
  let phase = p.grid.z;\r
  if (lane == 0u) { tileActive = atomicLoad(&control.changes[phase]); }\r
  if (workgroupUniformLoad(&tileActive) == 0u) { return; }\r
  let base = vec2<i32>(group.xy * 16u) - 1;\r
  let n = i32(p.grid.x);\r
  for (var k = lane; k < 324u; k += 256u) {\r
    let xy = base + vec2<i32>(i32(k % 18u), i32(k / 18u));\r
    var state = vec2<f32>(INF, 1e30);\r
    var h = INF;\r
    var priority = 1.0;\r
    if (all(xy >= vec2<i32>(0)) && all(xy < vec2<i32>(n))) {\r
      let j = u32(xy.y * n + xy.x);\r
      state = nodes[j].flood[phase];\r
      h = nodes[j].h;\r
      priority = nodes[j].priority;\r
    }\r
    tileA[k] = state;\r
    tileB[k] = state;\r
    tileH[k] = h;\r
    tilePriority[k] = priority;\r
  }\r
  workgroupBarrier();\r
  let xy = group.xy * 16u + local.xy;\r
  let valid = all(xy < vec2<u32>(p.grid.x));\r
  let i = xy.y * p.grid.x + xy.x;\r
  let k = (local.y + 1u) * 18u + local.x + 1u;\r
  let original = tileA[k];\r
  for (var step = 0u; step < 16u; step++) {\r
    if (lane == 0u) { atomicStore(&tileChanged, 0u); }\r
    workgroupBarrier();\r
    var value = tileA[k];\r
    if (valid && !outlet(i)) {\r
      for (var d = 0u; d < 8u; d++) {\r
        let j = u32(i32(k) + directions[d].y * 18 + directions[d].x);\r
        let next = candidate(tileH[k], tileH[j], tilePriority[k], tilePriority[j], tileA[j], d);\r
        if (lower(next, value)) { value = next; }\r
      }\r
    }\r
    if (any(value != tileA[k])) { atomicStore(&tileChanged, 1u); }\r
    tileB[k] = value;\r
    workgroupBarrier();\r
    tileA[k] = tileB[k];\r
    workgroupBarrier();\r
    if (lane == 0u) { tileActive = atomicLoad(&tileChanged); }\r
    if (workgroupUniformLoad(&tileActive) == 0u) { break; }\r
  }\r
  if (valid) {\r
    let value = tileA[k];\r
    nodes[i].flood[1u - phase] = value;\r
    if (any(value != original)) { atomicStore(&control.changes[1u - phase], 1u); }\r
  }\r
}\r
\r
// Check the global fixed point and choose strictly decreasing receivers.\r
@compute @workgroup_size(256)\r
fn receivers(@builtin(global_invocation_id) id: vec3<u32>) {\r
  let i = id.x;\r
  if (i >= count()) { return; }\r
  let current = nodes[i].flood[0];\r
  var receiver = OUTLET;\r
  var bestSlope = -1.0;\r
  var bestPotential = -1.0;\r
  var bestHeight = INF;\r
  if (current.x >= 1e30 || current.y >= 1e30 || current.x < nodes[i].h) {\r
    atomicAdd(&control.errors, 1u);\r
  }\r
  if (!outlet(i)) {\r
    for (var d = 0u; d < 8u; d++) {\r
      let j = neighbor(i, d);\r
      if (j == OUTLET) { continue; }\r
      let other = nodes[j].flood[0];\r
      if (lower(candidate(nodes[i].h, nodes[j].h, nodes[i].priority, nodes[j].priority, other, d), current)) {\r
        atomicAdd(&control.errors, 1u);\r
      }\r
      if (!lower(other, current)) { continue; }\r
      let slope = (current.x - other.x) / distances[d];\r
      let potential = (current.y - other.y) / distances[d];\r
      if (slope > bestSlope || (slope == bestSlope && (potential > bestPotential || (potential == bestPotential && nodes[j].h < bestHeight)))) {\r
        receiver = j;\r
        bestSlope = slope;\r
        bestPotential = potential;\r
        bestHeight = nodes[j].h;\r
      }\r
    }\r
    if (receiver == OUTLET) { atomicAdd(&control.errors, 1u); }\r
  }\r
  nodes[i].receiver = receiver;\r
  nodes[i].pointer[0] = receiver;\r
  nodes[i].pointer[1] = receiver;\r
  let area = select(1u, 0u, isSea(i));\r
  atomicStore(&nodes[i].area[0], area);\r
  atomicStore(&nodes[i].area[1], area);\r
}\r
\r
// Integer counts avoid nondeterministic FP32 atomic additions at confluences.\r
// At round k, each node holds upstream nodes within 2^k steps; adding that\r
// disjoint range at its 2^k downstream ancestor doubles the resolved range.\r
@compute @workgroup_size(256)\r
fn accumulateCopy(@builtin(global_invocation_id) id: vec3<u32>) {\r
  let i = id.x;\r
  if (i >= count()) { return; }\r
  let phase = p.grid.z;\r
  let next = 1u - phase;\r
  atomicStore(&nodes[i].area[next], atomicLoad(&nodes[i].area[phase]));\r
  let pointer = nodes[i].pointer[phase];\r
  var ancestor = OUTLET;\r
  if (pointer != OUTLET) { ancestor = nodes[pointer].pointer[phase]; }\r
  nodes[i].pointer[next] = ancestor;\r
}\r
@compute @workgroup_size(256)\r
fn accumulateScatter(@builtin(global_invocation_id) id: vec3<u32>) {\r
  let i = id.x;\r
  if (i >= count()) { return; }\r
  let phase = p.grid.z;\r
  let pointer = nodes[i].pointer[phase];\r
  if (pointer != OUTLET) { atomicAdd(&nodes[pointer].area[1u - phase], atomicLoad(&nodes[i].area[phase])); }\r
}\r
@compute @workgroup_size(256)\r
fn finish(@builtin(global_invocation_id) id: vec3<u32>) {\r
  let i = id.x;\r
  if (i >= count()) { return; }\r
  let area = atomicLoad(&nodes[i].area[p.grid.z]);\r
  if (nodes[i].pointer[p.grid.z] != OUTLET || area > count()) { atomicAdd(&control.errors, 1u); }\r
  if (nodes[i].receiver == OUTLET) { atomicAdd(&control.rootArea, area); }\r
  output[i].filled = nodes[i].flood[0].x;\r
  output[i].receiver = nodes[i].receiver;\r
  output[i].accumulation = f32(area) * p.physical.y;\r
  output[i].potential = nodes[i].flood[0].y * p.physical.x;\r
}\r
`,ua=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],sn=new WeakMap,ln=new WeakMap;function fa(r){let t=sn.get(r);return t||(t=(async()=>{const i=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=r.createShaderModule({code:ca}),o=(await n.getCompilationInfo()).messages.filter(s=>s.type==="error");if(o.length)throw new Error(`Hydrologie WGSL : ${o.map(s=>`${s.lineNum}: ${s.message}`).join(`
`)}`);const l=r.createPipelineLayout({bindGroupLayouts:[i]}),u=await Promise.all(ua.map(async s=>[s,await r.createComputePipelineAsync({layout:l,compute:{module:n,entryPoint:s}})]));return{layout:i,values:new Map(u)}})(),sn.set(r,t)),t}function da(r){let t=2166136261;for(let i=0;i<r.length;i++)t=Math.imul(t^r.charCodeAt(i),16777619);return t>>>0}function pa(r,t,i){const n=new Uint32Array(r.length);if(!i)return{mask:n,count:0};const a=new Uint8Array(r.length),o=new Uint32Array(r.length);let l=0,u=0,s=0;const e=f=>{a[f]===0&&r[f]<=0&&(a[f]=1,o[u++]=f)},c=f=>{if(a[f]!==0||r[f]>0)return;l=0,u=0,e(f);let d=!1;for(;l<u;){const y=o[l++],x=y%t,b=Math.floor(y/t);d||=x+1<t&&b+1<t&&r[y+1]<=0&&r[y+t]<=0&&r[y+t+1]<=0;for(let w=-1;w<=1;w++){const P=b+w;if(!(P<0||P>=t))for(let m=-1;m<=1;m++){const g=x+m;g>=0&&g<t&&e(P*t+g)}}}if(d){for(let y=0;y<u;y++)n[o[y]]=1;s+=u}};for(let f=0;f<t;f++)c(f),c((t-1)*t+f);for(let f=1;f+1<t;f++)c(f*t),c(f*t+t-1);return{mask:n,count:s}}class ha{constructor(t,i,n){this.device=t,this.n=i,this.program=n,this.buffers=[],this.pending=Promise.resolve();const a=i*i,o=(u,s)=>{const e=t.createBuffer({size:u,usage:s});return this.buffers.push(e),e};this.uniform=o(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=o(a*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=o(a*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const l=o(a*48,GPUBufferUsage.STORAGE);this.control=o(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=o(a*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=o(a*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=o(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=t.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,l,this.control,this.output].map((u,s)=>({binding:s+1,resource:{buffer:u}}))]}),t.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(t,i,n,a){const o=this.pending.then(()=>this.execute(t,i,n,a));return this.pending=o.then(()=>{},()=>{}),o}async execute(t,i,n,a){const o=performance.now(),l=this.n,u=l*l,s=i/l,e=pa(t,l,a),c=performance.now()-o,f=this.device;f.queue.writeBuffer(this.source,0,t),f.queue.writeBuffer(this.sea,0,e.mask);for(let B=0;B<2;B++){const F=new ArrayBuffer(32);new Uint32Array(F,0,4).set([l,da(n),B,a?1:0]),new Float32Array(F,16,4).set([s,s*s,Math.max(.1,s*.1),0]),f.queue.writeBuffer(this.uniform,B*256,F)}const d=(B,F,Z=0)=>{B.setPipeline(this.program.values.get(F)),B.setBindGroup(0,this.group,[Z*256]),F==="solveTile"?B.dispatchWorkgroups(Math.ceil(l/16),Math.ceil(l/16)):B.dispatchWorkgroups(F==="reset"||F==="clearNext"?1:Math.ceil(u/256))},y=performance.now(),x=f.createCommandEncoder(),b=x.beginComputePass();d(b,"reset"),d(b,"initialize"),b.end(),f.queue.submit([x.finish()]);let w=0,P=!1,m=32;const g=Math.max(256,l);for(;w<g;){const B=f.createCommandEncoder(),F=B.beginComputePass();for(let pe=0;pe<m;pe++){const K=w+pe&1;d(F,"clearNext",K),d(F,"solveTile",K)}F.end(),B.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),f.queue.submit([B.finish()]),w+=m,m=Math.min(m*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const Z=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),Z===0){P=!0;break}}if(!P)throw new Error(`Drainage hydrique GPU non convergé après ${w} passes (${l}²) ; repli CPU requis.`);const h=f.createCommandEncoder(),p=h.beginComputePass();d(p,"receivers");const N=Math.ceil(Math.log2(u));for(let B=0;B<N;B++){const F=B&1;d(p,"accumulateCopy",F),d(p,"accumulateScatter",F)}d(p,"finish",N&1),p.end();const C=u*16;h.copyBufferToBuffer(this.output,0,this.readback,0,C),h.copyBufferToBuffer(this.control,0,this.readback,C,16),f.queue.submit([h.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const E=performance.now()-y,G=performance.now();let _,S,U,j;try{const B=this.readback.getMappedRange(),F=new Uint32Array(B,C,4);if(F[2]!==0||F[3]!==u-e.count)throw new Error(`Drainage hydrique GPU invalide (${F[2]} erreurs, ${F[3]}/${u-e.count} cellules drainées) ; repli CPU requis.`);const Z=new Float32Array(B,0,u*4),pe=new Uint32Array(B,0,u*4);_=new Float32Array(u),S=new Uint32Array(u),U=new Float32Array(u),j=new Float32Array(u);for(let K=0;K<u;K++)_[K]=Z[K*4],S[K]=pe[K*4+1],U[K]=Z[K*4+2],j[K]=Z[K*4+3]}finally{this.readback.unmap()}const W=new Uint8Array(e.mask);return{filled:_,receivers:S,accumulation:U,potential:j,seaMask:W,preprocessingMs:c,computeMs:E,readbackMs:performance.now()-G,floodPasses:w}}}async function ma(r,t,i,n,a=!1){if(![256,512,1024].includes(i)||r.length!==i*i||!Number.isFinite(t)||t<=0||!r.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const o=await Tt();if(!o||o.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const l=await fa(o.device);if(o.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=ln.get(o.device);u||(u=new Map,ln.set(o.device,u));let s=u.get(i);return s||(s=new ha(o.device,i,l),u.set(i,s)),s.run(r,t,n,a)}const cn=new WeakMap;function ga(r){const t=cn.get(r);if(t)return t;const i=new Float32Array(r.baseHeight.length),n=[],a=m=>r.drainageHeight[m]<r.rawDrainageHeight[m]&&r.surfaceHeight[m]<r.baseHeight[m];let o=!1;for(let m=0;m<i.length;m++){const g=a(m);g&&n.push(m),i[m]=g?0:r.surfaceHeight[m]-r.baseHeight[m],o||=i[m]!==0}const l=256,u=r.width/l,s=new Map,e=[],c=r.riverPoints,f=new Map,d=[],y=r.resolution,x=r.width/y,b=m=>Math.min(x*2,Math.max(x*.5,(r.baseHeight[m]-r.surfaceHeight[m])*1.4)),w=m=>((Math.imul(m^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const m of n){const g=m%y,h=Math.floor(m/y),p=(g+.5)*x,N=(h+.5)*x,C=[];for(let E=-1;E<=1;E++)for(let G=-1;G<=1;G++){const _=g+G,S=h+E,U=S*y+_;if(!G&&!E||_<0||S<0||_>=y||S>=y)continue;const j=a(U);(j&&U>m||!j&&r.basins[U]&&r.surfaceHeight[U]<=r.surfaceHeight[m])&&C.push(U)}C.length||C.push(m);for(const E of C){const G=(E%y+.5)*x,_=(Math.floor(E/y)+.5)*x,S=d.length,U=b(m),j=b(E),W=w(m),B=Math.max(U,j)*(1+Math.abs(W));d.push({a:m,b:E,ra:U,rb:j,skew:W});const F=Me(Math.min(p,G)-B,u,l),Z=Me(Math.max(p,G)+B,u,l),pe=Me(Math.min(N,_)-B,u,l),K=Me(Math.max(N,_)+B,u,l);for(let he=pe;he<=K;he++)for(let X=F;X<=Z;X++){const oe=he*l+X,Ue=f.get(oe);Ue?Ue.push(S):f.set(oe,[S])}}}if(r.incision>0)for(let m=0;m<r.riverCount;m++)for(let g=r.riverOffsets[m];g+1<r.riverOffsets[m+1];g++){const h=g+1,p=Math.max(c[g*4+2],c[h*4+2])*.65+.5,N=e.length;e.push({a:g,b:h,estuary:r.riverMeta[m*6+5]});const C=Me(Math.min(c[g*4],c[h*4])-p,u,l),E=Me(Math.max(c[g*4],c[h*4])+p,u,l),G=Me(Math.min(c[g*4+1],c[h*4+1])-p,u,l),_=Me(Math.max(c[g*4+1],c[h*4+1])+p,u,l);for(let S=G;S<=_;S++)for(let U=C;U<=E;U++){const j=S*l+U,W=s.get(j);W?W.push(N):s.set(j,[N])}}const P={delta:i,hasDelta:o,hasSea:r.basins.includes(0),buckets:s,segments:e,bucketSize:u,side:l,notchBuckets:f,notches:d};return cn.set(r,P),P}const Me=(r,t,i)=>Math.max(0,Math.min(i-1,Math.floor(r/t)));function un(r,t,i,n,a){const o=new Int32Array(i*4),l=new Float64Array(i*4);for(let u=0;u<i;u++){const s=Math.max(0,Math.min(a-1,(r+(u+.5)*t)/n-.5)),e=Math.floor(s),c=s-e,f=1-c;for(let d=0;d<4;d++)o[u*4+d]=Math.max(0,Math.min(a-1,e+d-1));l.set([f**3/6,(3*c**3-6*c*c+4)/6,(-3*c**3+3*c*c+3*c+1)/6,c**3/6],u*4)}return{indices:o,weights:l}}function Ln(r,t,i=!0){const n=r.resolution,a=r.width/n,o=ga(t);if(!o.hasDelta&&!o.segments.length&&!o.notches.length)return;const l=i?new Float32Array(n*n):void 0;if(o.hasDelta){const g=t.resolution,h=t.width/g,p=un(r.x,a,n,h,g),N=un(r.y,a,n,h,g),C=N.indices[0],E=N.indices[N.indices.length-1],G=new Float64Array((E-C+1)*n);for(let _=C;_<=E;_++){const S=_*g,U=(_-C)*n;for(let j=0;j<n;j++){const W=j*4;G[U+j]=o.delta[S+p.indices[W]]*p.weights[W]+o.delta[S+p.indices[W+1]]*p.weights[W+1]+o.delta[S+p.indices[W+2]]*p.weights[W+2]+o.delta[S+p.indices[W+3]]*p.weights[W+3]}}for(let _=0;_<n;_++)for(let S=0;S<n;S++){const U=_*4;let j=G[(N.indices[U]-C)*n+S]*N.weights[U]+G[(N.indices[U+1]-C)*n+S]*N.weights[U+1]+G[(N.indices[U+2]-C)*n+S]*N.weights[U+2]+G[(N.indices[U+3]-C)*n+S]*N.weights[U+3];if(j>0&&o.hasSea&&r.height[_*n+S]<=0){const W=Math.max(0,Math.min(g-1,Math.floor((r.x+(S+.5)*a)/h))),B=Math.max(0,Math.min(g-1,Math.floor((r.y+(_+.5)*a)/h))),F=B*g+W;(!t.basins[F]||t.baseHeight[F]>=0)&&(j=0)}l&&(l[_*n+S]=j),r.height[_*n+S]+=j}}const u=new Set,{bucketSize:s,side:e}=o;for(let g=Me(r.y,s,e);g<=Me(r.y+r.width,s,e);g++)for(let h=Me(r.x,s,e);h<=Me(r.x+r.width,s,e);h++)for(const p of o.buckets.get(g*e+h)??[])u.add(p);const c=new Float32Array(n*n),f=t.riverPoints,d=(g,h)=>Math.max(0,Math.min(n-1,Math.floor((g-h)/a))),y=new Set;for(let g=Me(r.y,s,e);g<=Me(r.y+r.width,s,e);g++)for(let h=Me(r.x,s,e);h<=Me(r.x+r.width,s,e);h++)for(const p of o.notchBuckets.get(g*e+h)??[])y.add(p);const x=t.resolution,b=t.width/x,w=b*.25;for(const g of y){const{a:h,b:p,ra:N,rb:C,skew:E}=o.notches[g],G=Math.max(N,C)*(1+Math.abs(E)),_=(h%x+.5)*b,S=(Math.floor(h/x)+.5)*b,U=(p%x+.5)*b,j=(Math.floor(p/x)+.5)*b,W=U-_,B=j-S,F=W*W+B*B,Z=Math.min(_,U)-G,pe=Math.max(_,U)+G,K=Math.min(S,j)-G,he=Math.max(S,j)+G;if(pe<r.x||Z>r.x+r.width||he<r.y||K>r.y+r.width)continue;const X=Math.abs(B)>1e-12,oe=X?G*Math.sqrt(F)/Math.abs(B):0;for(let Ue=d(K,r.y);Ue<=d(he,r.y);Ue++){const me=r.y+(Ue+.5)*a,ge=X?_+W*(me-S)/B:0,Ge=X?Math.max(Z,ge-oe):Z,Ce=X?Math.min(pe,ge+oe):pe;if(!(Ge>Ce||Ce<r.x||Ge>r.x+r.width))for(let Pe=d(Ge,r.x);Pe<=d(Ce,r.x);Pe++){const se=r.x+(Pe+.5)*a,be=F?Math.max(0,Math.min(1,((se-_)*W+(me-S)*B)/F)):0,Ee=Math.hypot(se-_-W*be,me-S-B*be),ve=w+(N+(C-N)*be-w)*(1+E*Math.sign((se-_)*B-(me-S)*W));if(Ee>=ve)continue;const te=Math.max(0,(Ee-w)/(ve-w)),Ae=1-te*te*(3-2*te),ke=t.surfaceHeight[h]+(t.surfaceHeight[p]-t.surfaceHeight[h])*be,Se=Ue*n+Pe;c[Se]=Math.max(c[Se],Math.max(0,r.height[Se]-ke)*Ae)}}}for(const g of u){const{a:h,b:p,estuary:N}=o.segments[g],C=f[h*4],E=f[h*4+1],G=f[p*4],_=f[p*4+1],S=f[h*4+2],U=f[p*4+2],j=f[h*4+3],W=f[p*4+3],B=Math.max(Math.max(S,U)*.65,.5),F=G-C,Z=_-E,pe=F*F+Z*Z,K=Math.min(C,G)-B,he=Math.max(C,G)+B,X=Math.min(E,_)-B,oe=Math.max(E,_)+B;if(he<r.x||K>r.x+r.width||oe<r.y||X>r.y+r.width)continue;const Ue=d(X,r.y),me=d(oe,r.y),ge=Math.abs(Z)>1e-12,Ge=ge?B*Math.hypot(F,Z)/Math.abs(Z):0;for(let Ce=Ue;Ce<=me;Ce++){const Pe=r.y+(Ce+.5)*a,se=ge?C+F*(Pe-E)/Z:0,be=ge?Math.max(K,se-Ge):K,Ee=ge?Math.min(he,se+Ge):he;if(be>Ee||Ee<r.x||be>r.x+r.width)continue;const ve=d(be,r.x),te=d(Ee,r.x);for(let Ae=ve;Ae<=te;Ae++){const ke=r.x+(Ae+.5)*a,Se=Math.max(0,Math.min(1,((ke-C)*F+(Pe-E)*Z)/Math.max(pe,.001))),$e=S+(U-S)*Se,Re=j+(W-j)*Se,He=Math.hypot(ke-C-F*Se,Pe-E-Z*Se),Fe=Math.max(0,1-He/Math.max($e*.65,.5))**2;if(!Fe)continue;const fe=Math.max(.35,Math.min(12,$e*.11))*t.incision,qe=Ce*n+Ae,or=Math.max(0,Math.min(fe*2+.75,r.height[qe]-(Re-fe)))*Fe*(N>1&&Re<fe?1.15:1);c[qe]=Math.max(c[qe],or)}}}let P=1/0,m=-1/0;for(let g=0;g<n*n;g++)r.height[g]-=c[g],l&&(l[g]-=c[g]),P=Math.min(P,r.height[g]),m=Math.max(m,r.height[g]);if(l)for(let g=0;g<n;g++)for(let h=0;h<n;h++){const p=g*n+h,N=Math.max(0,h-1),C=Math.min(n-1,h+1),E=Math.max(0,g-1),G=Math.min(n-1,g+1),_=l[g*n+C]-l[g*n+N],S=l[G*n+h]-l[E*n+h];if(_===0&&S===0)continue;const U=Math.max(1e-6,r.normalZ[p]),j=-r.normalX[p]/U+_/((C-N)*a||a),W=-r.normalY[p]/U+S/((G-E)*a||a),B=Math.hypot(j,W,1);r.normalX[p]=-j/B,r.normalY[p]=-W/B,r.normalZ[p]=1/B}r.minHeight=P,r.maxHeight=m}const gt=new Float32Array(0);function fn(r,t){const i={...r,normalX:gt,normalY:gt,normalZ:gt};Ln(i,t,!1),r.minHeight=i.minHeight,r.maxHeight=i.maxHeight}const va=(r,t)=>r.riverArea>0?r.riverArea:Math.max(.02,.003*(t/1e3)**2);class Ot{constructor(t,i,n,a,o,l){this.engine=t,this.baseHeight=i,this.backend=n,this.backendReason=a,this.drainageMs=o,this.gpu=l}static async create(t,i,n,a,o,l){const u=performance.now();let s,e,c;if(o!=="cpu")try{const d=await ma(a,i,n,t,l);s=jt.with_drainage(t,i,n,a,l,d.filled,d.receivers,d.accumulation),c=d}catch(d){e=`GPU hydrology unavailable: ${d instanceof Error?d.message:String(d)}`}const f=s?"gpu-f32":"cpu";return s??=new jt(t,i,n,a,l),new Ot(s,a,f,e,performance.now()-u,c)}generate(t,i){const n=performance.now(),a=this.engine.generate(t.main,t.density,t.wetness,t.lakes,t.meanders,t.meanderIntensity,t.estuary,t.widthScale,t.incision,t.minLakeArea,t.lakeAbundance,t.lakeCoverage,t.maxLakeArea,t.depressionPolicy,t.maxBreachDepth,t.maxBreachLength,t.minLakeDepth,i.temperature,i.precipitation,t.coastalStreams);try{const o=a.stage_ms,l=a.stage_labels?Object.fromEntries(a.stage_labels.split(",").map((w,P)=>[w,o[P]])):void 0,u=a.basins;let s=0,e=0;for(const w of u)s=Math.max(s,w),w&&e++;const c=a.river_offsets,f=a.lake_meta,d=a.lake_closed;let y=0;for(let w=2;w<f.length;w+=6)y+=f[w];const x=a.river_meta;let b=!1;for(let w=4;w<x.length;w+=6)b||=(x[w]&2)!==0;return{width:a.width,resolution:a.resolution,receivers:a.receivers,accumulation:a.accumulation,basins:u,rawReceivers:a.raw_receivers??a.receivers,rawAccumulation:a.raw_accumulation??a.accumulation,rawBasins:a.raw_basins??u,flatLabels:a.flat_labels??new Uint32Array(u.length),flatRank:a.flat_rank??new Uint32Array(u.length),externalInflowArea:a.external_inflow_area??0,rawFilled:a.raw_filled??a.filled,rawDrainageHeight:a.raw_drainage_height??a.drainage_height,breachCount:a.breach_count??0,breachCutVolumeM3:a.breach_cut_volume_m3??0,avoidedFillVolumeM3:a.avoided_fill_volume_m3??0,filled:a.filled,lakeDepth:a.lake_depth,lakeLabels:a.lake_labels,baseHeight:this.baseHeight,drainageHeight:a.drainage_height,surfaceHeight:a.surface_height,adjustedHeight:a.adjusted_height,riverPoints:a.river_points,riverOffsets:c,riverMeta:x,riverFlare:a.river_flare,lakePoints:a.lake_points,lakeOffsets:a.lake_offsets,lakeMeta:f,lakeRingMeta:a.lake_ring_meta,lakeClosed:d,waterField:a.water_field,closedLakeCount:d.reduce((w,P)=>w+P,0),nodePoints:a.node_points,nodeMeta:a.node_meta,riverCount:c.length-1,lakeCount:f.length/6,basinCount:s,lakeFraction:y/Math.max(1,e*(a.width/a.resolution)**2),incision:t.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&t.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(t.main)&&!b?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-n,stageMs:l,generationMs:this.drainageMs+performance.now()-n,routingPotential:t.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{a.free()}}dispose(){this.engine.free()}}let dn="",Jr,Ut="",ur,pn="";function Gn(r,t){if(new URL(r).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const i=r+(t?.runtimeSha256??"")+(t?.runtimeJsSha256??"");return(dn!==i||!Jr)&&(dn=i,Jr=(async()=>{if(t){const{javascript:o,wasm:l}=await Li(r,t),u=URL.createObjectURL(new Blob([o],{type:"text/javascript"}));try{const s=await import(u);return await s.default({module_or_path:l}),s}finally{URL.revokeObjectURL(u)}}const a=await import(new URL("magna_urbis_neural_wasm.js",r).href);return await a.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",r)}),a})().catch(n=>{throw Jr=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Jr}async function Lt(){if(ur){try{(await ur).free()}catch{}ur=void 0,Ut=""}}async function ya(r,t,i,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:a}=await Et(r),o=[a.runtimeSha256,...kr.map(s=>a.models[s].sha256)].join(":");(Ut!==r+o||!ur)&&(await Lt(),Ut=r+o,ur=(async()=>{const s=await Gn(r,a);pn=o;const e=[];for(const c of kr){const f=a.models[c];n?.(`Neuronal WASM · ${c} · ${(f.bytes/1e6).toFixed(1)} Mo`),e.push(await An(r,a,c,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),s.NeuralRelief.create(e[0],e[1],e[2])})().catch(s=>{throw ur=void 0,s}));const l=await ur;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await l.generate_json(JSON.stringify(Object.fromEntries(t)),i?JSON.stringify(i):"");try{const s=new Float32Array(u.heights),e=JSON.parse(u.meta),c=Number(t.get("extent")??4e4),f=Number(t.get("resolution")??Math.ceil(c/Number(t.get("sampleSpacing")??30))),d=e.resolution;if(e.extent!==c||e.nativeCellM!==30||e.nativeResolution!==Math.ceil(c/30)||typeof d!="number"||!Number.isInteger(d)||d!==f||s.length!==d*d||e.outputCellM!==c/d||s.some(y=>!Number.isFinite(y)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:s,meta:{...e,modelIdentity:pn}}}finally{u.free()}}let hn;async function Fn(r,t,i,n){hn??=At();const{seed:a,width:o,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sketch:y,source:x}=r,b=y?.processing,w=er(r),P={seed:a,width:o,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sampleSpacing:w.requestedSpacing,sourceN:w.n,coastProfile:fr(r),coastMask:r.coastMask??0,islandMode:r.islandMode??"island",source:x,...b?{sketch:{processing:b},surface:Array.from(Xr(wr(y),w.n))}:{}},g=await(await Dr(t,"/terrain",JSON.stringify({session:hn,settings:P,region:i,field:n}))).arrayBuffer();if(g.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const h=new DataView(g).getUint32(0,!0);if(h%4||4+h>g.byteLength)throw new Error("En-tête terrain local invalide.");const p=JSON.parse(new TextDecoder().decode(new Uint8Array(g,4,h)));let N=4+h;const C={};for(const _ of p.arrays){const S=_.count*(_.type==="f32"?4:1);if(!Number.isSafeInteger(_.count)||_.count<0||N+S>g.byteLength)throw new Error("Raster terrain local incomplet.");C[_.name]=_.type==="f32"?new Float32Array(g,N,_.count):new Uint8Array(g,N,_.count),N+=S}const E=C.height,G=p.resolution*p.resolution;if(!Number.isInteger(p.resolution)||p.resolution<64||p.resolution>1024||!E||E.length!==G||!E.every(Number.isFinite)||["normalX","normalY","normalZ"].some(_=>C[_]?.length!==G))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(p.fieldFloor)||!Number.isInteger(p.fieldN)||p.fieldN!==w.n||C.field?.length!==p.fieldN*p.fieldN||!C.field.every(Number.isFinite)||C.physical?.length!==p.fieldN*p.fieldN||!C.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:p.session,x:p.x,y:p.y,width:p.width,resolution:p.resolution,minHeight:p.minHeight,maxHeight:p.maxHeight,globalMinHeight:p.globalMinHeight,globalMaxHeight:p.globalMaxHeight,motifSize:p.motifSize,height:E,normalX:C.normalX,normalY:C.normalY,normalZ:C.normalZ,caveMask:C.caveMask,prepareMs:p.prepareMs,samplingMs:p.samplingMs,generationMs:p.prepareMs+p.samplingMs,generationBackend:"native",generationReason:p.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${p.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:p.erosionDefaults,...C.field?{field:{n:p.fieldN,data:C.field,exact:p.fieldExact,floor:p.fieldFloor,...C.physicalCave?{cave:C.physicalCave}:{}}}:{},...C.physical?{physical:{n:p.fieldN,height:C.physical}}:{},definition:w}}function wa(r){if(r.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return Fn(r.settings,r.runtime,r.region,r.kind==="overview")}async function xa(r,t){const i=await Fn(r,t,{x:0,y:0,extent:r.width,resolution:64},!0);if(!i.field||i.field.data.length!==er(r).n**2)throw new Error("Surface physique native absente.");return{height:i.field.data,prepareMs:i.prepareMs??0,samplingMs:i.samplingMs??0,session:i.session,fieldExact:i.field.exact,erosionDefaults:i.erosionDefaults}}const ba="[relief_session_missing]",mn=r=>Array.from(r,t=>Number.isFinite(t)?t:null),ka=r=>new Uint8Array(r.buffer,r.byteOffset,r.byteLength);class cr{constructor(t,i){this.runtime=t,this.tuning=i,this.session=At(),this.steps=[],this.released=!1}static async build(t,i,n,a){const o=new cr(t,a.slice());return await o.mutate({op:"build",...i},n),o}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,t=>t??NaN)}editSurface(t){return this.mutate({op:"edit"},t)}coast(t,i,n,a,o){return this.mutate({op:"coast",mask:t,mode:i,coastProfile:o,surface:!!a,...n?{tuning:mn(n)}:{}},a)}carveUnderdark(t,i){return this.mutate({op:"underdark",seed:t,...i!==void 0?{tunnels:i}:{}})}async sampleRegion(t,i,n,a){const{meta:o,arrays:l}=await this.send({op:"read",region:{x:t,y:i,extent:n,resolution:a}}),u=o.region,s=l.height;if(!u||!s||s.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:s,cave_mask:l.caveMask,normal_x:l.normalX,normal_y:l.normalY,normal_z:l.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}async underdarkTunnels(){return(await this.send({op:"read",tunnels:!0})).arrays.tunnels??new Float32Array(0)}free(){this.released||(this.released=!0,this.steps.length=0,Dr(this.runtime,"/release",JSON.stringify({session:this.session})).then(t=>t.arrayBuffer(),()=>{}))}async mutate(t,i){this.meta=(await this.send(t,i)).meta,this.steps.push({header:t,plane:i})}async send(t,i){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(t,i)}catch(n){if(t.op==="build"||!(n instanceof Error)||!n.message.includes(ba))throw n;for(const a of this.steps)await this.call(a.header,a.plane);return this.call(t,i)}}async call(t,i){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:mn(this.tuning),...t})),a=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);a.set(n);const o=new Uint8Array(4);new DataView(o.buffer).setUint32(0,a.length,!0);const u=await(await Dr(this.runtime,"/terrain/relief",new Blob([o,a,...i?[ka(i)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const s=new DataView(u).getUint32(0,!0);if(s%4||4+s>u.byteLength)throw new Error("Native relief reply header invalid.");const e=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,s))),c={};let f=4+s;for(const{name:d,type:y,count:x}of e.arrays){const b=x*(y==="f32"?4:1);if(!Number.isSafeInteger(x)||x<0||f+b>u.byteLength)throw new Error("Native relief plane incomplete.");c[d]=y==="f32"?new Float32Array(u,f,x):new Uint8Array(u,f,x),f+=b}return{meta:e,arrays:c}}}const In=["plateau","volcano","caldera"],Tr=r=>r==="neural-wasm"||r==="neural-python"||r==="neural",Hn="http://127.0.0.1:8792",qn="http://127.0.0.1:8793";function Dn(r,t){const i=r==="neural-python"?qn:Hn,n=t?.trim().replace(/\/+$/,"");if(!n)return i;try{const a=new URL(n);if(a.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(a.hostname)&&["8792","8793"].includes(a.port)&&a.pathname==="/"&&!a.search&&!a.hash&&!a.username&&!a.password)return i}catch{}return n}const Gt={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},jn={flat:20,hills:110,plateau:100},ir=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],qr=r=>r.climateValues??Mn[r.climate??"temperate"];function Ct(r){const t=new Float32Array(r.height.length);let i=0,n=0;for(let l=0;l<r.height.length;l++)r.height[l]>0&&(t[n++]=r.height[l],i+=Math.acos(Math.min(1,r.normalZ[l])));const a=t.subarray(0,n).sort(),o=l=>n?a[Math.min(n-1,Math.floor(l*n))]:0;return{p5:o(.05),p50:o(.5),p95:o(.95),slope:i/Math.max(1,n),land:n/Math.max(1,r.height.length)}}let rt,I,yr="",Kr="",Er,tr="",Rr,gr,We,lr=!1,Y;const De=()=>Y??I,Nr=()=>Y?Y.physicalHeightField():Promise.resolve(I.physical_height_field()),gn=async()=>{if(Y)return Y.underdarkTunnels().catch(()=>new Float32Array(0));const r=I?.underdark_tunnels;return r?r.call(I):new Float32Array(0)},vt=()=>Y?Y.samplingBaseField():Promise.resolve(I.sampling_base_field());let ar="",Ze,vr,ue,nr,Ie="cpu",Te,vn=Promise.resolve(),Ye,Or="",Lr="",Oe,Br,Zr="";async function $n(){if(!Zr)return;const r=Zr;Zr="";try{await fetch(`${r}/release`,{method:"POST"})}catch{}}let Gr,re,Qe;const Fr=new Nt;async function Sa(r,t){const i=er(r),n=Math.ceil(r.width/30),a=(m,g)=>g.extent===r.width&&g.resolution===i.n&&g.nativeCellM===30&&g.nativeResolution===n&&g.outputCellM===r.width/i.n&&m.length===i.n*i.n&&m.every(Number.isFinite),o=Dn(r.source,r.neuralServer),l=new URLSearchParams({seed:r.seed,relief:r.relief,mix:String(r.relief==="mixed"?r.mountainMix:.5),coasts:"0",islands:"island",climate:r.climate??"temperate",noise:String(r.fidelity??.05),extent:String(r.width),sampleSpacing:String(i.requestedSpacing),resolution:String(i.n)}),u=qr(r),s=r.neuralTuning??Gt;for(const[m,g]of Object.entries(u))l.set(m,String(g));l.set("landScale",String(s.landScale)),l.set("steps",String(s.steps)),l.set("detail",String(s.detail));for(const m of["coarseModel","baseModel","decoderModel"])r[m]&&l.set(m,r[m]);for(const m of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])l.set(m,String(s[m]));l.set("histogram",s.histogram.join(","));const e=jn[r.relief];s.reliefMode==="fixed"?l.set("reliefFixed",String(s.reliefFixed)):s.reliefMode==="auto"&&e!==void 0?l.set("reliefFixed",String(e)):l.set("reliefScale",String(s.reliefMode==="scale"?s.reliefScale:1));const c=Si(r.width,r.width,r.neuralFit??"crop",r.neuralSlopes??!0),f=r.zones?{zones:Pn(r.zones),region:{x:c.x,y:c.y,width:c.width}}:r.sketch?_i(wr(r.sketch),c):void 0,d=performance.now();if(r.source==="neural-wasm"){if(await $n(),!r.neuralAssets)throw new Error("Neural browser runtime URL missing.");const m=await ya(r.neuralAssets,l,f,t);if(!a(m.heights,m.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:m.heights,info:{...m.meta,requestMs:performance.now()-d}}}await Lt();let y=f;if(r.source==="neural-python"){if(r.zones&&(await fetch(`${o}/status`,{cache:"no-store"}).then(p=>p.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!r.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const m=await Gn(r.neuralAssets),g=Object.fromEntries(l);y={params:g,conditioning:JSON.parse(m.conditioning_json(JSON.stringify(g),f?JSON.stringify(f):"")),edited:!!f},t?.("Neural Python · computing with PyTorch/CUDA")}const x={cache:"no-store",...y?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(y)}:{}};let b;if(r.source==="neural")b=await Mi({profile:"local",server:o},`/generate?${l}`,x);else try{b=await fetch(`${o}/generate?${l}`,x)}catch{throw new Error(`Neural service unreachable (${o}): run “npm run neural:python” from web/`)}if(!b.ok)throw new Error(`Neural service: ${await b.text()}`);const w=new Float32Array(await b.arrayBuffer()),P=JSON.parse(b.headers.get("X-Neural-Meta")??"{}");if(r.source==="neural-python"&&(Zr=o),f&&(P.edited!==!0||P.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!a(w,P))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:w,info:{...P,requestMs:performance.now()-d}}}function _a(r){return rt??=(async()=>{wi()?(r?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await xi(),r?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await bi(()=>ki(Ni,t=>Ri({module_or_path:t}),r))})()}wn(()=>{Fr.clear(),rt=void 0,I=void 0,Y?.free(),Y=void 0,yr="",ar="",lr=!1,Ye=void 0,Oe=void 0,Or="",Lr="",Gr=void 0,re=void 0,Qe=void 0});function Ma(r,t,i,n){const a=vn.then(()=>yn(r,t,i,n).catch(async o=>{if(!await li(o))throw o;return i?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),yn(r,t,i,n)}));return vn=a.catch(()=>{}),a}async function yn(r,t,i,n){const{settings:a,region:o,kind:l,display:u,runtime:s}=r,e=a.islandMode?.startsWith("traced:")&&(a.sketch?.processing||a.relief==="cavern"||a.underdark)?{...a,islandMode:"island"}:a,c=er(e);if(ci(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning}),e.climateZone==="wetland"&&(e.erosionTuning={carve:0,finalCarve:0,surfaceCarve:0,...e.erosionTuning});const f=e.compute==="wasm"?"wasm":"gpu-f32",d=e.generationCompute??"gpu-erosion";if(ui(e,c.n))throw new Error(`GPU generation is limited to ${fi}² cells; requested spacing ${c.spacing.toFixed(2)} m (${c.n}²). Choose CPU or native.`);const y=je(e.generalSeed??e.seed,"relief-coast-cut"),x=!!e.generalSeed&&bt(e.generalSeed,M=>M.startsWith("relief-"))!==_n(e.generalSeed),b=br(e),w=e.hydrology?.compute==="auto"&&(f==="wasm"||d==="cpu")?"cpu":e.hydrology?.compute??"auto";if(w!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&Tt(),b&&!e.zones&&!e.sketch?.processing&&(!di.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const P=d==="native"&&!Tr(e.source);if(P&&s?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(P&&e.relief==="cavern")return wa({...r,settings:e});const m=In.includes(e.relief)?e.environment??"mixed":"mixed",g=e.sketch?.processing,h=ie(e,"coasts")?e.relief==="cavern"||e.underdark?0:e.coastMask??0:0,p=e.islandMode??"island",N=fr(e),C=Vi.includes(e.relief),E=f!=="wasm"&&C?Ji(f,e.relief).catch(()=>{}):void 0;rt&&i?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await _a(i)}catch(M){throw rt=void 0,M}const G=performance.now();E&&i?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const _=E?await xr(E):void 0;n&&await n.after("prepare");const S=(M,k)=>{const R=We;We={erosionSpacing:M===void 0?R?.erosionSpacing:Math.max(R?.erosionSpacing??0,M),regionalErosionSpacing:k===void 0?R?.regionalErosionSpacing:Math.max(R?.regionalErosionSpacing??0,k)},Object.assign(c,We)},U=async(M,k=!1)=>{let R=k&&ie(e,"phasor",!1)?xt(M,e):M;const Q=wt(e),J=yt(e),de=et(e);for(const A of["posterior","wind"]){const L=JSON.stringify([de.get(A),s?.server,!!_,Gi(new Uint8Array(R.buffer,R.byteOffset,R.byteLength))]),le=e.procedural?Fr.get(A,L):void 0;if(le){R=le,n?.cached?await n.cached(A,n.previews===!1?void 0:R):(await n?.before(A),await n?.after(A,n.previews===!1?void 0:R));continue}if(await n?.before(A),A==="posterior"&&e.procedural&&ie(e,A)&&Q.mode!=="none"){const H=R,ne=Math.sqrt(R.length);R=(await Wt(R,ne,e.width,Q,{stats:!1},s)).height;for(let ee=0;ee<R.length;ee++)R[ee]=H[ee]>0?Math.max(.3,R[ee]):R[ee]}A==="wind"&&e.procedural&&ie(e,A)&&J.iterations&&J.transport&&(R=_?await ji(_.context,R,e.width,J):Di(R,e.width,J)),e.procedural&&c.n<=1024&&Fr.put(A,L,R),await n?.after(A,n.previews===!1?void 0:R)}return e.procedural&&R.some(A=>A<.3)?R.map(A=>Math.max(.3,A)):R},j=_?xr(_.pipeline).then(M=>({pipeline:M}),()=>{}):void 0,W=!P&&!e.zones&&!e.sketch&&d!=="cpu"&&f!=="wasm"&&!Tr(e.source)&&e.relief!=="cavern",B=W&&_?aa(_.context,e):void 0;if(B?.error&&e.generationCompute)throw new Error(B.error);const F=e.generationCompute||!B?void 0:B.error??(pi(B)?`Source ${c.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),Z=!!B&&!B.error&&!F,pe=W&&Ki.includes(e.relief),K=pe&&Z,he=(c.n!==1024||!!(e.procedural||n||x))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!Tr(e.source)&&(!K||d!=="gpu-erosion"),X=!g&&Tr(e.source);X||(await Lt(),await $n());const oe=s?.profile==="local"&&(P||X),Ue=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,ct(e.modification.delta)]):"",me=JSON.stringify([e.zones,Ue,!!e.underdark,y,P?[s.server,h,p,N]:null,oe?s.server:null])+"|"+JSON.stringify(X?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,qr(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??Gt,e.width,c.n,e.coarseModel,e.baseModel,e.decoderModel,e.neuralFit,e.neuralSlopes]:[e.seed,...e.generalSeed?[bt(e.generalSeed,M=>M.startsWith("relief-"))]:[],e.width,c.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,P?"native":b?[d,f,!!_]:pe?d:"cpu",m,e.sketch,e.erosionTuning??{},...e.procedural?[hi,N,e.procedural,e.climate,e.climateValues,e.climateZone,K?null:[h,p,N]]:[],...b||e.procedural?.enabled?.phasor?[lt,e.climate??"temperate",e.phasor??{}]:[]]);let ge=0,Ge=0,Ce=0,Pe=0,se=0,be;if(n&&n.previews!==!1||!(I||Y)||yr!==me){ue?.dispose(),ue=void 0,nr=void 0,I?.free(),I=void 0,Y?.free(),Y=void 0,lr=!1,yr="",ar="",We=void 0;const M=performance.now();tr="",Kr="",Rr=void 0,gr=void 0,Er=void 0,Ie="cpu",Te=void 0;const k=e.relief==="mixed"?e.mountainMix:.5;Br=void 0;const R=Float64Array.from(ir,A=>{let L=b&&!e.procedural?NaN:e.procedural?.erosionTuning?.[A]??e.erosionTuning?.[A]??NaN;return e.procedural?.biome&&!K&&!he&&(A==="incision"||A==="thermal")&&(L=(Number.isFinite(L)?L:1)*(A==="incision"?Cr(e).water:Cr(e).thermal)),L});if(Ar(R),he){i?.(F?`${F} Rust CPU generation at ${c.spacing.toFixed(2)} m…`:P?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const A=await U(await Hi(e,n,P?s:void 0,K&&_?()=>Zt(_.context,e,i):void 0,(L,le)=>{We={erosionSpacing:L,regionalErosionSpacing:le},Object.assign(c,We)}));n&&await n.before("retain"),oe?Y=await cr.build(s,{kind:"source",seed:y,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:k,environment:m},A,R):I=xe.with_source(y,e.width,e.relief,e.erosion,e.motifSize,k,A,m),n&&await n.after("retain",n.previews===!1?void 0:A),Ie=P?"native":K?d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":b?"compact-cpu":"cpu",Te=F??`${P?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(P){i?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${c.n} × ${c.n} physical field`});const A=e.procedural?.biome?{...e,coastMask:h,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*Cr(e).water,thermal:(e.erosionTuning?.thermal??1)*Cr(e).thermal}}:{...e,coastMask:h},L=await xa(A.sketch&&!g?{...A,sketch:void 0}:A,s),le=g!=="surface"&&e.procedural&&!e.zones?await U(L.height.slice(),!0):void 0;if(le&&h)for(let H=0;H<le.length;H++)L.height[H]<=0&&(le[H]=L.height[H]);Y=await cr.build(s,{kind:"surface",seed:y,width:e.width},le??L.height,R),Ie="native",Te="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",se=L.prepareMs}else if(g){i?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const A=Xr(wr(e.sketch),c.n);if(g==="erosion"){i?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),I=xe.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,m,c.n),I.set_edited_surface(A);const L=I.sampling_base_field();I.free(),I=xe.with_surface(y,e.width,L)}else I=xe.with_surface(y,e.width,A);Te=g==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if(X){const A=await Sa(e,i),L=mi(A.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);oe?Y=await cr.build(s,e.zones?{kind:"zonedSurface",seed:y,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:y,width:e.width},L,R):I=e.zones?xe.with_zoned_surface(y,e.width,e.motifSize,L,JSON.stringify(e.zones)):xe.with_surface(y,e.width,L),Br=A.info,Ie="neural",e.zones&&(Te="Zones → regional conditioning and local neural relief, then sea operation.")}else if(b&&!e.zones)if(_&&Z){i?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:S},L=await U(await on(_.context,e,A,i));n&&await n.before("retain"),be=A.profiles,I=xe.with_source(y,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,k,L,m),n&&await n.after("retain",L),Ie="compact-gpu-f32",Te=`${lt} · compact preset · ${e.procedural?.regionalN??$t(e).n}² grid · ${e.climate??"temperate"} · Phasor ${ie(e,"phasor",!0)?"enabled":"disabled"}.`}else{i?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const A=e.procedural?.biome?Cr(e):void 0,L=A?{incision:A.water,thermal:A.thermal}:e.procedural?{incision:1,thermal:1}:gi(e),le=e.procedural?.erosionTuning?.iterations??$t(e).steps,H=e.erosionTuning??{},ne={...H,iterations:le,surfaceIterations:ie(e,"surface",!1)?H.surfaceIterations??12:0,detail:ie(e,"ridged",!1)?H.detail:0,warp:H.warp??0,incision:(H.incision??1)*L.incision,thermal:(H.thermal??1)*L.thermal};Ar(Float64Array.from(ir,D=>ne[D]??NaN));let ee;try{ee=xe.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,m,c.n);const D=ee.physical_height_field();I=xe.with_source(y,e.width,"hills",e.erosion,e.motifSize,k,ie(e,"phasor",!0)?xt(D,e):D,m)}finally{ee?.free(),Ar(new Float64Array(ir.length).fill(NaN))}Ie="compact-cpu",Te=`${lt} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)i?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n} × ${c.n} physical field`}),I=xe.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,m,JSON.stringify(Pn(e.zones)),c.n),Te="Zone masks → uplift, noise, ridges and Rust erosion.";else if(K&&_)try{if(d==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:S},L=await U(await on(_.context,e,A,i));n&&await n.before("retain"),se=A.nativeEnvironmentMs,be=A.profiles,Pe=performance.now()-M-se,I=xe.with_source(y,e.width,e.relief,e.erosion,e.motifSize,k,L,m),n&&await n.after("retain",L),Ie="gpu-erosion-f32"}else{const A=await Zt(_.context,e,i);Ge=performance.now()-M;const L=performance.now();i?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),I=xe.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,A.coarse,A.fine,m),Ce=performance.now()-L,Ie=d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(A){if(n||e.procedural)throw A;Te=`GPU generation unavailable: ${A instanceof Error?A.message:String(A)}`}if(!I&&!Y&&(i?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n}² physical source at ${c.spacing.toFixed(2)} m`}),I=xe.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,m,c.n),F&&(Te=F)),!g&&!X&&e.sketch&&e.relief!=="cavern"){const A=wr(e.sketch),L=await Nr(),le=vi(A,L,c.n);Y?await Y.editSurface(le):I.set_edited_surface(le),Te="Edited sketch + procedural detail and Rust erosion."}const Q=wt(e),J=yt(e),de=ie(e,"posterior")&&Q.mode!=="none"||ie(e,"wind")&&J.iterations>0&&J.transport>0;if(!he&&e.procedural&&(de||!b&&ie(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(Ie)&&!X&&!g&&!P&&!e.zones){Jt(I,h,p,N);const A=I.physical_height_field(),L=await U(A,!b);I.free(),I=xe.with_surface(y,e.width,L),lr=!0}e.modification&&(X||g)&&(Er=await vt()),ge=performance.now()-M,yr=me}else if(i?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),We&&Object.assign(c,We),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const M of["grids",...tt(e),"phasor","posterior","wind"])await n.cached(M);const Ee=JSON.stringify([me,y,h,p,N,et(e).get("coasts"),Ie,s?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,ct(e.sketch.heights)],e.zones&&[e.zones.resolution,ct(e.zones.weights)]]),ve=!!(e.procedural||X||g)&&!lr&&!(P&&!he),te=ve&&h?Fr.get("coasts",Ee):void 0;!te&&n&&await n.before("coasts");const Ae=!X&&!g&&!lr&&!B?.error&&!F&&!e.zones&&!e.sketch&&h!==0&&d!=="cpu"&&f!=="wasm",ke=JSON.stringify([y,h,h?p:"island",N,h?Ae:!1,e.procedural?.coastIterations,e.procedural?.coastIncision,e.procedural?.coastThermal,e.procedural?.coastDiffusion,e.erosionTuning]);let Se=0;if(Er&&tr&&tr!==me+"|"+ke){if(ue?.dispose(),ue=void 0,nr=void 0,Y){const M=Y;Y=await cr.build(s,{kind:"surface",seed:y,width:e.width},Er,new Float64Array(ir.length).fill(NaN)),M.free()}else I?.free(),I=xe.with_surface(y,e.width,Er);ar="",tr="",gr=void 0,Rr=void 0,Kr=""}if(P&&!he||lr)ar=ke,Ze=lr&&h?"cpu":void 0,vr=void 0;else if(ar!==ke){ue?.dispose(),ue=void 0,nr=void 0,Ze=void 0,vr=void 0;const M=performance.now();i?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const k=e.procedural,R={...e.erosionTuning,...k?.erosionTuning},Q=h?Float64Array.from(ir,J=>k&&J==="surfaceIterations"?k.coastIterations??(b?2:12):J==="surfaceIncision"?(R[J]??1)*(k?.coastIncision??1):J==="surfaceThermal"?(R[J]??1)*(k?.coastThermal??1):J==="surfaceDiffusion"?(R[J]??1)*(k?.coastDiffusion??1):R[J]??NaN):void 0;if(Y?(await Y.coast(h,p,te?void 0:Q,te,N),h&&(Ze="native")):te&&(Kt(I,h,p,N),I.set_coast_surface(te),Ze="cpu"),!Y&&!te&&Ae&&_){let J;try{const de=await j;if(!de||_.context.lost)throw new Error("WebGPU unavailable");Kt(I,h,p,N),J=new Qt(_.context,de.pipeline,f,I);const A=J.prepareCoastField(e),L=await oa(_.context,e,A,I.coast_erosion_parameters(),i);I.set_coast_surface(L),Ze="gpu-f32"}catch(de){vr=`GPU coast unavailable: ${de instanceof Error?de.message:String(de)}`}finally{J?.dispose()}}if(!Y&&!Ze){Q&&Ar(Q);try{Jt(I,h,p,N)}finally{Q&&Ar(Float64Array.from(ir,J=>R[J]??NaN))}h&&(Ze="cpu"),Ae&&!_&&(vr="WebGPU unavailable")}ar=ke,Se=h?performance.now()-M:0,ge+=Se}const $e=h&&ve&&(!te&&c.n<=1024||n&&n.previews!==!1&&!(te&&n.cached))?await vt():void 0;if($e&&!te&&c.n<=1024&&Fr.put("coasts",Ee,$e),te&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:te):n&&await n.after("coasts",n.previews===!1?void 0:$e),e.modification&&tr!==me+"|"+ke){const M=De().source_resolution(),k=g==="surface"&&!h?Xr(wr(e.sketch),M):await Nr();if(Rr={n:M,height:k.slice()},gr=yi(k,M,e.modification),ue?.dispose(),ue=void 0,nr=void 0,Y){const R=Y;Y=await cr.build(s,{kind:"surface",seed:y,width:e.width},gr,new Float64Array(ir.length).fill(NaN)),R.free()}else I?.free(),I=xe.with_surface(y,e.width,gr);tr=me+"|"+ke}e.underdark&&Kr!==me+"|"+ke+"|"+tr+"|"+(e.underdarkTunnels??"")&&(i?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),ue?.dispose(),ue=void 0,nr=void 0,Y?await Y.carveUnderdark(e.seed,e.underdarkTunnels):I.carve_underdark(e.seed,e.underdarkTunnels),Kr=me+"|"+ke+"|"+tr+"|"+(e.underdarkTunnels??""));let Re;const He=async(M,k,R)=>((Re?.delta!==M||Re.m!==k||Re.n!==R)&&(Re={delta:M,m:k,n:R,out:await Ei(M,k,R,s)}),Re.out);async function Fe(M){We?Object.assign(c,We):c.erosionSpacing??=De().erosion_spacing(),M.definition=c,n&&await n.after("sampling",M.height),n&&await n.before("hydrology");const k=ie(e,"hydrology")?e.hydrology:void 0;M.neural=Br,l==="overview"&&!X&&e.relief!=="cavern"&&(M.erosionDefaults=Array.from(Pi(e.relief,e.width,e.motifSize,e.mountainMix)));const R=!!k?.enabled&&e.relief!=="cavern",Q=k?.engine!=="rust",J=k?.erosionEnabled!==!1,de=J&&k?.showErosion!==!1,A=J?k?.condMode:"none",L=Q&&k&&k.lakes!=="none"?[k.lakeAbundance,k.lakeArea,k.lakeDepth,k.lakeCoverage,k.maxLakeArea]:[0,0,0,0,0],le=k&&{mode:k.condMode,strength:k.condStrength,maxDepth:k.condDepth,maxLength:k.condLength,banks:k.condBanks,lakes:L[0],lakeArea:L[1],lakeDepth:L[2],lakeCoverage:L[3],maxLakeArea:L[4],...e.climateZone==="wetland"?{undulation:2}:{}};if(t&&k&&R&&l==="overview"&&u==="gl"){const H=Yt(Q?k.vectorResolution:k.resolution,c.n),ne=JSON.stringify([yr,ar,H,A,A==="none"?0:[k.condStrength,k.condDepth,k.condBanks,k.condLength,L]]);if(!re||re.key!==ne||Q&&!Qe){const ee=Ct(M);t({...M,height:M.height.slice(),normalX:M.normalX.slice(),normalY:M.normalY.slice(),normalZ:M.normalZ.slice(),caveMask:M.caveMask.slice(),neural:Br&&{...Br,land:ee.land},field:await fe(M,!1,Q),relief:ee,generationMs:performance.now()-G})}}if(k&&R){const H=Yt(Q?k.vectorResolution:k.resolution,c.n),ne=JSON.stringify([yr,ar,H,A,A==="none"?0:[k.condStrength,k.condDepth,k.condBanks,k.condLength,L]]),ee=qr(e),D={riverArea:va(k,e.width)/Math.max(1,k.density)**2,density:Math.min(1,k.density),headwaters:k.headwaters!==!1?1:0,minRiverLength:k.minRiverLength,lakeDepth:k.lakeDepth,lakeArea:k.lakeArea,riverMode:k.riverMode,flatSlope:k.flatSlope,sinuosity:k.sinuosity,widthScale:k.vectorWidth,balance:k.balance,braiding:k.braiding,anabranching:k.anabranching,terrainInfluence:k.terrainInfluence,avulsions:k.avulsions,confluence:k.confluence,deltas:k.deltas,...e.climateZone==="wetland"?{oxbows:.35}:{}},_e=JSON.stringify([ne,D,ee.temperature,ee.precipitation,je(e.generalSeed??e.seed,"water-hydrology")]);if(!re||re.key!==ne){re=void 0,Qe=void 0,Ye?.dispose(),Ye=void 0,Oe=void 0,Or="",Lr="";let $;if(M.x===0&&M.y===0&&M.width===e.width&&M.resolution===H)$=M.height.slice();else if(ue&&!ue.lost)$=(await ue.sample({x:0,y:0,extent:e.width,resolution:H},e,I.min_height,I.max_height)).height;else{const V=Y?await Y.sampleRegion(0,0,e.width,H):I.sample_region(0,0,e.width,H);try{$=V.height}finally{V.free()}}if(A==="none")re={key:ne,n:H,height:$,m:0};else{i?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const V=le;if(Q){const Ne=await Vt($,H,e.width,V,D,ee,je(e.generalSeed??e.seed,"water-hydrology"),s),{height:ae,delta:q,...pr}=Ne.conditioning;re={key:ne,n:H,height:ae,source:$,delta:q,m:H,stats:pr},Qe={key:_e,water:Ne.water}}else{const Ne=await Wt($,H,e.width,V,{stats:!1,drainage:!1},s),{height:ae,delta:q,hydrology:pr,...$r}=Ne;re={key:ne,n:H,height:ae,source:$,delta:q,m:H,stats:{...$r,census:!1},drainage:pr}}}}if(Q){if(!Qe||Qe.key!==_e)if(i?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),re.source){const $=await Vt(re.source,H,e.width,le,D,ee,je(e.generalSeed??e.seed,"water-hydrology"),s),{height:V,delta:Ne,...ae}=$.conditioning;Object.assign(re,{height:V,delta:Ne,stats:ae}),Qe={key:_e,water:$.water}}else Qe={key:_e,water:await zi(re.height,H,e.width,D,ee,je(e.generalSeed??e.seed,"water-hydrology"),re.drainage,s)}}else{const $=JSON.stringify([ne,w,je(e.generalSeed??e.seed,"water-hydrology")]),V={...k,showErosion:!0,erosionEnabled:J,...J?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},Ne=`${$}|${JSON.stringify(V)}`;if(X&&Gr?.key===Ne)M.hydrologyError=Gr.message;else try{(!Ye||Or!==$)&&(i?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),Ye?.dispose(),Ye=void 0,Oe=void 0,Lr="",Ye=await Ot.create(je(e.generalSeed??e.seed,"water-hydrology"),e.width,H,re.height.slice(),w,h!==0||(g||X||e.sketch||e.zones?De().min_height<=0:!1)),Or=$);const ae=qr(e),q=JSON.stringify([V,ae.temperature,ae.precipitation]);(!Oe||Lr!==q)&&(i?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Oe=Ye.generate(V,ae),Lr=q)}catch(ae){if(!X)throw ae;Ye?.dispose(),Ye=void 0,Oe=void 0,Or="",Gr={key:Ne,message:ae instanceof Error?ae.message:String(ae)},M.hydrologyError=Gr.message}}}if(i?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),R&&de&&re?.delta&&!e.underdark&&await Ui(M,re.delta,re.m,e.width,s),R&&de&&!Q&&Oe&&!M.hydrologyError){const H=performance.now();Ln(M,Oe),M.hydrologySurfaceMs=performance.now()-H}if(l==="overview"){const H=De().source_resolution(),ne=e.underdark?await Nr():gr?.slice()??(g==="surface"&&!h?Xr(wr(e.sketch),H):await Nr());if(R&&de&&re?.delta&&!e.underdark){const ee=await He(re.delta,re.m,H);for(let D=0;D<ne.length;D++)ne[D]+=ne[D]<=0?Math.min(0,ee[D]):ee[D]}R&&de&&!Q&&Oe&&!M.hydrologyError&&fn({x:0,y:0,width:e.width,resolution:H,height:ne,minHeight:M.globalMinHeight,maxHeight:M.globalMaxHeight},Oe),M.physical={n:H,height:ne},Rr&&(M.modificationBase=Rr)}return e.refine&&u!=="gl"&&Ci(M,e.width/De().source_resolution(),Ai(e.seed),e.detailNoise),l==="overview"&&(u==="gl"||r.retainField)&&(i?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),M.field=await fe(M,R,Q)),l==="overview"&&R&&(Q?M.water=Qe?.water:Oe&&!M.hydrologyError&&(M.hydrology=Oe),re?.delta&&re.stats&&(M.conditioning={delta:re.delta,n:re.m,stats:re.stats})),l==="overview"&&(M.relief=Ct(M)),M.neural&&M.relief&&(M.neural={...M.neural,land:M.relief.land}),M.generationMs=performance.now()-G,n&&await n.after("hydrology",M.height),M}async function fe(M,k,R){const Q=De().sampling_parameters()[5],J=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((Q===1||Q===4)&&e.relief!=="cavern"){const H=De().source_resolution(),ne=await vt();if(k&&J&&re?.delta&&!e.underdark){const $=await He(re.delta,re.m,H);for(let V=0;V<H*H;V++)ne[V]+=ne[V]<=0?Math.min(0,$[V]):$[V]}const ee=k&&J&&!R&&!M.hydrologyError?Oe:void 0;ee&&fn({x:0,y:0,width:e.width,resolution:H,height:ne,minHeight:M.globalMinHeight,maxHeight:M.globalMaxHeight},ee);const D=e.underdark?Y?await Y.physicalCaveField():I.physical_cave_field():void 0,_e=e.underdark?await gn():void 0;return{n:H,data:ne,exact:!ee,floor:Q===1?.3:0,cave:D?.length?D:void 0,..._e?.length?{tunnels:_e}:{}}}const de=De().source_resolution(),A=M.physical?.height.slice()??await Nr(),L=e.relief!=="cavern"&&!e.underdark?void 0:Y?await Y.physicalCaveField():I.physical_cave_field(),le=e.underdark?await gn():void 0;return{n:de,data:A,exact:!1,floor:0,cave:L?.length?L:void 0,...le?.length?{tunnels:le}:{}}}n&&await n.before("sampling",`Borne du moteur ${De().max_height.toFixed(2)} m · aperçu ${o.resolution}²`);let qe,or=0,Je;if(f!=="wasm"&&C&&!Y&&!e.underdark){i?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const M=performance.now();try{const k=await j;_&&k&&!_.context.lost&&((!ue||nr!==f||ue.lost)&&(ue?.dispose(),ue=void 0,ue=new Qt(_.context,k.pipeline,f,I),nr=f),or=performance.now()-M,i?.(`GPU · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"}),Je={...await ue.sample(o,e,I.min_height,I.max_height),generationMs:performance.now()-G,prepareMs:ge,gpuSetupMs:or,generationBackend:Ie,generationReason:Te,noiseMs:Ge,erosionMs:Ce,gpuSimulationMs:Pe,nativeEnvironmentMs:se,erosionProfile:be,coastBackend:Ze,coastMs:Se,coastReason:vr}),Je||(qe="WebGPU indisponible")}catch(k){qe=`GPU indisponible : ${k instanceof Error?k.message:String(k)}`,ue?.dispose(),ue=void 0,nr=void 0}}else Y?qe="Native Rust sampling on the local service.":f!=="wasm"&&(qe="terrain currently sampled in WASM");if(Je)return Fe(Je);i?.(`${Y?"Native Rust":"CPU"} · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"});const dr=performance.now(),ye=Y?await Y.sampleRegion(o.x,o.y,o.extent,o.resolution):I.sample_region(o.x,o.y,o.extent,o.resolution);try{return await Fe({x:ye.x,y:ye.y,width:ye.width,resolution:ye.resolution,minHeight:ye.min_height,maxHeight:ye.max_height,globalMinHeight:De().min_height,globalMaxHeight:De().max_height,motifSize:e.motifSize,height:ye.height,caveMask:ye.cave_mask,normalX:ye.normal_x,normalY:ye.normal_y,normalZ:ye.normal_z,generationMs:performance.now()-G,backend:Y?"native":"wasm",backendReason:qe,prepareMs:ge,samplingMs:performance.now()-dr,gpuSetupMs:or,generationBackend:Ie,generationReason:Te,noiseMs:Ge,erosionMs:Ce,gpuSimulationMs:Pe,nativeEnvironmentMs:se,erosionProfile:be,coastBackend:Ze,coastMs:Se,coastReason:vr})}finally{ye.free()}}const Ua=Object.freeze(Object.defineProperty({__proto__:null,CLIMATE_VALUES:Mn,DEFAULT_NEURAL_SERVER:Hn,DEFAULT_NEURAL_TUNING:Gt,DEFAULT_PYTHON_SERVER:qn,EROSION_SETTINGS:ir,GEOLOGICAL_RELIEFS:In,NEURAL_RELIEF_DEFAULTS:jn,climateOf:qr,isNeuralSource:Tr,neuralServerForSource:Dn,reliefStatistics:Ct,sampleRustTerrain:Ma},Symbol.toStringTag,{value:"Module"}));export{kr as N,An as a,Le as b,qr as c,Ti as d,Gi as e,ct as f,Oi as g,Et as l,za as n,Li as o,et as p,_t as s,Ua as t};
