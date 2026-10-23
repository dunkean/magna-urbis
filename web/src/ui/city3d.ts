/** City Bench 3D view. Reuses the Terrain Bench engine (Terrain3d: quadtree
 * relief, tiled materials, orbit camera, native building pass with 256 m sectors,
 * overview LOD, bounded GPU cache and picking). This module only adapts the city
 * data: the .decor raster as relief, the 2D map image (or the Render3D ground
 * material) as texture, the city plan drawn into close-up tiles, and every
 * architecture mode as display volumes (render/city3dMeshes.ts). */
import { Terrain3d, TERRAIN_3D_FOV, type Terrain3dCamera, type Terrain3dTile } from './terrain3d';
import { city3dBridges, city3dScene, city3dProjectionScene, city3dWalls, city3dDisplayKind, compactBuilding, projectionDetailMatches, rasterHeight, type City3dHeight, type City3dDisplayScene } from '../render/city3dMeshes';
import { building3dHeight, isBuildingProjection, type Building3dVisual } from '../render/urbanBuildingGeometry';
import type { NativeBuildingProjectionScene } from './urbanBuildingProjection';
import { buildCityScene, drawCity, selectCityLod, type CityLayers, type CityScene } from '../render/cityCanvas';
import { DEFAULT_TERRAIN_LIGHTING } from '../render/terrainLighting';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { Layout, Partition, Street } from '../../../rust/bridge/urban';
import type { Point } from '../../../rust/bridge/housesContract';
import type { Decor } from './decor';
import { executionRuntime } from './executionProfile';

export interface City3dOptions {
  /** Positioned container (the bench viewport); the 3D view covers it when shown. */
  host: HTMLElement;
  getDecor(): Decor | undefined;
  getScene(): PlacementBatch | undefined;
  /** Exact accepted-plan cartography with native records retained cold. Takes
   * precedence over the legacy scene, including an explicitly empty index. */
  getProjection?(): NativeBuildingProjectionScene | undefined;
  getLayouts?(): readonly Layout[] | undefined;
  /** Regional roads crossing the map: their bridges are drawn too. */
  getRegionalStreets?(): readonly Street[] | undefined;
  getPartitions?(): readonly Partition[] | undefined;
  getSelected?(): string | undefined;
  /** URL of the 2D map image; default `decors/<id>.png` (or the parent decor's). */
  getBackground?(): string | undefined;
  onSelect?(id: string): void;
  onCamera?(camera: Terrain3dCamera): void;
  /** Shared native detail controller (Codex `urban.buildingDetails`): one queue and
   * bounded cache for 2D and 3D. When given, the 3D view never realizes on its own. */
  details?: City3dDetailService;
}
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
  stats(): City3dStats;
  dispose(): void;
}
export interface City3dStats { buildings: number; silhouette: number; compact: number; detailed: number; displayMs: number; timings: { engine?: number; surface?: number; plan?: number; buildings?: number }; realizing: number; realizeError?: string; bridges?: { count: number; first?: Point }; walls?: City3dWallStats; lod?: ReturnType<Terrain3d['getLodInfo']> }

/** Fortification display volumes: enclosures drawn, pieces (curtain chunks, towers, gates, works), triangles. */
export interface City3dWallStats { count: number; pieces: number; triangles: number; ms: number; first?: Point; gate?: Point }

type Ground = 'map' | 'render';
type Colors = 'materials' | 'uses';
const CLIMATES: Record<string, { temperature: number; precipitation: number }> = {
  temperate: { temperature: 18, precipitation: 1000 }, oceanic: { temperature: 11, precipitation: 1300 }, mediterranean: { temperature: 16, precipitation: 600 },
  arid: { temperature: 23, precipitation: 150 }, cold: { temperature: 1, precipitation: 550 }, tropical: { temperature: 26, precipitation: 2300 },
};
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
      <label>Couleurs <select data-colors><option value="materials">Matériaux</option><option value="uses">Usages</option></select></label>
      <label title="Exagération du relief">Relief <input type="range" data-relief min="1" max="5" step="0.5" value="1"></label>
      <button type="button" data-north title="Nord en haut">N</button>
      <button type="button" data-detail title="Réaliser en natif les plans compacts proches du centre de la vue">Détailler autour</button>
    </div>
    <div class="city3d-marker" hidden></div>
    <div class="city3d-info" role="status"></div>`;
  options.host.append(root);
  const canvas = root.querySelector('canvas')!, marker = root.querySelector<HTMLElement>('.city3d-marker')!, info = root.querySelector<HTMLElement>('.city3d-info')!;
  const $ = <T extends HTMLElement>(selector: string): T => root.querySelector(selector) as T;
  let terrain: Terrain3d | undefined, active = false, disposed = false, error = '';
  let ground: Ground = 'map', colors: Colors = 'materials', planOverlay = true;
  let surfaceDecor: Decor | undefined, imageUrl: string | undefined, heightAt: City3dHeight | undefined, image: HTMLImageElement | HTMLCanvasElement | undefined, waterMask: HTMLCanvasElement | undefined, waterPaths: Path2D | undefined;
  let plan: CityScene | undefined, planOf: [unknown, unknown] | undefined;
  let sceneOf: PlacementBatch | NativeBuildingProjectionScene | undefined, display: City3dDisplayScene | undefined, displayMs = 0, focused = false, sourceEpoch = 0;
  const details = new Map<string, PlacedBuilding>(), detailBases = new Map<string, Building3dVisual>(), converting = new Set<string>();
  let byId = new Map<string, Building3dVisual>(), bridgesOf: [readonly Layout[] | undefined, readonly Street[] | undefined] = [undefined, undefined], bridgeStats: { count: number; first?: Point } = { count: 0 };
  let wallStats: City3dWallStats = { count: 0, pieces: 0, triangles: 0, ms: 0 };
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
    }, () => placeMarker()); }
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
  function water(d: Decor): HTMLCanvasElement {
    const { n, water } = d.raster, c = document.createElement('canvas'); c.width = c.height = n;
    const ctx = c.getContext('2d')!, pixels = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) if (water[i]) pixels.data.set([...WATER, 255], i * 4);
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
    surfaceDecor = d; heightAt = rasterHeight(r.height, r.n, r.width); sceneOf = undefined; sourceEpoch++; details.clear(); detailBases.clear();
    waterMask = undefined; waterPaths = undefined; image = undefined;
    t.setSurface({ x: 0, y: 0, width: r.width, n: r.n, data: r.height });
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
    if (ground === 'render') {
      waterMask ??= water(d); waterPaths ??= waterPath(d);
      const climate = CLIMATES[d.meta.tags.climate ?? ''] ?? CLIMATES.temperate;
      t.setGroundMaterial({ seed: seedHash(d.meta.seed), climate, sourceCell: d.meta.terrainDisplay?.sourceCell ?? d.raster.width / 1024, lighting: DEFAULT_TERRAIN_LIGHTING, displacement: false });
      t.setTexture(waterMask);
    } else {
      t.setGroundMaterial(undefined);
      t.setTexture(image ?? hillshade(d));
    }
    t.setTileLoader(loadTile);
  }
  /** One material tile: the map image (or water) cropped, then the city plan when close. */
  async function loadTile(tile: Terrain3dTile): Promise<TexImageSource> {
    const d = surfaceDecor!, size = tile.pixels, c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d')!, width = d.raster.width;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const source = ground === 'render' ? waterMask : image;
    if (source) { const k = source.width / width; ctx.drawImage(source, tile.x * k, tile.y * k, tile.width * k, tile.width * k, 0, 0, size, size); }
    const k = size / tile.width, mpp = tile.width / size;
    if (ground === 'render' && waterPaths) { ctx.save(); ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k); ctx.fillStyle = `rgb(${WATER})`; ctx.fill(waterPaths, 'evenodd'); ctx.restore(); }
    const city = planOverlay ? cityPlan() : undefined;
    if (city && mpp < 4 && city.extent.maxX >= tile.x && city.extent.minX <= tile.x + tile.width && city.extent.maxY >= tile.y && city.extent.minY <= tile.y + tile.width) {
      ctx.save(); ctx.setTransform(k, 0, 0, k, -tile.x * k, -tile.y * k);
      drawCity(ctx, city, { viewport: { minX: tile.x, minY: tile.y, maxX: tile.x + tile.width, maxY: tile.y + tile.width }, mpp, dpr: 1, lod: selectCityLod(mpp),
        view: 'parcels', palette: 'terrain', width: 0.6, layers: PLAN_LAYERS, buildingsVisible: false, appearance: { style: 'cartographic', diagnostic: 'none' } });
      ctx.restore();
    }
    return c;
  }
  function cityPlan(): CityScene | undefined {
    const layouts = options.getLayouts?.(), partitions = options.getPartitions?.();
    if (!layouts?.length) return plan = undefined;
    if (!planOf || planOf[0] !== layouts || planOf[1] !== partitions) { plan = buildCityScene(layouts, partitions ?? []); planOf = [layouts, partitions]; }
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
      display = scene ? 'projection' in scene ? city3dProjectionScene(scene, { details }) : city3dScene(scene, { heightAt, details }) : undefined;
      // Bridges stand over the water even before any building is placed.
      const bridges = city3dBridges([...(layouts ?? []).flatMap(l => l.streets), ...(regional ?? [])], heightAt);
      bridgeStats = { count: bridges.length, first: bridges[0] && center(bridges[0]) };
      // Walls, towers and gates stand before any building is placed, like bridges.
      const wallStarted = performance.now();
      const walls = (layouts ?? []).flatMap((l, li) => city3dWalls(l.enclosures ?? [], heightAt, String(li)));
      const enclosures = new Set(walls.map(w => w.id.split(':').slice(1, 3).join(':')));
      const gate = walls.find(w => w.id.includes(':gate:') && !w.variant_id.endsWith(':water'));
      wallStats = { count: enclosures.size, pieces: walls.length, ms: Math.round(performance.now() - wallStarted),
        triangles: walls.reduce((n, w) => n + w.volumes.reduce((m, v) => m + v.roof_mesh.faces.reduce((k, f) => k + f.vertices.length - 2, 0), 0), 0),
        first: walls[0] && center(walls[0]), gate: gate && center(gate) };
      const extra = [...bridges, ...walls];
      if (extra.length) display = display ? { ...display, buildings: [...display.buildings, ...extra],
        ...(display.occupationBuildings ? { occupationBuildings: [...display.occupationBuildings, ...extra] } : {}) }
        : { materials: city3dScene({ schema_version: '1', generator_version: '', buildings: [], refusals: [], open_spaces: [] }).materials, buildings: extra, kinds: { silhouette: 0, compact: 0, detailed: 0 } };
      displayMs = performance.now() - started;
    }
    t.setBuildings(display, { style: 'cartographic', diagnostic: colors === 'uses' ? 'uses' : 'none' }, true);
    ($('[data-detail]') as HTMLButtonElement).disabled = !display?.kinds.compact || !!scene && 'projection' in scene && !options.details;
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
    if (!near.length) { info.textContent = 'Aucun plan compact à détailler près du centre de la vue.'; return; }
    void realize(near);
  }

  // ------------------------------------------------------------ selection and info
  function placeMarker(): void {
    const t = terrain, id = options.getSelected?.(), b = id ? display?.buildings.find(x => x.id === id) : undefined;
    const p = b && active && t ? t.worldToScreen(center(b).x, center(b).y) : null;
    marker.hidden = !p; if (p) { marker.style.left = `${p[0]}px`; marker.style.top = `${p[1]}px`; }
  }
  function updateInfo(): void {
    if (!active || error) return;
    const t = terrain, c = t?.getCamera(), k = display?.kinds, id = options.getSelected?.(), b = id ? display?.buildings.find(x => x.id === id) : undefined;
    const height = b ? building3dHeight(b) : 0;
    info.innerHTML = [
      display && display.buildings.length > bridgeStats.count + wallStats.pieces ? `<b>${(display.buildings.length - bridgeStats.count - wallStats.pieces).toLocaleString('fr-FR')}</b> bâtiments${bridgeStats.count ? ` · ponts ${bridgeStats.count}` : ''}${wallStats.count ? ` · enceintes ${wallStats.count}` : ''} · silhouettes ${k!.silhouette} · plans ${k!.compact} · détaillés ${k!.detailed}${converting.size ? ` · réalisation ${converting.size}…` : ''}` : 'Aucun bâtiment : tracez les silhouettes ou implantez les bâtiments.',
      b ? `Sélection : ${b.id} · ${b.recipe_id} · ${height.toFixed(1)} m${isBuildingProjection(b) ? ' · volume cartographique' : ''}` : '',
      c ? `Distance ${(c.distance).toFixed(0)} m · inclinaison ${Math.round(c.pitch * 180 / Math.PI)}° · glisser : déplacer · clic droit / Maj : orbiter` : '',
      info.dataset.detailError ? `Réalisation : ${info.dataset.detailError}` : '',
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
  $<HTMLSelectElement>('[data-ground]').onchange = event => { ground = (event.target as HTMLSelectElement).value as Ground; applyGround(); };
  $<HTMLInputElement>('[data-plan]').onchange = event => { planOverlay = (event.target as HTMLInputElement).checked; terrain?.invalidateTiles(); };
  $<HTMLSelectElement>('[data-colors]').onchange = event => { colors = (event.target as HTMLSelectElement).value as Colors; syncBuildings(); };
  $<HTMLInputElement>('[data-relief]').oninput = event => { if (terrain) terrain.setCamera({ ...terrain.getCamera(), exaggeration: Number((event.target as HTMLInputElement).value) }); updateInfo(); };
  $<HTMLButtonElement>('[data-north]').onclick = () => { terrain?.north(); };
  $<HTMLButtonElement>('[data-detail]').onclick = detailAround;
  const resize = new ResizeObserver(() => { if (active) terrain?.resize(root.clientWidth, root.clientHeight); });
  resize.observe(root);

  function sync(): void {
    const t = terrain, d = options.getDecor(); if (!t || !d) return;
    let at = performance.now();
    const lap = (key: keyof typeof timings): void => { const now = performance.now(); timings[key] = Math.round(now - at); at = now; };
    if (d !== surfaceDecor) { setSurface(d); lap('surface'); } else syncImage(d);
    const layouts = options.getLayouts?.(), partitions = options.getPartitions?.();
    if (planOverlay && (!planOf ? layouts?.length : planOf[0] !== layouts || planOf[1] !== partitions)) { cityPlan(); t.invalidateTiles(); lap('plan'); }
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
    stats: () => ({ buildings: (display?.buildings.length ?? 0) - bridgeStats.count - wallStats.pieces, ...(display?.kinds ?? { silhouette: 0, compact: 0, detailed: 0 }), displayMs, timings: { ...timings }, realizing: converting.size, realizeError: info.dataset.detailError || undefined, bridges: bridgeStats, walls: wallStats, lod: terrain?.getLodInfo() }),
    dispose(): void { disposed = true; active = false; sourceEpoch++; clearTimeout(detailTimer); cancelAnimationFrame(detailFrame); unsubscribeDetails?.(); unsubscribeDetails = undefined; options.details?.setActiveView('2d'); resize.disconnect(); terrain?.dispose(); terrain = undefined; root.remove(); },
  };
  return api;
}
