import type { HouseFront } from './houseFrontKit';
import { drawRuralEquipment } from './ruralEquipment';
import type { RuralTrade } from './ruralTrades';
import type { BuildingVector as V } from './urbanBuildingGeometry';

const machines: Readonly<Record<string, RuralTrade>> = { headframe: 'hoist', 'quarry-crane': 'crane', 'lime-kiln': 'kiln', 'stone-stack': 'stone', 'log-pile': 'timber', cordwood: 'timber', 'fish-rack': 'net', 'bee-skep': 'apiary', trough: 'trough' };
const landscapes = new Set('ruin ruin-corner rubble round-kiln mill-wheel mill-dam quarry-face barrow-mound cairn charcoal-clamp fence-post fold-wall grove-fence haystack landing-stage slipway tan-pit threshing-floor washing-floor brine-pan'.split(' '));
export const hasRuralInstallation = (form: string) => Object.hasOwn(machines, form) || landscapes.has(form);
/** The generated footprint and ground fix the installation in place. Keep organic mounds and
 * rock faces, dressing their surface. Open machinery and racks take the place of their solid proxy. */
export const replaceRuralInstallation = (form: string) => !['ruin', 'ruin-corner', 'rubble', 'barrow-mound', 'cairn', 'charcoal-clamp', 'haystack', 'quarry-face'].includes(form);
export function drawRuralInstallation(g: HouseFront, form: string, family?: string) {
  if (Object.hasOwn(machines, form)) {
    drawRuralEquipment(g, machines[form], family);
    return;
  }
  const timber = /modernist|industrial|futuristic|contemporary/.test(family ?? '') ? 'city3d:detail:steel@68665c' : 'city3d:detail:wet-timber@725b42';
  const stone = 'city3d:detail:rough-stone@968b76',
    earth = 'city3d:detail:tamped-earth@ac926d',
    rope = 'city3d:detail:rope@947a52';
  const w = g.width,
    d = g.depth,
    h = g.height;
  const p = (x: number, y: number, z: number): V => [x * w, y * d, z * h];
  const beam = (a: V, b: V, r: number, m = timber) => g.beam(p(...a), p(...b), r, m);
  const box = (x: number, u: number, y: number, v: number, z: number, t: number, m: string) => g.box(x * w, u * w, y * d, v * d, z * h, t * h, m);
  if (form === 'ruin' || form === 'ruin-corner' || form === 'rubble') {
    // Spalled courses at the broken wall head, or the ends of fallen roof timbers.
    // The original ruin still determines the breaks and the height of the standing corner.
    const wooden = /wood|timber|bamboo/.test(g.wall) || /japanese|norse|steppe/.test(family ?? '');
    const count = Math.min(8, Math.max(2, Math.round(w / 0.7)));
    const layer = Math.min(0.21, h * 0.2),
      breadth = Math.min(0.65, d * 0.64);
    for (let i = 0; i < count; i++) {
      const x = ((i + 0.5) / count - 0.5) * w,
        span = Math.min(0.62, (w / count) * 0.86);
      const y = d * (i % 2 ? 0.6 : 0.4),
        z = h * (form === 'rubble' ? 0.44 : 0.83);
      if (wooden) {
        if (i % 2 === 0) g.beam([x - span * 0.48, y - breadth * 0.46, z], [x + span * 0.48, y + breadth * 0.46, z + layer], Math.min(0.17, breadth * 0.3), timber);
      } else g.box(x - span * 0.47, x + span * 0.47, y - breadth * 0.44, y + breadth * 0.44, z, z + layer * (1 + (i % 3) * 0.24), i % 3 === 0 ? stone : g.wall);
    }
    return;
  }
  if (form === 'round-kiln') {
    // A beehive kiln, with a deep firing mouth in the lower courses and an open flue.
    const brick = 'city3d:detail:fired-clay@a7674e',
      inside = 'city3d:detail:kiln-interior@47362e';
    const section = (i: number, r: number, z: number): V => p(Math.cos((i * Math.PI) / 8) * r, 0.5 + Math.sin((i * Math.PI) / 8) * r, z);
    const rings = [
      [0.48, 0],
      [0.48, 0.38],
      [0.45, 0.54],
      [0.37, 0.69],
      [0.23, 0.8],
      [0.105, 0.86],
      [0.105, 0.98],
      [0.072, 0.98],
      [0.072, 0.86],
    ];
    for (let j = 1; j < rings.length; j++) {
      const [r0, z0] = rings[j - 1],
        [r1, z1] = rings[j];
      for (let i = 0; i < 16; i++) {
        if (j === 1 && (i === 3 || i === 4)) continue;
        g.face([section(i, r0, z0), section(i + 1, r0, z0), section(i + 1, r1, z1), section(i, r1, z1)], j === 8 ? inside : brick);
      }
    }
    for (const i of [3, 5]) g.face([section(i, 0.48, 0), section(i, 0.19, 0), section(i, 0.19, 0.38), section(i, 0.48, 0.38)], inside);
    for (const i of [3, 4]) {
      g.face([section(i, 0.19, 0.38), section(i + 1, 0.19, 0.38), section(i + 1, 0.48, 0.38), section(i, 0.48, 0.38)], inside);
      g.face([section(i, 0.19, 0), section(i + 1, 0.19, 0), section(i + 1, 0.19, 0.38), section(i, 0.19, 0.38)], inside);
    }
    return;
  }
  if (form === 'mill-wheel') {
    const r = Math.min(w * 0.47, h * 0.47),
      cz = r + 0.04;
    const rim = (i: number, y: number, f = 1): V => [Math.cos((i * Math.PI) / 8) * r * f, y * d, cz + Math.sin((i * Math.PI) / 8) * r * f];
    for (let i = 0; i < 16; i++) {
      for (const y of [0.12, 0.88]) {
        g.beam(rim(i, y), rim(i + 1, y), r * 0.1, timber);
        if (!(i % 2)) g.beam([0, y * d, cz], rim(i, y, 0.95), r * 0.073, timber);
      }
      g.face([rim(i, 0.06, 0.84), rim(i, 0.94, 0.84), rim(i, 0.94), rim(i, 0.06)], timber);
    }
    g.beam([0, 0.01 * d, cz], [0, 0.99 * d, cz], r * 0.22, timber);
    return;
  }
  if (form === 'quarry-face') {
    // Seams between cut benches, recessed towards the top of the face.
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 5; i++) {
        const s = -0.47 + i * 0.187 + (j % 2) * 0.022;
        box(s, s + 0.18, 0.0 + j * 0.06, 0.13 + j * 0.06, j * 0.24, j * 0.24 + 0.225, stone);
      }
    return;
  }
  if (form === 'barrow-mound' || form === 'cairn' || form === 'charcoal-clamp' || form === 'haystack') {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const at = (r: number, z: number): V => p(r * Math.cos(a), 0.5 + r * Math.sin(a), z);
      if (form === 'cairn' || form === 'barrow-mound') {
        const [x, y] = at(0.46, 0);
        g.post(x, y, 0, Math.min(0.55, h * 0.32), Math.min(w, d) * 0.073, stone, 6);
      } else g.beam(at(0.46, 0.12), at(0.075, 0.95), form === 'haystack' ? 0.065 : 0.09, form === 'haystack' ? rope : timber);
    }
    return;
  }
  if (form === 'fold-wall' || form === 'grove-fence' || form === 'fence-post') {
    if (form === 'fold-wall') {
      for (let i = 0; i < 6; i++) box(i / 6 - 0.5, i / 6 - 0.337, 0.08, 0.92, 0, 0.94, stone);
    } else {
      for (const x of form === 'fence-post' ? [0] : [-0.46, 0, 0.46]) g.post(x * w, d * 0.5, 0, h, Math.min(d * 0.4, w * 0.19), timber, 4);
      if (form === 'grove-fence') for (const z of [0.34, 0.74]) beam([-0.5, 0.5, z], [0.5, 0.5, z], Math.min(0.15, d * 0.34));
    }
    return;
  }
  if (form === 'landing-stage' || form === 'slipway' || form === 'mill-dam') {
    for (const x of [-0.44, 0, 0.44]) for (const y of [0.13, 0.86]) g.post(x * w, y * d, 0, h * (form === 'landing-stage' ? 1 : 0.67), Math.min(0.16, d * 0.1), timber, 6);
    for (let i = 0; i < 10; i++) {
      const z = form === 'slipway' ? 0.08 + i * 0.085 : 0.63;
      box(i / 10 - 0.5, i / 10 - 0.402, 0.04, 0.96, z, z + 0.12, form === 'mill-dam' ? stone : timber);
    }
    return;
  }
  // Raised lips distinguish shallow pools from a threshing or ore-washing floor.
  const base = form === 'threshing-floor' ? earth : stone;
  box(-0.495, 0.495, 0.01, 0.99, 0, 0.32, base);
  for (const y of [0.015, 0.93]) box(-0.495, 0.495, y, y + 0.055, 0.32, 0.91, stone);
  for (const x of [-0.495, 0.465]) box(x, x + 0.03, 0.06, 0.94, 0.32, 0.91, stone);
  if (form === 'washing-floor') for (const x of [-0.26, 0, 0.26]) box(x, x + 0.023, 0.07, 0.93, 0.32, 0.5, timber);
  if (form === 'tan-pit' || form === 'brine-pan') box(-0.459, 0.459, 0.071, 0.925, 0.32, 0.42, form === 'brine-pan' ? 'city3d:detail:salt-water@94aba0' : 'city3d:detail:tanning-liquor@7c5c43');
}
