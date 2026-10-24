import { expect, it } from 'vitest';
import { parentWire, parentInputBudget, parentGeometryBudget, PARENT_LIMITS } from '../../rust/bridge/nativeParentBudget';
import { NATIVE_PARENT_SCHEMA, type NativeParentRequest } from '../../rust/bridge/nativeParentContract';
const empty = (): NativeParentRequest => ({ schema_version: NATIVE_PARENT_SCHEMA, batch: { schema_version: '1', requests: [] }, prior_occupation: { land_parts: [], roof_parts: [] } });
it('budgets exact scoped Std tokens, escaped strings and signed zero, never reparses source geometry', () => {
  const value = { quoted: '12.5 "3e10" \\ -0', a: -0, b: 0, c: .125, d: 1e21, e: 18446744073709550000, f: -9223372036854776000 };
  const wire = parentWire(value);
  expect(wire.json).toContain('"a":-0'); expect(Object.is(JSON.parse(wire.json).a, -0)).toBe(true);
  // a, c, d and f require Std. e is a positive u64 integer token.
  expect(wire.floatSlots).toBe(4); expect(wire.bytes).toBe(new TextEncoder().encode(wire.json).byteLength);
  const tokens = ['-0', '0.125', '1e+21', '-9223372036854776000'];
  expect(wire.rewrittenBytes).toBe(wire.bytes + tokens.reduce((n, token, i) => n + `{"_native_assembly_transport_float":${i}}`.length - token.length, 0));
});
it('counts ALL serialized numeric values for codec including raster/config, not just geometry vertices', () => {
  const input = empty(); input.prior_occupation.land_parts = [];
  const measured = parentWire({ ...input, transport_sentinel: Array.from({ length: PARENT_LIMITS.floatSlots + 1 }, () => .125) });
  expect(measured.floatSlots).toBe(PARENT_LIMITS.floatSlots + 1);
  expect(() => parentWire({ bad: Infinity })).toThrow('Nonfinite'); expect(() => parentWire({ bad: NaN })).toThrow('Nonfinite');
});
it('geometry limit includes empty parts and polygons separately, and no omitted footprint values', () => {
  const input = empty(); input.prior_occupation.land_parts = Array.from({ length: 4097 }, () => []);
  expect(parentInputBudget(input)).toMatchObject({ fits: false, reason: 'parts: 4097 > 4096' });
  const polygon = { outer: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], holes: [[{ x: .1, y: .1 }]] };
  const other = empty(); other.batch.footprints = { exact: [polygon] };
  expect(parentGeometryBudget(other)).toEqual({ parts: 1, polygons: 1, vertices: 4 });
  expect(parentInputBudget(other).fits).toBe(true);
});
it('raw byte budget accounts UTF8 and floating tokens in strings cost zero slots', () => {
  const wire = parentWire({ label: '\u00e9\u6c3412.5' });
  expect(wire.floatSlots).toBe(0); expect(wire.bytes).toBeGreaterThan(wire.json.length);
});
