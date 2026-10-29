import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNeuralRefinement, refinementAmplification, TerrainRefinementSession } from '../src/ui/terrainRefinement';

afterEach(() => vi.unstubAllGlobals());
describe('retained Neural Earth amplification', () => {
  it('registers the selected method against the retained surface without generating a world', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'phasor-source', version: 'test', minMpp: .46875, nativeMpp: 30, decoderUsed: false, amplification: 'phasor' })));
    vi.stubGlobal('fetch', fetcher);
    const data = Float32Array.from({ length: 64 }, (_, i) => i / 2);
    const session = await TerrainRefinementSession.create('http://localhost:8893', { x: 0, y: 0, width: 800, n: 8, data }, { seed: '17', amplification: 'phasor', intensity: 1.5 });
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:8893/refinement/register');
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ n: 8, width: 800, amplification: 'phasor', intensity: 1.5, seed: '17' });
    expect(Uint8Array.from(atob(body.heights), c => c.charCodeAt(0))).toEqual(new Uint8Array(data.buffer));
    expect(session.registration.amplification).toBe('phasor');
  });
  it('routes every server refinement through the tile loader and keeps local modes local', () => {
    for (const mode of ['neural-earth', 'neural-earth-phasor', 'neural-earth-mse', 'neural-earth-hybrid']) expect(isNeuralRefinement(mode)).toBe(true);
    for (const mode of ['source', 'noise', 'neural-earth-unknown']) expect(isNeuralRefinement(mode)).toBe(false);
    expect(refinementAmplification('neural-earth')).toBe('classic');
    expect(refinementAmplification('neural-earth-phasor')).toBe('phasor');
    expect(refinementAmplification('neural-earth-mse')).toBe('mse');
    expect(refinementAmplification('neural-earth-hybrid')).toBe('hybrid');
  });
  it('rejects an older service that silently ignores amplification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'old', version: 'old', minMpp: .46875 }))));
    await expect(TerrainRefinementSession.create('http://localhost:8893', { x: 0, y: 0, width: 800, n: 8, data: new Float32Array(64) }, { seed: '17', amplification: 'hybrid' })).rejects.toThrow('méthode demandée');
  });
});
