/** Real viewer + panel + scrolling, with an in-memory connector. Never calls a provider. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const base = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
const moduleUrl = path => '/@fs/' + fileURLToPath(new URL(path, import.meta.url)).replaceAll('\\','/');
const browser = await chromium.launch({ channel:'msedge',headless:true });
try {
  const page = await browser.newPage({ viewport:{width:1280,height:1000} }); page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route(base+'/atlas-fixture',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><header></header><div id="view" style="width:900px;height:600px"><canvas></canvas></div></body></html>'}));
  await page.goto(base+'/atlas-fixture');
  const png = Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=600;const ctx=c.getContext('2d');ctx.fillStyle='#698969';ctx.fillRect(0,0,900,600);return c.toDataURL().split(',')[1];}),'base64');
  const root={id:'a'.repeat(24),status:'succeeded',progress:1,message:'Tuile terminée',createdAt:1,description:'RPG map',resolvedStyle:'rpg',prompt:'test',totalSeconds:1,outputSize:[900,600],
    settings:{mode:'cloud',provider:'openai',model:'gpt-image-2.5-sunburst',style:'rpg',output:'battlemap',grid:'hex',cellMetres:3,pixels:1048576,outputPixels:0},
    context:{sourceId:'atlas-world',projection:'orthographic',camera:{cx:5000,cy:5000,scale:3},extentMetres:{width:300,height:200},viewport:{width:900,height:600}},battlemap:{grid:'hex',cellMetres:3}};
  const jobs=new Map([[root.id,root]]),requests=[],exports=[];
  let exportedPng, holdNext=false, releasePending, pendingArrived;
  const pendingRequest=new Promise(resolve=>{pendingArrived=resolve;});
  await page.route('http://127.0.0.1:8794/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/status')return route.fulfill({json:{service:'magna-illustration',protocol:1,promptRevision:6,mosaicExport:true,localDependencies:true,outputs:['illustration','battlemap'],gridTypes:['square','hex','none'],outpainting:['openai-orthographic']}});
    if(path.endsWith('/prompt'))return route.fulfill({json:{description:'test',prompt:'test'}});
    if(path.endsWith('/jobs')&&request.method()==='GET')return route.fulfill({json:{jobs:[...jobs.values()]}});
    if(path.endsWith('/atlas'))return route.fulfill({json:{rootId:root.id,jobs:[...jobs.values()]}});
    if(path.endsWith('/mosaics')&&request.method()==='POST'){
      const ids=request.postDataJSON().jobs;exports.push(ids);
      const tiles=ids.map(id=>jobs.get(id));
      const xs=tiles.map(t=>(t.context.camera.cx-root.context.camera.cx)*3),ys=tiles.map(t=>(t.context.camera.cy-root.context.camera.cy)*3);
      const width=Math.round(Math.max(...xs)-Math.min(...xs)+900),height=Math.round(Math.max(...ys)-Math.min(...ys)+600);
      exportedPng=Buffer.from(await page.evaluate(({width,height})=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c.toDataURL().split(',')[1];},{width,height}),'base64');
      return route.fulfill({json:{url:'/v1/illustrations/mosaics/'+'f'.repeat(64)+'.png',filename:'battlemap-globale.png',width,height,tiles:ids.length}});
    }
    if(path.includes('/mosaics/'))return route.fulfill({contentType:'image/png',headers:{'Content-Disposition':'attachment; filename="battlemap-globale.png"'},body:exportedPng});
    if(path.endsWith('/jobs')&&request.method()==='POST'){
      const body=request.postDataJSON();requests.push(body);
      const job={...root,id:requests.length.toString(16).padStart(24,'0'),context:body.context,settings:body.settings,continuation:body.continuation};jobs.set(job.id,job);
      if(holdNext){holdNext=false;await new Promise(resolve=>{releasePending=resolve;pendingArrived();});}
      return route.fulfill({json:job});
    }
    const id=path.split('/')[4];
    if(path.endsWith('.png'))return route.fulfill({contentType:'image/png',body:png});
    if(jobs.has(id))return route.fulfill({json:jobs.get(id)});
    return route.fulfill({status:404,json:{error:'Missing fixture'}});
  });
  await page.evaluate(async modules=>{
    const [{createViewer},{illustrationContext},{mountIllustration,captureViewport}]=await Promise.all([import(modules.viewer),import(modules.context),import(modules.panel)]);
    const viewport=document.querySelector('#view'),canvas=viewport.querySelector('canvas'),viewer=window.atlasViewer=createViewer({container:viewport,canvas});
    viewer.setRenderer({draw(view){const c=canvas.getContext('2d');c.fillStyle='#698969';c.fillRect(0,0,canvas.width,canvas.height);return{ms:0,band:2,scale:view.scale};},dispose(){}},10000);
    viewer.setView({cx:5000,cy:5000,scale:3});
    window.remountAtlasPanel=()=>{
      window.atlasPanel?.dispose();
      window.atlasPanel=mountIllustration({host:document.querySelector('header'),navigation:{getView:()=>viewer.getView(),setView:v=>viewer.setView(v),ready:()=>viewer.waitForFrame()},capture:async()=>({image:await captureViewport(viewport),context:illustrationContext({sourceStyle:'parchment',seed:'atlas-world',view:viewer.getView(),width:900,height:600})})});
    };
    window.remountAtlasPanel();
  },{viewer:moduleUrl('../src/ui/viewer.ts'),context:moduleUrl('../src/ui/illustrationContext.ts'),panel:moduleUrl('../../illustration/web/index.mjs')});
  await page.locator('.illustration-trigger').click();
  await page.locator('[data-history] summary').click();await page.locator('.illustration-history button').click();
  await page.locator('[data-current-neighbours]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-current-move=east]').isDisabled(),false);
  assert.equal(await page.locator('[name=grid]').inputValue(),'hex');assert.equal(await page.locator('[name=cellMetres]').inputValue(),'3');
  await page.locator('[data-current-move=east]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-atlas-world] img').length===2).catch(async error=>{console.log({status:await page.locator('.illustration-status').textContent(),errors,requests:requests.length});throw error;});
  assert.equal(requests.length,1);assert.equal(requests[0].continuation.direction,'east');assert.equal(requests[0].continuation.parentId,root.id);
  assert.equal(requests[0].context.camera.cx,5240);assert.equal(requests[0].settings.cellMetres,3);assert.equal(requests[0].settings.grid,'hex');
  assert.deepEqual(await page.evaluate(()=>window.atlasViewer.getView()),{cx:5000,cy:5000,scale:3});
  assert.equal(await page.locator('[data-move=east]').isDisabled(),false,'A newly generated view must allow a further extension.');
  await page.locator('[data-move=east]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-atlas-world] img').length===3);
  assert.equal(requests.length,2);assert.equal(requests[1].continuation.parentId,'1'.padStart(24,'0'));assert.equal(requests[1].context.camera.cx,5480);
  await page.locator('[data-move=west]').click();await page.locator('[data-move=west]').click();await page.locator('[data-move=east]').click();
  assert.equal(requests.length,2,'Revisiting generated neighbours must not submit another paid job.');
  const pane=page.locator('[data-atlas-pane]');await pane.scrollIntoViewIfNeeded();const rect=await pane.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.wheel(0,700);
  await page.waitForFunction(()=>document.querySelectorAll('[data-atlas-world] img').length>=4);
  assert.equal(requests.length,3);assert.equal(requests[2].continuation.direction,'south');
  assert.equal(requests[2].context.camera.cy,5160);assert.equal(requests[2].context.camera.cx,5240);
  await page.locator('[data-explore]').click();
  await page.locator('[data-current-neighbours]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-current-move=north]').isDisabled(),false);
  // A fresh panel emulates reloading and opening a generated child from history.
  await page.evaluate(()=>window.remountAtlasPanel());
  await page.locator('.illustration-trigger').click();await page.locator('[data-history] summary').click();
  await page.locator('.illustration-history button').last().click();
  await page.locator('[data-current-neighbours]').waitFor({state:'visible'});
  await page.locator('[data-current-move=north]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-atlas-world] img').length===4);
  assert.equal(requests.length,3,'Restored neighbouring images must be reused after reloading.');
  await page.locator('[data-move=east]').click();
  assert.equal(await page.locator('[data-move=north]').isDisabled(),false);
  holdNext=true;await page.locator('[data-move=north]').click();await pendingRequest;
  assert.equal(await page.locator('[data-move=west]').isDisabled(),false,'Known neighbours remain navigable during a generation.');
  await page.locator('[data-move=west]').click();await page.locator('[data-move=east]').click();releasePending();
  await page.waitForFunction(()=>document.querySelectorAll('[data-atlas-world] img').length===5);
  assert.equal(requests[3].context.camera.cx,5480);assert.equal(requests[3].context.camera.cy,4840);
  const downloading=page.waitForEvent('download');await page.locator('[data-atlas-export]').click();
  const downloaded=await downloading;assert.equal(downloaded.suggestedFilename(),'battlemap-globale.png');
  assert.equal(exports.length,1);assert.equal(exports[0].length,5);
  assert.equal(exportedPng.readUInt32BE(16),2340);assert.equal(exportedPng.readUInt32BE(20),1560);
  assert.deepEqual(errors,[]);
  console.log('Atlas passed: extensions from successive/current illustrations, restored atlas neighbours, cached revisits, scroll generation and one native-size global PNG; no provider calls.');
}finally{await browser.close();}
