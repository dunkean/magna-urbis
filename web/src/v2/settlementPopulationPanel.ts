import type { V2Settings } from './contracts';
import type { World } from '../gen/types';
import { POPULATION_CLASSES, regionalPopulation, automaticSettlementLimits, automaticIsolatedLimit, type RegionalDemography, type PopulationClass } from './regionalPopulation';
import { onLanguageChange, registerMessages, setText, translate } from './i18n';
import './settlementPopulationPanel.css';
import { activitySitesOf } from './activitySites';
import { clearRegionalPopulation, editRegionalPopulation, followEnvironmentPopulation, type RegionalPopulationField } from './regionalPopulationEdits';

registerMessages(Object.fromEntries(Object.entries({
  'Region population': 'Population régionale', 'Global density': 'Densité globale',
  'People / km²': 'Habitants / km²', 'Isolated buildings density': 'Densité des bâtiments isolés',
  'Cities': 'Villes', 'Towns': 'Bourgs', 'Villages': 'Villages', 'Hamlets': 'Hameaux', 'Farmsteads': 'Fermes habitées', 'Isolated buildings': 'Bâtiments isolés',
  'Automatic from the region': 'Automatique selon la région', 'Automatic': 'Automatique', 'Manual': 'Manuel',
  'Follow the environment': 'Suivre le milieu naturel',
  'Clear the chosen counts, population and density: the places follow the map size, biome and culture again.': 'Effacer les effectifs, la population et la densité choisis : les lieux suivent de nouveau la taille de la carte, le biome et la culture.',
  'Remove every settlement: all place counts and the region population become 0.': 'Supprimer tous les lieux habités : tous les effectifs et la population régionale passent à 0.',
  'Density follows climate, relief and culture. Edit any value to override it; ↶ restores automatic calculation.': 'La densité suit le climat, le relief et la culture. Modifiez une valeur pour l’imposer ; ↶ rétablit le calcul automatique.',
  'The places make the population: adding or removing a place changes it. Changing population or density resizes the places without changing their number. Editing a count fixes only that class; ↶ restores its automatic count. Even harsh regions keep a few places.': 'Les lieux font la population : ajouter ou retirer un lieu la modifie. Changer la population ou la densité redimensionne les lieux sans changer leur nombre. Modifier un effectif impose seulement cette catégorie ; ↶ rétablit son calcul automatique. Même les régions rudes gardent quelques lieux.',
  '{area} km² · largest settlement: {population} inhabitants': '{area} km² · plus grand lieu : {population} habitants',
  'Allocated: {population} inhabitants. The requested population does not fit the selected counts.': 'Répartition : {population} habitants. La population demandée ne tient pas dans les effectifs choisis.',
  'Manual list active. Editing these controls returns to regional distribution.': 'Liste manuelle active. Modifier ces réglages réactive la répartition régionale.',
  'Non-residential sites: mills, workshops, shrines… Inhabited farms are counted above. Placement depends on suitable terrain and resources.': 'Sites sans résidents : moulins, ateliers, sanctuaires… Les fermes habitées sont comptées au-dessus. L’implantation dépend des terrains et ressources disponibles.',
  'Placed: {places} settlements · {population} inhabitants · {isolated} isolated sites': 'Implantés : {places} lieux · {population} habitants · {isolated} sites isolés',
  'Automatic limits for this map: {villages} villages, {hamlets} hamlets, {farms} inhabited farms, {isolated} isolated sites. More inhabitants enlarge towns and cities. Exact counts override these limits.': 'Plafonds automatiques de cette carte : {villages} villages, {hamlets} hameaux, {farms} fermes habitées, {isolated} sites isolés. Davantage d’habitants agrandissent les bourgs et les villes. Des effectifs imposés remplacent ces plafonds.',
}).map(([en,fr]) => [en,{en,fr}])));
// The button reads "None"; its own key keeps the French form for places.
registerMessages({ 'No settlements': { en: 'None', fr: 'Aucun' } });

export function mountSettlementPopulationPanel(host: HTMLElement, api: { getSettings(): V2Settings; getWorld(): World | undefined; changed(): void; syncForms(): void }) {
  const root = document.createElement('section'); root.className = 'regional-population'; host.append(root);
  const controls: { key: keyof RegionalDemography | PopulationClass; input: HTMLInputElement; reset: HTMLButtonElement; row: HTMLElement; count: boolean }[] = [];
  const hint = document.createElement('p'); hint.className = 'hint'; setText(hint, 'The places make the population: adding or removing a place changes it. Changing population or density resizes the places without changing their number. Editing a count fixes only that class; ↶ restores its automatic count. Even harsh regions keep a few places.');
  function update(key: string, value: number | undefined, count: boolean): void {
    editRegionalPopulation(api.getSettings(), key as RegionalPopulationField, value);
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
    }; input.oninput = () => {
      input.setCustomValidity('');
      if ((key === 'population' || key === 'density') && input.value !== '' && input.validity.valid) update(key,Number(input.value),false);
    };
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
  // Whole-list shortcuts: no settlement at all, or the automatic list (map size, biome, culture, floor).
  const listActions = document.createElement('div'); listActions.className = 'regional-list-actions';
  const listAction = (label: string, title: string, apply: (s: V2Settings) => void) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet small'; setText(button,label);
    button.setAttribute('data-i18n-title',title); button.title = translate(title);
    button.onclick = () => { apply(api.getSettings()); api.changed(); api.syncForms(); sync(); };
    listActions.append(button); return button;
  };
  const clearAll = listAction('No settlements','Remove every settlement: all place counts and the region population become 0.',clearRegionalPopulation);
  clearAll.dataset.regionalList = 'none';
  const resetAll = listAction('Follow the environment','Clear the chosen counts, population and density: the places follow the map size, biome and culture again.',followEnvironmentPopulation);
  resetAll.dataset.regionalList = 'environment';
  const help = document.createElement('details'); help.className = 'regional-population-help';
  const limitsHint = document.createElement('p'); limitsHint.className = 'hint';
  const helpTitle = document.createElement('summary'); setText(helpTitle,'Automatic from the region'); help.append(helpTitle,hint,isolatedHint,limitsHint);
  root.append(summary,placed,listActions,help);
  function sync(): void {
    const s = api.getSettings(), plan = regionalPopulation(s), d = s.region?.demography ?? {};
    const limits = automaticSettlementLimits(plan.areaKm2, plan.population);
    limitsHint.textContent = translate('Automatic limits for this map: {villages} villages, {hamlets} hamlets, {farms} inhabited farms, {isolated} isolated sites. More inhabitants enlarge towns and cities. Exact counts override these limits.')
      .replace('{villages}',String(limits.village)).replace('{hamlets}',String(limits.hamlet)).replace('{farms}',String(limits.farmstead)).replace('{isolated}',String(automaticIsolatedLimit(plan.areaKm2)));
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
