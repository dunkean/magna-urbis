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
    format: string;
    version: number;
    origin: { x: number; y: number };
    layouts: { key: string; blockBase: number }[];
    tables: Record<string, string[]>;
    parcelIds: string[] | null;
    sections: Record<string, Section>;
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
    origin: header.origin,
    layouts: header.layouts,
    tables: header.tables,
    parcelIds: header.parcelIds ?? undefined,
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

/** Display projection of the native building sites (`site_display_buffers` in display.rs): what the city
 * volumes draw, with world coordinates restored. The complete requests stay in the engine (read by id). */
export interface CitySiteVisual {
  id: string;
  parcel_id: string;
  offset: number;
  function: string;
  culture: { culture: string; pack: string; mode: string; borrowing: string | null };
  programme?: Record<string, unknown>;
  surface: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][] }[];
  preview: boolean;
  ground_z_m: number;
  entrance: { x: number; y: number };
  access_id: string;
}
/** Site count above which the decoded version-1 programmes drop their housing-need evidence (towns of several hundred
 * thousand people); version 2 never carries it. */
const LARGE_SITE_SET = 50000;
/** Sites per programme parse of a version-2 buffer: strings of about a megabyte. */
const PROGRAMME_RUN = 1024;
/** The buffer each decoded site array came from: worker/page hops transfer it instead of cloning the objects (v2/urbanPack.ts). */
const siteVisualPacks = new WeakMap<object, ArrayBuffer>();
export const siteVisualsPackOf = (sites: object): ArrayBuffer | undefined => siteVisualPacks.get(sites);
export function decodeCitySiteVisuals(buffer: ArrayBuffer): CitySiteVisual[] {
  const sites = decodeSiteVisuals(buffer);
  siteVisualPacks.set(sites, buffer);
  return sites;
}
/** Only the sites at `indices` (ascending), each as the full decode makes it: a build worker that draws a share of a
 * town decodes that share, not the whole town (cityBuildingsParallel.ts). */
export function decodeCitySiteVisualsAt(buffer: ArrayBuffer, indices: ArrayLike<number>): CitySiteVisual[] {
  return decodeSiteVisuals(buffer, indices);
}
function decodeSiteVisuals(buffer: ArrayBuffer, only?: ArrayLike<number>): CitySiteVisual[] {
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength))) as { format: string; version: number; origin: { x: number; y: number }; count: number; tables: Record<string, string[]>; sections: Record<string, Section> };
  if (header.format !== 'magna-city-sites' || (header.version !== 1 && header.version !== 2)) throw new Error('Unknown city site display buffers.');
  const body = 4 + headLength;
  const view = <K extends keyof typeof VIEWS>(name: string, type: K): InstanceType<(typeof VIEWS)[K]> => {
    const s = header.sections[name];
    if (!s || s.type !== type) throw new Error(`Section ${name} missing or mistyped.`);
    return new VIEWS[type](buffer, body + s.offset, s.length) as InstanceType<(typeof VIEWS)[K]>;
  };
  const strings = (name: string): string[] => {
    const offsets = view(`${name}.offsets`, 'u32'),
      text = new TextDecoder().decode(view(`${name}.text`, 'u8')),
      out: string[] = [];
    for (let i = 0; i + 1 < offsets.length; i++) out.push(text.slice(offsets[i], offsets[i + 1]));
    return out;
  };
  const { x: ox, y: oy } = header.origin,
    n = header.count;
  const polys = view('sites.polys', 'u32'),
    pieces = view('sites.pieces', 'u32'),
    rings = view('sites.rings', 'u32'),
    coords = view('sites.coords', 'f32');
  const fn = view('sites.function', 'u16'),
    culture = view('sites.culture', 'u16'),
    preview = view('sites.preview', 'u8');
  const ground = view('sites.groundZ', 'f32'),
    entrance = view('sites.entrance', 'f32');
  const ids = strings('sites.id'),
    parcels = strings('sites.parcelId'),
    accesses = strings('sites.accessId');
  // Version 1: one JSON array for the town. Version 2: `record,` per site (n+1 byte offsets), parsed by runs of sites
  // so that a large town never builds its whole programme text as one string.
  let programmes: (Record<string, unknown> | null)[] = [];
  // A selection parses its own `record,` texts only (version 2).
  let programmeAt: ((i: number) => Record<string, unknown> | null) | undefined;
  if (n && only && header.version !== 1) {
    const offsets = view('sites.programme.offsets', 'u32'),
      text = view('sites.programme.text', 'u8'),
      decoder = new TextDecoder();
    if (offsets.length !== n + 1) throw new Error('Section sites.programme.offsets mistyped.');
    programmeAt = i => JSON.parse(decoder.decode(text.subarray(offsets[i], offsets[i + 1] - 1))) as Record<string, unknown> | null;
  } else if (n && header.version === 1) programmes = JSON.parse(new TextDecoder().decode(view('sites.programme', 'u8'))) as (Record<string, unknown> | null)[];
  else if (n) {
    const offsets = view('sites.programme.offsets', 'u32'),
      text = view('sites.programme.text', 'u8'),
      decoder = new TextDecoder();
    if (offsets.length !== n + 1) throw new Error('Section sites.programme.offsets mistyped.');
    for (let i = 0; i < n; i += PROGRAMME_RUN) {
      const run = decoder.decode(text.subarray(offsets[i], offsets[Math.min(n, i + PROGRAMME_RUN)]));
      for (const programme of JSON.parse(`[${run.slice(0, -1)}]`) as (Record<string, unknown> | null)[]) programmes.push(programme);
    }
  }
  const functions = header.tables.function ?? [''],
    cultures = (header.tables.culture ?? ['']).map(text => (text ? (JSON.parse(text) as CitySiteVisual['culture']) : null));
  const ring = (r: number) => {
    const out: { x: number; y: number }[] = [];
    for (let k = rings[r]; k < rings[r + 1]; k++) out.push({ x: coords[2 * k] + ox, y: coords[2 * k + 1] + oy });
    return out;
  };
  const sites: CitySiteVisual[] = [];
  for (let k = 0, count = only ? only.length : n; k < count; k++) {
    const i = only ? only[k] : k;
    const surface: CitySiteVisual['surface'] = [];
    for (let piece = polys[i]; piece < polys[i + 1]; piece++) {
      const outer = ring(pieces[piece]),
        holes: { x: number; y: number }[][] = [];
      for (let r = pieces[piece] + 1; r < pieces[piece + 1]; r++) holes.push(ring(r));
      surface.push({ outer, holes });
    }
    const programme = programmeAt ? programmeAt(i) : programmes[i];
    // Very large towns: the housing-need evidence (about a third of each programme) is dropped; no map or 3D view reads it.
    if (programme && n > LARGE_SITE_SET) programme.housing_floor_need = undefined;
    sites.push({
      id: ids[i],
      parcel_id: parcels[i],
      offset: i,
      function: functions[fn[i]],
      culture: cultures[culture[i]]!,
      ...(programme ? { programme } : {}),
      surface,
      preview: preview[i] === 1,
      ground_z_m: ground[i],
      entrance: { x: entrance[2 * i] + ox, y: entrance[2 * i + 1] + oy },
      access_id: accesses[i],
    });
  }
  return sites;
}
