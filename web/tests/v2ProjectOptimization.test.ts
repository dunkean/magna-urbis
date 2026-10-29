import { describe, expect, it } from 'vitest';
import { projectJsonChunks } from '../src/v2/projectJson';
import { parseProject, serializeProject, serializeProjectChunks } from '../src/v2/project';
import { defaultSettings } from '../src/v2/settings';
import { resultTransferBuffers } from '../src/v2/transfer';

function legacyJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (ArrayBuffer.isView(child) && !(child instanceof DataView)) return { $mu: child.constructor.name, data: Array.from(child as Float32Array) };
    if (typeof child === 'number' && !Number.isFinite(child)) return { $mu: 'number', value: String(child) };
    return child;
  });
}
describe('V2 project payload and ownership optimizations', () => {
  it('writes byte-identical JSON for all numeric view types, aliases, special values and JSON conventions', () => {
    const bytes = new Uint8Array([9, 8, 7, 6]), shared = new Float32Array([.1, -0, Infinity, NaN]);
    const data = {
      text: 'Élévation 🗺️\n"\\\ud800', undefined, nil: null, bool: true, zero: -0, inf: Infinity, nan: NaN,
      f32: shared, repeated: shared, f64: new Float64Array([1e-8, 1e25, -Infinity, Math.PI]),
      i8: new Int8Array([-128, 127]), i16: new Int16Array([-32768, 32767]), i32: new Int32Array([-2147483648, 2147483647]),
      u8: bytes.subarray(1, 3), clamped: new Uint8ClampedArray([0, 255]), u16: new Uint16Array([65535]), u32: new Uint32Array([4294967295]),
      empty: new Float32Array(0), dataView: new DataView(bytes.buffer), date: new Date('2026-10-28T00:00:00Z'),
      list: [undefined, null, Symbol('omitted'), () => 1, { toJSON(key: string) { return { key, value: 42 }; } }],
      numberObject: new Number(4), stringObject: new String('x'), map: new Map([['not-json', 1]]),
    };
    expect(projectJsonChunks(data).join('')).toBe(legacyJson(data));
    expect(projectJsonChunks({ large: Float32Array.from({ length: 20000 }, (_, i) => i / 7) }).length).toBeGreaterThan(1);
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(() => projectJsonChunks(cycle)).toThrow(/circular/);
    expect(() => projectJsonChunks({ bigint: 1n })).toThrow(/BigInt/);
  });
  it('reads legacy typed-array and nonfinite tags and emits identical Blob/string formats', async () => {
    const settings = defaultSettings(), mods = [{ values: new Float64Array([Infinity, -Infinity, NaN, -0]), view: new Uint8Array([1, 2, 255]) }];
    const text = serializeProject(settings, undefined, mods), parts = serializeProjectChunks(settings, undefined, mods);
    expect(await new Blob(parts).text()).toBe(text);
    const read = parseProject(text), values = (read.mods[0] as typeof mods[0]).values;
    expect(values).toBeInstanceOf(Float64Array); expect(values[0]).toBe(Infinity); expect(values[1]).toBe(-Infinity); expect(Number.isNaN(values[2])).toBe(true);
    // JSON's established -0 convention is preserved.
    expect(Object.is(values[3], -0)).toBe(false);
    expect(serializeProject(read.settings, undefined, read.mods)).toBe(text);
  });
  it('continues rejecting forbidden keys, invalid type tags and nonnumeric typed payloads at any depth', () => {
    const valid = JSON.parse(serializeProject(defaultSettings()));
    for (const mods of ['[{"safe":{"constructor":{}}}]', '[{"$mu":"Float32Array","data":[1,"2"]}]', '[{"$mu":"toString","data":[]}]', '[{"$mu":"Float32Array","data":[{"prototype":3}]}]', '[{"$mu":"number","value":"NaN","extra":{"__proto__":{}}}]']) {
      const text = JSON.stringify({ ...valid, mods: [] }).replace('"mods":[]', `"mods":${mods}`);
      expect(() => parseProject(text)).toThrow();
    }
  });
  it('transfers each owned buffer once while retaining view offsets and independent copies', () => {
    const backing = new ArrayBuffer(32), first = new Float32Array(backing, 4, 3), second = new Uint8Array(backing, 6, 5);
    first.set([1.25, 2.5, 3.75]);
    const result = { first, second, aliases: [first, new DataView(backing, 2, 4)], empty: new Uint8Array(0) };
    const independent = structuredClone(result), transfer = resultTransferBuffers(result);
    expect(transfer).toEqual([backing]);
    const moved = structuredClone(result, { transfer });
    expect(backing.byteLength).toBe(0); expect(independent.first[0]).toBe(1.25);
    expect(moved.first.buffer).toBe(moved.second.buffer); expect(moved.first.byteOffset).toBe(4); expect(moved.aliases[0]).toBe(moved.first);
    expect([...moved.first]).toEqual([1.25, 2.5, 3.75]);
  });
});
