import{C as e,n as l}from"./occupation.worker-Cmdv42e3.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const c={desert:1,savanna:.72,steppe:.5,mediterranean:.3},w={tropical:1,savanna:1,wetland:.7,temperate:.45,continental:.45,mediterranean:.35,steppe:.3,nordic:.2,alpine:.25,arctic:.1,desert:.1},T=t=>(Math.round(t*1e3)/1e3).toFixed(3),n=t=>`float[${e.length}](${e.map(r=>T(t[r]??0)).join(",")})`,p={nordic:.65,wetland:.55,continental:.3,arctic:.25},A={alpine:1,arctic:.2};`${e.length}${n(c)}${e.length}${n(p)}${e.length}${n(A)}${e.length}${n(w)}`,e.length-1;async function f(t,r,i){const a=await l(t,r,{method:"POST",headers:{"Content-Type":i instanceof Blob?"application/octet-stream":"application/json"},body:i});if(!a.ok){const o=await a.text();try{throw new Error(JSON.parse(o).error??o)}catch(s){throw s instanceof SyntaxError?new Error(o||`Moteur local : HTTP ${a.status}`):s}}return a}export{f as nativeRequest};
