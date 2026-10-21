import type { BenchOptions } from '../gen/urban/testbench';
import { defaultProgrammeContext, type ProgrammeContext } from '../../../rust/bridge/urbanConfig';

/** Applied inputs for the existing workshop, not a separate generator. */
export interface UrbanReferenceCase {
  id: string;
  label: string;
  population: number;
  composition?: 'settlement' | 'district';
  quarterSeed: string;
  parcelSeed: string;
  buildingSeed: string;
  options: BenchOptions;
  programme: ProgrammeContext;
}

export const URBAN_REFERENCE_CASES_VERSION = 1;

function reference(
  id: string, label: string, population: number, culture: string,
  changes: Partial<BenchOptions> = {}, programme: Partial<ProgrammeContext> = {},
): UrbanReferenceCase {
  const seed = id === 'regular-town-2500' || id === 'rural-fantasy-200'
    ? 'urban-refonte-v1' : `urban-reference-v1/${id}`;
  return {
    id, label, population, quarterSeed: seed, parcelSeed: seed, buildingSeed: seed,
    options: {
      mode: 'quarters', culture, recipe: 'core', zone: 'core', density: 1,
      count: 4, radius: 220, rings: 1, placement: 'center', monument: 'none',
      relief: 'flat', reliefSlope: 12, river: 'none', riverWidth: 14, stages: {},
      ...changes,
    },
    programme: { ...defaultProgrammeContext(), ...programme },
  };
}

/** Metres and percent grades. Small cases retain the historical 2 km fixture;
 * the explicit complete-city case expands only its synthetic terrain domain.
 * Population must be passed through WorkshopContext, not inferred from radius.
 * The 200/2500 cases are stable measurement inputs, not timing assertions. */
export const cases: readonly UrbanReferenceCase[] = [
  reference('regular-town-2500', 'Ville régulière · 2 500 hab.', 2500, 'bastide',
    { count: 6, radius: 330, placement: 'rectangle' }, { role: 'crossroads' }),
  reference('organic-suburb', 'Faubourg organique · 1 200 hab.', 1200, 'european-organic',
    { count: 5, radius: 270, rings: 2, recipe: 'faubourg', zone: 'faubourg' }, { role: 'artisan', resources: ['timber', 'clay'] }),
  reference('courtyard', 'Cours et passages · 1 000 hab.', 1000, 'medina',
    { radius: 240 }, { role: 'crossroads' }),
  reference('compound', 'Enclos et domaines · 600 hab.', 600, 'sahel',
    { radius: 210 }, { role: 'agricultural', resources: ['grain'] }),
  reference('riverbank', 'Rive habitée · 500 hab.', 500, 'stilt-town',
    { radius: 220, river: 'vertical', riverWidth: 28 }, { role: 'riverine', mode: 'fantasy' }),
  reference('slope', 'Quartier en pente · 900 hab.', 900, 'newar',
    { radius: 240, relief: 'hill', reliefSlope: 22 }, { role: 'artisan', resources: ['stone'] }),
  reference('rural-fantasy-200', 'Village fantasy · 200 hab.', 200, 'halfling',
    { count: 3, radius: 120, recipe: 'village', zone: 'village', relief: 'hill', reliefSlope: 8 },
    { role: 'agricultural', mode: 'fantasy', resources: ['grain'] }),
  { ...reference('metropolis-50000', 'Ville complète · 50 000 hab.', 50000, 'european-organic', { radius: 160, count: 12 }, { role: 'crossroads' }), composition: 'settlement' },
];

/** Loading is explicit and receives a fresh copy: editing a case cannot mutate
 * the versioned definitions or another scene. The caller owns generation. */
export function installUrbanReferenceCases(
  host: Element, onSelect: (entry: UrbanReferenceCase) => void | Promise<void>,
) {
  const element = document.createElement('div'); element.className = 'control-group';
  element.setAttribute('data-urban-reference-cases', String(URBAN_REFERENCE_CASES_VERSION));
  const label = document.createElement('label'); label.append('Cas de référence ');
  const select = document.createElement('select'); select.setAttribute('data-urban-reference', '');
  for (const entry of cases) select.add(new Option(entry.label, entry.id));
  label.append(select);
  const load = document.createElement('button'); load.type = 'button'; load.textContent = 'Charger'; load.setAttribute('data-urban-reference-load', '');
  const status = document.createElement('small'); status.setAttribute('role', 'status'); status.hidden = true;
  element.append(label, load, status); host.append(element);
  load.onclick = async () => {
    const entry = cases.find(entry => entry.id === select.value);
    if (!entry || load.disabled) return;
    load.disabled = true; select.disabled = true; status.hidden = true;
    try { await onSelect(structuredClone(entry)); }
    catch (error) { status.textContent = String(error); status.hidden = false; }
    finally { load.disabled = false; select.disabled = false; }
  };
  return { element, select, load };
}
