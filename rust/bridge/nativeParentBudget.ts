/** Preflight the exact wire, not a geometry heuristic and never a retry policy.
 * Scoped native Std parser limits mirrored from native_assembly_std_transport.rs. */
import type { NativeParentRequest } from './nativeParentContract';
import type { Surface } from './housesContract';
import type { PlacementRequest } from './urbanArchitecture';
import type { PlanParentSessionRequest, BeginParentSessionReply } from './nativeParentSessionContract';
export const PARENT_LIMITS = Object.freeze({ parents: 64, bytes: 24 * 1024 * 1024,
  parts: 4096, polygons: 4096, vertices: 262144, floatSlots: 262144, rewrittenBytes: 64 * 1024 * 1024 });
const encoder = new TextEncoder();
export interface ParentWire { json: string; bytes: number; floatSlots: number; rewrittenBytes: number }
/** Keep -0 while serializing requests/context. No numeric value is rounded or repaired. */
export function parentWire(value: unknown): ParentWire {
  let ordinal = 0; const zeros = new Set<number>();
  const raw = JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Nonfinite native parent input.'); if (Object.is(v, -0)) zeros.add(ordinal); ordinal++; }
    return v;
  });
  if (typeof raw !== 'string') throw new Error('Missing native parent input.');
  let result = '', quoted = false, escaped = false, numberIndex = 0, floatSlots = 0, rewrittenBytes = 0, cursor = 0;
  for (let i = 0; i < raw.length;) {
    const ch = raw[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; i++; continue; }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch !== '-' && (ch < '0' || ch > '9')) { i++; continue; }
    const start = i; while (i < raw.length && /[0-9.eE+\-]/.test(raw[i])) i++;
    let token = raw.slice(start, i); if (zeros.has(numberIndex++)) token = '-0';
    result += raw.slice(cursor, start) + token; cursor = i;
    let integerFits = false;
    if (!/[.eE]/.test(token) && token !== '-0') {
      const n = BigInt(token); integerFits = n < 0n ? n >= -9223372036854775808n : n <= 18446744073709551615n;
    }
    if (!integerFits) { rewrittenBytes += `{"_native_assembly_transport_float":${floatSlots}}`.length - token.length; floatSlots++; }
  }
  result += raw.slice(cursor);
  const bytes = encoder.encode(result).byteLength;
  return { json: result, bytes, floatSlots, rewrittenBytes: bytes + rewrittenBytes };
}
export function parentGeometryBudget(input: NativeParentRequest) {
  let parts = 0, polygons = 0, vertices = 0;
  const surface = (s: Surface | undefined | null) => {
    if (!s) return; parts++; polygons += s.length;
    for (const shape of s) { vertices += shape.outer.length; for (const hole of shape.holes) vertices += hole.length; }
  };
  input.prior_occupation.land_parts.forEach(surface); input.prior_occupation.roof_parts.forEach(surface);
  Object.values(input.batch.footprints ?? {}).forEach(surface);
  for (const r of input.batch.requests) {
    [r.cadastral, r.buildable, r.reserves, r.roof_domain, r.placement_hint].forEach(surface);
    r.neighbors.forEach(n => surface(n.footprint));
    vertices += 2 * (r.accesses.length + r.party_boundaries.length + (r.native_minimum_candidates?.length ?? 0));
  }
  return { parts, polygons, vertices };
}
/** Returns a budget failure only; malformed native geometry still gets its real native validation. */
export function parentInputBudget(input: NativeParentRequest): { fits: boolean; reason?: string; wire: ParentWire } {
  const wire = parentWire(input), geometry = parentGeometryBudget(input);
  for (const [key, amount, max] of [ ['parents', input.batch.requests.length, PARENT_LIMITS.parents],
    ['bytes', wire.bytes, PARENT_LIMITS.bytes], ['parts', geometry.parts, PARENT_LIMITS.parts],
    ['polygons', geometry.polygons, PARENT_LIMITS.polygons], ['vertices', geometry.vertices, PARENT_LIMITS.vertices],
    ['floatSlots', wire.floatSlots, PARENT_LIMITS.floatSlots], ['rewrittenBytes', wire.rewrittenBytes, PARENT_LIMITS.rewrittenBytes] ] as const)
    if (amount > max) return { fits: false, reason: `${key}: ${amount} > ${max}`, wire };
  return { fits: true, wire };
}

/** Number of decimal digits in the ordinal range [0, count). No float-token scan. */
function ordinalDigits(count: number): number {
  let result = count ? 1 : 0;
  for (let start = 1, digits = 1; start < count; start *= 10, digits++) result += (Math.min(count, start * 10) - start) * digits;
  return result;
}
interface WireCost { bytes: number; floatSlots: number; rewriteBias: number }
const cost = (wire: ParentWire): WireCost => ({ bytes: wire.bytes, floatSlots: wire.floatSlots,
  rewriteBias: wire.rewrittenBytes - wire.bytes - ordinalDigits(wire.floatSlots) });
const addCost = (a: WireCost, b: WireCost): WireCost => ({ bytes: a.bytes + b.bytes,
  floatSlots: a.floatSlots + b.floatSlots, rewriteBias: a.rewriteBias + b.rewriteBias });
const emptyCost = (): WireCost => ({ bytes: 0, floatSlots: 0, rewriteBias: 0 });
function measuredCost(value: WireCost) {
  return { bytes: value.bytes, floatSlots: value.floatSlots,
    rewrittenBytes: value.bytes + value.rewriteBias + ordinalDigits(value.floatSlots) };
}
interface ParentRecordCost { request: WireCost; footprint: WireCost; geometry: ReturnType<typeof parentGeometryBudget> }
/** One measurement per actual record, including one bounded lookahead carried to
 * the next batch. Weak keys do not keep previously ACKed native geometry alive. */
export function parentRecordMeasurer(footprints: NativeParentRequest['batch']['footprints']) {
  const cache = new WeakMap<PlacementRequest, ParentRecordCost>();
  return (request: PlacementRequest): ParentRecordCost => {
    const previous = cache.get(request); if (previous) return previous;
    const footprint = footprints?.[request.id];
    // A map entry contributes its encoded key, colon, surface and (later) comma.
    const fp = footprint ? cost(parentWire(footprint)) : emptyCost();
    if (footprint) fp.bytes += encoder.encode(JSON.stringify(request.id)).byteLength + 1;
    const geometry = parentGeometryBudget({ schema_version: 'native-parent-batch-1', batch: { schema_version: '1', requests: [request], footprints: footprint ? { [request.id]: footprint } : {} },
      prior_occupation: { land_parts: [], roof_parts: [] } });
    const value = { request: cost(parentWire(request)), footprint: fp, geometry };
    cache.set(request, value); return value;
  };
}
export interface ParentPrefixMeasurement { fits: boolean; reason?: string; wire: { bytes: number; floatSlots: number; rewrittenBytes: number } }
/** Exact additive costs of the same session/virtual-inner objects used by the
 * legacy oracle. Only their fixed empty envelopes and each record are scanned.
 * Float placeholder digits depend on TOTAL float count, not fragment-local
 * ordinals; rewriteBias removes local ordinals before combining fragments. */
export function createParentSessionPrefixBudget(session: PlanParentSessionRequest, inner: NativeParentRequest,
  limits: BeginParentSessionReply['limits'], measureRecord: ReturnType<typeof parentRecordMeasurer>) {
  const sessionBase = cost(parentWire(session)), innerBase = cost(parentWire(inner));
  const requests: WireCost[] = [emptyCost()], footprints: WireCost[] = [emptyCost()];
  const geometries = [{ parts: 0, polygons: 0, vertices: 0 }], footprintCounts = [0];
  return {
    append(request: PlacementRequest) {
      const value = measureRecord(request), n = requests.length - 1, previous = geometries[n];
      requests.push(addCost(requests[n], value.request)); footprints.push(addCost(footprints[n], value.footprint));
      footprintCounts.push(footprintCounts[n] + Number(value.footprint.bytes > 0));
      geometries.push({ parts: previous.parts + value.geometry.parts, polygons: previous.polygons + value.geometry.polygons,
        vertices: previous.vertices + value.geometry.vertices });
    },
    prefix(count: number): ParentPrefixMeasurement {
      if (!Number.isInteger(count) || count < 0 || count >= requests.length) throw new Error('Unknown measured native parent prefix.');
      const payload = addCost(requests[count], footprints[count]);
      payload.bytes += Math.max(0, count - 1) + Math.max(0, footprintCounts[count] - 1);
      const wire = measuredCost(addCost(sessionBase, payload)), virtual = measuredCost(addCost(innerBase, payload)), geometry = geometries[count];
      for (const [key, amount, max] of [ ['parents', count, PARENT_LIMITS.parents], ['bytes', virtual.bytes, PARENT_LIMITS.bytes],
        ['parts', geometry.parts, PARENT_LIMITS.parts], ['polygons', geometry.polygons, PARENT_LIMITS.polygons],
        ['vertices', geometry.vertices, PARENT_LIMITS.vertices], ['floatSlots', virtual.floatSlots, PARENT_LIMITS.floatSlots],
        ['rewrittenBytes', virtual.rewrittenBytes, PARENT_LIMITS.rewrittenBytes] ] as const)
        if (amount > max) return { fits: false, reason: `${key}: ${amount} > ${max}`, wire };
      return { fits: wire.bytes <= limits.max_input_bytes && wire.floatSlots <= limits.max_std_float_slots
        && wire.rewrittenBytes <= limits.max_std_rewritten_bytes, reason: 'session wire budget', wire };
    },
  };
}
