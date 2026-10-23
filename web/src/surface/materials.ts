import { DepositOrigin, type MaterialRecipe, type RockUnit, type SurfaceFamily, type SurfaceSample } from './model';

export const DEFAULT_ROCK_UNITS: RockUnit[] = [
  { id: 1, name: 'Granitic basement', lithology: 'granite', sand: .67, silt: .23, clay: .10, hardness: .85, weatherability: .35, colorLinear: [.34, .31, .28], strikeRadians: .4 },
  { id: 2, name: 'Carbonate beds', lithology: 'limestone', sand: .22, silt: .43, clay: .35, hardness: .65, weatherability: .55, colorLinear: [.52, .49, .39], strikeRadians: 1.1 },
  { id: 3, name: 'Quartz sandstone', lithology: 'sandstone', sand: .82, silt: .13, clay: .05, hardness: .62, weatherability: .5, colorLinear: [.46, .31, .18], strikeRadians: .7 },
  { id: 4, name: 'Clay and marl beds', lithology: 'mudstone', sand: .12, silt: .43, clay: .45, hardness: .28, weatherability: .85, colorLinear: [.29, .24, .19], strikeRadians: .8 },
  { id: 5, name: 'Basaltic flows', lithology: 'basalt', sand: .31, silt: .29, clay: .40, hardness: .92, weatherability: .5, colorLinear: [.085, .075, .065], strikeRadians: 0 },
];

function recipe(id: string, family: SurfaceFamily, color: [number, number, number], mode: MaterialRecipe['synthesisMode'], extent: number, relief: number, roughness = .85): MaterialRecipe {
  return { id, version: '1', family, colorLinear: color, synthesisMode: mode, physicalExtentMetres: extent,
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
];

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
  const rock = ['bedrock', 'gravity', 'karst', 'volcanic', 'rocky-coast'].includes(recipe.family);
  const base = rock ? sample.sourceRock.colorLinear : recipe.colorLinear;
  const shade = (.86 + .22 * pattern) * (1 - sample.wetness * recipe.wetResponse);
  return { heightM: (pattern - .5) * recipe.heightAmplitudeMetres, roughness: recipe.roughness * (1 - .35 * sample.wetness), colorLinear: base.map(v => v * shade) as [number, number, number] };
}
