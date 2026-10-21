// From web/: node scripts/urban_forest_exclusion_ui_check.mjs [Vite bench URL]
// Local shared-shader proof; SwiftShader avoids host-driver link variability.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out=fileURLToPath(new URL('../out/urban-forest-exclusion', import.meta.url));mkdirSync(out,{recursive:true});
const rasterModule = '/@fs/' + fileURLToPath(new URL('../../rust/bridge/terrainMaterialRaster.ts', import.meta.url)).replaceAll('\\', '/');
const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/terrainbench.html');
for (const [key, value] of Object.entries({ standalone: '1', stage: 'settlements', profile: 'web', render: 'svg' })) url.searchParams.set(key, value);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage();await page.routeWebSocket('**/*',()=>{});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url.href,{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async rasterModule=>{
  const {renderMaterialRaster}=await import(rasterModule);
  const {withBuildingOccupation}=await import('/forestOccupation.ts');
  const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  const shape={outer:rect(24,24,40,64),holes:[rect(36,40,16,30)]};const passage={outer:rect(64,60,20,6),holes:[]};const wall={outer:rect(88,24,.15,64),holes:[]};
  const scene={buildings:[{footprint:[shape],circulation:[passage],structural_features:[{surface:[wall]}]}]};
  const occ=withBuildingOccupation(undefined,scene);const field={x:0,y:0,width:128,n:8,rgba:Uint8Array.from({length:8*8*4},(_,i)=>[230,150,40,150][i%4]),key:'dense-local-forest'};
  const terrain={x:0,y:0,width:128,resolution:256,height:new Float32Array(256*256).fill(20)};const settings={seed:'urban-exclusion-v1',climate:'temperate'};
  const before=renderMaterialRaster(terrain,settings,true,{field});const after=renderMaterialRaster(terrain,settings,true,{field,occupation:occ});
  let hard=0,leaked=0,beforeCover=0,holeCover=0,holeN=0,wallN=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
   const wx=(x+.5)*.5,wy=(y+.5)*.5,i=Math.floor((wx-occ.x)/occ.width*occ.n),j=Math.floor((wy-occ.y)/occ.width*occ.n),at=y*256+x;
   const cls=i>=0&&j>=0&&i<occ.n&&j<occ.n?occ.rgba[(j*occ.n+i)*4+2]:0;
   if(cls===8){hard++;if(after.canopyAlpha[at])leaked++;beforeCover+=before.canopyAlpha[at]/255;if(wx>=87.5&&wx<=89)wallN++;}
   if(wx>38&&wx<50&&wy>42&&wy<68){holeCover+=after.canopyAlpha[at]/255;holeN++;}
  }
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=552;const ctx=canvas.getContext('2d');ctx.fillStyle='#f1ead5';ctx.fillRect(0,0,1024,552);ctx.font='18px sans-serif';ctx.fillStyle='#342f27';ctx.fillText('Même forêt · avant emprises',15,25);ctx.fillText('Classe 8 · constructions et passage exclus',527,25);
  for(const [index,data]of [before,after].entries()){
   const c=document.createElement('canvas');c.width=c.height=256;const cc=c.getContext('2d'),pixels=cc.createImageData(256,256);
   for(let i=0;i<256*256;i++){pixels.data.set(data.rgb.subarray(i*3,i*3+3),i*4);pixels.data[i*4+3]=255;}cc.putImageData(pixels,0,0);ctx.drawImage(c,index*512,40,512,512);
   ctx.save();ctx.translate(index*512,40);ctx.scale(4,4);ctx.strokeStyle='#a64025';ctx.lineWidth=.3;
   for(const s of [shape,passage,wall]){ctx.beginPath();for(const ring of [s.outer,...s.holes]){ring.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();}ctx.stroke();}ctx.restore();
  }
  return {hardPixels:hard,leakedPixels:leaked,beforeCover:beforeCover/hard,holeCover:holeCover/holeN,wallPixels:wallN,occupation:occ.key,png:canvas.toDataURL('image/png')};
 }, rasterModule);
 writeFileSync(`${out}/local.png`,Buffer.from(result.png.split(',')[1],'base64'));delete result.png;writeFileSync(`${out}/result.json`,JSON.stringify({result,errors},null,2));console.log(JSON.stringify({result,errors}));
 if(result.leakedPixels||!result.hardPixels||result.holeCover<.05||!result.wallPixels)throw Error('Exclusion/retained courtyard failed');
}finally{await browser.close();}
