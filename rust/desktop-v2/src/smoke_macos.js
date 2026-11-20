// Run inside the installed candidate's WKWebView, through the same IPC and
// generation handlers used by the desktop UI.
(() => {
  if (window !== window.top) return;
  const report = { ok: false, checks: {}, services: {} };
  const element = selector => document.querySelector(selector);
  const invoke = (...args) => window.__TAURI_INTERNALS__.invoke(...args);
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  async function until(description, probe, timeout = 60_000) {
    const end = Date.now() + timeout;
    do {
      const value = await probe();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < end);
    throw new Error(`Timed out waiting for ${description}`);
  }
  async function request(origin, path, timeout = 5_000) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${await response.text()}`);
    return response;
  }
  async function roundTripProject(api) {
    const before = api.world();
    let download;
    const capture = event => {
      const anchor = event.target;
      if (!(anchor instanceof HTMLAnchorElement) || !anchor.download.endsWith('.muproj')) return;
      event.preventDefault();
      download = fetch(anchor.href)
        .then(response => response.blob())
        .then(blob => new File([blob], anchor.download));
    };
    document.addEventListener('click', capture, true);
    let file;
    try {
      element('#save-map').click();
      file = await until('binary project export', () => download);
    } finally {
      document.removeEventListener('click', capture, true);
    }
    assert(file.size > 8, 'Exported project is empty');
    const input = element('#project-file');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await until('project reopened', () => api.world() !== before && api.world()?.mapSize === before.mapSize && !api.summary().busy);
    assert(api.world().settlements.length === before.settlements.length, 'Reopened project lost settlements');
  }
  async function checkRendering(api) {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return { skipped: 'WKWebView could not create a WebGL2 context' };
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    const style = element('#map-style');
    style.value = 'satellite';
    style.dispatchEvent(new Event('change', { bubbles: true }));
    const town = api.world().settlements[0];
    api.setView({ cx: town.center.x, cy: town.center.y, scale: 1.6 });
    const drawn = () => window.__muLive?.active && window.__muLive.layers.buildings?.triangles > 0 && element('#map-canvas').dataset.renderPending === '0';
    await until('overhead WebGL buildings', drawn);
    element('#view3d').click();
    await until(
      'tilted WebGL buildings',
      () => element('#view3d').getAttribute('aria-pressed') === 'true' && drawn(),
    );
    const triangles = window.__muLive.layers.buildings.triangles;
    element('#view3d').click();
    return { overhead: true, tilted: true, buildingTriangles: triangles };
  }
  async function checkNeural(modelStatus) {
    // The runner supplies files prepared against the compiled profile. The
    // app must verify and reuse them, directly through its native IPC.
    assert(modelStatus.models.every(model => model.present), 'The verified candidate weights are missing');
    await invoke('desktop_neural_download');
    const origin = await invoke('ensure_neural');
    report.services.neural = origin;
    const status = await until('native neural model load', async () => {
      const value = await (await request(origin, '/status')).json();
      return value.state !== 'loading' && value;
    }, 120_000);
    assert(status.service === 'magna-urbis-neural' && status.profile === modelStatus.profile, 'Unexpected neural service or profile');
    if (status.state === 'error' && status.message.startsWith('No WebGPU adapter:')) return { skipped: status.message };
    assert(status.state === 'ready', status.message);
    const response = await request(origin, '/generate?seed=macos-ci&relief=hills&extent=4000&sampleSpacing=100', 240_000);
    const meta = JSON.parse(response.headers.get('X-Neural-Meta'));
    const heights = new Float32Array(await response.arrayBuffer());
    assert(meta.profile === modelStatus.profile && meta.extent === 4000 && meta.resolution === 40, 'Unexpected neural terrain metadata');
    assert(heights.length === 40 * 40 && heights.every(Number.isFinite) && heights.some(value => value !== heights[0]), 'Invalid neural terrain heights');
    assert((await (await request(origin, '/status')).json()).generated === 1, 'Native neural service did not record a generation');
    return { profile: meta.profile, resolution: meta.resolution, totalMs: meta.totalMs };
  }
  void (async () => {
    try {
      const api = await until('desktop app boot', () => !element('#boot-splash') && window.__v2Test);
      assert(element('#terrain-backend').value === 'native', 'Desktop did not select the native backend');
      const modules = await invoke('desktop_status');
      assert(modules.uv && modules.components.every(component => !component.installed), 'Fresh app requires an optional module or lacks bundled uv');
      const modelStatus = await invoke('desktop_neural_status');
      assert(modelStatus.progress.phase === 'idle' && !modelStatus.busy, 'Neural models must be idle after startup');
      report.checks.freshStartup = true;
      const origin = new URLSearchParams(location.search).get('localServer');
      report.services.procedural = origin;
      const status = await (await request(origin, '/status')).json();
      assert(status.service === 'magna-urbis-local' && status.backend === 'rust-native', 'Unexpected procedural service');
      await api.runRegion({
        extent: 4000,
        settlementCount: 1,
        options: { seed: 'macos-ci', population: 600, relief: 'hills' },
        terrain: { relief: 'hills', climate: 'temperate', coastMask: 0, resolution: 128 },
        runtime: { backend: 'native', autoBackend: false, compute: 'cpu', source: 'procedural', erosion: 0, resolution: 128 },
        places: 'main',
      });
      assert(api.world().stats['v2.regionBackend'] === 'rust-native-cpu', 'Procedural generation fell back to WASM');
      report.checks.procedural = true;
      report.checks.webgl = await checkRendering(api);
      await roundTripProject(api);
      report.checks.projectRoundTrip = true;
      report.checks.neural = await checkNeural(modelStatus);
      report.ok = true;
    } catch (error) {
      report.error = String(error?.stack ?? error);
    }
    await invoke('desktop_smoke_result', { report });
  })();
})();
