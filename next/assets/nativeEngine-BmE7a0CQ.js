import{C as n,n as c}from"./occupation.worker-E25ftXPh.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const l=e=>[(1-e)**3/6,(3*e**3-6*e*e+4)/6,(-3*e**3+3*e*e+3*e+1)/6,e**3/6],w=e=>[-.5*(1-e)**2,1.5*e*e-2*e,-1.5*e*e+e+.5,.5*e*e],o=8;Array.from({length:o+1},(e,a)=>l(a/o));Array.from({length:o+1},(e,a)=>w(a/o));const h={desert:1,savanna:.72,steppe:.5,mediterranean:.15},p=e=>(Math.round(e*1e3)/1e3).toFixed(3),f=e=>`float[${n.length}](${n.map(a=>p(e[a]??0)).join(",")})`;`${n.length}${f(h)}`,n.length-1;async function u(e,a,s){const r=await c(e,a,{method:"POST",headers:{"Content-Type":s instanceof Blob?"application/octet-stream":"application/json"},body:s});if(!r.ok){const t=await r.text();try{throw new Error(JSON.parse(t).error??t)}catch(i){throw i instanceof SyntaxError?new Error(t||`Moteur local : HTTP ${r.status}`):i}}return r}export{u as nativeRequest};
