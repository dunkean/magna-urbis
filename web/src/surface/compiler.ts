import {
  SURFACE_COMPILER_VERSION, SURFACE_POPULATION_VERSION, SURFACE_SCHEMA_VERSION, DepositOrigin, Landform, Occupation, WaterClass,
  assertNotAborted, clamp, hashString, terrainBounds,
  type CompileOptions, type SurfaceCompileInput, type SurfaceFields, type SurfaceSample, type SurfaceWorld,
  type Bounds, type CanonicalSurfaceContext, type CanonicalSurfaceContextRef, type ClimateInput, type GeologyInput, type SurfaceGridGeometry, type TerrainGrid,
} from './model';
import { DEFAULT_ROCK_UNITS, SURFACE_MATERIALS } from './materials';

/** Hash includes content and shape, not merely source labels (edit-safe cache invalidation). */
function fingerprint(value: unknown): string {
  let hash = 2166136261;
  const feed = (text: string) => { for (let j = 0; j < text.length; j++) hash = Math.imul(hash ^ text.charCodeAt(j), 16777619); };
  const walk = (v: unknown): void => {
    if (ArrayBuffer.isView(v)) {
      feed(v.constructor.name + ':' + v.byteLength + ':');
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      for (let j = 0; j < bytes.length; j++) hash = Math.imul(hash ^ bytes[j], 16777619);
    } else if (Array.isArray(v)) { feed('['); for (const x of v) walk(x); feed(']'); }
    else if (v && typeof v === 'object') {
      feed('{'); for (const key of Object.keys(v).sort()) { feed(key + ':'); walk((v as Record<string, unknown>)[key]); } feed('}');
    } else feed(typeof v + ':' + String(v) + ';');
  };
  walk(value);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function validateGrid(t: TerrainGrid): void {
  if (!Number.isInteger(t.width) || !Number.isInteger(t.height) || t.width < 2 || t.height < 2 || t.width * t.height > 16_777_216) throw new Error('Terrain grid dimensions must be 2..16777216 samples');
  if (!Number.isFinite(t.spacingM) || t.spacingM <= 0 || !Number.isFinite(t.originX) || !Number.isFinite(t.originZ)) throw new Error('Terrain coordinates and spacing must be finite metres');
  if (t.heights.length !== t.width * t.height) throw new Error('Terrain heights length does not match grid');
  if (!t.source.id || !t.source.version || !Number.isFinite(t.source.sourceLOD) || !(t.source.nativeSpacingM > 0)) throw new Error('Terrain source identity, sourceLOD and native spacing are required');
  for (const h of t.heights) if (!Number.isFinite(h)) throw new Error('Terrain height must be finite');
}

const FLOAT_FIELDS = ['slope', 'aspect', 'curvature', 'contributingAreaM2', 'waterLevelM', 'distanceToWaterM', 'handM', 'twi',
  'depositDepthM', 'sand', 'silt', 'clay', 'organic', 'stoniness', 'soilDepthM', 'moisture', 'temperatureC', 'precipitationMm',
  'treeCover', 'grassCover', 'shrubCover', 'litter', 'orientation', 'snow', 'wetness'] as const;
const BYTE_FIELDS = ['landform', 'waterClass', 'closedBasin', 'depositOrigin', 'occupation'] as const;
const SHORT_FIELDS = ['bedrock', 'sourceRock', 'material'] as const;
const INT_FIELDS = ['downstream', 'basin'] as const;
function createFields(n: number, radii: number, units: number): SurfaceFields {
  const f = {} as SurfaceFields;
  for (const key of FLOAT_FIELDS) f[key] = new Float32Array(n);
  for (const key of BYTE_FIELDS) f[key] = new Uint8Array(n);
  for (const key of SHORT_FIELDS) f[key] = new Uint16Array(n);
  for (const key of INT_FIELDS) f[key] = new Int32Array(n);
  f.topographicPosition = Array.from({ length: radii }, () => new Float32Array(n));
  f.provenance = Array.from({ length: units }, () => new Float32Array(n));
  f.waterLevelM.fill(NaN); f.handM.fill(-1); f.distanceToWaterM.fill(Infinity); f.downstream.fill(-1);
  return f;
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
}

function validateGeology(g: GeologyInput): Map<number, number> {
  if (!g.units.length || g.units.length > 64) throw new Error('Geology requires 1..64 explicit units');
  const ids = new Map<number, number>();
  g.units.forEach((r, j) => {
    if (!Number.isInteger(r.id) || r.id < 1 || r.id > 65535 || ids.has(r.id)) throw new Error('Geology ids must be unique uint16 values');
    for (const fraction of [r.sand, r.silt, r.clay, r.hardness, r.weatherability]) if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('Invalid rock-unit fractions/properties');
    if (Math.abs(r.sand + r.silt + r.clay - 1) > .00001) throw new Error('Rock mineral sand+silt+clay must sum to one');
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
      f.curvature[i] = (at(x - 1, z) + at(x + 1, z) + at(x, z - 1) + at(x, z + 1) - 4 * a[i]) / (d * d);
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
        f.topographicPosition[layer][z * w + x] = a[z * w + x] - sum / ((x1 - x0) * (z1 - z0));
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

function drainage(input: SurfaceCompileInput, f: SurfaceFields, ids: Map<number, number>, signal?: AbortSignal): Int32Array {
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
    f.provenance[ids.get(f.bedrock[i])!][i] = d * d;
  }
  for (const flow of input.hydrology?.inflows ?? []) {
    if (!Number.isInteger(flow.cell) || flow.cell < 0 || flow.cell >= n || !Number.isFinite(flow.contributingAreaM2) || flow.contributingAreaM2 < 0) throw new Error('Invalid external inflow');
    if (Math.abs(flow.provenance.reduce((sum, p) => sum + p.fraction, 0) - 1) > .00001) throw new Error('Inflow provenance fractions must sum to one');
    f.contributingAreaM2[flow.cell] += flow.contributingAreaM2;
    for (const p of flow.provenance) {
      const u = ids.get(p.unitId);
      if (u === undefined || !Number.isFinite(p.fraction) || p.fraction < 0) throw new Error('Invalid inflow provenance');
      f.provenance[u][flow.cell] += p.fraction * flow.contributingAreaM2;
    }
  }
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (!incoming[i]) queue[tail++] = i;
  while (head < tail) {
    if (!(head % 16384)) assertNotAborted(signal);
    const i = queue[head++], j = f.downstream[i];
    if (j >= 0) {
      f.contributingAreaM2[j] += f.contributingAreaM2[i];
      for (const p of f.provenance) p[j] += p[i];
      if (!--incoming[j]) queue[tail++] = j;
    }
  }
  if (tail !== n) throw new Error('Authoritative hydrology contains a cycle; export routed lake outlets explicitly');
  // Normalise transported mixtures before optional source-area override (which may include unexported upstream basins).
  for (let i = 0; i < n; i++) for (const p of f.provenance) p[i] /= f.contributingAreaM2[i];
  if (input.hydrology?.contributingAreaM2) {
    for (let i = 0; i < n; i++) {
      const a = input.hydrology.contributingAreaM2[i];
      if (a < 0) throw new Error('Contributing area cannot be negative');
      f.contributingAreaM2[i] = Math.max(d * d, a);
    }
  }
  if (input.hydrology?.waterClass) f.waterClass.set(input.hydrology.waterClass);
  else {
    const threshold = Math.max(12 * d * d, n * d * d * .004);
    for (let i = 0; i < n; i++) if (f.contributingAreaM2[i] >= threshold) f.waterClass[i] = WaterClass.River;
  }
  if (input.hydrology?.waterLevelM) f.waterLevelM.set(input.hydrology.waterLevelM);
  else for (let i = 0; i < n; i++) if (f.waterClass[i]) f.waterLevelM[i] = t.heights[i];
  const drainageElevation = new Float32Array(n).fill(NaN);
  for (let k = n - 1; k >= 0; k--) {
    const i = queue[k], j = f.downstream[i], x = i % w, z = Math.floor(i / w);
    f.basin[i] = j < 0 ? i : f.basin[j];
    f.closedBasin[i] = j < 0 ? Number(f.waterClass[i] !== WaterClass.Ocean && x > 0 && z > 0 && x < w - 1 && z < h - 1) : f.closedBasin[j];
    if (f.waterClass[i]) drainageElevation[i] = t.heights[i];
    else if (j >= 0) drainageElevation[i] = drainageElevation[j];
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
  validateGrid(input.terrain);
  // Snapshot mutable generator buffers: a later streaming update cannot silently edit a versioned world.
  const t: TerrainGrid = { ...input.terrain, source: { ...input.terrain.source }, heights: new Float32Array(input.terrain.heights) };
  input = { ...input, terrain: t };
  const n = t.width * t.height;
  validateAligned(input, n);
  const warnings: string[] = [], assumptions: string[] = [];
  const geology = input.geology ? { ...input.geology, units: input.geology.units.map(u => ({ ...u, colorLinear: [...u.colorLinear] as [number, number, number] })), bedrock: new Uint16Array(input.geology.bedrock) }
    : { version: 'declared-default-granite-1', provenance: 'Explicit default scenario: uniform granitic basement; not inferred from climate', units: [{ ...DEFAULT_ROCK_UNITS[0], colorLinear: [...DEFAULT_ROCK_UNITS[0].colorLinear] as [number, number, number] }], bedrock: new Uint16Array(n).fill(1) };
  if (!input.geology) warnings.push('No geology map supplied: declared uniform granite scenario, not an observed lithology.');
  const ids = validateGeology(geology);
  const climate: ClimateInput = input.climate ? { ...input.climate, temperatureC: input.climate.temperatureC ? new Float32Array(input.climate.temperatureC) : undefined, precipitationMm: input.climate.precipitationMm ? new Float32Array(input.climate.precipitationMm) : undefined }
    : { version: 'temperate-default-1', meanAnnualTempC: 12, annualPrecipMm: 850, seasonalAmplitudeC: 10, referenceElevationM: 0, lapseRateCPerKm: 6.5, windRadians: 0 };
  if (![climate.meanAnnualTempC, climate.annualPrecipMm, climate.seasonalAmplitudeC ?? 0, climate.lapseRateCPerKm ?? 6.5, climate.referenceElevationM ?? 0, climate.windRadians ?? 0].every(Number.isFinite) || climate.annualPrecipMm < 0) throw new Error('Climate must use finite physical degrees C and mm/year');
  const state = { ...(input.state ?? { version: 'summer-default-1', dayOfYear: 200, surfaceWetness: 0, snowWaterEquivalentM: 0 }) };
  if (!Number.isFinite(state.dayOfYear) || state.dayOfYear < 1 || state.dayOfYear > 366 || !Number.isFinite(state.surfaceWetness ?? 0) || !Number.isFinite(state.snowWaterEquivalentM ?? 0)) throw new Error('Invalid seasonal state');
  const radii = options.topographicRadiiM ?? [Math.max(150, t.spacingM * 2), Math.max(600, t.spacingM * 4), Math.max(2000, t.spacingM * 8)];
  if (!radii.length || radii.some(r => !Number.isFinite(r) || r <= 0)) throw new Error('Topographic radii must be positive metres');
  const f = createFields(n, radii.length, geology.units.length);
  f.bedrock.set(geology.bedrock);
  morphology(t, f, radii, options.signal);
  const order = drainage(input, f, ids, options.signal);
  const boundary = input.hydrology?.boundary ?? 'truncated';
  if (!input.hydrology?.downstream) warnings.push('Routing derived by strict downhill D8; flats and closed sinks are retained. Supply source routing for basin-faithful hydrology.');
  if (boundary === 'truncated') warnings.push('Upstream basin is truncated at export boundary; contributing area and provenance omit unknown exterior inputs.');
  if (input.hydrology?.contributingAreaM2 && !input.hydrology.inflows?.length) warnings.push('Source contributing area is preserved; exterior sediment provenance remains unknown without explicit inflows.');
  const maxRadius = Math.max(...radii);
  if (maxRadius > Math.min(t.width - 1, t.height - 1) * t.spacingM / 2) warnings.push('Morphology neighbourhoods reach export edges; clipped neighbourhoods require exterior context for independent tile compilation.');
  assumptions.push('Morphology uses finite differences and multi-radius square-window TPI, not a full geomorphon classifier.', 'Sediment depth, organic content, moisture, TWI/HAND interpretation and cover are synthesis potentials, not a calibrated mass-conserving sediment/pedology simulation.', 'Water proximity is a chamfer distance; HAND follows source drainage. Date alone does not predict discharge or flood levels.', 'Special landforms require declared process masks and existing terrain geometry; surface motifs do not generate dunes, karst, glaciers or volcanic landforms.');
  if (t.spacingM < t.source.nativeSpacingM) warnings.push('Grid is finer than native source spacing; this is reconstruction, not new source terrain detail.');
  if (t.source.sourceLODKnown === false) warnings.push('Generator source LOD was not recorded by the legacy source; numeric sourceLOD is a compatibility placeholder.');
  const colluvium = new Float32Array(n), colluvialSource = new Uint16Array(n), colluvialBest = new Float32Array(n);
  // Route a source-connected gravity potential over the same downhill graph. Deposits have an actual upslope rock source.
  for (const i of order) {
    const rock = geology.units[ids.get(f.bedrock[i])!], steep = clamp((f.slope[i] - .38) / .6);
    const local = steep * rock.hardness;
    if (local > colluvialBest[i]) { colluvialBest[i] = local; colluvialSource[i] = rock.id; }
    colluvium[i] += local;
    const j = f.downstream[i];
    if (j >= 0) {
      const retained = t.heights[j] >= t.heights[i] ? 0 : f.slope[i] < .22 ? .16 : .82;
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
    const alluvial = (hand >= 0 ? Math.exp(-hand / 7) : 0) * Math.exp(-distance / (t.spacingM * 4 + 30)) * flat;
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
        const r = geology.units[u], p = f.provenance[u][i];
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
    const exposure = .5 + .5 * Math.cos(f.aspect[i] - (climate.windRadians ?? 0));
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
    let material = 0;
    if (f.treeCover[i] + f.grassCover[i] > .25) material = 13;
    if (aridity < .45 && f.grassCover[i] < .2) material = 3;
    if (f.stoniness[i] > .48 || s > .7) material = 1;
    if (origin === DepositOrigin.Colluvial) material = 4;
    if (origin === DepositOrigin.Alluvial) material = 7;
    if (moisture > .8 && s < .12) material = 9;
    if (origin === DepositOrigin.Aeolian) material = 2;
    if (input.processes?.karst?.[i] && bed.lithology === 'limestone') material = 5;
    if (input.processes?.volcanic?.[i] || input.processes?.geothermal?.[i]) material = 6;
    if (Math.abs(coastDistance) < 40 && water === WaterClass.Dry) material = origin === DepositOrigin.Coastal ? 10 : 11;
    if (input.processes?.periglacial?.[i] && seasonalTemp < 2) material = 14;
    if (occupation === Occupation.Road || occupation === Occupation.Yard) material = 15;
    if (occupation === Occupation.Crop) material = 16;
    if (occupation === Occupation.Built) material = 17;
    if (f.snow[i] > .3) material = 14;
    if (water === WaterClass.River || water === WaterClass.Lake) material = 8;
    if (water === WaterClass.Ocean) material = 12;
    f.material[i] = material;
  }
  const terrainVersion = fingerprint(t), hydrologyVersion = fingerprint(input.hydrology ?? 'derived-d8-1');
  const geologyVersion = fingerprint(geology), occupationVersion = fingerprint(input.occupation ?? 'natural');
  const environment = fingerprint([terrainVersion, hydrologyVersion, geologyVersion, climate, input.processes, radii, SURFACE_COMPILER_VERSION]);
  const population = hashString([environment, occupationVersion, input.seed, SURFACE_POPULATION_VERSION].join(':'));
  const materialLibrary = fingerprint(SURFACE_MATERIALS), surfaceState = fingerprint(state);
  let estimatedBytes = t.heights.byteLength;
  for (const v of Object.values(f)) estimatedBytes += Array.isArray(v) ? v.reduce((s, a) => s + a.byteLength, 0) : v.byteLength;
  assertNotAborted(options.signal);
  return { schemaVersion: SURFACE_SCHEMA_VERSION, compilerVersion: SURFACE_COMPILER_VERSION,
    id: hashString([environment, occupationVersion, population, materialLibrary, surfaceState, input.seed].join(':')),
    seed: input.seed, units: 'metres', crs: 'local-xz', bounds: terrainBounds(t),
    versions: { terrain: terrainVersion, hydrology: hydrologyVersion, geology: geologyVersion, environment, occupation: occupationVersion, population, materialLibrary, surfaceState },
    terrain: t, geology, climate, state, fields: f, materials: SURFACE_MATERIALS.map(m => ({ ...m, colorLinear: [...m.colorLinear], compatibleSubstrates: [...m.compatibleSubstrates], compatibleProcesses: [...m.compatibleProcesses] })), topographicRadiiM: [...radii],
    diagnostics: { warnings, assumptions, hydrologyBoundary: boundary, estimatedBytes } };
}

/** Continuous fields bilinear; categorical fields nearest. Soil fractions preserve their simplex under interpolation. */
export function sampleSurface(world: SurfaceWorld, x: number, z: number): SurfaceSample {
  const b = world.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) throw new RangeError('Surface sample outside canonical terrain');
  const context = getCanonicalSurfaceContext(world), f = context.fields;
  const sampler = gridSampler(context.grid, x, z), i = sampler.nearest;
  const bilinear = sampler.continuous;
  const rock = world.geology.units.find(r => r.id === f.bedrock[i])!;
  return { x, z, heightM: gridSampler(world.terrain, x, z).continuous(world.terrain.heights), slope: bilinear(f.slope), aspect: f.aspect[i], curvature: bilinear(f.curvature),
    landform: f.landform[i], bedrock: rock, sourceRock: world.geology.units.find(r => r.id === f.sourceRock[i])!, depositOrigin: f.depositOrigin[i],
    depositDepthM: bilinear(f.depositDepthM), sand: bilinear(f.sand), silt: bilinear(f.silt), clay: bilinear(f.clay), organic: bilinear(f.organic),
    stoniness: bilinear(f.stoniness), soilDepthM: bilinear(f.soilDepthM), moisture: bilinear(f.moisture), contributingAreaM2: bilinear(f.contributingAreaM2),
    handM: bilinear(f.handM), distanceToWaterM: bilinear(f.distanceToWaterM), waterClass: f.waterClass[i], waterLevelM: f.waterLevelM[i],
    temperatureC: bilinear(f.temperatureC), precipitationMm: bilinear(f.precipitationMm), treeCover: bilinear(f.treeCover), grassCover: bilinear(f.grassCover),
    shrubCover: bilinear(f.shrubCover), litter: bilinear(f.litter), occupation: f.occupation[i], orientation: f.orientation[i], snow: bilinear(f.snow),
    wetness: bilinear(f.wetness), material: world.materials[f.material[i]],
    provenance: world.geology.units.map((r, u) => ({ unitId: r.id, fraction: f.provenance[u][i] })) };
}

/** Plain JSON arrays for neutral consumers. Non-finite water level/distance are represented by null. */
export function serializeSurfaceWorld(world: SurfaceWorld, options: { includeCanonicalContext?: boolean } = {}): string {
  return JSON.stringify(world, (key, value) => key === 'canonicalContext' && options.includeCanonicalContext === false ? undefined
    : ArrayBuffer.isView(value) ? Array.from(value as unknown as number[]) : value);
}

export function deserializeSurfaceWorld(json: string, options: { resolveCanonicalContext?: (reference: CanonicalSurfaceContextRef) => CanonicalSurfaceContext | undefined } = {}): SurfaceWorld {
  const w = JSON.parse(json) as SurfaceWorld;
  if (w.schemaVersion !== SURFACE_SCHEMA_VERSION || w.units !== 'metres' || w.crs !== 'local-xz') throw new Error('Unsupported SurfaceWorld schema or units');
  w.terrain.heights = new Float32Array(w.terrain.heights);
  validateGrid(w.terrain);
  w.geology.bedrock = new Uint16Array(w.geology.bedrock);
  validateGeology(w.geology);
  if (w.climate.temperatureC) w.climate.temperatureC = new Float32Array(w.climate.temperatureC);
  if (w.climate.precipitationMm) w.climate.precipitationMm = new Float32Array(w.climate.precipitationMm);
  restoreFields(w.fields, w.terrain.heights.length);
  if (w.canonicalContext) {
    validateGridGeometry(w.canonicalContext.grid);
    restoreFields(w.canonicalContext.fields, w.canonicalContext.grid.width * w.canonicalContext.grid.height);
  } else if (w.canonicalContextRef && options.resolveCanonicalContext) w.canonicalContext = options.resolveCanonicalContext(w.canonicalContextRef);
  if (w.canonicalContext) validateContextReference(w.canonicalContext, w.canonicalContextRef, w.versions);
  return w;
}

function restoreFields(fields: SurfaceFields, n: number): void {
  for (const key of FLOAT_FIELDS) {
    const source = fields[key] as unknown as Array<number | null>;
    if (!Array.isArray(source) || source.length !== n) throw new Error('Malformed SurfaceWorld field ' + key);
    fields[key] = Float32Array.from(source, v => v === null ? (key === 'waterLevelM' ? NaN : Infinity) : v);
  }
  for (const key of BYTE_FIELDS) fields[key] = new Uint8Array(fields[key]);
  for (const key of SHORT_FIELDS) fields[key] = new Uint16Array(fields[key]);
  for (const key of INT_FIELDS) fields[key] = new Int32Array(fields[key]);
  fields.topographicPosition = fields.topographicPosition.map(a => new Float32Array(a));
  fields.provenance = fields.provenance.map(a => new Float32Array(a));
  for (const [key, a] of Object.entries(fields)) {
    if (Array.isArray(a) ? a.some(v => v.length !== n) : a.length !== n) throw new Error('Malformed SurfaceWorld field ' + key);
  }
}

function validateGridGeometry(grid: SurfaceGridGeometry): void {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || grid.width * grid.height > 16_777_216
    || !Number.isFinite(grid.originX) || !Number.isFinite(grid.originZ) || !Number.isFinite(grid.spacingM) || grid.spacingM <= 0) throw new Error('Invalid canonical context grid');
}

function gridSampler(t: SurfaceGridGeometry, x: number, z: number): { nearest: number; continuous: (a: Float32Array) => number } {
  const gx = clamp((x - t.originX) / t.spacingM, 0, t.width - 1), gz = clamp((z - t.originZ) / t.spacingM, 0, t.height - 1);
  const x0 = Math.min(t.width - 2, Math.floor(gx)), z0 = Math.min(t.height - 2, Math.floor(gz));
  const fx = gx - x0, fz = gz - z0, nearest = Math.round(gz) * t.width + Math.round(gx), p = z0 * t.width + x0;
  return { nearest, continuous: a => {
    const values = [a[p], a[p + 1], a[p + t.width], a[p + t.width + 1]];
    if (!values.every(Number.isFinite)) return a[nearest];
    return (values[0] * (1 - fx) + values[1] * fx) * (1 - fz) + (values[2] * (1 - fx) + values[3] * fx) * fz;
  } };
}

function contextReference(context: CanonicalSurfaceContext): CanonicalSurfaceContextRef {
  const v = context.versions;
  return { id: context.id, environmentVersion: v.environment, occupationVersion: v.occupation, materialLibraryVersion: v.materialLibrary, surfaceStateVersion: v.surfaceState, populationVersion: v.population };
}

function validateContextReference(context: CanonicalSurfaceContext, reference: CanonicalSurfaceContextRef | undefined, versions: SurfaceWorld['versions']): void {
  if (!reference || fingerprint(contextReference(context)) !== fingerprint(reference)
    || context.versions.environment !== versions.environment || context.versions.occupation !== versions.occupation
    || context.versions.hydrology !== versions.hydrology || context.versions.geology !== versions.geology
    || context.versions.materialLibrary !== versions.materialLibrary || context.versions.surfaceState !== versions.surfaceState
    || context.versions.population !== versions.population) throw new Error('Canonical context identity/version mismatch');
}

/** The returned arrays are borrowed read-only. Missing references never silently fall back to approximate projected fields. */
export function getCanonicalSurfaceContext(world: SurfaceWorld): CanonicalSurfaceContext {
  if (world.canonicalContextRef) {
    if (!world.canonicalContext) throw new Error('Canonical surface context unavailable; resolve canonicalContextRef before exact sampling or population generation');
    validateContextReference(world.canonicalContext, world.canonicalContextRef, world.versions);
    return world.canonicalContext;
  }
  const { width, height, originX, originZ, spacingM, source } = world.terrain;
  return { id: hashString([world.id, 'canonical-context-1'].join(':')), grid: { width, height, originX, originZ, spacingM }, bounds: { ...terrainBounds(world.terrain) }, source: { ...source }, versions: { ...world.versions }, fields: world.fields };
}

export interface RetargetSurfaceOptions {
  signal?: AbortSignal;
  /** Active bounds inside fine sample bounds. Allows source padding outside the canonical footprint. */
  bounds?: Bounds;
  expectedEnvironmentVersion?: string;
  expectedTerrainVersion?: string;
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
  if (fineTerrain.source.id !== source.id || fineTerrain.source.version !== source.version) throw new Error('Terrain refinement source identity/version differs from canonical source; explicitly rebuild context after a source edit');
  if (options.expectedEnvironmentVersion !== undefined && options.expectedEnvironmentVersion !== baseWorld.versions.environment) throw new Error('Stale canonical environment version');
  if (options.expectedTerrainVersion !== undefined && options.expectedTerrainVersion !== baseWorld.versions.terrain) throw new Error('Stale base terrain version');
  const terrain = { ...fineTerrain, source: { ...fineTerrain.source }, heights: new Float32Array(fineTerrain.heights) };
  const fineBounds = terrainBounds(terrain), bounds = { ...(options.bounds ?? fineBounds) }, half = context.grid.spacingM / 2;
  const footprint = { minX: context.bounds.minX - half, minZ: context.bounds.minZ - half, maxX: context.bounds.maxX + half, maxZ: context.bounds.maxZ + half };
  assertBounds(bounds, fineBounds, 'Active refinement bounds exceed fine terrain sample centres');
  assertBounds(bounds, footprint, 'Active refinement bounds exceed canonical source footprint');
  const n = terrain.width * terrain.height, sourceFields = context.fields;
  const fields = createFields(n, sourceFields.topographicPosition.length, sourceFields.provenance.length);
  for (let i = 0; i < n; i++) {
    if (!(i % 4096)) assertNotAborted(options.signal);
    const x = terrain.originX + i % terrain.width * terrain.spacingM, z = terrain.originZ + Math.floor(i / terrain.width) * terrain.spacingM;
    const sample = gridSampler(context.grid, x, z), j = sample.nearest;
    for (const key of FLOAT_FIELDS) fields[key][i] = key === 'waterLevelM' || key === 'aspect' || key === 'orientation' || key === 'handM' ? sourceFields[key][j] : sample.continuous(sourceFields[key]);
    for (const key of BYTE_FIELDS) fields[key][i] = sourceFields[key][j];
    for (const key of SHORT_FIELDS) fields[key][i] = sourceFields[key][j];
    fields.basin[i] = sourceFields.basin[j];
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
    for (let unit = 0; unit < fields.provenance.length; unit++) { fields.provenance[unit][i] = sourceFields.provenance[unit][j]; sum += fields.provenance[unit][i]; }
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
  if (fineBounds.minX < footprint.minX || fineBounds.maxX > footprint.maxX || fineBounds.minZ < footprint.minZ || fineBounds.maxZ > footprint.maxZ) warnings.push('Fine source contains padding outside canonical footprint; projected padding context is clamped and excluded from active bounds.');
  assertNotAborted(options.signal);
  return { ...baseWorld, id: hashString([reference.id, terrainVersion, fingerprint(bounds), 'geometry-retarget-1'].join(':')),
    bounds, terrain, fields, geology, climate, versions, canonicalContext: context, canonicalContextRef: reference,
    state: { ...baseWorld.state }, topographicRadiiM: [...baseWorld.topographicRadiiM],
    diagnostics: { ...baseWorld.diagnostics, warnings, assumptions: [...baseWorld.diagnostics.assumptions,
      'Geometry refined without recompiling canonical context. Projected fields are renderer samples; exact CPU context and population eligibility resolve canonicalContext.',
      'Projected downstream indices are patch-local references; -1 may mean an exterior target. Canonical graph and basin identities remain authoritative.',
      'estimatedBytes counts this projection and source heights, excluding the borrowed canonical context.'], estimatedBytes } };
}
