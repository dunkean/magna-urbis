/**
 * The export dialog: PNG, SVG and Universal VTT maps (whole or cropped), projects, recipes, seeds and heightmaps, and the
 * Save map shortcut. Also opens the page's dialogs, refreshing the export options first for the export dialog.
 */
import type { PageActions, PageState } from './contract';
import { setText, bindTree, translate, registerMessages, numberLocale } from '../i18n';
import { mapPresentation } from '../mapPresentation';
import { ruralSemanticLegend } from '../../render/semanticLayer';
import { resolveSettingsAppearance, resolvedDisplayOptions } from '../appearance';
import { lookOfVariant, presetComposition } from '../../render/composition';
import { isTerrainStyle } from '../../render/terrainStyle';
import { mapMetadata } from '../exportMetadata';
import { orthographicExportFrame, uvttDocument, uvttFrame } from '../uvtt';
import { encodeVttMap, isVttExport, type VttExport } from '../vttFormats';
import { encodeMapMesh, isMeshExport, type MeshExport } from '../meshFormats';
import { viewRect } from '../../render/view';
import type { ExportRect } from '../../ui/exportCropGeometry';
import type { World } from '../../gen/types';
import type { ExportLayers } from '../../render/exportLayers';
import { chooseExportArea, chooseExportCrop } from '../../ui/exportCrop';
import { canvasPng, cropCanvasPng } from '../../ui/canvasExport';
import { supportsSvgExport } from '../exportOptions';
import { exportPng } from '../../ui/pngExport';
import { heightmapPng } from '../../ui/terrainHeightmap';
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
    const { settings, resolved } = exportAppearance(state.world);
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
            world: state.world ? exportWorld(mapPresentation(state.world, settings)) : state.world,
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
    const world = state.world;
    const { settings, resolved } = exportAppearance(world);
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
    const image = await state.client.exportBench(settings, resolved, width, exportLayers(), undefined, world);
    try {
      setText($('#export-note'), 'Encoding PNG…');
      const png = await canvasPng(image);
      if (!crop) return png;
      const bounds = { x: 0, y: 0, width: world!.mapSize, height: world!.mapSize };
      const area = await chooseExportArea(png, bounds, width, bindTree);
      return area ? await cropCanvasPng(image, bounds, area.rect, area) : null;
    } finally {
      image.width = image.height = 0;
    }
  }

  function exportAppearance(world: World | undefined, detailed = false) {
    const base = state.settings;
    const initial = resolveSettingsAppearance(base, world, 'export');
    const requested = $<HTMLSelectElement>('#export-style').value;
    const explicit = isTerrainStyle(requested);
    if (!explicit && !detailed) return { settings: base, resolved: initial };
    const current = initial.composition.recipe;
    const selected = explicit ? presetComposition(lookOfVariant(requested)) : current;
    const composition = explicit ? { ...selected, ground: { ...selected.ground, variant: requested }, effects: { ...current.effects, relief: selected.effects.relief } } : selected;
    const settings = {
      ...base,
      appearance: {
        ...base.appearance,
        style: base.options.style,
        diagnostic: 'none' as const,
        city: detailed ? { ...base.appearance?.city, view: 'buildings' as const, diagnostic: 'none' as const, layers: { ...base.appearance?.city?.layers, enclosures: true } } : base.appearance?.city,
        composition: detailed ? { ...composition, buildings: { ...composition.buildings, visible: true, look: 'detailed-volumes' as const, roof: 'crafted' as const }, annotations: { legend: false, cartouche: false } } : composition,
      },
    };
    return { settings, resolved: resolveSettingsAppearance(settings, world, 'export') };
  }

  async function mapExportRect(world: World, width: number, crop: boolean, appearance: ReturnType<typeof exportAppearance>, layers: Partial<ExportLayers>): Promise<ExportRect | null> {
    const bounds = { x: 0, y: 0, width: world.mapSize, height: world.mapSize };
    if (!crop) return bounds;
    const preview = await state.client.exportBench(appearance.settings, appearance.resolved, 1200, layers, undefined, world);
    try {
      return (await chooseExportArea(await canvasPng(preview), bounds, width, bindTree))?.rect ?? null;
    } finally {
      preview.width = preview.height = 0;
    }
  }

  function areaName(name: string, area: ExportRect, crop: boolean): string {
    const style = $<HTMLSelectElement>('#export-style').value;
    const base = isTerrainStyle(style) ? `${name}-${style}` : name;
    if (!crop) return base;
    const [x, y, w, h] = [area.x, area.y, area.width, area.height].map(Math.round);
    return `${base}-${x}-${y}-${w}x${h}`;
  }

  async function uvttMapExport(format: VttExport, name: string, width: number, crop: boolean): Promise<{ blob: Blob; extension: string; metres: number } | null> {
    const world = state.world!;
    const appearance = exportAppearance(world, true);
    const layers = exportLayers();
    const rect = await mapExportRect(world, width, crop, appearance, layers);
    if (!rect) return null;
    const grid = $<HTMLInputElement>('#export-vtt-grid');
    if (!grid.checkValidity()) throw new Error(translate('Enter a positive distance per VTT grid cell.'));
    const frame = uvttFrame(rect, width, grid.value === '' ? undefined : grid.valueAsNumber);
    if (frame.pixelsPerGrid < 50) throw new Error(translate('Use a larger distance per cell, a higher resolution, or a smaller export area. The VTT grid needs at least 50 pixels per cell.'));
    if (!Number.isFinite(frame.pixelsPerGrid) || frame.pixelsPerGrid > Math.max(frame.width, frame.height)) throw new Error(translate('The VTT grid cell is larger than the export area.'));
    setText($('#export-note'), 'Rendering the VTT map…');
    const canvas = await state.client.exportBench(appearance.settings, appearance.resolved, width, layers, frame, world);
    try {
      const png = await canvasPng(canvas);
      const obstacles = $<HTMLInputElement>('#export-vtt-building-walls').checked;
      const output = uvttDocument(world, frame, '', obstacles, layers.city !== false);
      const metadata = $<HTMLInputElement>('#export-metadata').checked ? mapMetadata(mapPresentation(world, appearance.settings), rect, layers) : undefined;
      const archive = await encodeVttMap(format, output, frame, png, areaName(name, rect, crop), metadata);
      return { ...archive, metres: frame.metresPerGrid };
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  async function meshMapExport(format: MeshExport, name: string, width: number, crop: boolean): Promise<{ blob: Blob; extension: string } | null> {
    const world = state.world!;
    const appearance = exportAppearance(world, true);
    const layers = exportLayers();
    const rect = await mapExportRect(world, width, crop, appearance, layers);
    if (!rect) return null;
    setText($('#export-note'), 'Building the 3D export…');
    const frame = orthographicExportFrame(rect, width);
    const bounds = viewRect(frame.view, frame.width, frame.height);
    const area = { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
    let texture: Uint8Array | undefined;
    if (layers.terrain !== false) {
      const canvas = await state.client.exportBench(appearance.settings, appearance.resolved, width, { ...layers, city: false, labels: false }, frame, world);
      try {
        texture = new Uint8Array(await (await canvasPng(canvas)).arrayBuffer());
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    const { mapMesh } = await import('../mapMesh');
    const resolution = Number($<HTMLSelectElement>('#export-mesh-grid').value);
    const trees = $<HTMLInputElement>('#export-mesh-trees').checked ? await (await import('../exportTrees')).exportTreeInputs(world, appearance.settings) : undefined;
    const metadata = $<HTMLInputElement>('#export-metadata').checked ? mapMetadata(mapPresentation(world, appearance.settings), area, layers) : undefined;
    const scene = await mapMesh(world, area, resolution, layers, !appearance.resolved.underdark && appearance.resolved.city.groundShaping, appearance.resolved.city.terraces, trees, metadata);
    if (!scene.parts.length) throw new Error(translate('The selected area and layers contain no 3D meshes.'));
    const { bytes, extension, type } = await encodeMapMesh(scene, format, areaName(name, rect, crop), texture);
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), extension };
  }

  /** The SVG export never reads the native town snapshots: they are not cloned into its worker. */
  function exportWorld(world: World): World {
    if (!world.debug?.v2RustCities) return world;
    const { v2RustCities: _cities, ...debug } = world.debug;
    return { ...world, debug };
  }

  async function heightmapBlob(): Promise<{ blob: Blob; metadata: Blob }> {
    if (!state.world) throw new Error('Create a map first.');
    const grid = state.world.terrain.height;
    if (grid.w !== grid.h) throw new Error('The heightmap export needs a square map.');
    let lo = Infinity,
      hi = -Infinity;
    for (const value of grid.data) {
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
    // The same 16-bit file as the relief editor's: its metre range is embedded, an import gives the same altitudes back.
    const png = heightmapPng({ version: 1, resolution: grid.w, heights: grid.data as unknown as number[] }, state.world.mapSize);
    actions.log(`16-bit heightmap: black ${lo.toFixed(3)} m, white ${hi.toFixed(3)} m. Use a JSON project to retain FP32.`);
    const metadata = new Blob([JSON.stringify({ format: 'magna-urbis-heightmap', version: 1, width: grid.w, height: grid.h, mapSize: state.world.mapSize, minHeight: lo, maxHeight: hi, seed: state.world.seed }, null, 2)], { type: 'application/json' });
    return { blob: new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), metadata };
  }

  function syncExportOptions(): void {
    const svg = $<HTMLOptionElement>('#export-format option[value="svg"]'),
      available = supportsSvgExport(exportAppearance(state.world).resolved);
    svg.disabled = !available;
    setText(svg, available ? 'SVG vector map' : 'SVG vector map · unavailable for this style');
    const select = $<HTMLSelectElement>('#export-format');
    if (!available && select.value === 'svg') select.value = 'png';
    const format = select.value;
    $('#export-map-options').hidden = !['png', 'svg'].includes(format) && !isVttExport(format) && !isMeshExport(format);
    $('#export-vtt-options').hidden = !isVttExport(format);
    $('#export-mesh-options').hidden = !isMeshExport(format);
    $('#export-metadata-options').hidden = !isMeshExport(format) && !isVttExport(format);
    const explicit: Record<string, string> = {
      binary: 'The binary project retains the exact map, settings and edits in a compressed file.',
      project: 'The JSON project is a readable interchange format. Use Save map for a smaller file.',
      heightmap: '65,536-level PNG with its elevation range, ready to import again. Save map retains the exact FP32 grids.',
      recipe: 'The recipe retains settings and edits. Faithful reproduction requires the same engine version.',
      seed: 'The seed alone contains neither your settings nor your edits.',
      names: 'Renamed places and edited labels, which the short code does not carry.',
      foundry: 'Includes a Foundry 14 scene JSON and its background image.',
      owlbear: 'Includes a PNG for the scene importer and UVTT for Smoke & Spectre!.',
      roll20: 'Import this UVTT from the Roll20 page menu using Upload Background.',
      dd2vtt: 'Exports a detailed overhead map, walls and gates. Set the cell distance in your VTT after importing.',
    };
    const visual = available ? 'Visual exports use the current map without rerunning generation.' : 'SVG is unavailable for the current style. Use PNG.';
    setText($('#export-note'), explicit[format] ?? (isMeshExport(format) ? 'Exports metric meshes and a terrain texture. Resolution controls the texture size.' : visual));
  }
  return { download, svgExport, pngMapExport, uvttMapExport, meshMapExport, heightmapBlob, syncExportOptions };
}

export function mountExports(state: PageState, actions: PageActions): void {
  // The export operations that are not page actions (pngMapExport, svgExport, heightmapBlob).
  const exporter = createExportsActions(state, actions);

  registerMessages({
    'SVG is unavailable for the current style. Use PNG.': { en: 'SVG is unavailable for the current style. Use PNG.', fr: 'Le SVG n’est pas disponible pour le style actuel. Utilisez le PNG.' },
    'SVG vector map · unavailable for this style': { en: 'SVG vector map · unavailable for this style', fr: 'Carte vectorielle SVG · indisponible pour ce style' },
    'Export style': { en: 'Export style', fr: 'Style d’export' },
    'Current map style': { en: 'Current map style', fr: 'Style courant de la carte' },
    '3D trees': { en: '3D trees', fr: 'Arbres 3D' },
    'Feature names and metadata': { en: 'Feature names and metadata', fr: 'Noms et métadonnées de la carte' },
    'Universal VTT · .dd2vtt': { en: 'Universal VTT · .dd2vtt', fr: 'Universal VTT · .dd2vtt' },
    'Foundry VTT 14 · Scene ZIP': { en: 'Foundry VTT 14 · Scene ZIP', fr: 'Foundry VTT 14 · Scène ZIP' },
    'Owlbear Rodeo · Map and UVTT ZIP': { en: 'Owlbear Rodeo · Map and UVTT ZIP', fr: 'Owlbear Rodeo · Carte et UVTT ZIP' },
    'Godot 4 · Project ZIP': { en: 'Godot 4 · Project ZIP', fr: 'Godot 4 · Projet ZIP' },
    'Terrain mesh subdivisions': { en: 'Terrain mesh subdivisions', fr: 'Subdivisions du maillage de terrain' },
    'Includes a Foundry 14 scene JSON and its background image.': { en: 'Includes a Foundry 14 scene JSON and its background image.', fr: 'Contient la scène JSON Foundry 14 et son image de fond.' },
    'Includes a PNG for the scene importer and UVTT for Smoke & Spectre!.': { en: 'Includes a PNG for the scene importer and UVTT for Smoke & Spectre!.', fr: 'Contient un PNG pour l’import de scène et un UVTT pour Smoke & Spectre!.' },
    'Import this UVTT from the Roll20 page menu using Upload Background.': { en: 'Import this UVTT from the Roll20 page menu using Upload Background.', fr: 'Dans le menu des pages de Roll20, choisissez Upload Background pour importer cet UVTT.' },
    'Exports metric meshes and a terrain texture. Resolution controls the texture size.': {
      en: 'Exports metric meshes and a terrain texture. Resolution controls the texture size.',
      fr: 'Exporte des maillages métriques et une texture de terrain. La résolution règle la taille de la texture.',
    },
    'Building the 3D export…': { en: 'Building the 3D export…', fr: 'Préparation de l’export 3D…' },
    'The selected area and layers contain no 3D meshes.': { en: 'The selected area and layers contain no 3D meshes.', fr: 'La zone et les calques sélectionnés ne contiennent aucun maillage 3D.' },
    'Metres per VTT grid cell': { en: 'Metres per VTT grid cell', fr: 'Mètres par case VTT' },
    'Buildings block vision': { en: 'Buildings block vision', fr: 'Les bâtiments bloquent la vision' },
    'Exports a detailed overhead map, walls and gates. Set the cell distance in your VTT after importing.': {
      en: 'Exports a detailed overhead map, walls and gates. Set the cell distance in your VTT after importing.',
      fr: 'Exporte une carte détaillée vue du dessus, les murs et les portes. Réglez la distance par case dans le VTT après l’import.',
    },
    'Enter a positive distance per VTT grid cell.': { en: 'Enter a positive distance per VTT grid cell.', fr: 'Saisissez une distance positive par case VTT.' },
    'Use a larger distance per cell, a higher resolution, or a smaller export area. The VTT grid needs at least 50 pixels per cell.': {
      en: 'Use a larger distance per cell, a higher resolution, or a smaller export area. The VTT grid needs at least 50 pixels per cell.',
      fr: 'Augmentez la distance par case ou la résolution, ou réduisez la zone. La grille VTT nécessite au moins 50 pixels par case.',
    },
    'The VTT grid cell is larger than the export area.': { en: 'The VTT grid cell is larger than the export area.', fr: 'La case VTT est plus grande que la zone à exporter.' },
    'Rendering the VTT map…': { en: 'Rendering the VTT map…', fr: 'Rendu de la carte VTT…' },
    'VTT export downloaded. Set the grid to {distance} m per cell.': { en: 'VTT export downloaded. Set the grid to {distance} m per cell.', fr: 'Export VTT téléchargé. Réglez la grille sur {distance} m par case.' },
    'Encoding PNG…': { en: 'Encoding PNG…', fr: 'Encodage du PNG…' },
    'Names · JSON': { en: 'Names · JSON', fr: 'Noms · JSON' },
    'Renamed places and edited labels, which the short code does not carry.': { en: 'Renamed places and edited labels, which the short code does not carry.', fr: 'Les lieux renommés et les étiquettes modifiées, que le code court ne contient pas.' },
  });

  $<HTMLSelectElement>('#export-format').onchange = actions.syncExportOptions;
  $<HTMLSelectElement>('#export-style').onchange = actions.syncExportOptions;

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
    let success = 'Export downloaded.';
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
        let blob: Blob | null,
          extension = format;
        if (format === 'png') blob = await exporter.pngMapExport(width, crop);
        else if (isVttExport(format)) {
          const result = await exporter.uvttMapExport(format, name, width, crop);
          blob = result?.blob ?? null;
          extension = result?.extension ?? format;
          if (result && format !== 'foundry') success = translate('VTT export downloaded. Set the grid to {distance} m per cell.').replace('{distance}', result.metres.toLocaleString(numberLocale(), { maximumSignificantDigits: 4 }));
        } else if (isMeshExport(format)) {
          const result = await exporter.meshMapExport(format, name, width, crop);
          blob = result?.blob ?? null;
          extension = result?.extension ?? format;
        } else {
          const svg = await exporter.svgExport();
          blob = crop ? ((await chooseExportCrop(svg, width, bindTree))?.blob ?? null) : svg;
        }
        if (!blob) return;
        actions.download(blob, `${name}.${extension}`);
      }
      actions.log(`Export : ${format}`);
      actions.toast(success);
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
