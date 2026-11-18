/**
 * The furniture of the map: the graticule under the land use, the map frame, the host's labels, the names (through
 * the names module), the compact scale bar, the cartouche and the legend (screen space, drawVector modes 'all' and
 * 'overlays'); drawFurniture for a live frame (the furniture alone on its own canvas); and the miniature (drawMinimap).
 * Reads: world, scene, palette, overlays, labels, the legend model, the terrain, water, density and cave rock images.
 */
import { placeLabels } from '../labels';
import { cartoucheModel, compactMapPanels, compactScaleModel, drawPanelCanvas } from '../legend';
import { frameModel, panelMargin } from '../frame';
import { cavernWallFill } from '../caverns';
import { BAND_MIN_EDGE } from '../lod';
import { viewRect, type View } from '../view';
import { polyPath } from './geometry';
import { drawVector } from './vector';
import type { CartographyContext } from './context';
import type { CanvasLike } from './types';
import type { VectorFrame } from './frame';

/** The graticule: a screen-size grid, under the land-use tints. */
export function paintGraticule(c: CartographyContext, f: VectorFrame): void {
  const { pal, S } = c;
  const { ctx, mode, sc, rect } = f;
  if (mode !== 'ground' && pal.grid && sc * pal.grid.step > 7) {
    const g = pal.grid;
    ctx.strokeStyle = g.color;
    ctx.globalAlpha = g.opacity;
    ctx.lineWidth = 0.8 / sc; // graticule: a screen-size line
    ctx.beginPath();
    for (let v = Math.max(g.step, Math.ceil(rect.minX / g.step) * g.step); v < Math.min(S, rect.maxX); v += g.step) {
      ctx.moveTo(v, Math.max(0, rect.minY));
      ctx.lineTo(v, Math.min(S, rect.maxY));
    }
    for (let v = Math.max(g.step, Math.ceil(rect.minY / g.step) * g.step); v < Math.min(S, rect.maxY); v += g.step) {
      ctx.moveTo(Math.max(0, rect.minX), v);
      ctx.lineTo(Math.min(S, rect.maxX), v);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Map frame, labels, names, cartouche, legend: screen space, over the map. */
export function paintFurniture(c: CartographyContext, ctx: CanvasRenderingContext2D, view: View, cssW: number, cssH: number, dpr: number, sc: number): void {
  const { pal, S, deps, overlays, family, world } = c;
  // 7. map frame (screen space, around the map rectangle)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.setLineDash([]);
  {
    const side = S * sc,
      fx = cssW / 2 - view.cx * sc,
      fy = cssH / 2 - view.cy * sc;
    if (pal.frameKind !== 'none' && fx < cssW && fy < cssH && fx + side > 0 && fy + side > 0) {
      drawPanelCanvas(ctx, { w: side, h: side, prims: frameModel(side, side, pal, false) }, fx, fy, family);
    }
  }

  // 8. labels, cartouche, legend (screen space)
  if (overlays.labels && c.labels.length) {
    const measure = (text: string, size: number): number => {
      ctx.font = `${size}px ${pal.fontFamily}`;
      return ctx.measureText(text).width;
    };
    const placed = placeLabels(c.labels, view, cssW, cssH, measure);
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const pl of placed) {
      const size = pl.label.size ?? 12;
      ctx.font = `${size}px ${pal.fontFamily}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = pal.lab.halo;
      ctx.globalAlpha = 0.85;
      ctx.strokeText(pl.label.text, pl.x, pl.y);
      ctx.globalAlpha = 1;
      ctx.fillStyle = pl.label.color ?? pal.ink;
      ctx.fillText(pl.label.text, pl.x, pl.y);
    }
  }
  if (!deps.separateText) c.drawNames(ctx, view, cssW, cssH);
  // panels sit inside the map frame when the map corner is under them, else at the viewport corner
  const pm = panelMargin(pal) * 0.75;
  const mx0 = cssW / 2 - view.cx * sc,
    my0 = cssH / 2 - view.cy * sc,
    mapBottom = my0 + S * sc;
  const compact = compactMapPanels(cssW, cssH);
  if (compact && overlays.cartouche) drawPanelCanvas(ctx, compactScaleModel(pal, sc, world.options.distanceUnit), 12, cssH - 40, family);
  const cart = overlays.cartouche && !compact ? cartoucheModel(world, pal, sc) : null;
  if (cart) {
    const inside = mx0 < 12 + cart.w && my0 < 12 + cart.h;
    drawPanelCanvas(ctx, cart, inside ? Math.max(12, mx0 + pm) : 12, inside ? Math.max(12, my0 + pm) : 12, family);
  }
  if (overlays.legend && !compact) {
    const panel = c.legendNow();
    const home = Math.max(12, cssH - panel.h - 34);
    const inside = mx0 < 12 + panel.w && mapBottom > home && mapBottom < cssH + panel.h + 60;
    drawPanelCanvas(ctx, panel, inside ? Math.max(12, mx0 + pm) : 12, inside ? Math.max(12, Math.min(home, mapBottom - pm - panel.h)) : home, family);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** The screen-space furniture alone, as the last step of a live frame draws it over the overlay layer. */
export function drawFurniture(c: CartographyContext, target: CanvasRenderingContext2D, view: View, cssW: number, cssH: number): void {
  const surface = target.canvas as unknown as CanvasLike;
  if (!(cssW > 0 && cssH > 0) || !(surface.width > 0 && surface.height > 0)) return;
  const kept = c.stats,
    dprBefore = c.activeDpr;
  // drawVector derives the CSS size from the canvas and the pixel ratio: give it the ratio of this canvas.
  c.activeDpr = surface.width / cssW;
  try {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
    target.clearRect(0, 0, surface.width, surface.height);
    drawVector(c, view, surface, 'overlays');
  } finally {
    c.activeDpr = dprBefore;
    c.stats = kept;
  }
}

/** The miniature: terrain, water, town density and caves of the whole map, and the view rectangle. */
export function drawMinimap(c: CartographyContext, target: CanvasLike, view: View, viewW: number, viewH: number, withRect = true): void {
  const { pal, S, P, deps, world, cached, polyL } = c;
  const ctx = target.getContext('2d');
  if (!ctx) return;
  const k = target.width / S;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.paper;
  ctx.fillRect(0, 0, target.width, target.height);
  const tex = c.getTerrain();
  if (tex) ctx.drawImage(tex, 0, 0, target.width, target.width);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const waterImage = c.getWater();
  const water = (name: string, fill: string, rule: CanvasFillRule = 'nonzero'): void => {
    const l = polyL(name);
    if (!l) return;
    ctx.fillStyle = fill;
    const paint = (path: Path2D): void => {
      if (waterImage && name !== 'rivers') {
        ctx.save();
        ctx.clip(path, rule);
        ctx.drawImage(waterImage, 0, 0, S, S);
        ctx.restore();
      } else ctx.fill(path, rule);
    };
    for (const t of l.index.tilesInRect({ minX: 0, minY: 0, maxX: S, maxY: S })) {
      const p = cached(`${l.name}|0|t${t}`, () => polyPath(P, l, l.index.itemsOf(t), BAND_MIN_EDGE[0]));
      if (p) paint(p);
    }
    for (const i of l.index.big) {
      const p = cached(`${l.name}|0|b${i}`, () => polyPath(P, l, [i], BAND_MIN_EDGE[0]));
      if (p) paint(p);
    }
  };
  water('sea', pal.seaFill, 'evenodd');
  water('lakes', pal.lakeFill);
  water('rivers', pal.riverFill);
  const d = c.getDensity();
  if (d) ctx.drawImage(d, 0, 0, S, S);
  if ((deps.mask?.landuse !== undefined ? deps.mask.landuse !== false : world.options.landuse) && world.options.biome === 'underdark-caverns' && world.terrain.caverns?.fungalRooms?.length) {
    const rooms = c.exactCavernPath('fungalRooms');
    if (rooms) {
      ctx.globalAlpha = pal.landOpacity;
      ctx.fillStyle = pal.land.garden;
      ctx.fill(rooms, 'nonzero');
      ctx.globalAlpha = 1;
    }
  }
  if (world.terrain.caverns) {
    const solid = c.exactCavernPath('solid');
    ctx.fillStyle = cavernWallFill(pal);
    if (solid) ctx.fill(solid, 'nonzero');
    if (solid) {
      ctx.save();
      ctx.clip(solid, 'nonzero');
      const rock = c.getCavernRock();
      if (rock) ctx.drawImage(rock, 0, 0, S, S);
      ctx.restore();
    }
  }
  if (withRect) {
    const r = viewRect(view, viewW, viewH, 0);
    ctx.strokeStyle = pal.marker;
    ctx.lineWidth = 1.5 / k;
    ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
