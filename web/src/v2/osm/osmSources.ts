/** OpenStreetMap and elevation sources of an OSM import, browser and Node alike: the Overpass queries, the Terrarium
 * tiles of the square and the DEM grid sampled from them. Network and PNG decoding are injected (`OsmFetchers`), so
 * the page fetches with `fetch` + `createImageBitmap` and the CLI (scripts/osm_probe.mjs) with its disk cache. */
import { HIGHWAY, LANDUSE, NATURAL, RIVER_WIDTH, URBAN_LANDUSE } from './osmTags';

export interface OsmSquare {
  /** Centre, degrees. */
  lat: number;
  lon: number;
  /** Side of the square, metres. */
  size: number;
}
export interface OsmBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}
export interface OverpassReply {
  elements: OsmElement[];
  osm3s?: { timestamp_osm_base?: string };
  remark?: string;
}
/** RGBA pixels of one decoded 256 × 256 tile. */
export interface DecodedTile {
  w: number;
  h: number;
  channels: number;
  data: Uint8Array | Uint8ClampedArray;
}
export interface OsmFetchers {
  /** One Overpass query (POST body `data=`), parsed. `label` names it in logs. */
  overpass(query: string, label: string): Promise<OverpassReply>;
  /** One Terrarium PNG, decoded. */
  tile(zoom: number, x: number, y: number, url: string): Promise<DecodedTile>;
}

export const OVERPASS_ENDPOINTS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter'];
export const OVERPASS_IMPORT_TIMEOUT_SECONDS = 45;
export const TERRARIUM_URL = (zoom: number, x: number, y: number): string => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;
export const OSM_ATTRIBUTION = {
  osm: '© OpenStreetMap contributors, data under the Open Database License (ODbL 1.0), https://www.openstreetmap.org/copyright',
  dem: 'Elevation: AWS Terrain Tiles (Terrarium), Mapzen/Linux Foundation; sources include SRTM (NASA), EU-DEM (Copernicus), GMTED, ETOPO1 and others, https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
};

const R = 6371008.8,
  RAD = Math.PI / 180;
/** Local equirectangular projection, north-up, metres, origin at the north-west corner of the square. */
export function osmProjection(square: OsmSquare) {
  const cos0 = Math.cos(square.lat * RAD),
    half = square.size / 2;
  const bounds: OsmBounds = { south: square.lat - half / (R * RAD), north: square.lat + half / (R * RAD), west: square.lon - half / (R * RAD * cos0), east: square.lon + half / (R * RAD * cos0) };
  return {
    bounds,
    bbox: `${bounds.south.toFixed(6)},${bounds.west.toFixed(6)},${bounds.north.toFixed(6)},${bounds.east.toFixed(6)}`,
    project: (lat: number, lon: number) => ({ x: (lon - square.lon) * RAD * R * cos0 + half, y: (square.lat - lat) * RAD * R + half }),
    toLatLon: (x: number, y: number) => ({ lat: square.lat - (y - half) / (R * RAD), lon: square.lon + (x - half) / (R * RAD * cos0) }),
  };
}

/** Town, water, land use, walls and names. The probe's archived requests use this format. */
export function overpassQuery(bbox: string): string {
  return `[out:json][timeout:180];
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
}

const barrierSelectors = (bbox: string) => `way["barrier"~"^(fence|wall|hedge|retaining_wall)$"](${bbox});way["natural"="hedge"](${bbox});`;
const communeSelector = (bbox: string, commune: string) => `relation["boundary"="administrative"]["admin_level"="8"]["name"=${JSON.stringify(commune)}](${bbox});`;
/** Fences, garden walls and hedges of the square: a query of its own, so a cached main query stays valid. */
export function barrierQuery(bbox: string): string {
  return `[out:json][timeout:120];(${barrierSelectors(bbox)});out geom;`;
}
/** The admin_level=8 boundary named `commune` crossing the square. */
export function communeQuery(bbox: string, commune: string): string {
  return `[out:json][timeout:90];${communeSelector(bbox, commune)}out geom;`;
}

/** Fetch coordinates and tags for ways. Only relations need their member references and roles. */
export function overpassImportQuery(bbox: string, commune?: string): string {
  const isOneOf = (key: string, values: string[]) => `["${key}"~"^(${values.join('|')})$"]`;
  const building = '["building"]["building"!="no"]';
  const land = isOneOf('landuse', [...Object.keys(LANDUSE), ...URBAN_LANDUSE, 'reservoir', 'basin']);
  return `[out:json][timeout:${OVERPASS_IMPORT_TIMEOUT_SECONDS}];
(
  way${isOneOf('highway', Object.keys(HIGHWAY))}["footway"!~"^(sidewalk|crossing)$"](${bbox});
  way["highway"="pedestrian"]["area"="yes"](${bbox});
  way${building}(${bbox});
  way["natural"="water"](${bbox});
  way${isOneOf('waterway', [...Object.keys(RIVER_WIDTH), 'riverbank'])}(${bbox});
  way${land}(${bbox});
  way${isOneOf('natural', Object.keys(NATURAL))}(${bbox});
  way["leisure"~"^(park|garden)$"](${bbox});
  way["barrier"="city_wall"](${bbox});
  way["historic"="citywalls"](${bbox});
  way["man_made"="tower"](${bbox});
  way["historic"="tower"](${bbox});
  way["place"="square"](${bbox});
  ${barrierSelectors(bbox)}
)->.ways;
(
  relation${building}(${bbox});
  relation["natural"="water"](${bbox});
  relation${land}(${bbox});
  node["barrier"="city_gate"](${bbox});
  node["place"]["name"](${bbox});
  ${commune ? communeSelector(bbox, commune) : ''}
)->.other;
.ways out tags geom qt;
.other out geom qt;`;
}

/** Terrarium tiles covering the square at `zoom`. */
export function terrariumTiles(bounds: OsmBounds, zoom: number): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  const tx = tileX(zoom),
    ty = tileY(zoom);
  for (let y = Math.floor(ty(bounds.north)); y <= Math.floor(ty(bounds.south)); y++) for (let x = Math.floor(tx(bounds.west)); x <= Math.floor(tx(bounds.east)); x++) tiles.push({ x, y });
  return tiles;
}
const tileX = (zoom: number) => (lon: number) => ((lon + 180) / 360) * 2 ** zoom;
const tileY = (zoom: number) => (lat: number) => ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * 2 ** zoom;
/** Metres of a decoded Terrarium tile: (R × 256 + G + B / 256) − 32768. */
export function terrariumHeights(png: DecodedTile): Float32Array {
  const m = new Float32Array(256 * 256);
  for (let i = 0; i < m.length; i++) m[i] = png.data[i * png.channels] * 256 + png.data[i * png.channels + 1] + png.data[i * png.channels + 2] / 256 - 32768;
  return m;
}

/** The DEM of the square on a `grid` × `grid` cell-centred raster, from its tiles (`x/y` → heights), lightly blurred:
 * the 30 m source resampled to ~8 m shows terraces otherwise. */
export function demGrid(square: OsmSquare, grid: number, zoom: number, tiles: ReadonlyMap<string, Float32Array>): { elevations: Float32Array; min: number; max: number } {
  const { toLatLon } = osmProjection(square),
    tx = tileX(zoom),
    ty = tileY(zoom),
    cell = square.size / grid;
  const at = (x: number, y: number): number => {
    const t = tiles.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
    return t ? t[(((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)] : NaN;
  };
  const demAt = (lat: number, lon: number): number => {
    const fx = tx(lon) * 256 - 0.5,
      fy = ty(lat) * 256 - 0.5;
    const px = Math.floor(fx),
      py = Math.floor(fy),
      u = fx - px,
      v = fy - py;
    const value = (at(px, py) * (1 - u) + at(px + 1, py) * u) * (1 - v) + (at(px, py + 1) * (1 - u) + at(px + 1, py + 1) * u) * v;
    return Number.isFinite(value) ? value : at(Math.round(fx), Math.round(fy));
  };
  const elevations = new Float32Array(grid * grid);
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; x++) {
      const { lat, lon } = toLatLon((x + 0.5) * cell, (y + 0.5) * cell);
      elevations[y * grid + x] = demAt(lat, lon);
    }
  for (let pass = 0; pass < 2; pass++) {
    const src = elevations.slice();
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        let s = 0,
          c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < grid && yy < grid) {
              s += src[yy * grid + xx];
              c++;
            }
          }
        elevations[y * grid + x] = s / c;
      }
  }
  let min = Infinity,
    max = -Infinity;
  for (const v of elevations) {
    if (!Number.isFinite(v)) throw new Error('DEM gap: non-finite elevation');
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { elevations, min, max };
}

export async function fetchOsmFeatures(square: OsmSquare, options: { commune?: string }, fetchers: Pick<OsmFetchers, 'overpass'>) {
  const { bbox } = osmProjection(square);
  const osm = await fetchers.overpass(overpassQuery(bbox), bbox);
  const barriers = await fetchers.overpass(barrierQuery(bbox), `barriers ${bbox}`);
  const known = new Set(osm.elements.map(e => `${e.type}/${e.id}`));
  for (const barrier of barriers.elements) if (!known.has(`${barrier.type}/${barrier.id}`)) osm.elements.push(barrier);
  let commune: OsmElement | undefined;
  if (options.commune) {
    const found = await fetchers.overpass(communeQuery(bbox, options.commune), `commune ${options.commune}`);
    commune = found.elements.find(e => e.type === 'relation');
    if (!commune) throw new Error(`No admin_level=8 boundary named "${options.commune}" crosses the map square.`);
  }
  return { osm, commune };
}

export async function fetchOsmImportFeatures(square: OsmSquare, options: { commune?: string }, fetchers: Pick<OsmFetchers, 'overpass'>) {
  const { bbox } = osmProjection(square);
  const name = options.commune;
  const osm = await fetchers.overpass(overpassImportQuery(bbox, name), bbox);
  // Restore stable IDs and draw order after the server's faster quadtile output.
  const order = { node: 0, way: 1, relation: 2 };
  osm.elements.sort((a, b) => order[a.type] - order[b.type] || a.id - b.id);
  const commune = name ? osm.elements.find(e => e.type === 'relation' && e.tags?.boundary === 'administrative' && e.tags.admin_level === '8' && e.tags.name === name) : undefined;
  if (name && !commune) throw new Error(`No admin_level=8 boundary named "${name}" crosses the map square.`);
  return { osm, commune };
}

export async function fetchOsmDem(square: OsmSquare, options: { grid: number; zoom: number }, fetchers: Pick<OsmFetchers, 'tile'>, onTiles?: (done: number, total: number) => void) {
  const { bounds } = osmProjection(square);
  const { grid, zoom } = options;
  const tiles = new Map<string, Float32Array>();
  const coverage = terrariumTiles(bounds, zoom);
  for (let i = 0; i < coverage.length; i += 6) {
    await Promise.all(
      coverage.slice(i, i + 6).map(async ({ x, y }) => {
        tiles.set(`${x}/${y}`, terrariumHeights(await fetchers.tile(zoom, x, y, TERRARIUM_URL(zoom, x, y))));
        onTiles?.(tiles.size, coverage.length);
      }),
    );
  }
  return { dem: demGrid(square, grid, zoom, tiles), tileCount: tiles.size };
}

/** Everything the probe needs from the network. The app can preview elevation before fetching OSM features. */
export async function fetchOsmSources(square: OsmSquare, options: { grid: number; zoom: number; commune?: string }, fetchers: OsmFetchers) {
  const features = await fetchOsmFeatures(square, options, fetchers);
  return { ...features, ...(await fetchOsmDem(square, options, fetchers)) };
}
