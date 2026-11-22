import{aS as y}from"./engine.worker-DFZxfQse.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function p(o,e,t){const i=Math.min(1,o/1.5)*(1-e)*(t/4);return Math.max(-1,Math.min(1,2.8*i-1))}function b(o){const e="bytes"in o?o:y(o),{nx:t,ny:i,cell:h,x0:m,y0:M}=e,n=new Float32Array(t*i);for(let a=0;a<n.length;a++)n[a]=p(e.value("soil_depth",a),e.value("stoniness",a),e.value("drainage",a));return Object.assign((a,g)=>{const c=Math.max(0,Math.min(t-1,(a-m)/h-.5)),d=Math.max(0,Math.min(i-1,(g-M)/h-.5)),r=Math.floor(c),l=Math.floor(d),u=Math.min(t-1,r+1),f=Math.min(i-1,l+1),s=c-r,x=d-l;return(n[l*t+r]*(1-s)+n[l*t+u]*s)*(1-x)+(n[f*t+r]*(1-s)+n[f*t+u]*s)*x},{landuseGrid:{w:t,h:i,cell:h,x0:m,y0:M,data:n}})}export{p as fertilityAt,b as ruralSoilField};
