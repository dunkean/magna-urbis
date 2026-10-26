import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { generateUrbanLanduse, type UrbanLanduseInput } from '../src/ui/urbanLanduseData';
import { landuseLayer } from '../src/render/landuse';
import { biomePalette } from '../src/render/biomes';
const dir='out/landuse-review'; mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1400,height:1400}});
const metrics:unknown[]=[];
for(const [width,population] of [[2400,300],[12000,30000],[40000,200000]]) {
 const n=256, height=new Float32Array(n*n),water=new Uint8Array(n*n),riverWidth=new Float32Array(n*n),riverIds=new Int32Array(n*n).fill(-1);
 for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
  const i=y*n+x,wx=(x+.5)*width/n,wy=(y+.5)*width/n;
  height[i]=35+18*Math.sin(wx/650)*Math.cos(wy/800)+Math.max(0,wx-width*.66)*.9;
  if(Math.abs(wx-width*.16-40*Math.sin(wy/450))<width/n*.7) {water[i]=3;riverWidth[i]=12;riverIds[i]=0;}
 }
 const center={x:width*.47,y:width*.5}, radius=Math.min(850,100+Math.sqrt(population)*1.2);
 const square=[{x:center.x-radius,y:center.y-radius},{x:center.x+radius,y:center.y-radius},{x:center.x+radius,y:center.y+radius},{x:center.x-radius,y:center.y+radius}];
 const input:UrbanLanduseInput={seed:'landuse-review-42',biome:'temperate',relief:'hills',raster:{n,width,height,water,waterLevel:height.slice(),riverWidth,riverIds},
  city:{key:'city',center,radius,population,culture:'european-organic'},neighbours:[],layouts:[{key:'city',center,culture:'european-organic',warnings:[],blocks:[],quarters:[{shape:{outer:square,holes:[]},phase:0}],
   streets:[{role:'regional',rank:1,widths:[5,5],path:[{x:width*.2,y:center.y},{x:width*.65,y:center.y}]}]}]};
 const scene=generateUrbanLanduse(input); metrics.push({width,population,stats:scene.stats,kinds:Object.fromEntries(['forest','field','orchard','garden','pasture'].map(k=>[k,scene.landuse!.areas.filter(a=>a.kind===k).length]))});
 for(const style of ['parchment','atlas','cadastre'] as const) {
  const pal=biomePalette(style,'temperate');
  const view=width>2400?{x:center.x-1900,y:center.y-1900,w:3800}:{x:0,y:0,w:width};
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1400" height="1400" viewBox="${view.x} ${view.y} ${view.w} ${view.w}"><rect x="0" y="0" width="${width}" height="${width}" fill="${pal.paper}"/>${landuseLayer(scene,pal,1,1400/view.w,undefined,'','classic')}<path d="M${width*.2} ${center.y}H${width*.65}" fill="none" stroke="${pal.ink}" stroke-width="3"/><path d="${square.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join('')}Z" fill="${pal.paper}" stroke="${pal.ink}" stroke-width="2"/></svg>`;
  writeFileSync(`${dir}/${width}-${style}.svg`,svg);writeFileSync(`${dir}/${width}-${style}.png`,await (async()=>{await page.setContent('<html><body style="margin:0">'+svg+'</body></html>');return page.screenshot();})());
 }
}
writeFileSync(`${dir}/metrics.json`,JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics,null,2));

await browser.close();
