/** D8 grid channel deletion. The native drainage accumulation remains physical data;
 * only selected channel receiver edges are cut, on a copied receiver plane. */
import type { River } from '../gen/types';
import type { VectorWater } from '../ui/vectorWater';

export interface GridRiverDeletion {
  water: VectorWater;
  /** Indices into the original projected river list. */
  rivers: number[];
  /** IDs are the starting grid-cell indices used by terrainProjection. */
  streams: number[];
  /** Sources of the removed D8 edges. The final shared junction is not cut. */
  cells: number[];
}

export function deleteGridRiver(water: VectorWater, rivers: readonly River[], selected: number, throughLakes = true): GridRiverDeletion {
  if (water.rivers) throw new Error('Grid deletion requires a grid-projected network.');
  const h = water.hydro, total = h?.n * h?.n, river = rivers[selected];
  if (!h || !river || river.path.length < 2 || !Number.isInteger(h.n) || h.n < 1 || !(h.width > 0)
      || !h.receiver || !h.accumulation || !h.sea || !water.lake
      || h.receiver.length !== total || h.accumulation.length !== total || h.sea.length !== total || water.lake.length !== total)
    throw new Error('Invalid grid river network.');
  const cell = h.width / h.n;
  const index = (p: { x: number; y: number }): number => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return -1;
    const x = Math.floor(p.x / cell), y = Math.floor(p.y / cell);
    if (x < 0 || y < 0 || x >= h.n || y >= h.n || Math.abs(p.x - (x + .5) * cell) > cell * 1e-5 || Math.abs(p.y - (y + .5) * cell) > cell * 1e-5) return -1;
    return y * h.n + x;
  };
  const path = river.path.map(index);
  const threshold = (water.riverArea ?? Math.max(.02, .003 * (h.width / 1000) ** 2)) * 1e6;
  const active = (i: number): boolean => i >= 0 && i < total && !h.sea[i] && !water.lake[i] && h.accumulation[i] >= threshold;
  if (river.id !== path[0] || path.some(i => i < 0) || path.slice(0, -1).some((i, k) => !active(i) || h.receiver[i] !== path[k + 1]))
    throw new Error('The selected river does not match the retained grid.');
  // Reverse adjacency includes active channel cells, and optionally lake cells,
  // so all tributaries are found without traversing ordinary hillslope drainage.
  const eligible = (i: number): boolean => active(i) || (throughLakes && !h.sea[i] && !!water.lake[i]);
  const heads = new Int32Array(total).fill(-1), next = new Int32Array(total).fill(-1);
  for (let i = 0; i < total; i++) {
    const to = h.receiver[i];
    if (to >= 0 && to < total && to !== i && eligible(i) && eligible(to)) { next[i] = heads[to]; heads[to] = i; }
  }
  const visited = new Uint8Array(total), queue: number[] = [];
  for (const i of path.slice(0, -1)) if (!visited[i]) { visited[i] = 1; queue.push(i); }
  for (let k = 0; k < queue.length; k++) for (let donor = heads[queue[k]]; donor >= 0; donor = next[donor]) {
    if (!visited[donor]) { visited[donor] = 1; queue.push(donor); }
  }
  // Submerged connecting edges belong to the deleted network too; otherwise
  // hiding lake surfaces would reveal short orphan channels through the lake.
  const cells = queue.filter(eligible), receiver = h.receiver.slice();
  for (const i of cells) receiver[i] = -1;
  const indices: number[] = [], streams: number[] = [];
  for (let i = 0; i < rivers.length; i++) {
    const id = rivers[i].id;
    if (id !== undefined && Number.isInteger(id) && id >= 0 && id < total && visited[id] && active(id)) { indices.push(i); streams.push(id); }
  }
  if (!indices.includes(selected)) throw new Error('The selected river does not match the retained grid.');
  return { water: { ...water, hydro: { ...h, receiver } }, rivers: indices, streams, cells };
}
