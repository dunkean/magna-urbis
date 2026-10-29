import { CityGround } from '../render/cityGround';
import { city3dBoardwalks } from '../render/city3dBoardwalks';
import { city3dQuays } from '../render/city3dQuays';
import { cityBridgeStreets } from '../render/cityBridges';
/** City Bench 3D view. Reuses the Terrain Bench engine (Terrain3d: quadtree
 * relief, tiled materials, orbit camera, native building pass with 256 m sectors,
 * overview LOD, bounded GPU cache and picking). This module only adapts the city
 * data: the .decor raster as relief, the 2D map image (or the Render3D ground
 * material) as texture, the city plan drawn into close-up tiles, and every
 * architecture mode as display volumes (render/city3dMeshes.ts). */
import { Terrain3d, TERRAIN_3D_FOV, type Terrain3dCamera, type Terrain3dTile, type Terrain3dGroundSettings } from './terrain3d';
import type { HeightLayer } from './terrainGl';
import type { ForestField, ForestOccupation } from '../../../rust/bridge/terrainForest';
import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';
import { decorClimate } from './decorClimate';
import { city3dBridges, city3dScene, city3dProjectionScene, city3dWalls, city3dDisplayKind, compactBuilding, projectionDetailMatches, rasterHeight, type City3dHeight, type City3dDisplayScene } from '../render/city3dMeshes';
import { building3dHeight, isBuildingProjection, type Building3dVisual } from '../render/urbanBuildingGeometry';
import type { NativeBuildingProjectionScene } from './urbanBuildingProjection';
import type { Parent3dScene } from './urbanParent3d';
import { buildCityScene, drawCity, selectCityLod, type CityDrawOptions, type CityLayers, type CityScene } from '../render/cityCanvas';
import { DEFAULT_TERRAIN_LIGHTING } from '../render/terrainLighting';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { Layout, Partition, Street } from '../../../rust/bridge/urban';
import type { Point } from '../../../rust/bridge/housesContract';
import type { Decor } from './decor';
import { executionRuntime } from './executionProfile';
import { urbanText } from './urbanPanelLocale';

export interface City3dOptions {
  /** Positioned container (the bench viewport); the 3D view covers it when shown. */
  host: HTMLElement;
  /** V2 opens the draped map immediately; expensive procedural material shader
   * compilation is deferred until that ground mode is selected. */
  fastTerrain?: boolean;
  /** Optional workshop controls. Omitted keeps City Bench's original two ground modes. */
  materialGrounds?: boolean;
  /** Drape the exact raster material over real geometry on software WebGL. */
  softwareMaterialFallback?: boolean;
  getGroundSettings?(ground: City3dGround): Terrain3dGroundSettings | undefined;
  getForest?(): { field?: ForestField; occupation?: ForestOccupation } | undefined;
  getSurface?(): City3dSurface | undefined;
  getWaterDisplay?(): City3dWaterDisplay | undefined;
  getHeightSampler?(): ((x: number, y: number, metresPerPixel: number) => number) | undefined;
  getViewSettings?(): Partial<City3dViewSettings>;
  onViewSettingsChange?(settings: City3dViewSettings): void;
  getPlanOptions?(): Partial<Pick<CityDrawOptions, 'view' | 'palette' | 'width' | 'layers' | 'groundBlend' | 'labels'>> & { opacity?: number };
  getBuildingAppearance?(): Partial<UrbanBuildingAppearance>;
  getBuildingsVisible?(): boolean;
  /** Map names, glyphs and pins (default: shown). */
  labels?: boolean;
  getDecor(): Decor | undefined;
  getScene(): PlacementBatch | undefined;
  /** Exact accepted-plan cartography with native records retained cold. Takes
   * precedence over the legacy scene, including an explicitly empty index. */
  getProjection?(): NativeBuildingProjectionScene | Parent3dScene | undefined;
  getLayouts?(): readonly Layout[] | undefined;
  /** Regional roads crossing the map: their bridges are drawn too. */
  getRegionalStreets?(): readonly Street[] | undefined;
  getPartitions?(): readonly Partition[] | undefined;
  getSelected?(): string | undefined;
  /** Textured materials (PBR roofs, walls, streets, plazas): the 2D map's « Matières texturées » switch. */
  getTextured?(): boolean;
  /** The 3D bar's « Textures » box sets the same switch. */
  setTextured?(on: boolean): void;
  /** URL of the 2D map image; default `decors/<id>.png` (or the parent decor's). */
  getBackground?(): string | undefined;
  onSelect?(id: string): void;
  onCamera?(camera: Terrain3dCamera): void;
  /** Shared native detail controller (Codex `urban.buildingDetails`): one queue and
   * bounded cache for 2D and 3D. When given, the 3D view never realizes on its own. */
  details?: City3dDetailService;
}
export const CITY_3D_MATERIAL_GROUNDS = ['render3d', 'render3d-brush', 'render-v2', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow'] as const;
export type City3dGround = 'map' | 'render' | typeof CITY_3D_MATERIAL_GROUNDS[number];
export interface City3dViewSettings { ground: City3dGround; plan: boolean; colors: 'materials' | 'uses'; exaggeration: number; refinement: 'source' | 'noise' }
export interface City3dSurface { height: HeightLayer; water?: { n: number; levels: Float32Array; mask: Float32Array }; waterVisible?: boolean }
export interface City3dWaterDisplay { texture: HTMLCanvasElement; paths?: Path2D }
export interface City3dDetailService {
  setActiveView(view: '2d' | '3d'): void;
  update(view: { viewport: { minX: number; minY: number; maxX: number; maxY: number }; metresPerPixel: number; selectedId?: string; enabled?: boolean }): unknown;
  cached(): readonly PlacedBuilding[];
  subscribe(listener: () => void): () => void;
}
export interface City3d {
  readonly active: boolean;
  show(): void;
  hide(): void;
  /** Cheap: re-reads the getters and updates only what changed. */
  refresh(): void;
  focus(point: Point, radius?: number): void;
  getCamera(): Terrain3dCamera | undefined;
  setCamera(camera: Terrain3dCamera): void;
  capture(): Promise<Blob>;
  captureIllustration(): Promise<{ image: Blob; depth: Blob; camera: Terrain3dCamera }>;
  stats(): City3dStats;
  dispose(): void;
}
export interface City3dStats { buildings: number; silhouette: number; compact: number; detailed: number; displayMs: number; timings: { engine?: number; surface?: number; plan?: number; buildings?: number }; realizing: number; realizeError?: string; bridges?: { count: number; first?: Point }; walls?: City3dWallStats; lod?: ReturnType<Terrain3d['getLodInfo']>; parentWindow?: { complete: boolean; reason: string; parents: number; members: number } }

/** Fortification display volumes: enclosures drawn, pieces (curtain chunks, towers, gates, works), triangles. */
export interface City3dWallStats { count: number; pieces: number; triangles: number; ms: number; first?: Point; gate?: Point }

type Ground = City3dGround;
type Colors = 'materials' | 'uses';
const seedHash = (text: string): number => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h | 0; };
const PLAN_LAYERS: CityLayers = { reserve: false, allocated: false, centers: false, domains: false, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false };
const WATER = [74, 134, 179];
const STYLE = `
.city3d{position:absolute;inset:0;z-index:6;background:#dfe6e4;overflow:hidden}
.city3d[hidden]{display:none}
.city3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.city3d canvas.drag{cursor:grabbing}
.city3d-bar{position:absolute;top:8px;right:8px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;max-width:calc(100% - 16px);padding:6px 9px;background:#fffffff0;border:1px solid #d3ddd7;border-radius:4px;font-size:12px;color:#253b38}
.city3d-bar label{display:inline-flex;gap:4px;align-items:center}
.city3d-bar input[type=range]{width:70px}
.city3d-info{position:absolute;left:8px;bottom:8px;max-width:calc(100% - 16px);padding:5px 8px;background:#fffffff0;border:1px solid #d3ddd7;border-radius:4px;font-size:11px;line-height:1.55;color:#253b38;pointer-events:none}
.city3d-info b{font-weight:600}
.city3d-marker{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid #197ea4;border-radius:50%;box-shadow:0 0 0 2px #fff;pointer-events:none}
.city3d-marker::after{content:'';position:absolute;left:50%;bottom:100%;width:2px;height:22px;margin-left:-1px;background:#197ea4}
`;

/** Mount the City Bench 3D view in `host`. WebGL2 is requested on the first show. */
export function mountCity3d(options: City3dOptions): City3d {
  if (!document.getElementById('city3d-style')) { const style = document.createElement('style'); style.id = 'city3d-style'; style.textContent = STYLE; document.head.append(style); }
  const root = document.createElement('div'); root.className = 'city3d'; root.hidden = true;
  root.innerHTML = `<canvas tabindex="0" aria-label="Vue 3D de la ville. Glisser : déplacer, clic droit ou Maj + glisser : orbiter, molette : zoom, clic : sélectionner."></canvas>
    <div class="city3d-bar" role="group" aria-label="Vue 3D">
      <label title="Fond drapé sur le relief">Sol <select data-ground><option value="map">Carte pré-rendue</option><option value="render">Rendu 3D (sol procédural)</option></select></label>
      <label title="Rues, îlots et parcelles dessinés sur le sol en vue rapprochée"><input type="checkbox" data-plan checked>Plan</label>
      <label title="Textures des toits, murs, rues et places (bâtiments et constructions seulement)"><input type="checkbox" data-textured>Textures</label>
      <label>Couleurs <select data-colors><option value="materials">Matériaux</option><option value="uses">Usages</option></select></label>
      <label title="Exagération du relief">Relief <input type="range" data-relief min="1" max="5" step="0.5" value="1"></label>
      <button type="button" data-north title="Nord en haut">N</button>
      <button type="button" data-detail title="Réaliser en natif les plans compacts proches du centre de la vue">Détailler autour</button>
    </div>
    <div class="city3d-marker" hidden></div>
    <div class="city3d-info" role="status"></div>`;
  options.host.append(root);
  const canvas = root.querySelector('canvas')!, marker = root.querySelector<HTMLElement>('.city3d-marker')!, info = root.querySelector<HTMLElement>('.city3d-info')!;
  info.hidden = options.labels === false;
  const $ = <T extends HTMLElement>(selector: string): T => root.querySelector(selector) as T;
  const groundNames: Record<typeof CITY_3D_MATERIAL_GROUNDS[number], [string, string, string, string, string]> = {
    render3d: ['Render3D · Multi-échelle', 'Render3D · Multiscale', 'Render3D · 多尺度', 'Render3D · Multiescala', 'Render3D · Multiescala'],
    'render3d-brush': ['Render3D · Pinceaux', 'Render3D · Brushes', 'Render3D · 笔刷', 'Render3D · Pinceles', 'Render3D · Pincéis'],
    'render-v2': ['Satellite · Render v2', 'Satellite · Render v2', '卫星 · Render v2', 'Satélite · Render v2', 'Satélite · Render v2'],
    'render-v2-substrate': ['Satellite · Substrat', 'Satellite · Substrate', '卫星 · 基底', 'Satélite · Sustrato', 'Satélite · Substrato'],
    'render-v2-moisture': ['Satellite · Humidité', 'Satellite · Moisture', '卫星 · 湿度', 'Satélite · Humedad', 'Satélite · Humidade'],
    'render-v2-vegetation': ['Satellite · Végétation', 'Satellite · Vegetation', '卫星 · 植被', 'Satélite · Vegetación', 'Satélite · Vegetação'],
    'render-v2-snow': ['Satellite · Neige / glace', 'Satellite · Snow / ice', '卫星 · 雪冰', 'Satélite · Nieve / hielo', 'Satélite · Neve / gelo'],
  };
  if (options.materialGrounds) {
    for (const value of CITY_3D_MATERIAL_GROUNDS) $<HTMLSelectElement>('[data-ground]').append(new Option(urbanText(groundNames[value]), value));
    const label = document.createElement('label'); label.innerHTML = 'Raffinement <select data-refinement><option value="source">Source</option><option value="noise">Bruit multi-échelle</option></select>';
    $('.city3d-bar').append(label);
  }
  const localizeControls = (): void => {
    canvas.setAttribute('aria-label', urbanText(['Vue 3D de la ville. Glisser : déplacer, clic droit ou Maj + glisser : orbiter, molette : zoom, clic : sélectionner.', '3D city view. Drag to pan, right-click or Shift-drag to orbit, wheel to zoom, click to select.', '城市三维视图。拖动平移，右键或 Shift 拖动环绕，滚轮缩放，点击选择。', 'Vista 3D de la ciudad. Arrastra para desplazar, clic derecho o Mayús y arrastrar para orbitar, rueda para zoom y clic para seleccionar.', 'Vista 3D da cidade. Arraste para mover, clique direito ou Shift e arraste para orbitar, roda para zoom e clique para selecionar.']));
    $('.city3d-bar').setAttribute('aria-label', urbanText(['Vue 3D','3D view','三维视图','Vista 3D','Vista 3D']));
    const label = (selector: string, words: [string, string, string, string, string], title?: [string, string, string, string, string]) => { const parent = $(selector).closest('label'); if (!parent) return; const node = Array.from(parent.childNodes).find(n => n.nodeType === Node.TEXT_NODE); if (node) node.textContent = urbanText(words); if (title) parent.title = urbanText(title); };
    label('[data-ground]', ['Sol','Ground','地面','Suelo','Solo'], ['Fond drapé sur le relief','Background draped over terrain','覆盖在地形上的背景','Fondo ajustado al relieve','Fundo sobre o relevo']);
    label('[data-plan]', ['Plan','Plan','平面','Plano','Planta'], ['Rues, îlots et parcelles dessinés sur le sol en vue rapprochée','Streets, blocks and parcels drawn on the ground in close view','近景中绘制在地面的街道、街区与地块','Calles, manzanas y parcelas dibujadas en el suelo de cerca','Ruas, quadras e parcelas desenhadas no solo de perto']);
    label('[data-textured]', ['Textures','Textures','纹理','Texturas','Texturas'], ['Textures des toits, murs, rues et places (bâtiments et constructions seulement)','Roof, wall, street and square textures (buildings and structures only)','屋顶、墙壁、街道和广场纹理（仅建筑与构筑物）','Texturas de tejados, muros, calles y plazas (solo edificios y construcciones)','Texturas de telhados, paredes, ruas e praças (somente edifícios e construções)']);
    label('[data-colors]', ['Couleurs','Colours','颜色','Colores','Cores']); label('[data-relief]', ['Relief','Terrain','地形','Relieve','Relevo'], ['Exagération du relief','Terrain exaggeration','地形夸张','Exageración del relieve','Exagero do relevo']);
    $<HTMLOptionElement>('[data-ground] option[value="map"]').textContent = urbanText(['Carte pré-rendue','Pre-rendered map','预渲染地图','Mapa prerenderizado','Mapa pré-renderizado']);
    $<HTMLOptionElement>('[data-ground] option[value="render"]').textContent = urbanText(['Rendu 3D (sol procédural)','3D render (procedural ground)','三维渲染（程序化地面）','Render 3D (suelo procedural)','Renderização 3D (solo procedural)']);
    if (options.materialGrounds) {
      for (const value of CITY_3D_MATERIAL_GROUNDS) $<HTMLOptionElement>(`[data-ground] option[value="${value}"]`).textContent = urbanText(groundNames[value]);
      label('[data-refinement]', ['Raffinement', 'Refinement', '细化', 'Refinamiento', 'Refinamento']);
      $<HTMLOptionElement>('[data-refinement] option[value="noise"]').textContent = urbanText(['Bruit multi-échelle', 'Multiscale noise', '多尺度噪声', 'Ruido multiescala', 'Ruído multiescala']);
    }
    $<HTMLOptionElement>('[data-colors] option[value="materials"]').textContent = urbanText(['Matériaux','Materials','材料','Materiales','Materiais']);
    $<HTMLOptionElement>('[data-colors] option[value="uses"]').textContent = urbanText(['Usages','Uses','用途','Usos','Usos']);
    $('[data-north]').title = urbanText(['Nord en haut','North up','北朝上','Norte arriba','Norte para cima']);
    const detail = $('[data-detail]'); detail.textContent = urbanText(['Détailler autour','Detail nearby','细化附近','Detallar alrededor','Detalhar ao redor']); detail.title = urbanText(['Réaliser en natif les plans compacts proches du centre de la vue','Realize compact plans near the centre of the view natively','原生生成视图中心附近的紧凑平面','Realizar de forma nativa los planos compactos cerca del centro de la vista','Realizar nativamente as plantas compactas perto do centro da vista']);
    updateInfo();
  };
  window.addEventListener('magna-locale-change', localizeControls);
  let terrain: Terrain3d | undefined, active = false, disposed = false, error = '';
  let ground: Ground = 'map', colors: Colors = 'materials', planOverlay = true, refinement: City3dViewSettings['refinement'] = 'noise';
  let groundKey = '', planKey = '', proceduralGround = false, softwareMaterial = false;
  let waterDisplay: City3dWaterDisplay | undefined;
  let surfaceDecor: Decor | undefined, imageUrl: string | undefined, heightAt: City3dHeight | undefined, stiltWaterAt: City3dHeight | undefined, image: HTMLImageElement | HTMLCanvasElement | undefined, mapFallback: HTMLCanvasElement | undefined, waterMask: HTMLCanvasElement | undefined, waterPaths: Path2D | undefined, waterMaskVisible = true;
  let bridgeWaterAt: City3dHeight | undefined;
  const textured = (): boolean => options.getTextured?.() ?? false;
  let texturedSeen = false;
  let plan: CityScene | undefined, planOf: [unknown, unknown] | undefined;
  let sceneOf: PlacementBatch | NativeBuildingProjectionScene | Parent3dScene | undefined, display: City3dDisplayScene | undefined, displayMs = 0, focused = false, sourceEpoch = 0;
  const details = new Map<string, PlacedBuilding>(), detailBases = new Map<string, Building3dVisual>(), converting = new Set<string>();
  let byId = new Map<string, Building3dVisual>(), bridgesOf: [readonly Layout[] | undefined, readonly Street[] | undefined] = [undefined, undefined], bridgeStats: { count: number; first?: Point } = { count: 0 };
  let quayCount = 0;
  let wallStats: City3dWallStats = { count: 0, pieces: 0, triangles: 0, ms: 0 };
  let structureInputs: unknown[] = [], structureBuildings: Building3dVisual[] = [];
  const realized = new WeakSet<Building3dVisual>();
  let displayIndex = new Map<string, number>(), indexOf: unknown;
  const pendingSwaps = new Map<string, Building3dVisual>();
  // Strict identity of the source plan: an edit with the same recipe and pose
  // (e.g. new dimensions) must not keep the old exterior.
  const samePlan = (a: Building3dVisual | undefined, b: Building3dVisual): boolean => !!a && a === b;
  let detailTimer: ReturnType<typeof setTimeout> | undefined, textureTicket = 0;
  let unsubscribeDetails: (() => void) | undefined, detailFrame = 0;
  /** The 3D camera drives the shared controller: ground footprint around the target. */
  function driveDetails(): void {
    const t = terrain, service = options.details; if (!t || !service || !active) return;
    const c = t.getCamera(), half = c.distance * Math.tan(TERRAIN_3D_FOV / 2), aspect = Math.max(1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    service.update({ viewport: { minX: c.x - half * aspect, minY: c.y - half, maxX: c.x + half * aspect, maxY: c.y + half },
      metresPerPixel: (2 * half) / Math.max(1, canvas.clientHeight), selectedId: options.getSelected?.(), enabled: true });
  }
  /** Exteriors the shared controller holds are swapped into the display in place. */
  function applyServiceDetails(): void {
    const service = options.details; if (!service) return;
    const cached = service.cached(), held = new Set(cached.map(d => d.id));
    // Exteriors the shared cache evicted go back to their compact plan (one rebuild).
    for (const id of [...details.keys()]) if (!held.has(id)) { details.delete(id); detailBases.delete(id); restoreCompact(id); }
    for (const d of cached) if (details.get(d.id) !== d) {
      const base = byId.get(d.id); if (!base || isBuildingProjection(base) && !projectionDetailMatches(base, d)) continue;
      details.set(d.id, d); detailBases.set(d.id, base); swapDetail(d.id, d);
    }
    updateInfo();
  }

  function ensureTerrain(): Terrain3d | undefined {
    if (terrain || error) return terrain;
    try { terrain = new Terrain3d(canvas, () => {
      updateInfo(); options.onCamera?.(terrain!.getCamera());
      if (options.details && !detailFrame) detailFrame = requestAnimationFrame(() => { detailFrame = 0; driveDetails(); });
    }, () => placeMarker(), { fastMapShader: options.fastTerrain });
      if (options.softwareMaterialFallback) {
        const gl = canvas.getContext('webgl2'), debug = gl?.getExtension('WEBGL_debug_renderer_info');
        const renderer = gl && String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
        softwareMaterial = !!renderer && /swiftshader|llvmpipe|softpipe|software|warp|microsoft basic render/i.test(renderer);
      }
    }
    catch (e) { error = e instanceof Error ? e.message : String(e); info.textContent = error; }
    return terrain;
  }

  // ------------------------------------------------------------ relief and texture
  function backgroundUrl(d: Decor): string | undefined {
    const custom = options.getBackground?.(); if (custom) return custom;
    const source = d.meta.id.startsWith('city-') ? d.meta.id : d.meta.pipeline?.parent;
    return source ? `decors/${source}.png` : undefined;
  }
  function hillshade(d: Decor): HTMLCanvasElement {
    const { n, height, water, width } = d.raster, cell = width / n, c = document.createElement('canvas'); c.width = c.height = n;
    const ctx = c.getContext('2d')!, pixels = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, o = i * 4;
      if (water[i]) { pixels.data.set([...WATER, 255], o); continue; }
      const dx = (height[y * n + Math.min(n - 1, x + 1)] - height[y * n + Math.max(0, x - 1)]) / (2 * cell), dy = (height[Math.min(n - 1, y + 1) * n + x] - height[Math.max(0, y - 1) * n + x]) / (2 * cell);
      const light = Math.max(0, Math.min(1, 0.8 + (-dx - dy) * 1.4));
      pixels.data.set([214 * light, 207 * light, 168 * light, 255].map(Math.round), o);
    }
    ctx.putImageData(pixels, 0, 0); return c;
  }
  /** Render3D mode: water only, land left transparent for the procedural ground. */
  function water(d: Decor, visible = true): HTMLCanvasElement {
    const { n, water } = d.raster, c = document.createElement('canvas'); c.width = c.height = n;
    const ctx = c.getContext('2d')!, pixels = ctx.createImageData(n, n);
    if (visible) for (let i = 0; i < n * n; i++) if (water[i]) pixels.data.set([...WATER, 255], i * 4);
    ctx.putImageData(pixels, 0, 0); return c;
  }
  function waterPath(d: Decor): Path2D | undefined {
    const polygons = d.raster.geometry?.water; if (!polygons?.length) return undefined;
    const path = new Path2D();
    for (const polygon of polygons) for (const ring of polygon) { if (ring.length < 3) continue; path.moveTo(ring[0].x, ring[0].y); for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y); path.closePath(); }
    return path;
  }
  async function loadImage(url: string): Promise<HTMLImageElement> {
    const img = new Image(); img.decoding = 'async'; img.src = url;
    await img.decode(); return img;
  }
  function setSurface(d: Decor): void {
    const t = terrain!, r = d.raster;
    surfaceDecor = d; heightAt = rasterHeight(r.height, r.n, r.width); bridgeWaterAt = r.waterLevel ? rasterHeight(r.waterLevel, r.n, r.width) : undefined; sceneOf = undefined; sourceEpoch++; details.clear(); detailBases.clear();
    const physical = new CityGround(r), levels = bridgeWaterAt;
    stiltWaterAt = levels ? (x, y) => physical.waterAt({ x, y }) ? levels(x, y) : NaN : undefined;
    waterMask = undefined; waterPaths = undefined; image = undefined; mapFallback = undefined; planOf = undefined;
    const surface = options.getSurface?.();
    t.setSurface(surface?.height ?? { x: 0, y: 0, width: r.width, n: r.n, data: r.height }, surface?.water, surface?.waterVisible);
    imageUrl = undefined; syncImage(d);
    applyGround();
  }
  /** The 2D background may change (map style selector): follow its image. */
  function syncImage(d: Decor): void {
    const url = backgroundUrl(d); if (url === imageUrl) return;
    imageUrl = url; const ticket = ++textureTicket;
    if (url) void loadImage(url).then(img => { if (ticket === textureTicket && !disposed) { image = img; applyGround(); } }, () => { /* the hillshade stays */ });
  }
  function applyGround(): void {
    const t = terrain, d = surfaceDecor; if (!t || !d) return;
    const configured = options.getGroundSettings?.(ground);
    const procedural = ground !== 'map' && !softwareMaterial && (!options.getGroundSettings || !!configured);
    proceduralGround = procedural;
    root.dataset.materialBackend = softwareMaterial && ground !== 'map' ? 'software-texture' : procedural ? 'gpu' : 'map';
    if (procedural) {
      const waterVisible = configured?.waterVisible !== false;
      waterDisplay = options.getWaterDisplay?.();
      if (waterDisplay) { waterMask = waterDisplay.texture; waterPaths = waterDisplay.paths; }
      else { if (!waterMask || waterMaskVisible !== waterVisible) { waterMask = water(d, waterVisible); waterMaskVisible = waterVisible; } waterPaths ??= waterPath(d); }
      const climate = decorClimate(d.meta);
      t.setGroundMaterial(configured ?? { seed: seedHash(d.meta.seed), climate, sourceCell: d.meta.terrainDisplay?.sourceCell ?? d.raster.width / 1024, lighting: DEFAULT_TERRAIN_LIGHTING, displacement: false });
      t.setTexture(waterMask);
    } else {
      t.setGroundMaterial(undefined);
      t.setTexture(image ?? (mapFallback ??= hillshade(d)));
    }
    const forest = procedural ? options.getForest?.() : undefined;
    t.setForest(forest?.field, forest?.occupation);
    t.setHeightSampler(options.getHeightSampler?.());
    groundKey = JSON.stringify([ground, refinement, configured]);
    t.setTileLoader(loadTile);
  }
  /** One material tile: the map image (or water) cropped, then the city plan when close. */
  async function loadTile(tile: Terrain3dTile): Promise<TexImageSource> {
    const d = surfaceDecor!, size = tile.pixels, c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d')!, width = d.raster.width;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    // V2 can supply a physical raster without a pre-rendered external PNG.
    // Use the same hillshade for both the overview and close-up map tiles.
    const source = proceduralGround ? waterMask : image ?? (mapFallback ??= hillshade(d));
    if (source) { const k = source.width / width; ctx.drawImage(source, tile.x * k, tile.y * k, tile.width * k, tile.width * k, 0, 0, size, size); }
    const k = size / tile.width, mpp = tile.width / size;
    const waterVisible = options.getGroundSettings?.(ground)?.waterVisible !== false;
    if (proceduralGround && waterPaths && waterVisible) { ctx.save(); ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k); ctx.fillStyle = `rgb(${WATER})`; ctx.fill(waterPaths, 'evenodd'); ctx.restore(); }
    const city = planOverlay ? cityPlan() : undefined;
    if (city && city.extent.maxX >= tile.x && city.extent.minX <= tile.x + tile.width && city.extent.maxY >= tile.y && city.extent.minY <= tile.y + tile.width) {
      ctx.save(); ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
      const planOptions = options.getPlanOptions?.(); ctx.globalAlpha = planOptions?.opacity ?? 1;
      drawCity(ctx, city, { viewport: { minX: tile.x, minY: tile.y, maxX: tile.x + tile.width, maxY: tile.y + tile.width }, mpp, dpr: 1, lod: selectCityLod(mpp),
        view: planOptions?.view ?? 'parcels', labels: planOptions?.labels ?? options.labels, palette: planOptions?.palette ?? 'terrain', width: planOptions?.width ?? 0.6, layers: planOptions?.layers ?? PLAN_LAYERS, buildingsVisible: false, appearance: { style: 'cartographic', diagnostic: 'none' }, textured: textured(), groundBlend: planOptions?.groundBlend ?? false, onTexturesReady: () => terrain?.invalidateTiles() });
      ctx.restore();
    }
    return c;
  }
  function cityPlan(): CityScene | undefined {
    const layouts = options.getLayouts?.(), partitions = options.getPartitions?.();
    if (!layouts?.length) return plan = undefined;
    if (!planOf || planOf[0] !== layouts || planOf[1] !== partitions) { plan = buildCityScene(layouts, partitions ?? [], surfaceDecor?.raster); planOf = [layouts, partitions]; }
    return plan;
  }

  // ------------------------------------------------------------ buildings
  function syncBuildings(force = false): void {
    const t = terrain; if (!t) return;
    const scene = options.getProjection?.() ?? options.getScene(), layouts = options.getLayouts?.(), regional = options.getRegionalStreets?.();
    if (layouts !== bridgesOf[0] || regional !== bridgesOf[1]) { bridgesOf = [layouts, regional]; force = true; }
    if (scene !== sceneOf) {
      byId = new Map(scene?.buildings.map(b => [b.id, b]));
      // Reconcile before city3dScene: a detail without its exact base plan goes.
      for (const id of [...details.keys()]) { const base = detailBases.get(id); if (!base || !samePlan(byId.get(id), base)) { details.delete(id); detailBases.delete(id); } }
      force = true; sceneOf = scene; sourceEpoch++;
    }
    if (force) {
      // Swaps queued for the previous display must not be reinjected by id.
      clearTimeout(detailTimer); pendingSwaps.clear();
      const started = performance.now();
      display = scene ? 'projection' in scene ? city3dProjectionScene(scene, { details }) : city3dScene(scene, { heightAt, waterAt: stiltWaterAt, details }) : undefined;
      const nextStructureInputs = [layouts, regional, heightAt, bridgeWaterAt];
      if (nextStructureInputs.some((input, i) => input !== structureInputs[i])) {
        structureInputs = nextStructureInputs;
        // Architecture edits/colours do not change bridges, walls or quays.
        // Retain these exact meshes until their actual terrain/network changes.
        const bridgeStreets = cityBridgeStreets(layouts ?? [], regional ?? []);
        const bridges = city3dBridges(bridgeStreets, heightAt, bridgeWaterAt);
        bridgeStats = { count: bridges.length, first: bridges[0] && center(bridges[0]) };
        const wallStarted = performance.now();
        const walls = (layouts ?? []).flatMap((l, li) => city3dWalls(l.enclosures ?? [], heightAt, String(li), l.culture));
        const enclosures = new Set(walls.map(w => w.id.split(':').slice(1, 3).join(':'))), gate = walls.find(w => w.id.includes(':gate:') && !w.variant_id.endsWith(':water'));
        wallStats = { count: enclosures.size, pieces: walls.length, ms: Math.round(performance.now() - wallStarted),
          triangles: walls.reduce((n, w) => n + w.volumes.reduce((m, v) => m + v.roof_mesh.faces.reduce((k, f) => k + f.vertices.length - 2, 0), 0), 0),
          first: walls[0] && center(walls[0]), gate: gate && center(gate) };
        const quays = city3dQuays(layouts ?? []), boardwalks = city3dBoardwalks(bridgeStreets, heightAt, bridgeWaterAt); quayCount = quays.length + boardwalks.length;
        structureBuildings = [...bridges, ...walls, ...quays, ...boardwalks];
      }
      const extra = structureBuildings;
      if (extra.length) display = display ? { ...display, buildings: [...display.buildings, ...extra],
        ...(display.occupationBuildings ? { occupationBuildings: [...display.occupationBuildings, ...extra] } : {}) }
        : { materials: city3dScene({ schema_version: '1', generator_version: '', buildings: [], refusals: [], open_spaces: [] }).materials, buildings: extra, kinds: { silhouette: 0, compact: 0, detailed: 0 } };
      displayMs = performance.now() - started;
    }
    const appearance = options.getBuildingAppearance?.(), diagnostic = colors === 'uses' ? 'uses' : appearance?.diagnostic === 'uses' ? 'none' : appearance?.diagnostic ?? 'none';
    t.setBuildings(display, { style: appearance?.style ?? 'cartographic', diagnostic, textured: textured() && diagnostic !== 'uses' && diagnostic !== 'height' }, options.getBuildingsVisible?.() ?? true);
    ($('[data-detail]') as HTMLButtonElement).disabled = !display?.kinds.compact || !!scene && 'projection' in scene && (!options.details || scene.projection === 'native-parent-window-3d-1');
    if (options.details) { applyServiceDetails(); driveDetails(); }
    placeMarker(); updateInfo();
  }
  const center = (b: Building3dVisual): Point => {
    let x = 0, y = 0, n = 0; for (const s of b.footprint) for (const p of s.outer) { x += p.x; y += p.y; n++; }
    return n ? { x: x / n, y: y / n } : b.entrance ?? { x: 0, y: 0 };
  };
  /** Swap a realized exterior into the displayed batch in place, and back:
   * only the touched building sectors rebuild (Terrain3d.replaceBuildings);
   * relief, material tiles, bridges and walls stay as they are. */
  function slotOf(id: string): number {
    if (indexOf !== display) { displayIndex = new Map(display?.buildings.map((b, i) => [b.id, i])); indexOf = display; }
    return displayIndex.get(id) ?? -1;
  }
  function queueSwap(id: string, building: Building3dVisual): void {
    pendingSwaps.set(id, building);
    clearTimeout(detailTimer);
    detailTimer = setTimeout(() => {
      if (!terrain || !display) return;
      terrain.replaceBuildings([...pendingSwaps.values()]); pendingSwaps.clear(); updateInfo();
    }, 200);
  }
  function swapDetail(id: string, detail: PlacedBuilding): void {
    const i = slotOf(id);
    if (!display || i < 0) return;
    // Display volumes of compact plans carry lofted roofs: count by the source kind.
    if (!realized.has(display.buildings[i])) { display.kinds.compact--; display.kinds.detailed++; }
    realized.add(detail);
    display.buildings[i] = detail;
    queueSwap(id, detail);
  }
  /** An exterior the shared cache evicted goes back to its compact plan. */
  function restoreCompact(id: string): void {
    const i = slotOf(id), base = byId.get(id);
    if (!display || i < 0 || !base || !realized.has(display.buildings[i])) return;
    const compact = isBuildingProjection(base) ? base : compactBuilding(base);
    display.kinds.detailed--; display.kinds[city3dDisplayKind(base)]++;
    display.buildings[i] = compact;
    queueSwap(id, compact);
  }
  const timings: { engine?: number; surface?: number; plan?: number; buildings?: number } = {};
  let modules: Promise<[typeof import('../../../rust/bridge/architecture'), typeof import('../render/urbanBuildingDetails')]> | undefined;
  const detailModules = (): NonNullable<typeof modules> => modules ??= Promise.all([import('../../../rust/bridge/architecture'), import('../render/urbanBuildingDetails')]);
  /** Native exterior of compact plans, two at a time; the display swaps them in. */
  async function realize(ids: string[]): Promise<void> {
    // With the shared controller, demand comes from the camera and the selection.
    if (options.details) { driveDetails(); return; }
    const scene = sceneOf, epoch = sourceEpoch;
    // A projection is never a native realization input. Only the shared cold
    // loader/controller may resolve its actual retained record and archive.
    if (!scene || 'projection' in scene) return;
    const [{ realizeUrbanBuilding }, { nativeExteriorDetail }] = await detailModules();
    if (disposed || sceneOf !== scene || sourceEpoch !== epoch) return;
    const queue = ids.filter(id => !details.has(id) && !converting.has(id));
    for (const id of queue) converting.add(id);
    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        if (disposed || sourceEpoch !== epoch || sceneOf !== scene) { converting.delete(id); continue; }
        const base = byId.get(id);
        if (!base || isBuildingProjection(base) || city3dDisplayKind(base) !== 'compact') { converting.delete(id); continue; }
        try {
          const batch = await realizeUrbanBuilding(base, executionRuntime, false, scene);
          if (disposed || sourceEpoch !== epoch || !samePlan(byId.get(id), base)) continue;
          const detail = nativeExteriorDetail(base, batch).building; details.set(id, detail); detailBases.set(id, base);
          swapDetail(id, detail);
        } catch (e) { if (!disposed && sourceEpoch === epoch) info.dataset.detailError = String(e); }
        finally { converting.delete(id); }
      }
    };
    await Promise.all([worker(), worker()]);
    updateInfo();
  }
  function detailAround(): void {
    if (options.details) { driveDetails(); return; }
    const t = terrain, scene = sceneOf; if (!t || !scene || 'projection' in scene) return;
    const c = t.getCamera(), radius = Math.max(60, Math.min(250, c.distance * 0.6));
    const near = scene.buildings.filter(b => city3dDisplayKind(b) === 'compact' && !details.has(b.id)).map(b => ({ b, d: Math.hypot(center(b).x - c.x, center(b).y - c.y) }))
      .filter(e => e.d < radius).sort((a, b) => a.d - b.d).slice(0, 24).map(e => e.b.id);
    info.dataset.detailError = '';
    if (!near.length) { info.textContent = urbanText(['Aucun plan compact à détailler près du centre de la vue.', 'No compact plans to detail near the centre of the view.', '视图中心附近没有可细化的紧凑平面。', 'No hay planos compactos que detallar cerca del centro de la vista.', 'Não há plantas compactas para detalhar perto do centro da vista.']); return; }
    void realize(near);
  }

  // ------------------------------------------------------------ selection and info
  function placeMarker(): void {
    const t = terrain, id = options.getSelected?.(), b = id ? display?.buildings.find(x => x.id === id) : undefined;
    const p = b && active && t ? t.worldToScreen(center(b).x, center(b).y) : null;
    marker.hidden = !p || options.labels === false; if (p) { marker.style.left = `${p[0]}px`; marker.style.top = `${p[1]}px`; }
  }
  function updateInfo(): void {
    if (!active || error) return;
    const t = terrain, c = t?.getCamera(), k = display?.kinds, id = options.getSelected?.(), b = id ? display?.buildings.find(x => x.id === id) : undefined;
    const height = b ? building3dHeight(b) : 0;
    info.innerHTML = [
      softwareMaterial && ground !== 'map' ? urbanText(['Texture de terrain · WebGL logiciel, drapée sur le relief 3D.', 'Raster terrain texture · software WebGL, draped over the 3D terrain.', '地形纹理 · 软件 WebGL，覆盖在三维地形上。', 'Textura del terreno · WebGL por software, sobre el relieve 3D.', 'Textura do terreno · WebGL por software, sobre o relevo 3D.']) : '',
      display && display.buildings.length > bridgeStats.count + wallStats.pieces + quayCount ? `<b>${(display.buildings.length - bridgeStats.count - wallStats.pieces - quayCount).toLocaleString()}</b> ${urbanText(['bâtiments','buildings','栋建筑','edificios','edifícios'])}${bridgeStats.count ? ` · ${urbanText(['ponts','bridges','桥梁','puentes','pontes'])} ${bridgeStats.count}` : ''}${wallStats.count ? ` · ${urbanText(['enceintes','enclosures','围墙','recintos','muralhas'])} ${wallStats.count}` : ''} · ${urbanText(['silhouettes','silhouettes','轮廓','siluetas','silhuetas'])} ${k!.silhouette} · ${urbanText(['plans','plans','平面','planos','plantas'])} ${k!.compact} · ${urbanText(['détaillés','detailed','详细','detallados','detalhados'])} ${k!.detailed}${converting.size ? ` · ${urbanText(['réalisation','realizing','生成中','realizando','realizando'])} ${converting.size}…` : ''}` : urbanText(['Aucun bâtiment : tracez les silhouettes ou implantez les bâtiments.', 'No buildings: draw silhouettes or place buildings.', '没有建筑：请绘制轮廓或放置建筑。', 'Sin edificios: dibuja siluetas o coloca edificios.', 'Sem edifícios: desenhe silhuetas ou posicione edifícios.']),
      b ? `${urbanText(['Sélection','Selection','选择','Selección','Seleção'])} : ${b.id} · ${b.recipe_id} · ${height.toFixed(1)} m${isBuildingProjection(b) ? ` · ${urbanText(['volume cartographique','map volume','地图体量','volumen cartográfico','volume cartográfico'])}` : ''}` : '',
      c ? `${urbanText(['Distance','Distance','距离','Distancia','Distância'])} ${(c.distance).toFixed(0)} m · ${urbanText(['inclinaison','tilt','倾角','inclinación','inclinação'])} ${Math.round(c.pitch * 180 / Math.PI)}° · ${urbanText(['glisser : déplacer · clic droit / Maj : orbiter','drag: pan · right-click / Shift: orbit','拖动：平移 · 右键 / Shift：环绕','arrastrar: desplazar · clic derecho / Mayús: orbitar','arrastar: mover · clique direito / Shift: orbitar'])}` : '',
      info.dataset.detailError ? `${urbanText(['Réalisation','Realization','生成','Realización','Realização'])} : ${info.dataset.detailError}` : '',
      sceneOf && 'projection' in sceneOf && sceneOf.projection === 'native-parent-window-3d-1'
        ? `Fenêtre native : ${sceneOf.parents} parents · ${sceneOf.buildings.length} membres · ${sceneOf.complete ? 'complète' : `partielle (${sceneOf.reason})`} · volumes cartographiques · capacité inconnue` : '',
    ].filter(Boolean).join('<br>');
  }
  let down: [number, number] | undefined;
  canvas.addEventListener('pointerdown', event => { down = event.button === 0 ? [event.clientX, event.clientY] : undefined; });
  canvas.addEventListener('pointerup', event => {
    if (!down || !terrain || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4) { down = undefined; return; }
    down = undefined;
    const rect = canvas.getBoundingClientRect(), id = terrain.pickBuilding(event.clientX - rect.left, event.clientY - rect.top);
    if (!id) return;
    options.onSelect?.(id); placeMarker(); updateInfo();
    const source = byId.get(id);
    if (source && city3dDisplayKind(source) === 'compact') void realize([id]);
  });

  // ------------------------------------------------------------ controls
  function changedView(): void {
    options.onViewSettingsChange?.({ ground, plan: planOverlay, colors, exaggeration: terrain?.getCamera().exaggeration ?? Number($<HTMLInputElement>('[data-relief]').value), refinement });
  }
  function syncView(): void {
    const saved = options.getViewSettings?.(); if (!saved) return;
    if (saved.ground && Array.from($<HTMLSelectElement>('[data-ground]').options).some(option => option.value === saved.ground)) ground = saved.ground;
    if (saved.plan !== undefined) planOverlay = saved.plan;
    if (saved.colors) colors = saved.colors;
    if (saved.refinement) refinement = saved.refinement;
    $<HTMLSelectElement>('[data-ground]').value = ground; $<HTMLInputElement>('[data-plan]').checked = planOverlay;
    $<HTMLSelectElement>('[data-colors]').value = colors;
    if (options.materialGrounds) $<HTMLSelectElement>('[data-refinement]').value = refinement;
    const exaggeration = Math.max(1, Math.min(5, saved.exaggeration ?? terrain?.getCamera().exaggeration ?? 1));
    $<HTMLInputElement>('[data-relief]').value = String(exaggeration);
    if (terrain && terrain.getCamera().exaggeration !== exaggeration) terrain.setCamera({ ...terrain.getCamera(), exaggeration });
  }
  $<HTMLSelectElement>('[data-ground]').onchange = async event => {
    const control = event.target as HTMLSelectElement, next = control.value as Ground;
    const deferred = options.fastTerrain && !softwareMaterial && next !== 'map' && terrain?.getShaderProfile() === 'map';
    if (deferred) {
      control.disabled = true; root.setAttribute('aria-busy', 'true');
      info.textContent = urbanText(['Préparation des matériaux du sol procédural…', 'Preparing procedural ground materials…', '正在准备程序化地面材质…', 'Preparando materiales del suelo procedural…', 'Preparando materiais do solo procedural…']);
      // Paint the busy state before the optional driver shader compilation.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    try {
      if (disposed || !active) { control.value = ground; return; }
      ground = next; changedView(); applyGround();
    } catch (error) {
      ground = 'map'; control.value = ground; changedView(); applyGround(); info.dataset.detailError = String(error);
    } finally { control.disabled = false; root.removeAttribute('aria-busy'); updateInfo(); }
  };
  $<HTMLInputElement>('[data-plan]').onchange = event => { planOverlay = (event.target as HTMLInputElement).checked; changedView(); terrain?.invalidateTiles(); };
  const texturedBox = $<HTMLInputElement>('[data-textured]');
  texturedBox.closest('label')!.hidden = !options.setTextured;
  texturedBox.onchange = () => options.setTextured?.(texturedBox.checked);
  $<HTMLSelectElement>('[data-colors]').onchange = event => { colors = (event.target as HTMLSelectElement).value as Colors; changedView(); syncBuildings(); };
  $<HTMLInputElement>('[data-relief]').oninput = event => { if (terrain) terrain.setCamera({ ...terrain.getCamera(), exaggeration: Number((event.target as HTMLInputElement).value) }); changedView(); updateInfo(); };
  if (options.materialGrounds) $<HTMLSelectElement>('[data-refinement]').onchange = event => { refinement = (event.target as HTMLSelectElement).value as City3dViewSettings['refinement']; changedView(); applyGround(); };
  $<HTMLButtonElement>('[data-north]').onclick = () => { terrain?.north(); };
  $<HTMLButtonElement>('[data-detail]').onclick = detailAround;
  const resize = new ResizeObserver(() => { if (active) terrain?.resize(root.clientWidth, root.clientHeight); });
  resize.observe(root);

  function sync(): void {
    const t = terrain, d = options.getDecor(); if (!t || !d) return;
    syncView();
    let at = performance.now();
    const lap = (key: keyof typeof timings): void => { const now = performance.now(); timings[key] = Math.round(now - at); at = now; };
    if (d !== surfaceDecor) { setSurface(d); lap('surface'); } else syncImage(d);
    const surface = options.getSurface?.(); if (surface) t.setSurface(surface.height, surface.water, surface.waterVisible);
    const configured = options.getGroundSettings?.(ground), procedural = ground !== 'map' && !softwareMaterial && (!options.getGroundSettings || !!configured);
    if (groundKey !== JSON.stringify([ground, refinement, configured]) || procedural && waterDisplay !== options.getWaterDisplay?.()) applyGround();
    t.setHeightSampler(options.getHeightSampler?.());
    const forest = proceduralGround ? options.getForest?.() : undefined; t.setForest(forest?.field, forest?.occupation);
    const nextPlanKey = JSON.stringify([planOverlay, options.getPlanOptions?.()]);
    if (planKey !== nextPlanKey) { planKey = nextPlanKey; t.invalidateTiles(); }
    const layouts = options.getLayouts?.(), partitions = options.getPartitions?.();
    if (planOverlay && (!planOf ? layouts?.length : planOf[0] !== layouts || planOf[1] !== partitions)) { cityPlan(); t.invalidateTiles(); lap('plan'); }
    if (textured() !== texturedSeen) { texturedSeen = textured(); t.invalidateTiles(); } // the appearance below carries the flag
    $<HTMLInputElement>('[data-textured]').checked = texturedSeen;
    syncBuildings(); lap('buildings');
    if (!focused) {
      focused = true;
      const extent = plan?.extent, box = display?.buildings.length ? display.buildings.reduce((b, x) => { const p = center(x); return { minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }; }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }) : extent;
      if (box && Number.isFinite(box.minX)) api.focus({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, Math.max(box.maxX - box.minX, box.maxY - box.minY) / 2);
      else t.fit();
    }
  }
  const api: City3d = {
    get active() { return active; },
    show(): void {
      if (disposed) return;
      root.hidden = false; active = true;
      const started = performance.now(), t = ensureTerrain(); if (!t) return;
      timings.engine = timings.engine ?? Math.round(performance.now() - started);
      t.resize(root.clientWidth, root.clientHeight); t.setActive(true); sync(); canvas.focus({ preventScroll: true });
      // Load the realization modules before the first pick, not during busy frames.
      if (display?.kinds.compact && sceneOf && !('projection' in sceneOf) && !options.details) void detailModules().catch(() => { modules = undefined; });
      if (options.details) {
        options.details.setActiveView('3d');
        unsubscribeDetails ??= options.details.subscribe(applyServiceDetails);
        applyServiceDetails(); driveDetails();
      }
    },
    hide(): void {
      active = false; root.hidden = true; terrain?.setActive(false);
      cancelAnimationFrame(detailFrame); detailFrame = 0;
      unsubscribeDetails?.(); unsubscribeDetails = undefined; options.details?.setActiveView('2d');
    },
    refresh(): void { if (active) sync(); },
    focus(point: Point, radius = 150): void {
      const t = terrain; if (!t) return;
      const span = Math.max(120, 2.4 * radius), distance = span / (2 * Math.tan(TERRAIN_3D_FOV / 2));
      t.setCamera({ ...t.getCamera(), x: point.x, y: point.y, distance, pitch: 0.82 }); updateInfo();
    },
    getCamera: () => terrain?.getCamera(),
    setCamera(camera: Terrain3dCamera): void { terrain?.setCamera(camera); focused = true; },
    capture: () => terrain ? terrain.capture() : Promise.reject(new Error('Vue 3D inactive.')),
    captureIllustration: () => terrain ? terrain.captureIllustration() : Promise.reject(new Error('Vue 3D inactive.')),
    stats: () => ({ buildings: (display?.buildings.length ?? 0) - bridgeStats.count - wallStats.pieces - quayCount, ...(display?.kinds ?? { silhouette: 0, compact: 0, detailed: 0 }), displayMs, timings: { ...timings }, realizing: converting.size, realizeError: info.dataset.detailError || undefined, bridges: bridgeStats, walls: wallStats, lod: terrain?.getLodInfo(), parentWindow: sceneOf && 'projection' in sceneOf && sceneOf.projection === 'native-parent-window-3d-1' ? { complete: sceneOf.complete, reason: sceneOf.reason, parents: sceneOf.parents, members: sceneOf.buildings.length } : undefined }),
    dispose(): void { disposed = true; active = false; sourceEpoch++; clearTimeout(detailTimer); cancelAnimationFrame(detailFrame); unsubscribeDetails?.(); unsubscribeDetails = undefined; options.details?.setActiveView('2d'); window.removeEventListener('magna-locale-change', localizeControls); resize.disconnect(); terrain?.dispose(); terrain = undefined; root.remove(); },
  };
  // The initial status reads display/scene state declared above; initialise it
  // after those bindings exist (also when mounted lazily from the V2 app).
  localizeControls();
  return api;
}
