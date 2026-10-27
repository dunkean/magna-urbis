/**
 * Decoder of the compact city display buffers produced in Rust
 * (`rust/crates/core/src/urban/display.rs`): typed-array views over one
 * ArrayBuffer, transferable between worker and page without copies. Coordinates
 * are f32 relative to `origin` (metres). Display only: authoritative geometry
 * stays in the layouts and partitions.
 */
export interface DisplayPolygons {
  /** n+1 ring starts per polygon (first ring = outer, then holes). */
  polys: Uint32Array;
  /** r+1 point starts per ring. */
  rings: Uint32Array;
  /** x, y pairs relative to the origin. */
  coords: Float32Array;
}
export interface CityDisplayBuffers {
  origin: { x: number; y: number };
  layouts: { key: string; blockBase: number }[];
  /** Code → name tables (`zone`, `blockKind`, `districtRole`, `use`, `role`, `streetRole`); code 0 is "". */
  tables: Record<string, string[]>;
  parcelIds?: string[];
  quays?: DisplayPolygons & { kind: Uint16Array; material: Uint16Array; deckZ: Float32Array };
  quarters: DisplayPolygons;
  blocks: DisplayPolygons & { zone: Uint16Array; kind: Uint16Array; quarter: Uint32Array; districtRole: Uint16Array; wealth: Uint8Array };
  parcels: DisplayPolygons & { block: Uint32Array; use: Uint16Array; role: Uint16Array; landmark: Uint8Array; households: Float32Array };
  streets: { lines: Uint32Array; coords: Float32Array; width: Float32Array; rank: Uint8Array; role: Uint16Array };
}

type Section = { offset: number; type: 'u8' | 'u16' | 'u32' | 'f32'; length: number };
const VIEWS = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, f32: Float32Array } as const;

export function decodeCityDisplayBuffers(buffer: ArrayBuffer): CityDisplayBuffers {
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength))) as {
    format: string; version: number; origin: { x: number; y: number }; layouts: { key: string; blockBase: number }[];
    tables: Record<string, string[]>; parcelIds: string[] | null; sections: Record<string, Section>;
  };
  if (header.format !== 'magna-city-display' || header.version !== 1) throw new Error('Tampons d’affichage de ville inconnus.');
  const body = 4 + headLength;
  // Every section starts on a 4-byte boundary, so typed views need no copy.
  const view = <K extends keyof typeof VIEWS>(name: string, type: K): InstanceType<(typeof VIEWS)[K]> => {
    const s = header.sections[name];
    if (!s || s.type !== type) throw new Error(`Section ${name} absente ou mal typée.`);
    return new VIEWS[type](buffer, body + s.offset, s.length) as InstanceType<(typeof VIEWS)[K]>;
  };
  const polygons = (layer: string): DisplayPolygons => ({ polys: view(`${layer}.polys`, 'u32'), rings: view(`${layer}.rings`, 'u32'), coords: view(`${layer}.coords`, 'f32') });
  return {
    origin: header.origin, layouts: header.layouts, tables: header.tables, parcelIds: header.parcelIds ?? undefined,
    quays: header.sections['quays.polys'] ? { ...polygons('quays'), kind: view('quays.kind', 'u16'), material: view('quays.material', 'u16'), deckZ: view('quays.deckZ', 'f32') } : undefined,
    quarters: polygons('quarters'),
    blocks: { ...polygons('blocks'), zone: view('blocks.zone', 'u16'), kind: view('blocks.kind', 'u16'), quarter: view('blocks.quarter', 'u32'), districtRole: view('blocks.districtRole', 'u16'), wealth: view('blocks.wealth', 'u8') },
    parcels: { ...polygons('parcels'), block: view('parcels.block', 'u32'), use: view('parcels.use', 'u16'), role: view('parcels.role', 'u16'), landmark: view('parcels.landmark', 'u8'), households: view('parcels.households', 'f32') },
    streets: { lines: view('streets.lines', 'u32'), coords: view('streets.coords', 'f32'), width: view('streets.width', 'f32'), rank: view('streets.rank', 'u8'), role: view('streets.role', 'u16') },
  };
}

/** World-coordinate rings of polygon `i` (outer first), for picking or tests. */
export function polygonRings(p: DisplayPolygons, i: number, origin: { x: number; y: number }): { x: number; y: number }[][] {
  const rings: { x: number; y: number }[][] = [];
  for (let r = p.polys[i]; r < p.polys[i + 1]; r++) {
    const ring: { x: number; y: number }[] = [];
    for (let k = p.rings[r]; k < p.rings[r + 1]; k++) ring.push({ x: p.coords[2 * k] + origin.x, y: p.coords[2 * k + 1] + origin.y });
    rings.push(ring);
  }
  return rings;
}
