import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../src/v2/project';
import { isBinaryProject, parseProjectBinary, serializeProjectBinary } from '../src/v2/projectBinary';
import { defaultSettings } from '../src/v2/settings';
import type { World } from '../src/gen/types';

const magic = new Uint8Array([0x4d, 0x55, 0x50, 0x52, 0x4f, 0x4a, 0, 1]);
async function compressed(parts: BlobPart[]): Promise<ArrayBuffer> {
  const gzip = await new Response(new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return new Blob([magic, gzip]).arrayBuffer();
}
async function packed(skeleton: unknown, blocks: BlobPart[] = []): Promise<ArrayBuffer> {
  const text = new TextEncoder().encode(JSON.stringify(skeleton)),
    header = new ArrayBuffer(4);
  new DataView(header).setUint32(0, text.length, true);
  return compressed([header, text, ...blocks]);
}
function fixture() {
  const settings = defaultSettings();
  settings.options.seed = 'binary-round-trip';
  settings.extent = 1200;
  const shared = Float32Array.from({ length: 256 }, (_, i) => 10 + i / 7);
  settings.options.importedHeight = { w: 16, h: 16, rgba: new Uint8Array(0), elevations: shared };
  const grid = (data: Float32Array) => ({ w: 16, h: 16, cell: 75, data });
  const world: World = {
    seed: settings.options.seed,
    options: { ...settings.options },
    mapSize: 1200,
    terrain: {
      height: grid(shared),
      slope: grid(new Float32Array(256).fill(0.25)),
      flow: grid(new Float32Array(256).fill(1)),
      filled: shared,
      receiver: new Int32Array(256).fill(-1),
      water: new Uint8Array(256),
      seaLevel: 0,
      seaFraction: 0,
      coastline: [],
      lakes: [],
      rivers: [],
      downSide: 'S',
      seaSide: null,
    },
    stats: { missingMeasurement: NaN, unreachable: Infinity },
  };
  return { settings, world, mods: [{ samples: shared, mask: new Uint8Array([0, 1, 255]) }] };
}

describe('V2 binary project files', () => {
  it('matches the JSON round trip, retaining shared views and nonfinite world numbers', async () => {
    const { settings, world, mods } = fixture();
    const json = serializeProject(settings, world, mods),
      blob = await serializeProjectBinary(settings, world, mods);
    const input = await blob.arrayBuffer(),
      before = input.slice(0),
      read = await parseProjectBinary(input);
    expect(isBinaryProject(new Uint8Array(input))).toBe(true);
    expect(read).toEqual(parseProject(json));
    expect(read.world!.terrain.height.data).toBe(read.world!.terrain.filled);
    expect(read.settings.options.importedHeight!.elevations).toBe(read.world!.terrain.filled);
    expect((read.mods[0] as (typeof mods)[0]).samples).toBe(read.world!.terrain.filled);
    expect(Number.isNaN(read.world!.stats.missingMeasurement)).toBe(true);
    expect(read.world!.terrain.receiver).toBeInstanceOf(Int32Array);
    expect(read.world!.terrain.water).toBeInstanceOf(Uint8Array);
    expect(input).toEqual(before);
    read.world!.terrain.height.data[0] = 999;
    expect(world.terrain.height.data[0]).toBe(10);
    expect(blob.size).toBeLessThan(new TextEncoder().encode(json).length);
    console.info(`Round-trip fixture: JSON ${new TextEncoder().encode(json).length} bytes; .muproj ${blob.size} bytes.`);
  });

  it('preserves every supported array type, raw bits, subviews and empty arrays', async () => {
    const backing = new Float32Array([99, -0, NaN, Infinity, 99]);
    const arrays = [
      backing.subarray(1, 4),
      new Float64Array([-0, -Infinity, Math.PI]),
      new Int8Array([-128, 127]),
      new Int16Array([-32768, 32767]),
      new Int32Array([-2147483648, 2147483647]),
      new Uint8Array([0, 255]),
      new Uint8ClampedArray([0, 255]),
      new Uint16Array([65535]),
      new Uint32Array([4294967295]),
      new BigInt64Array([-9223372036854775808n]),
      new BigUint64Array([18446744073709551615n]),
      new Float32Array(0),
    ];
    const blob = await serializeProjectBinary(defaultSettings(), undefined, [{ arrays }]);
    const read = await parseProjectBinary(await blob.arrayBuffer());
    const actual = (read.mods[0] as { arrays: typeof arrays }).arrays;
    arrays.forEach((array, index) => {
      expect(actual[index].constructor).toBe(array.constructor);
      expect(new Uint8Array(actual[index].buffer)).toEqual(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      expect(actual[index].byteOffset).toBe(0);
    });
    // Verify the on-disk byte order and first block's 8-byte alignment independently.
    const payload = await new Response(blob.slice(8).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const start = Math.ceil((4 + new DataView(payload).getUint32(0, true)) / 8) * 8;
    expect(new DataView(payload).getUint32(start, true)).toBe(0x80000000);
    expect(new DataView(payload).getFloat32(start + 8, true)).toBe(Infinity);
  });

  it('round-trips settings-only projects through the same JSON validation', async () => {
    const settings = defaultSettings(),
      blob = await serializeProjectBinary(settings);
    expect(await parseProjectBinary(await blob.arrayBuffer())).toEqual(parseProject(serializeProject(settings)));
  });

  it('rejects bad magic and unknown versions', async () => {
    const version = magic.slice();
    version[7] = 2;
    for (const bytes of [new Uint8Array(), new TextEncoder().encode('not a project'), version]) {
      expect(isBinaryProject(bytes)).toBe(false);
      await expect(parseProjectBinary(bytes.buffer)).rejects.toThrow(/magic|version/);
    }
  });

  it('rejects truncated gzip streams, including a missing footer', async () => {
    const buffer = await (await serializeProjectBinary(defaultSettings())).arrayBuffer();
    for (const end of [8, Math.floor(buffer.byteLength / 2), buffer.byteLength - 4]) {
      await expect(parseProjectBinary(buffer.slice(0, end))).rejects.toThrow(/truncated gzip/);
    }
  });

  it('rejects truncated skeletons and binary blocks even inside a complete gzip stream', async () => {
    await expect(parseProjectBinary(await compressed([new Uint8Array(3)]))).rejects.toThrow(/skeleton/);
    const header = new ArrayBuffer(4);
    new DataView(header).setUint32(0, 9999, true);
    await expect(parseProjectBinary(await compressed([header, '{}']))).rejects.toThrow(/skeleton/);
    const skeleton = JSON.parse(serializeProject(defaultSettings()));
    skeleton.mods = [{ $mub: 0, type: 'Float32Array', length: 8 }];
    await expect(parseProjectBinary(await packed(skeleton))).rejects.toThrow(/truncated binary/);
  });

  it('rejects invalid array indices, types, lengths and trailing bytes', async () => {
    const skeleton = JSON.parse(serializeProject(defaultSettings()));
    for (const ref of [
      { $mub: 1, type: 'Float32Array', length: 0 },
      { $mub: 0, type: 'constructor', length: 0 },
      { $mub: -1, type: 'Uint8Array', length: 0 },
      { $mub: 0, type: 'Uint8Array', length: -1 },
    ]) {
      await expect(parseProjectBinary(await packed({ ...skeleton, mods: [ref] }))).rejects.toThrow(/array reference/);
    }
    await expect(parseProjectBinary(await packed(skeleton, [new Uint8Array([1])]))).rejects.toThrow(/trailing/);
  });

  it('uses JSON import validation for forbidden fields and invalid settings or modifications', async () => {
    const skeleton = JSON.parse(serializeProject(defaultSettings()));
    const forbidden = JSON.parse('{"nested":{"__proto__":{}}}');
    for (const candidate of [
      { ...skeleton, mods: [forbidden] },
      { ...skeleton, mods: [NaN] },
      { ...skeleton, settings: { ...skeleton.settings, settlementCount: -1 } },
    ]) {
      // NaN uses the existing tagged convention rather than JSON.stringify's null.
      if (Number.isNaN(candidate.mods[0])) candidate.mods = [{ $mu: 'number', value: 'NaN' }];
      expect(() => parseProject(JSON.stringify(candidate))).toThrow();
      await expect(parseProjectBinary(await packed(candidate))).rejects.toThrow();
    }
  });
});
