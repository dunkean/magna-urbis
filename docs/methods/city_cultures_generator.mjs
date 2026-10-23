// Adds real-world-inspired (and declared fantasy) settlement cultures to the
// native urban catalogue. Same construction as rust/scripts/export-urban-catalogue.ts
// `extensions`: base preset params + overrides, plan/nucleus/enclosure per culture.
// Idempotent: re-running replaces the entries it owns. Units: m and m².
// Usage: node docs/methods/city_cultures_generator.mjs rust/crates/core/src/urban/catalogue.json
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const text = readFileSync(file, 'utf8');
const crlf = text.includes('\r\n');
const cat = JSON.parse(text);

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (base, over) => {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  return out;
};
// core, middle, edge, faubourg, village
const z = (core, middle = core, edge = middle, faubourg = edge, village = faubourg) => ({ core, middle, edge, faubourg, village });
const atlas = 'docs/styles_architecturaux_mondiaux_city_mapper.md';
const doc = 'docs/CITY_CULTURES.md';

/** @type {Array<any>} */
const specs = [
  // ───────────────────────── Europe ─────────────────────────
  {
    id: 'al-andalus', label: 'Al-Andalus · médina ibérique à patios', base: 'medina/core',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'wall', gates: 'roads', orientation: 'terrain', stairs: true, waterfront: false },
    refs: ['AF-MAG-S03', 'EUR-MED-S03'],
    nucleus: { kind: 'mosque', shape: 'rect', area: [2500, 7000], compound: true, ring: 3, orientation: 'qibla' },
    phaseCount: [[0, 2], [8000, 3], [25000, 4]], faubShare: [0.2, 0.12], ring: true,
    village: 'auto', walls: { towers: 'square', fossil: 'street' },
    description: 'Souk et grande mosquée au centre, maisons à patio desservies par des adarves en impasse, arrabales hors les murs et cármenes jardinés en bordure.',
    params: {
      streets: ['gateToGate', 'extraRadials', 'organicInfill', 'culDeSacTree'], closeOp: 'culDeSacTree', orientation: 'terrain',
      contourBlend: 0.6, curvature: 0.85, fieldNoise: 26, deadEndRatio: 0.8, placeThreshold: 400,
      widthByRank: [6, 4.2, 3, 2.4, 1.9],
      blockSize: z([900, 2600], [1800, 5200], [3200, 9000], [4500, 12000], [6000, 16000]),
      houseArea: z([90, 280], [140, 380], [200, 560], [220, 600], [300, 900]),
      frontage: z([4.8, 7], [7, 12], [9, 15], [8, 14], [14, 30]),
      plotDepth: z([7, 12], [14, 24], [18, 32], [18, 34], [24, 50]),
      coverage: z([0.9, 0.97], [0.8, 0.9], [0.5, 0.66], [0.55, 0.7], [0.35, 0.55]),
      density: z(300, 220, 140, 80, 45),
    },
    recipeParams: { ring: { plotOp: 'courtyard' }, faubourg: { plotOp: 'courtyard' } },
  },
  {
    id: 'italian-comune', dscale: 1.4, label: 'Italie · commune à piazza et tours', base: 'european-organic/core',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'wall', gates: 'roads', orientation: 'terrain', stairs: true, waterfront: false },
    refs: ['EUR-MED-S08', 'EUR-MED-S09', 'EUR-MED-S11'],
    nucleus: { kind: 'market', shape: 'hull', area: [1500, 5000], compound: false, ring: 4 },
    phaseCount: [[0, 2], [6000, 3], [25000, 4]], faubShare: [0.12, 0.1], ring: true,
    village: 'auto', walls: { towers: 'square', fossil: 'street' },
    description: 'Piazza civique au cœur, cerchie successives, îlots massifs de maisons étroites à portiques ; borghi le long des routes hors les portes.',
    params: {
      orientation: 'terrain', contourBlend: 0.6, curvature: 0.6, fieldNoise: 14, deadEndRatio: 0.3, placeThreshold: 600,
      widthByRank: [7, 5, 3.6, 2.6, 2],
      blockSize: z([1500, 4000], [2500, 6500], [4000, 10000], [4500, 12000], [6000, 18000]),
      frontage: z([7.5, 10], [8, 11], [8, 12], [8, 12], [14, 30]), // holds EUR-MED-B09 (7 x 13.2 m)
      plotDepth: z([17, 28], [20, 34], [22, 40], [24, 44], [30, 60]),
      coverage: z([0.88, 0.96], [0.78, 0.88], [0.55, 0.7], [0.5, 0.65], [0.15, 0.3]),
      density: z(260, 180, 110, 60, 35),
    },
  },
  {
    id: 'flemish-cloth-town', label: 'Flandre · ville drapière à beffroi', base: 'hanseatic/core',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'wall', gates: 'roads', orientation: 'water', stairs: false, waterfront: true },
    refs: ['EUR-MED-S03', 'EUR-NOR-S04'],
    nucleus: { kind: 'clocktower', shape: 'rect', area: [3000, 9000], compound: false, ring: 4 },
    phaseCount: [[0, 2], [8000, 3], [30000, 4]], faubShare: [0.15, 0.1], ring: true,
    village: 'auto', walls: { towers: 'round', fossil: 'street' },
    description: 'Grand-Place et beffroi de la halle aux draps, canaux (reien) et enceintes successives ; maisons à pignon sur rue, parcelles profondes de teinturiers et foulons.',
    params: {
      streets: ['radials', 'rings', 'organicInfill', 'closes'], streetOp: 'organic', closeOp: 'closes',
      curvature: 0.35, fieldNoise: 8, deadEndRatio: 0.15,
      widthByRank: [9, 7, 5, 3.2, 2.4],
      blockSize: z([3500, 9000], [5000, 13000], [7000, 18000], [6000, 16000], [8000, 22000]),
      frontage: z([6, 8], [6.2, 9], [7, 10.5], [7, 12], [16, 32]),
      plotDepth: z([26, 44], [30, 50], [34, 60], [30, 56], [40, 70]),
      coverage: z([0.85, 0.94], [0.74, 0.86], [0.6, 0.72], [0.45, 0.6], [0.15, 0.3]),
      density: z(210, 160, 110, 60, 35),
    },
  },
  {
    id: 'rynek-town', label: 'Europe centrale · ville à rynek', base: 'bastide/core',
    plan: { pattern: 'grid', enclosure: 'oval', fortification: 'wall', gates: 'roads', orientation: 'road', stairs: false, waterfront: false },
    refs: ['EUR-MED-S04', 'EUR-MED-S07'],
    nucleus: { kind: 'market', shape: 'rect', area: [8000, 30000], compound: false, ring: 4 },
    phaseCount: [[0, 1], [4000, 2], [20000, 3]], faubShare: [0.18, 0.1], ring: true,
    village: 'auto', walls: { towers: 'square', fossil: 'street' },
    description: 'Ville de fondation (droit de Magdebourg) : grande place carrée du marché avec halle et hôtel de ville, damier de rues, lots profonds de bourgeois ; faubourgs le long des routes.',
    params: {
      gridSpacing: [60, 110], placeThreshold: 1500, deadEndRatio: 0.05,
      widthByRank: [10, 8, 5.5, 3.5, 2.5],
      blockSize: z([4000, 8000], [4500, 9000], [5500, 12000], [6000, 14000], [8000, 22000]),
      frontage: z([7, 10], [7.5, 11], [8, 13], [8, 14], [18, 40]),
      plotDepth: z([28, 40], [30, 44], [32, 50], [32, 56], [40, 80]),
      coverage: z([0.82, 0.92], [0.7, 0.82], [0.52, 0.66], [0.4, 0.55], [0.12, 0.3]),
      density: z(170, 140, 100, 55, 35),
    },
  },
  {
    id: 'slavic-gord', label: 'Slaves · gród palissadé et podgrodzie', base: 'russian-kremlin/core',
    plan: { pattern: 'radial', enclosure: 'oval', fortification: 'palisade', gates: 'roads', orientation: 'terrain', stairs: false, waterfront: false },
    refs: ['EUR-EAST-S02', 'EUR-EAST-S01'],
    nucleus: { kind: 'castle', shape: 'circle', area: [5000, 15000], compound: true, ring: 3 },
    phaseCount: [[0, 2], [3000, 3], [15000, 4]], faubShare: [0.25, 0.15], ring: true,
    village: 'ring', walls: { towers: 'square', fossil: 'street' },
    description: 'Gród de bois et de terre sur la hauteur, podgrodzie artisanal à ses pieds, rues pavées de rondins et grandes cours de maisons en rondins.',
    params: {
      streets: ['radials', 'rings', 'organicInfill'], closeOp: 'none', orientation: 'terrain', curvature: 0.5, fieldNoise: 12,
      widthByRank: [7, 5, 3.5, 2.6, 2],
      blockSize: z([4000, 10000], [6000, 14000], [8000, 18000], [8000, 20000], [9000, 24000]),
      frontage: z([12, 18], [14, 22], [16, 28], [16, 28], [20, 36]),
      plotDepth: z([26, 40], [30, 50], [36, 60], [36, 60], [45, 80]),
      coverage: z([0.32, 0.45], [0.26, 0.38], [0.18, 0.3], [0.16, 0.26], [0.1, 0.2]),
      density: z(80, 60, 45, 35, 25),
    },
  },
  {
    id: 'caucasian-highland', dscale: 1.15, label: 'Caucase · bourg fortifié géorgien et arménien', base: 'byzantine-greek/core',
    plan: { pattern: 'terraces', enclosure: 'organic', fortification: 'wall', gates: 'roads', orientation: 'terrain', stairs: true, waterfront: false },
    refs: ['EUR-EAST-S04', 'EUR-EAST-S05', 'EUR-EAST-S06'],
    nucleus: { kind: 'precinct', shape: 'rect', area: [1200, 4000], compound: true, ring: 3 },
    phaseCount: [[0, 1], [3000, 2], [12000, 3]], faubShare: [0.15, 0.1], ring: true,
    village: 'auto', walls: { towers: 'square', fossil: 'wall' },
    description: 'Église en enceinte fortifiée au sommet, maisons de pierre serrées en terrasses, ruelles et escaliers suivant les courbes de niveau.',
    params: {
      orientation: 'terrain', contourFollow: 0.8, contourBlend: 0.95, curvature: 0.7, fieldNoise: 10,
      widthByRank: [5, 3.8, 2.8, 2.2, 1.8],
      blockSize: z([1200, 3500], [1600, 4500], [2200, 6500], [2500, 8000], [3500, 12000]),
      frontage: z([6, 10], [6.5, 11], [7, 12], [7, 12], [12, 24]),
      plotDepth: z([12, 20], [14, 24], [16, 30], [16, 30], [22, 40]),
      coverage: z([0.75, 0.88], [0.62, 0.78], [0.45, 0.6], [0.4, 0.55], [0.18, 0.32]),
      density: z(170, 130, 90, 60, 35),
    },
  },
  // ───────────────────────── Africa ─────────────────────────
  {
    id: 'ethiopian-highland', label: 'Éthiopie · cité d’altitude (Aksum, Lalibela)', base: 'sahel/core',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'none', gates: 'roads', orientation: 'terrain', stairs: true, waterfront: false },
    refs: ['AF-EAST-S04', 'AF-EAST-S05', 'AF-EAST-S07', 'AF-EAST-S08'],
    nucleus: { kind: 'precinct', shape: 'circle', area: [3000, 10000], compound: true, ring: 3 },
    phaseCount: [[0, 1], [4000, 2], [15000, 3]], faubShare: [0.2, 0.2], ring: true,
    village: 'auto', walls: {},
    description: 'Enclos circulaire d’église sur la hauteur, concessions familiales de maisons rondes entourées de haies, sentiers courbes ; stèles et églises rupestres restent des réserves.',
    params: {
      streets: ['radials', 'organicInfill', 'closes'], closeOp: 'closes', plotOp: 'compound', orientation: 'terrain',
      curvature: 0.7, fieldNoise: 20, deadEndRatio: 0.4, contourBlend: 0.6,
      widthByRank: [7, 5, 3.5, 2.6, 2],
      blockSize: z([4000, 10000], [6000, 15000], [8000, 20000], [9000, 24000], [10000, 28000]),
      houseArea: z([250, 600], [320, 800], [400, 1000], [450, 1200], [500, 1500]),
      frontage: z([12, 20], [15, 26], [18, 32], [18, 32], [20, 40]),
      plotDepth: z([18, 30], [22, 36], [26, 44], [26, 44], [30, 60]),
      coverage: z([0.25, 0.4], [0.18, 0.32], [0.12, 0.25], [0.1, 0.22], [0.08, 0.18]),
      density: z(130, 105, 85, 50, 30),
    },
  },
  {
    id: 'great-zimbabwe', label: 'Zimbabwe · enclos de pierre sèche', base: 'kraal/grown-core',
    plan: { pattern: 'organic', enclosure: 'oval', fortification: 'none', gates: 'roads', orientation: 'terrain', stairs: false, waterfront: false },
    refs: ['AF-SOUTH-S04', 'AF-SOUTH-S05', 'AF-SOUTH-S09'],
    nucleus: { kind: 'royal-enclosure', shape: 'circle', area: [5000, 20000], compound: true, ring: 3 },
    phaseCount: [[0, 1], [5000, 2], [15000, 3]], faubShare: [0.25, 0.25], ring: true,
    village: 'ring', walls: {},
    description: 'Grand enclos royal de pierre sèche au centre, concessions de cases daga entourées de murets courbes, habitat qui se desserre vers la vallée.',
    params: {
      streets: ['radials', 'organicInfill'], closeOp: 'none', plotOp: 'compound', orientation: 'terrain',
      curvature: 0.8, fieldNoise: 22, deadEndRatio: 0.2,
      widthByRank: [7, 5, 3.6, 2.6, 2],
      blockSize: z([6000, 14000], [9000, 20000], [12000, 28000], [14000, 32000], [16000, 36000]),
      houseArea: z([900, 1800], [1000, 2200], [1200, 2600], [1300, 3000], [1400, 3200]),
      frontage: z([28, 38], [30, 42], [32, 46], [32, 46], [34, 50]),
      plotDepth: z([30, 42], [32, 46], [34, 50], [34, 50], [36, 56]),
      coverage: z([0.22, 0.36], [0.18, 0.3], [0.14, 0.25], [0.12, 0.22], [0.1, 0.2]),
      density: z(60, 45, 35, 25, 20),
    },
  },
  {
    id: 'hausa-kano', label: 'Hausa · cité-État à enceinte de terre (Kano)', base: 'sahel/core',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'wall', gates: 'roads', orientation: 'road', stairs: false, waterfront: false },
    refs: ['AF-SAHEL-S04', 'AF-SAHEL-S03'],
    nucleus: { kind: 'mosque', shape: 'rect', area: [4000, 12000], compound: true, ring: 3.5, orientation: 'qibla' },
    phaseCount: [[0, 2], [10000, 3], [40000, 4]], faubShare: [0.3, 0.15], ring: true,
    village: 'walled', walls: { towers: 'square', fossil: 'street' },
    description: 'Grande mosquée, palais de l’émir et marché Kurmi au centre ; concessions à cour derrière un vestibule (zaure), ruelles en impasse, vaste enceinte de terre englobant champs et mares.',
    params: {
      streets: ['gateToGate', 'radials', 'organicInfill', 'culDeSacTree'], closeOp: 'culDeSacTree', plotOp: 'courtyard',
      curvature: 0.75, fieldNoise: 22, deadEndRatio: 0.6, placeThreshold: 1200,
      widthByRank: [10, 6, 4, 3, 2.4],
      blockSize: z([5000, 12000], [7000, 16000], [9000, 22000], [10000, 26000], [12000, 30000]),
      houseArea: z([380, 800], [420, 900], [500, 1100], [500, 1200], [600, 1500]),
      frontage: z([19, 26], [19, 28], [20, 32], [20, 32], [22, 40]),
      plotDepth: z([20, 30], [20, 32], [22, 36], [22, 36], [26, 44]),
      coverage: z([0.45, 0.62], [0.38, 0.55], [0.3, 0.45], [0.25, 0.4], [0.2, 0.35]),
      density: z(140, 110, 80, 50, 35),
    },
  },
  // ─────────────────────── Middle East / South Asia ───────────────────────
  {
    id: 'hadhrami-tower', label: 'Hadramaout · cité verticale de maisons-tours (Shibam)', base: 'medina/core',
    plan: { pattern: 'organic', enclosure: 'rect', fortification: 'wall', gates: 'roads', orientation: 'road', stairs: false, waterfront: false },
    refs: ['AS-MIDE-S11', 'AS-MIDE-S09'],
    nucleus: { kind: 'mosque', shape: 'rect', area: [1200, 3500], compound: true, ring: 3, orientation: 'qibla' },
    phaseCount: [[0, 1]], faubShare: [0.05, 0.08], ring: false,
    village: 'walled', walls: { towers: 'square', fossil: 'wall' },
    description: 'Enceinte rectangulaire compacte sur une butte de la vallée, maisons-tours de 5 à 8 niveaux presque jointives, petites places et ruelles ; palmeraies hors les murs.',
    params: {
      streets: ['gateToGate', 'organicInfill'], closeOp: 'none', curvature: 0.25, fieldNoise: 6, deadEndRatio: 0.4, placeThreshold: 300,
      widthByRank: [6, 4, 3, 2.4, 2],
      blockSize: z([1200, 3000], [1500, 3800], [2000, 5000], [3000, 8000], [4000, 12000]),
      houseArea: z([60, 160], [70, 180], [80, 220], [100, 300], [150, 500]),
      frontage: z([7, 11], [7, 12], [8, 13], [8, 14], [12, 26]),
      plotDepth: z([9, 15], [10, 16], [11, 18], [12, 22], [18, 36]),
      coverage: z([0.92, 0.98], [0.88, 0.96], [0.8, 0.9], [0.6, 0.75], [0.3, 0.5]),
      density: z(450, 380, 300, 90, 45),
    },
  },
  {
    id: 'rajput-fort', label: 'Rajputana · ville au pied du fort (Jaisalmer, Amber)', base: 'persian/core',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'wall', gates: 'roads', orientation: 'terrain', stairs: true, waterfront: false },
    refs: ['AS-IND-S03', 'AS-IND-S07', 'AS-IND-S09'],
    nucleus: { kind: 'castle', shape: 'square', area: [15000, 60000], compound: true, ring: 3 },
    phaseCount: [[0, 2], [8000, 3], [30000, 4]], faubShare: [0.15, 0.1], ring: true,
    village: 'auto', walls: { towers: 'round', fossil: 'street' },
    description: 'Fort royal sur l’éperon, bazar entre les portes, havelis à cour dans des ruelles étroites, bassin (talab) et stepwells comme réserves de services.',
    params: {
      streets: ['gateToGate', 'extraRadials', 'organicInfill', 'culDeSacTree'], closeOp: 'culDeSacTree', plotOp: 'courtyard', orientation: 'terrain',
      contourBlend: 0.7, curvature: 0.75, fieldNoise: 20, deadEndRatio: 0.6, placeThreshold: 500,
      widthByRank: [7, 4.5, 3, 2.4, 2],
      blockSize: z([2000, 6000], [3000, 8000], [4000, 11000], [5000, 14000], [6000, 18000]),
      houseArea: z([250, 700], [300, 800], [350, 900], [300, 900], [400, 1200]),
      frontage: z([12, 24], [13, 25], [14, 26], [10, 20], [16, 32]),
      plotDepth: z([20, 30], [22, 32], [24, 36], [20, 34], [26, 50]),
      coverage: z([0.85, 0.95], [0.78, 0.9], [0.6, 0.75], [0.5, 0.65], [0.25, 0.4]),
      density: z(260, 190, 120, 70, 40),
    },
    recipeParams: { core: { plotOp: 'burgage', frontage: z([5, 8], [6, 9], [7, 11], [7, 12], [14, 30]), plotDepth: z([12, 20], [14, 24], [16, 28], [18, 32], [26, 50]) } },
  },
  {
    id: 'dravidian-temple', label: 'Inde du Sud · ville-temple à rues concentriques (Madurai)', base: 'indian-temple/core',
    plan: { pattern: 'grid', enclosure: 'square', fortification: 'none', gates: 'cardinal', orientation: 'cardinal', stairs: false, waterfront: false },
    refs: ['AS-IND-S04', 'AS-IND-S08'],
    nucleus: { kind: 'temple', shape: 'square', area: [20000, 80000], compound: true, ring: 3 },
    phaseCount: [[0, 1], [5000, 2], [20000, 3]], faubShare: [0.15, 0.15], ring: true,
    village: 'auto', walls: {},
    description: 'Enceinte du temple et ses gopurams au centre, rues processionnelles carrées concentriques (masi, avani, chitrai), rangées de maisons étroites et profondes ; bassin sacré.',
    params: {
      streets: ['axis', 'rings', 'grid'], gridSpacing: [80, 80], deadEndRatio: 0.05,
      widthByRank: [14, 9, 4, 3, 2.4],
      blockSize: z([3000, 6500], [3500, 8000], [4500, 10000], [5000, 12000], [7000, 20000]),
      frontage: z([5.5, 8], [6, 9], [7, 11], [7, 13], [16, 34]),
      plotDepth: z([24, 40], [26, 42], [28, 46], [30, 56], [40, 80]),
      coverage: z([0.8, 0.9], [0.72, 0.84], [0.58, 0.7], [0.4, 0.55], [0.12, 0.3]),
      density: z(200, 160, 110, 60, 35),
    },
  },
  // ───────────────────────── East & South-East Asia ─────────────────────────
  {
    id: 'bagan', label: 'Birmanie · cité royale de Pagan', base: 'indian-temple/core',
    plan: { pattern: 'grid', enclosure: 'square', fortification: 'wall', gates: 'cardinal', orientation: 'cardinal', stairs: false, waterfront: true },
    refs: ['AS-SEA-S04', 'AS-SEA-S08'],
    nucleus: { kind: 'temple', shape: 'square', area: [4000, 14000], compound: true, ring: 3 },
    phaseCount: [[0, 1], [4000, 2], [15000, 3]], faubShare: [0.35, 0.3], ring: true,
    village: 'auto', walls: { towers: 'square', fossil: 'wall' },
    description: 'Cité murée carrée du palais au bord du fleuve, maisons sur pilotis dans de grands enclos plantés, monastères et stupas épars dans la plaine.',
    params: {
      streets: ['axis', 'grid'], plotOp: 'compound', closeOp: 'none', gridSpacing: [120, 160], gridSkew: 0.04, fieldNoise: 3,
      widthByRank: [12, 8, 5, 3.5, 2.5],
      blockSize: z([8000, 18000], [11000, 24000], [14000, 30000], [16000, 36000], [20000, 45000]),
      houseArea: z([300, 700], [400, 900], [500, 1200], [600, 1500], [800, 2000]),
      frontage: z([14, 22], [16, 26], [18, 30], [18, 32], [20, 40]),
      plotDepth: z([20, 32], [24, 38], [28, 44], [28, 48], [32, 60]),
      coverage: z([0.25, 0.4], [0.2, 0.34], [0.15, 0.28], [0.12, 0.24], [0.08, 0.18]),
      density: z(90, 70, 50, 35, 25),
    },
  },
  {
    id: 'vietnamese-citadel', label: 'Viêt · citadelle et quartier marchand (Thăng Long)', base: 'chinese/core',
    plan: { pattern: 'grid', enclosure: 'square', fortification: 'wall', gates: 'cardinal', orientation: 'cardinal', stairs: false, waterfront: true },
    refs: ['AS-SEA-S06', 'AS-CHI-S03'],
    nucleus: { kind: 'castle', shape: 'square', area: [40000, 120000], compound: true, ring: 3 },
    phaseCount: [[0, 2], [8000, 3], [40000, 4]], faubShare: [0.3, 0.2], ring: true,
    village: 'auto', walls: { towers: 'square', fossil: 'wall' },
    description: 'Citadelle carrée à douves et portes cardinales, maisons à cour en enclos ; hors les murs, quartier marchand des « 36 rues » aux maisons-tubes étroites et profondes.',
    params: {
      streets: ['axis', 'grid'], closeOp: 'none', plotOp: 'compound', gridSpacing: [140, 200], laneSpacing: [0, 0], wardArea: 0,
      widthByRank: [12, 8, 5, 3.4, 2.4],
      blockSize: z([8000, 16000], [9000, 18000], [10000, 22000], [8000, 20000], [10000, 28000]),
      houseArea: z([700, 1300], [800, 1500], [900, 1700], [500, 1200], [800, 2000]),
      frontage: z([25, 34], [26, 36], [26, 38], [20, 32], [24, 44]),
      plotDepth: z([36, 48], [36, 50], [38, 52], [30, 46], [36, 60]),
      coverage: z([0.4, 0.55], [0.35, 0.5], [0.3, 0.45], [0.3, 0.45], [0.15, 0.3]),
      density: z(140, 120, 90, 60, 35),
    },
    recipeParams: {
      ring: { streets: ['radials', 'organicInfill', 'closes'], streetOp: 'organic', closeOp: 'closes', plotOp: 'burgage', curvature: 0.45, fieldNoise: 12,
        frontage: z([6, 9], [6, 9], [7, 10], [7, 12], [14, 30]), plotDepth: z([24, 44], [26, 46], [28, 50], [28, 50], [30, 60]),
        coverage: z([0.85, 0.94], [0.8, 0.9], [0.6, 0.75], [0.5, 0.65], [0.15, 0.3]), density: z(260, 220, 140, 70, 35) },
      faubourg: { streetOp: 'organic', plotOp: 'burgage', frontage: z([7, 11], [7, 11], [8, 12], [8, 13], [14, 30]) },
    },
  },
  {
    id: 'tibetan-monastery', dscale: 2.0, label: 'Tibet · bourg monastique de pente', base: 'byzantine-greek/core',
    plan: { pattern: 'terraces', enclosure: 'terraces', fortification: 'none', gates: 'roads', orientation: 'terrain', stairs: true, waterfront: false },
    refs: ['AS-HIM-S04', 'AS-HIM-S06', 'AS-HIM-S02'],
    nucleus: { kind: 'temple', shape: 'rect', area: [6000, 20000], compound: true, ring: 3 },
    phaseCount: [[0, 1], [3000, 2], [12000, 3]], faubShare: [0.12, 0.12], ring: true,
    village: 'terraces', walls: {},
    description: 'Monastère et salle d’assemblée en haut de pente, cellules et maisons à toit-terrasse en gradins, circuit de pèlerinage (kora) autour ; pas de dzong automatique.',
    params: {
      orientation: 'terrain', contourFollow: 0.95, contourBlend: 1, fieldNoise: 4, fieldRandom: 0.08, curvature: 0.75, closeOp: 'none',
      widthByRank: [5, 3.6, 2.6, 2, 1.6],
      blockSize: z([1500, 4000], [2200, 5500], [3000, 7500], [3500, 9000], [4500, 12000]),
      houseArea: z([130, 320], [160, 400], [200, 500], [220, 600], [300, 900]),
      frontage: z([12, 17], [12.5, 18], [13, 19], [13, 19], [14, 28]), // holds AS-HIM-B04 (10.2 x 12.3 m)
      plotDepth: z([14, 21], [14, 23], [15, 25], [15, 26], [18, 36]),
      coverage: z([0.6, 0.8], [0.5, 0.7], [0.4, 0.58], [0.35, 0.5], [0.2, 0.35]),
      density: z(150, 110, 80, 50, 30),
    },
  },
  {
    id: 'mongol-ordu', dscale: 1.5, label: 'Mongols · ordu, camp princier de yourtes', base: 'morph/plains-camp',
    plan: { pattern: 'radial', enclosure: 'circle', fortification: 'none', gates: 'cardinal', orientation: 'cardinal', stairs: false, waterfront: false },
    refs: ['AS-STEP-S01', 'AS-STEP-S02', 'AS-STEP-S09'],
    nucleus: { kind: 'none', shape: 'circle', area: [0, 0], compound: false, ring: 3 },
    phaseCount: [[0, 1]], faubShare: [0, 0], ring: false, camp: true,
    village: 'ring', walls: {},
    description: 'Tente du khan au centre, ouverte au sud, anneaux et rangées de yourtes des clans, larges allées pour les chariots ; au-delà d’un seuil, capitale fixe murée à damier (Karakorum).',
    params: {
      streets: ['radials', 'rings', 'organicInfill'], closeOp: 'none', plotOp: 'compound', orientation: 'cardinal', curvature: 0.35, fieldNoise: 6,
      widthByRank: [14, 9, 6, 4, 3],
      blockSize: z([5000, 12000], [6000, 15000], [8000, 20000], [8000, 20000], [8000, 22000]),
      houseArea: z([120, 300], [150, 350], [180, 420], [180, 420], [200, 500]),
      frontage: z([10, 16], [11, 17], [12, 18], [12, 18], [12, 20]),
      plotDepth: z([12, 20], [13, 22], [14, 24], [14, 24], [14, 26]),
      coverage: z([0.12, 0.25], [0.1, 0.22], [0.08, 0.18], [0.08, 0.18], [0.06, 0.15]),
      density: z(70, 60, 50, 45, 40),
    },
    growth: {
      minPop: 8000,
      base: 'oasis-caravan/core',
      plan: { pattern: 'grid', enclosure: 'rect', fortification: 'wall', gates: 'cardinal', orientation: 'cardinal', stairs: false, waterfront: false },
      phaseCount: [[0, 1], [8000, 2], [40000, 3]], faubShare: [0.35, 0.3],
      params: {
        streets: ['axis', 'grid'], streetOp: 'grid', closeOp: 'none', plotOp: 'compound', gridSpacing: [110, 160], gridSkew: 0.03, fieldNoise: 2,
        widthByRank: [14, 9, 5, 3.4, 2.5],
        blockSize: z([6000, 14000], [8000, 18000], [10000, 24000], [10000, 26000], [12000, 30000]),
        houseArea: z([250, 650], [300, 800], [350, 900], [300, 900], [400, 1200]),
        frontage: z([12, 20], [13, 22], [14, 24], [12, 20], [14, 28]),
        plotDepth: z([16, 26], [18, 28], [18, 30], [16, 28], [18, 34]),
        coverage: z([0.35, 0.5], [0.3, 0.45], [0.2, 0.35], [0.12, 0.25], [0.1, 0.2]),
        density: z(150, 110, 80, 60, 40),
      },
    },
  },
  // ───────────────────────── Oceania & the Americas ─────────────────────────
  {
    id: 'maori-pa', dscale: 3.5, label: 'Māori · pā fortifié en terrasses', base: 'morph/kraal-town',
    plan: { pattern: 'terraces', enclosure: 'organic', fortification: 'palisade', gates: 'roads', orientation: 'terrain', stairs: true, waterfront: false },
    refs: ['OC-PAC-S04', 'OC-PAC-S05'],
    nucleus: { kind: 'none', shape: 'circle', area: [0, 0], compound: false, ring: 3 },
    phaseCount: [[0, 1]], faubShare: [0, 0], ring: false, camp: true,
    village: 'terraces', walls: {},
    description: 'Colline ou éperon taillé en terrasses défendues par fossés et palissades, marae et maison de réunion sur la plate-forme haute, whare et pataka serrés sur les gradins.',
    params: {
      streets: ['radials', 'organicInfill'], closeOp: 'none', plotOp: 'burgage', orientation: 'terrain', contourFollow: 0.9, contourBlend: 1,
      curvature: 0.8, fieldNoise: 10,
      widthByRank: [4, 3, 2.4, 2, 1.6],
      blockSize: z([1200, 3500], [1600, 4500], [2000, 5500], [2000, 5500], [2500, 7000]),
      houseArea: z([100, 260], [120, 300], [140, 340], [140, 340], [160, 400]),
      frontage: z([7, 12], [8, 13], [9, 15], [9, 15], [10, 18]),
      plotDepth: z([10, 16], [11, 18], [12, 20], [12, 20], [14, 24]),
      coverage: z([0.25, 0.4], [0.22, 0.36], [0.18, 0.3], [0.18, 0.3], [0.12, 0.25]),
      density: z(120, 100, 80, 70, 50),
    },
  },
  {
    id: 'pnw-plank-village', label: 'Côte Nord-Ouest · village de maisons de planches', base: 'native-iroquoian/core',
    plan: { pattern: 'linear', enclosure: 'oval', fortification: 'none', gates: 'roads', orientation: 'water', stairs: false, waterfront: true },
    refs: ['AM-PNW-S01', 'AM-PNW-S02', 'AM-PNW-S05'],
    nucleus: { kind: 'none', shape: 'circle', area: [0, 0], compound: false, ring: 3 },
    phaseCount: [[0, 1]], faubShare: [0, 0], ring: false, camp: true,
    village: 'auto', walls: {},
    description: 'Rangée de grandes maisons de clan en planches de cèdre, façades peintes et mâts tournés vers la plage, canots et séchoirs au rivage.',
    params: {
      streets: ['organicInfill'], closeOp: 'none', plotOp: 'burgage', orientation: 'water', curvature: 0.3, fieldNoise: 6,
      widthByRank: [8, 6, 4, 3, 2.4],
      blockSize: z([3000, 8000], [4000, 10000], [5000, 12000], [5000, 12000], [6000, 15000]),
      houseArea: z([300, 700], [350, 800], [400, 900], [400, 900], [450, 1000]),
      frontage: z([13, 20], [14, 21], [14, 22], [14, 22], [15, 24]),
      plotDepth: z([28, 38], [28, 40], [30, 42], [30, 42], [30, 46]),
      coverage: z([0.35, 0.5], [0.3, 0.45], [0.25, 0.4], [0.25, 0.4], [0.2, 0.35]),
      density: z(90, 80, 70, 60, 50),
    },
  },
  {
    id: 'inuit-camp', dscale: 6.5, label: 'Arctique · camp inuit d’hiver', base: 'morph/plains-camp',
    plan: { pattern: 'dispersed', enclosure: 'circle', fortification: 'none', gates: 'roads', orientation: 'water', stairs: false, waterfront: true },
    refs: ['AM-ARC-S02', 'AM-ARC-S04', 'AM-ARC-S07'],
    nucleus: { kind: 'none', shape: 'circle', area: [0, 0], compound: false, ring: 3 },
    phaseCount: [[0, 1]], faubShare: [0, 0], ring: false, camp: true,
    village: 'ring', walls: {},
    description: 'Groupe d’igloos et de tentes de peaux près du rivage ou de la banquise, maison commune (qaggiq) au centre, caches et séchoirs autour.',
    params: {
      streets: ['radials', 'organicInfill'], closeOp: 'none', plotOp: 'compound', orientation: 'water', curvature: 0.6, fieldNoise: 14,
      widthByRank: [5, 4, 3, 2.4, 2],
      blockSize: z([2000, 6000], [2500, 7000], [3000, 8000], [3000, 8000], [3000, 9000]),
      houseArea: z([80, 200], [90, 220], [100, 240], [100, 240], [100, 260]),
      frontage: z([8, 13], [8, 14], [9, 15], [9, 15], [9, 16]),
      plotDepth: z([9, 14], [9, 15], [10, 16], [10, 16], [10, 18]),
      coverage: z([0.15, 0.3], [0.14, 0.28], [0.12, 0.25], [0.12, 0.25], [0.1, 0.22]),
      density: z(40, 35, 30, 30, 25),
    },
  },
  {
    id: 'siberian-camp', dscale: 6.0, label: 'Sibérie · campement de chums des éleveurs de rennes', base: 'morph/plains-camp',
    plan: { pattern: 'radial', enclosure: 'circle', fortification: 'none', gates: 'roads', orientation: 'terrain', stairs: false, waterfront: false },
    refs: ['AS-SIB-S01', 'AS-SIB-S02', 'AS-SIB-S05'],
    nucleus: { kind: 'none', shape: 'circle', area: [0, 0], compound: false, ring: 3 },
    phaseCount: [[0, 1]], faubShare: [0, 0], ring: false, camp: true,
    village: 'ring', walls: {},
    description: 'Tentes coniques en arc ouvert, traîneaux et caches sur poteaux derrière, enclos à rennes en périphérie ; village de rondins à partir de quelques centaines d’habitants.',
    params: {
      streets: ['radials', 'rings', 'organicInfill'], closeOp: 'none', plotOp: 'compound', orientation: 'terrain', curvature: 0.5, fieldNoise: 10,
      widthByRank: [6, 4.5, 3.2, 2.5, 2],
      blockSize: z([2500, 7000], [3000, 8000], [3500, 9000], [3500, 9000], [4000, 10000]),
      houseArea: z([90, 220], [100, 240], [110, 260], [110, 260], [120, 300]),
      frontage: z([9, 14], [9, 15], [10, 16], [10, 16], [10, 18]),
      plotDepth: z([10, 15], [10, 16], [11, 18], [11, 18], [12, 20]),
      coverage: z([0.12, 0.25], [0.1, 0.22], [0.1, 0.2], [0.1, 0.2], [0.08, 0.18]),
      density: z(35, 32, 28, 26, 24),
    },
  },
  {
    id: 'guarani-village', dscale: 1.5, label: 'Guaraní · village de grandes maisons (tekoha)', base: 'morph/kraal-town',
    plan: { pattern: 'radial', enclosure: 'circle', fortification: 'palisade', gates: 'roads', orientation: 'road', stairs: false, waterfront: false },
    refs: ['AM-SOUTH-S03', 'AM-SOUTH-S05'],
    nucleus: { kind: 'none', shape: 'circle', area: [0, 0], compound: false, ring: 3 },
    phaseCount: [[0, 1]], faubShare: [0, 0], ring: false, camp: true,
    village: 'ring', walls: {},
    description: 'Quelques grandes maisons communes (óga guasu) autour d’une place de danse, palissade et essarts de manioc et de maïs en couronne.',
    params: {
      streets: ['radials', 'rings'], closeOp: 'none', plotOp: 'compound', orientation: 'road', curvature: 0.4, fieldNoise: 8,
      widthByRank: [8, 6, 4, 3, 2.4],
      blockSize: z([5000, 12000], [6000, 14000], [7000, 16000], [7000, 16000], [8000, 18000]),
      houseArea: z([400, 900], [450, 1000], [500, 1100], [500, 1100], [500, 1200]),
      frontage: z([12, 20], [12, 21], [13, 22], [13, 22], [14, 24]),
      plotDepth: z([26, 38], [26, 40], [28, 42], [28, 42], [28, 44]),
      coverage: z([0.2, 0.35], [0.18, 0.32], [0.16, 0.3], [0.16, 0.3], [0.14, 0.26]),
      density: z(70, 60, 55, 50, 45),
    },
  },
  {
    id: 'budj-bim', dscale: 4.0, label: 'Australie · village de pierre du Budj Bim', base: 'morph/plains-camp',
    plan: { pattern: 'dispersed', enclosure: 'organic', fortification: 'none', gates: 'roads', orientation: 'water', stairs: false, waterfront: true },
    refs: ['OC-AUS-S03', 'OC-AUS-S04', 'OC-AUS-S08'],
    nucleus: { kind: 'none', shape: 'circle', area: [0, 0], compound: false, ring: 3 },
    phaseCount: [[0, 1]], faubShare: [0, 0], ring: false, camp: true,
    village: 'auto', walls: {},
    description: 'Cabanes de pierre sèche groupées sur les coulées de lave près des chenaux à anguilles et des pièges ; les barrages restent du décor.',
    params: {
      streets: ['organicInfill', 'closes'], closeOp: 'closes', plotOp: 'compound', orientation: 'water', curvature: 0.9, fieldNoise: 24,
      widthByRank: [4, 3, 2.4, 2, 1.6],
      blockSize: z([1800, 5000], [2200, 6000], [2600, 7000], [2600, 7000], [3000, 8000]),
      houseArea: z([100, 240], [110, 260], [120, 280], [120, 280], [130, 300]),
      frontage: z([8, 13], [8, 14], [9, 15], [9, 15], [9, 16]),
      plotDepth: z([10, 16], [10, 17], [11, 18], [11, 18], [12, 20]),
      coverage: z([0.18, 0.32], [0.16, 0.3], [0.14, 0.26], [0.14, 0.26], [0.12, 0.22]),
      density: z(50, 45, 40, 35, 30),
    },
  },
  // ───────────────────────── Fantasy on real morphologies ─────────────────────────
  {
    id: 'lizardfolk-swamp', dscale: 1.45, label: 'Hommes-lézards · cité lacustre sur pilotis', base: 'morph/stilt-town',
    plan: { pattern: 'dispersed', enclosure: 'organic', fortification: 'none', gates: 'roads', orientation: 'water', stairs: false, waterfront: true },
    refs: ['AM-TROP-S05', 'AS-SEA-S05', 'OC-PAC-S03'], fantasy: true,
    nucleus: { kind: 'precinct', shape: 'circle', area: [800, 2500], compound: true, ring: 3 },
    phaseCount: [[0, 1], [4000, 2]], faubShare: [0.25, 0.25], ring: true,
    village: 'auto', walls: {},
    description: 'Morphologie des villages palafittes : plates-formes sur pilotis reliées par des passerelles sinueuses autour d’un bassin sacré ; pas de rues larges.',
    params: {
      streets: ['organicInfill', 'closes'], closeOp: 'closes', plotOp: 'compound', orientation: 'water', curvature: 1.0, fieldNoise: 30,
      widthByRank: [4, 3, 2.4, 2, 1.6], deadEndRatio: 0.6,
      blockSize: z([2000, 5500], [2500, 7000], [3000, 8500], [3000, 9000], [3500, 10000]),
      houseArea: z([150, 350], [170, 400], [190, 450], [190, 450], [200, 500]),
      frontage: z([9, 14], [9, 15], [10, 16], [10, 16], [10, 18]),
      plotDepth: z([14, 22], [14, 23], [15, 24], [15, 24], [16, 26]),
      coverage: z([0.3, 0.45], [0.26, 0.4], [0.22, 0.36], [0.2, 0.34], [0.16, 0.3]),
      density: z(90, 80, 70, 55, 45),
    },
  },
  {
    id: 'merfolk-tidal', dscale: 1.6, label: 'Ondins · village de grève et de grottes marines', base: 'venetian-lagoon/core',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'none', gates: 'roads', orientation: 'water', stairs: true, waterfront: true },
    refs: ['OC-PAC-S03', 'OC-PAC-S10', 'AS-SEA-S05'], fantasy: true,
    nucleus: { kind: 'temple', shape: 'circle', area: [1000, 3000], compound: true, ring: 3 },
    phaseCount: [[0, 1], [4000, 2]], faubShare: [0.1, 0.1], ring: true,
    village: 'auto', walls: {},
    description: 'Morphologie de lagune et d’îlots (Nan Madol, villages palafittes) : maisons sur plates-formes au ras de l’eau, ruelles-escaliers vers les grottes, sanctuaire de marée au centre.',
    params: {
      orientation: 'water', curvature: 0.8, fieldNoise: 20, deadEndRatio: 0.5, plotOp: 'compound', closeOp: 'closes',
      widthByRank: [6, 4, 3, 2.4, 2],
      blockSize: z([1500, 4500], [2000, 6000], [2600, 7500], [3000, 8500], [3500, 10000]),
      houseArea: z([120, 300], [140, 340], [160, 380], [160, 380], [180, 420]),
      frontage: z([8, 13], [8.5, 14], [9, 15], [9, 15], [10, 18]),
      plotDepth: z([12, 20], [13, 21], [14, 22], [14, 22], [15, 24]),
      coverage: z([0.4, 0.55], [0.34, 0.5], [0.28, 0.42], [0.25, 0.4], [0.18, 0.32]),
      density: z(110, 95, 80, 60, 45),
    },
  },
  {
    id: 'giant-hold', label: 'Géants · bourg mégalithique', base: 'european-organic/core',
    plan: { pattern: 'radial', enclosure: 'circle', fortification: 'wall', gates: 'roads', orientation: 'terrain', stairs: false, waterfront: false },
    refs: ['EUR-NOR-S07', 'ATL-CEL-S08', 'EUR-NOR-S01'], fantasy: true,
    nucleus: { kind: 'castle', shape: 'rect', area: [8000, 25000], compound: true, ring: 3 },
    phaseCount: [[0, 1], [2000, 2]], faubShare: [0.1, 0.1], ring: true,
    village: 'ring', walls: { towers: 'round', fossil: 'wall' },
    description: 'Morphologie de fort annulaire à l’échelle ×2–3 : grande salle du jarl au centre, rues et enclos démesurés, enceinte cyclopéenne ; les maisons restent des recettes humaines (lacune).',
    params: {
      streets: ['radials', 'rings', 'organicInfill'], closeOp: 'none', plotOp: 'compound', orientation: 'terrain', curvature: 0.45, fieldNoise: 10,
      minWidth: 30, minBlock: 2500, placeThreshold: 4000,
      widthByRank: [16, 12, 9, 6, 4],
      blockSize: z([12000, 30000], [16000, 38000], [20000, 45000], [20000, 45000], [24000, 55000]),
      houseArea: z([1200, 3000], [1400, 3400], [1600, 3800], [1600, 3800], [1800, 4500]),
      frontage: z([20, 32], [22, 34], [24, 36], [24, 36], [26, 40]),
      plotDepth: z([40, 60], [42, 64], [44, 68], [44, 68], [46, 72]),
      coverage: z([0.25, 0.4], [0.22, 0.36], [0.18, 0.3], [0.16, 0.28], [0.12, 0.24]),
      density: z(25, 22, 18, 15, 12),
    },
  },
  {
    id: 'goblin-warren', label: 'Gobelins · terrier à flanc de colline', base: 'medina/core',
    plan: { pattern: 'organic', enclosure: 'organic', fortification: 'palisade', gates: 'roads', orientation: 'terrain', stairs: true, waterfront: false },
    refs: ['AS-SIB-S07', 'AS-SIB-S03', 'AF-MAG-S09'], fantasy: true,
    nucleus: { kind: 'none', shape: 'circle', area: [0, 0], compound: false, ring: 3 },
    phaseCount: [[0, 1], [3000, 2], [12000, 3]], faubShare: [0.3, 0.3], ring: true,
    village: 'auto', walls: {},
    description: 'Morphologie des villages de maisons semi-souterraines : buttes creusées en grappes, boyaux en impasse très ramifiés suivant la pente, palissade de pieux ; aucune place ordonnée.',
    params: {
      streets: ['organicInfill', 'culDeSacTree'], closeOp: 'culDeSacTree', plotOp: 'compound', orientation: 'terrain', contourBlend: 0.8,
      curvature: 1.1, fieldNoise: 36, deadEndRatio: 0.95, placeThreshold: 200,
      widthByRank: [4, 3, 2.2, 1.8, 1.4],
      blockSize: z([1500, 4500], [2000, 5500], [2500, 7000], [3000, 8000], [3500, 10000]),
      houseArea: z([260, 500], [280, 540], [300, 600], [300, 600], [320, 650]),
      frontage: z([17, 24], [17, 25], [18, 26], [18, 26], [18, 28]),
      plotDepth: z([15, 22], [15, 23], [16, 24], [16, 24], [16, 26]),
      coverage: z([0.55, 0.75], [0.5, 0.7], [0.42, 0.6], [0.38, 0.55], [0.3, 0.45]),
      density: z(320, 260, 200, 140, 90),
    },
  },
];

const recipeNames = (ring) => (ring
  ? [['core', 'Cœur', 'core'], ['ring', 'Extension', 'middle'], ['faubourg', 'Faubourg', 'faubourg'], ['village', 'Village', 'village'], ['hamlet', 'Hameau', 'village']]
  : [['core', 'Cœur', 'core'], ['village', 'Village', 'village'], ['hamlet', 'Hameau', 'village']]);

const preset = (base, over, id) => {
  const src = cat.presets[base]?.params;
  if (!src) throw new Error(`unknown base preset ${base}`);
  const params = deepMerge(structuredClone(src), { ...over, id });
  // The native bench consumes street and parcel rules only; a base's building
  // operator or architecture is never relabelled as another tradition.
  delete params.arch; delete params.buildingOp;
  return params;
};
const enclosure = (plan, walls) => ({ shape: plan.enclosure, wall: plan.fortification, ...(walls.fossil ? { fossil: walls.fossil } : {}), ...(walls.towers ? { towers: walls.towers } : {}), orientation: plan.orientation });

const owned = new Set(specs.map(s => s.id));
for (const id of Object.keys(cat.presets)) if (owned.has(id.split('/')[0])) delete cat.presets[id];

for (const s of specs) {
  const plan = { ...s.plan, sources: [...s.refs.map(r => `${atlas}#${r}`), `${doc}#${s.id}`] };
  const recipes = recipeNames(s.ring).map(([id, label, zone]) => ({ id, label, zone, preset: `${s.id}/${id}` }));
  for (const r of recipes) {
    const params = preset(s.base, deepMerge(s.params, s.recipeParams?.[r.id] ?? {}), r.preset);
    // Density calibrated so that the footprint holds about one household group per lot.
    if (s.dscale) for (const k of Object.keys(params.density)) params.density[k] = Math.round(params.density[k] * s.dscale);
    cat.presets[r.preset] = { label: `${s.label} · ${r.label}`, params };
  }
  let growth = null;
  if (s.growth) {
    const g = s.growth;
    const gplan = { ...g.plan, sources: plan.sources };
    for (const [id, label, zone] of recipeNames(true).slice(0, 3)) {
      const pid = `${s.id}/grown-${id}`;
      cat.presets[pid] = { label: `${s.label} · Ville développée / ${label.toLowerCase()}`, params: preset(g.base, g.params, pid) };
      recipes.push({ id: `grown-${id}`, label: `Ville développée / ${label.toLowerCase()}`, zone, preset: pid });
    }
    growth = { minPop: g.minPop, plan: gplan,
      core: { enclosure: enclosure(gplan, { towers: 'square', fossil: 'street' }) },
      ring: { enclosure: enclosure(gplan, { towers: 'square', fossil: 'street' }) },
      phaseCount: g.phaseCount, faubShare: g.faubShare };
  }
  const village = { form: s.village, enclosure: { shape: s.plan.enclosure, wall: s.camp ? s.plan.fortification : 'none', orientation: s.plan.orientation } };
  cat.cultures[s.id] = {
    label: s.label, recipes, plan, description: s.description,
    nucleus: s.nucleus,
    core: { enclosure: enclosure(s.plan, s.walls) },
    ring: s.ring ? { enclosure: enclosure(s.plan, s.walls) } : null,
    phaseCount: s.phaseCount, faubShare: s.faubShare,
    village, hamlet: { ...village },
    ...(s.camp ? { render: { plotLines: false, openGround: true } } : {}),
    growth,
    scope: s.fantasy
      ? 'Fantasy settlement built on the cited real morphologies; numerical ranges are artistic.'
      : 'Settlement patterns only; numerical ranges are artistic, not measured reconstructions.',
  };
}
let out = JSON.stringify(cat, null, 2) + '\n';
if (crlf) out = out.replace(/\n/g, '\r\n');
writeFileSync(file, out);
console.log(`${specs.length} cultures, ${Object.keys(cat.cultures).length} total, ${Object.keys(cat.presets).length} presets`);
