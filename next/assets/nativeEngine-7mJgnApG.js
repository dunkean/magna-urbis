import{C as a,n as i}from"./occupation.worker-B0QxwL1R.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const l={desert:1,savanna:.72,steppe:.5,mediterranean:.15},c=e=>(Math.round(e*1e3)/1e3).toFixed(3),p=e=>`float[${a.length}](${a.map(n=>c(e[n]??0)).join(",")})`;`${a.length}${p(l)}`,a.length-1;async function f(e,n,r){const t=await i(e,n,{method:"POST",headers:{"Content-Type":r instanceof Blob?"application/octet-stream":"application/json"},body:r});if(!t.ok){const o=await t.text();try{throw new Error(JSON.parse(o).error??o)}catch(s){throw s instanceof SyntaxError?new Error(o||`Moteur local : HTTP ${t.status}`):s}}return t}export{f as nativeRequest};
