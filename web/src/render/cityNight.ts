/** Display-only moonlight and lamps. World coordinates and stable ids keep every tile and season in agreement. */
import type { Surface } from '../../../rust/bridge/housesContract';
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
export const nightWindowReach = (mpp: number): number => Math.max(9, 3.5 * mpp);
/** Strength of the lights, as the tilted view's drape adds them (city/live/nightLamps.ts): a lit door, window or courtyard
 * of a house, a street lantern (dimmer and sparser than the houses: the people light a town, not its streets), a fire.
 * The top view scales its pools by strength / HOUSE_LIGHT. */
const HOUSE_LIGHT = 0.42,
  STREET_LAMP = 0.2,
  FIRE = 0.5;
/** A street lantern lights a spot (m), not the street: the houses carry the town's light. */
const LAMP_REACH = 5;
/** Distance of a house light out of its wall (m). */
const OUT = 1.5;
/** Camps: their homes are tents, yurts, tipis, huts or snow houses and no lantern stands on their paths and roads. Their
 * light is their hearths: lit doors and fires before the tents and on the common ground. */
const HEARTH_LIT = new Set(['native-plains', 'nomad-camp', 'mongol-ordu', 'inuit-camp', 'siberian-camp', 'kraal', 'orcish']);
export const hearthLit = (culture: string | undefined): boolean => !!culture && HEARTH_LIT.has(culture);
function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, reach: number, ink: boolean, gain = 1): void {
  const halo = reach,
    g = ctx.createRadialGradient(x, y, 0, x, y, halo);
  // A softened inverse-square falloff, cut off smoothly rather than at a hard disc edge.
  // Screen preserves the navy ground and roof detail while neighbouring pools accumulate.
  ctx.globalCompositeOperation = 'screen';
  g.addColorStop(0, `rgba(255,192,92,${(ink ? 0.38 : 0.48) * gain})`);
  g.addColorStop(0.16, `rgba(255,177,67,${(ink ? 0.3 : 0.38) * gain})`);
  g.addColorStop(0.38, `rgba(250,154,47,${(ink ? 0.16 : 0.21) * gain})`);
  g.addColorStop(0.65, `rgba(242,133,34,${(ink ? 0.065 : 0.085) * gain})`);
  g.addColorStop(0.85, `rgba(235,119,32,${0.018 * gain})`);
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

/** A building as its night lights read it: courtyards of the plan when its footprint has no hole for them. */
export type NightHouse = Pick<CompactBuildingVisual, 'id' | 'footprint' | 'function'> & { courtyards?: Surface };
type LightSink = (x: number, y: number, reach: number, strength: number) => void;

/** Glow of a lit courtyard (seven in ten), from its middle over about half its width. */
function courtLight(ring: readonly { x: number; y: number }[], h: number, emit: LightSink): void {
  if (ring.length < 3 || h % 10 >= 7) return;
  let x = 0,
    y = 0,
    area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i],
      q = ring[(i + 1) % ring.length];
    x += p.x;
    y += p.y;
    area += p.x * q.y - q.x * p.y;
  }
  area = Math.abs(area) / 2;
  if (area >= 4) emit(x / ring.length, y / ring.length, Math.min(8, Math.max(3, 0.6 * Math.sqrt(area))), HOUSE_LIGHT);
}

/** The lights of a house at night, x, y, reach (m) and strength each, the same in both views: on a share of houses (more in
 * shops and collective houses) a lit door or window pooling at the foot of a wall, a second one on a long wall, and its lit
 * courtyards (the holes of its footprint, else the courtyards of its plan). The top view draws them over the roofs; the
 * tilted view lays them on the ground under the volumes, where they spill into the streets and courts. */
export function nightHouseLights(b: NightHouse, emit: LightSink): void {
  const ring = b.footprint[0]?.outer;
  if (!ring?.length || b.function === 'open_space') return;
  const h = hash(b.id);
  if (h % 100 <= (b.function === 'mixed' || b.function === 'collective' ? 88 : 72)) {
    const a = ring[h % ring.length],
      z = ring[((h % ring.length) + 1) % ring.length],
      len = Math.hypot(z.x - a.x, z.y - a.y);
    // The pool lies out of the wall, on the ground before the lit door or window (OUT m): a pool centred on the wall
    // line is half under the house, and the tilted view's volumes hide the rest.
    let turn = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i],
        q = ring[(i + 1) % ring.length];
      turn += p.x * q.y - q.x * p.y;
    }
    const k = len ? (turn > 0 ? 1 : -1) * (OUT / len) : 0,
      ox = (z.y - a.y) * k,
      oy = -(z.x - a.x) * k;
    emit(a.x * 0.6 + z.x * 0.4 + ox, a.y * 0.6 + z.y * 0.4 + oy, 3.5 + (h % 26) / 10, HOUSE_LIGHT);
    if (h % 5 === 0 && len > 5) emit(a.x * 0.25 + z.x * 0.75 + ox, a.y * 0.25 + z.y * 0.75 + oy, 3.5, HOUSE_LIGHT);
  }
  let courts = 0;
  for (const s of b.footprint) for (const hole of s.holes) courtLight(hole, (h >>> 8) + 3 * courts++, emit);
  if (!courts && b.courtyards) for (const s of b.courtyards) courtLight(s.outer, (h >>> 8) + 3 * courts++, emit);
}

/** Small lit eaves/windows and courtyards on a share of houses, with extra activity in closely built neighbourhoods. */
export function drawNightBuildings(ctx: CanvasRenderingContext2D, buildings: readonly NightHouse[], box: BuildingViewport, mpp: number, ink = false): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  ctx.clip();
  const core = Math.max(0.36, mpp * 0.75),
    least = 3.5 * mpp;
  const draw: LightSink = (x, y, reach, strength) => {
    const r = Math.max(reach, least);
    if (visible(x, y, box, r)) lamp(ctx, x, y, core, r, ink, strength / HOUSE_LIGHT);
  };
  for (const b of buildings) nightHouseLights(b, draw);
  ctx.restore();
}

const lampsOf = new WeakMap<CityScene, Float32Array>();
/** The lanterns of a town's main streets and squares, and the fires of its camps (hearthLit: no lantern, a fire on each
 * common ground and before one dwelling in four, at the front of its lot): x, y, reach (m) and strength of each, kept per
 * scene. */
export function nightLamps(scene: CityScene): Float32Array {
  const held = lampsOf.get(scene);
  if (held) return held;
  const out: number[] = [],
    camp = (layout: number): boolean => hearthLit(scene.layouts[layout]?.culture);
  for (const s of scene.streets) {
    if (s.rank > 2 || s.role === 'track' || s.role === 'ford' || camp(s.layout)) continue;
    const p = s.street.path,
      spacing = s.rank <= 1 ? 30 : 46;
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
        out.push(a.x + (dx * next) / len - (dy / len) * side, a.y + (dy * next) / len + (dx / len) * side, LAMP_REACH, STREET_LAMP);
        next += spacing;
      }
      next -= len;
    }
  }
  for (const b of scene.blocks) {
    const ring = b.shape.outer;
    if (b.kind !== 'place' || !ring.length) continue;
    if (!camp(b.layout)) out.push(ring[0].x, ring[0].y, LAMP_REACH, STREET_LAMP);
    else out.push(ring.reduce((s, q) => s + q.x, 0) / ring.length, ring.reduce((s, q) => s + q.y, 0) / ring.length, 10, FIRE);
  }
  for (const p of scene.parcels) {
    const front = p.source.front;
    if (p.use !== 'plot' || !front || !camp(p.layout)) continue;
    const h = hash(p.id ?? `${p.layout}:${p.index}`);
    if (h % 4) continue;
    const t = 0.25 + ((h >>> 4) % 50) / 100;
    out.push(front[0].x + (front[1].x - front[0].x) * t, front[0].y + (front[1].y - front[0].y) * t, 5.5 + ((h >>> 10) % 25) / 10, FIRE * (0.75 + ((h >>> 16) % 50) / 100));
  }
  const lamps = Float32Array.from(out);
  lampsOf.set(scene, lamps);
  return lamps;
}

/** Sparse lanterns on main streets/squares (fires in camps) and a restrained pool of warm haze over each town core. */
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
      if (visible(x, y, box, reach)) lamp(ctx, x, y, Math.max(0.4, mpp * 0.9), reach, ink, lamps[i + 3] / HOUSE_LIGHT);
    }
  }
  ctx.restore();
}
