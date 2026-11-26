/**
 * Custom settlements of the Settlements page. Add settlement: a dialog asks for the population and the culture, a
 * click on the map places it. The place becomes a custom place (settlementAdd.ts) and joins the displayed world as it
 * stands: the other places and their towns stay, the new place is joined to the nearest regional road (all roads are
 * rerouted, sites kept, when that fails), then only this town is generated. A run that places the settlements again
 * asks whether the custom places are kept. The inspector of a custom place can remove it.
 */
import type { PageActions, PageState } from './contract';
import type { World, Vec2 } from '../../gen/types';
import type { V2Settings } from '../contracts';
import type { RoadGeometry } from '../roadControlModel';
import type { RoadClass } from '../../../../rust/bridge/settlements';
import { chooseAction } from '../actionDialog';
import { registerMessages, setHTML, setText, translate } from '../i18n';
import { CULTURE_LABELS } from '../../gen/options';
import { groupCultureSelector } from '../workbenchLayout';
import { acceptPlacementEdit, addSettlement, ADDED_SETTLEMENT_POPULATION, discardCustomSettlements, insertSettlement } from '../settlementAdd';
import { writeUrbanControl } from '../urbanControls';
import { addRoad } from '../networkEdits';
import { adoptUrbanRoad } from '../urbanRoadEditing';
import { settlementDisplayName } from '../mapPresentation';
import { wasmWorkerOptions } from '../../../../rust/bridge/wasmThreads';
import { runtimeWorkerOptions } from '../platform';
import RoadRouteWorker from '../roadRoute.worker?worker';
import { options } from './dom';
import { handheldDevice } from '../../../../rust/bridge/deviceClass';

registerMessages({
  'Add settlement': { en: 'Add settlement', fr: 'Ajouter un lieu' },
  'Add a settlement': { en: 'Add a settlement', fr: 'Ajouter un lieu habité' },
  'Choose its population and culture, then click on the map where it should stand.': {
    en: 'Choose its population and culture, then click on the map where it should stand.',
    fr: 'Choisissez sa population et sa culture, puis cliquez sur la carte à l’endroit où il doit se trouver.',
  },
  'Place on the map': { en: 'Place on the map', fr: 'Placer sur la carte' },
  'Population: {min} to {max} inhabitants.': { en: 'Population: {min} to {max} inhabitants.', fr: 'Population : {min} à {max} habitants.' },
  'Click on the map to place the new settlement. Esc cancels.': { en: 'Click on the map to place the new settlement. Esc cancels.', fr: 'Cliquez sur la carte pour placer le nouveau lieu. Échap pour annuler.' },
  'Tap the map to place the new settlement, or tap Cancel.': { en: 'Tap the map to place the new settlement, or tap Cancel.', fr: 'Touchez la carte pour placer le nouveau lieu, ou touchez Annuler.' },
  'Settlement placement cancelled.': { en: 'Settlement placement cancelled.', fr: 'Placement du lieu annulé.' },
  'Connecting the new settlement to the roads…': { en: 'Connecting the new settlement to the roads…', fr: 'Raccordement du nouveau lieu aux routes…' },
  Inhabitants: { en: 'Inhabitants', fr: 'Habitants' },
  'Keep custom settlements?': { en: 'Keep custom settlements?', fr: 'Conserver les lieux personnalisés ?' },
  'Placement draws the settlements again. Custom settlements (added or moved by hand) can stay where they are, with the automatic ones drawn around them.': {
    en: 'Placement draws the settlements again. Custom settlements (added or moved by hand) can stay where they are, with the automatic ones drawn around them.',
    fr: 'Le placement redessine les lieux habités. Les lieux personnalisés (ajoutés ou déplacés à la main) peuvent rester où ils sont, les lieux automatiques étant placés autour d’eux.',
  },
  '{count} custom settlements': { en: '{count} custom settlements', fr: '{count} lieux personnalisés' },
  Keep: { en: 'Keep', fr: 'Conserver' },
  Discard: { en: 'Discard', fr: 'Abandonner' },
  'Remove this settlement': { en: 'Remove this settlement', fr: 'Supprimer ce lieu' },
});

async function askSettlement(culture: string): Promise<{ population: number; culture: string } | undefined> {
  const fields = document.createElement('div');
  fields.className = 'dialog-fields';
  const populationLabel = document.createElement('label'),
    population = document.createElement('input');
  populationLabel.className = 'label';
  populationLabel.htmlFor = population.id = 'add-settlement-population';
  setText(populationLabel, 'Inhabitants');
  population.type = 'number';
  population.min = String(ADDED_SETTLEMENT_POPULATION.min);
  population.max = String(ADDED_SETTLEMENT_POPULATION.max);
  population.step = '1';
  population.required = true;
  population.value = String(ADDED_SETTLEMENT_POPULATION.initial);
  const cultureLabel = document.createElement('label'),
    cultures = document.createElement('select');
  cultureLabel.className = 'label';
  cultureLabel.htmlFor = cultures.id = 'add-settlement-culture';
  setText(cultureLabel, 'Culture');
  setHTML(cultures, options(CULTURE_LABELS));
  cultures.value = culture;
  groupCultureSelector(cultures);
  fields.append(populationLabel, population, cultureLabel, cultures);
  population.oninput = () => population.setCustomValidity('');
  const result = await chooseAction({
    id: 'add-settlement-dialog',
    title: 'Add a settlement',
    message: 'Choose its population and culture, then click on the map where it should stand.',
    content: fields,
    cancelValue: 'cancel',
    choices: [
      { value: 'cancel', label: 'Cancel' },
      { value: 'place', label: 'Place on the map', primary: true },
    ],
    accept: () => {
      const value = population.valueAsNumber;
      const valid = Number.isInteger(value) && value >= ADDED_SETTLEMENT_POPULATION.min && value <= ADDED_SETTLEMENT_POPULATION.max;
      population.setCustomValidity(valid ? '' : translate('Population: {min} to {max} inhabitants.').replace('{min}', String(ADDED_SETTLEMENT_POPULATION.min)).replace('{max}', String(ADDED_SETTLEMENT_POPULATION.max)));
      if (!valid) population.reportValidity();
      return valid;
    },
  });
  return result.value === 'place' ? { population: population.valueAsNumber, culture: cultures.value } : undefined;
}

/** The point of a regional road nearest to the new place, outside every other town (their streets stay as built). */
function connectionPoint(world: World, key: string): Vec2 | undefined {
  const place = world.settlements?.find(town => town.key === key);
  if (!place) return;
  const others = (world.settlements ?? []).filter(town => town.key !== key);
  let best: { point: Vec2; distance: number } | undefined;
  for (const road of world.roads ?? []) {
    if (road.urban) continue;
    for (const point of road.path) {
      const distance = Math.hypot(point.x - place.center.x, point.y - place.center.y);
      if (distance <= place.radius || (best && distance >= best.distance)) continue;
      if (others.some(town => Math.hypot(point.x - town.center.x, point.y - town.center.y) < town.radius * 1.5)) continue;
      best = { point, distance };
    }
  }
  return best?.point;
}

/** One road routed by the road editor's engine worker over the current terrain, then released. */
function routeOnce(world: World, settings: V2Settings, points: Vec2[], cls: RoadClass): Promise<RoadGeometry> {
  const worker = new RoadRouteWorker(runtimeWorkerOptions(wasmWorkerOptions('v2-road-route')));
  const release = () => {
    const timeout = setTimeout(() => worker.terminate(), 10000);
    worker.onmessage = ({ data }) => {
      if (data?.type !== 'disposed') return;
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.postMessage({ type: 'dispose' });
  };
  return new Promise<RoadGeometry>((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data?.id !== 1) return;
      release();
      if (data.error) reject(new Error(data.error));
      else resolve(data as RoadGeometry);
    };
    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ type: 'route', id: 1, world: { terrain: world.terrain, mapSize: world.mapSize, seed: world.seed, options: world.options, stats: world.stats }, settings, points, cls });
  });
}

/** The new place joined by a local road to the nearest regional road (a T junction). Undefined: no local route. */
async function connectLocally(world: World, settings: V2Settings, key: string): Promise<World | undefined> {
  const place = world.settlements?.find(town => town.key === key),
    target = connectionPoint(world, key);
  if (!place || !target) return;
  try {
    const geometry = await routeOnce(world, settings, [place.center, target], 'local');
    const result = addRoad(world, geometry.path, { snap: 5, cls: 'local', controls: geometry.controls });
    return adoptUrbanRoad(result.world, result.road!);
  } catch {
    return undefined;
  }
}

/** Before a run that places the settlements again: keep or discard the custom places. False: the run is cancelled. */
export async function confirmCustomSettlements(state: PageState): Promise<boolean> {
  const custom = state.settings.region?.customPlaces ?? [];
  if (!custom.length) return true;
  const names = custom.map(place => (state.world && settlementDisplayName(state.world, place.key, state.settings)) || place.name || place.key);
  const answer = await chooseAction({
    id: 'custom-settlements-dialog',
    title: 'Keep custom settlements?',
    message: 'Placement draws the settlements again. Custom settlements (added or moved by hand) can stay where they are, with the automatic ones drawn around them.',
    details: [translate('{count} custom settlements').replace('{count}', String(custom.length)) + ' · ' + names.join(', ')],
    cancelValue: 'cancel',
    choices: [
      { value: 'discard', label: 'Discard' },
      { value: 'keep', label: 'Keep', primary: true },
    ],
  });
  if (answer.value === 'discard') discardCustomSettlements(state.settings);
  return answer.value === 'keep' || answer.value === 'discard';
}

/** The custom place leaves the recipe and the displayed world; the other places, their towns and the roads stay. */
function removeCustomSettlement(world: World, settings: V2Settings, key: string): World {
  if (settings.region?.customPlaces) settings.region.customPlaces = settings.region.customPlaces.filter(place => place.key !== key);
  if (!settings.region?.customPlaces?.length) delete settings.region?.customPlaces;
  if (settings.region?.placement?.list) settings.region.placement.list = settings.region.placement.list.filter(place => place.key !== key);
  delete settings.local[key];
  if (settings.urban?.local) delete settings.urban.local[key];
  const own = `:${key}`,
    stats = Object.fromEntries(Object.entries(world.stats).filter(([name]) => !name.endsWith(own)));
  const debug = { ...world.debug },
    cities = { ...(debug.v2RustCities as Record<string, unknown> | undefined) },
    bridges = { ...(debug.v2TownBridges as Record<string, NonNullable<World['bridges']>> | undefined) };
  delete cities[key];
  delete bridges[key];
  debug.v2RustCities = cities;
  debug.v2TownBridges = bridges;
  const settlements = (world.settlements ?? []).filter(place => place.key !== key);
  return {
    ...world,
    debug,
    stats: { ...stats, settlements: settlements.length },
    settlements,
    bridges: [...((debug.v2BaseBridges as World['bridges']) ?? []), ...Object.values(bridges).flat()],
    names: world.names && { ...world.names, entries: world.names.entries.filter(entry => !entry.id.startsWith(`urban:${encodeURIComponent(key)}:`) && entry.sub !== `settlement:${key}`) },
  };
}

/** The "Remove this settlement" button of a custom place's inspector. */
export function appendRemoveCustomSettlement(state: PageState, actions: PageActions, host: HTMLElement, key: string): void {
  if (!state.settings.region?.customPlaces?.some(place => place.key === key)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet small';
  button.id = 'remove-custom-settlement';
  setText(button, 'Remove this settlement');
  button.onclick = async () => {
    if (state.busy || !state.world) return;
    const next = acceptPlacementEdit(removeCustomSettlement(state.world, state.settings, key), state.settings, true);
    state.selectedTown = '';
    await actions.applyDirectMapEdit(next);
  };
  host.append(button);
}

export function mountSettlementAdd(state: PageState, actions: PageActions, toolbar: HTMLElement): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'add-settlement';
  setText(button, 'Add settlement');
  toolbar.append(button);

  async function place(choice: { population: number; culture: string }, point: Vec2): Promise<void> {
    const world = state.world;
    if (!world || state.busy) return;
    const key = addSettlement(state.settings, world, { ...choice, position: point });
    // As the settlement inspector's culture field: the town's own culture replaces an inherited cultural template.
    const rust = (state.settings.urban?.backend ?? state.settings.runtime?.backend) !== 'typescript';
    if (rust) writeUrbanControl(state.settings, { kind: 'settlement', key }, 'layout.culture', choice.culture);
    if (!world.settlements?.length || !world.site || state.settings.runtime?.backend === 'typescript') {
      // No placement to extend (or the classic engine): the custom place joins a full placement.
      actions.touchRecipe();
      if ((await actions.generate('region', undefined, undefined, undefined, undefined, undefined, true)) && state.world?.settlements?.some(town => town.key === key)) await actions.generate('town', key);
      return;
    }
    let next = insertSettlement(world, state.settings, key);
    let routed = state.settings.region?.roads === null;
    if (!routed) {
      actions.toast('Connecting the new settlement to the roads…');
      const connected = await connectLocally(next, state.settings, key);
      if (state.world !== world) return;
      if (connected) {
        next = connected;
        routed = true;
      }
    }
    await actions.applyDirectMapEdit(acceptPlacementEdit(next, state.settings, routed));
    // No local route: every road is routed again between the retained places.
    if (!routed && !(await actions.generate('roads'))) return;
    await actions.generate('town', key);
  }

  button.onclick = async () => {
    if (state.busy || !state.world || state.previewBase) return;
    const choice = await askSettlement(state.settings.options.culture);
    if (!choice || state.busy || !state.world) return;
    window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'placement' }));
    state.pendingRegionPosition = undefined;
    state.pendingSettlement = point => void place(choice, point).catch(error => actions.toast(String(error), true));
    // A phone has no Escape: the map's Cancel (editingTools.ts) ends the placement.
    actions.toast(handheldDevice() ? 'Tap the map to place the new settlement, or tap Cancel.' : 'Click on the map to place the new settlement. Esc cancels.');
  };
  window.addEventListener('v2-edit-mode', event => {
    if ((event as CustomEvent<string>).detail !== 'placement') state.pendingSettlement = undefined;
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !state.pendingSettlement) return;
    state.pendingSettlement = undefined;
    actions.toast('Settlement placement cancelled.');
  });
}
