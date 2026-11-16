import{T as yt,n as Br,k as er,m as Kr,G as Gr,o as cn,p as un,q as fn,t as re,u as In,w as wt,x as Wr,s as Je,y as xt,z as dn,A as ft,C as Et,B as dt,D as pn,E as br,F as Hn,H as Ue,I as pt,J as hn,K as Rt,L as qn,M as Dn,N as Nt,O as Hr,P as hr,Q as $n,S as jn,U as Wn,V as Yn,W as Vn,X as Jn,Y as tt,Z as Kn,_ as nt,$ as zr,a0 as Ur,a1 as Xn,a2 as Bt,a3 as Zn,a4 as mn,a5 as Qn,a6 as Gt,a7 as Tt,a8 as ei,a9 as ri,aa as ti,ab as ni,ac as ii,ad as ai,ae as Lt,af as oi,ag as si,ah as li,ai as Ot,aj as Ft,ak as ci,al as ui,am as fi,an as di,ao as pi,ap as hi,aq as mi,ar as gi}from"./engine.worker-G2o_a7Ch.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/let Ye;const it=new Map;let ht=Promise.resolve();const mt=new yt;function Yr(t=!1){const r=Ye;Ye=void 0,mt.clear(),t||r?.pipeline?.free(),r?.runtime&&(ht=ht.then(async()=>{await Br(r.runtime,"/terrain/stage",JSON.stringify({session:r.session,command:"cancel"})).catch(()=>{})}))}pn(()=>Yr(!0));async function vi(t,r,i,n,e){r?.backend?.(i?"native":"cpu");const o=er(t),s=r?.previews!==!1&&o.n<=1024,u=Kr(t),a=Gr.erosion_at_resolution(t.seed,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix,o.n),l=a.parameters();a.free();const{parameters:c,surface:p}=u?cn(l,t):{parameters:l,surface:l.slice(24,32)};un(c,p,t,u),fn(p,t,o.n),u&&re(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural?.erosionTuning?.detail===void 0&&(c[16]=l[16]);const d=(b,U=!0)=>Number(re(t,b,U)),S=Uint32Array.from([Number(u),d("regional"),d("regionalFinish"),d("amplitude"),d("ridged",!u),d("surface",!u||t.relief==="canyon"),d("normalize"),+(t.procedural?.regionalThermal!==!1),+(t.procedural?.regionalDiffusion!==!1),t.procedural?.reconstruction==="cubic"?1:t.procedural?.reconstruction==="bspline"?2:0,+(t.relief==="canyon")]);e?.(S[5]&&c[23]>0&&p[3]>0?p[1]:void 0,S[1]&&t.erosion>0?c[4]:void 0);const w=In([t.seed,t.width,o.n,c[2],i?.server??"wasm",!!n]);(o.n>1024||Ye?.root!==w)&&Yr();const C=wt(t),y=Wr(t),P=C.map(b=>y.get(b));let v=0;for(;Ye&&v<P.length&&Ye.keys[v]===P[v];)v++;const f=async b=>{try{return await Br(i,"/terrain/stage",JSON.stringify({session:Ye.session,...b}))}catch(U){throw["coast","restore","preview"].includes(b.command)&&U instanceof Error&&U.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):U}},m=t.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([b,U])=>[b,Je(t.generalSeed,U)])):void 0,g={parameters:Array.from(c),surface:Array.from(p),flags:Array.from(S),stepSeeds:m??{}},B=async b=>{const U=await f(b),F=await U.json();if(m&&Object.values(m).some(I=>I!==t.seed)&&!F.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!Ye||v===0?(Yr(),i&&!it.has(i.server)&&it.set(i.server,xt()),Ye={root:w,keys:[],runtime:i,...i?{session:it.get(i.server)}:{}},await r?.before("grids",`Rust ${i?"natif":"WASM"} · régional ${c[2]}² · surface ${p[0]}² · source ${o.n}² à ${o.spacing.toFixed(2)} m`),i?(await ht,await B({command:"start",seed:t.seed,...g})):Ye.pipeline=new dn(t.seed,c,p,S),await r?.after("grids")):r?.cached?await r.cached("grids"):(await r?.before("grids"),await r?.after("grids"));const z=Ye;i||z.pipeline.set_step_seeds(JSON.stringify(m??{}));let k;for(let b=0;b<C.length;b++){const U=C[b],F=b<v;if(!F&&b===v&&b>0&&(i?await B({command:"restore",checkpoint:b-1,...g}):z.pipeline.restore(b-1,c,p,S),z.keys.length=b),F){(s||b===C.length-1)&&(k=i?new Float32Array(await(await f({command:"preview",checkpoint:b})).arrayBuffer()):z.pipeline.checkpoint_height(b)),r?.cached?await r.cached(U,s?k:void 0):(await r?.before(U),await r?.after(U,s?k:void 0));continue}await r?.before(U);const I=U==="coastCut"&&ft(t,"coastCut");if(i){const H=await(await f({command:U==="coastCut"?"coast":"advance",stage:Et.indexOf(U),checkpoint:b,mask:I?t.coastMask:0,mode:t.islandMode??"island",preview:s||b===C.length-1})).arrayBuffer();H.byteLength&&(k=new Float32Array(H))}else{if(U==="initialize"&&n){const G=await n();z.pipeline.set_noise(G.coarse,G.fine)}U==="coastCut"?I&&z.pipeline.cut_coast(t.coastMask,t.islandMode??"island"):z.pipeline.advance(Et.indexOf(U)),z.pipeline.checkpoint(b),(s||b===C.length-1)&&(k=z.pipeline.height())}z.keys[b]=P[b],await r?.after(U,s?k:void 0)}const O=`${w}|${y.get("phasor")}`,E=o.n<=1024?mt.get("phasor",O):void 0;return E?(r?.cached?await r.cached("phasor",s?E:void 0):(await r?.before("phasor"),await r?.after("phasor",E)),E):(await r?.before("phasor"),re(t,"phasor",u)&&(k=dt(k,t)),o.n<=1024&&mt.put("phasor",O,k),await r?.after("phasor",s?k:void 0),k)}const yi=`
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
}`,It=new WeakMap;function wi(t,r,i){if(!i.iterations||!i.transport)return t;const n=t.slice(),e=Math.sqrt(n.length),o=r/e,s=new Float32Array(n.length),u=i.azimuth*Math.PI/180,a=Math.cos(u),l=Math.sin(u),c=a>=0?1:-1,p=l>=0?1:-1,d=Math.abs(a)/(Math.abs(a)+Math.abs(l)),S=1-d;for(let w=0;w<i.iterations;w++){s.fill(0);for(let C=1;C<e-1;C++)for(let y=1;y<e-1;y++){const P=C*e+y;if(n[P]<=.3)continue;const v=((n[P+1]-n[P-1])*a+(n[P+e]-n[P-e])*l)/(2*o),f=.75+.25*Math.sin((y*a+C*l)*o/64+n[P]*.03);s[P]=Math.min(Math.max(0,n[P]-.3),i.transport*Math.max(.1,Math.min(1,.55+2*v))*f)}for(let C=0;C<e;C++)for(let y=0;y<e;y++){const P=C*e+y,v=C*e+Math.max(0,Math.min(e-1,y-c)),f=Math.max(0,Math.min(e-1,C-p))*e+y;n[P]=n[P]-s[P]+(v!==P?s[v]*d:0)+(f!==P?s[f]*S:0)}}return n}async function xi(t,r,i,n){if(!n.iterations||!n.transport)return r;const e=t.device,o=Math.sqrt(r.length);let s=It.get(e);s||(s=(async()=>{const d=e.createShaderModule({code:yi}),w=(await d.getCompilationInfo()).messages.filter(f=>f.type==="error");if(w.length)throw new Error(w.map(f=>`${f.lineNum}: ${f.message}`).join(`
`));const C=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),y=e.createPipelineLayout({bindGroupLayouts:[C]}),[P,v]=await Promise.all(["entrain","deposit"].map(f=>e.createComputePipelineAsync({layout:y,compute:{module:d,entryPoint:f}})));return{layout:C,a:P,b:v}})(),It.set(e,s));const{layout:u,a,b:l}=await s,c=[],p=(d,S)=>{const w=e.createBuffer({size:d,usage:S});return c.push(w),w};try{const d=p(r.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),S=p(r.byteLength,GPUBufferUsage.STORAGE),w=p(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),C=p(r.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);e.queue.writeBuffer(d,0,r);const y=new ArrayBuffer(48),P=new Float32Array(y);new Uint32Array(y)[0]=o;const v=n.azimuth*Math.PI/180;P[1]=i/o,P[2]=Math.cos(v),P[3]=Math.sin(v),P[4]=n.transport,e.queue.writeBuffer(w,0,y);const f=e.createBindGroup({layout:u,entries:[d,S,w].map((E,b)=>({binding:b,resource:{buffer:E}}))}),m=Math.ceil(r.length/256),g=Math.ceil(m/e.limits.maxComputeWorkgroupsPerDimension),B=Math.ceil(m/g),z=e.createCommandEncoder(),k=z.beginComputePass();k.setBindGroup(0,f);for(let E=0;E<n.iterations;E++)k.setPipeline(a),k.dispatchWorkgroups(B,g),k.setPipeline(l),k.dispatchWorkgroups(B,g);k.end(),z.copyBufferToBuffer(d,0,C,0,r.byteLength),e.queue.submit([z.finish()]),await C.mapAsync(GPUMapMode.READ);const O=new Float32Array(C.getMappedRange()).slice();return C.unmap(),O}finally{c.forEach(d=>d.destroy())}}var bi=`// FP32 sampling of the retained Rust erosion field.\r
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
`,bt=`// Shared FP32 simplex and FBM kernels.\r
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
`,ki=`// Same noise octaves and physical wavelengths as erosion::mountain.\r
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
`,gn=`// Seeded finite volcanic geometry. Shared by generation and camera sampling.\r
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
`,Si=`// The dedicated third simplex stream matches Rust's shore-noise fork.\r
// Sixteen header vec4s (profile, unused offsets and turns, character, six bumps, then the\r
// relief fit: shift/median/inverse spread/drowning and band/shelf/sea count), then the edge\r
// sea capsules, two vec4s each (endpoints; radii), then each land capsule is three vec4s:\r
// endpoints; radii/scale/phase; islet height/center/apron. Same layout as Rust \`Coast\`.\r
@group(0) @binding(6) var<storage, read> coast: array<vec4<f32>>;\r
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
    // Edge seas (coves, corner seas, coastal runs): union of their capsules, as in Rust.\r
    var sea=-10.0;\r
    for(var k=0u;k<u32(coast[15].z);k++){\r
      let ends=coast[16u+k*2u];let radii=coast[17u+k*2u];let delta=ends.zw-ends.xy;\r
      let t=clamp(dot(warped-ends.xy,delta)/max(dot(delta,delta),1e-12),0.0,1.0);\r
      sea=max(sea,mix(radii.x,radii.y,t)-length(warped-ends.xy-t*delta));\r
    }\r
    distance=-sea\r
      +character.z*fbm(uv/character.w,2u,7u,0.56,footprint/character.w)\r
      +fine.x*fbm(uv/fine.y,2u,5u,0.55,footprint/fine.y);\r
  }\r
  var cachedPhase=-1.0;var detail=0.0;\r
  let land=16u+2u*u32(coast[15].z);\r
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
`;let at;const _i=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function kt(){return at??=(async()=>{const t=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!t)return;const{maxBufferSize:r,maxStorageBufferBindingSize:i}=t.limits,n=await t.requestDevice({requiredFeatures:t.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:r,maxStorageBufferBindingSize:i}}),e={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{e.lost=!0,at=void 0}),e})().catch(()=>{}),at}async function Mi(t,r){if(t==="wasm")return;const i=await kt();if(!i||i.lost)return;const n=r==="flat"?0:r==="valley"?2:r==="volcano"||r==="caldera"||r==="plateau"?3:1,e=`${t}:${n}`;let o=i.pipelines.get(e);return o||(o=(async()=>{const s=bi.replace("// NOISE_KERNEL",bt).replace("// VOLCANIC_KERNEL",gn).replace("// COAST_KERNEL",Si),u=i.device.createShaderModule({code:s});return i.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),o.catch(()=>{}),i.pipelines.set(e,o)),{context:i,pipeline:o}}const Pi=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Ht(t,r,i){const n=t.device,e=er(r).n,o=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),s=r.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=s.map(c=>{const p=`generation:${c}`;let d=t.pipelines.get(p);if(!d){const S=n.createShaderModule({code:ki.replace("// NOISE_KERNEL",bt)});d=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[o]}),compute:{module:S,entryPoint:c}}),t.pipelines.set(p,d)}return d}),a=Gr.generation_at_resolution(r.seed,r.width,r.relief,r.motifSize,e),l=[];try{const c=a.parameters();r.procedural?.regionalN&&(c[2]=r.procedural.regionalN,c[4]=r.width*1.44/c[2]),c[6]*=r.procedural?.noiseScale??1;const p=(v,f)=>{const m=n.createBuffer({size:v.byteLength,usage:f|GPUBufferUsage.COPY_DST});return l.push(m),n.queue.writeBuffer(m,0,v),m},d=[p(c,GPUBufferUsage.UNIFORM),p(a.permutations(),GPUBufferUsage.STORAGE),p(a.gradients(),GPUBufferUsage.STORAGE)];i?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const S=await br(Promise.all(u));i?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const C=s.map(v=>v==="coarse"?c[2]:c[1]).map((v,f)=>{const m=v*v*16,g=n.createBuffer({size:m,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),B=n.createBuffer({size:m,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});l.push(g,B);const z=n.createBindGroup({layout:S[f].getBindGroupLayout(0),entries:[...d,g].map((E,b)=>({binding:b,resource:{buffer:E}}))}),k=n.createCommandEncoder(),O=k.beginComputePass();return O.setPipeline(S[f]),O.setBindGroup(0,z),O.dispatchWorkgroups(Math.ceil(v/8),Math.ceil(v/8)),O.end(),k.copyBufferToBuffer(g,0,B,0,m),n.queue.submit([k.finish()]),B}),y=n.queue.onSubmittedWorkDone().then(()=>i?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),P=await Promise.all(C.map(async v=>{await v.mapAsync(GPUMapMode.READ);const f=new Float32Array(v.getMappedRange().slice(0));return v.unmap(),f}));return await y,{coarse:s.length===2?P[0]:new Float32Array,fine:P[P.length-1]}}finally{a.free(),l.forEach(c=>c.destroy())}}class qt{constructor(r,i,n,e){this.state=r,this.pipeline=i,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=e.sampling_parameters(),this.sourceN=e.source_resolution();let o=0;for(let l=this.sourceN;l>=1;l=Math.floor(l/2))o+=l*l;const s=this.parameters[5]===3?2:1;if(o*s*4>r.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=e.sampling_field();this.hasField=u.length>0;const a=u.length?u:new Float32Array(1);if(a.byteLength>r.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(a),this.perm=this.upload(e.sampling_permutations()),this.gradients=this.upload(e.sampling_gradients()),this.branches=this.upload(e.sampling_branches()),this.coast=this.upload(e.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(r,i=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,r.byteLength),usage:i|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,r),n}prepareCoastField(r){return this.dispatchField({x:0,y:0,extent:r.width,resolution:this.sourceN},r),this.output}dispatchField(r,i){const{x:n,y:e,extent:o,resolution:s}=r;if(![n,e,o,s].every(Number.isFinite)||n<0||e<0||o<=0||n+o>i.width+1e-4||e+o>i.width+1e-4||!Number.isInteger(s)||s<16||s>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,a=o/s,l=Math.max(i.motifSize/65536,a*.5),c=this.parameters,p=Math.floor(Math.log2(this.sourceN)),d=Math.min(p,Math.log2(Math.max(1,a*(i.relief==="flat"&&c[5]!==4?2/i.motifSize:1/i.width)*this.sourceN))),S=new Float32Array([c[0],c[1],c[2],c[3],c[4],c[5],this.hasField?1:0,s,n,e,o,a,Math.floor(d),Math.min(p,Math.floor(d)+1),d-Math.floor(d),l,c[6],c[7],this.sourceN,p,...Array.from({length:16},(P,v)=>c[8+v]??0)]),w=s*s*16;w>this.capacity&&(this.output?.destroy(),this.capacity=w,this.output=u.createBuffer({size:w,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((P,v)=>({binding:v,resource:{buffer:P}}))})),u.queue.writeBuffer(this.uniform,0,S);const C=u.createCommandEncoder(),y=C.beginComputePass();y.setPipeline(this.pipeline),y.setBindGroup(0,this.group),y.dispatchWorkgroups(Math.ceil(s/8),Math.ceil(s/8)),y.end(),u.queue.submit([C.finish()])}async sample(r,i,n,e){const o=performance.now(),s=this.state.device,{x:u,y:a,extent:l,resolution:c}=r;this.dispatchField(r,i);const p=c*c*16,d=s.createCommandEncoder();(!this.readback||this.readback.size<p)&&(this.readback?.destroy(),this.readback=s.createBuffer({size:p,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),d.copyBufferToBuffer(this.output,0,this.readback,0,p),s.queue.submit([d.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,p);const S=this.readback.getMappedRange(0,p).slice(0);this.readback.unmap();const w=new Float32Array(S),C=new Float32Array(c*c),y=new Float32Array(c*c),P=new Float32Array(c*c),v=new Float32Array(c*c);let f=1/0,m=-1/0;for(let g=0;g<c*c;g++){const B=g*4;C[g]=w[B],y[g]=w[B+1],P[g]=w[B+2],v[g]=w[B+3],f=Math.min(f,C[g]),m=Math.max(m,C[g])}if(!Number.isFinite(f)||!Number.isFinite(m))throw new Error("Sortie GPU non finie.");return{x:u,y:a,width:l,resolution:c,minHeight:f,maxHeight:m,globalMinHeight:n,globalMaxHeight:e,motifSize:i.motifSize,height:C,normalX:y,normalY:P,normalZ:v,caveMask:new Uint8Array,generationMs:performance.now()-o,backend:this.mode,samplingMs:performance.now()-o}}dispose(){this.buffers.forEach(r=>r.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}var zi=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`,Ui=`// Inspector-only readout. It never modifies simulation heights or drainage.\r
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
`,Ci=`// Full FP32 regional erosion. Dispatches are global synchronization boundaries.\r
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
`;const mr=new WeakMap,qr=new WeakMap,Vr=new Set;function Rr(t){t.nodes?.destroy(),t.fine?.destroy(),t.control.destroy()}function Ai(){for(const t of Vr)mr.get(t)?.forEach(Rr),mr.delete(t),qr.delete(t);Vr.clear()}const Dt=new WeakMap,ot=new WeakMap,$t=new WeakMap,jt=new WeakMap,vn=new WeakSet,Ei=512*1048576,Wt=1024,Ri=1088,st=Ri+4096;function yn(t,r){const i=($t.get(t.device)??Promise.resolve()).then(r);return $t.set(t.device,i.then(()=>{},()=>{})),i}async function Ni(t,r,i,n){let e=Dt.get(t);e||(e=(async()=>{const l=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(w=>({binding:w,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(w=>({binding:w,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),c=t.createShaderModule({code:Ci.replace("// NOISE_KERNEL",bt).replace("// VOLCANIC_KERNEL",gn)+zi+Ui}),d=(await br(c.getCompilationInfo())).messages.filter(w=>w.type==="error");if(d.length)throw new Error(d.map(w=>`${w.lineNum}: ${w.message}`).join(`
`));const S=t.createPipelineLayout({bindGroupLayouts:[l]});return{layout:l,module:c,pipelineLayout:S,values:new Map,pending:new Map}})(),Dt.set(t,e)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const o=await br(e),s=[],u=[...r].reduce((l,c)=>l+(c==="solveTile"?i.size:1),0);let a=0;for(const l of r)for(const c of l==="solveTile"?i:[void 0]){const p=c===void 0?l:`solveTile:${c}`;let d=o.pending.get(p);d||(d=t.createComputePipelineAsync({layout:o.pipelineLayout,compute:{module:o.module,entryPoint:l,...c===void 0?{}:{constants:{SOLVE_MODE:c}}}}),d=d.then(S=>(o.values.set(p,S),S)),o.pending.set(p,d)),s.push(d.then(S=>(a++,n?.(`GPU · shaders d’érosion prêts ${a}/${u}`,{stage:"gpu-erosion-compile",completed:a,total:u}),S)))}return await br(Promise.all(s)),vn.add(t),o}class Nr extends Error{}class Bi extends Error{}function wn(t,r,i,n,e){const o=Gr.erosion_at_resolution(t.seed,t.width,i,t.erosion,t.motifSize,t.mountainMix,r);try{const s=o.parameters(),u=n?cn(s,t,e):{parameters:s,surface:(e??s.slice(24,32)).slice()};return un(u.parameters,u.surface,t,n,!!e),fn(u.surface,t,r),{noise:o,parameters:u.parameters,surface:u.surface,original:s}}catch(s){throw o.free(),s}}const Gi=["hills","mountains","mixed","high-mountains","valley","canyon"];function Ti(t,r){const i=er(r).n,n=Kr(r),e=Gi.includes(r.relief)?r.relief:r.relief==="flat"?"hills":"mixed",{noise:o,parameters:s,surface:u}=wn(r,i,e,n);o.free();const a=s[2],l=u[0],c=u[3],p=Hn(t.device.limits,i,Math.max(a,r.erosion>0&&(!n||c>0)?l:0));return{sourceN:i,regionalN:a,regionalSteps:s[13],surfaceN:l,surfaceSteps:c,pipelinesReady:vn.has(t.device),error:p}}async function Li(t,r,i,n,e){return yn(t,()=>Oi(t,r,i,n,e))}async function Oi(t,r,i,n,e){const o=er(r).n;for(const s of[1,2,4,8,16])try{return await xn(t,r,o,s,void 0,{source:i,tuning:n},void 0,e)}catch(u){if(!(u instanceof Nr)||s===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function Yt(t,r,i,n){return i?.control?.backend?.("gpu"),yn(t,()=>Fi(t,r,i,n))}async function Fi(t,r,i,n){const e=er(r).n;if(r.relief==="volcano"||r.relief==="caldera"||r.relief==="plateau"){const o=Gr.finite_shape(r.seed,r.motifSize,r.relief,r.erosion),s=o.parameters();o.free();const u=r.environment??"mixed",a=r.motifSize*s[15];let l;if(u==="flat"){const d=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),l=Ue.prepare_environment_at_resolution(r.seed,r.width,u,r.erosion,a,e),i&&(i.nativeEnvironmentMs=performance.now()-d)}else l=await lt(t,{...r,motifSize:a,relief:u,mountainMix:.5},e,void 0,i,n);const c=await lt(t,{...r,width:r.motifSize},e,s,i,n),p=new Float32Array(c.length+l.length);return p.set(c),p.set(l,c.length),p}return lt(t,r,e,void 0,i,n)}async function lt(t,r,i,n,e,o){for(const s of[1,2,4,8,16])try{return await xn(t,r,i,s,n,void 0,e,o)}catch(u){if(!(u instanceof Nr)||s===16)throw u}throw new Error("Érosion GPU non convergée.")}async function xn(t,r,i,n,e,o,s,u){const a=t.device,l=o?void 0:s?.control,c=Kr(r),p=!!r.generalSeed&&pt(r.generalSeed,m=>m.startsWith("relief-"))!==hn(r.generalSeed),{noise:d,parameters:S,surface:w,original:C}=wn(r,i,o||c&&r.relief==="flat"?"hills":e?"mixed":r.relief,c,o?.tuning);let y=ot.get(a);if(!y){y=[],ot.set(a,y);const m=y;a.lost.then(()=>m.forEach(g=>g.destroy()))}const P=!!l&&l.previews!==!1&&i<=Wt;let v=!!l&&l.previews!==!1,f=0;try{c&&r.procedural&&re(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural.erosionTuning?.detail===void 0&&(S[16]=C[16]);const m=S.slice(0,24),g=m[2],B=m[13],z=m[18],k=o?[1,0,0,.2,1,1,0,0]:Array.from(S.slice(33,41)),O=k.slice();O[4]=1;const E=!o&&k[6]>.5,b=Math.min(n,4),U=m.slice();U[2]=w[0],U[4]=w[1],U[5]=w[2],U[15]=e&&!o?e[13]:w[4],U[18]=w[5],U[22]=w[6];const F=Math.max(1,U[2]/1048),I=Math.ceil(Math.min((e||o||r.relief==="mixed"?64:32)*n,512)*F),G=!o&&re(r,"phasor",c)?"generationPhasorPack":"packHeight",H=c?"compactInitialize":"initialize",J=!!o||re(r,"surface",!c||r.relief==="canyon")&&(!c||r.relief==="canyon"||w[3]>0),ue=()=>{o||s?.onPhysicalPlan?.(r.erosion>0&&J&&w[3]>0?w[1]:void 0,!e&&r.erosion>0&&(re(r,"regional")||re(r,"regionalFinish"))?m[4]:void 0)},$=r.procedural?.reconstruction&&r.procedural.reconstruction!=="default"?"generationReconstruct":c?"compactReconstruct":"reconstruct",ye=new Set([G,...re(r,"amplitude")?[]:["generationUnitScale"],...re(r,"normalize")?[]:["generationKeepDatum"],...l?["generationPreview"]:[],...!o&&!e&&r.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),pe=new Set,ee=(...h)=>h.forEach(M=>ye.add(M));p&&!o&&!e&&ee("generationCut","generationRegionalRead","generationPreview"),(o||!e&&(p||r.procedural))&&ee("seaLandMark","seaMaskGrow");const we=()=>ee("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");o?ee("coastLoad","coastResult"):ee("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!o&&!e?(ee(H,"uplift","bounds",$,"detail"),z>0&&(we(),ee("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(h=>pe.add(h)))):e&&!o&&ee("volcanicInitial"),r.erosion>0&&J&&(we(),ee("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),pe.add(1),pe.add(3),r.relief==="canyon"&&!o&&(ee("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),pe.add(0)),E&&(ee("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),pe.add(0))),l&&await l.before("grids",`Budget ×${n} · régional ${g}² · surface ${U[2]}² · sortie ${i}²`);const Fe=performance.now(),be=await Ni(a,ye,pe,u),Ie=performance.now()-Fe,ke=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let Se=!1;const he=(h,M)=>{const N=f++;let T=y[N];return(!T||T.size<h||T.usage!==M)&&(T?.destroy(),T=a.createBuffer({size:h,usage:M}),y[N]=T,Se=!0),T},ae=h=>{const M=he(h.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return a.queue.writeBuffer(M,0,h),M},Ce=r.erosion>0&&J?Math.max(g,U[2]):g,se=i**2,me=se*4,Ae=se*16,Be=Math.max(se,g*g)*4;a.pushErrorScope("out-of-memory");const Ee=he(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),Ke=he(Ce**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),We=he(Ae,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Re=he(st,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ge=he(Be,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),le=he(Be+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),ir=he(Math.ceil(Ce/16)**2*8,GPUBufferUsage.STORAGE),_e=a.popErrorScope();if(Se&&await _e)throw v=!0,new Bi(`WebGPU : mémoire insuffisante pour la source ${i}² et la grille d’érosion ${Ce}².`);v||=y.reduce((h,M)=>h+M.size,0)>Ei;const _=h=>le.mapAsync(GPUMapMode.READ,0,h),x=h=>le.getMappedRange(0,h),R=!o&&!e&&!!(r.procedural||p),X=R&&i<=Wt,K=P||R;let Q=K?void 0:jt.get(a);if(!K&&!Q&&a.features.has("timestamp-query")){Q=a.createQuerySet({type:"timestamp",count:6}),jt.set(a,Q);const h=Q;a.lost.then(()=>h.destroy())}const A=Q?he(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,L=Q?he(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,fe=(h,M)=>a.createBindGroup({layout:be.layout,entries:[{binding:0,resource:{buffer:Ee,size:224}},...[ae(h),ae(M),Ke,We,Re,Ge,ir].map((N,T)=>({binding:T+1,resource:{buffer:N}}))]});let D=fe(d.permutations(),d.gradients());const ne=new Map([[r.seed,D]]),ie=h=>{const M={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[h];if(!M||!r.generalSeed)return;const N=Je(r.generalSeed,M);let T=ne.get(N);if(!T){const ce=Gr.erosion(N,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix);try{T=fe(ce.permutations(),ce.gradients())}finally{ce.free()}ne.set(N,T)}D=T},oe=new Map;let Pe=k;const ge=(h,M)=>{const N=[...M,...h,...Pe].join(",");let T=oe.get(N);if(T===void 0){if(T=oe.size*256,T+224>65536)throw new Error("Too many GPU variants.");oe.set(N,T),a.queue.writeBuffer(Ee,T,new Float32Array([...M,...h,...c?Rt(r,!!o):!e&&!o&&re(r,"phasor",!1)?Rt(r):e??new Float32Array(16),...Pe]))}return T};let V=a.createCommandEncoder();V.clearBuffer(Re),o&&V.copyBufferToBuffer(o.source,0,We,0,Ae);const ve=h=>V.beginComputePass(Q?{timestampWrites:{querySet:Q,beginningOfPassWriteIndex:h,endOfPassWriteIndex:h+1}}:void 0);let j=ve(0);const te=[0,0,1,0,0,0,.6,0];te[4]=S[32];const ar=[0,0,.95,z*.5,0,0,.5,0];let Te=m;const W=(h,M=te,N=Math.ceil(Te[2]**2/256),T=1)=>{j.setPipeline(be.values.get(h==="solveTile"?`solveTile:${M[1]}`:h)),j.setBindGroup(0,D,[ge(M,Te)]),j.dispatchWorkgroups(N,T)},Mt=Math.ceil(se/256),Pt=Math.ceil(Mt/a.limits.maxComputeWorkgroupsPerDimension),ze=(h,M=te)=>W(h,M,Math.ceil(Mt/Pt),Pt),Xe=(h,M,N=!1)=>{const T=te.slice();T[1]=h,T[7]=N?1:0,W(h===0?"floodInit":"graphInit",T),W("start",T,1);const ce=[0,1].map(xe=>(T[0]=xe,ge(T,Te)));for(let xe=0;xe<M;xe++){const or=[ce[xe&1]];j.setPipeline(be.values.get("clearNext")),j.setBindGroup(0,D,or),j.dispatchWorkgroups(1),j.setPipeline(be.values.get(`solveTile:${h}`)),j.dispatchWorkgroups(Math.ceil(Te[2]/16),Math.ceil(Te[2]/16))}T[0]=0,W("solveStats",T,1),h===0?(W("floodCheck",T,1),W("receivers")):W("graphFinish",T)},Xr=(h=te,M=!0)=>{W("pitInit");for(let N=0;N<8*b+Math.ceil(Math.log2(Math.max(1,Te[2]/1048)));N++)W("pitUnion"),W("pitCompress");for(const N of M?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])W(N,h)},Zr=h=>{if(h<=0)return;const M=te.slice();M[6]=h,W("breachInit"),W("breach",M),W("breachFinish")},Qr=(h,M=te)=>{if(!(Te===m&&r.procedural?.regionalThermal===!1))for(let N=0;N<h;N++)for(const T of["thermalFlux","thermalApply","copyHeight"])W(T,M)},Tr=(h,M=te)=>{if(Te===m&&r.procedural?.regionalDiffusion===!1)return;const N=M.slice();N[3]=h,W("diffuse",N),W("copyHeight",N)},zt=h=>{const M=qn(Dn({surfaceSteps:w[3],surfaceCell:w[1],regionalCell:m[4],sourceCell:m[11],warp:k[5]*Math.min(16*m[3],m[4]*.9)}),r.width);if(M===void 0)return;const N=te.slice();N[7]=h,h===0?W("seaLandMark",N):ze("seaLandMark",N),N[5]=M,W("seaMaskGrow",N,2)},Ut=h=>{const M=te.slice();M[4]=h,W("percentileInit",M,1);for(const N of[24,16,8,0])M[5]=N,W("histogramClear",M,1),ze("histogram",M),W("percentileSelect",M,1)},Ct=async(h,M,N)=>{if(!l)return;if(!P){await l.after(h,void 0,N);return}if(M!==3){const or=te.slice();or[7]=M,ze("generationPreview",or)}j.end(),V.copyBufferToBuffer(Ge,0,le,0,me),V.copyBufferToBuffer(Re,0,le,me,1088),a.queue.submit([V.finish()]),await _(me+1088);const T=x(me+1088),ce=new Uint32Array(T,me,272)[2],xe=new Float32Array(T,0,se).slice();if(le.unmap(),ce)throw new Nr("Érosion GPU non convergée pendant une étape.");if(!xe.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await l.after(h,xe,N),V=a.createCommandEncoder(),j=ve(0)},ur=wt(r),zn=Wr(r);let Le=X?mr.get(a):void 0;if(X&&!Le){Le=new Map,mr.set(a,Le),Vr.add(a);const h=Le;a.lost.then(()=>{h.forEach(Rr),h.clear(),Vr.delete(a)})}const kr=h=>`${n}|${zn.get(h)}`;let rr=0;for(;Le&&rr<ur.length&&Le.get(ur[rr])?.key===kr(ur[rr]);)rr++;if(Le)for(const h of[...ur.slice(rr),"phasor"]){const M=Le.get(h);M&&(h!=="phasor"||M.key!==kr(h)||rr<ur.length)&&(Rr(M),Le.delete(h))}const Un=h=>{j.end(),h.nodes&&V.copyBufferToBuffer(h.nodes,0,Ke,0,h.nodes.size),h.fine&&V.copyBufferToBuffer(h.fine,0,We,0,h.fine.size),V.copyBufferToBuffer(h.control,0,Re,0,st),j=ve(0)},Cn=(h,M)=>{if(!Le)return;j.end();const N=(ce,xe=ce.size)=>{const or=a.createBuffer({size:xe,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return V.copyBufferToBuffer(ce,0,or,0,xe),or},T=Le.get(h);T&&Rr(T),Le.set(h,{key:kr(h),kind:M,...M===0?{nodes:N(Ke,g*g*112)}:{fine:N(We,Ae)},control:N(Re,st)}),a.queue.submit([V.finish()]),V=a.createCommandEncoder(),j=ve(0)},An=async(h,M)=>{if(!l)return;if(!P){l.cached?await l.cached(h):(await l.before(h),await l.after(h));return}const N=te.slice();N[7]=M.kind,ze("generationPreview",N),j.end(),V.copyBufferToBuffer(Ge,0,le,0,me),a.queue.submit([V.finish()]),await _(me);const T=new Float32Array(x(me),0,se).slice();le.unmap(),l.cached?await l.cached(h,T):(await l.before(h),await l.after(h,T)),V=a.createCommandEncoder(),j=ve(0)},Ze=async(h,M,N)=>{const T=ur.indexOf(h),ce=Le?.get(h);if(ce&&T>=0&&T<rr){(P||T===rr-1)&&Un(ce),await An(h,ce);return}await l?.before(h),ie(h),await N(),Cn(h,M),await Ct(h,M)},En=r.procedural?.coastAfter??"initialize",fr=async(h,M)=>{!R||h!==En||await Ze("coastCut",M===4?5:M,async()=>{if(!ft(r,"coastCut"))return;const N=te.slice();N[7]=M,M===0?W("generationRegionalRead",N,Math.ceil(g*g/256)):ze("generationPreview",N),j.end();const T=M===0?g*g:se;V.copyBufferToBuffer(Ge,0,le,0,T*4),a.queue.submit([V.finish()]),await _(T*4);const ce=new Float32Array(x(T*4),0,T).slice();le.unmap();const xe=dn.cut_field(Je(r.generalSeed??r.seed,"relief-coast-cut"),r.width,S[3]*2400,S[12],r.coastMask,r.islandMode??"island",M===0?g:i,M===0?m[5]:0,M===0?m[4]:m[11],ce);a.queue.writeBuffer(Ge,0,xe),V=a.createCommandEncoder(),j=ve(0),M===0?W("generationCut",N,Math.ceil(g*g/256)):ze("generationCut",N),zt(M)})};l&&await l.after("grids",void 0,`Budget ×${n} · régional ${g}² · surface ${U[2]}² · ${(y.reduce((h,M)=>h+M.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${B} cycles de relief et ${w[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),o?(Te=U,ze("coastLoad"),zt(2)):e?(l&&await l.before("initialize"),Te=U,ze("volcanicInitial"),l&&await Ct("initialize",2)):(await Ze("initialize",0,()=>{W(H)}),await fr("initialize",0),await Ze("regional",0,()=>{for(let h=0;h<(re(r,"regional")?B:0);h++){if(W("uplift"),z>0){Xe(0,64*b),Xr(),Zr(k[1]),W("flow"),Xe(1,128*b),Xe(2,128*b),Qr(3);const M=m[17]*3*z;for(let N=0;N<Math.floor(M);N++)Tr(.5);M%1>0&&Tr(.5*(M%1))}W("bounds")}}),await Ze("regionalFinish",0,()=>{const h=te.slice();if(h[7]=1,W("bounds",h),z>0&&re(r,"regionalFinish")){Qr(4,ar);for(let M=0;M<2;M++)Xe(0,64*b),Xr(ar),Zr(k[2]);Tr(z*.5,ar)}}),await fr("regionalFinish",0),await Ze("reconstruct",1,()=>{const h=te.slice();h[7]=r.procedural?.reconstruction==="bspline"?1:0,ze($,h)}),await Ze("amplitude",4,()=>{re(r,"amplitude")?Ut(0):W("generationUnitScale",te,1)}),await fr("amplitude",4),await Ze("ridged",2,()=>{ze("detail")}),await fr("ridged",2)),j.end(),j=ve(2),await Ze("surface",2,()=>{if(r.erosion>0&&J){if(Te=U,Pe=O,W("surfaceLoad"),r.relief==="canyon"&&!o){const h=Math.ceil(128*b*F);Xe(0,h),W("flow"),Xe(1,h),W("canyonSeed");let M=0;const N=[];for(let ce=2**(Math.ceil(Math.log2(U[2]))-1);ce>=1;ce/=2)N.push(ce);N.push(1,1);for(const ce of N){const xe=te.slice();xe[0]=M,xe[1]=ce,W("canyonSpread",xe),M=1-M}const T=te.slice();T[0]=M,W("canyonApply",T)}for(let h=0;h<w[3];h++)E?(Xe(0,I),Xr(te,!1),Zr(k[7])):(W("surfaceFlowInit"),W("receivers")),W("flow"),Xe(1,I,!0),Xe(3,I,!0),Qr(1),Tr(w[7]);W("surfaceDelta"),ze("surfaceReconstruct")}}),await fr("surface",2),j.end(),j=ve(4),await Ze("normalize",1,()=>{o?ze("coastResult"):re(r,"normalize")?(Ut(1),ze("normalize")):ze("generationKeepDatum")}),await fr("normalize",1);let Sr=qr.get(a);Sr||(Sr=new yt,qr.set(a,Sr));const _r=X?Sr.get("phasor",kr("phasor")):void 0;if(_r)return j.end(),a.queue.submit([V.finish()]),l?.cached?await l.cached("phasor",P?_r:void 0):(await l?.before("phasor"),await l?.after("phasor",_r)),ue(),_r;_r||await l?.before("phasor"),ze(G),j.end();const Mr=me;V.copyBufferToBuffer(Ge,0,le,0,Mr),V.copyBufferToBuffer(Re,0,le,Mr,1088),Q&&A&&L&&(V.resolveQuerySet(Q,0,6,A,0),V.copyBufferToBuffer(A,0,L,0,48));const Rn=V.finish(),Nn=performance.now()-ke;u?.(o?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const Bn=performance.now();a.queue.submit([Rn]);const Gn=a.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([_(Mr+1088),L?.mapAsync(GPUMapMode.READ),Gn]);const Tn=performance.now()-Bn,Ln=performance.now(),At=x(Mr+1088),et=new Uint32Array(At,Mr,272),On=Array.from(et.slice(267,271)),rt={factor:n,sourceSize:i,coarseSize:g,surfaceSize:U[2],pipelineMs:Ie,encodeMs:Nn,submitReadbackMs:Tn,unpackMs:0,maxSolveSteps:On,allocatedBytes:y.reduce((h,M)=>h+M.size,0)};if(L){const h=new BigUint64Array(L.getMappedRange());rt.gpuStagesMs={coarse:Number(h[1]-h[0])/1e6,surface:Number(h[3]-h[2])/1e6,normalization:Number(h[5]-h[4])/1e6},L.unmap()}if(s&&(s.profiles??=[]).push(rt),et[2]!==0)throw le.unmap(),new Nr(`Érosion GPU non convergée (${et[2]} cellules/étapes, budget ×${n}).`);const Pr=new Float32Array(At,0,se).slice();le.unmap(),rt.unpackMs=performance.now()-Ln;const Fn=o||R&&ft(r,"coastCut")?-1/0:.3-1e-7;for(let h=0;h<se;h++)if(!Number.isFinite(Pr[h])||Pr[h]<Fn)throw new Error("Champ GPU invalide.");return ue(),X&&Sr.put("phasor",kr("phasor"),Pr),l&&await l.after("phasor",P?Pr:void 0,"Sortie GPU lue et validée"),Pr}catch(m){throw m instanceof Nr&&(mr.get(a)?.forEach(Rr),mr.get(a)?.clear(),qr.delete(a)),m}finally{d.free(),y.forEach(m=>{m.mapState!=="unmapped"&&m.unmap(),v&&m.destroy()}),v&&ot.delete(a)}}var Ii=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`;const Hi=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],Vt=new WeakMap,Jt=new WeakMap;function qi(t){let r=Vt.get(t);return r||(r=(async()=>{const i=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(a=>({binding:a,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(a=>({binding:a,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=t.createShaderModule({code:Ii}),o=(await n.getCompilationInfo()).messages.filter(a=>a.type==="error");if(o.length)throw new Error(`Hydrologie WGSL : ${o.map(a=>`${a.lineNum}: ${a.message}`).join(`
`)}`);const s=t.createPipelineLayout({bindGroupLayouts:[i]}),u=await Promise.all(Hi.map(async a=>[a,await t.createComputePipelineAsync({layout:s,compute:{module:n,entryPoint:a}})]));return{layout:i,values:new Map(u)}})(),Vt.set(t,r)),r}function Di(t){let r=2166136261;for(let i=0;i<t.length;i++)r=Math.imul(r^t.charCodeAt(i),16777619);return r>>>0}function $i(t,r,i){const n=new Uint32Array(t.length);if(!i)return{mask:n,count:0};const e=new Uint8Array(t.length),o=new Uint32Array(t.length);let s=0,u=0,a=0;const l=p=>{e[p]===0&&t[p]<=0&&(e[p]=1,o[u++]=p)},c=p=>{if(e[p]!==0||t[p]>0)return;s=0,u=0,l(p);let d=!1;for(;s<u;){const S=o[s++],w=S%r,C=Math.floor(S/r);d||=w+1<r&&C+1<r&&t[S+1]<=0&&t[S+r]<=0&&t[S+r+1]<=0;for(let y=-1;y<=1;y++){const P=C+y;if(!(P<0||P>=r))for(let v=-1;v<=1;v++){const f=w+v;f>=0&&f<r&&l(P*r+f)}}}if(d){for(let S=0;S<u;S++)n[o[S]]=1;a+=u}};for(let p=0;p<r;p++)c(p),c((r-1)*r+p);for(let p=1;p+1<r;p++)c(p*r),c(p*r+r-1);return{mask:n,count:a}}class ji{constructor(r,i,n){this.device=r,this.n=i,this.program=n,this.buffers=[],this.pending=Promise.resolve();const e=i*i,o=(u,a)=>{const l=r.createBuffer({size:u,usage:a});return this.buffers.push(l),l};this.uniform=o(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=o(e*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=o(e*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const s=o(e*48,GPUBufferUsage.STORAGE);this.control=o(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=o(e*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=o(e*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=o(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=r.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,s,this.control,this.output].map((u,a)=>({binding:a+1,resource:{buffer:u}}))]}),r.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(r,i,n,e){const o=this.pending.then(()=>this.execute(r,i,n,e));return this.pending=o.then(()=>{},()=>{}),o}async execute(r,i,n,e){const o=performance.now(),s=this.n,u=s*s,a=i/s,l=$i(r,s,e),c=performance.now()-o,p=this.device;p.queue.writeBuffer(this.source,0,r),p.queue.writeBuffer(this.sea,0,l.mask);for(let G=0;G<2;G++){const H=new ArrayBuffer(32);new Uint32Array(H,0,4).set([s,Di(n),G,e?1:0]),new Float32Array(H,16,4).set([a,a*a,Math.max(.1,a*.1),0]),p.queue.writeBuffer(this.uniform,G*256,H)}const d=(G,H,J=0)=>{G.setPipeline(this.program.values.get(H)),G.setBindGroup(0,this.group,[J*256]),H==="solveTile"?G.dispatchWorkgroups(Math.ceil(s/16),Math.ceil(s/16)):G.dispatchWorkgroups(H==="reset"||H==="clearNext"?1:Math.ceil(u/256))},S=performance.now(),w=p.createCommandEncoder(),C=w.beginComputePass();d(C,"reset"),d(C,"initialize"),C.end(),p.queue.submit([w.finish()]);let y=0,P=!1,v=32;const f=Math.max(256,s);for(;y<f;){const G=p.createCommandEncoder(),H=G.beginComputePass();for(let ue=0;ue<v;ue++){const $=y+ue&1;d(H,"clearNext",$),d(H,"solveTile",$)}H.end(),G.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),p.queue.submit([G.finish()]),y+=v,v=Math.min(v*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const J=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),J===0){P=!0;break}}if(!P)throw new Error(`Drainage hydrique GPU non convergé après ${y} passes (${s}²) ; repli CPU requis.`);const m=p.createCommandEncoder(),g=m.beginComputePass();d(g,"receivers");const B=Math.ceil(Math.log2(u));for(let G=0;G<B;G++){const H=G&1;d(g,"accumulateCopy",H),d(g,"accumulateScatter",H)}d(g,"finish",B&1),g.end();const z=u*16;m.copyBufferToBuffer(this.output,0,this.readback,0,z),m.copyBufferToBuffer(this.control,0,this.readback,z,16),p.queue.submit([m.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const k=performance.now()-S,O=performance.now();let E,b,U,F;try{const G=this.readback.getMappedRange(),H=new Uint32Array(G,z,4);if(H[2]!==0||H[3]!==u-l.count)throw new Error(`Drainage hydrique GPU invalide (${H[2]} erreurs, ${H[3]}/${u-l.count} cellules drainées) ; repli CPU requis.`);const J=new Float32Array(G,0,u*4),ue=new Uint32Array(G,0,u*4);E=new Float32Array(u),b=new Uint32Array(u),U=new Float32Array(u),F=new Float32Array(u);for(let $=0;$<u;$++)E[$]=J[$*4],b[$]=ue[$*4+1],U[$]=J[$*4+2],F[$]=J[$*4+3]}finally{this.readback.unmap()}const I=new Uint8Array(l.mask);return{filled:E,receivers:b,accumulation:U,potential:F,seaMask:I,preprocessingMs:c,computeMs:k,readbackMs:performance.now()-O,floodPasses:y}}}async function Wi(t,r,i,n,e=!1){if(![256,512,1024].includes(i)||t.length!==i*i||!Number.isFinite(r)||r<=0||!t.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const o=await kt();if(!o||o.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const s=await qi(o.device);if(o.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=Jt.get(o.device);u||(u=new Map,Jt.set(o.device,u));let a=u.get(i);return a||(a=new ji(o.device,i,s),u.set(i,a)),a.run(t,r,n,e)}const Kt=new WeakMap;function Yi(t){const r=Kt.get(t);if(r)return r;const i=new Float32Array(t.baseHeight.length),n=[],e=v=>t.drainageHeight[v]<t.rawDrainageHeight[v]&&t.surfaceHeight[v]<t.baseHeight[v];let o=!1;for(let v=0;v<i.length;v++){const f=e(v);f&&n.push(v),i[v]=f?0:t.surfaceHeight[v]-t.baseHeight[v],o||=i[v]!==0}const s=256,u=t.width/s,a=new Map,l=[],c=t.riverPoints,p=new Map,d=[],S=t.resolution,w=t.width/S,C=v=>Math.min(w*2,Math.max(w*.5,(t.baseHeight[v]-t.surfaceHeight[v])*1.4)),y=v=>((Math.imul(v^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const v of n){const f=v%S,m=Math.floor(v/S),g=(f+.5)*w,B=(m+.5)*w,z=[];for(let k=-1;k<=1;k++)for(let O=-1;O<=1;O++){const E=f+O,b=m+k,U=b*S+E;if(!O&&!k||E<0||b<0||E>=S||b>=S)continue;const F=e(U);(F&&U>v||!F&&t.basins[U]&&t.surfaceHeight[U]<=t.surfaceHeight[v])&&z.push(U)}z.length||z.push(v);for(const k of z){const O=(k%S+.5)*w,E=(Math.floor(k/S)+.5)*w,b=d.length,U=C(v),F=C(k),I=y(v),G=Math.max(U,F)*(1+Math.abs(I));d.push({a:v,b:k,ra:U,rb:F,skew:I});const H=Me(Math.min(g,O)-G,u,s),J=Me(Math.max(g,O)+G,u,s),ue=Me(Math.min(B,E)-G,u,s),$=Me(Math.max(B,E)+G,u,s);for(let ye=ue;ye<=$;ye++)for(let pe=H;pe<=J;pe++){const ee=ye*s+pe,we=p.get(ee);we?we.push(b):p.set(ee,[b])}}}if(t.incision>0)for(let v=0;v<t.riverCount;v++)for(let f=t.riverOffsets[v];f+1<t.riverOffsets[v+1];f++){const m=f+1,g=Math.max(c[f*4+2],c[m*4+2])*.65+.5,B=l.length;l.push({a:f,b:m,estuary:t.riverMeta[v*6+5]});const z=Me(Math.min(c[f*4],c[m*4])-g,u,s),k=Me(Math.max(c[f*4],c[m*4])+g,u,s),O=Me(Math.min(c[f*4+1],c[m*4+1])-g,u,s),E=Me(Math.max(c[f*4+1],c[m*4+1])+g,u,s);for(let b=O;b<=E;b++)for(let U=z;U<=k;U++){const F=b*s+U,I=a.get(F);I?I.push(B):a.set(F,[B])}}const P={delta:i,hasDelta:o,hasSea:t.basins.includes(0),buckets:a,segments:l,bucketSize:u,side:s,notchBuckets:p,notches:d};return Kt.set(t,P),P}const Me=(t,r,i)=>Math.max(0,Math.min(i-1,Math.floor(t/r)));function Xt(t,r,i,n,e){const o=new Int32Array(i*4),s=new Float64Array(i*4);for(let u=0;u<i;u++){const a=Math.max(0,Math.min(e-1,(t+(u+.5)*r)/n-.5)),l=Math.floor(a),c=a-l,p=1-c;for(let d=0;d<4;d++)o[u*4+d]=Math.max(0,Math.min(e-1,l+d-1));s.set([p**3/6,(3*c**3-6*c*c+4)/6,(-3*c**3+3*c*c+3*c+1)/6,c**3/6],u*4)}return{indices:o,weights:s}}function bn(t,r,i=!0){const n=t.resolution,e=t.width/n,o=Yi(r);if(!o.hasDelta&&!o.segments.length&&!o.notches.length)return;const s=i?new Float32Array(n*n):void 0;if(o.hasDelta){const f=r.resolution,m=r.width/f,g=Xt(t.x,e,n,m,f),B=Xt(t.y,e,n,m,f),z=B.indices[0],k=B.indices[B.indices.length-1],O=new Float64Array((k-z+1)*n);for(let E=z;E<=k;E++){const b=E*f,U=(E-z)*n;for(let F=0;F<n;F++){const I=F*4;O[U+F]=o.delta[b+g.indices[I]]*g.weights[I]+o.delta[b+g.indices[I+1]]*g.weights[I+1]+o.delta[b+g.indices[I+2]]*g.weights[I+2]+o.delta[b+g.indices[I+3]]*g.weights[I+3]}}for(let E=0;E<n;E++)for(let b=0;b<n;b++){const U=E*4;let F=O[(B.indices[U]-z)*n+b]*B.weights[U]+O[(B.indices[U+1]-z)*n+b]*B.weights[U+1]+O[(B.indices[U+2]-z)*n+b]*B.weights[U+2]+O[(B.indices[U+3]-z)*n+b]*B.weights[U+3];if(F>0&&o.hasSea&&t.height[E*n+b]<=0){const I=Math.max(0,Math.min(f-1,Math.floor((t.x+(b+.5)*e)/m))),G=Math.max(0,Math.min(f-1,Math.floor((t.y+(E+.5)*e)/m))),H=G*f+I;(!r.basins[H]||r.baseHeight[H]>=0)&&(F=0)}s&&(s[E*n+b]=F),t.height[E*n+b]+=F}}const u=new Set,{bucketSize:a,side:l}=o;for(let f=Me(t.y,a,l);f<=Me(t.y+t.width,a,l);f++)for(let m=Me(t.x,a,l);m<=Me(t.x+t.width,a,l);m++)for(const g of o.buckets.get(f*l+m)??[])u.add(g);const c=new Float32Array(n*n),p=r.riverPoints,d=(f,m)=>Math.max(0,Math.min(n-1,Math.floor((f-m)/e))),S=new Set;for(let f=Me(t.y,a,l);f<=Me(t.y+t.width,a,l);f++)for(let m=Me(t.x,a,l);m<=Me(t.x+t.width,a,l);m++)for(const g of o.notchBuckets.get(f*l+m)??[])S.add(g);const w=r.resolution,C=r.width/w,y=C*.25;for(const f of S){const{a:m,b:g,ra:B,rb:z,skew:k}=o.notches[f],O=Math.max(B,z)*(1+Math.abs(k)),E=(m%w+.5)*C,b=(Math.floor(m/w)+.5)*C,U=(g%w+.5)*C,F=(Math.floor(g/w)+.5)*C,I=U-E,G=F-b,H=I*I+G*G,J=Math.min(E,U)-O,ue=Math.max(E,U)+O,$=Math.min(b,F)-O,ye=Math.max(b,F)+O;if(ue<t.x||J>t.x+t.width||ye<t.y||$>t.y+t.width)continue;const pe=Math.abs(G)>1e-12,ee=pe?O*Math.sqrt(H)/Math.abs(G):0;for(let we=d($,t.y);we<=d(ye,t.y);we++){const Fe=t.y+(we+.5)*e,be=pe?E+I*(Fe-b)/G:0,Ie=pe?Math.max(J,be-ee):J,ke=pe?Math.min(ue,be+ee):ue;if(!(Ie>ke||ke<t.x||Ie>t.x+t.width))for(let Se=d(Ie,t.x);Se<=d(ke,t.x);Se++){const he=t.x+(Se+.5)*e,ae=H?Math.max(0,Math.min(1,((he-E)*I+(Fe-b)*G)/H)):0,Ce=Math.hypot(he-E-I*ae,Fe-b-G*ae),se=y+(B+(z-B)*ae-y)*(1+k*Math.sign((he-E)*G-(Fe-b)*I));if(Ce>=se)continue;const me=Math.max(0,(Ce-y)/(se-y)),Ae=1-me*me*(3-2*me),Be=r.surfaceHeight[m]+(r.surfaceHeight[g]-r.surfaceHeight[m])*ae,Ee=we*n+Se;c[Ee]=Math.max(c[Ee],Math.max(0,t.height[Ee]-Be)*Ae)}}}for(const f of u){const{a:m,b:g,estuary:B}=o.segments[f],z=p[m*4],k=p[m*4+1],O=p[g*4],E=p[g*4+1],b=p[m*4+2],U=p[g*4+2],F=p[m*4+3],I=p[g*4+3],G=Math.max(Math.max(b,U)*.65,.5),H=O-z,J=E-k,ue=H*H+J*J,$=Math.min(z,O)-G,ye=Math.max(z,O)+G,pe=Math.min(k,E)-G,ee=Math.max(k,E)+G;if(ye<t.x||$>t.x+t.width||ee<t.y||pe>t.y+t.width)continue;const we=d(pe,t.y),Fe=d(ee,t.y),be=Math.abs(J)>1e-12,Ie=be?G*Math.hypot(H,J)/Math.abs(J):0;for(let ke=we;ke<=Fe;ke++){const Se=t.y+(ke+.5)*e,he=be?z+H*(Se-k)/J:0,ae=be?Math.max($,he-Ie):$,Ce=be?Math.min(ye,he+Ie):ye;if(ae>Ce||Ce<t.x||ae>t.x+t.width)continue;const se=d(ae,t.x),me=d(Ce,t.x);for(let Ae=se;Ae<=me;Ae++){const Be=t.x+(Ae+.5)*e,Ee=Math.max(0,Math.min(1,((Be-z)*H+(Se-k)*J)/Math.max(ue,.001))),Ke=b+(U-b)*Ee,We=F+(I-F)*Ee,Re=Math.hypot(Be-z-H*Ee,Se-k-J*Ee),Ge=Math.max(0,1-Re/Math.max(Ke*.65,.5))**2;if(!Ge)continue;const le=Math.max(.35,Math.min(12,Ke*.11))*r.incision,ir=ke*n+Ae,_e=Math.max(0,Math.min(le*2+.75,t.height[ir]-(We-le)))*Ge*(B>1&&We<le?1.15:1);c[ir]=Math.max(c[ir],_e)}}}let P=1/0,v=-1/0;for(let f=0;f<n*n;f++)t.height[f]-=c[f],s&&(s[f]-=c[f]),P=Math.min(P,t.height[f]),v=Math.max(v,t.height[f]);if(s)for(let f=0;f<n;f++)for(let m=0;m<n;m++){const g=f*n+m,B=Math.max(0,m-1),z=Math.min(n-1,m+1),k=Math.max(0,f-1),O=Math.min(n-1,f+1),E=s[f*n+z]-s[f*n+B],b=s[O*n+m]-s[k*n+m];if(E===0&&b===0)continue;const U=Math.max(1e-6,t.normalZ[g]),F=-t.normalX[g]/U+E/((z-B)*e||e),I=-t.normalY[g]/U+b/((O-k)*e||e),G=Math.hypot(F,I,1);t.normalX[g]=-F/G,t.normalY[g]=-I/G,t.normalZ[g]=1/G}t.minHeight=P,t.maxHeight=v}const ct=new Float32Array(0);function Zt(t,r){const i={...t,normalX:ct,normalY:ct,normalZ:ct};bn(i,r,!1),t.minHeight=i.minHeight,t.maxHeight=i.maxHeight}const Vi=(t,r)=>t.riverArea>0?t.riverArea:Math.max(.02,.003*(r/1e3)**2);class St{constructor(r,i,n,e,o,s){this.engine=r,this.baseHeight=i,this.backend=n,this.backendReason=e,this.drainageMs=o,this.gpu=s}static async create(r,i,n,e,o,s){const u=performance.now();let a,l,c;if(o!=="cpu")try{const d=await Wi(e,i,n,r,s);a=Nt.with_drainage(r,i,n,e,s,d.filled,d.receivers,d.accumulation),c=d}catch(d){l=`GPU hydrology unavailable: ${d instanceof Error?d.message:String(d)}`}const p=a?"gpu-f32":"cpu";return a??=new Nt(r,i,n,e,s),new St(a,e,p,l,performance.now()-u,c)}generate(r,i){const n=performance.now(),e=this.engine.generate(r.main,r.density,r.wetness,r.lakes,r.meanders,r.meanderIntensity,r.estuary,r.widthScale,r.incision,r.minLakeArea,r.lakeAbundance,r.lakeCoverage,r.maxLakeArea,r.depressionPolicy,r.maxBreachDepth,r.maxBreachLength,r.minLakeDepth,i.temperature,i.precipitation,r.coastalStreams);try{const o=e.stage_ms,s=e.stage_labels?Object.fromEntries(e.stage_labels.split(",").map((y,P)=>[y,o[P]])):void 0,u=e.basins;let a=0,l=0;for(const y of u)a=Math.max(a,y),y&&l++;const c=e.river_offsets,p=e.lake_meta,d=e.lake_closed;let S=0;for(let y=2;y<p.length;y+=6)S+=p[y];const w=e.river_meta;let C=!1;for(let y=4;y<w.length;y+=6)C||=(w[y]&2)!==0;return{width:e.width,resolution:e.resolution,receivers:e.receivers,accumulation:e.accumulation,basins:u,rawReceivers:e.raw_receivers??e.receivers,rawAccumulation:e.raw_accumulation??e.accumulation,rawBasins:e.raw_basins??u,flatLabels:e.flat_labels??new Uint32Array(u.length),flatRank:e.flat_rank??new Uint32Array(u.length),externalInflowArea:e.external_inflow_area??0,rawFilled:e.raw_filled??e.filled,rawDrainageHeight:e.raw_drainage_height??e.drainage_height,breachCount:e.breach_count??0,breachCutVolumeM3:e.breach_cut_volume_m3??0,avoidedFillVolumeM3:e.avoided_fill_volume_m3??0,filled:e.filled,lakeDepth:e.lake_depth,lakeLabels:e.lake_labels,baseHeight:this.baseHeight,drainageHeight:e.drainage_height,surfaceHeight:e.surface_height,adjustedHeight:e.adjusted_height,riverPoints:e.river_points,riverOffsets:c,riverMeta:w,riverFlare:e.river_flare,lakePoints:e.lake_points,lakeOffsets:e.lake_offsets,lakeMeta:p,lakeRingMeta:e.lake_ring_meta,lakeClosed:d,waterField:e.water_field,closedLakeCount:d.reduce((y,P)=>y+P,0),nodePoints:e.node_points,nodeMeta:e.node_meta,riverCount:c.length-1,lakeCount:p.length/6,basinCount:a,lakeFraction:S/Math.max(1,l*(e.width/e.resolution)**2),incision:r.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&r.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(r.main)&&!C?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-n,stageMs:s,generationMs:this.drainageMs+performance.now()-n,routingPotential:r.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{e.free()}}dispose(){this.engine.free()}}const Ji="magna-urbis-neural-models-v1",gt=["coarse","base","decoder"];class je extends Error{constructor(r,i,n){super(i,n),this.code=r}}function Qt(t){const r=t;if(!r||typeof r.profile!="string"||!/^[a-f0-9]{64}$/.test(r.runtimeSha256))throw new je("manifest","Invalid neural model manifest.");if(r.runtimeJsSha256!==void 0&&!/^[a-f0-9]{64}$/.test(r.runtimeJsSha256))throw new je("manifest","Invalid neural runtime manifest.");for(const i of gt){const n=r.models?.[i];if(!n||!/^[\w.-]+$/.test(n.file)||!Number.isSafeInteger(n.bytes)||n.bytes<=0||!/^[a-f0-9]{64}$/.test(n.sha256))throw new je("manifest",`Invalid ${i} model manifest.`);if(n.chunks!==void 0&&(!Array.isArray(n.chunks)||!n.chunks.length||n.chunks.some(e=>!e||!/^[\w.-]+$/.test(e.file)||!Number.isSafeInteger(e.bytes)||e.bytes<=0||e.bytes>=5e7||!/^[a-f0-9]{64}$/.test(e.sha256))||new Set(n.chunks.map(e=>e.file)).size!==n.chunks.length||n.chunks.reduce((e,o)=>e+o.bytes,0)!==n.bytes))throw new je("manifest",`Invalid ${i} model chunks.`)}return r}async function kn(t=!0){try{if(!globalThis.caches)throw new Error("Cache Storage unavailable");return await caches.open(Ji)}catch(r){if(t)throw new je("storage","Cannot access browser model storage.",{cause:r})}}async function Ki(t,r){const i=new URL("models/manifest.json",t),n=await kn(!1),e=AbortSignal.timeout(15e3);try{const o=await fetch(i,{cache:"no-cache",signal:r?AbortSignal.any([r,e]):e});if(!o.ok)throw new Error(`HTTP ${o.status}`);const s=Qt(await o.json());return await n?.put(i,new Response(JSON.stringify(s),{headers:{"Content-Type":"application/json"}})).catch(()=>{}),{manifest:s,offline:!1}}catch(o){const s=await n?.match(i);if(s)return{manifest:Qt(await s.json()),offline:!0};throw new je("manifest","Neural model catalogue unavailable on this address.",{cause:o})}}function Xi(t,r){const i=new URL(`models/${r.file}`,t);return i.searchParams.set("sha256",r.sha256),i.href}async function Dr(t,r){if(t.byteLength!==r.bytes)return!1;const i=await crypto.subtle.digest("SHA-256",t);return Array.from(new Uint8Array(i),n=>n.toString(16).padStart(2,"0")).join("")===r.sha256}async function Zi(t,r,i,n={}){const{signal:e,onProgress:o}=n,s=r.models[i],u=Xi(t,s);e?.throwIfAborted();const a=await kn(n.requireStorage??!1);a||n.onStorageFailure?.();const l=await a?.match(u);if(l){const d=new Uint8Array(await l.arrayBuffer());o?.({name:i,phase:"verify",received:d.length,total:s.bytes});const S=await Dr(d,s);if(e?.throwIfAborted(),S)return d;await a?.delete(u)}const c=new Uint8Array(s.bytes);let p=0;for(const d of s.chunks??[s]){const S=new URL(`models/${d.file}`,t);S.searchParams.set("sha256",d.sha256);const w=await fetch(S.href,{signal:e});if(!w.ok)throw new je("download",`Cannot download ${i} weights: HTTP ${w.status}`);const C=p;if(w.body){const y=w.body.getReader();try{for(;;){e?.throwIfAborted();const{done:P,value:v}=await y.read();if(P)break;if(p+v.byteLength>C+d.bytes)throw new je("integrity",`Invalid ${i} model size.`);c.set(v,p),p+=v.byteLength,o?.({name:i,phase:"download",received:p,total:s.bytes})}}catch(P){throw await y.cancel().catch(()=>{}),P}finally{y.releaseLock()}}else{const y=new Uint8Array(await w.arrayBuffer());p+=y.byteLength,y.byteLength===d.bytes&&c.set(y,C)}if(p-C!==d.bytes||s.chunks&&!await Dr(c.subarray(C,p),d))throw new je("integrity",`Invalid ${i} model chunk: integrity check failed.`)}if(e?.throwIfAborted(),o?.({name:i,phase:"verify",received:p,total:s.bytes}),p!==s.bytes||!await Dr(c,s))throw new je("integrity",`Invalid ${i} model: integrity check failed.`);if(e?.throwIfAborted(),a){o?.({name:i,phase:"save",received:p,total:s.bytes});try{await a.put(u,new Response(c,{headers:{"X-Magna-Model-Name":i,"X-Magna-Model-Bytes":String(s.bytes),"X-Magna-Model-Profile":r.profile}}))}catch(d){if(n.requireStorage)throw new je("storage","Cannot save model: browser storage is full or unavailable.",{cause:d});n.onStorageFailure?.()}}return c}async function Qi(t,r,i){const n=await globalThis.caches?.open("magna-urbis-neural-runtime-v1");async function e(u,a){const l=new URL(u,t);l.searchParams.set("sha256",a??r.runtimeSha256);const c=w=>a?Dr(w,{bytes:w.length,sha256:a}):Promise.resolve(!0),p=await n?.match(l);if(p){const w=new Uint8Array(await p.arrayBuffer());if(await c(w))return w;await n?.delete(l)}const d=await fetch(l,{signal:i});if(!d.ok)throw new Error("Neural runtime unavailable. Check your connection and retry.");const S=new Uint8Array(await d.arrayBuffer());if(!await c(S))throw new Error("Neural runtime integrity check failed. Please retry.");return await n?.put(l,new Response(S)),S}const o=await e("magna_urbis_neural_wasm.js",r.runtimeJsSha256),s=await e("magna_urbis_neural_wasm_bg.wasm",r.runtimeSha256);return{javascript:o,wasm:s}}let en="",Lr,vt="",cr,rn="";function Sn(t,r){if(new URL(t).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const i=t+(r?.runtimeSha256??"")+(r?.runtimeJsSha256??"");return(en!==i||!Lr)&&(en=i,Lr=(async()=>{if(r){const{javascript:o,wasm:s}=await Qi(t,r),u=URL.createObjectURL(new Blob([o],{type:"text/javascript"}));try{const a=await import(u);return await a.default({module_or_path:s}),a}finally{URL.revokeObjectURL(u)}}const e=await import(new URL("magna_urbis_neural_wasm.js",t).href);return await e.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",t)}),e})().catch(n=>{throw Lr=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Lr}async function _t(){if(cr){try{(await cr).free()}catch{}cr=void 0,vt=""}}async function ea(t,r,i,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:e}=await Ki(t),o=[e.runtimeSha256,...gt.map(a=>e.models[a].sha256)].join(":");(vt!==t+o||!cr)&&(await _t(),vt=t+o,cr=(async()=>{const a=await Sn(t,e);rn=o;const l=[];for(const c of gt){const p=e.models[c];n?.(`Neuronal WASM · ${c} · ${(p.bytes/1e6).toFixed(1)} Mo`),l.push(await Zi(t,e,c,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),a.NeuralRelief.create(l[0],l[1],l[2])})().catch(a=>{throw cr=void 0,a}));const s=await cr;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await s.generate_json(JSON.stringify(Object.fromEntries(r)),i?JSON.stringify(i):"");try{const a=new Float32Array(u.heights),l=JSON.parse(u.meta),c=Number(r.get("extent")??4e4),p=Number(r.get("resolution")??Math.ceil(c/Number(r.get("sampleSpacing")??30))),d=l.resolution;if(l.extent!==c||l.nativeCellM!==30||l.nativeResolution!==Math.ceil(c/30)||typeof d!="number"||!Number.isInteger(d)||d!==p||a.length!==d*d||l.outputCellM!==c/d||a.some(S=>!Number.isFinite(S)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:a,meta:{...l,modelIdentity:rn}}}finally{u.free()}}let tn;async function _n(t,r,i,n){tn??=xt();const{seed:e,width:o,motifSize:s,relief:u,erosion:a,mountainMix:l,environment:c,zones:p,erosionTuning:d,sketch:S,source:w}=t,C=S?.processing,y=er(t),P={seed:e,width:o,motifSize:s,relief:u,erosion:a,mountainMix:l,environment:c,zones:p,erosionTuning:d,sampleSpacing:y.requestedSpacing,sourceN:y.n,coastMask:C?0:t.coastMask??0,islandMode:t.islandMode??"island",source:w,...C?{sketch:{processing:C},surface:Array.from(Hr(hr(S),y.n))}:{}},f=await(await Br(r,"/terrain",JSON.stringify({session:tn,settings:P,region:i,field:n}))).arrayBuffer();if(f.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const m=new DataView(f).getUint32(0,!0);if(m%4||4+m>f.byteLength)throw new Error("En-tête terrain local invalide.");const g=JSON.parse(new TextDecoder().decode(new Uint8Array(f,4,m)));let B=4+m;const z={};for(const E of g.arrays){const b=E.count*(E.type==="f32"?4:1);if(!Number.isSafeInteger(E.count)||E.count<0||B+b>f.byteLength)throw new Error("Raster terrain local incomplet.");z[E.name]=E.type==="f32"?new Float32Array(f,B,E.count):new Uint8Array(f,B,E.count),B+=b}const k=z.height,O=g.resolution*g.resolution;if(!Number.isInteger(g.resolution)||g.resolution<64||g.resolution>1024||!k||k.length!==O||!k.every(Number.isFinite)||["normalX","normalY","normalZ"].some(E=>z[E]?.length!==O))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(g.fieldFloor)||!Number.isInteger(g.fieldN)||g.fieldN!==y.n||z.field?.length!==g.fieldN*g.fieldN||!z.field.every(Number.isFinite)||z.physical?.length!==g.fieldN*g.fieldN||!z.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:g.session,x:g.x,y:g.y,width:g.width,resolution:g.resolution,minHeight:g.minHeight,maxHeight:g.maxHeight,globalMinHeight:g.globalMinHeight,globalMaxHeight:g.globalMaxHeight,motifSize:g.motifSize,height:k,normalX:z.normalX,normalY:z.normalY,normalZ:z.normalZ,caveMask:z.caveMask,prepareMs:g.prepareMs,samplingMs:g.samplingMs,generationMs:g.prepareMs+g.samplingMs,generationBackend:"native",generationReason:g.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${g.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:g.erosionDefaults,...z.field?{field:{n:g.fieldN,data:z.field,exact:g.fieldExact,floor:g.fieldFloor,...z.physicalCave?{cave:z.physicalCave}:{}}}:{},...z.physical?{physical:{n:g.fieldN,height:z.physical}}:{},definition:y}}function ra(t){if(t.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return _n(t.settings,t.runtime,t.region,t.kind==="overview")}async function ta(t,r){const i=await _n(t,r,{x:0,y:0,extent:t.width,resolution:64},!0);if(!i.field||i.field.data.length!==er(t).n**2)throw new Error("Surface physique native absente.");return{height:i.field.data,prepareMs:i.prepareMs??0,samplingMs:i.samplingMs??0,session:i.session,fieldExact:i.field.exact,erosionDefaults:i.erosionDefaults}}const na="[relief_session_missing]",nn=t=>Array.from(t,r=>Number.isFinite(r)?r:null),ia=t=>new Uint8Array(t.buffer,t.byteOffset,t.byteLength);class gr{constructor(r,i){this.runtime=r,this.tuning=i,this.session=xt(),this.steps=[],this.released=!1}static async build(r,i,n,e){const o=new gr(r,e.slice());return await o.mutate({op:"build",...i},n),o}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,r=>r??NaN)}editSurface(r){return this.mutate({op:"edit"},r)}coast(r,i,n,e){return this.mutate({op:"coast",mask:r,mode:i,surface:!!e,...n?{tuning:nn(n)}:{}},e)}carveUnderdark(r){return this.mutate({op:"underdark",seed:r})}async sampleRegion(r,i,n,e){const{meta:o,arrays:s}=await this.send({op:"read",region:{x:r,y:i,extent:n,resolution:e}}),u=o.region,a=s.height;if(!u||!a||a.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:a,cave_mask:s.caveMask,normal_x:s.normalX,normal_y:s.normalY,normal_z:s.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}free(){this.released||(this.released=!0,this.steps.length=0,Br(this.runtime,"/release",JSON.stringify({session:this.session})).then(r=>r.arrayBuffer(),()=>{}))}async mutate(r,i){this.meta=(await this.send(r,i)).meta,this.steps.push({header:r,plane:i})}async send(r,i){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(r,i)}catch(n){if(r.op==="build"||!(n instanceof Error)||!n.message.includes(na))throw n;for(const e of this.steps)await this.call(e.header,e.plane);return this.call(r,i)}}async call(r,i){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:nn(this.tuning),...r})),e=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);e.set(n);const o=new Uint8Array(4);new DataView(o.buffer).setUint32(0,e.length,!0);const u=await(await Br(this.runtime,"/terrain/relief",new Blob([o,e,...i?[ia(i)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const a=new DataView(u).getUint32(0,!0);if(a%4||4+a>u.byteLength)throw new Error("Native relief reply header invalid.");const l=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,a))),c={};let p=4+a;for(const{name:d,type:S,count:w}of l.arrays){const C=w*(S==="f32"?4:1);if(!Number.isSafeInteger(w)||w<0||p+C>u.byteLength)throw new Error("Native relief plane incomplete.");c[d]=S==="f32"?new Float32Array(u,p,w):new Uint8Array(u,p,w),p+=C}return{meta:l,arrays:c}}}const aa=["plateau","volcano","caldera"],Or=t=>t==="neural-wasm"||t==="neural-python"||t==="neural",oa="http://127.0.0.1:8792",sa="http://127.0.0.1:8793";function la(t,r){const i=t==="neural-python"?sa:oa,n=r?.trim().replace(/\/+$/,"");if(!n)return i;try{const e=new URL(n);if(e.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(e.hostname)&&["8792","8793"].includes(e.port)&&e.pathname==="/"&&!e.search&&!e.hash&&!e.username&&!e.password)return i}catch{}return n}const Mn={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},ca={flat:20,hills:110,plateau:100},dr=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],$r=t=>t.climateValues??ii[t.climate??"temperate"];function an(t){const r=new Float32Array(t.height.length);let i=0,n=0;for(let s=0;s<t.height.length;s++)t.height[s]>0&&(r[n++]=t.height[s],i+=Math.acos(Math.min(1,t.normalZ[s])));const e=r.subarray(0,n).sort(),o=s=>n?e[Math.min(n-1,Math.floor(s*n))]:0;return{p5:o(.05),p50:o(.5),p95:o(.95),slope:i/Math.max(1,n),land:n/Math.max(1,t.height.length)}}let Jr,q,sr="",ut="",Cr="",Fr,Ar,$e,lr=!1,Y;const He=()=>Y??q,Er=()=>Y?Y.physicalHeightField():Promise.resolve(q.physical_height_field()),on=()=>Y?Y.samplingBaseField():Promise.resolve(q.sampling_base_field());let nr="",Qe,pr,de,tr,qe="cpu",Oe,sn=Promise.resolve(),De,vr="",yr="",Ne,Ir,jr="";async function Pn(){if(!jr)return;const t=jr;jr="";try{await fetch(`${t}/release`,{method:"POST"})}catch{}}let wr,Z,Ve;const xr=new yt;function pa(){Yr(),Ai(),xr.clear(),de?.dispose(),de=void 0,tr=void 0,q?.free(),q=void 0,Y?.free(),Y=void 0,sr="",nr="",lr=!1,$e=void 0,De?.dispose(),De=void 0,Z=void 0,Ve=void 0,Ne=void 0,vr="",yr="",wr=void 0}async function ua(t,r,i,n){const e=er(t),o=Math.ceil(t.width/30),s=(f,m)=>m.extent===t.width&&m.resolution===e.n&&m.nativeCellM===30&&m.nativeResolution===o&&m.outputCellM===t.width/e.n&&f.length===e.n*e.n&&f.every(Number.isFinite),u=la(t.source,t.neuralServer);t.source==="neural-wasm"&&i==="peninsula"&&(n?.("Peninsula unavailable in the browser neural engine: single island."),i="island");const a=new URLSearchParams({seed:t.seed,relief:t.relief,mix:String(t.relief==="mixed"?t.mountainMix:.5),coasts:String(r),islands:i,climate:t.climate??"temperate",noise:String(t.fidelity??.05),extent:String(t.width),sampleSpacing:String(e.requestedSpacing),resolution:String(e.n)}),l=$r(t),c=t.neuralTuning??Mn;for(const[f,m]of Object.entries(l))a.set(f,String(m));a.set("landScale",String(c.landScale)),a.set("steps",String(c.steps)),a.set("detail",String(c.detail));for(const f of["coarseModel","baseModel","decoderModel"])t[f]&&a.set(f,t[f]);for(const f of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])a.set(f,String(c[f]));a.set("histogram",c.histogram.join(","));const p=ca[t.relief];c.reliefMode==="fixed"?a.set("reliefFixed",String(c.reliefFixed)):c.reliefMode==="auto"&&p!==void 0?a.set("reliefFixed",String(p)):a.set("reliefScale",String(c.reliefMode==="scale"?c.reliefScale:1));const d=oi(t.width,t.width,t.neuralFit??"crop",t.neuralSlopes??!0),S=t.zones?{zones:mn(t.zones),region:{x:d.x,y:d.y,width:d.width}}:t.sketch?si(hr(t.sketch),d):void 0,w=performance.now();if(t.source==="neural-wasm"){if(await Pn(),!t.neuralAssets)throw new Error("Neural browser runtime URL missing.");const f=await ea(t.neuralAssets,a,S,n);if(!s(f.heights,f.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:f.heights,info:{...f.meta,requestMs:performance.now()-w}}}await _t();let C=S;if(t.source==="neural-python"){if(t.zones&&(await fetch(`${u}/status`,{cache:"no-store"}).then(B=>B.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!t.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const f=await Sn(t.neuralAssets),m=Object.fromEntries(a);C={params:m,conditioning:JSON.parse(f.conditioning_json(JSON.stringify(m),S?JSON.stringify(S):"")),edited:!!S},n?.("Neural Python · computing with PyTorch/CUDA")}let y;try{y=await fetch(`${u}/generate?${a}`,{cache:"no-store",...C?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(C)}:{}})}catch{throw new Error(`Neural service unreachable (${u}): run “npm run ${t.source==="neural-python"?"neural:python":"neural:serve"}” from web/`)}if(!y.ok)throw new Error(`Neural service: ${await y.text()}`);const P=new Float32Array(await y.arrayBuffer()),v=JSON.parse(y.headers.get("X-Neural-Meta")??"{}");if(t.source==="neural-python"&&(jr=u),S&&(v.edited!==!0||v.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!s(P,v))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:P,info:{...v,requestMs:performance.now()-w}}}function fa(t){return Jr??=(async()=>{ri()?(t?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await ti(),t?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await ni(()=>hi(gi,r=>mi({module_or_path:r}),t))})()}pn(()=>{xr.clear(),Jr=void 0,q=void 0,Y?.free(),Y=void 0,sr="",nr="",lr=!1,De=void 0,Ne=void 0,vr="",yr="",wr=void 0,Z=void 0,Ve=void 0});function ha(t,r,i,n){const e=sn.then(()=>ln(t,r,i,n).catch(async o=>{if(!await $n(o))throw o;return i?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),ln(t,r,i,n)}));return sn=e.catch(()=>{}),e}async function ln(t,r,i,n){const{settings:e,region:o,kind:s,display:u,runtime:a}=t,l=er(e);if(jn(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning});const c=e.compute==="wasm"?"wasm":"gpu-f32",p=e.generationCompute??"gpu-erosion";if(Wn(e,l.n))throw new Error(`GPU generation is limited to ${Yn}² cells; requested spacing ${l.spacing.toFixed(2)} m (${l.n}²). Choose CPU or native.`);const d=Je(e.generalSeed??e.seed,"relief-coast-cut"),S=!!e.generalSeed&&pt(e.generalSeed,_=>_.startsWith("relief-"))!==hn(e.generalSeed),w=Kr(e),C=e.hydrology?.compute==="auto"&&(c==="wasm"||p==="cpu")?"cpu":e.hydrology?.compute??"auto";if(C!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&kt(),w&&!e.zones&&!e.sketch?.processing&&(!Vn.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const y=p==="native"&&!Or(e.source);if(y&&a?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(y&&e.relief==="cavern")return ra(t);const P=aa.includes(e.relief)?e.environment??"mixed":"mixed",v=e.sketch?.processing,f=re(e,"coasts")?e.relief==="cavern"||e.underdark||v?0:e.coastMask??0:0,m=e.islandMode??"island",g=_i.includes(e.relief),B=c!=="wasm"&&g?Mi(c,e.relief).catch(()=>{}):void 0;Jr&&i?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await fa(i)}catch(_){throw Jr=void 0,_}const z=performance.now();B&&i?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const k=B?await br(B):void 0;n&&await n.after("prepare");const O=(_,x)=>{const R=$e;$e={erosionSpacing:_===void 0?R?.erosionSpacing:Math.max(R?.erosionSpacing??0,_),regionalErosionSpacing:x===void 0?R?.regionalErosionSpacing:Math.max(R?.regionalErosionSpacing??0,x)},Object.assign(l,$e)},E=async(_,x=!1)=>{let R=x&&re(e,"phasor",!1)?dt(_,e):_;const X=Gt(e),K=Tt(e),Q=Wr(e);for(const A of["posterior","wind"]){const L=JSON.stringify([Q.get(A),a?.server,!!k,ai(new Uint8Array(R.buffer,R.byteOffset,R.byteLength))]),fe=e.procedural?xr.get(A,L):void 0;if(fe){R=fe,n?.cached?await n.cached(A,n.previews===!1?void 0:R):(await n?.before(A),await n?.after(A,n.previews===!1?void 0:R));continue}if(await n?.before(A),A==="posterior"&&e.procedural&&re(e,A)&&X.mode!=="none"){const D=R,ne=Math.sqrt(R.length);R=(await Lt(R,ne,e.width,X,{stats:!1},a)).height;for(let ie=0;ie<R.length;ie++)R[ie]=D[ie]>0?Math.max(.3,R[ie]):R[ie]}A==="wind"&&e.procedural&&re(e,A)&&K.iterations&&K.transport&&(R=k?await xi(k.context,R,e.width,K):wi(R,e.width,K)),e.procedural&&l.n<=1024&&xr.put(A,L,R),await n?.after(A,n.previews===!1?void 0:R)}return e.procedural&&R.some(A=>A<.3)?R.map(A=>Math.max(.3,A)):R},b=k?br(k.pipeline).then(_=>({pipeline:_}),()=>{}):void 0,U=!y&&!e.zones&&!e.sketch&&p!=="cpu"&&c!=="wasm"&&!Or(e.source)&&e.relief!=="cavern",F=U&&k?Ti(k.context,e):void 0;if(F?.error&&e.generationCompute)throw new Error(F.error);const I=e.generationCompute||!F?void 0:F.error??(Jn(F)?`Source ${l.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),G=!!F&&!F.error&&!I,H=U&&Pi.includes(e.relief),J=H&&G,ue=(l.n!==1024||!!(e.procedural||n||S))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!Or(e.source)&&(!J||p!=="gpu-erosion"),$=!v&&Or(e.source);$||(await _t(),await Pn());const ye=a?.profile==="local"&&(y||$),pe=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,tt(e.modification.delta)]):"",ee=JSON.stringify([e.zones,pe,!!e.underdark,y?[a.server,f,m]:null,ye?a.server:null])+"|"+JSON.stringify($?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,f,f===255?m:"island",$r(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??Mn,e.width,l.n,e.coarseModel,e.baseModel,e.decoderModel]:[e.seed,...e.generalSeed?[pt(e.generalSeed,_=>_.startsWith("relief-"))]:[],e.width,l.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,y?"native":w?[p,c,!!k]:H?p:"cpu",P,e.sketch,e.erosionTuning??{},...e.procedural?[Kn,e.procedural,e.climate,e.climateValues,e.climateZone,J?null:[f,m]]:[],...w||e.procedural?.enabled?.phasor?[nt,e.climate??"temperate",e.phasor??{}]:[]]);let we=0,Fe=0,be=0,Ie=0,ke=0,Se;if(n&&n.previews!==!1||!(q||Y)||sr!==ee){de?.dispose(),de=void 0,tr=void 0,q?.free(),q=void 0,Y?.free(),Y=void 0,lr=!1,sr="",nr="",$e=void 0;const _=performance.now();Cr="",ut="",Fr=void 0,Ar=void 0,qe="cpu",Oe=void 0;const x=e.relief==="mixed"?e.mountainMix:.5;Ir=void 0;const R=Float64Array.from(dr,A=>{let L=w&&!e.procedural?NaN:e.procedural?.erosionTuning?.[A]??e.erosionTuning?.[A]??NaN;return e.procedural?.biome&&!J&&!ue&&(A==="incision"||A==="thermal")&&(L=(Number.isFinite(L)?L:1)*(A==="incision"?zr(e).water:zr(e).thermal)),L});if(Ur(R),ue){i?.(I?`${I} Rust CPU generation at ${l.spacing.toFixed(2)} m…`:y?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const A=await E(await vi(e,n,y?a:void 0,J&&k?()=>Ht(k.context,e,i):void 0,(L,fe)=>{$e={erosionSpacing:L,regionalErosionSpacing:fe},Object.assign(l,$e)}));n&&await n.before("retain"),ye?Y=await gr.build(a,{kind:"source",seed:d,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:x,environment:P},A,R):q=Ue.with_source(d,e.width,e.relief,e.erosion,e.motifSize,x,A,P),n&&await n.after("retain",n.previews===!1?void 0:A),qe=y?"native":J?p==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":w?"compact-cpu":"cpu",Oe=I??`${y?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(y){i?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${l.n} × ${l.n} physical field`});const A=e.procedural?.biome?{...e,coastMask:f,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*zr(e).water,thermal:(e.erosionTuning?.thermal??1)*zr(e).thermal}}:e,L=await ta(A.sketch&&!v?{...A,sketch:void 0}:A,a);Y=await gr.build(a,{kind:"surface",seed:d,width:e.width},v==="surface"?L.height:e.procedural?await E(L.height,!0):L.height,R),qe="native",Oe="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",ke=L.prepareMs}else if(v){i?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const A=Hr(hr(e.sketch),l.n);v==="erosion"?(i?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),q=Ue.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,P,l.n),q.set_edited_surface(A)):q=Ue.with_surface(d,e.width,A),Oe=v==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if($){const A=await ua(e,f,m,i),L=Xn(A.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);ye?Y=await gr.build(a,e.zones?{kind:"zonedSurface",seed:d,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:d,width:e.width},L,R):q=e.zones?Ue.with_zoned_surface(d,e.width,e.motifSize,L,JSON.stringify(e.zones)):Ue.with_surface(d,e.width,L),Ir=A.info,qe="neural",e.zones&&(Oe="Zones → regional conditioning and local neural relief, then sea operation.")}else if(w&&!e.zones)if(k&&G){i?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:O},L=await E(await Yt(k.context,e,A,i));n&&await n.before("retain"),Se=A.profiles,q=Ue.with_source(d,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,x,L,P),n&&await n.after("retain",L),qe="compact-gpu-f32",Oe=`${nt} · compact preset · ${e.procedural?.regionalN??Bt(e).n}² grid · ${e.climate??"temperate"} · Phasor ${re(e,"phasor",!0)?"enabled":"disabled"}.`}else{i?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const A=e.procedural?.biome?zr(e):void 0,L=A?{incision:A.water,thermal:A.thermal}:e.procedural?{incision:1,thermal:1}:Zn(e),fe=e.procedural?.erosionTuning?.iterations??Bt(e).steps,D=e.erosionTuning??{},ne={...D,iterations:fe,surfaceIterations:re(e,"surface",!1)?D.surfaceIterations??12:0,detail:re(e,"ridged",!1)?D.detail:0,warp:D.warp??0,incision:(D.incision??1)*L.incision,thermal:(D.thermal??1)*L.thermal};Ur(Float64Array.from(dr,oe=>ne[oe]??NaN));let ie;try{ie=Ue.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,P,l.n);const oe=ie.physical_height_field();q=Ue.with_source(d,e.width,"hills",e.erosion,e.motifSize,x,re(e,"phasor",!0)?dt(oe,e):oe,P)}finally{ie?.free(),Ur(new Float64Array(dr.length).fill(NaN))}qe="compact-cpu",Oe=`${nt} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)i?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${l.n} × ${l.n} physical field`}),q=Ue.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,P,JSON.stringify(mn(e.zones)),l.n),Oe="Zone masks → uplift, noise, ridges and Rust erosion.";else if(J&&k)try{if(p==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const A={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:O},L=await E(await Yt(k.context,e,A,i));n&&await n.before("retain"),ke=A.nativeEnvironmentMs,Se=A.profiles,Ie=performance.now()-_-ke,q=Ue.with_source(d,e.width,e.relief,e.erosion,e.motifSize,x,L,P),n&&await n.after("retain",L),qe="gpu-erosion-f32"}else{const A=await Ht(k.context,e,i);Fe=performance.now()-_;const L=performance.now();i?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),q=Ue.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,A.coarse,A.fine,P),be=performance.now()-L,qe=p==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(A){if(n||e.procedural)throw A;Oe=`GPU generation unavailable: ${A instanceof Error?A.message:String(A)}`}if(!q&&!Y&&(i?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${l.n}² physical source at ${l.spacing.toFixed(2)} m`}),q=Ue.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,x,P,l.n),I&&(Oe=I)),!v&&!$&&e.sketch&&e.relief!=="cavern"){const A=hr(e.sketch),L=await Er(),fe=Qn(A,L,l.n);Y?await Y.editSurface(fe):q.set_edited_surface(fe),Oe="Edited sketch + procedural detail and Rust erosion."}const X=Gt(e),K=Tt(e),Q=re(e,"posterior")&&X.mode!=="none"||re(e,"wind")&&K.iterations>0&&K.transport>0;if(!ue&&e.procedural&&(Q||!w&&re(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(qe)&&!$&&!v&&!y&&!e.zones){q.set_coast(f,m);const A=q.physical_height_field(),L=await E(A,!w);q.free(),q=Ue.with_surface(d,e.width,L),lr=!0}we=performance.now()-_,sr=ee}else if(i?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),$e&&Object.assign(l,$e),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const _ of["grids",...wt(e),"phasor","posterior","wind"])await n.cached(_);const he=JSON.stringify([Wr(e).get("coasts"),qe,a?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,tt(e.sketch.heights)],e.zones&&[e.zones.resolution,tt(e.zones.weights)]]),ae=e.procedural&&f&&!$&&!lr?xr.get("coasts",he):void 0;!ae&&n&&await n.before("coasts");const Ce=!F?.error&&!I&&!e.zones&&!e.sketch&&f!==0&&p!=="cpu"&&c!=="wasm",se=$?"neural":JSON.stringify([f,f===255?m:"island",f?Ce:!1]);let me=0;if($||y&&!ue||lr)nr=se,Qe=lr&&f?"cpu":void 0,pr=void 0;else if(nr!==se){de?.dispose(),de=void 0,tr=void 0,Qe=void 0,pr=void 0;const _=performance.now();i?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const x=e.procedural,R={...e.erosionTuning,...x?.erosionTuning},X=x&&f?Float64Array.from(dr,K=>K==="surfaceIterations"?x.coastIterations??(w?2:12):K==="surfaceIncision"?(R[K]??1)*(x.coastIncision??1):K==="surfaceThermal"?(R[K]??1)*(x.coastThermal??1):K==="surfaceDiffusion"?(R[K]??1)*(x.coastDiffusion??1):R[K]??NaN):void 0;if(Y?(await Y.coast(f,m,ae?void 0:X,ae),f&&(Qe="native")):ae&&(q.configure_coast(f,m),q.set_coast_surface(ae),Qe="cpu"),!Y&&!ae&&Ce&&k){let K;try{const Q=await b;if(!Q||k.context.lost)throw new Error("WebGPU indisponible");q.configure_coast(f,m),K=new qt(k.context,Q.pipeline,c,q);const A=K.prepareCoastField(e),L=await Li(k.context,e,A,q.coast_erosion_parameters(),i);q.set_coast_surface(L),Qe="gpu-f32"}catch(Q){pr=`Littoral GPU indisponible : ${Q instanceof Error?Q.message:String(Q)}`}finally{K?.dispose()}}if(!Y&&!Qe){X&&Ur(X);try{q.set_coast(f,m)}finally{X&&Ur(Float64Array.from(dr,K=>R[K]??NaN))}f&&(Qe="cpu"),Ce&&!k&&(pr="WebGPU indisponible")}nr=se,me=f?performance.now()-_:0,we+=me}const Ae=f&&e.procedural&&(!ae&&l.n<=1024||n&&n.previews!==!1&&!(ae&&n.cached))?await on():void 0;if(Ae&&!ae&&l.n<=1024&&xr.put("coasts",he,Ae),ae&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:ae):n&&await n.after("coasts",n.previews===!1?void 0:Ae),e.modification&&Cr!==ee+"|"+se){const _=He().source_resolution(),x=v==="surface"?Hr(hr(e.sketch),_):await Er();if(Fr={n:_,height:x.slice()},Ar=ei(x,_,e.modification),de?.dispose(),de=void 0,tr=void 0,Y){const R=Y;Y=await gr.build(a,{kind:"surface",seed:d,width:e.width},Ar,new Float64Array(dr.length).fill(NaN)),R.free()}else q?.free(),q=Ue.with_surface(d,e.width,Ar);Cr=ee+"|"+se}e.underdark&&ut!==ee+"|"+se+"|"+Cr&&(i?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),de?.dispose(),de=void 0,tr=void 0,Y?await Y.carveUnderdark(e.seed):q.carve_underdark(e.seed),ut=ee+"|"+se+"|"+Cr);let Be;const Ee=async(_,x,R)=>((Be?.delta!==_||Be.m!==x||Be.n!==R)&&(Be={delta:_,m:x,n:R,out:await pi(_,x,R,a)}),Be.out);async function Ke(_){$e?Object.assign(l,$e):l.erosionSpacing??=He().erosion_spacing(),_.definition=l,n&&await n.after("sampling",_.height),n&&await n.before("hydrology");const x=re(e,"hydrology")?e.hydrology:void 0;_.neural=Ir,s==="overview"&&!$&&e.relief!=="cavern"&&(_.erosionDefaults=Array.from(li(e.relief,e.width,e.motifSize,e.mountainMix)));const R=!!x?.enabled&&e.relief!=="cavern",X=x?.engine!=="rust",K=x?.erosionEnabled!==!1,Q=K&&x?.showErosion!==!1,A=K?x?.condMode:"none",L=X&&x&&x.lakes!=="none"?[x.lakeAbundance,x.lakeArea,x.lakeDepth,x.lakeCoverage,x.maxLakeArea]:[0,0,0,0,0],fe=x&&{mode:x.condMode,strength:x.condStrength,maxDepth:x.condDepth,maxLength:x.condLength,banks:x.condBanks,lakes:L[0],lakeArea:L[1],lakeDepth:L[2],lakeCoverage:L[3],maxLakeArea:L[4]};if(r&&x&&R&&s==="overview"&&u==="gl"){const D=Ot(X?x.vectorResolution:x.resolution,l.n),ne=JSON.stringify([sr,nr,D,A,A==="none"?0:[x.condStrength,x.condDepth,x.condBanks,x.condLength,L]]);(!Z||Z.key!==ne||X&&!Ve)&&r({..._,height:_.height.slice(),normalX:_.normalX.slice(),normalY:_.normalY.slice(),normalZ:_.normalZ.slice(),caveMask:_.caveMask.slice(),neural:Ir,field:await We(_,!1,X),relief:an(_),generationMs:performance.now()-z})}if(x&&R){const D=Ot(X?x.vectorResolution:x.resolution,l.n),ne=JSON.stringify([sr,nr,D,A,A==="none"?0:[x.condStrength,x.condDepth,x.condBanks,x.condLength,L]]),ie=$r(e),oe={riverArea:Vi(x,e.width)/Math.max(.05,x.density)**2,headwaters:x.headwaters!==!1?1:0,minRiverLength:x.minRiverLength,lakeDepth:x.lakeDepth,lakeArea:x.lakeArea,riverMode:x.riverMode,flatSlope:x.flatSlope,sinuosity:x.sinuosity,widthScale:x.vectorWidth,balance:x.balance,braiding:x.braiding,anabranching:x.anabranching,terrainInfluence:x.terrainInfluence,avulsions:x.avulsions,confluence:x.confluence,deltas:x.deltas},Pe=JSON.stringify([ne,oe,ie.temperature,ie.precipitation,Je(e.generalSeed??e.seed,"water-hydrology")]);if(!Z||Z.key!==ne){Z=void 0,Ve=void 0,De?.dispose(),De=void 0,Ne=void 0,vr="",yr="";let ge;if(_.x===0&&_.y===0&&_.width===e.width&&_.resolution===D)ge=_.height.slice();else if(de&&!de.lost)ge=(await de.sample({x:0,y:0,extent:e.width,resolution:D},e,q.min_height,q.max_height)).height;else{const V=Y?await Y.sampleRegion(0,0,e.width,D):q.sample_region(0,0,e.width,D);try{ge=V.height}finally{V.free()}}if(A==="none")Z={key:ne,n:D,height:ge,m:0};else{i?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const V=fe;if(X){const ve=await Ft(ge,D,e.width,V,oe,ie,Je(e.generalSeed??e.seed,"water-hydrology"),a),{height:j,delta:te,...ar}=ve.conditioning;Z={key:ne,n:D,height:j,source:ge,delta:te,m:D,stats:ar},Ve={key:Pe,water:ve.water}}else{const ve=await Lt(ge,D,e.width,V,{stats:!1,drainage:!1},a),{height:j,delta:te,hydrology:ar,...Te}=ve;Z={key:ne,n:D,height:j,source:ge,delta:te,m:D,stats:{...Te,census:!1},drainage:ar}}}}if(X){if(!Ve||Ve.key!==Pe)if(i?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),Z.source){const ge=await Ft(Z.source,D,e.width,fe,oe,ie,Je(e.generalSeed??e.seed,"water-hydrology"),a),{height:V,delta:ve,...j}=ge.conditioning;Object.assign(Z,{height:V,delta:ve,stats:j}),Ve={key:Pe,water:ge.water}}else Ve={key:Pe,water:await ci(Z.height,D,e.width,oe,ie,Je(e.generalSeed??e.seed,"water-hydrology"),Z.drainage,a)}}else{const ge=JSON.stringify([ne,C,Je(e.generalSeed??e.seed,"water-hydrology")]),V={...x,showErosion:!0,erosionEnabled:K,...K?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},ve=`${ge}|${JSON.stringify(V)}`;if($&&wr?.key===ve)_.hydrologyError=wr.message;else try{(!De||vr!==ge)&&(i?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),De?.dispose(),De=void 0,Ne=void 0,yr="",De=await St.create(Je(e.generalSeed??e.seed,"water-hydrology"),e.width,D,Z.height.slice(),C,e.sketch||e.zones?He().min_height<=0:$?He().min_height<0:f!==0),vr=ge);const j=$r(e),te=JSON.stringify([V,j.temperature,j.precipitation]);(!Ne||yr!==te)&&(i?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Ne=De.generate(V,j),yr=te)}catch(j){if(!$)throw j;De?.dispose(),De=void 0,Ne=void 0,vr="",wr={key:ve,message:j instanceof Error?j.message:String(j)},_.hydrologyError=wr.message}}}if(i?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),R&&Q&&Z?.delta&&!e.underdark&&await ui(_,Z.delta,Z.m,e.width,a),R&&Q&&!X&&Ne&&!_.hydrologyError){const D=performance.now();bn(_,Ne),_.hydrologySurfaceMs=performance.now()-D}if(s==="overview"){const D=He().source_resolution(),ne=e.underdark?await Er():Ar?.slice()??(v==="surface"?Hr(hr(e.sketch),D):await Er());if(R&&Q&&Z?.delta&&!e.underdark){const ie=await Ee(Z.delta,Z.m,D);for(let oe=0;oe<ne.length;oe++)ne[oe]+=ne[oe]<=0?Math.min(0,ie[oe]):ie[oe]}R&&Q&&!X&&Ne&&!_.hydrologyError&&Zt({x:0,y:0,width:e.width,resolution:D,height:ne,minHeight:_.globalMinHeight,maxHeight:_.globalMaxHeight},Ne),_.physical={n:D,height:ne},Fr&&(_.modificationBase=Fr)}return e.refine&&u!=="gl"&&fi(_,e.width/He().source_resolution(),di(e.seed),e.detailNoise),s==="overview"&&(u==="gl"||t.retainField)&&(i?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),_.field=await We(_,R,X)),s==="overview"&&R&&(X?_.water=Ve?.water:Ne&&!_.hydrologyError&&(_.hydrology=Ne),Z?.delta&&Z.stats&&(_.conditioning={delta:Z.delta,n:Z.m,stats:Z.stats})),s==="overview"&&(_.relief=an(_)),e.zones&&_.neural&&_.relief&&(_.neural={..._.neural,land:_.relief.land}),_.generationMs=performance.now()-z,n&&await n.after("hydrology",_.height),_}async function We(_,x,R){const X=He().sampling_parameters()[5],K=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((X===1||X===4)&&e.relief!=="cavern"){const fe=He().source_resolution(),D=await on();if(x&&K&&Z?.delta&&!e.underdark){const oe=await Ee(Z.delta,Z.m,fe);for(let Pe=0;Pe<fe*fe;Pe++)D[Pe]+=D[Pe]<=0?Math.min(0,oe[Pe]):oe[Pe]}const ne=x&&K&&!R&&!_.hydrologyError?Ne:void 0;ne&&Zt({x:0,y:0,width:e.width,resolution:fe,height:D,minHeight:_.globalMinHeight,maxHeight:_.globalMaxHeight},ne);const ie=e.underdark?Y?await Y.physicalCaveField():q.physical_cave_field():void 0;return{n:fe,data:D,exact:!ne,floor:X===1?.3:0,cave:ie?.length?ie:void 0}}const Q=He().source_resolution(),A=_.physical?.height.slice()??await Er(),L=e.relief!=="cavern"&&!e.underdark?void 0:Y?await Y.physicalCaveField():q.physical_cave_field();return{n:Q,data:A,exact:!1,floor:0,cave:L?.length?L:void 0}}n&&await n.before("sampling",`Borne du moteur ${He().max_height.toFixed(2)} m · aperçu ${o.resolution}²`);let Re,Ge=0,le;if(c!=="wasm"&&g&&!Y&&!e.underdark){i?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const _=performance.now();try{const x=await b;k&&x&&!k.context.lost&&((!de||tr!==c||de.lost)&&(de?.dispose(),de=void 0,de=new qt(k.context,x.pipeline,c,q),tr=c),Ge=performance.now()-_,i?.(`GPU · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"}),le={...await de.sample(o,e,q.min_height,q.max_height),generationMs:performance.now()-z,prepareMs:we,gpuSetupMs:Ge,generationBackend:qe,generationReason:Oe,noiseMs:Fe,erosionMs:be,gpuSimulationMs:Ie,nativeEnvironmentMs:ke,erosionProfile:Se,coastBackend:Qe,coastMs:me,coastReason:pr}),le||(Re="WebGPU indisponible")}catch(x){Re=`GPU indisponible : ${x instanceof Error?x.message:String(x)}`,de?.dispose(),de=void 0,tr=void 0}}else Y?Re="Native Rust sampling on the local service.":c!=="wasm"&&(Re="terrain currently sampled in WASM");if(le)return Ke(le);i?.(`${Y?"Native Rust":"CPU"} · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"});const ir=performance.now(),_e=Y?await Y.sampleRegion(o.x,o.y,o.extent,o.resolution):q.sample_region(o.x,o.y,o.extent,o.resolution);try{return await Ke({x:_e.x,y:_e.y,width:_e.width,resolution:_e.resolution,minHeight:_e.min_height,maxHeight:_e.max_height,globalMinHeight:He().min_height,globalMaxHeight:He().max_height,motifSize:e.motifSize,height:_e.height,caveMask:_e.cave_mask,normalX:_e.normal_x,normalY:_e.normal_y,normalZ:_e.normal_z,generationMs:performance.now()-z,backend:Y?"native":"wasm",backendReason:Re,prepareMs:we,samplingMs:performance.now()-ir,gpuSetupMs:Ge,generationBackend:qe,generationReason:Oe,noiseMs:Fe,erosionMs:be,gpuSimulationMs:Ie,nativeEnvironmentMs:ke,erosionProfile:Se,coastBackend:Qe,coastMs:me,coastReason:pr})}finally{_e.free()}}export{ii as CLIMATE_VALUES,oa as DEFAULT_NEURAL_SERVER,Mn as DEFAULT_NEURAL_TUNING,sa as DEFAULT_PYTHON_SERVER,dr as EROSION_SETTINGS,aa as GEOLOGICAL_RELIEFS,ca as NEURAL_RELIEF_DEFAULTS,$r as climateOf,Or as isNeuralSource,la as neuralServerForSource,pa as releaseTerrainCheckpoints,an as reliefStatistics,ha as sampleRustTerrain};
