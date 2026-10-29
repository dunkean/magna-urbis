import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
export async function check(){
  execFileSync(process.execPath,[resolve(dir,'localize.mjs'),'--check'],{stdio:'inherit'});
  const manifest=JSON.parse(await readFile(resolve(dir,'evidence.json'),'utf8'));
  const pages=[];
  for(const[file,lang]of [['index.html','en'],['fr.html','fr']]){
    const html=await readFile(resolve(dir,file),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
    assert(new Set(ids).size===ids.length,file+': duplicate HTML ID');
    assert(html.includes('<html lang="'+lang+'">'),file+': incorrect language');
    for(const[,id]of html.matchAll(/href="#([^"]+)"/g))assert(ids.includes(id),file+': broken anchor #'+id);
    const chapters=[...html.matchAll(/<section class="chapter" id="([^"]+)"/g)].map(x=>x[1]);
    assert(chapters.length===19,file+': expected 19 chapters');
    for(const id of chapters)assert(html.includes('href="#'+id+'"'),file+': missing navigation entry '+id);
    assert(html.includes('data-language="en"')&&html.includes('data-language="fr"'),file+': missing visible language choice');
    const assets=[...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(x=>x[1]).filter(x=>!/^(?:https?:|data:)/.test(x));
    for(const path of assets)assert((await stat(resolve(dir,path.split(/[?#]/)[0]))).isFile(),file+': missing local resource '+path);
    for(const[,attrs]of html.matchAll(/<img\b([^>]+)>/g))assert(/\balt="[^"]+"/.test(attrs),file+': missing image alt text');
    const linkedPaths=[...new Set([...html.matchAll(/data-repo="([^"]+)"/g)].map(x=>x[1]))].sort();
    for(const path of linkedPaths){assert((await stat(resolve(root,path))).isFile(),'Missing code reference '+path);assert(manifest.linkedSources.some(x=>x.path===path),'Source absent from provenance '+path);}
    assert(!/<(?:script|link)[^>]+(?:src|href)="https?:/i.test(html),file+': remote runtime dependency');
    pages.push({file,lang,chapters,ids,linkedPaths,html});
  }
  assert(JSON.stringify(pages[0].chapters)===JSON.stringify(pages[1].chapters),'Chapter identity differs between languages');
  assert(JSON.stringify(pages[0].ids)===JSON.stringify(pages[1].ids),'Deep-link anchors differ between languages');
  assert(JSON.stringify(pages[0].linkedPaths)===JSON.stringify(pages[1].linkedPaths),'Source references differ between languages');
  const external=html=>[...new Set([...html.matchAll(/href="(https?:[^"]+)"/g)].map(x=>x[1]))].sort();
  assert(JSON.stringify(external(pages[0].html))===JSON.stringify(external(pages[1].html)),'External references differ between languages');
  for(const figure of manifest.figures)assert(hash(await readFile(resolve(dir,'assets',figure.file)))===figure.sha256,'Figure hash mismatch '+figure.file);
  for(const name of ['pipeline','hydrology','capacity','parcel']){
    const fr=await readFile(resolve(dir,'assets',name+'.svg'),'utf8'),en=await readFile(resolve(dir,'assets',name+'-en.svg'),'utf8');
    const geometry=svg=>svg.replace(/>[^<>]*</g,'><');
    assert(geometry(fr)===geometry(en),'Translated diagram geometry changed '+name);
    assert(manifest.figures.some(figure=>figure.file===name+'-en.svg'),'English diagram missing provenance '+name);
  }
  const reports=JSON.parse(await readFile(resolve(dir,'evidence/report-provenance.json'),'utf8'));
  for(const report of reports.reports)assert(hash(await readFile(resolve(dir,'evidence',report.file)))===report.sha256,'Integration report hash mismatch '+report.file);
  const drift=[];
  for(const source of manifest.linkedSources)if(hash(await readFile(resolve(root,source.path)))!==source.sha256)drift.push(source.path);
  console.log('PASS: English and French, 19 matching chapters, '+pages[0].ids.length+' matching anchors, '+pages[0].linkedPaths.length+' local references, '+manifest.figures.length+' exact figure hashes, '+reports.reports.length+' integration reports. No remote reading dependency.');
  if(drift.length)console.log('NOTICE: '+drift.length+' source files changed since the evidence snapshot:\n'+drift.join('\n'));
  return{languages:['en','fr'],chapters:19,anchors:pages[0].ids.length,linkedSources:pages[0].linkedPaths.length,figures:manifest.figures.length,sourceDrift:drift};
}
export async function browserCheck(){
  const{chromium}=await import(pathToFileURL(resolve(root,'web/node_modules/playwright/index.mjs')).href);
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader']});
  const out=resolve(root,'web/out/scientific-docs-bilingual');await mkdir(out,{recursive:true});
  const errors=[],remote=[],cases=[];
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'fr-FR'});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(/^https?:/.test(request.url()))remote.push(request.url());});
    await page.goto(pathToFileURL(resolve(dir,'index.html')).href);
    assert(await page.locator('html').getAttribute('lang')==='en','Fresh default must be English even with French browser locale');
    for(const[lang,file,needle,empty,resetName]of [['en','index.html','evaporation','0 chapters','Show all chapters'],['fr','fr.html','evaporation','0 chapitre','Afficher tous les chapitres']]){
      await page.goto(pathToFileURL(resolve(dir,file)).href+'?lang='+lang);
      await page.locator('img').evaluateAll(images=>images.forEach(image=>{image.loading='eager';}));
      await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
      assert(await page.locator('html').getAttribute('lang')===lang,'Wrong language '+lang);
      assert(await page.locator('section.chapter:visible').count()===19,'Missing chapters '+lang);
      await page.screenshot({path:resolve(out,'desktop-'+lang+'.png')});
      await page.locator('#search').fill(needle);assert(await page.locator('#eau').isVisible(),'Search failed '+lang);
      await page.locator('#search').fill('zzzz-no-documentation');assert(await page.locator('section.chapter:visible').count()===0,'Empty search failed '+lang);
      assert((await page.locator('#search-status').textContent()).startsWith(empty),'Search status wrong language '+lang);
      await page.getByRole('button',{name:resetName}).click();assert(await page.locator('section.chapter:visible').count()===19,'Reset failed '+lang);
      await page.locator('#search').fill('zzzz');await page.locator('.sidebar a[href="#maisons"]').click();assert(await page.locator('#maisons').isVisible(),'Navigation failed '+lang);
      await page.locator('#maisons').screenshot({path:resolve(out,'architecture-'+lang+'.png')});
      const other=lang==='en'?'fr':'en';await page.locator('.atlas-language a[hreflang="'+other+'"]').click();
      await page.waitForURL(url=>url.hash==='#maisons'&&url.searchParams.get('lang')===other);
      assert(await page.locator('html').getAttribute('lang')===other,'Language switch failed '+lang);
      await page.setViewportSize({width:390,height:844});await page.goto(pathToFileURL(resolve(dir,file)).href+'?lang='+lang);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow '+lang);
      assert(await page.locator('.atlas-language a[hreflang="'+other+'"]').isVisible(),'Language selector inaccessible on mobile '+lang);
      await page.screenshot({path:resolve(out,'mobile-'+lang+'.png')});await page.setViewportSize({width:1440,height:1000});
      await page.emulateMedia({media:'print'});await page.pdf({path:resolve(out,'atlas-'+lang+'.pdf'),format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
      cases.push(lang+': all chapters and images, search/reset/navigation, language switch with anchor, mobile, PDF');
    }
    const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:1280,height:900}});
    for(const[file,lang]of [['index.html','en'],['fr.html','fr']]){
      const staticPage=await nojs.newPage();await staticPage.goto(pathToFileURL(resolve(dir,file)).href);
      assert(await staticPage.locator('html').getAttribute('lang')===lang,'Static page language '+lang);
      assert(await staticPage.locator('section.chapter:visible').count()===19,'No-JS content missing '+lang);await staticPage.close();
    }
    cases.push('Both complete static pages readable without JavaScript');
    assert(!errors.length,'Browser errors: '+errors.join('; '));assert(!remote.length,'Remote reading requests: '+remote.join('; '));
    await writeFile(resolve(out,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:await browser.version(),cases,browserErrors:errors,remoteRequests:remote},null,2)+'\n');
    console.log('PASS: bilingual browser verification; evidence '+relative(root,out));
    await context.close();await nojs.close();
  }finally{await browser.close();}
}
