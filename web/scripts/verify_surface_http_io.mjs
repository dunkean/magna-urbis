/** Replay a saved REAL packet through the pinned native HTTP client. No GPU or generation. */
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),at=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const godot=at('--godot',process.env.GODOT),packet=at('--packet'),out=resolve(at('--out','out/surface/http-io-proof'));
if(!godot||!packet)throw Error('Usage: verify_surface_http_io.mjs --godot PATH --packet REAL.surfacebin [--out DIRECTORY]');
const source=resolve(packet),size=(await stat(source)).size;
if(size<16||size>512*1024*1024)throw Error('Real source packet exceeds supported range');
const hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);const sha256=hash.digest('hex');
await mkdir(out,{recursive:true});
const server=createServer((req,res)=>{if(req.url!=='/packet.surfacebin'){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':String(size)});createReadStream(source).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const project=fileURLToPath(new URL('../../viewer-local/',import.meta.url)),reportPath=resolve(out,'report.json');let child,timer;
const stop=()=>{if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
  if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else try{process.kill(-child.pid,'SIGTERM');}catch{}};
try{
  const command=['--headless','--path',project,'--script','res://diagnostics/http_io_probe.gd','--',
    '--url',`http://127.0.0.1:${server.address().port}/packet.surfacebin`,'--expected-sha',sha256,'--expected-bytes',String(size),'--out',reportPath];
  let stdout='',stderr='';const result=await new Promise((done,fail)=>{child=spawn(godot,command,{windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.once('error',fail);child.once('close',(code,signal)=>done({code,signal}));timer=setTimeout(stop,305000);});
  await Promise.all([writeFile(resolve(out,'stdout.log'),stdout),writeFile(resolve(out,'stderr.log'),stderr)]);
  const report=JSON.parse(await readFile(reportPath,'utf8'));await writeFile(resolve(out,'source.json'),JSON.stringify({source,sourceBytes:size,sha256,command:[godot,...command],result},null,2));
  if(result.code!==0||!report.exact||/(?:SCRIPT|SHADER) ERROR|ERROR:/.test(stderr))throw Error('Native HTTP I/O proof failed; see report/logs');
  console.log(JSON.stringify(report));
}finally{clearTimeout(timer);stop();server.closeAllConnections();await new Promise(r=>server.close(r));}
