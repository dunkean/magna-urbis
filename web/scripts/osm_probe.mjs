// From web/: node scripts/osm_probe.mjs [--lat 43.2085] [--lon 2.3575] [--size 4000] [--grid 512] [--zoom 14]
//                                         [--name Carcassonne] [--culture european-organic] [--out out/osm-probe/carcassonne.muproj]
// Look spike for an OpenStreetMap import (web/out/proposals-2026-11-22/osm-import.md). It fetches one square of OSM
// (Overpass API) and real elevation (AWS Terrain Tiles, Terrarium PNG). Then it writes a V2 project (.muproj) whose
// recipe carries the DEM as an imported heightmap and whose saved world holds the OSM town: streets, regional roads,
// buildings, walls, water, land use and names. Downloads are cached under out/osm-probe/cache. No pipeline or contract change.
import { tsImport } from 'tsx/esm/api';
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
const LAT0 = Number(args.lat ?? 43.2085),
  LON0 = Number(args.lon ?? 2.3575),
  SIZE = Number(args.size ?? 4000),
  GRID = Number(args.grid ?? 512),
  ZOOM = Number(args.zoom ?? 14),
  NAME = args.name ?? 'Carcassonne',
  CULTURE = args.culture ?? 'european-organic';
const OUT = resolve(WEB, args.out ?? 'out/osm-probe/carcassonne.muproj');
const CACHE = resolve(WEB, 'out/osm-probe/cache');
const OVERPASS = args.overpass ?? 'https://overpass-api.de/api/interpreter';
const UA = 'magna-urbis-osm-probe/0.1';
const ATTRIBUTION = {
  osm: '© OpenStreetMap contributors, data under the Open Database License (ODbL 1.0), https://www.openstreetmap.org/copyright',
  dem: 'Elevation: AWS Terrain Tiles (Terrarium), Mapzen/Linux Foundation; sources include SRTM (NASA), EU-DEM (Copernicus), GMTED, ETOPO1 and others, https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
};

const ts = path => tsImport(path, import.meta.url);
const { defaultSettings } = await ts('../src/v2/settings.ts');
const { acceptHeightmap, imageHeightmap } = await ts('../src/v2/heightmapModel.ts');
const { V2_ENGINE_VERSION } = await ts('../src/v2/cache.ts');
const { createGrid, slopeGrid } = await ts('../src/gen/core/grid.ts');
const { priorityFlood, accumulate } = await ts('../src/gen/terrain/hydrology.ts');
let validate;
try {
  validate = await ts('../src/v2/project.ts');
} catch (e) {
  console.warn('project.ts validators unavailable in Node:', String(e).slice(0, 160));
}

// ---------- projection: local equirectangular, north-up, metres, origin at the north-west corner ----------
const R = 6371008.8,
  RAD = Math.PI / 180,
  COS0 = Math.cos(LAT0 * RAD);
const half = SIZE / 2;
const SOUTH = LAT0 - half / (R * RAD),
  NORTH = LAT0 + half / (R * RAD),
  WEST = LON0 - half / (R * RAD * COS0),
  EAST = LON0 + half / (R * RAD * COS0);
const project = (lat, lon) => ({ x: (lon - LON0) * RAD * R * COS0 + half, y: (LAT0 - lat) * RAD * R + half });
const toLatLon = (x, y) => ({ lat: LAT0 - (y - half) / (R * RAD), lon: LON0 + (x - half) / (R * RAD * COS0) });

mkdirSync(CACHE, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

// ---------- Overpass ----------
const bbox = `${SOUTH.toFixed(6)},${WEST.toFixed(6)},${NORTH.toFixed(6)},${EAST.toFixed(6)}`;
const query = `[out:json][timeout:180];
(
  way["highway"](${bbox});
  way["building"](${bbox});
  relation["building"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["waterway"](${bbox});
  way["landuse"](${bbox});
  relation["landuse"](${bbox});
  way["natural"~"^(wood|scrub|grassland|heath|wetland)$"](${bbox});
  way["leisure"~"^(park|garden)$"](${bbox});
  way["barrier"="city_wall"](${bbox});
  way["historic"="citywalls"](${bbox});
  node["barrier"="city_gate"](${bbox});
  way["man_made"="tower"](${bbox});
  way["historic"="tower"](${bbox});
  node["place"](${bbox});
  way["place"="square"](${bbox});
  way["highway"="pedestrian"]["area"="yes"](${bbox});
);
out geom;`;
async function cached(file, fetcher) {
  const path = resolve(CACHE, file);
  if (existsSync(path)) return readFileSync(path);
  const bytes = await fetcher();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
}
const overpassKey = createHash('sha1').update(query).digest('hex').slice(0, 16);
const osm = JSON.parse(
  (
    await cached(`overpass-${overpassKey}.json`, async () => {
      console.log('Overpass:', bbox);
      const response = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
      if (!response.ok) throw new Error(`Overpass ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return Buffer.from(await response.arrayBuffer());
    })
  ).toString('utf8'),
);
const osmTimestamp = osm.osm3s?.timestamp_osm_base ?? '';
console.log(`OSM elements: ${osm.elements.length} (base ${osmTimestamp})`);

// ---------- Terrarium DEM ----------
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
const tileX = lon => ((lon + 180) / 360) * 2 ** ZOOM;
const tileY = lat => ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * 2 ** ZOOM;
const tiles = new Map();
for (let ty = Math.floor(tileY(NORTH)); ty <= Math.floor(tileY(SOUTH)); ty++)
  for (let tx = Math.floor(tileX(WEST)); tx <= Math.floor(tileX(EAST)); tx++) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`;
    const png = decodePng(
      await cached(`terrarium/${ZOOM}/${tx}/${ty}.png`, async () => {
        console.log('DEM tile', url);
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`Terrain tile ${r.status}: ${url}`);
        return Buffer.from(await r.arrayBuffer());
      }),
    );
    const m = new Float32Array(256 * 256);
    for (let i = 0; i < m.length; i++) m[i] = png.data[i * png.channels] * 256 + png.data[i * png.channels + 1] + png.data[i * png.channels + 2] / 256 - 32768;
    tiles.set(`${tx}/${ty}`, m);
  }
function demAt(lat, lon) {
  const fx = tileX(lon) * 256 - 0.5,
    fy = tileY(lat) * 256 - 0.5;
  const px = Math.floor(fx),
    py = Math.floor(fy),
    tx = fx - px,
    ty = fy - py;
  const at = (x, y) => {
    const t = tiles.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
    return t ? t[(((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)] : NaN;
  };
  const v = (at(px, py) * (1 - tx) + at(px + 1, py) * tx) * (1 - ty) + (at(px, py + 1) * (1 - tx) + at(px + 1, py + 1) * tx) * ty;
  return Number.isFinite(v) ? v : at(Math.round(fx), Math.round(fy));
}
const cell = SIZE / GRID;
const elevations = new Float32Array(GRID * GRID);
for (let y = 0; y < GRID; y++)
  for (let x = 0; x < GRID; x++) {
    const { lat, lon } = toLatLon((x + 0.5) * cell, (y + 0.5) * cell);
    elevations[y * GRID + x] = demAt(lat, lon);
  }
// The 30 m DEM resampled to ~8 m shows terraces: a light 3×3 box blur, twice.
for (let pass = 0; pass < 2; pass++) {
  const src = elevations.slice();
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      let s = 0,
        c = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < GRID && yy < GRID) {
            s += src[yy * GRID + xx];
            c++;
          }
        }
      elevations[y * GRID + x] = s / c;
    }
}
let minH = Infinity,
  maxH = -Infinity;
for (const v of elevations) {
  if (!Number.isFinite(v)) throw new Error('DEM gap: non-finite elevation');
  minH = Math.min(minH, v);
  maxH = Math.max(maxH, v);
}
console.log(`DEM: ${tiles.size} tiles z${ZOOM}, ${minH.toFixed(0)}–${maxH.toFixed(0)} m`);

// ---------- OSM geometry helpers ----------
const signedArea = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return a / 2;
};
const positive = ring => (signedArea(ring) < 0 ? ring.slice().reverse() : ring);
const openRing = ring => (ring.length > 1 && ring[0].x === ring.at(-1).x && ring[0].y === ring.at(-1).y ? ring.slice(0, -1) : ring);
const pts = geometry => geometry.filter(Boolean).map(g => project(g.lat, g.lon));
const inMap = (p, m = 0) => p.x >= -m && p.y >= -m && p.x <= SIZE + m && p.y <= SIZE + m;
const centroid = ring => {
  let x = 0,
    y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
};
const length = path => path.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
/** Clip a polyline to the map (plus a margin): the runs of consecutive inside points. */
function clipLine(path, margin = 30) {
  const runs = [];
  let run = [];
  for (const p of path) {
    if (inMap(p, margin)) run.push(p);
    else if (run.length) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}
/** Multipolygon members (outer/inner ways) joined into closed rings. */
function joinRings(ways) {
  const rings = [],
    open = ways.map(w => w.slice());
  const key = p => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  while (open.length) {
    let ring = open.pop();
    let guard = 0;
    while (key(ring[0]) !== key(ring.at(-1)) && guard++ < 10000) {
      const i = open.findIndex(w => key(w[0]) === key(ring.at(-1)) || key(w.at(-1)) === key(ring.at(-1)));
      if (i < 0) break;
      const next = open.splice(i, 1)[0];
      ring = ring.concat(key(next[0]) === key(ring.at(-1)) ? next.slice(1) : next.slice(0, -1).reverse());
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
/** Areas of an element: [{outer, holes}] in map metres. */
function areas(el) {
  if (el.type === 'way' && el.geometry && el.geometry.length >= 4) {
    const ring = openRing(pts(el.geometry));
    return ring.length >= 3 ? [{ outer: positive(ring), holes: [] }] : [];
  }
  if (el.type === 'relation' && el.members) {
    const outer = joinRings(el.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => m.geometry.filter(Boolean)));
    const inner = joinRings(el.members.filter(m => m.type === 'way' && m.role === 'inner' && m.geometry).map(m => m.geometry.filter(Boolean)));
    const holes = inner.map(r => positive(openRing(pts(r))));
    return outer.map(r => ({ outer: positive(openRing(pts(r))), holes })).filter(a => a.outer.length >= 3);
  }
  return [];
}
const visible = a => a.outer.some(p => inMap(p, 200));
function pointInRing(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Even-odd scanline fill of one area into a grid mask, at cell centres. */
function rasterize(mask, area, value) {
  const rings = [area.outer, ...area.holes];
  let y0 = Infinity,
    y1 = -Infinity;
  for (const p of area.outer) {
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  for (let gy = Math.max(0, Math.floor(y0 / cell)); gy <= Math.min(GRID - 1, Math.ceil(y1 / cell)); gy++) {
    const cy = (gy + 0.5) * cell,
      xs = [];
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i],
          b = ring[j];
        if (a.y > cy !== b.y > cy) xs.push(((b.x - a.x) * (cy - a.y)) / (b.y - a.y) + a.x);
      }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let gx = Math.max(0, Math.ceil(xs[k] / cell - 0.5)); gx <= Math.min(GRID - 1, Math.floor(xs[k + 1] / cell - 0.5)); gx++) mask[gy * GRID + gx] = value;
  }
}

// ---------- classify OSM elements ----------
const tags = el => el.tags ?? {};
const HIGHWAY = {
  motorway: { region: 'major', width: 10 },
  trunk: { region: 'major', width: 9 },
  primary: { region: 'major', width: 8 },
  secondary: { region: 'major', width: 7 },
  tertiary: { region: 'minor', width: 6 },
  motorway_link: { region: 'major', width: 6 },
  trunk_link: { region: 'major', width: 6 },
  primary_link: { region: 'major', width: 6 },
  secondary_link: { region: 'major', width: 6 },
  tertiary_link: { region: 'minor', width: 5 },
  track: { region: 'track', width: 3 },
  unclassified: { kind: 'street', rank: 2, role: 'street', width: 4.5 },
  residential: { kind: 'street', rank: 2, role: 'street', width: 5 },
  living_street: { kind: 'street', rank: 3, role: 'lane', width: 4 },
  pedestrian: { kind: 'street', rank: 2, role: 'street', width: 5 },
  service: { kind: 'alley', rank: 3, role: 'lane', width: 3.5 },
  footway: { kind: 'alley', rank: 4, role: 'lane', width: 2 },
  path: { kind: 'alley', rank: 4, role: 'lane', width: 1.6 },
  steps: { kind: 'alley', rank: 4, role: 'lane', width: 2 },
  cycleway: { kind: 'alley', rank: 4, role: 'lane', width: 2 },
  bridleway: { region: 'track', width: 2 },
};
const ROOF = { gabled: 'gable', hipped: 'hip', flat: 'flat', dome: 'dome', pyramidal: 'pyramidal', conical: 'conical', round: 'barrel', half_hipped: 'hip', skillion: 'flat', mansard: 'hip', gambrel: 'gable', saltbox: 'gable' };
const KIND = { house: 'domestic', detached: 'domestic', semidetached_house: 'domestic', terrace: 'domestic', residential: 'domestic', apartments: 'collective', farm: 'domestic', commercial: 'mixed', retail: 'mixed', office: 'mixed', hotel: 'collective', industrial: 'warehouse', warehouse: 'warehouse', garage: 'workshop', garages: 'workshop', shed: 'workshop', barn: 'workshop', farm_auxiliary: 'workshop', church: 'collective', cathedral: 'collective', chapel: 'collective', school: 'collective', public: 'collective', civic: 'collective', castle: 'collective', tower: 'collective' };
const LANDUSE = { farmland: 'field', vineyard: 'orchard', orchard: 'orchard', meadow: 'meadow', grass: 'meadow', forest: 'forest', allotments: 'garden', village_green: 'commons', recreation_ground: 'commons', farmyard: 'pasture' };
const NATURAL = { wood: 'forest', scrub: 'commons', grassland: 'meadow', heath: 'commons', wetland: 'marsh' };
const URBAN_LANDUSE = new Set(['residential', 'commercial', 'retail', 'industrial', 'religious', 'civic', 'education', 'military']);
const num = v => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

const streets = [],
  roads = [],
  bridges = [],
  buildings = [],
  landmarks = [],
  squares = [],
  wallWays = [],
  towerPoints = [],
  gatePoints = [],
  waterAreas = [],
  riverLines = [],
  landAreas = [],
  footprint = [],
  places = [];
let roadSerial = 0;
for (const el of osm.elements) {
  const t = tags(el);
  if (el.type === 'node') {
    const p = project(el.lat, el.lon);
    if (t.barrier === 'city_gate') gatePoints.push(p);
    if (t.man_made === 'tower' || t.historic === 'tower') towerPoints.push(p);
    if (t.place && t.name) places.push({ ...t, p });
    continue;
  }
  if (el.type === 'way' && el.geometry && (t['tower:type'] === 'defensive' || t.historic === 'tower')) towerPoints.push(centroid(pts(el.geometry)));
  if (el.type === 'way' && el.geometry && (t.historic === 'city_gate' || t.barrier === 'city_gate')) gatePoints.push(centroid(pts(el.geometry)));
  // Cadastre-traced curtains (Carcassonne): thin building areas tagged defensive_works=curtain_wall, kept as buildings
  // and also turned into wall centre lines.
  if (el.type === 'way' && el.geometry && t.defensive_works === 'curtain_wall') {
    const line = centreLine(openRing(pts(el.geometry)));
    if (line) wallWays.push({ path: line, closed: false });
  }
  if (t.highway && el.type === 'way' && el.geometry) {
    const spec = HIGHWAY[t.highway];
    if (t.area === 'yes' && t.highway === 'pedestrian') {
      squares.push(...areas(el).filter(visible));
      continue;
    }
    if (!spec || t.footway === 'sidewalk' || t.footway === 'crossing') continue;
    const width = num(t.width) ?? spec.width;
    for (const path of clipLine(pts(el.geometry))) {
      if (path.length < 2 || length(path) < 2) continue;
      if (spec.region) roads.push({ path, kind: spec.region, width, editorId: `osm-way-${el.id}-${roadSerial++}`, name: t.name });
      else streets.push({ path, width, widths: path.map(() => width), kind: spec.kind, rank: spec.rank, role: spec.role, phase: 0, name: t.name });
      if (t.bridge && t.bridge !== 'no') bridges.push({ a: path[0], b: path.at(-1), width });
    }
    continue;
  }
  if (t.building && t.building !== 'no') {
    for (const a of areas(el)) {
      if (!a.outer.some(p => inMap(p))) continue;
      const levels = num(t['building:levels']) ?? (KIND[t.building] === 'workshop' ? 1 : 2);
      const height = num(t.height) ?? levels * 3.1 + 2;
      const area = signedArea(a.outer);
      let best = 0,
        orientation = 0;
      for (let i = 0; i < a.outer.length; i++) {
        const p = a.outer[i],
          q = a.outer[(i + 1) % a.outer.length],
          d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d > best) {
          best = d;
          orientation = Math.atan2(q.y - p.y, q.x - p.x);
        }
      }
      const religious = ['church', 'cathedral', 'chapel'].includes(t.building) || t.amenity === 'place_of_worship';
      const castle = t.building === 'castle' || t.historic === 'castle';
      buildings.push({
        poly: a.outer,
        courtyards: a.holes,
        kind: KIND[t.building] ?? (religious || castle ? 'collective' : 'domestic'),
        height: Math.round(height * 100) / 100,
        arch: 'silhouette',
        roof: ROOF[t['roof:shape']] ?? (area > 600 ? 'flat' : area > 250 ? 'hip' : 'gable'),
        storeys: Math.max(1, Math.min(100, Math.round(levels))),
        material: 'stone',
        orientation,
      });
      if ((religious || castle) && t.name) landmarks.push({ kind: castle ? 'castle' : t.building === 'cathedral' ? 'cathedral' : 'church', poly: a.outer, name: t.name });
    }
    continue;
  }
  if (t.barrier === 'city_wall' || t.historic === 'citywalls') {
    if (el.type === 'way' && el.geometry) for (const path of clipLine(pts(el.geometry), 0)) wallWays.push({ path, closed: el.geometry.length > 3 && el.geometry[0].lat === el.geometry.at(-1).lat && el.geometry[0].lon === el.geometry.at(-1).lon });
    continue;
  }
  if ((t.man_made === 'tower' || t.historic === 'tower') && el.type === 'way' && el.geometry) {
    if (!(t['tower:type'] === 'defensive' || t.historic === 'tower')) towerPoints.push(centroid(pts(el.geometry)));
    continue;
  }
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') {
    const river = t.water === 'river' || t.water === 'canal' || t.waterway === 'riverbank' || t.water === 'stream';
    for (const a of areas(el).filter(visible)) waterAreas.push({ ...a, river, name: t.name });
    continue;
  }
  if (t.waterway && el.type === 'way' && el.geometry) {
    const width = num(t.width) ?? { river: 35, canal: 10, stream: 3, ditch: 1.5, drain: 1.5 }[t.waterway];
    if (!width) continue;
    for (const path of clipLine(pts(el.geometry), 50)) riverLines.push({ path, width, name: t.name, type: t.waterway });
    continue;
  }
  if (t.place === 'square') {
    squares.push(...areas(el).filter(visible));
    continue;
  }
  const land = LANDUSE[t.landuse] ?? NATURAL[t.natural] ?? (t.leisure ? 'garden' : undefined);
  if (land) {
    for (const a of areas(el).filter(visible)) landAreas.push({ kind: land, poly: a.outer, ...(a.holes.length ? { holes: a.holes } : {}) });
    continue;
  }
  if (URBAN_LANDUSE.has(t.landuse)) footprint.push(...areas(el).filter(visible));
}

// Walls: towers and gates near the curtain.
/** Centre line of a thin polygon: its ring split at the two farthest vertices, the halves resampled and averaged. */
function centreLine(ring) {
  if (ring.length < 4) return null;
  let a = 0,
    b = 0,
    best = -1;
  for (let i = 0; i < ring.length; i++)
    for (let j = i + 1; j < ring.length; j++) {
      const d = Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y);
      if (d > best) [best, a, b] = [d, i, j];
    }
  const side1 = ring.slice(a, b + 1),
    side2 = ring.slice(b).concat(ring.slice(0, a + 1)).reverse();
  const k = Math.max(2, Math.ceil(best / 4)),
    sample = (path, f) => {
      const total = length(path);
      let target = f * total;
      for (let i = 1; i < path.length; i++) {
        const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        if (target <= d || i === path.length - 1) {
          const u = d ? Math.min(1, target / d) : 0;
          return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * u, y: path[i - 1].y + (path[i].y - path[i - 1].y) * u };
        }
        target -= d;
      }
      return path.at(-1);
    };
  return Array.from({ length: k + 1 }, (_, i) => {
    const p = sample(side1, i / k),
      q = sample(side2, i / k);
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
}
const nearPath = (p, path, d) => path.some((q, i) => i && segDist(p, path[i - 1], q) < d);
function segDist(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy,
    t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const walls = wallWays.map(w => ({
  path: w.path,
  closed: w.closed,
  towers: towerPoints.filter(p => nearPath(p, w.path, 20)),
  gates: gatePoints.filter(p => nearPath(p, w.path, 25)),
  thickness: 3,
  towerShape: 'round',
  role: 'town',
}));

// ---------- terrain ----------
const height = createGrid(GRID, GRID, cell);
height.data.set(elevations);
const water = new Uint8Array(GRID * GRID);
for (const a of waterAreas) rasterize(water, a, a.river ? 3 : 2);
// Water surfaces are flat and sit a little below their banks.
for (const a of waterAreas) {
  const mask = new Uint8Array(GRID * GRID);
  rasterize(mask, a, 1);
  let low = Infinity;
  for (let i = 0; i < mask.length; i++) if (mask[i]) low = Math.min(low, height.data[i]);
  if (!a.river && Number.isFinite(low)) for (let i = 0; i < mask.length; i++) if (mask[i]) height.data[i] = low - 0.5;
}
const flood = priorityFlood(height, new Uint8Array(GRID * GRID));
const flow = createGrid(GRID, GRID, cell);
flow.data.set(accumulate(flood.receiver, flood.order));
const filled = flood.filled ?? Float32Array.from(height.data);
let receiver = flood.receiver;
if (!(receiver instanceof Int32Array)) receiver = Int32Array.from(receiver);
const edgeMean = side => {
  let s = 0;
  for (let k = 0; k < GRID; k++) s += height.data[side === 'N' ? k : side === 'S' ? (GRID - 1) * GRID + k : side === 'W' ? k * GRID : k * GRID + GRID - 1];
  return s / GRID;
};
const downSide = ['N', 'E', 'S', 'W'].sort((a, b) => edgeMean(a) - edgeMean(b))[0];

// Rivers: OSM waterway lines (the main one is the longest named river).
riverLines.sort((a, b) => (b.type === 'river') - (a.type === 'river') || length(b.path) - length(a.path));
const rivers = riverLines.map((r, id) => ({
  path: r.path,
  width: r.path.map(() => r.width),
  ...(r.name ? { name: r.name } : {}),
  id,
  ...(id === 0 && r.type === 'river' ? { main: true } : {}),
  cls: r.width >= 60 ? 'major' : r.width >= 12 ? 'river' : r.width >= 3 ? 'stream' : 'brook',
}));
const terrain = {
  height,
  slope: slopeGrid(height),
  water,
  flow,
  seaLevel: 0,
  seaFraction: 0,
  coastline: [],
  lakes: waterAreas.filter(a => !a.river).map(a => a.outer),
  rivers,
  waterGeometry: waterAreas.map(a => [a.outer, ...a.holes]),
  receiver,
  filled,
  downSide,
  seaSide: null,
};

// ---------- town ----------
const town = places.find(p => p.name === NAME) ?? places.find(p => ['city', 'town'].includes(p.place));
const cite = places.find(p => /cit[ée]/i.test(p.name));
const center = cite?.p ?? town?.p ?? { x: half, y: half };
if (!footprint.length && buildings.length) {
  // Fallback: the buildings' bounding box.
  const xs = buildings.flatMap(b => b.poly.map(p => p.x)),
    ys = buildings.flatMap(b => b.poly.map(p => p.y));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  footprint.push({ outer: [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }].reverse(), holes: [] });
}
const population = Math.round(buildings.filter(b => b.kind === 'domestic' || b.kind === 'collective' || b.kind === 'mixed').length * 3.5);
const named = streets.filter(s => s.name);
for (const s of streets) delete s.name;
const urban = {
  footprintH: footprint,
  footprint: footprint.map(a => a.outer),
  population,
  culture: CULTURE,
  cultures: [CULTURE],
  archetype: 'town',
  morphology: 'osm-import',
  blocks: footprint.map(a => a.outer),
  blockInfo: footprint.map(() => ({ quarter: 0, phase: 0, zone: 'core', kind: 'block', culture: CULTURE })),
  quarters: [{ poly: footprint[0] ?? { outer: [], holes: [] }, phase: 0, zone: 'core', streetSpace: [], culture: CULTURE }],
  phases: [{ id: 0, kind: 'core', zone: 'core', region: footprint, walled: walls.length > 0, fossil: false }],
  streets,
  parcels: [],
  buildings,
  masses: buildings.map(b => ({ outer: b.poly, holes: b.courtyards })),
  walls,
  landmarks,
  squares: squares.map(a => a.outer),
  backLand: [],
  ruralReserve: [],
  quays: [],
};
const ring = (c, r, k = 28) => Array.from({ length: k }, (_, i) => ({ x: c.x + r * Math.cos((i / k) * 2 * Math.PI), y: c.y + r * Math.sin((i / k) * 2 * Math.PI) }));
const radius = Math.min(half, Math.max(300, Math.sqrt(buildings.length) * 15));
const settlement = {
  key: 'main',
  index: 0,
  main: true,
  cls: population > 20000 ? 'city' : 'town',
  population,
  culture: CULTURE,
  center,
  archetype: 'bridge',
  radius,
  extent: ring(center, radius),
  region: [
    { x: 0, y: 0 },
    { x: 0, y: SIZE },
    { x: SIZE, y: SIZE },
    { x: SIZE, y: 0 },
  ].reverse(),
  fixed: true,
  name: NAME,
  detail: 'main',
  urban,
};

// ---------- names ----------
const entries = [];
const mid = path => path[Math.floor(path.length / 2)];
const add = (kind, text, anchor, extra = {}) => entries.push({ id: `osm:${kind}:${entries.length}`, entityKey: `osm:${kind}:${entries.length}`, kind, text, canonicalText: text, rank: { town: 0, river: 1, castle: 1, church: 2, road: 2, square: 3, street: 3, quarter: 2, village: 2 }[kind] ?? 3, anchor, generated: false, ...extra });
add('town', NAME, town?.p ?? center);
for (const p of places) if (p !== town && ['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet', 'locality'].includes(p.place) && inMap(p.p)) add(p.place === 'village' || p.place === 'hamlet' ? 'village' : 'quarter', p.name, p.p);
const seenRivers = new Set();
for (const r of rivers) if (r.name && !seenRivers.has(r.name) && length(r.path) > 300) {
  seenRivers.add(r.name);
  add('river', r.name, mid(r.path), { path: r.path });
}
for (const l of landmarks) add(l.kind === 'castle' ? 'castle' : 'church', l.name, centroid(l.poly));
const seenStreets = new Set();
for (const s of named.sort((a, b) => length(b.path) - length(a.path))) if (!seenStreets.has(s.name) && length(s.path) > 80) {
  seenStreets.add(s.name);
  add('street', s.name, mid(s.path), { path: s.path, cityKey: 'main' });
}
const seenRoads = new Set();
for (const r of roads) if (r.name && !seenRoads.has(r.name) && length(r.path) > 300) {
  seenRoads.add(r.name);
  add('road', r.name, mid(r.path), { path: r.path });
}
for (const r of roads) delete r.name;

// ---------- recipe + world ----------
const settings = defaultSettings();
acceptHeightmap(settings, imageHeightmap({ w: GRID, h: GRID, rgba: new Uint8Array(GRID * GRID * 4), elevations: Float32Array.from(elevations), name: 'Terrarium DEM' }), `${NAME} DEM (AWS Terrain Tiles z${ZOOM})`);
settings.extent = SIZE;
settings.options.mapSize = SIZE;
settings.options.culture = CULTURE;
settings.options.population = population;
settings.options.workflow = 'list';
settings.naming = { ...settings.naming, title: NAME, places: { main: NAME } };
settings.region = {
  ...settings.region,
  placement: { ...settings.region?.placement, mode: 'list', farmDensity: 0, remotePlaces: 0, list: [{ key: 'main', name: NAME, population, culture: CULTURE, siteType: 'auto', sitePrefs: {} }] },
  demography: { ...settings.region?.demography, isolatedCount: 0, followCulture: false },
};
const notice = `Imported from OpenStreetMap, ${osmTimestamp.slice(0, 10)}: ${ATTRIBUTION.osm}. ${ATTRIBUTION.dem}.`;
const world = {
  seed: `osm-${NAME.toLowerCase()}`,
  options: { ...settings.options },
  mapSize: SIZE,
  terrain,
  roads: roads.map(({ path, kind, width, editorId }) => ({ path, kind, width, editorId })),
  bridges,
  urban,
  settlements: [settlement],
  landuse: { areas: landAreas, farmsteads: [], reserve: urban.footprint, ways: [], headlands: [] },
  names: { family: 'french', town: NAME, entries },
  stats: {
    'v2.stage': 'towns',
    'v2.engine': V2_ENGINE_VERSION,
    'v2.compositionNotice': notice,
    'osm.attribution': ATTRIBUTION.osm,
    'osm.timestamp': osmTimestamp,
    'osm.bbox': bbox,
    'dem.attribution': ATTRIBUTION.dem,
    'dem.source': `AWS Terrain Tiles terrarium z${ZOOM}`,
  },
};
if (validate) {
  validate.validateSettings(settings);
  validate.validateWorld(world);
  console.log('V2 validators: settings and world OK');
}

// ---------- .muproj writer (format of web/src/v2/projectBinary.ts) ----------
const projectFile = { format: 'magna-urbis-v2', version: 1, engine: V2_ENGINE_VERSION, settings, world, mods: [], source: { attribution: ATTRIBUTION, osmTimestamp, bbox, center: { lat: LAT0, lon: LON0 }, size: SIZE } };
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
console.log(
  `Wrote ${OUT}\n  buildings ${buildings.length}, town streets ${streets.length}, regional roads ${roads.length}, bridges ${bridges.length}, walls ${walls.length} (towers ${walls.reduce((s, w) => s + w.towers.length, 0)}, gates ${walls.reduce((s, w) => s + w.gates.length, 0)}),` +
    ` water areas ${waterAreas.length}, rivers ${rivers.length}, land areas ${landAreas.length}, urban areas ${footprint.length}, squares ${squares.length}, landmarks ${landmarks.length}, names ${entries.length}, population ~${population}`,
);
