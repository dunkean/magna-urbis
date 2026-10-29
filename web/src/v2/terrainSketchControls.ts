import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import { createTerrainSketchEditor } from '../ui/terrainSketchEditor';
import { getLanguage, onLanguageChange, registerMessages, setText } from './i18n';
import { adaptedExtent } from './settings';

export interface TerrainSketchContext { getWorld(): World | undefined; onApply(): void }
interface Bindings {
  getSettings(): V2Settings;
  onChange(): void;
  disabled?: () => boolean;
  context?: TerrainSketchContext;
}

/** Uses the bench's paint/import machinery with a preview available before generation. */
export function mountTerrainSketchControls(root: HTMLElement, bindings: Bindings): { sync(): void; dispose(): void } {
  registerMessages({
    'Paint terrain zones here before generating. The same masks work with procedural and neural terrain.': { en: 'Paint terrain zones here before generating. The same masks work with procedural and neural terrain.', fr: 'Peignez ici les zones avant de générer. Les mêmes masques fonctionnent avec le relief procédural et neuronal.' },
    'Terrain zone preview': { en: 'Terrain zone preview', fr: 'Aperçu des zones de relief' },
  });
  const hint = document.createElement('p'); hint.className = 'hint'; setText(hint, 'Paint terrain zones here before generating. The same masks work with procedural and neural terrain.'); root.append(hint);
  const preview = document.createElement('div'); preview.className = 'terrain-zone-preview'; preview.setAttribute('aria-label', 'Terrain zone preview'); root.append(preview);
  const background = document.createElement('canvas'); background.className = 'terrain-zone-background'; background.width = background.height = 256; background.setAttribute('aria-hidden', 'true'); preview.append(background);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.style.display = 'none'; preview.append(svg);
  const editorHost = document.createElement('div'); editorHost.dataset.l10nKeep = ''; root.append(editorHost);
  let retainedWorld: World | undefined, paintedSketch: unknown, lastSketch = bindings.getSettings().terrain?.sketch, lastZones = bindings.getSettings().terrain?.zones;
  const surface = () => { const world = bindings.context?.getWorld(), grid = world?.terrain.height; return world && grid && grid.w === grid.h ? { height: grid.data, resolution: grid.w, width: world.mapSize } : undefined; };
  let editor: ReturnType<typeof createTerrainSketchEditor>;
  const changed = () => {
    const settings = bindings.getSettings(); settings.terrain ??= {};
    // Choosing a painted mask or metre-valued heightmap replaces the older pixel input.
    delete settings.options.importedHeight;
    lastSketch = settings.terrain.sketch = editor.snapshot(); lastZones = settings.terrain.zones = editor.zones();
    bindings.onChange();
  };
  editor = createTerrainSketchEditor(editorHost, lastSketch, surface, changed, undefined, undefined, {
    viewport: preview, surface: svg,
    bounds: () => ({ left: 0, top: 0, size: preview.clientWidth }),
    width: () => adaptedExtent(bindings.getSettings()),
    setWidth: width => { bindings.getSettings().extent = width; bindings.onChange(); },
    onEnable: () => {}, apply: () => { changed(); bindings.context?.onApply(); },
  }, lastZones, {
    text: words => {
      const text = words[getLanguage() === 'fr' ? 0 : 1];
      if (words[1].startsWith('Colours are operation masks.')) return getLanguage() === 'fr'
        ? 'Les couleurs sont des masques de génération. Le moteur génère bruits, soulèvement, crêtes et érosion dans ces zones. La gomme retrouve le relief automatique. Cliquez sur « Générer le relief » lorsque vos zones sont prêtes. Échap : quitter · Ctrl+Z / Ctrl+Maj+Z : annuler / rétablir.'
        : 'Colours are generation masks. The engine generates noise, uplift, ridges and erosion in these zones. The eraser restores automatic terrain. Click “Generate terrain” when your zones are ready. Esc: exit · Ctrl+Z / Ctrl+Shift+Z: undo / redo.';
      return text;
    },
    subscribe: onLanguageChange,
    source: () => bindings.getSettings().runtime?.source ?? 'procedural',
  });
  const observer = new ResizeObserver(() => editor.updateView()); observer.observe(preview);
  const sync = () => {
    const settings = bindings.getSettings(), sketch = settings.terrain?.sketch, zones = settings.terrain?.zones;
    if (sketch !== lastSketch || zones !== lastZones) {
      lastSketch = sketch; lastZones = zones;
      editor.restoreContext({ mask: zones ?? { version: 1, resolution: 128, weights: new Array<number>(128 ** 2 * 5).fill(0) }, heightmap: sketch, mode: zones ? 'zones' : sketch ? sketch.processing ?? 'sketch' : 'generated', editing: false });
    }
    editor.setAvailable(!(bindings.disabled?.() ?? false) && settings.terrain?.relief !== 'cavern'); editor.refresh(sketch, zones); editor.updateView();
    const world = bindings.context?.getWorld();
    if (world === retainedWorld && sketch === paintedSketch) return; retainedWorld = world; paintedSketch = sketch;
    const ctx = background.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, 256, 256);
    if (!world && !sketch) return;
    const grid = sketch ? { w: sketch.resolution, h: sketch.resolution, data: sketch.heights } : world!.terrain.height, image = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const index = Math.min(grid.h - 1, Math.floor(y / 256 * grid.h)) * grid.w + Math.min(grid.w - 1, Math.floor(x / 256 * grid.w));
      const height = grid.data[index], water = sketch ? height < 0 : world!.terrain.water[index] > 0;
      const shade = Math.max(0, Math.min(1, height / 2200)); const rgb = water ? [55, 98, 126] : [96 + shade * 102, 116 + shade * 65, 76 + shade * 79];
      const pixel = (y * 256 + x) * 4; image.data[pixel] = rgb[0]; image.data[pixel + 1] = rgb[1]; image.data[pixel + 2] = rgb[2]; image.data[pixel + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  };
  sync(); return { sync, dispose: () => { observer.disconnect(); editor.dispose(); root.replaceChildren(); } };
}
