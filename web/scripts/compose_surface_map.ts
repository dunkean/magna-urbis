/** Native TOP raster -> final shared SVG/PNG composition. Never launches Godot. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import { decodeSurfaceBinary } from '../src/surface/binary';
import { validateSurfacePacket } from '../src/surface/packet';
import { getCanonicalSurfaceContext } from '../src/surface/compiler';
import { composeSurfaceMap, type SurfaceMapCapture } from '../src/surface/mapComposition';
import { surfaceMapContent, nativeSurfaceMapCapture } from '../src/surface/adapters/mapComposition';
import { isMapStyle } from '../src/render/styles';

const args=process.argv.slice(2),option=(k:string)=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
const required=(k:string)=>{const v=option(k);if(!v)throw Error('Required '+k);return v;};
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const sourcePath=path.resolve(required('--source')),imagePath=path.resolve(required('--capture')),metricsPath=path.resolve(required('--metrics'));
const [sourceBytes,imageBytes,metricsBytes]=await Promise.all([readFile(sourcePath),readFile(imagePath),readFile(metricsPath)]);
const packet=decodeSurfaceBinary(sourceBytes);validateSurfacePacket(packet);
const metrics=JSON.parse(metricsBytes.toString('utf8'));
let binding:SurfaceMapCapture;
let proofSource:string;
if(option('--binding')){
  proofSource=path.resolve(required('--binding'));binding=JSON.parse(await readFile(proofSource,'utf8'));
}else{
  proofSource=path.resolve(required('--capture-proof'));
  const proof=JSON.parse(await readFile(proofSource,'utf8')),capture=proof.captures?.find((c:{name:string})=>c.name===required('--view'));
  if(!capture||capture.code!==0||capture.sourceUnchanged!==true)throw Error('No valid pinned native capture in proof');
  const cmd=capture.command as string[],value=(k:string)=>cmd[cmd.indexOf(k)+1];
  if(!cmd.includes('--top')&&!metrics.mapProjection)throw Error('Automatic metric composition requires explicit --top. Perspective needs --binding with actual worldToClip matrix or native mapProjection.');
  if(sha(sourceBytes)!==proof.sourceSha256||sha(imageBytes)!==capture.pngSha256||sha(metricsBytes)!==capture.metricsSha256)throw Error('Capture proof byte hashes do not match inputs');
  const widthM=Number(value('--width')),x=Number(value('--x')),z=Number(value('--z'));
  const W=imageBytes.readUInt32BE(16),H=imageBytes.readUInt32BE(20),heightM=widthM*H/W;
  const presentation=metrics.renderSourceVersion.presentation;
  const mapStyle=isMapStyle(presentation.mapStyle)?presentation.mapStyle:packet.presentation&&isMapStyle((packet.presentation as any).mapStyle)?(packet.presentation as any).mapStyle:'atlas';
  binding={format:'surface-map-capture',version:1,sourcePacketSha256:sha(sourceBytes),metricsSha256:sha(metricsBytes),imageSha256:sha(imageBytes),
    worldId:packet.world.id,canonicalContextId:getCanonicalSurfaceContext(packet.world).id,widthPx:W,heightPx:H,
    projection:{kind:'orthographic-top',bounds:{minX:x-widthM/2,maxX:x+widthM/2,minZ:z-heightM/2,maxZ:z+heightM/2},north:'local-negative-z'},
    presentation:presentation.mode,mapStyle};
  if(metrics.mapProjection)binding=nativeSurfaceMapCapture(binding,metrics.mapProjection);
}
if(metrics.mapProjection&&option('--binding')){
  const actual=nativeSurfaceMapCapture(binding,metrics.mapProjection);
  if(!isDeepStrictEqual(actual.projection,binding.projection))throw Error('Explicit binding differs from actual native projection');
  binding=actual;
}
if(sha(sourceBytes)!==binding.sourcePacketSha256||sha(metricsBytes)!==binding.metricsSha256||metrics.worldId!==binding.worldId
  ||metrics.renderedSnapshot?.worldId!==binding.worldId)throw Error('Source/metrics world binding mismatch');
if(metrics.renderSourceVersion.presentation.mode!==binding.presentation)throw Error('Capture presentation binding mismatch');
if(binding.presentation==='cartographic'&&metrics.renderSourceVersion.presentation.mapStyle!==binding.mapStyle)throw Error('Capture palette binding mismatch');
const requestedStyle=option('--style'),style=isMapStyle(requestedStyle)?requestedStyle:undefined;
if(requestedStyle!==undefined&&style===undefined)throw Error('Unknown shared map style');
const content=surfaceMapContent(packet as any,binding);
const composition=composeSurfaceMap(binding,imageBytes,content,{style,gridMeters:option('--grid-m')===undefined?undefined:Number(option('--grid-m'))});
const target=path.resolve(required('--out'));await mkdir(path.dirname(target),{recursive:true});
const png=new Resvg(composition.svg,{font:{loadSystemFonts:true}}).render().asPng();
await writeFile(target+'.svg',composition.svg);await writeFile(target+'.png',png);
const result={format:'surface-map-export-proof',version:1,proofSource,sourcePath,imagePath,metricsPath,binding,
  bindingProofSha256:sha(await readFile(proofSource)),sourcePacketBytes:sourceBytes.length,
  svgSha256:sha(Buffer.from(composition.svg)),pngSha256:sha(png),svgBytes:Buffer.byteLength(composition.svg),pngBytes:png.length,
  fontPolicy:'Existing shared system font stack, resolved locally by resvg; fonts are not embedded and pixel portability is not claimed.',
  rasterPolicy:'Original PNG embedded unchanged, not recolored or regenerated.',sourceLegendScope:'Native/road records in source packet; ground/cover counts are canonical support nodes overlapping the TOP frame, not area or GPU visibility.',
  evidence:composition.evidence};
await writeFile(target+'.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({out:target,labels:content.labels.length,placed:composition.evidence.placedLabelIds.length,legendEntries:content.legend.length,pngSha256:result.pngSha256}));
