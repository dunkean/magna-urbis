import type { LayoutConfig, ParcelConfig } from '../../../rust/bridge/urbanConfig';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const ZONES: Record<string, string> = { core: 'Cœur', middle: 'Extension', edge: 'Périphérie', faubourg: 'Faubourgs', village: 'Village' };

export interface UrbanMainHost {
  cultures: [string, string][]; tissues: Record<string, string>; operators: Record<string, string>;
  /** Current drafts, the culture of the place, and the growth zones of the plan on screen (undefined = no plan yet). */
  state(): { layout: LayoutConfig; parcels: ParcelConfig; siteCulture: string; zones?: Set<string>; target: string };
  setCulture(value: string): void;
  setPlan(zone: string, patch: { culture?: string; tissue?: string }): void;
  setOperator(zone: string, operator: string): void;
  steps: Record<'quarters' | 'parcels' | 'buildings' | 'all', () => void>;
  auto: { get(): boolean; set(value: boolean): void };
}

/** The main generation sequence: scope, culture, one block per growth zone, regeneration; advanced options sit behind one button. */
export function createUrbanMainPanel(host: UrbanMainHost) {
  const panel = document.createElement('details'); panel.className = 'stage urban-stage urban-main'; panel.id = 'urbanMainStage'; panel.open = true;
  const cultureOptions = (first: string): string => `<option value="">${esc(first)}</option>${host.cultures.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}`;
  const tissueOptions = (first: string): string => `<option value="">${esc(first)}</option>${Object.entries(host.tissues).filter(([id]) => id !== 'culture').map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}`;
  const operatorOptions = (first: string): string => `<option value="">${esc(first)}</option>${Object.entries(host.operators).filter(([id]) => id !== 'culture').map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}`;
  const row = (zone: string, field: string, label: string, options: string): string =>
    `<div class="um-row" data-um-row="${zone}:${field}"><span>${label}</span><select data-um="${zone}:${field}">${options}</select><button type="button" data-um-reset="${zone}:${field}" title="Revenir à la valeur de la culture" hidden>↺ culture</button></div>`;
  panel.innerHTML = `<summary>Génération de la ville</summary><div class="stage-controls">
    <div class="um-scope"><span data-um-scope-slot></span><small data-um-scope-note></small></div>
    <label class="um-culture">Culture de la ville<select data-um-culture><option value="site">Culture du lieu</option>${host.cultures.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}</select></label>
    <small class="um-hint">Chaque phase suit la culture, sauf choix contraire ; « ↺ culture » rétablit la valeur de la culture.</small>
    <div class="um-zones">${Object.entries(ZONES).map(([zone, title]) => `<fieldset data-um-zone="${zone}"><legend>${title} <em data-um-flag></em></legend>
      ${row(zone, 'culture', 'Plan', cultureOptions('Culture'))}${row(zone, 'tissue', 'Maillage', tissueOptions('Selon la culture'))}${row(zone, 'operator', 'Parcelles', operatorOptions('Selon la culture'))}</fieldset>`).join('')}</div>
    <div class="um-regen"><label><input type="checkbox" data-um-auto>Régénération automatique</label><span data-um-regen-slot></span>
      <div class="um-steps"><button type="button" data-um-step="quarters">Plan et quartiers</button><button type="button" data-um-step="parcels">Parcelles</button><button type="button" data-um-step="buildings">Bâtiments</button></div>
      <button type="button" class="um-all" data-um-step="all">Générer la ville complète</button><small data-um-note role="status"></small></div>
    <button type="button" class="um-advanced" data-um-advanced aria-expanded="false">Options avancées</button></div>`;
  const q = <T extends Element>(selector: string): T => panel.querySelector<T>(selector)!;
  const cultureSelect = q<HTMLSelectElement>('[data-um-culture]');
  cultureSelect.onchange = () => host.setCulture(cultureSelect.value);
  for (const select of Array.from(panel.querySelectorAll<HTMLSelectElement>('select[data-um]'))) {
    const [zone, field] = select.dataset.um!.split(':');
    select.onchange = () => { if (field === 'operator') host.setOperator(zone, select.value); else host.setPlan(zone, { [field]: select.value }); };
  }
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-um-reset]'))) {
    const [zone, field] = button.dataset.umReset!.split(':');
    button.onclick = () => { if (field === 'operator') host.setOperator(zone, ''); else host.setPlan(zone, { [field]: '' }); };
  }
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-um-step]'))) button.onclick = () => host.steps[button.dataset.umStep as keyof typeof host.steps]();
  const auto = q<HTMLInputElement>('[data-um-auto]'); auto.onchange = () => host.auto.set(auto.checked);
  const advanced = q<HTMLButtonElement>('[data-um-advanced]');
  function sync(): void {
    const { layout, parcels, siteCulture, zones, target } = host.state();
    const label = (id: string): string => host.cultures.find(([c]) => c === id)?.[1] ?? id;
    const base = layout.culture && layout.culture !== 'site' ? layout.culture : siteCulture;
    const set = (select: HTMLSelectElement, value: string): void => {
      if (value && !Array.from(select.options).some(o => o.value === value)) select.add(new Option(value, value));
      select.value = value;
    };
    const siteOption = cultureSelect.options[0]; siteOption.textContent = `Culture du lieu (${label(siteCulture)})`;
    set(cultureSelect, layout.culture || 'site');
    q('[data-um-scope-note]').textContent = target === 'all' ? 'Ces réglages valent pour tous les settlements.' : 'Ces réglages valent pour ce settlement seul.';
    for (const zone of Object.keys(ZONES)) {
      const over = layout.phaseOverrides?.[zone], operator = parcels.zoneOperators?.[zone] ?? '';
      const values: Record<string, string> = { culture: over?.culture ?? '', tissue: over?.tissue ?? '', operator };
      const fieldset = q<HTMLElement>(`[data-um-zone="${zone}"]`);
      fieldset.classList.toggle('um-absent', !!zones && !zones.has(zone));
      fieldset.title = zones && !zones.has(zone) ? 'Cette phase n’existe pas dans le plan affiché.' : '';
      let count = 0;
      for (const [field, value] of Object.entries(values)) {
        set(q<HTMLSelectElement>(`[data-um="${zone}:${field}"]`), value);
        const row = q<HTMLElement>(`[data-um-row="${zone}:${field}"]`);
        row.classList.toggle('um-over', !!value); q<HTMLButtonElement>(`[data-um-reset="${zone}:${field}"]`).hidden = !value;
        if (value) count++;
      }
      q(`[data-um="${zone}:culture"]`).firstElementChild!.textContent = `Culture (${label(base)})`;
      fieldset.querySelector('[data-um-flag]')!.textContent = count ? `· ${count} personnalisé${count > 1 ? 's' : ''}` : '· selon la culture';
    }
    auto.checked = host.auto.get();
  }
  advanced.onclick = () => { const frame = document.getElementById('urbanAdvancedBody'); if (frame) { frame.hidden = !frame.hidden; advanced.setAttribute('aria-expanded', String(!frame.hidden)); if (!frame.hidden) frame.scrollIntoView({ block: 'nearest' }); } };
  return {
    element: panel, sync,
    scopeSlot: q<HTMLElement>('[data-um-scope-slot]'), regenerationSlot: q<HTMLElement>('[data-um-regen-slot]'),
    note(text: string): void { q('[data-um-note]').textContent = text; },
  };
}
