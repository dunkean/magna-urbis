import { compileSurfaceWorld, estimateSurfaceCompileBytes, fingerprint } from '../compiler';
import { SURFACE_MEMORY_BUDGET_BYTES } from '../limits';
import { assertNotAborted, type CompileOptions, type RockUnit, type SurfaceCompileInput, type SurfaceState, type SurfaceWorld, type TerrainGrid } from '../model';
import { validateRegionalPackage, type MetricGeoreference, type NeuralEarthPackage, type RegionalLayer } from './neuralEarth';

export interface RegionalGeologyCatalogue {
  id: string; version: string; provenance: string; units: RockUnit[];
  /** External categorical code -> explicit rock-unit id. No biome/climate/plate inference is permitted. */
  codeToUnit: Record<string, number>;
}
export interface RegionalSurfaceMapping {
  format: 'surface-regional-mapping'; version: 1;
  height: string;
  geology: { layer: string; catalogue: RegionalGeologyCatalogue };
  climate: {
    annualTemperature?: string; summerTemperature?: string; winterTemperature?: string;
    annualPrecipitation?: string; summerPrecipitation?: string; winterPrecipitation?: string;
    elevationPolicy: 'preserve-source' | 'correct-to-target' | 'compiler-lapse';
    referenceElevation?: string; referenceElevationM?: number; lapseRateCPerKm?: number;
  };
  hydrology?: { waterClass?: string; waterCodeToClass?: Record<string, number>; waterLevel?: string;
    downstream?: string; contributingArea?: string; boundary?: 'complete-basin' | 'external-inflows' | 'truncated' };
}
export interface RegionalSurfaceOptions extends CompileOptions {
  geologyPackage?: NeuralEarthPackage;
  /** Optional primary generator heightfield; samples and its source identity are preserved unchanged. */
  terrain?: TerrainGrid; state?: SurfaceState;
}
export interface RegionalSurfaceProvenance {
  format: 'surface-regional-provenance'; version: 1; packageId: string; packageSeed: string;
  georeference: MetricGeoreference; geologyPackageId: string; mapping: RegionalSurfaceMapping;
  sourceFeatures: Record<string, unknown>;
  layers: Array<Omit<RegionalLayer, 'values'> & { key: string; packageId: string }>;
  limitations: string[];
}
export type RegionalSurfaceWorld = SurfaceWorld & { regionalSource: RegionalSurfaceProvenance };

function layerOf(packet: NeuralEarthPackage, key: string): RegionalLayer {
  const layer = packet.layers[key]; if (!layer) throw new Error(`Required regional layer missing: ${key}`); return layer;
}
function sameGrid(layer: RegionalLayer, t: TerrainGrid): boolean {
  return layer.width === t.width && layer.height === t.height && layer.originX === t.originX && layer.originZ === t.originZ && layer.spacingM === t.spacingM;
}
function sample(layer: RegionalLayer, x: number, z: number, categorical = false): number {
  const gx = (x - layer.originX) / layer.spacingM, gz = (z - layer.originZ) / layer.spacingM;
  if (gx < -.50000001 || gz < -.50000001 || gx > layer.width - .49999999 || gz > layer.height - .49999999) throw new Error(`Regional layer ${layer.id} does not cover target sample (${x},${z})`);
  const px = Math.max(0, Math.min(layer.width - 1, gx)), pz = Math.max(0, Math.min(layer.height - 1, gz));
  const ix = Math.floor(px), iz = Math.floor(pz), dx = px - ix, dz = pz - iz, at = (a: number, b: number) => layer.values[b * layer.width + a];
  if (categorical) return at(Math.round(px), Math.round(pz));
  const right = Math.min(layer.width - 1, ix + 1), bottom = Math.min(layer.height - 1, iz + 1);
  return (at(ix, iz) * (1 - dx) + at(right, iz) * dx) * (1 - dz) + (at(ix, bottom) * (1 - dx) + at(right, bottom) * dx) * dz;
}
function physical(layer: RegionalLayer, value: number, unit: 'm' | 'degC' | 'mm/year' | 'mm/half-year' | 'm2'): number {
  if (!Number.isFinite(value)) throw new Error(`Non-finite required regional value in ${layer.id}`);
  const key = `${layer.units}>${unit}`;
  if (key === 'K>degC') return value - 273.15;
  if (key === 'm/year>mm/year' || key === 'm/half-year>mm/half-year') return value * 1000;
  if (key === 'mm>m') return value / 1000;
  if (layer.units !== unit) throw new Error(`Unsupported physical units ${layer.units} -> ${unit}; normalized Orogen fields must be converted explicitly by the source exporter`);
  return value;
}

/** Import physical regional context into the engine-independent compiler.
 * Geology always comes from an explicit categorical map and catalogue, never tectonics or visual pedology. */
export function compileRegionalSurfaceWorld(packet: NeuralEarthPackage, mapping: RegionalSurfaceMapping, options: RegionalSurfaceOptions = {}): RegionalSurfaceWorld {
  assertNotAborted(options.signal); validateRegionalPackage(packet);
  if (mapping?.format !== 'surface-regional-mapping' || mapping.version !== 1 || !mapping.geology?.catalogue) throw new Error('Explicit regional mapping and geology catalogue are required');
  if (!mapping.climate || !['preserve-source', 'correct-to-target', 'compiler-lapse'].includes(mapping.climate.elevationPolicy)) throw new Error('Regional climate requires an explicit elevation policy');
  const geologyPacket = options.geologyPackage ?? packet; validateRegionalPackage(geologyPacket);
  if (fingerprint(geologyPacket.georeference) !== fingerprint(packet.georeference)) throw new Error('Geology and regional package georeferences differ; reproject explicitly before import');
  const azimuth = (packet.georeference.zAzimuthDeg % 360 + 360) % 360;
  if (Math.abs(azimuth - 180) > 1e-8) throw new Error('Regional package must use east/up/south axes (+Z azimuth 180); explicit reprojection is required before importing height samples');
  const used: RegionalSurfaceProvenance['layers'] = [], limitations: string[] = [];
  const get = (key: string, p = packet) => { const layer = layerOf(p, key); if (!used.some(v => v.key === key && v.packageId === p.id)) { const { values: _, ...meta } = layer; used.push({ ...meta, key, packageId: p.id }); } return layer; };
  const height = get(mapping.height), catalogue = mapping.geology.catalogue;
  if (!catalogue.id || !catalogue.version || !catalogue.provenance || !Array.isArray(catalogue.units) || !catalogue.units.length || !catalogue.codeToUnit || typeof catalogue.codeToUnit !== 'object') throw new Error('Invalid explicit geology catalogue');
  const shape = options.terrain ?? height;
  const estimate = estimateSurfaceCompileBytes(shape, catalogue.units.length, options.topographicRadiiM?.length ?? 3);
  if (estimate > (options.memoryBudgetBytes ?? SURFACE_MEMORY_BUDGET_BYTES)) throw new Error('Regional import exceeds memoryBudgetBytes before context allocation');
  const sourceTerrain: TerrainGrid = options.terrain ?? { width: height.width, height: height.height, originX: height.originX, originZ: height.originZ,
    spacingM: height.spacingM, heights: Float32Array.from(height.values, value => physical(height, value, 'm')),
    source: { id: `${packet.id}:${height.id}`, version: fingerprint([height.sourceKey, height.provenance, height.values]), sourceLOD: height.sourceLOD,
      nativeSpacingM: height.nativeSpacingM, provenance: height.provenance } };
  const n = sourceTerrain.width * sourceTerrain.height;
  const rock = get(mapping.geology.layer, geologyPacket);
  if (!(rock.values instanceof Uint8Array || rock.values instanceof Uint16Array || rock.values instanceof Int32Array) || !['lithology-code', 'category-id'].includes(rock.units)) throw new Error('Geology must be an integer lithology-code/category-id layer, not a climate or soil-colour proxy');
  const unitIds = new Set(catalogue.units.map(unit => unit.id));
  for (const [code, id] of Object.entries(catalogue.codeToUnit)) if (!/^-?\d+$/.test(code) || !Number.isInteger(id) || !unitIds.has(id)) throw new Error('Geology code catalogue references an unknown explicit rock unit');
  const c = mapping.climate;
  const annualT = c.annualTemperature ? get(c.annualTemperature) : undefined, summerT = c.summerTemperature ? get(c.summerTemperature) : undefined, winterT = c.winterTemperature ? get(c.winterTemperature) : undefined;
  const annualP = c.annualPrecipitation ? get(c.annualPrecipitation) : undefined, summerP = c.summerPrecipitation ? get(c.summerPrecipitation) : undefined, winterP = c.winterPrecipitation ? get(c.winterPrecipitation) : undefined;
  if (!annualT && !(summerT && winterT) || !annualP && !(summerP && winterP)) throw new Error('Regional climate needs annual fields or both seasonal temperature/precipitation fields');
  const temperatureLayers = [annualT, summerT, winterT].filter(Boolean) as RegionalLayer[];
  const corrected = temperatureLayers.map(layer => layer.season?.elevationCorrected);
  if (corrected.some(value => typeof value !== 'boolean') || corrected.some(value => value !== corrected[0])) throw new Error('Regional temperatures need consistent explicit elevationCorrected flags');
  if (c.elevationPolicy === 'compiler-lapse' ? corrected[0] : !corrected[0]) throw new Error('Climate elevation policy contradicts the imported source correction flag');
  const reference = c.referenceElevation ? get(c.referenceElevation) : undefined;
  if (c.elevationPolicy === 'correct-to-target' && !reference) throw new Error('correct-to-target climate requires a source reference-elevation layer');
  const lapse = c.lapseRateCPerKm ?? 6.5;
  if (!Number.isFinite(lapse) || !Number.isFinite(c.referenceElevationM ?? 0)) throw new Error('Invalid regional climate reference/lapse rate');
  const bedrock = new Uint16Array(n), temperatures = new Float32Array(n), precipitation = new Float32Array(n);
  const h = mapping.hydrology, water = h?.waterClass ? get(h.waterClass) : undefined, levels = h?.waterLevel ? get(h.waterLevel) : undefined;
  const area = h?.contributingArea ? get(h.contributingArea) : undefined, downstream = h?.downstream ? get(h.downstream) : undefined;
  if (downstream && (!(downstream.values instanceof Int32Array) || downstream.units !== 'cell-index' || !sameGrid(downstream, sourceTerrain))) throw new Error('Directed routing must match the canonical terrain grid exactly; graph indices cannot be resampled');
  const waterClass = water && new Uint8Array(n), waterLevelM = levels && new Float32Array(n).fill(NaN), contributingAreaM2 = area && new Float32Array(n);
  let sumT = 0, sumP = 0, amplitude = 0;
  for (let i = 0; i < n; i++) {
    if (!(i % 16384)) assertNotAborted(options.signal);
    const x = sourceTerrain.originX + i % sourceTerrain.width * sourceTerrain.spacingM, z = sourceTerrain.originZ + Math.floor(i / sourceTerrain.width) * sourceTerrain.spacingM;
    const code = sample(rock, x, z, true), unit = catalogue.codeToUnit[String(code)];
    if (unit === undefined) throw new Error(`No explicit rock unit for geology code ${code}`); bedrock[i] = unit;
    const ts = summerT ? physical(summerT, sample(summerT, x, z), 'degC') : 0, tw = winterT ? physical(winterT, sample(winterT, x, z), 'degC') : 0;
    let t = annualT ? physical(annualT, sample(annualT, x, z), 'degC') : (ts + tw) / 2;
    if (c.elevationPolicy === 'correct-to-target') t -= (sourceTerrain.heights[i] - physical(reference!, sample(reference!, x, z), 'm')) * lapse / 1000;
    const p = annualP ? physical(annualP, sample(annualP, x, z), 'mm/year') : physical(summerP!, sample(summerP!, x, z), 'mm/half-year') + physical(winterP!, sample(winterP!, x, z), 'mm/half-year');
    if (p < 0) throw new Error('Negative imported precipitation'); temperatures[i] = t; precipitation[i] = p; sumT += t; sumP += p;
    if (summerT && winterT) amplitude += Math.abs(ts - tw) / 2;
    if (water && waterClass) {
      const sourceCode = sample(water, x, z, true), value = h!.waterCodeToClass ? h!.waterCodeToClass[String(sourceCode)] : sourceCode;
      if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error('Unknown regional water class/code'); waterClass[i] = value;
    }
    // Authoritative water levels use nearest source cells: bilinear NaN-dry neighbours
    // must not poison a wet level, nor interpolate an invented level across bodies.
    if (levels && waterLevelM && (!waterClass || waterClass[i])) waterLevelM[i] = physical(levels, sample(levels, x, z, true), 'm');
    if (area && contributingAreaM2) contributingAreaM2[i] = physical(area, sample(area, x, z), 'm2');
  }
  if (!annualT) limitations.push('Annual temperature is the midpoint of imported northern summer/winter fields, not a full annual climate integration.');
  if (summerT && winterT) limitations.push('Spatial seasonal amplitudes are retained in source layer references; the current compiler uses their spatial mean for its seasonal-state approximation.');
  if (used.some(layer => layer.nativeSpacingM > sourceTerrain.spacingM)) limitations.push('Regional layers coarser than the primary terrain are interpolated context; no added observation or terrain detail is claimed.');
  if (!downstream) limitations.push('No aligned source drainage graph supplied; source masks/levels are preserved but routing and basin descriptors use the explicit D8 fallback.');
  const input: SurfaceCompileInput = { seed: parseInt(fingerprint(packet.seed).slice(0, 8), 16), terrain: sourceTerrain,
    geology: { version: `${catalogue.id}:${catalogue.version}:${fingerprint([rock.values, catalogue])}`, provenance: catalogue.provenance, units: catalogue.units, bedrock },
    climate: { version: `${packet.id}:physical-climate:${fingerprint([c, temperatures, precipitation, used])}`, meanAnnualTempC: sumT / n, annualPrecipMm: sumP / n,
      temperatureC: temperatures, precipitationMm: precipitation, seasonalAmplitudeC: summerT && winterT ? amplitude / n : 0,
      elevationCorrected: c.elevationPolicy !== 'compiler-lapse', referenceElevationM: c.referenceElevationM ?? 0, lapseRateCPerKm: lapse },
    hydrology: { version: `${packet.id}:imported-hydrology:${fingerprint([h, downstream?.values, waterClass, waterLevelM, contributingAreaM2])}`, provenance: `Physical regional source ${packet.id}; directed routing ${downstream ? 'imported' : 'not supplied'}`,
      downstream: downstream ? new Int32Array(downstream.values) : undefined, waterClass, waterLevelM, contributingAreaM2, boundary: h?.boundary ?? 'truncated' }, state: options.state };
  const world = compileSurfaceWorld(input, options) as RegionalSurfaceWorld;
  world.regionalSource = { format: 'surface-regional-provenance', version: 1, packageId: packet.id, packageSeed: packet.seed,
    georeference: structuredClone(packet.georeference), geologyPackageId: geologyPacket.id, mapping: structuredClone(mapping),
    sourceFeatures: structuredClone(packet.features), layers: used, limitations };
  world.diagnostics.assumptions.push(...limitations);
  return world;
}
