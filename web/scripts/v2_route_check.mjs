import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='out/v2-editing',fixture=JSON.parse(await readFile(`${out}/fixture.json`,'utf8'));
const n=64,count=n*n,water=new Uint8Array(count),height=new Float32Array(count).fill(10);
for(let y=0;y<n;y++)if(y<18||y>28)for(let x=29;x<=34;x++){water[y*n+x]=1;height[y*n+x]=-10;}
const tagged=(name,values)=>({$mu:name,data:Array.from(values)});
const grid=values=>({w:n,h:n,cell:100,data:tagged('Float32Array',values)});
fixture.settings.extent=6400;fixture.settings.options.mapSize=6400;
fixture.settings.region={resolution:64,roads:{wobble:0,gradeWeight:1,crossingCost:2}};
fixture.world.mapSize=6400;fixture.world.options.mapSize=6400;
fixture.world.terrain={...fixture.world.terrain,height:grid(height),slope:grid(new Float32Array(count).fill(.1)),flow:grid(new Float32Array(count).fill(1)),
 water:tagged('Uint8Array',water),filled:tagged('Float32Array',height),receiver:tagged('Int32Array',new Int32Array(count).fill(-1)),rivers:[],lakes:[],coastline:[]};
delete fixture.world.roads;delete fixture.world.settlements;delete fixture.world.urban;fixture.world.names.entries=[];
await writeFile(`${out}/route-fixture.json`,JSON.stringify(fixture));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5174/v2.html?lang=fr');await page.locator('#import-open').click();
 await page.locator('#project-file').setInputFiles(`${out}/route-fixture.json`);
 await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false'&&document.querySelector('#map-name').textContent==='Editor fixture');
 await page.locator('[data-network-quick=draw]').click();
 const map=await page.locator('#map').boundingBox(),scale=(Math.min(map.width,map.height)-24)/6400;
 const point=(x,y)=>({x:map.x+map.width/2+(x-3200)*scale,y:map.y+map.height/2+(y-3200)*scale});
 for(const p of [point(1000,1300),point(5400,1300)])await page.mouse.click(p.x,p.y);
 await page.waitForFunction(()=>document.querySelectorAll('.v2-network-overlay:not([hidden]) [data-role=vertex]').length>2,null,{timeout:90000});
 await page.screenshot({path:`${out}/automatic-route.png`});await page.keyboard.press('Escape');
 await page.locator('#export-open').click();await page.locator('#export-format').selectOption('project');
 const downloading=page.waitForEvent('download');await page.locator('#export-go').click();const file=await downloading;
 const saved=JSON.parse(await readFile(await file.path(),'utf8')),path=saved.world.roads[0].path;
 await writeFile(`${out}/automatic-route.project.json`,JSON.stringify(saved));console.log('Route endpoints:',path[0],path.at(-1));
 assert(path.length>2);assert(Math.max(...path.map(p=>p.y))>1700);assert(Math.abs(path[0].x-1000)<2/scale);assert(Math.abs(path.at(-1).x-5400)<2/scale);
 assert.deepEqual(errors,[]);console.log('Automatic two-click UI route detoured around water:',path.length,'points');
}catch(error){await page.screenshot({path:`${out}/route-failure.png`}).catch(()=>{});console.error(errors);throw error;}finally{await browser.close();}
