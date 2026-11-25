import type { FrontDesign } from './houseFrontKit';
import { modernFronts } from './houseModernFronts';

type Point = [number, number, number];
type Roof = 'gable' | 'hip' | 'shed' | 'barrel' | 'fan' | 'fold' | 'pergola' | 'slab';
type Support = 'timber' | 'pier' | 'bracket' | 'suspended' | 'fin';
type Finish = 'local' | 'slate' | 'glass' | 'metal' | 'concrete' | 'clay' | 'wood';
const finishes = { slate: 'city3d:cover:slate@646777', glass: 'city3d:detail:glass@759294', metal: 'city3d:cover:zinc@778486', concrete: 'city3d:wall:concrete@b6afa2', clay: 'city3d:cover:tile@a76d52', wood: 'city3d:wall:wood@87694f' };
const iron = 'city3d:wall:steel@575c59',
  stone = 'city3d:wall:ashlar@c1b8a4';

/** Each cross section carries both edges of a roof pan. A hipped end or rounded nose can
 * shorten the front edge independently. Close the cut edges so thin glass and slate cast a silhouette. */
function coveredPorch(roof: Roof, support: Support, finish: Finish): FrontDesign {
  return g => {
    const available = g.width / 2 - 0.025,
      aisle = (g.doorWidth ?? 0.95) / 2,
      depth = g.depth;
    const ceiling = Math.min(g.height, ...(g.windows ?? []).filter(b => b.bottom > (g.doorHeight ?? 1.98) && Math.abs(b.x) - b.width / 2 < available).map(b => b.bottom - 0.08));
    const low = Math.min(ceiling - 0.08, Math.max((g.doorHeight ?? Math.min(2, ceiling * 0.72)) + 0.14, Math.min(2.54, ceiling * 0.74)));
    const thick = roof === 'slab' ? 0.13 : finish === 'glass' ? 0.039 : 0.083;
    // Tall adjacent glazing can take up part of the attachment wall. Keep the rear
    // of the canopy in the unglazed strip around the entrance.
    const half = Math.min(available, ...(g.windows ?? []).filter(b => b.bottom < ceiling && b.top > low - thick).map(b => Math.abs(b.x) - b.width / 2 - 0.045));
    if (g.doorHeight && (low - thick < g.doorHeight || half < aisle + 0.04)) {
      // A lintel immediately below an upstairs sill leaves no headroom for a canopy.
      g.box(-aisle, aisle, 0.018, Math.min(depth, 0.21), g.doorHeight, Math.min(ceiling, g.doorHeight + 0.1), stone);
      return;
    }
    if (half <= 0.12) return;
    const rise = Math.max(0.035, Math.min(ceiling - low, roof === 'gable' || roof === 'hip' ? half * 0.53 : half * 0.32, 0.82));
    const cover = finish === 'local' ? g.cover : finishes[finish];
    const bearing = support === 'timber' ? finishes.wood : support === 'pier' ? stone : support === 'fin' ? finishes.concrete : iron;
    const eave = depth - 0.025;
    // Roof height on the front beam. Pitched gables spring from the two outer posts.
    const high = (u: number) => {
      if (roof === 'gable' || roof === 'hip') return low + rise * (1 - Math.abs(u));
      if (roof === 'barrel') return low + rise * Math.sqrt(Math.max(0, 1 - u * u));
      if (roof === 'fold') return low + rise * Math.abs(u);
      return low;
    };
    const projection = (u: number) => (roof === 'fan' ? eave * (0.42 + 0.58 * Math.sqrt(Math.max(0, 1 - u * u))) : roof === 'hip' ? eave * (1 - 0.24 * Math.abs(u)) : eave);
    if (roof === 'pergola') {
      const n = Math.max(4, Math.round(g.width / 0.52));
      for (let i = 0; i < n; i++) {
        const x = (-1 + (2 * (i + 0.5)) / n) * half;
        g.beam([x, 0.035, low + rise * 0.48], [x, eave - 0.05, low], 0.095, bearing);
      }
      g.box(-half, half, eave - 0.16, eave - 0.045, low - 0.1, low, bearing);
    } else {
      const cuts = roof === 'barrel' || roof === 'fan' ? [-1, -0.8, -0.5, 0, 0.5, 0.8, 1] : roof === 'slab' || roof === 'shed' ? [-1, 1] : [-1, 0, 1];
      const rails = cuts.map(u => {
        const z = high(u),
          y = projection(u);
        const rear = roof === 'shed' || roof === 'fan' ? low + rise : roof === 'hip' ? low + rise : z;
        return [
          [half * u, 0, rear],
          [half * u, y, z],
          [half * u, y, z - thick],
          [half * u, 0, rear - thick],
        ] as Point[];
      });
      for (let i = 1; i < rails.length; i++) {
        const a = rails[i - 1],
          b = rails[i];
        for (let k = 0; k < 4; k++) {
          const j = (k + 1) % 4;
          g.face([a[k], b[k], b[j], a[j]], k === 0 ? cover : bearing);
        }
      }
      g.face(rails[0], bearing);
      g.face([...rails.at(-1)!].reverse(), bearing);
      if (finish === 'glass')
        for (const u of [-0.84, 0, 0.84]) {
          const h = high(u);
          g.beam([half * u, 0.025, roof === 'fan' ? low + rise + 0.016 : h + 0.016], [half * u, projection(u) - 0.035, h + 0.016], 0.038, iron);
        }
    }
    const spare = half - aisle;
    const post = Math.min(support === 'pier' ? 0.145 : 0.09, spare * 0.36);
    if (post < 0.025) return;
    const x = half - post - 0.015;
    for (const sign of [-1, 1]) {
      const u = (sign * x) / half,
        s = sign * x,
        y = projection(u) - 0.12,
        h = high(u) - thick;
      const blocked = (g.windows ?? []).some(b => Math.abs(b.x - s) < b.width / 2 + post && b.bottom < h + rise && b.top > h - 0.68);
      if (support === 'suspended' || support === 'bracket') {
        // A tie or corbel is fixed to masonry, clear of glazing on the host wall.
        if (blocked) continue;
        const up = support === 'suspended' && ceiling > h + 0.25;
        g.beam([s, 0.035, up ? Math.min(ceiling, h + 0.7) : h - 0.53], [s, y, up ? h + 0.025 : h - 0.02], up ? 0.044 : 0.087, bearing);
        g.box(s - post, s + post, 0.01, 0.09, up ? Math.min(ceiling, h + 0.7) - 0.12 : h - 0.59, up ? Math.min(ceiling, h + 0.7) : h - 0.43, bearing);
      } else if (support === 'fin') {
        g.box(s - post, s + post, Math.max(0.17, y * 0.35), y + 0.06, 0.015, h, bearing);
      } else {
        g.post(s, y, 0.015, h, post, bearing, support === 'pier' ? 8 : 4);
        if (support === 'pier') g.box(s - post * 1.28, s + post * 1.28, y - post * 1.25, y + post * 1.25, 0.015, Math.min(0.49, h * 0.2), stone);
        else if (spare > 0.45) g.beam([s, y, h - 0.36], [s - sign * Math.min(0.36, spare * 0.45), y, h + 0.005], 0.072, bearing);
      }
    }
  };
}
const gable = coveredPorch('gable', 'timber', 'local'),
  hip = coveredPorch('hip', 'timber', 'local'),
  lean = coveredPorch('shed', 'bracket', 'local');
const slateGable = coveredPorch('gable', 'bracket', 'slate'),
  hipPier = coveredPorch('hip', 'pier', 'clay');
const ironGlass = coveredPorch('barrel', 'bracket', 'glass'),
  shell = coveredPorch('fan', 'suspended', 'glass'),
  fold = coveredPorch('fold', 'fin', 'metal');
const slab = coveredPorch('slab', 'fin', 'concrete'),
  portico = coveredPorch('slab', 'pier', 'concrete'),
  light = coveredPorch('shed', 'suspended', 'metal');
const slats = coveredPorch('pergola', 'timber', 'wood'),
  sunshade = coveredPorch('pergola', 'fin', 'concrete');
function choose(...forms: FrontDesign[]): FrontDesign {
  return g => forms[(g.seed >>> 8) % forms.length](g);
}
function modern(id: string, b: FrontDesign, c: FrontDesign): FrontDesign {
  return choose(modernFronts[id], b, c);
}

export const streetPorches: Record<string, FrontDesign> = {
  'belle-epoque': modern('belle-epoque', shell, slateGable),
  'art-deco-metropolis': modern('art-deco-metropolis', portico, shell),
  'mediterranean-modern': modern('mediterranean-modern', slats, hipPier),
  'soviet-socialist': modern('soviet-socialist', portico, light),
  'american-suburbia': modern('american-suburbia', hip, lean),
  'australian-suburban': modern('australian-suburban', gable, slats),
  'european-contemporary': modern('european-contemporary', shell, slats),
  'informal-urban-expansion': modern('informal-urban-expansion', light, slats),
  'eco-city': modern('eco-city', fold, hip),
  'southeast-asian-tropical': modern('southeast-asian-tropical', hip, slats),
  'latin-american-grid': modern('latin-american-grid', portico, light),
  'latin-american-hillside': modern('latin-american-hillside', lean, sunshade),
  'north-african-contemporary': modern('north-african-contemporary', sunshade, portico),
  'middle-eastern-contemporary': modern('middle-eastern-contemporary', slab, sunshade),
  'post-socialist-european': modern('post-socialist-european', slab, ironGlass),
  'sub-saharan-african-metropolis': modern('sub-saharan-african-metropolis', slats, light),
  'european-organic': choose(gable, lean, hip),
  bastide: choose(hipPier, gable, lean),
  hanseatic: choose(slateGable, lean, gable),
  'flemish-cloth-town': choose(slateGable, hip, lean),
  'industrial-victorian': choose(ironGlass, slateGable, lean),
  haussmannian: choose(shell, ironGlass, coveredPorch('shed', 'bracket', 'glass')),
  'garden-city': choose(gable, hip, slats),
  'rynek-town': choose(slateGable, hip, lean),
  'american-grid': choose(hip, gable, portico),
  'global-high-rise': choose(shell, fold, slab),
  'modernist-functionalist': choose(slab, light, sunshade),
  'gulf-contemporary': choose(sunshade, portico, fold),
  'chinese-megacity': choose(fold, light, ironGlass),
  'korean-high-rise': choose(slab, ironGlass, light),
  'japanese-contemporary': choose(lean, slats, slab),
};
