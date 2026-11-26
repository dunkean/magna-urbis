import{aG as dn,n as Or,aH as Qe,u as Xr,aI as Fr,aJ as pn,aK as hn,aL as mn,aM as ne,v as Ye,aN as xt,aO as gn,x as pt,q as Gr,aP as ht,aQ as wr,aR as In,aS as ke,aT as mt,aU as vn,aV as Et,aW as Dn,aX as jn,aY as Rt,aZ as $r,a_ as yr,C as $n,O as Wn,a$ as Yn,b0 as Vn,b1 as Jn,b2 as Kn,b3 as Xn,b4 as Zn,b5 as nt,b6 as Mr,b7 as Pr,b8 as Qn,b9 as Nt,ba as ei,bb as yn,bc as ri,t as Bt,r as Tt,bd as ti,be as ni,A as ii,bf as ai,bg as oi,bh as Ot,bi as si,bj as li,y as ci,bk as ui,bl as Gt,bm as Ft,bn as fi,bo as di,bp as pi,bq as hi,br as mi,bs as gi,bt as vi}from"./__vite-browser-external-DN1EBaKa.js";import{T as bt,s as yi,c as kt,p as Jr,C as Lt,l as wi,N as qt,o as xi,a as bi,f as it,b as ki}from"./terrainFingerprint-AODaNW8g.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function Ht(r,t,a,n){r.set_coast(t,a,JSON.stringify(n))}function It(r,t,a,n){r.configure_coast(t,a,JSON.stringify(n))}function Si(r,t,a,n){r.cut_coast(t,a,JSON.stringify(n))}function _i(r,t,a,n,i,o,c,u,s,e,l,f){return r.cut_field(t,a,n,i,o,c,u,s,e,l,JSON.stringify(f))}let We;const at=new Map;let gt=Promise.resolve();const vt=new bt;function yt(r=!1){const t=We;We=void 0,vt.clear(),r||t?.pipeline?.free(),t?.runtime&&(gt=gt.then(async()=>{await Or(t.runtime,"/terrain/stage",JSON.stringify({session:t.session,command:"cancel"})).catch(()=>{})}))}dn(()=>yt(!0));async function Mi(r,t,a,n,i){t?.backend?.(a?"native":"cpu");const o=Qe(r),c=t?.previews!==!1&&o.n<=1024,u=Xr(r),s=Fr.erosion_at_resolution(r.seed,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix,o.n),e=s.parameters();s.free();const{parameters:l,surface:f}=u?pn(e,r):{parameters:e,surface:e.slice(24,32)};hn(l,f,r,u),mn(f,r,o.n),u&&ne(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural?.erosionTuning?.detail===void 0&&(l[16]=e[16]);const v=(b,z=!0)=>Number(ne(r,b,z)),x=Uint32Array.from([Number(u),v("regional"),v("regionalFinish"),v("amplitude"),v("ridged",!u),v("surface",!u||r.relief==="canyon"),v("normalize"),+(r.procedural?.regionalThermal!==!1),+(r.procedural?.regionalDiffusion!==!1),r.procedural?.reconstruction==="cubic"?1:r.procedural?.reconstruction==="bspline"?2:0,+(r.relief==="canyon")]);i?.(x[5]&&l[23]>0&&f[3]>0?f[1]:void 0,x[1]&&r.erosion>0?l[4]:void 0);const S=yi([r.seed,r.width,o.n,l[2],a?.server??"wasm",!!n]);(o.n>1024||We?.root!==S)&&yt();const U=kt(r),_=Jr(r),P=U.map(b=>_.get(b));let g=0;for(;We&&g<P.length&&We.keys[g]===P[g];)g++;const h=async b=>{try{return await Or(a,"/terrain/stage",JSON.stringify({session:We.session,...b}))}catch(z){throw["coast","restore","preview"].includes(b.command)&&z instanceof Error&&z.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):z}},d=r.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([b,z])=>[b,Ye(r.generalSeed,z)])):void 0,p={parameters:Array.from(l),surface:Array.from(f),flags:Array.from(x),stepSeeds:d??{}},R=async b=>{const z=await h(b),j=await z.json();if(d&&Object.values(d).some(W=>W!==r.seed)&&!j.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!We||g===0?(yt(),a&&!at.has(a.server)&&at.set(a.server,xt()),We={root:S,keys:[],runtime:a,...a?{session:at.get(a.server)}:{}},await t?.before("grids",`Rust ${a?"natif":"WASM"} · régional ${l[2]}² · surface ${f[0]}² · source ${o.n}² à ${o.spacing.toFixed(2)} m`),a?(await gt,await R({command:"start",seed:r.seed,...p})):We.pipeline=new gn(r.seed,l,f,x),await t?.after("grids")):t?.cached?await t.cached("grids"):(await t?.before("grids"),await t?.after("grids"));const C=We;a||C.pipeline.set_step_seeds(JSON.stringify(d??{}));let A;for(let b=0;b<U.length;b++){const z=U[b],j=b<g;if(!j&&b===g&&b>0&&(a?await R({command:"restore",checkpoint:b-1,...p}):C.pipeline.restore(b-1,l,f,x),C.keys.length=b),j){(c||b===U.length-1)&&(A=a?new Float32Array(await(await h({command:"preview",checkpoint:b})).arrayBuffer()):C.pipeline.checkpoint_height(b)),t?.cached?await t.cached(z,c?A:void 0):(await t?.before(z),await t?.after(z,c?A:void 0));continue}await t?.before(z);const W=z==="coastCut"&&pt(r,"coastCut");if(a){const F=await(await h({command:z==="coastCut"?"coast":"advance",stage:Lt.indexOf(z),checkpoint:b,mask:W?r.coastMask:0,mode:r.islandMode??"island",coastProfile:Gr(r),preview:c||b===U.length-1})).arrayBuffer();F.byteLength&&(A=new Float32Array(F))}else{if(z==="initialize"&&n){const B=await n();C.pipeline.set_noise(B.coarse,B.fine)}z==="coastCut"?W&&Si(C.pipeline,r.coastMask,r.islandMode??"island",Gr(r)):C.pipeline.advance(Lt.indexOf(z)),C.pipeline.checkpoint(b),(c||b===U.length-1)&&(A=C.pipeline.height())}C.keys[b]=P[b],await t?.after(z,c?A:void 0)}const G=`${S}|${_.get("phasor")}`,k=o.n<=1024?vt.get("phasor",G):void 0;return k?(t?.cached?await t.cached("phasor",c?k:void 0):(await t?.before("phasor"),await t?.after("phasor",k)),k):(await t?.before("phasor"),ne(r,"phasor",u)&&(A=ht(A,r)),o.n<=1024&&vt.put("phasor",G,A),await t?.after("phasor",c?A:void 0),A)}const Pi=`
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
}`,Dt=new WeakMap;function zi(r,t,a){if(!a.iterations||!a.transport)return r;const n=r.slice(),i=Math.sqrt(n.length),o=t/i,c=new Float32Array(n.length),u=a.azimuth*Math.PI/180,s=Math.cos(u),e=Math.sin(u),l=s>=0?1:-1,f=e>=0?1:-1,v=Math.abs(s)/(Math.abs(s)+Math.abs(e)),x=1-v;for(let S=0;S<a.iterations;S++){c.fill(0);for(let U=1;U<i-1;U++)for(let _=1;_<i-1;_++){const P=U*i+_;if(n[P]<=.3)continue;const g=((n[P+1]-n[P-1])*s+(n[P+i]-n[P-i])*e)/(2*o),h=.75+.25*Math.sin((_*s+U*e)*o/64+n[P]*.03);c[P]=Math.min(Math.max(0,n[P]-.3),a.transport*Math.max(.1,Math.min(1,.55+2*g))*h)}for(let U=0;U<i;U++)for(let _=0;_<i;_++){const P=U*i+_,g=U*i+Math.max(0,Math.min(i-1,_-l)),h=Math.max(0,Math.min(i-1,U-f))*i+_;n[P]=n[P]-c[P]+(g!==P?c[g]*v:0)+(h!==P?c[h]*x:0)}}return n}async function Ui(r,t,a,n){if(!n.iterations||!n.transport)return t;const i=r.device,o=Math.sqrt(t.length);let c=Dt.get(i);c||(c=(async()=>{const v=i.createShaderModule({code:Pi}),S=(await v.getCompilationInfo()).messages.filter(h=>h.type==="error");if(S.length)throw new Error(S.map(h=>`${h.lineNum}: ${h.message}`).join(`
`));const U=i.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),_=i.createPipelineLayout({bindGroupLayouts:[U]}),[P,g]=await Promise.all(["entrain","deposit"].map(h=>i.createComputePipelineAsync({layout:_,compute:{module:v,entryPoint:h}})));return{layout:U,a:P,b:g}})(),Dt.set(i,c));const{layout:u,a:s,b:e}=await c,l=[],f=(v,x)=>{const S=i.createBuffer({size:v,usage:x});return l.push(S),S};try{const v=f(t.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),x=f(t.byteLength,GPUBufferUsage.STORAGE),S=f(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),U=f(t.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);i.queue.writeBuffer(v,0,t);const _=new ArrayBuffer(48),P=new Float32Array(_);new Uint32Array(_)[0]=o;const g=n.azimuth*Math.PI/180;P[1]=a/o,P[2]=Math.cos(g),P[3]=Math.sin(g),P[4]=n.transport,i.queue.writeBuffer(S,0,_);const h=i.createBindGroup({layout:u,entries:[v,x,S].map((k,b)=>({binding:b,resource:{buffer:k}}))}),d=Math.ceil(t.length/256),p=Math.ceil(d/i.limits.maxComputeWorkgroupsPerDimension),R=Math.ceil(d/p),C=i.createCommandEncoder(),A=C.beginComputePass();A.setBindGroup(0,h);for(let k=0;k<n.iterations;k++)A.setPipeline(s),A.dispatchWorkgroups(R,p),A.setPipeline(e),A.dispatchWorkgroups(R,p);A.end(),C.copyBufferToBuffer(v,0,U,0,t.byteLength),i.queue.submit([C.finish()]),await U.mapAsync(GPUMapMode.READ);const G=new Float32Array(U.getMappedRange()).slice();return U.unmap(),G}finally{l.forEach(v=>v.destroy())}}const Ci=`// FP32 sampling of the retained Rust erosion field.\r
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
`,St=`// Shared FP32 simplex and FBM kernels.\r
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
`,Ai=`// Same noise octaves and physical wavelengths as erosion::mountain.\r
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
`,wn=`// Seeded finite volcanic geometry. Shared by generation and camera sampling.\r
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
`,Ei=`// The dedicated third simplex stream matches Rust's shore-noise fork.\r
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
  var limit=cliff*smooth01(metres/(1.0+0.6*cliff))+slope*metres*ease;\r
  if(!islet&&coast[0].x!=255.0){limit+=metres*metres/(260.0*clamp(1500.0/max(scale*width,1.0),1.0,6.0));}\r
  let low=min(ground,limit);let ratio=low/max(ground,limit);let square=ratio*ratio;\r
  return low/sqrt(sqrt(1.0+square*square));\r
}\r
`;let ot;const Ri=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function _t(){return ot??=(async()=>{const r=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!r)return;const{maxBufferSize:t,maxStorageBufferBindingSize:a}=r.limits,n=await r.requestDevice({requiredFeatures:r.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:t,maxStorageBufferBindingSize:a}}),i={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{i.lost=!0,ot=void 0}),i})().catch(()=>{}),ot}async function Ni(r,t){if(r==="wasm")return;const a=await _t();if(!a||a.lost)return;const n=t==="flat"?0:t==="valley"?2:t==="volcano"||t==="caldera"||t==="plateau"?3:1,i=`${r}:${n}`;let o=a.pipelines.get(i);return o||(o=(async()=>{const c=Ci.replace("// NOISE_KERNEL",St).replace("// VOLCANIC_KERNEL",wn).replace("// COAST_KERNEL",Ei),u=a.device.createShaderModule({code:c});return a.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),o.catch(()=>{}),a.pipelines.set(i,o)),{context:a,pipeline:o}}const Bi=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function jt(r,t,a){const n=r.device,i=Qe(t).n,o=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),c=t.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=c.map(l=>{const f=`generation:${l}`;let v=r.pipelines.get(f);if(!v){const x=n.createShaderModule({code:Ai.replace("// NOISE_KERNEL",St)});v=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[o]}),compute:{module:x,entryPoint:l}}),r.pipelines.set(f,v)}return v}),s=Fr.generation_at_resolution(t.seed,t.width,t.relief,t.motifSize,i),e=[];try{const l=s.parameters();t.procedural?.regionalN&&(l[2]=t.procedural.regionalN,l[4]=t.width*1.44/l[2]),l[6]*=t.procedural?.noiseScale??1;const f=(g,h)=>{const d=n.createBuffer({size:g.byteLength,usage:h|GPUBufferUsage.COPY_DST});return e.push(d),n.queue.writeBuffer(d,0,g),d},v=[f(l,GPUBufferUsage.UNIFORM),f(s.permutations(),GPUBufferUsage.STORAGE),f(s.gradients(),GPUBufferUsage.STORAGE)];a?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const x=await wr(Promise.all(u));a?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const U=c.map(g=>g==="coarse"?l[2]:l[1]).map((g,h)=>{const d=g*g*16,p=n.createBuffer({size:d,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),R=n.createBuffer({size:d,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});e.push(p,R);const C=n.createBindGroup({layout:x[h].getBindGroupLayout(0),entries:[...v,p].map((k,b)=>({binding:b,resource:{buffer:k}}))}),A=n.createCommandEncoder(),G=A.beginComputePass();return G.setPipeline(x[h]),G.setBindGroup(0,C),G.dispatchWorkgroups(Math.ceil(g/8),Math.ceil(g/8)),G.end(),A.copyBufferToBuffer(p,0,R,0,d),n.queue.submit([A.finish()]),R}),_=n.queue.onSubmittedWorkDone().then(()=>a?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),P=await Promise.all(U.map(async g=>{await g.mapAsync(GPUMapMode.READ);const h=new Float32Array(g.getMappedRange().slice(0));return g.unmap(),h}));return await _,{coarse:c.length===2?P[0]:new Float32Array,fine:P[P.length-1]}}finally{s.free(),e.forEach(l=>l.destroy())}}class $t{constructor(t,a,n,i){this.state=t,this.pipeline=a,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=i.sampling_parameters(),this.sourceN=i.source_resolution();let o=0;for(let e=this.sourceN;e>=1;e=Math.floor(e/2))o+=e*e;const c=this.parameters[5]===3?2:1;if(o*c*4>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=i.sampling_field();this.hasField=u.length>0;const s=u.length?u:new Float32Array(1);if(s.byteLength>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(s),this.perm=this.upload(i.sampling_permutations()),this.gradients=this.upload(i.sampling_gradients()),this.branches=this.upload(i.sampling_branches()),this.coast=this.upload(i.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(t,a=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,t.byteLength),usage:a|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,t),n}prepareCoastField(t){return this.dispatchField({x:0,y:0,extent:t.width,resolution:this.sourceN},t),this.output}dispatchField(t,a){const{x:n,y:i,extent:o,resolution:c}=t;if(![n,i,o,c].every(Number.isFinite)||n<0||i<0||o<=0||n+o>a.width+1e-4||i+o>a.width+1e-4||!Number.isInteger(c)||c<16||c>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,s=o/c,e=Math.max(a.motifSize/65536,s*.5),l=this.parameters,f=Math.floor(Math.log2(this.sourceN)),v=Math.min(f,Math.log2(Math.max(1,s*(a.relief==="flat"&&l[5]!==4?2/a.motifSize:1/a.width)*this.sourceN))),x=new Float32Array([l[0],l[1],l[2],l[3],l[4],l[5],this.hasField?1:0,c,n,i,o,s,Math.floor(v),Math.min(f,Math.floor(v)+1),v-Math.floor(v),e,l[6],l[7],this.sourceN,f,...Array.from({length:16},(P,g)=>l[8+g]??0)]),S=c*c*16;S>this.capacity&&(this.output?.destroy(),this.capacity=S,this.output=u.createBuffer({size:S,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((P,g)=>({binding:g,resource:{buffer:P}}))})),u.queue.writeBuffer(this.uniform,0,x);const U=u.createCommandEncoder(),_=U.beginComputePass();_.setPipeline(this.pipeline),_.setBindGroup(0,this.group),_.dispatchWorkgroups(Math.ceil(c/8),Math.ceil(c/8)),_.end(),u.queue.submit([U.finish()])}async sample(t,a,n,i){const o=performance.now(),c=this.state.device,{x:u,y:s,extent:e,resolution:l}=t;this.dispatchField(t,a);const f=l*l*16,v=c.createCommandEncoder();(!this.readback||this.readback.size<f)&&(this.readback?.destroy(),this.readback=c.createBuffer({size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),v.copyBufferToBuffer(this.output,0,this.readback,0,f),c.queue.submit([v.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,f);const x=this.readback.getMappedRange(0,f).slice(0);this.readback.unmap();const S=new Float32Array(x),U=new Float32Array(l*l),_=new Float32Array(l*l),P=new Float32Array(l*l),g=new Float32Array(l*l);let h=1/0,d=-1/0;for(let p=0;p<l*l;p++){const R=p*4;U[p]=S[R],_[p]=S[R+1],P[p]=S[R+2],g[p]=S[R+3],h=Math.min(h,U[p]),d=Math.max(d,U[p])}if(!Number.isFinite(h)||!Number.isFinite(d))throw new Error("Sortie GPU non finie.");return{x:u,y:s,width:e,resolution:l,minHeight:h,maxHeight:d,globalMinHeight:n,globalMaxHeight:i,motifSize:a.motifSize,height:U,normalX:_,normalY:P,normalZ:g,caveMask:new Uint8Array,generationMs:performance.now()-o,backend:this.mode,samplingMs:performance.now()-o}}dispose(){this.buffers.forEach(t=>t.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}const Ti=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`,Oi=`// Inspector-only readout. It never modifies simulation heights or drainage.\r
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
`,Gi=`// Full FP32 regional erosion. Dispatches are global synchronization boundaries.\r
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
`,qr=new WeakMap,st=new WeakMap,Wt=new Set;function Hr(r){r.nodes?.destroy(),r.fine?.destroy(),r.control.destroy()}const Yt=new WeakMap,lt=new WeakMap,Vt=new WeakMap,Jt=new WeakMap,xn=new WeakSet,Fi=512*1048576,Kt=1024,Li=1088,ct=Li+4096;function bn(r,t){const a=(Vt.get(r.device)??Promise.resolve()).then(t);return Vt.set(r.device,a.then(()=>{},()=>{})),a}async function qi(r,t,a,n){let i=Yt.get(r);i||(i=(async()=>{const e=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(S=>({binding:S,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(S=>({binding:S,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),l=r.createShaderModule({code:Gi.replace("// NOISE_KERNEL",St).replace("// VOLCANIC_KERNEL",wn)+Ti+Oi}),v=(await wr(l.getCompilationInfo())).messages.filter(S=>S.type==="error");if(v.length)throw new Error(v.map(S=>`${S.lineNum}: ${S.message}`).join(`
`));const x=r.createPipelineLayout({bindGroupLayouts:[e]});return{layout:e,module:l,pipelineLayout:x,values:new Map,pending:new Map}})(),Yt.set(r,i)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const o=await wr(i),c=[],u=[...t].reduce((e,l)=>e+(l==="solveTile"?a.size:1),0);let s=0;for(const e of t)for(const l of e==="solveTile"?a:[void 0]){const f=l===void 0?e:`solveTile:${l}`;let v=o.pending.get(f);v||(v=r.createComputePipelineAsync({layout:o.pipelineLayout,compute:{module:o.module,entryPoint:e,...l===void 0?{}:{constants:{SOLVE_MODE:l}}}}),v=v.then(x=>(o.values.set(f,x),x)),o.pending.set(f,v)),c.push(v.then(x=>(s++,n?.(`GPU · shaders d’érosion prêts ${s}/${u}`,{stage:"gpu-erosion-compile",completed:s,total:u}),x)))}return await wr(Promise.all(c)),xn.add(r),o}class Tr extends Error{}class Hi extends Error{}function kn(r,t,a,n,i){const o=Fr.erosion_at_resolution(r.seed,r.width,a,r.erosion,r.motifSize,r.mountainMix,t);try{const c=o.parameters(),u=n?pn(c,r,i):{parameters:c,surface:(i??c.slice(24,32)).slice()};return hn(u.parameters,u.surface,r,n,!!i),mn(u.surface,r,t),{noise:o,parameters:u.parameters,surface:u.surface,original:c}}catch(c){throw o.free(),c}}const Ii=["hills","mountains","mixed","high-mountains","valley","canyon"];function Di(r,t){const a=Qe(t).n,n=Xr(t),i=Ii.includes(t.relief)?t.relief:t.relief==="flat"?"hills":"mixed",{noise:o,parameters:c,surface:u}=kn(t,a,i,n);o.free();const s=c[2],e=u[0],l=u[3],f=In(r.device.limits,a,Math.max(s,t.erosion>0&&(!n||l>0)?e:0));return{sourceN:a,regionalN:s,regionalSteps:c[13],surfaceN:e,surfaceSteps:l,pipelinesReady:xn.has(r.device),error:f}}async function ji(r,t,a,n,i){return bn(r,()=>$i(r,t,a,n,i))}async function $i(r,t,a,n,i){const o=Qe(t).n;for(const c of[1,2,4,8,16])try{return await Sn(r,t,o,c,void 0,{source:a,tuning:n},void 0,i)}catch(u){if(!(u instanceof Tr)||c===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function Xt(r,t,a,n){return a?.control?.backend?.("gpu"),bn(r,()=>Wi(r,t,a,n))}async function Wi(r,t,a,n){const i=Qe(t).n;if(t.relief==="volcano"||t.relief==="caldera"||t.relief==="plateau"){const o=Fr.finite_shape(t.seed,t.motifSize,t.relief,t.erosion),c=o.parameters();o.free();const u=t.environment??"mixed",s=t.motifSize*c[15];let e;if(u==="flat"){const v=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),e=ke.prepare_environment_at_resolution(t.seed,t.width,u,t.erosion,s,i),a&&(a.nativeEnvironmentMs=performance.now()-v)}else e=await ut(r,{...t,motifSize:s,relief:u,mountainMix:.5},i,void 0,a,n);const l=await ut(r,{...t,width:t.motifSize},i,c,a,n),f=new Float32Array(l.length+e.length);return f.set(l),f.set(e,l.length),f}return ut(r,t,i,void 0,a,n)}async function ut(r,t,a,n,i,o){for(const c of[1,2,4,8,16])try{return await Sn(r,t,a,c,n,void 0,i,o)}catch(u){if(!(u instanceof Tr)||c===16)throw u}throw new Error("Érosion GPU non convergée.")}async function Sn(r,t,a,n,i,o,c,u){const s=r.device,e=o?void 0:c?.control,l=Xr(t),f=!!t.generalSeed&&mt(t.generalSeed,d=>d.startsWith("relief-"))!==vn(t.generalSeed),{noise:v,parameters:x,surface:S,original:U}=kn(t,a,o||l&&t.relief==="flat"?"hills":i?"mixed":t.relief,l,o?.tuning);let _=lt.get(s);if(!_){_=[],lt.set(s,_);const d=_;s.lost.then(()=>d.forEach(p=>p.destroy()))}const P=!!e&&e.previews!==!1&&a<=Kt;let g=!!e&&e.previews!==!1,h=0;try{l&&t.procedural&&ne(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural.erosionTuning?.detail===void 0&&(x[16]=U[16]);const d=x.slice(0,24),p=d[2],R=d[13],C=d[18],A=o?[1,0,0,.2,1,1,0,0]:Array.from(x.slice(33,41)),G=A.slice();G[4]=1;const k=!o&&A[6]>.5,b=Math.min(n,4),z=d.slice();z[2]=S[0],z[4]=S[1],z[5]=S[2],z[15]=i&&!o?i[13]:S[4],z[18]=S[5],z[22]=S[6];const j=Math.max(1,z[2]/1048),W=Math.ceil(Math.min((i||o||t.relief==="mixed"?64:32)*n,512)*j),B=!o&&ne(t,"phasor",l)?"generationPhasorPack":"packHeight",F=l?"compactInitialize":"initialize",J=!!o||ne(t,"surface",!l||t.relief==="canyon")&&(!l||t.relief==="canyon"||S[3]>0),pe=()=>{o||c?.onPhysicalPlan?.(t.erosion>0&&J&&S[3]>0?S[1]:void 0,!i&&t.erosion>0&&(ne(t,"regional")||ne(t,"regionalFinish"))?d[4]:void 0)},re=t.procedural?.reconstruction&&t.procedural.reconstruction!=="default"?"generationReconstruct":l?"compactReconstruct":"reconstruct",fe=new Set([B,...ne(t,"amplitude")?[]:["generationUnitScale"],...ne(t,"normalize")?[]:["generationKeepDatum"],...e?["generationPreview"]:[],...!o&&!i&&t.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),ie=new Set,K=(...m)=>m.forEach(M=>fe.add(M));f&&!o&&!i&&K("generationCut","generationRegionalRead","generationPreview"),(o||!i&&(f||t.procedural))&&K("seaLandMark","seaMaskGrow");const Se=()=>K("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");o?K("coastLoad","coastResult"):K("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!o&&!i?(K(F,"uplift","bounds",re,"detail"),C>0&&(Se(),K("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(m=>ie.add(m)))):i&&!o&&K("volcanicInitial"),t.erosion>0&&J&&(Se(),K("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),ie.add(1),ie.add(3),t.relief==="canyon"&&!o&&(K("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),ie.add(0)),k&&(K("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),ie.add(0))),e&&await e.before("grids",`Budget ×${n} · régional ${p}² · surface ${z[2]}² · sortie ${a}²`);const Ie=performance.now(),ve=await qi(s,fe,ie,u),we=performance.now()-Ie,Pe=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let ze=!1;const ce=(m,M)=>{const N=h++;let T=_[N];return(!T||T.size<m||T.usage!==M)&&(T?.destroy(),T=s.createBuffer({size:m,usage:M}),_[N]=T,ze=!0),T},Ue=m=>{const M=ce(m.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return s.queue.writeBuffer(M,0,m),M},_e=t.erosion>0&&J?Math.max(p,z[2]):p,he=a**2,ye=he*4,Ne=he*16,me=Math.max(he,p*p)*4;s.pushErrorScope("out-of-memory");const Ce=ce(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),Ae=ce(_e**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ge=ce(Ne,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Fe=ce(ct,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ee=ce(me,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),de=ce(me+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),er=ce(Math.ceil(_e/16)**2*8,GPUBufferUsage.STORAGE),fr=s.popErrorScope();if(ze&&await fr)throw g=!0,new Hi(`WebGPU : mémoire insuffisante pour la source ${a}² et la grille d’érosion ${_e}².`);g||=_.reduce((m,M)=>m+M.size,0)>Fi;const De=m=>de.mapAsync(GPUMapMode.READ,0,m),rr=m=>de.getMappedRange(0,m),Ve=!o&&!i&&!!(t.procedural||f),dr=Ve&&a<=Kt,Re=P||Ve;let y=Re?void 0:Jt.get(s);if(!Re&&!y&&s.features.has("timestamp-query")){y=s.createQuerySet({type:"timestamp",count:6}),Jt.set(s,y);const m=y;s.lost.then(()=>m.destroy())}const w=y?ce(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,Y=y?ce(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,I=(m,M)=>s.createBindGroup({layout:ve.layout,entries:[{binding:0,resource:{buffer:Ce,size:224}},...[Ue(m),Ue(M),Ae,Ge,Fe,Ee,er].map((N,T)=>({binding:T+1,resource:{buffer:N}}))]});let X=I(v.permutations(),v.gradients());const oe=new Map([[t.seed,X]]),O=m=>{const M={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[m];if(!M||!t.generalSeed)return;const N=Ye(t.generalSeed,M);let T=oe.get(N);if(!T){const le=Fr.erosion(N,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix);try{T=I(le.permutations(),le.gradients())}finally{le.free()}oe.set(N,T)}X=T},E=new Map;let ae=A;const $=(m,M)=>{const N=[...M,...m,...ae].join(",");let T=E.get(N);if(T===void 0){if(T=E.size*256,T+224>65536)throw new Error("Too many GPU variants.");E.set(N,T),s.queue.writeBuffer(Ce,T,new Float32Array([...M,...m,...l?Et(t,!!o):!i&&!o&&ne(t,"phasor",!1)?Et(t):i??new Float32Array(16),...ae]))}return T};let D=s.createCommandEncoder();D.clearBuffer(Fe),o&&D.copyBufferToBuffer(o.source,0,Ge,0,Ne);const Z=m=>D.beginComputePass(y?{timestampWrites:{querySet:y,beginningOfPassWriteIndex:m,endOfPassWriteIndex:m+1}}:void 0);let L=Z(0);const te=[0,0,1,0,0,0,.6,0];te[4]=x[32];const se=[0,0,.95,C*.5,0,0,.5,0];let Q=d;const q=(m,M=te,N=Math.ceil(Q[2]**2/256),T=1)=>{L.setPipeline(ve.values.get(m==="solveTile"?`solveTile:${M[1]}`:m)),L.setBindGroup(0,X,[$(M,Q)]),L.dispatchWorkgroups(N,T)},xe=Math.ceil(he/256),Je=Math.ceil(xe/s.limits.maxComputeWorkgroupsPerDimension),ge=(m,M=te)=>q(m,M,Math.ceil(xe/Je),Je),qe=(m,M,N=!1)=>{const T=te.slice();T[1]=m,T[7]=N?1:0,q(m===0?"floodInit":"graphInit",T),q("start",T,1);const le=[0,1].map(be=>(T[0]=be,$(T,Q)));for(let be=0;be<M;be++){const or=[le[be&1]];L.setPipeline(ve.values.get("clearNext")),L.setBindGroup(0,X,or),L.dispatchWorkgroups(1),L.setPipeline(ve.values.get(`solveTile:${m}`)),L.dispatchWorkgroups(Math.ceil(Q[2]/16),Math.ceil(Q[2]/16))}T[0]=0,q("solveStats",T,1),m===0?(q("floodCheck",T,1),q("receivers")):q("graphFinish",T)},Zr=(m=te,M=!0)=>{q("pitInit");for(let N=0;N<8*b+Math.ceil(Math.log2(Math.max(1,Q[2]/1048)));N++)q("pitUnion"),q("pitCompress");for(const N of M?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])q(N,m)},Qr=m=>{if(m<=0)return;const M=te.slice();M[6]=m,q("breachInit"),q("breach",M),q("breachFinish")},et=(m,M=te)=>{if(!(Q===d&&t.procedural?.regionalThermal===!1))for(let N=0;N<m;N++)for(const T of["thermalFlux","thermalApply","copyHeight"])q(T,M)},Lr=(m,M=te)=>{if(Q===d&&t.procedural?.regionalDiffusion===!1)return;const N=M.slice();N[3]=m,q("diffuse",N),q("copyHeight",N)},zt=m=>{const M=Dn(jn({surfaceSteps:S[3],surfaceCell:S[1],regionalCell:d[4],sourceCell:d[11],warp:A[5]*Math.min(16*d[3],d[4]*.9)}),t.width);if(M===void 0)return;const N=te.slice();N[7]=m,m===0?q("seaLandMark",N):ge("seaLandMark",N),N[5]=M,q("seaMaskGrow",N,2)},Ut=m=>{const M=te.slice();M[4]=m,q("percentileInit",M,1);for(const N of[24,16,8,0])M[5]=N,q("histogramClear",M,1),ge("histogram",M),q("percentileSelect",M,1)},Ct=async(m,M,N)=>{if(!e)return;if(!P){await e.after(m,void 0,N);return}if(M!==3){const or=te.slice();or[7]=M,ge("generationPreview",or)}L.end(),D.copyBufferToBuffer(Ee,0,de,0,ye),D.copyBufferToBuffer(Fe,0,de,ye,1088),s.queue.submit([D.finish()]),await De(ye+1088);const T=rr(ye+1088),le=new Uint32Array(T,ye,272)[2],be=new Float32Array(T,0,he).slice();if(de.unmap(),le)throw new Tr("Érosion GPU non convergée pendant une étape.");if(!be.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await e.after(m,be,N),D=s.createCommandEncoder(),L=Z(0)},pr=kt(t),Cn=Jr(t);let Be=dr?qr.get(s):void 0;if(dr&&!Be){Be=new Map,qr.set(s,Be),Wt.add(s);const m=Be;s.lost.then(()=>{m.forEach(Hr),m.clear(),Wt.delete(s)})}const xr=m=>`${n}|${Cn.get(m)}`;let tr=0;for(;Be&&tr<pr.length&&Be.get(pr[tr])?.key===xr(pr[tr]);)tr++;if(Be)for(const m of[...pr.slice(tr),"phasor"]){const M=Be.get(m);M&&(m!=="phasor"||M.key!==xr(m)||tr<pr.length)&&(Hr(M),Be.delete(m))}const An=m=>{L.end(),m.nodes&&D.copyBufferToBuffer(m.nodes,0,Ae,0,m.nodes.size),m.fine&&D.copyBufferToBuffer(m.fine,0,Ge,0,m.fine.size),D.copyBufferToBuffer(m.control,0,Fe,0,ct),L=Z(0)},En=(m,M)=>{if(!Be)return;L.end();const N=(le,be=le.size)=>{const or=s.createBuffer({size:be,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return D.copyBufferToBuffer(le,0,or,0,be),or},T=Be.get(m);T&&Hr(T),Be.set(m,{key:xr(m),kind:M,...M===0?{nodes:N(Ae,p*p*112)}:{fine:N(Ge,Ne)},control:N(Fe,ct)}),s.queue.submit([D.finish()]),D=s.createCommandEncoder(),L=Z(0)},Rn=async(m,M)=>{if(!e)return;if(!P){e.cached?await e.cached(m):(await e.before(m),await e.after(m));return}const N=te.slice();N[7]=M.kind,ge("generationPreview",N),L.end(),D.copyBufferToBuffer(Ee,0,de,0,ye),s.queue.submit([D.finish()]),await De(ye);const T=new Float32Array(rr(ye),0,he).slice();de.unmap(),e.cached?await e.cached(m,T):(await e.before(m),await e.after(m,T)),D=s.createCommandEncoder(),L=Z(0)},Ke=async(m,M,N)=>{const T=pr.indexOf(m),le=Be?.get(m);if(le&&T>=0&&T<tr){(P||T===tr-1)&&An(le),await Rn(m,le);return}await e?.before(m),O(m),await N(),En(m,M),await Ct(m,M)},Nn=t.procedural?.coastAfter??"initialize",hr=async(m,M)=>{!Ve||m!==Nn||await Ke("coastCut",M===4?5:M,async()=>{if(!pt(t,"coastCut"))return;const N=te.slice();N[7]=M,M===0?q("generationRegionalRead",N,Math.ceil(p*p/256)):ge("generationPreview",N),L.end();const T=M===0?p*p:he;D.copyBufferToBuffer(Ee,0,de,0,T*4),s.queue.submit([D.finish()]),await De(T*4);const le=new Float32Array(rr(T*4),0,T).slice();de.unmap();const be=_i(gn,Ye(t.generalSeed??t.seed,"relief-coast-cut"),t.width,x[3]*2400,x[12],t.coastMask,t.islandMode??"island",M===0?p:a,M===0?d[5]:0,M===0?d[4]:d[11],le,Gr(t));s.queue.writeBuffer(Ee,0,be),D=s.createCommandEncoder(),L=Z(0),M===0?q("generationCut",N,Math.ceil(p*p/256)):ge("generationCut",N),zt(M)})};e&&await e.after("grids",void 0,`Budget ×${n} · régional ${p}² · surface ${z[2]}² · ${(_.reduce((m,M)=>m+M.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${R} cycles de relief et ${S[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),o?(Q=z,ge("coastLoad"),zt(2)):i?(e&&await e.before("initialize"),Q=z,ge("volcanicInitial"),e&&await Ct("initialize",2)):(await Ke("initialize",0,()=>{q(F)}),await hr("initialize",0),await Ke("regional",0,()=>{for(let m=0;m<(ne(t,"regional")?R:0);m++){if(q("uplift"),C>0){qe(0,64*b),Zr(),q("flow"),Qr(A[1]),qe(1,128*b),qe(2,128*b),et(3);const M=d[17]*3*C;for(let N=0;N<Math.floor(M);N++)Lr(.5);M%1>0&&Lr(.5*(M%1))}q("bounds")}}),await Ke("regionalFinish",0,()=>{const m=te.slice();if(m[7]=1,q("bounds",m),C>0&&ne(t,"regionalFinish")){et(4,se);for(let M=0;M<6;M++)qe(0,64*b),Zr(se),q("flow"),Qr(A[2]);Lr(C*.5,se)}}),await hr("regionalFinish",0),await Ke("reconstruct",1,()=>{const m=te.slice();m[7]=t.procedural?.reconstruction==="bspline"?1:0,ge(re,m)}),await Ke("amplitude",4,()=>{ne(t,"amplitude")?Ut(0):q("generationUnitScale",te,1)}),await hr("amplitude",4),await Ke("ridged",2,()=>{ge("detail")}),await hr("ridged",2)),L.end(),L=Z(2),await Ke("surface",2,()=>{if(t.erosion>0&&J){if(Q=z,ae=G,q("surfaceLoad"),t.relief==="canyon"&&!o){const m=Math.ceil(128*b*j);qe(0,m),q("flow"),qe(1,m),q("canyonSeed");let M=0;const N=[];for(let le=2**(Math.ceil(Math.log2(z[2]))-1);le>=1;le/=2)N.push(le);N.push(1,1);for(const le of N){const be=te.slice();be[0]=M,be[1]=le,q("canyonSpread",be),M=1-M}const T=te.slice();T[0]=M,q("canyonApply",T)}for(let m=0;m<S[3];m++)k?(qe(0,W),Zr(te,!1),q("flow"),Qr(A[7])):(q("surfaceFlowInit"),q("receivers"),q("flow")),qe(1,W,!0),qe(3,W,!0),et(1),Lr(S[7]);q("surfaceDelta"),ge("surfaceReconstruct")}}),await hr("surface",2),L.end(),L=Z(4),await Ke("normalize",1,()=>{o?ge("coastResult"):ne(t,"normalize")?(Ut(1),ge("normalize")):ge("generationKeepDatum")}),await hr("normalize",1);let br=st.get(s);br||(br=new bt,st.set(s,br));const kr=dr?br.get("phasor",xr("phasor")):void 0;if(kr)return L.end(),s.queue.submit([D.finish()]),e?.cached?await e.cached("phasor",P?kr:void 0):(await e?.before("phasor"),await e?.after("phasor",kr)),pe(),kr;kr||await e?.before("phasor"),ge(B),L.end();const Sr=ye;D.copyBufferToBuffer(Ee,0,de,0,Sr),D.copyBufferToBuffer(Fe,0,de,Sr,1088),y&&w&&Y&&(D.resolveQuerySet(y,0,6,w,0),D.copyBufferToBuffer(w,0,Y,0,48));const Bn=D.finish(),Tn=performance.now()-Pe;u?.(o?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const On=performance.now();s.queue.submit([Bn]);const Gn=s.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([De(Sr+1088),Y?.mapAsync(GPUMapMode.READ),Gn]);const Fn=performance.now()-On,Ln=performance.now(),At=rr(Sr+1088),rt=new Uint32Array(At,Sr,272),qn=Array.from(rt.slice(267,271)),tt={factor:n,sourceSize:a,coarseSize:p,surfaceSize:z[2],pipelineMs:we,encodeMs:Tn,submitReadbackMs:Fn,unpackMs:0,maxSolveSteps:qn,allocatedBytes:_.reduce((m,M)=>m+M.size,0)};if(Y){const m=new BigUint64Array(Y.getMappedRange());tt.gpuStagesMs={coarse:Number(m[1]-m[0])/1e6,surface:Number(m[3]-m[2])/1e6,normalization:Number(m[5]-m[4])/1e6},Y.unmap()}if(c&&(c.profiles??=[]).push(tt),rt[2]!==0)throw de.unmap(),new Tr(`Érosion GPU non convergée (${rt[2]} cellules/étapes, budget ×${n}).`);const _r=new Float32Array(At,0,he).slice();de.unmap(),tt.unpackMs=performance.now()-Ln;const Hn=o||Ve&&pt(t,"coastCut")?-1/0:.3-1e-7;for(let m=0;m<he;m++)if(!Number.isFinite(_r[m])||_r[m]<Hn)throw new Error("Champ GPU invalide.");return pe(),dr&&br.put("phasor",xr("phasor"),_r),e&&await e.after("phasor",P?_r:void 0,"Sortie GPU lue et validée"),_r}catch(d){throw d instanceof Tr&&(qr.get(s)?.forEach(Hr),qr.get(s)?.clear(),st.delete(s)),d}finally{v.free(),_.forEach(d=>{d.mapState!=="unmapped"&&d.unmap(),g&&d.destroy()}),g&&lt.delete(s)}}const Yi=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`,Vi=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],Zt=new WeakMap,Qt=new WeakMap;function Ji(r){let t=Zt.get(r);return t||(t=(async()=>{const a=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=r.createShaderModule({code:Yi}),o=(await n.getCompilationInfo()).messages.filter(s=>s.type==="error");if(o.length)throw new Error(`Hydrologie WGSL : ${o.map(s=>`${s.lineNum}: ${s.message}`).join(`
`)}`);const c=r.createPipelineLayout({bindGroupLayouts:[a]}),u=await Promise.all(Vi.map(async s=>[s,await r.createComputePipelineAsync({layout:c,compute:{module:n,entryPoint:s}})]));return{layout:a,values:new Map(u)}})(),Zt.set(r,t)),t}function Ki(r){let t=2166136261;for(let a=0;a<r.length;a++)t=Math.imul(t^r.charCodeAt(a),16777619);return t>>>0}function Xi(r,t,a){const n=new Uint32Array(r.length);if(!a)return{mask:n,count:0};const i=new Uint8Array(r.length),o=new Uint32Array(r.length);let c=0,u=0,s=0;const e=f=>{i[f]===0&&r[f]<=0&&(i[f]=1,o[u++]=f)},l=f=>{if(i[f]!==0||r[f]>0)return;c=0,u=0,e(f);let v=!1;for(;c<u;){const x=o[c++],S=x%t,U=Math.floor(x/t);v||=S+1<t&&U+1<t&&r[x+1]<=0&&r[x+t]<=0&&r[x+t+1]<=0;for(let _=-1;_<=1;_++){const P=U+_;if(!(P<0||P>=t))for(let g=-1;g<=1;g++){const h=S+g;h>=0&&h<t&&e(P*t+h)}}}if(v){for(let x=0;x<u;x++)n[o[x]]=1;s+=u}};for(let f=0;f<t;f++)l(f),l((t-1)*t+f);for(let f=1;f+1<t;f++)l(f*t),l(f*t+t-1);return{mask:n,count:s}}class Zi{constructor(t,a,n){this.device=t,this.n=a,this.program=n,this.buffers=[],this.pending=Promise.resolve();const i=a*a,o=(u,s)=>{const e=t.createBuffer({size:u,usage:s});return this.buffers.push(e),e};this.uniform=o(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=o(i*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=o(i*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const c=o(i*48,GPUBufferUsage.STORAGE);this.control=o(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=o(i*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=o(i*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=o(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=t.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,c,this.control,this.output].map((u,s)=>({binding:s+1,resource:{buffer:u}}))]}),t.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(t,a,n,i){const o=this.pending.then(()=>this.execute(t,a,n,i));return this.pending=o.then(()=>{},()=>{}),o}async execute(t,a,n,i){const o=performance.now(),c=this.n,u=c*c,s=a/c,e=Xi(t,c,i),l=performance.now()-o,f=this.device;f.queue.writeBuffer(this.source,0,t),f.queue.writeBuffer(this.sea,0,e.mask);for(let B=0;B<2;B++){const F=new ArrayBuffer(32);new Uint32Array(F,0,4).set([c,Ki(n),B,i?1:0]),new Float32Array(F,16,4).set([s,s*s,Math.max(.1,s*.1),0]),f.queue.writeBuffer(this.uniform,B*256,F)}const v=(B,F,J=0)=>{B.setPipeline(this.program.values.get(F)),B.setBindGroup(0,this.group,[J*256]),F==="solveTile"?B.dispatchWorkgroups(Math.ceil(c/16),Math.ceil(c/16)):B.dispatchWorkgroups(F==="reset"||F==="clearNext"?1:Math.ceil(u/256))},x=performance.now(),S=f.createCommandEncoder(),U=S.beginComputePass();v(U,"reset"),v(U,"initialize"),U.end(),f.queue.submit([S.finish()]);let _=0,P=!1,g=32;const h=Math.max(256,c);for(;_<h;){const B=f.createCommandEncoder(),F=B.beginComputePass();for(let pe=0;pe<g;pe++){const re=_+pe&1;v(F,"clearNext",re),v(F,"solveTile",re)}F.end(),B.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),f.queue.submit([B.finish()]),_+=g,g=Math.min(g*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const J=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),J===0){P=!0;break}}if(!P)throw new Error(`Drainage hydrique GPU non convergé après ${_} passes (${c}²) ; repli CPU requis.`);const d=f.createCommandEncoder(),p=d.beginComputePass();v(p,"receivers");const R=Math.ceil(Math.log2(u));for(let B=0;B<R;B++){const F=B&1;v(p,"accumulateCopy",F),v(p,"accumulateScatter",F)}v(p,"finish",R&1),p.end();const C=u*16;d.copyBufferToBuffer(this.output,0,this.readback,0,C),d.copyBufferToBuffer(this.control,0,this.readback,C,16),f.queue.submit([d.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const A=performance.now()-x,G=performance.now();let k,b,z,j;try{const B=this.readback.getMappedRange(),F=new Uint32Array(B,C,4);if(F[2]!==0||F[3]!==u-e.count)throw new Error(`Drainage hydrique GPU invalide (${F[2]} erreurs, ${F[3]}/${u-e.count} cellules drainées) ; repli CPU requis.`);const J=new Float32Array(B,0,u*4),pe=new Uint32Array(B,0,u*4);k=new Float32Array(u),b=new Uint32Array(u),z=new Float32Array(u),j=new Float32Array(u);for(let re=0;re<u;re++)k[re]=J[re*4],b[re]=pe[re*4+1],z[re]=J[re*4+2],j[re]=J[re*4+3]}finally{this.readback.unmap()}const W=new Uint8Array(e.mask);return{filled:k,receivers:b,accumulation:z,potential:j,seaMask:W,preprocessingMs:l,computeMs:A,readbackMs:performance.now()-G,floodPasses:_}}}async function Qi(r,t,a,n,i=!1){if(![256,512,1024].includes(a)||r.length!==a*a||!Number.isFinite(t)||t<=0||!r.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const o=await _t();if(!o||o.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const c=await Ji(o.device);if(o.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=Qt.get(o.device);u||(u=new Map,Qt.set(o.device,u));let s=u.get(a);return s||(s=new Zi(o.device,a,c),u.set(a,s)),s.run(r,t,n,i)}const en=new WeakMap;function ea(r){const t=en.get(r);if(t)return t;const a=new Float32Array(r.baseHeight.length),n=[],i=g=>r.drainageHeight[g]<r.rawDrainageHeight[g]&&r.surfaceHeight[g]<r.baseHeight[g];let o=!1;for(let g=0;g<a.length;g++){const h=i(g);h&&n.push(g),a[g]=h?0:r.surfaceHeight[g]-r.baseHeight[g],o||=a[g]!==0}const c=256,u=r.width/c,s=new Map,e=[],l=r.riverPoints,f=new Map,v=[],x=r.resolution,S=r.width/x,U=g=>Math.min(S*2,Math.max(S*.5,(r.baseHeight[g]-r.surfaceHeight[g])*1.4)),_=g=>((Math.imul(g^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const g of n){const h=g%x,d=Math.floor(g/x),p=(h+.5)*S,R=(d+.5)*S,C=[];for(let A=-1;A<=1;A++)for(let G=-1;G<=1;G++){const k=h+G,b=d+A,z=b*x+k;if(!G&&!A||k<0||b<0||k>=x||b>=x)continue;const j=i(z);(j&&z>g||!j&&r.basins[z]&&r.surfaceHeight[z]<=r.surfaceHeight[g])&&C.push(z)}C.length||C.push(g);for(const A of C){const G=(A%x+.5)*S,k=(Math.floor(A/x)+.5)*S,b=v.length,z=U(g),j=U(A),W=_(g),B=Math.max(z,j)*(1+Math.abs(W));v.push({a:g,b:A,ra:z,rb:j,skew:W});const F=Me(Math.min(p,G)-B,u,c),J=Me(Math.max(p,G)+B,u,c),pe=Me(Math.min(R,k)-B,u,c),re=Me(Math.max(R,k)+B,u,c);for(let fe=pe;fe<=re;fe++)for(let ie=F;ie<=J;ie++){const K=fe*c+ie,Se=f.get(K);Se?Se.push(b):f.set(K,[b])}}}if(r.incision>0)for(let g=0;g<r.riverCount;g++)for(let h=r.riverOffsets[g];h+1<r.riverOffsets[g+1];h++){const d=h+1,p=Math.max(l[h*4+2],l[d*4+2])*.65+.5,R=e.length;e.push({a:h,b:d,estuary:r.riverMeta[g*6+5]});const C=Me(Math.min(l[h*4],l[d*4])-p,u,c),A=Me(Math.max(l[h*4],l[d*4])+p,u,c),G=Me(Math.min(l[h*4+1],l[d*4+1])-p,u,c),k=Me(Math.max(l[h*4+1],l[d*4+1])+p,u,c);for(let b=G;b<=k;b++)for(let z=C;z<=A;z++){const j=b*c+z,W=s.get(j);W?W.push(R):s.set(j,[R])}}const P={delta:a,hasDelta:o,hasSea:r.basins.includes(0),buckets:s,segments:e,bucketSize:u,side:c,notchBuckets:f,notches:v};return en.set(r,P),P}const Me=(r,t,a)=>Math.max(0,Math.min(a-1,Math.floor(r/t)));function rn(r,t,a,n,i){const o=new Int32Array(a*4),c=new Float64Array(a*4);for(let u=0;u<a;u++){const s=Math.max(0,Math.min(i-1,(r+(u+.5)*t)/n-.5)),e=Math.floor(s),l=s-e,f=1-l;for(let v=0;v<4;v++)o[u*4+v]=Math.max(0,Math.min(i-1,e+v-1));c.set([f**3/6,(3*l**3-6*l*l+4)/6,(-3*l**3+3*l*l+3*l+1)/6,l**3/6],u*4)}return{indices:o,weights:c}}function _n(r,t,a=!0){const n=r.resolution,i=r.width/n,o=ea(t);if(!o.hasDelta&&!o.segments.length&&!o.notches.length)return;const c=a?new Float32Array(n*n):void 0;if(o.hasDelta){const h=t.resolution,d=t.width/h,p=rn(r.x,i,n,d,h),R=rn(r.y,i,n,d,h),C=R.indices[0],A=R.indices[R.indices.length-1],G=new Float64Array((A-C+1)*n);for(let k=C;k<=A;k++){const b=k*h,z=(k-C)*n;for(let j=0;j<n;j++){const W=j*4;G[z+j]=o.delta[b+p.indices[W]]*p.weights[W]+o.delta[b+p.indices[W+1]]*p.weights[W+1]+o.delta[b+p.indices[W+2]]*p.weights[W+2]+o.delta[b+p.indices[W+3]]*p.weights[W+3]}}for(let k=0;k<n;k++)for(let b=0;b<n;b++){const z=k*4;let j=G[(R.indices[z]-C)*n+b]*R.weights[z]+G[(R.indices[z+1]-C)*n+b]*R.weights[z+1]+G[(R.indices[z+2]-C)*n+b]*R.weights[z+2]+G[(R.indices[z+3]-C)*n+b]*R.weights[z+3];if(j>0&&o.hasSea&&r.height[k*n+b]<=0){const W=Math.max(0,Math.min(h-1,Math.floor((r.x+(b+.5)*i)/d))),B=Math.max(0,Math.min(h-1,Math.floor((r.y+(k+.5)*i)/d))),F=B*h+W;(!t.basins[F]||t.baseHeight[F]>=0)&&(j=0)}c&&(c[k*n+b]=j),r.height[k*n+b]+=j}}const u=new Set,{bucketSize:s,side:e}=o;for(let h=Me(r.y,s,e);h<=Me(r.y+r.width,s,e);h++)for(let d=Me(r.x,s,e);d<=Me(r.x+r.width,s,e);d++)for(const p of o.buckets.get(h*e+d)??[])u.add(p);const l=new Float32Array(n*n),f=t.riverPoints,v=(h,d)=>Math.max(0,Math.min(n-1,Math.floor((h-d)/i))),x=new Set;for(let h=Me(r.y,s,e);h<=Me(r.y+r.width,s,e);h++)for(let d=Me(r.x,s,e);d<=Me(r.x+r.width,s,e);d++)for(const p of o.notchBuckets.get(h*e+d)??[])x.add(p);const S=t.resolution,U=t.width/S,_=U*.25;for(const h of x){const{a:d,b:p,ra:R,rb:C,skew:A}=o.notches[h],G=Math.max(R,C)*(1+Math.abs(A)),k=(d%S+.5)*U,b=(Math.floor(d/S)+.5)*U,z=(p%S+.5)*U,j=(Math.floor(p/S)+.5)*U,W=z-k,B=j-b,F=W*W+B*B,J=Math.min(k,z)-G,pe=Math.max(k,z)+G,re=Math.min(b,j)-G,fe=Math.max(b,j)+G;if(pe<r.x||J>r.x+r.width||fe<r.y||re>r.y+r.width)continue;const ie=Math.abs(B)>1e-12,K=ie?G*Math.sqrt(F)/Math.abs(B):0;for(let Se=v(re,r.y);Se<=v(fe,r.y);Se++){const Ie=r.y+(Se+.5)*i,ve=ie?k+W*(Ie-b)/B:0,we=ie?Math.max(J,ve-K):J,Pe=ie?Math.min(pe,ve+K):pe;if(!(we>Pe||Pe<r.x||we>r.x+r.width))for(let ze=v(we,r.x);ze<=v(Pe,r.x);ze++){const ce=r.x+(ze+.5)*i,Ue=F?Math.max(0,Math.min(1,((ce-k)*W+(Ie-b)*B)/F)):0,_e=Math.hypot(ce-k-W*Ue,Ie-b-B*Ue),he=_+(R+(C-R)*Ue-_)*(1+A*Math.sign((ce-k)*B-(Ie-b)*W));if(_e>=he)continue;const ye=Math.max(0,(_e-_)/(he-_)),Ne=1-ye*ye*(3-2*ye),me=t.surfaceHeight[d]+(t.surfaceHeight[p]-t.surfaceHeight[d])*Ue,Ce=Se*n+ze;l[Ce]=Math.max(l[Ce],Math.max(0,r.height[Ce]-me)*Ne)}}}for(const h of u){const{a:d,b:p,estuary:R}=o.segments[h],C=f[d*4],A=f[d*4+1],G=f[p*4],k=f[p*4+1],b=f[d*4+2],z=f[p*4+2],j=f[d*4+3],W=f[p*4+3],B=Math.max(Math.max(b,z)*.65,.5),F=G-C,J=k-A,pe=F*F+J*J,re=Math.min(C,G)-B,fe=Math.max(C,G)+B,ie=Math.min(A,k)-B,K=Math.max(A,k)+B;if(fe<r.x||re>r.x+r.width||K<r.y||ie>r.y+r.width)continue;const Se=v(ie,r.y),Ie=v(K,r.y),ve=Math.abs(J)>1e-12,we=ve?B*Math.hypot(F,J)/Math.abs(J):0;for(let Pe=Se;Pe<=Ie;Pe++){const ze=r.y+(Pe+.5)*i,ce=ve?C+F*(ze-A)/J:0,Ue=ve?Math.max(re,ce-we):re,_e=ve?Math.min(fe,ce+we):fe;if(Ue>_e||_e<r.x||Ue>r.x+r.width)continue;const he=v(Ue,r.x),ye=v(_e,r.x);for(let Ne=he;Ne<=ye;Ne++){const me=r.x+(Ne+.5)*i,Ce=Math.max(0,Math.min(1,((me-C)*F+(ze-A)*J)/Math.max(pe,.001))),Ae=b+(z-b)*Ce,Ge=j+(W-j)*Ce,Fe=Math.hypot(me-C-F*Ce,ze-A-J*Ce),Ee=Math.max(0,1-Fe/Math.max(Ae*.65,.5))**2;if(!Ee)continue;const de=Math.max(.35,Math.min(12,Ae*.11))*t.incision,er=Pe*n+Ne,fr=Math.max(0,Math.min(de*2+.75,r.height[er]-(Ge-de)))*Ee*(R>1&&Ge<de?1.15:1);l[er]=Math.max(l[er],fr)}}}let P=1/0,g=-1/0;for(let h=0;h<n*n;h++)r.height[h]-=l[h],c&&(c[h]-=l[h]),P=Math.min(P,r.height[h]),g=Math.max(g,r.height[h]);if(c)for(let h=0;h<n;h++)for(let d=0;d<n;d++){const p=h*n+d,R=Math.max(0,d-1),C=Math.min(n-1,d+1),A=Math.max(0,h-1),G=Math.min(n-1,h+1),k=c[h*n+C]-c[h*n+R],b=c[G*n+d]-c[A*n+d];if(k===0&&b===0)continue;const z=Math.max(1e-6,r.normalZ[p]),j=-r.normalX[p]/z+k/((C-R)*i||i),W=-r.normalY[p]/z+b/((G-A)*i||i),B=Math.hypot(j,W,1);r.normalX[p]=-j/B,r.normalY[p]=-W/B,r.normalZ[p]=1/B}r.minHeight=P,r.maxHeight=g}const ft=new Float32Array(0);function tn(r,t){const a={...r,normalX:ft,normalY:ft,normalZ:ft};_n(a,t,!1),r.minHeight=a.minHeight,r.maxHeight=a.maxHeight}const Wr=r=>r.lakes==="none"||!(r.lakeAbundance>0&&r.lakeCoverage>0&&r.maxLakeArea>0),ra=(r,t)=>r.riverArea>0?r.riverArea:Math.max(.02,.003*(t/1e3)**2);class Mt{constructor(t,a,n,i,o,c){this.engine=t,this.baseHeight=a,this.backend=n,this.backendReason=i,this.drainageMs=o,this.gpu=c}static async create(t,a,n,i,o,c){const u=performance.now();let s,e,l;if(o!=="cpu")try{const v=await Qi(i,a,n,t,c);s=Rt.with_drainage(t,a,n,i,c,v.filled,v.receivers,v.accumulation),l=v}catch(v){e=`GPU hydrology unavailable: ${v instanceof Error?v.message:String(v)}`}const f=s?"gpu-f32":"cpu";return s??=new Rt(t,a,n,i,c),new Mt(s,i,f,e,performance.now()-u,l)}generate(t,a){const n=performance.now(),i=this.engine.generate(t.main,t.density,t.wetness,Wr(t)?"none":t.lakes,t.meanders,t.meanderIntensity,t.estuary,t.widthScale,t.incision,t.minLakeArea,t.lakeAbundance,t.lakeCoverage,t.maxLakeArea,t.depressionPolicy,t.maxBreachDepth,t.maxBreachLength,t.minLakeDepth,a.temperature,a.precipitation,t.coastalStreams);try{const o=i.stage_ms,c=i.stage_labels?Object.fromEntries(i.stage_labels.split(",").map((_,P)=>[_,o[P]])):void 0,u=i.basins;let s=0,e=0;for(const _ of u)s=Math.max(s,_),_&&e++;const l=i.river_offsets,f=i.lake_meta,v=i.lake_closed;let x=0;for(let _=2;_<f.length;_+=6)x+=f[_];const S=i.river_meta;let U=!1;for(let _=4;_<S.length;_+=6)U||=(S[_]&2)!==0;return{width:i.width,resolution:i.resolution,receivers:i.receivers,accumulation:i.accumulation,basins:u,rawReceivers:i.raw_receivers??i.receivers,rawAccumulation:i.raw_accumulation??i.accumulation,rawBasins:i.raw_basins??u,flatLabels:i.flat_labels??new Uint32Array(u.length),flatRank:i.flat_rank??new Uint32Array(u.length),externalInflowArea:i.external_inflow_area??0,rawFilled:i.raw_filled??i.filled,rawDrainageHeight:i.raw_drainage_height??i.drainage_height,breachCount:i.breach_count??0,breachCutVolumeM3:i.breach_cut_volume_m3??0,avoidedFillVolumeM3:i.avoided_fill_volume_m3??0,filled:i.filled,lakeDepth:i.lake_depth,lakeLabels:i.lake_labels,baseHeight:this.baseHeight,drainageHeight:i.drainage_height,surfaceHeight:i.surface_height,adjustedHeight:i.adjusted_height,riverPoints:i.river_points,riverOffsets:l,riverMeta:S,riverFlare:i.river_flare,lakePoints:i.lake_points,lakeOffsets:i.lake_offsets,lakeMeta:f,lakeRingMeta:i.lake_ring_meta,lakeClosed:v,waterField:i.water_field,closedLakeCount:v.reduce((_,P)=>_+P,0),nodePoints:i.node_points,nodeMeta:i.node_meta,riverCount:l.length-1,lakeCount:f.length/6,basinCount:s,lakeFraction:x/Math.max(1,e*(i.width/i.resolution)**2),incision:t.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&t.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(t.main)&&!U?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-n,stageMs:c,generationMs:this.drainageMs+performance.now()-n,routingPotential:t.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{i.free()}}dispose(){this.engine.free()}}let nn="",Ir,wt="",ur,an="";function Mn(r,t){if(new URL(r).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const a=r+(t?.runtimeSha256??"")+(t?.runtimeJsSha256??"");return(nn!==a||!Ir)&&(nn=a,Ir=(async()=>{if(t){const{javascript:o,wasm:c}=await bi(r,t),u=URL.createObjectURL(new Blob([o],{type:"text/javascript"}));try{const s=await import(u);return await s.default({module_or_path:c}),s}finally{URL.revokeObjectURL(u)}}const i=await import(new URL("magna_urbis_neural_wasm.js",r).href);return await i.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",r)}),i})().catch(n=>{throw Ir=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Ir}async function Pt(){if(ur){try{(await ur).free()}catch{}ur=void 0,wt=""}}async function ta(r,t,a,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:i}=await wi(r),o=[i.runtimeSha256,...qt.map(s=>i.models[s].sha256)].join(":");(wt!==r+o||!ur)&&(await Pt(),wt=r+o,ur=(async()=>{const s=await Mn(r,i);an=o;const e=[];for(const l of qt){const f=i.models[l];n?.(`Neuronal WASM · ${l} · ${(f.bytes/1e6).toFixed(1)} Mo`),e.push(await xi(r,i,l,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),s.NeuralRelief.create(e[0],e[1],e[2])})().catch(s=>{throw ur=void 0,s}));const c=await ur;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await c.generate_json(JSON.stringify(Object.fromEntries(t)),a?JSON.stringify(a):"");try{const s=new Float32Array(u.heights),e=JSON.parse(u.meta),l=Number(t.get("extent")??4e4),f=Number(t.get("resolution")??Math.ceil(l/Number(t.get("sampleSpacing")??30))),v=e.resolution;if(e.extent!==l||e.nativeCellM!==30||e.nativeResolution!==Math.ceil(l/30)||typeof v!="number"||!Number.isInteger(v)||v!==f||s.length!==v*v||e.outputCellM!==l/v||s.some(x=>!Number.isFinite(x)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:s,meta:{...e,modelIdentity:an}}}finally{u.free()}}let on;async function Pn(r,t,a,n){on??=xt();const{seed:i,width:o,motifSize:c,relief:u,erosion:s,mountainMix:e,environment:l,zones:f,erosionTuning:v,sketch:x,source:S}=r,U=x?.processing,_=Qe(r),P={seed:i,width:o,motifSize:c,relief:u,erosion:s,mountainMix:e,environment:l,zones:f,erosionTuning:v,sampleSpacing:_.requestedSpacing,sourceN:_.n,coastProfile:Gr(r),coastMask:r.coastMask??0,islandMode:r.islandMode??"island",source:S,...U?{sketch:{processing:U},surface:Array.from($r(yr(x),_.n))}:{}},h=await(await Or(t,"/terrain",JSON.stringify({session:on,settings:P,region:a,field:n}))).arrayBuffer();if(h.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const d=new DataView(h).getUint32(0,!0);if(d%4||4+d>h.byteLength)throw new Error("En-tête terrain local invalide.");const p=JSON.parse(new TextDecoder().decode(new Uint8Array(h,4,d)));let R=4+d;const C={};for(const k of p.arrays){const b=k.count*(k.type==="f32"?4:1);if(!Number.isSafeInteger(k.count)||k.count<0||R+b>h.byteLength)throw new Error("Raster terrain local incomplet.");C[k.name]=k.type==="f32"?new Float32Array(h,R,k.count):new Uint8Array(h,R,k.count),R+=b}const A=C.height,G=p.resolution*p.resolution;if(!Number.isInteger(p.resolution)||p.resolution<64||p.resolution>1024||!A||A.length!==G||!A.every(Number.isFinite)||["normalX","normalY","normalZ"].some(k=>C[k]?.length!==G))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(p.fieldFloor)||!Number.isInteger(p.fieldN)||p.fieldN!==_.n||C.field?.length!==p.fieldN*p.fieldN||!C.field.every(Number.isFinite)||C.physical?.length!==p.fieldN*p.fieldN||!C.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:p.session,x:p.x,y:p.y,width:p.width,resolution:p.resolution,minHeight:p.minHeight,maxHeight:p.maxHeight,globalMinHeight:p.globalMinHeight,globalMaxHeight:p.globalMaxHeight,motifSize:p.motifSize,height:A,normalX:C.normalX,normalY:C.normalY,normalZ:C.normalZ,caveMask:C.caveMask,prepareMs:p.prepareMs,samplingMs:p.samplingMs,generationMs:p.prepareMs+p.samplingMs,generationBackend:"native",generationReason:p.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${p.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:p.erosionDefaults,...C.field?{field:{n:p.fieldN,data:C.field,exact:p.fieldExact,floor:p.fieldFloor,...C.physicalCave?{cave:C.physicalCave}:{}}}:{},...C.physical?{physical:{n:p.fieldN,height:C.physical}}:{},definition:_}}function na(r){if(r.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return Pn(r.settings,r.runtime,r.region,r.kind==="overview")}async function ia(r,t){const a=await Pn(r,t,{x:0,y:0,extent:r.width,resolution:64},!0);if(!a.field||a.field.data.length!==Qe(r).n**2)throw new Error("Surface physique native absente.");return{height:a.field.data,prepareMs:a.prepareMs??0,samplingMs:a.samplingMs??0,session:a.session,fieldExact:a.field.exact,erosionDefaults:a.erosionDefaults}}const aa="[relief_session_missing]",sn=r=>Array.from(r,t=>Number.isFinite(t)?t:null),oa=r=>new Uint8Array(r.buffer,r.byteOffset,r.byteLength);class cr{constructor(t,a){this.runtime=t,this.tuning=a,this.session=xt(),this.steps=[],this.released=!1}static async build(t,a,n,i){const o=new cr(t,i.slice());return await o.mutate({op:"build",...a},n),o}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,t=>t??NaN)}editSurface(t){return this.mutate({op:"edit"},t)}coast(t,a,n,i,o){return this.mutate({op:"coast",mask:t,mode:a,coastProfile:o,surface:!!i,...n?{tuning:sn(n)}:{}},i)}carveUnderdark(t,a){return this.mutate({op:"underdark",seed:t,...a})}async sampleRegion(t,a,n,i){const{meta:o,arrays:c}=await this.send({op:"read",region:{x:t,y:a,extent:n,resolution:i}}),u=o.region,s=c.height;if(!u||!s||s.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:s,cave_mask:c.caveMask,normal_x:c.normalX,normal_y:c.normalY,normal_z:c.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}async underdarkTunnels(){return(await this.send({op:"read",tunnels:!0})).arrays.tunnels??new Float32Array(0)}free(){this.released||(this.released=!0,this.steps.length=0,Or(this.runtime,"/release",JSON.stringify({session:this.session})).then(t=>t.arrayBuffer(),()=>{}))}async mutate(t,a){this.meta=(await this.send(t,a)).meta,this.steps.push({header:t,plane:a})}async send(t,a){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(t,a)}catch(n){if(t.op==="build"||!(n instanceof Error)||!n.message.includes(aa))throw n;for(const i of this.steps)await this.call(i.header,i.plane);return this.call(t,a)}}async call(t,a){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:sn(this.tuning),...t})),i=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);i.set(n);const o=new Uint8Array(4);new DataView(o.buffer).setUint32(0,i.length,!0);const u=await(await Or(this.runtime,"/terrain/relief",new Blob([o,i,...a?[oa(a)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const s=new DataView(u).getUint32(0,!0);if(s%4||4+s>u.byteLength)throw new Error("Native relief reply header invalid.");const e=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,s))),l={};let f=4+s;for(const{name:v,type:x,count:S}of e.arrays){const U=S*(x==="f32"?4:1);if(!Number.isSafeInteger(S)||S<0||f+U>u.byteLength)throw new Error("Native relief plane incomplete.");l[v]=x==="f32"?new Float32Array(u,f,S):new Uint8Array(u,f,S),f+=U}return{meta:e,arrays:l}}}const sa=["plateau","volcano","caldera"],Dr=r=>r==="neural-wasm"||r==="neural-python"||r==="neural",la="http://127.0.0.1:8792",ca="http://127.0.0.1:8793";function ua(r,t){const a=r==="neural-python"?ca:la,n=t?.trim().replace(/\/+$/,"");if(!n)return a;try{const i=new URL(n);if(i.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(i.hostname)&&["8792","8793"].includes(i.port)&&i.pathname==="/"&&!i.search&&!i.hash&&!i.username&&!i.password)return a}catch{}return n}const zn={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},fa={flat:20,hills:110,plateau:100},sr=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],Yr=r=>r.climateValues??$n[r.climate??"temperate"];function ln(r){const t=new Float32Array(r.height.length);let a=0,n=0;for(let c=0;c<r.height.length;c++)r.height[c]>0&&(t[n++]=r.height[c],a+=Math.acos(Math.min(1,r.normalZ[c])));const i=t.subarray(0,n).sort(),o=c=>n?i[Math.min(n-1,Math.floor(c*n))]:0;return{p5:o(.05),p50:o(.5),p95:o(.95),slope:a/Math.max(1,n),land:n/Math.max(1,r.height.length)}}let Kr,H,vr="",jr="",zr,nr="",Ur,mr,je,lr=!1,V;const He=()=>V??H,Cr=()=>V?V.physicalHeightField():Promise.resolve(H.physical_height_field()),cn=async()=>{if(V)return V.underdarkTunnels().catch(()=>new Float32Array(0));const r=H?.underdark_tunnels;return r?r.call(H):new Float32Array(0)},dt=()=>V?V.samplingBaseField():Promise.resolve(H.sampling_base_field());let ar="",Xe,gr,ue,ir,Le="cpu",Te,un=Promise.resolve(),$e,Er="",Rr="",Oe,Ar,Vr="";async function Un(){if(!Vr)return;const r=Vr;Vr="";try{await fetch(`${r}/release`,{method:"POST"})}catch{}}let Nr,ee,Ze;const Br=new bt;async function da(r,t){const a=Qe(r),n=Math.ceil(r.width/30),i=(g,h)=>h.extent===r.width&&h.resolution===a.n&&h.nativeCellM===30&&h.nativeResolution===n&&h.outputCellM===r.width/a.n&&g.length===a.n*a.n&&g.every(Number.isFinite),o=ua(r.source,r.neuralServer),c=new URLSearchParams({seed:r.seed,relief:r.relief,mix:String(r.relief==="mixed"?r.mountainMix:.5),coasts:"0",islands:"island",climate:r.climate??"temperate",noise:String(r.fidelity??.05),extent:String(r.width),sampleSpacing:String(a.requestedSpacing),resolution:String(a.n)}),u=Yr(r),s=r.neuralTuning??zn;for(const[g,h]of Object.entries(u))c.set(g,String(h));c.set("landScale",String(s.landScale)),c.set("steps",String(s.steps)),c.set("detail",String(s.detail));for(const g of["coarseModel","baseModel","decoderModel"])r[g]&&c.set(g,r[g]);for(const g of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])c.set(g,String(s[g]));c.set("histogram",s.histogram.join(","));const e=fa[r.relief];s.reliefMode==="fixed"?c.set("reliefFixed",String(s.reliefFixed)):s.reliefMode==="auto"&&e!==void 0?c.set("reliefFixed",String(e)):c.set("reliefScale",String(s.reliefMode==="scale"?s.reliefScale:1));const l=si(r.width,r.width,r.neuralFit??"crop",r.neuralSlopes??!0),f=r.zones?{zones:yn(r.zones),region:{x:l.x,y:l.y,width:l.width}}:r.sketch?li(yr(r.sketch),l):void 0,v=performance.now();if(r.source==="neural-wasm"){if(await Un(),!r.neuralAssets)throw new Error("Neural browser runtime URL missing.");const g=await ta(r.neuralAssets,c,f,t);if(!i(g.heights,g.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:g.heights,info:{...g.meta,requestMs:performance.now()-v}}}await Pt();let x=f;if(r.source==="neural-python"){if(r.zones&&(await fetch(`${o}/status`,{cache:"no-store"}).then(p=>p.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!r.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const g=await Mn(r.neuralAssets),h=Object.fromEntries(c);x={params:h,conditioning:JSON.parse(g.conditioning_json(JSON.stringify(h),f?JSON.stringify(f):"")),edited:!!f},t?.("Neural Python · computing with PyTorch/CUDA")}const S={cache:"no-store",...x?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(x)}:{}};let U;if(r.source==="neural")U=await ci({profile:"local",server:o},`/generate?${c}`,S);else try{U=await fetch(`${o}/generate?${c}`,S)}catch{throw new Error(`Neural service unreachable (${o}): run “npm run neural:python” from web/`)}if(!U.ok)throw new Error(`Neural service: ${await U.text()}`);const _=new Float32Array(await U.arrayBuffer()),P=JSON.parse(U.headers.get("X-Neural-Meta")??"{}");if(r.source==="neural-python"&&(Vr=o),f&&(P.edited!==!0||P.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!i(_,P))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:_,info:{...P,requestMs:performance.now()-v}}}function pa(r){return Kr??=(async()=>{ni()?(r?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await ii(),r?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await ai(()=>oi(vi,t=>gi({module_or_path:t}),r))})()}dn(()=>{Br.clear(),Kr=void 0,H=void 0,V?.free(),V=void 0,vr="",ar="",lr=!1,$e=void 0,Oe=void 0,Er="",Rr="",Nr=void 0,ee=void 0,Ze=void 0});function ga(r,t,a,n){const i=un.then(()=>fn(r,t,a,n).catch(async o=>{if(!await Wn(o))throw o;return a?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),fn(r,t,a,n)}));return un=i.catch(()=>{}),i}async function fn(r,t,a,n){const{settings:i,region:o,kind:c,display:u,runtime:s}=r,e=i.islandMode?.startsWith("traced:")&&(i.sketch?.processing||i.relief==="cavern"||i.underdark)?{...i,islandMode:"island"}:i,l=Qe(e);if(Yn(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning}),e.climateZone==="wetland"&&(e.erosionTuning={carve:0,finalCarve:0,surfaceCarve:0,...e.erosionTuning});const f=e.compute==="wasm"?"wasm":"gpu-f32",v=e.generationCompute??"gpu-erosion";if(Vn(e,l.n))throw new Error(`GPU generation is limited to ${Jn}² cells; requested spacing ${l.spacing.toFixed(2)} m (${l.n}²). Choose CPU or native.`);const x=Ye(e.generalSeed??e.seed,"relief-coast-cut"),S=!!e.generalSeed&&mt(e.generalSeed,y=>y.startsWith("relief-"))!==vn(e.generalSeed),U=Xr(e),_=e.hydrology?.compute==="auto"&&(f==="wasm"||v==="cpu")?"cpu":e.hydrology?.compute??"auto";if(_!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&_t(),U&&!e.zones&&!e.sketch?.processing&&(!Kn.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const P=v==="native"&&!Dr(e.source);if(P&&s?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(P&&e.relief==="cavern")return na({...r,settings:e});const g=sa.includes(e.relief)?e.environment??"mixed":"mixed",h=e.sketch?.processing,d=ne(e,"coasts")?e.relief==="cavern"||e.underdark?0:e.coastMask??0:0,p=e.islandMode??"island",R=Gr(e),C=Ri.includes(e.relief),A=f!=="wasm"&&C?Ni(f,e.relief).catch(()=>{}):void 0;Kr&&a?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await pa(a)}catch(y){throw Kr=void 0,y}const G=performance.now();A&&a?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const k=A?await wr(A):void 0;n&&await n.after("prepare");const b=(y,w)=>{const Y=je;je={erosionSpacing:y===void 0?Y?.erosionSpacing:Math.max(Y?.erosionSpacing??0,y),regionalErosionSpacing:w===void 0?Y?.regionalErosionSpacing:Math.max(Y?.regionalErosionSpacing??0,w)},Object.assign(l,je)},z=async(y,w=!1,Y=!1)=>{let I=w&&ne(e,"phasor",!1)?ht(y,e):y;const X=Bt(e),oe=Tt(e),O=Jr(e);for(const E of["posterior","wind"]){const ae=JSON.stringify([O.get(E),s?.server,!!k,ki(new Uint8Array(I.buffer,I.byteOffset,I.byteLength))]),$=e.procedural?Br.get(E,ae):void 0;if($){I=$,n?.cached?await n.cached(E,n.previews===!1?void 0:I):(await n?.before(E),await n?.after(E,n.previews===!1?void 0:I));continue}if(await n?.before(E),E==="posterior"&&e.procedural&&ne(e,E)&&X.mode!=="none"){const D=I,Z=Math.sqrt(I.length);I=(await Ot(I,Z,e.width,X,{stats:!1},s)).height;for(let L=0;L<I.length;L++)I[L]=D[L]>0?Math.max(.3,I[L]):I[L]}E==="wind"&&e.procedural&&ne(e,E)&&oe.iterations&&oe.transport&&(I=k?await Ui(k.context,I,e.width,oe):zi(I,e.width,oe)),e.procedural&&l.n<=1024&&Br.put(E,ae,I),await n?.after(E,n.previews===!1?void 0:I)}return Y?I.map((E,ae)=>y[ae]<=0?y[ae]:Math.max(.3,E)):e.procedural&&I.some(E=>E<.3)?I.map(E=>Math.max(.3,E)):I};let j;const W=k?wr(k.pipeline).then(y=>({pipeline:y}),y=>{j=y instanceof Error?y.message:String(y)}):void 0,B=!P&&!e.zones&&!e.sketch&&v!=="cpu"&&f!=="wasm"&&!Dr(e.source)&&e.relief!=="cavern",F=B&&k?Di(k.context,e):void 0;if(F?.error&&e.generationCompute)throw new Error(F.error);const J=e.generationCompute||!F?void 0:F.error??(Xn(F)?`Source ${l.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),pe=!!F&&!F.error&&!J,re=B&&Bi.includes(e.relief),fe=re&&pe,ie=(l.n!==1024||!!(e.procedural||n||S))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!Dr(e.source)&&(!fe||v!=="gpu-erosion"),K=!h&&Dr(e.source);K||(await Pt(),await Un());const Se=s?.profile==="local"&&(P||K),Ie=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,it(e.modification.delta)]):"",ve={tunnels:e.underdarkTunnels,caverns:e.underdarkCaverns,lakes:e.hydrology&&Wr(e.hydrology)?0:e.hydrology?.lakeAbundance},we=JSON.stringify([e.zones,Ie,e.underdark?ve:null,x,P?[s.server,d,p,R]:null,Se?s.server:null])+"|"+JSON.stringify(K?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,Yr(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??zn,e.width,l.n,e.coarseModel,e.baseModel,e.decoderModel,e.neuralFit,e.neuralSlopes]:[e.seed,...e.generalSeed?[mt(e.generalSeed,y=>y.startsWith("relief-"))]:[],e.width,l.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,P?"native":U?[v,f,!!k]:re?v:"cpu",g,e.sketch,e.erosionTuning??{},...e.procedural?[Zn,R,e.procedural,e.climate,e.climateValues,e.climateZone,fe?null:[d,p,R]]:[],...U||e.procedural?.enabled?.phasor?[nt,e.climate??"temperate",e.phasor??{}]:[]]);let Pe=0,ze=0,ce=0,Ue=0,_e=0,he;if(n&&n.previews!==!1||!(H||V)||vr!==we){ue?.dispose(),ue=void 0,ir=void 0,H?.free(),H=void 0,V?.free(),V=void 0,lr=!1,vr="",ar="",je=void 0;const y=performance.now();nr="",jr="",Ur=void 0,mr=void 0,zr=void 0,Le="cpu",Te=void 0;const w=e.relief==="mixed"?e.mountainMix:.5;Ar=void 0;const Y=Float64Array.from(sr,O=>{let E=U&&!e.procedural?NaN:e.procedural?.erosionTuning?.[O]??e.erosionTuning?.[O]??NaN;return e.procedural?.biome&&!fe&&!ie&&(O==="incision"||O==="thermal")&&(E=(Number.isFinite(E)?E:1)*(O==="incision"?Mr(e).water:Mr(e).thermal)),E});if(Pr(Y),ie){a?.(J?`${J} Rust CPU generation at ${l.spacing.toFixed(2)} m…`:P?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const O=await z(await Mi(e,n,P?s:void 0,fe&&k?()=>jt(k.context,e,a):void 0,(E,ae)=>{je={erosionSpacing:E,regionalErosionSpacing:ae},Object.assign(l,je)}));n&&await n.before("retain"),Se?V=await cr.build(s,{kind:"source",seed:x,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:w,environment:g},O,Y):H=ke.with_source(x,e.width,e.relief,e.erosion,e.motifSize,w,O,g),n&&await n.after("retain",n.previews===!1?void 0:O),Le=P?"native":fe?v==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":U?"compact-cpu":"cpu",Te=J??`${P?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(P){a?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${l.n} × ${l.n} physical field`});const O=e.procedural?.biome?{...e,coastMask:d,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*Mr(e).water,thermal:(e.erosionTuning?.thermal??1)*Mr(e).thermal}}:{...e,coastMask:d},E=await ia(O.sketch&&!h?{...O,sketch:void 0}:O,s),ae=h!=="surface"&&e.procedural&&!e.zones?await z(E.height,!0,d!==0):void 0;V=await cr.build(s,{kind:"surface",seed:x,width:e.width},ae??E.height,Y),Le="native",Te="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",_e=E.prepareMs}else if(h){a?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const O=$r(yr(e.sketch),l.n);if(h==="erosion"){a?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),H=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,g,l.n),H.set_edited_surface(O);const E=H.sampling_base_field();H.free(),H=ke.with_surface(x,e.width,E)}else H=ke.with_surface(x,e.width,O);Te=h==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if(K){const O=await da(e,a),E=Qn(O.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);Se?V=await cr.build(s,e.zones?{kind:"zonedSurface",seed:x,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:x,width:e.width},E,Y):H=e.zones?ke.with_zoned_surface(x,e.width,e.motifSize,E,JSON.stringify(e.zones)):ke.with_surface(x,e.width,E),Ar=O.info,Le="neural",e.zones&&(Te="Zones → regional conditioning and local neural relief, then sea operation.")}else if(U&&!e.zones)if(k&&pe){a?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const O={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:b},E=await z(await Xt(k.context,e,O,a));n&&await n.before("retain"),he=O.profiles,H=ke.with_source(x,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,w,E,g),n&&await n.after("retain",E),Le="compact-gpu-f32",Te=`${nt} · compact preset · ${e.procedural?.regionalN??Nt(e).n}² grid · ${e.climate??"temperate"} · Phasor ${ne(e,"phasor",!0)?"enabled":"disabled"}.`}else{a?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const O=e.procedural?.biome?Mr(e):void 0,E=O?{incision:O.water,thermal:O.thermal}:e.procedural?{incision:1,thermal:1}:ei(e),ae=e.procedural?.erosionTuning?.iterations??Nt(e).steps,$=e.erosionTuning??{},D={...$,iterations:ae,surfaceIterations:ne(e,"surface",!1)?$.surfaceIterations??12:0,detail:ne(e,"ridged",!1)?$.detail:0,warp:$.warp??0,incision:($.incision??1)*E.incision,thermal:($.thermal??1)*E.thermal};Pr(Float64Array.from(sr,L=>D[L]??NaN));let Z;try{Z=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,g,l.n);const L=Z.physical_height_field();H=ke.with_source(x,e.width,"hills",e.erosion,e.motifSize,w,ne(e,"phasor",!0)?ht(L,e):L,g)}finally{Z?.free(),Pr(new Float64Array(sr.length).fill(NaN))}Le="compact-cpu",Te=`${nt} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)a?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${l.n} × ${l.n} physical field`}),H=ke.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,g,JSON.stringify(yn(e.zones)),l.n),Te="Zone masks → uplift, noise, ridges and Rust erosion.";else if(fe&&k)try{if(v==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const O={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:b},E=await z(await Xt(k.context,e,O,a));n&&await n.before("retain"),_e=O.nativeEnvironmentMs,he=O.profiles,Ue=performance.now()-y-_e,H=ke.with_source(x,e.width,e.relief,e.erosion,e.motifSize,w,E,g),n&&await n.after("retain",E),Le="gpu-erosion-f32"}else{const O=await jt(k.context,e,a);ze=performance.now()-y;const E=performance.now();a?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),H=ke.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,O.coarse,O.fine,g),ce=performance.now()-E,Le=v==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(O){if(n||e.procedural)throw O;Te=`GPU generation unavailable: ${O instanceof Error?O.message:String(O)}`}if(!H&&!V&&(a?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${l.n}² physical source at ${l.spacing.toFixed(2)} m`}),H=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,g,l.n),J&&(Te=J)),!h&&!K&&e.sketch&&e.relief!=="cavern"){const O=yr(e.sketch),E=await Cr(),ae=ri(O,E,l.n);V?await V.editSurface(ae):H.set_edited_surface(ae),Te="Edited sketch + procedural detail and Rust erosion."}const I=Bt(e),X=Tt(e),oe=ne(e,"posterior")&&I.mode!=="none"||ne(e,"wind")&&X.iterations>0&&X.transport>0;if(!ie&&e.procedural&&(oe||!U&&ne(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(Le)&&!K&&!h&&!P&&!e.zones){Ht(H,d,p,R);const O=H.physical_height_field(),E=await z(O,!U,d!==0);H.free(),H=ke.with_surface(x,e.width,E),lr=!0}e.modification&&(K||h)&&(zr=await dt()),Pe=performance.now()-y,vr=we}else if(a?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),je&&Object.assign(l,je),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const y of["grids",...kt(e),"phasor","posterior","wind"])await n.cached(y);const ye=JSON.stringify([we,x,d,p,R,Jr(e).get("coasts"),Le,s?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,it(e.sketch.heights)],e.zones&&[e.zones.resolution,it(e.zones.weights)]]),Ne=!!(e.procedural||K||h)&&!lr&&!(P&&!ie),me=Ne&&d?Br.get("coasts",ye):void 0;!me&&n&&await n.before("coasts");const Ce=!K&&!h&&!lr&&!F?.error&&!J&&!e.zones&&!e.sketch&&d!==0&&v!=="cpu"&&f!=="wasm",Ae=JSON.stringify([x,d,d?p:"island",R,d?Ce:!1,e.procedural?.coastIterations,e.procedural?.coastIncision,e.procedural?.coastThermal,e.procedural?.coastDiffusion,e.erosionTuning]);let Ge=0;if(zr&&nr&&nr!==we+"|"+Ae){if(ue?.dispose(),ue=void 0,ir=void 0,V){const y=V;V=await cr.build(s,{kind:"surface",seed:x,width:e.width},zr,new Float64Array(sr.length).fill(NaN)),y.free()}else H?.free(),H=ke.with_surface(x,e.width,zr);ar="",nr="",mr=void 0,Ur=void 0,jr=""}if(P&&!ie||lr)ar=Ae,Xe=lr&&d?"cpu":void 0,gr=void 0;else if(ar!==Ae){ue?.dispose(),ue=void 0,ir=void 0,Xe=void 0,gr=void 0;const y=performance.now();a?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const w=e.procedural,Y={...e.erosionTuning,...w?.erosionTuning},I=d?Float64Array.from(sr,X=>w&&X==="surfaceIterations"?w.coastIterations??(U?2:12):X==="surfaceIncision"?(Y[X]??1)*(w?.coastIncision??1):X==="surfaceThermal"?(Y[X]??1)*(w?.coastThermal??1):X==="surfaceDiffusion"?(Y[X]??1)*(w?.coastDiffusion??1):Y[X]??NaN):void 0;if(V?(await V.coast(d,p,me?void 0:I,me,R),d&&(Xe="native")):me&&(It(H,d,p,R),H.set_coast_surface(me),Xe="cpu"),!V&&!me&&Ce&&k){let X;try{const oe=await W;if(!oe||k.context.lost)throw new Error(j??"WebGPU unavailable");It(H,d,p,R),X=new $t(k.context,oe.pipeline,f,H);const O=X.prepareCoastField(e),E=await ji(k.context,e,O,H.coast_erosion_parameters(),a);H.set_coast_surface(E),Xe="gpu-f32"}catch(oe){gr=`GPU coast unavailable: ${oe instanceof Error?oe.message:String(oe)}`}finally{X?.dispose()}}if(!V&&!Xe){I&&Pr(I);try{Ht(H,d,p,R)}finally{I&&Pr(Float64Array.from(sr,X=>Y[X]??NaN))}d&&(Xe="cpu"),Ce&&!k&&(gr="WebGPU unavailable")}ar=Ae,Ge=d?performance.now()-y:0,Pe+=Ge}const Fe=d&&Ne&&(!me&&l.n<=1024||n&&n.previews!==!1&&!(me&&n.cached))?await dt():void 0;if(Fe&&!me&&l.n<=1024&&Br.put("coasts",ye,Fe),me&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:me):n&&await n.after("coasts",n.previews===!1?void 0:Fe),e.modification&&nr!==we+"|"+Ae){const y=He().source_resolution(),w=h==="surface"&&!d?$r(yr(e.sketch),y):await Cr();if(Ur={n:y,height:w.slice()},mr=ti(w,y,e.modification),ue?.dispose(),ue=void 0,ir=void 0,V){const Y=V;V=await cr.build(s,{kind:"surface",seed:x,width:e.width},mr,new Float64Array(sr.length).fill(NaN)),Y.free()}else H?.free(),H=ke.with_surface(x,e.width,mr);nr=we+"|"+Ae}e.underdark&&jr!==we+"|"+Ae+"|"+nr&&(a?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),ue?.dispose(),ue=void 0,ir=void 0,V?await V.carveUnderdark(e.seed,ve):H.carve_underdark(e.seed,ve.tunnels,ve.caverns,ve.lakes),jr=we+"|"+Ae+"|"+nr);let Ee;const de=async(y,w,Y)=>((Ee?.delta!==y||Ee.m!==w||Ee.n!==Y)&&(Ee={delta:y,m:w,n:Y,out:await mi(y,w,Y,s)}),Ee.out);async function er(y){je?Object.assign(l,je):l.erosionSpacing??=He().erosion_spacing(),y.definition=l,n&&await n.after("sampling",y.height),n&&await n.before("hydrology");const w=ne(e,"hydrology")?e.hydrology:void 0;y.neural=Ar,c==="overview"&&!K&&e.relief!=="cavern"&&(y.erosionDefaults=Array.from(ui(e.relief,e.width,e.motifSize,e.mountainMix)));const Y=!!w?.enabled&&e.relief!=="cavern",I=w?.engine!=="rust",X=w?.erosionEnabled!==!1,oe=X&&w?.showErosion!==!1,O=X?w?.condMode:"none",E=I&&w&&!Wr(w)?[w.lakeAbundance,w.lakeArea,w.lakeDepth,w.lakeCoverage,w.maxLakeArea]:[0,0,0,0,0],ae=w&&{mode:w.condMode,strength:w.condStrength,maxDepth:w.condDepth,maxLength:w.condLength,banks:w.condBanks,lakes:E[0],lakeArea:E[1],lakeDepth:E[2],lakeCoverage:E[3],maxLakeArea:E[4],...e.climateZone==="wetland"?{undulation:2}:{}};if(t&&w&&Y&&c==="overview"&&u==="gl"){const $=Gt(I?w.vectorResolution:w.resolution,l.n),D=JSON.stringify([vr,ar,$,O,O==="none"?0:[w.condStrength,w.condDepth,w.condBanks,w.condLength,E]]);if(!ee||ee.key!==D||I&&!Ze){const Z=ln(y);t({...y,height:y.height.slice(),normalX:y.normalX.slice(),normalY:y.normalY.slice(),normalZ:y.normalZ.slice(),caveMask:y.caveMask.slice(),neural:Ar&&{...Ar,land:Z.land},field:await fr(y,!1,I),relief:Z,generationMs:performance.now()-G})}}if(w&&Y){const $=Gt(I?w.vectorResolution:w.resolution,l.n),D=JSON.stringify([vr,ar,$,O,O==="none"?0:[w.condStrength,w.condDepth,w.condBanks,w.condLength,E]]),Z=Yr(e),L={riverArea:w.density>0?ra(w,e.width)/Math.max(1,w.density)**2:1e9,density:Math.min(1,w.density),noLakes:Wr(w),headwaters:w.headwaters!==!1?1:0,minRiverLength:w.minRiverLength,lakeDepth:w.lakeDepth,lakeArea:w.lakeArea,riverMode:w.riverMode,flatSlope:w.flatSlope,sinuosity:w.sinuosity,widthScale:w.vectorWidth,balance:w.balance,braiding:w.braiding,anabranching:w.anabranching,terrainInfluence:w.terrainInfluence,avulsions:w.avulsions,confluence:w.confluence,deltas:w.deltas,...e.climateZone==="wetland"?{oxbows:.35}:{}},te=JSON.stringify([D,L,Z.temperature,Z.precipitation,Ye(e.generalSeed??e.seed,"water-hydrology")]);if(!ee||ee.key!==D){ee=void 0,Ze=void 0,$e?.dispose(),$e=void 0,Oe=void 0,Er="",Rr="";let se;if(y.x===0&&y.y===0&&y.width===e.width&&y.resolution===$)se=y.height.slice();else if(ue&&!ue.lost)se=(await ue.sample({x:0,y:0,extent:e.width,resolution:$},e,H.min_height,H.max_height)).height;else{const Q=V?await V.sampleRegion(0,0,e.width,$):H.sample_region(0,0,e.width,$);try{se=Q.height}finally{Q.free()}}if(O==="none")ee={key:D,n:$,height:se,m:0};else{a?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const Q=ae;if(I){const q=await Ft(se,$,e.width,Q,L,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),s),{height:xe,delta:Je,...ge}=q.conditioning;ee={key:D,n:$,height:xe,source:se,delta:Je,m:$,stats:ge},Ze={key:te,water:q.water}}else{const q=await Ot(se,$,e.width,Q,{stats:!1,drainage:!1},s),{height:xe,delta:Je,hydrology:ge,...qe}=q;ee={key:D,n:$,height:xe,source:se,delta:Je,m:$,stats:{...qe,census:!1},drainage:ge}}}}if(I){if(!Ze||Ze.key!==te)if(a?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),ee.source){const se=await Ft(ee.source,$,e.width,ae,L,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),s),{height:Q,delta:q,...xe}=se.conditioning;Object.assign(ee,{height:Q,delta:q,stats:xe}),Ze={key:te,water:se.water}}else Ze={key:te,water:await fi(ee.height,$,e.width,L,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),ee.drainage,s)}}else{const se=JSON.stringify([D,_,Ye(e.generalSeed??e.seed,"water-hydrology")]),Q={...w,showErosion:!0,erosionEnabled:X,...X?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},q=`${se}|${JSON.stringify(Q)}`;if(K&&Nr?.key===q)y.hydrologyError=Nr.message;else try{(!$e||Er!==se)&&(a?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),$e?.dispose(),$e=void 0,Oe=void 0,Rr="",$e=await Mt.create(Ye(e.generalSeed??e.seed,"water-hydrology"),e.width,$,ee.height.slice(),_,d!==0||(h||K||e.sketch||e.zones?He().min_height<=0:!1)),Er=se);const xe=Yr(e),Je=JSON.stringify([Q,xe.temperature,xe.precipitation]);(!Oe||Rr!==Je)&&(a?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Oe=$e.generate(Q,xe),Rr=Je)}catch(xe){if(!K)throw xe;$e?.dispose(),$e=void 0,Oe=void 0,Er="",Nr={key:q,message:xe instanceof Error?xe.message:String(xe)},y.hydrologyError=Nr.message}}}if(a?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),Y&&oe&&ee?.delta&&!e.underdark&&await di(y,ee.delta,ee.m,e.width,s),Y&&oe&&!I&&Oe&&!y.hydrologyError){const $=performance.now();_n(y,Oe),y.hydrologySurfaceMs=performance.now()-$}if(c==="overview"){const $=He().source_resolution(),D=e.underdark?await Cr():mr?.slice()??(h==="surface"&&!d?$r(yr(e.sketch),$):await Cr());if(Y&&oe&&ee?.delta&&!e.underdark){const Z=await de(ee.delta,ee.m,$);for(let L=0;L<D.length;L++)D[L]+=D[L]<=0?Math.min(0,Z[L]):Z[L]}Y&&oe&&!I&&Oe&&!y.hydrologyError&&tn({x:0,y:0,width:e.width,resolution:$,height:D,minHeight:y.globalMinHeight,maxHeight:y.globalMaxHeight},Oe),y.physical={n:$,height:D},Ur&&(y.modificationBase=Ur)}return e.refine&&u!=="gl"&&pi(y,e.width/He().source_resolution(),hi(e.seed),e.detailNoise),c==="overview"&&(u==="gl"||r.retainField)&&(a?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),y.field=await fr(y,Y,I)),c==="overview"&&Y&&(I?y.water=Ze?.water:Oe&&!y.hydrologyError&&(y.hydrology=Oe),ee?.delta&&ee.stats&&(y.conditioning={delta:ee.delta,n:ee.m,stats:ee.stats})),c==="overview"&&(y.relief=ln(y)),y.neural&&y.relief&&(y.neural={...y.neural,land:y.relief.land}),y.generationMs=performance.now()-G,n&&await n.after("hydrology",y.height),y}async function fr(y,w,Y){const I=He().sampling_parameters()[5],X=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((I===1||I===4)&&e.relief!=="cavern"){const $=He().source_resolution(),D=await dt();if(w&&X&&ee?.delta&&!e.underdark){const se=await de(ee.delta,ee.m,$);for(let Q=0;Q<$*$;Q++)D[Q]+=D[Q]<=0?Math.min(0,se[Q]):se[Q]}const Z=w&&X&&!Y&&!y.hydrologyError?Oe:void 0;Z&&tn({x:0,y:0,width:e.width,resolution:$,height:D,minHeight:y.globalMinHeight,maxHeight:y.globalMaxHeight},Z);const L=e.underdark?V?await V.physicalCaveField():H.physical_cave_field():void 0,te=e.underdark?await cn():void 0;return{n:$,data:D,exact:!Z,floor:I===1?.3:0,cave:L?.length?L:void 0,...te?.length?{tunnels:te}:{}}}const oe=He().source_resolution(),O=y.physical?.height.slice()??await Cr(),E=e.relief!=="cavern"&&!e.underdark?void 0:V?await V.physicalCaveField():H.physical_cave_field(),ae=e.underdark?await cn():void 0;return{n:oe,data:O,exact:!1,floor:0,cave:E?.length?E:void 0,...ae?.length?{tunnels:ae}:{}}}n&&await n.before("sampling",`Borne du moteur ${He().max_height.toFixed(2)} m · aperçu ${o.resolution}²`);let De,rr=0,Ve;if(f!=="wasm"&&C&&!V&&!e.underdark){a?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const y=performance.now();try{const w=await W;k&&w&&!k.context.lost&&((!ue||ir!==f||ue.lost)&&(ue?.dispose(),ue=void 0,ue=new $t(k.context,w.pipeline,f,H),ir=f),rr=performance.now()-y,a?.(`GPU · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"}),Ve={...await ue.sample(o,e,H.min_height,H.max_height),generationMs:performance.now()-G,prepareMs:Pe,gpuSetupMs:rr,generationBackend:Le,generationReason:Te,noiseMs:ze,erosionMs:ce,gpuSimulationMs:Ue,nativeEnvironmentMs:_e,erosionProfile:he,coastBackend:Xe,coastMs:Ge,coastReason:gr}),Ve||(De=j?`GPU indisponible : ${j}`:"WebGPU indisponible")}catch(w){De=`GPU indisponible : ${w instanceof Error?w.message:String(w)}`,ue?.dispose(),ue=void 0,ir=void 0}}else V?De="Native Rust sampling on the local service.":f!=="wasm"&&(De="terrain currently sampled in WASM");if(Ve)return er(Ve);a?.(`${V?"Native Rust":"CPU"} · sampling the terrain ${o.resolution} × ${o.resolution}…`,{stage:"terrain-sampling"});const dr=performance.now(),Re=V?await V.sampleRegion(o.x,o.y,o.extent,o.resolution):H.sample_region(o.x,o.y,o.extent,o.resolution);try{return await er({x:Re.x,y:Re.y,width:Re.width,resolution:Re.resolution,minHeight:Re.min_height,maxHeight:Re.max_height,globalMinHeight:He().min_height,globalMaxHeight:He().max_height,motifSize:e.motifSize,height:Re.height,caveMask:Re.cave_mask,normalX:Re.normal_x,normalY:Re.normal_y,normalZ:Re.normal_z,generationMs:performance.now()-G,backend:V?"native":"wasm",backendReason:De,prepareMs:Pe,samplingMs:performance.now()-dr,gpuSetupMs:rr,generationBackend:Le,generationReason:Te,noiseMs:ze,erosionMs:ce,gpuSimulationMs:Ue,nativeEnvironmentMs:_e,erosionProfile:he,coastBackend:Xe,coastMs:Ge,coastReason:gr})}finally{Re.free()}}export{$n as CLIMATE_VALUES,la as DEFAULT_NEURAL_SERVER,zn as DEFAULT_NEURAL_TUNING,ca as DEFAULT_PYTHON_SERVER,sr as EROSION_SETTINGS,sa as GEOLOGICAL_RELIEFS,fa as NEURAL_RELIEF_DEFAULTS,Yr as climateOf,Dr as isNeuralSource,ua as neuralServerForSource,ln as reliefStatistics,ga as sampleRustTerrain};
