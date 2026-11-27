/**
 * The towns of the map: the native city map (v2/nativeCityMap.ts: plans and houses of every town) and the hooks the
 * exact town renderer calls while it paints (urban semantics under the buildings, the rivers put back over the town
 * ground, the bridge decks kept above them).
 *
 * Holds the city pass of `set()`. The city map is shared with the export renderers of the page (SharedPassResources).
 */
import type { World } from '../../gen/types';
import type { ExportLayers } from '../../render/exportLayers';
import { riverCapsules, riverSegmentsInBox } from '../../render/riverCapsules';
import { createNativeCityMapAsync, type NativeCityHooks, type NativeCityMap, type NativeCityMapStats } from '../nativeCityMap';
import { drawUrbanSemantic } from '../../render/semanticLayer';
import type { CityScene } from '../../render/cityCanvas';
import type { View } from '../../render/view';
import { volumeTownBuildings } from '../../render/cityDrawOptions';
import type { DisplayParts, SemanticState, Town, TownPaint, WorldBox } from './contract';
import type { MapState } from './mapState';

/** Street roles that cross water above it (bridges, fords, causeways, piers, boardwalks). */
const CROSSING_ROLES = new Set(['bridge', 'ford', 'causeway', 'pier', 'boardwalk', 'walkway']);

export class TownProducts implements Town {
  city?: NativeCityMap;
  streetFilter?: (street: Pick<CityScene['streets'][number], 'role'>) => boolean;
  private exportCity?: NativeCityMap;
  /** The paint being made, or the last one made: the hooks of a stepwise paint are also called after `draw` returned. */
  private painting: TownPaint & { canvas?: HTMLCanvasElement } = {};

  constructor(
    private readonly map: MapState,
    private readonly parts: Pick<DisplayParts, 'water'>,
    /** The semantic land-use state of the cartography (the urban looks are painted under the buildings). */
    private readonly semantic: () => SemanticState | undefined,
  ) {}

  draw(ctx: CanvasRenderingContext2D, view: View, w: number, h: number, dpr: number, paint: TownPaint): NativeCityMapStats | undefined {
    this.painting = { ...paint, canvas: ctx.canvas };
    return this.city?.draw(ctx, view, w, h, dpr, this.map.resolved!, this.shownLayers(), this.hooks, paint.stepwise, paint.planOnly);
  }
  /** The city plan on WebGL2 is uploaded before a synchronous paint. */
  async prepare(): Promise<void> {
    if (this.map.canvasSatellite) return;
    await this.city?.prepare(this.map.resolved!, this.shownLayers());
  }
  private paintUrban(ctx: CanvasRenderingContext2D, scene: CityScene, frame: { viewport: { minX: number; minY: number; maxX: number; maxY: number }; mpp: number }): void {
    const s = this.semantic();
    if (s && s.urban !== 'off') drawUrbanSemantic(ctx, [scene], { look: s.urban, opacity: s.opacity, mpp: frame.mpp, viewport: frame.viewport });
  }
  private readonly hooks: NativeCityHooks = { renderOnCanvas: () => this.map.canvasSatellite, beforeBuildings: (ctx, scene, frame) => this.paintUrban(ctx, scene, frame), water: () => this.parts.water.cityWater, waterAbove: (ctx, box, over) => this.waterAbove(ctx, box, over) };
  private cityWaterPath?: { source: Float32Array; paths: Map<string, Path2D> };
  private crossingHolesOf?: { world: World; scenes: readonly CityScene[]; path: Path2D };
  /** The whole map with a hole per bridge, ford or causeway deck (regional bridges and the towns' crossings), for an
   * even-odd clip. */
  private crossingHoles(): Path2D {
    const world = this.map.world!,
      scenes = this.city?.scenes() ?? [];
    if (this.crossingHolesOf?.world === world && this.crossingHolesOf.scenes === scenes) return this.crossingHolesOf.path;
    const size = world.mapSize,
      path = new Path2D();
    path.rect(-size, -size, 3 * size, 3 * size);
    const deck = (a: { x: number; y: number }, b: { x: number; y: number }, width: number): void => {
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l < 1e-6) return;
      const h = width / 2 + 1,
        nx = (-(b.y - a.y) / l) * h,
        ny = ((b.x - a.x) / l) * h,
        ux = ((b.x - a.x) / l) * 2,
        uy = ((b.y - a.y) / l) * 2;
      path.moveTo(a.x - ux + nx, a.y - uy + ny);
      path.lineTo(b.x + ux + nx, b.y + uy + ny);
      path.lineTo(b.x + ux - nx, b.y + uy - ny);
      path.lineTo(a.x - ux - nx, a.y - uy - ny);
      path.closePath();
    };
    for (const bridge of world.bridges ?? []) deck(bridge.a, bridge.b, bridge.width);
    for (const scene of scenes)
      for (const s of scene.streets) {
        if (!CROSSING_ROLES.has(s.role) || s.street.path.length < 2) continue;
        deck(s.street.path[0], s.street.path[s.street.path.length - 1], s.width);
      }
    this.crossingHolesOf = { world, scenes, path };
    return path;
  }
  /** Puts the river back over the town ground and streets (Canvas 2D town): the ground is redrawn inside the river
   * capsules when it lies in this canvas, else the town's own pixels there are cleared to show the GPU ground below. */
  private waterAbove(ctx: CanvasRenderingContext2D, box: WorldBox, over?: () => void): void {
    const rivers = this.parts.water.cityWater;
    if (!rivers || typeof Path2D === 'undefined') return;
    // Only the rivers around this town: the whole network as one clip path per town and frame froze the map for
    // tens of seconds on 40 km maps. The box is snapped outwards so small view changes reuse the path.
    if (this.cityWaterPath?.source !== rivers || this.cityWaterPath.paths.size > 64) this.cityWaterPath = { source: rivers, paths: new Map() };
    const snap = 256,
      near = { minX: Math.floor(box.minX / snap) * snap, minY: Math.floor(box.minY / snap) * snap, maxX: Math.ceil(box.maxX / snap) * snap, maxY: Math.ceil(box.maxY / snap) * snap };
    const key = `${near.minX},${near.minY},${near.maxX},${near.maxY}`;
    let path = this.cityWaterPath.paths.get(key);
    if (!path) this.cityWaterPath.paths.set(key, (path = riverCapsules(riverSegmentsInBox(rivers, near))));
    ctx.save();
    // Only around the town being drawn.
    ctx.beginPath();
    ctx.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.clip();
    ctx.clip(path);
    // Bridges and fords stay above the water: their decks are cut out of it (regional decks drawn under the town, the
    // town's own crossings drawn after this).
    ctx.clip(this.crossingHoles(), 'evenodd');
    ctx.save();
    const paint = this.painting;
    if (paint.groundRedraw) {
      ctx.globalAlpha = 1;
      paint.groundRedraw(ctx);
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.fill(path);
      // A town painted straight into a canvas of its own does not share it with the cartography, which the same cut
      // clears when both lie in one canvas.
      const under = ctx.canvas === paint.canvas ? paint.overlayBelow : undefined;
      if (under) {
        under.save();
        under.setTransform(ctx.getTransform());
        under.beginPath();
        under.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
        under.clip();
        under.clip(path);
        under.clip(this.crossingHoles(), 'evenodd');
        under.globalCompositeOperation = 'destination-out';
        under.globalAlpha = 1;
        under.fill(path);
        under.restore();
      }
    }
    ctx.restore();
    // What stands above the water (the quays) is drawn again inside it, nowhere else.
    over?.();
    ctx.restore();
  }
  /** Native city plans/houses: rebuilt per city products only; the city appearance is read per frame (draw). */
  async cityPass(): Promise<void> {
    const v = this.map.scene!.revisions,
      key = JSON.stringify([v.cities, v.settlements, v.terrain]),
      shared = this.map.shared;
    if (shared.city?.key === key) {
      this.city = shared.city.map;
      return;
    }
    // `progress` (the kept town layer of the current view is complete): same content.
    const map = await createNativeCityMapAsync(
      this.map.world!,
      kind => {
        if (kind === 'content') this.map.invalidate();
        else this.map.repaint();
      },
      volumeTownBuildings(this.map.resolved) && this.map.resolved?.target === 'view2d',
      this.streetFilter,
    );
    // Another pass prepared the same cities while the volumes were built: keep one map.
    if (this.map.ownsShared && shared.city?.key === key) {
      map.dispose();
      this.city = shared.city.map;
      return;
    }
    if (this.map.ownsShared) {
      shared.city?.map.dispose();
      shared.city = { key, map };
    } else {
      this.exportCity?.dispose();
      this.exportCity = map;
    }
    this.city = map;
  }
  private cityVisibility?: { layers: Partial<ExportLayers>; shown: Partial<ExportLayers> };
  /** The layers the town of the view on screen is drawn with: one object per set of export layers, which the live
   * town layer compares. */
  shownLayers(): Partial<ExportLayers> {
    if (this.cityVisibility?.layers !== this.map.exportLayers) this.cityVisibility = { layers: this.map.exportLayers, shown: { ...this.map.exportLayers, labels: false } };
    return this.cityVisibility.shown;
  }
  dispose(): void {
    this.exportCity?.dispose();
    if (this.map.ownsShared) this.map.shared.city?.map.dispose();
  }
}
