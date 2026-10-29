import { describe,it,expect } from 'vitest';
import { resolveLanguage,translate } from '../src/v2/i18n';
import { interfaceEnglish, interfaceFrench } from '../src/v2/interfaceMessages';
import { CULTURE_LABELS } from '../src/gen/options';

describe('V2 language preference and UI copy',()=>{
  it('uses English by default and accepts only the supported explicit preferences',()=>{
    expect(resolveLanguage('',null)).toBe('en');expect(resolveLanguage('?lang=de','unknown')).toBe('en');
    expect(resolveLanguage('', 'fr')).toBe('fr');expect(resolveLanguage('?lang=en','fr')).toBe('en');expect(resolveLanguage('?lang=fr','en')).toBe('fr');
  });
  it('translates interface and progress copy in both languages without changing contract identifiers',()=>{
    expect(translate('Créer ma région','en')).toBe('Create my region');expect(translate('Créer ma région','fr')).toBe('Créer ma région');
    expect(translate('  Relief et hydrologie réutilisés  ','en')).toBe('  Terrain and hydrology reused  ');
    expect(translate('nativeRequestId','fr')).toBe('nativeRequestId');expect(translate('european-organic','fr')).toBe('european-organic');
  });
  it('covers every existing English culture label in the French UI while preserving original IDs',()=>{
    for(const [id,label]of CULTURE_LABELS){expect(interfaceFrench[label],label).toBeTruthy();expect(translate(label,'en')).toBe(label);expect(translate(id,'fr')).toBe(id);}
  });
  it('names the generated area a region throughout the English and French interface',()=>{
    const labels=[
      ['L’atelier des régions','The region workshop'],
      ['Une région à votre mesure','A region of your own'],
      ['Graine de la région','Region seed'],
      ['Créer ma région','Create my region'],
      ['La région avant les villes','The region before towns'],
      ['Reprendre une région','Return to a region'],
      ['Emporter votre région','Take your region with you'],
      ['La recette de la région','The region recipe'],
    ];
    for(const [fr,en]of labels){expect(translate(fr,'en')).toBe(en);expect(translate(fr,'fr')).toBe(fr);}
    for(const source of Object.keys(interfaceEnglish)){
      expect(translate(source,'en'),source).not.toMatch(/\bworlds?\b/i);
      expect(translate(source,'fr'),source).not.toMatch(/\bmondes?\b/i);
    }
    expect(translate('World','fr')).toBe('World');
    expect(translate('Le monde de Lin','en')).toBe('Le monde de Lin');
  });
});
