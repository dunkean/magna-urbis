import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,readFileSync,existsSync,rmSync } from 'node:fs';
import { join,dirname,basename,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSurfaceFileLogged,parseSurfaceNativeLogs } from './surface_process_logs.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const busy=ms=>{const until=Date.now()+ms;while(Date.now()<until){}};
const script=String.raw`const fs=require('node:fs');const root=process.argv[1];const payload=Buffer.from('entrée-toit\n'.repeat(1024));const start=Date.now();fs.writeFileSync(root+'/began','1');for(let i=0;i<768;i++)fs.writeSync(1,payload);fs.writeSync(1,'{"event":"capture","name":"été"}\n');for(let i=0;i<128;i++)fs.writeSync(2,payload);fs.writeFileSync(root+'/done',JSON.stringify({writeMs:Date.now()-start}));`;
function temporary(){const path=mkdtempSync(join(tmpdir(),'surface-file-log-proof-'));return{path,clean(){assert.equal(dirname(resolve(path)),resolve(tmpdir()));assert.ok(basename(path).startsWith('surface-file-log-proof-'));rmSync(path,{recursive:true,force:true});}};}
function waitBegin(path){const deadline=Date.now()+10000;while(!existsSync(join(path,'began'))&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);assert.ok(existsSync(join(path,'began')));}
const completion=child=>new Promise((done,fail)=>{child.once('error',fail);child.once('close',(code,signal)=>done({code,signal}));});
test('file descriptors retain exact large stdout/stderr while the parent event loop is unavailable',async()=>{
 const directory=temporary();try{const out=join(directory.path,'stdout.log'),err=join(directory.path,'stderr.log');const child=spawnSurfaceFileLogged(process.execPath,['-e',script,directory.path],{stdoutPath:out,stderrPath:err,windowsHide:true});const done=completion(child);assert.equal(child.stdout,null);assert.equal(child.stderr,null);waitBegin(directory.path);busy(2000);assert.ok(existsSync(join(directory.path,'done')),'child must finish writing before parent resumes its event loop');assert.deepEqual(await done,{code:0,signal:null});
 const payload=Buffer.from('entrée-toit\n'.repeat(1024));const expectedOut=Buffer.concat([...Array(768).fill(payload),Buffer.from('{"event":"capture","name":"été"}\n')]);const expectedErr=Buffer.concat(Array(128).fill(payload));assert.equal(hash(readFileSync(out)),hash(expectedOut));assert.equal(hash(readFileSync(err)),hash(expectedErr));
 }finally{directory.clean();}
});
test('pipe control blocks the writer when the same parent cannot drain output',async()=>{
 const directory=temporary();try{const child=spawn(process.execPath,['-e',script,directory.path],{windowsHide:true,stdio:['ignore','pipe','pipe']});const done=completion(child);child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});waitBegin(directory.path);busy(2000);assert.equal(existsSync(join(directory.path,'done')),false,'control should still be waiting for pipe drainage');assert.deepEqual(await done,{code:0,signal:null});assert.ok(JSON.parse(readFileSync(join(directory.path,'done'),'utf8')).writeMs>=1800);
 }finally{directory.clean();}
});
test('after-exit parsing preserves native event clocks, UTF-8 and unterminated errors',()=>{
 const result=parseSurfaceNativeLogs('banner\n{"event":"capture","tickMs":123,"name":"été"}\n','SCRIPT ERROR: toit');assert.deepEqual(result.events,[{event:'capture',tickMs:123,name:'été'}]);assert.deepEqual(result.errors,[{stream:'stderr',line:'SCRIPT ERROR: toit'}]);
});
