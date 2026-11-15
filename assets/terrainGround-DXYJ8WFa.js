import{R as Ge,M as Ne,w as Ee,H as Te,J as ge,h as He}from"./__vite-browser-external-CiSMHSqX.js";import{a as fe}from"./vectorWaterRender-Dlr54Vgc.js";import{V as he}from"./neuralModels-CUm9hdac.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const de=new WeakMap;function We(o,t,s=1){let a=de.get(o);a||(a=new Map,de.set(o,a));const c=Ge("box-f32",t,s),i=a.get(c);if(i)return i;const r=Ne("mips",()=>{const u=[o];let n=t;for(;n>1&&n%2===0;){const e=u[u.length-1],l=n/2,h=new Float32Array(l*l*s);for(let f=0;f<l;f++)for(let d=0;d<l;d++)for(let m=0;m<s;m++){const p=(2*f*n+2*d)*s+m;h[(f*l+d)*s+m]=(e[p]+e[p+s]+e[p+n*s]+e[p+(n+1)*s])*.25}u.push(h),n=l}return u});return a.set(c,r),r}function ct(o,t,s,a=1){let c=t,i=0;for(;c>1&&c%2===0;){if(c/=2,s[i]?.length!==c*c*a)return;i++}if(s.length!==i)return;let r=de.get(o);r||(r=new Map,de.set(o,r));const u=Ge("box-f32",t,a);r.has(u)||r.set(u,[o,...s])}const dt=`
// Fungal farms (champignonnières): x, y, half-size (m), row angle of each farm lot, up to 32.
uniform vec4 uFarmBeds[32]; uniform int uFarmBedCount;
float udHash(vec2 p){
  uvec2 q=uvec2(ivec2(floor(p)));
  uint h=(q.x*374761393u)^(q.y*668265263u)^2654435769u;
  h=(h^(h>>13u))*1274126177u;h^=h>>16u;
  return float(h)/4294967296.;
}
float udNoise(vec2 p){
  vec2 i=floor(p),f=p-i,u=f*f*(3.-2.*f);
  return mix(mix(udHash(i),udHash(i+vec2(1.,0.)),u.x),mix(udHash(i+vec2(0.,1.)),udHash(i+vec2(1.,1.)),u.x),u.y);
}
// Four octaves from wavelength (m); each fades out between four and two pixels (no shimmer). About [-.5, .5].
float udFbm(vec2 world,float wavelength,float px){
  float sum=0.,amp=.5,norm=0.;
  for(int k=0;k<4;k++){
    float w=clamp(wavelength/px*.5-1.,0.,1.);
    sum+=amp*w*(udNoise(world/wavelength+vec2(float(k)*17.31,float(k)*9.17))-.5);norm+=amp;
    wavelength*=.5;amp*=.55;
  }
  return sum/norm;
}
// Cold, low key light from the north-west (fixed: there is no sun underground) over a dim ambient.
float udLight(vec2 gradient){
  vec3 n=normalize(vec3(-gradient*3.,1.));
  return .3+.95*max(dot(n,normalize(vec3(-.55,-.45,.62))),0.);
}
// Bioluminescent fungi: sparse specks (cyan, some violet) in clusters on damp floors. A speck smaller than a pixel
// gives way to the even glow of its cluster, so zooming out never sparkles.
vec3 underdarkFungi(vec2 world,float px,float moss){
  float cluster=smoothstep(.12,.32,udFbm(world+vec2(911.,377.),420.,px)+.3*moss);
  vec3 cyan=vec3(.15,.85,.90),violet=vec3(.62,.30,.95);
  if(cluster<=0.)return vec3(0.);
  float CELL=14.;
  vec2 g=world/CELL,i=floor(g),f=g-i;
  float h=udHash(i+vec2(53.,7.));
  vec2 c=vec2(udHash(i+vec2(1.,91.)),udHash(i+vec2(17.,3.)))*.6+.2;
  float size=.8+1.6*h,r=length((f-c)*CELL);
  float resolved=clamp(size*2./px-.5,0.,1.);
  float speck=(1.-smoothstep(size*.35,size+px,r))*step(.5,h);
  vec3 tint=mix(cyan,violet,step(.82,h));
  return cluster*(tint*speck*resolved*.75+mix(cyan,violet,.25)*.035*(1.-resolved));
}
// Stalagmites and fallen debris, resolved only when a few metres span several pixels. Returns (shade, lit):
// shade darkens (the cone's shadow, debris), lit brightens (the cone's lit flank).
vec2 underdarkFloorDetail(vec2 world,float px,float wet){
  vec2 r=vec2(0.);
  // Debris: pebbles and flakes on a 2.5 m lattice.
  {float CELL=2.5;vec2 g=world/CELL,i=floor(g),f=g-i;float h=udHash(i+vec2(5.,77.));
   vec2 c=vec2(udHash(i+vec2(9.,1.)),udHash(i+vec2(2.,13.)))*.7+.15;float size=.15+.35*h,d=length((f-c)*CELL);
   float resolved=clamp(size*3./px-.6,0.,1.);r.x+=.3*(1.-smoothstep(size*.6,size,d))*step(.82,h)*resolved;}
  // Stalagmites in clusters (dry floors), a cone lit from the key light with a short shadow.
  float cluster=smoothstep(.0,.25,udFbm(world+vec2(311.,-57.),160.,px))*(1.-wet);
  if(cluster>0.){
    float CELL=9.;vec2 g=world/CELL,i=floor(g),f=g-i;float h=udHash(i+vec2(71.,19.));
    if(h<.55*cluster){
      vec2 c=vec2(udHash(i+vec2(3.,57.)),udHash(i+vec2(41.,8.)))*.6+.2;float size=.6+1.6*udHash(i+vec2(88.,4.));
      vec2 d=(f-c)*CELL;float resolved=clamp(size*2.5/px-.6,0.,1.);
      float cone=1.-smoothstep(size*.7,size,length(d));
      float lit=cone*clamp(dot(normalize(d+1e-4),normalize(vec2(-.55,-.45)))*.5+.5,0.,1.)*(1.-length(d)/size);
      float shadow=(1.-smoothstep(size*.6,size*1.3,length(d-vec2(.55,.45)*size*1.2)))*(1.-cone);
      r+=resolved*vec2(.55*shadow+.25*cone,.9*lit);
    }
  }
  return r;
}
// Giant mushroom groves on damp floors, seen from above: domed caps (violet, rust, pale teal) lit by the key
// light, pale spots, a cast shadow and, on some, a luminous gill rim. Below a few pixels a cap gives way to
// the grove's mean tint. Returns the cap colour (rgb, unlit by the floor light) and its cover (a); shadow in .
vec4 underdarkMushroomCell(vec2 world,float px,float grove,float CELL,vec2 seed,out float shadow){
  shadow=0.;
  vec2 g=world/CELL+seed,i=floor(g),f=g-i;
  float h=udHash(i+vec2(17.,233.)+seed);
  if(h>.7*grove)return vec4(0.);
  vec2 c=vec2(udHash(i+vec2(5.,71.)),udHash(i+vec2(61.,2.)))*.56+.22;
  float room=min(min(c.x,1.-c.x),min(c.y,1.-c.y))*CELL;
  float size=min(room*.95,CELL*(.16+.2*udHash(i+vec2(23.,9.))));
  vec2 d=(f-c)*CELL;float r=length(d)/size;
  float resolved=clamp(size*2./px-.5,0.,1.);
  shadow=resolved*(1.-smoothstep(.75,1.15,length(d-vec2(.5,.42)*size*.55)/size))*step(1.,r);
  if(r>=1.)return vec4(0.);
  float k=udHash(i+vec2(88.,13.));
  vec3 cap=k<.45?vec3(.30,.19,.33):k<.8?vec3(.34,.21,.14):vec3(.20,.30,.27);
  cap*=.8+.4*udHash(i+vec2(1.,301.));
  vec3 n=normalize(vec3(d/size*1.3,sqrt(max(1.-r*r,0.))));
  float lit=.3+.85*max(dot(n,normalize(vec3(-.55,-.45,.62))),0.);
  vec2 sp=d/size*3.2+vec2(k*9.,h*7.);float spot=step(.72,udHash(floor(sp)+vec2(3.,3.)))*(1.-smoothstep(.18,.32,length(fract(sp)-.5)));
  vec3 col=mix(cap*lit*(1.-.35*smoothstep(.75,1.,r)),vec3(.62,.58,.52)*lit,.5*spot*step(.55,k));
  col+=step(.66,udHash(i+vec2(7.,7.)))*smoothstep(.84,.98,r)*vec3(.08,.42,.40);
  return vec4(col,(1.-smoothstep(1.-px/size,1.,r))*resolved);
}
// Giant mushroom groves on damp floors, seen from above: two jittered lattices of domed caps (violet, rust,
// pale teal) lit by the key light, pale spots, a cast shadow and, on some, a luminous gill rim. Unresolved caps
// give way to the grove's mean tint. Returns the cap colour (rgb) and its cover (a) and the cast shadow.
vec4 underdarkMushrooms(vec2 world,float px,float grove,out float shadow){
  shadow=0.;
  if(grove<=0.)return vec4(0.);
  float s1,s2;
  vec4 a=underdarkMushroomCell(world,px,grove,31.,vec2(0.),s1);
  vec4 b=underdarkMushroomCell(world,px,grove,19.,vec2(.37,.61),s2);
  shadow=max(s1,s2);
  vec4 cap=a.a>0.?a:b;
  vec3 mean=vec3(.19,.14,.17);
  float haze=.16*grove*(1.-clamp(14./px-.5,0.,1.));
  return vec4(mix(mean,cap.rgb,cap.a),max(cap.a,haze));
}
// Mushroom beds of the fungal farms: dark compost ridges in rows along the lot, pale caps in lines on each ridge,
// lighter walkways between; below a couple of pixels per row, an even compost tint. Returns colour and cover.
vec4 underdarkFarmBeds(vec2 world,float px){
  for(int k=0;k<32;k++){
    if(k>=uFarmBedCount)break;
    vec4 f=uFarmBeds[k];vec2 d=world-f.xy;
    if(dot(d,d)>f.z*f.z*2.)continue;
    vec2 a=vec2(cos(f.w),sin(f.w));vec2 l=vec2(dot(d,a),dot(d,vec2(-a.y,a.x)));
    vec2 hs=vec2(f.z,f.z*.62);
    float edge=min(hs.x-abs(l.x),hs.y-abs(l.y));
    if(edge<=0.)continue;
    float cover=smoothstep(0.,2.5,edge);
    if(cover<=0.)continue;
    float rows=clamp(3.2/px-.8,0.,1.);
    float ridge=smoothstep(.12,.22,fract(l.y/3.2))*(1.-smoothstep(.62,.72,fract(l.y/3.2)));
    vec3 compost=vec3(.12,.095,.075),walk=vec3(.24,.22,.19);
    vec2 g=vec2(l.x/1.3,l.y/3.2),i=floor(g),q=fract(g)-vec2(.5,.42);
    float cap=(1.-smoothstep(.16,.26,length(q*vec2(1.3,3.2)/1.3)))*step(.25,udHash(i+vec2(f.x,f.y)*.01));
    float capsOn=clamp(1.3/px-.7,0.,1.);
    vec3 detail=mix(walk,compost,ridge);
    detail=mix(detail,vec3(.58,.53,.45),cap*ridge*capsOn);
    vec3 mean=mix(walk,compost,.55);
    return vec4(mix(mean,detail,rows),cover);
  }
  return vec4(0.);
}
// Cave floor. s: height and gradient (m/m); wet: dampness near water (0-1); ao: occlusion near walls (0-1).
vec3 underdarkFloor(vec3 s,vec2 world,float px,float wet,float ao){
  float slope=length(s.yz);
  float mineral=udFbm(world,900.,px),grain=udFbm(world*1.7+vec2(31.,5.),60.,px),fine=udFbm(world+vec2(73.,41.),6.,px);
  float rocky=smoothstep(.12,.45,slope+.15*grain);
  vec3 c=mix(vec3(.27,.24,.20),vec3(.33,.32,.31),smoothstep(-.15,.2,mineral));       // wet sediment -> limestone
  c=mix(c,vec3(.17,.17,.18),rocky);                                                   // basalt on slopes
  c*=1.+.35*grain+.25*fine;
  c=mix(c,vec3(.24,.17,.12),.35*smoothstep(.18,.3,mineral)*(1.-rocky));              // ochre mineral streaks
  c=mix(c,c*vec3(.55,.62,.66),wet);                                                   // damp floor near water
  float moss=smoothstep(.05,.25,udFbm(world+vec2(191.,23.),240.,px)+.25*wet-.1)*(1.-rocky);
  c=mix(c,vec3(.15,.24,.20)*(1.+.5*fine),.7*moss);                                    // moss and lichen
  vec4 beds=underdarkFarmBeds(world,px);
  vec2 detail=underdarkFloorDetail(world,px,wet)*(1.-beds.a);
  c=c*(1.-detail.x)+vec3(.30,.29,.27)*detail.y;
  c=mix(c,beds.rgb,beds.a);
  c*=udLight(s.yz)*(1.-.62*ao);
  float grove=smoothstep(.04,.2,udFbm(world+vec2(-517.,233.),520.,px)+.1*wet+.2*moss-.1)*(1.-rocky)*(1.-smoothstep(.15,.45,wet))*(1.-beds.a);
  float shade;vec4 cap=underdarkMushrooms(world,px,grove,shade);
  c*=1.-.55*shade;
  c=mix(c,cap.rgb*(1.-.45*ao),cap.a);
  return c+underdarkFungi(world,px,moss)*(1.-.6*ao)*(1.-cap.a);
}
// Rock mass over the floor; rim: the thin cold light where floor meets wall (0-1).
vec3 underdarkRock(vec3 s,vec2 world,float px,float rim){
  float t=udFbm(world+vec2(401.,13.),180.,px)+.6*udFbm(world*1.3+vec2(17.,88.),25.,px);
  // Crags of the rock surface carry the form: a dim key light over near-black stone, a lit ledge at the wall.
  vec3 c=vec3(.075,.072,.08)*(1.+.8*t)*(.18+.95*udLight(s.yz));
  // Fractured bedrock: ridged cracks at three scales (narrower when smaller), faded before they alias, over a fine grain.
  float crack=0.;
  for(int k=0;k<3;k++){
    float len=k==0?140.:k==1?38.:10.,w=clamp(len/px*.35-1.,0.,1.);
    vec2 q=world/len+vec2(float(k)*41.7,float(k)*13.3);q+=.35*vec2(udNoise(q*1.7+3.1),udNoise(q*1.7-8.4));
    float sharp=k==0?.955:k==1?.965:.975;
    crack=max(crack,w*(k==2?.7:1.)*smoothstep(sharp-.06,sharp,1.-abs(2.*udNoise(q)-1.)));
  }
  c*=1.+.55*udFbm(world+vec2(5.,61.),4.,px)+.3*udFbm(world+vec2(29.,3.),1.2,px);
  // Faceted blocks once a few metres span several pixels: a crag micro-relief lit by the key light.
  float facet=clamp(26./px*.25-.5,0.,1.);
  if(facet>0.){
    float e=max(px,.8);
    vec2 q=world+vec2(71.,-13.);
    float hx=udFbm(q+vec2(e,0.),26.,px)+.5*udFbm(q+vec2(e,0.)+vec2(9.,4.),8.,px)-udFbm(q-vec2(e,0.),26.,px)-.5*udFbm(q-vec2(e,0.)+vec2(9.,4.),8.,px);
    float hy=udFbm(q+vec2(0.,e),26.,px)+.5*udFbm(q+vec2(0.,e)+vec2(9.,4.),8.,px)-udFbm(q-vec2(0.,e),26.,px)-.5*udFbm(q-vec2(0.,e)+vec2(9.,4.),8.,px);
    vec3 fn=normalize(vec3(-vec2(hx,hy)/(2.*e)*14.,1.));
    float lit=max(dot(fn,normalize(vec3(-.55,-.45,.62))),0.);
    c*=mix(1.,.45+1.1*lit,facet);
  }
  c*=1.-.6*crack;
  return c+vec3(.16,.17,.17)*rim;
}
// Cave water: depth in metres, edge 0-1 near the shore (faint luminous rim).
vec3 underdarkWater(vec2 world,float px,float depth,float edge){
  vec3 c=mix(vec3(.04,.11,.12),vec3(.016,.055,.065),smoothstep(0.,4.,depth));
  // Slow ripples catching the faint glow of the fungi.
  c*=1.+.3*udFbm(world+vec2(77.,301.),40.,px)+.25*udFbm(world*vec2(1.,2.3)+vec2(13.,5.),9.,px);
  return c+vec3(.04,.17,.18)*edge;
}
// Satellite 2 · Painted: the same values as sepia washes on the parchment.
vec3 underdarkPaper(vec3 c){
  float l=clamp(dot(c,vec3(.3,.55,.15))*2.6,0.,1.);
  return mix(vec3(.17,.13,.10),vec3(.66,.58,.44),l);
}
`;function ut(o,t=[]){const s=new Float32Array(128);let a=0;const c=(r,u,n,e)=>{a<32&&s.set([r,u,n,e],4*a++)};for(const r of o??[]){let u=55;if(r.lot?.length){const n=r.lot.map(l=>l.x),e=r.lot.map(l=>l.y);u=Math.max(25,Math.min(140,Math.max(Math.max(...n)-Math.min(...n),Math.max(...e)-Math.min(...e))*.7))}c(r.pos.x,r.pos.y,u,r.angle)}const i=(r,u)=>{const n=Math.sin(r*12.9898+u*78.233)*43758.5453;return n-Math.floor(n)};for(const r of t){const u=Math.max(60,r.radius??150),n=r.main?4:2;for(let e=0;e<n;e++){const l=(e+i(r.center.x,r.center.y+e))/n*Math.PI*2,h=u*(1.15+.45*i(r.center.y,r.center.x+e));c(r.center.x+Math.cos(l)*h,r.center.y+Math.sin(l)*h,30+25*i(e,r.center.x),l+Math.PI/2+(i(r.center.x+e,3)-.5)*.6)}}return s}const X=new Map,De=3,Be=4,Ke=3;function Ie(o,t){if(!/^[MLZ\d\s.,eE+-]*$/.test(o))return;const s=o.match(/[MLZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)??[],a=[];let c,i="";for(let n=0;n<s.length;){const e=s[n];if(e==="M"||e==="L"||e==="Z"){i=e,n++,e==="Z"&&c&&(c.closed=!0,c=void 0);continue}const l=Number(e),h=Number(s[n+1]);if(n+=2,!Number.isFinite(l)||!Number.isFinite(h))return;(i==="M"||!c)&&(c={pts:[],closed:!1},a.push(c),i="L"),c.pts.push([l,h])}const r=(n,e)=>n<=.01||e<=.01||n>=t-.01||e>=t-.01;let u="";for(const n of a){let e=n.pts;if(n.closed&&e.length>1&&e[0][0]===e.at(-1)[0]&&e[0][1]===e.at(-1)[1]&&(e=e.slice(0,-1)),n.closed&&e.length>=3){const l=[],h=[],f=[];for(let p=0;p<e.length;p++){const[y,z]=e[p],[k,C]=e[(p+1)%e.length],S=Math.hypot(k-y,C-z),v=Math.max(1,Math.round(S/De)),g=r(y,z)&&r(k,C)&&(Math.abs(y-k)<.02||Math.abs(z-C)<.02);for(let b=0;b<v;b++)l.push(y+(k-y)*b/v),h.push(z+(C-z)*b/v),f.push(g||b===0&&r(y,z))}const d=l.length,m=Math.min(Be,Math.floor(d/16));if(m>0)for(let p=0;p<Ke;p++){const y=l.slice(),z=h.slice();for(let k=0;k<d;k++){if(f[k])continue;let C=0,S=0;for(let v=-m;v<=m;v++){const g=(k+v+d)%d;C+=y[g],S+=z[g]}l[k]=C/(2*m+1),h[k]=S/(2*m+1)}}e=l.map((p,y)=>[p,h[y]])}u+=e.map((l,h)=>`${h?"L":"M"}${l[0].toFixed(2)},${l[1].toFixed(2)}`).join("")+(n.closed?"Z":"")}return u}function ft(o,t){const s=`${t}:${o}`,a=X.get(s);if(a)return a;const c=[],i=document.createElementNS("http://www.w3.org/2000/svg","svg");i.setAttribute("width",String(t)),i.setAttribute("height",String(t)),i.setAttribute("viewBox",`0 0 ${t} ${t}`),i.style.cssText="position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none",i.innerHTML=o,document.body.append(i);try{const r=i.getScreenCTM()?.inverse();for(const u of Array.from(i.querySelectorAll("path,circle,polygon,rect"))){if(u.closest("defs,clipPath,mask")||u.getAttribute("fill")==="none")continue;const n=new Path2D;if(u.tagName==="path"){const f=u.getAttribute("d")??"";n.addPath(new Path2D(Ie(f,t)??f))}else if(u.tagName==="circle")n.arc(Number(u.getAttribute("cx")),Number(u.getAttribute("cy")),Number(u.getAttribute("r")),0,Math.PI*2);else if(u.tagName==="rect")n.rect(Number(u.getAttribute("x")),Number(u.getAttribute("y")),Number(u.getAttribute("width")),Number(u.getAttribute("height")));else{const f=(u.getAttribute("points")??"").trim().split(/[\s,]+/).map(Number);for(let d=0;d+1<f.length;d+=2)d?n.lineTo(f[d],f[d+1]):n.moveTo(f[d],f[d+1]);n.closePath()}const e=new Path2D,l=u.getScreenCTM(),h=l&&r?r.multiply(l):u.getCTM();e.addPath(n,h??void 0),c.push({path:e,rule:u.getAttribute("fill-rule")==="evenodd"?"evenodd":"nonzero"})}}finally{i.remove()}for(X.set(s,c);X.size>3;)X.delete(X.keys().next().value);return c}const ve=4,Ve=120,Oe=70,$e=45,Ce=o=>Math.max(0,Math.min(1,o)),J=(o,t,s)=>{const a=Ce((s-o)/(t-o));return a*a*(3-2*a)};function Pe(o,t){const s=new Float64Array(t),a=new Int32Array(t),c=new Float64Array(t+1),i=new Float64Array(t),r=(u,n)=>{for(let l=0;l<t;l++)i[l]=u(l);let e=0;a[0]=0,c[0]=-1/0,c[1]=1/0;for(let l=1;l<t;l++){let h=(i[l]+l*l-(i[a[e]]+a[e]*a[e]))/(2*l-2*a[e]);for(;h<=c[e];)e--,h=(i[l]+l*l-(i[a[e]]+a[e]*a[e]))/(2*l-2*a[e]);e++,a[e]=l,c[e]=h,c[e+1]=1/0}e=0;for(let l=0;l<t;l++){for(;c[e+1]<l;)e++;s[l]=(l-a[e])*(l-a[e])+i[a[e]]}for(let l=0;l<t;l++)n(l,s[l])};for(let u=0;u<t;u++)r(n=>o[n*t+u],(n,e)=>{o[n*t+u]=e});for(let u=0;u<t;u++)r(n=>o[u*t+n],(n,e)=>{o[u*t+n]=e})}function _e(o,t,s){const a=new Float32Array(t*t),c=new Float32Array(t*t),i=2*s+1,r=new Float32Array(t+2*s),u=new Float32Array(t+2*s),n=new Float32Array(t+2*s),e=(l,h)=>{const f=t+2*s;for(let d=0;d<f;d++){const m=d-s;r[d]=m>=0&&m<t?l(m):0}for(let d=0;d<f;d++)u[d]=d%i===0?r[d]:Math.max(u[d-1],r[d]);for(let d=f-1;d>=0;d--)n[d]=d===f-1||(d+1)%i===0?r[d]:Math.max(n[d+1],r[d]);for(let d=0;d<t;d++)h(d,Math.max(n[d],u[d+2*s]))};for(let l=0;l<t;l++)e(h=>o[l*t+h],(h,f)=>{a[l*t+h]=f});for(let l=0;l<t;l++)e(h=>a[h*t+l],(h,f)=>{c[h*t+l]=f});return c}function me(o,t,s){const a=new Float32Array(t);for(let c=0;c<3;c++)for(let i=0;i<2;i++)for(let r=0;r<t;r++){const u=e=>i?e*t+r:r*t+e;for(let e=0;e<t;e++)a[e]=o[u(e)];let n=0;for(let e=-s;e<=s;e++)n+=a[Math.max(0,Math.min(t-1,e))];for(let e=0;e<t;e++)o[u(e)]=n/(2*s+1),n+=a[Math.min(t-1,e+s+1)]-a[Math.max(0,e-s)]}}function _(o){const t=document.createElement("canvas");return t.width=t.height=o,t}const we=new WeakMap;function ht(o,t,s){if(!s?.zone||!o.length||!(t>0))return;const a=Ee(s);if(!Te(a)||a.aridity<=0&&a.ice<=0)return;const c=JSON.stringify([t,a]),i=we.get(o);if(i?.key===c)return i.regime;const r=je(o,t,a);return we.set(o,{key:c,regime:r}),r}function je(o,t,s){const a=Math.max(64,Math.min(2048,Math.round(t/2))),c=t/a,i=_(a),r=i.getContext("2d",{willReadFrequently:!0});r.setTransform(1/c,0,0,1/c,0,0),r.fillStyle="#fff";for(const w of o)r.fill(w.path,w.rule);const u=r.getImageData(0,0,a,a).data,n=a*a,e=new Uint8Array(n),l=new Float64Array(n);let h=!1;for(let w=0;w<n;w++)e[w]=u[w*4+3]>=128?1:0,l[w]=e[w]?1e20:0,e[w]&&(h=!0);if(!h)return;Pe(l,a);const f=new Float32Array(n);for(let w=0;w<n;w++)f[w]=e[w]?Math.sqrt(l[w])*c:0;const d=_e(f,a,Math.max(1,Math.round(Oe/c))),m=new Float32Array(n),p=new Float32Array(n),y=new Float32Array(n),z=Math.log(Ve/ve);for(let w=0;w<n;w++){if(!e[w])continue;const R=Ce(Math.log(Math.max(2*d[w],ve*.3)/ve)/z),q=ge(s,R);m[w]=q.dry,p[w]=q.ice,y[w]=1}const k=Math.max(1,Math.round($e/3/c));me(m,a,k),me(p,a,k),me(y,a,k);const C=ge(s,1),S=80*s.drop,v=Math.min(a,1024),g=_(v),b=_(v),x=_(v),M=_(v),L=_(v),G=[g,b,x,M,L].map(w=>w.getContext("2d").createImageData(v,v));let F=!1,A=!1;for(let w=0;w<v;w++)for(let R=0;R<v;R++){const q=Math.min(a-1,Math.floor((w+.5)*a/v))*a+Math.min(a-1,Math.floor((R+.5)*a/v)),E=(w*v+R)*4,N=y[q];let T=N>.001?m[q]/N:C.dry,H=N>.001?p[q]/N:C.ice;if(S>1&&e[q]){const W=S*J(18,60,d[q]);W>1&&(T=Math.max(T,1-J(.6*W,W,f[q])))}const B=J(.55,.85,T),V=J(.25,.5,T)*(1-B),O=J(.35,.6,H);e[q]&&(O>.01&&(F=!0),B+V>.01&&(A=!0));const j=[0,(1-Math.max(B,.65*V))*(1-O),B,V,O];G[0].data.set([Math.round(255*(1-T)),Math.round(255*(1-H)),0,255],E);for(let W=1;W<5;W++)G[W].data.set([255,255,255,Math.round(255*j[W])],E)}return[g,b,x,M,L].forEach((w,R)=>w.getContext("2d").putImageData(G[R],0,0)),{climate:s,width:t,code:g,wet:b,dry:x,intermittent:M,ice:L,frozen:F,drying:A}}let Ue;function U(o,t,s,a){const c=o.canvas,i=Ue??=document.createElement("canvas");i.width!==c.width&&(i.width=c.width),i.height!==c.height&&(i.height=c.height);const r=i.getContext("2d");r.setTransform(1,0,0,1,0,0),r.globalCompositeOperation="source-over",r.globalAlpha=1,r.setLineDash([]),r.clearRect(0,0,i.width,i.height),r.setTransform(o.getTransform()),r.lineCap=r.lineJoin="round",a(r),r.globalCompositeOperation="destination-in",r.globalAlpha=1,r.imageSmoothingEnabled=!0,r.imageSmoothingQuality="high",r.drawImage(t,0,0,s,s),o.save(),o.setTransform(1,0,0,1,0,0),o.globalAlpha=1,o.globalCompositeOperation="source-over",o.drawImage(i,0,0),o.restore()}const xe=new WeakMap;function Ze(o){let t=xe.get(o);if(!t){t=_(o.width);const s=o.getContext("2d").getImageData(0,0,o.width,o.height);for(let a=1;a<s.data.length;a+=4)s.data[a]=255;t.getContext("2d").putImageData(s,0,0),xe.set(o,t)}return t}const D=(o,t)=>{for(const s of t)o.fill(s.path,s.rule)},pe=(o,t)=>{for(const s of t)o.stroke(s.path)};function Qe(o,t,s,a,c,i="parchment"){const r=o.getTransform(),u=1/Math.max(1e-9,Math.hypot(r.a,r.b)),n=s.width;if(a==="code"){o.save(),o.fillStyle="#fff",D(o,t),o.globalCompositeOperation="source-in",o.imageSmoothingEnabled=!0,o.imageSmoothingQuality="high",o.drawImage(He(i).satelliteVariant>0?Ze(s.code):s.code,0,0,n,n),o.restore();return}if(a==="ink"&&(o.fillStyle=c,D(o,t)),a==="cover"&&U(o,s.wet,n,e=>{e.fillStyle=c,D(e,t)}),a!=="cover"){if(a==="ink"||a==="symbols"){const e=fe(i,c);if(s.drying)for(const l of[s.intermittent,s.dry])U(o,l,n,h=>{h.fillStyle=e.bed,D(h,t),h.save();const f=new Path2D;for(const d of t)f.addPath(d.path);h.clip(f),h.strokeStyle=e.dry,h.lineWidth=1.2*u,pe(h,t),h.restore()});s.frozen&&U(o,s.ice,n,l=>{l.fillStyle=e.ice,D(l,t),l.strokeStyle=c,l.lineWidth=1.4*u,pe(l,t)});return}a==="ground"&&s.drying&&(U(o,s.dry,n,e=>{e.fillStyle=fe(i,c).bed,D(e,t)}),U(o,s.intermittent,n,e=>{e.fillStyle=fe(i,c).bed,D(e,t)})),a==="ice"&&s.frozen&&U(o,s.ice,n,e=>{e.fillStyle="#a9bac6",D(e,t),e.strokeStyle="#55697a",e.lineWidth=Math.max(1.2*u,1.2),pe(e,t)})}}function vt(o,t,s,a,c,i,r,u){return o.setTransform(1,0,0,1,0,0),o.clearRect(0,0,a.width,a.height),o.setTransform(a.width/s.width,0,0,a.height/s.height,-s.x*a.width/s.width,-s.y*a.height/s.height),i?(Qe(o,t,i,r?"code":"ink",c,u),r):(o.fillStyle=c,D(o,t),!1)}const ce=(o,t,s)=>Math.max(t,Math.min(s,o)),Y=(o,t,s)=>{const a=ce((s-o)/(t-o),0,1);return a*a*(3-2*a)},ye=new Uint32Array(4096),be=new Uint8Array(4096),ee=new Float64Array(4096),te=new Float64Array(4096);function le(o,t,s){let a=Math.imul(o,374761393)^Math.imul(t,668265263)^s;a=Math.imul(a^a>>>13,1274126177),a=(a^a>>>16)>>>0;const c=a&4095;if(!be[c]||ye[c]!==a){const i=a/4294967296*Math.PI*2;ye[c]=a,ee[c]=Math.cos(i),te[c]=Math.sin(i),be[c]=1}return c}function Xe(o,t,s,a){const c=Math.floor(o),i=Math.floor(t),r=o-c,u=t-i,n=le(c,i,s),e=ee[n],l=te[n],h=le(c+1,i,s),f=ee[h],d=te[h],m=le(c,i+1,s),p=ee[m],y=te[m],z=le(c+1,i+1,s),k=ee[z],C=te[z],S=e*r+l*u,v=f*(r-1)+d*u,g=p*r+y*(u-1),b=k*(r-1)+C*(u-1),x=r*r*r*(r*(r*6-15)+10),M=u*u*u*(u*(u*6-15)+10),L=30*r*r*(r*(r-2)+1),G=30*u*u*(u*(u-2)+1);a[0]=(S+(v-S)*x+(g-S)*M+(S-v-g+b)*x*M)*1.4,a[1]=(e+(f-e)*x+(p-e)*M+(e-f-p+k)*x*M+L*(v-S+(S-v-g+b)*M))*1.4,a[2]=(l+(d-l)*x+(y-l)*M+(l-d-y+C)*x*M+G*(g-S+(S-v-g+b)*x))*1.4}function Je(o,t){const s=Math.max(.25,t.sourceCell),a={...t.detail},c=t.seed>>>0,i=(f,d)=>o(f,d,0);if(!t.refine||a.amplitude===0)return i;const r=Math.min(12,Math.max(1,Math.round(a.octaves)+4)),u=ce(a.lacunarity+.5,1.5,2.5),n=new Float64Array(3),e=Math.max(.125,s*.25),l=s*4,h=[];for(let f=0,d=s*8*a.start;f<r&&d>=.125;f++,d/=u){const m=.37+f*2.399963229728653,p=d/s,y=Y(1.4,3.5,p),z=1-Y(.045,.12,p);h.push({wavelength:d,c:Math.cos(m),s:Math.sin(m),seed:c+f*7919>>>0,broad:y,fine:z,middle:1-Math.max(y,z),wide:y>.5,carried:y+z*.15,hurst:Math.pow(Math.max(p,1),ce(a.hurst,.7,1.3)-1)*Math.pow(Math.min(p,1),Math.max(0,a.hurst-1))})}return(f,d)=>{const m=i(f,d);if(m<=0)return m;const p=(i(f+e,d)-i(f-e,d))/(2*e),y=(i(f,d+e)-i(f,d-e))/(2*e),z=Math.hypot(p,y),k=i(f,d-l),C=i(f,d+l),S=i(f+l,d),v=i(f-l,d),g=Math.max(Math.abs(m-k),Math.abs(m-C),Math.abs(m-S),Math.abs(m-v))/l,b=Y(.002,.025,(m-(k+C+S+v)*.25)/l)*Y(.04,.2,Math.max(z,g)),x=Y(.04,.2,z);if(b===0&&x===0)return m;const M=p/Math.max(z,1e-6),L=y/Math.max(z,1e-6),G=Math.pow(Math.max(z+a.flat,1e-6),a.slope),F=Math.pow(Math.max(Math.max(z,g)+a.flat,1e-6),a.slope);let A=0,w=0,R=0;for(const{wavelength:q,c:E,s:N,seed:T,broad:H,fine:B,middle:V,wide:O,carried:j,hurst:W}of h){if(x===0&&H===0)break;Xe((f*E-d*N)/q,(f*N+d*E)/q,T,n);const oe=Math.sqrt(n[0]*n[0]+.0025),K=n[0]*.45+(.24-oe)*.55,$=.45-.55*n[0]/oe,Z=(n[1]*E+n[2]*N)*$,Q=(-n[1]*N+n[2]*E)*$,re=H*b+B*x*3+V*x*.015,ne=O?F:G;w+=Z*j,R+=Q*j;const se=1/(1+.65*(w*w+R*R)),qe=1/(1+1.5*Math.abs(Z*M+Q*L));A+=K*q*a.amplitude*W*re*ne*se*qe}return m+A*(a.shore>0?ce(m/a.shore,0,1):1)}}const mt=`
float terrain3dBaseHeight(vec2 world) {
  float h=level(0,world).x;return uFloor>0.?max(h,uFloor):h;
}
vec3 terrain3dGradientNoise(vec2 p, uint seed) {
  vec2 cell = floor(p), f = p - cell; vec2 g[4];
  for (int k=0;k<4;k++) {
    uvec2 q=uvec2(ivec2(cell))+uvec2(k&1,k>>1);
    uint h=q.x*374761393u^q.y*668265263u^seed;
    h=(h^(h>>13u))*1274126177u;h^=h>>16u;
    float angle=float(h)/4294967296.0*6.283185307179586;g[k]=vec2(cos(angle),sin(angle));
  }
  float a=dot(g[0],f),b=dot(g[1],f-vec2(1.,0.)),c=dot(g[2],f-vec2(0.,1.)),d=dot(g[3],f-vec2(1.));
  vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  float value=a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y;
  vec2 gradient=g[0]+(g[1]-g[0])*u.x+(g[2]-g[0])*u.y+(g[0]-g[1]-g[2]+g[3])*u.x*u.y
    +du*vec2((b-a)+(a-b-c+d)*u.y,(c-a)+(a-b-c+d)*u.x);
  return vec3(value,gradient)*1.4;
}
vec3 terrain3dSurface(vec2 world,float sourceCell,uint seed,vec4 a,vec3 b,int octaveCount) {
  float cell=max(.25,sourceCell);
  float probe=max(.125,cell*.25),radius=cell*4.;
  // The nine heights from one loop (one inlined level() instead of nine): centre, then +-x/+-y at the probe, then
  // n, s, e, w at the radius. The centre alone when it is not above the floor.
  float hv[9];
  for(int k=0;k<9;k++){
    vec2 o=k==0?vec2(0.):k==1?vec2(probe,0.):k==2?vec2(-probe,0.):k==3?vec2(0.,probe):k==4?vec2(0.,-probe):k==5?vec2(0.,-radius):k==6?vec2(0.,radius):k==7?vec2(radius,0.):vec2(-radius,0.);
    hv[k]=terrain3dBaseHeight(world+o);
    if(k==0&&hv[0]<=0.)break;
  }
  float h=hv[0];if(h<=0.)return vec3(h,0.,0.);
  vec2 g=vec2(hv[1]-hv[2],hv[3]-hv[4])/(2.*probe);
  float slope=length(g),n=hv[5],s=hv[6],e=hv[7],w=hv[8];
  float relief=max(max(abs(h-n),abs(h-s)),max(abs(h-e),abs(h-w)))/radius;
  float crest=smoothstep(.002,.025,(h-(n+s+e+w)*.25)/radius)*smoothstep(.04,.2,max(slope,relief));
  float mountain=smoothstep(.04,.2,slope);if(a.x==0.||(crest==0.&&mountain==0.))return vec3(h,g);
  vec2 downhill=g/max(slope,1e-6),accumulated=vec2(0.),residualGradient=vec2(0.);float wavelength=cell*8.*a.w,residual=0.;
  for(int k=0;k<12;k++) {
    if(k>=(uQuality>0?2:min(12,max(1,octaveCount+4)))||wavelength<.125)break;
    float angle=.37+float(k)*2.399963229728653,c=cos(angle),sn=sin(angle),ratio=wavelength/cell;
    vec3 v=terrain3dGradientNoise(vec2(world.x*c-world.y*sn,world.x*sn+world.y*c)/wavelength,seed+uint(k*7919));
    float rounded=sqrt(v.x*v.x+.0025),signal=v.x*.45+(.24-rounded)*.55;
    vec2 d=vec2(v.y*c+v.z*sn,-v.y*sn+v.z*c)*(.45-.55*v.x/rounded);
    float broad=smoothstep(1.4,3.5,ratio),fine=1.-smoothstep(.045,.12,ratio);
    float envelope=broad*crest+fine*mountain*3.+(1.-max(broad,fine))*mountain*.015;
    float slopeWeight=pow(max((broad>.5?max(slope,relief):slope)+b.y,1e-6),b.x);
    accumulated+=d*(broad+fine*.15);
    float weight=1./(1.+.65*dot(accumulated,accumulated))/(1.+1.5*abs(dot(d,downhill)));
    float hurst=pow(max(ratio,1.),clamp(a.y,.7,1.3)-1.)*pow(min(ratio,1.),max(0.,a.y-1.));
    float amplitude=wavelength*a.x*hurst*envelope*slopeWeight*weight;
    residual+=signal*amplitude;residualGradient+=d*(amplitude/wavelength);
    wavelength/=clamp(a.z+.5,1.5,2.5);
  }
  float shore=b.z>0.?clamp(h/b.z,0.,1.):1.;
  return vec3(h+residual*shore,g+residualGradient*shore);
}
vec3 terrain3dDetail(vec2 world,vec3 base) {
  return terrain3dSurface(world,uSourceCell,uSeed,uDetailA,uDetailB,uOctaves)-base;
}
`;function Ye(o,t){return We(o,t)}function ke(o,t){const s=t?Ye(o.data,o.n):[o.data];return{layer:o,levels:s,cell:o.width/o.n,inset:t?0:2*o.width/o.n}}const ae=4096,Me=new Uint32Array(ae),ze=new Uint8Array(ae),Fe=new Float64Array(ae),Se=new Float64Array(ae);function ie(o,t,s,a,c){let i=Math.imul(o,374761393)^Math.imul(t,668265263)^c;i=Math.imul(i^i>>>13,1274126177),i=(i^i>>>16)>>>0;const r=i&ae-1;if(!ze[r]||Me[r]!==i){const u=i/4294967296*Math.PI*2;Me[r]=i,Fe[r]=Math.cos(u),Se[r]=Math.sin(u),ze[r]=1}return Fe[r]*s+Se[r]*a}function et(o,t,s){const a=Math.floor(o),c=Math.floor(t),i=o-a,r=t-c,u=i*i*i*(i*(i*6-15)+10),n=r*r*r*(r*(r*6-15)+10),e=ie(a,c,i,r,s),l=ie(a+1,c,i-1,r,s),h=ie(a,c+1,i,r-1,s),f=ie(a+1,c+1,i-1,r-1,s);return(e+(l-e)*u+(h-e)*n+(e-l-h+f)*u*n)*1.4}function pt(o,t,s=[],a=!1){const c=ke(o,!0),i=s.map(v=>ke(v,!1)).reverse(),r=t.floor,u=t.sourceCell,n={...t.detail},e=!a&&t.refine&&u>0&&n.amplitude!==0,l=[],h=Math.max(0,Math.min(he.length,Math.round(n.octaves)));let f=u*n.start;for(let v=0;e&&v<h&&f>0;v++,f/=Math.max(1.1,n.lacunarity))l.push({wavelength:f,c:Math.cos(he[v]),s:Math.sin(he[v]),amplitude:Math.pow(f/u,n.hurst),seed:t.seed+v*7919>>>0});const d=new Float64Array(16);let m=0,p=0,y=0;const z=(v,g)=>{const b=1-g,x=g*g,M=x*g;d[v]=b*b*b/6,d[v+1]=(3*M-6*x+4)/6,d[v+2]=(-3*M+3*x+3*g+1)/6,d[v+3]=M/6,d[v+4]=-.5*b*b,d[v+5]=1.5*x-2*g,d[v+6]=-1.5*x+g+.5,d[v+7]=.5*x},k=(v,g,b,x)=>{const{layer:M,levels:L}=v,G=Math.max(1,M.n>>g),F=v.cell*2**g,A=(b-M.x)/F-.5,w=(x-M.y)/F-.5,R=Math.floor(A),q=Math.floor(w),E=L[g];z(0,A-R),z(8,w-q);const N=G-1,T=Math.max(0,Math.min(N,R-1)),H=Math.max(0,Math.min(N,R)),B=Math.max(0,Math.min(N,R+1)),V=Math.max(0,Math.min(N,R+2)),O=d[0],j=d[1],W=d[2],oe=d[3];m=p=y=0;for(let K=0;K<4;K++){const $=Math.max(0,Math.min(N,q+K-1))*G,Z=E[$+T],Q=E[$+H],re=E[$+B],ne=E[$+V],se=Z*O+Q*j+re*W+ne*oe;m+=se*d[K+8],e&&(p+=(Z*d[4]+Q*d[5]+re*d[6]+ne*d[7])*d[K+8],y+=se*d[K+12])}p/=F,y/=F},C=(v,g,b,x,M)=>{if(k(v,g,x,M),b>.001&&g<v.levels.length-1){const L=m,G=p,F=y;k(v,g+1,x,M),m=L+(m-L)*b,p=G+(p-G)*b,y=F+(y-F)*b}},S=(v,g,b=0)=>{const x=Number.isFinite(b)?Math.max(0,b):0;let M=c;for(const L of i){const{layer:G,inset:F}=L;if(v>=G.x+F&&g>=G.y+F&&v<=G.x+G.width-F&&g<=G.y+G.width-F){M=L;break}}if(x<=M.cell)k(M,0,v,g);else{const L=M.levels.length-1,G=Math.max(0,Math.min(L,Math.log2(Math.max(1,x/M.cell))-.5)),F=Math.floor(G),A=G-F;C(M,F,A,v,g)}if(r>0&&(m=Math.max(m,r)),e&&m>0&&x*2<u*n.start){const L=n.amplitude*Math.pow(Math.max(Math.hypot(p,y)+n.flat,1e-6),n.slope)*u;let G=0;for(const F of l){const A=x>0?Math.max(0,Math.min(1,F.wavelength/x*.5-1)):1;if(A<=0)break;const w=et((v*F.c-g*F.s)/F.wavelength,(v*F.s+g*F.c)/F.wavelength,F.seed);G+=w*F.amplitude*A}m+=G*L*(n.shore>0?Math.max(0,Math.min(1,m/n.shore)):1)}return m};return a?Je(S,t):S}const ue=[{wavelength:8,amplitude:.17,aspect:.35,filterWidth:1,c:.8,s:.6,variance:.2},{wavelength:2.2,amplitude:.04,aspect:.24,filterWidth:.5,c:-.6,s:.8,variance:1.8},{wavelength:.32,amplitude:.012,aspect:.85,filterWidth:.5,c:.28,s:.96,variance:1.3},{wavelength:.055,amplitude:.002,aspect:.72,filterWidth:1,c:-.96,s:.28,variance:.4}],Ae=(o,t=0,s=1)=>Math.max(t,Math.min(s,o));function I(o,t,s){const a=Ae((s-o)/(t-o));return a*a*(3-2*a)}function Le(o,t){const s=Ae((t/o-.18)/.24);return 1-s*s*s*(s*(s*6-15)+10)}function Re(o,t,s,a){let c=Math.imul(o,2654435769)^Math.imul(t,2246822507)^Math.imul(s,3266489909)^a;return c=Math.imul(c^c>>>16,2146121005),c=Math.imul(c^c>>>15,2221713035),(c^c>>>16)>>>0}function tt(o,t,s,a,c){const i=Math.floor(o),r=Math.floor(t),u=Math.floor(s),n=o-i,e=t-r,l=s-u,h=n**3*(n*(n*6-15)+10),f=e**3*(e*(e*6-15)+10),d=l**3*(l*(l*6-15)+10),m=30*n*n*(n*(n-2)+1),p=30*e*e*(e*(e-2)+1),y=30*l*l*(l*(l-2)+1);let z=0,k=0,C=0,S=0;for(let v=0;v<8;v++){const g=v&1,b=v>>>1&1,x=v>>>2,M=Re(i+g,r+b,u+x,a),L=(M&1023)/511.5-1,G=(M>>>10&1023)/511.5-1,F=(M>>>20&1023)/511.5-1,A=g?h:1-h,w=b?f:1-f,R=x?d:1-d,q=g?m:-m,E=b?p:-p,N=x?y:-y,T=L*(n-g)+G*(e-b)+F*(l-x),H=A*w*R;z+=T*H,k+=L*H+T*q*w*R,C+=G*H+T*A*E*R,S+=F*H+T*A*w*N}c[0]=z*1.7,c[1]=k*1.7,c[2]=C*1.7,c[3]=S*1.7}function at(o,t,s,a){const c=Math.floor(o),i=Math.floor(t),r=o-c,u=t-i;let n=0,e=0,l=0;for(let f=-1;f<=1;f++)for(let d=-1;d<=1;d++){const m=Re(c+d,0,i+f,s);if((m&7)>4)continue;const p=r-(d+.5+((m&255)/255-.5)),y=u-(f+.5+((m>>>8&255)/255-.5)),z=m>>>24&3,k=z===0?1:z===2?0:z===1?.7071067811865476:-.7071067811865476,C=z===0?0:z===2?1:.7071067811865476,S=k*p+C*y,v=-C*p+k*y,g=.1+.3*(m>>>16&15)/15,b=.1+.3*(m>>>20&15)/15,x=1/(g*g),M=1/(b*b),L=S*S*x+v*v*M;if(L>=1)continue;const G=1-L,F=.6+1.8*(m>>>28)/15,A=-4*F*G;n+=F*G*G,e+=A*(k*S*x-C*v*M),l+=A*(C*S*x+k*v*M)}const h=Math.exp(-n);a[0]=1-h,a[1]=e*h,a[2]=0,a[3]=l*h}function ot(o,t,s,a,c,i,r){i.fill(0);const u=a>>>29&3;for(let n=0;n<ue.length;n++){const e=ue[n],l=Le(e.wavelength*e.aspect*e.filterWidth,c);if(i[4]+=(e.amplitude/e.wavelength)**2*(1+1/e.aspect**2)*e.variance*(1-l*l),l<=0)continue;let h=e.c,f=e.s;u===1?(h=-e.s,f=e.c):u===2?(h=-e.c,f=-e.s):u===3&&(h=e.s,f=-e.c);const d=h*o+f*s,m=-f*o+h*s,p=e.wavelength;if(n===2){at(d/p,m/(p*e.aspect),a+Math.imul(n+1,1821285621)>>>0,r);const A=e.amplitude*l,w=r[1]/p,R=r[3]/(p*e.aspect);i[0]+=(r[0]-.1)*A,i[1]+=(h*w-f*R)*A,i[3]+=(f*w+h*R)*A;continue}tt((.36*d-.8*t+.48*m)/p+17.137+n*9.173,(.48*d+.6*t+.64*m)/(p*e.aspect)+3.731-n*5.731,(-.8*d+.6*m)/p-11.517+n*7.337,a+Math.imul(n+1,1821285621)>>>0,r);const y=r[0],z=1/Math.sqrt(1+y*y),k=.72*y*z;let C=k,S=1;if(n===0){const A=Math.sqrt(k*k+.02);C=.3-A,S=-k/A}else if(n===1){const A=2**(-32*k*k);C=.4-A,S=64*Math.LN2*k*A}const v=e.amplitude*l,g=v*S*.72*z**3/p,b=r[1],x=r[2]/e.aspect,M=r[3],L=.36*b+.48*x-.8*M,G=-.8*b+.6*x,F=.48*b+.64*x+.6*M;i[0]+=C*v,i[1]+=(h*L-f*F)*g,i[2]+=G*g,i[3]+=(f*L+h*F)*g}}function rt(o,t,s,a){const c=s-.0065*Math.max(o,0),i=I(250,1400,a),r=(1-I(-5,1,c))*(1-I(.55,1.3,t)),u=1-r,n=I(.25,.9,t)*u,e=I(-8,4,c)*(1-I(28,42,c)),l=i*e*(u-n),h=u-n-l;return I(.025,.18,t)*I(0,2,o)*(n+.16*h+.045*l+.018*r)}function gt(o,t){const s=t.seed>>>0,a=t.climate??[14,900],c=t.macroSampler??o,i=c===o,r=Math.max(.125,Math.min(2,Math.max(0,t.sourceCell??20)*.025)),u=new Float64Array(5),n=new Float64Array(4);let e=NaN,l=!0;return(h,f,d=0)=>{const m=o(h,f,0);if(m<=0)return m;const p=Math.max(0,d);if(p!==e&&(e=p,l=ue.some(S=>Le(S.wavelength*S.aspect*S.filterWidth,p)>0)),!l)return m;const y=i?m:c(h,f,0),z=(c(h+r,f,0)-c(h-r,f,0))/(2*r),k=(c(h,f+r,0)-c(h,f-r,0))/(2*r),C=rt(y,Math.hypot(z,k),a[0],a[1]);return C<=0?m:(ot(h,0,f,s,Math.max(0,d),u,n),m+u[0]*C)}}const nt=o=>Number.isInteger(o)?`${o}.`:String(o),P=o=>ue.map(t=>nt(t[o])).join(","),wt=`
// Share of loose wind-blown sand of this fragment (the sand sea of the zone), set by v2ZoneEnv before the material.
float surfaceGroundSand=0.;
uint groundHash(ivec3 cell,uint seed){
  uvec3 p=uvec3(cell);uint h=(p.x*0x9e3779b9u)^(p.y*0x85ebca6bu)^(p.z*0xc2b2ae35u)^seed;
  h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);
}
vec4 groundGravel(vec2 point,uint seed){
  ivec2 cell=ivec2(floor(point));vec2 f=fract(point);float sum=0.,tone=0.;vec2 gradient=vec2(0.);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    ivec2 neighbour=cell+ivec2(i,j);uint h=groundHash(ivec3(neighbour.x,0,neighbour.y),seed);
    if((h&7u)>4u)continue;
    vec2 offset=vec2(i,j)+.5+(vec2(float(h&255u),float((h>>8u)&255u))/255.-.5);
    vec2 d=f-offset;int angle=int((h>>24u)&3u);
    float c=angle==0?1.:angle==2?0.:angle==1?.7071067811865476:-.7071067811865476;
    float s=angle==0?0.:angle==2?1.:.7071067811865476;
    vec2 uv=vec2(c*d.x+s*d.y,-s*d.x+c*d.y);
    vec2 radius=.10+.30*vec2(float((h>>16u)&15u),float((h>>20u)&15u))/15.;
    vec2 inverse=1./(radius*radius);float q=dot(uv*uv,inverse);if(q>=1.)continue;
    float t=1.-q,weight=.6+1.8*float(h>>28u)/15.;sum+=weight*t*t;tone+=weight*t*t*(float((h>>12u)&15u)/15.-.5);
    gradient+=-4.*weight*t*vec2(c*uv.x*inverse.x-s*uv.y*inverse.y,s*uv.x*inverse.x+c*uv.y*inverse.y);
  }
  float attenuation=exp(-sum);return vec4(1.-attenuation,gradient.x*attenuation,tone*attenuation,gradient.y*attenuation);
}
// A compact C1 cap and its gradient in cell coordinates. Jitter and support
// stay inside the owning cell, including the shadow: no neighbour search.
vec3 surfaceGroundCap(vec2 d,vec2 radius){
  vec2 inverse=1./(radius*radius);float t=max(1.-dot(d*d,inverse),0.);
  return vec3(t*t,-4.*t*d*inverse);
}
vec3 surfaceGroundCover(vec2 world,float slope,float fp,float rock,float grass,uint salt,vec3 broad,vec3 fine){
  surfaceGroundSlope=vec2(0.);vec3 tone=vec3(0.);
  if(uQuality>0)return tone;
#ifdef RENDER3D_FOREST
  if(uGroundCover.w<.5||uForest==0||uForestBrushes!=0||uRenderV2>1||fp>=10.||surfaceGroundHeight<=0.)return tone;
  if(fp>=3.&&surfaceGroundEnv.z<.01)return tone;
  // v2GroundEnv scales groundField by this substrate gain. Cover normals are
  // already material-specific and must also survive on perfectly flat plains.
  if(uRenderV2==1)surfaceGroundNormalGain=mix(.02+.43*rock+.07*(1.-grass),.008,v2GroundSnow);
  bool supplied=surfaceGroundHasInputs&&all(equal(world,surfaceGroundPoint));
  vec3 occupation=supplied?surfaceGroundOccupation:vec3(0.);
  int cls=supplied?int(occupation.z):uHasOccupation==1?-1:0;
  // Unknown occupation is conservative until the caller supplies its existing
  // categorical sample. Fields, roads and buildings must never sprout cover.
  if(cls<0||cls==1||cls==4||cls==5||cls==7||cls==8||cls==9||cls==10)return tone;
  float snow=clamp(uRenderV2==1?v2GroundSnow:surfaceGroundEnv.w,0.,1.),exposed=1.-snow;
  if(exposed<=0.)return tone;
  float moisture=surfaceGroundEnv.x,green=surfaceGroundEnv.y;
  float land=supplied&&cls>0?sstep(0.,max(.3,fp),min(occupation.x,-occupation.y)):1.;
  exposed*=land*(1.-surfaceGroundWet);vec2 light=uGroundCover.xz;
  light=dot(light,light)>.0001?normalize(light):vec2(1.,0.);
  float herb=grass*(1.-rock)*exposed*(1.-sstep(.35,.7,slope));
  // Sward grain: continuous zero-mean bands under the 0.8 m mottle band. Discrete
  // tufts (lit elliptic caps on a lattice) read as small crescents up close.
  float swardKeep=1.-sstep(.125,.25,fp);
  if(herb>.01&&swardKeep>0.){
    float density=(.38+.55*sstep(.2,1.6,moisture))*(cls==2?1.:cls==3?.8:.72);
    if(uRenderV2==1){
      float phase=.5-.5*cos(6.283185307*uV2Season);
      float temperature=uMaterialClimate.x-.0065*surfaceGroundHeight+6.*(2.*phase-1.);
      green=sstep(.35,1.3,moisture)*sstep(1.,13.,temperature);
    }
    float fineKeep=1.-sstep(.035,.07,fp);
    vec3 s1=surfaceBand(world,1.,salt+817u),s2=fineKeep>0.?surfaceBand(world,.28,salt+818u):vec3(0.);
    float amount=herb*density;
    surfaceGroundSlope+=amount*(.03*swardKeep*s1.yz+.012*fineKeep*s2.yz);
    float grain=.6*swardKeep*s1.x+.4*fineKeep*s2.x;
    tone+=.07*amount*grain*mix(vec3(.85,.70,.32),vec3(.55,.85,.38),green);
  }
  // Wind forms need loose sand: a gravel plain stays flat. The satellite look takes its sand from the sand sea
  // of the zone (surfaceGroundSand), whose dunes are landforms drawn at every zoom by v2GroundDunes; only the
  // ripples are left to this close-range pass. The other looks keep a 90 m wave on arid sand.
  float sand=(uRenderV2==1?surfaceGroundSand:sstep(.3,.7,surfaceGroundEnv.z))*(1.-rock)*(1.-grass)*exposed*(1.-sstep(.35,.7,slope));
  float reach=.32;
  if(uRenderV2==0)reach=10.;
  if(sand>.01&&fp<reach){
    float angle=float(salt&1023u)*.006135923;vec2 wind=vec2(cos(angle),sin(angle));
    vec3 flow=surfaceBand(world,1600.,salt+821u);
    if(uRenderV2==0){
      // Long crests across the wind: a strong warp would break them into dimples.
      float phase=dot(world,wind)*.0698+2.5*flow.x+.07*surfaceGroundHeight;
      vec2 rate=wind*.0698+2.5*flow.yz+.07*surfaceGroundGradient;
      float keep=(1.-sstep(5.,10.,fp))*(1.-sstep(.125,.25,fp*length(rate)/6.283185307));
      surfaceGroundSlope+=sand*keep*.9*cos(phase)*rate;
      tone+=vec3(sand*keep*.05*sin(phase));
    }
    // Warped scalar phase gives a continuous wind field and its true gradient;
    // the terrain height bends the phase uphill without view-dependent noise.
    if(fp<.32){
      float ripple=dot(world,wind)*4.4879895+1400.*flow.x+.6*surfaceGroundHeight;
      vec2 rippleRate=wind*4.4879895+1400.*flow.yz+.6*surfaceGroundGradient;
      float rippleKeep=(1.-sstep(.16,.32,fp))*(1.-sstep(.125,.25,fp*length(rippleRate)/6.283185307));
      surfaceGroundSlope+=sand*rippleKeep*.065*cos(ripple)*rippleRate;
    }
  }
  float bank=supplied?surfaceGroundBank:1e9;
  float distance=min(surfaceGroundShore,bank);
  float bankKeep=exposed*sstep(0.,.3,distance)*(1.-sstep(8.,36.,distance))*(1.-sstep(.5,.9,slope));
  bankKeep*=max(surfaceGroundBeach,1.-.55*grass);
  if(bankKeep>.01&&fp<1.){
    // Gravel bars resolve as aggregates before individual cobbles/pebbles.
    // Every band is a centred derivative, including while levels crossfade.
    float coarse=1.-sstep(2.,18.,distance);
    float k=1.-sstep(.4,1.,fp),mediumKeep=1.-sstep(.12,.3,fp);
    float fineKeep=1.-sstep(.01,.026,fp);
    for(int level=0;level<3;level++){
      float keep=level==0?k*(1.-mediumKeep):level==1?mediumKeep*(1.-fineKeep):fineKeep;
      if(keep<=0.)continue;
      float cell=level==0?8.:level==1?2.4:.26;
      float height=level==0?.75:level==1?.32:.03;
      vec4 cap=groundGravel(world/cell,salt+827u+uint(level));vec2 g=cap.yw/cell;
      float amount=bankKeep*keep*(.45+.55*coarse);
      surfaceGroundSlope+=amount*height*g;
      tone+=amount*(vec3(height*.20*dot(g,light)-.10*cap.x)+cap.z*vec3(.28,.25,.20)+cap.x*vec3(.08,.07,.16));
    }
  }
  float scree=sstep(.22,.42,slope)*(1.-sstep(1.1,1.7,slope))*(1.-.85*grass)*exposed;
  float blockKeep=1.-sstep(1.2,3.,fp);
  if(scree>.01&&blockKeep>0.){
    vec2 q=world/16.;uint h=groundHash(ivec3(ivec2(floor(q)),839),salt);
    if(float(h>>24u)/255.<.12+.16*rock){
      // Boulders spread over the cell and cast a shadow of their own size: a near-centred
      // block with one fixed shadow drew the same crescent on a regular 16 m lattice.
      vec2 radius=.09+.12*vec2(float((h>>16u)&15u),float((h>>20u)&15u))/15.;
      float reach=max(radius.x,radius.y)*1.9;
      vec2 centre=reach+(1.-2.*reach)*vec2(float(h&255u),float((h>>8u)&255u))/255.;
      vec2 d=fract(q)-centre;vec3 cap=surfaceGroundCap(d,radius);
      float amount=scree*blockKeep;
      surfaceGroundSlope+=amount*cap.yz*1.3/16.;
      vec2 shadowRadius=vec2(1.2*max(radius.x,radius.y),.95*min(radius.x,radius.y));
      vec2 shadowD=d+light*.55*shadowRadius.x;
      vec2 shadowUv=vec2(dot(shadowD,light),dot(shadowD,vec2(-light.y,light.x)));
      float shadow=surfaceGroundCap(shadowUv,shadowRadius).x;
      // Equal kernel integrals keep the cast shadow and its lit cap neutral.
      float centredShadow=shadow-cap.x*(shadowRadius.x*shadowRadius.y)/(radius.x*radius.y);
      float tip=cap.x*(sqrt(cap.x)-.75);
      float shadowStrength=1.-sstep(.85,.99,uGroundCover.y/max(length(uGroundCover.xyz),.001));
      tone+=vec3(amount*(.3*tip-.10*centredShadow*shadowStrength));
    }
  }
#endif
  return tone;
}
`,xt=`
float groundSmooth(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
vec3 groundToLinear(vec3 c){return pow(max(c,vec3(0.)),vec3(2.2));}
vec3 groundToDisplay(vec3 c){
#ifdef RENDER3D_FOREST
  if(uRenderV2>0)return pow(max(c,vec3(0.)),vec3(1./2.2));
#endif
  return pow(clamp(c,vec3(0.),vec3(1.)),vec3(1./2.2));
}
vec4 groundNoise(vec3 point,uint seed){
  ivec3 cell=ivec3(floor(point));vec3 f=fract(point),u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
  vec4 n=vec4(0.);
  for(int k=0;k<8;k++){
    ivec3 corner=ivec3(k&1,(k>>1)&1,k>>2);uint h=groundHash(cell+corner,seed);
    vec3 g=vec3(float(h&1023u),float((h>>10u)&1023u),float((h>>20u)&1023u))/511.5-1.;
    vec3 w=mix(1.-u,u,vec3(corner)),d=mix(-du,du,vec3(corner));float v=dot(g,f-vec3(corner));
    n+=vec4(v*w.x*w.y*w.z,g*w.x*w.y*w.z+v*vec3(d.x*w.y*w.z,w.x*d.y*w.z,w.x*w.y*d.z));
  }return n*1.7;
}
const float groundWavelength[4]=float[4](${P("wavelength")});
const float groundAmplitude[4]=float[4](${P("amplitude")});
const float groundAspect[4]=float[4](${P("aspect")});
const float groundFilterWidth[4]=float[4](${P("filterWidth")});
const float groundRotationC[4]=float[4](${P("c")});
const float groundRotationS[4]=float[4](${P("s")});
const float groundVarianceFactor[4]=float[4](${P("variance")});
float groundVisibility(float wavelength,float footprint){
  float t=clamp((footprint/wavelength-.18)/.24,0.,1.);return 1.-t*t*t*(t*(t*6.-15.)+10.);
}
float groundSlopeVariance(float footprint){
  float variance=0.;for(int k=0;k<4;k++){
    float a=groundAmplitude[k]/groundWavelength[k];
    float keep=groundVisibility(groundWavelength[k]*groundAspect[k]*groundFilterWidth[k],max(footprint,0.));
    variance+=a*a*(1.+1./(groundAspect[k]*groundAspect[k]))*groundVarianceFactor[k]*(1.-keep*keep);
  }return variance;
}
vec4 groundFieldWithClasts(vec3 point,uint seed,float footprint,out float clasts){
  vec4 sum=vec4(0.);clasts=0.;int turn=int((seed>>29u)&3u);
  if(uQuality>0)return sum;
  for(int k=0;k<4;k++){
    float wavelength=groundWavelength[k];
    float keep=groundVisibility(wavelength*groundAspect[k]*groundFilterWidth[k],max(footprint,0.));if(keep<=0.)continue;
    float c=groundRotationC[k],s=groundRotationS[k],aspect=groundAspect[k];
    if(turn==1){float old=c;c=-s;s=old;}else if(turn==2){c=-c;s=-s;}else if(turn==3){float old=c;c=s;s=-old;}
    vec3 r=vec3(c*point.x+s*point.z,point.y,-s*point.x+c*point.z);
    if(k==2){
      vec4 cap=groundGravel(r.xz/vec2(wavelength,wavelength*aspect),seed+uint(k+1)*0x6c8e9cf5u);
      // Gravel caps are loose stones: on scree and the stony units only (surfaceGroundClasts, set by surfaceMicro).
      vec2 g=cap.yw/vec2(wavelength,wavelength*aspect);float a=groundAmplitude[k]*keep*surfaceGroundClasts;
      sum+=vec4((cap.x-.1)*a,(c*g.x-s*g.y)*a,0.,(s*g.x+c*g.y)*a);clasts=cap.x*keep*surfaceGroundClasts;continue;
    }
    vec3 q=vec3(dot(r,vec3(.36,-.8,.48)),dot(r,vec3(.48,.6,.64))/aspect,dot(r,vec3(-.8,0.,.6)))/wavelength;
    q+=vec3(17.137,3.731,-11.517)+float(k)*vec3(9.173,-5.731,7.337);
    vec4 n=groundNoise(q,seed+uint(k+1)*0x6c8e9cf5u);
    // The ridge of the 8 m band and the groove of the 2.2 m band lie on the zero set of a smooth noise. The
    // displaced geometry keeps these profiles (surfaceFineBreak is 1 where no fragment was shaded). In a shaded
    // fragment (0, set by surfaceMicro) the crest and the furrow would draw the closed loops of that noise in
    // the light, so there each band is its plain undulation, at half height.
    float inverse=inversesqrt(1.+n.x*n.x),v=.72*n.x*inverse,value=v,derivative=1.;
    if(k==0){float rounded=sqrt(v*v+.02);value=mix(.5*v,.3-rounded,surfaceFineBreak);derivative=mix(.5,-v/rounded,surfaceFineBreak);}
    else if(k==1){float groove=exp2(-32.*v*v);value=mix(.5*v,.4-groove,surfaceFineBreak);derivative=mix(.5,44.36141956*v*groove,surfaceFineBreak);}
    float a=groundAmplitude[k]*keep,d=a*derivative*.72*inverse*inverse*inverse/wavelength;
    vec3 g=vec3(.36*n.y+.48*n.z/aspect-.8*n.w,-.8*n.y+.6*n.z/aspect,.48*n.y+.64*n.z/aspect+.6*n.w);
    sum+=vec4(value*a,vec3(c*g.x-s*g.z,g.y,s*g.x+c*g.z)*d);
  }
  // Under water (surfaceGroundDry 0, set by surfaceMicro) the bed is smooth sediment: no gravel caps, no relief.
  return sum*surfaceGroundDry;
}
// surfaceMicroSlope is the relief of the colour bands of this fragment, so a
// lit crack is also a dark one. Slope only: the height keeps its ground bands.
vec4 groundField(vec3 point,uint seed,float footprint){
  vec2 slope=surfaceMicroSlope+surfaceGroundSlope*(1./max(surfaceGroundNormalGain,.008)-1.);
  float clasts;return groundFieldWithClasts(point,seed,footprint,clasts)+vec4(0.,slope.x,0.,slope.y);
}
// rock / soil / grass / snow; continuous and sums to one.
vec4 groundCover(vec3 macro,vec2 climate){
  float grade=length(macro.yz),temperature=climate.x-.0065*max(macro.x,0.),wet=groundSmooth(250.,1400.,climate.y);
  float snow=(1.-groundSmooth(-5.,1.,temperature))*(1.-groundSmooth(.55,1.3,grade));
  float exposed=1.-snow,rock=groundSmooth(.25,.9,grade)*exposed;
  float growth=groundSmooth(-8.,4.,temperature)*(1.-groundSmooth(28.,42.,temperature));
  float grass=wet*growth*(exposed-rock),soil=exposed-rock-grass;
  return vec4(rock,soil,grass,snow);
}
float groundGain(vec3 macro,vec4 cover){
  return groundSmooth(.025,.18,length(macro.yz))*groundSmooth(0.,2.,macro.x)*dot(cover,vec4(1.,.16,.045,.018));
}
// Fixed XZ reference plane prevents the displaced height feeding its own phase.
// Gradients are delta only; cover-envelope derivatives are macro approximations.
vec3 groundDisplacement(vec3 macro,vec2 world,float footprint,vec2 climate,uint seed){
  vec4 cover=groundCover(macro,climate),detail=groundField(vec3(world.x,0.,world.y),seed,footprint);
  return vec3(detail.x,detail.y,detail.w)*groundGain(macro,cover);
}
struct GroundMaterial {vec3 albedo;vec3 normal;float roughness;float occlusion;};
GroundMaterial terrainGroundMaterial(vec3 macro,vec2 world,float footprint,vec3 macroColor,vec2 climate,uint seed,float meshFootprint){
  float fp=max(0.,footprint);vec4 cover=groundCover(macro,climate);float gain=groundGain(macro,cover);
  vec3 micro=surfaceMicro(world,length(macro.yz),fp,cover.x,cover.z,seed);
  float clasts,meshClasts;vec4 detail=groundFieldWithClasts(vec3(world.x,0.,world.y),seed,fp,clasts);vec2 gradient=(detail.yw+surfaceMicroSlope)*gain+surfaceGroundSlope*(1.-gain);
  // Subtract the slope already represented by the displaced mesh. Zero means
  // an undisplaced macro surface; tiny positive means all bands represented.
  if(meshFootprint>0.)gradient-=groundFieldWithClasts(vec3(world.x,0.,world.y),seed,meshFootprint,meshClasts).yw*gain;
  GroundMaterial m;m.normal=normalize(vec3(-macro.y-gradient.x,1.,-macro.z-gradient.y));
  float form=clamp(detail.x*18.,-1.,1.),cavity=clamp(-detail.x*20.,0.,1.)*cover.x;
  // The slope cover keeps its weights; earthMaterial supplies this fragment's lithology.
  vec3 rock=mix(macroColor,surfaceRockTone,.7),soil=mix(macroColor,surfaceSoilTone,.18);
  vec3 grass=macroColor*vec3(.96,1.02,.93),snow=mix(macroColor,vec3(.87,.91,.95),.35);
  vec3 color=rock*cover.x+soil*cover.y+grass*cover.z+snow*cover.w;
  color*=1.+form*dot(cover,vec4(.12,.055,.045,.012));
  // The visible cap that displaced this stone also lightens its mineral crest
  // and slightly polishes it. No independent high-frequency color noise.
  float cap=groundSmooth(.05,.7,clasts);color*=1.+cap*.12*cover.x;
  color*=micro*(1.-cavity*.11);
  float wet=groundSmooth(500.,1800.,climate.y)*(1.-cover.w),roughness=dot(cover,vec4(.52,.83,.91,.76));
  roughness-=wet*(.08*cover.y+.10*cavity);roughness+=(form*.025-cap*.055)*cover.x;
  float alpha2=pow(clamp(roughness,.38,.98),4.)+gain*gain*groundSlopeVariance(fp);
  m.albedo=groundToLinear(clamp(color,vec3(.015),vec3(.96)));m.roughness=clamp(pow(alpha2,.25),.38,.98);
  // Local cavity approximation, not traced visibility or a shadow map.
  m.occlusion=clamp(1.-.22*cavity-.04*max(-form,0.)*cover.y,.72,1.);return m;
}
GroundMaterial terrainGroundMaterial(vec3 macro,vec2 world,float footprint,vec3 macroColor,vec2 climate,uint seed){
  return terrainGroundMaterial(macro,world,footprint,macroColor,climate,seed,0.);
}
vec3 groundBrdf(GroundMaterial m,vec3 view,vec3 light){
  vec3 n=m.normal,v=normalize(view),l=normalize(light),halfVector=normalize(v+l);
  float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,halfVector),0.),vh=max(dot(v,halfVector),0.);
  float a=m.roughness*m.roughness,a2=a*a,denominator=nh*nh*(a2-1.)+1.;
  float distribution=a2/(3.14159265*denominator*denominator);
  float visibility=.5/max(nl*sqrt(nv*nv*(1.-a2)+a2)+nv*sqrt(nl*nl*(1.-a2)+a2),.001);
  float fresnel=.04+.96*pow(1.-vh,5.);
  return ((1.-fresnel)*m.albedo/3.14159265+vec3(distribution*visibility*fresnel))*nl;
}
// Relief light of the fragment, written around its shading by v2ShadeGround (terrainRenderV2Relief): x is the
// share of the sky the terrain leaves open (scales the ambient term), y the share of the primary light that no
// cast shadow cuts, z the slope light of the landform (a gain on the whole lit response). Neutral at 1.
vec3 groundReliefLight=vec3(1.);
vec3 shadeTerrainGround(GroundMaterial m,vec3 view,vec3 light,vec3 light2,float strength){
  float sky=groundReliefLight.x,sun=groundReliefLight.y,form=groundReliefLight.z;
  if(uQuality>0){
    // One diffuse light over the retained material and macro normal.
    float diffuse=max(dot(m.normal,normalize(light)),0.)*sun;
    return groundToDisplay(m.albedo*mix(1.,(.5*m.occlusion*sky+.75*diffuse)*form,clamp(strength,0.,1.)));
  }
  // In a cast shadow only the sky lights the ground: the ambient term turns blue and the slope stays readable.
  float amount=clamp(strength,0.,1.);vec3 ambient=m.albedo*(.34+.16*clamp(m.normal.y,0.,1.))*m.occlusion*sky*mix(vec3(.90,.98,1.14),vec3(1.),sun);
  // The second light stands for the sky opposite the sun: enclosed ground loses half of it.
  vec3 direct=groundBrdf(m,view,light)*(2.2*sun)+groundBrdf(m,view,light2)*(.58*(.5+.5*sky));
  return groundToDisplay(mix(m.albedo,ambient*form,amount)+direct*(form*max(strength,0.)));
}
`;export{wt as G,mt as T,dt as U,gt as a,ht as b,pt as c,Qe as d,xt as e,ct as f,Ye as h,vt as p,ft as r,ut as u};
