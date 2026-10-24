import { describe, it, expect } from 'vitest';
import { encodePng } from '../src/render/raster';
import { PALETTES, STYLE_LIST } from '../src/render/styles';
import { labelsSvg, placeForExport, placedMapLabelsSvg } from '../src/render/svgLabels';
import { generate } from '../src/gen/pipeline';
import { makeOptions } from '../src/gen/options';
import { SurfaceSha256 } from '../src/surface/sha256';
import { composeSurfaceMap, type SurfaceMapCapture, type SurfaceMapContent } from '../src/surface/mapComposition';
import { sourceMapLabels, surfaceMapContent, nativeSurfaceMapCapture, surfaceRecipeDisplayName } from '../src/surface/adapters/mapComposition';
import { compileSurfaceWorld, getCanonicalSurfaceContext } from '../src/surface/compiler';

const png=encodePng(new Uint8Array(640*400*3).fill(128),640,400);
const digest=new SurfaceSha256().update(png).hex();
function fixture(){
  const capture:SurfaceMapCapture={format:'surface-map-capture',version:1,sourcePacketSha256:'a'.repeat(64),metricsSha256:'b'.repeat(64),imageSha256:digest,
    worldId:'world',canonicalContextId:'context',widthPx:640,heightPx:400,mapStyle:'blueprint',presentation:'cartographic',
    projection:{kind:'orthographic-top',bounds:{minX:6400,maxX:6800,minZ:8200,maxZ:8450},north:'local-negative-z'}};
  const content:SurfaceMapContent={sourcePacketSha256:capture.sourcePacketSha256,worldId:'world',
    labels:sourceMapLabels([{id:'actual-name',text:'Source & <name>',kind:'church',rank:0,anchor:{x:6600,y:8300}}],'source.meta.names'),
    legend:[{id:'native',text:'Bâtiments natifs',sourcePath:'urban.buildings',semantic:'native-buildings',count:419}]};
  return {capture,content};
}
describe('pinned raster map composition',()=>{
  it('embeds the exact PNG and metric source frame, without changing source records',()=>{
    const {capture,content}=fixture(),before=structuredClone({capture,content});
    const {svg,evidence}=composeSurfaceMap(capture,png,content,{gridMeters:5});
    expect(svg).toContain('data:image/png;base64,'+Buffer.from(png).toString('base64'));
    expect(svg).toContain('Grille : 5 m');expect(svg).toContain('N (grille)');expect(evidence.gridLines).toBe(132);
    expect(evidence.placedLabelIds).toEqual(['actual-name']);expect(svg).not.toContain('<name>');
    expect({capture,content}).toEqual(before);
  });
  it('supports each of the nine shared overlay palettes without claiming raster restyling',()=>{
    const {capture,content}=fixture();expect(STYLE_LIST).toHaveLength(9);
    for(const {id}of STYLE_LIST){const result=composeSurfaceMap(capture,png,content,{style:id});expect(result.evidence.style).toBe(id);expect(result.evidence.coverage.style).toContain('not restyled');expect(result.svg).toContain(PALETTES[id].ink);}
  });
  it('rejects stale images, source identity, dimensions, anisotropic frames and unsafe grid budgets',()=>{
    for(const mutate of [
      (x:ReturnType<typeof fixture>)=>x.capture.imageSha256='0'.repeat(64),
      (x:ReturnType<typeof fixture>)=>x.content.worldId='other',
      (x:ReturnType<typeof fixture>)=>x.content.sourcePacketSha256='c'.repeat(64),
      (x:ReturnType<typeof fixture>)=>x.capture.widthPx=641,
      (x:ReturnType<typeof fixture>)=>{if(x.capture.projection.kind==='orthographic-top')x.capture.projection.bounds.maxZ++},
    ]){const f=fixture();mutate(f);expect(()=>composeSurfaceMap(f.capture,png,f.content)).toThrow();}
    const f=fixture();expect(()=>composeSurfaceMap(f.capture,png,f.content,{gridMeters:0.001})).toThrow('budget');
  });
  it('does not invent names when the source name layer is absent',()=>{
    const {capture,content}=fixture();content.labels=[];
    expect(composeSurfaceMap(capture,png,content).evidence.placedLabelIds).toEqual([]);
  });
  it('renders only an explicitly authored title and reserves its space for labels',()=>{
    const {capture,content}=fixture();content.labels[0].anchor.y=8235;
    const plain=composeSurfaceMap(capture,png,content);
    expect(plain.evidence.title).toBeNull();expect(plain.svg).not.toContain('class="authored-title"');
    expect(plain.evidence.placedLabelIds).toEqual(['actual-name']);
    const titled=composeSurfaceMap(capture,png,content,{title:'Plan <urbain>'});
    expect(titled.svg).toContain('Plan &lt;urbain&gt;');expect(titled.evidence.title).toBe('Plan <urbain>');
    expect(titled.evidence.titleSource).toContain('authored');expect(titled.evidence.titleReservedBounds).not.toBeNull();
    expect(titled.evidence.placedLabelIds).toEqual([]);expect(content.labels[0].text).toBe('Source & <name>');
    for(const title of ['', '   ', 'two\nlines', 'x'.repeat(161)])expect(()=>composeSurfaceMap(capture,png,content,{title})).toThrow();
  });
  it('uses readable recipe captions and preserves supplied names without guessing custom translations',()=>{
    expect(surfaceRecipeDisplayName({id:'mineral-soil'})).toBe('Sol minéral');
    expect(surfaceRecipeDisplayName({id:'custom-ground',displayName:'Limon du plateau'})).toBe('Limon du plateau');
    expect(surfaceRecipeDisplayName({id:'custom-ground',label:'Sol local'})).toBe('Sol local');
    expect(surfaceRecipeDisplayName({id:'custom-ground',name:'Authored name'})).toBe('Authored name');
    expect(surfaceRecipeDisplayName({id:'custom-ground'})).toBe('custom-ground');
  });
  it('translates source label paths once without mutating or renaming them',()=>{
    const entries=[{id:'name',text:'Old name',kind:'river' as const,rank:1,anchor:{x:2,y:3},path:[{x:1,y:2},{x:3,y:4}]}];
    const before=structuredClone(entries),out=sourceMapLabels(entries,'world.names',{x:100,z:-50});
    expect(out[0].anchor).toEqual({x:102,y:-47});expect(out[0].path?.[0]).toEqual({x:101,y:-48});expect(out[0].text).toBe('Old name');expect(entries).toEqual(before);
  });
  it('requires perspective point elevations and omits uniform grid/scale/north',()=>{
    const {capture,content}=fixture();capture.projection={kind:'perspective',worldToClip:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],renderOrigin:{x:0,y:0,z:0},matrixLayout:'column-major',clipDepth:'minus-one-to-one'};
    expect(composeSurfaceMap(capture,png,content).evidence.droppedLabels[0].reason).toContain('elevation');
    content.labels[0]={...content.labels[0],anchor:{x:0,y:0},elevationM:0};
    const result=composeSurfaceMap(capture,png,content);expect(result.evidence.placedLabelIds).toEqual(['actual-name']);
    expect(result.svg).not.toContain('metric-scale');expect(result.svg).not.toContain('N (grille)');
    expect(()=>composeSurfaceMap(capture,png,content,{gridMeters:5})).toThrow();
    capture.projection.worldToClip.fill(1);expect(()=>composeSurfaceMap(capture,png,content)).toThrow('matrix');
  });

  it('joins the real native sidecar and rebases large coordinates before perspective multiplication',()=>{
    const {capture,content}=fixture();
    const sidecar={format:'surface-map-projection' as const,version:1 as const,worldId:'world',projectionMode:'perspective' as const,viewportPixels:{width:640,height:400},
      worldToClip:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],renderOrigin:{x:1e9,y:1e9,z:-1e9},clipRange:[-1,1] as [-1,1],focus:{x:1e9,z:-1e9},uniformMetricScale:null};
    const bound=nativeSurfaceMapCapture(capture,sidecar);
    content.labels[0]={...content.labels[0],anchor:{x:1e9,y:-1e9},elevationM:1e9};
    expect(composeSurfaceMap(bound,png,content).evidence.placedLabelIds).toEqual(['actual-name']);
    expect(()=>nativeSurfaceMapCapture(capture,{...sidecar,worldId:'wrong'})).toThrow();
    expect(()=>nativeSurfaceMapCapture(capture,{...sidecar,worldToClip:Array(16).fill(0)})).toThrow();
    expect(()=>nativeSurfaceMapCapture(capture,{...sidecar,uniformMetricScale:{metresPerPixel:1,bounds:{minX:0,minZ:0,maxX:640,maxZ:400},north:'local-negative-z'}})).toThrow();
  });
  it('derives only present canonical source semantics and preserves physical arrays',()=>{
    const world=compileSurfaceWorld({seed:1,terrain:{width:3,height:3,originX:0,originZ:0,spacingM:10,heights:new Float32Array(9).fill(100),source:{id:'test-source',version:'1',sourceLOD:0,nativeSpacingM:10}}});
    const {capture}=fixture();capture.worldId=world.id;capture.canonicalContextId=getCanonicalSurfaceContext(world).id;capture.projection={kind:'orthographic-top',bounds:world.bounds,north:'local-negative-z'};
    const before=new Uint8Array(world.fields.groundMaterial!.buffer).slice();
    const result=surfaceMapContent({world,source:{}},capture);expect(result.labels).toEqual([]);
    expect(result.legend.some(e=>e.id==='native-buildings')).toBe(false);expect(result.legend.some(e=>e.id==='water')).toBe(false);
    expect(result.legend.filter(e=>e.semantic==='ground-recipe').length).toBeGreaterThan(0);
    expect(result.legend.every(e=>e.qualification&&e.sourcePath&&e.count>0)).toBe(true);
    expect(result.legend.every(e=>!e.text.includes('(source)')&&!e.text.includes('(potentiel)'))).toBe(true);
    expect(new Uint8Array(world.fields.groundMaterial!.buffer)).toEqual(before);
  });
  it('keeps the existing SVG label serialization byte-identical after extraction',()=>{
    const world=generate(makeOptions({seed:'label-serializer',population:300}));
    for(const {id}of STYLE_LIST){const pal=PALETTES[id],{placed,scale}=placeForExport(world,pal);expect(labelsSvg(world,pal)).toBe(placedMapLabelsSvg(placed,pal,scale));}
  });
});
