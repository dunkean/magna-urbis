/** One shared model of the settlement generation axes (TODO P1 « clarify the axes »).
 *
 * An axis is one independent question about a place, answered by one request
 * field. Fields that only tune an axis (wall stiffness, grid spacing, mixShare…)
 * are settings of that axis, not axes. Named profiles (the catalogue cultures)
 * bundle several axes; their ids stay profile ids and their components are
 * made explicit by `profileComponents`.
 *
 * Precedence, for every axis: explicit override > named profile (culture) >
 * automatic resolution (population class, site, intent). `axisSource` reads
 * which of the three a request uses. Applicability: an axis marked `district`
 * only drives the district (quarter) grammar; the direct small grammars
 * (single building, ruin, farmstead, camp, hamlet, street village) ignore it. */
import catalogue from '../crates/core/src/urban/catalogue.json';
import type { LayoutConfig, ParcelConfig, SettlementKind } from './urbanConfig';

export type AxisSource = 'override' | 'profile' | 'auto';
export interface SettlementAxis {
  id: string;
  /** [fr, en] */
  label: readonly [string, string];
  /** Request field: a LayoutConfig path, `parcels.operator`, or `place.*` for the settlement spec. */
  field: string;
  /** Field values that defer to the named profile, and to the automatic resolution. */
  profile?: readonly string[]; auto?: readonly string[];
  /** What the automatic / profile value is resolved from. */
  resolvedFrom: string;
  /** `district`: only the quarter grammar reads it. */
  grammar: 'all' | 'district';
}

export const SETTLEMENT_AXES: readonly SettlementAxis[] = [
  { id: 'population', label: ['Population · classe démographique', 'Population · demographic class'], field: 'place.population', resolvedFrom: 'demographic_classes.json floors; shortcuts only fill a population', grammar: 'all' },
  { id: 'intent', label: ['Intention', 'Intent'], field: 'programme.intent', auto: ['settlement'], resolvedFrom: 'settlement, or one isolated establishment (farm, mill, inn, tower, shrine, wayside temple)', grammar: 'all' },
  { id: 'scope', label: ['Périmètre généré', 'Generation scope'], field: 'scope', resolvedFrom: 'whole settlement, or one isolated district sample', grammar: 'all' },
  { id: 'form', label: ['Grammaire morphologique', 'Morphological grammar'], field: 'settlementForm', auto: ['auto', 'nucleated', 'ribbon'], resolvedFrom: 'demographic class + intent + culture camp/village forms + site', grammar: 'all' },
  { id: 'profile', label: ['Profil nommé (tradition)', 'Named profile (tradition)'], field: 'culture', profile: ['site'], resolvedFrom: 'the place culture; components in profileComponents()', grammar: 'all' },
  { id: 'plan', label: ['Principe de plan · maillage', 'Plan principle · mesh'], field: 'tissue', profile: ['culture'], resolvedFrom: 'profile plan pattern', grammar: 'all' },
  { id: 'era', label: ['Époque (filtre)', 'Era (filter)'], field: 'programme.period', auto: ['', 'any'], resolvedFrom: 'no filter: every admitted period', grammar: 'all' },
  { id: 'functions', label: ['Fonctions pondérées', 'Weighted functions'], field: 'programme.functions', resolvedFrom: 'population and profile (programme owner)', grammar: 'all' },
  { id: 'policy', label: ['Politique historique', 'Historical policy'], field: 'programme.mode', resolvedFrom: 'strict/inspired/fantasy → Houses historical_strict/historical_inspired/fantasy_mix', grammar: 'all' },
  { id: 'enclosure', label: ['Enceinte', 'Enclosure'], field: 'fortification', profile: ['culture'], resolvedFrom: 'explicit type > explicit style family > profile fortification > grammar (no wall for small kinds and market towns)', grammar: 'all' },
  { id: 'enclosureStyle', label: ['Style d’enceinte', 'Enclosure style'], field: 'fortificationStyle', profile: ['auto'], resolvedFrom: 'explicit style of the type’s family > culture style table (population, period, prosperity)', grammar: 'all' },
  { id: 'footprint', label: ['Forme de l’emprise', 'Footprint form'], field: 'footprint.family', auto: ['auto'], resolvedFrom: 'site and growth mechanism', grammar: 'district' },
  { id: 'growth', label: ['Mécanisme de croissance', 'Growth mechanism'], field: 'footprint.mechanism', auto: ['auto'], resolvedFrom: 'family and site', grammar: 'all' },
  { id: 'phases', label: ['Phases de croissance', 'Growth phases'], field: 'phases', auto: ['0'], resolvedFrom: 'profile phase count and grammar (1 for villages, 4 for a metropolis)', grammar: 'district' },
  { id: 'suburbs', label: ['Faubourgs', 'Suburbs'], field: 'suburbs', auto: ['auto'], resolvedFrom: 'grammar (none for villages, many for a metropolis)', grammar: 'district' },
  { id: 'mix', label: ['Seconde influence', 'Second influence'], field: 'mixCulture', auto: [''], resolvedFrom: 'none; phases or sectors of a second profile', grammar: 'district' },
  { id: 'parcelling', label: ['Parcellaire', 'Parcelling'], field: 'parcels.operator', profile: ['culture'], resolvedFrom: 'profile parcel operator', grammar: 'all' },
];
const AXES = new Map(SETTLEMENT_AXES.map(a => [a.id, a]));
export const settlementAxis = (id: string): SettlementAxis => {
  const axis = AXES.get(id); if (!axis) throw new Error(`Unknown settlement axis ${id}`); return axis;
};

/** Native grammars laid out directly, without the quarter grammar (Rust `Kind::small`). */
export const DIRECT_GRAMMARS: readonly SettlementKind[] = ['single', 'ruin', 'farmstead', 'camp', 'hamlet', 'street-village'];

function read(config: LayoutConfig, parcels: Pick<ParcelConfig, 'operator'> | undefined, field: string): unknown {
  if (field === 'parcels.operator') return parcels?.operator;
  return field.split('.').reduce<unknown>((v, key) => (v as Record<string, unknown> | undefined)?.[key], config);
}
/** Which layer answers the axis for this request: explicit override, named profile or automatic resolution. */
export function axisSource(id: string, config: LayoutConfig, parcels?: Pick<ParcelConfig, 'operator'>): AxisSource {
  const axis = settlementAxis(id), value = read(config, parcels, axis.field);
  if (axis.field.startsWith('place.')) return 'override';
  // An explicit style fixes the enclosure type (Rust kinds::requested_enclosure).
  if (id === 'enclosure' && config.fortification === 'culture' && config.fortificationStyle !== 'auto') return 'override';
  if (axis.field === 'programme.functions') return value === undefined || value === null ? 'auto' : 'override';
  const text = value === undefined || value === null ? '' : String(value);
  if (axis.profile?.includes(text)) return 'profile';
  if (axis.auto?.includes(text) || (axis.auto && text === '')) return 'auto';
  return 'override';
}

/** The grammar the request leads to when it is known without running the resolver:
 * a forced grammar, else an isolated intent, else the archetype returned for this
 * request (if any). `undefined` = not known yet: every axis stays applicable. */
export function expectedGrammar(config: Pick<LayoutConfig, 'settlementForm' | 'programme'>, returned?: string): SettlementKind | undefined {
  const form = config.settlementForm;
  if (form && !['auto', 'nucleated', 'ribbon'].includes(form)) return form as SettlementKind;
  const intent = config.programme?.intent ?? 'settlement';
  if (intent !== 'settlement') return config.programme.state === 'ruined' ? 'ruin' : intent === 'isolated-farm' ? 'farmstead' : 'single';
  return returned as SettlementKind | undefined;
}
/** Does the axis drive generation for this grammar? Unknown grammar: yes. */
export function axisApplies(id: string, grammar?: string): boolean {
  return settlementAxis(id).grammar === 'all' || !grammar || !DIRECT_GRAMMARS.includes(grammar as SettlementKind);
}

/** Enclosure actually built on a returned plan: « type · style » of the main
 * enclosure (citadels and closes are not the town enclosure), `none` without one. */
export function resolvedEnclosure(layout: { enclosures?: { kind: string; style?: string; purpose?: string }[] } | undefined): string | undefined {
  if (!layout) return undefined;
  const main = layout.enclosures?.find(e => !e.purpose) ?? layout.enclosures?.[0];
  return main ? [main.kind, main.style].filter(Boolean).join(' · ') : 'none';
}

/** Explicit components of a named profile. Generic ones come from the catalogue
 * (plan pattern, fortification); composite presets add what their id bundles. */
export interface ProfileComponents { id: string; tradition: string; plan: string; enclosure: string; theme?: string; era?: string; functions?: string; site?: string }
const COMPOSITES: Record<string, Partial<ProfileComponents>> = {
  bastide: { tradition: 'european-organic', plan: 'planned grid new town', era: 'M' },
  'maori-pa': { tradition: 'māori', plan: 'terraced hillfort (pā)', site: 'hilltop or spur' },
  'japanese-jokamachi': { tradition: 'japanese', plan: 'castle town', functions: 'capital (seat of a lord)' },
  necropolis: { theme: 'necropolis', functions: 'funerary (lore necropolis)' },
  'roman-core': { tradition: 'roman', plan: 'castrum grid', era: 'A' },
  'russian-kremlin': { tradition: 'russian', plan: 'kremlin and posad' },
  'tibetan-monastery': { tradition: 'tibetan', functions: 'monastic' },
  'mongol-ordu': { tradition: 'mongol', plan: 'princely camp', functions: 'capital (moving court)' },
  'norse-ringfort': { tradition: 'norse', plan: 'circular ring fortress', functions: 'garrison' },
  'rajput-fort': { tradition: 'rajput', plan: 'town below a fort' },
  'vietnamese-citadel': { tradition: 'viet', plan: 'citadel and merchant quarter', functions: 'capital' },
};
/** Fantasy themes: profiles that are a theme, not a historical tradition. */
const FANTASY = ['elven', 'dwarven', 'wizard-city', 'gnomish', 'orcish', 'halfling', 'drow-enclave', 'duergar-hold', 'myconid-colony', 'lizardfolk-swamp', 'merfolk-tidal', 'giant-hold', 'goblin-warren', 'necropolis'];
type CatalogueCulture = { plan?: { pattern?: string; fortification?: string } };
export function profileComponents(id: string): ProfileComponents | undefined {
  const entry = (catalogue.cultures as Record<string, CatalogueCulture>)[id];
  if (!entry) return undefined;
  const composite = COMPOSITES[id] ?? {};
  return {
    id, tradition: FANTASY.includes(id) ? '—' : id, plan: entry.plan?.pattern ?? 'organic', enclosure: entry.plan?.fortification ?? 'auto',
    ...(FANTASY.includes(id) ? { theme: id } : {}), ...composite,
  };
}
/** One line naming the components, e.g. « tradition japanese · plan castle town · enclosure none · functions capital ». */
export function profileSummary(id: string): string {
  const c = profileComponents(id); if (!c) return '';
  return [c.theme && `theme ${c.theme}`, c.tradition !== '—' && `tradition ${c.tradition}`, `plan ${c.plan}`, `enclosure ${c.enclosure}`,
    c.era && `era ${c.era}`, c.functions && `functions ${c.functions}`, c.site && `site ${c.site}`].filter(Boolean).join(' · ');
}
