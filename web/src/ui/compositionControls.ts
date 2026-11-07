import { SEASON_CALENDAR_FIELDS } from '../../../rust/bridge/terrainRenderV2Zones';
import { DIAGNOSTICS } from '../render/displayDiagnostics';
import { POTENTIAL_IDS } from '../../../rust/bridge/resources';
import { STYLE_IDS, GROUND_VARIANTS, LAND_KINDS, presetComposition, withGroundVariant, type StyleId, type CompositionRecipe, type Limitation } from '../render/composition';
import { TEXT_GROUPS, type TextGroup } from '../render/textLayer';
import { TERRAIN_STYLE_LIST, type TerrainStyle } from '../render/terrainStyle';
import { writeSettingPath, type ParameterField } from './parameterForm';
import type { RenderSection, RenderText, SectionLevels } from './renderSettingsPanel';

export const compositionMessages: Record<string, { en: string; fr: string }> = {};
function copy(en: string, fr: string): string { compositionMessages[en] = compositionMessages[fr] = { en, fr }; return en; }
const choices = (entries: readonly (readonly [string, string, string])[]) => entries.map(([value, en, fr]) => ({ value, label: copy(en, fr) }));
const choice = (path: string, en: string, fr: string, entries: readonly (readonly [string, string, string])[]): ParameterField => ({ path: `appearance.${path}`, type: 'select', label: copy(en, fr), options: choices(entries) });
const flag = (path: string, en: string, fr: string): ParameterField => ({ path: `appearance.${path}`, type: 'boolean', label: copy(en, fr) });
const number = (path: string, en: string, fr: string, min: number, max: number, step: number): ParameterField => ({ path: `appearance.${path}`, type: 'number', label: copy(en, fr), min, max, step });
const fontEntries = [['inherit', 'Inherit', 'Hérité'], ['serif', 'Serif', 'Avec empattements'], ['sans', 'Sans serif', 'Sans empattements']] as const;
const TEXT_GROUP_LABELS: Record<TextGroup, readonly [string, string]> = { places: ['Places', 'Lieux'], water: ['Water', 'Eau'], nature: ['Nature', 'Nature'], countryside: ['Countryside', 'Campagne'], city: ['City', 'Ville'], landmarks: ['Landmarks', 'Monuments'], pins: ['Pins and sites', 'Repères et sites'] };
const LAND_KIND_LABELS: Record<typeof LAND_KINDS[number], readonly [string, string]> = { field: ['Fields', 'Champs'], meadow: ['Meadows', 'Prairies'], pasture: ['Pastures', 'Pâtures'], forest: ['Forests', 'Forêts'],
  orchard: ['Orchards', 'Vergers'], garden: ['Gardens', 'Jardins'], marsh: ['Marshes', 'Marais'], commons: ['Commons', 'Communs'] };
export const incompatibilityText: Record<string, string> = {
  'This ground draws its water from its own material.': copy('This ground draws its water from its own material.', 'Ce sol dessine son eau avec son propre matériau.'),
  'This ground colours itself from its material.': copy('This ground colours itself from its material.', 'Ce sol se colore avec son propre matériau.'),
  'Painted textures are not available.': copy('Painted textures are not available.', 'Les textures peintes ne sont pas disponibles.'),
  'Diagnostics need the composite renderer.': copy('Diagnostics need the composite renderer.', 'Les diagnostics demandent le rendu composite.'),
  "Diagnostics are 2D overlays.": copy("Diagnostics are 2D overlays.", "Les diagnostics sont des couches 2D."),
};
/** French of the reasons in render/composition.ts `limitationsOf`; an unknown reason is shown in English. */
export const limitationText: Record<string, string> = {
  'No parcels in the retained products.': copy('No parcels in the retained products.', 'Aucune parcelle dans les produits conservés.'),
  "No rural land-use polygons in the retained products.": copy("No rural land-use polygons in the retained products.", "Aucun polygone d’occupation rurale dans les produits conservés."),
  "No urban land-use polygons in the retained products.": copy("No urban land-use polygons in the retained products.", "Aucun polygone d’occupation urbaine dans les produits conservés."),
  "No buildings in the retained products.": copy("No buildings in the retained products.", "Aucun bâtiment dans les produits conservés."),
  "This bench has no retained resource diagnostics.": copy("This bench has no retained resource diagnostics.", "Ce banc ne possède pas les données conservées des diagnostics de ressources."),
  "This bench has no retained data for the selected diagnostic.": copy("This bench has no retained data for the selected diagnostic.", "Ce banc ne possède pas les données conservées du diagnostic choisi."),
  "This bench has no map legend or title cartouche data.": copy("This bench has no map legend or title cartouche data.", "Ce banc ne possède pas les données de légende ni de cartouche de titre."),
  "The raster backend cannot compose procedural canopy on map grounds.": copy("The raster backend cannot compose procedural canopy on map grounds.", "Le rendu raster ne peut pas composer la canopée procédurale sur les fonds de carte."),
  "No terrain raster in the retained products.": copy("No terrain raster in the retained products.", "Aucun raster de terrain dans les produits conservés."),
  "No retained oxbow geometry in this bench.": copy("No retained oxbow geometry in this bench.", "Aucune géométrie conservée de bras mort dans ce banc."),
  "This bench has no retained relief diagnostics.": copy("This bench has no retained relief diagnostics.", "Ce banc ne possède pas les données conservées des diagnostics du relief."),
  "This bench has no painted vegetation atlas in 3D.": copy("This bench has no painted vegetation atlas in 3D.", "Ce banc ne possède pas d’atlas de végétation peinte en 3D."),
  "This bench shows no procedural canopy on the 2D map with relief hidden.": copy("This bench shows no procedural canopy on the 2D map with relief hidden.", "Ce banc n’affiche pas de canopée procédurale sur la carte 2D sans relief."),
  "The 3D bench cannot drape footprints from retained building projections.": copy("The 3D bench cannot drape footprints from retained building projections.", "Le banc 3D ne peut pas draper les emprises des projections de bâtiments conservées."),
};
// Level 1 and 2: every row writes appearance.composition (render/composition.ts) and nothing else.
const STYLE_ENTRIES = [['atlas', 'Atlas', 'Atlas'], ['cadastre', 'Cadastre', 'Cadastre'], ['topographic', 'Topographic', 'Topographique'], ['satellite', 'Satellite', 'Satellite'], ['satellite-2', 'Satellite 2', 'Satellite 2'],
  ['parchment', 'Parchment', 'Parchemin'], ['illustration', 'Illustration', 'Illustration']] as const satisfies readonly (readonly [StyleId, string, string])[];
const PRESET_ENTRIES = [...STYLE_ENTRIES, ['custom', 'Custom', 'Personnalisé']] as const;
/** Options of the preset selects (English labels, translated by the shared messages). */
export const PRESET_OPTIONS: readonly { value: string; label: string }[] = PRESET_ENTRIES.map(([value, en]) => ({ value, label: en }));
const semanticEntries = [['off', 'Off', 'Désactivée'], ['subtle', 'Subtle tint', 'Teinte discrète'], ['categorical', 'Category colours', 'Couleurs par catégorie'], ['outlines', 'Outline only', 'Contours seuls']] as const;
const networkEntries = [['inherit', 'Follow the ground', 'Selon le fond'], ['ink', 'Ink', 'Encre'], ['natural', 'Natural', 'Naturel']] as const;
const styleFrench: Record<string, string> = { 'parchment-render': 'Satellite 2 · Peint', parchment: 'Parchemin', watabou: 'Simple (classique)', engraving: 'Gravure', blueprint: 'Plan bleu', illuminated: 'Enluminure', topographic: 'Topographique', night: 'Nocturne',
  render3d: 'Render3D · Multi-échelle', 'fantasy-ink': 'Fantasy · Encre N&B', 'fantasy-color': 'Fantasy · Aquarelle',
  'render-v2-substrate': 'Render v2 - Substrat', 'render-v2-moisture': 'Render v2 - Humidité', 'render-v2-vegetation': 'Render v2 - Végétation', 'render-v2-snow': 'Render v2 - Neige / glace' };
const variantLabel = (id: TerrainStyle): readonly [string, string] => {
  const style = TERRAIN_STYLE_LIST.find(entry => entry.id === id);
  return [style?.traits.fantasy === 'ink' ? 'Fantasy · Black & white ink' : style?.traits.fantasy === 'color' ? 'Fantasy · Watercolour' : style?.label ?? id, styleFrench[id] ?? style?.label ?? id];
};
export const compositionFields: Record<string, ParameterField> = Object.fromEntries([
  choice('composition.preset', 'Preset', 'Préréglage', PRESET_ENTRIES),
  choice('composition.ground.look', 'Ground', 'Fond', STYLE_ENTRIES),
  choice('composition.ground.variant', 'Ground variant', 'Variante du fond', STYLE_IDS.flatMap(look => GROUND_VARIANTS[look]).map(id => [id, ...variantLabel(id)] as const)),
  flag('composition.ground.contours', 'Contour lines', 'Courbes de niveau'),
  // Global effects: they apply on top of any style.
  choice('composition.effects.ambience', 'Ambience', 'Ambiance', [['day', 'Day', 'Jour'], ['night', 'Night', 'Nuit']]),
  number('composition.effects.season', 'Season (annual cycle)', 'Saison (cycle annuel)', 0, 1, .01),
  ...SEASON_CALENDAR_FIELDS.map(f => ({ ...number(`composition.effects.calendar.${f.key}`, f.en, f.fr, f.min, f.max, f.step), optional: true, placeholder: copy('Zone default', 'Selon la zone') })),
  flag('composition.effects.relief', 'Shaded relief', 'Relief ombré'),
  flag('composition.effects.lighting.enabled', 'Terrain shading', 'Ombrage du relief'),
  number('composition.effects.lighting.azimuth', 'Light azimuth (°)', 'Azimut de la lumière (°)', 0, 360, 1),
  number('composition.effects.lighting.elevation', 'Light elevation (°)', 'Élévation de la lumière (°)', 5, 90, 1),
  number('composition.effects.lighting.strength', 'Shading strength', 'Intensité de l’ombrage', 0, 3, .05),
  number('composition.effects.lighting.exaggeration', 'Shading relief multiplier', 'Multiplicateur du relief ombré', 0, 10, .1),
  choice('composition.vegetation.look', 'Vegetation', 'Végétation', [['none', 'No vegetation', 'Aucune végétation'], ['symbols', 'Map symbols', 'Symboles cartographiques'], ['painted', 'Painted', 'Peinte'], ['procedural-canopy', 'Procedural canopy', 'Canopée procédurale']]),
  choice('composition.vegetation.forestTone', 'Land-use forest colour', 'Couleur de la forêt (occupation du sol)', [['marked', 'Dark marked green (like the render)', 'Vert foncé marqué (comme le rendu)'], ['ground', 'Ground colour', 'Couleur du fond']]),
  choice('composition.landuse.rural', 'Rural land use', 'Occupation rurale', semanticEntries), choice('composition.landuse.urban', 'Urban land use', 'Occupation de la ville', semanticEntries),
  number('composition.landuse.opacity', 'Land-use opacity', 'Opacité de l’occupation', 0, 1, .05),
  choice('composition.landuse.depth', 'Land-use legibility', 'Lisibilité de l’occupation', [['surface', 'Surface', 'Surface'], ['readable', 'Readable', 'Lisible']]),
  // An absent class key means shown; a change moves only `keys.semantic`.
  ...LAND_KINDS.map(kind => ({ ...flag(`composition.landuse.classes.${kind}`, ...LAND_KIND_LABELS[kind]), defaultValue: true })),
  flag('composition.networks.roads.visible', 'Show roads', 'Afficher les routes'), choice('composition.networks.roads.look', 'Road look', 'Aspect des routes', [...networkEntries, ['wash', 'Wash', 'Lavis']]),
  number('composition.networks.roads.emphasis', 'Road emphasis', 'Présence des routes', .5, 1.5, .05),
  flag('composition.networks.water.visible', 'Show rivers and water', 'Afficher les rivières et l’eau'), choice('composition.networks.water.look', 'Water look', 'Aspect de l’eau', networkEntries),
  flag('composition.buildings.visible', 'Show buildings', 'Afficher les bâtiments'),
  choice('composition.buildings.look', 'Building look', 'Aspect des bâtiments', [['footprints', 'Footprints', 'Emprises'], ['cartographic-roofs', 'Cartographic roofs', 'Toits cartographiques'], ['simple-volumes', 'Simple volumes', 'Volumes simples'], ['detailed-volumes', 'Detailed volumes', 'Volumes détaillés']]),
  flag('composition.buildings.parcels', 'Parcels', 'Parcelles'), flag('composition.buildings.blocks', 'Blocks', 'Îlots'), flag('composition.buildings.districts', 'Districts', 'Quartiers'),
  flag('composition.text.visible', 'Text', 'Textes'),
  ...TEXT_GROUPS.map(group => flag(`composition.text.groups.${group}`, ...TEXT_GROUP_LABELS[group])),
  choice('composition.text.look', 'Style', 'Style', fontEntries),
  number('composition.text.size', 'Size', 'Taille', .6, 1.8, .05),
  choice('composition.text.density', 'Density', 'Densité', [['low', 'Low', 'Faible'], ['normal', 'Normal', 'Normale'], ['high', 'High', 'Forte']]),
  choice('composition.text.halo', 'Halo', 'Halo', [['inherit', 'Inherit', 'Hérité'], ['strong', 'Strong', 'Fort']]),
  flag('composition.annotations.legend', 'Legend', 'Légende'), flag('composition.annotations.cartouche', 'Title cartouche', 'Cartouche du titre'),
].map(field => [field.path.replace('appearance.', ''), field]));
/** Level 2: the composition rows of each section, in panel order; the semantic land-use rows are mounted apart (see `SEMANTIC_ROWS` and `LANDUSE_CLASS_ROWS`). */
export const RENDER_COMPOSITION_ROWS: Record<RenderSection, readonly string[]> = {
  general: ['composition.annotations.legend', 'composition.annotations.cartouche'],
  relief: ['composition.ground.contours'],
  ground: ['composition.preset', 'composition.ground.look', 'composition.ground.variant'],
  vegetation: ['composition.vegetation.look', 'composition.vegetation.forestTone'],
  landuse: [],
  ambience: ['composition.effects.ambience', 'composition.effects.season', ...SEASON_CALENDAR_FIELDS.map(f => `composition.effects.calendar.${f.key}`), 'composition.effects.relief', 'composition.effects.lighting.enabled', 'composition.effects.lighting.azimuth', 'composition.effects.lighting.elevation', 'composition.effects.lighting.strength', 'composition.effects.lighting.exaggeration'],
  roads: ['composition.networks.roads.visible', 'composition.networks.roads.look', 'composition.networks.roads.emphasis'],
  water: ['composition.networks.water.visible', 'composition.networks.water.look'],
  buildings: ['composition.buildings.visible', 'composition.buildings.look', 'composition.buildings.parcels', 'composition.buildings.blocks', 'composition.buildings.districts'],
  text: ['composition.text.visible', 'composition.text.look', 'composition.text.size', 'composition.text.density', 'composition.text.halo', ...TEXT_GROUPS.map(g => `composition.text.groups.${g}`)],
  diagnostics: [],
};
/** Semantic display of land use, kept apart from the physical cover: hiding it never hides fields, forests or marshes. */
export const SEMANTIC_ROWS = ['composition.landuse.rural', 'composition.landuse.urban', 'composition.landuse.opacity'];
/** Rural classes the semantic layer may show (advanced group of the land-use section). */
export const LANDUSE_CLASS_ROWS = LAND_KINDS.map(kind => `composition.landuse.classes.${kind}`);

/** Pure recipe edit, shared by every appearance panel. */
export function writeCompositionField(recipe: CompositionRecipe, key: string, value: unknown): CompositionRecipe {
  if (key === 'preset') return value === 'custom' ? recipe : presetComposition(value as StyleId);
  if (key === 'ground.look') return withGroundVariant(recipe, GROUND_VARIANTS[value as StyleId][0]);
  if (key === 'ground.variant') return withGroundVariant(recipe, value as TerrainStyle);
  const next = structuredClone(recipe); writeSettingPath(next, key, value); next.preset = 'custom'; return next;
}
export const LIMITATION_ROW: Record<Limitation['pass'], string> = {
  ground: 'composition.ground.look', vegetation: 'composition.vegetation.look', landuse: 'composition.landuse.rural', networks: 'composition.networks.roads.look',
  buildings: 'composition.buildings.look', annotations: 'composition.annotations.legend', text: 'composition.text.visible', ambience: 'composition.effects.ambience',
};
export const NOTE_STYLE = 'display:block;grid-column:1/-1;font-size:10px;line-height:1.4;font-style:italic;opacity:.7;margin-top:3px';

export function mountCompositionSection(level: SectionLevels, key: RenderSection, mount: (parent: HTMLElement, fields: readonly ParameterField[]) => void, text: RenderText): void {
  const fields = (...paths: readonly string[]) => paths.map(path => compositionFields[path]);
  const subhead = (parent: HTMLElement, en: string, fr: string, noteEn?: string, noteFr?: string) => {
    const title = document.createElement('strong'); title.className = 'v2-render-subhead'; text(title, en, fr); title.style.cssText = 'display:block;margin:10px 0 3px;font-size:11px'; parent.append(title);
    if (noteEn) { const note = document.createElement('small'); note.className = 'hint'; text(note, noteEn, noteFr!); note.style.cssText = 'display:block;margin-bottom:4px;line-height:1.4'; parent.append(note); }
  };
  mount(level.rows, fields(...RENDER_COMPOSITION_ROWS[key]));
  if (key !== 'landuse') return;
  subhead(level.rows, 'Land-use display', 'Affichage de l’occupation du sol', 'Information layer only: hiding or tinting it never hides fields, forests or marshes, which the ground draws.', 'Couche d’information seule : la masquer ou la teinter ne cache ni champs, ni forêts, ni marais, que le fond dessine.');
  mount(level.rows, fields(...SEMANTIC_ROWS));
  subhead(level.advanced, 'Legibility', 'Lisibilité'); mount(level.advanced, fields('composition.landuse.depth'));
  subhead(level.advanced, 'Classes shown', 'Classes affichées', 'Unticked classes are left out of the information layer only.', 'Les classes décochées ne sortent que de la couche d’information.');
  mount(level.advanced, fields(...LANDUSE_CLASS_ROWS));
}

const advancedCommonFields: ParameterField[] = [
  choice('vegetation', 'Vector vegetation', 'Végétation vectorielle', [['classic', 'Classic symbols', 'Symboles classiques'], ['canopy', 'Foliage and canopy', 'Feuillages et canopée']]),
];
const terrainFields: ParameterField[] = [
  flag('terrainLayers.hypsometry', 'Elevation colours', 'Couleurs hypsométriques'), flag('terrainLayers.frame', 'Map frame', 'Cadre de la carte'),
  flag('lakes', 'Lakes', 'Lacs'), flag('oxbows', 'Oxbow lakes', 'Bras morts'),
];
const cityFields: ParameterField[] = [
  choice('city.view', 'City view', 'Vue de la ville', [['tissue', 'Urban tissue', 'Tissu urbain'], ['uses', 'Land uses', 'Usages'], ['parcels', 'Parcels', 'Parcelles'], ['buildings', 'Buildings', 'Bâtiments'], ['roles', 'District roles', 'Fonctions des quartiers']]),
  choice('city.palette', 'City palette', 'Palette des villes', [['growth', 'Growth phases', 'Phases de croissance'], ['atlas', 'District atlas', 'Atlas des quartiers'], ['ink', 'Ink', 'Encre'], ['terrain', 'Terrain', 'Terrain'], ['parchment', 'Parchment', 'Parchemin']]),
  choice('city.diagnostic', 'Building diagnostic', 'Diagnostic des bâtiments', [['none', 'None', 'Aucun'], ['uses', 'Uses', 'Usages'], ['height', 'Height', 'Hauteur'], ['access', 'Access and refusals', 'Desserte et refus']]),
  flag('textured', 'Textured roofs and materials', 'Toits et matériaux texturés'), flag('city.painted', 'Relief and cast shadows of buildings', 'Relief et ombres portées des bâtiments'),
  number('city.opacity', 'City opacity', 'Opacité des villes', 0, 1, .05), number('city.width', 'City line width (px)', 'Épaisseur des traits urbains (px)', 0, 5, .1),
];
const cityLayerOrder = ['reserve', 'allocated', 'centers', 'domains', 'quarters', 'blocks', 'streets', 'enclosures', 'lotEnclosures', 'parcels', 'gardens', 'places', 'fronts', 'axes', 'access'] as const;
const layerLabels: Record<typeof cityLayerOrder[number], readonly [string, string]> = {
  reserve: ['Growth reserves', 'Réserves de croissance'], allocated: ['Allocated urban land', 'Terre urbaine attribuée'], centers: ['District centres', 'Noyaux de quartier'],
  domains: ['Reserved domains', 'Domaines réservés'], quarters: ['Computational districts', 'Secteurs de calcul'], blocks: ['Blocks', 'Îlots'], streets: ['Urban streets', 'Rues urbaines'],
  enclosures: ['Walls and gates', 'Enceintes et portes'], parcels: ['Parcels', 'Parcelles'], gardens: ['Gardens', 'Jardins'], places: ['Squares and commons', 'Places et communs'],
  lotEnclosures: ['Plot enclosures', 'Clôtures des parcelles'], fronts: ['Accessible frontages', 'Façades accessibles'], axes: ['Parcel axes', 'Axes des parcelles'], access: ['Parcel access status', 'Statut de desserte des parcelles'],
};
const cityLayerFields = cityLayerOrder.map(layer => flag(`city.layers.${layer}`, ...layerLabels[layer]));
export const fantasyFields: ParameterField[] = [number('fantasy.density', 'Brush density', 'Densité des pinceaux', .3, 2, .05),
  number('fantasy.size', 'Brush size', 'Taille des pinceaux', .1, 2, .05), number('fantasy.spacing', 'Brush spacing', 'Espacement des pinceaux', .3, 2, .05),
  flag('fantasy.followLanduse', 'Follow land use', 'Suivre l’occupation du sol')];
export const forestFields = [flag('forest.enabled', 'Detailed satellite canopy', 'Canopée satellite détaillée'),
  { ...number('forest.density', 'Forest density (%)', 'Densité forestière (%)', 0, 200, 5), toInput: (value: unknown) => Number(value) * 100, fromInput: (value: unknown) => Number(value) / 100 },
  { ...number('forest.clearings', 'Natural clearings (%)', 'Clairières naturelles (%)', 0, 100, 5), toInput: (value: unknown) => Number(value) * 100, fromInput: (value: unknown) => Number(value) / 100 }];
const diagnosticLabels: Record<string, readonly [string, string]> = {
  none: ['None', 'Aucun'], elevation: ['Elevation · DEM', 'Altitude · DEM'],
  'v-accumulation': ['Vector · accumulation', 'Vectoriel · accumulation'], 'v-basins': ['Vector · watersheds', 'Vectoriel · bassins versants'],
  'v-depth': ['Vector · depression filling', 'Vectoriel · comblement des dépressions'], 'v-conditioning': ['Vector · conditioning', 'Vectoriel · conditionnement'],
  'v-lakes': ['Vector · lake water balance', 'Vectoriel · bilan hydrique des lacs'], 'v-styles': ['Vector · channel styles', 'Vectoriel · styles des cours d’eau'],
  basins: ['Rust · watersheds', 'Rust · bassins versants'], accumulation: ['Rust · accumulation', 'Rust · accumulation'], flow: ['Rust · flow', 'Rust · écoulement'],
  channels: ['Rust · channel network', 'Rust · réseau hydrographique'], depressions: ['Rust · depressions', 'Rust · dépressions'], lakes: ['Rust · lake depth', 'Rust · profondeur des lacs'],
  flats: ['Rust · flat areas', 'Rust · surfaces planes'], 'flat-rank': ['Rust · flat-area ranks', 'Rust · rangs des surfaces planes'],
  'raw-basins': ['Rust · raw watersheds', 'Rust · bassins bruts'], 'raw-accumulation': ['Rust · raw accumulation', 'Rust · accumulation brute'],
  'raw-flow': ['Rust · raw flow', 'Rust · écoulement brut'], 'raw-depressions': ['Rust · raw depressions', 'Rust · dépressions brutes'],
  'res-geology': ['Geology · bedrock', 'Géologie · roche'], 'res-soil-depth': ['Soil · depth', 'Sol · profondeur'], 'res-moisture': ['Soil · moisture', 'Sol · humidité'],
  'res-drainage': ['Soil · drainage', 'Sol · drainage'], 'res-alluvial': ['Soil · alluvium', 'Sol · alluvions'], 'res-potential': ['Resources · potential', 'Ressources · potentiel'],
  'res-deposits': ['Deposits and anchors', 'Gisements et ancres'], 'res-sites': ['Activity sites', 'Sites d’activité'],
};
const potentialLabels: Record<string, readonly [string, string]> = {
  arable: ['Arable land', 'Terres arables'], pasture: ['Pasture', 'Pâturage'], upland_pasture: ['Upland pasture', 'Alpage'], wood: ['Firewood', 'Bois de chauffe'], timber: ['Timber', 'Bois d’œuvre'],
  water_power: ['Water power', 'Force hydraulique'], wind_exposure: ['Wind exposure', 'Exposition au vent'], stone_ashlar: ['Building stone', 'Pierre de taille'], lime: ['Limestone for lime', 'Calcaire à chaux'],
  slate: ['Slate', 'Ardoise'], clay: ['Clay', 'Argile'], sand: ['Sand', 'Sable'], fish_river: ['River fishing', 'Pêche fluviale'], fish_coast: ['Coastal fishing', 'Pêche côtière'],
  peat: ['Peat', 'Tourbe'], bog_iron: ['Bog iron', 'Fer des marais'], salt_coast: ['Coastal salt', 'Sel marin'], game: ['Game', 'Gibier'], navigable: ['Navigable water', 'Eau navigable'], coast_shelter: ['Coastal shelter', 'Abri côtier'],
};
export const diagnosticFields = [choice('diagnostic', 'Diagnostic overlay', 'Couche de diagnostic', DIAGNOSTICS.map(({ id }) => [id, ...diagnosticLabels[id]] as const)),
  choice('resourcePotential', 'Resource shown', 'Ressource affichée', POTENTIAL_IDS.map(id => [id, ...potentialLabels[id]] as const))];
const perspectiveFields = [flag('city.plan', 'City plan in 3D', 'Plan de ville en 3D'),
  choice('city.colors', 'Building colours in 3D', 'Couleurs des bâtiments en 3D', [['materials', 'Materials', 'Matériaux'], ['uses', 'Uses', 'Usages']]),
  number('city.exaggeration', 'Vertical exaggeration in 3D', 'Exagération verticale en 3D', 1, 5, .1),
  choice('city.refinement', 'Surface refinement in 3D', 'Raffinement de surface en 3D', [['source', 'Source heights', 'Altitudes source'], ['noise', 'Multiscale detail', 'Détail multi-échelle']])];
/** Level 3: the fine controls the recipe does not drive. */
export const advancedFields = [...advancedCommonFields, ...terrainFields, ...cityFields, ...cityLayerFields, ...perspectiveFields, ...fantasyFields, ...forestFields, ...diagnosticFields];
export const renderControlFields = [...Object.values(compositionFields), ...advancedFields];

/** Panel section of every appearance control (the staged Display rows place one or more sections each). */
const strip = (fields: readonly ParameterField[]) => fields.map(field => field.path.replace('appearance.', ''));
export const RENDER_SECTION_FIELDS: Record<RenderSection, readonly string[]> = {
  general: ['terrainLayers.frame'],
  relief: ['city.exaggeration', 'city.refinement'],
  ground: ['terrainLayers.hypsometry'],
  vegetation: ['vegetation', ...strip(fantasyFields), ...strip(forestFields)],
  landuse: [],
  ambience: [],
  roads: ['city.layers.streets'],
  water: ['lakes', 'oxbows'],
  buildings: ['city.plan', 'city.colors', ...strip(cityFields), ...strip(cityLayerFields).filter(path => path !== 'city.layers.streets')],
  text: [],
  diagnostics: ['diagnostic', 'resourcePotential'],
};

