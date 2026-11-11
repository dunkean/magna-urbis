import { describe, expect, it } from 'vitest';
import { LANGUAGES, registerMessages, resolveLanguage, translate } from '../../src/v2/i18n';
import { localeMessages } from '../../src/v2/localeMessages';
import { translateRuntimeMessage } from '../../src/v2/runtimeMessages';
import { convertUnits, distanceScale, formatDistance, unitFactor } from '../../src/gen/units';
import { presentMapNames } from '../../src/v2/mapNaming';
import type { World } from '../../src/gen/types';
import { terrainControlMessages } from '../../src/v2/terrainControlSchema';
import { cartoucheModel, compactScaleModel, panelSvg } from '../../src/render/legend';
import { PALETTES } from '../../src/render/styles';

describe('V2 culture, UI language and physical display units', () => {
  it('defaults to English and independently resolves all eight explicit preferences', () => {
    expect(resolveLanguage('', null)).toBe('en');
    expect(LANGUAGES.map(language => language.code)).toEqual(['en','fr','es','pt','zh','ar','ru','ja']);
    for (const { code } of LANGUAGES) {
      expect(resolveLanguage(`?lang=${code}`, 'fr')).toBe(code);
      expect(resolveLanguage('', code)).toBe(code);
    }
  });
  it('translates both source languages and complete runtime templates without changing user values', () => {
    registerMessages({ 'Map title': { en: 'Map title', fr: 'Titre de la carte' } });
    for (const language of ['es','pt','zh','ar','ru','ja'] as const) {
      expect(translate('Map title', language)).toBe(localeMessages[language]['Map title']);
      expect(translate('Titre de la carte', language)).toBe(localeMessages[language]['Map title']);
      const template = localeMessages[language]['Unknown settlement: {id}'];
      expect(translateRuntimeMessage('Lieu inconnu : Maison Érable 42', language)).toBe(template.replace('{id}', 'Maison Érable 42'));
      expect(translate('nativeRequestId', language)).toBe('nativeRequestId');
      expect(translateRuntimeMessage('Unknown scientific diagnostic [42]',language)).toBe('Unknown scientific diagnostic [42]');
    }
    expect(translateRuntimeMessage('Maison ١٢','ar')).toBe(localeMessages.ar['House {index}'].replace('{index}','١٢'));
  });
  it('preserves placeholders consistently across the catalogs', () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) ?? []).sort();
    for (const catalog of Object.values(localeMessages)) for (const [source, translated] of Object.entries(catalog)) {
      expect(placeholders(translated),source).toEqual(placeholders(source));
    }
  });
  it('covers the terrain schema labels, choices and help text in every UI language', () => {
    for (const catalog of Object.values(localeMessages)) for (const { en, fr } of Object.values(terrainControlMessages)) {
      if (en === fr || / · [\d.]+ MB$/.test(en)) continue; // Technical model identifiers and SI byte sizes are invariant.
      expect(catalog[en],en).toBeTruthy();
    }
  });
  it('recomposes only annotated generic terms, keeping cultural names, manual labels and geometry intact', () => {
    const source = { options:{culture:'chinese'}, terrain:{height:new Float32Array([12])}, roads:[], names:{family:'chinese',town:'TsingTao',entries:[
      {id:'gate',kind:'gate',text:'TsingTao Men',anchor:{x:1,y:2},parts:{proper:'TsingTao',cultural:'TsingTao Men',kind:'gate',opaque:false}},
      {id:'manual',kind:'gate',text:'My gate',manual:true,parts:{proper:'Other',cultural:'Other Men',kind:'gate',opaque:false}},
      {id:'opaque',kind:'river',text:'Huang He',parts:{proper:'Huang He',cultural:'Huang He',kind:'river',opaque:true}},
    ]}} as unknown as World;
    const english=presentMapNames(source,'en'), french=presentMapNames(source,'fr');
    expect(english.names!.entries[0].text).toBe('TsingTao Gate');
    expect(french.names!.entries[0].text).toBe('Porte de TsingTao');
    for (const {code} of LANGUAGES) {
      const result=presentMapNames(source,code);
      expect(result.names!.town).toBe('TsingTao');
      expect(result.names!.entries[0].parts).toBe(source.names!.entries[0].parts);
      expect(result.names!.entries[1].text).toBe('My gate');
      expect(result.names!.entries[2].text).toBe('Huang He');
      expect(result.terrain).toBe(source.terrain);expect(result.roads).toBe(source.roads);
    }
    expect(source.names!.entries[0].text).toBe('TsingTao Men');
    expect(presentMapNames(french,'ru','cultural').names!.entries[0].text).toBe('TsingTao Men');
  });
  it('converts metres, areas and kilometres accurately, including reversible imperial input', () => {
    expect(unitFactor('ft')).toBe(.3048); expect(unitFactor('yd')).toBe(.9144);
    expect(convertUnits(1,'mi','m')).toBe(1609.344);
    expect(convertUnits(3,'ft','yd')).toBeCloseTo(1,12);
    expect(convertUnits(1,'m²','ft²')).toBeCloseTo(10.7639104167,9);
    for (const unit of ['ft','yd','mi','ft²','yd²','mi²'] as const) {
      const source=unit.endsWith('²')?'m²':'m';
      expect(convertUnits(convertUnits(1234.567,source,unit),unit,source)).toBeCloseTo(1234.567,9);
    }
    expect(formatDistance(.9144,'yd')).toBe('1 yd');
    expect(formatDistance(1609.344,'ft')).toBe('1 mi');
  });
  it('rounds scale distances in their display units while retaining a physically accurate bar length', () => {
    for (const preference of ['m','ft','yd'] as const) for (const scale of [.001,.01,.1,1,10,100]) {
      const result=distanceScale(scale,120,preference);
      expect(result.metres).toBeCloseTo(result.value*unitFactor(result.unit),10);
      expect(result.metres*scale).toBeLessThanOrEqual(150.000001);
      expect(result.metres*scale).toBeGreaterThan(40);
      expect(preference==='m'?['m','km']:['mi',preference]).toContain(result.unit);
    }
  });
  it('uses the same imperial scale labels in canvas panels and vector exports', () => {
    const world={seed:'units',mapSize:1609.344,options:{workflow:'environment',distanceUnit:'ft'}} as unknown as World;
    const panel=cartoucheModel(world,PALETTES.atlas,.1),svg=panelSvg(panel,0,0,1,'Georgia','cartouche');
    expect(svg).toContain('1 mi');
    expect(svg).toMatch(/\d+ ft/);
    expect(svg).not.toMatch(/\d+ (?:km|m)<\/text>/);
    expect(panelSvg(compactScaleModel(PALETTES.atlas,.1,'yd'),0,0,1,'Georgia','scale')).toMatch(/\d+ yd/);
  });
});
