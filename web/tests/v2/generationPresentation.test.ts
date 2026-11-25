import { afterEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/v2/settings';

vi.mock('../../src/v2/i18n', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/v2/i18n')>()), setText: vi.fn() }));
import { createGenerationActions } from '../../src/v2/page/generation';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function generation() {
  vi.stubGlobal('document', {
    hidden: false,
    querySelector: () => ({ hidden: false, disabled: false }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    'setInterval',
    vi.fn(() => 1),
  );
  const display = deferred();
  const world = { stats: {}, settlements: [], urban: { buildings: [] } };
  const state = {
    settings: defaultSettings(),
    world,
    mods: [],
    busy: false,
    cancelled: false,
    projectRevision: 0,
    chain: { clearCityResults: vi.fn(), beginRun: vi.fn(), endRun: vi.fn() },
    canvas: { hidden: true },
    smallPlaces: { stop: vi.fn(), start: vi.fn() },
    client: { run: vi.fn(async () => world), show: vi.fn(async () => {}), displaySettled: vi.fn(() => display.promise) },
  };
  const actions = {
    setBusy: vi.fn((value: boolean) => {
      state.busy = value;
    }),
    log: vi.fn(),
    showProgressSettlement: vi.fn(),
    updateWorld: vi.fn(),
    selectTab: vi.fn(),
    showInspector: vi.fn(),
    smallPlaceRecipeKey: vi.fn(() => 'recipe'),
    reportGenerationFailure: vi.fn(),
  };
  const run = createGenerationActions(state as never, actions as never).generate('town', 'main');
  return { state, actions, display, run };
}

it('keeps the generation card busy alongside town-name presentation while the map frame finishes', async () => {
  const g = generation();
  await vi.waitFor(() => expect(g.state.client.displaySettled).toHaveBeenCalledOnce());
  expect(g.actions.updateWorld).toHaveBeenCalledOnce(); // Publishes the names and their first-display spinners.
  expect(g.state.busy).toBe(true);
  expect(g.state.chain.endRun).not.toHaveBeenCalled();
  expect(g.state.smallPlaces.start).not.toHaveBeenCalled();
  g.display.resolve();
  expect(await g.run).toBe(true);
  expect(g.state.busy).toBe(false);
  expect(g.state.chain.endRun).toHaveBeenCalledWith(true);
  expect(g.state.smallPlaces.start).toHaveBeenCalledOnce();
});

it('releases the generation card and reports an error if the new display cannot finish', async () => {
  const g = generation();
  await vi.waitFor(() => expect(g.state.client.displaySettled).toHaveBeenCalledOnce());
  g.display.reject(new Error('Display failed'));
  expect(await g.run).toBe(false);
  expect(g.actions.reportGenerationFailure).toHaveBeenCalledWith('Display failed');
  expect(g.state.busy).toBe(false);
  expect(g.state.smallPlaces.start).not.toHaveBeenCalled();
});
