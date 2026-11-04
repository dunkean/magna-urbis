/** Display controls for retained terrain and native cities; none invokes a generation stage. */
import type { World } from '../gen/types';
import type { V2Appearance, V2Settings } from './contracts';
import { DIAGNOSTICS, RESOURCE_LEGENDS, diagnosticAvailable, isResourceDiagnostic } from '../render/displayDiagnostics';
import { POTENTIAL_IDS } from '../../../rust/bridge/resources';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { CITY_LAYER_NAMES, resolveSettingsAppearance } from './appearance';
import { resolvedValues } from '../render/appearanceRecipe';
import { bindTree, registerMessages, setText } from './i18n';
import { mountParameterForm, readSettingPath, writeSettingPath, type ParameterField, type ParameterForm } from './parameterForm';
import { mountRenderSettingsPanel, mountRenderColorControls, type RenderSection } from '../ui/renderSettingsPanel';
import { TERRAIN_STYLE_LIST, styleTraits, terrainStyle } from '../render/terrainStyle';
import { biomePalette } from '../render/biomes';
import { paletteColors, type RenderColorKey } from '../render/customColors';
import { worldCapabilities } from './nativeProducts';
import { markStyleCustomized } from '../ui/renderStyleCustomization';

export interface RenderControlBindings { getSettings(): V2Settings; onChange(): void; getWorld?(): World | undefined; getStyleSelectors?(): readonly HTMLSelectElement[] }
export interface RenderControls { sync(): void; dispose(): void }
export const renderControlMessages: Record<string, { en: string; fr: string }> = {};
const INCOMPATIBLE = (en: string, fr: string): string => copy(en, fr);
const incompatibilityText: Record<string, string> = {
  'This ground draws its water from its own material.': INCOMPATIBLE('This ground draws its water from its own material.', 'Ce sol dessine son eau avec son propre matériau.'),
  'This ground colours itself from its material.': INCOMPATIBLE('This ground colours itself from its material.', 'Ce sol se colore avec son propre matériau.'),
  'Painted textures are not available.': INCOMPATIBLE('Painted textures are not available.', 'Les textures peintes ne sont pas disponibles.'),
  'Diagnostics need the composite renderer.': INCOMPATIBLE('Diagnostics need the composite renderer.', 'Les diagnostics demandent le rendu composite.'),
};
function copy(en: string, fr: string): string { renderControlMessages[en] = renderControlMessages[fr] = { en, fr }; return en; }
const choices = (entries: readonly (readonly [string, string, string])[]) => entries.map(([value, en, fr]) => ({ value, label: copy(en, fr) }));
const choice = (path: string, en: string, fr: string, entries: readonly (readonly [string, string, string])[]): ParameterField => ({ path: `appearance.${path}`, type: 'select', label: copy(en, fr), options: choices(entries) });
const flag = (path: string, en: string, fr: string): ParameterField => ({ path: `appearance.${path}`, type: 'boolean', label: copy(en, fr) });
const number = (path: string, en: string, fr: string, min: number, max: number, step: number): ParameterField => ({ path: `appearance.${path}`, type: 'number', label: copy(en, fr), min, max, step });
const ui = {
  title: copy('Render settings', 'Réglages du rendu'), common: copy('Map and natural cover', 'Carte et milieux naturels'),
  help: copy('Redraw the retained map. These settings do not regenerate terrain or settlements.', 'Redessine la carte conservée. Ces réglages ne régénèrent ni le relief ni les lieux.'),
  terrain: copy('Terrain and water layers', 'Couches du relief et de l’eau'), light: copy('Lighting and relief', 'Lumière et relief'),
  city: copy('Cities and buildings', 'Villes et bâtiments'), cityLayers: copy('Detailed city layers', 'Couches détaillées des villes'),
  fantasy: copy('Fantasy brushes', 'Pinceaux fantasy'), season: copy('Satellite season', 'Saison du satellite'),
  diagnostics: copy('Terrain and water diagnostics', 'Diagnostics du relief et de l’eau'),
  unavailable: copy('This diagnostic needs retained data from the selected water engine.', 'Ce diagnostic nécessite les données conservées du moteur hydrologique correspondant.'),
};
// These labels also localize the shared terrain-style selector mounted by the main UI.
copy('Fantasy · Ink (B&W)', 'Fantasy · Encre N&B'); copy('Fantasy · Watercolour', 'Fantasy · Aquarelle');
copy('Render v2 · Satellite', 'Render v2 · Satellite'); copy('Elevation · DEM', 'Altitude · DEM');

const commonFields: ParameterField[] = [
  choice('renderer', 'Map renderer', 'Moteur de rendu', [['classic', 'Classic · V1', 'Classique · V1'], ['bench', 'Terrain / City Bench', 'Terrain / City Bench']]),
  flag('contours', 'Contour lines', 'Courbes de niveau'), flag('landuse', 'Vector land use', 'Occupation vectorielle du sol'),
  flag('labels', 'Map labels', 'Toponymes'), flag('legend', 'Legend', 'Légende'), flag('cartouche', 'Title cartouche', 'Cartouche du titre'),
  flag('painted', 'Painted natural textures', 'Textures naturelles peintes'),
  choice('vegetation', 'Vector vegetation', 'Végétation vectorielle', [['classic', 'Classic symbols', 'Symboles classiques'], ['canopy', 'Foliage and canopy', 'Feuillages et canopée']]),
  choice('landuseForestTone', 'Land-use forest colour', 'Couleur de la forêt (occupation du sol)', [['marked', 'Dark marked green (like the render)', 'Vert foncé marqué (comme le rendu)'], ['ground', 'Ground colour', 'Couleur du fond']]),
];
const terrainFields: ParameterField[] = [
  flag('terrainLayers.relief', 'Terrain base', 'Fond du terrain'), flag('terrainLayers.hypsometry', 'Elevation colours', 'Couleurs hypsométriques'),
  flag('terrainLayers.frame', 'Map frame', 'Cadre de la carte'), flag('terrainLayers.water', 'Water network', 'Réseau hydrographique'),
  flag('lakes', 'Lakes', 'Lacs'), flag('oxbows', 'Oxbow lakes', 'Bras morts'),
];
const lightingFields: ParameterField[] = [
  flag('lighting.enabled', 'Terrain shading', 'Ombrage du relief'),
  number('lighting.azimuth', 'Light azimuth (°)', 'Azimut de la lumière (°)', 0, 360, 1),
  number('lighting.elevation', 'Light elevation (°)', 'Élévation de la lumière (°)', 5, 90, 1),
  number('lighting.strength', 'Shading strength', 'Intensité de l’ombrage', 0, 3, .05),
  number('lighting.exaggeration', 'Shading relief multiplier', 'Multiplicateur du relief ombré', 0, 10, .1),
];
const cityFields: ParameterField[] = [
  choice('city.view', 'City view', 'Vue de la ville', [['tissue', 'Urban tissue', 'Tissu urbain'], ['uses', 'Land uses', 'Usages'], ['parcels', 'Parcels', 'Parcelles'], ['buildings', 'Buildings', 'Bâtiments'], ['roles', 'District roles', 'Fonctions des quartiers']]),
  choice('city.palette', 'City palette', 'Palette des villes', [['growth', 'Growth phases', 'Phases de croissance'], ['atlas', 'District atlas', 'Atlas des quartiers'], ['ink', 'Ink', 'Encre'], ['terrain', 'Terrain', 'Terrain'], ['parchment', 'Parchment', 'Parchemin']]),
  choice('city.buildingStyle', 'Building appearance', 'Apparence des bâtiments', [['geometric', 'Geometry', 'Géométrie'], ['cartographic', 'Cartographic roofs', 'Toits cartographiques'], ['silhouette', 'Footprint silhouettes', 'Silhouettes des emprises']]),
  choice('city.diagnostic', 'Building diagnostic', 'Diagnostic des bâtiments', [['none', 'None', 'Aucun'], ['uses', 'Uses', 'Usages'], ['height', 'Height', 'Hauteur'], ['access', 'Access and refusals', 'Desserte et refus']]),
  flag('textured', 'Textured roofs and materials', 'Toits et matériaux texturés'), flag('city.painted', 'Relief and cast shadows of buildings', 'Relief et ombres portées des bâtiments'),
  choice('city.groundBlend', 'Roads and ground', 'Voies et sols', [['classic', 'Classic', 'Classique'], ['blended', 'Blended', 'Intégrés']]),
  number('city.opacity', 'City opacity', 'Opacité des villes', 0, 1, .05), number('city.width', 'City line width (px)', 'Épaisseur des traits urbains (px)', 0, 5, .1),
];
const layerLabels: Record<typeof CITY_LAYER_NAMES[number], readonly [string, string]> = {
  reserve: ['Growth reserves', 'Réserves de croissance'], allocated: ['Allocated urban land', 'Terre urbaine attribuée'], centers: ['District centres', 'Noyaux de quartier'],
  domains: ['Reserved domains', 'Domaines réservés'], quarters: ['Computational districts', 'Secteurs de calcul'], blocks: ['Blocks', 'Îlots'], streets: ['Urban streets', 'Rues urbaines'],
  enclosures: ['Walls and gates', 'Enceintes et portes'], parcels: ['Parcels', 'Parcelles'], gardens: ['Gardens', 'Jardins'], places: ['Squares and commons', 'Places et communs'],
  lotEnclosures: ['Plot enclosures', 'Clôtures des parcelles'], fronts: ['Accessible frontages', 'Façades accessibles'], axes: ['Parcel axes', 'Axes des parcelles'], access: ['Parcel access status', 'Statut de desserte des parcelles'],
};
const cityLayerFields = CITY_LAYER_NAMES.map(layer => flag(`city.layers.${layer}`, ...layerLabels[layer]));
const fantasyFields: ParameterField[] = [number('fantasy.density', 'Brush density', 'Densité des pinceaux', .3, 2, .05),
  number('fantasy.size', 'Brush size', 'Taille des pinceaux', .1, 2, .05), number('fantasy.spacing', 'Brush spacing', 'Espacement des pinceaux', .3, 2, .05),
  flag('fantasy.followLanduse', 'Follow land use', 'Suivre l’occupation du sol')];
const seasonFields = [number('season', 'Season (annual cycle)', 'Saison (cycle annuel)', 0, 1, .01)];
const forestFields = [flag('forest.enabled', 'Detailed satellite canopy', 'Canopée satellite détaillée'),
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
const diagnosticFields = [choice('diagnostic', 'Diagnostic overlay', 'Couche de diagnostic', DIAGNOSTICS.map(({ id }) => [id, ...diagnosticLabels[id]] as const)),
  choice('resourcePotential', 'Resource shown', 'Ressource affichée', POTENTIAL_IDS.map(id => [id, ...potentialLabels[id]] as const))];
const styleFrench: Record<string, string> = { parchment: 'Parchemin', watabou: 'Simple (classique)', engraving: 'Gravure', blueprint: 'Plan bleu', illuminated: 'Enluminure', topographic: 'Topographique', night: 'Nocturne',
  render3d: 'Render3D · Multi-échelle', 'fantasy-ink': 'Fantasy · Encre N&B', 'fantasy-color': 'Fantasy · Aquarelle',
  'render-v2-substrate': 'Render v2 - Substrat', 'render-v2-moisture': 'Render v2 - Humidité', 'render-v2-vegetation': 'Render v2 - Végétation', 'render-v2-snow': 'Render v2 - Neige / glace' };
const styleFields = [choice('terrainStyle', 'Ground style', 'Style du sol', TERRAIN_STYLE_LIST.map(style => [style.id,
  style.traits.fantasy === 'ink' ? 'Fantasy · Black & white ink' : style.traits.fantasy === 'color' ? 'Fantasy · Watercolour' : style.label,
  styleFrench[style.id] ?? style.label] as const))];
const visibilityFields = [flag('roads', 'Regional roads', 'Routes régionales'), flag('buildings', 'Show buildings', 'Afficher les bâtiments'),
  flag('unifiedDefaults', 'To test · Same defaults in 2D, 3D and classic map', 'À tester · Mêmes valeurs par défaut en 2D, 3D et carte classique')];
const perspectiveFields = [flag('city.plan', 'City plan in 3D', 'Plan de ville en 3D'),
  choice('city.colors', 'Building colours in 3D', 'Couleurs des bâtiments en 3D', [['materials', 'Materials', 'Matériaux'], ['uses', 'Uses', 'Usages']]),
  number('city.exaggeration', 'Vertical exaggeration in 3D', 'Exagération verticale en 3D', 1, 5, .1),
  choice('city.refinement', 'Surface refinement in 3D', 'Raffinement de surface en 3D', [['source', 'Source heights', 'Altitudes source'], ['noise', 'Multiscale detail', 'Détail multi-échelle']])];
export const renderControlFields = [...styleFields, ...visibilityFields, ...commonFields, ...terrainFields, ...lightingFields, ...cityFields, ...cityLayerFields, ...perspectiveFields, ...fantasyFields, ...seasonFields, ...forestFields, ...diagnosticFields];

/** Panel section of every appearance control (the staged Display rows place one or more sections each). */
const strip = (fields: readonly ParameterField[]) => fields.map(field => field.path.replace('appearance.', ''));
export const RENDER_SECTION_FIELDS: Record<RenderSection, readonly string[]> = {
  general: ['renderer', 'labels', 'legend', 'cartouche', 'terrainLayers.frame'],
  relief: [...strip(lightingFields), 'city.exaggeration', 'city.refinement'],
  ground: ['terrainStyle', 'terrainLayers.relief', 'terrainLayers.hypsometry'],
  cover: ['contours', 'landuse', 'painted', 'vegetation', 'landuseForestTone', ...strip(fantasyFields), ...strip(seasonFields), ...strip(forestFields)],
  roads: ['roads', 'city.layers.streets', 'city.groundBlend'],
  water: ['terrainLayers.water', 'lakes', 'oxbows'],
  buildings: ['buildings', 'unifiedDefaults', 'city.plan', 'city.colors', ...strip(cityFields).filter(path => path !== 'city.groundBlend'), ...strip(cityLayerFields).filter(path => path !== 'city.layers.streets')],
  diagnostics: ['diagnostic', 'resourcePotential'],
};

/** Defaults come from the shared resolver (one table for 2D, 3D and export); a saved recipe is never expanded. */
export function renderControlValues(settings: V2Settings, world?: World): V2Appearance {
  return resolvedValues(resolveSettingsAppearance(settings, world, 'view2d')) as V2Appearance;
}
/** A selected preset alone is unchanged. Compare display values with that preset's inherited defaults. */
export function appearanceCustomized(settings: V2Settings, world?: World): boolean {
  const a = settings.appearance; if (!a) return false;
  const current = { appearance: renderControlValues(settings, world) };
  const defaults = { appearance: renderControlValues({ ...settings, appearance: { style: a.style, terrainStyle: a.terrainStyle, renderer: a.renderer } }, world) };
  for (const field of renderControlFields) {
    if (['appearance.terrainStyle', 'appearance.renderer'].includes(field.path)) continue;
    if (readSettingPath(current, field.path) !== readSettingPath(defaults, field.path)) return true;
  }
  const style = current.appearance.renderer === 'classic' ? a.style : a.terrainStyle ?? a.style;
  const palette = current.appearance.renderer === 'classic' ? biomePalette(a.style, settings.options.biome) : terrainStyle(style).palette;
  const colors = paletteColors(palette);
  return Object.entries(a.colors ?? {}).some(([key, value]) => value.toLowerCase() !== colors[key as RenderColorKey].toLowerCase());
}
/** Materialize only the nested structure being edited, keeping unrelated inherited values absent. */
export function writeAppearanceControl(settings: V2Settings, path: string, value: unknown): void {
  settings.appearance ??= { style: settings.options.style };
  if (/^appearance\.(lighting\.|terrainLayers\.|fantasy\.|forest\.|city\.|season$|diagnostic$|lakes$|oxbows$)/.test(path)) settings.appearance.renderer = 'bench';
  const defaults = renderControlValues(settings);
  for (const key of ['lighting', 'terrainLayers', 'fantasy'] as const)
    if (path.startsWith(`appearance.${key}.`) && !settings.appearance[key]) Object.assign(settings.appearance, { [key]: defaults[key] });
  writeSettingPath(settings, path, value);
  if (path === 'appearance.terrainStyle') {
    settings.appearance.renderer = 'bench';
    delete settings.appearance.city?.ground;
  }
}

/** A short muted note under each control the resolver declares incompatible with the current ground. */
function showIncompatibilities(root: HTMLElement, resolved: ResolvedAppearance): void {
  root.querySelectorAll('.v2-incompatible').forEach(note => note.remove());
  for (const { field, reason } of resolved.incompatibilities) {
    const target = field.startsWith('colors.') ? root.querySelector<HTMLElement>(`[data-color-key="${field.slice(7)}"]`)
      : root.querySelector<HTMLElement>(`[data-setting-path="appearance.${field}"]`)?.closest<HTMLElement>('.parameter-field') ?? null;
    if (!target) continue;
    const note = document.createElement('small'); note.className = 'v2-incompatible'; note.style.cssText = 'display:block;grid-column:1/-1;font-size:10px;line-height:1.4;font-style:italic;opacity:.7;margin-top:3px'; setText(note, incompatibilityText[reason] ?? reason);
    target.append(note);
  }
}

export function mountRenderControls(host: HTMLElement, bindings: RenderControlBindings): RenderControls {
  const text = (element: HTMLElement, en: string, fr: string) => { const label = copy(en, fr); registerMessages(renderControlMessages); setText(element, label); };
  registerMessages(renderControlMessages);
  const panel = mountRenderSettingsPanel(host, text), { root } = panel;
  root.classList.add('v2-render-controls'); root.id = 'render-settings';
  panel.popup.classList.add('v2-render-popup');
  for (const section of Object.values(panel.sections)) section.classList.add('v2-render-section');
  const forms: ParameterForm[] = [];
  const section = (key: RenderSection, fields: readonly ParameterField[]): void => {
    const body = document.createElement('div'); panel.bodies[key].append(body);
    forms.push(mountParameterForm(body, fields, { getValue: path => readSettingPath({ appearance: renderControlValues(bindings.getSettings(), bindings.getWorld?.()) }, path),
      setValue: (path, value) => { writeAppearanceControl(bindings.getSettings(), path, value); bindings.onChange(); sync(); } }));
  };
  // Keep the listed order: RENDER_SECTION_FIELDS is the single description of the panel layout.
  const byPath = (...paths: readonly string[]) => paths.map(path => renderControlFields.find(field => field.path === `appearance.${path}`)!);
  for (const key of ['general', 'relief', 'ground', 'cover', 'roads', 'water', 'buildings'] as const) {
    const conditionalPaths = key === 'cover' ? strip([...fantasyFields, ...seasonFields, ...forestFields]) : [];
    section(key, byPath(...RENDER_SECTION_FIELDS[key].filter(path => !conditionalPaths.includes(path))));
  }
  const conditional = (label: string, fields: ParameterField[]) => {
    const group = document.createElement('details'), summary = document.createElement('summary'); setText(summary, label); group.append(summary);
    const body = document.createElement('div'); group.append(body); panel.bodies.cover.append(group);
    forms.push(mountParameterForm(body, fields, { getValue: path => readSettingPath({ appearance: renderControlValues(bindings.getSettings(), bindings.getWorld?.()) }, path), setValue: (path, value) => { writeAppearanceControl(bindings.getSettings(), path, value); bindings.onChange(); sync(); } }));
    return group;
  };
  const fantasy = conditional(ui.fantasy, fantasyFields), season = conditional(ui.season, seasonFields);
  const forestLabel = copy('Satellite trees', 'Arbres satellite'); registerMessages(renderControlMessages);
  const forest = conditional(forestLabel, forestFields);
  section('diagnostics', diagnosticFields);
  const unavailable = document.createElement('p'); unavailable.className = 'hint v2-render-unavailable'; setText(unavailable, ui.unavailable); panel.bodies.diagnostics.append(unavailable);
  const legend = document.createElement('p'); legend.className = 'hint v2-diagnostic-legend'; panel.bodies.diagnostics.append(legend);
  const legendFr: Record<string, string> = {
    'res-geology': 'Roche : granite rose, calcaire crème, grès ocre, marne olive, basalte gris sombre, métamorphique violet, ultrabasique vert, évaporite blanc-bleu.',
    'res-soil-depth': 'Profondeur du sol, de 0 à 3 m : sable clair → brun sombre.', 'res-moisture': 'Indice d’humidité du sol, de 0 à 1 : sable → bleu profond.',
    'res-drainage': 'Classe de drainage : très mauvais (bleu sombre), mauvais, modéré, bien drainé (sable).', 'res-alluvial': 'Part d’alluvions du sol, de 0 à 1 : transparent → ocre.',
    'res-potential': 'Potentiel de la ressource, de 0 à 1 (choisie ci-dessous) : transparent → jaune → vert sombre.',
    'res-deposits': 'Petits gisements (disque = minerai récupérable) et ancres d’activité (losanges), colorés par famille ou type.',
    'res-sites': 'Sites d’activité colorés par catégorie (extraction, énergie, eau, forêt, pastoral), reliés au lieu parent par un trait fin ; nœuds du réseau (péages, bacs, auberges, postes frontières) en cercles cramoisis ; installations (fronts de carrière, haldes, biefs, pontons, enclos…) tracées par type de sol.',
  };
  const colors = mountRenderColorControls(panel, text, {
    getColors: () => bindings.getSettings().appearance?.colors,
    getStyle: () => { const a = renderControlValues(bindings.getSettings(), bindings.getWorld?.()); return a.renderer === 'classic' ? a.style : a.terrainStyle ?? a.style; },
    getPalette: () => { const s = bindings.getSettings(), a = renderControlValues(s, bindings.getWorld?.()); return a.renderer === 'classic' ? biomePalette(a.style, s.options.biome) : terrainStyle(a.terrainStyle ?? a.style).palette; },
    setColor: (key, value) => { writeAppearanceControl(bindings.getSettings(), `appearance.colors.${key}`, value); bindings.onChange(); },
  });
  // Captured once: the staged V2 chain relocates section bodies outside this panel.
  const styleSelect = root.querySelector<HTMLSelectElement>('[data-setting-path="appearance.terrainStyle"]')!;
  const diagnostic = root.querySelector<HTMLSelectElement>('[data-setting-path="appearance.diagnostic"]')!;
  const potentialField = root.querySelector<HTMLElement>('[data-setting-path="appearance.resourcePotential"]')!.closest<HTMLElement>('.parameter-field')!;
  bindTree(root);
  function sync(): void {
    for (const form of forms) form.sync();
    const settings = bindings.getSettings(), world = bindings.getWorld?.(), a = renderControlValues(settings, world);
    const bench = a.renderer === 'bench', style = a.terrainStyle ?? a.style;
    colors.sync();
    showIncompatibilities(root, resolveSettingsAppearance(settings, world, 'view2d'));
    const customized = appearanceCustomized(settings, world);
    for (const select of [styleSelect, ...(bindings.getStyleSelectors?.() ?? [])]) markStyleCustomized(select, customized);
    const traits = styleTraits(style);
    fantasy.hidden = !bench || !traits.fantasy; season.hidden = !bench || !traits.satelliteVariant;
    forest.hidden = !bench || !traits.ground3d;
    const capabilities = worldCapabilities(world);
    const waterEngine = capabilities.vectorWater ? 'vector' : capabilities.hydrology ? 'rust'
      : world ? 'none' : settings.terrain?.hydrology?.engine ?? 'rust';
    for (const option of Array.from(diagnostic.options)) option.disabled = !diagnosticAvailable(option.value, waterEngine);
    unavailable.hidden = diagnosticAvailable(a.diagnostic ?? 'none', waterEngine);
    const shown = a.diagnostic ?? 'none', resource = isResourceDiagnostic(shown);
    potentialField.hidden = shown !== 'res-potential';
    legend.hidden = !resource;
    if (resource) text(legend, RESOURCE_LEGENDS[shown], legendFr[shown]);
  }
  sync(); return { sync, dispose: () => { forms.forEach(form => form.dispose()); panel.dispose(); } };
}
