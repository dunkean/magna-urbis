import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const dir=dirname(fileURLToPath(import.meta.url));
const checking=process.argv.includes('--check');
const source=(await readFile(resolve(dir,'fr.html'),'utf8')).replace(/<nav class="atlas-language"[\s\S]*?<\/nav>/g,'').replace(/\s*<link rel="alternate"[^>]*>/g,'');
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
  function page(html,lang){
    const links='<link rel="alternate" hreflang="en" href="index.html?lang=en">\n  <link rel="alternate" hreflang="fr" href="fr.html?lang=fr">';
    const selector='<nav class="atlas-language" aria-label="'+(lang==='en'?'Documentation language':'Langue de la documentation')+'"><a href="index.html?lang=en" hreflang="en" lang="en" data-language="en"'+(lang==='en'?' aria-current="page"':'')+'>EN</a><a href="fr.html?lang=fr" hreflang="fr" lang="fr" data-language="fr"'+(lang==='fr'?' aria-current="page"':'')+'>FR</a></nav>';
    return html.replace('<link rel="stylesheet"',links+'\n  <link rel="stylesheet"').replace('<button id="print"',selector+'<button id="print"');
  }
  for(const[file,html]of [['index.html',page(english,'en')],['fr.html',page(source,'fr')]]){
    if(checking){if(await readFile(resolve(dir,file),'utf8')!==html)throw new Error('Stale localized page: '+file);}else await writeFile(resolve(dir,file),html);
  }
  console.log(`${index} English content fragments ${checking?'verified':'generated'}.`);
}
