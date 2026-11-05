import { editorial } from './editorial.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const dir=dirname(fileURLToPath(import.meta.url));
const checking=process.argv.includes('--check');
// The stage chapter (stages-fr.html / stages-en.html, built by stages.mjs) is injected between the
// markers and is outside the fragment/translation mechanism: both languages are authored in stages-data.mjs.
const REGION=/<!--STAGES:BEGIN-->[\s\S]*?<!--STAGES:END-->/;
const frStages=(await readFile(resolve(dir,'stages-fr.html'),'utf8')).trim(),enStages=(await readFile(resolve(dir,'stages-en.html'),'utf8')).trim();
const fullSource=(await readFile(resolve(dir,'fr-source.html'),'utf8')).replace(REGION,()=>frStages).replace(/<nav class="atlas-language"[\s\S]*?<\/nav>/g,'').replace(/\s*<link rel="alternate"[^>]*>/g,'');
const source=fullSource.replace(REGION,'<!--STAGES-->');
const excluded=new Set(['code','pre','script','style']);
const stack=[];const fragments=[];
const tokens=source.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)??[];
for(const token of tokens){
  if(token.startsWith('<')){
    const close=token.match(/^<\/([\w-]+)/),open=token.match(/^<([\w-]+)/);
    if(close){const position=stack.lastIndexOf(close[1]);if(position>=0)stack.splice(position);}
    else if(open&&!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(open[1])&&!token.endsWith('/>'))stack.push(open[1]);
  }else if(token.trim()&&!stack.some(tag=>excluded.has(tag)))fragments.push(token.trim());
}
if(process.argv.includes('--extract')){
  await writeFile(resolve(dir,'translation-source.json'),JSON.stringify(fragments,null,2)+'\n');
  console.log(`${fragments.length} content fragments extracted.`);
}else{
  const recorded=JSON.parse(await readFile(resolve(dir,'translation-source.json'),'utf8'));
  if(JSON.stringify(recorded)!==JSON.stringify(fragments))throw new Error('French source changed: review extraction and all corresponding English translations.');
  const entries=(await readFile(resolve(dir,'translations-en.tsv'),'utf8')).split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#')).map(line=>{const split=line.indexOf('\t');if(split<0)throw new Error(`Missing tab: ${line}`);return [Number(line.slice(0,split)),line.slice(split+1)];});
  if(new Set(entries.map(([id])=>id)).size!==entries.length||entries.length!==fragments.length)throw new Error('Duplicate, missing or obsolete translation IDs.');
  const translated=new Map(entries);let index=0;stack.length=0;
  const output=tokens.map(token=>{
    if(token.startsWith('<')){
      const close=token.match(/^<\/([\w-]+)/),open=token.match(/^<([\w-]+)/);
      if(close){const position=stack.lastIndexOf(close[1]);if(position>=0)stack.splice(position);}
      else if(open&&!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(open[1])&&!token.endsWith('/>'))stack.push(open[1]);
      return token;
    }
    if(!token.trim()||stack.some(tag=>excluded.has(tag)))return token;
    const id=index++;if(!translated.has(id))throw new Error(`Untranslated fragment ${id}: ${token.trim()}`);
    return token.replace(token.trim(),translated.get(id));
  }).join('');
  const attrs=JSON.parse(await readFile(resolve(dir,'translations-attributes-en.json'),'utf8'));
  let english=output.replace('<html lang="fr">','<html lang="en">').replace(/((?:content|data-title|alt|aria-label|placeholder)=")([^"]*)"/g,(_match,prefix,value)=>{
    if(!(value in attrs))throw new Error('Untranslated attribute: '+value);
    return prefix+attrs[value].replaceAll('"','&quot;')+'"';
  });
  const code=JSON.parse(await readFile(resolve(dir,'translations-code-en.json'),'utf8'));
  english=english.replace(/<code>([\s\S]*?)<\/code>/g,(match,value)=>value in code?'<code>'+code[value]+'</code>':match);
  english=english.replace('<!--STAGES-->',()=>enStages);
  const diagrams=JSON.parse(await readFile(resolve(dir,'translations-diagrams-en.json'),'utf8'));
  for(const [name,messages]of Object.entries(diagrams)){
    const original=await readFile(resolve(dir,'assets',name+'.svg'),'utf8');
    const translatedDiagram=original.replace(/>([^<>]+)</g,(match,value)=>{
      if(!value.trim()||value.includes('{'))return match;
      if(!(value in messages))throw new Error('Untranslated diagram label: '+name+': '+value);
      return '>'+messages[value]+'<';
    });
    const path=resolve(dir,'assets',name+'-en.svg');
    if(checking){if(await readFile(path,'utf8')!==translatedDiagram)throw new Error('Stale English diagram: '+name);}else await writeFile(path,translatedDiagram);
    english=english.replaceAll('assets/'+name+'.svg','assets/'+name+'-en.svg');
  }

// Keep the editable source and stage templates intact; compose both static pages
// with the individual stages beside their explanations, including without JS.
function integrateStages(html) {
  const destinations = {
    'relief-source':'relief', 'relief-climate':'relief', 'relief-mask':'relief', 'relief-grids':'relief', 'relief-noise':'relief', 'relief-coast-cut':'relief',
    'relief-regional':'erosion', 'relief-relax':'erosion', 'relief-reconstruct':'erosion', 'relief-calibrate':'erosion', 'relief-detail':'erosion', 'relief-surface':'erosion', 'relief-datum':'erosion', 'relief-phasor':'erosion',
    'relief-neural-coarse':'neural', 'relief-neural-base':'neural', 'relief-neural-decoder':'neural', 'relief-heightmap-fit':'relief', 'relief-refine':'relief', 'relief-conditioning':'eau', 'relief-aeolian':'erosion', 'relief-coasts':'relief',
    'water-hydrology':'eau', 'cover-climate':'paysage', 'settle-sites':'sites', 'settle-hierarchy':'sites', 'settle-roads':'routes',
    'city-composition':'ville', 'city-roads':'ville', 'city-quarters':'ville', 'city-trim':'ville', 'city-parcels':'parcelles', 'city-programme':'programme', 'city-buildings':'maisons', 'city-houses':'maisons',
    'display-terrain':'rendu', 'display-water':'rendu', 'display-vegetation':'rendu', 'display-roads':'rendu', 'display-buildings':'rendu', 'display-labels':'rendu', 'map-naming':'rendu', 'map-export':'rendu'
  };
  const collected = new Map();
  html = html.replace(/<section class="stage" id="stage-([^"]+)"[\s\S]*?<\/section>/g, (block,id) => {
    const dest=destinations[id]; if (!dest) throw new Error('No chapter for stage '+id);
    collected.set(dest,(collected.get(dest)||'')+'\n'+block); return '';
  });
  for (const [id, blocks] of collected) {
    const start=html.indexOf('<section class="chapter" id="'+id+'"');
    const end=html.indexOf('\n</section>',start);
    if(start<0||end<0) throw new Error('Missing chapter '+id);
    html=html.slice(0,end)+blocks+html.slice(end);
  }
  // The city pipeline allocates parcels before the programme.
  const a=html.indexOf('<section class="chapter" id="programme"');
  const b=html.indexOf('<section class="chapter" id="parcelles"');
  const c=html.indexOf('<section class="chapter" id="maisons"');
  if(a<0||b<a||c<b) throw new Error('Unexpected city chapter order');
  html=html.slice(0,a)+html.slice(b,c)+html.slice(a,b)+html.slice(c);
  html=html.replace(/(<li><a href="#programme">[\s\S]*?<\/li>)\s*(<li><a href="#parcelles">[\s\S]*?<\/li>)/, '$2\n    $1');
  html=html.replace('href="#programme">09 ·', 'href="#programme">10 ·')
    .replace('href="#parcelles">10 ·', 'href="#parcelles">09 ·')
    .replace(/(id="programme"[^>]*>\s*<div class="chapter-number">)09 /, (_m,prefix)=>prefix+'10 ')
    .replace(/(id="parcelles"[^>]*>[\s\S]*?<div class="chapter-number">)10 /, (_m,prefix)=>prefix+'09 ')
    .replace(/(href="#parcelles">(?:chapitre|chapter) )10/g, (_m,prefix)=>prefix+'09');
  return html;
}

  function page(html,lang){
    const links='<link rel="alternate" hreflang="en" href="index.html?lang=en">\n  <link rel="alternate" hreflang="fr" href="fr.html?lang=fr">';
    const selector='<nav class="atlas-language" aria-label="'+(lang==='en'?'Documentation language':'Langue de la documentation')+'"><a href="index.html?lang=en" hreflang="en" lang="en" data-language="en"'+(lang==='en'?' aria-current="page"':'')+'>EN</a><a href="fr.html?lang=fr" hreflang="fr" lang="fr" data-language="fr"'+(lang==='fr'?' aria-current="page"':'')+'>FR</a></nav>';
    const catalogue = '<p class="sources"><a href="catalogue-architecture.html">' + (lang === 'fr' ? 'Catalogue architectural illustré' : 'Illustrated architectural catalogue (French)') + '</a></p>';
    return editorial(integrateStages(html.replace('<link rel="stylesheet"',links+'\n  <link rel="stylesheet"').replace('<button id="print"',selector+'<button id="print"').replace('<section class="chapter" id="maisons"',catalogue+'<section class="chapter" id="maisons"')), lang);
  }
  for(const[file,html]of [['index.html',page(english,'en')],['fr.html',page(fullSource,'fr')]]){
    if(checking){if(await readFile(resolve(dir,file),'utf8')!==html)throw new Error('Stale localized page: '+file);}else await writeFile(resolve(dir,file),html);
  }
  console.log(`${index} English content fragments ${checking?'verified':'generated'}.`);
}
