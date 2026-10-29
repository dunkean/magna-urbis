/** Record the exact bilingual build and the bounded browser checks used to review it. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const web=fileURLToPath(new URL('..',import.meta.url)),root=resolve(web,'..');
const normalized=value=>value.replaceAll('\\','/');
const hash=file=>new Promise((done,reject)=>{const sha=createHash('sha256'),stream=createReadStream(file);stream.on('data',chunk=>sha.update(chunk));stream.on('error',reject);stream.on('end',()=>done(sha.digest('hex')));});
async function record(name){const path=resolve(root,name),info=await stat(path);return{path:normalized(path),relativePath:normalized(relative(root,path)),bytes:info.size,modifiedUtc:info.mtime.toISOString(),sha256:await hash(path)};}
async function walk(directory){const out=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())out.push(...await walk(path));else out.push(path);}return out.sort();}
const config=JSON.parse(await readFile(resolve(root,'rust/desktop-v2/tauri.conf.json'),'utf8'));
const version=config.version,base=`Magna Urbis V2_${version}_x64`;
const artifacts=[];
for(const name of [`rust/desktop-v2/target/release/bundle/nsis/${base}-setup.exe`,`rust/desktop-v2/target/release/bundle/msi/${base}_en-US.msi`])artifacts.push(await record(name));
const distribution=[];for(const file of await walk(resolve(web,'dist-v2')))distribution.push(await record(file));
const checks=[];
for(const file of ['web/out/v2-locales/results.json','web/out/v2-locales-production/results.json','web/out/v2-static-check.json']){
  const data=JSON.parse(await readFile(resolve(root,file),'utf8'));if(data.ok!==true)throw new Error(`Verification is not green: ${file}`);
  checks.push({...await record(file),ok:true,mode:data.mode??'production subpath',time:data.time,errors:data.errors,missing:data.missing});
}
const sources=[];
for(const file of [...await walk(resolve(web,'src/v2')),'web/src/ui/v2.html','web/src/ui/exportCrop.ts','web/vite.v2.config.ts','rust/desktop-v2/Cargo.toml','rust/desktop-v2/Cargo.lock','rust/desktop-v2/src/main.rs','rust/desktop-v2/tauri.conf.json',
  'web/scripts/v2_locale_check.mjs','web/scripts/v2_static_check.mjs','web/scripts/v2_locale_manifest.mjs',
  'docs/scientific/index.html','docs/scientific/fr.html','docs/scientific/reader.js','docs/scientific/styles.css','docs/scientific/evidence.json'])sources.push(await record(file));
const manifest={format:'magna-urbis-v2-bilingual-build-manifest',version:1,applicationVersion:version,generatedUtc:new Date().toISOString(),published:false,
  language:{default:'en',available:['en','fr'],preferenceKey:'magna-urbis-v2-language',liveSwitchRetainsWorldAndView:true},
  build:{command:'npm run app:v2:build',platform:process.platform,architecture:process.arch,node:process.version},
  validation:{browserLanguageChecks:'source and exact production artifact',productionSubpath:'/magna-urbis/v2/',desktopExecutablesLaunched:false,freshMachineInstallationTested:false,
    desktopScope:'MSI/NSIS packages were compiled and hashed. No native executable was launched for this localization update.'},
  artifacts,webDistribution:{directory:normalized(resolve(web,'dist-v2')),files:distribution.length,bytes:distribution.reduce((sum,item)=>sum+item.bytes,0),entries:distribution},checks,sources};
await mkdir(resolve(web,'out'),{recursive:true});const path=resolve(web,'out/v2-locale-build-manifest.json');await writeFile(path,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({path:normalized(path),applicationVersion:version,artifacts,webFiles:distribution.length,webBytes:manifest.webDistribution.bytes},null,2));
