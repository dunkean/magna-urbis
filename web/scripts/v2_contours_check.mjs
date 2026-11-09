import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='out/v2-editing',fixture=JSON.parse(await readFile(`${out}/town-fixture.json`,'utf8'));
const grid=fixture.world.terrain.height;
for(let y=0;y<grid.h;y++)for(let x=0;x<grid.w;x++)grid.data.data[y*grid.w+x]=x*10+y*5;
fixture.world.terrain.slope.data.data.fill(.1);fixture.world.terrain.filled.data=[...grid.data.data];
await writeFile(`${out}/contour-fixture.json`,JSON.stringify(fixture));
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5174/v2.html?lang=fr');await page.locator('#import-open').click();await page.locator('#project-file').setInputFiles(`${out}/contour-fixture.json`);
 await page.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false'&&document.querySelector('#map-name').textContent==='Editor fixture');
 await page.locator('#map-style').selectOption('topographic');await page.waitForTimeout(1500);await page.screenshot({path:`${out}/topographic-contours.png`});
 await page.locator('#export-open').click();await page.locator('#export-format').selectOption('svg');await page.locator('#export-style').selectOption('topographic');await page.locator('#export-crop').uncheck();
 const downloading=page.waitForEvent('download',{timeout:45000});await page.locator('#export-go').click();const file=await downloading;
 const svg=await readFile(await file.path(),'utf8');await writeFile(`${out}/topographic-contours.svg`,svg);
 const contours=svg.match(/id="terrain-contour-ground"[^>]*>([\s\S]*?)<\/g>/)?.[1];
 if(svg.includes('data-rendering="embedded-raster"')){
   const png=svg.match(/href="(data:image\/png;base64,[^"]+)"/)?.[1];assert(png);
   const pixels=await page.evaluate(async src=>{const image=new Image();image.src=src;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(200,200,2000,400).data;let brown=0;for(let i=0;i<data.length;i+=4)if(data[i]>data[i+1]*1.05&&data[i+1]>data[i+2]*1.05&&data[i+2]<210)brown++;return brown;},png);
   assert(pixels>20,`No visible contour strokes in export: ${pixels}`);
 }else{assert(contours?.includes('<path '));assert(!svg.includes('id="terrain-ground"'));assert(!svg.includes('class="layer-landuse"'));assert(svg.includes('layer-field-outlines'));}
 assert.deepEqual(errors,[]);
 console.log('Topographic contours, flat ground, field outlines and SVG export passed');
}catch(error){await page.screenshot({path:`${out}/contour-failure.png`}).catch(()=>{});console.error(errors);throw error;}finally{await browser.close();}
