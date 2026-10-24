import type { SurfaceWorld } from '../model';
import { getCanonicalSurfaceContext } from '../compiler';
import { restoreSurfaceSource } from './sourceArchive';
import type { NativeSurfaceMapProjection, SurfaceMapCapture, SurfaceMapContent, SurfaceMapLabel, SurfaceMapLegendEntry, SurfaceVisualLegend } from '../mapComposition';
import { surfaceMapMatrixValid } from '../mapComposition';
import type { NameEntry } from '../../gen/names/types';

const RECIPE_LABELS:Record<string,string>={
  'mineral-soil':'Sol minéral','organic-soil':'Sol humifère','fractured-bedrock':'Roche fracturée',
  'wind-ripple-sand':'Sable éolien','arid-reg':'Reg aride','angular-talus':'Éboulis','carbonate-karst':'Karst calcaire',
  'volcanic-crust':'Roche volcanique','alluvial-bars':'Alluvions','inland-water':'Eaux intérieures',
  'wetland-organic':'Sol de zone humide','coastal-sediment':'Sédiments littoraux','coastal-rock':'Roches littorales',
  'marine-water':'Mer','vegetation-litter':'Litière végétale','forest-litter':'Litière forestière','snow-ice':'Neige et glace',
  'compacted-road':'Sol compacté','cultivated-soil':'Sol cultivé','built-foundation':'Fondations',
};
export function surfaceRecipeDisplayName(recipe:{id:string;displayName?:unknown;label?:unknown;name?:unknown}):string {
  for(const value of [recipe.displayName,recipe.label,recipe.name])if(typeof value==='string'&&value.trim())return value;
  return RECIPE_LABELS[recipe.id]??recipe.id;
}

/** Join the actual native camera sidecar, never derive an oblique camera from
 * width/focus heuristics. The renderer origin is kept separate in float64. */
export function nativeSurfaceMapCapture(identity:Pick<SurfaceMapCapture,'worldId'|'canonicalContextId'|'sourcePacketSha256'|'metricsSha256'|'imageSha256'|'presentation'|'mapStyle'>,
  projection:NativeSurfaceMapProjection):SurfaceMapCapture {
  const p=projection,finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
  if(p?.format!=='surface-map-projection'||p.version!==1||p.worldId!==identity.worldId
    || !['orthographic-top','perspective'].includes(p.projectionMode)||!surfaceMapMatrixValid(p.worldToClip)
    ||![p.renderOrigin?.x,p.renderOrigin?.y,p.renderOrigin?.z,p.focus?.x,p.focus?.z].every(finite)
    ||!Array.isArray(p.clipRange)||p.clipRange.length!==2||p.clipRange[0]!==-1||p.clipRange[1]!==1
    ||![p.viewportPixels?.width,p.viewportPixels?.height].every(v=>Number.isSafeInteger(v)&&v>=256&&v<=16384))throw Error('Invalid native map projection sidecar');
  if(p.projectionMode==='orthographic-top'){
    const s=p.uniformMetricScale,b=s?.bounds;
    if(!s||!finite(s.metresPerPixel)||s.metresPerPixel<=0||s.north!=='local-negative-z'||!b
      ||![b.minX,b.maxX,b.minZ,b.maxZ].every(finite)||b.maxX<=b.minX||b.maxZ<=b.minZ
      ||Math.abs((b.maxX-b.minX)/p.viewportPixels.width-s.metresPerPixel)>s.metresPerPixel*1e-7
      ||Math.abs((b.maxZ-b.minZ)/p.viewportPixels.height-s.metresPerPixel)>s.metresPerPixel*1e-7)throw Error('Invalid native uniform metric frame');
  }else if(p.uniformMetricScale!==null)throw Error('Perspective cannot claim uniform metric scale');
  return {...identity,format:'surface-map-capture',version:1,widthPx:p.viewportPixels.width,heightPx:p.viewportPixels.height,nativeProjection:structuredClone(p),
    projection:p.projectionMode==='orthographic-top'?{kind:'orthographic-top',bounds:{...p.uniformMetricScale!.bounds},north:'local-negative-z'}:
      {kind:'perspective',worldToClip:[...p.worldToClip],renderOrigin:{...p.renderOrigin},matrixLayout:'column-major',clipDepth:'minus-one-to-one'}};
}

/** Descriptors bind the current native cartographic primitives to the captured
 * palette, image and metrics. Other modes are omitted, not guessed from soil
 * recipes or canonical potential fields. */
export function nativeVisualLegend(metrics:Record<string,any>,packet:{urban?:Record<string,any>},capture:SurfaceMapCapture):SurfaceVisualLegend {
  const result:SurfaceVisualLegend={format:'surface-visual-legend',version:1,policy:'native-cartographic-glyphs-1',
    worldId:capture.worldId,imageSha256:capture.imageSha256,metricsSha256:capture.metricsSha256,entries:[]};
  if(metrics.worldId!==capture.worldId||metrics.renderedSnapshot?.worldId!==capture.worldId)throw Error('Native glyph metrics refer to another world');
  const p=metrics.renderSourceVersion?.presentation;
  if(capture.projection.kind!=='orthographic-top'||capture.presentation!=='cartographic'||p?.cartographic!==true||p.mapStyle!==capture.mapStyle){
    result.omittedReason='No certified visual glyph key for this presentation; source semantics remain metadata only';return result;
  }
  const palette=p.palette??{},urban=palette.urban??{},paths='metrics.renderSourceVersion.presentation.palette';
  if(metrics.cityMap?.representation==='cartographic-source-roof-overlay'&&metrics.cityMap.sourceRoofAreaM2>0&&metrics.urban?.nativeBuildings>0&&Number.isFinite(urban.massEdgeW)&&urban.massEdgeW>0){
    const metresPerPixel=(capture.projection.bounds.maxX-capture.projection.bounds.minX)/capture.widthPx;
    result.entries.push({id:'native-buildings',text:'Bâtiments',glyph:{kind:'outlined-building',fill:urban.mass,stroke:urban.massEdge,
      strokeWidthPx:Math.min(8,Math.max(.25,urban.massEdgeW/metresPerPixel))},
      sourcePath:paths+'.urban.mass/massEdge/massEdgeW; metrics.cityMap',qualification:'Prepared source roof overlay; representative outline/fill, not a GPU occlusion census'});
  }
  const roads=packet.urban?.roads??[],rural=(r:any)=>['track','path','way','headland','farm-track','rural-track'].includes(String(r.class??'').toLowerCase())||r.rural===true;
  if(metrics.roadProjectors>0&&roads.length&&roads.every((r:any)=>rural(r)===rural(roads[0]))){
    result.entries.push({id:'roads',text:rural(roads[0])?'Chemins':'Voirie',glyph:{kind:'double-edge-road',fill:rural(roads[0])?palette.trackFill:palette.roadFill,edge:palette.roadEdge,borderFraction:.125},
      sourcePath:paths+'.roadFill/trackFill/roadEdge; urban.roads; metrics.roadProjectors',qualification:'Native border-inside-1of8-v1 road texture policy; schematic icon, not metric road width'});
  }
  if(metrics.canopyView?.phase>1&&metrics.canopyView?.treeAssets?.enabled===false&&metrics.populationInstances?.families?.tree?.alphaPositiveInFrustum>0){
    result.entries.push({id:'trees',text:'Arbres',glyph:{kind:'tree-disc',fill:palette.treeFill},sourcePath:paths+'.treeFill; metrics.populationInstances.families.tree',
      qualification:'Native cartographic procedural crown disc; alpha-positive centres in frame, not a per-pixel occlusion proof'});
  }
  if(!result.entries.length)result.omittedReason='No certified submitted cartographic glyph in this capture';
  return result;
}

/** No naming grammar is invoked. A producer with a genuine World can preserve its
 * `world.names` as source.meta.names before archiving, or supply these entries
 * through this same adapter with an explicit source reference. */
export function sourceMapLabels(entries: readonly NameEntry[], sourcePath: string,
  translation: { x: number; z: number } = { x: 0, z: 0 }): SurfaceMapLabel[] {
  if (![translation.x, translation.z].every(Number.isFinite)) throw new Error('Invalid source label frame translation');
  return entries.map((e, i) => ({ ...structuredClone(e), sourcePath: `${sourcePath}.entries[${i}]`,
    anchor: { x: e.anchor.x + translation.x, y: e.anchor.y + translation.z },
    path: e.path?.map(p => ({ x: p.x + translation.x, y: p.y + translation.z })) }));
}

/** Legend entries describe records or canonical support nodes, not inferred
 * POIs, measured areas or a GPU visibility census. Never unpack native meshes. */
export function surfaceMapContent(packet: { world: SurfaceWorld; urban?: Record<string, any>; source?: Record<string, unknown> },
  capture: SurfaceMapCapture, metrics?:Record<string,any>): SurfaceMapContent {
  const world = packet.world, context = getCanonicalSurfaceContext(world);
  if (world.id !== capture.worldId || context.id !== capture.canonicalContextId) throw new Error('Capture does not refer to this packet world/context');
  const source = packet.source ? restoreSurfaceSource(packet.source) : {};
  const meta = source.meta as { names?: { entries: NameEntry[] } } | undefined;
  const names = meta?.names;
  if (names && !Array.isArray(names.entries)) throw new Error('Malformed retained names layer');
  const translation = source.sourceToWorldTranslation as { x: number; z: number } | undefined;
  const labels = names ? sourceMapLabels(names.entries, 'source.meta.names', translation) : [];
  const legend: SurfaceMapLegendEntry[] = [], counts = new Map<number, number>(), f = context.fields, g = context.grid;
  let trees = 0, low = 0, water = 0;
  const b = capture.projection.kind === 'orthographic-top' ? capture.projection.bounds : context.bounds;
  const x0 = Math.max(0, Math.floor((b.minX - g.originX) / g.spacingM)), z0 = Math.max(0, Math.floor((b.minZ - g.originZ) / g.spacingM));
  const x1 = Math.min(g.width - 1, Math.ceil((b.maxX - g.originX) / g.spacingM)), z1 = Math.min(g.height - 1, Math.ceil((b.maxZ - g.originZ) / g.spacingM));
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = z * g.width + x;
    const index = f.groundMaterial?.[i];
    if (index !== undefined) counts.set(index, (counts.get(index) ?? 0) + 1);
    if (f.treeCover[i] > 0) trees++;
    if (f.grassCover[i] > 0 || f.shrubCover[i] > 0 || f.litter[i] > 0) low++;
    if (f.waterClass[i] > 0) water++;
  }
  const add = (id: string, text: string, sourcePath: string, semantic: SurfaceMapLegendEntry['semantic'], count: number, qualification:string) => {
    if (count) legend.push({ id, text, sourcePath, semantic, count,qualification });
  };
  const buildings = packet.urban?.buildings ?? [];
  const native = buildings.filter((b: { representation?: string; nativeRealization?: boolean }) => b.representation === 'native' && b.nativeRealization === true).length;
  add('native-buildings', 'Bâtiments', 'urban.buildings', 'native-buildings', native,'Native building records retained in source packet; not GPU visibility');
  add('roads', 'Voirie', 'urban.roads', 'roads', packet.urban?.roads?.length ?? 0,'Road records retained in source packet');
  add('water', 'Eau', 'world.canonicalContext.fields.waterClass', 'water', water,'Canonical source support nodes; not vector area or measured flow');
  add('trees', 'Arbres', 'world.canonicalContext.fields.treeCover', 'trees', trees,'Canonical tree-cover potential support nodes; not rendered or observed tree counts');
  add('low-cover', 'Couvert bas', 'world.canonicalContext.fields.grassCover/shrubCover/litter', 'low-cover', low,'Canonical low-cover potential support nodes; not rendered instances');
  for (const [index, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    const recipe = world.materials[index]; if (!recipe) throw new Error('Invalid retained ground recipe index');
    add(`recipe:${recipe.id}`, surfaceRecipeDisplayName(recipe), `world.materials[${index}] / canonicalContext.fields.groundMaterial`, 'ground-recipe', count,'Canonical ground recipe support nodes; not visible pixel area');
  }
  return { sourcePacketSha256: capture.sourcePacketSha256, worldId: world.id, labels, legend, visualLegend:metrics?nativeVisualLegend(metrics,packet,capture):undefined };
}
