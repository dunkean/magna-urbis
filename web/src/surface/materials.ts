import { DepositOrigin, type MaterialRecipe, type RockUnit, type SurfaceFamily, type SurfaceSample } from './model';

export const DEFAULT_ROCK_UNITS: RockUnit[] = [
  { id: 1, name: 'Granitic basement', lithology: 'granite', sand: 0.67, silt: 0.23, clay: 0.1, hardness: 0.85, weatherability: 0.35, colorLinear: [0.34, 0.31, 0.28], strikeRadians: 0.4 },
  { id: 2, name: 'Carbonate beds', lithology: 'limestone', sand: 0.22, silt: 0.43, clay: 0.35, hardness: 0.65, weatherability: 0.55, colorLinear: [0.52, 0.49, 0.39], strikeRadians: 1.1 },
  { id: 3, name: 'Quartz sandstone', lithology: 'sandstone', sand: 0.82, silt: 0.13, clay: 0.05, hardness: 0.62, weatherability: 0.5, colorLinear: [0.46, 0.31, 0.18], strikeRadians: 0.7 },
  { id: 4, name: 'Clay and marl beds', lithology: 'mudstone', sand: 0.12, silt: 0.43, clay: 0.45, hardness: 0.28, weatherability: 0.85, colorLinear: [0.29, 0.24, 0.19], strikeRadians: 0.8 },
  { id: 5, name: 'Basaltic flows', lithology: 'basalt', sand: 0.31, silt: 0.29, clay: 0.4, hardness: 0.92, weatherability: 0.5, colorLinear: [0.085, 0.075, 0.065], strikeRadians: 0 },
];

function recipe(id: string, family: SurfaceFamily, color: [number, number, number], mode: MaterialRecipe['synthesisMode'], extent: number, relief: number, roughness = 0.85): MaterialRecipe {
  const surfaceRole: MaterialRecipe['surfaceRole'] = ['forest-litter', 'vegetation-litter'].includes(id) ? 'low-cover' : family === 'inland-water' || family === 'marine' ? 'water' : family === 'snow-ice' ? 'seasonal' : 'ground';
  return {
    id,
    version: '1',
    family,
    surfaceRole,
    colorLinear: color,
    synthesisMode: mode,
    physicalExtentMetres: extent,
    heightAmplitudeMetres: relief,
    roughness,
    normalConvention: 'opengl',
    compatibleSubstrates: [],
    compatibleProcesses: [DepositOrigin.Residual, DepositOrigin.Colluvial, DepositOrigin.Alluvial, DepositOrigin.Aeolian, DepositOrigin.Coastal],
    provenance: 'Authored analytic material; no photographic PBR asset claimed',
    wetResponse: 0.4,
    snowRetention: 0.7,
  };
}

/** All 15 landscape families have an executable contextual recipe; special processes require explicit inputs. */
export const SURFACE_MATERIALS: MaterialRecipe[] = [
  recipe('mineral-soil', 'mineral-plains', [0.25, 0.17, 0.105], 'patches', 0.6, 0.008),
  recipe('fractured-bedrock', 'bedrock', [0.4, 0.37, 0.32], 'fractures', 3, 0.04),
  recipe('wind-ripple-sand', 'aeolian', [0.58, 0.43, 0.25], 'ridges', 0.45, 0.025),
  recipe('arid-reg', 'arid-erosion', [0.28, 0.2, 0.13], 'cracks', 1.8, 0.016),
  recipe('angular-talus', 'gravity', [0.28, 0.26, 0.23], 'deposits', 2.2, 0.22),
  recipe('carbonate-karst', 'karst', [0.48, 0.47, 0.39], 'fractures', 1.6, 0.07),
  recipe('volcanic-crust', 'volcanic', [0.075, 0.064, 0.054], 'fractures', 1.3, 0.065),
  recipe('alluvial-bars', 'alluvial', [0.31, 0.27, 0.19], 'deposits', 1.1, 0.045),
  recipe('inland-water', 'inland-water', [0.028, 0.1, 0.115], 'water', 6, 0.01, 0.16),
  recipe('wetland-organic', 'wetland', [0.075, 0.085, 0.033], 'patches', 1.3, 0.018),
  recipe('coastal-sediment', 'sedimentary-coast', [0.52, 0.43, 0.28], 'ridges', 0.65, 0.018),
  recipe('coastal-rock', 'rocky-coast', [0.23, 0.25, 0.24], 'fractures', 2.6, 0.09),
  recipe('marine-water', 'marine', [0.018, 0.095, 0.125], 'water', 8, 0.025, 0.13),
  recipe('vegetation-litter', 'vegetation', [0.12, 0.17, 0.045], 'canopy', 0.8, 0.025),
  recipe('snow-ice', 'snow-ice', [0.82, 0.88, 0.91], 'patches', 1, 0.025, 0.65),
  recipe('compacted-road', 'mineral-plains', [0.23, 0.21, 0.17], 'ridges', 0.24, 0.004),
  recipe('cultivated-soil', 'mineral-plains', [0.19, 0.12, 0.065], 'ridges', 0.65, 0.065),
  recipe('built-foundation', 'mineral-plains', [0.3, 0.29, 0.27], 'fractures', 0.8, 0.006),
  recipe('forest-litter', 'vegetation', [0.105, 0.065, 0.026], 'patches', 0.45, 0.015),
  // Append-only support recipe. Humus is brown soil, not the green legacy wetland cover.
  recipe('organic-soil', 'mineral-plains', [0.12, 0.074, 0.037], 'patches', 0.6, 0.008, 0.94),
];

/** Authored continuous soil-appearance potential, not a diagnostic soil class.
 * Moisture/organic are fractions; slope is radians, never percent grade or degrees.
 * The C1 transition changes only derived ground recipes, never physical fields. */
export function organicSoilFraction(moisture: number, slopeRadians: number, organic: number): number {
  if (!Number.isFinite(moisture) || !Number.isFinite(slopeRadians) || !Number.isFinite(organic) || moisture < 0 || moisture > 1 || organic < 0 || organic > 1 || slopeRadians < 0 || slopeRadians > Math.PI / 2 + 1e-6)
    throw new Error('Soil appearance requires fractions and slope in radians');
  return soilSmooth(0.72, 0.88, moisture) * (1 - soilSmooth(0.08, 0.16, slopeRadians)) * soilSmooth(0.02, 0.16, organic);
}
function soilSmooth(a: number, b: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createMaterialIndex(materials: MaterialRecipe[]): Record<string, number> {
  if (!materials.length || materials.length > 65536) throw new Error('Material catalogue requires 1..65536 entries');
  const result: Record<string, number> = Object.create(null);
  materials.forEach((m, i) => {
    if (!m.id || !m.version || result[m.id] !== undefined) throw new Error('Material recipe ids must be unique and versioned');
    if (m.surfaceRole !== undefined && !['ground', 'low-cover', 'water', 'seasonal'].includes(m.surfaceRole)) throw new Error('Invalid authored material surface role');
    const expectedRole = ['forest-litter', 'vegetation-litter'].includes(m.id) ? 'low-cover' : ['inland-water', 'marine-water'].includes(m.id) ? 'water' : m.id === 'snow-ice' ? 'seasonal' : m.id === 'organic-soil' ? 'ground' : undefined;
    if (expectedRole && m.surfaceRole !== undefined && m.surfaceRole !== expectedRole) throw new Error('Material id has an incompatible vertical surface role');
    if (m.colorLinear.length !== 3 || m.colorLinear.some(v => !Number.isFinite(v) || v < 0 || v > 1) || !Number.isFinite(m.roughness) || m.roughness < 0 || m.roughness > 1) throw new Error('Invalid material color/roughness');
    result[m.id] = i;
  });
  return result;
}

export interface MaterialComposition {
  primary: number;
  secondary: number;
  blend: number;
}

/** Sparse reduction; no per-material world-sized weight maps. Ties have a deterministic id ordering. */
export function dominantMaterialPair(weights: Iterable<readonly [number, number]>): MaterialComposition {
  const combined = new Map<number, number>();
  for (const [id, weight] of weights) if (Number.isFinite(weight) && weight > 0) combined.set(id, (combined.get(id) ?? 0) + weight);
  const ranked = [...combined].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (!ranked.length) return { primary: 0, secondary: 0, blend: 0 };
  const [primary, a] = ranked[0],
    [secondary, b] = ranked[1] ?? [primary, 0];
  return { primary, secondary, blend: b / (a + b) };
}

export function materialColor(recipe: MaterialRecipe, source: RockUnit): [number, number, number] {
  return ['bedrock', 'gravity', 'karst', 'volcanic', 'rocky-coast'].includes(recipe.family) ? source.colorLinear : recipe.colorLinear;
}

export function packMaterialMean(color: readonly number[]): number {
  const encode = (v: number) => Math.round(Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)) * 255);
  return encode(color[0]) | (encode(color[1]) << 8) | (encode(color[2]) << 16);
}

// Exactly the previous scalar expression, evaluated once for every possible
// stored byte. Float64 storage preserves its result, without quantisation.
const MATERIAL_MEAN_LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
});

export function unpackMaterialMean(packed: number): [number, number, number] {
  return [MATERIAL_MEAN_LINEAR[packed & 255], MATERIAL_MEAN_LINEAR[(packed >>> 8) & 255], MATERIAL_MEAN_LINEAR[(packed >>> 16) & 255]];
}

/** Physical-coordinate CPU reference. Patterns organize material relief; they never change canonical DEM or hydrology. */
export function evaluateMaterialPattern(sample: SurfaceSample, x: number, z: number): { heightM: number; roughness: number; colorLinear: [number, number, number] } {
  const recipe = sample.material;
  const c = Math.cos(sample.orientation),
    s = Math.sin(sample.orientation);
  const u = (x * c + z * s) / recipe.physicalExtentMetres;
  const v = (-x * s + z * c) / recipe.physicalExtentMetres;
  const wave = 0.5 + 0.5 * Math.sin(u * 6.28318530718 + 0.24 * Math.sin(v * 1.7));
  const cellular = Math.sin(u * 2.31 + Math.sin(v * 3.73)) * Math.cos(v * 4.17 + Math.sin(u * 1.93));
  let pattern: number;
  switch (recipe.synthesisMode) {
    case 'ridges':
      pattern = Math.pow(wave, 2);
      break;
    case 'fractures':
      pattern = Math.min(1, Math.abs(Math.sin(u * 3.14159)) * 9) * Math.min(1, Math.abs(Math.sin(v * 2.43 + 0.4 * Math.sin(u))) * 8);
      break;
    case 'cracks':
      pattern = Math.min(1, Math.abs(cellular) * 12);
      break;
    case 'deposits':
      pattern = Math.pow(Math.max(0, cellular), 2);
      break;
    case 'canopy':
      pattern = 0.45 * wave + 0.55 * Math.max(0, cellular);
      break;
    case 'water':
      pattern = 0.5 + 0.25 * Math.sin(u * 6.28) + 0.25 * Math.sin(v * 4.8 + u);
      break;
    default:
      pattern = 0.5 + 0.5 * cellular;
  }
  const base = materialColor(recipe, sample.sourceRock);
  const shade = (0.86 + 0.22 * pattern) * (1 - sample.wetness * recipe.wetResponse);
  return { heightM: (pattern - 0.5) * recipe.heightAmplitudeMetres, roughness: recipe.roughness * (1 - 0.35 * sample.wetness), colorLinear: base.map(v => v * shade) as [number, number, number] };
}
