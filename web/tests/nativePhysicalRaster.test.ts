import { expect, it, vi } from 'vitest';
import { uploadNativeRaster } from '../../rust/bridge/nativeEngine';
import type { SettlementRaster } from '../../rust/bridge/settlements';

it('uploads the independent physical height plane after capped planning planes', async () => {
  const n = 16, size = n * n;
  const raster: SettlementRaster = {
    width: 500, n, height: new Float32Array(size).fill(7), water: new Uint8Array(size),
    waterLevel: new Float32Array(size), riverWidth: new Float32Array(size), riverIds: new Int32Array(size).fill(-1),
    physical: { n: 32, height: new Float32Array(32 * 32).fill(17), interpolation: 'bspline', floor: .3 },
  };
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  try {
    await uploadNativeRaster({ profile: 'local', server: 'http://localhost:8791' }, 'physical-test', raster);
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as Blob;
    const bytes = await body.arrayBuffer(), view = new DataView(bytes);
    const headerLength = view.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, headerLength)));
    expect(header).toMatchObject({ session: 'physical-test', n: 16, physicalN: 32,
      physicalInterpolation: 'bspline', physicalFloor: .3, width: 500 });
    expect(bytes.byteLength).toBe(4 + headerLength + 17 * size + 4 * 32 * 32);
    expect(view.getFloat32(4 + headerLength + 17 * size, true)).toBe(17);
  } finally { vi.unstubAllGlobals(); }
});
