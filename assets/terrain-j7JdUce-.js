import{T as St,n as Lr,o as tr,p as rt,G as Ir,q as hn,t as mn,u as gn,w as ie,x as Wn,y as _t,z as Xr,s as Je,A as Mt,B as vn,C as gt,D as Fr,E as Bt,F as vt,H as yn,I as Mr,J as Yn,K as xe,L as yt,M as wn,N as Tt,O as Vn,P as Jn,Q as Ot,S as Wr,U as wr,V as Kn,W as Xn,X as Zn,Y as Qn,Z as ei,_ as ri,$ as st,a0 as ti,a1 as lt,a2 as Er,a3 as Rr,a4 as ni,a5 as Gt,a6 as ii,a7 as xn,a8 as ai,a9 as Lt,aa as Ft,ab as oi,ac as si,ad as li,ae as ci,af as ui,ag as fi,ah as It,ai as di,aj as pi,ak as hi,al as mi,am as Ht,an as qt,ao as gi,ap as vi,aq as yi,ar as wi,as as xi,at as bi,au as ki,av as Si}from"./engine.worker-DJCYns2k.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function Dt(t,r,i,n){t.set_coast(r,i,JSON.stringify(n))}function $t(t,r,i,n){t.configure_coast(r,i,JSON.stringify(n))}function _i(t,r,i,n){t.cut_coast(r,i,JSON.stringify(n))}function Mi(t,r,i,n,a,o,l,u,s,e,c,f){return t.cut_field(r,i,n,a,o,l,u,s,e,c,JSON.stringify(f))}let Ye;const ct=new Map;let wt=Promise.resolve();const xt=new St;function Zr(t=!1){const r=Ye;Ye=void 0,xt.clear(),t||r?.pipeline?.free(),r?.runtime&&(wt=wt.then(async()=>{await Lr(r.runtime,"/terrain/stage",JSON.stringify({session:r.session,command:"cancel"})).catch(()=>{})}))}yn(()=>Zr(!0));async function Pi(t,r,i,n,a){r?.backend?.(i?"native":"cpu");const o=tr(t),l=r?.previews!==!1&&o.n<=1024,u=rt(t),s=Ir.erosion_at_resolution(t.seed,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix,o.n),e=s.parameters();s.free();const{parameters:c,surface:f}=u?hn(e,t):{parameters:e,surface:e.slice(24,32)};mn(c,f,t,u),gn(f,t,o.n),u&&ie(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural?.erosionTuning?.detail===void 0&&(c[16]=e[16]);const d=(S,U=!0)=>Number(ie(t,S,U)),y=Uint32Array.from([Number(u),d("regional"),d("regionalFinish"),d("amplitude"),d("ridged",!u),d("surface",!u||t.relief==="canyon"),d("normalize"),+(t.procedural?.regionalThermal!==!1),+(t.procedural?.regionalDiffusion!==!1),t.procedural?.reconstruction==="cubic"?1:t.procedural?.reconstruction==="bspline"?2:0,+(t.relief==="canyon")]);a?.(y[5]&&c[23]>0&&f[3]>0?f[1]:void 0,y[1]&&t.erosion>0?c[4]:void 0);const x=Wn([t.seed,t.width,o.n,c[2],i?.server??"wasm",!!n]);(o.n>1024||Ye?.root!==x)&&Zr();const b=_t(t),w=Xr(t),P=b.map(S=>w.get(S));let m=0;for(;Ye&&m<P.length&&Ye.keys[m]===P[m];)m++;const g=async S=>{try{return await Lr(i,"/terrain/stage",JSON.stringify({session:Ye.session,...S}))}catch(U){throw["coast","restore","preview"].includes(S.command)&&U instanceof Error&&U.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):U}},h=t.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([S,U])=>[S,Je(t.generalSeed,U)])):void 0,p={parameters:Array.from(c),surface:Array.from(f),flags:Array.from(y),stepSeeds:h??{}},N=async S=>{const U=await g(S),j=await U.json();if(h&&Object.values(h).some(Y=>Y!==t.seed)&&!j.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!Ye||m===0?(Zr(),i&&!ct.has(i.server)&&ct.set(i.server,Mt()),Ye={root:x,keys:[],runtime:i,...i?{session:ct.get(i.server)}:{}},await r?.before("grids",`Rust ${i?"natif":"WASM"} · régional ${c[2]}² · surface ${f[0]}² · source ${o.n}² à ${o.spacing.toFixed(2)} m`),i?(await wt,await N({command:"start",seed:t.seed,...p})):Ye.pipeline=new vn(t.seed,c,f,y),await r?.after("grids")):r?.cached?await r.cached("grids"):(await r?.before("grids"),await r?.after("grids"));const C=Ye;i||C.pipeline.set_step_seeds(JSON.stringify(h??{}));let E;for(let S=0;S<b.length;S++){const U=b[S],j=S<m;if(!j&&S===m&&S>0&&(i?await N({command:"restore",checkpoint:S-1,...p}):C.pipeline.restore(S-1,c,f,y),C.keys.length=S),j){(l||S===b.length-1)&&(E=i?new Float32Array(await(await g({command:"preview",checkpoint:S})).arrayBuffer()):C.pipeline.checkpoint_height(S)),r?.cached?await r.cached(U,l?E:void 0):(await r?.before(U),await r?.after(U,l?E:void 0));continue}await r?.before(U);const Y=U==="coastCut"&&gt(t,"coastCut");if(i){const I=await(await g({command:U==="coastCut"?"coast":"advance",stage:Bt.indexOf(U),checkpoint:S,mask:Y?t.coastMask:0,mode:t.islandMode??"island",coastProfile:Fr(t),preview:l||S===b.length-1})).arrayBuffer();I.byteLength&&(E=new Float32Array(I))}else{if(U==="initialize"&&n){const B=await n();C.pipeline.set_noise(B.coarse,B.fine)}U==="coastCut"?Y&&_i(C.pipeline,t.coastMask,t.islandMode??"island",Fr(t)):C.pipeline.advance(Bt.indexOf(U)),C.pipeline.checkpoint(S),(l||S===b.length-1)&&(E=C.pipeline.height())}C.keys[S]=P[S],await r?.after(U,l?E:void 0)}const F=`${x}|${w.get("phasor")}`,_=o.n<=1024?xt.get("phasor",F):void 0;return _?(r?.cached?await r.cached("phasor",l?_:void 0):(await r?.before("phasor"),await r?.after("phasor",_)),_):(await r?.before("phasor"),ie(t,"phasor",u)&&(E=vt(E,t)),o.n<=1024&&xt.put("phasor",F,E),await r?.after("phasor",l?E:void 0),E)}const zi=`
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
}`,jt=new WeakMap;function Ui(t,r,i){if(!i.iterations||!i.transport)return t;const n=t.slice(),a=Math.sqrt(n.length),o=r/a,l=new Float32Array(n.length),u=i.azimuth*Math.PI/180,s=Math.cos(u),e=Math.sin(u),c=s>=0?1:-1,f=e>=0?1:-1,d=Math.abs(s)/(Math.abs(s)+Math.abs(e)),y=1-d;for(let x=0;x<i.iterations;x++){l.fill(0);for(let b=1;b<a-1;b++)for(let w=1;w<a-1;w++){const P=b*a+w;if(n[P]<=.3)continue;const m=((n[P+1]-n[P-1])*s+(n[P+a]-n[P-a])*e)/(2*o),g=.75+.25*Math.sin((w*s+b*e)*o/64+n[P]*.03);l[P]=Math.min(Math.max(0,n[P]-.3),i.transport*Math.max(.1,Math.min(1,.55+2*m))*g)}for(let b=0;b<a;b++)for(let w=0;w<a;w++){const P=b*a+w,m=b*a+Math.max(0,Math.min(a-1,w-c)),g=Math.max(0,Math.min(a-1,b-f))*a+w;n[P]=n[P]-l[P]+(m!==P?l[m]*d:0)+(g!==P?l[g]*y:0)}}return n}async function Ci(t,r,i,n){if(!n.iterations||!n.transport)return r;const a=t.device,o=Math.sqrt(r.length);let l=jt.get(a);l||(l=(async()=>{const d=a.createShaderModule({code:zi}),x=(await d.getCompilationInfo()).messages.filter(g=>g.type==="error");if(x.length)throw new Error(x.map(g=>`${g.lineNum}: ${g.message}`).join(`
`));const b=a.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),w=a.createPipelineLayout({bindGroupLayouts:[b]}),[P,m]=await Promise.all(["entrain","deposit"].map(g=>a.createComputePipelineAsync({layout:w,compute:{module:d,entryPoint:g}})));return{layout:b,a:P,b:m}})(),jt.set(a,l));const{layout:u,a:s,b:e}=await l,c=[],f=(d,y)=>{const x=a.createBuffer({size:d,usage:y});return c.push(x),x};try{const d=f(r.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),y=f(r.byteLength,GPUBufferUsage.STORAGE),x=f(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),b=f(r.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);a.queue.writeBuffer(d,0,r);const w=new ArrayBuffer(48),P=new Float32Array(w);new Uint32Array(w)[0]=o;const m=n.azimuth*Math.PI/180;P[1]=i/o,P[2]=Math.cos(m),P[3]=Math.sin(m),P[4]=n.transport,a.queue.writeBuffer(x,0,w);const g=a.createBindGroup({layout:u,entries:[d,y,x].map((_,S)=>({binding:S,resource:{buffer:_}}))}),h=Math.ceil(r.length/256),p=Math.ceil(h/a.limits.maxComputeWorkgroupsPerDimension),N=Math.ceil(h/p),C=a.createCommandEncoder(),E=C.beginComputePass();E.setBindGroup(0,g);for(let _=0;_<n.iterations;_++)E.setPipeline(s),E.dispatchWorkgroups(N,p),E.setPipeline(e),E.dispatchWorkgroups(N,p);E.end(),C.copyBufferToBuffer(d,0,b,0,r.byteLength),a.queue.submit([C.finish()]),await b.mapAsync(GPUMapMode.READ);const F=new Float32Array(b.getMappedRange()).slice();return b.unmap(),F}finally{c.forEach(d=>d.destroy())}}var Ai=`// FP32 sampling of the retained Rust erosion field.\r
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
`,Pt=`// Shared FP32 simplex and FBM kernels.\r
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
`,Ei=`// Same noise octaves and physical wavelengths as erosion::mountain.\r
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
`,bn=`// Seeded finite volcanic geometry. Shared by generation and camera sampling.\r
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
`,Ri=`// The dedicated third simplex stream matches Rust's shore-noise fork.\r
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
`;let ut;const Ni=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function zt(){return ut??=(async()=>{const t=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!t)return;const{maxBufferSize:r,maxStorageBufferBindingSize:i}=t.limits,n=await t.requestDevice({requiredFeatures:t.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:r,maxStorageBufferBindingSize:i}}),a={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{a.lost=!0,ut=void 0}),a})().catch(()=>{}),ut}async function Bi(t,r){if(t==="wasm")return;const i=await zt();if(!i||i.lost)return;const n=r==="flat"?0:r==="valley"?2:r==="volcano"||r==="caldera"||r==="plateau"?3:1,a=`${t}:${n}`;let o=i.pipelines.get(a);return o||(o=(async()=>{const l=Ai.replace("// NOISE_KERNEL",Pt).replace("// VOLCANIC_KERNEL",bn).replace("// COAST_KERNEL",Ri),u=i.device.createShaderModule({code:l});return i.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),o.catch(()=>{}),i.pipelines.set(a,o)),{context:i,pipeline:o}}const Ti=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Wt(t,r,i){const n=t.device,a=tr(r).n,o=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),l=r.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=l.map(c=>{const f=`generation:${c}`;let d=t.pipelines.get(f);if(!d){const y=n.createShaderModule({code:Ei.replace("// NOISE_KERNEL",Pt)});d=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[o]}),compute:{module:y,entryPoint:c}}),t.pipelines.set(f,d)}return d}),s=Ir.generation_at_resolution(r.seed,r.width,r.relief,r.motifSize,a),e=[];try{const c=s.parameters();r.procedural?.regionalN&&(c[2]=r.procedural.regionalN,c[4]=r.width*1.44/c[2]),c[6]*=r.procedural?.noiseScale??1;const f=(m,g)=>{const h=n.createBuffer({size:m.byteLength,usage:g|GPUBufferUsage.COPY_DST});return e.push(h),n.queue.writeBuffer(h,0,m),h},d=[f(c,GPUBufferUsage.UNIFORM),f(s.permutations(),GPUBufferUsage.STORAGE),f(s.gradients(),GPUBufferUsage.STORAGE)];i?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const y=await Mr(Promise.all(u));i?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const b=l.map(m=>m==="coarse"?c[2]:c[1]).map((m,g)=>{const h=m*m*16,p=n.createBuffer({size:h,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),N=n.createBuffer({size:h,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});e.push(p,N);const C=n.createBindGroup({layout:y[g].getBindGroupLayout(0),entries:[...d,p].map((_,S)=>({binding:S,resource:{buffer:_}}))}),E=n.createCommandEncoder(),F=E.beginComputePass();return F.setPipeline(y[g]),F.setBindGroup(0,C),F.dispatchWorkgroups(Math.ceil(m/8),Math.ceil(m/8)),F.end(),E.copyBufferToBuffer(p,0,N,0,h),n.queue.submit([E.finish()]),N}),w=n.queue.onSubmittedWorkDone().then(()=>i?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),P=await Promise.all(b.map(async m=>{await m.mapAsync(GPUMapMode.READ);const g=new Float32Array(m.getMappedRange().slice(0));return m.unmap(),g}));return await w,{coarse:l.length===2?P[0]:new Float32Array,fine:P[P.length-1]}}finally{s.free(),e.forEach(c=>c.destroy())}}class Yt{constructor(r,i,n,a){this.state=r,this.pipeline=i,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=a.sampling_parameters(),this.sourceN=a.source_resolution();let o=0;for(let e=this.sourceN;e>=1;e=Math.floor(e/2))o+=e*e;const l=this.parameters[5]===3?2:1;if(o*l*4>r.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=a.sampling_field();this.hasField=u.length>0;const s=u.length?u:new Float32Array(1);if(s.byteLength>r.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(s),this.perm=this.upload(a.sampling_permutations()),this.gradients=this.upload(a.sampling_gradients()),this.branches=this.upload(a.sampling_branches()),this.coast=this.upload(a.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(r,i=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,r.byteLength),usage:i|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,r),n}prepareCoastField(r){return this.dispatchField({x:0,y:0,extent:r.width,resolution:this.sourceN},r),this.output}dispatchField(r,i){const{x:n,y:a,extent:o,resolution:l}=r;if(![n,a,o,l].every(Number.isFinite)||n<0||a<0||o<=0||n+o>i.width+1e-4||a+o>i.width+1e-4||!Number.isInteger(l)||l<16||l>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,s=o/l,e=Math.max(i.motifSize/65536,s*.5),c=this.parameters,f=Math.floor(Math.log2(this.sourceN)),d=Math.min(f,Math.log2(Math.max(1,s*(i.relief==="flat"&&c[5]!==4?2/i.motifSize:1/i.width)*this.sourceN))),y=new Float32Array([c[0],c[1],c[2],c[3],c[4],c[5],this.hasField?1:0,l,n,a,o,s,Math.floor(d),Math.min(f,Math.floor(d)+1),d-Math.floor(d),e,c[6],c[7],this.sourceN,f,...Array.from({length:16},(P,m)=>c[8+m]??0)]),x=l*l*16;x>this.capacity&&(this.output?.destroy(),this.capacity=x,this.output=u.createBuffer({size:x,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((P,m)=>({binding:m,resource:{buffer:P}}))})),u.queue.writeBuffer(this.uniform,0,y);const b=u.createCommandEncoder(),w=b.beginComputePass();w.setPipeline(this.pipeline),w.setBindGroup(0,this.group),w.dispatchWorkgroups(Math.ceil(l/8),Math.ceil(l/8)),w.end(),u.queue.submit([b.finish()])}async sample(r,i,n,a){const o=performance.now(),l=this.state.device,{x:u,y:s,extent:e,resolution:c}=r;this.dispatchField(r,i);const f=c*c*16,d=l.createCommandEncoder();(!this.readback||this.readback.size<f)&&(this.readback?.destroy(),this.readback=l.createBuffer({size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),d.copyBufferToBuffer(this.output,0,this.readback,0,f),l.queue.submit([d.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,f);const y=this.readback.getMappedRange(0,f).slice(0);this.readback.unmap();const x=new Float32Array(y),b=new Float32Array(c*c),w=new Float32Array(c*c),P=new Float32Array(c*c),m=new Float32Array(c*c);let g=1/0,h=-1/0;for(let p=0;p<c*c;p++){const N=p*4;b[p]=x[N],w[p]=x[N+1],P[p]=x[N+2],m[p]=x[N+3],g=Math.min(g,b[p]),h=Math.max(h,b[p])}if(!Number.isFinite(g)||!Number.isFinite(h))throw new Error("Sortie GPU non finie.");return{x:u,y:s,width:e,resolution:c,minHeight:g,maxHeight:h,globalMinHeight:n,globalMaxHeight:a,motifSize:i.motifSize,height:b,normalX:w,normalY:P,normalZ:m,caveMask:new Uint8Array,generationMs:performance.now()-o,backend:this.mode,samplingMs:performance.now()-o}}dispose(){this.buffers.forEach(r=>r.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}var Oi=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`,Gi=`// Inspector-only readout. It never modifies simulation heights or drainage.\r
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
`,Li=`// Full FP32 regional erosion. Dispatches are global synchronization boundaries.\r
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
`;const xr=new WeakMap,Yr=new WeakMap,Qr=new Set;function Or(t){t.nodes?.destroy(),t.fine?.destroy(),t.control.destroy()}function Fi(){for(const t of Qr)xr.get(t)?.forEach(Or),xr.delete(t),Yr.delete(t);Qr.clear()}const Vt=new WeakMap,ft=new WeakMap,Jt=new WeakMap,Kt=new WeakMap,kn=new WeakSet,Ii=512*1048576,Xt=1024,Hi=1088,dt=Hi+4096;function Sn(t,r){const i=(Jt.get(t.device)??Promise.resolve()).then(r);return Jt.set(t.device,i.then(()=>{},()=>{})),i}async function qi(t,r,i,n){let a=Vt.get(t);a||(a=(async()=>{const e=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(x=>({binding:x,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(x=>({binding:x,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),c=t.createShaderModule({code:Li.replace("// NOISE_KERNEL",Pt).replace("// VOLCANIC_KERNEL",bn)+Oi+Gi}),d=(await Mr(c.getCompilationInfo())).messages.filter(x=>x.type==="error");if(d.length)throw new Error(d.map(x=>`${x.lineNum}: ${x.message}`).join(`
`));const y=t.createPipelineLayout({bindGroupLayouts:[e]});return{layout:e,module:c,pipelineLayout:y,values:new Map,pending:new Map}})(),Vt.set(t,a)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const o=await Mr(a),l=[],u=[...r].reduce((e,c)=>e+(c==="solveTile"?i.size:1),0);let s=0;for(const e of r)for(const c of e==="solveTile"?i:[void 0]){const f=c===void 0?e:`solveTile:${c}`;let d=o.pending.get(f);d||(d=t.createComputePipelineAsync({layout:o.pipelineLayout,compute:{module:o.module,entryPoint:e,...c===void 0?{}:{constants:{SOLVE_MODE:c}}}}),d=d.then(y=>(o.values.set(f,y),y)),o.pending.set(f,d)),l.push(d.then(y=>(s++,n?.(`GPU · shaders d’érosion prêts ${s}/${u}`,{stage:"gpu-erosion-compile",completed:s,total:u}),y)))}return await Mr(Promise.all(l)),kn.add(t),o}class Gr extends Error{}class Di extends Error{}function _n(t,r,i,n,a){const o=Ir.erosion_at_resolution(t.seed,t.width,i,t.erosion,t.motifSize,t.mountainMix,r);try{const l=o.parameters(),u=n?hn(l,t,a):{parameters:l,surface:(a??l.slice(24,32)).slice()};return mn(u.parameters,u.surface,t,n,!!a),gn(u.surface,t,r),{noise:o,parameters:u.parameters,surface:u.surface,original:l}}catch(l){throw o.free(),l}}const $i=["hills","mountains","mixed","high-mountains","valley","canyon"];function ji(t,r){const i=tr(r).n,n=rt(r),a=$i.includes(r.relief)?r.relief:r.relief==="flat"?"hills":"mixed",{noise:o,parameters:l,surface:u}=_n(r,i,a,n);o.free();const s=l[2],e=u[0],c=u[3],f=Yn(t.device.limits,i,Math.max(s,r.erosion>0&&(!n||c>0)?e:0));return{sourceN:i,regionalN:s,regionalSteps:l[13],surfaceN:e,surfaceSteps:c,pipelinesReady:kn.has(t.device),error:f}}async function Wi(t,r,i,n,a){return Sn(t,()=>Yi(t,r,i,n,a))}async function Yi(t,r,i,n,a){const o=tr(r).n;for(const l of[1,2,4,8,16])try{return await Mn(t,r,o,l,void 0,{source:i,tuning:n},void 0,a)}catch(u){if(!(u instanceof Gr)||l===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function Zt(t,r,i,n){return i?.control?.backend?.("gpu"),Sn(t,()=>Vi(t,r,i,n))}async function Vi(t,r,i,n){const a=tr(r).n;if(r.relief==="volcano"||r.relief==="caldera"||r.relief==="plateau"){const o=Ir.finite_shape(r.seed,r.motifSize,r.relief,r.erosion),l=o.parameters();o.free();const u=r.environment??"mixed",s=r.motifSize*l[15];let e;if(u==="flat"){const d=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),e=xe.prepare_environment_at_resolution(r.seed,r.width,u,r.erosion,s,a),i&&(i.nativeEnvironmentMs=performance.now()-d)}else e=await pt(t,{...r,motifSize:s,relief:u,mountainMix:.5},a,void 0,i,n);const c=await pt(t,{...r,width:r.motifSize},a,l,i,n),f=new Float32Array(c.length+e.length);return f.set(c),f.set(e,c.length),f}return pt(t,r,a,void 0,i,n)}async function pt(t,r,i,n,a,o){for(const l of[1,2,4,8,16])try{return await Mn(t,r,i,l,n,void 0,a,o)}catch(u){if(!(u instanceof Gr)||l===16)throw u}throw new Error("Érosion GPU non convergée.")}async function Mn(t,r,i,n,a,o,l,u){const s=t.device,e=o?void 0:l?.control,c=rt(r),f=!!r.generalSeed&&yt(r.generalSeed,h=>h.startsWith("relief-"))!==wn(r.generalSeed),{noise:d,parameters:y,surface:x,original:b}=_n(r,i,o||c&&r.relief==="flat"?"hills":a?"mixed":r.relief,c,o?.tuning);let w=ft.get(s);if(!w){w=[],ft.set(s,w);const h=w;s.lost.then(()=>h.forEach(p=>p.destroy()))}const P=!!e&&e.previews!==!1&&i<=Xt;let m=!!e&&e.previews!==!1,g=0;try{c&&r.procedural&&ie(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural.erosionTuning?.detail===void 0&&(y[16]=b[16]);const h=y.slice(0,24),p=h[2],N=h[13],C=h[18],E=o?[1,0,0,.2,1,1,0,0]:Array.from(y.slice(33,41)),F=E.slice();F[4]=1;const _=!o&&E[6]>.5,S=Math.min(n,4),U=h.slice();U[2]=x[0],U[4]=x[1],U[5]=x[2],U[15]=a&&!o?a[13]:x[4],U[18]=x[5],U[22]=x[6];const j=Math.max(1,U[2]/1048),Y=Math.ceil(Math.min((a||o||r.relief==="mixed"?64:32)*n,512)*j),B=!o&&ie(r,"phasor",c)?"generationPhasorPack":"packHeight",I=c?"compactInitialize":"initialize",Z=!!o||ie(r,"surface",!c||r.relief==="canyon")&&(!c||r.relief==="canyon"||x[3]>0),pe=()=>{o||l?.onPhysicalPlan?.(r.erosion>0&&Z&&x[3]>0?x[1]:void 0,!a&&r.erosion>0&&(ie(r,"regional")||ie(r,"regionalFinish"))?h[4]:void 0)},K=r.procedural?.reconstruction&&r.procedural.reconstruction!=="default"?"generationReconstruct":c?"compactReconstruct":"reconstruct",he=new Set([B,...ie(r,"amplitude")?[]:["generationUnitScale"],...ie(r,"normalize")?[]:["generationKeepDatum"],...e?["generationPreview"]:[],...!o&&!a&&r.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),X=new Set,oe=(...v)=>v.forEach(z=>he.add(z));f&&!o&&!a&&oe("generationCut","generationRegionalRead","generationPreview"),(o||!a&&(f||r.procedural))&&oe("seaLandMark","seaMaskGrow");const Ue=()=>oe("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");o?oe("coastLoad","coastResult"):oe("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!o&&!a?(oe(I,"uplift","bounds",K,"detail"),C>0&&(Ue(),oe("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(v=>X.add(v)))):a&&!o&&oe("volcanicInitial"),r.erosion>0&&Z&&(Ue(),oe("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),X.add(1),X.add(3),r.relief==="canyon"&&!o&&(oe("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),X.add(0)),_&&(oe("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),X.add(0))),e&&await e.before("grids",`Budget ×${n} · régional ${p}² · surface ${U[2]}² · sortie ${i}²`);const me=performance.now(),ge=await qi(s,he,X,u),Ge=performance.now()-me,Ce=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let Pe=!1;const se=(v,z)=>{const T=g++;let O=w[T];return(!O||O.size<v||O.usage!==z)&&(O?.destroy(),O=s.createBuffer({size:v,usage:z}),w[T]=O,Pe=!0),O},be=v=>{const z=se(v.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return s.queue.writeBuffer(z,0,v),z},Re=r.erosion>0&&Z?Math.max(p,U[2]):p,ve=i**2,te=ve*4,Ae=ve*16,ke=Math.max(ve,p*p)*4;s.pushErrorScope("out-of-memory");const Se=se(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),We=se(Re**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ne=se(Ae,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),He=se(dt,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Le=se(ke,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),fe=se(ke+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),qe=se(Math.ceil(Re/16)**2*8,GPUBufferUsage.STORAGE),or=s.popErrorScope();if(Pe&&await or)throw m=!0,new Di(`WebGPU : mémoire insuffisante pour la source ${i}² et la grille d’érosion ${Re}².`);m||=w.reduce((v,z)=>v+z.size,0)>Ii;const Ke=v=>fe.mapAsync(GPUMapMode.READ,0,v),dr=v=>fe.getMappedRange(0,v),ye=!o&&!a&&!!(r.procedural||f),M=ye&&i<=Xt,k=P||ye;let R=k?void 0:Kt.get(s);if(!k&&!R&&s.features.has("timestamp-query")){R=s.createQuerySet({type:"timestamp",count:6}),Kt.set(s,R);const v=R;s.lost.then(()=>v.destroy())}const ee=R?se(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,J=R?se(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,de=(v,z)=>s.createBindGroup({layout:ge.layout,entries:[{binding:0,resource:{buffer:Se,size:224}},...[be(v),be(z),We,Ne,He,Le,qe].map((T,O)=>({binding:O+1,resource:{buffer:T}}))]});let A=de(d.permutations(),d.gradients());const G=new Map([[r.seed,A]]),ce=v=>{const z={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[v];if(!z||!r.generalSeed)return;const T=Je(r.generalSeed,z);let O=G.get(T);if(!O){const ue=Ir.erosion(T,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix);try{O=de(ue.permutations(),ue.gradients())}finally{ue.free()}G.set(T,O)}A=O},H=new Map;let ne=E;const re=(v,z)=>{const T=[...z,...v,...ne].join(",");let O=H.get(T);if(O===void 0){if(O=H.size*256,O+224>65536)throw new Error("Too many GPU variants.");H.set(T,O),s.queue.writeBuffer(Se,O,new Float32Array([...z,...v,...c?Tt(r,!!o):!a&&!o&&ie(r,"phasor",!1)?Tt(r):a??new Float32Array(16),...ne]))}return O};let D=s.createCommandEncoder();D.clearBuffer(He),o&&D.copyBufferToBuffer(o.source,0,Ne,0,Ae);const _e=v=>D.beginComputePass(R?{timestampWrites:{querySet:R,beginningOfPassWriteIndex:v,endOfPassWriteIndex:v+1}}:void 0);let W=_e(0);const V=[0,0,1,0,0,0,.6,0];V[4]=y[32];const Be=[0,0,.95,C*.5,0,0,.5,0];let ae=h;const q=(v,z=V,T=Math.ceil(ae[2]**2/256),O=1)=>{W.setPipeline(ge.values.get(v==="solveTile"?`solveTile:${z[1]}`:v)),W.setBindGroup(0,A,[re(z,ae)]),W.dispatchWorkgroups(T,O)},pr=Math.ceil(ve/256),Hr=Math.ceil(pr/s.limits.maxComputeWorkgroupsPerDimension),ze=(v,z=V)=>q(v,z,Math.ceil(pr/Hr),Hr),Xe=(v,z,T=!1)=>{const O=V.slice();O[1]=v,O[7]=T?1:0,q(v===0?"floodInit":"graphInit",O),q("start",O,1);const ue=[0,1].map(we=>(O[0]=we,re(O,ae)));for(let we=0;we<z;we++){const sr=[ue[we&1]];W.setPipeline(ge.values.get("clearNext")),W.setBindGroup(0,A,sr),W.dispatchWorkgroups(1),W.setPipeline(ge.values.get(`solveTile:${v}`)),W.dispatchWorkgroups(Math.ceil(ae[2]/16),Math.ceil(ae[2]/16))}O[0]=0,q("solveStats",O,1),v===0?(q("floodCheck",O,1),q("receivers")):q("graphFinish",O)},tt=(v=V,z=!0)=>{q("pitInit");for(let T=0;T<8*S+Math.ceil(Math.log2(Math.max(1,ae[2]/1048)));T++)q("pitUnion"),q("pitCompress");for(const T of z?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])q(T,v)},nt=v=>{if(v<=0)return;const z=V.slice();z[6]=v,q("breachInit"),q("breach",z),q("breachFinish")},it=(v,z=V)=>{if(!(ae===h&&r.procedural?.regionalThermal===!1))for(let T=0;T<v;T++)for(const O of["thermalFlux","thermalApply","copyHeight"])q(O,z)},qr=(v,z=V)=>{if(ae===h&&r.procedural?.regionalDiffusion===!1)return;const T=z.slice();T[3]=v,q("diffuse",T),q("copyHeight",T)},At=v=>{const z=Vn(Jn({surfaceSteps:x[3],surfaceCell:x[1],regionalCell:h[4],sourceCell:h[11],warp:E[5]*Math.min(16*h[3],h[4]*.9)}),r.width);if(z===void 0)return;const T=V.slice();T[7]=v,v===0?q("seaLandMark",T):ze("seaLandMark",T),T[5]=z,q("seaMaskGrow",T,2)},Et=v=>{const z=V.slice();z[4]=v,q("percentileInit",z,1);for(const T of[24,16,8,0])z[5]=T,q("histogramClear",z,1),ze("histogram",z),q("percentileSelect",z,1)},Rt=async(v,z,T)=>{if(!e)return;if(!P){await e.after(v,void 0,T);return}if(z!==3){const sr=V.slice();sr[7]=z,ze("generationPreview",sr)}W.end(),D.copyBufferToBuffer(Le,0,fe,0,te),D.copyBufferToBuffer(He,0,fe,te,1088),s.queue.submit([D.finish()]),await Ke(te+1088);const O=dr(te+1088),ue=new Uint32Array(O,te,272)[2],we=new Float32Array(O,0,ve).slice();if(fe.unmap(),ue)throw new Gr("Érosion GPU non convergée pendant une étape.");if(!we.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await e.after(v,we,T),D=s.createCommandEncoder(),W=_e(0)},hr=_t(r),Nn=Xr(r);let Te=M?xr.get(s):void 0;if(M&&!Te){Te=new Map,xr.set(s,Te),Qr.add(s);const v=Te;s.lost.then(()=>{v.forEach(Or),v.clear(),Qr.delete(s)})}const Pr=v=>`${n}|${Nn.get(v)}`;let nr=0;for(;Te&&nr<hr.length&&Te.get(hr[nr])?.key===Pr(hr[nr]);)nr++;if(Te)for(const v of[...hr.slice(nr),"phasor"]){const z=Te.get(v);z&&(v!=="phasor"||z.key!==Pr(v)||nr<hr.length)&&(Or(z),Te.delete(v))}const Bn=v=>{W.end(),v.nodes&&D.copyBufferToBuffer(v.nodes,0,We,0,v.nodes.size),v.fine&&D.copyBufferToBuffer(v.fine,0,Ne,0,v.fine.size),D.copyBufferToBuffer(v.control,0,He,0,dt),W=_e(0)},Tn=(v,z)=>{if(!Te)return;W.end();const T=(ue,we=ue.size)=>{const sr=s.createBuffer({size:we,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return D.copyBufferToBuffer(ue,0,sr,0,we),sr},O=Te.get(v);O&&Or(O),Te.set(v,{key:Pr(v),kind:z,...z===0?{nodes:T(We,p*p*112)}:{fine:T(Ne,Ae)},control:T(He,dt)}),s.queue.submit([D.finish()]),D=s.createCommandEncoder(),W=_e(0)},On=async(v,z)=>{if(!e)return;if(!P){e.cached?await e.cached(v):(await e.before(v),await e.after(v));return}const T=V.slice();T[7]=z.kind,ze("generationPreview",T),W.end(),D.copyBufferToBuffer(Le,0,fe,0,te),s.queue.submit([D.finish()]),await Ke(te);const O=new Float32Array(dr(te),0,ve).slice();fe.unmap(),e.cached?await e.cached(v,O):(await e.before(v),await e.after(v,O)),D=s.createCommandEncoder(),W=_e(0)},Ze=async(v,z,T)=>{const O=hr.indexOf(v),ue=Te?.get(v);if(ue&&O>=0&&O<nr){(P||O===nr-1)&&Bn(ue),await On(v,ue);return}await e?.before(v),ce(v),await T(),Tn(v,z),await Rt(v,z)},Gn=r.procedural?.coastAfter??"initialize",mr=async(v,z)=>{!ye||v!==Gn||await Ze("coastCut",z===4?5:z,async()=>{if(!gt(r,"coastCut"))return;const T=V.slice();T[7]=z,z===0?q("generationRegionalRead",T,Math.ceil(p*p/256)):ze("generationPreview",T),W.end();const O=z===0?p*p:ve;D.copyBufferToBuffer(Le,0,fe,0,O*4),s.queue.submit([D.finish()]),await Ke(O*4);const ue=new Float32Array(dr(O*4),0,O).slice();fe.unmap();const we=Mi(vn,Je(r.generalSeed??r.seed,"relief-coast-cut"),r.width,y[3]*2400,y[12],r.coastMask,r.islandMode??"island",z===0?p:i,z===0?h[5]:0,z===0?h[4]:h[11],ue,Fr(r));s.queue.writeBuffer(Le,0,we),D=s.createCommandEncoder(),W=_e(0),z===0?q("generationCut",T,Math.ceil(p*p/256)):ze("generationCut",T),At(z)})};e&&await e.after("grids",void 0,`Budget ×${n} · régional ${p}² · surface ${U[2]}² · ${(w.reduce((v,z)=>v+z.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${N} cycles de relief et ${x[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),o?(ae=U,ze("coastLoad"),At(2)):a?(e&&await e.before("initialize"),ae=U,ze("volcanicInitial"),e&&await Rt("initialize",2)):(await Ze("initialize",0,()=>{q(I)}),await mr("initialize",0),await Ze("regional",0,()=>{for(let v=0;v<(ie(r,"regional")?N:0);v++){if(q("uplift"),C>0){Xe(0,64*S),tt(),q("flow"),nt(E[1]),Xe(1,128*S),Xe(2,128*S),it(3);const z=h[17]*3*C;for(let T=0;T<Math.floor(z);T++)qr(.5);z%1>0&&qr(.5*(z%1))}q("bounds")}}),await Ze("regionalFinish",0,()=>{const v=V.slice();if(v[7]=1,q("bounds",v),C>0&&ie(r,"regionalFinish")){it(4,Be);for(let z=0;z<6;z++)Xe(0,64*S),tt(Be),q("flow"),nt(E[2]);qr(C*.5,Be)}}),await mr("regionalFinish",0),await Ze("reconstruct",1,()=>{const v=V.slice();v[7]=r.procedural?.reconstruction==="bspline"?1:0,ze(K,v)}),await Ze("amplitude",4,()=>{ie(r,"amplitude")?Et(0):q("generationUnitScale",V,1)}),await mr("amplitude",4),await Ze("ridged",2,()=>{ze("detail")}),await mr("ridged",2)),W.end(),W=_e(2),await Ze("surface",2,()=>{if(r.erosion>0&&Z){if(ae=U,ne=F,q("surfaceLoad"),r.relief==="canyon"&&!o){const v=Math.ceil(128*S*j);Xe(0,v),q("flow"),Xe(1,v),q("canyonSeed");let z=0;const T=[];for(let ue=2**(Math.ceil(Math.log2(U[2]))-1);ue>=1;ue/=2)T.push(ue);T.push(1,1);for(const ue of T){const we=V.slice();we[0]=z,we[1]=ue,q("canyonSpread",we),z=1-z}const O=V.slice();O[0]=z,q("canyonApply",O)}for(let v=0;v<x[3];v++)_?(Xe(0,Y),tt(V,!1),q("flow"),nt(E[7])):(q("surfaceFlowInit"),q("receivers"),q("flow")),Xe(1,Y,!0),Xe(3,Y,!0),it(1),qr(x[7]);q("surfaceDelta"),ze("surfaceReconstruct")}}),await mr("surface",2),W.end(),W=_e(4),await Ze("normalize",1,()=>{o?ze("coastResult"):ie(r,"normalize")?(Et(1),ze("normalize")):ze("generationKeepDatum")}),await mr("normalize",1);let zr=Yr.get(s);zr||(zr=new St,Yr.set(s,zr));const Ur=M?zr.get("phasor",Pr("phasor")):void 0;if(Ur)return W.end(),s.queue.submit([D.finish()]),e?.cached?await e.cached("phasor",P?Ur:void 0):(await e?.before("phasor"),await e?.after("phasor",Ur)),pe(),Ur;Ur||await e?.before("phasor"),ze(B),W.end();const Cr=te;D.copyBufferToBuffer(Le,0,fe,0,Cr),D.copyBufferToBuffer(He,0,fe,Cr,1088),R&&ee&&J&&(D.resolveQuerySet(R,0,6,ee,0),D.copyBufferToBuffer(ee,0,J,0,48));const Ln=D.finish(),Fn=performance.now()-Ce;u?.(o?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const In=performance.now();s.queue.submit([Ln]);const Hn=s.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([Ke(Cr+1088),J?.mapAsync(GPUMapMode.READ),Hn]);const qn=performance.now()-In,Dn=performance.now(),Nt=dr(Cr+1088),at=new Uint32Array(Nt,Cr,272),$n=Array.from(at.slice(267,271)),ot={factor:n,sourceSize:i,coarseSize:p,surfaceSize:U[2],pipelineMs:Ge,encodeMs:Fn,submitReadbackMs:qn,unpackMs:0,maxSolveSteps:$n,allocatedBytes:w.reduce((v,z)=>v+z.size,0)};if(J){const v=new BigUint64Array(J.getMappedRange());ot.gpuStagesMs={coarse:Number(v[1]-v[0])/1e6,surface:Number(v[3]-v[2])/1e6,normalization:Number(v[5]-v[4])/1e6},J.unmap()}if(l&&(l.profiles??=[]).push(ot),at[2]!==0)throw fe.unmap(),new Gr(`Érosion GPU non convergée (${at[2]} cellules/étapes, budget ×${n}).`);const Ar=new Float32Array(Nt,0,ve).slice();fe.unmap(),ot.unpackMs=performance.now()-Dn;const jn=o||ye&&gt(r,"coastCut")?-1/0:.3-1e-7;for(let v=0;v<ve;v++)if(!Number.isFinite(Ar[v])||Ar[v]<jn)throw new Error("Champ GPU invalide.");return pe(),M&&zr.put("phasor",Pr("phasor"),Ar),e&&await e.after("phasor",P?Ar:void 0,"Sortie GPU lue et validée"),Ar}catch(h){throw h instanceof Gr&&(xr.get(s)?.forEach(Or),xr.get(s)?.clear(),Yr.delete(s)),h}finally{d.free(),w.forEach(h=>{h.mapState!=="unmapped"&&h.unmap(),m&&h.destroy()}),m&&ft.delete(s)}}var Ji=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`;const Ki=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],Qt=new WeakMap,en=new WeakMap;function Xi(t){let r=Qt.get(t);return r||(r=(async()=>{const i=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=t.createShaderModule({code:Ji}),o=(await n.getCompilationInfo()).messages.filter(s=>s.type==="error");if(o.length)throw new Error(`Hydrologie WGSL : ${o.map(s=>`${s.lineNum}: ${s.message}`).join(`
`)}`);const l=t.createPipelineLayout({bindGroupLayouts:[i]}),u=await Promise.all(Ki.map(async s=>[s,await t.createComputePipelineAsync({layout:l,compute:{module:n,entryPoint:s}})]));return{layout:i,values:new Map(u)}})(),Qt.set(t,r)),r}function Zi(t){let r=2166136261;for(let i=0;i<t.length;i++)r=Math.imul(r^t.charCodeAt(i),16777619);return r>>>0}function Qi(t,r,i){const n=new Uint32Array(t.length);if(!i)return{mask:n,count:0};const a=new Uint8Array(t.length),o=new Uint32Array(t.length);let l=0,u=0,s=0;const e=f=>{a[f]===0&&t[f]<=0&&(a[f]=1,o[u++]=f)},c=f=>{if(a[f]!==0||t[f]>0)return;l=0,u=0,e(f);let d=!1;for(;l<u;){const y=o[l++],x=y%r,b=Math.floor(y/r);d||=x+1<r&&b+1<r&&t[y+1]<=0&&t[y+r]<=0&&t[y+r+1]<=0;for(let w=-1;w<=1;w++){const P=b+w;if(!(P<0||P>=r))for(let m=-1;m<=1;m++){const g=x+m;g>=0&&g<r&&e(P*r+g)}}}if(d){for(let y=0;y<u;y++)n[o[y]]=1;s+=u}};for(let f=0;f<r;f++)c(f),c((r-1)*r+f);for(let f=1;f+1<r;f++)c(f*r),c(f*r+r-1);return{mask:n,count:s}}class ea{constructor(r,i,n){this.device=r,this.n=i,this.program=n,this.buffers=[],this.pending=Promise.resolve();const a=i*i,o=(u,s)=>{const e=r.createBuffer({size:u,usage:s});return this.buffers.push(e),e};this.uniform=o(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=o(a*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=o(a*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const l=o(a*48,GPUBufferUsage.STORAGE);this.control=o(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=o(a*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=o(a*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=o(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=r.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,l,this.control,this.output].map((u,s)=>({binding:s+1,resource:{buffer:u}}))]}),r.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(r,i,n,a){const o=this.pending.then(()=>this.execute(r,i,n,a));return this.pending=o.then(()=>{},()=>{}),o}async execute(r,i,n,a){const o=performance.now(),l=this.n,u=l*l,s=i/l,e=Qi(r,l,a),c=performance.now()-o,f=this.device;f.queue.writeBuffer(this.source,0,r),f.queue.writeBuffer(this.sea,0,e.mask);for(let B=0;B<2;B++){const I=new ArrayBuffer(32);new Uint32Array(I,0,4).set([l,Zi(n),B,a?1:0]),new Float32Array(I,16,4).set([s,s*s,Math.max(.1,s*.1),0]),f.queue.writeBuffer(this.uniform,B*256,I)}const d=(B,I,Z=0)=>{B.setPipeline(this.program.values.get(I)),B.setBindGroup(0,this.group,[Z*256]),I==="solveTile"?B.dispatchWorkgroups(Math.ceil(l/16),Math.ceil(l/16)):B.dispatchWorkgroups(I==="reset"||I==="clearNext"?1:Math.ceil(u/256))},y=performance.now(),x=f.createCommandEncoder(),b=x.beginComputePass();d(b,"reset"),d(b,"initialize"),b.end(),f.queue.submit([x.finish()]);let w=0,P=!1,m=32;const g=Math.max(256,l);for(;w<g;){const B=f.createCommandEncoder(),I=B.beginComputePass();for(let pe=0;pe<m;pe++){const K=w+pe&1;d(I,"clearNext",K),d(I,"solveTile",K)}I.end(),B.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),f.queue.submit([B.finish()]),w+=m,m=Math.min(m*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const Z=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),Z===0){P=!0;break}}if(!P)throw new Error(`Drainage hydrique GPU non convergé après ${w} passes (${l}²) ; repli CPU requis.`);const h=f.createCommandEncoder(),p=h.beginComputePass();d(p,"receivers");const N=Math.ceil(Math.log2(u));for(let B=0;B<N;B++){const I=B&1;d(p,"accumulateCopy",I),d(p,"accumulateScatter",I)}d(p,"finish",N&1),p.end();const C=u*16;h.copyBufferToBuffer(this.output,0,this.readback,0,C),h.copyBufferToBuffer(this.control,0,this.readback,C,16),f.queue.submit([h.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const E=performance.now()-y,F=performance.now();let _,S,U,j;try{const B=this.readback.getMappedRange(),I=new Uint32Array(B,C,4);if(I[2]!==0||I[3]!==u-e.count)throw new Error(`Drainage hydrique GPU invalide (${I[2]} erreurs, ${I[3]}/${u-e.count} cellules drainées) ; repli CPU requis.`);const Z=new Float32Array(B,0,u*4),pe=new Uint32Array(B,0,u*4);_=new Float32Array(u),S=new Uint32Array(u),U=new Float32Array(u),j=new Float32Array(u);for(let K=0;K<u;K++)_[K]=Z[K*4],S[K]=pe[K*4+1],U[K]=Z[K*4+2],j[K]=Z[K*4+3]}finally{this.readback.unmap()}const Y=new Uint8Array(e.mask);return{filled:_,receivers:S,accumulation:U,potential:j,seaMask:Y,preprocessingMs:c,computeMs:E,readbackMs:performance.now()-F,floodPasses:w}}}async function ra(t,r,i,n,a=!1){if(![256,512,1024].includes(i)||t.length!==i*i||!Number.isFinite(r)||r<=0||!t.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const o=await zt();if(!o||o.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const l=await Xi(o.device);if(o.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=en.get(o.device);u||(u=new Map,en.set(o.device,u));let s=u.get(i);return s||(s=new ea(o.device,i,l),u.set(i,s)),s.run(t,r,n,a)}const rn=new WeakMap;function ta(t){const r=rn.get(t);if(r)return r;const i=new Float32Array(t.baseHeight.length),n=[],a=m=>t.drainageHeight[m]<t.rawDrainageHeight[m]&&t.surfaceHeight[m]<t.baseHeight[m];let o=!1;for(let m=0;m<i.length;m++){const g=a(m);g&&n.push(m),i[m]=g?0:t.surfaceHeight[m]-t.baseHeight[m],o||=i[m]!==0}const l=256,u=t.width/l,s=new Map,e=[],c=t.riverPoints,f=new Map,d=[],y=t.resolution,x=t.width/y,b=m=>Math.min(x*2,Math.max(x*.5,(t.baseHeight[m]-t.surfaceHeight[m])*1.4)),w=m=>((Math.imul(m^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const m of n){const g=m%y,h=Math.floor(m/y),p=(g+.5)*x,N=(h+.5)*x,C=[];for(let E=-1;E<=1;E++)for(let F=-1;F<=1;F++){const _=g+F,S=h+E,U=S*y+_;if(!F&&!E||_<0||S<0||_>=y||S>=y)continue;const j=a(U);(j&&U>m||!j&&t.basins[U]&&t.surfaceHeight[U]<=t.surfaceHeight[m])&&C.push(U)}C.length||C.push(m);for(const E of C){const F=(E%y+.5)*x,_=(Math.floor(E/y)+.5)*x,S=d.length,U=b(m),j=b(E),Y=w(m),B=Math.max(U,j)*(1+Math.abs(Y));d.push({a:m,b:E,ra:U,rb:j,skew:Y});const I=Me(Math.min(p,F)-B,u,l),Z=Me(Math.max(p,F)+B,u,l),pe=Me(Math.min(N,_)-B,u,l),K=Me(Math.max(N,_)+B,u,l);for(let he=pe;he<=K;he++)for(let X=I;X<=Z;X++){const oe=he*l+X,Ue=f.get(oe);Ue?Ue.push(S):f.set(oe,[S])}}}if(t.incision>0)for(let m=0;m<t.riverCount;m++)for(let g=t.riverOffsets[m];g+1<t.riverOffsets[m+1];g++){const h=g+1,p=Math.max(c[g*4+2],c[h*4+2])*.65+.5,N=e.length;e.push({a:g,b:h,estuary:t.riverMeta[m*6+5]});const C=Me(Math.min(c[g*4],c[h*4])-p,u,l),E=Me(Math.max(c[g*4],c[h*4])+p,u,l),F=Me(Math.min(c[g*4+1],c[h*4+1])-p,u,l),_=Me(Math.max(c[g*4+1],c[h*4+1])+p,u,l);for(let S=F;S<=_;S++)for(let U=C;U<=E;U++){const j=S*l+U,Y=s.get(j);Y?Y.push(N):s.set(j,[N])}}const P={delta:i,hasDelta:o,hasSea:t.basins.includes(0),buckets:s,segments:e,bucketSize:u,side:l,notchBuckets:f,notches:d};return rn.set(t,P),P}const Me=(t,r,i)=>Math.max(0,Math.min(i-1,Math.floor(t/r)));function tn(t,r,i,n,a){const o=new Int32Array(i*4),l=new Float64Array(i*4);for(let u=0;u<i;u++){const s=Math.max(0,Math.min(a-1,(t+(u+.5)*r)/n-.5)),e=Math.floor(s),c=s-e,f=1-c;for(let d=0;d<4;d++)o[u*4+d]=Math.max(0,Math.min(a-1,e+d-1));l.set([f**3/6,(3*c**3-6*c*c+4)/6,(-3*c**3+3*c*c+3*c+1)/6,c**3/6],u*4)}return{indices:o,weights:l}}function Pn(t,r,i=!0){const n=t.resolution,a=t.width/n,o=ta(r);if(!o.hasDelta&&!o.segments.length&&!o.notches.length)return;const l=i?new Float32Array(n*n):void 0;if(o.hasDelta){const g=r.resolution,h=r.width/g,p=tn(t.x,a,n,h,g),N=tn(t.y,a,n,h,g),C=N.indices[0],E=N.indices[N.indices.length-1],F=new Float64Array((E-C+1)*n);for(let _=C;_<=E;_++){const S=_*g,U=(_-C)*n;for(let j=0;j<n;j++){const Y=j*4;F[U+j]=o.delta[S+p.indices[Y]]*p.weights[Y]+o.delta[S+p.indices[Y+1]]*p.weights[Y+1]+o.delta[S+p.indices[Y+2]]*p.weights[Y+2]+o.delta[S+p.indices[Y+3]]*p.weights[Y+3]}}for(let _=0;_<n;_++)for(let S=0;S<n;S++){const U=_*4;let j=F[(N.indices[U]-C)*n+S]*N.weights[U]+F[(N.indices[U+1]-C)*n+S]*N.weights[U+1]+F[(N.indices[U+2]-C)*n+S]*N.weights[U+2]+F[(N.indices[U+3]-C)*n+S]*N.weights[U+3];if(j>0&&o.hasSea&&t.height[_*n+S]<=0){const Y=Math.max(0,Math.min(g-1,Math.floor((t.x+(S+.5)*a)/h))),B=Math.max(0,Math.min(g-1,Math.floor((t.y+(_+.5)*a)/h))),I=B*g+Y;(!r.basins[I]||r.baseHeight[I]>=0)&&(j=0)}l&&(l[_*n+S]=j),t.height[_*n+S]+=j}}const u=new Set,{bucketSize:s,side:e}=o;for(let g=Me(t.y,s,e);g<=Me(t.y+t.width,s,e);g++)for(let h=Me(t.x,s,e);h<=Me(t.x+t.width,s,e);h++)for(const p of o.buckets.get(g*e+h)??[])u.add(p);const c=new Float32Array(n*n),f=r.riverPoints,d=(g,h)=>Math.max(0,Math.min(n-1,Math.floor((g-h)/a))),y=new Set;for(let g=Me(t.y,s,e);g<=Me(t.y+t.width,s,e);g++)for(let h=Me(t.x,s,e);h<=Me(t.x+t.width,s,e);h++)for(const p of o.notchBuckets.get(g*e+h)??[])y.add(p);const x=r.resolution,b=r.width/x,w=b*.25;for(const g of y){const{a:h,b:p,ra:N,rb:C,skew:E}=o.notches[g],F=Math.max(N,C)*(1+Math.abs(E)),_=(h%x+.5)*b,S=(Math.floor(h/x)+.5)*b,U=(p%x+.5)*b,j=(Math.floor(p/x)+.5)*b,Y=U-_,B=j-S,I=Y*Y+B*B,Z=Math.min(_,U)-F,pe=Math.max(_,U)+F,K=Math.min(S,j)-F,he=Math.max(S,j)+F;if(pe<t.x||Z>t.x+t.width||he<t.y||K>t.y+t.width)continue;const X=Math.abs(B)>1e-12,oe=X?F*Math.sqrt(I)/Math.abs(B):0;for(let Ue=d(K,t.y);Ue<=d(he,t.y);Ue++){const me=t.y+(Ue+.5)*a,ge=X?_+Y*(me-S)/B:0,Ge=X?Math.max(Z,ge-oe):Z,Ce=X?Math.min(pe,ge+oe):pe;if(!(Ge>Ce||Ce<t.x||Ge>t.x+t.width))for(let Pe=d(Ge,t.x);Pe<=d(Ce,t.x);Pe++){const se=t.x+(Pe+.5)*a,be=I?Math.max(0,Math.min(1,((se-_)*Y+(me-S)*B)/I)):0,Re=Math.hypot(se-_-Y*be,me-S-B*be),ve=w+(N+(C-N)*be-w)*(1+E*Math.sign((se-_)*B-(me-S)*Y));if(Re>=ve)continue;const te=Math.max(0,(Re-w)/(ve-w)),Ae=1-te*te*(3-2*te),ke=r.surfaceHeight[h]+(r.surfaceHeight[p]-r.surfaceHeight[h])*be,Se=Ue*n+Pe;c[Se]=Math.max(c[Se],Math.max(0,t.height[Se]-ke)*Ae)}}}for(const g of u){const{a:h,b:p,estuary:N}=o.segments[g],C=f[h*4],E=f[h*4+1],F=f[p*4],_=f[p*4+1],S=f[h*4+2],U=f[p*4+2],j=f[h*4+3],Y=f[p*4+3],B=Math.max(Math.max(S,U)*.65,.5),I=F-C,Z=_-E,pe=I*I+Z*Z,K=Math.min(C,F)-B,he=Math.max(C,F)+B,X=Math.min(E,_)-B,oe=Math.max(E,_)+B;if(he<t.x||K>t.x+t.width||oe<t.y||X>t.y+t.width)continue;const Ue=d(X,t.y),me=d(oe,t.y),ge=Math.abs(Z)>1e-12,Ge=ge?B*Math.hypot(I,Z)/Math.abs(Z):0;for(let Ce=Ue;Ce<=me;Ce++){const Pe=t.y+(Ce+.5)*a,se=ge?C+I*(Pe-E)/Z:0,be=ge?Math.max(K,se-Ge):K,Re=ge?Math.min(he,se+Ge):he;if(be>Re||Re<t.x||be>t.x+t.width)continue;const ve=d(be,t.x),te=d(Re,t.x);for(let Ae=ve;Ae<=te;Ae++){const ke=t.x+(Ae+.5)*a,Se=Math.max(0,Math.min(1,((ke-C)*I+(Pe-E)*Z)/Math.max(pe,.001))),We=S+(U-S)*Se,Ne=j+(Y-j)*Se,He=Math.hypot(ke-C-I*Se,Pe-E-Z*Se),Le=Math.max(0,1-He/Math.max(We*.65,.5))**2;if(!Le)continue;const fe=Math.max(.35,Math.min(12,We*.11))*r.incision,qe=Ce*n+Ae,or=Math.max(0,Math.min(fe*2+.75,t.height[qe]-(Ne-fe)))*Le*(N>1&&Ne<fe?1.15:1);c[qe]=Math.max(c[qe],or)}}}let P=1/0,m=-1/0;for(let g=0;g<n*n;g++)t.height[g]-=c[g],l&&(l[g]-=c[g]),P=Math.min(P,t.height[g]),m=Math.max(m,t.height[g]);if(l)for(let g=0;g<n;g++)for(let h=0;h<n;h++){const p=g*n+h,N=Math.max(0,h-1),C=Math.min(n-1,h+1),E=Math.max(0,g-1),F=Math.min(n-1,g+1),_=l[g*n+C]-l[g*n+N],S=l[F*n+h]-l[E*n+h];if(_===0&&S===0)continue;const U=Math.max(1e-6,t.normalZ[p]),j=-t.normalX[p]/U+_/((C-N)*a||a),Y=-t.normalY[p]/U+S/((F-E)*a||a),B=Math.hypot(j,Y,1);t.normalX[p]=-j/B,t.normalY[p]=-Y/B,t.normalZ[p]=1/B}t.minHeight=P,t.maxHeight=m}const ht=new Float32Array(0);function nn(t,r){const i={...t,normalX:ht,normalY:ht,normalZ:ht};Pn(i,r,!1),t.minHeight=i.minHeight,t.maxHeight=i.maxHeight}const na=(t,r)=>t.riverArea>0?t.riverArea:Math.max(.02,.003*(r/1e3)**2);class Ut{constructor(r,i,n,a,o,l){this.engine=r,this.baseHeight=i,this.backend=n,this.backendReason=a,this.drainageMs=o,this.gpu=l}static async create(r,i,n,a,o,l){const u=performance.now();let s,e,c;if(o!=="cpu")try{const d=await ra(a,i,n,r,l);s=Ot.with_drainage(r,i,n,a,l,d.filled,d.receivers,d.accumulation),c=d}catch(d){e=`GPU hydrology unavailable: ${d instanceof Error?d.message:String(d)}`}const f=s?"gpu-f32":"cpu";return s??=new Ot(r,i,n,a,l),new Ut(s,a,f,e,performance.now()-u,c)}generate(r,i){const n=performance.now(),a=this.engine.generate(r.main,r.density,r.wetness,r.lakes,r.meanders,r.meanderIntensity,r.estuary,r.widthScale,r.incision,r.minLakeArea,r.lakeAbundance,r.lakeCoverage,r.maxLakeArea,r.depressionPolicy,r.maxBreachDepth,r.maxBreachLength,r.minLakeDepth,i.temperature,i.precipitation,r.coastalStreams);try{const o=a.stage_ms,l=a.stage_labels?Object.fromEntries(a.stage_labels.split(",").map((w,P)=>[w,o[P]])):void 0,u=a.basins;let s=0,e=0;for(const w of u)s=Math.max(s,w),w&&e++;const c=a.river_offsets,f=a.lake_meta,d=a.lake_closed;let y=0;for(let w=2;w<f.length;w+=6)y+=f[w];const x=a.river_meta;let b=!1;for(let w=4;w<x.length;w+=6)b||=(x[w]&2)!==0;return{width:a.width,resolution:a.resolution,receivers:a.receivers,accumulation:a.accumulation,basins:u,rawReceivers:a.raw_receivers??a.receivers,rawAccumulation:a.raw_accumulation??a.accumulation,rawBasins:a.raw_basins??u,flatLabels:a.flat_labels??new Uint32Array(u.length),flatRank:a.flat_rank??new Uint32Array(u.length),externalInflowArea:a.external_inflow_area??0,rawFilled:a.raw_filled??a.filled,rawDrainageHeight:a.raw_drainage_height??a.drainage_height,breachCount:a.breach_count??0,breachCutVolumeM3:a.breach_cut_volume_m3??0,avoidedFillVolumeM3:a.avoided_fill_volume_m3??0,filled:a.filled,lakeDepth:a.lake_depth,lakeLabels:a.lake_labels,baseHeight:this.baseHeight,drainageHeight:a.drainage_height,surfaceHeight:a.surface_height,adjustedHeight:a.adjusted_height,riverPoints:a.river_points,riverOffsets:c,riverMeta:x,riverFlare:a.river_flare,lakePoints:a.lake_points,lakeOffsets:a.lake_offsets,lakeMeta:f,lakeRingMeta:a.lake_ring_meta,lakeClosed:d,waterField:a.water_field,closedLakeCount:d.reduce((w,P)=>w+P,0),nodePoints:a.node_points,nodeMeta:a.node_meta,riverCount:c.length-1,lakeCount:f.length/6,basinCount:s,lakeFraction:y/Math.max(1,e*(a.width/a.resolution)**2),incision:r.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&r.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(r.main)&&!b?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-n,stageMs:l,generationMs:this.drainageMs+performance.now()-n,routingPotential:r.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{a.free()}}dispose(){this.engine.free()}}const ia="magna-urbis-neural-models-v1",bt=["coarse","base","decoder"];class je extends Error{constructor(r,i,n){super(i,n),this.code=r}}function an(t){const r=t;if(!r||typeof r.profile!="string"||!/^[a-f0-9]{64}$/.test(r.runtimeSha256))throw new je("manifest","Invalid neural model manifest.");if(r.runtimeJsSha256!==void 0&&!/^[a-f0-9]{64}$/.test(r.runtimeJsSha256))throw new je("manifest","Invalid neural runtime manifest.");for(const i of bt){const n=r.models?.[i];if(!n||!/^[\w.-]+$/.test(n.file)||!Number.isSafeInteger(n.bytes)||n.bytes<=0||!/^[a-f0-9]{64}$/.test(n.sha256))throw new je("manifest",`Invalid ${i} model manifest.`);if(n.chunks!==void 0&&(!Array.isArray(n.chunks)||!n.chunks.length||n.chunks.some(a=>!a||!/^[\w.-]+$/.test(a.file)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>=5e7||!/^[a-f0-9]{64}$/.test(a.sha256))||new Set(n.chunks.map(a=>a.file)).size!==n.chunks.length||n.chunks.reduce((a,o)=>a+o.bytes,0)!==n.bytes))throw new je("manifest",`Invalid ${i} model chunks.`)}return r}async function zn(t=!0){try{if(!globalThis.caches)throw new Error("Cache Storage unavailable");return await caches.open(ia)}catch(r){if(t)throw new je("storage","Cannot access browser model storage.",{cause:r})}}async function aa(t,r){const i=new URL("models/manifest.json",t),n=await zn(!1),a=AbortSignal.timeout(15e3);try{const o=await fetch(i,{cache:"no-cache",signal:r?AbortSignal.any([r,a]):a});if(!o.ok)throw new Error(`HTTP ${o.status}`);const l=an(await o.json());return await n?.put(i,new Response(JSON.stringify(l),{headers:{"Content-Type":"application/json"}})).catch(()=>{}),{manifest:l,offline:!1}}catch(o){const l=await n?.match(i);if(l)return{manifest:an(await l.json()),offline:!0};throw new je("manifest","Neural model catalogue unavailable on this address.",{cause:o})}}function Un(t,r){const i=new URL(`models/${r.file}`,t);return i.searchParams.set("sha256",r.sha256),i.href}function oa(t,r,i,n){return t.searchParams.get("sha256")===i.sha256&&Number(r.headers.get("X-Magna-Model-Bytes"))===i.bytes&&(r.headers.get("X-Magna-Model-Name")===n||t.pathname.split("/").pop()===i.file)}async function sa(t,r,i,n){const a=Un(r,i),o=await t.match(a);if(o)return{url:a,response:o};for(const l of await t.keys()){const u=new URL(l.url);if(u.searchParams.get("sha256")!==i.sha256)continue;const s=await t.match(l);if(s&&oa(u,s,i,n))return{url:l.url,response:s}}}async function Vr(t,r){if(t.byteLength!==r.bytes)return!1;const i=await crypto.subtle.digest("SHA-256",t);return Array.from(new Uint8Array(i),n=>n.toString(16).padStart(2,"0")).join("")===r.sha256}async function la(t,r,i,n={}){const{signal:a,onProgress:o}=n,l=r.models[i],u=Un(t,l);a?.throwIfAborted();const s=await zn(n.requireStorage??!1);s||n.onStorageFailure?.();const e=s&&await sa(s,t,l,i);if(e){const d=new Uint8Array(await e.response.arrayBuffer());o?.({name:i,phase:"verify",received:d.length,total:l.bytes});const y=await Vr(d,l);if(a?.throwIfAborted(),y)return d;await s?.delete(e.url)}const c=new Uint8Array(l.bytes);let f=0;for(const d of l.chunks??[l]){const y=new URL(`models/${d.file}`,t);y.searchParams.set("sha256",d.sha256);const x=await fetch(y.href,{signal:a});if(!x.ok)throw new je("download",`Cannot download ${i} weights: HTTP ${x.status}`);const b=f;if(x.body){const w=x.body.getReader();try{for(;;){a?.throwIfAborted();const{done:P,value:m}=await w.read();if(P)break;if(f+m.byteLength>b+d.bytes)throw new je("integrity",`Invalid ${i} model size.`);c.set(m,f),f+=m.byteLength,o?.({name:i,phase:"download",received:f,total:l.bytes})}}catch(P){throw await w.cancel().catch(()=>{}),P}finally{w.releaseLock()}}else{const w=new Uint8Array(await x.arrayBuffer());f+=w.byteLength,w.byteLength===d.bytes&&c.set(w,b)}if(f-b!==d.bytes||l.chunks&&!await Vr(c.subarray(b,f),d))throw new je("integrity",`Invalid ${i} model chunk: integrity check failed.`)}if(a?.throwIfAborted(),o?.({name:i,phase:"verify",received:f,total:l.bytes}),f!==l.bytes||!await Vr(c,l))throw new je("integrity",`Invalid ${i} model: integrity check failed.`);if(a?.throwIfAborted(),s){o?.({name:i,phase:"save",received:f,total:l.bytes});try{await s.put(u,new Response(c,{headers:{"X-Magna-Model-Name":i,"X-Magna-Model-Bytes":String(l.bytes),"X-Magna-Model-Profile":r.profile}}))}catch(d){if(n.requireStorage)throw new je("storage","Cannot save model: browser storage is full or unavailable.",{cause:d});n.onStorageFailure?.()}}return c}async function ca(t,r,i){const n=await globalThis.caches?.open("magna-urbis-neural-runtime-v1");async function a(u,s){const e=new URL(u,t);e.searchParams.set("sha256",s??r.runtimeSha256);const c=b=>s?Vr(b,{bytes:b.length,sha256:s}):Promise.resolve(!0);let f=e.href,d=await n?.match(e);if(n&&!d)for(const b of await n.keys()){const w=new URL(b.url);if(!(w.pathname.split("/").pop()!==u||w.searchParams.get("sha256")!==e.searchParams.get("sha256"))&&(d=await n.match(b),d)){f=b.url;break}}if(d){const b=new Uint8Array(await d.arrayBuffer());if(await c(b))return b;await n?.delete(f)}const y=await fetch(e,{signal:i});if(!y.ok)throw new Error("Neural runtime unavailable. Check your connection and retry.");const x=new Uint8Array(await y.arrayBuffer());if(!await c(x))throw new Error("Neural runtime integrity check failed. Please retry.");return await n?.put(e,new Response(x)),x}const o=await a("magna_urbis_neural_wasm.js",r.runtimeJsSha256),l=await a("magna_urbis_neural_wasm_bg.wasm",r.runtimeSha256);return{javascript:o,wasm:l}}let on="",Dr,kt="",fr,sn="";function Cn(t,r){if(new URL(t).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const i=t+(r?.runtimeSha256??"")+(r?.runtimeJsSha256??"");return(on!==i||!Dr)&&(on=i,Dr=(async()=>{if(r){const{javascript:o,wasm:l}=await ca(t,r),u=URL.createObjectURL(new Blob([o],{type:"text/javascript"}));try{const s=await import(u);return await s.default({module_or_path:l}),s}finally{URL.revokeObjectURL(u)}}const a=await import(new URL("magna_urbis_neural_wasm.js",t).href);return await a.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",t)}),a})().catch(n=>{throw Dr=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Dr}async function Ct(){if(fr){try{(await fr).free()}catch{}fr=void 0,kt=""}}async function ua(t,r,i,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:a}=await aa(t),o=[a.runtimeSha256,...bt.map(s=>a.models[s].sha256)].join(":");(kt!==t+o||!fr)&&(await Ct(),kt=t+o,fr=(async()=>{const s=await Cn(t,a);sn=o;const e=[];for(const c of bt){const f=a.models[c];n?.(`Neuronal WASM · ${c} · ${(f.bytes/1e6).toFixed(1)} Mo`),e.push(await la(t,a,c,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),s.NeuralRelief.create(e[0],e[1],e[2])})().catch(s=>{throw fr=void 0,s}));const l=await fr;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await l.generate_json(JSON.stringify(Object.fromEntries(r)),i?JSON.stringify(i):"");try{const s=new Float32Array(u.heights),e=JSON.parse(u.meta),c=Number(r.get("extent")??4e4),f=Number(r.get("resolution")??Math.ceil(c/Number(r.get("sampleSpacing")??30))),d=e.resolution;if(e.extent!==c||e.nativeCellM!==30||e.nativeResolution!==Math.ceil(c/30)||typeof d!="number"||!Number.isInteger(d)||d!==f||s.length!==d*d||e.outputCellM!==c/d||s.some(y=>!Number.isFinite(y)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:s,meta:{...e,modelIdentity:sn}}}finally{u.free()}}let ln;async function An(t,r,i,n){ln??=Mt();const{seed:a,width:o,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sketch:y,source:x}=t,b=y?.processing,w=tr(t),P={seed:a,width:o,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sampleSpacing:w.requestedSpacing,sourceN:w.n,coastProfile:Fr(t),coastMask:t.coastMask??0,islandMode:t.islandMode??"island",source:x,...b?{sketch:{processing:b},surface:Array.from(Wr(wr(y),w.n))}:{}},g=await(await Lr(r,"/terrain",JSON.stringify({session:ln,settings:P,region:i,field:n}))).arrayBuffer();if(g.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const h=new DataView(g).getUint32(0,!0);if(h%4||4+h>g.byteLength)throw new Error("En-tête terrain local invalide.");const p=JSON.parse(new TextDecoder().decode(new Uint8Array(g,4,h)));let N=4+h;const C={};for(const _ of p.arrays){const S=_.count*(_.type==="f32"?4:1);if(!Number.isSafeInteger(_.count)||_.count<0||N+S>g.byteLength)throw new Error("Raster terrain local incomplet.");C[_.name]=_.type==="f32"?new Float32Array(g,N,_.count):new Uint8Array(g,N,_.count),N+=S}const E=C.height,F=p.resolution*p.resolution;if(!Number.isInteger(p.resolution)||p.resolution<64||p.resolution>1024||!E||E.length!==F||!E.every(Number.isFinite)||["normalX","normalY","normalZ"].some(_=>C[_]?.length!==F))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(p.fieldFloor)||!Number.isInteger(p.fieldN)||p.fieldN!==w.n||C.field?.length!==p.fieldN*p.fieldN||!C.field.every(Number.isFinite)||C.physical?.length!==p.fieldN*p.fieldN||!C.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:p.session,x:p.x,y:p.y,width:p.width,resolution:p.resolution,minHeight:p.minHeight,maxHeight:p.maxHeight,globalMinHeight:p.globalMinHeight,globalMaxHeight:p.globalMaxHeight,motifSize:p.motifSize,height:E,normalX:C.normalX,normalY:C.normalY,normalZ:C.normalZ,caveMask:C.caveMask,prepareMs:p.prepareMs,samplingMs:p.samplingMs,generationMs:p.prepareMs+p.samplingMs,generationBackend:"native",generationReason:p.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${p.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:p.erosionDefaults,...C.field?{field:{n:p.fieldN,data:C.field,exact:p.fieldExact,floor:p.fieldFloor,...C.physicalCave?{cave:C.physicalCave}:{}}}:{},...C.physical?{physical:{n:p.fieldN,height:C.physical}}:{},definition:w}}function fa(t){if(t.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return An(t.settings,t.runtime,t.region,t.kind==="overview")}async function da(t,r){const i=await An(t,r,{x:0,y:0,extent:t.width,resolution:64},!0);if(!i.field||i.field.data.length!==tr(t).n**2)throw new Error("Surface physique native absente.");return{height:i.field.data,prepareMs:i.prepareMs??0,samplingMs:i.samplingMs??0,session:i.session,fieldExact:i.field.exact,erosionDefaults:i.erosionDefaults}}const pa="[relief_session_missing]",cn=t=>Array.from(t,r=>Number.isFinite(r)?r:null),ha=t=>new Uint8Array(t.buffer,t.byteOffset,t.byteLength);class cr{constructor(r,i){this.runtime=r,this.tuning=i,this.session=Mt(),this.steps=[],this.released=!1}static async build(r,i,n,a){const o=new cr(r,a.slice());return await o.mutate({op:"build",...i},n),o}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,r=>r??NaN)}editSurface(r){return this.mutate({op:"edit"},r)}coast(r,i,n,a,o){return this.mutate({op:"coast",mask:r,mode:i,coastProfile:o,surface:!!a,...n?{tuning:cn(n)}:{}},a)}carveUnderdark(r,i){return this.mutate({op:"underdark",seed:r,...i!==void 0?{tunnels:i}:{}})}async sampleRegion(r,i,n,a){const{meta:o,arrays:l}=await this.send({op:"read",region:{x:r,y:i,extent:n,resolution:a}}),u=o.region,s=l.height;if(!u||!s||s.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:s,cave_mask:l.caveMask,normal_x:l.normalX,normal_y:l.normalY,normal_z:l.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}async underdarkTunnels(){return(await this.send({op:"read",tunnels:!0})).arrays.tunnels??new Float32Array(0)}free(){this.released||(this.released=!0,this.steps.length=0,Lr(this.runtime,"/release",JSON.stringify({session:this.session})).then(r=>r.arrayBuffer(),()=>{}))}async mutate(r,i){this.meta=(await this.send(r,i)).meta,this.steps.push({header:r,plane:i})}async send(r,i){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(r,i)}catch(n){if(r.op==="build"||!(n instanceof Error)||!n.message.includes(pa))throw n;for(const a of this.steps)await this.call(a.header,a.plane);return this.call(r,i)}}async call(r,i){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:cn(this.tuning),...r})),a=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);a.set(n);const o=new Uint8Array(4);new DataView(o.buffer).setUint32(0,a.length,!0);const u=await(await Lr(this.runtime,"/terrain/relief",new Blob([o,a,...i?[ha(i)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const s=new DataView(u).getUint32(0,!0);if(s%4||4+s>u.byteLength)throw new Error("Native relief reply header invalid.");const e=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,s))),c={};let f=4+s;for(const{name:d,type:y,count:x}of e.arrays){const b=x*(y==="f32"?4:1);if(!Number.isSafeInteger(x)||x<0||f+b>u.byteLength)throw new Error("Native relief plane incomplete.");c[d]=y==="f32"?new Float32Array(u,f,x):new Uint8Array(u,f,x),f+=b}return{meta:e,arrays:c}}}const ma=["plateau","volcano","caldera"],$r=t=>t==="neural-wasm"||t==="neural-python"||t==="neural",ga="http://127.0.0.1:8792",va="http://127.0.0.1:8793";function ya(t,r){const i=t==="neural-python"?va:ga,n=r?.trim().replace(/\/+$/,"");if(!n)return i;try{const a=new URL(n);if(a.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(a.hostname)&&["8792","8793"].includes(a.port)&&a.pathname==="/"&&!a.search&&!a.hash&&!a.username&&!a.password)return i}catch{}return n}const En={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},wa={flat:20,hills:110,plateau:100},lr=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],Jr=t=>t.climateValues??ui[t.climate??"temperate"];function un(t){const r=new Float32Array(t.height.length);let i=0,n=0;for(let l=0;l<t.height.length;l++)t.height[l]>0&&(r[n++]=t.height[l],i+=Math.acos(Math.min(1,t.normalZ[l])));const a=r.subarray(0,n).sort(),o=l=>n?a[Math.min(n-1,Math.floor(l*n))]:0;return{p5:o(.05),p50:o(.5),p95:o(.95),slope:i/Math.max(1,n),land:n/Math.max(1,t.height.length)}}let et,L,ur="",jr="",yr,ir="",Nr,gr,$e,ar=!1,$;const De=()=>$??L,Br=()=>$?$.physicalHeightField():Promise.resolve(L.physical_height_field()),fn=async()=>{if($)return $.underdarkTunnels().catch(()=>new Float32Array(0));const t=L?.underdark_tunnels;return t?t.call(L):new Float32Array(0)},mt=()=>$?$.samplingBaseField():Promise.resolve(L.sampling_base_field());let rr="",Qe,vr,le,er,Fe="cpu",Oe,dn=Promise.resolve(),Ie,br="",kr="",Ee,Tr,Kr="";async function Rn(){if(!Kr)return;const t=Kr;Kr="";try{await fetch(`${t}/release`,{method:"POST"})}catch{}}let Sr,Q,Ve;const _r=new St;function Sa(){Zr(),Fi(),_r.clear(),yr=void 0,le?.dispose(),le=void 0,er=void 0,L?.free(),L=void 0,$?.free(),$=void 0,ur="",rr="",ar=!1,$e=void 0,Ie?.dispose(),Ie=void 0,Q=void 0,Ve=void 0,Ee=void 0,br="",kr="",Sr=void 0}async function xa(t,r){const i=tr(t),n=Math.ceil(t.width/30),a=(m,g)=>g.extent===t.width&&g.resolution===i.n&&g.nativeCellM===30&&g.nativeResolution===n&&g.outputCellM===t.width/i.n&&m.length===i.n*i.n&&m.every(Number.isFinite),o=ya(t.source,t.neuralServer),l=new URLSearchParams({seed:t.seed,relief:t.relief,mix:String(t.relief==="mixed"?t.mountainMix:.5),coasts:"0",islands:"island",climate:t.climate??"temperate",noise:String(t.fidelity??.05),extent:String(t.width),sampleSpacing:String(i.requestedSpacing),resolution:String(i.n)}),u=Jr(t),s=t.neuralTuning??En;for(const[m,g]of Object.entries(u))l.set(m,String(g));l.set("landScale",String(s.landScale)),l.set("steps",String(s.steps)),l.set("detail",String(s.detail));for(const m of["coarseModel","baseModel","decoderModel"])t[m]&&l.set(m,t[m]);for(const m of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])l.set(m,String(s[m]));l.set("histogram",s.histogram.join(","));const e=wa[t.relief];s.reliefMode==="fixed"?l.set("reliefFixed",String(s.reliefFixed)):s.reliefMode==="auto"&&e!==void 0?l.set("reliefFixed",String(e)):l.set("reliefScale",String(s.reliefMode==="scale"?s.reliefScale:1));const c=di(t.width,t.width,t.neuralFit??"crop",t.neuralSlopes??!0),f=t.zones?{zones:xn(t.zones),region:{x:c.x,y:c.y,width:c.width}}:t.sketch?pi(wr(t.sketch),c):void 0,d=performance.now();if(t.source==="neural-wasm"){if(await Rn(),!t.neuralAssets)throw new Error("Neural browser runtime URL missing.");const m=await ua(t.neuralAssets,l,f,r);if(!a(m.heights,m.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:m.heights,info:{...m.meta,requestMs:performance.now()-d}}}await Ct();let y=f;if(t.source==="neural-python"){if(t.zones&&(await fetch(`${o}/status`,{cache:"no-store"}).then(p=>p.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!t.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const m=await Cn(t.neuralAssets),g=Object.fromEntries(l);y={params:g,conditioning:JSON.parse(m.conditioning_json(JSON.stringify(g),f?JSON.stringify(f):"")),edited:!!f},r?.("Neural Python · computing with PyTorch/CUDA")}const x={cache:"no-store",...y?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(y)}:{}};let b;if(t.source==="neural")b=await hi({profile:"local",server:o},`/generate?${l}`,x);else try{b=await fetch(`${o}/generate?${l}`,x)}catch{throw new Error(`Neural service unreachable (${o}): run “npm run neural:python” from web/`)}if(!b.ok)throw new Error(`Neural service: ${await b.text()}`);const w=new Float32Array(await b.arrayBuffer()),P=JSON.parse(b.headers.get("X-Neural-Meta")??"{}");if(t.source==="neural-python"&&(Kr=o),f&&(P.edited!==!0||P.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!a(w,P))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:w,info:{...P,requestMs:performance.now()-d}}}function ba(t){return et??=(async()=>{si()?(t?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await li(),t?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await ci(()=>bi(Si,r=>ki({module_or_path:r}),t))})()}yn(()=>{_r.clear(),et=void 0,L=void 0,$?.free(),$=void 0,ur="",rr="",ar=!1,Ie=void 0,Ee=void 0,br="",kr="",Sr=void 0,Q=void 0,Ve=void 0});function _a(t,r,i,n){const a=dn.then(()=>pn(t,r,i,n).catch(async o=>{if(!await Kn(o))throw o;return i?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),pn(t,r,i,n)}));return dn=a.catch(()=>{}),a}async function pn(t,r,i,n){const{settings:a,region:o,kind:l,display:u,runtime:s}=t,e=a.islandMode?.startsWith("traced:")&&(a.sketch?.processing||a.relief==="cavern"||a.underdark)?{...a,islandMode:"island"}:a,c=tr(e);if(Xn(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning}),e.climateZone==="wetland"&&(e.erosionTuning={carve:0,finalCarve:0,surfaceCarve:0,...e.erosionTuning});const f=e.compute==="wasm"?"wasm":"gpu-f32",d=e.generationCompute??"gpu-erosion";if(Zn(e,c.n))throw new Error(`GPU generation is limited to ${Qn}² cells; requested spacing ${c.spacing.toFixed(2)} m (${c.n}²). Choose CPU or native.`);const y=Je(e.generalSeed??e.seed,"relief-coast-cut"),x=!!e.generalSeed&&yt(e.generalSeed,M=>M.startsWith("relief-"))!==wn(e.generalSeed),b=rt(e),w=e.hydrology?.compute==="auto"&&(f==="wasm"||d==="cpu")?"cpu":e.hydrology?.compute??"auto";if(w!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&zt(),b&&!e.zones&&!e.sketch?.processing&&(!ei.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const P=d==="native"&&!$r(e.source);if(P&&s?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(P&&e.relief==="cavern")return fa({...t,settings:e});const m=ma.includes(e.relief)?e.environment??"mixed":"mixed",g=e.sketch?.processing,h=ie(e,"coasts")?e.relief==="cavern"||e.underdark?0:e.coastMask??0:0,p=e.islandMode??"island",N=Fr(e),C=Ni.includes(e.relief),E=f!=="wasm"&&C?Bi(f,e.relief).catch(()=>{}):void 0;et&&i?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await ba(i)}catch(M){throw et=void 0,M}const F=performance.now();E&&i?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const _=E?await Mr(E):void 0;n&&await n.after("prepare");const S=(M,k)=>{const R=$e;$e={erosionSpacing:M===void 0?R?.erosionSpacing:Math.max(R?.erosionSpacing??0,M),regionalErosionSpacing:k===void 0?R?.regionalErosionSpacing:Math.max(R?.regionalErosionSpacing??0,k)},Object.assign(c,$e)},U=async(M,k=!1)=>{let R=k&&ie(e,"phasor",!1)?vt(M,e):M;const ee=Lt(e),J=Ft(e),de=Xr(e);for(const A of["posterior","wind"]){const G=JSON.stringify([de.get(A),s?.server,!!_,fi(new Uint8Array(R.buffer,R.byteOffset,R.byteLength))]),ce=e.procedural?_r.get(A,G):void 0;if(ce){R=ce,n?.cached?await n.cached(A,n.previews===!1?void 0:R):(await n?.before(A),await n?.after(A,n.previews===!1?void 0:R));continue}if(await n?.before(A),A==="posterior"&&e.procedural&&ie(e,A)&&ee.mode!=="none"){const H=R,ne=Math.sqrt(R.length);R=(await It(R,ne,e.width,ee,{stats:!1},s)).height;for(let re=0;re<R.length;re++)R[re]=H[re]>0?Math.max(.3,R[re]):R[re]}A==="wind"&&e.procedural&&ie(e,A)&&J.iterations&&J.transport&&(R=_?await Ci(_.context,R,e.width,J):Ui(R,e.width,J)),e.procedural&&c.n<=1024&&_r.put(A,G,R),await n?.after(A,n.previews===!1?void 0:R)}return e.procedural&&R.some(A=>A<.3)?R.map(A=>Math.max(.3,A)):R},j=_?Mr(_.pipeline).then(M=>({pipeline:M}),()=>{}):void 0,Y=!P&&!e.zones&&!e.sketch&&d!=="cpu"&&f!=="wasm"&&!$r(e.source)&&e.relief!=="cavern",B=Y&&_?ji(_.context,e):void 0;if(B?.error&&e.generationCompute)throw new Error(B.error);const I=e.generationCompute||!B?void 0:B.error??(ri(B)?`Source ${c.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),Z=!!B&&!B.error&&!I,pe=Y&&Ti.includes(e.relief),K=pe&&Z,he=(c.n!==1024||!!(e.procedural||n||x))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!$r(e.source)&&(!K||d!=="gpu-erosion"),X=!g&&$r(e.source);X||(await Ct(),await Rn());const oe=s?.profile==="local"&&(P||X),Ue=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,st(e.modification.delta)]):"",me=JSON.stringify([e.zones,Ue,!!e.underdark,y,P?[s.server,h,p,N]:null,oe?s.server:null])+"|"+JSON.stringify(X?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,Jr(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??En,e.width,c.n,e.coarseModel,e.baseModel,e.decoderModel,e.neuralFit,e.neuralSlopes]:[e.seed,...e.generalSeed?[yt(e.generalSeed,M=>M.startsWith("relief-"))]:[],e.width,c.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,P?"native":b?[d,f,!!_]:pe?d:"cpu",m,e.sketch,e.erosionTuning??{},...e.procedural?[ti,N,e.procedural,e.climate,e.climateValues,e.climateZone,K?null:[h,p,N]]:[],...b||e.procedural?.enabled?.phasor?[lt,e.climate??"temperate",e.phasor??{}]:[]]);let ge=0,Ge=0,Ce=0,Pe=0,se=0,be;if(n&&n.previews!==!1||!(L||$)||ur!==me){le?.dispose(),le=void 0,er=void 0,L?.free(),L=void 0,$?.free(),$=void 0,ar=!1,ur="",rr="",$e=void 0;const M=performance.now();ir="",jr="",Nr=void 0,gr=void 0,yr=void 0,Fe="cpu",Oe=void 0;const k=e.relief==="mixed"?e.mountainMix:.5;Tr=void 0;const R=Float64Array.from(lr,A=>{let G=b&&!e.procedural?NaN:e.procedural?.erosionTuning?.[A]??e.erosionTuning?.[A]??NaN;return e.procedural?.biome&&!K&&!he&&(A==="incision"||A==="thermal")&&(G=(Number.isFinite(G)?G:1)*(A==="incision"?Er(e).water:Er(e).thermal)),G});if(Rr(R),he){i?.(I?`${I} Rust CPU generation at ${c.spacing.toFixed(2)} m…`:P?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const A=await U(await Pi(e,n,P?s:void 0,K&&_?()=>Wt(_.context,e,i):void 0,(G,ce)=>{$e={erosionSpacing:G,regionalErosionSpacing:ce},Object.assign(c,$e)}));n&&await n.before("retain"),oe?$=await cr.build(s,{kind:"source",seed:y,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:k,environment:m},A,R):L=xe.with_source(y,e.width,e.relief,e.erosion,e.motifSize,k,A,m),n&&await n.after("retain",n.previews===!1?void 0:A),Fe=P?"native":K?d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":b?"compact-cpu":"cpu",Oe=I??`${P?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(P){i?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${c.n} × ${c.n} physical field`});const A=e.procedural?.biome?{...e,coastMask:h,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*Er(e).water,thermal:(e.erosionTuning?.thermal??1)*Er(e).thermal}}:{...e,coastMask:h},G=await da(A.sketch&&!g?{...A,sketch:void 0}:A,s),ce=g!=="surface"&&e.procedural&&!e.zones?await U(G.height.slice(),!0):void 0;if(ce&&h)for(let H=0;H<ce.length;H++)G.height[H]<=0&&(ce[H]=G.height[H]);$=await cr.build(s,{kind:"surface",seed:y,width:e.width},ce??G.height,R),Fe="native",Oe="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",se=G.prepareMs}else if(g){i?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const A=Wr(wr(e.sketch),c.n);if(g==="erosion"){i?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),L=xe.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,m,c.n),L.set_edited_surface(A);const G=L.sampling_base_field();L.free(),L=xe.with_surface(y,e.width,G)}else L=xe.with_surface(y,e.width,A);Oe=g==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if(X){const A=await xa(e,i),G=ni(A.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);oe?$=await cr.build(s,e.zones?{kind:"zonedSurface",seed:y,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:y,width:e.width},G,R):L=e.zones?xe.with_zoned_surface(y,e.width,e.motifSize,G,JSON.stringify(e.zones)):xe.with_surface(y,e.width,G),Tr=A.info,Fe="neural",e.zones&&(Oe="Zones → regional conditioning and local neural relief, then sea operation.")}else if(b&&!e.zones)if(_&&Z){i?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:S},G=await U(await Zt(_.context,e,A,i));n&&await n.before("retain"),be=A.profiles,L=xe.with_source(y,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,k,G,m),n&&await n.after("retain",G),Fe="compact-gpu-f32",Oe=`${lt} · compact preset · ${e.procedural?.regionalN??Gt(e).n}² grid · ${e.climate??"temperate"} · Phasor ${ie(e,"phasor",!0)?"enabled":"disabled"}.`}else{i?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const A=e.procedural?.biome?Er(e):void 0,G=A?{incision:A.water,thermal:A.thermal}:e.procedural?{incision:1,thermal:1}:ii(e),ce=e.procedural?.erosionTuning?.iterations??Gt(e).steps,H=e.erosionTuning??{},ne={...H,iterations:ce,surfaceIterations:ie(e,"surface",!1)?H.surfaceIterations??12:0,detail:ie(e,"ridged",!1)?H.detail:0,warp:H.warp??0,incision:(H.incision??1)*G.incision,thermal:(H.thermal??1)*G.thermal};Rr(Float64Array.from(lr,D=>ne[D]??NaN));let re;try{re=xe.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,m,c.n);const D=re.physical_height_field();L=xe.with_source(y,e.width,"hills",e.erosion,e.motifSize,k,ie(e,"phasor",!0)?vt(D,e):D,m)}finally{re?.free(),Rr(new Float64Array(lr.length).fill(NaN))}Fe="compact-cpu",Oe=`${lt} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)i?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n} × ${c.n} physical field`}),L=xe.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,m,JSON.stringify(xn(e.zones)),c.n),Oe="Zone masks → uplift, noise, ridges and Rust erosion.";else if(K&&_)try{if(d==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:S},G=await U(await Zt(_.context,e,A,i));n&&await n.before("retain"),se=A.nativeEnvironmentMs,be=A.profiles,Pe=performance.now()-M-se,L=xe.with_source(y,e.width,e.relief,e.erosion,e.motifSize,k,G,m),n&&await n.after("retain",G),Fe="gpu-erosion-f32"}else{const A=await Wt(_.context,e,i);Ge=performance.now()-M;const G=performance.now();i?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),L=xe.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,A.coarse,A.fine,m),Ce=performance.now()-G,Fe=d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(A){if(n||e.procedural)throw A;Oe=`GPU generation unavailable: ${A instanceof Error?A.message:String(A)}`}if(!L&&!$&&(i?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n}² physical source at ${c.spacing.toFixed(2)} m`}),L=xe.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,k,m,c.n),I&&(Oe=I)),!g&&!X&&e.sketch&&e.relief!=="cavern"){const A=wr(e.sketch),G=await Br(),ce=ai(A,G,c.n);$?await $.editSurface(ce):L.set_edited_surface(ce),Oe="Edited sketch + procedural detail and Rust erosion."}const ee=Lt(e),J=Ft(e),de=ie(e,"posterior")&&ee.mode!=="none"||ie(e,"wind")&&J.iterations>0&&J.transport>0;if(!he&&e.procedural&&(de||!b&&ie(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(Fe)&&!X&&!g&&!P&&!e.zones){Dt(L,h,p,N);const A=L.physical_height_field(),G=await U(A,!b);L.free(),L=xe.with_surface(y,e.width,G),ar=!0}e.modification&&(X||g)&&(yr=await mt()),ge=performance.now()-M,ur=me}else if(i?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),$e&&Object.assign(c,$e),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const M of["grids",..._t(e),"phasor","posterior","wind"])await n.cached(M);const Re=JSON.stringify([me,y,h,p,N,Xr(e).get("coasts"),Fe,s?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,st(e.sketch.heights)],e.zones&&[e.zones.resolution,st(e.zones.weights)]]),ve=!!(e.procedural||X||g)&&!ar&&!(P&&!he),te=ve&&h?_r.get("coasts",Re):void 0;!te&&n&&await n.before("coasts");const Ae=!X&&!g&&!ar&&!B?.error&&!I&&!e.zones&&!e.sketch&&h!==0&&d!=="cpu"&&f!=="wasm",ke=JSON.stringify([y,h,h?p:"island",N,h?Ae:!1,e.procedural?.coastIterations,e.procedural?.coastIncision,e.procedural?.coastThermal,e.procedural?.coastDiffusion,e.erosionTuning]);let Se=0;if(yr&&ir&&ir!==me+"|"+ke){if(le?.dispose(),le=void 0,er=void 0,$){const M=$;$=await cr.build(s,{kind:"surface",seed:y,width:e.width},yr,new Float64Array(lr.length).fill(NaN)),M.free()}else L?.free(),L=xe.with_surface(y,e.width,yr);rr="",ir="",gr=void 0,Nr=void 0,jr=""}if(P&&!he||ar)rr=ke,Qe=ar&&h?"cpu":void 0,vr=void 0;else if(rr!==ke){le?.dispose(),le=void 0,er=void 0,Qe=void 0,vr=void 0;const M=performance.now();i?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const k=e.procedural,R={...e.erosionTuning,...k?.erosionTuning},ee=h?Float64Array.from(lr,J=>k&&J==="surfaceIterations"?k.coastIterations??(b?2:12):J==="surfaceIncision"?(R[J]??1)*(k?.coastIncision??1):J==="surfaceThermal"?(R[J]??1)*(k?.coastThermal??1):J==="surfaceDiffusion"?(R[J]??1)*(k?.coastDiffusion??1):R[J]??NaN):void 0;if($?(await $.coast(h,p,te?void 0:ee,te,N),h&&(Qe="native")):te&&($t(L,h,p,N),L.set_coast_surface(te),Qe="cpu"),!$&&!te&&Ae&&_){let J;try{const de=await j;if(!de||_.context.lost)throw new Error("WebGPU unavailable");$t(L,h,p,N),J=new Yt(_.context,de.pipeline,f,L);const A=J.prepareCoastField(e),G=await Wi(_.context,e,A,L.coast_erosion_parameters(),i);L.set_coast_surface(G),Qe="gpu-f32"}catch(de){vr=`GPU coast unavailable: ${de instanceof Error?de.message:String(de)}`}finally{J?.dispose()}}if(!$&&!Qe){ee&&Rr(ee);try{Dt(L,h,p,N)}finally{ee&&Rr(Float64Array.from(lr,J=>R[J]??NaN))}h&&(Qe="cpu"),Ae&&!_&&(vr="WebGPU unavailable")}rr=ke,Se=h?performance.now()-M:0,ge+=Se}const We=h&&ve&&(!te&&c.n<=1024||n&&n.previews!==!1&&!(te&&n.cached))?await mt():void 0;if(We&&!te&&c.n<=1024&&_r.put("coasts",Re,We),te&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:te):n&&await n.after("coasts",n.previews===!1?void 0:We),e.modification&&ir!==me+"|"+ke){const M=De().source_resolution(),k=g==="surface"&&!h?Wr(wr(e.sketch),M):await Br();if(Nr={n:M,height:k.slice()},gr=oi(k,M,e.modification),le?.dispose(),le=void 0,er=void 0,$){const R=$;$=await cr.build(s,{kind:"surface",seed:y,width:e.width},gr,new Float64Array(lr.length).fill(NaN)),R.free()}else L?.free(),L=xe.with_surface(y,e.width,gr);ir=me+"|"+ke}e.underdark&&jr!==me+"|"+ke+"|"+ir+"|"+(e.underdarkTunnels??"")&&(i?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),le?.dispose(),le=void 0,er=void 0,$?await $.carveUnderdark(e.seed,e.underdarkTunnels):L.carve_underdark(e.seed,e.underdarkTunnels),jr=me+"|"+ke+"|"+ir+"|"+(e.underdarkTunnels??""));let Ne;const He=async(M,k,R)=>((Ne?.delta!==M||Ne.m!==k||Ne.n!==R)&&(Ne={delta:M,m:k,n:R,out:await xi(M,k,R,s)}),Ne.out);async function Le(M){$e?Object.assign(c,$e):c.erosionSpacing??=De().erosion_spacing(),M.definition=c,n&&await n.after("sampling",M.height),n&&await n.before("hydrology");const k=ie(e,"hydrology")?e.hydrology:void 0;M.neural=Tr,l==="overview"&&!X&&e.relief!=="cavern"&&(M.erosionDefaults=Array.from(mi(e.relief,e.width,e.motifSize,e.mountainMix)));const R=!!k?.enabled&&e.relief!=="cavern",ee=k?.engine!=="rust",J=k?.erosionEnabled!==!1,de=J&&k?.showErosion!==!1,A=J?k?.condMode:"none",G=ee&&k&&k.lakes!=="none"?[k.lakeAbundance,k.lakeArea,k.lakeDepth,k.lakeCoverage,k.maxLakeArea]:[0,0,0,0,0],ce=k&&{mode:k.condMode,strength:k.condStrength,maxDepth:k.condDepth,maxLength:k.condLength,banks:k.condBanks,lakes:G[0],lakeArea:G[1],lakeDepth:G[2],lakeCoverage:G[3],maxLakeArea:G[4],...e.climateZone==="wetland"?{undulation:2}:{}};if(r&&k&&R&&l==="overview"&&u==="gl"){const H=Ht(ee?k.vectorResolution:k.resolution,c.n),ne=JSON.stringify([ur,rr,H,A,A==="none"?0:[k.condStrength,k.condDepth,k.condBanks,k.condLength,G]]);if(!Q||Q.key!==ne||ee&&!Ve){const re=un(M);r({...M,height:M.height.slice(),normalX:M.normalX.slice(),normalY:M.normalY.slice(),normalZ:M.normalZ.slice(),caveMask:M.caveMask.slice(),neural:Tr&&{...Tr,land:re.land},field:await fe(M,!1,ee),relief:re,generationMs:performance.now()-F})}}if(k&&R){const H=Ht(ee?k.vectorResolution:k.resolution,c.n),ne=JSON.stringify([ur,rr,H,A,A==="none"?0:[k.condStrength,k.condDepth,k.condBanks,k.condLength,G]]),re=Jr(e),D={riverArea:na(k,e.width)/Math.max(1,k.density)**2,density:Math.min(1,k.density),headwaters:k.headwaters!==!1?1:0,minRiverLength:k.minRiverLength,lakeDepth:k.lakeDepth,lakeArea:k.lakeArea,riverMode:k.riverMode,flatSlope:k.flatSlope,sinuosity:k.sinuosity,widthScale:k.vectorWidth,balance:k.balance,braiding:k.braiding,anabranching:k.anabranching,terrainInfluence:k.terrainInfluence,avulsions:k.avulsions,confluence:k.confluence,deltas:k.deltas,...e.climateZone==="wetland"?{oxbows:.35}:{}},_e=JSON.stringify([ne,D,re.temperature,re.precipitation,Je(e.generalSeed??e.seed,"water-hydrology")]);if(!Q||Q.key!==ne){Q=void 0,Ve=void 0,Ie?.dispose(),Ie=void 0,Ee=void 0,br="",kr="";let W;if(M.x===0&&M.y===0&&M.width===e.width&&M.resolution===H)W=M.height.slice();else if(le&&!le.lost)W=(await le.sample({x:0,y:0,extent:e.width,resolution:H},e,L.min_height,L.max_height)).height;else{const V=$?await $.sampleRegion(0,0,e.width,H):L.sample_region(0,0,e.width,H);try{W=V.height}finally{V.free()}}if(A==="none")Q={key:ne,n:H,height:W,m:0};else{i?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const V=ce;if(ee){const Be=await qt(W,H,e.width,V,D,re,Je(e.generalSeed??e.seed,"water-hydrology"),s),{height:ae,delta:q,...pr}=Be.conditioning;Q={key:ne,n:H,height:ae,source:W,delta:q,m:H,stats:pr},Ve={key:_e,water:Be.water}}else{const Be=await It(W,H,e.width,V,{stats:!1,drainage:!1},s),{height:ae,delta:q,hydrology:pr,...Hr}=Be;Q={key:ne,n:H,height:ae,source:W,delta:q,m:H,stats:{...Hr,census:!1},drainage:pr}}}}if(ee){if(!Ve||Ve.key!==_e)if(i?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),Q.source){const W=await qt(Q.source,H,e.width,ce,D,re,Je(e.generalSeed??e.seed,"water-hydrology"),s),{height:V,delta:Be,...ae}=W.conditioning;Object.assign(Q,{height:V,delta:Be,stats:ae}),Ve={key:_e,water:W.water}}else Ve={key:_e,water:await gi(Q.height,H,e.width,D,re,Je(e.generalSeed??e.seed,"water-hydrology"),Q.drainage,s)}}else{const W=JSON.stringify([ne,w,Je(e.generalSeed??e.seed,"water-hydrology")]),V={...k,showErosion:!0,erosionEnabled:J,...J?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},Be=`${W}|${JSON.stringify(V)}`;if(X&&Sr?.key===Be)M.hydrologyError=Sr.message;else try{(!Ie||br!==W)&&(i?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),Ie?.dispose(),Ie=void 0,Ee=void 0,kr="",Ie=await Ut.create(Je(e.generalSeed??e.seed,"water-hydrology"),e.width,H,Q.height.slice(),w,h!==0||(g||X||e.sketch||e.zones?De().min_height<=0:!1)),br=W);const ae=Jr(e),q=JSON.stringify([V,ae.temperature,ae.precipitation]);(!Ee||kr!==q)&&(i?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Ee=Ie.generate(V,ae),kr=q)}catch(ae){if(!X)throw ae;Ie?.dispose(),Ie=void 0,Ee=void 0,br="",Sr={key:Be,message:ae instanceof Error?ae.message:String(ae)},M.hydrologyError=Sr.message}}}if(i?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),R&&de&&Q?.delta&&!e.underdark&&await vi(M,Q.delta,Q.m,e.width,s),R&&de&&!ee&&Ee&&!M.hydrologyError){const H=performance.now();Pn(M,Ee),M.hydrologySurfaceMs=performance.now()-H}if(l==="overview"){const H=De().source_resolution(),ne=e.underdark?await Br():gr?.slice()??(g==="surface"&&!h?Wr(wr(e.sketch),H):await Br());if(R&&de&&Q?.delta&&!e.underdark){const re=await He(Q.delta,Q.m,H);for(let D=0;D<ne.length;D++)ne[D]+=ne[D]<=0?Math.min(0,re[D]):re[D]}R&&de&&!ee&&Ee&&!M.hydrologyError&&nn({x:0,y:0,width:e.width,resolution:H,height:ne,minHeight:M.globalMinHeight,maxHeight:M.globalMaxHeight},Ee),M.physical={n:H,height:ne},Nr&&(M.modificationBase=Nr)}return e.refine&&u!=="gl"&&yi(M,e.width/De().source_resolution(),wi(e.seed),e.detailNoise),l==="overview"&&(u==="gl"||t.retainField)&&(i?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),M.field=await fe(M,R,ee)),l==="overview"&&R&&(ee?M.water=Ve?.water:Ee&&!M.hydrologyError&&(M.hydrology=Ee),Q?.delta&&Q.stats&&(M.conditioning={delta:Q.delta,n:Q.m,stats:Q.stats})),l==="overview"&&(M.relief=un(M)),M.neural&&M.relief&&(M.neural={...M.neural,land:M.relief.land}),M.generationMs=performance.now()-F,n&&await n.after("hydrology",M.height),M}async function fe(M,k,R){const ee=De().sampling_parameters()[5],J=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((ee===1||ee===4)&&e.relief!=="cavern"){const H=De().source_resolution(),ne=await mt();if(k&&J&&Q?.delta&&!e.underdark){const W=await He(Q.delta,Q.m,H);for(let V=0;V<H*H;V++)ne[V]+=ne[V]<=0?Math.min(0,W[V]):W[V]}const re=k&&J&&!R&&!M.hydrologyError?Ee:void 0;re&&nn({x:0,y:0,width:e.width,resolution:H,height:ne,minHeight:M.globalMinHeight,maxHeight:M.globalMaxHeight},re);const D=e.underdark?$?await $.physicalCaveField():L.physical_cave_field():void 0,_e=e.underdark?await fn():void 0;return{n:H,data:ne,exact:!re,floor:ee===1?.3:0,cave:D?.length?D:void 0,..._e?.length?{tunnels:_e}:{}}}const de=De().source_resolution(),A=M.physical?.height.slice()??await Br(),G=e.relief!=="cavern"&&!e.underdark?void 0:$?await $.physicalCaveField():L.physical_cave_field(),ce=e.underdark?await fn():void 0;return{n:de,data:A,exact:!1,floor:0,cave:G?.length?G:void 0,...ce?.length?{tunnels:ce}:{}}}n&&await n.before("sampling",`Borne du moteur ${De().max_height.toFixed(2)} m · aperçu ${o.resolution}²`);let qe,or=0,Ke;if(f!=="wasm"&&C&&!$&&!e.underdark){i?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const M=performance.now();try{const k=await j;_&&k&&!_.context.lost&&((!le||er!==f||le.lost)&&(le?.dispose(),le=void 0,le=new Yt(_.context,k.pipeline,f,L),er=f),or=performance.now()-M,i?.(`GPU · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"}),Ke={...await le.sample(o,e,L.min_height,L.max_height),generationMs:performance.now()-F,prepareMs:ge,gpuSetupMs:or,generationBackend:Fe,generationReason:Oe,noiseMs:Ge,erosionMs:Ce,gpuSimulationMs:Pe,nativeEnvironmentMs:se,erosionProfile:be,coastBackend:Qe,coastMs:Se,coastReason:vr}),Ke||(qe="WebGPU indisponible")}catch(k){qe=`GPU indisponible : ${k instanceof Error?k.message:String(k)}`,le?.dispose(),le=void 0,er=void 0}}else $?qe="Native Rust sampling on the local service.":f!=="wasm"&&(qe="terrain currently sampled in WASM");if(Ke)return Le(Ke);i?.(`${$?"Native Rust":"CPU"} · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"});const dr=performance.now(),ye=$?await $.sampleRegion(o.x,o.y,o.extent,o.resolution):L.sample_region(o.x,o.y,o.extent,o.resolution);try{return await Le({x:ye.x,y:ye.y,width:ye.width,resolution:ye.resolution,minHeight:ye.min_height,maxHeight:ye.max_height,globalMinHeight:De().min_height,globalMaxHeight:De().max_height,motifSize:e.motifSize,height:ye.height,caveMask:ye.cave_mask,normalX:ye.normal_x,normalY:ye.normal_y,normalZ:ye.normal_z,generationMs:performance.now()-F,backend:$?"native":"wasm",backendReason:qe,prepareMs:ge,samplingMs:performance.now()-dr,gpuSetupMs:or,generationBackend:Fe,generationReason:Oe,noiseMs:Ge,erosionMs:Ce,gpuSimulationMs:Pe,nativeEnvironmentMs:se,erosionProfile:be,coastBackend:Qe,coastMs:Se,coastReason:vr})}finally{ye.free()}}export{ui as CLIMATE_VALUES,ga as DEFAULT_NEURAL_SERVER,En as DEFAULT_NEURAL_TUNING,va as DEFAULT_PYTHON_SERVER,lr as EROSION_SETTINGS,ma as GEOLOGICAL_RELIEFS,wa as NEURAL_RELIEF_DEFAULTS,Jr as climateOf,$r as isNeuralSource,ya as neuralServerForSource,Sa as releaseTerrainCheckpoints,un as reliefStatistics,_a as sampleRustTerrain};
