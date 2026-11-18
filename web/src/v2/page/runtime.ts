/** Execution settings, desktop integrations and capability checks. main.ts mounts each phase where it occurred among the generation controls. */
import type { PageState } from './state';
import type { PageActions } from './actions';
import {
  setText,
  translate,
  loopbackServer,
  mountSettingsPanel,
  refreshBackends,
  backendStatus,
  backendAlternative,
  backendFailure,
  RUNTIME_FALLBACK,
  mountNeuralModelManager,
  mountDesktopNeural,
  mountDesktopModules,
  mountDesktopReleaseLink,
  mountDesktopUpdates,
  mountV2Illustration,
} from './dependencies';
import { $ } from './dom';

export function createRuntimeActions(state: PageState, actions: PageActions) {
  function openExecutionSettings(): void {
    actions.dialog('#hardware-dialog');
    void actions.inspectHardware();
    requestAnimationFrame(() => document.getElementById('settings-execution')?.scrollIntoView({ block: 'start' }));
  }

  function openNeuralModelsSettings(): void {
    actions.dialog('#hardware-dialog');
    const section = $<HTMLDetailsElement>('#neural-model-manager');
    section.open = true;
    requestAnimationFrame(() => {
      section.scrollIntoView({ block: 'start' });
      const download = section.querySelector<HTMLButtonElement>('#neural-model-download-all');
      (download && !download.disabled ? download : section.querySelector<HTMLElement>('summary'))?.focus({ preventScroll: true });
    });
  }

  async function inspectNeuralSelection(): Promise<void> {
    const revision = ++state.neuralSelectionRevision,
      source = state.settings.runtime?.source;
    if (source === 'neural-python') return;
    $('#source-neural').setAttribute('aria-busy', 'true');
    const assets = new URL(state.settings.runtime?.neuralAssets ?? './neural/', location.href).href;
    try {
      const ready = state.nativeNeuralManager ? await (await import('../desktopNeural')).desktopNeuralModelsReady() : source === 'neural-wasm' ? await (await import('../../../../rust/bridge/neuralModels')).hasStoredNeuralModels(assets) : true;
      if (revision !== state.neuralSelectionRevision || state.settings.runtime?.source !== source || state.busy || assets !== new URL(state.settings.runtime?.neuralAssets ?? './neural/', location.href).href) return;
      const capabilities = backendStatus();
      if (!ready) actions.openNeuralModelsSettings();
      else if (!state.nativeNeuralManager && source === 'neural-wasm' && capabilities.checked && !capabilities.webgpu) actions.openExecutionSettings();
    } catch {
      if (revision === state.neuralSelectionRevision && state.settings.runtime?.source === source && !state.busy) actions.openNeuralModelsSettings();
    } finally {
      if (revision === state.neuralSelectionRevision) $('#source-neural').setAttribute('aria-busy', 'false');
    }
  }

  /** A missing backend names the best available alternative and opens Settings on demand. */
  async function reportGenerationFailure(message: string): Promise<void> {
    const failure = backendFailure(message);
    // Native is chosen automatically and re-checked before each run: its errors never ask to pick another engine.
    if (!failure || failure === 'native') {
      actions.toast(message, true);
      return;
    }
    try {
      await refreshBackends(state.backendBindings);
    } catch {
      /* The suggestion uses the last known capabilities. */
    }
    const alternative = backendAlternative(state.settings, state.runtimeCapabilities(), failure);
    actions.toast(message, true, { detail: alternative ? translate(RUNTIME_FALLBACK.suggest).replace('{alternative}', translate(alternative)) : translate(RUNTIME_FALLBACK.check), label: RUNTIME_FALLBACK.open, run: actions.openExecutionSettings });
  }

  async function inspectHardware(): Promise<void> {
    state.settingsPanel.render();
    try {
      await refreshBackends(state.backendBindings);
      state.chain.sync();
    } catch (e) {
      actions.log(String(e));
    }
  }
  return { openExecutionSettings, openNeuralModelsSettings, inspectNeuralSelection, reportGenerationFailure, inspectHardware };
}

/** Backend bindings, desktop integration and illustration controls. Called by main.ts in startup order. */
export function mountRuntimeSettings(state: PageState, actions: PageActions): void {
  /* The staged chain takes over the sidebar: the forms above are moved into their stage rows. */
  state.backendBindings = {
    localServer: () => state.settings.runtime?.localServer ?? state.bootRuntime.localServer ?? 'http://127.0.0.1:8791',
    pythonServer: () => state.settings.runtime?.pythonServer ?? state.bootRuntime.pythonServer ?? 'http://127.0.0.1:8793',
    log: actions.log,
    getSettings: () => state.settings,
    getWorld: () => state.world,
    getRuntimeStatus: () => state.client.runtimeFallback.status(state.settings) ?? (state.settings.runtime?.autoBackend ? (state.settings.runtime.backend === 'native' ? RUNTIME_FALLBACK.autoNative : RUNTIME_FALLBACK.autoBrowser) : undefined),
    busy: () => state.busy,
    onRuntimeChange: () => {
      actions.touchRecipe();
      state.terrainControls.sync();
      state.regionControls?.sync();
      actions.syncUrbanBackend();
      actions.scheduleChainSync();
    },
  };

  state.settingsPanel = mountSettingsPanel($('#hardware-details'), state.backendBindings);

  const desktopModulesHost = document.createElement('div');

  $('#hardware-details').after(desktopModulesHost);

  mountDesktopModules(desktopModulesHost, () => void actions.inspectHardware());

  mountDesktopUpdates($('.header-tools'), desktopModulesHost);

  mountDesktopReleaseLink($('.project-links'));

  mountV2Illustration({
    host: $('.header-tools'),
    getWorld: () => state.world,
    getSettings: () => state.settings,
    get3d: () => state.city3d,
    getViewport: () => ({ element: $('#map'), view: state.client.viewer.getView() }),
    beforeCapture2d: () => state.client.prepareViewportCapture(),
    navigation: { getView: () => state.client.viewer.getView(), setView: view => state.client.viewer.setView(view), ready: () => state.client.viewer.waitForFrame() },
  });
}

/** Neural model management and selection checks. Called by main.ts in startup order. */
export function mountNeuralModels(state: PageState, actions: PageActions): void {
  // Model and service URLs (terrain schema) belong to Settings, next to the service checks.
  $('#hardware-dialog .dialog-actions').before($('#settings-endpoints-box'));

  const neuralModelHost = document.createElement('div');

  $('#hardware-dialog .dialog-actions').before(neuralModelHost);

  state.nativeNeuralManager = mountDesktopNeural(neuralModelHost);

  state.neuralModelManager = state.nativeNeuralManager ? { dispose() {} } : mountNeuralModelManager(neuralModelHost, () => new URL(state.settings.runtime?.neuralAssets ?? './neural/', location.href).href);

  const modelShortcut = document.createElement('button');

  modelShortcut.type = 'button';

  modelShortcut.className = 'small';

  modelShortcut.id = 'neural-models-open';

  setText(modelShortcut, 'Downloaded neural models');

  state.chain.body('relief-neural-base').append(modelShortcut);

  state.neuralSelectionRevision = 0;

  modelShortcut.onclick = actions.openNeuralModelsSettings;
}

/** Client capability and runtime-status callbacks. Called by main.ts in startup order. */
export function mountRuntimeStatus(state: PageState, actions: PageActions): void {
  state.runtimeCapabilities = () => {
    const s = backendStatus();
    return { checked: s.checked, servicesChecked: s.servicesChecked, webgpu: s.webgpu, native: s.native.available, python: s.python.available, nativeNeural: s.nativeNeural?.available };
  };

  state.client.runtimeCapabilities = state.runtimeCapabilities;

  state.client.onRuntimeStatusChange = () => state.settingsPanel.render();
}

/** Settings opening, capability refresh and service connections. Called by main.ts in startup order. */
export function mountRuntimeButtons(state: PageState, actions: PageActions): void {
  $('#hardware-open').onclick = () => {
    actions.dialog('#hardware-dialog');
    void actions.inspectHardware();
  };

  $('#hardware-refresh').onclick = () => void actions.inspectHardware();

  $('#services-apply').onclick = () => {
    try {
      const localServer = loopbackServer($<HTMLInputElement>('#rust-server').value),
        pythonServer = loopbackServer($<HTMLInputElement>('#python-server').value);
      state.settings.runtime = { compute: 'auto', backend: 'rust', source: 'procedural', ...state.settings.runtime, localServer, pythonServer };
      state.connectLocal = true;
      actions.touchRecipe();
      actions.syncControls();
      void actions.inspectHardware();
    } catch (e) {
      actions.toast(String(e), true);
    }
  };
}
