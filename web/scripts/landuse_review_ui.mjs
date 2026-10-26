import {chromium} from 'playwright';import{mkdirSync,writeFileSync}from'node:fs';
const moduleRoot='/@fs/'+process.cwd().replaceAll('\\','/')+'/src';
const origin=process.argv[2]??'http://127.0.0.1:5186';
const browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1200,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
await page.route('**/landuse-harness.html*',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><svg id="map" width="900" height="900" viewBox="0 0 2400 2400"></svg><aside id="controls"><div id="before"></div></aside></body></html>'}));
await page.goto(origin+'/landuse-harness.html?landuse='+encodeURIComponent(JSON.stringify({enabled:true})));
await page.evaluate(async moduleRoot=>{
const {createUrbanLanduse}=await import(moduleRoot+'/ui/urbanLanduse.ts');const n=96,size=n*n,width=2400;
const raster={n,width,height:new Float32Array(size).fill(24),water:new Uint8Array(size),waterLevel:new Float32Array(size).fill(24),riverWidth:new Float32Array(size),riverIds:new Int32Array(size).fill(-1)};
const rgba=new Uint8Array(64*64*4);for(let i=0;i<64*64;i++){rgba[4*i]=220;rgba[4*i+1]=150;}
const forest={field:{x:0,y:0,width,n:64,rgba,key:'forest-high'},settings:{enabled:true,density:1,clearings:.45},key:'high'};
window.context={raster,seed:'ui-review',relief:'flat',city:{key:'city',center:{x:1200,y:1200},radius:180,population:300,culture:'european-organic'},neighbours:[],layouts:[],forest};
// A real retained footprint, so the countryside has settlement influence.
window.context.layouts=[{key:'city',center:{x:1200,y:1200},culture:'european-organic',warnings:[],blocks:[],streets:[],quarters:[{phase:0,shape:{outer:[{x:1050,y:1050},{x:1350,y:1050},{x:1350,y:1350},{x:1050,y:1350}],holes:[]}}]}];
window.replies=0;window.controller=createUrbanLanduse({map:document.getElementById('map'),before:document.getElementById('before'),getView:()=>({view:{cx:1200,cy:1200,scale:.375},width:900,height:900}),getBackground:()=>({opacity:0}),onChange(){},onScene(scene){if(scene){window.scene=scene;window.replies++;}}});window.controller.set(window.context);
},moduleRoot);
await page.waitForFunction(()=>window.scene&&document.getElementById('landuseCanvas'),{timeout:60000});
const first=await page.evaluate(()=>({forest:window.scene.landuse.areas.filter(a=>a.kind==='forest').length,replies:window.replies}));if(!first.forest)throw Error('No baseline forest');
await page.evaluate(()=>{const next={...window.context,forest:{...window.context.forest,key:'low',field:{...window.context.forest.field,rgba:new Uint8Array(64*64*4),key:'forest-low'}}};window.controller.set(next);});
await page.waitForFunction(()=>window.scene&&!window.scene.landuse.areas.some(a=>a.kind==='forest')&&window.replies>=2,{timeout:60000});
await page.locator('#landuseStage .map-gear').click();
await page.locator('#landuseStage details.advanced > summary').click();
await page.locator('#landuseStyle').selectOption('cadastre');const replies=await page.evaluate(()=>window.replies);
await page.locator('#showLanduse').uncheck();await page.locator('#showLanduse').check();
if(await page.evaluate(()=>window.replies)!==replies)throw Error('Display regenerated geometry');
mkdirSync('out/landuse-review',{recursive:true});await page.screenshot({path:'out/landuse-review/ui-cadastre.png'});
if(errors.length)throw Error(errors.join('\n'));const report={worker:'inline',forestSourceRefresh:true,visibilityStable:true,errors};writeFileSync('out/landuse-review/ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
