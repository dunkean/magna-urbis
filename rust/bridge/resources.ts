/** Wire form and decoder of the Rust resource payload (rust/crates/core/src/resources/export.rs). */
export interface ResourceField { id: string; lo: number; hi: number; data: string }
export interface ResourceDeposit { id: string; family: string; x: number; y: number; ore_t: number; recoverable_t: number; outcrop: boolean }
export interface ResourceAnchor { id: string; kind: string; resource: string; x: number; y: number; potential: number; annual_t: number; season_mask: number }
export interface ResourcePayload {
  version: number; nx: number; ny: number; cell: number; x0: number; y0: number; context: string; rocks: string[];
  bedrock: string; water: string; fields: ResourceField[]; deposits: ResourceDeposit[]; anchors: ResourceAnchor[];
}
/** Decoded grid: rasters stay u8; `value` rescales on read. */
export interface ResourceGrid {
  nx: number; ny: number; cell: number; x0: number; y0: number; context: string; rocks: string[];
  bedrock: Uint8Array; water: Uint8Array; deposits: ResourceDeposit[]; anchors: ResourceAnchor[];
  ids: string[];
  /** Raw bytes of a field (empty for an unknown id). */
  bytes(id: string): Uint8Array;
  /** Rescaled value of block `k` (0 for an unknown id). */
  value(id: string, k: number): number;
}
/** Potential ids of the `Ressources · potentiel` layer, in display order. */
export const POTENTIAL_IDS = ['arable', 'pasture', 'upland_pasture', 'wood', 'timber', 'water_power', 'wind_exposure', 'stone_ashlar', 'lime', 'slate', 'clay', 'sand',
  'fish_river', 'fish_coast', 'peat', 'bog_iron', 'salt_coast', 'game', 'navigable', 'coast_shelter'] as const;
export type PotentialId = typeof POTENTIAL_IDS[number];

export function base64Bytes(text: string): Uint8Array {
  const binary = atob(text), out = new Uint8Array(binary.length);
  for (let i = 0; i < out.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
export function decodeResources(p: ResourcePayload): ResourceGrid {
  const size = p.nx * p.ny, raw = new Map<string, { lo: number; hi: number; data: Uint8Array }>();
  for (const f of p.fields) {
    const data = base64Bytes(f.data);
    if (data.length !== size) throw new Error(`Resource field ${f.id}: ${data.length} bytes for ${size} blocks.`);
    raw.set(f.id, { lo: f.lo, hi: f.hi, data });
  }
  const bedrock = base64Bytes(p.bedrock), water = base64Bytes(p.water), empty = new Uint8Array(0);
  if (bedrock.length !== size || water.length !== size) throw new Error('Resource payload: bedrock or water size mismatch.');
  return {
    nx: p.nx, ny: p.ny, cell: p.cell, x0: p.x0, y0: p.y0, context: p.context, rocks: p.rocks, bedrock, water, deposits: p.deposits, anchors: p.anchors,
    ids: [...raw.keys()],
    bytes: id => raw.get(id)?.data ?? empty,
    value(id, k) { const f = raw.get(id); return f ? f.lo + f.data[k] / 255 * (f.hi - f.lo) : 0; },
  };
}
