import { OVERPASS_ENDPOINTS, osmProjection, overpassImportQuery, type OsmBounds, type OsmElement, type OsmSquare, type OverpassReply } from './osmSources';

type Coordinate = { lat: number; lon: number };
type Geometry = NonNullable<OsmElement['geometry']>;
type RecordValue = Record<string, unknown>;
export interface OsmFile {
  osm: OverpassReply;
  bounds: OsmBounds;
}

export const MAX_OSM_FILE_BYTES = 64 * 1024 * 1024;

const record = (value: unknown): RecordValue | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const idOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined);

function coordinateOf(value: unknown): Coordinate | null {
  const point = record(value);
  const { lat, lon } = point ?? {};
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 && typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

function boundsOf(value: unknown): OsmBounds | undefined {
  const bounds = record(value);
  if (!bounds) return;
  const sw = coordinateOf({ lat: bounds.minlat, lon: bounds.minlon });
  const ne = coordinateOf({ lat: bounds.maxlat, lon: bounds.maxlon });
  if (sw && ne && sw.lat <= ne.lat && sw.lon <= ne.lon) return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

function parseXml(text: string): RecordValue {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const root = doc.documentElement;
  if (root.localName !== 'osm' || doc.doctype || doc.getElementsByTagName('parsererror').length) throw new Error('Invalid OpenStreetMap XML file.');
  const numeric = (element: Element, attribute: string) => {
    const value = element.getAttribute(attribute);
    return value?.trim() ? Number(value) : undefined;
  };
  const point = (element: Element) => ({ lat: numeric(element, 'lat'), lon: numeric(element, 'lon') });
  const elements: RecordValue[] = [];
  let bounds: unknown;
  let timestamp: string | null = null;
  let remark: string | null = null;
  for (const child of Array.from(root.children)) {
    const type = child.localName;
    if (type === 'bounds') {
      bounds = Object.fromEntries(['minlat', 'minlon', 'maxlat', 'maxlon'].map(name => [name, numeric(child, name)]));
      continue;
    }
    if (type === 'meta') timestamp = child.getAttribute('osm_base');
    if (type === 'remark') remark = child.textContent;
    if (type !== 'node' && type !== 'way' && type !== 'relation') continue;
    const tags: Record<string, string> = Object.create(null);
    const nodes: (number | undefined)[] = [];
    const inline: unknown[] = [];
    const members: RecordValue[] = [];
    for (const part of Array.from(child.children)) {
      if (part.localName === 'tag') {
        const key = part.getAttribute('k'),
          value = part.getAttribute('v');
        if (key !== null && value !== null) tags[key] = value;
      } else if (part.localName === 'nd') {
        nodes.push(numeric(part, 'ref'));
        inline.push(point(part));
      } else if (part.localName === 'member') {
        const geometry = Array.from(part.children)
          .filter(node => node.localName === 'nd')
          .map(point);
        members.push({ type: part.getAttribute('type'), role: part.getAttribute('role'), ref: numeric(part, 'ref'), geometry });
      }
    }
    elements.push({ type, id: numeric(child, 'id'), ...point(child), tags, nodes, geometry: inline, members });
  }
  return { elements, bounds, osm3s: { timestamp_osm_base: timestamp }, remark };
}

export function parseOsmFile(text: string): OsmFile {
  const input = text.trim();
  const raw = record(input.startsWith('<') ? parseXml(input) : JSON.parse(input));
  if (!raw || !Array.isArray(raw.elements)) throw new Error('Expected Overpass JSON or OpenStreetMap XML.');
  if (typeof raw.remark === 'string' && raw.remark) throw new Error(raw.remark);
  const source = raw.elements.map(record).filter((element): element is RecordValue => !!element);
  const nodes = new Map<number, Coordinate>();
  const ways = new Map<number, Geometry>();
  const point = (ref: unknown) => nodes.get(idOf(ref) ?? NaN) ?? null;
  const extent = { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity };
  const extend = (position: Coordinate) => {
    extent.south = Math.min(extent.south, position.lat);
    extent.west = Math.min(extent.west, position.lon);
    extent.north = Math.max(extent.north, position.lat);
    extent.east = Math.max(extent.east, position.lon);
  };
  for (const entry of source) {
    const id = idOf(entry.id);
    if (entry.type !== 'node' || id === undefined) continue;
    const coord = coordinateOf(entry);
    if (!coord) continue;
    nodes.set(id, coord);
    extend(coord);
  }
  for (const entry of source) {
    const id = idOf(entry.id);
    if (entry.type !== 'way' || id === undefined) continue;
    const inline = list(entry.geometry),
      refs = list(entry.nodes);
    const path = Array.from({ length: Math.max(inline.length, refs.length) }, (_, index) => coordinateOf(inline[index]) ?? point(refs[index]));
    if (!path.some(Boolean)) continue;
    for (const position of path) if (position) extend(position);
    ways.set(id, path);
  }
  const elements: OsmElement[] = [];
  for (const entry of source) {
    const { type } = entry;
    const id = idOf(entry.id);
    if (id === undefined || (type !== 'node' && type !== 'way' && type !== 'relation')) continue;
    const tags = Object.fromEntries(Object.entries(record(entry.tags) ?? {}).filter((item): item is [string, string] => typeof item[1] === 'string'));
    if (type !== 'relation' && !Object.keys(tags).length) continue;
    if (type === 'node') {
      const coord = nodes.get(id);
      if (coord) elements.push({ type, id, tags, ...coord });
    } else if (type === 'way') {
      const geometry = ways.get(id);
      if (geometry) elements.push({ type, id, tags, geometry });
    } else {
      if (!Object.keys(tags).length) continue;
      const members = list(entry.members).flatMap(value => {
        const member = record(value);
        if (member?.type !== 'way') return [];
        const inline = list(member.geometry).map(coordinateOf);
        const geometry = inline.length ? inline : ways.get(idOf(member.ref) ?? NaN);
        if (!geometry?.some(Boolean)) return [];
        // Full administrative boundaries can include distant geometry not covered by the extract.
        if (tags.boundary !== 'administrative') for (const position of geometry) if (position) extend(position);
        return [{ type: 'way', role: typeof member.role === 'string' ? member.role : '', geometry }];
      });
      if (members.length) elements.push({ type, id, tags, members });
    }
  }
  if (!elements.length) throw new Error('No OSM features with geometry were found. For Overpass JSON, use “out geom” or include the referenced nodes.');
  const bounds = boundsOf(raw.bounds) ?? extent;
  if (!Number.isFinite(bounds.south) || bounds.east - bounds.west > 180) throw new Error('Crop the file to one region without crossing 180° longitude.');
  const timestamp = record(raw.osm3s)?.timestamp_osm_base;
  return { bounds, osm: { elements, ...(typeof timestamp === 'string' ? { osm3s: { timestamp_osm_base: timestamp } } : {}) } };
}

export function osmFileQuery(square: OsmSquare, commune?: string, buildings?: boolean): string {
  // A manually launched query may wait longer than an interactive browser import.
  return overpassImportQuery(osmProjection(square).bbox, commune, buildings).replace(/\[timeout:\d+\]/, '[timeout:180]');
}

export function osmQueryScript(query: string): string {
  return `#!/bin/sh
set -eu

# Usage: sh download-osm.sh [Overpass interpreter URL]
# Then select the resulting openstreetmap.json in Magna Urbis.
payload=$(mktemp)
result=$(mktemp ./openstreetmap.XXXXXX)
trap 'rm -f "$payload" "$result"' EXIT
cat > "$payload" <<'OVERPASS'
${query}
OVERPASS
curl --fail --silent --show-error --max-time 240 --data-urlencode "data@$payload" --output "$result" "\${1:-${OVERPASS_ENDPOINTS[0]}}"
mv "$result" openstreetmap.json
`;
}
