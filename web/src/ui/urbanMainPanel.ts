import type { LayoutConfig, ParcelConfig, QuarterOverride } from '../../../rust/bridge/urbanConfig';
import type { HouseMix, HouseSettings } from '../../../rust/bridge/urbanArchitecture';
import { cityUiText, localizeCityInspector } from './cityInspectorLocale';
import { urbanText } from './urbanPanelLocale';
import { LOCALE_KEY } from './shellLocale';
import { axisApplies, profileSummary } from '../../../rust/bridge/settlementAxes';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const ZONES: Record<string, string> = { core: 'Cœur', middle: 'Extension', edge: 'Périphérie', faubourg: 'Faubourgs', village: 'Village' };
const COLUMNS: [string, string, string][] = [['all', 'Toute', 'Toute la ville'], ['core', '◉ Cœur', 'Cœur'], ['middle', '◎ Ext.', 'Extension'], ['edge', '○ Pér.', 'Périphérie'], ['faubourg', '⋯ Faub.', 'Faubourgs'], ['village', 'Vil.', 'Village']];
export type StageState = 'none' | 'ok' | 'stale' | 'busy' | 'error';
const STAGES = { plan: 'Plan', parcels: 'Lots', houses: 'Maisons' } as const;
const STATE_LOCALIZED: Record<StageState, readonly [string,string,string,string,string]> = { none:['à faire','to do','待完成','pendiente','a fazer'], ok:['à jour','up to date','已更新','actualizado','atualizado'], stale:['à refaire','needs regeneration','需重新生成','pendiente de regenerar','precisa regenerar'], busy:['en cours','in progress','进行中','en curso','em andamento'], error:['erreur','error','错误','error','erro'] };
const STAGE_LOCALIZED: Record<keyof typeof STAGES, readonly [string,string,string,string,string]> = { plan:['Plan','Plan','规划','Plano','Plano'], parcels:['Lots','Parcels','地块','Parcelas','Lotes'], houses:['Maisons','Houses','房屋','Casas','Casas'] };
const SPREADS: Record<HouseMix['spread'], string> = { lot: 'par maison', block: 'par îlot', quarter: 'par quartier' };
const ROWS = [['culture', '🎨', 'Plan', 'Culture du plan'], ['tissue', '╬', 'Rues', 'Maillage des rues'], ['recipe', '▦', 'Îlots', 'Recette des îlots et quartiers'], ['operator', '▤', 'Parcel.', 'Opérateur parcellaire (découpe des lots)'], ['houses', '⌂', 'Maisons', 'Mélange de styles de maisons']] as const;
type MixScope = { kind: 'city' } | { kind: 'zone'; zone: string } | { kind: 'quarter'; key: string };

export interface UrbanMainHost {
  cultures: [string, string][]; tissues: Record<string, string>; operators: Record<string, string>;
  /** `[value, label]` of the engine control behind a plan setting (the choices stay in one place). */
  options(key: string): [string, string][];
  /** Plan recipes (block and quarter shapes) of a culture. */
  recipes(culture: string): [string, string][];
  state(): {
    layout: LayoutConfig; parcels: ParcelConfig; siteCulture: string; target: string;
    /** Growth zones of the plan on screen (undefined = no plan yet). */
    zones?: Set<string>;
    /** Resolved settlement grammar of the plan on screen, and whether it is a village or smaller (phases do not apply). */
    resolved?: string; small: boolean; roads: number;
    /** Grammar the request leads to when known (settlementAxes.expectedGrammar), and the footprint family returned with the plan. */
    grammar?: string; resolvedFamily?: string;
    /** « type · style » of the main enclosure of the plan on screen, `none` without one. */
    resolvedEnclosure?: string;
    /** Effective mixed house styles: the older single culture reads as the city line. */
    houses: HouseSettings;
    quarter?: { key: string; zone: string; culture: string; tissue: string; edit?: QuarterOverride };
    stages: Record<keyof typeof STAGES, StageState>;
    architecture?: { mode: string; options: Record<string, string> };
  };
  setLayout(key: string, value: string | number): void;
  setPlan(zone: string, patch: { culture?: string; tissue?: string; recipe?: string }): void;
  setOperator(zone: string, operator: string): void;
  setCityOperator(operator: string): void;
  setHouses(next: HouseSettings): void;
  editQuarter(key: string, patch: { culture?: string; tissue?: string }): void;
  setArchitecture(mode: string): void;
  steps: Record<keyof typeof STAGES | 'all', () => void>;
  auto: { get(): boolean; set(value: boolean): void };
  /** Copies the selected settlement's urban settings to every settlement (Settlements page only). */
  applyToAll?(): void;
}

/** One cell of the phase grid: what it shows, what a click offers and how it is written back. */
interface Cell {
  own: boolean; text: string; title: string;
  /** Choices (first = the value that means « inherited »). */
  entries?: [string, string][]; current?: string; reset: string;
  set?(value: string): void; houses?: MixScope; label: string;
}

const usable = (mix?: HouseMix): mix is HouseMix => !!mix?.styles.some(s => s.weight > 0 && s.culture);
const abbr = (text: string): string => { const t = text.replace(/\s*\(.*\)$/, '').replace(/^(selon|par) (la |le |les )?/, '').trim(); return t.length > 8 ? `${t.slice(0, 7)}…` : t; };

/** The city inspector: one rule (the most precise choice wins: place culture, city, phase, quarter, lot), one grid, mixed house styles. */
export function createUrbanMainPanel(host: UrbanMainHost) {
  const panel = document.createElement('div'); panel.className = 'urban-main'; panel.id = 'urbanMainStage';
  const label = (id: string): string => cityUiText(host.cultures.find(([c]) => c === id)?.[1] ?? id);
  const tissueEntries = Object.entries(host.tissues).filter(([id]) => id !== 'culture') as [string, string][];
  const operatorEntries = Object.entries(host.operators).filter(([id]) => id !== 'culture') as [string, string][];
  const mirror = (key: string, icon: string, title: string, cls = ''): string => `<label class="um-f ${cls}" title="${title}"><span>${icon}</span><select data-um-cfg="${key}"></select></label>`;
  const cellHtml = (row: string, col: string): string => `<div class="um-c" data-r="${row}" data-c="${col}"><button type="button" class="um-cb"></button><button type="button" class="um-x" title="Revenir à la valeur héritée" tabindex="-1">↺</button></div>`;
  const columnsHtml = (row: string): string => COLUMNS.map(([col]) => cellHtml(row, col)).join('');
  panel.innerHTML = `<div class="um-bar">
      <div class="um-bar-top"><label class="um-auto" title="Régénération automatique du plan, des parcelles, des maisons, et des settlements et routes."><input type="checkbox" data-um-auto>⟳ Auto</label>
        <span class="um-regen" data-um-regen-slot></span><button type="button" class="um-generate" data-um-step="all" title="Régénérer le plan, les lots et les maisons">▶ Générer</button></div>
      <div class="um-bar-top"><span class="um-chips">${(Object.entries(STAGES) as [keyof typeof STAGES, string][]).map(([id, title]) => `<button type="button" class="um-chip" data-um-chip="${id}" data-state="none" title="Relancer ${title.toLowerCase()} et les étapes suivantes"><i class="um-dot"></i>${title}</button>`).join('')}<label class="um-arch" hidden title="Affichage des bâtiments"><select data-um-arch></select></label></span></div>
      <small class="um-note" data-um-note role="status"></small>
      <button type="button" class="um-link" data-um-apply-all hidden title="Copier les réglages urbains de ce settlement vers tous les autres et régénérer">Appliquer à tous les settlements</button>
    </div>
    <div class="um-line">${mirror('culture', '🎨', 'Culture du plan')}</div>
    <small class="um-note" data-um-profile></small>
    <div class="um-line">${mirror('fortification', '🧱', 'Enceinte')}${mirror('settlementForm', '🏘', 'Type de ville')}</div>
    <div class="um-line">${mirror('footprint.family', '⬠', 'Forme de la ville')}${mirror('footprint.mechanism', '🌱', 'Génération : comment la ville croît')}</div>
    <div class="um-line"><label class="um-f" title="Opérateur parcellaire de toute la ville (une phase peut le changer dans la grille, ligne ▤)"><span>▤</span><select data-um-op></select></label><label class="um-f" title="Silhouettes : culture des maisons de toute la ville (un mélange se règle dans la grille, ligne ⌂)"><span>⌂</span><select data-um-house></select></label></div>
    <small class="um-simple" data-um-simple hidden>Forme simplifiée : les phases ne s’appliquent pas, seule la colonne « Toute » compte.</small>
    <details class="um-infl" data-um-infl><summary>+ influence <em data-um-infl-sum></em></summary>
      <div class="um-line">${mirror('mixCulture', '🎨', 'Culture d’influence')}<label class="um-f" title="Part de l’influence"><span>%</span><input type="number" min="0" max="1" step="0.05" data-um-cfg="mixShare"></label>${mirror('mixMode', '◫', 'Répartition')}</div></details>
    <div class="um-grid" data-um-grid>
      <div class="um-gh"></div>${COLUMNS.map(([col, text, title]) => `<div class="um-gh" data-h="${col}" title="${title}">${text}</div>`).join('')}
      ${ROWS.map(([row, icon, name, title]) => `<div class="um-rl" title="${title}"><span>${icon}</span>${name}</div>${columnsHtml(row)}`).join('')}
    </div>
    <div class="um-quarter" data-um-quarter hidden><header><strong data-um-quarter-title></strong></header>
      <div class="um-grid um-grid-q"><div class="um-gh" title="Culture du plan">🎨</div><div class="um-gh" title="Maillage des rues">╬</div><div class="um-gh" title="Découpe des parcelles">▤</div><div class="um-gh" title="Mélange de maisons">⌂</div>
        ${['culture', 'tissue', 'operator', 'houses'].map(row => cellHtml(row, 'q')).join('')}</div></div>
    <div class="um-pop" data-um-pop hidden></div>
    <button type="button" class="um-advanced" data-um-advanced aria-expanded="false" title="Tous les autres réglages, par étape">⚙ Avancé</button>`;
  localizeCityInspector(panel);
  const q = <T extends Element>(selector: string): T => panel.querySelector<T>(selector)!;
  const cellEl = (row: string, col: string): HTMLElement => q(`.um-c[data-r="${row}"][data-c="${col}"]`);

  for (const control of Array.from(panel.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-um-cfg]'))) {
    control.onchange = () => host.setLayout(control.dataset.umCfg!, control instanceof HTMLInputElement ? Number(control.value) : control.value);
  }
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-um-step]'))) button.onclick = () => host.steps[button.dataset.umStep as keyof typeof host.steps]();
  for (const chip of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-um-chip]'))) chip.onclick = () => host.steps[chip.dataset.umChip as keyof typeof STAGES]();
  const arch = q<HTMLSelectElement>('[data-um-arch]'); arch.onchange = () => host.setArchitecture(arch.value);
  const cityOp = q<HTMLSelectElement>('[data-um-op]'); cityOp.onchange = () => host.setCityOperator(cityOp.value);
  const cityHouse = q<HTMLSelectElement>('[data-um-house]');
  cityHouse.onchange = () => {
    if (cityHouse.value === 'mix') return;
    const houses = structuredClone(host.state().houses);
    if (cityHouse.value) houses.city = { styles: [{ culture: cityHouse.value, weight: 100 }], spread: houses.city?.spread ?? 'lot' }; else delete houses.city;
    host.setHouses(houses);
  };
  const auto = q<HTMLInputElement>('[data-um-auto]'); auto.onchange = () => host.auto.set(auto.checked);
  const applyAll = q<HTMLButtonElement>('[data-um-apply-all]'); applyAll.hidden = !host.applyToAll; applyAll.onclick = () => host.applyToAll?.();
  const advanced = q<HTMLButtonElement>('[data-um-advanced]');
  advanced.onclick = () => { const frame = document.getElementById('urbanAdvancedBody'); if (frame) { frame.hidden = !frame.hidden; advanced.setAttribute('aria-expanded', String(!frame.hidden)); if (!frame.hidden) frame.scrollIntoView({ block: 'nearest' }); } };

  // ---- cells: one description per (row, column)
  const scopeOf = (col: string): MixScope => col === 'all' ? { kind: 'city' } : col === 'q' ? { kind: 'quarter', key: host.state().quarter?.key ?? '' } : { kind: 'zone', zone: col };
  const mixOf = (houses: HouseSettings, scope: MixScope): HouseMix | undefined => scope.kind === 'city' ? houses.city : scope.kind === 'zone' ? houses.zones?.[scope.zone] : houses.quarters?.[scope.key];
  const mixText = (mix: HouseMix): string => {
    const styles = mix.styles.filter(s => s.weight > 0 && s.culture).sort((a, b) => b.weight - a.weight);
    return `${abbr(label(styles[0].culture))}${styles.length > 1 ? ` +${styles.length - 1}` : ''}`;
  };
  const summary = (mix: HouseMix): string => {
    const styles = mix.styles.filter(s => s.weight > 0 && s.culture), total = styles.reduce((n, s) => n + s.weight, 0) || 1;
    return `${styles.map(s => `${label(s.culture)} ${Math.round(s.weight / total * 100)} %`).join(' · ')}${styles.length > 1 || mix.spread !== 'lot' ? ` · ${cityUiText(SPREADS[mix.spread])}` : ''}`;
  };
  function cellOf(row: string, col: string): Cell {
    const s = host.state(), { layout, parcels, siteCulture } = s;
    const base = layout.culture && layout.culture !== 'site' ? layout.culture : siteCulture;
    const tissueName = (id: string): string => cityUiText(id === 'culture' ? 'selon la culture' : host.tissues[id] ?? id);
    const operatorName = (id: string): string => cityUiText(id === 'culture' ? 'selon la culture' : host.operators[id] ?? id);
    const over = col === 'all' || col === 'q' ? undefined : layout.phaseOverrides?.[col];
    const cityMix = usable(s.houses.city) ? s.houses.city : undefined;
    const zoneName = cityUiText(ZONES[col] ?? 'la phase');
    const choice = (own: string, inheritedText: string, source: string, entries: [string, string][], reset: string, set: (v: string) => void, names: (id: string) => string = id => label(id)): Cell =>
      ({ own: !!own && own !== reset, text: own && own !== reset ? abbr(cityUiText(names(own))) : `↳ ${abbr(cityUiText(inheritedText))}`, title: own && own !== reset ? `${urbanText(['Choisi ici','Selected here','在此选择','Elegido aquí','Escolhido aqui'])} : ${cityUiText(names(own))}` : `${urbanText(['Hérité','Inherited','继承','Heredado','Herdado'])} ${cityUiText(source)} : ${cityUiText(inheritedText)}`,
        entries: [[reset, `↳ ${cityUiText(inheritedText)}`], ...entries.filter(([id]) => id !== reset)], current: own || reset, reset, set, label: '' });
    if (row === 'houses') {
      const scope = scopeOf(col), own = mixOf(s.houses, scope), inheritedMix = col === 'all' ? undefined : col === 'q' ? (usable(s.houses.zones?.[s.quarter?.zone ?? '']) ? s.houses.zones![s.quarter!.zone] : cityMix) : cityMix;
      const mine = usable(own);
      return { own: mine, text: mine ? mixText(own!) : inheritedMix ? `↳ ${mixText(inheritedMix)}` : `↳ ${cityUiText('Culture')}`, title: mine ? `${urbanText(['Choisi ici','Selected here','在此选择','Elegido aquí','Escolhido aqui'])} : ${summary(own!)}` : inheritedMix ? `${urbanText(['Hérité','Inherited','继承','Heredado','Herdado'])} : ${summary(inheritedMix)}` : urbanText(['Hérité de la culture de chaque phase','Inherited from each phase’s culture','继承各阶段的文化','Heredado de la cultura de cada fase','Herdado da cultura de cada fase']), reset: '', houses: scope, label: col === 'all' ? cityUiText('Toute la ville') : col === 'q' ? `${urbanText(['Quartier','District','街区','Barrio','Bairro'])} ${s.quarter?.key}` : zoneName };
    }
    if (col === 'q') {
      const qs = s.quarter!, edit = qs.edit, zn = ZONES[qs.zone] ?? 'la phase';
      if (row === 'culture') return choice(edit?.culture ?? '', label(qs.culture), `de ${zn}`, host.cultures, '', v => host.editQuarter(qs.key, { culture: v }));
      if (row === 'tissue') return choice(edit?.tissue ?? '', tissueName(qs.tissue), `de ${zn}`, tissueEntries, '', v => host.editQuarter(qs.key, { tissue: v }), tissueName);
      const op = parcels.zoneOperators?.[qs.zone] ?? parcels.operator;
      return { own: false, text: `↳ ${abbr(operatorName(op))}`, title: urbanText(['La découpe se règle par phase, pas par quartier.','Subdivision is set by phase, not by district.','划分按阶段设置，而非按街区设置。','La división se configura por fase, no por barrio.','A divisão é configurada por fase, não por bairro.']), reset: '', label: '' };
    }
    if (row === 'culture') {
      if (col === 'all') return { ...choice(layout.culture || 'site', `Culture du lieu (${label(siteCulture)})`, 'du lieu', [['site', `Culture du lieu (${label(siteCulture)})`], ...host.cultures], 'site', v => host.setLayout('culture', v), id => id === 'site' ? 'lieu' : label(id)), text: layout.culture && layout.culture !== 'site' ? abbr(label(layout.culture)) : `↳ ${abbr(label(siteCulture))}`, label: '' };
      return choice(over?.culture ?? '', label(base), layout.culture && layout.culture !== 'site' ? 'de Toute la ville' : 'de la culture du lieu', host.cultures, '', v => host.setPlan(col, { culture: v }));
    }
    if (row === 'tissue') {
      if (col === 'all') return choice(layout.tissue, 'selon la culture', 'de la culture', tissueEntries, 'culture', v => host.setLayout('tissue', v || 'culture'), tissueName);
      return choice(over?.tissue ?? '', tissueName(layout.tissue), layout.tissue === 'culture' ? 'de la culture' : 'de Toute la ville', tissueEntries, '', v => host.setPlan(col, { tissue: v }), tissueName);
    }
    if (row === 'recipe') {
      const recipes = (culture: string): [string, string][] => host.recipes(culture), name = (culture: string) => (id: string): string => recipes(culture).find(([r]) => r === id)?.[1] ?? id;
      if (col === 'all') return choice(layout.recipe, 'par phase', 'du profil du plan', recipes(base), 'auto', v => host.setLayout('recipe', v || 'auto'), name(base));
      const culture = over?.culture || base;
      return choice(over?.recipe ?? '', layout.recipe === 'auto' ? 'selon la phase' : name(base)(layout.recipe), layout.recipe === 'auto' ? 'du profil du plan' : 'de Toute la ville', recipes(culture), '', v => host.setPlan(col, { recipe: v }), name(culture));
    }
    // operator
    if (col === 'all') return choice(parcels.operator, 'selon la culture', 'de la culture', operatorEntries, 'culture', v => host.setCityOperator(v || 'culture'), operatorName);
    return choice(parcels.zoneOperators?.[col] ?? '', operatorName(parcels.operator), parcels.operator === 'culture' ? 'de la culture' : 'de Toute la ville', operatorEntries, '', v => host.setOperator(col, v), operatorName);
  }

  // ---- popover: choices of a cell, or the house-mix editor
  const pop = q<HTMLElement>('[data-um-pop]');
  let anchor: HTMLElement | undefined, editing: MixScope | undefined, draft: HouseMix | undefined;
  const sameScope = (a?: MixScope, b?: MixScope): boolean => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  function closePop(): void { pop.hidden = true; pop.replaceChildren(); anchor = undefined; editing = draft = undefined; }
  function place(): void {
    if (!anchor) return;
    const box = anchor.getBoundingClientRect(), host2 = panel.getBoundingClientRect(), width = Math.min(260, Math.max(180, host2.width - 8));
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(4, Math.min(window.innerWidth - width - 4, box.left + box.width / 2 - width / 2))}px`;
    const below = box.bottom + 2, height = pop.offsetHeight;
    pop.style.top = `${below + height > window.innerHeight - 4 ? Math.max(4, box.top - height - 2) : below}px`;
  }
  function openList(cellNode: HTMLElement, cell: Cell): void {
    closePop(); anchor = cellNode;
    pop.classList.remove('um-pop-mix');
    pop.replaceChildren(...(cell.entries ?? []).map(([id, text], i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = text;
      if (id === cell.current) b.classList.add('um-sel'); if (i === 0) b.classList.add('um-first');
      b.onclick = () => { const set = cell.set; closePop(); set?.(id); };
      return b;
    }));
    pop.hidden = false; place();
    pop.querySelector<HTMLElement>('.um-sel')?.scrollIntoView({ block: 'nearest' });
  }
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
  /** The editor owns a draft (it may hold a blank style); only styles with a culture reach the engine settings. */
  function commit(): void {
    if (!editing || !draft) return;
    const styles = draft.styles.filter(s => s.culture);
    setMix(editing, styles.length ? { ...draft, styles } : undefined);
  }
  function renderMix(): void {
    if (!editing || !draft) return;
    const scope = editing, d = draft;
    const title = scope.kind === 'city' ? 'Toute la ville' : scope.kind === 'zone' ? ZONES[scope.zone] : `Quartier ${scope.key}`;
    pop.classList.add('um-pop-mix'); pop.hidden = false;
    pop.innerHTML = `<header><strong>⌂ Maisons · ${esc(title)}</strong><button type="button" data-mix-close title="Fermer">✕</button></header>
      ${d.styles.map((s, i) => `<div class="um-style"><select data-mix-culture="${i}"><option value="">Choisir un style</option>${host.cultures.map(([id, text]) => `<option value="${esc(id)}">${esc(text)}</option>`).join('')}</select><input type="number" min="0" max="100" step="5" value="${s.weight}" data-mix-weight="${i}" title="Poids"><button type="button" data-mix-remove="${i}" title="Retirer">×</button></div>`).join('')}
      <div class="um-style-actions"><button type="button" data-mix-add>+ style</button><label>Répartition<select data-mix-spread>${(Object.entries(SPREADS) as [string, string][]).map(([id, text]) => `<option value="${id}">${text}</option>`).join('')}</select></label></div>
      <small>Tirage déterministe selon la graine. Un style sans culture ou à 0 est ignoré ; sans style, la valeur est héritée.</small>`;
    const box = <T extends Element>(selector: string): T => pop.querySelector<T>(selector)!;
    box<HTMLSelectElement>('[data-mix-spread]').value = d.spread;
    box<HTMLButtonElement>('[data-mix-close]').onclick = () => { closePop(); schedule(); };
    box<HTMLSelectElement>('[data-mix-spread]').onchange = event => { d.spread = (event.target as HTMLSelectElement).value as HouseMix['spread']; commit(); };
    box<HTMLButtonElement>('[data-mix-add]').onclick = () => { d.styles.push({ culture: '', weight: 50 }); renderMix(); };
    d.styles.forEach((style, i) => {
      box<HTMLSelectElement>(`[data-mix-culture="${i}"]`).value = style.culture;
      box<HTMLSelectElement>(`[data-mix-culture="${i}"]`).onchange = event => { style.culture = (event.target as HTMLSelectElement).value; commit(); };
      box<HTMLInputElement>(`[data-mix-weight="${i}"]`).onchange = event => { style.weight = Math.max(0, Number((event.target as HTMLInputElement).value) || 0); commit(); };
      box<HTMLButtonElement>(`[data-mix-remove="${i}"]`).onclick = () => { d.styles.splice(i, 1); if (!d.styles.length) d.styles.push({ culture: '', weight: 100 }); commit(); renderMix(); };
    });
    place();
  }
  function openMix(cellNode: HTMLElement, scope: MixScope): void {
    const same = sameScope(editing, scope); closePop();
    if (same) { schedule(); return; }
    anchor = cellNode; editing = scope; const own = mixOf(host.state().houses, scope);
    draft = usable(own) ? structuredClone(own) : { styles: [{ culture: '', weight: 100 }], spread: 'lot' };
    renderMix(); schedule();
  }
  panel.addEventListener('click', event => {
    const target = event.target as HTMLElement, node = target.closest<HTMLElement>('.um-c');
    if (!node) return;
    const row = node.dataset.r!, col = node.dataset.c!, cell = cellOf(row, col);
    if (target.closest('.um-x')) {
      if (cell.houses) { if (sameScope(editing, cell.houses)) closePop(); setMix(cell.houses, undefined); } else cell.set?.(cell.reset);
      return;
    }
    if (!target.closest('.um-cb')) return;
    if (cell.houses) openMix(node, cell.houses);
    else if (cell.entries && cell.set) { if (anchor === node && !pop.hidden) closePop(); else openList(node, cell); }
  });
  document.addEventListener('mousedown', event => { if (!pop.hidden && !pop.contains(event.target as Node) && !(event.target as HTMLElement).closest?.('.um-c')) { closePop(); schedule(); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !pop.hidden) { closePop(); schedule(); } });
  document.addEventListener('scroll', () => { if (!pop.hidden) place(); }, true);
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });

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
  function paint(node: HTMLElement, cell: Cell, absent: boolean, active: boolean): void {
    const button = node.querySelector<HTMLButtonElement>('.um-cb')!;
    button.textContent = cell.text; node.title = absent ? urbanText(['Cette phase n’existe pas dans le plan affiché.','This phase does not exist in the displayed plan.','显示的规划中没有此阶段。','Esta fase no existe en el plano mostrado.','Esta fase não existe no plano exibido.']) : cell.title;
    node.classList.toggle('um-own', cell.own); node.classList.toggle('um-absent', absent); node.classList.toggle('um-active', active);
    node.querySelector<HTMLElement>('.um-x')!.hidden = !cell.own;
  }
  function sync(): void {
    clearTimeout(timer);
    const s = host.state(), { layout, zones } = s;
    // Header
    for (const chip of Array.from(panel.querySelectorAll<HTMLElement>('[data-um-chip]'))) {
      const state = s.stages[chip.dataset.umChip as keyof typeof STAGES]; chip.dataset.state = state;
      chip.title = `${urbanText(STAGE_LOCALIZED[chip.dataset.umChip as keyof typeof STAGES])} · ${urbanText(STATE_LOCALIZED[state])} · ${urbanText(['cliquer pour relancer cette étape et les suivantes','click to rerun this stage and the following stages','点击以重新运行此阶段及后续阶段','pulsa para ejecutar de nuevo esta etapa y las siguientes','clique para executar novamente esta etapa e as seguintes'])}`;
    }
    const archLabel = arch.closest('label')!;
    archLabel.hidden = !s.architecture;
    if (s.architecture) { fill(arch, Object.entries(s.architecture.options)); arch.value = s.architecture.mode; }
    auto.checked = host.auto.get();
    // General line
    for (const control of Array.from(panel.querySelectorAll<HTMLSelectElement | HTMLInputElement>('[data-um-cfg]'))) {
      const key = control.dataset.umCfg!;
      const value = key.startsWith('footprint.') ? (layout.footprint as unknown as Record<string, unknown>)[key.slice(10)] : (layout as unknown as Record<string, unknown>)[key];
      if (control instanceof HTMLInputElement) { if (document.activeElement !== control) control.value = String(value ?? ''); continue; }
      if (key === 'culture') {
        fill(control, [['site', `du lieu (${label(s.siteCulture)})`], ...host.cultures]); set(control, String(value || 'site')); continue;
      }
      const entries = host.options(key).map(([id, text]): [string, string] => key === 'settlementForm' && id === 'auto' ? [id, `Auto → ${s.resolved ?? 'selon la population'}`]
        : key === 'footprint.family' && id === 'auto' && s.resolvedFamily ? [id, `Auto → ${s.resolvedFamily}`]
        : key === 'fortification' && id === 'culture' && s.resolvedEnclosure ? [id, `${text.replace(/ → .*$/, '')} → ${s.resolvedEnclosure}`]
        : key === 'mixCulture' && id === '' ? [id, 'Aucune'] : [id, text]);
      fill(control, entries); set(control, String(value ?? ''));
      control.title = control.selectedOptions[0]?.textContent ?? '';
    }
    fill(cityOp, [['culture', urbanText(['Parcellaire selon la culture','Parcels by culture','按文化划分地块','Parcelas según la cultura','Lotes conforme a cultura'])], ...operatorEntries]); set(cityOp, s.parcels.operator || 'culture');
    cityOp.title = `${urbanText(['Opérateur parcellaire','Parcel operator','地块操作方式','Operador parcelario','Operador de lotes'])} : ${cityOp.selectedOptions[0]?.textContent ?? ''}`;
    const styles = s.houses.city?.styles.filter(st => st.weight > 0 && st.culture) ?? [];
    fill(cityHouse, [['', urbanText(['Maisons selon la culture du plan','Houses by plan culture','按规划文化选择房屋','Casas según la cultura del plano','Casas conforme a cultura do plano'])], ...host.cultures, ...(styles.length > 1 ? [['mix', urbanText([`Mélange de ${styles.length} styles (grille ⌂)`,`Mix of ${styles.length} styles (grid ⌂)`,`${styles.length} 种风格组合（网格 ⌂）`,`Mezcla de ${styles.length} estilos (cuadrícula ⌂)`,`Mistura de ${styles.length} estilos (grade ⌂)`])] as [string, string]] : [])]);
    set(cityHouse, styles.length > 1 ? 'mix' : styles[0]?.culture ?? '');
    cityHouse.title = `Silhouettes : ${cityHouse.selectedOptions[0]?.textContent ?? ''}`;
    q('[data-um-simple]').toggleAttribute('hidden', !s.small);
    // Named profile components, and the axes the expected grammar does not read (hidden, not merely greyed).
    const profileId = layout.culture && layout.culture !== 'site' ? layout.culture : s.siteCulture;
    const profileLine = q<HTMLElement>('[data-um-profile]'); profileLine.textContent = profileSummary(profileId); profileLine.hidden = !profileLine.textContent;
    q<HTMLElement>('[data-um-cfg="footprint.family"]').closest('label')!.hidden = !axisApplies('footprint', s.grammar);
    q<HTMLElement>('[data-um-infl]').hidden = !axisApplies('mix', s.grammar);
    const infl = q<HTMLDetailsElement>('[data-um-infl]');
    q('[data-um-infl-sum]').textContent = layout.mixCulture ? `· ${label(layout.mixCulture)} ${Math.round(layout.mixShare * 100)} %` : ''; if (layout.mixCulture) infl.open = true;
    // Grid: absent phases are greyed, the village column only exists for small types or when used.
    const used = (zone: string): boolean => !!layout.phaseOverrides?.[zone] || !!s.parcels.zoneOperators?.[zone] || !!s.houses.zones?.[zone];
    const showVillage = s.small || !!zones?.has('village') || used('village');
    const hide = (col: string): boolean => col === 'village' && !showVillage;
    for (const [col] of COLUMNS) {
      const absent = col !== 'all' && !!zones && !zones.has(col);
      q<HTMLElement>(`.um-gh[data-h="${col}"]`).hidden = hide(col); q<HTMLElement>(`.um-gh[data-h="${col}"]`).classList.toggle('um-absent', absent);
      for (const [row] of ROWS) {
        const node = cellEl(row, col); node.hidden = hide(col);
        if (!hide(col)) paint(node, cellOf(row, col), absent, !pop.hidden && anchor === node);
      }
    }
    q<HTMLElement>('[data-um-grid]').style.setProperty('--um-n', String(COLUMNS.length - (showVillage ? 0 : 1)));
    // Quarter
    const qs = s.quarter, qBox = q<HTMLElement>('[data-um-quarter]');
    qBox.hidden = !qs;
    if (qs) {
      q('[data-um-quarter-title]').textContent = `Quartier ${qs.key} · ${ZONES[qs.zone] ?? qs.zone}`;
      for (const row of ['culture', 'tissue', 'operator', 'houses']) { const node = cellEl(row, 'q'); paint(node, cellOf(row, 'q'), false, !pop.hidden && anchor === node); }
    } else if (editing?.kind === 'quarter') closePop();
    else if (!pop.hidden && anchor && !anchor.isConnected) closePop();
  }
  window.addEventListener('magna-locale-change', schedule);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) schedule(); });
  return {
    element: panel, sync, schedule,
    regenerationSlot: q<HTMLElement>('[data-um-regen-slot]'),
    note(text: string): void { q('[data-um-note]').textContent = text; q<HTMLElement>('[data-um-note]').title = text; },
  };
}
