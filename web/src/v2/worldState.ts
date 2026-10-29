import type { TerrainLayer, World } from '../gen/types';

/**
 * Generation stages treat physical rasters, native snapshots and existing land use as immutable.
 * Detach mutable names and urban state, without copying tens of MiB of unchanged physical fields.
 */
export function cloneV2TerrainForStage(terrain: TerrainLayer): TerrainLayer {
  // generateNames assigns River.name; paths/widths and all physical arrays are read-only inputs.
  return { ...terrain, rivers: terrain.rivers.map(river => ({ ...river })) };
}
export function cloneV2WorldForGeneration(source: World): World {
  const { terrain, landuse, debug, site, stats, ...mutable } = source;
  const { importedHeight, ...options } = source.options;
  const { v2RustCities, v2RustRegion, ...otherDebug } = debug ?? {};
  const world: World = { ...structuredClone({ ...mutable, options }), terrain: cloneV2TerrainForStage(terrain), landuse, stats: { ...stats } };
  if (importedHeight) world.options.importedHeight = importedHeight;
  if (site) {
    const { cost, fields, ...siteMetadata } = site;
    world.site = { ...structuredClone(siteMetadata), cost, fields };
  }
  if (debug) world.debug = { ...structuredClone(otherDebug), ...(v2RustRegion ? { v2RustRegion } : {}), ...(v2RustCities ? { v2RustCities: { ...(v2RustCities as Record<string, unknown>) } } : {}) };
  // Each Rust town transition detaches the snapshot and changed nested branches before writing.
  return world;
}
