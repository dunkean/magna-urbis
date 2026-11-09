import { describe, expect, it } from 'vitest';
import { deleteGridRiver } from '../../src/v2/gridRiverDeletion';
import type { VectorWater } from '../../src/ui/vectorWater';
import type { River } from '../../src/gen/types';
const point = (i: number) => ({ x: i % 4 + .5, y: Math.floor(i / 4) + .5 });
const river = (...path: number[]): River => ({ id: path[0], path: path.map(point), width: path.map(() => 1) });
function water(edges: [number, number][], lakes: number[] = []): VectorWater {
  const receiver = new Int32Array(16).fill(-1), sea = new Uint8Array(16), lake = new Uint8Array(16);
  for (const [from, to] of edges) receiver[from] = to;
  for (const i of lakes) lake[i] = 1;
  return { hydro: { n: 4, width: 4, receiver, accumulation: new Float32Array(16).fill(1000000), sea }, lake, riverArea: .02 } as unknown as VectorWater;
}
describe('grid river deletion', () => {
  it('removes upstream branches but preserves the shared junction and another tributary', () => {
    const source = water([[0,5],[1,5],[5,10],[2,6],[6,10],[10,15]]);
    const rivers = [river(0,5),river(1,5),river(5,10),river(2,6,10),river(10,15)];
    const result = deleteGridRiver(source,rivers,2);
    expect(result.rivers).toEqual([0,1,2]);
    expect(result.cells.sort((a,b)=>a-b)).toEqual([0,1,5]);
    expect([...result.water.hydro.receiver].filter((_,i)=>[0,1,5,6,10].includes(i))).toEqual([-1,-1,-1,10,15]);
    expect(source.hydro.receiver[5]).toBe(10);
    expect(result.water.hydro.accumulation).toBe(source.hydro.accumulation);
  });
  it('can remove upstream channels and submerged links while preserving the lake surface', () => {
    const source = water([[0,5],[5,10],[10,15]], [5]), rivers = [river(0,5),river(10,15)];
    const withLake = deleteGridRiver(source,rivers,1);
    expect(withLake.rivers).toEqual([0,1]);
    expect(withLake.water.hydro.receiver[5]).toBe(-1);
    expect(withLake.water.lake).toBe(source.lake);
    expect(deleteGridRiver(source,rivers,1,false).rivers).toEqual([1]);
  });
  it('rejects paths not belonging to the retained grid', () => {
    expect(()=>deleteGridRiver(water([[0,5]]),[river(0,6)],0)).toThrow(/does not match/);
  });
});
