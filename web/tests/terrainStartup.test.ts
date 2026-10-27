import { describe, expect, it } from 'vitest';
import { initialTerrainSource, neuralModelLabel, terrainStartupText } from '../src/ui/terrainStartupState';

describe('terrain startup', () => {
  it('starts new local and browser maps with the corresponding neural backend', () => {
    expect(initialTerrainSource(new URLSearchParams(), 'neural-python')).toBe('neural-python');
    expect(initialTerrainSource(new URLSearchParams(), 'neural-wasm')).toBe('neural-wasm');
    expect(initialTerrainSource(new URLSearchParams('source=obsolete'), 'neural-python')).toBe('neural-python');
  });
  it('preserves intentional map sources and legacy neural endpoints', () => {
    expect(initialTerrainSource(new URLSearchParams('source=procedural'), 'neural-python')).toBe('procedural');
    expect(initialTerrainSource(new URLSearchParams('source=neural'), 'neural-wasm')).toBe('neural-python');
    expect(initialTerrainSource(new URLSearchParams('source=neural&neural=http://127.0.0.1:8792'), 'neural-python')).toBe('neural');
  });
  it('distinguishes a ready service from models actually loaded on the GPU', () => {
    expect(neuralModelLabel({ state: 'ready', message: 'Service prêt', loaded: false })).toBe('Service prêt · modèles chargés au premier calcul');
    expect(neuralModelLabel({ state: 'loading', message: 'Loading', loaded: true })).toBe('Chargement des modèles sur le GPU…');
    expect(neuralModelLabel({ state: 'generating', message: 'Computing', loaded: true })).toBe('Modèles chargés · calcul sur le GPU…');
    expect(neuralModelLabel({ state: 'ready', message: 'Ready', loaded: true })).toBe('Modèles chargés · GPU prêt');
    expect(neuralModelLabel({ state: 'error', message: 'CUDA absent' })).toContain('indisponible');
  });
  it('localizes status while retaining the underlying service error', () => {
    expect(neuralModelLabel({ state: 'error', message: 'CUDA absent' }, 'en')).toBe('Neural service unavailable · CUDA absent');
    expect(neuralModelLabel({ state: 'loading', message: '' }, 'zh')).toBe('正在将模型加载到 GPU…');
    expect(terrainStartupText('generation', 'es')).toBe('Generando terreno');
    expect(terrainStartupText('generation', 'pt')).toBe('Gerando terreno');
  });
});
