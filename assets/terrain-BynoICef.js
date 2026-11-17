import{T as bt,M as Lr,N as tr,O as Qr,P as Or,Q as fn,S as dn,U as pn,V as ie,W as qn,X as kt,Y as Jr,s as Je,Z as St,_ as hn,$ as ht,a0 as Nt,a1 as mt,a2 as mn,a3 as _r,a4 as Dn,a5 as _e,a6 as gt,a7 as gn,a8 as Bt,a9 as $n,aa as jn,ab as Tt,ac as $r,ad as yr,ae as Wn,af as Yn,ag as Vn,ah as Jn,ai as Kn,aj as Xn,ak as at,al as Zn,am as ot,an as Ar,ao as Er,ap as Qn,aq as Gt,ar as ei,as as vn,at as ri,au as Lt,av as Ot,aw as ti,ax as ni,ay as ii,az as ai,aA as oi,aB as si,aC as Ft,aD as li,aE as ci,aF as ui,aG as fi,aH as It,aI as Ht,aJ as di,aK as pi,aL as hi,aM as mi,aN as gi,aO as vi,aP as yi,aQ as wi}from"./engine.worker-Dib_r1hJ.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/let Ye;const st=new Map;let vt=Promise.resolve();const yt=new bt;function Kr(t=!1){const r=Ye;Ye=void 0,yt.clear(),t||r?.pipeline?.free(),r?.runtime&&(vt=vt.then(async()=>{await Lr(r.runtime,"/terrain/stage",JSON.stringify({session:r.session,command:"cancel"})).catch(()=>{})}))}mn(()=>Kr(!0));async function xi(t,r,a,n,i){r?.backend?.(a?"native":"cpu");const o=tr(t),l=r?.previews!==!1&&o.n<=1024,u=Qr(t),s=Or.erosion_at_resolution(t.seed,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix,o.n),e=s.parameters();s.free();const{parameters:c,surface:f}=u?fn(e,t):{parameters:e,surface:e.slice(24,32)};dn(c,f,t,u),pn(f,t,o.n),u&&ie(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural?.erosionTuning?.detail===void 0&&(c[16]=e[16]);const d=(b,z=!0)=>Number(ie(t,b,z)),y=Uint32Array.from([Number(u),d("regional"),d("regionalFinish"),d("amplitude"),d("ridged",!u),d("surface",!u||t.relief==="canyon"),d("normalize"),+(t.procedural?.regionalThermal!==!1),+(t.procedural?.regionalDiffusion!==!1),t.procedural?.reconstruction==="cubic"?1:t.procedural?.reconstruction==="bspline"?2:0,+(t.relief==="canyon")]);i?.(y[5]&&c[23]>0&&f[3]>0?f[1]:void 0,y[1]&&t.erosion>0?c[4]:void 0);const w=qn([t.seed,t.width,o.n,c[2],a?.server??"wasm",!!n]);(o.n>1024||Ye?.root!==w)&&Kr();const P=kt(t),k=Jr(t),_=P.map(b=>k.get(b));let m=0;for(;Ye&&m<_.length&&Ye.keys[m]===_[m];)m++;const g=async b=>{try{return await Lr(a,"/terrain/stage",JSON.stringify({session:Ye.session,...b}))}catch(z){throw["coast","restore","preview"].includes(b.command)&&z instanceof Error&&z.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):z}},h=t.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([b,z])=>[b,Je(t.generalSeed,z)])):void 0,p={parameters:Array.from(c),surface:Array.from(f),flags:Array.from(y),stepSeeds:h??{}},L=async b=>{const z=await g(b),j=await z.json();if(h&&Object.values(h).some(I=>I!==t.seed)&&!j.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!Ye||m===0?(Kr(),a&&!st.has(a.server)&&st.set(a.server,St()),Ye={root:w,keys:[],runtime:a,...a?{session:st.get(a.server)}:{}},await r?.before("grids",`Rust ${a?"natif":"WASM"} · régional ${c[2]}² · surface ${f[0]}² · source ${o.n}² à ${o.spacing.toFixed(2)} m`),a?(await vt,await L({command:"start",seed:t.seed,...p})):Ye.pipeline=new hn(t.seed,c,f,y),await r?.after("grids")):r?.cached?await r.cached("grids"):(await r?.before("grids"),await r?.after("grids"));const U=Ye;a||U.pipeline.set_step_seeds(JSON.stringify(h??{}));let A;for(let b=0;b<P.length;b++){const z=P[b],j=b<m;if(!j&&b===m&&b>0&&(a?await L({command:"restore",checkpoint:b-1,...p}):U.pipeline.restore(b-1,c,f,y),U.keys.length=b),j){(l||b===P.length-1)&&(A=a?new Float32Array(await(await g({command:"preview",checkpoint:b})).arrayBuffer()):U.pipeline.checkpoint_height(b)),r?.cached?await r.cached(z,l?A:void 0):(await r?.before(z),await r?.after(z,l?A:void 0));continue}await r?.before(z);const I=z==="coastCut"&&ht(t,"coastCut");if(a){const q=await(await g({command:z==="coastCut"?"coast":"advance",stage:Nt.indexOf(z),checkpoint:b,mask:I?t.coastMask:0,mode:t.islandMode??"island",preview:l||b===P.length-1})).arrayBuffer();q.byteLength&&(A=new Float32Array(q))}else{if(z==="initialize"&&n){const N=await n();U.pipeline.set_noise(N.coarse,N.fine)}z==="coastCut"?I&&U.pipeline.cut_coast(t.coastMask,t.islandMode??"island"):U.pipeline.advance(Nt.indexOf(z)),U.pipeline.checkpoint(b),(l||b===P.length-1)&&(A=U.pipeline.height())}U.keys[b]=_[b],await r?.after(z,l?A:void 0)}const E=`${w}|${k.get("phasor")}`,R=o.n<=1024?yt.get("phasor",E):void 0;return R?(r?.cached?await r.cached("phasor",l?R:void 0):(await r?.before("phasor"),await r?.after("phasor",R)),R):(await r?.before("phasor"),ie(t,"phasor",u)&&(A=mt(A,t)),o.n<=1024&&yt.put("phasor",E,A),await r?.after("phasor",l?A:void 0),A)}const bi=`
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
}`,qt=new WeakMap;function ki(t,r,a){if(!a.iterations||!a.transport)return t;const n=t.slice(),i=Math.sqrt(n.length),o=r/i,l=new Float32Array(n.length),u=a.azimuth*Math.PI/180,s=Math.cos(u),e=Math.sin(u),c=s>=0?1:-1,f=e>=0?1:-1,d=Math.abs(s)/(Math.abs(s)+Math.abs(e)),y=1-d;for(let w=0;w<a.iterations;w++){l.fill(0);for(let P=1;P<i-1;P++)for(let k=1;k<i-1;k++){const _=P*i+k;if(n[_]<=.3)continue;const m=((n[_+1]-n[_-1])*s+(n[_+i]-n[_-i])*e)/(2*o),g=.75+.25*Math.sin((k*s+P*e)*o/64+n[_]*.03);l[_]=Math.min(Math.max(0,n[_]-.3),a.transport*Math.max(.1,Math.min(1,.55+2*m))*g)}for(let P=0;P<i;P++)for(let k=0;k<i;k++){const _=P*i+k,m=P*i+Math.max(0,Math.min(i-1,k-c)),g=Math.max(0,Math.min(i-1,P-f))*i+k;n[_]=n[_]-l[_]+(m!==_?l[m]*d:0)+(g!==_?l[g]*y:0)}}return n}async function Si(t,r,a,n){if(!n.iterations||!n.transport)return r;const i=t.device,o=Math.sqrt(r.length);let l=qt.get(i);l||(l=(async()=>{const d=i.createShaderModule({code:bi}),w=(await d.getCompilationInfo()).messages.filter(g=>g.type==="error");if(w.length)throw new Error(w.map(g=>`${g.lineNum}: ${g.message}`).join(`
`));const P=i.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),k=i.createPipelineLayout({bindGroupLayouts:[P]}),[_,m]=await Promise.all(["entrain","deposit"].map(g=>i.createComputePipelineAsync({layout:k,compute:{module:d,entryPoint:g}})));return{layout:P,a:_,b:m}})(),qt.set(i,l));const{layout:u,a:s,b:e}=await l,c=[],f=(d,y)=>{const w=i.createBuffer({size:d,usage:y});return c.push(w),w};try{const d=f(r.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),y=f(r.byteLength,GPUBufferUsage.STORAGE),w=f(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),P=f(r.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);i.queue.writeBuffer(d,0,r);const k=new ArrayBuffer(48),_=new Float32Array(k);new Uint32Array(k)[0]=o;const m=n.azimuth*Math.PI/180;_[1]=a/o,_[2]=Math.cos(m),_[3]=Math.sin(m),_[4]=n.transport,i.queue.writeBuffer(w,0,k);const g=i.createBindGroup({layout:u,entries:[d,y,w].map((R,b)=>({binding:b,resource:{buffer:R}}))}),h=Math.ceil(r.length/256),p=Math.ceil(h/i.limits.maxComputeWorkgroupsPerDimension),L=Math.ceil(h/p),U=i.createCommandEncoder(),A=U.beginComputePass();A.setBindGroup(0,g);for(let R=0;R<n.iterations;R++)A.setPipeline(s),A.dispatchWorkgroups(L,p),A.setPipeline(e),A.dispatchWorkgroups(L,p);A.end(),U.copyBufferToBuffer(d,0,P,0,r.byteLength),i.queue.submit([U.finish()]),await P.mapAsync(GPUMapMode.READ);const E=new Float32Array(P.getMappedRange()).slice();return P.unmap(),E}finally{c.forEach(d=>d.destroy())}}var _i=`// FP32 sampling of the retained Rust erosion field.\r
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
`,_t=`// Shared FP32 simplex and FBM kernels.\r
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
`,Mi=`// Same noise octaves and physical wavelengths as erosion::mountain.\r
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
`,yn=`// Seeded finite volcanic geometry. Shared by generation and camera sampling.\r
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
`,Pi=`// The dedicated third simplex stream matches Rust's shore-noise fork.\r
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
  let cliff=smooth01((fbm(uv/0.12,2u,3u,0.5,0.0)-0.20)/0.25);\r
  let widthVariation=0.65+1.1*smooth01(fbm(uv/0.21+vec2<f32>(11.7,-4.2),2u,3u,0.5,0.0)+0.5);\r
  let ramp=min(max(config.z,height/(p.values[0].x*0.45)),scale*0.18)*widthVariation*apron*(1.0-0.90*cliff);\r
  if(distance<=0.0){return -config.w*smooth01(-distance/(ramp*4.0*coast[15].y));}\r
  return height*smooth01(distance/ramp);\r
}\r
`;let lt;const zi=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Mt(){return lt??=(async()=>{const t=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!t)return;const{maxBufferSize:r,maxStorageBufferBindingSize:a}=t.limits,n=await t.requestDevice({requiredFeatures:t.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:r,maxStorageBufferBindingSize:a}}),i={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{i.lost=!0,lt=void 0}),i})().catch(()=>{}),lt}async function Ui(t,r){if(t==="wasm")return;const a=await Mt();if(!a||a.lost)return;const n=r==="flat"?0:r==="valley"?2:r==="volcano"||r==="caldera"||r==="plateau"?3:1,i=`${t}:${n}`;let o=a.pipelines.get(i);return o||(o=(async()=>{const l=_i.replace("// NOISE_KERNEL",_t).replace("// VOLCANIC_KERNEL",yn).replace("// COAST_KERNEL",Pi),u=a.device.createShaderModule({code:l});return a.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),o.catch(()=>{}),a.pipelines.set(i,o)),{context:a,pipeline:o}}const Ci=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Dt(t,r,a){const n=t.device,i=tr(r).n,o=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),l=r.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=l.map(c=>{const f=`generation:${c}`;let d=t.pipelines.get(f);if(!d){const y=n.createShaderModule({code:Mi.replace("// NOISE_KERNEL",_t)});d=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[o]}),compute:{module:y,entryPoint:c}}),t.pipelines.set(f,d)}return d}),s=Or.generation_at_resolution(r.seed,r.width,r.relief,r.motifSize,i),e=[];try{const c=s.parameters();r.procedural?.regionalN&&(c[2]=r.procedural.regionalN,c[4]=r.width*1.44/c[2]),c[6]*=r.procedural?.noiseScale??1;const f=(m,g)=>{const h=n.createBuffer({size:m.byteLength,usage:g|GPUBufferUsage.COPY_DST});return e.push(h),n.queue.writeBuffer(h,0,m),h},d=[f(c,GPUBufferUsage.UNIFORM),f(s.permutations(),GPUBufferUsage.STORAGE),f(s.gradients(),GPUBufferUsage.STORAGE)];a?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const y=await _r(Promise.all(u));a?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const P=l.map(m=>m==="coarse"?c[2]:c[1]).map((m,g)=>{const h=m*m*16,p=n.createBuffer({size:h,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),L=n.createBuffer({size:h,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});e.push(p,L);const U=n.createBindGroup({layout:y[g].getBindGroupLayout(0),entries:[...d,p].map((R,b)=>({binding:b,resource:{buffer:R}}))}),A=n.createCommandEncoder(),E=A.beginComputePass();return E.setPipeline(y[g]),E.setBindGroup(0,U),E.dispatchWorkgroups(Math.ceil(m/8),Math.ceil(m/8)),E.end(),A.copyBufferToBuffer(p,0,L,0,h),n.queue.submit([A.finish()]),L}),k=n.queue.onSubmittedWorkDone().then(()=>a?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),_=await Promise.all(P.map(async m=>{await m.mapAsync(GPUMapMode.READ);const g=new Float32Array(m.getMappedRange().slice(0));return m.unmap(),g}));return await k,{coarse:l.length===2?_[0]:new Float32Array,fine:_[_.length-1]}}finally{s.free(),e.forEach(c=>c.destroy())}}class $t{constructor(r,a,n,i){this.state=r,this.pipeline=a,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=i.sampling_parameters(),this.sourceN=i.source_resolution();let o=0;for(let e=this.sourceN;e>=1;e=Math.floor(e/2))o+=e*e;const l=this.parameters[5]===3?2:1;if(o*l*4>r.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=i.sampling_field();this.hasField=u.length>0;const s=u.length?u:new Float32Array(1);if(s.byteLength>r.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(s),this.perm=this.upload(i.sampling_permutations()),this.gradients=this.upload(i.sampling_gradients()),this.branches=this.upload(i.sampling_branches()),this.coast=this.upload(i.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(r,a=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,r.byteLength),usage:a|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,r),n}prepareCoastField(r){return this.dispatchField({x:0,y:0,extent:r.width,resolution:this.sourceN},r),this.output}dispatchField(r,a){const{x:n,y:i,extent:o,resolution:l}=r;if(![n,i,o,l].every(Number.isFinite)||n<0||i<0||o<=0||n+o>a.width+1e-4||i+o>a.width+1e-4||!Number.isInteger(l)||l<16||l>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,s=o/l,e=Math.max(a.motifSize/65536,s*.5),c=this.parameters,f=Math.floor(Math.log2(this.sourceN)),d=Math.min(f,Math.log2(Math.max(1,s*(a.relief==="flat"&&c[5]!==4?2/a.motifSize:1/a.width)*this.sourceN))),y=new Float32Array([c[0],c[1],c[2],c[3],c[4],c[5],this.hasField?1:0,l,n,i,o,s,Math.floor(d),Math.min(f,Math.floor(d)+1),d-Math.floor(d),e,c[6],c[7],this.sourceN,f,...Array.from({length:16},(_,m)=>c[8+m]??0)]),w=l*l*16;w>this.capacity&&(this.output?.destroy(),this.capacity=w,this.output=u.createBuffer({size:w,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((_,m)=>({binding:m,resource:{buffer:_}}))})),u.queue.writeBuffer(this.uniform,0,y);const P=u.createCommandEncoder(),k=P.beginComputePass();k.setPipeline(this.pipeline),k.setBindGroup(0,this.group),k.dispatchWorkgroups(Math.ceil(l/8),Math.ceil(l/8)),k.end(),u.queue.submit([P.finish()])}async sample(r,a,n,i){const o=performance.now(),l=this.state.device,{x:u,y:s,extent:e,resolution:c}=r;this.dispatchField(r,a);const f=c*c*16,d=l.createCommandEncoder();(!this.readback||this.readback.size<f)&&(this.readback?.destroy(),this.readback=l.createBuffer({size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),d.copyBufferToBuffer(this.output,0,this.readback,0,f),l.queue.submit([d.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,f);const y=this.readback.getMappedRange(0,f).slice(0);this.readback.unmap();const w=new Float32Array(y),P=new Float32Array(c*c),k=new Float32Array(c*c),_=new Float32Array(c*c),m=new Float32Array(c*c);let g=1/0,h=-1/0;for(let p=0;p<c*c;p++){const L=p*4;P[p]=w[L],k[p]=w[L+1],_[p]=w[L+2],m[p]=w[L+3],g=Math.min(g,P[p]),h=Math.max(h,P[p])}if(!Number.isFinite(g)||!Number.isFinite(h))throw new Error("Sortie GPU non finie.");return{x:u,y:s,width:e,resolution:c,minHeight:g,maxHeight:h,globalMinHeight:n,globalMaxHeight:i,motifSize:a.motifSize,height:P,normalX:k,normalY:_,normalZ:m,caveMask:new Uint8Array,generationMs:performance.now()-o,backend:this.mode,samplingMs:performance.now()-o}}dispose(){this.buffers.forEach(r=>r.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}var Ai=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`,Ei=`// Inspector-only readout. It never modifies simulation heights or drainage.\r
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
`,Ri=`// Full FP32 regional erosion. Dispatches are global synchronization boundaries.\r
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
  for(var k=0u;k<400u;k++){if(r<0){break;}current=max(bed,current-0.01*p.values[1].x);let old=nodes[u32(r)].h;if(old<=current){break;}atomicMin(&nodes[u32(r)].breached,ordered(current));for(var d=0u;d<8u;d++){let q=neighbor(u32(r),d);if(q>=0){atomicMin(&nodes[u32(q)].breached,ordered(max(current,nodes[u32(q)].h-(old-current))));}}let from=u32(r);let f=sillFlow(from,arc,phase);if(f.y<0.0){r=nodes[from].receiver;}else{turn+=f.z;if(turn>=0.5){turn-=1.0;r=i32(f.y);}else{r=i32(f.x);}}if(r>=0){let to=u32(r);let diagonal=from%size()!=to%size() && from/size()!=to/size();arc+=p.values[1].x*select(1.0,1.4142135623730951,diagonal);}}\r
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
`;const wr=new WeakMap,jr=new WeakMap,Xr=new Set;function Tr(t){t.nodes?.destroy(),t.fine?.destroy(),t.control.destroy()}function Ni(){for(const t of Xr)wr.get(t)?.forEach(Tr),wr.delete(t),jr.delete(t);Xr.clear()}const jt=new WeakMap,ct=new WeakMap,Wt=new WeakMap,Yt=new WeakMap,wn=new WeakSet,Bi=512*1048576,Vt=1024,Ti=1088,ut=Ti+4096;function xn(t,r){const a=(Wt.get(t.device)??Promise.resolve()).then(r);return Wt.set(t.device,a.then(()=>{},()=>{})),a}async function Gi(t,r,a,n){let i=jt.get(t);i||(i=(async()=>{const e=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(w=>({binding:w,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(w=>({binding:w,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),c=t.createShaderModule({code:Ri.replace("// NOISE_KERNEL",_t).replace("// VOLCANIC_KERNEL",yn)+Ai+Ei}),d=(await _r(c.getCompilationInfo())).messages.filter(w=>w.type==="error");if(d.length)throw new Error(d.map(w=>`${w.lineNum}: ${w.message}`).join(`
`));const y=t.createPipelineLayout({bindGroupLayouts:[e]});return{layout:e,module:c,pipelineLayout:y,values:new Map,pending:new Map}})(),jt.set(t,i)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const o=await _r(i),l=[],u=[...r].reduce((e,c)=>e+(c==="solveTile"?a.size:1),0);let s=0;for(const e of r)for(const c of e==="solveTile"?a:[void 0]){const f=c===void 0?e:`solveTile:${c}`;let d=o.pending.get(f);d||(d=t.createComputePipelineAsync({layout:o.pipelineLayout,compute:{module:o.module,entryPoint:e,...c===void 0?{}:{constants:{SOLVE_MODE:c}}}}),d=d.then(y=>(o.values.set(f,y),y)),o.pending.set(f,d)),l.push(d.then(y=>(s++,n?.(`GPU · shaders d’érosion prêts ${s}/${u}`,{stage:"gpu-erosion-compile",completed:s,total:u}),y)))}return await _r(Promise.all(l)),wn.add(t),o}class Gr extends Error{}class Li extends Error{}function bn(t,r,a,n,i){const o=Or.erosion_at_resolution(t.seed,t.width,a,t.erosion,t.motifSize,t.mountainMix,r);try{const l=o.parameters(),u=n?fn(l,t,i):{parameters:l,surface:(i??l.slice(24,32)).slice()};return dn(u.parameters,u.surface,t,n,!!i),pn(u.surface,t,r),{noise:o,parameters:u.parameters,surface:u.surface,original:l}}catch(l){throw o.free(),l}}const Oi=["hills","mountains","mixed","high-mountains","valley","canyon"];function Fi(t,r){const a=tr(r).n,n=Qr(r),i=Oi.includes(r.relief)?r.relief:r.relief==="flat"?"hills":"mixed",{noise:o,parameters:l,surface:u}=bn(r,a,i,n);o.free();const s=l[2],e=u[0],c=u[3],f=Dn(t.device.limits,a,Math.max(s,r.erosion>0&&(!n||c>0)?e:0));return{sourceN:a,regionalN:s,regionalSteps:l[13],surfaceN:e,surfaceSteps:c,pipelinesReady:wn.has(t.device),error:f}}async function Ii(t,r,a,n,i){return xn(t,()=>Hi(t,r,a,n,i))}async function Hi(t,r,a,n,i){const o=tr(r).n;for(const l of[1,2,4,8,16])try{return await kn(t,r,o,l,void 0,{source:a,tuning:n},void 0,i)}catch(u){if(!(u instanceof Gr)||l===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function Jt(t,r,a,n){return a?.control?.backend?.("gpu"),xn(t,()=>qi(t,r,a,n))}async function qi(t,r,a,n){const i=tr(r).n;if(r.relief==="volcano"||r.relief==="caldera"||r.relief==="plateau"){const o=Or.finite_shape(r.seed,r.motifSize,r.relief,r.erosion),l=o.parameters();o.free();const u=r.environment??"mixed",s=r.motifSize*l[15];let e;if(u==="flat"){const d=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),e=_e.prepare_environment_at_resolution(r.seed,r.width,u,r.erosion,s,i),a&&(a.nativeEnvironmentMs=performance.now()-d)}else e=await ft(t,{...r,motifSize:s,relief:u,mountainMix:.5},i,void 0,a,n);const c=await ft(t,{...r,width:r.motifSize},i,l,a,n),f=new Float32Array(c.length+e.length);return f.set(c),f.set(e,c.length),f}return ft(t,r,i,void 0,a,n)}async function ft(t,r,a,n,i,o){for(const l of[1,2,4,8,16])try{return await kn(t,r,a,l,n,void 0,i,o)}catch(u){if(!(u instanceof Gr)||l===16)throw u}throw new Error("Érosion GPU non convergée.")}async function kn(t,r,a,n,i,o,l,u){const s=t.device,e=o?void 0:l?.control,c=Qr(r),f=!!r.generalSeed&&gt(r.generalSeed,h=>h.startsWith("relief-"))!==gn(r.generalSeed),{noise:d,parameters:y,surface:w,original:P}=bn(r,a,o||c&&r.relief==="flat"?"hills":i?"mixed":r.relief,c,o?.tuning);let k=ct.get(s);if(!k){k=[],ct.set(s,k);const h=k;s.lost.then(()=>h.forEach(p=>p.destroy()))}const _=!!e&&e.previews!==!1&&a<=Vt;let m=!!e&&e.previews!==!1,g=0;try{c&&r.procedural&&ie(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural.erosionTuning?.detail===void 0&&(y[16]=P[16]);const h=y.slice(0,24),p=h[2],L=h[13],U=h[18],A=o?[1,0,0,.2,1,1,0,0]:Array.from(y.slice(33,41)),E=A.slice();E[4]=1;const R=!o&&A[6]>.5,b=Math.min(n,4),z=h.slice();z[2]=w[0],z[4]=w[1],z[5]=w[2],z[15]=i&&!o?i[13]:w[4],z[18]=w[5],z[22]=w[6];const j=Math.max(1,z[2]/1048),I=Math.ceil(Math.min((i||o||r.relief==="mixed"?64:32)*n,512)*j),N=!o&&ie(r,"phasor",c)?"generationPhasorPack":"packHeight",q=c?"compactInitialize":"initialize",X=!!o||ie(r,"surface",!c||r.relief==="canyon")&&(!c||r.relief==="canyon"||w[3]>0),se=()=>{o||l?.onPhysicalPlan?.(r.erosion>0&&X&&w[3]>0?w[1]:void 0,!i&&r.erosion>0&&(ie(r,"regional")||ie(r,"regionalFinish"))?h[4]:void 0)},K=r.procedural?.reconstruction&&r.procedural.reconstruction!=="default"?"generationReconstruct":c?"compactReconstruct":"reconstruct",re=new Set([N,...ie(r,"amplitude")?[]:["generationUnitScale"],...ie(r,"normalize")?[]:["generationKeepDatum"],...e?["generationPreview"]:[],...!o&&!i&&r.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),fe=new Set,de=(...v)=>v.forEach(M=>re.add(M));f&&!o&&!i&&de("generationCut","generationRegionalRead","generationPreview"),(o||!i&&(f||r.procedural))&&de("seaLandMark","seaMaskGrow");const ge=()=>de("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");o?de("coastLoad","coastResult"):de("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!o&&!i?(de(q,"uplift","bounds",K,"detail"),U>0&&(ge(),de("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(v=>fe.add(v)))):i&&!o&&de("volcanicInitial"),r.erosion>0&&X&&(ge(),de("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),fe.add(1),fe.add(3),r.relief==="canyon"&&!o&&(de("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),fe.add(0)),R&&(de("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),fe.add(0))),e&&await e.before("grids",`Budget ×${n} · régional ${p}² · surface ${z[2]}² · sortie ${a}²`);const Re=performance.now(),Me=await Gi(s,re,fe,u),Ge=performance.now()-Re,Ce=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let be=!1;const pe=(v,M)=>{const B=g++;let G=k[B];return(!G||G.size<v||G.usage!==M)&&(G?.destroy(),G=s.createBuffer({size:v,usage:M}),k[B]=G,be=!0),G},Ae=v=>{const M=pe(v.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return s.queue.writeBuffer(M,0,v),M},Ne=r.erosion>0&&X?Math.max(p,z[2]):p,ae=a**2,ve=ae*4,ye=ae*16,Le=Math.max(ae,p*p)*4;s.pushErrorScope("out-of-memory");const ze=pe(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),Oe=pe(Ne**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),We=pe(ye,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),qe=pe(ut,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Fe=pe(Le,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),le=pe(Le+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),Ke=pe(Math.ceil(Ne/16)**2*8,GPUBufferUsage.STORAGE),nr=s.popErrorScope();if(be&&await nr)throw m=!0,new Li(`WebGPU : mémoire insuffisante pour la source ${a}² et la grille d’érosion ${Ne}².`);m||=k.reduce((v,M)=>v+M.size,0)>Bi;const dr=v=>le.mapAsync(GPUMapMode.READ,0,v),ke=v=>le.getMappedRange(0,v),S=!o&&!i&&!!(r.procedural||f),x=S&&a<=Vt,T=_||S;let Y=T?void 0:Yt.get(s);if(!T&&!Y&&s.features.has("timestamp-query")){Y=s.createQuerySet({type:"timestamp",count:6}),Yt.set(s,Y);const v=Y;s.lost.then(()=>v.destroy())}const V=Y?pe(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,oe=Y?pe(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,C=(v,M)=>s.createBindGroup({layout:Me.layout,entries:[{binding:0,resource:{buffer:ze,size:224}},...[Ae(v),Ae(M),Oe,We,qe,Fe,Ke].map((B,G)=>({binding:G+1,resource:{buffer:B}}))]});let O=C(d.permutations(),d.gradients());const ce=new Map([[r.seed,O]]),H=v=>{const M={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[v];if(!M||!r.generalSeed)return;const B=Je(r.generalSeed,M);let G=ce.get(B);if(!G){const me=Or.erosion(B,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix);try{G=C(me.permutations(),me.gradients())}finally{me.free()}ce.set(B,G)}O=G},te=new Map;let Z=A;const he=(v,M)=>{const B=[...M,...v,...Z].join(",");let G=te.get(B);if(G===void 0){if(G=te.size*256,G+224>65536)throw new Error("Too many GPU variants.");te.set(B,G),s.queue.writeBuffer(ze,G,new Float32Array([...M,...v,...c?Bt(r,!!o):!i&&!o&&ie(r,"phasor",!1)?Bt(r):i??new Float32Array(16),...Z]))}return G};let J=s.createCommandEncoder();J.clearBuffer(qe),o&&J.copyBufferToBuffer(o.source,0,We,0,ye);const ne=v=>J.beginComputePass(Y?{timestampWrites:{querySet:Y,beginningOfPassWriteIndex:v,endOfPassWriteIndex:v+1}}:void 0);let W=ne(0);const ee=[0,0,1,0,0,0,.6,0];ee[4]=y[32];const we=[0,0,.95,U*.5,0,0,.5,0];let xe=h;const D=(v,M=ee,B=Math.ceil(xe[2]**2/256),G=1)=>{W.setPipeline(Me.values.get(v==="solveTile"?`solveTile:${M[1]}`:v)),W.setBindGroup(0,O,[he(M,xe)]),W.dispatchWorkgroups(B,G)},Fr=Math.ceil(ae/256),Ut=Math.ceil(Fr/s.limits.maxComputeWorkgroupsPerDimension),Ue=(v,M=ee)=>D(v,M,Math.ceil(Fr/Ut),Ut),Xe=(v,M,B=!1)=>{const G=ee.slice();G[1]=v,G[7]=B?1:0,D(v===0?"floodInit":"graphInit",G),D("start",G,1);const me=[0,1].map(Se=>(G[0]=Se,he(G,xe)));for(let Se=0;Se<M;Se++){const sr=[me[Se&1]];W.setPipeline(Me.values.get("clearNext")),W.setBindGroup(0,O,sr),W.dispatchWorkgroups(1),W.setPipeline(Me.values.get(`solveTile:${v}`)),W.dispatchWorkgroups(Math.ceil(xe[2]/16),Math.ceil(xe[2]/16))}G[0]=0,D("solveStats",G,1),v===0?(D("floodCheck",G,1),D("receivers")):D("graphFinish",G)},et=(v=ee,M=!0)=>{D("pitInit");for(let B=0;B<8*b+Math.ceil(Math.log2(Math.max(1,xe[2]/1048)));B++)D("pitUnion"),D("pitCompress");for(const B of M?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])D(B,v)},rt=v=>{if(v<=0)return;const M=ee.slice();M[6]=v,D("breachInit"),D("breach",M),D("breachFinish")},tt=(v,M=ee)=>{if(!(xe===h&&r.procedural?.regionalThermal===!1))for(let B=0;B<v;B++)for(const G of["thermalFlux","thermalApply","copyHeight"])D(G,M)},Ir=(v,M=ee)=>{if(xe===h&&r.procedural?.regionalDiffusion===!1)return;const B=M.slice();B[3]=v,D("diffuse",B),D("copyHeight",B)},Ct=v=>{const M=$n(jn({surfaceSteps:w[3],surfaceCell:w[1],regionalCell:h[4],sourceCell:h[11],warp:A[5]*Math.min(16*h[3],h[4]*.9)}),r.width);if(M===void 0)return;const B=ee.slice();B[7]=v,v===0?D("seaLandMark",B):Ue("seaLandMark",B),B[5]=M,D("seaMaskGrow",B,2)},At=v=>{const M=ee.slice();M[4]=v,D("percentileInit",M,1);for(const B of[24,16,8,0])M[5]=B,D("histogramClear",M,1),Ue("histogram",M),D("percentileSelect",M,1)},Et=async(v,M,B)=>{if(!e)return;if(!_){await e.after(v,void 0,B);return}if(M!==3){const sr=ee.slice();sr[7]=M,Ue("generationPreview",sr)}W.end(),J.copyBufferToBuffer(Fe,0,le,0,ve),J.copyBufferToBuffer(qe,0,le,ve,1088),s.queue.submit([J.finish()]),await dr(ve+1088);const G=ke(ve+1088),me=new Uint32Array(G,ve,272)[2],Se=new Float32Array(G,0,ae).slice();if(le.unmap(),me)throw new Gr("Érosion GPU non convergée pendant une étape.");if(!Se.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await e.after(v,Se,B),J=s.createCommandEncoder(),W=ne(0)},pr=kt(r),Cn=Jr(r);let Be=x?wr.get(s):void 0;if(x&&!Be){Be=new Map,wr.set(s,Be),Xr.add(s);const v=Be;s.lost.then(()=>{v.forEach(Tr),v.clear(),Xr.delete(s)})}const Mr=v=>`${n}|${Cn.get(v)}`;let ir=0;for(;Be&&ir<pr.length&&Be.get(pr[ir])?.key===Mr(pr[ir]);)ir++;if(Be)for(const v of[...pr.slice(ir),"phasor"]){const M=Be.get(v);M&&(v!=="phasor"||M.key!==Mr(v)||ir<pr.length)&&(Tr(M),Be.delete(v))}const An=v=>{W.end(),v.nodes&&J.copyBufferToBuffer(v.nodes,0,Oe,0,v.nodes.size),v.fine&&J.copyBufferToBuffer(v.fine,0,We,0,v.fine.size),J.copyBufferToBuffer(v.control,0,qe,0,ut),W=ne(0)},En=(v,M)=>{if(!Be)return;W.end();const B=(me,Se=me.size)=>{const sr=s.createBuffer({size:Se,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return J.copyBufferToBuffer(me,0,sr,0,Se),sr},G=Be.get(v);G&&Tr(G),Be.set(v,{key:Mr(v),kind:M,...M===0?{nodes:B(Oe,p*p*112)}:{fine:B(We,ye)},control:B(qe,ut)}),s.queue.submit([J.finish()]),J=s.createCommandEncoder(),W=ne(0)},Rn=async(v,M)=>{if(!e)return;if(!_){e.cached?await e.cached(v):(await e.before(v),await e.after(v));return}const B=ee.slice();B[7]=M.kind,Ue("generationPreview",B),W.end(),J.copyBufferToBuffer(Fe,0,le,0,ve),s.queue.submit([J.finish()]),await dr(ve);const G=new Float32Array(ke(ve),0,ae).slice();le.unmap(),e.cached?await e.cached(v,G):(await e.before(v),await e.after(v,G)),J=s.createCommandEncoder(),W=ne(0)},Ze=async(v,M,B)=>{const G=pr.indexOf(v),me=Be?.get(v);if(me&&G>=0&&G<ir){(_||G===ir-1)&&An(me),await Rn(v,me);return}await e?.before(v),H(v),await B(),En(v,M),await Et(v,M)},Nn=r.procedural?.coastAfter??"initialize",hr=async(v,M)=>{!S||v!==Nn||await Ze("coastCut",M===4?5:M,async()=>{if(!ht(r,"coastCut"))return;const B=ee.slice();B[7]=M,M===0?D("generationRegionalRead",B,Math.ceil(p*p/256)):Ue("generationPreview",B),W.end();const G=M===0?p*p:ae;J.copyBufferToBuffer(Fe,0,le,0,G*4),s.queue.submit([J.finish()]),await dr(G*4);const me=new Float32Array(ke(G*4),0,G).slice();le.unmap();const Se=hn.cut_field(Je(r.generalSeed??r.seed,"relief-coast-cut"),r.width,y[3]*2400,y[12],r.coastMask,r.islandMode??"island",M===0?p:a,M===0?h[5]:0,M===0?h[4]:h[11],me);s.queue.writeBuffer(Fe,0,Se),J=s.createCommandEncoder(),W=ne(0),M===0?D("generationCut",B,Math.ceil(p*p/256)):Ue("generationCut",B),Ct(M)})};e&&await e.after("grids",void 0,`Budget ×${n} · régional ${p}² · surface ${z[2]}² · ${(k.reduce((v,M)=>v+M.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${L} cycles de relief et ${w[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),o?(xe=z,Ue("coastLoad"),Ct(2)):i?(e&&await e.before("initialize"),xe=z,Ue("volcanicInitial"),e&&await Et("initialize",2)):(await Ze("initialize",0,()=>{D(q)}),await hr("initialize",0),await Ze("regional",0,()=>{for(let v=0;v<(ie(r,"regional")?L:0);v++){if(D("uplift"),U>0){Xe(0,64*b),et(),D("flow"),rt(A[1]),Xe(1,128*b),Xe(2,128*b),tt(3);const M=h[17]*3*U;for(let B=0;B<Math.floor(M);B++)Ir(.5);M%1>0&&Ir(.5*(M%1))}D("bounds")}}),await Ze("regionalFinish",0,()=>{const v=ee.slice();if(v[7]=1,D("bounds",v),U>0&&ie(r,"regionalFinish")){tt(4,we);for(let M=0;M<6;M++)Xe(0,64*b),et(we),D("flow"),rt(A[2]);Ir(U*.5,we)}}),await hr("regionalFinish",0),await Ze("reconstruct",1,()=>{const v=ee.slice();v[7]=r.procedural?.reconstruction==="bspline"?1:0,Ue(K,v)}),await Ze("amplitude",4,()=>{ie(r,"amplitude")?At(0):D("generationUnitScale",ee,1)}),await hr("amplitude",4),await Ze("ridged",2,()=>{Ue("detail")}),await hr("ridged",2)),W.end(),W=ne(2),await Ze("surface",2,()=>{if(r.erosion>0&&X){if(xe=z,Z=E,D("surfaceLoad"),r.relief==="canyon"&&!o){const v=Math.ceil(128*b*j);Xe(0,v),D("flow"),Xe(1,v),D("canyonSeed");let M=0;const B=[];for(let me=2**(Math.ceil(Math.log2(z[2]))-1);me>=1;me/=2)B.push(me);B.push(1,1);for(const me of B){const Se=ee.slice();Se[0]=M,Se[1]=me,D("canyonSpread",Se),M=1-M}const G=ee.slice();G[0]=M,D("canyonApply",G)}for(let v=0;v<w[3];v++)R?(Xe(0,I),et(ee,!1),D("flow"),rt(A[7])):(D("surfaceFlowInit"),D("receivers"),D("flow")),Xe(1,I,!0),Xe(3,I,!0),tt(1),Ir(w[7]);D("surfaceDelta"),Ue("surfaceReconstruct")}}),await hr("surface",2),W.end(),W=ne(4),await Ze("normalize",1,()=>{o?Ue("coastResult"):ie(r,"normalize")?(At(1),Ue("normalize")):Ue("generationKeepDatum")}),await hr("normalize",1);let Pr=jr.get(s);Pr||(Pr=new bt,jr.set(s,Pr));const zr=x?Pr.get("phasor",Mr("phasor")):void 0;if(zr)return W.end(),s.queue.submit([J.finish()]),e?.cached?await e.cached("phasor",_?zr:void 0):(await e?.before("phasor"),await e?.after("phasor",zr)),se(),zr;zr||await e?.before("phasor"),Ue(N),W.end();const Ur=ve;J.copyBufferToBuffer(Fe,0,le,0,Ur),J.copyBufferToBuffer(qe,0,le,Ur,1088),Y&&V&&oe&&(J.resolveQuerySet(Y,0,6,V,0),J.copyBufferToBuffer(V,0,oe,0,48));const Bn=J.finish(),Tn=performance.now()-Ce;u?.(o?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const Gn=performance.now();s.queue.submit([Bn]);const Ln=s.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([dr(Ur+1088),oe?.mapAsync(GPUMapMode.READ),Ln]);const On=performance.now()-Gn,Fn=performance.now(),Rt=ke(Ur+1088),nt=new Uint32Array(Rt,Ur,272),In=Array.from(nt.slice(267,271)),it={factor:n,sourceSize:a,coarseSize:p,surfaceSize:z[2],pipelineMs:Ge,encodeMs:Tn,submitReadbackMs:On,unpackMs:0,maxSolveSteps:In,allocatedBytes:k.reduce((v,M)=>v+M.size,0)};if(oe){const v=new BigUint64Array(oe.getMappedRange());it.gpuStagesMs={coarse:Number(v[1]-v[0])/1e6,surface:Number(v[3]-v[2])/1e6,normalization:Number(v[5]-v[4])/1e6},oe.unmap()}if(l&&(l.profiles??=[]).push(it),nt[2]!==0)throw le.unmap(),new Gr(`Érosion GPU non convergée (${nt[2]} cellules/étapes, budget ×${n}).`);const Cr=new Float32Array(Rt,0,ae).slice();le.unmap(),it.unpackMs=performance.now()-Fn;const Hn=o||S&&ht(r,"coastCut")?-1/0:.3-1e-7;for(let v=0;v<ae;v++)if(!Number.isFinite(Cr[v])||Cr[v]<Hn)throw new Error("Champ GPU invalide.");return se(),x&&Pr.put("phasor",Mr("phasor"),Cr),e&&await e.after("phasor",_?Cr:void 0,"Sortie GPU lue et validée"),Cr}catch(h){throw h instanceof Gr&&(wr.get(s)?.forEach(Tr),wr.get(s)?.clear(),jr.delete(s)),h}finally{d.free(),k.forEach(h=>{h.mapState!=="unmapped"&&h.unmap(),m&&h.destroy()}),m&&ct.delete(s)}}var Di=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`;const $i=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],Kt=new WeakMap,Xt=new WeakMap;function ji(t){let r=Kt.get(t);return r||(r=(async()=>{const a=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=t.createShaderModule({code:Di}),o=(await n.getCompilationInfo()).messages.filter(s=>s.type==="error");if(o.length)throw new Error(`Hydrologie WGSL : ${o.map(s=>`${s.lineNum}: ${s.message}`).join(`
`)}`);const l=t.createPipelineLayout({bindGroupLayouts:[a]}),u=await Promise.all($i.map(async s=>[s,await t.createComputePipelineAsync({layout:l,compute:{module:n,entryPoint:s}})]));return{layout:a,values:new Map(u)}})(),Kt.set(t,r)),r}function Wi(t){let r=2166136261;for(let a=0;a<t.length;a++)r=Math.imul(r^t.charCodeAt(a),16777619);return r>>>0}function Yi(t,r,a){const n=new Uint32Array(t.length);if(!a)return{mask:n,count:0};const i=new Uint8Array(t.length),o=new Uint32Array(t.length);let l=0,u=0,s=0;const e=f=>{i[f]===0&&t[f]<=0&&(i[f]=1,o[u++]=f)},c=f=>{if(i[f]!==0||t[f]>0)return;l=0,u=0,e(f);let d=!1;for(;l<u;){const y=o[l++],w=y%r,P=Math.floor(y/r);d||=w+1<r&&P+1<r&&t[y+1]<=0&&t[y+r]<=0&&t[y+r+1]<=0;for(let k=-1;k<=1;k++){const _=P+k;if(!(_<0||_>=r))for(let m=-1;m<=1;m++){const g=w+m;g>=0&&g<r&&e(_*r+g)}}}if(d){for(let y=0;y<u;y++)n[o[y]]=1;s+=u}};for(let f=0;f<r;f++)c(f),c((r-1)*r+f);for(let f=1;f+1<r;f++)c(f*r),c(f*r+r-1);return{mask:n,count:s}}class Vi{constructor(r,a,n){this.device=r,this.n=a,this.program=n,this.buffers=[],this.pending=Promise.resolve();const i=a*a,o=(u,s)=>{const e=r.createBuffer({size:u,usage:s});return this.buffers.push(e),e};this.uniform=o(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=o(i*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=o(i*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const l=o(i*48,GPUBufferUsage.STORAGE);this.control=o(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=o(i*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=o(i*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=o(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=r.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,l,this.control,this.output].map((u,s)=>({binding:s+1,resource:{buffer:u}}))]}),r.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(r,a,n,i){const o=this.pending.then(()=>this.execute(r,a,n,i));return this.pending=o.then(()=>{},()=>{}),o}async execute(r,a,n,i){const o=performance.now(),l=this.n,u=l*l,s=a/l,e=Yi(r,l,i),c=performance.now()-o,f=this.device;f.queue.writeBuffer(this.source,0,r),f.queue.writeBuffer(this.sea,0,e.mask);for(let N=0;N<2;N++){const q=new ArrayBuffer(32);new Uint32Array(q,0,4).set([l,Wi(n),N,i?1:0]),new Float32Array(q,16,4).set([s,s*s,Math.max(.1,s*.1),0]),f.queue.writeBuffer(this.uniform,N*256,q)}const d=(N,q,X=0)=>{N.setPipeline(this.program.values.get(q)),N.setBindGroup(0,this.group,[X*256]),q==="solveTile"?N.dispatchWorkgroups(Math.ceil(l/16),Math.ceil(l/16)):N.dispatchWorkgroups(q==="reset"||q==="clearNext"?1:Math.ceil(u/256))},y=performance.now(),w=f.createCommandEncoder(),P=w.beginComputePass();d(P,"reset"),d(P,"initialize"),P.end(),f.queue.submit([w.finish()]);let k=0,_=!1,m=32;const g=Math.max(256,l);for(;k<g;){const N=f.createCommandEncoder(),q=N.beginComputePass();for(let se=0;se<m;se++){const K=k+se&1;d(q,"clearNext",K),d(q,"solveTile",K)}q.end(),N.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),f.queue.submit([N.finish()]),k+=m,m=Math.min(m*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const X=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),X===0){_=!0;break}}if(!_)throw new Error(`Drainage hydrique GPU non convergé après ${k} passes (${l}²) ; repli CPU requis.`);const h=f.createCommandEncoder(),p=h.beginComputePass();d(p,"receivers");const L=Math.ceil(Math.log2(u));for(let N=0;N<L;N++){const q=N&1;d(p,"accumulateCopy",q),d(p,"accumulateScatter",q)}d(p,"finish",L&1),p.end();const U=u*16;h.copyBufferToBuffer(this.output,0,this.readback,0,U),h.copyBufferToBuffer(this.control,0,this.readback,U,16),f.queue.submit([h.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const A=performance.now()-y,E=performance.now();let R,b,z,j;try{const N=this.readback.getMappedRange(),q=new Uint32Array(N,U,4);if(q[2]!==0||q[3]!==u-e.count)throw new Error(`Drainage hydrique GPU invalide (${q[2]} erreurs, ${q[3]}/${u-e.count} cellules drainées) ; repli CPU requis.`);const X=new Float32Array(N,0,u*4),se=new Uint32Array(N,0,u*4);R=new Float32Array(u),b=new Uint32Array(u),z=new Float32Array(u),j=new Float32Array(u);for(let K=0;K<u;K++)R[K]=X[K*4],b[K]=se[K*4+1],z[K]=X[K*4+2],j[K]=X[K*4+3]}finally{this.readback.unmap()}const I=new Uint8Array(e.mask);return{filled:R,receivers:b,accumulation:z,potential:j,seaMask:I,preprocessingMs:c,computeMs:A,readbackMs:performance.now()-E,floodPasses:k}}}async function Ji(t,r,a,n,i=!1){if(![256,512,1024].includes(a)||t.length!==a*a||!Number.isFinite(r)||r<=0||!t.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const o=await Mt();if(!o||o.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const l=await ji(o.device);if(o.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=Xt.get(o.device);u||(u=new Map,Xt.set(o.device,u));let s=u.get(a);return s||(s=new Vi(o.device,a,l),u.set(a,s)),s.run(t,r,n,i)}const Zt=new WeakMap;function Ki(t){const r=Zt.get(t);if(r)return r;const a=new Float32Array(t.baseHeight.length),n=[],i=m=>t.drainageHeight[m]<t.rawDrainageHeight[m]&&t.surfaceHeight[m]<t.baseHeight[m];let o=!1;for(let m=0;m<a.length;m++){const g=i(m);g&&n.push(m),a[m]=g?0:t.surfaceHeight[m]-t.baseHeight[m],o||=a[m]!==0}const l=256,u=t.width/l,s=new Map,e=[],c=t.riverPoints,f=new Map,d=[],y=t.resolution,w=t.width/y,P=m=>Math.min(w*2,Math.max(w*.5,(t.baseHeight[m]-t.surfaceHeight[m])*1.4)),k=m=>((Math.imul(m^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const m of n){const g=m%y,h=Math.floor(m/y),p=(g+.5)*w,L=(h+.5)*w,U=[];for(let A=-1;A<=1;A++)for(let E=-1;E<=1;E++){const R=g+E,b=h+A,z=b*y+R;if(!E&&!A||R<0||b<0||R>=y||b>=y)continue;const j=i(z);(j&&z>m||!j&&t.basins[z]&&t.surfaceHeight[z]<=t.surfaceHeight[m])&&U.push(z)}U.length||U.push(m);for(const A of U){const E=(A%y+.5)*w,R=(Math.floor(A/y)+.5)*w,b=d.length,z=P(m),j=P(A),I=k(m),N=Math.max(z,j)*(1+Math.abs(I));d.push({a:m,b:A,ra:z,rb:j,skew:I});const q=Pe(Math.min(p,E)-N,u,l),X=Pe(Math.max(p,E)+N,u,l),se=Pe(Math.min(L,R)-N,u,l),K=Pe(Math.max(L,R)+N,u,l);for(let re=se;re<=K;re++)for(let fe=q;fe<=X;fe++){const de=re*l+fe,ge=f.get(de);ge?ge.push(b):f.set(de,[b])}}}if(t.incision>0)for(let m=0;m<t.riverCount;m++)for(let g=t.riverOffsets[m];g+1<t.riverOffsets[m+1];g++){const h=g+1,p=Math.max(c[g*4+2],c[h*4+2])*.65+.5,L=e.length;e.push({a:g,b:h,estuary:t.riverMeta[m*6+5]});const U=Pe(Math.min(c[g*4],c[h*4])-p,u,l),A=Pe(Math.max(c[g*4],c[h*4])+p,u,l),E=Pe(Math.min(c[g*4+1],c[h*4+1])-p,u,l),R=Pe(Math.max(c[g*4+1],c[h*4+1])+p,u,l);for(let b=E;b<=R;b++)for(let z=U;z<=A;z++){const j=b*l+z,I=s.get(j);I?I.push(L):s.set(j,[L])}}const _={delta:a,hasDelta:o,hasSea:t.basins.includes(0),buckets:s,segments:e,bucketSize:u,side:l,notchBuckets:f,notches:d};return Zt.set(t,_),_}const Pe=(t,r,a)=>Math.max(0,Math.min(a-1,Math.floor(t/r)));function Qt(t,r,a,n,i){const o=new Int32Array(a*4),l=new Float64Array(a*4);for(let u=0;u<a;u++){const s=Math.max(0,Math.min(i-1,(t+(u+.5)*r)/n-.5)),e=Math.floor(s),c=s-e,f=1-c;for(let d=0;d<4;d++)o[u*4+d]=Math.max(0,Math.min(i-1,e+d-1));l.set([f**3/6,(3*c**3-6*c*c+4)/6,(-3*c**3+3*c*c+3*c+1)/6,c**3/6],u*4)}return{indices:o,weights:l}}function Sn(t,r,a=!0){const n=t.resolution,i=t.width/n,o=Ki(r);if(!o.hasDelta&&!o.segments.length&&!o.notches.length)return;const l=a?new Float32Array(n*n):void 0;if(o.hasDelta){const g=r.resolution,h=r.width/g,p=Qt(t.x,i,n,h,g),L=Qt(t.y,i,n,h,g),U=L.indices[0],A=L.indices[L.indices.length-1],E=new Float64Array((A-U+1)*n);for(let R=U;R<=A;R++){const b=R*g,z=(R-U)*n;for(let j=0;j<n;j++){const I=j*4;E[z+j]=o.delta[b+p.indices[I]]*p.weights[I]+o.delta[b+p.indices[I+1]]*p.weights[I+1]+o.delta[b+p.indices[I+2]]*p.weights[I+2]+o.delta[b+p.indices[I+3]]*p.weights[I+3]}}for(let R=0;R<n;R++)for(let b=0;b<n;b++){const z=R*4;let j=E[(L.indices[z]-U)*n+b]*L.weights[z]+E[(L.indices[z+1]-U)*n+b]*L.weights[z+1]+E[(L.indices[z+2]-U)*n+b]*L.weights[z+2]+E[(L.indices[z+3]-U)*n+b]*L.weights[z+3];if(j>0&&o.hasSea&&t.height[R*n+b]<=0){const I=Math.max(0,Math.min(g-1,Math.floor((t.x+(b+.5)*i)/h))),N=Math.max(0,Math.min(g-1,Math.floor((t.y+(R+.5)*i)/h))),q=N*g+I;(!r.basins[q]||r.baseHeight[q]>=0)&&(j=0)}l&&(l[R*n+b]=j),t.height[R*n+b]+=j}}const u=new Set,{bucketSize:s,side:e}=o;for(let g=Pe(t.y,s,e);g<=Pe(t.y+t.width,s,e);g++)for(let h=Pe(t.x,s,e);h<=Pe(t.x+t.width,s,e);h++)for(const p of o.buckets.get(g*e+h)??[])u.add(p);const c=new Float32Array(n*n),f=r.riverPoints,d=(g,h)=>Math.max(0,Math.min(n-1,Math.floor((g-h)/i))),y=new Set;for(let g=Pe(t.y,s,e);g<=Pe(t.y+t.width,s,e);g++)for(let h=Pe(t.x,s,e);h<=Pe(t.x+t.width,s,e);h++)for(const p of o.notchBuckets.get(g*e+h)??[])y.add(p);const w=r.resolution,P=r.width/w,k=P*.25;for(const g of y){const{a:h,b:p,ra:L,rb:U,skew:A}=o.notches[g],E=Math.max(L,U)*(1+Math.abs(A)),R=(h%w+.5)*P,b=(Math.floor(h/w)+.5)*P,z=(p%w+.5)*P,j=(Math.floor(p/w)+.5)*P,I=z-R,N=j-b,q=I*I+N*N,X=Math.min(R,z)-E,se=Math.max(R,z)+E,K=Math.min(b,j)-E,re=Math.max(b,j)+E;if(se<t.x||X>t.x+t.width||re<t.y||K>t.y+t.width)continue;const fe=Math.abs(N)>1e-12,de=fe?E*Math.sqrt(q)/Math.abs(N):0;for(let ge=d(K,t.y);ge<=d(re,t.y);ge++){const Re=t.y+(ge+.5)*i,Me=fe?R+I*(Re-b)/N:0,Ge=fe?Math.max(X,Me-de):X,Ce=fe?Math.min(se,Me+de):se;if(!(Ge>Ce||Ce<t.x||Ge>t.x+t.width))for(let be=d(Ge,t.x);be<=d(Ce,t.x);be++){const pe=t.x+(be+.5)*i,Ae=q?Math.max(0,Math.min(1,((pe-R)*I+(Re-b)*N)/q)):0,Ne=Math.hypot(pe-R-I*Ae,Re-b-N*Ae),ae=k+(L+(U-L)*Ae-k)*(1+A*Math.sign((pe-R)*N-(Re-b)*I));if(Ne>=ae)continue;const ve=Math.max(0,(Ne-k)/(ae-k)),ye=1-ve*ve*(3-2*ve),Le=r.surfaceHeight[h]+(r.surfaceHeight[p]-r.surfaceHeight[h])*Ae,ze=ge*n+be;c[ze]=Math.max(c[ze],Math.max(0,t.height[ze]-Le)*ye)}}}for(const g of u){const{a:h,b:p,estuary:L}=o.segments[g],U=f[h*4],A=f[h*4+1],E=f[p*4],R=f[p*4+1],b=f[h*4+2],z=f[p*4+2],j=f[h*4+3],I=f[p*4+3],N=Math.max(Math.max(b,z)*.65,.5),q=E-U,X=R-A,se=q*q+X*X,K=Math.min(U,E)-N,re=Math.max(U,E)+N,fe=Math.min(A,R)-N,de=Math.max(A,R)+N;if(re<t.x||K>t.x+t.width||de<t.y||fe>t.y+t.width)continue;const ge=d(fe,t.y),Re=d(de,t.y),Me=Math.abs(X)>1e-12,Ge=Me?N*Math.hypot(q,X)/Math.abs(X):0;for(let Ce=ge;Ce<=Re;Ce++){const be=t.y+(Ce+.5)*i,pe=Me?U+q*(be-A)/X:0,Ae=Me?Math.max(K,pe-Ge):K,Ne=Me?Math.min(re,pe+Ge):re;if(Ae>Ne||Ne<t.x||Ae>t.x+t.width)continue;const ae=d(Ae,t.x),ve=d(Ne,t.x);for(let ye=ae;ye<=ve;ye++){const Le=t.x+(ye+.5)*i,ze=Math.max(0,Math.min(1,((Le-U)*q+(be-A)*X)/Math.max(se,.001))),Oe=b+(z-b)*ze,We=j+(I-j)*ze,qe=Math.hypot(Le-U-q*ze,be-A-X*ze),Fe=Math.max(0,1-qe/Math.max(Oe*.65,.5))**2;if(!Fe)continue;const le=Math.max(.35,Math.min(12,Oe*.11))*r.incision,Ke=Ce*n+ye,nr=Math.max(0,Math.min(le*2+.75,t.height[Ke]-(We-le)))*Fe*(L>1&&We<le?1.15:1);c[Ke]=Math.max(c[Ke],nr)}}}let _=1/0,m=-1/0;for(let g=0;g<n*n;g++)t.height[g]-=c[g],l&&(l[g]-=c[g]),_=Math.min(_,t.height[g]),m=Math.max(m,t.height[g]);if(l)for(let g=0;g<n;g++)for(let h=0;h<n;h++){const p=g*n+h,L=Math.max(0,h-1),U=Math.min(n-1,h+1),A=Math.max(0,g-1),E=Math.min(n-1,g+1),R=l[g*n+U]-l[g*n+L],b=l[E*n+h]-l[A*n+h];if(R===0&&b===0)continue;const z=Math.max(1e-6,t.normalZ[p]),j=-t.normalX[p]/z+R/((U-L)*i||i),I=-t.normalY[p]/z+b/((E-A)*i||i),N=Math.hypot(j,I,1);t.normalX[p]=-j/N,t.normalY[p]=-I/N,t.normalZ[p]=1/N}t.minHeight=_,t.maxHeight=m}const dt=new Float32Array(0);function en(t,r){const a={...t,normalX:dt,normalY:dt,normalZ:dt};Sn(a,r,!1),t.minHeight=a.minHeight,t.maxHeight=a.maxHeight}const Xi=(t,r)=>t.riverArea>0?t.riverArea:Math.max(.02,.003*(r/1e3)**2);class Pt{constructor(r,a,n,i,o,l){this.engine=r,this.baseHeight=a,this.backend=n,this.backendReason=i,this.drainageMs=o,this.gpu=l}static async create(r,a,n,i,o,l){const u=performance.now();let s,e,c;if(o!=="cpu")try{const d=await Ji(i,a,n,r,l);s=Tt.with_drainage(r,a,n,i,l,d.filled,d.receivers,d.accumulation),c=d}catch(d){e=`GPU hydrology unavailable: ${d instanceof Error?d.message:String(d)}`}const f=s?"gpu-f32":"cpu";return s??=new Tt(r,a,n,i,l),new Pt(s,i,f,e,performance.now()-u,c)}generate(r,a){const n=performance.now(),i=this.engine.generate(r.main,r.density,r.wetness,r.lakes,r.meanders,r.meanderIntensity,r.estuary,r.widthScale,r.incision,r.minLakeArea,r.lakeAbundance,r.lakeCoverage,r.maxLakeArea,r.depressionPolicy,r.maxBreachDepth,r.maxBreachLength,r.minLakeDepth,a.temperature,a.precipitation,r.coastalStreams);try{const o=i.stage_ms,l=i.stage_labels?Object.fromEntries(i.stage_labels.split(",").map((k,_)=>[k,o[_]])):void 0,u=i.basins;let s=0,e=0;for(const k of u)s=Math.max(s,k),k&&e++;const c=i.river_offsets,f=i.lake_meta,d=i.lake_closed;let y=0;for(let k=2;k<f.length;k+=6)y+=f[k];const w=i.river_meta;let P=!1;for(let k=4;k<w.length;k+=6)P||=(w[k]&2)!==0;return{width:i.width,resolution:i.resolution,receivers:i.receivers,accumulation:i.accumulation,basins:u,rawReceivers:i.raw_receivers??i.receivers,rawAccumulation:i.raw_accumulation??i.accumulation,rawBasins:i.raw_basins??u,flatLabels:i.flat_labels??new Uint32Array(u.length),flatRank:i.flat_rank??new Uint32Array(u.length),externalInflowArea:i.external_inflow_area??0,rawFilled:i.raw_filled??i.filled,rawDrainageHeight:i.raw_drainage_height??i.drainage_height,breachCount:i.breach_count??0,breachCutVolumeM3:i.breach_cut_volume_m3??0,avoidedFillVolumeM3:i.avoided_fill_volume_m3??0,filled:i.filled,lakeDepth:i.lake_depth,lakeLabels:i.lake_labels,baseHeight:this.baseHeight,drainageHeight:i.drainage_height,surfaceHeight:i.surface_height,adjustedHeight:i.adjusted_height,riverPoints:i.river_points,riverOffsets:c,riverMeta:w,riverFlare:i.river_flare,lakePoints:i.lake_points,lakeOffsets:i.lake_offsets,lakeMeta:f,lakeRingMeta:i.lake_ring_meta,lakeClosed:d,waterField:i.water_field,closedLakeCount:d.reduce((k,_)=>k+_,0),nodePoints:i.node_points,nodeMeta:i.node_meta,riverCount:c.length-1,lakeCount:f.length/6,basinCount:s,lakeFraction:y/Math.max(1,e*(i.width/i.resolution)**2),incision:r.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&r.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(r.main)&&!P?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-n,stageMs:l,generationMs:this.drainageMs+performance.now()-n,routingPotential:r.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{i.free()}}dispose(){this.engine.free()}}const Zi="magna-urbis-neural-models-v1",wt=["coarse","base","decoder"];class je extends Error{constructor(r,a,n){super(a,n),this.code=r}}function rn(t){const r=t;if(!r||typeof r.profile!="string"||!/^[a-f0-9]{64}$/.test(r.runtimeSha256))throw new je("manifest","Invalid neural model manifest.");if(r.runtimeJsSha256!==void 0&&!/^[a-f0-9]{64}$/.test(r.runtimeJsSha256))throw new je("manifest","Invalid neural runtime manifest.");for(const a of wt){const n=r.models?.[a];if(!n||!/^[\w.-]+$/.test(n.file)||!Number.isSafeInteger(n.bytes)||n.bytes<=0||!/^[a-f0-9]{64}$/.test(n.sha256))throw new je("manifest",`Invalid ${a} model manifest.`);if(n.chunks!==void 0&&(!Array.isArray(n.chunks)||!n.chunks.length||n.chunks.some(i=>!i||!/^[\w.-]+$/.test(i.file)||!Number.isSafeInteger(i.bytes)||i.bytes<=0||i.bytes>=5e7||!/^[a-f0-9]{64}$/.test(i.sha256))||new Set(n.chunks.map(i=>i.file)).size!==n.chunks.length||n.chunks.reduce((i,o)=>i+o.bytes,0)!==n.bytes))throw new je("manifest",`Invalid ${a} model chunks.`)}return r}async function _n(t=!0){try{if(!globalThis.caches)throw new Error("Cache Storage unavailable");return await caches.open(Zi)}catch(r){if(t)throw new je("storage","Cannot access browser model storage.",{cause:r})}}async function Qi(t,r){const a=new URL("models/manifest.json",t),n=await _n(!1),i=AbortSignal.timeout(15e3);try{const o=await fetch(a,{cache:"no-cache",signal:r?AbortSignal.any([r,i]):i});if(!o.ok)throw new Error(`HTTP ${o.status}`);const l=rn(await o.json());return await n?.put(a,new Response(JSON.stringify(l),{headers:{"Content-Type":"application/json"}})).catch(()=>{}),{manifest:l,offline:!1}}catch(o){const l=await n?.match(a);if(l)return{manifest:rn(await l.json()),offline:!0};throw new je("manifest","Neural model catalogue unavailable on this address.",{cause:o})}}function ea(t,r){const a=new URL(`models/${r.file}`,t);return a.searchParams.set("sha256",r.sha256),a.href}async function Wr(t,r){if(t.byteLength!==r.bytes)return!1;const a=await crypto.subtle.digest("SHA-256",t);return Array.from(new Uint8Array(a),n=>n.toString(16).padStart(2,"0")).join("")===r.sha256}async function ra(t,r,a,n={}){const{signal:i,onProgress:o}=n,l=r.models[a],u=ea(t,l);i?.throwIfAborted();const s=await _n(n.requireStorage??!1);s||n.onStorageFailure?.();const e=await s?.match(u);if(e){const d=new Uint8Array(await e.arrayBuffer());o?.({name:a,phase:"verify",received:d.length,total:l.bytes});const y=await Wr(d,l);if(i?.throwIfAborted(),y)return d;await s?.delete(u)}const c=new Uint8Array(l.bytes);let f=0;for(const d of l.chunks??[l]){const y=new URL(`models/${d.file}`,t);y.searchParams.set("sha256",d.sha256);const w=await fetch(y.href,{signal:i});if(!w.ok)throw new je("download",`Cannot download ${a} weights: HTTP ${w.status}`);const P=f;if(w.body){const k=w.body.getReader();try{for(;;){i?.throwIfAborted();const{done:_,value:m}=await k.read();if(_)break;if(f+m.byteLength>P+d.bytes)throw new je("integrity",`Invalid ${a} model size.`);c.set(m,f),f+=m.byteLength,o?.({name:a,phase:"download",received:f,total:l.bytes})}}catch(_){throw await k.cancel().catch(()=>{}),_}finally{k.releaseLock()}}else{const k=new Uint8Array(await w.arrayBuffer());f+=k.byteLength,k.byteLength===d.bytes&&c.set(k,P)}if(f-P!==d.bytes||l.chunks&&!await Wr(c.subarray(P,f),d))throw new je("integrity",`Invalid ${a} model chunk: integrity check failed.`)}if(i?.throwIfAborted(),o?.({name:a,phase:"verify",received:f,total:l.bytes}),f!==l.bytes||!await Wr(c,l))throw new je("integrity",`Invalid ${a} model: integrity check failed.`);if(i?.throwIfAborted(),s){o?.({name:a,phase:"save",received:f,total:l.bytes});try{await s.put(u,new Response(c,{headers:{"X-Magna-Model-Name":a,"X-Magna-Model-Bytes":String(l.bytes),"X-Magna-Model-Profile":r.profile}}))}catch(d){if(n.requireStorage)throw new je("storage","Cannot save model: browser storage is full or unavailable.",{cause:d});n.onStorageFailure?.()}}return c}async function ta(t,r,a){const n=await globalThis.caches?.open("magna-urbis-neural-runtime-v1");async function i(u,s){const e=new URL(u,t);e.searchParams.set("sha256",s??r.runtimeSha256);const c=w=>s?Wr(w,{bytes:w.length,sha256:s}):Promise.resolve(!0),f=await n?.match(e);if(f){const w=new Uint8Array(await f.arrayBuffer());if(await c(w))return w;await n?.delete(e)}const d=await fetch(e,{signal:a});if(!d.ok)throw new Error("Neural runtime unavailable. Check your connection and retry.");const y=new Uint8Array(await d.arrayBuffer());if(!await c(y))throw new Error("Neural runtime integrity check failed. Please retry.");return await n?.put(e,new Response(y)),y}const o=await i("magna_urbis_neural_wasm.js",r.runtimeJsSha256),l=await i("magna_urbis_neural_wasm_bg.wasm",r.runtimeSha256);return{javascript:o,wasm:l}}let tn="",Hr,xt="",fr,nn="";function Mn(t,r){if(new URL(t).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const a=t+(r?.runtimeSha256??"")+(r?.runtimeJsSha256??"");return(tn!==a||!Hr)&&(tn=a,Hr=(async()=>{if(r){const{javascript:o,wasm:l}=await ta(t,r),u=URL.createObjectURL(new Blob([o],{type:"text/javascript"}));try{const s=await import(u);return await s.default({module_or_path:l}),s}finally{URL.revokeObjectURL(u)}}const i=await import(new URL("magna_urbis_neural_wasm.js",t).href);return await i.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",t)}),i})().catch(n=>{throw Hr=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Hr}async function zt(){if(fr){try{(await fr).free()}catch{}fr=void 0,xt=""}}async function na(t,r,a,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:i}=await Qi(t),o=[i.runtimeSha256,...wt.map(s=>i.models[s].sha256)].join(":");(xt!==t+o||!fr)&&(await zt(),xt=t+o,fr=(async()=>{const s=await Mn(t,i);nn=o;const e=[];for(const c of wt){const f=i.models[c];n?.(`Neuronal WASM · ${c} · ${(f.bytes/1e6).toFixed(1)} Mo`),e.push(await ra(t,i,c,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),s.NeuralRelief.create(e[0],e[1],e[2])})().catch(s=>{throw fr=void 0,s}));const l=await fr;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await l.generate_json(JSON.stringify(Object.fromEntries(r)),a?JSON.stringify(a):"");try{const s=new Float32Array(u.heights),e=JSON.parse(u.meta),c=Number(r.get("extent")??4e4),f=Number(r.get("resolution")??Math.ceil(c/Number(r.get("sampleSpacing")??30))),d=e.resolution;if(e.extent!==c||e.nativeCellM!==30||e.nativeResolution!==Math.ceil(c/30)||typeof d!="number"||!Number.isInteger(d)||d!==f||s.length!==d*d||e.outputCellM!==c/d||s.some(y=>!Number.isFinite(y)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:s,meta:{...e,modelIdentity:nn}}}finally{u.free()}}let an;async function Pn(t,r,a,n){an??=St();const{seed:i,width:o,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sketch:y,source:w}=t,P=y?.processing,k=tr(t),_={seed:i,width:o,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sampleSpacing:k.requestedSpacing,sourceN:k.n,coastMask:t.coastMask??0,islandMode:t.islandMode??"island",source:w,...P?{sketch:{processing:P},surface:Array.from($r(yr(y),k.n))}:{}},g=await(await Lr(r,"/terrain",JSON.stringify({session:an,settings:_,region:a,field:n}))).arrayBuffer();if(g.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const h=new DataView(g).getUint32(0,!0);if(h%4||4+h>g.byteLength)throw new Error("En-tête terrain local invalide.");const p=JSON.parse(new TextDecoder().decode(new Uint8Array(g,4,h)));let L=4+h;const U={};for(const R of p.arrays){const b=R.count*(R.type==="f32"?4:1);if(!Number.isSafeInteger(R.count)||R.count<0||L+b>g.byteLength)throw new Error("Raster terrain local incomplet.");U[R.name]=R.type==="f32"?new Float32Array(g,L,R.count):new Uint8Array(g,L,R.count),L+=b}const A=U.height,E=p.resolution*p.resolution;if(!Number.isInteger(p.resolution)||p.resolution<64||p.resolution>1024||!A||A.length!==E||!A.every(Number.isFinite)||["normalX","normalY","normalZ"].some(R=>U[R]?.length!==E))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(p.fieldFloor)||!Number.isInteger(p.fieldN)||p.fieldN!==k.n||U.field?.length!==p.fieldN*p.fieldN||!U.field.every(Number.isFinite)||U.physical?.length!==p.fieldN*p.fieldN||!U.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:p.session,x:p.x,y:p.y,width:p.width,resolution:p.resolution,minHeight:p.minHeight,maxHeight:p.maxHeight,globalMinHeight:p.globalMinHeight,globalMaxHeight:p.globalMaxHeight,motifSize:p.motifSize,height:A,normalX:U.normalX,normalY:U.normalY,normalZ:U.normalZ,caveMask:U.caveMask,prepareMs:p.prepareMs,samplingMs:p.samplingMs,generationMs:p.prepareMs+p.samplingMs,generationBackend:"native",generationReason:p.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${p.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:p.erosionDefaults,...U.field?{field:{n:p.fieldN,data:U.field,exact:p.fieldExact,floor:p.fieldFloor,...U.physicalCave?{cave:U.physicalCave}:{}}}:{},...U.physical?{physical:{n:p.fieldN,height:U.physical}}:{},definition:k}}function ia(t){if(t.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return Pn(t.settings,t.runtime,t.region,t.kind==="overview")}async function aa(t,r){const a=await Pn(t,r,{x:0,y:0,extent:t.width,resolution:64},!0);if(!a.field||a.field.data.length!==tr(t).n**2)throw new Error("Surface physique native absente.");return{height:a.field.data,prepareMs:a.prepareMs??0,samplingMs:a.samplingMs??0,session:a.session,fieldExact:a.field.exact,erosionDefaults:a.erosionDefaults}}const oa="[relief_session_missing]",on=t=>Array.from(t,r=>Number.isFinite(r)?r:null),sa=t=>new Uint8Array(t.buffer,t.byteOffset,t.byteLength);class cr{constructor(r,a){this.runtime=r,this.tuning=a,this.session=St(),this.steps=[],this.released=!1}static async build(r,a,n,i){const o=new cr(r,i.slice());return await o.mutate({op:"build",...a},n),o}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,r=>r??NaN)}editSurface(r){return this.mutate({op:"edit"},r)}coast(r,a,n,i){return this.mutate({op:"coast",mask:r,mode:a,surface:!!i,...n?{tuning:on(n)}:{}},i)}carveUnderdark(r,a){return this.mutate({op:"underdark",seed:r,...a!==void 0?{tunnels:a}:{}})}async sampleRegion(r,a,n,i){const{meta:o,arrays:l}=await this.send({op:"read",region:{x:r,y:a,extent:n,resolution:i}}),u=o.region,s=l.height;if(!u||!s||s.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:s,cave_mask:l.caveMask,normal_x:l.normalX,normal_y:l.normalY,normal_z:l.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}async underdarkTunnels(){return(await this.send({op:"read",tunnels:!0})).arrays.tunnels??new Float32Array(0)}free(){this.released||(this.released=!0,this.steps.length=0,Lr(this.runtime,"/release",JSON.stringify({session:this.session})).then(r=>r.arrayBuffer(),()=>{}))}async mutate(r,a){this.meta=(await this.send(r,a)).meta,this.steps.push({header:r,plane:a})}async send(r,a){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(r,a)}catch(n){if(r.op==="build"||!(n instanceof Error)||!n.message.includes(oa))throw n;for(const i of this.steps)await this.call(i.header,i.plane);return this.call(r,a)}}async call(r,a){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:on(this.tuning),...r})),i=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);i.set(n);const o=new Uint8Array(4);new DataView(o.buffer).setUint32(0,i.length,!0);const u=await(await Lr(this.runtime,"/terrain/relief",new Blob([o,i,...a?[sa(a)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const s=new DataView(u).getUint32(0,!0);if(s%4||4+s>u.byteLength)throw new Error("Native relief reply header invalid.");const e=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,s))),c={};let f=4+s;for(const{name:d,type:y,count:w}of e.arrays){const P=w*(y==="f32"?4:1);if(!Number.isSafeInteger(w)||w<0||f+P>u.byteLength)throw new Error("Native relief plane incomplete.");c[d]=y==="f32"?new Float32Array(u,f,w):new Uint8Array(u,f,w),f+=P}return{meta:e,arrays:c}}}const la=["plateau","volcano","caldera"],qr=t=>t==="neural-wasm"||t==="neural-python"||t==="neural",ca="http://127.0.0.1:8792",ua="http://127.0.0.1:8793";function fa(t,r){const a=t==="neural-python"?ua:ca,n=r?.trim().replace(/\/+$/,"");if(!n)return a;try{const i=new URL(n);if(i.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(i.hostname)&&["8792","8793"].includes(i.port)&&i.pathname==="/"&&!i.search&&!i.hash&&!i.username&&!i.password)return a}catch{}return n}const zn={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},da={flat:20,hills:110,plateau:100},lr=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],Yr=t=>t.climateValues??oi[t.climate??"temperate"];function sn(t){const r=new Float32Array(t.height.length);let a=0,n=0;for(let l=0;l<t.height.length;l++)t.height[l]>0&&(r[n++]=t.height[l],a+=Math.acos(Math.min(1,t.normalZ[l])));const i=r.subarray(0,n).sort(),o=l=>n?i[Math.min(n-1,Math.floor(l*n))]:0;return{p5:o(.05),p50:o(.5),p95:o(.95),slope:a/Math.max(1,n),land:n/Math.max(1,t.height.length)}}let Zr,F,ur="",Dr="",vr,ar="",Rr,mr,$e,or=!1,$;const De=()=>$??F,Nr=()=>$?$.physicalHeightField():Promise.resolve(F.physical_height_field()),ln=async()=>{if($)return $.underdarkTunnels().catch(()=>new Float32Array(0));const t=F?.underdark_tunnels;return t?t.call(F):new Float32Array(0)},pt=()=>$?$.samplingBaseField():Promise.resolve(F.sampling_base_field());let rr="",Qe,gr,ue,er,Ie="cpu",Te,cn=Promise.resolve(),He,xr="",br="",Ee,Br,Vr="";async function Un(){if(!Vr)return;const t=Vr;Vr="";try{await fetch(`${t}/release`,{method:"POST"})}catch{}}let kr,Q,Ve;const Sr=new bt;function ga(){Kr(),Ni(),Sr.clear(),vr=void 0,ue?.dispose(),ue=void 0,er=void 0,F?.free(),F=void 0,$?.free(),$=void 0,ur="",rr="",or=!1,$e=void 0,He?.dispose(),He=void 0,Q=void 0,Ve=void 0,Ee=void 0,xr="",br="",kr=void 0}async function pa(t,r){const a=tr(t),n=Math.ceil(t.width/30),i=(m,g)=>g.extent===t.width&&g.resolution===a.n&&g.nativeCellM===30&&g.nativeResolution===n&&g.outputCellM===t.width/a.n&&m.length===a.n*a.n&&m.every(Number.isFinite),o=fa(t.source,t.neuralServer),l=new URLSearchParams({seed:t.seed,relief:t.relief,mix:String(t.relief==="mixed"?t.mountainMix:.5),coasts:"0",islands:"island",climate:t.climate??"temperate",noise:String(t.fidelity??.05),extent:String(t.width),sampleSpacing:String(a.requestedSpacing),resolution:String(a.n)}),u=Yr(t),s=t.neuralTuning??zn;for(const[m,g]of Object.entries(u))l.set(m,String(g));l.set("landScale",String(s.landScale)),l.set("steps",String(s.steps)),l.set("detail",String(s.detail));for(const m of["coarseModel","baseModel","decoderModel"])t[m]&&l.set(m,t[m]);for(const m of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])l.set(m,String(s[m]));l.set("histogram",s.histogram.join(","));const e=da[t.relief];s.reliefMode==="fixed"?l.set("reliefFixed",String(s.reliefFixed)):s.reliefMode==="auto"&&e!==void 0?l.set("reliefFixed",String(e)):l.set("reliefScale",String(s.reliefMode==="scale"?s.reliefScale:1));const c=li(t.width,t.width,t.neuralFit??"crop",t.neuralSlopes??!0),f=t.zones?{zones:vn(t.zones),region:{x:c.x,y:c.y,width:c.width}}:t.sketch?ci(yr(t.sketch),c):void 0,d=performance.now();if(t.source==="neural-wasm"){if(await Un(),!t.neuralAssets)throw new Error("Neural browser runtime URL missing.");const m=await na(t.neuralAssets,l,f,r);if(!i(m.heights,m.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:m.heights,info:{...m.meta,requestMs:performance.now()-d}}}await zt();let y=f;if(t.source==="neural-python"){if(t.zones&&(await fetch(`${o}/status`,{cache:"no-store"}).then(p=>p.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!t.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const m=await Mn(t.neuralAssets),g=Object.fromEntries(l);y={params:g,conditioning:JSON.parse(m.conditioning_json(JSON.stringify(g),f?JSON.stringify(f):"")),edited:!!f},r?.("Neural Python · computing with PyTorch/CUDA")}const w={cache:"no-store",...y?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(y)}:{}};let P;if(t.source==="neural")P=await ui({profile:"local",server:o},`/generate?${l}`,w);else try{P=await fetch(`${o}/generate?${l}`,w)}catch{throw new Error(`Neural service unreachable (${o}): run “npm run neural:python” from web/`)}if(!P.ok)throw new Error(`Neural service: ${await P.text()}`);const k=new Float32Array(await P.arrayBuffer()),_=JSON.parse(P.headers.get("X-Neural-Meta")??"{}");if(t.source==="neural-python"&&(Vr=o),f&&(_.edited!==!0||_.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!i(k,_))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:k,info:{..._,requestMs:performance.now()-d}}}function ha(t){return Zr??=(async()=>{ni()?(t?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await ii(),t?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await ai(()=>vi(wi,r=>yi({module_or_path:r}),t))})()}mn(()=>{Sr.clear(),Zr=void 0,F=void 0,$?.free(),$=void 0,ur="",rr="",or=!1,He=void 0,Ee=void 0,xr="",br="",kr=void 0,Q=void 0,Ve=void 0});function va(t,r,a,n){const i=cn.then(()=>un(t,r,a,n).catch(async o=>{if(!await Wn(o))throw o;return a?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),un(t,r,a,n)}));return cn=i.catch(()=>{}),i}async function un(t,r,a,n){const{settings:i,region:o,kind:l,display:u,runtime:s}=t,e=i.islandMode?.startsWith("traced:")&&(i.sketch?.processing||i.relief==="cavern"||i.underdark)?{...i,islandMode:"island"}:i,c=tr(e);if(Yn(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning}),e.climateZone==="wetland"&&(e.erosionTuning={carve:0,finalCarve:0,surfaceCarve:0,...e.erosionTuning});const f=e.compute==="wasm"?"wasm":"gpu-f32",d=e.generationCompute??"gpu-erosion";if(Vn(e,c.n))throw new Error(`GPU generation is limited to ${Jn}² cells; requested spacing ${c.spacing.toFixed(2)} m (${c.n}²). Choose CPU or native.`);const y=Je(e.generalSeed??e.seed,"relief-coast-cut"),w=!!e.generalSeed&&gt(e.generalSeed,S=>S.startsWith("relief-"))!==gn(e.generalSeed),P=Qr(e),k=e.hydrology?.compute==="auto"&&(f==="wasm"||d==="cpu")?"cpu":e.hydrology?.compute??"auto";if(k!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&Mt(),P&&!e.zones&&!e.sketch?.processing&&(!Kn.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const _=d==="native"&&!qr(e.source);if(_&&s?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(_&&e.relief==="cavern")return ia({...t,settings:e});const m=la.includes(e.relief)?e.environment??"mixed":"mixed",g=e.sketch?.processing,h=ie(e,"coasts")?e.relief==="cavern"||e.underdark?0:e.coastMask??0:0,p=e.islandMode??"island",L=zi.includes(e.relief),U=f!=="wasm"&&L?Ui(f,e.relief).catch(()=>{}):void 0;Zr&&a?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await ha(a)}catch(S){throw Zr=void 0,S}const A=performance.now();U&&a?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const E=U?await _r(U):void 0;n&&await n.after("prepare");const R=(S,x)=>{const T=$e;$e={erosionSpacing:S===void 0?T?.erosionSpacing:Math.max(T?.erosionSpacing??0,S),regionalErosionSpacing:x===void 0?T?.regionalErosionSpacing:Math.max(T?.regionalErosionSpacing??0,x)},Object.assign(c,$e)},b=async(S,x=!1)=>{let T=x&&ie(e,"phasor",!1)?mt(S,e):S;const Y=Lt(e),V=Ot(e),oe=Jr(e);for(const C of["posterior","wind"]){const O=JSON.stringify([oe.get(C),s?.server,!!E,si(new Uint8Array(T.buffer,T.byteOffset,T.byteLength))]),ce=e.procedural?Sr.get(C,O):void 0;if(ce){T=ce,n?.cached?await n.cached(C,n.previews===!1?void 0:T):(await n?.before(C),await n?.after(C,n.previews===!1?void 0:T));continue}if(await n?.before(C),C==="posterior"&&e.procedural&&ie(e,C)&&Y.mode!=="none"){const H=T,te=Math.sqrt(T.length);T=(await Ft(T,te,e.width,Y,{stats:!1},s)).height;for(let Z=0;Z<T.length;Z++)T[Z]=H[Z]>0?Math.max(.3,T[Z]):T[Z]}C==="wind"&&e.procedural&&ie(e,C)&&V.iterations&&V.transport&&(T=E?await Si(E.context,T,e.width,V):ki(T,e.width,V)),e.procedural&&c.n<=1024&&Sr.put(C,O,T),await n?.after(C,n.previews===!1?void 0:T)}return e.procedural&&T.some(C=>C<.3)?T.map(C=>Math.max(.3,C)):T},z=E?_r(E.pipeline).then(S=>({pipeline:S}),()=>{}):void 0,j=!_&&!e.zones&&!e.sketch&&d!=="cpu"&&f!=="wasm"&&!qr(e.source)&&e.relief!=="cavern",I=j&&E?Fi(E.context,e):void 0;if(I?.error&&e.generationCompute)throw new Error(I.error);const N=e.generationCompute||!I?void 0:I.error??(Xn(I)?`Source ${c.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),q=!!I&&!I.error&&!N,X=j&&Ci.includes(e.relief),se=X&&q,K=(c.n!==1024||!!(e.procedural||n||w))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!qr(e.source)&&(!se||d!=="gpu-erosion"),re=!g&&qr(e.source);re||(await zt(),await Un());const fe=s?.profile==="local"&&(_||re),de=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,at(e.modification.delta)]):"",ge=JSON.stringify([e.zones,de,!!e.underdark,y,_?[s.server,h,p]:null,fe?s.server:null])+"|"+JSON.stringify(re?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,Yr(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??zn,e.width,c.n,e.coarseModel,e.baseModel,e.decoderModel,e.neuralFit,e.neuralSlopes]:[e.seed,...e.generalSeed?[gt(e.generalSeed,S=>S.startsWith("relief-"))]:[],e.width,c.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,_?"native":P?[d,f,!!E]:X?d:"cpu",m,e.sketch,e.erosionTuning??{},...e.procedural?[Zn,e.procedural,e.climate,e.climateValues,e.climateZone,se?null:[h,p]]:[],...P||e.procedural?.enabled?.phasor?[ot,e.climate??"temperate",e.phasor??{}]:[]]);let Re=0,Me=0,Ge=0,Ce=0,be=0,pe;if(n&&n.previews!==!1||!(F||$)||ur!==ge){ue?.dispose(),ue=void 0,er=void 0,F?.free(),F=void 0,$?.free(),$=void 0,or=!1,ur="",rr="",$e=void 0;const S=performance.now();ar="",Dr="",Rr=void 0,mr=void 0,vr=void 0,Ie="cpu",Te=void 0;const x=e.relief==="mixed"?e.mountainMix:.5;Br=void 0;const T=Float64Array.from(lr,C=>{let O=P&&!e.procedural?NaN:e.procedural?.erosionTuning?.[C]??e.erosionTuning?.[C]??NaN;return e.procedural?.biome&&!se&&!K&&(C==="incision"||C==="thermal")&&(O=(Number.isFinite(O)?O:1)*(C==="incision"?Ar(e).water:Ar(e).thermal)),O});if(Er(T),K){a?.(N?`${N} Rust CPU generation at ${c.spacing.toFixed(2)} m…`:_?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const C=await b(await xi(e,n,_?s:void 0,se&&E?()=>Dt(E.context,e,a):void 0,(O,ce)=>{$e={erosionSpacing:O,regionalErosionSpacing:ce},Object.assign(c,$e)}));n&&await n.before("retain"),fe?$=await cr.build(s,{kind:"source",seed:y,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:x,environment:m},C,T):F=_e.with_source(y,e.width,e.relief,e.erosion,e.motifSize,x,C,m),n&&await n.after("retain",n.previews===!1?void 0:C),Ie=_?"native":se?d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":P?"compact-cpu":"cpu",Te=N??`${_?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(_){a?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${c.n} × ${c.n} physical field`});const C=e.procedural?.biome?{...e,coastMask:h,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*Ar(e).water,thermal:(e.erosionTuning?.thermal??1)*Ar(e).thermal}}:{...e,coastMask:h},O=await aa(C.sketch&&!g?{...C,sketch:void 0}:C,s),ce=g!=="surface"&&e.procedural&&!e.zones?await b(O.height.slice(),!0):void 0;if(ce&&h)for(let H=0;H<ce.length;H++)O.height[H]<=0&&(ce[H]=O.height[H]);$=await cr.build(s,{kind:"surface",seed:y,width:e.width},ce??O.height,T),Ie="native",Te="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",be=O.prepareMs}else if(g){a?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const C=$r(yr(e.sketch),c.n);if(g==="erosion"){a?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),F=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,m,c.n),F.set_edited_surface(C);const O=F.sampling_base_field();F.free(),F=_e.with_surface(y,e.width,O)}else F=_e.with_surface(y,e.width,C);Te=g==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if(re){const C=await pa(e,a),O=Qn(C.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);fe?$=await cr.build(s,e.zones?{kind:"zonedSurface",seed:y,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:y,width:e.width},O,T):F=e.zones?_e.with_zoned_surface(y,e.width,e.motifSize,O,JSON.stringify(e.zones)):_e.with_surface(y,e.width,O),Br=C.info,Ie="neural",e.zones&&(Te="Zones → regional conditioning and local neural relief, then sea operation.")}else if(P&&!e.zones)if(E&&q){a?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const C={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:R},O=await b(await Jt(E.context,e,C,a));n&&await n.before("retain"),pe=C.profiles,F=_e.with_source(y,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,x,O,m),n&&await n.after("retain",O),Ie="compact-gpu-f32",Te=`${ot} · compact preset · ${e.procedural?.regionalN??Gt(e).n}² grid · ${e.climate??"temperate"} · Phasor ${ie(e,"phasor",!0)?"enabled":"disabled"}.`}else{a?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const C=e.procedural?.biome?Ar(e):void 0,O=C?{incision:C.water,thermal:C.thermal}:e.procedural?{incision:1,thermal:1}:ei(e),ce=e.procedural?.erosionTuning?.iterations??Gt(e).steps,H=e.erosionTuning??{},te={...H,iterations:ce,surfaceIterations:ie(e,"surface",!1)?H.surfaceIterations??12:0,detail:ie(e,"ridged",!1)?H.detail:0,warp:H.warp??0,incision:(H.incision??1)*O.incision,thermal:(H.thermal??1)*O.thermal};Er(Float64Array.from(lr,he=>te[he]??NaN));let Z;try{Z=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,m,c.n);const he=Z.physical_height_field();F=_e.with_source(y,e.width,"hills",e.erosion,e.motifSize,x,ie(e,"phasor",!0)?mt(he,e):he,m)}finally{Z?.free(),Er(new Float64Array(lr.length).fill(NaN))}Ie="compact-cpu",Te=`${ot} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)a?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n} × ${c.n} physical field`}),F=_e.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,m,JSON.stringify(vn(e.zones)),c.n),Te="Zone masks → uplift, noise, ridges and Rust erosion.";else if(se&&E)try{if(d==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const C={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:R},O=await b(await Jt(E.context,e,C,a));n&&await n.before("retain"),be=C.nativeEnvironmentMs,pe=C.profiles,Ce=performance.now()-S-be,F=_e.with_source(y,e.width,e.relief,e.erosion,e.motifSize,x,O,m),n&&await n.after("retain",O),Ie="gpu-erosion-f32"}else{const C=await Dt(E.context,e,a);Me=performance.now()-S;const O=performance.now();a?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),F=_e.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,C.coarse,C.fine,m),Ge=performance.now()-O,Ie=d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(C){if(n||e.procedural)throw C;Te=`GPU generation unavailable: ${C instanceof Error?C.message:String(C)}`}if(!F&&!$&&(a?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n}² physical source at ${c.spacing.toFixed(2)} m`}),F=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,m,c.n),N&&(Te=N)),!g&&!re&&e.sketch&&e.relief!=="cavern"){const C=yr(e.sketch),O=await Nr(),ce=ri(C,O,c.n);$?await $.editSurface(ce):F.set_edited_surface(ce),Te="Edited sketch + procedural detail and Rust erosion."}const Y=Lt(e),V=Ot(e),oe=ie(e,"posterior")&&Y.mode!=="none"||ie(e,"wind")&&V.iterations>0&&V.transport>0;if(!K&&e.procedural&&(oe||!P&&ie(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(Ie)&&!re&&!g&&!_&&!e.zones){F.set_coast(h,p);const C=F.physical_height_field(),O=await b(C,!P);F.free(),F=_e.with_surface(y,e.width,O),or=!0}e.modification&&(re||g)&&(vr=await pt()),Re=performance.now()-S,ur=ge}else if(a?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),$e&&Object.assign(c,$e),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const S of["grids",...kt(e),"phasor","posterior","wind"])await n.cached(S);const Ae=JSON.stringify([ge,y,h,p,Jr(e).get("coasts"),Ie,s?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,at(e.sketch.heights)],e.zones&&[e.zones.resolution,at(e.zones.weights)]]),Ne=!!(e.procedural||re||g)&&!or&&!(_&&!K),ae=Ne&&h?Sr.get("coasts",Ae):void 0;!ae&&n&&await n.before("coasts");const ve=!re&&!g&&!or&&!I?.error&&!N&&!e.zones&&!e.sketch&&h!==0&&d!=="cpu"&&f!=="wasm",ye=JSON.stringify([y,h,h?p:"island",h?ve:!1,e.procedural?.coastIterations,e.procedural?.coastIncision,e.procedural?.coastThermal,e.procedural?.coastDiffusion,e.erosionTuning]);let Le=0;if(vr&&ar&&ar!==ge+"|"+ye){if(ue?.dispose(),ue=void 0,er=void 0,$){const S=$;$=await cr.build(s,{kind:"surface",seed:y,width:e.width},vr,new Float64Array(lr.length).fill(NaN)),S.free()}else F?.free(),F=_e.with_surface(y,e.width,vr);rr="",ar="",mr=void 0,Rr=void 0,Dr=""}if(_&&!K||or)rr=ye,Qe=or&&h?"cpu":void 0,gr=void 0;else if(rr!==ye){ue?.dispose(),ue=void 0,er=void 0,Qe=void 0,gr=void 0;const S=performance.now();a?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const x=e.procedural,T={...e.erosionTuning,...x?.erosionTuning},Y=h?Float64Array.from(lr,V=>x&&V==="surfaceIterations"?x.coastIterations??(P?2:12):V==="surfaceIncision"?(T[V]??1)*(x?.coastIncision??1):V==="surfaceThermal"?(T[V]??1)*(x?.coastThermal??1):V==="surfaceDiffusion"?(T[V]??1)*(x?.coastDiffusion??1):T[V]??NaN):void 0;if($?(await $.coast(h,p,ae?void 0:Y,ae),h&&(Qe="native")):ae&&(F.configure_coast(h,p),F.set_coast_surface(ae),Qe="cpu"),!$&&!ae&&ve&&E){let V;try{const oe=await z;if(!oe||E.context.lost)throw new Error("WebGPU unavailable");F.configure_coast(h,p),V=new $t(E.context,oe.pipeline,f,F);const C=V.prepareCoastField(e),O=await Ii(E.context,e,C,F.coast_erosion_parameters(),a);F.set_coast_surface(O),Qe="gpu-f32"}catch(oe){gr=`GPU coast unavailable: ${oe instanceof Error?oe.message:String(oe)}`}finally{V?.dispose()}}if(!$&&!Qe){Y&&Er(Y);try{F.set_coast(h,p)}finally{Y&&Er(Float64Array.from(lr,V=>T[V]??NaN))}h&&(Qe="cpu"),ve&&!E&&(gr="WebGPU unavailable")}rr=ye,Le=h?performance.now()-S:0,Re+=Le}const ze=h&&Ne&&(!ae&&c.n<=1024||n&&n.previews!==!1&&!(ae&&n.cached))?await pt():void 0;if(ze&&!ae&&c.n<=1024&&Sr.put("coasts",Ae,ze),ae&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:ae):n&&await n.after("coasts",n.previews===!1?void 0:ze),e.modification&&ar!==ge+"|"+ye){const S=De().source_resolution(),x=g==="surface"&&!h?$r(yr(e.sketch),S):await Nr();if(Rr={n:S,height:x.slice()},mr=ti(x,S,e.modification),ue?.dispose(),ue=void 0,er=void 0,$){const T=$;$=await cr.build(s,{kind:"surface",seed:y,width:e.width},mr,new Float64Array(lr.length).fill(NaN)),T.free()}else F?.free(),F=_e.with_surface(y,e.width,mr);ar=ge+"|"+ye}e.underdark&&Dr!==ge+"|"+ye+"|"+ar+"|"+(e.underdarkTunnels??"")&&(a?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),ue?.dispose(),ue=void 0,er=void 0,$?await $.carveUnderdark(e.seed,e.underdarkTunnels):F.carve_underdark(e.seed,e.underdarkTunnels),Dr=ge+"|"+ye+"|"+ar+"|"+(e.underdarkTunnels??""));let Oe;const We=async(S,x,T)=>((Oe?.delta!==S||Oe.m!==x||Oe.n!==T)&&(Oe={delta:S,m:x,n:T,out:await gi(S,x,T,s)}),Oe.out);async function qe(S){$e?Object.assign(c,$e):c.erosionSpacing??=De().erosion_spacing(),S.definition=c,n&&await n.after("sampling",S.height),n&&await n.before("hydrology");const x=ie(e,"hydrology")?e.hydrology:void 0;S.neural=Br,l==="overview"&&!re&&e.relief!=="cavern"&&(S.erosionDefaults=Array.from(fi(e.relief,e.width,e.motifSize,e.mountainMix)));const T=!!x?.enabled&&e.relief!=="cavern",Y=x?.engine!=="rust",V=x?.erosionEnabled!==!1,oe=V&&x?.showErosion!==!1,C=V?x?.condMode:"none",O=Y&&x&&x.lakes!=="none"?[x.lakeAbundance,x.lakeArea,x.lakeDepth,x.lakeCoverage,x.maxLakeArea]:[0,0,0,0,0],ce=x&&{mode:x.condMode,strength:x.condStrength,maxDepth:x.condDepth,maxLength:x.condLength,banks:x.condBanks,lakes:O[0],lakeArea:O[1],lakeDepth:O[2],lakeCoverage:O[3],maxLakeArea:O[4],...e.climateZone==="wetland"?{undulation:2}:{}};if(r&&x&&T&&l==="overview"&&u==="gl"){const H=It(Y?x.vectorResolution:x.resolution,c.n),te=JSON.stringify([ur,rr,H,C,C==="none"?0:[x.condStrength,x.condDepth,x.condBanks,x.condLength,O]]);if(!Q||Q.key!==te||Y&&!Ve){const Z=sn(S);r({...S,height:S.height.slice(),normalX:S.normalX.slice(),normalY:S.normalY.slice(),normalZ:S.normalZ.slice(),caveMask:S.caveMask.slice(),neural:Br&&{...Br,land:Z.land},field:await Fe(S,!1,Y),relief:Z,generationMs:performance.now()-A})}}if(x&&T){const H=It(Y?x.vectorResolution:x.resolution,c.n),te=JSON.stringify([ur,rr,H,C,C==="none"?0:[x.condStrength,x.condDepth,x.condBanks,x.condLength,O]]),Z=Yr(e),he={riverArea:Xi(x,e.width)/Math.max(1,x.density)**2,density:Math.min(1,x.density),headwaters:x.headwaters!==!1?1:0,minRiverLength:x.minRiverLength,lakeDepth:x.lakeDepth,lakeArea:x.lakeArea,riverMode:x.riverMode,flatSlope:x.flatSlope,sinuosity:x.sinuosity,widthScale:x.vectorWidth,balance:x.balance,braiding:x.braiding,anabranching:x.anabranching,terrainInfluence:x.terrainInfluence,avulsions:x.avulsions,confluence:x.confluence,deltas:x.deltas,...e.climateZone==="wetland"?{oxbows:.35}:{}},J=JSON.stringify([te,he,Z.temperature,Z.precipitation,Je(e.generalSeed??e.seed,"water-hydrology")]);if(!Q||Q.key!==te){Q=void 0,Ve=void 0,He?.dispose(),He=void 0,Ee=void 0,xr="",br="";let ne;if(S.x===0&&S.y===0&&S.width===e.width&&S.resolution===H)ne=S.height.slice();else if(ue&&!ue.lost)ne=(await ue.sample({x:0,y:0,extent:e.width,resolution:H},e,F.min_height,F.max_height)).height;else{const W=$?await $.sampleRegion(0,0,e.width,H):F.sample_region(0,0,e.width,H);try{ne=W.height}finally{W.free()}}if(C==="none")Q={key:te,n:H,height:ne,m:0};else{a?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const W=ce;if(Y){const ee=await Ht(ne,H,e.width,W,he,Z,Je(e.generalSeed??e.seed,"water-hydrology"),s),{height:we,delta:xe,...D}=ee.conditioning;Q={key:te,n:H,height:we,source:ne,delta:xe,m:H,stats:D},Ve={key:J,water:ee.water}}else{const ee=await Ft(ne,H,e.width,W,{stats:!1,drainage:!1},s),{height:we,delta:xe,hydrology:D,...Fr}=ee;Q={key:te,n:H,height:we,source:ne,delta:xe,m:H,stats:{...Fr,census:!1},drainage:D}}}}if(Y){if(!Ve||Ve.key!==J)if(a?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),Q.source){const ne=await Ht(Q.source,H,e.width,ce,he,Z,Je(e.generalSeed??e.seed,"water-hydrology"),s),{height:W,delta:ee,...we}=ne.conditioning;Object.assign(Q,{height:W,delta:ee,stats:we}),Ve={key:J,water:ne.water}}else Ve={key:J,water:await di(Q.height,H,e.width,he,Z,Je(e.generalSeed??e.seed,"water-hydrology"),Q.drainage,s)}}else{const ne=JSON.stringify([te,k,Je(e.generalSeed??e.seed,"water-hydrology")]),W={...x,showErosion:!0,erosionEnabled:V,...V?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},ee=`${ne}|${JSON.stringify(W)}`;if(re&&kr?.key===ee)S.hydrologyError=kr.message;else try{(!He||xr!==ne)&&(a?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),He?.dispose(),He=void 0,Ee=void 0,br="",He=await Pt.create(Je(e.generalSeed??e.seed,"water-hydrology"),e.width,H,Q.height.slice(),k,h!==0||(g||re||e.sketch||e.zones?De().min_height<=0:!1)),xr=ne);const we=Yr(e),xe=JSON.stringify([W,we.temperature,we.precipitation]);(!Ee||br!==xe)&&(a?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Ee=He.generate(W,we),br=xe)}catch(we){if(!re)throw we;He?.dispose(),He=void 0,Ee=void 0,xr="",kr={key:ee,message:we instanceof Error?we.message:String(we)},S.hydrologyError=kr.message}}}if(a?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),T&&oe&&Q?.delta&&!e.underdark&&await pi(S,Q.delta,Q.m,e.width,s),T&&oe&&!Y&&Ee&&!S.hydrologyError){const H=performance.now();Sn(S,Ee),S.hydrologySurfaceMs=performance.now()-H}if(l==="overview"){const H=De().source_resolution(),te=e.underdark?await Nr():mr?.slice()??(g==="surface"&&!h?$r(yr(e.sketch),H):await Nr());if(T&&oe&&Q?.delta&&!e.underdark){const Z=await We(Q.delta,Q.m,H);for(let he=0;he<te.length;he++)te[he]+=te[he]<=0?Math.min(0,Z[he]):Z[he]}T&&oe&&!Y&&Ee&&!S.hydrologyError&&en({x:0,y:0,width:e.width,resolution:H,height:te,minHeight:S.globalMinHeight,maxHeight:S.globalMaxHeight},Ee),S.physical={n:H,height:te},Rr&&(S.modificationBase=Rr)}return e.refine&&u!=="gl"&&hi(S,e.width/De().source_resolution(),mi(e.seed),e.detailNoise),l==="overview"&&(u==="gl"||t.retainField)&&(a?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),S.field=await Fe(S,T,Y)),l==="overview"&&T&&(Y?S.water=Ve?.water:Ee&&!S.hydrologyError&&(S.hydrology=Ee),Q?.delta&&Q.stats&&(S.conditioning={delta:Q.delta,n:Q.m,stats:Q.stats})),l==="overview"&&(S.relief=sn(S)),S.neural&&S.relief&&(S.neural={...S.neural,land:S.relief.land}),S.generationMs=performance.now()-A,n&&await n.after("hydrology",S.height),S}async function Fe(S,x,T){const Y=De().sampling_parameters()[5],V=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((Y===1||Y===4)&&e.relief!=="cavern"){const H=De().source_resolution(),te=await pt();if(x&&V&&Q?.delta&&!e.underdark){const ne=await We(Q.delta,Q.m,H);for(let W=0;W<H*H;W++)te[W]+=te[W]<=0?Math.min(0,ne[W]):ne[W]}const Z=x&&V&&!T&&!S.hydrologyError?Ee:void 0;Z&&en({x:0,y:0,width:e.width,resolution:H,height:te,minHeight:S.globalMinHeight,maxHeight:S.globalMaxHeight},Z);const he=e.underdark?$?await $.physicalCaveField():F.physical_cave_field():void 0,J=e.underdark?await ln():void 0;return{n:H,data:te,exact:!Z,floor:Y===1?.3:0,cave:he?.length?he:void 0,...J?.length?{tunnels:J}:{}}}const oe=De().source_resolution(),C=S.physical?.height.slice()??await Nr(),O=e.relief!=="cavern"&&!e.underdark?void 0:$?await $.physicalCaveField():F.physical_cave_field(),ce=e.underdark?await ln():void 0;return{n:oe,data:C,exact:!1,floor:0,cave:O?.length?O:void 0,...ce?.length?{tunnels:ce}:{}}}n&&await n.before("sampling",`Borne du moteur ${De().max_height.toFixed(2)} m · aperçu ${o.resolution}²`);let le,Ke=0,nr;if(f!=="wasm"&&L&&!$&&!e.underdark){a?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const S=performance.now();try{const x=await z;E&&x&&!E.context.lost&&((!ue||er!==f||ue.lost)&&(ue?.dispose(),ue=void 0,ue=new $t(E.context,x.pipeline,f,F),er=f),Ke=performance.now()-S,a?.(`GPU · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"}),nr={...await ue.sample(o,e,F.min_height,F.max_height),generationMs:performance.now()-A,prepareMs:Re,gpuSetupMs:Ke,generationBackend:Ie,generationReason:Te,noiseMs:Me,erosionMs:Ge,gpuSimulationMs:Ce,nativeEnvironmentMs:be,erosionProfile:pe,coastBackend:Qe,coastMs:Le,coastReason:gr}),nr||(le="WebGPU indisponible")}catch(x){le=`GPU indisponible : ${x instanceof Error?x.message:String(x)}`,ue?.dispose(),ue=void 0,er=void 0}}else $?le="Native Rust sampling on the local service.":f!=="wasm"&&(le="terrain currently sampled in WASM");if(nr)return qe(nr);a?.(`${$?"Native Rust":"CPU"} · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"});const dr=performance.now(),ke=$?await $.sampleRegion(o.x,o.y,o.extent,o.resolution):F.sample_region(o.x,o.y,o.extent,o.resolution);try{return await qe({x:ke.x,y:ke.y,width:ke.width,resolution:ke.resolution,minHeight:ke.min_height,maxHeight:ke.max_height,globalMinHeight:De().min_height,globalMaxHeight:De().max_height,motifSize:e.motifSize,height:ke.height,caveMask:ke.cave_mask,normalX:ke.normal_x,normalY:ke.normal_y,normalZ:ke.normal_z,generationMs:performance.now()-A,backend:$?"native":"wasm",backendReason:le,prepareMs:Re,samplingMs:performance.now()-dr,gpuSetupMs:Ke,generationBackend:Ie,generationReason:Te,noiseMs:Me,erosionMs:Ge,gpuSimulationMs:Ce,nativeEnvironmentMs:be,erosionProfile:pe,coastBackend:Qe,coastMs:Le,coastReason:gr})}finally{ke.free()}}export{oi as CLIMATE_VALUES,ca as DEFAULT_NEURAL_SERVER,zn as DEFAULT_NEURAL_TUNING,ua as DEFAULT_PYTHON_SERVER,lr as EROSION_SETTINGS,la as GEOLOGICAL_RELIEFS,da as NEURAL_RELIEF_DEFAULTS,Yr as climateOf,qr as isNeuralSource,fa as neuralServerForSource,ga as releaseTerrainCheckpoints,sn as reliefStatistics,va as sampleRustTerrain};
