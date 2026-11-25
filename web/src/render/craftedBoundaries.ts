import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { Vertex3 } from '../../../rust/bridge/housesContract';
import type { BuildingTriangle, BuildingVector as V, OverviewVolume } from './urbanBuildingGeometry';
import { orientedBox, RoofBuilder } from './city3d/roofGeometry';
import { roleFamily } from './cityRoles';
import type { SiteBuilding } from './siteArchitecture';

type Kind = 'boards' | 'woven' | 'rails' | 'hedge' | 'thorn' | 'stone' | 'palisade' | 'curtain' | 'parapet' | 'gatehead' | 'battlement' | 'bank';
export interface BoundaryLine {
  kind: Kind;
  points: { x: number; y: number; g: number; mx?: number; my?: number }[];
  height: number;
  half: number;
  side: string;
  cap: string;
  closed?: boolean;
}
export interface Boundary {
  lines: BoundaryLine[];
  replace?: boolean;
}
export type BoundaryBuilding = PlacedBuilding & { boundary?: Boundary };
const wood = 'city3d:detail:weathered-wood@786448',
  light = 'city3d:detail:split-wood@a58b65',
  dark = 'city3d:detail:willow@796647';
const reed = 'city3d:detail:binding@ac9269',
  leaf = 'city3d:detail:leaves@647250',
  thorn = 'city3d:detail:thornwood@797052';

const ruralLines = new WeakMap<SiteBuilding, Boundary | undefined>();
export function boundaryOf(b: BoundaryBuilding & SiteBuilding): Boundary | undefined {
  if (b.boundary) return b.boundary;
  if (!b.sitePart) return;
  if (ruralLines.has(b)) return ruralLines.get(b);
  const form = b.sitePart.form,
    ring = b.footprint[0]?.outer;
  const kind: Kind | undefined = form === 'farm-rail' ? 'rails' : form === 'grove-fence' ? 'woven' : /(?:^|-)(?:stockade|palisade)$/.test(form) ? 'palisade' : /(?:^|-)(?:fold|barmkin|garden|grave|tomb|mani|shade)-wall$/.test(form) ? 'stone' : undefined;
  let value: Boundary | undefined;
  if (kind && ring?.length) {
    const box = orientedBox(ring),
      v = b.volumes[0] as OverviewVolume | undefined;
    if (box && v) {
      const g = Math.min(b.ground_z_m, v.z_m),
        h = Math.max(0.55, v.wall_height_m);
      const p = (sign: number) => ({ x: box.center.x + sign * box.half * box.axis.x, y: box.center.y + sign * box.half * box.axis.y, g });
      // Ring-shaped structures keep their void and take coping on each actual edge.
      const composite =
        !!b.footprint[0].holes.length ||
        box.area >
          1.5 *
            Math.abs(
              ring.reduce((n, a, i) => {
                const c = ring[(i + 1) % ring.length];
                return n + (a.x * c.y - c.x * a.y) / 2;
              }, 0),
            );
      const line: BoundaryLine = { kind, points: [p(-1), p(1)], height: h, half: Math.min(box.halfWidth, 0.7), side: v.materials.coating, cap: v.materials.cladding };
      value = composite ? { lines: [ring, ...b.footprint[0].holes].map(r => ({ ...line, kind: 'parapet', points: [...r, r[0]].map(q => ({ ...q, g })), closed: true })) } : { lines: [line], replace: kind === 'rails' || kind === 'woven' };
    }
  }
  ruralLines.set(b, value);
  return value;
}

interface Detail {
  mesh: ReturnType<RoofBuilder['mesh']>;
  ground: number[];
}
const cache = new WeakMap<Boundary, Detail>();
function build(boundary: Boundary, culture: string): Detail {
  const builder = new RoofBuilder(),
    grounds: number[] = [];
  const family = roleFamily(culture) ?? '';
  const eastern = /japanese|chinese|korean/.test(family);
  const lash = eastern || /african|native|steppe/.test(family);
  for (const line of boundary.lines) {
    const { kind, height: H, half, points, side, cap } = line;
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1],
        b = points[j];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.03) continue;
      const dx = (b.x - a.x) / len,
        dy = (b.y - a.y) / len;
      const ground = (x: number) => a.g + (b.g - a.g) * Math.max(0, Math.min(1, x / len));
      const left = (p: typeof a) => {
        if (p.mx === undefined || p.my === undefined) return [-dy, dx];
        const sign = -dy * p.mx + dx * p.my < 0 ? -1 : 1;
        return [sign * p.mx, sign * p.my];
      };
      const na = left(a),
        nb = left(b);
      const face = (corners: V[], m: string) => {
        const ps: Vertex3[] = corners.map(([x, y, z]) => {
          const t = Math.min(1, Math.max(0, x / len));
          return { x: a.x + dx * x + (na[0] + (nb[0] - na[0]) * t) * y, y: a.y + dy * x + (na[1] + (nb[1] - na[1]) * t) * y, z: ground(x) + z };
        });
        const before = builder.vertices.length;
        builder.face(ps, m);
        if (builder.vertices.length !== before) for (const [x] of corners) grounds.push(ground(x));
      };
      // Vertical prism with an optional narrowed top. Positions follow each cut run,
      // including gate ends. Ground is interpolated independently under every vertex.
      const prism = (x: number, y: number, sx: number, sy: number, lo: number, hi: number, m: string, head = m, taper = 1) => {
        const rect = (z: number, k: number): V[] =>
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([u, v]) => [x + u * sx * k, y + v * sy * k, z]);
        const bottom = rect(lo, 1),
          top = rect(hi, taper);
        for (let k = 0; k < 4; k++) {
          const t = (k + 1) % 4;
          face([bottom[k], bottom[t], top[t], top[k]], m);
        }
        face(top, head);
      };
      const rail = (x: number, u: number, y: number, v: number, z: number, w: number, r: number, m: string) => {
        face(
          [
            [x, y - r, z - r],
            [u, v - r, w - r],
            [u, v - r, w + r],
            [x, y - r, z + r],
          ],
          m,
        );
        face(
          [
            [u, v + r, w - r],
            [x, y + r, z - r],
            [x, y + r, z + r],
            [u, v + r, w + r],
          ],
          m,
        );
        face(
          [
            [x, y - r, z + r],
            [u, v - r, w + r],
            [u, v + r, w + r],
            [x, y + r, z + r],
          ],
          m,
        );
      };
      const fence = kind === 'boards' || kind === 'woven' || kind === 'rails' || kind === 'palisade';
      if (fence) {
        const solid = kind === 'palisade',
          count = Math.max(1, Math.ceil(len / (solid ? 0.43 : kind === 'boards' ? 0.33 : 2.7))),
          step = len / count;
        if (kind === 'boards' || solid) {
          for (let k = 0; k < count; k++) {
            const x = (k + 0.5) * step,
              h = H + (solid ? 0.08 : 0.035) * Math.sin(a.x + a.y + k * 2.7);
            const r = Math.min(step * 0.45, solid ? 0.22 : 0.16),
              d = solid ? half + 0.035 : 0.047;
            prism(x, 0, r, d, solid ? -0.12 : 0.1, h, side);
            prism(x, 0, r, d, h, h + (solid ? 0.38 : 0.09), side, light, solid ? 0.12 : 0.45);
          }
          for (const z of [0.3, 0.74]) rail(0, len, half + 0.025, half + 0.025, H * z, H * z, solid ? 0.076 : 0.048, wood);
        } else if (kind === 'rails') {
          for (const z of [0.33, 0.76]) rail(0.02, len - 0.02, 0, 0, H * z, H * z, 0.065, wood);
        } else {
          // Alternate the strand in front of and behind every upright.
          const n = Math.max(2, Math.ceil(len / 0.8));
          for (let k = 0; k < n; k++)
            for (let row = 0; row < 6; row++) {
              const y = (k + row) % 2 ? 0.055 : -0.055,
                z = H * (0.16 + row * 0.14);
              rail((len * k) / n, (len * (k + 1)) / n, y, -y, z, z + 0.016, 0.028, row % 2 ? side : dark);
            }
        }
        if (!solid) {
          const n = Math.max(1, Math.ceil(len / (kind === 'woven' ? 0.85 : 2.65)));
          for (let k = 0; k < n + (j === points.length - 1 && !line.closed ? 1 : 0); k++) {
            const x = Math.max(0.065, Math.min(len - 0.065, (len * k) / n)),
              r = kind === 'woven' ? 0.043 : 0.066;
            prism(x, 0, r, r, -0.1, H + 0.08, wood, light);
            if (lash) for (const z of [0.3, 0.74]) prism(x, 0, r + 0.014, r + 0.012, H * z, H * z + 0.047, reed);
          }
        }
      } else if (kind === 'hedge' || kind === 'thorn') {
        const n = Math.max(1, Math.ceil(len / (kind === 'thorn' ? 1.05 : 1.3))),
          step = len / n;
        for (let k = 0; k < n; k++) {
          const x = k * step,
            u = (k + 1) * step,
            flip = k % 2 ? 1 : -1;
          if (kind === 'thorn') {
            // Densely laid thorn boughs have an irregular shoulder, loose forked ends
            // and woody tangles on both flanks. Seed in world space to join chunks.
            const variation = (v: number, salt: number) => {
              const h = Math.sin((a.x + v * dx) * 12.9898 + (a.y + v * dy) * 78.233 + salt * 9.071) * 43758.5453;
              return h - Math.floor(h);
            };
            const section = (v: number): V[] => {
              const lift = variation(v, 3),
                lean = variation(v, 7) - 0.5;
              return [
                [v, -half * 0.82, -0.1],
                [v, -half * (0.79 + 0.16 * variation(v, 8)), H * (0.27 + 0.14 * lift)],
                [v, -half * (0.36 + 0.18 * lift), H * (0.58 + 0.2 * variation(v, 9))],
                [v, half * lean * 0.56, H * (0.78 + 0.2 * lift)],
                [v, half * (0.39 + 0.16 * lift), H * (0.61 + 0.16 * variation(v, 4))],
                [v, half * (0.79 + 0.17 * variation(v, 6)), H * (0.24 + 0.17 * lift)],
                [v, half * 0.82, -0.1],
              ];
            };
            const lo = section(x),
              hi = section(u);
            const bark = ['city3d:detail:brush@766a50', 'city3d:detail:brush@817452', 'city3d:detail:brush@6f654c'];
            for (let q = 0; q < lo.length - 1; q++) {
              const paint = bark[Math.floor(variation(x, q + 12) * 3)];
              face([lo[q], hi[q], hi[q + 1]], paint);
              face([lo[q], hi[q + 1], lo[q + 1]], paint);
            }
            if (k === 0 && j === 1) face(lo, side);
            if (k === n - 1 && j === points.length - 1) face(hi, side);
            for (const sign of [-1, 1])
              for (let layer = 0; layer < 3; layer++) {
                const r = variation(x, 24 + layer + (sign + 1) * 4),
                  t = variation(u, 33 + layer),
                  shoulder = half * (0.97 - 0.22 * layer);
                const y = sign * shoulder,
                  z = H * (0.1 + layer * 0.21 + r * 0.12),
                  fork = H * (0.34 + layer * 0.21 + t * 0.18);
                const start = x + step * r * 0.22,
                  tip = u - step * t * 0.13,
                  endY = sign * (shoulder - half * (0.05 + 0.22 * r));
                rail(start, tip, y, endY, z, fork, 0.045, layer % 2 ? thorn : wood);
                rail(start + 0.47 * (tip - start), tip, (y + endY) / 2, sign * (shoulder + half * (0.03 + 0.05 * t)), (z + fork) / 2, fork + H * 0.1, 0.03, thorn);
              }
          } else {
            const mid = (x + u) / 2,
              h = H * (1.04 + 0.08 * Math.sin(a.x + a.y + k));
            const skirt: V[] = [
              [x, 0, H * 0.75],
              [mid, -half * 1.13, H * 0.72],
              [u, 0, H * 0.77],
              [mid, half * 1.13, H * 0.76],
            ];
            for (let i = 0; i < 4; i++) face([skirt[i], skirt[(i + 1) % 4], [mid, half * 0.13 * flip, h]], i % 2 ? cap : leaf);
          }
        }
      } else {
        const fort = kind === 'curtain' || kind === 'bank',
          crest = kind === 'parapet' || kind === 'gatehead' || kind === 'battlement';
        const interval = fort ? 3.6 : crest ? 1.8 : 1.1,
          n = Math.max(1, Math.ceil(len / interval)),
          step = len / n;
        for (let k = 0; k < n; k++) {
          const x = (k + 0.5) * step;
          if (fort) {
            for (const s of [-1, 1]) {
              const y = s * half;
              if (kind === 'bank') {
                // Exposed lift lines in a rammed-earth face, kept inside the gate cut.
                for (const z of [0.32, 0.64]) rail(k * step, (k + 1) * step, y, y, H * z, H * z, 0.04, side);
              } else {
                prism(x, y, Math.min(0.22, step * 0.22), 0.19, H * 0.09, H * 0.82, side, cap, 0.68);
                rail(k * step, (k + 1) * step, y, y, H * 0.84, H * 0.84, 0.09, cap);
              }
            }
          } else {
            const w = Math.min(half + 0.04, crest ? 0.17 : 0.4);
            const low = crest ? H - 0.08 : H;
            prism(x, 0, step * 0.47, w, low, low + (eastern ? 0.2 : 0.14), cap, cap, eastern ? 0.73 : 0.91);
            if (kind === 'battlement') {
              prism(x, 0, Math.min(step * 0.29, 0.5), 0.24, H + 0.03, H + 0.68, side, cap);
              if (eastern) prism(x, 0, Math.min(step * 0.32, 0.54), 0.27, H + 0.68, H + 0.76, cap, cap, 0.85);
            }
            if (kind === 'gatehead') {
              // Projecting corbels carry a lintel or tiled eave above the passage.
              prism(x, 0, Math.min(step * 0.24, 0.23), 0.32, H - 0.46, H - 0.21, side, cap, 0.82);
              rail(k * step, (k + 1) * step, 0, 0, H - 0.17, H - 0.17, eastern ? 0.19 : 0.14, cap);
            }
            if (!crest && (k === 0 || k % 4 === 0)) prism(x, 0, Math.min(0.21, step * 0.31), w + 0.07, -0.1, H + 0.14, side, cap);
          }
        }
      }
    }
  }
  return { mesh: builder.mesh(), ground: grounds };
}
export function emitBoundary(b: BoundaryBuilding, boundary: Boundary, emit: (t: BuildingTriangle) => void) {
  let detail = cache.get(boundary);
  if (!detail) {
    detail = build(boundary, b.culture?.culture ?? '');
    cache.set(boundary, detail);
  }
  const { mesh, ground } = detail,
    materials = b.volumes[0].materials;
  for (const f of mesh.faces)
    for (let k = 1; k + 1 < f.vertices.length; k++) {
      const ix = [f.vertices[0], f.vertices[k], f.vertices[k + 1]];
      emit({
        points: ix.map(i => {
          const p = mesh.vertices[i];
          return [p.x, p.y, p.z];
        }) as BuildingTriangle['points'],
        normal: f.normal,
        material: f.material,
        materials,
        surface: 'yard',
        ground: ix.map(i => ground[i]) as [number, number, number],
      });
    }
}
