import type { V2Settings, V2UrbanControls } from './contracts';
import type { HouseMix } from '../../../rust/bridge/urbanArchitecture';
import { SITE_ARCHETYPES } from '../gen/options';
import { defaultLayoutConfig, defaultParcelConfig } from '../../../rust/bridge/urbanConfig';
import type { CatalogueBundle, HouseConfig } from '../../../rust/bridge/housesContract';
import { bindTree, registerMessages, setDynamicText, setText, translate } from './i18n';
import { mountParameterForm, readSettingPath, writeSettingPath, type ParameterForm } from './parameterForm';
import { houseControlDefaults, workshopControlDefaults, morphologyTemplate, urbanCatalogue, urbanChoiceNames, urbanControlFields, urbanField, urbanFieldNames, urbanName, urbanSectionNames, URBAN_ZONES, type UrbanParameterField } from './urbanControlSchema';
import './urbanControls.css';

export type UrbanControlScope =
  | { kind: 'global' }
  | { kind: 'settlement'; key: string }
  | { kind: 'quarter' | 'parcel'; key: string; id: string; defaults?: Record<string, unknown> }
  | { kind: 'building'; key: string; id: string; defaults?: Partial<HouseConfig> };
export interface UrbanControls { sync(): void; dispose(): void }
const clone = <T>(value: T): T => structuredClone(value);
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function mergeUrbanControlValues(...sources: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const source of sources) if (isObject(source)) for (const [key, value] of Object.entries(source)) out[key] = isObject(value) ? mergeUrbanControlValues(out[key], value) : clone(value);
  return out;
}
function cityControls(settings: V2Settings, key?: string, create = false): V2UrbanControls {
  if (create) settings.urban ??= { backend: settings.runtime?.backend ?? 'rust' };
  if (!key) return settings.urban ?? {};
  if (create) { settings.urban!.local ??= {}; settings.urban!.local[key] ??= {}; }
  return settings.urban?.local?.[key] ?? {};
}
/** Scope keys are kept as literal object keys; native ids may contain slashes and dots. */
export function urbanScopeValues(settings: V2Settings, scope: UrbanControlScope = { kind: 'global' }, create = false): Record<string, unknown> {
  if (scope.kind === 'global' || scope.kind === 'settlement') return cityControls(settings, scope.kind === 'settlement' ? scope.key : undefined, create) as unknown as Record<string, unknown>;
  if (scope.kind === 'building') {
    if (create) { settings.urban ??= { backend: settings.runtime?.backend ?? 'rust' }; settings.urban.buildings ??= {}; settings.urban.buildings[`${scope.key}/${scope.id}`] ??= {}; }
    return settings.urban?.buildings?.[`${scope.key}/${scope.id}`] as Record<string, unknown> ?? {};
  }
  const controls = cityControls(settings, scope.key, create) as unknown as Record<string, any>;
  const stage = scope.kind === 'quarter' ? 'layout' : 'parcels', collection = scope.kind === 'quarter' ? 'quarters' : 'parcels';
  if (create) { controls[stage] ??= {}; controls[stage].overrides ??= {}; controls[stage].overrides[collection] ??= {}; controls[stage].overrides[collection][scope.id] ??= {}; }
  return controls[stage]?.overrides?.[collection]?.[scope.id] ?? {};
}
function nativeDefaults(settings: V2Settings, key?: string): Record<string, unknown> {
  const options = { ...settings.options, ...(key ? settings.local[key] : {}) };
  return { layout: mergeUrbanControlValues(defaultLayoutConfig(), { culture: options.culture, density: 1 / (options.sprawl ?? 1), radiusScale: Math.sqrt(options.sprawl ?? 1),
    fortification: options.walls === 'none' || options.walls === 'no' ? 'none' : options.walls === 'auto' ? 'culture' : 'wall', suburbs: options.suburbs === 'some' ? 'few' : options.suburbs,
    ...(options.castle === 'yes' || Number(options.castles) > 0 ? { monument: 'castle' } : {}), ...(options.cathedral === 'yes' ? { monument: 'cathedral' } : {}), ...(options.palace === 'yes' ? { monument: 'palace' } : {}),
    ...(options.cultureMix ? { mixCulture: options.cultureMix.id, mixMode: options.cultureMix.mode, mixShare: options.cultureMix.t } : {}),
  }), parcels: mergeUrbanControlValues(defaultParcelConfig(), { culture: options.culture }), houses: {} };
}
/** Inheritance reads the three native products only. The global urban record
 * also owns every settlement/house patch; cloning that unrelated database on
 * each keystroke makes large projects needlessly expensive. */
function controlProducts(controls: V2UrbanControls | undefined): Record<string, unknown> {
  return { ...(controls?.layout ? { layout: controls.layout } : {}), ...(controls?.parcels ? { parcels: controls.parcels } : {}), ...(controls?.houses ? { houses: controls.houses } : {}) };
}
function morphologyDefaults(effective: Record<string, unknown>): Record<string, unknown> {
  const out = clone(effective);
  for (const [stage, kind] of [['layout', 'quarters'], ['parcels', 'parcels']] as const) {
    const config = out[stage] as Record<string, unknown>, culture = urbanCatalogue.cultures[String(config.culture)];
    const recipe = culture?.recipes.find(r => r.id === config.recipe) ?? culture?.recipes[0];
    const preset = urbanCatalogue.presets[config.preset === 'culture' || !config.preset ? recipe?.preset ?? 'morph/european-organic' : String(config.preset)];
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
  const city = morphologyDefaults(mergeUrbanControlValues(nativeDefaults(settings, scope.key), controlProducts(settings.urban), scope.kind === 'settlement' ? undefined : controlProducts(settings.urban?.local?.[scope.key])));
  if (scope.kind === 'settlement') return city;
  if (scope.kind === 'building') return mergeUrbanControlValues(houseControlDefaults(), (city.houses as Record<string, unknown>).house_config, scope.defaults);
  const layout = city.layout as Record<string, unknown>;
  return mergeUrbanControlValues(scope.kind === 'quarter' ? { culture: layout.culture, tissue: layout.tissue, density: layout.density, wealth: .5, role: 'auto', deleted: false } : { households: undefined, function: 'auto', role: 'auto' }, scope.defaults);
}
export function urbanEffectiveValues(settings: V2Settings, scope: UrbanControlScope = { kind: 'global' }): Record<string, unknown> {
  if (scope.kind === 'global' || scope.kind === 'settlement') return morphologyDefaults(mergeUrbanControlValues(nativeDefaults(settings, scope.kind === 'settlement' ? scope.key : undefined), controlProducts(settings.urban), scope.kind === 'settlement' ? controlProducts(settings.urban?.local?.[scope.key]) : undefined));
  return mergeUrbanControlValues(urbanInheritedValues(settings, scope), urbanScopeValues(settings, scope));
}
function prune(value: Record<string, unknown>): void {
  for (const [key, child] of Object.entries(value)) if (isObject(child)) { prune(child); if (!Object.keys(child).length) delete value[key]; }
}
/** Arrays are native atomic ranges. A single endpoint edit copies its effective other endpoint;
 * it never sends a sparse array or silently changes a cultural range to [0, value]. */
export function writeUrbanControl(settings: V2Settings, scope: UrbanControlScope, path: string, value: unknown): void {
  const root = urbanScopeValues(settings, scope, true), inherited = urbanInheritedValues(settings, scope);
  const keys = path.split('.'), arrayAt = keys.findIndex(k => /^\d+$/.test(k));
  if (value !== undefined && scope.kind !== 'building' && path.startsWith('houses.house_config.')) {
    const houses = root.houses as Record<string, unknown> ?? (root.houses = {}) as Record<string, unknown>;
    houses.house_config ??= clone(readSettingPath(inherited, 'houses.house_config') ?? houseControlDefaults());
  }
  const workshopPath = scope.kind === 'building' ? 'workshop' : 'houses.house_config.workshop';
  // Support is a complete native catalogue record (unlike optional house
  // overrides); clearing its required kind restores the inherited/native kind.
  if (value === undefined && path === `${workshopPath}.support.kind` && readSettingPath(root, workshopPath)) value = readSettingPath(inherited, path) ?? 'ground';
  if (value !== undefined && path.startsWith(`${workshopPath}.`)) {
    if (!isObject(readSettingPath(root, workshopPath))) writeSettingPath(root, workshopPath, clone(readSettingPath(inherited, workshopPath) ?? workshopControlDefaults()));
    if (path.startsWith(`${workshopPath}.support.`) && !isObject(readSettingPath(root, `${workshopPath}.support`))) writeSettingPath(root, `${workshopPath}.support`, clone(readSettingPath(inherited, `${workshopPath}.support`) ?? { kind: 'ground', material: null, height_m: [0, 0] }));
  }
  if (arrayAt >= 0) {
    const arrayPath = keys.slice(0, arrayAt).join('.'), index = Number(keys[arrayAt]);
    const own = readSettingPath(root, arrayPath) as unknown[] | undefined;
    // Keep this scope's selected cultural preset while removing only this atomic range.
    if (own !== undefined) writeSettingPath(root, arrayPath, undefined);
    const base = readSettingPath(urbanEffectiveValues(settings, scope), arrayPath) as unknown[] | undefined ?? (arrayPath === `${workshopPath}.support.height_m` ? [0, 0] : undefined);
    if (own !== undefined) writeSettingPath(root, arrayPath, own);
    const values = clone(own ?? base ?? []); values[index] = value === undefined ? base?.[index] : value;
    if (values.some(v => v === undefined)) throw new Error('A native range requires every endpoint.');
    writeSettingPath(root, arrayPath, value === undefined && arrayPath !== `${workshopPath}.support.height_m` && JSON.stringify(values) === JSON.stringify(base) ? undefined : values);
  } else writeSettingPath(root, path, value);
  prune(root);
}

const textMessages: Record<string, string> = {
  'Inherited default': 'Valeur héritée', Enabled: 'Activé', Disabled: 'Désactivé', 'Native automatic choice': 'Choix automatique natif',
  'Inherited from global settings. Every field can be overridden independently.': 'Hérité des réglages globaux. Chaque champ peut être modifié indépendamment.',
  'Empty fields inherit the cultural recipe. Changes apply on generation.': 'Les champs vides héritent de la recette culturelle. Les changements s’appliquent à la génération.',
  'Reset this scope': 'Réinitialiser ce périmètre', 'Reset field': 'Réinitialiser le champ', 'Automatic': 'Automatique', 'Effective value: {value}': 'Valeur effective : {value}',
  'Quarter and lot identifiers belong to this settlement. Native site constraints remain binding.': 'Les identifiants de quartiers et de lots appartiennent à ce lieu. Les contraintes natives du site restent impératives.',
  'Native refusal is reported when a model is incompatible with the culture, era, lot or slope.': 'Un refus natif est signalé si le modèle est incompatible avec la culture, l’époque, le lot ou la pente.',
  'Use a pinned native house model': 'Utiliser un modèle natif de maison imposé',
  'A pinned model uses its selected pack. Domestic lots from another pack can be refused; mixed styles can be set below.': 'Un modèle imposé utilise le pack choisi. Les lots domestiques d’un autre pack peuvent être refusés ; les styles mélangés se règlent ci-dessous.',
  'Urban placement sets one house request per lot, its seed and world orientation. Individual house seeds can be edited in the building inspector.': 'L’implantation urbaine fixe une demande de maison par lot, sa graine et son orientation. Les graines individuelles se règlent dans l’inspecteur du bâtiment.',
  'The free workshop requires the fantasy historical policy and a fantasy house model. Dimensions stay exact.': 'L’atelier libre requiert la politique historique fantasy et un modèle de maison fantasy. Les dimensions restent exactes.',
  'Clear the free workshop': 'Supprimer l’atelier libre', 'Load native architecture catalogue': 'Charger le catalogue architectural natif', 'Loading native house catalogue…': 'Chargement du catalogue natif des maisons…', 'Native catalogue ready': 'Catalogue natif prêt', 'Catalogue unavailable: {error}': 'Catalogue indisponible : {error}',
  'Names, roles, resources and lore are identifiers used by the generator; resource lists accept commas or line breaks.': 'Les noms, rôles, ressources et éléments de contexte sont des identifiants utilisés par le générateur ; les listes acceptent les virgules ou retours à la ligne.',
  'Cultural rules by growth zone': 'Règles culturelles par zone de croissance', 'Mixed architectural styles': 'Styles architecturaux mélangés', 'Whole settlement': 'Tout le lieu', 'Core': 'Cœur', Middle: 'Extension', Edge: 'Périphérie', Faubourg: 'Faubourg', Village: 'Village',
  'Inherit architecture styles': 'Hériter des styles architecturaux', 'Add a style': 'Ajouter un style', 'Remove style': 'Supprimer le style', 'Weight': 'Poids', 'Spread': 'Répartition', Lot: 'Lot', Block: 'Îlot', Quarter: 'Quartier', 'Quarter identifier': 'Identifiant de quartier', 'Add quarter styles': 'Ajouter les styles du quartier',
  'Native outline coordinates (metres)': 'Coordonnées du contour natif (mètres)', 'Outer boundary': 'Contour extérieur', 'Hole': 'Trou', 'Add vertex': 'Ajouter un sommet', 'Remove vertex': 'Supprimer le sommet', 'Add hole': 'Ajouter un trou', 'Remove hole': 'Supprimer le trou', 'Clear outline override': 'Supprimer la modification du contour',
  'At least three finite vertices per ring are required.': 'Chaque anneau requiert au moins trois sommets finis.', 'Generate through': 'Générer jusqu’à', Layout: 'Plan', Parcels: 'Parcelles', Programme: 'Programme', Buildings: 'Bâtiments',
  'Merge into neighbours': 'Fusionner avec les voisins', 'Keep as a garden': 'Conserver en jardin',
  'Site archetypes by settlement identifier': 'Archétypes de site par identifiant de lieu', 'Settlement identifier': 'Identifiant de lieu', 'Add site rule': 'Ajouter une règle de site', 'Remove site rule': 'Supprimer une règle de site',
};
registerMessages(Object.fromEntries([...Object.entries(textMessages).map(([en, fr]) => [en, { en, fr }] as const), ...Object.values(urbanFieldNames).map(([en, fr]) => [en, { en, fr }] as const), ...Object.values(urbanSectionNames).map(([en, fr]) => [en, { en, fr }] as const), ...Object.values(urbanChoiceNames).map(([en, fr]) => [en, { en, fr }] as const)]));
function section(root: HTMLElement, title: string, open = false): HTMLDetailsElement {
  const details = document.createElement('details'); details.className = 'urban-control-section'; details.open = open;
  const summary = document.createElement('summary'); setText(summary, title); details.append(summary); root.append(details); return details;
}
function message(root: HTMLElement, source: string): HTMLElement { const p = document.createElement('small'); setText(p, source); root.append(p); return p; }
function button(root: HTMLElement, source: string, onClick: () => void): HTMLButtonElement { const b = document.createElement('button'); b.type = 'button'; setText(b, source); b.onclick = onClick; root.append(b); return b; }
function localFields(scope: UrbanControlScope): UrbanParameterField[] {
  if (scope.kind === 'quarter') return Object.entries({ culture: '', tissue: 'culture', density: 1, role: '', wealth: .5, deleted: false, salt: 1 }).map(([key, value]) => { const field = urbanField(key, value, 'quarter'); if (key === 'role') field.type = 'text'; return field; });
  if (scope.kind === 'parcel') return Object.entries({ role: '', function: '', households: 1, deleted: '', salt: 1 }).map(([key, value]) => {
    const field = urbanField(key, value, 'parcel');
    if (key === 'deleted') { field.type = 'select'; field.options = [{ value: 'merge', label: 'Merge into neighbours' }, { value: 'garden', label: 'Keep as a garden' }]; }
    return field;
  });
  if (scope.kind === 'building') return [urbanField('seed', '', 'house'), ...urbanControlFields().filter(f => f.section === 'house' || f.section === 'workshop').map(f => ({ ...f, path: f.path.replace('houses.house_config.', '') }))];
  return urbanControlFields();
}

/** Shared native City Bench controls at world, settlement, quarter, lot and individual-house levels.
 * Deliberately returns a stable form: sync updates values and inheritance without replacing controls. */
export function mountUrbanControls(root: HTMLElement, getSettings: () => V2Settings, changed: () => void, scope: UrbanControlScope = { kind: 'global' }): UrbanControls {
  root.classList.add('v2-urban-controls');
  const forms: ParameterForm[] = [], effects: (() => void)[] = [];
  const fields = localFields(scope), global = scope.kind === 'global' || scope.kind === 'settlement';
  const scopeId = scope.kind === 'global' ? 'global' : `${scope.kind}-${scope.key}-${'id' in scope ? scope.id : ''}`.replace(/[^a-z0-9-]/gi, '-');
  const own = () => urbanScopeValues(getSettings(), scope), inherited = () => urbanInheritedValues(getSettings(), scope);
  let effectiveCache: Record<string, unknown> | undefined;
  const effective = (path: string) => readSettingPath(effectiveCache ?? urbanEffectiveValues(getSettings(), scope), path);
  const set = (path: string, value: unknown) => { writeUrbanControl(getSettings(), scope, path, value); changed(); sync(); };
  message(root, scope.kind === 'settlement' ? 'Inherited from global settings. Every field can be overridden independently.' : global ? 'Empty fields inherit the cultural recipe. Changes apply on generation.' : 'Quarter and lot identifiers belong to this settlement. Native site constraints remain binding.');
  button(root, 'Reset this scope', () => {
    const settings = getSettings(), values = urbanScopeValues(settings, scope);
    if (scope.kind === 'global') { delete values.layout; delete values.parcels; delete values.houses; delete values.through; }
    else for (const key of Object.keys(values)) delete values[key];
    changed(); sync();
  }).className = 'subtle';
  if (global) {
    const stageRoot = document.createElement('div'); root.append(stageRoot);
    forms.push(mountParameterForm(stageRoot, [{ path: 'through', label: 'Generate through', type: 'select', optional: true, options: ['layout', 'parcels', 'programme', 'buildings'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })) }], { getValue: path => readSettingPath(own(), path), setValue: set }));
  }
  let modelEnabled: HTMLInputElement | undefined;
  for (const [key, names] of Object.entries(urbanSectionNames)) {
    const members = fields.filter(f => f.section === key); if (!members.length) continue;
    const details = section(root, names[0], !global || key === 'layout');
    if (key === 'house' && global) {
      const label = document.createElement('label'); label.className = 'urban-model-switch'; modelEnabled = document.createElement('input'); modelEnabled.type = 'checkbox'; modelEnabled.dataset.houseModel = '';
      const span = document.createElement('span'); setText(span, 'Use a pinned native house model'); label.append(modelEnabled, span); details.append(label);
      modelEnabled.onchange = () => set('houses.house_config', modelEnabled!.checked ? clone(readSettingPath(inherited(), 'houses.house_config') ?? houseControlDefaults()) : undefined);
      effects.push(() => { const model = readSettingPath(own(), 'houses.house_config'); modelEnabled!.checked = model !== undefined ? !!model : scope.kind === 'settlement' && !!getSettings().urban?.houses?.house_config; });
      message(details, 'A pinned model uses its selected pack. Domestic lots from another pack can be refused; mixed styles can be set below.');
      message(details, 'Urban placement sets one house request per lot, its seed and world orientation. Individual house seeds can be edited in the building inspector.');
    }
    if (key === 'workshop') {
      message(details, 'The free workshop requires the fantasy historical policy and a fantasy house model. Dimensions stay exact.');
      button(details, 'Clear the free workshop', () => set(scope.kind === 'building' ? 'workshop' : 'houses.house_config.workshop', undefined));
    }
    const body = document.createElement('div'); details.append(body);
    const decorated = members.map(field => {
      const fieldLabel = field.label, keyName = field.path.split('.').filter(k => !/^\d+$/.test(k)).at(-1)!;
      if (!Object.values(urbanFieldNames).some(pair => pair[0] === fieldLabel)) {
        const basic = urbanName(field.path.includes('.params.') ? field.path.split('.params.')[1].split('.')[0] : keyName), suffix = fieldLabel.slice(basic[0].length);
        registerMessages({ [fieldLabel]: { en: fieldLabel, fr: basic[1] + suffix.replace(/Core/g, 'Cœur').replace(/Middle/g, 'Extension').replace(/Edge/g, 'Périphérie') } });
      }
      const next = { ...field, id: `urban-${scopeId}-${field.path.replace(/[^a-z0-9]/gi, '-')}` };
      if (field.path.endsWith('.resources') || field.path.endsWith('.lore')) { next.toInput = value => Array.isArray(value) ? value.join(', ') : value; next.fromInput = value => String(value).split(/[,\n]/).map(s => s.trim()).filter(Boolean); }
      if (field.path === 'houses.culture') next.options = field.options?.filter(o => o.value !== 'site');
      return next;
    });
    const form = mountParameterForm(body, decorated, {
      getValue: path => readSettingPath(own(), path), setValue: set,
      disabled: () => global && (key === 'house' || key === 'workshop') && !modelEnabled?.checked,
    }); forms.push(form);
    for (const field of decorated) {
      const row = Array.from(body.querySelectorAll<HTMLElement>('[data-field-path]')).find(e => e.dataset.fieldPath === field.path)!;
      const hint = document.createElement('small'); hint.className = 'urban-inherited-value'; row.append(hint);
      const reset = button(row, 'Reset field', () => set(field.path, undefined)); reset.className = 'urban-field-reset'; reset.title = translate('Reset field');
      if (field.nullable) { const automatic = button(row, 'Automatic', () => set(field.path, null)); automatic.className = 'urban-native-auto'; }
      effects.push(() => {
        const value = effective(field.path), display = value === undefined || value === null || value === '' ? translate('Automatic') : Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? translate(value ? 'Enabled' : 'Disabled') : String(field.toInput ? field.toInput(value) : value);
        setDynamicText(hint, () => translate('Effective value: {value}').replace('{value}', display));
        row.dataset.overridden = String(readSettingPath(own(), field.path) !== undefined); reset.disabled = readSettingPath(own(), field.path) === undefined;
      });
    }
    if (key === 'programme') message(details, 'Names, roles, resources and lore are identifiers used by the generator; resource lists accept commas or line breaks.');
  }
  if (global) { mountPhaseControls(); mountHouseMixtures(); mountSiteArchetypes(); }
  if (scope.kind === 'quarter' || scope.kind === 'parcel') mountOutline();
  if (global || scope.kind === 'building') mountCatalogue();
  function sync(): void { effectiveCache = urbanEffectiveValues(getSettings(), scope); effects.forEach(effect => effect()); forms.forEach(form => form.sync()); }
  function mountPhaseControls(): void {
    const box = section(root, 'Cultural rules by growth zone');
    for (const zone of URBAN_ZONES) {
      const heading = document.createElement('h4'); setText(heading, zone[0].toUpperCase() + zone.slice(1)); box.append(heading);
      const body = document.createElement('div'); box.append(body);
      const fields = ['culture', 'tissue', 'recipe'].map(key => urbanField(`layout.phaseOverrides.${zone}.${key}`, key === 'tissue' ? 'culture' : '', 'growth'));
      fields.push({ ...urbanField(`parcels.zoneOperators.${zone}`, 'culture', 'parcels'), label: 'Parcel operator', type: 'select', options: urbanControlFields().find(f => f.path === 'parcels.operator')!.options });
      forms.push(mountParameterForm(body, fields.map(f => ({ ...f, id: `urban-${scopeId}-${f.path.replaceAll('.', '-')}` })), { getValue: path => readSettingPath(own(), path), setValue: set }));
    }
  }
  function mountHouseMixtures(): void {
    const box = section(root, 'Mixed architectural styles');
    const mountMix = (path: string, title: string): void => {
      const area = section(box, title), rows = document.createElement('div'); area.append(rows);
      let identity = '';
      const render = () => {
        const value = effective(path) as HouseMix | undefined, nextIdentity = JSON.stringify(value);
        if (nextIdentity === identity) return; identity = nextIdentity; rows.replaceChildren();
        if (!value) return;
        const spread = document.createElement('label'); const caption = document.createElement('span'); setText(caption, 'Spread');
        const select = document.createElement('select'); select.dataset.settingPath = `${path}.spread`;
        for (const id of ['lot', 'block', 'quarter']) { const option = document.createElement('option'); option.value = id; setText(option, id[0].toUpperCase() + id.slice(1)); select.append(option); } select.value = value.spread;
        select.onchange = () => set(path, { ...value, spread: select.value }); spread.append(caption, select); rows.append(spread);
        value.styles.forEach((style, i) => {
          const row = document.createElement('div'); row.className = 'urban-mix-row';
          const culture = document.createElement('select'); culture.setAttribute('aria-label', translate('Culture')); culture.dataset.settingPath = `${path}.styles.${i}.culture`;
          for (const id of Object.keys(urbanCatalogue.cultures)) culture.append(new Option(id, id)); culture.value = style.culture;
          const weight = document.createElement('input'); weight.type = 'number'; weight.min = '0'; weight.step = 'any'; weight.value = String(style.weight); weight.setAttribute('aria-label', translate('Weight')); weight.dataset.settingPath = `${path}.styles.${i}.weight`;
          const update = () => { const n = Number(weight.value); if (!Number.isFinite(n) || n < 0) return; const styles = clone(value.styles); styles[i] = { culture: culture.value, weight: n }; set(path, { ...value, styles }); };
          culture.onchange = update; weight.onchange = update; row.append(culture, weight);
          button(row, 'Remove style', () => { const styles = value.styles.filter((_, j) => i !== j); set(path, styles.length ? { ...value, styles } : undefined); }); rows.append(row);
        }); bindTree(rows);
      };
      button(area, 'Add a style', () => { const current = effective(path) as HouseMix | undefined; set(path, { spread: current?.spread ?? 'lot', styles: [...current?.styles ?? [], { culture: getSettings().options.culture, weight: 100 }] }); });
      button(area, 'Inherit architecture styles', () => set(path, undefined)); effects.push(render);
    };
    mountMix('houses.houses.city', 'Whole settlement');
    for (const zone of URBAN_ZONES) mountMix(`houses.houses.zones.${zone}`, zone[0].toUpperCase() + zone.slice(1));
    const quarters = new Set<string>(Object.keys((effective('houses.houses.quarters') as object) ?? {}));
    for (const id of quarters) mountMix(`houses.houses.quarters.${id}`, `${translate('Quarter')} ${id}`);
    const quarter = document.createElement('input'); quarter.placeholder = translate('Quarter identifier'); quarter.setAttribute('aria-label', translate('Quarter identifier')); box.append(quarter);
    button(box, 'Add quarter styles', () => { const id = quarter.value.trim(); if (!id || quarters.has(id) || /[.]/.test(id)) return; quarters.add(id); mountMix(`houses.houses.quarters.${id}`, `${translate('Quarter')} ${id}`); sync(); });
  }
  function mountSiteArchetypes(): void {
    const box = section(root, 'Site archetypes by settlement identifier'), rows = document.createElement('div'); box.append(rows);
    let identity = '';
    effects.push(() => {
      const rules = effective('layout.siteArchetypes') as Record<string, string> ?? {}, next = JSON.stringify(rules);
      if (next === identity) return; identity = next; rows.replaceChildren();
      for (const [id, archetype] of Object.entries(rules)) {
        const row = document.createElement('label'); row.className = 'urban-mix-row'; const name = document.createElement('span'); name.textContent = id; name.dataset.l10nKeep = '';
        const value = document.createElement('input'); value.value = archetype; value.setAttribute('list', `urban-${scopeId}-archetypes`); value.dataset.settingPath = `layout.siteArchetypes[${id}]`;
        value.onchange = () => set('layout.siteArchetypes', { ...rules, [id]: value.value }); row.append(name, value);
        button(row, 'Remove site rule', () => { const next = { ...rules }; delete next[id]; set('layout.siteArchetypes', next); }); rows.append(row);
      }
    });
    const list = document.createElement('datalist'); list.id = `urban-${scopeId}-archetypes`; for (const archetype of SITE_ARCHETYPES) list.append(new Option(archetype, archetype)); box.append(list);
    const id = document.createElement('input'); id.placeholder = translate('Settlement identifier'); id.setAttribute('aria-label', 'Settlement identifier'); box.append(id);
    button(box, 'Add site rule', () => { if (!id.value.trim()) return; set('layout.siteArchetypes', { ...effective('layout.siteArchetypes') as object ?? {}, [id.value.trim()]: 'auto' }); id.value = ''; });
    button(box, 'Reset field', () => set('layout.siteArchetypes', undefined));
  }
  function mountOutline(): void {
    const box = section(root, 'Native outline coordinates (metres)'), rows = document.createElement('div'); box.append(rows);
    let identity = '';
    effects.push(() => {
      const shape = effective('shape') as { outer: { x: number; y: number }[]; holes?: { x: number; y: number }[][] } | undefined;
      const next = JSON.stringify(shape); if (identity === next) return; identity = next; rows.replaceChildren();
      const rings = [shape?.outer ?? [], ...shape?.holes ?? []];
      rings.forEach((ring, r) => {
        const area = document.createElement('div'); area.className = 'urban-outline-ring'; const heading = document.createElement('h4'); setText(heading, r === 0 ? 'Outer boundary' : 'Hole'); area.append(heading);
        const commit = (points: { x: number; y: number }[]) => { const nextRings = clone(rings); nextRings[r] = points; set('shape', { outer: nextRings[0], holes: nextRings.slice(1) }); };
        ring.forEach((point, i) => {
          const row = document.createElement('div'); row.className = 'urban-outline-point';
          const inputs = (['x', 'y'] as const).map(axis => { const input = document.createElement('input'); input.type = 'number'; input.step = '.1'; input.value = String(point[axis]); input.setAttribute('aria-label', `${axis} ${i + 1}`); input.dataset.settingPath = `shape.${r === 0 ? 'outer' : `holes.${r - 1}`}.${i}.${axis}`; return input; });
          const update = () => { const x = Number(inputs[0].value), y = Number(inputs[1].value); if (!Number.isFinite(x) || !Number.isFinite(y)) return; const points = clone(ring); points[i] = { x, y }; commit(points); };
          inputs.forEach(input => input.onchange = update); row.append(...inputs); button(row, 'Remove vertex', () => commit(ring.filter((_, j) => i !== j))); area.append(row);
        });
        button(area, 'Add vertex', () => { const previous = ring.at(-1) ?? { x: 0, y: 0 }; commit([...ring, { x: previous.x + 10, y: previous.y }]); });
        if (r > 0) button(area, 'Remove hole', () => set('shape', { outer: rings[0], holes: rings.slice(1).filter((_, j) => j !== r - 1) }));
        rows.append(area);
      });
    });
    button(box, 'Add hole', () => { const shape = effective('shape') as { outer: unknown[]; holes?: unknown[][] } | undefined; set('shape', { outer: shape?.outer ?? [], holes: [...shape?.holes ?? [], []] }); });
    button(box, 'Clear outline override', () => set('shape', undefined)); message(box, 'At least three finite vertices per ring are required.');
  }
  function mountCatalogue(): void {
    const status = message(root, 'Native refusal is reported when a model is incompatible with the culture, era, lot or slope.');
    const load = button(root, 'Load native architecture catalogue', () => {
      load.disabled = true; root.setAttribute('aria-busy', 'true'); setText(status, 'Loading native house catalogue…');
      void import('../../../rust/bridge/houses').then(async houses => {
        const settings = getSettings(), runtime = settings.urban?.backend === 'native' ? { profile: 'local' as const, server: settings.runtime?.localServer ?? 'http://127.0.0.1:8791' } : undefined;
        return houses.parseHouseCatalogue(await houses.callHouses({ ticket: 1, kind: 'catalogue', runtime }));
      }).then(bundle => { if (!alive) return; populateCatalogue(bundle); setText(status, 'Native catalogue ready'); })
        .catch(error => { if (alive) setDynamicText(status, () => translate('Catalogue unavailable: {error}').replace('{error}', String(error))); })
        .finally(() => { if (alive) { load.disabled = false; root.removeAttribute('aria-busy'); } });
    });
  }
  function populateCatalogue(bundle: CatalogueBundle): void {
    const prefix = scope.kind === 'building' ? '' : 'houses.house_config.', catalogue = bundle.catalogue;
    const values: Record<string, string[]> = {
      pack: catalogue.packs.map(p => p.id), recipe: catalogue.recipes.map(r => r.id), era: [...new Set(catalogue.packs.flatMap(p => p.eras))],
      'overrides.variant': [...new Set(catalogue.recipes.flatMap(r => r.variants.map(v => v.id)))],
      'overrides.footprint': [...new Set(catalogue.recipes.flatMap(r => [r.parameters.footprint_family, ...r.parameters.allowed_footprints]))],
      'overrides.roof': [...new Set(catalogue.recipes.flatMap(r => [r.parameters.roof_system, ...r.parameters.allowed_roofs]))],
      'workshop.preset_id': catalogue.workshop_presets.map(p => p.id),
    };
    const materialRoles: Record<string, string[]> = { frame: ['frame', 'load_bearing'], infill: ['infill'], coating: ['coating'], cladding: ['cladding'], roof_frame: ['roof_frame', 'load_bearing'], base: ['base', 'floor'], material: ['support', 'load_bearing', 'frame', 'base'] };
    for (const slot of ['frame', 'infill', 'coating', 'cladding']) values[`overrides.${slot}`] = catalogue.materials.filter(m => m.roles.some(role => materialRoles[slot].includes(role))).map(m => m.id);
    for (const slot of ['roof_frame', 'base', 'material']) values[`workshop.${slot === 'material' ? 'support.material' : slot}`] = catalogue.materials.filter(m => m.roles.some(role => materialRoles[slot].includes(role))).map(m => m.id);
    values['workshop.footprint'] = values['overrides.footprint']; values['workshop.roof'] = values['overrides.roof'];
    for (const [path, suggestions] of Object.entries(values)) {
      const input = Array.from(root.querySelectorAll<HTMLInputElement>('[data-setting-path]')).find(input => input.dataset.settingPath === `${prefix}${path}`);
      if (!input || input.tagName !== 'INPUT') continue;
      const id = `${input.id}-catalogue`, old = root.querySelector(`#${id}`); old?.remove();
      const list = document.createElement('datalist'); list.id = id;
      for (const suggestion of suggestions.filter(Boolean)) list.append(new Option(suggestion, suggestion)); root.append(list); input.setAttribute('list', id);
    }
  }
  let alive = true; bindTree(root); sync();
  return { sync, dispose: () => { alive = false; forms.forEach(form => form.dispose()); root.replaceChildren(); } };
}
