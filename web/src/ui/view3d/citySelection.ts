/**
 * City selection overlay, picking and status, called by cityMount and view callbacks.
 * Reads/writes: Reads selected building, camera and statistics; writes selection SVG/marker, status/control DOM and pointer-down state on the supplied context.
 */
import { city3dDisplayKind } from '../../render/city3dMeshes';
import { building3dHeight, isBuildingProjection } from '../../render/urbanBuildingGeometry';
import { urbanText } from '../urbanPanelLocale';
import type { City3dContext } from './cityContext';
// ------------------------------------------------------------ selection and info
export function placeMarker(cityContext: City3dContext): void {
  const t = cityContext.terrain,
    id = cityContext.options.getSelected?.(),
    b = id ? cityContext.display?.buildings.find(x => x.id === id) : undefined;
  const p = b && cityContext.active && t ? t.worldToScreen(cityContext.center(b).x, cityContext.center(b).y) : null;
  cityContext.marker.hidden = !p || cityContext.options.labels === false;
  if (p) {
    cityContext.marker.style.left = `${p[0]}px`;
    cityContext.marker.style.top = `${p[1]}px`;
  }
  cityContext.selectionPath.setAttribute(
    'd',
    b && cityContext.active && t
      ? b.footprint
          .flatMap(shape => [shape.outer, ...shape.holes])
          .map(ring => {
            const points = ring.map(point => t.worldToScreen(point.x, point.y));
            return points.length >= 3 && points.every(Boolean) ? `M${points.map(point => point!.join(',')).join('L')}Z` : '';
          })
          .join('')
      : '',
  );
}

export function updateInfo(cityContext: City3dContext): void {
  if (!cityContext.active || cityContext.error) return;
  const t = cityContext.terrain,
    c = t?.getCamera(),
    k = cityContext.display?.kinds,
    id = cityContext.options.getSelected?.(),
    b = id ? cityContext.display?.buildings.find(x => x.id === id) : undefined;
  const height = b ? building3dHeight(b) : 0;
  const flying = c?.navigation === 'fly',
    walking = c?.navigation === 'walk';
  cityContext.$<HTMLSelectElement>('[data-navigation]').value = flying ? 'fly' : walking ? 'walk' : 'orbit';
  cityContext.root.dataset.navigationMode = flying ? 'fly' : walking ? 'walk' : 'orbit';
  const walkHelp = urbanText([
    'Marche · ZQSD / WASD / flèches : marcher · glisser : regarder · Maj : accélérer · Échap : orbite',
    'Walk · WASD / ZQSD / arrows: move · drag: look · Shift: faster · Esc: orbit',
    '行走 · WASD / ZQSD / 方向键：移动 · 拖动：环视 · Shift：加速 · Esc：环绕',
    'Caminar · WASD / ZQSD / flechas: moverse · arrastrar: mirar · Mayús: acelerar · Esc: órbita',
    'Caminhar · WASD / ZQSD / setas: mover · arrastar: olhar · Shift: acelerar · Esc: órbita',
  ]);
  const flightHelp = urbanText([
    'Vol libre · ZQSD / WASD : se déplacer · Espace / E : monter · Ctrl / C : descendre · Maj : accélérer · Échap : orbite',
    'Free flight · WASD: move · Space / E: ascend · Ctrl / C: descend · Shift: faster · Esc: orbit',
    '自由飞行 · WASD：移动 · 空格 / E：上升 · Ctrl / C：下降 · Shift：加速',
    'Vuelo libre · WASD: mover · Espacio / E: subir · Ctrl / C: bajar · Mayús: acelerar',
    'Voo livre · WASD: mover · Espaço / E: subir · Ctrl / C: descer · Shift: acelerar',
  ]);
  cityContext.canvas.setAttribute('aria-label', flying ? flightHelp : walking ? walkHelp : cityContext.orbitHelp());
  cityContext.info.innerHTML = [
    cityContext.softwareMaterial && cityContext.ground !== 'map'
      ? urbanText([
          'Texture de terrain · WebGL logiciel, drapée sur le relief 3D.',
          'Raster terrain texture · software WebGL, draped over the 3D terrain.',
          '地形纹理 · 软件 WebGL，覆盖在三维地形上。',
          'Textura del terreno · WebGL por software, sobre el relieve 3D.',
          'Textura do terreno · WebGL por software, sobre o relevo 3D.',
        ])
      : '',
    cityContext.display && cityContext.display.buildings.length > cityContext.bridgeStats.count + cityContext.wallStats.pieces + cityContext.quayCount
      ? `<b>${(cityContext.display.buildings.length - cityContext.bridgeStats.count - cityContext.wallStats.pieces - cityContext.quayCount).toLocaleString()}</b> ${urbanText(['bâtiments', 'buildings', '栋建筑', 'edificios', 'edifícios'])}${cityContext.bridgeStats.count ? ` · ${urbanText(['ponts', 'bridges', '桥梁', 'puentes', 'pontes'])} ${cityContext.bridgeStats.count}` : ''}${cityContext.wallStats.count ? ` · ${urbanText(['enceintes', 'enclosures', '围墙', 'recintos', 'muralhas'])} ${cityContext.wallStats.count}` : ''} · ${urbanText(['silhouettes', 'silhouettes', '轮廓', 'siluetas', 'silhuetas'])} ${k!.silhouette} · ${urbanText(['plans', 'plans', '平面', 'planos', 'plantas'])} ${k!.compact} · ${urbanText(['détaillés', 'detailed', '详细', 'detallados', 'detalhados'])} ${k!.detailed}${cityContext.converting.size ? ` · ${urbanText(['réalisation', 'realizing', '生成中', 'realizando', 'realizando'])} ${cityContext.converting.size}…` : ''}`
      : urbanText([
          'Aucun bâtiment : tracez les silhouettes ou implantez les bâtiments.',
          'No buildings: draw silhouettes or place buildings.',
          '没有建筑：请绘制轮廓或放置建筑。',
          'Sin edificios: dibuja siluetas o coloca edificios.',
          'Sem edifícios: desenhe silhuetas ou posicione edifícios.',
        ]),
    b
      ? `${urbanText(['Sélection', 'Selection', '选择', 'Selección', 'Seleção'])} : ${b.id} · ${b.recipe_id} · ${height.toFixed(1)} m${isBuildingProjection(b) ? ` · ${urbanText(['volume cartographique', 'map volume', '地图体量', 'volumen cartográfico', 'volume cartográfico'])}` : ''}`
      : '',
    flying
      ? flightHelp
      : walking
        ? walkHelp
        : c
          ? `${urbanText(['Distance', 'Distance', '距离', 'Distancia', 'Distância'])} ${c.distance.toFixed(1)} m · ${urbanText(['inclinaison', 'tilt', '倾角', 'inclinación', 'inclinação'])} ${Math.round((c.pitch * 180) / Math.PI)}° · ${urbanText(['glisser : déplacer · clic droit / Maj : orbiter', 'drag: pan · right-click / Shift: orbit', '拖动：平移 · 右键 / Shift：环绕', 'arrastrar: desplazar · clic derecho / Mayús: orbitar', 'arrastar: mover · clique direito / Shift: orbitar'])}`
          : '',
    cityContext.info.dataset.detailError ? `${urbanText(['Réalisation', 'Realization', '生成', 'Realización', 'Realização'])} : ${cityContext.info.dataset.detailError}` : '',
    cityContext.sceneOf && 'projection' in cityContext.sceneOf && cityContext.sceneOf.projection === 'native-parent-window-3d-1'
      ? `Fenêtre native : ${cityContext.sceneOf.parents} parents · ${cityContext.sceneOf.buildings.length} membres · ${cityContext.sceneOf.complete ? 'complète' : `partielle (${cityContext.sceneOf.reason})`} · volumes cartographiques · capacité inconnue`
      : '',
  ]
    .filter(Boolean)
    .join('<br>');
}

export function connectCitySelection(cityContext: City3dContext): void {
  cityContext.down = undefined;

  cityContext.canvas.addEventListener('pointerdown', event => {
    cityContext.down = event.button === 0 ? [event.clientX, event.clientY] : undefined;
  });

  cityContext.canvas.addEventListener('pointerup', event => {
    if (['walk', 'fly'].includes(cityContext.terrain?.getCamera().navigation ?? 'orbit')) {
      cityContext.down = undefined;
      return;
    }
    if (!cityContext.down || !cityContext.terrain || Math.hypot(event.clientX - cityContext.down[0], event.clientY - cityContext.down[1]) > 4) {
      cityContext.down = undefined;
      return;
    }
    cityContext.down = undefined;
    const rect = cityContext.canvas.getBoundingClientRect(),
      id = cityContext.terrain.pickBuilding(event.clientX - rect.left, event.clientY - rect.top);
    if (!id) return;
    cityContext.options.onSelect?.(id);
    cityContext.placeMarker();
    cityContext.updateInfo();
    const source = cityContext.byId.get(id);
    if (source && city3dDisplayKind(source) === 'compact') void cityContext.realize([id]);
  });
}
