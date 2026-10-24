/** Programme intent and composable functional specialization. These controls
 * edit the real ProgrammeContext consumed by native demand/allocation. */
import { PROGRAMME_FUNCTIONS, normalizeProgrammeFunctions, type ProgrammeContext, type ProgrammeFunctionWeights,
  type ProgrammeFunction, type ProgrammeIsolatedRole } from '../../../rust/bridge/urbanConfig';

export const PROGRAMME_INTENTS: Readonly<Record<'settlement' | ProgrammeIsolatedRole, string>> = {
  settlement: 'Agglomération · selon population et culture',
  'isolated-farm': 'Ferme isolée', 'roadside-temple': 'Temple de bord de route',
  'isolated-shrine': 'Sanctuaire isolé', 'isolated-mill': 'Moulin isolé', 'isolated-inn': 'Auberge isolée', 'isolated-tower': 'Tour isolée',
};
export const PROGRAMME_FUNCTION_LABELS: Readonly<Record<ProgrammeFunction, string>> = {
  agricultural: 'Espaces communs et stockage rural', commerce: 'Commerce et marchés', artisan: 'Artisanat',
  riverine: 'Moulins hydrauliques', port: 'Activité portuaire', capital: 'Capitale · équipements institutionnels',
};
const LEGACY_FUNCTION: Readonly<Partial<Record<ProgrammeContext['role'], ProgrammeFunction>>> = {
  agricultural: 'agricultural', crossroads: 'commerce', artisan: 'artisan', riverine: 'riverine', port: 'port', capital: 'capital',
};
export type ProgrammeIntent = keyof typeof PROGRAMME_INTENTS;
export interface ProgrammeAxesDraft { intent: ProgrammeIntent; custom: boolean; weights: ProgrammeFunctionWeights; resetAutomatic?: boolean }
const isolated = (role: string): role is ProgrammeIsolatedRole => role !== 'settlement' && role !== 'auto' && Object.hasOwn(PROGRAMME_INTENTS, role);
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function programmeAxesDraft(context: ProgrammeContext): ProgrammeAxesDraft {
  const weights = context.functions == null ? LEGACY_FUNCTION[context.role] ? { [LEGACY_FUNCTION[context.role]!]: 1 } : {} : normalizeProgrammeFunctions(context.functions);
  return { intent: isolated(context.role) ? context.role : 'settlement', custom: context.functions != null, weights };
}
export function applyProgrammeAxesDraft(previous: ProgrammeContext, draft: ProgrammeAxesDraft): ProgrammeContext {
  if (!Object.hasOwn(PROGRAMME_INTENTS, draft.intent)) throw new Error('Intention d’implantation inconnue.');
  const next: ProgrammeContext = { ...previous };
  next.role = draft.intent === 'settlement' ? isolated(previous.role) ? 'auto' : previous.role : draft.intent;
  if (draft.custom) {
    next.functions = normalizeProgrammeFunctions(draft.weights);
    if (draft.intent === 'settlement') next.role = 'auto';
  } else if (previous.functions != null || draft.resetAutomatic) {
    delete next.functions;
    if (draft.intent === 'settlement') next.role = 'auto';
  }
  return next;
}

/** Quantified effects of the explicit weights, not a promise of admission or
 * measured population capacity. Physical programme minima stay unscaled. */
export function programmeFunctionEffects(value: ProgrammeFunctionWeights): string[] {
  const w = normalizeProgrammeFunctions(value), get = (key: ProgrammeFunction) => w[key] ?? 0;
  const amount = (n: number) => Number(n.toFixed(3)).toLocaleString('fr-FR');
  const shared = Math.max(get('commerce'), get('port'), get('capital'));
  const rows = [`Habitat avec boutique : ${amount(8 + 17 * shared)} % des ménages dès 150 habitants ; effet commun compté une seule fois.`];
  if (get('agricultural') > 0) rows.push(`Espaces communs : ${amount(.5 + 1.5 * get('agricultural'))} m²/hab. hors profil communal ; stockage rural ×${amount(1 + get('agricultural'))}.`);
  if (get('commerce') > 0) rows.push(`Services commerciaux ×${amount(1 + get('commerce'))} ; coefficient des marchés ×${amount(1 + 2 * get('commerce'))}.`);
  if (get('artisan') > 0) rows.push(`Ateliers : ${amount(3.5 * get('artisan'))} m²/hab., minimum 80 m² ; services d’artisanat ×${amount(1 + get('artisan'))}.`);
  if (get('riverine') > 0) rows.push(`Moulins ×${amount(1 + get('riverine'))}, sans créer de rivière. Les mêmes moulins ne sont pas multipliés une seconde fois par l’artisanat.`);
  if (get('port') > 0) rows.push(`Stockage portuaire : ${amount(2 * get('port'))} m²/hab., minimum 180 m² ; accès navigable déclaré et rive réelle nécessaires à l’allocation.`);
  if (get('capital') > 0) rows.push(`Seuils de population des équipements politiques, d’élite et défensifs ×${amount(1 - .75 * get('capital'))}.`);
  rows.push('Les nombres de services sont entiers, arrondis vers le bas après pondération : ×1,5 peut conserver un seul service. Les limites du catalogue restent appliquées.');
  return rows;
}
export function programmeFunctionsSummary(context?: ProgrammeContext): string {
  if (!context) return 'Spécialisation fonctionnelle inconnue : contexte absent de cette scène.';
  const draft = programmeAxesDraft(context), intent = PROGRAMME_INTENTS[draft.intent];
  if (draft.intent !== 'settlement') return `${intent} ; fonctions urbaines non applicables.`;
  if (!draft.custom) return context.role === 'auto' ? `${intent} ; fonctions selon le lieu et le profil culturel.` : `${intent} ; ancien profil conservé : ${PROGRAMME_FUNCTION_LABELS[LEGACY_FUNCTION[context.role]!] ?? context.role}.`;
  const active = PROGRAMME_FUNCTIONS.filter(key => (draft.weights[key] ?? 0) > 0).map(key => `${PROGRAMME_FUNCTION_LABELS[key]} ${draft.weights[key]}`);
  return `${intent} ; ${active.length ? active.join(' · ') : 'aucune spécialisation fonctionnelle imposée'}.`;
}

export function programmeFunctionControlsHtml(): string {
  return `<label>Intention d’implantation<select data-programme-intent>${Object.entries(PROGRAMME_INTENTS).map(([key, label]) => `<option value="${key}">${xml(label)}</option>`).join('')}</select></label>
    <label><input type="checkbox" data-programme-custom-functions>Combiner les fonctions du lieu</label>
    <fieldset data-programme-functions><legend>Intensité des fonctions · 0 = aucune, 1 = accentuée</legend>${PROGRAMME_FUNCTIONS.map(key => `<label>${xml(PROGRAMME_FUNCTION_LABELS[key])}<input data-programme-function="${key}" type="number" min="0" max="1" step="0.05" value="0"></label>`).join('')}</fieldset>
    <button type="button" data-programme-functions-auto>Revenir au profil culturel automatique</button>
    <small data-programme-function-note></small><ul data-programme-function-effects></ul>`;
}
/** Used by the real panel, and independently testable with structural controls.
 * No change to upstream population, city position, seed or terrain. */
export function bindProgrammeFunctionControls(host: ParentNode & Pick<HTMLElement, 'addEventListener'>) {
  const get = <T extends Element>(selector: string): T => { const found = host.querySelector<T>(selector); if (!found) throw new Error(`Missing programme control ${selector}`); return found; };
  const intent = get<HTMLSelectElement>('[data-programme-intent]'), custom = get<HTMLInputElement>('[data-programme-custom-functions]');
  const fieldset = get<HTMLFieldSetElement>('[data-programme-functions]'), note = get<HTMLElement>('[data-programme-function-note]'), effects = get<HTMLElement>('[data-programme-function-effects]');
  const inputs = new Map(PROGRAMME_FUNCTIONS.map(key => [key, get<HTMLInputElement>(`[data-programme-function="${key}"]`)]));
  let context: ProgrammeContext, resetAutomatic = false;
  const weights = (): ProgrammeFunctionWeights => normalizeProgrammeFunctions(Object.fromEntries([...inputs].map(([key, input]) => [key, Number(input.value)])));
  const refresh = () => {
    const isIsolated = intent.value !== 'settlement';
    custom.disabled = isIsolated; fieldset.disabled = isIsolated || !custom.checked;
    fieldset.hidden = isIsolated || !custom.checked;
    note.textContent = isIsolated ? 'Cet établissement isolé applique seulement son intention. Les fonctions urbaines sont conservées mais non applicables.'
      : custom.checked ? 'Ces fonctions orientent les besoins et services, sans simuler une économie. Les effets communs ne s’additionnent pas. Les ressources connues peuvent également demander des ateliers.'
      : resetAutomatic ? 'Fonctions selon le lieu et le profil culturel ; ancienne spécialisation exclusive retirée.' : programmeFunctionsSummary(context);
    effects.hidden = isIsolated || !custom.checked;
    if (!effects.hidden) {
      try { effects.innerHTML = programmeFunctionEffects(weights()).map(row => `<li>${xml(row)}</li>`).join(''); }
      catch (error) { effects.textContent = error instanceof Error ? error.message : 'Poids invalides.'; }
    } else effects.replaceChildren();
  };
  host.addEventListener('change', refresh);
  return {
    sync(next: ProgrammeContext): void {
      context = next; resetAutomatic = false;
      const draft = programmeAxesDraft(next); intent.value = draft.intent; custom.checked = draft.custom;
      for (const [key, input] of inputs) input.value = String(draft.weights[key] ?? 0);
      refresh();
    },
    read(previous: ProgrammeContext): ProgrammeContext {
      return applyProgrammeAxesDraft(previous, { intent: intent.value as ProgrammeIntent, custom: custom.checked, weights: custom.checked ? weights() : {}, resetAutomatic });
    },
    useAutomatic(): void { resetAutomatic = true; custom.checked = false; for (const input of inputs.values()) input.value = '0'; refresh(); },
    refresh,
  };
}
