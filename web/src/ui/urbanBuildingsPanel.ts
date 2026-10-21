import type { UrbanProgramme } from '../../../rust/bridge/urban';
import urbanCatalogue from '../../../rust/crates/core/src/urban/catalogue.json';
import './urbanBuildings.css';
import { openMethodNote } from './methodNotes';
import { defaultProgrammeContext, type ProgrammeContext } from '../../../rust/bridge/urbanConfig';
import type { PlacementBatch, PlacedBuilding, PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import { openBench } from './benchHistory';
import { readUrbanHouseModel, urbanHouseModelCode } from './urbanHouseModel';
import { buildingHeight } from '../render/urbanBuildings';
import { URBAN_FUNCTION_LABELS, type UrbanBuildingAppearance, type UrbanBuildingDiagnostic, type UrbanBuildingStyle } from '../render/urbanBuildingStyle';

export interface UrbanBuildingDraft { seed: string; floors: string; typology: string; model: string; culture?: string; fit?: boolean }
export interface UrbanBuildingState {
  seed: string; visible: boolean; appearance: UrbanBuildingAppearance; scene?: PlacementBatch;
  generated?: boolean;
  settings?: PlacementBatchSettings;
  selected?: string; projection?: boolean; camera?: import('./terrain3d').Terrain3dCamera;
}
const xml = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const functionName = (key: string): string => ({ housing: 'Habitat', residential: 'Habitat', commerce: 'Commerce', craft: 'Artisanat', institution: 'Institution', market: 'Marché', common: 'Communs', agriculture: 'Agriculture', ...URBAN_FUNCTION_LABELS } as Record<string, string>)[key] ?? key;

/** Shared controls for Settlements and the existing urban workshop. Draft inputs
 * are read only by their action; display changes never call generation. */
export function createUrbanBuildingsPanel(options: {
  host: Element; getProgramme(): ProgrammeContext;
  applyProgramme(context: ProgrammeContext): void;
  generate(seed: string, settings: PlacementBatchSettings, onProgress: (completed: number, total: number) => void): Promise<{ scene: PlacementBatch; timing?: { sites: number; placement: number } }>;
  onChange(state: UrbanBuildingState): void;
  onOpen(building: PlacedBuilding): Promise<void>;
  onProjection?(active: boolean): void;
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
  let state: UrbanBuildingState = { seed: '', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' } };
  let epoch = 0, busy = false;
  const draftControls = '[data-building-seed], [data-building-floors], [data-building-typology], [data-building-house-model], [data-building-culture], [data-building-fit]';
  for (const control of Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>(draftControls))) {
    control.addEventListener('input', () => { $('[data-building-draft]').hidden = false; });
    control.addEventListener('change', () => { $('[data-building-draft]').hidden = false; });
  }
  let reportedScene: PlacementBatch | undefined;
  const report = (): void => {
    const scene = state.scene;
    if (!busy) $('[data-buildings-status]').textContent = scene ? `${scene.buildings.length} bâtiments · ${scene.refusals.length} refus · ${scene.open_spaces.length} espaces libres voulus` : 'Générez les parcelles pour implanter les bâtiments.';
    $<HTMLButtonElement>('[data-building-json]').disabled = !scene;
    if (scene !== reportedScene) $('[data-building-refusals]').innerHTML = (scene?.refusals ?? []).map(r => `<li data-refusal="${xml(r.parcel_id)}">${xml(r.parcel_id)} : ${xml(r.message)}</li>`).join('');
    reportedScene = scene;
    const selected = scene?.buildings.find(b => b.id === state.selected), box = $('[data-building-inspection]');
    box.innerHTML = selected ? `<strong>${xml(functionName(selected.function))}</strong><dl class="urban-inspection"><dt>Parcelle</dt><dd>${xml(selected.parcel_id)}</dd><dt>Culture et recette</dt><dd>${xml(selected.culture.culture)} · ${xml(selected.recipe_id)}</dd><dt>Sol / hauteur physique</dt><dd>${selected.ground_z_m.toFixed(2)} m / ${buildingHeight(selected).toFixed(2)} m</dd><dt>Capacité indicative</dt><dd>${selected.useful_area_m2.toFixed(1)} m² · ${selected.domestic_units.toFixed(1)} unités domestiques</dd><dt>Accès</dt><dd>${xml(selected.access_id)}</dd></dl><button type="button" data-open-house>Ouvrir dans Maisons</button>${selected.culture.borrowing ? `<small>${xml(selected.culture.borrowing)}</small>` : ''}` : '<small>Cliquer sur un bâtiment pour l’inspecter.</small>';
    const open = box.querySelector<HTMLButtonElement>('[data-open-house]');
    if (open && selected) open.onclick = () => { void options.onOpen(selected).catch(error => { $('[data-buildings-status]').textContent = String(error); }); };
  };
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
      state = { ...state, seed, settings, scene: result.scene, generated: true }; if (!applied) $('[data-building-draft]').hidden = true; busy = false; changed();
      if (result.timing) $('[data-buildings-status]').textContent += ` · implantation ${result.timing.placement.toFixed(0)} ms`;
    } catch (error) { if (ticket === epoch) $('[data-buildings-status]').textContent = String(error); }
    finally { if (ticket === epoch) { busy = false; $<HTMLButtonElement>('[data-buildings-generate]').removeAttribute('aria-busy'); } }
  }
  $<HTMLInputElement>('[data-building-visible]').onchange = event => { state.visible = (event.target as HTMLInputElement).checked; changed(); };
  $<HTMLSelectElement>('[data-building-style]').onchange = event => { state.appearance = { ...state.appearance, style: (event.target as HTMLSelectElement).value as UrbanBuildingStyle }; changed(); };
  $<HTMLSelectElement>('[data-building-diagnostic]').onchange = event => { state.appearance = { ...state.appearance, diagnostic: (event.target as HTMLSelectElement).value as UrbanBuildingDiagnostic }; changed(); };
  $<HTMLButtonElement>('[data-building-3d]').onclick = () => { state.projection = !state.projection; options.onProjection?.(!!state.projection); $<HTMLButtonElement>('[data-building-3d]').setAttribute('aria-pressed', String(!!state.projection)); options.onChange(state); };
  $<HTMLButtonElement>('[data-building-json]').onclick = () => {
    if (!state.scene) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.scene)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'urban-scene.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  syncProgramme();
  return {
    programme, panel, generate,
    get state(): UrbanBuildingState { return state; },
    get busy(): boolean { return busy; },
    resetAppliedSettings(): void { state = { ...state, settings: undefined }; },
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
    select(id: string): void { if (!state.scene?.buildings.some(b => b.id === id)) return; state.selected = id; changed(); },
    updateProgrammes(programmes: UrbanProgramme[]): void {
      p$('[data-programme-report]').innerHTML = programmes.map(p => `<table class="urban-programme"><thead><tr><th>Besoin</th><th>Demande</th><th title="Capacité parcellaire estimée">Lots</th><th title="Capacité réellement bâtie">Bâti</th><th title="Espaces ouverts effectivement conservés">Libre</th><th>Déficit</th></tr></thead><tbody>${p.demands.map(d => `<tr title="${xml([...d.provenance, ...d.reasons].join(' · '))}"><th>${xml(functionName(d.function))}<small>${d.unit === 'domesticUnits' ? 'unités domestiques' : 'm² utiles indicatifs'}</small></th><td>${d.requested.toFixed(1)}</td><td>${d.parcelCapacity.toFixed(1)}</td><td>${d.builtCapacity.toFixed(1)}</td><td>${(d.openCapacity ?? 0).toFixed(1)}</td><td>${d.deficit.toFixed(1)}</td></tr>`).join('')}</tbody></table>${p.warnings.length ? `<small data-programme-warnings role="status">${p.warnings.map(xml).join('<br>')}</small>` : ''}<small>${p.cultures.map(c => `${xml(c.culture)} → ${xml(c.architecturePack)}${c.borrowing ? ` · ${xml(c.borrowing)}` : ''}`).join('<br>')}</small>`).join('') || '<small>Le programme apparaît avec le plan appliqué.</small>';
    },
    restore(saved?: UrbanBuildingState): void {
      ++epoch; busy = false;
      state = { seed: '', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' }, ...saved };
      state.appearance = { ...state.appearance, style: 'cartographic' };
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
    replaceScene(scene: PlacementBatch | undefined): void { state = { ...state, scene, selected: scene?.buildings.some(building => building.id === state.selected) ? state.selected : undefined }; report(); },
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
    invalidate(): void { ++epoch; busy = false; state = { ...state, scene: undefined, selected: undefined }; report(); $<HTMLButtonElement>('[data-buildings-generate]').removeAttribute('aria-busy'); },
  };
}
