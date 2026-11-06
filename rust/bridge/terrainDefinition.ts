import type { TerrainSettings } from './terrain';

/** Physical source definition. Overview pixels and camera LOD never select it. */
export const DEFAULT_SAMPLE_SPACING = 30;
export const MAX_SOURCE_RESOLUTION = 8192;
export const MAX_SOURCE_WORKING_BYTES = 1536 * 1024 * 1024;
export const NEURAL_NATIVE_SPACING = 30;
/** The working raster budget stops procedural sources here; `fine` then takes 256 Mio on the device. */
export const MAX_GPU_SOURCE_RESOLUTION = 4096;
/** Hydraulic cap: 2072² padded nodes take 459 Mio, and receivers travel as exact f32 cell indices. */
export const MAX_SURFACE_GRID = 2048;
const GPU_FINE_BYTES = 16, GPU_NODE_BYTES = 112;
const CPU_GRID_CELL_MS = 1.2e-3, CPU_SOURCE_CELL_MS = 3e-4;
const GPU_COMPILE_MS = 1500, GPU_STEP_MS = 6, GPU_GRID_CELL_MS = 2e-5, GPU_SOURCE_CELL_MS = 1e-5;
export interface TerrainCapability {
  minWidth: number; maxWidth: number; minSpacing: number;
  kind: 'procedural' | 'neural' | 'finite-neural' | 'imported' | 'classic';
}
type DefinitionInput = Pick<TerrainSettings, 'width' | 'source' | 'baseModel' | 'sketch' | 'sourceNativeResolution'> & { sampleSpacing?: number };
export interface SourceDefinition extends TerrainCapability {
  width: number; n: number; spacing: number; requestedSpacing: number;
  /** Metres per cell of the effective hydraulic erosion grid, when used. */
  erosionSpacing?: number;
  /** Metres per cell of regional erosion, including its geographic margin. */
  regionalErosionSpacing?: number;
  nativeSpacing?: number; sourceBytes: number; estimatedWorkingBytes: number;
}

export function terrainCapability(input: { source?: string; baseModel?: string; sketch?: TerrainSettings['sketch']; backend?: string; sourceNativeResolution?: number }): TerrainCapability {
  if (input.backend === 'typescript') return { kind: 'classic', minWidth: 600, maxWidth: 40000, minSpacing: 1 };
  if (input.sketch?.processing || input.sourceNativeResolution) {
    const nativeN = input.sketch?.processing === 'surface' ? input.sketch.resolution : input.sourceNativeResolution;
    return { kind: 'imported', minWidth: 500, maxWidth: nativeN ? Math.min(100000, nativeN * 1000) : 100000, minSpacing: 1 };
  }
  const neural = ['neural', 'neural-python', 'neural-wasm'].includes(input.source ?? 'procedural');
  if (!neural) return { kind: 'procedural', minWidth: 500, maxWidth: 100000, minSpacing: 1 };
  if (input.source === 'neural-python' && input.baseModel === 'residual8k')
    return { kind: 'finite-neural', minWidth: 40000, maxWidth: 40000, minSpacing: 40000 / 1024 };
  return { kind: 'neural', minWidth: 500, maxWidth: 200000, minSpacing: NEURAL_NATIVE_SPACING };
}

/** Explicit procedural GPU requests beyond the source the kernels index; imports and painted zones use another path. */
export function unsupportedExplicitGpuResolution(settings: Pick<TerrainSettings, 'source' | 'generationCompute' | 'sketch' | 'zones'>, n: number): boolean {
  return n > MAX_GPU_SOURCE_RESOLUTION && !!settings.generationCompute && ['gpu', 'gpu-all', 'gpu-erosion'].includes(settings.generationCompute)
    && !settings.sketch && !settings.zones && terrainCapability(settings).kind === 'procedural';
}

/** Baseline hydraulic grid (Rust `surface_resolution`), before the source definition applies. */
export const surfaceBaseline = (width: number, motif: number): number => Math.max(640, Math.min(1024, Math.ceil(width / motif * 96)));
/** The hydraulic grid follows the source above 1024², within GPU indexing and memory bounds, and never exceeds it. */
export function surfaceGrid(baseline: number, sourceN: number, requested?: number): number {
  return Math.min(sourceN, requested ?? (sourceN > 1024 ? Math.min(MAX_SURFACE_GRID, Math.max(baseline, Math.ceil(sourceN * .6))) : baseline));
}
/** Water never runs finer than the source can inform: smallest power-of-two grid holding it, at least 256². */
export function hydrologyGrid(selected: number, sourceN: number): number {
  return Math.min(selected, 2 ** Math.max(8, Math.ceil(Math.log2(sourceN))));
}

/** What will run for a definition, shared by rustbench and V2 so both report the same plan. */
export interface PhysicalPlanInput {
  definition: SourceDefinition; motifSize: number; surfaceN?: number; compact?: boolean;
  hydrology?: { engine: 'vector' | 'rust'; resolution: number; vectorResolution: number };
  generationCompute?: TerrainSettings['generationCompute']; compute?: TerrainSettings['compute'];
}
export interface PhysicalPlan {
  sourceN: number; sourceSpacing: number; erosionN?: number; erosionSpacing?: number; hydrologyN?: number; hydrologySpacing?: number;
  backend?: 'webgpu' | 'auto' | 'cpu' | 'native';
}
export function physicalPlan(input: PhysicalPlanInput): PhysicalPlan {
  const { definition, hydrology, generationCompute } = input, procedural = definition.kind === 'procedural';
  // The compact preset erodes on its regional grid alone, unless a recipe adds a surface stage.
  const erosionN = procedural && !input.compact ? surfaceGrid(surfaceBaseline(definition.width, input.motifSize), definition.n, input.surfaceN) : undefined;
  const hydrologyN = hydrology && hydrologyGrid(hydrology.engine === 'vector' ? hydrology.vectorResolution : hydrology.resolution, definition.n);
  const backend = !procedural ? undefined : generationCompute === 'native' ? 'native' : generationCompute === 'cpu' || input.compute === 'wasm' ? 'cpu' : generationCompute ? 'webgpu' : 'auto';
  return { sourceN: definition.n, sourceSpacing: definition.spacing, erosionN, erosionSpacing: erosionN && definition.width / erosionN,
    hydrologyN, hydrologySpacing: hydrologyN && definition.width / hydrologyN, backend };
}
export function physicalPlanSummary(plan: PhysicalPlan, french: boolean): string {
  const grid = (label: string, n?: number, spacing?: number) => n === undefined ? [] : [`${label} ${n}² · ${spacing!.toFixed(2)} m`];
  const backends = { webgpu: 'WebGPU', auto: french ? 'WebGPU si plus rapide et accepté par l’adaptateur, sinon Rust CPU' : 'WebGPU when faster and within adapter limits, else Rust CPU', cpu: 'Rust CPU', native: french ? 'Rust natif' : 'native Rust' };
  return [...grid('Source', plan.sourceN, plan.sourceSpacing), ...grid(french ? 'érosion' : 'erosion', plan.erosionN, plan.erosionSpacing),
    ...grid(french ? 'hydrologie' : 'hydrology', plan.hydrologyN, plan.hydrologySpacing), ...(plan.backend ? [backends[plan.backend]] : [])].join(' · ');
}

/** Sea skipped by the detail and surface stages lies at least this far from land, in metres.
 * Each term is what those stages reach: surface iterations move one surface cell
 * each and the delta spline two more; the cubic reconstruction reads two regional
 * cells, the warp shifts that read, and the detail gradient spans one source cell. */
export function openSeaBand(reach: { surfaceSteps: number; surfaceCell: number; regionalCell: number; sourceCell: number; warp: number }): number {
  return (reach.surfaceSteps + 2) * reach.surfaceCell + 2 * reach.regionalCell + reach.warp + reach.sourceCell;
}
/** The mask has this many cells per side; a wider band leaves too little sea to skip. */
export const OPEN_SEA_GRID = 128, OPEN_SEA_MAX_RADIUS = 32;
/** Mask cells to dilate land by, one cell of margin for quantisation; undefined when nothing is worth skipping. */
export function openSeaRadius(band: number, width: number): number | undefined {
  const radius = Math.ceil(band / (width / OPEN_SEA_GRID)) + 1;
  return radius < OPEN_SEA_MAX_RADIUS ? radius : undefined;
}

export type GpuBufferLimits = Pick<GPUSupportedLimits, 'maxBufferSize' | 'maxStorageBufferBindingSize'>;
/** The reason an adapter cannot bind this source and simulation grid, if any. */
export function gpuCapacityError(limits: GpuBufferLimits, sourceN: number, gridN: number): string | undefined {
  const limit = Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize);
  const largest = Math.max(sourceN ** 2 * GPU_FINE_BYTES, gridN ** 2 * GPU_NODE_BYTES);
  if (sourceN <= MAX_GPU_SOURCE_RESOLUTION && largest <= limit) return undefined;
  return `WebGPU : source ${sourceN}² et érosion ${gridN}² demandent ${Math.ceil(largest / 1048576)} Mio dans un buffer, adaptateur limité à ${Math.floor(limit / 1048576)} Mio (source max ${maxGpuSource(limits)}²). Augmentez le pas ou choisissez le calcul CPU.`;
}
export function maxGpuSource(limits: GpuBufferLimits): number {
  return Math.min(MAX_GPU_SOURCE_RESOLUTION, Math.floor(Math.sqrt(Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize) / GPU_FINE_BYTES)));
}

/** Simulation size of one procedural generation. Regional steps dominate on both backends and do not depend on the source. */
export interface GenerationWork { sourceN: number; regionalN: number; regionalSteps: number; surfaceN: number; surfaceSteps: number; pipelinesReady: boolean }
/** Estimated milliseconds; each constant is the order of magnitude of one backend's unit cost. */
export function generationCostMs(work: GenerationWork): { cpu: number; gpu: number } {
  const steps = work.regionalSteps + work.surfaceSteps, gridCells = work.regionalN ** 2 * work.regionalSteps + work.surfaceN ** 2 * work.surfaceSteps, sourceCells = work.sourceN ** 2;
  return { cpu: gridCells * CPU_GRID_CELL_MS + sourceCells * CPU_SOURCE_CELL_MS,
    gpu: (work.pipelinesReady ? 0 : GPU_COMPILE_MS) + steps * GPU_STEP_MS + gridCells * GPU_GRID_CELL_MS + sourceCells * GPU_SOURCE_CELL_MS };
}
/** Auto keeps the GPU unless its fixed costs exceed the whole CPU run, which only happens for very small grids. */
export function preferCpuGeneration(work: GenerationWork): boolean {
  const cost = generationCostMs(work);
  return cost.cpu < cost.gpu;
}

/** Imports preserve available detail up to a practical default of 4096 samples per side. */
export function defaultSourceSpacing(settings: DefinitionInput): number {
  const capability = terrainCapability(settings);
  const nativeN = settings.sketch?.processing === 'surface' ? settings.sketch.resolution : settings.sourceNativeResolution;
  return nativeN ? Math.max(capability.minSpacing, settings.width / nativeN, settings.width / 4096)
    : Math.max(DEFAULT_SAMPLE_SPACING, capability.minSpacing);
}

/** Validate before allocating any physical source or starting model inference. */
export function sourceDefinition(settings: DefinitionInput): SourceDefinition {
  const capability = terrainCapability(settings), width = settings.width;
  if (!Number.isFinite(width) || width < capability.minWidth || width > capability.maxWidth)
    throw new Error(`Terrain ${capability.kind}: largeur ${capability.minWidth}–${capability.maxWidth} m requise.`);
  const importedN = settings.sketch?.processing === 'surface' ? settings.sketch.resolution : settings.sourceNativeResolution;
  if (importedN !== undefined && (!Number.isSafeInteger(importedN) || importedN < 16 || importedN > MAX_SOURCE_RESOLUTION))
    throw new Error('Heightmap: définition native 16–8192 requise pour les villes.');
  const requestedSpacing = settings.sampleSpacing ?? defaultSourceSpacing(settings);
  if (capability.kind === 'finite-neural' && requestedSpacing !== capability.minSpacing)
    throw new Error(`Tile40: définition de sortie fixe ${capability.minSpacing} m (1024²).`);
  const maxSpacing = Math.min(1000, width / 16);
  if (!Number.isFinite(requestedSpacing) || requestedSpacing < capability.minSpacing || requestedSpacing > maxSpacing)
    throw new Error(`Terrain ${capability.kind}: pas de génération ${capability.minSpacing}–${maxSpacing} m requis.`);
  const nativeSpacing = capability.kind.includes('neural') ? NEURAL_NATIVE_SPACING : importedN ? width / importedN : undefined;
  if (importedN && requestedSpacing < width / importedN)
    throw new Error(`Heightmap: définition native ${(width / importedN).toFixed(2)} m ; un pas inférieur ne crée pas de détail.`);
  const n = importedN ? Math.min(importedN, Math.max(2, Math.ceil(width / requestedSpacing)))
    : capability.kind === 'finite-neural' ? 1024 : Math.max(2, Math.ceil(width / requestedSpacing));
  if (!Number.isSafeInteger(n) || n < 16 || n > MAX_SOURCE_RESOLUTION)
    throw new Error(`Terrain: ${n}² échantillons demandés ; maximum ${MAX_SOURCE_RESOLUTION}². Augmentez le pas de génération.`);
  const sourceBytes = n * n * 4;
  // Conservative CPU raster estimate, excluding model weights/activations and renderer caches.
  const estimatedWorkingBytes = n * n * (capability.kind.includes('neural') ? 32 : 96);
  if (estimatedWorkingBytes > MAX_SOURCE_WORKING_BYTES)
    throw new Error(`Terrain: budget des rasters dépassé (${Math.ceil(estimatedWorkingBytes / 1048576)} Mio estimés). Augmentez le pas de génération.`);
  return { ...capability, width, n, spacing: width / n, requestedSpacing, nativeSpacing, sourceBytes, estimatedWorkingBytes };
}
