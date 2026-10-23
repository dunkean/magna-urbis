import { DepositOrigin, type MaterialRecipe, type RockUnit, type SurfaceFamily, type SurfaceSample } from './model';

export const DEFAULT_ROCK_UNITS: RockUnit[] = [
  { id: 1, name: 'Granitic basement', lithology: 'granite', sand: .67, silt: .23, clay: .10, hardness: .85, weatherability: .35, colorLinear: [.34, .31, .28], strikeRadians: .4 },
  { id: 2, name: 'Carbonate beds', lithology: 'limestone', sand: .22, silt: .43, clay: .35, hardness: .65, weatherability: .55, colorLinear: [.52, .49, .39], strikeRadians: 1.1 },
  { id: 3, name: 'Quartz sandstone', lithology: 'sandstone', sand: .82, silt: .13, clay: .05, hardness: .62, weatherability: .5, colorLinear: [.46, .31, .18], strikeRadians: .7 },
  { id: 4, name: 'Clay and marl beds', lithology: 'mudstone', sand: .12, silt: .43, clay: .45, hardness: .28, weatherability: .85, colorLinear: [.29, .24, .19], strikeRadians: .8 },
  { id: 5, name: 'Basaltic flows', lithology: 'basalt', sand: .31, silt: .29, clay: .40, hardness: .92, weatherability: .5, colorLinear: [.085, .075, .065], strikeRadians: 0 },
];

function recipe(id: string, family: SurfaceFamily, color: [number, number, number], mode: MaterialRecipe['synthesisMode'], extent: number, relief: number, roughness = .85): MaterialRecipe {
  const surfaceRole: MaterialRecipe['surfaceRole'] = ['forest-litter','vegetation-litter'].includes(id)?'low-cover':family==='inland-water'||family==='marine'?'water':family==='snow-ice'?'seasonal':'ground';
  return { id, version: '1', family, surfaceRole, colorLinear: color, synthesisMode: mode, physicalExtentMetres: extent,
    heightAmplitudeMetres: relief, roughness, normalConvention: 'opengl', compatibleSubstrates: [],
    compatibleProcesses: [DepositOrigin.Residual, DepositOrigin.Colluvial, DepositOrigin.Alluvial, DepositOrigin.Aeolian, DepositOrigin.Coastal],
    provenance: 'Authored analytic material; no photographic PBR asset claimed', wetResponse: .4, snowRetention: .7 };
}

/** All 15 landscape families have an executable contextual recipe; special processes require explicit inputs. */
export const SURFACE_MATERIALS: MaterialRecipe[] = [
  recipe('mineral-soil', 'mineral-plains', [.25, .17, .105], 'patches', .6, .008),
  recipe('fractured-bedrock', 'bedrock', [.40, .37, .32], 'fractures', 3, .04),
  recipe('wind-ripple-sand', 'aeolian', [.58, .43, .25], 'ridges', .45, .025),
  recipe('arid-reg', 'arid-erosion', [.28, .20, .13], 'cracks', 1.8, .016),
  recipe('angular-talus', 'gravity', [.28, .26, .23], 'deposits', 2.2, .22),
  recipe('carbonate-karst', 'karst', [.48, .47, .39], 'fractures', 1.6, .07),
  recipe('volcanic-crust', 'volcanic', [.075, .064, .054], 'fractures', 1.3, .065),
  recipe('alluvial-bars', 'alluvial', [.31, .27, .19], 'deposits', 1.1, .045),
  recipe('inland-water', 'inland-water', [.028, .10, .115], 'water', 6, .01, .16),
  recipe('wetland-organic', 'wetland', [.075, .085, .033], 'patches', 1.3, .018),
  recipe('coastal-sediment', 'sedimentary-coast', [.52, .43, .28], 'ridges', .65, .018),
  recipe('coastal-rock', 'rocky-coast', [.23, .25, .24], 'fractures', 2.6, .09),
  recipe('marine-water', 'marine', [.018, .095, .125], 'water', 8, .025, .13),
  recipe('vegetation-litter', 'vegetation', [.12, .17, .045], 'canopy', .8, .025),
  recipe('snow-ice', 'snow-ice', [.82, .88, .91], 'patches', 1, .025, .65),
  recipe('compacted-road', 'mineral-plains', [.23, .21, .17], 'ridges', .24, .004),
  recipe('cultivated-soil', 'mineral-plains', [.19, .12, .065], 'ridges', .65, .065),
  recipe('built-foundation', 'mineral-plains', [.30, .29, .27], 'fractures', .8, .006),
  recipe('forest-litter', 'vegetation', [.105, .065, .026], 'patches', .45, .015),
  // Append-only support recipe. Humus is brown soil, not the green legacy wetland cover.
  recipe('organic-soil', 'mineral-plains', [.12, .074, .037], 'patches', .6, .008, .94),
];

/** Authored continuous soil-appearance potential, not a diagnostic soil class.
 * Moisture/organic are fractions; slope is radians, never percent grade or degrees.
 * The C1 transition changes only derived ground recipes, never physical fields. */
export function organicSoilFraction(moisture:number,slopeRadians:number,organic:number):number {
  if(![moisture,slopeRadians,organic].every(Number.isFinite)||moisture<0||moisture>1||organic<0||organic>1||slopeRadians<0||slopeRadians>Math.PI/2+1e-6)throw new Error('Soil appearance requires fractions and slope in radians');
  const smooth=(a:number,b:number,value:number)=>{const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);};
  return smooth(.72,.88,moisture)*(1-smooth(.08,.16,slopeRadians))*smooth(.02,.16,organic);
}

export function createMaterialIndex(materials: MaterialRecipe[]): Record<string, number> {
  if (!materials.length || materials.length > 65536) throw new Error('Material catalogue requires 1..65536 entries');
  const result: Record<string, number> = Object.create(null);
  materials.forEach((m, i) => {
    if (!m.id || !m.version || result[m.id] !== undefined) throw new Error('Material recipe ids must be unique and versioned');
    if(m.surfaceRole!==undefined&&!['ground','low-cover','water','seasonal'].includes(m.surfaceRole))throw new Error('Invalid authored material surface role');
    const expectedRole=['forest-litter','vegetation-litter'].includes(m.id)?'low-cover':['inland-water','marine-water'].includes(m.id)?'water':m.id==='snow-ice'?'seasonal':m.id==='organic-soil'?'ground':undefined;
    if(expectedRole&&m.surfaceRole!==undefined&&m.surfaceRole!==expectedRole)throw new Error('Material id has an incompatible vertical surface role');
    if (m.colorLinear.length !== 3 || m.colorLinear.some(v => !Number.isFinite(v) || v < 0 || v > 1) || !Number.isFinite(m.roughness) || m.roughness < 0 || m.roughness > 1) throw new Error('Invalid material color/roughness');
    result[m.id] = i;
  });
  return result;
}

export interface MaterialComposition { primary: number; secondary: number; blend: number }

/** Sparse reduction; no per-material world-sized weight maps. Ties have a deterministic id ordering. */
export function dominantMaterialPair(weights: Iterable<readonly [number, number]>): MaterialComposition {
  const combined = new Map<number, number>();
  for (const [id, weight] of weights) if (Number.isFinite(weight) && weight > 0) combined.set(id, (combined.get(id) ?? 0) + weight);
  const ranked = [...combined].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (!ranked.length) return { primary: 0, secondary: 0, blend: 0 };
  const [primary, a] = ranked[0], [secondary, b] = ranked[1] ?? [primary, 0];
  return { primary, secondary, blend: b / (a + b) };
}

export function materialColor(recipe: MaterialRecipe, source: RockUnit): [number, number, number] {
  return ['bedrock', 'gravity', 'karst', 'volcanic', 'rocky-coast'].includes(recipe.family) ? source.colorLinear : recipe.colorLinear;
}

export function packMaterialMean(color: readonly number[]): number {
  const encode = (v: number) => Math.round(Math.max(0, Math.min(1, v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - .055)) * 255);
  return encode(color[0]) | encode(color[1]) << 8 | encode(color[2]) << 16;
}

export function unpackMaterialMean(packed: number): [number, number, number] {
  const decode = (v: number) => { const s = v / 255; return s <= .04045 ? s / 12.92 : Math.pow((s + .055) / 1.055, 2.4); };
  return [decode(packed & 255), decode(packed >>> 8 & 255), decode(packed >>> 16 & 255)];
}

/** Physical-coordinate CPU reference. Patterns organize material relief; they never change canonical DEM or hydrology. */
export function evaluateMaterialPattern(sample: SurfaceSample, x: number, z: number): { heightM: number; roughness: number; colorLinear: [number, number, number] } {
  const recipe = sample.material;
  const c = Math.cos(sample.orientation), s = Math.sin(sample.orientation);
  const u = (x * c + z * s) / recipe.physicalExtentMetres;
  const v = (-x * s + z * c) / recipe.physicalExtentMetres;
  const wave = .5 + .5 * Math.sin(u * 6.28318530718 + .24 * Math.sin(v * 1.7));
  const cellular = Math.sin(u * 2.31 + Math.sin(v * 3.73)) * Math.cos(v * 4.17 + Math.sin(u * 1.93));
  let pattern: number;
  switch (recipe.synthesisMode) {
    case 'ridges': pattern = Math.pow(wave, 2); break;
    case 'fractures': pattern = Math.min(1, Math.abs(Math.sin(u * 3.14159)) * 9) * Math.min(1, Math.abs(Math.sin(v * 2.43 + .4 * Math.sin(u))) * 8); break;
    case 'cracks': pattern = Math.min(1, Math.abs(cellular) * 12); break;
    case 'deposits': pattern = Math.pow(Math.max(0, cellular), 2); break;
    case 'canopy': pattern = .45 * wave + .55 * Math.max(0, cellular); break;
    case 'water': pattern = .5 + .25 * Math.sin(u * 6.28) + .25 * Math.sin(v * 4.8 + u); break;
    default: pattern = .5 + .5 * cellular;
  }
  const base = materialColor(recipe, sample.sourceRock);
  const shade = (.86 + .22 * pattern) * (1 - sample.wetness * recipe.wetResponse);
  return { heightM: (pattern - .5) * recipe.heightAmplitudeMetres, roughness: recipe.roughness * (1 - .35 * sample.wetness), colorLinear: base.map(v => v * shade) as [number, number, number] };
}
