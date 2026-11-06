import phasorShader from './terrainPhasor.wgsl?raw';
import { configureCompactPlan, phasorUniforms } from './terrainPhasor';
import { seedRoot, seedSubset, stepSeed } from './generationSeed';
import previewShader from './terrainGenerationPreview.wgsl?raw';
import { configureProceduralPlan, finalizePhysicalSurfacePlan, isCompactProcedural, stageEnabled, type GenerationControl, type GenerationStage } from './terrainGenerationRecipe';
import shader from './terrainErosion.wgsl?raw';
import noiseShader from './terrainNoise.wgsl?raw';
import volcanicShader from './terrainFinite.wgsl?raw';
import { GenerationNoisePlan, TerrainEngine, TerrainPipeline } from './wasmRuntime';
import { coreOperations, proceduralSignatures, TerrainFieldCheckpoints } from './terrainCheckpoints';
import { generationStageActive } from './terrainGenerationRecipe';
import type { Context } from './terrainGpu';
import type { TerrainSettings } from './terrain';
import { gpuSetupDeadline, type TerrainProgressCallback } from './terrainProgress';
import { gpuCapacityError, openSeaBand, openSeaRadius, sourceDefinition, type GenerationWork } from './terrainDefinition';

const ENTRIES = ['compactInitialize','compactReconstruct','generationUnitScale','generationKeepDatum','generationReconstruct','generationPreview', 'generationPlainPack', 'generationPhasorPack', 'initialize', 'uplift', 'start', 'clearNext', 'solveStats', 'floodInit', 'solveTile', 'receivers', 'flow', 'graphInit', 'graphFinish', 'floodCheck', 'pitInit', 'pitUnion', 'pitCompress', 'pitReduce', 'pitPour', 'pitFill', 'breachInit', 'breach', 'breachFinish', 'thermalFlux', 'thermalApply', 'copyHeight', 'bounds', 'diffuse', 'reconstruct', 'percentileInit', 'histogramClear', 'histogram', 'percentileSelect', 'detail', 'normalize', 'volcanicInitial', 'surfaceLoad', 'surfaceFlowInit', 'surfaceDelta', 'surfaceReconstruct', 'canyonSeed', 'canyonSpread', 'canyonApply', 'coastLoad', 'coastResult', 'packHeight', 'seaLandMark', 'seaMaskGrow'] as const;
type Entry = typeof ENTRIES[number] | 'generationCut' | 'generationRegionalRead';
interface GpuCheckpoint { key: string; kind: number; nodes?: GPUBuffer; fine?: GPUBuffer; control: GPUBuffer }
const retainedStages = new WeakMap<GPUDevice, Map<GenerationStage, GpuCheckpoint>>();
const packedFields = new WeakMap<GPUDevice, TerrainFieldCheckpoints>();
const checkpointDevices = new Set<GPUDevice>();
function freeCheckpoint(value: GpuCheckpoint): void { value.nodes?.destroy(); value.fine?.destroy(); value.control.destroy(); }
export function releaseGpuTerrainCheckpoints(): void {
  for(const device of checkpointDevices){retainedStages.get(device)?.forEach(freeCheckpoint);retainedStages.delete(device);packedFields.delete(device);}
  checkpointDevices.clear();
}
interface Pipelines {
  layout: GPUBindGroupLayout; values: Map<string, GPUComputePipeline>;
  module: GPUShaderModule; pipelineLayout: GPUPipelineLayout;
  pending: Map<string, Promise<GPUComputePipeline>>;
}
const compiled = new WeakMap<GPUDevice, Promise<Pipelines>>();
const scratch = new WeakMap<GPUDevice, GPUBuffer[]>();
const pending = new WeakMap<GPUDevice, Promise<unknown>>();
const queries = new WeakMap<GPUDevice, GPUQuerySet>();
const warmed = new WeakSet<GPUDevice>();
/** Above this, a run returns its buffers instead of keeping them for the next one. */
const RETAINED_POOL_BYTES = 512 * 1048576;
/** Stage checkpoints and previews follow the CPU pipeline: above this source, one pass without copies. */
const CHECKPOINT_SOURCE = 1024;
/** The first 1088 bytes are read back; the open-sea bits behind them stay on the device. */
const CONTROL_STATUS_BYTES = 1088, CONTROL_BYTES = CONTROL_STATUS_BYTES + 4096;
function serialized<T>(state: Context, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(state.device) ?? Promise.resolve()).then(operation);
  pending.set(state.device, result.then(() => undefined, () => undefined));
  return result;
}
async function pipelines(device: GPUDevice, entries: Set<Entry>, modes: Set<number>,progress?:TerrainProgressCallback): Promise<Pipelines> {
  let result = compiled.get(device);
  if (!result) {
    result = (async () => {
      const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 224 } },
        ...[1, 2].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' as const } })),
        ...[3, 4, 5, 6, 7].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' as const } })),
      ] });
      const module = device.createShaderModule({ code: shader.replace('// NOISE_KERNEL', noiseShader).replace('// VOLCANIC_KERNEL', volcanicShader) + phasorShader + previewShader });
      const messages = await gpuSetupDeadline(module.getCompilationInfo());
      const errors = messages.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(error => `${error.lineNum}: ${error.message}`).join('\n'));
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      return { layout, module, pipelineLayout, values: new Map<string, GPUComputePipeline>(), pending: new Map<string, Promise<GPUComputePipeline>>() };
    })();
    compiled.set(device, result);
  }
  progress?.('GPU · préparation des shaders d’érosion…',{stage:'gpu-erosion-compile'});
  const program = await gpuSetupDeadline(result);
  const ready: Promise<GPUComputePipeline>[] = [];
  const total=[...entries].reduce((n,entry)=>n+(entry==='solveTile'?modes.size:1),0);let completed=0;
  for (const entryPoint of entries) for (const mode of entryPoint === 'solveTile' ? modes : [undefined]) {
    const key = mode === undefined ? entryPoint : `solveTile:${mode}`;
    let pipeline = program.pending.get(key);
    if (!pipeline) {
      pipeline = device.createComputePipelineAsync({ layout: program.pipelineLayout, compute: { module: program.module, entryPoint, ...(mode === undefined ? {} : { constants: { SOLVE_MODE: mode } }) } });
      pipeline = pipeline.then(value => { program.values.set(key, value); return value; });
      program.pending.set(key, pipeline);
    }
    ready.push(pipeline.then(value=>{completed++;progress?.(`GPU · shaders d’érosion prêts ${completed}/${total}`,{stage:'gpu-erosion-compile',completed,total});return value;}));
  }
  await gpuSetupDeadline(Promise.all(ready));
  warmed.add(device);
  return program;
}

class ConvergenceError extends Error {}
/** The adapter cannot hold this run; Auto falls back to the CPU, an explicit GPU choice reports it. */
export class GpuCapacityError extends Error {}
export interface ErosionProfile {
  factor: number; sourceSize: number; coarseSize: number; surfaceSize: number; pipelineMs: number;
  encodeMs: number; submitReadbackMs: number; unpackMs: number;
  maxSolveSteps: number[]; allocatedBytes?: number;
  gpuStagesMs?: { coarse: number; surface: number; normalization: number };
}
interface Timing { nativeEnvironmentMs: number; profiles?: ErosionProfile[]; control?: GenerationControl;
  onPhysicalPlan?: (erosionSpacing?: number, regionalErosionSpacing?: number) => void }

interface ErosionPlan { noise: GenerationNoisePlan; parameters: Float32Array; surface: Float32Array; original: Float32Array }
/** One plan for the scheduler and the preflight. The caller frees `noise`. */
function erosionPlan(settings: TerrainSettings, sourceN: number, relief: string, compact: boolean, coast?: Float32Array): ErosionPlan {
  const noise = GenerationNoisePlan.erosion_at_resolution(settings.seed, settings.width, relief, settings.erosion, settings.motifSize, settings.mountainMix, sourceN);
  try {
    const original = noise.parameters();
    const configured = compact ? configureCompactPlan(original, settings, coast) : { parameters: original, surface: (coast ?? original.slice(24,32)).slice() };
    configureProceduralPlan(configured.parameters, configured.surface, settings, compact, !!coast);
    finalizePhysicalSurfacePlan(configured.surface, settings, sourceN);
    return { noise, parameters: configured.parameters, surface: configured.surface, original };
  } catch (error) { noise.free(); throw error; }
}
const REGIONAL_RELIEFS = ['hills', 'mountains', 'mixed', 'high-mountains', 'valley', 'canyon'];
/** Sizes of a procedural run on this device, and why it cannot run there if so. Allocates nothing. */
export function planGpuErosion(state: Context, settings: TerrainSettings): GenerationWork & { error?: string } {
  const sourceN = sourceDefinition(settings).n, compact = isCompactProcedural(settings);
  const relief = REGIONAL_RELIEFS.includes(settings.relief) ? settings.relief : settings.relief === 'flat' ? 'hills' : 'mixed';
  const { noise, parameters, surface } = erosionPlan(settings, sourceN, relief, compact); noise.free();
  const regionalN = parameters[2], surfaceN = surface[0], surfaceSteps = surface[3];
  const error = gpuCapacityError(state.device.limits, sourceN, Math.max(regionalN, settings.erosion > 0 && (!compact || surfaceSteps > 0) ? surfaceN : 0));
  return { sourceN, regionalN, regionalSteps: parameters[13], surfaceN, surfaceSteps, pipelinesReady: warmed.has(state.device), error };
}

/** Cut/assembled coast -> the existing hydraulic/thermal surface pass, without normalization. */
export async function erodeGpuCoast(state: Context, settings: TerrainSettings, source: GPUBuffer, tuning: Float32Array,progress?:TerrainProgressCallback): Promise<Float32Array> {
  return serialized(state, () => erodeCoast(state, settings, source, tuning,progress));
}
async function erodeCoast(state: Context, settings: TerrainSettings, source: GPUBuffer, tuning: Float32Array,progress?:TerrainProgressCallback): Promise<Float32Array> {
  const sourceN = sourceDefinition(settings).n;
  for (const factor of [1, 2, 4, 8, 16]) {
    try { return await generateOnce(state, settings, sourceN, factor, undefined, { source, tuning },undefined,progress); }
    catch (error) { if (!(error instanceof ConvergenceError) || factor === 16) throw error; }
  }
  throw new Error('Érosion littorale GPU non convergée.');
}

/** All simulation state stays on the device; only the final physical raster is read. */
export async function generateGpuTerrain(state: Context, settings: TerrainSettings, timing?: Timing,progress?:TerrainProgressCallback): Promise<Float32Array> {
  timing?.control?.backend?.('gpu');
  return serialized(state, () => generateTerrain(state, settings, timing,progress));
}
async function generateTerrain(state: Context, settings: TerrainSettings, timing?: Timing,progress?:TerrainProgressCallback): Promise<Float32Array> {
  // Finite reliefs keep two planes of this n, whatever width each one covers.
  const sourceN = sourceDefinition(settings).n;
  if (settings.relief === 'volcano' || settings.relief === 'caldera' || settings.relief === 'plateau') {
    const plan = GenerationNoisePlan.finite_shape(settings.seed, settings.motifSize, settings.relief, settings.erosion);
    const shape = plan.parameters(); plan.free();
    const environment = settings.environment ?? 'mixed';
    const motif = settings.motifSize * shape[15];
    // Plains retain the native analytic/shape-erosion path; geological erosion stays GPU.
    let background: Float32Array;
    if (environment === 'flat') {
      const started = performance.now();
      progress?.('CPU · préparation du relief environnant…',{stage:'terrain-environment'});
      background = TerrainEngine.prepare_environment_at_resolution(settings.seed, settings.width, environment, settings.erosion, motif, sourceN);
      if (timing) timing.nativeEnvironmentMs = performance.now() - started;
    } else {
      background = await generateWithBudget(state, { ...settings, motifSize: motif, relief: environment, mountainMix: .5 }, sourceN, undefined, timing,progress);
    }
    const local = await generateWithBudget(state, { ...settings, width: settings.motifSize }, sourceN, shape, timing,progress);
    const fields = new Float32Array(local.length + background.length);
    fields.set(local); fields.set(background, local.length); return fields;
  }
  return generateWithBudget(state, settings, sourceN, undefined, timing,progress);
}
async function generateWithBudget(state: Context, settings: TerrainSettings, sourceN: number, shape?: Float32Array, timing?: Timing,progress?:TerrainProgressCallback): Promise<Float32Array> {
  // A difficult drainage network gets more GPU passes, rather than truncated erosion.
  for (const factor of [1, 2, 4, 8, 16]) {
    try { return await generateOnce(state, settings, sourceN, factor, shape, undefined, timing,progress); }
    catch (error) { if (!(error instanceof ConvergenceError) || factor === 16) throw error; }
  }
  throw new Error('Érosion GPU non convergée.');
}

async function generateOnce(state: Context, settings: TerrainSettings, sourceN: number, factor: number, shape?: Float32Array, coast?: { source: GPUBuffer; tuning: Float32Array }, timing?: Timing,progress?:TerrainProgressCallback): Promise<Float32Array> {
  const device = state.device, lab = coast ? undefined : timing?.control, compact = isCompactProcedural(settings);
  const seededStages = !!settings.generalSeed && seedSubset(settings.generalSeed, key => key.startsWith('relief-')) !== seedRoot(settings.generalSeed);
  const { noise: plan, parameters, surface: tuning, original: originalParameters } = erosionPlan(settings, sourceN, coast || compact && settings.relief === 'flat' ? 'hills' : shape ? 'mixed' : settings.relief, compact, coast?.tuning);
  // The pool grows on demand and survives size and seed changes, within its budget.
  let buffers = scratch.get(device);
  if (!buffers) {
    buffers = []; scratch.set(device, buffers);
    const owned = buffers; void device.lost.then(() => owned.forEach(buffer => buffer.destroy()));
  }
  const previews = !!lab && lab.previews !== false && sourceN <= CHECKPOINT_SOURCE;
  let releasePool = !!lab && lab.previews !== false;
  let bufferIndex = 0;
  try {
    if(compact && settings.procedural && stageEnabled(settings,'ridged',false) && settings.erosionTuning?.detail === undefined && settings.procedural.erosionTuning?.detail === undefined)parameters[16]=originalParameters[16];
    const base = parameters.slice(0,24);
    const n = base[2], iterations = base[13], strength = base[18];
    // Overridable settings block (fill ×, carve, final carve, incision slope, thermal ×, warp ×, routed, surface carve).
    const block = coast ? [1, 0, 0, .2, 1, 1, 0, 0] : Array.from(parameters.slice(33, 41));
    const surfaceBlock = block.slice(); surfaceBlock[4] = 1;
    const routed = !coast && block[6] > .5;
    const coarseFactor = Math.min(factor, 4);
    const surface = base.slice();
    surface[2] = tuning[0]; surface[4] = tuning[1]; surface[5] = tuning[2];
    surface[15] = shape && !coast ? shape[13] : tuning[4]; surface[18] = tuning[5]; surface[22] = tuning[6];
    // A flow path crosses more tiles on a larger grid; the budget follows it instead of failing and retrying.
    const gridScale = Math.max(1, surface[2] / 1048);
    const surfacePasses = Math.ceil(Math.min((shape || coast || settings.relief === 'mixed' ? 64 : 32) * factor, 512) * gridScale);
    const packEntry:Entry=!coast && stageEnabled(settings,'phasor',compact) ? 'generationPhasorPack' : 'packHeight';
    const initializeEntry:Entry=compact?'compactInitialize':'initialize';
    const surfaceEnabled=!!coast || stageEnabled(settings,'surface',!compact || settings.relief==='canyon') && (!compact || settings.relief==='canyon' || tuning[3]>0);
    const reportPhysicalPlan=()=>{if(!coast)timing?.onPhysicalPlan?.(
      settings.erosion>0 && surfaceEnabled && tuning[3]>0 ? tuning[1] : undefined,
      !shape && settings.erosion>0 && (stageEnabled(settings,'regional') || stageEnabled(settings,'regionalFinish')) ? base[4] : undefined,
    );};
    const reconstructEntry:Entry=settings.procedural?.reconstruction && settings.procedural.reconstruction!=='default' ? 'generationReconstruct':compact?'compactReconstruct':'reconstruct';
    const entries = new Set<Entry>([packEntry,...(!stageEnabled(settings,'amplitude')?['generationUnitScale' as const]:[]),...(!stageEnabled(settings,'normalize')?['generationKeepDatum' as const]:[]), ...(lab ? ['generationPreview' as const] : []), ...(!coast && !shape && settings.procedural ? ['generationCut','generationRegionalRead','generationPreview'] as const : [])]), modes = new Set<number>();
    const require = (...values: Entry[]) => values.forEach(value => entries.add(value));
    if (seededStages && !coast && !shape) require('generationCut', 'generationRegionalRead', 'generationPreview');
    if (coast || !shape && (seededStages || settings.procedural)) require('seaLandMark', 'seaMaskGrow');
    const graph = () => require('start', 'clearNext', 'solveStats', 'solveTile', 'receivers', 'flow', 'graphInit', 'graphFinish', 'thermalFlux', 'thermalApply', 'copyHeight', 'diffuse');
    if (coast) require('coastLoad', 'coastResult');
    else require('percentileInit', 'histogramClear', 'histogram', 'percentileSelect', 'normalize');
    if (!coast && !shape) {
      require(initializeEntry,'uplift','bounds',reconstructEntry,'detail');
      if (strength > 0) {
        graph(); require('floodInit', 'floodCheck', 'pitInit', 'pitUnion', 'pitCompress', 'pitReduce', 'pitPour', 'pitFill', 'breachInit', 'breach', 'breachFinish');
        [0, 1, 2].forEach(mode => modes.add(mode));
      }
    } else if (shape && !coast) require('volcanicInitial');
    if (settings.erosion > 0 && surfaceEnabled) {
      graph(); require('surfaceLoad', 'surfaceFlowInit', 'surfaceDelta', 'surfaceReconstruct'); modes.add(1); modes.add(3);
      if (settings.relief === 'canyon' && !coast) { require('floodInit', 'floodCheck', 'canyonSeed', 'canyonSpread', 'canyonApply'); modes.add(0); }
      if (routed) { require('floodInit', 'floodCheck', 'pitInit', 'pitUnion', 'pitCompress', 'pitReduce', 'pitPour', 'breachInit', 'breach', 'breachFinish'); modes.add(0); }
    }
    if(lab)await lab.before('grids',`Budget ×${factor} · régional ${n}² · surface ${surface[2]}² · sortie ${sourceN}²`);
    const pipelineStarted = performance.now();
    const program = await pipelines(device, entries, modes,progress);
    const pipelineMs = performance.now() - pipelineStarted, encodeStarted = performance.now();
    progress?.('GPU · préparation des buffers d’érosion…',{stage:'gpu-erosion-buffers'});
    let allocated = false;
    const create = (size: number, usage: GPUBufferUsageFlags) => {
      const index = bufferIndex++;
      let buffer = buffers[index];
      if (!buffer || buffer.size < size || buffer.usage !== usage) {
        buffer?.destroy(); buffer = device.createBuffer({ size, usage }); buffers[index] = buffer; allocated = true;
      }
      return buffer;
    };
    const upload = (data: Uint32Array | Float32Array) => {
      const buffer = create(data.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(buffer, 0, data as GPUAllowSharedBufferSource); return buffer;
    };
    // A disabled surface stage needs no surface nodes. A small source can still
    // read a larger regional grid through `output` for an early coast.
    const simulationN = settings.erosion > 0 && surfaceEnabled ? Math.max(n, surface[2]) : n;
    const sourceCells = sourceN ** 2, sourceBytes = sourceCells * 4, fineBytes = sourceCells * 16, fieldBytes = Math.max(sourceCells, n * n) * 4;
    device.pushErrorScope('out-of-memory');
    const uniform = create(65536, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const nodes = create(simulationN ** 2 * 112, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    const fine = create(fineBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    const control = create(CONTROL_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    const output = create(fieldBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    const readback = create(fieldBytes + 1088, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    const tileFlags = create(Math.ceil(simulationN / 16) ** 2 * 8, GPUBufferUsage.STORAGE);
    const outOfMemory = device.popErrorScope();
    if (allocated && await outOfMemory) { releasePool = true; throw new GpuCapacityError(`WebGPU : mémoire insuffisante pour la source ${sourceN}² et la grille d’érosion ${simulationN}².`); }
    releasePool ||= buffers.reduce((sum, buffer) => sum + buffer.size, 0) > RETAINED_POOL_BYTES;
    /** Maps the leading bytes only: a retained pool can be larger than this run. */
    const mapHeader = (bytes: number) => readback.mapAsync(GPUMapMode.READ, 0, bytes);
    const mappedHeader = (bytes: number) => readback.getMappedRange(0, bytes);
    const resumable = !coast && !shape && !!(settings.procedural || seededStages);
    const retainStages = resumable && sourceN <= CHECKPOINT_SOURCE;
    const inspect=previews || resumable;
    let querySet = inspect ? undefined : queries.get(device);
    if (!inspect && !querySet && device.features.has('timestamp-query')) {
      querySet = device.createQuerySet({ type: 'timestamp', count: 6 }); queries.set(device, querySet);
      const owned = querySet; void device.lost.then(() => owned.destroy());
    }
    const queryBuffer = querySet ? create(48, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC) : undefined;
    const queryReadback = querySet ? create(48, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ) : undefined;
    const makeGroup = (permutations: Uint32Array, gradients: Float32Array) => device.createBindGroup({ layout: program.layout, entries: [
      { binding: 0, resource: { buffer: uniform, size: 224 } },
      ...[upload(permutations), upload(gradients), nodes, fine, control, output, tileFlags].map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
    ] });
    let group = makeGroup(plan.permutations(), plan.gradients());
    const seedGroups = new Map([[settings.seed, group]]);
    const stageNoise = (stage: GenerationStage) => {
      const key = { initialize: 'relief-noise', reconstruct: 'relief-reconstruct', ridged: 'relief-detail' }[stage as 'initialize' | 'reconstruct' | 'ridged'];
      if (!key || !settings.generalSeed) return;
      const seed = stepSeed(settings.generalSeed, key);
      let found = seedGroups.get(seed);
      if (!found) {
        const noise = GenerationNoisePlan.erosion(seed, settings.width, settings.relief, settings.erosion, settings.motifSize, settings.mountainMix);
        try { found = makeGroup(noise.permutations(), noise.gradients()); } finally { noise.free(); }
        seedGroups.set(seed, found);
      }
      group = found;
    };
    const variants = new Map<string, number>();
    let settingsBlock = block;
    const offset = (extra: number[], config: Float32Array) => {
      const key = [...config, ...extra, ...settingsBlock].join(','); let value = variants.get(key);
      if (value === undefined) {
        value = variants.size * 256; if (value + 224 > 65536) throw new Error('Too many GPU variants.');
        variants.set(key, value); device.queue.writeBuffer(uniform, value, new Float32Array([...config, ...extra, ...(compact ? phasorUniforms(settings,!!coast) : !shape && !coast && stageEnabled(settings,'phasor',false) ? phasorUniforms(settings) : shape ?? new Float32Array(16)), ...settingsBlock]));
      }
      return value;
    };
    let encoder = device.createCommandEncoder();
    encoder.clearBuffer(control);
    if (coast) encoder.copyBufferToBuffer(coast.source, 0, fine, 0, fineBytes);
    const beginPass = (index: number) => encoder.beginComputePass(querySet ? { timestampWrites: { querySet, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 } } : undefined);
    let pass = beginPass(0);
    const normal = [0, 0, 1, 0, 0, 0, .6, 0];
    normal[4] = parameters[32];
    const tail = [0, 0, .95, strength * .5, 0, 0, .5, 0];
    let config = base;
    const dispatch = (entry: Entry, extra = normal, groups = Math.ceil(config[2] ** 2 / 256), y = 1) => {
      pass.setPipeline(program.values.get(entry === 'solveTile' ? `solveTile:${extra[1]}` : entry)!);
      pass.setBindGroup(0, group, [offset(extra, config)]); pass.dispatchWorkgroups(groups, y);
    };
    // Simulation grids stay within one dimension; a 4096² source does not.
    const sourceGroups = Math.ceil(sourceCells / 256), sourceRows = Math.ceil(sourceGroups / device.limits.maxComputeWorkgroupsPerDimension);
    const dispatchSource = (entry: Entry, extra = normal) => dispatch(entry, extra, Math.ceil(sourceGroups / sourceRows), sourceRows);
    const solve = (mode: number, passes: number, fixedSea = false) => {
      const extras = normal.slice(); extras[1] = mode; extras[7] = fixedSea ? 1 : 0;
      dispatch(mode === 0 ? 'floodInit' : 'graphInit', extras); dispatch('start', extras, 1);
      const offsets = [0, 1].map(phase => { extras[0] = phase; return offset(extras, config); });
      for (let step = 0; step < passes; step++) {
        const dynamicOffset = [offsets[step & 1]];
        pass.setPipeline(program.values.get('clearNext')!); pass.setBindGroup(0, group, dynamicOffset); pass.dispatchWorkgroups(1);
        pass.setPipeline(program.values.get(`solveTile:${mode}`)!); pass.dispatchWorkgroups(Math.ceil(config[2] / 16), Math.ceil(config[2] / 16));
      }
      extras[0] = 0;
      dispatch('solveStats', extras, 1);
      if (mode === 0) { dispatch('floodCheck', extras, 1); dispatch('receivers'); }
      else dispatch('graphFinish', extras);
    };
    const pits = (extra = normal, fill = true) => {
      dispatch('pitInit');
      for (let k = 0; k < 8 * coarseFactor + Math.ceil(Math.log2(Math.max(1, config[2] / 1048))); k++) { dispatch('pitUnion'); dispatch('pitCompress'); }
      for (const entry of fill ? ['pitReduce', 'pitPour', 'pitFill'] as const : ['pitReduce', 'pitPour'] as const) dispatch(entry, extra);
    };
    // Lowers each depression's sill towards `carve` of its depth (CPU `carve_sills`).
    const carve = (amount: number) => {
      if (amount <= 0) return;
      const extras = normal.slice(); extras[6] = amount;
      dispatch('breachInit'); dispatch('breach', extras); dispatch('breachFinish');
    };
    const thermal = (passes: number, extra = normal) => {
      if(config===base && settings.procedural?.regionalThermal===false)return;
      for (let k = 0; k < passes; k++) for (const entry of ['thermalFlux', 'thermalApply', 'copyHeight'] as const) dispatch(entry, extra);
    };
    const diffuse = (weight: number, extra = normal) => {
      if(config===base && settings.procedural?.regionalDiffusion===false)return;
      const values = extra.slice(); values[3] = weight; dispatch('diffuse', values); dispatch('copyHeight', values);
    };
    // The mask exists only once a coast is cut: `control` starts cleared, and until then nothing skips.
    const buildOpenSea = (kind: number) => {
      const radius = openSeaRadius(openSeaBand({ surfaceSteps: tuning[3], surfaceCell: tuning[1], regionalCell: base[4], sourceCell: base[11], warp: block[5] * Math.min(16 * base[3], base[4] * .9) }), settings.width);
      if (radius === undefined) return;
      const extras = normal.slice(); extras[7] = kind;
      if (kind === 0) dispatch('seaLandMark', extras); else dispatchSource('seaLandMark', extras);
      extras[5] = radius; dispatch('seaMaskGrow', extras, 2);
    };
    const percentile = (source: number) => {
      const extras = normal.slice(); extras[4] = source; dispatch('percentileInit', extras, 1);
      for (const shift of [24, 16, 8, 0]) {
        extras[5] = shift; dispatch('histogramClear', extras, 1); dispatchSource('histogram', extras); dispatch('percentileSelect', extras, 1);
      }
    };
    const snapshot = async (stage:GenerationStage,kind:number,detail?:string) => {
      if(!lab)return;
      if(!previews){await lab.after(stage,undefined,detail);return;}
      if(kind!==3){const extras=normal.slice();extras[7]=kind;dispatchSource('generationPreview',extras);}
      pass.end();encoder.copyBufferToBuffer(output,0,readback,0,sourceBytes);encoder.copyBufferToBuffer(control,0,readback,sourceBytes,1088);
      device.queue.submit([encoder.finish()]);await mapHeader(sourceBytes+1088);
      const mapped=mappedHeader(sourceBytes+1088),errors=new Uint32Array(mapped,sourceBytes,272)[2];
      const height=new Float32Array(mapped,0,sourceCells).slice();readback.unmap();
      if(errors)throw new ConvergenceError('Érosion GPU non convergée pendant une étape.');
      if(!height.every(Number.isFinite))throw new Error('Champ GPU intermédiaire invalide.');
      await lab.after(stage,height,detail);
      encoder=device.createCommandEncoder();pass=beginPass(0);
    };
    const operations=coreOperations(settings), signatures=proceduralSignatures(settings);
    let saved=retainStages?retainedStages.get(device):undefined;
    if(retainStages&&!saved){saved=new Map();retainedStages.set(device,saved);checkpointDevices.add(device);const owned=saved;void device.lost.then(()=>{owned.forEach(freeCheckpoint);owned.clear();checkpointDevices.delete(device);});}
    const stageKey=(stage:GenerationStage)=>`${factor}|${signatures.get(stage)}`;
    let first=0;
    while(saved&&first<operations.length&&saved.get(operations[first])?.key===stageKey(operations[first]))first++;
    if(saved)for(const stage of [...operations.slice(first),'phasor'] as GenerationStage[]){const previous=saved.get(stage);if(previous&&(stage!=='phasor'||previous.key!==stageKey(stage)||first<operations.length)){freeCheckpoint(previous);saved.delete(stage);}}
    const restore=(value:GpuCheckpoint)=>{
      pass.end();
      if(value.nodes)encoder.copyBufferToBuffer(value.nodes,0,nodes,0,value.nodes.size);
      if(value.fine)encoder.copyBufferToBuffer(value.fine,0,fine,0,value.fine.size);
      encoder.copyBufferToBuffer(value.control,0,control,0,CONTROL_BYTES);pass=beginPass(0);
    };
    const save=(stage:GenerationStage,kind:number)=>{
      if(!saved)return;
      pass.end();
      const copy=(source:GPUBuffer,size=source.size)=>{const target=device.createBuffer({size,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});encoder.copyBufferToBuffer(source,0,target,0,size);return target;};
      const previous=saved.get(stage);if(previous)freeCheckpoint(previous);
      saved.set(stage,{key:stageKey(stage),kind,...(kind===0?{nodes:copy(nodes,n*n*112)}:{fine:copy(fine,fineBytes)}),control:copy(control,CONTROL_BYTES)});
      device.queue.submit([encoder.finish()]);encoder=device.createCommandEncoder();pass=beginPass(0);
    };
    const reportCached=async(stage:GenerationStage,value:GpuCheckpoint)=>{
      if(!lab)return;
      if(!previews){if(lab.cached)await lab.cached(stage);else{await lab.before(stage);await lab.after(stage);}return;}
      const extras=normal.slice();extras[7]=value.kind;dispatchSource('generationPreview',extras);
      pass.end();encoder.copyBufferToBuffer(output,0,readback,0,sourceBytes);
      device.queue.submit([encoder.finish()]);await mapHeader(sourceBytes);
      const height=new Float32Array(mappedHeader(sourceBytes),0,sourceCells).slice();readback.unmap();
      if(lab.cached)await lab.cached(stage,height);else{await lab.before(stage);await lab.after(stage,height);}
      encoder=device.createCommandEncoder();pass=beginPass(0);
    };
    const runStage=async(stage:GenerationStage,kind:number,operation:()=>void|Promise<void>)=>{
      const index=operations.indexOf(stage),cached=saved?.get(stage);
      if(cached&&index>=0&&index<first){
        if(previews||index===first-1)restore(cached);
        await reportCached(stage,cached);return;
      }
      await lab?.before(stage);stageNoise(stage);await operation();save(stage,kind);await snapshot(stage,kind);
    };
    const coastAfter=settings.procedural?.coastAfter??'initialize';
    const earlyCoast=async(stage:GenerationStage,kind:number)=>{
      if(!resumable||stage!==coastAfter)return;
      await runStage('coastCut',kind===4?5:kind,async()=>{
        if(!generationStageActive(settings,'coastCut'))return;
        const extras=normal.slice();extras[7]=kind;
        if(kind===0)dispatch('generationRegionalRead',extras,Math.ceil(n*n/256));else dispatchSource('generationPreview',extras);
        pass.end();const count=kind===0?n*n:sourceCells;
        encoder.copyBufferToBuffer(output,0,readback,0,count*4);device.queue.submit([encoder.finish()]);
        await mapHeader(count*4);const source=new Float32Array(mappedHeader(count*4),0,count).slice();readback.unmap();
        const cut=TerrainPipeline.cut_field(stepSeed(settings.generalSeed??settings.seed,'relief-coast-cut'),settings.width,parameters[3]*2400,parameters[12],settings.coastMask!,settings.islandMode??'island',kind===0?n:sourceN,kind===0?base[5]:0,kind===0?base[4]:base[11],source);
        device.queue.writeBuffer(output,0,cut as GPUAllowSharedBufferSource);
        encoder=device.createCommandEncoder();pass=beginPass(0);if(kind===0)dispatch('generationCut',extras,Math.ceil(n*n/256));else dispatchSource('generationCut',extras);
        buildOpenSea(kind);
      });
    };
    if(lab)await lab.after('grids',undefined,`Budget ×${factor} · régional ${n}² · surface ${surface[2]}² · ${(buffers.reduce((sum,b)=>sum+b.size,0)/1048576).toFixed(1)} Mio`);
    progress?.(`GPU · encodage de ${iterations} cycles de relief et ${tuning[3]} passes d’érosion…`,{stage:'gpu-erosion-encode'});
    if (coast) {
      config = surface; dispatchSource('coastLoad'); buildOpenSea(2);
    } else if (!shape) {
      await runStage('initialize',0,()=>{dispatch(initializeEntry);});
      await earlyCoast('initialize',0);
      await runStage('regional',0,()=>{
      for (let iteration = 0; iteration < (stageEnabled(settings,'regional') ? iterations : 0); iteration++) {
        dispatch('uplift');
        if (strength > 0) {
          solve(0, 64 * coarseFactor); pits(); carve(block[1]); dispatch('flow'); solve(1, 128 * coarseFactor); solve(2, 128 * coarseFactor); thermal(3);
          const dose = base[17] * 3 * strength;
          for (let k = 0; k < Math.floor(dose); k++) diffuse(.5);
          if (dose % 1 > 0) diffuse(.5 * (dose % 1));
        }
        dispatch('bounds');
      }
      });
      await runStage('regionalFinish',0,()=>{
      const clamp = normal.slice(); clamp[7] = 1; dispatch('bounds', clamp);
      if (strength > 0 && stageEnabled(settings,'regionalFinish')) {
        thermal(4, tail);
        for (let k = 0; k < 2; k++) { solve(0, 64 * coarseFactor); pits(tail); carve(block[2]); }
        diffuse(strength * .5, tail);
      }
      });
      await earlyCoast('regionalFinish',0);
      await runStage('reconstruct',1,()=>{
      const reconstructionParams=normal.slice();reconstructionParams[7]=settings.procedural?.reconstruction==='bspline'?1:0;
      dispatchSource(reconstructEntry,reconstructionParams);
      });
      await runStage('amplitude',4,()=>{
      if(stageEnabled(settings,'amplitude'))percentile(0);else dispatch('generationUnitScale',normal,1);
      });
      await earlyCoast('amplitude',4);
      await runStage('ridged',2,()=>{
      dispatchSource('detail');
      });
      await earlyCoast('ridged',2);
    } else {
      if(lab)await lab.before('initialize');
      config=surface;dispatchSource('volcanicInitial');
      if(lab)await snapshot('initialize',2);
    }
    pass.end(); pass = beginPass(2);
    await runStage('surface',2,()=>{
    if (settings.erosion > 0 && surfaceEnabled) {
      config = surface; settingsBlock = surfaceBlock; dispatch('surfaceLoad');
      if (settings.relief === 'canyon' && !coast) {
        // Basin routing supplies continuous trunk rivers. Only this relief
        // deliberately enlarges their incision into deep, broad canyons.
        const canyonPasses = Math.ceil(128 * coarseFactor * gridScale);
        solve(0, canyonPasses); dispatch('flow'); solve(1, canyonPasses);
        dispatch('canyonSeed');
        let phase = 0;
        const jumps: number[] = [];
        for (let jump = 2 ** (Math.ceil(Math.log2(surface[2])) - 1); jump >= 1; jump /= 2) jumps.push(jump);
        jumps.push(1, 1);
        for (const jump of jumps) {
          const extras = normal.slice(); extras[0] = phase; extras[1] = jump;
          dispatch('canyonSpread', extras); phase = 1 - phase;
        }
        const extras = normal.slice(); extras[0] = phase; dispatch('canyonApply', extras);
      }
      for (let step = 0; step < tuning[3]; step++) {
        // Routed: water crosses depressions to their spill, whose sill is carved.
        if (routed) { solve(0, surfacePasses); pits(normal, false); carve(block[7]); }
        else { dispatch('surfaceFlowInit'); dispatch('receivers'); }
        dispatch('flow');
        // Surface graphs converge sooner than the basin-wide coarse graph;
        // mixed/finite/coastal surfaces need a longer initial budget. Retain
        // validation and retries up to the old 512-pass ceiling.
        solve(1, surfacePasses, true); solve(3, surfacePasses, true); thermal(1);
        diffuse(tuning[7]);
      }
      dispatch('surfaceDelta'); dispatchSource('surfaceReconstruct');
    }
    });
    await earlyCoast('surface',2);
    pass.end(); pass = beginPass(4);
    await runStage('normalize',1,()=>{
    if (coast) dispatchSource('coastResult');
    else if(stageEnabled(settings,'normalize')){percentile(1);dispatchSource('normalize');}else dispatchSource('generationKeepDatum');
    });
    await earlyCoast('normalize',1);
    let packed=packedFields.get(device);if(!packed){packed=new TerrainFieldCheckpoints();packedFields.set(device,packed);}
    const cachedPhasor=retainStages?packed.get('phasor',stageKey('phasor')):undefined;
    if(cachedPhasor){
      pass.end();device.queue.submit([encoder.finish()]);
      if(lab?.cached)await lab.cached('phasor',previews?cachedPhasor:undefined);
      else{await lab?.before('phasor');await lab?.after('phasor',cachedPhasor);}
      reportPhysicalPlan();
      return cachedPhasor;
    }
    if(!cachedPhasor)await lab?.before('phasor');
    dispatchSource(packEntry);
    pass.end();
    const bytes = sourceBytes;
    encoder.copyBufferToBuffer(output, 0, readback, 0, bytes); encoder.copyBufferToBuffer(control, 0, readback, bytes, 1088);
    if (querySet && queryBuffer && queryReadback) {
      encoder.resolveQuerySet(querySet, 0, 6, queryBuffer, 0); encoder.copyBufferToBuffer(queryBuffer, 0, queryReadback, 0, 48);
    }
    const command = encoder.finish(), encodeMs = performance.now() - encodeStarted;
    progress?.(coast?'GPU · calcul de l’érosion côtière…':'GPU · calcul du relief et de l’érosion…',{stage:'gpu-erosion-run'});
    const submitStarted = performance.now(); device.queue.submit([command]);
    const done=device.queue.onSubmittedWorkDone().then(()=>progress?.('GPU · lecture et validation des altitudes…',{stage:'gpu-readback'}));
    await Promise.all([mapHeader(bytes + 1088), queryReadback?.mapAsync(GPUMapMode.READ),done]);
    const submitReadbackMs = performance.now() - submitStarted, unpackStarted = performance.now();
    const mapped = mappedHeader(bytes + 1088); const status = new Uint32Array(mapped, bytes, 272);
    const maxSolveSteps = Array.from(status.slice(267, 271));
    const profile: ErosionProfile = { factor, sourceSize: sourceN, coarseSize: n, surfaceSize: surface[2], pipelineMs, encodeMs, submitReadbackMs, unpackMs: 0, maxSolveSteps, allocatedBytes:buffers.reduce((sum,buffer)=>sum+buffer.size,0) };
    if (queryReadback) {
      const values = new BigUint64Array(queryReadback.getMappedRange());
      profile.gpuStagesMs = { coarse: Number(values[1] - values[0]) / 1e6, surface: Number(values[3] - values[2]) / 1e6, normalization: Number(values[5] - values[4]) / 1e6 };
      queryReadback.unmap();
    }
    if (timing) (timing.profiles ??= []).push(profile);
    if (status[2] !== 0) { readback.unmap(); throw new ConvergenceError(`Érosion GPU non convergée (${status[2]} cellules/étapes, budget ×${factor}).`); }
    const height = new Float32Array(mapped, 0, sourceCells).slice();
    readback.unmap();
    profile.unpackMs = performance.now() - unpackStarted;
    const floor = coast || resumable && generationStageActive(settings,'coastCut') ? -Infinity : .3 - 1e-7;
    for (let i = 0; i < sourceCells; i++) if (!Number.isFinite(height[i]) || height[i] < floor) throw new Error('Champ GPU invalide.');
    reportPhysicalPlan();
    // Core snapshots are independent of the phasor pack, which reads the same fine field.
    if(retainStages)packed.put('phasor',stageKey('phasor'),height);
    if(lab)await lab.after('phasor',previews?height:undefined,'Sortie GPU lue et validée');
    return height;
  } catch(error) {
    if(error instanceof ConvergenceError){retainedStages.get(device)?.forEach(freeCheckpoint);retainedStages.get(device)?.clear();packedFields.delete(device);}
    throw error;
  } finally {
    plan.free();
    // Also recover a mapped staging buffer if validation/readback failed.
    buffers.forEach(buffer => { if (buffer.mapState !== 'unmapped') buffer.unmap(); if(releasePool)buffer.destroy(); });
    if(releasePool)scratch.delete(device);
  }
}
