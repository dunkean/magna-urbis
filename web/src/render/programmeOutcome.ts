/** Display only the optional native final-plan report. This module never reads
 * geometry, nominal dimensions, wishes from a current site, or DTO capacity. */
import type { HousingFloorModel, HousingFloorNeed, HousingFloorOutcome, PlanProgrammeOutcome } from '../../../rust/bridge/urbanArchitecture';

export type RetainedHousingFloorOutcome = Readonly<Omit<HousingFloorOutcome, 'need_model'> & {
  need_model: Readonly<Omit<HousingFloorNeed, 'model'> & { model: Readonly<HousingFloorModel> }>;
}>;
export type RetainedProgrammeOutcome = Readonly<Omit<PlanProgrammeOutcome, 'body_footprint' | 'households' | 'housing_floor'> & {
  housing_floor?: RetainedHousingFloorOutcome;
  body_footprint: Readonly<PlanProgrammeOutcome['body_footprint']>;
  households: Readonly<PlanProgrammeOutcome['households']>;
}>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

const positive = (value: unknown): value is number => amount(value) && value > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
// Scalar roundtrip check only, as in the native allocation-model validator.
// This never changes geometry or supplies/recalculates an absent model.
const scalarClose = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 64 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
/** Copy only the frozen native model/outcome. Unknown or malformed housing
 * metadata stays unknown without discarding an independently valid body report. */
export function retainedHousingFloorOutcome(value: unknown): RetainedHousingFloorOutcome | null {
  if (!object(value) || value.version !== 'plan-housing-floor-outcome-1' || value.scope !== 'housing_in_body_levels'
    || value.measurement !== 'retained_level_footprint_union_per_exact_elevation'
    || value.actual_useful_m2 !== null || value.functional_certification !== 'unknown') return null;
  const need = value.need_model;
  if (!object(need) || need.version !== 'indicative-housing-floor-1' || need.unit !== 'useful_floor_m2'
    || need.scope !== 'housing_in_body_levels' || need.basis !== 'allocation_households_times_wealth_scaled_floor_allowance'
    || !positive(need.requested_m2) || !positive(need.allocated_households)) return null;
  const model = need.model;
  if (!object(model) || !text(model.family) || !text(model.profile_provenance) || !text(model.calibration)
    || !positive(model.floor_m2_per_household) || !amount(model.wealth) || model.wealth > 1
    || !positive(model.wealth_factor) || !positive(model.effective_floor_m2_per_household) || !positive(model.persons_per_household)
    || !scalarClose(model.wealth_factor, .7 + .8 * model.wealth)
    || !scalarClose(model.effective_floor_m2_per_household, model.floor_m2_per_household * model.wealth_factor)
    || !scalarClose(need.requested_m2, need.allocated_households * model.effective_floor_m2_per_household)
    || !positive(value.requested_useful_m2) || !scalarClose(value.requested_useful_m2, need.requested_m2)) return null;
  const gross = value.gross_floor_m2, shortfall = value.useful_shortfall_lower_bound_m2;
  if (gross === null) {
    if (value.inventory_status !== 'unknown' || value.necessary_area_status !== 'unknown' || shortfall !== null) return null;
  } else if (!positive(gross) || value.inventory_status !== 'retained_plan_levels' || !amount(shortfall)
    || value.necessary_area_status !== (gross < need.requested_m2 ? 'insufficient_gross' : 'not_disproved_by_gross')
    || !scalarClose(shortfall, Math.max(0, need.requested_m2 - gross))) return null;
  if (value.inventory_limitation !== undefined && value.inventory_limitation !== null && !text(value.inventory_limitation)) return null;
  const copiedModel = Object.freeze({ family: model.family, profile_provenance: model.profile_provenance, calibration: model.calibration,
    floor_m2_per_household: model.floor_m2_per_household, wealth: model.wealth, wealth_factor: model.wealth_factor,
    effective_floor_m2_per_household: model.effective_floor_m2_per_household, persons_per_household: model.persons_per_household });
  const copiedNeed = Object.freeze({ version: 'indicative-housing-floor-1' as const, unit: 'useful_floor_m2' as const,
    scope: 'housing_in_body_levels' as const, requested_m2: need.requested_m2, allocated_households: need.allocated_households,
    basis: 'allocation_households_times_wealth_scaled_floor_allowance' as const, model: copiedModel });
  return Object.freeze({ version: 'plan-housing-floor-outcome-1', scope: 'housing_in_body_levels', need_model: copiedNeed,
    requested_useful_m2: value.requested_useful_m2, gross_floor_m2: gross as number | null,
    measurement: 'retained_level_footprint_union_per_exact_elevation',
    inventory_status: value.inventory_status as HousingFloorOutcome['inventory_status'],
    ...(typeof value.inventory_limitation === 'string' ? { inventory_limitation: value.inventory_limitation } : {}),
    necessary_area_status: value.necessary_area_status as HousingFloorOutcome['necessary_area_status'],
    useful_shortfall_lower_bound_m2: shortfall as number | null, actual_useful_m2: null, functional_certification: 'unknown' });
}

/** Same scalar contract as HousingFloorNeed::validate: retain the native
 * allocation, including old programme.households display rounding to 0.01.
 * This does not introduce a geometric tolerance or rewrite either quantity. */
function nativeHouseholdAccountingMatches(households: number, allocated: number): boolean {
  const grid = Math.round(households * 100) / 100;
  const roundoff = 64 * Number.EPSILON * Math.max(Math.abs(households), Math.abs(allocated), 1);
  const oldDisplayRounding = scalarClose(households, grid) && Math.abs(households - allocated) <= .005 + roundoff;
  return scalarClose(households, allocated) || oldDisplayRounding;
}

/** Known version, scalar whitelist, no parent links. Invalid/old reports remain
 * unknown. Consistency checks use only reported scalars, never recreate target
 * or final footprint from another data source. Housed capacity is never known. */
export function retainedProgrammeOutcome(value: unknown): RetainedProgrammeOutcome | null {
  if (!object(value) || value.version !== 'plan-programme-outcome-1') return null;
  const body = value.body_footprint;
  // Missing parent household metadata cannot authorize a housing model. The
  // independently valid footprint remains inspectable with unknown households.
  const households = value.households === null || value.households === undefined
    ? { requested: null, housed: null, capacity_status: 'unknown' } : value.households;
  const requested = object(households) ? households.requested ?? null : null;
  if (!object(body) || !object(households) || !amount(body.actual_m2) || body.tolerance_fraction !== .1
    || requested !== null && !amount(requested)
    || households.housed !== null || households.capacity_status !== 'unknown') return null;
  const target = body.requested_m2, actual = body.actual_m2;
  const candidateHousing = retainedHousingFloorOutcome(value.housing_floor);
  const housing = candidateHousing && typeof requested === 'number'
    && nativeHouseholdAccountingMatches(requested, candidateHousing.need_model.allocated_households) ? candidateHousing : null;
  if (target === null) {
    if (body.attainment !== 'not_requested' || body.deficit_m2 !== null || body.excess_m2 !== null) return null;
    return Object.freeze({ version: 'plan-programme-outcome-1', body_footprint: Object.freeze({ requested_m2: null,
      actual_m2: actual, tolerance_fraction: .1, attainment: 'not_requested', deficit_m2: null, excess_m2: null }),
    households: Object.freeze({ requested, housed: null, capacity_status: 'unknown' }),
    ...(housing ? { housing_floor: housing } : {}) });
  }
  if (!amount(target) || target <= 0 || !amount(body.deficit_m2) || !amount(body.excess_m2)) return null;
  const delta = actual - target, attainment = Math.abs(delta) <= target * .1 ? 'within_tolerance' : delta < 0 ? 'deficit' : 'excess';
  if (body.attainment !== attainment || !close(body.deficit_m2, Math.max(0, -delta)) || !close(body.excess_m2, Math.max(0, delta))) return null;
  return Object.freeze({ version: 'plan-programme-outcome-1', body_footprint: Object.freeze({ requested_m2: target,
    actual_m2: actual, tolerance_fraction: .1, attainment, deficit_m2: body.deficit_m2, excess_m2: body.excess_m2 }),
  households: Object.freeze({ requested, housed: null, capacity_status: 'unknown' }),
    ...(housing ? { housing_floor: housing } : {}) });
}

export const PROGRAMME_OUTCOME_SCOPE = 'Surfaces du plan conservé et besoin indicatif du modèle appliqué. Ce bilan ne certifie ni l’usage résidentiel ni la capacité habitante.';
/** Plain text rows, escaped by each real UI consumer. A current site's target
 * belongs in a separately labelled comparison, not in this native report. */
export function programmeOutcomeRows(value: unknown): [string, string][] {
  const report = retainedProgrammeOutcome(value), body = report?.body_footprint;
  const area = (n: number) => `${n.toFixed(2)} m²`;
  const status = !body ? 'Inconnue (rapport natif absent ou non reconnu)' : body.attainment === 'not_requested' ? 'Aucune cible d’emprise demandée'
    : body.attainment === 'within_tolerance' ? 'Dans la tolérance de ±10 % d’emprise'
    : body.attainment === 'deficit' ? 'Déficit hors tolérance de ±10 % d’emprise' : 'Excès hors tolérance de ±10 % d’emprise';
  return [
    ['Cible d’emprise du corps (rapport natif)', body ? body.requested_m2 === null ? 'Non demandée' : area(body.requested_m2) : 'Inconnue'],
    ['Emprise finale du corps (rapport natif)', body ? area(body.actual_m2) : 'Inconnue'],
    ['Déficit / excès d’emprise', body ? body.deficit_m2 === null || body.excess_m2 === null ? 'Non applicable (aucune cible)' : `${area(body.deficit_m2)} / ${area(body.excess_m2)}` : 'Inconnus'],
    ['Tolérance d’emprise', status],
    ['Ménages demandés (rapport natif)', report ? report.households.requested === null ? 'Non renseignés' : String(report.households.requested) : 'Inconnus'],
    ['Ménages logés', 'Inconnus (capacité non évaluée)'],
    ['Portée du bilan', PROGRAMME_OUTCOME_SCOPE],
    ...housingFloorRows(report?.housing_floor),
  ];
}

/** No catalogue, scene request, current controls or nominal useful_area_m2 is
 * consulted. A lower-bound zero never certifies usable residential space. */
function housingFloorRows(floor: RetainedHousingFloorOutcome | undefined): [string, string][] {
  const unknown = 'Inconnu (modèle absent ou non reconnu dans le plan conservé)';
  const area = (n: number) => n > 0 && n < .01 ? '<0.01 m²' : `${n.toFixed(2)} m²`;
  const model = floor?.need_model.model;
  const comparison = !floor ? unknown : floor.necessary_area_status === 'unknown' ? 'Inconnue (inventaire non mesurable)'
    : floor.necessary_area_status === 'insufficient_gross' ? 'Manque démontré selon le modèle, dans les niveaux de corps'
    : 'Pas de manque démontré par le brut ; capacité toujours inconnue';
  return [
    ['Modèle de besoin appliqué', floor ? `${floor.need_model.version} · ${floor.version}` : unknown],
    ['Provenance / calibration du modèle', model ? `${model.family} · ${model.profile_provenance} · ${model.calibration}${model.calibration === 'not-culture-calibrated' ? ' — modèle de jeu non calibré culturellement' : ''}` : unknown],
    ['Hypothèses enregistrées du modèle', model ? `${model.floor_m2_per_household} m² utiles/ménage de base · ${model.persons_per_household} personnes/ménage (hypothèse)` : unknown],
    ['Richesse / facteur / besoin unitaire appliqués', model ? `${model.wealth} · ×${model.wealth_factor} · ${model.effective_floor_m2_per_household} m² utiles/ménage` : unknown],
    ['Besoin utile indicatif (modèle)', floor ? area(floor.requested_useful_m2) : 'Inconnu'],
    ['Surface brute mesurée (niveaux des corps)', floor?.gross_floor_m2 !== null && floor?.gross_floor_m2 !== undefined ? area(floor.gross_floor_m2) : 'Inconnue'],
    ['Manque minimal selon le modèle (niveaux des corps)', floor?.useful_shortfall_lower_bound_m2 !== null && floor?.useful_shortfall_lower_bound_m2 !== undefined ? area(floor.useful_shortfall_lower_bound_m2) : 'Inconnu'],
    ['Comparaison utile indicatif / brut', comparison],
    ['Inventaire et périmètre du bilan utile/brut', floor ? `${floor.scope} · ${floor.inventory_status}${floor.inventory_limitation ? ` · ${floor.inventory_limitation}` : ''} · hors corps non compté` : unknown],
    ['Capacité résidentielle certifiée', 'Inconnue (utile réel et ménages logés non évalués)'],
  ];
}
