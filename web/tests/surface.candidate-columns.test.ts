import { describe, expect, it } from 'vitest';
import { packCandidateColumns, unpackCandidateColumns } from '../src/surface/candidateColumns';
import { encodeSurfaceBinary, decodeSurfaceBinary } from '../src/surface/binary';
import { exportSurfacePacket } from '../src/surface/adapters/export';
import type { SurfaceCandidate } from '../src/surface/model';
import type { Decor } from '../src/ui/decor';

const candidate = (i: number): SurfaceCandidate => ({ stableId: `source:tree:world-cell-${i}:slot-3`, family: i % 2 ? 'tree' : 'boulder',
  x: 1e9 + i * .000001, y: -400 + i * .00001, z: -1e9 - i * .000001,
  size: 4.123456789, orientation: 6.283185306 + i * .00000001, rank: i % 2 ? 1 - 2 ** -32 : .123456789, variant: i % 256,
  ...(i % 2 ? { crownRadiusM: 4.123456789 * .42 } : {}) });
describe('versioned neutral candidate columns', () => {
  it('keeps 100000 stable IDs and float64 positions exact with a bounded binary manifest', () => {
    const source = Array.from({ length: 100000 }, (_, i) => candidate(i));
    const packed = packCandidateColumns(source), encoded = encodeSurfaceBinary({ candidateColumns: packed });
    expect(new DataView(encoded.buffer).getUint32(8, true)).toBeLessThan(16 * 1024 ** 2);
    expect(new DataView(encoded.buffer).getUint32(8, true)).toBeLessThan(8 * 1024 ** 2);
    const decoded = decodeSurfaceBinary<{ candidateColumns: typeof packed }>(encoded);
    const restored = unpackCandidateColumns(decoded.candidateColumns);
    for (const i of [0, 1, 999, 99999]) {
      const original = source[i], value = restored[i];
      expect([value.stableId, value.family, value.x, value.y, value.z, value.variant]).toEqual([original.stableId, original.family, original.x, original.y, original.z, original.variant]);
      expect(value.orientation).toBe(Math.fround(original.orientation));
      expect(value.size).toBe(Math.fround(original.size));
      expect(value.rank).toBe(Math.min(1 - 2 ** -24, Math.fround(original.rank)));
      if (original.crownRadiusM !== undefined) expect(value.crownRadiusM).toBe(Math.fround(original.crownRadiusM));
      else expect(value).not.toHaveProperty('crownRadiusM');
    }
    expect(restored.every(c => c.rank >= 0 && c.rank < 1)).toBe(true);
    packed.positions[0] = 0; packed.ids[0] = 'changed';
    expect(source[0].x).toBe(1e9); expect(source[0].stableId).not.toBe('changed');
  });
  it('rejects lossy coercions, rank overflow, bad codes and unsupported versions', () => {
    for (const patch of [{ rank: 1 }, { rank: -1 }, { rank: NaN }, { variant: 256 }, { variant: .5 }, { x: Infinity }, { size: 1e100 }, { size: 1e-100 }, { crownRadiusM: 0 }])
      expect(() => packCandidateColumns([{ ...candidate(1), ...patch }])).toThrow();
    const columns = packCandidateColumns([candidate(0), candidate(1)]);
    expect(() => unpackCandidateColumns({ ...columns, version: 2 })).toThrow();
    expect(() => unpackCandidateColumns({ ...columns, rank: [0, .1] })).toThrow();
    expect(() => unpackCandidateColumns({ ...columns, positions: new Float32Array(6) })).toThrow();
    const badRank = structuredClone(columns); badRank.rank[0] = 1;
    expect(() => unpackCandidateColumns(badRank)).toThrow();
    const badFamily = structuredClone(columns); badFamily.family[0] = 255;
    expect(() => unpackCandidateColumns(badFamily)).toThrow();
    expect(() => packCandidateColumns([candidate(0), candidate(0)])).toThrow();
  });
  it('uses numeric columns only for binary packets while leaving JSON candidates compatible', () => {
    const n = 3, decor = { meta: { id: 'unit-only', seed: '47', created: 'today', query: '' }, raster: { n, width: 120,
      height: new Float32Array(n*n), water: new Uint8Array(n*n), waterLevel: new Float32Array(n*n), riverIds: new Int32Array(n*n), riverWidth: new Float32Array(n*n) } } as Decor;
    const raw = exportSurfacePacket(decor, undefined, { encoding: 'binary' });
    const json = exportSurfacePacket(decor);
    expect(raw).not.toHaveProperty('candidates'); expect(raw.candidateColumns?.format).toBe('surface-candidate-columns');
    expect(json).not.toHaveProperty('candidateColumns'); expect(Array.isArray(json.candidates)).toBe(true);
    expect(raw.candidateColumns?.count).toBe(json.candidates?.length);
  });
});
