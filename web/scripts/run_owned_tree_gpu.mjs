import{spawn,execFileSync}from'node:child_process';
import{openSync,closeSync}from'node:fs';
import{mkdir,writeFile}from'node:fs/promises';import path from'node:path';
const argv=process.argv.slice(2),at=argv.indexOf('--');if(at<0)throw Error('Expected -- <Godot args>');
const get=k=>{let i=argv.indexOf(k);if(i<0||i>=at)throw Error('Required '+k);return path.resolve(argv[i+1]);};
const executable=get('--godot'),owner=get('--owner-path'),out=get('--out'),args=argv.slice(at+1),normal=s=>s.replaceAll('\\','/').toLowerCase();
await mkdir(out,{recursive:true});
const ps='Get-CimInstance Win32_Process -Filter "Name LIKE \'Godot%\'" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress';
const processes=()=>{const raw=execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',windowsHide:true});let value=raw.trim()?JSON.parse(raw):[];return Array.isArray(value)?value:[value];};
const userOpen=rows=>rows.some(p=>normal(p.CommandLine??'').includes('magna-urbis-surface-demo-v15'));
let record={version:1,owner,executable,args,startedAt:new Date().toISOString(),status:'running',userPriority:true,checks:0,interruptedByUserDemo:false};
if(userOpen(processes())){record.status='incomplete-user-demo-already-open';await writeFile(path.join(out,'owned-process.json'),JSON.stringify(record,null,2));process.exit(85);}
const stdout=openSync(path.join(out,'stdout.log'),'w'),stderr=openSync(path.join(out,'stderr.log'),'w');
const child=spawn(executable,args,{cwd:owner,windowsHide:true,stdio:['ignore',stdout,stderr]});record.pid=child.pid;
let failure;
const watcher=setInterval(()=>{try{
 const rows=processes();record.checks++;
 if(!userOpen(rows))return;
 record.interruptedByUserDemo=true;record.status='incomplete-user-demo-handoff';
 const owned=new Set([child.pid]);let changed=true;
 while(changed){changed=false;for(let p of rows)if(owned.has(p.ParentProcessId)&&!owned.has(p.ProcessId)){owned.add(p.ProcessId);changed=true;}}
 // Never target a demo process, nor an arbitrary Godot process by name.
 const targets=rows.filter(p=>owned.has(p.ProcessId)&&normal(p.CommandLine??'').includes(normal(owner))&&!normal(p.CommandLine??'').includes('magna-urbis-surface-demo-v15'));
 record.terminatedOwnedProcesses=targets;
 for(let p of targets)execFileSync('powershell.exe',['-NoProfile','-Command',`Stop-Process -Id ${Number(p.ProcessId)} -ErrorAction SilentlyContinue`],{windowsHide:true});
 }catch(error){failure=String(error);record.status='incomplete-watchdog-error';child.kill();}},1000);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearInterval(watcher);closeSync(stdout);closeSync(stderr);
record.exitCode=code;record.finishedAt=new Date().toISOString();record.failure=failure;
if(!record.interruptedByUserDemo&&!failure)record.status=code===0?'process-completed':'process-failed';
await writeFile(path.join(out,'owned-process.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));process.exit(record.interruptedByUserDemo?85:failure?1:code??1);
