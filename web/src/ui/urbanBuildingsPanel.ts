import type { UrbanProgramme } from '../../../rust/bridge/urban';
import urbanCatalogue from '../../../rust/crates/core/src/urban/catalogue.json';
import './urbanBuildings.css';
import { openMethodNote } from './methodNotes';
import { defaultProgrammeContext, type ProgrammeContext } from '../../../rust/bridge/urbanConfig';
import type { PlacementBatch, PlacedBuilding, PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import { openBench } from './benchHistory';
import { readUrbanHouseModel, urbanHouseModelCode } from './urbanHouseModel';
import { buildingHeight } from '../render/urbanBuildings';
import { programmeBalanceEvidence } from './urbanProgrammeEvidence';
import { URBAN_FUNCTION_LABELS, type UrbanBuildingAppearance, type UrbanBuildingDiagnostic, type UrbanBuildingStyle } from '../render/urbanBuildingStyle';
import type { UrbanColdSceneResponse } from './urbanScene';
import type { BuildingChunkRead } from './urbanBuildingChunkStore';
import type { PlanArchiveScene } from '../../../rust/bridge/compactPlanArchive';
import type { NativeBuildingProjectionRefusal } from './urbanBuildingProjection';

export interface UrbanBuildingDraft { seed: string; floors: string; typology: string; model: string; culture?: string; fit?: boolean }
export type UrbanColdBuildingState = Pick<UrbanColdSceneResponse, 'store' | 'counts'> & {
  offset?: { x: number; y: number }; cityKey?: string;
};
export type UrbanBuildingGenerateResult = ({ scene: PlacementBatch; cold?: never } | { cold: UrbanColdBuildingState; scene?: never })
  & { timing?: { sites: number; placement: number } };
export interface UrbanBuildingState {
  seed: string; visible: boolean; appearance: UrbanBuildingAppearance; scene?: PlacementBatch;
  cold?: UrbanColdBuildingState;
  generated?: boolean;
  settings?: PlacementBatchSettings;
  selected?: string; projection?: boolean; camera?: import('./terrain3d').Terrain3dCamera;
}
const xml = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const functionName = (key: string): string => ({ housing: 'Habitat', residential: 'Habitat', commerce: 'Commerce', craft: 'Artisanat', institution: 'Institution', market: 'Marché', common: 'Communs', agriculture: 'Agriculture', ...URBAN_FUNCTION_LABELS } as Record<string, string>)[key] ?? key;

export type UrbanBuildingPanelSelection = { status: 'none' } | { status: 'pending' | 'missing'; id: string }
  | { status: 'error'; id: string; message: string } | { status: 'ready'; id: string; value: BuildingChunkRead };
const coldIdentity = (cold: UrbanColdBuildingState) => JSON.stringify([cold.store.sceneId, cold.store.fingerprint,
  cold.store.sourceFingerprint, cold.counts.generator_version, cold.cityKey ?? null, cold.offset?.x ?? 0, cold.offset?.y ?? 0]);
function panelState(value: UrbanBuildingState): UrbanBuildingState {
  if (value.scene && value.cold) throw new Error('Une scène bâtie ne peut pas conserver à la fois une scène native et un stockage froid.');
  const cold = value.cold;
  if (cold?.offset !== undefined && (!cold.offset || !Number.isFinite(cold.offset.x) || !Number.isFinite(cold.offset.y)))
    throw new Error('Le décalage de la scène bâtie doit contenir deux coordonnées finies.');
  if (cold?.cityKey !== undefined && (typeof cold.cityKey !== 'string' || !cold.cityKey.length))
    throw new Error('La clé de ville de la scène bâtie doit être une chaîne non vide.');
  const offset = cold?.offset;
  return { seed: value.seed, visible: value.visible, appearance: value.appearance, generated: value.generated,
    settings: value.settings, projection: value.projection, camera: value.camera, scene: cold ? undefined : value.scene,
    cold: cold ? Object.freeze({ store: Object.freeze({ format: cold.store.format, sceneId: cold.store.sceneId,
      fingerprint: cold.store.fingerprint, sourceFingerprint: cold.store.sourceFingerprint }),
    counts: Object.freeze({ schema_version: cold.counts.schema_version, generator_version: cold.counts.generator_version,
      buildings: cold.counts.buildings, refusals: cold.counts.refusals, open_spaces: cold.counts.open_spaces }),
      ...(cold.cityKey !== undefined ? { cityKey: cold.cityKey } : {}),
      ...(offset && (offset.x !== 0 || offset.y !== 0) ? { offset: Object.freeze({ x: offset.x === 0 ? 0 : offset.x, y: offset.y === 0 ? 0 : offset.y }) } : {}) }) : undefined,
    selected: cold ? value.selected : value.scene?.buildings.some(b => b.id === value.selected) ? value.selected : undefined };
}
export function urbanBuildingPanelSummary(state: UrbanBuildingState): string {
  if (state.cold) {
    const c = state.cold.counts;
    return `${c.buildings} plans de bâtiments · ${c.refusals} refus · ${c.open_spaces} espaces libres voulus · capacité non évaluée`;
  }
  const scene = state.scene;
  return scene ? `${scene.buildings.length} bâtiments · ${scene.refusals.length} refus · ${scene.open_spaces.length} espaces libres voulus`
    : 'Générez les parcelles pour implanter les bâtiments.';
}
/** Missing metadata differs from an authenticated empty list. Counts continue
 * to come from the committed manifest, never an inferred native batch. */
export function urbanBuildingPanelRefusalsHtml(state: UrbanBuildingState, coldRefusals?: readonly NativeBuildingProjectionRefusal[]): string {
  if (state.cold && coldRefusals === undefined) return state.cold.counts.refusals
    ? `<li>${state.cold.counts.refusals} refus conservés dans l’archive ; liste détaillée indisponible.</li>` : '';
  const refusals = state.cold ? coldRefusals! : state.scene?.refusals ?? [];
  return refusals.map(r => `<li data-refusal="${xml(r.parcel_id)}">${xml(r.parcel_id)} : ${xml(r.message)}</li>`).join('');
}
export function urbanBuildingPanelCapacity(state: UrbanBuildingState, selected: PlacedBuilding): string {
  const scene = state.scene;
  return !state.cold && !!scene && selected.simplification === 'recipe_volumes' && scene.generator_version !== 'silhouette'
    && !scene?.generator_version.startsWith('architectural-plans-') && selected.cartographic?.validation !== 'plan_only'
    ? `${selected.useful_area_m2.toFixed(1)} m² utiles indicatifs · ${selected.domestic_units.toFixed(1)} unités domestiques estimées` : 'capacité non évaluée';
}
export function urbanBuildingPanelEvidence(state: UrbanBuildingState): ReturnType<typeof programmeBalanceEvidence> {
  return state.cold ? () => 'not_calculated' : programmeBalanceEvidence(state.scene);
}

/** State/async orchestration also used by the actual DOM panel. It retains one
 * selected native record, never a cold scene reconstructed as PlacementBatch. */
export function createUrbanBuildingPanelState(initial: UrbanBuildingState, options: {
  readColdBuilding?(cold: UrbanColdBuildingState, id: string): Promise<BuildingChunkRead | undefined>;
  exportCold?(cold: UrbanColdBuildingState): Promise<void>;
  exportScene?(scene: PlacementBatch): void | Promise<void>;
  onUpdate?(state: UrbanBuildingState): void;
}) {
  const { readColdBuilding, exportCold, exportScene, onUpdate } = options;
  let state = panelState(initial), version = 0, selection: UrbanBuildingPanelSelection = { status: 'none' }, exporting = false;
  type Job = { cold: UrbanColdBuildingState; identity: string; id: string; version: number };
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
            throw new Error('Le bâtiment chargé ne correspond pas à la sélection et à son contexte.');
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
    if (!readColdBuilding) selection = { status: 'error', id, message: 'La lecture du bâtiment sélectionné est indisponible.' };
    else { selection = { status: 'pending', id }; pending = { cold, identity: coldIdentity(cold), id, version }; schedule(); }
    if (update) notify(); return true;
  }
  function replace(next: UrbanBuildingState) {
    const accepted = panelState(next); clear(); state = accepted;
    if (state.cold && state.selected) startSelection(state.selected, false); notify();
  }
  if (state.cold && state.selected) startSelection(state.selected, false);
  return {
    get state() { return state; }, get selection() { return selection; }, get version() { return version; }, get exporting() { return exporting; },
    get canExport() { return !exporting && (state.cold ? !!exportCold : !!state.scene && !!exportScene); },
    select: startSelection,
    whenSelectionIdle(): Promise<void> { return running ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve(); },
    restore: replace,
    replaceScene(scene?: PlacementBatch) { replace({ ...state, scene, cold: undefined }); },
    replaceCold(cold?: UrbanColdBuildingState) { replace({ ...state, scene: undefined, cold, selected: cold ? state.selected : undefined }); },
    resetAppliedSettings() { state = { ...state, settings: undefined }; notify(); },
    invalidate() { replace({ ...state, scene: undefined, cold: undefined, selected: undefined }); },
    applyGenerated(result: UrbanBuildingGenerateResult, seed: string, settings: PlacementBatchSettings) {
      if (!!result.scene === !!result.cold) throw new Error('Le résultat doit contenir une seule représentation bâtie.');
      replace({ ...state, seed, settings, generated: true, scene: result.scene, cold: result.cold });
    },
    async openSelected(open: (building: PlacedBuilding, context?: PlanArchiveScene) => Promise<void>): Promise<void> {
      if (state.cold) {
        if (selection.status !== 'ready' || !loaded || !current(loaded)) throw new Error('Le bâtiment sélectionné n’est pas chargé.');
        return open(selection.value.building, selection.value.scene);
      }
      const building = state.scene?.buildings.find(b => b.id === state.selected); if (!building) throw new Error('Aucun bâtiment sélectionné.');
      return open(building);
    },
    async exportCurrent(): Promise<void> {
      if (exporting) throw new Error('Un export est déjà en cours.');
      const cold = state.cold, scene = state.scene;
      if (cold && !exportCold) throw new Error('L’export complet de cette scène est indisponible.');
      if (!cold && (!scene || !exportScene)) throw new Error('Aucune scène bâtie à exporter.');
      exporting = true; notify();
      try { if (cold) await exportCold!(cold); else await exportScene!(scene!); }
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
  readColdBuilding?(cold: UrbanColdBuildingState, id: string): Promise<BuildingChunkRead | undefined>;
  getColdRefusals?(cold: UrbanColdBuildingState): readonly NativeBuildingProjectionRefusal[] | undefined;
  exportCold?(cold: UrbanColdBuildingState): Promise<void>;
  onProjection?(active: boolean): void;
  /** City Bench: flat silhouettes from the lots; house generation options are not offered. */
  silhouettes?: boolean;
}) {
  const programme = document.createElement('details'); programme.id = 'urbanProgrammeStage'; programme.className = 'stage urban-stage'; programme.open = true;
  programme.innerHTML = `<summary>Programme et usages</summary><div class="stage-controls">
    <label>Rôle du lieu<select data-programme="role">${Object.entries({ auto: 'Selon le lieu', 'isolated-farm': 'Ferme isolée', 'roadside-temple': 'Temple en bord de route', agricultural: 'Village agricole', crossroads: 'Carrefour marchand', artisan: 'Bourg artisanal', riverine: 'Implantation fluviale', port: 'Port déclaré', capital: 'Centre institutionnel' }).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
    <details class="advanced"><summary>Culture, époque et ressources</summary>
      <label>Cadre historique<select data-programme="mode"><option value="strict">Historique strict</option><option value="inspired">Historique inspiré</option><option value="fantasy">Fantasy</option></select></label>
      <label>Époque locale<select data-programme="period"><option value="">Selon les époques admises</option><option value="A">Antiquité locale</option><option value="M">Moyen Âge / équivalent local</option></select></label>
      <label>Ressources connues<input data-programme="resources" placeholder="grain, timber, stone…"></label>
      <label>Choix du lieu<input data-programme="lore" placeholder="temple, palace, magic…"></label>
      <label><input type="checkbox" data-programme="navigableAccess">Accès navigable confirmé</label>
      <small>Une rive seule ne constitue pas un port. Laisser vide une ressource inconnue.</small>
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
    <section data-building-inspection aria-live="polite"><small>Cliquer sur un bâtiment pour l’inspecter.</small></section>
    <details class="advanced"><summary>Refus d’implantation</summary><ul data-building-refusals></ul></details>
  </div>`;
  options.host.append(programme, panel);
  const $ = <T extends HTMLElement>(selector: string): T => panel.querySelector(selector) as T;
  const p$ = <T extends HTMLElement>(selector: string): T => programme.querySelector(selector) as T;
  const architecture = document.createElement('label'); architecture.textContent = 'Culture des bâtiments';
  const architectureCulture = document.createElement('select'); architectureCulture.dataset.buildingCulture = '';
  architectureCulture.add(new Option('Selon la culture du lieu', ''));
  for (const [id, culture] of Object.entries(urbanCatalogue.cultures)) architectureCulture.add(new Option(culture.label, id));
  architecture.append(architectureCulture);
  panel.querySelector('.stage-controls')!.insertBefore(architecture, $('[data-building-draft]').previousElementSibling);
  const architectureHint = document.createElement('small'); architectureHint.textContent = 'Changer l’architecture conserve le plan et les parcelles. La maison doit tenir dans le lot et garder son accès.';
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
  let state: UrbanBuildingState = { seed: '', visible: true, appearance: { style: buildingStyle, diagnostic: 'none' } };
  let epoch = 0, busy = false;
  const draftControls = '[data-building-seed], [data-building-floors], [data-building-typology], [data-building-house-model], [data-building-culture], [data-building-fit]';
  for (const control of Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>(draftControls))) {
    control.addEventListener('input', () => { $('[data-building-draft]').hidden = false; });
    control.addEventListener('change', () => { $('[data-building-draft]').hidden = false; });
  }
  let reportedRefusals: readonly NativeBuildingProjectionRefusal[] | undefined;
  let reportedCold: UrbanColdBuildingState | undefined;
  let programmes: UrbanProgramme[] = [], reportedProgrammes: UrbanProgramme[] | undefined, programmeScene: PlacementBatch | undefined,
    programmeCold: UrbanColdBuildingState | undefined;
  function reportProgrammes(): void {
    if (reportedProgrammes === programmes && programmeScene === state.scene && programmeCold === state.cold) return;
    reportedProgrammes = programmes; programmeScene = state.scene; programmeCold = state.cold;
    const balanceEvidence = urbanBuildingPanelEvidence(state);
    p$('[data-programme-report]').innerHTML = programmes.map(p => {
      const evidence = balanceEvidence(p), known = evidence === 'scene_consistent';
      const missing = evidence === 'not_calculated' ? 'non calculé' : 'non vérifié';
      return `<table class="urban-programme"><thead><tr><th>Besoin</th><th>Demande</th><th title="Capacité prévue des parcelles">Prévu</th><th title="Estimation calculée sur les bâtiments générés">Bâti estimé</th><th title="Espaces ouverts conservés dans le bilan de cette scène">Libre</th><th title="Besoin restant selon le programme">Déficit du programme</th></tr></thead><tbody>${p.demands.map(d => `<tr title="${xml([...d.provenance, ...d.reasons].join(' · '))}"><th>${xml(functionName(d.function))}<small>${d.unit === 'domesticUnits' ? 'unités domestiques' : 'm² utiles indicatifs'}</small></th><td>${d.requested.toFixed(1)}</td><td>${d.parcelCapacity.toFixed(1)}</td><td>${known ? d.builtCapacity.toFixed(1) : missing}</td><td>${known ? (d.openCapacity ?? 0).toFixed(1) : missing}</td><td>${d.deficit.toFixed(1)}${known ? '' : ' (programme)'}</td></tr>`).join('')}</tbody></table><small>${known ? 'Estimation calculée sur les bâtiments générés.' : evidence === 'not_calculated' ? 'La capacité des bâtiments n’a pas été évaluée. Les valeurs prévues viennent du programme.' : 'Le bilan des bâtiments n’est pas disponible pour cette scène.'}</small>${p.warnings.length ? `<small data-programme-warnings role="status">${p.warnings.map(xml).join('<br>')}</small>` : ''}<small>${p.cultures.map(c => `${xml(c.culture)} → ${xml(c.architecturePack)}${c.borrowing ? ` · ${xml(c.borrowing)}` : ''}`).join('<br>')}</small>`;
    }).join('') || '<small>Le programme apparaît avec le plan appliqué.</small>';
  }
  const report = (): void => {
    const scene = state.scene, cold = state.cold, loading = model.selection;
    if (!busy) $('[data-buildings-status]').textContent = urbanBuildingPanelSummary(state);
    const exportButton = $<HTMLButtonElement>('[data-building-json]'); exportButton.disabled = !model.canExport;
    exportButton.textContent = cold ? 'Exporter la scène complète' : 'Exporter la scène JSON';
    exportButton.title = cold && !options.exportCold ? 'L’export complet de cette scène est indisponible.' : '';
    if (model.exporting) exportButton.setAttribute('aria-busy', 'true'); else exportButton.removeAttribute('aria-busy');
    const refusals = cold ? options.getColdRefusals?.(cold) : scene?.refusals;
    if (refusals !== reportedRefusals || cold !== reportedCold) $('[data-building-refusals]').innerHTML = urbanBuildingPanelRefusalsHtml(state, cold ? refusals : undefined);
    reportedRefusals = refusals; reportedCold = cold;
    const selected = cold ? loading.status === 'ready' ? loading.value.building : undefined : scene?.buildings.find(b => b.id === state.selected);
    const box = $('[data-building-inspection]'), capacity = selected ? urbanBuildingPanelCapacity(state, selected) : 'capacité non évaluée';
    const emptyInspection = cold && loading.status === 'pending' ? '<small>Chargement du bâtiment sélectionné…</small>'
      : cold && loading.status === 'missing' ? '<small>Le bâtiment sélectionné est absent de cette scène.</small>'
        : cold && loading.status === 'error' ? `<small>Lecture du bâtiment impossible : ${xml(loading.message)}</small>`
          : '<small>Cliquer sur un bâtiment pour l’inspecter.</small>';
    box.innerHTML = selected ? `<strong>${xml(functionName(selected.function))}</strong><dl class="urban-inspection"><dt>Parcelle</dt><dd>${xml(selected.parcel_id)}</dd><dt>Culture et recette</dt><dd>${xml(selected.culture.culture)} · ${xml(selected.recipe_id)}</dd><dt>Sol / hauteur physique</dt><dd>${selected.ground_z_m.toFixed(2)} m / ${buildingHeight(selected).toFixed(2)} m</dd><dt>Indicateurs domestiques</dt><dd>${capacity}</dd><dt>Accès</dt><dd>${xml(selected.access_id)}</dd></dl><button type="button" data-open-house>Ouvrir dans Maisons</button>${selected.culture.borrowing ? `<small>${xml(selected.culture.borrowing)}</small>` : ''}` : emptyInspection;
    const open = box.querySelector<HTMLButtonElement>('[data-open-house]');
    if (open && options.silhouettes) open.hidden = true;
    const selectedVersion = model.version;
    if (open && selected) open.onclick = () => {
      if (selectedVersion !== model.version) return;
      void model.openSelected(options.onOpen).catch(error => { if (selectedVersion === model.version) $('[data-buildings-status]').textContent = String(error); });
    };
    reportProgrammes();
  };
  const model = createUrbanBuildingPanelState(state, { readColdBuilding: options.readColdBuilding, exportCold: options.exportCold,
    exportScene: scene => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(scene)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'urban-scene.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    }, onUpdate: next => { state = next; report(); } });
  state = model.state;
  function changed(): void { report(); options.onChange(state); }
  function syncProgramme(provided?: ProgrammeContext): void {
    const context = { ...defaultProgrammeContext(), ...(provided ?? options.getProgramme()) };
    for (const control of Array.from(programme.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-programme]'))) {
      const value = context[control.dataset.programme! as keyof ProgrammeContext];
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = Array.isArray(value) ? value.join(', ') : String(value);
    }
    p$('[data-programme-draft]').hidden = true;
  }
  programme.addEventListener('change', () => { p$('[data-programme-draft]').hidden = false; });
  p$<HTMLButtonElement>('[data-programme-apply]').onclick = () => {
    const context = { ...defaultProgrammeContext(), ...options.getProgramme() };
    for (const control of Array.from(programme.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-programme]'))) {
      const key = control.dataset.programme! as keyof ProgrammeContext;
      const value = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : ['resources', 'lore'].includes(key) ? control.value.split(',').map(v => v.trim()).filter(Boolean) : control.value;
      Object.assign(context, { [key]: value });
    }
    options.applyProgramme(context); p$('[data-programme-draft]').hidden = true;
  };
  $<HTMLButtonElement>('[data-building-house-bench]').onclick = () => openBench('houses', new URLSearchParams());
  $<HTMLButtonElement>('[data-buildings-generate]').onclick = () => { void generate(); };
  async function generate(applied?: Pick<UrbanBuildingState, 'seed' | 'settings'>): Promise<void> {
    if (busy) return;
    const ticket = ++epoch, seed = applied ? applied.seed : $<HTMLInputElement>('[data-building-seed]').value;
    busy = true; $<HTMLButtonElement>('[data-buildings-generate]').setAttribute('aria-busy', 'true');
    $('[data-buildings-status]').textContent = 'Recherche d’implantations compatibles…';
    try {
      const floors = $<HTMLInputElement>('[data-building-floors]'), typology = $<HTMLSelectElement>('[data-building-typology]').value as PlacementBatchSettings['typology'];
      if (!applied && (!floors.checkValidity() || floors.value.trim() && !Number.isSafeInteger(Number(floors.value)))) throw new Error('Le nombre de niveaux doit être un entier positif. La recette vérifie sa propre plage.');
      const house_config = applied ? applied.settings?.house_config : readUrbanHouseModel($<HTMLInputElement>('[data-building-house-model]').value, options.getProgramme().mode);
      const settings: PlacementBatchSettings = applied ? structuredClone(applied.settings ?? {}) : { parcel_fit: $<HTMLInputElement>('[data-building-fit]').checked, ...(architectureCulture.value ? { culture: architectureCulture.value } : {}), ...(house_config ? { house_config } : {}), ...(floors.value.trim() ? { floors: Number(floors.value) } : {}), ...(typology ? { typology } : {}) };
      const result = await options.generate(seed, settings, (completed, total) => {
        if (ticket === epoch && busy) $('[data-buildings-status]').textContent = `${completed.toLocaleString()} / ${total.toLocaleString()} lots traités`;
      });
      if (ticket !== epoch) return;
      busy = false; model.applyGenerated(result, seed, settings); if (!applied) $('[data-building-draft]').hidden = true; options.onChange(state);
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
  syncProgramme();
  return {
    programme, panel, generate,
    refreshReport: report,
    get state(): UrbanBuildingState { return state; },
    get busy(): boolean { return busy; },
    resetAppliedSettings(): void { model.resetAppliedSettings(); },
    captureDraft(): UrbanBuildingDraft | undefined {
      return $('[data-building-draft]').hidden ? undefined : { seed: $<HTMLInputElement>('[data-building-seed]').value, floors: $<HTMLInputElement>('[data-building-floors]').value, typology: $<HTMLSelectElement>('[data-building-typology]').value, model: $<HTMLInputElement>('[data-building-house-model]').value, culture: architectureCulture.value, fit: $<HTMLInputElement>('[data-building-fit]').checked };
    },
    restoreDraft(draft?: UrbanBuildingDraft): void {
      if (!draft) return;
      $<HTMLInputElement>('[data-building-seed]').value = draft.seed;
      $<HTMLInputElement>('[data-building-floors]').value = draft.floors;
      $<HTMLSelectElement>('[data-building-typology]').value = draft.typology;
      $<HTMLInputElement>('[data-building-house-model]').value = draft.model;
      architectureCulture.value = draft.culture ?? '';
      $<HTMLInputElement>('[data-building-fit]').checked = draft.fit !== false;
      $('[data-building-draft]').hidden = false;
    },
    select(id: string): void { if (model.select(id)) options.onChange(state); },
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
      $<HTMLSelectElement>('[data-building-typology]').value = state.settings?.typology ?? '';
      $<HTMLInputElement>('[data-building-house-model]').value = urbanHouseModelCode(state.settings?.house_config);
      architectureCulture.value = state.settings?.culture ?? '';
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
    syncProgramme,
    setProgrammeDraft(context: ProgrammeContext): void { syncProgramme(context); p$('[data-programme-draft]').hidden = false; },
    setBuildingDraft(saved?: UrbanBuildingState): void {
      if (!saved) return;
      $<HTMLInputElement>('[data-building-seed]').value = saved.seed;
      $<HTMLInputElement>('[data-building-floors]').value = saved.settings?.floors === undefined ? '' : String(saved.settings.floors);
      $<HTMLSelectElement>('[data-building-typology]').value = saved.settings?.typology ?? '';
      $<HTMLInputElement>('[data-building-house-model]').value = urbanHouseModelCode(saved.settings?.house_config);
      architectureCulture.value = saved.settings?.culture ?? '';
      $<HTMLInputElement>('[data-building-fit]').checked = saved.settings?.parcel_fit !== false;
      $('[data-building-draft]').hidden = false;
    },
    invalidate(): void { ++epoch; busy = false; model.invalidate(); $<HTMLButtonElement>('[data-buildings-generate]').removeAttribute('aria-busy'); },
  };
}
