/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const c="architectural-plans-2",u={"architectural-plans-1":"houses-2",[c]:"houses-3"},o=e=>!!e&&(Object.keys(e.massing??{}).length>0||[e.city,...Object.values(e.zones??{}),...Object.values(e.quarters??{}),...Object.values(e.blocks??{}),...Object.values(e.parcels??{}),...Object.values(e.buildings??{})].some(r=>r?.styles.some(t=>t.weight>0&&t.culture))),a=e=>o(e?.houses)?JSON.stringify({...e.culture?{culture:e.culture}:{},houses:e.houses}):e?.culture;function l(e){if(new TextEncoder().encode(e).byteLength>64*1024*1024)throw new Error("Architecture response exceeds 64 MiB.");const r=JSON.parse(e);if(!r||typeof r.ok!="boolean")throw new Error("Invalid architecture response.");if(!r.ok)throw new Error(`[${r.error?.code??"architecture_error"}] ${r.error?.message??"Architecture failed."}`);return r.data}export{c as ARCHITECTURE_PLAN_GENERATOR,u as ARCHITECTURE_PLAN_HOUSE_GENERATORS,a as architectureProfile,o as hasHouseMix,l as parseArchitectureResult};
