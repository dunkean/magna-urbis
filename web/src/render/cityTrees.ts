import type { Point, Vertex3 } from '../../../rust/bridge/housesContract';

export const TREE_FAMILIES = ['oak', 'umbrella', 'oval', 'willow', 'cluster'] as const;
/** `tone`: seeded colour variation, independent of the crown's height. */
export interface TreeCrown { x: number; y: number; rx: number; ry: number; z: number; height: number; skirt: number; lobes: number; phase: number; tone: number }
export interface TreePlatform { height: number; radius: number; angle: number; shape: 'round' | 'polygon' | 'partial' }
export interface TreeDwelling {
  family: typeof TREE_FAMILIES[number]; center: Point; radius: number; height: number; scale: number; trunkRadius: number; lean: Point;
  crowns: TreeCrown[]; platforms: TreePlatform[]; outline: Point[];
  /** Town of many tree dwellings: same silhouette, about a seventh of the faces. */
  light?: boolean;
}
function hash(seed: string): number { let h = 2166136261; for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619); return h >>> 0; }
/** One lot seed drives both renderers; no dependence on scene order or reload. */
export function treeDwelling(ring: readonly Point[], eave: number, rise: number, seed: string): TreeDwelling {
  let state = hash(seed);
  const draw = (): number => { state += 0x6d2b79f5; let t = Math.imul(state ^ state >>> 15, state | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const family = TREE_FAMILIES[Math.floor(draw() * TREE_FAMILIES.length)], scale = 0.75 + draw() * 0.5, heightScale = 0.75 + draw() * 0.5;
  const center = { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length };
  // Old broadleaf giants: the crown is about as wide as the tree is tall and spreads well beyond the dwelling's lot.
  const radius = Math.max(3.4 * scale, Math.max(0.1, Math.min(...ring.map(p => Math.hypot(p.x - center.x, p.y - center.y)))) * 1.25 * scale);
  const height = eave * heightScale, angle = draw() * Math.PI * 2, lean = { x: Math.cos(angle) * radius * 0.1, y: Math.sin(angle) * radius * 0.1 };
  const trunkRadius = radius * (0.17 + draw() * 0.05), phase = draw() * Math.PI * 2;
  const tall = family === 'oval' ? 1.9 : family === 'umbrella' ? 0.62 : family === 'willow' ? 1.1 : 1.25, skirt = family === 'willow' ? 0.95 : 0.22;
  const cx = center.x + lean.x, cy = center.y + lean.y, crowns: TreeCrown[] = [];
  const crown = (x: number, y: number, r: number, z: number, h: number, tone: number, a: number): void => {
    crowns.push({ x, y, rx: r * (family === 'umbrella' ? 1.12 : family === 'oval' ? 0.8 : 1), ry: r * (family === 'umbrella' ? 0.92 : 1), z, height: Math.max(0.6, h), skirt, lobes: family === 'willow' ? 7 : 5, phase: a, tone });
  };
  // A broad central mass, an irregular ring of lobes at several heights, and a top lobe.
  crown(cx, cy, radius * 0.66, height - radius * 0.1, radius * 0.66 * tall, 0.4, phase);
  const count = (family === 'cluster' ? 5 : 4) + Math.floor(draw() * 2);
  for (let i = 0; i < count; i++) {
    const a = phase + i * Math.PI * 2 / count + (draw() - 0.5) * 0.8, d = radius * (0.36 + draw() * 0.2), r = radius * (0.4 + draw() * 0.16);
    crown(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, height + radius * (-0.22 + draw() * 0.32), r * tall * (0.85 + draw() * 0.3), 0.12 + draw() * 0.45, a);
  }
  crown(cx - radius * 0.1, cy - radius * 0.12, radius * 0.42, height + radius * 0.4, radius * 0.42 * tall, 1, phase + 1.3);
  // Separate colour randomness preserves the geometry/platform random stream.
  for (let i = 0; i < crowns.length; i++) crowns[i].tone = hash(`${i}:crown:${seed}`) / 0xffffffff;
  const platforms: TreePlatform[] = Array.from({ length: 1 + Math.floor(draw() * 3) }, (_, i) => ({ height: height * (0.3 + i * 0.16 + draw() * 0.08), radius: radius * (0.44 + draw() * 0.24), angle: phase + i * 2.4, shape: (['round', 'polygon', 'partial'] as const)[Math.floor(draw() * 3)] }));
  // Radial union of overlapping broadleaf crowns, shared by picking and plan ink.
  const outline = Array.from({ length: 48 }, (_, i) => {
    const a = i * Math.PI / 24, dx = Math.cos(a), dy = Math.sin(a); let reach = 0;
    for (const c of crowns) {
      const x = center.x - c.x, y = center.y - c.y, aa = (dx / c.rx) ** 2 + (dy / c.ry) ** 2, b = x * dx / c.rx ** 2 + y * dy / c.ry ** 2, cc = (x / c.rx) ** 2 + (y / c.ry) ** 2 - 1;
      const disc = b * b - aa * cc;
      if (disc >= 0) reach = Math.max(reach, (-b + Math.sqrt(disc)) / aa * (1 + 0.045 * Math.cos(c.lobes * a + c.phase)));
    }
    return { x: center.x + reach * dx, y: center.y + reach * dy };
  });
  return { family, center, radius, height, scale, trunkRadius, lean, crowns, platforms, outline };
}
/** Crowns of the light mesh: the central mass, every other lobe of the ring, the top. */
export const lightCrowns = (tree: TreeDwelling): TreeCrown[] => tree.crowns.filter((_, i) => i === 0 || i === tree.crowns.length - 1 || i % 2 === 1);
/** Rounded shoulders and a broad top on every family, including the tall oval. */
export function treeCrownFaces(tree: TreeDwelling, only?: TreeCrown): Vertex3[][] {
  const faces: Vertex3[][] = [], n = tree.light ? 7 : 14;
  for (const c of only ? [only] : tree.light ? lightCrowns(tree) : tree.crowns) {
    const all = [[0.78, -c.skirt * c.height], [1, 0], [0.91, c.height * 0.48], [0.63, c.height * 0.85], [0.23, c.height]];
    const levels = tree.light ? [all[0], all[2], all[3], all[4]] : all;
    const at = (i: number, k: number, z: number): Vertex3 => {
      const a = i / n * Math.PI * 2, lobe = 1 + 0.045 * Math.cos(c.lobes * a + c.phase), droop = c.skirt > 0.5 && z < 0 ? 0.72 + 0.28 * Math.cos(c.lobes * a + c.phase) : 1;
      return { x: c.x + Math.cos(a) * c.rx * k * lobe, y: c.y + Math.sin(a) * c.ry * k * lobe, z: c.z + z * droop };
    };
    for (let j = 1; j < levels.length; j++) for (let i = 0; i < n; i++) {
      const [k0, z0] = levels[j - 1], [k1, z1] = levels[j]; faces.push([at(i, k0, z0), at(i + 1, k0, z0), at(i + 1, k1, z1), at(i, k1, z1)]);
    }
    faces.push(Array.from({ length: n }, (_, i) => at(i, 0.23, c.height)));
  }
  return faces;
}
