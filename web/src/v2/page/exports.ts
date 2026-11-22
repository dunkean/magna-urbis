/**
 * The export dialog: exact PNG and SVG maps (whole or cropped), projects, recipes, seeds and heightmaps, and the
 * Save map shortcut. Also opens the page's dialogs, refreshing the export options first for the export dialog.
 */
import type { PageActions, PageState } from './contract';
import { setText, bindTree, translate, registerMessages } from '../i18n';
import { mapPresentation } from '../mapPresentation';
import { ruralSemanticLegend } from '../../render/semanticLayer';
import { resolveSettingsAppearance, resolvedDisplayOptions } from '../appearance';
import type { World } from '../../gen/types';
import type { ExportLayers } from '../../render/exportLayers';
import { chooseExportArea, chooseExportCrop } from '../../ui/exportCrop';
import { canvasPng, cropCanvasPng } from '../../ui/canvasExport';
import { supportsSvgExport } from '../exportOptions';
import { exportPng } from '../../ui/pngExport';
import ExportWorker from '../export.worker?worker';
import { migrateUrbanSeeds } from '../urbanSeeds';
import { $ } from './dom';
import { projectJob } from './projectWorkers';

export function createExportsActions(state: PageState, actions: PageActions) {
  function download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function svgExport(): Promise<Blob> {
    const layers = exportLayers(),
      width = Number($<HTMLSelectElement>('#export-resolution').value);
    const resolved = resolveSettingsAppearance(state.settings, state.world, 'export');
    if (!supportsSvgExport(resolved)) throw new Error(translate('SVG is unavailable for the current style. Use PNG.'));
    if (!resolved.cartography.roads) {
      layers.roads = false;
      layers.streets = false;
    }
    if (!resolved.ground.layers.water) layers.water = false;
    const display = resolvedDisplayOptions(resolved);
    if (!resolved.ground.layers.relief) display.raster = false;
    const lu = resolved.composition.landuse;
    if (state.world && layers.landuse !== false && lu.rural !== 'off') display.semanticLegend = ruralSemanticLegend(state.world.landuse, lu.classes, lu.rural); // urban entries need the city scenes (composite path only)
    const brushes = resolved.cartography.painted ? (await import('../../render/assets/brushAssets')).BRUSH_SOURCES : undefined;
    const worker = new ExportWorker();
    try {
      return await new Promise<Blob>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('SVG export timed out')), 120000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          data.error ? reject(new Error(data.error)) : resolve(data.blob);
        };
        worker.onerror = e => {
          clearTimeout(timer);
          reject(new Error(e.message));
        };
        worker.onmessageerror = () => {
          clearTimeout(timer);
          reject(new Error('Could not read the SVG export.'));
        };
        try {
          worker.postMessage({
            id: 1,
            world: state.world ? exportWorld(mapPresentation(state.world, state.settings)) : state.world,
            options: { width, style: resolved.palette.mapStyle, layers, roadLook: resolved.composition.networks.roads.look, roadEmphasis: resolved.composition.networks.roads.emphasis, roadNight: resolved.composition.ambience === 'night' },
            display,
            brushes,
          });
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    } finally {
      worker.terminate();
    }
  }

  function exportLayers(): Partial<ExportLayers> {
    return Object.fromEntries(Array.from($('#export-dialog').querySelectorAll<HTMLInputElement>('[data-layer]')).map(c => [c.dataset.layer, c.checked]));
  }

  async function pngMapExport(width: number, crop: boolean): Promise<Blob | null> {
    const resolved = resolveSettingsAppearance(state.settings, state.world, 'export');
    if (resolved.path === 'classic') {
      let blob = await svgExport(),
        dimensions: number | { width: number; height: number } = width;
      if (crop) {
        const result = await chooseExportCrop(blob, width, bindTree);
        if (!result) return null;
        blob = result.blob;
        dimensions = result;
      }
      return exportPng(blob, dimensions, phase => {
        setText($('#export-note'), `Export PNG : ${phase}`);
        actions.log(`Export PNG : ${phase}`);
      });
    }
    const image = await state.client.exportBench(state.settings, resolved, width, exportLayers());
    try {
      setText($('#export-note'), 'Encoding PNG…');
      const png = await canvasPng(image);
      if (!crop) return png;
      const bounds = { x: 0, y: 0, width: state.world!.mapSize, height: state.world!.mapSize };
      const area = await chooseExportArea(png, bounds, width, bindTree);
      return area ? await cropCanvasPng(image, bounds, area.rect, area) : null;
    } finally {
      image.width = image.height = 0;
    }
  }

  /** The SVG export never reads the native town snapshots: they are not cloned into its worker. */
  function exportWorld(world: World): World {
    if (!world.debug?.v2RustCities) return world;
    const { v2RustCities: _cities, ...debug } = world.debug;
    return { ...world, debug };
  }

  async function heightmapBlob(): Promise<{ blob: Blob; metadata: Blob }> {
    if (!state.world) throw new Error('Create a map first.');
    const grid = state.world.terrain.height,
      c = document.createElement('canvas');
    c.width = grid.w;
    c.height = grid.h;
    const ctx = c.getContext('2d')!,
      pixels = ctx.createImageData(grid.w, grid.h);
    let lo = Infinity,
      hi = -Infinity;
    for (const value of grid.data) {
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
    for (let i = 0; i < grid.data.length; i++) {
      const value = Math.round((255 * (grid.data[i] - lo)) / Math.max(1e-9, hi - lo));
      pixels.data.set([value, value, value, 255], i * 4);
    }
    ctx.putImageData(pixels, 0, 0);
    actions.log(`8-bit heightmap: black ${lo.toFixed(3)} m, white ${hi.toFixed(3)} m. Use a JSON project to retain FP32.`);
    const metadata = new Blob([JSON.stringify({ format: 'magna-urbis-heightmap', version: 1, width: grid.w, height: grid.h, mapSize: state.world.mapSize, minHeight: lo, maxHeight: hi, seed: state.world.seed }, null, 2)], { type: 'application/json' });
    try {
      return { blob: await canvasPng(c), metadata };
    } finally {
      c.width = c.height = 0;
    }
  }

  function syncExportOptions(): void {
    const svg = $<HTMLOptionElement>('#export-format option[value="svg"]'),
      available = supportsSvgExport(resolveSettingsAppearance(state.settings, state.world, 'export'));
    svg.disabled = !available;
    setText(svg, available ? 'SVG vector map' : 'SVG vector map · unavailable for this style');
    const select = $<HTMLSelectElement>('#export-format');
    if (!available && select.value === 'svg') select.value = 'png';
    const format = select.value;
    $('#export-map-options').hidden = !['png', 'svg'].includes(format);
    setText(
      $('#export-note'),
      format === 'binary'
        ? 'The binary project retains the exact map, settings and edits in a compressed file.'
        : format === 'project'
          ? 'The JSON project is a readable interchange format. Use Save map for a smaller file.'
          : format === 'heightmap'
            ? '256-level PNG accompanied by minimum/maximum elevations. Save map retains the exact FP32 grids.'
            : format === 'recipe'
              ? 'The recipe retains settings and edits. Faithful reproduction requires the same engine version.'
              : format === 'seed'
                ? 'The seed alone contains neither your settings nor your edits.'
                : format === 'names'
                  ? 'Renamed places and edited labels, which the short code does not carry.'
                : !available
                  ? 'SVG is unavailable for the current style. Use PNG.'
                  : 'Visual exports use the current map without rerunning generation.',
    );
  }
  return { download, svgExport, pngMapExport, heightmapBlob, syncExportOptions };
}

export function mountExports(state: PageState, actions: PageActions): void {
  // The export operations that are not page actions (pngMapExport, svgExport, heightmapBlob).
  const exporter = createExportsActions(state, actions);

  registerMessages({
    'SVG is unavailable for the current style. Use PNG.': { en: 'SVG is unavailable for the current style. Use PNG.', fr: 'Le SVG n’est pas disponible pour le style actuel. Utilisez le PNG.' },
    'SVG vector map · unavailable for this style': { en: 'SVG vector map · unavailable for this style', fr: 'Carte vectorielle SVG · indisponible pour ce style' },
    'Encoding PNG…': { en: 'Encoding PNG…', fr: 'Encodage du PNG…' },
    'Names · JSON': { en: 'Names · JSON', fr: 'Noms · JSON' },
    'Renamed places and edited labels, which the short code does not carry.': { en: 'Renamed places and edited labels, which the short code does not carry.', fr: 'Les lieux renommés et les étiquettes modifiées, que le code court ne contient pas.' },
  });

  $<HTMLSelectElement>('#export-format').onchange = actions.syncExportOptions;

  $('#export-go').onclick = async () => {
    if (state.busy || $<HTMLButtonElement>('#export-go').disabled) return;
    const format = $<HTMLSelectElement>('#export-format').value;
    migrateUrbanSeeds(state.settings);
    $<HTMLInputElement>('#seed').value = state.settings.options.seed;
    if (!state.world && !['recipe', 'seed', 'names'].includes(format)) {
      actions.toast('Create a map first.');
      return;
    }
    $<HTMLButtonElement>('#export-go').disabled = true;
    $<HTMLButtonElement>('#save-map').disabled = true;
    let exportError: string | undefined;
    try {
      const name = `magna-urbis-${state.settings.options.seed.replace(/[^\w-]/g, '_').slice(0, 45)}`;
      if (format === 'binary') {
        const buffer = await projectJob<ArrayBuffer>({ action: 'serialize-binary', settings: state.settings, world: state.previewBase?.pristine ?? state.previewBase?.world ?? state.pristine ?? state.world, mods: state.mods });
        actions.download(new Blob([buffer], { type: 'application/octet-stream' }), `${name}.project.muproj`);
      } else if (format === 'project' || format === 'recipe') {
        actions.download(
          await projectJob<Blob>({
            action: 'serialize',
            settings: format === 'recipe' && state.world ? { ...state.settings, extent: state.world.mapSize, options: { ...state.settings.options, mapSize: state.world.mapSize } } : state.settings,
            world: format === 'project' ? (state.previewBase?.pristine ?? state.previewBase?.world ?? state.pristine ?? state.world) : undefined,
            mods: state.mods,
          }),
          `${name}.${format}.json`,
        );
      } else if (format === 'names') {
        const naming = state.settings.naming ?? {};
        actions.download(new Blob([JSON.stringify({ format: 'magna-urbis-v2-names', version: 1, places: naming.places ?? {}, labels: naming.labels ?? {} }, null, 2)], { type: 'application/json' }), `${name}.names.json`);
      } else if (format === 'seed') {
        actions.download(new Blob([JSON.stringify({ format: 'magna-urbis-v2-seed', version: 1, seed: state.settings.options.seed })], { type: 'application/json' }), `${name}.seed.json`);
      } else if (format === 'heightmap') {
        const result = await exporter.heightmapBlob();
        actions.download(result.blob, `${name}.heightmap.png`);
        actions.download(result.metadata, `${name}.heightmap.metadata.json`);
      } else {
        actions.toast('Preparing map layers…');
        setText($('#export-note'), 'Preparing map layers…');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        const width = Number($<HTMLSelectElement>('#export-resolution').value),
          crop = $<HTMLInputElement>('#export-crop').checked;
        let blob: Blob | null;
        if (format === 'png') blob = await exporter.pngMapExport(width, crop);
        else {
          const svg = await exporter.svgExport();
          blob = crop ? ((await chooseExportCrop(svg, width, bindTree))?.blob ?? null) : svg;
        }
        if (!blob) return;
        actions.download(blob, `${name}.${format}`);
      }
      actions.log(`Export : ${format}`);
      actions.toast('Export downloaded.');
      $<HTMLDialogElement>('#export-dialog').close();
    } catch (e) {
      exportError = e instanceof Error ? e.message : String(e);
      actions.toast(exportError, true);
    } finally {
      $<HTMLButtonElement>('#export-go').disabled = false;
      $<HTMLButtonElement>('#save-map').disabled = state.busy;
      actions.syncExportOptions();
      if (exportError) setText($('#export-note'), exportError);
    }
  };

  $('#save-map').onclick = () => {
    $<HTMLSelectElement>('#export-format').value = 'binary';
    $('#export-go').click();
  };
}
