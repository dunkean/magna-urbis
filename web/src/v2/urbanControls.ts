import { organizeUrbanForm } from './advancedPanel';
import { urbanParameterHelp } from './urbanParameterHelp';
import { defaultCityLayoutConfig as defaultLayoutConfig } from '../render/cityGeneration';
import type { V2Settings, V2UrbanControls } from './contracts';
import type { HouseMix } from '../../../rust/bridge/urbanArchitecture';
import { SITE_ARCHETYPES, layoutFortification } from '../gen/options';
import { siteArchetypeNames } from './regionControls';
import { defaultParcelConfig } from '../../../rust/bridge/urbanConfig';
import type { CatalogueBundle, HouseConfig } from '../../../rust/bridge/housesContract';
import type { Options } from '../gen/types';
import { bindTree, registerMessages, setDynamicText, setText, translate, getLanguage, onLanguageChange } from './i18n';
import { mountParameterForm, readSettingPath, writeSettingPath, type ParameterForm } from './parameterForm';
import {
  houseControlDefaults,
  workshopControlDefaults,
  morphologyTemplate,
  urbanCatalogue,
  urbanChoiceNames,
  urbanControlFields,
  urbanField,
  urbanFieldNames,
  urbanName,
  urbanSectionNames,
  URBAN_ZONES,
  ROOF_SYSTEM_NAMES,
  catalogueIdName,
  type UrbanParameterField,
  type UrbanControlSection,
} from './urbanControlSchema';
import { massingRoofs } from '../../../rust/bridge/urbanHouseEdits';
import { editorMessages } from './localeEditor';
import './urbanControls.css';
import { mountMixEditor, mountStyleSheetEditor, type UrbanZone } from './styleMixEditor';
import type { StyleFacet, StyleMix } from '../../../rust/bridge/urbanConfig';
import { CITY_ARCHITECTURES, DEFAULT_CITY_ARCHITECTURE, cityArchitectureOf, type CityArchitecture } from '../render/cityContract';
import { mergeHouseEdits, type HouseEditConfig } from '../../../rust/bridge/urbanHouseEdits';
import { culturalChoice } from '../../../rust/bridge/culturalChoices';
import { resetUrbanChildren, urbanParentControls } from './generationEdits';
import { compatibleBuildingTypes } from './urbanEditOptions';
import { housePackLabel, houseMaterialLabel, houseArchetypeLabel } from '../ui/houseCatalogueLocale';

const architectureNames: Record<CityArchitecture, string> = { silhouette: 'City volumes', compact: 'Compact plans (houses generator)', detailed: 'Detailed houses (houses generator)' };
const houseCatalogues = new Map<string, Promise<CatalogueBundle>>();

export type UrbanControlScope =
  | { kind: 'global' }
  | { kind: 'settlement'; key: string; defaults?: Partial<Options> }
  | { kind: 'quarter' | 'block' | 'parcel'; key: string; id: string; quarter?: string; block?: string; defaults?: Record<string, unknown> }
  | { kind: 'building'; key: string; id: string; quarter?: string; block?: string; parcel?: string; defaults?: HouseEditConfig };
export interface UrbanControls {
  sync(): void;
  dispose(): void;
}
export type UrbanControlExtra = 'header' | 'phases' | 'mixtures' | 'archetypes' | 'catalogue';
/** A subset of the form, so the staged V2 chain can place each native section in its own stage row. */
export interface UrbanControlParts {
  sections?: readonly string[];
  extras?: readonly UrbanControlExtra[];
  targets?: () => readonly string[];
  placeDefaults?: (key: string) => Partial<Options> | undefined;
  disabled?: () => boolean;
  /** The inspector owns one reset action, next to its regenerate action. */
  hideReset?: boolean;
}
// Plain JSON-like values are copied by hand: the forms merge thousands of small leaves while they
// mount, and one structuredClone call per leaf was 1.3 s of the page's start-up at 4x CPU throttling.
const clone = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (Object.getPrototypeOf(value) !== Object.prototype) return structuredClone(value);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = clone(item);
  return out as T;
};
let effectiveMemo: { settings?: V2Settings; values: Map<string, Record<string, unknown>> } | undefined;
/** The stage forms of one panel read the same effective values: inside a batch each scope is resolved once
 * (settings are not edited while the forms sync). */
export function batchUrbanSync(run: () => void): void {
  if (effectiveMemo) {
    run();
    return;
  }
  effectiveMemo = { values: new Map() };
  try {
    run();
  } finally {
    effectiveMemo = undefined;
  }
}
function memoEffectiveValues(settings: V2Settings, scope: UrbanControlScope): Record<string, unknown> {
  if (!effectiveMemo) return urbanEffectiveValues(settings, scope);
  if (effectiveMemo.settings !== settings) effectiveMemo = { settings, values: new Map() };
  const key = JSON.stringify(scope);
  let values = effectiveMemo.values.get(key);
  if (!values) effectiveMemo.values.set(key, (values = urbanEffectiveValues(settings, scope)));
  return values;
}
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function mergeUrbanControlValues(...sources: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const source of sources) if (isObject(source)) for (const [key, value] of Object.entries(source)) out[key] = isObject(value) ? mergeUrbanControlValues(out[key], value) : clone(value);
  return out;
}
function cityControls(settings: V2Settings, key?: string, create = false): V2UrbanControls {
  if (create) settings.urban ??= { backend: settings.runtime?.backend ?? 'rust' };
  if (!key) return settings.urban ?? {};
  if (create) {
    settings.urban!.local ??= {};
    settings.urban!.local[key] ??= {};
  }
  return settings.urban?.local?.[key] ?? {};
}
/** Scope keys are kept as literal object keys; native ids may contain slashes and dots. */
export function urbanScopeValues(settings: V2Settings, scope: UrbanControlScope = { kind: 'global' }, create = false): Record<string, unknown> {
  if (scope.kind === 'global' || scope.kind === 'settlement') return cityControls(settings, scope.kind === 'settlement' ? scope.key : undefined, create) as unknown as Record<string, unknown>;
  if (scope.kind === 'building') {
    if (create) {
      settings.urban ??= { backend: settings.runtime?.backend ?? 'rust' };
      settings.urban.buildings ??= {};
      settings.urban.buildings[`${scope.key}/${scope.id}`] ??= {};
    }
    return (settings.urban?.buildings?.[`${scope.key}/${scope.id}`] as Record<string, unknown>) ?? {};
  }
  const controls = cityControls(settings, scope.key, create) as unknown as Record<string, any>;
  const stage = scope.kind === 'quarter' ? 'layout' : 'parcels',
    collection = scope.kind === 'quarter' ? 'quarters' : scope.kind === 'block' ? 'blocks' : 'parcels';
  if (create) {
    controls[stage] ??= {};
    controls[stage].overrides ??= {};
    controls[stage].overrides[collection] ??= {};
    controls[stage].overrides[collection][scope.id] ??= {};
  }
  return controls[stage]?.overrides?.[collection]?.[scope.id] ?? {};
}
function nativeDefaults(settings: V2Settings, key?: string, place?: Partial<Options>): Record<string, unknown> {
  const options = { ...settings.options, ...place, ...(key ? settings.local[key] : {}) };
  return {
    through: 'buildings',
    architecture: DEFAULT_CITY_ARCHITECTURE,
    layout: mergeUrbanControlValues(defaultLayoutConfig(), {
      culture: options.culture,
      density: 1 / (options.sprawl ?? 1),
      radiusScale: Math.sqrt(options.sprawl ?? 1),
      ...layoutFortification(options),
      suburbs: options.suburbs === 'some' ? 'few' : options.suburbs,
      ...(options.cultureMix ? { mixCulture: options.cultureMix.id, mixMode: options.cultureMix.mode, mixShare: options.cultureMix.t } : {}),
    }),
    parcels: mergeUrbanControlValues(defaultParcelConfig(), { culture: options.culture }),
    houses: {},
  };
}
/** Inheritance reads the three native products only. The global urban record
 * also owns every settlement/house patch; cloning that unrelated database on
 * each keystroke makes large projects needlessly expensive. */
function controlProducts(controls: V2UrbanControls | undefined): Record<string, unknown> {
  return {
    ...(controls?.through ? { through: controls.through } : {}),
    ...(controls?.architecture ? { architecture: controls.architecture } : {}),
    ...(controls?.layout ? { layout: controls.layout } : {}),
    ...(controls?.parcels ? { parcels: controls.parcels } : {}),
    ...(controls?.houses ? { houses: controls.houses } : {}),
  };
}
function morphologyDefaults(effective: Record<string, unknown>): Record<string, unknown> {
  const out = clone(effective);
  for (const [stage, kind] of [
    ['layout', 'quarters'],
    ['parcels', 'parcels'],
  ] as const) {
    const config = out[stage] as Record<string, unknown>,
      culture = urbanCatalogue.cultures[String(config.culture)];
    const recipe = culture?.recipes.find(r => r.id === config.recipe) ?? culture?.recipes[0];
    const preset = urbanCatalogue.presets[config.preset === 'culture' || !config.preset ? (recipe?.preset ?? 'morph/european-organic') : String(config.preset)];
    config.params = mergeUrbanControlValues(morphologyTemplate(kind), preset?.params, config.params);
  }
  const houses = out.houses as Record<string, unknown>;
  // Display source defaults without turning an automatic cultural model into a pinned template.
  houses.house_config = mergeUrbanControlValues(houseControlDefaults(), houses.house_config);
  return out;
}
/** Effective inherited values, without this scope's own patches. */
export function urbanInheritedValues(settings: V2Settings, scope: UrbanControlScope = { kind: 'global' }): Record<string, unknown> {
  if (scope.kind === 'global') return morphologyDefaults(nativeDefaults(settings));
  const city = morphologyDefaults(
    mergeUrbanControlValues(
      nativeDefaults(settings, scope.key, scope.kind === 'settlement' ? scope.defaults : undefined),
      controlProducts(urbanParentControls(settings.urban, settings.urban?.local?.[scope.key])),
      scope.kind === 'settlement' ? undefined : controlProducts(settings.urban?.local?.[scope.key]),
    ),
  );
  if (scope.kind === 'settlement') return city;
  const parentQuarter = scope.kind === 'quarter' ? undefined : scope.quarter;
  const quarterHouse = parentQuarter === undefined ? undefined : (city.layout as any).overrides?.quarters?.[parentQuarter]?.houseConfig;
  const blockHouse = scope.block === undefined || scope.kind === 'block' ? undefined : (city.parcels as any).overrides?.blocks?.[scope.block]?.houseConfig;
  const parentHouse = mergeHouseEdits(
    urbanParentControls(settings.urban, settings.urban?.local?.[scope.key])?.houses?.house_config,
    settings.urban?.local?.[scope.key]?.houses?.house_config,
    quarterHouse,
    blockHouse,
    scope.kind === 'building' && scope.parcel ? (city.parcels as any).overrides?.parcels?.[scope.parcel]?.houseConfig : undefined,
  );
  if (scope.kind === 'building') return mergeUrbanControlValues(houseControlDefaults(), scope.defaults, parentHouse);
  const layout = city.layout as Record<string, unknown>;
  const quarter = parentQuarter === undefined ? undefined : (city.layout as any).overrides?.quarters?.[parentQuarter];
  const block = scope.block === undefined ? undefined : (city.parcels as any).overrides?.blocks?.[scope.block];
  const culture = block?.culture ?? quarter?.culture ?? layout.culture;
  return mergeUrbanControlValues(
    scope.kind === 'quarter'
      ? { culture: layout.culture, tissue: layout.tissue, density: layout.density, wealth: 0.5, role: 'auto', deleted: false, salt: 0 }
      : scope.kind === 'block'
        ? { culture, density: quarter?.density ?? layout.density, operator: (city.parcels as any).operator, salt: 0 }
        : { salt: 0, culture, function: 'auto', role: 'auto' },
    { houseConfig: mergeHouseEdits(houseControlDefaults(), parentHouse) },
    scope.defaults,
  );
}
export function urbanEffectiveValues(settings: V2Settings, scope: UrbanControlScope = { kind: 'global' }): Record<string, unknown> {
  if (scope.kind === 'global' || scope.kind === 'settlement')
    return morphologyDefaults(
      mergeUrbanControlValues(
        nativeDefaults(settings, scope.kind === 'settlement' ? scope.key : undefined, scope.kind === 'settlement' ? scope.defaults : undefined),
        controlProducts(urbanParentControls(settings.urban, scope.kind === 'global' ? undefined : settings.urban?.local?.[scope.key])),
        scope.kind === 'settlement' ? controlProducts(settings.urban?.local?.[scope.key]) : undefined,
      ),
    );
  return mergeUrbanControlValues(urbanInheritedValues(settings, scope), urbanScopeValues(settings, scope));
}
function prune(value: Record<string, unknown>): void {
  for (const [key, child] of Object.entries(value))
    if (isObject(child)) {
      prune(child);
      if (!Object.keys(child).length) delete value[key];
    }
}
/** Arrays are native atomic ranges. A single endpoint edit copies its effective other endpoint;
 * it never sends a sparse array or silently changes a cultural range to [0, value]. */
export function writeUrbanControl(settings: V2Settings, scope: UrbanControlScope, path: string, value: unknown): void {
  resetUrbanChildren(settings, scope, path);
  const root = urbanScopeValues(settings, scope, true),
    inherited = urbanInheritedValues(settings, scope);
  // Culture is the whole area's identity. An old pinned model must not survive
  // a deliberate culture change; rendering complexity/textures live elsewhere.
  if (path === 'culture' && ['quarter', 'block', 'parcel'].includes(scope.kind)) {
    delete root.houseConfig;
    if (scope.kind === 'quarter') {
      delete root.buildingCulture;
      if (value === undefined) delete root.tissue;
      else root.tissue = 'culture';
    }
    if (scope.kind === 'block') {
      if (value === undefined) delete root.operator;
      else root.operator = 'culture';
    }
  }
  // A house type and a roof belong to the old culture's pack; the new culture picks its own.
  if (path === 'culture' && scope.kind === 'building') {
    delete root.recipe;
    delete root.pack;
    if (isObject(root.overrides)) {
      delete root.overrides.roof;
      delete root.overrides.variant;
    }
  }
  // A pinned house type is a model of the building's current pack.
  if (path === 'recipe' && scope.kind === 'building' && value !== undefined) root.pack = readSettingPath(inherited, 'pack');
  if (path === 'role' && (scope.kind === 'parcel' || scope.kind === 'block')) {
    delete root.function;
    delete root.households;
    delete root.houseConfig;
  }
  if (path === 'function' && scope.kind === 'parcel') delete root.role;
  const keys = path.split('.'),
    arrayAt = keys.findIndex(k => /^\d+$/.test(k));
  if (value !== undefined && scope.kind !== 'building' && path.startsWith('houses.house_config.')) {
    const houses = (root.houses as Record<string, unknown>) ?? ((root.houses = {}) as Record<string, unknown>);
    houses.house_config ??= clone(readSettingPath(inherited, 'houses.house_config') ?? houseControlDefaults());
  }
  const workshopPath = scope.kind === 'building' ? 'workshop' : scope.kind === 'quarter' || scope.kind === 'block' || scope.kind === 'parcel' ? 'houseConfig.workshop' : 'houses.house_config.workshop';
  // Support is a complete native catalogue record (unlike optional house
  // overrides); clearing its required kind restores the inherited/native kind.
  if (value === undefined && path === `${workshopPath}.support.kind` && readSettingPath(root, workshopPath)) value = readSettingPath(inherited, path) ?? 'ground';
  if (value !== undefined && path.startsWith(`${workshopPath}.`)) {
    if (!isObject(readSettingPath(root, workshopPath))) writeSettingPath(root, workshopPath, clone(readSettingPath(inherited, workshopPath) ?? workshopControlDefaults()));
    if (path.startsWith(`${workshopPath}.support.`) && !isObject(readSettingPath(root, `${workshopPath}.support`)))
      writeSettingPath(root, `${workshopPath}.support`, clone(readSettingPath(inherited, `${workshopPath}.support`) ?? { kind: 'ground', material: null, height_m: [0, 0] }));
  }
  if (arrayAt >= 0) {
    const arrayPath = keys.slice(0, arrayAt).join('.'),
      index = Number(keys[arrayAt]);
    const own = readSettingPath(root, arrayPath) as unknown[] | undefined;
    // Keep this scope's selected cultural preset while removing only this atomic range.
    if (own !== undefined) writeSettingPath(root, arrayPath, undefined);
    const base = (readSettingPath(urbanEffectiveValues(settings, scope), arrayPath) as unknown[] | undefined) ?? (arrayPath === `${workshopPath}.support.height_m` ? [0, 0] : undefined);
    if (own !== undefined) writeSettingPath(root, arrayPath, own);
    const values = clone(own ?? base ?? []);
    values[index] = value === undefined ? base?.[index] : value;
    if (values.some(v => v === undefined)) throw new Error('A native range requires every endpoint.');
    writeSettingPath(root, arrayPath, value === undefined && arrayPath !== `${workshopPath}.support.height_m` && JSON.stringify(values) === JSON.stringify(base) ? undefined : values);
  } else writeSettingPath(root, path, value);
  if (value !== undefined && (path === 'pack' || path === 'houseConfig.pack' || path === 'houses.house_config.pack')) {
    const prefix = path.slice(0, -4);
    writeSettingPath(root, `${prefix}recipe`, null);
    writeSettingPath(root, `${prefix}overrides.variant`, null);
  }
  prune(root);
}

const textMessages: Record<string, string> = {
  Block: 'Îlot',
  'Street pattern changes interior streets; boundary roads stay in place.': 'La trame refait les rues intérieures ; les routes qui bordent le quartier restent en place.',
  'Culture sets streets, parcels and buildings. Regenerate replaces descendant overrides.': 'La culture règle les rues, les parcelles et les bâtiments. Régénérer remplace les réglages des descendants.',
  'Separate building culture': 'Culture des bâtiments uniquement',
  'Optional: override architecture only. Culture above controls the whole area.': 'Facultatif : impose une culture aux bâtiments seulement. La culture principale règle toute la zone.',
  'Building templates and materials': 'Modèles de bâtiments et matériaux',
  'Culture selects suitable building templates and materials automatically. Override them below only for a specific architecture.': 'La culture choisit automatiquement les modèles de bâtiments et leurs matériaux. Ces réglages permettent d’imposer une architecture particulière.',
  'Loading building choices…': 'Chargement des modèles et matériaux…',
  'Retry loading building choices': 'Réessayer de charger les modèles',
  'Area purpose': 'Fonction du quartier',
  'Parcel use': 'Usage de la parcelle',
  'Building type': 'Type de bâtiment',
  'Changes the use of this parcel and regenerates its buildings.': 'Change l’usage de cette parcelle et régénère ses bâtiments.',
  'Automatic uses population, culture and nearby activities to choose a suitable use.': 'Le mode automatique choisit un usage selon la population, la culture et les activités voisines.',
  'Local random seed': 'Graine aléatoire locale',
  'Original seed': 'Graine d’origine',
  'The dice chooses a new seed for this area and regenerates its descendants.': 'Le dé choisit une nouvelle graine pour cette zone et régénère ses descendants.',
  'Different values': 'Valeurs différentes',
  'Changes apply on generation.': 'Les changements s’appliquent à la génération.',
  'Restore default settings': 'Rétablir les réglages par défaut',
  'Use cultural styles': 'Utiliser les styles culturels',
  'Inherited default': 'Valeur héritée',
  Enabled: 'Activé',
  Disabled: 'Désactivé',
  'Native automatic choice': 'Choix automatique natif',
  'Inherited from global settings. Every field can be overridden independently.': 'Hérité des réglages globaux. Chaque champ peut être modifié indépendamment.',
  'Empty fields inherit the cultural recipe. Changes apply on generation.': 'Les champs vides héritent de la recette culturelle. Les changements s’appliquent à la génération.',
  'Reset this scope': 'Réinitialiser ce périmètre',
  'Reset field': 'Réinitialiser le champ',
  Automatic: 'Automatique',
  'Effective value: {value}': 'Valeur effective : {value}',
  'Quarter and lot identifiers belong to this settlement. Native site constraints remain binding.': 'Les identifiants de quartiers et de lots appartiennent à ce lieu. Les contraintes natives du site restent impératives.',
  'Native refusal is reported when a model is incompatible with the culture, era, lot or slope.': 'Un refus natif est signalé si le modèle est incompatible avec la culture, l’époque, le lot ou la pente.',
  'Use a pinned native house model': 'Utiliser un modèle natif de maison imposé',
  'A pinned model uses its selected pack. Domestic lots from another pack can be refused; mixed styles can be set below.': 'Un modèle imposé utilise le pack choisi. Les lots domestiques d’un autre pack peuvent être refusés ; les styles mélangés se règlent ci-dessous.',
  'Urban placement sets one house request per lot, its seed and world orientation. Individual house seeds can be edited in the building inspector.':
    'L’implantation urbaine fixe une demande de maison par lot, sa graine et son orientation. Les graines individuelles se règlent dans l’inspecteur du bâtiment.',
  'The free workshop requires the fantasy historical policy and a fantasy house model. Dimensions stay exact.': 'L’atelier libre requiert la politique historique fantasy et un modèle de maison fantasy. Les dimensions restent exactes.',
  'Clear the free workshop': 'Supprimer l’atelier libre',
  'Load native architecture catalogue': 'Charger le catalogue architectural natif',
  'Loading native house catalogue…': 'Chargement du catalogue natif des maisons…',
  'Native catalogue ready': 'Catalogue natif prêt',
  'Catalogue unavailable: {error}': 'Catalogue indisponible : {error}',
  'Names, roles, resources and lore are identifiers used by the generator; resource lists accept commas or line breaks.':
    'Les noms, rôles, ressources et éléments de contexte sont des identifiants utilisés par le générateur ; les listes acceptent les virgules ou retours à la ligne.',
  'Cultural rules by growth zone': 'Règles culturelles par zone de croissance',
  'Mixed architectural styles': 'Styles architecturaux mélangés',
  'Whole settlement': 'Tout le lieu',
  'Inherit architecture styles': 'Hériter des styles architecturaux',
  'Add a style': 'Ajouter un style',
  'Remove style': 'Supprimer le style',
  'Quarter identifier': 'Identifiant de quartier',
  'Add quarter styles': 'Ajouter les styles du quartier',
  'Native outline coordinates (metres)': 'Coordonnées du contour natif (mètres)',
  'Outer boundary': 'Contour extérieur',
  Hole: 'Trou',
  'Add vertex': 'Ajouter un sommet',
  'Remove vertex': 'Supprimer le sommet',
  'Add hole': 'Ajouter un trou',
  'Remove hole': 'Supprimer le trou',
  'Clear outline override': 'Supprimer la modification du contour',
  'At least three finite vertices per ring are required.': 'Chaque anneau requiert au moins trois sommets finis.',
  'Generate through': 'Générer jusqu’à',
  Architecture: 'Architecture',
  'City volumes': 'Volumes de la ville',
  'Compact plans (houses generator)': 'Plans compacts (générateur houses)',
  'Detailed houses (houses generator)': 'Maisons détaillées (générateur houses)',
  Layout: 'Plan',
  Parcels: 'Parcelles',
  Programme: 'Programme',
  Buildings: 'Bâtiments',
  'Merge into neighbours': 'Fusionner avec les voisins',
  'Keep as a garden': 'Conserver en jardin',
  'Building style': 'Style des bâtiments',
  'House style': 'Style de la maison',
  'More local choices take priority. Reroll keeps the selected style.': 'Les choix les plus locaux sont prioritaires. Une nouvelle variation conserve le style choisi.',
  'Site archetypes by settlement identifier': 'Archétypes de site par identifiant de lieu',
  'Settlement identifier': 'Identifiant de lieu',
  'Add site rule': 'Ajouter une règle de site',
  'Remove site rule': 'Supprimer une règle de site',
};
registerMessages(editorMessages);
registerMessages(
  Object.fromEntries([
    ...Object.entries(textMessages).map(([en, fr]) => [en, { en, fr }] as const),
    ...Object.values(urbanFieldNames).map(([en, fr]) => [en, { en, fr }] as const),
    ...Object.values(urbanSectionNames).map(([en, fr]) => [en, { en, fr }] as const),
    ...Object.values(urbanChoiceNames).map(([en, fr]) => [en, { en, fr }] as const),
    ...Object.values(ROOF_SYSTEM_NAMES).map(([en, fr]) => [en, { en, fr }] as const),
  ]),
);
/** A titled block. Urban forms only show inside the advanced views (organizeUrbanForm), which have no further disclosure level. */
function section(root: HTMLElement, title: string): HTMLElement {
  const block = document.createElement('section');
  block.className = 'urban-control-section';
  const heading = document.createElement('h4');
  heading.className = 'urban-section-title';
  setText(heading, title);
  block.append(heading);
  root.append(block);
  return block;
}
/** Localized catalogue names; the raw ids stay the option values only. */
export function catalogueChoiceLabel(catalogue: Pick<CatalogueBundle['catalogue'], 'packs' | 'recipes' | 'materials'>, path: string, id: string): string {
  const language = getLanguage(),
    key = path.split('.').at(-1)!;
  if (key === 'pack') {
    const label = catalogue.packs.find(p => p.id === id)?.label;
    return housePackLabel(id, label ?? catalogueIdName(id), language);
  }
  if (key === 'recipe') {
    const label = catalogue.recipes.find(r => r.id === id)?.label;
    return houseArchetypeLabel(id, label ?? catalogueIdName(id), language);
  }
  if (key === 'roof') return translate(ROOF_SYSTEM_NAMES[id]?.[0] ?? catalogueIdName(id));
  const material = catalogue.materials.find(m => m.id === id)?.label;
  return material ? houseMaterialLabel(id, material, language) : urbanChoiceNames[id] ? translate(urbanChoiceNames[id][0]) : catalogueIdName(id);
}
function message(root: HTMLElement, source: string): HTMLElement {
  const p = document.createElement('small');
  setText(p, source);
  root.append(p);
  return p;
}
function button(root: HTMLElement, source: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  setText(b, source);
  b.onclick = onClick;
  root.append(b);
  return b;
}
/** Each editor level shows its few working choices first (quarter = culture, street plan, growth zone, density;
 * block = culture, density, parcelling; parcel = content and culture; house = culture, house type, roof, floors),
 * then an Advanced section with every other parameter the engine applies at that level: the house model fields
 * (pack, era, variant, materials, plan, courtyard, overhang, pitch…) read by the lot's building requests, plus
 * the level's own (district purpose and wealth, block building type, households, fence). The dice owns the seed. */
export function localFields(scope: UrbanControlScope): UrbanParameterField[] {
  const culture = (section: UrbanControlSection, help: string): UrbanParameterField => ({ ...urbanField('culture', '', section), help });
  const advanced = (field: UrbanParameterField): UrbanParameterField => ({ ...field, section: 'advanced' });
  // House model fields, at `houseConfig.*` below the settlement and directly on a building; main fields are not repeated.
  const houseFields = (prefix: string, skip: readonly string[] = []) =>
    urbanControlFields()
      .filter(f => f.section === 'house' && !skip.includes(f.path.replace('houses.house_config.', '')))
      .map(f => advanced({ ...f, path: f.path.replace('houses.house_config.', prefix) }));
  const fence: UrbanParameterField = {
    path: 'enclosure',
    section: 'advanced',
    label: 'Fence',
    type: 'select',
    optional: true,
    options: [
      { value: 'none', label: 'No fence' },
      { value: 'fence', label: 'Wooden fence' },
      { value: 'hedge', label: 'Hedge' },
      { value: 'wall', label: 'Stone wall' },
    ],
    help: 'Boundary of this lot and its house yard. Applied on Regenerate.',
    helpDisplay: 'tooltip',
  };
  if (scope.kind === 'quarter')
    return [
      culture('quarter', 'Culture sets streets, parcels and buildings. Regenerate replaces descendant overrides.'),
      { ...urbanField('tissue', 'culture', 'quarter'), label: 'Urban plan', help: 'Street pattern changes interior streets; boundary roads stay in place.' },
      {
        ...urbanField('zone', '', 'quarter'),
        options: urbanField('zone', '', 'quarter').options!.filter(o => o.value !== 'auto'),
        help: 'Core: narrow deep lots, continuous frontage, high coverage and the tallest buildings. Outer zones: wider lots with gardens and lower houses.',
      },
      { ...urbanField('density', 1, 'quarter'), help: 'Lot size and coverage in this quarter, around its zone: above 1 smaller lots and more built, below 1 larger lots and gardens.' },
      advanced(urbanField('role', '', 'quarter')),
      advanced({ ...urbanField('wealth', 0.5, 'quarter'), max: 1 }),
      advanced({ ...urbanField('culture', '', 'house'), path: 'buildingCulture', label: 'Separate building culture', help: 'Optional: override architecture only. Culture above controls the whole area.' }),
      ...houseFields('houseConfig.'),
    ];
  if (scope.kind === 'block')
    return [
      culture('block', 'Culture of the lots and buildings of this block.'),
      { ...urbanField('density', 1, 'block'), help: 'More or fewer lots in this block.' },
      { ...urbanField('operator', 'culture', 'block'), help: 'How the block is cut into lots.' },
      advanced({ ...urbanField('role', '', 'parcel'), help: 'Building type of every lot of this block; a lot’s own content wins.' }),
      ...houseFields('houseConfig.'),
    ];
  if (scope.kind === 'parcel')
    return [
      { ...urbanField('role', '', 'parcel'), label: 'Parcel content', help: 'Any building type can be chosen; this culture’s types come first. Regenerate rebuilds the lot with the chosen use.' },
      culture('parcel', 'Architecture of the buildings of this lot.'),
      { ...fence, section: 'parcel' },
      advanced({ ...urbanField('households', 1, 'parcel'), step: 1, help: 'Households lodged on this lot (housing only).' }),
      ...houseFields('houseConfig.'),
    ];
  if (scope.kind === 'building')
    return [
      culture('building', 'Architecture of this building. Changing it resets the house type and roof.'),
      { ...urbanField('recipe', '', 'building'), path: 'recipe', label: 'House type', type: 'select', options: [], help: 'Building models of this culture’s architectural pack.' },
      {
        ...urbanField('roof', '', 'building'),
        path: 'overrides.roof',
        type: 'select',
        options: Object.entries(ROOF_SYSTEM_NAMES)
          .filter(([id]) => id !== 'RF-CONICAL')
          .map(([value, [label]]) => ({ value, label })),
      },
      { ...urbanField('floors', null, 'building'), path: 'overrides.floors', min: 1, max: 40 },
      ...houseFields('', ['recipe', 'overrides.roof', 'overrides.floors']),
    ];
  return urbanControlFields();
}

/** Shared native City Bench controls at world, settlement, quarter, lot and individual-house levels.
 * Deliberately returns a stable form: sync updates values and inheritance without replacing controls. */
export function mountUrbanControls(root: HTMLElement, getSettings: () => V2Settings, changed: () => void, scope: UrbanControlScope = { kind: 'global' }, parts?: UrbanControlParts): UrbanControls {
  const extra = (name: UrbanControlExtra) => !parts?.extras || parts.extras.includes(name);
  root.classList.add('v2-urban-controls');
  root.dataset.controlScope = scope.kind;
  const forms: ParameterForm[] = [],
    effects: (() => void)[] = [];
  const fields = localFields(scope),
    global = scope.kind === 'global' || scope.kind === 'settlement';
  const scopeId = scope.kind === 'global' ? 'global' : `${scope.kind}-${scope.key}-${'id' in scope ? scope.id : ''}`.replace(/[^a-z0-9-]/gi, '-');
  const scopes = (): UrbanControlScope[] => {
    const keys = scope.kind === 'global' ? parts?.targets?.() : undefined;
    return keys?.length ? [...new Set(keys)].map(key => ({ kind: 'settlement' as const, key, defaults: parts?.placeDefaults?.(key) })) : [scope];
  };
  const own = () => urbanScopeValues(getSettings(), scopes()[0]),
    inherited = () => urbanInheritedValues(getSettings(), scopes()[0]);
  let effectiveCache: Record<string, unknown>[] = [];
  const values = () => (effectiveCache.length ? effectiveCache : scopes().map(s => urbanEffectiveValues(getSettings(), s)));
  function resolvedChoice(path: string, raw: unknown, value = values()[0], target = scopes()[0]) {
    if (raw !== 'culture' && raw !== 'site') return undefined;
    const settings = getSettings(),
      defaults = target.kind === 'settlement' ? target.defaults : undefined;
    const local = target.kind === 'global' ? undefined : settings.local[target.key];
    const fallback = local?.culture ?? defaults?.culture ?? settings.options.culture;
    const zone = path.match(/(?:phaseOverrides|zoneOperators)\.([^.]+)/)?.[1];
    const stage = path.startsWith('parcels.') ? 'parcels' : 'layout';
    const config = (readSettingPath(value, stage) as Record<string, unknown> | undefined) ?? value;
    const phase = zone ? (readSettingPath(value, `layout.phaseOverrides.${zone}`) as Record<string, unknown> | undefined) : undefined;
    const chosen = phase?.culture || config.culture;
    const culture = typeof chosen === 'string' && chosen && chosen !== 'site' ? chosen : fallback;
    const key = path.includes('.zoneOperators.') ? 'operator' : path.split('.').at(-1)!;
    const resolved =
      key === 'culture'
        ? culture
        : culturalChoice(culture, key, {
            population: local?.population ?? defaults?.population ?? settings.options.population,
            phases: Number(readSettingPath(value, 'layout.phases') ?? 0),
            zone,
            recipe: String(phase?.recipe || config.recipe || 'auto'),
            preset: String(config.preset || 'culture'),
            params: zone ? undefined : (config.params as Record<string, unknown> | undefined),
          });
    return resolved ? { value: resolved, label: urbanChoiceNames[resolved]?.[0] ?? urbanCatalogue.presets[resolved]?.label ?? urbanCatalogue.cultures[resolved]?.label ?? resolved } : undefined;
  }
  const isMixed = (path: string) => {
    const all = values(),
      targets = scopes();
    const key = (value: Record<string, unknown>, i: number) => {
      const raw = readSettingPath(value, path);
      return JSON.stringify([raw, resolvedChoice(path, raw, value, targets[i])?.value]);
    };
    const first = key(all[0], 0);
    return all.slice(1).some((value, i) => key(value, i + 1) !== first);
  };
  const effective = (path: string) => (isMixed(path) ? undefined : readSettingPath(values()[0], path));
  const set = (path: string, value: unknown) => {
    for (const target of scopes()) {
      const baseline = readSettingPath(urbanInheritedValues(getSettings(), target), path);
      writeUrbanControl(getSettings(), target, path, JSON.stringify(value) === JSON.stringify(baseline) ? undefined : value);
    }
    changed();
    sync();
  };
  if (extra('header') && !parts?.hideReset) {
    message(root, 'Changes apply on generation.');
    button(root, 'Restore default settings', () => {
      for (const target of scopes()) {
        const settings = getSettings(),
          values = urbanScopeValues(settings, target);
        if (target.kind === 'global') {
          delete values.seed;
          delete values.seeds;
          delete values.layout;
          delete values.parcels;
          delete values.houses;
          delete values.through;
          delete values.local;
          delete values.buildings;
        } else for (const key of Object.keys(values)) delete values[key];
      }
      changed();
      sync();
    }).className = 'quiet small urban-reset';
    if (global) {
      const stageRoot = document.createElement('div');
      root.append(stageRoot);
      forms.push(
        mountParameterForm(
          stageRoot,
          [
            { path: 'through', label: 'Generate through', help: urbanParameterHelp.through, helpDisplay: 'tooltip', type: 'select', options: ['layout', 'parcels', 'programme', 'buildings'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })) },
            ...(scope.kind === 'global'
              ? [{ path: 'architecture', label: 'Architecture', help: urbanParameterHelp.architecture, helpDisplay: 'tooltip' as const, type: 'select' as const, options: CITY_ARCHITECTURES.map(value => ({ value, label: architectureNames[value] })) }]
              : []),
          ],
          { getValue: effective, isMixed, setValue: set, disabled: parts?.disabled },
        ),
      );
    }
  }
  let modelEnabled: HTMLInputElement | undefined,
    loadedCatalogue: CatalogueBundle | undefined,
    catalogueValuesKey = '';
  effects.push(() => {
    if (loadedCatalogue) populateCatalogue(loadedCatalogue);
  });
  for (const [key, names] of Object.entries(urbanSectionNames)) {
    if (parts?.sections && !parts.sections.includes(key)) continue;
    const members = fields.filter(f => f.section === key);
    if (!members.length) continue;
    const details = section(root, names[0]);
    details.dataset.section = key;
    if (key === 'house' && global) {
      const label = document.createElement('label');
      label.className = 'urban-model-switch';
      modelEnabled = document.createElement('input');
      modelEnabled.type = 'checkbox';
      modelEnabled.dataset.houseModel = '';
      const span = document.createElement('span');
      setText(span, 'Use a pinned native house model');
      label.append(modelEnabled, span);
      details.append(label);
      for (const target of [span, modelEnabled]) {
        target.title = translate(urbanParameterHelp.pinnedModel);
        target.setAttribute('data-i18n-title', urbanParameterHelp.pinnedModel);
      }
      modelEnabled.onchange = () => set('houses.house_config', modelEnabled!.checked ? clone(readSettingPath(inherited(), 'houses.house_config') ?? houseControlDefaults()) : undefined);
      effects.push(() => {
        const pins = scopes().map(target => {
          const model = readSettingPath(urbanScopeValues(getSettings(), target), 'houses.house_config');
          return model !== undefined ? !!model : target.kind === 'settlement' && !!getSettings().urban?.houses?.house_config;
        });
        modelEnabled!.checked = pins[0];
        modelEnabled!.indeterminate = pins.some(pin => pin !== pins[0]);
      });
      message(details, 'A pinned model uses its selected pack. Domestic lots from another pack can be refused; mixed styles can be set below.');
      message(details, 'Urban placement sets one house request per lot, its seed and world orientation. Individual house seeds can be edited in the building inspector.');
    }
    if (key === 'house' && !global) message(details, 'More local choices take priority. Reroll keeps the selected style.');
    if (key === 'workshop') {
      message(details, 'The free workshop requires the fantasy historical policy and a fantasy house model. Dimensions stay exact.');
      button(details, 'Clear the free workshop', () => set(scope.kind === 'building' ? 'workshop' : !global ? 'houseConfig.workshop' : 'houses.house_config.workshop', undefined));
    }
    const body = document.createElement('div');
    details.append(body);
    const decorated = members.map(field => {
      const fieldLabel = field.label,
        keyName = field.path
          .split('.')
          .filter(k => !/^\d+$/.test(k))
          .at(-1)!;
      if (!Object.values(urbanFieldNames).some(pair => pair[0] === fieldLabel)) {
        const basic = urbanName(field.path.includes('.params.') ? field.path.split('.params.')[1].split('.')[0] : keyName),
          suffix = fieldLabel.slice(basic[0].length);
        if (fieldLabel.startsWith(basic[0]))
          registerMessages({
            [fieldLabel]: {
              en: fieldLabel,
              fr:
                basic[1] +
                suffix
                  .replace(/Core/g, 'Cœur')
                  .replace(/Middle/g, 'Extension')
                  .replace(/Edge/g, 'Périphérie'),
            },
          });
      }
      const next = { ...field, placeholder: field.placeholder ?? (field.type === 'number' ? 'From culture' : undefined), emptyLabel: 'From culture', id: `urban-${scopeId}-${field.path.replace(/[^a-z0-9]/gi, '-')}` };
      if (field.path.endsWith('.resources') || field.path.endsWith('.lore')) {
        next.toInput = value => (Array.isArray(value) ? value.join(', ') : value);
        next.fromInput = value =>
          String(value)
            .split(/[,\n]/)
            .map(s => s.trim())
            .filter(Boolean);
      }
      if (field.path === 'houses.culture') next.options = field.options?.filter(o => o.value !== 'site');
      if (!global && (field.path === 'buildingCulture' || (field.path === 'culture' && scope.kind !== 'quarter'))) next.options = field.options?.filter(o => o.value !== 'site');
      return next;
    });
    const form = mountParameterForm(body, decorated, {
      getValue: effective,
      isMixed,
      automaticChoice: resolvedChoice,
      setValue: set,
      choices: path =>
        path === 'role' && (scope.kind === 'parcel' || scope.kind === 'block')
          ? compatibleBuildingTypes({
              culture: String(effective('culture') ?? getSettings().options.culture),
              fallbackCulture: getSettings().options.culture,
              current: readSettingPath(inherited(), 'role') as string | undefined,
              area: Number(effective(scope.kind === 'block' && effective('operator') === 'wholeBlock' ? 'blockArea' : 'area')),
              architecture: getSettings().urban?.architecture,
              pack: String(effective('houseConfig.pack') ?? ''),
              mode: String(effective('historicalMode') ?? 'inspired'),
              period: String(effective('period') ?? ''),
              navigableAccess: effective('navigableAccess') === true,
            })
          : undefined,
      disabled: () => !!parts?.disabled?.() || (global && (key === 'house' || key === 'workshop') && !modelEnabled?.checked),
    });
    forms.push(form);
    if (key === 'programme') message(details, 'Names, roles, resources and lore are identifiers used by the generator; resource lists accept commas or line breaks.');
  }
  if (global) {
    if (extra('phases')) {
      mountPhaseControls();
      mountStyleSheet();
    }
    if (extra('mixtures')) mountHouseMixtures();
    if (extra('archetypes')) mountSiteArchetypes();
  }
  if (scope.kind === 'parcel')
    effects.push(() => {
      const field = root.querySelector<HTMLElement>('[data-field-path="households"]');
      if (field) {
        const role = String(effective('role') ?? 'auto');
        field.hidden = role !== 'auto' && !role.startsWith('dwelling');
      }
    });
  if (extra('catalogue') && (global || scope.kind === 'building')) mountCatalogue();
  function sync(): void {
    root.inert = !!parts?.disabled?.();
    effectiveCache = scopes().map(s => memoEffectiveValues(getSettings(), s));
    effects.forEach(effect => effect());
    forms.forEach(form => form.sync());
  }
  function mountPhaseControls(): void {
    const box = section(root, 'Cultural rules by growth zone');
    for (const zone of URBAN_ZONES) {
      const heading = document.createElement('h4');
      setText(heading, zone[0].toUpperCase() + zone.slice(1));
      box.append(heading);
      const body = document.createElement('div');
      box.append(body);
      const fields = ['culture', 'tissue', 'recipe'].map(key => urbanField(`layout.phaseOverrides.${zone}.${key}`, key === 'tissue' ? 'culture' : '', 'growth'));
      fields.push({ ...urbanField(`parcels.zoneOperators.${zone}`, 'culture', 'parcels'), label: 'Parcel operator', type: 'select', options: urbanControlFields().find(f => f.path === 'parcels.operator')!.options });
      forms.push(
        mountParameterForm(
          body,
          fields.map(f => ({ ...f, emptyLabel: 'Automatic', id: `urban-${scopeId}-${f.path.replaceAll('.', '-')}` })),
          { getValue: path => effective(path) ?? effective(path.startsWith('parcels.') ? 'parcels.operator' : `layout.${path.split('.').at(-1)}`), isMixed, automaticChoice: resolvedChoice, setValue: set },
        ),
      );
    }
  }
  /** The style sheet of hybrid cities (`layout.styleSheet`), next to the cultural rules by growth zone. */
  function mountStyleSheet(): void {
    const mixPath = (facet: StyleFacet, zone?: UrbanZone) => `layout.styleSheet.${facet}.${zone ? `zones.${zone}` : 'city'}`;
    const editor = mountStyleSheetEditor(root, {
      getMix: (facet, zone) => effective(mixPath(facet, zone)) as StyleMix | undefined,
      setMix: (facet, zone, mix) => set(mixPath(facet, zone), mix),
      defaultCulture: () => getSettings().options.culture,
      path: 'layout.styleSheet',
      flat: true,
    });
    effects.push(editor.sync);
  }
  function mountHouseMixtures(): void {
    const box = section(root, 'Mixed architectural styles');
    const mountMix = (path: string, title: string): void => {
      const editor = mountMixEditor(section(box, title), {
        get: () => effective(path) as HouseMix | undefined,
        set: mix => set(path, mix),
        defaultCulture: () => getSettings().options.culture,
        path,
        labels: { add: 'Add a style', remove: 'Remove style', reset: 'Use cultural styles' },
      });
      effects.push(editor.sync);
    };
    mountMix('houses.houses.city', 'Whole settlement');
    for (const zone of URBAN_ZONES) mountMix(`houses.houses.zones.${zone}`, zone[0].toUpperCase() + zone.slice(1));
    const quarters = new Set<string>(Object.keys((effective('houses.houses.quarters') as object) ?? {}));
    for (const id of quarters) mountMix(`houses.houses.quarters.${id}`, `${translate('Quarter')} ${id}`);
    const quarter = document.createElement('input');
    quarter.placeholder = translate('Quarter identifier');
    quarter.setAttribute('aria-label', translate('Quarter identifier'));
    box.append(quarter);
    quarter.title = translate(urbanParameterHelp.quarterIdentifier);
    quarter.setAttribute('data-i18n-title', urbanParameterHelp.quarterIdentifier);
    button(box, 'Add quarter styles', () => {
      const id = quarter.value.trim();
      if (!id || quarters.has(id) || /[.]/.test(id)) return;
      quarters.add(id);
      mountMix(`houses.houses.quarters.${id}`, `${translate('Quarter')} ${id}`);
      sync();
    });
  }
  function mountSiteArchetypes(): void {
    const box = section(root, 'Site archetypes by settlement identifier'),
      rows = document.createElement('div');
    box.append(rows);
    let identity = '';
    effects.push(() => {
      const rules = (effective('layout.siteArchetypes') as Record<string, string>) ?? {},
        next = JSON.stringify(rules);
      if (next === identity) return;
      identity = next;
      rows.replaceChildren();
      for (const [id, archetype] of Object.entries(rules)) {
        const row = document.createElement('label');
        row.className = 'urban-mix-row';
        const name = document.createElement('span');
        name.textContent = id;
        name.dataset.l10nKeep = '';
        const value = document.createElement('input');
        value.value = archetype;
        value.setAttribute('list', `urban-${scopeId}-archetypes`);
        value.dataset.settingPath = `layout.siteArchetypes[${id}]`;
        for (const target of [name, value]) {
          target.title = translate(urbanParameterHelp.siteArchetype);
          target.setAttribute('data-i18n-title', urbanParameterHelp.siteArchetype);
        }
        value.onchange = () => set('layout.siteArchetypes', { ...rules, [id]: value.value });
        row.append(name, value);
        button(row, 'Remove site rule', () => {
          const next = { ...rules };
          delete next[id];
          set('layout.siteArchetypes', next);
        });
        rows.append(row);
      }
    });
    const list = document.createElement('datalist');
    list.id = `urban-${scopeId}-archetypes`;
    for (const archetype of SITE_ARCHETYPES) {
      const option = new Option('', archetype);
      setText(option, siteArchetypeNames[archetype][0]);
      list.append(option);
    }
    box.append(list);
    const id = document.createElement('input');
    id.placeholder = translate('Settlement identifier');
    id.setAttribute('aria-label', 'Settlement identifier');
    box.append(id);
    id.title = translate(urbanParameterHelp.settlementIdentifier);
    id.setAttribute('data-i18n-title', urbanParameterHelp.settlementIdentifier);
    button(box, 'Add site rule', () => {
      if (!id.value.trim()) return;
      set('layout.siteArchetypes', { ...((effective('layout.siteArchetypes') as object) ?? {}), [id.value.trim()]: 'auto' });
      id.value = '';
    });
    button(box, 'Reset field', () => set('layout.siteArchetypes', undefined));
  }
  function mountCatalogue(): void {
    // Local scopes only read the catalogue to name the house types and roofs of one building.
    const box = global ? section(root, 'Building templates and materials') : root;
    if (global) message(box, 'Culture selects suitable building templates and materials automatically. Override them below only for a specific architecture.');
    const status = message(box, 'Loading building choices…');
    const load = button(box, 'Retry loading building choices', () => {
      load.disabled = true;
      root.setAttribute('aria-busy', 'true');
      setText(status, 'Loading building choices…');
      load.hidden = true;
      const settings = getSettings(),
        cacheKey = settings.urban?.backend === 'native' ? (settings.runtime?.localServer ?? 'http://127.0.0.1:8791') : 'wasm';
      let pending = houseCatalogues.get(cacheKey);
      if (!pending) {
        pending = import('../../../rust/bridge/houses').then(async houses => {
          const settings = getSettings(),
            runtime = settings.urban?.backend === 'native' ? { profile: 'local' as const, server: settings.runtime?.localServer ?? 'http://127.0.0.1:8791' } : undefined;
          return houses.parseHouseCatalogue(await houses.callHouses({ ticket: 1, kind: 'catalogue', runtime }));
        });
        houseCatalogues.set(cacheKey, pending);
        pending.catch(() => houseCatalogues.delete(cacheKey));
      }
      void pending
        .then(bundle => {
          if (!alive) return;
          loadedCatalogue = bundle;
          populateCatalogue(bundle);
          status.hidden = true;
        })
        .catch(error => {
          if (alive) {
            load.hidden = false;
            setDynamicText(status, () => translate('Catalogue unavailable: {error}').replace('{error}', String(error)));
          }
        })
        .finally(() => {
          if (alive) {
            load.disabled = false;
            root.removeAttribute('aria-busy');
          }
        });
    });
    if (!global)
      queueMicrotask(() => {
        if (alive) load.click();
      });
    else
      root.addEventListener('click', event => {
        if (!loadedCatalogue && !load.disabled && (event.target as Element).closest('.advanced-open')) load.click();
      });
  }
  function populateCatalogue(bundle: CatalogueBundle): void {
    const prefix = scope.kind === 'building' ? '' : !global ? 'houseConfig.' : 'houses.house_config.',
      catalogue = bundle.catalogue;
    const pack = effective(`${prefix}pack`),
      selected = effective(`${prefix}recipe`);
    const valuesKey = JSON.stringify([catalogue.catalogue_version, pack, selected, getLanguage()]);
    if (valuesKey === catalogueValuesKey) return;
    catalogueValuesKey = valuesKey;
    const recipes = catalogue.recipes.filter(recipe => !pack || recipe.pack_id === pack);
    const sources = recipes.filter(recipe => !selected || recipe.id === selected);
    const values: Record<string, string[]> = {
      pack: catalogue.packs.map(p => p.id),
      recipe: recipes.map(r => r.id),
      era: [...new Set(catalogue.packs.filter(p => !pack || p.id === pack).flatMap(p => p.eras))],
      'overrides.variant': [...new Set(sources.flatMap(r => r.variants.map(v => v.id)))],
      'overrides.footprint': [...new Set(sources.flatMap(r => [r.parameters.footprint_family, ...r.parameters.allowed_footprints]))],
      'overrides.roof': [...new Set(sources.flatMap(r => [r.parameters.roof_system, ...r.parameters.allowed_roofs, ...r.variants.map(v => v.parameters.roof_system)]))],
      'workshop.preset_id': catalogue.workshop_presets.map(p => p.id),
    };
    const materialRoles: Record<string, string[]> = { frame: ['frame', 'load_bearing'], infill: ['infill'], coating: ['coating'], cladding: ['cladding'], roof_frame: ['roof_frame', 'load_bearing'], base: ['base', 'floor'], material: ['support', 'load_bearing', 'frame', 'base'] };
    for (const slot of ['frame', 'infill', 'coating', 'cladding']) values[`overrides.${slot}`] = catalogue.materials.filter(m => m.roles.some(role => materialRoles[slot].includes(role))).map(m => m.id);
    for (const slot of ['roof_frame', 'base', 'material']) values[`workshop.${slot === 'material' ? 'support.material' : slot}`] = catalogue.materials.filter(m => m.roles.some(role => materialRoles[slot].includes(role))).map(m => m.id);
    values['workshop.footprint'] = values['overrides.footprint'];
    values['workshop.roof'] = values['overrides.roof'];
    for (const [path, suggestions] of Object.entries(values)) {
      const input = Array.from(root.querySelectorAll<HTMLSelectElement>('[data-setting-path]')).find(input => input.dataset.settingPath === `${prefix}${path}`);
      if (!input || input.tagName !== 'SELECT') continue;
      const current = input.value;
      const automatic = document.createElement('option');
      automatic.value = '';
      setText(automatic, 'From culture');
      input.replaceChildren(automatic);
      // City volumes apply only the roofs urban/massing.rs can raise on a retained footprint.
      const offered = path.endsWith('roof') && scope.kind === 'building' && cityArchitectureOf(getSettings().urban?.architecture) === 'silhouette' ? Object.keys(massingRoofs).filter(id => id !== 'RF-CONICAL') : suggestions;
      for (const suggestion of [...new Set(offered.filter(Boolean))]) {
        const option = new Option(catalogueChoiceLabel(catalogue, path, suggestion), suggestion);
        option.dataset.l10nKeep = '';
        input.append(option);
      }
      if (current && !Array.from(input.options).some(o => o.value === current)) {
        const option = new Option(catalogueChoiceLabel(catalogue, path, current), current);
        option.dataset.l10nKeep = '';
        input.append(option);
      }
      input.value = current;
    }
  }
  organizeUrbanForm(root);
  let alive = true;
  const offLanguage = onLanguageChange(sync);
  bindTree(root);
  sync();
  return {
    sync,
    dispose: () => {
      alive = false;
      offLanguage();
      forms.forEach(form => form.dispose());
      root.replaceChildren();
    },
  };
}
