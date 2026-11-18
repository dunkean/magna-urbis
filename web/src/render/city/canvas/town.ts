/**
 * The exact Canvas 2D town: paints the visible plan of one town into a context set to world coordinates — ground,
 * streets, quays, lot enclosures, walls, canals, buildings and roofs, far raster, night lights, diagnostics, names.
 *
 * It is the reference picture of the town: captures, exports, sheets, the fallback display and every frame at rest
 * that the GPU town does not cover are made of it (called through v2/nativeCityMap.ts and City Bench). What each
 * element is painted with is asked of the look (render/city/look.ts); this module turns the look's operations into
 * batched Canvas calls and owns their order. One generator on purpose: the draw order of a frame reads top to bottom,
 * and `drawCitySteps` pauses between its layers for the stepwise mode of the exact town.
 */
import { DEFAULT_TEXT, cityTextLabels, drawMapLabels, textFamily, textPlacement, measureTextCached } from '../../textLayer';
import { placeMapLabels } from '../../mapLabels';
import { PALETTES } from '../../styles';
import { drawCityWaterways } from '../../cityWaterways';
import type { Point, Shape } from '../../../../../rust/bridge/urban';
import { buildingColors } from '../../urbanBuildingStyle';
import { layerPattern, materialImagesNow, placeLayer, wallStoneLayer } from '../../buildingMaterials';
import { drawLotEnclosures, updateYardEnclosures } from '../../cityLotEnclosures'; // enclosures hook (cityLotEnclosures.ts)
import { cityWallDetails, drawCityWallGround, drawCityWalls } from '../../cityWalls'; // walls hook (cityWalls.ts)
import { roadGrain, roadPaint } from '../../roadStyle';
import { layoutStreetPavements } from '../../roadPavement';
import { drawGardenDetails } from '../../readableGardens';
import { polygonCentroid as shapeRingCenter } from '../../../gen/core/geom';
import { roadSurface } from '../../roadSurface';
import { drawNightBuildings, drawNightTown } from '../../cityNight';
import { drawRuinPlan } from '../../cityRuins';
import { drawFarTown } from '../../cityFarRaster';
import {
  ATLAS,
  FOOTPRINT_EDGE_PX,
  PARCH,
  REFUSED_PARCEL,
  SELECTION,
  ZONE_COLORS,
  atLeast,
  blockOps,
  buildingBody,
  buildingEdgeInk,
  buildingsShown,
  castShadowFill,
  farTownAlpha,
  farTownShown,
  footprintOps,
  parcelOps,
  parcelsShown,
  planFrame,
  quayPaint,
  roofPansShown,
  streetFrame,
  streetLook,
  streetOrder,
  streetShown,
  wallLook,
  type BuildingFrame,
  type BuildingsShownInput,
  type PaintOp,
  type StreetFill,
  type StreetLayer,
  type StreetPaint,
  type StreetSurface,
} from '../look';
import { CityStreet, CityScene } from '../model/contract';
import { shapeBox, overlaps, centroid } from '../model/geometry';
import { CityDrawOptions, CityFrameStats } from './contract';
import { hatchPattern, shapePath, linePath, Style, Batches } from './batches';
import { roofShadowPaths, SHADOW_STEP, drawPlanRoofsSteps } from './roofs';

/** Street surface rings per scene, by streets, widths and edges drawn (a few camera steps). */
const SURFACE_CACHE = new WeakMap<object, Map<string, { casing: { street: number; path: Path2D }[]; fill: { street: number; path: Path2D }[]; inner: { street: number; path: Path2D }[] }>>();
/** Paint the visible plan into a context already set to world coordinates. */
export function drawCity(ctx: CanvasRenderingContext2D, scene: CityScene, o: CityDrawOptions): CityFrameStats {
  const steps = drawCitySteps(ctx, scene, o);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
/** `drawCity` in resumable steps, for a caller that paints a large town over several tasks (the live town layer of
 * the V2): the same Canvas calls in the same order, with a pause between the layers of the plan and every few
 * buildings. No `save()` is open at a pause; the context must not be drawn on by anyone else between two steps. */
export function* drawCitySteps(ctx: CanvasRenderingContext2D, scene: CityScene, o: CityDrawOptions): Generator<void, CityFrameStats> {
  if (o.buildings) updateYardEnclosures(scene, o.buildings.items, () => o.buildings!.items.map(b => b.building));
  const start = performance.now(),
    { viewport, mpp, lod, view, palette, layers } = o,
    px = (n: number): number => n * mpp;
  // Textured materials: repeating patterns anchored to world metres (ink and parchment keep their own look).
  const tex = o.textured && !o.night && palette !== 'parchment' && palette !== 'ink' ? materialImagesNow(o.onTexturesReady) : undefined;
  const pat = (layer: number): CanvasPattern | undefined => (tex ? (layerPattern(ctx, tex, layer) ?? undefined) : undefined);
  const stats: CityFrameStats = { lod, blocks: 0, parcels: 0, streets: 0, buildings: 0, ms: 0, pending: false };
  const parchment = palette === 'parchment',
    night = !!o.night;
  // The plan's paint is the look's (city/planLook.ts); this function turns each operation into one batched call.
  const plan = planFrame({ view, lod, palette, layers, width: o.width, night, groundBlend: o.groundBlend, materialGround: o.materialGround, roadLook: o.roadLook, textured: !!tex });
  const batch = new Batches(),
    lineW = px(plan.lineWidthPx);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const pathOf = <T extends { path?: Path2D; shape: Shape; ground?: Shape[]; groundPath?: Path2D }>(item: T): Path2D => {
    if (!item.ground) return (item.path ??= shapePath(item.shape));
    if (!item.groundPath) {
      item.groundPath = new Path2D();
      for (const s of item.ground) item.groundPath.addPath(shapePath(s));
    }
    return item.groundPath;
  };
  const growthColor = (zone: string): string => ZONE_COLORS[zone] ?? ZONE_COLORS.core;
  /** The operations of one element, batched over its path: widths and dashes from CSS pixels to world units, the
   * hatching and the paving material as patterns of this context. */
  const paint = (ops: readonly PaintOp[], path: Path2D): void => {
    for (const op of ops) {
      const fill = op.hatch ? hatchPattern(ctx, mpp) : op.plaza && op.fill && tex ? (pat(placeLayer()) ?? op.fill) : op.fill;
      if (op.hatch && !fill) continue;
      batch.add({ fill, stroke: op.stroke, width: op.widthPx === undefined ? undefined : px(op.widthPx), alpha: op.alpha, dash: op.dashPx?.map(px), cap: op.cap }, path);
    }
  };

  if (lod === 'far') {
    // Far: the urban footprint as one tint, main roads and walls.
    for (const shape of scene.footprint) {
      if (!overlaps(shapeBox(shape), viewport)) continue;
      const ops = footprintOps(plan, shape);
      if (ops.length) paint(ops, shapePath(shape));
    }
    batch.flush(ctx);
  } else {
    // Blocks: palette, district role, or the ground under buildings.
    if (layers.blocks || layers.domains)
      for (const i of scene.bins.blocks.query(viewport)) {
        const b = scene.blocks[i],
          ops = blockOps(plan, b, scene.enclosureProfiles?.[b.layout]?.hideLotLines);
        if (!ops) continue;
        stats.blocks++;
        paint(ops, pathOf(b));
      }
    yield* batch.flushSteps(ctx);
    // Parcels: cadastral detail from near; uses and roles from mid.
    if (parcelsShown(plan))
      for (const i of scene.bins.parcels.query(viewport)) {
        const p = scene.parcels[i],
          ops = parcelOps(plan, p, scene.enclosureProfiles?.[p.layout]?.hideLotLines);
        if (!ops) continue;
        stats.parcels++;
        paint(ops, pathOf(p));
      }
    yield* batch.flushSteps(ctx);
  }
  yield;

  if (layers.parcelOverlay !== false && o.readableGardens && (lod === 'near' || lod === 'close') && view !== 'tissue') {
    for (const i of scene.bins.parcels.query(viewport)) {
      const garden = scene.parcels[i];
      if (garden.use !== 'garden') continue;
      const center = shapeRingCenter(garden.shape.outer);
      const neighbours = scene.bins.parcels
        .query(shapeBox(garden.shape))
        .map(j => scene.parcels[j])
        .filter(p => p.layout === garden.layout && p.block === garden.block && ['plot', 'compound', 'court'].includes(p.use));
      const nearest = neighbours.sort((a, b) => {
        const x = shapeRingCenter((a.source.envelope ?? a.shape).outer),
          y = shapeRingCenter((b.source.envelope ?? b.shape).outer);
        return Math.hypot(x.x - center.x, x.y - center.y) - Math.hypot(y.x - center.x, y.y - center.y);
      })[0];
      if (nearest) drawGardenDetails(ctx, garden.shape, shapeRingCenter((nearest.source.envelope ?? nearest.shape).outer), mpp);
    }
  }
  // Harbour platforms and furniture (harbourStyle.ts, shared with cityGl and the 3D city); small furniture on close
  // views only. The quay band hugs the drawn water (urban::harbour_furniture): drawn above the streets and the water
  // put back over them, below the bridges and fords; a street reaching the waterfront ends on the quay.
  const drawQuays = (): void => {
    for (const q of scene.quays ?? []) {
      if (!overlaps(shapeBox(q.shape), viewport)) continue;
      const quay = quayPaint(plan, q.kind, q.material);
      if (!quay) continue;
      const path = shapePath(q.shape),
        alpha = ctx.globalAlpha;
      if (quay.fillAlpha > 0) {
        ctx.globalAlpha = alpha * quay.fillAlpha;
        ctx.fillStyle = quay.fill;
        ctx.fill(path);
      }
      if (quay.lineAlpha > 0) {
        ctx.globalAlpha = alpha * quay.lineAlpha;
        ctx.strokeStyle = quay.line;
        ctx.lineWidth = px(quay.width);
        ctx.stroke(path);
      }
      ctx.globalAlpha = alpha;
    }
  };

  if (layers.enclosures) drawCityWallGround(ctx, scene, { viewport, mpp, lod, palette, night }); // walls hook: ditches and glacis under the streets
  // Streets: centrelines stroked by rank, casing first, majors and crossings on top. What each street is painted with
  // is the look's (city/streetLook.ts); here its strokes are batched by draw layer and its surface rings are built.
  if (layers.streets) {
    // Stable order by descending rank (crossings last): bucket by rank, O(n) instead of a per-frame sort.
    const buckets = new Map<number, CityStreet[]>();
    for (const i of scene.bins.streets.query(viewport)) {
      const s = scene.streets[i];
      if (!streetShown(s, lod)) continue;
      const k = streetOrder(s),
        list = buckets.get(k);
      if (list) list.push(s);
      else buckets.set(k, [s]);
    }
    const visible = [...buckets.keys()].sort((a, b) => b - a).flatMap(k => buckets.get(k)!);
    const stroked: Record<StreetLayer, Batches> = { casing: new Batches(), under: new Batches(), marks2: new Batches(), over: new Batches(), marks: new Batches() },
      surface = new Batches(),
      carriageways = new Batches();
    const frame = streetFrame({
      lod,
      palette,
      streetPalette: o.streetPalette,
      mpp,
      layers,
      night,
      roadLook: o.roadLook,
      roadEmphasis: o.roadEmphasis,
      groundBlend: o.groundBlend,
      materialGround: o.materialGround,
      textured: !!tex,
      colors: o.colors,
      paintColors: o.appearance.colors,
      paintNight: o.appearance.ambience === 'night',
    });
    // A paint of the look in this context: a colour as it is, the ground-textured road paint of a rank (one pattern per
    // rank and context, so its strokes batch together), the aggregate grain, a textured material.
    const paintOf = (p: StreetPaint): string | CanvasPattern | undefined => (typeof p === 'string' ? p : 'grain' in p ? roadGrain(ctx) : 'material' in p ? pat(p.material) || p.fallback : roadPaint(ctx, p.road, p.style));
    const fillOf = (f: StreetFill): Style => ({ fill: paintOf(f.paint), alpha: f.alpha });
    // Near and close: streets drawn as their ground surface (roadSurface.ts), filled once per style.
    const surfaced: { s: CityStreet; x: StreetSurface; casing?: Style; fill: Style; inner?: Style }[] = [];
    for (const s of visible) {
      stats.streets++;
      const layout = scene.layouts[s.layout],
        look = streetLook(frame, s, { pavement: layoutStreetPavements(layout)?.[s.index], population: layout?.programme?.population });
      const path = (s.path ??= linePath(s.street.path));
      for (const k of look.strokes) {
        const stroke = paintOf(k.paint);
        if (stroke) stroked[k.layer].add({ stroke, width: k.width, alpha: k.alpha, dash: k.dash as number[] | undefined, cap: k.cap }, path);
      }
      if (look.surface) surfaced.push({ s, x: look.surface, casing: look.surface.casing && fillOf(look.surface.casing), fill: fillOf(look.surface.fill), inner: look.surface.inner && fillOf(look.surface.inner) });
      if (look.rails) {
        const rails = new Path2D(),
          offset = look.rails.offset;
        for (let i = 1; i < s.street.path.length; i++) {
          const a = s.street.path[i - 1],
            b = s.street.path[i],
            len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.01) continue;
          const nx = (-(b.y - a.y) / len) * offset,
            ny = ((b.x - a.x) / len) * offset;
          for (const side of [-1, 1]) {
            rails.moveTo(a.x + nx * side, a.y + ny * side);
            rails.lineTo(b.x + nx * side, b.y + ny * side);
          }
        }
        stroked.marks.add({ stroke: look.rails.paint, width: look.rails.width, cap: 'butt' }, rails);
      }
      if (look.stairs) stroked.marks.add({ stroke: look.stairs.paint, width: look.stairs.width }, stairMarks(s.street.path, s.width));
    }
    if (surfaced.length) {
      const streets = surfaced.map(x => x.s.street),
        ring = (r: readonly Point[]): Path2D => {
          const p = new Path2D();
          p.moveTo(r[0].x, r[0].y);
          for (let i = 1; i < r.length; i++) p.lineTo(r[i].x, r[i].y);
          p.closePath();
          return p;
        };
      const tolerance = Math.max(0.05, 0.35 * px(1)),
        minWidth = (i: number): number => surfaced[i].x.w;
      const ends = surfaced.some(x => x.x.end) ? (i: number): 'round' | 'square' | 'taper' | 'butt' => surfaced[i].x.end ?? 'round' : undefined;
      // Same streets, widths and edges (a camera move within one zoom step): same rings.
      const key = `${tolerance.toFixed(3)}|${surfaced.map(x => `${x.s.layout}.${x.s.index}:${x.x.w.toFixed(2)}:${x.casing ? x.x.edge.toFixed(2) : '-'}${x.x.inset ? `:${x.x.inset.toFixed(2)}` : ''}${x.x.end ? `:${x.x.end}` : ''}`).join(',')}`;
      let rings = SURFACE_CACHE.get(scene)?.get(key);
      if (!rings) {
        const cas = surfaced.some(x => x.casing) ? roadSurface(streets, { extra: i => (surfaced[i].casing ? surfaced[i].x.edge : 0), minWidth, tolerance, ends }) : [];
        yield;
        const inner = surfaced.some(x => x.x.inset) ? roadSurface(streets, { extra: i => -(surfaced[i].x.inset ?? 0), minWidth, tolerance, ends }).filter(p => surfaced[p.street].x.inset) : [];
        yield;
        const body = roadSurface(streets, { minWidth, tolerance, ends });
        yield;
        rings = { casing: cas.map(p => ({ street: p.street, path: ring(p.ring) })), fill: body.map(p => ({ street: p.street, path: ring(p.ring) })), inner: inner.map(p => ({ street: p.street, path: ring(p.ring) })) };
        let memo = SURFACE_CACHE.get(scene);
        if (!memo) SURFACE_CACHE.set(scene, (memo = new Map()));
        if (memo.size >= 8) memo.delete(memo.keys().next().value!);
        memo.set(key, rings);
      }
      for (const p of rings.casing) {
        const st = surfaced[p.street].casing;
        if (st) stroked.casing.add(st, p.path);
      }
      for (const p of rings.fill) surface.add(surfaced[p.street].fill, p.path);
      for (const p of rings.inner) {
        const st = surfaced[p.street].inner;
        if (st) carriageways.add(st, p.path);
      }
    }
    yield;
    yield* stroked.casing.flushSteps(ctx);
    yield* stroked.under.flushSteps(ctx);
    yield* surface.flushSteps(ctx);
    yield* carriageways.flushSteps(ctx);
    yield* stroked.marks2.flushSteps(ctx);
    // Draw order on the water: streets, the water (put back), the quays over it, bridges and fords. Only around this
    // town's own streets: another town's quays and bridges drawn before stay above the water.
    if (o.waterAbove && visible.length) {
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const s of visible)
        for (const q of s.street.path) {
          const r = s.width + 20;
          box.minX = Math.min(box.minX, q.x - r);
          box.minY = Math.min(box.minY, q.y - r);
          box.maxX = Math.max(box.maxX, q.x + r);
          box.maxY = Math.max(box.maxY, q.y + r);
        }
      o.waterAbove(ctx, box);
    }
    drawQuays();
    stroked.over.flush(ctx);
    stroked.marks.flush(ctx);
  }
  yield;

  if (layers.lotEnclosures !== false) drawLotEnclosures(ctx, scene, { mpp, lod, palette, groundOnly: layers.lotEnclosureMeshes }); // enclosures hook

  // Walls: thick line broken at gates, gate and wall towers.
  if (layers.enclosures) {
    const towers = new Batches(),
      detailed = cityWallDetails(scene); // walls hook
    for (const [wi, wall] of scene.walls.entries()) {
      if (detailed[wi]) continue; // walls hook: detailed walls are drawn by drawCityWalls
      const look = wallLook(wall.kind, palette, lod, mpp);
      for (const piece of wall.pieces) {
        const path = linePath(piece);
        batch.add({ stroke: look.outer, width: look.thick, dash: look.dash, cap: 'butt' }, path);
        if (look.inner) batch.add({ stroke: (tex && pat(wallStoneLayer(false))) || look.inner.color, width: look.thick * look.inner.share, cap: 'butt' }, path);
      }
      if (!look.tower) continue;
      for (const t of [...wall.gateTowers, ...wall.towers]) {
        const c = new Path2D();
        c.arc(t.x, t.y, look.tower.radius, 0, Math.PI * 2);
        towers.add({ fill: look.tower.fill, stroke: look.tower.stroke, width: px(look.tower.strokePx) }, c);
      }
    }
    batch.flush(ctx);
    towers.flush(ctx);
    drawCityWalls(ctx, scene, { viewport, mpp, lod, palette, night }); // walls hook
  }

  if (layers.waterways !== false && (layers.streets || layers.waterways)) drawCityWaterways(ctx, scene.layouts, mpp, o.waterColor);

  yield;
  o.beforeBuildings?.(ctx);

  // Buildings: native renderer (compact / detailed) or batched silhouettes. On satellite grounds the far raster stands
  // for them above the fade band, whatever the level's hysteresis, so zooming either way crosses the same blend.
  const footprint = o.appearance.style === 'silhouette',
    shown: BuildingsShownInput = { view, lod, mpp, footprint, diagnostic: o.appearance.diagnostic, buildingsVisible: o.buildingsVisible && !!o.buildings, farTown: o.farTown, houseRenderer: !!o.renderer };
  const farTown = farTownShown(shown);
  if (o.buildings && buildingsShown(shown)) {
    const colors = buildingColors(o.appearance.colors, o.appearance.ambience);
    if (o.renderer && view === 'buildings' && !footprint) {
      stats.pending = o.renderer.draw(ctx, { viewport, metresPerPixel: mpp, appearance: o.appearance, selectedId: o.selectedBuilding }).rasterTilesPending > 0;
    } else {
      const body: BuildingFrame = { view, palette, footprint, diagnostic: o.appearance.diagnostic, colors },
        roofs = o.buildings.roofs,
        pans = !!roofs && roofPansShown(shown);
      if (roofs && pans) {
        let paths = roofShadowPaths.get(roofs);
        if (!paths) roofShadowPaths.set(roofs, (paths = []));
        ctx.fillStyle = castShadowFill(palette, night, o.buildings.items[0]?.snowAltitude);
        let cast = 0;
        for (const i of o.buildings.bins.query(viewport)) {
          let path = paths[i];
          if (!path) {
            path = paths[i] = new Path2D();
            for (const s of roofs.shadows[i] ?? []) path.addPath(shapePath(s));
          }
          ctx.fill(path);
          if (++cast % SHADOW_STEP === 0) yield;
        }
        yield;
      }
      for (const i of o.buildings.bins.query(viewport)) {
        const b = o.buildings.items[i];
        stats.buildings++;
        const made = buildingBody(body, b, !!roofs),
          style: Style = { fill: made.fill, stroke: made.stroke, width: px(made.widthPx) };
        if (footprint) {
          if (!b.footprintPath) {
            b.footprintPath = new Path2D();
            for (const s of b.footprint ?? b.building.footprint) b.footprintPath.addPath(shapePath(s));
          }
          batch.add(style, b.footprintPath);
        } else {
          if (!b.path) {
            b.path = new Path2D();
            for (const s of b.surface) b.path.addPath(shapePath(s));
          }
          batch.add(style, b.path);
        }
      }
      yield;
      yield* batch.flushSteps(ctx);
      if (pans) yield* drawPlanRoofsSteps(ctx, o.buildings, o, tex);
      yield;
      if (footprint && !parchment) {
        ctx.strokeStyle = buildingEdgeInk(colors, false, false);
        ctx.lineWidth = px(FOOTPRINT_EDGE_PX);
        for (const i of o.buildings.bins.query(viewport)) if (o.buildings.items[i].footprintPath) ctx.stroke(o.buildings.items[i].footprintPath!);
      }
      if (footprint) for (const i of o.buildings.bins.query(viewport)) drawRuinPlan(ctx, o.buildings.items[i].ruins ?? [], mpp);
      const selected = o.selectedBuilding === undefined ? undefined : o.buildings.byId.get(o.selectedBuilding);
      const selectedPath = selected === undefined ? undefined : footprint ? o.buildings.items[selected].footprintPath : o.buildings.items[selected].path;
      if (selectedPath) {
        ctx.strokeStyle = SELECTION.stroke!;
        ctx.lineWidth = px(SELECTION.widthPx!);
        ctx.stroke(selectedPath);
      }
    }
  }
  if (farTown) drawFarTown(ctx, scene, o.farBuildings ?? o.buildings!, { viewport, mpp, dpr: o.dpr, palette, night, custom: o.colors?.building, alpha: farTownAlpha(mpp), onReady: o.onTexturesReady });

  if ((o.appearance.lightsOn ?? night) && o.appearance.diagnostic === 'none') {
    if (!o.deferNightTown) drawNightTown(ctx, scene, viewport, mpp, parchment, layers.streets);
    if (o.buildingsVisible && o.buildings)
      drawNightBuildings(
        ctx,
        o.buildings.items.map(b => b.building),
        viewport,
        mpp,
        parchment,
      );
  }

  // Diagnostics of the plan.
  if (atLeast(lod, 'near')) {
    const access: Record<string, string> = { public: '#26815d', collective: '#456fba', private: '#aa6dad', unserved: '#cc383c', reserved: '#81725b', attached: '#91a36d' };
    if (layers.parcelOverlay !== false && (layers.fronts || layers.axes || layers.access))
      for (const i of scene.bins.parcels.query(viewport)) {
        const p = scene.parcels[i],
          parcel = p.source;
        if (layers.fronts && parcel.front) batch.add({ stroke: '#a92d34', width: lineW * 2 }, linePath(parcel.front));
        if (layers.access && parcel.access) {
          const c = access[parcel.access.kind];
          batch.add({ fill: c, alpha: 0.25 }, pathOf(p));
          batch.add({ stroke: c, width: lineW * 1.5 }, pathOf(p));
        }
        if (layers.axes && parcel.shape.outer.length) {
          const c = centroid([parcel.shape]);
          if (c)
            batch.add(
              { stroke: '#396781', width: lineW },
              linePath([
                { x: c.x - parcel.axis.x * 4, y: c.y - parcel.axis.y * 4 },
                { x: c.x + parcel.axis.x * 4, y: c.y + parcel.axis.y * 4 },
              ]),
            );
        }
      }
    if (layers.parcelOverlay !== false && layers.planLines !== false && o.refusedParcels?.size)
      for (const i of scene.bins.parcels.query(viewport)) {
        const p = scene.parcels[i];
        if (p.id && o.refusedParcels.has(p.id)) batch.add({ stroke: REFUSED_PARCEL.stroke, width: px(REFUSED_PARCEL.widthPx!), dash: REFUSED_PARCEL.dashPx!.map(px) }, pathOf(p));
      }
  }
  for (const layout of scene.layouts) {
    if (layers.reserve) for (const s of (layout.structure?.reserve ?? []).flatMap(shape => scene.ground?.clip(shape) ?? [shape])) (batch.add({ fill: '#6a8eb1', alpha: 0.08 }, shapePath(s)), batch.add({ stroke: '#416784', width: lineW * 2, dash: [px(7), px(4)] }, shapePath(s)));
    if (layers.allocated) for (const s of (layout.structure?.allocated ?? []).flatMap(shape => scene.ground?.clip(shape) ?? [shape])) (batch.add({ fill: '#c0a366', alpha: 0.12 }, shapePath(s)), batch.add({ stroke: '#8a632d', width: lineW * 2 }, shapePath(s)));
    if (layers.quarters) layout.quarters.forEach((q, i) => batch.add({ stroke: palette === 'atlas' ? ATLAS[i % ATLAS.length] : parchment ? PARCH.ink : growthColor(q.zone ?? 'core'), width: lineW * 2, dash: [px(4), px(3)] }, shapePath(q.shape)));
  }
  if (o.selectedParcel !== undefined && scene.parcels[o.selectedParcel]) batch.add({ stroke: SELECTION.stroke, width: px(SELECTION.widthPx!) }, pathOf(scene.parcels[o.selectedParcel]));
  batch.flush(ctx);

  // Screen-space marks: landmarks, district names, centres.
  if (o.labels === false) {
    stats.ms = performance.now() - start;
    return stats;
  }
  ctx.save();
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  const screen = (p: Point): Point => ({ x: (p.x - viewport.minX) / mpp, y: (p.y - viewport.minY) / mpp });
  const text = o.text ?? DEFAULT_TEXT,
    pal = o.textPalette ?? PALETTES.parchment;
  const labels = cityTextLabels(scene, text, pal);
  const w = (viewport.maxX - viewport.minX) / mpp,
    h = (viewport.maxY - viewport.minY) / mpp;
  const placed = placeMapLabels(labels, { cx: (viewport.minX + viewport.maxX) / 2, cy: (viewport.minY + viewport.maxY) / 2, scale: 1 / mpp }, w, h, (t, size, st) => measureTextCached(ctx, t, size, st, textFamily(text, pal)), textPlacement(text));
  drawMapLabels(ctx, placed, pal, textFamily(text, pal));
  if (text.visible && text.groups.city && layers.centers)
    for (const layout of scene.layouts)
      for (const c of layout.structure?.centers ?? []) {
        const s = screen(c.point);
        ctx.strokeStyle = '#a43526';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - 5, s.y);
        ctx.lineTo(s.x + 5, s.y);
        ctx.moveTo(s.x, s.y - 5);
        ctx.lineTo(s.x, s.y + 5);
        ctx.stroke();
      }
  ctx.restore();
  stats.ms = performance.now() - start;
  return stats;
}
function stairMarks(points: readonly Point[], width: number): Path2D {
  const path = new Path2D();
  let next = 1.25;
  const half = Math.min(2, width) * 0.48;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    for (; next < length; next += 2.5) {
      const x = a.x + (dx * next) / length,
        y = a.y + (dy * next) / length;
      path.moveTo(x - (dy * half) / length, y + (dx * half) / length);
      path.lineTo(x + (dy * half) / length, y - (dx * half) / length);
    }
    next -= length;
  }
  return path;
}
