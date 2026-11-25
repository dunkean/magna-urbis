import type { ArchitectureVolume } from '../../../rust/bridge/urbanArchitecture';
import { hash } from './city3d/massing';
import { buildHouseFront, type HouseFront } from './houseFrontKit';
import type { BuildingVector } from './urbanBuildingGeometry';

type XY = { x: number; y: number };
const corkSkin = 'city3d:cover:cuticle@827d68',
  paleLip = 'city3d:cover:cuticle@b6a586';

/** Small glazed bays set on the actual wall facets. The glass lies behind a thick return,
 * with a narrow warm pane, a dark head and an eyebrow to shed drips from the cap. */
function fungalWindows(g: HouseFront, ring: XY[], cx: number, cy: number, h: number, seed: number) {
  const count = ring.length,
    n = count >= 10 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const j = ((seed % count) + Math.floor((k * count) / n)) % count,
      a = ring[j],
      b = ring[(j + 1) % count];
    const x = (a.x + b.x) * 0.5 - cx,
      y = (a.y + b.y) * 0.5 - cy;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.03) continue;
    const tx = (b.x - a.x) / len,
      ty = (b.y - a.y) / len,
      sign = ty * x - tx * y < 0 ? -1 : 1;
    const nx = ty * sign,
      ny = -tx * sign,
      width = Math.min(0.58, Math.max(0.31, len * 0.87), Math.hypot(x, y) * 0.48);
    const height = Math.min(0.35, h * 0.145),
      sill = h * (0.38 + 0.045 * ((seed >>> (k * 3)) % 3));
    const at = (s: number, z: number, out: number): BuildingVector => [x + tx * s * width + nx * out, y + ty * s * width + ny * out, sill + z * height];
    const shape = [
      [-1, 0.22],
      [-0.77, -0.46],
      [-0.24, -0.78],
      [0.45, -0.7],
      [0.91, -0.31],
      [1, 0.26],
      [0.52, 0.79],
      [-0.29, 0.88],
      [-0.82, 0.59],
    ];
    const lip = shape.map(([s, z]) => at(s, z, 0.19 + Math.max(z, 0) * 0.08));
    const core = shape.map(([s, z]) => at(s * 0.82, z * 0.75, 0.025));
    const outside = shape.map(([s, z]) => at(s * 1.18, z * 1.31, 0.012));
    const polygon = (vs: BuildingVector[], mat: string) => g.face(sign < 0 ? vs.slice().reverse() : vs, mat);
    polygon(core, 'city3d:detail:resin-glass@866946');
    polygon([at(-0.5, -0.18, 0.032), at(0.09, -0.38, 0.032), at(0.54, -0.2, 0.032), at(0.5, 0.22, 0.032), at(-0.1, 0.43, 0.032), at(-0.52, 0.26, 0.032)], 'city3d:detail:resin-glass@b19159');
    for (let i = 0; i < shape.length; i++) {
      const q = (i + 1) % shape.length;
      polygon([outside[i], outside[q], lip[q], lip[i]], i >= 5 ? paleLip : 'city3d:cover:cuticle@978974');
      polygon([lip[i], lip[q], core[q], core[i]], i >= 5 ? 'city3d:detail:reveal@5a5143' : 'city3d:detail:reveal@786952');
    }
    g.beam(at(-0.1, -0.51, 0.047), at(0.1, 0.6, 0.047), 0.038, 'city3d:detail:fungal-sash@655541');
  }
}

/** Storage cells and attached living chambers grow a low, overlapping cuticle over their original footprint.
 * Each shell closes down over a raised, weathered rim; no spherical dome is left between these smaller shelters. */
function annex(g: HouseFront, ring: XY[], cx: number, cy: number, h: number, rise: number, seed: number) {
  const rot = ((seed % 797) * Math.PI * 2) / 797,
    dx = Math.cos(rot),
    dy = Math.sin(rot);
  const radius = ring.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / ring.length;
  const roofRise = Math.max(0.22, Math.min(rise * 0.6, radius * 0.47));
  const row = (scale: number, drift: number, up: number) =>
    ring.map((p): BuildingVector => {
      const x = p.x - cx,
        y = p.y - cy,
        t = Math.atan2(y, x);
      return [x * scale + dx * drift * radius, y * scale + dy * drift * radius, h + roofRise * (up + scale * (0.11 * Math.sin(t - rot) + 0.06 * Math.sin(3 * t + 0.8)))];
    });
  const bands = [row(0.97, 0, -0.16), row(1.055, 0, -0.12), row(1.075, 0, 0.09), row(0.82, -0.04, 0.29), row(0.79, -0.045, 0.23), row(0.64, -0.085, 0.47), row(0.27, -0.17, 0.66)];
  const mats = ['city3d:cover:pores@99907b', paleLip, corkSkin, 'city3d:cover:cuticle@9e917b', 'city3d:cover:cuticle@807866', 'city3d:cover:cuticle@8e8772'];
  const clockwise =
    ring.reduce((tot, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return tot + a.x * b.y - b.x * a.y;
    }, 0) < 0;
  const face = (pts: BuildingVector[], material: string) => g.face(clockwise ? pts.slice().reverse() : pts, material);
  for (let j = 1; j < bands.length; j++)
    for (let i = 0; i < ring.length; i++) {
      const k = (i + 1) % ring.length;
      face([bands[j - 1][i], bands[j - 1][k], bands[j][k], bands[j][i]], mats[j - 1]);
    }
  face(bands[bands.length - 1], corkSkin);
}

/** Layered fruiting bodies: sessile brackets carry a pale pore surface; oyster-like fans
 * have decurrent lamellae. Each lobe grows from inside the generated stem footprint. */
export function fungalDwelling(volume: ArchitectureVolume) {
  const source = volume.roof_mesh,
    ring = volume.footprint[0]?.outer;
  if (!ring?.length) return source;
  const seed = hash(volume.id) >>> 0,
    turn = ((seed % 8191) * Math.PI * 2) / 8191;
  const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length,
    cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
  const r = ring.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / ring.length;
  const raw = volume.materials.cladding;
  // The main fruiting body has gills and secondary cap tints. A plain domed side cell has ordinary roof pans.
  const fruiting = source.faces.some(f => f.material.startsWith(raw + '@'));
  if (!fruiting && (!source.faces.some(f => f.material === raw) || ring.length < 5 || volume.footprint[0].holes.length)) return source;
  const h = volume.wall_height_m,
    rise = Math.max(volume.roof_height_m, r * 0.26);
  const oyster = seed % 3 !== 0,
    tiered = seed % 3 === 1,
    phases = 3 + (seed % 3);
  const palettes = oyster ? ['827666', '928272', '797a68', 'a39277'] : ['6a5946', '765f4b', '776f55', '715f52'];
  const base = palettes[(seed >>> 5) % palettes.length],
    cap = 'city3d:cover:cuticle@' + base;
  const rim = 'city3d:cover:cuticle@' + (oyster ? 'c6b99e' : 'bdaa87'),
    under = 'city3d:cover:' + (oyster ? 'cuticle@baa990' : 'pores@b8b099');
  const flesh = 'city3d:detail:lamella@a89982';
  const mesh = buildHouseFront({ x: cx, y: cy, z: volume.z_m, nx: 0, ny: 1 }, { width: r * 2, depth: r, height: h, floor: 0, wall: volume.materials.coating, cover: raw, seed }, g => {
    const stalk = volume.levels[0]?.footprint?.[0]?.outer;
    if (stalk?.length) fungalWindows(g, stalk, cx, cy, h, seed);
    if (!fruiting) {
      annex(g, ring, cx, cy, h, rise, seed);
      return;
    }
    const fan = (angle: number, size: number, level: number, main: boolean, idx: number) => {
      const n = main ? 28 : 18,
        lift = rise * (main ? 0.78 : 0.32),
        shift = size * (main ? 0.24 : 0.72),
        ex = Math.cos(angle),
        ey = Math.sin(angle);
      const pos = (a: number, rad: number, z: number): BuildingVector => {
        const ct = Math.cos(a),
          st = Math.sin(a),
          edge = 1 + 0.065 * Math.sin(3 * a + turn) + 0.038 * Math.cos(5 * a - idx);
        const x = rad * size * edge * ct + shift,
          y = rad * size * edge * st * (main ? 0.75 : 0.63);
        return [ex * x - ey * y, ey * x + ex * y, level + z + rad * size * (0.092 * ct + 0.055 * Math.sin(3 * a + turn)) + rad * rad * 0.045 * size * Math.sin(7 * a - idx)];
      };
      const points = (rad: number, z: number) => Array.from({ length: n }, (_, i) => pos((i * 2 * Math.PI) / n, rad, z));
      const shell = [points(0.03, lift * 0.73), points(0.29, lift), points(0.64, lift * 0.65), points(0.91, lift * 0.22), points(1, 0), points(0.975, -0.075 * size), points(0.6, -0.1 * size), points(0.15, -0.18 * size)];
      g.face(shell[0], cap);
      for (let band = 0; band < shell.length - 1; band++) {
        const mat = band === 4 ? rim : band >= 5 ? under : band === 3 && !oyster ? 'city3d:cover:cuticle@a58c70' : cap;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          g.face([shell[band][i], shell[band + 1][i], shell[band + 1][j], shell[band][j]], mat);
        }
      }
      if (oyster) {
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * (i + 0.38)) / n,
            b = a + 0.032;
          const edge = pos(a, 0.93, -0.09 * size),
            inner = pos(a + 0.12, 0.16, -0.22 * size),
            middle = pos(a + 0.04, 0.59, -0.19 * size);
          g.face([inner, middle, edge, pos(b, 0.59, -0.096 * size)], flesh);
        }
      }
    };
    // Overlapping tiers share the same stem. Their high rims tilt in different directions.
    for (let j = 0; j < (tiered ? 3 : 2); j++) {
      const a = turn + ((j + 0.27) * 2 * Math.PI) / phases;
      fan(a, r * (0.66 + ((seed >>> (j * 4)) & 3) * 0.046), h + rise * (-0.02 + j * 0.16), false, j);
    }
    fan(turn, r * (oyster ? 0.86 : 0.92), h + rise * (tiered ? 0.55 : 0.4), true, 5);
    // Four root-like pleats carry the off-centre shelves into the stalk. A gap stays clear at ground level.
    for (let k = 0; k < 4; k++) {
      const a = turn + (k * Math.PI) / 2,
        s = Math.sin(a),
        c = Math.cos(a),
        width = r * 0.075;
      const pt = (rr: number, v: number, z: number): BuildingVector => [rr * c - v * s, rr * s + v * c, z];
      g.face([pt(r * 0.3, -width, h * 0.37), pt(r * 0.36, 0, h * 0.42), pt(r * 0.56, 0, h + 0.1 * rise), pt(r * 0.31, -width, h + 0.14 * rise)], flesh);
      g.face([pt(r * 0.36, 0, h * 0.42), pt(r * 0.3, width, h * 0.37), pt(r * 0.31, width, h + 0.14 * rise), pt(r * 0.56, 0, h + 0.1 * rise)], under);
    }
  });
  // Retain windows, doors and structural fittings; discard the previous spotted cap, gills and collar together.
  const keep = source.faces.filter(f => (fruiting ? !f.material.startsWith(raw + '@') : f.material !== raw));
  if (!keep.length) return mesh;
  const offset = mesh.vertices.length;
  return { ...source, vertices: [...mesh.vertices, ...source.vertices], faces: [...mesh.faces, ...keep.map(f => ({ ...f, vertices: f.vertices.map(i => i + offset) }))] };
}
