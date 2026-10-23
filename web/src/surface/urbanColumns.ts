import type { Surface } from '../../../rust/bridge/housesContract';

export interface UrbanPacket extends Record<string, any> { buildings: Array<Record<string, any>>; occupationBuildings?: Array<Record<string, any>>; roads?: Array<Record<string, any>> }
/** Geometry is exact float64; prefix offsets describe every hierarchy without
 * flattening away surface shapes, holes, level supports or accepted occupation. */
export interface UrbanColumns extends Record<string, any> {
  format: 'magna-urban-columns'; version: 1;
  buildings: Array<Record<string, any>>; occupationBuildings: Array<Record<string, any>>; roads: Array<Record<string, any>>;
  buildingTriangleOffsets: Uint32Array; positions: Float64Array; normals: Float64Array;
  triangleSlots: Uint32Array; materialSlotsTable: Array<Record<string, string>>;
  triangleMaterial: Int32Array; triangleMaterialPresence: Uint8Array; materialIds: string[]; triangleSurface: Uint8Array;
  surfaceShapeOffsets: Uint32Array; shapeRingOffsets: Uint32Array; ringPointOffsets: Uint32Array; surfacePositions: Float64Array;
  roadPointOffsets: Uint32Array; roadPositions: Float64Array;
}
const SURFACE_KEYS = new Set(['footprint', 'roofFootprint', 'floor', 'surface']);
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const safe = (key: string) => !['__proto__', 'constructor', 'prototype'].includes(key);
function bad(reason: string): never { throw new Error(`Invalid urban columns: ${reason}`); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function offsets(values: unknown, end: number, label: string): asserts values is Uint32Array {
  if (!(values instanceof Uint32Array) || !values.length || values[0] !== 0 || values[values.length - 1] !== end) bad(label);
  for (let i = 1; i < values.length; i++) if (values[i] < values[i - 1]) bad(label);
}

export function packUrbanColumns(packet: UrbanPacket): UrbanColumns {
  if (packet.format === 'magna-urban-columns') { validateUrbanColumns(packet); return structuredClone(packet); }
  const positions: number[] = [], normals: number[] = [], triangleSlots: number[] = [], triangleMaterial: number[] = [], triangleSurface: number[] = [];
  const triangleMaterialPresence: number[] = [];
  const buildingTriangleOffsets = [0], materialSlotsTable: Array<Record<string, string>> = [], materialIds: string[] = [];
  const slots = new Map<string, number>(), ids = new Map<string, number>();
  const surfaceShapeOffsets = [0], shapeRingOffsets = [0], ringPointOffsets = [0], surfacePositions: number[] = [];
  const roadPointOffsets = [0], roadPositions: number[] = [];
  const addSurface = (surface: Surface): number => {
    if (!Array.isArray(surface)) bad('surface');
    const id = surfaceShapeOffsets.length - 1;
    for (const shape of surface) {
      if (!plain(shape) || !Array.isArray(shape.outer) || !Array.isArray(shape.holes)) bad('surface shape');
      for (const ring of [shape.outer, ...shape.holes]) {
        if (!Array.isArray(ring)) bad('surface ring');
        for (const p of ring) {
          if (!plain(p) || !finite(p.x) || !finite(p.y)) bad('surface point');
          surfacePositions.push(p.x, p.y);
        }
        ringPointOffsets.push(surfacePositions.length / 2);
      }
      shapeRingOffsets.push(ringPointOffsets.length - 1);
    }
    surfaceShapeOffsets.push(shapeRingOffsets.length - 1); return id;
  };
  const metadata = (value: any, key = ''): any => {
    if (SURFACE_KEYS.has(key) && (key !== 'surface' || Array.isArray(value))) return addSurface(value);
    if (key === 'surfaces') { if (!Array.isArray(value)) bad('occupation surfaces'); return value.map(addSurface); }
    if (Array.isArray(value)) return value.map(v => metadata(v));
    if (value && typeof value === 'object') {
      if (!plain(value)) bad('non-plain metadata');
      return Object.fromEntries(Object.entries(value).map(([k, v]) => { if (!safe(k)) bad('metadata key'); return [k, metadata(v, k)]; }));
    }
    if (typeof value === 'number' && !Number.isFinite(value) || ['function', 'bigint', 'symbol'].includes(typeof value)) bad('metadata scalar');
    return value;
  };
  const buildings = packet.buildings.map(building => {
    const { triangles = [], ...record } = building;
    for (const triangle of triangles) {
      triangleMaterialPresence.push(Object.hasOwn(triangle, 'material') ? 1 : 0);
      if (!Array.isArray(triangle.points) || triangle.points.length !== 3 || triangle.points.some((p: unknown) => !Array.isArray(p) || p.length !== 3 || !p.every(finite))
        || !Array.isArray(triangle.normal) || triangle.normal.length !== 3 || !triangle.normal.every(finite)) bad('triangle');
      for (const p of triangle.points) positions.push(...p);
      normals.push(...triangle.normal);
      if (!plain(triangle.materials) || Object.values(triangle.materials).some(v => typeof v !== 'string')) bad('material slots');
      const signature = JSON.stringify(Object.keys(triangle.materials).sort().map(k => [k, triangle.materials[k]]));
      if (!slots.has(signature)) { slots.set(signature, materialSlotsTable.length); materialSlotsTable.push(structuredClone(triangle.materials)); }
      triangleSlots.push(slots.get(signature)!);
      if (triangle.material === undefined) triangleMaterial.push(-1);
      else {
        if (typeof triangle.material !== 'string') bad('material id');
        if (!ids.has(triangle.material)) { ids.set(triangle.material, materialIds.length); materialIds.push(triangle.material); }
        triangleMaterial.push(ids.get(triangle.material)!);
      }
      if (triangle.surface !== 'wall' && triangle.surface !== 'roof') bad('triangle surface');
      triangleSurface.push(triangle.surface === 'roof' ? 1 : 0);
    }
    buildingTriangleOffsets.push(triangleSurface.length); return metadata(record);
  });
  const occupationBuildings = (packet.occupationBuildings ?? []).map(b => metadata(b));
  const roads = (packet.roads ?? []).map(road => {
    const { points = [], ...record } = road;
    for (const p of points) { if (!Array.isArray(p) || p.length !== 2 || !p.every(finite)) bad('road point'); roadPositions.push(...p); }
    roadPointOffsets.push(roadPositions.length / 2); return metadata(record);
  });
  const { buildings: _b, occupationBuildings: _o, roads: _r, ...header } = packet;
  const result: UrbanColumns = { ...structuredClone(header), format: 'magna-urban-columns', version: 1, buildings, occupationBuildings, roads,
    buildingTriangleOffsets: new Uint32Array(buildingTriangleOffsets), positions: new Float64Array(positions), normals: new Float64Array(normals),
    triangleSlots: new Uint32Array(triangleSlots), materialSlotsTable, triangleMaterial: new Int32Array(triangleMaterial), triangleMaterialPresence: new Uint8Array(triangleMaterialPresence), materialIds,
    triangleSurface: new Uint8Array(triangleSurface), surfaceShapeOffsets: new Uint32Array(surfaceShapeOffsets), shapeRingOffsets: new Uint32Array(shapeRingOffsets),
    ringPointOffsets: new Uint32Array(ringPointOffsets), surfacePositions: new Float64Array(surfacePositions), roadPointOffsets: new Uint32Array(roadPointOffsets), roadPositions: new Float64Array(roadPositions) };
  validateUrbanColumns(result); return result;
}

export function validateUrbanColumns(value: unknown): asserts value is UrbanColumns {
  const c = value as UrbanColumns;
  if (!plain(c) || c.format !== 'magna-urban-columns' || c.version !== 1 || !Array.isArray(c.buildings) || !Array.isArray(c.occupationBuildings) || !Array.isArray(c.roads)) bad('format or records');
  if (!(c.positions instanceof Float64Array) || c.positions.length % 9 || !(c.normals instanceof Float64Array) || c.normals.length !== c.positions.length / 3
    || !(c.surfacePositions instanceof Float64Array) || c.surfacePositions.length % 2 || !(c.roadPositions instanceof Float64Array) || c.roadPositions.length % 2) bad('coordinate columns');
  for (const array of [c.positions, c.normals, c.surfacePositions, c.roadPositions]) if (!array.every(Number.isFinite)) bad('non-finite coordinate');
  const n = c.positions.length / 9;
  offsets(c.buildingTriangleOffsets, n, 'building offsets');
  if (c.buildingTriangleOffsets.length !== c.buildings.length + 1) bad('building count');
  if (!(c.triangleSlots instanceof Uint32Array) || c.triangleSlots.length !== n || !(c.triangleMaterial instanceof Int32Array) || c.triangleMaterial.length !== n
    || !(c.triangleSurface instanceof Uint8Array) || c.triangleSurface.length !== n || !(c.triangleMaterialPresence instanceof Uint8Array) || c.triangleMaterialPresence.length !== n
    || !Array.isArray(c.materialSlotsTable) || !Array.isArray(c.materialIds)) bad('triangle columns');
  for (const slots of c.materialSlotsTable) if (!plain(slots) || Object.values(slots).some(v => typeof v !== 'string')) bad('material table');
  if (c.materialIds.some(id => typeof id !== 'string')) bad('material IDs');
  for (let i = 0; i < n; i++) if (c.triangleSlots[i] >= c.materialSlotsTable.length || c.triangleMaterial[i] < -1 || c.triangleMaterial[i] >= c.materialIds.length || c.triangleSurface[i] > 1
    || c.triangleMaterialPresence[i] > 1 || c.triangleMaterial[i] >= 0 && !c.triangleMaterialPresence[i]) bad('triangle table index');
  offsets(c.surfaceShapeOffsets, c.shapeRingOffsets?.length - 1, 'surface offsets');
  offsets(c.shapeRingOffsets, c.ringPointOffsets?.length - 1, 'shape offsets');
  offsets(c.ringPointOffsets, c.surfacePositions.length / 2, 'ring offsets');
  offsets(c.roadPointOffsets, c.roadPositions.length / 2, 'road offsets');
  if (c.roadPointOffsets.length !== c.roads.length + 1) bad('road count');
  const reference = (id: unknown) => { if (!Number.isInteger(id) || Number(id) < 0 || Number(id) >= c.surfaceShapeOffsets.length - 1) bad('surface reference'); };
  const record = (value: any, key = ''): void => {
    if (SURFACE_KEYS.has(key) && (key !== 'surface' || typeof value === 'number')) { reference(value); return; }
    if (key === 'surfaces') { if (!Array.isArray(value)) bad('occupation surfaces'); value.forEach(reference); return; }
    if (Array.isArray(value)) { value.forEach(v => record(v)); return; }
    if (value && typeof value === 'object') {
      if (!plain(value)) bad('non-plain record');
      for (const [k, v] of Object.entries(value)) { if (!safe(k)) bad('record key'); record(v, k); }
    } else if (typeof value === 'number' && !Number.isFinite(value) || ['function', 'symbol', 'bigint'].includes(typeof value)) bad('record value');
  };
  const seen = new Set<string>();
  for (const building of c.buildings) {
    if (!plain(building) || typeof building.id !== 'string' || !building.id || seen.has(building.id) || typeof building.parcelId !== 'string'
      || !finite(building.groundHeightM) || !['native', 'cartographic-proxy'].includes(building.representation) || typeof building.nativeRealization !== 'boolean') bad('building identity');
    seen.add(building.id); record(building);
  }
  for (const building of c.occupationBuildings) record(building);
  for (const road of c.roads) { if (!finite(road.widthM) || road.widthM <= 0) bad('road width'); record(road); }
}

export function unpackUrbanColumns(value: unknown): UrbanPacket {
  validateUrbanColumns(value);
  const c = value;
  const surface = (id: number): Surface => {
    if (!Number.isInteger(id) || id < 0 || id >= c.surfaceShapeOffsets.length - 1) bad('surface reference');
    const result: Surface = [];
    for (let s = c.surfaceShapeOffsets[id]; s < c.surfaceShapeOffsets[id + 1]; s++) {
      const rings: Surface[number]['outer'][] = [];
      for (let r = c.shapeRingOffsets[s]; r < c.shapeRingOffsets[s + 1]; r++) {
        const points = [];
        for (let p = c.ringPointOffsets[r]; p < c.ringPointOffsets[r + 1]; p++) points.push({ x: c.surfacePositions[p * 2], y: c.surfacePositions[p * 2 + 1] });
        rings.push(points);
      }
      if (!rings.length) bad('shape without outer ring');
      result.push({ outer: rings[0], holes: rings.slice(1) });
    }
    return result;
  };
  const metadata = (value: any, key = ''): any => {
    if (SURFACE_KEYS.has(key) && (key !== 'surface' || typeof value === 'number')) return surface(value);
    if (key === 'surfaces') { if (!Array.isArray(value)) bad('occupation surfaces'); return value.map(surface); }
    if (Array.isArray(value)) return value.map(v => metadata(v));
    if (value && typeof value === 'object') {
      if (!plain(value)) bad('non-plain metadata');
      return Object.fromEntries(Object.entries(value).map(([k, v]) => { if (!safe(k)) bad('metadata key'); return [k, metadata(v, k)]; }));
    }
    return value;
  };
  const buildings = c.buildings.map((building, b) => {
    const triangles = [];
    for (let i = c.buildingTriangleOffsets[b]; i < c.buildingTriangleOffsets[b + 1]; i++) {
      const start = i * 9;
      triangles.push({ points: [Array.from(c.positions.subarray(start, start + 3)), Array.from(c.positions.subarray(start + 3, start + 6)), Array.from(c.positions.subarray(start + 6, start + 9))],
        normal: Array.from(c.normals.subarray(i * 3, i * 3 + 3)), materials: structuredClone(c.materialSlotsTable[c.triangleSlots[i]]),
        ...(c.triangleMaterialPresence[i] ? { material: c.triangleMaterial[i] < 0 ? undefined : c.materialIds[c.triangleMaterial[i]] } : {}), surface: c.triangleSurface[i] ? 'roof' : 'wall' });
    }
    return { ...metadata(building), triangles };
  });
  const roads = c.roads.map((road, r) => {
    const points = [];
    for (let i = c.roadPointOffsets[r]; i < c.roadPointOffsets[r + 1]; i++) points.push([c.roadPositions[i * 2], c.roadPositions[i * 2 + 1]]);
    return { ...metadata(road), points };
  });
  const { format: _f, version: _v, buildings: _b, occupationBuildings: _o, roads: _r, buildingTriangleOffsets: _t, positions: _p, normals: _n,
    triangleSlots: _s, materialSlotsTable: _st, triangleMaterial: _m, triangleMaterialPresence: _mp, materialIds: _mi, triangleSurface: _sf, surfaceShapeOffsets: _ss,
    shapeRingOffsets: _sr, ringPointOffsets: _rp, surfacePositions: _sp, roadPointOffsets: _ro, roadPositions: _rs, ...header } = c;
  return { ...structuredClone(header), buildings, occupationBuildings: c.occupationBuildings.map(b => metadata(b)), roads };
}
