/** Display-only moonlight and lamps. World coordinates and stable ids keep every tile and season in agreement. */
import type { CompactBuildingVisual, BuildingViewport } from './urbanBuildingLod';
import type { CityScene } from './cityCanvas';

export function nightRoof(color: string, ink = false): string {
  const v = parseInt(color.replace('#', ''), 16), rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
  const c = rgb ? rgb.slice(1).map(Number) : [v >> 16 & 255, v >> 8 & 255, v & 255];
  const y = c[0] * .3 + c[1] * .59 + c[2] * .11;
  const out = ink ? [38 + y * .30, 54 + y * .32, 73 + y * .34] : [9 + c[0] * .19, 15 + c[1] * .23, 24 + c[2] * .29];
  return '#' + out.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}
const hash = (id: string): number => { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const visible = (x: number, y: number, b: BuildingViewport, pad = 10): boolean => x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad;
/** Radii are world metres; only the visibility floor follows metres per CSS pixel. */
export const nightWindowReach = (mpp: number): number => Math.max(6, 3.5 * mpp);
function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, reach: number, ink: boolean): void {
  const halo = reach, g = ctx.createRadialGradient(x, y, 0, x, y, halo);
  // A softened inverse-square falloff, cut off smoothly rather than at a hard disc edge.
  // Screen preserves the navy ground and roof detail while neighbouring pools accumulate.
  ctx.globalCompositeOperation = 'screen';
  g.addColorStop(0, `rgba(255,192,92,${ink ? .38 : .48})`);
  g.addColorStop(.16, `rgba(255,177,67,${ink ? .30 : .38})`);
  g.addColorStop(.38, `rgba(250,154,47,${ink ? .16 : .21})`);
  g.addColorStop(.65, `rgba(242,133,34,${ink ? .065 : .085})`);
  g.addColorStop(.85, 'rgba(235,119,32,.018)'); g.addColorStop(1, 'rgba(235,119,32,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, halo, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffd58a'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff0c0'; ctx.beginPath(); ctx.arc(x, y, radius * .38, 0, Math.PI * 2); ctx.fill();
}

/** Small lit eaves/windows on a share of houses, with extra activity in closely built neighbourhoods. */
export function drawNightBuildings(ctx: CanvasRenderingContext2D, buildings: readonly CompactBuildingVisual[], box: BuildingViewport, mpp: number, ink = false): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY); ctx.clip();
  for (const b of buildings) {
    const ring = b.footprint[0]?.outer; if (!ring?.length || b.function === 'open_space') continue;
    const h = hash(b.id), a = ring[h % ring.length], z = ring[(h % ring.length + 1) % ring.length];
    const x = a.x * .6 + z.x * .4, y = a.y * .6 + z.y * .4;
    if (h % 100 > (b.function === 'mixed' || b.function === 'collective' ? 80 : 56)) continue;
    const reach = Math.max(3.5 + (h % 26) / 10, 3.5 * mpp);
    if (visible(x, y, box, reach)) lamp(ctx, x, y, Math.max(.36, Math.min(.85, mpp * .85)), reach, ink);
    if (h % 5 === 0 && Math.hypot(z.x - a.x, z.y - a.y) > 5) {
      const x2 = a.x * .25 + z.x * .75, y2 = a.y * .25 + z.y * .75, reach2 = Math.max(3.5, 3.5 * mpp);
      if (visible(x2, y2, box, reach2)) lamp(ctx, x2, y2, Math.max(.28, Math.min(.65, mpp * .65)), reach2, ink);
    }
  }
  ctx.restore();
}

/** Sparse lanterns on main streets/squares and a restrained pool of warm haze over each town core. */
export function drawNightTown(ctx: CanvasRenderingContext2D, scene: CityScene, box: BuildingViewport, mpp: number, ink: boolean, streets: boolean): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY); ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  for (const shape of scene.footprint) {
    const p = shape.outer; if (!p.length) continue;
    const x = p.reduce((s, q) => s + q.x, 0) / p.length, y = p.reduce((s, q) => s + q.y, 0) / p.length;
    const r = Math.max(25, ...p.map(q => Math.hypot(q.x - x, q.y - y))) * .7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(237,151,63,${ink ? .025 : .085})`); g.addColorStop(.45, `rgba(217,126,48,${ink ? .012 : .035})`); g.addColorStop(1, 'rgba(204,112,36,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  if (streets) for (const s of scene.streets) {
    if (s.rank > 2 || s.role === 'track' || s.role === 'ford') continue;
    const p = s.street.path, spacing = s.rank <= 1 ? 24 : 38;
    let next = 9 + hash(`${s.layout}:${s.index}`) % 14;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); if (!len) continue;
      while (next < len) {
        const side = s.width * .40, x = a.x + dx * next / len - dy / len * side, y = a.y + dy * next / len + dx / len * side;
        const reach = Math.max(s.rank <= 1 ? 15 : 12, 5 * mpp);
        if (visible(x, y, box, reach)) lamp(ctx, x, y, Math.max(.4, Math.min(.95, mpp)), reach, ink);
        next += spacing;
      }
      next -= len;
    }
  }
  for (const b of scene.blocks) if (b.kind === 'place' && b.shape.outer.length) {
    const p = b.shape.outer[0], reach = Math.max(15, 5 * mpp);
    if (visible(p.x, p.y, box, reach)) lamp(ctx, p.x, p.y, Math.max(.5, Math.min(1.1, mpp)), reach, ink);
  }
  ctx.restore();
}
