import{C as e}from"./occupation.worker-DRpJe6_V.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const s={desert:1,savanna:.72,steppe:.5,mediterranean:.3},c={tropical:1,savanna:1,wetland:.7,temperate:.45,continental:.45,mediterranean:.35,steppe:.3,nordic:.2,alpine:.25,arctic:.1,desert:.1},w=t=>(Math.round(t*1e3)/1e3).toFixed(3),r=t=>`float[${e.length}](${e.map(n=>w(t[n]??0)).join(",")})`,p={nordic:.65,wetland:.55,continental:.3,arctic:.25},T={alpine:1,arctic:.2};`${e.length}${r(s)}${e.length}${r(p)}${e.length}${r(T)}${e.length}${r(c)}`,e.length-1;async function f(t,n,l){let a;try{a=await fetch(`${t.server.replace(/\/$/,"")}${n}`,{method:"POST",headers:{"Content-Type":l instanceof Blob?"application/octet-stream":"application/json"},body:l})}catch{throw new Error(`Moteur Rust local inaccessible (${t.server}). Lancez le profil local ou l’application de bureau.`)}if(!a.ok){const o=await a.text();try{throw new Error(JSON.parse(o).error??o)}catch(i){throw i instanceof SyntaxError?new Error(o||`Moteur local : HTTP ${a.status}`):i}}return a}export{f as nativeRequest};
