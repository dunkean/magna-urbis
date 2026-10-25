import type { LayoutConfig, ParcelConfig, QuarterOverride } from '../../../rust/bridge/urbanConfig';
import type { HouseMix, HouseSettings } from '../../../rust/bridge/urbanArchitecture';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const ZONES: Record<string, string> = { core: 'Cœur', middle: 'Extension', edge: 'Périphérie', faubourg: 'Faubourgs', village: 'Village' };
export type StageState = 'none' | 'ok' | 'stale' | 'busy' | 'error';
const STAGES = { plan: 'Plan', parcels: 'Parcelles', houses: 'Maisons' } as const;
const STATE_TEXT: Record<StageState, string> = { none: 'à faire', ok: 'à jour', stale: 'à refaire', busy: 'en cours', error: 'erreur' };
const SPREADS: Record<HouseMix['spread'], string> = { lot: 'par maison', block: 'par îlot', quarter: 'par quartier' };
type MixScope = { kind: 'city' } | { kind: 'zone'; zone: string } | { kind: 'quarter'; key: string };

export interface UrbanMainHost {
  cultures: [string, string][]; tissues: Record<string, string>; operators: Record<string, string>;
  /** `[value, label]` of the engine control behind a plan setting (the choices stay in one place). */
  options(key: string): [string, string][];
  state(): {
    layout: LayoutConfig; parcels: ParcelConfig; siteCulture: string; target: string;
    /** Growth zones of the plan on screen (undefined = no plan yet). */
    zones?: Set<string>;
    /** Resolved settlement grammar of the plan on screen, and whether it is a village or smaller (phases do not apply). */
    resolved?: string; small: boolean; roads: number;
    /** Effective mixed house styles: the older single culture reads as the city line. */
    houses: HouseSettings;
    quarter?: { key: string; zone: string; culture: string; tissue: string; edit?: QuarterOverride };
    stages: Record<keyof typeof STAGES, StageState>;
    architecture?: { mode: string; options: Record<string, string> };
  };
  setLayout(key: string, value: string | number): void;
  setPlan(zone: string, patch: { culture?: string; tissue?: string }): void;
  setOperator(zone: string, operator: string): void;
  setCityOperator(operator: string): void;
  setHouses(next: HouseSettings): void;
  editQuarter(key: string, patch: { culture?: string; tissue?: string }): void;
  setArchitecture(mode: string): void;
  steps: Record<keyof typeof STAGES | 'all', () => void>;
  auto: { get(): boolean; set(value: boolean): void };
}

const usable = (mix?: HouseMix): mix is HouseMix => !!mix?.styles.some(s => s.weight > 0 && s.culture);

/** The city panel: one rule (the most precise choice wins: place culture, city, phase, quarter, lot), one table, mixed house styles. */
export function createUrbanMainPanel(host: UrbanMainHost) {
  const panel = document.createElement('details'); panel.className = 'stage urban-stage urban-main'; panel.id = 'urbanMainStage'; panel.open = true;
  const label = (id: string): string => host.cultures.find(([c]) => c === id)?.[1] ?? id;
  const opts = (first: string, entries: [string, string][]): string => `<option value="">${esc(first)}</option>${entries.map(([id, text]) => `<option value="${esc(id)}">${esc(text)}</option>`).join('')}`;
  const cultureEntries = host.cultures;
  const tissueEntries = Object.entries(host.tissues).filter(([id]) => id !== 'culture') as [string, string][];
  const operatorEntries = Object.entries(host.operators).filter(([id]) => id !== 'culture') as [string, string][];
  const cell = (scope: string, field: string, options: string): string =>
    `<div class="um-cell"><select data-um="${scope}:${field}">${options}</select><button type="button" data-um-reset="${scope}:${field}" title="Revenir à la valeur héritée" hidden>↺</button></div>`;
  const houseCell = (scope: string): string => `<div class="um-cell"><button type="button" class="um-houses" data-um-houses="${scope}"></button><button type="button" data-um-reset="${scope}:houses" title="Revenir à la valeur héritée" hidden>↺</button></div>`;
  const tableRows = (scope: string, title: string, plan: string): string => `<tr data-um-row="${scope}"><th scope="row">${title}</th><td data-label="Plan">${plan}</td><td data-label="Rues">${scope === 'city'
    ? `<div class="um-cell"><select data-um="city:tissue">${opts('Selon la culture', tissueEntries)}</select><button type="button" data-um-reset="city:tissue" hidden title="Revenir à la valeur de la culture">↺</button></div>` : cell(scope, 'tissue', opts('', tissueEntries))}</td><td data-label="Lots">${scope === 'city'
    ? `<div class="um-cell"><select data-um="city:operator">${opts('Selon la culture', operatorEntries)}</select><button type="button" data-um-reset="city:operator" hidden title="Revenir à la valeur de la culture">↺</button></div>` : cell(scope, 'operator', opts('', operatorEntries))}</td><td data-label="Maisons">${houseCell(scope)}</td></tr>`;
  const mirror = (key: string, title: string): string => `<label class="um-f">${title}<select data-um-cfg="${key}"></select></label>`;
  panel.innerHTML = `<summary>Ville</summary><div class="stage-controls">
    <div class="um-bar">
      <div class="um-bar-top"><span data-um-scope-slot></span><label class="um-auto" title="Régénération automatique du plan, des parcelles, des maisons, et des settlements et routes."><input type="checkbox" data-um-auto>⟳ Auto</label><span class="um-regen" data-um-regen-slot></span><button type="button" class="um-generate" data-um-step="all">Générer</button></div>
      <div class="um-chips">${(Object.entries(STAGES) as [keyof typeof STAGES, string][]).map(([id, title]) => `<button type="button" class="um-chip" data-um-chip="${id}" data-state="none" title="Relancer cette étape et les suivantes"><b>${title}</b><i></i></button>`).join('')}<label class="um-arch" hidden title="Affichage des bâtiments"><select data-um-arch></select></label></div>
      <small data-um-note role="status"></small>
    </div>
    <section class="um-block"><h4>Ville</h4>
      <label class="um-f">Culture<select data-um-culture></select></label>
      ${mirror('settlementForm', 'Type de ville')}
      <small class="um-simple" data-um-simple hidden>Forme simplifiée : les phases ne s’appliquent pas, seule la ligne « Toute la ville » compte.</small>
      <details class="um-infl" data-um-infl><summary>Influence d’une autre culture <em data-um-infl-sum></em></summary>
        ${mirror('mixCulture', 'Culture')}<label class="um-f">Part<input type="number" min="0" max="1" step="0.05" data-um-cfg="mixShare"></label>${mirror('mixMode', 'Répartition')}</details>
    </section>
    <details class="um-skel" data-um-skel><summary>Squelette <em data-um-skel-sum></em></summary>
      ${mirror('fortification', 'Enceinte')}${mirror('fortificationStyle', 'Style d’enceinte')}${mirror('axisAlignment', 'Axes')}${mirror('exitTreatment', 'Sorties')}${mirror('peripheralRoad', 'Rocade')}${mirror('suburbs', 'Faubourgs')}
    </details>
    <section class="um-block"><h4>Phases</h4>
      <div class="um-scroll"><table class="um-table"><thead><tr><th></th><th title="Culture du plan">Plan</th><th title="Maillage des rues">Rues</th><th title="Découpe des parcelles">Lots</th><th title="Mélange de styles de maisons">Maisons</th></tr></thead><tbody>
      ${tableRows('city', 'Toute la ville', '<span class="um-plan-city" data-um-plan-city></span>')}
      ${Object.entries(ZONES).map(([zone, title]) => tableRows(zone, title, cell(zone, 'culture', opts('', cultureEntries)))).join('')}</tbody></table></div>
      <small class="um-legend">Gris « ↳ » : hérité (survol : de quoi) · normal + ↺ : choisi ici. Le plus précis l’emporte.</small>
    </section>
    <section class="um-block um-quarter" data-um-quarter hidden><h4 data-um-quarter-title></h4>
      <table class="um-table"><tbody><tr data-um-row="q"><td data-label="Plan">${cell('q', 'culture', opts('', cultureEntries))}</td><td data-label="Rues">${cell('q', 'tissue', opts('', tissueEntries))}</td><td data-label="Lots"><span class="um-static" data-um-q-lots></span></td><td data-label="Maisons">${houseCell('q')}</td></tr></tbody></table>
      <small class="um-legend">Plan · Rues · Lots · Maisons de ce quartier.</small>
    </section>
    <div class="um-mix" data-um-mix hidden></div>
    <button type="button" class="um-advanced" data-um-advanced aria-expanded="false">Détails</button></div>`;
  const q = <T extends Element>(selector: string): T => panel.querySelector<T>(selector)!;
  const cultureSelect = q<HTMLSelectElement>('[data-um-culture]');
  cultureSelect.onchange = () => host.setLayout('culture', cultureSelect.value);
  for (const control of Array.from(panel.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-um-cfg]'))) {
    control.onchange = () => host.setLayout(control.dataset.umCfg!, control instanceof HTMLInputElement ? Number(control.value) : control.value);
  }
  const apply = (scope: string, field: string, value: string): void => {
    if (scope === 'q') { host.editQuarter(host.state().quarter!.key, { [field]: value }); return; }
    if (scope === 'city') { if (field === 'tissue') host.setLayout('tissue', value || 'culture'); else host.setCityOperator(value || 'culture'); return; }
    if (field === 'operator') host.setOperator(scope, value); else host.setPlan(scope, { [field]: value });
  };
  for (const select of Array.from(panel.querySelectorAll<HTMLSelectElement>('select[data-um]'))) {
    const [scope, field] = select.dataset.um!.split(':');
    select.onchange = () => apply(scope, field, select.value);
  }
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-um-reset]'))) {
    const [scope, field] = button.dataset.umReset!.split(':');
    button.onclick = () => { if (field === 'houses') { if (sameScope(editing, scopeOf(scope))) { editing = draft = undefined; renderMix(); } setMix(scopeOf(scope), undefined); } else apply(scope, field, ''); };
  }
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-um-step]'))) button.onclick = () => host.steps[button.dataset.umStep as keyof typeof host.steps]();
  for (const chip of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-um-chip]'))) chip.onclick = () => host.steps[chip.dataset.umChip as keyof typeof STAGES]();
  const arch = q<HTMLSelectElement>('[data-um-arch]'); arch.onchange = () => host.setArchitecture(arch.value);
  const auto = q<HTMLInputElement>('[data-um-auto]'); auto.onchange = () => host.auto.set(auto.checked);
  const advanced = q<HTMLButtonElement>('[data-um-advanced]');
  advanced.onclick = () => { const frame = document.getElementById('urbanAdvancedBody'); if (frame) { frame.hidden = !frame.hidden; advanced.setAttribute('aria-expanded', String(!frame.hidden)); if (!frame.hidden) frame.scrollIntoView({ block: 'nearest' }); } };

  // ---- house mix: summary and the in-place editor
  const scopeOf = (scope: string): MixScope => scope === 'city' ? { kind: 'city' } : scope === 'q' ? { kind: 'quarter', key: host.state().quarter?.key ?? '' } : { kind: 'zone', zone: scope };
  const mixOf = (houses: HouseSettings, scope: MixScope): HouseMix | undefined => scope.kind === 'city' ? houses.city : scope.kind === 'zone' ? houses.zones?.[scope.zone] : houses.quarters?.[scope.key];
  const summary = (mix: HouseMix): string => {
    const styles = mix.styles.filter(s => s.weight > 0 && s.culture), total = styles.reduce((n, s) => n + s.weight, 0) || 1;
    return `${styles.map(s => `${label(s.culture)} ${Math.round(s.weight / total * 100)} %`).join(' · ')}${styles.length > 1 || mix.spread !== 'lot' ? ` · ${SPREADS[mix.spread]}` : ''}`;
  };
  function setMix(scope: MixScope, mix: HouseMix | undefined): void {
    const houses = structuredClone(host.state().houses);
    if (scope.kind === 'city') { if (mix) houses.city = mix; else delete houses.city; }
    else {
      const key = scope.kind === 'zone' ? 'zones' : 'quarters', id = scope.kind === 'zone' ? scope.zone : scope.key, map = { ...houses[key] };
      if (mix) map[id] = mix; else delete map[id];
      if (Object.keys(map).length) houses[key] = map; else delete houses[key];
    }
    host.setHouses(houses); schedule();
  }
  let editing: MixScope | undefined, draft: HouseMix | undefined;
  const mixBox = q<HTMLElement>('[data-um-mix]');
  const sameScope = (a?: MixScope, b?: MixScope): boolean => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  /** The editor owns a draft (it may hold a blank style); only styles with a culture reach the engine settings. */
  function commit(): void {
    if (!editing || !draft) return;
    const styles = draft.styles.filter(s => s.culture);
    setMix(editing, styles.length ? { ...draft, styles } : undefined);
  }
  function renderMix(): void {
    if (!editing || !draft) { mixBox.hidden = true; return; }
    const scope = editing, d = draft;
    const title = scope.kind === 'city' ? 'Toute la ville' : scope.kind === 'zone' ? ZONES[scope.zone] : `Quartier ${scope.key}`;
    mixBox.hidden = false;
    mixBox.innerHTML = `<header><strong>Maisons · ${esc(title)}</strong><button type="button" data-mix-close title="Fermer">✕</button></header>
      ${d.styles.map((s, i) => `<div class="um-style"><select data-mix-culture="${i}">${opts('Choisir un style', cultureEntries)}</select><input type="number" min="0" max="100" step="5" value="${s.weight}" data-mix-weight="${i}" title="Poids"><button type="button" data-mix-remove="${i}" title="Retirer">×</button></div>`).join('')}
      <div class="um-style-actions"><button type="button" data-mix-add>+ style</button><label>Répartition<select data-mix-spread>${(Object.entries(SPREADS) as [string, string][]).map(([id, text]) => `<option value="${id}">${text}</option>`).join('')}</select></label></div>
      <small>Tirage déterministe selon la graine. Un style sans culture ou à 0 est ignoré ; sans style, la valeur est héritée.</small>`;
    const box = <T extends Element>(selector: string): T => mixBox.querySelector<T>(selector)!;
    box<HTMLSelectElement>('[data-mix-spread]').value = d.spread;
    box<HTMLButtonElement>('[data-mix-close]').onclick = () => { editing = draft = undefined; renderMix(); schedule(); };
    box<HTMLSelectElement>('[data-mix-spread]').onchange = event => { d.spread = (event.target as HTMLSelectElement).value as HouseMix['spread']; commit(); };
    box<HTMLButtonElement>('[data-mix-add]').onclick = () => { d.styles.push({ culture: '', weight: 50 }); renderMix(); };
    d.styles.forEach((style, i) => {
      box<HTMLSelectElement>(`[data-mix-culture="${i}"]`).value = style.culture;
      box<HTMLSelectElement>(`[data-mix-culture="${i}"]`).onchange = event => { style.culture = (event.target as HTMLSelectElement).value; commit(); };
      box<HTMLInputElement>(`[data-mix-weight="${i}"]`).onchange = event => { style.weight = Math.max(0, Number((event.target as HTMLInputElement).value) || 0); commit(); };
      box<HTMLButtonElement>(`[data-mix-remove="${i}"]`).onclick = () => { d.styles.splice(i, 1); if (!d.styles.length) d.styles.push({ culture: '', weight: 100 }); commit(); renderMix(); };
    });
  }
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-um-houses]'))) {
    button.onclick = () => {
      const scope = scopeOf(button.dataset.umHouses!);
      if (sameScope(editing, scope)) { editing = draft = undefined; renderMix(); schedule(); return; }
      editing = scope; const own = mixOf(host.state().houses, scope);
      draft = usable(own) ? structuredClone(own) : { styles: [{ culture: '', weight: 100 }], spread: 'lot' };
      renderMix(); schedule();
    };
  }

  // ---- synchronisation with the engine settings
  const set = (select: HTMLSelectElement, value: string): void => {
    if (value && !Array.from(select.options).some(o => o.value === value)) select.add(new Option(value, value));
    select.value = value;
  };
  const fill = (select: HTMLSelectElement, entries: [string, string][]): void => {
    const key = JSON.stringify(entries);
    if (select.dataset.filled !== key) { select.replaceChildren(...entries.map(([id, text]) => new Option(text, id))); select.dataset.filled = key; }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(): void { clearTimeout(timer); timer = setTimeout(sync, 40); }
  function sync(): void {
    clearTimeout(timer);
    const s = host.state(), { layout, parcels, siteCulture, zones } = s;
    const base = layout.culture && layout.culture !== 'site' ? layout.culture : siteCulture;
    const cityMix = usable(s.houses.city) ? s.houses.city : undefined;
    const tissueName = (id: string): string => id === 'culture' ? 'selon la culture' : host.tissues[id] ?? id;
    const operatorName = (id: string): string => id === 'culture' ? 'selon la culture' : host.operators[id] ?? id;
    q('[data-um-scope-slot]').toggleAttribute('hidden', !q('[data-um-scope-slot]').childElementCount);
    // Ville
    cultureSelect.replaceChildren(new Option(`Culture du lieu (${label(siteCulture)})`, 'site'), ...host.cultures.map(([id, text]) => new Option(text, id)));
    set(cultureSelect, layout.culture || 'site');
    for (const control of Array.from(panel.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-um-cfg]'))) {
      const key = control.dataset.umCfg!, value = (layout as unknown as Record<string, unknown>)[key];
      if (control instanceof HTMLInputElement) { if (document.activeElement !== control) control.value = String(value ?? ''); continue; }
      const entries = host.options(key).map(([id, text]): [string, string] => key === 'settlementForm' && id === 'auto' ? [id, `Auto → ${s.resolved ?? 'selon la population'}`]
        : key === 'mixCulture' && id === '' ? [id, 'Aucune'] : [id, text]);
      fill(control, entries); set(control, String(value ?? ''));
    }
    q('[data-um-simple]').toggleAttribute('hidden', !s.small);
    const infl = q<HTMLDetailsElement>('[data-um-infl]'), mixLabel = layout.mixCulture ? ` · ${label(layout.mixCulture)} ${Math.round(layout.mixShare * 100)} %` : '';
    q('[data-um-infl-sum]').textContent = mixLabel; if (layout.mixCulture) infl.open = true;
    const choice = (key: string): string => host.options(key).find(([id]) => id === String((layout as unknown as Record<string, unknown>)[key]))?.[1] ?? '';
    const fort = layout.fortification === 'culture' ? 'Enceinte selon culture' : layout.fortification === 'none' ? 'Sans enceinte' : `Enceinte : ${choice('fortification').toLowerCase()}`;
    q('[data-um-skel-sum]').textContent = `· ${fort} · ${s.roads} route${s.roads > 1 ? 's' : ''} · ${layout.axisAlignment === 'regional' ? 'axes régionaux' : 'axes de la culture'}`;
    // Table
    q('[data-um-plan-city]').textContent = label(base); q<HTMLElement>('[data-um-plan-city]').title = layout.culture && layout.culture !== 'site' ? 'Culture choisie dans « Ville »' : 'Culture du lieu';
    const cityTissue = layout.tissue, cityOperator = parcels.operator;
    set(q<HTMLSelectElement>('[data-um="city:tissue"]'), cityTissue === 'culture' ? '' : cityTissue);
    set(q<HTMLSelectElement>('[data-um="city:operator"]'), cityOperator === 'culture' ? '' : cityOperator);
    q<HTMLButtonElement>('[data-um-reset="city:tissue"]').hidden = cityTissue === 'culture';
    q<HTMLButtonElement>('[data-um-reset="city:operator"]').hidden = cityOperator === 'culture';
    q<HTMLElement>('[data-um-row="city"]').classList.toggle('um-over-tissue', cityTissue !== 'culture');
    for (const [column, own] of [['tissue', cityTissue !== 'culture'], ['operator', cityOperator !== 'culture']] as const) q(`[data-um="city:${column}"]`).classList.toggle('um-own', own);
    houseButton('city', s.houses.city, undefined, 'la culture de chaque phase');
    for (const zone of Object.keys(ZONES)) {
      const over = layout.phaseOverrides?.[zone], tr = q<HTMLElement>(`[data-um-row="${zone}"]`);
      const absent = !!zones && !zones.has(zone) || (s.small && zone !== 'village' && zone !== 'core' && !over && !s.houses.zones?.[zone] && !parcels.zoneOperators?.[zone]);
      tr.hidden = zone === 'village' && !s.small && !over && !parcels.zoneOperators?.[zone] && !s.houses.zones?.[zone] && !(zones?.has('village'));
      tr.classList.toggle('um-absent', absent && !!zones); tr.title = absent && zones ? 'Cette phase n’existe pas dans le plan affiché.' : '';
      const values: Record<string, [string, string, string]> = {
        culture: [over?.culture ?? '', `↳ ${label(base)}`, layout.culture && layout.culture !== 'site' ? 'de Toute la ville' : 'de la culture du lieu'],
        tissue: [over?.tissue ?? '', `↳ ${tissueName(cityTissue)}`, cityTissue === 'culture' ? 'de la culture' : 'de Toute la ville'],
        operator: [parcels.zoneOperators?.[zone] ?? '', `↳ ${operatorName(cityOperator)}`, cityOperator === 'culture' ? 'de la culture' : 'de Toute la ville'],
      };
      for (const [field, [value, inherited, source]] of Object.entries(values)) {
        const select = q<HTMLSelectElement>(`[data-um="${zone}:${field}"]`);
        select.options[0].textContent = inherited; select.title = value ? 'Choisi pour cette phase' : `Hérité ${source}`;
        set(select, value); select.classList.toggle('um-own', !!value); q<HTMLButtonElement>(`[data-um-reset="${zone}:${field}"]`).hidden = !value;
      }
      houseButton(zone, s.houses.zones?.[zone], cityMix, 'la culture de la phase');
    }
    // Quarter
    const qs = s.quarter, qBox = q<HTMLElement>('[data-um-quarter]');
    qBox.hidden = !qs;
    if (qs) {
      q('[data-um-quarter-title]').textContent = `Quartier ${qs.key} · ${ZONES[qs.zone] ?? qs.zone}`;
      const zoneMix = usable(s.houses.zones?.[qs.zone]) ? s.houses.zones![qs.zone] : undefined;
      const fields: [string, string, string, string][] = [['culture', qs.edit?.culture ?? '', `↳ ${label(qs.culture)}`, `de ${ZONES[qs.zone] ?? 'la phase'}`], ['tissue', qs.edit?.tissue ?? '', `↳ ${tissueName(qs.tissue)}`, `de ${ZONES[qs.zone] ?? 'la phase'}`]];
      for (const [field, value, inherited, source] of fields) {
        const select = q<HTMLSelectElement>(`[data-um="q:${field}"]`);
        select.options[0].textContent = inherited; select.title = value ? 'Choisi pour ce quartier' : `Hérité ${source}`;
        set(select, value); select.classList.toggle('um-own', !!value); q<HTMLButtonElement>(`[data-um-reset="q:${field}"]`).hidden = !value;
      }
      q('[data-um-q-lots]').textContent = `↳ ${operatorName(parcels.zoneOperators?.[qs.zone] ?? cityOperator)}`;
      q<HTMLElement>('[data-um-q-lots]').title = 'La découpe se règle par phase, pas par quartier.';
      houseButton('q', s.houses.quarters?.[qs.key], zoneMix ?? cityMix, 'la phase');
    } else if (editing?.kind === 'quarter') { editing = draft = undefined; renderMix(); }
    // Action bar
    for (const chip of Array.from(panel.querySelectorAll<HTMLElement>('[data-um-chip]'))) {
      const state = s.stages[chip.dataset.umChip as keyof typeof STAGES]; chip.dataset.state = state;
      chip.querySelector('i')!.textContent = STATE_TEXT[state];
    }
    const archLabel = arch.closest('label')!;
    archLabel.hidden = !s.architecture;
    if (s.architecture) { fill(arch, Object.entries(s.architecture.options)); arch.value = s.architecture.mode; }
    auto.checked = host.auto.get();
  }
  function houseButton(scope: string, own: HouseMix | undefined, inherited: HouseMix | undefined, fallback: string): void {
    const button = q<HTMLButtonElement>(`[data-um-houses="${scope}"]`), mine = usable(own);
    const text = mine ? summary(own!) : inherited ? `↳ ${summary(inherited)}` : `↳ ${fallback}`;
    button.textContent = text; button.title = mine ? 'Choisi ici · cliquer pour modifier' : inherited ? 'Hérité de Toute la ville · cliquer pour choisir' : 'Hérité · cliquer pour mélanger des styles';
    button.classList.toggle('um-own', mine); button.setAttribute('aria-expanded', String(sameScope(editing, scopeOf(scope))));
    q<HTMLButtonElement>(`[data-um-reset="${scope}:houses"]`).hidden = !mine;
  }
  return {
    element: panel, sync, schedule,
    scopeSlot: q<HTMLElement>('[data-um-scope-slot]'), regenerationSlot: q<HTMLElement>('[data-um-regen-slot]'),
    note(text: string): void { q('[data-um-note]').textContent = text; },
  };
}
