import { bindProgrammeTokenControls } from './urbanProgrammeTokens';
import { recordStageMs } from './benchTimings';
import { bindProgrammeConditionControls, programmeConditionControlsHtml, programmeConditionEvidenceHtml } from './urbanProgrammeCondition';
import { retainSelectValue } from './retainedSelectValue';
import { bindProgrammePolicyControls, programmePolicyControlsHtml, programmePolicyEvidenceHtml } from './urbanProgrammePolicy';
import { copyParentBuildingState, type UrbanParentBuildingState } from './urbanParentState';
import type { ParentMapSelection } from './urbanParentColdWindow';
import type { NativeParentRead } from './urbanParentNativeRead';
import { nativeParentHasSelection, nativeParentInspectionHtml } from './urbanParentInspector';
import type { UrbanProgramme } from '../../../rust/bridge/urban';
import urbanCatalogue from '../../../rust/crates/core/src/urban/catalogue.json';
import './urbanBuildings.css';
import { openMethodNote } from './methodNotes';
import { defaultProgrammeContext, type ProgrammeContext } from '../../../rust/bridge/urbanConfig';
import { hasHouseMix, type PlacementBatch, type PlacedBuilding, type PlacementBatchSettings, type HouseSettings } from '../../../rust/bridge/urbanArchitecture';
import { openBench } from './benchHistory';
import { readUrbanHouseModel, urbanHouseModelCode } from './urbanHouseModel';
import { buildingHeight } from '../render/urbanBuildings';
import { programmeBalanceEvidence } from './urbanProgrammeEvidence';
import { hasBuiltOutcomeBalance } from '../../../rust/bridge/urbanBuiltBalance';
import { programmeOutcomeRows } from '../render/programmeOutcome';
import { retainedBodyInventoryRows } from '../render/retainedBuildingInventory';
import { urbanCapacityWarningText, urbanCapacityScopeText } from './urbanCapacityWording';
import { URBAN_FUNCTION_LABELS, type UrbanBuildingAppearance, type UrbanBuildingDiagnostic, type UrbanBuildingStyle } from '../render/urbanBuildingStyle';
import type { UrbanColdSceneResponse } from './urbanScene';
import type { BuildingChunkRead } from './urbanBuildingChunkStore';
import type { PlanArchiveScene } from '../../../rust/bridge/compactPlanArchive';
import type { NativeBuildingProjectionRefusal } from './urbanBuildingProjection';
import { programmeFunctionControlsHtml, bindProgrammeFunctionControls, programmeFunctionsSummary } from './urbanProgrammeFunctions';
import { setupUrbanBuildingLocale } from './urbanBuildingLocale';
import { localizeCityInspector } from './cityInspectorLocale';
import { urbanText } from './urbanPanelLocale';
import { LOCALE_KEY } from './shellLocale';

export interface UrbanBuildingDraft { seed: string; floors: string; typology: string; model: string; culture?: string; fit?: boolean; houses?: HouseSettings }
export type UrbanColdBuildingState = Pick<UrbanColdSceneResponse, 'store' | 'counts'> & {
  offset?: { x: number; y: number }; cityKey?: string;
};
export type UrbanBuildingGenerateResult = ({ scene: PlacementBatch; cold?: never; parent?: never } | { cold: UrbanColdBuildingState; scene?: never; parent?: never }
  | { parent: UrbanParentBuildingState; scene?: never; cold?: never }) & { timing?: { sites: number; placement: number }; generationNote?: string };
export interface UrbanBuildingState {
  seed: string; visible: boolean; appearance: UrbanBuildingAppearance; scene?: PlacementBatch;
  cold?: UrbanColdBuildingState; parent?: UrbanParentBuildingState; parentSelected?: ParentMapSelection;
  architectureContract?: 'parent-session-1' | 'legacy-plan'; generationNote?: string;
  generated?: boolean;
  settings?: PlacementBatchSettings;
  selected?: string; projection?: boolean; camera?: import('./terrain3d').Terrain3dCamera;
}
const xml = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const functionName = (key: string): string => {
  const labels: Record<string, readonly [string, string, string, string, string]> = {
    housing:['Habitat','Housing','住宅','Vivienda','Habitação'], residential:['Habitat','Housing','住宅','Vivienda','Habitação'],
    commerce:['Commerce','Commerce','商业','Comercio','Comércio'], craft:['Artisanat','Craft','手工业','Artesanía','Artesanato'],
    institution:['Institution','Institution','机构','Institución','Instituição'], market:['Marché','Market','市场','Mercado','Mercado'],
    common:['Communs','Commons','公共空间','Espacios comunes','Espaços comuns'], agriculture:['Agriculture','Agriculture','农业','Agricultura','Agricultura'],
  };
  return labels[key] ? urbanText(labels[key]) : (URBAN_FUNCTION_LABELS as Record<string, string>)[key] ?? key;
};

export type UrbanBuildingPanelSelection = { status: 'none' } | { status: 'pending' | 'missing'; id: string }
  | { status: 'error'; id: string; message: string } | { status: 'ready'; id: string; value: BuildingChunkRead }
  | { status: 'parent_pending'; id: string }
  | { status: 'parent_ready'; id: string; value: NativeParentRead; pick: ParentMapSelection }
  | { status: 'parent_error'; id: string; message: string };
const coldIdentity = (cold: UrbanColdBuildingState) => JSON.stringify([cold.store.sceneId, cold.store.fingerprint,
  cold.store.sourceFingerprint, cold.counts.generator_version, cold.cityKey ?? null, cold.offset?.x ?? 0, cold.offset?.y ?? 0]);
function panelState(value: UrbanBuildingState): UrbanBuildingState {
  if ([value.scene, value.cold, value.parent].filter(Boolean).length > 1) throw new Error('Une scène bâtie ne peut pas conserver à la fois une scène native et un stockage froid.');
  const cold = value.cold;
  if (cold?.offset !== undefined && (!cold.offset || !Number.isFinite(cold.offset.x) || !Number.isFinite(cold.offset.y)))
    throw new Error('Le décalage de la scène bâtie doit contenir deux coordonnées finies.');
  if (cold?.cityKey !== undefined && (typeof cold.cityKey !== 'string' || !cold.cityKey.length))
    throw new Error('La clé de ville de la scène bâtie doit être une chaîne non vide.');
  const offset = cold?.offset, parent = value.parent && copyParentBuildingState(value.parent);
  return { seed: value.seed, visible: value.visible, appearance: value.appearance, generated: value.generated,
    settings: value.settings, projection: parent ? false : value.projection, camera: value.camera, scene: cold || parent ? undefined : value.scene,
    ...(parent ? { parent, parentSelected: value.parentSelected } : {}),
    ...(value.architectureContract ? { architectureContract: value.architectureContract } : {}), ...(value.generationNote !== undefined ? { generationNote: value.generationNote } : {}),
    cold: cold ? Object.freeze({ store: Object.freeze({ format: cold.store.format, sceneId: cold.store.sceneId,
      fingerprint: cold.store.fingerprint, sourceFingerprint: cold.store.sourceFingerprint }),
    counts: Object.freeze({ schema_version: cold.counts.schema_version, generator_version: cold.counts.generator_version,
      buildings: cold.counts.buildings, refusals: cold.counts.refusals, open_spaces: cold.counts.open_spaces }),
      ...(cold.cityKey !== undefined ? { cityKey: cold.cityKey } : {}),
      ...(offset && (offset.x !== 0 || offset.y !== 0) ? { offset: Object.freeze({ x: offset.x === 0 ? 0 : offset.x, y: offset.y === 0 ? 0 : offset.y }) } : {}) }) : undefined,
    selected: parent ? undefined : cold ? value.selected : value.scene?.buildings.some(b => b.id === value.selected) ? value.selected : undefined };
}
export function urbanBuildingPanelSummary(state: UrbanBuildingState): string {
  const refusals = urbanText(['refus','refusals','项拒绝','rechazos','recusas']);
  const open = urbanText(['issues ouvertes','open outcomes','项未解决结果','resultados abiertos','resultados abertos']);
  if (state.parent) { const c = state.parent.counts; return `${c.admitted_parents} ${urbanText(['parents admis','admitted parents','个已接纳父对象','elementos principales admitidos','objetos principais admitidos'])} · ${c.physical_members} ${urbanText(['membres natifs','native members','个原生成员','miembros nativos','membros nativos'])} · ${c.refusals} ${refusals} · ${c.open_spaces} ${open} · ${urbanText(['capacité résidentielle inconnue','residential capacity unknown','居住容量未知','capacidad residencial desconocida','capacidade residencial desconhecida'])}`; }
  if (state.cold) {
    const c = state.cold.counts;
    return `${c.buildings} ${urbanText(['plans de bâtiments','building plans','份建筑方案','planos de edificios','planos de edifícios'])} · ${c.refusals} ${refusals} · ${c.open_spaces} ${open} · ${urbanText(['capacité non évaluée','capacity not assessed','容量未评估','capacidad no evaluada','capacidade não avaliada'])}`;
  }
  const scene = state.scene;
  return scene ? `${scene.buildings.length} ${urbanText(['bâtiments','buildings','栋建筑','edificios','edifícios'])} · ${scene.refusals.length} ${refusals} · ${scene.open_spaces.length} ${open}`
    : urbanText(['Générez les parcelles pour implanter les bâtiments.','Generate parcels before placing buildings.','请先生成地块，再放置建筑。','Genera las parcelas antes de implantar edificios.','Gere os lotes antes de implantar edifícios.']);
}
/** Missing metadata differs from an authenticated empty list. Counts continue
 * to come from the committed manifest, never an inferred native batch. */
export function urbanBuildingPanelRefusalsHtml(state: UrbanBuildingState, coldRefusals?: readonly NativeBuildingProjectionRefusal[]): string {
  if (state.parent) return state.parent.counts.refusals ? `<li>${state.parent.counts.refusals} ${urbanText(['refus conservés dans les archives natives.','refusals retained in native archives.','项拒绝记录保存在原生档案中。','rechazos conservados en los archivos nativos.','recusas mantidas nos arquivos nativos.'])}</li>` : '';
  if (state.cold && coldRefusals === undefined) return state.cold.counts.refusals
    ? `<li>${state.cold.counts.refusals} ${urbanText(['refus conservés dans l’archive ; liste détaillée indisponible.','refusals retained in the archive; detailed list unavailable.','项拒绝记录保存在档案中；详细列表不可用。','rechazos conservados en el archivo; lista detallada no disponible.','recusas mantidas no arquivo; lista detalhada indisponível.'])}</li>` : '';
  const refusals = state.cold ? coldRefusals! : state.scene?.refusals ?? [];
  return refusals.map(r => `<li data-refusal="${xml(r.parcel_id)}">${xml(r.parcel_id)} : ${xml(r.message)}</li>`).join('');
}
export function urbanBuildingPanelCapacity(state: UrbanBuildingState, selected: PlacedBuilding): string {
  const scene = state.scene;
  return !state.cold && !!scene && selected.simplification === 'recipe_volumes' && scene.generator_version !== 'silhouette'
    && !scene?.generator_version.startsWith('architectural-plans-') && selected.cartographic?.validation !== 'plan_only'
    ? `${selected.useful_area_m2.toFixed(1)} ${urbanText(['m² utiles indicatifs','indicative usable m²','平方米参考使用面积','m² útiles indicativos','m² úteis indicativos'])} · ${selected.domestic_units.toFixed(1)} ${urbanText(['unités domestiques estimées','estimated domestic units','个估计居住单元','unidades domésticas estimadas','unidades domésticas estimadas'])}` : urbanText(['capacité non évaluée','capacity not assessed','容量未评估','capacidad no evaluada','capacidade não avaliada']);
}
export function urbanBuildingPanelOutcomeBalanceHtml(p: UrbanProgramme): string {
  return `<small data-built-outcomes>${p.builtBalance!.demands.reduce((n,d)=>n+d.admittedUnknown,0)} ${xml(urbanText(['plans natifs admis à capacité inconnue ; aucune capacité créditée. Déficit conservé intégralement pour cette part inconnue.','admitted native plans with unknown capacity; no capacity credited. Deficit retains the entire unknown share.','已接纳原生方案的容量未知；不计入容量，保留全部未知缺口。','planos nativos admitidos con capacidad desconocida; sin crédito. Se conserva el déficit desconocido.','planos nativos admitidos com capacidade desconhecida; sem crédito. Mantém-se o défice desconhecido.']))}</small>`;
}
export function urbanBuildingPanelEvidence(state: UrbanBuildingState): ReturnType<typeof programmeBalanceEvidence> {
  const fingerprint=state.parent?.store.fingerprint ?? state.cold?.store.fingerprint;
  return fingerprint ? p => hasBuiltOutcomeBalance(p,fingerprint) ? 'outcomes_reconciled' : 'not_calculated' : programmeBalanceEvidence(state.scene);
}
/** Shared by the actual selected-building panel and CPU consumer tests. */
export function urbanBuildingPanelProgrammeOutcomeHtml(selected: Pick<PlacedBuilding, 'programme_outcome'>): string {
  return [...programmeOutcomeRows(selected.programme_outcome), ...retainedBodyInventoryRows(selected)].map(([label, value]) => `<dt>${xml(label)}</dt><dd>${xml(value)}</dd>`).join('');
}

/** Declarations displayed from retained outcomes only; never reconstructed
 * from a restored allocation. A declaration is not a feasibility certificate. */
export function urbanBuildingPanelOpenDeficitsHtml(state: UrbanBuildingState): string {
  if (state.parent) return state.parent.counts.open_spaces ? `<li>${urbanText(['Motifs conservés dans les sorties natives ; aucune capacité bâtie ou ouverte n’est déduite ici.','Reasons are retained in native outputs; no built or open capacity is inferred here.','原因保存在原生输出中；此处不推断建筑或开放空间容量。','Los motivos se conservan en las salidas nativas; aquí no se deduce capacidad construida ni abierta.','Os motivos são mantidos nas saídas nativas; nenhuma capacidade construída ou aberta é inferida aqui.'])}</li>` : '';
  if (state.cold) return state.cold.counts.open_spaces
    ? `<li>${urbanText(['Motifs des issues ouvertes conservés dans l’archive ; non relus dans ce panneau.','Open-outcome reasons are retained in the archive; this panel does not reread them.','开放结果的原因保存在档案中；此面板不会重新读取。','Los motivos de resultados abiertos se conservan en el archivo; este panel no los vuelve a leer.','Os motivos dos resultados abertos são mantidos no arquivo; este painel não os relê.'])}</li>` : '';
  return (state.scene?.open_spaces ?? []).filter(space => space.deficit?.version === 'architectural-deficit-1').map(space => {
    const d = space.deficit!;
    if (![d.original_function, d.role, d.message, d.cause].every(value => typeof value === 'string' && value.length)
      || !Number.isFinite(d.households) || d.households < 0) return `<li>${urbanText(['Déclaration d’issue ouverte mal formée ; motif inconnu.','Malformed open-outcome declaration; reason unknown.','开放结果声明格式错误；原因未知。','Declaración de resultado abierto mal formada; motivo desconocido.','Declaração de resultado aberto malformada; motivo desconhecido.'])}</li>`;
    return `<li data-open-deficit="${xml(space.parcel_id)}">${xml(d.original_function)} · ${xml(d.role)} : ${xml(d.message)} (${urbanText(['déclaration','declaration','声明','declaración','declaração'])} ${xml(d.cause)} ; ${urbanText(['aucune capacité bâtie ou ouverte créditée par cette déclaration','this declaration credits no built or open capacity','此声明不计入建筑或开放空间容量','esta declaración no atribuye capacidad construida ni abierta','esta declaração não atribui capacidade construída ou aberta'])})</li>`;
  }).join('');
}
/** State/async orchestration also used by the actual DOM panel. It retains one
 * selected native record, never a cold scene reconstructed as PlacementBatch. */
export function createUrbanBuildingPanelState(initial: UrbanBuildingState, options: {
  readColdBuilding?(cold: UrbanColdBuildingState, id: string): Promise<BuildingChunkRead | undefined>;
  readParentBuilding?(parent: UrbanParentBuildingState, id: string): Promise<NativeParentRead>;
  exportParent?(parent: UrbanParentBuildingState): Promise<void>;
  exportCold?(cold: UrbanColdBuildingState): Promise<void>;
  exportScene?(scene: PlacementBatch): void | Promise<void>;
  onUpdate?(state: UrbanBuildingState): void;
}) {
  const { readColdBuilding, readParentBuilding, exportParent, exportCold, exportScene, onUpdate } = options;
  let state = panelState(initial), version = 0, selection: UrbanBuildingPanelSelection = { status: 'none' }, exporting = false;
  type Job = { cold: UrbanColdBuildingState; identity: string; id: string; version: number };
  let parentWork: Promise<void> | undefined;
  let pending: Job | undefined, loaded: Job | undefined, running = false, waiters: (() => void)[] = [];
  const notify = () => onUpdate?.(state);
  const current = (job: Job) => version === job.version && state.cold === job.cold && state.selected === job.id && coldIdentity(job.cold) === job.identity;
  function clear() { version++; pending = loaded = undefined; selection = { status: 'none' }; }
  function schedule() {
    if (running) return; running = true; queueMicrotask(() => { void drain(); });
  }
  async function drain() {
    try {
      while (pending) {
        const job = pending; pending = undefined;
        try {
          const value = await readColdBuilding!(job.cold, job.id); if (!current(job)) continue;
          if (value && (value.building.id !== job.id || value.scene.buildings.length !== 1 || value.scene.buildings[0] !== value.building))
            throw new Error(urbanText(['Le bâtiment chargé ne correspond pas à la sélection et à son contexte.','The loaded building does not match the selection and its context.','加载的建筑与所选项及其上下文不匹配。','El edificio cargado no coincide con la selección y su contexto.','O edifício carregado não corresponde à seleção e ao seu contexto.']));
          loaded = value ? job : undefined;
          selection = value ? { status: 'ready', id: job.id, value: Object.freeze({ building: value.building, scene: value.scene, chunkIndex: value.chunkIndex }) }
            : { status: 'missing', id: job.id };
          notify();
        } catch (error) {
          if (!current(job)) continue; loaded = undefined;
          selection = { status: 'error', id: job.id, message: error instanceof Error ? error.message : String(error) }; notify();
        }
      }
    } finally {
      running = false;
      const done = waiters; waiters = []; done.forEach(resolve => resolve());
    }
  }
  function startSelection(id: string, update = true): boolean {
    if (!id) return false;
    if (!state.cold) {
      if (!state.scene?.buildings.some(b => b.id === id)) return false;
      clear(); state = { ...state, selected: id }; if (update) notify(); return true;
    }
    if (state.selected === id && (selection.status === 'pending' || selection.status === 'ready' && loaded && current(loaded))) return false;
    clear(); state = { ...state, selected: id };
    const cold = state.cold!;
    if (!readColdBuilding) selection = { status: 'error', id, message: urbanText(['La lecture du bâtiment sélectionné est indisponible.','Reading the selected building is unavailable.','无法读取所选建筑。','La lectura del edificio seleccionado no está disponible.','A leitura do edifício selecionado está indisponível.']) };
    else { selection = { status: 'pending', id }; pending = { cold, identity: coldIdentity(cold), id, version }; schedule(); }
    if (update) notify(); return true;
  }
  function startParentSelection(pick: ParentMapSelection, update = true): boolean {
    const parent = state.parent; if (!parent) return false;
    if (JSON.stringify(state.parentSelected) === JSON.stringify(pick) && ['parent_pending', 'parent_ready'].includes(selection.status)) return false;
    clear(); const own = version; state = { ...state, parentSelected: { ...pick }, selected: undefined };
    selection = { status: 'parent_pending', id: pick.parent_id };
    parentWork = Promise.resolve().then(async () => {
      if (!readParentBuilding) throw new Error(urbanText(['Lecture native parent indisponible.','Native parent reading is unavailable.','无法读取原生父对象。','Lectura nativa del elemento principal no disponible.','Leitura nativa do objeto principal indisponível.']));
      const value = await readParentBuilding(parent, pick.parent_id);
      if (own !== version || state.parent !== parent) return;
      if (!nativeParentHasSelection(value, pick)) throw new Error(urbanText(['La sélection parent/membre/contexte ne correspond pas à son archive.','The parent/member/context selection does not match its archive.','所选父对象 / 成员 / 上下文与其档案不匹配。','La selección de elemento principal/miembro/contexto no coincide con su archivo.','A seleção de objeto principal/membro/contexto não corresponde ao seu arquivo.']));
      selection = { status: 'parent_ready', id: pick.parent_id, value, pick };
    }).catch(error => { if (own === version && state.parent === parent) selection = { status: 'parent_error', id: pick.parent_id, message: String(error) }; })
      .finally(() => { if (own === version && state.parent === parent) notify(); });
    if (update) notify(); return true;
  }
  function replace(next: UrbanBuildingState) {
    const accepted = panelState(next); clear(); state = accepted;
    if (state.parent && state.parentSelected) startParentSelection(state.parentSelected, false);
    else if (state.cold && state.selected) startSelection(state.selected, false); notify();
  }
  if (state.parent && state.parentSelected) startParentSelection(state.parentSelected, false);
  else if (state.cold && state.selected) startSelection(state.selected, false);
  return {
    get state() { return state; }, get selection() { return selection; }, get version() { return version; }, get exporting() { return exporting; },
    get canExport() { return !exporting && (state.parent ? !!exportParent : state.cold ? !!exportCold : !!state.scene && !!exportScene); },
    select: startSelection, selectParent: startParentSelection,
    whenSelectionIdle(): Promise<void> { if (state.parent) return parentWork ?? Promise.resolve(); return running ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve(); },
    restore: replace,
    replaceScene(scene?: PlacementBatch) { replace({ ...state, scene, cold: undefined, parent: undefined, parentSelected: undefined }); },
    replaceParent(parent?: UrbanParentBuildingState) { replace({ ...state, parent, parentSelected: undefined, scene: undefined, cold: undefined, selected: undefined, projection: false }); },
    replaceCold(cold?: UrbanColdBuildingState) { replace({ ...state, scene: undefined, cold, parent: undefined, parentSelected: undefined, selected: cold ? state.selected : undefined }); },
    resetAppliedSettings() { state = { ...state, settings: undefined }; notify(); },
    invalidate() { replace({ ...state, scene: undefined, cold: undefined, parent: undefined, parentSelected: undefined, selected: undefined }); },
    applyGenerated(result: UrbanBuildingGenerateResult, seed: string, settings: PlacementBatchSettings) {
      if ([result.scene, result.cold, result.parent].filter(Boolean).length !== 1) throw new Error('Le résultat doit contenir une seule représentation bâtie.');
      replace({ ...state, seed, settings, generated: true, scene: result.scene, cold: result.cold, parent: result.parent, parentSelected: undefined, generationNote: result.generationNote,
        architectureContract: result.parent ? 'parent-session-1' : result.scene?.generator_version === 'silhouette' ? undefined : 'legacy-plan' });
    },
    async openSelected(open: (building: PlacedBuilding, context?: PlanArchiveScene) => Promise<void>): Promise<void> {
      if (state.parent) throw new Error(urbanText(['Le transfert Maisons d’un parent archivé n’est pas encore pris en charge. Exportez les archives natives.','Transferring an archived parent to Houses is not yet supported. Export the native archives.','尚不支持将已归档父对象传送到房屋工作坊。请导出原生档案。','Aún no se admite transferir un elemento principal archivado a Casas. Exporta los archivos nativos.','A transferência de um objeto principal arquivado para Casas ainda não é suportada. Exporte os arquivos nativos.']));
      if (state.cold) {
        if (selection.status !== 'ready' || !loaded || !current(loaded)) throw new Error(urbanText(['Le bâtiment sélectionné n’est pas chargé.','The selected building is not loaded.','所选建筑尚未加载。','El edificio seleccionado no está cargado.','O edifício selecionado não está carregado.']));
        return open(selection.value.building, selection.value.scene);
      }
      const building = state.scene?.buildings.find(b => b.id === state.selected); if (!building) throw new Error(urbanText(['Aucun bâtiment sélectionné.','No building selected.','未选择建筑。','No hay ningún edificio seleccionado.','Nenhum edifício selecionado.']));
      return open(building);
    },
    async exportCurrent(): Promise<void> {
      if (exporting) throw new Error(urbanText(['Un export est déjà en cours.','An export is already in progress.','导出已在进行中。','Ya hay una exportación en curso.','Já há uma exportação em andamento.']));
      const cold = state.cold, scene = state.scene, parent = state.parent;
      if (parent && !exportParent) throw new Error(urbanText(['Export natif parent indisponible.','Native parent export is unavailable.','无法导出原生父对象。','Exportación nativa del elemento principal no disponible.','Exportação nativa do objeto principal indisponível.']));
      if (cold && !exportCold) throw new Error(urbanText(['L’export complet de cette scène est indisponible.','Full export of this scene is unavailable.','无法完整导出此场景。','La exportación completa de esta escena no está disponible.','A exportação completa desta cena está indisponível.']));
      if (!parent && !cold && (!scene || !exportScene)) throw new Error(urbanText(['Aucune scène bâtie à exporter.','No built scene to export.','没有可导出的建筑场景。','No hay ninguna escena construida para exportar.','Não há cena construída para exportar.']));
      exporting = true; notify();
      try { if (parent) await exportParent!(parent); else if (cold) await exportCold!(cold); else await exportScene!(scene!); }
      finally { exporting = false; notify(); }
    },
  };
}

/** Shared controls for Settlements and the existing urban workshop. Draft inputs
 * are read only by their action; display changes never call generation. */
export function createUrbanBuildingsPanel(options: {
  host: Element; getProgramme(): ProgrammeContext;
  applyProgramme(context: ProgrammeContext): void;
  generate(seed: string, settings: PlacementBatchSettings, onProgress: (completed: number, total: number) => void): Promise<UrbanBuildingGenerateResult>;
  onChange(state: UrbanBuildingState): void;
  onOpen(building: PlacedBuilding, context?: PlanArchiveScene): Promise<void>;
  /** Explicit selected-parent experiment; never changes the city stream or turns a group into a Single. */
  onAssembly?(building: PlacedBuilding, context?: PlanArchiveScene): Promise<void>;
  readColdBuilding?(cold: UrbanColdBuildingState, id: string): Promise<BuildingChunkRead | undefined>;
  readParentBuilding?(parent: UrbanParentBuildingState, id: string): Promise<NativeParentRead>;
  exportParent?(parent: UrbanParentBuildingState): Promise<void>;
  importParent?(file: Blob): Promise<UrbanParentBuildingState>;
  getColdRefusals?(cold: UrbanColdBuildingState): readonly NativeBuildingProjectionRefusal[] | undefined;
  loadColdRefusals?(cold: UrbanColdBuildingState): Promise<void>;
  exportCold?(cold: UrbanColdBuildingState): Promise<void>;
  onProjection?(active: boolean): void;
  /** City Bench: flat silhouettes from the lots; house generation options are not offered. */
  silhouettes?: boolean;
}) {
  const programme = document.createElement('details'); programme.id = 'urbanProgrammeStage'; programme.className = 'stage urban-stage'; programme.open = true;
  programme.innerHTML = `<summary>Programme et usages</summary><div class="stage-controls">
    ${programmeFunctionControlsHtml()}
    ${programmeConditionControlsHtml()}
    <details class="advanced"><summary>Culture, époque et ressources</summary>
      ${programmePolicyControlsHtml()}
      <label>Ressources connues<input data-programme="resources"></label>
      <label>Choix du lieu<input data-programme="lore"></label>
      <label><input type="checkbox" data-programme="navigableAccess">Implanter comme port (quais sur l’eau réelle)</label>
      <small>Le stockage portuaire n’est alloué que sur un quai mesuré au bord d’un chenal navigable ; ni la case ni la fonction portuaire ne créent d’eau, de chenal ou de route. Un mot inconnu est conservé sans effet.</small>
    </details>
    <button type="button" data-programme-apply>Appliquer le programme au plan</button><small data-programme-draft hidden>Modifications non appliquées.</small>
    <div data-programme-report aria-live="polite"></div></div>`;
  const panel = document.createElement('details'); panel.id = 'urbanBuildingStage'; panel.className = 'stage urban-stage'; panel.open = true;
  panel.innerHTML = `<summary>Bâtiments</summary><div class="stage-controls">
    <div class="urban-actions"><button type="button" data-buildings-generate>Implanter les bâtiments</button><small data-buildings-status role="status">Générez les parcelles pour implanter les bâtiments.</small></div>
    <label>Graine<input data-building-seed placeholder="Graine des parcelles"></label><small data-building-draft hidden>Modifications non appliquées · utilisez « Implanter les bâtiments ».</small>
    <details class="advanced"><summary>Implantation et niveaux</summary><label>Typologie<select data-building-typology><option value="">Selon le programme culturel</option><option value="common">Famille courante</option><option value="row">Lanière / mitoyenne</option><option value="courtyard">Maison à cour</option><option value="compound">Enclos / ensemble</option><option value="detached">Maison indépendante</option></select></label><label>Niveaux demandés<input data-building-floors type="number" min="1" step="1" placeholder="Selon la recette"></label><small>Un choix incompatible avec le terrain, le lot ou la tradition retourne un refus. Les rues et parcelles sont conservées.</small></details>
    <details class="advanced"><summary>Modèle du banc Maisons</summary><label>Code ou lien replay<input data-building-house-model placeholder="Code replay ou lien du banc Maisons"></label><small>Modèle culturel : les habitats domestiques / mixtes doivent appartenir au pack du replay. Les lots d’un autre pack sont refusés explicitement, y compris dans un lieu à cultures mêlées. Les autres fonctions gardent leur programme. Appliqué uniquement au clic « Implanter les bâtiments ». Preset libre : choisir Fantasy dans Maisons et appliquer le programme Fantasy du lieu ; ses dimensions restent exactes. La graine et le placement restent ceux de la ville.</small><button type="button" data-building-house-bench>Ouvrir le banc Maisons</button></details>
    <label><input data-building-visible type="checkbox" checked>Afficher les bâtiments</label>
    <label>Rendu Maisons<select data-building-style><option value="cartographic">Rendu Maisons partagé</option></select></label>
    <label>Diagnostic<select data-building-diagnostic><option value="none">Aucun</option><option value="uses">Usages</option><option value="access">Entrées et refus</option><option value="height">Hauteurs physiques</option></select></label>
    <div><button type="button" data-building-3d aria-pressed="false">3D</button><button type="button" data-building-json disabled>Exporter la scène JSON</button></div>
    <label>Importer des archives parent natives<input type="file" data-building-parent-import accept=".ndjson"></label><small>Import exact, sans réadmission au terrain actuel ; conserve la provenance du plan.</small>
    <section data-building-inspection aria-live="polite"><small>Cliquer sur un bâtiment pour l’inspecter.</small></section>
    <details class="advanced"><summary>Refus d’implantation</summary><ul data-building-refusals></ul></details>
    <details class="advanced"><summary>Déficits architecturaux déclarés</summary><small>Déclarations conservées avec les issues ouvertes ; elles ne prouvent ni impossibilité physique ni capacité habitante.</small><ul data-building-open-deficits></ul></details>
  </div>`;
  options.host.append(programme, panel);
  const renderControls = new Map(['visible', 'style', 'diagnostic'].map(key => {
    const selector = `[data-building-${key}]`, control = panel.querySelector<HTMLElement>(selector)!;
    control.closest<HTMLElement>('label')!.dataset.renderSettingsCategory = 'buildings';
    return [selector, control] as const;
  }));
  const $ = <T extends HTMLElement>(selector: string): T => (renderControls.get(selector) ?? panel.querySelector(selector)) as T;
  const p$ = <T extends HTMLElement>(selector: string): T => programme.querySelector(selector) as T;
  // Mixed house styles (the « Maisons » column of the city panel); the single-culture select below is the older way to set the whole city.
  const houseMix = { value: undefined as HouseSettings | undefined, get(): HouseSettings | undefined { return hasHouseMix(this.value) ? this.value : undefined; },
    set(next?: HouseSettings): void { this.value = next && structuredClone(next); } };
  const architecture = document.createElement('label'); architecture.textContent = 'Style unique des maisons · toute la ville (ancien réglage)';
  const architectureCulture = document.createElement('select'); architectureCulture.dataset.buildingCulture = '';
  architectureCulture.add(new Option('Selon le routage du programme appliqué', ''));
  for (const [id, culture] of Object.entries(urbanCatalogue.cultures)) architectureCulture.add(new Option(culture.label, id));
  architecture.append(architectureCulture);
  panel.querySelector('.stage-controls')!.insertBefore(architecture, $('[data-building-draft]').previousElementSibling);
  const architectureHint = document.createElement('small'); architectureHint.textContent = 'Ce profil nommé route les bâtiments vers des sources/variantes ; ce n’est ni une recette imposée ni une certification historique. Le plan et les parcelles sont conservés, l’accès et les droits restent requis.';
  architecture.after(architectureHint);
  const fitLabel = document.createElement('label');
  fitLabel.innerHTML = '<input type="checkbox" data-building-fit checked>Adapter les dimensions au lot';
  fitLabel.title = 'En mode inspiré ou fantasy, adapte les corps simples jusqu’à deux fois les dimensions du catalogue. Les modèles exacts et le mode historique strict gardent leurs dimensions.';
  architectureHint.after(fitLabel);
  for (const [host, id] of [[programme, 'urban-programme-allocation'], [panel, 'urban-architecture-placement']] as const) {
    const help = document.createElement('button'); help.type = 'button'; help.textContent = '?'; help.title = 'Méthode et limites'; help.setAttribute('aria-label', 'Lire la note de méthode');
    help.onclick = () => openMethodNote(id); host.querySelector('.stage-controls')!.prepend(help);
  }
  const renderHelp = document.createElement('button'); renderHelp.type = 'button'; renderHelp.textContent = '?'; renderHelp.title = 'Styles, hauteurs et rendu 2D / 3D';
  renderHelp.onclick = () => openMethodNote('urban-buildings-rendering'); $<HTMLSelectElement>('[data-building-style]').closest('label')!.append(renderHelp);
  const buildingStyle: UrbanBuildingStyle = options.silhouettes ? 'silhouette' : 'cartographic';
  if (options.silhouettes) {
    programme.querySelector('summary')!.textContent = '8 · Programme et usages';
    panel.querySelector('summary')!.textContent = '9 · Bâtiments · silhouettes';
    $('[data-buildings-generate]').textContent = 'Tracer les silhouettes';
    $<HTMLSelectElement>('[data-building-style]').replaceChildren(new Option('Silhouettes à plat', 'silhouette'));
    // Silhouettes carry no volumes, hence no physical height to colour.
    $<HTMLSelectElement>('[data-building-diagnostic]').querySelector('option[value="height"]')?.remove();
    // Typology, levels, house models and parcel fitting only shape detailed houses.
    for (const element of [$('[data-building-typology]').closest('details')!, $('[data-building-house-model]').closest('details')!, fitLabel]) (element as HTMLElement).hidden = true;
    // The City Bench 3D view (city3d.ts) shows silhouettes, compact plans and detailed houses.
    $('[data-building-3d]').textContent = 'Vue 3D';
    architectureHint.textContent = 'Emprise proposée par chaque lot (rectangle d’admission, sinon surface constructible). Les maisons détaillées seront réintégrées plus tard.';
  }
  setupUrbanBuildingLocale(programme, panel, !!options.silhouettes);
  localizeCityInspector(programme);
  localizeCityInspector(panel);
  let state: UrbanBuildingState = { seed: '', visible: true, appearance: { style: buildingStyle, diagnostic: 'none' } };
  let epoch = 0, busy = false;
  const draftControls = '[data-building-seed], [data-building-floors], [data-building-typology], [data-building-house-model], [data-building-culture], [data-building-fit]';
  for (const control of Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>(draftControls))) {
    control.addEventListener('input', () => { $('[data-building-draft]').hidden = false; });
    control.addEventListener('change', () => { $('[data-building-draft]').hidden = false; });
  }
  let reportedRefusals: readonly NativeBuildingProjectionRefusal[] | undefined;
  let reportedCold: UrbanColdBuildingState | undefined;
  let lastPanelSummary = '';
  let programmes: UrbanProgramme[] = [], reportedProgrammes: UrbanProgramme[] | undefined, programmeScene: PlacementBatch | undefined,
    programmeCold: UrbanColdBuildingState | undefined, programmeParent: UrbanParentBuildingState | undefined;
  function reportProgrammes(): void {
    if (reportedProgrammes === programmes && programmeScene === state.scene && programmeCold === state.cold && programmeParent === state.parent) return;
    reportedProgrammes = programmes; programmeScene = state.scene; programmeCold = state.cold; programmeParent = state.parent;
    const balanceEvidence = urbanBuildingPanelEvidence(state);
    p$('[data-programme-report]').innerHTML = programmes.map(p => {
      const evidence = balanceEvidence(p), known = evidence === 'scene_consistent';
      const missing = evidence === 'not_calculated' ? urbanText(['non calculé','not calculated','未计算','no calculado','não calculado']) : urbanText(['non vérifié','unverified','未经验证','no verificado','não verificado']);
      const titleParcel = urbanText(['Estimation de capacité des parcelles après affectation, avant admission des bâtiments','Estimated parcel capacity after allocation, before building admission','分配后、建筑接纳前的地块容量估算','Capacidad parcelaria estimada tras la asignación y antes de admitir edificios','Capacidade estimada dos lotes após alocação e antes da admissão de edifícios']);
      const titleBuilt = urbanText(['Valeur du bilan calculé sur les sorties de cette scène, si disponible','Balance calculated from this scene’s outputs, if available','根据此场景输出计算的结果（如有）','Balance calculado con los resultados de esta escena, si está disponible','Balanço calculado a partir dos resultados desta cena, se disponível']);
      const titleOpen = urbanText(['Espaces ouverts conservés dans le bilan de cette scène','Open spaces retained in this scene balance','此场景结果中保留的开放空间','Espacios abiertos conservados en el balance de esta escena','Espaços abertos mantidos no balanço desta cena']);
      const titleDeficit = urbanText(['Besoin restant selon le programme','Remaining need according to the program','规划中的剩余需求','Necesidad restante según el programa','Necessidade restante segundo o programa']);
      const outcomeNote = evidence === 'outcomes_reconciled' ? urbanBuildingPanelOutcomeBalanceHtml(p) : '';
      const conclusion = known ? urbanText(['Estimation cohérente avec les sorties de cette scène ; capacité habitante non certifiée.','Estimate consistent with this scene’s outputs; residential capacity is not certified.','估算与此场景输出一致；居住容量未经认证。','Estimación coherente con los resultados de esta escena; capacidad residencial no certificada.','Estimativa coerente com os resultados desta cena; capacidade residencial não certificada.']) : evidence === 'not_calculated' || evidence === 'outcomes_reconciled' ? urbanText(['La capacité des bâtiments n’a pas été évaluée. Les valeurs parcellaires restent des estimations du modèle.','Building capacity has not been assessed. Parcel values remain model estimates.','建筑容量尚未评估。地块数值仍是模型估算。','No se ha evaluado la capacidad de los edificios. Los valores parcelarios siguen siendo estimaciones del modelo.','A capacidade dos edifícios não foi avaliada. Os valores dos lotes continuam sendo estimativas do modelo.']) : urbanText(['Le bilan bâti n’est pas vérifié pour cette scène ; aucune capacité habitante n’est déduite.','The building balance is unverified for this scene; no residential capacity is inferred.','此场景的建筑结果未经验证；不推断居住容量。','El balance construido no está verificado para esta escena; no se deduce capacidad residencial.','O balanço construído não foi verificado para esta cena; nenhuma capacidade residencial é inferida.']);
      return `${outcomeNote}${programmePolicyEvidenceHtml(p)}${programmeConditionEvidenceHtml(p)}<small data-programme-functions-applied>${xml(programmeFunctionsSummary(p.context))}</small><table class="urban-programme"><thead><tr><th>${urbanText(['Besoin','Need','需求','Necesidad','Necessidade'])}</th><th>${urbanText(['Demande','Demand','需求量','Demanda','Demanda'])}</th><th title="${xml(titleParcel)}">${urbanText(['Parcellaire estimé','Estimated parcels','估计地块','Parcelario estimado','Lotes estimados'])}</th><th title="${xml(titleBuilt)}">${urbanText(['Bilan bâti estimé','Estimated building balance','估计建筑结果','Balance construido estimado','Balanço construído estimado'])}</th><th title="${xml(titleOpen)}">${urbanText(['Libre','Open','开放','Libre','Livre'])}</th><th title="${xml(titleDeficit)}">${urbanText(['Déficit du programme','Program deficit','规划缺口','Déficit del programa','Déficit do programa'])}</th></tr></thead><tbody>${p.demands.map(d => `<tr title="${xml([...d.provenance, ...d.reasons].join(' · '))}"><th>${xml(functionName(d.function))}<small>${d.unit === 'domesticUnits' ? urbanText(['ménages du modèle','model households','模型家庭','hogares del modelo','domicílios do modelo']) : urbanText(['m² utiles indicatifs','indicative usable m²','平方米参考使用面积','m² útiles indicativos','m² úteis indicativos'])}</small></th><td>${d.requested.toFixed(1)}</td><td>${d.parcelCapacity.toFixed(1)}</td><td>${known ? d.builtCapacity.toFixed(1) : missing}</td><td>${known ? (d.openCapacity ?? 0).toFixed(1) : missing}</td><td>${d.deficit.toFixed(1)}${known ? '' : ` (${urbanText(['bilan bâti non confirmé','building balance unconfirmed','建筑结果未确认','balance construido no confirmado','balanço construído não confirmado'])})`}</td></tr>`).join('')}</tbody></table><small>${conclusion}</small><small>${xml(urbanCapacityScopeText())}</small>${p.warnings.length ? `<small data-programme-warnings role="status">${p.warnings.map(w => xml(urbanCapacityWarningText(w))).join('<br>')}</small>` : ''}<small>${p.cultures.map(c => `${xml(c.culture)} → ${xml(c.architecturePack)}${c.borrowing ? ` · ${xml(c.borrowing)}` : ''}`).join('<br>')}</small>`;
    }).join('') || `<small>${urbanText(['Le programme apparaît avec le plan appliqué.','The program appears with the applied plan.','规划随已应用的方案显示。','El programa aparece con el plan aplicado.','O programa aparece com o plano aplicado.'])}</small>`;
  }
  const report = (): void => {
    const scene = state.scene, cold = state.cold, loading = model.selection;
    if (!busy) { lastPanelSummary = urbanBuildingPanelSummary(state); $('[data-buildings-status]').textContent = lastPanelSummary; }
    const exportButton = $<HTMLButtonElement>('[data-building-json]'); exportButton.disabled = !model.canExport;
    exportButton.textContent = state.parent ? urbanText(['Exporter les archives parent natives','Export native parent archives','导出原生父对象档案','Exportar archivos de elementos principales nativos','Exportar arquivos de objetos principais nativos']) : cold ? urbanText(['Exporter la scène complète','Export full scene','导出完整场景','Exportar escena completa','Exportar cena completa']) : urbanText(['Exporter la scène JSON','Export scene JSON','导出场景 JSON','Exportar escena JSON','Exportar cena JSON']);
    exportButton.title = cold && !options.exportCold ? urbanText(['L’export complet de cette scène est indisponible.','Full export of this scene is unavailable.','无法完整导出此场景。','La exportación completa de esta escena no está disponible.','A exportação completa desta cena está indisponível.']) : '';
    if (model.exporting) exportButton.setAttribute('aria-busy', 'true'); else exportButton.removeAttribute('aria-busy');
    const refusals = cold ? options.getColdRefusals?.(cold) : scene?.refusals;
    if (refusals !== reportedRefusals || cold !== reportedCold) $('[data-building-refusals]').innerHTML = urbanBuildingPanelRefusalsHtml(state, cold ? refusals : undefined);
    reportedRefusals = refusals; reportedCold = cold;
    $('[data-building-open-deficits]').innerHTML = urbanBuildingPanelOpenDeficitsHtml(state);
    const selected = cold ? loading.status === 'ready' ? loading.value.building : undefined : scene?.buildings.find(b => b.id === state.selected);
    const box = $('[data-building-inspection]'), capacity = selected ? urbanBuildingPanelCapacity(state, selected) : urbanText(['capacité non évaluée','capacity not assessed','容量未评估','capacidad no evaluada','capacidade não avaliada']);
    const emptyInspection = cold && loading.status === 'pending' ? `<small data-building-i18n="pending">${urbanText(['Chargement du bâtiment sélectionné…','Loading selected building…','正在加载所选建筑…','Cargando el edificio seleccionado…','Carregando o edifício selecionado…'])}</small>`
      : cold && loading.status === 'missing' ? `<small data-building-i18n="missing">${urbanText(['Le bâtiment sélectionné est absent de cette scène.','The selected building is missing from this scene.','此场景中没有所选建筑。','El edificio seleccionado no está en esta escena.','O edifício selecionado não está nesta cena.'])}</small>`
        : cold && loading.status === 'error' ? `<small>${urbanText(['Lecture du bâtiment impossible :','Unable to read building:','无法读取建筑：','No se puede leer el edificio:','Não foi possível ler o edifício:'])} ${xml(loading.message)}</small>`
          : `<small data-building-i18n="empty">${urbanText(['Cliquer sur un bâtiment pour l’inspecter.','Click a building to inspect it.','点击建筑查看详情。','Haz clic en un edificio para inspeccionarlo.','Clique em um edifício para inspecioná-lo.'])}</small>`;
    box.innerHTML = selected ? `<strong data-building-function>${xml(functionName(selected.function))}</strong><dl class="urban-inspection"><dt data-building-i18n="parcel">${urbanText(['Parcelle','Parcel','地块','Parcela','Lote'])}</dt><dd>${xml(selected.parcel_id)}</dd><dt data-building-i18n="culture">${urbanText(['Culture et recette','Culture and recipe','文化与配方','Cultura y receta','Cultura e receita'])}</dt><dd>${xml(selected.culture.culture)} · ${xml(selected.recipe_id)}</dd><dt data-building-i18n="height">${urbanText(['Sol / hauteur physique','Ground / physical height','地面 / 物理高度','Suelo / altura física','Solo / altura física'])}</dt><dd>${selected.ground_z_m.toFixed(2)} m / ${buildingHeight(selected).toFixed(2)} m</dd><dt data-building-i18n="domestic">${urbanText(['Indicateurs domestiques','Domestic indicators','居住指标','Indicadores domésticos','Indicadores domésticos'])}</dt><dd data-building-capacity>${capacity}</dd><dt data-building-i18n="access">${urbanText(['Accès','Access','通道','Acceso','Acesso'])}</dt><dd>${xml(selected.access_id)}</dd>${urbanBuildingPanelProgrammeOutcomeHtml(selected)}</dl><button type="button" data-open-house data-building-i18n="open">${urbanText(['Ouvrir dans Maisons','Open in Houses','在房屋中打开','Abrir en Casas','Abrir em Casas'])}</button>${options.onAssembly && selected.simplification === 'architectural_plan' ? `<button type="button" data-open-assembly data-building-i18n="assembly">${urbanText(['Essai assemblage natif · parent sélectionné','Native assembly test · selected parent','原生装配测试 · 所选父对象','Prueba de ensamblaje nativo · elemento principal seleccionado','Teste de montagem nativa · objeto principal selecionado'])}</button>` : ''}${selected.culture.borrowing ? `<small>${xml(selected.culture.borrowing)}</small>` : ''}` : emptyInspection;
    if (state.parent) {
      box.innerHTML = loading.status === 'parent_ready' ? nativeParentInspectionHtml(loading.value, loading.pick)
        : loading.status === 'parent_pending' ? `<small>${urbanText(['Lecture de l’archive du parent sélectionné…','Reading the selected parent archive…','正在读取所选父对象档案…','Leyendo el archivo del elemento principal seleccionado…','Lendo o arquivo do objeto principal selecionado…'])}</small>`
          : loading.status === 'parent_error' ? `<small>${urbanText(['Lecture native impossible :','Unable to read native archive:','无法读取原生档案：','No se puede leer el archivo nativo:','Não foi possível ler o arquivo nativo:'])} ${xml(loading.message)}</small>` : `<small>${urbanText(['Cliquez sur un membre ou un contexte réel pour lire son parent archivé.','Click a real member or context to read its archived parent.','点击实际成员或上下文以读取其已归档的父对象。','Haz clic en un miembro o contexto real para leer su elemento principal archivado.','Clique em um membro ou contexto real para ler seu objeto principal arquivado.'])}</small>`;
    }
    if (state.generationNote) box.insertAdjacentHTML('afterbegin', `<small role="status">${xml(state.generationNote)}</small>`);
    const open = box.querySelector<HTMLButtonElement>('[data-open-house]');
    if (open && options.silhouettes) open.hidden = true;
    const selectedVersion = model.version;
    if (open && selected) open.onclick = () => {
      if (selectedVersion !== model.version) return;
      void model.openSelected(options.onOpen).catch(error => { if (selectedVersion === model.version) $('[data-buildings-status]').textContent = String(error); });
    };
    const assembly = box.querySelector<HTMLButtonElement>('[data-open-assembly]');
    if (assembly && options.onAssembly) assembly.onclick = () => {
      if (selectedVersion !== model.version) return;
      void model.openSelected(options.onAssembly!).catch(error => {
        if (selectedVersion === model.version) $('[data-buildings-status]').textContent = String(error);
      });
    };
    reportProgrammes();
  };
  const model = createUrbanBuildingPanelState(state, { readColdBuilding: options.readColdBuilding, exportCold: options.exportCold,
    readParentBuilding: options.readParentBuilding, exportParent: options.exportParent,
    exportScene: scene => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(scene)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'urban-scene.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    }, onUpdate: next => { state = next; report(); } });
  state = model.state;
  const updateLanguage = (): void => {
    const status = $('[data-buildings-status]');
    if (!busy && status.textContent === lastPanelSummary) { lastPanelSummary = urbanBuildingPanelSummary(state); status.textContent = lastPanelSummary; }
    const button = $<HTMLButtonElement>('[data-building-json]');
    button.textContent = state.parent ? urbanText(['Exporter les archives parent natives','Export native parent archives','导出原生父对象档案','Exportar archivos de elementos principales nativos','Exportar arquivos de objetos principais nativos']) : state.cold ? urbanText(['Exporter la scène complète','Export full scene','导出完整场景','Exportar escena completa','Exportar cena completa']) : urbanText(['Exporter la scène JSON','Export scene JSON','导出场景 JSON','Exportar escena JSON','Exportar cena JSON']);
    if (state.cold && !options.exportCold) button.title = urbanText(['L’export complet de cette scène est indisponible.','Full export of this scene is unavailable.','无法完整导出此场景。','La exportación completa de esta escena no está disponible.','A exportação completa desta cena está indisponível.']);
    const loading = model.selection;
    const selected = state.cold ? loading.status === 'ready' ? loading.value.building : undefined : state.scene?.buildings.find(building => building.id === state.selected);
    if (selected) {
      const name = panel.querySelector<HTMLElement>('[data-building-function]'); if (name) name.textContent = functionName(selected.function);
      const capacity = panel.querySelector<HTMLElement>('[data-building-capacity]'); if (capacity) capacity.textContent = urbanBuildingPanelCapacity(state, selected);
    }
    $('[data-building-refusals]').innerHTML = urbanBuildingPanelRefusalsHtml(state, state.cold ? options.getColdRefusals?.(state.cold) : undefined);
    $('[data-building-open-deficits]').innerHTML = urbanBuildingPanelOpenDeficitsHtml(state);
    const report = p$<HTMLElement>('[data-programme-report]');
    const open = Array.from(report.querySelectorAll<HTMLDetailsElement>('details')).map(details => details.open);
    reportedProgrammes = undefined; reportProgrammes();
    Array.from(report.querySelectorAll<HTMLDetailsElement>('details')).forEach((details, index) => { if (index < open.length) details.open = open[index]; });
  };
  window.addEventListener('magna-locale-change', updateLanguage);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) updateLanguage(); });
  function changed(): void { report(); options.onChange(state); }
  const functionControls = bindProgrammeFunctionControls(programme);
  const policyControls = bindProgrammePolicyControls(programme);
  const conditionControls = bindProgrammeConditionControls(programme);
  const tokenControls = bindProgrammeTokenControls(programme);
  function syncProgramme(provided?: ProgrammeContext): void {
    const context = { ...defaultProgrammeContext(), ...(provided ?? options.getProgramme()) };
    for (const control of Array.from(programme.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-programme]'))) {
      const value = context[control.dataset.programme! as keyof ProgrammeContext];
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = Array.isArray(value) ? value.join(', ') : String(value);
    }
    policyControls.sync(context); functionControls.sync(context); conditionControls.sync(context); tokenControls.refresh();
    p$('[data-programme-draft]').hidden = true;
  }
  programme.addEventListener('change', () => { p$('[data-programme-draft]').hidden = false; });
  p$<HTMLButtonElement>('[data-condition-reset]').onclick = () => { conditionControls.useDefaults(); p$('[data-programme-draft]').hidden = false; };
  p$<HTMLButtonElement>('[data-programme-period-clear]').onclick = () => { policyControls.clearPeriod(); p$('[data-programme-draft]').hidden = false; };
  p$<HTMLButtonElement>('[data-programme-functions-auto]').onclick = () => { functionControls.useAutomatic(); p$('[data-programme-draft]').hidden = false; };
  p$<HTMLButtonElement>('[data-programme-apply]').onclick = () => {
    const context = { ...defaultProgrammeContext(), ...options.getProgramme() };
    for (const control of Array.from(programme.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-programme]'))) {
      const key = control.dataset.programme! as keyof ProgrammeContext;
      const value = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : ['resources', 'lore'].includes(key) ? control.value.split(',').map(v => v.trim()).filter(Boolean) : control.value;
      Object.assign(context, { [key]: value });
    }
    try { options.applyProgramme(conditionControls.read(functionControls.read(policyControls.read(context)))); p$('[data-programme-draft]').hidden = true; }
    catch (error) { p$('[data-programme-draft]').hidden = false; p$('[data-programme-draft]').textContent = error instanceof Error ? error.message : urbanText(['Programme invalide.','Invalid program.','规划无效。','Programa no válido.','Programa inválido.']); }
  };
  $<HTMLButtonElement>('[data-building-house-bench]').onclick = () => openBench('houses', new URLSearchParams());
  $<HTMLButtonElement>('[data-buildings-generate]').onclick = () => { void generate(); };
  async function generate(applied?: Pick<UrbanBuildingState, 'seed' | 'settings'>): Promise<void> {
    if (busy) return;
    const ticket = ++epoch, seed = applied ? applied.seed : $<HTMLInputElement>('[data-building-seed]').value;
    busy = true; $<HTMLButtonElement>('[data-buildings-generate]').setAttribute('aria-busy', 'true');
    const buildingsStart = performance.now();
    $('[data-buildings-status]').textContent = urbanText(['Recherche d’implantations compatibles…','Finding compatible placements…','正在查找兼容的布局…','Buscando implantaciones compatibles…','Buscando implantações compatíveis…']);
    try {
      const floors = $<HTMLInputElement>('[data-building-floors]'), typology = $<HTMLSelectElement>('[data-building-typology]').value as PlacementBatchSettings['typology'];
      if (!applied && (!floors.checkValidity() || floors.value.trim() && !Number.isSafeInteger(Number(floors.value)))) throw new Error('Le nombre de niveaux doit être un entier positif. La recette vérifie sa propre plage.');
      const house_config = applied ? applied.settings?.house_config : readUrbanHouseModel($<HTMLInputElement>('[data-building-house-model]').value, options.getProgramme().mode);
      const settings: PlacementBatchSettings = applied ? structuredClone(applied.settings ?? {}) : { parcel_fit: $<HTMLInputElement>('[data-building-fit]').checked, ...(architectureCulture.value ? { culture: architectureCulture.value } : {}), ...(houseMix.get() ? { houses: structuredClone(houseMix.get()!) } : {}), ...(house_config ? { house_config } : {}), ...(floors.value.trim() ? { floors: Number(floors.value) } : {}), ...(typology ? { typology } : {}) };
      const result = await options.generate(seed, settings, (completed, total) => {
        if (ticket === epoch && busy) $('[data-buildings-status]').textContent = `${completed.toLocaleString()} / ${total.toLocaleString()} ${urbanText(['lots traités','lots processed','个地块已处理','parcelas procesadas','lotes processados'])}`;
      });
      if (ticket !== epoch) return;
      busy = false; model.applyGenerated(result, seed, settings); if (!applied) $('[data-building-draft]').hidden = true; options.onChange(state);
      recordStageMs('buildings', performance.now() - buildingsStart);
      if (result.timing) recordStageMs('buildings.placement', result.timing.placement);
      if (result.timing) $('[data-buildings-status]').textContent += ` · implantation ${result.timing.placement.toFixed(0)} ms`;
    } catch (error) { if (ticket === epoch) $('[data-buildings-status]').textContent = String(error); }
    finally { if (ticket === epoch) { busy = false; $<HTMLButtonElement>('[data-buildings-generate]').removeAttribute('aria-busy'); } }
  }
  $<HTMLInputElement>('[data-building-visible]').onchange = event => { state.visible = (event.target as HTMLInputElement).checked; changed(); };
  $<HTMLSelectElement>('[data-building-style]').onchange = event => { state.appearance = { ...state.appearance, style: (event.target as HTMLSelectElement).value as UrbanBuildingStyle }; changed(); };
  $<HTMLSelectElement>('[data-building-diagnostic]').onchange = event => { state.appearance = { ...state.appearance, diagnostic: (event.target as HTMLSelectElement).value as UrbanBuildingDiagnostic }; changed(); };
  $<HTMLButtonElement>('[data-building-3d]').onclick = () => { state.projection = !state.projection; options.onProjection?.(!!state.projection); $<HTMLButtonElement>('[data-building-3d]').setAttribute('aria-pressed', String(!!state.projection)); options.onChange(state); };
  $<HTMLButtonElement>('[data-building-json]').onclick = () => {
    const ticket = epoch, scene = state.scene, cold = state.cold;
    void model.exportCurrent().catch(error => {
      if (ticket === epoch && state.scene === scene && state.cold === cold) $('[data-buildings-status]').textContent = String(error);
    });
  };
  const parentImport = $<HTMLInputElement>('[data-building-parent-import]'); parentImport.closest('label')!.hidden = !options.importParent;
  parentImport.onchange = () => { const file = parentImport.files?.[0]; if (!file || !options.importParent) return;
    if (busy) { $('[data-buildings-status]').textContent = urbanText(['Attendez la génération en cours.','Wait for the current generation to finish.','请等待当前生成完成。','Espera a que termine la generación actual.','Aguarde a geração atual terminar.']); return; }
    const ticket = ++epoch; parentImport.disabled = true;
    void options.importParent(file).then(parent => { if (ticket !== epoch) throw new Error('Import remplacé ; archive historique conservée sans affichage.');
      model.replaceParent(parent); options.onChange(state); }, e => { if (ticket === epoch) $('[data-buildings-status]').textContent = String(e); })
      .catch(e => { $('[data-buildings-status]').textContent = String(e); }).finally(() => { parentImport.disabled = false; parentImport.value = ''; });
  };
  $('[data-building-refusals]').closest('details')?.addEventListener('toggle', event => {
    const details = event.currentTarget as HTMLDetailsElement, cold = state.cold;
    if (!details.open || !cold || options.getColdRefusals?.(cold) !== undefined || !options.loadColdRefusals) return;
    void options.loadColdRefusals(cold).then(() => { if (state.cold === cold) report(); }, e => {
      if (state.cold === cold) $('[data-building-refusals]').textContent = String(e);
    });
  });
  syncProgramme();
  return {
    programme, panel, generate,
    refreshReport: report,
    get state(): UrbanBuildingState { return state; },
    get busy(): boolean { return busy; },
    resetAppliedSettings(): void { model.resetAppliedSettings(); },
    /** Mixed house styles of the draft (undefined = none chosen), and the older single culture. */
    get houses(): HouseSettings | undefined { return houseMix.get(); },
    get singleCulture(): string { return architectureCulture.value; },
    /** Replaces the draft mix; a change of the city line retires the older single culture, which it supersedes. */
    setHouses(next?: HouseSettings): void {
      if (JSON.stringify(next?.city) !== JSON.stringify(houseMix.value?.city)) architectureCulture.value = '';
      houseMix.set(next); $('[data-building-draft]').hidden = false;
    },
    captureDraft(): UrbanBuildingDraft | undefined {
      return $('[data-building-draft]').hidden ? undefined : { seed: $<HTMLInputElement>('[data-building-seed]').value, floors: $<HTMLInputElement>('[data-building-floors]').value, typology: $<HTMLSelectElement>('[data-building-typology]').value, model: $<HTMLInputElement>('[data-building-house-model]').value, culture: architectureCulture.value, fit: $<HTMLInputElement>('[data-building-fit]').checked, ...(houseMix.get() ? { houses: structuredClone(houseMix.get()!) } : {}) };
    },
    restoreDraft(draft?: UrbanBuildingDraft): void {
      if (!draft) return;
      $<HTMLInputElement>('[data-building-seed]').value = draft.seed;
      $<HTMLInputElement>('[data-building-floors]').value = draft.floors;
      retainSelectValue($<HTMLSelectElement>('[data-building-typology]'), draft.typology ?? '', 'Typologie conservée hors choix UI');
      $<HTMLInputElement>('[data-building-house-model]').value = draft.model;
      retainSelectValue(architectureCulture, draft.culture ?? '', 'Profil architectural conservé hors catalogue UI');
      houseMix.set(draft.houses);
      $<HTMLInputElement>('[data-building-fit]').checked = draft.fit !== false;
      $('[data-building-draft]').hidden = false;
    },
    select(id: string): void { if (model.select(id)) options.onChange(state); },
    selectParent(pick: ParentMapSelection): void { if (model.selectParent(pick)) options.onChange(state); },
    get selection(): UrbanBuildingPanelSelection { return model.selection; },
    whenSelectionIdle(): Promise<void> { return model.whenSelectionIdle(); },
    updateProgrammes(next: UrbanProgramme[]): void {
      programmes = next; reportProgrammes();
    },
    restore(saved?: UrbanBuildingState): void {
      model.restore({ seed: '', visible: true, appearance: { style: buildingStyle, diagnostic: 'none' }, ...saved });
      ++epoch; busy = false;
      state.appearance = { ...state.appearance, style: buildingStyle };
      $<HTMLInputElement>('[data-building-seed]').value = state.seed;
      $<HTMLInputElement>('[data-building-floors]').value = state.settings?.floors === undefined ? '' : String(state.settings.floors);
      retainSelectValue($<HTMLSelectElement>('[data-building-typology]'), state.settings?.typology ?? '', 'Typologie conservée hors choix UI');
      $<HTMLInputElement>('[data-building-house-model]').value = urbanHouseModelCode(state.settings?.house_config);
      retainSelectValue(architectureCulture, state.settings?.culture ?? '', 'Profil architectural conservé hors catalogue UI');
      houseMix.set(state.settings?.houses);
      $<HTMLInputElement>('[data-building-fit]').checked = state.settings?.parcel_fit !== false;
      $<HTMLInputElement>('[data-building-visible]').checked = state.visible;
      $<HTMLSelectElement>('[data-building-style]').value = state.appearance.style;
      $<HTMLSelectElement>('[data-building-diagnostic]').value = state.appearance.diagnostic;
      $<HTMLButtonElement>('[data-buildings-generate]').removeAttribute('aria-busy');
      $<HTMLButtonElement>('[data-building-3d]').setAttribute('aria-pressed', String(!!state.projection));
      $('[data-building-draft]').hidden = true;
      syncProgramme(); report();
    },
    replaceScene(scene: PlacementBatch | undefined): void { model.replaceScene(scene); },
    replaceCold(cold?: UrbanColdBuildingState): void { model.replaceCold(cold); },
    replaceParent(parent?: UrbanParentBuildingState): void { model.replaceParent(parent); },
    syncProgramme,
    setProgrammeDraft(context: ProgrammeContext): void { syncProgramme(context); p$('[data-programme-draft]').hidden = false; },
    setBuildingDraft(saved?: UrbanBuildingState): void {
      if (!saved) return;
      $<HTMLInputElement>('[data-building-seed]').value = saved.seed;
      $<HTMLInputElement>('[data-building-floors]').value = saved.settings?.floors === undefined ? '' : String(saved.settings.floors);
      retainSelectValue($<HTMLSelectElement>('[data-building-typology]'), saved.settings?.typology ?? '', 'Typologie conservée hors choix UI');
      $<HTMLInputElement>('[data-building-house-model]').value = urbanHouseModelCode(saved.settings?.house_config);
      retainSelectValue(architectureCulture, saved.settings?.culture ?? '', 'Profil architectural conservé hors catalogue UI');
      houseMix.set(saved.settings?.houses);
      $<HTMLInputElement>('[data-building-fit]').checked = saved.settings?.parcel_fit !== false;
      $('[data-building-draft]').hidden = false;
    },
    invalidate(): void { ++epoch; busy = false; model.invalidate(); $<HTMLButtonElement>('[data-buildings-generate]').removeAttribute('aria-busy'); },
  };
}
