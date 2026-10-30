import { defaultLayoutConfig, defaultParcelConfig, type LayoutConfig, type ParcelConfig } from '../../../rust/bridge/urbanConfig';
import { openMethodNote } from './methodNotes';

export const settlementStyles = [
  { id: 'culture', label: 'Selon la culture', description: 'Recettes culturelles, croissance et architecture du lieu.' },
  { id: 'walled-core', label: 'Cité dense avec muraille', description: 'Un seul cœur compact, sans extensions ni satellites, bâti dense et enceinte.' },
  { id: 'dense-core', label: 'Cœur dense ouvert', description: 'Un seul cœur compact et dense, sans enceinte.' },
  { id: 'growing-town', label: 'Ville et extensions', description: 'Un cœur, des quartiers plus récents et une périphérie moins dense.' },
  { id: 'village', label: 'Village ouvert', description: 'Une seule phase villageoise, maisons espacées et jardins, sans enceinte.' },
] as const;
export type SettlementStyleId = typeof settlementStyles[number]['id'];

/** A deliberate replacement of generation overrides, preserving the site's
 * programme, spatial budget and physical constraints. Seeds live outside it. */
export function applySettlementStyle(id: SettlementStyleId, current: LayoutConfig, culture = current.culture) {
  const layout: LayoutConfig = { ...current, preset: 'culture', culture, recipe: 'auto', zone: 'auto', density: 1, params: {},
    scope: 'settlement', placement: 'center', settlementForm: 'auto', suburbs: 'auto', phases: 0,
    fortification: 'culture', tissue: 'culture', mixCulture: '',
    footprint: { ...defaultLayoutConfig().footprint, budget: current.footprint.budget } };
  const parcels: ParcelConfig = { ...defaultParcelConfig(), culture: 'site' };
  if (id === 'walled-core' || id === 'dense-core') {
    Object.assign(layout, { recipe: 'core', zone: 'core', density: 2, suburbs: 'none', phases: 1,
      fortification: id === 'walled-core' ? 'wall' : 'none', accessDepth: 18, accessBudget: 6,
      params: { plotDepth: { core: [14, 24] }, blockSize: { core: [2400, 3600] },
        laneSpacing: [60, 60], gridSpacing: [120, 120], wardArea: 8000, minBlock: 350, minWidth: 12 } });
    Object.assign(layout.footprint, { family: 'compact', nuclei: 1, epochs: 1, grossDensity: 300, cohesion: 1, satellites: 0, branchDepth: 0 });
    Object.assign(parcels, { recipe: 'core', zone: 'core', density: 2, operator: 'strips',
      params: { coverage: { core: [0.92, 0.97] }, frontage: { core: [5, 8] }, plotDepth: { core: [14, 24] } } });
  } else if (id === 'growing-town') {
    Object.assign(layout.footprint, { family: 'compact', nuclei: 1, epochs: 3, cohesion: 0.9, satellites: 0 });
  } else if (id === 'village') {
    Object.assign(layout, { recipe: 'village', zone: 'village', density: 0.8, suburbs: 'none', phases: 1, fortification: 'none' });
    Object.assign(layout.footprint, { family: 'compact', nuclei: 1, epochs: 1, satellites: 0, branchDepth: 0 });
    Object.assign(parcels, { recipe: 'village', zone: 'village', density: 0.8 });
  }
  return { layout, parcels };
}

export function installSettlementStyles(host: Element, onChoose: (id: SettlementStyleId) => void, onGenerate: () => void) {
  const box = document.createElement('div'); box.className = 'settlement-style-controls';
  box.innerHTML = '<label>Style d’agglomération<select data-settlement-style><option value="">Personnalisé / plan conservé</option></select></label><small data-settlement-style-description>Choisir un style réinitialise les surcharges des rues, parcelles et bâtiments.</small><div class="urban-actions"><button type="button" data-settlement-generate>Générer la ville complète</button><button type="button" data-settlement-defaults>Valeurs de la culture</button><button type="button" data-settlement-help title="Styles et propagation des réglages">?</button></div>';
  const select = box.querySelector<HTMLSelectElement>('[data-settlement-style]')!;
  for (const style of settlementStyles) select.add(new Option(style.label, style.id));
  select.onchange = () => {
    const style = settlementStyles.find(style => style.id === select.value); if (!style) return;
    box.querySelector('[data-settlement-style-description]')!.textContent = style.description;
    onChoose(style.id);
  };
  box.querySelector<HTMLButtonElement>('[data-settlement-defaults]')!.onclick = () => { select.value = 'culture'; select.dispatchEvent(new Event('change')); };
  box.querySelector<HTMLButtonElement>('[data-settlement-generate]')!.onclick = onGenerate;
  box.querySelector<HTMLButtonElement>('[data-settlement-help]')!.onclick = () => openMethodNote('urban-settlement-styles');
  host.prepend(box);
  return { element: box, select };
}
