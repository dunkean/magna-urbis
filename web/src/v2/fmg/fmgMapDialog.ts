import { insertHTML, numberLocale, registerMessages, setDynamicText, setText, setUserText, translate } from '../i18n';
import type { V2Settings } from '../contracts';
import { dragFmgCrop, fitFmgCrop, fmgBurgsInCrop, FMG_MAP_INVALID, FMG_MAP_TOO_LARGE, readFmgMapFile, type FmgCrop, type FmgMap } from './fmgMap';
import { fmgCropExtent, fmgCropSettings, FMG_CROP_LIMIT, FMG_CROP_TOO_MANY_BURGS } from './fmgRegion';
import './fmgMapDialog.css';

const copy = (en: string, fr: string) => {
  registerMessages({ [en]: { en, fr } });
  return en;
};
const labels = {
  file: copy('Azgaar .map file', 'Fichier .map Azgaar'),
  draw: copy('Drag a square over the area you want to generate.', 'Tracez un carré sur la zone à générer.'),
  coordinates: copy('Selection coordinates (map pixels)', 'Coordonnées de la sélection (pixels de la carte)'),
  left: copy('Left edge', 'Bord gauche'),
  top: copy('Top edge', 'Bord supérieur'),
  side: copy('Side length', 'Longueur du côté'),
  zoom: copy('Zoom to selection', 'Zoomer sur la sélection'),
  overview: copy('Whole map', 'Carte entière'),
  canvas: copy('Azgaar map preview with region selection', 'Aperçu de la carte Azgaar avec sélection de région'),
  extent: copy('Generation width (m)', 'Largeur de génération (m)'),
  customScale: copy('This map uses an unknown distance unit. Enter the width to generate in metres.', 'La carte utilise une unité de distance inconnue. Indiquez la largeur à générer en mètres.'),
  generate: copy('Generate selected region', 'Générer la région sélectionnée'),
  reading: copy('Reading Azgaar map…', 'Lecture de la carte Azgaar…'),
  data: copy('Imports relief and burgs. Magna Urbis generates rivers, roads and buildings.', 'Importe le relief et les bourgs. Magna Urbis génère les cours d’eau, les routes et les bâtiments.'),
  empty: copy('No burgs in this selection', 'Aucun bourg dans cette sélection'),
  one: copy('1 burg', '1 bourg'),
  burgs: copy('{count} burgs', '{count} bourgs'),
  width: copy('{width} km wide', '{width} km de large'),
  resized: copy('The source selection is {original} km wide. It will be rescaled to {width} km to fit V2.', 'La sélection d’origine mesure {original} km de large. Elle sera redimensionnée à {width} km pour V2.'),
};
copy(FMG_MAP_INVALID, 'Ce fichier n’est pas une carte Azgaar .map prise en charge.');
copy(FMG_MAP_TOO_LARGE, 'La carte Azgaar dépasse la limite de 64 Mio.');
copy(FMG_CROP_TOO_MANY_BURGS, 'Choisissez une zone plus petite. Une région peut contenir jusqu’à 1 000 bourgs.');

interface View {
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawTerrain(canvas: HTMLCanvasElement, map: FmgMap, view: View): void {
  const scale = 640 / Math.max(view.width, view.height);
  canvas.width = Math.max(1, Math.round(view.width * scale));
  canvas.height = Math.max(1, Math.round(view.height * scale));
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const height = map.elevationAt(view.x + ((x + 0.5) * view.width) / canvas.width, view.y + ((y + 0.5) * view.height) / canvas.height);
      const i = (y * canvas.width + x) * 4;
      if (height < 0) {
        const depth = Math.min(1, -height / 750);
        image.data[i] = 74 - depth * 31;
        image.data[i + 1] = 125 - depth * 36;
        image.data[i + 2] = 151 - depth * 30;
      } else {
        const upland = Math.min(1, Math.log1p(height) / 8);
        image.data[i] = 117 + upland * 92;
        image.data[i + 1] = 153 + upland * 39;
        image.data[i + 2] = 98 + upland * 66;
      }
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.fillStyle = '#fff3d3';
  ctx.strokeStyle = '#312a21';
  ctx.font = '12px sans-serif';
  for (const burg of map.burgs) {
    const x = ((burg.x - view.x) * canvas.width) / view.width;
    const y = ((burg.y - view.y) * canvas.height) / view.height;
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
    const radius = burg.population > 5000 ? 3 : 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    if (view.width < map.width / 3 && view.height < map.height / 3) {
      ctx.lineWidth = 3;
      ctx.strokeText(burg.name, x + 6, y - 5);
      ctx.fillText(burg.name, x + 6, y - 5);
      ctx.lineWidth = 1;
    }
  }
}

export function mountFmgMapDialog(host: HTMLElement, bindings: { busy(): boolean; load(settings: V2Settings): Promise<void> }): void {
  insertHTML(
    host,
    'afterbegin',
    `<section class="fmg-map-import">
      <label class="label" for="fmg-map-file">${labels.file}</label>
      <input id="fmg-map-file" type="file" accept=".map">
      <p id="fmg-map-error" class="warning" role="alert"></p>
      <div id="fmg-map-selection" hidden>
        <p id="fmg-map-name"></p>
        <p class="hint" id="fmg-map-draw">${labels.draw}</p>
        <canvas id="fmg-map-canvas" role="img" aria-label="${labels.canvas}" aria-describedby="fmg-map-draw"></canvas>
        <div class="dialog-actions">
          <button id="fmg-map-zoom" type="button">${labels.zoom}</button>
          <button id="fmg-map-overview" type="button">${labels.overview}</button>
        </div>
        <details>
          <summary>${labels.coordinates}</summary>
          <div class="fmg-map-coordinates">
            <label>${labels.left}<input id="fmg-map-left" type="number" min="0" step="any"></label>
            <label>${labels.top}<input id="fmg-map-top" type="number" min="0" step="any"></label>
            <label>${labels.side}<input id="fmg-map-side" type="number" min="0.01" step="any"></label>
          </div>
        </details>
        <div id="fmg-map-custom-scale" hidden>
          <p class="hint">${labels.customScale}</p>
          <label>${labels.extent}<input id="fmg-map-extent" type="number" min="500" max="100000" step="1" value="6000" required></label>
        </div>
        <p class="hint" id="fmg-map-summary" role="status"></p>
        <p class="warning" id="fmg-map-scale"></p>
        <p class="hint">${labels.data}</p>
        <div class="dialog-actions"><button id="fmg-map-generate" class="primary" type="button">${labels.generate}</button></div>
      </div>
    </section>`,
  );
  const get = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#fmg-map-${id}`)!;
  const file = get<HTMLInputElement>('file');
  const selection = get('selection');
  const error = get('error');
  const canvas = get<HTMLCanvasElement>('canvas');
  const summary = get('summary');
  const scaleNotice = get('scale');
  const generate = get<HTMLButtonElement>('generate');
  const zoom = get<HTMLButtonElement>('zoom');
  const overview = get<HTMLButtonElement>('overview');
  const customExtent = get<HTMLInputElement>('extent');
  const fields = ['left', 'top', 'side'].map(key => get<HTMLInputElement>(key));
  const background = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  let map: FmgMap | undefined;
  let crop: FmgCrop;
  let view: View;
  let filename = '';
  let submitting = false;
  let press: { pointerId: number; point: [number, number] } | undefined;

  function drawSelection() {
    const x = ((crop.x - view.x) * canvas.width) / view.width;
    const y = ((crop.y - view.y) * canvas.height) / view.height;
    const w = (crop.side * canvas.width) / view.width;
    const h = (crop.side * canvas.height) / view.height;
    ctx.drawImage(background, 0, 0);
    ctx.fillStyle = '#14212573';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff5cf';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function updateSelection(updateFields = true) {
    if (!map) return;
    drawSelection();
    if (updateFields) {
      fields[0].value = String(crop.x);
      fields[1].value = String(crop.y);
      fields[2].value = String(crop.side);
    }
    const count = fmgBurgsInCrop(map, crop).length;
    const { original, width, resized } = fmgCropExtent(map, crop, customExtent.valueAsNumber);
    generate.disabled = submitting || count > FMG_CROP_LIMIT || (map.metresPerPixel === undefined && !customExtent.validity.valid);
    setDynamicText(summary, () => {
      const format = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 2 });
      const selectionWidth = translate(labels.width).replace('{width}', format.format(width / 1000));
      const burgCount = translate(count === 0 ? labels.empty : count === 1 ? labels.one : labels.burgs).replace('{count}', format.format(count));
      return `${selectionWidth} · ${burgCount}`;
    });
    setDynamicText(scaleNotice, () => {
      if (count > FMG_CROP_LIMIT) return FMG_CROP_TOO_MANY_BURGS;
      if (!resized) return '';
      const format = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 3 });
      return translate(labels.resized)
        .replace('{original}', format.format(original! / 1000))
        .replace('{width}', format.format(width / 1000));
    });
  }

  function showView(next: View) {
    if (!map) return;
    view = next;
    overview.disabled = view.width === map.width && view.height === map.height;
    drawTerrain(background, map, view);
    canvas.width = background.width;
    canvas.height = background.height;
    updateSelection();
  }

  file.onchange = async () => {
    const source = file.files?.[0];
    if (!source || bindings.busy() || submitting) return;
    file.disabled = true;
    selection.hidden = true;
    map = undefined;
    setText(error, labels.reading);
    try {
      const loaded = await readFmgMapFile(source);
      map = loaded;
      filename = source.name;
      const side = loaded.metresPerPixel ? 40000 / loaded.metresPerPixel : Math.min(loaded.width, loaded.height) / 4;
      const largest = loaded.burgs.reduce<(typeof loaded.burgs)[number] | undefined>((best, burg) => (!best || burg.population > best.population ? burg : best), undefined);
      crop = fitFmgCrop(loaded, { x: (largest?.x ?? loaded.width / 2) - side / 2, y: (largest?.y ?? loaded.height / 2) - side / 2, side });
      get('custom-scale').hidden = loaded.metresPerPixel !== undefined;
      setUserText(get('name'), loaded.name ?? filename, labels.file);
      showView({ x: 0, y: 0, width: loaded.width, height: loaded.height });
      selection.hidden = false;
      setText(error, '');
    } catch (e) {
      file.value = '';
      setText(error, e instanceof Error && e.message === FMG_MAP_TOO_LARGE ? FMG_MAP_TOO_LARGE : FMG_MAP_INVALID);
    } finally {
      file.disabled = false;
    }
  };

  zoom.onclick = () => {
    if (!map) return;
    const enlarged = fitFmgCrop(map, { x: crop.x - crop.side, y: crop.y - crop.side, side: crop.side * 3 });
    showView({ x: enlarged.x, y: enlarged.y, width: enlarged.side, height: enlarged.side });
  };
  overview.onclick = () => {
    if (map) showView({ x: 0, y: 0, width: map.width, height: map.height });
  };
  for (const field of fields)
    field.onchange = () => {
      if (!map) return;
      const [x, y, side] = fields.map(input => input.valueAsNumber);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(side)) crop = fitFmgCrop(map, { x, y, side });
      updateSelection();
    };
  customExtent.oninput = () => updateSelection(false);

  function sourcePoint(event: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const fraction = (position: number, origin: number, size: number) => Math.min(1, Math.max(0, (position - origin) / size));
    return [view.x + fraction(event.clientX, rect.left, rect.width) * view.width, view.y + fraction(event.clientY, rect.top, rect.height) * view.height];
  }
  canvas.onpointerdown = event => {
    if (!map || submitting || press || event.button !== 0 || !event.isPrimary) return;
    press = { pointerId: event.pointerId, point: sourcePoint(event) };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!map || press?.pointerId !== event.pointerId) return;
    crop = dragFmgCrop(map, press.point, sourcePoint(event));
    drawSelection();
  };
  canvas.onpointerup = event => {
    if (!map || press?.pointerId !== event.pointerId) return;
    const end = sourcePoint(event);
    if (end[0] === press.point[0] && end[1] === press.point[1]) crop = fitFmgCrop(map, { x: end[0] - crop.side / 2, y: end[1] - crop.side / 2, side: crop.side });
    else crop = dragFmgCrop(map, press.point, end);
    press = undefined;
    updateSelection();
  };
  canvas.onlostpointercapture = () => {
    if (!press) return;
    press = undefined;
    updateSelection();
  };

  generate.onclick = async () => {
    if (!map || submitting || bindings.busy() || generate.disabled) return;
    submitting = true;
    generate.disabled = true;
    file.disabled = true;
    setText(error, '');
    try {
      await bindings.load(fmgCropSettings(map, crop, filename, customExtent.valueAsNumber));
      host.closest('dialog')?.close();
    } catch (e) {
      setText(error, e instanceof Error ? e.message : String(e));
    } finally {
      submitting = false;
      file.disabled = false;
      updateSelection();
    }
  };
}
