/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/async function i(t,n,s=(e,a)=>new OffscreenCanvas(e,a)){let e;try{const a=t.height??t.width;e=s(t.width,a);const c=e.getContext("2d");if(!c)throw new Error("no PNG canvas context");return n("raster"),c.drawImage(t.bitmap,0,0,t.width,a),n("encode"),await e.convertToBlob({type:"image/png"})}finally{t.bitmap.close(),e&&(e.width=0,e.height=0)}}const r=self,o=t=>r.postMessage(t);try{const t=new OffscreenCanvas(1,1);o({type:"ready",ok:!!t.getContext("2d")&&typeof t.convertToBlob=="function"})}catch{o({type:"ready",ok:!1})}r.onmessage=async t=>{try{o({type:"done",blob:await i(t.data,n=>o({type:"progress",phase:n}))})}catch(n){o({type:"done",error:String(n.message??n)})}};
