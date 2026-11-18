import { describe, expect, it } from 'vitest';
import { compatibleBuildingTypes, forcedUseRefusal, polygonArea, CULTURE_GROUP, OTHER_GROUP, LARGE_NOTE } from '../src/v2/urbanEditOptions';
import '../src/v2/urbanControls';
import { urbanField } from '../src/v2/urbanControlSchema';
import { translate } from '../src/v2/i18n';

const choices = (culture: string, area?: number, architecture = 'silhouette') => compatibleBuildingTypes({ culture, area, architecture });
const find = (culture: string, area: number | undefined, role: string, architecture?: string) => choices(culture, area, architecture).find(choice => choice.value === role);
describe('contextual urban editor choices', () => {
  it('offers every building type: housing and a garden first, then this culture, then the others', () => {
    const list = choices('european-organic', 150);
    expect(list.slice(0, 2).map(choice => choice.value)).toEqual(['dwelling', 'open.garden']);
    expect(new Set(list.map(choice => choice.value)).size).toBe(list.length);
    expect(find('european-organic', 150, 'worship.parish')?.group).toBe(CULTURE_GROUP);
    expect(find('european-organic', 150, 'civic.arena')?.group).toBe(OTHER_GROUP);
    expect(find('elven', 6000, 'civic.arena')?.group).toBe(CULTURE_GROUP);
    const groups = list.slice(2).map(choice => choice.group);
    expect(groups.indexOf(OTHER_GROUP)).toBeGreaterThan(groups.lastIndexOf(CULTURE_GROUP));
  });
  it('marks a type larger than the lot without hiding it, fitting types first', () => {
    expect(find('elven', 500, 'civic.arena')?.note).toBe(LARGE_NOTE);
    expect(find('elven', 6000, 'civic.arena')?.note).toBeUndefined();
    expect(find('european-organic', 6000, 'civic.arena')).toBeDefined();
    expect(find('roman-core', 9000, 'civic.amphitheatre')?.note).toBeUndefined();
    expect(find('wizard-city', 500, 'civic.wizard-tower')?.note).toBeUndefined();
    expect(find('wizard-city', 500, 'civic.wizard-tower', 'detailed')).toBeDefined();
    const own = choices('elven', 500).filter(choice => choice.group === CULTURE_GROUP);
    expect(own.findIndex(choice => choice.note)).toBe(own.length - own.filter(choice => choice.note).length);
    expect(choices('elven').every(choice => !choice.note)).toBe(true);
  });
  it('subtracts reserved holes from the usable area', () => {
    const ring = (size: number) => [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
    ];
    expect(polygonArea({ outer: ring(100), holes: [ring(80)] })).toBe(3600);
  });
  it('words a refused forced use by its cause', () => {
    expect(forcedUseRefusal('forme', 'worship.parish')).toBe('This lot is too small for Parish church. Enlarge it by merging it with a neighbour.');
    expect(translate('This lot is too small for {type}. Enlarge it by merging it with a neighbour.', 'fr')).toContain('fusionnant');
    expect(forcedUseRefusal(undefined, 'worship.parish')).toBeUndefined();
  });
  it('localizes the building and district lists while preserving their stable role identifiers', () => {
    const roles = urbanField('role', '', 'parcel').options!;
    expect(roles.find(choice => choice.value === 'civic.wizard-tower')?.label).toBe('Wizard tower');
    expect(translate('Wizard tower', 'en')).toBe('Wizard tower');
    expect(translate('Wizard tower', 'fr')).toBe('Tour du mage');
    expect(translate('Parish church', 'en')).toBe('Parish church');
    expect(translate('Parish church', 'fr')).toBe('Église paroissiale');
    expect(urbanField('role', '', 'quarter').options!.find(choice => choice.value === 'craft:tanners')?.label).toBe('Tanners district');
  });
});
