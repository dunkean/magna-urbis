import { afterEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/v2/settings';
import { STARTUP_RESTORE_KEY } from '../../src/v2/startup';
import { effectiveTerrainSettings } from '../../src/v2/terrainSettings';
import type { SavedRecipe } from '../../src/v2/autosave';
import type { PageActions, PageState } from '../../src/v2/page/contract';

const hooks = vi.hoisted(() => ({ takeAutosave: vi.fn(), armAutosave: vi.fn(), saveAutosaveNow: vi.fn(), load: vi.fn(), handheld: false }));
vi.mock('../../../rust/bridge/deviceClass', async importOriginal => ({ ...(await importOriginal<typeof import('../../../rust/bridge/deviceClass')>()), handheldDevice: () => hooks.handheld }));
vi.mock('../../src/v2/autosave', () => ({ takeAutosave: hooks.takeAutosave, armAutosave: hooks.armAutosave, saveAutosaveNow: hooks.saveAutosaveNow, mountNewButton: vi.fn() }));
vi.mock('../../src/v2/i18n', () => ({ setText: vi.fn(), registerMessages: vi.fn() }));
vi.mock('../../src/v2/testHook', () => ({ mountV2TestHook: vi.fn() }));
vi.mock('../../src/v2/machineTier', () => ({ inspectMachine: () => Promise.resolve({ tier: 'fast' }), releaseMachineStyle: vi.fn() }));
vi.mock('../../src/v2/page/machineDefault', () => ({ mountMachineDefault: vi.fn(), mountPerformancePolicy: vi.fn(), repairMachinePreset: vi.fn(), persistedSettings: (settings: unknown) => settings }));
import { mountPageBoot } from '../../src/v2/page/bootstrap';
import { createSettingsActions } from '../../src/v2/page/settings';

afterEach(() => {
  hooks.handheld = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function boot(restore: boolean, saved: SavedRecipe, search = '') {
  hooks.takeAutosave.mockResolvedValue(saved);
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key === STARTUP_RESTORE_KEY && restore ? 'true' : null) });
  vi.stubGlobal('location', { hash: '', search });
  const seedField = { dataset: { option: 'seed' }, tagName: 'INPUT', value: '' };
  vi.stubGlobal('document', { getElementById: () => undefined, querySelector: () => ({ before: vi.fn() }), querySelectorAll: () => [seedField] });
  const viewer = { setView: vi.fn() };
  const sync = () => ({ sync: vi.fn() });
  const state = {
    settings: defaultSettings(),
    mods: [],
    projectRevision: 0,
    client: { init: async () => {}, viewer, setAppearance: async () => {} },
    cityCodeSharing: { restoreFromLocation: async () => {} },
    bootRuntime: {},
    terrainControls: sync(),
    regionControls: sync(),
    urbanControls: sync(),
    renderControls: sync(),
    mapControls: sync(),
    chain: { sync: () => syncLandscape() },
  };
  const syncLandscape = vi.fn(() => {
    const { climateZone, relief } = effectiveTerrainSettings(state.settings, 6000);
    return { seed: seedField.value, climateZone, relief };
  });
  const actions = {
    syncControls: () => settingsActions.syncControls(),
    syncUrbanBackend: vi.fn(),
    updateExtent: vi.fn(),
    syncDisplayWidgets: vi.fn(),
    syncNameOrigins: vi.fn(),
    inspectHardware: async () => {},
    loadProject: hooks.load,
    setBusy: vi.fn(),
    log: vi.fn(),
    toast: vi.fn(),
    generate: vi.fn(async () => true),
    selectTab: vi.fn(),
  };
  const settingsActions = createSettingsActions(state as unknown as PageState, actions as unknown as PageActions);
  await mountPageBoot(state as unknown as PageState, actions as unknown as PageActions);
  await vi.waitFor(() => expect(hooks.armAutosave).toHaveBeenCalledOnce());
  return { state, actions, viewer, syncLandscape };
}

it('boots to a fresh randomized proposal by default without regenerating the saved map', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.8);
  const saved = { settings: defaultSettings(), mods: [{ keep: 'only on restore' }] };
  saved.settings.options.seed = 'old map';
  const { state, actions, syncLandscape } = await boot(false, saved);
  expect(state.settings.options.seed).not.toBe('old map');
  expect(state.settings.options.biome).not.toBe(saved.settings.options.biome);
  expect(syncLandscape).toHaveNthReturnedWith(1, { seed: 'magnas', climateZone: 'temperate', relief: 'hills' });
  expect(syncLandscape).toHaveLastReturnedWith({ seed: state.settings.options.seed, climateZone: 'savanna', relief: 'mixed' });
  expect(state.mods).toEqual([]);
  expect(hooks.load).not.toHaveBeenCalled();
  expect(actions.generate).not.toHaveBeenCalled();
});

it('keeps the existing restoration path and restores the saved viewport when opted in', async () => {
  const saved = { settings: defaultSettings(), mods: [], view: { cx: 200, cy: 300, scale: 2 }, ui: { tab: 'cities' } };
  const random = vi.spyOn(Math, 'random');
  const { actions, viewer } = await boot(true, saved);
  await vi.waitFor(() => expect(viewer.setView).toHaveBeenCalledWith(saved.view));
  expect(hooks.load).toHaveBeenCalledWith({ settings: saved.settings, mods: saved.mods });
  expect(actions.generate).toHaveBeenCalledWith('all');
  expect(actions.selectTab).toHaveBeenCalledWith('cities');
  expect(random).not.toHaveBeenCalled();
});

it('resumes a map left recently on a handheld device without the opt-in', async () => {
  hooks.handheld = true;
  const saved = { settings: defaultSettings(), mods: [], view: { cx: 200, cy: 300, scale: 2 }, savedAt: Date.now() - 60_000 };
  const { actions, viewer } = await boot(false, saved);
  await vi.waitFor(() => expect(viewer.setView).toHaveBeenCalledWith(saved.view));
  expect(hooks.load).toHaveBeenCalledWith({ settings: saved.settings, mods: saved.mods });
  expect(actions.generate).toHaveBeenCalledWith('all');
});

it('keeps benchmark and explicit test loads stable without reading autosave or drawing random choices', async () => {
  const random = vi.spyOn(Math, 'random');
  const { state } = await boot(true, { settings: defaultSettings(), mods: [] }, '?test=1');
  expect(state.settings.options.seed).toBe('magnas');
  expect(hooks.takeAutosave).not.toHaveBeenCalled();
  expect(random).not.toHaveBeenCalled();
});
