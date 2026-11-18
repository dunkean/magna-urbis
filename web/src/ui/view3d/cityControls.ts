/**
 * City control localization, persisted settings and event binding, called by cityMount and citySync.
 * Reads/writes: Reads options, terrain and selected settings; writes controls, setting revisions, observers and view settings on the supplied context.
 */
import { CITY_3D_MATERIAL_GROUNDS } from '../../render/cityGroundModes';
import { urbanText } from '../urbanPanelLocale';
import { City3dViewSettings, Ground, Colors } from './cityTypes';

import type { City3dContext } from './cityContext';

export function changedView(cityContext: City3dContext): void {
  cityContext.options.onViewSettingsChange?.({
    ground: cityContext.ground,
    plan: cityContext.planOverlay,
    colors: cityContext.colors,
    exaggeration: cityContext.terrain?.getCamera().exaggeration ?? Number(cityContext.$<HTMLInputElement>('[data-relief]').value),
    refinement: cityContext.refinement,
    trees3d: cityContext.nearTrees,
    treeDistance: cityContext.treeDistance,
  });
}

export function syncReliefControl(cityContext: City3dContext, exaggeration: number): void {
  const control = cityContext.$<HTMLInputElement>('[data-relief]'),
    value = `×${exaggeration}`;
  control.value = String(exaggeration);
  control.setAttribute('aria-valuetext', value);
  cityContext.$<HTMLOutputElement>('[data-relief-value]').textContent = value;
}

export function syncView(cityContext: City3dContext): void {
  const saved = cityContext.options.getViewSettings?.();
  if (!saved) return;
  const groundControl = cityContext.$<HTMLSelectElement>('[data-ground]');
  if (saved.ground && saved.ground !== cityContext.ground && Array.from(groundControl.options).some(option => option.value === saved.ground)) {
    cityContext.ground = saved.ground;
    ++cityContext.groundControlRevision;
    groundControl.disabled = false;
    cityContext.root.removeAttribute('aria-busy');
  }
  if (saved.plan !== undefined) cityContext.planOverlay = saved.plan;
  if (saved.colors) cityContext.colors = saved.colors;
  if (saved.refinement) cityContext.refinement = saved.refinement;
  if (saved.trees3d !== undefined) cityContext.nearTrees = saved.trees3d;
  if (saved.treeDistance !== undefined) cityContext.treeDistance = Math.max(200, Math.min(1500, saved.treeDistance));
  const treeGround = cityContext.options.getGroundSettings?.(cityContext.ground),
    treesAvailable = !cityContext.softwareMaterial && !!treeGround?.renderV2 && !treeGround.forestBrushes && treeGround.groundCover !== false;
  cityContext.$<HTMLInputElement>('[data-trees]').closest('label')!.hidden = !treesAvailable;
  cityContext.$<HTMLInputElement>('[data-trees]').checked = cityContext.nearTrees;
  cityContext.$<HTMLInputElement>('[data-tree-distance]').value = String(cityContext.treeDistance);
  cityContext.$<HTMLElement>('[data-tree-distance-label]').hidden = !cityContext.nearTrees || !treesAvailable;
  cityContext.terrain?.setTreeDistance(cityContext.treeDistance);
  cityContext.terrain?.setNearTrees(cityContext.nearTrees);
  cityContext.$<HTMLSelectElement>('[data-ground]').value = cityContext.ground;
  cityContext.$<HTMLInputElement>('[data-plan]').checked = cityContext.planOverlay;
  cityContext.$<HTMLSelectElement>('[data-colors]').value = cityContext.colors;
  if (cityContext.options.materialGrounds) cityContext.$<HTMLSelectElement>('[data-refinement]').value = cityContext.refinement;
  const exaggeration = Math.max(0.2, Math.min(5, saved.exaggeration ?? cityContext.terrain?.getCamera().exaggeration ?? 1));
  cityContext.syncReliefControl(exaggeration);
  if (cityContext.terrain && cityContext.terrain.getCamera().exaggeration !== exaggeration) cityContext.terrain.setCamera({ ...cityContext.terrain.getCamera(), exaggeration });
}

export function localizeControls(cityContext: City3dContext): void {
  cityContext.canvas.setAttribute('aria-label', cityContext.orbitHelp());
  cityContext.$('.city3d-bar').setAttribute('aria-label', urbanText(['Vue 3D', '3D view', '三维视图', 'Vista 3D', 'Vista 3D']));
  const label = (selector: string, words: [string, string, string, string, string], title?: [string, string, string, string, string]) => {
    const parent = cityContext.$(selector).closest('label');
    if (!parent) return;
    const node = Array.from(parent.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (node) node.textContent = urbanText(words);
    if (title) parent.title = urbanText(title);
  };
  label('[data-ground]', ['Sol', 'Ground', '地面', 'Suelo', 'Solo'], ['Fond drapé sur le relief', 'Background draped over terrain', '覆盖在地形上的背景', 'Fondo ajustado al relieve', 'Fundo sobre o relevo']);
  label('[data-navigation]', ['Navigation', 'Navigation', '导航', 'Navegación', 'Navegação']);
  cityContext.$<HTMLOptionElement>('[data-navigation] option[value="orbit"]').textContent = urbanText(['Orbite', 'Orbit', '环绕', 'Órbita', 'Órbita']);
  cityContext.$<HTMLOptionElement>('[data-navigation] option[value="fly"]').textContent = urbanText(['Vol libre', 'Free flight', '自由飞行', 'Vuelo libre', 'Voo livre']);
  cityContext.$<HTMLOptionElement>('[data-navigation] option[value="walk"]').textContent = urbanText(['Marche', 'Walk', '行走', 'Caminar', 'Caminhar']);
  label(
    '[data-plan]',
    ['Plan', 'Plan', '平面', 'Plano', 'Planta'],
    [
      'Contours des îlots et des parcelles dessinés sur le sol (les rues suivent l’interrupteur Routes)',
      'Block and parcel outlines drawn on the ground (streets follow the Roads switch)',
      '绘制在地面的街区与地块轮廓（街道由道路开关控制）',
      'Contornos de manzanas y parcelas dibujados en el suelo (las calles siguen el interruptor Carreteras)',
      'Contornos de quadras e parcelas desenhados no solo (as ruas seguem o interruptor Estradas)',
    ],
  );
  label(
    '[data-textured]',
    ['Textures', 'Textures', '纹理', 'Texturas', 'Texturas'],
    [
      'Textures des toits, murs, rues et places (bâtiments et constructions seulement)',
      'Roof, wall, street and square textures (buildings and structures only)',
      '屋顶、墙壁、街道和广场纹理（仅建筑与构筑物）',
      'Texturas de tejados, muros, calles y plazas (solo edificios y construcciones)',
      'Texturas de telhados, paredes, ruas e praças (somente edifícios e construções)',
    ],
  );
  label(
    '[data-trees]',
    ['Arbres 3D', '3D trees', '三维树木', 'Árboles 3D', 'Árvores 3D'],
    ['Arbres modélisés près de la caméra (sol satellite)', 'Modelled trees near the camera (satellite ground)', '相机附近的建模树木（卫星地面）', 'Árboles modelados cerca de la cámara (suelo satélite)', 'Árvores modeladas perto da câmera (solo satélite)'],
  );
  label(
    '[data-tree-distance]',
    ['Distance des arbres', 'Tree distance', '树木距离', 'Distancia de árboles', 'Distância das árvores'],
    ["Distance d'affichage des arbres modélisés (m)", 'Render distance of the modelled trees (m)', '建模树木的显示距离（米）', 'Distancia de dibujo de los árboles modelados (m)', 'Distância de exibição das árvores modeladas (m)'],
  );
  label('[data-colors]', ['Couleurs', 'Colours', '颜色', 'Colores', 'Cores']);
  label('[data-relief]', ['Relief', 'Terrain', '地形', 'Relieve', 'Relevo'], ['Exagération du relief', 'Terrain exaggeration', '地形夸张', 'Exageración del relieve', 'Exagero do relevo']);
  cityContext.$<HTMLOptionElement>('[data-ground] option[value="map"]').textContent = urbanText(['Carte pré-rendue', 'Pre-rendered map', '预渲染地图', 'Mapa prerenderizado', 'Mapa pré-renderizado']);
  cityContext.$<HTMLOptionElement>('[data-ground] option[value="render"]').textContent = urbanText(['Rendu 3D (sol procédural)', '3D render (procedural ground)', '三维渲染（程序化地面）', 'Render 3D (suelo procedural)', 'Renderização 3D (solo procedural)']);
  if (cityContext.options.materialGrounds) {
    for (const value of CITY_3D_MATERIAL_GROUNDS) cityContext.$<HTMLOptionElement>(`[data-ground] option[value="${value}"]`).textContent = urbanText(cityContext.groundNames[value]);
    label('[data-refinement]', ['Raffinement', 'Refinement', '细化', 'Refinamiento', 'Refinamento']);
    cityContext.$<HTMLOptionElement>('[data-refinement] option[value="noise"]').textContent = urbanText(['Bruit multi-échelle', 'Multiscale noise', '多尺度噪声', 'Ruido multiescala', 'Ruído multiescala']);
  }
  cityContext.$<HTMLOptionElement>('[data-colors] option[value="materials"]').textContent = urbanText(['Matériaux', 'Materials', '材料', 'Materiales', 'Materiais']);
  cityContext.$<HTMLOptionElement>('[data-colors] option[value="uses"]').textContent = urbanText(['Usages', 'Uses', '用途', 'Usos', 'Usos']);
  cityContext.$('[data-north]').title = urbanText(['Nord en haut', 'North up', '北朝上', 'Norte arriba', 'Norte para cima']);
  const detail = cityContext.$('[data-detail]');
  detail.textContent = urbanText(['Détailler autour', 'Detail nearby', '细化附近', 'Detallar alrededor', 'Detalhar ao redor']);
  detail.title = urbanText([
    'Réaliser en natif les plans compacts proches du centre de la vue',
    'Realize compact plans near the centre of the view natively',
    '原生生成视图中心附近的紧凑平面',
    'Realizar de forma nativa los planos compactos cerca del centro de la vista',
    'Realizar nativamente as plantas compactas perto do centro da vista',
  ]);
  cityContext.updateInfo();
}

export function connectCityControls(cityContext: City3dContext): void {
  // ------------------------------------------------------------ controls
  cityContext.$<HTMLSelectElement>('[data-navigation]').onchange = event => {
    cityContext.terrain?.setNavigation((event.target as HTMLSelectElement).value as 'orbit' | 'walk' | 'fly');
    cityContext.canvas.focus({ preventScroll: true });
  };

  cityContext.groundControlRevision = 0;

  cityContext.$<HTMLSelectElement>('[data-ground]').onchange = async event => {
    const control = event.target as HTMLSelectElement,
      next = control.value as Ground;
    const revision = ++cityContext.groundControlRevision;
    const deferred = cityContext.options.fastTerrain && !cityContext.softwareMaterial && next !== 'map' && cityContext.terrain?.getShaderProfile() === 'map';
    if (deferred) {
      control.disabled = true;
      cityContext.root.setAttribute('aria-busy', 'true');
      cityContext.info.textContent = urbanText(['Préparation des matériaux du sol procédural…', 'Preparing procedural ground materials…', '正在准备程序化地面材质…', 'Preparando materiales del suelo procedural…', 'Preparando materiais do solo procedural…']);
      // Paint the busy state before the optional driver shader compilation.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    try {
      if (revision !== cityContext.groundControlRevision) return;
      if (cityContext.disposed || !cityContext.active) {
        control.value = cityContext.ground;
        return;
      }
      cityContext.ground = next;
      cityContext.changedView();
      cityContext.applyGround();
    } catch (error) {
      cityContext.ground = 'map';
      control.value = cityContext.ground;
      cityContext.changedView();
      cityContext.applyGround();
      cityContext.info.dataset.detailError = String(error);
    } finally {
      if (revision === cityContext.groundControlRevision) {
        control.disabled = false;
        cityContext.root.removeAttribute('aria-busy');
        cityContext.updateInfo();
      }
    }
  };

  cityContext.$<HTMLInputElement>('[data-plan]').onchange = event => {
    cityContext.planOverlay = (event.target as HTMLInputElement).checked;
    cityContext.changedView();
    cityContext.terrain?.invalidateTiles();
  };
  // Hide or show only: the tree stream is built on the first switch-on, nothing else of the scene is rebuilt.
  cityContext.$<HTMLInputElement>('[data-trees]').onchange = event => {
    cityContext.nearTrees = (event.target as HTMLInputElement).checked;
    cityContext.$<HTMLElement>('[data-tree-distance-label]').hidden = !cityContext.nearTrees;
    cityContext.terrain?.setNearTrees(cityContext.nearTrees);
    cityContext.changedView();
  };
  // The distance changes the tree layer only: the stream is rebuilt around the eye, nothing else of the scene.
  cityContext.$<HTMLInputElement>('[data-tree-distance]').onchange = event => {
    cityContext.treeDistance = Number((event.target as HTMLInputElement).value);
    cityContext.terrain?.setTreeDistance(cityContext.treeDistance);
    cityContext.changedView();
  };

  cityContext.texturedBox = cityContext.$<HTMLInputElement>('[data-textured]');

  cityContext.texturedBox.closest('label')!.hidden = !cityContext.options.setTextured || !!cityContext.options.sharedVisibilityControls;

  cityContext.texturedBox.onchange = () => cityContext.options.setTextured?.(cityContext.texturedBox.checked);

  cityContext.$<HTMLSelectElement>('[data-colors]').onchange = event => {
    cityContext.colors = (event.target as HTMLSelectElement).value as Colors;
    cityContext.changedView();
    cityContext.syncBuildings();
  };

  cityContext.$<HTMLInputElement>('[data-relief]').oninput = event => {
    const exaggeration = Number((event.target as HTMLInputElement).value);
    if (cityContext.terrain) cityContext.terrain.setCamera({ ...cityContext.terrain.getCamera(), exaggeration });
    cityContext.syncReliefControl(exaggeration);
    cityContext.changedView();
    cityContext.updateInfo();
  };

  if (cityContext.options.materialGrounds)
    cityContext.$<HTMLSelectElement>('[data-refinement]').onchange = event => {
      cityContext.refinement = (event.target as HTMLSelectElement).value as City3dViewSettings['refinement'];
      cityContext.changedView();
      cityContext.applyGround();
    };

  cityContext.$<HTMLButtonElement>('[data-north]').onclick = () => {
    cityContext.terrain?.north();
  };

  cityContext.$<HTMLButtonElement>('[data-detail]').onclick = cityContext.detailAround;

  cityContext.resize = new ResizeObserver(() => {
    cityContext.viewWidth = cityContext.canvas.clientWidth;
    cityContext.viewHeight = cityContext.canvas.clientHeight;
    if (cityContext.active) cityContext.terrain?.resize(cityContext.root.clientWidth, cityContext.root.clientHeight);
  });

  cityContext.resize.observe(cityContext.root);
}
