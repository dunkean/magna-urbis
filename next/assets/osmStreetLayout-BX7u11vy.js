import{r as n}from"./rustUrban-Ce_0dqb9.js";import"./nativeEngine-jTBH9YXV.js";import"./roadRoute.worker-CGyFZvF4.js";import"./runtimeChoices-DzKY7bOl.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/function c(r,t){const e=Math.max(1,Math.round(t/3.5));return{version:1,population:t,context:n(),cultures:[],demands:[{id:`${r}/demand/domestic`,function:"domestic",unit:"domesticUnits",requested:e,targetArea:e*70,targetFrontage:4,provenance:["OpenStreetMap frontage"],requires:[],parcelCapacity:0,builtCapacity:0,deficit:e,reasons:[]}],reservations:[],allocations:[],adjacency:[],environment:[],reconciliationPasses:0,warnings:[]}}export{c as osmHousingProgramme};
