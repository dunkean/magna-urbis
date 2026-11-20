/**
 * Triangulation of the GPU town's polygons over a pool of workers (cityGlWorker.ts), on this thread for small
 * scenes or without workers. Owned by renderer.ts.
 */
import { mergeTriangulations, slicePolygons, splitPolygons, triangulatePolygons, type CityGlFillSource, type CityGlTriangulation } from '../../cityGlBuild';
import { countWork } from '../../workCount';
// walls hook (cityWalls.ts)

export class Triangulator {
  private workers: Worker[] = [];
  private next = 1;
  private pending = new Map<number, (r: CityGlTriangulation) => void>();
  private broken = false;
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
  /** Parallel when the packing is large and workers are available; otherwise on this thread. */
  async run(source: CityGlFillSource, workers: number): Promise<{ result: CityGlTriangulation; workers: number }> {
    countWork('town.triangulate');
    const p = source.polygons,
      polys = p.polys.length - 1;
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
  }
}
