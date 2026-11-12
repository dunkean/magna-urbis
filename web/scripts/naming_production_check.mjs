/** Exercise the shipped naming controls and sliders in the full production application. Build V2 first. */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const web=fileURLToPath(new URL('..',import.meta.url)),root=resolve(web,'dist-v2'),out=resolve(web,'out/naming-production');
await mkdir(out,{recursive:true});
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream'}).end(await readFile(path));
}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let browser;const errors=[],report={ok:false};
try{
  browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  await page.goto(`http://127.0.0.1:${server.address().port}/v2.html?lang=fr`,{waitUntil:'domcontentloaded'});
  await page.locator('#family-tab-map').click();
  await page.locator('#row-display-text .stage-title').click();
  const sliders=page.locator('[data-slider-path*=".composition.text.levels."]');assert.equal(await sliders.count(),9);
  const slider=page.locator('[data-slider-path="appearance.composition.text.levels.rivers"]');
  await slider.evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
  await slider.fill('1');await slider.dispatchEvent('input');
  assert.equal(await page.locator('[data-setting-path="appearance.composition.text.levels.rivers"]').inputValue(),'1');
  await slider.fill('100');await slider.dispatchEvent('input');
  await slider.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,'sliders-fr.png')});
  await page.locator('#row-map-naming .stage-title').click();
  await page.locator('#map-naming-profile').selectOption('persian');
  await page.locator('#map-naming-source').selectOption('invented');
  await page.locator('#map-naming-language').selectOption('ja');
  await page.locator('#map-naming-script').selectOption('latin');
  await page.locator('#map-naming-profile').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,'naming-fr.png')});
  assert.deepEqual(errors,[]);Object.assign(report,{ok:true,production:true,sliders:9,profiles:await page.locator('#map-naming-profile option').count(),errors});
}catch(error){Object.assign(report,{error:String(error),errors});process.exitCode=1;}
finally{await browser?.close();await new Promise(done=>server.close(done));await writeFile(resolve(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
