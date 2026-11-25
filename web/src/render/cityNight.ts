/** Display-only moonlight and lamps. World coordinates and stable ids keep every tile and season in agreement. */
import type { CompactBuildingVisual, BuildingViewport } from './urbanBuildingLod';
import type { CityScene } from './cityCanvas';

/** Underdark roof: the culture's own colour under the cave light (no sky; lanterns light walls from the side), darker
 * than the walls and a little cooled. */
export function caveRoof(color: string): string {
  const v = parseInt(color.replace('#', ''), 16),
    rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
  const c = rgb ? rgb.slice(1).map(Number) : [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  return '#' + [c[0] * 0.5, c[1] * 0.5, c[2] * 0.55].map(x => Math.round(Math.min(255, x)).toString(16).padStart(2, '0')).join('');
}
export function nightRoof(color: string, ink = false): string {
  const v = parseInt(color.replace('#', ''), 16),
    rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
  const c = rgb ? rgb.slice(1).map(Number) : [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const y = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const out = ink ? [17 + y * 0.18, 27 + y * 0.22, 44 + y * 0.28] : [9 + c[0] * 0.19, 15 + c[1] * 0.23, 24 + c[2] * 0.29];
  return '#' + out.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}
const hash = (id: string): number => {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
const visible = (x: number, y: number, b: BuildingViewport, pad = 10): boolean => x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad;
/** Halos stay in world metres; their cores keep a subpixel visibility floor at town overview. */
export const nightWindowReach = (mpp: number): number => Math.max(6, 3.5 * mpp);
function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, reach: number, ink: boolean): void {
  const halo = reach,
    g = ctx.createRadialGradient(x, y, 0, x, y, halo);
  // A softened inverse-square falloff, cut off smoothly rather than at a hard disc edge.
  // Screen preserves the navy ground and roof detail while neighbouring pools accumulate.
  ctx.globalCompositeOperation = 'screen';
  g.addColorStop(0, `rgba(255,192,92,${ink ? 0.38 : 0.48})`);
  g.addColorStop(0.16, `rgba(255,177,67,${ink ? 0.3 : 0.38})`);
  g.addColorStop(0.38, `rgba(250,154,47,${ink ? 0.16 : 0.21})`);
  g.addColorStop(0.65, `rgba(242,133,34,${ink ? 0.065 : 0.085})`);
  g.addColorStop(0.85, 'rgba(235,119,32,.018)');
  g.addColorStop(1, 'rgba(235,119,32,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, halo, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffd58a';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff0c0';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

/** Small lit eaves/windows on a share of houses, with extra activity in closely built neighbourhoods. */
export function drawNightBuildings(ctx: CanvasRenderingContext2D, buildings: readonly CompactBuildingVisual[], box: BuildingViewport, mpp: number, ink = false): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  ctx.clip();
  for (const b of buildings) {
    const ring = b.footprint[0]?.outer;
    if (!ring?.length || b.function === 'open_space') continue;
    const h = hash(b.id),
      a = ring[h % ring.length],
      z = ring[((h % ring.length) + 1) % ring.length];
    const x = a.x * 0.6 + z.x * 0.4,
      y = a.y * 0.6 + z.y * 0.4;
    if (h % 100 > (b.function === 'mixed' || b.function === 'collective' ? 80 : 56)) continue;
    const reach = Math.max(3.5 + (h % 26) / 10, 3.5 * mpp);
    if (visible(x, y, box, reach)) lamp(ctx, x, y, Math.max(0.36, mpp * 0.75), reach, ink);
    if (h % 5 === 0 && Math.hypot(z.x - a.x, z.y - a.y) > 5) {
      const x2 = a.x * 0.25 + z.x * 0.75,
        y2 = a.y * 0.25 + z.y * 0.75,
        reach2 = Math.max(3.5, 3.5 * mpp);
      if (visible(x2, y2, box, reach2)) lamp(ctx, x2, y2, Math.max(0.28, mpp * 0.6), reach2, ink);
    }
  }
  ctx.restore();
}

const lampsOf = new WeakMap<CityScene, Float32Array>();
/** The lanterns of a town's main streets and squares: x, y, reach (m) and strength of each, kept per scene. */
export function nightLamps(scene: CityScene): Float32Array {
  const held = lampsOf.get(scene);
  if (held) return held;
  const out: number[] = [];
  for (const s of scene.streets) {
    if (s.rank > 2 || s.role === 'track' || s.role === 'ford') continue;
    const p = s.street.path,
      spacing = s.rank <= 1 ? 24 : 38;
    let next = 9 + (hash(`${s.layout}:${s.index}`) % 14);
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1],
        b = p[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      if (!len) continue;
      while (next < len) {
        const side = s.width * 0.4;
        out.push(a.x + (dx * next) / len - (dy / len) * side, a.y + (dy * next) / len + (dx / len) * side, s.rank <= 1 ? 15 : 12, 0.42);
        next += spacing;
      }
      next -= len;
    }
  }
  for (const b of scene.blocks) if (b.kind === 'place' && b.shape.outer.length) out.push(b.shape.outer[0].x, b.shape.outer[0].y, 15, 0.42);
  const lamps = Float32Array.from(out);
  lampsOf.set(scene, lamps);
  return lamps;
}

/** Sparse lanterns on main streets/squares and a restrained pool of warm haze over each town core. */
export function drawNightTown(ctx: CanvasRenderingContext2D, scene: CityScene, box: BuildingViewport, mpp: number, ink: boolean, streets: boolean): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  for (const shape of scene.footprint) {
    const p = shape.outer;
    if (!p.length) continue;
    const x = p.reduce((s, q) => s + q.x, 0) / p.length,
      y = p.reduce((s, q) => s + q.y, 0) / p.length;
    const r = Math.max(25, ...p.map(q => Math.hypot(q.x - x, q.y - y))) * 0.7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(237,151,63,${ink ? 0.025 : 0.085})`);
    g.addColorStop(0.45, `rgba(217,126,48,${ink ? 0.012 : 0.035})`);
    g.addColorStop(1, 'rgba(204,112,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (streets) {
    const lamps = nightLamps(scene);
    for (let i = 0; i < lamps.length; i += 4) {
      const x = lamps[i],
        y = lamps[i + 1],
        reach = Math.max(lamps[i + 2], 5 * mpp);
      if (visible(x, y, box, reach)) lamp(ctx, x, y, Math.max(0.4, mpp * 0.9), reach, ink);
    }
  }
  ctx.restore();
}
