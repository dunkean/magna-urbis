import {describe,expect,it} from 'vitest';
import {generateUrbanLanduse,type UrbanLanduseInput} from '../src/ui/urbanLanduseData';
import {mpArea,intersectionS} from '../src/gen/geo/bool';
import {offsetRibbon} from '../src/gen/core/geom';
function fixture(population:number,mountain=false):UrbanLanduseInput {
 const n=160,width=6000,size=n*n,height=new Float32Array(size).fill(80),water=new Uint8Array(size);
 if(mountain)for(let y=0;y<n;y++)for(let x=0;x<n;x++)height[y*n+x]=150+30*Math.sin((x+.5)*width/n/170)*Math.sin((y+.5)*width/n/190);
 const city={key:'city',center:{x:3000,y:3000},radius:100,population,culture:'european-organic'};
 const rgba=new Uint8Array(64*64*4);
 return {seed:'population-pressure',biome:'temperate',relief:mountain?'mountains':'flat',raster:{n,width,height,water,waterLevel:height.slice(),riverWidth:new Float32Array(size),riverIds:new Int32Array(size).fill(-1)},city,neighbours:[],
 layouts:[{key:'city',center:city.center,culture:city.culture,blocks:[],warnings:[],streets:[{role:'regional',rank:1,widths:[4,4],path:[{x:200,y:3000},{x:5800,y:3000}]}],quarters:[{phase:0,shape:{outer:[{x:2900,y:2900},{x:3100,y:2900},{x:3100,y:3100},{x:2900,y:3100}],holes:[]}}]}],
 forest:{field:{x:0,y:0,width,n:64,rgba,key:'none'},settings:{enabled:true,density:0,clearings:.45}}};
}
const crops=(input:UrbanLanduseInput)=>{const scene=generateUrbanLanduse(input);return{scene,plots:scene.landuse!.areas.filter(a=>['field','garden','orchard'].includes(a.kind)).map(a=>({outer:a.poly,holes:a.holes??[]}))};};
describe('population and agricultural territory',()=>{
 it('lets a large city cultivate most accessible land while keeping a modest hamlet territory',()=>{
  const small=crops(fixture(80)),large=crops(fixture(80000));
  const low=mpArea(small.plots),high=mpArea(large.plots);
  expect(low).toBeGreaterThan(10000);expect(high).toBeGreaterThan(low*8);expect(high/(6000*6000)).toBeGreaterThan(.4);
  const ways=large.scene.landuse!.ways??[];
  for(const way of ways)expect(mpArea(intersectionS(large.plots,offsetRibbon(way,3.5)))).toBeLessThan(.02);
  expect(ways.length/large.plots.length).toBeLessThan(.1);
 });
 it('retains cultivated pockets around a mountain hamlet, with less area than on the plain',()=>{
  const plain=crops(fixture(80)),mountain=crops(fixture(80,true));
  expect(mpArea(mountain.plots)).toBeGreaterThan(1000);expect(mpArea(mountain.plots)).toBeLessThan(mpArea(plain.plots));
 });
});
