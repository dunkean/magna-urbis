import { getCanonicalSurfaceContext } from './compiler';
import { sampleTerrainHeight } from './heightSampling';
import { Occupation, WaterClass, assertNotAborted, clamp, hashString, type Bounds, type SurfaceCandidate, type SurfaceWorld } from './model';
import { TREE_CELL_M, TREE_SLOTS_PER_CELL, TREE_CROWN_RADIUS_RATIO, treeAcceptanceForCover } from './treeCanopy';
import { SURFACE_MAX_CANDIDATES } from './limits';

export interface PopulationOptions {
  families?: SurfaceCandidate['family'][];
  /** Stable rank thinning, intended for LOD. Coordinates, variants and ids never change. */
  retention?: number;
  /** Include objects whose support lies outside the requested box but whose radius intersects it. */
  includeOverhang?: boolean;
  maxCandidates?: number;
  /** Bound work even when no candidates are accepted (e.g. huge desert queries). */
  maxCheckedSlots?: number;
  signal?: AbortSignal;
}
/** A caller may reduce a spatial query and retry; accepted inventory is never truncated. */
export class PopulationBudgetError extends RangeError {
  constructor(readonly budget: 'candidates' | 'slots', message: string) { super(message); this.name = 'PopulationBudgetError'; }
}
const FAMILIES: Array<{ family: SurfaceCandidate['family']; cellM: number; slots: number; minSize: number; maxSize: number }> = [
  { family: 'tree', cellM: TREE_CELL_M, slots: TREE_SLOTS_PER_CELL, minSize: 4, maxSize: 18 },
  { family: 'shrub', cellM: 12, slots: 2, minSize: .5, maxSize: 2.5 },
  { family: 'boulder', cellM: 10, slots: 2, minSize: .15, maxSize: 2.8 },
  { family: 'grass', cellM: 4, slots: 2, minSize: .15, maxSize: .65 },
  { family: 'debris', cellM: 8, slots: 2, minSize: .08, maxSize: .8 },
];
function random(key: string, channel: number): number {
  // Avalanche prevents adjacent channel suffixes from making jitter, size and acceptance correlated.
  let value = parseInt(hashString(key + ':' + channel), 16);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

/** Canonical world cells; independent of renderer pages, request order, camera and seasonal state.
 * Synchronous operation: AbortSignal guarantees pre-start cancellation; use a worker for interruptible large queries. */
export function generateSurfaceCandidates(world: SurfaceWorld, bounds: Bounds, options: PopulationOptions = {}): SurfaceCandidate[] {
  assertNotAborted(options.signal);
  if (![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(Number.isFinite) || bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) throw new Error('Invalid population query bounds');
  const retention = clamp(options.retention ?? 1), maxCandidates = options.maxCandidates ?? SURFACE_MAX_CANDIDATES;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 0 || maxCandidates>SURFACE_MAX_CANDIDATES) throw new Error(`maxCandidates must be an integer in 0..${SURFACE_MAX_CANDIDATES}; request smaller visible bounds`);
  const maxCheckedSlots = options.maxCheckedSlots ?? 2_000_000;
  if (!Number.isInteger(maxCheckedSlots) || maxCheckedSlots < 0) throw new Error('maxCheckedSlots must be a nonnegative integer');
  if (retention === 0) return [];
  // Resolve once. Population eligibility needs no material composition, colour,
  // soil/provenance DTO or fine-geometry normals per rejected potential slot.
  // Keep precisely sampleSurface's nearest categories and bilinear arithmetic.
  const context = getCanonicalSurfaceContext(world), grid=context.grid, fields=context.fields;
  const eligibility=(x:number,z:number)=>{
    const gx=clamp((x-grid.originX)/grid.spacingM,0,grid.width-1),gz=clamp((z-grid.originZ)/grid.spacingM,0,grid.height-1);
    const x0=Math.min(grid.width-2,Math.floor(gx)),z0=Math.min(grid.height-2,Math.floor(gz)),fx=gx-x0,fz=gz-z0,p=z0*grid.width+x0;
    const nearest=Math.round(gz)*grid.width+Math.round(gx);
    const bilinear=(a:Float32Array)=>{
      const a0=a[p],a1=a[p+1],a2=a[p+grid.width],a3=a[p+grid.width+1];
      if(![a0,a1,a2,a3].every(Number.isFinite))return a[nearest];
      return(a0*(1-fx)+a1*fx)*(1-fz)+(a2*(1-fx)+a3*fx)*fz;
    };
    return{waterClass:fields.waterClass[nearest],occupation:fields.occupation[nearest],slope:bilinear(fields.slope),
      treeCover:bilinear(fields.treeCover),shrubCover:bilinear(fields.shrubCover),grassCover:bilinear(fields.grassCover),
      stoniness:bilinear(fields.stoniness),litter:bilinear(fields.litter)};
  };
  let slotsToCheck = 0;
  for (const recipe of FAMILIES) {
    if (options.families && !options.families.includes(recipe.family)) continue;
    const halo = options.includeOverhang ? recipe.maxSize * (recipe.family === 'tree' ? TREE_CROWN_RADIUS_RATIO : 1) : 0;
    const minX = Math.max(world.bounds.minX, bounds.minX - halo), minZ = Math.max(world.bounds.minZ, bounds.minZ - halo);
    const maxX = Math.min(world.bounds.maxX, bounds.maxX + halo), maxZ = Math.min(world.bounds.maxZ, bounds.maxZ + halo);
    if (minX > maxX || minZ > maxZ) continue;
    slotsToCheck += (Math.floor(maxX / recipe.cellM) - Math.floor(minX / recipe.cellM) + 1) * (Math.floor(maxZ / recipe.cellM) - Math.floor(minZ / recipe.cellM) + 1) * recipe.slots;
    if (slotsToCheck > maxCheckedSlots) throw new PopulationBudgetError('slots', 'Population query exceeds maxCheckedSlots; request smaller visible bounds');
  }
  const result: SurfaceCandidate[] = [];
  let checked = 0;
  for (const recipe of FAMILIES) {
    const { family, cellM, slots, minSize, maxSize } = recipe;
    if (options.families && !options.families.includes(family)) continue;
    const halo = options.includeOverhang ? maxSize * (family === 'tree' ? TREE_CROWN_RADIUS_RATIO : 1) : 0;
    const query = { minX: Math.max(world.bounds.minX, bounds.minX - halo), minZ: Math.max(world.bounds.minZ, bounds.minZ - halo),
      maxX: Math.min(world.bounds.maxX, bounds.maxX + halo), maxZ: Math.min(world.bounds.maxZ, bounds.maxZ + halo) };
    for (let cz = Math.floor(query.minZ / cellM); cz <= Math.floor(query.maxZ / cellM); cz++) {
      for (let cx = Math.floor(query.minX / cellM); cx <= Math.floor(query.maxX / cellM); cx++) for (let slot = 0; slot < slots; slot++) {
        if (!(checked++ % 4096)) assertNotAborted(options.signal);
        const stableId = `${world.seed}:${family}:${cx}:${cz}:${slot}`;
        const rank = random(stableId, 8);
        if (rank >= retention) continue;
        const x = (cx + random(stableId, 1)) * cellM, z = (cz + random(stableId, 2)) * cellM;
        if (x < query.minX || x > query.maxX || z < query.minZ || z > query.maxZ) continue;
        const context = eligibility(x, z);
        // Water and construction override interpolated potential cover at the support point.
        if (context.waterClass !== WaterClass.Dry || context.occupation >= Occupation.Road || context.slope > 1.25) continue;
        let density = 0;
        switch (family) {
          case 'tree': density = treeAcceptanceForCover(context.treeCover); break;
          case 'shrub': density = context.shrubCover * .7; break;
          case 'grass': density = context.grassCover * .8; break;
          case 'boulder': density = context.stoniness * .35 * (context.occupation === Occupation.Natural ? 1 : .15); break;
          case 'debris': density = context.litter * .6; break;
        }
        if (random(stableId, 3) >= density) continue;
        if (context.occupation === Occupation.Crop && family !== 'grass') continue;
        const size = minSize + Math.pow(random(stableId, 4), family === 'boulder' ? 2.5 : 1) * (maxSize - minSize);
        const radius = family === 'tree' ? size * TREE_CROWN_RADIUS_RATIO : size;
        const outsideX = Math.max(bounds.minX - x, 0, x - bounds.maxX), outsideZ = Math.max(bounds.minZ - z, 0, z - bounds.maxZ);
        if (options.includeOverhang && outsideX ** 2 + outsideZ ** 2 > radius ** 2) continue;
        result.push({ stableId, family, x, y: sampleTerrainHeight(world.terrain,x,z), z, size, orientation: random(stableId, 5) * Math.PI * 2,
          variant: Math.floor(random(stableId, 6) * 8), rank, ...(family === 'tree' ? { crownRadiusM: radius } : {}) });
        if (result.length > maxCandidates) throw new PopulationBudgetError('candidates', 'Population query exceeds budget; request smaller visible bounds or stable rank retention');
      }
    }
  }
  return result;
}
