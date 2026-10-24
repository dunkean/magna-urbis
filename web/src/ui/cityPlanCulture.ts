/** A plan profile is an independent override, never a reset of the parcel or
 * architectural settings. Native resolution remains authoritative. */
import type { SettlementSpec } from '../../../rust/bridge/settlements';
import type { LayoutConfig } from '../../../rust/bridge/urbanConfig';
import { retainSelectValue } from './retainedSelectValue';

export function withCityPlanCulture(current: LayoutConfig, culture: string): LayoutConfig {
  return { ...current, culture };
}
export const CITY_CULTURE_PRECEDENCE = 'Lieu : profil du settlement. Plan : « comme le lieu » ou surcharge propre. Parcelles : « comme le plan » suit ses phases, ou leur surcharge propre. Bâtiments : programme architectural retenu de chaque demande, ou leur surcharge propre. Ces choix ne réinitialisent pas les autres étages. Une recette/préréglage explicite reste conservé et le moteur peut refuser une combinaison incompatible. Le bouton de style global garde sa réinitialisation annoncée.';
export interface CityPlanCultureEvidence {
  /** Absent in older imported configs: the native/normalizer default is site. */
  requested?: string;
  place?: string;
  retained?: { key: string; culture: string };
}
/** Operates on the existing generation select, not a duplicate source of state. */
export function bindCityPlanCulture(host: ParentNode & { open: boolean }, select: HTMLSelectElement, choose: (value: string) => void) {
  const reset = host.querySelector<HTMLButtonElement>('[data-plan-culture-site]');
  const note = host.querySelector<HTMLElement>('[data-plan-culture-note]');
  if (!reset || !note) throw new Error('Missing CityBench plan culture controls.');
  select.onchange = () => choose(select.value);
  reset.onclick = () => choose('site');
  return { sync(evidence: CityPlanCultureEvidence): void {
    const culture = evidence.requested === undefined ? 'site' : evidence.requested;
    retainSelectValue(select, culture, 'Profil du plan conservé hors catalogue UI');
    if (culture !== 'site') host.open = true;
    reset.disabled = culture === 'site';
    const requested = culture === 'site' ? `Comme le lieu · ${evidence.place ?? 'profil du lieu non disponible'}` : `Surcharge du plan demandée · ${culture}`;
    const retained = evidence.retained ? `Dernier plan retourné conservé (${evidence.retained.key}) · ${evidence.retained.culture}. Il ne certifie pas les réglages en attente.` : 'Plan retourné : non disponible ; aucune résolution déduite des réglages.';
    note.textContent = `${requested}. ${retained} ${CITY_CULTURE_PRECEDENCE}`;
  } };
}

/** Uses the existing place editor (and its adoption/recalculation lifecycle).
 * No plan/parcel/building reset callback is accepted at this boundary. */
export function bindCityPlaceCulture(select: HTMLSelectElement, edit: (change: (spec: SettlementSpec) => void) => void): void {
  select.onchange = () => edit(spec => { spec.culture = select.value; spec.sitePrefs = {}; });
}
