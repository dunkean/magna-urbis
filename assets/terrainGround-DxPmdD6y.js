import{N as ze,M as We,w as De,O as qe,Q as ge,e as Ee,R as fe}from"./vectorWaterRender-BDjpXmJ5.js";import{F as he}from"./platform-D2t9mMQc.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const ue=new WeakMap;function Ke(o,t,n=1){let a=ue.get(o);a||(a=new Map,ue.set(o,a));const c=ze("box-f32",t,n),i=a.get(c);if(i)return i;const s=We("mips",()=>{const d=[o];let r=t;for(;r>1&&r%2===0;){const e=d[d.length-1],l=r/2,h=new Float32Array(l*l*n);for(let f=0;f<l;f++)for(let u=0;u<l;u++)for(let m=0;m<n;m++){const p=(2*f*r+2*u)*n+m;h[(f*l+u)*n+m]=(e[p]+e[p+n]+e[p+r*n]+e[p+(r+1)*n])*.25}d.push(h),r=l}return d});return a.set(c,s),s}function lt(o,t,n,a=1){let c=t,i=0;for(;c>1&&c%2===0;){if(c/=2,n[i]?.length!==c*c*a)return;i++}if(n.length!==i)return;let s=ue.get(o);s||(s=new Map,ue.set(o,s));const d=ze("box-f32",t,a);s.has(d)||s.set(d,[o,...n])}const X=new Map,Le=3,Ie=4,Ve=3;function Be(o,t){if(!/^[MLZ\d\s.,eE+-]*$/.test(o))return;const n=o.match(/[MLZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)??[],a=[];let c,i="";for(let r=0;r<n.length;){const e=n[r];if(e==="M"||e==="L"||e==="Z"){i=e,r++,e==="Z"&&c&&(c.closed=!0,c=void 0);continue}const l=Number(e),h=Number(n[r+1]);if(r+=2,!Number.isFinite(l)||!Number.isFinite(h))return;(i==="M"||!c)&&(c={pts:[],closed:!1},a.push(c),i="L"),c.pts.push([l,h])}const s=(r,e)=>r<=.01||e<=.01||r>=t-.01||e>=t-.01;let d="";for(const r of a){let e=r.pts;if(r.closed&&e.length>1&&e[0][0]===e.at(-1)[0]&&e[0][1]===e.at(-1)[1]&&(e=e.slice(0,-1)),r.closed&&e.length>=3){const l=[],h=[],f=[];for(let p=0;p<e.length;p++){const[x,S]=e[p],[M,F]=e[(p+1)%e.length],A=Math.hypot(M-x,F-S),v=Math.max(1,Math.round(A/Le)),g=s(x,S)&&s(M,F)&&(Math.abs(x-M)<.02||Math.abs(S-F)<.02);for(let b=0;b<v;b++)l.push(x+(M-x)*b/v),h.push(S+(F-S)*b/v),f.push(g||b===0&&s(x,S))}const u=l.length,m=Math.min(Ie,Math.floor(u/16));if(m>0)for(let p=0;p<Ve;p++){const x=l.slice(),S=h.slice();for(let M=0;M<u;M++){if(f[M])continue;let F=0,A=0;for(let v=-m;v<=m;v++){const g=(M+v+u)%u;F+=x[g],A+=S[g]}l[M]=F/(2*m+1),h[M]=A/(2*m+1)}}e=l.map((p,x)=>[p,h[x]])}d+=e.map((l,h)=>`${h?"L":"M"}${l[0].toFixed(2)},${l[1].toFixed(2)}`).join("")+(r.closed?"Z":"")}return d}function ct(o,t){const n=`${t}:${o}`,a=X.get(n);if(a)return a;const c=[],i=document.createElementNS("http://www.w3.org/2000/svg","svg");i.setAttribute("width",String(t)),i.setAttribute("height",String(t)),i.setAttribute("viewBox",`0 0 ${t} ${t}`),i.style.cssText="position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none",i.innerHTML=o,document.body.append(i);try{const s=i.getScreenCTM()?.inverse();for(const d of Array.from(i.querySelectorAll("path,circle,polygon,rect"))){if(d.closest("defs,clipPath,mask")||d.getAttribute("fill")==="none")continue;const r=new Path2D;if(d.tagName==="path"){const f=d.getAttribute("d")??"";r.addPath(new Path2D(Be(f,t)??f))}else if(d.tagName==="circle")r.arc(Number(d.getAttribute("cx")),Number(d.getAttribute("cy")),Number(d.getAttribute("r")),0,Math.PI*2);else if(d.tagName==="rect")r.rect(Number(d.getAttribute("x")),Number(d.getAttribute("y")),Number(d.getAttribute("width")),Number(d.getAttribute("height")));else{const f=(d.getAttribute("points")??"").trim().split(/[\s,]+/).map(Number);for(let u=0;u+1<f.length;u+=2)u?r.lineTo(f[u],f[u+1]):r.moveTo(f[u],f[u+1]);r.closePath()}const e=new Path2D,l=d.getScreenCTM(),h=l&&s?s.multiply(l):d.getCTM();e.addPath(r,h??void 0),c.push({path:e,rule:d.getAttribute("fill-rule")==="evenodd"?"evenodd":"nonzero"})}}finally{i.remove()}for(X.set(n,c);X.size>3;)X.delete(X.keys().next().value);return c}const ve=4,$e=120,Oe=70,He=45,Fe=o=>Math.max(0,Math.min(1,o)),Y=(o,t,n)=>{const a=Fe((n-o)/(t-o));return a*a*(3-2*a)};function Pe(o,t){const n=new Float64Array(t),a=new Int32Array(t),c=new Float64Array(t+1),i=new Float64Array(t),s=(d,r)=>{for(let l=0;l<t;l++)i[l]=d(l);let e=0;a[0]=0,c[0]=-1/0,c[1]=1/0;for(let l=1;l<t;l++){let h=(i[l]+l*l-(i[a[e]]+a[e]*a[e]))/(2*l-2*a[e]);for(;h<=c[e];)e--,h=(i[l]+l*l-(i[a[e]]+a[e]*a[e]))/(2*l-2*a[e]);e++,a[e]=l,c[e]=h,c[e+1]=1/0}e=0;for(let l=0;l<t;l++){for(;c[e+1]<l;)e++;n[l]=(l-a[e])*(l-a[e])+i[a[e]]}for(let l=0;l<t;l++)r(l,n[l])};for(let d=0;d<t;d++)s(r=>o[r*t+d],(r,e)=>{o[r*t+d]=e});for(let d=0;d<t;d++)s(r=>o[d*t+r],(r,e)=>{o[d*t+r]=e})}function _e(o,t,n){const a=new Float32Array(t*t),c=new Float32Array(t*t),i=2*n+1,s=new Float32Array(t+2*n),d=new Float32Array(t+2*n),r=new Float32Array(t+2*n),e=(l,h)=>{const f=t+2*n;for(let u=0;u<f;u++){const m=u-n;s[u]=m>=0&&m<t?l(m):0}for(let u=0;u<f;u++)d[u]=u%i===0?s[u]:Math.max(d[u-1],s[u]);for(let u=f-1;u>=0;u--)r[u]=u===f-1||(u+1)%i===0?s[u]:Math.max(r[u+1],s[u]);for(let u=0;u<t;u++)h(u,Math.max(r[u],d[u+2*n]))};for(let l=0;l<t;l++)e(h=>o[l*t+h],(h,f)=>{a[l*t+h]=f});for(let l=0;l<t;l++)e(h=>a[h*t+l],(h,f)=>{c[h*t+l]=f});return c}function me(o,t,n){const a=new Float32Array(t);for(let c=0;c<3;c++)for(let i=0;i<2;i++)for(let s=0;s<t;s++){const d=e=>i?e*t+s:s*t+e;for(let e=0;e<t;e++)a[e]=o[d(e)];let r=0;for(let e=-n;e<=n;e++)r+=a[Math.max(0,Math.min(t-1,e))];for(let e=0;e<t;e++)o[d(e)]=r/(2*n+1),r+=a[Math.min(t-1,e+n+1)]-a[Math.max(0,e-n)]}}function _(o){const t=document.createElement("canvas");return t.width=t.height=o,t}const we=new WeakMap;function ut(o,t,n){if(!n?.zone||!o.length||!(t>0))return;const a=De(n);if(!qe(a)||a.aridity<=0&&a.ice<=0)return;const c=JSON.stringify([t,a]),i=we.get(o);if(i?.key===c)return i.regime;const s=je(o,t,a);return we.set(o,{key:c,regime:s}),s}function je(o,t,n){const a=Math.max(64,Math.min(2048,Math.round(t/2))),c=t/a,i=_(a),s=i.getContext("2d",{willReadFrequently:!0});s.setTransform(1/c,0,0,1/c,0,0),s.fillStyle="#fff";for(const w of o)s.fill(w.path,w.rule);const d=s.getImageData(0,0,a,a).data,r=a*a,e=new Uint8Array(r),l=new Float64Array(r);let h=!1;for(let w=0;w<r;w++)e[w]=d[w*4+3]>=128?1:0,l[w]=e[w]?1e20:0,e[w]&&(h=!0);if(!h)return;Pe(l,a);const f=new Float32Array(r);for(let w=0;w<r;w++)f[w]=e[w]?Math.sqrt(l[w])*c:0;const u=_e(f,a,Math.max(1,Math.round(Oe/c))),m=new Float32Array(r),p=new Float32Array(r),x=new Float32Array(r),S=Math.log($e/ve);for(let w=0;w<r;w++){if(!e[w])continue;const T=Fe(Math.log(Math.max(2*u[w],ve*.3)/ve)/S),N=ge(n,T);m[w]=N.dry,p[w]=N.ice,x[w]=1}const M=Math.max(1,Math.round(He/3/c));me(m,a,M),me(p,a,M),me(x,a,M);const F=ge(n,1),A=80*n.drop,v=Math.min(a,1024),g=_(v),b=_(v),y=_(v),k=_(v),R=_(v),z=[g,b,y,k,R].map(w=>w.getContext("2d").createImageData(v,v));let G=!1,C=!1;for(let w=0;w<v;w++)for(let T=0;T<v;T++){const N=Math.min(a-1,Math.floor((w+.5)*a/v))*a+Math.min(a-1,Math.floor((T+.5)*a/v)),D=(w*v+T)*4,W=x[N];let q=W>.001?m[N]/W:F.dry,E=W>.001?p[N]/W:F.ice;if(A>1&&e[N]){const K=A*Y(18,60,u[N]);K>1&&(q=Math.max(q,1-Y(.6*K,K,f[N])))}const I=Y(.55,.85,q),$=Y(.25,.5,q)*(1-I),O=Y(.35,.6,E);e[N]&&(O>.01&&(G=!0),I+$>.01&&(C=!0));const j=[0,(1-Math.max(I,.65*$))*(1-O),I,$,O];z[0].data.set([Math.round(255*(1-q)),Math.round(255*(1-E)),0,255],D);for(let K=1;K<5;K++)z[K].data.set([255,255,255,Math.round(255*j[K])],D)}return[g,b,y,k,R].forEach((w,T)=>w.getContext("2d").putImageData(z[T],0,0)),{climate:n,width:t,code:g,wet:b,dry:y,intermittent:k,ice:R,frozen:G,drying:C}}let Ue;function U(o,t,n,a){const c=o.canvas,i=Ue??=document.createElement("canvas");i.width!==c.width&&(i.width=c.width),i.height!==c.height&&(i.height=c.height);const s=i.getContext("2d");s.setTransform(1,0,0,1,0,0),s.globalCompositeOperation="source-over",s.globalAlpha=1,s.setLineDash([]),s.clearRect(0,0,i.width,i.height),s.setTransform(o.getTransform()),s.lineCap=s.lineJoin="round",a(s),s.globalCompositeOperation="destination-in",s.globalAlpha=1,s.imageSmoothingEnabled=!0,s.imageSmoothingQuality="high",s.drawImage(t,0,0,n,n),o.save(),o.setTransform(1,0,0,1,0,0),o.globalAlpha=1,o.globalCompositeOperation="source-over",o.drawImage(i,0,0),o.restore()}const ye=new WeakMap;function Ze(o){let t=ye.get(o);if(!t){t=_(o.width);const n=o.getContext("2d").getImageData(0,0,o.width,o.height);for(let a=1;a<n.data.length;a+=4)n.data[a]=255;t.getContext("2d").putImageData(n,0,0),ye.set(o,t)}return t}const L=(o,t)=>{for(const n of t)o.fill(n.path,n.rule)},pe=(o,t)=>{for(const n of t)o.stroke(n.path)};function Qe(o,t,n,a,c,i="parchment"){const s=o.getTransform(),d=1/Math.max(1e-9,Math.hypot(s.a,s.b)),r=n.width;if(a==="code"){o.save(),o.fillStyle="#fff",L(o,t),o.globalCompositeOperation="source-in",o.imageSmoothingEnabled=!0,o.imageSmoothingQuality="high",o.drawImage(Ee(i).satelliteVariant>0?Ze(n.code):n.code,0,0,r,r),o.restore();return}if(a==="ink"&&(o.fillStyle=c,L(o,t)),a==="cover"&&U(o,n.wet,r,e=>{e.fillStyle=c,L(e,t)}),a!=="cover"){if(a==="ink"||a==="symbols"){const e=fe(i,c);if(n.drying)for(const l of[n.intermittent,n.dry])U(o,l,r,h=>{h.fillStyle=e.bed,L(h,t),h.save();const f=new Path2D;for(const u of t)f.addPath(u.path);h.clip(f),h.strokeStyle=e.dry,h.lineWidth=1.2*d,pe(h,t),h.restore()});n.frozen&&U(o,n.ice,r,l=>{l.fillStyle=e.ice,L(l,t),l.strokeStyle=c,l.lineWidth=1.4*d,pe(l,t)});return}a==="ground"&&n.drying&&(U(o,n.dry,r,e=>{e.fillStyle=fe(i,c).bed,L(e,t)}),U(o,n.intermittent,r,e=>{e.fillStyle=fe(i,c).bed,L(e,t)})),a==="ice"&&n.frozen&&U(o,n.ice,r,e=>{e.fillStyle="#a9bac6",L(e,t),e.strokeStyle="#55697a",e.lineWidth=Math.max(1.2*d,1.2),pe(e,t)})}}function dt(o,t,n,a,c,i,s,d){return o.setTransform(1,0,0,1,0,0),o.clearRect(0,0,a.width,a.height),o.setTransform(a.width/n.width,0,0,a.height/n.height,-n.x*a.width/n.width,-n.y*a.height/n.height),i?(Qe(o,t,i,s?"code":"ink",c,d),s):(o.fillStyle=c,L(o,t),!1)}const ce=(o,t,n)=>Math.max(t,Math.min(n,o)),J=(o,t,n)=>{const a=ce((n-o)/(t-o),0,1);return a*a*(3-2*a)},xe=new Uint32Array(4096),be=new Uint8Array(4096),ee=new Float64Array(4096),te=new Float64Array(4096);function ie(o,t,n){let a=Math.imul(o,374761393)^Math.imul(t,668265263)^n;a=Math.imul(a^a>>>13,1274126177),a=(a^a>>>16)>>>0;const c=a&4095;if(!be[c]||xe[c]!==a){const i=a/4294967296*Math.PI*2;xe[c]=a,ee[c]=Math.cos(i),te[c]=Math.sin(i),be[c]=1}return c}function Xe(o,t,n,a){const c=Math.floor(o),i=Math.floor(t),s=o-c,d=t-i,r=ie(c,i,n),e=ee[r],l=te[r],h=ie(c+1,i,n),f=ee[h],u=te[h],m=ie(c,i+1,n),p=ee[m],x=te[m],S=ie(c+1,i+1,n),M=ee[S],F=te[S],A=e*s+l*d,v=f*(s-1)+u*d,g=p*s+x*(d-1),b=M*(s-1)+F*(d-1),y=s*s*s*(s*(s*6-15)+10),k=d*d*d*(d*(d*6-15)+10),R=30*s*s*(s*(s-2)+1),z=30*d*d*(d*(d-2)+1);a[0]=(A+(v-A)*y+(g-A)*k+(A-v-g+b)*y*k)*1.4,a[1]=(e+(f-e)*y+(p-e)*k+(e-f-p+M)*y*k+R*(v-A+(A-v-g+b)*k))*1.4,a[2]=(l+(u-l)*y+(x-l)*k+(l-u-x+F)*y*k+z*(g-A+(A-v-g+b)*y))*1.4}function Ye(o,t){const n=Math.max(.25,t.sourceCell),a={...t.detail},c=t.seed>>>0,i=(f,u)=>o(f,u,0);if(!t.refine||a.amplitude===0)return i;const s=Math.min(12,Math.max(1,Math.round(a.octaves)+4)),d=ce(a.lacunarity+.5,1.5,2.5),r=new Float64Array(3),e=Math.max(.125,n*.25),l=n*4,h=[];for(let f=0,u=n*8*a.start;f<s&&u>=.125;f++,u/=d){const m=.37+f*2.399963229728653,p=u/n,x=J(1.4,3.5,p),S=1-J(.045,.12,p);h.push({wavelength:u,c:Math.cos(m),s:Math.sin(m),seed:c+f*7919>>>0,broad:x,fine:S,middle:1-Math.max(x,S),wide:x>.5,carried:x+S*.15,hurst:Math.pow(Math.max(p,1),ce(a.hurst,.7,1.3)-1)*Math.pow(Math.min(p,1),Math.max(0,a.hurst-1))})}return(f,u)=>{const m=i(f,u);if(m<=0)return m;const p=(i(f+e,u)-i(f-e,u))/(2*e),x=(i(f,u+e)-i(f,u-e))/(2*e),S=Math.hypot(p,x),M=i(f,u-l),F=i(f,u+l),A=i(f+l,u),v=i(f-l,u),g=Math.max(Math.abs(m-M),Math.abs(m-F),Math.abs(m-A),Math.abs(m-v))/l,b=J(.002,.025,(m-(M+F+A+v)*.25)/l)*J(.04,.2,Math.max(S,g)),y=J(.04,.2,S);if(b===0&&y===0)return m;const k=p/Math.max(S,1e-6),R=x/Math.max(S,1e-6),z=Math.pow(Math.max(S+a.flat,1e-6),a.slope),G=Math.pow(Math.max(Math.max(S,g)+a.flat,1e-6),a.slope);let C=0,w=0,T=0;for(const{wavelength:N,c:D,s:W,seed:q,broad:E,fine:I,middle:$,wide:O,carried:j,hurst:K}of h){if(y===0&&E===0)break;Xe((f*D-u*W)/N,(f*W+u*D)/N,q,r);const oe=Math.sqrt(r[0]*r[0]+.0025),V=r[0]*.45+(.24-oe)*.55,H=.45-.55*r[0]/oe,Z=(r[1]*D+r[2]*W)*H,Q=(-r[1]*W+r[2]*D)*H,ne=E*b+I*y*3+$*y*.015,re=O?G:z;w+=Z*j,T+=Q*j;const se=1/(1+.65*(w*w+T*T)),Ne=1/(1+1.5*Math.abs(Z*k+Q*R));C+=V*N*a.amplitude*K*ne*re*se*Ne}return m+C*(a.shore>0?ce(m/a.shore,0,1):1)}}const ft=`
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
`;function Je(o,t){return Ke(o,t)}function Me(o,t){const n=t?Je(o.data,o.n):[o.data];return{layer:o,levels:n,cell:o.width/o.n,inset:t?0:2*o.width/o.n}}const ae=4096,ke=new Uint32Array(ae),Se=new Uint8Array(ae),Ge=new Float64Array(ae),Ae=new Float64Array(ae);function le(o,t,n,a,c){let i=Math.imul(o,374761393)^Math.imul(t,668265263)^c;i=Math.imul(i^i>>>13,1274126177),i=(i^i>>>16)>>>0;const s=i&ae-1;if(!Se[s]||ke[s]!==i){const d=i/4294967296*Math.PI*2;ke[s]=i,Ge[s]=Math.cos(d),Ae[s]=Math.sin(d),Se[s]=1}return Ge[s]*n+Ae[s]*a}function et(o,t,n){const a=Math.floor(o),c=Math.floor(t),i=o-a,s=t-c,d=i*i*i*(i*(i*6-15)+10),r=s*s*s*(s*(s*6-15)+10),e=le(a,c,i,s,n),l=le(a+1,c,i-1,s,n),h=le(a,c+1,i,s-1,n),f=le(a+1,c+1,i-1,s-1,n);return(e+(l-e)*d+(h-e)*r+(e-l-h+f)*d*r)*1.4}function ht(o,t,n=[],a=!1){const c=Me(o,!0),i=n.map(v=>Me(v,!1)).reverse(),s=t.floor,d=t.sourceCell,r={...t.detail},e=!a&&t.refine&&d>0&&r.amplitude!==0,l=[],h=Math.max(0,Math.min(he.length,Math.round(r.octaves)));let f=d*r.start;for(let v=0;e&&v<h&&f>0;v++,f/=Math.max(1.1,r.lacunarity))l.push({wavelength:f,c:Math.cos(he[v]),s:Math.sin(he[v]),amplitude:Math.pow(f/d,r.hurst),seed:t.seed+v*7919>>>0});const u=new Float64Array(16);let m=0,p=0,x=0;const S=(v,g)=>{const b=1-g,y=g*g,k=y*g;u[v]=b*b*b/6,u[v+1]=(3*k-6*y+4)/6,u[v+2]=(-3*k+3*y+3*g+1)/6,u[v+3]=k/6,u[v+4]=-.5*b*b,u[v+5]=1.5*y-2*g,u[v+6]=-1.5*y+g+.5,u[v+7]=.5*y},M=(v,g,b,y)=>{const{layer:k,levels:R}=v,z=Math.max(1,k.n>>g),G=v.cell*2**g,C=(b-k.x)/G-.5,w=(y-k.y)/G-.5,T=Math.floor(C),N=Math.floor(w),D=R[g];S(0,C-T),S(8,w-N);const W=z-1,q=Math.max(0,Math.min(W,T-1)),E=Math.max(0,Math.min(W,T)),I=Math.max(0,Math.min(W,T+1)),$=Math.max(0,Math.min(W,T+2)),O=u[0],j=u[1],K=u[2],oe=u[3];m=p=x=0;for(let V=0;V<4;V++){const H=Math.max(0,Math.min(W,N+V-1))*z,Z=D[H+q],Q=D[H+E],ne=D[H+I],re=D[H+$],se=Z*O+Q*j+ne*K+re*oe;m+=se*u[V+8],e&&(p+=(Z*u[4]+Q*u[5]+ne*u[6]+re*u[7])*u[V+8],x+=se*u[V+12])}p/=G,x/=G},F=(v,g,b,y,k)=>{if(M(v,g,y,k),b>.001&&g<v.levels.length-1){const R=m,z=p,G=x;M(v,g+1,y,k),m=R+(m-R)*b,p=z+(p-z)*b,x=G+(x-G)*b}},A=(v,g,b=0)=>{const y=Number.isFinite(b)?Math.max(0,b):0;let k=c;for(const R of i){const{layer:z,inset:G}=R;if(v>=z.x+G&&g>=z.y+G&&v<=z.x+z.width-G&&g<=z.y+z.width-G){k=R;break}}if(y<=k.cell)M(k,0,v,g);else{const R=k.levels.length-1,z=Math.max(0,Math.min(R,Math.log2(Math.max(1,y/k.cell))-.5)),G=Math.floor(z),C=z-G;F(k,G,C,v,g)}if(s>0&&(m=Math.max(m,s)),e&&m>0&&y*2<d*r.start){const R=r.amplitude*Math.pow(Math.max(Math.hypot(p,x)+r.flat,1e-6),r.slope)*d;let z=0;for(const G of l){const C=y>0?Math.max(0,Math.min(1,G.wavelength/y*.5-1)):1;if(C<=0)break;const w=et((v*G.c-g*G.s)/G.wavelength,(v*G.s+g*G.c)/G.wavelength,G.seed);z+=w*G.amplitude*C}m+=z*R*(r.shore>0?Math.max(0,Math.min(1,m/r.shore)):1)}return m};return a?Ye(A,t):A}const de=[{wavelength:8,amplitude:.17,aspect:.35,filterWidth:1,c:.8,s:.6,variance:.2},{wavelength:2.2,amplitude:.04,aspect:.24,filterWidth:.5,c:-.6,s:.8,variance:1.8},{wavelength:.32,amplitude:.012,aspect:.85,filterWidth:.5,c:.28,s:.96,variance:1.3},{wavelength:.055,amplitude:.002,aspect:.72,filterWidth:1,c:-.96,s:.28,variance:.4}],Ce=(o,t=0,n=1)=>Math.max(t,Math.min(n,o));function B(o,t,n){const a=Ce((n-o)/(t-o));return a*a*(3-2*a)}function Re(o,t){const n=Ce((t/o-.18)/.24);return 1-n*n*n*(n*(n*6-15)+10)}function Te(o,t,n,a){let c=Math.imul(o,2654435769)^Math.imul(t,2246822507)^Math.imul(n,3266489909)^a;return c=Math.imul(c^c>>>16,2146121005),c=Math.imul(c^c>>>15,2221713035),(c^c>>>16)>>>0}function tt(o,t,n,a,c){const i=Math.floor(o),s=Math.floor(t),d=Math.floor(n),r=o-i,e=t-s,l=n-d,h=r**3*(r*(r*6-15)+10),f=e**3*(e*(e*6-15)+10),u=l**3*(l*(l*6-15)+10),m=30*r*r*(r*(r-2)+1),p=30*e*e*(e*(e-2)+1),x=30*l*l*(l*(l-2)+1);let S=0,M=0,F=0,A=0;for(let v=0;v<8;v++){const g=v&1,b=v>>>1&1,y=v>>>2,k=Te(i+g,s+b,d+y,a),R=(k&1023)/511.5-1,z=(k>>>10&1023)/511.5-1,G=(k>>>20&1023)/511.5-1,C=g?h:1-h,w=b?f:1-f,T=y?u:1-u,N=g?m:-m,D=b?p:-p,W=y?x:-x,q=R*(r-g)+z*(e-b)+G*(l-y),E=C*w*T;S+=q*E,M+=R*E+q*N*w*T,F+=z*E+q*C*D*T,A+=G*E+q*C*w*W}c[0]=S*1.7,c[1]=M*1.7,c[2]=F*1.7,c[3]=A*1.7}function at(o,t,n,a){const c=Math.floor(o),i=Math.floor(t),s=o-c,d=t-i;let r=0,e=0,l=0;for(let f=-1;f<=1;f++)for(let u=-1;u<=1;u++){const m=Te(c+u,0,i+f,n);if((m&7)>4)continue;const p=s-(u+.5+((m&255)/255-.5)),x=d-(f+.5+((m>>>8&255)/255-.5)),S=m>>>24&3,M=S===0?1:S===2?0:S===1?.7071067811865476:-.7071067811865476,F=S===0?0:S===2?1:.7071067811865476,A=M*p+F*x,v=-F*p+M*x,g=.1+.3*(m>>>16&15)/15,b=.1+.3*(m>>>20&15)/15,y=1/(g*g),k=1/(b*b),R=A*A*y+v*v*k;if(R>=1)continue;const z=1-R,G=.6+1.8*(m>>>28)/15,C=-4*G*z;r+=G*z*z,e+=C*(M*A*y-F*v*k),l+=C*(F*A*y+M*v*k)}const h=Math.exp(-r);a[0]=1-h,a[1]=e*h,a[2]=0,a[3]=l*h}function ot(o,t,n,a,c,i,s){i.fill(0);const d=a>>>29&3;for(let r=0;r<de.length;r++){const e=de[r],l=Re(e.wavelength*e.aspect*e.filterWidth,c);if(i[4]+=(e.amplitude/e.wavelength)**2*(1+1/e.aspect**2)*e.variance*(1-l*l),l<=0)continue;let h=e.c,f=e.s;d===1?(h=-e.s,f=e.c):d===2?(h=-e.c,f=-e.s):d===3&&(h=e.s,f=-e.c);const u=h*o+f*n,m=-f*o+h*n,p=e.wavelength;if(r===2){at(u/p,m/(p*e.aspect),a+Math.imul(r+1,1821285621)>>>0,s);const C=e.amplitude*l,w=s[1]/p,T=s[3]/(p*e.aspect);i[0]+=(s[0]-.1)*C,i[1]+=(h*w-f*T)*C,i[3]+=(f*w+h*T)*C;continue}tt((.36*u-.8*t+.48*m)/p+17.137+r*9.173,(.48*u+.6*t+.64*m)/(p*e.aspect)+3.731-r*5.731,(-.8*u+.6*m)/p-11.517+r*7.337,a+Math.imul(r+1,1821285621)>>>0,s);const x=s[0],S=1/Math.sqrt(1+x*x),M=.72*x*S;let F=M,A=1;if(r===0){const C=Math.sqrt(M*M+.02);F=.3-C,A=-M/C}else if(r===1){const C=2**(-32*M*M);F=.4-C,A=64*Math.LN2*M*C}const v=e.amplitude*l,g=v*A*.72*S**3/p,b=s[1],y=s[2]/e.aspect,k=s[3],R=.36*b+.48*y-.8*k,z=-.8*b+.6*y,G=.48*b+.64*y+.6*k;i[0]+=F*v,i[1]+=(h*R-f*G)*g,i[2]+=z*g,i[3]+=(f*R+h*G)*g}}function nt(o,t,n,a){const c=n-.0065*Math.max(o,0),i=B(250,1400,a),s=(1-B(-5,1,c))*(1-B(.55,1.3,t)),d=1-s,r=B(.25,.9,t)*d,e=B(-8,4,c)*(1-B(28,42,c)),l=i*e*(d-r),h=d-r-l;return B(.025,.18,t)*B(0,2,o)*(r+.16*h+.045*l+.018*s)}function vt(o,t){const n=t.seed>>>0,a=t.climate??[14,900],c=t.macroSampler??o,i=c===o,s=Math.max(.125,Math.min(2,Math.max(0,t.sourceCell??20)*.025)),d=new Float64Array(5),r=new Float64Array(4);let e=NaN,l=!0;return(h,f,u=0)=>{const m=o(h,f,0);if(m<=0)return m;const p=Math.max(0,u);if(p!==e&&(e=p,l=de.some(A=>Re(A.wavelength*A.aspect*A.filterWidth,p)>0)),!l)return m;const x=i?m:c(h,f,0),S=(c(h+s,f,0)-c(h-s,f,0))/(2*s),M=(c(h,f+s,0)-c(h,f-s,0))/(2*s),F=nt(x,Math.hypot(S,M),a[0],a[1]);return F<=0?m:(ot(h,0,f,n,Math.max(0,u),d,r),m+d[0]*F)}}const rt=o=>Number.isInteger(o)?`${o}.`:String(o),P=o=>de.map(t=>rt(t[o])).join(","),mt=`
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
`,pt=`
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
`;export{mt as G,ft as T,vt as a,ut as b,ht as c,Qe as d,pt as e,lt as f,Je as h,dt as p,ct as r};
