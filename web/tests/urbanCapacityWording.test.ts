import { expect, it } from 'vitest';
import halfling from './fixtures/parcel-capacity-warning-halfling-v4.json';
import { urbanCapacityWarningText, PARCEL_CAPACITY_SCOPE } from '../src/ui/urbanCapacityWording';
import { programmeBalanceEvidence } from '../src/ui/urbanProgrammeEvidence';
import type { UrbanProgramme } from '../../rust/bridge/urban';

const numbers = (value: string) => value.match(/[0-9]+(?:[,.][0-9]+)?/gu);

it('qualifies the actual halfling100% warning as a parcel estimate while retaining original archived text and all figures', () => {
  const archived = { warnings: [halfling.warning] }, before = JSON.stringify(archived);
  expect(halfling.warning).toContain('100 % des ménages logés');
  const display = urbanCapacityWarningText(archived.warnings[0]);
  expect(display).toContain('Capacité parcellaire estimée après affectation (ancien rapport)');
  expect(display).toContain('100 % du besoin en ménages couvert selon le modèle');
  expect(display).toContain('Capacité habitante non évaluée');
  expect(display).not.toContain('ménages logés');
  expect(numbers(display)).toEqual(numbers(halfling.warning));
  expect(JSON.stringify(archived)).toBe(before);
});

it('qualifies old shortage/probe wording without changing amounts or inventing a new estimate', () => {
  const raw = 'Capacité : rendement du tissu recalé à 81 % de la prévision après mesure des îlots, déficit de 712 ménages : les îlots réels logent moins que la prévision du tissu — 82 % des ménages logés.';
  const display = urbanCapacityWarningText(raw);
  expect(display).toContain('déficit de 712 ménages');
  expect(display).toContain('l’estimation parcellaire sur les îlots réels');
  expect(numbers(display)).toEqual(numbers(raw));
});

it('leaves new native wording, free text, future or incomplete signatures unchanged', () => {
  const values = [
    'Capacité parcellaire estimée après affectation : tissu — 100 % du besoin en ménages couvert selon le modèle. Capacité habitante non évaluée.',
    'Capacité parcellaire prévue (modèle) : tissu — 92 % du besoin en ménages couvert par l’estimation. Capacité habitante non évaluée.',
    'Texte libre : les ménages logés près du marché', 'Capacité : donnée ancienne sans pourcentage',
    'Capacité : tissu — ? % des ménages logés.', 'Future capacity report: 100% housed',
    'Capacité prévue : tissu — 74 % des ménages logeables.',
    'city : Capacité : tissu — 100 % des ménages logés.', // Caller supplies raw stage warning before any city prefix.
  ];
  for (const value of values) expect(urbanCapacityWarningText(value)).toBe(value);
});

it('keeps the existing building-balance evidence unknown for parcel-only or compact-plan scenes', () => {
  const programme = { demands: [{ id: 'housing', function: 'domestic', unit: 'domesticUnits', requested: 100,
    parcelCapacity: 100, builtCapacity: 0, openCapacity: 0, deficit: 100 }], allocations: [], warnings: [halfling.warning] } as unknown as UrbanProgramme;
  const before = JSON.stringify(programme);
  expect(programmeBalanceEvidence()(programme)).toBe('not_calculated');
  urbanCapacityWarningText(programme.warnings[0]);
  expect(programmeBalanceEvidence({ schema_version: '1', generator_version: 'architectural-plans-2', buildings: [], refusals: [], open_spaces: [] })(programme)).toBe('not_calculated');
  expect(PARCEL_CAPACITY_SCOPE).toContain('modèle d’affectation');
  expect(PARCEL_CAPACITY_SCOPE).toContain('ne prouvent pas');
  expect(JSON.stringify(programme)).toBe(before);
});
