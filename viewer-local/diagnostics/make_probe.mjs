// An explicitly synthetic adapter test. This is NOT the real-terrain acceptance scene.
import {mkdirSync,writeFileSync} from 'node:fs';
const n=33, span=40000, spacing=span/(n-1), heights=[];
const fields={material:[],treeCover:[],grassCover:[],wetness:[],snow:[],bedrock:[],waterClass:[],waterLevelM:[],moisture:[],depositOrigin:[],sand:[],silt:[],clay:[]};
for(let z=0;z<n;z++)for(let x=0;x<n;x++){
 const wx=x*spacing,wz=z*spacing;
 const h=120+350*Math.sin(wx/6000)*Math.sin(wz/8000)+0.002*wx;
 heights.push(h);const water=x<3;
 const id=x<12?0:x<20?1:2;
 fields.material.push(id);fields.treeCover.push(id===2?0.65:0);fields.grassCover.push(id===1?0.8:0);
 fields.wetness.push(water?0.7:0.2);fields.snow.push(0);fields.bedrock.push(x<16?1:2);
 fields.waterClass.push(water?2:0);fields.waterLevelM.push(water?165:null);fields.moisture.push(x/n);fields.depositOrigin.push(id);fields.sand.push(0.5);fields.silt.push(0.3);fields.clay.push(0.2);
}
const materials=[{family:'bedrock',colorLinear:[0.31,0.29,0.25]},{family:'mineral-plains',colorLinear:[0.25,0.28,0.12]},{family:'vegetation',colorLinear:[0.18,0.23,0.08]}].map((m,i)=>({...m,id:`probe-${i}`,roughness:0.85,physicalExtentMetres:4}));
let state=177;const random=()=>{state=Math.imul(state,1664525)+1013904223|0;return(state>>>0)/4294967296;};
const candidates=Array.from({length:100000},(_,i)=>{const x=random()*span,z=random()*span;return{stableId:`synthetic-probe-${i}`,family:i%5===0?'boulder':i%3===0?'grass':'tree',x,y:120+350*Math.sin(x/6000)*Math.sin(z/8000)+0.002*x,z,size:2+random()*12,orientation:random()*6.28,rank:random()};});
const world={schemaVersion:1,id:'SYNTHETIC-ADAPTER-PROBE',units:'metres',crs:'local-xz',seed:177,bounds:{minX:0,minZ:0,maxX:span,maxZ:span},terrain:{width:n,height:n,originX:0,originZ:0,spacingM:spacing,heights,source:{id:'synthetic-adapter-probe-NOT-infinite-generation',version:'1',sourceLOD:0,nativeSpacingM:spacing}},fields,materials,diagnostics:{warnings:['Synthetic diagnostic fixture; not a real-terrain acceptance test.']}};
const path=process.argv[2]??new URL('../captures/probe.json',import.meta.url);
mkdirSync(new URL('../captures/',import.meta.url),{recursive:true});
writeFileSync(path,JSON.stringify({world,candidates}));
console.log(`Wrote explicit synthetic probe: ${path}`);
