import{cs as Qe,ct as jr,cu as on,cv as an,cw as sn,cx as re,cy as Gn,cz as ht,cA as Dr,cB as Ye,cC as st,cD as zt,cE as mt,cF as lt,cG as On,cm as ct,cH as ln,cI as Ut,cJ as Tn,cK as Ln,cL as Fn,cM as Hn,cN as qn,cO as Hr,cP as pr,cQ as In,cR as Dn,cS as $n,cT as jn,cU as Wn,cV as Xr,cW as Yn,cX as Zr,cY as br,cZ as Vn,c_ as Ct,c$ as Kn,d0 as cn,d1 as Jn,d2 as At,d3 as Et,d4 as Xn,d5 as Zn,d6 as Rt,d7 as Qn,d8 as ei,d9 as Bt,da as Nt,db as ri,dc as ti,dd as ni,s as ii,de as oi}from"./neuralModels-CUm9hdac.js";import{a9 as Rr,aa as un,ab as fn,ac as Ue,ad as Gt,C as ai,y as si,ae as kr,af as li,p as ci,ag as ui,ah as fi,ai as di,aj as pi}from"./__vite-browser-external-CiSMHSqX.js";import{b as gt,n as Er}from"./settlements-B4CiGWSe.js";import"./vectorWaterRender-Dlr54Vgc.js";import"./riverHeadwaters-B3inT2I_.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/let We;const Qr=new Map;let ut=Promise.resolve();const ft=new mt;function dt(r=!1){const t=We;We=void 0,ft.clear(),r||t?.pipeline?.free(),t?.runtime&&(ut=ut.then(async()=>{await Er(t.runtime,"/terrain/stage",JSON.stringify({session:t.session,command:"cancel"})).catch(()=>{})}))}fn(()=>dt(!0));async function hi(r,t,i,n,e){t?.backend?.(i?"native":"cpu");const a=Qe(r),s=t?.previews!==!1&&a.n<=1024,l=jr(r),o=Rr.erosion_at_resolution(r.seed,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix,a.n),u=o.parameters();o.free();const{parameters:c,surface:d}=l?on(u,r):{parameters:u,surface:u.slice(24,32)};an(c,d,r,l),sn(d,r,a.n),l&&re(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural?.erosionTuning?.detail===void 0&&(c[16]=u[16]);const p=(b,z=!0)=>Number(re(r,b,z)),_=Uint32Array.from([Number(l),p("regional"),p("regionalFinish"),p("amplitude"),p("ridged",!l),p("surface",!l||r.relief==="canyon"),p("normalize"),+(r.procedural?.regionalThermal!==!1),+(r.procedural?.regionalDiffusion!==!1),r.procedural?.reconstruction==="cubic"?1:r.procedural?.reconstruction==="bspline"?2:0,+(r.relief==="canyon")]);e?.(_[5]&&c[23]>0&&d[3]>0?d[1]:void 0,_[1]&&r.erosion>0?c[4]:void 0);const y=Gn([r.seed,r.width,a.n,c[2],i?.server??"wasm",!!n]);(a.n>1024||We?.root!==y)&&dt();const C=ht(r),w=Dr(r),U=C.map(b=>w.get(b));let v=0;for(;We&&v<U.length&&We.keys[v]===U[v];)v++;const f=async b=>{try{return await Er(i,"/terrain/stage",JSON.stringify({session:We.session,...b}))}catch(z){throw["coast","restore","preview"].includes(b.command)&&z instanceof Error&&z.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):z}},m=r.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([b,z])=>[b,Ye(r.generalSeed,z)])):void 0,g={parameters:Array.from(c),surface:Array.from(d),flags:Array.from(_),stepSeeds:m??{}},N=async b=>{const z=await f(b),F=await z.json();if(m&&Object.values(m).some(H=>H!==r.seed)&&!F.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!We||v===0?(dt(),i&&!Qr.has(i.server)&&Qr.set(i.server,gt()),We={root:y,keys:[],runtime:i,...i?{session:Qr.get(i.server)}:{}},await t?.before("grids",`Rust ${i?"natif":"WASM"} · régional ${c[2]}² · surface ${d[0]}² · source ${a.n}² à ${a.spacing.toFixed(2)} m`),i?(await ut,await N({command:"start",seed:r.seed,...g})):We.pipeline=new un(r.seed,c,d,_),await t?.after("grids")):t?.cached?await t.cached("grids"):(await t?.before("grids"),await t?.after("grids"));const P=We;i||P.pipeline.set_step_seeds(JSON.stringify(m??{}));let k;for(let b=0;b<C.length;b++){const z=C[b],F=b<v;if(!F&&b===v&&b>0&&(i?await N({command:"restore",checkpoint:b-1,...g}):P.pipeline.restore(b-1,c,d,_),P.keys.length=b),F){(s||b===C.length-1)&&(k=i?new Float32Array(await(await f({command:"preview",checkpoint:b})).arrayBuffer()):P.pipeline.checkpoint_height(b)),t?.cached?await t.cached(z,s?k:void 0):(await t?.before(z),await t?.after(z,s?k:void 0));continue}await t?.before(z);const H=z==="coastCut"&&st(r,"coastCut");if(i){const q=await(await f({command:z==="coastCut"?"coast":"advance",stage:zt.indexOf(z),checkpoint:b,mask:H?r.coastMask:0,mode:r.islandMode??"island",preview:s||b===C.length-1})).arrayBuffer();q.byteLength&&(k=new Float32Array(q))}else{if(z==="initialize"&&n){const G=await n();P.pipeline.set_noise(G.coarse,G.fine)}z==="coastCut"?H&&P.pipeline.cut_coast(r.coastMask,r.islandMode??"island"):P.pipeline.advance(zt.indexOf(z)),P.pipeline.checkpoint(b),(s||b===C.length-1)&&(k=P.pipeline.height())}P.keys[b]=U[b],await t?.after(z,s?k:void 0)}const L=`${y}|${w.get("phasor")}`,E=a.n<=1024?ft.get("phasor",L):void 0;return E?(t?.cached?await t.cached("phasor",s?E:void 0):(await t?.before("phasor"),await t?.after("phasor",E)),E):(await t?.before("phasor"),re(r,"phasor",l)&&(k=lt(k,r)),a.n<=1024&&ft.put("phasor",L,k),await t?.after("phasor",s?k:void 0),k)}const mi=`
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
}`,Ot=new WeakMap;function gi(r,t,i){if(!i.iterations||!i.transport)return r;const n=r.slice(),e=Math.sqrt(n.length),a=t/e,s=new Float32Array(n.length),l=i.azimuth*Math.PI/180,o=Math.cos(l),u=Math.sin(l),c=o>=0?1:-1,d=u>=0?1:-1,p=Math.abs(o)/(Math.abs(o)+Math.abs(u)),_=1-p;for(let y=0;y<i.iterations;y++){s.fill(0);for(let C=1;C<e-1;C++)for(let w=1;w<e-1;w++){const U=C*e+w;if(n[U]<=.3)continue;const v=((n[U+1]-n[U-1])*o+(n[U+e]-n[U-e])*u)/(2*a),f=.75+.25*Math.sin((w*o+C*u)*a/64+n[U]*.03);s[U]=Math.min(Math.max(0,n[U]-.3),i.transport*Math.max(.1,Math.min(1,.55+2*v))*f)}for(let C=0;C<e;C++)for(let w=0;w<e;w++){const U=C*e+w,v=C*e+Math.max(0,Math.min(e-1,w-c)),f=Math.max(0,Math.min(e-1,C-d))*e+w;n[U]=n[U]-s[U]+(v!==U?s[v]*p:0)+(f!==U?s[f]*_:0)}}return n}async function vi(r,t,i,n){if(!n.iterations||!n.transport)return t;const e=r.device,a=Math.sqrt(t.length);let s=Ot.get(e);s||(s=(async()=>{const p=e.createShaderModule({code:mi}),y=(await p.getCompilationInfo()).messages.filter(f=>f.type==="error");if(y.length)throw new Error(y.map(f=>`${f.lineNum}: ${f.message}`).join(`
`));const C=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),w=e.createPipelineLayout({bindGroupLayouts:[C]}),[U,v]=await Promise.all(["entrain","deposit"].map(f=>e.createComputePipelineAsync({layout:w,compute:{module:p,entryPoint:f}})));return{layout:C,a:U,b:v}})(),Ot.set(e,s));const{layout:l,a:o,b:u}=await s,c=[],d=(p,_)=>{const y=e.createBuffer({size:p,usage:_});return c.push(y),y};try{const p=d(t.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),_=d(t.byteLength,GPUBufferUsage.STORAGE),y=d(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),C=d(t.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);e.queue.writeBuffer(p,0,t);const w=new ArrayBuffer(48),U=new Float32Array(w);new Uint32Array(w)[0]=a;const v=n.azimuth*Math.PI/180;U[1]=i/a,U[2]=Math.cos(v),U[3]=Math.sin(v),U[4]=n.transport,e.queue.writeBuffer(y,0,w);const f=e.createBindGroup({layout:l,entries:[p,_,y].map((E,b)=>({binding:b,resource:{buffer:E}}))}),m=Math.ceil(t.length/256),g=Math.ceil(m/e.limits.maxComputeWorkgroupsPerDimension),N=Math.ceil(m/g),P=e.createCommandEncoder(),k=P.beginComputePass();k.setBindGroup(0,f);for(let E=0;E<n.iterations;E++)k.setPipeline(o),k.dispatchWorkgroups(N,g),k.setPipeline(u),k.dispatchWorkgroups(N,g);k.end(),P.copyBufferToBuffer(p,0,C,0,t.byteLength),e.queue.submit([P.finish()]),await C.mapAsync(GPUMapMode.READ);const L=new Float32Array(C.getMappedRange()).slice();return C.unmap(),L}finally{c.forEach(p=>p.destroy())}}const yi=`// FP32 sampling of the retained Rust erosion field.\r
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
`,vt=`// Shared FP32 simplex and FBM kernels.\r
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
`,wi=`// Same noise octaves and physical wavelengths as erosion::mountain.\r
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
`,dn=`// Seeded finite volcanic geometry. Shared by generation and camera sampling.\r
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
`,xi=`// The dedicated third simplex stream matches Rust's shore-noise fork.\r
// Fourteen header vec4s (profile, shore offsets, shore turns, character, six bumps), then\r
// each capsule is three vec4s: endpoints; radii/scale/phase; islet height/center/apron.\r
@group(0) @binding(6) var<storage, read> coast: array<vec4<f32>>;\r
fn headerValue(i:u32)->f32 {return coast[i/4u][i%4u];}\r
fn coastalHeight(xy:vec2<f32>, terrainHeight:f32)->f32 {\r
  let config=coast[0];let mask=u32(config.x);\r
  if(mask==0u){return terrainHeight;}\r
  // Same marine datum and smooth positive floor as Rust coastal plains.\r
  var height=terrainHeight;\r
  let datum=coast[1].w;\r
  if(datum>0.0){let relative=height-datum;height=0.3+0.5*(relative+sqrt(relative*relative+1.0));}\r
  let uv=xy/p.values[0].x;let footprint=p.values[2].w/p.values[0].x;\r
  var distance=-2.0;var scale=0.2;var isletHeight=0.0;var apron=1.0;\r
  if(mask!=255u){\r
    let character=coast[6];let fine=coast[7];\r
    let warped=uv+character.x*vec2<f32>(fbm(uv/character.y+vec2<f32>(5.2,1.3),2u,3u,0.5,footprint/character.y),\r
      fbm(uv/character.y+vec2<f32>(-7.7,9.1),2u,3u,0.5,footprint/character.y));\r
    // Seeded shoreline per sea direction, smoothly united as in Rust.\r
    var shore=10.0;\r
    for(var i=0u;i<8u;i++){\r
      if((mask&(1u<<i))==0u){continue;}\r
      let angle=f32(i)*0.7853981633974483+headerValue(16u+i);\r
      let d=headerValue(8u+i)-((warped.x-0.5)*sin(angle)-(warped.y-0.5)*cos(angle));\r
      let h=max(0.12-abs(shore-d),0.0)/0.12;\r
      shore=min(shore,d)-h*h*0.03;\r
    }\r
    distance=shore\r
      +character.z*fbm(uv/character.w,2u,7u,0.56,footprint/character.w)\r
      +fine.x*fbm(uv/fine.y,2u,5u,0.55,footprint/fine.y);\r
  }\r
  var cachedPhase=-1.0;var detail=0.0;\r
  for(var i=0u;i<u32(config.y);i++){\r
    let ends=coast[14u+i*3u];let shape=coast[15u+i*3u];let geology=coast[16u+i*3u];let delta=ends.zw-ends.xy;\r
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
  }\r
  if(isletHeight>0.0){height=isletHeight;}\r
  let cliff=smooth01((fbm(uv/0.12,2u,3u,0.5,0.0)-0.20)/0.25);\r
  let widthVariation=0.65+1.1*smooth01(fbm(uv/0.21+vec2<f32>(11.7,-4.2),2u,3u,0.5,0.0)+0.5);\r
  let ramp=min(max(config.z,height/(p.values[0].x*0.45)),scale*0.18)*widthVariation*apron*(1.0-0.90*cliff);\r
  if(distance<=0.0){return -config.w*smooth01(-distance/(ramp*4.0));}\r
  return height*smooth01(distance/ramp);\r
}\r
`;async function bi(r,t,i){i?.("Chargement du moteur Rust/WASM…",{stage:"runtime-download"});const n=await fetch(r);if(!n.ok)throw new Error(`Chargement du moteur Rust/WASM impossible : HTTP ${n.status}.`);const e=n.headers.get("content-encoding"),a=e?0:Number(n.headers.get("content-length")),s=Number.isSafeInteger(a)&&a>0?a:0;let l=0,o=0;const u=(d=!1)=>{const p=performance.now();if(d||p-o>=200){o=p;const _=(l/1048576).toFixed(1),y=(s/1048576).toFixed(1);i?.(s?`Moteur Rust/WASM · ${_} / ${y} Mio reçus`:`Moteur Rust/WASM · ${_} Mio reçus`,{stage:"runtime-download",completed:l,total:s})}};let c=n;if(n.body){const d=n.body.getReader(),p=new Headers(n.headers);e&&(p.delete("content-encoding"),p.delete("content-length")),c=new Response(new ReadableStream({async pull(_){try{const{done:y,value:C}=await d.read();y?(u(!0),i?.("Compilation du moteur Rust/WASM…",{stage:"runtime-compile"}),_.close()):(l+=C.byteLength,u(),_.enqueue(C))}catch(y){_.error(y)}},cancel:_=>d.cancel(_)}),{headers:p,status:n.status,statusText:n.statusText})}else i?.("Compilation du moteur Rust/WASM…",{stage:"runtime-compile"});await t(c),i?.("Moteur Rust/WASM prêt",{stage:"runtime-ready"})}async function mr(r,t=45e3){let i;try{return await Promise.race([r,new Promise((n,e)=>{i=setTimeout(()=>e(new Error("La préparation WebGPU ne répond pas. Réessayez sur CPU ou en mode Automatique.")),t)})])}finally{clearTimeout(i)}}let et;const ki=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function yt(){return et??=(async()=>{const r=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!r)return;const{maxBufferSize:t,maxStorageBufferBindingSize:i}=r.limits,n=await r.requestDevice({requiredFeatures:r.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:t,maxStorageBufferBindingSize:i}}),e={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{e.lost=!0,et=void 0}),e})().catch(()=>{}),et}async function Si(r,t){if(r==="wasm")return;const i=await yt();if(!i||i.lost)return;const n=t==="flat"?0:t==="valley"?2:t==="volcano"||t==="caldera"||t==="plateau"?3:1,e=`${r}:${n}`;let a=i.pipelines.get(e);return a||(a=(async()=>{const s=yi.replace("// NOISE_KERNEL",vt).replace("// VOLCANIC_KERNEL",dn).replace("// COAST_KERNEL",xi),l=i.device.createShaderModule({code:s});return i.device.createComputePipelineAsync({layout:"auto",compute:{module:l,entryPoint:"main",constants:{FAMILY:n}}})})(),a.catch(()=>{}),i.pipelines.set(e,a)),{context:i,pipeline:a}}const _i=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Tt(r,t,i){const n=r.device,e=Qe(t).n,a=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),s=t.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],l=s.map(c=>{const d=`generation:${c}`;let p=r.pipelines.get(d);if(!p){const _=n.createShaderModule({code:wi.replace("// NOISE_KERNEL",vt)});p=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[a]}),compute:{module:_,entryPoint:c}}),r.pipelines.set(d,p)}return p}),o=Rr.generation_at_resolution(t.seed,t.width,t.relief,t.motifSize,e),u=[];try{const c=o.parameters();t.procedural?.regionalN&&(c[2]=t.procedural.regionalN,c[4]=t.width*1.44/c[2]),c[6]*=t.procedural?.noiseScale??1;const d=(v,f)=>{const m=n.createBuffer({size:v.byteLength,usage:f|GPUBufferUsage.COPY_DST});return u.push(m),n.queue.writeBuffer(m,0,v),m},p=[d(c,GPUBufferUsage.UNIFORM),d(o.permutations(),GPUBufferUsage.STORAGE),d(o.gradients(),GPUBufferUsage.STORAGE)];i?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const _=await mr(Promise.all(l));i?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const C=s.map(v=>v==="coarse"?c[2]:c[1]).map((v,f)=>{const m=v*v*16,g=n.createBuffer({size:m,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),N=n.createBuffer({size:m,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});u.push(g,N);const P=n.createBindGroup({layout:_[f].getBindGroupLayout(0),entries:[...p,g].map((E,b)=>({binding:b,resource:{buffer:E}}))}),k=n.createCommandEncoder(),L=k.beginComputePass();return L.setPipeline(_[f]),L.setBindGroup(0,P),L.dispatchWorkgroups(Math.ceil(v/8),Math.ceil(v/8)),L.end(),k.copyBufferToBuffer(g,0,N,0,m),n.queue.submit([k.finish()]),N}),w=n.queue.onSubmittedWorkDone().then(()=>i?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),U=await Promise.all(C.map(async v=>{await v.mapAsync(GPUMapMode.READ);const f=new Float32Array(v.getMappedRange().slice(0));return v.unmap(),f}));return await w,{coarse:s.length===2?U[0]:new Float32Array,fine:U[U.length-1]}}finally{o.free(),u.forEach(c=>c.destroy())}}class Lt{constructor(t,i,n,e){this.state=t,this.pipeline=i,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=e.sampling_parameters(),this.sourceN=e.source_resolution();let a=0;for(let u=this.sourceN;u>=1;u=Math.floor(u/2))a+=u*u;const s=this.parameters[5]===3?2:1;if(a*s*4>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const l=e.sampling_field();this.hasField=l.length>0;const o=l.length?l:new Float32Array(1);if(o.byteLength>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(o),this.perm=this.upload(e.sampling_permutations()),this.gradients=this.upload(e.sampling_gradients()),this.branches=this.upload(e.sampling_branches()),this.coast=this.upload(e.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(t,i=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,t.byteLength),usage:i|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,t),n}prepareCoastField(t){return this.dispatchField({x:0,y:0,extent:t.width,resolution:this.sourceN},t),this.output}dispatchField(t,i){const{x:n,y:e,extent:a,resolution:s}=t;if(![n,e,a,s].every(Number.isFinite)||n<0||e<0||a<=0||n+a>i.width+1e-4||e+a>i.width+1e-4||!Number.isInteger(s)||s<16||s>8192)throw new Error("Région d’échantillonnage invalide.");const l=this.state.device,o=a/s,u=Math.max(i.motifSize/65536,o*.5),c=this.parameters,d=Math.floor(Math.log2(this.sourceN)),p=Math.min(d,Math.log2(Math.max(1,o*(i.relief==="flat"&&c[5]!==4?2/i.motifSize:1/i.width)*this.sourceN))),_=new Float32Array([c[0],c[1],c[2],c[3],c[4],c[5],this.hasField?1:0,s,n,e,a,o,Math.floor(p),Math.min(d,Math.floor(p)+1),p-Math.floor(p),u,c[6],c[7],this.sourceN,d,...Array.from({length:16},(U,v)=>c[8+v]??0)]),y=s*s*16;y>this.capacity&&(this.output?.destroy(),this.capacity=y,this.output=l.createBuffer({size:y,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=l.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((U,v)=>({binding:v,resource:{buffer:U}}))})),l.queue.writeBuffer(this.uniform,0,_);const C=l.createCommandEncoder(),w=C.beginComputePass();w.setPipeline(this.pipeline),w.setBindGroup(0,this.group),w.dispatchWorkgroups(Math.ceil(s/8),Math.ceil(s/8)),w.end(),l.queue.submit([C.finish()])}async sample(t,i,n,e){const a=performance.now(),s=this.state.device,{x:l,y:o,extent:u,resolution:c}=t;this.dispatchField(t,i);const d=c*c*16,p=s.createCommandEncoder();(!this.readback||this.readback.size<d)&&(this.readback?.destroy(),this.readback=s.createBuffer({size:d,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),p.copyBufferToBuffer(this.output,0,this.readback,0,d),s.queue.submit([p.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,d);const _=this.readback.getMappedRange(0,d).slice(0);this.readback.unmap();const y=new Float32Array(_),C=new Float32Array(c*c),w=new Float32Array(c*c),U=new Float32Array(c*c),v=new Float32Array(c*c);let f=1/0,m=-1/0;for(let g=0;g<c*c;g++){const N=g*4;C[g]=y[N],w[g]=y[N+1],U[g]=y[N+2],v[g]=y[N+3],f=Math.min(f,C[g]),m=Math.max(m,C[g])}if(!Number.isFinite(f)||!Number.isFinite(m))throw new Error("Sortie GPU non finie.");return{x:l,y:o,width:u,resolution:c,minHeight:f,maxHeight:m,globalMinHeight:n,globalMaxHeight:e,motifSize:i.motifSize,height:C,normalX:w,normalY:U,normalZ:v,caveMask:new Uint8Array,generationMs:performance.now()-a,backend:this.mode,samplingMs:performance.now()-a}}dispose(){this.buffers.forEach(t=>t.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}const Mi=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`,Pi=`// Inspector-only readout. It never modifies simulation heights or drainage.\r
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
`,zi=`// Full FP32 regional erosion. Dispatches are global synchronization boundaries.\r
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
@compute @workgroup_size(256)\r
fn breach(@builtin(global_invocation_id) id:vec3<u32>){\r
  let i=id.x;if(i>=count() || atomicLoad(&nodes[i].parent)!=i){return;}let pour=atomicLoad(&nodes[i].pour);if(pour==0xffffffffu){return;}let frac=p.values[7].z;let spill=decoded(atomicLoad(&nodes[i].spill));let bottom=decoded(atomicLoad(&nodes[i].bottom));var current=min(nodes[pour].h,spill-frac*(spill-bottom));atomicMin(&nodes[pour].breached,ordered(nodes[pour].h+frac*(current-nodes[pour].h)));var r=nodes[pour].receiver;\r
  for(var k=0u;k<400u;k++){if(r<0){break;}current=max(0.5,current-0.01*p.values[1].x);let old=nodes[u32(r)].h;if(old<=current){break;}atomicMin(&nodes[u32(r)].breached,ordered(old+frac*(current-old)));r=nodes[u32(r)].receiver;}\r
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
`,Nr=new WeakMap,rt=new WeakMap,Ft=new Set;function Gr(r){r.nodes?.destroy(),r.fine?.destroy(),r.control.destroy()}const Ht=new WeakMap,tt=new WeakMap,qt=new WeakMap,It=new WeakMap,pn=new WeakSet,Ui=512*1048576,Dt=1024,Ci=1088,nt=Ci+4096;function hn(r,t){const i=(qt.get(r.device)??Promise.resolve()).then(t);return qt.set(r.device,i.then(()=>{},()=>{})),i}async function Ai(r,t,i,n){let e=Ht.get(r);e||(e=(async()=>{const u=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(y=>({binding:y,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(y=>({binding:y,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),c=r.createShaderModule({code:zi.replace("// NOISE_KERNEL",vt).replace("// VOLCANIC_KERNEL",dn)+Mi+Pi}),p=(await mr(c.getCompilationInfo())).messages.filter(y=>y.type==="error");if(p.length)throw new Error(p.map(y=>`${y.lineNum}: ${y.message}`).join(`
`));const _=r.createPipelineLayout({bindGroupLayouts:[u]});return{layout:u,module:c,pipelineLayout:_,values:new Map,pending:new Map}})(),Ht.set(r,e)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const a=await mr(e),s=[],l=[...t].reduce((u,c)=>u+(c==="solveTile"?i.size:1),0);let o=0;for(const u of t)for(const c of u==="solveTile"?i:[void 0]){const d=c===void 0?u:`solveTile:${c}`;let p=a.pending.get(d);p||(p=r.createComputePipelineAsync({layout:a.pipelineLayout,compute:{module:a.module,entryPoint:u,...c===void 0?{}:{constants:{SOLVE_MODE:c}}}}),p=p.then(_=>(a.values.set(d,_),_)),a.pending.set(d,p)),s.push(p.then(_=>(o++,n?.(`GPU · shaders d’érosion prêts ${o}/${l}`,{stage:"gpu-erosion-compile",completed:o,total:l}),_)))}return await mr(Promise.all(s)),pn.add(r),a}class Ar extends Error{}class Ei extends Error{}function mn(r,t,i,n,e){const a=Rr.erosion_at_resolution(r.seed,r.width,i,r.erosion,r.motifSize,r.mountainMix,t);try{const s=a.parameters(),l=n?on(s,r,e):{parameters:s,surface:(e??s.slice(24,32)).slice()};return an(l.parameters,l.surface,r,n,!!e),sn(l.surface,r,t),{noise:a,parameters:l.parameters,surface:l.surface,original:s}}catch(s){throw a.free(),s}}const Ri=["hills","mountains","mixed","high-mountains","valley","canyon"];function Bi(r,t){const i=Qe(t).n,n=jr(t),e=Ri.includes(t.relief)?t.relief:t.relief==="flat"?"hills":"mixed",{noise:a,parameters:s,surface:l}=mn(t,i,e,n);a.free();const o=s[2],u=l[0],c=l[3],d=On(r.device.limits,i,Math.max(o,t.erosion>0&&(!n||c>0)?u:0));return{sourceN:i,regionalN:o,regionalSteps:s[13],surfaceN:u,surfaceSteps:c,pipelinesReady:pn.has(r.device),error:d}}async function Ni(r,t,i,n,e){return hn(r,()=>Gi(r,t,i,n,e))}async function Gi(r,t,i,n,e){const a=Qe(t).n;for(const s of[1,2,4,8,16])try{return await gn(r,t,a,s,void 0,{source:i,tuning:n},void 0,e)}catch(l){if(!(l instanceof Ar)||s===16)throw l}throw new Error("Érosion littorale GPU non convergée.")}async function $t(r,t,i,n){return i?.control?.backend?.("gpu"),hn(r,()=>Oi(r,t,i,n))}async function Oi(r,t,i,n){const e=Qe(t).n;if(t.relief==="volcano"||t.relief==="caldera"||t.relief==="plateau"){const a=Rr.finite_shape(t.seed,t.motifSize,t.relief,t.erosion),s=a.parameters();a.free();const l=t.environment??"mixed",o=t.motifSize*s[15];let u;if(l==="flat"){const p=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),u=Ue.prepare_environment_at_resolution(t.seed,t.width,l,t.erosion,o,e),i&&(i.nativeEnvironmentMs=performance.now()-p)}else u=await it(r,{...t,motifSize:o,relief:l,mountainMix:.5},e,void 0,i,n);const c=await it(r,{...t,width:t.motifSize},e,s,i,n),d=new Float32Array(c.length+u.length);return d.set(c),d.set(u,c.length),d}return it(r,t,e,void 0,i,n)}async function it(r,t,i,n,e,a){for(const s of[1,2,4,8,16])try{return await gn(r,t,i,s,n,void 0,e,a)}catch(l){if(!(l instanceof Ar)||s===16)throw l}throw new Error("Érosion GPU non convergée.")}async function gn(r,t,i,n,e,a,s,l){const o=r.device,u=a?void 0:s?.control,c=jr(t),d=!!t.generalSeed&&ct(t.generalSeed,m=>m.startsWith("relief-"))!==ln(t.generalSeed),{noise:p,parameters:_,surface:y,original:C}=mn(t,i,a||c&&t.relief==="flat"?"hills":e?"mixed":t.relief,c,a?.tuning);let w=tt.get(o);if(!w){w=[],tt.set(o,w);const m=w;o.lost.then(()=>m.forEach(g=>g.destroy()))}const U=!!u&&u.previews!==!1&&i<=Dt;let v=!!u&&u.previews!==!1,f=0;try{c&&t.procedural&&re(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural.erosionTuning?.detail===void 0&&(_[16]=C[16]);const m=_.slice(0,24),g=m[2],N=m[13],P=m[18],k=a?[1,0,0,.2,1,1,0,0]:Array.from(_.slice(33,41)),L=k.slice();L[4]=1;const E=!a&&k[6]>.5,b=Math.min(n,4),z=m.slice();z[2]=y[0],z[4]=y[1],z[5]=y[2],z[15]=e&&!a?e[13]:y[4],z[18]=y[5],z[22]=y[6];const F=Math.max(1,z[2]/1048),H=Math.ceil(Math.min((e||a||t.relief==="mixed"?64:32)*n,512)*F),G=!a&&re(t,"phasor",c)?"generationPhasorPack":"packHeight",q=c?"compactInitialize":"initialize",K=!!a||re(t,"surface",!c||t.relief==="canyon")&&(!c||t.relief==="canyon"||y[3]>0),ue=()=>{a||s?.onPhysicalPlan?.(t.erosion>0&&K&&y[3]>0?y[1]:void 0,!e&&t.erosion>0&&(re(t,"regional")||re(t,"regionalFinish"))?m[4]:void 0)},$=t.procedural?.reconstruction&&t.procedural.reconstruction!=="default"?"generationReconstruct":c?"compactReconstruct":"reconstruct",ye=new Set([G,...re(t,"amplitude")?[]:["generationUnitScale"],...re(t,"normalize")?[]:["generationKeepDatum"],...u?["generationPreview"]:[],...!a&&!e&&t.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),de=new Set,ee=(...h)=>h.forEach(M=>ye.add(M));d&&!a&&!e&&ee("generationCut","generationRegionalRead","generationPreview"),(a||!e&&(d||t.procedural))&&ee("seaLandMark","seaMaskGrow");const we=()=>ee("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");a?ee("coastLoad","coastResult"):ee("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!a&&!e?(ee(q,"uplift","bounds",$,"detail"),P>0&&(we(),ee("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(h=>de.add(h)))):e&&!a&&ee("volcanicInitial"),t.erosion>0&&K&&(we(),ee("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),de.add(1),de.add(3),t.relief==="canyon"&&!a&&(ee("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),de.add(0)),E&&(ee("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),de.add(0))),u&&await u.before("grids",`Budget ×${n} · régional ${g}² · surface ${z[2]}² · sortie ${i}²`);const Fe=performance.now(),be=await Ai(o,ye,de,l),He=performance.now()-Fe,ke=performance.now();l?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let Se=!1;const pe=(h,M)=>{const B=f++;let O=w[B];return(!O||O.size<h||O.usage!==M)&&(O?.destroy(),O=o.createBuffer({size:h,usage:M}),w[B]=O,Se=!0),O},oe=h=>{const M=pe(h.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return o.queue.writeBuffer(M,0,h),M},Ce=t.erosion>0&&K?Math.max(g,z[2]):g,se=i**2,he=se*4,Ae=se*16,Be=Math.max(se,g*g)*4;o.pushErrorScope("out-of-memory");const Ee=pe(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),Ve=pe(Ce**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),De=pe(Ae,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Re=pe(nt,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ne=pe(Be,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),le=pe(Be+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),rr=pe(Math.ceil(Ce/16)**2*8,GPUBufferUsage.STORAGE),_e=o.popErrorScope();if(Se&&await _e)throw v=!0,new Ei(`WebGPU : mémoire insuffisante pour la source ${i}² et la grille d’érosion ${Ce}².`);v||=w.reduce((h,M)=>h+M.size,0)>Ui;const S=h=>le.mapAsync(GPUMapMode.READ,0,h),x=h=>le.getMappedRange(0,h),R=!a&&!e&&!!(t.procedural||d),X=R&&i<=Dt,J=U||R;let Q=J?void 0:It.get(o);if(!J&&!Q&&o.features.has("timestamp-query")){Q=o.createQuerySet({type:"timestamp",count:6}),It.set(o,Q);const h=Q;o.lost.then(()=>h.destroy())}const A=Q?pe(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,T=Q?pe(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,fe=(h,M)=>o.createBindGroup({layout:be.layout,entries:[{binding:0,resource:{buffer:Ee,size:224}},...[oe(h),oe(M),Ve,De,Re,Ne,rr].map((B,O)=>({binding:O+1,resource:{buffer:B}}))]});let I=fe(p.permutations(),p.gradients());const ne=new Map([[t.seed,I]]),ie=h=>{const M={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[h];if(!M||!t.generalSeed)return;const B=Ye(t.generalSeed,M);let O=ne.get(B);if(!O){const ce=Rr.erosion(B,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix);try{O=fe(ce.permutations(),ce.gradients())}finally{ce.free()}ne.set(B,O)}I=O},ae=new Map;let Pe=k;const ge=(h,M)=>{const B=[...M,...h,...Pe].join(",");let O=ae.get(B);if(O===void 0){if(O=ae.size*256,O+224>65536)throw new Error("Too many GPU variants.");ae.set(B,O),o.queue.writeBuffer(Ee,O,new Float32Array([...M,...h,...c?Ut(t,!!a):!e&&!a&&re(t,"phasor",!1)?Ut(t):e??new Float32Array(16),...Pe]))}return O};let Y=o.createCommandEncoder();Y.clearBuffer(Re),a&&Y.copyBufferToBuffer(a.source,0,De,0,Ae);const ve=h=>Y.beginComputePass(Q?{timestampWrites:{querySet:Q,beginningOfPassWriteIndex:h,endOfPassWriteIndex:h+1}}:void 0);let j=ve(0);const te=[0,0,1,0,0,0,.6,0];te[4]=_[32];const tr=[0,0,.95,P*.5,0,0,.5,0];let Ge=m;const W=(h,M=te,B=Math.ceil(Ge[2]**2/256),O=1)=>{j.setPipeline(be.values.get(h==="solveTile"?`solveTile:${M[1]}`:h)),j.setBindGroup(0,I,[ge(M,Ge)]),j.dispatchWorkgroups(B,O)},bt=Math.ceil(se/256),kt=Math.ceil(bt/o.limits.maxComputeWorkgroupsPerDimension),ze=(h,M=te)=>W(h,M,Math.ceil(bt/kt),kt),Ke=(h,M,B=!1)=>{const O=te.slice();O[1]=h,O[7]=B?1:0,W(h===0?"floodInit":"graphInit",O),W("start",O,1);const ce=[0,1].map(xe=>(O[0]=xe,ge(O,Ge)));for(let xe=0;xe<M;xe++){const nr=[ce[xe&1]];j.setPipeline(be.values.get("clearNext")),j.setBindGroup(0,I,nr),j.dispatchWorkgroups(1),j.setPipeline(be.values.get(`solveTile:${h}`)),j.dispatchWorkgroups(Math.ceil(Ge[2]/16),Math.ceil(Ge[2]/16))}O[0]=0,W("solveStats",O,1),h===0?(W("floodCheck",O,1),W("receivers")):W("graphFinish",O)},Wr=(h=te,M=!0)=>{W("pitInit");for(let B=0;B<8*b+Math.ceil(Math.log2(Math.max(1,Ge[2]/1048)));B++)W("pitUnion"),W("pitCompress");for(const B of M?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])W(B,h)},Yr=h=>{if(h<=0)return;const M=te.slice();M[6]=h,W("breachInit"),W("breach",M),W("breachFinish")},Vr=(h,M=te)=>{if(!(Ge===m&&t.procedural?.regionalThermal===!1))for(let B=0;B<h;B++)for(const O of["thermalFlux","thermalApply","copyHeight"])W(O,M)},Br=(h,M=te)=>{if(Ge===m&&t.procedural?.regionalDiffusion===!1)return;const B=M.slice();B[3]=h,W("diffuse",B),W("copyHeight",B)},St=h=>{const M=Tn(Ln({surfaceSteps:y[3],surfaceCell:y[1],regionalCell:m[4],sourceCell:m[11],warp:k[5]*Math.min(16*m[3],m[4]*.9)}),t.width);if(M===void 0)return;const B=te.slice();B[7]=h,h===0?W("seaLandMark",B):ze("seaLandMark",B),B[5]=M,W("seaMaskGrow",B,2)},_t=h=>{const M=te.slice();M[4]=h,W("percentileInit",M,1);for(const B of[24,16,8,0])M[5]=B,W("histogramClear",M,1),ze("histogram",M),W("percentileSelect",M,1)},Mt=async(h,M,B)=>{if(!u)return;if(!U){await u.after(h,void 0,B);return}if(M!==3){const nr=te.slice();nr[7]=M,ze("generationPreview",nr)}j.end(),Y.copyBufferToBuffer(Ne,0,le,0,he),Y.copyBufferToBuffer(Re,0,le,he,1088),o.queue.submit([Y.finish()]),await S(he+1088);const O=x(he+1088),ce=new Uint32Array(O,he,272)[2],xe=new Float32Array(O,0,se).slice();if(le.unmap(),ce)throw new Ar("Érosion GPU non convergée pendant une étape.");if(!xe.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await u.after(h,xe,B),Y=o.createCommandEncoder(),j=ve(0)},sr=ht(t),kn=Dr(t);let Oe=X?Nr.get(o):void 0;if(X&&!Oe){Oe=new Map,Nr.set(o,Oe),Ft.add(o);const h=Oe;o.lost.then(()=>{h.forEach(Gr),h.clear(),Ft.delete(o)})}const gr=h=>`${n}|${kn.get(h)}`;let er=0;for(;Oe&&er<sr.length&&Oe.get(sr[er])?.key===gr(sr[er]);)er++;if(Oe)for(const h of[...sr.slice(er),"phasor"]){const M=Oe.get(h);M&&(h!=="phasor"||M.key!==gr(h)||er<sr.length)&&(Gr(M),Oe.delete(h))}const Sn=h=>{j.end(),h.nodes&&Y.copyBufferToBuffer(h.nodes,0,Ve,0,h.nodes.size),h.fine&&Y.copyBufferToBuffer(h.fine,0,De,0,h.fine.size),Y.copyBufferToBuffer(h.control,0,Re,0,nt),j=ve(0)},_n=(h,M)=>{if(!Oe)return;j.end();const B=(ce,xe=ce.size)=>{const nr=o.createBuffer({size:xe,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return Y.copyBufferToBuffer(ce,0,nr,0,xe),nr},O=Oe.get(h);O&&Gr(O),Oe.set(h,{key:gr(h),kind:M,...M===0?{nodes:B(Ve,g*g*112)}:{fine:B(De,Ae)},control:B(Re,nt)}),o.queue.submit([Y.finish()]),Y=o.createCommandEncoder(),j=ve(0)},Mn=async(h,M)=>{if(!u)return;if(!U){u.cached?await u.cached(h):(await u.before(h),await u.after(h));return}const B=te.slice();B[7]=M.kind,ze("generationPreview",B),j.end(),Y.copyBufferToBuffer(Ne,0,le,0,he),o.queue.submit([Y.finish()]),await S(he);const O=new Float32Array(x(he),0,se).slice();le.unmap(),u.cached?await u.cached(h,O):(await u.before(h),await u.after(h,O)),Y=o.createCommandEncoder(),j=ve(0)},Je=async(h,M,B)=>{const O=sr.indexOf(h),ce=Oe?.get(h);if(ce&&O>=0&&O<er){(U||O===er-1)&&Sn(ce),await Mn(h,ce);return}await u?.before(h),ie(h),await B(),_n(h,M),await Mt(h,M)},Pn=t.procedural?.coastAfter??"initialize",lr=async(h,M)=>{!R||h!==Pn||await Je("coastCut",M===4?5:M,async()=>{if(!st(t,"coastCut"))return;const B=te.slice();B[7]=M,M===0?W("generationRegionalRead",B,Math.ceil(g*g/256)):ze("generationPreview",B),j.end();const O=M===0?g*g:se;Y.copyBufferToBuffer(Ne,0,le,0,O*4),o.queue.submit([Y.finish()]),await S(O*4);const ce=new Float32Array(x(O*4),0,O).slice();le.unmap();const xe=un.cut_field(Ye(t.generalSeed??t.seed,"relief-coast-cut"),t.width,_[3]*2400,_[12],t.coastMask,t.islandMode??"island",M===0?g:i,M===0?m[5]:0,M===0?m[4]:m[11],ce);o.queue.writeBuffer(Ne,0,xe),Y=o.createCommandEncoder(),j=ve(0),M===0?W("generationCut",B,Math.ceil(g*g/256)):ze("generationCut",B),St(M)})};u&&await u.after("grids",void 0,`Budget ×${n} · régional ${g}² · surface ${z[2]}² · ${(w.reduce((h,M)=>h+M.size,0)/1048576).toFixed(1)} Mio`),l?.(`GPU · encodage de ${N} cycles de relief et ${y[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),a?(Ge=z,ze("coastLoad"),St(2)):e?(u&&await u.before("initialize"),Ge=z,ze("volcanicInitial"),u&&await Mt("initialize",2)):(await Je("initialize",0,()=>{W(q)}),await lr("initialize",0),await Je("regional",0,()=>{for(let h=0;h<(re(t,"regional")?N:0);h++){if(W("uplift"),P>0){Ke(0,64*b),Wr(),Yr(k[1]),W("flow"),Ke(1,128*b),Ke(2,128*b),Vr(3);const M=m[17]*3*P;for(let B=0;B<Math.floor(M);B++)Br(.5);M%1>0&&Br(.5*(M%1))}W("bounds")}}),await Je("regionalFinish",0,()=>{const h=te.slice();if(h[7]=1,W("bounds",h),P>0&&re(t,"regionalFinish")){Vr(4,tr);for(let M=0;M<2;M++)Ke(0,64*b),Wr(tr),Yr(k[2]);Br(P*.5,tr)}}),await lr("regionalFinish",0),await Je("reconstruct",1,()=>{const h=te.slice();h[7]=t.procedural?.reconstruction==="bspline"?1:0,ze($,h)}),await Je("amplitude",4,()=>{re(t,"amplitude")?_t(0):W("generationUnitScale",te,1)}),await lr("amplitude",4),await Je("ridged",2,()=>{ze("detail")}),await lr("ridged",2)),j.end(),j=ve(2),await Je("surface",2,()=>{if(t.erosion>0&&K){if(Ge=z,Pe=L,W("surfaceLoad"),t.relief==="canyon"&&!a){const h=Math.ceil(128*b*F);Ke(0,h),W("flow"),Ke(1,h),W("canyonSeed");let M=0;const B=[];for(let ce=2**(Math.ceil(Math.log2(z[2]))-1);ce>=1;ce/=2)B.push(ce);B.push(1,1);for(const ce of B){const xe=te.slice();xe[0]=M,xe[1]=ce,W("canyonSpread",xe),M=1-M}const O=te.slice();O[0]=M,W("canyonApply",O)}for(let h=0;h<y[3];h++)E?(Ke(0,H),Wr(te,!1),Yr(k[7])):(W("surfaceFlowInit"),W("receivers")),W("flow"),Ke(1,H,!0),Ke(3,H,!0),Vr(1),Br(y[7]);W("surfaceDelta"),ze("surfaceReconstruct")}}),await lr("surface",2),j.end(),j=ve(4),await Je("normalize",1,()=>{a?ze("coastResult"):re(t,"normalize")?(_t(1),ze("normalize")):ze("generationKeepDatum")}),await lr("normalize",1);let vr=rt.get(o);vr||(vr=new mt,rt.set(o,vr));const yr=X?vr.get("phasor",gr("phasor")):void 0;if(yr)return j.end(),o.queue.submit([Y.finish()]),u?.cached?await u.cached("phasor",U?yr:void 0):(await u?.before("phasor"),await u?.after("phasor",yr)),ue(),yr;yr||await u?.before("phasor"),ze(G),j.end();const wr=he;Y.copyBufferToBuffer(Ne,0,le,0,wr),Y.copyBufferToBuffer(Re,0,le,wr,1088),Q&&A&&T&&(Y.resolveQuerySet(Q,0,6,A,0),Y.copyBufferToBuffer(A,0,T,0,48));const zn=Y.finish(),Un=performance.now()-ke;l?.(a?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const Cn=performance.now();o.queue.submit([zn]);const An=o.queue.onSubmittedWorkDone().then(()=>l?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([S(wr+1088),T?.mapAsync(GPUMapMode.READ),An]);const En=performance.now()-Cn,Rn=performance.now(),Pt=x(wr+1088),Kr=new Uint32Array(Pt,wr,272),Bn=Array.from(Kr.slice(267,271)),Jr={factor:n,sourceSize:i,coarseSize:g,surfaceSize:z[2],pipelineMs:He,encodeMs:Un,submitReadbackMs:En,unpackMs:0,maxSolveSteps:Bn,allocatedBytes:w.reduce((h,M)=>h+M.size,0)};if(T){const h=new BigUint64Array(T.getMappedRange());Jr.gpuStagesMs={coarse:Number(h[1]-h[0])/1e6,surface:Number(h[3]-h[2])/1e6,normalization:Number(h[5]-h[4])/1e6},T.unmap()}if(s&&(s.profiles??=[]).push(Jr),Kr[2]!==0)throw le.unmap(),new Ar(`Érosion GPU non convergée (${Kr[2]} cellules/étapes, budget ×${n}).`);const xr=new Float32Array(Pt,0,se).slice();le.unmap(),Jr.unpackMs=performance.now()-Rn;const Nn=a||R&&st(t,"coastCut")?-1/0:.3-1e-7;for(let h=0;h<se;h++)if(!Number.isFinite(xr[h])||xr[h]<Nn)throw new Error("Champ GPU invalide.");return ue(),X&&vr.put("phasor",gr("phasor"),xr),u&&await u.after("phasor",U?xr:void 0,"Sortie GPU lue et validée"),xr}catch(m){throw m instanceof Ar&&(Nr.get(o)?.forEach(Gr),Nr.get(o)?.clear(),rt.delete(o)),m}finally{p.free(),w.forEach(m=>{m.mapState!=="unmapped"&&m.unmap(),v&&m.destroy()}),v&&tt.delete(o)}}const Ti=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`,Li=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],jt=new WeakMap,Wt=new WeakMap;function Fi(r){let t=jt.get(r);return t||(t=(async()=>{const i=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(o=>({binding:o,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(o=>({binding:o,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=r.createShaderModule({code:Ti}),a=(await n.getCompilationInfo()).messages.filter(o=>o.type==="error");if(a.length)throw new Error(`Hydrologie WGSL : ${a.map(o=>`${o.lineNum}: ${o.message}`).join(`
`)}`);const s=r.createPipelineLayout({bindGroupLayouts:[i]}),l=await Promise.all(Li.map(async o=>[o,await r.createComputePipelineAsync({layout:s,compute:{module:n,entryPoint:o}})]));return{layout:i,values:new Map(l)}})(),jt.set(r,t)),t}function Hi(r){let t=2166136261;for(let i=0;i<r.length;i++)t=Math.imul(t^r.charCodeAt(i),16777619);return t>>>0}function qi(r,t,i){const n=new Uint32Array(r.length);if(!i)return{mask:n,count:0};const e=new Uint8Array(r.length),a=new Uint32Array(r.length);let s=0,l=0,o=0;const u=d=>{e[d]===0&&r[d]<=0&&(e[d]=1,a[l++]=d)},c=d=>{if(e[d]!==0||r[d]>0)return;s=0,l=0,u(d);let p=!1;for(;s<l;){const _=a[s++],y=_%t,C=Math.floor(_/t);p||=y+1<t&&C+1<t&&r[_+1]<=0&&r[_+t]<=0&&r[_+t+1]<=0;for(let w=-1;w<=1;w++){const U=C+w;if(!(U<0||U>=t))for(let v=-1;v<=1;v++){const f=y+v;f>=0&&f<t&&u(U*t+f)}}}if(p){for(let _=0;_<l;_++)n[a[_]]=1;o+=l}};for(let d=0;d<t;d++)c(d),c((t-1)*t+d);for(let d=1;d+1<t;d++)c(d*t),c(d*t+t-1);return{mask:n,count:o}}class Ii{constructor(t,i,n){this.device=t,this.n=i,this.program=n,this.buffers=[],this.pending=Promise.resolve();const e=i*i,a=(l,o)=>{const u=t.createBuffer({size:l,usage:o});return this.buffers.push(u),u};this.uniform=a(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=a(e*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=a(e*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const s=a(e*48,GPUBufferUsage.STORAGE);this.control=a(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=a(e*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=a(e*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=a(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=t.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,s,this.control,this.output].map((l,o)=>({binding:o+1,resource:{buffer:l}}))]}),t.lost.then(()=>this.buffers.forEach(l=>l.destroy()))}run(t,i,n,e){const a=this.pending.then(()=>this.execute(t,i,n,e));return this.pending=a.then(()=>{},()=>{}),a}async execute(t,i,n,e){const a=performance.now(),s=this.n,l=s*s,o=i/s,u=qi(t,s,e),c=performance.now()-a,d=this.device;d.queue.writeBuffer(this.source,0,t),d.queue.writeBuffer(this.sea,0,u.mask);for(let G=0;G<2;G++){const q=new ArrayBuffer(32);new Uint32Array(q,0,4).set([s,Hi(n),G,e?1:0]),new Float32Array(q,16,4).set([o,o*o,Math.max(.1,o*.1),0]),d.queue.writeBuffer(this.uniform,G*256,q)}const p=(G,q,K=0)=>{G.setPipeline(this.program.values.get(q)),G.setBindGroup(0,this.group,[K*256]),q==="solveTile"?G.dispatchWorkgroups(Math.ceil(s/16),Math.ceil(s/16)):G.dispatchWorkgroups(q==="reset"||q==="clearNext"?1:Math.ceil(l/256))},_=performance.now(),y=d.createCommandEncoder(),C=y.beginComputePass();p(C,"reset"),p(C,"initialize"),C.end(),d.queue.submit([y.finish()]);let w=0,U=!1,v=32;const f=Math.max(256,s);for(;w<f;){const G=d.createCommandEncoder(),q=G.beginComputePass();for(let ue=0;ue<v;ue++){const $=w+ue&1;p(q,"clearNext",$),p(q,"solveTile",$)}q.end(),G.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),d.queue.submit([G.finish()]),w+=v,v=Math.min(v*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const K=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),K===0){U=!0;break}}if(!U)throw new Error(`Drainage hydrique GPU non convergé après ${w} passes (${s}²) ; repli CPU requis.`);const m=d.createCommandEncoder(),g=m.beginComputePass();p(g,"receivers");const N=Math.ceil(Math.log2(l));for(let G=0;G<N;G++){const q=G&1;p(g,"accumulateCopy",q),p(g,"accumulateScatter",q)}p(g,"finish",N&1),g.end();const P=l*16;m.copyBufferToBuffer(this.output,0,this.readback,0,P),m.copyBufferToBuffer(this.control,0,this.readback,P,16),d.queue.submit([m.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const k=performance.now()-_,L=performance.now();let E,b,z,F;try{const G=this.readback.getMappedRange(),q=new Uint32Array(G,P,4);if(q[2]!==0||q[3]!==l-u.count)throw new Error(`Drainage hydrique GPU invalide (${q[2]} erreurs, ${q[3]}/${l-u.count} cellules drainées) ; repli CPU requis.`);const K=new Float32Array(G,0,l*4),ue=new Uint32Array(G,0,l*4);E=new Float32Array(l),b=new Uint32Array(l),z=new Float32Array(l),F=new Float32Array(l);for(let $=0;$<l;$++)E[$]=K[$*4],b[$]=ue[$*4+1],z[$]=K[$*4+2],F[$]=K[$*4+3]}finally{this.readback.unmap()}const H=new Uint8Array(u.mask);return{filled:E,receivers:b,accumulation:z,potential:F,seaMask:H,preprocessingMs:c,computeMs:k,readbackMs:performance.now()-L,floodPasses:w}}}async function Di(r,t,i,n,e=!1){if(![256,512,1024].includes(i)||r.length!==i*i||!Number.isFinite(t)||t<=0||!r.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const a=await yt();if(!a||a.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const s=await Fi(a.device);if(a.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let l=Wt.get(a.device);l||(l=new Map,Wt.set(a.device,l));let o=l.get(i);return o||(o=new Ii(a.device,i,s),l.set(i,o)),o.run(r,t,n,e)}const Yt=new WeakMap;function $i(r){const t=Yt.get(r);if(t)return t;const i=new Float32Array(r.baseHeight.length),n=[],e=v=>r.drainageHeight[v]<r.rawDrainageHeight[v]&&r.surfaceHeight[v]<r.baseHeight[v];let a=!1;for(let v=0;v<i.length;v++){const f=e(v);f&&n.push(v),i[v]=f?0:r.surfaceHeight[v]-r.baseHeight[v],a||=i[v]!==0}const s=256,l=r.width/s,o=new Map,u=[],c=r.riverPoints,d=new Map,p=[],_=r.resolution,y=r.width/_,C=v=>Math.min(y*2,Math.max(y*.5,(r.baseHeight[v]-r.surfaceHeight[v])*1.4)),w=v=>((Math.imul(v^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const v of n){const f=v%_,m=Math.floor(v/_),g=(f+.5)*y,N=(m+.5)*y,P=[];for(let k=-1;k<=1;k++)for(let L=-1;L<=1;L++){const E=f+L,b=m+k,z=b*_+E;if(!L&&!k||E<0||b<0||E>=_||b>=_)continue;const F=e(z);(F&&z>v||!F&&r.basins[z]&&r.surfaceHeight[z]<=r.surfaceHeight[v])&&P.push(z)}P.length||P.push(v);for(const k of P){const L=(k%_+.5)*y,E=(Math.floor(k/_)+.5)*y,b=p.length,z=C(v),F=C(k),H=w(v),G=Math.max(z,F)*(1+Math.abs(H));p.push({a:v,b:k,ra:z,rb:F,skew:H});const q=Me(Math.min(g,L)-G,l,s),K=Me(Math.max(g,L)+G,l,s),ue=Me(Math.min(N,E)-G,l,s),$=Me(Math.max(N,E)+G,l,s);for(let ye=ue;ye<=$;ye++)for(let de=q;de<=K;de++){const ee=ye*s+de,we=d.get(ee);we?we.push(b):d.set(ee,[b])}}}if(r.incision>0)for(let v=0;v<r.riverCount;v++)for(let f=r.riverOffsets[v];f+1<r.riverOffsets[v+1];f++){const m=f+1,g=Math.max(c[f*4+2],c[m*4+2])*.65+.5,N=u.length;u.push({a:f,b:m,estuary:r.riverMeta[v*6+5]});const P=Me(Math.min(c[f*4],c[m*4])-g,l,s),k=Me(Math.max(c[f*4],c[m*4])+g,l,s),L=Me(Math.min(c[f*4+1],c[m*4+1])-g,l,s),E=Me(Math.max(c[f*4+1],c[m*4+1])+g,l,s);for(let b=L;b<=E;b++)for(let z=P;z<=k;z++){const F=b*s+z,H=o.get(F);H?H.push(N):o.set(F,[N])}}const U={delta:i,hasDelta:a,hasSea:r.basins.includes(0),buckets:o,segments:u,bucketSize:l,side:s,notchBuckets:d,notches:p};return Yt.set(r,U),U}const Me=(r,t,i)=>Math.max(0,Math.min(i-1,Math.floor(r/t)));function Vt(r,t,i,n,e){const a=new Int32Array(i*4),s=new Float64Array(i*4);for(let l=0;l<i;l++){const o=Math.max(0,Math.min(e-1,(r+(l+.5)*t)/n-.5)),u=Math.floor(o),c=o-u,d=1-c;for(let p=0;p<4;p++)a[l*4+p]=Math.max(0,Math.min(e-1,u+p-1));s.set([d**3/6,(3*c**3-6*c*c+4)/6,(-3*c**3+3*c*c+3*c+1)/6,c**3/6],l*4)}return{indices:a,weights:s}}function vn(r,t,i=!0){const n=r.resolution,e=r.width/n,a=$i(t);if(!a.hasDelta&&!a.segments.length&&!a.notches.length)return;const s=i?new Float32Array(n*n):void 0;if(a.hasDelta){const f=t.resolution,m=t.width/f,g=Vt(r.x,e,n,m,f),N=Vt(r.y,e,n,m,f),P=N.indices[0],k=N.indices[N.indices.length-1],L=new Float64Array((k-P+1)*n);for(let E=P;E<=k;E++){const b=E*f,z=(E-P)*n;for(let F=0;F<n;F++){const H=F*4;L[z+F]=a.delta[b+g.indices[H]]*g.weights[H]+a.delta[b+g.indices[H+1]]*g.weights[H+1]+a.delta[b+g.indices[H+2]]*g.weights[H+2]+a.delta[b+g.indices[H+3]]*g.weights[H+3]}}for(let E=0;E<n;E++)for(let b=0;b<n;b++){const z=E*4;let F=L[(N.indices[z]-P)*n+b]*N.weights[z]+L[(N.indices[z+1]-P)*n+b]*N.weights[z+1]+L[(N.indices[z+2]-P)*n+b]*N.weights[z+2]+L[(N.indices[z+3]-P)*n+b]*N.weights[z+3];if(F>0&&a.hasSea&&r.height[E*n+b]<=0){const H=Math.max(0,Math.min(f-1,Math.floor((r.x+(b+.5)*e)/m))),G=Math.max(0,Math.min(f-1,Math.floor((r.y+(E+.5)*e)/m))),q=G*f+H;(!t.basins[q]||t.baseHeight[q]>=0)&&(F=0)}s&&(s[E*n+b]=F),r.height[E*n+b]+=F}}const l=new Set,{bucketSize:o,side:u}=a;for(let f=Me(r.y,o,u);f<=Me(r.y+r.width,o,u);f++)for(let m=Me(r.x,o,u);m<=Me(r.x+r.width,o,u);m++)for(const g of a.buckets.get(f*u+m)??[])l.add(g);const c=new Float32Array(n*n),d=t.riverPoints,p=(f,m)=>Math.max(0,Math.min(n-1,Math.floor((f-m)/e))),_=new Set;for(let f=Me(r.y,o,u);f<=Me(r.y+r.width,o,u);f++)for(let m=Me(r.x,o,u);m<=Me(r.x+r.width,o,u);m++)for(const g of a.notchBuckets.get(f*u+m)??[])_.add(g);const y=t.resolution,C=t.width/y,w=C*.25;for(const f of _){const{a:m,b:g,ra:N,rb:P,skew:k}=a.notches[f],L=Math.max(N,P)*(1+Math.abs(k)),E=(m%y+.5)*C,b=(Math.floor(m/y)+.5)*C,z=(g%y+.5)*C,F=(Math.floor(g/y)+.5)*C,H=z-E,G=F-b,q=H*H+G*G,K=Math.min(E,z)-L,ue=Math.max(E,z)+L,$=Math.min(b,F)-L,ye=Math.max(b,F)+L;if(ue<r.x||K>r.x+r.width||ye<r.y||$>r.y+r.width)continue;const de=Math.abs(G)>1e-12,ee=de?L*Math.sqrt(q)/Math.abs(G):0;for(let we=p($,r.y);we<=p(ye,r.y);we++){const Fe=r.y+(we+.5)*e,be=de?E+H*(Fe-b)/G:0,He=de?Math.max(K,be-ee):K,ke=de?Math.min(ue,be+ee):ue;if(!(He>ke||ke<r.x||He>r.x+r.width))for(let Se=p(He,r.x);Se<=p(ke,r.x);Se++){const pe=r.x+(Se+.5)*e,oe=q?Math.max(0,Math.min(1,((pe-E)*H+(Fe-b)*G)/q)):0,Ce=Math.hypot(pe-E-H*oe,Fe-b-G*oe),se=w+(N+(P-N)*oe-w)*(1+k*Math.sign((pe-E)*G-(Fe-b)*H));if(Ce>=se)continue;const he=Math.max(0,(Ce-w)/(se-w)),Ae=1-he*he*(3-2*he),Be=t.surfaceHeight[m]+(t.surfaceHeight[g]-t.surfaceHeight[m])*oe,Ee=we*n+Se;c[Ee]=Math.max(c[Ee],Math.max(0,r.height[Ee]-Be)*Ae)}}}for(const f of l){const{a:m,b:g,estuary:N}=a.segments[f],P=d[m*4],k=d[m*4+1],L=d[g*4],E=d[g*4+1],b=d[m*4+2],z=d[g*4+2],F=d[m*4+3],H=d[g*4+3],G=Math.max(Math.max(b,z)*.65,.5),q=L-P,K=E-k,ue=q*q+K*K,$=Math.min(P,L)-G,ye=Math.max(P,L)+G,de=Math.min(k,E)-G,ee=Math.max(k,E)+G;if(ye<r.x||$>r.x+r.width||ee<r.y||de>r.y+r.width)continue;const we=p(de,r.y),Fe=p(ee,r.y),be=Math.abs(K)>1e-12,He=be?G*Math.hypot(q,K)/Math.abs(K):0;for(let ke=we;ke<=Fe;ke++){const Se=r.y+(ke+.5)*e,pe=be?P+q*(Se-k)/K:0,oe=be?Math.max($,pe-He):$,Ce=be?Math.min(ye,pe+He):ye;if(oe>Ce||Ce<r.x||oe>r.x+r.width)continue;const se=p(oe,r.x),he=p(Ce,r.x);for(let Ae=se;Ae<=he;Ae++){const Be=r.x+(Ae+.5)*e,Ee=Math.max(0,Math.min(1,((Be-P)*q+(Se-k)*K)/Math.max(ue,.001))),Ve=b+(z-b)*Ee,De=F+(H-F)*Ee,Re=Math.hypot(Be-P-q*Ee,Se-k-K*Ee),Ne=Math.max(0,1-Re/Math.max(Ve*.65,.5))**2;if(!Ne)continue;const le=Math.max(.35,Math.min(12,Ve*.11))*t.incision,rr=ke*n+Ae,_e=Math.max(0,Math.min(le*2+.75,r.height[rr]-(De-le)))*Ne*(N>1&&De<le?1.15:1);c[rr]=Math.max(c[rr],_e)}}}let U=1/0,v=-1/0;for(let f=0;f<n*n;f++)r.height[f]-=c[f],s&&(s[f]-=c[f]),U=Math.min(U,r.height[f]),v=Math.max(v,r.height[f]);if(s)for(let f=0;f<n;f++)for(let m=0;m<n;m++){const g=f*n+m,N=Math.max(0,m-1),P=Math.min(n-1,m+1),k=Math.max(0,f-1),L=Math.min(n-1,f+1),E=s[f*n+P]-s[f*n+N],b=s[L*n+m]-s[k*n+m];if(E===0&&b===0)continue;const z=Math.max(1e-6,r.normalZ[g]),F=-r.normalX[g]/z+E/((P-N)*e||e),H=-r.normalY[g]/z+b/((L-k)*e||e),G=Math.hypot(F,H,1);r.normalX[g]=-F/G,r.normalY[g]=-H/G,r.normalZ[g]=1/G}r.minHeight=U,r.maxHeight=v}const ot=new Float32Array(0);function Kt(r,t){const i={...r,normalX:ot,normalY:ot,normalZ:ot};vn(i,t,!1),r.minHeight=i.minHeight,r.maxHeight=i.maxHeight}const ji=(r,t)=>r.riverArea>0?r.riverArea:Math.max(.02,.003*(t/1e3)**2);class wt{constructor(t,i,n,e,a,s){this.engine=t,this.baseHeight=i,this.backend=n,this.backendReason=e,this.drainageMs=a,this.gpu=s}static async create(t,i,n,e,a,s){const l=performance.now();let o,u,c;if(a!=="cpu")try{const p=await Di(e,i,n,t,s);o=Gt.with_drainage(t,i,n,e,s,p.filled,p.receivers,p.accumulation),c=p}catch(p){u=`GPU hydrology unavailable: ${p instanceof Error?p.message:String(p)}`}const d=o?"gpu-f32":"cpu";return o??=new Gt(t,i,n,e,s),new wt(o,e,d,u,performance.now()-l,c)}generate(t,i){const n=performance.now(),e=this.engine.generate(t.main,t.density,t.wetness,t.lakes,t.meanders,t.meanderIntensity,t.estuary,t.widthScale,t.incision,t.minLakeArea,t.lakeAbundance,t.lakeCoverage,t.maxLakeArea,t.depressionPolicy,t.maxBreachDepth,t.maxBreachLength,t.minLakeDepth,i.temperature,i.precipitation,t.coastalStreams);try{const a=e.stage_ms,s=e.stage_labels?Object.fromEntries(e.stage_labels.split(",").map((w,U)=>[w,a[U]])):void 0,l=e.basins;let o=0,u=0;for(const w of l)o=Math.max(o,w),w&&u++;const c=e.river_offsets,d=e.lake_meta,p=e.lake_closed;let _=0;for(let w=2;w<d.length;w+=6)_+=d[w];const y=e.river_meta;let C=!1;for(let w=4;w<y.length;w+=6)C||=(y[w]&2)!==0;return{width:e.width,resolution:e.resolution,receivers:e.receivers,accumulation:e.accumulation,basins:l,rawReceivers:e.raw_receivers??e.receivers,rawAccumulation:e.raw_accumulation??e.accumulation,rawBasins:e.raw_basins??l,flatLabels:e.flat_labels??new Uint32Array(l.length),flatRank:e.flat_rank??new Uint32Array(l.length),externalInflowArea:e.external_inflow_area??0,rawFilled:e.raw_filled??e.filled,rawDrainageHeight:e.raw_drainage_height??e.drainage_height,breachCount:e.breach_count??0,breachCutVolumeM3:e.breach_cut_volume_m3??0,avoidedFillVolumeM3:e.avoided_fill_volume_m3??0,filled:e.filled,lakeDepth:e.lake_depth,lakeLabels:e.lake_labels,baseHeight:this.baseHeight,drainageHeight:e.drainage_height,surfaceHeight:e.surface_height,adjustedHeight:e.adjusted_height,riverPoints:e.river_points,riverOffsets:c,riverMeta:y,riverFlare:e.river_flare,lakePoints:e.lake_points,lakeOffsets:e.lake_offsets,lakeMeta:d,lakeRingMeta:e.lake_ring_meta,lakeClosed:p,waterField:e.water_field,closedLakeCount:p.reduce((w,U)=>w+U,0),nodePoints:e.node_points,nodeMeta:e.node_meta,riverCount:c.length-1,lakeCount:d.length/6,basinCount:o,lakeFraction:_/Math.max(1,u*(e.width/e.resolution)**2),incision:t.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&t.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(t.main)&&!C?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-n,stageMs:s,generationMs:this.drainageMs+performance.now()-n,routingPotential:t.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{e.free()}}dispose(){this.engine.free()}}let Jt="",Or,pt="",ar,Xt="";function yn(r){return new URL(r).protocol==="file:"?Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS.")):((Jt!==r||!Or)&&(Jt=r,Or=(async()=>{const i=await import(new URL("magna_urbis_neural_wasm.js",r).href);return await i.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",r)}),i})().catch(t=>{throw Or=void 0,new Error(`Neural runtime unavailable: run npm run wasm:neural. ${t}`)})),Or)}async function xt(){if(ar){try{(await ar).free()}catch{}ar=void 0,pt=""}}async function Wi(r,t,i,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");(pt!==r||!ar)&&(await xt(),pt=r,ar=(async()=>{const s=await yn(r),{manifest:l}=await Fn(r);Xt=[l.runtimeSha256,...["coarse","base","decoder"].map(u=>l.models[u].sha256)].join(":");const o=[];for(const u of Hn){const c=l.models[u];n?.(`Neuronal WASM · ${u} · ${(c.bytes/1e6).toFixed(1)} Mo`),o.push(await qn(r,l,u,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),s.NeuralRelief.create(o[0],o[1],o[2])})().catch(s=>{throw ar=void 0,s}));const e=await ar;n?.("Neuronal WASM · calcul coarse → base → decoder");const a=await e.generate_json(JSON.stringify(Object.fromEntries(t)),i?JSON.stringify(i):"");try{const s=new Float32Array(a.heights),l=JSON.parse(a.meta),o=Number(t.get("extent")??4e4),u=Number(t.get("resolution")??Math.ceil(o/Number(t.get("sampleSpacing")??30))),c=l.resolution;if(l.extent!==o||l.nativeCellM!==30||l.nativeResolution!==Math.ceil(o/30)||typeof c!="number"||!Number.isInteger(c)||c!==u||s.length!==c*c||l.outputCellM!==o/c||s.some(d=>!Number.isFinite(d)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:s,meta:{...l,modelIdentity:Xt}}}finally{a.free()}}let Zt;async function wn(r,t,i,n){Zt??=gt();const{seed:e,width:a,motifSize:s,relief:l,erosion:o,mountainMix:u,environment:c,zones:d,erosionTuning:p,sketch:_,source:y}=r,C=_?.processing,w=Qe(r),U={seed:e,width:a,motifSize:s,relief:l,erosion:o,mountainMix:u,environment:c,zones:d,erosionTuning:p,sampleSpacing:w.requestedSpacing,sourceN:w.n,coastMask:C?0:r.coastMask??0,islandMode:r.islandMode??"island",source:y,...C?{sketch:{processing:C},surface:Array.from(Hr(pr(_),w.n))}:{}},f=await(await Er(t,"/terrain",JSON.stringify({session:Zt,settings:U,region:i,field:n}))).arrayBuffer();if(f.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const m=new DataView(f).getUint32(0,!0);if(m%4||4+m>f.byteLength)throw new Error("En-tête terrain local invalide.");const g=JSON.parse(new TextDecoder().decode(new Uint8Array(f,4,m)));let N=4+m;const P={};for(const E of g.arrays){const b=E.count*(E.type==="f32"?4:1);if(!Number.isSafeInteger(E.count)||E.count<0||N+b>f.byteLength)throw new Error("Raster terrain local incomplet.");P[E.name]=E.type==="f32"?new Float32Array(f,N,E.count):new Uint8Array(f,N,E.count),N+=b}const k=P.height,L=g.resolution*g.resolution;if(!Number.isInteger(g.resolution)||g.resolution<64||g.resolution>1024||!k||k.length!==L||!k.every(Number.isFinite)||["normalX","normalY","normalZ"].some(E=>P[E]?.length!==L))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(g.fieldFloor)||!Number.isInteger(g.fieldN)||g.fieldN!==w.n||P.field?.length!==g.fieldN*g.fieldN||!P.field.every(Number.isFinite)||P.physical?.length!==g.fieldN*g.fieldN||!P.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:g.session,x:g.x,y:g.y,width:g.width,resolution:g.resolution,minHeight:g.minHeight,maxHeight:g.maxHeight,globalMinHeight:g.globalMinHeight,globalMaxHeight:g.globalMaxHeight,motifSize:g.motifSize,height:k,normalX:P.normalX,normalY:P.normalY,normalZ:P.normalZ,caveMask:P.caveMask,prepareMs:g.prepareMs,samplingMs:g.samplingMs,generationMs:g.prepareMs+g.samplingMs,generationBackend:"native",generationReason:g.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${g.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:g.erosionDefaults,...P.field?{field:{n:g.fieldN,data:P.field,exact:g.fieldExact,floor:g.fieldFloor,...P.physicalCave?{cave:P.physicalCave}:{}}}:{},...P.physical?{physical:{n:g.fieldN,height:P.physical}}:{},definition:w}}function Yi(r){if(r.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return wn(r.settings,r.runtime,r.region,r.kind==="overview")}async function Vi(r,t){const i=await wn(r,t,{x:0,y:0,extent:r.width,resolution:64},!0);if(!i.field||i.field.data.length!==Qe(r).n**2)throw new Error("Surface physique native absente.");return{height:i.field.data,prepareMs:i.prepareMs??0,samplingMs:i.samplingMs??0,session:i.session,fieldExact:i.field.exact,erosionDefaults:i.erosionDefaults}}const Ki="[relief_session_missing]",Qt=r=>Array.from(r,t=>Number.isFinite(t)?t:null),Ji=r=>new Uint8Array(r.buffer,r.byteOffset,r.byteLength);class hr{constructor(t,i){this.runtime=t,this.tuning=i,this.session=gt(),this.steps=[],this.released=!1}static async build(t,i,n,e){const a=new hr(t,e.slice());return await a.mutate({op:"build",...i},n),a}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,t=>t??NaN)}editSurface(t){return this.mutate({op:"edit"},t)}coast(t,i,n,e){return this.mutate({op:"coast",mask:t,mode:i,surface:!!e,...n?{tuning:Qt(n)}:{}},e)}carveUnderdark(t){return this.mutate({op:"underdark",seed:t})}async sampleRegion(t,i,n,e){const{meta:a,arrays:s}=await this.send({op:"read",region:{x:t,y:i,extent:n,resolution:e}}),l=a.region,o=s.height;if(!l||!o||o.length!==l.resolution*l.resolution)throw new Error("Native relief sample incomplete.");return{x:l.x,y:l.y,width:l.width,resolution:l.resolution,min_height:l.minHeight??NaN,max_height:l.maxHeight??NaN,height:o,cave_mask:s.caveMask,normal_x:s.normalX,normal_y:s.normalY,normal_z:s.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}free(){this.released||(this.released=!0,this.steps.length=0,Er(this.runtime,"/release",JSON.stringify({session:this.session})).then(t=>t.arrayBuffer(),()=>{}))}async mutate(t,i){this.meta=(await this.send(t,i)).meta,this.steps.push({header:t,plane:i})}async send(t,i){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(t,i)}catch(n){if(t.op==="build"||!(n instanceof Error)||!n.message.includes(Ki))throw n;for(const e of this.steps)await this.call(e.header,e.plane);return this.call(t,i)}}async call(t,i){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:Qt(this.tuning),...t})),e=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);e.set(n);const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,e.length,!0);const l=await(await Er(this.runtime,"/terrain/relief",new Blob([a,e,...i?[Ji(i)]:[]]))).arrayBuffer();if(l.byteLength<4)throw new Error("Native relief reply incomplete.");const o=new DataView(l).getUint32(0,!0);if(o%4||4+o>l.byteLength)throw new Error("Native relief reply header invalid.");const u=JSON.parse(new TextDecoder().decode(new Uint8Array(l,4,o))),c={};let d=4+o;for(const{name:p,type:_,count:y}of u.arrays){const C=y*(_==="f32"?4:1);if(!Number.isSafeInteger(y)||y<0||d+C>l.byteLength)throw new Error("Native relief plane incomplete.");c[p]=_==="f32"?new Float32Array(l,d,y):new Uint8Array(l,d,y),d+=C}return{meta:u,arrays:c}}}const Xi=["plateau","volcano","caldera"],Tr=r=>r==="neural-wasm"||r==="neural-python"||r==="neural",Zi="http://127.0.0.1:8792",Qi="http://127.0.0.1:8793";function eo(r,t){const i=r==="neural-python"?Qi:Zi,n=t?.trim().replace(/\/+$/,"");if(!n)return i;try{const e=new URL(n);if(e.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(e.hostname)&&["8792","8793"].includes(e.port)&&e.pathname==="/"&&!e.search&&!e.hash&&!e.username&&!e.password)return i}catch{}return n}const xn={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},ro={flat:20,hills:110,plateau:100},cr=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],qr=r=>r.climateValues??ai[r.climate??"temperate"];function en(r){const t=new Float32Array(r.height.length);let i=0,n=0;for(let s=0;s<r.height.length;s++)r.height[s]>0&&(t[n++]=r.height[s],i+=Math.acos(Math.min(1,r.normalZ[s])));const e=t.subarray(0,n).sort(),a=s=>n?e[Math.min(n-1,Math.floor(s*n))]:0;return{p5:a(.05),p50:a(.5),p95:a(.95),slope:i/Math.max(1,n),land:n/Math.max(1,r.height.length)}}let $r,D,fr="",at="",Sr="",Lr,_r,$e,dr=!1,V;const qe=()=>V??D,Mr=()=>V?V.physicalHeightField():Promise.resolve(D.physical_height_field()),rn=()=>V?V.samplingBaseField():Promise.resolve(D.sampling_base_field());let or="",Xe,ur,me,ir,Ie="cpu",Te,tn=Promise.resolve(),je,Pr="",zr="",Le,Fr,Ir="";async function bn(){if(!Ir)return;const r=Ir;Ir="";try{await fetch(`${r}/release`,{method:"POST"})}catch{}}let Ur,Z,Ze;const Cr=new mt;async function to(r,t,i,n){const e=Qe(r),a=Math.ceil(r.width/30),s=(f,m)=>m.extent===r.width&&m.resolution===e.n&&m.nativeCellM===30&&m.nativeResolution===a&&m.outputCellM===r.width/e.n&&f.length===e.n*e.n&&f.every(Number.isFinite),l=eo(r.source,r.neuralServer);r.source==="neural-wasm"&&i==="peninsula"&&(n?.("Presqu’île indisponible dans le neuronal navigateur : île unique."),i="island");const o=new URLSearchParams({seed:r.seed,relief:r.relief,mix:String(r.relief==="mixed"?r.mountainMix:.5),coasts:String(t),islands:i,climate:r.climate??"temperate",noise:String(r.fidelity??.05),extent:String(r.width),sampleSpacing:String(e.requestedSpacing),resolution:String(e.n)}),u=qr(r),c=r.neuralTuning??xn;for(const[f,m]of Object.entries(u))o.set(f,String(m));o.set("landScale",String(c.landScale)),o.set("steps",String(c.steps)),o.set("detail",String(c.detail));for(const f of["coarseModel","baseModel","decoderModel"])r[f]&&o.set(f,r[f]);for(const f of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])o.set(f,String(c[f]));o.set("histogram",c.histogram.join(","));const d=ro[r.relief];c.reliefMode==="fixed"?o.set("reliefFixed",String(c.reliefFixed)):c.reliefMode==="auto"&&d!==void 0?o.set("reliefFixed",String(d)):o.set("reliefScale",String(c.reliefMode==="scale"?c.reliefScale:1));const p=Qn(r.width,r.width,r.neuralFit??"crop",r.neuralSlopes??!0),_=r.zones?{zones:cn(r.zones),region:{x:p.x,y:p.y,width:p.width}}:r.sketch?ei(pr(r.sketch),p):void 0,y=performance.now();if(r.source==="neural-wasm"){if(await bn(),!r.neuralAssets)throw new Error("Neural browser runtime URL missing.");const f=await Wi(r.neuralAssets,o,_,n);if(!s(f.heights,f.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:f.heights,info:{...f.meta,requestMs:performance.now()-y}}}await xt();let C=_;if(r.source==="neural-python"){if(r.zones&&(await fetch(`${l}/status`,{cache:"no-store"}).then(N=>N.json())).zoneConditioning!==1)throw new Error("Le service Python ouvert précède les masques de zones. Relancez start-terrainbench.bat ou npm run neural:python, puis régénérez.");if(!r.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const f=await yn(r.neuralAssets),m=Object.fromEntries(o);C={params:m,conditioning:JSON.parse(f.conditioning_json(JSON.stringify(m),_?JSON.stringify(_):"")),edited:!!_},n?.("Neuronal Python · calcul PyTorch/CUDA")}let w;try{w=await fetch(`${l}/generate?${o}`,{cache:"no-store",...C?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(C)}:{}})}catch{throw new Error(`Neural service unreachable (${l}): run “npm run ${r.source==="neural-python"?"neural:python":"neural:serve"}” from web/`)}if(!w.ok)throw new Error(`Neural service: ${await w.text()}`);const U=new Float32Array(await w.arrayBuffer()),v=JSON.parse(w.headers.get("X-Neural-Meta")??"{}");if(r.source==="neural-python"&&(Ir=l),_&&(v.edited!==!0||v.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!s(U,v))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:U,info:{...v,requestMs:performance.now()-y}}}function no(r){return $r??=(async()=>{li()?(r?.("Chargement du moteur Rust/WASM (threads)…",{stage:"runtime-download"}),await ci(),r?.("Moteur Rust/WASM prêt",{stage:"runtime-ready"})):await ui(()=>bi(pi,t=>di({module_or_path:t}),r))})()}fn(()=>{Cr.clear(),$r=void 0,D=void 0,V?.free(),V=void 0,fr="",or="",dr=!1,je=void 0,Le=void 0,Pr="",zr="",Ur=void 0,Z=void 0,Ze=void 0});function co(r,t,i,n){const e=tn.then(()=>nn(r,t,i,n).catch(async a=>{if(!await si(a))throw a;return i?.("Rust/WASM threads interrompu : reprise sur le moteur mono-thread…",{stage:"runtime-download"}),nn(r,t,i,n)}));return tn=e.catch(()=>{}),e}async function nn(r,t,i,n){const{settings:e,region:a,kind:s,display:l,runtime:o}=r,u=Qe(e);if(In(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("La recette décomposée couvre les reliefs régionaux ; les formes finies et les cavernes gardent leur générateur normal.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning});const c=e.compute==="wasm"?"wasm":"gpu-f32",d=e.generationCompute??"gpu-erosion";if(Dn(e,u.n))throw new Error(`Génération GPU limitée à ${$n}² cellules ; pas demandé ${u.spacing.toFixed(2)} m (${u.n}²). Choisissez CPU ou natif.`);const p=Ye(e.generalSeed??e.seed,"relief-coast-cut"),_=!!e.generalSeed&&ct(e.generalSeed,S=>S.startsWith("relief-"))!==ln(e.generalSeed),y=jr(e),C=e.hydrology?.compute==="auto"&&(c==="wasm"||d==="cpu")?"cpu":e.hydrology?.compute??"auto";if(C!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&yt(),y&&!e.zones&&!e.sketch?.processing&&(!jn.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procédural Phasor : choisir un relief de plaine, collines, vallée, canyon ou montagnes.");const w=d==="native"&&!Tr(e.source);if(w&&o?.profile!=="local")throw new Error("Le moteur natif nécessite le profil Local et son service Rust.");if(w&&e.relief==="cavern")return Yi(r);const U=Xi.includes(e.relief)?e.environment??"mixed":"mixed",v=e.sketch?.processing,f=re(e,"coasts")?e.relief==="cavern"||e.underdark||v?0:e.coastMask??0:0,m=e.islandMode??"island",g=ki.includes(e.relief),N=c!=="wasm"&&g?Si(c,e.relief).catch(()=>{}):void 0;$r&&i?.("Réutilisation du moteur Rust/WASM chargé",{stage:"runtime-ready"});try{await no(i)}catch(S){throw $r=void 0,S}const P=performance.now();N&&i?.("Connexion au périphérique WebGPU…",{stage:"gpu-device"});const k=N?await mr(N):void 0;n&&await n.after("prepare");const L=(S,x)=>{const R=$e;$e={erosionSpacing:S===void 0?R?.erosionSpacing:Math.max(R?.erosionSpacing??0,S),regionalErosionSpacing:x===void 0?R?.regionalErosionSpacing:Math.max(R?.regionalErosionSpacing??0,x)},Object.assign(u,$e)},E=async(S,x=!1)=>{let R=x&&re(e,"phasor",!1)?lt(S,e):S;const X=At(e),J=Et(e),Q=Dr(e);for(const A of["posterior","wind"]){const T=JSON.stringify([Q.get(A),o?.server,!!k,Zn(new Uint8Array(R.buffer,R.byteOffset,R.byteLength))]),fe=e.procedural?Cr.get(A,T):void 0;if(fe){R=fe,n?.cached?await n.cached(A,n.previews===!1?void 0:R):(await n?.before(A),await n?.after(A,n.previews===!1?void 0:R));continue}if(await n?.before(A),A==="posterior"&&e.procedural&&re(e,A)&&X.mode!=="none"){const I=R,ne=Math.sqrt(R.length);R=(await Rt(R,ne,e.width,X,{stats:!1},o)).height;for(let ie=0;ie<R.length;ie++)R[ie]=I[ie]>0?Math.max(.3,R[ie]):R[ie]}A==="wind"&&e.procedural&&re(e,A)&&J.iterations&&J.transport&&(R=k?await vi(k.context,R,e.width,J):gi(R,e.width,J)),e.procedural&&u.n<=1024&&Cr.put(A,T,R),await n?.after(A,n.previews===!1?void 0:R)}return e.procedural&&R.some(A=>A<.3)?R.map(A=>Math.max(.3,A)):R},b=k?mr(k.pipeline).then(S=>({pipeline:S}),()=>{}):void 0,z=!w&&!e.zones&&!e.sketch&&d!=="cpu"&&c!=="wasm"&&!Tr(e.source)&&e.relief!=="cavern",F=z&&k?Bi(k.context,e):void 0;if(F?.error&&e.generationCompute)throw new Error(F.error);const H=e.generationCompute||!F?void 0:F.error??(Wn(F)?`Source ${u.n}² : le coût fixe du GPU dépasse le calcul CPU estimé.`:void 0),G=!!F&&!F.error&&!H,q=z&&_i.includes(e.relief),K=q&&G,ue=(u.n!==1024||!!(e.procedural||n||_))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!Tr(e.source)&&(!K||d!=="gpu-erosion"),$=!v&&Tr(e.source);$||(await xt(),await bn());const ye=o?.profile==="local"&&(w||$),de=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,Xr(e.modification.delta)]):"",ee=JSON.stringify([e.zones,de,!!e.underdark,w?[o.server,f,m]:null,ye?o.server:null])+"|"+JSON.stringify($?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,f,f===255?m:"island",qr(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??xn,e.width,u.n,e.coarseModel,e.baseModel,e.decoderModel]:[e.seed,...e.generalSeed?[ct(e.generalSeed,S=>S.startsWith("relief-"))]:[],e.width,u.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,w?"native":y?[d,c,!!k]:q?d:"cpu",U,e.sketch,e.erosionTuning??{},...e.procedural?[Yn,e.procedural,e.climate,e.climateValues,e.climateZone,K?null:[f,m]]:[],...y||e.procedural?.enabled?.phasor?[Zr,e.climate??"temperate",e.phasor??{}]:[]]);let we=0,Fe=0,be=0,He=0,ke=0,Se;if(n&&n.previews!==!1||!(D||V)||fr!==ee){me?.dispose(),me=void 0,ir=void 0,D?.free(),D=void 0,V?.free(),V=void 0,dr=!1,fr="",or="",$e=void 0;const S=performance.now();Sr="",at="",Lr=void 0,_r=void 0,Ie="cpu",Te=void 0;const x=e.relief==="mixed"?e.mountainMix:.5;Fr=void 0;const R=Float64Array.from(cr,A=>{let T=y&&!e.procedural?NaN:e.procedural?.erosionTuning?.[A]??e.erosionTuning?.[A]??NaN;return e.procedural?.biome&&!K&&!ue&&(A==="incision"||A==="thermal")&&(T=(Number.isFinite(T)?T:1)*(A==="incision"?br(e).water:br(e).thermal)),T});if(kr(R),ue){i?.(H?`${H} Génération Rust CPU à ${u.spacing.toFixed(2)} m…`:w?"Rust natif · pipeline procédural…":"Rust CPU/WASM · pipeline procédural…",{stage:"terrain-generation"});const A=await E(await hi(e,n,w?o:void 0,K&&k?()=>Tt(k.context,e,i):void 0,(T,fe)=>{$e={erosionSpacing:T,regionalErosionSpacing:fe},Object.assign(u,$e)}));n&&await n.before("retain"),ye?V=await hr.build(o,{kind:"source",seed:p,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:x,environment:U},A,R):D=Ue.with_source(p,e.width,e.relief,e.erosion,e.motifSize,x,A,U),n&&await n.after("retain",n.previews===!1?void 0:A),Ie=w?"native":K?d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":y?"compact-cpu":"cpu",Te=H??`Pipeline procédural Rust ${w?"natif":"WASM"} · étapes partagées avec la génération globale.`}else if(w){i?.("Rust natif · génération du relief et érosion…",{stage:"terrain-generation",detail:`Service Rust local · calcul du champ physique ${u.n} × ${u.n}`});const A=e.procedural?.biome?{...e,coastMask:f,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*br(e).water,thermal:(e.erosionTuning?.thermal??1)*br(e).thermal}}:e,T=await Vi(A.sketch&&!v?{...A,sketch:void 0}:A,o);V=await hr.build(o,{kind:"surface",seed:p,width:e.width},v==="surface"?T.height:e.procedural?await E(T.height,!0):T.height,R),Ie="native",Te="Relief et côtes calculés par le service Rust natif ; surface conservée pour le rendu GPU et l’eau.",ke=T.prepareMs}else if(v){i?.("Préparation des altitudes de la heightmap…",{stage:"terrain-import"});const A=Hr(pr(e.sketch),u.n);v==="erosion"?(i?.("CPU · érosion de la heightmap importée…",{stage:"terrain-generation"}),D=Ue.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,U,u.n),D.set_edited_surface(A)):D=Ue.with_surface(p,e.width,A),Te=v==="erosion"?"Heightmap éditée → érosion Rust, sans nouvelle génération.":"Heightmap éditée conservée, sans génération ni érosion."}else if($){const A=await to(e,f,m,i),T=Vn(A.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);ye?V=await hr.build(o,e.zones?{kind:"zonedSurface",seed:p,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:p,width:e.width},T,R):D=e.zones?Ue.with_zoned_surface(p,e.width,e.motifSize,T,JSON.stringify(e.zones)):Ue.with_surface(p,e.width,T),Fr=A.info,Ie="neural",e.zones&&(Te="Zones → conditionnement régional et relief local neuronal, puis opération mer.")}else if(y&&!e.zones)if(k&&G){i?.("GPU · relief compact, érosion régionale et Phasor…",{stage:"terrain-generation"});const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:L},T=await E(await $t(k.context,e,A,i));n&&await n.before("retain"),Se=A.profiles,D=Ue.with_source(p,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,x,T,U),n&&await n.after("retain",T),Ie="compact-gpu-f32",Te=`${Zr} · préréglage compact · grille ${e.procedural?.regionalN??Ct(e).n}² · ${e.climate??"temperate"} · Phasor ${re(e,"phasor",!0)?"actif":"désactivé"}.`}else{i?.("CPU · érosion régionale et Phasor…",{stage:"terrain-generation"});const A=e.procedural?.biome?br(e):void 0,T=A?{incision:A.water,thermal:A.thermal}:e.procedural?{incision:1,thermal:1}:Kn(e),fe=e.procedural?.erosionTuning?.iterations??Ct(e).steps,I=e.erosionTuning??{},ne={...I,iterations:fe,surfaceIterations:re(e,"surface",!1)?I.surfaceIterations??12:0,detail:re(e,"ridged",!1)?I.detail:0,warp:I.warp??0,incision:(I.incision??1)*T.incision,thermal:(I.thermal??1)*T.thermal};kr(Float64Array.from(cr,ae=>ne[ae]??NaN));let ie;try{ie=Ue.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,U,u.n);const ae=ie.physical_height_field();D=Ue.with_source(p,e.width,"hills",e.erosion,e.motifSize,x,re(e,"phasor",!0)?lt(ae,e):ae,U)}finally{ie?.free(),kr(new Float64Array(cr.length).fill(NaN))}Ie="compact-cpu",Te=`${Zr} · Rust CPU + Phasor scalaire · ${e.climate??"temperate"} ; topographie indépendante du GPU.`}else if(e.zones)i?.("CPU · relief et érosion des zones peintes…",{stage:"terrain-generation",detail:`Rust/WASM · champ physique ${u.n} × ${u.n}`}),D=Ue.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,U,JSON.stringify(cn(e.zones)),u.n),Te="Masques de zones → soulèvement, bruits, crêtes et érosion Rust.";else if(K&&k)try{if(d==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:L},T=await E(await $t(k.context,e,A,i));n&&await n.before("retain"),ke=A.nativeEnvironmentMs,Se=A.profiles,He=performance.now()-S-ke,D=Ue.with_source(p,e.width,e.relief,e.erosion,e.motifSize,x,T,U),n&&await n.after("retain",T),Ie="gpu-erosion-f32"}else{const A=await Tt(k.context,e,i);Fe=performance.now()-S;const T=performance.now();i?.("CPU · érosion à partir des bruits GPU…",{stage:"terrain-generation"}),D=Ue.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,A.coarse,A.fine,U),be=performance.now()-T,Ie=d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(A){if(n||e.procedural)throw A;Te=`GPU generation unavailable: ${A instanceof Error?A.message:String(A)}`}if(!D&&!V&&(i?.(e.relief==="cavern"?"CPU · génération des cavernes…":"CPU · génération du relief et érosion…",{stage:"terrain-generation",detail:`Rust/WASM · source physique ${u.n}² à ${u.spacing.toFixed(2)} m`}),D=Ue.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,U,u.n),H&&(Te=H)),!v&&!$&&e.sketch&&e.relief!=="cavern"){const A=pr(e.sketch),T=await Mr(),fe=Jn(A,T,u.n);V?await V.editSurface(fe):D.set_edited_surface(fe),Te="Edited sketch + procedural detail and Rust erosion."}const X=At(e),J=Et(e),Q=re(e,"posterior")&&X.mode!=="none"||re(e,"wind")&&J.iterations>0&&J.transport>0;if(!ue&&e.procedural&&(Q||!y&&re(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(Ie)&&!$&&!v&&!w&&!e.zones){D.set_coast(f,m);const A=D.physical_height_field(),T=await E(A,!y);D.free(),D=Ue.with_surface(p,e.width,T),dr=!0}we=performance.now()-S,fr=ee}else if(i?.("Réutilisation du relief déjà calculé",{stage:"terrain-generation"}),$e&&Object.assign(u,$e),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const S of["grids",...ht(e),"phasor","posterior","wind"])await n.cached(S);const pe=JSON.stringify([Dr(e).get("coasts"),Ie,o?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,Xr(e.sketch.heights)],e.zones&&[e.zones.resolution,Xr(e.zones.weights)]]),oe=e.procedural&&f&&!$&&!dr?Cr.get("coasts",pe):void 0;!oe&&n&&await n.before("coasts");const Ce=!F?.error&&!H&&!e.zones&&!e.sketch&&f!==0&&d!=="cpu"&&c!=="wasm",se=$?"neural":JSON.stringify([f,f===255?m:"island",f?Ce:!1]);let he=0;if($||w&&!ue||dr)or=se,Xe=dr&&f?"cpu":void 0,ur=void 0;else if(or!==se){me?.dispose(),me=void 0,ir=void 0,Xe=void 0,ur=void 0;const S=performance.now();i?.("Découpe des côtes et des îles…",{stage:"terrain-coast"});const x=e.procedural,R={...e.erosionTuning,...x?.erosionTuning},X=x&&f?Float64Array.from(cr,J=>J==="surfaceIterations"?x.coastIterations??(y?2:12):J==="surfaceIncision"?(R[J]??1)*(x.coastIncision??1):J==="surfaceThermal"?(R[J]??1)*(x.coastThermal??1):J==="surfaceDiffusion"?(R[J]??1)*(x.coastDiffusion??1):R[J]??NaN):void 0;if(V?(await V.coast(f,m,oe?void 0:X,oe),f&&(Xe="native")):oe&&(D.configure_coast(f,m),D.set_coast_surface(oe),Xe="cpu"),!V&&!oe&&Ce&&k){let J;try{const Q=await b;if(!Q||k.context.lost)throw new Error("WebGPU indisponible");D.configure_coast(f,m),J=new Lt(k.context,Q.pipeline,c,D);const A=J.prepareCoastField(e),T=await Ni(k.context,e,A,D.coast_erosion_parameters(),i);D.set_coast_surface(T),Xe="gpu-f32"}catch(Q){ur=`Littoral GPU indisponible : ${Q instanceof Error?Q.message:String(Q)}`}finally{J?.dispose()}}if(!V&&!Xe){X&&kr(X);try{D.set_coast(f,m)}finally{X&&kr(Float64Array.from(cr,J=>R[J]??NaN))}f&&(Xe="cpu"),Ce&&!k&&(ur="WebGPU indisponible")}or=se,he=f?performance.now()-S:0,we+=he}const Ae=f&&e.procedural&&(!oe&&u.n<=1024||n&&n.previews!==!1&&!(oe&&n.cached))?await rn():void 0;if(Ae&&!oe&&u.n<=1024&&Cr.put("coasts",pe,Ae),oe&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:oe):n&&await n.after("coasts",n.previews===!1?void 0:Ae),e.modification&&Sr!==ee+"|"+se){const S=qe().source_resolution(),x=v==="surface"?Hr(pr(e.sketch),S):await Mr();if(Lr={n:S,height:x.slice()},_r=Xn(x,S,e.modification),me?.dispose(),me=void 0,ir=void 0,V){const R=V;V=await hr.build(o,{kind:"surface",seed:p,width:e.width},_r,new Float64Array(cr.length).fill(NaN)),R.free()}else D?.free(),D=Ue.with_surface(p,e.width,_r);Sr=ee+"|"+se}e.underdark&&at!==ee+"|"+se+"|"+Sr&&(i?.("Outreterre · creusement des cavernes et des tunnels…",{stage:"terrain-generation"}),me?.dispose(),me=void 0,ir=void 0,V?await V.carveUnderdark(e.seed):D.carve_underdark(e.seed),at=ee+"|"+se+"|"+Sr);let Be;const Ee=async(S,x,R)=>((Be?.delta!==S||Be.m!==x||Be.n!==R)&&(Be={delta:S,m:x,n:R,out:await oi(S,x,R,o)}),Be.out);async function Ve(S){$e?Object.assign(u,$e):u.erosionSpacing??=qe().erosion_spacing(),S.definition=u,n&&await n.after("sampling",S.height),n&&await n.before("hydrology");const x=re(e,"hydrology")?e.hydrology:void 0;S.neural=Fr,s==="overview"&&!$&&e.relief!=="cavern"&&(S.erosionDefaults=Array.from(fi(e.relief,e.width,e.motifSize,e.mountainMix)));const R=!!x?.enabled&&e.relief!=="cavern",X=x?.engine!=="rust",J=x?.erosionEnabled!==!1,Q=J&&x?.showErosion!==!1,A=J?x?.condMode:"none",T=X&&x&&x.lakes!=="none"?[x.lakeAbundance,x.lakeArea,x.lakeDepth,x.lakeCoverage,x.maxLakeArea]:[0,0,0,0,0],fe=x&&{mode:x.condMode,strength:x.condStrength,maxDepth:x.condDepth,maxLength:x.condLength,banks:x.condBanks,lakes:T[0],lakeArea:T[1],lakeDepth:T[2],lakeCoverage:T[3],maxLakeArea:T[4]};if(t&&x&&R&&s==="overview"&&l==="gl"){const I=Bt(X?x.vectorResolution:x.resolution,u.n),ne=JSON.stringify([fr,or,I,A,A==="none"?0:[x.condStrength,x.condDepth,x.condBanks,x.condLength,T]]);(!Z||Z.key!==ne||X&&!Ze)&&t({...S,height:S.height.slice(),normalX:S.normalX.slice(),normalY:S.normalY.slice(),normalZ:S.normalZ.slice(),caveMask:S.caveMask.slice(),neural:Fr,field:await De(S,!1,X),relief:en(S),generationMs:performance.now()-P})}if(x&&R){const I=Bt(X?x.vectorResolution:x.resolution,u.n),ne=JSON.stringify([fr,or,I,A,A==="none"?0:[x.condStrength,x.condDepth,x.condBanks,x.condLength,T]]),ie=qr(e),ae={riverArea:ji(x,e.width)/Math.max(.05,x.density)**2,headwaters:x.headwaters!==!1?1:0,lakeDepth:x.lakeDepth,lakeArea:x.lakeArea,riverMode:x.riverMode,flatSlope:x.flatSlope,sinuosity:x.sinuosity,widthScale:x.vectorWidth,balance:x.balance,braiding:x.braiding,anabranching:x.anabranching,terrainInfluence:x.terrainInfluence,avulsions:x.avulsions,confluence:x.confluence,deltas:x.deltas},Pe=JSON.stringify([ne,ae,ie.temperature,ie.precipitation,Ye(e.generalSeed??e.seed,"water-hydrology")]);if(!Z||Z.key!==ne){Z=void 0,Ze=void 0,je?.dispose(),je=void 0,Le=void 0,Pr="",zr="";let ge;if(S.x===0&&S.y===0&&S.width===e.width&&S.resolution===I)ge=S.height.slice();else if(me&&!me.lost)ge=(await me.sample({x:0,y:0,extent:e.width,resolution:I},e,D.min_height,D.max_height)).height;else{const Y=V?await V.sampleRegion(0,0,e.width,I):D.sample_region(0,0,e.width,I);try{ge=Y.height}finally{Y.free()}}if(A==="none")Z={key:ne,n:I,height:ge,m:0};else{i?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const Y=fe;if(X){const ve=await Nt(ge,I,e.width,Y,ae,ie,Ye(e.generalSeed??e.seed,"water-hydrology"),o),{height:j,delta:te,...tr}=ve.conditioning;Z={key:ne,n:I,height:j,source:ge,delta:te,m:I,stats:tr},Ze={key:Pe,water:ve.water}}else{const ve=await Rt(ge,I,e.width,Y,{stats:!1,drainage:!1},o),{height:j,delta:te,hydrology:tr,...Ge}=ve;Z={key:ne,n:I,height:j,source:ge,delta:te,m:I,stats:{...Ge,census:!1},drainage:tr}}}}if(X){if(!Ze||Ze.key!==Pe)if(i?.("Hydrologie vectorielle · bilan hydrique, lacs et cours d’eau…",{stage:"terrain-water"}),Z.source){const ge=await Nt(Z.source,I,e.width,fe,ae,ie,Ye(e.generalSeed??e.seed,"water-hydrology"),o),{height:Y,delta:ve,...j}=ge.conditioning;Object.assign(Z,{height:Y,delta:ve,stats:j}),Ze={key:Pe,water:ge.water}}else Ze={key:Pe,water:await ri(Z.height,I,e.width,ae,ie,Ye(e.generalSeed??e.seed,"water-hydrology"),Z.drainage,o)}}else{const ge=JSON.stringify([ne,C,Ye(e.generalSeed??e.seed,"water-hydrology")]),Y={...x,showErosion:!0,erosionEnabled:J,...J?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},ve=`${ge}|${JSON.stringify(Y)}`;if($&&Ur?.key===ve)S.hydrologyError=Ur.message;else try{(!je||Pr!==ge)&&(i?.("Hydrologie Rust · préparation du drainage…",{stage:"terrain-drainage"}),je?.dispose(),je=void 0,Le=void 0,zr="",je=await wt.create(Ye(e.generalSeed??e.seed,"water-hydrology"),e.width,I,Z.height.slice(),C,e.sketch||e.zones?qe().min_height<=0:$?qe().min_height<0:f!==0),Pr=ge);const j=qr(e),te=JSON.stringify([Y,j.temperature,j.precipitation]);(!Le||zr!==te)&&(i?.("Hydrologie Rust · rivières, lacs et érosion…",{stage:"terrain-water"}),Le=je.generate(Y,j),zr=te)}catch(j){if(!$)throw j;je?.dispose(),je=void 0,Le=void 0,Pr="",Ur={key:ve,message:j instanceof Error?j.message:String(j)},S.hydrologyError=Ur.message}}}if(i?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),R&&Q&&Z?.delta&&!e.underdark&&await ti(S,Z.delta,Z.m,e.width,o),R&&Q&&!X&&Le&&!S.hydrologyError){const I=performance.now();vn(S,Le),S.hydrologySurfaceMs=performance.now()-I}if(s==="overview"){const I=qe().source_resolution(),ne=e.underdark?await Mr():_r?.slice()??(v==="surface"?Hr(pr(e.sketch),I):await Mr());if(R&&Q&&Z?.delta&&!e.underdark){const ie=await Ee(Z.delta,Z.m,I);for(let ae=0;ae<ne.length;ae++)ne[ae]+=ne[ae]<=0?Math.min(0,ie[ae]):ie[ae]}R&&Q&&!X&&Le&&!S.hydrologyError&&Kt({x:0,y:0,width:e.width,resolution:I,height:ne,minHeight:S.globalMinHeight,maxHeight:S.globalMaxHeight},Le),S.physical={n:I,height:ne},Lr&&(S.modificationBase=Lr)}return e.refine&&l!=="gl"&&ni(S,e.width/qe().source_resolution(),ii(e.seed),e.detailNoise),s==="overview"&&(l==="gl"||r.retainField)&&(i?.("Conservation du champ physique et du réseau d’eau…",{stage:"terrain-retain"}),S.field=await De(S,R,X)),s==="overview"&&R&&(X?S.water=Ze?.water:Le&&!S.hydrologyError&&(S.hydrology=Le),Z?.delta&&Z.stats&&(S.conditioning={delta:Z.delta,n:Z.m,stats:Z.stats})),s==="overview"&&(S.relief=en(S)),e.zones&&S.neural&&S.relief&&(S.neural={...S.neural,land:S.relief.land}),S.generationMs=performance.now()-P,n&&await n.after("hydrology",S.height),S}async function De(S,x,R){const X=qe().sampling_parameters()[5],J=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((X===1||X===4)&&e.relief!=="cavern"){const fe=qe().source_resolution(),I=await rn();if(x&&J&&Z?.delta&&!e.underdark){const ae=await Ee(Z.delta,Z.m,fe);for(let Pe=0;Pe<fe*fe;Pe++)I[Pe]+=I[Pe]<=0?Math.min(0,ae[Pe]):ae[Pe]}const ne=x&&J&&!R&&!S.hydrologyError?Le:void 0;ne&&Kt({x:0,y:0,width:e.width,resolution:fe,height:I,minHeight:S.globalMinHeight,maxHeight:S.globalMaxHeight},ne);const ie=e.underdark?V?await V.physicalCaveField():D.physical_cave_field():void 0;return{n:fe,data:I,exact:!ne,floor:X===1?.3:0,cave:ie?.length?ie:void 0}}const Q=qe().source_resolution(),A=S.physical?.height.slice()??await Mr(),T=e.relief!=="cavern"&&!e.underdark?void 0:V?await V.physicalCaveField():D.physical_cave_field();return{n:Q,data:A,exact:!1,floor:0,cave:T?.length?T:void 0}}n&&await n.before("sampling",`Borne du moteur ${qe().max_height.toFixed(2)} m · aperçu ${a.resolution}²`);let Re,Ne=0,le;if(c!=="wasm"&&g&&!V&&!e.underdark){i?.("Préparation des shaders d’échantillonnage WebGPU…",{stage:"gpu-sampling-compile"});const S=performance.now();try{const x=await b;k&&x&&!k.context.lost&&((!me||ir!==c||me.lost)&&(me?.dispose(),me=void 0,me=new Lt(k.context,x.pipeline,c,D),ir=c),Ne=performance.now()-S,i?.(`GPU · échantillonnage du relief ${a.resolution} × ${a.resolution}…`,{stage:"terrain-sampling"}),le={...await me.sample(a,e,D.min_height,D.max_height),generationMs:performance.now()-P,prepareMs:we,gpuSetupMs:Ne,generationBackend:Ie,generationReason:Te,noiseMs:Fe,erosionMs:be,gpuSimulationMs:He,nativeEnvironmentMs:ke,erosionProfile:Se,coastBackend:Xe,coastMs:he,coastReason:ur}),le||(Re="WebGPU indisponible")}catch(x){Re=`GPU indisponible : ${x instanceof Error?x.message:String(x)}`,me?.dispose(),me=void 0,ir=void 0}}else V?Re="Native Rust sampling on the local service.":c!=="wasm"&&(Re="terrain currently sampled in WASM");if(le)return Ve(le);i?.(`${V?"Rust natif":"CPU"} · échantillonnage du relief ${a.resolution} × ${a.resolution}…`,{stage:"terrain-sampling"});const rr=performance.now(),_e=V?await V.sampleRegion(a.x,a.y,a.extent,a.resolution):D.sample_region(a.x,a.y,a.extent,a.resolution);try{return await Ve({x:_e.x,y:_e.y,width:_e.width,resolution:_e.resolution,minHeight:_e.min_height,maxHeight:_e.max_height,globalMinHeight:qe().min_height,globalMaxHeight:qe().max_height,motifSize:e.motifSize,height:_e.height,caveMask:_e.cave_mask,normalX:_e.normal_x,normalY:_e.normal_y,normalZ:_e.normal_z,generationMs:performance.now()-P,backend:V?"native":"wasm",backendReason:Re,prepareMs:we,samplingMs:performance.now()-rr,gpuSetupMs:Ne,generationBackend:Ie,generationReason:Te,noiseMs:Fe,erosionMs:be,gpuSimulationMs:He,nativeEnvironmentMs:ke,erosionProfile:Se,coastBackend:Xe,coastMs:he,coastReason:ur})}finally{_e.free()}}export{ai as CLIMATE_VALUES,Zi as DEFAULT_NEURAL_SERVER,xn as DEFAULT_NEURAL_TUNING,Qi as DEFAULT_PYTHON_SERVER,cr as EROSION_SETTINGS,Xi as GEOLOGICAL_RELIEFS,ro as NEURAL_RELIEF_DEFAULTS,qr as climateOf,Tr as isNeuralSource,eo as neuralServerForSource,en as reliefStatistics,co as sampleRustTerrain};
