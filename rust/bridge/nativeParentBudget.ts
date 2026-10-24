/** Preflight the exact wire, not a geometry heuristic and never a retry policy.
 * Scoped native Std parser limits mirrored from native_assembly_std_transport.rs. */
import type { NativeParentRequest } from './nativeParentContract';
import type { Surface } from './housesContract';
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
