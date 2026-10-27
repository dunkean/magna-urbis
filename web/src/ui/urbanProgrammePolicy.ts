/** Urban policy controls and retained programme evidence. A routing witness is
 * not a built house or a culture×era×population historical certification. */
import type { ProgrammeContext } from '../../../rust/bridge/urbanConfig';
import type { UrbanProgramme } from '../../../rust/bridge/urban';
import nativeAdmissionPeriods from '../data/nativeAdmissionPeriods.json';
import { retainSelectValue } from './retainedSelectValue';
import { urbanText } from './urbanPanelLocale';
import { LOCALE_KEY, savedLocale } from './shellLocale';
import { urbanProgrammeLabel } from './urbanBuildingLocale';
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const PROGRAMME_POLICY_LABELS: Record<ProgrammeContext['mode'], string> = {
  strict: 'Strict · contrôles de sources et d’emprunts', inspired: 'Inspiré · adaptations permises par les sources', fantasy: 'Fantasy · mélanges déclarés',
};
export const PROGRAMME_POLICY_HOUSES: Record<ProgrammeContext['mode'], string> = { strict: 'historical_strict', inspired: 'historical_inspired', fantasy: 'fantasy_mix' };
export const PROGRAMME_CATALOGUE_PERIODS = [...nativeAdmissionPeriods.periods];
export const HISTORICAL_SCOPE_UNKNOWN = 'Culture × époque × échelle : inconnue ; ce contrat ne conserve aucune plage historique documentée. Aucun plafond culturel n’est déduit.';
const historicalScope = (): string => urbanText([HISTORICAL_SCOPE_UNKNOWN,'Culture × period × scale: unknown; this contract retains no documented historical range. No cultural upper bound is inferred.','文化 × 时期 × 规模：未知；此契约不保存已记录的历史范围。不推断文化上限。','Cultura × época × escala: desconocida; este contrato no conserva un intervalo histórico documentado. No se deduce ningún límite cultural.','Cultura × período × escala: desconhecida; este contrato não conserva uma faixa histórica documentada. Nenhum limite cultural é inferido.']);
const isMode = (mode: string): mode is ProgrammeContext['mode'] => Object.hasOwn(PROGRAMME_POLICY_LABELS, mode);
export function programmePolicyExplanation(mode: string): string {
  const policy = isMode(mode) ? mode === 'strict' ? urbanText(['Refuse les emprunts déclarés et applique les contrôles natifs de source ; ne certifie pas l’histoire de la ville.','Rejects declared borrowing and applies native source checks; it does not certify the city’s history.','拒绝已声明的借用并执行原生来源检查；不证明城市的历史。','Rechaza los préstamos declarados y aplica controles nativos de fuente; no certifica la historia de la ciudad.','Recusa empréstimos declarados e aplica verificações nativas de fonte; não certifica a história da cidade.'])
    : mode === 'inspired' ? urbanText(['Autorise certaines adaptations/emprunts déclarés ; les contrôles physiques restent requis.','Allows some declared adaptations/borrowing; physical checks remain required.','允许部分已声明的改编或借用；仍需物理检查。','Permite algunas adaptaciones o préstamos declarados; siguen siendo necesarios los controles físicos.','Permite algumas adaptações ou empréstimos declarados; as verificações físicas continuam necessárias.'])
      : urbanText(['Autorise les mélanges prévus par le catalogue ; la validité physique n’est pas dispensée.','Allows catalogue-supported mixes; physical validity remains required.','允许目录支持的混合；仍需满足物理有效性。','Permite las mezclas previstas por el catálogo; sigue siendo necesaria la validez física.','Permite as misturas previstas pelo catálogo; a validade física continua necessária.']) : urbanText([`Politique conservée non prise en charge par cette UI : ${mode}. Corrigez-la explicitement avant application.`,`Retained policy unsupported by this UI: ${mode}. Correct it explicitly before applying.`,`此界面不支持保留的策略：${mode}。请在应用前明确修正。`,`Política conservada no admitida por esta interfaz: ${mode}. Corrígela explícitamente antes de aplicar.`,`Política mantida não suportada nesta interface: ${mode}. Corrija-a explicitamente antes de aplicar.`]);
  return `${policy} ${historicalScope()}`;
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
  if (typeof window !== 'undefined') {
    window.addEventListener('magna-locale-change', refresh);
    window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) refresh(); });
  }
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
  const unknown = urbanText(['Inconnu','Unknown','未知','Desconocido','Desconhecido']);
  const unknownContext = urbanText(['Inconnu · contexte absent','Unknown · context absent','未知 · 缺少上下文','Desconocido · falta el contexto','Desconhecido · contexto ausente']);
  const rows: [string, string][] = [
    [urbanText(['Politique conservée au programme','Policy retained in program','规划中保留的策略','Política conservada en el programa','Política mantida no programa']), c ? isMode(c.mode) ? urbanProgrammeLabel('policy', c.mode, PROGRAMME_POLICY_LABELS[c.mode]) : `${unknown} · ${c.mode}` : urbanText(['Inconnue · contexte absent de cet import','Unknown · context missing from this import','未知 · 此导入缺少上下文','Desconocida · falta el contexto de esta importación','Desconhecida · contexto ausente desta importação'])],
    [urbanText(['Mode Houses correspondant','Corresponding Houses mode','对应的房屋模式','Modo de Casas correspondiente','Modo de Casas correspondente']), c && isMode(c.mode) ? PROGRAMME_POLICY_HOUSES[c.mode] : unknown],
    [urbanText(['Filtre d’époque conservé','Retained period filter','保留的时期筛选','Filtro de época conservado','Filtro de período mantido']), c ? c.period === '' ? urbanText(['Non précisé · aucun filtre','Unspecified · no filter','未指定 · 无筛选','No especificado · sin filtro','Não especificado · sem filtro']) : c.period === 'any' ? urbanText(['Code any · aucun filtre','Code any · no filter','代码 any · 无筛选','Código any · sin filtro','Código any · sem filtro']) : c.period : unknownContext],
    [urbanText(['Population du programme','Program population','规划人口','Población del programa','População do programa']), typeof p?.population === 'number' && Number.isFinite(p.population) ? `${p.population.toLocaleString(typeof window === 'undefined' ? 'fr-FR' : savedLocale())} ${urbanText(['hab. de planification','planning inhabitants','规划人口','hab. de planificación','hab. de planejamento'])}` : unknown],
    [urbanText(['Plausibilité historique','Historical plausibility','历史可信度','Plausibilidad histórica','Plausibilidade histórica']), historicalScope()],
  ];
  const mappings = p?.cultures?.map(m => {
    const known = (v: unknown) => typeof v === 'string' && v ? v : unknown.toLowerCase();
    const coverage = m.coverage === 'shared-pack' ? urbanText(['Routage vers un pack partagé','Routing to a shared pack','分配到共享包','Asignación a un paquete compartido','Encaminhamento para um pacote compartilhado']) : m.coverage === 'declared-borrowing' ? urbanText(['Emprunt géométrique déclaré','Declared geometric borrowing','已声明的几何借用','Préstamo geométrico declarado','Empréstimo geométrico declarado']) : `${urbanText(['Code de routage','Routing code','分配代码','Código de asignación','Código de encaminhamento'])} : ${known(m.coverage)}`;
    return `<article data-native-cultural-routing="${xml(known(m.culture))}"><strong>${urbanText(['Routage retenu','Retained routing','保留的分配','Asignación conservada','Encaminhamento mantido'])} · ${xml(known(m.culture))}</strong><dl>
      <dt>${urbanText(['Famille foncière déclarée','Declared land family','已声明的土地类型','Familia parcelaria declarada','Família fundiária declarada'])}</dt><dd>${xml(known(m.family))}</dd><dt>${urbanText(['Profil fonctionnel','Functional profile','功能配置','Perfil funcional','Perfil funcional'])}</dt><dd>${xml(known(m.functionalProfile))}</dd>
      <dt>${urbanText(['Tradition architecturale précise','Specific architectural tradition','具体建筑传统','Tradición arquitectónica concreta','Tradição arquitetônica específica'])}</dt><dd>${urbanText(['Inconnue · identifiant non conservé dans cette correspondance','Unknown · identifier not retained in this mapping','未知 · 此映射未保留标识符','Desconocida · identificador no conservado en esta correspondencia','Desconhecida · identificador não mantido nesta correspondência'])}</dd><dt>${urbanText(['Famille architecturale','Architectural family','建筑类型','Familia arquitectónica','Família arquitetônica'])}</dt><dd>${xml(known(m.architectureFamily))}</dd><dt>${urbanText(['Pack architectural','Architecture pack','建筑包','Paquete arquitectónico','Pacote arquitetônico'])}</dt><dd>${xml(known(m.architecturePack))}</dd>
      <dt>${urbanText(['Recette témoin d’admissibilité','Admission witness recipe','接纳性参考配方','Receta de referencia de admisión','Receita de referência de admissão'])}</dt><dd>${xml(known(m.admissibility?.recipeId))}</dd><dt>${urbanText(['Organisation native du témoin','Witness native organization','参考方案的原生组织','Organización nativa de referencia','Organização nativa de referência'])}</dt><dd>${xml(known(m.admissibility?.nativeLayout))}</dd>
      <dt>${urbanText(['Périodes déclarées du témoin','Witness declared periods','参考方案声明的时期','Épocas declaradas de referencia','Períodos declarados da referência'])}</dt><dd>${xml(m.admissibility?.eras?.length ? m.admissibility.eras.join(', ') : urbanText(['Non renseignées','Not specified','未提供','No indicadas','Não informados']))}</dd>
      <dt>${urbanText(['Portée du routage','Routing scope','分配范围','Alcance de la asignación','Escopo do encaminhamento'])}</dt><dd>${xml(coverage)}</dd>${m.borrowing ? `<dt>${urbanText(['Emprunt conservé','Retained borrowing','保留的借用','Préstamo conservado','Empréstimo mantido'])}</dt><dd>${xml(m.borrowing)}</dd>` : ''}</dl></article>`;
  }).join('') || `<small>${urbanText(['Routage culturel inconnu : aucune correspondance conservée dans ce programme.','Cultural routing unknown: no mapping retained in this program.','文化分配未知：此规划未保留映射。','Asignación cultural desconocida: no se conserva ninguna correspondencia en este programa.','Encaminhamento cultural desconhecido: nenhum mapeamento mantido neste programa.'])}</small>`;
  return `<details class="advanced" data-programme-policy-evidence><summary>${urbanText(['Politique et routage du programme appliqué','Applied program policy and routing','已应用规划的策略与分配','Política y asignación del programa aplicado','Política e encaminhamento do programa aplicado'])}</summary><dl>${rows.map(([k,v]) => `<dt>${xml(k)}</dt><dd>${xml(v)}</dd>`).join('')}</dl>${mappings}<small>${urbanText(['Les profils nommés peuvent décrire une tradition, une organisation ou un thème. Une recette témoin/phase de plan n’est pas la liste des maisons admises ; l’inspecteur architectural lit leur archive réelle. Ni le routage ni une silhouette ne certifient des habitants logés ou une couverture historique.','Named profiles can describe a tradition, organization or theme. A witness recipe/plan phase is not the list of admitted houses; the architecture inspector reads their actual archive. Neither routing nor a silhouette certifies housed inhabitants or historical coverage.','命名配置可以描述传统、组织或主题。参考配方/规划阶段不是已接纳房屋的清单；建筑检查器读取其实际档案。分配和轮廓都不能证明实际居住人口或历史覆盖。','Los perfiles pueden describir una tradición, organización o tema. Una receta de referencia o fase del plan no es la lista de casas admitidas; el inspector arquitectónico lee su archivo real. Ni la asignación ni una silueta certifican habitantes alojados o cobertura histórica.','Os perfis podem descrever uma tradição, organização ou tema. Uma receita de referência ou fase do plano não é a lista de casas admitidas; o inspetor arquitetônico lê seu arquivo real. Nem o encaminhamento nem uma silhueta certificam habitantes alojados ou cobertura histórica.'])}</small></details>`;
}
