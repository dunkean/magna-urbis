import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleNativeTerrain } from '../../rust/bridge/nativeTerrain';
import type { TerrainRequest } from '../../rust/bridge/terrain';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../rust/bridge/nativeEngine', () => ({ nativeRequest: transport.request, nativeSession: () => 'physical-test' }));

function reply(sourceN: number, floor: number): Response {
  const specs = ['height', 'normalX', 'normalY', 'normalZ'].map(name => ({ name, type: 'f32', count: 64 ** 2 }));
  specs.push({ name: 'field', type: 'f32', count: sourceN ** 2 }, { name: 'physical', type: 'f32', count: sourceN ** 2 });
  specs.push({ name: 'caveMask', type: 'u8', count: 0 });
  const meta = { session: 'physical-test', x: 0, y: 0, width: 1920, resolution: 64, minHeight: 10, maxHeight: 10,
    globalMinHeight: 10, globalMaxHeight: 10, motifSize: 1000, prepareMs: 0, samplingMs: 0,
    fieldN: sourceN, fieldExact: true, fieldFloor: floor, arrays: specs, erosionDefaults: [] };
  const json = new TextEncoder().encode(JSON.stringify(meta)), length = Math.ceil(json.length / 4) * 4;
  const buffer = new ArrayBuffer(4 + length + specs.reduce((bytes, spec) => bytes + spec.count * 4, 0));
  new DataView(buffer).setUint32(0, length, true);
  const header = new Uint8Array(buffer, 4, length); header.fill(32); header.set(json);
  new Float32Array(buffer, 4 + length).fill(10);
  return new Response(buffer);
}
const request = (spacing: number): TerrainRequest => ({ id: 1, generation: 1, kind: 'overview',
  runtime: { profile: 'local', server: 'http://127.0.0.1:8791' },
  settings: { seed: 'physical', width: 1920, sampleSpacing: spacing, resolution: 64, source: 'procedural', relief: 'hills',
    motifSize: 1000, erosion: 1, mountainMix: .5 }, region: { x: 0, y: 0, extent: 1920, resolution: 64 } });

describe('native physical terrain contract', () => {
  beforeEach(() => transport.request.mockReset());
  it('transmits the requested spacing and preserves the returned spline floor and source dimensions', async () => {
    transport.request.mockResolvedValueOnce(reply(32, .3)).mockResolvedValueOnce(reply(64, .3));
    const coarse = await sampleNativeTerrain(request(60)), fine = await sampleNativeTerrain(request(30));
    expect(coarse.field?.n).toBe(32); expect(fine.field?.n).toBe(64);
    expect(fine.field?.floor).toBe(.3); expect(fine.physical?.height.length).toBe(64 ** 2);
    const sent = transport.request.mock.calls.map(call => JSON.parse(call[2] as string).settings);
    expect(sent.map(settings => [settings.sampleSpacing, settings.sourceN])).toEqual([[60, 32], [30, 64]]);
  });
  it('rejects a stale service returning a different physical definition', async () => {
    transport.request.mockResolvedValueOnce(reply(32, 0));
    await expect(sampleNativeTerrain(request(30))).rejects.toThrow(/incompatible/);
  });
});
