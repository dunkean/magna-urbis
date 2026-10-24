/** Complete density of accepted native plans, NOT occupied surfaces/population.
 * Two streaming passes, one <=64-record derived chunk at a time; no native reads.
 * This first primitive does not persist its aggregate or replace the product UI. */
import type { ChunkBounds } from './urbanBuildingChunkStore';
import type { openDerivedCache } from './urbanBuildingDerivedCache';
import type { NativeBuildingProjection } from './urbanBuildingProjection';

export interface ColdOverview {
  readonly kind: 'accepted-plan-anchor-density-1';
  readonly parentFingerprint: string; readonly derivedFingerprint: string;
  readonly bounds: Readonly<ChunkBounds>; readonly resolution: number;
  readonly buildings: number; readonly counts: Uint32Array;
}
export type DerivedReader = Awaited<ReturnType<typeof openDerivedCache>>;
/** First actual body outer vertex, or actual roof vertex when no body exists.
 * Never a fabricated centroid falling inside a courtyard; no area is implied. */
function anchor(building: NativeBuildingProjection) {
  const point = building.footprint.find(s => s.outer.length)?.outer[0]
    ?? building.roof_footprint.find(s => s.outer.length)?.outer[0];
  if (!point) throw new Error('Accepted plan lacks overview geometry.');
  return point;
}
export async function buildColdOverview(reader: DerivedReader, options: {
  resolution?: number; signal?: AbortSignal; maxChunkBytes?: number;
} = {}): Promise<ColdOverview> {
  const resolution = options.resolution ?? 1024, signal = options.signal;
  if (!Number.isSafeInteger(resolution) || resolution < 1 || resolution > 1024) throw new Error('Invalid overview buffer budget.');
  const bounds: ChunkBounds = [Infinity, Infinity, -Infinity, -Infinity];
  let total = 0;
  const visit = async (body: (b: NativeBuildingProjection) => void) => {
    for (const chunk of reader.manifest.chunks) {
      signal?.throwIfAborted();
      if (chunk.bytes > (options.maxChunkBytes ?? 32 * 1024 * 1024)) throw new Error('Overview derived chunk exceeds decode budget.');
      const payload = await reader.chunk(chunk.index, signal);
      for (const building of payload.projection.buildings) body(building);
      // No payload, ID set, surface or site retained across chunks.
    }
  };
  await visit(building => {
    const p = anchor(building); total++;
    bounds[0] = Math.min(bounds[0], p.x); bounds[1] = Math.min(bounds[1], p.y);
    bounds[2] = Math.max(bounds[2], p.x); bounds[3] = Math.max(bounds[3], p.y);
  });
  if (total !== reader.manifest.buildings || total > 0xffffffff) throw new Error('Incomplete/unrepresentable overview count.');
  if (!total) bounds.splice(0, 4, 0, 0, 0, 0);
  const counts = new Uint32Array(resolution * resolution); let assigned = 0;
  await visit(building => {
    const p = anchor(building);
    const cell = (v: number, lo: number, hi: number) => hi === lo ? 0 : Math.min(resolution - 1, Math.floor((v - lo) / (hi - lo) * resolution));
    const x = cell(p.x, bounds[0], bounds[2]), y = cell(p.y, bounds[1], bounds[3]);
    if (x < 0 || y < 0 || x >= resolution || y >= resolution) throw new Error('Overview source changed during traversal.');
    counts[y * resolution + x]++; assigned++;
  });
  signal?.throwIfAborted();
  if (assigned !== total) throw new Error('Incomplete overview traversal.');
  // Uint32Array remains borrowed read-only by contract (JS cannot freeze its elements).
  return Object.freeze({ kind: 'accepted-plan-anchor-density-1', parentFingerprint: reader.manifest.parentFingerprint,
    derivedFingerprint: reader.manifest.fingerprint, bounds: Object.freeze(bounds), resolution, buildings: total, counts });
}
