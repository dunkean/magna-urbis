import { sampleSurface } from './compiler';
import { Occupation, WaterClass, assertNotAborted, clamp, hashString, type Bounds, type SurfaceCandidate, type SurfaceWorld } from './model';

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
const FAMILIES: Array<{ family: SurfaceCandidate['family']; cellM: number; slots: number; minSize: number; maxSize: number }> = [
  { family: 'tree', cellM: 20, slots: 3, minSize: 4, maxSize: 18 },
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
  const retention = clamp(options.retention ?? 1), maxCandidates = options.maxCandidates ?? 100_000;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 0) throw new Error('maxCandidates must be a nonnegative integer');
  const maxCheckedSlots = options.maxCheckedSlots ?? 2_000_000;
  if (!Number.isInteger(maxCheckedSlots) || maxCheckedSlots < 0) throw new Error('maxCheckedSlots must be a nonnegative integer');
  if (retention === 0) return [];
  let slotsToCheck = 0;
  for (const recipe of FAMILIES) {
    if (options.families && !options.families.includes(recipe.family)) continue;
    const halo = options.includeOverhang ? recipe.maxSize : 0;
    const minX = Math.max(world.bounds.minX, bounds.minX - halo), minZ = Math.max(world.bounds.minZ, bounds.minZ - halo);
    const maxX = Math.min(world.bounds.maxX, bounds.maxX + halo), maxZ = Math.min(world.bounds.maxZ, bounds.maxZ + halo);
    if (minX > maxX || minZ > maxZ) continue;
    slotsToCheck += (Math.floor(maxX / recipe.cellM) - Math.floor(minX / recipe.cellM) + 1) * (Math.floor(maxZ / recipe.cellM) - Math.floor(minZ / recipe.cellM) + 1) * recipe.slots;
    if (slotsToCheck > maxCheckedSlots) throw new Error('Population query exceeds maxCheckedSlots; request smaller visible bounds');
  }
  const result: SurfaceCandidate[] = [];
  let checked = 0;
  for (const recipe of FAMILIES) {
    const { family, cellM, slots, minSize, maxSize } = recipe;
    if (options.families && !options.families.includes(family)) continue;
    const halo = options.includeOverhang ? maxSize : 0;
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
        const context = sampleSurface(world, x, z);
        // Water and construction override interpolated potential cover at the support point.
        if (context.waterClass !== WaterClass.Dry || context.occupation >= Occupation.Road || context.slope > 1.25) continue;
        let density = 0;
        switch (family) {
          case 'tree': density = context.treeCover * .8; break;
          case 'shrub': density = context.shrubCover * .7; break;
          case 'grass': density = context.grassCover * .8; break;
          case 'boulder': density = context.stoniness * .35 * (context.occupation === Occupation.Natural ? 1 : .15); break;
          case 'debris': density = context.litter * .6; break;
        }
        if (random(stableId, 3) > density) continue;
        if (context.occupation === Occupation.Crop && family !== 'grass') continue;
        const size = minSize + Math.pow(random(stableId, 4), family === 'boulder' ? 2.5 : 1) * (maxSize - minSize);
        const radius = family === 'tree' ? size * .28 : size;
        if (options.includeOverhang && (x + radius < bounds.minX || x - radius > bounds.maxX || z + radius < bounds.minZ || z - radius > bounds.maxZ)) continue;
        result.push({ stableId, family, x, y: context.heightM, z, size, orientation: random(stableId, 5) * Math.PI * 2,
          variant: Math.floor(random(stableId, 6) * 8), rank });
        if (result.length > maxCandidates) throw new Error('Population query exceeds budget; request smaller visible bounds or stable rank retention');
      }
    }
  }
  return result;
}
