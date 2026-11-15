import{C as o,c as p,a as u,b as s}from"./__vite-browser-external-CTA_-NDR.js";import{F as l}from"./terrainFingerprint-BQnRFEZE.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function S(t){return l[new URLSearchParams(t.query).get("climate")??t.tags.climate??"temperate"]??"temperate"}function f(t){const a=new URLSearchParams(t.query),i=a.get("climate")??t.tags.climate??"temperate",c={...o[i]??o.temperate},r={temperature:"climTemperature",temperatureStd:"climTemperatureStd",precipitation:"climPrecipitation",precipitationCv:"climPrecipitationCv"};for(const e of Object.keys(r)){const m=a.get(e)??a.get(r[e]),n=Number(m);m!==null&&Number.isFinite(n)&&(c[e]=n)}return c}function C(t){const a=p(new URLSearchParams(t.query).get("climate")??t.tags.climate);if(a)return a;const i=f(t),c=r=>{const e=s[r];return Math.abs(e.temperature-i.temperature)/5+Math.abs(Math.log(e.precipitation/i.precipitation))+Math.abs(e.temperatureStd-i.temperatureStd)/300};return u.reduce((r,e)=>c(e)<c(r)?e:r)}export{S as decorBiome,f as decorClimate,C as decorClimateZone};
