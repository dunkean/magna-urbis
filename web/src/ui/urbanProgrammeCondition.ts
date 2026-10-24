/** Optional programme condition/vacancy inputs. No current catalogue default is
 * substituted into an applied report, and vacancy never proves inhabitants. */
import type { ProgrammeContext, ProgrammeState } from '../../../rust/bridge/urbanConfig';
import type { UrbanProgramme } from '../../../rust/bridge/urban';
import { retainSelectValue } from './retainedSelectValue';
const ABSENT = '@absent', RETAINED = '@retained';
export const PROGRAMME_STATE_LABELS: Record<ProgrammeState, string> = {
  thriving: 'En activité', declining: 'En déclin', abandoned: 'À l’abandon', ruined: 'En ruine',
};
const isState = (value: unknown): value is ProgrammeState => typeof value === 'string' && Object.hasOwn(PROGRAMME_STATE_LABELS, value);
const own = (value: object, key: string) => Object.hasOwn(value, key);
const format = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const validDecay = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function programmeConditionControlsHtml(): string {
  return `<details class="advanced" data-programme-condition><summary>État du lieu et vacance</summary>
    <label>État demandé<select data-condition-state><option value="${ABSENT}">Non précisé · défaut natif thriving</option>${Object.entries(PROGRAMME_STATE_LABELS).map(([id,label]) => `<option value="${id}">${xml(label)} · ${id}</option>`).join('')}</select></label>
    <label>Vacance demandée<select data-condition-decay-mode><option value="${ABSENT}">Non précisée · champ omis</option><option value="null">Défaut de l’état · null explicite</option><option value="value">Taux explicite · 0 à 1</option></select></label>
    <label>Taux de vacance<input data-condition-decay type="number" min="0" max="1" step="0.05" placeholder="0 à 1"></label>
    <button type="button" data-condition-reset>État et vacance non précisés</button><small data-condition-note></small>
    <small>Le défaut de l’état est résolu par le moteur. Un taux explicite de 0 est distinct du défaut. Ce réglage influence le programme et les rôles de bâtiments ; il ne mesure ni vacance réellement construite ni habitants logés.</small></details>`;
}
/** State/decay controls intentionally have no data-programme key: their tokens
 * must never pass through the generic string-valued programme binding. */
export function bindProgrammeConditionControls(host: ParentNode) {
  const state = host.querySelector<HTMLSelectElement>('[data-condition-state]');
  const mode = host.querySelector<HTMLSelectElement>('[data-condition-decay-mode]');
  const decay = host.querySelector<HTMLInputElement>('[data-condition-decay]');
  const note = host.querySelector<HTMLElement>('[data-condition-note]');
  const box = host.querySelector<HTMLDetailsElement>('[data-programme-condition]');
  if (!state || !mode || !decay || !note || !box) throw new Error('Missing programme condition control.');
  let savedState: unknown, savedDecay: unknown, savedStateOwn = false, savedDecayOwn = false;
  const refresh = () => {
    decay.disabled = mode.value !== 'value';
    note.textContent = state.value === RETAINED || mode.value === RETAINED
      ? 'Valeur importée hors du domaine UI conservée sans conversion ; le moteur natif peut la refuser. Choisissez une valeur connue pour la corriger explicitement.'
      : 'État/vacance demandés ; le rapport appliqué conserve séparément le contexte retourné. Aucun taux de catalogue courant n’est attribué à un ancien plan.';
  };
  state.onchange = refresh; mode.onchange = refresh;
  return { sync(context: ProgrammeContext): void {
      savedState = context.state; savedDecay = context.decay;
      savedStateOwn = own(context, 'state'); savedDecayOwn = own(context, 'decay');
      const stateToken = savedState === undefined ? ABSENT : isState(savedState) ? savedState : RETAINED;
      retainSelectValue(state, stateToken, 'État importé conservé');
      if (stateToken === RETAINED) state.options[state.options.length - 1].textContent = `État importé conservé : ${format(savedState)}`;
      const decayToken = savedDecay === undefined ? ABSENT : savedDecay === null ? 'null' : validDecay(savedDecay) ? 'value' : RETAINED;
      retainSelectValue(mode, decayToken, 'Vacance importée conservée');
      if (decayToken === RETAINED) mode.options[mode.options.length - 1].textContent = `Vacance importée conservée : ${format(savedDecay)}`;
      decay.value = validDecay(savedDecay) ? String(savedDecay) : '';
      if (stateToken !== ABSENT || decayToken !== ABSENT) box.open = true;
      refresh();
    }, read(context: ProgrammeContext): ProgrammeContext {
      const next = { ...context };
      if (state.value === ABSENT) delete next.state;
      else if (isState(state.value)) next.state = state.value;
      else if (state.value !== RETAINED || !savedStateOwn || !own(context, 'state') || !Object.is(context.state, savedState)) throw new Error('État importé périmé ou inconnu : resynchronisez les réglages.');
      // Retained invalid inputs stay on their original context, never cast from
      // a select token to a valid native enum/number.
      if (mode.value === ABSENT) delete next.decay;
      else if (mode.value === 'null') next.decay = null;
      else if (mode.value === 'value') {
        const value = decay.value.trim() === '' ? NaN : Number(decay.value);
        if (!validDecay(value)) throw new Error('Taux de vacance invalide : nombre fini entre 0 et 1 requis.');
        next.decay = value;
      } else if (mode.value !== RETAINED || !savedDecayOwn || !own(context, 'decay') || !Object.is(context.decay, savedDecay)) throw new Error('Vacance importée périmée ou inconnue : resynchronisez les réglages.');
      return next;
    }, useDefaults(): void {
      state.value = ABSENT; mode.value = ABSENT; decay.value = ''; refresh();
    } };
}
/** Accept only a returned/imported programme. No draft, current catalogue or
 * recomputed effective rate participates in this frozen report. */
export function programmeConditionEvidenceHtml(programme?: Partial<Pick<UrbanProgramme, 'context'>>): string {
  const context = programme?.context;
  if (!context) return '<small data-programme-condition-evidence>État/vacance inconnus : contexte absent de cet import.</small>';
  const state = !own(context, 'state') || context.state === undefined ? 'Non conservé dans ce contexte' : isState(context.state) ? `${PROGRAMME_STATE_LABELS[context.state]} · ${context.state}` : `Valeur conservée hors domaine : ${format(context.state)}`;
  const decay = !own(context, 'decay') || context.decay === undefined ? 'Champ absent · défaut à l’entrée ; taux effectif inconnu'
    : context.decay === null ? 'Défaut de l’état · null conservé ; taux effectif non conservé séparément'
      : validDecay(context.decay) ? `Taux explicite conservé : ${String(context.decay)}` : `Valeur conservée hors domaine : ${format(context.decay)}`;
  return `<dl data-programme-condition-evidence><dt>État conservé au programme</dt><dd>${xml(state)}</dd><dt>Vacance conservée au programme</dt><dd>${xml(decay)}</dd></dl><small>Ces paramètres du programme ne prouvent ni vacance construite ni capacité résidentielle. Aucun taux effectif n’est reconstruit depuis le catalogue actuel.</small>`;
}
