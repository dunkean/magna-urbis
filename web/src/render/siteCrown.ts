import { roleFamily as serviceFamily } from './cityRoles';
import { hash } from './city3d/massing';
import { insetRing, ringArea, RoofBuilder } from './city3d/roofGeometry';
import { architectureUse, type SiteBuilding } from './siteArchitecture';
import type { Point } from '../../../rust/bridge/housesContract';
import type { OverviewVolume } from './urbanBuildingGeometry';

const cache = new WeakMap<SiteBuilding, ReturnType<typeof makeCrown>>();
export function siteCrown(building: SiteBuilding) {
  if (!cache.has(building)) cache.set(building, makeCrown(building));
  return cache.get(building);
}

/** Dress the uppermost substantial body once. The plan, corner count, tiers and culture come from the engine. */
function makeCrown(b: SiteBuilding) {
  const use = architectureUse(b);
  if (use !== 'marker' && use !== 'gate' && use !== 'sanctuary' && use !== 'hall') return;
  const monument = use === 'marker';
  const v = (b.volumes as OverviewVolume[])
    .filter(v => v.role !== 'minor' && !v.displayTree && v.envelope !== 'open' && v.footprint.length === 1 && !v.footprint[0].holes.length && v.footprint[0].outer.length >= 3 && v.wall_height_m >= (monument ? 0.65 : 2.9))
    .sort((a, c) => c.z_m + c.wall_height_m - (a.z_m + a.wall_height_m))[0];
  if (!v) return;
  const src = v.footprint[0].outer,
    area = ringArea(src);
  if (Math.abs(area) < (monument ? 0.18 : 6)) return;
  const ring = area < 0 ? [...src].reverse() : src;
  const eave = v.z_m + v.wall_height_m,
    family = serviceFamily(b.culture?.culture);
  const bracketed = family === 'chinese' || family === 'japanese' || family === 'indian' || family === 'norse' || /wood|timber|bamboo/.test(v.materials.coating);
  const stone = v.materials.coating,
    beam = bracketed ? 'city3d:detail:corbel-timber@79583e' : stone;
  const mesh = new RoofBuilder();
  // Project mouldings along the actual perimeter, including octagonal drums and asymmetric plans.
  const band = (base: number, profile: readonly (readonly [number, number])[]) => {
    const sections = profile.map(([projection, z]) => insetRing(ring, -projection, true).map(p => ({ ...p, z: base + z })));
    for (let k = 1; k < sections.length; k++) {
      const lower = sections[k - 1],
        upper = sections[k];
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        mesh.face([lower[i], lower[j], upper[j], upper[i]], stone);
      }
    }
  };
  if (monument) {
    const unit = Math.min(0.32, Math.sqrt(Math.abs(area)) * 0.09, v.wall_height_m * 0.12);
    for (const base of [v.z_m + 0.03, eave - unit]) {
      band(base, [
        [0, 0],
        [unit * 0.75, unit * 0.16],
        [unit, unit * 0.49],
        [unit, unit * 0.7],
        [0, unit],
      ]);
    }
    return { volume: v, mesh: mesh.mesh() };
  }
  const height = Math.min(0.38, v.wall_height_m * 0.052);
  band(eave - height, [
    [0, 0],
    [0.09, height * 0.28],
    [0.11, height * 0.63],
    [0.2, height * 0.79],
    [0.2, height],
    [0, height],
  ]);
  const fortified = use === 'gate',
    flat = v.roof_height_m < 0.12;
  const modern = family === 'modernist' || family === 'contemporary' || family === 'industrial' || family === 'futuristic';
  // Crenels on a flat fortified crown. A roofed tower takes projecting brackets under the eaves.
  const crenels = fortified && flat && !modern && !bracketed;
  // A timber hoarding cantilevers off the upper wall of a compact, roofed keep.
  const hoarding = fortified && !flat && ['european', 'norse'].includes(family ?? '') && v.wall_height_m >= 7 && v.wall_height_m > 0.64 * Math.sqrt(Math.abs(area)) && ring.length <= 16;
  const outer = hoarding ? insetRing(ring, -0.78, true) : undefined;
  const spacing = (crenels ? 2.0 : bracketed ? 1.9 : 2.6) + (hash(b.id) % 5) * 0.095;
  const at = (a: Point, ux: number, uy: number, s: number, out: number, z: number) => ({ x: a.x + ux * s + uy * out, y: a.y + uy * s - ux * out, z });
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      c = ring[(i + 1) % ring.length],
      len = Math.hypot(c.x - a.x, c.y - a.y);
    if (outer) {
      const end = (i + 1) % ring.length,
        frontA = outer[i],
        frontB = outer[end];
      const foot = eave - 1.38,
        plank = 'city3d:wall:wood@81694e',
        rail = 'city3d:wall:timber@594b3a';
      const atFront = (t: number, z: number) => ({ x: frontA.x + (frontB.x - frontA.x) * t, y: frontA.y + (frontB.y - frontA.y) * t, z });
      const panel = (from: number, to: number, low: number, high: number, material: string) => mesh.face([atFront(from, low), atFront(to, low), atFront(to, high), atFront(from, high)], material);
      // Sloping lean-to, boarded sill and open viewing slots. The panels meet at mitred corners.
      mesh.face([{ ...a, z: eave - 0.05 }, atFront(0, eave - 0.36), atFront(1, eave - 0.36), { ...c, z: eave - 0.05 }], v.materials.cladding);
      mesh.face([{ ...a, z: foot }, atFront(0, foot), atFront(1, foot), { ...c, z: foot }], plank);
      panel(0, 1, foot, foot + 0.54, plank);
      panel(0, 1, foot + 0.54, foot + 0.62, rail);
      panel(0, 1, eave - 0.46, eave - 0.36, rail);
      const bays = Math.max(1, Math.min(12, Math.round(len / 1.45)));
      for (let j = 0; j < bays; j++) {
        const t = (j + 0.5) / bays,
          half = 0.11 / bays;
        panel(t - half, t + half, foot + 0.62, eave - 0.46, rail);
        const brace = (offset: number, front: boolean, z: number) => {
          const s = t + offset;
          return front ? atFront(s, z) : { x: a.x + (c.x - a.x) * s, y: a.y + (c.y - a.y) * s, z };
        };
        for (const sign of [-1, 1]) {
          const w = (sign * 0.075) / Math.max(len, 0.3);
          mesh.face([brace(w, false, foot - 0.66), brace(w, true, foot), brace(w, true, foot + 0.12), brace(w, false, foot - 0.43)], rail);
        }
        const w = 0.075 / Math.max(len, 0.3);
        mesh.face([brace(-w, false, foot - 0.66), brace(w, false, foot - 0.66), brace(w, true, foot), brace(-w, true, foot)], rail);
      }
      continue;
    }
    const n = Math.min(8, Math.floor(len / spacing));
    if (!n) continue;
    const ux = (c.x - a.x) / len,
      uy = (c.y - a.y) / len;
    for (let j = 0; j < n; j++) {
      const mid = ((j + 0.5) * len) / n;
      const width = crenels ? Math.min(0.95, (len / n) * 0.48) : bracketed ? 0.19 : 0.24;
      const base = crenels ? eave : eave - height - (bracketed ? 0.45 : 0.22);
      const high = crenels ? eave + Math.min(1.18, v.wall_height_m * 0.135) : eave - height * 0.38;
      const back = crenels ? -0.28 : -0.015,
        lip = crenels ? 0.095 : bracketed ? 0.39 : 0.18;
      const pts = (z: number, front: number) =>
        [
          [-width / 2, back],
          [width / 2, back],
          [width / 2, front],
          [-width / 2, front],
        ].map(([s, d]) => at(a, ux, uy, mid + s, d, z));
      const bottom = pts(base, crenels ? lip : 0.045),
        top = pts(high, lip);
      const material = crenels ? stone : beam;
      mesh.face(top.slice().reverse(), material);
      for (let k = 0; k < 4; k++) {
        const l = (k + 1) % 4;
        mesh.face([bottom[l], bottom[k], top[k], top[l]], material);
      }
    }
  }
  return { volume: v, mesh: mesh.mesh() };
}
