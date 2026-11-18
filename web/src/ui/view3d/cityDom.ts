/**
 * City 3D DOM, styling and initial control placement, called by cityMount.
 * Reads/writes: Reads mount options; writes root/canvas/toolbar/selection elements and the locale callback into the supplied context.
 */
import { CITY_3D_MATERIAL_GROUNDS } from '../../render/cityGroundModes';
import { urbanText } from '../urbanPanelLocale';
import type { City3dContext } from './cityContext';
import * as cityControls from './cityControls';

const STYLE = `
.city3d{position:absolute;inset:0;z-index:6;background:#dfe6e4;overflow:hidden}
.city3d[hidden]{display:none}
.city3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.city3d canvas.drag{cursor:grabbing}
.city3d[data-navigation-mode=walk] canvas{cursor:crosshair}
.city3d-bar{position:absolute;z-index:3;top:8px;right:8px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;max-width:calc(100% - 16px);padding:6px 9px;background:#fffffff0;border:1px solid #d3ddd7;border-radius:4px;font-size:12px;color:#253b38}
.city3d-bar label{display:inline-flex;gap:4px;align-items:center}
.city3d-bar input[type=range]{width:70px}
.city3d-info{position:absolute;z-index:3;left:8px;bottom:8px;max-width:calc(100% - 16px);padding:5px 8px;background:#fffffff0;border:1px solid #d3ddd7;border-radius:4px;font-size:11px;line-height:1.55;color:#253b38;pointer-events:none}
.city3d-info b{font-weight:600}
.city3d-marker{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid #197ea4;border-radius:50%;box-shadow:0 0 0 2px #fff;pointer-events:none}
.city3d-marker::after{content:'';position:absolute;left:50%;bottom:100%;width:2px;height:22px;margin-left:-1px;background:#197ea4}
`;

export function mountCityDom(cityContext: City3dContext): void {
  if (!document.getElementById('city3d-style')) {
    const style = document.createElement('style');
    style.id = 'city3d-style';
    style.textContent = STYLE;
    document.head.append(style);
  }

  cityContext.root = document.createElement('div');

  cityContext.root.className = 'city3d';

  cityContext.root.hidden = true;

  cityContext.root.innerHTML = `<canvas tabindex="0" aria-label="Vue 3D de la ville. Glisser : déplacer, clic droit ou Maj + glisser : orbiter, molette : zoom, clic : sélectionner."></canvas>
    <div class="city3d-bar" role="group" aria-label="Vue 3D">
      <label data-navigation-label>Navigation <select data-navigation><option value="orbit">Orbite</option><option value="walk">Marche</option><option value="fly">Vol libre</option></select></label>
      <label title="Fond drapé sur le relief">Sol <select data-ground><option value="map">Carte pré-rendue</option><option value="render">Rendu 3D (sol procédural)</option></select></label>
      <label title="Contours des îlots et des parcelles dessinés sur le sol (les rues suivent l’interrupteur Routes)"><input type="checkbox" data-plan checked>Plan</label>
      <label title="Textures des toits, murs, rues et places (bâtiments et constructions seulement)"><input type="checkbox" data-textured>Textures</label>
      <label title="Arbres modélisés près de la caméra (sol satellite)"><input type="checkbox" data-trees>Arbres 3D</label>
      <label title="Distance d'affichage des arbres modélisés (m)" data-tree-distance-label hidden>Distance des arbres <input type="range" data-tree-distance min="200" max="1500" step="100" value="600"></label>
      <label>Couleurs <select data-colors><option value="materials">Matériaux</option><option value="uses">Usages</option></select></label>
      <label class="city3d-relief-control" title="Exagération du relief">Relief <input type="range" data-relief min="0.2" max="3" step="0.1" value="1"><output data-relief-value aria-hidden="true">×1</output></label>
      <button type="button" data-north title="Nord en haut">N</button>
      <button type="button" data-detail title="Réaliser en natif les plans compacts proches du centre de la vue">Détailler autour</button>
    </div>
    <div class="city3d-marker" hidden></div>
    <div class="city3d-info" role="status"></div>`;

  cityContext.options.host.append(cityContext.root);
  // Canvas size cached by the ResizeObserver: reading clientWidth in the camera loop forced a layout every frame.
  cityContext.viewWidth = 1;
  cityContext.viewHeight = 1;

  cityContext.canvas = cityContext.root.querySelector('canvas')!;
  cityContext.marker = cityContext.root.querySelector<HTMLElement>('.city3d-marker')!;
  cityContext.info = cityContext.root.querySelector<HTMLElement>('.city3d-info')!;

  cityContext.selectionSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  cityContext.selectionSvg.setAttribute('aria-hidden', 'true');

  cityContext.selectionSvg.dataset.urbanSelection = '';

  Object.assign(cityContext.selectionSvg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '3' });

  cityContext.selectionPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  cityContext.selectionPath.setAttribute('fill', 'none');

  cityContext.selectionPath.setAttribute('stroke', '#e52b36');

  cityContext.selectionPath.setAttribute('stroke-width', '2.5');

  cityContext.selectionPath.setAttribute('stroke-linejoin', 'round');

  cityContext.selectionPath.style.filter = 'drop-shadow(0 0 1px white)';

  cityContext.selectionSvg.append(cityContext.selectionPath);

  cityContext.root.append(cityContext.selectionSvg);

  cityContext.info.hidden = cityContext.options.labels === false;

  cityContext.toolbar = cityContext.root.querySelector<HTMLElement>('.city3d-bar')!;
  cityContext.externalControls = document.createElement('section');

  cityContext.externalControls.className = 'advanced-card view3d-settings';

  cityContext.externalControls.hidden = true;

  cityContext.$ = <T extends HTMLElement>(selector: string): T => (selector === '.city3d-bar' ? cityContext.toolbar : (cityContext.root.querySelector(selector) ?? cityContext.toolbar.querySelector(selector) ?? cityContext.externalControls.querySelector(selector))) as T;

  cityContext.$('[data-ground]').closest('label')!.hidden = cityContext.options.groundControl === false;

  cityContext.$('[data-navigation-label]').hidden = !cityContext.options.navigation;

  cityContext.groundNames = {
    'parchment-render': ['Satellite peint', 'Painted satellite', '绘制卫星', 'Satélite pintado', 'Satélite pintado'],
    render3d: ['Render3D · Multi-échelle', 'Render3D · Multiscale', 'Render3D · 多尺度', 'Render3D · Multiescala', 'Render3D · Multiescala'],
    'render3d-brush': ['Render3D · Pinceaux', 'Render3D · Brushes', 'Render3D · 笔刷', 'Render3D · Pinceles', 'Render3D · Pincéis'],
    'render-v2': ['Satellite · Render v2', 'Satellite · Render v2', '卫星 · Render v2', 'Satélite · Render v2', 'Satélite · Render v2'],
    'render-v2-substrate': ['Satellite · Substrat', 'Satellite · Substrate', '卫星 · 基底', 'Satélite · Sustrato', 'Satélite · Substrato'],
    'render-v2-moisture': ['Satellite · Humidité', 'Satellite · Moisture', '卫星 · 湿度', 'Satélite · Humedad', 'Satélite · Humidade'],
    'render-v2-vegetation': ['Satellite · Végétation', 'Satellite · Vegetation', '卫星 · 植被', 'Satélite · Vegetación', 'Satélite · Vegetação'],
    'render-v2-snow': ['Satellite · Neige / glace', 'Satellite · Snow / ice', '卫星 · 雪冰', 'Satélite · Nieve / hielo', 'Satélite · Neve / gelo'],
  };

  if (cityContext.options.materialGrounds) {
    for (const value of CITY_3D_MATERIAL_GROUNDS) cityContext.$<HTMLSelectElement>('[data-ground]').append(new Option(urbanText(cityContext.groundNames[value]), value));
    const label = document.createElement('label');
    label.innerHTML = 'Raffinement <select data-refinement><option value="source">Source</option><option value="noise">Bruit multi-échelle</option></select>';
    cityContext.$('.city3d-bar').append(label);
  }

  if (cityContext.options.sharedVisibilityControls) for (const selector of ['[data-plan]', '[data-refinement]', '[data-colors]']) cityContext.$(selector)?.closest('label')?.setAttribute('hidden', '');

  if (cityContext.options.advancedControls) {
    for (const selector of ['[data-ground]', '[data-refinement]', '[data-colors]']) {
      const field = cityContext.$(selector)?.closest('label');
      if (field) cityContext.externalControls.append(field);
    }
    cityContext.options.advancedControls.append(cityContext.externalControls);
  }

  if (cityContext.options.toolbarHost) {
    cityContext.toolbar.hidden = true;
    cityContext.options.toolbarHost.insertBefore(cityContext.toolbar, cityContext.options.toolbarHost.querySelector(':scope > .advanced-open'));
  }

  cityContext.orbitHelp = (): string =>
    urbanText([
      'Vue 3D de la ville. Glisser : déplacer, clic droit ou Maj + glisser : orbiter, molette : zoom, clic : sélectionner.',
      '3D city view. Drag to pan, right-click or Shift-drag to orbit, wheel to zoom, click to select.',
      '城市三维视图。拖动平移，右键或 Shift 拖动环绕，滚轮缩放，点击选择。',
      'Vista 3D de la ciudad. Arrastra para desplazar, clic derecho o Mayús y arrastrar para orbitar, rueda para zoom y clic para seleccionar.',
      'Vista 3D da cidade. Arraste para mover, clique direito ou Shift e arraste para orbitar, roda para zoom e clique para selecionar.',
    ]);

  cityContext.localizeControls = (...args) => cityControls.localizeControls(cityContext, ...args);

  window.addEventListener('magna-locale-change', cityContext.localizeControls);
}
