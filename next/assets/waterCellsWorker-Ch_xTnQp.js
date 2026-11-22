/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const r=new Map;let m=0;const u=new OffscreenCanvas(1,1),p=new OffscreenCanvas(1,1),c=u.getContext("2d",{willReadFrequently:!0}),h=p.getContext("2d",{willReadFrequently:!0});self.onmessage=({data:e})=>{if(e.bitmap){for(r.set(e.sourceId,e.bitmap),m+=e.bitmap.width*e.bitmap.height*4;m>64*1024*1024&&r.size>1;){const[t,n]=r.entries().next().value;r.delete(t),m-=n.width*n.height*4,n.close()}return}try{const t=r.get(e.sourceId);if(!t)throw new Error("Source evicted");r.delete(e.sourceId),r.set(e.sourceId,t);const{sx:n,sy:S,sw:i,size:o}=e,g=o/i,x=Math.min(4,g),a=2,l=Math.ceil((i+2*a)*x);u.width=u.height=l,c.imageSmoothingEnabled=!0,c.filter=`blur(${(x*.5).toFixed(2)}px)`,c.drawImage(t,n-a,S-a,i+2*a,i+2*a,0,0,l,l),c.filter="none";const M=c.getImageData(0,0,l,l).data;let b=!1;for(let s=3;s<M.length;s+=4)if(M[s]){b=!0;break}const I=new OffscreenCanvas(o,o),E=I.getContext("2d");if(b){const s=Math.round((i+2*a)*g),C=Math.round(a*g);p.width=p.height=s,h.imageSmoothingEnabled=!0,h.imageSmoothingQuality="high",h.drawImage(u,0,0,s,s);const v=h.getImageData(C,C,o,o),f=v.data,q=Math.max(1,g*1.25);for(let d=3;d<f.length;d+=4){const w=f[d];w!==0&&w!==255&&(f[d]=Math.max(0,Math.min(255,Math.round((w-102)*q+128))))}E.putImageData(v,0,0)}const y=I.transferToImageBitmap();self.postMessage({id:e.id,image:y},{transfer:[y]})}catch(t){self.postMessage({id:e.id,error:String(t instanceof Error?t.message:t)})}};
