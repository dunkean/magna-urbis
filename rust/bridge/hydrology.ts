import { HydrologyEngine } from '../pkg/wasm/magna_urbis_wasm.js';
import { prepareHydrologyGpu } from './hydrologyGpu';
export { applyHydrologySurface } from './hydrologySurface';

export interface HydrologySettings {
  enabled: boolean;
  main: 'auto' | 'none' | 'stream' | 'river' | 'major';
  density: number; wetness: number;
  /** Streams reaching the sea on their own: 1 keeps basins from about 30 km², each 0.25 less doubles it (0: only large rivers). */
  coastalStreams: number;
  lakes: 'auto' | 'none' | 'some';
  meanders: 'natural' | 'reduced' | 'none'; meanderIntensity: number;
  estuary: 'auto' | 'simple' | 'widening' | 'funnel' | 'tidal';
  widthScale: number; incision: number;
  /** Lakes: smallest area (m²) and depth (m) of a lake of the water budget. */
  minLakeArea: number; minLakeDepth: number;
  /** Synthetic lakes (`lakes: 'some'`) only. */
  lakeAbundance: number; lakeCoverage: number; maxLakeArea: number;
  depressionPolicy: 'auto' | 'fill'; maxBreachDepth: number; maxBreachLength: number;
  resolution: 256 | 512 | 1024; compute: 'auto' | 'cpu' | 'gpu';
  /** Water chain: the vector chain (priority-flood, water budget, vector rivers) or the Rust hydrology. */
  engine: 'vector' | 'rust';
  /** Compute water on conditioned relief; false keeps the upstream relief and disables river incision/breaches. */
  erosionEnabled: boolean;
  /** Display hydrology's terrain changes; false overlays the same water on the upstream relief. */
  showErosion: boolean;
  /** Pre-hydrology conditioning of the relief, shared by both chains. */
  condMode: 'none' | 'erosion' | 'breach' | 'both'; condStrength: number; condDepth: number; condLength: number;
  /** Vector chain: river threshold (km², 0 = from the map size), lakes (m, ha), tracing and channel styles. */
  riverArea: number; lakeDepth: number; lakeArea: number; riverMode: 'vector' | 'grid';
  flatSlope: number; sinuosity: number; vectorWidth: number; vectorResolution: 512 | 1024;
  balance: boolean; braiding: number; anabranching: boolean; terrainInfluence: boolean; avulsions: boolean;
  confluence: 'climate' | 'drainage'; deltas: boolean;
}

export const DEFAULT_HYDROLOGY: HydrologySettings = {
  enabled: true, main: 'auto', density: 1, coastalStreams: 1, wetness: 1, lakes: 'auto',
  meanders: 'natural', meanderIntensity: 1, estuary: 'auto', widthScale: 1,
  incision: 1, minLakeArea: 100000, minLakeDepth: 1, resolution: 512, compute: 'auto',
  lakeAbundance: 0.5, lakeCoverage: 0.05, maxLakeArea: 0.02,
  depressionPolicy: 'auto', maxBreachDepth: 12, maxBreachLength: 1000,
  engine: 'rust', erosionEnabled: true, showErosion: true, condMode: 'both', condStrength: 2, condDepth: 30, condLength: 3000,
  riverArea: 0, lakeDepth: 1, lakeArea: 10, riverMode: 'vector', flatSlope: 1, sinuosity: 1.8, vectorWidth: 3, vectorResolution: 1024,
  balance: true, braiding: 1, anabranching: true, terrainInfluence: true, avulsions: true, confluence: 'climate', deltas: true,
};
/** River threshold of the vector chain: 0 means about 0.3 % of the map (5 km² on 40 km). */
export const riverAreaFor = (settings: HydrologySettings, width: number): number => settings.riverArea > 0 ? settings.riverArea : Math.max(0.02, 0.003 * (width / 1000) ** 2);
export type HydrologyOverlay = 'none' | 'basins' | 'accumulation' | 'flow' | 'depressions' | 'lakes' | 'channels' | 'raw-basins' | 'raw-accumulation' | 'raw-flow' | 'raw-depressions' | 'flats' | 'flat-rank';

/** Retained physical grids and packed vector topology; lengths are metres, areas m².
 * UINT_MAX is the receiver outlet sentinel. Vector offsets count vertices.
 * riverPoints: x,y,width,waterZ; riverMeta: id,from,to,host+1,flags,estuary.
 * lakePoints: x,y; lakeMeta: id,waterZ,area,maxDepth,outletX,outletY (a closed lake: its sink).
 * lakeClosed: 1 per closed lake; waterField: per cell, B-spline control values whose positive part is open water.
 */
export interface HydrologyData {
  width: number; resolution: number;
  receivers: Uint32Array; accumulation: Float32Array; basins: Uint32Array;
  rawReceivers: Uint32Array; rawAccumulation: Float32Array; rawBasins: Uint32Array;
  flatLabels: Uint32Array; flatRank: Uint32Array;
  externalInflowArea: number;
  rawFilled: Float32Array; rawDrainageHeight: Float32Array;
  breachCount: number; breachCutVolumeM3: number; avoidedFillVolumeM3: number;
  filled: Float32Array; lakeDepth: Float32Array; lakeLabels: Uint32Array;
  baseHeight: Float32Array; drainageHeight: Float32Array; surfaceHeight: Float32Array; adjustedHeight: Float32Array;
  riverPoints: Float32Array; riverOffsets: Uint32Array; riverMeta: Uint32Array;
  lakePoints: Float32Array; lakeOffsets: Uint32Array; lakeMeta: Float32Array; lakeRingMeta: Uint32Array;
  lakeClosed: Uint32Array; waterField: Float32Array; closedLakeCount: number;
  nodePoints: Float32Array; nodeMeta: Uint32Array;
  riverCount: number; lakeCount: number; basinCount: number;
  lakeFraction: number;
  incision: number;
  backend: 'cpu' | 'gpu-f32'; backendReason?: string;
  drainageMs: number; vectorMs: number; generationMs: number;
  stageMs?: Record<string, number>;
  routingPotential?: Float32Array; seaMask?: Uint8Array;
  gpuComputeMs?: number; gpuReadbackMs?: number; gpuFloodPasses?: number;
}

export class PreparedHydrology {
  private constructor(private engine: HydrologyEngine, readonly baseHeight: Float32Array,
    readonly backend: HydrologyData['backend'], readonly backendReason: string | undefined,
    readonly drainageMs: number, private gpu?: Awaited<ReturnType<typeof prepareHydrologyGpu>>) {}

  static async create(seed: string, width: number, resolution: number, height: Float32Array,
    compute: HydrologySettings['compute'], seaEnabled: boolean): Promise<PreparedHydrology> {
    const start = performance.now();
    let engine: HydrologyEngine | undefined, reason: string | undefined;
    let gpu: Awaited<ReturnType<typeof prepareHydrologyGpu>> | undefined;
    if (compute !== 'cpu') {
      try {
        const drainage = await prepareHydrologyGpu(height, width, resolution, seed, seaEnabled);
        engine = HydrologyEngine.with_drainage(seed, width, resolution, height, seaEnabled,
          drainage.filled, drainage.receivers, drainage.accumulation);
        gpu = drainage;
      } catch (error) { reason = `GPU hydrology unavailable: ${error instanceof Error ? error.message : String(error)}`; }
    }
    const backend = engine ? 'gpu-f32' : 'cpu';
    engine ??= new HydrologyEngine(seed, width, resolution, height, seaEnabled);
    return new PreparedHydrology(engine, height, backend, reason, performance.now() - start, gpu);
  }

  /** `climate`: the water budget's mean annual temperature at sea level (°C) and precipitation (mm). */
  generate(settings: HydrologySettings, climate: { temperature: number; precipitation: number }): HydrologyData {
    const start = performance.now();
    const output = this.engine.generate(settings.main, settings.density, settings.wetness,
      settings.lakes, settings.meanders, settings.meanderIntensity, settings.estuary,
      settings.widthScale, settings.incision, settings.minLakeArea,
      settings.lakeAbundance, settings.lakeCoverage, settings.maxLakeArea,
      settings.depressionPolicy, settings.maxBreachDepth, settings.maxBreachLength,
      settings.minLakeDepth, climate.temperature, climate.precipitation, settings.coastalStreams);
    try {
      const stageTimes = output.stage_ms;
      const stageMs = output.stage_labels ? Object.fromEntries(output.stage_labels.split(',').map((label, i) => [label, stageTimes[i]])) : undefined;
      const basins = output.basins;
      let basinCount = 0;
      let landCells = 0;
      for (const value of basins) { basinCount = Math.max(basinCount, value); if (value) landCells++; }
      const riverOffsets = output.river_offsets, lakeMeta = output.lake_meta, lakeClosed = output.lake_closed;
      let lakeArea = 0;
      for (let i = 2; i < lakeMeta.length; i += 6) lakeArea += lakeMeta[i];
      const riverMeta = output.river_meta;
      let externalInflow = false;
      for (let i = 4; i < riverMeta.length; i += 6) externalInflow ||= (riverMeta[i] & 2) !== 0;
      return {
        width: output.width, resolution: output.resolution,
        receivers: output.receivers, accumulation: output.accumulation, basins,
        rawReceivers: output.raw_receivers ?? output.receivers,
        rawAccumulation: output.raw_accumulation ?? output.accumulation,
        rawBasins: output.raw_basins ?? basins,
        flatLabels: output.flat_labels ?? new Uint32Array(basins.length),
        flatRank: output.flat_rank ?? new Uint32Array(basins.length),
        externalInflowArea: output.external_inflow_area ?? 0,
        rawFilled: output.raw_filled ?? output.filled,
        rawDrainageHeight: output.raw_drainage_height ?? output.drainage_height,
        breachCount: output.breach_count ?? 0,
        breachCutVolumeM3: output.breach_cut_volume_m3 ?? 0,
        avoidedFillVolumeM3: output.avoided_fill_volume_m3 ?? 0,
        filled: output.filled, lakeDepth: output.lake_depth, lakeLabels: output.lake_labels,
        baseHeight: this.baseHeight, drainageHeight: output.drainage_height, surfaceHeight: output.surface_height, adjustedHeight: output.adjusted_height,
        riverPoints: output.river_points, riverOffsets, riverMeta,
        lakePoints: output.lake_points, lakeOffsets: output.lake_offsets, lakeMeta, lakeRingMeta: output.lake_ring_meta,
        lakeClosed, waterField: output.water_field, closedLakeCount: lakeClosed.reduce((sum, c) => sum + c, 0),
        nodePoints: output.node_points, nodeMeta: output.node_meta,
        riverCount: riverOffsets.length - 1, lakeCount: lakeMeta.length / 6, basinCount,
        lakeFraction: lakeArea / Math.max(1, landCells * (output.width / output.resolution) ** 2),
        incision: settings.incision,
        backend: this.backend,
        backendReason: [this.backendReason,
          this.backend === 'gpu-f32' && settings.lakes === 'some' ? 'Lake layout and associated drainage completed in Rust.' : undefined,
          ['stream', 'river', 'major'].includes(settings.main) && !externalInflow ? 'No suitable land inflow: the main channel is limited to its local watershed.' : undefined,
        ].filter(Boolean).join(' · ') || undefined,
        drainageMs: this.drainageMs, vectorMs: performance.now() - start,
        stageMs,
        generationMs: this.drainageMs + performance.now() - start,
        routingPotential: settings.lakes === 'some' ? undefined : this.gpu?.potential,
        seaMask: this.gpu?.seaMask, gpuComputeMs: this.gpu?.computeMs,
        gpuReadbackMs: this.gpu?.readbackMs, gpuFloodPasses: this.gpu?.floodPasses,
      };
    } finally { output.free(); }
  }

  dispose(): void { this.engine.free(); }
}
