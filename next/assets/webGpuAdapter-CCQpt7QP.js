/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const a=15e3;async function s(u=2500){const r=globalThis.navigator?.gpu;if(!r)return null;let t;const n=async()=>{try{const e=await r.requestAdapter({powerPreference:"high-performance"});if(e)return e}catch{}return r.requestAdapter()};try{return await Promise.race([n(),new Promise(e=>{t=setTimeout(()=>e(null),u)})])}finally{clearTimeout(t)}}async function o(u,r){let t=!0,n;const e=u.requestDevice(r).then(i=>(t||i.destroy(),i));try{return await Promise.race([e,new Promise(i=>{n=setTimeout(()=>i(null),2500)})])}finally{t=!1,clearTimeout(n)}}export{a as PATIENT_GPU_MS,s as requestWebGpuAdapter,o as requestWebGpuDevice};
