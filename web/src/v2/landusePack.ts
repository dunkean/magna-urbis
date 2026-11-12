// Transport form of `world.landuse.areas` for postMessage hops (engine worker -> page -> render worker).
// A 40 km map carries ~12k areas and ~1.6 M {x, y} points: their structured clone cost about 0.5 s to
// serialize and 0.6 s to deserialize per hop at full CPU speed, on the page's main thread for two of
// the four sides. Packed, the coordinates travel as one transferred Float64Array; the receiver rebuilds
// the very same objects (same values, same key order), so no consumer sees a difference.
import type { LandArea, World } from '../gen/types';

interface PackedAreas {
  packedLanduse: 1;
  /** Each area with `poly`, `holes` and `strips` replaced by 0 (keeps the key order). */
  shells: Record<string, unknown>[];
  /** Per area: hole ring count and strip ring count, -1 when the property is absent. */
  counts: Int32Array;
  /** Point count of every ring, in order: poly, holes..., strips... per area. */
  lengths: Uint32Array;
  coords: Float64Array;
}
type Ring = readonly { x: number; y: number }[];
const isPacked = (areas: unknown): areas is PackedAreas => !!areas && typeof areas === 'object' && (areas as PackedAreas).packedLanduse === 1;

function pack(areas: readonly LandArea[]): PackedAreas {
  let rings = 0, points = 0;
  const visit = (ring: Ring) => { rings++; points += ring.length; };
  for (const area of areas) { visit(area.poly); area.holes?.forEach(visit); area.strips?.forEach(visit); }
  const counts = new Int32Array(areas.length * 2), lengths = new Uint32Array(rings), coords = new Float64Array(points * 2), shells: Record<string, unknown>[] = new Array(areas.length);
  let r = 0, c = 0;
  const write = (ring: Ring) => { lengths[r++] = ring.length; for (const p of ring) { coords[c++] = p.x; coords[c++] = p.y; } };
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i], shell: Record<string, unknown> = { ...area };
    shell.poly = 0; write(area.poly);
    if ('holes' in area) { shell.holes = 0; counts[2 * i] = area.holes?.length ?? -2; area.holes?.forEach(write); } else counts[2 * i] = -1;
    if ('strips' in area) { shell.strips = 0; counts[2 * i + 1] = area.strips?.length ?? -2; area.strips?.forEach(write); } else counts[2 * i + 1] = -1;
    shells[i] = shell;
  }
  return { packedLanduse: 1, shells, counts, lengths, coords };
}

function unpack(packed: PackedAreas): LandArea[] {
  const { shells, counts, lengths, coords } = packed;
  let r = 0, c = 0;
  const read = (): { x: number; y: number }[] => { const n = lengths[r++], ring = new Array(n); for (let k = 0; k < n; k++, c += 2) ring[k] = { x: coords[c], y: coords[c + 1] }; return ring; };
  const many = (count: number) => { const list = new Array(count); for (let k = 0; k < count; k++) list[k] = read(); return list; };
  const areas = new Array<LandArea>(shells.length);
  for (let i = 0; i < shells.length; i++) {
    const area = shells[i];
    area.poly = read();
    const holes = counts[2 * i], strips = counts[2 * i + 1];
    if (holes !== -1) area.holes = holes === -2 ? undefined : many(holes);
    if (strips !== -1) area.strips = strips === -2 ? undefined : many(strips);
    areas[i] = area as unknown as LandArea;
  }
  return areas;
}

/** A shallow copy of `world` whose land-use areas are packed, and the buffers to transfer. `world` is untouched. */
export function packWorldLanduse<T extends World | undefined>(world: T): { world: T; transfer: ArrayBuffer[] } {
  const areas = world?.landuse?.areas;
  if (!world || !Array.isArray(areas) || areas.length < 64) return { world, transfer: [] };
  const packed = pack(areas);
  return { world: { ...world, landuse: { ...world.landuse, areas: packed as unknown as LandArea[] } }, transfer: [packed.counts.buffer, packed.lengths.buffer, packed.coords.buffer] as ArrayBuffer[] };
}
/** Receiver side: rebuilds packed land-use areas in place (no-op on an ordinary world). */
export function unpackWorldLanduse<T extends World | undefined>(world: T): T {
  const landuse = world?.landuse as { areas: unknown } | undefined;
  if (landuse && isPacked(landuse.areas)) landuse.areas = unpack(landuse.areas);
  return world;
}
