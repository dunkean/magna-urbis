import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './surface_vegetation_assets.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
const value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const catalog=JSON.parse(await readFile(path.join(root,'surface/vegetation/tree-offline-source.json'),'utf8'));
const out=path.resolve(value('--out',path.join(root,'web/out/vegetation-tree/source')));
if(catalog.license!=='CC0-1.0') throw new Error('Expected pinned CC0 source');
for(const file of catalog.sourceFiles){
  const destination=path.join(out,file.path);await mkdir(path.dirname(destination),{recursive:true});
  let bytes;try{bytes=await readFile(destination);}catch{}
  if(!bytes||bytes.length!==file.bytes||sha256(bytes)!==file.sha256){
    if(args.includes('--offline'))throw new Error(`Missing/edited source ${file.path}`);
    const response=await fetch(file.url);if(!response.ok)throw new Error(`HTTP${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new Error(`Pinned source mismatch ${file.path}`);
    await writeFile(destination,bytes);
  }
}
console.log(JSON.stringify({assetId:catalog.assetId,files:catalog.sourceFiles.length,bytes:catalog.sourceFiles.reduce((n,f)=>n+f.bytes,0),scope:'offline preparation input only; never loaded by viewer'}));
