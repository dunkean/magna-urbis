import{T as _t,o as Fr,p as tr,q as tt,G as qr,t as mn,u as gn,w as vn,x as ne,y as Yn,z as Mt,A as Zr,s as Ve,B as Pt,C as yn,D as vt,E as Ir,F as Tt,H as yt,I as wn,J as Pr,K as Jn,L as ke,M as wt,N as xn,O as Lt,P as Vn,Q as Kn,S as Ot,U as Wr,V as xr,W as Xn,X as Zn,Y as Qn,Z as ei,_ as ri,$ as ti,a0 as lt,a1 as ni,a2 as ct,a3 as Rr,a4 as Nr,a5 as ii,a6 as Gt,a7 as ai,a8 as bn,a9 as oi,aa as Ft,ab as It,ac as si,ad as li,ae as ci,af as ui,ag as fi,ah as di,ai as pi,aj as qt,ak as hi,al as mi,am as gi,an as vi,ao as Ht,ap as Dt,aq as yi,ar as wi,as as xi,at as bi,au as ki,av as Si,aw as _i}from"./engine.worker-CnJBJUV6.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function $t(r,t,i,n){r.set_coast(t,i,JSON.stringify(n))}function jt(r,t,i,n){r.configure_coast(t,i,JSON.stringify(n))}function Mi(r,t,i,n){r.cut_coast(t,i,JSON.stringify(n))}function Pi(r,t,i,n,o,a,l,u,s,e,c,f){return r.cut_field(t,i,n,o,a,l,u,s,e,c,JSON.stringify(f))}let Ye;const ut=new Map;let xt=Promise.resolve();const bt=new _t;function Qr(r=!1){const t=Ye;Ye=void 0,bt.clear(),r||t?.pipeline?.free(),t?.runtime&&(xt=xt.then(async()=>{await Fr(t.runtime,"/terrain/stage",JSON.stringify({session:t.session,command:"cancel"})).catch(()=>{})}))}wn(()=>Qr(!0));async function zi(r,t,i,n,o){t?.backend?.(i?"native":"cpu");const a=tr(r),l=t?.previews!==!1&&a.n<=1024,u=tt(r),s=qr.erosion_at_resolution(r.seed,r.width,r.relief,r.erosion,r.motifSize,r.mountainMix,a.n),e=s.parameters();s.free();const{parameters:c,surface:f}=u?mn(e,r):{parameters:e,surface:e.slice(24,32)};gn(c,f,r,u),vn(f,r,a.n),u&&ne(r,"ridged",!1)&&r.erosionTuning?.detail===void 0&&r.procedural?.erosionTuning?.detail===void 0&&(c[16]=e[16]);const d=(_,U=!0)=>Number(ne(r,_,U)),y=Uint32Array.from([Number(u),d("regional"),d("regionalFinish"),d("amplitude"),d("ridged",!u),d("surface",!u||r.relief==="canyon"),d("normalize"),+(r.procedural?.regionalThermal!==!1),+(r.procedural?.regionalDiffusion!==!1),r.procedural?.reconstruction==="cubic"?1:r.procedural?.reconstruction==="bspline"?2:0,+(r.relief==="canyon")]);o?.(y[5]&&c[23]>0&&f[3]>0?f[1]:void 0,y[1]&&r.erosion>0?c[4]:void 0);const S=Yn([r.seed,r.width,a.n,c[2],i?.server??"wasm",!!n]);(a.n>1024||Ye?.root!==S)&&Qr();const k=Mt(r),z=Zr(r),x=k.map(_=>z.get(_));let p=0;for(;Ye&&p<x.length&&Ye.keys[p]===x[p];)p++;const g=async _=>{try{return await Fr(i,"/terrain/stage",JSON.stringify({session:Ye.session,..._}))}catch(U){throw["coast","restore","preview"].includes(_.command)&&U instanceof Error&&U.message.includes("Invalid terrain stage")?new Error("Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable."):U}},h=r.generalSeed?Object.fromEntries([["initialize","relief-noise"],["coastCut","relief-coast-cut"],["reconstruct","relief-reconstruct"],["ridged","relief-detail"]].map(([_,U])=>[_,Ve(r.generalSeed,U)])):void 0,m={parameters:Array.from(c),surface:Array.from(f),flags:Array.from(y),stepSeeds:h??{}},R=async _=>{const U=await g(_),$=await U.json();if(h&&Object.values(h).some(Y=>Y!==r.seed)&&!$.stepSeeds)throw new Error("Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.")};!Ye||p===0?(Qr(),i&&!ut.has(i.server)&&ut.set(i.server,Pt()),Ye={root:S,keys:[],runtime:i,...i?{session:ut.get(i.server)}:{}},await t?.before("grids",`Rust ${i?"natif":"WASM"} · régional ${c[2]}² · surface ${f[0]}² · source ${a.n}² à ${a.spacing.toFixed(2)} m`),i?(await xt,await R({command:"start",seed:r.seed,...m})):Ye.pipeline=new yn(r.seed,c,f,y),await t?.after("grids")):t?.cached?await t.cached("grids"):(await t?.before("grids"),await t?.after("grids"));const C=Ye;i||C.pipeline.set_step_seeds(JSON.stringify(h??{}));let A;for(let _=0;_<k.length;_++){const U=k[_],$=_<p;if(!$&&_===p&&_>0&&(i?await R({command:"restore",checkpoint:_-1,...m}):C.pipeline.restore(_-1,c,f,y),C.keys.length=_),$){(l||_===k.length-1)&&(A=i?new Float32Array(await(await g({command:"preview",checkpoint:_})).arrayBuffer()):C.pipeline.checkpoint_height(_)),t?.cached?await t.cached(U,l?A:void 0):(await t?.before(U),await t?.after(U,l?A:void 0));continue}await t?.before(U);const Y=U==="coastCut"&&vt(r,"coastCut");if(i){const F=await(await g({command:U==="coastCut"?"coast":"advance",stage:Tt.indexOf(U),checkpoint:_,mask:Y?r.coastMask:0,mode:r.islandMode??"island",coastProfile:Ir(r),preview:l||_===k.length-1})).arrayBuffer();F.byteLength&&(A=new Float32Array(F))}else{if(U==="initialize"&&n){const B=await n();C.pipeline.set_noise(B.coarse,B.fine)}U==="coastCut"?Y&&Mi(C.pipeline,r.coastMask,r.islandMode??"island",Ir(r)):C.pipeline.advance(Tt.indexOf(U)),C.pipeline.checkpoint(_),(l||_===k.length-1)&&(A=C.pipeline.height())}C.keys[_]=x[_],await t?.after(U,l?A:void 0)}const G=`${S}|${z.get("phasor")}`,M=a.n<=1024?bt.get("phasor",G):void 0;return M?(t?.cached?await t.cached("phasor",l?M:void 0):(await t?.before("phasor"),await t?.after("phasor",M)),M):(await t?.before("phasor"),ne(r,"phasor",u)&&(A=yt(A,r)),a.n<=1024&&bt.put("phasor",G,A),await t?.after("phasor",l?A:void 0),A)}const Ui=`
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
}`,Wt=new WeakMap;function Ci(r,t,i){if(!i.iterations||!i.transport)return r;const n=r.slice(),o=Math.sqrt(n.length),a=t/o,l=new Float32Array(n.length),u=i.azimuth*Math.PI/180,s=Math.cos(u),e=Math.sin(u),c=s>=0?1:-1,f=e>=0?1:-1,d=Math.abs(s)/(Math.abs(s)+Math.abs(e)),y=1-d;for(let S=0;S<i.iterations;S++){l.fill(0);for(let k=1;k<o-1;k++)for(let z=1;z<o-1;z++){const x=k*o+z;if(n[x]<=.3)continue;const p=((n[x+1]-n[x-1])*s+(n[x+o]-n[x-o])*e)/(2*a),g=.75+.25*Math.sin((z*s+k*e)*a/64+n[x]*.03);l[x]=Math.min(Math.max(0,n[x]-.3),i.transport*Math.max(.1,Math.min(1,.55+2*p))*g)}for(let k=0;k<o;k++)for(let z=0;z<o;z++){const x=k*o+z,p=k*o+Math.max(0,Math.min(o-1,z-c)),g=Math.max(0,Math.min(o-1,k-f))*o+z;n[x]=n[x]-l[x]+(p!==x?l[p]*d:0)+(g!==x?l[g]*y:0)}}return n}async function Ai(r,t,i,n){if(!n.iterations||!n.transport)return t;const o=r.device,a=Math.sqrt(t.length);let l=Wt.get(o);l||(l=(async()=>{const d=o.createShaderModule({code:Ui}),S=(await d.getCompilationInfo()).messages.filter(g=>g.type==="error");if(S.length)throw new Error(S.map(g=>`${g.lineNum}: ${g.message}`).join(`
`));const k=o.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),z=o.createPipelineLayout({bindGroupLayouts:[k]}),[x,p]=await Promise.all(["entrain","deposit"].map(g=>o.createComputePipelineAsync({layout:z,compute:{module:d,entryPoint:g}})));return{layout:k,a:x,b:p}})(),Wt.set(o,l));const{layout:u,a:s,b:e}=await l,c=[],f=(d,y)=>{const S=o.createBuffer({size:d,usage:y});return c.push(S),S};try{const d=f(t.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),y=f(t.byteLength,GPUBufferUsage.STORAGE),S=f(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),k=f(t.byteLength,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);o.queue.writeBuffer(d,0,t);const z=new ArrayBuffer(48),x=new Float32Array(z);new Uint32Array(z)[0]=a;const p=n.azimuth*Math.PI/180;x[1]=i/a,x[2]=Math.cos(p),x[3]=Math.sin(p),x[4]=n.transport,o.queue.writeBuffer(S,0,z);const g=o.createBindGroup({layout:u,entries:[d,y,S].map((M,_)=>({binding:_,resource:{buffer:M}}))}),h=Math.ceil(t.length/256),m=Math.ceil(h/o.limits.maxComputeWorkgroupsPerDimension),R=Math.ceil(h/m),C=o.createCommandEncoder(),A=C.beginComputePass();A.setBindGroup(0,g);for(let M=0;M<n.iterations;M++)A.setPipeline(s),A.dispatchWorkgroups(R,m),A.setPipeline(e),A.dispatchWorkgroups(R,m);A.end(),C.copyBufferToBuffer(d,0,k,0,t.byteLength),o.queue.submit([C.finish()]),await k.mapAsync(GPUMapMode.READ);const G=new Float32Array(k.getMappedRange()).slice();return k.unmap(),G}finally{c.forEach(d=>d.destroy())}}var Ei=`// FP32 sampling of the retained Rust erosion field.\r
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
  var limit=cliff*smooth01(metres/(1.0+0.6*cliff))+slope*metres*ease;\r
  if(!islet&&coast[0].x!=255.0){limit+=metres*metres/(260.0*clamp(1500.0/max(scale*width,1.0),1.0,6.0));}\r
  let low=min(ground,limit);let ratio=low/max(ground,limit);let square=ratio*ratio;\r
  return low/sqrt(sqrt(1.0+square*square));\r
}\r
`;let ft;const Bi=["flat","hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Ut(){return ft??=(async()=>{const r=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});if(!r)return;const{maxBufferSize:t,maxStorageBufferBindingSize:i}=r.limits,n=await r.requestDevice({requiredFeatures:r.features.has("timestamp-query")?["timestamp-query"]:[],requiredLimits:{maxBufferSize:t,maxStorageBufferBindingSize:i}}),o={device:n,pipelines:new Map,lost:!1};return n.lost.then(()=>{o.lost=!0,ft=void 0}),o})().catch(()=>{}),ft}async function Ti(r,t){if(r==="wasm")return;const i=await Ut();if(!i||i.lost)return;const n=t==="flat"?0:t==="valley"?2:t==="volcano"||t==="caldera"||t==="plateau"?3:1,o=`${r}:${n}`;let a=i.pipelines.get(o);return a||(a=(async()=>{const l=Ei.replace("// NOISE_KERNEL",zt).replace("// VOLCANIC_KERNEL",kn).replace("// COAST_KERNEL",Ni),u=i.device.createShaderModule({code:l});return i.device.createComputePipelineAsync({layout:"auto",compute:{module:u,entryPoint:"main",constants:{FAMILY:n}}})})(),a.catch(()=>{}),i.pipelines.set(o,a)),{context:i,pipeline:a}}const Li=["hills","mountains","mixed","high-mountains","valley","volcano","caldera","plateau","canyon"];async function Yt(r,t,i){const n=r.device,o=tr(t).n,a=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),l=t.generationCompute==="gpu-all"?["coarse","fine"]:["fine"],u=l.map(c=>{const f=`generation:${c}`;let d=r.pipelines.get(f);if(!d){const y=n.createShaderModule({code:Ri.replace("// NOISE_KERNEL",zt)});d=n.createComputePipelineAsync({layout:n.createPipelineLayout({bindGroupLayouts:[a]}),compute:{module:y,entryPoint:c}}),r.pipelines.set(f,d)}return d}),s=qr.generation_at_resolution(t.seed,t.width,t.relief,t.motifSize,o),e=[];try{const c=s.parameters();t.procedural?.regionalN&&(c[2]=t.procedural.regionalN,c[4]=t.width*1.44/c[2]),c[6]*=t.procedural?.noiseScale??1;const f=(p,g)=>{const h=n.createBuffer({size:p.byteLength,usage:g|GPUBufferUsage.COPY_DST});return e.push(h),n.queue.writeBuffer(h,0,p),h},d=[f(c,GPUBufferUsage.UNIFORM),f(s.permutations(),GPUBufferUsage.STORAGE),f(s.gradients(),GPUBufferUsage.STORAGE)];i?.("GPU · compilation des shaders de bruit…",{stage:"gpu-noise-compile"});const y=await Pr(Promise.all(u));i?.("GPU · calcul des bruits du relief…",{stage:"gpu-noise"});const k=l.map(p=>p==="coarse"?c[2]:c[1]).map((p,g)=>{const h=p*p*16,m=n.createBuffer({size:h,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),R=n.createBuffer({size:h,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});e.push(m,R);const C=n.createBindGroup({layout:y[g].getBindGroupLayout(0),entries:[...d,m].map((M,_)=>({binding:_,resource:{buffer:M}}))}),A=n.createCommandEncoder(),G=A.beginComputePass();return G.setPipeline(y[g]),G.setBindGroup(0,C),G.dispatchWorkgroups(Math.ceil(p/8),Math.ceil(p/8)),G.end(),A.copyBufferToBuffer(m,0,R,0,h),n.queue.submit([A.finish()]),R}),z=n.queue.onSubmittedWorkDone().then(()=>i?.("GPU · lecture des bruits calculés…",{stage:"gpu-readback"}),()=>{}),x=await Promise.all(k.map(async p=>{await p.mapAsync(GPUMapMode.READ);const g=new Float32Array(p.getMappedRange().slice(0));return p.unmap(),g}));return await z,{coarse:l.length===2?x[0]:new Float32Array,fine:x[x.length-1]}}finally{s.free(),e.forEach(c=>c.destroy())}}class Jt{constructor(t,i,n,o){this.state=t,this.pipeline=i,this.mode=n,this.buffers=[],this.capacity=0,this.parameters=o.sampling_parameters(),this.sourceN=o.source_resolution();let a=0;for(let e=this.sourceN;e>=1;e=Math.floor(e/2))a+=e*e;const l=this.parameters[5]===3?2:1;if(a*l*4>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);const u=o.sampling_field();this.hasField=u.length>0;const s=u.length?u:new Float32Array(1);if(s.byteLength>t.device.limits.maxStorageBufferBindingSize)throw new Error(`Champ physique ${this.sourceN}² trop grand pour l'échantillonnage GPU ; utilisez le calcul CPU.`);this.field=this.upload(s),this.perm=this.upload(o.sampling_permutations()),this.gradients=this.upload(o.sampling_gradients()),this.branches=this.upload(o.sampling_branches()),this.coast=this.upload(o.coast_parameters()),this.uniform=this.upload(new Float32Array(36),GPUBufferUsage.UNIFORM)}get lost(){return this.state.lost}upload(t,i=GPUBufferUsage.STORAGE){const n=this.state.device.createBuffer({size:Math.max(4,t.byteLength),usage:i|GPUBufferUsage.COPY_DST});return this.buffers.push(n),this.state.device.queue.writeBuffer(n,0,t),n}prepareCoastField(t){return this.dispatchField({x:0,y:0,extent:t.width,resolution:this.sourceN},t),this.output}dispatchField(t,i){const{x:n,y:o,extent:a,resolution:l}=t;if(![n,o,a,l].every(Number.isFinite)||n<0||o<0||a<=0||n+a>i.width+1e-4||o+a>i.width+1e-4||!Number.isInteger(l)||l<16||l>8192)throw new Error("Région d’échantillonnage invalide.");const u=this.state.device,s=a/l,e=Math.max(i.motifSize/65536,s*.5),c=this.parameters,f=Math.floor(Math.log2(this.sourceN)),d=Math.min(f,Math.log2(Math.max(1,s*(i.relief==="flat"&&c[5]!==4?2/i.motifSize:1/i.width)*this.sourceN))),y=new Float32Array([c[0],c[1],c[2],c[3],c[4],c[5],this.hasField?1:0,l,n,o,a,s,Math.floor(d),Math.min(f,Math.floor(d)+1),d-Math.floor(d),e,c[6],c[7],this.sourceN,f,...Array.from({length:16},(x,p)=>c[8+p]??0)]),S=l*l*16;S>this.capacity&&(this.output?.destroy(),this.capacity=S,this.output=u.createBuffer({size:S,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.group=u.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[this.uniform,this.field,this.perm,this.gradients,this.output,this.branches,this.coast].map((x,p)=>({binding:p,resource:{buffer:x}}))})),u.queue.writeBuffer(this.uniform,0,y);const k=u.createCommandEncoder(),z=k.beginComputePass();z.setPipeline(this.pipeline),z.setBindGroup(0,this.group),z.dispatchWorkgroups(Math.ceil(l/8),Math.ceil(l/8)),z.end(),u.queue.submit([k.finish()])}async sample(t,i,n,o){const a=performance.now(),l=this.state.device,{x:u,y:s,extent:e,resolution:c}=t;this.dispatchField(t,i);const f=c*c*16,d=l.createCommandEncoder();(!this.readback||this.readback.size<f)&&(this.readback?.destroy(),this.readback=l.createBuffer({size:f,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})),d.copyBufferToBuffer(this.output,0,this.readback,0,f),l.queue.submit([d.finish()]),await this.readback.mapAsync(GPUMapMode.READ,0,f);const y=this.readback.getMappedRange(0,f).slice(0);this.readback.unmap();const S=new Float32Array(y),k=new Float32Array(c*c),z=new Float32Array(c*c),x=new Float32Array(c*c),p=new Float32Array(c*c);let g=1/0,h=-1/0;for(let m=0;m<c*c;m++){const R=m*4;k[m]=S[R],z[m]=S[R+1],x[m]=S[R+2],p[m]=S[R+3],g=Math.min(g,k[m]),h=Math.max(h,k[m])}if(!Number.isFinite(g)||!Number.isFinite(h))throw new Error("Sortie GPU non finie.");return{x:u,y:s,width:e,resolution:c,minHeight:g,maxHeight:h,globalMinHeight:n,globalMaxHeight:o,motifSize:i.motifSize,height:k,normalX:z,normalY:x,normalZ:p,caveMask:new Uint8Array,generationMs:performance.now()-a,backend:this.mode,samplingMs:performance.now()-a}}dispose(){this.buffers.forEach(t=>t.destroy()),this.buffers=[],this.output?.destroy(),this.readback?.destroy()}}var Oi=`// Positive cubic B-spline: no overshoot across coarse drainage steps.\r
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
`;const br=new WeakMap,Yr=new WeakMap,et=new Set;function Or(r){r.nodes?.destroy(),r.fine?.destroy(),r.control.destroy()}function Ii(){for(const r of et)br.get(r)?.forEach(Or),br.delete(r),Yr.delete(r);et.clear()}const Vt=new WeakMap,dt=new WeakMap,Kt=new WeakMap,Xt=new WeakMap,Sn=new WeakSet,qi=512*1048576,Zt=1024,Hi=1088,pt=Hi+4096;function _n(r,t){const i=(Kt.get(r.device)??Promise.resolve()).then(t);return Kt.set(r.device,i.then(()=>{},()=>{})),i}async function Di(r,t,i,n){let o=Vt.get(r);o||(o=(async()=>{const e=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:224}},...[1,2].map(S=>({binding:S,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5,6,7].map(S=>({binding:S,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),c=r.createShaderModule({code:Fi.replace("// NOISE_KERNEL",zt).replace("// VOLCANIC_KERNEL",kn)+Oi+Gi}),d=(await Pr(c.getCompilationInfo())).messages.filter(S=>S.type==="error");if(d.length)throw new Error(d.map(S=>`${S.lineNum}: ${S.message}`).join(`
`));const y=r.createPipelineLayout({bindGroupLayouts:[e]});return{layout:e,module:c,pipelineLayout:y,values:new Map,pending:new Map}})(),Vt.set(r,o)),n?.("GPU · préparation des shaders d’érosion…",{stage:"gpu-erosion-compile"});const a=await Pr(o),l=[],u=[...t].reduce((e,c)=>e+(c==="solveTile"?i.size:1),0);let s=0;for(const e of t)for(const c of e==="solveTile"?i:[void 0]){const f=c===void 0?e:`solveTile:${c}`;let d=a.pending.get(f);d||(d=r.createComputePipelineAsync({layout:a.pipelineLayout,compute:{module:a.module,entryPoint:e,...c===void 0?{}:{constants:{SOLVE_MODE:c}}}}),d=d.then(y=>(a.values.set(f,y),y)),a.pending.set(f,d)),l.push(d.then(y=>(s++,n?.(`GPU · shaders d’érosion prêts ${s}/${u}`,{stage:"gpu-erosion-compile",completed:s,total:u}),y)))}return await Pr(Promise.all(l)),Sn.add(r),a}class Gr extends Error{}class $i extends Error{}function Mn(r,t,i,n,o){const a=qr.erosion_at_resolution(r.seed,r.width,i,r.erosion,r.motifSize,r.mountainMix,t);try{const l=a.parameters(),u=n?mn(l,r,o):{parameters:l,surface:(o??l.slice(24,32)).slice()};return gn(u.parameters,u.surface,r,n,!!o),vn(u.surface,r,t),{noise:a,parameters:u.parameters,surface:u.surface,original:l}}catch(l){throw a.free(),l}}const ji=["hills","mountains","mixed","high-mountains","valley","canyon"];function Wi(r,t){const i=tr(t).n,n=tt(t),o=ji.includes(t.relief)?t.relief:t.relief==="flat"?"hills":"mixed",{noise:a,parameters:l,surface:u}=Mn(t,i,o,n);a.free();const s=l[2],e=u[0],c=u[3],f=Jn(r.device.limits,i,Math.max(s,t.erosion>0&&(!n||c>0)?e:0));return{sourceN:i,regionalN:s,regionalSteps:l[13],surfaceN:e,surfaceSteps:c,pipelinesReady:Sn.has(r.device),error:f}}async function Yi(r,t,i,n,o){return _n(r,()=>Ji(r,t,i,n,o))}async function Ji(r,t,i,n,o){const a=tr(t).n;for(const l of[1,2,4,8,16])try{return await Pn(r,t,a,l,void 0,{source:i,tuning:n},void 0,o)}catch(u){if(!(u instanceof Gr)||l===16)throw u}throw new Error("Érosion littorale GPU non convergée.")}async function Qt(r,t,i,n){return i?.control?.backend?.("gpu"),_n(r,()=>Vi(r,t,i,n))}async function Vi(r,t,i,n){const o=tr(t).n;if(t.relief==="volcano"||t.relief==="caldera"||t.relief==="plateau"){const a=qr.finite_shape(t.seed,t.motifSize,t.relief,t.erosion),l=a.parameters();a.free();const u=t.environment??"mixed",s=t.motifSize*l[15];let e;if(u==="flat"){const d=performance.now();n?.("CPU · préparation du relief environnant…",{stage:"terrain-environment"}),e=ke.prepare_environment_at_resolution(t.seed,t.width,u,t.erosion,s,o),i&&(i.nativeEnvironmentMs=performance.now()-d)}else e=await ht(r,{...t,motifSize:s,relief:u,mountainMix:.5},o,void 0,i,n);const c=await ht(r,{...t,width:t.motifSize},o,l,i,n),f=new Float32Array(c.length+e.length);return f.set(c),f.set(e,c.length),f}return ht(r,t,o,void 0,i,n)}async function ht(r,t,i,n,o,a){for(const l of[1,2,4,8,16])try{return await Pn(r,t,i,l,n,void 0,o,a)}catch(u){if(!(u instanceof Gr)||l===16)throw u}throw new Error("Érosion GPU non convergée.")}async function Pn(r,t,i,n,o,a,l,u){const s=r.device,e=a?void 0:l?.control,c=tt(t),f=!!t.generalSeed&&wt(t.generalSeed,h=>h.startsWith("relief-"))!==xn(t.generalSeed),{noise:d,parameters:y,surface:S,original:k}=Mn(t,i,a||c&&t.relief==="flat"?"hills":o?"mixed":t.relief,c,a?.tuning);let z=dt.get(s);if(!z){z=[],dt.set(s,z);const h=z;s.lost.then(()=>h.forEach(m=>m.destroy()))}const x=!!e&&e.previews!==!1&&i<=Zt;let p=!!e&&e.previews!==!1,g=0;try{c&&t.procedural&&ne(t,"ridged",!1)&&t.erosionTuning?.detail===void 0&&t.procedural.erosionTuning?.detail===void 0&&(y[16]=k[16]);const h=y.slice(0,24),m=h[2],R=h[13],C=h[18],A=a?[1,0,0,.2,1,1,0,0]:Array.from(y.slice(33,41)),G=A.slice();G[4]=1;const M=!a&&A[6]>.5,_=Math.min(n,4),U=h.slice();U[2]=S[0],U[4]=S[1],U[5]=S[2],U[15]=o&&!a?o[13]:S[4],U[18]=S[5],U[22]=S[6];const $=Math.max(1,U[2]/1048),Y=Math.ceil(Math.min((o||a||t.relief==="mixed"?64:32)*n,512)*$),B=!a&&ne(t,"phasor",c)?"generationPhasorPack":"packHeight",F=c?"compactInitialize":"initialize",V=!!a||ne(t,"surface",!c||t.relief==="canyon")&&(!c||t.relief==="canyon"||S[3]>0),he=()=>{a||l?.onPhysicalPlan?.(t.erosion>0&&V&&S[3]>0?S[1]:void 0,!o&&t.erosion>0&&(ne(t,"regional")||ne(t,"regionalFinish"))?h[4]:void 0)},re=t.procedural?.reconstruction&&t.procedural.reconstruction!=="default"?"generationReconstruct":c?"compactReconstruct":"reconstruct",de=new Set([B,...ne(t,"amplitude")?[]:["generationUnitScale"],...ne(t,"normalize")?[]:["generationKeepDatum"],...e?["generationPreview"]:[],...!a&&!o&&t.procedural?["generationCut","generationRegionalRead","generationPreview"]:[]]),ie=new Set,K=(...v)=>v.forEach(P=>de.add(P));f&&!a&&!o&&K("generationCut","generationRegionalRead","generationPreview"),(a||!o&&(f||t.procedural))&&K("seaLandMark","seaMaskGrow");const Se=()=>K("start","clearNext","solveStats","solveTile","receivers","flow","graphInit","graphFinish","thermalFlux","thermalApply","copyHeight","diffuse");a?K("coastLoad","coastResult"):K("percentileInit","histogramClear","histogram","percentileSelect","normalize"),!a&&!o?(K(F,"uplift","bounds",re,"detail"),C>0&&(Se(),K("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","pitFill","breachInit","breach","breachFinish"),[0,1,2].forEach(v=>ie.add(v)))):o&&!a&&K("volcanicInitial"),t.erosion>0&&V&&(Se(),K("surfaceLoad","surfaceFlowInit","surfaceDelta","surfaceReconstruct"),ie.add(1),ie.add(3),t.relief==="canyon"&&!a&&(K("floodInit","floodCheck","canyonSeed","canyonSpread","canyonApply"),ie.add(0)),M&&(K("floodInit","floodCheck","pitInit","pitUnion","pitCompress","pitReduce","pitPour","breachInit","breach","breachFinish"),ie.add(0))),e&&await e.before("grids",`Budget ×${n} · régional ${m}² · surface ${U[2]}² · sortie ${i}²`);const je=performance.now(),ve=await Di(s,de,ie,u),we=performance.now()-je,Pe=performance.now();u?.("GPU · préparation des buffers d’érosion…",{stage:"gpu-erosion-buffers"});let ze=!1;const fe=(v,P)=>{const N=g++;let T=z[N];return(!T||T.size<v||T.usage!==P)&&(T?.destroy(),T=s.createBuffer({size:v,usage:P}),z[N]=T,ze=!0),T},Ue=v=>{const P=fe(v.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);return s.queue.writeBuffer(P,0,v),P},_e=t.erosion>0&&V?Math.max(m,U[2]):m,me=i**2,ye=me*4,Be=me*16,ge=Math.max(me,m*m)*4;s.pushErrorScope("out-of-memory");const Ce=fe(65536,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),Ae=fe(_e**2*112,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Oe=fe(Be,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ge=fe(pt,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),Ee=fe(ge,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),pe=fe(ge+1088,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),nr=fe(Math.ceil(_e/16)**2*8,GPUBufferUsage.STORAGE),pr=s.popErrorScope();if(ze&&await pr)throw p=!0,new $i(`WebGPU : mémoire insuffisante pour la source ${i}² et la grille d’érosion ${_e}².`);p||=z.reduce((v,P)=>v+P.size,0)>qi;const We=v=>pe.mapAsync(GPUMapMode.READ,0,v),ir=v=>pe.getMappedRange(0,v),Ke=!a&&!o&&!!(t.procedural||f),hr=Ke&&i<=Zt,Re=x||Ke;let w=Re?void 0:Xt.get(s);if(!Re&&!w&&s.features.has("timestamp-query")){w=s.createQuerySet({type:"timestamp",count:6}),Xt.set(s,w);const v=w;s.lost.then(()=>v.destroy())}const b=w?fe(48,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):void 0,J=w?fe(48,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ):void 0,H=(v,P)=>s.createBindGroup({layout:ve.layout,entries:[{binding:0,resource:{buffer:Ce,size:224}},...[Ue(v),Ue(P),Ae,Oe,Ge,Ee,nr].map((N,T)=>({binding:T+1,resource:{buffer:N}}))]});let X=H(d.permutations(),d.gradients());const oe=new Map([[t.seed,X]]),L=v=>{const P={initialize:"relief-noise",reconstruct:"relief-reconstruct",ridged:"relief-detail"}[v];if(!P||!t.generalSeed)return;const N=Ve(t.generalSeed,P);let T=oe.get(N);if(!T){const ue=qr.erosion(N,t.width,t.relief,t.erosion,t.motifSize,t.mountainMix);try{T=H(ue.permutations(),ue.gradients())}finally{ue.free()}oe.set(N,T)}X=T},E=new Map;let ae=A;const W=(v,P)=>{const N=[...P,...v,...ae].join(",");let T=E.get(N);if(T===void 0){if(T=E.size*256,T+224>65536)throw new Error("Too many GPU variants.");E.set(N,T),s.queue.writeBuffer(Ce,T,new Float32Array([...P,...v,...c?Lt(t,!!a):!o&&!a&&ne(t,"phasor",!1)?Lt(t):o??new Float32Array(16),...ae]))}return T};let D=s.createCommandEncoder();D.clearBuffer(Ge),a&&D.copyBufferToBuffer(a.source,0,Oe,0,Be);const Z=v=>D.beginComputePass(w?{timestampWrites:{querySet:w,beginningOfPassWriteIndex:v,endOfPassWriteIndex:v+1}}:void 0);let I=Z(0);const te=[0,0,1,0,0,0,.6,0];te[4]=y[32];const le=[0,0,.95,C*.5,0,0,.5,0];let Q=h;const q=(v,P=te,N=Math.ceil(Q[2]**2/256),T=1)=>{I.setPipeline(ve.values.get(v==="solveTile"?`solveTile:${P[1]}`:v)),I.setBindGroup(0,X,[W(P,Q)]),I.dispatchWorkgroups(N,T)},xe=Math.ceil(me/256),Xe=Math.ceil(xe/s.limits.maxComputeWorkgroupsPerDimension),ce=(v,P=te)=>q(v,P,Math.ceil(xe/Xe),Xe),He=(v,P,N=!1)=>{const T=te.slice();T[1]=v,T[7]=N?1:0,q(v===0?"floodInit":"graphInit",T),q("start",T,1);const ue=[0,1].map(be=>(T[0]=be,W(T,Q)));for(let be=0;be<P;be++){const lr=[ue[be&1]];I.setPipeline(ve.values.get("clearNext")),I.setBindGroup(0,X,lr),I.dispatchWorkgroups(1),I.setPipeline(ve.values.get(`solveTile:${v}`)),I.dispatchWorkgroups(Math.ceil(Q[2]/16),Math.ceil(Q[2]/16))}T[0]=0,q("solveStats",T,1),v===0?(q("floodCheck",T,1),q("receivers")):q("graphFinish",T)},nt=(v=te,P=!0)=>{q("pitInit");for(let N=0;N<8*_+Math.ceil(Math.log2(Math.max(1,Q[2]/1048)));N++)q("pitUnion"),q("pitCompress");for(const N of P?["pitReduce","pitPour","pitFill"]:["pitReduce","pitPour"])q(N,v)},it=v=>{if(v<=0)return;const P=te.slice();P[6]=v,q("breachInit"),q("breach",P),q("breachFinish")},at=(v,P=te)=>{if(!(Q===h&&t.procedural?.regionalThermal===!1))for(let N=0;N<v;N++)for(const T of["thermalFlux","thermalApply","copyHeight"])q(T,P)},Hr=(v,P=te)=>{if(Q===h&&t.procedural?.regionalDiffusion===!1)return;const N=P.slice();N[3]=v,q("diffuse",N),q("copyHeight",N)},Et=v=>{const P=Vn(Kn({surfaceSteps:S[3],surfaceCell:S[1],regionalCell:h[4],sourceCell:h[11],warp:A[5]*Math.min(16*h[3],h[4]*.9)}),t.width);if(P===void 0)return;const N=te.slice();N[7]=v,v===0?q("seaLandMark",N):ce("seaLandMark",N),N[5]=P,q("seaMaskGrow",N,2)},Rt=v=>{const P=te.slice();P[4]=v,q("percentileInit",P,1);for(const N of[24,16,8,0])P[5]=N,q("histogramClear",P,1),ce("histogram",P),q("percentileSelect",P,1)},Nt=async(v,P,N)=>{if(!e)return;if(!x){await e.after(v,void 0,N);return}if(P!==3){const lr=te.slice();lr[7]=P,ce("generationPreview",lr)}I.end(),D.copyBufferToBuffer(Ee,0,pe,0,ye),D.copyBufferToBuffer(Ge,0,pe,ye,1088),s.queue.submit([D.finish()]),await We(ye+1088);const T=ir(ye+1088),ue=new Uint32Array(T,ye,272)[2],be=new Float32Array(T,0,me).slice();if(pe.unmap(),ue)throw new Gr("Érosion GPU non convergée pendant une étape.");if(!be.every(Number.isFinite))throw new Error("Champ GPU intermédiaire invalide.");await e.after(v,be,N),D=s.createCommandEncoder(),I=Z(0)},mr=Mt(t),Bn=Zr(t);let Te=hr?br.get(s):void 0;if(hr&&!Te){Te=new Map,br.set(s,Te),et.add(s);const v=Te;s.lost.then(()=>{v.forEach(Or),v.clear(),et.delete(s)})}const zr=v=>`${n}|${Bn.get(v)}`;let ar=0;for(;Te&&ar<mr.length&&Te.get(mr[ar])?.key===zr(mr[ar]);)ar++;if(Te)for(const v of[...mr.slice(ar),"phasor"]){const P=Te.get(v);P&&(v!=="phasor"||P.key!==zr(v)||ar<mr.length)&&(Or(P),Te.delete(v))}const Tn=v=>{I.end(),v.nodes&&D.copyBufferToBuffer(v.nodes,0,Ae,0,v.nodes.size),v.fine&&D.copyBufferToBuffer(v.fine,0,Oe,0,v.fine.size),D.copyBufferToBuffer(v.control,0,Ge,0,pt),I=Z(0)},Ln=(v,P)=>{if(!Te)return;I.end();const N=(ue,be=ue.size)=>{const lr=s.createBuffer({size:be,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});return D.copyBufferToBuffer(ue,0,lr,0,be),lr},T=Te.get(v);T&&Or(T),Te.set(v,{key:zr(v),kind:P,...P===0?{nodes:N(Ae,m*m*112)}:{fine:N(Oe,Be)},control:N(Ge,pt)}),s.queue.submit([D.finish()]),D=s.createCommandEncoder(),I=Z(0)},On=async(v,P)=>{if(!e)return;if(!x){e.cached?await e.cached(v):(await e.before(v),await e.after(v));return}const N=te.slice();N[7]=P.kind,ce("generationPreview",N),I.end(),D.copyBufferToBuffer(Ee,0,pe,0,ye),s.queue.submit([D.finish()]),await We(ye);const T=new Float32Array(ir(ye),0,me).slice();pe.unmap(),e.cached?await e.cached(v,T):(await e.before(v),await e.after(v,T)),D=s.createCommandEncoder(),I=Z(0)},Ze=async(v,P,N)=>{const T=mr.indexOf(v),ue=Te?.get(v);if(ue&&T>=0&&T<ar){(x||T===ar-1)&&Tn(ue),await On(v,ue);return}await e?.before(v),L(v),await N(),Ln(v,P),await Nt(v,P)},Gn=t.procedural?.coastAfter??"initialize",gr=async(v,P)=>{!Ke||v!==Gn||await Ze("coastCut",P===4?5:P,async()=>{if(!vt(t,"coastCut"))return;const N=te.slice();N[7]=P,P===0?q("generationRegionalRead",N,Math.ceil(m*m/256)):ce("generationPreview",N),I.end();const T=P===0?m*m:me;D.copyBufferToBuffer(Ee,0,pe,0,T*4),s.queue.submit([D.finish()]),await We(T*4);const ue=new Float32Array(ir(T*4),0,T).slice();pe.unmap();const be=Pi(yn,Ve(t.generalSeed??t.seed,"relief-coast-cut"),t.width,y[3]*2400,y[12],t.coastMask,t.islandMode??"island",P===0?m:i,P===0?h[5]:0,P===0?h[4]:h[11],ue,Ir(t));s.queue.writeBuffer(Ee,0,be),D=s.createCommandEncoder(),I=Z(0),P===0?q("generationCut",N,Math.ceil(m*m/256)):ce("generationCut",N),Et(P)})};e&&await e.after("grids",void 0,`Budget ×${n} · régional ${m}² · surface ${U[2]}² · ${(z.reduce((v,P)=>v+P.size,0)/1048576).toFixed(1)} Mio`),u?.(`GPU · encodage de ${R} cycles de relief et ${S[3]} passes d’érosion…`,{stage:"gpu-erosion-encode"}),a?(Q=U,ce("coastLoad"),Et(2)):o?(e&&await e.before("initialize"),Q=U,ce("volcanicInitial"),e&&await Nt("initialize",2)):(await Ze("initialize",0,()=>{q(F)}),await gr("initialize",0),await Ze("regional",0,()=>{for(let v=0;v<(ne(t,"regional")?R:0);v++){if(q("uplift"),C>0){He(0,64*_),nt(),q("flow"),it(A[1]),He(1,128*_),He(2,128*_),at(3);const P=h[17]*3*C;for(let N=0;N<Math.floor(P);N++)Hr(.5);P%1>0&&Hr(.5*(P%1))}q("bounds")}}),await Ze("regionalFinish",0,()=>{const v=te.slice();if(v[7]=1,q("bounds",v),C>0&&ne(t,"regionalFinish")){at(4,le);for(let P=0;P<6;P++)He(0,64*_),nt(le),q("flow"),it(A[2]);Hr(C*.5,le)}}),await gr("regionalFinish",0),await Ze("reconstruct",1,()=>{const v=te.slice();v[7]=t.procedural?.reconstruction==="bspline"?1:0,ce(re,v)}),await Ze("amplitude",4,()=>{ne(t,"amplitude")?Rt(0):q("generationUnitScale",te,1)}),await gr("amplitude",4),await Ze("ridged",2,()=>{ce("detail")}),await gr("ridged",2)),I.end(),I=Z(2),await Ze("surface",2,()=>{if(t.erosion>0&&V){if(Q=U,ae=G,q("surfaceLoad"),t.relief==="canyon"&&!a){const v=Math.ceil(128*_*$);He(0,v),q("flow"),He(1,v),q("canyonSeed");let P=0;const N=[];for(let ue=2**(Math.ceil(Math.log2(U[2]))-1);ue>=1;ue/=2)N.push(ue);N.push(1,1);for(const ue of N){const be=te.slice();be[0]=P,be[1]=ue,q("canyonSpread",be),P=1-P}const T=te.slice();T[0]=P,q("canyonApply",T)}for(let v=0;v<S[3];v++)M?(He(0,Y),nt(te,!1),q("flow"),it(A[7])):(q("surfaceFlowInit"),q("receivers"),q("flow")),He(1,Y,!0),He(3,Y,!0),at(1),Hr(S[7]);q("surfaceDelta"),ce("surfaceReconstruct")}}),await gr("surface",2),I.end(),I=Z(4),await Ze("normalize",1,()=>{a?ce("coastResult"):ne(t,"normalize")?(Rt(1),ce("normalize")):ce("generationKeepDatum")}),await gr("normalize",1);let Ur=Yr.get(s);Ur||(Ur=new _t,Yr.set(s,Ur));const Cr=hr?Ur.get("phasor",zr("phasor")):void 0;if(Cr)return I.end(),s.queue.submit([D.finish()]),e?.cached?await e.cached("phasor",x?Cr:void 0):(await e?.before("phasor"),await e?.after("phasor",Cr)),he(),Cr;Cr||await e?.before("phasor"),ce(B),I.end();const Ar=ye;D.copyBufferToBuffer(Ee,0,pe,0,Ar),D.copyBufferToBuffer(Ge,0,pe,Ar,1088),w&&b&&J&&(D.resolveQuerySet(w,0,6,b,0),D.copyBufferToBuffer(b,0,J,0,48));const Fn=D.finish(),In=performance.now()-Pe;u?.(a?"GPU · calcul de l’érosion côtière…":"GPU · calcul du relief et de l’érosion…",{stage:"gpu-erosion-run"});const qn=performance.now();s.queue.submit([Fn]);const Hn=s.queue.onSubmittedWorkDone().then(()=>u?.("GPU · lecture et validation des altitudes…",{stage:"gpu-readback"}));await Promise.all([We(Ar+1088),J?.mapAsync(GPUMapMode.READ),Hn]);const Dn=performance.now()-qn,$n=performance.now(),Bt=ir(Ar+1088),ot=new Uint32Array(Bt,Ar,272),jn=Array.from(ot.slice(267,271)),st={factor:n,sourceSize:i,coarseSize:m,surfaceSize:U[2],pipelineMs:we,encodeMs:In,submitReadbackMs:Dn,unpackMs:0,maxSolveSteps:jn,allocatedBytes:z.reduce((v,P)=>v+P.size,0)};if(J){const v=new BigUint64Array(J.getMappedRange());st.gpuStagesMs={coarse:Number(v[1]-v[0])/1e6,surface:Number(v[3]-v[2])/1e6,normalization:Number(v[5]-v[4])/1e6},J.unmap()}if(l&&(l.profiles??=[]).push(st),ot[2]!==0)throw pe.unmap(),new Gr(`Érosion GPU non convergée (${ot[2]} cellules/étapes, budget ×${n}).`);const Er=new Float32Array(Bt,0,me).slice();pe.unmap(),st.unpackMs=performance.now()-$n;const Wn=a||Ke&&vt(t,"coastCut")?-1/0:.3-1e-7;for(let v=0;v<me;v++)if(!Number.isFinite(Er[v])||Er[v]<Wn)throw new Error("Champ GPU invalide.");return he(),hr&&Ur.put("phasor",zr("phasor"),Er),e&&await e.after("phasor",x?Er:void 0,"Sortie GPU lue et validée"),Er}catch(h){throw h instanceof Gr&&(br.get(s)?.forEach(Or),br.get(s)?.clear(),Yr.delete(s)),h}finally{d.free(),z.forEach(h=>{h.mapState!=="unmapped"&&h.unmap(),p&&h.destroy()}),p&&dt.delete(s)}}var Ki=`// Physical flood levels and routing potential are distinct: flats stay flat.\r
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
`;const Xi=["reset","initialize","clearNext","solveTile","receivers","accumulateCopy","accumulateScatter","finish"],en=new WeakMap,rn=new WeakMap;function Zi(r){let t=en.get(r);return t||(t=(async()=>{const i=r.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:32}},...[1,2].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),...[3,4,5].map(s=>({binding:s,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}))]}),n=r.createShaderModule({code:Ki}),a=(await n.getCompilationInfo()).messages.filter(s=>s.type==="error");if(a.length)throw new Error(`Hydrologie WGSL : ${a.map(s=>`${s.lineNum}: ${s.message}`).join(`
`)}`);const l=r.createPipelineLayout({bindGroupLayouts:[i]}),u=await Promise.all(Xi.map(async s=>[s,await r.createComputePipelineAsync({layout:l,compute:{module:n,entryPoint:s}})]));return{layout:i,values:new Map(u)}})(),en.set(r,t)),t}function Qi(r){let t=2166136261;for(let i=0;i<r.length;i++)t=Math.imul(t^r.charCodeAt(i),16777619);return t>>>0}function ea(r,t,i){const n=new Uint32Array(r.length);if(!i)return{mask:n,count:0};const o=new Uint8Array(r.length),a=new Uint32Array(r.length);let l=0,u=0,s=0;const e=f=>{o[f]===0&&r[f]<=0&&(o[f]=1,a[u++]=f)},c=f=>{if(o[f]!==0||r[f]>0)return;l=0,u=0,e(f);let d=!1;for(;l<u;){const y=a[l++],S=y%t,k=Math.floor(y/t);d||=S+1<t&&k+1<t&&r[y+1]<=0&&r[y+t]<=0&&r[y+t+1]<=0;for(let z=-1;z<=1;z++){const x=k+z;if(!(x<0||x>=t))for(let p=-1;p<=1;p++){const g=S+p;g>=0&&g<t&&e(x*t+g)}}}if(d){for(let y=0;y<u;y++)n[a[y]]=1;s+=u}};for(let f=0;f<t;f++)c(f),c((t-1)*t+f);for(let f=1;f+1<t;f++)c(f*t),c(f*t+t-1);return{mask:n,count:s}}class ra{constructor(t,i,n){this.device=t,this.n=i,this.program=n,this.buffers=[],this.pending=Promise.resolve();const o=i*i,a=(u,s)=>{const e=t.createBuffer({size:u,usage:s});return this.buffers.push(e),e};this.uniform=a(512,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.source=a(o*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sea=a(o*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const l=a(o*48,GPUBufferUsage.STORAGE);this.control=a(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.output=a(o*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),this.readback=a(o*16+16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.statusReadback=a(16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),this.group=t.createBindGroup({layout:n.layout,entries:[{binding:0,resource:{buffer:this.uniform,size:32}},...[this.source,this.sea,l,this.control,this.output].map((u,s)=>({binding:s+1,resource:{buffer:u}}))]}),t.lost.then(()=>this.buffers.forEach(u=>u.destroy()))}run(t,i,n,o){const a=this.pending.then(()=>this.execute(t,i,n,o));return this.pending=a.then(()=>{},()=>{}),a}async execute(t,i,n,o){const a=performance.now(),l=this.n,u=l*l,s=i/l,e=ea(t,l,o),c=performance.now()-a,f=this.device;f.queue.writeBuffer(this.source,0,t),f.queue.writeBuffer(this.sea,0,e.mask);for(let B=0;B<2;B++){const F=new ArrayBuffer(32);new Uint32Array(F,0,4).set([l,Qi(n),B,o?1:0]),new Float32Array(F,16,4).set([s,s*s,Math.max(.1,s*.1),0]),f.queue.writeBuffer(this.uniform,B*256,F)}const d=(B,F,V=0)=>{B.setPipeline(this.program.values.get(F)),B.setBindGroup(0,this.group,[V*256]),F==="solveTile"?B.dispatchWorkgroups(Math.ceil(l/16),Math.ceil(l/16)):B.dispatchWorkgroups(F==="reset"||F==="clearNext"?1:Math.ceil(u/256))},y=performance.now(),S=f.createCommandEncoder(),k=S.beginComputePass();d(k,"reset"),d(k,"initialize"),k.end(),f.queue.submit([S.finish()]);let z=0,x=!1,p=32;const g=Math.max(256,l);for(;z<g;){const B=f.createCommandEncoder(),F=B.beginComputePass();for(let he=0;he<p;he++){const re=z+he&1;d(F,"clearNext",re),d(F,"solveTile",re)}F.end(),B.copyBufferToBuffer(this.control,0,this.statusReadback,0,16),f.queue.submit([B.finish()]),z+=p,p=Math.min(p*2,128),await this.statusReadback.mapAsync(GPUMapMode.READ);const V=new Uint32Array(this.statusReadback.getMappedRange())[0];if(this.statusReadback.unmap(),V===0){x=!0;break}}if(!x)throw new Error(`Drainage hydrique GPU non convergé après ${z} passes (${l}²) ; repli CPU requis.`);const h=f.createCommandEncoder(),m=h.beginComputePass();d(m,"receivers");const R=Math.ceil(Math.log2(u));for(let B=0;B<R;B++){const F=B&1;d(m,"accumulateCopy",F),d(m,"accumulateScatter",F)}d(m,"finish",R&1),m.end();const C=u*16;h.copyBufferToBuffer(this.output,0,this.readback,0,C),h.copyBufferToBuffer(this.control,0,this.readback,C,16),f.queue.submit([h.finish()]),await this.readback.mapAsync(GPUMapMode.READ);const A=performance.now()-y,G=performance.now();let M,_,U,$;try{const B=this.readback.getMappedRange(),F=new Uint32Array(B,C,4);if(F[2]!==0||F[3]!==u-e.count)throw new Error(`Drainage hydrique GPU invalide (${F[2]} erreurs, ${F[3]}/${u-e.count} cellules drainées) ; repli CPU requis.`);const V=new Float32Array(B,0,u*4),he=new Uint32Array(B,0,u*4);M=new Float32Array(u),_=new Uint32Array(u),U=new Float32Array(u),$=new Float32Array(u);for(let re=0;re<u;re++)M[re]=V[re*4],_[re]=he[re*4+1],U[re]=V[re*4+2],$[re]=V[re*4+3]}finally{this.readback.unmap()}const Y=new Uint8Array(e.mask);return{filled:M,receivers:_,accumulation:U,potential:$,seaMask:Y,preprocessingMs:c,computeMs:A,readbackMs:performance.now()-G,floodPasses:z}}}async function ta(r,t,i,n,o=!1){if(![256,512,1024].includes(i)||r.length!==i*i||!Number.isFinite(t)||t<=0||!r.every(Number.isFinite))throw new Error("Grille hydrique GPU invalide.");const a=await Ut();if(!a||a.lost)throw new Error("WebGPU indisponible pour l’hydrologie ; repli CPU requis.");const l=await Zi(a.device);if(a.lost)throw new Error("Device WebGPU perdu pendant la préparation hydrique ; repli CPU requis.");let u=rn.get(a.device);u||(u=new Map,rn.set(a.device,u));let s=u.get(i);return s||(s=new ra(a.device,i,l),u.set(i,s)),s.run(r,t,n,o)}const tn=new WeakMap;function na(r){const t=tn.get(r);if(t)return t;const i=new Float32Array(r.baseHeight.length),n=[],o=p=>r.drainageHeight[p]<r.rawDrainageHeight[p]&&r.surfaceHeight[p]<r.baseHeight[p];let a=!1;for(let p=0;p<i.length;p++){const g=o(p);g&&n.push(p),i[p]=g?0:r.surfaceHeight[p]-r.baseHeight[p],a||=i[p]!==0}const l=256,u=r.width/l,s=new Map,e=[],c=r.riverPoints,f=new Map,d=[],y=r.resolution,S=r.width/y,k=p=>Math.min(S*2,Math.max(S*.5,(r.baseHeight[p]-r.surfaceHeight[p])*1.4)),z=p=>((Math.imul(p^2654435769,2246822507)>>>8)/16777216-.5)*.6;for(const p of n){const g=p%y,h=Math.floor(p/y),m=(g+.5)*S,R=(h+.5)*S,C=[];for(let A=-1;A<=1;A++)for(let G=-1;G<=1;G++){const M=g+G,_=h+A,U=_*y+M;if(!G&&!A||M<0||_<0||M>=y||_>=y)continue;const $=o(U);($&&U>p||!$&&r.basins[U]&&r.surfaceHeight[U]<=r.surfaceHeight[p])&&C.push(U)}C.length||C.push(p);for(const A of C){const G=(A%y+.5)*S,M=(Math.floor(A/y)+.5)*S,_=d.length,U=k(p),$=k(A),Y=z(p),B=Math.max(U,$)*(1+Math.abs(Y));d.push({a:p,b:A,ra:U,rb:$,skew:Y});const F=Me(Math.min(m,G)-B,u,l),V=Me(Math.max(m,G)+B,u,l),he=Me(Math.min(R,M)-B,u,l),re=Me(Math.max(R,M)+B,u,l);for(let de=he;de<=re;de++)for(let ie=F;ie<=V;ie++){const K=de*l+ie,Se=f.get(K);Se?Se.push(_):f.set(K,[_])}}}if(r.incision>0)for(let p=0;p<r.riverCount;p++)for(let g=r.riverOffsets[p];g+1<r.riverOffsets[p+1];g++){const h=g+1,m=Math.max(c[g*4+2],c[h*4+2])*.65+.5,R=e.length;e.push({a:g,b:h,estuary:r.riverMeta[p*6+5]});const C=Me(Math.min(c[g*4],c[h*4])-m,u,l),A=Me(Math.max(c[g*4],c[h*4])+m,u,l),G=Me(Math.min(c[g*4+1],c[h*4+1])-m,u,l),M=Me(Math.max(c[g*4+1],c[h*4+1])+m,u,l);for(let _=G;_<=M;_++)for(let U=C;U<=A;U++){const $=_*l+U,Y=s.get($);Y?Y.push(R):s.set($,[R])}}const x={delta:i,hasDelta:a,hasSea:r.basins.includes(0),buckets:s,segments:e,bucketSize:u,side:l,notchBuckets:f,notches:d};return tn.set(r,x),x}const Me=(r,t,i)=>Math.max(0,Math.min(i-1,Math.floor(r/t)));function nn(r,t,i,n,o){const a=new Int32Array(i*4),l=new Float64Array(i*4);for(let u=0;u<i;u++){const s=Math.max(0,Math.min(o-1,(r+(u+.5)*t)/n-.5)),e=Math.floor(s),c=s-e,f=1-c;for(let d=0;d<4;d++)a[u*4+d]=Math.max(0,Math.min(o-1,e+d-1));l.set([f**3/6,(3*c**3-6*c*c+4)/6,(-3*c**3+3*c*c+3*c+1)/6,c**3/6],u*4)}return{indices:a,weights:l}}function zn(r,t,i=!0){const n=r.resolution,o=r.width/n,a=na(t);if(!a.hasDelta&&!a.segments.length&&!a.notches.length)return;const l=i?new Float32Array(n*n):void 0;if(a.hasDelta){const g=t.resolution,h=t.width/g,m=nn(r.x,o,n,h,g),R=nn(r.y,o,n,h,g),C=R.indices[0],A=R.indices[R.indices.length-1],G=new Float64Array((A-C+1)*n);for(let M=C;M<=A;M++){const _=M*g,U=(M-C)*n;for(let $=0;$<n;$++){const Y=$*4;G[U+$]=a.delta[_+m.indices[Y]]*m.weights[Y]+a.delta[_+m.indices[Y+1]]*m.weights[Y+1]+a.delta[_+m.indices[Y+2]]*m.weights[Y+2]+a.delta[_+m.indices[Y+3]]*m.weights[Y+3]}}for(let M=0;M<n;M++)for(let _=0;_<n;_++){const U=M*4;let $=G[(R.indices[U]-C)*n+_]*R.weights[U]+G[(R.indices[U+1]-C)*n+_]*R.weights[U+1]+G[(R.indices[U+2]-C)*n+_]*R.weights[U+2]+G[(R.indices[U+3]-C)*n+_]*R.weights[U+3];if($>0&&a.hasSea&&r.height[M*n+_]<=0){const Y=Math.max(0,Math.min(g-1,Math.floor((r.x+(_+.5)*o)/h))),B=Math.max(0,Math.min(g-1,Math.floor((r.y+(M+.5)*o)/h))),F=B*g+Y;(!t.basins[F]||t.baseHeight[F]>=0)&&($=0)}l&&(l[M*n+_]=$),r.height[M*n+_]+=$}}const u=new Set,{bucketSize:s,side:e}=a;for(let g=Me(r.y,s,e);g<=Me(r.y+r.width,s,e);g++)for(let h=Me(r.x,s,e);h<=Me(r.x+r.width,s,e);h++)for(const m of a.buckets.get(g*e+h)??[])u.add(m);const c=new Float32Array(n*n),f=t.riverPoints,d=(g,h)=>Math.max(0,Math.min(n-1,Math.floor((g-h)/o))),y=new Set;for(let g=Me(r.y,s,e);g<=Me(r.y+r.width,s,e);g++)for(let h=Me(r.x,s,e);h<=Me(r.x+r.width,s,e);h++)for(const m of a.notchBuckets.get(g*e+h)??[])y.add(m);const S=t.resolution,k=t.width/S,z=k*.25;for(const g of y){const{a:h,b:m,ra:R,rb:C,skew:A}=a.notches[g],G=Math.max(R,C)*(1+Math.abs(A)),M=(h%S+.5)*k,_=(Math.floor(h/S)+.5)*k,U=(m%S+.5)*k,$=(Math.floor(m/S)+.5)*k,Y=U-M,B=$-_,F=Y*Y+B*B,V=Math.min(M,U)-G,he=Math.max(M,U)+G,re=Math.min(_,$)-G,de=Math.max(_,$)+G;if(he<r.x||V>r.x+r.width||de<r.y||re>r.y+r.width)continue;const ie=Math.abs(B)>1e-12,K=ie?G*Math.sqrt(F)/Math.abs(B):0;for(let Se=d(re,r.y);Se<=d(de,r.y);Se++){const je=r.y+(Se+.5)*o,ve=ie?M+Y*(je-_)/B:0,we=ie?Math.max(V,ve-K):V,Pe=ie?Math.min(he,ve+K):he;if(!(we>Pe||Pe<r.x||we>r.x+r.width))for(let ze=d(we,r.x);ze<=d(Pe,r.x);ze++){const fe=r.x+(ze+.5)*o,Ue=F?Math.max(0,Math.min(1,((fe-M)*Y+(je-_)*B)/F)):0,_e=Math.hypot(fe-M-Y*Ue,je-_-B*Ue),me=z+(R+(C-R)*Ue-z)*(1+A*Math.sign((fe-M)*B-(je-_)*Y));if(_e>=me)continue;const ye=Math.max(0,(_e-z)/(me-z)),Be=1-ye*ye*(3-2*ye),ge=t.surfaceHeight[h]+(t.surfaceHeight[m]-t.surfaceHeight[h])*Ue,Ce=Se*n+ze;c[Ce]=Math.max(c[Ce],Math.max(0,r.height[Ce]-ge)*Be)}}}for(const g of u){const{a:h,b:m,estuary:R}=a.segments[g],C=f[h*4],A=f[h*4+1],G=f[m*4],M=f[m*4+1],_=f[h*4+2],U=f[m*4+2],$=f[h*4+3],Y=f[m*4+3],B=Math.max(Math.max(_,U)*.65,.5),F=G-C,V=M-A,he=F*F+V*V,re=Math.min(C,G)-B,de=Math.max(C,G)+B,ie=Math.min(A,M)-B,K=Math.max(A,M)+B;if(de<r.x||re>r.x+r.width||K<r.y||ie>r.y+r.width)continue;const Se=d(ie,r.y),je=d(K,r.y),ve=Math.abs(V)>1e-12,we=ve?B*Math.hypot(F,V)/Math.abs(V):0;for(let Pe=Se;Pe<=je;Pe++){const ze=r.y+(Pe+.5)*o,fe=ve?C+F*(ze-A)/V:0,Ue=ve?Math.max(re,fe-we):re,_e=ve?Math.min(de,fe+we):de;if(Ue>_e||_e<r.x||Ue>r.x+r.width)continue;const me=d(Ue,r.x),ye=d(_e,r.x);for(let Be=me;Be<=ye;Be++){const ge=r.x+(Be+.5)*o,Ce=Math.max(0,Math.min(1,((ge-C)*F+(ze-A)*V)/Math.max(he,.001))),Ae=_+(U-_)*Ce,Oe=$+(Y-$)*Ce,Ge=Math.hypot(ge-C-F*Ce,ze-A-V*Ce),Ee=Math.max(0,1-Ge/Math.max(Ae*.65,.5))**2;if(!Ee)continue;const pe=Math.max(.35,Math.min(12,Ae*.11))*t.incision,nr=Pe*n+Be,pr=Math.max(0,Math.min(pe*2+.75,r.height[nr]-(Oe-pe)))*Ee*(R>1&&Oe<pe?1.15:1);c[nr]=Math.max(c[nr],pr)}}}let x=1/0,p=-1/0;for(let g=0;g<n*n;g++)r.height[g]-=c[g],l&&(l[g]-=c[g]),x=Math.min(x,r.height[g]),p=Math.max(p,r.height[g]);if(l)for(let g=0;g<n;g++)for(let h=0;h<n;h++){const m=g*n+h,R=Math.max(0,h-1),C=Math.min(n-1,h+1),A=Math.max(0,g-1),G=Math.min(n-1,g+1),M=l[g*n+C]-l[g*n+R],_=l[G*n+h]-l[A*n+h];if(M===0&&_===0)continue;const U=Math.max(1e-6,r.normalZ[m]),$=-r.normalX[m]/U+M/((C-R)*o||o),Y=-r.normalY[m]/U+_/((G-A)*o||o),B=Math.hypot($,Y,1);r.normalX[m]=-$/B,r.normalY[m]=-Y/B,r.normalZ[m]=1/B}r.minHeight=x,r.maxHeight=p}const mt=new Float32Array(0);function an(r,t){const i={...r,normalX:mt,normalY:mt,normalZ:mt};zn(i,t,!1),r.minHeight=i.minHeight,r.maxHeight=i.maxHeight}const Jr=r=>r.lakes==="none"||!(r.lakeAbundance>0&&r.lakeCoverage>0&&r.maxLakeArea>0),ia=(r,t)=>r.riverArea>0?r.riverArea:Math.max(.02,.003*(t/1e3)**2);class Ct{constructor(t,i,n,o,a,l){this.engine=t,this.baseHeight=i,this.backend=n,this.backendReason=o,this.drainageMs=a,this.gpu=l}static async create(t,i,n,o,a,l){const u=performance.now();let s,e,c;if(a!=="cpu")try{const d=await ta(o,i,n,t,l);s=Ot.with_drainage(t,i,n,o,l,d.filled,d.receivers,d.accumulation),c=d}catch(d){e=`GPU hydrology unavailable: ${d instanceof Error?d.message:String(d)}`}const f=s?"gpu-f32":"cpu";return s??=new Ot(t,i,n,o,l),new Ct(s,o,f,e,performance.now()-u,c)}generate(t,i,n=0){const o=performance.now(),a=this.engine.generate(t.main,t.density,t.wetness,Jr(t)?"none":t.lakes,t.meanders,t.meanderIntensity,t.estuary,t.widthScale,t.incision,t.minLakeArea,t.lakeAbundance,t.lakeCoverage,t.maxLakeArea,t.depressionPolicy,t.maxBreachDepth,t.maxBreachLength,t.minLakeDepth,i.temperature,i.precipitation,t.coastalStreams,n);try{const l=a.stage_ms,u=a.stage_labels?Object.fromEntries(a.stage_labels.split(",").map((x,p)=>[x,l[p]])):void 0,s=a.basins;let e=0,c=0;for(const x of s)e=Math.max(e,x),x&&c++;const f=a.river_offsets,d=a.lake_meta,y=a.lake_closed;let S=0;for(let x=2;x<d.length;x+=6)S+=d[x];const k=a.river_meta;let z=!1;for(let x=4;x<k.length;x+=6)z||=(k[x]&2)!==0;return{width:a.width,resolution:a.resolution,receivers:a.receivers,accumulation:a.accumulation,basins:s,rawReceivers:a.raw_receivers??a.receivers,rawAccumulation:a.raw_accumulation??a.accumulation,rawBasins:a.raw_basins??s,flatLabels:a.flat_labels??new Uint32Array(s.length),flatRank:a.flat_rank??new Uint32Array(s.length),externalInflowArea:a.external_inflow_area??0,rawFilled:a.raw_filled??a.filled,rawDrainageHeight:a.raw_drainage_height??a.drainage_height,breachCount:a.breach_count??0,breachCutVolumeM3:a.breach_cut_volume_m3??0,avoidedFillVolumeM3:a.avoided_fill_volume_m3??0,filled:a.filled,lakeDepth:a.lake_depth,lakeLabels:a.lake_labels,baseHeight:this.baseHeight,drainageHeight:a.drainage_height,surfaceHeight:a.surface_height,adjustedHeight:a.adjusted_height,riverPoints:a.river_points,riverOffsets:f,riverMeta:k,riverFlare:a.river_flare,lakePoints:a.lake_points,lakeOffsets:a.lake_offsets,lakeMeta:d,lakeRingMeta:a.lake_ring_meta,lakeClosed:y,waterField:a.water_field,closedLakeCount:y.reduce((x,p)=>x+p,0),nodePoints:a.node_points,nodeMeta:a.node_meta,riverCount:f.length-1,lakeCount:d.length/6,basinCount:e,lakeFraction:S/Math.max(1,c*(a.width/a.resolution)**2),incision:t.incision,backend:this.backend,backendReason:[this.backendReason,this.backend==="gpu-f32"&&t.lakes==="some"?"Lake layout and associated drainage completed in Rust.":void 0,["stream","river","major"].includes(t.main)&&!z?"No suitable land inflow: the main channel is limited to its local watershed.":void 0].filter(Boolean).join(" · ")||void 0,drainageMs:this.drainageMs,vectorMs:performance.now()-o,stageMs:u,generationMs:this.drainageMs+performance.now()-o,routingPotential:t.lakes==="some"?void 0:this.gpu?.potential,seaMask:this.gpu?.seaMask,gpuComputeMs:this.gpu?.computeMs,gpuReadbackMs:this.gpu?.readbackMs,gpuFloodPasses:this.gpu?.floodPasses}}finally{a.free()}}dispose(){this.engine.free()}}const aa="magna-urbis-neural-models-v1",kt=["coarse","base","decoder"];class $e extends Error{constructor(t,i,n){super(i,n),this.code=t}}function on(r){const t=r;if(!t||typeof t.profile!="string"||!/^[a-f0-9]{64}$/.test(t.runtimeSha256))throw new $e("manifest","Invalid neural model manifest.");if(t.runtimeJsSha256!==void 0&&!/^[a-f0-9]{64}$/.test(t.runtimeJsSha256))throw new $e("manifest","Invalid neural runtime manifest.");for(const i of kt){const n=t.models?.[i];if(!n||!/^[\w.-]+$/.test(n.file)||!Number.isSafeInteger(n.bytes)||n.bytes<=0||!/^[a-f0-9]{64}$/.test(n.sha256))throw new $e("manifest",`Invalid ${i} model manifest.`);if(n.chunks!==void 0&&(!Array.isArray(n.chunks)||!n.chunks.length||n.chunks.some(o=>!o||!/^[\w.-]+$/.test(o.file)||!Number.isSafeInteger(o.bytes)||o.bytes<=0||o.bytes>=5e7||!/^[a-f0-9]{64}$/.test(o.sha256))||new Set(n.chunks.map(o=>o.file)).size!==n.chunks.length||n.chunks.reduce((o,a)=>o+a.bytes,0)!==n.bytes))throw new $e("manifest",`Invalid ${i} model chunks.`)}return t}async function Un(r=!0){try{if(!globalThis.caches)throw new Error("Cache Storage unavailable");return await caches.open(aa)}catch(t){if(r)throw new $e("storage","Cannot access browser model storage.",{cause:t})}}async function oa(r,t){const i=new URL("models/manifest.json",r),n=await Un(!1),o=AbortSignal.timeout(15e3);try{const a=await fetch(i,{cache:"no-cache",signal:t?AbortSignal.any([t,o]):o});if(!a.ok)throw new Error(`HTTP ${a.status}`);const l=on(await a.json());return await n?.put(i,new Response(JSON.stringify(l),{headers:{"Content-Type":"application/json"}})).catch(()=>{}),{manifest:l,offline:!1}}catch(a){const l=await n?.match(i);if(l)return{manifest:on(await l.json()),offline:!0};throw new $e("manifest","Neural model catalogue unavailable on this address.",{cause:a})}}function Cn(r,t){const i=new URL(`models/${t.file}`,r);return i.searchParams.set("sha256",t.sha256),i.href}function sa(r,t,i,n){return r.searchParams.get("sha256")===i.sha256&&Number(t.headers.get("X-Magna-Model-Bytes"))===i.bytes&&(t.headers.get("X-Magna-Model-Name")===n||r.pathname.split("/").pop()===i.file)}async function la(r,t,i,n){const o=Cn(t,i),a=await r.match(o);if(a)return{url:o,response:a};for(const l of await r.keys()){const u=new URL(l.url);if(u.searchParams.get("sha256")!==i.sha256)continue;const s=await r.match(l);if(s&&sa(u,s,i,n))return{url:l.url,response:s}}}async function Vr(r,t){if(r.byteLength!==t.bytes)return!1;const i=await crypto.subtle.digest("SHA-256",r);return Array.from(new Uint8Array(i),n=>n.toString(16).padStart(2,"0")).join("")===t.sha256}async function ca(r,t,i,n={}){const{signal:o,onProgress:a}=n,l=t.models[i],u=Cn(r,l);o?.throwIfAborted();const s=await Un(n.requireStorage??!1);s||n.onStorageFailure?.();const e=s&&await la(s,r,l,i);if(e){const d=new Uint8Array(await e.response.arrayBuffer());a?.({name:i,phase:"verify",received:d.length,total:l.bytes});const y=await Vr(d,l);if(o?.throwIfAborted(),y)return d;await s?.delete(e.url)}const c=new Uint8Array(l.bytes);let f=0;for(const d of l.chunks??[l]){const y=new URL(`models/${d.file}`,r);y.searchParams.set("sha256",d.sha256);const S=await fetch(y.href,{signal:o});if(!S.ok)throw new $e("download",`Cannot download ${i} weights: HTTP ${S.status}`);const k=f;if(S.body){const z=S.body.getReader();try{for(;;){o?.throwIfAborted();const{done:x,value:p}=await z.read();if(x)break;if(f+p.byteLength>k+d.bytes)throw new $e("integrity",`Invalid ${i} model size.`);c.set(p,f),f+=p.byteLength,a?.({name:i,phase:"download",received:f,total:l.bytes})}}catch(x){throw await z.cancel().catch(()=>{}),x}finally{z.releaseLock()}}else{const z=new Uint8Array(await S.arrayBuffer());f+=z.byteLength,z.byteLength===d.bytes&&c.set(z,k)}if(f-k!==d.bytes||l.chunks&&!await Vr(c.subarray(k,f),d))throw new $e("integrity",`Invalid ${i} model chunk: integrity check failed.`)}if(o?.throwIfAborted(),a?.({name:i,phase:"verify",received:f,total:l.bytes}),f!==l.bytes||!await Vr(c,l))throw new $e("integrity",`Invalid ${i} model: integrity check failed.`);if(o?.throwIfAborted(),s){a?.({name:i,phase:"save",received:f,total:l.bytes});try{await s.put(u,new Response(c,{headers:{"X-Magna-Model-Name":i,"X-Magna-Model-Bytes":String(l.bytes),"X-Magna-Model-Profile":t.profile}}))}catch(d){if(n.requireStorage)throw new $e("storage","Cannot save model: browser storage is full or unavailable.",{cause:d});n.onStorageFailure?.()}}return c}async function ua(r,t,i){const n=await globalThis.caches?.open("magna-urbis-neural-runtime-v1");async function o(u,s){const e=new URL(u,r);e.searchParams.set("sha256",s??t.runtimeSha256);const c=k=>s?Vr(k,{bytes:k.length,sha256:s}):Promise.resolve(!0);let f=e.href,d=await n?.match(e);if(n&&!d)for(const k of await n.keys()){const z=new URL(k.url);if(!(z.pathname.split("/").pop()!==u||z.searchParams.get("sha256")!==e.searchParams.get("sha256"))&&(d=await n.match(k),d)){f=k.url;break}}if(d){const k=new Uint8Array(await d.arrayBuffer());if(await c(k))return k;await n?.delete(f)}const y=await fetch(e,{signal:i});if(!y.ok)throw new Error("Neural runtime unavailable. Check your connection and retry.");const S=new Uint8Array(await y.arrayBuffer());if(!await c(S))throw new Error("Neural runtime integrity check failed. Please retry.");return await n?.put(e,new Response(S)),S}const a=await o("magna_urbis_neural_wasm.js",t.runtimeJsSha256),l=await o("magna_urbis_neural_wasm_bg.wasm",t.runtimeSha256);return{javascript:a,wasm:l}}let sn="",Dr,St="",dr,ln="";function An(r,t){if(new URL(r).protocol==="file:")return Promise.reject(new Error("Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS."));const i=r+(t?.runtimeSha256??"")+(t?.runtimeJsSha256??"");return(sn!==i||!Dr)&&(sn=i,Dr=(async()=>{if(t){const{javascript:a,wasm:l}=await ua(r,t),u=URL.createObjectURL(new Blob([a],{type:"text/javascript"}));try{const s=await import(u);return await s.default({module_or_path:l}),s}finally{URL.revokeObjectURL(u)}}const o=await import(new URL("magna_urbis_neural_wasm.js",r).href);return await o.default({module_or_path:new URL("magna_urbis_neural_wasm_bg.wasm",r)}),o})().catch(n=>{throw Dr=void 0,new Error("Neural runtime unavailable. Check your connection and retry.")})),Dr}async function At(){if(dr){try{(await dr).free()}catch{}dr=void 0,St=""}}async function fa(r,t,i,n){if(!globalThis.navigator?.gpu)throw new Error("Neuronal WASM requires WebGPU on HTTPS or localhost.");const{manifest:o}=await oa(r),a=[o.runtimeSha256,...kt.map(s=>o.models[s].sha256)].join(":");(St!==r+a||!dr)&&(await At(),St=r+a,dr=(async()=>{const s=await An(r,o);ln=a;const e=[];for(const c of kt){const f=o.models[c];n?.(`Neuronal WASM · ${c} · ${(f.bytes/1e6).toFixed(1)} Mo`),e.push(await ca(r,o,c,{onStorageFailure:()=>n?.("Neural model storage unavailable; weights will need to be downloaded again.")}))}return n?.("Neuronal WASM · transfert des poids vers le GPU"),s.NeuralRelief.create(e[0],e[1],e[2])})().catch(s=>{throw dr=void 0,s}));const l=await dr;n?.("Neuronal WASM · calcul coarse → base → decoder");const u=await l.generate_json(JSON.stringify(Object.fromEntries(t)),i?JSON.stringify(i):"");try{const s=new Float32Array(u.heights),e=JSON.parse(u.meta),c=Number(t.get("extent")??4e4),f=Number(t.get("resolution")??Math.ceil(c/Number(t.get("sampleSpacing")??30))),d=e.resolution;if(e.extent!==c||e.nativeCellM!==30||e.nativeResolution!==Math.ceil(c/30)||typeof d!="number"||!Number.isInteger(d)||d!==f||s.length!==d*d||e.outputCellM!==c/d||s.some(y=>!Number.isFinite(y)))throw new Error("Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.");return{heights:s,meta:{...e,modelIdentity:ln}}}finally{u.free()}}let cn;async function En(r,t,i,n){cn??=Pt();const{seed:o,width:a,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sketch:y,source:S}=r,k=y?.processing,z=tr(r),x={seed:o,width:a,motifSize:l,relief:u,erosion:s,mountainMix:e,environment:c,zones:f,erosionTuning:d,sampleSpacing:z.requestedSpacing,sourceN:z.n,coastProfile:Ir(r),coastMask:r.coastMask??0,islandMode:r.islandMode??"island",source:S,...k?{sketch:{processing:k},surface:Array.from(Wr(xr(y),z.n))}:{}},g=await(await Fr(t,"/terrain",JSON.stringify({session:cn,settings:x,region:i,field:n}))).arrayBuffer();if(g.byteLength<4)throw new Error("Réponse terrain locale incomplète.");const h=new DataView(g).getUint32(0,!0);if(h%4||4+h>g.byteLength)throw new Error("En-tête terrain local invalide.");const m=JSON.parse(new TextDecoder().decode(new Uint8Array(g,4,h)));let R=4+h;const C={};for(const M of m.arrays){const _=M.count*(M.type==="f32"?4:1);if(!Number.isSafeInteger(M.count)||M.count<0||R+_>g.byteLength)throw new Error("Raster terrain local incomplet.");C[M.name]=M.type==="f32"?new Float32Array(g,R,M.count):new Uint8Array(g,R,M.count),R+=_}const A=C.height,G=m.resolution*m.resolution;if(!Number.isInteger(m.resolution)||m.resolution<64||m.resolution>1024||!A||A.length!==G||!A.every(Number.isFinite)||["normalX","normalY","normalZ"].some(M=>C[M]?.length!==G))throw new Error("Aperçu terrain local invalide.");if(n&&(!Number.isFinite(m.fieldFloor)||!Number.isInteger(m.fieldN)||m.fieldN!==z.n||C.field?.length!==m.fieldN*m.fieldN||!C.field.every(Number.isFinite)||C.physical?.length!==m.fieldN*m.fieldN||!C.physical.every(Number.isFinite)))throw new Error("Surface physique locale incompatible ; reconstruisez et redémarrez le moteur local.");return{session:m.session,x:m.x,y:m.y,width:m.width,resolution:m.resolution,minHeight:m.minHeight,maxHeight:m.maxHeight,globalMinHeight:m.globalMinHeight,globalMaxHeight:m.globalMaxHeight,motifSize:m.motifSize,height:A,normalX:C.normalX,normalY:C.normalY,normalZ:C.normalZ,caveMask:C.caveMask,prepareMs:m.prepareMs,samplingMs:m.samplingMs,generationMs:m.prepareMs+m.samplingMs,generationBackend:"native",generationReason:m.fieldExact?"Rust natif · surface physique conservée":`Rust natif · surface analytique échantillonnée à ${m.fieldN}²`,backend:"native",backendReason:"Échantillonnage Rust natif sur le service local.",coastBackend:"cpu",erosionDefaults:m.erosionDefaults,...C.field?{field:{n:m.fieldN,data:C.field,exact:m.fieldExact,floor:m.fieldFloor,...C.physicalCave?{cave:C.physicalCave}:{}}}:{},...C.physical?{physical:{n:m.fieldN,height:C.physical}}:{},definition:z}}function da(r){if(r.runtime?.profile!=="local")throw new Error("Le sampler natif requiert le profil local.");return En(r.settings,r.runtime,r.region,r.kind==="overview")}async function pa(r,t){const i=await En(r,t,{x:0,y:0,extent:r.width,resolution:64},!0);if(!i.field||i.field.data.length!==tr(r).n**2)throw new Error("Surface physique native absente.");return{height:i.field.data,prepareMs:i.prepareMs??0,samplingMs:i.samplingMs??0,session:i.session,fieldExact:i.field.exact,erosionDefaults:i.erosionDefaults}}const ha="[relief_session_missing]",un=r=>Array.from(r,t=>Number.isFinite(t)?t:null),ma=r=>new Uint8Array(r.buffer,r.byteOffset,r.byteLength);class ur{constructor(t,i){this.runtime=t,this.tuning=i,this.session=Pt(),this.steps=[],this.released=!1}static async build(t,i,n,o){const a=new ur(t,o.slice());return await a.mutate({op:"build",...i},n),a}get min_height(){return this.meta.minHeight??NaN}get max_height(){return this.meta.maxHeight??NaN}source_resolution(){return this.meta.sourceN}erosion_spacing(){return this.meta.erosionSpacing??void 0}sampling_parameters(){return Float64Array.from(this.meta.samplingParameters,t=>t??NaN)}editSurface(t){return this.mutate({op:"edit"},t)}coast(t,i,n,o,a){return this.mutate({op:"coast",mask:t,mode:i,coastProfile:a,surface:!!o,...n?{tuning:un(n)}:{}},o)}carveUnderdark(t,i){return this.mutate({op:"underdark",seed:t,...i})}async sampleRegion(t,i,n,o){const{meta:a,arrays:l}=await this.send({op:"read",region:{x:t,y:i,extent:n,resolution:o}}),u=a.region,s=l.height;if(!u||!s||s.length!==u.resolution*u.resolution)throw new Error("Native relief sample incomplete.");return{x:u.x,y:u.y,width:u.width,resolution:u.resolution,min_height:u.minHeight??NaN,max_height:u.maxHeight??NaN,height:s,cave_mask:l.caveMask,normal_x:l.normalX,normal_y:l.normalY,normal_z:l.normalZ,free(){}}}async physicalHeightField(){return(await this.send({op:"read",physical:!0})).arrays.physical}async samplingBaseField(){return(await this.send({op:"read",base:!0})).arrays.base}async physicalCaveField(){return(await this.send({op:"read",cave:!0})).arrays.physicalCave}async underdarkTunnels(){return(await this.send({op:"read",tunnels:!0})).arrays.tunnels??new Float32Array(0)}free(){this.released||(this.released=!0,this.steps.length=0,Fr(this.runtime,"/release",JSON.stringify({session:this.session})).then(t=>t.arrayBuffer(),()=>{}))}async mutate(t,i){this.meta=(await this.send(t,i)).meta,this.steps.push({header:t,plane:i})}async send(t,i){if(this.released)throw new Error("Native relief engine released.");try{return await this.call(t,i)}catch(n){if(t.op==="build"||!(n instanceof Error)||!n.message.includes(ha))throw n;for(const o of this.steps)await this.call(o.header,o.plane);return this.call(t,i)}}async call(t,i){const n=new TextEncoder().encode(JSON.stringify({session:this.session,tuning:un(this.tuning),...t})),o=new Uint8Array(Math.ceil(n.length/4)*4).fill(32);o.set(n);const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,o.length,!0);const u=await(await Fr(this.runtime,"/terrain/relief",new Blob([a,o,...i?[ma(i)]:[]]))).arrayBuffer();if(u.byteLength<4)throw new Error("Native relief reply incomplete.");const s=new DataView(u).getUint32(0,!0);if(s%4||4+s>u.byteLength)throw new Error("Native relief reply header invalid.");const e=JSON.parse(new TextDecoder().decode(new Uint8Array(u,4,s))),c={};let f=4+s;for(const{name:d,type:y,count:S}of e.arrays){const k=S*(y==="f32"?4:1);if(!Number.isSafeInteger(S)||S<0||f+k>u.byteLength)throw new Error("Native relief plane incomplete.");c[d]=y==="f32"?new Float32Array(u,f,S):new Uint8Array(u,f,S),f+=k}return{meta:e,arrays:c}}}const ga=["plateau","volcano","caldera"],$r=r=>r==="neural-wasm"||r==="neural-python"||r==="neural",va="http://127.0.0.1:8792",ya="http://127.0.0.1:8793";function wa(r,t){const i=r==="neural-python"?ya:va,n=t?.trim().replace(/\/+$/,"");if(!n)return i;try{const o=new URL(n);if(o.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(o.hostname)&&["8792","8793"].includes(o.port)&&o.pathname==="/"&&!o.search&&!o.hash&&!o.username&&!o.password)return i}catch{}return n}const Rn={landScale:1,steps:4,noiseTemperature:.5,noiseTemperatureStd:.5,noisePrecipitation:.5,noisePrecipitationCv:.5,reliefMode:"auto",reliefScale:1,reliefFixed:50,histogram:[0,0,0,0,0],detail:1},xa={flat:20,hills:110,plateau:100},cr=["iterations","incision","incisionSlope","fill","carve","finalCarve","talus","thermal","diffusion","detail","warp","surfaceIterations","surfaceIncision","surfaceCarve","surfaceRouted","surfaceThermal","surfaceDiffusion"],Kr=r=>r.climateValues??di[r.climate??"temperate"];function fn(r){const t=new Float32Array(r.height.length);let i=0,n=0;for(let l=0;l<r.height.length;l++)r.height[l]>0&&(t[n++]=r.height[l],i+=Math.acos(Math.min(1,r.normalZ[l])));const o=t.subarray(0,n).sort(),a=l=>n?o[Math.min(n-1,Math.floor(l*n))]:0;return{p5:a(.05),p50:a(.5),p95:a(.95),slope:i/Math.max(1,n),land:n/Math.max(1,r.height.length)}}let rt,O,fr="",jr="",wr,or="",Br,vr,De,sr=!1,j;const Fe=()=>j??O,Tr=()=>j?j.physicalHeightField():Promise.resolve(O.physical_height_field()),dn=async()=>{if(j)return j.underdarkTunnels().catch(()=>new Float32Array(0));const r=O?.underdark_tunnels;return r?r.call(O):new Float32Array(0)},gt=()=>j?j.samplingBaseField():Promise.resolve(O.sampling_base_field());let rr="",Qe,yr,se,er,Ie="cpu",Le,pn=Promise.resolve(),qe,kr="",Sr="",Ne,Lr,Xr="";async function Nn(){if(!Xr)return;const r=Xr;Xr="";try{await fetch(`${r}/release`,{method:"POST"})}catch{}}let _r,ee,Je;const Mr=new _t;function _a(){Qr(),Ii(),Mr.clear(),wr=void 0,se?.dispose(),se=void 0,er=void 0,O?.free(),O=void 0,j?.free(),j=void 0,fr="",rr="",sr=!1,De=void 0,qe?.dispose(),qe=void 0,ee=void 0,Je=void 0,Ne=void 0,kr="",Sr="",_r=void 0}async function ba(r,t){const i=tr(r),n=Math.ceil(r.width/30),o=(p,g)=>g.extent===r.width&&g.resolution===i.n&&g.nativeCellM===30&&g.nativeResolution===n&&g.outputCellM===r.width/i.n&&p.length===i.n*i.n&&p.every(Number.isFinite),a=wa(r.source,r.neuralServer),l=new URLSearchParams({seed:r.seed,relief:r.relief,mix:String(r.relief==="mixed"?r.mountainMix:.5),coasts:"0",islands:"island",climate:r.climate??"temperate",noise:String(r.fidelity??.05),extent:String(r.width),sampleSpacing:String(i.requestedSpacing),resolution:String(i.n)}),u=Kr(r),s=r.neuralTuning??Rn;for(const[p,g]of Object.entries(u))l.set(p,String(g));l.set("landScale",String(s.landScale)),l.set("steps",String(s.steps)),l.set("detail",String(s.detail));for(const p of["coarseModel","baseModel","decoderModel"])r[p]&&l.set(p,r[p]);for(const p of["noiseTemperature","noiseTemperatureStd","noisePrecipitation","noisePrecipitationCv"])l.set(p,String(s[p]));l.set("histogram",s.histogram.join(","));const e=xa[r.relief];s.reliefMode==="fixed"?l.set("reliefFixed",String(s.reliefFixed)):s.reliefMode==="auto"&&e!==void 0?l.set("reliefFixed",String(e)):l.set("reliefScale",String(s.reliefMode==="scale"?s.reliefScale:1));const c=hi(r.width,r.width,r.neuralFit??"crop",r.neuralSlopes??!0),f=r.zones?{zones:bn(r.zones),region:{x:c.x,y:c.y,width:c.width}}:r.sketch?mi(xr(r.sketch),c):void 0,d=performance.now();if(r.source==="neural-wasm"){if(await Nn(),!r.neuralAssets)throw new Error("Neural browser runtime URL missing.");const p=await fa(r.neuralAssets,l,f,t);if(!o(p.heights,p.meta))throw new Error("Invalid WASM neural surface or physical definition.");return{heights:p.heights,info:{...p.meta,requestMs:performance.now()-d}}}await At();let y=f;if(r.source==="neural-python"){if(r.zones&&(await fetch(`${a}/status`,{cache:"no-store"}).then(m=>m.json())).zoneConditioning!==1)throw new Error("The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.");if(!r.neuralAssets)throw new Error("Neural conditioning runtime URL missing.");const p=await An(r.neuralAssets),g=Object.fromEntries(l);y={params:g,conditioning:JSON.parse(p.conditioning_json(JSON.stringify(g),f?JSON.stringify(f):"")),edited:!!f},t?.("Neural Python · computing with PyTorch/CUDA")}const S={cache:"no-store",...y?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(y)}:{}};let k;if(r.source==="neural")k=await gi({profile:"local",server:a},`/generate?${l}`,S);else try{k=await fetch(`${a}/generate?${l}`,S)}catch{throw new Error(`Neural service unreachable (${a}): run “npm run neural:python” from web/`)}if(!k.ok)throw new Error(`Neural service: ${await k.text()}`);const z=new Float32Array(await k.arrayBuffer()),x=JSON.parse(k.headers.get("X-Neural-Meta")??"{}");if(r.source==="neural-python"&&(Xr=a),f&&(x.edited!==!0||x.sketchRegion!==!0))throw new Error("Outdated neural service: restart it to apply the edited sketch.");if(!o(z,x))throw new Error("Neural service: incomplete surface or mismatched physical definition");return{heights:z,info:{...x,requestMs:performance.now()-d}}}function ka(r){return rt??=(async()=>{li()?(r?.("Loading the Rust/WASM engine (threads)…",{stage:"runtime-download"}),await ci(),r?.("Rust/WASM engine ready",{stage:"runtime-ready"})):await ui(()=>fi(_i,t=>Si({module_or_path:t}),r))})()}wn(()=>{Mr.clear(),rt=void 0,O=void 0,j?.free(),j=void 0,fr="",rr="",sr=!1,qe=void 0,Ne=void 0,kr="",Sr="",_r=void 0,ee=void 0,Je=void 0});function Ma(r,t,i,n){const o=pn.then(()=>hn(r,t,i,n).catch(async a=>{if(!await Xn(a))throw a;return i?.("Rust/WASM threads stopped: continuing on the single-thread engine…",{stage:"runtime-download"}),hn(r,t,i,n)}));return pn=o.catch(()=>{}),o}async function hn(r,t,i,n){const{settings:o,region:a,kind:l,display:u,runtime:s}=r,e=o.islandMode?.startsWith("traced:")&&(o.sketch?.processing||o.relief==="cavern"||o.underdark)?{...o,islandMode:"island"}:o,c=tr(e);if(Zn(e.procedural),e.procedural&&["plateau","volcano","caldera","cavern"].includes(e.relief))throw new Error("The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.");n&&await n.before("prepare"),e.procedural?.erosionTuning&&(e.erosionTuning={...e.erosionTuning,...e.procedural.erosionTuning}),e.climateZone==="wetland"&&(e.erosionTuning={carve:0,finalCarve:0,surfaceCarve:0,...e.erosionTuning});const f=e.compute==="wasm"?"wasm":"gpu-f32",d=e.generationCompute??"gpu-erosion";if(Qn(e,c.n))throw new Error(`GPU generation is limited to ${ei}² cells; requested spacing ${c.spacing.toFixed(2)} m (${c.n}²). Choose CPU or native.`);const y=Ve(e.generalSeed??e.seed,"relief-coast-cut"),S=!!e.generalSeed&&wt(e.generalSeed,w=>w.startsWith("relief-"))!==xn(e.generalSeed),k=tt(e),z=e.hydrology?.compute==="auto"&&(f==="wasm"||d==="cpu")?"cpu":e.hydrology?.compute??"auto";if(z!=="cpu"&&e.hydrology?.enabled&&e.hydrology.engine==="rust"&&Ut(),k&&!e.zones&&!e.sketch?.processing&&(!ri.includes(e.relief)||e.sketch&&!e.drawing))throw new Error("Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.");const x=d==="native"&&!$r(e.source);if(x&&s?.profile!=="local")throw new Error("The native engine requires the Local profile and its Rust service.");if(x&&e.relief==="cavern")return da({...r,settings:e});const p=ga.includes(e.relief)?e.environment??"mixed":"mixed",g=e.sketch?.processing,h=ne(e,"coasts")?e.relief==="cavern"||e.underdark?0:e.coastMask??0:0,m=e.islandMode??"island",R=Ir(e),C=Bi.includes(e.relief),A=f!=="wasm"&&C?Ti(f,e.relief).catch(()=>{}):void 0;rt&&i?.("Reusing the loaded Rust/WASM engine",{stage:"runtime-ready"});try{await ka(i)}catch(w){throw rt=void 0,w}const G=performance.now();A&&i?.("Connecting to the WebGPU device…",{stage:"gpu-device"});const M=A?await Pr(A):void 0;n&&await n.after("prepare");const _=(w,b)=>{const J=De;De={erosionSpacing:w===void 0?J?.erosionSpacing:Math.max(J?.erosionSpacing??0,w),regionalErosionSpacing:b===void 0?J?.regionalErosionSpacing:Math.max(J?.regionalErosionSpacing??0,b)},Object.assign(c,De)},U=async(w,b=!1,J=!1)=>{let H=b&&ne(e,"phasor",!1)?yt(w,e):w;const X=Ft(e),oe=It(e),L=Zr(e);for(const E of["posterior","wind"]){const ae=JSON.stringify([L.get(E),s?.server,!!M,pi(new Uint8Array(H.buffer,H.byteOffset,H.byteLength))]),W=e.procedural?Mr.get(E,ae):void 0;if(W){H=W,n?.cached?await n.cached(E,n.previews===!1?void 0:H):(await n?.before(E),await n?.after(E,n.previews===!1?void 0:H));continue}if(await n?.before(E),E==="posterior"&&e.procedural&&ne(e,E)&&X.mode!=="none"){const D=H,Z=Math.sqrt(H.length);H=(await qt(H,Z,e.width,X,{stats:!1},s)).height;for(let I=0;I<H.length;I++)H[I]=D[I]>0?Math.max(.3,H[I]):H[I]}E==="wind"&&e.procedural&&ne(e,E)&&oe.iterations&&oe.transport&&(H=M?await Ai(M.context,H,e.width,oe):Ci(H,e.width,oe)),e.procedural&&c.n<=1024&&Mr.put(E,ae,H),await n?.after(E,n.previews===!1?void 0:H)}return J?H.map((E,ae)=>w[ae]<=0?w[ae]:Math.max(.3,E)):e.procedural&&H.some(E=>E<.3)?H.map(E=>Math.max(.3,E)):H};let $;const Y=M?Pr(M.pipeline).then(w=>({pipeline:w}),w=>{$=w instanceof Error?w.message:String(w)}):void 0,B=!x&&!e.zones&&!e.sketch&&d!=="cpu"&&f!=="wasm"&&!$r(e.source)&&e.relief!=="cavern",F=B&&M?Wi(M.context,e):void 0;if(F?.error&&e.generationCompute)throw new Error(F.error);const V=e.generationCompute||!F?void 0:F.error??(ti(F)?`Source ${c.n}²: the fixed GPU cost exceeds the estimated CPU compute.`:void 0),he=!!F&&!F.error&&!V,re=B&&Li.includes(e.relief),de=re&&he,ie=(c.n!==1024||!!(e.procedural||n||S))&&!e.sketch&&!e.zones&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief)&&!$r(e.source)&&(!de||d!=="gpu-erosion"),K=!g&&$r(e.source);K||(await At(),await Nn());const Se=s?.profile==="local"&&(x||K),je=e.modification?JSON.stringify([e.modification.resolution,e.modification.width,lt(e.modification.delta)]):"",ve={tunnels:e.underdarkTunnels,caverns:e.underdarkCaverns,lakes:e.hydrology&&Jr(e.hydrology)?0:e.hydrology?.lakeAbundance},we=JSON.stringify([e.zones,je,e.underdark?ve:null,y,x?[s.server,h,m,R]:null,Se?s.server:null])+"|"+JSON.stringify(K?[e.source,e.seed,e.relief,e.relief==="mixed"?e.mountainMix:.5,Kr(e),e.fidelity??.05,e.neuralServer??"",e.sketch,e.neuralTuning??Rn,e.width,c.n,e.coarseModel,e.baseModel,e.decoderModel,e.neuralFit,e.neuralSlopes]:[e.seed,...e.generalSeed?[wt(e.generalSeed,w=>w.startsWith("relief-"))]:[],e.width,c.n,e.relief,e.relief==="cavern"?0:e.erosion,e.motifSize,e.relief==="mixed"?e.mountainMix:.5,x?"native":k?[d,f,!!M]:re?d:"cpu",p,e.sketch,e.erosionTuning??{},...e.procedural?[ni,R,e.procedural,e.climate,e.climateValues,e.climateZone,de?null:[h,m,R]]:[],...k||e.procedural?.enabled?.phasor?[ct,e.climate??"temperate",e.phasor??{}]:[]]);let Pe=0,ze=0,fe=0,Ue=0,_e=0,me;if(n&&n.previews!==!1||!(O||j)||fr!==we){se?.dispose(),se=void 0,er=void 0,O?.free(),O=void 0,j?.free(),j=void 0,sr=!1,fr="",rr="",De=void 0;const w=performance.now();or="",jr="",Br=void 0,vr=void 0,wr=void 0,Ie="cpu",Le=void 0;const b=e.relief==="mixed"?e.mountainMix:.5;Lr=void 0;const J=Float64Array.from(cr,L=>{let E=k&&!e.procedural?NaN:e.procedural?.erosionTuning?.[L]??e.erosionTuning?.[L]??NaN;return e.procedural?.biome&&!de&&!ie&&(L==="incision"||L==="thermal")&&(E=(Number.isFinite(E)?E:1)*(L==="incision"?Rr(e).water:Rr(e).thermal)),E});if(Nr(J),ie){i?.(V?`${V} Rust CPU generation at ${c.spacing.toFixed(2)} m…`:x?"Native Rust · procedural pipeline…":"Rust CPU/WASM · procedural pipeline…",{stage:"terrain-generation"});const L=await U(await zi(e,n,x?s:void 0,de&&M?()=>Yt(M.context,e,i):void 0,(E,ae)=>{De={erosionSpacing:E,regionalErosionSpacing:ae},Object.assign(c,De)}));n&&await n.before("retain"),Se?j=await ur.build(s,{kind:"source",seed:y,width:e.width,relief:e.relief,erosion:e.erosion,motifSize:e.motifSize,mountainMix:b,environment:p},L,J):O=ke.with_source(y,e.width,e.relief,e.erosion,e.motifSize,b,L,p),n&&await n.after("retain",n.previews===!1?void 0:L),Ie=x?"native":de?d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32":k?"compact-cpu":"cpu",Le=V??`${x?"Native":"WASM"} Rust procedural pipeline · stages shared with global generation.`}else if(x){i?.("Native Rust · generating terrain and erosion…",{stage:"terrain-generation",detail:`Local Rust service · computing the ${c.n} × ${c.n} physical field`});const L=e.procedural?.biome?{...e,coastMask:h,erosionTuning:{...e.erosionTuning,incision:(e.erosionTuning?.incision??1)*Rr(e).water,thermal:(e.erosionTuning?.thermal??1)*Rr(e).thermal}}:{...e,coastMask:h},E=await pa(L.sketch&&!g?{...L,sketch:void 0}:L,s),ae=g!=="surface"&&e.procedural&&!e.zones?await U(E.height,!0,h!==0):void 0;j=await ur.build(s,{kind:"surface",seed:y,width:e.width},ae??E.height,J),Ie="native",Le="Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.",_e=E.prepareMs}else if(g){i?.("Preparing the imported heightmap elevations…",{stage:"terrain-import"});const L=Wr(xr(e.sketch),c.n);if(g==="erosion"){i?.("CPU · eroding the imported heightmap…",{stage:"terrain-generation"}),O=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,b,p,c.n),O.set_edited_surface(L);const E=O.sampling_base_field();O.free(),O=ke.with_surface(y,e.width,E)}else O=ke.with_surface(y,e.width,L);Le=g==="erosion"?"Edited heightmap → Rust erosion, without generating new terrain.":"Edited heightmap retained, without generation or erosion."}else if(K){const L=await ba(e,i),E=ii(L.heights,e.width,e.width,e.neuralFit??"crop",e.neuralSlopes??!0);Se?j=await ur.build(s,e.zones?{kind:"zonedSurface",seed:y,width:e.width,motifSize:e.motifSize,zones:e.zones}:{kind:"surface",seed:y,width:e.width},E,J):O=e.zones?ke.with_zoned_surface(y,e.width,e.motifSize,E,JSON.stringify(e.zones)):ke.with_surface(y,e.width,E),Lr=L.info,Ie="neural",e.zones&&(Le="Zones → regional conditioning and local neural relief, then sea operation.")}else if(k&&!e.zones)if(M&&he){i?.("GPU · compact relief, regional erosion and Phasor…",{stage:"terrain-generation"});const L={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:_},E=await U(await Qt(M.context,e,L,i));n&&await n.before("retain"),me=L.profiles,O=ke.with_source(y,e.width,e.relief==="flat"?"hills":e.relief,e.erosion,e.motifSize,b,E,p),n&&await n.after("retain",E),Ie="compact-gpu-f32",Le=`${ct} · compact preset · ${e.procedural?.regionalN??Gt(e).n}² grid · ${e.climate??"temperate"} · Phasor ${ne(e,"phasor",!0)?"enabled":"disabled"}.`}else{i?.("CPU · regional erosion and Phasor…",{stage:"terrain-generation"});const L=e.procedural?.biome?Rr(e):void 0,E=L?{incision:L.water,thermal:L.thermal}:e.procedural?{incision:1,thermal:1}:ai(e),ae=e.procedural?.erosionTuning?.iterations??Gt(e).steps,W=e.erosionTuning??{},D={...W,iterations:ae,surfaceIterations:ne(e,"surface",!1)?W.surfaceIterations??12:0,detail:ne(e,"ridged",!1)?W.detail:0,warp:W.warp??0,incision:(W.incision??1)*E.incision,thermal:(W.thermal??1)*E.thermal};Nr(Float64Array.from(cr,I=>D[I]??NaN));let Z;try{Z=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,b,p,c.n);const I=Z.physical_height_field();O=ke.with_source(y,e.width,"hills",e.erosion,e.motifSize,b,ne(e,"phasor",!0)?yt(I,e):I,p)}finally{Z?.free(),Nr(new Float64Array(cr.length).fill(NaN))}Ie="compact-cpu",Le=`${ct} · Rust CPU + scalar Phasor · ${e.climate??"temperate"}; GPU-independent topography.`}else if(e.zones)i?.("CPU · generating and eroding painted terrain zones…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n} × ${c.n} physical field`}),O=ke.with_zones_at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,b,p,JSON.stringify(bn(e.zones)),c.n),Le="Zone masks → uplift, noise, ridges and Rust erosion.";else if(de&&M)try{if(d==="gpu-erosion"||e.relief==="volcano"||e.relief==="caldera"||e.relief==="plateau"||e.relief==="canyon"){const L={nativeEnvironmentMs:0,profiles:[],control:n,onPhysicalPlan:_},E=await U(await Qt(M.context,e,L,i));n&&await n.before("retain"),_e=L.nativeEnvironmentMs,me=L.profiles,Ue=performance.now()-w-_e,O=ke.with_source(y,e.width,e.relief,e.erosion,e.motifSize,b,E,p),n&&await n.after("retain",E),Ie="gpu-erosion-f32"}else{const L=await Yt(M.context,e,i);ze=performance.now()-w;const E=performance.now();i?.("CPU · eroding the GPU-generated noise…",{stage:"terrain-generation"}),O=ke.with_generation_noise(e.seed,e.width,e.relief,e.erosion,e.motifSize,b,L.coarse,L.fine,p),fe=performance.now()-E,Ie=d==="gpu-all"?"gpu-noise-all-f32":"gpu-noise-f32"}}catch(L){if(n||e.procedural)throw L;Le=`GPU generation unavailable: ${L instanceof Error?L.message:String(L)}`}if(!O&&!j&&(i?.(e.relief==="cavern"?"CPU · generating caverns…":"CPU · generating terrain and erosion…",{stage:"terrain-generation",detail:`Rust/WASM · ${c.n}² physical source at ${c.spacing.toFixed(2)} m`}),O=ke.at_resolution(e.seed,e.width,e.relief,e.erosion,e.motifSize,b,p,c.n),V&&(Le=V)),!g&&!K&&e.sketch&&e.relief!=="cavern"){const L=xr(e.sketch),E=await Tr(),ae=oi(L,E,c.n);j?await j.editSurface(ae):O.set_edited_surface(ae),Le="Edited sketch + procedural detail and Rust erosion."}const H=Ft(e),X=It(e),oe=ne(e,"posterior")&&H.mode!=="none"||ne(e,"wind")&&X.iterations>0&&X.transport>0;if(!ie&&e.procedural&&(oe||!k&&ne(e,"phasor",!1))&&!["gpu-erosion-f32","compact-gpu-f32"].includes(Ie)&&!K&&!g&&!x&&!e.zones){$t(O,h,m,R);const L=O.physical_height_field(),E=await U(L,!k,h!==0);O.free(),O=ke.with_surface(y,e.width,E),sr=!0}e.modification&&(K||g)&&(wr=await gt()),Pe=performance.now()-w,fr=we}else if(i?.("Reusing the previously generated terrain",{stage:"terrain-generation"}),De&&Object.assign(c,De),n?.cached&&e.procedural&&["hills","valley","mountains","mixed","high-mountains","canyon"].includes(e.relief))for(const w of["grids",...Mt(e),"phasor","posterior","wind"])await n.cached(w);const ye=JSON.stringify([we,y,h,m,R,Zr(e).get("coasts"),Ie,s?.server,e.sketch&&[e.sketch.resolution,e.sketch.processing,lt(e.sketch.heights)],e.zones&&[e.zones.resolution,lt(e.zones.weights)]]),Be=!!(e.procedural||K||g)&&!sr&&!(x&&!ie),ge=Be&&h?Mr.get("coasts",ye):void 0;!ge&&n&&await n.before("coasts");const Ce=!K&&!g&&!sr&&!F?.error&&!V&&!e.zones&&!e.sketch&&h!==0&&d!=="cpu"&&f!=="wasm",Ae=JSON.stringify([y,h,h?m:"island",R,h?Ce:!1,e.procedural?.coastIterations,e.procedural?.coastIncision,e.procedural?.coastThermal,e.procedural?.coastDiffusion,e.erosionTuning]);let Oe=0;if(wr&&or&&or!==we+"|"+Ae){if(se?.dispose(),se=void 0,er=void 0,j){const w=j;j=await ur.build(s,{kind:"surface",seed:y,width:e.width},wr,new Float64Array(cr.length).fill(NaN)),w.free()}else O?.free(),O=ke.with_surface(y,e.width,wr);rr="",or="",vr=void 0,Br=void 0,jr=""}if(x&&!ie||sr)rr=Ae,Qe=sr&&h?"cpu":void 0,yr=void 0;else if(rr!==Ae){se?.dispose(),se=void 0,er=void 0,Qe=void 0,yr=void 0;const w=performance.now();i?.("Shaping coastlines and islands…",{stage:"terrain-coast"});const b=e.procedural,J={...e.erosionTuning,...b?.erosionTuning},H=h?Float64Array.from(cr,X=>b&&X==="surfaceIterations"?b.coastIterations??(k?2:12):X==="surfaceIncision"?(J[X]??1)*(b?.coastIncision??1):X==="surfaceThermal"?(J[X]??1)*(b?.coastThermal??1):X==="surfaceDiffusion"?(J[X]??1)*(b?.coastDiffusion??1):J[X]??NaN):void 0;if(j?(await j.coast(h,m,ge?void 0:H,ge,R),h&&(Qe="native")):ge&&(jt(O,h,m,R),O.set_coast_surface(ge),Qe="cpu"),!j&&!ge&&Ce&&M){let X;try{const oe=await Y;if(!oe||M.context.lost)throw new Error($??"WebGPU unavailable");jt(O,h,m,R),X=new Jt(M.context,oe.pipeline,f,O);const L=X.prepareCoastField(e),E=await Yi(M.context,e,L,O.coast_erosion_parameters(),i);O.set_coast_surface(E),Qe="gpu-f32"}catch(oe){yr=`GPU coast unavailable: ${oe instanceof Error?oe.message:String(oe)}`}finally{X?.dispose()}}if(!j&&!Qe){H&&Nr(H);try{$t(O,h,m,R)}finally{H&&Nr(Float64Array.from(cr,X=>J[X]??NaN))}h&&(Qe="cpu"),Ce&&!M&&(yr="WebGPU unavailable")}rr=Ae,Oe=h?performance.now()-w:0,Pe+=Oe}const Ge=h&&Be&&(!ge&&c.n<=1024||n&&n.previews!==!1&&!(ge&&n.cached))?await gt():void 0;if(Ge&&!ge&&c.n<=1024&&Mr.put("coasts",ye,Ge),ge&&n?.cached?await n.cached("coasts",n.previews===!1?void 0:ge):n&&await n.after("coasts",n.previews===!1?void 0:Ge),e.modification&&or!==we+"|"+Ae){const w=Fe().source_resolution(),b=g==="surface"&&!h?Wr(xr(e.sketch),w):await Tr();if(Br={n:w,height:b.slice()},vr=si(b,w,e.modification),se?.dispose(),se=void 0,er=void 0,j){const J=j;j=await ur.build(s,{kind:"surface",seed:y,width:e.width},vr,new Float64Array(cr.length).fill(NaN)),J.free()}else O?.free(),O=ke.with_surface(y,e.width,vr);or=we+"|"+Ae}e.underdark&&jr!==we+"|"+Ae+"|"+or&&(i?.("Underdark · carving caverns and tunnels…",{stage:"terrain-generation"}),se?.dispose(),se=void 0,er=void 0,j?await j.carveUnderdark(e.seed,ve):O.carve_underdark(e.seed,ve.tunnels,ve.caverns,ve.lakes),jr=we+"|"+Ae+"|"+or);let Ee;const pe=async(w,b,J)=>((Ee?.delta!==w||Ee.m!==b||Ee.n!==J)&&(Ee={delta:w,m:b,n:J,out:await ki(w,b,J,s)}),Ee.out);async function nr(w){De?Object.assign(c,De):c.erosionSpacing??=Fe().erosion_spacing(),w.definition=c,n&&await n.after("sampling",w.height),n&&await n.before("hydrology");const b=ne(e,"hydrology")?e.hydrology:void 0;w.neural=Lr,l==="overview"&&!K&&e.relief!=="cavern"&&(w.erosionDefaults=Array.from(vi(e.relief,e.width,e.motifSize,e.mountainMix)));const J=!!b?.enabled&&e.relief!=="cavern",H=b?.engine!=="rust",X=b?.erosionEnabled!==!1,oe=X&&b?.showErosion!==!1,L=X?b?.condMode:"none",E=H&&b&&!Jr(b)?[b.lakeAbundance,b.lakeArea,b.lakeDepth,b.lakeCoverage,b.maxLakeArea]:[0,0,0,0,0],ae=b&&{mode:b.condMode,strength:b.condStrength,maxDepth:b.condDepth,maxLength:b.condLength,banks:b.condBanks,lakes:E[0],lakeArea:E[1],lakeDepth:E[2],lakeCoverage:E[3],maxLakeArea:E[4],...e.climateZone==="wetland"?{undulation:2}:{}};if(t&&b&&J&&l==="overview"&&u==="gl"){const W=Ht(H?b.vectorResolution:b.resolution,c.n),D=JSON.stringify([fr,rr,W,L,L==="none"?0:[b.condStrength,b.condDepth,b.condBanks,b.condLength,E]]);if(!ee||ee.key!==D||H&&!Je){const Z=fn(w);t({...w,height:w.height.slice(),normalX:w.normalX.slice(),normalY:w.normalY.slice(),normalZ:w.normalZ.slice(),caveMask:w.caveMask.slice(),neural:Lr&&{...Lr,land:Z.land},field:await pr(w,!1,H),relief:Z,generationMs:performance.now()-G})}}if(b&&J){const W=Ht(H?b.vectorResolution:b.resolution,c.n),D=JSON.stringify([fr,rr,W,L,L==="none"?0:[b.condStrength,b.condDepth,b.condBanks,b.condLength,E]]),Z=Kr(e),I={riverArea:b.density>0?ia(b,e.width)/Math.max(1,b.density)**2:1e9,density:Math.min(1,b.density),noLakes:Jr(b),headwaters:b.headwaters!==!1?1:0,minRiverLength:b.minRiverLength,lakeDepth:b.lakeDepth,lakeArea:b.lakeArea,riverMode:b.riverMode,flatSlope:b.flatSlope,sinuosity:b.sinuosity,widthScale:b.vectorWidth,balance:b.balance,braiding:b.braiding,anabranching:b.anabranching,terrainInfluence:b.terrainInfluence,avulsions:b.avulsions,confluence:b.confluence,deltas:b.deltas,...e.climateZone==="wetland"?{oxbows:.35}:{}},te=JSON.stringify([D,I,Z.temperature,Z.precipitation,Ve(e.generalSeed??e.seed,"water-hydrology")]);if(!ee||ee.key!==D){ee=void 0,Je=void 0,qe?.dispose(),qe=void 0,Ne=void 0,kr="",Sr="";let le;if(w.x===0&&w.y===0&&w.width===e.width&&w.resolution===W)le=w.height.slice();else if(se&&!se.lost)le=(await se.sample({x:0,y:0,extent:e.width,resolution:W},e,O.min_height,O.max_height)).height;else{const Q=j?await j.sampleRegion(0,0,e.width,W):O.sample_region(0,0,e.width,W);try{le=Q.height}finally{Q.free()}}if(L==="none")ee={key:D,n:W,height:le,m:0};else{i?.("Conditionnement du relief avant drainage…",{stage:"terrain-conditioning"});const Q=ae;if(H){const q=await Dt(le,W,e.width,Q,I,Z,Ve(e.generalSeed??e.seed,"water-hydrology"),s),{height:xe,delta:Xe,...ce}=q.conditioning;ee={key:D,n:W,height:xe,source:le,delta:Xe,m:W,stats:ce},Je={key:te,water:q.water}}else{const q=await qt(le,W,e.width,Q,{stats:!1,drainage:!1},s),{height:xe,delta:Xe,hydrology:ce,...He}=q;ee={key:D,n:W,height:xe,source:le,delta:Xe,m:W,stats:{...He,census:!1},drainage:ce}}}}if(H){if(!Je||Je.key!==te)if(i?.("Vector hydrology · water budget, lakes and streams…",{stage:"terrain-water"}),ee.source){const le=await Dt(ee.source,W,e.width,ae,I,Z,Ve(e.generalSeed??e.seed,"water-hydrology"),s),{height:Q,delta:q,...xe}=le.conditioning;Object.assign(ee,{height:Q,delta:q,stats:xe}),Je={key:te,water:le.water}}else Je={key:te,water:await yi(ee.height,W,e.width,I,Z,Ve(e.generalSeed??e.seed,"water-hydrology"),ee.drainage,s)}}else{const le=JSON.stringify([D,z,Ve(e.generalSeed??e.seed,"water-hydrology")]),Q={...b,showErosion:!0,erosionEnabled:X,...X?{}:{incision:0,depressionPolicy:"fill",maxBreachDepth:0,maxBreachLength:0}},q=`${le}|${JSON.stringify(Q)}`;if(K&&_r?.key===q)w.hydrologyError=_r.message;else try{(!qe||kr!==le)&&(i?.("Rust hydrology · preparing drainage…",{stage:"terrain-drainage"}),qe?.dispose(),qe=void 0,Ne=void 0,Sr="",qe=await Ct.create(Ve(e.generalSeed??e.seed,"water-hydrology"),e.width,W,ee.height.slice(),z,h!==0||(g||K||e.sketch||e.zones?Fe().min_height<=0:!1)),kr=le);const xe=Kr(e),Xe=e.underdark||e.relief==="cavern"?0:e.width/Fe().source_resolution(),ce=JSON.stringify([Q,xe.temperature,xe.precipitation,Xe]);(!Ne||Sr!==ce)&&(i?.("Rust hydrology · rivers, lakes and erosion…",{stage:"terrain-water"}),Ne=qe.generate(Q,xe,Xe),Sr=ce)}catch(xe){if(!K)throw xe;qe?.dispose(),qe=void 0,Ne=void 0,kr="",_r={key:q,message:xe instanceof Error?xe.message:String(xe)},w.hydrologyError=_r.message}}}if(i?.("Application des lits fluviaux et des altitudes finales…",{stage:"terrain-carving"}),J&&oe&&ee?.delta&&!e.underdark&&await wi(w,ee.delta,ee.m,e.width,s),J&&oe&&!H&&Ne&&!w.hydrologyError){const W=performance.now();zn(w,Ne),w.hydrologySurfaceMs=performance.now()-W}if(l==="overview"){const W=Fe().source_resolution(),D=e.underdark?await Tr():vr?.slice()??(g==="surface"&&!h?Wr(xr(e.sketch),W):await Tr());if(J&&oe&&ee?.delta&&!e.underdark){const Z=await pe(ee.delta,ee.m,W);for(let I=0;I<D.length;I++)D[I]+=D[I]<=0?Math.min(0,Z[I]):Z[I]}J&&oe&&!H&&Ne&&!w.hydrologyError&&an({x:0,y:0,width:e.width,resolution:W,height:D,minHeight:w.globalMinHeight,maxHeight:w.globalMaxHeight},Ne),w.physical={n:W,height:D},Br&&(w.modificationBase=Br)}return e.refine&&u!=="gl"&&xi(w,e.width/Fe().source_resolution(),bi(e.seed),e.detailNoise),l==="overview"&&(u==="gl"||r.retainField)&&(i?.("Retaining the physical field and water network…",{stage:"terrain-retain"}),w.field=await pr(w,J,H)),l==="overview"&&J&&(H?w.water=Je?.water:Ne&&!w.hydrologyError&&(w.hydrology=Ne),ee?.delta&&ee.stats&&(w.conditioning={delta:ee.delta,n:ee.m,stats:ee.stats})),l==="overview"&&(w.relief=fn(w)),w.neural&&w.relief&&(w.neural={...w.neural,land:w.relief.land}),w.generationMs=performance.now()-G,n&&await n.after("hydrology",w.height),w}async function pr(w,b,J){const H=Fe().sampling_parameters()[5],X=e.hydrology?.erosionEnabled!==!1&&e.hydrology?.showErosion!==!1;if((H===1||H===4)&&e.relief!=="cavern"){const W=Fe().source_resolution(),D=await gt();if(b&&X&&ee?.delta&&!e.underdark){const le=await pe(ee.delta,ee.m,W);for(let Q=0;Q<W*W;Q++)D[Q]+=D[Q]<=0?Math.min(0,le[Q]):le[Q]}const Z=b&&X&&!J&&!w.hydrologyError?Ne:void 0;Z&&an({x:0,y:0,width:e.width,resolution:W,height:D,minHeight:w.globalMinHeight,maxHeight:w.globalMaxHeight},Z);const I=e.underdark?j?await j.physicalCaveField():O.physical_cave_field():void 0,te=e.underdark?await dn():void 0;return{n:W,data:D,exact:!Z,floor:H===1?.3:0,cave:I?.length?I:void 0,...te?.length?{tunnels:te}:{}}}const oe=Fe().source_resolution(),L=w.physical?.height.slice()??await Tr(),E=e.relief!=="cavern"&&!e.underdark?void 0:j?await j.physicalCaveField():O.physical_cave_field(),ae=e.underdark?await dn():void 0;return{n:oe,data:L,exact:!1,floor:0,cave:E?.length?E:void 0,...ae?.length?{tunnels:ae}:{}}}n&&await n.before("sampling",`Borne du moteur ${Fe().max_height.toFixed(2)} m · aperçu ${a.resolution}²`);let We,ir=0,Ke;if(f!=="wasm"&&C&&!j&&!e.underdark){i?.("Preparing WebGPU terrain sampling shaders…",{stage:"gpu-sampling-compile"});const w=performance.now();try{const b=await Y;M&&b&&!M.context.lost&&((!se||er!==f||se.lost)&&(se?.dispose(),se=void 0,se=new Jt(M.context,b.pipeline,f,O),er=f),ir=performance.now()-w,i?.(`GPU · sampling the terrain ${a.resolution} × ${a.resolution}…`,{stage:"terrain-sampling"}),Ke={...await se.sample(a,e,O.min_height,O.max_height),generationMs:performance.now()-G,prepareMs:Pe,gpuSetupMs:ir,generationBackend:Ie,generationReason:Le,noiseMs:ze,erosionMs:fe,gpuSimulationMs:Ue,nativeEnvironmentMs:_e,erosionProfile:me,coastBackend:Qe,coastMs:Oe,coastReason:yr}),Ke||(We=$?`GPU indisponible : ${$}`:"WebGPU indisponible")}catch(b){We=`GPU indisponible : ${b instanceof Error?b.message:String(b)}`,se?.dispose(),se=void 0,er=void 0}}else j?We="Native Rust sampling on the local service.":f!=="wasm"&&(We="terrain currently sampled in WASM");if(Ke)return nr(Ke);i?.(`${j?"Native Rust":"CPU"} · sampling the terrain ${a.resolution} × ${a.resolution}…`,{stage:"terrain-sampling"});const hr=performance.now(),Re=j?await j.sampleRegion(a.x,a.y,a.extent,a.resolution):O.sample_region(a.x,a.y,a.extent,a.resolution);try{return await nr({x:Re.x,y:Re.y,width:Re.width,resolution:Re.resolution,minHeight:Re.min_height,maxHeight:Re.max_height,globalMinHeight:Fe().min_height,globalMaxHeight:Fe().max_height,motifSize:e.motifSize,height:Re.height,caveMask:Re.cave_mask,normalX:Re.normal_x,normalY:Re.normal_y,normalZ:Re.normal_z,generationMs:performance.now()-G,backend:j?"native":"wasm",backendReason:We,prepareMs:Pe,samplingMs:performance.now()-hr,gpuSetupMs:ir,generationBackend:Ie,generationReason:Le,noiseMs:ze,erosionMs:fe,gpuSimulationMs:Ue,nativeEnvironmentMs:_e,erosionProfile:me,coastBackend:Qe,coastMs:Oe,coastReason:yr})}finally{Re.free()}}export{di as CLIMATE_VALUES,va as DEFAULT_NEURAL_SERVER,Rn as DEFAULT_NEURAL_TUNING,ya as DEFAULT_PYTHON_SERVER,cr as EROSION_SETTINGS,ga as GEOLOGICAL_RELIEFS,xa as NEURAL_RELIEF_DEFAULTS,Kr as climateOf,$r as isNeuralSource,wa as neuralServerForSource,_a as releaseTerrainCheckpoints,fn as reliefStatistics,Ma as sampleRustTerrain};
