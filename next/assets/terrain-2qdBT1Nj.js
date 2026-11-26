import{aG as dn,n as Or,aH as Qe,u as Xr,aI as Fr,aJ as pn,aK as hn,aL as mn,aM as ne,v as Ye,aN as xt,aO as gn,x as pt,q as Gr,aP as ht,aQ as wr,aR as In,aS as ke,aT as mt,aU as vn,aV as Et,aW as Dn,aX as jn,aY as Rt,aZ as $r,a_ as yr,C as $n,O as Wn,a$ as Yn,b0 as Vn,b1 as Jn,b2 as Kn,b3 as Xn,b4 as Zn,b5 as nt,b6 as Mr,b7 as Pr,b8 as Qn,b9 as Nt,ba as ei,bb as yn,bc as ri,t as Bt,r as Tt,bd as ti,be as ni,A as ii,bf as ai,bg as oi,bh as Ot,bi as si,bj as li,y as ci,bk as ui,bl as Gt,bm as Ft,bn as fi,bo as di,bp as pi,bq as hi,br as mi,bs as gi,bt as vi}from"./__vite-browser-external-CPfX5c0R.js";import{T as bt,s as yi,c as kt,p as Jr,C as Lt,l as wi,N as qt,o as xi,a as bi,f as it,b as ki}from"./terrainFingerprint-AJh8kNnl.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function Ht(r,t,a,n){r.set_coast(t,a,JSON.stringify(n))}function It(r,t,a,n){r.configure_coast(t,a,JSON.stringify(n))}function Si(r,t,a,n){r.cut_coast(t,a,JSON.stringify(n))}function _i(r,t,a,n,s,i,c,u,o,e,l,f){return r.cut_field(t,a,n,s,i,c,u,o,e,l,JSON.stringify(f))}let We;const at=new Map;let gt=Promise.resolve();const vt=new bt;function yt(r=!1){const t=We;We=void 0,vt.clear(),r||t?.pipeline?.free(),t?.runtime&&(gt=gt.then(async()=>{await Or(t.runtime,"/terrain/stage",JSON.stringify({session:t.session,command:"cancel"})).catch(()=>{})}))}dn(()=>yt(!0));async function Mi(r,t,a,n,s){t?.backend?.(a?"native":"cpu");const i=Qe(r),c=t?.previews!==!1&&i.n<=1024,u=Xr(r),o=Fr.erosion_at_resolution(r.seed,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix,i.n),e=o.parameters();o.free();const{parameters:l,surface:f}=u?pn(e,r):{parameters:e,surface:e.slice(24,32)};hn(l,f,r,u),mn(f,r,i.n),u&&ne(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural?.erosionTuning?.detail===void 0&&(l[16]=e[16]);const v=(k,P=!0)=>Number(ne(r,k,P)),x=Uint32Array.from([Number(u),v("regional"),v("regionalFinish"),v("amplitude"),v("ridged",!u),v("surface",!u||r.relief==="canyon"),v("normalize"),+(r.procedural?.regionalThermal!==!1),+(r.procedural?.regionalDiffusion!==!1),r.procedural?.reconstruction==="cubic"?1:r.procedural?.reconstruction==="bspline"?2:0,+(r.relief==="canyon")]);s?.(x[5]&&l[23]>0&&f[3]>0?f[1]:void 0,x[1]&&r.erosion>0?l[4]:void 0);const M=yi([r.seed,r.width,i.n,l[2],a?.server??"wasm",!!n]);(i.n>1024||We?.root!==M)&&yt();const z=kt(r),C=Jr(r),b=z.map(k=>C.get(k));let h=0;for(;We&&h<b.length&&We.keys[h]===b[h];)h++;const m=async k=>{try{return await Or(a,"/terrain/stage",JSON.stringify({session:We.session,...k}))}catch(P){throw["coast","restore","preview"].includes(k.command)&&P instanceof Error&&P.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):P}},d=r.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([k,P])=>[k,Ye(r.generalSeed,P)])):void 0,p={parameters:Array.from(l),surface:Array.from(f),flags:Array.from(x),stepSeeds:d??{}},R=async k=>{const P=await m(k),j=await P.json();if(d&&Object.values(d).some(W=>W!==r.seed)&&!j.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!We||h===0?(yt(),a&&!at.has(a.server)&&at.set(a.server,xt()),We={root:M,keys:[],runtime:a,...a?{session:at.get(a.server)}:{}},await t?.before("grids",`Rust ${a?"natif":"WASM"} · régional ${l[2]}² · surface ${f[0]}² · source ${i.n}² à ${i.spacing.toFixed(2)} m`),a?(await gt,await R({command:"start",seed:r.seed,...p})):We.pipeline=new gn(r.seed,l,f,x),await t?.after("grids")):t?.cached?await t.cached("grids"):(await t?.before("grids"),await t?.after("grids"));const U=We;a||U.pipeline.set_step_seeds(JSON.stringify(d??{}));let A;for(let k=0;k<z.length;k++){const P=z[k],j=k<h;if(!j&&k===h&&k>0&&(a?await R({command:"restore",checkpoint:k-1,...p}):U.pipeline.restore(k-1,l,f,x),U.keys.length=k),j){(c||k===z.length-1)&&(A=a?new Float32Array(await(await m({command:"preview",checkpoint:k})).arrayBuffer()):U.pipeline.checkpoint_height(k)),t?.cached?await t.cached(P,c?A:void 0):(await t?.before(P),await t?.after(P,c?A:void 0));continue}await t?.before(P);const W=P==="coastCut"&&pt(r,"coastCut");if(a){const F=await(await m({command:P==="coastCut"?"coast":"advance",stage:Lt.indexOf(P),checkpoint:k,mask:W?r.coastMask:0,mode:r.islandMode??"island",coastProfile:Gr(r),preview:c||k===z.length-1})).arrayBuffer();F.byteLength&&(A=new Float32Array(F))}else{if(P==="initialize"&&n){const B=await n();U.pipeline.set_noise(B.coarse,B.fine)}P==="coastCut"?W&&Si(U.pipeline,r.coastMask,r.islandMode??"island",Gr(r)):U.pipeline.advance(Lt.indexOf(P)),U.pipeline.checkpoint(k),(c||k===z.length-1)&&(A=U.pipeline.height())}U.keys[k]=b[k],await t?.after(P,c?A:void 0)}const G=`${M}|${C.get("phasor")}`,S=i.n<=1024?vt.get("phasor",G):void 0;return S?(t?.cached?await t.cached("phasor",c?S:void 0):(await t?.before("phasor"),await t?.after("phasor",S)),S):(await t?.before("phasor"),ne(r,"phasor",u)&&(A=ht(A,r)),i.n<=1024&&vt.put("phasor",G,A),await t?.after("phasor",c?A:void 0),A)}const Pi=`
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
}`,Dt=new WeakMap;function zi(r,t,a){if(!a.iterations||!a.transport)return r;const n=r.slice(),s=Math.sqrt(n.length),i=t/s,c=new Float32Array(n.length),u=a.azimuth*Math.PI/180,o=Math.cos(u),e=Math.sin(u),l=o>=0?1:-1,f=e>=0?1:-1,v=Math.abs(o)/(Math.abs(o)+Math.abs(e)),x=1-v;for(let M=0;M<a.iterations;M++){c.fill(0);for(let z=1;z<s-1;z++)for(let C=1;C<s-1;C++){const b=z*s+C;if(n[b]<=.3)continue;const h=((n[b+1]-n[b-1])*o+(n[b+s]-n[b-s])*e)/(2*i),m=.75+.25*Math.sin((C*o+z*e)*i/64+n[b]*.03);c[b]=Math.min(Math.max(0,n[b]-.3),a.transport*Math.max(.1,Math.min(1,.55+2*h))*m)}for(let z=0;z<s;z++)for(let C=0;C<s;C++){const b=z*s+C,h=z*s+Math.max(0,Math.min(s-1,C-l)),m=Math.max(0,Math.min(s-1,z-f))*s+C;n[b]=n[b]-c[b]+(h!==b?c[h]*v:0)+(m!==b?c[m]*x:0)}}return n}async function Ui(r,t,a,n){if(!n.iterations||!n.transport)return t;const s=r.device,i=Math.sqrt(t.length);let c=Dt.get(s);c||(c=(async()=>{const v=s.createShaderModule({code:Pi}),M=(await v.getCompilationInfo()).messages.filter(m=>m.type==="error");if(M.length)throw new Error(M.map(m=>`${m.lineNum}: ${m.message}`).join(`
`));const z=s.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),C=s.createPipelineLayout({bindGroupLayouts:[z]}),[b,h]=await Promise.all(["entrain","deposit"].map(m=>s.createComputePipelineAsync({layout:C,compute:{module:v,entryPoint:m}})));return{layout:z,a:b,b:h}})(),Dt.set(s,c));const{layout:u,a:o,b:e}=await c,l=[],f=(v,x)=>{const M=s.createBuffer({size:v,usage:x});return l.push(M),M};try{const v=f(t.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),x=f(t.byteLength,GPUBufferUsage.STORAGE),M=f(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),z=f(t.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);s.queue.writeBuffer(v,0,t);const C=new ArrayBuffer(48),b=new Float32Array(C);new Uint32Array(C)[0]=i;const h=n.azimuth*Math.PI/180;b[1]=a/i,b[2]=Math.cos(h),b[3]=Math.sin(h),b[4]=n.transport,s.queue.writeBuffer(M,0,C);const m=s.createBindGroup({layout:u,entries:[v,x,M].map((S,k)=>({binding:k,resource:{buffer:S}}))}),d=Math.ceil(t.length/256),p=Math.ceil(d/s.limits.maxComputeWorkgroupsPerDimension),R=Math.ceil(d/p),U=s.createCommandEncoder(),A=U.beginComputePass();A.setBindGroup(0,m);for(let S=0;S<n.iterations;S++)A.setPipeline(o),A.dispatchWorkgroups(R,p),A.setPipeline(e),A.dispatchWorkgroups(R,p);A.end(),U.copyBufferToBuffer(v,0,z,0,t.byteLength),s.queue.submit([U.finish()]),await z.mapAsync(GPUMapMode.READ);const G=new Float32Array(z.getMappedRange()).slice();return z.unmap(),G}finally{l.forEach(v=>v.destroy())}}const Ci=`// FP32 sampling of the retained Rust erosion field.\r
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
// Mirrors Rust \`channels.rs\` (\`meander\`, \`turn\`, \`lean\`, \`trunk\`, \`wall\`).\r
fn valley_meander(along: f32, motif: f32) -> f32 {\r
  return motif*(2.8*fbm(vec2<f32>(along/(motif*12.0),branches[0].x),0u,2u,0.5,0.0)+0.65*fbm(vec2<f32>(along/(motif*3.2),7.1),1u,2u,0.5,0.0));\r
}\r
// The trunk valley leans into its bends: wider floor and gentler side inside, the symmetric totals kept.\r
fn valley_trunk(along: f32, offset: f32, meander: f32, motif: f32, footprint: f32) -> f32 {\r
  let floor_width=motif*0.065; let run=motif*0.32; let distance=abs(offset);\r
  if(distance>=floor_width*1.85+max(run*1.55,footprint)){return 1.0;}\r
  let h=motif*0.4;\r
  let curvature=(valley_meander(along+h,motif)+valley_meander(along-h,motif)-2.0*meander)/(h*h);\r
  let turn=tanh(clamp(3.0*curvature*motif,-9.0,9.0));\r
  let wander=clamp(0.9*fbm(vec2<f32>(along/(motif*5.0),23.9),1u,2u,0.5,0.0),-0.6,0.6);\r
  let side=select(1.0,-1.0,offset<0.0)*(turn+(1.0-abs(turn))*wander);\r
  return smooth01((distance-floor_width*(1.0+0.85*side))/max(run*(1.0+0.55*side),footprint));\r
}\r
fn valley_wall(along: f32, across: f32, footprint: f32) -> f32 {\r
  let motif=p.values[0].y;\r
  let meander=valley_meander(along,motif);\r
  let center=branches[0].y+meander+motif*0.10*fbm(vec2<f32>(along/motif,3.7),0u,2u,0.5,0.0);\r
  let floor_width=motif*0.065; let slope=max(motif*0.32,footprint);\r
  var wall=valley_trunk(along,across-center,meander,motif,footprint);\r
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
`;let ot;const Ri=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function _t(){return ot??=(async()=>{const r=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!r)return;const{maxBufferSize:t,maxStorageBufferBindingSize:a}=r.limits,n=await r.requestDevice({requiredFeatures:r.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:t,maxStorageBufferBindingSize:a}}),s={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{s.lost=!0,ot=void 0}),s})().catch(()=>{}),ot}async function Ni(r,t){if(r==="wasm")return;const a=await _t();if(!a||a.lost)return;const n=t==="flat"?0:t==="valley"?2:t==="volcano"||t==="caldera"||t==="plateau"?3:1,s=`${r}:${n}`;let i=a.pipelines.get(s);return i||(i=(async()=>{const c=Ci.replace("// NOISE_KERNEL",St).replace("// VOLCANIC_KERNEL",wn).replace("// COAST_KERNEL",Ei),u=a.device.createShaderModule({code:c});return a.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),i.catch(()=>{}),a.pipelines.set(s,i)),{context:a,pipeline:i}}const Bi=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function jt(r,t,a){const n=r.device,s=Qe(t).n,i=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),c=t.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=c.map(l=>{const f=`generation:${l}`;let v=r.pipelines.get(f);if(!v){const x=n.createShaderModule({code:Ai.replace("// NOISE_KERNEL",St)});v=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[i]}),compute:{module:x,entryPoint:l}}),r.pipelines.set(f,v)}return v}),o=Fr.generation_at_resolution(t.seed,t.width,t.relief,t.motifSize,s),e=[];try{const l=o.parameters();t.procedural?.regionalN&&(l[2]=t.procedural.regionalN,l[4]=t.width*1.44/l[2]),l[6]*=t.procedural?.noiseScale??1;const f=(h,m)=>{const d=n.createBuffer({size:h.byteLength,usage:m|GPUBufferUsage.COPY_DST});return e.push(d),n.queue.writeBuffer(d,0,h),d},v=[f(l,GPUBufferUsage.UNIFORM),f(o.permutations(),GPUBufferUsage.STORAGE),f(o.gradients(),GPUBufferUsage.STORAGE)];a?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const x=await wr(Promise.all(u));a?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const z=c.map(h=>h==="coarse"?l[2]:l[1]).map((h,m)=>{const d=h*h*16,p=n.createBuffer({size:d,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),R=n.createBuffer({size:d,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});e.push(p,R);const U=n.createBindGroup({layout:x[m].getBindGroupLayout(0),entries:[...v,p].map((S,k)=>({binding:k,resource:{buffer:S}}))}),A=n.createCommandEncoder(),G=A.beginComputePass();return G.setPipeline(x[m]),G.setBindGroup(0,U),G.dispatchWorkgroups(Math.ceil(h/8),Math.ceil(h/8)),G.end(),A.copyBufferToBuffer(p,0,R,0,d),n.queue.submit([A.finish()]),R}),C=n.queue.onSubmittedWorkDone().then(()=>a?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),b=await Promise.all(z.map(async h=>{await h.mapAsync(GPUMapMode.READ);const m=new Float32Array(h.getMappedRange().slice(0));return h.unmap(),m}));return await C,{coarse:c.length===2?b[0]:new Float32Array,fine:b[b.length-1]}}finally{o.free(),e.forEach(l=>l.destroy())}}class $t{constructor(t,a,n,s){this.state=t,this.pipeline=a,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=s.sampling_parameters(),this.sourceN=s.source_resolution();let i=0;for(let e=this.sourceN;e>=1;e=Math.floor(e/2))i+=e*e;const c=this.parameters[5]===3?2:1;if(i*c*4>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=s.sampling_field();this.hasField=u.length>0;const o=u.length?u:new Float32Array(1);if(o.byteLength>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(o),this.perm=this.upload(s.sampling_permutations()),this.gradients=this.upload(s.sampling_gradients()),this.branches=this.upload(s.sampling_branches()),this.coast=this.upload(s.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(t,a=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,t.byteLength),usage:a|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,t),n}prepareCoastField(t){return this.dispatchField({x:0,y:0,extent:t.width,resolution:this.sourceN},t),this.output}dispatchField(t,a){const{x:n,y:s,extent:i,resolution:c}=t;if(![n,s,i,c].every(Number.isFinite)||n<0||s<0||i<=0||n+i>a.width+1e-4||s+i>a.width+1e-4||!Number.isInteger(c)||c<16||c>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,o=i/c,e=Math.max(a.motifSize/65536,o*.5),l=this.parameters,f=Math.floor(Math.log2(this.sourceN)),v=Math.min(f,Math.log2(Math.max(1,o*(a.relief==="flat"&&l[5]!==4?2/a.motifSize:1/a.width)*this.sourceN))),x=new Float32Array([l[0],l[1],l[2],l[3],l[4],l[5],this.hasField?1:0,c,n,s,i,o,Math.floor(v),Math.min(f,Math.floor(v)+1),v-Math.floor(v),e,l[6],l[7],this.sourceN,f,...Array.from({length:16},(b,h)=>l[8+h]??0)]),M=c*c*16;M>this.capacity&&(this.output?.destroy(),this.capacity=M,this.output=u.createBuffer({size:M,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((b,h)=>({binding:h,resource:{buffer:b}}))})),u.queue.writeBuffer(this.uniform,0,x);const z=u.createCommandEncoder(),C=z.beginComputePass();C.setPipeline(this.pipeline),C.setBindGroup(0,this.group),C.dispatchWorkgroups(Math.ceil(c/8),Math.ceil(c/8)),C.end(),u.queue.submit([z.finish()])}async sample(t,a,n,s){const i=performance.now(),c=this.state.device,{x:u,y:o,extent:e,resolution:l}=t;this.dispatchField(t,a);const f=l*l*16,v=c.createCommandEncoder();(!this.readback||this.readback.size<f)&&(this.readback?.destroy(),this.readback=c.createBuffer({size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),v.copyBufferToBuffer(this.output,0,this.readback,0,f),c.queue.submit([v.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,f);const x=this.readback.getMappedRange(0,f).slice(0);this.readback.unmap();const M=new Float32Array(x),z=new Float32Array(l*l),C=new Float32Array(l*l),b=new Float32Array(l*l),h=new Float32Array(l*l);let m=1/0,d=-1/0;for(let p=0;p<l*l;p++){const R=p*4;z[p]=M[R],C[p]=M[R+1],b[p]=M[R+2],h[p]=M[R+3],m=Math.min(m,z[p]),d=Math.max(d,z[p])}if(!Number.isFinite(m)||!Number.isFinite(d))throw new Error("Sortie GPU non finie.");return{x:u,y:o,width:e,resolution:l,minHeight:m,maxHeight:d,globalMinHeight:n,globalMaxHeight:s,motifSize:a.motifSize,height:z,normalX:C,normalY:b,normalZ:h,caveMask:new Uint8Array,generationMs:performance.now()-i,backend:this.mode,samplingMs:performance.now()-i}}dispose(){this.buffers.forEach(t=>t.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}const Ti=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`,qr=new WeakMap,st=new WeakMap,Wt=new Set;function Hr(r){r.nodes?.destroy(),r.fine?.destroy(),r.control.destroy()}const Yt=new WeakMap,lt=new WeakMap,Vt=new WeakMap,Jt=new WeakMap,xn=new WeakSet,Fi=512*1048576,Kt=1024,Li=1088,ct=Li+4096;function bn(r,t){const a=(Vt.get(r.device)??Promise.resolve()).then(t);return Vt.set(r.device,a.then(()=>{},()=>{})),a}async function qi(r,t,a,n){let s=Yt.get(r);s||(s=(async()=>{const e=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(M=>({binding:M,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(M=>({binding:M,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),l=r.createShaderModule({code:Gi.replace("// NOISE_KERNEL",St).replace("// VOLCANIC_KERNEL",wn)+Ti+Oi}),v=(await wr(l.getCompilationInfo())).messages.filter(M=>M.type==="error");if(v.length)throw new Error(v.map(M=>`${M.lineNum}: ${M.message}`).join(`
`));const x=r.createPipelineLayout({bindGroupLayouts:[e]});return{layout:e,module:l,pipelineLayout:x,values:new Map,pending:new Map}})(),Yt.set(r,s)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const i=await wr(s),c=[],u=[...t].reduce((e,l)=>e+(l==="solveTile"?a.size:1),0);let o=0;for(const e of t)for(const l of e==="solveTile"?a:[void 0]){const f=l===void 0?e:`solveTile:${l}`;let v=i.pending.get(f);v||(v=r.createComputePipelineAsync({layout:i.pipelineLayout,compute:{module:i.module,entryPoint:e,...l===void 0?{}:{constants:{SOLVE_MODE:l}}}}),v=v.then(x=>(i.values.set(f,x),x)),i.pending.set(f,v)),c.push(v.then(x=>(o++,n?.(`GPU · shaders d’érosion prêts ${o}/${u}`,{stage:"gpu-erosion-compile",completed:o,total:u}),x)))}return await wr(Promise.all(c)),xn.add(r),i}class Tr extends Error{}class Hi extends Error{}function kn(r,t,a,n,s){const i=Fr.erosion_at_resolution(r.seed,r.width,a,r.erosion,r.motifSize,r.mountainMix,t);try{const c=i.parameters(),u=n?pn(c,r,s):{parameters:c,surface:(s??c.slice(24,32)).slice()};return hn(u.parameters,u.surface,r,n,!!s),mn(u.surface,r,t),{noise:i,parameters:u.parameters,surface:u.surface,original:c}}catch(c){throw i.free(),c}}const Ii=["hills","mountains","mixed","high-mountains","valley","canyon"];function Di(r,t){const a=Qe(t).n,n=Xr(t),s=Ii.includes(t.relief)?t.relief:t.relief==="flat"?"hills":"mixed",{noise:i,parameters:c,surface:u}=kn(t,a,s,n);i.free();const o=c[2],e=u[0],l=u[3],f=In(r.device.limits,a,Math.max(o,t.erosion>0&&(!n||l>0)?e:0));return{sourceN:a,regionalN:o,regionalSteps:c[13],surfaceN:e,surfaceSteps:l,pipelinesReady:xn.has(r.device),error:f}}async function ji(r,t,a,n,s){return bn(r,()=>$i(r,t,a,n,s))}async function $i(r,t,a,n,s){const i=Qe(t).n;for(const c of[1,2,4,8,16])try{return await Sn(r,t,i,c,void 0,{source:a,tuning:n},void 0,s)}catch(u){if(!(u instanceof Tr)||c===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function Xt(r,t,a,n){return a?.control?.backend?.("gpu"),bn(r,()=>Wi(r,t,a,n))}async function Wi(r,t,a,n){const s=Qe(t).n;if(t.relief==="volcano"||t.relief==="caldera"||t.relief==="plateau"){const i=Fr.finite_shape(t.seed,t.motifSize,t.relief,t.erosion),c=i.parameters();i.free();const u=t.environment??"mixed",o=t.motifSize*c[15];let e;if(u==="flat"){const v=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),e=ke.prepare_environment_at_resolution(t.seed,t.width,u,t.erosion,o,s),a&&(a.nativeEnvironmentMs=performance.now()-v)}else e=await ut(r,{...t,motifSize:o,relief:u,mountainMix:.5},s,void 0,a,n);const l=await ut(r,{...t,width:t.motifSize},s,c,a,n),f=new Float32Array(l.length+e.length);return f.set(l),f.set(e,l.length),f}return ut(r,t,s,void 0,a,n)}async function ut(r,t,a,n,s,i){for(const c of[1,2,4,8,16])try{return await Sn(r,t,a,c,n,void 0,s,i)}catch(u){if(!(u instanceof Tr)||c===16)throw u}throw new Error("Érosion GPU non convergée.")}async function Sn(r,t,a,n,s,i,c,u){const o=r.device,e=i?void 0:c?.control,l=Xr(t),f=!!t.generalSeed&&mt(t.generalSeed,d=>d.startsWith("relief-"))!==vn(t.generalSeed),{noise:v,parameters:x,surface:M,original:z}=kn(t,a,i||l&&t.relief==="flat"?"hills":s?"mixed":t.relief,l,i?.tuning);let C=lt.get(o);if(!C){C=[],lt.set(o,C);const d=C;o.lost.then(()=>d.forEach(p=>p.destroy()))}const b=!!e&&e.previews!==!1&&a<=Kt;let h=!!e&&e.previews!==!1,m=0;try{l&&t.procedural&&ne(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural.erosionTuning?.detail===void 0&&(x[16]=z[16]);const d=x.slice(0,24),p=d[2],R=d[13],U=d[18],A=i?[1,0,0,.2,1,1,0,0]:Array.from(x.slice(33,41)),G=A.slice();G[4]=1;const S=!i&&A[6]>.5,k=Math.min(n,4),P=d.slice();P[2]=M[0],P[4]=M[1],P[5]=M[2],P[15]=s&&!i?s[13]:M[4],P[18]=M[5],P[22]=M[6];const j=Math.max(1,P[2]/1048),W=Math.ceil(Math.min((s||i||t.relief==="mixed"?64:32)*n,512)*j),B=!i&&ne(t,"phasor",l)?"generationPhasorPack":"packHeight",F=l?"compactInitialize":"initialize",J=!!i||ne(t,"surface",!l||t.relief==="canyon")&&(!l||t.relief==="canyon"||M[3]>0),he=()=>{i||c?.onPhysicalPlan?.(t.erosion>0&&J&&M[3]>0?M[1]:void 0,!s&&t.erosion>0&&(ne(t,"regional")||ne(t,"regionalFinish"))?d[4]:void 0)},re=t.procedural?.reconstruction&&t.procedural.reconstruction!=="default"?"generationReconstruct":l?"compactReconstruct":"reconstruct",de=new Set([B,...ne(t,"amplitude")?[]:["generationUnitScale"],...ne(t,"normalize")?[]:["generationKeepDatum"],...e?["generationPreview"]:[],...!i&&!s&&t.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),ie=new Set,K=(...g)=>g.forEach(_=>de.add(_));f&&!i&&!s&&K("generationCut","generationRegionalRead","generationPreview"),(i||!s&&(f||t.procedural))&&K("seaLandMark","seaMaskGrow");const Se=()=>K("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");i?K("coastLoad","coastResult"):K("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!i&&!s?(K(F,"uplift","bounds",re,"detail"),U>0&&(Se(),K("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(g=>ie.add(g)))):s&&!i&&K("volcanicInitial"),t.erosion>0&&J&&(Se(),K("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),ie.add(1),ie.add(3),t.relief==="canyon"&&!i&&(K("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),ie.add(0)),S&&(K("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),ie.add(0))),e&&await e.before("grids",`Budget ×${n} · régional ${p}² · surface ${P[2]}² · sortie ${a}²`);const Ie=performance.now(),ve=await qi(o,de,ie,u),we=performance.now()-Ie,Pe=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let ze=!1;const ue=(g,_)=>{const N=m++;let T=C[N];return(!T||T.size<g||T.usage!==_)&&(T?.destroy(),T=o.createBuffer({size:g,usage:_}),C[N]=T,ze=!0),T},Ue=g=>{const _=ue(g.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return o.queue.writeBuffer(_,0,g),_},_e=t.erosion>0&&J?Math.max(p,P[2]):p,me=a**2,ye=me*4,Ne=me*16,ge=Math.max(me,p*p)*4;o.pushErrorScope("out-of-memory");const Ce=ue(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),Ae=ue(_e**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ge=ue(Ne,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Fe=ue(ct,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ee=ue(ge,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),pe=ue(ge+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),er=ue(Math.ceil(_e/16)**2*8,GPUBufferUsage.STORAGE),fr=o.popErrorScope();if(ze&&await fr)throw h=!0,new Hi(`WebGPU : mémoire insuffisante pour la source ${a}² et la grille d’érosion ${_e}².`);h||=C.reduce((g,_)=>g+_.size,0)>Fi;const De=g=>pe.mapAsync(GPUMapMode.READ,0,g),rr=g=>pe.getMappedRange(0,g),Ve=!i&&!s&&!!(t.procedural||f),dr=Ve&&a<=Kt,Re=b||Ve;let y=Re?void 0:Jt.get(o);if(!Re&&!y&&o.features.has("timestamp-query")){y=o.createQuerySet({type:"timestamp",count:6}),Jt.set(o,y);const g=y;o.lost.then(()=>g.destroy())}const w=y?ue(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,Y=y?ue(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,I=(g,_)=>o.createBindGroup({layout:ve.layout,entries:[{binding:0,resource:{buffer:Ce,size:224}},...[Ue(g),Ue(_),Ae,Ge,Fe,Ee,er].map((N,T)=>({binding:T+1,resource:{buffer:N}}))]});let X=I(v.permutations(),v.gradients());const oe=new Map([[t.seed,X]]),O=g=>{const _={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[g];if(!_||!t.generalSeed)return;const N=Ye(t.generalSeed,_);let T=oe.get(N);if(!T){const ce=Fr.erosion(N,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix);try{T=I(ce.permutations(),ce.gradients())}finally{ce.free()}oe.set(N,T)}X=T},E=new Map;let ae=A;const $=(g,_)=>{const N=[..._,...g,...ae].join(",");let T=E.get(N);if(T===void 0){if(T=E.size*256,T+224>65536)throw new Error("Too many GPU variants.");E.set(N,T),o.queue.writeBuffer(Ce,T,new Float32Array([..._,...g,...l?Et(t,!!i):!s&&!i&&ne(t,"phasor",!1)?Et(t):s??new Float32Array(16),...ae]))}return T};let D=o.createCommandEncoder();D.clearBuffer(Fe),i&&D.copyBufferToBuffer(i.source,0,Ge,0,Ne);const Z=g=>D.beginComputePass(y?{timestampWrites:{querySet:y,beginningOfPassWriteIndex:g,endOfPassWriteIndex:g+1}}:void 0);let L=Z(0);const te=[0,0,1,0,0,0,.6,0];te[4]=x[32];const se=[0,0,.95,U*.5,0,0,.5,0];let Q=d;const q=(g,_=te,N=Math.ceil(Q[2]**2/256),T=1)=>{L.setPipeline(ve.values.get(g==="solveTile"?`solveTile:${_[1]}`:g)),L.setBindGroup(0,X,[$(_,Q)]),L.dispatchWorkgroups(N,T)},xe=Math.ceil(me/256),Je=Math.ceil(xe/o.limits.maxComputeWorkgroupsPerDimension),le=(g,_=te)=>q(g,_,Math.ceil(xe/Je),Je),He=(g,_,N=!1)=>{const T=te.slice();T[1]=g,T[7]=N?1:0,q(g===0?"floodInit":"graphInit",T),q("start",T,1);const ce=[0,1].map(be=>(T[0]=be,$(T,Q)));for(let be=0;be<_;be++){const or=[ce[be&1]];L.setPipeline(ve.values.get("clearNext")),L.setBindGroup(0,X,or),L.dispatchWorkgroups(1),L.setPipeline(ve.values.get(`solveTile:${g}`)),L.dispatchWorkgroups(Math.ceil(Q[2]/16),Math.ceil(Q[2]/16))}T[0]=0,q("solveStats",T,1),g===0?(q("floodCheck",T,1),q("receivers")):q("graphFinish",T)},Zr=(g=te,_=!0)=>{q("pitInit");for(let N=0;N<8*k+Math.ceil(Math.log2(Math.max(1,Q[2]/1048)));N++)q("pitUnion"),q("pitCompress");for(const N of _?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])q(N,g)},Qr=g=>{if(g<=0)return;const _=te.slice();_[6]=g,q("breachInit"),q("breach",_),q("breachFinish")},et=(g,_=te)=>{if(!(Q===d&&t.procedural?.regionalThermal===!1))for(let N=0;N<g;N++)for(const T of["thermalFlux","thermalApply","copyHeight"])q(T,_)},Lr=(g,_=te)=>{if(Q===d&&t.procedural?.regionalDiffusion===!1)return;const N=_.slice();N[3]=g,q("diffuse",N),q("copyHeight",N)},zt=g=>{const _=Dn(jn({surfaceSteps:M[3],surfaceCell:M[1],regionalCell:d[4],sourceCell:d[11],warp:A[5]*Math.min(16*d[3],d[4]*.9)}),t.width);if(_===void 0)return;const N=te.slice();N[7]=g,g===0?q("seaLandMark",N):le("seaLandMark",N),N[5]=_,q("seaMaskGrow",N,2)},Ut=g=>{const _=te.slice();_[4]=g,q("percentileInit",_,1);for(const N of[24,16,8,0])_[5]=N,q("histogramClear",_,1),le("histogram",_),q("percentileSelect",_,1)},Ct=async(g,_,N)=>{if(!e)return;if(!b){await e.after(g,void 0,N);return}if(_!==3){const or=te.slice();or[7]=_,le("generationPreview",or)}L.end(),D.copyBufferToBuffer(Ee,0,pe,0,ye),D.copyBufferToBuffer(Fe,0,pe,ye,1088),o.queue.submit([D.finish()]),await De(ye+1088);const T=rr(ye+1088),ce=new Uint32Array(T,ye,272)[2],be=new Float32Array(T,0,me).slice();if(pe.unmap(),ce)throw new Tr("Érosion GPU non convergée pendant une étape.");if(!be.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await e.after(g,be,N),D=o.createCommandEncoder(),L=Z(0)},pr=kt(t),Cn=Jr(t);let Be=dr?qr.get(o):void 0;if(dr&&!Be){Be=new Map,qr.set(o,Be),Wt.add(o);const g=Be;o.lost.then(()=>{g.forEach(Hr),g.clear(),Wt.delete(o)})}const xr=g=>`${n}|${Cn.get(g)}`;let tr=0;for(;Be&&tr<pr.length&&Be.get(pr[tr])?.key===xr(pr[tr]);)tr++;if(Be)for(const g of[...pr.slice(tr),"phasor"]){const _=Be.get(g);_&&(g!=="phasor"||_.key!==xr(g)||tr<pr.length)&&(Hr(_),Be.delete(g))}const An=g=>{L.end(),g.nodes&&D.copyBufferToBuffer(g.nodes,0,Ae,0,g.nodes.size),g.fine&&D.copyBufferToBuffer(g.fine,0,Ge,0,g.fine.size),D.copyBufferToBuffer(g.control,0,Fe,0,ct),L=Z(0)},En=(g,_)=>{if(!Be)return;L.end();const N=(ce,be=ce.size)=>{const or=o.createBuffer({size:be,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return D.copyBufferToBuffer(ce,0,or,0,be),or},T=Be.get(g);T&&Hr(T),Be.set(g,{key:xr(g),kind:_,..._===0?{nodes:N(Ae,p*p*112)}:{fine:N(Ge,Ne)},control:N(Fe,ct)}),o.queue.submit([D.finish()]),D=o.createCommandEncoder(),L=Z(0)},Rn=async(g,_)=>{if(!e)return;if(!b){e.cached?await e.cached(g):(await e.before(g),await e.after(g));return}const N=te.slice();N[7]=_.kind,le("generationPreview",N),L.end(),D.copyBufferToBuffer(Ee,0,pe,0,ye),o.queue.submit([D.finish()]),await De(ye);const T=new Float32Array(rr(ye),0,me).slice();pe.unmap(),e.cached?await e.cached(g,T):(await e.before(g),await e.after(g,T)),D=o.createCommandEncoder(),L=Z(0)},Ke=async(g,_,N)=>{const T=pr.indexOf(g),ce=Be?.get(g);if(ce&&T>=0&&T<tr){(b||T===tr-1)&&An(ce),await Rn(g,ce);return}await e?.before(g),O(g),await N(),En(g,_),await Ct(g,_)},Nn=t.procedural?.coastAfter??"initialize",hr=async(g,_)=>{!Ve||g!==Nn||await Ke("coastCut",_===4?5:_,async()=>{if(!pt(t,"coastCut"))return;const N=te.slice();N[7]=_,_===0?q("generationRegionalRead",N,Math.ceil(p*p/256)):le("generationPreview",N),L.end();const T=_===0?p*p:me;D.copyBufferToBuffer(Ee,0,pe,0,T*4),o.queue.submit([D.finish()]),await De(T*4);const ce=new Float32Array(rr(T*4),0,T).slice();pe.unmap();const be=_i(gn,Ye(t.generalSeed??t.seed,"relief-coast-cut"),t.width,x[3]*2400,x[12],t.coastMask,t.islandMode??"island",_===0?p:a,_===0?d[5]:0,_===0?d[4]:d[11],ce,Gr(t));o.queue.writeBuffer(Ee,0,be),D=o.createCommandEncoder(),L=Z(0),_===0?q("generationCut",N,Math.ceil(p*p/256)):le("generationCut",N),zt(_)})};e&&await e.after("grids",void 0,`Budget ×${n} · régional ${p}² · surface ${P[2]}² · ${(C.reduce((g,_)=>g+_.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${R} cycles de relief et ${M[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),i?(Q=P,le("coastLoad"),zt(2)):s?(e&&await e.before("initialize"),Q=P,le("volcanicInitial"),e&&await Ct("initialize",2)):(await Ke("initialize",0,()=>{q(F)}),await hr("initialize",0),await Ke("regional",0,()=>{for(let g=0;g<(ne(t,"regional")?R:0);g++){if(q("uplift"),U>0){He(0,64*k),Zr(),q("flow"),Qr(A[1]),He(1,128*k),He(2,128*k),et(3);const _=d[17]*3*U;for(let N=0;N<Math.floor(_);N++)Lr(.5);_%1>0&&Lr(.5*(_%1))}q("bounds")}}),await Ke("regionalFinish",0,()=>{const g=te.slice();if(g[7]=1,q("bounds",g),U>0&&ne(t,"regionalFinish")){et(4,se);for(let _=0;_<6;_++)He(0,64*k),Zr(se),q("flow"),Qr(A[2]);Lr(U*.5,se)}}),await hr("regionalFinish",0),await Ke("reconstruct",1,()=>{const g=te.slice();g[7]=t.procedural?.reconstruction==="bspline"?1:0,le(re,g)}),await Ke("amplitude",4,()=>{ne(t,"amplitude")?Ut(0):q("generationUnitScale",te,1)}),await hr("amplitude",4),await Ke("ridged",2,()=>{le("detail")}),await hr("ridged",2)),L.end(),L=Z(2),await Ke("surface",2,()=>{if(t.erosion>0&&J){if(Q=P,ae=G,q("surfaceLoad"),t.relief==="canyon"&&!i){const g=Math.ceil(128*k*j);He(0,g),q("flow"),He(1,g),q("canyonSeed");let _=0;const N=[];for(let ce=2**(Math.ceil(Math.log2(P[2]))-1);ce>=1;ce/=2)N.push(ce);N.push(1,1);for(const ce of N){const be=te.slice();be[0]=_,be[1]=ce,q("canyonSpread",be),_=1-_}const T=te.slice();T[0]=_,q("canyonApply",T)}for(let g=0;g<M[3];g++)S?(He(0,W),Zr(te,!1),q("flow"),Qr(A[7])):(q("surfaceFlowInit"),q("receivers"),q("flow")),He(1,W,!0),He(3,W,!0),et(1),Lr(M[7]);q("surfaceDelta"),le("surfaceReconstruct")}}),await hr("surface",2),L.end(),L=Z(4),await Ke("normalize",1,()=>{i?le("coastResult"):ne(t,"normalize")?(Ut(1),le("normalize")):le("generationKeepDatum")}),await hr("normalize",1);let br=st.get(o);br||(br=new bt,st.set(o,br));const kr=dr?br.get("phasor",xr("phasor")):void 0;if(kr)return L.end(),o.queue.submit([D.finish()]),e?.cached?await e.cached("phasor",b?kr:void 0):(await e?.before("phasor"),await e?.after("phasor",kr)),he(),kr;kr||await e?.before("phasor"),le(B),L.end();const Sr=ye;D.copyBufferToBuffer(Ee,0,pe,0,Sr),D.copyBufferToBuffer(Fe,0,pe,Sr,1088),y&&w&&Y&&(D.resolveQuerySet(y,0,6,w,0),D.copyBufferToBuffer(w,0,Y,0,48));const Bn=D.finish(),Tn=performance.now()-Pe;u?.(i?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const On=performance.now();o.queue.submit([Bn]);const Gn=o.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([De(Sr+1088),Y?.mapAsync(GPUMapMode.READ),Gn]);const Fn=performance.now()-On,Ln=performance.now(),At=rr(Sr+1088),rt=new Uint32Array(At,Sr,272),qn=Array.from(rt.slice(267,271)),tt={factor:n,sourceSize:a,coarseSize:p,surfaceSize:P[2],pipelineMs:we,encodeMs:Tn,submitReadbackMs:Fn,unpackMs:0,maxSolveSteps:qn,allocatedBytes:C.reduce((g,_)=>g+_.size,0)};if(Y){const g=new BigUint64Array(Y.getMappedRange());tt.gpuStagesMs={coarse:Number(g[1]-g[0])/1e6,surface:Number(g[3]-g[2])/1e6,normalization:Number(g[5]-g[4])/1e6},Y.unmap()}if(c&&(c.profiles??=[]).push(tt),rt[2]!==0)throw pe.unmap(),new Tr(`Érosion GPU non convergée (${rt[2]} cellules/étapes, budget ×${n}).`);const _r=new Float32Array(At,0,me).slice();pe.unmap(),tt.unpackMs=performance.now()-Ln;const Hn=i||Ve&&pt(t,"coastCut")?-1/0:.3-1e-7;for(let g=0;g<me;g++)if(!Number.isFinite(_r[g])||_r[g]<Hn)throw new Error("Champ GPU invalide.");return he(),dr&&br.put("phasor",xr("phasor"),_r),e&&await e.after("phasor",b?_r:void 0,"Sortie GPU lue et validée"),_r}catch(d){throw d instanceof Tr&&(qr.get(o)?.forEach(Hr),qr.get(o)?.clear(),st.delete(o)),d}finally{v.free(),C.forEach(d=>{d.mapState!=="unmapped"&&d.unmap(),h&&d.destroy()}),h&&lt.delete(o)}}const Yi=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`,Vi=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],Zt=new WeakMap,Qt=new WeakMap;function Ji(r){let t=Zt.get(r);return t||(t=(async()=>{const a=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(o=>({binding:o,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(o=>({binding:o,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=r.createShaderModule({code:Yi}),i=(await n.getCompilationInfo()).messages.filter(o=>o.type==="error");if(i.length)throw new Error(`Hydrologie WGSL : ${i.map(o=>`${o.lineNum}: ${o.message}`).join(`
`)}`);const c=r.createPipelineLayout({bindGroupLayouts:[a]}),u=await Promise.all(Vi.map(async o=>[o,await r.createComputePipelineAsync({layout:c,compute:{module:n,entryPoint:o}})]));return{layout:a,values:new Map(u)}})(),Zt.set(r,t)),t}function Ki(r){let t=2166136261;for(let a=0;a<r.length;a++)t=Math.imul(t^r.charCodeAt(a),16777619);return t>>>0}function Xi(r,t,a){const n=new Uint32Array(r.length);if(!a)return{mask:n,count:0};const s=new Uint8Array(r.length),i=new Uint32Array(r.length);let c=0,u=0,o=0;const e=f=>{s[f]===0&&r[f]<=0&&(s[f]=1,i[u++]=f)},l=f=>{if(s[f]!==0||r[f]>0)return;c=0,u=0,e(f);let v=!1;for(;c<u;){const x=i[c++],M=x%t,z=Math.floor(x/t);v||=M+1<t&&z+1<t&&r[x+1]<=0&&r[x+t]<=0&&r[x+t+1]<=0;for(let C=-1;C<=1;C++){const b=z+C;if(!(b<0||b>=t))for(let h=-1;h<=1;h++){const m=M+h;m>=0&&m<t&&e(b*t+m)}}}if(v){for(let x=0;x<u;x++)n[i[x]]=1;o+=u}};for(let f=0;f<t;f++)l(f),l((t-1)*t+f);for(let f=1;f+1<t;f++)l(f*t),l(f*t+t-1);return{mask:n,count:o}}class Zi{constructor(t,a,n){this.device=t,this.n=a,this.program=n,this.buffers=[],this.pending=Promise.resolve();const s=a*a,i=(u,o)=>{const e=t.createBuffer({size:u,usage:o});return this.buffers.push(e),e};this.uniform=i(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=i(s*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=i(s*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const c=i(s*48,GPUBufferUsage.STORAGE);this.control=i(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=i(s*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=i(s*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=i(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=t.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,c,this.control,this.output].map((u,o)=>({binding:o+1,resource:{buffer:u}}))]}),t.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(t,a,n,s){const i=this.pending.then(()=>this.execute(t,a,n,s));return this.pending=i.then(()=>{},()=>{}),i}async execute(t,a,n,s){const i=performance.now(),c=this.n,u=c*c,o=a/c,e=Xi(t,c,s),l=performance.now()-i,f=this.device;f.queue.writeBuffer(this.source,0,t),f.queue.writeBuffer(this.sea,0,e.mask);for(let B=0;B<2;B++){const F=new ArrayBuffer(32);new Uint32Array(F,0,4).set([c,Ki(n),B,s?1:0]),new Float32Array(F,16,4).set([o,o*o,Math.max(.1,o*.1),0]),f.queue.writeBuffer(this.uniform,B*256,F)}const v=(B,F,J=0)=>{B.setPipeline(this.program.values.get(F)),B.setBindGroup(0,this.group,[J*256]),F==="solveTile"?B.dispatchWorkgroups(Math.ceil(c/16),Math.ceil(c/16)):B.dispatchWorkgroups(F==="reset"||F==="clearNext"?1:Math.ceil(u/256))},x=performance.now(),M=f.createCommandEncoder(),z=M.beginComputePass();v(z,"reset"),v(z,"initialize"),z.end(),f.queue.submit([M.finish()]);let C=0,b=!1,h=32;const m=Math.max(256,c);for(;C<m;){const B=f.createCommandEncoder(),F=B.beginComputePass();for(let he=0;he<h;he++){const re=C+he&1;v(F,"clearNext",re),v(F,"solveTile",re)}F.end(),B.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),f.queue.submit([B.finish()]),C+=h,h=Math.min(h*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const J=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),J===0){b=!0;break}}if(!b)throw new Error(`Drainage hydrique GPU non convergé après ${C} passes (${c}²) ; repli CPU requis.`);const d=f.createCommandEncoder(),p=d.beginComputePass();v(p,"receivers");const R=Math.ceil(Math.log2(u));for(let B=0;B<R;B++){const F=B&1;v(p,"accumulateCopy",F),v(p,"accumulateScatter",F)}v(p,"finish",R&1),p.end();const U=u*16;d.copyBufferToBuffer(this.output,0,this.readback,0,U),d.copyBufferToBuffer(this.control,0,this.readback,U,16),f.queue.submit([d.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const A=performance.now()-x,G=performance.now();let S,k,P,j;try{const B=this.readback.getMappedRange(),F=new Uint32Array(B,U,4);if(F[2]!==0||F[3]!==u-e.count)throw new Error(`Drainage hydrique GPU invalide (${F[2]} erreurs, ${F[3]}/${u-e.count} cellules drainées) ; repli CPU requis.`);const J=new Float32Array(B,0,u*4),he=new Uint32Array(B,0,u*4);S=new Float32Array(u),k=new Uint32Array(u),P=new Float32Array(u),j=new Float32Array(u);for(let re=0;re<u;re++)S[re]=J[re*4],k[re]=he[re*4+1],P[re]=J[re*4+2],j[re]=J[re*4+3]}finally{this.readback.unmap()}const W=new Uint8Array(e.mask);return{filled:S,receivers:k,accumulation:P,potential:j,seaMask:W,preprocessingMs:l,computeMs:A,readbackMs:performance.now()-G,floodPasses:C}}}async function Qi(r,t,a,n,s=!1){if(![256,512,1024].includes(a)||r.length!==a*a||!Number.isFinite(t)||t<=0||!r.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const i=await _t();if(!i||i.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const c=await Ji(i.device);if(i.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=Qt.get(i.device);u||(u=new Map,Qt.set(i.device,u));let o=u.get(a);return o||(o=new Zi(i.device,a,c),u.set(a,o)),o.run(r,t,n,s)}const en=new WeakMap;function ea(r){const t=en.get(r);if(t)return t;const a=new Float32Array(r.baseHeight.length),n=[],s=h=>r.drainageHeight[h]<r.rawDrainageHeight[h]&&r.surfaceHeight[h]<r.baseHeight[h];let i=!1;for(let h=0;h<a.length;h++){const m=s(h);m&&n.push(h),a[h]=m?0:r.surfaceHeight[h]-r.baseHeight[h],i||=a[h]!==0}const c=256,u=r.width/c,o=new Map,e=[],l=r.riverPoints,f=new Map,v=[],x=r.resolution,M=r.width/x,z=h=>Math.min(M*2,Math.max(M*.5,(r.baseHeight[h]-r.surfaceHeight[h])*1.4)),C=h=>((Math.imul(h^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const h of n){const m=h%x,d=Math.floor(h/x),p=(m+.5)*M,R=(d+.5)*M,U=[];for(let A=-1;A<=1;A++)for(let G=-1;G<=1;G++){const S=m+G,k=d+A,P=k*x+S;if(!G&&!A||S<0||k<0||S>=x||k>=x)continue;const j=s(P);(j&&P>h||!j&&r.basins[P]&&r.surfaceHeight[P]<=r.surfaceHeight[h])&&U.push(P)}U.length||U.push(h);for(const A of U){const G=(A%x+.5)*M,S=(Math.floor(A/x)+.5)*M,k=v.length,P=z(h),j=z(A),W=C(h),B=Math.max(P,j)*(1+Math.abs(W));v.push({a:h,b:A,ra:P,rb:j,skew:W});const F=Me(Math.min(p,G)-B,u,c),J=Me(Math.max(p,G)+B,u,c),he=Me(Math.min(R,S)-B,u,c),re=Me(Math.max(R,S)+B,u,c);for(let de=he;de<=re;de++)for(let ie=F;ie<=J;ie++){const K=de*c+ie,Se=f.get(K);Se?Se.push(k):f.set(K,[k])}}}if(r.incision>0)for(let h=0;h<r.riverCount;h++)for(let m=r.riverOffsets[h];m+1<r.riverOffsets[h+1];m++){const d=m+1,p=Math.max(l[m*4+2],l[d*4+2])*.65+.5,R=e.length;e.push({a:m,b:d,estuary:r.riverMeta[h*6+5]});const U=Me(Math.min(l[m*4],l[d*4])-p,u,c),A=Me(Math.max(l[m*4],l[d*4])+p,u,c),G=Me(Math.min(l[m*4+1],l[d*4+1])-p,u,c),S=Me(Math.max(l[m*4+1],l[d*4+1])+p,u,c);for(let k=G;k<=S;k++)for(let P=U;P<=A;P++){const j=k*c+P,W=o.get(j);W?W.push(R):o.set(j,[R])}}const b={delta:a,hasDelta:i,hasSea:r.basins.includes(0),buckets:o,segments:e,bucketSize:u,side:c,notchBuckets:f,notches:v};return en.set(r,b),b}const Me=(r,t,a)=>Math.max(0,Math.min(a-1,Math.floor(r/t)));function rn(r,t,a,n,s){const i=new Int32Array(a*4),c=new Float64Array(a*4);for(let u=0;u<a;u++){const o=Math.max(0,Math.min(s-1,(r+(u+.5)*t)/n-.5)),e=Math.floor(o),l=o-e,f=1-l;for(let v=0;v<4;v++)i[u*4+v]=Math.max(0,Math.min(s-1,e+v-1));c.set([f**3/6,(3*l**3-6*l*l+4)/6,(-3*l**3+3*l*l+3*l+1)/6,l**3/6],u*4)}return{indices:i,weights:c}}function _n(r,t,a=!0){const n=r.resolution,s=r.width/n,i=ea(t);if(!i.hasDelta&&!i.segments.length&&!i.notches.length)return;const c=a?new Float32Array(n*n):void 0;if(i.hasDelta){const m=t.resolution,d=t.width/m,p=rn(r.x,s,n,d,m),R=rn(r.y,s,n,d,m),U=R.indices[0],A=R.indices[R.indices.length-1],G=new Float64Array((A-U+1)*n);for(let S=U;S<=A;S++){const k=S*m,P=(S-U)*n;for(let j=0;j<n;j++){const W=j*4;G[P+j]=i.delta[k+p.indices[W]]*p.weights[W]+i.delta[k+p.indices[W+1]]*p.weights[W+1]+i.delta[k+p.indices[W+2]]*p.weights[W+2]+i.delta[k+p.indices[W+3]]*p.weights[W+3]}}for(let S=0;S<n;S++)for(let k=0;k<n;k++){const P=S*4;let j=G[(R.indices[P]-U)*n+k]*R.weights[P]+G[(R.indices[P+1]-U)*n+k]*R.weights[P+1]+G[(R.indices[P+2]-U)*n+k]*R.weights[P+2]+G[(R.indices[P+3]-U)*n+k]*R.weights[P+3];if(j>0&&i.hasSea&&r.height[S*n+k]<=0){const W=Math.max(0,Math.min(m-1,Math.floor((r.x+(k+.5)*s)/d))),B=Math.max(0,Math.min(m-1,Math.floor((r.y+(S+.5)*s)/d))),F=B*m+W;(!t.basins[F]||t.baseHeight[F]>=0)&&(j=0)}c&&(c[S*n+k]=j),r.height[S*n+k]+=j}}const u=new Set,{bucketSize:o,side:e}=i;for(let m=Me(r.y,o,e);m<=Me(r.y+r.width,o,e);m++)for(let d=Me(r.x,o,e);d<=Me(r.x+r.width,o,e);d++)for(const p of i.buckets.get(m*e+d)??[])u.add(p);const l=new Float32Array(n*n),f=t.riverPoints,v=(m,d)=>Math.max(0,Math.min(n-1,Math.floor((m-d)/s))),x=new Set;for(let m=Me(r.y,o,e);m<=Me(r.y+r.width,o,e);m++)for(let d=Me(r.x,o,e);d<=Me(r.x+r.width,o,e);d++)for(const p of i.notchBuckets.get(m*e+d)??[])x.add(p);const M=t.resolution,z=t.width/M,C=z*.25;for(const m of x){const{a:d,b:p,ra:R,rb:U,skew:A}=i.notches[m],G=Math.max(R,U)*(1+Math.abs(A)),S=(d%M+.5)*z,k=(Math.floor(d/M)+.5)*z,P=(p%M+.5)*z,j=(Math.floor(p/M)+.5)*z,W=P-S,B=j-k,F=W*W+B*B,J=Math.min(S,P)-G,he=Math.max(S,P)+G,re=Math.min(k,j)-G,de=Math.max(k,j)+G;if(he<r.x||J>r.x+r.width||de<r.y||re>r.y+r.width)continue;const ie=Math.abs(B)>1e-12,K=ie?G*Math.sqrt(F)/Math.abs(B):0;for(let Se=v(re,r.y);Se<=v(de,r.y);Se++){const Ie=r.y+(Se+.5)*s,ve=ie?S+W*(Ie-k)/B:0,we=ie?Math.max(J,ve-K):J,Pe=ie?Math.min(he,ve+K):he;if(!(we>Pe||Pe<r.x||we>r.x+r.width))for(let ze=v(we,r.x);ze<=v(Pe,r.x);ze++){const ue=r.x+(ze+.5)*s,Ue=F?Math.max(0,Math.min(1,((ue-S)*W+(Ie-k)*B)/F)):0,_e=Math.hypot(ue-S-W*Ue,Ie-k-B*Ue),me=C+(R+(U-R)*Ue-C)*(1+A*Math.sign((ue-S)*B-(Ie-k)*W));if(_e>=me)continue;const ye=Math.max(0,(_e-C)/(me-C)),Ne=1-ye*ye*(3-2*ye),ge=t.surfaceHeight[d]+(t.surfaceHeight[p]-t.surfaceHeight[d])*Ue,Ce=Se*n+ze;l[Ce]=Math.max(l[Ce],Math.max(0,r.height[Ce]-ge)*Ne)}}}for(const m of u){const{a:d,b:p,estuary:R}=i.segments[m],U=f[d*4],A=f[d*4+1],G=f[p*4],S=f[p*4+1],k=f[d*4+2],P=f[p*4+2],j=f[d*4+3],W=f[p*4+3],B=Math.max(Math.max(k,P)*.65,.5),F=G-U,J=S-A,he=F*F+J*J,re=Math.min(U,G)-B,de=Math.max(U,G)+B,ie=Math.min(A,S)-B,K=Math.max(A,S)+B;if(de<r.x||re>r.x+r.width||K<r.y||ie>r.y+r.width)continue;const Se=v(ie,r.y),Ie=v(K,r.y),ve=Math.abs(J)>1e-12,we=ve?B*Math.hypot(F,J)/Math.abs(J):0;for(let Pe=Se;Pe<=Ie;Pe++){const ze=r.y+(Pe+.5)*s,ue=ve?U+F*(ze-A)/J:0,Ue=ve?Math.max(re,ue-we):re,_e=ve?Math.min(de,ue+we):de;if(Ue>_e||_e<r.x||Ue>r.x+r.width)continue;const me=v(Ue,r.x),ye=v(_e,r.x);for(let Ne=me;Ne<=ye;Ne++){const ge=r.x+(Ne+.5)*s,Ce=Math.max(0,Math.min(1,((ge-U)*F+(ze-A)*J)/Math.max(he,.001))),Ae=k+(P-k)*Ce,Ge=j+(W-j)*Ce,Fe=Math.hypot(ge-U-F*Ce,ze-A-J*Ce),Ee=Math.max(0,1-Fe/Math.max(Ae*.65,.5))**2;if(!Ee)continue;const pe=Math.max(.35,Math.min(12,Ae*.11))*t.incision,er=Pe*n+Ne,fr=Math.max(0,Math.min(pe*2+.75,r.height[er]-(Ge-pe)))*Ee*(R>1&&Ge<pe?1.15:1);l[er]=Math.max(l[er],fr)}}}let b=1/0,h=-1/0;for(let m=0;m<n*n;m++)r.height[m]-=l[m],c&&(c[m]-=l[m]),b=Math.min(b,r.height[m]),h=Math.max(h,r.height[m]);if(c)for(let m=0;m<n;m++)for(let d=0;d<n;d++){const p=m*n+d,R=Math.max(0,d-1),U=Math.min(n-1,d+1),A=Math.max(0,m-1),G=Math.min(n-1,m+1),S=c[m*n+U]-c[m*n+R],k=c[G*n+d]-c[A*n+d];if(S===0&&k===0)continue;const P=Math.max(1e-6,r.normalZ[p]),j=-r.normalX[p]/P+S/((U-R)*s||s),W=-r.normalY[p]/P+k/((G-A)*s||s),B=Math.hypot(j,W,1);r.normalX[p]=-j/B,r.normalY[p]=-W/B,r.normalZ[p]=1/B}r.minHeight=b,r.maxHeight=h}const ft=new Float32Array(0);function tn(r,t){const a={...r,normalX:ft,normalY:ft,normalZ:ft};_n(a,t,!1),r.minHeight=a.minHeight,r.maxHeight=a.maxHeight}const Wr=r=>r.lakes==="none"||!(r.lakeAbundance>0&&r.lakeCoverage>0&&r.maxLakeArea>0),ra=(r,t)=>r.riverArea>0?r.riverArea:Math.max(.02,.003*(t/1e3)**2);class Mt{constructor(t,a,n,s,i,c){this.engine=t,this.baseHeight=a,this.backend=n,this.backendReason=s,this.drainageMs=i,this.gpu=c}static async create(t,a,n,s,i,c){const u=performance.now();let o,e,l;if(i!=="cpu")try{const v=await Qi(s,a,n,t,c);o=Rt.with_drainage(t,a,n,s,c,v.filled,v.receivers,v.accumulation),l=v}catch(v){e=`GPU hydrology unavailable: ${v instanceof Error?v.message:String(v)}`}const f=o?"gpu-f32":"cpu";return o??=new Rt(t,a,n,s,c),new Mt(o,s,f,e,performance.now()-u,l)}generate(t,a,n=0){const s=performance.now(),i=this.engine.generate(t.main,t.density,t.wetness,Wr(t)?"none":t.lakes,t.meanders,t.meanderIntensity,t.estuary,t.widthScale,t.incision,t.minLakeArea,t.lakeAbundance,t.lakeCoverage,t.maxLakeArea,t.depressionPolicy,t.maxBreachDepth,t.maxBreachLength,t.minLakeDepth,a.temperature,a.precipitation,t.coastalStreams,n);try{const c=i.stage_ms,u=i.stage_labels?Object.fromEntries(i.stage_labels.split(",").map((b,h)=>[b,c[h]])):void 0,o=i.basins;let e=0,l=0;for(const b of o)e=Math.max(e,b),b&&l++;const f=i.river_offsets,v=i.lake_meta,x=i.lake_closed;let M=0;for(let b=2;b<v.length;b+=6)M+=v[b];const z=i.river_meta;let C=!1;for(let b=4;b<z.length;b+=6)C||=(z[b]&2)!==0;return{width:i.width,resolution:i.resolution,receivers:i.receivers,accumulation:i.accumulation,basins:o,rawReceivers:i.raw_receivers??i.receivers,rawAccumulation:i.raw_accumulation??i.accumulation,rawBasins:i.raw_basins??o,flatLabels:i.flat_labels??new Uint32Array(o.length),flatRank:i.flat_rank??new Uint32Array(o.length),externalInflowArea:i.external_inflow_area??0,rawFilled:i.raw_filled??i.filled,rawDrainageHeight:i.raw_drainage_height??i.drainage_height,breachCount:i.breach_count??0,breachCutVolumeM3:i.breach_cut_volume_m3??0,avoidedFillVolumeM3:i.avoided_fill_volume_m3??0,filled:i.filled,lakeDepth:i.lake_depth,lakeLabels:i.lake_labels,baseHeight:this.baseHeight,drainageHeight:i.drainage_height,surfaceHeight:i.surface_height,adjustedHeight:i.adjusted_height,riverPoints:i.river_points,riverOffsets:f,riverMeta:z,riverFlare:i.river_flare,lakePoints:i.lake_points,lakeOffsets:i.lake_offsets,lakeMeta:v,lakeRingMeta:i.lake_ring_meta,lakeClosed:x,waterField:i.water_field,closedLakeCount:x.reduce((b,h)=>b+h,0),nodePoints:i.node_points,nodeMeta:i.node_meta,riverCount:f.length-1,lakeCount:v.length/6,basinCount:e,lakeFraction:M/Math.max(1,l*(i.width/i.resolution)**2),incision:t.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&t.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(t.main)&&!C?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-s,stageMs:u,generationMs:this.drainageMs+performance.now()-s,routingPotential:t.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{i.free()}}dispose(){this.engine.free()}}let nn="",Ir,wt="",ur,an="";function Mn(r,t){if(new URL(r).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const a=r+(t?.runtimeSha256??"")+(t?.runtimeJsSha256??"");return(nn!==a||!Ir)&&(nn=a,Ir=(async()=>{if(t){const{javascript:i,wasm:c}=await bi(r,t),u=URL.createObjectURL(new Blob([i],{type:"text/javascript"}));try{const o=await import(u);return await o.default({module_or_path:c}),o}finally{URL.revokeObjectURL(u)}}const s=await import(new URL("magna_urbis_neural_wasm.js",r).href);return await s.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",r)}),s})().catch(n=>{throw Ir=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Ir}async function Pt(){if(ur){try{(await ur).free()}catch{}ur=void 0,wt=""}}async function ta(r,t,a,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:s}=await wi(r),i=[s.runtimeSha256,...qt.map(o=>s.models[o].sha256)].join(":");(wt!==r+i||!ur)&&(await Pt(),wt=r+i,ur=(async()=>{const o=await Mn(r,s);an=i;const e=[];for(const l of qt){const f=s.models[l];n?.(`Neuronal WASM · ${l} · ${(f.bytes/1e6).toFixed(1)} Mo`),e.push(await xi(r,s,l,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),o.NeuralRelief.create(e[0],e[1],e[2])})().catch(o=>{throw ur=void 0,o}));const c=await ur;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await c.generate_json(JSON.stringify(Object.fromEntries(t)),a?JSON.stringify(a):"");try{const o=new Float32Array(u.heights),e=JSON.parse(u.meta),l=Number(t.get("extent")??4e4),f=Number(t.get("resolution")??Math.ceil(l/Number(t.get("sampleSpacing")??30))),v=e.resolution;if(e.extent!==l||e.nativeCellM!==30||e.nativeResolution!==Math.ceil(l/30)||typeof v!="number"||!Number.isInteger(v)||v!==f||o.length!==v*v||e.outputCellM!==l/v||o.some(x=>!Number.isFinite(x)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:o,meta:{...e,modelIdentity:an}}}finally{u.free()}}let on;async function Pn(r,t,a,n){on??=xt();const{seed:s,width:i,motifSize:c,relief:u,erosion:o,mountainMix:e,environment:l,zones:f,erosionTuning:v,sketch:x,source:M}=r,z=x?.processing,C=Qe(r),b={seed:s,width:i,motifSize:c,relief:u,erosion:o,mountainMix:e,environment:l,zones:f,erosionTuning:v,sampleSpacing:C.requestedSpacing,sourceN:C.n,coastProfile:Gr(r),coastMask:r.coastMask??0,islandMode:r.islandMode??"island",source:M,...z?{sketch:{processing:z},surface:Array.from($r(yr(x),C.n))}:{}},m=await(await Or(t,"/terrain",JSON.stringify({session:on,settings:b,region:a,field:n}))).arrayBuffer();if(m.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const d=new DataView(m).getUint32(0,!0);if(d%4||4+d>m.byteLength)throw new Error("En-tête terrain local invalide.");const p=JSON.parse(new TextDecoder().decode(new Uint8Array(m,4,d)));let R=4+d;const U={};for(const S of p.arrays){const k=S.count*(S.type==="f32"?4:1);if(!Number.isSafeInteger(S.count)||S.count<0||R+k>m.byteLength)throw new Error("Raster terrain local incomplet.");U[S.name]=S.type==="f32"?new Float32Array(m,R,S.count):new Uint8Array(m,R,S.count),R+=k}const A=U.height,G=p.resolution*p.resolution;if(!Number.isInteger(p.resolution)||p.resolution<64||p.resolution>1024||!A||A.length!==G||!A.every(Number.isFinite)||["normalX","normalY","normalZ"].some(S=>U[S]?.length!==G))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(p.fieldFloor)||!Number.isInteger(p.fieldN)||p.fieldN!==C.n||U.field?.length!==p.fieldN*p.fieldN||!U.field.every(Number.isFinite)||U.physical?.length!==p.fieldN*p.fieldN||!U.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:p.session,x:p.x,y:p.y,width:p.width,resolution:p.resolution,minHeight:p.minHeight,maxHeight:p.maxHeight,globalMinHeight:p.globalMinHeight,globalMaxHeight:p.globalMaxHeight,motifSize:p.motifSize,height:A,normalX:U.normalX,normalY:U.normalY,normalZ:U.normalZ,caveMask:U.caveMask,prepareMs:p.prepareMs,samplingMs:p.samplingMs,generationMs:p.prepareMs+p.samplingMs,generationBackend:"native",generationReason:p.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${p.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:p.erosionDefaults,...U.field?{field:{n:p.fieldN,data:U.field,exact:p.fieldExact,floor:p.fieldFloor,...U.physicalCave?{cave:U.physicalCave}:{}}}:{},...U.physical?{physical:{n:p.fieldN,height:U.physical}}:{},definition:C}}function na(r){if(r.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return Pn(r.settings,r.runtime,r.region,r.kind==="overview")}async function ia(r,t){const a=await Pn(r,t,{x:0,y:0,extent:r.width,resolution:64},!0);if(!a.field||a.field.data.length!==Qe(r).n**2)throw new Error("Surface physique native absente.");return{height:a.field.data,prepareMs:a.prepareMs??0,samplingMs:a.samplingMs??0,session:a.session,fieldExact:a.field.exact,erosionDefaults:a.erosionDefaults}}const aa="[relief_session_missing]",sn=r=>Array.from(r,t=>Number.isFinite(t)?t:null),oa=r=>new Uint8Array(r.buffer,r.byteOffset,r.byteLength);class cr{constructor(t,a){this.runtime=t,this.tuning=a,this.session=xt(),this.steps=[],this.released=!1}static async build(t,a,n,s){const i=new cr(t,s.slice());return await i.mutate({op:"build",...a},n),i}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,t=>t??NaN)}editSurface(t){return this.mutate({op:"edit"},t)}coast(t,a,n,s,i){return this.mutate({op:"coast",mask:t,mode:a,coastProfile:i,surface:!!s,...n?{tuning:sn(n)}:{}},s)}carveUnderdark(t,a){return this.mutate({op:"underdark",seed:t,...a})}async sampleRegion(t,a,n,s){const{meta:i,arrays:c}=await this.send({op:"read",region:{x:t,y:a,extent:n,resolution:s}}),u=i.region,o=c.height;if(!u||!o||o.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:o,cave_mask:c.caveMask,normal_x:c.normalX,normal_y:c.normalY,normal_z:c.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}async underdarkTunnels(){return(await this.send({op:"read",tunnels:!0})).arrays.tunnels??new Float32Array(0)}free(){this.released||(this.released=!0,this.steps.length=0,Or(this.runtime,"/release",JSON.stringify({session:this.session})).then(t=>t.arrayBuffer(),()=>{}))}async mutate(t,a){this.meta=(await this.send(t,a)).meta,this.steps.push({header:t,plane:a})}async send(t,a){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(t,a)}catch(n){if(t.op==="build"||!(n instanceof Error)||!n.message.includes(aa))throw n;for(const s of this.steps)await this.call(s.header,s.plane);return this.call(t,a)}}async call(t,a){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:sn(this.tuning),...t})),s=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);s.set(n);const i=new Uint8Array(4);new DataView(i.buffer).setUint32(0,s.length,!0);const u=await(await Or(this.runtime,"/terrain/relief",new Blob([i,s,...a?[oa(a)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const o=new DataView(u).getUint32(0,!0);if(o%4||4+o>u.byteLength)throw new Error("Native relief reply header invalid.");const e=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,o))),l={};let f=4+o;for(const{name:v,type:x,count:M}of e.arrays){const z=M*(x==="f32"?4:1);if(!Number.isSafeInteger(M)||M<0||f+z>u.byteLength)throw new Error("Native relief plane incomplete.");l[v]=x==="f32"?new Float32Array(u,f,M):new Uint8Array(u,f,M),f+=z}return{meta:e,arrays:l}}}const sa=["plateau","volcano","caldera"],Dr=r=>r==="neural-wasm"||r==="neural-python"||r==="neural",la="http://127.0.0.1:8792",ca="http://127.0.0.1:8793";function ua(r,t){const a=r==="neural-python"?ca:la,n=t?.trim().replace(/\/+$/,"");if(!n)return a;try{const s=new URL(n);if(s.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(s.hostname)&&["8792","8793"].includes(s.port)&&s.pathname==="/"&&!s.search&&!s.hash&&!s.username&&!s.password)return a}catch{}return n}const zn={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},fa={flat:20,hills:110,plateau:100},sr=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],Yr=r=>r.climateValues??$n[r.climate??"temperate"];function ln(r){const t=new Float32Array(r.height.length);let a=0,n=0;for(let c=0;c<r.height.length;c++)r.height[c]>0&&(t[n++]=r.height[c],a+=Math.acos(Math.min(1,r.normalZ[c])));const s=t.subarray(0,n).sort(),i=c=>n?s[Math.min(n-1,Math.floor(c*n))]:0;return{p5:i(.05),p50:i(.5),p95:i(.95),slope:a/Math.max(1,n),land:n/Math.max(1,r.height.length)}}let Kr,H,vr="",jr="",zr,nr="",Ur,mr,je,lr=!1,V;const Le=()=>V??H,Cr=()=>V?V.physicalHeightField():Promise.resolve(H.physical_height_field()),cn=async()=>{if(V)return V.underdarkTunnels().catch(()=>new Float32Array(0));const r=H?.underdark_tunnels;return r?r.call(H):new Float32Array(0)},dt=()=>V?V.samplingBaseField():Promise.resolve(H.sampling_base_field());let ar="",Xe,gr,fe,ir,qe="cpu",Te,un=Promise.resolve(),$e,Er="",Rr="",Oe,Ar,Vr="";async function Un(){if(!Vr)return;const r=Vr;Vr="";try{await fetch(`${r}/release`,{method:"POST"})}catch{}}let Nr,ee,Ze;const Br=new bt;async function da(r,t){const a=Qe(r),n=Math.ceil(r.width/30),s=(h,m)=>m.extent===r.width&&m.resolution===a.n&&m.nativeCellM===30&&m.nativeResolution===n&&m.outputCellM===r.width/a.n&&h.length===a.n*a.n&&h.every(Number.isFinite),i=ua(r.source,r.neuralServer),c=new URLSearchParams({seed:r.seed,relief:r.relief,mix:String(r.relief==="mixed"?r.mountainMix:.5),coasts:"0",islands:"island",climate:r.climate??"temperate",noise:String(r.fidelity??.05),extent:String(r.width),sampleSpacing:String(a.requestedSpacing),resolution:String(a.n)}),u=Yr(r),o=r.neuralTuning??zn;for(const[h,m]of Object.entries(u))c.set(h,String(m));c.set("landScale",String(o.landScale)),c.set("steps",String(o.steps)),c.set("detail",String(o.detail));for(const h of["coarseModel","baseModel","decoderModel"])r[h]&&c.set(h,r[h]);for(const h of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])c.set(h,String(o[h]));c.set("histogram",o.histogram.join(","));const e=fa[r.relief];o.reliefMode==="fixed"?c.set("reliefFixed",String(o.reliefFixed)):o.reliefMode==="auto"&&e!==void 0?c.set("reliefFixed",String(e)):c.set("reliefScale",String(o.reliefMode==="scale"?o.reliefScale:1));const l=si(r.width,r.width,r.neuralFit??"crop",r.neuralSlopes??!0),f=r.zones?{zones:yn(r.zones),region:{x:l.x,y:l.y,width:l.width}}:r.sketch?li(yr(r.sketch),l):void 0,v=performance.now();if(r.source==="neural-wasm"){if(await Un(),!r.neuralAssets)throw new Error("Neural browser runtime URL missing.");const h=await ta(r.neuralAssets,c,f,t);if(!s(h.heights,h.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:h.heights,info:{...h.meta,requestMs:performance.now()-v}}}await Pt();let x=f;if(r.source==="neural-python"){if(r.zones&&(await fetch(`${i}/status`,{cache:"no-store"}).then(p=>p.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!r.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const h=await Mn(r.neuralAssets),m=Object.fromEntries(c);x={params:m,conditioning:JSON.parse(h.conditioning_json(JSON.stringify(m),f?JSON.stringify(f):"")),edited:!!f},t?.("Neural Python · computing with PyTorch/CUDA")}const M={cache:"no-store",...x?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(x)}:{}};let z;if(r.source==="neural")z=await ci({profile:"local",server:i},`/generate?${c}`,M);else try{z=await fetch(`${i}/generate?${c}`,M)}catch{throw new Error(`Neural service unreachable (${i}): run “npm run neural:python” from web/`)}if(!z.ok)throw new Error(`Neural service: ${await z.text()}`);const C=new Float32Array(await z.arrayBuffer()),b=JSON.parse(z.headers.get("X-Neural-Meta")??"{}");if(r.source==="neural-python"&&(Vr=i),f&&(b.edited!==!0||b.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!s(C,b))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:C,info:{...b,requestMs:performance.now()-v}}}function pa(r){return Kr??=(async()=>{ni()?(r?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await ii(),r?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await ai(()=>oi(vi,t=>gi({module_or_path:t}),r))})()}dn(()=>{Br.clear(),Kr=void 0,H=void 0,V?.free(),V=void 0,vr="",ar="",lr=!1,$e=void 0,Oe=void 0,Er="",Rr="",Nr=void 0,ee=void 0,Ze=void 0});function ga(r,t,a,n){const s=un.then(()=>fn(r,t,a,n).catch(async i=>{if(!await Wn(i))throw i;return a?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),fn(r,t,a,n)}));return un=s.catch(()=>{}),s}async function fn(r,t,a,n){const{settings:s,region:i,kind:c,display:u,runtime:o}=r,e=s.islandMode?.startsWith("traced:")&&(s.sketch?.processing||s.relief==="cavern"||s.underdark)?{...s,islandMode:"island"}:s,l=Qe(e);if(Yn(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning}),e.climateZone==="wetland"&&(e.erosionTuning={carve:0,finalCarve:0,surfaceCarve:0,...e.erosionTuning});const f=e.compute==="wasm"?"wasm":"gpu-f32",v=e.generationCompute??"gpu-erosion";if(Vn(e,l.n))throw new Error(`GPU generation is limited to ${Jn}² cells; requested spacing ${l.spacing.toFixed(2)} m (${l.n}²). Choose CPU or native.`);const x=Ye(e.generalSeed??e.seed,"relief-coast-cut"),M=!!e.generalSeed&&mt(e.generalSeed,y=>y.startsWith("relief-"))!==vn(e.generalSeed),z=Xr(e),C=e.hydrology?.compute==="auto"&&(f==="wasm"||v==="cpu")?"cpu":e.hydrology?.compute??"auto";if(C!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&_t(),z&&!e.zones&&!e.sketch?.processing&&(!Kn.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const b=v==="native"&&!Dr(e.source);if(b&&o?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(b&&e.relief==="cavern")return na({...r,settings:e});const h=sa.includes(e.relief)?e.environment??"mixed":"mixed",m=e.sketch?.processing,d=ne(e,"coasts")?e.relief==="cavern"||e.underdark?0:e.coastMask??0:0,p=e.islandMode??"island",R=Gr(e),U=Ri.includes(e.relief),A=f!=="wasm"&&U?Ni(f,e.relief).catch(()=>{}):void 0;Kr&&a?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await pa(a)}catch(y){throw Kr=void 0,y}const G=performance.now();A&&a?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const S=A?await wr(A):void 0;n&&await n.after("prepare");const k=(y,w)=>{const Y=je;je={erosionSpacing:y===void 0?Y?.erosionSpacing:Math.max(Y?.erosionSpacing??0,y),regionalErosionSpacing:w===void 0?Y?.regionalErosionSpacing:Math.max(Y?.regionalErosionSpacing??0,w)},Object.assign(l,je)},P=async(y,w=!1,Y=!1)=>{let I=w&&ne(e,"phasor",!1)?ht(y,e):y;const X=Bt(e),oe=Tt(e),O=Jr(e);for(const E of["posterior","wind"]){const ae=JSON.stringify([O.get(E),o?.server,!!S,ki(new Uint8Array(I.buffer,I.byteOffset,I.byteLength))]),$=e.procedural?Br.get(E,ae):void 0;if($){I=$,n?.cached?await n.cached(E,n.previews===!1?void 0:I):(await n?.before(E),await n?.after(E,n.previews===!1?void 0:I));continue}if(await n?.before(E),E==="posterior"&&e.procedural&&ne(e,E)&&X.mode!=="none"){const D=I,Z=Math.sqrt(I.length);I=(await Ot(I,Z,e.width,X,{stats:!1},o)).height;for(let L=0;L<I.length;L++)I[L]=D[L]>0?Math.max(.3,I[L]):I[L]}E==="wind"&&e.procedural&&ne(e,E)&&oe.iterations&&oe.transport&&(I=S?await Ui(S.context,I,e.width,oe):zi(I,e.width,oe)),e.procedural&&l.n<=1024&&Br.put(E,ae,I),await n?.after(E,n.previews===!1?void 0:I)}return Y?I.map((E,ae)=>y[ae]<=0?y[ae]:Math.max(.3,E)):e.procedural&&I.some(E=>E<.3)?I.map(E=>Math.max(.3,E)):I};let j;const W=S?wr(S.pipeline).then(y=>({pipeline:y}),y=>{j=y instanceof Error?y.message:String(y)}):void 0,B=!b&&!e.zones&&!e.sketch&&v!=="cpu"&&f!=="wasm"&&!Dr(e.source)&&e.relief!=="cavern",F=B&&S?Di(S.context,e):void 0;if(F?.error&&e.generationCompute)throw new Error(F.error);const J=e.generationCompute||!F?void 0:F.error??(Xn(F)?`Source ${l.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),he=!!F&&!F.error&&!J,re=B&&Bi.includes(e.relief),de=re&&he,ie=(l.n!==1024||!!(e.procedural||n||M))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!Dr(e.source)&&(!de||v!=="gpu-erosion"),K=!m&&Dr(e.source);K||(await Pt(),await Un());const Se=o?.profile==="local"&&(b||K),Ie=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,it(e.modification.delta)]):"",ve={tunnels:e.underdarkTunnels,caverns:e.underdarkCaverns,lakes:e.hydrology&&Wr(e.hydrology)?0:e.hydrology?.lakeAbundance},we=JSON.stringify([e.zones,Ie,e.underdark?ve:null,x,b?[o.server,d,p,R]:null,Se?o.server:null])+"|"+JSON.stringify(K?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,Yr(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??zn,e.width,l.n,e.coarseModel,e.baseModel,e.decoderModel,e.neuralFit,e.neuralSlopes]:[e.seed,...e.generalSeed?[mt(e.generalSeed,y=>y.startsWith("relief-"))]:[],e.width,l.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,b?"native":z?[v,f,!!S]:re?v:"cpu",h,e.sketch,e.erosionTuning??{},...e.procedural?[Zn,R,e.procedural,e.climate,e.climateValues,e.climateZone,de?null:[d,p,R]]:[],...z||e.procedural?.enabled?.phasor?[nt,e.climate??"temperate",e.phasor??{}]:[]]);let Pe=0,ze=0,ue=0,Ue=0,_e=0,me;if(n&&n.previews!==!1||!(H||V)||vr!==we){fe?.dispose(),fe=void 0,ir=void 0,H?.free(),H=void 0,V?.free(),V=void 0,lr=!1,vr="",ar="",je=void 0;const y=performance.now();nr="",jr="",Ur=void 0,mr=void 0,zr=void 0,qe="cpu",Te=void 0;const w=e.relief==="mixed"?e.mountainMix:.5;Ar=void 0;const Y=Float64Array.from(sr,O=>{let E=z&&!e.procedural?NaN:e.procedural?.erosionTuning?.[O]??e.erosionTuning?.[O]??NaN;return e.procedural?.biome&&!de&&!ie&&(O==="incision"||O==="thermal")&&(E=(Number.isFinite(E)?E:1)*(O==="incision"?Mr(e).water:Mr(e).thermal)),E});if(Pr(Y),ie){a?.(J?`${J} Rust CPU generation at ${l.spacing.toFixed(2)} m…`:b?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const O=await P(await Mi(e,n,b?o:void 0,de&&S?()=>jt(S.context,e,a):void 0,(E,ae)=>{je={erosionSpacing:E,regionalErosionSpacing:ae},Object.assign(l,je)}));n&&await n.before("retain"),Se?V=await cr.build(o,{kind:"source",seed:x,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:w,environment:h},O,Y):H=ke.with_source(x,e.width,e.relief,e.erosion,e.motifSize,w,O,h),n&&await n.after("retain",n.previews===!1?void 0:O),qe=b?"native":de?v==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":z?"compact-cpu":"cpu",Te=J??`${b?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(b){a?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${l.n} × ${l.n} physical field`});const O=e.procedural?.biome?{...e,coastMask:d,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*Mr(e).water,thermal:(e.erosionTuning?.thermal??1)*Mr(e).thermal}}:{...e,coastMask:d},E=await ia(O.sketch&&!m?{...O,sketch:void 0}:O,o),ae=m!=="surface"&&e.procedural&&!e.zones?await P(E.height,!0,d!==0):void 0;V=await cr.build(o,{kind:"surface",seed:x,width:e.width},ae??E.height,Y),qe="native",Te="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",_e=E.prepareMs}else if(m){a?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const O=$r(yr(e.sketch),l.n);if(m==="erosion"){a?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),H=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,h,l.n),H.set_edited_surface(O);const E=H.sampling_base_field();H.free(),H=ke.with_surface(x,e.width,E)}else H=ke.with_surface(x,e.width,O);Te=m==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if(K){const O=await da(e,a),E=Qn(O.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);Se?V=await cr.build(o,e.zones?{kind:"zonedSurface",seed:x,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:x,width:e.width},E,Y):H=e.zones?ke.with_zoned_surface(x,e.width,e.motifSize,E,JSON.stringify(e.zones)):ke.with_surface(x,e.width,E),Ar=O.info,qe="neural",e.zones&&(Te="Zones → regional conditioning and local neural relief, then sea operation.")}else if(z&&!e.zones)if(S&&he){a?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const O={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:k},E=await P(await Xt(S.context,e,O,a));n&&await n.before("retain"),me=O.profiles,H=ke.with_source(x,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,w,E,h),n&&await n.after("retain",E),qe="compact-gpu-f32",Te=`${nt} · compact preset · ${e.procedural?.regionalN??Nt(e).n}² grid · ${e.climate??"temperate"} · Phasor ${ne(e,"phasor",!0)?"enabled":"disabled"}.`}else{a?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const O=e.procedural?.biome?Mr(e):void 0,E=O?{incision:O.water,thermal:O.thermal}:e.procedural?{incision:1,thermal:1}:ei(e),ae=e.procedural?.erosionTuning?.iterations??Nt(e).steps,$=e.erosionTuning??{},D={...$,iterations:ae,surfaceIterations:ne(e,"surface",!1)?$.surfaceIterations??12:0,detail:ne(e,"ridged",!1)?$.detail:0,warp:$.warp??0,incision:($.incision??1)*E.incision,thermal:($.thermal??1)*E.thermal};Pr(Float64Array.from(sr,L=>D[L]??NaN));let Z;try{Z=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,h,l.n);const L=Z.physical_height_field();H=ke.with_source(x,e.width,"hills",e.erosion,e.motifSize,w,ne(e,"phasor",!0)?ht(L,e):L,h)}finally{Z?.free(),Pr(new Float64Array(sr.length).fill(NaN))}qe="compact-cpu",Te=`${nt} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)a?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${l.n} × ${l.n} physical field`}),H=ke.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,h,JSON.stringify(yn(e.zones)),l.n),Te="Zone masks → uplift, noise, ridges and Rust erosion.";else if(de&&S)try{if(v==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const O={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:k},E=await P(await Xt(S.context,e,O,a));n&&await n.before("retain"),_e=O.nativeEnvironmentMs,me=O.profiles,Ue=performance.now()-y-_e,H=ke.with_source(x,e.width,e.relief,e.erosion,e.motifSize,w,E,h),n&&await n.after("retain",E),qe="gpu-erosion-f32"}else{const O=await jt(S.context,e,a);ze=performance.now()-y;const E=performance.now();a?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),H=ke.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,O.coarse,O.fine,h),ue=performance.now()-E,qe=v==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(O){if(n||e.procedural)throw O;Te=`GPU generation unavailable: ${O instanceof Error?O.message:String(O)}`}if(!H&&!V&&(a?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${l.n}² physical source at ${l.spacing.toFixed(2)} m`}),H=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,w,h,l.n),J&&(Te=J)),!m&&!K&&e.sketch&&e.relief!=="cavern"){const O=yr(e.sketch),E=await Cr(),ae=ri(O,E,l.n);V?await V.editSurface(ae):H.set_edited_surface(ae),Te="Edited sketch + procedural detail and Rust erosion."}const I=Bt(e),X=Tt(e),oe=ne(e,"posterior")&&I.mode!=="none"||ne(e,"wind")&&X.iterations>0&&X.transport>0;if(!ie&&e.procedural&&(oe||!z&&ne(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(qe)&&!K&&!m&&!b&&!e.zones){Ht(H,d,p,R);const O=H.physical_height_field(),E=await P(O,!z,d!==0);H.free(),H=ke.with_surface(x,e.width,E),lr=!0}e.modification&&(K||m)&&(zr=await dt()),Pe=performance.now()-y,vr=we}else if(a?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),je&&Object.assign(l,je),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const y of["grids",...kt(e),"phasor","posterior","wind"])await n.cached(y);const ye=JSON.stringify([we,x,d,p,R,Jr(e).get("coasts"),qe,o?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,it(e.sketch.heights)],e.zones&&[e.zones.resolution,it(e.zones.weights)]]),Ne=!!(e.procedural||K||m)&&!lr&&!(b&&!ie),ge=Ne&&d?Br.get("coasts",ye):void 0;!ge&&n&&await n.before("coasts");const Ce=!K&&!m&&!lr&&!F?.error&&!J&&!e.zones&&!e.sketch&&d!==0&&v!=="cpu"&&f!=="wasm",Ae=JSON.stringify([x,d,d?p:"island",R,d?Ce:!1,e.procedural?.coastIterations,e.procedural?.coastIncision,e.procedural?.coastThermal,e.procedural?.coastDiffusion,e.erosionTuning]);let Ge=0;if(zr&&nr&&nr!==we+"|"+Ae){if(fe?.dispose(),fe=void 0,ir=void 0,V){const y=V;V=await cr.build(o,{kind:"surface",seed:x,width:e.width},zr,new Float64Array(sr.length).fill(NaN)),y.free()}else H?.free(),H=ke.with_surface(x,e.width,zr);ar="",nr="",mr=void 0,Ur=void 0,jr=""}if(b&&!ie||lr)ar=Ae,Xe=lr&&d?"cpu":void 0,gr=void 0;else if(ar!==Ae){fe?.dispose(),fe=void 0,ir=void 0,Xe=void 0,gr=void 0;const y=performance.now();a?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const w=e.procedural,Y={...e.erosionTuning,...w?.erosionTuning},I=d?Float64Array.from(sr,X=>w&&X==="surfaceIterations"?w.coastIterations??(z?2:12):X==="surfaceIncision"?(Y[X]??1)*(w?.coastIncision??1):X==="surfaceThermal"?(Y[X]??1)*(w?.coastThermal??1):X==="surfaceDiffusion"?(Y[X]??1)*(w?.coastDiffusion??1):Y[X]??NaN):void 0;if(V?(await V.coast(d,p,ge?void 0:I,ge,R),d&&(Xe="native")):ge&&(It(H,d,p,R),H.set_coast_surface(ge),Xe="cpu"),!V&&!ge&&Ce&&S){let X;try{const oe=await W;if(!oe||S.context.lost)throw new Error(j??"WebGPU unavailable");It(H,d,p,R),X=new $t(S.context,oe.pipeline,f,H);const O=X.prepareCoastField(e),E=await ji(S.context,e,O,H.coast_erosion_parameters(),a);H.set_coast_surface(E),Xe="gpu-f32"}catch(oe){gr=`GPU coast unavailable: ${oe instanceof Error?oe.message:String(oe)}`}finally{X?.dispose()}}if(!V&&!Xe){I&&Pr(I);try{Ht(H,d,p,R)}finally{I&&Pr(Float64Array.from(sr,X=>Y[X]??NaN))}d&&(Xe="cpu"),Ce&&!S&&(gr="WebGPU unavailable")}ar=Ae,Ge=d?performance.now()-y:0,Pe+=Ge}const Fe=d&&Ne&&(!ge&&l.n<=1024||n&&n.previews!==!1&&!(ge&&n.cached))?await dt():void 0;if(Fe&&!ge&&l.n<=1024&&Br.put("coasts",ye,Fe),ge&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:ge):n&&await n.after("coasts",n.previews===!1?void 0:Fe),e.modification&&nr!==we+"|"+Ae){const y=Le().source_resolution(),w=m==="surface"&&!d?$r(yr(e.sketch),y):await Cr();if(Ur={n:y,height:w.slice()},mr=ti(w,y,e.modification),fe?.dispose(),fe=void 0,ir=void 0,V){const Y=V;V=await cr.build(o,{kind:"surface",seed:x,width:e.width},mr,new Float64Array(sr.length).fill(NaN)),Y.free()}else H?.free(),H=ke.with_surface(x,e.width,mr);nr=we+"|"+Ae}e.underdark&&jr!==we+"|"+Ae+"|"+nr&&(a?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),fe?.dispose(),fe=void 0,ir=void 0,V?await V.carveUnderdark(e.seed,ve):H.carve_underdark(e.seed,ve.tunnels,ve.caverns,ve.lakes),jr=we+"|"+Ae+"|"+nr);let Ee;const pe=async(y,w,Y)=>((Ee?.delta!==y||Ee.m!==w||Ee.n!==Y)&&(Ee={delta:y,m:w,n:Y,out:await mi(y,w,Y,o)}),Ee.out);async function er(y){je?Object.assign(l,je):l.erosionSpacing??=Le().erosion_spacing(),y.definition=l,n&&await n.after("sampling",y.height),n&&await n.before("hydrology");const w=ne(e,"hydrology")?e.hydrology:void 0;y.neural=Ar,c==="overview"&&!K&&e.relief!=="cavern"&&(y.erosionDefaults=Array.from(ui(e.relief,e.width,e.motifSize,e.mountainMix)));const Y=!!w?.enabled&&e.relief!=="cavern",I=w?.engine!=="rust",X=w?.erosionEnabled!==!1,oe=X&&w?.showErosion!==!1,O=X?w?.condMode:"none",E=I&&w&&!Wr(w)?[w.lakeAbundance,w.lakeArea,w.lakeDepth,w.lakeCoverage,w.maxLakeArea]:[0,0,0,0,0],ae=w&&{mode:w.condMode,strength:w.condStrength,maxDepth:w.condDepth,maxLength:w.condLength,banks:w.condBanks,lakes:E[0],lakeArea:E[1],lakeDepth:E[2],lakeCoverage:E[3],maxLakeArea:E[4],...e.climateZone==="wetland"?{undulation:2}:{}};if(t&&w&&Y&&c==="overview"&&u==="gl"){const $=Gt(I?w.vectorResolution:w.resolution,l.n),D=JSON.stringify([vr,ar,$,O,O==="none"?0:[w.condStrength,w.condDepth,w.condBanks,w.condLength,E]]);if(!ee||ee.key!==D||I&&!Ze){const Z=ln(y);t({...y,height:y.height.slice(),normalX:y.normalX.slice(),normalY:y.normalY.slice(),normalZ:y.normalZ.slice(),caveMask:y.caveMask.slice(),neural:Ar&&{...Ar,land:Z.land},field:await fr(y,!1,I),relief:Z,generationMs:performance.now()-G})}}if(w&&Y){const $=Gt(I?w.vectorResolution:w.resolution,l.n),D=JSON.stringify([vr,ar,$,O,O==="none"?0:[w.condStrength,w.condDepth,w.condBanks,w.condLength,E]]),Z=Yr(e),L={riverArea:w.density>0?ra(w,e.width)/Math.max(1,w.density)**2:1e9,density:Math.min(1,w.density),noLakes:Wr(w),headwaters:w.headwaters!==!1?1:0,minRiverLength:w.minRiverLength,lakeDepth:w.lakeDepth,lakeArea:w.lakeArea,riverMode:w.riverMode,flatSlope:w.flatSlope,sinuosity:w.sinuosity,widthScale:w.vectorWidth,balance:w.balance,braiding:w.braiding,anabranching:w.anabranching,terrainInfluence:w.terrainInfluence,avulsions:w.avulsions,confluence:w.confluence,deltas:w.deltas,...e.climateZone==="wetland"?{oxbows:.35}:{}},te=JSON.stringify([D,L,Z.temperature,Z.precipitation,Ye(e.generalSeed??e.seed,"water-hydrology")]);if(!ee||ee.key!==D){ee=void 0,Ze=void 0,$e?.dispose(),$e=void 0,Oe=void 0,Er="",Rr="";let se;if(y.x===0&&y.y===0&&y.width===e.width&&y.resolution===$)se=y.height.slice();else if(fe&&!fe.lost)se=(await fe.sample({x:0,y:0,extent:e.width,resolution:$},e,H.min_height,H.max_height)).height;else{const Q=V?await V.sampleRegion(0,0,e.width,$):H.sample_region(0,0,e.width,$);try{se=Q.height}finally{Q.free()}}if(O==="none")ee={key:D,n:$,height:se,m:0};else{a?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const Q=ae;if(I){const q=await Ft(se,$,e.width,Q,L,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),o),{height:xe,delta:Je,...le}=q.conditioning;ee={key:D,n:$,height:xe,source:se,delta:Je,m:$,stats:le},Ze={key:te,water:q.water}}else{const q=await Ot(se,$,e.width,Q,{stats:!1,drainage:!1},o),{height:xe,delta:Je,hydrology:le,...He}=q;ee={key:D,n:$,height:xe,source:se,delta:Je,m:$,stats:{...He,census:!1},drainage:le}}}}if(I){if(!Ze||Ze.key!==te)if(a?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),ee.source){const se=await Ft(ee.source,$,e.width,ae,L,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),o),{height:Q,delta:q,...xe}=se.conditioning;Object.assign(ee,{height:Q,delta:q,stats:xe}),Ze={key:te,water:se.water}}else Ze={key:te,water:await fi(ee.height,$,e.width,L,Z,Ye(e.generalSeed??e.seed,"water-hydrology"),ee.drainage,o)}}else{const se=JSON.stringify([D,C,Ye(e.generalSeed??e.seed,"water-hydrology")]),Q={...w,showErosion:!0,erosionEnabled:X,...X?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},q=`${se}|${JSON.stringify(Q)}`;if(K&&Nr?.key===q)y.hydrologyError=Nr.message;else try{(!$e||Er!==se)&&(a?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),$e?.dispose(),$e=void 0,Oe=void 0,Rr="",$e=await Mt.create(Ye(e.generalSeed??e.seed,"water-hydrology"),e.width,$,ee.height.slice(),C,d!==0||(m||K||e.sketch||e.zones?Le().min_height<=0:!1)),Er=se);const xe=Yr(e),Je=e.underdark||e.relief==="cavern"?0:e.width/Le().source_resolution(),le=JSON.stringify([Q,xe.temperature,xe.precipitation,Je]);(!Oe||Rr!==le)&&(a?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Oe=$e.generate(Q,xe,Je),Rr=le)}catch(xe){if(!K)throw xe;$e?.dispose(),$e=void 0,Oe=void 0,Er="",Nr={key:q,message:xe instanceof Error?xe.message:String(xe)},y.hydrologyError=Nr.message}}}if(a?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),Y&&oe&&ee?.delta&&!e.underdark&&await di(y,ee.delta,ee.m,e.width,o),Y&&oe&&!I&&Oe&&!y.hydrologyError){const $=performance.now();_n(y,Oe),y.hydrologySurfaceMs=performance.now()-$}if(c==="overview"){const $=Le().source_resolution(),D=e.underdark?await Cr():mr?.slice()??(m==="surface"&&!d?$r(yr(e.sketch),$):await Cr());if(Y&&oe&&ee?.delta&&!e.underdark){const Z=await pe(ee.delta,ee.m,$);for(let L=0;L<D.length;L++)D[L]+=D[L]<=0?Math.min(0,Z[L]):Z[L]}Y&&oe&&!I&&Oe&&!y.hydrologyError&&tn({x:0,y:0,width:e.width,resolution:$,height:D,minHeight:y.globalMinHeight,maxHeight:y.globalMaxHeight},Oe),y.physical={n:$,height:D},Ur&&(y.modificationBase=Ur)}return e.refine&&u!=="gl"&&pi(y,e.width/Le().source_resolution(),hi(e.seed),e.detailNoise),c==="overview"&&(u==="gl"||r.retainField)&&(a?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),y.field=await fr(y,Y,I)),c==="overview"&&Y&&(I?y.water=Ze?.water:Oe&&!y.hydrologyError&&(y.hydrology=Oe),ee?.delta&&ee.stats&&(y.conditioning={delta:ee.delta,n:ee.m,stats:ee.stats})),c==="overview"&&(y.relief=ln(y)),y.neural&&y.relief&&(y.neural={...y.neural,land:y.relief.land}),y.generationMs=performance.now()-G,n&&await n.after("hydrology",y.height),y}async function fr(y,w,Y){const I=Le().sampling_parameters()[5],X=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((I===1||I===4)&&e.relief!=="cavern"){const $=Le().source_resolution(),D=await dt();if(w&&X&&ee?.delta&&!e.underdark){const se=await pe(ee.delta,ee.m,$);for(let Q=0;Q<$*$;Q++)D[Q]+=D[Q]<=0?Math.min(0,se[Q]):se[Q]}const Z=w&&X&&!Y&&!y.hydrologyError?Oe:void 0;Z&&tn({x:0,y:0,width:e.width,resolution:$,height:D,minHeight:y.globalMinHeight,maxHeight:y.globalMaxHeight},Z);const L=e.underdark?V?await V.physicalCaveField():H.physical_cave_field():void 0,te=e.underdark?await cn():void 0;return{n:$,data:D,exact:!Z,floor:I===1?.3:0,cave:L?.length?L:void 0,...te?.length?{tunnels:te}:{}}}const oe=Le().source_resolution(),O=y.physical?.height.slice()??await Cr(),E=e.relief!=="cavern"&&!e.underdark?void 0:V?await V.physicalCaveField():H.physical_cave_field(),ae=e.underdark?await cn():void 0;return{n:oe,data:O,exact:!1,floor:0,cave:E?.length?E:void 0,...ae?.length?{tunnels:ae}:{}}}n&&await n.before("sampling",`Borne du moteur ${Le().max_height.toFixed(2)} m · aperçu ${i.resolution}²`);let De,rr=0,Ve;if(f!=="wasm"&&U&&!V&&!e.underdark){a?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const y=performance.now();try{const w=await W;S&&w&&!S.context.lost&&((!fe||ir!==f||fe.lost)&&(fe?.dispose(),fe=void 0,fe=new $t(S.context,w.pipeline,f,H),ir=f),rr=performance.now()-y,a?.(`GPU · sampling the terrain ${i.resolution} × ${i.resolution}…`,{stage:"terrain-sampling"}),Ve={...await fe.sample(i,e,H.min_height,H.max_height),generationMs:performance.now()-G,prepareMs:Pe,gpuSetupMs:rr,generationBackend:qe,generationReason:Te,noiseMs:ze,erosionMs:ue,gpuSimulationMs:Ue,nativeEnvironmentMs:_e,erosionProfile:me,coastBackend:Xe,coastMs:Ge,coastReason:gr}),Ve||(De=j?`GPU indisponible : ${j}`:"WebGPU indisponible")}catch(w){De=`GPU indisponible : ${w instanceof Error?w.message:String(w)}`,fe?.dispose(),fe=void 0,ir=void 0}}else V?De="Native Rust sampling on the local service.":f!=="wasm"&&(De="terrain currently sampled in WASM");if(Ve)return er(Ve);a?.(`${V?"Native Rust":"CPU"} · sampling the terrain ${i.resolution} × ${i.resolution}…`,{stage:"terrain-sampling"});const dr=performance.now(),Re=V?await V.sampleRegion(i.x,i.y,i.extent,i.resolution):H.sample_region(i.x,i.y,i.extent,i.resolution);try{return await er({x:Re.x,y:Re.y,width:Re.width,resolution:Re.resolution,minHeight:Re.min_height,maxHeight:Re.max_height,globalMinHeight:Le().min_height,globalMaxHeight:Le().max_height,motifSize:e.motifSize,height:Re.height,caveMask:Re.cave_mask,normalX:Re.normal_x,normalY:Re.normal_y,normalZ:Re.normal_z,generationMs:performance.now()-G,backend:V?"native":"wasm",backendReason:De,prepareMs:Pe,samplingMs:performance.now()-dr,gpuSetupMs:rr,generationBackend:qe,generationReason:Te,noiseMs:ze,erosionMs:ue,gpuSimulationMs:Ue,nativeEnvironmentMs:_e,erosionProfile:me,coastBackend:Xe,coastMs:Ge,coastReason:gr})}finally{Re.free()}}export{$n as CLIMATE_VALUES,la as DEFAULT_NEURAL_SERVER,zn as DEFAULT_NEURAL_TUNING,ca as DEFAULT_PYTHON_SERVER,sr as EROSION_SETTINGS,sa as GEOLOGICAL_RELIEFS,fa as NEURAL_RELIEF_DEFAULTS,Yr as climateOf,Dr as isNeuralSource,ua as neuralServerForSource,ln as reliefStatistics,ga as sampleRustTerrain};
