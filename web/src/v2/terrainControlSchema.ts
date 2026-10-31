import type { ParameterField, ParameterChoice } from './parameterForm';
import neuralModels from '../../../rust/models/neural-earth/catalog.json';

/** Rust Terrainbench's public controls. Values retain the core's names and units. */
export const terrainControlMessages: Record<string, { en: string; fr: string }> = {};
export function terrainCopy(en: string, fr: string): string { terrainControlMessages[en] = { en, fr }; return en; }
const copy = terrainCopy;
const number = (path: string, en: string, fr: string, min: number, max: number, step: number, help?: [string, string], optional = false): ParameterField => ({
  path: `terrain.${path}`, type: 'number', label: copy(en, fr), min, max, step, optional,
  ...(help ? { help: copy(...help) } : {}), ...(optional ? { placeholder: copy('Relief default', 'Valeur du relief') } : {}),
});
const bool = (path: string, en: string, fr: string, help?: [string, string]): ParameterField => ({ path: `terrain.${path}`, type: 'boolean', label: copy(en, fr), ...(help ? { help: copy(...help) } : {}) });
const choice = (value: string, en: string, fr: string): ParameterChoice => ({ value, label: copy(en, fr) });
const select = (path: string, en: string, fr: string, options: ParameterChoice[], help?: [string, string]): ParameterField => ({ path: `terrain.${path}`, type: 'select', label: copy(en, fr), options, ...(help ? { help: copy(...help) } : {}) });
const simple = (entries: [string, string, string][]) => entries.map(([value, en, fr]) => choice(value, en, fr));
export const coastDirections = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function toggleCoastDirection(mask: number, direction: typeof coastDirections[number]): number { return (mask ^ 1 << coastDirections.indexOf(direction)) & 255; }

export const terrainSourceFields: ParameterField[] = [
  { path: 'runtime.backend', id: 'terrain-backend', type: 'select', label: copy('Terrain backend', 'Backend du relief'), options: simple([
    ['rust', 'Rust · browser WASM / WebGPU', 'Rust · WASM / WebGPU du navigateur'], ['native', 'Rust · installed local service', 'Rust · service local installé'], ['typescript', 'Classic TypeScript · CPU', 'TypeScript classique · CPU'],
  ]) },
  { path: 'runtime.source', id: 'terrain-source', type: 'select', label: copy('Generation engine', 'Moteur de génération'), options: simple([
    ['procedural', 'Procedural', 'Procédural'], ['neural-wasm', 'Neural · browser', 'Neuronal · navigateur'],
    ['neural-python', 'Neural · Python / PyTorch', 'Neuronal · Python / PyTorch'], ['neural', 'Neural · Rust service', 'Neuronal · service Rust'],
  ]), help: copy('Choose the generation method. Imported heightmaps and painted zones are available below.', 'Choisissez la méthode de génération. Les heightmaps importées et les zones peintes sont accessibles ci-dessous.') },
  { path: 'runtime.compute', id: 'terrain-compute', type: 'select', label: copy('Compute preference', 'Préférence de calcul'), options: simple([
    ['auto', 'Automatic · best available', 'Automatique · meilleur disponible'], ['cpu', 'CPU', 'CPU'], ['gpu', 'GPU', 'GPU'],
  ]) },
];
export const reliefChoices = simple([
  ['flat', 'Plain', 'Plaine'], ['hills', 'Hills', 'Collines'], ['valley', 'Valley', 'Vallée'], ['canyon', 'Canyon', 'Canyon'],
  ['mountains', 'Mountains', 'Montagnes'], ['mixed', 'Hills and mountains', 'Collines et montagnes'], ['plateau', 'Plateau', 'Plateau'],
  ['high-mountains', 'High mountains', 'Hautes montagnes'], ['volcano', 'Volcano', 'Volcan'], ['caldera', 'Caldera', 'Caldeira'], ['cavern', 'Cavern', 'Caverne'],
]);
/** One-line landscape help per climate zone, shown as the climate strip tooltip. */
export const climateZoneHelp: Record<string, string> = {
  temperate: copy('France, England — broadleaf woods, bocage, fields', 'France, Angleterre — bois feuillus, bocage, champs'),
  mediterranean: copy('Provence, Italy, Greece — olive groves, vines, garrigue', 'Provence, Italie, Grèce — oliveraies, vignes, garrigue'),
  continental: copy('Central Europe, Bohemia — mixed forests, snowy winters', 'Europe centrale, Bohême — forêts mixtes, hivers enneigés'),
  nordic: copy('Scandinavia — conifers, lakes', 'Scandinavie — conifères, lacs'),
  alpine: copy('Alps, Pyrenees — alpine pastures, scree', 'Alpes, Pyrénées — alpages, éboulis'),
  arctic: copy('Iceland, Greenland — tundra, almost treeless', 'Islande, Groenland — toundra, presque sans arbres'),
  steppe: copy('Hungary, Central Asia — short grass, rare groves', 'Hongrie, Asie centrale — herbe rase, rares bosquets'),
  desert: copy('Maghreb, Middle East — sand and rock, palm groves by water', 'Maghreb, Moyen-Orient — sable et roche, palmeraies près de l’eau'),
  savanna: copy('Sahel — acacias, tall grass', 'Sahel — acacias, hautes herbes'),
  tropical: copy('Southeast Asia — jungle, rice terraces', 'Asie du Sud-Est — jungle, rizières en terrasses'),
  wetland: copy('Venice, Netherlands, Fens — reeds, canals, peat bogs', 'Venise, Pays-Bas, Fens — roseaux, canaux, tourbières'),
};
/** Classic biome that goes with each climate zone (underdark biomes are never replaced). */
export const climateZoneBiome: Record<string, string> = {
  temperate: 'temperate', mediterranean: 'temperate', continental: 'forest', nordic: 'forest', alpine: 'forest', arctic: 'tundra',
  steppe: 'steppe', desert: 'desert', savanna: 'steppe', tropical: 'tropical', wetland: 'temperate',
};
export const terrainBasicFields: ParameterField[] = [
  { ...select('relief', 'Relief type', 'Type de relief', reliefChoices), id: 'terrain-relief' },
  select('climate', 'Climate zone', 'Zone climatique', simple([
    ['temperate', 'Temperate', 'Tempéré'], ['mediterranean', 'Mediterranean', 'Méditerranéen'], ['continental', 'Continental', 'Continental'],
    ['nordic', 'Nordic', 'Nordique'], ['alpine', 'Alpine', 'Alpin'], ['arctic', 'Arctic', 'Arctique'], ['steppe', 'Steppe', 'Steppe'],
    ['desert', 'Desert', 'Désert'], ['savanna', 'Savanna', 'Savane'], ['tropical', 'Humid tropical', 'Tropical humide'], ['wetland', 'Wetlands', 'Zones humides'],
    ['custom', 'Custom climate', 'Climat personnalisé'],
  ])),
  { path: 'options.biome', id: 'terrain-biome', type: 'select', label: copy('Region biome', 'Biome de la région'), options: simple([
    ['temperate', 'Temperate countryside', 'Campagne tempérée'], ['forest', 'Woodland', 'Forêt'], ['desert', 'Desert and oases', 'Désert et oasis'], ['steppe', 'Steppe', 'Steppe'], ['tropical', 'Tropical forest', 'Forêt tropicale'], ['tundra', 'Tundra', 'Toundra'], ['underdark', 'Underdark', 'Outreterre'], ['underdark-caverns', 'Underdark with caverns', 'Outreterre avec cavernes'],
  ]) },
  select('islandMode', 'Island layout', 'Organisation des îles', simple([
    ['island', 'Single island', 'Île unique'], ['archipelago', 'Archipelago', 'Archipel'], ['peninsula', 'Peninsula', 'Presqu’île'],
  ]), ['Used when all eight sea directions are selected.', 'Utilisé lorsque les huit directions maritimes sont sélectionnées.']),
];
export const terrainProceduralFields: ParameterField[] = [
  select('procedural.preset', 'Procedural preset', 'Préréglage procédural', simple([['classic','Classic','Classique'],['compact','Compact · fast','Compact · rapide']])),
  bool('procedural.enabled.phasor', 'Phasor detail', 'Détail Phasor'),
  bool('procedural.biome', 'Biome-driven erosion', 'Érosion selon le biome'),
  select('phasor.quality', 'Compact grid quality', 'Qualité de grille compacte', simple([['fast', 'Fast', 'Rapide'], ['balanced', 'Balanced', 'Équilibrée'], ['detailed', 'Detailed', 'Détaillée']]), ['Controls the compact preset grid and cycle budget. Phasor can be enabled independently.', 'Pilote la grille et le budget de cycles du préréglage compact. Phasor peut être activé indépendamment.']),
  number('phasor.intensity', 'Phasor intensity', 'Intensité Phasor', 0, 2, .05),
  { ...number('motifSize', 'Landform scale (km)', 'Échelle du relief (km)', .25, 50, .25, ['Physical size of landforms, independent of map width.', 'Taille physique des formes, indépendante de la largeur de carte.']), id: 'terrain-scale', toInput: value => Number(value) / 1000, fromInput: value => Number(value) * 1000 },
  select('environment', 'Surrounding terrain', 'Relief environnant', reliefChoices.filter(option => ['flat', 'hills', 'mixed', 'mountains', 'high-mountains'].includes(option.value))),
  number('mountainMix', 'Mountain proportion', 'Proportion de montagnes', 0, 1, .01),
  number('erosion', 'Overall erosion', 'Érosion globale', 0, 2, .01),
  number('resolution', 'Terrain grid resolution', 'Résolution de grille du relief', 64, 2048, 1),
  { ...select('compute', 'Terrain sampling', 'Échantillonnage du relief', simple([['wasm', 'CPU · Rust reference', 'CPU · référence Rust'], ['gpu-f32', 'GPU · FP32', 'GPU · FP32']])), optional: true },
  { ...select('generationCompute', 'Procedural generation compute', 'Calcul de génération procédurale', simple([
    ['cpu', 'CPU · reference', 'CPU · référence'], ['gpu', 'GPU · fine noise FP32', 'GPU · bruit fin FP32'], ['gpu-all', 'GPU · all noise FP32', 'GPU · tous les bruits FP32'], ['gpu-erosion', 'GPU · erosion FP32', 'GPU · érosion FP32'],
  ])), optional: true },
];
export const terrainClassicFields: ParameterField[] = [
  { path: 'options.relief', type: 'select', label: copy('Classic relief', 'Relief classique'), options: reliefChoices.filter(option => ['flat', 'hills', 'valley', 'mountains'].includes(option.value)) },
  { path: 'options.coast', type: 'select', label: copy('Classic coastline', 'Côte classique'), options: simple([['none', 'No coast', 'Aucune côte'], ['N', 'North', 'Nord'], ['E', 'East', 'Est'], ['S', 'South', 'Sud'], ['W', 'West', 'Ouest'], ['random', 'Random coast', 'Côte aléatoire']]) },
  { path: 'options.river', type: 'select', label: copy('Classic river', 'Rivière classique'), options: simple([['none', 'No river', 'Aucune rivière'], ['stream', 'Stream', 'Ruisseau'], ['river', 'River', 'Rivière'], ['major', 'Major river', 'Fleuve']]) },
  { path: 'options.seaLevel', type: 'number', optional: true, min: -1, max: 1, step: .05, label: copy('Classic sea-level offset', 'Décalage marin classique') },
  { path: 'options.heightScale', type: 'number', min: 1, max: 9000, step: 1, optional: true, label: copy('Imported grayscale height scale (m)', 'Échelle de hauteur des niveaux de gris importés (m)') },
  { path: 'options.importSea', type: 'number', min: -1000, max: 9000, step: 1, optional: true, label: copy('Imported heightmap sea level (m)', 'Niveau marin de la heightmap importée (m)') },
];
export const terrainClimateFields: ParameterField[] = [
  number('climateValues.temperature', 'Mean temperature (°C)', 'Température moyenne (°C)', -30, 40, .5, ['Mean annual temperature at sea level; lapse rate −6 °C/km.', 'Température annuelle moyenne au niveau marin ; gradient de −6 °C/km.']),
  number('climateValues.temperatureStd', 'Temperature seasonality (°C × 100)', 'Saisonnalité thermique (°C × 100)', 0, 3000, 25),
  number('climateValues.precipitation', 'Annual precipitation (mm)', 'Précipitations annuelles (mm)', 0, 6000, 50),
  number('climateValues.precipitationCv', 'Precipitation variation (%)', 'Variation des précipitations (%)', 0, 200, 1),
];
export const terrainNeuralFields: ParameterField[] = [
  select('neuralFit', 'Neural extent fitting', 'Adaptation de l’étendue neuronale', simple([['crop', 'Crop a 40 km source', 'Recadrer la source de 40 km'], ['scale', 'Scale the complete source', 'Redimensionner la source entière']]), ['The model generates 40 × 40 km. Crop retains physical scale; scale fits the complete result to this map.', 'Le modèle génère 40 × 40 km. Recadrer conserve l’échelle physique ; redimensionner adapte le résultat complet à cette carte.']),
  bool('neuralSlopes', 'Preserve slopes when scaling', 'Préserver les pentes au redimensionnement'),
  number('fidelity', 'Sketch noise / signal', 'Bruit / signal de l’esquisse', .001, 2, .01, ['Lower values follow the sketch more closely: 0.02 close, 0.05 normal, 0.15 loose.', 'Les petites valeurs suivent davantage l’esquisse : 0,02 fidèle, 0,05 normal, 0,15 libre.']),
  number('neuralTuning.landScale', 'Sketch land elevation multiplier', 'Multiplicateur d’altitude de l’esquisse', 0, 5, .05),
  number('neuralTuning.steps', 'Coarse solver steps', 'Étapes du solveur coarse', 1, 32, 1),
  number('neuralTuning.noiseTemperature', 'Temperature noise / signal', 'Bruit / signal de température', .001, 10, .05),
  number('neuralTuning.noiseTemperatureStd', 'Seasonality noise / signal', 'Bruit / signal de saisonnalité', .001, 10, .05),
  number('neuralTuning.noisePrecipitation', 'Precipitation noise / signal', 'Bruit / signal de précipitations', .001, 10, .05),
  number('neuralTuning.noisePrecipitationCv', 'Rain variation noise / signal', 'Bruit / signal de variation des pluies', .001, 10, .05),
  select('neuralTuning.reliefMode', 'Local relief conditioning', 'Conditionnement du relief local', simple([['auto', 'Automatic by relief family', 'Automatique par famille de relief'], ['scale', 'Multiply network output', 'Multiplier la sortie du réseau'], ['fixed', 'Fixed local relief', 'Relief local fixe']])),
  number('neuralTuning.reliefScale', 'Local relief multiplier', 'Multiplicateur de relief local', 0, 5, .05),
  number('neuralTuning.reliefFixed', 'Fixed local relief (m)', 'Relief local fixe (m)', 0, 5000, 10),
  ...Array.from({ length: 5 }, (_, i) => ({ path: `terrain.neuralTuning.histogram.${i}`, type: 'number' as const, label: copy(`Conditioning histogram · class ${i + 1}`, `Histogramme de conditionnement · classe ${i + 1}`), step: .25 })),
  number('neuralTuning.detail', 'Decoder detail multiplier', 'Multiplicateur des détails du décodeur', 0, 5, .05),
];
export const terrainModelFields: ParameterField[] = [
  ...(['coarse', 'base', 'decoder'] as const).map(kind => ({ path: `terrain.${kind}Model`, type: 'select' as const,
    label: copy(`${kind === 'decoder' ? 'Decoder' : kind === 'coarse' ? 'Coarse' : 'Base'} model`, `Modèle ${kind === 'decoder' ? 'décodeur' : kind}`),
    options: neuralModels[kind].map(model => ({ value: model.id, label: copy(`${model.id} · ${(model.bytes / 1e6).toFixed(2)} MB`, `${model.id} · ${(model.bytes / 1e6).toFixed(2)} Mo`) })),
    optional: true,
  })),
  { path: 'runtime.neuralAssets', type: 'text', optional: true, label: copy('Browser model assets URL', 'URL des modèles du navigateur') },
  { path: 'runtime.localServer', type: 'text', optional: true, label: copy('Native Rust server URL', 'URL du serveur Rust natif'), placeholder: 'http://127.0.0.1:8791' },
  { path: 'runtime.neuralServer', type: 'text', optional: true, label: copy('Neural Rust server URL', 'URL du serveur Rust neuronal'), placeholder: 'http://127.0.0.1:8792' },
  { path: 'runtime.pythonServer', type: 'text', optional: true, label: copy('Python / PyTorch server URL', 'URL du serveur Python / PyTorch'), placeholder: 'http://127.0.0.1:8793' },
];
const erosion = (key: string, en: string, fr: string, min: number, max: number, step: number, help?: [string, string]) => number(`erosionTuning.${key}`, en, fr, min, max, step, help, true);
export const terrainErosionFields: ParameterField[] = [
  erosion('iterations', 'Evolution steps', 'Étapes d’évolution', 1, 200, 1, ['Uplift and erosion steps on the coarse landscape.', 'Étapes de soulèvement et d’érosion du paysage grossier.']),
  erosion('incision', 'Stream-power incision multiplier', 'Multiplicateur d’incision fluviale', 0, 10, .05),
  erosion('incisionSlope', 'Incision onset slope (m/m)', 'Pente de déclenchement de l’incision (m/m)', .01, 2, .01),
  erosion('fill', 'Depression sediment fill multiplier', 'Multiplicateur de dépôt dans les dépressions', 0, 10, .05),
  erosion('carve', 'Sill carving fraction', 'Fraction d’entaille des seuils', 0, 1, .05),
  erosion('finalCarve', 'Final sill carving fraction', 'Fraction finale d’entaille des seuils', 0, 1, .05),
  erosion('talus', 'Talus critical slope (m/m)', 'Pente critique des éboulis (m/m)', .01, 3, .01),
  erosion('thermal', 'Thermal relaxation multiplier', 'Multiplicateur de relaxation thermique', 0, 10, .05),
  erosion('diffusion', 'Hillslope diffusion', 'Diffusion des versants', 0, 3, .01),
  erosion('detail', 'Ridge detail fraction', 'Fraction de détails des crêtes', 0, .5, .005),
  erosion('warp', 'Domain warp multiplier', 'Multiplicateur de déformation du domaine', 0, 4, .05),
  erosion('surfaceIterations', 'Surface erosion steps', 'Étapes d’érosion de surface', 0, 100, 1),
  erosion('surfaceIncision', 'Surface incision multiplier', 'Multiplicateur d’incision de surface', 0, 10, .05),
  erosion('surfaceCarve', 'Surface sill carving fraction', 'Fraction d’entaille des seuils de surface', 0, 1, .05),
  erosion('surfaceRouted', 'Route surface over depressions (0 / 1)', 'Router la surface sur les dépressions (0 / 1)', 0, 1, 1),
  erosion('surfaceThermal', 'Surface thermal multiplier', 'Multiplicateur thermique de surface', 0, 10, .05),
  erosion('surfaceDiffusion', 'Surface diffusion multiplier', 'Multiplicateur de diffusion de surface', 0, 10, .05),
];
export const terrainRefinementFields: ParameterField[] = [
  bool('refine', 'Fractal refinement', 'Raffinement fractal', ['Adds slope-dependent detail below the source cell size.', 'Ajoute des détails dépendant de la pente sous la taille des cellules sources.']),
  number('detailNoise.amplitude', 'Detail amplitude (source cells)', 'Amplitude des détails (cellules sources)', 0, 2, .001),
  number('detailNoise.hurst', 'Hurst exponent', 'Exposant de Hurst', 0, 1.5, .05),
  number('detailNoise.lacunarity', 'Lacunarity', 'Lacunarité', 1.2, 4, .1),
  number('detailNoise.octaves', 'Maximum detail octaves', 'Octaves maximales de détails', 1, 12, 1),
  number('detailNoise.start', 'First wavelength (source cells)', 'Première longueur d’onde (cellules sources)', .25, 8, .25),
  number('detailNoise.slope', 'Detail slope exponent', 'Exposant de pente des détails', 0, 2, .05),
  number('detailNoise.flat', 'Detail floor on flat terrain', 'Plancher de détails en terrain plat', 0, .5, .002),
  number('detailNoise.shore', 'Coastal detail fade (m)', 'Atténuation côtière des détails (m)', 0, 50, .5),
];
const hydroNumber = (key: string, en: string, fr: string, min: number, max: number, step: number, help?: [string, string]) => number(`hydrology.${key}`, en, fr, min, max, step, help);
const hydroBool = (key: string, en: string, fr: string) => bool(`hydrology.${key}`, en, fr);
const hydroSelect = (key: string, en: string, fr: string, options: [string, string, string][]) => select(`hydrology.${key}`, en, fr, simple(options));
export const terrainHydrologyFields: ParameterField[] = [
  hydroBool('enabled', 'Generate hydrology', 'Générer l’hydrologie'),
  hydroSelect('engine', 'Hydrology engine', 'Moteur hydrologique', [['rust', 'Rust', 'Rust'], ['vector', 'Vector', 'Vectoriel']]),
  hydroBool('erosionEnabled', 'Erode terrain for drainage', 'Éroder le terrain pour le drainage'),
  hydroBool('showErosion', 'Show eroded terrain', 'Afficher le terrain érodé'),
  hydroSelect('condMode', 'Pre-hydrology conditioning', 'Conditionnement avant hydrologie', [['none', 'None', 'Aucun'], ['erosion', 'Fluvial erosion', 'Érosion fluviale'], ['breach', 'Sill breaching', 'Brèche des seuils'], ['both', 'Erosion and breaching', 'Érosion et brèches']]),
  hydroNumber('condStrength', 'Conditioning strength', 'Intensité du conditionnement', 0, 3, .05),
  hydroNumber('condDepth', 'Conditioning maximum breach depth (m)', 'Profondeur maximale des brèches de conditionnement (m)', 0, 500, 1),
  hydroNumber('condLength', 'Conditioning maximum breach length (m)', 'Longueur maximale des brèches de conditionnement (m)', 0, 100000, 100),
];
export const terrainRustHydrologyFields: ParameterField[] = [
  hydroSelect('main', 'Main channel', 'Cours d’eau principal', [['auto', 'Automatic', 'Automatique'], ['none', 'No main channel', 'Aucun cours principal'], ['stream', 'Stream', 'Ruisseau'], ['river', 'River', 'Rivière'], ['major', 'Major river', 'Fleuve']]),
  hydroNumber('density', 'Tributary density', 'Densité des affluents', 0, 2, .05),
  hydroNumber('coastalStreams', 'Coastal stream density', 'Densité des cours côtiers', 0, 2, .05),
  hydroNumber('wetness', 'Water supply multiplier', 'Multiplicateur d’apport en eau', .1, 2, .1),
  hydroSelect('lakes', 'Lake policy', 'Gestion des lacs', [['auto', 'Climate water budget', 'Bilan hydrique du climat'], ['none', 'No lakes', 'Aucun lac'], ['some', 'Carved lakes', 'Lacs creusés']]),
  hydroNumber('lakeAbundance', 'Carved lake abundance', 'Abondance des lacs creusés', 0, 2, .05),
  { ...hydroNumber('lakeCoverage', 'Maximum total lake coverage (%)', 'Couverture totale maximale des lacs (%)', 0, 100, .5), toInput: value => Number(value) * 100, fromInput: value => Number(value) / 100 },
  { ...hydroNumber('maxLakeArea', 'Maximum individual lake area (%)', 'Surface maximale d’un lac (%)', 0, 100, .5), toInput: value => Number(value) * 100, fromInput: value => Number(value) / 100 },
  hydroNumber('minLakeArea', 'Minimum budget-lake area (m²)', 'Surface minimale des lacs à bilan (m²)', 0, 100000000, 100),
  hydroNumber('minLakeDepth', 'Minimum budget-lake depth (m)', 'Profondeur minimale des lacs à bilan (m)', 0, 100, .5),
  hydroSelect('meanders', 'Meander policy', 'Gestion des méandres', [['natural', 'Natural meanders', 'Méandres naturels'], ['reduced', 'Reduced meanders', 'Méandres réduits'], ['none', 'No added meanders', 'Aucun méandre ajouté']]),
  hydroNumber('meanderIntensity', 'Meander intensity', 'Intensité des méandres', 0, 2, .1),
  hydroSelect('estuary', 'River mouth', 'Embouchure', [['auto', 'Automatic', 'Automatique'], ['simple', 'Simple', 'Simple'], ['widening', 'Widening', 'Élargie'], ['funnel', 'Funnel', 'En entonnoir'], ['tidal', 'Tidal', 'À marée']]),
  hydroNumber('widthScale', 'Rust channel width multiplier', 'Multiplicateur de largeur des cours Rust', .5, 2, .05),
  hydroNumber('incision', 'Hydrological incision', 'Incision hydrologique', 0, 2, .1),
  hydroSelect('depressionPolicy', 'Depressions without lakes', 'Dépressions sans lacs', [['auto', 'Bounded breach or fill', 'Brèche limitée ou comblement'], ['fill', 'Fill only', 'Comblement seul']]),
  hydroNumber('maxBreachDepth', 'Drainage maximum breach depth (m)', 'Profondeur maximale des brèches de drainage (m)', 0, 200, 1),
  hydroNumber('maxBreachLength', 'Drainage maximum breach length (m)', 'Longueur maximale des brèches de drainage (m)', 0, 100000, 50),
  { ...hydroSelect('resolution', 'Hydrology grid', 'Grille hydrologique', [['256', '256 × 256', '256 × 256'], ['512', '512 × 512', '512 × 512'], ['1024', '1024 × 1024', '1024 × 1024']]), fromInput: value => Number(value) },
  hydroSelect('compute', 'Hydrology compute', 'Calcul hydrologique', [['auto', 'Automatic', 'Automatique'], ['cpu', 'Rust CPU', 'Rust CPU'], ['gpu', 'GPU FP32', 'GPU FP32']]),
];
export const terrainVectorHydrologyFields: ParameterField[] = [
  hydroNumber('riverArea', 'River catchment threshold (km²)', 'Seuil de bassin pour une rivière (km²)', 0, 5000, .05, ['Zero chooses a threshold adapted to map size.', 'Zéro choisit un seuil adapté à la taille de carte.']),
  hydroBool('balance', 'Lake water balance', 'Bilan hydrique des lacs'),
  hydroSelect('riverMode', 'River tracing', 'Tracé des cours d’eau', [['vector', 'Vector curves', 'Courbes vectorielles'], ['grid', 'D8 grid', 'Grille D8']]),
  { ...hydroSelect('braiding', 'Braiding', 'Tressage', [['0', 'No braids', 'Aucun tressage'], ['1', 'Natural braids', 'Tressage naturel'], ['2', 'Frequent braids', 'Tressage fréquent']]), fromInput: value => Number(value) },
  hydroBool('anabranching', 'Anabranches', 'Anabranches'),
  hydroBool('terrainInfluence', 'Terrain-guided meanders', 'Méandres guidés par le relief'),
  hydroBool('avulsions', 'Avulsions', 'Avulsions'),
  hydroSelect('confluence', 'Confluence angles', 'Angles des confluences', [['climate', 'From climate', 'Selon le climat'], ['drainage', 'From drainage', 'Selon le drainage']]),
  hydroBool('deltas', 'River deltas', 'Deltas fluviaux'),
  hydroNumber('lakeDepth', 'Minimum vector-lake depth (m)', 'Profondeur minimale des lacs vectoriels (m)', 0, 500, .5),
  hydroNumber('lakeArea', 'Minimum vector-lake area (ha)', 'Surface minimale des lacs vectoriels (ha)', 0, 100000, 5),
  hydroNumber('flatSlope', 'Meander slope threshold (m/km)', 'Seuil de pente des méandres (m/km)', 0, 50, .1),
  hydroNumber('sinuosity', 'Target sinuosity', 'Sinuosité cible', 1, 3.5, .05),
  hydroNumber('vectorWidth', 'Vector channel width multiplier', 'Multiplicateur de largeur des cours vectoriels', .1, 10, .1),
  { ...hydroSelect('vectorResolution', 'Vector hydrology grid', 'Grille hydrologique vectorielle', [['512', '512 × 512', '512 × 512'], ['1024', '1024 × 1024', '1024 × 1024']]), fromInput: value => Number(value) },
];
export const terrainForestFields: ParameterField[] = [
  bool('forest.enabled', 'Detailed forest canopy', 'Canopée forestière détaillée'),
  { ...number('forest.density', 'Forest density (%)', 'Densité forestière (%)', 0, 200, 5), toInput: value => Number(value) * 100, fromInput: value => Number(value) / 100 },
  { ...number('forest.clearings', 'Natural clearings (%)', 'Clairières naturelles (%)', 0, 100, 5), toInput: value => Number(value) * 100, fromInput: value => Number(value) / 100 },
];
/** Decomposed procedural recipe (`terrain.procedural`, rust/bridge/terrainGenerationRecipe.ts): the
 * stage controls of the Rustbench procedural inspector. Empty values keep the engine / biome default. */
const recipeNumber = (path: string, en: string, fr: string, min: number, max: number, step: number): ParameterField => ({ ...number(`procedural.${path}`, en, fr, min, max, step, undefined, true), placeholder: copy('Engine default', 'Défaut du moteur') });
export const terrainProceduralStageFields: ParameterField[] = [
  { ...select('procedural.coastAfter', 'Coast formation after', 'Former les côtes après', simple([
    ['initialize', 'Initial noise', 'Bruit initial'], ['regionalFinish', 'Regional erosion', 'Érosion régionale'],
    ['amplitude', 'Amplitude calibration', 'Calibration de l’amplitude'], ['ridged', 'Ridged detail', 'Détail ridgé'],
    ['surface', 'Surface erosion', 'Érosion de surface'], ['normalize', 'Datum normalisation', 'Normalisation du datum'],
  ])), optional: true },
  recipeNumber('regionalN', 'Regional grid (side)', 'Grille régionale (côté)', 64, 640, 1),
  recipeNumber('surfaceN', 'Surface grid (without margin)', 'Grille de surface (hors marge)', 64, 1024, 1),
  recipeNumber('noiseScale', 'Regional noise scale ×', 'Échelle du bruit régional ×', .25, 4, .05),
  recipeNumber('crest', 'Crest strength', 'Force des crêtes', 0, 1.5, .05),
  recipeNumber('uplift', 'Uplift ×', 'Soulèvement ×', 0, 4, .05),
  { ...bool('procedural.regionalThermal', 'Thermal relaxation in the cycles', 'Relaxation thermique dans les cycles'), optional: true },
  { ...bool('procedural.regionalDiffusion', 'Diffusion in the cycles', 'Diffusion dans les cycles'), optional: true },
  { ...select('procedural.reconstruction', 'Reconstruction', 'Reconstruction', simple([['default', 'Engine reconstruction', 'Reconstruction du moteur'], ['cubic', 'Bounded bicubic', 'Bicubique bornée'], ['bspline', 'Positive B-spline', 'B-spline positive']])), optional: true },
  { ...select('procedural.posterior.mode', 'Posterior conditioning', 'Conditionnement a posteriori', simple([['none', 'None', 'Aucun'], ['erosion', 'Fluvial erosion', 'Érosion fluviale'], ['breach', 'Open depressions', 'Ouverture des dépressions'], ['both', 'Erosion and opening', 'Érosion et ouverture']])), optional: true },
  recipeNumber('posterior.strength', 'CPU fluvial strength', 'Force fluviale CPU', 0, 5, .1),
  recipeNumber('posterior.maxDepth', 'Maximum opening depth (m)', 'Profondeur maximale d’ouverture (m)', 0, 100, 1),
  recipeNumber('posterior.maxLength', 'Maximum opening length (m)', 'Longueur maximale d’ouverture (m)', 0, 2000, 10),
  recipeNumber('wind.iterations', 'Aeolian passes', 'Passes éoliennes', 0, 100, 1),
  recipeNumber('wind.azimuth', 'Wind blows towards (°)', 'Direction vers laquelle souffle le vent (°)', 0, 360, 5),
  recipeNumber('wind.transport', 'Maximum transport (m / pass)', 'Transport maximal (m / passe)', 0, 5, .05),
  recipeNumber('coastIterations', 'Coastal erosion cycles', 'Cycles d’érosion côtière', 0, 100, 1),
  recipeNumber('coastIncision', 'Coastal incision ×', 'Incision côtière ×', 0, 10, .05),
  recipeNumber('coastThermal', 'Coastal thermal ×', 'Thermique côtière ×', 0, 10, .05),
  recipeNumber('coastDiffusion', 'Coastal diffusion ×', 'Diffusion côtière ×', 0, 10, .05),
];
export const allTerrainFields = [...terrainSourceFields, ...terrainBasicFields, ...terrainProceduralFields, ...terrainClimateFields, ...terrainNeuralFields, ...terrainModelFields, ...terrainErosionFields, ...terrainRefinementFields, ...terrainHydrologyFields, ...terrainRustHydrologyFields, ...terrainVectorHydrologyFields, ...terrainForestFields];
