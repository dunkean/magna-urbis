/**
 * Roofs of the exact Canvas town: the pans of each building over its body (colour, uneven snow, cover grain or
 * textured grain, edges: all asked of the look, render/city/buildingLook.ts), the mill marks, and the buildings that
 * stand outside any town plan (`drawRoofedBuildings`, called by the cartography for farmsteads). Called by town.ts.
 */
import type { Point, Shape } from '../../../../../rust/bridge/urban';
import { buildingColors } from '../../urbanBuildingStyle';
import { COVER_GRAINS, MATERIALS, coverGrainPattern, coverLayer, layerExtent, type MaterialImages } from '../../buildingMaterials';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { GRAIN_SHIFT, SNOW_SHIFT, buildingBody, buildingEdgeInk, buildingEdgePx, buildingGroundSnow, castShadowFill, roofFrame, roofPanGrain, roofPanPaint, roofPanSnow, type BuildingFrame, MILL_MARKS } from '../look';
import { CityBuilding, CityRoofs, CityBuildings } from '../model/contract';
import { CityDrawOptions } from './contract';
import { shapePath } from './batches';

const roofIndex = new WeakMap<CityRoofs, { byOwner: number[][]; paths: (Path2D | undefined)[]; outlines: (Path2D | undefined)[] }>();
export const roofShadowPaths = new WeakMap<CityRoofs, (Path2D | undefined)[]>();
/** Start after the hidden side so the two remaining sides can be stroked as one open path. */
function splitPanOutline(outer: readonly Point[], hiddenEdge: number, Path: new () => Path2D = Path2D): Path2D {
  const path = new Path(),
    n = outer.length,
    start = hiddenEdge + 1;
  const first = outer[start % n];
  path.moveTo(first.x, first.y);
  for (let i = 1; i < n; i++) {
    const p = outer[(start + i) % n];
    path.lineTo(p.x, p.y);
  }
  return path;
}
const roofGrain = new WeakMap<ImageBitmap, Map<number, CanvasPattern>>();
/** Mean-centred grain, shared per material; soft light keeps the final palette colour. */
function roofGrainPattern(ctx: CanvasRenderingContext2D, images: MaterialImages, layer: number, angle: number): CanvasPattern | undefined {
  let cache = roofGrain.get(images.albedo);
  if (!cache) roofGrain.set(images.albedo, (cache = new Map()));
  let pattern = cache.get(layer);
  if (!pattern) {
    const t = MATERIALS.tile,
      tile = Object.assign(document.createElement('canvas'), { width: t, height: t }),
      c = tile.getContext('2d')!;
    c.drawImage(images.albedo, 0, layer * t, t, t, 0, 0, t, t);
    const pixels = c.getImageData(0, 0, t, t),
      data = pixels.data,
      mean = MATERIALS.layers[layer].mean_rgb;
    const luma = Math.max(5, mean[0] * 0.3 + mean[1] * 0.59 + mean[2] * 0.11);
    for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, ((data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / luma - 1) * 89.25 + 127.5));
    c.putImageData(pixels, 0, 0);
    pattern = ctx.createPattern(tile, 'repeat') ?? undefined;
    if (!pattern) return undefined;
    cache.set(layer, pattern);
  }
  const s = layerExtent(layer) / MATERIALS.tile;
  pattern.setTransform(new DOMMatrix().rotate((angle * 180) / Math.PI).scale(s, s));
  return pattern;
}
/** Final colour of every roof pan, kept until the ground tones, the palette, the season or the custom ink change:
 * a frame only reads them. */
const roofPaint = new WeakMap<CityRoofs, { key: string; colors: (string | undefined)[]; gains: number[] }>();
/** Same massing faces and shared tint as the GPU path. On natural grounds (terrain palette, by day) a pitched pan
 * takes the capped light of its cover (planPanLight: thatch never shines), its weathering and its procedural grain
 * along the slope (`images`, textured materials, replaces that grain); the rim of a flat roof on masonry walls is
 * the top of those walls, in their colour (the brick of a block shows from above); snow is the inset patch of each
 * face, an uneven mantle at the scales of the cover grain (the same on every roof), the flat snow tint further out. */
function drawPlanRoofs(ctx: CanvasRenderingContext2D, b: CityBuildings, o: CityDrawOptions, images?: MaterialImages): void {
  const steps = drawPlanRoofsSteps(ctx, b, o, images);
  while (!steps.next().done);
}
/** Buildings between two pauses of the resumable roof and shadow loops (a few milliseconds of Canvas calls). */
const ROOF_STEP = 16;
export const SHADOW_STEP = 128;
/** `drawPlanRoofs` in resumable steps: the same calls in the same order, with a pause every `ROOF_STEP` buildings. The
 * context must not be drawn on by anyone else between two steps. */
export function* drawPlanRoofsSteps(ctx: CanvasRenderingContext2D, b: CityBuildings, o: CityDrawOptions, images?: MaterialImages): Generator<void, void> {
  if (o.appearance.roof === 'minimal') return;
  if (o.appearance.roof === 'flat') images = undefined;
  const roofs = b.roofs!;
  let index = roofIndex.get(roofs);
  if (!index) {
    const byOwner: number[][] = b.items.map(() => []);
    roofs.owner.forEach((ow, k) => byOwner[ow]?.push(k));
    roofIndex.set(roofs, (index = { byOwner, paths: [], outlines: [] }));
  }
  // What a pan is painted with is the look's (city/buildingLook.ts): its colour and grain gain are kept per pan.
  const f = roofFrame({
    palette: o.palette,
    mpp: o.mpp,
    dpr: o.dpr,
    night: o.night,
    cave: o.appearance.cave,
    diagnostic: o.appearance.diagnostic,
    colors: o.colors,
    textured: !!images,
    smoothRoofs: o.appearance.smoothRoofs,
    roof: o.appearance.roof,
    rendered: o.roadLook === 'rendered',
  });
  let paint = roofPaint.get(roofs);
  if (!paint || paint.key !== f.key) roofPaint.set(roofs, (paint = { key: f.key, colors: [], gains: [] }));
  const edge = parseInt(f.edge.color.slice(1), 16);
  ctx.strokeStyle = `rgba(${(edge >> 16) & 255},${(edge >> 8) & 255},${edge & 255},${f.edge.alpha})`;
  ctx.lineWidth = f.edge.widthPx * o.mpp;
  let drawn = 0;
  for (const i of b.bins.query(o.viewport)) {
    const pans = index.byOwner[i];
    if (!pans?.length) continue;
    if (++drawn % ROOF_STEP === 0) yield;
    const item = b.items[i],
      age = item.age ?? 0.5,
      ground = buildingGroundSnow(item);
    for (const k of pans) {
      // Without snow on the ground a snow patch repeats the pan under it.
      if (roofs.patch?.[k] && !ground) continue;
      const shape = roofs.shapes[k],
        path = (index.paths[k] ??= shapePath(shape, b.pathClass));
      let color = paint.colors[k];
      if (color === undefined) {
        const made = roofPanPaint(f, item, roofs, k, ground);
        color = paint.colors[k] = made.color;
        paint.gains[k] = made.gain;
      }
      // The snow of a patch is uneven at the scales of the cover grain: the mantle as a pattern over the cover (thin
      // places drawn out down the slope, the cover faintly through them), the same tile on every roof, shifted per
      // building. Further out it is the flat snow tint; the two cross-fade.
      const mantle = roofPanSnow(f, roofs, k, ground),
        snow = mantle ? coverGrainPattern(ctx, mantle.shaded ? 'snowShade' : 'snow', f.grain!.level, roofs.dir[k] ?? 0, age * SNOW_SHIFT[0], age * SNOW_SHIFT[1]) : undefined;
      if (!mantle || !snow) {
        ctx.fillStyle = color;
        ctx.fill(path);
      } else {
        if (mantle.under > 0) {
          ctx.globalAlpha = mantle.under;
          ctx.fillStyle = color;
          ctx.fill(path);
        }
        ctx.globalAlpha = mantle.alpha;
        ctx.fillStyle = snow;
        ctx.fill(path);
        ctx.globalAlpha = 1;
      }
      if (!(roofs.snow?.[k] && ground)) {
        // The cover's own grain, wherever the cover shows (textured materials replace the procedural one).
        const layer = images ? coverLayer(roofs.cover[k]) : -1;
        if (images && layer >= 0) {
          const grain = roofGrainPattern(ctx, images, layer, (roofs.dir[k] ?? 0) - Math.PI / 2);
          if (grain) {
            ctx.save();
            ctx.globalCompositeOperation = 'soft-light';
            ctx.fillStyle = grain;
            ctx.fill(path);
            ctx.restore();
          }
        } else {
          // The shift gives every building its own piece of the tile.
          const laid = roofPanGrain(f, roofs, k, ground, paint.gains[k]),
            grain = laid ? coverGrainPattern(ctx, COVER_GRAINS[laid.family - 1], f.grain!.level, roofs.dir[k] ?? 0, age * GRAIN_SHIFT[0], age * GRAIN_SHIFT[1]) : undefined;
          if (laid && grain) {
            ctx.globalAlpha = laid.strength;
            ctx.fillStyle = grain;
            ctx.fill(path);
            ctx.globalAlpha = 1;
          }
        }
      }
      if (!o.appearance.smoothRoofs && !roofs.snow?.[k]) {
        ctx.stroke(shape.hiddenEdge === undefined ? path : (index.outlines[k] ??= splitPanOutline(shape.outer, shape.hiddenEdge, b.pathClass)));
      }
    }
    if (f.natural && item.marks) drawMillMarks(ctx, b, item, o);
  }
}
const millPaths = new WeakMap<CityBuilding, { Path: unknown; shadow: Path2D; bars: Path2D; wheels: Path2D; paddles: Path2D; cloth: number }>();
/** Mill works of a building as an aerial photograph shows them (natural grounds). Sails stand in a vertical plane:
 * from above they are a short pale bar across the cap, and what tells the windmill is their long cross-shaped shadow
 * on the ground, cast like the building's (sun from the north-west). A water wheel is a dark timber rectangle, as
 * long as its diameter and as wide as the wheel, beside the building, with its float boards across it. */
function drawMillMarks(ctx: CanvasRenderingContext2D, b: CityBuildings, item: CityBuilding, o: CityDrawOptions): void {
  const Path = b.pathClass ?? Path2D;
  let held = millPaths.get(item);
  if (!held || held.Path !== Path) {
    held = { Path, shadow: new Path(), bars: new Path(), wheels: new Path(), paddles: new Path(), cloth: 0.5 };
    for (const m of item.marks ?? []) {
      const ax = Math.cos(m.angle),
        ay = Math.sin(m.angle),
        tx = -ay,
        ty = ax;
      if (m.kind === 'sails') {
        // Same cast as pieceShadow: a point h above the ground falls .55 h east and .44 h south.
        const foot = (s: number, u: number): Point => ({ x: m.x + tx * s + (m.z + u) * 0.55, y: m.y + ty * s + (m.z + u) * 0.44 }),
          hub = foot(0, 0);
        for (let k = 0; k < 4; k++) {
          const a = m.turn + (k * Math.PI) / 2,
            tip = foot(Math.cos(a) * m.w, Math.sin(a) * m.w);
          held.shadow.moveTo(hub.x, hub.y);
          held.shadow.lineTo(tip.x, tip.y);
        }
        const reach = m.w * Math.max(Math.abs(Math.cos(m.turn)), Math.abs(Math.sin(m.turn)));
        held.bars.moveTo(m.x - tx * reach + ax * 0.5, m.y - ty * reach + ay * 0.5);
        held.bars.lineTo(m.x + tx * reach + ax * 0.5, m.y + ty * reach + ay * 0.5);
        held.cloth = Math.max(held.cloth, m.d, m.w * 0.16);
      } else {
        const r = Math.max(0.6, m.w),
          half = Math.max(0.3, m.d) / 2,
          at = (s: number, off: number): Point => ({ x: m.x + tx * s + ax * off, y: m.y + ty * s + ay * off });
        const corners = [at(-r, -half), at(r, -half), at(r, half), at(-r, half)];
        held.wheels.moveTo(corners[0].x, corners[0].y);
        for (const c of corners.slice(1)) held.wheels.lineTo(c.x, c.y);
        held.wheels.closePath();
        for (let k = 1; k < 6; k++) {
          const s = -r + (k * r) / 3,
            p = at(s, -half),
            q = at(s, half);
          held.paddles.moveTo(p.x, p.y);
          held.paddles.lineTo(q.x, q.y);
        }
      }
    }
    millPaths.set(item, held);
  }
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  ctx.strokeStyle = castShadowFill(o.palette, !!o.night, item.snowAltitude);
  ctx.lineWidth = Math.max(held.cloth * MILL_MARKS.shadow.clothShare, MILL_MARKS.shadow.minPx * o.mpp);
  ctx.stroke(held.shadow);
  ctx.fillStyle = MILL_MARKS.wheel.fill;
  ctx.fill(held.wheels);
  if (o.mpp <= MILL_MARKS.paddles.maxMpp) {
    ctx.strokeStyle = MILL_MARKS.paddles.ink;
    ctx.lineWidth = Math.max(MILL_MARKS.paddles.minWidth, MILL_MARKS.paddles.widthPx * o.mpp);
    ctx.stroke(held.paddles);
  }
  ctx.strokeStyle = MILL_MARKS.sails.ink;
  ctx.lineWidth = Math.max(MILL_MARKS.sails.minWidth, MILL_MARKS.sails.widthPx * o.mpp);
  ctx.stroke(held.bars);
  ctx.restore();
}
/** Buildings that stand outside any town plan (farmsteads, isolated houses), painted as the buildings of a town
 * are in the buildings view: cast shadow, wall base with its edge, then the roof pans of `drawPlanRoofs` (pan light,
 * grain by cover and culture, weathering, snow). The context is in world coordinates; nothing is batched, so the
 * calls are those the vector recorder reads (give `buildings.pathClass` a path class it can read). Returns the
 * number of buildings drawn. */
export function drawRoofedBuildings(ctx: CanvasRenderingContext2D, buildings: CityBuildings, o: Pick<CityDrawOptions, 'viewport' | 'mpp' | 'dpr' | 'palette' | 'appearance' | 'colors' | 'night'>): number {
  const roofs = buildings.roofs,
    visible = buildings.bins.query(o.viewport),
    minimal = o.appearance.roof === 'minimal';
  if ((!roofs && !minimal) || !visible.length) return 0;
  const night = !!o.night,
    Path = buildings.pathClass ?? Path2D,
    group = (shapes: readonly Shape[]): Path2D => {
      const p = new Path();
      for (const s of shapes) p.addPath(shapePath(s, Path));
      return p;
    };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (roofs && !minimal) {
    let shadows = roofShadowPaths.get(roofs);
    if (!shadows) roofShadowPaths.set(roofs, (shadows = []));
    for (const i of visible) {
      // Each isolated building stands at its own altitude: its own shadow tone (snow or bare ground).
      ctx.fillStyle = castShadowFill(o.palette, night, buildings.items[i].snowAltitude);
      ctx.fill((shadows[i] ??= group(roofs.shadows[i] ?? [])));
    }
  }
  const colors = buildingColors(o.appearance.colors, o.appearance.ambience),
    body: BuildingFrame = { view: 'buildings', palette: o.palette, footprint: false, diagnostic: 'none', colors };
  ctx.strokeStyle = buildingEdgeInk(colors, false, false);
  ctx.lineWidth = buildingEdgePx(false, false) * o.mpp;
  for (const i of visible) {
    const item = buildings.items[i],
      path = minimal ? (item.footprintPath ??= group(item.footprint ?? item.building.footprint)) : (item.path ??= group(item.surface));
    ctx.fillStyle = buildingBody(body, item, !minimal).fill;
    ctx.fill(path, 'nonzero');
    if (!o.appearance.smoothRoofs) ctx.stroke(path);
  }
  drawPlanRoofs(ctx, buildings, o as CityDrawOptions);
  ctx.restore();
  return visible.length;
}
