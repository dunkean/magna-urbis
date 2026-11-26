/** Minimal map: retained Canvas batches at rest and an optional single-pass GPU contour layer during motion. */
import type { World, UrbanLayer } from '../gen/types';
import type { Shape } from '../../../rust/bridge/urban';
import { buildMinimalGeometry, emptyMinimalGeometry, bakeMinimalRelief, paintMinimalMap, minimalWaterPolygons, type MinimalFeature, type MinimalGeometry, type MinimalPlace, type MinimalTextLayout } from '../render/minimalMap';
import { renderScene, revisionOf, type RenderScene } from './renderScene';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import type { V2Settings } from './contracts';
import type { View } from '../render/view';
import type { ExportLayers } from '../render/exportLayers';
import { retainedMinimalContours } from './minimalContourCache';
import type { MinimalContourSet } from '../render/minimalContours';
import { createMinimalContourPainter, type MinimalContourPainter } from '../render/minimalContourPainter';
import type { RenderReadiness } from '../render/renderReadiness';

const LIVE_DEFER_MS = 40,
  LIVE_SETTLE_MS = 160,
  SLICE_MS = 8;
/** A paint whose next animation frame comes later than this was too heavy for the graphics process to show in time,
 * however short its Canvas calls were. The 20 ms bound allows one 60 Hz frame plus submission slack; after `SLOW_PAINTS` of them in a row a moving view follows as a bitmap. */
const SLOW_PAINT_MS = 20,
  SLOW_PAINTS = 2;
const polygon = (layer: string, shape: Shape): MinimalFeature => ({ layer, points: shape.outer, holes: shape.holes, closed: true });

/** Adapts only retained products. No city renderer, roof builder, naming engine or display worker. */
export function* minimalFeatures(world: World, scene: RenderScene): Generator<MinimalFeature> {
  for (const area of world.landuse?.areas ?? []) yield { layer: area.kind, points: area.poly, holes: area.holes, closed: true };
  // These are the projection's retained coast/lake rings, already derived from native water at generation time.
  yield* minimalWaterPolygons([...world.terrain.coastline, ...(world.terrain.islands ?? []), ...world.terrain.lakes]);
  for (const river of world.terrain.rivers)
    for (let i = 1; i < river.path.length; i++) {
      const a = river.path[i - 1],
        b = river.path[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      if (!length) continue;
      const w0 = Math.max(0.5, river.width[i - 1] ?? 1) / 2,
        w1 = Math.max(0.5, river.width[i] ?? w0 * 2) / 2;
      yield {
        layer: 'river',
        closed: true,
        points: [
          { x: a.x - (dy / length) * w0, y: a.y + (dx / length) * w0 },
          { x: b.x - (dy / length) * w1, y: b.y + (dx / length) * w1 },
          { x: b.x + (dy / length) * w1, y: b.y - (dx / length) * w1 },
          { x: a.x + (dy / length) * w0, y: a.y - (dx / length) * w0 },
        ],
      };
    }
  // Town streets the road editor exposes as roads (`urban`) are drawn once, as the streets of their layout.
  for (const road of world.roads ?? []) if (!road.urban) for (let i = 1; i < road.path.length; i++) yield { layer: road.kind === 'track' ? 'path' : road.kind, points: [road.path[i - 1], road.path[i]] };
  const nativeKeys = new Set(Object.keys(scene.cityByKey));
  for (const city of scene.cities) {
    for (const layout of city.layouts) {
      for (const block of layout.blocks) if (block.kind !== 'deleted') yield polygon('block', block.shape);
      for (const quarter of layout.quarters) yield polygon('quarter', quarter.shape);
      for (const street of layout.streets) for (let i = 1; i < street.path.length; i++) yield { layer: street.rank <= 1 ? 'streetMajor' : 'streetMinor', points: [street.path[i - 1], street.path[i]] };
      for (const wall of layout.enclosures ?? []) yield { layer: 'wall', points: wall.path, closed: true };
      for (const waterway of layout.structure?.waterways ?? []) {
        yield polygon('water', waterway.shape);
        for (const bridge of waterway.crossings) yield polygon('bridge', bridge);
      }
    }
    const landmarkParcels = new Set(city.sites?.filter(site => site.programme?.landmark).map(site => site.parcel_id));
    if (city.scene?.buildings.length) {
      for (const building of city.scene.buildings) for (const shape of building.footprint) yield polygon(landmarkParcels.has(building.parcel_id) || (building as typeof building & { programme?: { landmark?: boolean } }).programme?.landmark ? 'landmark' : 'building', shape);
    } else for (const site of city.sites ?? []) if (site.function !== 'open_space') for (const shape of site.surface) yield polygon(site.programme?.landmark ? 'landmark' : 'building', shape);
  }
  function* urbanFeatures(urban: UrbanLayer): Generator<MinimalFeature> {
    for (const block of urban.blocks) yield { layer: 'block', points: block, closed: true };
    for (const street of urban.streets) for (let i = 1; i < street.path.length; i++) yield { layer: street.rank <= 1 ? 'streetMajor' : 'streetMinor', points: [street.path[i - 1], street.path[i]] };
    for (const building of urban.buildings) yield { layer: 'building', points: building.poly, holes: building.courtyards, closed: true };
    for (const landmark of urban.landmarks) yield { layer: 'landmark', points: landmark.poly, closed: true };
    for (const wall of urban.walls ?? []) for (const points of wall.pieces ?? [wall.path]) yield { layer: 'wall', points, closed: !wall.pieces && wall.closed };
  }
  if (!scene.cities.length && world.urban) yield* urbanFeatures(world.urban);
  for (const place of world.settlements ?? []) if (!nativeKeys.has(place.key) && place.urban && place.urban !== world.urban) yield* urbanFeatures(place.urban);
  for (const farm of world.landuse?.farmsteads ?? []) for (const building of farm.buildings ?? []) yield { layer: 'building', points: building, closed: true };
}
interface Frame {
  view: View;
  w: number;
  h: number;
  dpr: number;
}
const same = (a: Frame, b: Frame): boolean => a.w === b.w && a.h === b.h && a.dpr === b.dpr && a.view.cx === b.view.cx && a.view.cy === b.view.cy && a.view.scale === b.view.scale;

/** The V2's independent Canvas 2D path. Only a full paint visits the retained cell batches. */
export class MinimalRenderer {
  readonly element = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private geometry?: MinimalGeometry;
  private key = '';
  private terrainKey = -1;
  private relief?: HTMLCanvasElement;
  /** Contour lines of the current terrain: traced once, when first asked for. */
  private contours?: MinimalContourSet;
  private contourPainter?: MinimalContourPainter | null;
  private resolved?: ResolvedAppearance;
  private places: MinimalPlace[] = [];
  private textLayout: MinimalTextLayout = { labels: [] };
  private layers: Partial<ExportLayers> = {};
  private work: Promise<void> = Promise.resolve();
  private serial = 0;
  private disposed = false;
  private dirty = true;
  private requested?: Frame;
  private painted?: Frame;
  private timer?: ReturnType<typeof setTimeout>;
  private lastMove = 0;
  /** Recent paints shown late (0 to SLOW_PAINTS), and whether a moving view therefore follows as a transformed bitmap. */
  private slowPaints = 0;
  private slowLive = false;
  /** Scale at which the view started to follow as a bitmap: it paints live again a factor of two away (a far view
   * shows fewer, simpler features) or on new content. */
  private slowScale = 0;
  private readiness?: RenderReadiness;
  readonly stats = { renderer: 'minimal', frameMs: 0, geometryBuildMs: 0, features: 0 };
  constructor(private invalidate: () => void) {
    this.element.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;background:#f4f1ea';
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0';
    this.element.append(this.canvas);
  }
  async set(world: World, settings: V2Settings, resolved: ResolvedAppearance, layers: Partial<ExportLayers> = {}, readiness?: RenderReadiness): Promise<void> {
    this.resolved = resolved;
    this.layers = layers;
    this.readiness = readiness;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    const scene = renderScene(world, settings),
      v = scene.revisions;
    const key = JSON.stringify([v.terrain, v.roads, v.landuse, v.settlements, v.cities, revisionOf(world.urban), world.mapSize, world.stats['v2.cityOutput'], world.stats['v2.waterEditRevision']]);
    const serial = ++this.serial;
    this.work = (async () => {
      if (key !== this.key) {
        const geometry = emptyMinimalGeometry(world.mapSize);
        const steps = buildMinimalGeometry(world.mapSize, minimalFeatures(world, scene), geometry);
        const ms = await this.slices(steps, serial);
        if (serial !== this.serial || this.disposed) return;
        geometry.buildMs = ms;
        this.geometry = geometry;
        this.key = key;
        this.stats.geometryBuildMs = ms;
        this.stats.features = geometry.features;
      }
      if (this.terrainKey !== scene.revisions.terrain) {
        this.relief = undefined;
        this.contours = undefined;
        this.terrainKey = scene.revisions.terrain;
      }
      if (layers.terrain !== false && resolved.composition.recipe.ground.contours && !this.contours) {
        const terrain = scene.terrain;
        if (this.contourPainter === undefined) this.contourPainter = createMinimalContourPainter() ?? null;
        const contours = await retainedMinimalContours({ data: terrain.height, n: terrain.resolution, width: world.mapSize, maxHeight: terrain.maxHeight }, !!this.contourPainter);
        if (serial !== this.serial || this.disposed) return;
        this.contours = contours;
        this.contourPainter?.set(contours);
      }
      if (layers.terrain !== false && resolved.composition.recipe.effects.relief && !this.relief) {
        const terrain = scene.terrain,
          canvas = document.createElement('canvas');
        await this.slices(bakeMinimalRelief({ data: terrain.height, n: terrain.resolution, width: terrain.width, maxHeight: terrain.maxHeight }, canvas), serial);
        if (serial !== this.serial || this.disposed) return;
        this.relief = canvas;
      }
      // Names are already part of the product. Never invoke name generation or presentation engines.
      const names = new Map(world.names?.entries.filter(e => e.id.startsWith('settlement:')).map(e => [e.id.slice(11), e.text]));
      this.places = (world.settlements ?? [])
        .map(place => ({ ...(place.core ?? place.center), name: names.get(place.key) ?? place.name ?? (place.main ? world.names?.town : '') ?? '', population: place.population }))
        .filter(place => !!place.name)
        .sort((a, b) => b.population - a.population);
      if (!this.places.length && world.names?.town && world.site) this.places = [{ ...world.site.center, name: world.names.town, population: 1 }];
      this.textLayout.labels = [];
      readiness?.mark('fields-ready');
    })();
    await this.work;
  }
  private async slices(steps: Generator<void>, serial: number): Promise<number> {
    let total = 0,
      done = false;
    while (!done && !this.disposed && serial === this.serial) {
      const start = performance.now();
      do {
        done = !!steps.next().done;
      } while (!done && performance.now() - start < SLICE_MS);
      total += performance.now() - start;
      if (!done) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (!done) steps.return(undefined);
    return total;
  }
  drawLive(view: View, w: number, h: number, dpr: number): void {
    const frame = { view: { ...view }, w, h, dpr: Math.min(dpr, 1.5) },
      now = performance.now();
    const moving = !!this.requested && !same(frame, this.requested);
    if (moving) this.lastMove = now;
    this.requested = frame;
    if (!this.dirty && this.painted && same(frame, this.painted)) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.slowLive && (this.dirty || view.scale > this.slowScale * 2 || view.scale < this.slowScale / 2)) {
      this.slowLive = false;
      this.slowPaints = 0;
    }
    if (!this.dirty && moving && this.painted && this.painted.w === w && this.painted.h === h && (this.slowLive || this.stats.frameMs > 1000 / 60)) {
      const old = this.painted.view,
        ratio = view.scale / old.scale;
      const x = w / 2 + (old.cx - view.cx) * view.scale - (w / 2) * ratio;
      const y = h / 2 + (old.cy - view.cy) * view.scale - (h / 2) * ratio;
      this.canvas.style.transform = `translate(${x}px,${y}px) scale(${ratio})`;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.paint(frame, true);
        this.invalidate();
      }, LIVE_SETTLE_MS);
      return;
    }
    const resting = this.dirty || now - this.lastMove >= LIVE_SETTLE_MS;
    this.paint(frame, resting);
    if (!resting)
      this.timer = setTimeout(
        () => {
          this.timer = undefined;
          this.paint(frame, true);
          this.invalidate();
        },
        Math.max(LIVE_DEFER_MS, LIVE_SETTLE_MS - (now - this.lastMove)),
      );
  }
  private paint(frame: Frame, layoutText: boolean): void {
    if (!this.geometry || !this.resolved || this.disposed) return;
    const { w, h, dpr, view } = frame,
      width = Math.max(1, Math.round(w * dpr)),
      height = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.style.transform = '';
    this.stats.frameMs = paintMinimalMap(this.canvas.getContext('2d')!, this.geometry, {
      view,
      width: w,
      height: h,
      dpr,
      recipe: this.resolved.composition.recipe,
      plan: this.resolved.composition.buildings,
      places: this.places,
      textLayout: this.textLayout,
      layoutText,
      relief: this.relief,
      contours: this.contours?.exact,
      contourRaster: !layoutText && this.resolved.composition.recipe.ground.contours && this.layers.terrain !== false ? this.contourPainter?.draw(view, w, h, dpr) : undefined,
      layers: this.layers,
    });
    this.painted = frame;
    this.dirty = false;
    // The Canvas calls return before the graphics process has drawn them: on a large map each takes several display
    // frames to show although `frameMs` stays short. The delay of the next animation frame tells.
    if (typeof requestAnimationFrame === 'function') {
      const started = performance.now();
      requestAnimationFrame(() => {
        this.slowPaints = performance.now() - started > SLOW_PAINT_MS ? this.slowPaints + 1 : 0;
        if (this.slowPaints >= SLOW_PAINTS && !this.slowLive) {
          this.slowLive = true;
          this.slowScale = frame.view.scale;
        }
      });
    }
    this.readiness?.mark('first-useful-frame');
    this.readiness?.mark('first-covered-frame');
    this.readiness?.mark('visible-complete');
  }
  drawMini(size: number): HTMLCanvasElement {
    return this.captureCanvas(size);
  }
  private captureCanvas(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    if (this.geometry && this.resolved)
      paintMinimalMap(canvas.getContext('2d')!, this.geometry, {
        view: { cx: this.geometry.size / 2, cy: this.geometry.size / 2, scale: size / this.geometry.size },
        width: size,
        height: size,
        dpr: 1,
        recipe: this.resolved.composition.recipe,
        plan: this.resolved.composition.buildings,
        places: this.places,
        textLayout: { labels: [] },
        relief: this.relief,
        contours: this.contours?.exact,
        layers: this.layers,
      });
    return canvas;
  }
  async capture(size: number): Promise<HTMLCanvasElement> {
    await this.work;
    return this.captureCanvas(size);
  }
  async settled(): Promise<void> {
    await this.work;
    this.prepareCapture();
  }
  prepareCapture(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.requested) {
      this.paint(this.requested, true);
      this.invalidate();
    }
  }
  dispose(): void {
    this.disposed = true;
    this.serial++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.geometry = undefined;
    this.relief = undefined;
    this.contours = undefined;
    this.contourPainter?.dispose();
    this.canvas.width = this.canvas.height = 0;
    this.element.remove();
  }
}
