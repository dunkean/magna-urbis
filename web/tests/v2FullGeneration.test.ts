import { describe, expect, it, vi } from 'vitest';
import { runRemainingGeneration } from '../src/v2/fullGeneration';

function controls() {
  return { generate: vi.fn(async () => true), targets: () => undefined as string[] | undefined, redraw: vi.fn(async () => {}) };
}
describe('full generation from the active tab', () => {
  it('starts the entire pipeline only from Relief', async () => {
    const api = controls(); await runRemainingGeneration('region', api);
    expect(api.generate.mock.calls).toEqual([['all']]);
  });
  it('keeps relief and runs placement before the cities from Settlements', async () => {
    const api = controls(); await runRemainingGeneration('settlements', api);
    expect(api.generate.mock.calls).toEqual([['region'], ['towns', undefined]]);
  });
  it('keeps relief and placement and respects the right-hand selection from Cities', async () => {
    const api = { ...controls(), targets: () => ['village'] };
    await runRemainingGeneration('cities', api);
    expect(api.generate.mock.calls).toEqual([['towns', ['village']]]);
  });
  it('does not continue after placement failure or cancellation', async () => {
    const api = controls(); api.generate.mockResolvedValue(false);
    expect(await runRemainingGeneration('settlements', api)).toBe(false);
    expect(api.generate.mock.calls).toEqual([['region']]);
  });
  it('only redraws the retained map from Editor', async () => {
    const api = controls(); await runRemainingGeneration('map', api);
    expect(api.generate).not.toHaveBeenCalled(); expect(api.redraw).toHaveBeenCalledOnce();
  });
  it('does not turn an empty explicit selection into generation of all cities', async () => {
    const api = { ...controls(), targets: () => [] };
    expect(await runRemainingGeneration('cities', api)).toBe(false);
    expect(api.generate).not.toHaveBeenCalled();
  });
});
