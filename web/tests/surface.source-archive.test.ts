import { describe, expect, it } from 'vitest';
import { archiveSurfaceSource, restoreSurfaceSource } from '../src/surface/adapters/sourceArchive';
import { exportSurfacePacket } from '../src/surface/adapters/export';
import { encodeSurfaceBinary, decodeSurfaceBinary } from '../src/surface/binary';
import type { Decor } from '../src/ui/decor';
import nativeScene from './fixtures/surface-native-city-plans.json';

describe('bounded binary source metadata', () => {
  it('archives native/editor/opaque metadata reversibly while keeping source identity visible', () => {
    const source = { meta: { id: 'source-id', seed: '47', query: 'source=neural-python', pipeline: { urban: { buildingState: { scene: nativeScene } } },
      opaque: { arrayType: 'user-domain', format: 'surface-source-archive-1', bytes: 'arbitrary-source-value' }, waterSvg: '<svg>' + 'x'.repeat(100000) + '</svg>',
      waterMaterial: { field: btoa('a'.repeat(20000)), n: 100, width: 1000 } } };
    const before = JSON.stringify(source), archived = archiveSurfaceSource(source);
    expect(archived.meta.id).toBe('source-id');
    expect(archived.meta.seed).toBe('47');
    expect(archived.$surfaceSourceArchive?.attachments.length).toBeGreaterThan(0);
    expect(restoreSurfaceSource(archived)).toEqual(source);
    const binary = encodeSurfaceBinary(archived), manifestBytes = new DataView(binary.buffer).getUint32(8, true);
    expect(manifestBytes).toBeLessThan(16384);
    const decoded = decodeSurfaceBinary<typeof archived>(binary);
    expect(restoreSurfaceSource(decoded)).toEqual(source);
    expect(JSON.stringify(source)).toBe(before);
    const malicious = structuredClone(archived); malicious.$surfaceSourceArchive!.attachments[0].path = ['__proto__', 'polluted'];
    expect(() => restoreSurfaceSource(malicious)).toThrow();
  });
  it('keeps million-cell water arrays in the binary payload and copies retained source values', () => {
    const n = 1024 ** 2, source = { water: { classes: new Uint8Array(n), levelM: new Float32Array(n), riverIds: new Int32Array(n), riverWidthM: new Float32Array(n) } };
    source.water.riverIds[n - 1] = 847; source.water.levelM[10] = NaN;
    const archived = archiveSurfaceSource(source), bytes = encodeSurfaceBinary(archived);
    expect(archived.water.classes).toBeInstanceOf(Uint8Array);
    expect(archived.water.levelM).toBeInstanceOf(Float32Array);
    expect(archived.water.riverIds).toBeInstanceOf(Int32Array);
    expect(archived.water.riverWidthM).toBeInstanceOf(Float32Array);
    expect(new DataView(bytes.buffer).getUint32(8, true)).toBeLessThan(2048);
    const decoded = decodeSurfaceBinary<typeof source>(bytes);
    expect(decoded.water.riverIds[n - 1]).toBe(847);
    expect(Number.isNaN(decoded.water.levelM[10])).toBe(true);
    archived.water.classes[0] = 3;
    expect(source.water.classes[0]).toBe(0);
  });
  it('exports all raw packet source raster channels as detached typed arrays', () => {
    const n = 64, decor = { meta: { id: 'unit-only-source', seed: '47', created: '2026-10-23', query: '' }, raster: { n, width: 1000,
      height: new Float32Array(n ** 2), water: new Uint8Array(n ** 2), waterLevel: new Float32Array(n ** 2),
      riverIds: new Int32Array(n ** 2), riverWidth: new Float32Array(n ** 2) } } as Decor;
    const packet = exportSurfacePacket(decor, undefined, { encoding: 'binary' });
    expect(packet.source.water.classes).toBeInstanceOf(Uint8Array);
    expect(packet.source.water.levelM).toBeInstanceOf(Float32Array);
    expect(packet.source.water.riverIds).toBeInstanceOf(Int32Array);
    expect(packet.source.water.riverWidthM).toBeInstanceOf(Float32Array);
    expect(new DataView(encodeSurfaceBinary(packet).buffer).getUint32(8, true)).toBeLessThan(1000000);
    packet.source.water.riverIds[0] = 47;
    expect(decor.raster.riverIds[0]).toBe(0);
  });
});
