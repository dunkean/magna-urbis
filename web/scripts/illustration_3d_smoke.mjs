/** V2 illustration adapter, real WebGL camera and capture. No provider calls. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
const root = '/@fs/' + fileURLToPath(new URL('../src', import.meta.url)).replaceAll('\\','/');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30000);
  const errors=[], prompts=[];let submissions=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://127.0.0.1:8794/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path==='/status')return route.fulfill({json:{service:'magna-illustration',protocol:1,promptRevision:6,outputs:['illustration','battlemap'],localDependencies:true}});
    if(path.endsWith('/prompt')) {prompts.push(request.postDataJSON());return route.fulfill({json:{description:'3D crop',prompt:'Measured 3D battlemap'}});}
    if(request.method()==='POST')submissions++;
    return route.fulfill({json:{jobs:[]}});
  });
  await page.route(base+'/battlemap-3d-fixture',route=>route.fulfill({contentType:'text/html',body:'<html><body><header></header><div id="viewport" style="width:960px;height:600px"><canvas width="960" height="600" style="width:960px;height:600px"></canvas></div></body></html>'}));
  await page.goto(base+'/battlemap-3d-fixture');
  await page.evaluate(async root=>{
    const [{Terrain3d},{mountV2Illustration},{defaultSettings}]=await Promise.all([import(root+'/ui/terrain3d.ts'),import(root+'/v2/illustration.ts'),import(root+'/v2/settings.ts')]);
    const canvas=document.querySelector('canvas'),view=new Terrain3d(canvas,()=>{},undefined,{navigation:true,fastMapShader:true});
    view.resize(960,600);view.setSurface({x:0,y:0,width:10000,n:2,data:new Float32Array([10,10,10,10])});view.setActive(true);
    view.setCamera({x:4000,y:5000,distance:3000,yaw:.7,pitch:.88,exaggeration:1,navigation:'orbit'});
    const settings=defaultSettings(),world={seed:'3d-battlemap',settlements:[]};
    window.battlemap3d={view};
    mountV2Illustration({host:document.querySelector('header'),getWorld:()=>world,getSettings:()=>settings,
      getViewport:()=>({element:document.querySelector('#viewport'),view:{cx:-10000,cy:-10000,scale:1}}),
      get3d:()=>({active:true,getCamera:()=>view.getCamera(),setCamera:camera=>view.setCamera(camera),captureIllustration:()=>view.captureIllustration()})});
  },root);
  const option=page.locator('[name=output] option[value=battlemap]');
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(()=>document.querySelector('.illustration-status').textContent==='Capture prête.');
  assert.equal(await option.evaluate(option=>option.disabled),true);
  assert.match(await page.locator('[data-battlemap-hint]').textContent(),/75°/);
  await page.locator('[data-prepare-battlemap]').click();
  await page.waitForFunction(()=>document.querySelector('[name=output]').value==='battlemap' && !document.querySelector('[data-generate]').disabled);
  const camera=await page.evaluate(()=>window.battlemap3d.view.getCamera());
  assert.equal(camera.x,4000);assert.equal(camera.y,5000);assert(Math.abs(camera.yaw-.7)<1e-12);
  assert(camera.pitch>=80*Math.PI/180 && camera.distance<3000);
  assert.match(await page.locator('[data-framing]').textContent(),/80,?\.?0?°/);
  assert.match(await page.locator('[data-battlemap-hint]').textContent(),/Battlemap disponible/);
  await page.waitForFunction(()=>document.querySelector('.illustration-prompt').textContent==='Measured 3D battlemap');
  const prompt=prompts.findLast(body=>body.settings.output==='battlemap');
  assert.equal(prompt.context.projection,'perspective');
  assert(prompt.context.camera.viewAngleDegrees>=75);
  assert.equal(prompt.context.camera.x,4000);
  assert(prompt.context.extentMetres.width<768);
  // A walking view also offers the same explicit action, returning to orbit.
  await page.evaluate(()=>{const view=window.battlemap3d.view;view.setCamera({...view.getCamera(),navigation:'walk',pitch:.08});});
  await page.locator('[data-recapture]').click();
  await page.waitForFunction(()=>document.querySelector('[name=output]').value==='illustration');
  await page.locator('[data-prepare-battlemap]').click();
  await page.waitForFunction(()=>document.querySelector('[name=output]').value==='battlemap' && !document.querySelector('[data-generate]').disabled);
  assert.equal((await page.evaluate(()=>window.battlemap3d.view.getCamera())).navigation,'orbit');
  assert.equal(submissions,0);assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.battlemap3d.view.dispose());
  console.log('3D battlemap: oblique/distant and walking views reframe around the same target; measured WebGL capture enables Battlemap, without generation.');
} finally {await browser.close();}
