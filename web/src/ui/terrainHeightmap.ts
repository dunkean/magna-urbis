import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';
import { parseTerrainSketch, type TerrainSketch } from '../../../rust/bridge/terrainSketch';

export interface HeightmapFile { terrain: TerrainSketch; width?: number }
const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let k = 0; k < 8; k++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
function chunk(name: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(strToU8(name), 4); out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < out.length - 4; i++) crc = crcTable[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0); return out;
}

/** Grayscale 16-bit PNG; its embedded metre range also supports external image tools. */
export function heightmapPng(s: TerrainSketch, width: number): Uint8Array {
  let min = Infinity, max = -Infinity;
  for (const h of s.heights) { min = Math.min(min, h); max = Math.max(max, h); }
  const n = s.resolution, stride = n * 2 + 1, raw = new Uint8Array(n * stride);
  const samples = new DataView(raw.buffer), range = max - min;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    samples.setUint16(y * stride + 1 + x * 2, range ? Math.round((s.heights[y * n + x] - min) / range * 65535) : 0);
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, n); view.setUint32(4, n); header[8] = 16;
  const parts = [signature, chunk('IHDR', header), chunk('tEXt', strToU8('magna-urbis\0' + JSON.stringify({ min, max, width, units: 'm', seaLevel: 0 }))), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; } return out;
}

export async function readHeightmap(file: File, min: number, max: number): Promise<HeightmapFile> {
  if (file.size > 32000000) throw new Error('Fichier trop volumineux (32 Mo maximum).');
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    const data = JSON.parse(await file.text());
    const legacySketch = data.resolution <= 128 && Object.keys(data).every(k => ['version', 'resolution', 'heights'].includes(k));
    const terrain = parseTerrainSketch({ ...data, processing: data.processing ?? (data.kind === 'sketch' || legacySketch ? undefined : 'surface') });
    return { terrain, width: validWidth(data.width) };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signature.some((v, i) => bytes[i] !== v)) throw new Error('Importez une heightmap JSON ou PNG en niveaux de gris.');
  const view = new DataView(bytes.buffer), idat: Uint8Array[] = [];
  let n = 0, depth = 0, colour = 0, width: number | undefined, packed = 0;
  for (let p = 8; p + 12 <= bytes.length;) {
    const size = view.getUint32(p), name = strFromU8(bytes.subarray(p + 4, p + 8)), start = p + 8;
    if (size > bytes.length - p - 12) throw new Error('PNG tronqué.');
    if (name === 'IHDR') {
      if (size !== 13) throw new Error('En-tête PNG invalide.');
      n = view.getUint32(start); depth = bytes[start + 8]; colour = bytes[start + 9];
      if (n < 8 || n > 1024 || view.getUint32(start + 4) !== n) throw new Error('La heightmap doit être carrée, de 8 à 1024 pixels de côté.');
      if (![8, 16].includes(depth) || colour !== 0 || bytes[start + 10] || bytes[start + 11] || bytes[start + 12]) throw new Error('Utilisez un PNG en niveaux de gris 8 ou 16 bits, sans entrelacement.');
    } else if (name === 'tEXt') {
      const text = strFromU8(bytes.subarray(start, start + size));
      if (text.startsWith('magna-urbis\0')) {
        const meta = JSON.parse(text.slice(12)); min = meta.min; max = meta.max; width = validWidth(meta.width);
      }
    } else if (name === 'IDAT') { idat.push(bytes.subarray(start, start + size)); packed += size; }
    p += size + 12;
  }
  if (!n || !idat.length || !Number.isFinite(min) || !Number.isFinite(max) || min > max || min < -12000 || max > 12000) throw new Error('Plage d’altitude invalide (−12 000 à 12 000 m).');
  const compressed = new Uint8Array(packed); let offset = 0;
  for (const part of idat) { compressed.set(part, offset); offset += part.length; }
  const bpp = depth / 8, stride = n * bpp;
  const raw = unzlibSync(compressed, { out: new Uint8Array(n * (stride + 1) + 1) });
  if (raw.length !== n * (stride + 1)) throw new Error('Données PNG invalides.');
  const decoded = new Uint8Array(n * stride);
  for (let y = 0; y < n; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('Filtre PNG invalide.');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= bpp ? decoded[i - bpp] : 0, b = y ? decoded[i - stride] : 0, c = y && x >= bpp ? decoded[i - stride - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : 0;
      decoded[i] = raw[y * (stride + 1) + 1 + x] + predictor;
    }
  }
  const heights = Array.from({ length: n * n }, (_, i) => min + (depth === 16 ? decoded[i * 2] * 256 + decoded[i * 2 + 1] : decoded[i]) / (depth === 16 ? 65535 : 255) * (max - min));
  return { terrain: parseTerrainSketch({ version: 1, resolution: n, heights, processing: 'surface' }), width };
}
function validWidth(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 500 && value <= 100000 ? value : undefined;
}
