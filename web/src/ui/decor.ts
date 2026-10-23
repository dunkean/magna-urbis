import { decorGeography, type VectorGeography } from '../../../rust/bridge/urbanGeography';
import { Gunzip, gunzip, gunzipSync, gzip, gzipSync } from 'fflate';
import type { RetainedWaterMaterial } from './decorWater';
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
  /** Optional recipe for reconstructing a retained raster without sharing its binary samples. */
  regeneration?: { query: string; crops: { x: number; y: number; width: number }[] };
  settlements: Settlement[];
  roadConfig: RoadConfig | null;
  roads: RoadOutput | null;
  /** Vector water (lakes and rivers at their physical widths) as Terrain Bench draws it, in metres. */
  waterSvg: string;
  /** Render's lake material, produced by the same renderer as the live terrain. */
  waterMaterialSvg?: string;
  /** Neutral world-space lake field and outline; appearance is evaluated on display. */
  waterMaterial?: RetainedWaterMaterial;
  terrainDisplay?: { referenceWidth?: number; floor: number; sourceCell: number; refine: boolean; globalMinHeight: number; globalMaxHeight: number; motifSize: number };
  stats: { land: number; minHeight: number; maxHeight: number; riverKm: number; roadKm: number };
  /** Optional staged-bench snapshot. Old .decor files remain readable. Coordinates are local metres. */
  pipeline?: {
    stage: 'terrain' | 'settlements' | 'urban'; parent?: string; syncSource?: string;
    crop?: { x: number; y: number; width: number; sourceWidth: number };
    urban?: import('./testbenchUrban').WorkshopState;
    urbanDraft?: Omit<import('./testbenchUrban').WorkshopState, 'layouts' | 'partitions'>;
    city?: string;
  };
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

function decorBytes(decor: Decor): Uint8Array {
  const r = decor.raster, size = r.n * r.n;
  // Land cells keep their own height as water level: store water levels only on water.
  const level = new Float32Array(size);
  for (let i = 0; i < size; i++) level[i] = r.water[i] ? r.waterLevel[i] : 0;
  const header = new TextEncoder().encode(JSON.stringify({ meta: decor.meta, width: r.width, n: r.n, geometry: r.geometry }));
  const parts = [shuffle(r.height), r.water, shuffle(level), shuffle(r.riverWidth), new Uint8Array(r.riverIds.buffer, r.riverIds.byteOffset, r.riverIds.byteLength)];
  const total = 12 + header.length + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, header.length, true);
  out.set(header, 12);
  let offset = 12 + header.length;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

/** These two slots are the retained building snapshots in the decor protocol. */
export function decorColdStates(decor: Decor) {
  return [decor.meta.pipeline?.urban?.buildingState?.cold, decor.meta.pipeline?.urbanDraft?.buildingState?.cold]
    .filter((state): state is NonNullable<typeof state> => !!state);
}
export interface DecorCodecOptions {
  /** Same-origin history or the metadata header of a complete cold export only. */
  localReferences?: true;
}
function requirePortable(decor: Decor, options?: DecorCodecOptions): void {
  if (!options?.localReferences && decorColdStates(decor).length)
    throw new Error('Une ville conservée à froid doit être exportée avec ses blocs natifs via downloadDecorFile.');
}
export function encodeDecor(decor: Decor, options?: DecorCodecOptions): Uint8Array {
  requirePortable(decor, options);
  return gzipSync(decorBytes(decor), { level: 6, mtime: 0 });
}

/** The portable format is identical; compression runs in fflate's local worker.
 * Only the newly allocated file buffer is transferred, never retained rasters. */
export function encodeDecorAsync(decor: Decor, options?: DecorCodecOptions): Promise<Uint8Array> {
  requirePortable(decor, options);
  const raw = decorBytes(decor);
  return new Promise((resolve, reject) => {
    gzip(raw, { level: 6, mtime: 0, consume: true }, (error, bytes) => error ? reject(error) : resolve(bytes));
  });
}

function readDecorBytes(raw: Uint8Array): Decor {
  if (raw.byteLength < 12) throw new Error('Truncated decor header');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a Magna Urbis decor file');
  if (view.getUint32(4, true) !== 1) throw new Error(`Unsupported decor version ${view.getUint32(4, true)}`);
  const headerLength = view.getUint32(8, true);
  if (headerLength > raw.byteLength - 12) throw new Error('Truncated decor metadata');
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + headerLength))) as { meta: DecorMeta; width: number; n: number; geometry?: VectorGeography };
  const n = header.n, size = n * n;
  if (!Number.isSafeInteger(n) || n <= 0 || !Number.isFinite(header.width) || header.width <= 0
    || !Number.isSafeInteger(size * 17) || raw.byteLength !== 12 + headerLength + size * 17
    || header.meta?.format !== 'magna-decor' || header.meta.version !== 1) throw new Error('Invalid or truncated decor raster');
  let offset = 12 + headerLength;
  const take = (bytes: number): Uint8Array => { const part = raw.slice(offset, offset + bytes); offset += bytes; return part; };
  const height = unshuffle(take(size * 4), size), water = take(size), waterLevel = unshuffle(take(size * 4), size);
  const riverWidth = unshuffle(take(size * 4), size), riverIds = new Int32Array(take(size * 4).buffer);
  for (let i = 0; i < size; i++) if (!water[i]) waterLevel[i] = height[i];
  const raster: SettlementRaster = { width: header.width, n, height, water, waterLevel, riverWidth, riverIds };
  raster.geometry = header.geometry ?? decorGeography(raster, header.meta.waterSvg);
  return { meta: header.meta, raster };
}

export function decodeDecor(data: Uint8Array): Decor { return readDecorBytes(gunzipSync(data)); }
/** File/header imports bound decompressed terrain as well as encoded bytes. */
export function decodeDecorBounded(data: Uint8Array, maxRawBytes: number): Decor {
  const parts: Uint8Array[] = []; let size = 0;
  const decoder = new Gunzip(part => {
    size += part.byteLength;
    if (size > maxRawBytes) throw new Error('Decor raster exceeds import byte budget.');
    parts.push(part);
  });
  // Small input slices bound the output produced between budget checks.
  for (let i = 0; i < data.length; i += 1024) decoder.push(data.subarray(i, i + 1024), i + 1024 >= data.length);
  if (!data.length) throw new Error('Empty decor file.');
  const raw = new Uint8Array(size); let offset = 0;
  for (const part of parts) { raw.set(part, offset); offset += part.length; }
  return readDecorBytes(raw);
}
export function decodeDecorAsync(data: Uint8Array): Promise<Decor> {
  return new Promise((resolve, reject) => {
    gunzip(data, (error, raw) => {
      if (error) { reject(error); return; }
      try { resolve(readDecorBytes(raw)); } catch (failure) { reject(failure); }
    });
  });
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
