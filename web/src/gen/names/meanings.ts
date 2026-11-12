import type { NameDisplayLanguage, NameMeaning } from './types';

const LANGUAGES: NameDisplayLanguage[] = ['en', 'fr', 'ja', 'ar', 'es', 'pt', 'zh', 'ru'];
/** Authored semantic messages; proper names never go through word replacement. */
const rows: Record<string, string[]> = {
  'old-town': ['Old Town','Vieux quartier','旧市街','البلدة القديمة','Casco antiguo','Cidade velha','老城区','Старый город'],
  'street-main': ['Main Street','Rue Principale','大通り','الشارع الرئيسي','Calle Principal','Rua Principal','主街','Главная улица'],
  'street-market': ['Market Street','Rue du Marché','市場通り','شارع السوق','Calle del Mercado','Rua do Mercado','市场街','Рыночная улица'],
  'street-ring': ['Ring Road','Rue de la Ceinture','環状通り','الطريق الدائري','Calle de Ronda','Rua Circular','环城路','Кольцевая улица'],
  'street-wall': ['Wall Street','Rue des Remparts','城壁通り','شارع الأسوار','Calle de la Muralla','Rua das Muralhas','城墙街','Крепостная улица'],
  'street-quay': ['Harbour Street','Rue du Port','港通り','شارع الميناء','Calle del Puerto','Rua do Porto','港口街','Портовая улица'],
  'street-bridge': ['Bridge Street','Rue du Pont','橋通り','شارع الجسر','Calle del Puente','Rua da Ponte','桥街','Мостовая улица'],
  'street-riverside': ['Riverside Street','Rue de la Rivière','川沿い通り','شارع النهر','Calle del Río','Rua do Rio','河滨街','Набережная улица'],
  'square-market': ['Market Square','Place du Marché','市場広場','ساحة السوق','Plaza del Mercado','Praça do Mercado','市场广场','Рыночная площадь'],
  'square-green': ['Village Green','Place Verte','緑の広場','الساحة الخضراء','Plaza Verde','Praça Verde','绿地广场','Зелёная площадь'],
  north: ['North','le Nord','北','الشمال','Norte','Norte','北','Север'],
  east: ['East',"l’Est",'東','الشرق','Este','Leste','东','Восток'],
  south: ['South','le Sud','南','الجنوب','Sur','Sul','南','Юг'],
  west: ['West',"l’Ouest",'西','الغرب','Oeste','Oeste','西','Запад'],
  tanner: ['Tanners','les Tanneurs','皮なめし職人','الدباغين','Curtidores','Curtidores','制革工','Кожевники'],
  dyer: ['Dyers','les Teinturiers','染物職人','الصباغين','Tintoreros','Tintureiros','染工','Красильщики'],
  smith: ['Blacksmiths','les Forgerons','鍛冶職人','الحدادين','Herreros','Ferreiros','铁匠','Кузнецы'],
  baker: ['Bakers','les Boulangers','パン職人','الخبازين','Panaderos','Padeiros','面包师','Пекари'],
  fisher: ['Fishers','les Pêcheurs','漁師','الصيادين','Pescadores','Pescadores','渔民','Рыбаки'],
  potter: ['Potters','les Potiers','陶工','الفخارين','Alfareros','Oleiros','陶工','Гончары'],
  weaver: ['Weavers','les Tisserands','織物職人','النساجين','Tejedores','Tecelões','织工','Ткачи'],
  mason: ['Masons','les Maçons','石工','البنائين','Albañiles','Pedreiros','石匠','Каменщики'],
  butcher: ['Butchers','les Bouchers','肉屋','الجزارين','Carniceros','Açougueiros','屠夫','Мясники'],
};
export function conceptText(concept: string, language: NameDisplayLanguage): string {
  return rows[concept]?.[LANGUAGES.indexOf(language)] ?? concept;
}
export function descriptiveText(meaning: NameMeaning | undefined, language: NameDisplayLanguage): string | undefined {
  return meaning && (meaning.concept === 'old-town' || meaning.concept.startsWith('street-') || meaning.concept.startsWith('square-'))
    ? conceptText(meaning.concept, language) : undefined;
}

const roleRows: Record<string, string[]> = {
  castle: ['Castle','Château','城','قلعة','Castillo','Castelo','城堡','Замок'],
  gate: ['Gate','Porte','門','بوابة','Puerta','Porta','门','Ворота'],
  fort: ['Fort','Fort','砦','حصن','Fuerte','Forte','堡垒','Форт'],
  river: ['River','Rivière','川','نهر','Río','Rio','河','Река'],
  major: ['River','Fleuve','大河','نهر','Río','Rio','大河','Река'],
  brook: ['Brook','Ruisseau','小川','جدول','Arroyo','Riacho','溪','Ручей'],
  stream: ['Stream','Ruisseau','小川','جدول','Arroyo','Riacho','溪流','Ручей'],
  building: ['Building','Bâtiment','建物','مبنى','Edificio','Edifício','建筑','Здание'],
  house: ['House','Maison','家','منزل','Casa','Casa','住宅','Дом'],
  palace: ['Palace','Palais','宮殿','قصر','Palacio','Palácio','宫殿','Дворец'],
  kasbah: ['Kasbah','Kasbah','カスバ','قصبة','Alcazaba','Casbá','卡斯巴','Касба'],
  keep: ['Keep','Donjon','天守','برج القلعة','Torre del homenaje','Torre de menagem','主堡','Донжон'],
  market: ['Market','Marché','市場','سوق','Mercado','Mercado','市场','Рынок'],
  workshop: ['Workshop','Atelier','工房','ورشة','Taller','Oficina','作坊','Мастерская'],
  inn: ['Inn','Auberge','宿屋','نزل','Posada','Estalagem','旅店','Постоялый двор'],
  warehouse: ['Warehouse','Entrepôt','倉庫','مستودع','Almacén','Armazém','仓库','Склад'],
  hall: ['Hall','Halle','会館','قاعة','Sala','Salão','会堂','Зал'],
  mosque: ['Mosque','Mosquée','モスク','مسجد','Mezquita','Mesquita','清真寺','Мечеть'],
  temple: ['Temple','Temple','寺院','معبد','Templo','Templo','寺庙','Храм'],
  church: ['Church','Église','教会','كنيسة','Iglesia','Igreja','教堂','Церковь'],
  cathedral: ['Cathedral','Cathédrale','大聖堂','كاتدرائية','Catedral','Catedral','大教堂','Собор'],
  monastery: ['Monastery','Monastère','修道院','دير','Monasterio','Mosteiro','修道院','Монастырь'],
  shrine: ['Shrine','Sanctuaire','聖所','مزار','Santuario','Santuário','圣所','Святилище'],
  tower: ['Tower','Tour','塔','برج','Torre','Torre','塔','Башня'],
};
export function roleNoun(role: string): string {
  if(/^water\.(major|river|stream|brook)$/.test(role))return role.slice(6);
  if (/kasbah/.test(role)) return 'kasbah';
  if (/palace|kancha/.test(role)) return 'palace';
  if (/keep/.test(role)) return 'keep';
  if (/castle/.test(role)) return 'castle';
  if (/fort/.test(role)) return 'fort';
  if (/gate/.test(role)) return 'gate';
  if (/tower/.test(role)) return 'tower';
  if (/defence/.test(role)) return 'fort';
  if (/mosque|masjid|madrasa/.test(role)) return 'mosque';
  if (/cathedral/.test(role)) return 'cathedral';
  if (/monastery|abbey/.test(role)) return 'monastery';
  if (/temple|huaca|kiva|hof|ushnu|capitolium/.test(role)) return 'temple';
  if (/church|parish|minster/.test(role)) return 'church';
  if (/worship|shrine/.test(role)) return 'shrine';
  if (/market|bazaar|souk|macellum|tianguis/.test(role)) return 'market';
  if (/inn|caravanserai|funduq|dharamshala/.test(role)) return 'inn';
  if (/storage|warehouse|granary/.test(role)) return 'warehouse';
  if (/craft|workshop/.test(role)) return 'workshop';
  if (/civic/.test(role)) return 'hall';
  if (/dwelling|domestic/.test(role)) return 'house';
  return 'building';
}
export function roleText(role: string, language: NameDisplayLanguage): string | undefined {
  return roleRows[roleNoun(role)]?.[LANGUAGES.indexOf(language)];
}
