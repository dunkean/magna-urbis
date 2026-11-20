/** Underdark tunnels in the 2D map styles (canvas and SVG share these strokes). The terrain carve already opened
 *  each tunnel as floor between the rock; this layer only types it, discreetly:
 *  - lava tube: nothing, the bare floor of the carve;
 *  - river passage: a narrow pale ledge path beside the water of the slot;
 *  - dug tunnel (roads): bare floor at the road's width and a portal at both mouths; the road draws itself over it. */
import type { CaveTunnel, Vec2 } from '../gen/types';

export interface TunnelStroke {
  d: Vec2[];
  color: string;
  width: number;
  alpha: number;
  dash?: number[];
  cap?: CanvasLineCap;
}

function offset(path: Vec2[], by: number): Vec2[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)],
      b = path[Math.min(path.length - 1, i + 1)];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l = Math.hypot(dx, dy) || 1;
    return { x: p.x - (dy / l) * by, y: p.y + (dx / l) * by };
  });
}

/** Strokes of one tunnel in world metres, bottom first. A natural tunnel is typed at its own half width: the engine's
 *  soft rock field puts the gut's walls there whatever the terrain cell. */
export function tunnelStrokes(t: CaveTunnel): TunnelStroke[] {
  const hw = t.halfWidth;
  // A lava tube is the bare floor the carve opened: no lining, no centre line (a dark band with a dashed axis read as
  // a motorway).
  if (t.kind === 'lava-tube') return [];
  if (t.kind === 'river-passage') return [{ d: offset(t.path, 0.72 * hw), color: '#7d7488', width: Math.max(0.8, 0.22 * hw), alpha: 0.5, cap: 'round' }];
  // Dug: the road's own bore, which the terrain carve never opened. Bare trodden floor under the road (no slab, no
  // kerb lines) and a portal bar at each mouth.
  return dugStrokes(t, hw);
}

function dugStrokes(t: CaveTunnel, hw: number): TunnelStroke[] {
  const ends = [t.path[0], t.path[t.path.length - 1]];
  const portals = ends.map((p, k) => {
    const q = k ? t.path[t.path.length - 2] : t.path[1],
      dx = q.x - p.x,
      dy = q.y - p.y,
      l = Math.hypot(dx, dy) || 1;
    return [
      { x: p.x - (dy / l) * hw * 1.4, y: p.y + (dx / l) * hw * 1.4 },
      { x: p.x + (dy / l) * hw * 1.4, y: p.y - (dx / l) * hw * 1.4 },
    ];
  });
  return [{ d: t.path, color: '#706a72', width: 2 * hw, alpha: 0.35, cap: 'round' }, ...portals.map(d => ({ d, color: '#8a8094', width: Math.max(1, 0.5 * hw), alpha: 0.7, cap: 'butt' as const }))];
}

export function drawCaveTunnels(ctx: CanvasRenderingContext2D, tunnels: readonly CaveTunnel[] | undefined): void {
  if (!tunnels?.length) return;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const t of tunnels)
    for (const s of tunnelStrokes(t)) {
      if (s.d.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s.d[0].x, s.d[0].y);
      for (let i = 1; i < s.d.length; i++) ctx.lineTo(s.d[i].x, s.d[i].y);
      ctx.globalAlpha = s.alpha;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = s.cap ?? 'round';
      ctx.setLineDash(s.dash ?? []);
      ctx.stroke();
    }
  ctx.restore();
}

export function caveTunnelsSvg(tunnels: readonly CaveTunnel[] | undefined): string {
  if (!tunnels?.length) return '';
  const paths = tunnels
    .flatMap(t => tunnelStrokes(t))
    .filter(s => s.d.length >= 2)
    .map(
      s =>
        `<path d="M${s.d.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}" fill="none" stroke="${s.color}" stroke-width="${s.width.toFixed(2)}" stroke-opacity="${s.alpha}" stroke-linecap="${s.cap ?? 'round'}" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash.map(v => v.toFixed(1)).join(' ')}"` : ''}/>`,
    );
  return `<g class="layer-cave-tunnels">${paths.join('')}</g>`;
}

/** Point at distance `d` along a polyline (clamped to its ends), with the unit direction there. */
function along(path: readonly Vec2[], d: number): { p: Vec2; ux: number; uy: number } {
  let rest = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l <= 0) continue;
    const ux = (b.x - a.x) / l,
      uy = (b.y - a.y) / l;
    if (rest <= l || i === path.length - 1) {
      const t = Math.min(rest, l);
      return { p: { x: a.x + ux * t, y: a.y + uy * t }, ux, uy };
    }
    rest -= l;
  }
  return { p: path[0], ux: 1, uy: 0 };
}

/** 3D ground: a framed dark opening at both mouths of each dug tunnel. The dug span starts about a terrain cell
 *  out on the open floor; the opening is painted from there into the rock, so the ground texture draped on the
 *  rising rock face shows a doorway where the road enters. The road itself is hidden between them by the raised
 *  rock. World-metre transform already set; nothing runs per frame (ground tiles are cached). */
export function drawTunnelPortals(ctx: CanvasRenderingContext2D, tunnels: readonly CaveTunnel[] | undefined, cell: number, mpp: number): void {
  for (const t of tunnels ?? []) {
    if (t.kind !== 'dug' || t.path.length < 2) continue;
    const hw = Math.max(t.halfWidth * 1.3, mpp * 1.5),
      reverse = [...t.path].reverse();
    for (const path of [t.path, reverse]) {
      const { p, ux, uy } = along(path, 0.8 * cell),
        depth = Math.max(1.6 * cell, 4 * mpp);
      const nx = -uy,
        ny = ux;
      const corner = (s: number, d: number) => ({ x: p.x + nx * s + ux * d, y: p.y + ny * s + uy * d });
      const quad = [corner(-hw, 0), corner(hw, 0), corner(hw, depth), corner(-hw, depth)];
      ctx.beginPath();
      quad.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#0b0a0e';
      ctx.fill();
      // Dressed frame: jambs and lintel in pale worked stone.
      ctx.beginPath();
      for (const s of [-hw, hw]) {
        const a = corner(s, 0),
          b = corner(s, depth);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      const l0 = corner(-hw * 1.15, 0),
        l1 = corner(hw * 1.15, 0);
      ctx.moveTo(l0.x, l0.y);
      ctx.lineTo(l1.x, l1.y);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#8a8094';
      ctx.lineWidth = Math.max(0.6, hw * 0.22);
      ctx.lineCap = 'butt';
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
