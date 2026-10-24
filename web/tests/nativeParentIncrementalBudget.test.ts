import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import realSite from '../../rust/crates/houses/tests/fixtures/native-prepose-real-0000-site.json';
import realBatch from '../../rust/crates/houses/tests/fixtures/single-need-postbatch-java-0002.json';
import { createParentSessionPrefixBudget, parentInputBudget, parentRecordMeasurer, parentWire, PARENT_LIMITS } from '../../rust/bridge/nativeParentBudget';
import { fillCanonicalParentPrefix } from '../../rust/bridge/nativeParentSourceBuffer';
import type { PlacementRequest, PlacementBatchSettings } from '../../rust/bridge/urbanArchitecture';
import type { NativeParentRequest } from '../../rust/bridge/nativeParentContract';
import type { PlanParentSessionRequest, ParentSessionLimits } from '../../rust/bridge/nativeParentSessionContract';
import type { Surface } from '../../rust/bridge/housesContract';

// Real source geometry, with explicit transport-only mutations below. This is
// wire/budget evidence, not new native admission or capacity evidence.
function checkedFixture(value: unknown): PlacementRequest {
  assert.ok(value && typeof value === 'object');
  // JSON imports widen tuples and access-kind literals. Validate those native
  // fields once, without rebuilding/reordering any fixture object or number.
  const row = value as PlacementRequest;
  assert.equal(typeof row.id, 'string'); assert.equal(typeof row.parcel_id, 'string');
  for (const field of [row.cadastral, row.buildable, row.reserves, row.neighbors, row.party_boundaries, row.accesses]) assert.ok(Array.isArray(field));
  assert.ok(Array.isArray(row.terrain.gradient) && row.terrain.gradient.length === 2 && row.terrain.gradient.every(Number.isFinite));
  for (const access of row.accesses) {
    assert.ok(['public', 'collective', 'private'].includes(access.kind));
    assert.ok(Array.isArray(access.segment) && access.segment.length === 2);
    for (const point of access.segment) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
  return row;
}
const fixtureSite = checkedFixture(realSite), fixtureRows = realBatch.requests.map(checkedFixture);
const site = (): PlacementRequest => structuredClone(fixtureSite);
const limits: ParentSessionLimits = { max_parents_per_batch: 64, max_input_bytes: PARENT_LIMITS.bytes,
  max_raw_bytes: 32 * 1024 * 1024, max_std_rewritten_bytes: PARENT_LIMITS.rewrittenBytes, max_std_float_slots: PARENT_LIMITS.floatSlots,
  max_output_bytes: 64 * 1024 * 1024, max_hit_parts: 4096, max_hit_vertices: 262144, max_runs: 4, max_total_requests: 1000000,
  max_retained_vertices: 1000000, max_index_references: 1000000, max_retained_index_bytes: 512 * 1024 * 1024,
  max_identity_bytes: 128 * 1024 * 1024, ack_history_entries: 256, idle_timeout_ms: 900000 };
function inputs(rows: PlacementRequest[], footprints: Record<string, Surface> = {}, settings?: PlacementBatchSettings, offset = 0) {
  const selected = Object.fromEntries(rows.filter(r => footprints[r.id]).map(r => [r.id, footprints[r.id]]));
  const session: PlanParentSessionRequest = { schema_version: 'native-parent-session-1', session_id: 's"\\水é', source_fingerprint: 'a'.repeat(64),
    revision: 'r\ud800', expected_offset: offset, key: `run:${offset}`, requests: rows, footprints: selected };
  const inner: NativeParentRequest = { schema_version: 'native-parent-batch-1', batch: { schema_version: '1',
    ...(settings ? { settings } : {}), requests: rows, footprints: selected }, prior_occupation: { land_parts: [], roof_parts: [] } };
  return { session, inner };
}
// The previous production function, kept independent as the exact oracle.
function oracle(rows: PlacementRequest[], footprints: Record<string, Surface> = {}, settings?: PlacementBatchSettings, sessionLimits = limits, offset = 0) {
  const { session, inner } = inputs(rows, footprints, settings, offset), wire = parentWire(session), budget = parentInputBudget(inner);
  return { fits: budget.fits && wire.bytes <= sessionLimits.max_input_bytes && wire.floatSlots <= sessionLimits.max_std_float_slots
    && wire.rewrittenBytes <= sessionLimits.max_std_rewritten_bytes, reason: budget.reason ?? 'session wire budget',
    wire: { bytes: wire.bytes, floatSlots: wire.floatSlots, rewrittenBytes: wire.rewrittenBytes } };
}
function counter(footprints: Record<string, Surface> = {}, settings?: PlacementBatchSettings, sessionLimits = limits, offset = 0,
  measure = parentRecordMeasurer(footprints)) {
  const { session, inner } = inputs([], footprints, settings, offset);
  return createParentSessionPrefixBudget(session, inner, sessionLimits, measure);
}

it('matches the old exact oracle for every real64 prefix, settings, keyed footprints and numeric/UTF8 lexemes', () => {
  const rows = structuredClone(fixtureRows), settings = realBatch.settings;
  const footprints: Record<string, Surface> = {};
  rows.forEach((r, i) => {
    r.id = i % 2 ? `${i}` : `é水"\\\ud800-${i}`;
    r.terrain.origin.x = i % 3 ? -0 : 1e21;
    r.terrain.origin.y = i % 3 ? .125 : -9223372036854776000;
    if (i % 3) footprints[r.id] = r.cadastral;
  });
  const budget = counter(footprints, settings);
  expect(budget.prefix(0)).toEqual(oracle([], footprints, settings));
  rows.forEach((r, i) => { budget.append(r); expect(budget.prefix(i + 1)).toEqual(oracle(rows.slice(0, i + 1), footprints, settings)); });
  const finalWire = parentWire(inputs(rows, footprints, settings).session);
  expect(finalWire.json).toContain(':-0'); expect(finalWire.json).toContain('\\ud800');
  expect(finalWire.bytes).toBe(new TextEncoder().encode(finalWire.json).length);
});

it('counts global float placeholders exactly over 9/10/99/100/999, including floats in fixed settings and footprints', () => {
  const settings: PlacementBatchSettings = { floors: .125 }; // transport-only noninteger sentinel, not native admission
  const rows = Array.from({ length: 64 }, (_, i) => Object.assign(site(), { id: `${i}`, transportOnlyFloats: Array.from({ length: 17 }, () => -0) }));
  const footprints = { '0': rows[0].cadastral, '10': rows[10].buildable };
  const budget = counter(footprints, settings);
  rows.forEach((r, i) => { budget.append(r); expect(budget.prefix(i + 1)).toEqual(oracle(rows.slice(0, i + 1), footprints, settings)); });
  expect(budget.prefix(64).wire.floatSlots).toBeGreaterThan(999);
});

it('matches exact placeholder digit transitions on either side of each decimal boundary', () => {
  // Minimal transport sentinel; these empty domains are never sent to native.
  const make = (id: string, count: number): PlacementRequest => Object.assign({ id, parcel_id: id, cadastral: [], buildable: [], reserves: [],
    accesses: [], party_boundaries: [], neighbors: [], culture: site().culture, function: 'domestic', seed: id,
    terrain: { origin: { x: 0, y: 0 }, ground_z_m: 0, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 } } satisfies PlacementRequest,
  { floatSentinels: Array.from({ length: count }, () => -0) });
  for (const count of [0, 1, 8, 9, 10, 11, 98, 99, 100, 101, 998, 999, 1000]) {
    const settings = { floors: .125 }, rows = [make('a', count), make('b', 1)], budget = counter({}, settings);
    budget.append(rows[0]); expect(budget.prefix(1)).toEqual(oracle(rows.slice(0, 1), {}, settings));
    expect(budget.prefix(1).wire.floatSlots).toBe(count);
    budget.append(rows[1]); expect(budget.prefix(2)).toEqual(oracle(rows, {}, settings));
    expect(budget.prefix(2).wire.floatSlots).toBe(count + 1);
  }
});

it('preserves exact session byte/float/rewritten boundary failures and inner geometry/parent failures', () => {
  const row = site(), wire = oracle([row]).wire;
  for (const [key, amount] of [['max_input_bytes', wire.bytes], ['max_std_float_slots', wire.floatSlots], ['max_std_rewritten_bytes', wire.rewrittenBytes]] as const) {
    for (const max of [amount - 1, amount, amount + 1]) {
      const narrowed = { ...limits, [key]: max }, budget = counter({}, undefined, narrowed); budget.append(row);
      expect(budget.prefix(1)).toEqual(oracle([row], {}, undefined, narrowed));
    }
  }
  const rows = Array.from({ length: 65 }, (_, i) => Object.assign(site(), { id: `${i}` })), budget = counter();
  rows.forEach(r => budget.append(r)); expect(budget.prefix(65)).toEqual(oracle(rows));
  for (const change of [
    (r: PlacementRequest) => { r.reserves = Array.from({ length: 4097 }, () => ({ outer: [], holes: [] })); },
    (r: PlacementRequest) => { r.cadastral[0].outer = Array.from({ length: PARENT_LIMITS.vertices + 1 }, () => ({ x: 0, y: 0 })); },
    (r: PlacementRequest) => { Object.assign(r, { transportOnlyFloats: Array.from({ length: PARENT_LIMITS.floatSlots + 1 }, () => .125) }); },
  ]) {
    const r = site(); change(r); const b = counter(); b.append(r); expect(b.prefix(1)).toEqual(oracle([r])); expect(b.prefix(1).fits).toBe(false);
  }
});

it('measures each immutable record once, even when its lookahead moves into a new envelope', () => {
  let serializations = 0;
  const row = site(); Object.defineProperty(row, 'toJSON', { value() { serializations++; return { ...row }; } });
  const measure = parentRecordMeasurer({}), a = counter({}, undefined, limits, 0, measure);
  a.append(row); const first = a.prefix(1);
  for (let i = 0; i < 100; i++) expect(a.prefix(1)).toEqual(first);
  const b = counter({}, undefined, limits, 64, measure); b.append(row);
  expect(serializations).toBe(1); expect(b.prefix(1)).toEqual(oracle([row], {}, undefined, limits, 64));
  expect(() => b.prefix(2)).toThrow('Unknown measured');
});

async function partition(rows: PlacementRequest[], pageSize: number, incremental: boolean, sessionLimits: ParentSessionLimits) {
  const pending: PlacementRequest[] = [], seen = new Set<string>(), partitions: string[][] = [], reads: number[][] = [];
  const source = { total: rows.length, read: async (offset: number, limit: number, maxBytes: number) => {
    reads.push([offset, limit, maxBytes]); const page = rows.slice(offset, offset + Math.min(limit, pageSize));
    while (page.length && parentWire(page).bytes > maxBytes) page.pop(); return page;
  } };
  const measureRecord = parentRecordMeasurer({}); let completed = 0;
  while (completed < rows.length) {
    const measured = counter({}, undefined, sessionLimits, completed, measureRecord); pending.forEach(r => measured.append(r));
    const old = (r: PlacementRequest[]) => oracle(r, {}, undefined, sessionLimits, completed);
    await fillCanonicalParentPrefix(source, completed, pending, seen, incremental ? measured : old, () => {});
    let count = 0;
    for (let n = 1; n <= pending.length; n++) { if (!(incremental ? measured.prefix(n) : old(pending.slice(0, n))).fits) break; count = n; }
    if (!count) throw new Error('Whole request cannot fit');
    partitions.push(pending.slice(0, count).map(r => r.id)); completed += count;
    pending.splice(0, count); expect(pending.length).toBeLessThanOrEqual(1); seen.clear(); pending.forEach(r => seen.add(r.id));
  }
  return { partitions, reads };
}
it('keeps exact canonical partitions, source maxBytes and bounded lookahead independently of source pages', async () => {
  const rows = Array.from({ length: 70 }, (_, i) => Object.assign(site(), { id: `r${i}`, seed: `s${i}` }));
  const small = { ...limits, max_input_bytes: oracle(rows.slice(0, 7)).wire.bytes };
  let canonical: string[][] | undefined;
  for (const page of [1, 3, 7, 64]) {
    const old = await partition(rows, page, false, small), next = await partition(rows, page, true, small);
    expect(next).toEqual(old); canonical ??= next.partitions; expect(next.partitions).toEqual(canonical);
  }
  const full = await partition(rows, 64, true, limits); expect(full.partitions.map(p => p.length)).toEqual([64, 6]);
});

it('microbench reports real64 old prefix scans versus incremental measurements without a timing assertion', () => {
  const rows = structuredClone(fixtureRows), settings = realBatch.settings;
  // Real retained fixture, no native planning, filesystem IO, GPU or browser.
  let oldFinal: ReturnType<typeof oracle> | undefined; const oldStart = performance.now();
  for (let i = 0; i <= rows.length; i++) oldFinal = oracle(rows.slice(0, i), {}, settings);
  const oldMs = performance.now() - oldStart, newStart = performance.now(), budget = counter({}, settings);
  rows.forEach((r, i) => { budget.append(r); budget.prefix(i + 1); });
  const final = parentWire(inputs(rows, {}, settings).session), incrementalMs = performance.now() - newStart;
  expect(budget.prefix(64)).toEqual(oldFinal); expect(final.bytes).toBe(oldFinal!.wire.bytes);
  console.info(JSON.stringify({ scope: 'one real64 retained transport fixture; no native, browser or global CPU claim', records: rows.length,
    oldPrefixRecordVisits: rows.length * (rows.length + 1), incrementalRecordMeasurements: rows.length,
    finalWireBytes: final.bytes, oldMs, incrementalMs }));
});
