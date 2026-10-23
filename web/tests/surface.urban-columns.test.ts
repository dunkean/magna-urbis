import { describe, expect, it } from 'vitest';
import fixture from './fixtures/surface-native-city-plans.json';
import { magnaUrbanPacket, magnaUrbanIdentity } from '../src/surface/adapters/magnaUrban';
import { exportSurfacePacket, exportSurfaceInputPacket } from '../src/surface/adapters/export';
import { decorToSurfaceInput } from '../src/surface/adapters/magna';
import { packUrbanColumns, unpackUrbanColumns, validateUrbanColumns, type UrbanPacket } from '../src/surface/urbanColumns';
import { encodeSurfaceBinary, decodeSurfaceBinary } from '../src/surface/binary';
import { packCandidateColumns } from '../src/surface/candidateColumns';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';
import type { Decor } from '../src/ui/decor';
import { occupationFromMagnaScene } from '../src/surface/adapters/occupation';

describe('lossless native urban transport', () => {
  it('roundtrips 500 existing-native-plan load records and 100000 candidates below the manifest limit', () => {
    // Transport stress instances copied from genuine cached accepted plans.
    // This is a payload load test, not a claim of generating a 500-house city.
    const buildings = Array.from({ length: 500 }, (_, i) => ({ ...structuredClone(fixture.buildings[i % 2]), id: `load-instance:${i}`, parcel_id: `load-parcel:${i}` }));
    const scene = { buildings, materials: fixture.materials } as unknown as Building3dScene;
    const original = magnaUrbanPacket(undefined, scene) as UrbanPacket;
    const packed = packUrbanColumns(original);
    const candidates = packCandidateColumns(Array.from({ length: 100000 }, (_, i) => ({ stableId: `47:tree:${i}:3`, family: 'tree' as const,
      x: 1000 + i / 1e6, y: 30.123456789, z: -1000 - i / 1e6, size: 11, orientation: 1.2, variant: i % 8, rank: i / 100001, crownRadiusM: 4.62 })));
    const binary = encodeSurfaceBinary({ urban: packed, candidateColumns: candidates });
    const manifestBytes = new DataView(binary.buffer).getUint32(8, true);
    expect(manifestBytes).toBeLessThan(16 * 1024 ** 2);
    const decoded = decodeSurfaceBinary<{ urban: typeof packed }>(binary), restored = unpackUrbanColumns(decoded.urban);
    expect(restored).toStrictEqual(original);
    expect(restored.buildings).toHaveLength(500);
    expect(restored.buildings.map(b => b.id)).toEqual(buildings.map(b => b.id));
    expect(restored.buildings[0].nativeLevels[0].levels).toStrictEqual(buildings[0].volumes[0].levels);
    expect(packed.positions).toBeInstanceOf(Float64Array); expect(packed.normals).toBeInstanceOf(Float64Array);
    expect(packed.buildingTriangleOffsets[500]).toBe(original.buildings.reduce((n, b) => n + b.triangles.length, 0));
    expect(magnaUrbanIdentity(packed)).toBe(magnaUrbanIdentity(restored));
  });
  it('preserves diagnostic hole winding, level altitudes, road materials and exact double coordinates', () => {
    const urban = magnaUrbanPacket(undefined, fixture as unknown as Building3dScene, 100, 200,
      [{ id: 'road-source', sourceIndex: 84, points: [[1e9 + .000001, -1e9 - .000001], [1e9 + .25, -1e9]], widthM: 3.25, surface: 'flagstone', class: 'main', profile: 'roman' }]) as UrbanPacket;
    // Codec-only analytical hole added to the detached DTO; never a native realization input.
    const hole = [{x: 2723.001, y: 2972.001},{x:2724.002,y:2972.001},{x:2724.002,y:2973.002}];
    urban.buildings[0].footprint[0].holes.push(hole);
    const restored = unpackUrbanColumns(packUrbanColumns(urban));
    expect(restored).toStrictEqual(urban);
    expect(restored.buildings[0].footprint[0].holes[0]).toStrictEqual(hole);
    expect(restored.roads![0].sourceIndex).toBe(84); expect(restored.roads![0].surface).toBe('flagstone');
    expect(restored.buildings[0].nativeLevels[0].levels[0].z_m).toBe(urban.buildings[0].nativeLevels[0].levels[0].z_m);
  });
  it('uses a single urban schema and identity for export/direct/worker-compatible producers', () => {
    const n = 3, decor = { meta: { id: 'unit',seed: '47',created:'today',query:'',roads:{segments:[{path:[{x:0,y:0},{x:10,y:10}],width:3,surface:'paved',class:'main',profile:'roman',a:4,b:9}] } },
      raster: { n,width:30,height:new Float32Array(n*n),water:new Uint8Array(n*n),waterLevel:new Float32Array(n*n),riverIds:new Int32Array(n*n),riverWidth:new Float32Array(n*n) } } as unknown as Decor;
    const scene = fixture as unknown as Building3dScene, common = magnaUrbanPacket(decor,scene,0,0,undefined,'binary');
    const exported = exportSurfacePacket(decor,scene,{encoding:'binary'});
    expect(exported.urban).toStrictEqual(common);
    const roads = unpackUrbanColumns(common).roads!;
    const direct = exportSurfaceInputPacket(decorToSurfaceInput(decor),scene,{meta:decor.meta}, { encoding:'binary',roads: roads as any });
    expect(direct.urban).toStrictEqual(common);
    expect(direct.urbanId).toBe(exported.urbanId);
    expect(direct.urban.roadsCoordinateSystem).toBe('metric-xz');
    expect(unpackUrbanColumns(direct.urban).roads![0]).toMatchObject({surface:'paved',class:'main',profile:'roman',a:4,b:9});
  });
  it('rejects malformed geometry offsets, material indices and shape references', () => {
    const c = packUrbanColumns(magnaUrbanPacket(undefined, fixture as unknown as Building3dScene) as UrbanPacket);
    const badOffset = structuredClone(c); badOffset.ringPointOffsets[1] = 0xffffffff;
    expect(() => validateUrbanColumns(badOffset)).toThrow();
    const badMaterial = structuredClone(c); badMaterial.triangleSlots[0] = 0xffffffff;
    expect(() => validateUrbanColumns(badMaterial)).toThrow();
    const badShape = structuredClone(c); badShape.buildings[0].footprint = 0xffffffff;
    expect(() => validateUrbanColumns(badShape)).toThrow();
    const badPosition = structuredClone(c); badPosition.positions[0] = NaN;
    expect(() => validateUrbanColumns(badPosition)).toThrow();
  });
  it('fingerprints occupation typed bytes with physical grid identity and orientation', () => {
    const terrain = {width:2,height:2,originX:.5,originZ:.5,spacingM:1,heights:new Float32Array(4),source:{id:'unit',version:'1',sourceLOD:0,nativeSpacingM:1}};
    const a = occupationFromMagnaScene(terrain,undefined,[],{version:'source',classes:new Uint8Array(4),orientationRadians:new Float32Array(4)});
    const orientation = new Float32Array(4); orientation[3]=.125;
    const b = occupationFromMagnaScene(terrain,undefined,[],{version:'source',classes:new Uint8Array(4),orientationRadians:orientation});
    expect(a.version).not.toBe(b.version);
    expect(a.version).not.toBe(occupationFromMagnaScene({...terrain,originX:1.5}).version);
    expect(a.version).toMatch(/^magna-occupation:[0-9a-f]{32}$/);
  });
});
