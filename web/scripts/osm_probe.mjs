// From web/: npx vite-node scripts/osm_probe.mjs -- [--lat 43.2085] [--lon 2.3575] [--size 4000] [--grid 512] [--zoom 14]
//                                         [--name Carcassonne] [--culture european-organic] [--out out/osm-probe/carcassonne.muproj]
//                                         [--commune "Les Matelles"] (town content limited to that admin_level=8 boundary)
// CLI of the OpenStreetMap import (web/src/v2/osm): downloads one square of OSM (Overpass API) and real elevation (AWS
// Terrain Tiles, Terrarium PNG) into out/osm-probe/cache, converts it with importOsm (the same code the page will run)
// and writes a V2 project (.muproj): the recipe carries the DEM as an imported heightmap, the saved world the OSM town.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(/\s*--/)
    .filter(Boolean)
    .map(a => {
      const [k, ...v] = a.split(/\s+/);
      return [k, v.join(' ')];
    }),
);
// Default: La Cité, the Aude and the Bastide Saint-Louis.
const COMMUNE = args.commune?.replace(/^"|"$/g, '');
const options = {
  lat: Number(args.lat ?? 43.2085),
  lon: Number(args.lon ?? 2.3575),
  size: Number(args.size ?? 4000),
  grid: Number(args.grid ?? 512),
  zoom: Number(args.zoom ?? 14),
  name: args.name ?? COMMUNE ?? 'Carcassonne',
  culture: args.culture ?? 'european-organic',
  ...(COMMUNE ? { communeName: COMMUNE } : {}),
};
const OUT = resolve(WEB, args.out ?? 'out/osm-probe/carcassonne.muproj');
const CACHE = resolve(WEB, 'out/osm-probe/cache');
const OVERPASS = args.overpass ?? 'https://overpass-api.de/api/interpreter';
const UA = 'magna-urbis-osm-probe/0.1';

// Run with vite-node: it resolves the page's TypeScript (and its rust/bridge imports) as the page bundle does.
const { fetchOsmSources, OVERPASS_ENDPOINTS } = await import('../src/v2/osm/osmSources.ts');
const { importOsm } = await import('../src/v2/osm/osmImport.ts');
const { retainedTerrainMatchesSettings } = await import('../src/v2/engine.ts');
const { V2_ENGINE_VERSION } = await import('../src/v2/cache.ts');
const validate = await import('../src/v2/project.ts');
mkdirSync(CACHE, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

async function cached(file, fetcher) {
  const path = resolve(CACHE, file);
  if (existsSync(path)) return readFileSync(path);
  const bytes = await fetcher();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
}
/** One Overpass query with retries: the public instances answer 429/502/504 or a runtime-error remark under load. */
async function overpass(q, label) {
  const endpoints = [...new Set([OVERPASS, ...OVERPASS_ENDPOINTS])];
  for (let attempt = 0; ; attempt++) {
    const endpoint = endpoints[attempt % endpoints.length];
    try {
      console.log(`Overpass ${label} (${endpoint}, try ${attempt + 1})`);
      const response = await fetch(endpoint, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      const value = JSON.parse(text);
      if (/runtime error/i.test(value.remark ?? '')) throw new Error(value.remark);
      return Buffer.from(text, 'utf8');
    } catch (error) {
      if (attempt >= 7) throw error;
      const pause = 15000 * (attempt + 1);
      console.log(`  failed (${String(error.message ?? error).slice(0, 160)}); retry in ${pause / 1000} s`);
      await new Promise(ok => setTimeout(ok, pause));
    }
  }
}

// ---------- Terrarium PNG ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  let o = 8,
    w = 0,
    h = 0,
    type = 0,
    depth = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o),
      kind = buf.toString('ascii', o + 4, o + 8),
      data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12] !== 0) throw new Error('Interlaced PNG');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  const channels = { 2: 3, 6: 4, 0: 1, 4: 2 }[type];
  if (depth !== 8 || !channels) throw new Error(`Unsupported PNG (type ${type}, depth ${depth})`);
  const raw = zlib.inflateSync(Buffer.concat(idat)),
    stride = w * channels,
    out = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)],
      line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0,
        b = y ? out[(y - 1) * stride + x] : 0,
        c = x >= channels && y ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, channels, data: out };
}

const fetchers = {
  // Cache files keep their historical names: sha1 of the query text (commune files under `commune-`).
  overpass: async (q, label) => {
    const prefix = label.startsWith('commune ') ? 'commune' : label.startsWith('barriers ') ? 'barriers' : 'overpass';
    return JSON.parse((await cached(`${prefix}-${createHash('sha1').update(q).digest('hex').slice(0, 16)}.json`, () => overpass(q, label))).toString('utf8'));
  },
  tile: async (zoom, x, y, url) =>
    decodePng(
      await cached(`terrarium/${zoom}/${x}/${y}.png`, async () => {
        console.log('DEM tile', url);
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`Terrain tile ${r.status}: ${url}`);
        return Buffer.from(await r.arrayBuffer());
      }),
    ),
};
const { osm, commune, dem, tileCount } = await fetchOsmSources({ lat: options.lat, lon: options.lon, size: options.size }, { grid: options.grid, zoom: options.zoom, commune: COMMUNE }, fetchers);
console.log(`OSM elements: ${osm.elements.length} (base ${osm.osm3s?.timestamp_osm_base ?? ''})`);
console.log(`DEM: ${tileCount} tiles z${options.zoom}, ${dem.min.toFixed(0)}–${dem.max.toFixed(0)} m`);
const { settings, world, source, summary, log } = importOsm({ osm, commune, elevations: dem.elevations, options });
for (const line of log) console.log(line);
if (!retainedTerrainMatchesSettings(world, settings)) throw new Error('The imported world does not match its recipe terrain key.');
console.log('Terrain key matches the recipe');
validate.validateSettings(settings);
validate.validateWorld(world);
console.log('V2 validators: settings and world OK');

// ---------- .muproj writer (format of web/src/v2/projectBinary.ts) ----------
const projectFile = { format: 'magna-urbis-v2', version: 1, engine: V2_ENGINE_VERSION, settings, world, mods: [], source };
const blocks = [],
  indices = new Map();
const skeleton = Buffer.from(
  JSON.stringify(projectFile, (_key, value) => {
    if (ArrayBuffer.isView(value)) {
      let index = indices.get(value);
      if (index === undefined) {
        index = blocks.length;
        indices.set(value, index);
        blocks.push(value);
      }
      return { $mub: index, type: value.constructor.name, length: value.length };
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return { $mu: 'number', value: String(value) };
    return value;
  }),
  'utf8',
);
const parts = [Buffer.alloc(4), skeleton];
parts[0].writeUInt32LE(skeleton.length, 0);
let offset = 4 + skeleton.length;
for (const block of blocks) {
  const start = Math.ceil(offset / 8) * 8;
  if (start > offset) parts.push(Buffer.alloc(start - offset));
  parts.push(Buffer.from(block.buffer, block.byteOffset, block.byteLength));
  offset = start + block.byteLength;
}
const MAGIC = Buffer.from([0x4d, 0x55, 0x50, 0x52, 0x4f, 0x4a, 0, 1]);
writeFileSync(OUT, Buffer.concat([MAGIC, zlib.gzipSync(Buffer.concat(parts), { level: 6 })]));
console.log(`Wrote ${OUT}
  ${Object.entries(summary)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}`);
