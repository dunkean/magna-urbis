import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const root = new URL('../src/render/assets/fantasy/families/runtime/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:1380},deviceScaleFactor:1});
await mkdir('out/fantasy',{recursive:true});
try {
  const sheets=[];
  for(const [family,meta]of Object.entries(manifest))sheets.push({family,meta,source:'data:image/webp;base64,'+(await readFile(new URL(meta.file,root))).toString('base64')});
  await page.setContent('<style>body{margin:8px;background:#f3eee3;font:14px system-ui}.sheets{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}figure{margin:0;padding:5px;border:1px solid #bfb5a0}img{width:100%;display:block}figcaption{text-align:center}</style><div class="sheets"></div>');
  const report=await page.evaluate(async sheets=>{
    const result=[];
    for(const {family,meta,source}of sheets){
      const image=new Image();image.src=source;await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d');const hashes=[];
      for(const rect of meta.rects){ctx.clearRect(0,0,32,32);ctx.drawImage(image,...rect,0,0,32,32);const pixels=ctx.getImageData(0,0,32,32).data;let hash=2166136261;for(const byte of pixels)hash=Math.imul(hash^byte,16777619);hashes.push(hash>>>0);}
      const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=family;figure.append(image,caption);document.querySelector('.sheets').append(figure);
      result.push({family,count:meta.variantsPerStyle||8,ink:new Set(hashes.slice(0,meta.variantsPerStyle||8)).size,color:new Set(hashes.slice(meta.variantsPerStyle||8)).size});
    }return result;
  },sheets);
  for(const family of report){assert.equal(family.ink,family.count);assert.equal(family.color,family.count);}
  await page.screenshot({path:'out/fantasy/family-sheets.png',fullPage:true});console.log(JSON.stringify(report));
}finally{await browser.close();}
