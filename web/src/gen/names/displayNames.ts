import type { NameParts, NamePresentation, NameDisplayLanguage } from './types';
import { frenchDe } from './syntax';
import { conceptText, descriptiveText, roleText } from './meanings';
import { latinReading } from './writing';

type FeatureKind = Exclude<NameParts['kind'], 'town' | 'village' | 'farm' | 'building'> | 'farm';
type WorshipKind = Exclude<NonNullable<NameParts['generic']>, 'tower'>;
const TERMS: Record<NameDisplayLanguage, Record<FeatureKind, string>> = {
  fr: { quarter: 'Quartier', street: 'Rue', road: 'Route', square: 'Place', church: 'Sanctuaire', castle: 'Château', gate: 'Porte', river: 'Fleuve', lake: 'Lac', sea: 'Mer', forest: 'Forêt', hill: 'Mont', farm: 'Ferme', bridge: 'Pont', region: 'Région' },
  en: { quarter: 'Quarter', street: 'Street', road: 'Road', square: 'Square', church: 'Sanctuary', castle: 'Castle', gate: 'Gate', river: 'River', lake: 'Lake', sea: 'Sea', forest: 'Forest', hill: 'Hill', farm: 'Farm', bridge: 'Bridge', region: 'Region' },
  ja: { quarter: '地区', street: '通り', road: '街道', square: '広場', church: '聖所', castle: '城', gate: '門', river: '川', lake: '湖', sea: '海', forest: '森', hill: '山', farm: '農場', bridge: '橋', region: '地方' },
  ar: { quarter: 'حي', street: 'شارع', road: 'طريق', square: 'ساحة', church: 'مزار', castle: 'قلعة', gate: 'بوابة', river: 'نهر', lake: 'بحيرة', sea: 'بحر', forest: 'غابة', hill: 'جبل', farm: 'مزرعة', bridge: 'جسر', region: 'منطقة' },
  es: { quarter: 'Barrio', street: 'Calle', road: 'Camino', square: 'Plaza', church: 'Santuario', castle: 'Castillo', gate: 'Puerta', river: 'Río', lake: 'Lago', sea: 'Mar', forest: 'Bosque', hill: 'Monte', farm: 'Granja', bridge: 'Puente', region: 'Región' },
  pt: { quarter: 'Bairro', street: 'Rua', road: 'Estrada', square: 'Praça', church: 'Santuário', castle: 'Castelo', gate: 'Porta', river: 'Rio', lake: 'Lago', sea: 'Mar', forest: 'Floresta', hill: 'Monte', farm: 'Fazenda', bridge: 'Ponte', region: 'Região' },
  zh: { quarter: '区', street: '街', road: '路', square: '广场', church: '圣所', castle: '城堡', gate: '门', river: '河', lake: '湖', sea: '海', forest: '森林', hill: '山', farm: '农场', bridge: '桥', region: '地区' },
  ru: { quarter: 'Квартал', street: 'Улица', road: 'Дорога', square: 'Площадь', church: 'Святилище', castle: 'Замок', gate: 'Ворота', river: 'Река', lake: 'Озеро', sea: 'Море', forest: 'Лес', hill: 'Холм', farm: 'Ферма', bridge: 'Мост', region: 'Область' },
};

const WORSHIP: Record<NameDisplayLanguage, Record<WorshipKind, string>> = {
  fr: { mosque: 'Mosquée', temple: 'Temple', church: 'Église', cathedral: 'Cathédrale', monastery: 'Monastère', shrine: 'Sanctuaire' },
  en: { mosque: 'Mosque', temple: 'Temple', church: 'Church', cathedral: 'Cathedral', monastery: 'Monastery', shrine: 'Shrine' },
  ja: { mosque: 'モスク', temple: '寺院', church: '教会', cathedral: '大聖堂', monastery: '修道院', shrine: '聖所' },
  ar: { mosque: 'مسجد', temple: 'معبد', church: 'كنيسة', cathedral: 'كاتدرائية', monastery: 'دير', shrine: 'مزار' },
  es: { mosque: 'Mezquita', temple: 'Templo', church: 'Iglesia', cathedral: 'Catedral', monastery: 'Monasterio', shrine: 'Santuario' },
  pt: { mosque: 'Mesquita', temple: 'Templo', church: 'Igreja', cathedral: 'Catedral', monastery: 'Mosteiro', shrine: 'Santuário' },
  zh: { mosque: '清真寺', temple: '寺庙', church: '教堂', cathedral: '大教堂', monastery: '修道院', shrine: '圣所' },
  ru: { mosque: 'Мечеть', temple: 'Храм', church: 'Церковь', cathedral: 'Собор', monastery: 'Монастырь', shrine: 'Святилище' },
};

const TOWER: Record<NameDisplayLanguage, string> = { en: 'Tower', fr: 'Tour', es: 'Torre', pt: 'Torre', zh: '塔', ar: 'برج', ru: 'Башня', ja: '塔' };

/** Translate only a typed generic; the proper name and its canonical cultural form are retained. */
export function presentName(parts: NameParts, presentation: NamePresentation = {}): string {
  if (presentation.mode !== 'localized' || parts.opaque || parts.kind === 'town' || parts.kind === 'village') return presentation.script==='latin' ? latinReading(parts.cultural) ?? parts.cultural : parts.cultural;
  const language = presentation.language ?? 'en';
  const description = descriptiveText(parts.meaning, language);
  if (description) return description;
  if (parts.meaning?.viaGate) {
    if (language === 'fr') return `Rue de la Porte ${frenchDe(parts.proper)}`;
    if (language === 'en') return `${parts.proper} Gate Street`;
    const gate = presentName({ ...parts, kind:'gate', meaning:undefined }, presentation);
    return presentName({ ...parts, proper:gate, kind:'street', meaning:undefined }, presentation);
  }
  const term = (parts.role ? roleText(parts.role, language) : undefined) ?? (parts.generic === 'tower' ? TOWER[language] : parts.generic ? WORSHIP[language][parts.generic] : parts.kind === 'building' ? roleText('building', language)! : TERMS[language][parts.kind]);
  const proper = parts.meaning && ['craft', 'direction'].includes(parts.meaning.concept)
    ? conceptText(parts.meaning.qualifier!, language) : presentation.script === 'latin' ? parts.latin ?? latinReading(parts.proper) ?? parts.proper : parts.proper;
  if (!proper) return term;
  if (language === 'ja' || language === 'zh') return proper + term;
  if (language === 'ar') return `${term} \u2068${proper}\u2069`;
  if (language === 'en') return `${proper} ${term}`;
  // Keep the proper name unchanged: inflecting arbitrary cultural names would be unreliable.
  if (language === 'ru') return `${term} «${proper}»`;
  if ((language === 'es' || language === 'pt') && (parts.generic === 'tower' || ['road', 'street', 'castle', 'gate', 'forest', 'farm', 'bridge', 'square', 'quarter', 'church', 'region'].includes(parts.kind))) return `${term} de ${proper}`;
  if (language === 'fr' && (parts.generic === 'tower' || ['road', 'street', 'castle', 'gate', 'forest', 'farm', 'bridge'].includes(parts.kind))) return `${term} ${frenchDe(proper)}`;
  return `${term} ${proper}`;
}
