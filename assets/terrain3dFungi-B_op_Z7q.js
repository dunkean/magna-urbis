import{bD as Ce,bE as ye,bF as je,bG as Ge,bH as Ke,bI as We,bJ as Ve,bK as Xe,l as Ye,bL as Je,u as Ze,bM as Be,bN as Qe,bO as et,bP as tt,bQ as ot,bR as nt,bS as at,bT as st,bU as it,bV as ue,bW as k,bX as Ae,bY as rt,bZ as ct,b_ as lt}from"./studio-Dos1nxx6.js";import{m as ft,aD as ut,ac as ht,aE as fe,aF as se}from"./__vite-browser-external-DKBqjRhT.js";import{M as dt}from"./rendererOverride-C7U0D0QD.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function mt(o){const n=new Uint8Array(o.length),a=new Map;for(let i=0;i<o.length;i++){const{surface:c,normal:r,points:d,material:v,materials:M}=o[i];if(c!=="roof"||r[2]<=.001||/^city3d:(wall|tree|road|water)/.test(v??M.cladding))continue;const w=d.map(A=>A.map(h=>Math.round(h*1e3)).join(",")),y=Math.hypot(...r);n[i]=7;for(let A=0;A<3;A++){const h=w[(A+1)%3],T=w[(A+2)%3],q=1<<A,W=h<T?`${h}|${T}`:`${T}|${h}`,$=a.get(W);if(!$){a.set(W,{face:i,bit:q});continue}const B=o[$.face].normal;(r===B||r[0]*B[0]+r[1]*B[1]+r[2]*B[2]>=.99999*y*Math.hypot(...B))&&(n[$.face]&=~$.bit,n[i]&=~q)}}return n}const be=10;function gt(o){const n=[1/0,1/0,o.ground_z_m,-1/0,-1/0,o.ground_z_m+Ce(o)],a=ye(o)?[]:o.structural_features;for(const i of[o.footprint,o.roof_footprint,...a.map(c=>c.surface)])for(const c of i)for(const r of c.outer)n[0]=Math.min(n[0],r.x),n[1]=Math.min(n[1],r.y),n[3]=Math.max(n[3],r.x),n[4]=Math.max(n[4],r.y);if(!ye(o))for(const i of[...o.volumes.map(c=>c.foundation),...o.structural_foundations??[]])i&&(n[2]=Math.min(n[2],i.z_min_m));for(const i of a)n[2]=Math.min(n[2],i.z_m),n[5]=Math.max(n[5],i.z_m+i.height_m);for(const i of a)for(const c of i.vertices3d){const r=[c.x,c.y,c.z];for(let d=0;d<3;d++)n[d]=Math.min(n[d],r[d]),n[d+3]=Math.max(n[d+3],r[d])}return n}const Re=o=>/^city3d-(wall|bridge|quay|harbour)/.test(o.id)||!Number.isFinite(o.ground_z_m)?1/0:o.ground_z_m,vt=(o,n,a,i,c,r,d)=>{d[0]=c,d[1]=r??Math.min(c,n)},pt=(o,n)=>o+(n===void 0?0:64*Math.max(1,Math.min(15,Math.round(n*15))));function ne(o){return o.startsWith("rgb")?o.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255):[1,3,5].map(n=>parseInt(o.slice(n,n+2),16)/255)}function wt(o){const n=/^city3d:(cover|wall|road):(.+)$/.exec(o??"");return n?n[1]==="cover"?Qe(n[2]):n[1]==="wall"?et(n[2]):Be.road[n[2]]??-1:-1}const yt={tile:1,pantile:2,glazed:3,slate:4,slab:5,paving:6,thatch:7,reed:8,palm:9,turf:10,shingle:11,bark:12,bamboo:13,earth:14,lime:15,metal:16,felt:17,hide:18},bt={plaster:19,timber:20,wood:21,brick:22,stone:23,earth:24,wattle:25,bamboo:26,coral:27,hide:18,ashlar:29,concrete:30,glass:31,steel:16},xt=28,kt=32,ve=new Map,pe=new Map;function Mt(o){let n=ve.get(o);return n===void 0&&(ve.size>4096&&ve.clear(),ve.set(o,n=/^city3d:(cover|wall):([a-z]+)$/.exec(o))),n}function _t(o){const n=o??"";let a=pe.get(n);return a===void 0&&(pe.size>4096&&pe.clear(),pe.set(n,a=/@([0-9a-f]{6}|[0-9a-f]{3})$/.exec(n))),a}function It(o,n,a){const i=Mt(o??"");if(!i)return 0;if(i[1]==="wall")return bt[i[2]]??0;const c=tt(i[2],Math.abs(n[2])>.995*(Math.hypot(n[0],n[1],n[2])||1),a);return c?yt[c]:0}function St(o,n,a){if(a<0)return[0,0];const i=ot(a),c=n[0],r=n[1],d=Math.abs(n[2]),v=Math.hypot(c,r);if(d<.3&&v>1e-6)return[(o[0]*-r+o[1]*c)/v/i,-o[2]/i];if(v<.02)return[o[0]/i,o[1]/i];const M=c/v,w=r/v;return[(-o[0]*w+o[1]*M)/i,(o[0]*M+o[1]*w)/Math.max(d,.2)/i]}const xe=new Float64Array(2);function we(o,n,a,i,c,r,d=vt){const v=a.appearance,M=new Map,w=!!v.textured,y={materials:a.materials};for(const h of o){const T=new Map,q=h.culture?.culture??"";let W=2166136261;for(let g=0;g<h.id.length;g++)W=Math.imul(W^h.id.charCodeAt(g),16777619);const $=Math.round((W>>>0)/4294967295*15)/15,B=h.programme,J=`${B?.role??""}${B?.landmark?" monument":""}`,V=Re(h),X=Number.isFinite(V)&&!h.id.startsWith("city3d-"),Y=a.roofInk&&X&&v.diagnostic==="none",re=a.look&&!w&&v.diagnostic==="none"?a.look.item(h.id):void 0;let ce,ee,te;const me=(g,oe=0,P=0)=>{const e=g.material??(g.surface==="roof"?g.materials.cladding:g.materials.coating),t=_t(e),u=t?e.slice(0,t.index):e,s=re&&g.surface!=="yard"?We(g.materials):void 0;let f;if(s&&g.surface==="roof"&&u?.startsWith("city3d:cover:")){if(g.normal!==ce||g.materials!==ee){const x=Ve(a.look.frame,re,{...s,normal:g.normal});te={color:ne(x.color),gain:x.gain,family:x.family},ce=g.normal,ee=g.materials}f=te}const G=!!s&&e===g.materials.coating,z=X&&(v.roof==="minimal"||v.roof==="flat"&&g.surface==="roof"),_=w&&!z&&!P&&g.surface!=="yard"?wt(u??(g.surface==="roof"?g.materials.cladding:g.materials.coating)):-1;let p=T.get(g.surface);p||T.set(g.surface,p=new Map);let m=f?.color??p.get(String(e));if(!m&&G&&(m=ne(Xe(a.look.frame,re,s)),p.set(String(e),m)),!m){const x=Ye(g.materials,h.function,Ce(h),v,u,y);if(m=ne(g.surface==="roof"?x.roof:x.wall),v.diagnostic==="none"||g.surface==="yard"){if(t?.[1].length===6)m=ne(`#${t[1]}`);else if(t)m=m.map((U,H)=>Math.min(1,U*parseInt(t[1][H],16)/8));else if(q&&!h.id.startsWith("city3d-")){const U=qe=>/(?:^|[:/_-])(timber|wood|brick|stone|earth|plaster|bamboo|wattle|hide|coral|tile|slate|thatch|reed|palm|shingle|bark|turf|felt|snow|metal|lead)(?:$|[:/_-])/.exec(qe)?.[1]??"",H=U(g.materials.coating||g.materials.infill),le=U(g.materials.cladding),Fe=Je(q,H,le,$,J+(/tower|minaret|stone/.test(u)?" monument":""));m=g.surface==="roof"?Fe.roof:Fe.wall}}g.surface==="roof"&&v.diagnostic==="none"&&v.colors?.building&&(m=ne(v.colors.building));const E=/^city3d:tree:(crown|trunk)$/.exec(u??"");E&&(m=ne(t?.[1].length===6?`#${t[1]}`:E[1]==="crown"?"#5f8247":"#4b5a36")),u==="city3d:water"&&(m=ne("#"+(t?.[1]??"8aaeb8"))),p.set(String(e),m)}P&&(m=Ze(m,P,-(g.normal[0]+g.normal[1])*.4));const N=v.diagnostic==="none"&&(!!v.colors?.building&&g.surface==="roof"||t?.[1].length===6||!!q&&!h.id.startsWith("city3d-")),I=!w&&!z&&g.surface!=="yard"&&v.style==="cartographic"&&v.diagnostic==="none"?P>=.4?xt:f?f.family:It(u,g.normal,q):0,R=(1+pt(u==="city3d:wall:lit"?kt:I,f?.gain)/32)/(Math.hypot(g.normal[0],g.normal[1],g.normal[2])||1),F=w?`${m.join(",")}|${_}|${N}|${!!P}`:P?"vertex-colour|true":"vertex-colour|false";let C=M.get(F);if(!C){const x=Be.layers[_]?.mean_rgb,U=x&&N?m.map((H,le)=>H/Math.max(.04,x[le]/255)):t?.[1].length===3?[...t[1]].map(H=>parseInt(H,16)/8):[1,1,1];C={batch:{color:w?m:[1,1,1],tint:U,recolored:N,vcolor:!w,palette:[],stride:be,data:new Float32Array(4096)},length:0,seen:a.collectPalette===!1?void 0:new Set},M.set(F,C)}const L=C.batch,O=g.points;if(C.seen&&(P||!C.seen.has(m))&&(P||C.seen.add(m),L.palette.some(x=>x[0]===m[0]&&x[1]===m[1]&&x[2]===m[2])||L.palette.push(m)),C.length+O.length*be>L.data.length){const x=new Float32Array(Math.max(L.data.length*2,C.length+O.length*be));x.set(L.data.subarray(0,C.length)),L.data=x}const S=L.data;let b=C.length;for(let x=0;x<O.length;x++){const E=O[x];d(h,V,E[0],E[1],E[2],g.ground?.[x],xe),S[b++]=E[0]-n[0],S[b++]=xe[0],S[b++]=E[1]-n[1],S[b++]=g.normal[0]*R,S[b++]=g.normal[2]*R,S[b++]=g.normal[1]*R;const U=oe&~(1<<x);if(w){const[H,le]=St(E,g.normal,_);S[b++]=H,S[b++]=le,S[b++]=_+U/8}else S[b++]=U&1?-m[0]:m[0],S[b++]=U&2?-m[1]:m[1],S[b++]=U&4?-m[2]:m[2];S[b++]=xe[1]}C.length=b},D=v.style!=="silhouette"&&v.diagnostic==="none"?ft(a.snowAltitudes.get(h.id)??h.ground_z_m,v.roofSnow):0,ge=D?je(h.function):0,Z=(g,oe=0)=>{const P=g.material??g.materials.cladding,t=D&&g.surface==="roof"&&!/^city3d:(wall|tree|road|water)/.test(P)&&!h.id.startsWith("city3d-")?Ke(g.normal,-(g.normal[0]+g.normal[1])*.4,ge,/^city3d:cover:([a-z]+)/.exec(P)?.[1]):0;me(g,oe,D*Math.round(t*8)/8)};if(Y){const g=[];Ge(h,P=>g.push(P),i,c,r);const oe=mt(g);g.forEach((P,e)=>Z(P,oe[e]))}else Ge(h,Z,i,c,r)}const A=[];for(const{batch:h,length:T}of M.values())T&&(h.data=h.data.slice(0,T),A.push(h));return A}const he=256,j=4,Ee=he/j,Nt=64,ke=[0,0];function zt(o,n,a,i,c){const r=Re(o);if(Number.isFinite(r)){c[0]=(r+Math.min(0,n[2]-r))*i,c[1]=r*i+Math.max(0,n[5]-r);return}c[0]=1/0,c[1]=-1/0;for(let d=0;d<4;d++){const v=a.heightAt(n[d&1?3:0],n[d&2?4:1]);c[0]=Math.min(c[0],v-1),c[1]=Math.max(c[1],v+(n[5]-n[2]))}}class Xt{constructor(n,a,i){this.scene=n,this.relief=a,this.exaggeration=i}blocks=[];altitudes=new Lt;byKey=new Map;next=0;step(n){const a=this.scene.buildings,i=this.relief,c=this.exaggeration;for(;this.next<a.length;){const r=a[this.next++],d=gt(r),v=(d[0]+d[3])/2,M=(d[1]+d[4])/2,w=at(r),y=[Math.floor(v/he)*he,Math.floor(M/he)*he],A=`${y}${w?"/yard":""}`;let h=this.byKey.get(A);if(h||(this.byKey.set(A,h={origin:y,buildings:[],yard:w,width:0,minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0,low:1/0,high:-1/0,levels:3,cells:new Int32Array(j*j+1),cellOf:[]}),this.blocks.push(h)),h.buildings.push(r),h.cellOf.push(Math.min(j-1,Math.floor((v-y[0])/Ee))+j*Math.min(j-1,Math.floor((M-y[1])/Ee))),this.altitudes.add(r),h.width+=w?1:Math.max(1,Math.min(d[3]-d[0],d[4]-d[1])),h.minX=Math.min(h.minX,d[0]),h.minY=Math.min(h.minY,d[1]),h.maxX=Math.max(h.maxX,d[3]),h.maxY=Math.max(h.maxY,d[4]),zt(r,d,i,c,ke),h.low=Math.min(h.low,ke[0]),h.high=Math.max(h.high,ke[1]),this.next%Nt===0&&performance.now()>n)return!1}if(this.next===a.length){for(const r of this.blocks){r.width/=r.buildings.length;const d=r.cellOf,v=r.cells,M=new Array(d.length);for(const y of d)v[y+1]++;for(let y=0;y<j*j;y++)v[y+1]+=v[y];const w=v.slice(0,j*j);for(let y=0;y<d.length;y++)M[w[d[y]]++]=r.buildings[y];for(let y=0;y<M.length;y++)r.buildings[y]=M[y];r.cellOf=void 0}this.next++}return!0}}function Yt(o,n){const a=n>0?1/n:1;return(i,c,r,d,v,M,w)=>{if(M===void 0&&Number.isFinite(c)){w[0]=v>=c?v-c:(v-c)*n,w[1]=c*n;return}const y=o.heightAt(r,d);w[0]=v-(M??y*a),w[1]=y}}class Lt{towns=new Map;owners=new Map;add(n){const a=n.parcel_id?.split("/")[0],i=a?.startsWith("layout-")?a:n.id;let c=this.towns.get(i);c||this.towns.set(i,c={sum:0,count:0}),Number.isFinite(n.ground_z_m)&&(c.sum+=n.ground_z_m,c.count++),this.owners.set(n.id,i)}get(n){const a=this.owners.get(n),i=a===void 0?void 0:this.towns.get(a);return i?i.count?i.sum/i.count:0:void 0}}function Jt(o,n,a,i){return{appearance:{...n,textured:!1,ambience:void 0,lightsOn:void 0},materials:o.materials??[],collectPalette:!1,roofInk:n.roof==="v1",snowAltitudes:a,look:i}}function Zt(o,n,a,i,c,r){const d=o.buildings.slice(c,r);if(o.yard)return Me(we(d,o.origin,a,n>0,void 0,n,i).map(h=>h.data));if(n!==Ne)return Me(we(d,o.origin,a,n>0,void 0,void 0,i).map(h=>h.data));const v=a.appearance.roof==="minimal",M=h=>Ct(h)&&(!v||h.id.startsWith("city3d-")),w=d.filter(M),y=w.length?d.filter(h=>!M(h)):d,A=[...we(y.map(h=>Rt(h,v)),o.origin,a,!0,void 0,void 0,i),...w.length?we(w,o.origin,a,!1,void 0,void 0,i):[]];return Me(A.map(h=>h.data))}function Me(o){if(o.length===1)return o[0];let n=0;for(const c of o)n+=c.length;const a=new Float32Array(n);let i=0;for(const c of o)a.set(c,i),i+=c.length;return a}const Ne=2,De=o=>o.levels,Ct=o=>!ye(o)&&o.volumes.some(n=>n.envelope==="open");function Rt(o,n=!1){if(!Number.isFinite(Re(o))||n&&o.id.startsWith("city3d-"))return o;const a=n||!o.roof_footprint.length?o.footprint:o.roof_footprint;return ye(o)?a===o.roof_footprint?o:{...o,roof_footprint:a}:o.volumes.length?{...o,roof_footprint:a,projection:"native-building-visual-1",height_m:Ce(o),materials:o.volumes[0].materials,volumes:void 0,structural_features:void 0,structural_foundations:void 0}:o}const Pe=[10,6,3],Ft=.25;function Gt(o,n,a=0,i=1/0){const c=De(o);if(n<Ft*(a===c?1.15:1))return c;const r=i<(a===0?.85:1)?1:0;return Math.max(r,nt(n,a))}function Qt(o,n,a=!1,i=1,c=!1){const r=De(o);if(o.yard)return Gt(o,n);for(let d=a==="overview"?1:a?Ne:0;d<Pe.length;d++)if(n*i>=Pe[d])return d;return c||i>=ut?Ne:r}const At=`
float baseOcclusion(vec3 normal,vec3 p){
  if(abs(normalize(normal).y)>.5||p.y<-1000.)return 1.;
  return mix(.72,1.,smoothstep(0.,2.4,p.y));
}
uniform int uNight;
${dt}
${st}
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
`,Et=`
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
`,Pt=`
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
${At}
${Et}
${it}
${Pt}
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
}`,He=10,Ot=He*(ue-1)*6,oo=[Ot,108,36],Tt=800,Oe=12,_e=1,Ie=2,Te=4,ae=0,Ut=1,Ue=2,ie=700,$e=160,$t=32e3;function l(o,n){const a=Math.floor(o)|0,i=Math.floor(n)|0;let c=(Math.imul(a,374761393)^Math.imul(i,668265263)^2654435769)>>>0;return c=Math.imul(c^c>>>13,1274126177)>>>0,c=(c^c>>>16)>>>0,c/4294967296}function Bt(o,n){const a=Math.floor(o),i=Math.floor(n),c=o-a,r=n-i,d=c*c*(3-2*c),v=r*r*(3-2*r),M=l(a,i),w=l(a+1,i),y=l(a,i+1),A=l(a+1,i+1);return(M+(w-M)*d)*(1-v)+(y+(A-y)*d)*v}function Q(o,n,a){let i=0,c=.5,r=0;for(let d=0;d<4;d++)i+=c*(Bt(o/a+d*17.31,n/a+d*9.17)-.5),r+=c,a*=.5,c*=.55;return i/r}const K=(o,n,a)=>{const i=Math.min(1,Math.max(0,(a-o)/(n-o)));return i*i*(3-2*i)},Se=new WeakMap;function*Dt(o,n){const{cavern:a,abundance:i}=o,c=[];if(i<=0)return{values:new Float32Array(0),counts:[0,0,0]};const r=o.occupation,d=r?.ways?.length?Se.get(r.ways)??(Se.set(r.ways,new ht(r.ways,[])),Se.get(r.ways)):void 0,v=(e,t)=>{if(!r)return!1;const u=Math.floor((e-r.x)/r.width*r.n),s=Math.floor((t-r.y)/r.width*r.n);if(u<0||s<0||u>=r.n||s>=r.n)return!1;const f=r.rgba[(s*r.n+u)*4+2];return f===4||f===8||f===9||f===11||f===12},M=(e,t,u)=>{const s=o.towns;if(s)for(let f=0;f+2<s.length;f+=3){const G=e-s[f],z=t-s[f+1],_=s[f+2]*.7+u;if(G*G+z*z<_*_)return!0}return d&&!d.keeps(e,t,u+.5)?!0:v(e,t)},w=(e,t)=>fe(a,e,t,0),y=(e,t)=>{if(!r)return!1;const u=Math.floor((e-r.x)/r.width*r.n),s=Math.floor((t-r.y)/r.width*r.n);return u>=0&&s>=0&&u<r.n&&s<r.n&&r.rgba[(s*r.n+u)*4+2]===rt},A=(e,t)=>Math.hypot(o.raw(e+3,t)-o.raw(e-3,t),o.raw(e,t+3)-o.raw(e,t-3))/6,h=ie*ie,T=(e,t)=>(e-n.x)**2+(t-n.y)**2,q=(e,t)=>{const u=Math.min(1,o.water(e,t)*1.5),s=K(.12,.45,A(e,t)+.15*Q(e*1.7+31,t*1.7+5,60)),f=K(.05,.25,Q(e+191,t+23,240)+.25*u-.1)*(1-s),G=K(.04,.2,Q(e-517,t+233,520)+.1*u+.2*f-.1)*(1-s)*(1-K(.15,.45,u)),z=K(.12,.32,Q(e+911,t+377,420)+.3*f);return{wet:u,rocky:s,moss:f,grove:G,cluster:z}},W=(e,t,u)=>se(a,e,t)-u,$=(e,t,u,s,f,G,z,_,p,m,N,I)=>{c.push([T(e,t),e,t,u,s,f,G,z,(_%6.2831853+6.2831853)%6.2831853+8*p,m[0],m[1],m[2],Math.min(N,.99)+2*I])},B=n.x-ie,J=n.x+ie,V=n.y-ie,X=n.y+ie,Y=Math.min(i,2),re=Ae;for(const[e,t,u]of[[31,0,0],[19,.37,.61]])for(let s=Math.floor(V/e+u);s<=Math.ceil(X/e+u);s++){yield;for(let f=Math.floor(B/e+t);f<=Math.ceil(J/e+t);f++){const G=l(f+17+t,s+233+u);if(G>.7)continue;const z=l(f+5,s+71)*.56+.22,_=l(f+61,s+2)*.56+.22,p=(f+z-t)*e,m=(s+_-u)*e;if(T(p,m)>h||w(p,m)>.35||(q(p,m),G>.7*jt(p,m)||o.water(p,m)>=.05)||l(f+401,s+77)>.2*Y)continue;const N=Math.min(z,1-z,_,1-_)*e,I=Math.min(N*.95,e*(.16+.2*l(f+23,s+9)));if(I<.8||M(p,m,I))continue;const R=o.height(p,m);if(R===void 0)continue;const F=l(f+88,s+13),C=.8+.4*l(f+1,s+301),L=fe(a,p,m,2),O=F<.45?k.parasol:F<.8?l(f+7,s+31)<.6?k.dome:k.bell:k.bell;let S=I*(O===k.parasol?2.4:O===k.dome?1.45:1.9)*(.85+.3*l(f+3,s+3))*(1+.35*L);S=Math.min(S,Math.max(2,W(p,m,R)-3));const b=l(f+7,s+7)>=.66;$(p,m,R,I,S,I*(O===k.parasol?.11:O===k.dome?.26:.17),O,l(f+9,s+4)*6.283,(F>.55&&F<.8?_e:0)|Ie,re[F<.45?0:F<.8?1:2].map(x=>x*C*1.25),b?.55:0,ae)}}const ce=.07-.07*(Y-1);for(let e=Math.floor(V/13);e<=Math.ceil(X/13);e++){yield;for(let t=Math.floor(B/13);t<=Math.ceil(J/13);t++){const u=l(t+1301,e+29);if(u>.45)continue;const s=(t+.15+.7*l(t+5,e+1303))*13,f=(e+.15+.7*l(t+1307,e+9))*13;if(T(s,f)>h||w(s,f)>.25)continue;const G=fe(a,s,f,2);if(G<.2)continue;const z=K(ce,ce+.16,Q(s-517,f+233,700)+.12*G),_=K(-.12,.08,Q(s+77,f-913,110));if(u>.45*z*_*K(.2,.55,G)||o.water(s,f)>=.05||y(s,f))continue;const p=l(t+88,e+1313),m=p<.55?k.parasol:p<.8?k.dome:k.bell;let N=(10+24*l(t+1315,e+3)**1.5)*(.6+.5*G);const I=N*(m===k.parasol?.36:m===k.dome?.55:.42)*(.85+.3*l(t+1317,e+1));if(M(s,f,I+4))continue;const R=o.height(s,f);if(R===void 0)continue;N=Math.min(N,Math.max(3,se(a,s,f)-R-3));const F=Ae[p<.45?0:p<.8?1:2],C=(.85+.35*l(t+1319,e+7))*1.25;$(s,f,R,I,N,I*(m===k.parasol?.1:m===k.dome?.2:.15),m,u*60,(l(t,e+1321)<.3?_e:0)|Ie,F.map(L=>L*C),l(t+1323,e)>.5?.7:0,l(t+1325,e)>.5?ae:Ut)}}const ee=130,te=44;for(let e=Math.floor((n.y-ee)/te);e<=Math.floor((n.y+ee)/te);e++)for(let t=Math.floor((n.x-ee)/te);t<=Math.floor((n.x+ee)/te);t++)yield;const me=[k.dome,k.bell,k.cone,k.parasol,k.morel,k.puffball,k.club,k.funnel];for(let e=Math.floor(V/37);e<=Math.ceil(X/37);e++){yield;for(let t=Math.floor(B/37);t<=Math.ceil(J/37);t++){if(l(t+3701,e+41)>.14*Y)continue;const s=(t+.1+.8*l(t+3,e+3703))*37,f=(e+.1+.8*l(t+3705,e+7))*37;if(T(s,f)>h||w(s,f)>.3||o.water(s,f)>=.05||y(s,f)||M(s,f,2)||q(s,f).rocky>.6)continue;const z=1+Math.floor(5*l(t+3707,e+3)**2),_=l(t+3709,e+5);for(let p=0;p<z;p++){const m=l(t+p*13,e+3711)*6.283,N=p?1+3*l(t+3713,e+p):0,I=s+Math.cos(m)*N,R=f+Math.sin(m)*N,F=o.height(I,R);if(F===void 0)continue;const C=l(t+p*7,e+3715),L=me[Math.floor(C*me.length)],O=(.4+3.2*_**2)*(.55+.6*l(t+3717,e+p))*(p?.75:1),S=L===k.club?0:O*(L===k.parasol?.5:L===k.cone?.25:L===k.puffball?.55:L===k.funnel?.45:.36),b=.8+.4*l(t+3719,e+p);$(I,R,F,S,O,O*(L===k.club?.12:.08),L,C*6.283,L===k.dome&&C>.85?_e:0,(C<.3?[.56,.52,.44]:C<.55?[.44,.3,.34]:C<.8?[.52,.38,.24]:[.34,.38,.32]).map(x=>x*b),l(t+3721,e+p)<.3?.75:0,Ue)}}}for(let e=Math.floor(V/7);e<=Math.ceil(X/7);e++){yield;for(let t=Math.floor(B/7);t<=Math.ceil(J/7);t++){const u=(t+.2+.6*l(t+1501,e+3))*7,s=(e+.2+.6*l(t+7,e+1503))*7;if(T(u,s)>h)continue;const f=w(u,s);if(f<.45)continue;const G=se(a,u,s),z=6,_=w(u+z,s)-w(u-z,s),p=w(u,s+z)-w(u,s-z),m=Math.hypot(_,p);if(m<.02)continue;const N=-_/m,I=-p/m,R=Math.max(o.water(u+N*60,s+I*60),o.water(u+N*120,s+I*120)),F=fe(a,u,s,3);if(f>=.75){if(w(u+N*14,s+I*14)>.5||l(t+1601,e+5)>(.22+.45*R)*Math.min(1,.5+.5*Y))continue;const b=u+N*(2+4*l(t+3,e+1605)),x=s+I*(2+4*l(t+1607,e+7));if(M(b,x,0)&&l(t,e+1609)<.5)continue;const E=Math.min((3+9*l(t+1611,e+1))*(.8+.5*R),.3*F),U=Math.min(G,se(a,b,x));$(b,x,U,E*(.05+.22*l(t+2,e+1613)**2),E,0,k.stalactite,l(t+9,e+9)*6.283,0,[.2,.19,.21],R>.2&&l(t+4,e+1615)<.15?.25:0,ae);continue}if(R<.05||l(t+1701,e+11)>.5*Math.min(Y,1.5))continue;const L=o.height(u+N*12,s+I*12);if(L===void 0||M(u,s,1))continue;const O=1+Math.floor(3*l(t+13,e+1703)),S=Math.atan2(I,N);for(let b=0;b<O;b++){const x=.7+1.6*l(t+b*3,e+1705),E=b*(1.1+.8*l(t+1707,e+b));$(u-N*x*.3,s-I*x*.3,Math.min(L+.6+E,G-2),x,x*.28,0,k.bracket,S,Ie,l(t+b,e+1709)<.5?[.48,.36,.22]:[.4,.4,.34],l(t+1711,e+b)<.12?.5:0,Ue)}}}for(let e=Math.floor(V/21);e<=Math.ceil(X/21);e++){yield;for(let t=Math.floor(B/21);t<=Math.ceil(J/21);t++){const u=l(t+2101,e+17);if(u>.3)continue;const s=(t+.1+.8*l(t+3,e+2103))*21,f=(e+.1+.8*l(t+2105,e+5))*21;if(T(s,f)>h||w(s,f)>.2)continue;const G=o.water(s,f);if(u>(.12+.25*G)*Math.min(1,.5+.5*Y))continue;const z=fe(a,s,f,3),_=se(a,s,f)+.6,p=l(t+2111,e+23),m=p>.94,N=l(t,e+2109),I=m?.12:p<.4?.04+.04*N:p<.8?.1+.06*N:.2+.2*N,R=l(t+7,e+2107),F=m?(.3+.3*R)*z:Math.min((p<.8?3+11*R:1.5+4*R)*(.8+.5*G),.25*z),C=.8+.5*l(t+2113,e+29),L=[.22*C,.21*C,.23*C];$(s,f,_,F*I,F,0,k.stalactite,u*20,Te,L,0,ae);const O=l(t+2115,e+31)<.4?1+Math.floor(3*l(t+2117,e+37)):0;for(let S=0;S<O;S++){const b=l(t+S*11,e+2119)*6.283,x=Math.max(1.2,2*F*I)*(1+1.5*l(t+2121,e+S)),E=s+Math.cos(b)*x,U=f+Math.sin(b)*x,H=F*(.3+.45*l(t+S,e+2123));w(E,U)>.2||$(E,U,se(a,E,U)+.6,H*I*(.8+.5*l(t+2125,e+S)),H,0,k.stalactite,b,Te,L,0,ae)}if(l(t+2127,e+41)<.3&&G<.05&&!y(s,f)&&!M(s,f,3)){const S=o.height(s,f);if(S!==void 0){const b=Math.min(F*(.35+.5*l(t+2129,e+43)),.5*(_-S-F));b>.6&&$(s,f,S-.2,b*(.22+.16*l(t+2131,e+47)),-b,0,k.stalactite,u*13,0,[L[0]*1.15,L[1]*1.15,L[2]*1.15],0,ae)}}}}for(let e=Math.floor(V/33);e<=Math.ceil(X/33);e++){yield;for(let t=Math.floor(B/33);t<=Math.ceil(J/33);t++){if(l(t+3301,e+53)>.07*Math.min(1,.5+.5*Y))continue;const u=(t+.1+.8*l(t+3,e+3303))*33,s=(e+.1+.8*l(t+3305,e+5))*33;if(T(u,s)>h||w(u,s)>.2||o.water(u,s)>=.05||y(u,s)||M(u,s,3))continue;const f=1+Math.floor(3*l(t+3307,e+59)**2),G=l(t+3309,e+61),z=.85+.4*l(t+3311,e+67);for(let _=0;_<f;_++){const p=l(t+_*13,e+3313)*6.283,m=_?1.5+4*l(t+3315,e+_):0,N=u+Math.cos(p)*m,I=s+Math.sin(p)*m,R=o.height(N,I);if(R===void 0)continue;const F=Math.min((1.2+8*G**2)*(_?.4+.4*l(t+3317,e+_):1),.45*W(N,I,R));F<.5||$(N,I,R-.2,F*(.18+.2*l(t+3319,e+_)),-F,0,k.stalactite,p,0,[.25*z,.24*z,.25*z],0,ae)}}}c.sort((e,t)=>e[0]-t[0]);const D=c.slice(0,$t),ge=[0,0,0],Z=D.map(e=>{const t=Math.sqrt(e[0]),u=Math.abs(e[5]);return t<25||u>=4&&t<150?0:u>=1.5?1:2});let g=0;for(let e=0;e<D.length;e++)Z[e]===0&&++g>Tt&&(Z[e]=Math.abs(D[e][5])>=1.5?1:2);const oe=D.map((e,t)=>t).sort((e,t)=>Z[e]-Z[t]||D[e][0]-D[t][0]);for(const e of Z)ge[e]++;const P=new Float32Array(D.length*Oe);return oe.forEach((e,t)=>P.set(D[e].slice(1),t*Oe)),{values:P,counts:ge}}function no(o,n){const a=Dt(o,n);let i=a.next();for(;!i.done;)i=a.next();return i.value}const de=o=>Number.isInteger(o)?`${o}.`:String(o),ze=lt,Le=ct,Ht=ze.flat().map(([o,n,a])=>`vec3(${de(o)},${de(n)},${de(a)})`).join(","),qt=Le.map(([o,n])=>`vec2(${de(o)},${de(n)})`).join(","),ao={vertex:`#version 300 es
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
const vec3 PROFILE[${ze.length*ue}]=vec3[${ze.length*ue}](${Ht});
const vec2 PART[${Le.length}]=vec2[${Le.length}](${qt});
// Profile ring of a lathe ring at a level of detail: all nine; foot, stem top, rim, apex; rim underside and apex.
int fungusK(int r){if(fungusLod==0)return clamp(r,0,8);if(fungusLod==1)return r<=0?0:r==1?2:r==2?5:8;return r<=0?4:8;}
vec2 fungusRing(int form,int k,float stem,float cap,float h){vec3 p=PROFILE[form*${ue}+clamp(k,0,${ue-1})];return vec2(p.x*stem+p.y*cap,p.z*h);}
void main(){
  int v=int(gl_VertexID),quad=v/6,corner=v-quad*6;
  int sides=fungusLod==0?${He}:6,band=quad/sides,seg=quad-band*sides;
  int dseg=corner==1||corner==2||corner==4?1:0,dring=corner==2||corner==4||corner==5?1:0;
  int ring=band+dring,form=int(fungusShape.z+.5);
  float flags=floor(fungusShape.w/8.),phase=fungusShape.w-8.*flags;
  float far=distance(fungusBase.xy,fungusFade.xy);
  // Low mushrooms (under 1.5 m) only near the eye, larger forms to the far radius.
  float fade=1.-(fungusShape.x<1.5&&fungusShape.x>0.?smoothstep(${($e*.75).toFixed(1)},${$e.toFixed(1)},far):smoothstep(fungusFade.z,fungusFade.w,far));
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
}`},jt=(o,n)=>K(.04,.2,Q(o-517,n+233,520)+.2*K(.05,.25,Q(o+191,n+23,240)-.1)-.1);export{At as B,oo as F,Pt as R,to as W,we as a,gt as b,Rt as c,Et as d,no as e,Dt as f,ie as g,$e as h,Oe as i,ao as j,zt as k,be as l,Zt as m,j as n,Yt as o,Xt as p,De as q,Qt as r,Ee as s,eo as t,Jt as w,Gt as y};
