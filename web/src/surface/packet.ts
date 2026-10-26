import { validateCandidateColumns } from './candidateColumns';
import { validateSurfaceCandidatePages } from './candidatePages';
import { validateUrbanColumns } from './urbanColumns';
import { SURFACE_SCHEMA_VERSION, type SurfaceWorld, type TerrainGrid } from './model';
import { hydrateGroundResponse } from './groundResponse';

/** Structural boundary validation without cloning hundreds of MB of typed fields.
 * Scientific/value validation and JSON migration are available through hydrateSurfaceWorld.
 */
export function validateSurfacePacket(value: unknown): asserts value is {
  format: 'magna-surface-packet'; version: 1; world: SurfaceWorld; [key: string]: unknown;
} {
  const p = value as Record<string, any>;
  if (!p || p.format !== 'magna-surface-packet' || p.version !== 1 || !p.source || typeof p.source !== 'object') throw new Error('Unsupported surface packet');
  const w = p.world as SurfaceWorld;
  if (!w || w.schemaVersion !== SURFACE_SCHEMA_VERSION || w.crs !== 'local-xz' || w.units !== 'metres' || typeof w.id !== 'string' || !w.id) throw new Error('Invalid packet SurfaceWorld');
  const grid = (t: TerrainGrid) => {
    if (!t || !Number.isInteger(t.width) || !Number.isInteger(t.height) || t.width < 2 || t.height < 2 || t.width * t.height > 16777216
      || ![t.originX, t.originZ, t.spacingM].every(Number.isFinite) || t.spacingM <= 0) throw new Error('Invalid packet grid');
    return t.width * t.height;
  };
  const terrain = (t: TerrainGrid) => {
    const n = grid(t);
    if (!(t.heights instanceof Float32Array) || t.heights.length !== n || !t.source || typeof t.source.id !== 'string' || typeof t.source.version !== 'string') throw new Error('Invalid packet terrain');
    return n;
  };
  const fields = (f: Record<string, any>, n: number) => {
    if (!f || !Object.keys(f).length) throw new Error('Missing packet fields');
    for (const [key, a] of Object.entries(f)) {
      const layers = ['topographicPosition', 'provenance', 'transportedProvenance'].includes(key) ? a : [a];
      if (!Array.isArray(layers) || !layers.length || layers.some((layer: any) => !ArrayBuffer.isView(layer) || layer instanceof DataView || (layer as { length?: number }).length !== n)) throw new Error('Invalid packet field ' + key);
    }
    for (const required of ['slope', 'material', 'waterClass', 'waterLevelM', 'occupation', 'sand', 'silt', 'clay', 'treeCover']) if (!f[required]) throw new Error('Missing packet field ' + required);
  };
  fields(w.fields, terrain(w.terrain));
  if(w.geometryDetail){
    const d=w.geometryDetail,g=d.grid,t=w.terrain,n=t.width*t.height;
    if(d.format!=='surface-geometry-detail'||d.version!==1||typeof d.id!=='string'||!d.id||!g
      ||g.width!==t.width||g.height!==t.height||g.originX!==t.originX||g.originZ!==t.originZ||g.spacingM!==t.spacingM
      ||d.canonicalContextId!==w.canonicalContextRef?.id||!d.source||d.source.id!==t.source.id||d.source.version!==t.source.version)throw new Error('Packet geometry detail source/grid/context reference mismatch');
    for(const key of ['slopeRadians','aspectRadians','normalXYZ','rockExposurePotential','edgeConfidence','bedrockExposure'] as const)
      if(!(d[key] instanceof Float32Array)||d[key].length!==n*(key==='normalXYZ'?3:1))throw new Error('Invalid packet geometry detail '+key);
    if(!(d.treeSupport instanceof Uint8Array)||d.treeSupport.length!==n)throw new Error('Invalid packet geometry tree support');
    if(d.localBedrockUnitId!==undefined&&(!(d.localBedrockUnitId instanceof Uint16Array)||d.localBedrockUnitId.length!==n||!d.geologyScenario))throw new Error('Invalid packet local bedrock');
    const c=d.surfaceConditioning;
    if(c&&(c.version!=='surface-conditioning-1'||c.canonicalEnvironmentVersion!==w.versions.environment||!(c.bedrockExposure instanceof Float32Array)||c.bedrockExposure.length!==n))throw new Error('Invalid packet surface conditioning');
  }
  const c = w.canonicalContext, r = w.canonicalContextRef;
  if(w.versions.groundResponse!==undefined&&(typeof w.versions.groundResponse!=='string'||!w.versions.groundResponse))throw new Error('Invalid packet ground response version');
  if(r&&r.groundResponseVersion!==w.versions.groundResponse)throw new Error('Packet ground response reference mismatch');
  if(r&&w.groundResponse!==undefined)throw new Error('Packet projected response must resolve canonical context');
  const responseSource=c??(!r?{grid:w.terrain,source:w.terrain.source,groundResponse:w.groundResponse}:undefined);
  if(responseSource){
    if((responseSource.groundResponse!==undefined)!==(w.versions.groundResponse!==undefined))throw new Error('Packet ground response availability mismatch');
    if(responseSource.groundResponse!==undefined){const g=responseSource.grid;
      const response=hydrateGroundResponse(responseSource.groundResponse,{grid:{width:g.width,height:g.height,originX:g.originX,originZ:g.originZ,spacingM:g.spacingM},source:responseSource.source,environmentVersion:w.versions.environment,materialLibraryVersion:w.versions.materialLibrary,materials:w.materials});
      if(response.id!==w.versions.groundResponse)throw new Error('Packet ground response canonical version mismatch');
    }
  }
  if (c) {
    fields(c.fields, grid(c.grid as TerrainGrid));
    if (r && (c.id !== r.id || c.versions.environment !== r.environmentVersion || c.versions.occupation !== r.occupationVersion || c.versions.materialLibrary !== r.materialLibraryVersion || c.versions.surfaceState !== r.surfaceStateVersion || c.versions.population !== r.populationVersion)) throw new Error('Packet canonical context reference mismatch');
  }
  if (r && (!r.id || r.environmentVersion !== w.versions.environment || r.occupationVersion !== w.versions.occupation)) throw new Error('Packet context version mismatch');
  if (p.candidateColumns !== undefined) validateCandidateColumns(p.candidateColumns);
  if (p.urban?.format === 'magna-urban-columns') validateUrbanColumns(p.urban);
  if (p.candidates !== undefined && !Array.isArray(p.candidates)) throw new Error('Invalid packet candidates');
  if (p.candidates !== undefined && p.candidateColumns !== undefined) throw new Error('Ambiguous packet candidates');
  if(p.candidatePages!==undefined)validateSurfaceCandidatePages(p.candidatePages,p.candidateColumns,p.candidates,w);
  if (p.terrainParents !== undefined) {
    if (!Array.isArray(p.terrainParents)) throw new Error('Invalid packet terrain parents');
    for (const parent of p.terrainParents) {
      terrain(parent.terrain);
      if (!r || parent.canonicalContextId !== r.id || parent.terrain.source.id !== w.terrain.source.id || parent.terrain.source.version !== w.terrain.source.version) throw new Error('Packet parent lineage mismatch');
    }
  }
}
