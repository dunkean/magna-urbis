import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { POPULATION_CLASSES, regionalPopulation, type RegionalDemography, type PopulationClass } from './regionalPopulation';
import { onLanguageChange, registerMessages, setText, translate } from './i18n';
import './settlementPopulationPanel.css';
import { activitySitesOf } from './activitySites';

registerMessages(Object.fromEntries(Object.entries({
  'Region population': 'Population régionale', 'Global density': 'Densité globale',
  'People / km²': 'Habitants / km²', 'Isolated buildings density': 'Densité des bâtiments isolés',
  'Cities': 'Villes', 'Towns': 'Bourgs', 'Villages': 'Villages', 'Hamlets': 'Hameaux', 'Farmsteads': 'Fermes habitées', 'Isolated buildings': 'Bâtiments isolés',
  'Automatic from the region': 'Automatique selon la région', 'Automatic': 'Automatique', 'Manual': 'Manuel',
  'Restore automatic distribution': 'Rétablir la répartition automatique',
  'Density follows climate, relief and culture. Edit any value to override it; ↶ restores automatic calculation.': 'La densité suit le climat, le relief et la culture. Modifiez une valeur pour l’imposer ; ↶ rétablit le calcul automatique.',
  '{area} km² · largest settlement: {population} inhabitants': '{area} km² · plus grand lieu : {population} habitants',
  'Allocated: {population} inhabitants. The requested population does not fit the selected counts.': 'Répartition : {population} habitants. La population demandée ne tient pas dans les effectifs choisis.',
  'Manual list active. Editing these controls returns to regional distribution.': 'Liste manuelle active. Modifier ces réglages réactive la répartition régionale.',
  'Non-residential sites: mills, workshops, shrines… Inhabited farms are counted above. Placement depends on suitable terrain and resources.': 'Sites sans résidents : moulins, ateliers, sanctuaires… Les fermes habitées sont comptées au-dessus. L’implantation dépend des terrains et ressources disponibles.',
  'Placed: {places} settlements · {population} inhabitants · {isolated} isolated sites': 'Implantés : {places} lieux · {population} habitants · {isolated} sites isolés',
}).map(([en,fr]) => [en,{en,fr}])));

export function mountSettlementPopulationPanel(host: HTMLElement, api: { getSettings(): V2Settings; getWorld(): World | undefined; changed(): void; syncForms(): void }) {
  const root = document.createElement('section'); root.className = 'regional-population'; host.append(root);
  const controls: { key: keyof RegionalDemography | PopulationClass; input: HTMLInputElement; reset: HTMLButtonElement; row: HTMLElement; count: boolean }[] = [];
  const hint = document.createElement('p'); hint.className = 'hint'; setText(hint, 'Density follows climate, relief and culture. Edit any value to override it; ↶ restores automatic calculation.');
  function update(key: string, value: number | undefined, count: boolean): void {
    const s = api.getSettings();
    // A manual composition retains the other displayed counts: automatic
    // population carry must not silently change neighbouring counters.
    const composition = count && value !== undefined ? regionalPopulation(s).counts : undefined;
    s.region ??= {}; s.region.demography ??= {};
    if (s.region.placement?.mode === 'list') s.region.placement.mode = 'auto';
    if (count) {
      const counts = s.region.demography.counts = { ...composition, ...s.region.demography.counts };
      if (value === undefined) { delete counts[key as PopulationClass]; if (s.region.placement?.counts) delete s.region.placement.counts[key]; }
      else counts[key as PopulationClass] = value;
    } else if (value === undefined) delete (s.region.demography as Record<string, unknown>)[key];
    else (s.region.demography as Record<string, unknown>)[key] = value;
    api.changed(); api.syncForms(); sync();
  }
  function field(title: string, key: keyof RegionalDemography | PopulationClass, max: number, step: string, count = false, icon?: number) {
    const row = document.createElement('div'); row.className = `regional-population-field${icon !== undefined ? ' regional-count-card' : ''}`; row.dataset.demographicField = key;
    const label = document.createElement('label'); label.htmlFor = `region-${key}`;
    if (icon !== undefined) { const art = document.createElement('i'); art.className = 'settlement-class-icon'; art.setAttribute('aria-hidden','true'); art.style.backgroundPosition = `${icon % 3 * 50}% ${icon < 3 ? 0 : 100}%`; label.append(art); }
    const caption = document.createElement('span'); setText(caption,title); label.append(caption);
    const input = document.createElement('input'); input.type = 'number'; input.id = `region-${key}`; input.min = '0'; input.max = String(max); input.step = step;
    input.dataset.settingPath = `demography.${count ? 'counts.' : ''}${key}`; input.setAttribute('aria-label',translate(title));input.setAttribute('data-i18n-aria-label',title);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'regional-reset'; reset.textContent = '↶';
    row.append(label,input,reset); root.append(row);
    reset.onclick = () => update(key,undefined,count);
    input.onchange = () => {
      if (!input.checkValidity()) { input.reportValidity(); return; }
      const value = input.value === '' ? undefined : Number(input.value);
      if (count && value !== undefined) {
        const current = regionalPopulation(api.getSettings()).counts;
        if (Object.entries(current).reduce((n,[id,v])=>n+(id === key ? value : v),0) > 1000) { input.setCustomValidity('At most 1000 settlements.'); input.reportValidity(); return; }
      }
      update(key,value,count);
    }; input.oninput = () => input.setCustomValidity('');
    controls.push({ key,input,reset,row,count }); return input;
  }
  field('Global density','density',10000,'any');
  const densityUnit = document.createElement('small'); densityUnit.className = 'regional-density-unit'; setText(densityUnit,'People / km²'); root.querySelector('[data-demographic-field=density] label')!.append(densityUnit);
  const deployment = document.createElement('input'); deployment.type = 'range'; deployment.id = 'settlement-density'; deployment.min = '0'; deployment.max = '3'; deployment.step = '.05'; deployment.setAttribute('aria-label',translate('Global density')); root.append(deployment);
  deployment.oninput = () => update('density',regionalPopulation(api.getSettings()).defaultDensity * Number(deployment.value),false);
  field('Region population','population',100000000,'1');
  const countHost = document.createElement('div'); countHost.className = 'regional-counts'; root.append(countHost);
  POPULATION_CLASSES.forEach((id,i) => { field(['Cities','Towns','Villages','Hamlets','Farmsteads'][i],id,1000,'1',true,i); countHost.append(root.lastElementChild!); });
  field('Isolated buildings','isolatedCount',1000,'1',false,5);
  countHost.append(root.lastElementChild!);
  field('Isolated buildings density','isolatedDensity',10,'.05');
  const isolatedHint = document.createElement('p'); isolatedHint.className = 'hint'; setText(isolatedHint,'Non-residential sites: mills, workshops, shrines… Inhabited farms are counted above. Placement depends on suitable terrain and resources.');
  const summary = document.createElement('p'), placed = document.createElement('p'); summary.className = placed.className = 'hint'; summary.setAttribute('aria-live','polite');
  const resetAll = document.createElement('button'); resetAll.type = 'button'; resetAll.className = 'quiet small'; setText(resetAll,'Restore automatic distribution');
  resetAll.onclick = () => { const s = api.getSettings(); const followCulture = s.region?.demography?.followCulture; s.region ??= {}; s.region.demography = followCulture === undefined ? {} : {followCulture}; if (s.region.placement) { delete s.region.placement.counts; s.region.placement.mode = 'auto'; } api.changed(); api.syncForms(); sync(); };
  const help = document.createElement('details'); help.className = 'regional-population-help';
  const helpTitle = document.createElement('summary'); setText(helpTitle,'Automatic from the region'); help.append(helpTitle,hint,isolatedHint);
  root.append(summary,placed,resetAll,help);
  function sync(): void {
    const s = api.getSettings(), plan = regionalPopulation(s), d = s.region?.demography ?? {};
    for (const control of controls) {
      const {key,input,reset,row,count} = control;
      const own = count ? d.counts?.[key as PopulationClass] ?? s.region?.placement?.counts?.[key] : (d as Record<string,unknown>)[key];
      const value = count ? plan.counts[key as PopulationClass] : plan[key as 'population'|'density'|'isolatedDensity'|'isolatedCount'];
      if (document.activeElement !== input || input.value === '') input.value = String(typeof value === 'number' ? key === 'density' ? Number(value.toPrecision(4)) : value : 0);
      reset.disabled = own === undefined; reset.title = translate('Automatic from the region'); reset.setAttribute('aria-label',`${translate('Automatic from the region')} · ${input.getAttribute('aria-label')}`);
      row.classList.toggle('is-manual',own !== undefined); input.title = translate(own === undefined ? 'Automatic' : 'Manual');
    }
    deployment.value = String(plan.defaultDensity > 0 ? plan.density / plan.defaultDensity : 0);
    summary.textContent = s.region?.placement?.mode === 'list' ? translate('Manual list active. Editing these controls returns to regional distribution.') : plan.unallocated ? translate('Allocated: {population} inhabitants. The requested population does not fit the selected counts.').replace('{population}',String(plan.allocatedPopulation))
      : translate('{area} km² · largest settlement: {population} inhabitants').replace('{area}',String(Number(plan.areaKm2.toFixed(2)))).replace('{population}',String(Math.max(0,...plan.places.map(p=>p.population))));
    const world = api.getWorld(); placed.hidden = !world?.settlements;
    if (world?.settlements) placed.textContent = translate('Placed: {places} settlements · {population} inhabitants · {isolated} isolated sites').replace('{places}',String(world.settlements.length)).replace('{population}',String(world.settlements.reduce((n,p)=>n+p.population,0))).replace('{isolated}',String(activitySitesOf(world).length));
  }
  onLanguageChange(sync); sync(); return { sync };
}
