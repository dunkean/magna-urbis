/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function j(M,t,o,r,a=1){const s=[{data:M,width:t,height:o}];for(;t>1||o>1;){const e=Math.max(1,t>>1),n=Math.max(1,o>>1),u=s[s.length-1].data,l=new Uint8Array(e*n*r*a);for(let f=0;f<a;f++)for(let p=0;p<n;p++){const c=(f*o+Math.min(o-1,2*p))*t,b=(f*o+Math.min(o-1,2*p+1))*t;for(let m=0;m<e;m++){const v=Math.min(t-1,2*m),$=Math.min(t-1,2*m+1),y=(c+v)*r,i=(c+$)*r,A=(b+v)*r,U=(b+$)*r,W=((f*n+p)*e+m)*r;for(let x=0;x<r;x++)l[W+x]=u[y+x]+u[i+x]+u[A+x]+u[U+x]+2>>2}}s.push({data:l,width:e,height:n}),t=e,o=n}return s}const k=new WeakMap;function q(M,t,o,r){let a=k.get(M);a||(a=new Map,k.set(M,a));const s=`${t}x${o}x${r}`;let e=a.get(s);return e||(e=j(M,t,o,r).map(n=>n.data),a.set(s,e)),e}export{j as b,q as r};
