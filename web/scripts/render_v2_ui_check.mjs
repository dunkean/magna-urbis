// Actual GLSL parity + shared map/perspective/raster compilation. From web/.
import { chromium } from 'playwright';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const base=new URL(process.argv.find(x=>x.startsWith('http'))??'http://127.0.0.1:5173').origin,out='out/render-v2';mkdirSync(out,{recursive:true});
const fixture=JSON.parse(readFileSync('tests/fixtures/render_v2_environment.json','utf8'));
const moduleUrl=name=>'/@fs/'+fileURLToPath(new URL('../../rust/bridge/'+name,import.meta.url)).replaceAll('\\','/');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1050,height:760}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/terrainbench.html?standalone=1&profile=web&source=procedural&auto=0&render=svg&width=2400',{waitUntil:'domcontentloaded'});
 const report=await page.evaluate(async({fixture,environmentUrl,materialUrl,rasterUrl,sceneUrl})=>{
  const {RENDER_V2_ENVIRONMENT_GLSL}=await import(environmentUrl),{NEURAL_EARTH_MATERIAL_GLSL}=await import(materialUrl),{renderMaterialRaster}=await import(rasterUrl);
  const canvas=new OffscreenCanvas(5,1),gl=canvas.getContext('webgl2',{antialias:false});if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('GL float target unavailable');
  const noise=NEURAL_EARTH_MATERIAL_GLSL.slice(NEURAL_EARTH_MATERIAL_GLSL.indexOf('float sstep'),NEURAL_EARTH_MATERIAL_GLSL.indexOf('// (unit-variance'));
  const fields=Object.keys(fixture.cases[0].expected),compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}');
  let worst=0,worstField='',shaderCompileMs=0;const cases=[];
  for(const f of fixture.cases){
   const num=x=>Number.isInteger(x)?x+'.':String(x),v=(a,t='vec3')=>t+'('+a.map(num).join(',')+')';
   const code='#version 300 es\nprecision highp float;precision highp int;out vec4 color;\n'+noise+RENDER_V2_ENVIRONMENT_GLSL+'\nvoid main(){V2Env e=v2Evaluate('+[v(f.point),num(f.height),v(f.gradient,'vec2'),...['tpi','ts','tw','ps','pw','sand','bank','date'].map(k=>num(f[k])),'0.',f.seed+'u'].join(',')+');int k=int(gl_FragCoord.x);'+Array.from({length:5},(_,i)=>'if(k=='+i+')color=vec4('+Array.from({length:4},(_,j)=>fields[i*4+j]?'e.'+fields[i*4+j]:'0.').join(',')+');').join('')+'}';
   const start=performance.now(),fragment=compile(gl.FRAGMENT_SHADER,code),program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));shaderCompileMs+=performance.now()-start;
   const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,5,1,0,gl.RGBA,gl.FLOAT,null);const frame=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.viewport(0,0,5,1);gl.useProgram(program);gl.drawArrays(gl.TRIANGLES,0,3);const actual=new Float32Array(20);gl.readPixels(0,0,5,1,gl.RGBA,gl.FLOAT,actual);
   let error=0;for(let i=0;i<fields.length;i++){const d=Math.abs(actual[i]-f.expected[fields[i]]);error=Math.max(error,d);if(d>worst){worst=d;worstField=f.name+'/'+fields[i];}}
   cases.push({name:f.name,error});gl.deleteProgram(program);gl.deleteShader(fragment);gl.deleteFramebuffer(frame);gl.deleteTexture(texture);
  }
  // Full retained raster shader uses the v2 environment and final water.
  const n=128,terrain={x:0,y:0,width:512,resolution:n,height:Float32Array.from({length:n*n},(_,i)=>30+25*Math.sin((i%n)/19)*Math.cos(Math.floor(i/n)/27))};
  const field={x:0,y:0,width:512,n:32,rgba:Uint8Array.from({length:32*32*4},(_,i)=>[180,110,25,128][i%4]),key:'v2-proof'};
  const settings={seed:'42',climate:'temperate',climateValues:{temperature:8,precipitation:1000}},summer=renderMaterialRaster(terrain,settings,true,{field,renderV2:1,v2Season:.5}),winter=renderMaterialRaster(terrain,settings,true,{field,renderV2:1,v2Season:0});
  let seasonal=0;for(let i=0;i<summer.rgb.length;i++)seasonal+=Math.abs(summer.rgb[i]-winter.rgb[i]);seasonal/=summer.rgb.length;
  const display=document.createElement('canvas');display.width=n*4;display.height=n*2+26;const ctx=display.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,display.width,display.height);ctx.font='16px sans-serif';ctx.fillStyle='#222';
  for(const [k,data]of [summer,winter].entries()){const c=document.createElement('canvas');c.width=c.height=n;const cc=c.getContext('2d'),pixels=cc.createImageData(n,n);for(let i=0;i<n*n;i++){pixels.data.set(data.rgb.subarray(i*3,i*3+3),i*4);pixels.data[i*4+3]=255;}cc.putImageData(pixels,0,0);ctx.fillText(k?'Winter':'Summer',k*n*2+8,18);ctx.drawImage(c,k*n*2,26,n*2,n*2);}
  const {renderRustTerrain}=await import(sceneUrl);
  const coast={...terrain,minHeight:-60,maxHeight:60,globalMinHeight:-60,globalMaxHeight:60,motifSize:512,caveMask:new Uint8Array(),normalX:new Float32Array(n*n),normalY:new Float32Array(n*n),normalZ:new Float32Array(n*n).fill(1),height:Float32Array.from({length:n*n},(_,i)=>i%n<64?60:-10-(i%n-64))};
  const expected=renderMaterialRaster(coast,settings,true,{renderV2:1,v2Season:.5});
  const scene=renderRustTerrain(coast,'render-v2',false,{...settings,relief:'mountains',width:512,v2Season:.5},false,'v2-export',{enabled:false,azimuth:315,elevation:45,strength:0,exaggeration:2},{relief:true,hypsometry:true,water:true,frame:false});
  const img=new Image();img.src=scene.imageUrl;await img.decode();const exportCanvas=document.createElement('canvas');exportCanvas.width=exportCanvas.height=n;const exportContext=exportCanvas.getContext('2d');exportContext.drawImage(img,0,0);const pixels=exportContext.getImageData(0,0,n,n).data;
  let coastError=0;for(const x of [64,65,66,80,100])for(let c=0;c<3;c++)coastError=Math.max(coastError,Math.abs(pixels[(64*n+x)*4+c]-expected.rgb[(64*n+x)*3+c]));
  return {worst,worstField,cases,shaderCompileMs,seasonal,coastError,coastHasLandClip:scene.svg.includes('clip-path'),coastOcean:Array.from(pixels.slice((64*n+100)*4,(64*n+100)*4+3)),coastPng:exportCanvas.toDataURL(),png:display.toDataURL()};
 },{fixture,environmentUrl:moduleUrl('terrainRenderV2Environment.ts'),materialUrl:moduleUrl('terrainMaterial.ts'),rasterUrl:moduleUrl('terrainMaterialRaster.ts'),sceneUrl:moduleUrl('terrainRender.ts')});
 writeFileSync(out+'/coast-export.png',Buffer.from(report.coastPng.split(',')[1],'base64'));delete report.coastPng;
 writeFileSync(out+'/raster-seasons.png',Buffer.from(report.png.split(',')[1],'base64'));delete report.png;
 assert(report.coastError<=1,JSON.stringify(report));assert.equal(report.coastHasLandClip,false);assert(report.coastOcean[2]>report.coastOcean[0]*2);assert(report.worst<.003,JSON.stringify(report));assert(report.seasonal>5,JSON.stringify(report));assert.deepEqual(errors,[]);
 if(process.argv.includes('--raster-only')){writeFileSync(out+'/raster-report.json',JSON.stringify({...report,errors},null,2));console.log(JSON.stringify(report));await browser.close();process.exit(0);}
 // Compile actual interactive map and existing perspective on a generated map.
 await page.goto(base+'/terrainbench.html?standalone=1&profile=local&source=procedural&auto=0&style=render-v2&width=8000&motif=5000&relief=mountains&coasts=S&climate=cold&hydro_enabled=0',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('status')?.dataset.error==='true'||document.getElementById('gl')&&document.getElementById('terrainLoading')?.hidden&&window.magnaBenchContext?.ready(),null,{timeout:180000});const state=await page.locator('#status').textContent();console.log('Ready status:',state);assert.notEqual(await page.locator('#status').getAttribute('data-error'),'true',state);
 await page.locator('#renderV2Season').fill('0.5');await page.locator('#renderV2Season').dispatchEvent('input');await page.screenshot({timeout:120000,path:out+'/map-summer.png'});
 await page.locator('#renderV2Season').fill('0');await page.locator('#renderV2Season').dispatchEvent('input');await page.screenshot({timeout:120000,path:out+'/map-winter.png'});
 if(await page.locator('#projection3d').count()){await page.locator('#projection3d').click();await page.waitForTimeout(1500);await page.screenshot({timeout:120000,path:out+'/perspective.png'});}
 assert.deepEqual(errors,[]);writeFileSync(out+'/report.json',JSON.stringify({...report,errors},null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
