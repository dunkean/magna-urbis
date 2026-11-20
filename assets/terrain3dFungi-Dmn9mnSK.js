import{bC as Ce,bD as ye,bE as qe,bF as Ge,bG as je,bH as Ke,bI as We,bJ as Ve,l as Xe,bK as Ye,u as Je,bL as $e,bM as Qe,bN as Ze,bO as et,bP as tt,bQ as ot,bR as nt,bS as at,bT as st,bU as fe,bV as x,bW as Ae,bX as it,bY as rt,bZ as ct}from"./studio-DupFl5hx.js";import{m as lt,aD as ft,ac as ut,aE as ce,aF as le}from"./__vite-browser-external-B9QZ-9L0.js";import{M as ht}from"./rendererOverride-V0gmOEo-.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function dt(e){const t=new Uint8Array(e.length),a=new Map;for(let s=0;s<e.length;s++){const{surface:c,normal:i,points:f,material:v,materials:k}=e[s];if(c!=="roof"||i[2]<=.001||/^city3d:(wall|tree|road|water)/.test(v??k.cladding))continue;const p=f.map(F=>F.map(u=>Math.round(u*1e3)).join(",")),y=Math.hypot(...i);t[s]=7;for(let F=0;F<3;F++){const u=p[(F+1)%3],E=p[(F+2)%3],H=1<<F,W=u<E?`${u}|${E}`:`${E}|${u}`,$=a.get(W);if(!$){a.set(W,{face:s,bit:H});continue}const U=e[$.face].normal;(i===U||i[0]*U[0]+i[1]*U[1]+i[2]*U[2]>=.99999*y*Math.hypot(...U))&&(t[$.face]&=~$.bit,t[s]&=~H)}}return t}const be=10;function mt(e){const t=[1/0,1/0,e.ground_z_m,-1/0,-1/0,e.ground_z_m+Ce(e)],a=ye(e)?[]:e.structural_features;for(const s of[e.footprint,e.roof_footprint,...a.map(c=>c.surface)])for(const c of s)for(const i of c.outer)t[0]=Math.min(t[0],i.x),t[1]=Math.min(t[1],i.y),t[3]=Math.max(t[3],i.x),t[4]=Math.max(t[4],i.y);if(!ye(e))for(const s of[...e.volumes.map(c=>c.foundation),...e.structural_foundations??[]])s&&(t[2]=Math.min(t[2],s.z_min_m));for(const s of a)t[2]=Math.min(t[2],s.z_m),t[5]=Math.max(t[5],s.z_m+s.height_m);for(const s of a)for(const c of s.vertices3d){const i=[c.x,c.y,c.z];for(let f=0;f<3;f++)t[f]=Math.min(t[f],i[f]),t[f+3]=Math.max(t[f+3],i[f])}return t}const Re=e=>/^city3d-(wall|bridge|quay|harbour)/.test(e.id)||!Number.isFinite(e.ground_z_m)?1/0:e.ground_z_m,gt=(e,t,a,s,c,i,f)=>{f[0]=c,f[1]=i??Math.min(c,t)},vt=(e,t)=>e+(t===void 0?0:64*Math.max(1,Math.min(15,Math.round(t*15))));function ne(e){return e.startsWith("rgb")?e.match(/[\d.]+/g).slice(0,3).map(Number).map(t=>t/255):[1,3,5].map(t=>parseInt(e.slice(t,t+2),16)/255)}function pt(e){const t=/^city3d:(cover|wall|road):(.+)$/.exec(e??"");return t?t[1]==="cover"?Qe(t[2]):t[1]==="wall"?Ze(t[2]):$e.road[t[2]]??-1:-1}const wt={tile:1,pantile:2,glazed:3,slate:4,slab:5,paving:6,thatch:7,reed:8,palm:9,turf:10,shingle:11,bark:12,bamboo:13,earth:14,lime:15,metal:16,felt:17,hide:18},yt={plaster:19,timber:20,wood:21,brick:22,stone:23,earth:24,wattle:25,bamboo:26,coral:27,hide:18,ashlar:29,concrete:30,glass:31,steel:16},bt=28,xt=32,ge=new Map,ve=new Map;function kt(e){let t=ge.get(e);return t===void 0&&(ge.size>4096&&ge.clear(),ge.set(e,t=/^city3d:(cover|wall):([a-z]+)$/.exec(e))),t}function Mt(e){const t=e??"";let a=ve.get(t);return a===void 0&&(ve.size>4096&&ve.clear(),ve.set(t,a=/@([0-9a-f]{6}|[0-9a-f]{3})$/.exec(t))),a}function _t(e,t,a){const s=kt(e??"");if(!s)return 0;if(s[1]==="wall")return yt[s[2]]??0;const c=et(s[2],Math.abs(t[2])>.995*(Math.hypot(t[0],t[1],t[2])||1),a);return c?wt[c]:0}function It(e,t,a){if(a<0)return[0,0];const s=tt(a),c=t[0],i=t[1],f=Math.abs(t[2]),v=Math.hypot(c,i);if(f<.3&&v>1e-6)return[(e[0]*-i+e[1]*c)/v/s,-e[2]/s];if(v<.02)return[e[0]/s,e[1]/s];const k=c/v,p=i/v;return[(-e[0]*p+e[1]*k)/s,(e[0]*k+e[1]*p)/Math.max(f,.2)/s]}const xe=new Float64Array(2);function pe(e,t,a,s,c,i,f=gt){const v=a.appearance,k=new Map,p=!!v.textured,y={materials:a.materials};for(const u of e){const E=new Map,H=u.culture?.culture??"";let W=2166136261;for(let d=0;d<u.id.length;d++)W=Math.imul(W^u.id.charCodeAt(d),16777619);const $=Math.round((W>>>0)/4294967295*15)/15,U=u.programme,Z=`${U?.role??""}${U?.landmark?" monument":""}`,V=Re(u),X=Number.isFinite(V)&&!u.id.startsWith("city3d-"),Y=a.roofInk&&X&&v.diagnostic==="none",se=a.look&&!p&&v.diagnostic==="none"?a.look.item(u.id):void 0;let ie,ee,te;const de=(d,oe=0,A=0)=>{const o=d.material??(d.surface==="roof"?d.materials.cladding:d.materials.coating),n=Mt(o),h=n?o.slice(0,n.index):o,r=se&&d.surface!=="yard"?Ke(d.materials):void 0;let l;if(r&&d.surface==="roof"&&h?.startsWith("city3d:cover:")){if(d.normal!==ie||d.materials!==ee){const b=We(a.look.frame,se,{...r,normal:d.normal});te={color:ne(b.color),gain:b.gain,family:b.family},ie=d.normal,ee=d.materials}l=te}const N=!!r&&o===d.materials.coating,_=X&&(v.roof==="minimal"||v.roof==="flat"&&d.surface==="roof"),z=p&&!_&&!A&&d.surface!=="yard"?pt(h??(d.surface==="roof"?d.materials.cladding:d.materials.coating)):-1;let w=E.get(d.surface);w||E.set(d.surface,w=new Map);let m=l?.color??w.get(String(o));if(!m&&N&&(m=ne(Ve(a.look.frame,se,r)),w.set(String(o),m)),!m){const b=Xe(d.materials,u.function,Ce(u),v,h,y);if(m=ne(d.surface==="roof"?b.roof:b.wall),v.diagnostic==="none"||d.surface==="yard"){if(n?.[1].length===6)m=ne(`#${n[1]}`);else if(n)m=m.map((B,K)=>Math.min(1,B*parseInt(n[1][K],16)/8));else if(H&&!u.id.startsWith("city3d-")){const B=He=>/(?:^|[:/_-])(timber|wood|brick|stone|earth|plaster|bamboo|wattle|hide|coral|tile|slate|thatch|reed|palm|shingle|bark|turf|felt|snow|metal|lead)(?:$|[:/_-])/.exec(He)?.[1]??"",K=B(d.materials.coating||d.materials.infill),re=B(d.materials.cladding),Fe=Ye(H,K,re,$,Z+(/tower|minaret|stone/.test(h)?" monument":""));m=d.surface==="roof"?Fe.roof:Fe.wall}}d.surface==="roof"&&v.diagnostic==="none"&&v.colors?.building&&(m=ne(v.colors.building));const T=/^city3d:tree:(crown|trunk)$/.exec(h??"");T&&(m=ne(n?.[1].length===6?`#${n[1]}`:T[1]==="crown"?"#5f8247":"#4b5a36")),h==="city3d:water"&&(m=ne("#"+(n?.[1]??"8aaeb8"))),w.set(String(o),m)}A&&(m=Je(m,A,-(d.normal[0]+d.normal[1])*.4));const L=v.diagnostic==="none"&&(!!v.colors?.building&&d.surface==="roof"||n?.[1].length===6||!!H&&!u.id.startsWith("city3d-")),I=!p&&!_&&d.surface!=="yard"&&v.style==="cartographic"&&v.diagnostic==="none"?A>=.4?bt:l?l.family:_t(h,d.normal,H):0,G=(1+vt(h==="city3d:wall:lit"?xt:I,l?.gain)/32)/(Math.hypot(d.normal[0],d.normal[1],d.normal[2])||1),P=p?`${m.join(",")}|${z}|${L}|${!!A}`:A?"vertex-colour|true":"vertex-colour|false";let S=k.get(P);if(!S){const b=$e.layers[z]?.mean_rgb,B=b&&L?m.map((K,re)=>K/Math.max(.04,b[re]/255)):n?.[1].length===3?[...n[1]].map(K=>parseInt(K,16)/8):[1,1,1];S={batch:{color:p?m:[1,1,1],tint:B,recolored:L,vcolor:!p,palette:[],stride:be,data:new Float32Array(4096)},length:0,seen:a.collectPalette===!1?void 0:new Set},k.set(P,S)}const C=S.batch,O=d.points;if(S.seen&&(A||!S.seen.has(m))&&(A||S.seen.add(m),C.palette.some(b=>b[0]===m[0]&&b[1]===m[1]&&b[2]===m[2])||C.palette.push(m)),S.length+O.length*be>C.data.length){const b=new Float32Array(Math.max(C.data.length*2,S.length+O.length*be));b.set(C.data.subarray(0,S.length)),C.data=b}const R=C.data;let M=S.length;for(let b=0;b<O.length;b++){const T=O[b];f(u,V,T[0],T[1],T[2],d.ground?.[b],xe),R[M++]=T[0]-t[0],R[M++]=xe[0],R[M++]=T[1]-t[1],R[M++]=d.normal[0]*G,R[M++]=d.normal[2]*G,R[M++]=d.normal[1]*G;const B=oe&~(1<<b);if(p){const[K,re]=It(T,d.normal,z);R[M++]=K,R[M++]=re,R[M++]=z+B/8}else R[M++]=B&1?-m[0]:m[0],R[M++]=B&2?-m[1]:m[1],R[M++]=B&4?-m[2]:m[2];R[M++]=xe[1]}S.length=M},D=v.style!=="silhouette"&&v.diagnostic==="none"?lt(a.snowAltitudes.get(u.id)??u.ground_z_m,v.roofSnow):0,me=D?qe(u.function):0,J=(d,oe=0)=>{const A=d.material??d.materials.cladding,n=D&&d.surface==="roof"&&!/^city3d:(wall|tree|road|water)/.test(A)&&!u.id.startsWith("city3d-")?je(d.normal,-(d.normal[0]+d.normal[1])*.4,me,/^city3d:cover:([a-z]+)/.exec(A)?.[1]):0;de(d,oe,D*Math.round(n*8)/8)};if(Y){const d=[];Ge(u,A=>d.push(A),s,c,i);const oe=dt(d);d.forEach((A,o)=>J(A,oe[o]))}else Ge(u,J,s,c,i)}const F=[];for(const{batch:u,length:E}of k.values())E&&(u.data=u.data.slice(0,E),F.push(u));return F}const ue=256,q=4,Ee=ue/q,St=64,ke=[0,0];function Nt(e,t,a,s,c){const i=Re(e);if(Number.isFinite(i)){c[0]=(i+Math.min(0,t[2]-i))*s,c[1]=i*s+Math.max(0,t[5]-i);return}c[0]=1/0,c[1]=-1/0;for(let f=0;f<4;f++){const v=a.heightAt(t[f&1?3:0],t[f&2?4:1]);c[0]=Math.min(c[0],v-1),c[1]=Math.max(c[1],v+(t[5]-t[2]))}}class Xt{constructor(t,a,s){this.scene=t,this.relief=a,this.exaggeration=s}blocks=[];altitudes=new zt;byKey=new Map;next=0;step(t){const a=this.scene.buildings,s=this.relief,c=this.exaggeration;for(;this.next<a.length;){const i=a[this.next++],f=mt(i),v=(f[0]+f[3])/2,k=(f[1]+f[4])/2,p=nt(i),y=[Math.floor(v/ue)*ue,Math.floor(k/ue)*ue],F=`${y}${p?"/yard":""}`;let u=this.byKey.get(F);if(u||(this.byKey.set(F,u={origin:y,buildings:[],yard:p,width:0,minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0,low:1/0,high:-1/0,levels:3,cells:new Int32Array(q*q+1),cellOf:[]}),this.blocks.push(u)),u.buildings.push(i),u.cellOf.push(Math.min(q-1,Math.floor((v-y[0])/Ee))+q*Math.min(q-1,Math.floor((k-y[1])/Ee))),this.altitudes.add(i),u.width+=p?1:Math.max(1,Math.min(f[3]-f[0],f[4]-f[1])),u.minX=Math.min(u.minX,f[0]),u.minY=Math.min(u.minY,f[1]),u.maxX=Math.max(u.maxX,f[3]),u.maxY=Math.max(u.maxY,f[4]),Nt(i,f,s,c,ke),u.low=Math.min(u.low,ke[0]),u.high=Math.max(u.high,ke[1]),this.next%St===0&&performance.now()>t)return!1}if(this.next===a.length){for(const i of this.blocks){i.width/=i.buildings.length;const f=i.cellOf,v=i.cells,k=new Array(f.length);for(const y of f)v[y+1]++;for(let y=0;y<q*q;y++)v[y+1]+=v[y];const p=v.slice(0,q*q);for(let y=0;y<f.length;y++)k[p[f[y]]++]=i.buildings[y];for(let y=0;y<k.length;y++)i.buildings[y]=k[y];i.cellOf=void 0}this.next++}return!0}}function Yt(e,t){const a=t>0?1/t:1;return(s,c,i,f,v,k,p)=>{if(k===void 0&&Number.isFinite(c)){p[0]=v>=c?v-c:(v-c)*t,p[1]=c*t;return}const y=e.heightAt(i,f);p[0]=v-(k??y*a),p[1]=y}}class zt{towns=new Map;owners=new Map;add(t){const a=t.parcel_id?.split("/")[0],s=a?.startsWith("layout-")?a:t.id;let c=this.towns.get(s);c||this.towns.set(s,c={sum:0,count:0}),Number.isFinite(t.ground_z_m)&&(c.sum+=t.ground_z_m,c.count++),this.owners.set(t.id,s)}get(t){const a=this.owners.get(t),s=a===void 0?void 0:this.towns.get(a);return s?s.count?s.sum/s.count:0:void 0}}function Jt(e,t,a,s){return{appearance:{...t,textured:!1,ambience:void 0,lightsOn:void 0},materials:e.materials??[],collectPalette:!1,roofInk:t.roof==="v1",snowAltitudes:a,look:s}}function Qt(e,t,a,s,c,i){const f=e.buildings.slice(c,i);if(e.yard)return Me(pe(f,e.origin,a,t>0,void 0,t,s).map(u=>u.data));if(t!==Ne)return Me(pe(f,e.origin,a,t>0,void 0,void 0,s).map(u=>u.data));const v=a.appearance.roof==="minimal",k=u=>Lt(u)&&(!v||u.id.startsWith("city3d-")),p=f.filter(k),y=p.length?f.filter(u=>!k(u)):f,F=[...pe(y.map(u=>Ct(u,v)),e.origin,a,!0,void 0,void 0,s),...p.length?pe(p,e.origin,a,!1,void 0,void 0,s):[]];return Me(F.map(u=>u.data))}function Me(e){if(e.length===1)return e[0];let t=0;for(const c of e)t+=c.length;const a=new Float32Array(t);let s=0;for(const c of e)a.set(c,s),s+=c.length;return a}const Ne=2,Be=e=>e.levels,Lt=e=>!ye(e)&&e.volumes.some(t=>t.envelope==="open");function Ct(e,t=!1){if(!Number.isFinite(Re(e))||t&&e.id.startsWith("city3d-"))return e;const a=t||!e.roof_footprint.length?e.footprint:e.roof_footprint;return ye(e)?a===e.roof_footprint?e:{...e,roof_footprint:a}:e.volumes.length?{...e,roof_footprint:a,projection:"native-building-visual-1",height_m:Ce(e),materials:e.volumes[0].materials,volumes:void 0,structural_features:void 0,structural_foundations:void 0}:e}const Pe=[10,6,3],Rt=.25;function Ft(e,t,a=0,s=1/0){const c=Be(e);if(t<Rt*(a===c?1.15:1))return c;const i=s<(a===0?.85:1)?1:0;return Math.max(i,ot(t,a))}function Zt(e,t,a=!1,s=1,c=!1){const i=Be(e);if(e.yard)return Ft(e,t);for(let f=a==="overview"?1:a?Ne:0;f<Pe.length;f++)if(t*s>=Pe[f])return f;return c||s>=ft?Ne:i}const Gt=`
float baseOcclusion(vec3 normal,vec3 p){
  if(abs(normalize(normal).y)>.5||p.y<-1000.)return 1.;
  return mix(.72,1.,smoothstep(0.,2.4,p.y));
}
uniform int uNight;
${ht}
${at}
// Night: moonlight on every face; the mesh's own lit windows (LIT_CLASS faces, p on the facade in metres) glow,
// fading out once a window is no longer resolved (from .45 to 1.2 m per pixel).
vec3 buildingNight(vec3 color,vec3 p,bool lit){
  if(uNight==0)return color;
  color=moonlight(color);
  if(!lit||uNight==2)return color;
  return mix(color,vec3(1.,.61,.22),.93*(1.-smoothstep(.45,1.2,length(fwidth(p)))));
}
// Underdark: no sky. The town's own lanterns light it (warm, dimmed by the darkness), its lit openings glow, and
// far buildings dissolve into the cave's darkness like the ground. uCave: on, light, fog start and end (m); uCaveEye: x, z, height.
uniform vec4 uCave; uniform vec3 uCaveEye;
vec3 buildingCave(vec3 color,vec3 p,bool lit,vec3 N){
  if(uCave.x<.5)return color;
  // No sky: roofs (faces turned up) get only the lanterns' side light, darker than the walls.
  color*=vec3(1.,.84,.66)*uCave.y*mix(1.,.5,smoothstep(.45,.8,normalize(N).y));
  if(lit&&uCave.x<1.5)color=mix(color,vec3(1.,.64,.28),.9*(1.-smoothstep(.45,1.2,length(fwidth(p)))));
  vec2 d=p.xz-uCaveEye.xy;
  return mix(color,vec3(.005,.005,.007),smoothstep(uCave.z,uCave.w,sqrt(dot(d,d)+uCaveEye.z*uCaveEye.z)));
}
`,At=`
float grainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float grainNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(grainHash(i),grainHash(i+vec2(1.,0.)),f.x),mix(grainHash(i+vec2(0.,1.)),grainHash(i+vec2(1.,1.)),f.x),f.y)*2.-1.;
}
float grainKeep(float wavelength,float fp){return 1.-smoothstep(.12,.3,fp/wavelength);}
// Dark band over the last share w of a cell, minus its mean.
float grainJoint(float f,float w){return smoothstep(1.-w,.98,f)-(.01+.5*w);}
vec3 materialGrain(vec3 color,float cls,vec3 N,vec3 p,float fp){
  // Past a metre per pixel no unit is resolved: far buildings pay nothing.
  if(cls<.5||fp>1.)return color;
  // Face coordinates in metres: x along the ridge or the wall; y down the slope of a pitched or flat face, up a
  // vertical one (walls, gables, the foot of a dome).
  float h=length(N.xz);
  vec2 d=vec2(1.,0.);
  if(h>.02)d=N.xz/h;
  vec2 q=vec2(dot(p.xz,vec2(-d.y,d.x)),p.y);
  if(N.y>.3)q.y=dot(p.xz,d)/N.y;
  // cw: one unit along and across the courses (m), then the width of the course and column joints as a share of it;
  // k: course joint, column joint, unit tone, soft term; run: scale (m) of the soft term along x and y; bond: shift of
  // every other course (broken bond), none where ribs, canes, seams or posts run through.
  int c=int(cls+.5);
  vec4 cw=vec4(.2,.4,.2,.12),k=vec4(.035,.012,.035,0.);vec2 run=vec2(1.);float bond=.5;                          // plain clay tiles: courses
  if(c==2){bond=0.;cw=vec4(.2,.4,.15,.35);k=vec4(.012,.035,.035,0.);}                                       // half-round tiles: ribs
  else if(c==3){bond=0.;cw=vec4(.2,.4,.12,.35);k=vec4(.006,.04,.012,0.);}                                   // glazed tiles: even ribs
  else if(c==4){cw=vec4(.25,.22,.15,.1);k=vec4(.03,.012,.02,0.);}                                   // slates
  else if(c==5){cw=vec4(.55,.4,.15,.1);k=vec4(.04,.03,.04,0.);}                                     // stone slabs, dressed courses
  else if(c==6){cw=vec4(.7,.7,.07,.07);k=vec4(.035,.035,.03,0.);}                                   // paved terrace
  else if(c==7){cw=vec4(.08,1.5,.12,.3);k=vec4(.02,0.,.03,.03);run=vec2(.12,1.2);}                  // straw thatch: strands, ledges
  else if(c==8){cw=vec4(.05,2.,.1,.3);k=vec4(.006,0.,.02,.015);run=vec2(.08,1.6);}                  // reed: fine, smooth
  else if(c==9){cw=vec4(.35,.8,.3,.2);k=vec4(.05,.012,.03,.02);run=vec2(.1,.5);}                    // palm fronds: shaggy rows
  else if(c==10){cw=vec4(.4,.4,.1,.1);k=vec4(0.,0.,0.,.05);run=vec2(.3);}                           // turf: clumps
  else if(c==11){cw=vec4(.14,.3,.2,.12);k=vec4(.035,.012,.04,0.);}                                  // shingles
  else if(c==12){cw=vec4(1.4,.8,.08,.06);k=vec4(.035,.03,.03,.012);run=vec2(.5,.07);}               // bark sheets
  else if(c==13){bond=0.;cw=vec4(.1,2.2,.05,.35);k=vec4(.012,.04,.02,0.);}                                  // split bamboo canes
  else if(c==14){cw=vec4(.9,.9,.1,.1);k=vec4(0.,0.,0.,.045);run=vec2(.5);}                          // earthen terrace: stains
  else if(c==15){cw=vec4(.9,.9,.1,.1);k=vec4(0.,0.,0.,.02);run=vec2(.6);}                           // lime, plaster domes
  else if(c==16){bond=0.;cw=vec4(.6,2.4,.03,.08);k=vec4(.02,.05,.012,0.);}                                  // lead, copper: seams, laps
  else if(c==17){bond=0.;cw=vec4(1.5,.8,.08,.05);k=vec4(.03,.025,0.,.012);run=vec2(.4);}                    // felt: strips, girth ropes
  else if(c==18){cw=vec4(1.4,1.3,.05,.05);k=vec4(.03,.03,.03,0.);}                                  // stitched hides
  else if(c==19){cw=vec4(.9,.9,.1,.1);k=vec4(0.,0.,0.,.025);run=vec2(.3,2.2);}                      // plaster wall: rain streaks
  else if(c==20){bond=0.;cw=vec4(1.2,2.8,.06,.11);k=vec4(.05,.05,0.,.012);run=vec2(.3,2.2);}                // timber frame: posts, rails
  else if(c==21){cw=vec4(2.4,.25,.18,.04);k=vec4(.035,.012,.03,.01);run=vec2(1.2,.06);}             // boards, logs
  else if(c==22){cw=vec4(.22,.075,.2,.1);k=vec4(.025,.01,.035,0.);}                                 // brick
  else if(c==23){cw=vec4(.5,.3,.15,.1);k=vec4(.04,.02,.04,0.);}                                     // stone courses
  else if(c==24){cw=vec4(.4,.14,.2,.1);k=vec4(.015,0.,.012,.03);run=vec2(.35,2.2);}                 // adobe, rammed earth: eroded
  else if(c==25){cw=vec4(.5,.9,.1,.1);k=vec4(0.,.012,.02,.03);run=vec2(.4);}                        // wattle and daub
  else if(c==26){bond=0.;cw=vec4(.1,2.2,.05,.35);k=vec4(.012,.04,.02,0.);}                                  // bamboo wall: upright canes
  else if(c==27){cw=vec4(.4,.3,.15,.1);k=vec4(.015,.01,.03,.02);run=vec2(.5);}                      // coral rag under lime
  else if(c==28){cw=vec4(.9,.9,.1,.1);k=vec4(0.,0.,0.,.03);run=vec2(.6);}                             // snow: a faint even grain, the same on every roof
  else if(c==29){cw=vec4(.9,.45,.06,.05);k=vec4(.03,.02,.025,0.);}                                   // ashlar: large dressed courses
  else if(c==30){bond=0.;cw=vec4(1.2,2.6,.03,.03);k=vec4(.012,.012,.01,.03);run=vec2(.5,2.2);}       // concrete: formwork panels, stains
  else if(c==31){bond=0.;cw=vec4(1.5,3.2,.05,.06);k=vec4(.05,.05,.012,0.);}                          // glass: mullion grid
  // Weathering once the units are no longer resolved: w.x its strength, w.yz its stretch along and down the face.
  vec3 w=vec3(.035,1.,1.);                                                                               // fired clay, stone, earth, hides: speckle
  if(c==3||c==16||c==17)w=vec3(.014,1.,2.5);                                                             // glazed tiles, metal, felt: even
  else if(c==4||c==15||c==19||c==22)w=vec3(.02,1.,1.);                                                   // slate, lime, plaster, brick: little
  else if(c==7||c==9||c==11||c==24)w=vec3(.035,.4,2.5);                                                  // straw, fronds, shingles, eroded earth: streaks down
  else if(c==8||c==13||c==26)w=vec3(.02,.3,3.);                                                          // reed, canes: fine streaks down
  else if(c==10)w=vec3(.05,1.,1.);                                                                       // turf: clumps
  else if(c==12||c==21)w=vec3(.03,2.5,.4);                                                               // bark sheets, boards, logs: along
  else if(c==29)w=vec3(.02,1.,1.);                                                                       // ashlar: little
  else if(c==31)w=vec3(.008,1.,1.);                                                                      // glass: smooth
  else if(c==28)w.x=0.;                                                                                  // snow keeps its own drifts
  float row=floor(q.y/cw.y);
  vec2 u=vec2(q.x/cw.x+bond*mod(row,2.),q.y/cw.y),f=fract(u);
  float keepRow=grainKeep(cw.y,fp),keepColumn=grainKeep(cw.x,fp);
  float g=-k.x*grainJoint(f.y,cw.z)*keepRow-k.y*grainJoint(f.x,cw.w)*keepColumn;
  g+=k.z*(grainHash(floor(u)+cls*17.)*2.-1.)*min(keepRow,keepColumn);
  g+=k.w*grainNoise(q/run+cls)*grainKeep(min(run.x,run.y),fp);
  // Two octaves around six pixels, cross-faded: the tone of groups of units, as fine as the pixel at every distance.
  float level=log2(max(fp,.002)*6.),lo=floor(level);vec2 s=q/w.yz;
  g+=w.x*(1.-min(keepRow,keepColumn))*(1.-smoothstep(.5,1.,fp))*mix(grainNoise(s*exp2(-lo)+cls*3.7),grainNoise(s*exp2(-lo-1.)+cls*9.1),level-lo);
  return color*(1.+g);
}
`,Et=`
float roofInk(vec3 edge, vec3 gx, vec3 gy, float dpr){
  vec3 ex=dFdx(edge),ey=dFdy(edge);
  vec3 edgePixel=sqrt(ex*ex+ey*ey);
  float reach=.5*dpr;
  if(all(greaterThanEqual(edge,edgePixel*(reach+.5))))return 0.;
  vec3 d=edge/max(edgePixel,vec3(1.e-6));
  float mpp=sqrt(max(dot(gx.xz,gx.xz),dot(gy.xz,gy.xz)))*dpr;
  return (1.-smoothstep(max(0.,reach-.5),reach+.5,min(d.x,min(d.y,d.z))))*.65*(1.-smoothstep(1.5,4.,mpp));
}
`,eo=`#version 300 es
precision highp float;
precision highp int;
// Block-local x, height above the seat (m), block-local y; the normal in the 3D view's frame (x, up, y south) with the
// material class on its length; the colour; the terrain height under the building, metres as drawn at full relief.
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 albedo;
layout(location=4) in float seat;
uniform mat4 uProjection;
// Block origin relative to the target (x, y) and minus the target's height.
uniform vec3 uBlock;
uniform float uRise;
uniform bool uTop;
uniform float uRoofInkDpr;
// Eye relative to the target.
uniform vec3 uEye;
out vec3 n; out vec3 base; out vec3 facadePosition; out vec3 grainPosition; flat out float materialClass; flat out float townGain; out float vDistance;
out vec3 roofEdge;
void main(){
  n=normalize(normal);base=uRoofInkDpr>0.?abs(albedo):albedo;
  // Inspect the bits directly so black channels can carry a negative zero.
  roofEdge=uRoofInkDpr>0.?vec3(greaterThanEqual(floatBitsToInt(albedo),ivec3(0))):vec3(1.);
  // The normal's length carries 1 + code / 32 (buildingsMesh.ts faceCode): the material class, plus 64 x the grain gain
  // in sixteenths of a face the town look painted (0: not painted). Block-local metres keep the grain's hashes exact.
  float code=floor((length(normal)-1.)*32.+.5),painted=floor(code/64.);
  materialClass=code-64.*painted;townGain=painted/15.;
  grainPosition=position;facadePosition=position;
  vec3 world=vec3(uBlock.xy+position.xz,(seat+position.y)*uRise+uBlock.z);
  vDistance=length(world-uEye);
  gl_Position=uProjection*vec4(world,1.);
  // Orthographic plan pixels ignore height; the depth buffer still chooses the uppermost roof.
  if(uTop) gl_Position.z=clamp(-(seat+position.y)*.00001,-.95,.95);
}`,to=`#version 300 es
precision highp float;
in vec3 n; in vec3 base; in vec3 facadePosition; in vec3 grainPosition; flat in float materialClass; flat in float townGain; in float vDistance;
in vec3 roofEdge; uniform float uRoofInkDpr;
// Haze distance (m) and share; haze colour.
uniform vec2 uAir;
uniform vec3 uHaze;
out vec4 color;
${Gt}
${At}
${st}
${Et}
void main(){
  vec3 N=normalize(n);
  vec3 gx=dFdx(grainPosition),gy=dFdy(grainPosition);
  float fp=length(abs(gx)+abs(gy));
  // Class 32 marks a lit window (no grain of its own).
  bool lit=materialClass>31.5;float cls=lit?0.:materialClass;
  vec3 rgb;
  if(townGain>0.){
    // A roof face painted by the top view's town look: its colour holds the light of its slope and the ambience
    // (volumeRoofPaint); the grain marks of its cover family are the top view's, the snow class keeps its own.
    rgb=cls>.5&&cls<18.5?coverGrainMarks(base,cls,N,grainPosition,townGain):materialGrain(base,cls,N,grainPosition,fp);
  }else if(uCave.x>.5){
    // Underdark: no sky. The town's lanterns light the walls (warm, dimmed by the darkness), roofs get their side
    // light only, and the lit openings glow while they are resolved.
    rgb=materialGrain(base,cls,N,grainPosition,fp)*baseOcclusion(n,facadePosition)*vec3(1.,.84,.66)*uCave.y*mix(1.,.5,smoothstep(.45,.8,N.y));
    if(lit&&uCave.x<1.5)rgb=mix(rgb,vec3(1.,.64,.28),.9*(1.-smoothstep(.45,1.2,length(fwidth(facadePosition)))));
  }else{
    float light=buildingLight(N);
    rgb=buildingNight(materialGrain(base,cls,N,grainPosition,fp)*light*baseOcclusion(n,facadePosition),facadePosition,lit);
  }
  if(uRoofInkDpr>0.) rgb*=1.-roofInk(roofEdge,gx,gy,uRoofInkDpr);
  // The far town dissolves into the cave's darkness as the ground does (uHaze is that darkness then), else into the haze.
  float haze=uCave.x>.5?smoothstep(uCave.z,uCave.w,vDistance)*uAir.y:min(.62,1.-exp(-pow(vDistance/uAir.x,2.)*.11))*uAir.y;
  color=vec4(mix(rgb,uHaze,haze),1.);
}`,De=10,Pt=De*(fe-1)*6,oo=[Pt,108,36],Ot=800,Oe=12,_e=1,Ie=2,Tt=4,we=0,Ut=1,Te=2,ae=700,Ue=160,$t=32e3;function g(e,t){const a=Math.floor(e)|0,s=Math.floor(t)|0;let c=(Math.imul(a,374761393)^Math.imul(s,668265263)^2654435769)>>>0;return c=Math.imul(c^c>>>13,1274126177)>>>0,c=(c^c>>>16)>>>0,c/4294967296}function Bt(e,t){const a=Math.floor(e),s=Math.floor(t),c=e-a,i=t-s,f=c*c*(3-2*c),v=i*i*(3-2*i),k=g(a,s),p=g(a+1,s),y=g(a,s+1),F=g(a+1,s+1);return(k+(p-k)*f)*(1-v)+(y+(F-y)*f)*v}function Q(e,t,a){let s=0,c=.5,i=0;for(let f=0;f<4;f++)s+=c*(Bt(e/a+f*17.31,t/a+f*9.17)-.5),i+=c,a*=.5,c*=.55;return s/i}const j=(e,t,a)=>{const s=Math.min(1,Math.max(0,(a-e)/(t-e)));return s*s*(3-2*s)},Se=new WeakMap;function*Dt(e,t){const{cavern:a,abundance:s}=e,c=[];if(s<=0)return{values:new Float32Array(0),counts:[0,0,0]};const i=e.occupation,f=i?.ways?.length?Se.get(i.ways)??(Se.set(i.ways,new ut(i.ways,[])),Se.get(i.ways)):void 0,v=(o,n)=>{if(!i)return!1;const h=Math.floor((o-i.x)/i.width*i.n),r=Math.floor((n-i.y)/i.width*i.n);if(h<0||r<0||h>=i.n||r>=i.n)return!1;const l=i.rgba[(r*i.n+h)*4+2];return l===4||l===8||l===9||l===11||l===12},k=(o,n,h)=>{const r=e.towns;if(r)for(let l=0;l+2<r.length;l+=3){const N=o-r[l],_=n-r[l+1],z=r[l+2]*.7+h;if(N*N+_*_<z*z)return!0}return f&&!f.keeps(o,n,h+.5)?!0:v(o,n)},p=(o,n)=>ce(a,o,n,0),y=(o,n)=>{if(!i)return!1;const h=Math.floor((o-i.x)/i.width*i.n),r=Math.floor((n-i.y)/i.width*i.n);return h>=0&&r>=0&&h<i.n&&r<i.n&&i.rgba[(r*i.n+h)*4+2]===it},F=(o,n)=>Math.hypot(e.raw(o+3,n)-e.raw(o-3,n),e.raw(o,n+3)-e.raw(o,n-3))/6,u=ae*ae,E=(o,n)=>(o-t.x)**2+(n-t.y)**2,H=(o,n)=>{const h=Math.min(1,e.water(o,n)*1.5),r=j(.12,.45,F(o,n)+.15*Q(o*1.7+31,n*1.7+5,60)),l=j(.05,.25,Q(o+191,n+23,240)+.25*h-.1)*(1-r),N=j(.04,.2,Q(o-517,n+233,520)+.1*h+.2*l-.1)*(1-r)*(1-j(.15,.45,h)),_=j(.12,.32,Q(o+911,n+377,420)+.3*l);return{wet:h,rocky:r,moss:l,grove:N,cluster:_}},W=(o,n,h)=>le(a,o,n)-h,$=(o,n,h,r,l,N,_,z,w,m,L,I)=>{c.push([E(o,n),o,n,h,r,l,N,_,(z%6.2831853+6.2831853)%6.2831853+8*w,m[0],m[1],m[2],Math.min(L,.99)+2*I])},U=t.x-ae,Z=t.x+ae,V=t.y-ae,X=t.y+ae,Y=Math.min(s,2),se=Ae;for(const[o,n,h]of[[31,0,0],[19,.37,.61]])for(let r=Math.floor(V/o+h);r<=Math.ceil(X/o+h);r++){yield;for(let l=Math.floor(U/o+n);l<=Math.ceil(Z/o+n);l++){const N=g(l+17+n,r+233+h);if(N>.7)continue;const _=g(l+5,r+71)*.56+.22,z=g(l+61,r+2)*.56+.22,w=(l+_-n)*o,m=(r+z-h)*o;if(E(w,m)>u||p(w,m)>.35||(H(w,m),N>.7*jt(w,m)||e.water(w,m)>=.05)||g(l+401,r+77)>.2*Y)continue;const L=Math.min(_,1-_,z,1-z)*o,I=Math.min(L*.95,o*(.16+.2*g(l+23,r+9)));if(I<.8||k(w,m,I))continue;const G=e.height(w,m);if(G===void 0)continue;const P=g(l+88,r+13),S=.8+.4*g(l+1,r+301),C=ce(a,w,m,2),O=P<.45?x.parasol:P<.8?g(l+7,r+31)<.6?x.dome:x.bell:x.bell;let R=I*(O===x.parasol?2.4:O===x.dome?1.45:1.9)*(.85+.3*g(l+3,r+3))*(1+.35*C);R=Math.min(R,Math.max(2,W(w,m,G)-3));const M=g(l+7,r+7)>=.66;$(w,m,G,I,R,I*(O===x.parasol?.11:O===x.dome?.26:.17),O,g(l+9,r+4)*6.283,(P>.55&&P<.8?_e:0)|Ie,se[P<.45?0:P<.8?1:2].map(b=>b*S*1.25),M?.55:0,we)}}const ie=.07-.07*(Y-1);for(let o=Math.floor(V/13);o<=Math.ceil(X/13);o++){yield;for(let n=Math.floor(U/13);n<=Math.ceil(Z/13);n++){const h=g(n+1301,o+29);if(h>.45)continue;const r=(n+.15+.7*g(n+5,o+1303))*13,l=(o+.15+.7*g(n+1307,o+9))*13;if(E(r,l)>u||p(r,l)>.25)continue;const N=ce(a,r,l,2);if(N<.2)continue;const _=j(ie,ie+.16,Q(r-517,l+233,700)+.12*N),z=j(-.12,.08,Q(r+77,l-913,110));if(h>.45*_*z*j(.2,.55,N)||e.water(r,l)>=.05||y(r,l))continue;const w=g(n+88,o+1313),m=w<.55?x.parasol:w<.8?x.dome:x.bell;let L=(10+24*g(n+1315,o+3)**1.5)*(.6+.5*N);const I=L*(m===x.parasol?.36:m===x.dome?.55:.42)*(.85+.3*g(n+1317,o+1));if(k(r,l,I+4))continue;const G=e.height(r,l);if(G===void 0)continue;L=Math.min(L,Math.max(3,le(a,r,l)-G-3));const P=Ae[w<.45?0:w<.8?1:2],S=(.85+.35*g(n+1319,o+7))*1.25;$(r,l,G,I,L,I*(m===x.parasol?.1:m===x.dome?.2:.15),m,h*60,(g(n,o+1321)<.3?_e:0)|Ie,P.map(C=>C*S),g(n+1323,o)>.78?.45:0,g(n+1325,o)>.5?we:Ut)}}const ee=130,te=44;for(let o=Math.floor((t.y-ee)/te);o<=Math.floor((t.y+ee)/te);o++)for(let n=Math.floor((t.x-ee)/te);n<=Math.floor((t.x+ee)/te);n++)yield;const de=[x.dome,x.bell,x.cone,x.parasol,x.morel,x.puffball,x.club,x.funnel];for(let o=Math.floor(V/37);o<=Math.ceil(X/37);o++){yield;for(let n=Math.floor(U/37);n<=Math.ceil(Z/37);n++){if(g(n+3701,o+41)>.14*Y)continue;const r=(n+.1+.8*g(n+3,o+3703))*37,l=(o+.1+.8*g(n+3705,o+7))*37;if(E(r,l)>u||p(r,l)>.3||e.water(r,l)>=.05||y(r,l)||k(r,l,2)||H(r,l).rocky>.6)continue;const _=1+Math.floor(5*g(n+3707,o+3)**2),z=g(n+3709,o+5);for(let w=0;w<_;w++){const m=g(n+w*13,o+3711)*6.283,L=w?1+3*g(n+3713,o+w):0,I=r+Math.cos(m)*L,G=l+Math.sin(m)*L,P=e.height(I,G);if(P===void 0)continue;const S=g(n+w*7,o+3715),C=de[Math.floor(S*de.length)],O=(.4+3.2*z**2)*(.55+.6*g(n+3717,o+w))*(w?.75:1),R=C===x.club?0:O*(C===x.parasol?.5:C===x.cone?.25:C===x.puffball?.55:C===x.funnel?.45:.36),M=.8+.4*g(n+3719,o+w);$(I,G,P,R,O,O*(C===x.club?.12:.08),C,S*6.283,C===x.dome&&S>.85?_e:0,(S<.3?[.56,.52,.44]:S<.55?[.44,.3,.34]:S<.8?[.52,.38,.24]:[.34,.38,.32]).map(b=>b*M),g(n+3721,o+w)<.05?.5:0,Te)}}}for(let o=Math.floor(V/7);o<=Math.ceil(X/7);o++){yield;for(let n=Math.floor(U/7);n<=Math.ceil(Z/7);n++){const h=(n+.2+.6*g(n+1501,o+3))*7,r=(o+.2+.6*g(n+7,o+1503))*7;if(E(h,r)>u)continue;const l=p(h,r);if(l<.45)continue;const N=le(a,h,r),_=6,z=p(h+_,r)-p(h-_,r),w=p(h,r+_)-p(h,r-_),m=Math.hypot(z,w);if(m<.02)continue;const L=-z/m,I=-w/m,G=Math.max(e.water(h+L*60,r+I*60),e.water(h+L*120,r+I*120)),P=ce(a,h,r,3);if(l>=.75){if(p(h+L*14,r+I*14)>.5||g(n+1601,o+5)>(.22+.45*G)*Math.min(1,.5+.5*Y))continue;const M=h+L*(2+4*g(n+3,o+1605)),b=r+I*(2+4*g(n+1607,o+7));if(k(M,b,0)&&g(n,o+1609)<.5)continue;const T=Math.min((3+9*g(n+1611,o+1))*(.8+.5*G),.3*P),B=Math.min(N,le(a,M,b));$(M,b,B,T*(.11+.06*g(n+2,o+1613)),T,0,x.stalactite,g(n+9,o+9)*6.283,0,[.2,.19,.21],G>.2&&g(n+4,o+1615)<.15?.25:0,we);continue}if(G<.05||g(n+1701,o+11)>.5*Math.min(Y,1.5))continue;const C=e.height(h+L*12,r+I*12);if(C===void 0||k(h,r,1))continue;const O=1+Math.floor(3*g(n+13,o+1703)),R=Math.atan2(I,L);for(let M=0;M<O;M++){const b=.7+1.6*g(n+M*3,o+1705),T=M*(1.1+.8*g(n+1707,o+M));$(h-L*b*.3,r-I*b*.3,Math.min(C+.6+T,N-2),b,b*.28,0,x.bracket,R,Ie,g(n+M,o+1709)<.5?[.48,.36,.22]:[.4,.4,.34],g(n+1711,o+M)<.12?.5:0,Te)}}}for(let o=Math.floor(V/21);o<=Math.ceil(X/21);o++){yield;for(let n=Math.floor(U/21);n<=Math.ceil(Z/21);n++){const h=g(n+2101,o+17);if(h>.3)continue;const r=(n+.1+.8*g(n+3,o+2103))*21,l=(o+.1+.8*g(n+2105,o+5))*21;if(E(r,l)>u||p(r,l)>.2)continue;const N=e.water(r,l);if(h>(.12+.25*N)*Math.min(1,.5+.5*Y))continue;const _=ce(a,r,l,3),z=Math.min((3+10*g(n+7,o+2107))*(.8+.5*N),.22*_);$(r,l,le(a,r,l)+.6,z*(.1+.05*g(n,o+2109)),z,0,x.stalactite,h*20,Tt,[.22,.21,.23],0,we)}}c.sort((o,n)=>o[0]-n[0]);const D=c.slice(0,$t),me=[0,0,0],J=D.map(o=>{const n=Math.sqrt(o[0]),h=o[5];return n<25||h>=4&&n<150?0:h>=1.5?1:2});let d=0;for(let o=0;o<D.length;o++)J[o]===0&&++d>Ot&&(J[o]=D[o][5]>=1.5?1:2);const oe=D.map((o,n)=>n).sort((o,n)=>J[o]-J[n]||D[o][0]-D[n][0]);for(const o of J)me[o]++;const A=new Float32Array(D.length*Oe);return oe.forEach((o,n)=>A.set(D[o].slice(1),n*Oe)),{values:A,counts:me}}function no(e,t){const a=Dt(e,t);let s=a.next();for(;!s.done;)s=a.next();return s.value}const he=e=>Number.isInteger(e)?`${e}.`:String(e),ze=ct,Le=rt,Ht=ze.flat().map(([e,t,a])=>`vec3(${he(e)},${he(t)},${he(a)})`).join(","),qt=Le.map(([e,t])=>`vec2(${he(e)},${he(t)})`).join(","),ao={vertex:`#version 300 es
precision highp float;
layout(location=0) in vec4 fungusBase;
layout(location=1) in vec4 fungusShape;
layout(location=2) in vec4 fungusColor;
uniform mat4 matrix;
uniform vec3 cameraOrigin;
uniform float exaggeration;
uniform vec4 fungusFade;
uniform vec4 uReveal;
uniform int fungusLod;
out vec3 world;
out vec3 fungusNormal;
out vec3 tint;
out vec3 chart;
out vec4 fungusInfo;
out vec2 plan;
const vec3 PROFILE[${ze.length*fe}]=vec3[${ze.length*fe}](${Ht});
const vec2 PART[${Le.length}]=vec2[${Le.length}](${qt});
// Profile ring of a lathe ring at a level of detail: all nine; foot, stem top, rim, apex; rim underside and apex.
int fungusK(int r){if(fungusLod==0)return clamp(r,0,8);if(fungusLod==1)return r<=0?0:r==1?2:r==2?5:8;return r<=0?4:8;}
vec2 fungusRing(int form,int k,float stem,float cap,float h){vec3 p=PROFILE[form*${fe}+clamp(k,0,${fe-1})];return vec2(p.x*stem+p.y*cap,p.z*h);}
void main(){
  int v=int(gl_VertexID),quad=v/6,corner=v-quad*6;
  int sides=fungusLod==0?${De}:6,band=quad/sides,seg=quad-band*sides;
  int dseg=corner==1||corner==2||corner==4?1:0,dring=corner==2||corner==4||corner==5?1:0;
  int ring=band+dring,form=int(fungusShape.z+.5);
  float flags=floor(fungusShape.w/8.),phase=fungusShape.w-8.*flags;
  float far=distance(fungusBase.xy,fungusFade.xy);
  // Low mushrooms (under 1.5 m) only near the eye, larger forms to the far radius.
  float fade=1.-(fungusShape.x<1.5&&fungusShape.x>0.?smoothstep(${(Ue*.75).toFixed(1)},${Ue.toFixed(1)},far):smoothstep(fungusFade.z,fungusFade.w,far));
  // Ceiling stalactites go with the roof where it is cut away.
  if(mod(floor(flags/4.),2.)>=1.&&distance(fungusBase.xy,uReveal.xy)<uReveal.z)fade=0.;
  if(fade<=0.){gl_Position=vec4(2.,2.,2.,1.);world=vec3(0.);fungusNormal=vec3(0.,1.,0.);tint=vec3(0.);chart=vec3(0.);fungusInfo=vec4(0.);plan=vec2(0.);return;}
  // A bracket is half a lathe, its back in the wall; every other form a full turn.
  float turn=form==8?3.14159265:6.28318531;
  float angle=float(seg+dseg)*turn/float(sides)+phase-(form==8?1.57079633:0.);
  vec2 dir=vec2(cos(angle),sin(angle));
  float cap=fungusBase.w,h=fungusShape.x,stem=fungusShape.y;
  int k=fungusK(ring);
  vec2 here=fungusRing(form,k,stem,cap,h),before=fungusRing(form,fungusK(ring-1),stem,cap,h),after=fungusRing(form,fungusK(ring+1),stem,cap,h);
  if(fungusK(ring-1)==k)before=here;if(fungusK(ring+1)==k)after=here;
  vec2 t=after-before;if(dot(t,t)<1e-8)t=vec2(0.,1.);
  vec2 n2=normalize(vec2(t.y,-t.x));
  vec3 local=vec3(dir.x*here.x,here.y,dir.y*here.x)*fade;
  fungusNormal=normalize(vec3(dir.x*n2.x,n2.y,dir.y*n2.x));
  world=vec3(fungusBase.x-cameraOrigin.x+local.x,fungusBase.z*exaggeration-cameraOrigin.y+local.y,fungusBase.y-cameraOrigin.z+local.z);
  vec2 part=PART[form];
  float kind=float(k)<=part.x?0.:float(k)<=part.y?1.:2.;
  tint=fungusColor.rgb;
  float hue=floor(fungusColor.w/2.);
  chart=vec3(angle,here.y/max(abs(h),.01),kind);
  fungusInfo=vec4(fungusColor.w-2.*hue,hue,flags,float(form));
  plan=vec2(fungusBase.x+local.x,fungusBase.y+local.z);
  gl_Position=matrix*vec4(world,1.);
}`,fragment:`#version 300 es
precision highp float;
in vec3 world;
in vec3 fungusNormal;
in vec3 tint;
in vec3 chart;
in vec4 fungusInfo;
in vec2 plan;
uniform vec3 eye;
uniform vec4 uCavern;
uniform vec4 uTownGlow[16]; uniform int uTownGlowCount;
out vec4 color;
float fungusHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec3 n=normalize(fungusNormal),V=normalize(eye-world);
  if(dot(n,V)<0.)n=-n;
  float kind=chart.z,glow=fungusInfo.x,flags=fungusInfo.z,form=fungusInfo.w;
  vec3 hue=fungusInfo.y<.5?vec3(.35,.95,.85):fungusInfo.y<1.5?vec3(.72,.55,1.):vec3(1.,.68,.32);
  // Stem pale and matte, underside darker (gills), cap its own colour.
  vec3 albedo=kind<.5?mix(vec3(.60,.57,.52),tint,.25):kind<1.5?tint*.62:tint;
  bool ribs=mod(flags,4.)>=2.,spots=mod(flags,2.)>=1.;
  if(kind>.5&&kind<1.5&&ribs)albedo*=.78+.22*smoothstep(.2,.8,abs(sin(chart.x*24.)));                // gills
  if(kind>1.5&&ribs&&form>5.5&&form<6.5)albedo*=.7+.3*smoothstep(.1,.6,abs(sin(chart.x*7.)*sin(chart.y*26.)));   // morel ridges
  if(kind>1.5&&spots){vec2 q=vec2(chart.x*3.,chart.y*9.);vec2 i=floor(q);float s=step(.6,fungusHash(i))*(1.-smoothstep(.18,.3,length(fract(q)-.5)));albedo=mix(albedo,vec3(.72,.68,.6),.8*s);}
  // No sky: a dim ambient that shows the form from the eye, and the warm pools of the town lanterns.
  float dark=uCavern.y,wrap=.45+.55*max(dot(n,V),0.);
  float lantern=0.;
  for(int k=0;k<16;k++){if(k>=uTownGlowCount)break;vec4 g=uTownGlow[k];float d=length(plan-g.xy)/max(g.z,1.);lantern+=exp(-d*d*.9);}
  vec3 light=vec3(.93,.97,1.04)*mix(1.05,.36,dark)*wrap+vec3(1.,.74,.46)*min(lantern,1.3)*mix(.3,1.1,dark);
  vec3 c=albedo*light;
  // Bioluminescence: gills and rim glow softly, the cap faintly; a glowing carpet or cluster glows whole.
  float own=glow*(kind<.5?.15:kind<1.5?1.:form>4.5&&form<7.5||form<3.5&&chart.y<.7?.55:.3);
  c+=hue*own*mix(.25,.55,dark);
  color=vec4(mix(c,vec3(.005,.005,.007),smoothstep(uCavern.z,uCavern.w,length(world-eye))),1.);
}`},jt=(e,t)=>j(.04,.2,Q(e-517,t+233,520)+.2*j(.05,.25,Q(e+191,t+23,240)-.1)-.1);export{Gt as B,oo as F,Et as R,to as W,pe as a,mt as b,Ct as c,At as d,no as e,Dt as f,ae as g,Ue as h,Oe as i,ao as j,Nt as k,be as l,Qt as m,q as n,Yt as o,Xt as p,Be as q,Zt as r,Ee as s,eo as t,Jt as w,Ft as y};
