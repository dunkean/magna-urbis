import{bF as Ae,bG as be,bH as Ye,bI as Fe,bJ as Ve,bK as Xe,bL as Je,bM as Ze,l as Qe,bN as et,u as tt,bO as He,bP as ot,bQ as nt,bR as at,bS as st,bT as it,bU as rt,bV as ct,bW as lt,bX as de,bY as x,bZ as Pe,b_ as ft,b$ as ut,c0 as ht}from"./studio-BG8bIq0T.js";import{m as dt,aG as mt,af as gt,aH as he,aI as re}from"./__vite-browser-external-Bev5k31X.js";import{M as vt}from"./rendererOverride-Dx2PMegm.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const pt=.1;function wt({normal:t,points:n}){if(t[2]<.999*Math.hypot(...t))return!1;const[a,s,c]=n;return Math.abs((s[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(s[1]-a[1]))/2>=pt}function yt(t){const n=new Uint8Array(t.length),a=new Map;for(let s=0;s<t.length;s++){const{surface:c,normal:r,points:f,material:v,materials:b,hiddenEdge:w}=t[s],y=v??b.cladding;if(c!=="roof"||r[2]<=.001||/^city3d:(tree|road|water)/.test(y)||y.startsWith("city3d:wall")&&!wt(t[s]))continue;const D=f.map(G=>G.map(U=>Math.round(U*1e3)).join(",")),d=Math.hypot(...r);n[s]=7;for(let G=0;G<3;G++){const U=(G+1)%3,V=1<<G;if(U===w){n[s]&=~V;continue}const $=D[U],j=D[(G+2)%3],K=$<j?`${$}|${j}`:`${j}|${$}`,H=a.get(K);if(!H){a.set(K,{face:s,bit:V});continue}const B=t[H.face].normal;(r===B||r[0]*B[0]+r[1]*B[1]+r[2]*B[2]>=.99999*d*Math.hypot(...B))&&(n[H.face]&=~H.bit,n[s]&=~V)}}return n}const ke=10;function xt(t){const n=[1/0,1/0,t.ground_z_m,-1/0,-1/0,t.ground_z_m+Ae(t)],a=be(t)?[]:t.structural_features;for(const s of[t.footprint,t.roof_footprint,...a.map(c=>c.surface)])for(const c of s)for(const r of c.outer)n[0]=Math.min(n[0],r.x),n[1]=Math.min(n[1],r.y),n[3]=Math.max(n[3],r.x),n[4]=Math.max(n[4],r.y);if(!be(t))for(const s of[...t.volumes.map(c=>c.foundation),...t.structural_foundations??[]])s&&(n[2]=Math.min(n[2],s.z_min_m));for(const s of a)n[2]=Math.min(n[2],s.z_m),n[5]=Math.max(n[5],s.z_m+s.height_m);for(const s of a)for(const c of s.vertices3d){const r=[c.x,c.y,c.z];for(let f=0;f<3;f++)n[f]=Math.min(n[f],r[f]),n[f+3]=Math.max(n[f+3],r[f])}return n}const Ee=t=>/^city3d-(wall|bridge|quay|harbour|stairs)/.test(t.id)||!Number.isFinite(t.ground_z_m)?1/0:t.ground_z_m,bt=(t,n,a,s,c,r,f)=>{f[0]=c,f[1]=r??Math.min(c,n)},kt=(t,n)=>t+(n===void 0?0:64*Math.max(1,Math.min(15,Math.round(n*15))));function se(t){return t.startsWith("rgb")?t.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255):[1,3,5].map(n=>parseInt(t.slice(n,n+2),16)/255)}function Mt(t){const n=/^city3d:(cover|wall|road):(.+)$/.exec(t??"");return n?n[1]==="cover"?ot(n[2]):n[1]==="wall"?nt(n[2]):He.road[n[2]]??-1:-1}const _t={tile:1,pantile:2,glazed:3,slate:4,slab:5,paving:6,thatch:7,reed:8,palm:9,turf:10,shingle:11,bark:12,bamboo:13,earth:14,lime:15,metal:16,felt:17,hide:18},St={plaster:19,timber:20,wood:21,brick:22,stone:23,earth:24,wattle:25,bamboo:26,coral:27,hide:18,ashlar:29,concrete:30,glass:31,steel:16},It=28,zt=32,Nt=33,Lt=34,we=new Map,ye=new Map;function Ct(t){let n=we.get(t);return n===void 0&&(we.size>4096&&we.clear(),we.set(t,n=/^city3d:(cover|wall):([a-z]+)$/.exec(t))),n}function Rt(t){const n=t??"";let a=ye.get(n);return a===void 0&&(ye.size>4096&&ye.clear(),ye.set(n,a=/@([0-9a-f]{6}|[0-9a-f]{3})$/.exec(n))),a}function At(t,n,a){const s=Ct(t??"");if(!s)return 0;if(s[1]==="wall")return St[s[2]]??0;const c=at(s[2],Math.abs(n[2])>.995*(Math.hypot(n[0],n[1],n[2])||1),a);return c?_t[c]:0}function Et(t,n,a){if(a<0)return[0,0];const s=st(a),c=n[0],r=n[1],f=Math.abs(n[2]),v=Math.hypot(c,r);if(f<.3&&v>1e-6)return[(t[0]*-r+t[1]*c)/v/s,-t[2]/s];if(v<.02)return[t[0]/s,t[1]/s];const b=c/v,w=r/v;return[(-t[0]*w+t[1]*b)/s,(t[0]*b+t[1]*w)/Math.max(f,.2)/s]}const Me=new Float64Array(2);function xe(t,n,a,s,c,r,f=bt){const v=a.appearance,b=new Map,w=!!v.textured,y={materials:a.materials};for(const d of t){const G=new Map,U=d.culture?.culture??"";let V=2166136261;for(let g=0;g<d.id.length;g++)V=Math.imul(V^d.id.charCodeAt(g),16777619);const $=Math.round((V>>>0)/4294967295*15)/15,j=d.programme,K=`${j?.role??""}${j?.landmark?" monument":""}`,H=Ee(d),B=Number.isFinite(H)&&!d.id.startsWith("city3d-"),Z=a.roofInk&&B&&v.diagnostic==="none",le=a.look&&!w&&v.diagnostic==="none"?a.look.item(d.id):void 0;let fe,oe,ne;const ve=(g,ae=0,O=0)=>{const e=g.material??(g.surface==="roof"?g.materials.cladding:g.materials.coating),o=Rt(e),h=o?e.slice(0,o.index):e,i=le&&g.surface!=="yard"?Xe(g.materials):void 0;let u;if(i&&g.surface==="roof"&&h?.startsWith("city3d:cover:")){if(g.normal!==fe||g.materials!==oe){const I=Je(a.look.frame,le,{...i,normal:g.normal});ne={color:se(I.color),gain:I.gain,family:I.family},fe=g.normal,oe=g.materials}u=ne}const C=!!i&&e===g.materials.coating,z=B&&(v.roof==="minimal"||v.roof==="flat"&&g.surface==="roof"),k=w&&!z&&!O&&g.surface!=="yard"?Mt(h??(g.surface==="roof"?g.materials.cladding:g.materials.coating)):-1;let p=G.get(g.surface);p||G.set(g.surface,p=new Map);let m=u?.color??p.get(String(e));if(!m&&C&&(m=se(Ze(a.look.frame,le,i)),p.set(String(e),m)),!m){const I=Qe(g.materials,d.function,Ae(d),v,h,y);if(m=se(g.surface==="roof"?I.roof:I.wall),v.diagnostic==="none"||g.surface==="yard"){if(o?.[1].length===6)m=se(`#${o[1]}`);else if(o)m=m.map((Y,Q)=>Math.min(1,Y*parseInt(o[1][Q],16)/8));else if(U&&!d.id.startsWith("city3d-")){const Y=Ke=>/(?:^|[:/_-])(timber|wood|brick|stone|earth|plaster|bamboo|wattle|hide|coral|tile|slate|thatch|reed|palm|shingle|bark|turf|felt|snow|metal|lead)(?:$|[:/_-])/.exec(Ke)?.[1]??"",Q=Y(g.materials.coating||g.materials.infill),ue=Y(g.materials.cladding),Ge=et(U,Q,ue,$,K+(/tower|minaret|stone/.test(h)?" monument":""));m=g.surface==="roof"?Ge.roof:Ge.wall}}g.surface==="roof"&&v.diagnostic==="none"&&v.colors?.building&&(m=se(v.colors.building));const q=/^city3d:tree:(crown|trunk)$/.exec(h??"");q&&(m=se(o?.[1].length===6?`#${o[1]}`:q[1]==="crown"?"#5f8247":"#4b5a36")),h==="city3d:water"&&(m=se("#"+(o?.[1]??"8aaeb8"))),p.set(String(e),m)}O&&(m=tt(m,O,-(g.normal[0]+g.normal[1])*.4));const _=v.diagnostic==="none"&&(!!v.colors?.building&&g.surface==="roof"||o?.[1].length===6||!!U&&!d.id.startsWith("city3d-")),M=!w&&!z&&g.surface!=="yard"&&v.style==="cartographic"&&v.diagnostic==="none"?O>=.4?It:u?u.family:At(h,g.normal,U):0,S=g.lateral,R=S?g.normal[2]>.5?Lt:Nt:h==="city3d:wall:lit"?zt:M,T=(1+kt(R,u?.gain)/32)/(S?1:Math.hypot(g.normal[0],g.normal[1],g.normal[2])||1),F=w?`${m.join(",")}|${k}|${_}|${!!O}`:O?"vertex-colour|true":"vertex-colour|false";let A=b.get(F);if(!A){const I=He.layers[k]?.mean_rgb,Y=I&&_?m.map((Q,ue)=>Q/Math.max(.04,I[ue]/255)):o?.[1].length===3?[...o[1]].map(Q=>parseInt(Q,16)/8):[1,1,1];A={batch:{color:w?m:[1,1,1],tint:Y,recolored:_,vcolor:!w,palette:[],stride:ke,data:new Float32Array(4096)},length:0,seen:a.collectPalette===!1?void 0:new Set},b.set(F,A)}const E=A.batch,L=g.points;if(A.seen&&(O||!A.seen.has(m))&&(O||A.seen.add(m),E.palette.some(I=>I[0]===m[0]&&I[1]===m[1]&&I[2]===m[2])||E.palette.push(m)),A.length+L.length*ke>E.data.length){const I=new Float32Array(Math.max(E.data.length*2,A.length+L.length*ke));I.set(E.data.subarray(0,A.length)),E.data=I}const N=E.data;let P=A.length;for(let I=0;I<L.length;I++){const q=L[I];f(d,H,q[0],q[1],q[2],g.ground?.[I],Me),N[P++]=q[0]-n[0],N[P++]=Me[0],N[P++]=q[1]-n[1],N[P++]=(S?S[I].x:g.normal[0])*T,N[P++]=(S?0:g.normal[2])*T,N[P++]=(S?S[I].y:g.normal[1])*T;const Y=ae&~(1<<I);if(w){const[Q,ue]=Et(q,g.normal,k);N[P++]=Q,N[P++]=ue,N[P++]=k+Y/8}else N[P++]=Y&1?-m[0]:m[0],N[P++]=Y&2?-m[1]:m[1],N[P++]=Y&4?-m[2]:m[2];N[P++]=Me[1]}A.length=P},W=v.style!=="silhouette"&&v.diagnostic==="none"?dt(a.snowAltitudes.get(d.id)??d.ground_z_m,v.roofSnow):0,pe=W?Ye(d.function):0,ee=(g,ae=0)=>{const O=g.material??g.materials.cladding,o=W&&g.surface==="roof"&&!/^city3d:(wall|tree|road|water)/.test(O)&&!d.id.startsWith("city3d-")?Ve(g.normal,-(g.normal[0]+g.normal[1])*.4,pe,/^city3d:cover:([a-z]+)/.exec(O)?.[1]):0;ve(g,ae,W*Math.round(o*8)/8)};if(Z){const g=[];Fe(d,O=>g.push(O),s,c,r,a.yardStrips);const ae=yt(g);g.forEach((O,e)=>ee(O,ae[e]))}else Fe(d,ee,s,c,r,a.yardStrips)}const D=[];for(const{batch:d,length:G}of b.values())G&&(d.data=d.data.slice(0,G),D.push(d));return D}const me=256,X=4,Te=me/X,Gt=12,Ft=64,_e=[0,0];function Pt(t,n,a,s,c){const r=Ee(t);if(Number.isFinite(r)){c[0]=(r+Math.min(0,n[2]-r))*s,c[1]=r*s+Math.max(0,n[5]-r);return}c[0]=1/0,c[1]=-1/0;for(let f=0;f<4;f++){const v=a.heightAt(n[f&1?3:0],n[f&2?4:1]);c[0]=Math.min(c[0],v-1),c[1]=Math.max(c[1],v+(n[5]-n[2]))}}class no{constructor(n,a,s){this.scene=n,this.relief=a,this.exaggeration=s}blocks=[];altitudes=new Tt;byKey=new Map;next=0;step(n){const a=this.scene.buildings,s=this.relief,c=this.exaggeration;for(;this.next<a.length;){const r=a[this.next++],f=xt(r),v=(f[0]+f[3])/2,b=(f[1]+f[4])/2,w=rt(r),y=[Math.floor(v/me)*me,Math.floor(b/me)*me],D=`${y}${w?"/yard":""}`;let d=this.byKey.get(D);d||(this.byKey.set(D,d={origin:y,buildings:[],yard:w,width:0,ground:0,minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0,low:1/0,high:-1/0,levels:3,cells:new Int32Array(X*X+1),cellOf:[]}),this.blocks.push(d)),d.buildings.push(r),d.cellOf.push(Math.min(X-1,Math.floor((v-y[0])/Te))+X*Math.min(X-1,Math.floor((b-y[1])/Te))),this.altitudes.add(r);const G=Math.min(f[3]-f[0],f[4]-f[1]),U=w?1:Math.max(.25,G*Math.min(Gt,Math.max(f[3]-f[0],f[4]-f[1])));if(d.width+=(w?1:Math.max(1,G))*U,d.ground+=U,d.minX=Math.min(d.minX,f[0]),d.minY=Math.min(d.minY,f[1]),d.maxX=Math.max(d.maxX,f[3]),d.maxY=Math.max(d.maxY,f[4]),Pt(r,f,s,c,_e),d.low=Math.min(d.low,_e[0]),d.high=Math.max(d.high,_e[1]),this.next%Ft===0&&performance.now()>n)return!1}if(this.next===a.length){for(const r of this.blocks){r.width/=r.ground;const f=r.cellOf,v=r.cells,b=new Array(f.length);for(const y of f)v[y+1]++;for(let y=0;y<X*X;y++)v[y+1]+=v[y];const w=v.slice(0,X*X);for(let y=0;y<f.length;y++)b[w[f[y]]++]=r.buildings[y];for(let y=0;y<b.length;y++)r.buildings[y]=b[y];r.cellOf=void 0}this.next++}return!0}}function ao(t,n){const a=n>0?1/n:1;return(s,c,r,f,v,b,w)=>{if(b===void 0&&Number.isFinite(c)){w[0]=v>=c?v-c:(v-c)*n,w[1]=c*n;return}const y=t.groundAt?t.groundAt(r,f):t.heightAt(r,f);w[0]=v-(b??y*a),w[1]=y}}class Tt{towns=new Map;owners=new Map;add(n){const a=n.parcel_id?.split("/")[0],s=a?.startsWith("layout-")?a:n.id;let c=this.towns.get(s);c||this.towns.set(s,c={sum:0,count:0}),Number.isFinite(n.ground_z_m)&&(c.sum+=n.ground_z_m,c.count++),this.owners.set(n.id,s)}get(n){const a=this.owners.get(n),s=a===void 0?void 0:this.towns.get(a);return s?s.count?s.sum/s.count:0:void 0}}function so(t,n,a,s){return{appearance:{...n,textured:!1,ambience:void 0,lightsOn:void 0},materials:t.materials??[],collectPalette:!1,roofInk:n.roof==="v1",yardStrips:!0,snowAltitudes:a,look:s}}function io(t,n,a,s,c,r){const f=t.buildings.slice(c,r);if(t.yard)return Se(xe(f,t.origin,a,n>0,void 0,n,s).map(d=>d.data));if(n!==Le)return Se(xe(f,t.origin,a,n>0,void 0,void 0,s).map(d=>d.data));const v=a.appearance.roof==="minimal",b=d=>Ot(d)&&(!v||d.id.startsWith("city3d-")),w=f.filter(b),y=w.length?f.filter(d=>!b(d)):f,D=[...xe(y.map(d=>Ut(d,v)),t.origin,a,!0,void 0,void 0,s),...w.length?xe(w,t.origin,a,!1,void 0,void 0,s):[]];return Se(D.map(d=>d.data))}function Se(t){if(t.length===1)return t[0];let n=0;for(const c of t)n+=c.length;const a=new Float32Array(n);let s=0;for(const c of t)a.set(c,s),s+=c.length;return a}const Le=2,je=t=>t.levels,Ot=t=>!be(t)&&t.volumes.some(n=>n.envelope==="open");function Ut(t,n=!1){if(!Number.isFinite(Ee(t))||n&&t.id.startsWith("city3d-"))return t;const a=n||!t.roof_footprint.length?t.footprint:t.roof_footprint;if(be(t))return a===t.roof_footprint?t:{...t,roof_footprint:a};if(!t.volumes.length)return t;const s=[...t.volumes.map(r=>r.foundation),...t.structural_foundations??[]].reduce((r,f)=>f?Math.min(r,f.z_min_m):r,t.ground_z_m);return{...t,...{base_z_m:s},roof_footprint:a,projection:"native-building-visual-1",height_m:Ae(t),materials:t.volumes[0].materials,volumes:void 0,structural_features:void 0,structural_foundations:void 0}}const Oe=[10,6,3],qe=.15,$t=2;function ro(t,n){return n[0]=qe/t,n[1]=$t*n[0],n}const co=9;function Bt(t,n,a=0,s=1/0,c=1){const r=je(t);if(n*c<qe*(a===r?1.15:1))return r;const f=s<(a===0?.85:1)?1:0;return Math.max(f,it(n,a))}function lo(t,n,a=!1,s=1,c=!1){const r=je(t);if(t.yard)return Bt(t,n,0,1/0,s);for(let f=a==="overview"?1:a?Le:0;f<Oe.length;f++)if(n*s>=Oe[f])return f;return c||s>=mt?Le:r}const Dt=`
float baseOcclusion(vec3 normal,vec3 p){
  if(abs(normalize(normal).y)>.5||p.y<-1000.)return 1.;
  return mix(.72,1.,smoothstep(0.,2.4,p.y));
}
uniform int uNight;
${vt}
${ct}
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
`,Ht=`
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
`,jt=`
float roofInk(vec3 edge, vec3 gx, vec3 gy, float dpr){
  vec3 ex=dFdx(edge),ey=dFdy(edge);
  vec3 edgePixel=sqrt(ex*ex+ey*ey);
  float reach=.32*dpr;
  if(all(greaterThanEqual(edge,edgePixel*(reach+.5))))return 0.;
  vec3 d=edge/max(edgePixel,vec3(1.e-6));
  float mpp=sqrt(max(dot(gx.xz,gx.xz),dot(gy.xz,gy.xz)))*dpr;
  return (1.-smoothstep(max(0.,reach-.5),reach+.5,min(d.x,min(d.y,d.z))))*.38*(1.-smoothstep(1.5,4.,mpp));
}
`,fo=`#version 300 es
precision highp float;
precision highp int;
// Block-local x, height above the seat (m), block-local y; the normal in the 3D view's frame (x, up, y south) with the
// material class on its length (classes 33 and 34: side and top of a lot boundary strip, the side it lies on instead); the colour; the terrain height under the building, metres as drawn at full relief.
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
// Lot boundary strips: CSS pixels per metre at a depth of one metre, pixels per metre between which they rise from the ground.
uniform vec3 uYard;
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
  vec3 place=position;
  if(materialClass>32.5){
    // A strip of lot boundary: its normal is the side of the line the vertex lies on. It stays about a pixel wide however
    // far, and sinks into the ground before its block is left out: no width or presence ever jumps.
    float pixels=uYard.x/max((uProjection*vec4(uBlock.xy+place.xz,(seat+place.y)*uRise+uBlock.z,1.)).w,1.);
    float stand=smoothstep(uYard.y,uYard.z,pixels);
    place.xz+=n.xz*(stand*clamp(.42/pixels-.1,0.,1.2));
    place.y*=stand;
    n=materialClass>33.5?vec3(0.,1.,0.):n;
    materialClass=0.;
  }
  grainPosition=place;facadePosition=place;
  vec3 world=vec3(uBlock.xy+place.xz,(seat+place.y)*uRise+uBlock.z);
  vDistance=length(world-uEye);
  gl_Position=uProjection*vec4(world,1.);
  // Orthographic plan pixels ignore height; the depth buffer still chooses the uppermost roof.
  if(uTop) gl_Position.z=clamp(-(seat+place.y)*.00001,-.95,.95);
}`,uo=`#version 300 es
precision highp float;
in vec3 n; in vec3 base; in vec3 facadePosition; in vec3 grainPosition; flat in float materialClass; flat in float townGain; in float vDistance;
in vec3 roofEdge; uniform float uRoofInkDpr;
// Haze distance (m) and share; haze colour.
uniform vec2 uAir;
uniform vec3 uHaze;
out vec4 color;
${Dt}
${Ht}
${lt}
${jt}
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
}`,We=10,qt=We*(de-1)*6,ho=[qt,108,36],Wt=800,Ue=12,Ie=1,ze=2,$e=4,ie=0,Kt=1,Be=2,ce=700,De=160,Yt=32e3;function l(t,n){const a=Math.floor(t)|0,s=Math.floor(n)|0;let c=(Math.imul(a,374761393)^Math.imul(s,668265263)^2654435769)>>>0;return c=Math.imul(c^c>>>13,1274126177)>>>0,c=(c^c>>>16)>>>0,c/4294967296}function Vt(t,n){const a=Math.floor(t),s=Math.floor(n),c=t-a,r=n-s,f=c*c*(3-2*c),v=r*r*(3-2*r),b=l(a,s),w=l(a+1,s),y=l(a,s+1),D=l(a+1,s+1);return(b+(w-b)*f)*(1-v)+(y+(D-y)*f)*v}function te(t,n,a){let s=0,c=.5,r=0;for(let f=0;f<4;f++)s+=c*(Vt(t/a+f*17.31,n/a+f*9.17)-.5),r+=c,a*=.5,c*=.55;return s/r}const J=(t,n,a)=>{const s=Math.min(1,Math.max(0,(a-t)/(n-t)));return s*s*(3-2*s)},Ne=new WeakMap;function*Xt(t,n){const{cavern:a,abundance:s}=t,c=[];if(s<=0)return{values:new Float32Array(0),counts:[0,0,0]};const r=t.occupation,f=r?.ways?.length?Ne.get(r.ways)??(Ne.set(r.ways,new gt(r.ways,[])),Ne.get(r.ways)):void 0,v=(e,o)=>{if(!r)return!1;const h=Math.floor((e-r.x)/r.width*r.n),i=Math.floor((o-r.y)/r.width*r.n);if(h<0||i<0||h>=r.n||i>=r.n)return!1;const u=r.rgba[(i*r.n+h)*4+2];return u===4||u===8||u===9||u===11||u===12},b=(e,o,h)=>{const i=t.towns;if(i)for(let u=0;u+2<i.length;u+=3){const C=e-i[u],z=o-i[u+1],k=i[u+2]*.7+h;if(C*C+z*z<k*k)return!0}return f&&!f.keeps(e,o,h+.5)?!0:v(e,o)},w=(e,o)=>he(a,e,o,0),y=(e,o)=>{if(!r)return!1;const h=Math.floor((e-r.x)/r.width*r.n),i=Math.floor((o-r.y)/r.width*r.n);return h>=0&&i>=0&&h<r.n&&i<r.n&&r.rgba[(i*r.n+h)*4+2]===ft},D=(e,o)=>Math.hypot(t.raw(e+3,o)-t.raw(e-3,o),t.raw(e,o+3)-t.raw(e,o-3))/6,d=ce*ce,G=(e,o)=>(e-n.x)**2+(o-n.y)**2,U=(e,o)=>{const h=Math.min(1,t.water(e,o)*1.5),i=J(.12,.45,D(e,o)+.15*te(e*1.7+31,o*1.7+5,60)),u=J(.05,.25,te(e+191,o+23,240)+.25*h-.1)*(1-i),C=J(.04,.2,te(e-517,o+233,520)+.1*h+.2*u-.1)*(1-i)*(1-J(.15,.45,h)),z=J(.12,.32,te(e+911,o+377,420)+.3*u);return{wet:h,rocky:i,moss:u,grove:C,cluster:z}},V=(e,o,h)=>re(a,e,o)-h,$=(e,o,h,i,u,C,z,k,p,m,_,M)=>{c.push([G(e,o),e,o,h,i,u,C,z,(k%6.2831853+6.2831853)%6.2831853+8*p,m[0],m[1],m[2],Math.min(_,.99)+2*M])},j=n.x-ce,K=n.x+ce,H=n.y-ce,B=n.y+ce,Z=Math.min(s,2),le=Pe;for(const[e,o,h]of[[31,0,0],[19,.37,.61]])for(let i=Math.floor(H/e+h);i<=Math.ceil(B/e+h);i++){yield;for(let u=Math.floor(j/e+o);u<=Math.ceil(K/e+o);u++){const C=l(u+17+o,i+233+h);if(C>.7)continue;const z=l(u+5,i+71)*.56+.22,k=l(u+61,i+2)*.56+.22,p=(u+z-o)*e,m=(i+k-h)*e;if(G(p,m)>d||w(p,m)>.35||(U(p,m),C>.7*Qt(p,m)||t.water(p,m)>=.05)||l(u+401,i+77)>.2*Z)continue;const _=Math.min(z,1-z,k,1-k)*e,M=Math.min(_*.95,e*(.16+.2*l(u+23,i+9)));if(M<.8||b(p,m,M))continue;const S=t.height(p,m);if(S===void 0)continue;const R=l(u+88,i+13),T=.8+.4*l(u+1,i+301),F=he(a,p,m,2),A=R<.45?x.parasol:R<.8?l(u+7,i+31)<.6?x.dome:x.bell:x.bell;let E=M*(A===x.parasol?2.4:A===x.dome?1.45:1.9)*(.85+.3*l(u+3,i+3))*(1+.35*F);E=Math.min(E,Math.max(2,V(p,m,S)-3));const L=l(u+7,i+7)>=.66;$(p,m,S,M,E,M*(A===x.parasol?.11:A===x.dome?.26:.17),A,l(u+9,i+4)*6.283,(R>.55&&R<.8?Ie:0)|ze,le[R<.45?0:R<.8?1:2].map(N=>N*T*1.25),L?.55:0,ie)}}const fe=.07-.07*(Z-1);for(let e=Math.floor(H/13);e<=Math.ceil(B/13);e++){yield;for(let o=Math.floor(j/13);o<=Math.ceil(K/13);o++){const h=l(o+1301,e+29);if(h>.45)continue;const i=(o+.15+.7*l(o+5,e+1303))*13,u=(e+.15+.7*l(o+1307,e+9))*13;if(G(i,u)>d||w(i,u)>.25)continue;const C=he(a,i,u,2);if(C<.2)continue;const z=J(fe,fe+.16,te(i-517,u+233,700)+.12*C),k=J(-.12,.08,te(i+77,u-913,110));if(h>.45*z*k*J(.2,.55,C)||t.water(i,u)>=.05||y(i,u))continue;const p=l(o+88,e+1313),m=p<.55?x.parasol:p<.8?x.dome:x.bell;let _=(10+24*l(o+1315,e+3)**1.5)*(.6+.5*C);const M=_*(m===x.parasol?.36:m===x.dome?.55:.42)*(.85+.3*l(o+1317,e+1));if(b(i,u,M+4))continue;const S=t.height(i,u);if(S===void 0)continue;_=Math.min(_,Math.max(3,re(a,i,u)-S-3));const R=Pe[p<.45?0:p<.8?1:2],T=(.85+.35*l(o+1319,e+7))*1.25;$(i,u,S,M,_,M*(m===x.parasol?.1:m===x.dome?.2:.15),m,h*60,(l(o,e+1321)<.3?Ie:0)|ze,R.map(F=>F*T),l(o+1323,e)>.5?.7:0,l(o+1325,e)>.5?ie:Kt)}}const oe=130,ne=44;for(let e=Math.floor((n.y-oe)/ne);e<=Math.floor((n.y+oe)/ne);e++)for(let o=Math.floor((n.x-oe)/ne);o<=Math.floor((n.x+oe)/ne);o++)yield;const ve=[x.dome,x.bell,x.cone,x.parasol,x.morel,x.puffball,x.club,x.funnel];for(let e=Math.floor(H/37);e<=Math.ceil(B/37);e++){yield;for(let o=Math.floor(j/37);o<=Math.ceil(K/37);o++){if(l(o+3701,e+41)>.14*Z)continue;const i=(o+.1+.8*l(o+3,e+3703))*37,u=(e+.1+.8*l(o+3705,e+7))*37;if(G(i,u)>d||w(i,u)>.3||t.water(i,u)>=.05||y(i,u)||b(i,u,2)||U(i,u).rocky>.6)continue;const z=1+Math.floor(5*l(o+3707,e+3)**2),k=l(o+3709,e+5);for(let p=0;p<z;p++){const m=l(o+p*13,e+3711)*6.283,_=p?1+3*l(o+3713,e+p):0,M=i+Math.cos(m)*_,S=u+Math.sin(m)*_,R=t.height(M,S);if(R===void 0)continue;const T=l(o+p*7,e+3715),F=ve[Math.floor(T*ve.length)],A=(.4+3.2*k**2)*(.55+.6*l(o+3717,e+p))*(p?.75:1),E=F===x.club?0:A*(F===x.parasol?.5:F===x.cone?.25:F===x.puffball?.55:F===x.funnel?.45:.36),L=.8+.4*l(o+3719,e+p);$(M,S,R,E,A,A*(F===x.club?.12:.08),F,T*6.283,F===x.dome&&T>.85?Ie:0,(T<.3?[.56,.52,.44]:T<.55?[.44,.3,.34]:T<.8?[.52,.38,.24]:[.34,.38,.32]).map(N=>N*L),l(o+3721,e+p)<.3?.75:0,Be)}}}for(let e=Math.floor(H/7);e<=Math.ceil(B/7);e++){yield;for(let o=Math.floor(j/7);o<=Math.ceil(K/7);o++){const h=(o+.2+.6*l(o+1501,e+3))*7,i=(e+.2+.6*l(o+7,e+1503))*7;if(G(h,i)>d)continue;const u=w(h,i);if(u<.45)continue;const C=re(a,h,i),z=6,k=w(h+z,i)-w(h-z,i),p=w(h,i+z)-w(h,i-z),m=Math.hypot(k,p);if(m<.02)continue;const _=-k/m,M=-p/m,S=Math.max(t.water(h+_*60,i+M*60),t.water(h+_*120,i+M*120)),R=he(a,h,i,3);if(u>=.75){if(w(h+_*14,i+M*14)>.5||l(o+1601,e+5)>(.22+.45*S)*Math.min(1,.5+.5*Z))continue;const L=h+_*(2+4*l(o+3,e+1605)),N=i+M*(2+4*l(o+1607,e+7));if(b(L,N,0)&&l(o,e+1609)<.5)continue;const P=Math.min((3+9*l(o+1611,e+1))*(.8+.5*S),.3*R),I=Math.min(C,re(a,L,N));$(L,N,I,P*(.05+.22*l(o+2,e+1613)**2),P,0,x.stalactite,l(o+9,e+9)*6.283,0,[.2,.19,.21],S>.2&&l(o+4,e+1615)<.15?.25:0,ie);continue}if(S<.05||l(o+1701,e+11)>.5*Math.min(Z,1.5))continue;const F=t.height(h+_*12,i+M*12);if(F===void 0||b(h,i,1))continue;const A=1+Math.floor(3*l(o+13,e+1703)),E=Math.atan2(M,_);for(let L=0;L<A;L++){const N=.7+1.6*l(o+L*3,e+1705),P=L*(1.1+.8*l(o+1707,e+L));$(h-_*N*.3,i-M*N*.3,Math.min(F+.6+P,C-2),N,N*.28,0,x.bracket,E,ze,l(o+L,e+1709)<.5?[.48,.36,.22]:[.4,.4,.34],l(o+1711,e+L)<.12?.5:0,Be)}}}for(let e=Math.floor(H/21);e<=Math.ceil(B/21);e++){yield;for(let o=Math.floor(j/21);o<=Math.ceil(K/21);o++){const h=l(o+2101,e+17);if(h>.3)continue;const i=(o+.1+.8*l(o+3,e+2103))*21,u=(e+.1+.8*l(o+2105,e+5))*21;if(G(i,u)>d||w(i,u)>.2)continue;const C=t.water(i,u);if(h>(.12+.25*C)*Math.min(1,.5+.5*Z))continue;const z=he(a,i,u,3),k=re(a,i,u)+.6,p=l(o+2111,e+23),m=p>.94,_=l(o,e+2109),M=m?.12:p<.4?.04+.04*_:p<.8?.1+.06*_:.2+.2*_,S=l(o+7,e+2107),R=m?(.3+.3*S)*z:Math.min((p<.8?3+11*S:1.5+4*S)*(.8+.5*C),.25*z),T=.8+.5*l(o+2113,e+29),F=[.22*T,.21*T,.23*T];$(i,u,k,R*M,R,0,x.stalactite,h*20,$e,F,0,ie);const A=l(o+2115,e+31)<.4?1+Math.floor(3*l(o+2117,e+37)):0;for(let E=0;E<A;E++){const L=l(o+E*11,e+2119)*6.283,N=Math.max(1.2,2*R*M)*(1+1.5*l(o+2121,e+E)),P=i+Math.cos(L)*N,I=u+Math.sin(L)*N,q=R*(.3+.45*l(o+E,e+2123));w(P,I)>.2||$(P,I,re(a,P,I)+.6,q*M*(.8+.5*l(o+2125,e+E)),q,0,x.stalactite,L,$e,F,0,ie)}if(l(o+2127,e+41)<.3&&C<.05&&!y(i,u)&&!b(i,u,3)){const E=t.height(i,u);if(E!==void 0){const L=Math.min(R*(.35+.5*l(o+2129,e+43)),.5*(k-E-R));L>.6&&$(i,u,E-.2,L*(.22+.16*l(o+2131,e+47)),-L,0,x.stalactite,h*13,0,[F[0]*1.15,F[1]*1.15,F[2]*1.15],0,ie)}}}}for(let e=Math.floor(H/33);e<=Math.ceil(B/33);e++){yield;for(let o=Math.floor(j/33);o<=Math.ceil(K/33);o++){if(l(o+3301,e+53)>.07*Math.min(1,.5+.5*Z))continue;const h=(o+.1+.8*l(o+3,e+3303))*33,i=(e+.1+.8*l(o+3305,e+5))*33;if(G(h,i)>d||w(h,i)>.2||t.water(h,i)>=.05||y(h,i)||b(h,i,3))continue;const u=1+Math.floor(3*l(o+3307,e+59)**2),C=l(o+3309,e+61),z=.85+.4*l(o+3311,e+67);for(let k=0;k<u;k++){const p=l(o+k*13,e+3313)*6.283,m=k?1.5+4*l(o+3315,e+k):0,_=h+Math.cos(p)*m,M=i+Math.sin(p)*m,S=t.height(_,M);if(S===void 0)continue;const R=Math.min((1.2+8*C**2)*(k?.4+.4*l(o+3317,e+k):1),.45*V(_,M,S));R<.5||$(_,M,S-.2,R*(.18+.2*l(o+3319,e+k)),-R,0,x.stalactite,p,0,[.25*z,.24*z,.25*z],0,ie)}}}c.sort((e,o)=>e[0]-o[0]);const W=c.slice(0,Yt),pe=[0,0,0],ee=W.map(e=>{const o=Math.sqrt(e[0]),h=Math.abs(e[5]);return o<25||h>=4&&o<150?0:h>=1.5?1:2});let g=0;for(let e=0;e<W.length;e++)ee[e]===0&&++g>Wt&&(ee[e]=Math.abs(W[e][5])>=1.5?1:2);const ae=W.map((e,o)=>o).sort((e,o)=>ee[e]-ee[o]||W[e][0]-W[o][0]);for(const e of ee)pe[e]++;const O=new Float32Array(W.length*Ue);return ae.forEach((e,o)=>O.set(W[e].slice(1),o*Ue)),{values:O,counts:pe}}function mo(t,n){const a=Xt(t,n);let s=a.next();for(;!s.done;)s=a.next();return s.value}const ge=t=>Number.isInteger(t)?`${t}.`:String(t),Ce=ht,Re=ut,Jt=Ce.flat().map(([t,n,a])=>`vec3(${ge(t)},${ge(n)},${ge(a)})`).join(","),Zt=Re.map(([t,n])=>`vec2(${ge(t)},${ge(n)})`).join(","),go={vertex:`#version 300 es
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
const vec3 PROFILE[${Ce.length*de}]=vec3[${Ce.length*de}](${Jt});
const vec2 PART[${Re.length}]=vec2[${Re.length}](${Zt});
// Profile ring of a lathe ring at a level of detail: all nine; foot, stem top, rim, apex; rim underside and apex.
int fungusK(int r){if(fungusLod==0)return clamp(r,0,8);if(fungusLod==1)return r<=0?0:r==1?2:r==2?5:8;return r<=0?4:8;}
vec2 fungusRing(int form,int k,float stem,float cap,float h){vec3 p=PROFILE[form*${de}+clamp(k,0,${de-1})];return vec2(p.x*stem+p.y*cap,p.z*h);}
void main(){
  int v=int(gl_VertexID),quad=v/6,corner=v-quad*6;
  int sides=fungusLod==0?${We}:6,band=quad/sides,seg=quad-band*sides;
  int dseg=corner==1||corner==2||corner==4?1:0,dring=corner==2||corner==4||corner==5?1:0;
  int ring=band+dring,form=int(fungusShape.z+.5);
  float flags=floor(fungusShape.w/8.),phase=fungusShape.w-8.*flags;
  float far=distance(fungusBase.xy,fungusFade.xy);
  // Low mushrooms (under 1.5 m) only near the eye, larger forms to the far radius.
  float fade=1.-(fungusShape.x<1.5&&fungusShape.x>0.?smoothstep(${(De*.75).toFixed(1)},${De.toFixed(1)},far):smoothstep(fungusFade.z,fungusFade.w,far));
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
}`},Qt=(t,n)=>J(.04,.2,te(t-517,n+233,520)+.2*J(.05,.25,te(t+191,n+23,240)-.1)-.1);export{Dt as B,ho as F,jt as R,uo as W,co as Y,xe as a,xt as b,Ut as c,Ht as d,mo as e,Xt as f,ce as g,De as h,Ue as i,go as j,Pt as k,ke as l,io as m,X as n,ao as o,no as p,je as q,lo as r,Te as s,fo as t,ro as u,so as w,Bt as y};
