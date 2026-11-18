/**
 * Myconid dwellings in 3D: a building whose massing volume has the `mushroom` form (massing.rs gives it a round
 * footprint, a short body and a dome) is drawn as a giant amanita of the Underdark's mushroom family
 * (render/fungusForms.ts): the cap is the roof, broad and nearly flat on top with pale warts, overhanging the footprint;
 * its underside is a deep rounded gill skirt that hangs below the rim; a ring (annulus) circles the stem. The body is
 * the stem and keeps its doors and windows (city3dMeshes.ts volumeDetails). Heights follow the massing: the gills
 * meet the stem at the eave, the top is at eave + rise. One building stays one building: only the roof faces change.
 */
import { FUNGUS_AMANITA } from './fungusForms';

interface Point {
  x: number;
  y: number;
}
interface Vertex3 {
  x: number;
  y: number;
  z: number;
}
interface FaceSink {
  face(points: Vertex3[], material: string): void;
}

const hashOf = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const hex = (c: readonly number[]): string =>
  c
    .map(v =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
/** Restrained amanita caps: muted red, ochre, umber; pale warts and gills. */
const CAPS = [
  [0.5, 0.22, 0.17],
  [0.58, 0.42, 0.22],
  [0.4, 0.3, 0.24],
  [0.46, 0.27, 0.3],
] as const;

/** The amanita cap of a dwelling over its round footprint `ring`, gills at `base + eave`, top at `base + eave + rise`. */
export function mushroomDwellingCap(sink: FaceSink, ring: readonly Point[], base: number, eave: number, rise: number, seed: string, cladding: string, landmark: boolean): void {
  if (ring.length < 3) return;
  const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length,
    cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
  const radius = ring.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / ring.length,
    h = hashOf(seed);
  const cap = radius * (landmark ? 1.45 : 1.18 + 0.12 * h),
    stem = radius * 0.3,
    top = Math.max(rise, cap * 0.42),
    floor = base + Math.min(eave, 1.9);
  const tone = 0.9 + 0.25 * hashOf(`${seed}:tone`),
    colour = CAPS[Math.floor(hashOf(`${seed}:tint`) * CAPS.length)].map(v => v * tone);
  const capMaterial = `${cladding}@${hex(colour)}`,
    gillMaterial = `${cladding}@${hex([0.7, 0.65, 0.56])}`,
    paleMaterial = `${cladding}@${hex([0.8, 0.78, 0.72])}`;
  const segments = 20,
    turn = h * 6.283;
  const point = (r: number, angle: number, z: number): Vertex3 => ({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, z });
  const rings = FUNGUS_AMANITA.map(([a, b, y]) => ({ r: a * stem + b * cap, z: Math.max(floor, base + eave + y * top) }));
  for (let r = 0; r + 1 < rings.length; r++) {
    // Rings 0-3 run under the cap (gill skirt down to the rim), 3-7 over it.
    const material = r < 3 ? gillMaterial : capMaterial;
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * 6.283 + turn,
        a1 = ((s + 1) / segments) * 6.283 + turn;
      const p = [point(rings[r].r, a0, rings[r].z), point(rings[r].r, a1, rings[r].z), point(rings[r + 1].r, a1, rings[r + 1].z), point(rings[r + 1].r, a0, rings[r + 1].z)];
      sink.face(rings[r + 1].r < 1e-6 ? p.slice(0, 3) : p, material);
    }
  }
  // Pale warts scattered over the nearly flat top.
  const warts = 5 + Math.floor(7 * hashOf(`${seed}:warts`)),
    topZ = rings[rings.length - 1].z,
    rim = rings[4];
  for (let k = 0; k < warts; k++) {
    const a = hashOf(`${seed}:w${k}`) * 6.283,
      d = Math.sqrt(hashOf(`${seed}:d${k}`)) * cap * 0.78,
      size = cap * (0.05 + 0.05 * hashOf(`${seed}:s${k}`));
    const z = topZ + (rim.z - topZ) * Math.min(1, (d / cap) ** 2) + 0.06,
      wx = cx + Math.cos(a) * d,
      wy = cy + Math.sin(a) * d;
    sink.face(
      Array.from({ length: 6 }, (_, i) => ({ x: wx + Math.cos(i * 1.047) * size, y: wy + Math.sin(i * 1.047) * size, z })),
      paleMaterial,
    );
  }
  // The ring (annulus) around the stem, two thirds up the wall: a short flared skirt.
  const z1 = base + Math.max(1.9, eave * 0.72),
    z0 = z1 - 0.45;
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * 6.283,
      a1 = ((s + 1) / segments) * 6.283;
    sink.face([point(stem * 1.04, a0, z1), point(stem * 1.04, a1, z1), point(stem * 1.42, a1, z0), point(stem * 1.42, a0, z0)], paleMaterial);
  }
}
