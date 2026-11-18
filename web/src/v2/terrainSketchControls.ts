import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import { parseTerrainZones } from '../../../rust/bridge/terrainZones';
import { paintZones, resampleZones, ZONE_COLORS } from './symbolicMap';
import type { TerrainSketch } from '../../../rust/bridge/terrainSketch';
import { applyTerrainModification } from '../../../rust/bridge/terrainModification';
import { acceptHeightmap } from './heightmapModel';
import { readHeightmap, heightmapPng } from '../ui/terrainHeightmap';
import { nativeTerrainOf, nativeTerrainLayer } from './nativeProducts';
import { adaptedExtent } from './settings';
import { onLanguageChange, registerMessages, setHTML, setText } from './i18n';
import { paintHeight, transformHeight, grayscaleHeight, terrainPaintDetail, type HeightBrush, type PaintBrush } from './reliefPaint';
import { coastTraceExtensions, coastTraceLineDistance, lineFromStroke, rasterizeCoastTrace, type CoastTrace } from './coastTrace';
import './terrainSketchControls.css';

export interface TerrainSketchContext {
  getWorld(): World | undefined;
  onApply(): void;
}
export type ReliefEditorKind = 'symbolic' | 'modify' | 'coast';
interface Bindings {
  getSettings(): V2Settings;
  onChange(): void;
  disabled?: () => boolean;
  context?: TerrainSketchContext;
}
type State = { weights: Uint8Array; heights: Float32Array; dirty: boolean; n: number; original: Float32Array; range: { min: number; max: number }; hasTerrain: boolean; sourceWidth: number; resetLayer: boolean; trace: CoastTrace; activeLine: number };
const coastDescription = 'Draw the shoreline roughly. Generation turns it into a natural coast with bays, headlands and islets. The sea side is tinted blue.';
const coastHelp = 'Draw an open shoreline or close a loop to make an island. Click a line to select it, swap its land and sea sides, or delete it. Open ends extend to the nearest map border. Keep coastline saves this draft; Generate relief applies it. Cancel discards changes.';
const cloneTrace = (trace: CoastTrace): CoastTrace => ({ version: 1, lines: trace.lines.map(line => ({ ...line, points: line.points.slice() })) });
const words: Record<string, string> = {
  'Trace coastline': 'Tracer le littoral',
  'Swap land and sea': 'Inverser terre et mer',
  'Delete line': 'Supprimer le tracé',
  'Clear coastline': 'Effacer le littoral',
  'Keep coastline': 'Conserver le littoral',
  'Coastline to save': 'Littoral à conserver',
  'Coastline saved': 'Littoral enregistré',
  [coastDescription]: 'Dessinez grossièrement le rivage. La génération en fait un littoral naturel avec des baies, des caps et des îlots. Le côté mer est teinté de bleu.',
  [coastHelp]:
    'Dessinez un rivage ouvert ou fermez une boucle pour créer une île. Cliquez sur un tracé pour le sélectionner, inverser ses côtés terre et mer ou le supprimer. Les extrémités ouvertes rejoignent le bord de carte le plus proche. Conserver le littoral enregistre ce brouillon ; Générer le relief l’applique. Annuler abandonne les changements.',
  'Edit relief': 'Éditer le relief',
  Close: 'Fermer',
  'How editing works': 'Comment fonctionne l’édition',
  Brush: 'Pinceau',
  Pan: 'Déplacer la vue',
  Undo: 'Annuler',
  Redo: 'Rétablir',
  Fit: 'Cadrer',
  'Zoom in': 'Zoom avant',
  'Zoom out': 'Zoom arrière',
  Tools: 'Outils',
  Sea: 'Mer',
  Plain: 'Plaine',
  Hills: 'Collines',
  Mountains: 'Montagnes',
  'High mountains': 'Hautes montagnes',
  Eraser: 'Gomme',
  Raise: 'Monter',
  Lower: 'Creuser',
  Level: 'Altitude fixe',
  Smooth: 'Adoucir',
  Restore: 'Restaurer',
  'Radius (% of map)': 'Rayon (% de la carte)',
  'Soft edge (%)': 'Bord doux (%)',
  'Height per dab (m)': 'Hauteur par touche (m)',
  'Target elevation (m)': 'Altitude visée (m)',
  'Adjust the whole heightmap': 'Ajuster toute la heightmap',
  'Vertical scale ×': 'Échelle verticale ×',
  'Datum shift (m)': 'Décalage du datum (m)',
  'Central crop (%)': 'Recadrage central (%)',
  'Apply adjustment': 'Appliquer l’ajustement',
  Files: 'Fichiers',
  'Import zones': 'Importer des zones',
  'Export zones': 'Exporter les zones',
  'Export PNG · 16 bits': 'Exporter PNG · 16 bits',
  Cancel: 'Annuler',
  'Keep the map': 'Conserver la carte',
  'Generate relief': 'Générer le relief',
  'Terrain paint canvas': 'Plan de travail du relief',
  'Map to save': 'Carte à conserver',
  'Map saved': 'Carte enregistrée',
  'No terrain yet · paint on an empty canvas.': 'Aucun relief pour le moment · peignez sur une feuille vide.',
  '8-bit view · elevations are kept in metres.': 'Vue 8 bits · les altitudes sont conservées en mètres.',
  'Zones guide the next generation; colours are terrain types, not elevations. Unpainted areas are plains.': 'Les zones guident la prochaine génération : les couleurs sont des types de terrain, pas des altitudes. Les zones non peintes sont des plaines.',
  'The eraser returns painted areas to plain.': 'La gomme remet les zones peintes en plaine.',
  'Strength (%)': 'Intensité (%)',
  'Invalid zone file': 'Fichier de zones invalide',
  'Invalid heightmap file': 'Fichier de heightmap invalide',
  'Zone file is too large': 'Fichier de zones trop volumineux',
  'Paint the map': 'Peindre la carte',
  'Modify relief': 'Modifier le relief',
  Reset: 'Réinitialiser',
  'Symbolic map': 'Carte symbolique',
  'Relief modifications': 'Retouches du relief',
  'Paint where the sea, plains, hills and mountains are. Unpainted areas are plains.': 'Peignez la mer, les plaines, les collines et les montagnes. Les zones non peintes sont des plaines.',
  'Modify the generated terrain. Fine noise is preserved; changes are stored in a separate removable layer.': 'Retouchez le terrain généré. Le bruit fin est conservé ; les changements sont enregistrés dans un calque séparé que vous pouvez supprimer.',
  'Clear the map returns all cells to plains.': 'Effacer la carte remet toutes les cellules en plaine.',
  'Reset clears the modification layer and restores the generated terrain underneath. Save or generate to remove all saved edits.':
    'Réinitialiser met le calque de retouches à zéro et retrouve le terrain généré en dessous. Conservez ou générez pour supprimer les retouches enregistrées.',
  'Keep the map saves your changes. Generate relief applies them to the map. Cancel discards this draft.': 'Conserver la carte enregistre les changements. Générer le relief les applique à la carte. Annuler abandonne ce brouillon.',
  'Clear the map': 'Effacer la carte',
  'Clear modifications': 'Effacer les retouches',
  'Keep modifications': 'Conserver les retouches',
  'Modifications to save': 'Retouches à conserver',
  'Modifications saved': 'Retouches enregistrées',
};
registerMessages(Object.fromEntries(Object.entries(words).map(([en, fr]) => [en, { en, fr }])));
const paths: Record<string, string> = {
  brush: 'm5 15 9-9 4 4-9 9H5v-4Zm8-8 4 4M4 21h16',
  pan: 'M9 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 4-3 7-7 7h-2l-7-7a2 2 0 0 1 3-3l2 2',
  raise: 'M12 20V4m-6 6 6-6 6 6M4 20h16',
  lower: 'M12 4v16m-6-6 6 6 6-6M4 4h16',
  level: 'M3 12h18M6 7h12M6 17h12',
  smooth: 'M2 16c4 0 3-10 7-10s3 10 7 10 3-5 6-5',
  restore: 'M4 10a8 8 0 1 1 1 9M4 3v7h7',
  erase: 'm4 14 9-10 8 7-9 10H8l-4-4v-3Zm5-5 8 7M12 21h9',
  undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14',
  redo: 'm16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] ?? paths.brush}"/></svg>`;

/** Dedicated V2 mini-paint. Only save/generate commits the dialog's draft to the recipe. */
export function mountTerrainSketchControls(root: HTMLElement, b: Bindings): { sync(): void; open(kind?: ReliefEditorKind): void; dispose(): void } {
  root.classList.add('relief-paint-host');
  setHTML(
    root,
    `<button type="button" data-id="edit" hidden>Edit relief</button><input data-id="file" type="file" accept=".json,application/json" hidden><input data-id="heightmap-file" type="file" accept=".json,.png,application/json,image/png" hidden><output data-id="import-error" role="alert" hidden></output>
    <dialog class="relief-paint" id="relief-paint-dialog" aria-labelledby="relief-paint-title">
      <header class="relief-paint-head"><h2 id="relief-paint-title">Edit relief</h2><button type="button" data-action="help" class="paint-help-button" aria-label="How editing works" aria-expanded="false" aria-controls="relief-paint-help">?</button><button type="button" data-action="close" aria-label="Close">×</button></header>
      <section id="relief-paint-help" class="paint-help" hidden><h3>How editing works</h3><p data-relief-help><strong>Paint the map</strong> — <span>Paint where the sea, plains, hills and mountains are. Unpainted areas are plains.</span></p><p data-relief-help><strong>Modify relief</strong> — <span>Modify the generated terrain. Fine noise is preserved; changes are stored in a separate removable layer.</span></p><p data-symbolic-help hidden>The eraser returns painted areas to plain.</p><p data-reset-help data-relief-help></p><p data-relief-help>Keep the map saves your changes. Generate relief applies them to the map. Cancel discards this draft.</p><p data-coast-help hidden>${coastHelp}</p></section>
      <p class="paint-mode-description" data-description></p>
      <div class="relief-paint-body"><section class="paint-workspace"><div class="paint-view-toolbar"><button type="button" data-action="brush" aria-pressed="true">${icon('brush')}<span>Brush</span></button><button type="button" data-action="pan" aria-pressed="false">${icon('pan')}<span>Pan</span></button><span class="paint-toolbar-gap"></span><button type="button" data-action="undo" aria-label="Undo" title="Undo">${icon('undo')}</button><button type="button" data-action="redo" aria-label="Redo" title="Redo">${icon('redo')}</button><button type="button" data-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button><output data-zoom>100%</output><button type="button" data-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button type="button" data-action="fit" title="Fit">${icon('fit')}</button></div><div class="paint-viewport"><div class="paint-surface"><canvas class="paint-base" width="512" height="512"></canvas><canvas class="paint-overlay" width="512" height="512" tabindex="0" aria-label="Terrain paint canvas"></canvas></div><div class="paint-cursor" hidden></div><p class="paint-empty" hidden>No terrain yet · paint on an empty canvas.</p></div><div class="paint-readout"><span data-height-range></span><span>8-bit view · elevations are kept in metres.</span></div></section>
      <aside class="paint-toolbox"><h3>Tools</h3><div class="paint-zone-tools" role="group" aria-label="Symbolic map"></div><div class="paint-height-tools" role="group" aria-label="Modify relief"></div>
      <div class="paint-coast-tools" hidden><button type="button" data-action="swap-coast">Swap land and sea</button><button type="button" data-action="delete-coast">Delete line</button></div>
      <label>Radius (% of map)<span class="paint-slider"><input data-control="radius" type="range" min="1" max="30" value="8"><output>8</output></span></label><label>Soft edge (%)<span class="paint-slider"><input data-control="softness" type="range" min="1" max="100" value="60"><output>60</output></span></label>
      <label data-height-control>Height per dab (m)<span class="paint-slider"><input data-control="strength" type="range" min="1" max="500" value="50"><output>50</output></span></label><label data-target-control>Target elevation (m)<input data-control="target" type="number" min="-12000" max="12000" value="300"></label>
      <label data-zone-control>Strength (%)<span class="paint-slider"><input data-control="zone-strength" type="range" min="1" max="100" value="100"><output>100</output></span></label>
      <button type="button" data-action="reset-height">${icon('restore')}<span>Reset</span></button>
      <section class="paint-transform"><h4>Adjust the whole heightmap</h4><label>Vertical scale ×<input data-control="scale" type="number" min=".05" max="10" step=".05" value="1"></label><label>Datum shift (m)<input data-control="datum" type="number" min="-5000" max="5000" value="0"></label><label>Central crop (%)<input data-control="crop" type="number" min="25" max="100" value="100"></label><button type="button" data-action="transform">Apply adjustment</button></section>
      <section class="paint-files"><h4>Files</h4><button type="button" data-action="import-zones">Import zones</button><button type="button" data-action="export-zones">Export zones</button><button type="button" data-action="export-png">Export PNG · 16 bits</button></section></aside></div>
      <footer class="relief-paint-footer"><output data-id="state" role="status"></output><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save">Keep the map</button><button type="button" class="primary" data-id="apply">Generate relief</button></footer>
    </dialog>`,
  );
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const dialog = $<HTMLDialogElement>('dialog'),
    viewport = $('.paint-viewport'),
    surface = $('.paint-surface');
  const base = $<HTMLCanvasElement>('.paint-base'),
    overlay = $<HTMLCanvasElement>('.paint-overlay'),
    cursor = $('.paint-cursor');
  const baseCtx = base.getContext('2d')!,
    overlayCtx = overlay.getContext('2d')!,
    state = $('[data-id="state"]');
  let weights: Uint8Array = new Uint8Array(128 * 128 * 5);
  let tool: HeightBrush = 'raise',
    zone = 3,
    pan = false,
    n = 128,
    original: Float32Array = new Float32Array(n * n),
    heights: Float32Array = original.slice();
  let range = { min: -100, max: 1000 },
    hasTerrain = false,
    dirty = false,
    available = true,
    zoom = 1,
    ox = 0,
    oy = 0,
    size = 512;
  let sourceWidth = adaptedExtent(b.getSettings());
  let kind: ReliefEditorKind = 'modify',
    resetLayer = false,
    detail: Float32Array | undefined;
  let trace: CoastTrace = { version: 1, lines: [] },
    activeLine = -1,
    coastStroke: number[] = [];
  let lastFocus: HTMLElement | null = null,
    pointer: number | undefined,
    previous: [number, number] | undefined,
    dragging = false,
    strokeChanged = false;
  const past: State[] = [],
    future: State[] = [];
  const input = (key: string) => $<HTMLInputElement>(`[data-control="${key}"]`),
    numeric = (key: string) => Number(input(key).value);
  const brush = (): PaintBrush => ({ radius: numeric('radius') / 100, softness: numeric('softness') / 100, strength: numeric('strength'), target: numeric('target') });
  const capture = (): State => ({ weights: kind === 'symbolic' ? weights.slice() : weights, heights: kind === 'modify' ? heights.slice() : heights, dirty, n, original, range, hasTerrain, sourceWidth, resetLayer, trace: cloneTrace(trace), activeLine });
  const remember = () => {
    past.push(capture());
    future.length = 0;
    while (past.length > 1 && (past.length > 20 || (kind !== 'coast' && past.reduce((sum, s) => sum + s.weights.byteLength + (kind === 'modify' ? s.heights.byteLength : 0), 0) > 64 * 1048576))) past.shift();
  };
  const statusLabel = () => (kind === 'coast' ? (dirty ? 'Coastline to save' : 'Coastline saved') : kind === 'symbolic' ? (dirty ? 'Map to save' : 'Map saved') : dirty ? 'Modifications to save' : 'Modifications saved');
  const restore = (s: State) => {
    weights = s.weights;
    heights = s.heights;
    dirty = s.dirty;
    n = s.n;
    original = s.original;
    range = s.range;
    hasTerrain = s.hasTerrain;
    sourceWidth = s.sourceWidth;
    resetLayer = s.resetLayer;
    trace = cloneTrace(s.trace);
    activeLine = s.activeLine;
    setText(state, statusLabel());
    draw();
  };
  const mark = () => {
    dirty = true;
    setText(state, statusLabel());
  };
  ['Sea', 'Plain', 'Hills', 'Mountains', 'High mountains', 'Eraser'].forEach((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.zone = String(index === 5 ? -1 : index);
    setHTML(button, `${index === 5 ? icon('erase') : `<span class="paint-zone-art paint-zone-art-${index}" aria-hidden="true"></span>`}<span>${name}</span>`);
    if (index < 5) {
      const swatch = button.querySelector<HTMLElement>('.paint-zone-art')!;
      swatch.style.background = `rgb(${ZONE_COLORS[index].join(',')})`;
      swatch.style.backgroundImage = 'none';
    }
    button.onclick = () => {
      zone = index === 5 ? -1 : index;
      pan = false;
      draw();
    };
    $('.paint-zone-tools').append(button);
  });
  (['raise', 'lower', 'level', 'smooth', 'restore'] as const).forEach(name => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.heightTool = name;
    setHTML(button, `${icon(name)}<span>${name[0].toUpperCase() + name.slice(1)}</span>`);
    button.onclick = () => {
      tool = name;
      pan = false;
      draw();
    };
    $('.paint-height-tools').append(button);
  });
  function load(): void {
    const settings = b.getSettings(),
      world = b.context?.getWorld(),
      native = nativeTerrainOf(world),
      physical = kind === 'modify' ? (native?.modificationBase ?? nativeTerrainLayer(world)?.v2ModificationBase ?? native?.physical) : native?.physical;
    let values: ArrayLike<number> | undefined;
    sourceWidth = adaptedExtent(settings);
    weights = resampleZones(settings.terrain?.zones);
    if (kind !== 'symbolic' && physical) {
      n = physical.n;
      values = physical.height;
      sourceWidth = world!.mapSize;
    } else if (kind !== 'symbolic' && world) {
      n = world.terrain.height.w;
      values = world.terrain.height.data;
      sourceWidth = world.mapSize;
    } else n = 128;
    hasTerrain = !!values;
    original = values ? Float32Array.from(values) : new Float32Array(n * n);
    heights = original.slice();
    if (kind === 'modify' && settings.terrain?.modification) heights = applyTerrainModification(original, n, settings.terrain.modification);
    detail = kind === 'modify' ? terrainPaintDetail(original, n) : undefined;
    resetLayer = false;
    tool = 'raise';
    if (kind === 'symbolic') zone = 3;
    trace = cloneTrace(settings.terrain?.coastTrace ?? { version: 1, lines: [] });
    activeLine = trace.lines.length - 1;
    coastStroke = [];
    let min = Infinity,
      max = -Infinity;
    for (const h of original) {
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    range = hasTerrain && max > min ? { min, max } : { min: Math.min(-100, min - 100), max: Math.max(1000, max + 100) };
    dirty = false;
    past.length = future.length = 0;
    zoom = 1;
    ox = oy = 0;
    pan = false;
    pointer = undefined;
    setText(state, statusLabel());
    setText($('#relief-paint-title'), kind === 'coast' ? 'Trace coastline' : kind === 'symbolic' ? 'Paint the map' : 'Modify relief');
    setText($('[data-action="reset-height"] span'), kind === 'coast' ? 'Clear coastline' : kind === 'symbolic' ? 'Clear the map' : 'Clear modifications');
    setText($('[data-action="save"]'), kind === 'coast' ? 'Keep coastline' : kind === 'symbolic' ? 'Keep the map' : 'Keep modifications');
    setText($('[data-reset-help]'), kind === 'symbolic' ? 'Clear the map returns all cells to plains.' : 'Reset clears the modification layer and restores the generated terrain underneath. Save or generate to remove all saved edits.');
  }
  function view(): void {
    size = Math.max(1, Math.min(viewport.clientWidth, viewport.clientHeight) - 24);
    Object.assign(surface.style, { width: `${size}px`, height: `${size}px`, left: `${(viewport.clientWidth - size) / 2 + ox}px`, top: `${(viewport.clientHeight - size) / 2 + oy}px`, transform: `scale(${zoom})` });
    $('[data-zoom]').textContent = `${Math.round(zoom * 100)}%`;
  }
  function draw(): void {
    if (!dialog.open) return;
    view();
    if (kind === 'symbolic') {
      baseCtx.fillStyle = '#deddd4';
      baseCtx.fillRect(0, 0, 512, 512);
      baseCtx.fillStyle = `rgba(${ZONE_COLORS[1].join(',')},0.2)`;
      baseCtx.fillRect(0, 0, 512, 512);
    } else {
      const gray = baseCtx.createImageData(512, 512);
      gray.data.set(grayscaleHeight(heights, n, range.min, range.max, 512));
      baseCtx.putImageData(gray, 0, 0);
      if (kind === 'coast' && !hasTerrain) {
        baseCtx.fillStyle = '#deddd4';
        baseCtx.fillRect(0, 0, 512, 512);
      }
    }
    overlayCtx.clearRect(0, 0, 512, 512);
    if (kind === 'coast') drawCoast();
    if (kind === 'symbolic') drawZones();
    base.style.visibility = 'visible';
    overlay.style.opacity = '1';
    $('.paint-empty').hidden = kind === 'symbolic' || hasTerrain || dirty || (kind === 'coast' && !!trace.lines.length);
    $('[data-height-range]').textContent = kind === 'symbolic' ? '' : `${Math.round(range.min)} → ${Math.round(range.max)} m · ${n} × ${n}`;
    root.querySelectorAll<HTMLButtonElement>('[data-zone]').forEach(el => el.setAttribute('aria-pressed', String(Number(el.dataset.zone) === zone)));
    root.querySelectorAll<HTMLButtonElement>('[data-height-tool]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.heightTool === tool)));
    $('.paint-zone-tools').hidden = kind !== 'symbolic';
    $('.paint-height-tools').hidden = kind !== 'modify';
    $('[data-zone-control]').hidden = kind !== 'symbolic';
    for (const action of ['import-zones', 'export-zones']) $(`[data-action="${action}"]`).hidden = kind !== 'symbolic';
    $('[data-action="export-png"]').hidden = kind !== 'modify';
    $('.paint-coast-tools').hidden = kind !== 'coast';
    for (const selector of ['.paint-transform', '.paint-files', '.paint-readout', '[data-control="radius"]', '[data-control="softness"]']) {
      const el = $(selector);
      (el instanceof HTMLInputElement ? el.closest('label')! : el).hidden = kind === 'coast';
    }
    root.querySelectorAll<HTMLElement>('[data-relief-help]').forEach(el => (el.hidden = kind === 'coast'));
    $('[data-coast-help]').hidden = kind !== 'coast';
    $('[data-symbolic-help]').hidden = kind !== 'symbolic';
    for (const action of ['swap-coast', 'delete-coast']) $<HTMLButtonElement>(`[data-action="${action}"]`).disabled = activeLine < 0 || pointer !== undefined;
    $('.paint-transform').hidden = kind !== 'modify';
    $('.paint-readout').hidden = kind !== 'modify';
    $('[data-height-control]').hidden = kind !== 'modify' || !['raise', 'lower'].includes(tool);
    $('[data-target-control]').hidden = kind !== 'modify' || tool !== 'level';
    $<HTMLButtonElement>('[data-action="undo"]').disabled = !past.length;
    $<HTMLButtonElement>('[data-action="redo"]').disabled = !future.length;
    $('[data-action="brush"]').setAttribute('aria-pressed', String(!pan));
    $('[data-action="pan"]').setAttribute('aria-pressed', String(pan));
    overlay.style.cursor = pan ? 'grab' : 'crosshair';
    setText(
      $('[data-description]'),
      kind === 'coast' ? coastDescription : kind === 'symbolic' ? 'Paint where the sea, plains, hills and mountains are. Unpainted areas are plains.' : 'Modify the generated terrain. Fine noise is preserved; changes are stored in a separate removable layer.',
    );
  }
  function drawZones(): void {
    const tint = overlayCtx.createImageData(512, 512);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const offset = (Math.floor(y / 4) * 128 + Math.floor(x / 4)) * 5,
          i = (y * 512 + x) * 4;
        let total = 0;
        for (let k = 0; k < 5; k++) total += weights[offset + k];
        if (!total) continue;
        for (let c = 0; c < 3; c++) {
          let color = 0;
          for (let k = 0; k < 5; k++) color += weights[offset + k] * ZONE_COLORS[k][c];
          tint.data[i + c] = Math.round(color / total);
        }
        tint.data[i + 3] = 255;
      }
    overlayCtx.putImageData(tint, 0, 0);
  }
  function drawCoast(): void {
    const mask = rasterizeCoastTrace(trace, 96),
      tint = overlayCtx.createImageData(512, 512);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++)
        if (mask[Math.floor((y * 96) / 512) * 96 + Math.floor((x * 96) / 512)]) {
          const i = (y * 512 + x) * 4;
          tint.data[i] = 38;
          tint.data[i + 1] = 137;
          tint.data[i + 2] = 222;
          tint.data[i + 3] = 88;
        }
    overlayCtx.putImageData(tint, 0, 0);
    const stroke = (points: number[], closed = false) => {
      overlayCtx.beginPath();
      for (let i = 0; i < points.length; i += 2) {
        if (i === 0) overlayCtx.moveTo(points[i] * 512, points[i + 1] * 512);
        else overlayCtx.lineTo(points[i] * 512, points[i + 1] * 512);
      }
      if (closed) overlayCtx.closePath();
      overlayCtx.stroke();
    };
    overlayCtx.lineJoin = 'round';
    overlayCtx.lineCap = 'round';
    trace.lines.forEach((line, index) => {
      overlayCtx.strokeStyle = index === activeLine ? '#ffdf86' : '#224e68';
      overlayCtx.lineWidth = index === activeLine ? 3 : 2;
      stroke(line.points, line.closed);
      if (!line.closed) {
        const [start, end] = coastTraceExtensions(line),
          p = line.points;
        overlayCtx.setLineDash([6, 5]);
        stroke([...start, ...p.slice(0, 2)]);
        stroke([...p.slice(-2), ...end]);
        overlayCtx.setLineDash([]);
      }
    });
    overlayCtx.strokeStyle = '#fff2b6';
    overlayCtx.lineWidth = 3;
    stroke(coastStroke);
  }
  function commit(generate: boolean): void {
    if (!available) return;
    const settings = b.getSettings();
    if (dirty || kind === 'coast' || kind === 'symbolic') {
      settings.terrain ??= {};
      if (kind === 'coast') {
        if (trace.lines.length) settings.terrain.coastTrace = cloneTrace(trace);
        else delete settings.terrain.coastTrace;
        if (trace.lines.length && settings.terrain.procedural?.enabled) {
          settings.terrain.procedural.enabled.coasts = true;
          settings.terrain.procedural.enabled.coastCut = true;
        }
      } else if (kind === 'symbolic') {
        delete settings.terrain.sketch;
        delete settings.terrain.modification;
        delete settings.options.importedHeight;
        delete settings.decor;
        settings.terrain.zones = { version: 1, resolution: 128, weights: Array.from(weights) };
        settings.generation = 'procedural';
        settings.runtime = { backend: 'rust', compute: 'auto', ...settings.runtime, source: 'procedural' };
      } else {
        const delta = Array.from(heights, (h, i) => Math.fround(h - original[i]));
        if (delta.some(h => h !== 0)) settings.terrain.modification = { version: 1, resolution: n, width: sourceWidth, delta };
        else delete settings.terrain.modification;
      }
      b.onChange();
      if (kind !== 'coast' && (kind === 'symbolic' || resetLayer)) root.dispatchEvent(new CustomEvent('relief-source-changed', { bubbles: true, detail: kind }));
    }
    close();
    if (generate) b.context?.onApply();
  }
  function open(entry: ReliefEditorKind = 'modify'): void {
    if (!available || dialog.open || (entry === 'modify' && !b.context?.getWorld()) || (entry === 'coast' && !canTrace())) return;
    kind = entry;
    lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    load();
    window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'relief-paint' }));
    dialog.showModal();
    draw();
    overlay.focus({ preventScroll: true });
  }
  function close(): void {
    if (!dialog.open) return;
    pointer = undefined;
    coastStroke = [];
    cursor.hidden = true;
    dialog.close();
    lastFocus?.focus({ preventScroll: true });
  }
  $('[data-id="edit"]').onclick = () => open('symbolic');
  dialog.oncancel = event => {
    event.preventDefault();
    close();
  };
  const actions: Record<string, () => void> = {
    close,
    cancel: close,
    save: () => commit(false),
    help: () => {
      const help = $('#relief-paint-help');
      help.hidden = !help.hidden;
      $('[data-action="help"]').setAttribute('aria-expanded', String(!help.hidden));
    },
    brush: () => {
      pan = false;
      draw();
    },
    pan: () => {
      pan = true;
      draw();
    },
    undo: () => {
      if (pointer !== undefined) return;
      const s = past.pop();
      if (s) {
        future.push(capture());
        restore(s);
      }
    },
    redo: () => {
      if (pointer !== undefined) return;
      const s = future.pop();
      if (s) {
        past.push(capture());
        restore(s);
      }
    },
    fit: () => {
      zoom = 1;
      ox = oy = 0;
      view();
    },
    'zoom-in': () => changeZoom(zoom * 1.25),
    'zoom-out': () => changeZoom(zoom / 1.25),
    'reset-height': () => {
      if (pointer !== undefined) return;
      remember();
      if (kind === 'coast') {
        trace.lines = [];
        activeLine = -1;
      } else if (kind === 'symbolic') {
        weights.fill(0);
      } else {
        heights = original.slice();
        resetLayer = true;
      }
      mark();
      draw();
    },
    'swap-coast': () => {
      if (pointer !== undefined || activeLine < 0) return;
      remember();
      trace.lines[activeLine].flipped = !trace.lines[activeLine].flipped;
      mark();
      draw();
    },
    'delete-coast': () => {
      if (pointer !== undefined || activeLine < 0) return;
      remember();
      trace.lines.splice(activeLine, 1);
      activeLine = Math.min(activeLine, trace.lines.length - 1);
      mark();
      draw();
    },
    transform: () => {
      const scale = numeric('scale'),
        datum = numeric('datum'),
        crop = numeric('crop');
      if (!Number.isFinite(scale + datum + crop) || scale < 0.05 || scale > 10 || Math.abs(datum) > 5000 || crop < 25 || crop > 100) return;
      remember();
      heights = transformHeight(heights, n, scale, datum, crop);
      mark();
      draw();
    },
    'import-zones': () => fileInput.click(),
    'export-zones': () => download(new Blob([JSON.stringify({ version: 1, resolution: 128, weights: Array.from(weights) })], { type: 'application/json' }), 'terrain-zones.json'),
    'export-png': () => {
      const s: TerrainSketch = { version: 1, resolution: n, heights: Array.from(heights), processing: 'surface' };
      download(new Blob([new Uint8Array(heightmapPng(s, sourceWidth)).buffer], { type: 'image/png' }), 'terrain-heightmap.png');
    },
  };
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    button.onclick = () => actions[button.dataset.action!]?.();
  });
  $('[data-id="apply"]').onclick = () => commit(true);
  function download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  for (const c of Array.from(root.querySelectorAll<HTMLInputElement>('[data-control]')))
    c.oninput = () => {
      const output = c.parentElement?.querySelector('output');
      if (output) output.textContent = c.value;
    };
  function point(event: PointerEvent): [number, number] {
    const r = overlay.getBoundingClientRect(),
      p: [number, number] = [(event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height];
    return kind === 'coast' ? [Math.max(0, Math.min(1, p[0])), Math.max(0, Math.min(1, p[1]))] : p;
  }
  function dab(u: number, v: number): void {
    if (kind === 'symbolic') paintZones(weights, u, v, brush().radius, brush().softness, numeric('zone-strength') / 100, zone);
    else paintHeight(heights, original, n, u, v, brush(), tool, detail);
    strokeChanged = true;
  }
  overlay.onpointerdown = event => {
    if (!available || pointer !== undefined || ![0, 1].includes(event.button)) return;
    event.preventDefault();
    pointer = event.pointerId;
    dragging = pan || event.button === 1;
    strokeChanged = false;
    overlay.setPointerCapture(pointer);
    overlay.focus({ preventScroll: true });
    if (dragging) previous = [event.clientX, event.clientY];
    else if (kind === 'coast') {
      previous = point(event);
      coastStroke = [...previous];
      draw();
    } else {
      remember();
      previous = point(event);
      dab(...previous);
      draw();
    }
  };
  overlay.onpointermove = event => {
    const rect = viewport.getBoundingClientRect(),
      diameter = size * zoom * brush().radius * 2;
    Object.assign(cursor.style, { left: `${event.clientX - rect.left}px`, top: `${event.clientY - rect.top}px`, width: `${diameter}px`, height: `${diameter}px` });
    cursor.hidden = pan || dragging || kind === 'coast';
    if (pointer !== event.pointerId || !previous) return;
    if (dragging) {
      ox += event.clientX - previous[0];
      oy += event.clientY - previous[1];
      previous = [event.clientX, event.clientY];
      view();
      return;
    }
    if (kind === 'coast') {
      const p = point(event);
      if (Math.hypot(p[0] - previous[0], p[1] - previous[1]) > 0.001) {
        coastStroke.push(...p);
        previous = p;
        draw();
      }
      return;
    }
    const p = point(event),
      dx = p[0] - previous[0],
      dy = p[1] - previous[1],
      steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(0.002, brush().radius / 3)));
    for (let k = 1; k <= steps; k++) dab(previous[0] + (dx * k) / steps, previous[1] + (dy * k) / steps);
    previous = p;
    draw();
  };
  const finishStroke = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    if (kind === 'coast' && !dragging) {
      if (event.type === 'pointerup') {
        const p = point(event);
        coastStroke.push(...p);
        const line = lineFromStroke(coastStroke);
        if (line && trace.lines.length < 256) {
          remember();
          trace.lines.push(line);
          activeLine = trace.lines.length - 1;
          mark();
        } else if (!line) {
          let best = 0.025;
          activeLine = -1;
          trace.lines.forEach((candidate, index) => {
            const distance = coastTraceLineDistance(candidate, ...p);
            if (distance < best) {
              best = distance;
              activeLine = index;
            }
          });
        }
      }
      coastStroke = [];
    }
    pointer = undefined;
    previous = undefined;
    dragging = false;
    if (strokeChanged) mark();
    draw();
  };
  overlay.onpointerup = finishStroke;
  overlay.onpointercancel = finishStroke;
  overlay.onlostpointercapture = finishStroke;
  overlay.onpointerleave = () => {
    cursor.hidden = true;
  };
  function changeZoom(next: number): void {
    zoom = Math.max(0.5, Math.min(8, next));
    view();
  }
  viewport.addEventListener(
    'wheel',
    event => {
      event.preventDefault();
      changeZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    },
    { passive: false },
  );
  dialog.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !(event.target as Element).closest('input')) {
      event.preventDefault();
      actions[event.shiftKey ? 'redo' : 'undo']();
    }
  });
  const fileInput = $<HTMLInputElement>('[data-id="file"]');
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || b.disabled?.()) return;
    try {
      if (file.size > 2 * 1048576) throw new Error('Zone file is too large');
      const imported = parseTerrainZones(JSON.parse(await file.text()));
      if (b.disabled?.() || !dialog.open || kind !== 'symbolic') return;
      remember();
      weights = resampleZones(imported);
      mark();
      draw();
    } catch (error) {
      setText(state, error instanceof Error && error.message === 'Zone file is too large' ? 'Zone file is too large' : 'Invalid zone file');
    }
  };

  const heightmapInput = $<HTMLInputElement>('[data-id="heightmap-file"]');
  heightmapInput.onchange = async () => {
    const file = heightmapInput.files?.[0];
    heightmapInput.value = '';
    if (!file || b.disabled?.()) return;
    const error = $('[data-id="import-error"]');
    error.hidden = true;
    try {
      const imported = await readHeightmap(file, 0, 1200);
      if (b.disabled?.()) return;
      acceptHeightmap(b.getSettings(), imported, file.name);
      b.onChange();
      root.dispatchEvent(new CustomEvent('relief-source-changed', { bubbles: true, detail: 'import' }));
    } catch {
      setText(error, 'Invalid heightmap file');
      error.hidden = false;
    }
  };
  const observer = new ResizeObserver(() => {
    if (dialog.open) view();
  });
  observer.observe(viewport);
  const unsubscribe = onLanguageChange(draw);
  function canTrace(): boolean {
    const s = b.getSettings();
    return document.getElementById('heightmap-method-load')?.getAttribute('aria-checked') !== 'true' && !s.options.importedHeight && !s.terrain?.sketch?.processing && !s.decor;
  }
  function sync(): void {
    const s = b.getSettings();
    available = !(b.disabled?.() ?? false) && s.runtime?.backend !== 'typescript';
    for (const id of ['relief-symbolic-open', 'relief-modify-open']) {
      const trigger = document.getElementById(id) as HTMLButtonElement | null;
      if (trigger) trigger.disabled = !available || (id === 'relief-modify-open' && !b.context?.getWorld());
    }
    if (dialog.open && (!available || (kind === 'coast' && !canTrace()))) close();
  }
  sync();
  return {
    sync,
    open,
    dispose: () => {
      close();
      observer.disconnect();
      unsubscribe();
      root.replaceChildren();
    },
  };
}
