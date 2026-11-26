import { deflateSync, inflateSync } from 'fflate';
import { ROAD_CLASSES, type ExitCounts } from '../../../rust/bridge/settlements';
import type { V2Settings } from './contracts';
import type { RoadOverrides } from './roadOverrides';
import { MAX_REGIONAL_EXITS, REGIONAL_EXIT_CLASSES } from './regionalExits';

interface Extras {
  names?: Pick<NonNullable<V2Settings['naming']>, 'title' | 'places' | 'labels' | 'features' | 'variations'>;
  places?: [string, string][];
  pins?: [number, string][];
  roads?: RoadOverrides;
  exits?: Partial<ExitCounts> | null;
}

export function cityCodeExtras(settings: V2Settings, namedPlaces: NonNullable<Extras['places']>): Extras | undefined {
  const { title, places, labels, features, variations } = settings.naming ?? {};
  const editedLabels = Object.entries(labels ?? {}).filter(([id, edit]) => edit.text !== undefined || (id.startsWith('free:') && edit.anchor));
  const names: Extras['names'] = {};
  if (title !== undefined) names.title = title;
  if (Object.keys(places ?? {}).length) names.places = places;
  if (editedLabels.length) names.labels = Object.fromEntries(editedLabels);
  if (Object.keys(features ?? {}).length) names.features = features;
  if (Object.keys(variations ?? {}).length) names.variations = variations;

  const extras: Extras = {};
  if (Object.keys(names).length) extras.names = names;
  if (namedPlaces.length) extras.places = namedPlaces;
  const pins = (settings.pins ?? []).flatMap((pin, i) => (pin.text !== undefined ? [[i, pin.text] as [number, string]] : []));
  if (pins.length) extras.pins = pins;

  const { routes, towns, exits, fromDisabled } = settings.roadOverrides ?? {};
  if (Object.keys(routes ?? {}).length || Object.values(towns ?? {}).some(edits => edits.length) || Object.keys(exits ?? {}).length || fromDisabled) {
    extras.roads = settings.roadOverrides;
    const roads = settings.region?.roads;
    if (roads === null) extras.exits = null;
    else if (roads?.exits && Object.keys(roads.exits).length) extras.exits = roads.exits;
  }
  return Object.keys(extras).length ? extras : undefined;
}

export function applyCityCodeExtras(settings: V2Settings, extras: Extras): void {
  if (extras.names) settings.naming = { ...settings.naming, ...extras.names };
  for (const [key, name] of extras.places ?? []) {
    const place = settings.region?.customPlaces?.find(p => p.key === key);
    if (!place) throw new Error('Unknown named place');
    place.name = name;
  }
  for (const [index, text] of extras.pins ?? []) {
    const pin = settings.pins?.[index];
    if (!pin || pin.text !== undefined) throw new Error('Invalid pin text index');
    pin.text = text;
  }
  if (extras.roads) settings.roadOverrides = extras.roads;
  if (extras.exits !== undefined) {
    const region = (settings.region ??= {});
    region.roads = extras.exits === null ? null : { ...region.roads, exits: extras.exits };
  }
}

// Geometry identities and junctions use exact coordinates. Compress their JSON without rounding road points.
const MAX_BYTES = 4 * 1024 * 1024;
export const SHARE_CODE_TOO_LARGE = 'These edits are too large for a share code. Export the project to share them.';
const utf8 = new TextEncoder();
export function writeExtras(extras: Extras): string {
  const raw = utf8.encode(JSON.stringify(extras));
  if (raw.length > MAX_BYTES) throw new Error(SHARE_CODE_TOO_LARGE);
  const compressed = deflateSync(raw);
  const useCompressed = compressed.length + 3 < raw.length;
  let text = useCompressed ? String.fromCharCode(raw.length >>> 16, (raw.length >>> 8) & 255, raw.length & 255) : '';
  const bytes = useCompressed ? compressed : raw;
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return (useCompressed ? 'z' : 'r') + btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown) => typeof v === 'string';
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const boolean = (v: unknown) => typeof v === 'boolean';
const optional = (v: unknown, check: (value: unknown) => boolean) => v === undefined || check(v);
const nullable = (v: unknown, check: (value: unknown) => boolean) => v === null || check(v);
const list = (v: unknown, check: (value: unknown) => boolean) => Array.isArray(v) && v.every(check);
const dict = (v: unknown, check: (value: unknown) => boolean) => record(v) && Object.entries(v).every(([key, value]) => key !== '__proto__' && check(value));
const point = (v: unknown) => record(v) && finite(v.x) && finite(v.y);
const path = (v: unknown) => list(v, point);
const roadClass = (v: unknown) => (ROAD_CLASSES as readonly unknown[]).includes(v);
const pair = (v: unknown, a: (value: unknown) => boolean, b: (value: unknown) => boolean) => Array.isArray(v) && v.length === 2 && a(v[0]) && b(v[1]);
const street = (v: unknown) => record(v) && path(v.path) && list(v.widths, finite) && natural(v.rank) && string(v.role);
const roadPart = (v: unknown) => record(v) && street(v.street) && string(v.part) && optional(v.editorId, string) && optional(v.controls, path) && optional(v.controlIndices, indices => list(indices, natural)) && optional(v.routingVariant, natural);
const roadPiece = (v: unknown) =>
  record(v) &&
  path(v.path) &&
  finite(v.width) &&
  roadClass(v.cls) &&
  optional(v.controls, path) &&
  optional(v.routingVariant, natural) &&
  optional(v.sites, sites =>
    pair(
      sites,
      site => nullable(site, string),
      site => nullable(site, string),
    ),
  );
const streetEdit = (v: unknown) => record(v) && string(v.id) && string(v.layout) && nullable(v.original, street) && list(v.parts, roadPart);
const report = (v: unknown) => record(v) && roadClass(v.requested) && nullable(v.class, roadClass) && nullable(v.gateway, string) && nullable(v.point, point) && nullable(v.reason, string) && optional(v.connected, boolean);
const exitEdit = (v: unknown) => record(v) && boolean(v.present) && report(v.report);
const roadEdits = (v: unknown) =>
  record(v) && optional(v.routes, routes => dict(routes, pieces => list(pieces, roadPiece))) && optional(v.towns, towns => dict(towns, edits => list(edits, streetEdit))) && optional(v.exits, exits => dict(exits, exitEdit)) && optional(v.fromDisabled, boolean);
const exitCounts = (v: unknown) => record(v) && Object.entries(v).every(([key, count]) => (REGIONAL_EXIT_CLASSES as readonly string[]).includes(key) && natural(count) && count <= MAX_REGIONAL_EXITS);

export function readExtras(code: string): Extras {
  const mode = code[0];
  if (code.length > Math.ceil((MAX_BYTES * 4) / 3) + 1 || (mode !== 'r' && mode !== 'z')) throw new Error('Invalid share code payload');
  let bytes = Uint8Array.from(atob(code.slice(1).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (mode === 'z') {
    const length = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
    if (bytes.length < 4 || length > MAX_BYTES) throw new Error('Invalid compressed share code');
    bytes = inflateSync(bytes.subarray(3), { out: new Uint8Array(length + 1) });
    if (bytes.length !== length) throw new Error('Invalid inflated length');
  }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !record(value) ||
    !optional(value.names, record) ||
    !optional(value.places, v => list(v, p => pair(p, string, string))) ||
    !optional(value.pins, v => list(v, p => pair(p, natural, string))) ||
    !optional(value.roads, roadEdits) ||
    !optional(value.exits, v => nullable(v, exitCounts))
  )
    throw new Error('Invalid share code payload');
  return value as Extras;
}
