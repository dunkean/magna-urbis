// Rasterize retained vector banks with a display-only headwater emergence.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {HEADWATER_PROFILE,isHeadwater,headwaterGeometry,riverBankPath} from './river_headwaters.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {Resvg}=await import(pathToFileURL(path.join(root,'../web/node_modules/@resvg/resvg-js/index.js')));
const reference=path.resolve(root,'../../magna-urbis-render-original-reference');
const {tsImport}=await import(pathToFileURL(path.join(reference,'web/node_modules/tsx/dist/esm/api/index.mjs')));
const load=p=>tsImport(pathToFileURL(path.join(reference,p)).href,import.meta.url);
const {riverWidths}=await load('web/src/ui/vectorWaterRender.ts');
const {riverBank}=await load('rust/bridge/hydrologyRender.ts');
const sha=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2), only=args.includes('--tile')?args[args.indexOf('--tile')+1]:null;
const catalog=JSON.parse(await readFile(path.join(root,'tiles/catalog.json'),'utf8'));
for(const entry of catalog.tiles){
 if(only&&entry.id!==only)continue;
 const dir=path.join(root,'tiles',path.dirname(entry.file));
 const meta=JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8'));
 const networkBytes=await readFile(path.join(dir,meta.hydrology.network)),network=JSON.parse(networkBytes);
 const blob=gunzipSync(await readFile(path.join(dir,meta.hydrology.grids.file)));
 const field=name=>{const f=meta.hydrology.grids.fields[name];return new Uint8Array(blob.buffer,blob.byteOffset+f.offset,f.bytes);};
 const hydro={width:meta.width,n:meta.n,sea:field('sea'),lake:field('lake')};
 const water={hydro,rivers:network.rivers,lake:hydro.lake,widthScale:network.settings.widthScale};
 const lines=[...(network.rivers.oxbows??[]).map(l=>[l,1,false]),...(network.rivers.braids??[]).map(l=>[l,0,false]),...(network.rivers.distributaries??[]).map(l=>[l,0,false]),...network.rivers.rivers.map(l=>[l,0,true])];
 const sources=[];let banks='';
 for(const [line,thinner,main] of lines){
  const source=main&&isHeadwater(line,network.rivers,hydro,network.settings.riverArea*1e6);
  const widths=riverWidths(water,line,thinner),geometry=headwaterGeometry(line,widths,source);
  banks+=riverBankPath(geometry,riverBank);
  if(source)sources.push({id:line.id,x:line.points[0],y:line.points[1],reachMetres:geometry.reach,initialWidthMetres:widths[0],visibleSourceWidthMetres:geometry.widths[0]});
 }
 // Cosmetic hairline axes are deliberately excluded from the wet footprint.
 const white='<path d="'+banks+'" fill="white" stroke="none"/>';
 const image=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40000 40000">'+white+'</svg>',{fitTo:{mode:'width',value:4096}}).render().asPng();
 await writeFile(path.join(dir,'surface-river-footprint.png'),image);
 await writeFile(path.join(dir,'surface-river-footprint.json'),JSON.stringify({version:2,profile:HEADWATER_PROFILE,sourceNetworkSha256:sha(networkBytes),sha256:sha(image),sources,preserves:['network topology','retained water levels','full downstream widths','lake outlets','boundary inflows','braids and distributaries']},null,2));
 console.log('WATER MASK '+entry.id+' · '+sources.length+' tapered headwaters');
}
