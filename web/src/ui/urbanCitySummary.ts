/** City Bench one-glance summary: what was requested, what the native plan
 * resolved, and what the land and admitted buildings actually support.
 * Pure: reads only the applied plan, its programme and the placement scene. */
import type { Layout, UrbanProgramme } from '../../../rust/bridge/urban';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import { MORPHOLOGY_LABELS, morphologyRequestLabel } from './urbanMorphology';
import { programmeIntentLabel, programmeSpecialisationSummary } from './urbanProgrammeFunctions';
import { programmeBalanceEvidence } from './urbanProgrammeEvidence';
import { localizedDemographicLabel } from './settlementKinds';
import { urbanText } from './urbanPanelLocale';

export interface CitySummaryInput {
  /** Requested population of the site (the city's input, not a capacity). */
  population?: number;
  layout?: Pick<Layout, 'config' | 'archetype' | 'culture' | 'phases' | 'structure' | 'warnings'>;
  /** Allocated programme (partition) when parcels exist, else the plan's. */
  programme?: UrbanProgramme;
  scene?: PlacementBatch;
}

const t = (fr: string, en: string): string => urbanText([fr, en, en, en, en]);
const xml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (v: number): string => Math.round(v).toLocaleString();
const row = (key: string, label: string, value: string): string => `<dt>${xml(label)}</dt><dd data-summary="${key}">${value}</dd>`;

/** Persons per domestic unit, from the native demand provenance. */
export function householdSize(programme?: UrbanProgramme): number | undefined {
  for (const d of programme?.demands ?? []) for (const p of d.provenance) {
    const m = /profile:([0-9.]+) persons\/domesticUnit/.exec(p);
    if (m) return Number(m[1]);
  }
  return undefined;
}

export interface CitySupport {
  need: number; land: number; parcels: number; buildings: number; refusals: number;
  known: number | undefined; unknownLots: number; deficit: number; size?: number;
}
/** Households: need, land capacity, parcel allocation, admitted and deficit.
 * Housed households are known only when the scene balance is consistent. */
export function citySupport(programme: UrbanProgramme, scene?: PlacementBatch): CitySupport {
  const homes = programme.demands.filter(d => d.unit === 'domesticUnits');
  const evidence = programmeBalanceEvidence(scene)(programme);
  const sum = (f: (d: typeof homes[number]) => number): number => homes.reduce((s, d) => s + f(d), 0);
  const unknownLots = evidence === 'outcomes_reconciled'
    ? programme.builtBalance!.demands.filter(b => homes.some(d => d.id === b.id)).reduce((s, b) => s + b.admittedUnknown, 0) : 0;
  return {
    need: sum(d => d.requested), land: programme.housingCapacity ?? 0, parcels: sum(d => d.parcelCapacity),
    buildings: scene?.buildings.length ?? 0, refusals: scene?.refusals.length ?? 0,
    known: evidence === 'scene_consistent' ? sum(d => d.builtCapacity) : undefined, unknownLots,
    deficit: sum(d => d.deficit), size: householdSize(programme),
  };
}

export function citySummaryHtml(input: CitySummaryInput): string {
  const { layout, programme, scene } = input;
  if (!layout || !programme) return `<small>${t('Le résumé apparaît avec le plan appliqué.', 'The summary appears with the applied plan.')}</small>`;
  const pop = input.population ?? programme.population, config = layout.config;
  const requested = [
    row('population', t('Population', 'Population'), `${n(pop)} ${t('hab.', 'inh.')} · ${xml(localizedDemographicLabel(pop))}`),
    row('intent', t('Intention', 'Intent'), xml(programmeIntentLabel(programme.context))),
    row('functions', t('Spécialisation', 'Specialisation'), xml(programmeSpecialisationSummary(programme.context))),
    row('form', t('Forme', 'Form'), xml(morphologyRequestLabel(config?.settlementForm))),
  ];
  const kind = layout.archetype ?? '';
  const phases = (layout.phases ?? []).map(p => `${xml(p.zone)} : ${xml(p.culture || layout.culture)} · ${xml(p.recipe)}`);
  const tissues = [...new Set(layout.structure?.districts.map(d => d.tissue) ?? [])];
  const environment = programme.environment;
  const waterfront = environment.filter(e => e.waterfront).length;
  const substitutions = [...new Set([...programme.cultures.filter(c => c.borrowing).map(c => `${c.culture} : ${c.borrowing}`), ...programme.warnings])];
  const resolved = [
    row('grammar', t('Grammaire du plan', 'Plan grammar'), xml((MORPHOLOGY_LABELS as Record<string, string>)[kind] ?? (kind || t('inconnue', 'unknown')))),
    row('cultures', t('Cultures → pack', 'Cultures → pack'), programme.cultures.map(c => `${xml(c.culture)} → ${xml(c.architecturePack)}`).join('<br>') || t('aucune recette native', 'no native recipe')),
    ...(phases.length ? [row('phases', t('Recettes par phase', 'Recipes per phase'), phases.join('<br>'))] : []),
    row('footprint', t('Emprise · maillage', 'Footprint · mesh'), xml([layout.structure ? `${layout.structure.mechanism} / ${layout.structure.family}` : '—', tissues.join(', ') || config?.tissue || '—'].join(' · '))),
    row('site', t('Contexte mesuré', 'Measured context'), xml(`${programme.navigableFrontage ? t('quai navigable mesuré', 'measured navigable quay') : t('aucun quai navigable', 'no navigable quay')} · ${waterfront}/${environment.length} ${t('îlots en rive', 'waterfront blocks')}${config?.siteArchetype ? ` · ${t('site', 'site')} ${config.siteArchetype}` : ''}`)),
    ...(substitutions.length ? [row('substitutions', t('Substitutions motivées', 'Motivated substitutions'), `<ul>${substitutions.slice(0, 4).map(s => `<li>${xml(s)}</li>`).join('')}${substitutions.length > 4 ? `<li>+${substitutions.length - 4}</li>` : ''}</ul>`)] : []),
  ];
  const s = citySupport(programme, scene);
  const persons = (households: number): string => s.size ? ` (≈ ${n(households * s.size)} ${t('hab.', 'inh.')})` : '';
  const housed = s.known !== undefined ? `${n(s.known)} ${t('ménages', 'households')}${persons(s.known)}`
    : scene ? `${t('inconnue', 'unknown')}${s.unknownLots ? ` · ${n(s.unknownLots)} ${t('lots domestiques admis à capacité inconnue', 'domestic lots admitted with unknown capacity')}` : ''}`
      : t('bâtiments non implantés', 'buildings not placed');
  const supported = [
    row('need', t('Besoin', 'Need'), `${n(s.need)} ${t('ménages', 'households')}${persons(s.need)}`),
    row('land', t('Capacité du sol', 'Land capacity'), `${n(s.land)} ${t('ménages sur les lots habitables', 'households on habitable lots')} · ${n(s.parcels)} ${t('affectés', 'allocated')}`),
    row('buildings', t('Bâtiments admis', 'Admitted buildings'), scene ? `${n(s.buildings)} · ${n(s.refusals)} ${t('refus', 'refusals')}` : '—'),
    row('housed', t('Population logée', 'Housed population'), housed),
    row('deficit', t('Déficit', 'Deficit'), `${n(s.deficit)} ${t('ménages', 'households')}${persons(s.deficit)}${s.known === undefined ? ` · ${t('capacité inconnue non créditée', 'unknown capacity not credited')}` : ''}`),
  ];
  const group = (title: string, rows: string[]): string => `<h4>${xml(title)}</h4><dl class="urban-inspection">${rows.join('')}</dl>`;
  return `${group(t('Demandé', 'Requested'), requested)}${group(t('Résolu', 'Resolved'), resolved)}${group(t('Supporté', 'Supported'), supported)}`;
}
