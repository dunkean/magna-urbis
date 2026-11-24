import{T as _t,n as Fr,o as tr,p as tt,G as qr,q as mn,t as gn,u as vn,w as te,x as Yn,y as Mt,z as Zr,s as Ye,A as Pt,B as yn,C as vt,D as Ir,E as Tt,F as yt,H as wn,I as Pr,J as Jn,K as _e,L as wt,M as xn,N as Lt,O as Vn,P as Kn,Q as Ot,S as Wr,U as xr,V as Xn,W as Zn,X as Qn,Y as ei,Z as ri,_ as ti,$ as lt,a0 as ni,a1 as ct,a2 as Rr,a3 as Nr,a4 as ii,a5 as Gt,a6 as ai,a7 as bn,a8 as oi,a9 as Ft,aa as It,ab as si,ac as li,ad as ci,ae as ui,af as fi,ag as di,ah as pi,ai as qt,aj as hi,ak as mi,al as gi,am as vi,an as Ht,ao as Dt,ap as yi,aq as wi,ar as xi,as as bi,at as ki,au as Si,av as _i}from"./engine.worker-CjMEt5Fw.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function $t(r,t,i,n){r.set_coast(t,i,JSON.stringify(n))}function jt(r,t,i,n){r.configure_coast(t,i,JSON.stringify(n))}function Mi(r,t,i,n){r.cut_coast(t,i,JSON.stringify(n))}function Pi(r,t,i,n,a,o,l,u,s,e,c,f){return r.cut_field(t,i,n,a,o,l,u,s,e,c,JSON.stringify(f))}let je;const ut=new Map;let xt=Promise.resolve();const bt=new _t;function Qr(r=!1){const t=je;je=void 0,bt.clear(),r||t?.pipeline?.free(),t?.runtime&&(xt=xt.then(async()=>{await Fr(t.runtime,"/terrain/stage",JSON.stringify({session:t.session,command:"cancel"})).catch(()=>{})}))}wn(()=>Qr(!0));async function zi(r,t,i,n,a){t?.backend?.(i?"native":"cpu");const o=tr(r),l=t?.previews!==!1&&o.n<=1024,u=tt(r),s=qr.erosion_at_resolution(r.seed,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix,o.n),e=s.parameters();s.free();const{parameters:c,surface:f}=u?mn(e,r):{parameters:e,surface:e.slice(24,32)};gn(c,f,r,u),vn(f,r,o.n),u&&te(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural?.erosionTuning?.detail===void 0&&(c[16]=e[16]);const d=(S,U=!0)=>Number(te(r,S,U)),w=Uint32Array.from([Number(u),d("regional"),d("regionalFinish"),d("amplitude"),d("ridged",!u),d("surface",!u||r.relief==="canyon"),d("normalize"),+(r.procedural?.regionalThermal!==!1),+(r.procedural?.regionalDiffusion!==!1),r.procedural?.reconstruction==="cubic"?1:r.procedural?.reconstruction==="bspline"?2:0,+(r.relief==="canyon")]);a?.(w[5]&&c[23]>0&&f[3]>0?f[1]:void 0,w[1]&&r.erosion>0?c[4]:void 0);const b=Yn([r.seed,r.width,o.n,c[2],i?.server??"wasm",!!n]);(o.n>1024||je?.root!==b)&&Qr();const k=Mt(r),x=Zr(r),P=k.map(S=>x.get(S));let m=0;for(;je&&m<P.length&&je.keys[m]===P[m];)m++;const g=async S=>{try{return await Fr(i,"/terrain/stage",JSON.stringify({session:je.session,...S}))}catch(U){throw["coast","restore","preview"].includes(S.command)&&U instanceof Error&&U.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):U}},h=r.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([S,U])=>[S,Ye(r.generalSeed,U)])):void 0,p={parameters:Array.from(c),surface:Array.from(f),flags:Array.from(w),stepSeeds:h??{}},R=async S=>{const U=await g(S),j=await U.json();if(h&&Object.values(h).some(W=>W!==r.seed)&&!j.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!je||m===0?(Qr(),i&&!ut.has(i.server)&&ut.set(i.server,Pt()),je={root:b,keys:[],runtime:i,...i?{session:ut.get(i.server)}:{}},await t?.before("grids",`Rust ${i?"natif":"WASM"} · régional ${c[2]}² · surface ${f[0]}² · source ${o.n}² à ${o.spacing.toFixed(2)} m`),i?(await xt,await R({command:"start",seed:r.seed,...p})):je.pipeline=new yn(r.seed,c,f,w),await t?.after("grids")):t?.cached?await t.cached("grids"):(await t?.before("grids"),await t?.after("grids"));const C=je;i||C.pipeline.set_step_seeds(JSON.stringify(h??{}));let E;for(let S=0;S<k.length;S++){const U=k[S],j=S<m;if(!j&&S===m&&S>0&&(i?await R({command:"restore",checkpoint:S-1,...p}):C.pipeline.restore(S-1,c,f,w),C.keys.length=S),j){(l||S===k.length-1)&&(E=i?new Float32Array(await(await g({command:"preview",checkpoint:S})).arrayBuffer()):C.pipeline.checkpoint_height(S)),t?.cached?await t.cached(U,l?E:void 0):(await t?.before(U),await t?.after(U,l?E:void 0));continue}await t?.before(U);const W=U==="coastCut"&&vt(r,"coastCut");if(i){const H=await(await g({command:U==="coastCut"?"coast":"advance",stage:Tt.indexOf(U),checkpoint:S,mask:W?r.coastMask:0,mode:r.islandMode??"island",coastProfile:Ir(r),preview:l||S===k.length-1})).arrayBuffer();H.byteLength&&(E=new Float32Array(H))}else{if(U==="initialize"&&n){const N=await n();C.pipeline.set_noise(N.coarse,N.fine)}U==="coastCut"?W&&Mi(C.pipeline,r.coastMask,r.islandMode??"island",Ir(r)):C.pipeline.advance(Tt.indexOf(U)),C.pipeline.checkpoint(S),(l||S===k.length-1)&&(E=C.pipeline.height())}C.keys[S]=P[S],await t?.after(U,l?E:void 0)}const I=`${b}|${x.get("phasor")}`,_=o.n<=1024?bt.get("phasor",I):void 0;return _?(t?.cached?await t.cached("phasor",l?_:void 0):(await t?.before("phasor"),await t?.after("phasor",_)),_):(await t?.before("phasor"),te(r,"phasor",u)&&(E=yt(E,r)),o.n<=1024&&bt.put("phasor",I,E),await t?.after("phasor",l?E:void 0),E)}const Ui=`
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
}`,Wt=new WeakMap;function Ci(r,t,i){if(!i.iterations||!i.transport)return r;const n=r.slice(),a=Math.sqrt(n.length),o=t/a,l=new Float32Array(n.length),u=i.azimuth*Math.PI/180,s=Math.cos(u),e=Math.sin(u),c=s>=0?1:-1,f=e>=0?1:-1,d=Math.abs(s)/(Math.abs(s)+Math.abs(e)),w=1-d;for(let b=0;b<i.iterations;b++){l.fill(0);for(let k=1;k<a-1;k++)for(let x=1;x<a-1;x++){const P=k*a+x;if(n[P]<=.3)continue;const m=((n[P+1]-n[P-1])*s+(n[P+a]-n[P-a])*e)/(2*o),g=.75+.25*Math.sin((x*s+k*e)*o/64+n[P]*.03);l[P]=Math.min(Math.max(0,n[P]-.3),i.transport*Math.max(.1,Math.min(1,.55+2*m))*g)}for(let k=0;k<a;k++)for(let x=0;x<a;x++){const P=k*a+x,m=k*a+Math.max(0,Math.min(a-1,x-c)),g=Math.max(0,Math.min(a-1,k-f))*a+x;n[P]=n[P]-l[P]+(m!==P?l[m]*d:0)+(g!==P?l[g]*w:0)}}return n}async function Ai(r,t,i,n){if(!n.iterations||!n.transport)return t;const a=r.device,o=Math.sqrt(t.length);let l=Wt.get(a);l||(l=(async()=>{const d=a.createShaderModule({code:Ui}),b=(await d.getCompilationInfo()).messages.filter(g=>g.type==="error");if(b.length)throw new Error(b.map(g=>`${g.lineNum}: ${g.message}`).join(`
`));const k=a.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),x=a.createPipelineLayout({bindGroupLayouts:[k]}),[P,m]=await Promise.all(["entrain","deposit"].map(g=>a.createComputePipelineAsync({layout:x,compute:{module:d,entryPoint:g}})));return{layout:k,a:P,b:m}})(),Wt.set(a,l));const{layout:u,a:s,b:e}=await l,c=[],f=(d,w)=>{const b=a.createBuffer({size:d,usage:w});return c.push(b),b};try{const d=f(t.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),w=f(t.byteLength,GPUBufferUsage.STORAGE),b=f(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),k=f(t.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);a.queue.writeBuffer(d,0,t);const x=new ArrayBuffer(48),P=new Float32Array(x);new Uint32Array(x)[0]=o;const m=n.azimuth*Math.PI/180;P[1]=i/o,P[2]=Math.cos(m),P[3]=Math.sin(m),P[4]=n.transport,a.queue.writeBuffer(b,0,x);const g=a.createBindGroup({layout:u,entries:[d,w,b].map((_,S)=>({binding:S,resource:{buffer:_}}))}),h=Math.ceil(t.length/256),p=Math.ceil(h/a.limits.maxComputeWorkgroupsPerDimension),R=Math.ceil(h/p),C=a.createCommandEncoder(),E=C.beginComputePass();E.setBindGroup(0,g);for(let _=0;_<n.iterations;_++)E.setPipeline(s),E.dispatchWorkgroups(R,p),E.setPipeline(e),E.dispatchWorkgroups(R,p);E.end(),C.copyBufferToBuffer(d,0,k,0,t.byteLength),a.queue.submit([C.finish()]),await k.mapAsync(GPUMapMode.READ);const I=new Float32Array(k.getMappedRange()).slice();return k.unmap(),I}finally{c.forEach(d=>d.destroy())}}var Ei=`// FP32 sampling of the retained Rust erosion field.\r
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
`,zt=`// Shared FP32 simplex and FBM kernels.\r
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
`,Ri=`// Same noise octaves and physical wavelengths as erosion::mountain.\r
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
`,kn=`// Seeded finite volcanic geometry. Shared by generation and camera sampling.\r
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
`,Ni=`// The dedicated third simplex stream matches Rust's shore-noise fork.\r
// Sixteen header vec4s (profile, smoothing and natural slope, cliff and shore cut, character, six bumps, then the\r
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
// As Rust \`relief_rank\`, \`rise\` and \`cliff\`.\r
fn coastRank(height:f32)->f32 {let fit=coast[14];return tanh(clamp((height-fit.y)*fit.z,-9.0,9.0));}\r
fn coastRise(x:f32,toe:f32)->f32 {let t=clamp(x,0.0,1.0);return t*t*(3.0-2.0*t)+toe*t*(1.0-t)*(1.0-t);}\r
fn coastCliff(gentle:f32,islet:f32,width:f32)->f32 {\r
  var limit=min(coast[2].x,width*0.004);\r
  if(islet>0.0){limit=min(limit,islet*0.04);}\r
  return limit*smooth01((0.28-gentle)/0.2);\r
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
  // Stretches of coast, as Rust \`gentleness\`.\r
  let gentle=smooth01(fbm(uv/0.21+vec2<f32>(11.7,-4.2),2u,3u,0.5,0.0)+0.5);\r
  // Seeded bays and headlands, as in Rust; islets keep their own outline.\r
  if(isletHeight==0.0){\r
    for(var k=0u;k<min(u32(coast[7].z),6u);k++){\r
      let bump=coast[8u+k];let d2=dot(uv-bump.xy,uv-bump.xy)/(bump.z*bump.z);\r
      if(d2<1.0){distance+=bump.w*(1.0-d2)*(1.0-d2);}\r
    }\r
    // Fitted shift and relief drowning, as Rust \`Coast::distance\`.\r
    let fit=coast[14];distance+=fit.x;\r
    distance+=fit.w*coastRank(height)*smooth01(1.0-abs(distance)/coast[15].x);\r
    // Fractal cut near the shoreline, as Rust \`shore_cut\`.\r
    let near=1.0-abs(distance)/0.03;\r
    if(near>0.0){distance+=coast[2].y*(1.15-gentle)*smooth01(near)*fbm(uv/0.012+vec2<f32>(31.7,-8.3),2u,4u,0.6,footprint/0.012);}\r
  }\r
  let width=p.values[0].x;\r
  let islet=isletHeight>0.0;\r
  if(islet){height=isletHeight;}\r
  if(distance<=0.0){\r
    let ramp=max(min(max(config.z,height/(width*0.45)),scale*0.18),config.w/width);\r
    return -config.w*coastRise(-distance/(4.0*ramp*apron*coast[15].y*(0.65+1.1*gentle)),0.5);\r
  }\r
  // Smooth low-frequency stretches of variable width, matching Rust smoothing_width.\r
  let metres=distance*width;let profile=coast[1];\r
  let isletSize=select(0.0,scale*width,islet);\r
  let cliff=coastCliff(gentle,isletSize,width);\r
  var band=profile.x;\r
  if(profile.y>0.0){band*=1.0+profile.y*coastWidthWave(xy);}\r
  band=min(band,width*0.12)*(1.0-0.85*smooth01(cliff/20.0));\r
  var ground=height;\r
  if(band>0.0){ground*=coastRise(metres/band,0.3);}\r
  if(ground<=0.0){return ground;}\r
  // Natural height limit behind the shore, as Rust \`ceiling\`.\r
  var rank=0.0;\r
  if(!islet){rank=coastRank(height);}\r
  let steep=1.0-gentle;\r
  let tilt=clamp(sqrt(250.0/max(profile.x,40.0)),0.5,1.6);\r
  let slope=profile.z*(0.65+0.7*steep)*tilt*(1.0+0.35*rank)/sqrt(apron);\r
  let beach=0.25+0.75*steep;\r
  let ease=beach+(1.0-beach)*metres/(metres+min(width*0.012,120.0));\r
  let limit=cliff*smooth01(metres/(1.0+0.6*cliff))+slope*metres*ease;\r
  let low=min(ground,limit);let ratio=low/max(ground,limit);let square=ratio*ratio;\r
  return low/sqrt(sqrt(1.0+square*square));\r
}\r
`;let ft;const Bi=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Ut(){return ft??=(async()=>{const r=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!r)return;const{maxBufferSize:t,maxStorageBufferBindingSize:i}=r.limits,n=await r.requestDevice({requiredFeatures:r.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:t,maxStorageBufferBindingSize:i}}),a={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{a.lost=!0,ft=void 0}),a})().catch(()=>{}),ft}async function Ti(r,t){if(r==="wasm")return;const i=await Ut();if(!i||i.lost)return;const n=t==="flat"?0:t==="valley"?2:t==="volcano"||t==="caldera"||t==="plateau"?3:1,a=`${r}:${n}`;let o=i.pipelines.get(a);return o||(o=(async()=>{const l=Ei.replace("// NOISE_KERNEL",zt).replace("// VOLCANIC_KERNEL",kn).replace("// COAST_KERNEL",Ni),u=i.device.createShaderModule({code:l});return i.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),o.catch(()=>{}),i.pipelines.set(a,o)),{context:i,pipeline:o}}const Li=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Yt(r,t,i){const n=r.device,a=tr(t).n,o=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),l=t.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=l.map(c=>{const f=`generation:${c}`;let d=r.pipelines.get(f);if(!d){const w=n.createShaderModule({code:Ri.replace("// NOISE_KERNEL",zt)});d=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[o]}),compute:{module:w,entryPoint:c}}),r.pipelines.set(f,d)}return d}),s=qr.generation_at_resolution(t.seed,t.width,t.relief,t.motifSize,a),e=[];try{const c=s.parameters();t.procedural?.regionalN&&(c[2]=t.procedural.regionalN,c[4]=t.width*1.44/c[2]),c[6]*=t.procedural?.noiseScale??1;const f=(m,g)=>{const h=n.createBuffer({size:m.byteLength,usage:g|GPUBufferUsage.COPY_DST});return e.push(h),n.queue.writeBuffer(h,0,m),h},d=[f(c,GPUBufferUsage.UNIFORM),f(s.permutations(),GPUBufferUsage.STORAGE),f(s.gradients(),GPUBufferUsage.STORAGE)];i?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const w=await Pr(Promise.all(u));i?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const k=l.map(m=>m==="coarse"?c[2]:c[1]).map((m,g)=>{const h=m*m*16,p=n.createBuffer({size:h,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),R=n.createBuffer({size:h,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});e.push(p,R);const C=n.createBindGroup({layout:w[g].getBindGroupLayout(0),entries:[...d,p].map((_,S)=>({binding:S,resource:{buffer:_}}))}),E=n.createCommandEncoder(),I=E.beginComputePass();return I.setPipeline(w[g]),I.setBindGroup(0,C),I.dispatchWorkgroups(Math.ceil(m/8),Math.ceil(m/8)),I.end(),E.copyBufferToBuffer(p,0,R,0,h),n.queue.submit([E.finish()]),R}),x=n.queue.onSubmittedWorkDone().then(()=>i?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),P=await Promise.all(k.map(async m=>{await m.mapAsync(GPUMapMode.READ);const g=new Float32Array(m.getMappedRange().slice(0));return m.unmap(),g}));return await x,{coarse:l.length===2?P[0]:new Float32Array,fine:P[P.length-1]}}finally{s.free(),e.forEach(c=>c.destroy())}}class Jt{constructor(t,i,n,a){this.state=t,this.pipeline=i,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=a.sampling_parameters(),this.sourceN=a.source_resolution();let o=0;for(let e=this.sourceN;e>=1;e=Math.floor(e/2))o+=e*e;const l=this.parameters[5]===3?2:1;if(o*l*4>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=a.sampling_field();this.hasField=u.length>0;const s=u.length?u:new Float32Array(1);if(s.byteLength>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(s),this.perm=this.upload(a.sampling_permutations()),this.gradients=this.upload(a.sampling_gradients()),this.branches=this.upload(a.sampling_branches()),this.coast=this.upload(a.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(t,i=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,t.byteLength),usage:i|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,t),n}prepareCoastField(t){return this.dispatchField({x:0,y:0,extent:t.width,resolution:this.sourceN},t),this.output}dispatchField(t,i){const{x:n,y:a,extent:o,resolution:l}=t;if(![n,a,o,l].every(Number.isFinite)||n<0||a<0||o<=0||n+o>i.width+1e-4||a+o>i.width+1e-4||!Number.isInteger(l)||l<16||l>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,s=o/l,e=Math.max(i.motifSize/65536,s*.5),c=this.parameters,f=Math.floor(Math.log2(this.sourceN)),d=Math.min(f,Math.log2(Math.max(1,s*(i.relief==="flat"&&c[5]!==4?2/i.motifSize:1/i.width)*this.sourceN))),w=new Float32Array([c[0],c[1],c[2],c[3],c[4],c[5],this.hasField?1:0,l,n,a,o,s,Math.floor(d),Math.min(f,Math.floor(d)+1),d-Math.floor(d),e,c[6],c[7],this.sourceN,f,...Array.from({length:16},(P,m)=>c[8+m]??0)]),b=l*l*16;b>this.capacity&&(this.output?.destroy(),this.capacity=b,this.output=u.createBuffer({size:b,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((P,m)=>({binding:m,resource:{buffer:P}}))})),u.queue.writeBuffer(this.uniform,0,w);const k=u.createCommandEncoder(),x=k.beginComputePass();x.setPipeline(this.pipeline),x.setBindGroup(0,this.group),x.dispatchWorkgroups(Math.ceil(l/8),Math.ceil(l/8)),x.end(),u.queue.submit([k.finish()])}async sample(t,i,n,a){const o=performance.now(),l=this.state.device,{x:u,y:s,extent:e,resolution:c}=t;this.dispatchField(t,i);const f=c*c*16,d=l.createCommandEncoder();(!this.readback||this.readback.size<f)&&(this.readback?.destroy(),this.readback=l.createBuffer({size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),d.copyBufferToBuffer(this.output,0,this.readback,0,f),l.queue.submit([d.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,f);const w=this.readback.getMappedRange(0,f).slice(0);this.readback.unmap();const b=new Float32Array(w),k=new Float32Array(c*c),x=new Float32Array(c*c),P=new Float32Array(c*c),m=new Float32Array(c*c);let g=1/0,h=-1/0;for(let p=0;p<c*c;p++){const R=p*4;k[p]=b[R],x[p]=b[R+1],P[p]=b[R+2],m[p]=b[R+3],g=Math.min(g,k[p]),h=Math.max(h,k[p])}if(!Number.isFinite(g)||!Number.isFinite(h))throw new Error("Sortie GPU non finie.");return{x:u,y:s,width:e,resolution:c,minHeight:g,maxHeight:h,globalMinHeight:n,globalMaxHeight:a,motifSize:i.motifSize,height:k,normalX:x,normalY:P,normalZ:m,caveMask:new Uint8Array,generationMs:performance.now()-o,backend:this.mode,samplingMs:performance.now()-o}}dispose(){this.buffers.forEach(t=>t.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}var Oi=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`,Fi=`// Full FP32 regional erosion. Dispatches are global synchronization boundaries.\r
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
`;const br=new WeakMap,Yr=new WeakMap,et=new Set;function Or(r){r.nodes?.destroy(),r.fine?.destroy(),r.control.destroy()}function Ii(){for(const r of et)br.get(r)?.forEach(Or),br.delete(r),Yr.delete(r);et.clear()}const Vt=new WeakMap,dt=new WeakMap,Kt=new WeakMap,Xt=new WeakMap,Sn=new WeakSet,qi=512*1048576,Zt=1024,Hi=1088,pt=Hi+4096;function _n(r,t){const i=(Kt.get(r.device)??Promise.resolve()).then(t);return Kt.set(r.device,i.then(()=>{},()=>{})),i}async function Di(r,t,i,n){let a=Vt.get(r);a||(a=(async()=>{const e=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(b=>({binding:b,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(b=>({binding:b,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),c=r.createShaderModule({code:Fi.replace("// NOISE_KERNEL",zt).replace("// VOLCANIC_KERNEL",kn)+Oi+Gi}),d=(await Pr(c.getCompilationInfo())).messages.filter(b=>b.type==="error");if(d.length)throw new Error(d.map(b=>`${b.lineNum}: ${b.message}`).join(`
`));const w=r.createPipelineLayout({bindGroupLayouts:[e]});return{layout:e,module:c,pipelineLayout:w,values:new Map,pending:new Map}})(),Vt.set(r,a)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const o=await Pr(a),l=[],u=[...t].reduce((e,c)=>e+(c==="solveTile"?i.size:1),0);let s=0;for(const e of t)for(const c of e==="solveTile"?i:[void 0]){const f=c===void 0?e:`solveTile:${c}`;let d=o.pending.get(f);d||(d=r.createComputePipelineAsync({layout:o.pipelineLayout,compute:{module:o.module,entryPoint:e,...c===void 0?{}:{constants:{SOLVE_MODE:c}}}}),d=d.then(w=>(o.values.set(f,w),w)),o.pending.set(f,d)),l.push(d.then(w=>(s++,n?.(`GPU · shaders d’érosion prêts ${s}/${u}`,{stage:"gpu-erosion-compile",completed:s,total:u}),w)))}return await Pr(Promise.all(l)),Sn.add(r),o}class Gr extends Error{}class $i extends Error{}function Mn(r,t,i,n,a){const o=qr.erosion_at_resolution(r.seed,r.width,i,r.erosion,r.motifSize,r.mountainMix,t);try{const l=o.parameters(),u=n?mn(l,r,a):{parameters:l,surface:(a??l.slice(24,32)).slice()};return gn(u.parameters,u.surface,r,n,!!a),vn(u.surface,r,t),{noise:o,parameters:u.parameters,surface:u.surface,original:l}}catch(l){throw o.free(),l}}const ji=["hills","mountains","mixed","high-mountains","valley","canyon"];function Wi(r,t){const i=tr(t).n,n=tt(t),a=ji.includes(t.relief)?t.relief:t.relief==="flat"?"hills":"mixed",{noise:o,parameters:l,surface:u}=Mn(t,i,a,n);o.free();const s=l[2],e=u[0],c=u[3],f=Jn(r.device.limits,i,Math.max(s,t.erosion>0&&(!n||c>0)?e:0));return{sourceN:i,regionalN:s,regionalSteps:l[13],surfaceN:e,surfaceSteps:c,pipelinesReady:Sn.has(r.device),error:f}}async function Yi(r,t,i,n,a){return _n(r,()=>Ji(r,t,i,n,a))}async function Ji(r,t,i,n,a){const o=tr(t).n;for(const l of[1,2,4,8,16])try{return await Pn(r,t,o,l,void 0,{source:i,tuning:n},void 0,a)}catch(u){if(!(u instanceof Gr)||l===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function Qt(r,t,i,n){return i?.control?.backend?.("gpu"),_n(r,()=>Vi(r,t,i,n))}async function Vi(r,t,i,n){const a=tr(t).n;if(t.relief==="volcano"||t.relief==="caldera"||t.relief==="plateau"){const o=qr.finite_shape(t.seed,t.motifSize,t.relief,t.erosion),l=o.parameters();o.free();const u=t.environment??"mixed",s=t.motifSize*l[15];let e;if(u==="flat"){const d=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),e=_e.prepare_environment_at_resolution(t.seed,t.width,u,t.erosion,s,a),i&&(i.nativeEnvironmentMs=performance.now()-d)}else e=await ht(r,{...t,motifSize:s,relief:u,mountainMix:.5},a,void 0,i,n);const c=await ht(r,{...t,width:t.motifSize},a,l,i,n),f=new Float32Array(c.length+e.length);return f.set(c),f.set(e,c.length),f}return ht(r,t,a,void 0,i,n)}async function ht(r,t,i,n,a,o){for(const l of[1,2,4,8,16])try{return await Pn(r,t,i,l,n,void 0,a,o)}catch(u){if(!(u instanceof Gr)||l===16)throw u}throw new Error("Érosion GPU non convergée.")}async function Pn(r,t,i,n,a,o,l,u){const s=r.device,e=o?void 0:l?.control,c=tt(t),f=!!t.generalSeed&&wt(t.generalSeed,h=>h.startsWith("relief-"))!==xn(t.generalSeed),{noise:d,parameters:w,surface:b,original:k}=Mn(t,i,o||c&&t.relief==="flat"?"hills":a?"mixed":t.relief,c,o?.tuning);let x=dt.get(s);if(!x){x=[],dt.set(s,x);const h=x;s.lost.then(()=>h.forEach(p=>p.destroy()))}const P=!!e&&e.previews!==!1&&i<=Zt;let m=!!e&&e.previews!==!1,g=0;try{c&&t.procedural&&te(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural.erosionTuning?.detail===void 0&&(w[16]=k[16]);const h=w.slice(0,24),p=h[2],R=h[13],C=h[18],E=o?[1,0,0,.2,1,1,0,0]:Array.from(w.slice(33,41)),I=E.slice();I[4]=1;const _=!o&&E[6]>.5,S=Math.min(n,4),U=h.slice();U[2]=b[0],U[4]=b[1],U[5]=b[2],U[15]=a&&!o?a[13]:b[4],U[18]=b[5],U[22]=b[6];const j=Math.max(1,U[2]/1048),W=Math.ceil(Math.min((a||o||t.relief==="mixed"?64:32)*n,512)*j),N=!o&&te(t,"phasor",c)?"generationPhasorPack":"packHeight",H=c?"compactInitialize":"initialize",Q=!!o||te(t,"surface",!c||t.relief==="canyon")&&(!c||t.relief==="canyon"||b[3]>0),ge=()=>{o||l?.onPhysicalPlan?.(t.erosion>0&&Q&&b[3]>0?b[1]:void 0,!a&&t.erosion>0&&(te(t,"regional")||te(t,"regionalFinish"))?h[4]:void 0)},V=t.procedural?.reconstruction&&t.procedural.reconstruction!=="default"?"generationReconstruct":c?"compactReconstruct":"reconstruct",ve=new Set([N,...te(t,"amplitude")?[]:["generationUnitScale"],...te(t,"normalize")?[]:["generationKeepDatum"],...e?["generationPreview"]:[],...!o&&!a&&t.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),K=new Set,ie=(...v)=>v.forEach(z=>ve.add(z));f&&!o&&!a&&ie("generationCut","generationRegionalRead","generationPreview"),(o||!a&&(f||t.procedural))&&ie("seaLandMark","seaMaskGrow");const Ue=()=>ie("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");o?ie("coastLoad","coastResult"):ie("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!o&&!a?(ie(H,"uplift","bounds",V,"detail"),C>0&&(Ue(),ie("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(v=>K.add(v)))):a&&!o&&ie("volcanicInitial"),t.erosion>0&&Q&&(Ue(),ie("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),K.add(1),K.add(3),t.relief==="canyon"&&!o&&(ie("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),K.add(0)),_&&(ie("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),K.add(0))),e&&await e.before("grids",`Budget ×${n} · régional ${p}² · surface ${U[2]}² · sortie ${i}²`);const Ce=performance.now(),fe=await Di(s,ve,K,u),Ne=performance.now()-Ce,Ae=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let Pe=!1;const de=(v,z)=>{const T=g++;let L=x[T];return(!L||L.size<v||L.usage!==z)&&(L?.destroy(),L=s.createBuffer({size:v,usage:z}),x[T]=L,Pe=!0),L},we=v=>{const z=de(v.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return s.queue.writeBuffer(z,0,v),z},ze=t.erosion>0&&Q?Math.max(p,U[2]):p,xe=i**2,ye=xe*4,se=xe*16,Fe=Math.max(xe,p*p)*4;s.pushErrorScope("out-of-memory");const he=de(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),Ie=de(ze**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),qe=de(se,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ee=de(pt,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Le=de(Fe,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),me=de(Fe+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),nr=de(Math.ceil(ze/16)**2*8,GPUBufferUsage.STORAGE),Je=s.popErrorScope();if(Pe&&await Je)throw m=!0,new $i(`WebGPU : mémoire insuffisante pour la source ${i}² et la grille d’érosion ${ze}².`);m||=x.reduce((v,z)=>v+z.size,0)>qi;const ir=v=>me.mapAsync(GPUMapMode.READ,0,v),Ve=v=>me.getMappedRange(0,v),pr=!o&&!a&&!!(t.procedural||f),be=pr&&i<=Zt,M=P||pr;let y=M?void 0:Xt.get(s);if(!M&&!y&&s.features.has("timestamp-query")){y=s.createQuerySet({type:"timestamp",count:6}),Xt.set(s,y);const v=y;s.lost.then(()=>v.destroy())}const B=y?de(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,X=y?de(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,J=(v,z)=>s.createBindGroup({layout:fe.layout,entries:[{binding:0,resource:{buffer:he,size:224}},...[we(v),we(z),Ie,qe,Ee,Le,nr].map((T,L)=>({binding:L+1,resource:{buffer:T}}))]});let le=J(d.permutations(),d.gradients());const A=new Map([[t.seed,le]]),q=v=>{const z={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[v];if(!z||!t.generalSeed)return;const T=Ye(t.generalSeed,z);let L=A.get(T);if(!L){const ue=qr.erosion(T,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix);try{L=J(ue.permutations(),ue.gradients())}finally{ue.free()}A.set(T,L)}le=L},ae=new Map;let D=E;const ne=(v,z)=>{const T=[...z,...v,...D].join(",");let L=ae.get(T);if(L===void 0){if(L=ae.size*256,L+224>65536)throw new Error("Too many GPU variants.");ae.set(T,L),s.queue.writeBuffer(he,L,new Float32Array([...z,...v,...c?Lt(t,!!o):!a&&!o&&te(t,"phasor",!1)?Lt(t):a??new Float32Array(16),...D]))}return L};let G=s.createCommandEncoder();G.clearBuffer(Ee),o&&G.copyBufferToBuffer(o.source,0,qe,0,se);const re=v=>G.beginComputePass(y?{timestampWrites:{querySet:y,beginningOfPassWriteIndex:v,endOfPassWriteIndex:v+1}}:void 0);let Z=re(0);const Y=[0,0,1,0,0,0,.6,0];Y[4]=w[32];const ce=[0,0,.95,C*.5,0,0,.5,0];let pe=h;const O=(v,z=Y,T=Math.ceil(pe[2]**2/256),L=1)=>{Z.setPipeline(fe.values.get(v==="solveTile"?`solveTile:${z[1]}`:v)),Z.setBindGroup(0,le,[ne(z,pe)]),Z.dispatchWorkgroups(T,L)},Ke=Math.ceil(xe/256),hr=Math.ceil(Ke/s.limits.maxComputeWorkgroupsPerDimension),ke=(v,z=Y)=>O(v,z,Math.ceil(Ke/hr),hr),Xe=(v,z,T=!1)=>{const L=Y.slice();L[1]=v,L[7]=T?1:0,O(v===0?"floodInit":"graphInit",L),O("start",L,1);const ue=[0,1].map(Se=>(L[0]=Se,ne(L,pe)));for(let Se=0;Se<z;Se++){const lr=[ue[Se&1]];Z.setPipeline(fe.values.get("clearNext")),Z.setBindGroup(0,le,lr),Z.dispatchWorkgroups(1),Z.setPipeline(fe.values.get(`solveTile:${v}`)),Z.dispatchWorkgroups(Math.ceil(pe[2]/16),Math.ceil(pe[2]/16))}L[0]=0,O("solveStats",L,1),v===0?(O("floodCheck",L,1),O("receivers")):O("graphFinish",L)},nt=(v=Y,z=!0)=>{O("pitInit");for(let T=0;T<8*S+Math.ceil(Math.log2(Math.max(1,pe[2]/1048)));T++)O("pitUnion"),O("pitCompress");for(const T of z?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])O(T,v)},it=v=>{if(v<=0)return;const z=Y.slice();z[6]=v,O("breachInit"),O("breach",z),O("breachFinish")},at=(v,z=Y)=>{if(!(pe===h&&t.procedural?.regionalThermal===!1))for(let T=0;T<v;T++)for(const L of["thermalFlux","thermalApply","copyHeight"])O(L,z)},Hr=(v,z=Y)=>{if(pe===h&&t.procedural?.regionalDiffusion===!1)return;const T=z.slice();T[3]=v,O("diffuse",T),O("copyHeight",T)},Et=v=>{const z=Vn(Kn({surfaceSteps:b[3],surfaceCell:b[1],regionalCell:h[4],sourceCell:h[11],warp:E[5]*Math.min(16*h[3],h[4]*.9)}),t.width);if(z===void 0)return;const T=Y.slice();T[7]=v,v===0?O("seaLandMark",T):ke("seaLandMark",T),T[5]=z,O("seaMaskGrow",T,2)},Rt=v=>{const z=Y.slice();z[4]=v,O("percentileInit",z,1);for(const T of[24,16,8,0])z[5]=T,O("histogramClear",z,1),ke("histogram",z),O("percentileSelect",z,1)},Nt=async(v,z,T)=>{if(!e)return;if(!P){await e.after(v,void 0,T);return}if(z!==3){const lr=Y.slice();lr[7]=z,ke("generationPreview",lr)}Z.end(),G.copyBufferToBuffer(Le,0,me,0,ye),G.copyBufferToBuffer(Ee,0,me,ye,1088),s.queue.submit([G.finish()]),await ir(ye+1088);const L=Ve(ye+1088),ue=new Uint32Array(L,ye,272)[2],Se=new Float32Array(L,0,xe).slice();if(me.unmap(),ue)throw new Gr("Érosion GPU non convergée pendant une étape.");if(!Se.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await e.after(v,Se,T),G=s.createCommandEncoder(),Z=re(0)},mr=Mt(t),Bn=Zr(t);let Be=be?br.get(s):void 0;if(be&&!Be){Be=new Map,br.set(s,Be),et.add(s);const v=Be;s.lost.then(()=>{v.forEach(Or),v.clear(),et.delete(s)})}const zr=v=>`${n}|${Bn.get(v)}`;let ar=0;for(;Be&&ar<mr.length&&Be.get(mr[ar])?.key===zr(mr[ar]);)ar++;if(Be)for(const v of[...mr.slice(ar),"phasor"]){const z=Be.get(v);z&&(v!=="phasor"||z.key!==zr(v)||ar<mr.length)&&(Or(z),Be.delete(v))}const Tn=v=>{Z.end(),v.nodes&&G.copyBufferToBuffer(v.nodes,0,Ie,0,v.nodes.size),v.fine&&G.copyBufferToBuffer(v.fine,0,qe,0,v.fine.size),G.copyBufferToBuffer(v.control,0,Ee,0,pt),Z=re(0)},Ln=(v,z)=>{if(!Be)return;Z.end();const T=(ue,Se=ue.size)=>{const lr=s.createBuffer({size:Se,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return G.copyBufferToBuffer(ue,0,lr,0,Se),lr},L=Be.get(v);L&&Or(L),Be.set(v,{key:zr(v),kind:z,...z===0?{nodes:T(Ie,p*p*112)}:{fine:T(qe,se)},control:T(Ee,pt)}),s.queue.submit([G.finish()]),G=s.createCommandEncoder(),Z=re(0)},On=async(v,z)=>{if(!e)return;if(!P){e.cached?await e.cached(v):(await e.before(v),await e.after(v));return}const T=Y.slice();T[7]=z.kind,ke("generationPreview",T),Z.end(),G.copyBufferToBuffer(Le,0,me,0,ye),s.queue.submit([G.finish()]),await ir(ye);const L=new Float32Array(Ve(ye),0,xe).slice();me.unmap(),e.cached?await e.cached(v,L):(await e.before(v),await e.after(v,L)),G=s.createCommandEncoder(),Z=re(0)},Ze=async(v,z,T)=>{const L=mr.indexOf(v),ue=Be?.get(v);if(ue&&L>=0&&L<ar){(P||L===ar-1)&&Tn(ue),await On(v,ue);return}await e?.before(v),q(v),await T(),Ln(v,z),await Nt(v,z)},Gn=t.procedural?.coastAfter??"initialize",gr=async(v,z)=>{!pr||v!==Gn||await Ze("coastCut",z===4?5:z,async()=>{if(!vt(t,"coastCut"))return;const T=Y.slice();T[7]=z,z===0?O("generationRegionalRead",T,Math.ceil(p*p/256)):ke("generationPreview",T),Z.end();const L=z===0?p*p:xe;G.copyBufferToBuffer(Le,0,me,0,L*4),s.queue.submit([G.finish()]),await ir(L*4);const ue=new Float32Array(Ve(L*4),0,L).slice();me.unmap();const Se=Pi(yn,Ye(t.generalSeed??t.seed,"relief-coast-cut"),t.width,w[3]*2400,w[12],t.coastMask,t.islandMode??"island",z===0?p:i,z===0?h[5]:0,z===0?h[4]:h[11],ue,Ir(t));s.queue.writeBuffer(Le,0,Se),G=s.createCommandEncoder(),Z=re(0),z===0?O("generationCut",T,Math.ceil(p*p/256)):ke("generationCut",T),Et(z)})};e&&await e.after("grids",void 0,`Budget ×${n} · régional ${p}² · surface ${U[2]}² · ${(x.reduce((v,z)=>v+z.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${R} cycles de relief et ${b[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),o?(pe=U,ke("coastLoad"),Et(2)):a?(e&&await e.before("initialize"),pe=U,ke("volcanicInitial"),e&&await Nt("initialize",2)):(await Ze("initialize",0,()=>{O(H)}),await gr("initialize",0),await Ze("regional",0,()=>{for(let v=0;v<(te(t,"regional")?R:0);v++){if(O("uplift"),C>0){Xe(0,64*S),nt(),O("flow"),it(E[1]),Xe(1,128*S),Xe(2,128*S),at(3);const z=h[17]*3*C;for(let T=0;T<Math.floor(z);T++)Hr(.5);z%1>0&&Hr(.5*(z%1))}O("bounds")}}),await Ze("regionalFinish",0,()=>{const v=Y.slice();if(v[7]=1,O("bounds",v),C>0&&te(t,"regionalFinish")){at(4,ce);for(let z=0;z<6;z++)Xe(0,64*S),nt(ce),O("flow"),it(E[2]);Hr(C*.5,ce)}}),await gr("regionalFinish",0),await Ze("reconstruct",1,()=>{const v=Y.slice();v[7]=t.procedural?.reconstruction==="bspline"?1:0,ke(V,v)}),await Ze("amplitude",4,()=>{te(t,"amplitude")?Rt(0):O("generationUnitScale",Y,1)}),await gr("amplitude",4),await Ze("ridged",2,()=>{ke("detail")}),await gr("ridged",2)),Z.end(),Z=re(2),await Ze("surface",2,()=>{if(t.erosion>0&&Q){if(pe=U,D=I,O("surfaceLoad"),t.relief==="canyon"&&!o){const v=Math.ceil(128*S*j);Xe(0,v),O("flow"),Xe(1,v),O("canyonSeed");let z=0;const T=[];for(let ue=2**(Math.ceil(Math.log2(U[2]))-1);ue>=1;ue/=2)T.push(ue);T.push(1,1);for(const ue of T){const Se=Y.slice();Se[0]=z,Se[1]=ue,O("canyonSpread",Se),z=1-z}const L=Y.slice();L[0]=z,O("canyonApply",L)}for(let v=0;v<b[3];v++)_?(Xe(0,W),nt(Y,!1),O("flow"),it(E[7])):(O("surfaceFlowInit"),O("receivers"),O("flow")),Xe(1,W,!0),Xe(3,W,!0),at(1),Hr(b[7]);O("surfaceDelta"),ke("surfaceReconstruct")}}),await gr("surface",2),Z.end(),Z=re(4),await Ze("normalize",1,()=>{o?ke("coastResult"):te(t,"normalize")?(Rt(1),ke("normalize")):ke("generationKeepDatum")}),await gr("normalize",1);let Ur=Yr.get(s);Ur||(Ur=new _t,Yr.set(s,Ur));const Cr=be?Ur.get("phasor",zr("phasor")):void 0;if(Cr)return Z.end(),s.queue.submit([G.finish()]),e?.cached?await e.cached("phasor",P?Cr:void 0):(await e?.before("phasor"),await e?.after("phasor",Cr)),ge(),Cr;Cr||await e?.before("phasor"),ke(N),Z.end();const Ar=ye;G.copyBufferToBuffer(Le,0,me,0,Ar),G.copyBufferToBuffer(Ee,0,me,Ar,1088),y&&B&&X&&(G.resolveQuerySet(y,0,6,B,0),G.copyBufferToBuffer(B,0,X,0,48));const Fn=G.finish(),In=performance.now()-Ae;u?.(o?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const qn=performance.now();s.queue.submit([Fn]);const Hn=s.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([ir(Ar+1088),X?.mapAsync(GPUMapMode.READ),Hn]);const Dn=performance.now()-qn,$n=performance.now(),Bt=Ve(Ar+1088),ot=new Uint32Array(Bt,Ar,272),jn=Array.from(ot.slice(267,271)),st={factor:n,sourceSize:i,coarseSize:p,surfaceSize:U[2],pipelineMs:Ne,encodeMs:In,submitReadbackMs:Dn,unpackMs:0,maxSolveSteps:jn,allocatedBytes:x.reduce((v,z)=>v+z.size,0)};if(X){const v=new BigUint64Array(X.getMappedRange());st.gpuStagesMs={coarse:Number(v[1]-v[0])/1e6,surface:Number(v[3]-v[2])/1e6,normalization:Number(v[5]-v[4])/1e6},X.unmap()}if(l&&(l.profiles??=[]).push(st),ot[2]!==0)throw me.unmap(),new Gr(`Érosion GPU non convergée (${ot[2]} cellules/étapes, budget ×${n}).`);const Er=new Float32Array(Bt,0,xe).slice();me.unmap(),st.unpackMs=performance.now()-$n;const Wn=o||pr&&vt(t,"coastCut")?-1/0:.3-1e-7;for(let v=0;v<xe;v++)if(!Number.isFinite(Er[v])||Er[v]<Wn)throw new Error("Champ GPU invalide.");return ge(),be&&Ur.put("phasor",zr("phasor"),Er),e&&await e.after("phasor",P?Er:void 0,"Sortie GPU lue et validée"),Er}catch(h){throw h instanceof Gr&&(br.get(s)?.forEach(Or),br.get(s)?.clear(),Yr.delete(s)),h}finally{d.free(),x.forEach(h=>{h.mapState!=="unmapped"&&h.unmap(),m&&h.destroy()}),m&&dt.delete(s)}}var Ki=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`;const Xi=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],en=new WeakMap,rn=new WeakMap;function Zi(r){let t=en.get(r);return t||(t=(async()=>{const i=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=r.createShaderModule({code:Ki}),o=(await n.getCompilationInfo()).messages.filter(s=>s.type==="error");if(o.length)throw new Error(`Hydrologie WGSL : ${o.map(s=>`${s.lineNum}: ${s.message}`).join(`
`)}`);const l=r.createPipelineLayout({bindGroupLayouts:[i]}),u=await Promise.all(Xi.map(async s=>[s,await r.createComputePipelineAsync({layout:l,compute:{module:n,entryPoint:s}})]));return{layout:i,values:new Map(u)}})(),en.set(r,t)),t}function Qi(r){let t=2166136261;for(let i=0;i<r.length;i++)t=Math.imul(t^r.charCodeAt(i),16777619);return t>>>0}function ea(r,t,i){const n=new Uint32Array(r.length);if(!i)return{mask:n,count:0};const a=new Uint8Array(r.length),o=new Uint32Array(r.length);let l=0,u=0,s=0;const e=f=>{a[f]===0&&r[f]<=0&&(a[f]=1,o[u++]=f)},c=f=>{if(a[f]!==0||r[f]>0)return;l=0,u=0,e(f);let d=!1;for(;l<u;){const w=o[l++],b=w%t,k=Math.floor(w/t);d||=b+1<t&&k+1<t&&r[w+1]<=0&&r[w+t]<=0&&r[w+t+1]<=0;for(let x=-1;x<=1;x++){const P=k+x;if(!(P<0||P>=t))for(let m=-1;m<=1;m++){const g=b+m;g>=0&&g<t&&e(P*t+g)}}}if(d){for(let w=0;w<u;w++)n[o[w]]=1;s+=u}};for(let f=0;f<t;f++)c(f),c((t-1)*t+f);for(let f=1;f+1<t;f++)c(f*t),c(f*t+t-1);return{mask:n,count:s}}class ra{constructor(t,i,n){this.device=t,this.n=i,this.program=n,this.buffers=[],this.pending=Promise.resolve();const a=i*i,o=(u,s)=>{const e=t.createBuffer({size:u,usage:s});return this.buffers.push(e),e};this.uniform=o(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=o(a*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=o(a*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const l=o(a*48,GPUBufferUsage.STORAGE);this.control=o(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=o(a*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=o(a*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=o(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=t.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,l,this.control,this.output].map((u,s)=>({binding:s+1,resource:{buffer:u}}))]}),t.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(t,i,n,a){const o=this.pending.then(()=>this.execute(t,i,n,a));return this.pending=o.then(()=>{},()=>{}),o}async execute(t,i,n,a){const o=performance.now(),l=this.n,u=l*l,s=i/l,e=ea(t,l,a),c=performance.now()-o,f=this.device;f.queue.writeBuffer(this.source,0,t),f.queue.writeBuffer(this.sea,0,e.mask);for(let N=0;N<2;N++){const H=new ArrayBuffer(32);new Uint32Array(H,0,4).set([l,Qi(n),N,a?1:0]),new Float32Array(H,16,4).set([s,s*s,Math.max(.1,s*.1),0]),f.queue.writeBuffer(this.uniform,N*256,H)}const d=(N,H,Q=0)=>{N.setPipeline(this.program.values.get(H)),N.setBindGroup(0,this.group,[Q*256]),H==="solveTile"?N.dispatchWorkgroups(Math.ceil(l/16),Math.ceil(l/16)):N.dispatchWorkgroups(H==="reset"||H==="clearNext"?1:Math.ceil(u/256))},w=performance.now(),b=f.createCommandEncoder(),k=b.beginComputePass();d(k,"reset"),d(k,"initialize"),k.end(),f.queue.submit([b.finish()]);let x=0,P=!1,m=32;const g=Math.max(256,l);for(;x<g;){const N=f.createCommandEncoder(),H=N.beginComputePass();for(let ge=0;ge<m;ge++){const V=x+ge&1;d(H,"clearNext",V),d(H,"solveTile",V)}H.end(),N.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),f.queue.submit([N.finish()]),x+=m,m=Math.min(m*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const Q=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),Q===0){P=!0;break}}if(!P)throw new Error(`Drainage hydrique GPU non convergé après ${x} passes (${l}²) ; repli CPU requis.`);const h=f.createCommandEncoder(),p=h.beginComputePass();d(p,"receivers");const R=Math.ceil(Math.log2(u));for(let N=0;N<R;N++){const H=N&1;d(p,"accumulateCopy",H),d(p,"accumulateScatter",H)}d(p,"finish",R&1),p.end();const C=u*16;h.copyBufferToBuffer(this.output,0,this.readback,0,C),h.copyBufferToBuffer(this.control,0,this.readback,C,16),f.queue.submit([h.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const E=performance.now()-w,I=performance.now();let _,S,U,j;try{const N=this.readback.getMappedRange(),H=new Uint32Array(N,C,4);if(H[2]!==0||H[3]!==u-e.count)throw new Error(`Drainage hydrique GPU invalide (${H[2]} erreurs, ${H[3]}/${u-e.count} cellules drainées) ; repli CPU requis.`);const Q=new Float32Array(N,0,u*4),ge=new Uint32Array(N,0,u*4);_=new Float32Array(u),S=new Uint32Array(u),U=new Float32Array(u),j=new Float32Array(u);for(let V=0;V<u;V++)_[V]=Q[V*4],S[V]=ge[V*4+1],U[V]=Q[V*4+2],j[V]=Q[V*4+3]}finally{this.readback.unmap()}const W=new Uint8Array(e.mask);return{filled:_,receivers:S,accumulation:U,potential:j,seaMask:W,preprocessingMs:c,computeMs:E,readbackMs:performance.now()-I,floodPasses:x}}}async function ta(r,t,i,n,a=!1){if(![256,512,1024].includes(i)||r.length!==i*i||!Number.isFinite(t)||t<=0||!r.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const o=await Ut();if(!o||o.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const l=await Zi(o.device);if(o.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=rn.get(o.device);u||(u=new Map,rn.set(o.device,u));let s=u.get(i);return s||(s=new ra(o.device,i,l),u.set(i,s)),s.run(r,t,n,a)}const tn=new WeakMap;function na(r){const t=tn.get(r);if(t)return t;const i=new Float32Array(r.baseHeight.length),n=[],a=m=>r.drainageHeight[m]<r.rawDrainageHeight[m]&&r.surfaceHeight[m]<r.baseHeight[m];let o=!1;for(let m=0;m<i.length;m++){const g=a(m);g&&n.push(m),i[m]=g?0:r.surfaceHeight[m]-r.baseHeight[m],o||=i[m]!==0}const l=256,u=r.width/l,s=new Map,e=[],c=r.riverPoints,f=new Map,d=[],w=r.resolution,b=r.width/w,k=m=>Math.min(b*2,Math.max(b*.5,(r.baseHeight[m]-r.surfaceHeight[m])*1.4)),x=m=>((Math.imul(m^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const m of n){const g=m%w,h=Math.floor(m/w),p=(g+.5)*b,R=(h+.5)*b,C=[];for(let E=-1;E<=1;E++)for(let I=-1;I<=1;I++){const _=g+I,S=h+E,U=S*w+_;if(!I&&!E||_<0||S<0||_>=w||S>=w)continue;const j=a(U);(j&&U>m||!j&&r.basins[U]&&r.surfaceHeight[U]<=r.surfaceHeight[m])&&C.push(U)}C.length||C.push(m);for(const E of C){const I=(E%w+.5)*b,_=(Math.floor(E/w)+.5)*b,S=d.length,U=k(m),j=k(E),W=x(m),N=Math.max(U,j)*(1+Math.abs(W));d.push({a:m,b:E,ra:U,rb:j,skew:W});const H=Me(Math.min(p,I)-N,u,l),Q=Me(Math.max(p,I)+N,u,l),ge=Me(Math.min(R,_)-N,u,l),V=Me(Math.max(R,_)+N,u,l);for(let ve=ge;ve<=V;ve++)for(let K=H;K<=Q;K++){const ie=ve*l+K,Ue=f.get(ie);Ue?Ue.push(S):f.set(ie,[S])}}}if(r.incision>0)for(let m=0;m<r.riverCount;m++)for(let g=r.riverOffsets[m];g+1<r.riverOffsets[m+1];g++){const h=g+1,p=Math.max(c[g*4+2],c[h*4+2])*.65+.5,R=e.length;e.push({a:g,b:h,estuary:r.riverMeta[m*6+5]});const C=Me(Math.min(c[g*4],c[h*4])-p,u,l),E=Me(Math.max(c[g*4],c[h*4])+p,u,l),I=Me(Math.min(c[g*4+1],c[h*4+1])-p,u,l),_=Me(Math.max(c[g*4+1],c[h*4+1])+p,u,l);for(let S=I;S<=_;S++)for(let U=C;U<=E;U++){const j=S*l+U,W=s.get(j);W?W.push(R):s.set(j,[R])}}const P={delta:i,hasDelta:o,hasSea:r.basins.includes(0),buckets:s,segments:e,bucketSize:u,side:l,notchBuckets:f,notches:d};return tn.set(r,P),P}const Me=(r,t,i)=>Math.max(0,Math.min(i-1,Math.floor(r/t)));function nn(r,t,i,n,a){const o=new Int32Array(i*4),l=new Float64Array(i*4);for(let u=0;u<i;u++){const s=Math.max(0,Math.min(a-1,(r+(u+.5)*t)/n-.5)),e=Math.floor(s),c=s-e,f=1-c;for(let d=0;d<4;d++)o[u*4+d]=Math.max(0,Math.min(a-1,e+d-1));l.set([f**3/6,(3*c**3-6*c*c+4)/6,(-3*c**3+3*c*c+3*c+1)/6,c**3/6],u*4)}return{indices:o,weights:l}}function zn(r,t,i=!0){const n=r.resolution,a=r.width/n,o=na(t);if(!o.hasDelta&&!o.segments.length&&!o.notches.length)return;const l=i?new Float32Array(n*n):void 0;if(o.hasDelta){const g=t.resolution,h=t.width/g,p=nn(r.x,a,n,h,g),R=nn(r.y,a,n,h,g),C=R.indices[0],E=R.indices[R.indices.length-1],I=new Float64Array((E-C+1)*n);for(let _=C;_<=E;_++){const S=_*g,U=(_-C)*n;for(let j=0;j<n;j++){const W=j*4;I[U+j]=o.delta[S+p.indices[W]]*p.weights[W]+o.delta[S+p.indices[W+1]]*p.weights[W+1]+o.delta[S+p.indices[W+2]]*p.weights[W+2]+o.delta[S+p.indices[W+3]]*p.weights[W+3]}}for(let _=0;_<n;_++)for(let S=0;S<n;S++){const U=_*4;let j=I[(R.indices[U]-C)*n+S]*R.weights[U]+I[(R.indices[U+1]-C)*n+S]*R.weights[U+1]+I[(R.indices[U+2]-C)*n+S]*R.weights[U+2]+I[(R.indices[U+3]-C)*n+S]*R.weights[U+3];if(j>0&&o.hasSea&&r.height[_*n+S]<=0){const W=Math.max(0,Math.min(g-1,Math.floor((r.x+(S+.5)*a)/h))),N=Math.max(0,Math.min(g-1,Math.floor((r.y+(_+.5)*a)/h))),H=N*g+W;(!t.basins[H]||t.baseHeight[H]>=0)&&(j=0)}l&&(l[_*n+S]=j),r.height[_*n+S]+=j}}const u=new Set,{bucketSize:s,side:e}=o;for(let g=Me(r.y,s,e);g<=Me(r.y+r.width,s,e);g++)for(let h=Me(r.x,s,e);h<=Me(r.x+r.width,s,e);h++)for(const p of o.buckets.get(g*e+h)??[])u.add(p);const c=new Float32Array(n*n),f=t.riverPoints,d=(g,h)=>Math.max(0,Math.min(n-1,Math.floor((g-h)/a))),w=new Set;for(let g=Me(r.y,s,e);g<=Me(r.y+r.width,s,e);g++)for(let h=Me(r.x,s,e);h<=Me(r.x+r.width,s,e);h++)for(const p of o.notchBuckets.get(g*e+h)??[])w.add(p);const b=t.resolution,k=t.width/b,x=k*.25;for(const g of w){const{a:h,b:p,ra:R,rb:C,skew:E}=o.notches[g],I=Math.max(R,C)*(1+Math.abs(E)),_=(h%b+.5)*k,S=(Math.floor(h/b)+.5)*k,U=(p%b+.5)*k,j=(Math.floor(p/b)+.5)*k,W=U-_,N=j-S,H=W*W+N*N,Q=Math.min(_,U)-I,ge=Math.max(_,U)+I,V=Math.min(S,j)-I,ve=Math.max(S,j)+I;if(ge<r.x||Q>r.x+r.width||ve<r.y||V>r.y+r.width)continue;const K=Math.abs(N)>1e-12,ie=K?I*Math.sqrt(H)/Math.abs(N):0;for(let Ue=d(V,r.y);Ue<=d(ve,r.y);Ue++){const Ce=r.y+(Ue+.5)*a,fe=K?_+W*(Ce-S)/N:0,Ne=K?Math.max(Q,fe-ie):Q,Ae=K?Math.min(ge,fe+ie):ge;if(!(Ne>Ae||Ae<r.x||Ne>r.x+r.width))for(let Pe=d(Ne,r.x);Pe<=d(Ae,r.x);Pe++){const de=r.x+(Pe+.5)*a,we=H?Math.max(0,Math.min(1,((de-_)*W+(Ce-S)*N)/H)):0,ze=Math.hypot(de-_-W*we,Ce-S-N*we),xe=x+(R+(C-R)*we-x)*(1+E*Math.sign((de-_)*N-(Ce-S)*W));if(ze>=xe)continue;const ye=Math.max(0,(ze-x)/(xe-x)),se=1-ye*ye*(3-2*ye),Fe=t.surfaceHeight[h]+(t.surfaceHeight[p]-t.surfaceHeight[h])*we,he=Ue*n+Pe;c[he]=Math.max(c[he],Math.max(0,r.height[he]-Fe)*se)}}}for(const g of u){const{a:h,b:p,estuary:R}=o.segments[g],C=f[h*4],E=f[h*4+1],I=f[p*4],_=f[p*4+1],S=f[h*4+2],U=f[p*4+2],j=f[h*4+3],W=f[p*4+3],N=Math.max(Math.max(S,U)*.65,.5),H=I-C,Q=_-E,ge=H*H+Q*Q,V=Math.min(C,I)-N,ve=Math.max(C,I)+N,K=Math.min(E,_)-N,ie=Math.max(E,_)+N;if(ve<r.x||V>r.x+r.width||ie<r.y||K>r.y+r.width)continue;const Ue=d(K,r.y),Ce=d(ie,r.y),fe=Math.abs(Q)>1e-12,Ne=fe?N*Math.hypot(H,Q)/Math.abs(Q):0;for(let Ae=Ue;Ae<=Ce;Ae++){const Pe=r.y+(Ae+.5)*a,de=fe?C+H*(Pe-E)/Q:0,we=fe?Math.max(V,de-Ne):V,ze=fe?Math.min(ve,de+Ne):ve;if(we>ze||ze<r.x||we>r.x+r.width)continue;const xe=d(we,r.x),ye=d(ze,r.x);for(let se=xe;se<=ye;se++){const Fe=r.x+(se+.5)*a,he=Math.max(0,Math.min(1,((Fe-C)*H+(Pe-E)*Q)/Math.max(ge,.001))),Ie=S+(U-S)*he,qe=j+(W-j)*he,Ee=Math.hypot(Fe-C-H*he,Pe-E-Q*he),Le=Math.max(0,1-Ee/Math.max(Ie*.65,.5))**2;if(!Le)continue;const me=Math.max(.35,Math.min(12,Ie*.11))*t.incision,nr=Ae*n+se,Je=Math.max(0,Math.min(me*2+.75,r.height[nr]-(qe-me)))*Le*(R>1&&qe<me?1.15:1);c[nr]=Math.max(c[nr],Je)}}}let P=1/0,m=-1/0;for(let g=0;g<n*n;g++)r.height[g]-=c[g],l&&(l[g]-=c[g]),P=Math.min(P,r.height[g]),m=Math.max(m,r.height[g]);if(l)for(let g=0;g<n;g++)for(let h=0;h<n;h++){const p=g*n+h,R=Math.max(0,h-1),C=Math.min(n-1,h+1),E=Math.max(0,g-1),I=Math.min(n-1,g+1),_=l[g*n+C]-l[g*n+R],S=l[I*n+h]-l[E*n+h];if(_===0&&S===0)continue;const U=Math.max(1e-6,r.normalZ[p]),j=-r.normalX[p]/U+_/((C-R)*a||a),W=-r.normalY[p]/U+S/((I-E)*a||a),N=Math.hypot(j,W,1);r.normalX[p]=-j/N,r.normalY[p]=-W/N,r.normalZ[p]=1/N}r.minHeight=P,r.maxHeight=m}const mt=new Float32Array(0);function an(r,t){const i={...r,normalX:mt,normalY:mt,normalZ:mt};zn(i,t,!1),r.minHeight=i.minHeight,r.maxHeight=i.maxHeight}const Jr=r=>r.lakes==="none"||!(r.lakeAbundance>0&&r.lakeCoverage>0&&r.maxLakeArea>0),ia=(r,t)=>r.riverArea>0?r.riverArea:Math.max(.02,.003*(t/1e3)**2);class Ct{constructor(t,i,n,a,o,l){this.engine=t,this.baseHeight=i,this.backend=n,this.backendReason=a,this.drainageMs=o,this.gpu=l}static async create(t,i,n,a,o,l){const u=performance.now();let s,e,c;if(o!=="cpu")try{const d=await ta(a,i,n,t,l);s=Ot.with_drainage(t,i,n,a,l,d.filled,d.receivers,d.accumulation),c=d}catch(d){e=`GPU hydrology unavailable: ${d instanceof Error?d.message:String(d)}`}const f=s?"gpu-f32":"cpu";return s??=new Ot(t,i,n,a,l),new Ct(s,a,f,e,performance.now()-u,c)}generate(t,i){const n=performance.now(),a=this.engine.generate(t.main,t.density,t.wetness,Jr(t)?"none":t.lakes,t.meanders,t.meanderIntensity,t.estuary,t.widthScale,t.incision,t.minLakeArea,t.lakeAbundance,t.lakeCoverage,t.maxLakeArea,t.depressionPolicy,t.maxBreachDepth,t.maxBreachLength,t.minLakeDepth,i.temperature,i.precipitation,t.coastalStreams);try{const o=a.stage_ms,l=a.stage_labels?Object.fromEntries(a.stage_labels.split(",").map((x,P)=>[x,o[P]])):void 0,u=a.basins;let s=0,e=0;for(const x of u)s=Math.max(s,x),x&&e++;const c=a.river_offsets,f=a.lake_meta,d=a.lake_closed;let w=0;for(let x=2;x<f.length;x+=6)w+=f[x];const b=a.river_meta;let k=!1;for(let x=4;x<b.length;x+=6)k||=(b[x]&2)!==0;return{width:a.width,resolution:a.resolution,receivers:a.receivers,accumulation:a.accumulation,basins:u,rawReceivers:a.raw_receivers??a.receivers,rawAccumulation:a.raw_accumulation??a.accumulation,rawBasins:a.raw_basins??u,flatLabels:a.flat_labels??new Uint32Array(u.length),flatRank:a.flat_rank??new Uint32Array(u.length),externalInflowArea:a.external_inflow_area??0,rawFilled:a.raw_filled??a.filled,rawDrainageHeight:a.raw_drainage_height??a.drainage_height,breachCount:a.breach_count??0,breachCutVolumeM3:a.breach_cut_volume_m3??0,avoidedFillVolumeM3:a.avoided_fill_volume_m3??0,filled:a.filled,lakeDepth:a.lake_depth,lakeLabels:a.lake_labels,baseHeight:this.baseHeight,drainageHeight:a.drainage_height,surfaceHeight:a.surface_height,adjustedHeight:a.adjusted_height,riverPoints:a.river_points,riverOffsets:c,riverMeta:b,riverFlare:a.river_flare,lakePoints:a.lake_points,lakeOffsets:a.lake_offsets,lakeMeta:f,lakeRingMeta:a.lake_ring_meta,lakeClosed:d,waterField:a.water_field,closedLakeCount:d.reduce((x,P)=>x+P,0),nodePoints:a.node_points,nodeMeta:a.node_meta,riverCount:c.length-1,lakeCount:f.length/6,basinCount:s,lakeFraction:w/Math.max(1,e*(a.width/a.resolution)**2),incision:t.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&t.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(t.main)&&!k?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-n,stageMs:l,generationMs:this.drainageMs+performance.now()-n,routingPotential:t.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{a.free()}}dispose(){this.engine.free()}}const aa="magna-urbis-neural-models-v1",kt=["coarse","base","decoder"];class $e extends Error{constructor(t,i,n){super(i,n),this.code=t}}function on(r){const t=r;if(!t||typeof t.profile!="string"||!/^[a-f0-9]{64}$/.test(t.runtimeSha256))throw new $e("manifest","Invalid neural model manifest.");if(t.runtimeJsSha256!==void 0&&!/^[a-f0-9]{64}$/.test(t.runtimeJsSha256))throw new $e("manifest","Invalid neural runtime manifest.");for(const i of kt){const n=t.models?.[i];if(!n||!/^[\w.-]+$/.test(n.file)||!Number.isSafeInteger(n.bytes)||n.bytes<=0||!/^[a-f0-9]{64}$/.test(n.sha256))throw new $e("manifest",`Invalid ${i} model manifest.`);if(n.chunks!==void 0&&(!Array.isArray(n.chunks)||!n.chunks.length||n.chunks.some(a=>!a||!/^[\w.-]+$/.test(a.file)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>=5e7||!/^[a-f0-9]{64}$/.test(a.sha256))||new Set(n.chunks.map(a=>a.file)).size!==n.chunks.length||n.chunks.reduce((a,o)=>a+o.bytes,0)!==n.bytes))throw new $e("manifest",`Invalid ${i} model chunks.`)}return t}async function Un(r=!0){try{if(!globalThis.caches)throw new Error("Cache Storage unavailable");return await caches.open(aa)}catch(t){if(r)throw new $e("storage","Cannot access browser model storage.",{cause:t})}}async function oa(r,t){const i=new URL("models/manifest.json",r),n=await Un(!1),a=AbortSignal.timeout(15e3);try{const o=await fetch(i,{cache:"no-cache",signal:t?AbortSignal.any([t,a]):a});if(!o.ok)throw new Error(`HTTP ${o.status}`);const l=on(await o.json());return await n?.put(i,new Response(JSON.stringify(l),{headers:{"Content-Type":"application/json"}})).catch(()=>{}),{manifest:l,offline:!1}}catch(o){const l=await n?.match(i);if(l)return{manifest:on(await l.json()),offline:!0};throw new $e("manifest","Neural model catalogue unavailable on this address.",{cause:o})}}function Cn(r,t){const i=new URL(`models/${t.file}`,r);return i.searchParams.set("sha256",t.sha256),i.href}function sa(r,t,i,n){return r.searchParams.get("sha256")===i.sha256&&Number(t.headers.get("X-Magna-Model-Bytes"))===i.bytes&&(t.headers.get("X-Magna-Model-Name")===n||r.pathname.split("/").pop()===i.file)}async function la(r,t,i,n){const a=Cn(t,i),o=await r.match(a);if(o)return{url:a,response:o};for(const l of await r.keys()){const u=new URL(l.url);if(u.searchParams.get("sha256")!==i.sha256)continue;const s=await r.match(l);if(s&&sa(u,s,i,n))return{url:l.url,response:s}}}async function Vr(r,t){if(r.byteLength!==t.bytes)return!1;const i=await crypto.subtle.digest("SHA-256",r);return Array.from(new Uint8Array(i),n=>n.toString(16).padStart(2,"0")).join("")===t.sha256}async function ca(r,t,i,n={}){const{signal:a,onProgress:o}=n,l=t.models[i],u=Cn(r,l);a?.throwIfAborted();const s=await Un(n.requireStorage??!1);s||n.onStorageFailure?.();const e=s&&await la(s,r,l,i);if(e){const d=new Uint8Array(await e.response.arrayBuffer());o?.({name:i,phase:"verify",received:d.length,total:l.bytes});const w=await Vr(d,l);if(a?.throwIfAborted(),w)return d;await s?.delete(e.url)}const c=new Uint8Array(l.bytes);let f=0;for(const d of l.chunks??[l]){const w=new URL(`models/${d.file}`,r);w.searchParams.set("sha256",d.sha256);const b=await fetch(w.href,{signal:a});if(!b.ok)throw new $e("download",`Cannot download ${i} weights: HTTP ${b.status}`);const k=f;if(b.body){const x=b.body.getReader();try{for(;;){a?.throwIfAborted();const{done:P,value:m}=await x.read();if(P)break;if(f+m.byteLength>k+d.bytes)throw new $e("integrity",`Invalid ${i} model size.`);c.set(m,f),f+=m.byteLength,o?.({name:i,phase:"download",received:f,total:l.bytes})}}catch(P){throw await x.cancel().catch(()=>{}),P}finally{x.releaseLock()}}else{const x=new Uint8Array(await b.arrayBuffer());f+=x.byteLength,x.byteLength===d.bytes&&c.set(x,k)}if(f-k!==d.bytes||l.chunks&&!await Vr(c.subarray(k,f),d))throw new $e("integrity",`Invalid ${i} model chunk: integrity check failed.`)}if(a?.throwIfAborted(),o?.({name:i,phase:"verify",received:f,total:l.bytes}),f!==l.bytes||!await Vr(c,l))throw new $e("integrity",`Invalid ${i} model: integrity check failed.`);if(a?.throwIfAborted(),s){o?.({name:i,phase:"save",received:f,total:l.bytes});try{await s.put(u,new Response(c,{headers:{"X-Magna-Model-Name":i,"X-Magna-Model-Bytes":String(l.bytes),"X-Magna-Model-Profile":t.profile}}))}catch(d){if(n.requireStorage)throw new $e("storage","Cannot save model: browser storage is full or unavailable.",{cause:d});n.onStorageFailure?.()}}return c}async function ua(r,t,i){const n=await globalThis.caches?.open("magna-urbis-neural-runtime-v1");async function a(u,s){const e=new URL(u,r);e.searchParams.set("sha256",s??t.runtimeSha256);const c=k=>s?Vr(k,{bytes:k.length,sha256:s}):Promise.resolve(!0);let f=e.href,d=await n?.match(e);if(n&&!d)for(const k of await n.keys()){const x=new URL(k.url);if(!(x.pathname.split("/").pop()!==u||x.searchParams.get("sha256")!==e.searchParams.get("sha256"))&&(d=await n.match(k),d)){f=k.url;break}}if(d){const k=new Uint8Array(await d.arrayBuffer());if(await c(k))return k;await n?.delete(f)}const w=await fetch(e,{signal:i});if(!w.ok)throw new Error("Neural runtime unavailable. Check your connection and retry.");const b=new Uint8Array(await w.arrayBuffer());if(!await c(b))throw new Error("Neural runtime integrity check failed. Please retry.");return await n?.put(e,new Response(b)),b}const o=await a("magna_urbis_neural_wasm.js",t.runtimeJsSha256),l=await a("magna_urbis_neural_wasm_bg.wasm",t.runtimeSha256);return{javascript:o,wasm:l}}let sn="",Dr,St="",dr,ln="";function An(r,t){if(new URL(r).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const i=r+(t?.runtimeSha256??"")+(t?.runtimeJsSha256??"");return(sn!==i||!Dr)&&(sn=i,Dr=(async()=>{if(t){const{javascript:o,wasm:l}=await ua(r,t),u=URL.createObjectURL(new Blob([o],{type:"text/javascript"}));try{const s=await import(u);return await s.default({module_or_path:l}),s}finally{URL.revokeObjectURL(u)}}const a=await import(new URL("magna_urbis_neural_wasm.js",r).href);return await a.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",r)}),a})().catch(n=>{throw Dr=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Dr}async function At(){if(dr){try{(await dr).free()}catch{}dr=void 0,St=""}}async function fa(r,t,i,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:a}=await oa(r),o=[a.runtimeSha256,...kt.map(s=>a.models[s].sha256)].join(":");(St!==r+o||!dr)&&(await At(),St=r+o,dr=(async()=>{const s=await An(r,a);ln=o;const e=[];for(const c of kt){const f=a.models[c];n?.(`Neuronal WASM · ${c} · ${(f.bytes/1e6).toFixed(1)} Mo`),e.push(await ca(r,a,c,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),s.NeuralRelief.create(e[0],e[1],e[2])})().catch(s=>{throw dr=void 0,s}));const l=await dr;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await l.generate_json(JSON.stringify(Object.fromEntries(t)),i?JSON.stringify(i):"");try{const s=new Float32Array(u.heights),e=JSON.parse(u.meta),c=Number(t.get("extent")??4e4),f=Number(t.get("resolution")??Math.ceil(c/Number(t.get("sampleSpacing")??30))),d=e.resolution;if(e.extent!==c||e.nativeCellM!==30||e.nativeResolution!==Math.ceil(c/30)||typeof d!="number"||!Number.isInteger(d)||d!==f||s.length!==d*d||e.outputCellM!==c/d||s.some(w=>!Number.isFinite(w)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:s,meta:{...e,modelIdentity:ln}}}finally{u.free()}}let cn;async function En(r,t,i,n){cn??=Pt();const{seed:a,width:o,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sketch:w,source:b}=r,k=w?.processing,x=tr(r),P={seed:a,width:o,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sampleSpacing:x.requestedSpacing,sourceN:x.n,coastProfile:Ir(r),coastMask:r.coastMask??0,islandMode:r.islandMode??"island",source:b,...k?{sketch:{processing:k},surface:Array.from(Wr(xr(w),x.n))}:{}},g=await(await Fr(t,"/terrain",JSON.stringify({session:cn,settings:P,region:i,field:n}))).arrayBuffer();if(g.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const h=new DataView(g).getUint32(0,!0);if(h%4||4+h>g.byteLength)throw new Error("En-tête terrain local invalide.");const p=JSON.parse(new TextDecoder().decode(new Uint8Array(g,4,h)));let R=4+h;const C={};for(const _ of p.arrays){const S=_.count*(_.type==="f32"?4:1);if(!Number.isSafeInteger(_.count)||_.count<0||R+S>g.byteLength)throw new Error("Raster terrain local incomplet.");C[_.name]=_.type==="f32"?new Float32Array(g,R,_.count):new Uint8Array(g,R,_.count),R+=S}const E=C.height,I=p.resolution*p.resolution;if(!Number.isInteger(p.resolution)||p.resolution<64||p.resolution>1024||!E||E.length!==I||!E.every(Number.isFinite)||["normalX","normalY","normalZ"].some(_=>C[_]?.length!==I))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(p.fieldFloor)||!Number.isInteger(p.fieldN)||p.fieldN!==x.n||C.field?.length!==p.fieldN*p.fieldN||!C.field.every(Number.isFinite)||C.physical?.length!==p.fieldN*p.fieldN||!C.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:p.session,x:p.x,y:p.y,width:p.width,resolution:p.resolution,minHeight:p.minHeight,maxHeight:p.maxHeight,globalMinHeight:p.globalMinHeight,globalMaxHeight:p.globalMaxHeight,motifSize:p.motifSize,height:E,normalX:C.normalX,normalY:C.normalY,normalZ:C.normalZ,caveMask:C.caveMask,prepareMs:p.prepareMs,samplingMs:p.samplingMs,generationMs:p.prepareMs+p.samplingMs,generationBackend:"native",generationReason:p.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${p.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:p.erosionDefaults,...C.field?{field:{n:p.fieldN,data:C.field,exact:p.fieldExact,floor:p.fieldFloor,...C.physicalCave?{cave:C.physicalCave}:{}}}:{},...C.physical?{physical:{n:p.fieldN,height:C.physical}}:{},definition:x}}function da(r){if(r.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return En(r.settings,r.runtime,r.region,r.kind==="overview")}async function pa(r,t){const i=await En(r,t,{x:0,y:0,extent:r.width,resolution:64},!0);if(!i.field||i.field.data.length!==tr(r).n**2)throw new Error("Surface physique native absente.");return{height:i.field.data,prepareMs:i.prepareMs??0,samplingMs:i.samplingMs??0,session:i.session,fieldExact:i.field.exact,erosionDefaults:i.erosionDefaults}}const ha="[relief_session_missing]",un=r=>Array.from(r,t=>Number.isFinite(t)?t:null),ma=r=>new Uint8Array(r.buffer,r.byteOffset,r.byteLength);class ur{constructor(t,i){this.runtime=t,this.tuning=i,this.session=Pt(),this.steps=[],this.released=!1}static async build(t,i,n,a){const o=new ur(t,a.slice());return await o.mutate({op:"build",...i},n),o}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,t=>t??NaN)}editSurface(t){return this.mutate({op:"edit"},t)}coast(t,i,n,a,o){return this.mutate({op:"coast",mask:t,mode:i,coastProfile:o,surface:!!a,...n?{tuning:un(n)}:{}},a)}carveUnderdark(t,i){return this.mutate({op:"underdark",seed:t,...i})}async sampleRegion(t,i,n,a){const{meta:o,arrays:l}=await this.send({op:"read",region:{x:t,y:i,extent:n,resolution:a}}),u=o.region,s=l.height;if(!u||!s||s.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:s,cave_mask:l.caveMask,normal_x:l.normalX,normal_y:l.normalY,normal_z:l.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}async underdarkTunnels(){return(await this.send({op:"read",tunnels:!0})).arrays.tunnels??new Float32Array(0)}free(){this.released||(this.released=!0,this.steps.length=0,Fr(this.runtime,"/release",JSON.stringify({session:this.session})).then(t=>t.arrayBuffer(),()=>{}))}async mutate(t,i){this.meta=(await this.send(t,i)).meta,this.steps.push({header:t,plane:i})}async send(t,i){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(t,i)}catch(n){if(t.op==="build"||!(n instanceof Error)||!n.message.includes(ha))throw n;for(const a of this.steps)await this.call(a.header,a.plane);return this.call(t,i)}}async call(t,i){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:un(this.tuning),...t})),a=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);a.set(n);const o=new Uint8Array(4);new DataView(o.buffer).setUint32(0,a.length,!0);const u=await(await Fr(this.runtime,"/terrain/relief",new Blob([o,a,...i?[ma(i)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const s=new DataView(u).getUint32(0,!0);if(s%4||4+s>u.byteLength)throw new Error("Native relief reply header invalid.");const e=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,s))),c={};let f=4+s;for(const{name:d,type:w,count:b}of e.arrays){const k=b*(w==="f32"?4:1);if(!Number.isSafeInteger(b)||b<0||f+k>u.byteLength)throw new Error("Native relief plane incomplete.");c[d]=w==="f32"?new Float32Array(u,f,b):new Uint8Array(u,f,b),f+=k}return{meta:e,arrays:c}}}const ga=["plateau","volcano","caldera"],$r=r=>r==="neural-wasm"||r==="neural-python"||r==="neural",va="http://127.0.0.1:8792",ya="http://127.0.0.1:8793";function wa(r,t){const i=r==="neural-python"?ya:va,n=t?.trim().replace(/\/+$/,"");if(!n)return i;try{const a=new URL(n);if(a.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(a.hostname)&&["8792","8793"].includes(a.port)&&a.pathname==="/"&&!a.search&&!a.hash&&!a.username&&!a.password)return i}catch{}return n}const Rn={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},xa={flat:20,hills:110,plateau:100},cr=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],Kr=r=>r.climateValues??di[r.climate??"temperate"];function fn(r){const t=new Float32Array(r.height.length);let i=0,n=0;for(let l=0;l<r.height.length;l++)r.height[l]>0&&(t[n++]=r.height[l],i+=Math.acos(Math.min(1,r.normalZ[l])));const a=t.subarray(0,n).sort(),o=l=>n?a[Math.min(n-1,Math.floor(l*n))]:0;return{p5:o(.05),p50:o(.5),p95:o(.95),slope:i/Math.max(1,n),land:n/Math.max(1,r.height.length)}}let rt,F,fr="",jr="",wr,or="",Br,vr,De,sr=!1,$;const He=()=>$??F,Tr=()=>$?$.physicalHeightField():Promise.resolve(F.physical_height_field()),dn=async()=>{if($)return $.underdarkTunnels().catch(()=>new Float32Array(0));const r=F?.underdark_tunnels;return r?r.call(F):new Float32Array(0)},gt=()=>$?$.samplingBaseField():Promise.resolve(F.sampling_base_field());let rr="",Qe,yr,oe,er,Oe="cpu",Te,pn=Promise.resolve(),Ge,kr="",Sr="",Re,Lr,Xr="";async function Nn(){if(!Xr)return;const r=Xr;Xr="";try{await fetch(`${r}/release`,{method:"POST"})}catch{}}let _r,ee,We;const Mr=new _t;function _a(){Qr(),Ii(),Mr.clear(),wr=void 0,oe?.dispose(),oe=void 0,er=void 0,F?.free(),F=void 0,$?.free(),$=void 0,fr="",rr="",sr=!1,De=void 0,Ge?.dispose(),Ge=void 0,ee=void 0,We=void 0,Re=void 0,kr="",Sr="",_r=void 0}async function ba(r,t){const i=tr(r),n=Math.ceil(r.width/30),a=(m,g)=>g.extent===r.width&&g.resolution===i.n&&g.nativeCellM===30&&g.nativeResolution===n&&g.outputCellM===r.width/i.n&&m.length===i.n*i.n&&m.every(Number.isFinite),o=wa(r.source,r.neuralServer),l=new URLSearchParams({seed:r.seed,relief:r.relief,mix:String(r.relief==="mixed"?r.mountainMix:.5),coasts:"0",islands:"island",climate:r.climate??"temperate",noise:String(r.fidelity??.05),extent:String(r.width),sampleSpacing:String(i.requestedSpacing),resolution:String(i.n)}),u=Kr(r),s=r.neuralTuning??Rn;for(const[m,g]of Object.entries(u))l.set(m,String(g));l.set("landScale",String(s.landScale)),l.set("steps",String(s.steps)),l.set("detail",String(s.detail));for(const m of["coarseModel","baseModel","decoderModel"])r[m]&&l.set(m,r[m]);for(const m of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])l.set(m,String(s[m]));l.set("histogram",s.histogram.join(","));const e=xa[r.relief];s.reliefMode==="fixed"?l.set("reliefFixed",String(s.reliefFixed)):s.reliefMode==="auto"&&e!==void 0?l.set("reliefFixed",String(e)):l.set("reliefScale",String(s.reliefMode==="scale"?s.reliefScale:1));const c=hi(r.width,r.width,r.neuralFit??"crop",r.neuralSlopes??!0),f=r.zones?{zones:bn(r.zones),region:{x:c.x,y:c.y,width:c.width}}:r.sketch?mi(xr(r.sketch),c):void 0,d=performance.now();if(r.source==="neural-wasm"){if(await Nn(),!r.neuralAssets)throw new Error("Neural browser runtime URL missing.");const m=await fa(r.neuralAssets,l,f,t);if(!a(m.heights,m.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:m.heights,info:{...m.meta,requestMs:performance.now()-d}}}await At();let w=f;if(r.source==="neural-python"){if(r.zones&&(await fetch(`${o}/status`,{cache:"no-store"}).then(p=>p.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!r.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const m=await An(r.neuralAssets),g=Object.fromEntries(l);w={params:g,conditioning:JSON.parse(m.conditioning_json(JSON.stringify(g),f?JSON.stringify(f):"")),edited:!!f},t?.("Neural Python · computing with PyTorch/CUDA")}const b={cache:"no-store",...w?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(w)}:{}};let k;if(r.source==="neural")k=await gi({profile:"local",server:o},`/generate?${l}`,b);else try{k=await fetch(`${o}/generate?${l}`,b)}catch{throw new Error(`Neural service unreachable (${o}): run “npm run neural:python” from web/`)}if(!k.ok)throw new Error(`Neural service: ${await k.text()}`);const x=new Float32Array(await k.arrayBuffer()),P=JSON.parse(k.headers.get("X-Neural-Meta")??"{}");if(r.source==="neural-python"&&(Xr=o),f&&(P.edited!==!0||P.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!a(x,P))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:x,info:{...P,requestMs:performance.now()-d}}}function ka(r){return rt??=(async()=>{li()?(r?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await ci(),r?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await ui(()=>fi(_i,t=>Si({module_or_path:t}),r))})()}wn(()=>{Mr.clear(),rt=void 0,F=void 0,$?.free(),$=void 0,fr="",rr="",sr=!1,Ge=void 0,Re=void 0,kr="",Sr="",_r=void 0,ee=void 0,We=void 0});function Ma(r,t,i,n){const a=pn.then(()=>hn(r,t,i,n).catch(async o=>{if(!await Xn(o))throw o;return i?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),hn(r,t,i,n)}));return pn=a.catch(()=>{}),a}async function hn(r,t,i,n){const{settings:a,region:o,kind:l,display:u,runtime:s}=r,e=a.islandMode?.startsWith("traced:")&&(a.sketch?.processing||a.relief==="cavern"||a.underdark)?{...a,islandMode:"island"}:a,c=tr(e);if(Zn(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning}),e.climateZone==="wetland"&&(e.erosionTuning={carve:0,finalCarve:0,surfaceCarve:0,...e.erosionTuning});const f=e.compute==="wasm"?"wasm":"gpu-f32",d=e.generationCompute??"gpu-erosion";if(Qn(e,c.n))throw new Error(`GPU generation is limited to ${ei}² cells; requested spacing ${c.spacing.toFixed(2)} m (${c.n}²). Choose CPU or native.`);const w=Ye(e.generalSeed??e.seed,"relief-coast-cut"),b=!!e.generalSeed&&wt(e.generalSeed,M=>M.startsWith("relief-"))!==xn(e.generalSeed),k=tt(e),x=e.hydrology?.compute==="auto"&&(f==="wasm"||d==="cpu")?"cpu":e.hydrology?.compute??"auto";if(x!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&Ut(),k&&!e.zones&&!e.sketch?.processing&&(!ri.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const P=d==="native"&&!$r(e.source);if(P&&s?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(P&&e.relief==="cavern")return da({...r,settings:e});const m=ga.includes(e.relief)?e.environment??"mixed":"mixed",g=e.sketch?.processing,h=te(e,"coasts")?e.relief==="cavern"||e.underdark?0:e.coastMask??0:0,p=e.islandMode??"island",R=Ir(e),C=Bi.includes(e.relief),E=f!=="wasm"&&C?Ti(f,e.relief).catch(()=>{}):void 0;rt&&i?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await ka(i)}catch(M){throw rt=void 0,M}const I=performance.now();E&&i?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const _=E?await Pr(E):void 0;n&&await n.after("prepare");const S=(M,y)=>{const B=De;De={erosionSpacing:M===void 0?B?.erosionSpacing:Math.max(B?.erosionSpacing??0,M),regionalErosionSpacing:y===void 0?B?.regionalErosionSpacing:Math.max(B?.regionalErosionSpacing??0,y)},Object.assign(c,De)},U=async(M,y=!1)=>{let B=y&&te(e,"phasor",!1)?yt(M,e):M;const X=Ft(e),J=It(e),le=Zr(e);for(const A of["posterior","wind"]){const q=JSON.stringify([le.get(A),s?.server,!!_,pi(new Uint8Array(B.buffer,B.byteOffset,B.byteLength))]),ae=e.procedural?Mr.get(A,q):void 0;if(ae){B=ae,n?.cached?await n.cached(A,n.previews===!1?void 0:B):(await n?.before(A),await n?.after(A,n.previews===!1?void 0:B));continue}if(await n?.before(A),A==="posterior"&&e.procedural&&te(e,A)&&X.mode!=="none"){const D=B,ne=Math.sqrt(B.length);B=(await qt(B,ne,e.width,X,{stats:!1},s)).height;for(let G=0;G<B.length;G++)B[G]=D[G]>0?Math.max(.3,B[G]):B[G]}A==="wind"&&e.procedural&&te(e,A)&&J.iterations&&J.transport&&(B=_?await Ai(_.context,B,e.width,J):Ci(B,e.width,J)),e.procedural&&c.n<=1024&&Mr.put(A,q,B),await n?.after(A,n.previews===!1?void 0:B)}return e.procedural&&B.some(A=>A<.3)?B.map(A=>Math.max(.3,A)):B},j=_?Pr(_.pipeline).then(M=>({pipeline:M}),()=>{}):void 0,W=!P&&!e.zones&&!e.sketch&&d!=="cpu"&&f!=="wasm"&&!$r(e.source)&&e.relief!=="cavern",N=W&&_?Wi(_.context,e):void 0;if(N?.error&&e.generationCompute)throw new Error(N.error);const H=e.generationCompute||!N?void 0:N.error??(ti(N)?`Source ${c.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),Q=!!N&&!N.error&&!H,ge=W&&Li.includes(e.relief),V=ge&&Q,ve=(c.n!==1024||!!(e.procedural||n||b))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!$r(e.source)&&(!V||d!=="gpu-erosion"),K=!g&&$r(e.source);K||(await At(),await Nn());const ie=s?.profile==="local"&&(P||K),Ue=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,lt(e.modification.delta)]):"",Ce={tunnels:e.underdarkTunnels,caverns:e.underdarkCaverns,lakes:e.hydrology&&Jr(e.hydrology)?0:e.hydrology?.lakeAbundance},fe=JSON.stringify([e.zones,Ue,e.underdark?Ce:null,w,P?[s.server,h,p,R]:null,ie?s.server:null])+"|"+JSON.stringify(K?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,Kr(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??Rn,e.width,c.n,e.coarseModel,e.baseModel,e.decoderModel,e.neuralFit,e.neuralSlopes]:[e.seed,...e.generalSeed?[wt(e.generalSeed,M=>M.startsWith("relief-"))]:[],e.width,c.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,P?"native":k?[d,f,!!_]:ge?d:"cpu",m,e.sketch,e.erosionTuning??{},...e.procedural?[ni,R,e.procedural,e.climate,e.climateValues,e.climateZone,V?null:[h,p,R]]:[],...k||e.procedural?.enabled?.phasor?[ct,e.climate??"temperate",e.phasor??{}]:[]]);let Ne=0,Ae=0,Pe=0,de=0,we=0,ze;if(n&&n.previews!==!1||!(F||$)||fr!==fe){oe?.dispose(),oe=void 0,er=void 0,F?.free(),F=void 0,$?.free(),$=void 0,sr=!1,fr="",rr="",De=void 0;const M=performance.now();or="",jr="",Br=void 0,vr=void 0,wr=void 0,Oe="cpu",Te=void 0;const y=e.relief==="mixed"?e.mountainMix:.5;Lr=void 0;const B=Float64Array.from(cr,A=>{let q=k&&!e.procedural?NaN:e.procedural?.erosionTuning?.[A]??e.erosionTuning?.[A]??NaN;return e.procedural?.biome&&!V&&!ve&&(A==="incision"||A==="thermal")&&(q=(Number.isFinite(q)?q:1)*(A==="incision"?Rr(e).water:Rr(e).thermal)),q});if(Nr(B),ve){i?.(H?`${H} Rust CPU generation at ${c.spacing.toFixed(2)} m…`:P?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const A=await U(await zi(e,n,P?s:void 0,V&&_?()=>Yt(_.context,e,i):void 0,(q,ae)=>{De={erosionSpacing:q,regionalErosionSpacing:ae},Object.assign(c,De)}));n&&await n.before("retain"),ie?$=await ur.build(s,{kind:"source",seed:w,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:y,environment:m},A,B):F=_e.with_source(w,e.width,e.relief,e.erosion,e.motifSize,y,A,m),n&&await n.after("retain",n.previews===!1?void 0:A),Oe=P?"native":V?d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":k?"compact-cpu":"cpu",Te=H??`${P?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(P){i?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${c.n} × ${c.n} physical field`});const A=e.procedural?.biome?{...e,coastMask:h,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*Rr(e).water,thermal:(e.erosionTuning?.thermal??1)*Rr(e).thermal}}:{...e,coastMask:h},q=await pa(A.sketch&&!g?{...A,sketch:void 0}:A,s),ae=g!=="surface"&&e.procedural&&!e.zones?await U(q.height.slice(),!0):void 0;if(ae&&h)for(let D=0;D<ae.length;D++)q.height[D]<=0&&(ae[D]=q.height[D]);$=await ur.build(s,{kind:"surface",seed:w,width:e.width},ae??q.height,B),Oe="native",Te="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",we=q.prepareMs}else if(g){i?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const A=Wr(xr(e.sketch),c.n);if(g==="erosion"){i?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),F=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,y,m,c.n),F.set_edited_surface(A);const q=F.sampling_base_field();F.free(),F=_e.with_surface(w,e.width,q)}else F=_e.with_surface(w,e.width,A);Te=g==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if(K){const A=await ba(e,i),q=ii(A.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);ie?$=await ur.build(s,e.zones?{kind:"zonedSurface",seed:w,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:w,width:e.width},q,B):F=e.zones?_e.with_zoned_surface(w,e.width,e.motifSize,q,JSON.stringify(e.zones)):_e.with_surface(w,e.width,q),Lr=A.info,Oe="neural",e.zones&&(Te="Zones → regional conditioning and local neural relief, then sea operation.")}else if(k&&!e.zones)if(_&&Q){i?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:S},q=await U(await Qt(_.context,e,A,i));n&&await n.before("retain"),ze=A.profiles,F=_e.with_source(w,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,y,q,m),n&&await n.after("retain",q),Oe="compact-gpu-f32",Te=`${ct} · compact preset · ${e.procedural?.regionalN??Gt(e).n}² grid · ${e.climate??"temperate"} · Phasor ${te(e,"phasor",!0)?"enabled":"disabled"}.`}else{i?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const A=e.procedural?.biome?Rr(e):void 0,q=A?{incision:A.water,thermal:A.thermal}:e.procedural?{incision:1,thermal:1}:ai(e),ae=e.procedural?.erosionTuning?.iterations??Gt(e).steps,D=e.erosionTuning??{},ne={...D,iterations:ae,surfaceIterations:te(e,"surface",!1)?D.surfaceIterations??12:0,detail:te(e,"ridged",!1)?D.detail:0,warp:D.warp??0,incision:(D.incision??1)*q.incision,thermal:(D.thermal??1)*q.thermal};Nr(Float64Array.from(cr,re=>ne[re]??NaN));let G;try{G=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,y,m,c.n);const re=G.physical_height_field();F=_e.with_source(w,e.width,"hills",e.erosion,e.motifSize,y,te(e,"phasor",!0)?yt(re,e):re,m)}finally{G?.free(),Nr(new Float64Array(cr.length).fill(NaN))}Oe="compact-cpu",Te=`${ct} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)i?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n} × ${c.n} physical field`}),F=_e.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,y,m,JSON.stringify(bn(e.zones)),c.n),Te="Zone masks → uplift, noise, ridges and Rust erosion.";else if(V&&_)try{if(d==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:S},q=await U(await Qt(_.context,e,A,i));n&&await n.before("retain"),we=A.nativeEnvironmentMs,ze=A.profiles,de=performance.now()-M-we,F=_e.with_source(w,e.width,e.relief,e.erosion,e.motifSize,y,q,m),n&&await n.after("retain",q),Oe="gpu-erosion-f32"}else{const A=await Yt(_.context,e,i);Ae=performance.now()-M;const q=performance.now();i?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),F=_e.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,y,A.coarse,A.fine,m),Pe=performance.now()-q,Oe=d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(A){if(n||e.procedural)throw A;Te=`GPU generation unavailable: ${A instanceof Error?A.message:String(A)}`}if(!F&&!$&&(i?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n}² physical source at ${c.spacing.toFixed(2)} m`}),F=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,y,m,c.n),H&&(Te=H)),!g&&!K&&e.sketch&&e.relief!=="cavern"){const A=xr(e.sketch),q=await Tr(),ae=oi(A,q,c.n);$?await $.editSurface(ae):F.set_edited_surface(ae),Te="Edited sketch + procedural detail and Rust erosion."}const X=Ft(e),J=It(e),le=te(e,"posterior")&&X.mode!=="none"||te(e,"wind")&&J.iterations>0&&J.transport>0;if(!ve&&e.procedural&&(le||!k&&te(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(Oe)&&!K&&!g&&!P&&!e.zones){$t(F,h,p,R);const A=F.physical_height_field(),q=await U(A,!k);F.free(),F=_e.with_surface(w,e.width,q),sr=!0}e.modification&&(K||g)&&(wr=await gt()),Ne=performance.now()-M,fr=fe}else if(i?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),De&&Object.assign(c,De),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const M of["grids",...Mt(e),"phasor","posterior","wind"])await n.cached(M);const xe=JSON.stringify([fe,w,h,p,R,Zr(e).get("coasts"),Oe,s?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,lt(e.sketch.heights)],e.zones&&[e.zones.resolution,lt(e.zones.weights)]]),ye=!!(e.procedural||K||g)&&!sr&&!(P&&!ve),se=ye&&h?Mr.get("coasts",xe):void 0;!se&&n&&await n.before("coasts");const Fe=!K&&!g&&!sr&&!N?.error&&!H&&!e.zones&&!e.sketch&&h!==0&&d!=="cpu"&&f!=="wasm",he=JSON.stringify([w,h,h?p:"island",R,h?Fe:!1,e.procedural?.coastIterations,e.procedural?.coastIncision,e.procedural?.coastThermal,e.procedural?.coastDiffusion,e.erosionTuning]);let Ie=0;if(wr&&or&&or!==fe+"|"+he){if(oe?.dispose(),oe=void 0,er=void 0,$){const M=$;$=await ur.build(s,{kind:"surface",seed:w,width:e.width},wr,new Float64Array(cr.length).fill(NaN)),M.free()}else F?.free(),F=_e.with_surface(w,e.width,wr);rr="",or="",vr=void 0,Br=void 0,jr=""}if(P&&!ve||sr)rr=he,Qe=sr&&h?"cpu":void 0,yr=void 0;else if(rr!==he){oe?.dispose(),oe=void 0,er=void 0,Qe=void 0,yr=void 0;const M=performance.now();i?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const y=e.procedural,B={...e.erosionTuning,...y?.erosionTuning},X=h?Float64Array.from(cr,J=>y&&J==="surfaceIterations"?y.coastIterations??(k?2:12):J==="surfaceIncision"?(B[J]??1)*(y?.coastIncision??1):J==="surfaceThermal"?(B[J]??1)*(y?.coastThermal??1):J==="surfaceDiffusion"?(B[J]??1)*(y?.coastDiffusion??1):B[J]??NaN):void 0;if($?(await $.coast(h,p,se?void 0:X,se,R),h&&(Qe="native")):se&&(jt(F,h,p,R),F.set_coast_surface(se),Qe="cpu"),!$&&!se&&Fe&&_){let J;try{const le=await j;if(!le||_.context.lost)throw new Error("WebGPU unavailable");jt(F,h,p,R),J=new Jt(_.context,le.pipeline,f,F);const A=J.prepareCoastField(e),q=await Yi(_.context,e,A,F.coast_erosion_parameters(),i);F.set_coast_surface(q),Qe="gpu-f32"}catch(le){yr=`GPU coast unavailable: ${le instanceof Error?le.message:String(le)}`}finally{J?.dispose()}}if(!$&&!Qe){X&&Nr(X);try{$t(F,h,p,R)}finally{X&&Nr(Float64Array.from(cr,J=>B[J]??NaN))}h&&(Qe="cpu"),Fe&&!_&&(yr="WebGPU unavailable")}rr=he,Ie=h?performance.now()-M:0,Ne+=Ie}const qe=h&&ye&&(!se&&c.n<=1024||n&&n.previews!==!1&&!(se&&n.cached))?await gt():void 0;if(qe&&!se&&c.n<=1024&&Mr.put("coasts",xe,qe),se&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:se):n&&await n.after("coasts",n.previews===!1?void 0:qe),e.modification&&or!==fe+"|"+he){const M=He().source_resolution(),y=g==="surface"&&!h?Wr(xr(e.sketch),M):await Tr();if(Br={n:M,height:y.slice()},vr=si(y,M,e.modification),oe?.dispose(),oe=void 0,er=void 0,$){const B=$;$=await ur.build(s,{kind:"surface",seed:w,width:e.width},vr,new Float64Array(cr.length).fill(NaN)),B.free()}else F?.free(),F=_e.with_surface(w,e.width,vr);or=fe+"|"+he}e.underdark&&jr!==fe+"|"+he+"|"+or&&(i?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),oe?.dispose(),oe=void 0,er=void 0,$?await $.carveUnderdark(e.seed,Ce):F.carve_underdark(e.seed,Ce.tunnels,Ce.caverns,Ce.lakes),jr=fe+"|"+he+"|"+or);let Ee;const Le=async(M,y,B)=>((Ee?.delta!==M||Ee.m!==y||Ee.n!==B)&&(Ee={delta:M,m:y,n:B,out:await ki(M,y,B,s)}),Ee.out);async function me(M){De?Object.assign(c,De):c.erosionSpacing??=He().erosion_spacing(),M.definition=c,n&&await n.after("sampling",M.height),n&&await n.before("hydrology");const y=te(e,"hydrology")?e.hydrology:void 0;M.neural=Lr,l==="overview"&&!K&&e.relief!=="cavern"&&(M.erosionDefaults=Array.from(vi(e.relief,e.width,e.motifSize,e.mountainMix)));const B=!!y?.enabled&&e.relief!=="cavern",X=y?.engine!=="rust",J=y?.erosionEnabled!==!1,le=J&&y?.showErosion!==!1,A=J?y?.condMode:"none",q=X&&y&&!Jr(y)?[y.lakeAbundance,y.lakeArea,y.lakeDepth,y.lakeCoverage,y.maxLakeArea]:[0,0,0,0,0],ae=y&&{mode:y.condMode,strength:y.condStrength,maxDepth:y.condDepth,maxLength:y.condLength,banks:y.condBanks,lakes:q[0],lakeArea:q[1],lakeDepth:q[2],lakeCoverage:q[3],maxLakeArea:q[4],...e.climateZone==="wetland"?{undulation:2}:{}};if(t&&y&&B&&l==="overview"&&u==="gl"){const D=Ht(X?y.vectorResolution:y.resolution,c.n),ne=JSON.stringify([fr,rr,D,A,A==="none"?0:[y.condStrength,y.condDepth,y.condBanks,y.condLength,q]]);if(!ee||ee.key!==ne||X&&!We){const G=fn(M);t({...M,height:M.height.slice(),normalX:M.normalX.slice(),normalY:M.normalY.slice(),normalZ:M.normalZ.slice(),caveMask:M.caveMask.slice(),neural:Lr&&{...Lr,land:G.land},field:await nr(M,!1,X),relief:G,generationMs:performance.now()-I})}}if(y&&B){const D=Ht(X?y.vectorResolution:y.resolution,c.n),ne=JSON.stringify([fr,rr,D,A,A==="none"?0:[y.condStrength,y.condDepth,y.condBanks,y.condLength,q]]),G=Kr(e),re={riverArea:y.density>0?ia(y,e.width)/Math.max(1,y.density)**2:1e9,density:Math.min(1,y.density),noLakes:Jr(y),headwaters:y.headwaters!==!1?1:0,minRiverLength:y.minRiverLength,lakeDepth:y.lakeDepth,lakeArea:y.lakeArea,riverMode:y.riverMode,flatSlope:y.flatSlope,sinuosity:y.sinuosity,widthScale:y.vectorWidth,balance:y.balance,braiding:y.braiding,anabranching:y.anabranching,terrainInfluence:y.terrainInfluence,avulsions:y.avulsions,confluence:y.confluence,deltas:y.deltas,...e.climateZone==="wetland"?{oxbows:.35}:{}},Z=JSON.stringify([ne,re,G.temperature,G.precipitation,Ye(e.generalSeed??e.seed,"water-hydrology")]);if(!ee||ee.key!==ne){ee=void 0,We=void 0,Ge?.dispose(),Ge=void 0,Re=void 0,kr="",Sr="";let Y;if(M.x===0&&M.y===0&&M.width===e.width&&M.resolution===D)Y=M.height.slice();else if(oe&&!oe.lost)Y=(await oe.sample({x:0,y:0,extent:e.width,resolution:D},e,F.min_height,F.max_height)).height;else{const ce=$?await $.sampleRegion(0,0,e.width,D):F.sample_region(0,0,e.width,D);try{Y=ce.height}finally{ce.free()}}if(A==="none")ee={key:ne,n:D,height:Y,m:0};else{i?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const ce=ae;if(X){const pe=await Dt(Y,D,e.width,ce,re,G,Ye(e.generalSeed??e.seed,"water-hydrology"),s),{height:O,delta:Ke,...hr}=pe.conditioning;ee={key:ne,n:D,height:O,source:Y,delta:Ke,m:D,stats:hr},We={key:Z,water:pe.water}}else{const pe=await qt(Y,D,e.width,ce,{stats:!1,drainage:!1},s),{height:O,delta:Ke,hydrology:hr,...ke}=pe;ee={key:ne,n:D,height:O,source:Y,delta:Ke,m:D,stats:{...ke,census:!1},drainage:hr}}}}if(X){if(!We||We.key!==Z)if(i?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),ee.source){const Y=await Dt(ee.source,D,e.width,ae,re,G,Ye(e.generalSeed??e.seed,"water-hydrology"),s),{height:ce,delta:pe,...O}=Y.conditioning;Object.assign(ee,{height:ce,delta:pe,stats:O}),We={key:Z,water:Y.water}}else We={key:Z,water:await yi(ee.height,D,e.width,re,G,Ye(e.generalSeed??e.seed,"water-hydrology"),ee.drainage,s)}}else{const Y=JSON.stringify([ne,x,Ye(e.generalSeed??e.seed,"water-hydrology")]),ce={...y,showErosion:!0,erosionEnabled:J,...J?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},pe=`${Y}|${JSON.stringify(ce)}`;if(K&&_r?.key===pe)M.hydrologyError=_r.message;else try{(!Ge||kr!==Y)&&(i?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),Ge?.dispose(),Ge=void 0,Re=void 0,Sr="",Ge=await Ct.create(Ye(e.generalSeed??e.seed,"water-hydrology"),e.width,D,ee.height.slice(),x,h!==0||(g||K||e.sketch||e.zones?He().min_height<=0:!1)),kr=Y);const O=Kr(e),Ke=JSON.stringify([ce,O.temperature,O.precipitation]);(!Re||Sr!==Ke)&&(i?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Re=Ge.generate(ce,O),Sr=Ke)}catch(O){if(!K)throw O;Ge?.dispose(),Ge=void 0,Re=void 0,kr="",_r={key:pe,message:O instanceof Error?O.message:String(O)},M.hydrologyError=_r.message}}}if(i?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),B&&le&&ee?.delta&&!e.underdark&&await wi(M,ee.delta,ee.m,e.width,s),B&&le&&!X&&Re&&!M.hydrologyError){const D=performance.now();zn(M,Re),M.hydrologySurfaceMs=performance.now()-D}if(l==="overview"){const D=He().source_resolution(),ne=e.underdark?await Tr():vr?.slice()??(g==="surface"&&!h?Wr(xr(e.sketch),D):await Tr());if(B&&le&&ee?.delta&&!e.underdark){const G=await Le(ee.delta,ee.m,D);for(let re=0;re<ne.length;re++)ne[re]+=ne[re]<=0?Math.min(0,G[re]):G[re]}B&&le&&!X&&Re&&!M.hydrologyError&&an({x:0,y:0,width:e.width,resolution:D,height:ne,minHeight:M.globalMinHeight,maxHeight:M.globalMaxHeight},Re),M.physical={n:D,height:ne},Br&&(M.modificationBase=Br)}return e.refine&&u!=="gl"&&xi(M,e.width/He().source_resolution(),bi(e.seed),e.detailNoise),l==="overview"&&(u==="gl"||r.retainField)&&(i?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),M.field=await nr(M,B,X)),l==="overview"&&B&&(X?M.water=We?.water:Re&&!M.hydrologyError&&(M.hydrology=Re),ee?.delta&&ee.stats&&(M.conditioning={delta:ee.delta,n:ee.m,stats:ee.stats})),l==="overview"&&(M.relief=fn(M)),M.neural&&M.relief&&(M.neural={...M.neural,land:M.relief.land}),M.generationMs=performance.now()-I,n&&await n.after("hydrology",M.height),M}async function nr(M,y,B){const X=He().sampling_parameters()[5],J=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((X===1||X===4)&&e.relief!=="cavern"){const D=He().source_resolution(),ne=await gt();if(y&&J&&ee?.delta&&!e.underdark){const Y=await Le(ee.delta,ee.m,D);for(let ce=0;ce<D*D;ce++)ne[ce]+=ne[ce]<=0?Math.min(0,Y[ce]):Y[ce]}const G=y&&J&&!B&&!M.hydrologyError?Re:void 0;G&&an({x:0,y:0,width:e.width,resolution:D,height:ne,minHeight:M.globalMinHeight,maxHeight:M.globalMaxHeight},G);const re=e.underdark?$?await $.physicalCaveField():F.physical_cave_field():void 0,Z=e.underdark?await dn():void 0;return{n:D,data:ne,exact:!G,floor:X===1?.3:0,cave:re?.length?re:void 0,...Z?.length?{tunnels:Z}:{}}}const le=He().source_resolution(),A=M.physical?.height.slice()??await Tr(),q=e.relief!=="cavern"&&!e.underdark?void 0:$?await $.physicalCaveField():F.physical_cave_field(),ae=e.underdark?await dn():void 0;return{n:le,data:A,exact:!1,floor:0,cave:q?.length?q:void 0,...ae?.length?{tunnels:ae}:{}}}n&&await n.before("sampling",`Borne du moteur ${He().max_height.toFixed(2)} m · aperçu ${o.resolution}²`);let Je,ir=0,Ve;if(f!=="wasm"&&C&&!$&&!e.underdark){i?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const M=performance.now();try{const y=await j;_&&y&&!_.context.lost&&((!oe||er!==f||oe.lost)&&(oe?.dispose(),oe=void 0,oe=new Jt(_.context,y.pipeline,f,F),er=f),ir=performance.now()-M,i?.(`GPU · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"}),Ve={...await oe.sample(o,e,F.min_height,F.max_height),generationMs:performance.now()-I,prepareMs:Ne,gpuSetupMs:ir,generationBackend:Oe,generationReason:Te,noiseMs:Ae,erosionMs:Pe,gpuSimulationMs:de,nativeEnvironmentMs:we,erosionProfile:ze,coastBackend:Qe,coastMs:Ie,coastReason:yr}),Ve||(Je="WebGPU indisponible")}catch(y){Je=`GPU indisponible : ${y instanceof Error?y.message:String(y)}`,oe?.dispose(),oe=void 0,er=void 0}}else $?Je="Native Rust sampling on the local service.":f!=="wasm"&&(Je="terrain currently sampled in WASM");if(Ve)return me(Ve);i?.(`${$?"Native Rust":"CPU"} · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"});const pr=performance.now(),be=$?await $.sampleRegion(o.x,o.y,o.extent,o.resolution):F.sample_region(o.x,o.y,o.extent,o.resolution);try{return await me({x:be.x,y:be.y,width:be.width,resolution:be.resolution,minHeight:be.min_height,maxHeight:be.max_height,globalMinHeight:He().min_height,globalMaxHeight:He().max_height,motifSize:e.motifSize,height:be.height,caveMask:be.cave_mask,normalX:be.normal_x,normalY:be.normal_y,normalZ:be.normal_z,generationMs:performance.now()-I,backend:$?"native":"wasm",backendReason:Je,prepareMs:Ne,samplingMs:performance.now()-pr,gpuSetupMs:ir,generationBackend:Oe,generationReason:Te,noiseMs:Ae,erosionMs:Pe,gpuSimulationMs:de,nativeEnvironmentMs:we,erosionProfile:ze,coastBackend:Qe,coastMs:Ie,coastReason:yr})}finally{be.free()}}export{di as CLIMATE_VALUES,va as DEFAULT_NEURAL_SERVER,Rn as DEFAULT_NEURAL_TUNING,ya as DEFAULT_PYTHON_SERVER,cr as EROSION_SETTINGS,ga as GEOLOGICAL_RELIEFS,xa as NEURAL_RELIEF_DEFAULTS,Kr as climateOf,$r as isNeuralSource,wa as neuralServerForSource,_a as releaseTerrainCheckpoints,fn as reliefStatistics,Ma as sampleRustTerrain};
