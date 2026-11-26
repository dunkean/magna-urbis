import{j as i}from"./__vite-browser-external-CFdpXQj4.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const s=t=>t<1e3?20+9*Math.sqrt(t):20+9*Math.sqrt(1e3)*(t/1e3)**.4;function a(t){const e=i(t.culture).sitePrefs??{};return{...t,sitePrefs:{mountainFace:e.mountainFace??0,woodland:e.woodland??0,weights:{...e.weights},...t.sitePrefs}}}function c(t){return{...t,main:a(t.main),list:t.list.map(a)}}function m(t,e,r=.03){const n=s(t);return Math.min(.3,Math.max(r,Math.ceil((.45*n+20)/e*100)/100))}function o(t,e,r){return{cx:t.center.x,cy:t.center.y,scale:Math.min(e,r)/Math.max(200,2.4*t.radius)}}export{o as cityFocusView,c as cityPlacementRequest,s as extentRadius,m as framedEdgeMargin,a as withCulturePrefs};
