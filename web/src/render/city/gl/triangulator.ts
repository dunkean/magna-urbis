/**
 * Triangulation of the GPU town's polygons over a pool of workers (cityGlWorker.ts), on this thread for small
 * scenes or without workers. Owned by renderer.ts. Each kind of packing (the plan, the buildings) keeps its last
 * triangulation: a new packing triangulates only the polygons it does not repeat (triangulationCache.ts).
 */
import { mergeTriangulations, slicePolygons, splitPolygons, triangulatePolygons, type CityGlFillSource, type CityGlTriangulation } from '../../cityGlBuild';
import { countWork } from '../../workCount';
import { assembleTriangulation, polygonHashes, reusePlan, type HeldTriangulation } from './triangulationCache';
// walls hook (cityWalls.ts)

export class Triangulator {
  private workers: Worker[] = [];
  private next = 1;
  private pending = new Map<number, (r: CityGlTriangulation) => void>();
  private broken = false;
  private readonly held = new Map<string, HeldTriangulation>();
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
  /** The triangulation of `source`: the polygons the last packing of this `kind` held taken from it, the others
   * triangulated (`triangulated`: how many). */
  async run(source: CityGlFillSource, workers: number, kind: string): Promise<{ result: CityGlTriangulation; workers: number; triangulated: number }> {
    const p = source.polygons,
      held = this.held.get(kind);
    // The first packing of a kind is triangulated whole; the hashes are only computed when a later one compares.
    if (!held) {
      const whole = await this.triangulate(p, workers);
      this.held.set(kind, { polygons: p, result: whole.result });
      return { ...whole, triangulated: p.polys.length - 1 };
    }
    held.hashes ??= polygonHashes(held.polygons);
    const hashes = polygonHashes(p),
      plan = reusePlan(held, p, hashes);
    const fresh = plan.missingCount ? await this.triangulate(plan.missing, workers) : { result: { triangles: new Uint32Array(0), lines: new Uint32Array(0), polyTriangles: new Uint32Array(0), polyLines: new Uint32Array(0) }, workers: 0 };
    const result = plan.missingCount === hashes.length ? fresh.result : assembleTriangulation(held, p, plan.from, plan.missing, fresh.result);
    this.held.set(kind, { polygons: p, result, hashes });
    return { result, workers: fresh.workers, triangulated: plan.missingCount };
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
  }
}
