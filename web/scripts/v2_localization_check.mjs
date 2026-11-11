/** Eight-language and imperial-input regression against the real V2 page. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const web=fileURLToPath(new URL('..',import.meta.url)),out=resolve(web,'out/v2-localization');
process.env.CI='true';
await mkdir(out,{recursive:true});
const server=await createServer({configFile:resolve(web,'vite.v2.config.ts'),clearScreen:false,
  server:{host:'127.0.0.1',port:Number(process.env.MAGNA_LOCALIZATION_PORT??5187),strictPort:false,hmr:false}});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({channel:process.env.MAGNA_BROWSER_CHANNEL??'msedge',headless:true});
  const context=await browser.newContext({locale:'fr-FR',viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}v2.html?empty`,{waitUntil:'domcontentloaded'});
  await page.locator('#language-select').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.locator('#language-select option').count(),8);
  assert.equal(await page.locator('#map-naming-language,#map-naming-display-language').count(),0);
  assert.equal(await page.locator('#map-naming-mode').inputValue(),'localized');
  await page.locator('#seed').fill('Maison — TsingTao 42');
  await page.locator('#seed').dispatchEvent('change');
  await page.evaluate(async({i18n})=>{
    const {mountParameterForm}=await import('/parameterForm.ts');
    const {registerMessages}=await import(i18n);
    registerMessages({'Width (m)':{en:'Width (m)',fr:'Largeur (m)'},'Area (m²)':{en:'Area (m²)',fr:'Surface (m²)'},'Landform scale (km)':{en:'Landform scale (km)',fr:'Échelle du relief (km)'}});
    window.unitFixture={width:30,area:100,motif:10000};
    const host=document.createElement('section');host.id='unit-fixture';host.style.cssText='position:fixed;bottom:0;left:0;background:white;color:black;padding:8px;z-index:99999';document.body.append(host);
    window.unitForm=mountParameterForm(host,[
      {path:'width',id:'fixture-width',label:'Width (m)',type:'number',min:.5,max:60,step:.5},
      {path:'area',id:'fixture-area',label:'Area (m²)',type:'number',min:0,max:1000},
      {path:'motif',id:'fixture-motif',label:'Landform scale (km)',type:'number',min:.25,max:50,toInput:v=>v/1000,fromInput:v=>v*1000},
    ],{getValue:key=>window.unitFixture[key],setValue:(key,value)=>{window.unitFixture[key]=value;}});
  },{i18n:`/@fs/${web.replaceAll('\\','/')}/src/v2/i18n.ts`});
  const checks=[];
  for(const language of ['en','fr','es','pt','zh','ar','ru','ja']){
    await page.locator('#language-select').selectOption(language);
    assert.equal(await page.locator('html').getAttribute('lang'),language);
    assert.equal(await page.locator('html').getAttribute('dir'),language==='ar'?'rtl':'ltr');
    assert.equal(await page.locator('#seed').inputValue(),'Maison — TsingTao 42');
    const label=await page.locator('#family-tab-region .chain-family-label').innerText();
    if(!['en','fr'].includes(language))assert(!/^Region$|^Région$/.test(label),`${language}: ${label}`);
    const spacingCaption=page.locator('[data-field-path="terrain.sampleSpacing"] .parameter-caption').first();
    const bounds=await spacingCaption.boundingBox();
    assert(bounds&&bounds.width>=65&&bounds.height<100,`${language}: spacing caption collapsed`);
    for(const unit of ['m','ft','yd']){
      await page.locator('#units-select').selectOption(unit);
      const factor={m:1,ft:.3048,yd:.9144}[unit];
      const displayed=Number(await page.locator('#fixture-width').inputValue());
      assert(Math.abs(displayed-30/factor)<1e-6);
      assert.match(await page.locator('[data-field-path="width"] .parameter-caption').innerText(),new RegExp(`\\(${unit}\\)$`));
      assert(Math.abs(Number(await page.locator('#fixture-area').inputValue())-100/(factor*factor))<1e-6);
      assert.equal(await page.locator('#terrain-width-unit').inputValue(),unit==='m'?'km':unit);
      const data=await page.evaluate(()=>window.unitFixture);
      assert.deepEqual(data,{width:30,area:100,motif:10000});
    }
    checks.push({language,label,dir:await page.locator('html').getAttribute('dir')});
  }
  await page.locator('#units-select').selectOption('ft');
  await page.locator('#fixture-width').fill('100');await page.locator('#fixture-width').dispatchEvent('input');
  assert(Math.abs(await page.evaluate(()=>window.unitFixture.width)-30.48)<1e-10);
  await page.locator('#fixture-motif').fill('2');await page.locator('#fixture-motif').dispatchEvent('input');
  assert(Math.abs(await page.evaluate(()=>window.unitFixture.motif)-3218.688)<1e-8);
  await page.locator('#units-select').selectOption('yd');
  assert(Math.abs(Number(await page.locator('#fixture-width').inputValue())-100/3)<1e-6);
  await page.evaluate(()=>document.querySelector('#unit-fixture').remove());
  await page.screenshot({path:resolve(out,'ja-yards.png')});
  await page.locator('#language-select').selectOption('ar');
  await page.screenshot({path:resolve(out,'ar-yards.png')});
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#language-select').waitFor();
  assert.equal(await page.locator('#language-select').inputValue(),'ar');
  assert.equal(await page.locator('#units-select').inputValue(),'yd');
  assert.equal(await page.locator('#terrain-width-unit').inputValue(),'yd');
  assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'results.json'),JSON.stringify({ok:true,checks,imperialInput:true,preferencesPersist:true,errors},null,2));
  console.log(JSON.stringify({ok:true,languages:checks.length,imperialInput:true,preferencesPersist:true,errors}));
} finally {await browser?.close();await server.close();}
