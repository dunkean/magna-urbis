import { describe, expect, it } from 'vitest';
import { urbanControlFields, urbanField } from '../../src/v2/urbanControlSchema';
import { localFields } from '../../src/v2/urbanControls';
import { urbanHelp } from '../../src/v2/urbanParameterHelp';

describe('city parameter explanations', () => {
  it('covers every native city field and local inspector scope', () => {
    const fields = urbanControlFields();
    for (const kind of ['quarter', 'block', 'parcel', 'building'] as const) fields.push(...localFields({ kind, key: 'town', id: '0' }));
    for (const field of fields) {
      expect(field.help, field.path).toBeTruthy();
      expect(field.help!.length, field.path).toBeGreaterThan(25);
      expect(field.helpDisplay, field.path).toBe('tooltip');
    }
  });

  it('explains semantic fields behind zone and range paths', () => {
    for (const zone of ['core', 'middle', 'edge', 'faubourg', 'village']) {
      for (const end of [0, 1]) {
        const field = urbanField(`parcels.params.plotDepth.${zone}.${end}`, 10, 'parcels');
        expect(field.help).toBe(urbanHelp('parcels.params.plotDepth'));
        expect(field.help).toContain('metres');
      }
      expect(urbanHelp(`parcels.zoneOperators.${zone}`)).toBe(urbanHelp('parcels.operator'));
    }
  });

  it('distinguishes street directions from footprint angles and house models from planning recipes', () => {
    expect(urbanHelp('layout.params.orientation')).not.toBe(urbanHelp('layout.footprint.orientation'));
    expect(urbanHelp('layout.recipe')).not.toBe(urbanHelp('houses.house_config.recipe'));
    expect(urbanHelp('layout.programme.mode')).not.toBe(urbanHelp('houses.house_config.mode'));
    expect(urbanHelp('layout.phases')).toContain('0');
    expect(urbanHelp('layout.phases')).toContain('not years');
    expect(urbanHelp('layout.phases')).not.toBe(urbanHelp('layout.footprint.epochs'));
  });
});
