import{describe,it,expect}from'vitest';
import{mkdtempSync,mkdirSync,writeFileSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';
import{join,resolve,dirname,basename}from'node:path';
import{execFileSync}from'node:child_process';
import{captureSurfaceRepositorySnapshot,assertFrozenSurfaceSnapshots}from'../scripts/surface_repository_snapshot.mjs';

describe('frozen complete renderer/compiler snapshot',()=>{
  it('pins new layer/canopy/water helpers, refuses dirty tracked/untracked source and ignores output artifacts',async()=>{
    const root=mkdtempSync(join(tmpdir(),'surface-snapshot-'));
    const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{windowsHide:true,stdio:'pipe'});
    const write=(name:string,content:string)=>{mkdirSync(join(root,name,'..'),{recursive:true});writeFileSync(join(root,name),content);};
    try{
      git('init','-q');write('.gitignore','web/out/\n');
      for(const file of['viewer-local/adapters/surface_layers.gd','viewer-local/adapters/meso_canopy.gd','viewer-local/adapters/water_projection.gd','viewer-local/shaders/layers.gdshaderinc','viewer-local/diagnostics/layer_probe.gd','web/src/surface/compiler.ts','web/src/ui/surfaceLive.ts','web/scripts/surface_render_evidence.ts','surface/presentation/palettes.json','surface/materials/catalogue.json','web/package.json'])write(file,'frozen');
      git('add','.');git('-c','user.name=Surface QA','-c','user.email=surface-qa@example.invalid','commit','-qm','fixture');
      const first=await captureSurfaceRepositorySnapshot(root);expect(Object.keys(first.files)).toHaveLength(11);expect(()=>assertFrozenSurfaceSnapshots(first)).not.toThrow();
      write('web/out/run/log.txt','ignored artifact');expect(await captureSurfaceRepositorySnapshot(root)).toEqual(first);
      write('viewer-local/adapters/water_projection.gd','edited while HEAD unchanged');const changed=await captureSurfaceRepositorySnapshot(root);
      expect(changed.head).toBe(first.head);expect(changed.files).not.toEqual(first.files);expect(()=>assertFrozenSurfaceSnapshots(first,changed)).toThrow(/dirty/);
      git('checkout','--','viewer-local/adapters/water_projection.gd');
      write('surface/presentation/palettes.json','style changed without renderer code edits');
      const styleChanged=await captureSurfaceRepositorySnapshot(root);expect(styleChanged.files['surface/presentation/palettes.json']).not.toBe(first.files['surface/presentation/palettes.json']);expect(()=>assertFrozenSurfaceSnapshots(first,styleChanged)).toThrow();
      git('checkout','--','surface/presentation/palettes.json');write('viewer-local/adapters/new_untracked_helper.gd','new');
      const untracked=await captureSurfaceRepositorySnapshot(root);expect(untracked.status).toContain('new_untracked_helper');expect(()=>assertFrozenSurfaceSnapshots(untracked)).toThrow();
    }finally{
      const target=resolve(root);
      if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('surface-snapshot-'))throw Error('Refusing cleanup outside the created QA temporary directory');
      rmSync(target,{recursive:true,force:true});
    }
  });
});
