// Small frozen-site comparison. Never starts/stops a service or edits city inputs.
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2), opt=(k,d)=>{const i=args.indexOf(`--${k}`);return i<0?d:args[i+1]};
const out=resolve(opt('out','out/frontage-bastide-proof')), phase=opt('phase','before'), server=opt('server','http://127.0.0.1:8791').replace(/\/+$/,'');
if(!/^[a-z0-9-]+$/.test(phase))throw Error('Invalid phase');
mkdirSync(out,{recursive:true});
const json=p=>JSON.parse(readFileSync(p,'utf8')), save=(p,v)=>writeFileSync(`${out}/${p}`,JSON.stringify(v,null,2));
const sha=v=>createHash('sha256').update(v).digest('hex');
const post=async(route,body)=>{const response=await fetch(`${server}${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); const d=await response.json(); if(!response.ok||d.error||d.ok===false)throw Error(JSON.stringify(d));return d.data??d;};
if(args.includes('--capture')) {
  if(existsSync(`${out}/requests.json`))throw Error('Frozen corpus already exists; choose a new output folder.');
  const reference='out/city-visual-bench/37-paged8812', prepared=json(`${reference}/prepared.json`).cases[0], urban=prepared.settings.urban;
  const original=readFileSync(`${reference}/37-bastide-quarters-request.json`), quarters=JSON.parse(original);
  const decor=readFileSync(`decors/${prepared.artifact}.decor`), module=await tsImport('../../src/ui/decor.ts',import.meta.url);
  const raster=(module.decodeDecor?module:module.default).decodeDecor(new Uint8Array(decor)).raster;
  const session=randomUUID(), header=new TextEncoder().encode(JSON.stringify({session,width:raster.width,n:raster.n}));
  const padded=new Uint8Array(Math.ceil(header.length/4)*4).fill(32);padded.set(header);
  const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,padded.length,true);
  const bytes=a=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
  const provenance={captured:new Date().toISOString(),server,status:await(await fetch(`${server}/status`)).json(),reference,quartersSha256:sha(original),decor:prepared.artifact,decorSha256:sha(decor),settings:urban.buildingState.settings,parcelSeed:urban.parcelSeed,houseSeed:urban.buildingState.seed,limitations:['Urban inputs replayed on hash-identical frozen runtime; original output sites were not archived.','Only selected sites are planned; earlier unselected city buildings are not regenerated as neighbours. Existing site constraints and selected-site native batch order are retained.']};
  save('provenance.json',provenance);writeFileSync(`${out}/quarters-request.json`,original);
  try {
    const upload=await fetch(`${server}/raster`,{method:'POST',body:new Blob([length,padded,...['height','waterLevel','riverWidth','riverIds','water'].map(k=>bytes(raster[k]))])});
    if(!upload.ok)throw Error(await upload.text());
    const layout=await post('/urban',{...quarters,session});save('layouts.json',layout.layouts);
    const parcelsInput={id:2,kind:'parcels',seed:urban.parcelSeed,layoutsId:quarters.id,parcelConfig:urban.parcelConfig,session};
    save('parcels-request.json',parcelsInput);
    const parcels=await post('/urban',parcelsInput);save('partitions.json',parcels.partitions);
    const source=parcels.urbanSource, begin={kind:'buildingSitesBegin',source,seed:urban.buildingState.seed,keys:[urban.target]};
    const opened=await post('/urban',begin), requests=[];
    for(let offset=0;offset<opened.total;) {
      const page=await post('/urban',{kind:'buildingSitesPage',source,sourceId:opened.sourceId,offset,limit:64,maxBytes:24*1024*1024});
      if(page.next!==offset+page.placementRequests.length||page.next<=offset)throw Error('Invalid page');
      requests.push(...page.placementRequests);offset=page.next;
    }
    save('all-sites.json',requests);save('site-source.json',{begin,total:opened.total,source});
    console.log(JSON.stringify({capturedSites:requests.length,sourceKeys:Object.keys(parcels)}));
  } finally {await post('/release',{session});}
}
if(!existsSync(`${out}/requests.json`)) {
  const all=json(`${out}/all-sites.json`), provenance=json(`${out}/provenance.json`);
  const bounds=surface=>{const p=surface.flatMap(s=>s.outer);return [Math.min(...p.map(p=>p.x)),Math.min(...p.map(p=>p.y)),Math.max(...p.map(p=>p.x)),Math.max(...p.map(p=>p.y))]};
  const eligible=all.map((r,index)=>{
    const access=r.accesses.filter(a=>a.width_m>=.8).sort((a,b)=>Math.hypot(b.segment[1].x-b.segment[0].x,b.segment[1].y-b.segment[0].y)-Math.hypot(a.segment[1].x-a.segment[0].x,a.segment[1].y-a.segment[0].y))[0];
    if(!access)return null;
    const [a,b]=access.segment, length=Math.hypot(b.x-a.x,b.y-a.y), normal={x:-(b.y-a.y)/length,y:(b.x-a.x)/length};
    const projected=r.cadastral.flatMap(s=>s.outer).map(p=>(p.x-a.x)*normal.x+(p.y-a.y)*normal.y), depth=Math.max(...projected)-Math.min(...projected), box=bounds(r.cadastral);
    const gate=['domestic','mixed'].includes(r.function)&&!r.config?.recipe&&!r.config?.workshop&&!r.config?.overrides?.variant&&(r.programme?.composition==='row'||r.programme?.frontage_continuity>=.75);
    return {r,index,access:access.id,depth,frontLength:length,box,gate,centerDistance:Math.hypot((box[0]+box[2])/2-2000,(box[1]+box[3])/2-2000)};
  }).filter(Boolean);
  const candidates=eligible.filter(x=>x.gate&&x.depth>=20&&x.frontLength>=5);
  if(candidates.length<8)throw Error(`Only ${candidates.length} eligible deep sites; do not invent intent.`);
  // Four nearest centre, four deepest remaining, four multi-front then nearest.
  // Selection happens before any houses response; acceptance cannot bias it.
  const chosen=[],take=(ordered,n,reason)=>{for(const x of ordered)if(!chosen.some(y=>y.index===x.index)){chosen.push({...x,reason});if(--n===0)break;}};
  take([...candidates].sort((a,b)=>a.centerDistance-b.centerDistance||a.index-b.index),4,'near centre');
  take([...candidates].sort((a,b)=>b.depth-a.depth||a.index-b.index),4,'deepest eligible');
  take([...candidates].sort((a,b)=>b.r.accesses.length-a.r.accesses.length||a.centerDistance-b.centerDistance||a.index-b.index),4,'multiple accesses then central');
  chosen.sort((a,b)=>a.index-b.index);
  save('requests.json',{schema_version:'1',settings:provenance.settings,requests:chosen.map(x=>x.r)});
  save('selection.json',{totalSites:all.length,eligibleIntent:eligible.filter(x=>x.gate).length,deepEligible:candidates.length,rule:'Before plan generation: 4 central + 4 deepest + 4 multiple-access/central. Original source order retained.',sites:chosen.map(({r,...x},i)=>({...x,label:String(i+1).padStart(2,'0'),id:r.id,programme:r.programme,config:r.config,typology:r.typology,neighbors:r.neighbors.length}))});
  save('cameras.json',chosen.map(({r,box},i)=>({id:r.id,label:String(i+1).padStart(2,'0'),center:[(box[0]+box[2])/2,(box[1]+box[3])/2],mpp:Math.max((box[2]-box[0])/370,(box[3]-box[1])/350,.07),width:450,height:450})));
}
if(args.includes('--capture-only'))process.exit(0);
const requestBytes=readFileSync(`${out}/requests.json`), input=JSON.parse(requestBytes), phaseDir=`${out}/${phase}`;
mkdirSync(phaseDir,{recursive:true});
if(!args.includes('--render-only')) {
  if(existsSync(`${phaseDir}/plans.json`))throw Error('Phase already captured; use --render-only or a new phase.');
  const start=performance.now(),plans=await post('/houses/plans',input);
  writeFileSync(`${phaseDir}/plans.json`,JSON.stringify(plans));
  writeFileSync(`${phaseDir}/runtime.json`,JSON.stringify({server,status:await(await fetch(`${server}/status`)).json(),captured:new Date().toISOString(),requestSha256:sha(requestBytes),elapsedMs:performance.now()-start},null,2));
}
execFileSync('python',[resolve('scripts/frontage-bastide-proof/measure.py'),out,phase],{stdio:'inherit'});
const painterPath=`${out}/painter.js`;
if(!existsSync(painterPath))writeFileSync(painterPath,(await build({stdin:{contents:"import {UrbanBuildingLodRenderer} from './src/render/urbanBuildingLod.ts';globalThis.ProofRenderer=UrbanBuildingLodRenderer;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'msedge',headless:true,args:['--disable-gpu']});
try {
  const page=await browser.newPage({viewport:{width:1800,height:1480},deviceScaleFactor:1});
  await page.setContent('<!doctype html><style>body{margin:0;background:#f2ead8}canvas{display:block}</style><canvas width="1800" height="1480"></canvas>');
  await page.addScriptTag({content:readFileSync(painterPath,'utf8')});
  await page.evaluate(({input,plans,cameras,metrics,phase})=>{
    const ctx=document.querySelector('canvas').getContext('2d');ctx.fillStyle='#f2ead8';ctx.fillRect(0,0,1800,1480);
    ctx.fillStyle='#243437';ctx.font='bold 24px sans-serif';ctx.fillText(`Bastide 37 — ${phase} — frozen native sites`,24,32);ctx.font='17px sans-serif';ctx.fillText('Red = declared access · brown = body/roof · blue = court · dashed = buildable · green = reserve. Fixed world cameras.',24,61);
    const path=s=>{const p=new Path2D();for(const shape of s??[])for(const ring of [shape.outer,...shape.holes]){ring.forEach((v,i)=>i?p.lineTo(v.x,v.y):p.moveTo(v.x,v.y));p.closePath();}return p;};
    cameras.forEach((c,i)=>{
      const x=(i%4)*450,y=80+Math.floor(i/4)*465,m=metrics.sites[i],r=input.requests[i],b=plans.buildings.find(b=>b.id===c.id);
      const box={minX:c.center[0]-225*c.mpp,minY:c.center[1]-200*c.mpp,maxX:c.center[0]+225*c.mpp,maxY:c.center[1]+200*c.mpp};
      ctx.save();ctx.beginPath();ctx.rect(x,y,450,400);ctx.clip();ctx.translate(x,y);ctx.scale(1/c.mpp,1/c.mpp);ctx.translate(-box.minX,-box.minY);
      ctx.fillStyle='#fffaf0';ctx.strokeStyle='#66716a';ctx.lineWidth=c.mpp;ctx.fill(path(r.cadastral),'evenodd');ctx.stroke(path(r.cadastral));
      ctx.strokeStyle='#a6a393';ctx.setLineDash([3*c.mpp,3*c.mpp]);ctx.stroke(path(r.buildable));ctx.setLineDash([]);
      ctx.fillStyle='#b7cfab';ctx.fill(path(r.reserves),'evenodd');
      if(b){ctx.fillStyle='#b8d7dd';ctx.fill(path(b.courtyards),'evenodd');}
      new window.ProofRenderer({...plans,buildings:b?[b]:[]},{raster:false}).draw(ctx,{viewport:box,metresPerPixel:c.mpp,appearance:{style:'cartographic',diagnostic:'none'},useDetails:false});
      if(b){ctx.strokeStyle='#5c3b22';ctx.lineWidth=.8*c.mpp;ctx.stroke(path(b.footprint));}
      ctx.strokeStyle='#c64234';ctx.lineWidth=3*c.mpp;for(const access of r.accesses){ctx.beginPath();ctx.moveTo(access.segment[0].x,access.segment[0].y);ctx.lineTo(access.segment[1].x,access.segment[1].y);ctx.stroke();}
      ctx.restore();ctx.fillStyle='#243437';ctx.font='bold 16px sans-serif';ctx.fillText(`${c.label}  ${m.recipe??m.status}  ${m.variant??''}`,x+10,y+420);ctx.font='14px sans-serif';ctx.fillText(`body/front ${m.bodySetbackM?.toFixed(2)??'—'} m · court ${m.courtAreaM2?.toFixed(1)??'—'} m²`,x+10,y+441);
    });
  },{input,plans:json(`${phaseDir}/plans.json`),cameras:json(`${out}/cameras.json`),metrics:json(`${phaseDir}/metrics.json`),phase});
  await page.locator('canvas').screenshot({path:`${phaseDir}/contact-sheet.png`});
} finally {await browser.close();}
console.log(JSON.stringify({phase,output:phaseDir,requestSha256:sha(requestBytes),painterSha256:sha(readFileSync(painterPath))}));
