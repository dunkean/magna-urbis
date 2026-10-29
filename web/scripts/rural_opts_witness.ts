// Local SVG witnesses; does not contact or rebuild the shared native engine.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { generateUrbanLanduse, urbanLanduseRenderWorld, type UrbanLanduseInput } from '../src/ui/urbanLanduseData';
import { landuseLayer, roadsLayer } from '../src/render/landuse';
import type { RuralRenderLayer } from '../src/render/ruralDetails';
import { gardenDetails } from '../src/render/readableGardens';
import { layoutFarm, placeFarm, frameOf, type FarmContext } from '../src/gen/landuse/farms';
import { Rng } from '../src/gen/core/rng';
import { PALETTES } from '../src/render/styles';
import { pathD } from '../src/render/util';
import { encodeSituation } from '../src/ui/citySituation';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';

const out=resolve('out/rural-opts'); mkdirSync(out,{recursive:true});
const n=96,width=2400,height=new Float32Array(n*n).fill(24),water=new Uint8Array(n*n),waterLevel=height.slice();
const box=(x:number,y:number,w:number,h=w)=>({outer:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],holes:[]});
const input:UrbanLanduseInput={raster:{n,width,height,water,waterLevel,riverWidth:new Float32Array(n*n),riverIds:new Int32Array(n*n).fill(-1)},seed:'42',biome:'temperate',relief:'flat',
  city:{key:'city',center:{x:1150,y:1150},population:3000,culture:'hanseatic',radius:380,profile:{role:'agricultural',resources:['grain'],mode:'inspired',period:'',lore:[],navigableAccess:false}},neighbours:[],
  layouts:[{key:'city',center:{x:1150,y:1150},culture:'hanseatic',warnings:[],blocks:[],streets:[{path:Array.from({length:41},(_,i)=>({x:150+i*50,y:1150})),widths:Array(41).fill(4),rank:1,role:'regional'}],quarters:[{shape:box(1000,1000,350,550),phase:0},{shape:box(1350,1250,450,300),phase:0}]}]};
const pal=PALETTES.parchment, report:Record<string,unknown>={};
const save=(name:string,body:string,viewBox:string,w=1100)=>{
  const size=viewBox.split(' ').map(Number);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}" width="${w}" height="${w*size[3]/size[2]}"><rect x="-1000" y="-1000" width="5000" height="5000" fill="#e8dfb5"/>${body}</svg>`;
  writeFileSync(resolve(out,name+'.svg'),svg);writeFileSync(resolve(out,name+'.png'),new Resvg(svg).render().asPng());
};
for(const on of [false,true]){
  input.ruralOptions={streetAlignedHomes:on,denserSmallholdings:on};
  const scene=generateUrbanLanduse(input),world=urbanLanduseRenderWorld(scene,input.raster);
  if(on)(world.landuse as RuralRenderLayer).ruralDetails={visiblePaddocks:true,concreteFieldBoundaries:true};
  const city=input.layouts![0].quarters.map(q=>`<path d="${pathD(q.shape.outer,true)}" fill="#d3b994" stroke="#827250"/>`).join('');
  save(`countryside-${on?'on':'off'}`,landuseLayer(world,pal,1)+city+roadsLayer(world,pal,1),'0 0 2400 2400');
  report[on?'on':'off']={farms:world.landuse!.farmsteads.length,cottages:world.landuse!.farmsteads.filter(f=>f.size==='cottage').length};
}
const ctx:FarmContext={culture:'hanseatic',soil:.5,slope:0,downhill:null,wet:.7,exposed:0,market:.1,west:0};
const lf=layoutFarm('vierkanthof','family',ctx,frameOf({x:0,y:1},null),new Rng('paddock'));
const p=placeFarm(lf,lf.type,{x:65,y:0},{x:0,y:1});
const farm={pos:{x:65,y:35},angle:p.angle,buildings:p.parts.map(p=>p.poly),yard:p.yard,drive:[p.gate,p.entry],lot:p.lot,parts:p.parts,plots:p.plots,walls:p.walls,entry:p.entry,gate:p.gate};
const garden=box(0,10,24,32),gd=gardenDetails(garden,{x:12,y:4});
for(const on of [false,true]){
  const lu:RuralRenderLayer={areas:[],farmsteads:[farm],reserve:[],ruralDetails:on?{visiblePaddocks:true}:undefined};
  const fw={...urbanLanduseRenderWorld(generateUrbanLanduse(input),input.raster),landuse:lu};
  let body=`<path d="${pathD(garden.outer,true)}" fill="#b7bd8a"${on?'':' stroke="#69664b"'}/>`;
  if(on) body+=`<path d="${gd.beds.map(p=>pathD(p,true)).join('')}" fill="#7c9259" stroke="#68694b" stroke-width=".15"/><clipPath id="g"><path d="${pathD(garden.outer,true)}"/></clipPath><path d="${gd.paths.map(p=>pathD(p,false)).join('')}" clip-path="url(#g)" stroke="#e4d6af" stroke-width="1.1"/><path d="${gd.fences.map(p=>pathD(p,false)).join('')}" stroke="#69664b" stroke-width=".4" fill="none"/><path d="M12,4L${gd.entry.x},${gd.entry.y}" stroke="#e4d6af" stroke-width="1.1"/>`;
  else body+=Array.from({length:10},(_,i)=>`<path d="M0,${12+i*3}h24" stroke="#9eaa75" stroke-width=".4"/>`).join('');
  body+='<path d="M7,0h10v7H7Z" fill="#8c7051"/>'+roadsLayer(fw,pal,1);
  save(`details-${on?'on':'off'}`,body,'-4 -4 125 100',1100);
}
const q=new URLSearchParams({urban:JSON.stringify({layoutConfig:defaultLayoutConfig(),parcelConfig:{...defaultParcelConfig(),streetAlignedHomes:true,denserSmallholdings:true},render:{readableGardens:true}}),landuse:JSON.stringify({enabled:true,visiblePaddocks:true,concreteFieldBoundaries:true})}).toString();
writeFileSync(resolve(out,'options-on.mu1.txt'),await encodeSituation({v:1,q,pins:[],note:'rural-opts: five options on'}));
writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));
