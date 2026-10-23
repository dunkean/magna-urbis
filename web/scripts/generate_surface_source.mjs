/** Fresh Infinite Generation proof. Run with node --import tsx; no source substitution.
 * Optional native E2E: --decoder-model original --viewer-godot C:/tools/Godot.exe
 * --viewer-assets C:/data/resolved.json --viewer-launcher ROOT/web/scripts/surface_viewer.mjs
 * --geology-scenario tilted-strata-v1 opts into an explicit fixed world-space scenario.
 * --viewer-resolution 2048x1280. Browser/SSE/worker stay alive until the seven-level tour exits. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createWriteStream, existsSync,writeFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import { decodeSurfaceBinary, encodeSurfaceBinary } from '../src/surface/binary.ts';
import { compileSurfaceWorld } from '../src/surface/compiler.ts';
import { hashString } from '../src/surface/model.ts';
import { registrationFieldFingerprint } from '../src/surface/registrationBinding.ts';
import { isFinalQualityDisplay,verifyFinalDisplay,verifyMotionLiveDisplay,verifyTourQuality } from './surface_navigation_evidence.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name); if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
};
const base = option('--url', 'http://127.0.0.1:5197').replace(/\/$/, '');
const neural = option('--neural', 'http://127.0.0.1:8893').replace(/\/$/, '');
const width = Number(option('--width', '40000')), seed = option('--seed', 'surface-proof-40km');
const decoderModel = option('--decoder-model', undefined);
const geologyScenario = option('--geology-scenario', undefined);
if(geologyScenario!==undefined&&geologyScenario!=='tilted-strata-v1')throw new Error('Only the explicit tilted-strata-v1 geological scenario is supported by this driver');
const timeoutMs = Number(option('--timeout-ms', '900000'));
const out = resolve(option('--out', 'out/surface/real40km'));
const viewerGodot = option('--viewer-godot', undefined), viewerAssets = option('--viewer-assets', undefined);
const viewerLauncher = resolve(option('--viewer-launcher', fileURLToPath(new URL('./surface_viewer.mjs', import.meta.url))));
const viewerTimeoutMs = Number(option('--viewer-timeout-ms', '900000'));
const viewerResolution = option('--viewer-resolution', '2048x1280');
const navigationSeconds=Number(option('--viewer-navigation-seconds','0'));
if(!Number.isFinite(navigationSeconds)||navigationSeconds!==0&&(navigationSeconds<5||navigationSeconds>120)||navigationSeconds&&!viewerGodot)throw new Error('Navigation requires --viewer-godot and duration5..120 seconds');
if (viewerGodot && (!existsSync(viewerGodot) || !existsSync(viewerLauncher) || viewerAssets && !existsSync(viewerAssets)
  || !/^\d+x\d+$/.test(viewerResolution) || Number(viewerResolution.split('x')[0]) < 2000 || !(viewerTimeoutMs > 0))) throw new Error('Invalid viewer executable/launcher/assets/resolution/timeout (width must be >=2000 pixels for the 10m/5mm proof)');
if (!Number.isFinite(width) || width < 500 || width > 100000 || !(timeoutMs > 0)) throw new Error('Invalid source dimensions/timeout');
await mkdir(out, { recursive: true });
const began = Date.now(), errors = [], network = [], progress = [], sessions = [], browserEvents = [];
const paths = { report: resolve(out, 'report.json'), progress: resolve(out, 'progress.json'), screenshot: resolve(out, 'fresh-source.png'),
  source: resolve(out, 'fresh-source.surfacebin'), live: resolve(out, 'live-refinement.surfacebin'), neuralHeightfield: resolve(out, 'fresh-neural-heightfield.f32') };
const report = { format: 'magna-fresh-source-proof', version: 1, startedAt: new Date(began).toISOString(), base, neural, widthM: width, seed,
  requestedSource: 'neural-python', freshGeneration: true, paths, errors, network, progress, status: 'starting' };
report.browserEvents = browserEvents;
report.driverProcessId=process.pid;
if(viewerGodot)report.requestedViewer={godot:resolve(viewerGodot),assets:viewerAssets&&resolve(viewerAssets),launcher:viewerLauncher,
  resolution:viewerResolution,mode:args.includes('--viewer-oblique')?'oblique':'top',presentation:'aerial',timeoutMs:viewerTimeoutMs};
if(geologyScenario)report.requestedGeology={id:geologyScenario,queryParameter:'surface_geology',provenance:'Explicit authored preset, fixed world frame; not observed geological data or a terrain-height modification.'};
if (decoderModel) report.requestedModels = { decoderModel };
const snapshotFiles=['viewer-local/scene/main.gd','viewer-local/adapters/surface_data.gd','viewer-local/adapters/surface_geometry.gd',
  'viewer-local/shaders/surface_body.gdshaderinc','viewer-local/shaders/canopy.gdshaderinc','web/src/surface/model.ts','web/src/surface/compiler.ts',
  'web/src/surface/geologyScenario.ts','web/src/surface/geometryDetail.ts','web/src/surface/workerProcessor.ts',
  'web/src/ui/surfaceLiveSession.ts','web/src/ui/surfaceWorkerSource.ts','web/src/ui/terrainbench.ts','web/scripts/surface_live_plugin.ts'];
const snapshotRoot=resolve(dirname(viewerLauncher),'../..');
async function repositorySnapshot(){
  const git=args=>{const r=spawnSync('git',['-C',snapshotRoot,...args],{windowsHide:true,encoding:'utf8'});return r.status===0?r.stdout.trim():`unavailable: ${r.stderr?.trim()??r.error??r.status}`;};
  const files=Object.fromEntries(await Promise.all(snapshotFiles.map(async name=>{try{return[name,createHash('sha256').update(await readFile(resolve(snapshotRoot,name))).digest('hex')];}catch(error){return[name,`unavailable: ${error.code??String(error)}`];}})));
  return{root:snapshotRoot,head:git(['rev-parse','HEAD']),status:git(['status','--porcelain','--untracked-files=normal']),files};
}
report.code={driver:{path:fileURLToPath(import.meta.url),sha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')},
  selectedRepository:await repositorySnapshot(),serviceRelationship:'The selected viewer repository is expected to serve the supplied Vite URL; the endpoint does not independently attest its Git revision.'};
let saveQueue = Promise.resolve();
const save = () => { const snapshot=JSON.stringify(report,null,2);saveQueue=saveQueue.then(()=>writeFile(paths.report,snapshot));return saveQueue; };
let viewerProcess;
const stopViewer = () => {
  if (!viewerProcess?.pid || viewerProcess.exitCode !== null || viewerProcess.signalCode !== null) return;
  // The launcher owns a synchronous Godot child: stop this task's complete process
  // tree on cancellation rather than abandoning a renderer after closing its browser.
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(viewerProcess.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-viewerProcess.pid, 'SIGTERM'); } catch {} }
};
// Observe fatal tooling errors without pretending the corrupted process can
// recover. The default uncaught-exception exit remains enabled; persist its
// exact cause synchronously and stop only this driver's owned renderer tree.
const unexpectedFailure=(error,origin)=>{
  report.status='failed';report.failure=String(error);report.unexpectedDriverFailure={origin,message:String(error),stack:error?.stack,elapsedMs:Date.now()-began};
  for(const phase of [report.viewer,report.navigation])if(phase?.status==='running')phase.status='failed';
  try{writeFileSync(paths.report,JSON.stringify(report,null,2));}catch{}
  stopViewer();
};
process.on('uncaughtExceptionMonitor',unexpectedFailure);
async function runNativeTour(sessionId) {
  const directory=resolve(out,'native-tour');await mkdir(directory,{recursive:true});
  const logPath=resolve(directory,'stdout.log'),errorPath=resolve(directory,'stderr.log'),metricsPath=resolve(directory,'metrics.json');
  const widths=[40000,10000,2560,640,160,40,10],events=[],nativeErrors=[];
  const command=[viewerLauncher,'--godot',resolve(viewerGodot),'--world',paths.source,'--live-url',`${base}/surface-live/terrain`,
    '--session-id',sessionId,'--tour',directory,'--metrics',metricsPath,'--width','40000','--resolution',viewerResolution,'--presentation','aerial'];
  if(!args.includes('--viewer-oblique'))command.push('--top');
  if(viewerAssets)command.push('--assets',resolve(viewerAssets));
  report.viewer={status:'running',startedAt:new Date().toISOString(),startedElapsedMs:Date.now()-began,sessionId,
    command:[process.execPath,...command],paths:{directory,stdout:logPath,stderr:errorPath,metrics:metricsPath},events,errors:nativeErrors,
    browserHeldOpen:true,sourcePacket:paths.source,manualPacketSwaps:false};
  report.status='native-tour';await save();
  console.log(`Native live tour: ${JSON.stringify(report.viewer.command)}`);
  const stdout=createWriteStream(logPath),stderr=createWriteStream(errorPath),buffers={stdout:'',stderr:''};
  const capture=(kind,chunk)=>{
    (kind==='stdout'?stdout:stderr).write(chunk);buffers[kind]+=chunk.toString();
    const lines=buffers[kind].split(/\r?\n/);buffers[kind]=lines.pop();
    for(const line of lines){
      if(/(?:SCRIPT|SHADER) ERROR|ERROR:|Live terrain unavailable/.test(line))nativeErrors.push({stream:kind,line,elapsedMs:Date.now()-began});
      try{const event=JSON.parse(line);if(event.event){events.push({...event,elapsedMs:Date.now()-began});console.log(JSON.stringify({native:event}));}}catch{}
    }
  };
  let timeout,progressTimer;
  try{
    const completed=new Promise((done,fail)=>{
      viewerProcess=spawn(process.execPath,command,{windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
      report.viewer.processId=viewerProcess.pid;
      viewerProcess.stdout.on('data',chunk=>capture('stdout',chunk));viewerProcess.stderr.on('data',chunk=>capture('stderr',chunk));
      viewerProcess.once('error',fail);
      viewerProcess.once('close',(code,signal)=>done({code,signal}));
      timeout=setTimeout(()=>{report.viewer.timedOut=true;stopViewer();},viewerTimeoutMs);
      progressTimer=setInterval(()=>{void(async()=>{report.viewer.elapsedMs=Date.now()-began-report.viewer.startedElapsedMs;
        report.viewer.latestService=await serviceStatus();await save();console.log(JSON.stringify({nativeProgress:{elapsedMs:report.viewer.elapsedMs,events:events.length,
          workerPackets:browserEvents.filter(e=>e.kind==='worker-compiled'&&e.elapsedMs>=report.viewer.startedElapsedMs).length,service:report.viewer.latestService}}));})().catch(error=>console.error(String(error)));},10000);
    });
    const result=await completed;Object.assign(report.viewer,result);
    if(report.viewer.timedOut)throw new Error(`Native tour exceeded ${viewerTimeoutMs}ms; its own process tree was stopped`);
    if(result.code!==0)throw new Error(`Native tour exited ${result.code}, signal=${result.signal}`);
  }finally{
    clearTimeout(timeout);clearInterval(progressTimer);stopViewer();stdout.end();stderr.end();await Promise.all([finished(stdout),finished(stderr)]);
    for(const kind of ['stdout','stderr'])if(buffers[kind]&&/(?:SCRIPT|SHADER) ERROR|ERROR:|Live terrain unavailable/.test(buffers[kind]))nativeErrors.push({stream:kind,line:buffers[kind]});
    report.viewer.elapsedMs=Date.now()-began-report.viewer.startedElapsedMs;
  }
  report.viewer.metrics=JSON.parse(await readFile(metricsPath,'utf8'));
  const names=await readdir(directory),mode=args.includes('--viewer-oblique')?'oblique':'top';
  report.viewer.captures=[];
  for(let i=0;i<widths.length;i++){
    const name=`${String(i).padStart(2,'0')}_${widths[i]}m_${mode}.png`;
    if(!names.includes(name))throw new Error(`Native live tour did not capture ${name}`);
    const path=resolve(directory,name),bytes=await readFile(path);
    if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error(`Invalid PNG native capture ${name}`);
    report.viewer.captures.push({path,widthM:widths[i],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const relevant=browserEvents.filter(e=>e.elapsedMs>=report.viewer.startedElapsedMs),packets=relevant.filter(e=>e.kind==='worker-compiled');
  const requests=relevant.filter(e=>e.kind==='broker-terrain'),replies=relevant.filter(e=>e.kind==='broker-reply');
  const tiles=network.filter(e=>e.elapsedMs>=report.viewer.startedElapsedMs&&e.url?.includes('/refinement/tile'));
  report.viewer.endToEnd={nativeCaptures:report.viewer.captures.length,brokerRequests:requests.length,browserWorkerPackets:packets.length,
    acceptedBinaryReplies:replies.filter(e=>e.contentType?.startsWith('application/octet-stream')&&e.result?.accepted).length,pythonTiles:tiles.length,
    decoderBackedPythonTiles:tiles.filter(e=>e.meta?.decoderUsed===true).length,environmentVersions:[...new Set(packets.map(e=>e.environmentVersion))],
    canonicalBuildCounts:[...new Set(packets.map(e=>e.canonicalBuildCount))],sourceIds:[...new Set(packets.map(e=>e.packet?.terrain.source.id))],
    sourceEpochs:[...new Set(packets.map(e=>e.sourceEpoch))],parentReconstructions:[...new Set(packets.map(e=>e.packet?.boundary?.parentReconstruction).filter(Boolean))]};
  const captures=events.filter(e=>e.event==='capture'),near=captures.find(e=>e.widthM===10);
  if(captures.length!==7||captures.some((e,i)=>e.widthM!==widths[i]||e.error!==0))throw new Error('Native tour did not record seven successful new captures in the required scale order');
  const nativeAccepted=report.viewer.metrics.liveAcceptance??[],nativeRendered=report.viewer.metrics.renderEvents??[];
  report.viewer.cameraSatisfaction=verifyTourQuality(captures);
  for(const capture of captures){
    const display=capture.renderedSnapshot;
    const sourcePacket=packets.find(e=>e.packet?.worldId===display?.worldId)?.packet;
    if(!isFinalQualityDisplay(display)||!nativeAccepted.some(e=>e.request?.preview===false&&e.request?.resolution===512&&e.worldId===display.worldId&&e.requestSerial===display.liveSerial&&e.sourceEpoch===display.sourceEpoch&&e.sceneEpoch===display.sceneEpoch)
      ||!nativeRendered.some(e=>isFinalQualityDisplay(e)&&e.worldId===display.worldId&&e.liveSerial===display.liveSerial&&e.appliedTickMs===display.appliedTickMs)
      ||!packets.some(e=>e.packet?.worldId===display.worldId))throw new Error(`Native ${capture.widthM}m capture was not linked to a displayed live source packet`);
    if(capture.viewSatisfaction.deliveredSpacingM!==sourcePacket.terrain.spacingM)throw new Error(`Native ${capture.widthM}m cache density differed from the actual source grid`);
  }
  const loadedBinding=report.viewer.metrics.loadedLiveBinding;
  if(loadedBinding?.fingerprint!==report.source.canonicalFieldFingerprint||loadedBinding.n!==report.source.grid.width
    ||loadedBinding.widthM!==width||loadedBinding.error)throw new Error('Native loaded-world binding did not match the exported height content');
  report.viewer.nearMetresPerPixel=near?.metresPerPixel??10/Number(report.viewer.metrics.resolution?.[0]);
  if(nativeErrors.length)throw new Error('Native renderer or live transport reported errors; see native-tour/stderr.log and report.viewer.errors');
  if(!requests.length||!packets.length||!report.viewer.endToEnd.acceptedBinaryReplies||!tiles.some(e=>e.meta?.decoderUsed===true))throw new Error('Native tour did not prove the live broker, browser worker and decoder-backed Python source');
  if(packets.some(e=>e.packet?.source.registrationBinding?.expectedSourceId!==e.packet?.terrain.source.id)||new Set(packets.map(e=>e.sourceEpoch)).size!==1
    ||new Set(packets.map(e=>e.environmentVersion)).size!==1||packets.some(e=>e.canonicalBuildCount!==1))throw new Error('Native live tour changed source lineage or recompiled camera-dependent canonical context');
  if(packets.some(e=>e.packet?.source.registrationBinding?.canonicalFieldFingerprint!==report.source.canonicalFieldFingerprint))throw new Error('Native source registration differs from the exact loaded export heightfield');
  if(!report.viewer.metrics.source?.sourceLODKnown)throw new Error('Final native terrain still has unknown sourceLOD; a live patch was not applied');
  if(geologyScenario&&packets.some(e=>JSON.stringify(e.packet?.geologyScenario)!==JSON.stringify(report.source.geologyScenario)))throw new Error('Native zoom changed or lost the explicit fixed geological scenario descriptor');
  if(!(report.viewer.nearMetresPerPixel<=.005))throw new Error(`10m native capture did not reach 5mm/pixel: ${report.viewer.nearMetresPerPixel}`);
  if(network.some(e=>e.elapsedMs>=report.viewer.startedElapsedMs&&e.url?.includes('/generate?')))throw new Error('Native navigation regenerated its parent source instead of refining the retained generation');
  if(relevant.some(e=>e.kind==='worker-proof-error'||e.kind==='worker-error')||errors.some(e=>e.type==='pageerror'))throw new Error('Browser worker or source page failed during the native live tour');
  report.viewer.status='complete';await save();
}
async function runNativeNavigation(sessionId) {
  const directory=resolve(out,'native-navigation');await mkdir(directory,{recursive:true});
  const project=resolve(dirname(viewerLauncher),'../../viewer-local'),probe=resolve(project,'diagnostics/navigation_probe.gd');
  if(!existsSync(probe))throw new Error(`Continuous navigation probe missing from selected native snapshot: ${probe}`);
  const paths={directory,stdout:resolve(directory,'stdout.log'),stderr:resolve(directory,'stderr.log'),metrics:resolve(directory,'metrics.json'),report:resolve(directory,'navigation-report.json')};
  const command=['--path',project,'--script','res://diagnostics/navigation_probe.gd','--','--world',report.paths.source,
    '--live-url',`${base}/surface-live/terrain`,'--session-id',sessionId,'--width','40000','--resolution',viewerResolution,
    '--presentation','aerial','--metrics',paths.metrics,'--navigation-seconds',String(navigationSeconds),'--navigation-report',paths.report];
  if(!args.includes('--viewer-oblique'))command.push('--top');if(viewerAssets)command.push('--assets',resolve(viewerAssets));
  const phase={status:'running',startedElapsedMs:Date.now()-began,paths,command:[resolve(viewerGodot),...command],browserHeldOpen:true};report.navigation=phase;report.status='native-navigation';await save();
  const stdout=createWriteStream(paths.stdout),stderr=createWriteStream(paths.stderr);let timeout;
  try{
    const completed=new Promise((done,fail)=>{
      viewerProcess=spawn(resolve(viewerGodot),command,{windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
      phase.processId=viewerProcess.pid;
      viewerProcess.stdout.on('data',chunk=>stdout.write(chunk));viewerProcess.stderr.on('data',chunk=>stderr.write(chunk));
      viewerProcess.once('error',fail);viewerProcess.once('close',(code,signal)=>done({code,signal}));
      timeout=setTimeout(()=>{phase.timedOut=true;stopViewer();},viewerTimeoutMs);
    });
    Object.assign(phase,await completed);
  }finally{clearTimeout(timeout);stopViewer();stdout.end();stderr.end();await Promise.all([finished(stdout),finished(stderr)]);}
  phase.elapsedMs=Date.now()-began-phase.startedElapsedMs;
  if(existsSync(paths.report))phase.result=JSON.parse(await readFile(paths.report,'utf8'));
  if(existsSync(paths.metrics))phase.metrics=JSON.parse(await readFile(paths.metrics,'utf8'));
  if(phase.result?.continuousSeconds!==navigationSeconds||phase.result.motionEndTickMs-phase.result.motionStartTickMs!==Math.round(navigationSeconds*1000))throw new Error('Navigation proof changed its requested nominal motion duration');
  try{phase.displayEvidence=verifyMotionLiveDisplay(phase.result,phase.metrics);phase.finalDisplayEvidence=verifyFinalDisplay(phase.result,phase.metrics);}catch(error){phase.displayEvidenceFailure=String(error);}
  if(phase.metrics.loadedLiveBinding?.fingerprint!==report.source.canonicalFieldFingerprint||phase.metrics.loadedLiveBinding?.error)throw new Error('Native navigation loaded a different source heightfield');
  const relevant=browserEvents.filter(e=>e.elapsedMs>=phase.startedElapsedMs),packets=relevant.filter(e=>e.kind==='worker-compiled');
  phase.workerPackets=packets.length;phase.environmentVersions=[...new Set(packets.map(e=>e.environmentVersion))];
  phase.canonicalBuildCounts=[...new Set(packets.map(e=>e.canonicalBuildCount))];
  phase.requestQuality=packets.map(e=>({worldId:e.packet?.worldId,preview:e.packet?.source.request?.preview,requestedResolution:e.packet?.source.request?.resolution,
    deliveredGrid:e.packet?.terrain&&{width:e.packet.terrain.width,height:e.packet.terrain.height,spacingM:e.packet.terrain.spacingM},nativeSpacingM:e.packet?.terrain.source.nativeSpacingM}));
  phase.pythonTiles=network.filter(e=>e.elapsedMs>=phase.startedElapsedMs&&e.url?.includes('/refinement/tile')).length;
  const logs=await Promise.all([readFile(paths.stdout,'utf8'),readFile(paths.stderr,'utf8')]);
  const unavailable=logs.join('\n').split(/\r?\n/).filter(line=>line.includes('Live terrain unavailable'));
  phase.expectedCancellationWarnings=unavailable.filter(line=>/HTTP (409|499)\b/.test(line)).length;
  phase.discardedLiveReplies=(logs.join('\n').match(/Discarded superseded live terrain response/g)??[]).length;
  phase.workerErrors=relevant.filter(e=>e.kind==='worker-error'&&e.error?.name!=='AbortError'||e.kind==='worker-proof-error');
  await save();
  if(phase.timedOut||phase.code!==0||phase.result?.status!=='complete'||!phase.result?.sourceReplacedWhileMoving
    ||phase.displayEvidenceFailure||logs.some(log=>/(?:SCRIPT|SHADER) ERROR|ERROR:/.test(log))||unavailable.some(line=>!/HTTP (409|499)\b/.test(line))||phase.workerErrors.length)throw new Error(`Continuous native navigation did not display verified live source during input: ${phase.displayEvidenceFailure??'see native-navigation reports/logs'}`);
  if(!packets.length||phase.environmentVersions.length!==1||packets.some(e=>e.canonicalBuildCount!==1)
    ||packets.some(e=>e.packet?.source.registrationBinding?.canonicalFieldFingerprint!==report.source.canonicalFieldFingerprint)
    ||phase.environmentVersions[0]!==report.viewer.endToEnd.environmentVersions[0]
    ||geologyScenario&&packets.some(e=>JSON.stringify(e.packet?.geologyScenario)!==JSON.stringify(report.source.geologyScenario))
    ||network.some(e=>e.elapsedMs>=phase.startedElapsedMs&&e.url?.includes('/generate?')))throw new Error('Continuous native navigation changed canonical context or regenerated source');
  phase.status='complete';await save();
}
const serviceStatus = async () => {
  try { return await fetch(`${neural}/status`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()); }
  catch (error) { return { error: String(error) }; }
};
const summarizeBody = value => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.length > 16 ? { type: 'array', length: value.length, first: value.slice(0, 4) } : value.map(summarizeBody);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'heights' ? `<${String(entry).length} base64 chars>` : summarizeBody(entry)]));
};
report.initialService = await serviceStatus(); await save();
const cachedBrowser = process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe');
const browser = await chromium.launch({ ...(cachedBrowser && existsSync(cachedBrowser) ? { executablePath: cachedBrowser } : { channel: option('--channel', 'msedge') }),
  headless: true, args: ['--use-angle=swiftshader'] });
const interrupted = () => { report.interrupted = true; stopViewer(); void browser.close(); };
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  // Other agents may edit the dev checkout during this proof. Ignore development hot reloads in this isolated tab only.
  report.suppressedDevelopmentUpdates = 0;
  await page.routeWebSocket(url => url.host === new URL(base).host, route => {
    const server = route.connectToServer();
    server.onMessage(message => {
      let event; try { event = JSON.parse(String(message)); } catch {}
      if (event?.type === 'full-reload' || event?.type === 'update') { report.suppressedDevelopmentUpdates++; return; }
      route.send(message);
    });
  });
  await page.exposeFunction('recordFreshSurfaceSession', sessionId => { sessions.push(sessionId); console.log(`Live source session: ${sessionId}`); });
  await page.exposeFunction('recordFreshSurfaceEvent', event => { browserEvents.push({ elapsedMs: Date.now() - began, ...event }); });
  await page.addInitScript(() => {
    const emit = event => { void window.recordFreshSurfaceEvent(event).catch(() => {}); };
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...options) {
        super(...options);
        this.addEventListener('ready', event => { try { window.recordFreshSurfaceSession(JSON.parse(event.data).sessionId); } catch {} });
        for (const kind of ['terrain', 'cancel']) this.addEventListener(kind, event => { try { emit({ kind: `broker-${kind}`, ...JSON.parse(event.data) }); } catch {} });
      }
    };
    // Inspect only the small binary manifest and parent height controls, without
    // cloning the large SurfaceWorld or interfering with transferred buffers.
    let retainedParent;
    const sampleHeight = (t, x, z) => {
      const gx = Math.max(0, Math.min(t.width - 1, (x - t.originX) / t.spacingM)), gz = Math.max(0, Math.min(t.height - 1, (z - t.originZ) / t.spacingM));
      const ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
      const at = (a, b) => t.heights[Math.max(0, Math.min(t.height - 1, b)) * t.width + Math.max(0, Math.min(t.width - 1, a))];
      if (t.reconstruction !== 'cubic-bspline-controls') return (at(ix, iz) * (1-u) + at(ix+1, iz) * u) * (1-v) + (at(ix, iz+1) * (1-u) + at(ix+1, iz+1) * u) * v;
      const weights = f => [(1-f)**3/6, (3*f**3-6*f*f+4)/6, (-3*f**3+3*f*f+3*f+1)/6, f**3/6];
      const wx = weights(u), wz = weights(v); let result = 0;
      for (let b=0;b<4;b++) for(let a=0;a<4;a++) result += at(ix+a-1,iz+b-1)*wx[a]*wz[b];
      return result;
    };
    const summarizeBinary = binary => {
      if (!(binary instanceof ArrayBuffer) || binary.byteLength < 16) return undefined;
      const view = new DataView(binary), length = view.getUint32(8, true), start = Math.ceil((16 + length) / 8) * 8;
      const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(binary, 16, length))), packet = manifest.value, t = packet.world.terrain;
      const values = path => { const d = manifest.arrays.find(a => a.path.join('.') === path); return d?.dtype === 'f32' ? new Float32Array(binary, start+d.offset, d.length) : undefined; };
      const parent = packet.terrainParents?.[0]?.terrain, parentValues = values('terrainParents.0.terrain.heights');
      if (parent && parentValues) retainedParent = { ...parent, heights: new Float32Array(parentValues) };
      const heights = values('world.terrain.heights'); let boundary;
      if (heights && retainedParent?.source.id === t.source.id && retainedParent.source.version === t.source.version) {
        const fine = { ...t, heights }; let sum = 0, max = 0, count = 0;
        for (let edge=0;edge<4;edge++) for(let i=0;i<17;i++) {
          const u=i/16, x=t.originX+(edge<2?u*(t.width-1):(edge===2?0:t.width-1))*t.spacingM;
          const z=t.originZ+(edge>=2?u*(t.height-1):(edge===0?0:t.height-1))*t.spacingM;
          const delta=sampleHeight(fine,x,z)-sampleHeight(retainedParent,x,z);sum+=delta*delta;max=Math.max(max,Math.abs(delta));count++;
        }
        boundary={samples:count,rawFineVsParentMaxAbsM:max,rawFineVsParentRmsM:Math.sqrt(sum/count),parentReconstruction:retainedParent.reconstruction??'bilinear-samples',
          note:'Raw source boundary before viewer feathering; residual differences do not measure a displayed seam.'};
      }
      return { bytes:binary.byteLength, worldId:packet.world.id, terrain:{width:t.width,height:t.height,originX:t.originX,originZ:t.originZ,spacingM:t.spacingM,reconstruction:t.reconstruction,source:t.source},
        contextId:packet.world.canonicalContextRef?.id, includesCanonicalContext:!!packet.world.canonicalContext, parentTerrain:parent && {...parent,heights:undefined},geologyScenario:packet.world.geology?.scenario,
        source:{live:packet.source?.live,provider:packet.source?.provider,originalSource:packet.source?.originalSource,
          compilation:packet.source?.compilation,registrationBinding:packet.source?.registrationBinding,canonicalContextId:packet.source?.canonicalContextId,
          sceneContextId:packet.source?.sceneContextId,sourceEpoch:packet.source?.sourceEpoch,sceneEpoch:packet.source?.sceneEpoch,request:packet.source?.request},versions:packet.world.versions,boundary };
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...options) {
        super(...options); const workerURL=String(options[0]);emit({kind:'worker-created',workerURL});
        this.addEventListener('message', event => {
          const message=event.data;
          if (message?.kind==='compiled') {
            try { emit({kind:'worker-compiled',workerURL,requestId:message.requestId,sourceEpoch:message.sourceEpoch,sceneEpoch:message.sceneEpoch,
              environmentVersion:message.environmentVersion,canonicalBuildCount:message.canonicalBuildCount,packet:summarizeBinary(message.binary)}); }
            catch(error) { emit({kind:'worker-proof-error',message:String(error)}); }
          } else if(message?.kind==='error') emit({kind:'worker-error',workerURL,error:message.error});
        });
      }
    };
  });
  page.on('pageerror', error => { errors.push({ type: 'pageerror', message: String(error), elapsedMs: Date.now() - began }); console.error(String(error)); });
  page.on('console', message => {
    if (message.type() === 'error') { errors.push({ type: 'console', message: message.text(), elapsedMs: Date.now() - began }); console.error(message.text()); }
  });
  page.on('requestfailed', request => {
    const entry = { type: 'requestfailed', url: request.url(), message: request.failure()?.errorText, elapsedMs: Date.now() - began };
    network.push(entry); console.error(`${entry.url}: ${entry.message}`);
  });
  page.on('response', async response => {
    if (response.url().startsWith(`${base}/surface-live/reply/`)) {
      const request=response.request();
      browserEvents.push({kind:'broker-reply',elapsedMs:Date.now()-began,url:response.url(),status:response.status(),sessionId:request.headers()['x-surface-session'],
        contentType:request.headers()['content-type'],result:await response.json().catch(()=>undefined)});
      return;
    }
    if (!response.url().startsWith(neural) || response.url().endsWith('/status')) return;
    const entry = { url: response.url(), status: response.status(), elapsedMs: Date.now() - began };
    network.push(entry);
    try {
      const metadata = response.headers()['x-neural-meta'];
      if (metadata) entry.meta = JSON.parse(metadata);
      if (response.url().includes('/generate?') && response.ok() && !report.neuralOutput) {
        const bodyBytes = await response.body();
        if (bodyBytes.length !== 1024 * 1024 * 4) throw new Error('Fresh neural output is not a 1024² FP32 heightfield');
        await writeFile(paths.neuralHeightfield, bodyBytes);
        report.neuralOutput = { path: paths.neuralHeightfield, bytes: bodyBytes.length, width: 1024, height: 1024,
          extentM: 40000, sampleSpacingM: 40000 / 1024, sourceStage: 'raw Python neural response before Magna reconstruction/hydrology',
          sha256: createHash('sha256').update(bodyBytes).digest('hex'), meta: entry.meta };
      }
      if (response.url().includes('/refinement/register')) entry.registration = await response.json();
      const body = response.request().postData();
      if (body && body.startsWith('{')) entry.request = summarizeBody(JSON.parse(body));
      if (!response.ok()) entry.error = (await response.text()).slice(0, 12000);
      console.log(JSON.stringify({ sourceResponse: entry }));
    } catch (error) { entry.captureError = String(error); }
  });
  const query = new URLSearchParams({ standalone: '1', profile: 'web', source: 'neural-python', neural, width: String(width), seed,
    relief: 'mountains', climate: 'temperate', auto: '0', render: 'svg' });
  if (decoderModel) query.set('decoderModel', decoderModel);
  if(geologyScenario)query.set('surface_geology',geologyScenario);
  report.url = `${base}/terrainbench.html?${query}`;
  console.log(`Generating fresh ${width / 1000} × ${width / 1000} km source ${seed}…`);
  await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  report.status = 'generating'; await save();
  let generated = false;
  while (Date.now() - began < timeoutMs) {
    const state = await page.evaluate(() => ({ ready: typeof window.magnaBenchContext?.ready === 'function' && window.magnaBenchContext.ready(),
      neuralState: document.querySelector('#neuralState')?.textContent ?? '', status: document.querySelector('#status')?.textContent ?? '',
      pipelineStatus: document.querySelector('#pipelineStatus')?.textContent ?? '',
      hydroStatus: document.querySelector('#hydroStatus')?.textContent ?? '', exportPresent: !!document.querySelector('#pipelineSurface') }));
    const entry = { elapsedMs: Date.now() - began, ...state, service: await serviceStatus() };
    progress.push(entry); await writeFile(paths.progress, JSON.stringify(entry, null, 2)); await save();
    console.log(JSON.stringify({ progress: entry }));
    if (state.ready && state.exportPresent && entry.service.generated > report.initialService.generated) { generated = true; break; }
    if (state.ready && /Rust engine error:|runtime unavailable|Service unavailable|generation failed/i.test(state.status)) throw new Error(`Fresh generation failed: ${state.status}`);
    if (entry.service.state === 'error') throw new Error(`Neural source failed: ${entry.service.message}`);
    if (errors.some(error => error.type === 'pageerror')) throw new Error('Fresh terrain generation reported a browser runtime error');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!generated || !await page.evaluate(() => window.magnaBenchContext?.ready())) throw new Error('Fresh source generation timed out without an actual completed source calculation');
  await page.screenshot({ path: paths.screenshot, fullPage: false });
  const optionsSummary = page.locator('#pipelineTransfer details > summary');
  if (await optionsSummary.count()) await optionsSummary.click();
  console.log('Exporting fresh source as MUFSURF1…');
  const downloadPromise = page.waitForEvent('download', { timeout: 240000 });
  await page.locator('#pipelineSurface').click();
  const download = await downloadPromise; await download.saveAs(paths.source);
  const sourceBytes = await readFile(paths.source), packet = decodeSurfaceBinary(sourceBytes);
  const retainedWidth = packet.source.meta.width, sourceQuery = new URLSearchParams(packet.source.meta.query);
  if (retainedWidth !== width || packet.source.meta.seed !== seed || sourceQuery.get('source') !== 'neural-python') throw new Error('Exported source provenance does not match the requested fresh source');
  if(geologyScenario&&(sourceQuery.get('surface_geology')!==geologyScenario||packet.world.geology?.scenario?.id!==geologyScenario))throw new Error('Export lost or did not compile the explicitly requested geological scenario');
  const exportedTerrain=packet.world.terrain;
  if(exportedTerrain.width!==exportedTerrain.height||Math.abs(exportedTerrain.originX-exportedTerrain.spacingM/2)>1e-6||Math.abs(exportedTerrain.originZ-exportedTerrain.spacingM/2)>1e-6)throw new Error('Fresh E2E requires the full uncropped source frame');
  const canonicalFieldFingerprint=registrationFieldFingerprint({width:exportedTerrain.spacingM*exportedTerrain.width,n:exportedTerrain.width,data:exportedTerrain.heights});
  const retainedField=packet.source.retainedField;
  if(retainedField?.format!=='surface-retained-field'||retainedField.version!==1||retainedField.fingerprint!==canonicalFieldFingerprint
    ||retainedField.n!==exportedTerrain.width||retainedField.widthM!==width||packet.source.frame?.liveCompatible===false)throw new Error('Exported retained-field metadata or live frame did not match actual full-world height samples');
  let min = Infinity, max = -Infinity;
  for (const h of packet.world.terrain.heights) { if (!Number.isFinite(h)) throw new Error('Non-finite fresh source height'); min = Math.min(min, h); max = Math.max(max, h); }
  report.source = { id: packet.source.meta.id, created: packet.source.meta.created, query: packet.source.meta.query, bytes: sourceBytes.length,
    grid: { width: packet.world.terrain.width, height: packet.world.terrain.height, spacingM: packet.world.terrain.spacingM },
    sourceIdentity: packet.world.terrain.source, heightRangeM: { min, max }, diagnostics: packet.world.diagnostics,
    climate: packet.world.climate,canonicalFieldFingerprint,retainedField,frame:packet.source.frame,urbanId:packet.urbanId,
    geologyScenario:packet.world.geology?.scenario, buildings: packet.urban?.buildings?.length ?? packet.urban?.buildingCount ?? 0 };
  report.status = 'source-exported'; await save();
  if (args.includes('--native-packet')) {
    if (!report.neuralOutput) throw new Error('Cannot export a native packet without the actual captured neural response');
    const beganNative = performance.now(), raw = await readFile(paths.neuralHeightfield), n = 1024, spacingM = 40000 / n;
    const meta = report.neuralOutput.meta;
    const world = compileSurfaceWorld({ seed: parseInt(hashString(seed), 16), terrain: {
      width: n, height: n, spacingM, originX: spacingM / 2, originZ: spacingM / 2,
      heights: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)),
      source: { id: `neural-response:${meta.neuralToken}`, version: meta.modelIdentity,
        sourceLOD: 0, sourceLODKnown: false, nativeSpacingM: spacingM,
        provenance: `Exact fresh Python /generate 1024² FP32 response over 40 km, before Magna reconstruction/hydrology; sha256=${report.neuralOutput.sha256}; model=${JSON.stringify(meta.selectedModels)}` },
    }, climate: packet.world.climate, hydrology: { version: 'raw-neural-no-source-routing-1',
      provenance: 'Raw neural height response contains no Magna drainage graph; D8 fallback is explicit, no source water geometry is claimed', boundary: 'truncated' } });
    const copiedHash = createHash('sha256').update(new Uint8Array(world.terrain.heights.buffer)).digest('hex');
    if (copiedHash !== report.neuralOutput.sha256) throw new Error('Native packet changed source height samples');
    const nativePacket = { format: 'magna-surface-packet', version: 1, world,
      urban: { buildings: [], occupationBuildings: [], roads: [] }, candidates: [],
      source: { meta: { id: `raw-neural-${seed}`, seed, width: 40000, created: new Date().toISOString(), query: new URL(report.url).search.slice(1) },
        generation: meta, sourceStage: report.neuralOutput.sourceStage, heightfieldSha256: copiedHash,
        limitation: 'Independent raw-neural context for geometry stress. It does not claim the retained Magna hydrology or UI context.' } };
    const nativeBytes = encodeSurfaceBinary(nativePacket), path = resolve(out, 'raw-neural-1024.surfacebin');
    await writeFile(path, nativeBytes);
    report.nativePacket = { path, bytes: nativeBytes.length, grid: { width: n, height: n, spacingM }, sha256: copiedHash, durationMs: performance.now() - beganNative };
    console.log(JSON.stringify({ nativePacket: report.nativePacket })); await save();
  }
  if (!sessions.length) throw new Error('Fresh browser did not register its live source session');
  const region = { x: width / 2 - 20, y: width / 2 - 20, extent: 40, resolution: 64 };
  console.log('Refining the fresh source through its retained neural token and compiler worker…');
  const liveStarted = Date.now();
  const response = await fetch(`${base}/surface-live/terrain`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sessions.at(-1), region }), signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Fresh live refinement failed: ${response.status} ${await response.text()}`);
  const liveBytes = new Uint8Array(await response.arrayBuffer()); await writeFile(paths.live, liveBytes);
  const live = decodeSurfaceBinary(liveBytes);
  const registrations = network.filter(entry => entry.registration).map(entry => entry.registration);
  const decoderUsed = registrations.some(registration => registration.decoderUsed === true) || live.world.terrain.source.provenance?.includes('decoderUsed=true');
  report.live = { region, bytes: liveBytes.length, durationMs: Date.now() - liveStarted, source: live.world.terrain.source,
    grid: { width: live.world.terrain.width, height: live.world.terrain.height, spacingM: live.world.terrain.spacingM },
    contextId: live.world.canonicalContextRef?.id, includesCanonicalContext: !!live.world.canonicalContext, decoderUsed, registrations };
  if (!live.world.terrain.source.sourceLODKnown || !live.world.canonicalContext || !decoderUsed) throw new Error('Fresh refinement did not prove a decoder-backed source level and canonical context');
  if(viewerGodot)await runNativeTour(sessions.at(-1));
  if(navigationSeconds)await runNativeNavigation(sessions.at(-1));
  report.code.finalRepository=await repositorySnapshot();
  if(viewerGodot&&(report.code.finalRepository.head!==report.code.selectedRepository.head||JSON.stringify(report.code.finalRepository.files)!==JSON.stringify(report.code.selectedRepository.files)))throw new Error('Selected native/browser source snapshot changed during E2E; freeze the integration and rerun');
  report.finalService = await serviceStatus(); report.status = 'complete'; report.durationMs = Date.now() - began;
  await page.screenshot({ path: resolve(out, 'fresh-source-after-refinement.png') });
  await save(); console.log(JSON.stringify({ result: { status: report.status, durationMs: report.durationMs, widthM: width,
    sourceBytes: report.source.bytes, neuralOutput: report.neuralOutput, live: report.live, paths, errors } }));
} catch (error) {
  report.code.finalRepository??=await repositorySnapshot();
  for(const phase of [report.viewer,report.navigation])if(phase?.status==='running')phase.status='failed';
  report.status = 'failed'; report.failure = String(error); report.finalService = await serviceStatus(); report.durationMs = Date.now() - began;
  await save(); throw error;
} finally { stopViewer();await browser.close();process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);process.removeListener('uncaughtExceptionMonitor',unexpectedFailure); }
