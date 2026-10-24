/** Urban policy controls and retained programme evidence. A routing witness is
 * not a built house or a culture×era×population historical certification. */
import type { ProgrammeContext } from '../../../rust/bridge/urbanConfig';
import type { UrbanProgramme } from '../../../rust/bridge/urban';
import nativeAdmissionPeriods from '../data/nativeAdmissionPeriods.json';
import { retainSelectValue } from './retainedSelectValue';
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const PROGRAMME_POLICY_LABELS: Record<ProgrammeContext['mode'], string> = {
  strict: 'Strict · contrôles de sources et d’emprunts', inspired: 'Inspiré · adaptations permises par les sources', fantasy: 'Fantasy · mélanges déclarés',
};
export const PROGRAMME_POLICY_HOUSES: Record<ProgrammeContext['mode'], string> = { strict: 'historical_strict', inspired: 'historical_inspired', fantasy: 'fantasy_mix' };
export const PROGRAMME_CATALOGUE_PERIODS = [...nativeAdmissionPeriods.periods];
export const HISTORICAL_SCOPE_UNKNOWN = 'Culture × époque × échelle : inconnue ; ce contrat ne conserve aucune plage historique documentée. Aucun plafond culturel n’est déduit.';
const isMode = (mode: string): mode is ProgrammeContext['mode'] => Object.hasOwn(PROGRAMME_POLICY_LABELS, mode);
export function programmePolicyExplanation(mode: string): string {
  const policy = isMode(mode) ? mode === 'strict' ? 'Refuse les emprunts déclarés et applique les contrôles natifs de source ; ne certifie pas l’histoire de la ville.'
    : mode === 'inspired' ? 'Autorise certaines adaptations/emprunts déclarés ; les contrôles physiques restent requis.'
      : 'Autorise les mélanges prévus par le catalogue ; la validité physique n’est pas dispensée.' : `Politique conservée non prise en charge par cette UI : ${mode}. Corrigez-la explicitement avant application.`;
  return `${policy} ${HISTORICAL_SCOPE_UNKNOWN}`;
}
export function programmePolicyControlsHtml(): string {
  return `<label>Politique d’admission<select data-programme="mode">${Object.entries(PROGRAMME_POLICY_LABELS).map(([id, label]) => `<option value="${id}">${xml(label)}</option>`).join('')}</select></label>
    <label>Filtre d’époque<select data-programme="period"><option value="">Non précisée · aucun filtre</option><option value="any">Toutes les époques · code any conservé</option>${PROGRAMME_CATALOGUE_PERIODS.map(era => `<option value="${xml(era)}">${xml(era === 'A' ? 'Antiquité locale · code A' : era === 'M' ? 'Moyen Âge / équivalent local · code M' : `Époque du catalogue · code ${era}`)}</option>`).join('')}</select></label>
    <button type="button" data-programme-period-clear>Retirer le filtre d’époque</button><small data-programme-policy-note></small>`;
}
export function bindProgrammePolicyControls(host: ParentNode & Pick<HTMLElement, 'addEventListener'>) {
  const mode = host.querySelector<HTMLSelectElement>('[data-programme="mode"]'), period = host.querySelector<HTMLSelectElement>('[data-programme="period"]');
  const note = host.querySelector<HTMLElement>('[data-programme-policy-note]');
  if (!mode || !period || !note) throw new Error('Missing programme policy control.');
  const refresh = () => { note.textContent = programmePolicyExplanation(mode.value); };
  host.addEventListener('change', refresh);
  return { sync(context: Pick<ProgrammeContext, 'mode' | 'period'>) {
      retainSelectValue(mode, context.mode, 'Politique importée non reconnue');
      retainSelectValue(period, context.period, 'Période conservée hors des raccourcis UI'); refresh();
    }, read(context: ProgrammeContext): ProgrammeContext {
      if (!isMode(mode.value)) throw new Error(`Politique d’admission inconnue : ${mode.value}. Aucun repli automatique appliqué.`);
      if (new TextEncoder().encode(period.value).byteLength > 64) throw new Error('Le code de période dépasse la limite native de 64 octets UTF-8.');
      return { ...context, mode: mode.value, period: period.value };
    }, clearPeriod() { period.value = ''; refresh(); }, refresh };
}
/** No current selector, catalogue default or guessed historical range enters
 * this report: it accepts only the returned/imported programme itself. */
export function programmePolicyEvidenceHtml(programme?: Partial<Pick<UrbanProgramme, 'population' | 'context' | 'cultures'>>): string {
  const p = programme, c = p?.context;
  const rows: [string, string][] = [
    ['Politique conservée au programme', c ? isMode(c.mode) ? PROGRAMME_POLICY_LABELS[c.mode] : `Inconnue · ${c.mode}` : 'Inconnue · contexte absent de cet import'],
    ['Mode Houses correspondant', c && isMode(c.mode) ? PROGRAMME_POLICY_HOUSES[c.mode] : 'Inconnu'],
    ['Filtre d’époque conservé', c ? c.period === '' ? 'Non précisé · aucun filtre' : c.period === 'any' ? 'Code any · aucun filtre' : c.period : 'Inconnu · contexte absent'],
    ['Population du programme', typeof p?.population === 'number' && Number.isFinite(p.population) ? `${p.population.toLocaleString('fr-FR')} hab. de planification` : 'Inconnue'],
    ['Plausibilité historique', HISTORICAL_SCOPE_UNKNOWN],
  ];
  const mappings = p?.cultures?.map(m => {
    const known = (v: unknown) => typeof v === 'string' && v ? v : 'inconnu';
    const coverage = m.coverage === 'shared-pack' ? 'Routage vers un pack partagé' : m.coverage === 'declared-borrowing' ? 'Emprunt géométrique déclaré' : `Code de routage : ${known(m.coverage)}`;
    return `<article data-native-cultural-routing="${xml(known(m.culture))}"><strong>Routage retenu · ${xml(known(m.culture))}</strong><dl>
      <dt>Famille foncière déclarée</dt><dd>${xml(known(m.family))}</dd><dt>Profil fonctionnel</dt><dd>${xml(known(m.functionalProfile))}</dd>
      <dt>Tradition architecturale précise</dt><dd>Inconnue · identifiant non conservé dans cette correspondance</dd><dt>Famille architecturale</dt><dd>${xml(known(m.architectureFamily))}</dd><dt>Pack architectural</dt><dd>${xml(known(m.architecturePack))}</dd>
      <dt>Recette témoin d’admissibilité</dt><dd>${xml(known(m.admissibility?.recipeId))}</dd><dt>Organisation native du témoin</dt><dd>${xml(known(m.admissibility?.nativeLayout))}</dd>
      <dt>Périodes déclarées du témoin</dt><dd>${xml(m.admissibility?.eras?.length ? m.admissibility.eras.join(', ') : 'Non renseignées')}</dd>
      <dt>Portée du routage</dt><dd>${xml(coverage)}</dd>${m.borrowing ? `<dt>Emprunt conservé</dt><dd>${xml(m.borrowing)}</dd>` : ''}</dl></article>`;
  }).join('') || '<small>Routage culturel inconnu : aucune correspondance conservée dans ce programme.</small>';
  return `<details class="advanced" data-programme-policy-evidence><summary>Politique et routage du programme appliqué</summary><dl>${rows.map(([k,v]) => `<dt>${xml(k)}</dt><dd>${xml(v)}</dd>`).join('')}</dl>${mappings}<small>Les profils nommés peuvent décrire une tradition, une organisation ou un thème. Une recette témoin/phase de plan n’est pas la liste des maisons admises ; l’inspecteur architectural lit leur archive réelle. Ni le routage ni une silhouette ne certifient des habitants logés ou une couverture historique.</small></details>`;
}
