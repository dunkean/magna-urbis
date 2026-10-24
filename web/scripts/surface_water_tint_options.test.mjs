import test from 'node:test';import assert from 'node:assert/strict';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url)),driver=fileURLToPath(new URL('./generate_surface_source.mjs',import.meta.url));
const run=args=>spawnSync(process.execPath,['--import','tsx',driver,...args],{cwd,encoding:'utf8',windowsHide:true,timeout:10000});
test('uniform water tint rejects source-levels before browser, source or native launch',()=>{
 const r=run(['--viewer-water-vector-tint','uniform','--viewer-water-mode','source-levels']);assert.equal(r.status,1);assert.match(r.stderr,/Uniform vector tint requires source-map/);
});
test('unknown water tint rejects before proof setup',()=>{
 const r=run(['--viewer-water-vector-tint','invent-river']);assert.equal(r.status,1);assert.match(r.stderr,/choose source-classes or uniform/);
});
test('legacy/default and explicit source-classes remain permitted with source-levels',()=>{
 for(const options of [[],['--viewer-water-vector-tint','source-classes']]){
  const r=run([...options,'--viewer-water-mode','source-levels','--timeout-ms','0']);assert.equal(r.status,1);assert.match(r.stderr,/Invalid source dimensions\/timeout/);assert.doesNotMatch(r.stderr,/Uniform vector tint requires/);
 }
});
