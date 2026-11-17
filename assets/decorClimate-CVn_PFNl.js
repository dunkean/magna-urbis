import{C as o,c as u,a as p,b as s}from"./terrainClimate-klihTHUU.js";import{R as l}from"./urbanNetwork-Did4xsDk.js";import"./vectorWaterRender-Cm78yzjJ.js";import"./platform-B7eSt7ng.js";import"./neuralModels-CV_wlH3O.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function L(e){const r=new URLSearchParams(e.query);return(r.get("biome")??e.tags.biome)==="underdark"?"underdark":l[r.get("climate")??e.tags.climate??"temperate"]??"temperate"}function d(e){const r=new URLSearchParams(e.query),i=r.get("climate")??e.tags.climate??"temperate",c={...o[i]??o.temperate},a={temperature:"climTemperature",temperatureStd:"climTemperatureStd",precipitation:"climPrecipitation",precipitationCv:"climPrecipitationCv"};for(const t of Object.keys(a)){const m=r.get(t)??r.get(a[t]),n=Number(m);m!==null&&Number.isFinite(n)&&(c[t]=n)}return c}function h(e){const r=u(new URLSearchParams(e.query).get("climate")??e.tags.climate);if(r)return r;const i=d(e),c=a=>{const t=s[a];return Math.abs(t.temperature-i.temperature)/5+Math.abs(Math.log(t.precipitation/i.precipitation))+Math.abs(t.temperatureStd-i.temperatureStd)/300};return p.reduce((a,t)=>c(t)<c(a)?t:a)}export{L as decorBiome,d as decorClimate,h as decorClimateZone};
