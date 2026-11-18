/**
 * The page's direct controls: recipe fields of the staging area, the seed, run buttons, cancel, zoom, the style
 * selector, the mobile toggle, and the map click that picks a label, a placement position or what to inspect (in the
 * top view or tilted: worldPicking.ts).
 */
import type { PageActions, PageState } from './contract';
import { adaptedExtent } from '../settings';
import { buildingAt, nearestSettlement } from '../edits';
import { migrateUrbanSeeds } from '../urbanSeeds';
import { $ } from './dom';
import { pickOnMap } from './worldPicking';

export function mountToolbar(state: PageState, actions: PageActions): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-option]').forEach(input =>
    input.addEventListener('change', () => {
      const key = input.dataset.option!,
        value = input instanceof HTMLInputElement && input.type === 'number' ? (input.value === '' ? undefined : input.valueAsNumber) : input.value;
      if (typeof value === 'number' && !Number.isFinite(value)) return;
      if (key.startsWith('center.')) {
        const axis = key.endsWith('x') ? 'x' : 'y';
        if (value === undefined) delete state.settings.options.center;
        else state.settings.options.center = { ...(state.settings.options.center ?? { x: adaptedExtent(state.settings) / 2, y: adaptedExtent(state.settings) / 2 }), [axis]: value };
      } else (state.settings.options as unknown as Record<string, unknown>)[key] = value;
      actions.touchRecipe();
      if (key === 'sprawl' && value === undefined) input.value = '1';
      if (key === 'culture' || key === 'sprawl' || key === 'population') {
        state.urbanControls.sync();
        state.inspectorForms.forEach(form => form.sync());
      }
    }),
  );

  $('#random-seed').onclick = () => {
    migrateUrbanSeeds(state.settings);
    state.settings.options.seed = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('-');
    state.mods = [];
    actions.touchRecipe();
    actions.syncControls();
  };

  $<HTMLInputElement>('#town-count').onchange = e => {
    state.settings.settlementCount = Number((e.target as HTMLInputElement).value);
    if (state.settings.region?.placement) {
      delete state.settings.region.placement.counts;
      state.settings.region.placement.mode = 'counts';
    }
    actions.touchRecipe();
    state.regionControls.sync();
  };

  $('#generate-region').onclick = () => actions.runFamily(state.chain.family());

  $('#run-chain').onclick = () => void actions.runFullGeneration();

  $('#terrain-only').onclick = () => void actions.generate('terrain');

  $('#region-only').onclick = () => void actions.generate('region');

  $('#towns-only').onclick = () => actions.runCities();

  $('#cancel-job').onclick = () => {
    state.cancelled = true;
    state.client.cancel();
    const local = state.settings.runtime?.backend === 'native' || state.settings.runtime?.source === 'neural-python' || state.settings.urban?.backend === 'native';
    const message = local ? 'Waiting cancelled. The previous map is retained; the local service may finish its computation in the background.' : 'Computation cancelled. The previous map is retained.';
    actions.log(message);
    actions.setBusy(false);
    actions.toast(message);
  };

  $('#zoom-in').onclick = () => state.client.viewer.zoomBy(1.5);

  $('#zoom-out').onclick = () => state.client.viewer.zoomBy(1 / 1.5);

  $('#fit-map').onclick = () => state.client.viewer.fit();

  $<HTMLSelectElement>('#map-style').onchange = e => actions.writeRecipe('preset', (e.target as HTMLSelectElement).value);

  $('#mobile-toggle').onclick = () => {
    const closed = $('#sidebar').classList.toggle('mobile-closed');
    $('#mobile-toggle').setAttribute('aria-expanded', String(!closed));
  };

  let pointerStart = { x: 0, y: 0 };

  $('#map').addEventListener('pointerdown', e => {
    pointerStart = { x: e.clientX, y: e.clientY };
  });

  $('#map').addEventListener('click', e => {
    if (!state.world || state.busy || (!state.pendingRegionPosition && !state.labelEditor.active() && !$<HTMLInputElement>('#inspect-mode').checked) || Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 5) return;
    // The point the click means: under the pixel in the top view, what the camera sees there when tilted.
    const rect = $('#map').getBoundingClientRect(),
      picked = pickOnMap(state, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    if (!picked) return;
    const p = picked.point,
      { x, y } = p;
    if (state.labelEditor.active()) {
      state.labelEditor.pick(p);
      return;
    }
    if (state.pendingRegionPosition) {
      const spec = state.settings.region?.placement?.list?.find(spec => spec.key === state.pendingRegionPosition);
      if (spec) {
        spec.position = { x: Math.max(0, Math.min(state.world.mapSize, x)), y: Math.max(0, Math.min(state.world.mapSize, y)) };
        actions.touchRecipe();
        state.regionControls.sync();
      }
      state.pendingRegionPosition = undefined;
      actions.toast('Position saved. Run placement to apply it.');
      return;
    }
    const target = $<HTMLSelectElement>('#inspect-target').value;
    if (state.parcelMerge && target === 'parcel') {
      state.parcelMerge.add(p);
      return;
    }
    if (target === 'quarter' || target === 'block' || target === 'parcel') {
      if (!actions.inspectSubdivision(target, p)) actions.toast('No geometry at this location. Build this stage first.');
      return;
    }
    if (target === 'settlement') {
      const town = nearestSettlement(state.world, p);
      if (town) actions.showInspector(town.key);
      return;
    }
    const hit = picked.building ?? buildingAt(state.world, p);
    if (hit) {
      actions.showBuilding(hit);
      return;
    }
    const town = nearestSettlement(state.world, p);
    if (town) actions.showInspector(town.key);
    else actions.toast('Select a settlement or a house. Zoom in to reach the buildings.');
  });
}
