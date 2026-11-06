import { GenerationNoisePlan, TerrainPipeline, onCoreWasmReset } from './wasmRuntime';
import { configureCompactPlan, applyPhasorCpu } from './terrainPhasor';
import { configureProceduralPlan, finalizePhysicalSurfacePlan, isCompactProcedural, generationStageActive, stageEnabled, type GenerationControl } from './terrainGenerationRecipe';
import { CORE_STAGES, coreOperations, proceduralSignatures, stableKey, TerrainFieldCheckpoints } from './terrainCheckpoints';
import { nativeRequest, nativeSession } from './nativeEngine';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import type { TerrainSettings } from './terrain';
import { stepSeed } from './generationSeed';
import { sourceDefinition } from './terrainDefinition';

interface Retained { root: string; keys: string[]; pipeline?: TerrainPipeline; runtime?: ExecutionRuntime; session?: string }
let retained: Retained | undefined;
const nativeSessions = new Map<string, string>();
let releasingNative = Promise.resolve();
const fields = new TerrainFieldCheckpoints();
export function releaseCpuCheckpoints(deadWasm = false): void {
  const old = retained; retained = undefined; fields.clear();
  if (!deadWasm) old?.pipeline?.free();
  if (old?.runtime) releasingNative = releasingNative.then(async () => {
    await nativeRequest(old.runtime!, '/terrain/stage', JSON.stringify({ session: old.session, command: 'cancel' })).catch(() => undefined);
  });
}
onCoreWasmReset(() => releaseCpuCheckpoints(true));

/** Exact Rust checkpoints survive inspection, including its early stop. */
export async function generateCpuTerrain(settings: TerrainSettings, control?: GenerationControl, runtime?: ExecutionRuntime,
  noise?: () => Promise<{ coarse: Float32Array; fine: Float32Array }>, onPhysicalPlan?: (erosionSpacing?: number, regionalErosionSpacing?: number) => void): Promise<Float32Array> {
  control?.backend?.(runtime ? 'native' : 'cpu');
  const physical = sourceDefinition(settings);
  const previews = control?.previews !== false && physical.n <= 1024;
  const compact = isCompactProcedural(settings), plan = GenerationNoisePlan.erosion_at_resolution(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, settings.mountainMix, physical.n);
  const original = plan.parameters(); plan.free();
  const { parameters: p, surface: s } = compact ? configureCompactPlan(original, settings) : { parameters: original, surface: original.slice(24, 32) };
  configureProceduralPlan(p, s, settings, compact);
  finalizePhysicalSurfacePlan(s, settings, physical.n);
  if (compact && stageEnabled(settings, 'ridged', false) && settings.erosionTuning?.detail === undefined && settings.procedural?.erosionTuning?.detail === undefined) p[16] = original[16];
  const enabled = (id: Parameters<typeof stageEnabled>[1], fallback = true) => Number(stageEnabled(settings, id, fallback));
  const flags = Uint32Array.from([Number(compact), enabled('regional'), enabled('regionalFinish'), enabled('amplitude'), enabled('ridged', !compact), enabled('surface', !compact || settings.relief === 'canyon'), enabled('normalize'), Number(settings.procedural?.regionalThermal !== false), Number(settings.procedural?.regionalDiffusion !== false), settings.procedural?.reconstruction === 'cubic' ? 1 : settings.procedural?.reconstruction === 'bspline' ? 2 : 0, Number(settings.relief === 'canyon')]);
  onPhysicalPlan?.(flags[5] && p[23] > 0 && s[3] > 0 ? s[1] : undefined, flags[1] && settings.erosion > 0 ? p[4] : undefined);
  const root = stableKey([settings.seed, settings.width, physical.n, p[2], runtime?.server ?? 'wasm', !!noise]);
  if (physical.n > 1024 || retained?.root !== root) releaseCpuCheckpoints();
  const operations = coreOperations(settings), signatures = proceduralSignatures(settings), keys = operations.map(id => signatures.get(id)!);
  let first = 0;
  while (retained && first < keys.length && retained.keys[first] === keys[first]) first++;
  const native = async (input: {command:string;[key:string]:unknown}) => {
    try { return await nativeRequest(runtime!, '/terrain/stage', JSON.stringify({ session: retained!.session, ...input })); }
    catch(error) {
      if(['coast','restore','preview'].includes(input.command)&&error instanceof Error&&error.message.includes('Invalid terrain stage'))
        throw new Error('Le service Rust natif utilise un ancien pipeline. Redémarrez-le avec le binaire reconstruit pour utiliser les points de reprise et la découpe côtière déplaçable.');
      throw error;
    }
  };
  const stepSeeds = settings.generalSeed ? Object.fromEntries([['initialize','relief-noise'],['coastCut','relief-coast-cut'],['reconstruct','relief-reconstruct'],['ridged','relief-detail']].map(([operation, key]) => [operation, stepSeed(settings.generalSeed!, key)])) : undefined;
  const configuration = { parameters: Array.from(p), surface: Array.from(s), flags: Array.from(flags), stepSeeds: stepSeeds ?? {} };
  const configureNative = async (input: { command: string; [key: string]: unknown }) => {
    const response = await native(input), ready = await response.json() as { ready?: boolean; stepSeeds?: boolean };
    if (stepSeeds && Object.values(stepSeeds).some(seed => seed !== settings.seed) && !ready.stepSeeds)
      throw new Error('Redémarrez le service Rust natif reconstruit pour utiliser les variations indépendantes du relief.');
  };
  if (!retained || first === 0) {
    releaseCpuCheckpoints();
    if(runtime&&!nativeSessions.has(runtime.server))nativeSessions.set(runtime.server,nativeSession());
    retained = { root, keys: [], runtime, ...(runtime ? { session: nativeSessions.get(runtime.server) } : {}) };
    await control?.before('grids', `Rust ${runtime ? 'natif' : 'WASM'} · régional ${p[2]}² · surface ${s[0]}² · source ${physical.n}² à ${physical.spacing.toFixed(2)} m`);
    if (runtime) { await releasingNative; await configureNative({ command: 'start', seed: settings.seed, ...configuration }); }
    else retained.pipeline = new TerrainPipeline(settings.seed, p, s, flags);
    await control?.after('grids');
  } else {
    if (control?.cached) await control.cached('grids');
    else { await control?.before('grids'); await control?.after('grids'); }
  }
  const current = retained!;
  if (!runtime) current.pipeline!.set_step_seeds(JSON.stringify(stepSeeds ?? {}));
  let height: Float32Array | undefined;
  for (let slot = 0; slot < operations.length; slot++) {
    const stage = operations[slot], cached = slot < first;
    if (!cached && slot === first && slot > 0) {
      if (runtime) await configureNative({ command: 'restore', checkpoint: slot - 1, ...configuration });
      else current.pipeline!.restore(slot - 1, p, s, flags);
      current.keys.length = slot;
    }
    if (cached) {
      if (previews || slot === operations.length - 1) {
        height = runtime ? new Float32Array(await (await native({ command: 'preview', checkpoint: slot })).arrayBuffer()) : current.pipeline!.checkpoint_height(slot);
      }
      if (control?.cached) await control.cached(stage, previews ? height : undefined);
      else { await control?.before(stage); await control?.after(stage, previews ? height : undefined); }
      continue;
    }
    await control?.before(stage);
    const cut = stage === 'coastCut' && generationStageActive(settings, 'coastCut');
    if (runtime) {
      const response = await native({ command: stage === 'coastCut' ? 'coast' : 'advance', stage: CORE_STAGES.indexOf(stage as typeof CORE_STAGES[number]),
        checkpoint: slot, mask: cut ? settings.coastMask : 0, mode: settings.islandMode ?? 'island', preview: previews || slot === operations.length - 1 });
      const bytes = await response.arrayBuffer(); if (bytes.byteLength) height = new Float32Array(bytes);
    } else {
      if (stage === 'initialize' && noise) { const values = await noise(); current.pipeline!.set_noise(values.coarse, values.fine); }
      if (stage === 'coastCut') { if (cut) current.pipeline!.cut_coast(settings.coastMask!, settings.islandMode ?? 'island'); }
      else current.pipeline!.advance(CORE_STAGES.indexOf(stage as typeof CORE_STAGES[number]));
      current.pipeline!.checkpoint(slot);
      if (previews || slot === operations.length - 1) height = current.pipeline!.height();
    }
    current.keys[slot] = keys[slot];
    await control?.after(stage, previews ? height : undefined);
  }
  const phasorKey = `${root}|${signatures.get('phasor')}`;
  const saved = physical.n <= 1024 ? fields.get('phasor', phasorKey) : undefined;
  if (saved) {
    if (control?.cached) await control.cached('phasor', previews ? saved : undefined);
    else { await control?.before('phasor'); await control?.after('phasor', saved); }
    return saved;
  }
  await control?.before('phasor');
  if (stageEnabled(settings, 'phasor', compact)) height = applyPhasorCpu(height!, settings);
  if (physical.n <= 1024) fields.put('phasor', phasorKey, height!);
  await control?.after('phasor', previews ? height : undefined);
  return height!;
}
