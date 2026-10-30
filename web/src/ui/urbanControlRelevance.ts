/** Read-only control relevance, not a duplicate native resolver. Small native
 * kinds can fall back to quarters; their controls must remain editable. */
import { MORPHOLOGY_LABELS } from './urbanMorphology';
import { PROGRAMME_INTENTS } from './urbanProgrammeFunctions';
export const DIRECT_SMALL_KINDS: readonly string[] = ['single', 'ruin', 'farmstead', 'camp', 'hamlet', 'street-village'];
export const ISOLATED_INTENTS: readonly string[] = Object.keys(PROGRAMME_INTENTS).filter(role => role !== 'settlement');
/** Fields of quarter composition absent from the direct grammar and its common
 * postpasses. mechanism/epochs, recipe/preset/morph/tissue/access/grades are
 * deliberately excluded: dispatch, validation or postpasses can consume them. */
export const DIRECT_QUARTER_FIELDS = ['footprint.family', 'footprint.budget', 'footprint.grossDensity', 'footprint.aspect', 'footprint.orientation', 'footprint.nuclei',
  'footprint.irregularity', 'footprint.anisotropy', 'footprint.separation', 'footprint.cohesion', 'footprint.satellites', 'footprint.branchDepth', 'footprint.gapSize',
  'phases', 'suburbs', 'mixCulture', 'mixMode', 'mixShare', 'mixAngle'] as const;
export interface RelevanceConfig {
  settlementForm?: string; scope?: string; footprint?: { mechanism?: string };
  programme?: { intent?: string }; overrides?: { quarters?: object };
}
export interface RelevanceLayout {
  key: string; archetype?: string; config?: RelevanceConfig;
  structure?: { mechanism: string; family: string };
}
const knownNonLegacyMechanism = (value: unknown) => typeof value === 'string' && ['auto', 'planned', 'accessibility', 'ribbon', 'fusion'].includes(value);
const knownForm = (form: string) => Object.hasOwn(MORPHOLOGY_LABELS, form);
const formLabel = (form: string) => Object.entries(MORPHOLOGY_LABELS).find(([id]) => id === form)?.[1] ?? form;
const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function requestedControlRelevance(config: RelevanceConfig): string {
  const form = config.settlementForm, role = config.programme?.intent;
  const forcedForm = form !== undefined && knownForm(form) ? form : undefined;
  const priority = forcedForm !== undefined ? `Forme imposée « ${formLabel(forcedForm)} » prioritaire${role && ISOLATED_INTENTS.includes(role) ? ` sur l’intention isolée ${role}` : ''}. ` : '';
  if (config.footprint?.mechanism === 'legacy') return `${priority}Mécanisme historique : le chemin direct des petites grammaires est désactivé dans le natif ; les réglages de quartiers restent éditables.`;
  if (config.footprint?.mechanism === undefined) return `${priority}Mécanisme non conservé : aucun chemin de génération déduit. Réglages conservés et éditables.`;
  if (!knownNonLegacyMechanism(config.footprint?.mechanism)) return `${priority}Mécanisme importé inconnu : aucun chemin déduit ; valeur conservée pour validation native.`;
  if (forcedForm !== undefined && !DIRECT_SMALL_KINDS.includes(forcedForm)) return `${priority}Cette forme passe par la grammaire de quartiers ; une intention isolée ne suffit pas à rendre ses réglages inapplicables.`;
  const expectedSmall = forcedForm !== undefined && DIRECT_SMALL_KINDS.includes(forcedForm) || form === 'auto' && role !== undefined && ISOLATED_INTENTS.includes(role);
  if (expectedSmall) return `${priority}${forcedForm !== undefined ? 'Petite grammaire directe demandée, sous réserve de validation native.' : `Automatique + intention isolée ${role} : une petite grammaire directe est attendue sous réserve de validation native.`} Emprise de croissance, phases/faubourgs et seconde influence ne pilotent pas cette composition directe. Un échec sur le site peut toutefois déclencher le repli en quartiers : leurs valeurs restent conservées et éditables pour ce repli. Recettes, paramètres morphologiques, maillage et accès peuvent encore intervenir dans la validation ou les étapes communes.`;
  if (form !== undefined && !['auto', 'nucleated', 'ribbon'].includes(form)) return 'Forme importée inconnue : aucun chemin ni compatibilité déduits. Valeur conservée pour validation native ; les réglages restent éditables.';
  return 'Le chemin dépend de la résolution native du site, de la population et du profil. Cette UI ne le prédit pas ; aucun réglage n’est désactivé par supposition. Les préférences de village ne sont pas des formes forcées.';
}
/** A returned archetype alone is not a direct-path proof: stamp writes it even
 * after lay_out returns None and quarters succeeds. Edits may splice paths. */
export function retainedControlRelevance(layout: RelevanceLayout): { direct: boolean; text: string } {
  const prefix = `Plan conservé « ${layout.key} » : `;
  if (!layout.config || !layout.structure || !layout.archetype) return { direct: false, text: prefix + 'chemin non documenté ; aucun paramètre déclaré sans effet à partir des réglages actuels.' };
  if (layout.config.footprint?.mechanism === 'legacy') return { direct: false, text: prefix + 'mécanisme historique ; aucune petite grammaire directe attestée.' };
  if (Object.keys(layout.config.overrides?.quarters ?? {}).length) return { direct: false, text: prefix + 'retouches de quartiers conservées ; le marquage seul ne documente pas tous les chemins du plan composé.' };
  const direct = knownNonLegacyMechanism(layout.config.footprint?.mechanism) && layout.structure.mechanism === 'kind'
    && layout.structure.family === layout.archetype && DIRECT_SMALL_KINDS.includes(layout.archetype);
  if (!direct) return { direct: false, text: prefix + `mécanisme retourné « ${layout.structure.mechanism} », archétype « ${layout.archetype} ». Cela ne prouve pas une composition directe ; aucun paramètre déclaré sans effet.` };
  return { direct: true, text: prefix + `composition directe « ${formLabel(layout.archetype)} » conservée (mechanism=kind, family=archetype, sans retouche de quartier). Sur CE plan, la composition de quartiers n’a pas piloté les champs suivants : ${DIRECT_QUARTER_FIELDS.join(', ')}. Ils restent éditables pour une nouvelle demande et son éventuel repli. Les étapes communes de validation, recettes, accès et programme restent actives ; ceci ne certifie ni maisons admises ni capacité habitante.` };
}
export function controlRelevanceControlsHtml(): string {
  return '<div data-control-relevance><small data-control-relevance-requested role="status"></small><details class="advanced"><summary>Pertinence des réglages · plan conservé</summary><div data-control-relevance-retained></div></details></div>';
}
/** Real themed roots call sync on draft read, programme apply, populate and
 * draw/restore. It never changes input values, disabled flags or generation. */
export function bindControlRelevance(host: ParentNode) {
  const requested = host.querySelector<HTMLElement>('[data-control-relevance-requested]');
  const retained = host.querySelector<HTMLElement>('[data-control-relevance-retained]');
  if (!requested || !retained) throw new Error('Missing control relevance diagnostics.');
  let previousLayouts: readonly RelevanceLayout[] | undefined, hasRetained = false;
  return { sync(config: RelevanceConfig, layouts?: readonly RelevanceLayout[]): void {
    const text = requestedControlRelevance(config); if (requested.textContent !== text) requested.textContent = text;
    if (hasRetained && layouts === previousLayouts) return;
    previousLayouts = layouts; hasRetained = true;
    retained.innerHTML = layouts?.length ? layouts.map(layout => {
      const row = retainedControlRelevance(layout); return `<p data-control-direct="${row.direct}">${xml(row.text)}</p>`;
    }).join('') : '<small>Aucun plan retourné : aucune non-utilisation de paramètre déduite de la demande courante.</small>';
  } };
}
