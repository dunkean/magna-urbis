/** Final map composition over a pinned renderer image. No world generation. */
import { PALETTES, isMapStyle, type MapStyle } from '../render/styles';
import { FONT_STACKS, kindStyles, streetRankStyle } from '../render/labelStyles';
import { frameModel } from '../render/frame';
import { niceLength, panelSvg, type Panel, type Prim } from '../render/legend';
import { placeMapLabels, estimateWidth, type MapLabel } from '../render/mapLabels';
import { placedMapLabelsSvg } from '../render/svgLabels';
import { pngDataUrl } from '../render/raster';
import type { NameEntry } from '../gen/names/types';
import type { Bounds } from './model';
import { SurfaceSha256 } from './sha256';

export interface NativeSurfaceMapProjection {
  format:'surface-map-projection'; version:1; worldId:string;
  projectionMode:'orthographic-top'|'perspective'; viewportPixels:{width:number;height:number};
  worldToClip:number[]; renderOrigin:{x:number;y:number;z:number}; clipRange:[-1,1]; focus:{x:number;z:number};
  uniformMetricScale:null|{metresPerPixel:number;bounds:Bounds;north:'local-negative-z'};
}
export interface SurfaceMapCapture {
  format: 'surface-map-capture'; version: 1;
  sourcePacketSha256: string; metricsSha256: string; imageSha256: string;
  worldId: string; canonicalContextId: string;
  widthPx: number; heightPx: number;
  /** Coordinates in the source packet world frame, never renderer-local origins. */
  projection: { kind: 'orthographic-top'; bounds: Bounds; north: 'local-negative-z' }
    | { kind: 'perspective'; worldToClip: number[]; renderOrigin:{x:number;y:number;z:number}; matrixLayout: 'column-major'; clipDepth: 'minus-one-to-one' | 'zero-to-one' };
  presentation: 'cartographic' | 'aerial'; mapStyle: MapStyle;
  nativeProjection?:NativeSurfaceMapProjection;
}
export interface SurfaceMapLabel extends NameEntry { sourcePath: string; elevationM?: number }
export interface SurfaceMapLegendEntry {
  id: string; text: string; sourcePath: string;
  semantic: 'native-buildings' | 'roads' | 'water' | 'trees' | 'low-cover' | 'ground-recipe';
  count: number;
  /** Scientific/count scope is metadata, separate from the visible caption. */
  qualification?: string;
}
export interface SurfaceMapContent {
  sourcePacketSha256: string; worldId: string;
  labels: SurfaceMapLabel[]; legend: SurfaceMapLegendEntry[];
}
export interface SurfaceMapOptions { style?: MapStyle; gridMeters?: number; title?: string }
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const hash = (bytes: Uint8Array) => new SurfaceSha256().update(bytes).hex();
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fail = (s: string): never => { throw new Error('Surface map composition: ' + s); };
const requireText = (v: unknown, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
function invertible(m: number[]): boolean {
  const rows=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>m[j*4+i]));
  for(let col=0;col<4;col++){
    let pivot=col;for(let row=col+1;row<4;row++)if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col]))pivot=row;
    if(rows[pivot][col]===0)return false;
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
    for(let row=col+1;row<4;row++){const f=rows[row][col]/rows[col][col];for(let j=col;j<4;j++)rows[row][j]-=f*rows[col][j];}
  }
  return rows.every(row=>row.every(finite));
}
export const surfaceMapMatrixValid=(m:unknown):m is number[]=>Array.isArray(m)&&m.length===16&&m.every(finite)&&invertible(m);

/** Hash and PNG dimensions are checked before any embedding. The CLI additionally
 * verifies the source packet and metrics byte hashes against the binding. */
export function composeSurfaceMap(capture: SurfaceMapCapture, png: Uint8Array, content: SurfaceMapContent, options: SurfaceMapOptions = {}) {
  if (capture.format !== 'surface-map-capture' || capture.version !== 1) fail('unsupported capture binding');
  for (const v of [capture.sourcePacketSha256, capture.metricsSha256, capture.imageSha256])
    if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('missing content hash');
  if (!requireText(capture.worldId) || !requireText(capture.canonicalContextId)
    || content.worldId !== capture.worldId || content.sourcePacketSha256 !== capture.sourcePacketSha256) fail('source frame identity mismatch');
  for (const v of [capture.widthPx, capture.heightPx]) if (!Number.isSafeInteger(v) || v < 256 || v > 16384) fail('unsupported image dimensions');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.length < 24 || png.length > 64 * 1024 ** 2 || [137,80,78,71,13,10,26,10].some((b,i)=>png[i]!==b)
    || dv.getUint32(16) !== capture.widthPx || dv.getUint32(20) !== capture.heightPx || hash(png) !== capture.imageSha256) fail('PNG identity or dimensions mismatch');
  const style = options.style ?? capture.mapStyle;
  if (!isMapStyle(style) || !isMapStyle(capture.mapStyle)) fail('unknown shared palette');
  const pal = PALETTES[style], family = FONT_STACKS[style], W = capture.widthPx, H = capture.heightPx;
  if(options.title!==undefined&&(!requireText(options.title,160)||!options.title.trim()||/[\u0000-\u001f]/.test(options.title)))fail('invalid authored presentation title');
  const projection = capture.projection, top = projection.kind === 'orthographic-top';
  let scale = 0, minX = 0, minZ = 0, maxX = 0, maxZ = 0;
  if (top) {
    ({ minX, minZ, maxX, maxZ } = projection.bounds);
    if (![minX,minZ,maxX,maxZ].every(finite) || maxX <= minX || maxZ <= minZ || projection.north !== 'local-negative-z') fail('invalid metric top frame');
    scale = W / (maxX - minX);
    if (!finite(scale) || scale <= 0) fail('unrepresentable metric scale');
    if (Math.abs((maxZ-minZ)*scale-H) > 1e-7*Math.max(W,H)) fail('anisotropic metric raster');
  } else if (projection.kind !== 'perspective' || projection.matrixLayout !== 'column-major' || !['minus-one-to-one','zero-to-one'].includes(projection.clipDepth)
    || !surfaceMapMatrixValid(projection.worldToClip)
    || ![projection.renderOrigin?.x,projection.renderOrigin?.y,projection.renderOrigin?.z].every(finite)
    ) fail('perspective requires an explicit projection matrix');
  if (options.gridMeters !== undefined && (!top || !finite(options.gridMeters) || options.gridMeters <= 0)) fail('metric grid requires a positive top-view spacing');
  if (!Array.isArray(content.labels) || content.labels.length > 10000 || !Array.isArray(content.legend) || content.legend.length > 128) fail('annotation budget exceeded');
  const styleByKind = kindStyles(style,pal), labels: MapLabel[] = [], dropped: {id:string;reason:string}[] = [], ids = new Set<string>();
  for (const entry of content.labels) {
    if (!requireText(entry.id) || ids.has(entry.id) || !requireText(entry.text) || !requireText(entry.sourcePath,2048)
      || !styleByKind[entry.kind] || !finite(entry.anchor?.x) || !finite(entry.anchor?.y) || !finite(entry.rank)) fail('invalid source label');
    ids.add(entry.id);
    let st = styleByKind[entry.kind]; if (entry.kind === 'street') st = streetRankStyle(st,entry.rank);
    if (top) {
      if (entry.path && (entry.path.length>10000 || !entry.path.every(p=>finite(p.x)&&finite(p.y)))) fail('invalid source label path');
      labels.push({ ...entry, st, x: entry.anchor.x, y: entry.anchor.y, path: entry.path });
    } else {
      if (!finite(entry.elevationM)) { dropped.push({id:entry.id,reason:'No source elevation for perspective annotation'}); continue; }
      const m=projection.worldToClip,x=entry.anchor.x-projection.renderOrigin.x,y=entry.elevationM-projection.renderOrigin.y,z=entry.anchor.y-projection.renderOrigin.z;
      const q=[0,1,2,3].map(i=>m[i]*x+m[i+4]*y+m[i+8]*z+m[i+12]);
      if(!q.every(finite) || q[3]<=0 || [0,1].some(i=>Math.abs(q[i])>q[3]) || q[2]>q[3] || q[2]<(projection.clipDepth==='zero-to-one'?0:-q[3])){dropped.push({id:entry.id,reason:'Outside projected source frame'});continue;}
      // A path cannot be draped without per-vertex source elevations. Point anchor only.
      labels.push({id:entry.id,kind:entry.kind,text:entry.text,st:{...st,shape:'point',minScale:0,maxScale:Infinity},x:(q[0]/q[3]+1)*W/2,y:(1-q[1]/q[3])*H/2});
    }
  }
  const legendIds=new Set<string>();
  for(const e of content.legend) {
    if(!requireText(e.id)||legendIds.has(e.id)||!requireText(e.text)||!requireText(e.sourcePath,2048)
      || !Number.isSafeInteger(e.count)||e.count<=0 || e.qualification!==undefined&&!requireText(e.qualification,2048)
      || !['native-buildings','roads','water','trees','low-cover','ground-recipe'].includes(e.semantic))fail('invalid source legend');
    legendIds.add(e.id);
  }
  const parts:string[]=[];let gridLines=0;
  if(options.gridMeters!==undefined){
    const step=options.gridMeters;let d='';
    const nx=Math.floor(maxX/step)-Math.ceil(minX/step)+1,nz=Math.floor(maxZ/step)-Math.ceil(minZ/step)+1;
    if(!Number.isSafeInteger(nx+nz)||nx+nz>2048)fail('grid line budget exceeded');
    for(let j=0;j<nx;j++){const x=((Math.ceil(minX/step)+j)*step-minX)*scale;d+=`M${x} 0V${H}`;gridLines++;}
    for(let j=0;j<nz;j++){const y=((Math.ceil(minZ/step)+j)*step-minZ)*scale;d+=`M0 ${y}H${W}`;gridLines++;}
    parts.push(`<path class="rpg-grid" data-spacing-m="${step}" d="${d}" fill="none" stroke="${pal.grid?.color??pal.inkSoft}" stroke-opacity="${pal.grid?.opacity??.18}" stroke-width=".6"/>`);
  }
  const side=Math.min(270,W*.3), inset=24, row=19, legendH=42+content.legend.length*row;
  if(legendH>H-100)fail('legend does not fit; reduce source categories explicitly');
  const legend:Panel={w:side,h:legendH,prims:[{t:'rect',x:0,y:0,w:side,h:legendH,fill:pal.cart.fill,stroke:pal.cart.stroke,sw:1,op:pal.cart.op},
    {t:'text',x:12,y:22,s:'Légende',size:14,anchor:'start',fill:pal.ink,bold:true}]};
  content.legend.forEach((e,i)=>{
    const y=39+i*row,color=e.semantic==='ground-recipe'?'none':e.semantic==='water'?pal.riverFill:e.semantic==='native-buildings'?pal.urban.mass:e.semantic==='trees'?pal.treeFill:e.semantic==='roads'?pal.roadFill:pal.land.meadow;
    legend.prims.push({t:'rect',x:12,y:y-9,w:14,h:10,fill:color,stroke:pal.ink,sw:.5},{t:'text',x:34,y,s:e.text,size:11,anchor:'start',fill:pal.ink});
  });
  const reserves=[{x0:inset,y0:H-inset-legendH,x1:inset+side,y1:H-inset}];
  if(top)reserves.push({x0:W-120,y0:0,x1:W,y1:120},{x0:W-220,y0:H-85,x1:W,y1:H});
  let titleReservedBounds:{x0:number;y0:number;x1:number;y1:number}|null=null;
  let titleSvg='';
  if(options.title!==undefined){
    const titleW=Math.min(W-240,560),titleH=48;
    if(titleW<80)fail('image too narrow for title');
    const titleSize=Math.min(22,(titleW-24)/Math.max(1,estimateWidth(options.title,1,styleByKind.town)));
    if(titleSize<8)fail('authored title does not fit');
    const x=(W-titleW)/2,y=24;
    titleReservedBounds={x0:x,y0:y,x1:x+titleW,y1:y+titleH};reserves.push(titleReservedBounds);
    titleSvg=panelSvg({w:titleW,h:titleH,prims:[
      {t:'rect',x:0,y:0,w:titleW,h:titleH,fill:pal.cart.fill,stroke:pal.cart.stroke,sw:1,op:pal.cart.op},
      {t:'text',x:titleW/2,y:titleH/2+titleSize*.34,s:options.title,size:titleSize,anchor:'middle',fill:pal.lab.town,bold:true},
    ]},x,y,1,family,'authored-title');
  }
  const placed=placeMapLabels(labels,top?{cx:(minX+maxX)/2,cy:(minZ+maxZ)/2,scale}:{cx:W/2,cy:H/2,scale:1},W,H,estimateWidth,{reserved:reserves,maxLabels:500,margin:36});
  parts.push(placedMapLabelsSvg(placed,pal,1));
  parts.push(titleSvg);
  parts.push(panelSvg(legend,inset,H-inset-legendH,1,family,'source-legend'));
  let scaleBar:{lengthM:number;pixels:number}|null=null;
  if(top){
    let L=niceLength(scale,100);while(L*scale>125)L/=10;const bw=L*scale;
    scaleBar={lengthM:L,pixels:bw};
    const panel:Panel={w:bw+28,h:45,prims:[{t:'rect',x:0,y:0,w:bw+28,h:45,fill:pal.cart.fill,op:pal.cart.op},
      {t:'text',x:10,y:15,s:L>=1000?`${L/1000} km`:`${Number(L.toPrecision(8))} m`,size:11,anchor:'start',fill:pal.ink}]};
    for(let i=0;i<4;i++)panel.prims.push({t:'rect',x:10+i*bw/4,y:23,w:bw/4,h:5,fill:i%2?pal.paper:pal.ink,stroke:pal.ink,sw:.6});
    if(options.gridMeters!==undefined)panel.prims.push({t:'text',x:10,y:40,s:`Grille : ${options.gridMeters} m`,size:9,anchor:'start',fill:pal.ink});
    parts.push(panelSvg(panel,W-inset-panel.w,H-inset-panel.h,1,family,'metric-scale'));
  }
  const frame:Prim[]=frameModel(W,H,pal,top).map(p=>p.t==='text'&&p.s==='N'?{...p,s:'N (grille)',size:9}:p);
  parts.push(panelSvg({w:W,h:H,prims:frame},0,0,1,family,'map-frame'));
  const evidence={format:'surface-map-composition',version:1,capture,style,sourceLabelCount:content.labels.length,placedLabelIds:placed.map(l=>l.label.id),droppedLabels:dropped,
    legend:content.legend,gridMeters:options.gridMeters??null,gridLines,scaleBar,fontFamily:family,
    title:options.title??null,titleSource:options.title===undefined?null:'Explicit authored presentation text; not an inferred source toponym',titleReservedBounds,
    coverage:{raster:'Pinned original PNG, unchanged',overlay:'Shared label placement, font stack, panel primitives, frame, north and palette tokens',style:'Overlay only; captured raster presentation is not restyled',perspective:top?null:'Explicit matrix, source point elevations only; no uniform metric scale, north or RPG grid'},
    unsupported:['SVG brush strokes, terrain hatching, labels absent from source, per-pixel occlusion and perspective path draping are not reconstructed']};
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><metadata>${esc(JSON.stringify(evidence))}</metadata><image width="${W}" height="${H}" href="${pngDataUrl(png)}"/>${parts.join('')}</svg>`;
  return {svg,evidence};
}
