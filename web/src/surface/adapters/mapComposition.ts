import type { SurfaceWorld } from '../model';
import { getCanonicalSurfaceContext } from '../compiler';
import { restoreSurfaceSource } from './sourceArchive';
import type { NativeSurfaceMapProjection, SurfaceMapCapture, SurfaceMapContent, SurfaceMapLabel, SurfaceMapLegendEntry } from '../mapComposition';
import { surfaceMapMatrixValid } from '../mapComposition';
import type { NameEntry } from '../../gen/names/types';

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
  capture: SurfaceMapCapture): SurfaceMapContent {
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
  const add = (id: string, text: string, sourcePath: string, semantic: SurfaceMapLegendEntry['semantic'], count: number) => {
    if (count) legend.push({ id, text, sourcePath, semantic, count });
  };
  const buildings = packet.urban?.buildings ?? [];
  const native = buildings.filter((b: { representation?: string; nativeRealization?: boolean }) => b.representation === 'native' && b.nativeRealization === true).length;
  add('native-buildings', 'Bâtiments natifs (source)', 'urban.buildings', 'native-buildings', native);
  add('roads', 'Voirie (source)', 'urban.roads', 'roads', packet.urban?.roads?.length ?? 0);
  add('water', 'Eau (contexte source)', 'world.canonicalContext.fields.waterClass', 'water', water);
  add('trees', 'Arbres (potentiel)', 'world.canonicalContext.fields.treeCover', 'trees', trees);
  add('low-cover', 'Couvert bas (potentiel)', 'world.canonicalContext.fields.grassCover/shrubCover/litter', 'low-cover', low);
  for (const [index, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    const recipe = world.materials[index]; if (!recipe) throw new Error('Invalid retained ground recipe index');
    add(`recipe:${recipe.id}`, `Sol : ${recipe.id}`, `world.materials[${index}] / canonicalContext.fields.groundMaterial`, 'ground-recipe', count);
  }
  return { sourcePacketSha256: capture.sourcePacketSha256, worldId: world.id, labels, legend };
}
