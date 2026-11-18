import{dO as ln,dP as vt,dQ as Qe,dR as Vr,dS as Tr,dT as cn,dU as un,dV as fn,dW as ie,dX as Fn,dY as yt,dZ as Wr,d_ as Ye,d$ as dn,e0 as ut,e1 as Ct,e2 as ft,e3 as Ln,e4 as _e,e5 as dt,e6 as pn,e7 as At,e8 as Hn,e9 as In,ea as Et,eb as qn,ec as Rt,ed as Dn,ee as $n,ef as Dr,eg as gr,G as jn,a8 as Wn,eh as Yn,ei as Vn,ej as Jn,ek as Kn,el as Xn,em as et,en as Zn,eo as rt,ep as Sr,eq as _r,er as Qn,es as Nt,et as ei,eu as hn,ev as ri,ew as Bt,ex as Tt,ey as ti,ez as ni,Z as ii,eA as oi,eB as ai,eC as Gt,eD as si,eE as li,X as ci,eF as ui,eG as Ot,eH as Ft,eI as fi,eJ as di,eK as pi,eL as hi,eM as mi,eN as gi,eO as vi}from"./v2-Cc7bYZp1.js";import{n as Br,b as wt}from"./settlements-U7Pzb_Yp.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/let We;const tt=new Map;let pt=Promise.resolve();const ht=new vt;function mt(r=!1){const t=We;We=void 0,ht.clear(),r||t?.pipeline?.free(),t?.runtime&&(pt=pt.then(async()=>{await Br(t.runtime,"/terrain/stage",JSON.stringify({session:t.session,command:"cancel"})).catch(()=>{})}))}ln(()=>mt(!0));async function yi(r,t,o,n,i){t?.backend?.(o?"native":"cpu");const s=Qe(r),c=t?.previews!==!1&&s.n<=1024,u=Vr(r),a=Tr.erosion_at_resolution(r.seed,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix,s.n),e=a.parameters();a.free();const{parameters:l,surface:f}=u?cn(e,r):{parameters:e,surface:e.slice(24,32)};un(l,f,r,u),fn(f,r,s.n),u&&ie(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural?.erosionTuning?.detail===void 0&&(l[16]=e[16]);const m=(x,z=!0)=>Number(ie(r,x,z)),y=Uint32Array.from([Number(u),m("regional"),m("regionalFinish"),m("amplitude"),m("ridged",!u),m("surface",!u||r.relief==="canyon"),m("normalize"),+(r.procedural?.regionalThermal!==!1),+(r.procedural?.regionalDiffusion!==!1),r.procedural?.reconstruction==="cubic"?1:r.procedural?.reconstruction==="bspline"?2:0,+(r.relief==="canyon")]);i?.(y[5]&&l[23]>0&&f[3]>0?f[1]:void 0,y[1]&&r.erosion>0?l[4]:void 0);const b=Fn([r.seed,r.width,s.n,l[2],o?.server??"wasm",!!n]);(s.n>1024||We?.root!==b)&&mt();const M=yt(r),S=Wr(r),P=M.map(x=>S.get(x));let v=0;for(;We&&v<P.length&&We.keys[v]===P[v];)v++;const h=async x=>{try{return await Br(o,"/terrain/stage",JSON.stringify({session:We.session,...x}))}catch(z){throw["coast","restore","preview"].includes(x.command)&&z instanceof Error&&z.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):z}},p=r.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([x,z])=>[x,Ye(r.generalSeed,z)])):void 0,d={parameters:Array.from(l),surface:Array.from(f),flags:Array.from(y),stepSeeds:p??{}},O=async x=>{const z=await h(x),$=await z.json();if(p&&Object.values(p).some(H=>H!==r.seed)&&!$.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!We||v===0?(mt(),o&&!tt.has(o.server)&&tt.set(o.server,wt()),We={root:b,keys:[],runtime:o,...o?{session:tt.get(o.server)}:{}},await t?.before("grids",`Rust ${o?"natif":"WASM"} · régional ${l[2]}² · surface ${f[0]}² · source ${s.n}² à ${s.spacing.toFixed(2)} m`),o?(await pt,await O({command:"start",seed:r.seed,...d})):We.pipeline=new dn(r.seed,l,f,y),await t?.after("grids")):t?.cached?await t.cached("grids"):(await t?.before("grids"),await t?.after("grids"));const U=We;o||U.pipeline.set_step_seeds(JSON.stringify(p??{}));let A;for(let x=0;x<M.length;x++){const z=M[x],$=x<v;if(!$&&x===v&&x>0&&(o?await O({command:"restore",checkpoint:x-1,...d}):U.pipeline.restore(x-1,l,f,y),U.keys.length=x),$){(c||x===M.length-1)&&(A=o?new Float32Array(await(await h({command:"preview",checkpoint:x})).arrayBuffer()):U.pipeline.checkpoint_height(x)),t?.cached?await t.cached(z,c?A:void 0):(await t?.before(z),await t?.after(z,c?A:void 0));continue}await t?.before(z);const H=z==="coastCut"&&ut(r,"coastCut");if(o){const q=await(await h({command:z==="coastCut"?"coast":"advance",stage:Ct.indexOf(z),checkpoint:x,mask:H?r.coastMask:0,mode:r.islandMode??"island",preview:c||x===M.length-1})).arrayBuffer();q.byteLength&&(A=new Float32Array(q))}else{if(z==="initialize"&&n){const N=await n();U.pipeline.set_noise(N.coarse,N.fine)}z==="coastCut"?H&&U.pipeline.cut_coast(r.coastMask,r.islandMode??"island"):U.pipeline.advance(Ct.indexOf(z)),U.pipeline.checkpoint(x),(c||x===M.length-1)&&(A=U.pipeline.height())}U.keys[x]=P[x],await t?.after(z,c?A:void 0)}const E=`${b}|${S.get("phasor")}`,R=s.n<=1024?ht.get("phasor",E):void 0;return R?(t?.cached?await t.cached("phasor",c?R:void 0):(await t?.before("phasor"),await t?.after("phasor",R)),R):(await t?.before("phasor"),ie(r,"phasor",u)&&(A=ft(A,r)),s.n<=1024&&ht.put("phasor",E,A),await t?.after("phasor",c?A:void 0),A)}const wi=`
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
}`,Lt=new WeakMap;function xi(r,t,o){if(!o.iterations||!o.transport)return r;const n=r.slice(),i=Math.sqrt(n.length),s=t/i,c=new Float32Array(n.length),u=o.azimuth*Math.PI/180,a=Math.cos(u),e=Math.sin(u),l=a>=0?1:-1,f=e>=0?1:-1,m=Math.abs(a)/(Math.abs(a)+Math.abs(e)),y=1-m;for(let b=0;b<o.iterations;b++){c.fill(0);for(let M=1;M<i-1;M++)for(let S=1;S<i-1;S++){const P=M*i+S;if(n[P]<=.3)continue;const v=((n[P+1]-n[P-1])*a+(n[P+i]-n[P-i])*e)/(2*s),h=.75+.25*Math.sin((S*a+M*e)*s/64+n[P]*.03);c[P]=Math.min(Math.max(0,n[P]-.3),o.transport*Math.max(.1,Math.min(1,.55+2*v))*h)}for(let M=0;M<i;M++)for(let S=0;S<i;S++){const P=M*i+S,v=M*i+Math.max(0,Math.min(i-1,S-l)),h=Math.max(0,Math.min(i-1,M-f))*i+S;n[P]=n[P]-c[P]+(v!==P?c[v]*m:0)+(h!==P?c[h]*y:0)}}return n}async function bi(r,t,o,n){if(!n.iterations||!n.transport)return t;const i=r.device,s=Math.sqrt(t.length);let c=Lt.get(i);c||(c=(async()=>{const m=i.createShaderModule({code:wi}),b=(await m.getCompilationInfo()).messages.filter(h=>h.type==="error");if(b.length)throw new Error(b.map(h=>`${h.lineNum}: ${h.message}`).join(`
`));const M=i.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),S=i.createPipelineLayout({bindGroupLayouts:[M]}),[P,v]=await Promise.all(["entrain","deposit"].map(h=>i.createComputePipelineAsync({layout:S,compute:{module:m,entryPoint:h}})));return{layout:M,a:P,b:v}})(),Lt.set(i,c));const{layout:u,a,b:e}=await c,l=[],f=(m,y)=>{const b=i.createBuffer({size:m,usage:y});return l.push(b),b};try{const m=f(t.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),y=f(t.byteLength,GPUBufferUsage.STORAGE),b=f(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),M=f(t.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);i.queue.writeBuffer(m,0,t);const S=new ArrayBuffer(48),P=new Float32Array(S);new Uint32Array(S)[0]=s;const v=n.azimuth*Math.PI/180;P[1]=o/s,P[2]=Math.cos(v),P[3]=Math.sin(v),P[4]=n.transport,i.queue.writeBuffer(b,0,S);const h=i.createBindGroup({layout:u,entries:[m,y,b].map((R,x)=>({binding:x,resource:{buffer:R}}))}),p=Math.ceil(t.length/256),d=Math.ceil(p/i.limits.maxComputeWorkgroupsPerDimension),O=Math.ceil(p/d),U=i.createCommandEncoder(),A=U.beginComputePass();A.setBindGroup(0,h);for(let R=0;R<n.iterations;R++)A.setPipeline(a),A.dispatchWorkgroups(O,d),A.setPipeline(e),A.dispatchWorkgroups(O,d);A.end(),U.copyBufferToBuffer(m,0,M,0,t.byteLength),i.queue.submit([U.finish()]),await M.mapAsync(GPUMapMode.READ);const E=new Float32Array(M.getMappedRange()).slice();return M.unmap(),E}finally{l.forEach(m=>m.destroy())}}const ki=`// FP32 sampling of the retained Rust erosion field.\r
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
`,xt=`// Shared FP32 simplex and FBM kernels.\r
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
`,Si=`// Same noise octaves and physical wavelengths as erosion::mountain.\r
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
`,mn=`// Seeded finite volcanic geometry. Shared by generation and camera sampling.\r
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
`,_i=`// The dedicated third simplex stream matches Rust's shore-noise fork.\r
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
`;async function Mi(r,t,o){o?.("Chargement du moteur Rust/WASM…",{stage:"runtime-download"});const n=await fetch(r);if(!n.ok)throw new Error(`Chargement du moteur Rust/WASM impossible : HTTP ${n.status}.`);const i=n.headers.get("content-encoding"),s=i?0:Number(n.headers.get("content-length")),c=Number.isSafeInteger(s)&&s>0?s:0;let u=0,a=0;const e=(f=!1)=>{const m=performance.now();if(f||m-a>=200){a=m;const y=(u/1048576).toFixed(1),b=(c/1048576).toFixed(1);o?.(c?`Moteur Rust/WASM · ${y} / ${b} Mio reçus`:`Moteur Rust/WASM · ${y} Mio reçus`,{stage:"runtime-download",completed:u,total:c})}};let l=n;if(n.body){const f=n.body.getReader(),m=new Headers(n.headers);i&&(m.delete("content-encoding"),m.delete("content-length")),l=new Response(new ReadableStream({async pull(y){try{const{done:b,value:M}=await f.read();b?(e(!0),o?.("Compilation du moteur Rust/WASM…",{stage:"runtime-compile"}),y.close()):(u+=M.byteLength,e(),y.enqueue(M))}catch(b){y.error(b)}},cancel:y=>f.cancel(y)}),{headers:m,status:n.status,statusText:n.statusText})}else o?.("Compilation du moteur Rust/WASM…",{stage:"runtime-compile"});await t(l),o?.("Moteur Rust/WASM prêt",{stage:"runtime-ready"})}async function vr(r,t=45e3){let o;try{return await Promise.race([r,new Promise((n,i)=>{o=setTimeout(()=>i(new Error("La préparation WebGPU ne répond pas. Réessayez sur CPU ou en mode Automatique.")),t)})])}finally{clearTimeout(o)}}let nt;const Pi=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function bt(){return nt??=(async()=>{const r=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!r)return;const{maxBufferSize:t,maxStorageBufferBindingSize:o}=r.limits,n=await r.requestDevice({requiredFeatures:r.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:t,maxStorageBufferBindingSize:o}}),i={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{i.lost=!0,nt=void 0}),i})().catch(()=>{}),nt}async function zi(r,t){if(r==="wasm")return;const o=await bt();if(!o||o.lost)return;const n=t==="flat"?0:t==="valley"?2:t==="volcano"||t==="caldera"||t==="plateau"?3:1,i=`${r}:${n}`;let s=o.pipelines.get(i);return s||(s=(async()=>{const c=ki.replace("// NOISE_KERNEL",xt).replace("// VOLCANIC_KERNEL",mn).replace("// COAST_KERNEL",_i),u=o.device.createShaderModule({code:c});return o.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),s.catch(()=>{}),o.pipelines.set(i,s)),{context:o,pipeline:s}}const Ui=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Ht(r,t,o){const n=r.device,i=Qe(t).n,s=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),c=t.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=c.map(l=>{const f=`generation:${l}`;let m=r.pipelines.get(f);if(!m){const y=n.createShaderModule({code:Si.replace("// NOISE_KERNEL",xt)});m=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[s]}),compute:{module:y,entryPoint:l}}),r.pipelines.set(f,m)}return m}),a=Tr.generation_at_resolution(t.seed,t.width,t.relief,t.motifSize,i),e=[];try{const l=a.parameters();t.procedural?.regionalN&&(l[2]=t.procedural.regionalN,l[4]=t.width*1.44/l[2]),l[6]*=t.procedural?.noiseScale??1;const f=(v,h)=>{const p=n.createBuffer({size:v.byteLength,usage:h|GPUBufferUsage.COPY_DST});return e.push(p),n.queue.writeBuffer(p,0,v),p},m=[f(l,GPUBufferUsage.UNIFORM),f(a.permutations(),GPUBufferUsage.STORAGE),f(a.gradients(),GPUBufferUsage.STORAGE)];o?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const y=await vr(Promise.all(u));o?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const M=c.map(v=>v==="coarse"?l[2]:l[1]).map((v,h)=>{const p=v*v*16,d=n.createBuffer({size:p,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),O=n.createBuffer({size:p,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});e.push(d,O);const U=n.createBindGroup({layout:y[h].getBindGroupLayout(0),entries:[...m,d].map((R,x)=>({binding:x,resource:{buffer:R}}))}),A=n.createCommandEncoder(),E=A.beginComputePass();return E.setPipeline(y[h]),E.setBindGroup(0,U),E.dispatchWorkgroups(Math.ceil(v/8),Math.ceil(v/8)),E.end(),A.copyBufferToBuffer(d,0,O,0,p),n.queue.submit([A.finish()]),O}),S=n.queue.onSubmittedWorkDone().then(()=>o?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),P=await Promise.all(M.map(async v=>{await v.mapAsync(GPUMapMode.READ);const h=new Float32Array(v.getMappedRange().slice(0));return v.unmap(),h}));return await S,{coarse:c.length===2?P[0]:new Float32Array,fine:P[P.length-1]}}finally{a.free(),e.forEach(l=>l.destroy())}}class It{constructor(t,o,n,i){this.state=t,this.pipeline=o,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=i.sampling_parameters(),this.sourceN=i.source_resolution();let s=0;for(let e=this.sourceN;e>=1;e=Math.floor(e/2))s+=e*e;const c=this.parameters[5]===3?2:1;if(s*c*4>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=i.sampling_field();this.hasField=u.length>0;const a=u.length?u:new Float32Array(1);if(a.byteLength>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(a),this.perm=this.upload(i.sampling_permutations()),this.gradients=this.upload(i.sampling_gradients()),this.branches=this.upload(i.sampling_branches()),this.coast=this.upload(i.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(t,o=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,t.byteLength),usage:o|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,t),n}prepareCoastField(t){return this.dispatchField({x:0,y:0,extent:t.width,resolution:this.sourceN},t),this.output}dispatchField(t,o){const{x:n,y:i,extent:s,resolution:c}=t;if(![n,i,s,c].every(Number.isFinite)||n<0||i<0||s<=0||n+s>o.width+1e-4||i+s>o.width+1e-4||!Number.isInteger(c)||c<16||c>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,a=s/c,e=Math.max(o.motifSize/65536,a*.5),l=this.parameters,f=Math.floor(Math.log2(this.sourceN)),m=Math.min(f,Math.log2(Math.max(1,a*(o.relief==="flat"&&l[5]!==4?2/o.motifSize:1/o.width)*this.sourceN))),y=new Float32Array([l[0],l[1],l[2],l[3],l[4],l[5],this.hasField?1:0,c,n,i,s,a,Math.floor(m),Math.min(f,Math.floor(m)+1),m-Math.floor(m),e,l[6],l[7],this.sourceN,f,...Array.from({length:16},(P,v)=>l[8+v]??0)]),b=c*c*16;b>this.capacity&&(this.output?.destroy(),this.capacity=b,this.output=u.createBuffer({size:b,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((P,v)=>({binding:v,resource:{buffer:P}}))})),u.queue.writeBuffer(this.uniform,0,y);const M=u.createCommandEncoder(),S=M.beginComputePass();S.setPipeline(this.pipeline),S.setBindGroup(0,this.group),S.dispatchWorkgroups(Math.ceil(c/8),Math.ceil(c/8)),S.end(),u.queue.submit([M.finish()])}async sample(t,o,n,i){const s=performance.now(),c=this.state.device,{x:u,y:a,extent:e,resolution:l}=t;this.dispatchField(t,o);const f=l*l*16,m=c.createCommandEncoder();(!this.readback||this.readback.size<f)&&(this.readback?.destroy(),this.readback=c.createBuffer({size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),m.copyBufferToBuffer(this.output,0,this.readback,0,f),c.queue.submit([m.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,f);const y=this.readback.getMappedRange(0,f).slice(0);this.readback.unmap();const b=new Float32Array(y),M=new Float32Array(l*l),S=new Float32Array(l*l),P=new Float32Array(l*l),v=new Float32Array(l*l);let h=1/0,p=-1/0;for(let d=0;d<l*l;d++){const O=d*4;M[d]=b[O],S[d]=b[O+1],P[d]=b[O+2],v[d]=b[O+3],h=Math.min(h,M[d]),p=Math.max(p,M[d])}if(!Number.isFinite(h)||!Number.isFinite(p))throw new Error("Sortie GPU non finie.");return{x:u,y:a,width:e,resolution:l,minHeight:h,maxHeight:p,globalMinHeight:n,globalMaxHeight:i,motifSize:o.motifSize,height:M,normalX:S,normalY:P,normalZ:v,caveMask:new Uint8Array,generationMs:performance.now()-s,backend:this.mode,samplingMs:performance.now()-s}}dispose(){this.buffers.forEach(t=>t.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}const Ci=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`,Ai=`// Inspector-only readout. It never modifies simulation heights or drainage.\r
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
`,Ei=`// Full FP32 regional erosion. Dispatches are global synchronization boundaries.\r
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
`,Fr=new WeakMap,it=new WeakMap,qt=new Set;function Lr(r){r.nodes?.destroy(),r.fine?.destroy(),r.control.destroy()}const Dt=new WeakMap,ot=new WeakMap,$t=new WeakMap,jt=new WeakMap,gn=new WeakSet,Ri=512*1048576,Wt=1024,Ni=1088,at=Ni+4096;function vn(r,t){const o=($t.get(r.device)??Promise.resolve()).then(t);return $t.set(r.device,o.then(()=>{},()=>{})),o}async function Bi(r,t,o,n){let i=Dt.get(r);i||(i=(async()=>{const e=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(b=>({binding:b,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(b=>({binding:b,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),l=r.createShaderModule({code:Ei.replace("// NOISE_KERNEL",xt).replace("// VOLCANIC_KERNEL",mn)+Ci+Ai}),m=(await vr(l.getCompilationInfo())).messages.filter(b=>b.type==="error");if(m.length)throw new Error(m.map(b=>`${b.lineNum}: ${b.message}`).join(`
`));const y=r.createPipelineLayout({bindGroupLayouts:[e]});return{layout:e,module:l,pipelineLayout:y,values:new Map,pending:new Map}})(),Dt.set(r,i)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const s=await vr(i),c=[],u=[...t].reduce((e,l)=>e+(l==="solveTile"?o.size:1),0);let a=0;for(const e of t)for(const l of e==="solveTile"?o:[void 0]){const f=l===void 0?e:`solveTile:${l}`;let m=s.pending.get(f);m||(m=r.createComputePipelineAsync({layout:s.pipelineLayout,compute:{module:s.module,entryPoint:e,...l===void 0?{}:{constants:{SOLVE_MODE:l}}}}),m=m.then(y=>(s.values.set(f,y),y)),s.pending.set(f,m)),c.push(m.then(y=>(a++,n?.(`GPU · shaders d’érosion prêts ${a}/${u}`,{stage:"gpu-erosion-compile",completed:a,total:u}),y)))}return await vr(Promise.all(c)),gn.add(r),s}class Nr extends Error{}class Ti extends Error{}function yn(r,t,o,n,i){const s=Tr.erosion_at_resolution(r.seed,r.width,o,r.erosion,r.motifSize,r.mountainMix,t);try{const c=s.parameters(),u=n?cn(c,r,i):{parameters:c,surface:(i??c.slice(24,32)).slice()};return un(u.parameters,u.surface,r,n,!!i),fn(u.surface,r,t),{noise:s,parameters:u.parameters,surface:u.surface,original:c}}catch(c){throw s.free(),c}}const Gi=["hills","mountains","mixed","high-mountains","valley","canyon"];function Oi(r,t){const o=Qe(t).n,n=Vr(t),i=Gi.includes(t.relief)?t.relief:t.relief==="flat"?"hills":"mixed",{noise:s,parameters:c,surface:u}=yn(t,o,i,n);s.free();const a=c[2],e=u[0],l=u[3],f=Ln(r.device.limits,o,Math.max(a,t.erosion>0&&(!n||l>0)?e:0));return{sourceN:o,regionalN:a,regionalSteps:c[13],surfaceN:e,surfaceSteps:l,pipelinesReady:gn.has(r.device),error:f}}async function Fi(r,t,o,n,i){return vn(r,()=>Li(r,t,o,n,i))}async function Li(r,t,o,n,i){const s=Qe(t).n;for(const c of[1,2,4,8,16])try{return await wn(r,t,s,c,void 0,{source:o,tuning:n},void 0,i)}catch(u){if(!(u instanceof Nr)||c===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function Yt(r,t,o,n){return o?.control?.backend?.("gpu"),vn(r,()=>Hi(r,t,o,n))}async function Hi(r,t,o,n){const i=Qe(t).n;if(t.relief==="volcano"||t.relief==="caldera"||t.relief==="plateau"){const s=Tr.finite_shape(t.seed,t.motifSize,t.relief,t.erosion),c=s.parameters();s.free();const u=t.environment??"mixed",a=t.motifSize*c[15];let e;if(u==="flat"){const m=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),e=_e.prepare_environment_at_resolution(t.seed,t.width,u,t.erosion,a,i),o&&(o.nativeEnvironmentMs=performance.now()-m)}else e=await st(r,{...t,motifSize:a,relief:u,mountainMix:.5},i,void 0,o,n);const l=await st(r,{...t,width:t.motifSize},i,c,o,n),f=new Float32Array(l.length+e.length);return f.set(l),f.set(e,l.length),f}return st(r,t,i,void 0,o,n)}async function st(r,t,o,n,i,s){for(const c of[1,2,4,8,16])try{return await wn(r,t,o,c,n,void 0,i,s)}catch(u){if(!(u instanceof Nr)||c===16)throw u}throw new Error("Érosion GPU non convergée.")}async function wn(r,t,o,n,i,s,c,u){const a=r.device,e=s?void 0:c?.control,l=Vr(t),f=!!t.generalSeed&&dt(t.generalSeed,p=>p.startsWith("relief-"))!==pn(t.generalSeed),{noise:m,parameters:y,surface:b,original:M}=yn(t,o,s||l&&t.relief==="flat"?"hills":i?"mixed":t.relief,l,s?.tuning);let S=ot.get(a);if(!S){S=[],ot.set(a,S);const p=S;a.lost.then(()=>p.forEach(d=>d.destroy()))}const P=!!e&&e.previews!==!1&&o<=Wt;let v=!!e&&e.previews!==!1,h=0;try{l&&t.procedural&&ie(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural.erosionTuning?.detail===void 0&&(y[16]=M[16]);const p=y.slice(0,24),d=p[2],O=p[13],U=p[18],A=s?[1,0,0,.2,1,1,0,0]:Array.from(y.slice(33,41)),E=A.slice();E[4]=1;const R=!s&&A[6]>.5,x=Math.min(n,4),z=p.slice();z[2]=b[0],z[4]=b[1],z[5]=b[2],z[15]=i&&!s?i[13]:b[4],z[18]=b[5],z[22]=b[6];const $=Math.max(1,z[2]/1048),H=Math.ceil(Math.min((i||s||t.relief==="mixed"?64:32)*n,512)*$),N=!s&&ie(t,"phasor",l)?"generationPhasorPack":"packHeight",q=l?"compactInitialize":"initialize",X=!!s||ie(t,"surface",!l||t.relief==="canyon")&&(!l||t.relief==="canyon"||b[3]>0),se=()=>{s||c?.onPhysicalPlan?.(t.erosion>0&&X&&b[3]>0?b[1]:void 0,!i&&t.erosion>0&&(ie(t,"regional")||ie(t,"regionalFinish"))?p[4]:void 0)},K=t.procedural?.reconstruction&&t.procedural.reconstruction!=="default"?"generationReconstruct":l?"compactReconstruct":"reconstruct",re=new Set([N,...ie(t,"amplitude")?[]:["generationUnitScale"],...ie(t,"normalize")?[]:["generationKeepDatum"],...e?["generationPreview"]:[],...!s&&!i&&t.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),ue=new Set,fe=(...g)=>g.forEach(_=>re.add(_));f&&!s&&!i&&fe("generationCut","generationRegionalRead","generationPreview"),(s||!i&&(f||t.procedural))&&fe("seaLandMark","seaMaskGrow");const me=()=>fe("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");s?fe("coastLoad","coastResult"):fe("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!s&&!i?(fe(q,"uplift","bounds",K,"detail"),U>0&&(me(),fe("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(g=>ue.add(g)))):i&&!s&&fe("volcanicInitial"),t.erosion>0&&X&&(me(),fe("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),ue.add(1),ue.add(3),t.relief==="canyon"&&!s&&(fe("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),ue.add(0)),R&&(fe("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),ue.add(0))),e&&await e.before("grids",`Budget ×${n} · régional ${d}² · surface ${z[2]}² · sortie ${o}²`);const Ee=performance.now(),Me=await Bi(a,re,ue,u),Ge=performance.now()-Ee,Ce=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let be=!1;const de=(g,_)=>{const B=h++;let G=S[B];return(!G||G.size<g||G.usage!==_)&&(G?.destroy(),G=a.createBuffer({size:g,usage:_}),S[B]=G,be=!0),G},Ae=g=>{const _=de(g.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return a.queue.writeBuffer(_,0,g),_},Re=t.erosion>0&&X?Math.max(d,z[2]):d,oe=o**2,ve=oe*4,ye=oe*16,Oe=Math.max(oe,d*d)*4;a.pushErrorScope("out-of-memory");const ze=de(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),Fe=de(Re**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),De=de(ye,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ie=de(at,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Le=de(Oe,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),le=de(Oe+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),Ve=de(Math.ceil(Re/16)**2*8,GPUBufferUsage.STORAGE),er=a.popErrorScope();if(be&&await er)throw v=!0,new Ti(`WebGPU : mémoire insuffisante pour la source ${o}² et la grille d’érosion ${Re}².`);v||=S.reduce((g,_)=>g+_.size,0)>Ri;const ur=g=>le.mapAsync(GPUMapMode.READ,0,g),ke=g=>le.getMappedRange(0,g),k=!s&&!i&&!!(t.procedural||f),w=k&&o<=Wt,T=P||k;let Y=T?void 0:jt.get(a);if(!T&&!Y&&a.features.has("timestamp-query")){Y=a.createQuerySet({type:"timestamp",count:6}),jt.set(a,Y);const g=Y;a.lost.then(()=>g.destroy())}const V=Y?de(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,ae=Y?de(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,C=(g,_)=>a.createBindGroup({layout:Me.layout,entries:[{binding:0,resource:{buffer:ze,size:224}},...[Ae(g),Ae(_),Fe,De,Ie,Le,Ve].map((B,G)=>({binding:G+1,resource:{buffer:B}}))]});let F=C(m.permutations(),m.gradients());const ce=new Map([[t.seed,F]]),I=g=>{const _={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[g];if(!_||!t.generalSeed)return;const B=Ye(t.generalSeed,_);let G=ce.get(B);if(!G){const he=Tr.erosion(B,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix);try{G=C(he.permutations(),he.gradients())}finally{he.free()}ce.set(B,G)}F=G},te=new Map;let Z=A;const pe=(g,_)=>{const B=[..._,...g,...Z].join(",");let G=te.get(B);if(G===void 0){if(G=te.size*256,G+224>65536)throw new Error("Too many GPU variants.");te.set(B,G),a.queue.writeBuffer(ze,G,new Float32Array([..._,...g,...l?At(t,!!s):!i&&!s&&ie(t,"phasor",!1)?At(t):i??new Float32Array(16),...Z]))}return G};let J=a.createCommandEncoder();J.clearBuffer(Ie),s&&J.copyBufferToBuffer(s.source,0,De,0,ye);const ne=g=>J.beginComputePass(Y?{timestampWrites:{querySet:Y,beginningOfPassWriteIndex:g,endOfPassWriteIndex:g+1}}:void 0);let j=ne(0);const Q=[0,0,1,0,0,0,.6,0];Q[4]=y[32];const we=[0,0,.95,U*.5,0,0,.5,0];let xe=p;const D=(g,_=Q,B=Math.ceil(xe[2]**2/256),G=1)=>{j.setPipeline(Me.values.get(g==="solveTile"?`solveTile:${_[1]}`:g)),j.setBindGroup(0,F,[pe(_,xe)]),j.dispatchWorkgroups(B,G)},Gr=Math.ceil(oe/256),_t=Math.ceil(Gr/a.limits.maxComputeWorkgroupsPerDimension),Ue=(g,_=Q)=>D(g,_,Math.ceil(Gr/_t),_t),Je=(g,_,B=!1)=>{const G=Q.slice();G[1]=g,G[7]=B?1:0,D(g===0?"floodInit":"graphInit",G),D("start",G,1);const he=[0,1].map(Se=>(G[0]=Se,pe(G,xe)));for(let Se=0;Se<_;Se++){const or=[he[Se&1]];j.setPipeline(Me.values.get("clearNext")),j.setBindGroup(0,F,or),j.dispatchWorkgroups(1),j.setPipeline(Me.values.get(`solveTile:${g}`)),j.dispatchWorkgroups(Math.ceil(xe[2]/16),Math.ceil(xe[2]/16))}G[0]=0,D("solveStats",G,1),g===0?(D("floodCheck",G,1),D("receivers")):D("graphFinish",G)},Jr=(g=Q,_=!0)=>{D("pitInit");for(let B=0;B<8*x+Math.ceil(Math.log2(Math.max(1,xe[2]/1048)));B++)D("pitUnion"),D("pitCompress");for(const B of _?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])D(B,g)},Kr=g=>{if(g<=0)return;const _=Q.slice();_[6]=g,D("breachInit"),D("breach",_),D("breachFinish")},Xr=(g,_=Q)=>{if(!(xe===p&&t.procedural?.regionalThermal===!1))for(let B=0;B<g;B++)for(const G of["thermalFlux","thermalApply","copyHeight"])D(G,_)},Or=(g,_=Q)=>{if(xe===p&&t.procedural?.regionalDiffusion===!1)return;const B=_.slice();B[3]=g,D("diffuse",B),D("copyHeight",B)},Mt=g=>{const _=Hn(In({surfaceSteps:b[3],surfaceCell:b[1],regionalCell:p[4],sourceCell:p[11],warp:A[5]*Math.min(16*p[3],p[4]*.9)}),t.width);if(_===void 0)return;const B=Q.slice();B[7]=g,g===0?D("seaLandMark",B):Ue("seaLandMark",B),B[5]=_,D("seaMaskGrow",B,2)},Pt=g=>{const _=Q.slice();_[4]=g,D("percentileInit",_,1);for(const B of[24,16,8,0])_[5]=B,D("histogramClear",_,1),Ue("histogram",_),D("percentileSelect",_,1)},zt=async(g,_,B)=>{if(!e)return;if(!P){await e.after(g,void 0,B);return}if(_!==3){const or=Q.slice();or[7]=_,Ue("generationPreview",or)}j.end(),J.copyBufferToBuffer(Le,0,le,0,ve),J.copyBufferToBuffer(Ie,0,le,ve,1088),a.queue.submit([J.finish()]),await ur(ve+1088);const G=ke(ve+1088),he=new Uint32Array(G,ve,272)[2],Se=new Float32Array(G,0,oe).slice();if(le.unmap(),he)throw new Nr("Érosion GPU non convergée pendant une étape.");if(!Se.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await e.after(g,Se,B),J=a.createCommandEncoder(),j=ne(0)},fr=yt(t),Mn=Wr(t);let Ne=w?Fr.get(a):void 0;if(w&&!Ne){Ne=new Map,Fr.set(a,Ne),qt.add(a);const g=Ne;a.lost.then(()=>{g.forEach(Lr),g.clear(),qt.delete(a)})}const yr=g=>`${n}|${Mn.get(g)}`;let rr=0;for(;Ne&&rr<fr.length&&Ne.get(fr[rr])?.key===yr(fr[rr]);)rr++;if(Ne)for(const g of[...fr.slice(rr),"phasor"]){const _=Ne.get(g);_&&(g!=="phasor"||_.key!==yr(g)||rr<fr.length)&&(Lr(_),Ne.delete(g))}const Pn=g=>{j.end(),g.nodes&&J.copyBufferToBuffer(g.nodes,0,Fe,0,g.nodes.size),g.fine&&J.copyBufferToBuffer(g.fine,0,De,0,g.fine.size),J.copyBufferToBuffer(g.control,0,Ie,0,at),j=ne(0)},zn=(g,_)=>{if(!Ne)return;j.end();const B=(he,Se=he.size)=>{const or=a.createBuffer({size:Se,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return J.copyBufferToBuffer(he,0,or,0,Se),or},G=Ne.get(g);G&&Lr(G),Ne.set(g,{key:yr(g),kind:_,..._===0?{nodes:B(Fe,d*d*112)}:{fine:B(De,ye)},control:B(Ie,at)}),a.queue.submit([J.finish()]),J=a.createCommandEncoder(),j=ne(0)},Un=async(g,_)=>{if(!e)return;if(!P){e.cached?await e.cached(g):(await e.before(g),await e.after(g));return}const B=Q.slice();B[7]=_.kind,Ue("generationPreview",B),j.end(),J.copyBufferToBuffer(Le,0,le,0,ve),a.queue.submit([J.finish()]),await ur(ve);const G=new Float32Array(ke(ve),0,oe).slice();le.unmap(),e.cached?await e.cached(g,G):(await e.before(g),await e.after(g,G)),J=a.createCommandEncoder(),j=ne(0)},Ke=async(g,_,B)=>{const G=fr.indexOf(g),he=Ne?.get(g);if(he&&G>=0&&G<rr){(P||G===rr-1)&&Pn(he),await Un(g,he);return}await e?.before(g),I(g),await B(),zn(g,_),await zt(g,_)},Cn=t.procedural?.coastAfter??"initialize",dr=async(g,_)=>{!k||g!==Cn||await Ke("coastCut",_===4?5:_,async()=>{if(!ut(t,"coastCut"))return;const B=Q.slice();B[7]=_,_===0?D("generationRegionalRead",B,Math.ceil(d*d/256)):Ue("generationPreview",B),j.end();const G=_===0?d*d:oe;J.copyBufferToBuffer(Le,0,le,0,G*4),a.queue.submit([J.finish()]),await ur(G*4);const he=new Float32Array(ke(G*4),0,G).slice();le.unmap();const Se=dn.cut_field(Ye(t.generalSeed??t.seed,"relief-coast-cut"),t.width,y[3]*2400,y[12],t.coastMask,t.islandMode??"island",_===0?d:o,_===0?p[5]:0,_===0?p[4]:p[11],he);a.queue.writeBuffer(Le,0,Se),J=a.createCommandEncoder(),j=ne(0),_===0?D("generationCut",B,Math.ceil(d*d/256)):Ue("generationCut",B),Mt(_)})};e&&await e.after("grids",void 0,`Budget ×${n} · régional ${d}² · surface ${z[2]}² · ${(S.reduce((g,_)=>g+_.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${O} cycles de relief et ${b[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),s?(xe=z,Ue("coastLoad"),Mt(2)):i?(e&&await e.before("initialize"),xe=z,Ue("volcanicInitial"),e&&await zt("initialize",2)):(await Ke("initialize",0,()=>{D(q)}),await dr("initialize",0),await Ke("regional",0,()=>{for(let g=0;g<(ie(t,"regional")?O:0);g++){if(D("uplift"),U>0){Je(0,64*x),Jr(),D("flow"),Kr(A[1]),Je(1,128*x),Je(2,128*x),Xr(3);const _=p[17]*3*U;for(let B=0;B<Math.floor(_);B++)Or(.5);_%1>0&&Or(.5*(_%1))}D("bounds")}}),await Ke("regionalFinish",0,()=>{const g=Q.slice();if(g[7]=1,D("bounds",g),U>0&&ie(t,"regionalFinish")){Xr(4,we);for(let _=0;_<6;_++)Je(0,64*x),Jr(we),D("flow"),Kr(A[2]);Or(U*.5,we)}}),await dr("regionalFinish",0),await Ke("reconstruct",1,()=>{const g=Q.slice();g[7]=t.procedural?.reconstruction==="bspline"?1:0,Ue(K,g)}),await Ke("amplitude",4,()=>{ie(t,"amplitude")?Pt(0):D("generationUnitScale",Q,1)}),await dr("amplitude",4),await Ke("ridged",2,()=>{Ue("detail")}),await dr("ridged",2)),j.end(),j=ne(2),await Ke("surface",2,()=>{if(t.erosion>0&&X){if(xe=z,Z=E,D("surfaceLoad"),t.relief==="canyon"&&!s){const g=Math.ceil(128*x*$);Je(0,g),D("flow"),Je(1,g),D("canyonSeed");let _=0;const B=[];for(let he=2**(Math.ceil(Math.log2(z[2]))-1);he>=1;he/=2)B.push(he);B.push(1,1);for(const he of B){const Se=Q.slice();Se[0]=_,Se[1]=he,D("canyonSpread",Se),_=1-_}const G=Q.slice();G[0]=_,D("canyonApply",G)}for(let g=0;g<b[3];g++)R?(Je(0,H),Jr(Q,!1),D("flow"),Kr(A[7])):(D("surfaceFlowInit"),D("receivers"),D("flow")),Je(1,H,!0),Je(3,H,!0),Xr(1),Or(b[7]);D("surfaceDelta"),Ue("surfaceReconstruct")}}),await dr("surface",2),j.end(),j=ne(4),await Ke("normalize",1,()=>{s?Ue("coastResult"):ie(t,"normalize")?(Pt(1),Ue("normalize")):Ue("generationKeepDatum")}),await dr("normalize",1);let wr=it.get(a);wr||(wr=new vt,it.set(a,wr));const xr=w?wr.get("phasor",yr("phasor")):void 0;if(xr)return j.end(),a.queue.submit([J.finish()]),e?.cached?await e.cached("phasor",P?xr:void 0):(await e?.before("phasor"),await e?.after("phasor",xr)),se(),xr;xr||await e?.before("phasor"),Ue(N),j.end();const br=ve;J.copyBufferToBuffer(Le,0,le,0,br),J.copyBufferToBuffer(Ie,0,le,br,1088),Y&&V&&ae&&(J.resolveQuerySet(Y,0,6,V,0),J.copyBufferToBuffer(V,0,ae,0,48));const An=J.finish(),En=performance.now()-Ce;u?.(s?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const Rn=performance.now();a.queue.submit([An]);const Nn=a.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([ur(br+1088),ae?.mapAsync(GPUMapMode.READ),Nn]);const Bn=performance.now()-Rn,Tn=performance.now(),Ut=ke(br+1088),Zr=new Uint32Array(Ut,br,272),Gn=Array.from(Zr.slice(267,271)),Qr={factor:n,sourceSize:o,coarseSize:d,surfaceSize:z[2],pipelineMs:Ge,encodeMs:En,submitReadbackMs:Bn,unpackMs:0,maxSolveSteps:Gn,allocatedBytes:S.reduce((g,_)=>g+_.size,0)};if(ae){const g=new BigUint64Array(ae.getMappedRange());Qr.gpuStagesMs={coarse:Number(g[1]-g[0])/1e6,surface:Number(g[3]-g[2])/1e6,normalization:Number(g[5]-g[4])/1e6},ae.unmap()}if(c&&(c.profiles??=[]).push(Qr),Zr[2]!==0)throw le.unmap(),new Nr(`Érosion GPU non convergée (${Zr[2]} cellules/étapes, budget ×${n}).`);const kr=new Float32Array(Ut,0,oe).slice();le.unmap(),Qr.unpackMs=performance.now()-Tn;const On=s||k&&ut(t,"coastCut")?-1/0:.3-1e-7;for(let g=0;g<oe;g++)if(!Number.isFinite(kr[g])||kr[g]<On)throw new Error("Champ GPU invalide.");return se(),w&&wr.put("phasor",yr("phasor"),kr),e&&await e.after("phasor",P?kr:void 0,"Sortie GPU lue et validée"),kr}catch(p){throw p instanceof Nr&&(Fr.get(a)?.forEach(Lr),Fr.get(a)?.clear(),it.delete(a)),p}finally{m.free(),S.forEach(p=>{p.mapState!=="unmapped"&&p.unmap(),v&&p.destroy()}),v&&ot.delete(a)}}const Ii=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`,qi=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],Vt=new WeakMap,Jt=new WeakMap;function Di(r){let t=Vt.get(r);return t||(t=(async()=>{const o=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(a=>({binding:a,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(a=>({binding:a,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=r.createShaderModule({code:Ii}),s=(await n.getCompilationInfo()).messages.filter(a=>a.type==="error");if(s.length)throw new Error(`Hydrologie WGSL : ${s.map(a=>`${a.lineNum}: ${a.message}`).join(`
`)}`);const c=r.createPipelineLayout({bindGroupLayouts:[o]}),u=await Promise.all(qi.map(async a=>[a,await r.createComputePipelineAsync({layout:c,compute:{module:n,entryPoint:a}})]));return{layout:o,values:new Map(u)}})(),Vt.set(r,t)),t}function $i(r){let t=2166136261;for(let o=0;o<r.length;o++)t=Math.imul(t^r.charCodeAt(o),16777619);return t>>>0}function ji(r,t,o){const n=new Uint32Array(r.length);if(!o)return{mask:n,count:0};const i=new Uint8Array(r.length),s=new Uint32Array(r.length);let c=0,u=0,a=0;const e=f=>{i[f]===0&&r[f]<=0&&(i[f]=1,s[u++]=f)},l=f=>{if(i[f]!==0||r[f]>0)return;c=0,u=0,e(f);let m=!1;for(;c<u;){const y=s[c++],b=y%t,M=Math.floor(y/t);m||=b+1<t&&M+1<t&&r[y+1]<=0&&r[y+t]<=0&&r[y+t+1]<=0;for(let S=-1;S<=1;S++){const P=M+S;if(!(P<0||P>=t))for(let v=-1;v<=1;v++){const h=b+v;h>=0&&h<t&&e(P*t+h)}}}if(m){for(let y=0;y<u;y++)n[s[y]]=1;a+=u}};for(let f=0;f<t;f++)l(f),l((t-1)*t+f);for(let f=1;f+1<t;f++)l(f*t),l(f*t+t-1);return{mask:n,count:a}}class Wi{constructor(t,o,n){this.device=t,this.n=o,this.program=n,this.buffers=[],this.pending=Promise.resolve();const i=o*o,s=(u,a)=>{const e=t.createBuffer({size:u,usage:a});return this.buffers.push(e),e};this.uniform=s(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=s(i*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=s(i*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const c=s(i*48,GPUBufferUsage.STORAGE);this.control=s(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=s(i*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=s(i*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=s(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=t.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,c,this.control,this.output].map((u,a)=>({binding:a+1,resource:{buffer:u}}))]}),t.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(t,o,n,i){const s=this.pending.then(()=>this.execute(t,o,n,i));return this.pending=s.then(()=>{},()=>{}),s}async execute(t,o,n,i){const s=performance.now(),c=this.n,u=c*c,a=o/c,e=ji(t,c,i),l=performance.now()-s,f=this.device;f.queue.writeBuffer(this.source,0,t),f.queue.writeBuffer(this.sea,0,e.mask);for(let N=0;N<2;N++){const q=new ArrayBuffer(32);new Uint32Array(q,0,4).set([c,$i(n),N,i?1:0]),new Float32Array(q,16,4).set([a,a*a,Math.max(.1,a*.1),0]),f.queue.writeBuffer(this.uniform,N*256,q)}const m=(N,q,X=0)=>{N.setPipeline(this.program.values.get(q)),N.setBindGroup(0,this.group,[X*256]),q==="solveTile"?N.dispatchWorkgroups(Math.ceil(c/16),Math.ceil(c/16)):N.dispatchWorkgroups(q==="reset"||q==="clearNext"?1:Math.ceil(u/256))},y=performance.now(),b=f.createCommandEncoder(),M=b.beginComputePass();m(M,"reset"),m(M,"initialize"),M.end(),f.queue.submit([b.finish()]);let S=0,P=!1,v=32;const h=Math.max(256,c);for(;S<h;){const N=f.createCommandEncoder(),q=N.beginComputePass();for(let se=0;se<v;se++){const K=S+se&1;m(q,"clearNext",K),m(q,"solveTile",K)}q.end(),N.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),f.queue.submit([N.finish()]),S+=v,v=Math.min(v*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const X=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),X===0){P=!0;break}}if(!P)throw new Error(`Drainage hydrique GPU non convergé après ${S} passes (${c}²) ; repli CPU requis.`);const p=f.createCommandEncoder(),d=p.beginComputePass();m(d,"receivers");const O=Math.ceil(Math.log2(u));for(let N=0;N<O;N++){const q=N&1;m(d,"accumulateCopy",q),m(d,"accumulateScatter",q)}m(d,"finish",O&1),d.end();const U=u*16;p.copyBufferToBuffer(this.output,0,this.readback,0,U),p.copyBufferToBuffer(this.control,0,this.readback,U,16),f.queue.submit([p.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const A=performance.now()-y,E=performance.now();let R,x,z,$;try{const N=this.readback.getMappedRange(),q=new Uint32Array(N,U,4);if(q[2]!==0||q[3]!==u-e.count)throw new Error(`Drainage hydrique GPU invalide (${q[2]} erreurs, ${q[3]}/${u-e.count} cellules drainées) ; repli CPU requis.`);const X=new Float32Array(N,0,u*4),se=new Uint32Array(N,0,u*4);R=new Float32Array(u),x=new Uint32Array(u),z=new Float32Array(u),$=new Float32Array(u);for(let K=0;K<u;K++)R[K]=X[K*4],x[K]=se[K*4+1],z[K]=X[K*4+2],$[K]=X[K*4+3]}finally{this.readback.unmap()}const H=new Uint8Array(e.mask);return{filled:R,receivers:x,accumulation:z,potential:$,seaMask:H,preprocessingMs:l,computeMs:A,readbackMs:performance.now()-E,floodPasses:S}}}async function Yi(r,t,o,n,i=!1){if(![256,512,1024].includes(o)||r.length!==o*o||!Number.isFinite(t)||t<=0||!r.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const s=await bt();if(!s||s.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const c=await Di(s.device);if(s.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=Jt.get(s.device);u||(u=new Map,Jt.set(s.device,u));let a=u.get(o);return a||(a=new Wi(s.device,o,c),u.set(o,a)),a.run(r,t,n,i)}const Kt=new WeakMap;function Vi(r){const t=Kt.get(r);if(t)return t;const o=new Float32Array(r.baseHeight.length),n=[],i=v=>r.drainageHeight[v]<r.rawDrainageHeight[v]&&r.surfaceHeight[v]<r.baseHeight[v];let s=!1;for(let v=0;v<o.length;v++){const h=i(v);h&&n.push(v),o[v]=h?0:r.surfaceHeight[v]-r.baseHeight[v],s||=o[v]!==0}const c=256,u=r.width/c,a=new Map,e=[],l=r.riverPoints,f=new Map,m=[],y=r.resolution,b=r.width/y,M=v=>Math.min(b*2,Math.max(b*.5,(r.baseHeight[v]-r.surfaceHeight[v])*1.4)),S=v=>((Math.imul(v^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const v of n){const h=v%y,p=Math.floor(v/y),d=(h+.5)*b,O=(p+.5)*b,U=[];for(let A=-1;A<=1;A++)for(let E=-1;E<=1;E++){const R=h+E,x=p+A,z=x*y+R;if(!E&&!A||R<0||x<0||R>=y||x>=y)continue;const $=i(z);($&&z>v||!$&&r.basins[z]&&r.surfaceHeight[z]<=r.surfaceHeight[v])&&U.push(z)}U.length||U.push(v);for(const A of U){const E=(A%y+.5)*b,R=(Math.floor(A/y)+.5)*b,x=m.length,z=M(v),$=M(A),H=S(v),N=Math.max(z,$)*(1+Math.abs(H));m.push({a:v,b:A,ra:z,rb:$,skew:H});const q=Pe(Math.min(d,E)-N,u,c),X=Pe(Math.max(d,E)+N,u,c),se=Pe(Math.min(O,R)-N,u,c),K=Pe(Math.max(O,R)+N,u,c);for(let re=se;re<=K;re++)for(let ue=q;ue<=X;ue++){const fe=re*c+ue,me=f.get(fe);me?me.push(x):f.set(fe,[x])}}}if(r.incision>0)for(let v=0;v<r.riverCount;v++)for(let h=r.riverOffsets[v];h+1<r.riverOffsets[v+1];h++){const p=h+1,d=Math.max(l[h*4+2],l[p*4+2])*.65+.5,O=e.length;e.push({a:h,b:p,estuary:r.riverMeta[v*6+5]});const U=Pe(Math.min(l[h*4],l[p*4])-d,u,c),A=Pe(Math.max(l[h*4],l[p*4])+d,u,c),E=Pe(Math.min(l[h*4+1],l[p*4+1])-d,u,c),R=Pe(Math.max(l[h*4+1],l[p*4+1])+d,u,c);for(let x=E;x<=R;x++)for(let z=U;z<=A;z++){const $=x*c+z,H=a.get($);H?H.push(O):a.set($,[O])}}const P={delta:o,hasDelta:s,hasSea:r.basins.includes(0),buckets:a,segments:e,bucketSize:u,side:c,notchBuckets:f,notches:m};return Kt.set(r,P),P}const Pe=(r,t,o)=>Math.max(0,Math.min(o-1,Math.floor(r/t)));function Xt(r,t,o,n,i){const s=new Int32Array(o*4),c=new Float64Array(o*4);for(let u=0;u<o;u++){const a=Math.max(0,Math.min(i-1,(r+(u+.5)*t)/n-.5)),e=Math.floor(a),l=a-e,f=1-l;for(let m=0;m<4;m++)s[u*4+m]=Math.max(0,Math.min(i-1,e+m-1));c.set([f**3/6,(3*l**3-6*l*l+4)/6,(-3*l**3+3*l*l+3*l+1)/6,l**3/6],u*4)}return{indices:s,weights:c}}function xn(r,t,o=!0){const n=r.resolution,i=r.width/n,s=Vi(t);if(!s.hasDelta&&!s.segments.length&&!s.notches.length)return;const c=o?new Float32Array(n*n):void 0;if(s.hasDelta){const h=t.resolution,p=t.width/h,d=Xt(r.x,i,n,p,h),O=Xt(r.y,i,n,p,h),U=O.indices[0],A=O.indices[O.indices.length-1],E=new Float64Array((A-U+1)*n);for(let R=U;R<=A;R++){const x=R*h,z=(R-U)*n;for(let $=0;$<n;$++){const H=$*4;E[z+$]=s.delta[x+d.indices[H]]*d.weights[H]+s.delta[x+d.indices[H+1]]*d.weights[H+1]+s.delta[x+d.indices[H+2]]*d.weights[H+2]+s.delta[x+d.indices[H+3]]*d.weights[H+3]}}for(let R=0;R<n;R++)for(let x=0;x<n;x++){const z=R*4;let $=E[(O.indices[z]-U)*n+x]*O.weights[z]+E[(O.indices[z+1]-U)*n+x]*O.weights[z+1]+E[(O.indices[z+2]-U)*n+x]*O.weights[z+2]+E[(O.indices[z+3]-U)*n+x]*O.weights[z+3];if($>0&&s.hasSea&&r.height[R*n+x]<=0){const H=Math.max(0,Math.min(h-1,Math.floor((r.x+(x+.5)*i)/p))),N=Math.max(0,Math.min(h-1,Math.floor((r.y+(R+.5)*i)/p))),q=N*h+H;(!t.basins[q]||t.baseHeight[q]>=0)&&($=0)}c&&(c[R*n+x]=$),r.height[R*n+x]+=$}}const u=new Set,{bucketSize:a,side:e}=s;for(let h=Pe(r.y,a,e);h<=Pe(r.y+r.width,a,e);h++)for(let p=Pe(r.x,a,e);p<=Pe(r.x+r.width,a,e);p++)for(const d of s.buckets.get(h*e+p)??[])u.add(d);const l=new Float32Array(n*n),f=t.riverPoints,m=(h,p)=>Math.max(0,Math.min(n-1,Math.floor((h-p)/i))),y=new Set;for(let h=Pe(r.y,a,e);h<=Pe(r.y+r.width,a,e);h++)for(let p=Pe(r.x,a,e);p<=Pe(r.x+r.width,a,e);p++)for(const d of s.notchBuckets.get(h*e+p)??[])y.add(d);const b=t.resolution,M=t.width/b,S=M*.25;for(const h of y){const{a:p,b:d,ra:O,rb:U,skew:A}=s.notches[h],E=Math.max(O,U)*(1+Math.abs(A)),R=(p%b+.5)*M,x=(Math.floor(p/b)+.5)*M,z=(d%b+.5)*M,$=(Math.floor(d/b)+.5)*M,H=z-R,N=$-x,q=H*H+N*N,X=Math.min(R,z)-E,se=Math.max(R,z)+E,K=Math.min(x,$)-E,re=Math.max(x,$)+E;if(se<r.x||X>r.x+r.width||re<r.y||K>r.y+r.width)continue;const ue=Math.abs(N)>1e-12,fe=ue?E*Math.sqrt(q)/Math.abs(N):0;for(let me=m(K,r.y);me<=m(re,r.y);me++){const Ee=r.y+(me+.5)*i,Me=ue?R+H*(Ee-x)/N:0,Ge=ue?Math.max(X,Me-fe):X,Ce=ue?Math.min(se,Me+fe):se;if(!(Ge>Ce||Ce<r.x||Ge>r.x+r.width))for(let be=m(Ge,r.x);be<=m(Ce,r.x);be++){const de=r.x+(be+.5)*i,Ae=q?Math.max(0,Math.min(1,((de-R)*H+(Ee-x)*N)/q)):0,Re=Math.hypot(de-R-H*Ae,Ee-x-N*Ae),oe=S+(O+(U-O)*Ae-S)*(1+A*Math.sign((de-R)*N-(Ee-x)*H));if(Re>=oe)continue;const ve=Math.max(0,(Re-S)/(oe-S)),ye=1-ve*ve*(3-2*ve),Oe=t.surfaceHeight[p]+(t.surfaceHeight[d]-t.surfaceHeight[p])*Ae,ze=me*n+be;l[ze]=Math.max(l[ze],Math.max(0,r.height[ze]-Oe)*ye)}}}for(const h of u){const{a:p,b:d,estuary:O}=s.segments[h],U=f[p*4],A=f[p*4+1],E=f[d*4],R=f[d*4+1],x=f[p*4+2],z=f[d*4+2],$=f[p*4+3],H=f[d*4+3],N=Math.max(Math.max(x,z)*.65,.5),q=E-U,X=R-A,se=q*q+X*X,K=Math.min(U,E)-N,re=Math.max(U,E)+N,ue=Math.min(A,R)-N,fe=Math.max(A,R)+N;if(re<r.x||K>r.x+r.width||fe<r.y||ue>r.y+r.width)continue;const me=m(ue,r.y),Ee=m(fe,r.y),Me=Math.abs(X)>1e-12,Ge=Me?N*Math.hypot(q,X)/Math.abs(X):0;for(let Ce=me;Ce<=Ee;Ce++){const be=r.y+(Ce+.5)*i,de=Me?U+q*(be-A)/X:0,Ae=Me?Math.max(K,de-Ge):K,Re=Me?Math.min(re,de+Ge):re;if(Ae>Re||Re<r.x||Ae>r.x+r.width)continue;const oe=m(Ae,r.x),ve=m(Re,r.x);for(let ye=oe;ye<=ve;ye++){const Oe=r.x+(ye+.5)*i,ze=Math.max(0,Math.min(1,((Oe-U)*q+(be-A)*X)/Math.max(se,.001))),Fe=x+(z-x)*ze,De=$+(H-$)*ze,Ie=Math.hypot(Oe-U-q*ze,be-A-X*ze),Le=Math.max(0,1-Ie/Math.max(Fe*.65,.5))**2;if(!Le)continue;const le=Math.max(.35,Math.min(12,Fe*.11))*t.incision,Ve=Ce*n+ye,er=Math.max(0,Math.min(le*2+.75,r.height[Ve]-(De-le)))*Le*(O>1&&De<le?1.15:1);l[Ve]=Math.max(l[Ve],er)}}}let P=1/0,v=-1/0;for(let h=0;h<n*n;h++)r.height[h]-=l[h],c&&(c[h]-=l[h]),P=Math.min(P,r.height[h]),v=Math.max(v,r.height[h]);if(c)for(let h=0;h<n;h++)for(let p=0;p<n;p++){const d=h*n+p,O=Math.max(0,p-1),U=Math.min(n-1,p+1),A=Math.max(0,h-1),E=Math.min(n-1,h+1),R=c[h*n+U]-c[h*n+O],x=c[E*n+p]-c[A*n+p];if(R===0&&x===0)continue;const z=Math.max(1e-6,r.normalZ[d]),$=-r.normalX[d]/z+R/((U-O)*i||i),H=-r.normalY[d]/z+x/((E-A)*i||i),N=Math.hypot($,H,1);r.normalX[d]=-$/N,r.normalY[d]=-H/N,r.normalZ[d]=1/N}r.minHeight=P,r.maxHeight=v}const lt=new Float32Array(0);function Zt(r,t){const o={...r,normalX:lt,normalY:lt,normalZ:lt};xn(o,t,!1),r.minHeight=o.minHeight,r.maxHeight=o.maxHeight}const Ji=(r,t)=>r.riverArea>0?r.riverArea:Math.max(.02,.003*(t/1e3)**2);class kt{constructor(t,o,n,i,s,c){this.engine=t,this.baseHeight=o,this.backend=n,this.backendReason=i,this.drainageMs=s,this.gpu=c}static async create(t,o,n,i,s,c){const u=performance.now();let a,e,l;if(s!=="cpu")try{const m=await Yi(i,o,n,t,c);a=Et.with_drainage(t,o,n,i,c,m.filled,m.receivers,m.accumulation),l=m}catch(m){e=`GPU hydrology unavailable: ${m instanceof Error?m.message:String(m)}`}const f=a?"gpu-f32":"cpu";return a??=new Et(t,o,n,i,c),new kt(a,i,f,e,performance.now()-u,l)}generate(t,o){const n=performance.now(),i=this.engine.generate(t.main,t.density,t.wetness,t.lakes,t.meanders,t.meanderIntensity,t.estuary,t.widthScale,t.incision,t.minLakeArea,t.lakeAbundance,t.lakeCoverage,t.maxLakeArea,t.depressionPolicy,t.maxBreachDepth,t.maxBreachLength,t.minLakeDepth,o.temperature,o.precipitation,t.coastalStreams);try{const s=i.stage_ms,c=i.stage_labels?Object.fromEntries(i.stage_labels.split(",").map((S,P)=>[S,s[P]])):void 0,u=i.basins;let a=0,e=0;for(const S of u)a=Math.max(a,S),S&&e++;const l=i.river_offsets,f=i.lake_meta,m=i.lake_closed;let y=0;for(let S=2;S<f.length;S+=6)y+=f[S];const b=i.river_meta;let M=!1;for(let S=4;S<b.length;S+=6)M||=(b[S]&2)!==0;return{width:i.width,resolution:i.resolution,receivers:i.receivers,accumulation:i.accumulation,basins:u,rawReceivers:i.raw_receivers??i.receivers,rawAccumulation:i.raw_accumulation??i.accumulation,rawBasins:i.raw_basins??u,flatLabels:i.flat_labels??new Uint32Array(u.length),flatRank:i.flat_rank??new Uint32Array(u.length),externalInflowArea:i.external_inflow_area??0,rawFilled:i.raw_filled??i.filled,rawDrainageHeight:i.raw_drainage_height??i.drainage_height,breachCount:i.breach_count??0,breachCutVolumeM3:i.breach_cut_volume_m3??0,avoidedFillVolumeM3:i.avoided_fill_volume_m3??0,filled:i.filled,lakeDepth:i.lake_depth,lakeLabels:i.lake_labels,baseHeight:this.baseHeight,drainageHeight:i.drainage_height,surfaceHeight:i.surface_height,adjustedHeight:i.adjusted_height,riverPoints:i.river_points,riverOffsets:l,riverMeta:b,riverFlare:i.river_flare,lakePoints:i.lake_points,lakeOffsets:i.lake_offsets,lakeMeta:f,lakeRingMeta:i.lake_ring_meta,lakeClosed:m,waterField:i.water_field,closedLakeCount:m.reduce((S,P)=>S+P,0),nodePoints:i.node_points,nodeMeta:i.node_meta,riverCount:l.length-1,lakeCount:f.length/6,basinCount:a,lakeFraction:y/Math.max(1,e*(i.width/i.resolution)**2),incision:t.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&t.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(t.main)&&!M?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-n,stageMs:c,generationMs:this.drainageMs+performance.now()-n,routingPotential:t.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{i.free()}}dispose(){this.engine.free()}}let Qt="",Hr,gt="",cr,en="";function bn(r,t){if(new URL(r).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const o=r+(t?.runtimeSha256??"")+(t?.runtimeJsSha256??"");return(Qt!==o||!Hr)&&(Qt=o,Hr=(async()=>{if(t){const{javascript:s,wasm:c}=await $n(r,t),u=URL.createObjectURL(new Blob([s],{type:"text/javascript"}));try{const a=await import(u);return await a.default({module_or_path:c}),a}finally{URL.revokeObjectURL(u)}}const i=await import(new URL("magna_urbis_neural_wasm.js",r).href);return await i.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",r)}),i})().catch(n=>{throw Hr=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Hr}async function St(){if(cr){try{(await cr).free()}catch{}cr=void 0,gt=""}}async function Ki(r,t,o,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:i}=await qn(r),s=[i.runtimeSha256,...Rt.map(a=>i.models[a].sha256)].join(":");(gt!==r+s||!cr)&&(await St(),gt=r+s,cr=(async()=>{const a=await bn(r,i);en=s;const e=[];for(const l of Rt){const f=i.models[l];n?.(`Neuronal WASM · ${l} · ${(f.bytes/1e6).toFixed(1)} Mo`),e.push(await Dn(r,i,l,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),a.NeuralRelief.create(e[0],e[1],e[2])})().catch(a=>{throw cr=void 0,a}));const c=await cr;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await c.generate_json(JSON.stringify(Object.fromEntries(t)),o?JSON.stringify(o):"");try{const a=new Float32Array(u.heights),e=JSON.parse(u.meta),l=Number(t.get("extent")??4e4),f=Number(t.get("resolution")??Math.ceil(l/Number(t.get("sampleSpacing")??30))),m=e.resolution;if(e.extent!==l||e.nativeCellM!==30||e.nativeResolution!==Math.ceil(l/30)||typeof m!="number"||!Number.isInteger(m)||m!==f||a.length!==m*m||e.outputCellM!==l/m||a.some(y=>!Number.isFinite(y)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:a,meta:{...e,modelIdentity:en}}}finally{u.free()}}let rn;async function kn(r,t,o,n){rn??=wt();const{seed:i,width:s,motifSize:c,relief:u,erosion:a,mountainMix:e,environment:l,zones:f,erosionTuning:m,sketch:y,source:b}=r,M=y?.processing,S=Qe(r),P={seed:i,width:s,motifSize:c,relief:u,erosion:a,mountainMix:e,environment:l,zones:f,erosionTuning:m,sampleSpacing:S.requestedSpacing,sourceN:S.n,coastMask:r.coastMask??0,islandMode:r.islandMode??"island",source:b,...M?{sketch:{processing:M},surface:Array.from(Dr(gr(y),S.n))}:{}},h=await(await Br(t,"/terrain",JSON.stringify({session:rn,settings:P,region:o,field:n}))).arrayBuffer();if(h.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const p=new DataView(h).getUint32(0,!0);if(p%4||4+p>h.byteLength)throw new Error("En-tête terrain local invalide.");const d=JSON.parse(new TextDecoder().decode(new Uint8Array(h,4,p)));let O=4+p;const U={};for(const R of d.arrays){const x=R.count*(R.type==="f32"?4:1);if(!Number.isSafeInteger(R.count)||R.count<0||O+x>h.byteLength)throw new Error("Raster terrain local incomplet.");U[R.name]=R.type==="f32"?new Float32Array(h,O,R.count):new Uint8Array(h,O,R.count),O+=x}const A=U.height,E=d.resolution*d.resolution;if(!Number.isInteger(d.resolution)||d.resolution<64||d.resolution>1024||!A||A.length!==E||!A.every(Number.isFinite)||["normalX","normalY","normalZ"].some(R=>U[R]?.length!==E))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(d.fieldFloor)||!Number.isInteger(d.fieldN)||d.fieldN!==S.n||U.field?.length!==d.fieldN*d.fieldN||!U.field.every(Number.isFinite)||U.physical?.length!==d.fieldN*d.fieldN||!U.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:d.session,x:d.x,y:d.y,width:d.width,resolution:d.resolution,minHeight:d.minHeight,maxHeight:d.maxHeight,globalMinHeight:d.globalMinHeight,globalMaxHeight:d.globalMaxHeight,motifSize:d.motifSize,height:A,normalX:U.normalX,normalY:U.normalY,normalZ:U.normalZ,caveMask:U.caveMask,prepareMs:d.prepareMs,samplingMs:d.samplingMs,generationMs:d.prepareMs+d.samplingMs,generationBackend:"native",generationReason:d.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${d.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:d.erosionDefaults,...U.field?{field:{n:d.fieldN,data:U.field,exact:d.fieldExact,floor:d.fieldFloor,...U.physicalCave?{cave:U.physicalCave}:{}}}:{},...U.physical?{physical:{n:d.fieldN,height:U.physical}}:{},definition:S}}function Xi(r){if(r.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return kn(r.settings,r.runtime,r.region,r.kind==="overview")}async function Zi(r,t){const o=await kn(r,t,{x:0,y:0,extent:r.width,resolution:64},!0);if(!o.field||o.field.data.length!==Qe(r).n**2)throw new Error("Surface physique native absente.");return{height:o.field.data,prepareMs:o.prepareMs??0,samplingMs:o.samplingMs??0,session:o.session,fieldExact:o.field.exact,erosionDefaults:o.erosionDefaults}}const Qi="[relief_session_missing]",tn=r=>Array.from(r,t=>Number.isFinite(t)?t:null),eo=r=>new Uint8Array(r.buffer,r.byteOffset,r.byteLength);class lr{constructor(t,o){this.runtime=t,this.tuning=o,this.session=wt(),this.steps=[],this.released=!1}static async build(t,o,n,i){const s=new lr(t,i.slice());return await s.mutate({op:"build",...o},n),s}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,t=>t??NaN)}editSurface(t){return this.mutate({op:"edit"},t)}coast(t,o,n,i){return this.mutate({op:"coast",mask:t,mode:o,surface:!!i,...n?{tuning:tn(n)}:{}},i)}carveUnderdark(t,o){return this.mutate({op:"underdark",seed:t,...o!==void 0?{tunnels:o}:{}})}async sampleRegion(t,o,n,i){const{meta:s,arrays:c}=await this.send({op:"read",region:{x:t,y:o,extent:n,resolution:i}}),u=s.region,a=c.height;if(!u||!a||a.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:a,cave_mask:c.caveMask,normal_x:c.normalX,normal_y:c.normalY,normal_z:c.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}async underdarkTunnels(){return(await this.send({op:"read",tunnels:!0})).arrays.tunnels??new Float32Array(0)}free(){this.released||(this.released=!0,this.steps.length=0,Br(this.runtime,"/release",JSON.stringify({session:this.session})).then(t=>t.arrayBuffer(),()=>{}))}async mutate(t,o){this.meta=(await this.send(t,o)).meta,this.steps.push({header:t,plane:o})}async send(t,o){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(t,o)}catch(n){if(t.op==="build"||!(n instanceof Error)||!n.message.includes(Qi))throw n;for(const i of this.steps)await this.call(i.header,i.plane);return this.call(t,o)}}async call(t,o){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:tn(this.tuning),...t})),i=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);i.set(n);const s=new Uint8Array(4);new DataView(s.buffer).setUint32(0,i.length,!0);const u=await(await Br(this.runtime,"/terrain/relief",new Blob([s,i,...o?[eo(o)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const a=new DataView(u).getUint32(0,!0);if(a%4||4+a>u.byteLength)throw new Error("Native relief reply header invalid.");const e=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,a))),l={};let f=4+a;for(const{name:m,type:y,count:b}of e.arrays){const M=b*(y==="f32"?4:1);if(!Number.isSafeInteger(b)||b<0||f+M>u.byteLength)throw new Error("Native relief plane incomplete.");l[m]=y==="f32"?new Float32Array(u,f,b):new Uint8Array(u,f,b),f+=M}return{meta:e,arrays:l}}}const ro=["plateau","volcano","caldera"],Ir=r=>r==="neural-wasm"||r==="neural-python"||r==="neural",to="http://127.0.0.1:8792",no="http://127.0.0.1:8793";function io(r,t){const o=r==="neural-python"?no:to,n=t?.trim().replace(/\/+$/,"");if(!n)return o;try{const i=new URL(n);if(i.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(i.hostname)&&["8792","8793"].includes(i.port)&&i.pathname==="/"&&!i.search&&!i.hash&&!i.username&&!i.password)return o}catch{}return n}const Sn={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},oo={flat:20,hills:110,plateau:100},ar=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],$r=r=>r.climateValues??jn[r.climate??"temperate"];function nn(r){const t=new Float32Array(r.height.length);let o=0,n=0;for(let c=0;c<r.height.length;c++)r.height[c]>0&&(t[n++]=r.height[c],o+=Math.acos(Math.min(1,r.normalZ[c])));const i=t.subarray(0,n).sort(),s=c=>n?i[Math.min(n-1,Math.floor(c*n))]:0;return{p5:s(.05),p50:s(.5),p95:s(.95),slope:o/Math.max(1,n),land:n/Math.max(1,r.height.length)}}let Yr,L,mr="",qr="",Mr,tr="",Pr,pr,$e,sr=!1,W;const qe=()=>W??L,zr=()=>W?W.physicalHeightField():Promise.resolve(L.physical_height_field()),on=async()=>{if(W)return W.underdarkTunnels().catch(()=>new Float32Array(0));const r=L?.underdark_tunnels;return r?r.call(L):new Float32Array(0)},ct=()=>W?W.samplingBaseField():Promise.resolve(L.sampling_base_field());let ir="",Xe,hr,ge,nr,He="cpu",Be,an=Promise.resolve(),je,Cr="",Ar="",Te,Ur,jr="";async function _n(){if(!jr)return;const r=jr;jr="";try{await fetch(`${r}/release`,{method:"POST"})}catch{}}let Er,ee,Ze;const Rr=new vt;async function ao(r,t){const o=Qe(r),n=Math.ceil(r.width/30),i=(v,h)=>h.extent===r.width&&h.resolution===o.n&&h.nativeCellM===30&&h.nativeResolution===n&&h.outputCellM===r.width/o.n&&v.length===o.n*o.n&&v.every(Number.isFinite),s=io(r.source,r.neuralServer),c=new URLSearchParams({seed:r.seed,relief:r.relief,mix:String(r.relief==="mixed"?r.mountainMix:.5),coasts:"0",islands:"island",climate:r.climate??"temperate",noise:String(r.fidelity??.05),extent:String(r.width),sampleSpacing:String(o.requestedSpacing),resolution:String(o.n)}),u=$r(r),a=r.neuralTuning??Sn;for(const[v,h]of Object.entries(u))c.set(v,String(h));c.set("landScale",String(a.landScale)),c.set("steps",String(a.steps)),c.set("detail",String(a.detail));for(const v of["coarseModel","baseModel","decoderModel"])r[v]&&c.set(v,r[v]);for(const v of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])c.set(v,String(a[v]));c.set("histogram",a.histogram.join(","));const e=oo[r.relief];a.reliefMode==="fixed"?c.set("reliefFixed",String(a.reliefFixed)):a.reliefMode==="auto"&&e!==void 0?c.set("reliefFixed",String(e)):c.set("reliefScale",String(a.reliefMode==="scale"?a.reliefScale:1));const l=si(r.width,r.width,r.neuralFit??"crop",r.neuralSlopes??!0),f=r.zones?{zones:hn(r.zones),region:{x:l.x,y:l.y,width:l.width}}:r.sketch?li(gr(r.sketch),l):void 0,m=performance.now();if(r.source==="neural-wasm"){if(await _n(),!r.neuralAssets)throw new Error("Neural browser runtime URL missing.");const v=await Ki(r.neuralAssets,c,f,t);if(!i(v.heights,v.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:v.heights,info:{...v.meta,requestMs:performance.now()-m}}}await St();let y=f;if(r.source==="neural-python"){if(r.zones&&(await fetch(`${s}/status`,{cache:"no-store"}).then(d=>d.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!r.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const v=await bn(r.neuralAssets),h=Object.fromEntries(c);y={params:h,conditioning:JSON.parse(v.conditioning_json(JSON.stringify(h),f?JSON.stringify(f):"")),edited:!!f},t?.("Neural Python · computing with PyTorch/CUDA")}const b={cache:"no-store",...y?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(y)}:{}};let M;if(r.source==="neural")M=await ci({profile:"local",server:s},`/generate?${c}`,b);else try{M=await fetch(`${s}/generate?${c}`,b)}catch{throw new Error(`Neural service unreachable (${s}): run “npm run neural:python” from web/`)}if(!M.ok)throw new Error(`Neural service: ${await M.text()}`);const S=new Float32Array(await M.arrayBuffer()),P=JSON.parse(M.headers.get("X-Neural-Meta")??"{}");if(r.source==="neural-python"&&(jr=s),f&&(P.edited!==!0||P.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!i(S,P))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:S,info:{...P,requestMs:performance.now()-m}}}function so(r){return Yr??=(async()=>{ni()?(r?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await ii(),r?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await oi(()=>Mi(vi,t=>gi({module_or_path:t}),r))})()}ln(()=>{Rr.clear(),Yr=void 0,L=void 0,W?.free(),W=void 0,mr="",ir="",sr=!1,je=void 0,Te=void 0,Cr="",Ar="",Er=void 0,ee=void 0,Ze=void 0});function uo(r,t,o,n){const i=an.then(()=>sn(r,t,o,n).catch(async s=>{if(!await Wn(s))throw s;return o?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),sn(r,t,o,n)}));return an=i.catch(()=>{}),i}async function sn(r,t,o,n){const{settings:i,region:s,kind:c,display:u,runtime:a}=r,e=i.islandMode?.startsWith("traced:")&&(i.sketch?.processing||i.relief==="cavern"||i.underdark)?{...i,islandMode:"island"}:i,l=Qe(e);if(Yn(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning}),e.climateZone==="wetland"&&(e.erosionTuning={carve:0,finalCarve:0,surfaceCarve:0,...e.erosionTuning});const f=e.compute==="wasm"?"wasm":"gpu-f32",m=e.generationCompute??"gpu-erosion";if(Vn(e,l.n))throw new Error(`GPU generation is limited to ${Jn}² cells; requested spacing ${l.spacing.toFixed(2)} m (${l.n}²). Choose CPU or native.`);const y=Ye(e.generalSeed??e.seed,"relief-coast-cut"),b=!!e.generalSeed&&dt(e.generalSeed,k=>k.startsWith("relief-"))!==pn(e.generalSeed),M=Vr(e),S=e.hydrology?.compute==="auto"&&(f==="wasm"||m==="cpu")?"cpu":e.hydrology?.compute??"auto";if(S!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&bt(),M&&!e.zones&&!e.sketch?.processing&&(!Kn.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const P=m==="native"&&!Ir(e.source);if(P&&a?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(P&&e.relief==="cavern")return Xi({...r,settings:e});const v=ro.includes(e.relief)?e.environment??"mixed":"mixed",h=e.sketch?.processing,p=ie(e,"coasts")?e.relief==="cavern"||e.underdark?0:e.coastMask??0:0,d=e.islandMode??"island",O=Pi.includes(e.relief),U=f!=="wasm"&&O?zi(f,e.relief).catch(()=>{}):void 0;Yr&&o?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await so(o)}catch(k){throw Yr=void 0,k}const A=performance.now();U&&o?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const E=U?await vr(U):void 0;n&&await n.after("prepare");const R=(k,w)=>{const T=$e;$e={erosionSpacing:k===void 0?T?.erosionSpacing:Math.max(T?.erosionSpacing??0,k),regionalErosionSpacing:w===void 0?T?.regionalErosionSpacing:Math.max(T?.regionalErosionSpacing??0,w)},Object.assign(l,$e)},x=async(k,w=!1)=>{let T=w&&ie(e,"phasor",!1)?ft(k,e):k;const Y=Bt(e),V=Tt(e),ae=Wr(e);for(const C of["posterior","wind"]){const F=JSON.stringify([ae.get(C),a?.server,!!E,ai(new Uint8Array(T.buffer,T.byteOffset,T.byteLength))]),ce=e.procedural?Rr.get(C,F):void 0;if(ce){T=ce,n?.cached?await n.cached(C,n.previews===!1?void 0:T):(await n?.before(C),await n?.after(C,n.previews===!1?void 0:T));continue}if(await n?.before(C),C==="posterior"&&e.procedural&&ie(e,C)&&Y.mode!=="none"){const I=T,te=Math.sqrt(T.length);T=(await Gt(T,te,e.width,Y,{stats:!1},a)).height;for(let Z=0;Z<T.length;Z++)T[Z]=I[Z]>0?Math.max(.3,T[Z]):T[Z]}C==="wind"&&e.procedural&&ie(e,C)&&V.iterations&&V.transport&&(T=E?await bi(E.context,T,e.width,V):xi(T,e.width,V)),e.procedural&&l.n<=1024&&Rr.put(C,F,T),await n?.after(C,n.previews===!1?void 0:T)}return e.procedural&&T.some(C=>C<.3)?T.map(C=>Math.max(.3,C)):T},z=E?vr(E.pipeline).then(k=>({pipeline:k}),()=>{}):void 0,$=!P&&!e.zones&&!e.sketch&&m!=="cpu"&&f!=="wasm"&&!Ir(e.source)&&e.relief!=="cavern",H=$&&E?Oi(E.context,e):void 0;if(H?.error&&e.generationCompute)throw new Error(H.error);const N=e.generationCompute||!H?void 0:H.error??(Xn(H)?`Source ${l.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),q=!!H&&!H.error&&!N,X=$&&Ui.includes(e.relief),se=X&&q,K=(l.n!==1024||!!(e.procedural||n||b))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!Ir(e.source)&&(!se||m!=="gpu-erosion"),re=!h&&Ir(e.source);re||(await St(),await _n());const ue=a?.profile==="local"&&(P||re),fe=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,et(e.modification.delta)]):"",me=JSON.stringify([e.zones,fe,!!e.underdark,y,P?[a.server,p,d]:null,ue?a.server:null])+"|"+JSON.stringify(re?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,$r(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??Sn,e.width,l.n,e.coarseModel,e.baseModel,e.decoderModel,e.neuralFit,e.neuralSlopes]:[e.seed,...e.generalSeed?[dt(e.generalSeed,k=>k.startsWith("relief-"))]:[],e.width,l.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,P?"native":M?[m,f,!!E]:X?m:"cpu",v,e.sketch,e.erosionTuning??{},...e.procedural?[Zn,e.procedural,e.climate,e.climateValues,e.climateZone,se?null:[p,d]]:[],...M||e.procedural?.enabled?.phasor?[rt,e.climate??"temperate",e.phasor??{}]:[]]);let Ee=0,Me=0,Ge=0,Ce=0,be=0,de;if(n&&n.previews!==!1||!(L||W)||mr!==me){ge?.dispose(),ge=void 0,nr=void 0,L?.free(),L=void 0,W?.free(),W=void 0,sr=!1,mr="",ir="",$e=void 0;const k=performance.now();tr="",qr="",Pr=void 0,pr=void 0,Mr=void 0,He="cpu",Be=void 0;const w=e.relief==="mixed"?e.mountainMix:.5;Ur=void 0;const T=Float64Array.from(ar,C=>{let F=M&&!e.procedural?NaN:e.procedural?.erosionTuning?.[C]??e.erosionTuning?.[C]??NaN;return e.procedural?.biome&&!se&&!K&&(C==="incision"||C==="thermal")&&(F=(Number.isFinite(F)?F:1)*(C==="incision"?Sr(e).water:Sr(e).thermal)),F});if(_r(T),K){o?.(N?`${N} Rust CPU generation at ${l.spacing.toFixed(2)} m…`:P?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const C=await x(await yi(e,n,P?a:void 0,se&&E?()=>Ht(E.context,e,o):void 0,(F,ce)=>{$e={erosionSpacing:F,regionalErosionSpacing:ce},Object.assign(l,$e)}));n&&await n.before("retain"),ue?W=await lr.build(a,{kind:"source",seed:y,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:w,environment:v},C,T):L=_e.with_source(y,e.width,e.relief,e.erosion,e.motifSize,w,C,v),n&&await n.after("retain",n.previews===!1?void 0:C),He=P?"native":se?m==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":M?"compact-cpu":"cpu",Be=N??`${P?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(P){o?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${l.n} × ${l.n} physical field`});const C=e.procedural?.biome?{...e,coastMask:p,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*Sr(e).water,thermal:(e.erosionTuning?.thermal??1)*Sr(e).thermal}}:{...e,coastMask:p},F=await Zi(C.sketch&&!h?{...C,sketch:void 0}:C,a),ce=h!=="surface"&&e.procedural&&!e.zones?await x(F.height.slice(),!0):void 0;if(ce&&p)for(let I=0;I<ce.length;I++)F.height[I]<=0&&(ce[I]=F.height[I]);W=await lr.build(a,{kind:"surface",seed:y,width:e.width},ce??F.height,T),He="native",Be="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",be=F.prepareMs}else if(h){o?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const C=Dr(gr(e.sketch),l.n);if(h==="erosion"){o?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),L=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,v,l.n),L.set_edited_surface(C);const F=L.sampling_base_field();L.free(),L=_e.with_surface(y,e.width,F)}else L=_e.with_surface(y,e.width,C);Be=h==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if(re){const C=await ao(e,o),F=Qn(C.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);ue?W=await lr.build(a,e.zones?{kind:"zonedSurface",seed:y,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:y,width:e.width},F,T):L=e.zones?_e.with_zoned_surface(y,e.width,e.motifSize,F,JSON.stringify(e.zones)):_e.with_surface(y,e.width,F),Ur=C.info,He="neural",e.zones&&(Be="Zones → regional conditioning and local neural relief, then sea operation.")}else if(M&&!e.zones)if(E&&q){o?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const C={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:R},F=await x(await Yt(E.context,e,C,o));n&&await n.before("retain"),de=C.profiles,L=_e.with_source(y,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,w,F,v),n&&await n.after("retain",F),He="compact-gpu-f32",Be=`${rt} · compact preset · ${e.procedural?.regionalN??Nt(e).n}² grid · ${e.climate??"temperate"} · Phasor ${ie(e,"phasor",!0)?"enabled":"disabled"}.`}else{o?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const C=e.procedural?.biome?Sr(e):void 0,F=C?{incision:C.water,thermal:C.thermal}:e.procedural?{incision:1,thermal:1}:ei(e),ce=e.procedural?.erosionTuning?.iterations??Nt(e).steps,I=e.erosionTuning??{},te={...I,iterations:ce,surfaceIterations:ie(e,"surface",!1)?I.surfaceIterations??12:0,detail:ie(e,"ridged",!1)?I.detail:0,warp:I.warp??0,incision:(I.incision??1)*F.incision,thermal:(I.thermal??1)*F.thermal};_r(Float64Array.from(ar,pe=>te[pe]??NaN));let Z;try{Z=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,v,l.n);const pe=Z.physical_height_field();L=_e.with_source(y,e.width,"hills",e.erosion,e.motifSize,w,ie(e,"phasor",!0)?ft(pe,e):pe,v)}finally{Z?.free(),_r(new Float64Array(ar.length).fill(NaN))}He="compact-cpu",Be=`${rt} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)o?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${l.n} × ${l.n} physical field`}),L=_e.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,v,JSON.stringify(hn(e.zones)),l.n),Be="Zone masks → uplift, noise, ridges and Rust erosion.";else if(se&&E)try{if(m==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const C={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:R},F=await x(await Yt(E.context,e,C,o));n&&await n.before("retain"),be=C.nativeEnvironmentMs,de=C.profiles,Ce=performance.now()-k-be,L=_e.with_source(y,e.width,e.relief,e.erosion,e.motifSize,w,F,v),n&&await n.after("retain",F),He="gpu-erosion-f32"}else{const C=await Ht(E.context,e,o);Me=performance.now()-k;const F=performance.now();o?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),L=_e.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,C.coarse,C.fine,v),Ge=performance.now()-F,He=m==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(C){if(n||e.procedural)throw C;Be=`GPU generation unavailable: ${C instanceof Error?C.message:String(C)}`}if(!L&&!W&&(o?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${l.n}² physical source at ${l.spacing.toFixed(2)} m`}),L=_e.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,v,l.n),N&&(Be=N)),!h&&!re&&e.sketch&&e.relief!=="cavern"){const C=gr(e.sketch),F=await zr(),ce=ri(C,F,l.n);W?await W.editSurface(ce):L.set_edited_surface(ce),Be="Edited sketch + procedural detail and Rust erosion."}const Y=Bt(e),V=Tt(e),ae=ie(e,"posterior")&&Y.mode!=="none"||ie(e,"wind")&&V.iterations>0&&V.transport>0;if(!K&&e.procedural&&(ae||!M&&ie(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(He)&&!re&&!h&&!P&&!e.zones){L.set_coast(p,d);const C=L.physical_height_field(),F=await x(C,!M);L.free(),L=_e.with_surface(y,e.width,F),sr=!0}e.modification&&(re||h)&&(Mr=await ct()),Ee=performance.now()-k,mr=me}else if(o?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),$e&&Object.assign(l,$e),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const k of["grids",...yt(e),"phasor","posterior","wind"])await n.cached(k);const Ae=JSON.stringify([me,y,p,d,Wr(e).get("coasts"),He,a?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,et(e.sketch.heights)],e.zones&&[e.zones.resolution,et(e.zones.weights)]]),Re=!!(e.procedural||re||h)&&!sr&&!(P&&!K),oe=Re&&p?Rr.get("coasts",Ae):void 0;!oe&&n&&await n.before("coasts");const ve=!re&&!h&&!sr&&!H?.error&&!N&&!e.zones&&!e.sketch&&p!==0&&m!=="cpu"&&f!=="wasm",ye=JSON.stringify([y,p,p?d:"island",p?ve:!1,e.procedural?.coastIterations,e.procedural?.coastIncision,e.procedural?.coastThermal,e.procedural?.coastDiffusion,e.erosionTuning]);let Oe=0;if(Mr&&tr&&tr!==me+"|"+ye){if(ge?.dispose(),ge=void 0,nr=void 0,W){const k=W;W=await lr.build(a,{kind:"surface",seed:y,width:e.width},Mr,new Float64Array(ar.length).fill(NaN)),k.free()}else L?.free(),L=_e.with_surface(y,e.width,Mr);ir="",tr="",pr=void 0,Pr=void 0,qr=""}if(P&&!K||sr)ir=ye,Xe=sr&&p?"cpu":void 0,hr=void 0;else if(ir!==ye){ge?.dispose(),ge=void 0,nr=void 0,Xe=void 0,hr=void 0;const k=performance.now();o?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const w=e.procedural,T={...e.erosionTuning,...w?.erosionTuning},Y=p?Float64Array.from(ar,V=>w&&V==="surfaceIterations"?w.coastIterations??(M?2:12):V==="surfaceIncision"?(T[V]??1)*(w?.coastIncision??1):V==="surfaceThermal"?(T[V]??1)*(w?.coastThermal??1):V==="surfaceDiffusion"?(T[V]??1)*(w?.coastDiffusion??1):T[V]??NaN):void 0;if(W?(await W.coast(p,d,oe?void 0:Y,oe),p&&(Xe="native")):oe&&(L.configure_coast(p,d),L.set_coast_surface(oe),Xe="cpu"),!W&&!oe&&ve&&E){let V;try{const ae=await z;if(!ae||E.context.lost)throw new Error("WebGPU unavailable");L.configure_coast(p,d),V=new It(E.context,ae.pipeline,f,L);const C=V.prepareCoastField(e),F=await Fi(E.context,e,C,L.coast_erosion_parameters(),o);L.set_coast_surface(F),Xe="gpu-f32"}catch(ae){hr=`GPU coast unavailable: ${ae instanceof Error?ae.message:String(ae)}`}finally{V?.dispose()}}if(!W&&!Xe){Y&&_r(Y);try{L.set_coast(p,d)}finally{Y&&_r(Float64Array.from(ar,V=>T[V]??NaN))}p&&(Xe="cpu"),ve&&!E&&(hr="WebGPU unavailable")}ir=ye,Oe=p?performance.now()-k:0,Ee+=Oe}const ze=p&&Re&&(!oe&&l.n<=1024||n&&n.previews!==!1&&!(oe&&n.cached))?await ct():void 0;if(ze&&!oe&&l.n<=1024&&Rr.put("coasts",Ae,ze),oe&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:oe):n&&await n.after("coasts",n.previews===!1?void 0:ze),e.modification&&tr!==me+"|"+ye){const k=qe().source_resolution(),w=h==="surface"&&!p?Dr(gr(e.sketch),k):await zr();if(Pr={n:k,height:w.slice()},pr=ti(w,k,e.modification),ge?.dispose(),ge=void 0,nr=void 0,W){const T=W;W=await lr.build(a,{kind:"surface",seed:y,width:e.width},pr,new Float64Array(ar.length).fill(NaN)),T.free()}else L?.free(),L=_e.with_surface(y,e.width,pr);tr=me+"|"+ye}e.underdark&&qr!==me+"|"+ye+"|"+tr+"|"+(e.underdarkTunnels??"")&&(o?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),ge?.dispose(),ge=void 0,nr=void 0,W?await W.carveUnderdark(e.seed,e.underdarkTunnels):L.carve_underdark(e.seed,e.underdarkTunnels),qr=me+"|"+ye+"|"+tr+"|"+(e.underdarkTunnels??""));let Fe;const De=async(k,w,T)=>((Fe?.delta!==k||Fe.m!==w||Fe.n!==T)&&(Fe={delta:k,m:w,n:T,out:await mi(k,w,T,a)}),Fe.out);async function Ie(k){$e?Object.assign(l,$e):l.erosionSpacing??=qe().erosion_spacing(),k.definition=l,n&&await n.after("sampling",k.height),n&&await n.before("hydrology");const w=ie(e,"hydrology")?e.hydrology:void 0;k.neural=Ur,c==="overview"&&!re&&e.relief!=="cavern"&&(k.erosionDefaults=Array.from(ui(e.relief,e.width,e.motifSize,e.mountainMix)));const T=!!w?.enabled&&e.relief!=="cavern",Y=w?.engine!=="rust",V=w?.erosionEnabled!==!1,ae=V&&w?.showErosion!==!1,C=V?w?.condMode:"none",F=Y&&w&&w.lakes!=="none"?[w.lakeAbundance,w.lakeArea,w.lakeDepth,w.lakeCoverage,w.maxLakeArea]:[0,0,0,0,0],ce=w&&{mode:w.condMode,strength:w.condStrength,maxDepth:w.condDepth,maxLength:w.condLength,banks:w.condBanks,lakes:F[0],lakeArea:F[1],lakeDepth:F[2],lakeCoverage:F[3],maxLakeArea:F[4],...e.climateZone==="wetland"?{undulation:2}:{}};if(t&&w&&T&&c==="overview"&&u==="gl"){const I=Ot(Y?w.vectorResolution:w.resolution,l.n),te=JSON.stringify([mr,ir,I,C,C==="none"?0:[w.condStrength,w.condDepth,w.condBanks,w.condLength,F]]);if(!ee||ee.key!==te||Y&&!Ze){const Z=nn(k);t({...k,height:k.height.slice(),normalX:k.normalX.slice(),normalY:k.normalY.slice(),normalZ:k.normalZ.slice(),caveMask:k.caveMask.slice(),neural:Ur&&{...Ur,land:Z.land},field:await Le(k,!1,Y),relief:Z,generationMs:performance.now()-A})}}if(w&&T){const I=Ot(Y?w.vectorResolution:w.resolution,l.n),te=JSON.stringify([mr,ir,I,C,C==="none"?0:[w.condStrength,w.condDepth,w.condBanks,w.condLength,F]]),Z=$r(e),pe={riverArea:Ji(w,e.width)/Math.max(1,w.density)**2,density:Math.min(1,w.density),headwaters:w.headwaters!==!1?1:0,minRiverLength:w.minRiverLength,lakeDepth:w.lakeDepth,lakeArea:w.lakeArea,riverMode:w.riverMode,flatSlope:w.flatSlope,sinuosity:w.sinuosity,widthScale:w.vectorWidth,balance:w.balance,braiding:w.braiding,anabranching:w.anabranching,terrainInfluence:w.terrainInfluence,avulsions:w.avulsions,confluence:w.confluence,deltas:w.deltas,...e.climateZone==="wetland"?{oxbows:.35}:{}},J=JSON.stringify([te,pe,Z.temperature,Z.precipitation,Ye(e.generalSeed??e.seed,"water-hydrology")]);if(!ee||ee.key!==te){ee=void 0,Ze=void 0,je?.dispose(),je=void 0,Te=void 0,Cr="",Ar="";let ne;if(k.x===0&&k.y===0&&k.width===e.width&&k.resolution===I)ne=k.height.slice();else if(ge&&!ge.lost)ne=(await ge.sample({x:0,y:0,extent:e.width,resolution:I},e,L.min_height,L.max_height)).height;else{const j=W?await W.sampleRegion(0,0,e.width,I):L.sample_region(0,0,e.width,I);try{ne=j.height}finally{j.free()}}if(C==="none")ee={key:te,n:I,height:ne,m:0};else{o?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const j=ce;if(Y){const Q=await Ft(ne,I,e.width,j,pe,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),a),{height:we,delta:xe,...D}=Q.conditioning;ee={key:te,n:I,height:we,source:ne,delta:xe,m:I,stats:D},Ze={key:J,water:Q.water}}else{const Q=await Gt(ne,I,e.width,j,{stats:!1,drainage:!1},a),{height:we,delta:xe,hydrology:D,...Gr}=Q;ee={key:te,n:I,height:we,source:ne,delta:xe,m:I,stats:{...Gr,census:!1},drainage:D}}}}if(Y){if(!Ze||Ze.key!==J)if(o?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),ee.source){const ne=await Ft(ee.source,I,e.width,ce,pe,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),a),{height:j,delta:Q,...we}=ne.conditioning;Object.assign(ee,{height:j,delta:Q,stats:we}),Ze={key:J,water:ne.water}}else Ze={key:J,water:await fi(ee.height,I,e.width,pe,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),ee.drainage,a)}}else{const ne=JSON.stringify([te,S,Ye(e.generalSeed??e.seed,"water-hydrology")]),j={...w,showErosion:!0,erosionEnabled:V,...V?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},Q=`${ne}|${JSON.stringify(j)}`;if(re&&Er?.key===Q)k.hydrologyError=Er.message;else try{(!je||Cr!==ne)&&(o?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),je?.dispose(),je=void 0,Te=void 0,Ar="",je=await kt.create(Ye(e.generalSeed??e.seed,"water-hydrology"),e.width,I,ee.height.slice(),S,p!==0||(h||re||e.sketch||e.zones?qe().min_height<=0:!1)),Cr=ne);const we=$r(e),xe=JSON.stringify([j,we.temperature,we.precipitation]);(!Te||Ar!==xe)&&(o?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Te=je.generate(j,we),Ar=xe)}catch(we){if(!re)throw we;je?.dispose(),je=void 0,Te=void 0,Cr="",Er={key:Q,message:we instanceof Error?we.message:String(we)},k.hydrologyError=Er.message}}}if(o?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),T&&ae&&ee?.delta&&!e.underdark&&await di(k,ee.delta,ee.m,e.width,a),T&&ae&&!Y&&Te&&!k.hydrologyError){const I=performance.now();xn(k,Te),k.hydrologySurfaceMs=performance.now()-I}if(c==="overview"){const I=qe().source_resolution(),te=e.underdark?await zr():pr?.slice()??(h==="surface"&&!p?Dr(gr(e.sketch),I):await zr());if(T&&ae&&ee?.delta&&!e.underdark){const Z=await De(ee.delta,ee.m,I);for(let pe=0;pe<te.length;pe++)te[pe]+=te[pe]<=0?Math.min(0,Z[pe]):Z[pe]}T&&ae&&!Y&&Te&&!k.hydrologyError&&Zt({x:0,y:0,width:e.width,resolution:I,height:te,minHeight:k.globalMinHeight,maxHeight:k.globalMaxHeight},Te),k.physical={n:I,height:te},Pr&&(k.modificationBase=Pr)}return e.refine&&u!=="gl"&&pi(k,e.width/qe().source_resolution(),hi(e.seed),e.detailNoise),c==="overview"&&(u==="gl"||r.retainField)&&(o?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),k.field=await Le(k,T,Y)),c==="overview"&&T&&(Y?k.water=Ze?.water:Te&&!k.hydrologyError&&(k.hydrology=Te),ee?.delta&&ee.stats&&(k.conditioning={delta:ee.delta,n:ee.m,stats:ee.stats})),c==="overview"&&(k.relief=nn(k)),k.neural&&k.relief&&(k.neural={...k.neural,land:k.relief.land}),k.generationMs=performance.now()-A,n&&await n.after("hydrology",k.height),k}async function Le(k,w,T){const Y=qe().sampling_parameters()[5],V=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((Y===1||Y===4)&&e.relief!=="cavern"){const I=qe().source_resolution(),te=await ct();if(w&&V&&ee?.delta&&!e.underdark){const ne=await De(ee.delta,ee.m,I);for(let j=0;j<I*I;j++)te[j]+=te[j]<=0?Math.min(0,ne[j]):ne[j]}const Z=w&&V&&!T&&!k.hydrologyError?Te:void 0;Z&&Zt({x:0,y:0,width:e.width,resolution:I,height:te,minHeight:k.globalMinHeight,maxHeight:k.globalMaxHeight},Z);const pe=e.underdark?W?await W.physicalCaveField():L.physical_cave_field():void 0,J=e.underdark?await on():void 0;return{n:I,data:te,exact:!Z,floor:Y===1?.3:0,cave:pe?.length?pe:void 0,...J?.length?{tunnels:J}:{}}}const ae=qe().source_resolution(),C=k.physical?.height.slice()??await zr(),F=e.relief!=="cavern"&&!e.underdark?void 0:W?await W.physicalCaveField():L.physical_cave_field(),ce=e.underdark?await on():void 0;return{n:ae,data:C,exact:!1,floor:0,cave:F?.length?F:void 0,...ce?.length?{tunnels:ce}:{}}}n&&await n.before("sampling",`Borne du moteur ${qe().max_height.toFixed(2)} m · aperçu ${s.resolution}²`);let le,Ve=0,er;if(f!=="wasm"&&O&&!W&&!e.underdark){o?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const k=performance.now();try{const w=await z;E&&w&&!E.context.lost&&((!ge||nr!==f||ge.lost)&&(ge?.dispose(),ge=void 0,ge=new It(E.context,w.pipeline,f,L),nr=f),Ve=performance.now()-k,o?.(`GPU · sampling the terrain ${s.resolution} × ${s.resolution}…`,{stage:"terrain-sampling"}),er={...await ge.sample(s,e,L.min_height,L.max_height),generationMs:performance.now()-A,prepareMs:Ee,gpuSetupMs:Ve,generationBackend:He,generationReason:Be,noiseMs:Me,erosionMs:Ge,gpuSimulationMs:Ce,nativeEnvironmentMs:be,erosionProfile:de,coastBackend:Xe,coastMs:Oe,coastReason:hr}),er||(le="WebGPU indisponible")}catch(w){le=`GPU indisponible : ${w instanceof Error?w.message:String(w)}`,ge?.dispose(),ge=void 0,nr=void 0}}else W?le="Native Rust sampling on the local service.":f!=="wasm"&&(le="terrain currently sampled in WASM");if(er)return Ie(er);o?.(`${W?"Native Rust":"CPU"} · sampling the terrain ${s.resolution} × ${s.resolution}…`,{stage:"terrain-sampling"});const ur=performance.now(),ke=W?await W.sampleRegion(s.x,s.y,s.extent,s.resolution):L.sample_region(s.x,s.y,s.extent,s.resolution);try{return await Ie({x:ke.x,y:ke.y,width:ke.width,resolution:ke.resolution,minHeight:ke.min_height,maxHeight:ke.max_height,globalMinHeight:qe().min_height,globalMaxHeight:qe().max_height,motifSize:e.motifSize,height:ke.height,caveMask:ke.cave_mask,normalX:ke.normal_x,normalY:ke.normal_y,normalZ:ke.normal_z,generationMs:performance.now()-A,backend:W?"native":"wasm",backendReason:le,prepareMs:Ee,samplingMs:performance.now()-ur,gpuSetupMs:Ve,generationBackend:He,generationReason:Be,noiseMs:Me,erosionMs:Ge,gpuSimulationMs:Ce,nativeEnvironmentMs:be,erosionProfile:de,coastBackend:Xe,coastMs:Oe,coastReason:hr})}finally{ke.free()}}export{jn as CLIMATE_VALUES,to as DEFAULT_NEURAL_SERVER,Sn as DEFAULT_NEURAL_TUNING,no as DEFAULT_PYTHON_SERVER,ar as EROSION_SETTINGS,ro as GEOLOGICAL_RELIEFS,oo as NEURAL_RELIEF_DEFAULTS,$r as climateOf,Ir as isNeuralSource,io as neuralServerForSource,nn as reliefStatistics,uo as sampleRustTerrain};
