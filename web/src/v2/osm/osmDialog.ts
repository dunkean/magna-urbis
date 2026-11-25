import { cleanSettlementName, CULTURE_LABELS, SETTLEMENT_NAME_MAX } from '../../gen/options';
import { getLanguage, numberLocale, registerMessages, setHTML, setText, setUserText, translate } from '../i18n';
import { $, options } from '../page/dom';
import type { PageActions, PageState } from '../page/contract';
import { runtimeWorkerOptions } from '../platform';
import { browserOsmFetchers, findOsmPlaces } from './browserSources';
import { fetchOsmDem, fetchOsmImportFeatures, osmProjection, terrariumTiles, type OsmSquare } from './osmSources';
import type { OsmImport, OsmImportInput, OsmImportOptions } from './osmImport';
import OsmWorker from './osm.worker?worker';
import './osmDialog.css';

const messages = {
  Import: 'Importer',
  'Import a real place': 'Importer un lieu réel',
  'City or region': 'Ville ou région',
  'Place results': 'Résultats de recherche',
  'Map name': 'Nom de la carte',
  'Centre latitude': 'Latitude du centre',
  'Centre longitude': 'Longitude du centre',
  'Square side (0.5–20 km)': 'Côté du carré (0,5 à 20 km)',
  'Building style': 'Style des bâtiments',
  'Limit urban features to a commune (optional)': 'Limiter les éléments urbains à une commune (facultatif)',
  'Enter the exact OSM name of an admin level 8 boundary. Relief, regional roads and water cover the full square.': 'Saisissez le nom OSM exact d’une limite administrative de niveau 8. Le relief, les routes régionales et l’eau couvrent tout le carré.',
  'Relief preview': 'Aperçu du relief',
  'Preview relief': 'Aperçu du relief',
  'Import & generate': 'Importer et générer',
  'The imported map replaces the current project. Save your map first if you want to keep it.': 'La carte importée remplace le projet actuel. Enregistrez votre carte si vous voulez la conserver.',
  'Searching for places…': 'Recherche de lieux…',
  'Choose a place from the results.': 'Choisissez un lieu parmi les résultats.',
  'No place found. Try a more specific name or enter the coordinates.': 'Aucun lieu trouvé. Précisez le nom ou saisissez les coordonnées.',
  'The search service is unavailable. You can enter the coordinates directly.': 'La recherche est indisponible. Vous pouvez saisir directement les coordonnées.',
  'Choose a square within the supported bounds (85° S to 85° N, without crossing 180° longitude).': 'Choisissez un carré entre 85° S et 85° N, sans franchir le méridien de 180°.',
  'Downloading AWS elevation…': 'Téléchargement du relief AWS…',
  'Downloading elevation and OpenStreetMap data…': 'Téléchargement du relief et des données OpenStreetMap…',
  'Downloading OpenStreetMap data…': 'Téléchargement des données OpenStreetMap…',
  'Trying another OpenStreetMap server…': 'Nouvelle tentative sur un autre serveur OpenStreetMap…',
  'Map import progress': 'Progression de l’import',
  'Building the imported map…': 'Construction de la carte importée…',
  'Drawing the imported map…': 'Affichage de la carte importée…',
  'The relief preview could not be loaded.': 'Impossible de charger l’aperçu du relief.',
  'The map could not be imported.': 'Impossible d’importer la carte.',
  'Real place imported.': 'Lieu réel importé.',
};
registerMessages(Object.fromEntries(Object.entries(messages).map(([en, fr]) => [en, { en, fr }])));

const MIN_KM = 0.5;
const MAX_KM = 20;
const GRID = 512;

function reliefZoom(square: OsmSquare): number {
  const { bounds } = osmProjection(square);
  let zoom = square.size <= 10000 ? 14 : 13;
  // The same ground area spans many more Mercator tiles near the poles.
  while (terrariumTiles(bounds, zoom).length > 64) zoom--;
  return zoom;
}

export const osmCredits = `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener noreferrer">AWS Terrain Tiles</a>`;

function convert(input: OsmImportInput, signal: AbortSignal): Promise<OsmImport> {
  signal.throwIfAborted();
  const worker = new OsmWorker(runtimeWorkerOptions());
  let cancel: () => void;
  return new Promise<OsmImport>((resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(data.result));
    worker.onerror = event => reject(new Error(event.message));
    worker.onmessageerror = () => reject(new Error('Could not read the imported map.'));
    worker.postMessage(input);
  }).finally(() => {
    signal.removeEventListener('abort', cancel);
    worker.terminate();
  });
}

function drawRelief(canvas: HTMLCanvasElement, dem: Awaited<ReturnType<typeof fetchOsmDem>>['dem'], square: OsmSquare): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D unavailable');
  const pixels = context.createImageData(canvas.width, canvas.height);
  const { elevations, min, max } = dem;
  const n = canvas.width;
  const step = GRID / n;
  const cell = square.size / n;
  const range = Math.max(1, max - min);
  const height = (x: number, y: number) => elevations[Math.floor(y * step + step / 2) * GRID + Math.floor(x * step + step / 2)];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const z = height(x, y);
      const slope = (height(Math.max(0, x - 1), Math.max(0, y - 1)) - height(Math.min(n - 1, x + 1), Math.min(n - 1, y + 1))) / (2 * cell);
      const tone = Math.max(-48, Math.min(48, slope * 95));
      const h = (z - min) / range;
      const offset = (y * n + x) * 4;
      pixels.data.set(z < 0 ? [52, 86, 102, 255] : [120 + 95 * h + tone, 140 + 66 * h + tone, 110 + 72 * h + tone, 255], offset);
    }
  }
  context.putImageData(pixels, 0, 0);
}

export function mountOsmImport(state: PageState, actions: PageActions): void {
  setHTML(
    $('#osm-dialog'),
    `
    <div class="dialog-head"><h2 id="osm-title">Import a real place</h2><button id="osm-close" type="button" aria-label="Close">×</button></div>
    <form id="osm-search" class="osm-search"><label class="label" for="osm-query">City or region</label><div class="row"><input id="osm-query" type="search" maxlength="100" minlength="2" required placeholder="Carcassonne"><button type="submit">Search</button></div></form>
    <div id="osm-results-row" hidden><label class="label" for="osm-results">Place results</label><select id="osm-results"></select></div>
    <form id="osm-form">
      <div class="osm-layout">
        <div class="osm-fields">
          <label><span class="label">Map name</span><input name="mapName" maxlength="${SETTLEMENT_NAME_MAX}" value="Carcassonne" required></label>
          <div class="osm-coordinates">
            <label><span class="label">Centre latitude</span><input name="latitude" type="number" min="-85" max="85" step="any" value="43.2085" required></label>
            <label><span class="label">Centre longitude</span><input name="longitude" type="number" min="-180" max="180" step="any" value="2.3575" required></label>
          </div>
          <label><span class="label">Square side (0.5–20 km)</span><input name="side" type="number" min="${MIN_KM}" max="${MAX_KM}" step="any" value="4" required></label>
          <label><span class="label">Building style</span><select name="culture">${options(CULTURE_LABELS)}</select></label>
          <label><span class="label">Limit urban features to a commune (optional)</span><input name="commune" maxlength="100" aria-describedby="osm-commune-hint"></label>
          <p class="hint" id="osm-commune-hint">Enter the exact OSM name of an admin level 8 boundary. Relief, regional roads and water cover the full square.</p>
        </div>
        <figure class="osm-relief"><div class="osm-preview-frame"><canvas id="osm-preview" width="256" height="256" aria-label="Relief preview" hidden></canvas><span aria-hidden="true">N ↑</span></div><figcaption><button id="osm-preview-go" type="button">Preview relief</button><output id="osm-elevation" class="hint" hidden></output></figcaption></figure>
      </div>
      <p class="hint">The imported map replaces the current project. Save your map first if you want to keep it.</p>
      <p class="hint osm-credits">${osmCredits} · <a href="https://github.com/komoot/photon#demo-server" target="_blank" rel="noopener noreferrer">Photon</a></p>
      <div class="osm-feedback">
        <div class="osm-progress-heading"><p id="osm-status" role="status" hidden></p><span id="osm-elapsed" class="hint" aria-hidden="true" hidden></span></div>
        <progress id="osm-progress" max="4" aria-label="Map import progress" aria-describedby="osm-status" hidden></progress>
        <p id="osm-error" class="hint" role="alert" hidden></p>
      </div>
      <div class="dialog-actions"><button id="osm-cancel" type="button">Cancel</button><button id="osm-generate" type="submit" class="primary">Import &amp; generate</button></div>
    </form>
  `,
  );

  const dialog = $<HTMLDialogElement>('#osm-dialog');
  const form = $<HTMLFormElement>('#osm-form');
  const search = $<HTMLFormElement>('#osm-search');
  const query = $<HTMLInputElement>('#osm-query');
  const resultField = $<HTMLSelectElement>('#osm-results');
  const resultRow = $('#osm-results-row');
  const status = $('#osm-status');
  const detail = $('#osm-error');
  const progress = $<HTMLProgressElement>('#osm-progress');
  const elapsed = $('#osm-elapsed');
  const canvas = $<HTMLCanvasElement>('#osm-preview');
  const elevation = $('#osm-elevation');
  const closeButton = $<HTMLButtonElement>('#osm-close');
  const cancelButton = $<HTMLButtonElement>('#osm-cancel');
  const inputs = form.elements.namedItem.bind(form.elements);
  const mapName = inputs('mapName') as HTMLInputElement;
  const latitude = inputs('latitude') as HTMLInputElement;
  const longitude = inputs('longitude') as HTMLInputElement;
  const side = inputs('side') as HTMLInputElement;
  const culture = inputs('culture') as HTMLSelectElement;
  const commune = inputs('commune') as HTMLInputElement;
  culture.value = 'european-organic';
  const cache = new Map<string, Awaited<ReturnType<typeof findOsmPlaces>>>();
  let places: Awaited<ReturnType<typeof findOsmPlaces>> = [];
  let active: AbortController | undefined;
  let applying = false;
  let progressTimer: ReturnType<typeof setInterval> | undefined;
  let preview: { key: string; data: Awaited<ReturnType<typeof fetchOsmDem>>['dem'] } | undefined;

  function feedback(message = '', error = ''): void {
    if (status.dataset.i18n !== message) setText(status, message);
    setUserText(detail, error, '');
    status.hidden = !message;
    detail.hidden = !error;
  }

  function showProgress(message: string, completed: number): void {
    if (!progressTimer) {
      const start = performance.now();
      const tick = () => {
        elapsed.textContent = `${Math.floor((performance.now() - start) / 1000)} s`;
        if (applying) $('#progress-time').textContent = elapsed.textContent;
      };
      tick();
      progressTimer = setInterval(tick, 1000);
    }
    feedback(message);
    progress.value = completed;
    progress.hidden = elapsed.hidden = false;
  }

  function syncBusy(next: boolean): void {
    dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(field => (field.disabled = next));
    closeButton.disabled = cancelButton.disabled = applying;
  }

  async function run(failure: string, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (active || state.busy) return;
    const controller = new AbortController();
    active = controller;
    syncBusy(true);
    try {
      await task(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) feedback(failure, error instanceof Error ? error.message : String(error));
    } finally {
      controller.abort();
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = undefined;
      progress.hidden = elapsed.hidden = true;
      active = undefined;
      syncBusy(false);
    }
  }

  function clearPreview(): void {
    preview = undefined;
    elevation.hidden = canvas.hidden = true;
    feedback();
  }

  function area(): OsmSquare | undefined {
    if (![latitude, longitude, side].every(field => field.reportValidity())) return;
    const square = { lat: latitude.valueAsNumber, lon: longitude.valueAsNumber, size: side.valueAsNumber * 1000 };
    const { bounds } = osmProjection(square);
    if (bounds.south < -85 || bounds.north > 85 || bounds.west <= -180 || bounds.east >= 180) {
      feedback('Choose a square within the supported bounds (85° S to 85° N, without crossing 180° longitude).');
      return;
    }
    return square;
  }

  async function getRelief(square: OsmSquare, zoom: number, signal: AbortSignal, onTiles?: (done: number, total: number) => void) {
    const key = JSON.stringify(square);
    if (preview?.key === key) return preview.data;
    const { dem } = await fetchOsmDem(square, { grid: GRID, zoom }, browserOsmFetchers(signal), onTiles);
    signal.throwIfAborted();
    preview = { key, data: dem };
    return dem;
  }

  function close(): void {
    if (applying) return;
    active?.abort();
    dialog.close();
  }

  closeButton.onclick = cancelButton.onclick = close;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  $('#osm-open').onclick = () => {
    if (state.busy) return;
    feedback();
    actions.dialog('#osm-dialog');
  };

  search.onsubmit = event => {
    event.preventDefault();
    const text = query.value.trim();
    if (text.length < 2) return;
    void run('The search service is unavailable. You can enter the coordinates directly.', async signal => {
      feedback('Searching for places…');
      resultRow.hidden = true;
      const key = `${getLanguage()}:${text.toLowerCase()}`;
      places = cache.get(key) ?? (await findOsmPlaces(text, getLanguage(), signal));
      signal.throwIfAborted();
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(key, places);
      if (!places.length) return feedback('No place found. Try a more specific name or enter the coordinates.');
      resultField.replaceChildren(new Option(translate('Choose a place from the results.'), ''), ...places.map(({ properties: p }, i) => new Option([...new Set([p.name, p.city, p.county, p.state, p.country].filter(Boolean))].join(', '), String(i))));
      resultRow.hidden = false;
      feedback();
      resultField.disabled = false;
      resultField.focus();
    });
  };

  resultField.onchange = () => {
    if (resultField.value === '') return;
    const {
      geometry: {
        coordinates: [lon, lat],
      },
      properties,
    } = places[Number(resultField.value)];
    mapName.value = cleanSettlementName(properties.name) ?? '';
    latitude.value = lat.toFixed(6);
    longitude.value = lon.toFixed(6);
    const extent = properties.extent;
    if (extent?.length === 4 && extent.every(Number.isFinite)) {
      const [west, north, east, south] = extent;
      const size = 222.4 * Math.max(Math.abs(north - lat), Math.abs(south - lat), Math.max(Math.abs(east - lon), Math.abs(west - lon)) * Math.cos((lat * Math.PI) / 180));
      side.value = String(Math.min(MAX_KM, Math.max(MIN_KM, Math.ceil(size * 10) / 10)));
    } else side.value = '4';
    clearPreview();
  };
  for (const field of [latitude, longitude, side]) field.oninput = clearPreview;

  $('#osm-preview-go').onclick = () => {
    const square = area();
    if (!square) return;
    void run('The relief preview could not be loaded.', async signal => {
      feedback('Downloading AWS elevation…');
      const dem = await getRelief(square, reliefZoom(square), signal);
      drawRelief(canvas, dem, square);
      const number = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 0 });
      elevation.textContent = `${number.format(dem.min)} – ${number.format(dem.max)} m`;
      elevation.hidden = canvas.hidden = false;
      feedback();
    });
  };

  form.onsubmit = event => {
    event.preventDefault();
    const square = area();
    const name = cleanSettlementName(mapName.value);
    if (!square) return;
    if (!name) {
      mapName.value = '';
      mapName.reportValidity();
      return;
    }
    const options: OsmImportOptions = { ...square, name, culture: culture.value, grid: GRID, zoom: reliefZoom(square), communeName: commune.value.trim() || undefined };
    void run('The map could not be imported.', async signal => {
      let relief = 0;
      let osm = 0;
      let fallback = false;
      const updateNetworkProgress = () => {
        if (signal.aborted) return;
        let message = 'Downloading elevation and OpenStreetMap data…';
        if (osm) message = 'Downloading AWS elevation…';
        else if (fallback) message = 'Trying another OpenStreetMap server…';
        else if (relief === 1) message = 'Downloading OpenStreetMap data…';
        showProgress(message, relief + osm);
      };
      updateNetworkProgress();
      const [dem, features] = await Promise.all([
        getRelief(square, options.zoom, signal, (done, total) => {
          relief = done / total;
          updateNetworkProgress();
        }).then(dem => {
          relief = 1;
          updateNetworkProgress();
          return dem;
        }),
        fetchOsmImportFeatures(
          square,
          { commune: options.communeName },
          browserOsmFetchers(signal, () => {
            fallback = true;
            updateNetworkProgress();
          }),
        ).then(features => {
          osm = 1;
          updateNetworkProgress();
          return features;
        }),
      ]);
      showProgress('Building the imported map…', 2);
      const result = await convert({ ...features, options, elevations: dem.elevations }, signal);
      signal.throwIfAborted();
      if (state.busy) throw new Error(translate('A computation is already running.'));
      applying = true;
      syncBusy(true);
      actions.setBusy(true);
      $<HTMLButtonElement>('#cancel-job').disabled = true;
      try {
        setText($('#progress-label'), 'Drawing the imported map…');
        setText($('#progress-detail'), '');
        $('#progress-time').textContent = elapsed.textContent;
        const mapProgress = $<HTMLProgressElement>('#progress');
        mapProgress.value = 75;
        dialog.close();
        // A new map uses the current display settings, including the app's lightweight preset on slow hardware.
        if (state.settings.appearance) result.settings.appearance = structuredClone(state.settings.appearance);
        await actions.loadProject({ settings: result.settings, world: result.world, mods: [] });
        state.client.viewer.fit();
        actions.selectTab(result.summary.buildings ? 'cities' : 'map');
        actions.log(`OpenStreetMap import: ${options.name} · ${result.summary.buildings} buildings · ${result.summary.roads + result.summary.streets} roads and streets`);
        mapProgress.value = 100;
        actions.toast('Real place imported.');
      } catch (error) {
        actions.reportAppearanceError(error);
      } finally {
        applying = false;
        actions.setBusy(false);
      }
    });
  };
}
