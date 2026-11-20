import{at as te,au as j,av as Me,aw as de,ax as Ie,ay as Le,az as ze,aA as Ne,l as Ce,aB as Se,u as Pe,aC as ve,aD as Ee,aE as Ae,aF as Ge,aG as Oe,aH as Re,aI as Be,aJ as De,aK as $e}from"./studio-DI1PBxu-.js";import{m as Te,ab as Fe}from"./__vite-browser-external-Bh6MCN6K.js";import{M as He}from"./rendererOverride-DPKjaXqS.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function We(t){const e=new Uint8Array(t.length),n=new Map;for(let o=0;o<t.length;o++){const{surface:i,normal:l,points:r,material:c,materials:m}=t[o];if(i!=="roof"||l[2]<=.001||/^city3d:(wall|tree|road|water)/.test(c??m.cladding))continue;const d=r.map(v=>v.map(a=>Math.round(a*1e3)).join(",")),f=Math.hypot(...l);e[o]=7;for(let v=0;v<3;v++){const a=d[(v+1)%3],I=d[(v+2)%3],C=1<<v,E=a<I?`${a}|${I}`:`${I}|${a}`,A=n.get(E);if(!A){n.set(E,{face:o,bit:C});continue}const z=t[A.face].normal;(l===z||l[0]*z[0]+l[1]*z[1]+l[2]*z[2]>=.99999*f*Math.hypot(...z))&&(e[A.face]&=~A.bit,e[o]&=~C)}}return e}const V=10;function Ke(t){const e=[1/0,1/0,t.ground_z_m,-1/0,-1/0,t.ground_z_m+te(t)],n=j(t)?[]:t.structural_features;for(const o of[t.footprint,t.roof_footprint,...n.map(i=>i.surface)])for(const i of o)for(const l of i.outer)e[0]=Math.min(e[0],l.x),e[1]=Math.min(e[1],l.y),e[3]=Math.max(e[3],l.x),e[4]=Math.max(e[4],l.y);if(!j(t))for(const o of[...t.volumes.map(i=>i.foundation),...t.structural_foundations??[]])o&&(e[2]=Math.min(e[2],o.z_min_m));for(const o of n)e[2]=Math.min(e[2],o.z_m),e[5]=Math.max(e[5],o.z_m+o.height_m);for(const o of n)for(const i of o.vertices3d){const l=[i.x,i.y,i.z];for(let r=0;r<3;r++)e[r]=Math.min(e[r],l[r]),e[r+3]=Math.max(e[r+3],l[r])}return e}const oe=t=>/^city3d-(wall|bridge|quay|harbour)/.test(t.id)||!Number.isFinite(t.ground_z_m)?1/0:t.ground_z_m,je=(t,e,n,o,i,l,r)=>{r[0]=i,r[1]=l??Math.min(i,e)},qe=(t,e)=>t+(e===void 0?0:64*Math.max(1,Math.min(15,Math.round(e*15))));function P(t){return t.startsWith("rgb")?t.match(/[\d.]+/g).slice(0,3).map(Number).map(e=>e/255):[1,3,5].map(e=>parseInt(t.slice(e,e+2),16)/255)}function Ue(t){const e=/^city3d:(cover|wall|road):(.+)$/.exec(t??"");return e?e[1]==="cover"?Ee(e[2]):e[1]==="wall"?Ae(e[2]):ve.road[e[2]]??-1:-1}const Xe={tile:1,pantile:2,glazed:3,slate:4,slab:5,paving:6,thatch:7,reed:8,palm:9,turf:10,shingle:11,bark:12,bamboo:13,earth:14,lime:15,metal:16,felt:17,hide:18},Ye={plaster:19,timber:20,wood:21,brick:22,stone:23,earth:24,wattle:25,bamboo:26,coral:27,hide:18,ashlar:29,concrete:30,glass:31,steel:16},Ve=28,Je=32,H=new Map,W=new Map;function Qe(t){let e=H.get(t);return e===void 0&&(H.size>4096&&H.clear(),H.set(t,e=/^city3d:(cover|wall):([a-z]+)$/.exec(t))),e}function Ze(t){const e=t??"";let n=W.get(e);return n===void 0&&(W.size>4096&&W.clear(),W.set(e,n=/@([0-9a-f]{6}|[0-9a-f]{3})$/.exec(e))),n}function et(t,e,n){const o=Qe(t??"");if(!o)return 0;if(o[1]==="wall")return Ye[o[2]]??0;const i=Ge(o[2],Math.abs(e[2])>.995*(Math.hypot(e[0],e[1],e[2])||1),n);return i?Xe[i]:0}function tt(t,e,n){if(n<0)return[0,0];const o=Oe(n),i=e[0],l=e[1],r=Math.abs(e[2]),c=Math.hypot(i,l);if(r<.3&&c>1e-6)return[(t[0]*-l+t[1]*i)/c/o,-t[2]/o];if(c<.02)return[t[0]/o,t[1]/o];const m=i/c,d=l/c;return[(-t[0]*d+t[1]*m)/o,(t[0]*m+t[1]*d)/Math.max(r,.2)/o]}const J=new Float64Array(2);function K(t,e,n,o,i,l,r=je){const c=n.appearance,m=new Map,d=!!c.textured,f={materials:n.materials};for(const a of t){const I=new Map,C=a.culture?.culture??"";let E=2166136261;for(let s=0;s<a.id.length;s++)E=Math.imul(E^a.id.charCodeAt(s),16777619);const A=Math.round((E>>>0)/4294967295*15)/15,z=a.programme,pe=`${z?.role??""}${z?.landmark?" monument":""}`,ne=oe(a),ae=Number.isFinite(ne)&&!a.id.startsWith("city3d-"),we=n.roofInk&&ae&&c.diagnostic==="none",q=n.look&&!d&&c.diagnostic==="none"?n.look.item(a.id):void 0;let ie,se,re;const ye=(s,G=0,g=0)=>{const b=s.material??(s.surface==="roof"?s.materials.cladding:s.materials.coating),p=Ze(b),N=p?b.slice(0,p.index):b,$=q&&s.surface!=="yard"?Le(s.materials):void 0;let O;if($&&s.surface==="roof"&&N?.startsWith("city3d:cover:")){if(s.normal!==ie||s.materials!==se){const u=ze(n.look.frame,q,{...$,normal:s.normal});re={color:P(u.color),gain:u.gain,family:u.family},ie=s.normal,se=s.materials}O=re}const ke=!!$&&b===s.materials.coating,ce=ae&&(c.roof==="minimal"||c.roof==="flat"&&s.surface==="roof"),T=d&&!ce&&!g&&s.surface!=="yard"?Ue(N??(s.surface==="roof"?s.materials.cladding:s.materials.coating)):-1;let R=I.get(s.surface);R||I.set(s.surface,R=new Map);let h=O?.color??R.get(String(b));if(!h&&ke&&(h=P(Ne(n.look.frame,q,$)),R.set(String(b),h)),!h){const u=Ce(s.materials,a.function,te(a),c,N,f);if(h=P(s.surface==="roof"?u.roof:u.wall),c.diagnostic==="none"||s.surface==="yard"){if(p?.[1].length===6)h=P(`#${p[1]}`);else if(p)h=h.map((k,L)=>Math.min(1,k*parseInt(p[1][L],16)/8));else if(C&&!a.id.startsWith("city3d-")){const k=_e=>/(?:^|[:/_-])(timber|wood|brick|stone|earth|plaster|bamboo|wattle|hide|coral|tile|slate|thatch|reed|palm|shingle|bark|turf|felt|snow|metal|lead)(?:$|[:/_-])/.exec(_e)?.[1]??"",L=k(s.materials.coating||s.materials.infill),B=k(s.materials.cladding),he=Se(C,L,B,A,pe+(/tower|minaret|stone/.test(N)?" monument":""));h=s.surface==="roof"?he.roof:he.wall}}s.surface==="roof"&&c.diagnostic==="none"&&c.colors?.building&&(h=P(c.colors.building));const _=/^city3d:tree:(crown|trunk)$/.exec(N??"");_&&(h=P(p?.[1].length===6?`#${p[1]}`:_[1]==="crown"?"#5f8247":"#4b5a36")),N==="city3d:water"&&(h=P("#"+(p?.[1]??"8aaeb8"))),R.set(String(b),h)}g&&(h=Pe(h,g,-(s.normal[0]+s.normal[1])*.4));const X=c.diagnostic==="none"&&(!!c.colors?.building&&s.surface==="roof"||p?.[1].length===6||!!C&&!a.id.startsWith("city3d-")),be=!d&&!ce&&s.surface!=="yard"&&c.style==="cartographic"&&c.diagnostic==="none"?g>=.4?Ve:O?O.family:et(N,s.normal,C):0,Y=(1+qe(N==="city3d:wall:lit"?Je:be,O?.gain)/32)/(Math.hypot(s.normal[0],s.normal[1],s.normal[2])||1),fe=d?`${h.join(",")}|${T}|${X}|${!!g}`:g?"vertex-colour|true":"vertex-colour|false";let x=m.get(fe);if(!x){const u=ve.layers[T]?.mean_rgb,k=u&&X?h.map((L,B)=>L/Math.max(.04,u[B]/255)):p?.[1].length===3?[...p[1]].map(L=>parseInt(L,16)/8):[1,1,1];x={batch:{color:d?h:[1,1,1],tint:k,recolored:X,vcolor:!d,palette:[],stride:V,data:new Float32Array(4096)},length:0,seen:n.collectPalette===!1?void 0:new Set},m.set(fe,x)}const S=x.batch,F=s.points;if(x.seen&&(g||!x.seen.has(h))&&(g||x.seen.add(h),S.palette.some(u=>u[0]===h[0]&&u[1]===h[1]&&u[2]===h[2])||S.palette.push(h)),x.length+F.length*V>S.data.length){const u=new Float32Array(Math.max(S.data.length*2,x.length+F.length*V));u.set(S.data.subarray(0,x.length)),S.data=u}const y=S.data;let w=x.length;for(let u=0;u<F.length;u++){const _=F[u];r(a,ne,_[0],_[1],_[2],s.ground?.[u],J),y[w++]=_[0]-e[0],y[w++]=J[0],y[w++]=_[1]-e[1],y[w++]=s.normal[0]*Y,y[w++]=s.normal[2]*Y,y[w++]=s.normal[1]*Y;const k=G&~(1<<u);if(d){const[L,B]=tt(_,s.normal,T);y[w++]=L,y[w++]=B,y[w++]=T+k/8}else y[w++]=k&1?-h[0]:h[0],y[w++]=k&2?-h[1]:h[1],y[w++]=k&4?-h[2]:h[2];y[w++]=J[1]}x.length=w},U=c.style!=="silhouette"&&c.diagnostic==="none"?Te(n.snowAltitudes.get(a.id)??a.ground_z_m,c.roofSnow):0,xe=U?Me(a.function):0,le=(s,G=0)=>{const g=s.material??s.materials.cladding,p=U&&s.surface==="roof"&&!/^city3d:(wall|tree|road|water)/.test(g)&&!a.id.startsWith("city3d-")?Ie(s.normal,-(s.normal[0]+s.normal[1])*.4,xe,/^city3d:cover:([a-z]+)/.exec(g)?.[1]):0;ye(s,G,U*Math.round(p*8)/8)};if(we){const s=[];de(a,g=>s.push(g),o,i,l);const G=We(s);s.forEach((g,b)=>le(g,G[b]))}else de(a,le,o,i,l)}const v=[];for(const{batch:a,length:I}of m.values())I&&(a.data=a.data.slice(0,I),v.push(a));return v}const D=256,M=4,ue=D/M,ot=64,Q=[0,0];function nt(t,e,n,o,i){const l=oe(t);if(Number.isFinite(l)){i[0]=(l+Math.min(0,e[2]-l))*o,i[1]=l*o+Math.max(0,e[5]-l);return}i[0]=1/0,i[1]=-1/0;for(let r=0;r<4;r++){const c=n.heightAt(e[r&1?3:0],e[r&2?4:1]);i[0]=Math.min(i[0],c-1),i[1]=Math.max(i[1],c+(e[5]-e[2]))}}class vt{constructor(e,n,o){this.scene=e,this.relief=n,this.exaggeration=o}blocks=[];altitudes=new at;byKey=new Map;next=0;step(e){const n=this.scene.buildings,o=this.relief,i=this.exaggeration;for(;this.next<n.length;){const l=n[this.next++],r=Ke(l),c=(r[0]+r[3])/2,m=(r[1]+r[4])/2,d=Be(l),f=[Math.floor(c/D)*D,Math.floor(m/D)*D],v=`${f}${d?"/yard":""}`;let a=this.byKey.get(v);if(a||(this.byKey.set(v,a={origin:f,buildings:[],yard:d,width:0,minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0,low:1/0,high:-1/0,levels:3,cells:new Int32Array(M*M+1),cellOf:[]}),this.blocks.push(a)),a.buildings.push(l),a.cellOf.push(Math.min(M-1,Math.floor((c-f[0])/ue))+M*Math.min(M-1,Math.floor((m-f[1])/ue))),this.altitudes.add(l),a.width+=d?1:Math.max(1,Math.min(r[3]-r[0],r[4]-r[1])),a.minX=Math.min(a.minX,r[0]),a.minY=Math.min(a.minY,r[1]),a.maxX=Math.max(a.maxX,r[3]),a.maxY=Math.max(a.maxY,r[4]),nt(l,r,o,i,Q),a.low=Math.min(a.low,Q[0]),a.high=Math.max(a.high,Q[1]),this.next%ot===0&&performance.now()>e)return!1}if(this.next===n.length){for(const l of this.blocks){l.width/=l.buildings.length;const r=l.cellOf,c=l.cells,m=new Array(r.length);for(const f of r)c[f+1]++;for(let f=0;f<M*M;f++)c[f+1]+=c[f];const d=c.slice(0,M*M);for(let f=0;f<r.length;f++)m[d[r[f]]++]=l.buildings[f];for(let f=0;f<m.length;f++)l.buildings[f]=m[f];l.cellOf=void 0}this.next++}return!0}}function gt(t,e){const n=e>0?1/e:1;return(o,i,l,r,c,m,d)=>{if(m===void 0&&Number.isFinite(i)){d[0]=c>=i?c-i:(c-i)*e,d[1]=i*e;return}const f=t.heightAt(l,r);d[0]=c-(m??f*n),d[1]=f}}class at{towns=new Map;owners=new Map;add(e){const n=e.parcel_id?.split("/")[0],o=n?.startsWith("layout-")?n:e.id;let i=this.towns.get(o);i||this.towns.set(o,i={sum:0,count:0}),Number.isFinite(e.ground_z_m)&&(i.sum+=e.ground_z_m,i.count++),this.owners.set(e.id,o)}get(e){const n=this.owners.get(e),o=n===void 0?void 0:this.towns.get(n);return o?o.count?o.sum/o.count:0:void 0}}function pt(t,e,n,o){return{appearance:{...e,textured:!1,ambience:void 0,lightsOn:void 0},materials:t.materials??[],collectPalette:!1,roofInk:e.roof==="v1",snowAltitudes:n,look:o}}function wt(t,e,n,o,i,l){const r=t.buildings.slice(i,l);if(t.yard)return Z(K(r,t.origin,n,e>0,void 0,e,o).map(a=>a.data));if(e!==ee)return Z(K(r,t.origin,n,e>0,void 0,void 0,o).map(a=>a.data));const c=n.appearance.roof==="minimal",m=a=>it(a)&&(!c||a.id.startsWith("city3d-")),d=r.filter(m),f=d.length?r.filter(a=>!m(a)):r,v=[...K(f.map(a=>st(a,c)),t.origin,n,!0,void 0,void 0,o),...d.length?K(d,t.origin,n,!1,void 0,void 0,o):[]];return Z(v.map(a=>a.data))}function Z(t){if(t.length===1)return t[0];let e=0;for(const i of t)e+=i.length;const n=new Float32Array(e);let o=0;for(const i of t)n.set(i,o),o+=i.length;return n}const ee=2,ge=t=>t.levels,it=t=>!j(t)&&t.volumes.some(e=>e.envelope==="open");function st(t,e=!1){if(!Number.isFinite(oe(t))||e&&t.id.startsWith("city3d-"))return t;const n=e||!t.roof_footprint.length?t.footprint:t.roof_footprint;return j(t)?n===t.roof_footprint?t:{...t,roof_footprint:n}:t.volumes.length?{...t,roof_footprint:n,projection:"native-building-visual-1",height_m:te(t),materials:t.volumes[0].materials,volumes:void 0,structural_features:void 0,structural_foundations:void 0}:t}const me=[10,6,3],rt=.25;function lt(t,e,n=0,o=1/0){const i=ge(t);if(e<rt*(n===i?1.15:1))return i;const l=o<(n===0?.85:1)?1:0;return Math.max(l,Re(e,n))}function yt(t,e,n=!1,o=1,i=!1){const l=ge(t);if(t.yard)return lt(t,e);for(let r=n==="overview"?1:n?ee:0;r<me.length;r++)if(e*o>=me[r])return r;return i||o>=Fe?ee:l}const ct=`
float baseOcclusion(vec3 normal,vec3 p){
  if(abs(normalize(normal).y)>.5||p.y<-1000.)return 1.;
  return mix(.72,1.,smoothstep(0.,2.4,p.y));
}
uniform int uNight;
${He}
${De}
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
`,ft=`
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
`,ht=`
float roofInk(vec3 edge, vec3 gx, vec3 gy, float dpr){
  vec3 ex=dFdx(edge),ey=dFdy(edge);
  vec3 edgePixel=sqrt(ex*ex+ey*ey);
  float reach=.5*dpr;
  if(all(greaterThanEqual(edge,edgePixel*(reach+.5))))return 0.;
  vec3 d=edge/max(edgePixel,vec3(1.e-6));
  float mpp=sqrt(max(dot(gx.xz,gx.xz),dot(gy.xz,gy.xz)))*dpr;
  return (1.-smoothstep(max(0.,reach-.5),reach+.5,min(d.x,min(d.y,d.z))))*.65*(1.-smoothstep(1.5,4.,mpp));
}
`,xt=`#version 300 es
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
}`,kt=`#version 300 es
precision highp float;
in vec3 n; in vec3 base; in vec3 facadePosition; in vec3 grainPosition; flat in float materialClass; flat in float townGain; in float vDistance;
in vec3 roofEdge; uniform float uRoofInkDpr;
// Haze distance (m) and share; haze colour.
uniform vec2 uAir;
uniform vec3 uHaze;
out vec4 color;
${ct}
${ft}
${$e}
${ht}
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
  }else{
    float light=buildingLight(N);
    rgb=buildingNight(materialGrain(base,cls,N,grainPosition,fp)*light*baseOcclusion(n,facadePosition),facadePosition,lit);
  }
  if(uRoofInkDpr>0.) rgb*=1.-roofInk(roofEdge,gx,gy,uRoofInkDpr);
  float haze=min(.62,1.-exp(-pow(vDistance/uAir.x,2.)*.11))*uAir.y;
  color=vec4(mix(rgb,uHaze,haze),1.);
}`;export{ct as B,ht as R,kt as W,K as a,Ke as b,st as c,ft as d,nt as e,V as f,wt as g,M as h,gt as i,vt as j,ge as k,yt as l,ue as m,xt as n,pt as w,lt as y};
