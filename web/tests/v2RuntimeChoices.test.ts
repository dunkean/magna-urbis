import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { normalizeRuntime, runtimeChoiceStates, runtimeSummary, runtimeValues, setRuntimeChoice } from '../src/v2/runtimeChoices';

const all = { checked: true, webgpu: true, native: true, python: true };
const none = { checked: true, webgpu: false, native: false, python: false };

describe('runtime choices', () => {
  it('classic engine forces procedural CPU and disables GPU/neural', () => {
    const s = defaultSettings(); s.generation = 'neural'; s.runtime!.source = 'neural-wasm';
    setRuntimeChoice(s, 'engine', 'typescript');
    expect(s.runtime).toMatchObject({ backend: 'typescript', source: 'procedural', compute: 'cpu' });
    expect(s.generation).toBe('procedural');
    const st = runtimeChoiceStates(s, all);
    expect(st.compute.gpu.enabled).toBe(false); expect(st.neural.python.enabled).toBe(false);
  });
  it('neural runtime follows the engine, Python is explicit', () => {
    const s = defaultSettings(); s.generation = 'neural'; s.runtime!.source = 'neural-wasm';
    setRuntimeChoice(s, 'engine', 'native'); expect(s.runtime!.source).toBe('neural');
    setRuntimeChoice(s, 'neural', 'python'); expect(s.runtime!.source).toBe('neural-python');
    setRuntimeChoice(s, 'engine', 'rust'); expect(s.runtime!.source).toBe('neural-python');
    setRuntimeChoice(s, 'neural', 'auto'); expect(s.runtime!.source).toBe('neural-wasm');
  });
  it('compact preset drops incompatible GPU overrides; native + compact has no GPU', () => {
    const s = defaultSettings(); s.runtime!.backend = 'native'; s.runtime!.compute = 'gpu';
    s.terrain = { ...s.terrain, procedural: { preset: 'compact' }, generationCompute: 'gpu-all', compute: 'gpu-f32' };
    normalizeRuntime(s);
    expect(s.runtime).toMatchObject({ backend: 'native', compute: 'auto' }); expect(s.terrain!.generationCompute).toBeUndefined(); expect(s.terrain!.compute).toBeUndefined();
    expect(runtimeChoiceStates(s, all).compute.gpu.enabled).toBe(false);
  });
  it('neural generation cannot run on CPU', () => {
    const s = defaultSettings(); s.generation = 'neural'; s.runtime!.compute = 'cpu'; normalizeRuntime(s);
    expect(s.runtime!.compute).toBe('auto'); expect(runtimeChoiceStates(s, all).compute.cpu.enabled).toBe(false);
  });
  it('CPU compute and GPU overrides never coexist', () => {
    const s = defaultSettings(); setRuntimeChoice(s, 'generationCompute', 'gpu-erosion'); setRuntimeChoice(s, 'compute', 'cpu');
    expect(s.terrain!.generationCompute).toBeUndefined();
    expect(runtimeChoiceStates(s, all).generationCompute.gpu.enabled).toBe(false);
    expect(runtimeChoiceStates(s, all).sampling['gpu-f32'].reason).toBeTruthy();
  });
  it('legacy native generation compute selects the native engine; phasor source becomes the compact preset', () => {
    const s = defaultSettings(); (s.terrain as any).generationCompute = 'native'; normalizeRuntime(s);
    expect(s.runtime!.backend).toBe('native'); expect(s.terrain!.generationCompute).toBeUndefined();
    const p = defaultSettings(); (p.runtime as any).source = 'procedural-phasor'; normalizeRuntime(p);
    expect(p.terrain!.procedural!.preset).toBe('compact'); expect(p.runtime!.source).toBe('procedural');
  });
  it('capabilities disable unavailable options with a reason', () => {
    const st = runtimeChoiceStates(defaultSettings(), none);
    expect(st.engine.native.enabled).toBe(false); expect(st.compute.gpu.reason).toMatch(/WebGPU/);
    expect(st.hydrology.gpu.enabled).toBe(false); expect(st.urban.native.enabled).toBe(false); expect(st.neural.python.enabled).toBe(false);
  });
  it('overrides default to "follow engine" and the summary reads well', () => {
    const s = defaultSettings(); const v = runtimeValues(s);
    expect(v).toMatchObject({ engine: 'rust', compute: 'auto', sampling: '', generationCompute: '', hydrology: 'auto', urban: '' });
    setRuntimeChoice(s, 'urban', 'native'); expect(s.urban!.backend).toBe('native'); setRuntimeChoice(s, 'urban', ''); expect(s.urban!.backend).toBeUndefined();
    s.generation = 'neural'; normalizeRuntime(s); expect(runtimeSummary(s, true)).toBe('Rust · GPU · neural browser');
  });
});
