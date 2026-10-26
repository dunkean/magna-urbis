import{spawnSync}from'node:child_process';
import{readFile}from'node:fs/promises';
import{resolve}from'node:path';
import{createHash}from'node:crypto';

const PATHS=['viewer-local/adapters','viewer-local/scene','viewer-local/shaders','viewer-local/diagnostics','viewer-local/project.godot','viewer-local/profiles',
  'web/src','web/scripts','web/terrainbench.html','web/vite.config.ts','rust/bridge','viewer-local/native-height',
  'surface/materials/catalogue.json','surface/presentation/palettes.json','surface/vegetation/catalogue.json','surface/vegetation/tree-offline-source.json',
  'web/package.json','web/package-lock.json','viewer-local/bootstrap.ps1'];
export async function captureSurfaceRepositorySnapshot(root){
  const git=args=>{const result=spawnSync('git',['-C',root,...args],{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});
    if(result.status!==0)throw new Error('Cannot pin surface source snapshot: '+(result.stderr?.trim()||result.error||result.status));return result.stdout;};
  const names=git(['ls-files','-z','--',...PATHS]).split('\0').filter(Boolean).sort();
  if(!names.length)throw new Error('No tracked surface source files in selected repository');
  const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await readFile(resolve(root,name))).digest('hex')])));
  return{root,head:git(['rev-parse','HEAD']).trim(),status:git(['status','--porcelain','--untracked-files=normal']).trim(),files};
}
export function assertFrozenSurfaceSnapshots(initial,final=initial){
  if(initial.status!==''||final.status!==''||initial.head!==final.head||JSON.stringify(initial.files)!==JSON.stringify(final.files))
    throw new Error('Selected native/browser source snapshot is dirty or changed during E2E; freeze the integration and rerun');
}
