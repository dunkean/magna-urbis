import { PARCEL_PACK_GROUPS } from '../../../rust/bridge/urbanParcelPack';

/* eslint-disable @typescript-eslint/no-explicit-any */
// A minimal TypeScript writer of the `magna-city-parcels` v1 layout (Rust
// `urban::parcel_pack` documents it), used by tests only.
const MAX = 0xffffffff;
export function writeParcelPack(partitions: any[], envelope: Record<string, unknown> = {}, groups: readonly string[] = PARCEL_PACK_GROUPS): ArrayBuffer {
  const tables: Record<string, string[]> = {};
  const codes: Record<string, Map<string, number>> = {};
  for (const name of ['use', 'family', 'reason', 'provenance', 'accessKind', 'contactKind', 'demand', 'function', 'culture', 'pack', 'unit',
    'role', 'label', 'districtRole', 'allocReason', 'water', 'floorNeed']) { tables[name] = ['']; codes[name] = new Map([['', 0]]); }
  const code = (table: string, s: string): number => {
    let c = codes[table].get(s);
    if (c === undefined) { c = tables[table].length; tables[table].push(s); codes[table].set(s, c); }
    return c;
  };
  const cols = new Map<string, { type: 'u8' | 'u32' | 'f64'; values: number[] }>();
  const col = (name: string, type: 'u8' | 'u32' | 'f64') => {
    let c = cols.get(name); if (!c) cols.set(name, c = { type, values: [] }); return c.values;
  };
  const strings = new Map<string, string[]>();
  const str = (name: string) => { let s = strings.get(name); if (!s) strings.set(name, s = []); return s; };
  const polygons = (layer: string, shape: any) => {
    const polys = col(`${layer}.polys`, 'u32'), rings = col(`${layer}.rings`, 'u32'), coords = col(`${layer}.coords`, 'f64');
    if (!polys.length) { polys.push(0); rings.push(0); }
    for (const ring of shape ? [shape.outer, ...shape.holes] : []) {
      for (const p of ring) coords.push(p.x, p.y);
      rings.push(coords.length / 2);
    }
    polys.push(rings.length - 1);
  };
  // Every section exists even when empty (start tables hold their leading 0).
  for (const [type, names] of [
    ['u32', 'parcels.polys parcels.rings envelopes.polys envelopes.rings parcels.block parcels.rank parcels.use parcels.family parcels.reason parcels.provenance.start parcels.provenance.codes parcels.access.kind parcels.access.street contacts.start contacts.street contacts.rank contacts.kind parentIds.start allocations.parcel allocations.demand allocations.function allocations.culture allocations.pack allocations.unit allocations.role allocations.label allocations.districtRole allocations.reasons.start allocations.reasons.codes floorNeed.codes adjacency.a adjacency.b environment.block environment.district environment.water'],
    ['f64', 'parcels.coords envelopes.coords parcels.pressure parcels.axis parcels.front parcels.access.frontLength contacts.ab contacts.length allocations.capacity allocations.score allocations.households allocations.wealth floorNeed.values adjacency.sharedLength environment.pressure environment.slope environment.height environment.waterHeight'],
    ['u8', 'parcels.hasFront parcels.access.present allocations.landmark floorNeed.present environment.wet environment.waterfront'],
  ] as const) for (const name of names.split(' ')) col(name, type);
  for (const name of ['parcels.polys', 'parcels.rings', 'envelopes.polys', 'envelopes.rings', 'parcels.provenance.start', 'contacts.start', 'parentIds.start', 'allocations.reasons.start'])
    col(name, 'u32').push(0);
  for (const name of ['parcels.id', 'parentIds', 'allocations.orphan', 'adjacency.orphan']) str(name);
  const shells: any[] = [];
  let parcelBase = 0;
  const starts = (name: string) => { const s = col(name, 'u32'); if (!s.length) s.push(0); return s; };
  const counts = { partitions: partitions.length, parcels: 0, allocations: 0, adjacency: 0, environment: 0 };
  for (const p of partitions) {
    const ids = new Map<string, number>();
    const first = parcelBase;
    for (const parcel of p.parcels) {
      if (!ids.has(parcel.id)) ids.set(parcel.id, parcelBase);
      polygons('parcels', parcel.shape); polygons('envelopes', parcel.envelope);
      col('parcels.block', 'u32').push(parcel.block); col('parcels.rank', 'u32').push(parcel.rank);
      col('parcels.use', 'u32').push(code('use', parcel.use)); col('parcels.family', 'u32').push(code('family', parcel.family));
      col('parcels.reason', 'u32').push(code('reason', parcel.reason));
      col('parcels.pressure', 'f64').push(parcel.pressure); col('parcels.axis', 'f64').push(parcel.axis.x, parcel.axis.y);
      col('parcels.front', 'f64').push(...(parcel.front ? [parcel.front[0].x, parcel.front[0].y, parcel.front[1].x, parcel.front[1].y] : [0, 0, 0, 0]));
      col('parcels.hasFront', 'u8').push(parcel.front ? 1 : 0);
      const prov = starts('parcels.provenance.start');
      for (const s of parcel.provenance) col('parcels.provenance.codes', 'u32').push(code('provenance', s));
      prov.push(col('parcels.provenance.codes', 'u32').length);
      col('parcels.access.present', 'u8').push(parcel.access ? 1 : 0);
      col('parcels.access.kind', 'u32').push(parcel.access ? code('accessKind', parcel.access.kind) : 0);
      col('parcels.access.street', 'u32').push(parcel.access?.street ?? MAX);
      col('parcels.access.frontLength', 'f64').push(parcel.access?.frontLength ?? 0);
      str('parcels.id').push(parcel.id);
      const cs = starts('contacts.start');
      for (const c of parcel.contacts) {
        col('contacts.ab', 'f64').push(c.a.x, c.a.y, c.b.x, c.b.y); col('contacts.street', 'u32').push(c.street);
        col('contacts.rank', 'u32').push(c.rank); col('contacts.length', 'f64').push(c.length); col('contacts.kind', 'u32').push(code('contactKind', c.kind));
      }
      cs.push(col('contacts.street', 'u32').length);
      const ps = starts('parentIds.start'); str('parentIds').push(...parcel.parentIds); ps.push(str('parentIds').length);
      parcelBase++;
    }
    const shell: any = { key: p.key, warnings: p.warnings, parcels: [first, parcelBase] };
    for (const name of ['config', 'diagnostics', 'enclosure']) if (name in p) shell[name] = p[name];
    const pr = p.programme;
    const range = (name: string) => [counts[name as 'allocations'], counts[name as 'allocations'] += pr ? pr[name].length : 0];
    shell.allocations = range('allocations'); shell.adjacency = range('adjacency'); shell.environment = range('environment');
    if (pr) {
      const { allocations, adjacency, environment, ...rest } = pr;
      shell.programme = rest;
      const index = (id: string, orphans: string) => { const i = ids.get(id); if (i === undefined) str(orphans).push(id); return i ?? MAX; };
      for (const a of allocations) {
        col('allocations.parcel', 'u32').push(index(a.parcelId, 'allocations.orphan'));
        col('allocations.demand', 'u32').push(code('demand', a.demandId));
        for (const [section, table, field] of [['function', 'function', 'function'], ['culture', 'culture', 'culture'], ['pack', 'pack', 'architecturePack'],
          ['unit', 'unit', 'unit'], ['role', 'role', 'role'], ['label', 'label', 'label'], ['districtRole', 'districtRole', 'districtRole']])
          col(`allocations.${section}`, 'u32').push(code(table, a[field]));
        col('allocations.landmark', 'u8').push(a.landmark ? 1 : 0);
        for (const f of ['capacity', 'score', 'households', 'wealth']) col(`allocations.${f}`, 'f64').push(a[f]);
        col('allocations.residents', 'f64').push(a.residents ?? -1);
        const rs = starts('allocations.reasons.start');
        for (const r of a.reasons) col('allocations.reasons.codes', 'u32').push(code('allocReason', r));
        rs.push(col('allocations.reasons.codes', 'u32').length);
        const f = a.housingFloorNeed;
        col('floorNeed.present', 'u8').push(f ? 1 : 0);
        col('floorNeed.codes', 'u32').push(...(f ? [f.version, f.unit, f.scope, f.basis, f.model.family, f.model.profile_provenance, f.model.calibration].map(s => code('floorNeed', s)) : [0, 0, 0, 0, 0, 0, 0]));
        col('floorNeed.values', 'f64').push(...(f ? [f.requested_m2, f.allocated_households, f.model.floor_m2_per_household, f.model.wealth, f.model.wealth_factor,
          f.model.effective_floor_m2_per_household, f.model.persons_per_household] : [0, 0, 0, 0, 0, 0, 0]));
      }
      for (const j of adjacency) {
        col('adjacency.a', 'u32').push(index(j.a, 'adjacency.orphan')); col('adjacency.b', 'u32').push(index(j.b, 'adjacency.orphan'));
        col('adjacency.sharedLength', 'f64').push(j.sharedLength);
      }
      for (const e of environment) {
        col('environment.block', 'u32').push(e.block); col('environment.district', 'u32').push(e.district ?? MAX);
        for (const f of ['pressure', 'slope', 'height', 'waterHeight']) col(`environment.${f}`, 'f64').push(e[f]);
        col('environment.wet', 'u8').push(e.wet ? 1 : 0); col('environment.waterfront', 'u8').push(e.waterfront ? 1 : 0);
        col('environment.water', 'u32').push(code('water', e.water ?? ''));
      }
    }
    shells.push(shell);
  }
  counts.parcels = parcelBase;
  for (const [name, list] of strings) {
    const offsets = col(`${name}.offsets`, 'u32'); offsets.push(0);
    let text = ''; for (const s of list) { text += s; offsets.push(text.length); }
    col(`${name}.text`, 'u8').push(...new TextEncoder().encode(text));
  }
  const groupOf = (name: string): string => name.startsWith('parcels.') ? 'core' : name.startsWith('envelopes.') ? 'envelope'
    : name.startsWith('parentIds') ? 'lineage' : name.split('.')[0];
  const chosen = [...cols].filter(([name]) => groups.includes(groupOf(name)));
  const size = { u8: 1, u32: 4, f64: 8 } as const;
  const sections: Record<string, { offset: number; type: string; length: number }> = {};
  let offset = 0;
  for (const [name, c] of chosen) { sections[name] = { offset, type: c.type, length: c.values.length }; offset += Math.ceil(c.values.length * size[c.type] / 8) * 8; }
  let head = new TextEncoder().encode(JSON.stringify({ format: 'magna-city-parcels', version: 1, ...envelope, groups, counts, tables, partitions: shells, sections }));
  const padded = new Uint8Array(head.length + (8 - (4 + head.length) % 8) % 8).fill(32); padded.set(head); head = padded;
  const out = new ArrayBuffer(4 + head.length + offset), bytes = new Uint8Array(out);
  new DataView(out).setUint32(0, head.length, true); bytes.set(head, 4);
  for (const [name, c] of chosen) {
    const at = 4 + head.length + sections[name].offset;
    const View = { u8: Uint8Array, u32: Uint32Array, f64: Float64Array }[c.type];
    new View(out, at, c.values.length).set(c.values);
  }
  return out;
}
