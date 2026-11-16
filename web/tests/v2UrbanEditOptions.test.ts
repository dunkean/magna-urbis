import { describe, expect, it } from 'vitest';
import { compatibleBuildingTypes, polygonArea } from '../src/v2/urbanEditOptions';
import { urbanField } from '../src/v2/urbanControlSchema';
import { translate } from '../src/v2/i18n';

const types = (culture: string, area: number, architecture = 'silhouette') => compatibleBuildingTypes({ culture, area, architecture }).map(choice => choice.value);
describe('contextual urban editor choices', () => {
  it('offers an arena only in a culture that declares it and on sufficiently large land', () => {
    expect(types('elven', 500)).not.toContain('civic.arena');
    expect(types('elven', 6000)).toContain('civic.arena');
    expect(types('european-organic', 6000)).not.toContain('civic.arena');
    expect(types('roman-core', 9000)).toContain('civic.amphitheatre');
  });
  it('keeps the native house renderer and excludes types without a native functional source', () => {
    expect(types('elven', 6000, 'detailed')).not.toContain('civic.arena');
    expect(types('wizard-city', 500, 'silhouette')).toContain('civic.wizard-tower');
    expect(types('wizard-city', 500, 'detailed')).not.toContain('civic.wizard-tower');
    expect(types('elven', 50)).toEqual(['dwelling']);
  });
  it('does not fabricate space and subtracts reserved holes from the usable area', () => {
    const ring = (size: number) => [{x:0,y:0},{x:size,y:0},{x:size,y:size},{x:0,y:size}];
    expect(polygonArea({outer:ring(100),holes:[ring(80)]})).toBe(3600);
    expect(compatibleBuildingTypes({culture:'elven'}).map(choice=>choice.value)).toEqual(['dwelling']);
  });
  it('localizes the building and district lists while preserving their stable role identifiers', () => {
    const roles = urbanField('role', '', 'parcel').options!;
    expect(roles.find(choice=>choice.value==='civic.wizard-tower')?.label).toBe('Wizard tower');
    expect(translate('Wizard tower','en')).toBe('Wizard tower');
    expect(translate('Wizard tower','fr')).toBe('Tour du mage');
    expect(translate('Parish church','en')).toBe('Parish church');
    expect(translate('Parish church','fr')).toBe('Église paroissiale');
    expect(urbanField('role','','quarter').options!.find(choice=>choice.value==='craft:tanners')?.label).toBe('Tanners district');
  });
});
