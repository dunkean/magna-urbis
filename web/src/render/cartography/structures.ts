/**
 * Structures over every area layer (drawVector): town walls and towers, bridges, the site marker of a place without a
 * plan, and the caverns (fungal rooms, rock walls and rims, typed tunnels). The cavern part restores the cave-floor
 * clip that drawVector opened before the land use.
 * Reads: world, scene, palette, the cave rock image.
 */
import { setMapInk, type MapInk } from '../gpu/recorder';
import { cavernWallFill, CAVERN_RIM } from '../caverns';
import { drawCaveTunnels } from '../caveTunnels';
import { bridgeShapes, isKinded, type BridgeShapes } from '../townbridges';
import { regionalBridgeSurface } from '../roadSurfaces';
import type { World, Vec2 } from '../../gen/types';
import type { Rect4 } from '../view';
import { TAU } from './geometry';
import { drawPanelCanvas } from '../legend';
import { underdarkMark } from '../underdark';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';

export function paintStructures(c: CartographyContext, f: VectorFrame): void {
  const U = c.pal.urban;
  const { pal, deps, S, family, linesOf, exactCavernPath, getCavernRock, getPattern } = c;
  const { ctx, sc, lod, rect, lw, fillPolys, strokePolys, strokeLines, cavernFloor, luOn } = f;
  // walls: casing + fill (stretches between gate openings), towers and gate towers
  const walls = linesOf(l => l.role === 'wall');
  const ws = U.wallScale;
  for (const l of walls) strokeLines([l], c.ink('wall'), () => Math.max(l.width * ws + 1.4, 3 / sc), 1, [], 'butt');
  for (const l of walls) strokeLines([l], c.ink('wallFill'), () => Math.max(0.6, l.width * ws - 1, 1.5 / sc), 1, [], 'butt');
  if (walls.length && lod.towers) {
    for (const name of ['towers', 'gate-towers']) {
      fillPolys(name, c.ink('wallFill'));
      strokePolys(name, c.ink('wall'), lw(0.9, 0.8));
    }
  }

  // 6. bridges
  if (c.world.bridges?.length) drawBridges(ctx, c.world, c.ink, rect, sc);
  // site marker (placeholder until an urban layer exists)
  if (!c.world.urban && c.world.site && deps.urbanPlan?.() !== false) drawSiteMarker(ctx, c.world, c.ink('ink'), sc, false);
  if (cavernFloor) {
    if (luOn && c.world.options.biome === 'underdark-caverns' && c.world.terrain.caverns?.fungalRooms?.length) {
      const rooms = exactCavernPath('fungalRooms');
      if (rooms) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = pal.landOpacity;
        setMapInk(ctx, 'fillStyle', c.ink('garden'));
        ctx.fill(rooms, 'nonzero');
        ctx.globalAlpha = 1;
        const pattern = getPattern(ctx, 'cavern-fungi', 8, 8, 0, (cx, k) => drawPanelCanvas(cx, { w: 0, h: 0, prims: underdarkMark('garden', 4 * k, 4 * k, 1.7 * k, pal, k) }, 0, 0, family));
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fill(rooms, 'nonzero');
        }
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const groundRock = deps.groundCaverns?.() ?? false;
    // The GPU ground paints the rock: erase whatever the overlay drew inside it (streams and tracks under the vault).
    if (groundRock) {
      const rock = exactCavernPath('solid');
      if (rock) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        ctx.fill(rock, 'nonzero');
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    const solid = groundRock ? null : exactCavernPath('solid'),
      floor = exactCavernPath('floor');
    if (solid) {
      ctx.fillStyle = cavernWallFill(pal);
      ctx.fill(solid, 'nonzero');
    }
    if (solid) {
      ctx.save();
      ctx.clip(solid, 'nonzero');
      const rock = getCavernRock();
      if (rock) ctx.drawImage(rock, 0, 0, S, S);
      if (floor)
        for (const rim of CAVERN_RIM) {
          ctx.globalAlpha = rim.alpha;
          ctx.strokeStyle = rim.color;
          ctx.lineWidth = rim.width;
          ctx.stroke(floor);
        }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // Typed tunnels (lava tubes, river passages) over the floor they opened.
    drawCaveTunnels(ctx, c.world.terrain.caverns?.tunnels);
  }
}

function drawTownBridge(ctx: CanvasRenderingContext2D, sh: BridgeShapes, ink: CartographyContext['ink'], sc: number): void {
  const poly = (pts: Vec2[]): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };
  ctx.lineCap = 'butt';
  if (sh.deck) {
    poly(sh.deck);
    ctx.closePath();
    setMapInk(ctx, 'fillStyle', ink('bridgeDeck'));
    ctx.globalAlpha = sh.deckAlpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (sh.seams && sc > 2) {
    poly(sh.seams.pts);
    setMapInk(ctx, 'strokeStyle', ink('bridgeInk'));
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = sh.seams.w;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  setMapInk(ctx, 'strokeStyle', ink('bridgeInk'));
  for (const l of sh.lines) {
    poly(l.pts);
    ctx.lineWidth = Math.max(l.w, 0.8 / sc);
    ctx.stroke();
  }
  if (sh.stones.length) {
    setMapInk(ctx, 'fillStyle', ink('bridgeDeck'));
    ctx.lineWidth = Math.max(0.15, 0.6 / sc);
    for (const st of sh.stones) {
      ctx.beginPath();
      ctx.arc(st.c.x, st.c.y, Math.max(st.r, 0.8 / sc), 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.lineCap = 'round';
}

function drawBridges(ctx: CanvasRenderingContext2D, world: World, ink: CartographyContext['ink'], rect: Rect4, sc: number): void {
  for (const b of world.bridges ?? []) {
    if (Math.max(b.a.x, b.b.x) < rect.minX || Math.min(b.a.x, b.b.x) > rect.maxX || Math.max(b.a.y, b.b.y) < rect.minY || Math.min(b.a.y, b.b.y) > rect.maxY) continue;
    // small town bridges (footbridges, arches, fords) at true size, by kind
    if (isKinded(b)) {
      drawTownBridge(ctx, bridgeShapes(b), ink, sc);
      continue;
    }
    const dx = b.b.x - b.a.x,
      dy = b.b.y - b.a.y,
      l = Math.hypot(dx, dy) || 1;
    const bridge = regionalBridgeSurface(b.width, sc);
    const tx = dx / l,
      ty = dy / l,
      nx = -ty,
      ny = tx,
      pad = bridge.pad;
    const h = bridge.deck / 2;
    const ax = b.a.x - tx * pad,
      ay = b.a.y - ty * pad,
      bx = b.b.x + tx * pad,
      by = b.b.y + ty * pad;
    ctx.beginPath();
    ctx.moveTo(ax + nx * h, ay + ny * h);
    ctx.lineTo(bx + nx * h, by + ny * h);
    ctx.lineTo(bx - nx * h, by - ny * h);
    ctx.lineTo(ax - nx * h, ay - ny * h);
    ctx.closePath();
    setMapInk(ctx, 'fillStyle', ink('bridgeDeck'));
    ctx.fill();
    setMapInk(ctx, 'strokeStyle', ink('bridgeInk'));
    ctx.lineCap = 'butt';
    ctx.lineWidth = bridge.rail;
    ctx.beginPath();
    ctx.moveTo(ax + nx * h, ay + ny * h);
    ctx.lineTo(bx + nx * h, by + ny * h);
    ctx.moveTo(ax - nx * h, ay - ny * h);
    ctx.lineTo(bx - nx * h, by - ny * h);
    ctx.stroke();
    ctx.lineCap = 'round';
  }
}

/** The site marker is a screen-size symbol: constant pixels at any zoom (never metres that grow with the map). */
export function drawSiteMarker(ctx: CanvasRenderingContext2D, world: World, ink: MapInk, sc: number, labels: boolean): void {
  const c = world.site!.center,
    px = (v: number): number => v / sc;
  setMapInk(ctx, 'strokeStyle', ink);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = px(0.8);
  for (const poly of world.landuse?.reserve ?? []) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (!labels) return;
  const r = px(7);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, TAU);
  setMapInk(ctx, 'strokeStyle', ink);
  ctx.lineWidth = px(1.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * 0.38, 0, TAU);
  setMapInk(ctx, 'fillStyle', ink);
  ctx.fill();
}
