import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function recordLocalization(manifest){
  manifest.figures=manifest.figures.filter(figure=>!['pipeline-en.svg','hydrology-en.svg','capacity-en.svg','parcel-en.svg'].includes(figure.file));
  for(const name of ['pipeline','hydrology','capacity','parcel']){
    const file=name+'-en.svg',bytes=await readFile(resolve(dir,'assets',file));
    manifest.figures.push({file,kind:'original-educational-vector-diagram',language:'en',source:'docs/scientific/assets/'+file,
      translatedFrom:name+'.svg',transformation:'English labels and descriptions; vector geometry unchanged',
      sha256:hash(bytes),bytes:bytes.length,limitation:'Schematic, not measured output; not to scale.'});
  }
  const files=['index.html','fr.html','translation-source.json','translations-en.tsv','translations-attributes-en.json','translations-code-en.json','translations-diagrams-en.json'];
  const fingerprints=[];
  for(const file of files){const bytes=await readFile(resolve(dir,file));fingerprints.push({file,sha256:hash(bytes),bytes:bytes.length});}
  manifest.localization={defaultLanguage:'en',languages:['en','fr'],recordedAt:new Date().toISOString(),
    sourceLanguage:'fr',translatedContentFragments:JSON.parse(await readFile(resolve(dir,'translation-source.json'),'utf8')).length,
    pages:{en:'index.html',fr:'fr.html'},fingerprints,
    scope:'Complete chapter prose, navigation, tables, captions, accessibility text, explanatory equations and diagram labels. Code identifiers and cited publication titles remain intact. Screenshot pixels retain their original capture language.'};
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const manifest=await recordLocalization(JSON.parse(await readFile(resolve(dir,'evidence.json'),'utf8')));
  await writeFile(resolve(dir,'evidence.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('Recorded complete EN/FR localization and four English diagram variants.');
}
