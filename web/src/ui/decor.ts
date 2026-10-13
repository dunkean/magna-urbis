import { gunzipSync, gzipSync } from 'fflate';
import type { RoadConfig, RoadOutput, Settlement, SettlementRaster } from '../../../rust/bridge/settlements';

/**
 * A "decor": the base layers the urban stages read, captured from Terrain Bench so quarters
 * and parcels can be prototyped without the terrain, water, settlement and road stages.
 * The raster is exactly the one Terrain Bench sends to Rust (`settlementRaster`), so the
 * same urban seed gives the same quarters in both benches.
 */
export interface DecorMeta {
  format: 'magna-decor'; version: 1;
  id: string; label: string;
  /** Free classification used by the bench filters (relief, coast, river, roads…). */
  tags: Record<string, string>;
  seed: string; width: number;
  /** Terrain Bench query string that regenerates this decor. */
  query: string;
  created: string;
  settlements: Settlement[];
  roadConfig: RoadConfig | null;
  roads: RoadOutput | null;
  /** Vector water (lakes and rivers at their physical widths) as Terrain Bench draws it, in metres. */
  waterSvg: string;
  stats: { land: number; minHeight: number; maxHeight: number; riverKm: number; roadKm: number };
}
export interface Decor { meta: DecorMeta; raster: SettlementRaster }
/** Index entry of a decor directory (`index.json`). */
export interface DecorEntry { id: string; label: string; file: string; tags: Record<string, string>; width: number; settlements: number; roadKm: number; riverKm: number }

const MAGIC = 0x4344554d; // "MUDC"

/** Float bytes grouped by significance: gzip finds the repeated exponents. */
function shuffle(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength), n = values.length, out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) for (let b = 0; b < 4; b++) out[b * n + i] = bytes[i * 4 + b];
  return out;
}
function unshuffle(bytes: Uint8Array, n: number): Float32Array {
  const out = new Float32Array(n), view = new Uint8Array(out.buffer);
  for (let i = 0; i < n; i++) for (let b = 0; b < 4; b++) view[i * 4 + b] = bytes[b * n + i];
  return out;
}

export function encodeDecor(decor: Decor): Uint8Array {
  const r = decor.raster, size = r.n * r.n;
  // Land cells keep their own height as water level: store water levels only on water.
  const level = new Float32Array(size);
  for (let i = 0; i < size; i++) level[i] = r.water[i] ? r.waterLevel[i] : 0;
  const header = new TextEncoder().encode(JSON.stringify({ meta: decor.meta, width: r.width, n: r.n }));
  const parts = [shuffle(r.height), r.water, shuffle(level), shuffle(r.riverWidth), new Uint8Array(r.riverIds.buffer, r.riverIds.byteOffset, r.riverIds.byteLength)];
  const total = 12 + header.length + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, header.length, true);
  out.set(header, 12);
  let offset = 12 + header.length;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return gzipSync(out, { level: 6 });
}

export function decodeDecor(data: Uint8Array): Decor {
  const raw = gunzipSync(data), view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a Magna Urbis decor file');
  if (view.getUint32(4, true) !== 1) throw new Error(`Unsupported decor version ${view.getUint32(4, true)}`);
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + headerLength))) as { meta: DecorMeta; width: number; n: number };
  const n = header.n, size = n * n;
  let offset = 12 + headerLength;
  const take = (bytes: number): Uint8Array => { const part = raw.slice(offset, offset + bytes); offset += bytes; return part; };
  const height = unshuffle(take(size * 4), size), water = take(size), waterLevel = unshuffle(take(size * 4), size);
  const riverWidth = unshuffle(take(size * 4), size), riverIds = new Int32Array(take(size * 4).buffer);
  for (let i = 0; i < size; i++) if (!water[i]) waterLevel[i] = height[i];
  return { meta: header.meta, raster: { width: header.width, n, height, water, waterLevel, riverWidth, riverIds } };
}

export const decorEntry = (meta: DecorMeta, file: string): DecorEntry => ({
  id: meta.id, label: meta.label, file, tags: meta.tags, width: meta.width,
  settlements: meta.settlements.length, roadKm: meta.stats.roadKm, riverKm: meta.stats.riverKm,
});

export function rasterStats(r: SettlementRaster): Pick<DecorMeta['stats'], 'land' | 'minHeight' | 'maxHeight'> {
  let land = 0, minHeight = Infinity, maxHeight = -Infinity;
  for (let i = 0; i < r.height.length; i++) {
    if (!r.water[i]) land++;
    minHeight = Math.min(minHeight, r.height[i]); maxHeight = Math.max(maxHeight, r.height[i]);
  }
  return { land: land / r.height.length, minHeight, maxHeight };
}
