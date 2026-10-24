import{spawnSync}from'node:child_process';import test from 'node:test';import assert from 'node:assert/strict';import{existsSync,mkdirSync,mkdtempSync,readFileSync}from'node:fs';import{fileURLToPath}from'node:url';import path from'node:path';import{spawnSurfaceFileLogged}from'./surface_process_logs.mjs';
const project=fileURLToPath(new URL('../../viewer-local/',import.meta.url));
const godot=process.env.GODOT??'D:/workspace/self/_surface-tools/godot-4.7.2/Godot_v4.7.2-stable_win64_console.exe';
test('real native thread queue preserves UTF8/FIFO over inherited file descriptors and joins cleanly',{skip:!existsSync(godot)},async()=>{
 const parent=fileURLToPath(new URL('../out/surface/',import.meta.url));mkdirSync(parent,{recursive:true});const out=mkdtempSync(path.join(parent,'native-log-fd-')),stdout=path.join(out,'stdout.log'),stderr=path.join(out,'stderr.log');
 const child=spawnSurfaceFileLogged(godot,['--headless','--path',project,'--script','res://tests/native_log_test.gd'],{windowsHide:true,stdoutPath:stdout,stderrPath:stderr});
 let timer;const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));timer=setTimeout(()=>{child.kill();reject(Error('Owned native logger test timed out'));},30000);}).finally(()=>clearTimeout(timer));
 assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(readFileSync(stderr,'utf8'),'');
 const text=readFileSync(stdout,'utf8');assert.ok(!text.includes('\ufffd'));const events=text.split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
 const records=events.filter(e=>e.event==='logger-fixture');assert.equal(records.length,300);
 for(let i=0;i<300;i++){assert.equal(records[i].serial,i);assert.equal(records[i].capturedTick,i);assert.equal(records[i].unicode,'é源😀');assert.equal(records[i].payload,'first\nsecond');}
 const report=events.find(e=>e.event==='native-log-test-report');assert.equal(report.status,'PASS');assert.ok(report.checks>=1400);assert.equal(report.realWriter.written,300);assert.equal(report.realWriter.pending,0);assert.equal(report.realWriter.joined,true);
});


test('native log driver flag rejects unknown mode and preserves explicit/default synchronous validation',()=>{
 const cwd=fileURLToPath(new URL('../',import.meta.url)),driver=path.join(cwd,'scripts/generate_surface_source.mjs');
 const run=args=>spawnSync(process.execPath,['--import','tsx',driver,...args],{cwd,encoding:'utf8',windowsHide:true,timeout:10000});
 const invalid=run(['--viewer-native-log-mode','asynchronous']);assert.equal(invalid.status,1);assert.match(invalid.stderr,/Native log mode must be synchronous or threaded/);
 for(const options of [[],['--viewer-native-log-mode','synchronous'],['--viewer-native-log-mode','threaded']]){
  const result=run([...options,'--timeout-ms','0']);assert.equal(result.status,1);assert.match(result.stderr,/Invalid source dimensions\/timeout/);assert.doesNotMatch(result.stderr,/Native log mode must/);
 }
});
