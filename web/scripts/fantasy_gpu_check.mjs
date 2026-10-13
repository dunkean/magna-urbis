// Exercise the real Neural Earth WebGPU renderer and shared painter with a small physical fixture.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1100,height:850}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.route('**/fantasy-probe',route=>route.fulfill({contentType:'text/html',body:`<style>canvas{position:absolute;left:0;top:0}#gpuMap,#annotations{pointer-events:none}#renderPanel{display:none}</style><div id="renderPanel"><div class="toolPanel"></div></div><canvas id="map" width="1000" height="800"></canvas><canvas id="gpuMap" width="1000" height="800"></canvas><canvas id="annotations" width="1000" height="800"></canvas><script src="terrain_lighting.js"></script><script src="terrain_styles.js"></script><script src="terrain_render_controls.js"></script><script src="terrain_renderer.js"></script><script src="fantasy_painting.js"></script><script src="fantasy_brush_assets.js"></script><script src="terrain_fantasy.js"></script>`}));
  await page.goto('http://127.0.0.1:8780/fantasy-probe');
  const result = await page.evaluate(async()=>{
    const renderer=await createTerrainRenderer(document.getElementById('gpuMap')); if(!renderer?.available)throw Error('No WebGPU renderer');
    const width=304,halo=24,step=40,span=256*step,values=new Float32Array(width*width);
    for(let y=0;y<width;y++)for(let x=0;x<width;x++){const xx=(x-halo)/256,yy=(y-halo)/256;values[y*width+x]=150+1800*Math.exp(-((xx-.62)**2+(yy-.4)**2)*20)+300*Math.sin(xx*12)*Math.sin(yy*9);}
    const climate=new Float32Array(33*33*5);climate.fill(18,0,33*33);climate.fill(1400,2*33*33,3*33*33);climate.fill(-.006,4*33*33);
    const heightOptions={width,height:width,halo,metresPerSample:step,origin:[-halo*step,-halo*step],climate,climateWidth:33,climateHeight:33,lod:0,mode:'parchment'};
    renderer.uploadTile('fixture',values,heightOptions);renderer.setMode('parchment');
    const ctx=document.getElementById('annotations').getContext('2d'),tile={key:'fixture',b:[0,0,span,span],heights:values,heightOptions,sourceResolution:step};
    let mode='fantasy-color';
    const paint=()=>{ctx.clearRect(0,0,1000,800);renderer.draw([{key:'fixture',lod:0,x:0,y:0,width:800,height:800,uv:[0,0,1,1]}],{width:1000,height:800,dpr:1});TerrainFantasy.draw(ctx,{mode,seed:'42',cx:span/2,cy:span/2,mpp:span/800,width:800,height:800,entries:[{tile,bounds:tile.b}],revision:1});};
    TerrainFantasy.mount(paint);paint();
    await new Promise((resolve,reject)=>{const start=performance.now(),timer=setInterval(()=>{const stats=TerrainFantasy.stats();if(stats.stamps&&stats.decoded===stats.sheets){clearInterval(timer);resolve();}else if(performance.now()-start>10000){clearInterval(timer);reject(Error('Atlas not decoded'));}},30);});
    await renderer.device.queue.onSubmittedWorkDone();
    window.fixture={paint,setMode:value=>{mode=value;paint();},renderer};
    return {paint:TerrainFantasy.stats(),renderer:renderer.getStats()};
  });
  assert(result.paint.stamps>100);console.log(JSON.stringify(result));
  await page.screenshot({path:'out/fantasy/neural-webgpu-color.png'});
  await page.evaluate(()=>fixture.setMode('fantasy-ink'));
  await page.screenshot({path:'out/fantasy/neural-webgpu-ink.png'});
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
