/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function o(r,t){return new Promise(e=>{r.addEventListener("message",function s({data:n}){n?.type===t&&(r.removeEventListener("message",s),e(n))})})}o(self,"wasm_bindgen_worker_init").then(async({init:r,receiver:t})=>{const e=await import("./magna_urbis_wasm-D3AdcLXF.js");await e.default(r),postMessage({type:"wasm_bindgen_worker_ready"}),e.wbg_rayon_start_worker(t)});async function a(r,t,e){if(e.numThreads()===0)throw new Error("num_threads must be > 0.");const s={type:"wasm_bindgen_worker_init",init:{module_or_path:r,memory:t},receiver:e.receiver()};await Promise.all(Array.from({length:e.numThreads()},async()=>{const n=new Worker(self.location.href,{type:"module"});return n.postMessage(s),await o(n,"wasm_bindgen_worker_ready"),n})),e.build()}export{a as s};
