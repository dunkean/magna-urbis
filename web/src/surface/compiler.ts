import {
  SURFACE_COMPILER_VERSION, SURFACE_PHYSICAL_CONTEXT_VERSION, SURFACE_POPULATION_VERSION, SURFACE_SCHEMA_VERSION, DepositOrigin, Landform, Occupation, WaterClass,
  assertNotAborted, clamp, hashString, terrainBounds,
  type CompileOptions, type SurfaceCompileInput, type SurfaceFields, type SurfaceSample, type SurfaceWorld,
  type Bounds, type CanonicalSurfaceContext, type CanonicalSurfaceContextRef, type ClimateInput, type GeologyInput, type MaterialRecipe, type SurfaceGridGeometry, type TerrainGrid,
} from './model';
import { DEFAULT_ROCK_UNITS, SURFACE_MATERIALS, createMaterialIndex, dominantMaterialPair, materialColor, packMaterialMean, unpackMaterialMean, organicSoilFraction, type MaterialComposition } from './materials';
import { sampleTerrainHeight, type ReconstructedTerrain } from './heightSampling';

import { fingerprint } from './hash';
export { fingerprint } from './hash';
import { deriveSurfaceGeometryDetail, sampleSurfaceGeometryDetail, hydrateSurfaceGeometryDetail } from './geometryDetail';
import { SURFACE_MEMORY_BUDGET_BYTES } from './limits';
import { validateGeologyScenario } from './geologyScenario';
import { hasExplicitSurfaceLayers, surfaceLayerMetadata, surfaceLayerFieldsVersion, SURFACE_LAYER_FIELDS, SURFACE_LAYER_SHORT_FIELDS, SURFACE_LAYER_FLOAT_FIELDS, SURFACE_LAYER_MEAN_FIELDS, SURFACE_LAYER_BYTES_PER_SAMPLE, LEGACY_SURFACE_LAYERS_WARNING } from './surfaceLayers';

/** Read-only identity verification for packets made before the 128-bit cache keys.
 * New compilations and geometry retargets always use the current algorithm. */
function legacyFingerprint(value: unknown): string {
  let hash = 2166136261;
  const feed = (text: string) => { for (let j = 0; j < text.length; j++) hash = Math.imul(hash ^ text.charCodeAt(j), 16777619); };
  const walk = (v: unknown): void => {
    if (ArrayBuffer.isView(v)) {
      feed(v.constructor.name + ':' + v.byteLength + ':');
      for (const byte of new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) hash = Math.imul(hash ^ byte, 16777619);
    } else if (Array.isArray(v)) { feed('['); for (const x of v) walk(x); feed(']'); }
    else if (v && typeof v === 'object') { feed('{'); for (const key of Object.keys(v).filter(key => (v as Record<string, unknown>)[key] !== undefined).sort()) { feed(key + ':'); walk((v as Record<string, unknown>)[key]); } feed('}'); }
    else feed(typeof v + ':' + String(v) + ';');
  };
  walk(value); return (hash >>> 0).toString(16).padStart(8, '0');
}

function validateGrid(t: TerrainGrid): void {
  const kernel = (t as ReconstructedTerrain).reconstruction;
  if (kernel !== undefined && kernel !== 'bilinear-samples' && kernel !== 'cubic-bspline-controls') throw new Error('Unsupported terrain reconstruction kernel');
  if (!Number.isInteger(t.width) || !Number.isInteger(t.height) || t.width < 2 || t.height < 2 || t.width * t.height > 16_777_216) throw new Error('Terrain grid dimensions must be 2..16777216 samples');
  if (!Number.isFinite(t.spacingM) || t.spacingM <= 0 || !Number.isFinite(t.originX) || !Number.isFinite(t.originZ)) throw new Error('Terrain coordinates and spacing must be finite metres');
  if (t.heights.length !== t.width * t.height) throw new Error('Terrain heights length does not match grid');
  if (typeof t.source.id !== 'string' || !t.source.id || typeof t.source.version !== 'string' || !t.source.version || !Number.isFinite(t.source.sourceLOD) || !Number.isFinite(t.source.nativeSpacingM) || !(t.source.nativeSpacingM > 0)
    || t.source.sourceLODKnown !== undefined && typeof t.source.sourceLODKnown !== 'boolean') throw new Error('Terrain source identity, sourceLOD and finite native spacing are required');
  for (const h of t.heights) if (!Number.isFinite(h)) throw new Error('Terrain height must be finite');
}

const FLOAT_FIELDS = ['slope', 'aspect', 'curvature', 'contributingAreaM2', 'waterLevelM', 'distanceToWaterM', 'handM', 'twi',
  'depositDepthM', 'sand', 'silt', 'clay', 'organic', 'stoniness', 'soilDepthM', 'moisture', 'temperatureC', 'precipitationMm',
  'treeCover', 'grassCover', 'shrubCover', 'litter', 'orientation', 'snow', 'wetness', 'materialBlend', 'edgeConfidence'] as const;
const BYTE_FIELDS = ['landform', 'waterClass', 'closedBasin', 'depositOrigin', 'occupation'] as const;
const SHORT_FIELDS = ['bedrock', 'sourceRock', 'material', 'materialSecondary'] as const;
const INT_FIELDS = ['downstream', 'basin', 'drainageCell'] as const;
function createFields(n: number, radii: number, units: number, includeLayers = true): SurfaceFields {
  const f = {} as SurfaceFields;
  for (const key of FLOAT_FIELDS) f[key] = new Float32Array(n);
  for (const key of BYTE_FIELDS) f[key] = new Uint8Array(n);
  for (const key of SHORT_FIELDS) f[key] = new Uint16Array(n);
  for (const key of INT_FIELDS) f[key] = new Int32Array(n);
  f.materialMeanColor = new Uint32Array(n);
  if(includeLayers){
    for(const key of SURFACE_LAYER_SHORT_FIELDS)f[key]=new Uint16Array(n);
    for(const key of SURFACE_LAYER_FLOAT_FIELDS)f[key]=new Float32Array(n);
    for(const key of SURFACE_LAYER_MEAN_FIELDS)f[key]=new Uint32Array(n);
  }
  f.topographicPosition = Array.from({ length: radii }, () => new Float32Array(n));
  f.provenance = Array.from({ length: units }, () => new Float32Array(n));
  f.transportedProvenance = Array.from({ length: units }, () => new Float32Array(n));
  f.waterLevelM.fill(NaN); f.handM.fill(NaN); f.distanceToWaterM.fill(Infinity); f.downstream.fill(-1); f.drainageCell.fill(-1);
  return f;
}

/** Conservative owned payload + compiler temporaries; excludes the caller's existing input buffers. */
export function estimateSurfaceCompileBytes(grid: SurfaceGridGeometry, units: number, radii: number): number {
  const n = grid.width * grid.height;
  return n * (FLOAT_FIELDS.length * 4 + BYTE_FIELDS.length + SHORT_FIELDS.length * 2 + INT_FIELDS.length * 4 + 4 + SURFACE_LAYER_BYTES_PER_SAMPLE + (radii + units * 2) * 4 + 4 + 2 + 80 + 39)
    + (grid.width + 1) * (grid.height + 1) * 8;
}
function assertMemoryBudget(required: number, requested = 512 * 1024 * 1024): void {
  if (!Number.isFinite(requested) || requested <= 0) throw new Error('memoryBudgetBytes must be finite and positive');
  if (required > requested) throw new Error(`Surface compilation requires approximately ${required} bytes, exceeding memoryBudgetBytes=${requested}; reduce grid/fields or explicitly raise the budget`);
}

function validateAligned(input: SurfaceCompileInput, n: number): void {
  const arrays = [input.geology?.bedrock, input.hydrology?.downstream, input.hydrology?.contributingAreaM2,
    input.hydrology?.waterClass, input.hydrology?.waterLevelM, input.occupation?.classes, input.occupation?.orientationRadians,
    input.climate?.temperatureC, input.climate?.precipitationMm, ...Object.values(input.processes ?? {})];
  for (const a of arrays) if (a && a.length !== n) throw new Error('Context field length must match canonical terrain grid');
  for (const c of input.occupation?.classes ?? []) if (c > Occupation.Yard) throw new Error('Unknown occupation class');
  for (const c of input.hydrology?.waterClass ?? []) if (c > WaterClass.Ocean) throw new Error('Unknown water class');
  for (const a of [input.hydrology?.contributingAreaM2, input.processes?.aeolianSupply, input.processes?.coastDistanceM, input.occupation?.orientationRadians, input.climate?.temperatureC, input.climate?.precipitationMm]) {
    for (const x of a ?? []) if (!Number.isFinite(x)) throw new Error('Context values must be finite');
  }
  for (const x of input.climate?.precipitationMm ?? []) if (x < 0) throw new Error('Precipitation cannot be negative');
  for (let i = 0; i < n; i++) {
    const level = input.hydrology?.waterLevelM?.[i];
    if (level !== undefined && !Number.isFinite(level) && !Number.isNaN(level)) throw new Error('Water levels must be finite or dry NaN');
    if (input.hydrology?.waterClass?.[i] && input.hydrology.waterLevelM && (!Number.isFinite(level) || level! < input.terrain.heights[i] - .001)) throw new Error('Wet cell requires a finite water level at or above the bed');
  }
}

function validateGeology(g: GeologyInput): Map<number, number> {
  if(g.scenario){validateGeologyScenario(g.scenario);if(fingerprint(g.units)!==fingerprint(g.scenario.units))throw new Error('Geological scenario catalogue differs from its declared units');}
  if (!g.units.length || g.units.length > 64) throw new Error('Geology requires 1..64 explicit units');
  const ids = new Map<number, number>();
  g.units.forEach((r, j) => {
    if (!Number.isInteger(r.id) || r.id < 1 || r.id > 65535 || ids.has(r.id)) throw new Error('Geology ids must be unique uint16 values');
    for (const fraction of [r.sand, r.silt, r.clay, r.hardness, r.weatherability]) if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('Invalid rock-unit fractions/properties');
    if (Math.abs(r.sand + r.silt + r.clay - 1) > .00001) throw new Error('Rock mineral sand+silt+clay must sum to one');
    if (!Number.isFinite(r.strikeRadians) || r.colorLinear.length !== 3 || r.colorLinear.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Invalid rock structural angle/color');
    ids.set(r.id, j);
  });
  for (const id of g.bedrock) if (!ids.has(id)) throw new Error('Bedrock references unknown unit id');
  return ids;
}

/** Finite differences plus square-neighbourhood TPI at physical radii. Not a geomorphon implementation. */
function morphology(t: TerrainGrid, f: SurfaceFields, radii: number[], signal?: AbortSignal): void {
  const { width: w, height: h, heights: a, spacingM: d } = t;
  const at = (x: number, z: number) => a[Math.max(0, Math.min(h - 1, z)) * w + Math.max(0, Math.min(w - 1, x))];
  const stride = w + 1, integral = new Float64Array((w + 1) * (h + 1));
  for (let z = 0; z < h; z++) {
    if (!(z % 64)) assertNotAborted(signal);
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      const dx = (at(x + 1, z) - at(x - 1, z)) / (d * (x === 0 || x === w - 1 ? 1 : 2));
      const dz = (at(x, z + 1) - at(x, z - 1)) / (d * (z === 0 || z === h - 1 ? 1 : 2));
      f.slope[i] = Math.atan(Math.hypot(dx, dz));
      f.aspect[i] = Math.atan2(-dz, -dx);
      const second = (coordinate: number, size: number, axis: 'x' | 'z') => {
        const read = (c: number) => axis === 'x' ? at(c, z) : at(x, c);
        if (size === 2) return 0;
        if (coordinate === 0) return read(0) - 2 * read(1) + read(2);
        if (coordinate === size - 1) return read(size - 1) - 2 * read(size - 2) + read(size - 3);
        return read(coordinate - 1) + read(coordinate + 1) - 2 * read(coordinate);
      };
      f.curvature[i] = (second(x, w, 'x') + second(z, h, 'z')) / (d * d);
      f.edgeConfidence[i] = clamp(Math.min(x, z, w - 1 - x, h - 1 - z) * d / Math.max(...radii));
      sum += a[i]; integral[(z + 1) * stride + x + 1] = integral[z * stride + x + 1] + sum;
    }
  }
  radii.forEach((radius, layer) => {
    const r = Math.max(1, Math.round(radius / d));
    for (let z = 0; z < h; z++) {
      if (!(z % 64)) assertNotAborted(signal);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const z0 = Math.max(0, z - r), z1 = Math.min(h, z + r + 1);
        const sum = integral[z1 * stride + x1] - integral[z0 * stride + x1] - integral[z1 * stride + x0] + integral[z0 * stride + x0];
        const i = z * w + x, gradient = Math.tan(f.slope[i]);
        const dx = -gradient * Math.cos(f.aspect[i]), dz = -gradient * Math.sin(f.aspect[i]);
        const planarEdgeBias = dx * ((x0 + x1 - 1) / 2 - x) * d + dz * ((z0 + z1 - 1) / 2 - z) * d;
        f.topographicPosition[layer][i] = a[i] - sum / ((x1 - x0) * (z1 - z0)) + planarEdgeBias;
      }
    }
  });
  for (let i = 0; i < a.length; i++) {
    const small = f.topographicPosition[0][i], large = f.topographicPosition[Math.min(1, radii.length - 1)][i];
    const tolerance = Math.max(1, radii[0] * .015);
    f.landform[i] = large < -tolerance * 1.5 ? Landform.Valley : small > tolerance && f.slope[i] < .5 ? Landform.Ridge
      : small > tolerance ? Landform.Shoulder : small < -tolerance ? (f.slope[i] < .25 ? Landform.Footslope : Landform.Hollow)
      : f.slope[i] < .06 ? Landform.Flat : Landform.Slope;
  }
}

function drainage(input: SurfaceCompileInput, f: SurfaceFields, ids: Map<number, number>, options: CompileOptions): Int32Array {
  const signal = options.signal;
  const t = input.terrain, { width: w, height: h, spacingM: d } = t, n = w * h;
  if (input.hydrology?.downstream) f.downstream.set(input.hydrology.downstream);
  else {
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const i = z * w + x;
      let best = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || x + dx < 0 || x + dx >= w || z + dz < 0 || z + dz >= h) continue;
        const j = (z + dz) * w + x + dx, drop = (t.heights[i] - t.heights[j]) / Math.hypot(dx, dz);
        if (drop > best) { best = drop; f.downstream[i] = j; }
      }
    }
  }
  const incoming = new Uint32Array(n), queue = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const j = f.downstream[i];
    if (j < -1 || j >= n || j === i) throw new Error('Hydrology downstream index is invalid');
    if (j >= 0) incoming[j]++;
    f.contributingAreaM2[i] = d * d;
    f.transportedProvenance[ids.get(f.bedrock[i])!][i] = d * d;
  }
  for (const flow of input.hydrology?.inflows ?? []) {
    if (!Number.isInteger(flow.cell) || flow.cell < 0 || flow.cell >= n || !Number.isFinite(flow.contributingAreaM2) || flow.contributingAreaM2 < 0) throw new Error('Invalid external inflow');
    if (Math.abs(flow.provenance.reduce((sum, p) => sum + p.fraction, 0) - 1) > .00001) throw new Error('Inflow provenance fractions must sum to one');
    f.contributingAreaM2[flow.cell] += flow.contributingAreaM2;
    for (const p of flow.provenance) {
      const u = ids.get(p.unitId);
      if (u === undefined || !Number.isFinite(p.fraction) || p.fraction < 0) throw new Error('Invalid inflow provenance');
      f.transportedProvenance[u][flow.cell] += p.fraction * flow.contributingAreaM2;
    }
  }
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (!incoming[i]) queue[tail++] = i;
  while (head < tail) {
    if (!(head % 16384)) assertNotAborted(signal);
    const i = queue[head++], j = f.downstream[i];
    if (j >= 0) {
      f.contributingAreaM2[j] += f.contributingAreaM2[i];
      for (const p of f.transportedProvenance) p[j] += p[i];
      if (!--incoming[j]) queue[tail++] = j;
    }
  }
  if (tail !== n) throw new Error('Authoritative hydrology contains a cycle; export routed lake outlets explicitly');
  // Normalise transported mixtures before optional source-area override (which may include unexported upstream basins).
  for (let i = 0; i < n; i++) for (const p of f.transportedProvenance) p[i] /= f.contributingAreaM2[i];
  if (input.hydrology?.contributingAreaM2) {
    for (let i = 0; i < n; i++) {
      const a = input.hydrology.contributingAreaM2[i];
      if (a < 0) throw new Error('Contributing area cannot be negative');
      f.contributingAreaM2[i] = Math.max(d * d, a);
    }
  }
  if (input.hydrology?.waterClass) f.waterClass.set(input.hydrology.waterClass);
  else {
    const threshold = options.riverAreaThresholdM2 ?? 1_000_000;
    for (let i = 0; i < n; i++) if (f.contributingAreaM2[i] >= threshold) f.waterClass[i] = WaterClass.River;
  }
  if (input.hydrology?.waterLevelM) f.waterLevelM.set(input.hydrology.waterLevelM);
  else for (let i = 0; i < n; i++) if (f.waterClass[i]) f.waterLevelM[i] = t.heights[i];
  const drainageElevation = new Float32Array(n).fill(NaN);
  for (let k = n - 1; k >= 0; k--) {
    const i = queue[k], j = f.downstream[i], x = i % w, z = Math.floor(i / w);
    f.basin[i] = j < 0 ? i : f.basin[j];
    f.closedBasin[i] = j < 0 ? Number(f.waterClass[i] !== WaterClass.Ocean && x > 0 && z > 0 && x < w - 1 && z < h - 1) : f.closedBasin[j];
    if (f.waterClass[i]) { drainageElevation[i] = f.waterLevelM[i]; f.drainageCell[i] = i; }
    else if (j >= 0) { drainageElevation[i] = drainageElevation[j]; f.drainageCell[i] = f.drainageCell[j]; }
    if (Number.isFinite(drainageElevation[i])) f.handM[i] = Math.max(0, t.heights[i] - drainageElevation[i]);
    f.twi[i] = Math.log(Math.max(1, f.contributingAreaM2[i] / d) / Math.max(.005, Math.tan(f.slope[i])));
    if (f.waterClass[i]) f.distanceToWaterM[i] = 0;
  }
  // Chamfer distance is only a proximity descriptor. HAND above follows the authoritative network.
  for (let pass = 0; pass < 2; pass++) {
    const forward = pass === 0;
    for (let k = 0; k < n; k++) {
      const i = forward ? k : n - 1 - k, x = i % w, z = Math.floor(i / w);
      for (const dz of (forward ? [-1, 0] : [1, 0])) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz || x + dx < 0 || x + dx >= w || z + dz < 0 || z + dz >= h) continue;
        if (dz === 0 && (forward ? dx > 0 : dx < 0)) continue;
        f.distanceToWaterM[i] = Math.min(f.distanceToWaterM[i], f.distanceToWaterM[(z + dz) * w + x + dx] + d * Math.hypot(dx, dz));
      }
    }
  }
  return queue;
}

export function compileSurfaceWorld(input: SurfaceCompileInput, options: CompileOptions = {}): SurfaceWorld {
  assertNotAborted(options.signal);
  if (!Number.isSafeInteger(input.seed)) throw new Error('Surface seed must be a safe integer');
  validateGrid(input.terrain);
  if (input.terrain.reconstruction === 'cubic-bspline-controls') throw new Error('Canonical environment analysis requires physical samples; reconstruct provider controls explicitly before compilation');
  const rawRadii = options.topographicRadiiM ?? [Math.max(150, input.terrain.spacingM * 2), Math.max(600, input.terrain.spacingM * 4), Math.max(2000, input.terrain.spacingM * 8)];
  if (!rawRadii.length || rawRadii.length > 16 || rawRadii.some((r, i) => !Number.isFinite(r) || r <= 0 || i > 0 && r <= rawRadii[i - 1])) throw new Error('Topographic radii must be 1..16 ascending positive metres');
  const radii = rawRadii.map(r => Math.max(1, Math.round(r / input.terrain.spacingM)) * input.terrain.spacingM);
  for (const [name, value] of Object.entries({ riverAreaThresholdM2: options.riverAreaThresholdM2 ?? 1_000_000, floodplainWidthM: options.floodplainWidthM ?? 150, colluvialDecayLengthM: options.colluvialDecayLengthM ?? 100 })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(name + ' must be positive physical units');
  }
  const requiredBytes = estimateSurfaceCompileBytes(input.terrain, input.geology?.units.length ?? 1, radii.length);
  assertMemoryBudget(requiredBytes, options.memoryBudgetBytes);
  // Snapshot mutable generator buffers: a later streaming update cannot silently edit a versioned world.
  const t: TerrainGrid = { ...input.terrain, source: { ...input.terrain.source }, heights: new Float32Array(input.terrain.heights) };
  input = { ...input, terrain: t };
  const n = t.width * t.height;
  validateAligned(input, n);
  const warnings: string[] = [], assumptions: string[] = [];
  const geology = input.geology ? { ...input.geology, scenario:input.geology.scenario?structuredClone(input.geology.scenario):undefined, units: input.geology.units.map(u => ({ ...u, colorLinear: [...u.colorLinear] as [number, number, number] })), bedrock: new Uint16Array(input.geology.bedrock) }
    : { version: 'declared-default-granite-1', provenance: 'Explicit default scenario: uniform granitic basement; not inferred from climate', units: [{ ...DEFAULT_ROCK_UNITS[0], colorLinear: [...DEFAULT_ROCK_UNITS[0].colorLinear] as [number, number, number] }], bedrock: new Uint16Array(n).fill(1) };
  if (!input.geology) warnings.push('No geology map supplied: declared uniform granite scenario, not an observed lithology.');
  const ids = validateGeology(geology);
  const climate: ClimateInput = input.climate ? { ...input.climate, temperatureC: input.climate.temperatureC ? new Float32Array(input.climate.temperatureC) : undefined, precipitationMm: input.climate.precipitationMm ? new Float32Array(input.climate.precipitationMm) : undefined }
    : { version: 'temperate-default-1', meanAnnualTempC: 12, annualPrecipMm: 850, seasonalAmplitudeC: 10, referenceElevationM: 0, lapseRateCPerKm: 6.5, windRadians: 0 };
  if (![climate.meanAnnualTempC, climate.annualPrecipMm, climate.seasonalAmplitudeC ?? 0, climate.lapseRateCPerKm ?? 6.5, climate.referenceElevationM ?? 0, climate.windRadians ?? 0].every(Number.isFinite) || climate.annualPrecipMm < 0) throw new Error('Climate must use finite physical degrees C and mm/year');
  const state = { ...(input.state ?? { version: 'summer-default-1', dayOfYear: 200, surfaceWetness: 0, snowWaterEquivalentM: 0 }) };
  if (!Number.isFinite(state.dayOfYear) || state.dayOfYear < 1 || state.dayOfYear > 366 || !Number.isFinite(state.surfaceWetness ?? 0) || !Number.isFinite(state.snowWaterEquivalentM ?? 0)) throw new Error('Invalid seasonal state');
  const materials = options.materialLibrary ?? SURFACE_MATERIALS, M = createMaterialIndex(materials);
  for (const required of SURFACE_MATERIALS) if (M[required.id] === undefined) throw new Error('Material catalogue missing required recipe ' + required.id);
  const f = createFields(n, radii.length, geology.units.length);
  f.bedrock.set(geology.bedrock);
  morphology(t, f, radii, options.signal);
  const order = drainage(input, f, ids, options);
  const boundary = input.hydrology?.boundary ?? 'truncated';
  if (!input.hydrology?.downstream) warnings.push('Routing derived by strict downhill D8; flats and closed sinks are retained. Supply source routing for basin-faithful hydrology.');
  if (boundary === 'truncated') warnings.push('Upstream basin is truncated at export boundary; contributing area and provenance omit unknown exterior inputs.');
  if (input.hydrology?.contributingAreaM2 && !input.hydrology.inflows?.length) warnings.push('Source contributing area is preserved; exterior sediment provenance remains unknown without explicit inflows.');
  warnings.push('Morphology windows are clipped within the largest-radius edge band; edgeConfidence marks reduced confidence. Planar edge bias is removed, but exterior context is still required for independent tile compilation.');
  if (!input.hydrology?.waterLevelM && f.waterClass.some(v => v !== WaterClass.Dry)) warnings.push('Wet-cell water levels fall back to bed elevation because source levels were not supplied; depth is unknown, not an observed zero-depth lake/ocean.');
  assumptions.push('Morphology uses finite differences and multi-radius square-window TPI, not a full geomorphon classifier.', 'Sediment depth, organic content, moisture, TWI/HAND interpretation and cover are synthesis potentials, not a calibrated mass-conserving sediment/pedology simulation.', 'Water proximity is a chamfer distance; HAND follows source drainage. Date alone does not predict discharge or flood levels.', 'Special landforms require declared process masks and existing terrain geometry; surface motifs do not generate dunes, karst, glaciers or volcanic landforms.');
  assumptions.push('surface-layers-1 separates substrate/soil/deposits, low living/dead cover and physical trees. Legacy material* remains the mixed ground/low-cover composite, not bare soil.',
    'Ground support policy natural-under-infrastructure-1: coarse Built/Road/Yard occupation does not imply an artificial ground finish; source vector infrastructure owns its material.',
    'Low-cover opacity is a same-plane support budget: rock exclusion, dead litter, shrub proxy and herbs; canopy crown cover may overlap vertically. Shrubs currently use the authored low-vegetation recipe, not a dedicated foliage PBR asset.');
  if (t.spacingM < t.source.nativeSpacingM) warnings.push('Grid is finer than native source spacing; this is reconstruction, not new source terrain detail.');
  if (t.source.sourceLODKnown === false) warnings.push('Generator source LOD was not recorded by the legacy source; numeric sourceLOD is a compatibility placeholder.');
  const colluvium = new Float32Array(n), colluvialSource = new Uint16Array(n), colluvialBest = new Float32Array(n);
  // Route a source-connected gravity potential over the same downhill graph. Deposits have an actual upslope rock source.
  for (const i of order) {
    const rock = geology.units[ids.get(f.bedrock[i])!], steep = clamp((f.slope[i] - .38) / .6);
    const local = steep * rock.hardness * t.spacingM / 20;
    if (local > colluvialBest[i]) { colluvialBest[i] = local; colluvialSource[i] = rock.id; }
    colluvium[i] += local;
    const j = f.downstream[i];
    if (j >= 0) {
      const stepM = Math.hypot(j % t.width - i % t.width, Math.floor(j / t.width) - Math.floor(i / t.width)) * t.spacingM;
      const decayLength = (options.colluvialDecayLengthM ?? 100) * (f.slope[i] < .22 ? .2 : 1);
      const retained = t.heights[j] >= t.heights[i] ? 0 : Math.exp(-stepM / decayLength);
      colluvium[j] += colluvium[i] * retained;
      if (colluvialBest[i] * retained > colluvialBest[j]) { colluvialBest[j] = colluvialBest[i] * retained; colluvialSource[j] = colluvialSource[i]; }
    }
  }
  if (input.occupation) f.occupation.set(input.occupation.classes);
  const yearPhase = Math.cos((state.dayOfYear - 200) * Math.PI * 2 / 365.25);
  for (let i = 0; i < n; i++) {
    if (!(i % 16384)) assertNotAborted(options.signal);
    const bed = geology.units[ids.get(f.bedrock[i])!];
    const s = f.slope[i], flat = 1 - clamp(s / .7), water = f.waterClass[i];
    const hand = f.handM[i], distance = f.distanceToWaterM[i];
    const alluvial = (hand >= 0 ? Math.exp(-hand / 7) : 0) * Math.exp(-distance / (options.floodplainWidthM ?? 150)) * flat;
    const gravity = clamp(colluvium[i] * .35) * clamp((.8 - s) / .6);
    const wind = clamp(input.processes?.aeolianSupply?.[i] ?? 0) * flat;
    const coastDistance = input.processes?.coastDistanceM?.[i] ?? Infinity;
    const coastal = Math.exp(-Math.abs(coastDistance) / 35) * flat;
    let origin = DepositOrigin.Residual;
    if (gravity > .16) origin = DepositOrigin.Colluvial;
    if (alluvial > .28) origin = DepositOrigin.Alluvial;
    if (wind > .55 && alluvial < .4) origin = DepositOrigin.Aeolian;
    if (coastal > .45 && water !== WaterClass.River && (wind > .12 || alluvial > .1 || bed.sand > .5)) origin = DepositOrigin.Coastal;
    f.depositOrigin[i] = origin;
    let source = bed, sand = bed.sand, silt = bed.silt, clay = bed.clay;
    if (origin === DepositOrigin.Colluvial && colluvialSource[i]) {
      source = geology.units[ids.get(colluvialSource[i])!]; sand = source.sand; silt = source.silt; clay = source.clay;
      for (let u = 0; u < geology.units.length; u++) f.provenance[u][i] = Number(geology.units[u].id === source.id);
    } else if (origin === DepositOrigin.Alluvial || origin === DepositOrigin.Coastal) {
      sand = 0; silt = 0; clay = 0;
      let best = -1;
      for (let u = 0; u < geology.units.length; u++) {
        const sedimentCell = f.drainageCell[i] >= 0 ? f.drainageCell[i] : i;
        const r = geology.units[u], p = f.transportedProvenance[u][sedimentCell];
        f.provenance[u][i] = p;
        sand += r.sand * p; silt += r.silt * p; clay += r.clay * p;
        if (p > best) { best = p; source = r; }
      }
      // Sorting changes mineral-size fractions, not lithological provenance.
      const fine = clamp((hand < 0 ? 0 : hand) / 15 + flat * .3);
      sand *= 1.2 - .65 * fine; silt *= .9 + .7 * fine; clay *= .75 + .8 * fine;
    } else {
      for (let u = 0; u < geology.units.length; u++) f.provenance[u][i] = Number(geology.units[u].id === bed.id);
      if (origin === DepositOrigin.Aeolian) { sand = .92; silt = .065; clay = .015; }
    }
    f.sourceRock[i] = source.id;
    const mineralSum = sand + silt + clay;
    f.sand[i] = sand / mineralSum; f.silt[i] = silt / mineralSum; f.clay[i] = clay / mineralSum;
    f.depositDepthM[i] = origin === DepositOrigin.Alluvial ? alluvial * 2.4 : origin === DepositOrigin.Colluvial ? gravity * 1.7 : origin === DepositOrigin.Aeolian ? wind * .8 : origin === DepositOrigin.Coastal ? coastal * .65 : 0;
    f.soilDepthM[i] = clamp((.12 + bed.weatherability * .9 + Math.max(0, -f.topographicPosition[0][i]) * .012) * flat + f.depositDepthM[i] * .35, .015, 3);
    f.stoniness[i] = clamp(.08 + s * .75 + gravity * .65 - f.depositDepthM[i] * .2);
    const temp = (climate.temperatureC?.[i] ?? climate.meanAnnualTempC) - (climate.elevationCorrected ? 0 : (t.heights[i] - (climate.referenceElevationM ?? 0)) * (climate.lapseRateCPerKm ?? 6.5) / 1000);
    const exposure = .5 + .5 * Math.cos(f.aspect[i] - (climate.windRadians ?? 0)) * clamp(s / .1);
    f.temperatureC[i] = temp;
    f.precipitationMm[i] = climate.precipitationMm?.[i] ?? climate.annualPrecipMm * (.93 + .14 * exposure);
    if (f.precipitationMm[i] < 0) throw new Error('Precipitation cannot be negative');
    const aridity = f.precipitationMm[i] / Math.max(180, 450 + Math.max(0, temp) * 30);
    const drainageRetention = clamp((f.twi[i] - 5) / 14) * .23;
    const moisture = clamp(aridity * .45 + drainageRetention + alluvial * .28 + f.clay[i] * .18 - f.sand[i] * .12 - s * .2);
    f.moisture[i] = water ? 1 : moisture;
    const growing = clamp((temp + 4) / 15) * clamp((39 - temp) / 15);
    const ground = (1 - f.stoniness[i]) * clamp(f.soilDepthM[i] / .45) * growing;
    const tree = clamp((moisture - .23) * 1.7) * ground * flat;
    f.treeCover[i] = water ? 0 : tree;
    f.shrubCover[i] = water ? 0 : ground * (1 - tree) * .28;
    f.grassCover[i] = water ? 0 : ground * clamp(moisture * 1.5) * (1 - tree * .8) * (1 - f.shrubCover[i]);
    f.organic[i] = clamp((tree * .16 + f.grassCover[i] * .05 + Math.max(0, moisture - .72) * .8) * clamp((32 - temp) / 25), 0, .75);
    f.litter[i] = tree * (.4 + moisture * .4);
    const occupation = f.occupation[i];
    if (occupation !== Occupation.Natural) {
      if (occupation === Occupation.Orchard) f.treeCover[i] = water ? 0 : .38 * growing;
      else f.treeCover[i] = 0;
      f.shrubCover[i] = 0; f.litter[i] = 0;
      if (occupation === Occupation.Meadow || occupation === Occupation.Pasture) f.grassCover[i] = water ? 0 : .85 * growing;
      else if (occupation === Occupation.Crop) f.grassCover[i] = water ? 0 : .65 * growing;
      else f.grassCover[i] = 0;
    }
    f.orientation[i] = input.occupation?.orientationRadians?.[i] ?? (origin === DepositOrigin.Aeolian ? climate.windRadians ?? 0 : origin === DepositOrigin.Alluvial ? f.aspect[i] : bed.strikeRadians);
    const seasonalTemp = temp + (climate.seasonalAmplitudeC ?? 10) * yearPhase;
    const explicitSnow = Math.max(0, state.snowWaterEquivalentM ?? 0);
    f.snow[i] = clamp((explicitSnow * 10 + Math.max(0, -seasonalTemp) * .07 * clamp(f.precipitationMm[i] / 700)) * (1 - clamp(s / 1.3) * .8));
    f.wetness[i] = clamp(moisture * .65 + (state.surfaceWetness ?? 0));
    let material = M['mineral-soil'];
    if (f.treeCover[i] + f.grassCover[i] > .25) material = M['vegetation-litter'];
    if (aridity < .45 && f.grassCover[i] < .2) material = M['arid-reg'];
    if (f.stoniness[i] > .48 || s > .7) material = M['fractured-bedrock'];
    if (origin === DepositOrigin.Colluvial) material = M['angular-talus'];
    if (origin === DepositOrigin.Alluvial) material = M['alluvial-bars'];
    if (moisture > .8 && s < .12) material = M['wetland-organic'];
    if (origin === DepositOrigin.Aeolian) material = M['wind-ripple-sand'];
    if (input.processes?.karst?.[i] && bed.lithology === 'limestone') material = M['carbonate-karst'];
    if (input.processes?.volcanic?.[i] || input.processes?.geothermal?.[i]) material = M['volcanic-crust'];
    if (Math.abs(coastDistance) < 40 && water === WaterClass.Dry) material = origin === DepositOrigin.Coastal ? M['coastal-sediment'] : M['coastal-rock'];
    if (occupation === Occupation.Road || occupation === Occupation.Yard) material = M['compacted-road'];
    if (occupation === Occupation.Crop) material = M['cultivated-soil'];
    if (occupation === Occupation.Built) material = M['built-foundation'];
    if (water === WaterClass.River || water === WaterClass.Lake) material = M['inland-water'];
    if (water === WaterClass.Ocean) material = M['marine-water'];
    let composition: MaterialComposition;
    if (water || occupation === Occupation.Road || occupation === Occupation.Yard || occupation === Occupation.Crop || occupation === Occupation.Built) {
      composition = { primary: material, secondary: material, blend: 0 };
    } else {
      // Coverage budget on the ground support. Canopy is separate; litter and grass compete for exposed soil.
      const rockCover = clamp((f.stoniness[i] - .08) / .75);
      const litterCover = clamp(f.litter[i] * 1.35) * (1 - rockCover);
      const grassCover = clamp(f.grassCover[i]) * Math.max(0, 1 - rockCover - litterCover);
      const remaining = Math.max(0, 1 - rockCover - litterCover - grassCover);
      const rockMaterial = material === M['carbonate-karst'] || material === M['volcanic-crust'] || material === M['coastal-rock'] ? material : M['fractured-bedrock'];
      const sedimentWeights: Array<[number, number]> = [[M['alluvial-bars'], alluvial], [M['angular-talus'], gravity], [M['wind-ripple-sand'], wind], [M['coastal-sediment'], origin === DepositOrigin.Coastal ? coastal : 0]];
      const processSum = sedimentWeights.reduce((sum, [, weight]) => sum + weight, 0), processScale = Math.max(1, processSum);
      const dryFraction = clamp((.65 - aridity) / .4), residual = remaining * (1 - Math.min(1, processSum));
      composition = dominantMaterialPair([[rockMaterial, rockCover], [M['forest-litter'], litterCover], [M['vegetation-litter'], grassCover],
        [M['mineral-soil'], residual * (1 - dryFraction)], [M['arid-reg'], residual * dryFraction], ...sedimentWeights.map(([id, weight]) => [id, weight / processScale * remaining] as [number, number])]);
    }
    f.material[i] = composition.primary; f.materialSecondary[i] = composition.secondary; f.materialBlend[i] = composition.blend;
    const primaryColor = materialColor(materials[composition.primary], source), secondaryColor = materialColor(materials[composition.secondary], source);
    f.materialMeanColor[i] = packMaterialMean(primaryColor.map((v, channel) => v * (1 - composition.blend) + secondaryColor[channel] * composition.blend));
    // Three vertical layers. Build bare support BEFORE litter/live cover; the
    // legacy composite above is deliberately preserved byte-for-byte.
    const rockCover=clamp((f.stoniness[i]-.08)/.75);
    const supportRock = input.processes?.karst?.[i] && bed.lithology==='limestone' ? M['carbonate-karst']
      : input.processes?.volcanic?.[i] || input.processes?.geothermal?.[i] ? M['volcanic-crust']
      : Math.abs(coastDistance)<40 && water===WaterClass.Dry && origin!==DepositOrigin.Coastal ? M['coastal-rock'] : M['fractured-bedrock'];
    const supportSediment:Array<[number,number]>=[[M['alluvial-bars'],alluvial],[M['angular-talus'],gravity],[M['wind-ripple-sand'],wind],[M['coastal-sediment'],origin===DepositOrigin.Coastal?coastal:0]];
    const supportSum=supportSediment.reduce((sum,[,v])=>sum+v,0),supportScale=Math.max(1,supportSum),soilRest=(1-rockCover)*(1-Math.min(1,supportSum));
    const dryFraction=clamp((.65-aridity)/.4),humus=organicSoilFraction(moisture,s,f.organic[i]);
    const soilWeight=soilRest*(1-dryFraction);
    let groundWeights:Array<[number,number]>=[[supportRock,rockCover],[M['mineral-soil'],soilWeight*(1-humus)],[M['organic-soil'],soilWeight*humus],[M['arid-reg'],soilRest*dryFraction],...supportSediment.map(([id,v])=>[id,v/supportScale*(1-rockCover)] as [number,number])];
    // Coarse occupation is an exclusion/support constraint, not evidence of laid
    // paving. Source roads/courts/buildings carry their own vector materials;
    // preserve the local mineral/organic substrate beneath all three.
    if(occupation===Occupation.Crop)groundWeights=[[M['cultivated-soil'],1]];
    const groundComposition=dominantMaterialPair(groundWeights);
    const blocked=water!==WaterClass.Dry||occupation===Occupation.Road||occupation===Occupation.Yard||occupation===Occupation.Built;
    const deadLitter=blocked?0:clamp(f.litter[i]*1.35)*(1-rockCover);
    const shrubs=blocked?0:clamp(f.shrubCover[i])*Math.max(0,1-rockCover-deadLitter);
    const herbs=blocked?0:clamp(f.grassCover[i])*Math.max(0,1-rockCover-deadLitter-shrubs);
    const opacity=clamp(deadLitter+shrubs+herbs);
    const lowWeights:Array<[number,number]>=opacity>0?[[M['forest-litter'],deadLitter],[M['vegetation-litter'],shrubs+herbs]]:[[M['forest-litter'],1]];
    const lowComposition=dominantMaterialPair(lowWeights);
    for(const [prefix,pair] of [['ground',groundComposition],['lowCover',lowComposition]] as const){
      f[`${prefix}Material`]![i]=pair.primary;f[`${prefix}MaterialSecondary`]![i]=pair.secondary;f[`${prefix}MaterialBlend`]![i]=pair.blend;
      const weights=prefix==='ground'?groundWeights:lowWeights,total=weights.reduce((sum,[,v])=>sum+v,0),mean=[0,0,0];
      for(const[id,v]of weights){const recipe=materials[id],color=materialColor(recipe,prefix==='ground'&&recipe.family!=='gravity'?bed:source);for(let c=0;c<3;c++)mean[c]+=color[c]*v/total;}
      f[`${prefix}MaterialMeanColor`]![i]=packMaterialMean(mean);
    }
    f.lowCoverOpacity![i]=opacity;
  }
  const terrainVersion = fingerprint(t), hydrologyVersion = fingerprint(['hydrology-2', terrainVersion, input.hydrology, f.downstream, f.waterClass, f.waterLevelM]);
  const geologyVersion = fingerprint(geology), occupationVersion = fingerprint(input.occupation ?? 'natural');
  const environment = fingerprint([terrainVersion, hydrologyVersion, geologyVersion, climate, input.processes, radii, options.riverAreaThresholdM2 ?? 1_000_000, options.floodplainWidthM ?? 150, options.colluvialDecayLengthM ?? 100, materials.map(m => m.id), SURFACE_PHYSICAL_CONTEXT_VERSION]);
  const population = fingerprint([environment, occupationVersion, input.seed, SURFACE_POPULATION_VERSION].join(':'));
  const materialLibrary = fingerprint(materials), surfaceState = fingerprint(state), surfaceLayers=surfaceLayerFieldsVersion(f)!;
  let estimatedBytes = t.heights.byteLength;
  for (const v of Object.values(f)) estimatedBytes += Array.isArray(v) ? v.reduce((s, a) => s + a.byteLength, 0) : v.byteLength;
  assertNotAborted(options.signal);
  validateFieldFiniteness(f);
  const world: SurfaceWorld = { schemaVersion: SURFACE_SCHEMA_VERSION, compilerVersion: SURFACE_COMPILER_VERSION,
    id: fingerprint([environment, occupationVersion, population, materialLibrary, surfaceState, input.seed, surfaceLayers].join(':')),
    seed: input.seed, units: 'metres', crs: 'local-xz', bounds: terrainBounds(t),
    versions: { terrain: terrainVersion, hydrology: hydrologyVersion, geology: geologyVersion, environment, occupation: occupationVersion, population, materialLibrary, surfaceState, surfaceLayers },
    surfaceLayers:{version:'surface-layers-1',groundAvailability:'explicit',lowCoverAvailability:'explicit',fieldsVersion:surfaceLayers},
    terrain: t, geology, climate, state, fields: f, materials: materials.map(m => ({ ...m, colorLinear: [...m.colorLinear], compatibleSubstrates: [...m.compatibleSubstrates], compatibleProcesses: [...m.compatibleProcesses] })), topographicRadiiM: [...radii],
    diagnostics: { warnings, assumptions, hydrologyBoundary: boundary, estimatedBytes } };
  attachGeometryDetail(world,options);
  return world;
}

/** Continuous fields bilinear; categorical fields nearest. Soil fractions preserve their simplex under interpolation. */
export function sampleSurface(world: SurfaceWorld, x: number, z: number): SurfaceSample {
  const b = world.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) throw new RangeError('Surface sample outside canonical terrain');
  const context = getCanonicalSurfaceContext(world), f = context.fields;
  const sampler = gridSampler(context.grid, x, z), i = sampler.nearest;
  const bilinear = sampler.continuous;
  const composition = sampleMaterialComposition(f, sampler.indices, sampler.weights);
  const layersAvailable=hasExplicitSurfaceLayers(f);
  const ground=layersAvailable?sampleMaterialComposition(f,sampler.indices,sampler.weights,'ground'):undefined;
  const low=layersAvailable?sampleMaterialComposition(f,sampler.indices,sampler.weights,'lowCover'):undefined;
  const rock = world.geology.units.find(r => r.id === f.bedrock[i])!;
  const layerSample=(pair:NonNullable<typeof ground>)=>({material:world.materials[pair.primary],materialSecondary:world.materials[pair.secondary],materialBlend:pair.blend,meanColorLinear:pair.mean});
  return { x, z, surfaceLayers:{version:'surface-layers-1',groundAvailability:ground?'explicit':'legacy-composite-unavailable',
    ground:ground?layerSample(ground):undefined,lowCover:low?{...layerSample(low),opacity:bilinear(f.lowCoverOpacity!)}:undefined,
    lowCoverPotential:{grass:bilinear(f.grassCover),shrub:bilinear(f.shrubCover),deadLitter:bilinear(f.litter)},trees:{crownCover:bilinear(f.treeCover),populationFamily:'tree'}},
    localGeometry: world.geometryDetail ? sampleSurfaceGeometryDetail(world.geometryDetail,x,z) : undefined, heightM: sampleTerrainHeight(world.terrain, x, z), slope: bilinear(f.slope), aspect: f.aspect[i], curvature: bilinear(f.curvature),
    landform: f.landform[i], bedrock: rock, sourceRock: world.geology.units.find(r => r.id === f.sourceRock[i])!, depositOrigin: f.depositOrigin[i],
    depositDepthM: bilinear(f.depositDepthM), sand: bilinear(f.sand), silt: bilinear(f.silt), clay: bilinear(f.clay), organic: bilinear(f.organic),
    stoniness: bilinear(f.stoniness), soilDepthM: bilinear(f.soilDepthM), moisture: bilinear(f.moisture), contributingAreaM2: bilinear(f.contributingAreaM2),
    handM: bilinear(f.handM), distanceToWaterM: bilinear(f.distanceToWaterM), waterClass: f.waterClass[i], waterLevelM: f.waterLevelM[i],
    drainageCell: f.drainageCell[i], edgeConfidence: bilinear(f.edgeConfidence),
    temperatureC: bilinear(f.temperatureC), precipitationMm: bilinear(f.precipitationMm), treeCover: bilinear(f.treeCover), grassCover: bilinear(f.grassCover),
    shrubCover: bilinear(f.shrubCover), litter: bilinear(f.litter), occupation: f.occupation[i], orientation: f.orientation[i], snow: bilinear(f.snow),
    wetness: bilinear(f.wetness), material: world.materials[composition.primary], materialSecondary: world.materials[composition.secondary], materialBlend: composition.blend,
    materialMeanColorLinear: composition.mean,
    provenance: world.geology.units.map((r, u) => ({ unitId: r.id, fraction: f.provenance[u][i] })),
    transportedProvenance: world.geology.units.map((r, u) => ({ unitId: r.id, fraction: f.transportedProvenance[u][i] })) };
}

/** Plain JSON arrays for neutral consumers. Non-finite water level/distance are represented by null. */
export function serializeSurfaceWorld(world: SurfaceWorld, options: { includeCanonicalContext?: boolean; maxJsonCharacters?: number } = {}): string {
  const budget = options.maxJsonCharacters ?? 128 * 1024 * 1024;
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('maxJsonCharacters must be finite and positive');
  let estimated = 0;
  const count = (value: unknown, key = ''): void => {
    if (key === 'canonicalContext' && options.includeCanonicalContext === false) return;
    if (ArrayBuffer.isView(value)) estimated += (value as unknown as ArrayLike<number>).length * 24 + 2;
    else if (Array.isArray(value)) for (const item of value) count(item);
    else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) { estimated += name.length + 4; count(item, name); }
    else estimated += typeof value === 'string' ? value.length * 6 + 2 : 24;
    if (estimated > budget) throw new Error('SurfaceWorld exceeds the safe JSON serialization budget; use the binary SurfaceWorld container instead');
  };
  count(world);
  return JSON.stringify(world, (key, value) => key === 'canonicalContext' && options.includeCanonicalContext === false ? undefined
    : ArrayBuffer.isView(value) ? Array.from(value as unknown as number[]) : value);
}

export interface SurfaceHydrationOptions {
  resolveCanonicalContext?: (reference: CanonicalSurfaceContextRef) => CanonicalSurfaceContext | undefined;
  memoryBudgetBytes?: number;
}
export function deserializeSurfaceWorld(json: string, options: SurfaceHydrationOptions = {}): SurfaceWorld {
  return hydrateSurfaceWorld(JSON.parse(json), options);
}

/** Validate JSON arrays or binary-decoded typed arrays directly; no stringify/parse intermediate. */
export function hydrateSurfaceWorld(value: unknown, options: SurfaceHydrationOptions = {}): SurfaceWorld {
  if (!value || typeof value !== 'object') throw new Error('Malformed SurfaceWorld object');
  const w = value as SurfaceWorld;
  if (w.schemaVersion !== SURFACE_SCHEMA_VERSION || w.units !== 'metres' || w.crs !== 'local-xz') throw new Error('Unsupported SurfaceWorld schema or units');
  if (!Number.isSafeInteger(w.seed) || !Array.isArray(w.topographicRadiiM) || !w.topographicRadiiM.length || w.topographicRadiiM.length > 16 || w.topographicRadiiM.some((r, i) => !Number.isFinite(r) || r <= 0 || i > 0 && r < w.topographicRadiiM[i - 1])) throw new Error('Invalid SurfaceWorld seed/radii');
  validateGridGeometry(w.terrain);
  if (w.canonicalContext) validateGridGeometry(w.canonicalContext.grid);
  const canonicalBytes = w.canonicalContext ? estimateSurfaceCompileBytes(w.canonicalContext.grid, w.geology.units.length, w.topographicRadiiM.length) : 0;
  assertMemoryBudget(estimateSurfaceCompileBytes(w.terrain, w.geology.units.length, w.topographicRadiiM.length) + canonicalBytes, options.memoryBudgetBytes);
  assertNumericArray(w.terrain.heights, w.terrain.width * w.terrain.height, 'terrain heights', v => Number.isFinite(v), 'Float32Array');
  w.terrain.heights = new Float32Array(w.terrain.heights);
  validateGrid(w.terrain);
  const n = w.terrain.heights.length;
  assertNumericArray(w.geology.bedrock, n, 'geology.bedrock', v => Number.isInteger(v) && v >= 1 && v <= 65535, 'Uint16Array');
  w.geology.bedrock = new Uint16Array(w.geology.bedrock);
  validateGeology(w.geology);
  createMaterialIndex(w.materials);
  for (const key of ['temperatureC', 'precipitationMm'] as const) if (w.climate[key]) {
    assertNumericArray(w.climate[key]!, n, 'climate.' + key, v => Number.isFinite(v) && (key !== 'precipitationMm' || v >= 0), 'Float32Array');
    w.climate[key] = new Float32Array(w.climate[key]!);
  }
  if (!w.versions || ['terrain', 'hydrology', 'geology', 'environment', 'occupation', 'population', 'materialLibrary', 'surfaceState'].some(key => typeof w.versions[key as keyof typeof w.versions] !== 'string' || !w.versions[key as keyof typeof w.versions])) throw new Error('Malformed SurfaceWorld versions');
  const legacy = /^surface-1\.[012]\./.test(w.compilerVersion);
  const contentHash = legacy ? legacyFingerprint : fingerprint, identityHash = legacy ? hashString : fingerprint;
  if (contentHash(w.terrain) !== w.versions.terrain) throw new Error('Terrain version mismatch: data was edited without invalidation');
  const expectedId = w.canonicalContextRef
    ? w.geometryDetail || w.versions.surfaceLayers ? refinedWorldIdentity(w) : identityHash([w.canonicalContextRef.id, w.versions.terrain, contentHash(w.bounds), 'geometry-retarget-1'].join(':'))
    : identityHash([w.versions.environment, w.versions.occupation, w.versions.population, w.versions.materialLibrary, w.versions.surfaceState, w.seed,...(w.versions.surfaceLayers?[w.versions.surfaceLayers]:[])].join(':'));
  if (w.id !== expectedId) throw new Error('SurfaceWorld id/version mismatch');
  restoreFields(w.fields, w.terrain.heights.length, w);
  if (w.canonicalContext) {
    validateGridGeometry(w.canonicalContext.grid);
    restoreFields(w.canonicalContext.fields, w.canonicalContext.grid.width * w.canonicalContext.grid.height, w);
  } else if (w.canonicalContextRef && options.resolveCanonicalContext) w.canonicalContext = options.resolveCanonicalContext(w.canonicalContextRef);
  if (w.canonicalContext) validateContextReference(w.canonicalContext, w.canonicalContextRef, w.versions);
  const layerVersion=surfaceLayerFieldsVersion(w.fields),metadata=w.surfaceLayers;
  if(layerVersion){
    if(!metadata||metadata.version!=='surface-layers-1'||metadata.groundAvailability!=='explicit'||metadata.lowCoverAvailability!=='explicit'
      ||metadata.fieldsVersion!==layerVersion||typeof w.versions.surfaceLayers!=='string'||!w.versions.surfaceLayers)throw new Error('Explicit surface layer metadata or field version mismatch');
    const canonicalLayers=w.canonicalContext?.fields??(!w.canonicalContextRef?w.fields:undefined);
    if(canonicalLayers&&surfaceLayerFieldsVersion(canonicalLayers)!==w.versions.surfaceLayers)throw new Error('Canonical surface layer version mismatch');
  }else{
    if(w.versions.surfaceLayers||metadata&&(metadata.version!=='surface-layers-1'||metadata.groundAvailability!=='legacy-composite-unavailable'||metadata.lowCoverAvailability!=='legacy-composite-unavailable'||metadata.fieldsVersion!==undefined))throw new Error('Surface layer metadata claims unavailable bare ground');
    w.surfaceLayers=surfaceLayerMetadata(w.fields);
    if(!w.diagnostics.warnings.includes(LEGACY_SURFACE_LAYERS_WARNING))w.diagnostics.warnings.push(LEGACY_SURFACE_LAYERS_WARNING);
  }
  const canonicalBedrock=w.canonicalContext?.fields.bedrock ?? (!w.canonicalContextRef ? w.geology.bedrock : undefined);
  if(canonicalBedrock && contentHash({...w.geology,bedrock:canonicalBedrock})!==w.versions.geology)throw new Error('Geology version mismatch: data was edited without invalidation');
  if(contentHash(w.materials)!==w.versions.materialLibrary || contentHash(w.state)!==w.versions.surfaceState)throw new Error('Material library or surface state version mismatch');
  if (w.geometryDetail) {
    w.geometryDetail=hydrateSurfaceGeometryDetail(w.geometryDetail,w.terrain,w.canonicalContextRef?.id,options.memoryBudgetBytes);
    if (w.geometryDetail.surfaceConditioning && w.geometryDetail.surfaceConditioning.canonicalEnvironmentVersion!==w.versions.environment) throw new Error('Geometry conditioning differs from the canonical environment version');
    if(w.geometryDetail.surfaceConditioning)for(let i=0;i<n;i++)if(Math.abs(w.geometryDetail.surfaceConditioning.bedrockExposure[i]-conditionedExposure(w,w.geometryDetail,i))>2e-6)throw new Error('Geometry conditioning differs from canonical soils, water or occupation');
    if(!w.canonicalContextRef&&w.geometryDetail.localBedrockUnitId)for(let i=0;i<n;i++)if(w.geology.bedrock[i]!==w.geometryDetail.localBedrockUnitId[i])throw new Error('Hydrated canonical bedrock differs from the explicit source-height scenario');
  }
  return w;
}

function restoreFields(fields: SurfaceFields, n: number, world: SurfaceWorld): void {
  const layerCount=SURFACE_LAYER_FIELDS.filter(key=>fields[key]!==undefined).length;
  if(layerCount!==0&&layerCount!==SURFACE_LAYER_FIELDS.length)throw new Error('Incomplete explicit surface layers');
  if(layerCount){
    for(const key of SURFACE_LAYER_SHORT_FIELDS){assertNumericArray(fields[key]!,n,key,v=>Number.isInteger(v)&&v>=0&&v<world.materials.length,'Uint16Array');if(!(fields[key] instanceof Uint16Array))fields[key]=new Uint16Array(fields[key]!);}
    for(const key of SURFACE_LAYER_FLOAT_FIELDS){assertNumericArray(fields[key]!,n,key,v=>Number.isFinite(v)&&v>=0&&v<=1,'Float32Array');if(!(fields[key] instanceof Float32Array))fields[key]=new Float32Array(fields[key]!);}
    for(const key of SURFACE_LAYER_MEAN_FIELDS){assertNumericArray(fields[key]!,n,key,v=>Number.isInteger(v)&&v>=0&&v<=0xffffff,'Uint32Array');if(!(fields[key] instanceof Uint32Array))fields[key]=new Uint32Array(fields[key]!);}
    for(let i=0;i<n;i++){
      for(const key of ['groundMaterial','groundMaterialSecondary'] as const){const recipe=world.materials[fields[key]![i]];
        if(recipe.surfaceRole&&recipe.surfaceRole!=='ground'||['forest-litter','vegetation-litter','inland-water','marine-water','snow-ice'].includes(recipe.id))throw new Error('Ground layer contains a low-cover, water or seasonal recipe');}
      for(const key of ['lowCoverMaterial','lowCoverMaterialSecondary'] as const){const recipe=world.materials[fields[key]![i]];
        if(recipe.surfaceRole&&recipe.surfaceRole!=='low-cover')throw new Error('Low-cover layer recipe has a different vertical role');}
    }
  }
  // Additive schema1 extension: old packets explicitly remain single-material compositions.
  const legacy = fields.materialSecondary === undefined && fields.materialBlend === undefined && fields.materialMeanColor === undefined;
  if (legacy) {
    fields.materialSecondary = Array.from(fields.material) as unknown as Uint16Array;
    fields.materialBlend = new Array(n).fill(0) as unknown as Float32Array;
    fields.materialMeanColor = Array.from(fields.material, (id, i) => {
      const recipe = world.materials[id], rock = world.geology.units.find(r => r.id === fields.sourceRock[i]);
      if (!recipe || !rock) throw new Error('Invalid legacy material/source id');
      return packMaterialMean(materialColor(recipe, rock));
    }) as unknown as Uint32Array;
  }
  const legacyTransport = fields.transportedProvenance === undefined;
  if (legacyTransport) {
    fields.transportedProvenance = fields.provenance.map(a => Array.from(a)) as unknown as Float32Array[];
    fields.drainageCell = new Array(n).fill(-1) as unknown as Int32Array;
    fields.edgeConfidence = new Array(n).fill(0) as unknown as Float32Array;
    world.diagnostics.warnings.push('Legacy packet lacks preserved upstream provenance and edge confidence; transportedProvenance is an explicit legacy surface-provenance approximation.');
  }
  for (const key of FLOAT_FIELDS) {
    const source = fields[key] as unknown as Array<number | null> | Float32Array;
    if ((!Array.isArray(source) && !(source instanceof Float32Array)) || source.length !== n) throw new Error('Malformed SurfaceWorld field ' + key);
    for (const v of source) {
      const sentinel = v === null ? ['waterLevelM', 'handM', 'distanceToWaterM'].includes(key)
        : (key === 'waterLevelM' || key === 'handM') && Number.isNaN(v) || key === 'distanceToWaterM' && v === Infinity;
      if (!sentinel && (typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Malformed non-finite SurfaceWorld field ' + key);
    }
    fields[key] = Float32Array.from(source, v => v === null ? (key === 'distanceToWaterM' ? Infinity : NaN) : key === 'handM' && legacyTransport && v < 0 ? NaN : v);
  }
  const maxByte = { landform: Landform.Valley, waterClass: WaterClass.Ocean, closedBasin: 1, depositOrigin: DepositOrigin.Coastal, occupation: Occupation.Yard };
  for (const key of BYTE_FIELDS) {
    assertNumericArray(fields[key], n, key, v => Number.isInteger(v) && v >= 0 && v <= maxByte[key], 'Uint8Array');
    fields[key] = new Uint8Array(fields[key]);
  }
  const unitIds = new Set(world.geology.units.map(u => u.id));
  for (const key of SHORT_FIELDS) {
    assertNumericArray(fields[key], n, key, v => Number.isInteger(v) && v >= 0 && (key === 'bedrock' || key === 'sourceRock' ? unitIds.has(v) : v < world.materials.length), 'Uint16Array');
    fields[key] = new Uint16Array(fields[key]);
  }
  const canonicalN = world.canonicalContext ? world.canonicalContext.grid.width * world.canonicalContext.grid.height : world.canonicalContextRef ? 16_777_216 : n;
  for (const key of INT_FIELDS) {
    assertNumericArray(fields[key], n, key, v => Number.isInteger(v) && v >= (key === 'basin' ? 0 : -1) && v < (key === 'downstream' ? n : canonicalN), 'Int32Array');
    fields[key] = new Int32Array(fields[key]);
  }
  assertNumericArray(fields.materialMeanColor, n, 'materialMeanColor', v => Number.isInteger(v) && v >= 0 && v <= 0xffffff, 'Uint32Array');
  fields.materialMeanColor = new Uint32Array(fields.materialMeanColor);
  if (fields.topographicPosition.length !== world.topographicRadiiM.length || fields.provenance.length !== world.geology.units.length || fields.transportedProvenance.length !== world.geology.units.length) throw new Error('Malformed SurfaceWorld context layer count');
  fields.topographicPosition = fields.topographicPosition.map(a => { assertNumericArray(a, n, 'topographicPosition', Number.isFinite, 'Float32Array'); return new Float32Array(a); });
  for (const key of ['provenance', 'transportedProvenance'] as const) fields[key] = fields[key].map(a => {
    assertNumericArray(a, n, key, v => Number.isFinite(v) && v >= 0 && v <= 1.000001, 'Float32Array'); return new Float32Array(a);
  });
  for (const [key, a] of Object.entries(fields)) {
    if (Array.isArray(a) ? a.some(v => v.length !== n) : a.length !== n) throw new Error('Malformed SurfaceWorld field ' + key);
  }
  for (let i = 0; i < n; i++) {
    if (fields.material[i] >= world.materials.length || fields.materialSecondary[i] >= world.materials.length || !Number.isFinite(fields.materialBlend[i]) || fields.materialBlend[i] < 0 || fields.materialBlend[i] > 1) throw new Error('Invalid material composition');
    for (const key of ['sand', 'silt', 'clay', 'organic', 'stoniness', 'moisture', 'treeCover', 'grassCover', 'shrubCover', 'litter', 'snow', 'wetness', 'edgeConfidence'] as const) if (fields[key][i] < 0 || fields[key][i] > 1) throw new Error('Invalid physical fraction ' + key);
    if (Math.abs(fields.sand[i] + fields.silt[i] + fields.clay[i] - 1) > .00001) throw new Error('Invalid soil mineral simplex');
    for (const key of ['provenance', 'transportedProvenance'] as const) if (Math.abs(fields[key].reduce((sum, a) => sum + a[i], 0) - 1) > .00001) throw new Error('Invalid provenance simplex');
    if (Number.isFinite(fields.handM[i]) && fields.handM[i] < 0 || fields.distanceToWaterM[i] < 0 || fields.precipitationMm[i] < 0 || fields.contributingAreaM2[i] < 0 || fields.depositDepthM[i] < 0 || fields.soilDepthM[i] < 0) throw new Error('Invalid negative physical field');
    if (fields.waterClass[i] && !Number.isFinite(fields.waterLevelM[i])) throw new Error('Wet cell requires finite water level');
  }
  validateAcyclicRouting(fields.downstream);
}

function assertNumericArray(array: ArrayLike<number>, n: number, label: string, valid: (value: number) => boolean, typedName?: string): void {
  if ((!Array.isArray(array) && !ArrayBuffer.isView(array)) || array.length !== n) throw new Error('Malformed SurfaceWorld field ' + label);
  if (typedName && ArrayBuffer.isView(array) && array.constructor.name !== typedName) throw new Error('Wrong typed array for ' + label + ': expected ' + typedName);
  for (let i = 0; i < n; i++) if (typeof array[i] !== 'number' || !valid(array[i])) throw new Error('Invalid SurfaceWorld ' + label);
}

function validateAcyclicRouting(downstream: Int32Array): void {
  const n = downstream.length, incoming = new Uint32Array(n), queue = new Int32Array(n);
  for (let i = 0; i < n; i++) if (downstream[i] >= 0) {
    if (downstream[i] >= n || downstream[i] === i) throw new Error('Invalid downstream index');
    incoming[downstream[i]]++;
  }
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (!incoming[i]) queue[tail++] = i;
  while (head < tail) { const j = downstream[queue[head++]]; if (j >= 0 && !--incoming[j]) queue[tail++] = j; }
  if (tail !== n) throw new Error('SurfaceWorld downstream cycle');
}

function validateFieldFiniteness(fields: SurfaceFields): void {
  if(hasExplicitSurfaceLayers(fields))for(const key of SURFACE_LAYER_FLOAT_FIELDS)for(const value of fields[key])if(!Number.isFinite(value)||value<0||value>1)throw new Error('Invalid explicit surface layer fraction '+key);
  for (const key of FLOAT_FIELDS) for (const value of fields[key]) {
    if (Number.isFinite(value)) continue;
    if ((key === 'waterLevelM' || key === 'handM') && Number.isNaN(value) || key === 'distanceToWaterM' && value === Infinity) continue;
    throw new Error('Non-finite compiled physical field ' + key);
  }
  for (const layer of [...fields.topographicPosition, ...fields.provenance, ...fields.transportedProvenance]) for (const value of layer) if (!Number.isFinite(value)) throw new Error('Non-finite compiled context mixture');
}

function validateGridGeometry(grid: SurfaceGridGeometry): void {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || grid.width * grid.height > 16_777_216
    || !Number.isFinite(grid.originX) || !Number.isFinite(grid.originZ) || !Number.isFinite(grid.spacingM) || grid.spacingM <= 0) throw new Error('Invalid canonical context grid');
}

function gridSampler(t: SurfaceGridGeometry, x: number, z: number): { nearest: number; indices: number[]; weights: number[]; continuous: (a: Float32Array) => number } {
  const gx = clamp((x - t.originX) / t.spacingM, 0, t.width - 1), gz = clamp((z - t.originZ) / t.spacingM, 0, t.height - 1);
  const x0 = Math.min(t.width - 2, Math.floor(gx)), z0 = Math.min(t.height - 2, Math.floor(gz));
  const fx = gx - x0, fz = gz - z0, nearest = Math.round(gz) * t.width + Math.round(gx), p = z0 * t.width + x0;
  return { nearest, indices: [p, p + 1, p + t.width, p + t.width + 1], weights: [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz], continuous: a => {
    const values = [a[p], a[p + 1], a[p + t.width], a[p + t.width + 1]];
    if (!values.every(Number.isFinite)) return a[nearest];
    return (values[0] * (1 - fx) + values[1] * fx) * (1 - fz) + (values[2] * (1 - fx) + values[3] * fx) * fz;
  } };
}

function sampleMaterialComposition(fields: SurfaceFields, indices: number[], weights: number[], layer?:'ground'|'lowCover'): MaterialComposition & { mean: [number, number, number] } {
  const primary=layer?fields[`${layer}Material`]!:fields.material,secondary=layer?fields[`${layer}MaterialSecondary`]!:fields.materialSecondary,
    blends=layer?fields[`${layer}MaterialBlend`]!:fields.materialBlend,means=layer?fields[`${layer}MaterialMeanColor`]!:fields.materialMeanColor;
  // Low cover is an RGBA layer. Transparent texels contribute neither colour
  // nor recipe/roughness; normalise only after spatial*opacity accumulation.
  const coverageWeights=layer==='lowCover'?weights.map((weight,corner)=>weight*fields.lowCoverOpacity![indices[corner]]):weights;
  const coverageSum=coverageWeights.reduce((sum,weight)=>sum+weight,0);
  if(layer==='lowCover'&&coverageSum===0)return{primary:primary[indices[0]],secondary:primary[indices[0]],blend:0,mean:[0,0,0]};
  const entries: Array<[number, number]> = [], mean: [number, number, number] = [0, 0, 0];
  for (let corner = 0; corner < 4; corner++) {
    const i = indices[corner], weight = layer==='lowCover'?coverageWeights[corner]/coverageSum:weights[corner], blend = blends[i];
    entries.push([primary[i], weight * (1 - blend)], [secondary[i], weight * blend]);
    const color = unpackMaterialMean(means[i]);
    for (let channel = 0; channel < 3; channel++) mean[channel] += color[channel] * weight;
  }
  return { ...dominantMaterialPair(entries), mean };
}

function contextReference(context: CanonicalSurfaceContext): CanonicalSurfaceContextRef {
  const v = context.versions;
  return { id: context.id, environmentVersion: v.environment, occupationVersion: v.occupation, materialLibraryVersion: v.materialLibrary, surfaceStateVersion: v.surfaceState, populationVersion: v.population, ...(v.surfaceLayers?{surfaceLayersVersion:v.surfaceLayers}:{}) };
}

function validateContextReference(context: CanonicalSurfaceContext, reference: CanonicalSurfaceContextRef | undefined, versions: SurfaceWorld['versions']): void {
  if (!reference || fingerprint(contextReference(context)) !== fingerprint(reference)
    || context.versions.environment !== versions.environment || context.versions.occupation !== versions.occupation
    || context.versions.hydrology !== versions.hydrology || context.versions.geology !== versions.geology
    || context.versions.materialLibrary !== versions.materialLibrary || context.versions.surfaceState !== versions.surfaceState
    || context.versions.population !== versions.population || context.versions.surfaceLayers!==versions.surfaceLayers) throw new Error('Canonical context identity/version mismatch');
}

/** The returned arrays are borrowed read-only. Missing references never silently fall back to approximate projected fields. */
export function getCanonicalSurfaceContext(world: SurfaceWorld): CanonicalSurfaceContext {
  if (world.canonicalContextRef) {
    if (!world.canonicalContext) throw new Error('Canonical surface context unavailable; resolve canonicalContextRef before exact sampling or population generation');
    validateContextReference(world.canonicalContext, world.canonicalContextRef, world.versions);
    return world.canonicalContext;
  }
  const { width, height, originX, originZ, spacingM, source } = world.terrain;
  return { id: fingerprint([world.id, 'canonical-context-1'].join(':')), grid: { width, height, originX, originZ, spacingM }, bounds: { ...terrainBounds(world.terrain) }, source: { ...source }, versions: { ...world.versions }, fields: world.fields };
}

export interface RetargetSurfaceOptions {
  signal?: AbortSignal;
  /** Active bounds inside fine sample bounds. Allows source padding outside the canonical footprint. */
  bounds?: Bounds;
  expectedEnvironmentVersion?: string;
  expectedTerrainVersion?: string;
  memoryBudgetBytes?: number;
}

function assertBounds(bounds: Bounds, within: Bounds, label: string): void {
  if (![bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ].every(Number.isFinite) || bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ
    || bounds.minX < within.minX || bounds.maxX > within.maxX || bounds.minZ < within.minZ || bounds.maxZ > within.maxZ) throw new RangeError(label);
}

/** Geometry-only refinement: fixed canonical context, source-native heights and new terrain identity. No terrain/environment generator runs here. */
export function retargetSurfaceWorld(baseWorld: SurfaceWorld, fineTerrain: TerrainGrid, options: RetargetSurfaceOptions = {}): SurfaceWorld {
  assertNotAborted(options.signal);
  if (baseWorld.schemaVersion !== SURFACE_SCHEMA_VERSION || baseWorld.units !== 'metres' || baseWorld.crs !== 'local-xz') throw new Error('Unsupported base SurfaceWorld schema or units');
  validateGrid(fineTerrain);
  const context = getCanonicalSurfaceContext(baseWorld), source = context.source;
  assertMemoryBudget(estimateSurfaceCompileBytes(fineTerrain, context.fields.provenance.length, context.fields.topographicPosition.length), options.memoryBudgetBytes);
  if (fineTerrain.source.id !== source.id || fineTerrain.source.version !== source.version) throw new Error('Terrain refinement source identity/version differs from canonical source; explicitly rebuild context after a source edit');
  if (options.expectedEnvironmentVersion !== undefined && options.expectedEnvironmentVersion !== baseWorld.versions.environment) throw new Error('Stale canonical environment version');
  if (options.expectedTerrainVersion !== undefined && options.expectedTerrainVersion !== baseWorld.versions.terrain) throw new Error('Stale base terrain version');
  const terrain = { ...fineTerrain, source: { ...fineTerrain.source }, heights: new Float32Array(fineTerrain.heights) };
  const fineBounds = terrainBounds(terrain), bounds = { ...(options.bounds ?? fineBounds) }, half = context.grid.spacingM / 2;
  const footprint = { minX: context.bounds.minX - half, minZ: context.bounds.minZ - half, maxX: context.bounds.maxX + half, maxZ: context.bounds.maxZ + half };
  assertBounds(bounds, fineBounds, 'Active refinement bounds exceed fine terrain sample centres');
  assertBounds(bounds, footprint, 'Active refinement bounds exceed canonical source footprint');
  const n = terrain.width * terrain.height, sourceFields = context.fields;
  const fields = createFields(n, sourceFields.topographicPosition.length, sourceFields.provenance.length,hasExplicitSurfaceLayers(sourceFields));
  const sourceLayers=hasExplicitSurfaceLayers(sourceFields)?sourceFields:undefined,projectedLayers=hasExplicitSurfaceLayers(fields)?fields:undefined;
  for (let i = 0; i < n; i++) {
    if (!(i % 4096)) assertNotAborted(options.signal);
    const x = terrain.originX + i % terrain.width * terrain.spacingM, z = terrain.originZ + Math.floor(i / terrain.width) * terrain.spacingM;
    const sample = gridSampler(context.grid, x, z), j = sample.nearest;
    for (const key of FLOAT_FIELDS) fields[key][i] = key === 'waterLevelM' || key === 'aspect' || key === 'orientation' || key === 'handM' ? sourceFields[key][j] : sample.continuous(sourceFields[key]);
    for (const key of BYTE_FIELDS) fields[key][i] = sourceFields[key][j];
    for (const key of SHORT_FIELDS) fields[key][i] = sourceFields[key][j];
    const composition = sampleMaterialComposition(sourceFields, sample.indices, sample.weights);
    fields.material[i] = composition.primary; fields.materialSecondary[i] = composition.secondary; fields.materialBlend[i] = composition.blend;
    fields.materialMeanColor[i] = packMaterialMean(composition.mean);
    if(sourceLayers&&projectedLayers){
      for(const prefix of ['ground','lowCover'] as const){const pair=sampleMaterialComposition(sourceFields,sample.indices,sample.weights,prefix);
        projectedLayers[`${prefix}Material`][i]=pair.primary;projectedLayers[`${prefix}MaterialSecondary`][i]=pair.secondary;projectedLayers[`${prefix}MaterialBlend`][i]=pair.blend;projectedLayers[`${prefix}MaterialMeanColor`][i]=packMaterialMean(pair.mean);}
      projectedLayers.lowCoverOpacity[i]=sample.continuous(sourceLayers.lowCoverOpacity);
    }
    fields.basin[i] = sourceFields.basin[j];
    fields.drainageCell[i] = sourceFields.drainageCell[j];
    // Project graph addresses only when their canonical target is inside this patch. The authoritative graph stays in canonicalContext.
    const downstream = sourceFields.downstream[j];
    if (downstream >= 0) {
      const dx = context.grid.originX + downstream % context.grid.width * context.grid.spacingM;
      const dz = context.grid.originZ + Math.floor(downstream / context.grid.width) * context.grid.spacingM;
      if (dx >= fineBounds.minX && dx <= fineBounds.maxX && dz >= fineBounds.minZ && dz <= fineBounds.maxZ) {
        const index = Math.round((dz - terrain.originZ) / terrain.spacingM) * terrain.width + Math.round((dx - terrain.originX) / terrain.spacingM);
        if (index !== i) fields.downstream[i] = index;
      }
    }
    const mineralSum = fields.sand[i] + fields.silt[i] + fields.clay[i];
    if (!(mineralSum > 0)) throw new Error('Invalid canonical mineral fractions');
    fields.sand[i] /= mineralSum; fields.silt[i] /= mineralSum; fields.clay[i] /= mineralSum;
    for (let layer = 0; layer < fields.topographicPosition.length; layer++) fields.topographicPosition[layer][i] = sample.continuous(sourceFields.topographicPosition[layer]);
    let sum = 0;
    for (let unit = 0; unit < fields.provenance.length; unit++) {
      fields.provenance[unit][i] = sourceFields.provenance[unit][j]; sum += fields.provenance[unit][i];
      fields.transportedProvenance[unit][i] = sourceFields.transportedProvenance[unit][j];
    }
    if (!(sum > 0)) throw new Error('Invalid canonical provenance fractions');
    for (const fractions of fields.provenance) fractions[i] /= sum;
  }
  const terrainVersion = fingerprint(terrain), reference = contextReference(context);
  const versions = { ...baseWorld.versions, terrain: terrainVersion };
  const geology = { ...baseWorld.geology, bedrock: new Uint16Array(fields.bedrock) };
  const climate = { ...baseWorld.climate,
    temperatureC: baseWorld.climate.temperatureC ? new Float32Array(fields.temperatureC) : undefined,
    precipitationMm: baseWorld.climate.precipitationMm ? new Float32Array(fields.precipitationMm) : undefined };
  let estimatedBytes = terrain.heights.byteLength;
  for (const array of Object.values(fields)) estimatedBytes += Array.isArray(array) ? array.reduce((sum, a) => sum + a.byteLength, 0) : array.byteLength;
  const warnings = [...baseWorld.diagnostics.warnings];
  if (fields.waterClass.some((water, i) => water !== WaterClass.Dry && terrain.heights[i] > fields.waterLevelM[i] + .001)) warnings.push('Refined bed rises above a canonical water level in some wet cells; canonical water is preserved and this support conflict requires source reconciliation.');
  if (fineBounds.minX < footprint.minX || fineBounds.maxX > footprint.maxX || fineBounds.minZ < footprint.minZ || fineBounds.maxZ > footprint.maxZ) warnings.push('Fine source contains padding outside canonical footprint; projected padding context is clamped and excluded from active bounds.');
  assertNotAborted(options.signal);
  const result: SurfaceWorld = { ...baseWorld, compilerVersion: SURFACE_COMPILER_VERSION, id: '', geometryDetail: undefined,
    bounds, terrain, fields, geology, climate, versions, surfaceLayers:surfaceLayerMetadata(fields), canonicalContext: context, canonicalContextRef: reference,
    state: { ...baseWorld.state }, topographicRadiiM: [...baseWorld.topographicRadiiM],
    diagnostics: { ...baseWorld.diagnostics, warnings, assumptions: [...baseWorld.diagnostics.assumptions,
      'Geometry refined without recompiling canonical context. Projected fields are renderer samples; exact CPU context and population eligibility resolve canonicalContext.',
      'Projected downstream indices are patch-local references; -1 may mean an exterior target. Canonical graph and basin identities remain authoritative.',
      'estimatedBytes counts this projection and source heights, excluding the borrowed canonical context.'], estimatedBytes } };
  attachGeometryDetail(result,options);
  result.id=refinedWorldIdentity(result);
  return result;
}

const GEOMETRY_CONDITIONING_VERSION = 'surface-conditioning-1' as const;
function conditionedExposure(world:SurfaceWorld,detail:NonNullable<SurfaceWorld['geometryDetail']>,i:number):number {
  const f=world.fields;
  if(f.waterClass[i]!==WaterClass.Dry||f.occupation[i]>=Occupation.Crop)return 0;
  const regolith=f.soilDepthM[i]+f.depositDepthM[i];
  const susceptibility=clamp((0.2+f.stoniness[i]*0.8)/(1+regolith/0.5));
  const t=clamp((detail.slopeRadians[i]-55*Math.PI/180)/(17*Math.PI/180)),cliff=t*t*(3-2*t);
  return Math.max(detail.rockExposurePotential[i]*susceptibility,cliff)*detail.edgeConfidence[i];
}
function refinedWorldIdentity(world: SurfaceWorld): string {
  const prefix=[world.canonicalContextRef!.id,world.versions.terrain,fingerprint(world.bounds)];
  if(world.versions.surfaceLayers)prefix.push(world.surfaceLayers?.fieldsVersion??'');
  const detail=world.geometryDetail;
  return fingerprint((detail ? [...prefix,detail.id,detail.surfaceConditioning?.version ?? '', 'geometry-retarget-2'] : [...prefix,'geometry-retarget-1']).join(':'));
}
function attachGeometryDetail(world: SurfaceWorld, options: {signal?: AbortSignal;memoryBudgetBytes?:number}): void {
  const detail=deriveSurfaceGeometryDetail(world.terrain,{canonicalContextId:world.canonicalContextRef?.id,geologyScenario:world.geology.scenario,
    signal:options.signal,memoryBudgetBytes:Math.max(1,(options.memoryBudgetBytes??SURFACE_MEMORY_BUDGET_BYTES)-world.diagnostics.estimatedBytes)});
  if(!world.canonicalContextRef&&detail.localBedrockUnitId)for(let i=0;i<world.geology.bedrock.length;i++)if(world.geology.bedrock[i]!==detail.localBedrockUnitId[i])throw new Error('Canonical bedrock differs from the explicit geological scenario on source heights');
  const conditioned=new Float32Array(world.terrain.width*world.terrain.height);
  for(let i=0;i<conditioned.length;i++) {
    if(!(i%4096))assertNotAborted(options.signal);
    // Geometric potential is not an observation of bare soil: retain the source
    // regolith/deposits, hydrology and accepted occupation as conditioning data.
    conditioned[i]=conditionedExposure(world,detail,i);
  }
  world.geometryDetail={...detail,surfaceConditioning:{version:GEOMETRY_CONDITIONING_VERSION,canonicalEnvironmentVersion:world.versions.environment,bedrockExposure:conditioned}};
  world.diagnostics.estimatedBytes+=conditioned.byteLength+Object.values(detail).reduce((sum,v)=>sum+(ArrayBuffer.isView(v)?v.byteLength:0),0);
}
