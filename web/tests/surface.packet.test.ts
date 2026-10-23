import { describe, expect, it } from 'vitest';
import { compileSurfaceWorld, retargetSurfaceWorld } from '../src/surface/compiler';
import { validateSurfacePacket } from '../src/surface/packet';
import { decodeSurfaceBinary, encodeSurfaceBinary } from '../src/surface/binary';
const terrain = { width: 4, height: 4, originX: 5, originZ: 5, spacingM: 10, heights: new Float32Array(16).fill(100), source: { id: 'packet', version: '1', nativeSpacingM: 10, sourceLOD: 0 } };
const packet = () => ({ format: 'magna-surface-packet', version: 1, source: {}, world: compileSurfaceWorld({ seed: 1, terrain }) });
describe('binary surface packet boundary', () => {
  it('validates an exact typed round trip without replacing the numeric buffers', () => {
    const copy = decodeSurfaceBinary<any>(encodeSurfaceBinary(packet())), heights = copy.world.terrain.heights;
    validateSurfacePacket(copy); expect(copy.world.terrain.heights).toBe(heights);
    const bad = structuredClone(copy); bad.world.fields.sand = new Float32Array(15);
    expect(() => validateSurfacePacket(bad)).toThrow(/field sand/);
    bad.world.fields.sand = new Float32Array(16); bad.world.terrain.heights = new Float32Array(15);
    expect(() => validateSurfacePacket(bad)).toThrow(/terrain/);
  });
  it('requires context references and parent geometry to match the registered source', () => {
    const p: any = packet(); p.world = retargetSurfaceWorld(p.world, terrain);
    validateSurfacePacket(p);
    const bad = structuredClone(p); bad.world.canonicalContextRef!.id = 'unrelated';
    expect(() => validateSurfacePacket(bad)).toThrow(/reference mismatch/);
    p.terrainParents = [{ terrain: { ...terrain, source: { ...terrain.source, id: 'other' } }, canonicalContextId: p.world.canonicalContextRef!.id }];
    expect(() => validateSurfacePacket(p)).toThrow(/parent lineage/);
  });
});
