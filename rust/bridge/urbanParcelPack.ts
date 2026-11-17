/** Decoder of the `magna-city-parcels` v1 pack (Rust `urban::parcel_pack`): whole
 * partitions as typed columns, coordinates f64 bit for bit, strings in tables.
 *
 * Blob (little endian): `u32 header_len | header JSON (space-padded so that
 * 4 + header_len is a multiple of 8) | sections`, each section named in
 * `header.sections` with its byte offset (from the end of the header), element
 * type and length, and starting on an 8-byte boundary.
 *
 * `materializePartitions` rebuilds plain `Partition[]` objects identical to the
 * engine's JSON (serde key order, absent optional keys, the same numbers), so
 * every consumer keeps reading `Partition` objects. */
import type { Partition, Parcel, Point, Shape, UrbanSourceHandle } from './urban';

export const PARCEL_PACK_FORMAT = 'magna-city-parcels';
export const PARCEL_PACK_VERSION = 1;

/** Sentinel of an absent index (`None`, null street, orphan id). */
const NONE = 0xffffffff;

/** Header names of the string tables (codes are u32 indices into them). */
const TABLE = {
  use: 'use', family: 'family', reason: 'reason', provenance: 'provenance', accessKind: 'accessKind', contactKind: 'contactKind',
  function: 'function', culture: 'culture', pack: 'pack', unit: 'unit', role: 'role', label: 'label', districtRole: 'districtRole',
  allocReason: 'allocReason', demand: 'demand', water: 'water', floorNeed: 'floorNeed',
} as const;

/** Section names, by group. */
const S = {
  parcels: 'parcels', block: 'parcels.block', use: 'parcels.use', rank: 'parcels.rank', pressure: 'parcels.pressure',
  axis: 'parcels.axis', front: 'parcels.front', hasFront: 'parcels.hasFront', family: 'parcels.family', reason: 'parcels.reason',
  provenanceStart: 'parcels.provenance.start', provenanceCodes: 'parcels.provenance.codes',
  accessPresent: 'parcels.access.present', accessKind: 'parcels.access.kind', accessStreet: 'parcels.access.street',
  accessFrontLength: 'parcels.access.frontLength', id: 'parcels.id',
  envelopes: 'envelopes',
  contactsStart: 'contacts.start', contactsAb: 'contacts.ab', contactsStreet: 'contacts.street', contactsRank: 'contacts.rank',
  contactsLength: 'contacts.length', contactsKind: 'contacts.kind',
  parentStart: 'parentIds.start', parentIds: 'parentIds',
  allocParcel: 'allocations.parcel', allocOrphan: 'allocations.orphan', allocDemand: 'allocations.demand',
  allocFunction: 'allocations.function', allocCulture: 'allocations.culture', allocPack: 'allocations.pack',
  allocUnit: 'allocations.unit', allocRole: 'allocations.role', allocLabel: 'allocations.label',
  allocDistrictRole: 'allocations.districtRole', allocLandmark: 'allocations.landmark', allocCapacity: 'allocations.capacity',
  allocScore: 'allocations.score', allocHouseholds: 'allocations.households', allocWealth: 'allocations.wealth',
  allocReasonsStart: 'allocations.reasons.start', allocReasonsCodes: 'allocations.reasons.codes',
  floorPresent: 'floorNeed.present', floorCodes: 'floorNeed.codes', floorValues: 'floorNeed.values',
  adjA: 'adjacency.a', adjB: 'adjacency.b', adjOrphan: 'adjacency.orphan', adjShared: 'adjacency.sharedLength',
  envBlock: 'environment.block', envPressure: 'environment.pressure', envSlope: 'environment.slope', envHeight: 'environment.height',
  envWaterHeight: 'environment.waterHeight', envWet: 'environment.wet', envWaterfront: 'environment.waterfront',
  envDistrict: 'environment.district', envWater: 'environment.water',
} as const;

export const PARCEL_PACK_GROUPS = ['core', 'envelope', 'contacts', 'lineage', 'allocations', 'floorNeed', 'adjacency', 'environment'] as const;
export type ParcelPackGroup = typeof PARCEL_PACK_GROUPS[number];
/** Groups that make whole parcels, and the programme columns. */
const PARCEL_GROUPS: ParcelPackGroup[] = ['core', 'envelope', 'contacts', 'lineage'];

const VIEWS = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array } as const;
type SectionType = keyof typeof VIEWS;
type View = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array;
export interface ParcelPackSection { offset: number; type: SectionType; length: number }
/** `[start, end)` in the pack's global columns. */
export type ParcelPackRange = [number, number] | { start: number; end: number };
export interface ParcelPackPartition {
  key: string; warnings: string[];
  parcels?: ParcelPackRange; allocations?: ParcelPackRange; adjacency?: ParcelPackRange; environment?: ParcelPackRange;
  config?: unknown; diagnostics?: unknown; enclosure?: unknown;
  /** `UrbanProgramme` without `allocations`, `adjacency`, `environment` (absent: no programme). */
  programme?: Record<string, unknown>;
}
export interface ParcelPackHeader {
  format: string; version: number;
  /** Reply envelope (native engine: `id`, `ms`, `urbanSource`; WASM: `partitionsId`). */
  id?: number; ms?: number; urbanSource?: UrbanSourceHandle; partitionsId?: number;
  groups: string[]; counts?: Record<string, number>;
  tables: Record<string, string[]>; partitions: ParcelPackPartition[]; sections: Record<string, ParcelPackSection>;
  [member: string]: unknown;
}
export interface ParcelPack {
  buffer: ArrayBuffer; header: ParcelPackHeader; groups: ReadonlySet<string>;
  /** Zero-copy views on `buffer`, by section name. */
  sections: Record<string, View>;
}

const headers = new WeakMap<ArrayBuffer, ParcelPackHeader>();
const memo = new WeakMap<ArrayBuffer, Partition[]>();
const registry = new WeakMap<Partition[], ArrayBuffer>();

/** The header JSON of a pack (envelope members `id`, `ms`, `urbanSource`, `partitionsId`…). */
export function packHeader(buf: ArrayBuffer): ParcelPackHeader {
  let header = headers.get(buf);
  if (header) return header;
  if (buf.byteLength < 4) throw new Error('Parcel pack truncated: no header length.');
  const length = new DataView(buf).getUint32(0, true);
  if (4 + length > buf.byteLength) throw new Error('Parcel pack truncated: header past the end.');
  header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, length))) as ParcelPackHeader;
  if (header?.format !== PARCEL_PACK_FORMAT || header.version !== PARCEL_PACK_VERSION) {
    throw new Error(`Unknown parcel pack format ${String(header?.format)} v${String(header?.version)}.`);
  }
  headers.set(buf, header);
  return header;
}

/** True when the pack holds every group: an exact image of its partitions. */
export function isWholeParcelPack(buf: ArrayBuffer): boolean {
  const groups = packHeader(buf).groups ?? [];
  return PARCEL_PACK_GROUPS.every(group => groups.includes(group));
}

/** True when `buf` starts like a parcel pack (a JSON reply starts with `{`). */
export function isParcelPack(buf: ArrayBuffer): boolean {
  try { packHeader(buf); return true; } catch { return false; }
}

/** Typed views on every section; throws on an unknown format or version, a
 * misaligned section (Float64Array needs 8 bytes) or a truncated one. */
export function decodeParcelPack(buf: ArrayBuffer): ParcelPack {
  const header = packHeader(buf);
  const body = 4 + new DataView(buf).getUint32(0, true);
  const sections: Record<string, View> = {};
  for (const [name, s] of Object.entries(header.sections ?? {})) {
    const View = VIEWS[s.type];
    if (!View) throw new Error(`Parcel pack section ${name}: unknown type ${s.type}.`);
    const start = body + s.offset, size = View.BYTES_PER_ELEMENT;
    if (start % size !== 0) throw new Error(`Parcel pack section ${name} is misaligned for ${s.type}.`);
    if (start + s.length * size > buf.byteLength) throw new Error(`Parcel pack section ${name} is truncated.`);
    sections[name] = new View(buf, start, s.length);
  }
  return { buffer: buf, header, groups: new Set(header.groups ?? []), sections };
}

const range = (r: ParcelPackRange | undefined): [number, number] | undefined =>
  r === undefined ? undefined : Array.isArray(r) ? r : [r.start, r.end];

/** Plain `Partition[]` with the engine's JSON keys, order and absent keys.
 * `base`: partitions to take the parcels (and missing programme columns) from
 * when the pack carries only some groups (built-capacity replies); matched by key. */
export function materializePartitions(pack: ParcelPack, base?: readonly Partition[]): Partition[] {
  const { header, sections, groups } = pack;
  const view = <T extends View>(name: string, type: SectionType): T => {
    const v = sections[name];
    if (!v || header.sections[name].type !== type) throw new Error(`Parcel pack section ${name} missing or not ${type}.`);
    return v as T;
  };
  const table = (name: string): string[] => {
    const t = header.tables?.[name];
    if (!t) throw new Error(`Parcel pack table ${name} missing.`);
    return t;
  };
  /** Strings section: one text decoded once, sliced by UTF-16 offsets. */
  const strings = (name: string): string[] => {
    const offsets = view<Uint32Array>(`${name}.offsets`, 'u32');
    const text = new TextDecoder().decode(view<Uint8Array>(`${name}.text`, 'u8'));
    const out = new Array<string>(Math.max(0, offsets.length - 1));
    for (let i = 0; i + 1 < offsets.length; i++) out[i] = text.slice(offsets[i], offsets[i + 1]);
    return out;
  };
  const has = (group: ParcelPackGroup): boolean => groups.has(group);
  const baseByKey = new Map<string, Partition>();
  for (const p of base ?? []) if (!baseByKey.has(p.key)) baseByKey.set(p.key, p);
  const baseOf = (key: string, what: string): Partition => {
    const p = baseByKey.get(key);
    if (!p) throw new Error(`Parcel pack lacks ${what} of partition ${key} and no base partition holds them.`);
    return p;
  };

  // With a base, parcels come from the pack only when it holds them whole; without
  // one, missing parcel groups decode empty (no envelope, contacts or parent ids),
  // as the Rust `unpack` does.
  const wholeParcels = has('core') && (!base || PARCEL_GROUPS.every(has));
  // Parcel ids by global index: the pack's ids (`core` is always written), else the base parcels in pack order.
  const ids: string[] = has('core') ? strings(S.id)
    : header.partitions.flatMap(p => (baseByKey.get(p.key)?.parcels ?? []).map(parcel => parcel.id ?? ''));

  const shapes = (layer: string) => {
    const polys = view<Uint32Array>(`${layer}.polys`, 'u32'), rings = view<Uint32Array>(`${layer}.rings`, 'u32');
    const coords = view<Float64Array>(`${layer}.coords`, 'f64');
    const ring = (r: number): Point[] => {
      const out: Point[] = [];
      for (let k = rings[r]; k < rings[r + 1]; k++) out.push({ x: coords[2 * k], y: coords[2 * k + 1] });
      return out;
    };
    return (i: number): Shape | undefined => {
      const a = polys[i], b = polys[i + 1];
      if (a === b) return undefined;
      const holes: Point[][] = [];
      for (let r = a + 1; r < b; r++) holes.push(ring(r));
      return { outer: ring(a), holes };
    };
  };

  let parcelAt: ((i: number) => Parcel) | undefined;
  if (wholeParcels) {
    const none = (): undefined => undefined, empty = new Uint32Array(ids.length + 1);
    const shape = shapes(S.parcels), envelope = has('envelope') ? shapes(S.envelopes) : none;
    const block = view<Uint32Array>(S.block, 'u32'), use = view<Uint32Array>(S.use, 'u32'), rank = view<Uint32Array>(S.rank, 'u32');
    const pressure = view<Float64Array>(S.pressure, 'f64'), axis = view<Float64Array>(S.axis, 'f64');
    const front = view<Float64Array>(S.front, 'f64'), hasFront = view<Uint8Array>(S.hasFront, 'u8');
    const family = view<Uint32Array>(S.family, 'u32'), reason = view<Uint32Array>(S.reason, 'u32');
    const provStart = view<Uint32Array>(S.provenanceStart, 'u32'), provCodes = view<Uint32Array>(S.provenanceCodes, 'u32');
    const accPresent = view<Uint8Array>(S.accessPresent, 'u8'), accKind = view<Uint32Array>(S.accessKind, 'u32');
    const accStreet = view<Uint32Array>(S.accessStreet, 'u32'), accFront = view<Float64Array>(S.accessFrontLength, 'f64');
    const contacts = has('contacts'), lineage = has('lineage');
    const cStart = contacts ? view<Uint32Array>(S.contactsStart, 'u32') : empty;
    const cAb = contacts ? view<Float64Array>(S.contactsAb, 'f64') : new Float64Array(0);
    const cStreet = contacts ? view<Uint32Array>(S.contactsStreet, 'u32') : empty, cRank = contacts ? view<Uint32Array>(S.contactsRank, 'u32') : empty;
    const cLength = contacts ? view<Float64Array>(S.contactsLength, 'f64') : new Float64Array(0);
    const cKind = contacts ? view<Uint32Array>(S.contactsKind, 'u32') : empty;
    const pStart = lineage ? view<Uint32Array>(S.parentStart, 'u32') : empty, parents = lineage ? strings(S.parentIds) : [];
    const tUse = table(TABLE.use), tFamily = table(TABLE.family), tReason = table(TABLE.reason), tProv = table(TABLE.provenance);
    const tAccess = table(TABLE.accessKind), tContact = table(TABLE.contactKind);
    parcelAt = (i: number): Parcel => {
      const parcel: Record<string, unknown> = { pressure: pressure[i] };
      const env = envelope(i);
      if (env) parcel.envelope = env;
      parcel.id = ids[i];
      parcel.parentIds = parents.slice(pStart[i], pStart[i + 1]);
      const provenance: string[] = [];
      for (let k = provStart[i]; k < provStart[i + 1]; k++) provenance.push(tProv[provCodes[k]]);
      parcel.provenance = provenance;
      parcel.family = tFamily[family[i]];
      parcel.reason = tReason[reason[i]];
      const list = [];
      for (let c = cStart[i]; c < cStart[i + 1]; c++) list.push({
        a: { x: cAb[4 * c], y: cAb[4 * c + 1] }, b: { x: cAb[4 * c + 2], y: cAb[4 * c + 3] },
        street: cStreet[c], rank: cRank[c], length: cLength[c], kind: tContact[cKind[c]],
      });
      parcel.contacts = list;
      parcel.shape = shape(i) ?? { outer: [], holes: [] };
      parcel.block = block[i];
      parcel.use = tUse[use[i]];
      parcel.front = hasFront[i] ? [{ x: front[4 * i], y: front[4 * i + 1] }, { x: front[4 * i + 2], y: front[4 * i + 3] }] : null;
      parcel.axis = { x: axis[2 * i], y: axis[2 * i + 1] };
      parcel.rank = rank[i];
      if (accPresent[i]) parcel.access = { kind: tAccess[accKind[i]], street: accStreet[i] === NONE ? null : accStreet[i], frontLength: accFront[i] };
      return parcel as unknown as Parcel;
    };
  }

  type Row = Record<string, unknown>;
  let allocationAt: ((j: number) => Row) | undefined;
  if (has('allocations')) {
    const floorNeed = has('floorNeed');
    const parcel = view<Uint32Array>(S.allocParcel, 'u32'), orphans = sections[`${S.allocOrphan}.offsets`] ? strings(S.allocOrphan) : [];
    let orphan = 0;
    const demand = view<Uint32Array>(S.allocDemand, 'u32'), fn = view<Uint32Array>(S.allocFunction, 'u32');
    const culture = view<Uint32Array>(S.allocCulture, 'u32'), packCode = view<Uint32Array>(S.allocPack, 'u32');
    const unit = view<Uint32Array>(S.allocUnit, 'u32'), role = view<Uint32Array>(S.allocRole, 'u32');
    const label = view<Uint32Array>(S.allocLabel, 'u32'), districtRole = view<Uint32Array>(S.allocDistrictRole, 'u32');
    const landmark = view<Uint8Array>(S.allocLandmark, 'u8'), capacity = view<Float64Array>(S.allocCapacity, 'f64');
    const score = view<Float64Array>(S.allocScore, 'f64'), households = view<Float64Array>(S.allocHouseholds, 'f64');
    const wealth = view<Float64Array>(S.allocWealth, 'f64');
    const residents = sections['allocations.residents'] ? view<Float64Array>('allocations.residents', 'f64') : undefined;
    const rStart = view<Uint32Array>(S.allocReasonsStart, 'u32'), rCodes = view<Uint32Array>(S.allocReasonsCodes, 'u32');
    const fPresent = floorNeed ? view<Uint8Array>(S.floorPresent, 'u8') : new Uint8Array(parcel.length);
    const fCodes = floorNeed ? view<Uint32Array>(S.floorCodes, 'u32') : new Uint32Array(0);
    const fValues = floorNeed ? view<Float64Array>(S.floorValues, 'f64') : new Float64Array(0);
    const tDemand = table(TABLE.demand), tFn = table(TABLE.function), tCulture = table(TABLE.culture), tPack = table(TABLE.pack);
    const tUnit = table(TABLE.unit), tRole = table(TABLE.role), tLabel = table(TABLE.label), tDistrict = table(TABLE.districtRole);
    const tReason = table(TABLE.allocReason), tFloor = floorNeed ? table(TABLE.floorNeed) : [];
    allocationAt = (j: number): Row => {
      const reasons: string[] = [];
      for (let k = rStart[j]; k < rStart[j + 1]; k++) reasons.push(tReason[rCodes[k]]);
      const row: Row = {
        parcelId: parcel[j] === NONE ? orphans[orphan++] : ids[parcel[j]], demandId: tDemand[demand[j]],
        function: tFn[fn[j]], culture: tCulture[culture[j]], architecturePack: tPack[packCode[j]], capacity: capacity[j],
        unit: tUnit[unit[j]], score: score[j], reasons, role: tRole[role[j]], label: tLabel[label[j]], landmark: landmark[j] !== 0,
        households: households[j],
      };
      if (residents && residents[j] >= 0) row.residents = residents[j];
      if (fPresent[j]) {
        const c = 7 * j, v = 7 * j;
        // Codes: version, unit, scope, basis, family, profile_provenance, calibration.
        // Values: requested_m2, allocated_households, floor_m2_per_household, wealth,
        // wealth_factor, effective_floor_m2_per_household, persons_per_household.
        row.housingFloorNeed = {
          version: tFloor[fCodes[c]], unit: tFloor[fCodes[c + 1]], scope: tFloor[fCodes[c + 2]],
          requested_m2: fValues[v], allocated_households: fValues[v + 1], basis: tFloor[fCodes[c + 3]],
          model: {
            family: tFloor[fCodes[c + 4]], profile_provenance: tFloor[fCodes[c + 5]], calibration: tFloor[fCodes[c + 6]],
            floor_m2_per_household: fValues[v + 2], wealth: fValues[v + 3], wealth_factor: fValues[v + 4],
            effective_floor_m2_per_household: fValues[v + 5], persons_per_household: fValues[v + 6],
          },
        };
      }
      row.districtRole = tDistrict[districtRole[j]];
      row.wealth = wealth[j];
      return row;
    };
  }

  let adjacencyAt: ((j: number) => Row) | undefined;
  if (has('adjacency')) {
    const a = view<Uint32Array>(S.adjA, 'u32'), b = view<Uint32Array>(S.adjB, 'u32');
    const shared = view<Float64Array>(S.adjShared, 'f64'), orphans = sections[`${S.adjOrphan}.offsets`] ? strings(S.adjOrphan) : [];
    let orphan = 0;
    // Orphans are listed in reading order: `a` then `b` of each entry.
    adjacencyAt = (j: number): Row => {
      const ia = a[j] === NONE ? orphans[orphan++] : ids[a[j]];
      const ib = b[j] === NONE ? orphans[orphan++] : ids[b[j]];
      return { a: ia, b: ib, sharedLength: shared[j] };
    };
  }

  let environmentAt: ((j: number) => Row) | undefined;
  if (has('environment')) {
    const block = view<Uint32Array>(S.envBlock, 'u32'), pressure = view<Float64Array>(S.envPressure, 'f64');
    const slope = view<Float64Array>(S.envSlope, 'f64'), height = view<Float64Array>(S.envHeight, 'f64');
    const waterHeight = view<Float64Array>(S.envWaterHeight, 'f64'), wet = view<Uint8Array>(S.envWet, 'u8');
    const waterfront = view<Uint8Array>(S.envWaterfront, 'u8'), district = view<Uint32Array>(S.envDistrict, 'u32');
    const water = view<Uint32Array>(S.envWater, 'u32'), tWater = table(TABLE.water);
    environmentAt = (j: number): Row => {
      const row: Row = { pressure: pressure[j], block: block[j], slope: slope[j], wet: wet[j] !== 0, waterfront: waterfront[j] !== 0, height: height[j] };
      if (district[j] !== NONE) row.district = district[j];
      const w = tWater[water[j]];
      if (w) row.water = w;
      row.waterHeight = waterHeight[j];
      return row;
    };
  }

  const rows = (at: ((j: number) => Row) | undefined, r: ParcelPackRange | undefined, key: string, name: 'allocations' | 'adjacency' | 'environment'): unknown[] => {
    const span = range(r);
    if (at) { const out = []; if (span) for (let j = span[0]; j < span[1]; j++) out.push(at(j)); return out; }
    // Group left out: the base's records, else none (as the Rust `unpack`).
    return (baseByKey.get(key)?.programme as unknown as Record<string, unknown[]> | undefined)?.[name] ?? [];
  };
  /** Serde field order of `UrbanProgramme`; any further shell member follows. */
  const PROGRAMME = ['version', 'population', 'context', 'cultures', 'demands', 'reservations', 'allocations', 'adjacency', 'environment',
    'reconciliationPasses', 'warnings', 'housingCapacity', 'navigableFrontage'];
  const COLUMNS: Record<string, (key: string, p: ParcelPackPartition) => unknown> = {
    allocations: (key, p) => rows(allocationAt, p.allocations, key, 'allocations'),
    adjacency: (key, p) => rows(adjacencyAt, p.adjacency, key, 'adjacency'),
    environment: (key, p) => rows(environmentAt, p.environment, key, 'environment'),
  };

  return header.partitions.map(p => {
    const out: Record<string, unknown> = {};
    if (p.config !== undefined) out.config = p.config;
    if (p.programme) {
      const shell = p.programme, programme: Record<string, unknown> = {};
      for (const name of PROGRAMME) {
        if (COLUMNS[name]) programme[name] = COLUMNS[name](p.key, p);
        else if (name in shell) programme[name] = shell[name];
      }
      for (const name of Object.keys(shell)) if (!(name in programme)) programme[name] = shell[name];
      out.programme = programme;
    }
    out.key = p.key;
    if (parcelAt) {
      const span = range(p.parcels) ?? [0, 0], parcels: Parcel[] = [];
      for (let i = span[0]; i < span[1]; i++) parcels.push(parcelAt(i));
      out.parcels = parcels;
    } else out.parcels = base ? baseOf(p.key, 'the parcels').parcels : [];
    out.warnings = p.warnings;
    if (p.diagnostics !== undefined) out.diagnostics = p.diagnostics;
    if (p.enclosure !== undefined) out.enclosure = p.enclosure;
    return out as unknown as Partition;
  });
}

/** Partitions of a pack, materialised once per buffer: the same buffer always
 * gives the same array (identity checks downstream). Registered in `packOf`
 * when the pack holds whole partitions. */
export function partitionsFromPack(buf: ArrayBuffer, base?: readonly Partition[]): Partition[] {
  let partitions = memo.get(buf);
  if (partitions) return partitions;
  const pack = decodeParcelPack(buf);
  partitions = materializePartitions(pack, base);
  memo.set(buf, partitions);
  if (isWholeParcelPack(buf)) registry.set(partitions, buf);
  return partitions;
}

/** The pack these partitions were materialised from (digests, caches, postMessage). */
export function packOf(partitions: readonly Partition[]): ArrayBuffer | undefined {
  return registry.get(partitions as Partition[]);
}
/** Record that `partitions` are exactly the content of `buf` (and memoise them). */
export function registerPack(partitions: Partition[], buf: ArrayBuffer): void {
  registry.set(partitions, buf);
  memo.set(buf, partitions);
}

/** Partitions of an engine response: the objects it carries, else its pack's. */
export function responsePartitions(response: { partitions?: Partition[]; partitionsPack?: ArrayBuffer }, base?: readonly Partition[]): Partition[] | undefined {
  return response.partitions ?? (response.partitionsPack && partitionsFromPack(response.partitionsPack, base));
}

/** Bytes of a reply as a standalone ArrayBuffer (wasm-bindgen returns a Uint8Array). */
export function packBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer : bytes.slice().buffer as ArrayBuffer;
}
