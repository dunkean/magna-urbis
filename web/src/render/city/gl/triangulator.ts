/**
 * Triangulation of the GPU town's polygons over a pool of workers (cityGlWorker.ts), on this thread for small
 * scenes or without workers. Owned by renderer.ts. Each kind of packing (the plan, the buildings) keeps its last
 * triangulation: a new packing triangulates only the polygons it does not repeat (triangulationCache.ts).
 */
import { mergeTriangulations, slicePolygons, splitPolygons, triangulatePolygons, type CityGlFillSource, type CityGlTriangulation } from '../../cityGlBuild';
import { countWork } from '../../workCount';
import { assembleTriangulation, polygonHashes, reusePlan, type HeldTriangulation } from './triangulationCache';
import { concatPolygons, splitTriangulation } from './pages';
// walls hook (cityWalls.ts)

type Polygons = CityGlFillSource['polygons'];
const EMPTY: CityGlTriangulation = { triangles: new Uint32Array(), lines: new Uint32Array(), polyTriangles: new Uint32Array(), polyLines: new Uint32Array() };

export class Triangulator {
  private workers: Worker[] = [];
  private next = 1;
  private pending = new Map<number, (r: CityGlTriangulation) => void>();
  private broken = false;
  private readonly held = new Map<string, Map<number, HeldTriangulation>>();
  private readonly revisions = new Map<string, number>();
  private pool(n: number): Worker[] {
    if (this.broken || typeof Worker === 'undefined' || n <= 0) return [];
    try {
      while (this.workers.length < n) {
        const w = new Worker(new URL('../../cityGlWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<CityGlTriangulation & { id: number }>) => {
          const done = this.pending.get(e.data.id);
          this.pending.delete(e.data.id);
          done?.(e.data);
        };
        w.onerror = () => {
          this.broken = true;
        };
        this.workers.push(w);
      }
    } catch {
      this.broken = true;
      return [];
    }
    return this.workers.slice(0, n);
  }
  /** Match within each repacked region, then triangulate the unmatched polygons together across the worker pool. */
  async run(regions: readonly { key: number; polygons: Polygons }[], workers: number, kind: string, liveKeys: readonly number[]): Promise<{ results: CityGlTriangulation[]; workers: number; triangulated: number }> {
    const revision = (this.revisions.get(kind) ?? 0) + 1;
    this.revisions.set(kind, revision);
    const held = this.held.get(kind) ?? new Map<number, HeldTriangulation>();
    const plans = regions.map(({ key, polygons }) => {
      const previous = held.get(key);
      const hashes = previous ? polygonHashes(polygons) : undefined;
      const reuse = previous && hashes ? reusePlan(previous, polygons, hashes) : undefined;
      return { previous, hashes, reuse, missing: reuse?.missing ?? polygons, count: reuse?.missingCount ?? polygons.polys.length - 1 };
    });
    const missing = plans.filter(plan => plan.count).map(plan => plan.missing);
    const all = missing.length ? await this.triangulate(missing.length === 1 ? missing[0] : concatPolygons(missing), workers) : { result: EMPTY, workers: 0 };
    const parts = missing.length === 1 ? [all.result] : splitTriangulation(all.result, missing);
    let part = 0;
    const current = this.revisions.get(kind) === revision;
    const results = regions.map(({ key, polygons }, i) => {
      const { previous, hashes, reuse, count } = plans[i];
      const fresh = count ? parts[part++] : EMPTY;
      const result = reuse && count < reuse.from.length ? assembleTriangulation(previous, polygons, reuse.from, reuse.missing, fresh) : fresh;
      if (current) held.set(key, { polygons, result, hashes });
      return result;
    });
    if (current) {
      const live = new Set(liveKeys);
      for (const key of held.keys()) if (!live.has(key)) held.delete(key);
      this.held.set(kind, held);
    }
    return { results, workers: all.workers, triangulated: plans.reduce((sum, plan) => sum + plan.count, 0) };
  }
  /** Parallel when the packing is large and workers are available; otherwise on this thread. */
  private async triangulate(p: CityGlFillSource['polygons'], workers: number): Promise<{ result: CityGlTriangulation; workers: number }> {
    countWork('town.triangulate');
    const polys = p.polys.length - 1;
    const pool = polys > 3000 ? this.pool(workers) : [];
    if (!pool.length) return { result: triangulatePolygons(p), workers: 0 };
    const ranges = splitPolygons(p, pool.length);
    try {
      const parts = await Promise.all(
        ranges.map(([from, to], k) => {
          const slice = slicePolygons(p, from, to),
            id = this.next++;
          return new Promise<{ result: CityGlTriangulation; vertexOffset: number }>((resolve, reject) => {
            const timer = setTimeout(() => {
              this.pending.delete(id);
              reject(new Error('cityGl worker timeout'));
            }, 60000);
            this.pending.set(id, r => {
              clearTimeout(timer);
              resolve({ result: r, vertexOffset: slice.vertexOffset });
            });
            const { coords, rings, polys, hiddenEdges } = slice;
            const transfer: Transferable[] = [coords.buffer, rings.buffer, polys.buffer];
            if (hiddenEdges) transfer.push(hiddenEdges.buffer);
            pool[k].postMessage({ id, coords, rings, polys, hiddenEdges }, transfer);
          });
        }),
      );
      return { result: mergeTriangulations(parts), workers: pool.length };
    } catch {
      this.broken = true;
      return { result: triangulatePolygons(p), workers: 0 };
    }
  }
  dispose(): void {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.pending.clear();
    this.held.clear();
    this.revisions.clear();
  }
}
