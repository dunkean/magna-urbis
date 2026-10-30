/** Programme intent and composable functional specialization. These controls
 * edit the real ProgrammeContext consumed by native demand/allocation. */
import { PROGRAMME_FUNCTIONS, normalizeProgrammeFunctions, type ProgrammeContext, type ProgrammeFunctionWeights,
  type ProgrammeFunction, type ProgrammeIntent } from '../../../rust/bridge/urbanConfig';
import { urbanText } from './urbanPanelLocale';
import { urbanProgrammeLabel } from './urbanBuildingLocale';
import { LOCALE_KEY, savedLocale } from './shellLocale';

export const PROGRAMME_INTENTS: Readonly<Record<ProgrammeIntent, string>> = {
  settlement: 'Agglomération · selon population et culture',
  'isolated-farm': 'Ferme isolée', 'roadside-temple': 'Temple de bord de route',
  'isolated-shrine': 'Sanctuaire isolé', 'isolated-mill': 'Moulin isolé', 'isolated-inn': 'Auberge isolée', 'isolated-tower': 'Tour isolée',
};
export const PROGRAMME_FUNCTION_LABELS: Readonly<Record<ProgrammeFunction, string>> = {
  agricultural: 'Espaces communs et stockage rural', commerce: 'Commerce et marchés', artisan: 'Artisanat',
  riverine: 'Moulins hydrauliques', port: 'Activité portuaire', capital: 'Capitale · équipements institutionnels',
};
export type { ProgrammeIntent };
export interface ProgrammeAxesDraft { intent: ProgrammeIntent; custom: boolean; weights: ProgrammeFunctionWeights; resetAutomatic?: boolean }
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function programmeAxesDraft(context: ProgrammeContext): ProgrammeAxesDraft {
  const weights = context.functions == null ? {} : normalizeProgrammeFunctions(context.functions);
  return { intent: context.intent, custom: context.functions != null, weights };
}
export function applyProgrammeAxesDraft(previous: ProgrammeContext, draft: ProgrammeAxesDraft): ProgrammeContext {
  if (!Object.hasOwn(PROGRAMME_INTENTS, draft.intent)) throw new Error('Intention d’implantation inconnue.');
  const next: ProgrammeContext = { ...previous };
  next.intent = draft.intent;
  if (draft.custom) next.functions = normalizeProgrammeFunctions(draft.weights);
  else if (previous.functions != null || draft.resetAutomatic) delete next.functions;
  return next;
}

/** Quantified effects of the explicit weights, not a promise of admission or
 * measured population capacity. Physical programme minima stay unscaled. */
export function programmeFunctionEffects(value: ProgrammeFunctionWeights): string[] {
  const w = normalizeProgrammeFunctions(value), get = (key: ProgrammeFunction) => w[key] ?? 0;
  const amount = (n: number) => Number(n.toFixed(3)).toLocaleString(typeof window === 'undefined' ? 'fr' : savedLocale());
  const shared = Math.max(get('commerce'), get('port'), get('capital'));
  const mixed=amount(8+17*shared);
  const rows = [urbanText([`Habitat avec boutique : ${mixed} % des ménages dès 150 habitants ; effet commun compté une seule fois.`,`Housing with shop: ${mixed}% of households from 150 inhabitants; shared effect counted once.`,`带商铺住宅：从 150 人起占 ${mixed}% 的家庭；共同效应仅计算一次。`,`Vivienda con tienda: ${mixed} % de hogares desde 150 habitantes; efecto común contado una vez.`,`Moradia com loja: ${mixed}% dos domicílios a partir de 150 habitantes; efeito comum contado uma vez.`])];
  if (get('agricultural') > 0) { const area=amount(.5+1.5*get('agricultural')), multiplier=amount(1+get('agricultural')); rows.push(urbanText([`Espaces communs : ${area} m²/hab. hors profil communal ; stockage rural ×${multiplier}.`,`Commons: ${area} m²/person outside the communal profile; rural storage ×${multiplier}.`,`公共空间：非公共配置下 ${area} 平方米/人；乡村储存 ×${multiplier}。`,`Espacios comunes: ${area} m²/hab. fuera del perfil comunal; almacenamiento rural ×${multiplier}.`,`Espaços comuns: ${area} m²/hab. fora do perfil comunal; armazenamento rural ×${multiplier}.`])); }
  if (get('commerce') > 0) { const services=amount(1+get('commerce')), markets=amount(1+2*get('commerce')); rows.push(urbanText([`Services commerciaux ×${services} ; coefficient des marchés ×${markets}.`,`Commercial services ×${services}; market coefficient ×${markets}.`,`商业服务 ×${services}；市场系数 ×${markets}。`,`Servicios comerciales ×${services}; coeficiente de mercados ×${markets}.`,`Serviços comerciais ×${services}; coeficiente de mercados ×${markets}.`])); }
  if (get('artisan') > 0) { const area=amount(3.5*get('artisan')), multiplier=amount(1+get('artisan')); rows.push(urbanText([`Ateliers : ${area} m²/hab., minimum 80 m² ; services d’artisanat ×${multiplier}.`,`Workshops: ${area} m²/person, minimum 80 m²; craft services ×${multiplier}.`,`作坊：${area} 平方米/人，至少 80 平方米；手工业服务 ×${multiplier}。`,`Talleres: ${area} m²/hab., mínimo 80 m²; servicios artesanales ×${multiplier}.`,`Oficinas: ${area} m²/hab., mínimo 80 m²; serviços artesanais ×${multiplier}.`])); }
  if (get('riverine') > 0) { const n=amount(1+get('riverine')); rows.push(urbanText([`Moulins ×${n}, sans créer de rivière. Les mêmes moulins ne sont pas multipliés une seconde fois par l’artisanat.`,`Mills ×${n}, without creating a river. Craft does not multiply the same mills a second time.`,`磨坊 ×${n}，不会创建河流。手工业不会再次增加同一批磨坊。`,`Molinos ×${n}, sin crear un río. La artesanía no multiplica los mismos molinos una segunda vez.`,`Moinhos ×${n}, sem criar um rio. O artesanato não multiplica os mesmos moinhos uma segunda vez.`])); }
  if (get('port') > 0) { const area=amount(2*get('port')); rows.push(urbanText([`Stockage portuaire : ${area} m²/hab., minimum 180 m² ; alloué seulement sur un quai mesuré au bord d’un chenal navigable.`,`Port storage: ${area} m²/person, minimum 180 m²; allocated only on a measured quay beside a navigable channel.`,`港口储存：${area} 平方米/人，至少 180 平方米；仅分配在可通航水道旁实测的码头上。`,`Almacenamiento portuario: ${area} m²/hab., mínimo 180 m²; solo se asigna en un muelle medido junto a un canal navegable.`,`Armazenamento portuário: ${area} m²/hab., mínimo 180 m²; só é alocado num cais medido junto a um canal navegável.`])); }
  if (get('capital') > 0) { const n=amount(1-.75*get('capital')); rows.push(urbanText([`Seuils de population des équipements politiques, d’élite et défensifs ×${n}.`,`Population thresholds for political, elite and defensive facilities ×${n}.`,`政治、精英和防御设施的人口门槛 ×${n}。`,`Umbrales de población de equipamientos políticos, de élite y defensivos ×${n}.`,`Limiares populacionais de instalações políticas, de elite e defensivas ×${n}.`])); }
  rows.push(urbanText(['Les nombres de services sont entiers, arrondis vers le bas après pondération : ×1,5 peut conserver un seul service. Les limites du catalogue restent appliquées.','Service counts are integers rounded down after weighting: ×1.5 can retain a single service. Catalogue limits still apply.','服务数量为整数，加权后向下取整：×1.5 可能仍只有一个服务。目录限制仍然适用。','Los servicios son enteros redondeados hacia abajo tras la ponderación: ×1,5 puede conservar un solo servicio. Se mantienen los límites del catálogo.','Os serviços são inteiros arredondados para baixo após a ponderação: ×1,5 pode manter um único serviço. Os limites do catálogo continuam aplicáveis.']));
  return rows;
}
export function programmeFunctionsSummary(context?: ProgrammeContext): string {
  if (!context) return urbanText(['Spécialisation fonctionnelle inconnue : contexte absent de cette scène.','Functional specialization unknown: context missing from this scene.','功能专业化未知：此场景缺少上下文。','Especialización funcional desconocida: falta el contexto de esta escena.','Especialização funcional desconhecida: contexto ausente desta cena.']);
  return `${programmeIntentLabel(context)} ; ${programmeSpecialisationSummary(context)}.`;
}
export const programmeIntentLabel = (context: ProgrammeContext): string => urbanProgrammeLabel('intent', context.intent, PROGRAMME_INTENTS[context.intent] ?? context.intent);
/** The specialisation axis alone: explicit weights, automatic resolution, or not applicable (isolated intent). */
export function programmeSpecialisationSummary(context: ProgrammeContext): string {
  const draft = programmeAxesDraft(context);
  if (draft.intent !== 'settlement') return urbanText(['fonctions urbaines non applicables','urban functions not applicable','城市功能不适用','funciones urbanas no aplicables','funções urbanas não aplicáveis']);
  if (!draft.custom) return urbanText(['fonctions automatiques : agriculture sous 500 hab. ou profil communal, port si implanté comme port','automatic functions: farming below 500 inhabitants or with a communal profile, port when sited as a port','自动功能：500 人以下或公共配置为农业，按港口布局时为港口','funciones automáticas: agricultura por debajo de 500 hab. o con perfil comunal, puerto si se implanta como puerto','funções automáticas: agricultura abaixo de 500 hab. ou com perfil comunal, porto se implantado como porto']);
  const active = PROGRAMME_FUNCTIONS.filter(key => (draft.weights[key] ?? 0) > 0).map(key => `${urbanProgrammeLabel('function', key, PROGRAMME_FUNCTION_LABELS[key])} ${draft.weights[key]}`);
  return active.length ? active.join(' · ') : urbanText(['aucune spécialisation fonctionnelle imposée','no functional specialization imposed','未强制功能专业化','sin especialización funcional obligatoria','nenhuma especialização funcional imposta']);
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
    note.textContent = isIsolated ? urbanText(['Cet établissement isolé applique seulement son intention. Les fonctions urbaines sont conservées mais non applicables.','This isolated place applies only its intent. Urban functions are retained but not applicable.','此孤立地点仅应用其意图。城市功能被保留但不适用。','Este lugar aislado solo aplica su intención. Las funciones urbanas se conservan, pero no son aplicables.','Este local isolado aplica apenas sua intenção. As funções urbanas são mantidas, mas não se aplicam.'])
      : custom.checked ? urbanText(['Ces fonctions orientent les besoins et services, sans simuler une économie. Les effets communs ne s’additionnent pas. Les ressources connues peuvent également demander des ateliers.','These functions guide needs and services without simulating an economy. Shared effects do not add up. Known resources can also require workshops.','这些功能影响需求和服务，但不模拟经济。共同效应不叠加。已知资源也可能需要作坊。','Estas funciones orientan necesidades y servicios sin simular una economía. Los efectos comunes no se suman. Los recursos conocidos también pueden requerir talleres.','Estas funções orientam necessidades e serviços sem simular uma economia. Efeitos comuns não se somam. Recursos conhecidos também podem exigir oficinas.'])
      : resetAutomatic ? urbanText(['Fonctions selon le lieu et le profil culturel ; ancienne spécialisation exclusive retirée.','Functions follow the place and cultural profile; the former exclusive specialization is removed.','功能根据地点和文化配置确定；已移除旧的独占专业化。','Las funciones siguen el lugar y el perfil cultural; se elimina la especialización exclusiva anterior.','As funções seguem o local e o perfil cultural; a antiga especialização exclusiva é removida.']) : programmeFunctionsSummary(context);
    effects.hidden = isIsolated || !custom.checked;
    if (!effects.hidden) {
      try { effects.innerHTML = programmeFunctionEffects(weights()).map(row => `<li>${xml(row)}</li>`).join(''); }
      catch (error) { effects.textContent = error instanceof Error ? error.message : 'Poids invalides.'; }
    } else effects.replaceChildren();
  };
  host.addEventListener('change', refresh);
  if (typeof window !== 'undefined') {
    window.addEventListener('magna-locale-change', () => { if (context) refresh(); });
    window.addEventListener('storage', event => { if (event.key === LOCALE_KEY && context) refresh(); });
  }
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
