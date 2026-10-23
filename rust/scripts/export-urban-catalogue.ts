// One-time data port: geometry and parameter application execute in Rust.
import { writeFileSync } from 'node:fs';
import { BENCH_PRESETS, BENCH_FIELDS, benchRecipes } from '../../web/src/gen/urban/testbenchConfig';
import { CULTURES, type Culture } from '../../web/src/gen/urban/culture';
import { deepMerge, resolveMorph } from '../../web/src/gen/urban/morphology';

const presets = Object.fromEntries(Object.entries(BENCH_PRESETS).map(([id, p]) => [id, { label: p.label, params: resolveMorph(p.ref) }]));

// Temporary native bench profiles. Keep the enclosure and nucleus data that the
// first port discarded; a morphology's street operator alone cannot describe a city.
interface Plan {
  pattern: 'organic' | 'grid' | 'terraces' | 'linear' | 'radial' | 'dispersed';
  enclosure: string;
  fortification: string;
  gates: string;
  orientation: string;
  stairs: boolean;
  waterfront: boolean;
  sources: string[];
}
const atlas = 'docs/styles_architecturaux_mondiaux_city_mapper.md';
const source = (...ids: string[]): string[] => ids.map(id => `${atlas}#${id}`);
// Camp operators carried their own plans outside Culture.core in TypeScript.
// Preserve those distinctions instead of turning every camp into a loose circle.
const campPlans: Record<string, Partial<Plan>> = {
  'norse-ringfort': { pattern: 'radial', fortification: 'palisade', gates: 'cardinal' },
  'barbarian-celtic': { pattern: 'radial', fortification: 'palisade' },
  'celtic-oppidum': { pattern: 'organic', enclosure: 'organic', fortification: 'wall', orientation: 'terrain' },
  'native-iroquoian': { pattern: 'linear', enclosure: 'oval', fortification: 'palisade' },
  'native-pueblo': { pattern: 'terraces', enclosure: 'terraces', orientation: 'terrain', stairs: true },
  'native-plains': { pattern: 'radial' }, 'nomad-camp': { pattern: 'radial' }, kraal: { pattern: 'radial' },
  khmer: { pattern: 'grid', enclosure: 'rect', orientation: 'cardinal' },
};
function originalPlan(c: Culture): Plan {
  const m = resolveMorph(c.core.morphology), e = c.core.enclosure;
  const terraces = Boolean(c.render.terraces || c.render.andenes || c.render.stairs || m.contourFollow);
  // Capability only: native quay placement still requires an actual dry shore,
  // a traversable grade and a connection to the street network.
  const waterfront = ['roman-core', 'hanseatic', 'swahili-stone-town', 'venetian-lagoon', 'stilt-town', 'aztec', 'gnomish'].includes(c.id);
  return {
    pattern: terraces ? 'terraces' : c.camp ? 'dispersed' : m.streetOp === 'grid' ? 'grid' : e.shape === 'circle' ? 'radial' : 'organic',
    enclosure: e.shape, fortification: e.wall, gates: e.gates ?? 'roads',
    orientation: e.orientation ?? m.orientation, stairs: terraces, waterfront,
    ...(c.camp ? campPlans[c.id] : {}),
    sources: ['web/src/gen/urban/culture.ts', '.local-archive/publication-2026-10-09/repository/web/URBAN_MORPHOLOGY.md'],
  };
}
const cultures: Record<string, unknown> = Object.fromEntries(Object.values(CULTURES).map(c => [c.id, {
  label: c.label,
  recipes: benchRecipes(c).map(r => ({ id: r.id, label: r.label, zone: r.zone, preset: `${c.id}/${r.id}` })),
  plan: originalPlan(c),
  nucleus: c.nucleus,
  core: { enclosure: c.core.enclosure, share: c.core.share },
  ring: c.ring ? { enclosure: c.ring.enclosure, share: c.ring.share } : null,
  phaseCount: c.phaseCount, faubShare: c.faubShare,
  village: { form: c.village.form, enclosure: c.village.enclosure },
  hamlet: { form: c.hamlet.form, enclosure: c.hamlet.enclosure },
  render: c.render, camp: c.camp,
  growth: c.urbanGrowth ? {
    minPop: c.urbanGrowth.minPop,
    plan: originalPlan({ ...c, ...c.urbanGrowth.recipe, camp: undefined }),
    core: { enclosure: c.urbanGrowth.recipe.core.enclosure, share: c.urbanGrowth.recipe.core.share },
    ring: c.urbanGrowth.recipe.ring ? { enclosure: c.urbanGrowth.recipe.ring.enclosure, share: c.urbanGrowth.recipe.ring.share } : null,
    phaseCount: c.urbanGrowth.recipe.phaseCount, faubShare: c.urbanGrowth.recipe.faubShare,
  } : null,
}]));

// These are distinct settlement recipes from the supplied atlas, not claims to
// reproduce every named historical site. Units are metres and square metres.
// Numerical dimensions below are artistic generation ranges, not survey data.
const ranges = (core: number[], middle = core, edge = middle, rural = edge) => ({ core, middle, edge, faubourg: rural, village: rural });
interface Extension {
  id: string; label: string; base: string; plan: Partial<Plan>;
  refs: string[]; description: string; params: Record<string, unknown>;
}
const extensions: Extension[] = [
  {
    id: 'egyptian-planned', label: 'Égypte · ville planifiée du Nil', base: 'roman-core',
    plan: { pattern: 'grid', enclosure: 'rect', fortification: 'none', orientation: 'water', waterfront: true },
    refs: ['AF-NILE-S02', 'AF-NILE-S03'],
    description: 'Quartiers rectilignes compacts orientés sur la vallée ; les complexes sacrés restent des réserves, sans génération de temples.',
    params: { orientation: 'water', gridSpacing: [48, 92], widthByRank: [8, 5.5, 3.2, 2.6, 2], fieldNoise: 1,
      blockSize: ranges([1800, 4200], [2200, 5200], [3000, 6500], [4500, 10000]),
      frontage: ranges([5, 9], [6, 10], [7, 12], [12, 22]), plotDepth: ranges([17, 28], [18, 32], [22, 36], [28, 50]) },
  },
  {
    id: 'nubian-fortified', label: 'Nubie · ville fortifiée', base: 'roman-core',
    plan: { pattern: 'grid', enclosure: 'rounded-rect', fortification: 'wall', orientation: 'water', waterfront: true },
    refs: ['AF-NILE-S04'], description: 'Blocs de brique dans une enceinte compacte, liés aux rives du Nil.',
    params: { orientation: 'water', gridSpacing: [48, 60], gridSkew: 0.06, fieldNoise: 4, widthByRank: [7, 4.8, 3.2, 2.4, 2],
      blockSize: ranges([1500, 3300], [1800, 4300], [2500, 5800], [3800, 9000]), plotOp: 'courtyard',
      houseArea: ranges([110, 320], [150, 400], [200, 520], [300, 800]) },
  },
  {
    id: 'mesopotamian', label: 'Mésopotamie · quartiers de cours', base: 'medina',
    plan: { pattern: 'organic', fortification: 'wall', waterfront: true },
    refs: ['AS-MIDE-S01', 'AS-MIDE-S02'], description: 'Îlots massifs à patios, voies marchandes et venelles ; les canaux et temples ne sont pas synthétisés par cette recette.',
    params: { fieldNoise: 18, fieldRandom: 0.38, curvature: 0.65, widthByRank: [8, 5.2, 3.1, 2.3, 1.8],
      blockSize: ranges([2800, 7200], [4500, 12000], [6500, 17000], [9000, 22000]),
      houseArea: ranges([130, 360], [170, 460], [210, 650], [350, 1000]), deadEndRatio: 0.7 },
  },
  {
    id: 'levantine-tell', label: 'Levant · ville fortifiée sur tell', base: 'byzantine-greek',
    plan: { pattern: 'terraces', enclosure: 'organic', fortification: 'wall', orientation: 'terrain', stairs: true },
    refs: ['AS-MIDE-S03'], description: 'Rues de pente et enceintes adaptées au relief ; le tell existant appartient au décor.',
    params: { orientation: 'terrain', contourBlend: 0.9, fieldNoise: 8, curvature: 0.7,
      widthByRank: [6, 4.4, 3, 2.3, 1.8], blockSize: ranges([1800, 4300], [2300, 5800], [3300, 8500], [5000, 13000]), plotOp: 'courtyard' },
  },
  {
    id: 'oasis-caravan', label: 'Asie centrale · cité caravanière d’oasis', base: 'persian',
    plan: { pattern: 'organic', enclosure: 'rounded-rect', fortification: 'wall', orientation: 'road' },
    refs: ['AS-STEP-S03', 'AS-STEP-S05'], description: 'Axes caravaniers entre portes, noyau de marché et grands enclos ; irrigation et citadelle restent des réserves futures.',
    params: { fieldNoise: 10, fieldRandom: 0.22, curvature: 0.4, widthByRank: [11, 7, 4.2, 2.8, 2.2],
      blockSize: ranges([4000, 8500], [6000, 13500], [8500, 19000], [13000, 30000]),
      houseArea: ranges([250, 650], [350, 900], [500, 1400], [900, 2500]), placeThreshold: 1700 },
  },
  {
    id: 'ksar-oasis', label: 'Maghreb · ksar d’oasis', base: 'medina',
    plan: { pattern: 'organic', enclosure: 'rounded-rect', fortification: 'wall', orientation: 'road' },
    refs: ['AF-MAG-S02'], description: 'Noyau très compact, accès défensifs et venelles ; distinct de la kasbah et de la médina urbaine.',
    params: { fieldNoise: 12, fieldRandom: 0.2, curvature: 0.45, widthByRank: [4.8, 3.4, 2.5, 1.9, 1.5],
      blockSize: ranges([1100, 3000], [1700, 4200], [2300, 5700], [4000, 10000]), minBlock: 350, minWidth: 12,
      houseArea: ranges([80, 200], [100, 270], [140, 360], [250, 700]), deadEndRatio: 0.85, accessDepth: 14 },
  },
  {
    id: 'yoruba', label: 'Yoruba · ville de concessions', base: 'sahel',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'auto', orientation: 'road' },
    refs: ['AF-WEST-S01', 'AF-WEST-S02'], description: 'Grands enclos lignagers, quartiers et axes de marché ; aucune copie des palais tardifs d’Abomey.',
    params: { plotOp: 'compound', closeOp: 'closes', fieldNoise: 15, fieldRandom: 0.3, curvature: 0.65,
      widthByRank: [12, 8, 4.5, 3, 2.3], blockSize: ranges([6500, 15000], [9500, 22000], [15000, 34000], [22000, 45000]),
      houseArea: ranges([750, 2000], [1000, 2800], [1400, 3800], [2000, 5200]),
      frontage: ranges([20, 38], [25, 46], [32, 58], [40, 75]), coverage: ranges([0.35, 0.6], [0.25, 0.5], [0.18, 0.4], [0.12, 0.3]), deadEndRatio: 0.3 },
  },
  {
    id: 'himalayan-terraces', label: 'Tibet et Ladakh · habitat en terrasses', base: 'byzantine-greek',
    plan: { pattern: 'terraces', enclosure: 'terraces', fortification: 'none', orientation: 'terrain', stairs: true },
    refs: ['AS-HIM-S01', 'AS-HIM-S02'], description: 'Venelles en courbes de niveau, blocs compacts et escaliers ; pas de dzong tardif automatique.',
    params: { orientation: 'terrain', contourFollow: 0.95, contourBlend: 1, fieldNoise: 3, fieldRandom: 0.08,
      curvature: 0.75, closeOp: 'none', plotOp: 'courtyard', widthByRank: [5, 3.6, 2.5, 2, 1.5],
      blockSize: ranges([1300, 3300], [2000, 4800], [2800, 7000], [4500, 10000]), minBlock: 450, minWidth: 14,
      houseArea: ranges([120, 340], [180, 450], [250, 650], [400, 1100]) },
  },
  {
    id: 'newar', label: 'Népal newar · ville à places rituelles', base: 'european-organic',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'none', orientation: 'terrain', stairs: true },
    refs: ['AS-HIM-S03'], description: 'Îlots denses autour de cours et places rituelles ; les pavillons du palais ne sont pas générés ici.',
    params: { orientation: 'terrain', contourBlend: 0.55, plotOp: 'courtyard', closeOp: 'closes', fieldNoise: 11,
      widthByRank: [7.5, 5, 3.3, 2.5, 2], blockSize: ranges([2200, 5400], [3300, 8000], [5000, 12000], [7500, 18000]),
      houseArea: ranges([160, 450], [230, 650], [320, 900], [600, 1600]), placeThreshold: 1500 },
  },
  {
    id: 'indus-planned', label: 'Indus · cité harappéenne', base: 'roman-core',
    plan: { pattern: 'grid', enclosure: 'rect', fortification: 'wall', orientation: 'cardinal', gates: 'cardinal' },
    refs: ['AS-IND-S02'], description: 'Grille hiérarchisée, blocs de maisons à cour et ruelles ; les réseaux de drains ne sont pas encore produits.',
    params: { orientation: 'cardinal', gridSpacing: [105, 180], gridSkew: 0.025, fieldNoise: 1, closeOp: 'closes',
      widthByRank: [10, 6, 3.4, 2.4, 1.8], blockSize: ranges([6500, 13500], [7500, 17000], [10000, 22000], [15000, 30000]),
      houseArea: ranges([180, 600], [220, 750], [300, 1000], [600, 1800]), accessDepth: 22 },
  },
  {
    id: 'javanese-courts', label: 'Java · ville de cours et enclos', base: 'indian-temple',
    plan: { pattern: 'grid', enclosure: 'rect', fortification: 'none', orientation: 'cardinal' },
    refs: ['AS-ISL-S05', 'AS-ISL-S07'], description: 'Grands enclos, places publiques et cours séparées ; cette recette ne confond pas Java avec les temples de l’Inde.',
    params: { gridSpacing: [125, 180], gridSkew: 0.09, fieldNoise: 3, plotOp: 'compound', closeOp: 'none',
      widthByRank: [12, 8, 4.5, 3, 2.2], blockSize: ranges([9000, 20000], [14000, 29000], [19000, 38000], [25000, 50000]),
      houseArea: ranges([700, 2000], [1100, 3000], [1600, 4200], [2400, 6500]),
      coverage: ranges([0.2, 0.42], [0.15, 0.35], [0.1, 0.25], [0.08, 0.2]), placeThreshold: 3000 },
  },
  {
    id: 'mississippian', label: 'Mississippien · centre à place palissadée', base: 'european-organic',
    plan: { pattern: 'radial', enclosure: 'oval', fortification: 'palisade', orientation: 'road' },
    refs: ['AM-MISS-S01', 'AM-MISS-S02', 'AM-MISS-S04'], description: 'Place ouverte, chemins et grands îlots de maisons/jardins ; les tertres artificiels restent à intégrer au relief.',
    params: { fieldNoise: 7, fieldRandom: 0.15, curvature: 0.4, closeOp: 'none', plotOp: 'compound',
      widthByRank: [7, 4.6, 3.2, 2.2, 1.6], blockSize: ranges([6000, 14000], [10000, 23000], [16000, 32000], [23000, 45000]),
      houseArea: ranges([450, 1200], [650, 1800], [1000, 2500], [1600, 4000]),
      coverage: ranges([0.2, 0.4], [0.15, 0.3], [0.1, 0.22], [0.06, 0.16]), placeThreshold: 2800 },
  },
];

for (const e of extensions) {
  const base = CULTURES[e.base];
  const plan = { ...originalPlan(base), ...e.plan, sources: source(...e.refs) };
  const recipes = [
    { id: 'core', label: 'Cœur', zone: 'core' },
    { id: 'ring', label: 'Extension', zone: 'middle' },
    { id: 'faubourg', label: 'Faubourg', zone: 'faubourg' },
    { id: 'village', label: 'Village', zone: 'village' },
    { id: 'hamlet', label: 'Hameau', zone: 'village' },
  ].map(r => ({ ...r, preset: `${e.id}/${r.id}` }));
  for (const r of recipes) {
    const params = deepMerge(resolveMorph(base.core.morphology), { ...e.params, id: `${e.id}/${r.id}` });
    // The native bench consumes street and parcel rules only. Do not relabel a
    // Roman domus, European roof or Indian temple as another tradition's building.
    Reflect.deleteProperty(params, 'arch');
    Reflect.deleteProperty(params, 'buildingOp');
    presets[r.preset] = { label: `${e.label} · ${r.label}`, params };
  }
  cultures[e.id] = { label: e.label, recipes, plan, description: e.description,
    core: { enclosure: { ...base.core.enclosure, shape: plan.enclosure, wall: plan.fortification, orientation: plan.orientation } },
    ring: base.ring ? { enclosure: { ...base.ring.enclosure, shape: plan.enclosure, wall: plan.fortification, orientation: plan.orientation } } : null,
    phaseCount: base.phaseCount, faubShare: base.faubShare,
    village: { form: base.village.form, enclosure: { shape: plan.enclosure, wall: plan.fortification, orientation: plan.orientation } },
    hamlet: { form: base.hamlet.form, enclosure: { shape: plan.enclosure, wall: plan.fortification, orientation: plan.orientation } },
    scope: 'Settlement patterns only; numerical ranges are artistic, not measured reconstructions.' };
}
writeFileSync(new URL('../crates/core/src/urban/catalogue.json', import.meta.url), JSON.stringify({ version: 2, fields: { quarters: BENCH_FIELDS.streets, parcels: BENCH_FIELDS.plots }, presets, cultures }, null, 2) + '\n');
