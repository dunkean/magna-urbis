import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/v2/settings';
import { backendAlternative, backendFailure, fallbackRuntime, runtimeNeedsProbe, F } from '../../src/v2/runtimeChoices';

const caps = (over: Partial<{ webgpu: boolean; native: boolean; python: boolean }> = {}) => ({ checked: true, webgpu: true, native: false, python: false, ...over });

describe('offline backends', () => {
  it('a restored native recipe switches to Rust in the browser before the run', () => {
    const s = defaultSettings(); s.runtime!.backend = 'native'; s.urban = { ...s.urban, backend: 'native' };
    expect(runtimeNeedsProbe(s, { ...caps(), checked: false })).toBe(true);
    expect(fallbackRuntime(s, caps())).toEqual([F.engineToBrowser, F.urbanToEngine]);
    expect(s.runtime!.backend).toBe('rust'); expect(s.urban!.backend).toBeUndefined();
  });
  it('native or Python neural falls back to browser WebGPU, else Python', () => {
    const native = defaultSettings(); native.generation = 'neural'; native.runtime = { ...native.runtime!, backend: 'native', source: 'neural' };
    expect(fallbackRuntime(native, caps())).toEqual([F.neuralToBrowser]); expect(native.runtime).toMatchObject({ backend: 'rust', source: 'neural-wasm' });
    const python = defaultSettings(); python.generation = 'neural'; python.runtime = { ...python.runtime!, source: 'neural-python' };
    expect(fallbackRuntime(python, caps())).toEqual([F.neuralToBrowser]); expect(python.runtime!.source).toBe('neural-wasm');
    const noGpu = defaultSettings(); noGpu.generation = 'neural'; noGpu.runtime = { ...noGpu.runtime!, source: 'neural-wasm' };
    expect(fallbackRuntime(noGpu, caps({ webgpu: false, python: true }))).toEqual([F.neuralToPython]); expect(noGpu.runtime!.source).toBe('neural-python');
  });
  it('nothing changes when the selection is available or has no alternative', () => {
    const s = defaultSettings(); s.runtime!.backend = 'native';
    expect(fallbackRuntime(s, caps({ native: true }))).toEqual([]);
    const neural = defaultSettings(); neural.generation = 'neural'; neural.runtime = { ...neural.runtime!, source: 'neural-wasm' };
    expect(fallbackRuntime(neural, caps({ webgpu: false }))).toEqual([]);
  });
  it('a backend error names the alternative without changing the settings', () => {
    expect(backendFailure('Moteur Rust local inaccessible (http://127.0.0.1:8791). Lancez le profil local ou l’application de bureau.')).toBe('native');
    expect(backendFailure('Neural service unreachable (http://127.0.0.1:8792): run “npm run neural:serve” from web/')).toBe('neural-service');
    expect(backendFailure('Hydrology failed: x')).toBeUndefined();
    const s = defaultSettings(); s.generation = 'neural'; s.runtime = { ...s.runtime!, backend: 'native', source: 'neural' };
    expect(backendAlternative(s, caps({ native: true }), 'neural-service')).toBe(F.altBrowserNeural);
    expect(s.runtime).toMatchObject({ backend: 'native', source: 'neural' });
    const p = defaultSettings(); p.runtime!.backend = 'native';
    expect(backendAlternative(p, caps(), 'native')).toBe(F.altBrowserGpu);
    expect(backendAlternative(p, caps({ webgpu: false }), 'native')).toBe(F.altBrowserCpu);
  });
});
