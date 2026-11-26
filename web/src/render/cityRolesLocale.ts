/** Translations of the city role labels (building roles, district roles, specialities, street roles, functions).
 * English is the source and the default; every table is keyed by the English text. The French building names
 * come from the engine's `services.json` (see `cityRoles.ts`), so the building table carries the other languages only.
 * The locale is the page's `<html lang>` (the V2 and the benches set it); render code never imports the V2 i18n. */
import services from '../../../rust/crates/core/src/urban/services.json';
import { COMMUNITY_LOCALES, communityText, isCommunityLocale } from '../locales';

/** Locales with a column in the tables below, then the community locales read from `src/locales/*.json`. */
export type RoleLocale = 'en' | 'fr' | 'es' | 'pt' | 'zh' | 'ar' | 'ru' | 'ja' | 'de' | 'it' | 'pl' | 'ko';
export const ROLE_LOCALES: readonly RoleLocale[] = ['en', 'fr', 'es', 'pt', 'zh', 'ar', 'ru', 'ja', ...COMMUNITY_LOCALES];
/** Locale of role labels: the page's UI language (`<html lang>`), English by default. */
export function uiRoleLocale(): RoleLocale {
  if (typeof document === 'undefined') return 'en';
  const code = document.documentElement.lang.toLowerCase().slice(0, 2) as RoleLocale;
  return ROLE_LOCALES.includes(code) ? code : 'en';
}

/** [en, fr, es, pt, zh, ar, ru, ja] */
type Row = readonly [string, string, string, string, string, string, string, string];
/** [en, es, pt, zh, ar, ru, ja] (French comes from the engine). */
type RoleRow = readonly [string, string, string, string, string, string, string];
const pick = (row: Row, locale: RoleLocale, table?: string): string =>
  (isCommunityLocale(locale) ? (table && communityText(locale, 'roles', table, row[0])) || row[0] : row[ROLE_LOCALES.indexOf(locale)]) ?? row[0];
const index = (rows: readonly Row[]): Map<string, Row> => new Map(rows.map(r => [r[0], r]));

// ---------------------------------------------------------------- buildings (English → es, pt, zh, ar, ru, ja)
const BUILDINGS: readonly RoleRow[] = [
  ['Academy', 'Academia', 'Academia', '学院', 'أكاديمية', 'Академия', 'アカデミー'],
  ['Activity site', 'Zona de actividad', 'Local de atividade', '作业场所', 'موقع نشاط', 'Рабочая площадка', '作業場'],
  ['Administration building', 'Edificio de administración', 'Edifício administrativo', '行政大楼', 'مبنى الإدارة', 'Здание администрации', '行政庁舎'],
  ['Administration hub', 'Centro administrativo', 'Centro administrativo', '行政中枢', 'مركز الإدارة', 'Административный узел', '行政ハブ'],
  ['Agadir (granary)', 'Agadir (granero fortificado)', 'Agadir (celeiro fortificado)', '阿加迪尔（仓楼）', 'أكادير (مخزن حبوب)', 'Агадир (зернохранилище)', 'アガディール（穀物倉）'],
  ['Airship mooring mast', 'Mástil de amarre de dirigibles', 'Mastro de atracação de dirigíveis', '飞艇系留塔', 'صارية رسو المناطيد', 'Причальная мачта дирижаблей', '飛行船係留塔'],
  ['Alchemist’s laboratory', 'Laboratorio del alquimista', 'Laboratório do alquimista', '炼金术士实验室', 'مختبر الكيميائي', 'Лаборатория алхимика', '錬金術師の工房'],
  ['Amphitheatre', 'Anfiteatro', 'Anfiteatro', '圆形剧场', 'مدرج', 'Амфитеатр', '円形闘技場'],
  ['Arcology', 'Arcología', 'Arcologia', '生态巨构', 'أركولوجي', 'Аркология', 'アーコロジー'],
  ['Arena', 'Arena', 'Arena', '竞技场', 'حلبة', 'Арена', 'アリーナ'],
  ['Arsenal', 'Arsenal', 'Arsenal', '兵工厂', 'ترسانة', 'Арсенал', '兵器廠'],
  ['Atomic power plant', 'Central nuclear', 'Usina nuclear', '核电站', 'محطة طاقة نووية', 'Атомная электростанция', '原子力発電所'],
  ['Bakery', 'Panadería', 'Padaria', '面包房', 'مخبز', 'Пекарня', 'パン屋'],
  ['Ball court', 'Juego de pelota', 'Quadra de jogo de bola', '球场', 'ملعب الكرة', 'Площадка для игры в мяч', '球技場'],
  ['Bank', 'Banco', 'Banco', '银行', 'بنك', 'Банк', '銀行'],
  ['Baptistery', 'Baptisterio', 'Batistério', '洗礼堂', 'معمودية', 'Баптистерий', '洗礼堂'],
  ['Bar', 'Bar', 'Bar', '酒吧', 'بار', 'Бар', 'バー'],
  ['Barracks', 'Cuartel', 'Quartel', '兵营', 'ثكنة', 'Казарма', '兵舎'],
  ['Basilica', 'Basílica', 'Basílica', '巴西利卡', 'بازيليكا', 'Базилика', 'バシリカ'],
  ['Bathhouse', 'Baños públicos', 'Banhos públicos', '浴场', 'حمّام عام', 'Бани', '公衆浴場'],
  ['Batik workshop', 'Taller de batik', 'Oficina de batique', '蜡染作坊', 'ورشة الباتيك', 'Мастерская батика', 'バティック工房'],
  ['Bazaar', 'Bazar', 'Bazar', '巴扎', 'بازار', 'Базар', 'バザール'],
  ['Beer house', 'Cervecería', 'Cervejaria', '啤酒屋', 'بيت البيرة', 'Пивной дом', 'ビール酒場'],
  ['Belfry', 'Campanario', 'Campanário', '钟楼', 'برج الجرس', 'Колокольня', '鐘楼'],
  ['Boat shed', 'Cobertizo de barcas', 'Galpão de barcos', '船棚', 'سقيفة القوارب', 'Лодочный сарай', '船小屋'],
  ['Brewery', 'Fábrica de cerveza', 'Cervejaria', '啤酒厂', 'مصنع جعة', 'Пивоварня', '醸造所'],
  ['Buddhist temple', 'Templo budista', 'Templo budista', '佛寺', 'معبد بوذي', 'Буддийский храм', '仏教寺院'],
  ['Cache or granary on posts', 'Granero o depósito sobre pilotes', 'Celeiro ou depósito sobre estacas', '高脚仓库', 'مخزن مرفوع على أعمدة', 'Амбар на сваях', '高床倉庫'],
  ['Café', 'Café', 'Café', '咖啡馆', 'مقهى', 'Кафе', 'カフェ'],
  ['Calmecac (school)', 'Calmécac (escuela)', 'Calmecac (escola)', '卡尔梅卡克（学校）', 'كالميكاك (مدرسة)', 'Кальмекак (школа)', 'カルメカック（学校）'],
  ['Candi (great temple)', 'Candi (gran templo)', 'Candi (grande templo)', 'Candi（大神庙）', 'كانديّ (معبد كبير)', 'Канди (большой храм)', 'チャンディ（大寺院）'],
  ['Capitolium', 'Capitolio', 'Capitólio', '卡比托利欧神庙', 'معبد الكابيتول', 'Капитолий', 'カピトリウム'],
  ['Caravanserai', 'Caravasar', 'Caravançarai', '商队驿站', 'خان القوافل', 'Караван-сарай', 'キャラバンサライ'],
  ['Carcer (prison)', 'Cárcel (carcer)', 'Prisão (carcer)', '监狱（卡尔策）', 'سجن (كارسر)', 'Карцер (тюрьма)', 'カルケル（牢獄）'],
  ['Castle', 'Castillo', 'Castelo', '城堡', 'قلعة', 'Замок', '城'],
  ['Cathedral', 'Catedral', 'Catedral', '大教堂', 'كاتدرائية', 'Собор', '大聖堂'],
  ['Cemetery', 'Cementerio', 'Cemitério', '墓地', 'مقبرة', 'Кладбище', '墓地'],
  ['Central square', 'Plaza central', 'Praça central', '中心广场', 'الساحة المركزية', 'Центральная площадь', '中央広場'],
  ['Chapel', 'Capilla', 'Capela', '小教堂', 'كنيسة صغيرة', 'Часовня', '礼拝堂'],
  ['Chaya (teahouse)', 'Chaya (casa de té)', 'Chaya (casa de chá)', '茶屋', 'تشايا (بيت شاي)', 'Тяя (чайный домик)', '茶屋'],
  ['Church', 'Iglesia', 'Igreja', '教堂', 'كنيسة', 'Церковь', '教会'],
  ['Circus', 'Circo', 'Circo', '竞技场', 'سيرك', 'Цирк', 'キルクス'],
  ['City god temple', 'Templo del dios de la ciudad', 'Templo do deus da cidade', '城隍庙', 'معبد إله المدينة', 'Храм бога города', '城隍廟'],
  ['City hall', 'Ayuntamiento', 'Prefeitura', '市政厅', 'دار البلدية', 'Городская ратуша', '市庁舎'],
  ['City hall square', 'Plaza del ayuntamiento', 'Praça da prefeitura', '市政厅广场', 'ساحة دار البلدية', 'Площадь у ратуши', '市庁舎広場'],
  ['City park', 'Parque urbano', 'Parque urbano', '城市公园', 'حديقة المدينة', 'Городской парк', '都市公園'],
  ['Clan household', 'Casa del clan', 'Casa do clã', '氏族家户', 'بيت العشيرة', 'Родовое хозяйство', '氏族の家'],
  ['Clan meeting house', 'Casa de reunión del clan', 'Casa de reunião do clã', '氏族会堂', 'دار اجتماع العشيرة', 'Родовой дом собраний', '氏族の集会所'],
  ['Clockwork workshop', 'Taller de relojería', 'Oficina de relojoaria', '钟表工坊', 'ورشة ساعات', 'Часовая мастерская', '時計仕掛けの工房'],
  ['Coffee house (qahwa)', 'Cafetería (qahwa)', 'Cafeteria (qahwa)', '咖啡馆（咖瓦）', 'مقهى (قهوة)', 'Кофейня (кахва)', 'コーヒーハウス（カフワ）'],
  ['Collective housing', 'Vivienda colectiva', 'Habitação coletiva', '集体住宅', 'سكن جماعي', 'Многоквартирное жильё', '集合住宅'],
  ['Common', 'Terreno comunal', 'Terreno comunal', '公地', 'أرض مشاعة', 'Общинная земля', '共有地'],
  ['Common barn', 'Granero comunal', 'Celeiro comunal', '公共谷仓', 'مخزن مشترك', 'Общинный амбар', '共同納屋'],
  ['Common hall', 'Sala común', 'Salão comum', '公共大厅', 'قاعة عامة', 'Общий зал', '共同ホール'],
  ['Confucian temple', 'Templo confuciano', 'Templo confucionista', '孔庙', 'معبد كونفوشيوس', 'Храм Конфуция', '孔子廟'],
  ['Council house', 'Casa del consejo', 'Casa do conselho', '议事厅', 'دار المجلس', 'Дом совета', '評議所'],
  ['Courthouse', 'Palacio de justicia', 'Tribunal', '法院', 'دار القضاء', 'Здание суда', '裁判所'],
  ['Courtyard house', 'Casa con patio', 'Casa com pátio', '庭院住宅', 'بيت بفناء', 'Дом с внутренним двором', '中庭式住宅'],
  ['Courtyard house (dar)', 'Casa con patio (dar)', 'Casa com pátio (dar)', '庭院住宅（达尔）', 'دار بفناء', 'Дом с двором (дар)', '中庭式住宅（ダール）'],
  ['Customs house', 'Aduana', 'Alfândega', '海关', 'دار الجمارك', 'Таможня', '税関'],
  ['Dar al-ʿilm (library)', 'Dar al-ʿilm (biblioteca)', 'Dar al-ʿilm (biblioteca)', '知识之家（图书馆）', 'دار العلم (مكتبة)', 'Дар аль-ильм (библиотека)', 'ダール・アル＝イルム（図書館）'],
  ['Department store', 'Grandes almacenes', 'Loja de departamentos', '百货商店', 'متجر كبير', 'Универмаг', '百貨店'],
  ['Dharamshala (pilgrims’ rest house)', 'Dharamshala (albergue de peregrinos)', 'Dharamshala (pouso de peregrinos)', '达摩萨拉（朝圣者客舍）', 'دارامشالا (استراحة الحجاج)', 'Дхарамшала (приют для паломников)', 'ダルムシャーラー（巡礼者宿）'],
  ['District office', 'Oficina del distrito', 'Escritório do distrito', '街区办事处', 'مكتب الحي', 'Районная управа', '地区事務所'],
  ['Domus', 'Domus', 'Domus', '多慕斯（罗马住宅）', 'دوموس', 'Домус', 'ドムス'],
  ['Drum tower', 'Torre del tambor', 'Torre do tambor', '鼓楼', 'برج الطبل', 'Барабанная башня', '鼓楼'],
  ['Drying rack and workshop', 'Secadero y taller', 'Secadouro e oficina', '晾架与作坊', 'رف تجفيف وورشة', 'Сушильная рама и мастерская', '干し場と工房'],
  ['Dwelling', 'Vivienda', 'Moradia', '住宅', 'مسكن', 'Жилище', '住居'],
  ['Dye works', 'Tintorería', 'Tinturaria', '染坊', 'مصبغة', 'Красильня', '染物工房'],
  ['Emporium (harbour market)', 'Emporio (mercado del puerto)', 'Empório (mercado do porto)', '港口商埠', 'سوق الميناء (إمبوريوم)', 'Эмпорий (портовый рынок)', 'エンポリウム（港の市場）'],
  ['Exchange grounds', 'Terreno de intercambio', 'Terreno de troca', '交易场', 'ساحة التبادل', 'Меновая площадка', '交換場'],
  ['Fabrication workshop', 'Taller de fabricación', 'Oficina de fabricação', '制造工坊', 'ورشة تصنيع', 'Производственная мастерская', '製造工房'],
  ['Factory', 'Fábrica', 'Fábrica', '工厂', 'مصنع', 'Фабрика', '工場'],
  ['Fallow land', 'Barbecho', 'Terreno em pousio', '休耕地', 'أرض بور', 'Залежь', '休耕地'],
  ['Family camp', 'Campamento familiar', 'Acampamento familiar', '家族营地', 'مخيّم عائلي', 'Семейный стан', '家族の野営地'],
  ['Family compound', 'Recinto familiar', 'Complexo familiar', '家族院落', 'مجمّع عائلي', 'Семейная усадьба', '一族の屋敷'],
  ['Family house', 'Casa familiar', 'Casa familiar', '家宅', 'بيت عائلي', 'Семейный дом', '家族の家'],
  ['Farm', 'Granja', 'Fazenda', '农场', 'مزرعة', 'Ферма', '農場'],
  ['Fire station', 'Parque de bomberos', 'Quartel de bombeiros', '消防站', 'محطة إطفاء', 'Пожарное депо', '消防署'],
  ['Fish market', 'Mercado de pescado', 'Mercado de peixe', '鱼市', 'سوق السمك', 'Рыбный рынок', '魚市場'],
  ['Fort', 'Fuerte', 'Forte', '要塞', 'حصن', 'Форт', '砦'],
  ['Fortification', 'Fortificación', 'Fortificação', '防御工事', 'تحصين', 'Укрепление', '防御施設'],
  ['Fortress', 'Fortaleza', 'Fortaleza', '堡垒', 'قلعة حصينة', 'Крепость', '要塞'],
  ['Forum', 'Foro', 'Fórum', '罗马广场', 'الساحة العامة (فوروم)', 'Форум', 'フォルム'],
  ['Friday mosque', 'Mezquita del viernes', 'Mesquita de sexta-feira', '主麻清真寺', 'جامع الجمعة', 'Пятничная мечеть', '金曜モスク'],
  ['Fullery', 'Batán', 'Pisão', '缩绒坊', 'مدقّ الأقمشة', 'Сукновальня', '縮絨工房'],
  ['Funduq', 'Alhóndiga (funduq)', 'Fundaco (funduq)', '芬杜格客栈', 'فندق', 'Фундук', 'フンドゥク'],
  ['Funerary monument', 'Monumento funerario', 'Monumento funerário', '陵墓纪念碑', 'نصب جنائزي', 'Погребальный памятник', '墓碑建築'],
  ['Garden', 'Jardín', 'Jardim', '花园', 'حديقة', 'Сад', '庭園'],
  ['Gate', 'Puerta', 'Porta', '城门', 'بوابة', 'Ворота', '門'],
  ['Gate market', 'Mercado de la puerta', 'Mercado da porta', '城门集市', 'سوق البوابة', 'Рынок у ворот', '門前市場'],
  ['Gathering ground', 'Lugar de reunión', 'Local de reunião', '集会场', 'ساحة التجمع', 'Место собраний', '集会場'],
  ['Ghats (river steps)', 'Ghats (escalinatas del río)', 'Ghats (escadarias do rio)', '河坛（河边台阶）', 'غات (درجات النهر)', 'Гхаты (речные ступени)', 'ガート（川の階段）'],
  ['Giants’ hall', 'Sala de los gigantes', 'Salão dos gigantes', '巨人大厅', 'قاعة العمالقة', 'Зал великанов', '巨人の広間'],
  ['Grain elevator', 'Silo de grano', 'Silo de grãos', '粮仓塔', 'صومعة حبوب', 'Зерновой элеватор', '穀物エレベーター'],
  ['Granary', 'Granero', 'Celeiro', '粮仓', 'مخزن حبوب', 'Зернохранилище', '穀倉'],
  ['Great forge', 'Gran forja', 'Grande forja', '大锻炉', 'المصهر العظيم', 'Великая кузница', '大鍛冶場'],
  ['Great gopuram temple', 'Gran templo con gopuram', 'Grande templo com gopuram', '高塔门大神庙', 'معبد غوبورام الكبير', 'Большой храм с гопурамом', 'ゴープラムの大寺院'],
  ['Great temple', 'Gran templo', 'Grande templo', '大神庙', 'المعبد الكبير', 'Великий храм', '大神殿'],
  ['Growth chamber', 'Cámara de crecimiento', 'Câmara de crescimento', '生长室', 'غرفة النمو', 'Камера роста', '生育室'],
  ['Guild house', 'Casa gremial', 'Casa da guilda', '行会会所', 'دار النقابة', 'Дом гильдии', 'ギルドハウス'],
  ['Guildhall', 'Casa del gremio', 'Salão da guilda', '行会大厅', 'قاعة النقابات', 'Гильдейский зал', 'ギルドホール'],
  ['Habitat dome', 'Cúpula habitable', 'Cúpula habitável', '居住穹顶', 'قبة سكنية', 'Жилой купол', '居住ドーム'],
  ['Hammam', 'Hamam', 'Hamam', '哈马姆浴场', 'حمّام', 'Хаммам', 'ハンマーム'],
  ['Harbour master and customs', 'Capitanía y aduana del puerto', 'Capitania e alfândega do porto', '港务长与海关', 'سلطة الميناء والجمارك', 'Портовая администрация и таможня', '港湾長と税関'],
  ['Harbour warehouse', 'Almacén del puerto', 'Armazém do porto', '港口仓库', 'مستودع الميناء', 'Портовый склад', '港の倉庫'],
  ['Haveli', 'Haveli', 'Haveli', '哈维利宅邸', 'هافيلي', 'Хавели', 'ハヴェリ'],
  ['Hippodrome', 'Hipódromo', 'Hipódromo', '赛马场', 'حلبة سباق الخيل', 'Ипподром', 'ヒッポドローム'],
  ['Hive', 'Colmena', 'Colmeia', '蜂巢', 'خلية', 'Улей', 'ハイヴ'],
  ['Hof (temple hall)', 'Hof (sala del templo)', 'Hof (salão do templo)', '霍夫（神殿厅）', 'هوف (قاعة المعبد)', 'Хоф (храмовый зал)', 'ホフ（神殿の広間）'],
  ['Horreum (storehouse)', 'Horreum (almacén)', 'Horreum (armazém)', '霍雷乌姆（仓库）', 'هوريوم (مخزن)', 'Хоррей (склад)', 'ホレウム（倉庫）'],
  ['Hospital', 'Hospital', 'Hospital', '医院', 'مستشفى', 'Больница', '病院'],
  ['Hotel', 'Hotel', 'Hotel', '酒店', 'فندق', 'Гостиница', 'ホテル'],
  ['House', 'Casa', 'Casa', '住宅', 'بيت', 'Дом', '家'],
  ['Housing slab', 'Bloque de viviendas', 'Bloco de apartamentos', '板式住宅楼', 'كتلة سكنية', 'Жилая секция-плита', '板状住棟'],
  ['Huaca (sacred place)', 'Huaca (lugar sagrado)', 'Huaca (lugar sagrado)', '瓦卡（圣地）', 'واكا (مكان مقدس)', 'Уака (священное место)', 'ワカ（聖地）'],
  ['Inn', 'Posada', 'Pousada', '客栈', 'نزل', 'Постоялый двор', '宿屋'],
  ['Insula', 'Ínsula', 'Ínsula', '因苏拉（罗马公寓）', 'إنسولا', 'Инсула', 'インスラ'],
  ['Jantar Mantar (observatory)', 'Jantar Mantar (observatorio)', 'Jantar Mantar (observatório)', '简塔曼塔天文台', 'جانتار مانتار (مرصد)', 'Джантар-Мантар (обсерватория)', 'ジャンタル・マンタル（天文台）'],
  ['Kabuki theatre', 'Teatro kabuki', 'Teatro kabuki', '歌舞伎剧场', 'مسرح كابوكي', 'Театр кабуки', '歌舞伎座'],
  ['Kallanka (great hall)', 'Kallanka (gran sala)', 'Kallanka (grande salão)', '卡兰卡（大厅）', 'كالانكا (قاعة كبرى)', 'Каланка (большой зал)', 'カリャンカ（大広間）'],
  ['Kasbah', 'Kasbah', 'Kasbah', '卡斯巴', 'قصبة', 'Касба', 'カスバ'],
  ['Keep', 'Torre del homenaje', 'Torre de menagem', '主堡', 'البرج الرئيسي', 'Донжон', 'キープ（主塔）'],
  ['Khan’s tent', 'Tienda del kan', 'Tenda do cã', '可汗大帐', 'خيمة الخان', 'Шатёр хана', 'ハーンの天幕'],
  ['Kiva', 'Kiva', 'Kiva', '基瓦', 'كيفا', 'Кива', 'キヴァ'],
  ['Kraal', 'Kraal', 'Kraal', '克拉尔（畜栏）', 'كرال', 'Краль', 'クラール'],
  ['Kraton (palace)', 'Kraton (palacio)', 'Kraton (palácio)', '克拉顿（王宫）', 'كراتون (قصر)', 'Кратон (дворец)', 'クラトン（王宮）'],
  ['Kura (storehouse)', 'Kura (almacén)', 'Kura (armazém)', '藏（土仓）', 'كورا (مخزن)', 'Кура (кладовая)', '蔵'],
  ['Legendary necropolis', 'Necrópolis legendaria', 'Necrópole lendária', '传奇大墓地', 'نكروبوليس أسطوري', 'Легендарный некрополь', '伝説の墓所'],
  ['Legendary palace', 'Palacio legendario', 'Palácio lendário', '传奇宫殿', 'قصر أسطوري', 'Легендарный дворец', '伝説の宮殿'],
  ['Legendary site', 'Lugar legendario', 'Local lendário', '传奇遗址', 'موقع أسطوري', 'Легендарное место', '伝説の地'],
  ['Legendary temple', 'Templo legendario', 'Templo lendário', '传奇神庙', 'معبد أسطوري', 'Легендарный храм', '伝説の神殿'],
  ['Library', 'Biblioteca', 'Biblioteca', '图书馆', 'مكتبة', 'Библиотека', '図書館'],
  ['Lighthouse', 'Faro', 'Farol', '灯塔', 'منارة', 'Маяк', '灯台'],
  ['Livestock pen', 'Corral', 'Curral', '牲畜圈', 'حظيرة ماشية', 'Загон для скота', '家畜囲い'],
  ['Long hall', 'Salón largo', 'Salão comprido', '长厅', 'القاعة الطويلة', 'Длинный зал', 'ロングホール'],
  ['Longhouse', 'Casa larga', 'Casa comprida', '长屋', 'البيت الطويل', 'Длинный дом', 'ロングハウス'],
  ['Lumbung (granary)', 'Lumbung (granero)', 'Lumbung (celeiro)', '伦蓬（谷仓）', 'لومبونغ (مخزن حبوب)', 'Лумбунг (амбар)', 'ルンブン（米蔵）'],
  ['Macellum (covered market)', 'Macellum (mercado cubierto)', 'Macellum (mercado coberto)', '马塞卢姆（有顶市场）', 'ماكيلوم (سوق مغطى)', 'Макеллум (крытый рынок)', 'マケルム（屋根付き市場）'],
  ['Machiya', 'Machiya', 'Machiya', '町屋', 'ماتشيا', 'Матия', '町家'],
  ['Machiya shop', 'Tienda machiya', 'Loja machiya', '町屋商铺', 'متجر ماتشيا', 'Лавка-матия', '町家の店'],
  ['Madrasa', 'Madrasa', 'Madrasa', '马德拉萨', 'مدرسة', 'Медресе', 'マドラサ'],
  ['Maidan', 'Maidán', 'Maidan', '迈丹广场', 'ميدان', 'Майдан', 'マイダン'],
  ['Manor', 'Casa solariega', 'Solar', '庄园宅邸', 'قصر ريفي', 'Усадьба', '荘園館'],
  ['Mansion', 'Mansión', 'Mansão', '府邸', 'قصر', 'Особняк', '邸宅'],
  ['Maristan (hospital)', 'Maristán (hospital)', 'Maristão (hospital)', '马里斯坦（医院）', 'بيمارستان (مستشفى)', 'Маристан (больница)', 'マリスタン（病院）'],
  ['Market hall', 'Mercado cubierto', 'Mercado coberto', '市场大厅', 'سوق مغطى', 'Крытый рынок', '市場ホール'],
  ['Market square', 'Plaza del mercado', 'Praça do mercado', '集市广场', 'ساحة السوق', 'Рыночная площадь', '市場広場'],
  ['Mausoleum', 'Mausoleo', 'Mausoléu', '陵墓', 'ضريح', 'Мавзолей', '霊廟'],
  ['Mead hall', 'Salón de hidromiel', 'Salão de hidromel', '蜜酒厅', 'قاعة العسل', 'Медовый зал', '蜜酒の広間'],
  ['Megastructure', 'Megaestructura', 'Megaestrutura', '巨型结构', 'هيكل ضخم', 'Мегаструктура', 'メガストラクチャー'],
  ['Merchant warehouse', 'Almacén de mercaderes', 'Armazém de mercadores', '商人仓库', 'مستودع التجار', 'Купеческий склад', '商人の倉庫'],
  ['Merchants’ exchange', 'Lonja de mercaderes', 'Bolsa de mercadores', '商人交易所', 'بورصة التجار', 'Купеческая биржа', '商人取引所'],
  ['Monastery', 'Monasterio', 'Mosteiro', '修道院', 'دير', 'Монастырь', '修道院'],
  ['Monument', 'Monumento', 'Monumento', '纪念碑', 'نصب تذكاري', 'Памятник', '記念碑'],
  ['Monumental arch', 'Arco monumental', 'Arco monumental', '纪念拱门', 'قوس تذكاري', 'Монументальная арка', '記念門'],
  ['Moot tree', 'Árbol del consejo', 'Árvore do conselho', '议事树', 'شجرة المجلس', 'Древо совета', '集会の木'],
  ['Mortuary temple', 'Templo funerario', 'Templo funerário', '祭葬神庙', 'معبد جنائزي', 'Погребальный храм', '葬祭殿'],
  ['Mosque', 'Mezquita', 'Mesquita', '清真寺', 'مسجد', 'Мечеть', 'モスク'],
  ['Muslim cemetery', 'Cementerio musulmán', 'Cemitério muçulmano', '穆斯林墓地', 'مقبرة إسلامية', 'Мусульманское кладбище', 'イスラム墓地'],
  ['Necropolis', 'Necrópolis', 'Necrópole', '大墓地', 'مدينة الموتى', 'Некрополь', 'ネクロポリス'],
  ['Neighbourhood dome', 'Cúpula de barrio', 'Cúpula de bairro', '街区穹顶', 'قبة الحي', 'Квартальный купол', '地区ドーム'],
  ['Neighbourhood market', 'Mercado de barrio', 'Mercado de bairro', '街区市场', 'سوق الحي', 'Квартальный рынок', '地区市場'],
  ['Neighbourhood mosque', 'Mezquita de barrio', 'Mesquita de bairro', '街区清真寺', 'مسجد الحي', 'Квартальная мечеть', '地区のモスク'],
  ['Neighbourhood pura', 'Pura de barrio', 'Pura de bairro', '街区神庙（普拉）', 'بورا الحي', 'Квартальная пура', '地区のプラ'],
  ['Neighbourhood shrine', 'Santuario de barrio', 'Santuário de bairro', '街区神龛', 'ضريح الحي', 'Квартальная святыня', '地区の祠'],
  ['Noble residence', 'Residencia noble', 'Residência nobre', '贵族府邸', 'مقر النبلاء', 'Дворянская резиденция', '貴族の邸宅'],
  ['Observatory', 'Observatorio', 'Observatório', '天文台', 'مرصد', 'Обсерватория', '天文台'],
  ['Obsidian workshop', 'Taller de obsidiana', 'Oficina de obsidiana', '黑曜石作坊', 'ورشة السبج', 'Мастерская по обсидиану', '黒曜石工房'],
  ['Office block', 'Edificio de oficinas', 'Edifício de escritórios', '办公楼', 'مبنى مكاتب', 'Офисное здание', 'オフィスビル'],
  ['Open space', 'Espacio abierto', 'Espaço aberto', '开放空间', 'مساحة مفتوحة', 'Открытое пространство', 'オープンスペース'],
  ['Open-air market', 'Mercado al aire libre', 'Mercado ao ar livre', '露天市场', 'سوق مفتوح', 'Открытый рынок', '青空市場'],
  ['Organic spire', 'Aguja orgánica', 'Pináculo orgânico', '有机尖塔', 'برج عضوي مدبب', 'Органический шпиль', '有機的尖塔'],
  ['Pagoda', 'Pagoda', 'Pagode', '宝塔', 'باغودا', 'Пагода', 'パゴダ'],
  ['Paifang (memorial arch)', 'Paifang (arco conmemorativo)', 'Paifang (arco memorial)', '牌坊', 'بايفانغ (قوس تذكاري)', 'Пайфан (мемориальная арка)', '牌坊'],
  ['Palace', 'Palacio', 'Palácio', '宫殿', 'قصر', 'Дворец', '宮殿'],
  ['Palace (kancha)', 'Palacio (kancha)', 'Palácio (kancha)', '宫殿（坎查）', 'قصر (كانشا)', 'Дворец (канча)', '宮殿（カンチャ）'],
  ['Park', 'Parque', 'Parque', '公园', 'منتزه', 'Парк', '公園'],
  ['Park of culture', 'Parque de cultura', 'Parque de cultura', '文化公园', 'حديقة الثقافة', 'Парк культуры', '文化公園'],
  ['Parish church', 'Iglesia parroquial', 'Igreja paroquial', '教区教堂', 'كنيسة الرعية', 'Приходская церковь', '教区教会'],
  ['Pasar (market)', 'Pasar (mercado)', 'Pasar (mercado)', '帕萨尔（集市）', 'باسار (سوق)', 'Пасар (рынок)', 'パサール（市場）'],
  ['Pekarangan (family compound)', 'Pekarangan (recinto familiar)', 'Pekarangan (complexo familiar)', '佩卡兰干（家族院落）', 'بيكارانغان (مجمّع عائلي)', 'Пекаранган (семейная усадьба)', 'ペカランガン（屋敷地）'],
  ['Pendopo (assembly pavilion)', 'Pendopo (pabellón de reuniones)', 'Pendopo (pavilhão de reuniões)', '潘多波（集会亭）', 'بندوبو (جناح اجتماعات)', 'Пендопо (павильон собраний)', 'ペンドポ（集会用の亭）'],
  ['Pesanggrahan (rest house)', 'Pesanggrahan (casa de descanso)', 'Pesanggrahan (casa de repouso)', '佩桑格拉汉（客舍）', 'بيسانغراهان (بيت استراحة)', 'Песангграхан (дом отдыха)', 'ペサングラハン（宿舎）'],
  ['Petirtaan (sacred pool)', 'Petirtaan (estanque sagrado)', 'Petirtaan (piscina sagrada)', '佩蒂尔塔安（圣池）', 'بيتيرتان (بركة مقدسة)', 'Петиртаан (священный водоём)', 'ペティルタアン（聖なる池）'],
  ['Pharos (lighthouse)', 'Pharos (faro)', 'Pharos (farol)', '法罗斯（灯塔）', 'فاروس (منارة)', 'Фарос (маяк)', 'ファロス（灯台）'],
  ['Place of magic', 'Lugar de magia', 'Lugar de magia', '魔法之地', 'مكان سحري', 'Место магии', '魔法の地'],
  ['Place of worship', 'Lugar de culto', 'Local de culto', '礼拜场所', 'دار عبادة', 'Место богослужения', '礼拝所'],
  ['Platform house', 'Casa sobre plataforma', 'Casa sobre plataforma', '台基住宅', 'بيت على منصة', 'Дом на платформе', '基壇上の家'],
  ['Platform mound', 'Túmulo de plataforma', 'Montículo plataforma', '平台土丘', 'تل منصّة', 'Платформенный курган', '基壇墳丘'],
  ['Plaza', 'Plaza', 'Praça', '广场', 'ساحة', 'Площадь', 'プラザ'],
  ['Port warehouse', 'Almacén portuario', 'Armazém portuário', '港口仓库', 'مستودع الميناء', 'Портовый склад', '港湾倉庫'],
  ['Post relay (yi)', 'Posta de relevo (yi)', 'Posto de muda (yi)', '驿站', 'محطة بريد (يي)', 'Почтовая станция (и)', '宿駅（駅）'],
  ['Post relay (örtöö)', 'Posta de relevo (örtöö)', 'Posto de muda (örtöö)', '驿站（乌尔图）', 'محطة بريد (أورتو)', 'Почтовая станция (ортоо)', '駅逓（オルトー）'],
  ['Pottery', 'Alfarería', 'Olaria', '陶坊', 'مشغل فخار', 'Гончарная', '陶器工房'],
  ['Pottery and tile kiln', 'Horno de alfarería y tejería', 'Forno de olaria e telhas', '陶瓦窑', 'فرن فخار وقرميد', 'Гончарная и черепичная печь', '陶器・瓦の窯'],
  ['Power house', 'Central eléctrica', 'Casa de força', '发电所', 'محطة كهرباء', 'Электростанция', '発電所'],
  ['Prison', 'Prisión', 'Prisão', '监狱', 'سجن', 'Тюрьма', '刑務所'],
  ['Public building', 'Edificio público', 'Edifício público', '公共建筑', 'مبنى عام', 'Общественное здание', '公共建築'],
  ['Public library', 'Biblioteca pública', 'Biblioteca pública', '公共图书馆', 'مكتبة عامة', 'Публичная библиотека', '公共図書館'],
  ['Public park', 'Parque público', 'Parque público', '公共公园', 'منتزه عام', 'Общественный парк', '公共公園'],
  ['Pyramid precinct', 'Recinto de la pirámide', 'Recinto da pirâmide', '金字塔圣区', 'حرم الهرم', 'Пирамидальный комплекс', 'ピラミッド聖域'],
  ['Qollqa (state granary)', 'Qollqa (granero estatal)', 'Qollqa (celeiro estatal)', '科尔卡（官仓）', 'قولقا (مخزن حبوب الدولة)', 'Колька (государственный амбар)', 'コルカ（国営倉庫）'],
  ['Qubba (saint’s tomb)', 'Qubba (tumba de santo)', 'Qubba (túmulo de santo)', '库巴（圣徒陵墓）', 'قبة (ضريح ولي)', 'Кубба (гробница святого)', 'クッバ（聖者廟）'],
  ['Railway station', 'Estación de ferrocarril', 'Estação ferroviária', '火车站', 'محطة قطار', 'Железнодорожный вокзал', '鉄道駅'],
  ['Residential tower', 'Torre residencial', 'Torre residencial', '住宅塔楼', 'برج سكني', 'Жилая башня', '住宅タワー'],
  ['River warehouse', 'Almacén fluvial', 'Armazém fluvial', '河边仓库', 'مستودع نهري', 'Речной склад', '川沿いの倉庫'],
  ['Ropewalk', 'Cordelería', 'Cordoaria', '绳索作坊', 'ورشة الحبال', 'Канатный двор', '綱工場'],
  ['Row house', 'Casa adosada', 'Casa em fileira', '排屋', 'بيت متلاصق', 'Дом в ряду застройки', '連棟住宅'],
  ['Ruined church', 'Iglesia en ruinas', 'Igreja em ruínas', '教堂废墟', 'كنيسة مهدّمة', 'Руины церкви', '教会の廃墟'],
  ['Ruined mausoleum', 'Mausoleo en ruinas', 'Mausoléu em ruínas', '陵墓废墟', 'ضريح مهدّم', 'Руины мавзолея', '霊廟の廃墟'],
  ['Ruined mortuary temple', 'Templo funerario en ruinas', 'Templo funerário em ruínas', '祭葬神庙废墟', 'معبد جنائزي مهدّم', 'Руины погребального храма', '葬祭殿の廃墟'],
  ['Ryokan', 'Ryokan', 'Ryokan', '日式旅馆', 'ريوكان', 'Рёкан', '旅館'],
  ['Sacred grove', 'Bosque sagrado', 'Bosque sagrado', '圣林', 'بستان مقدس', 'Священная роща', '聖なる森'],
  ['Sacred precinct', 'Recinto sagrado', 'Recinto sagrado', '神圣区域', 'حرم مقدس', 'Священная территория', '聖域'],
  ['Sacred tank', 'Estanque sagrado', 'Tanque sagrado', '圣池', 'خزّان مقدس', 'Священный водоём', '聖なる池'],
  ['Sake brewery', 'Bodega de sake', 'Fábrica de saquê', '清酒酿造坊', 'مصنع الساكي', 'Сакэваренный завод', '酒蔵'],
  ['Saloon', 'Saloon', 'Saloon', '酒馆', 'صالون (حانة)', 'Салун', 'サルーン'],
  ['Sawmill', 'Aserradero', 'Serraria', '锯木厂', 'منشرة', 'Лесопилка', '製材所'],
  ['School', 'Escuela', 'Escola', '学校', 'مدرسة', 'Школа', '学校'],
  ['Sentō (public bath)', 'Sentō (baño público)', 'Sentō (banho público)', '钱汤（公共浴场）', 'سنتو (حمّام عام)', 'Сэнто (общественная баня)', '銭湯'],
  ['Shinto shrine', 'Santuario sintoísta', 'Santuário xintoísta', '神社', 'ضريح شنتو', 'Синтоистское святилище', '神社'],
  ['Shipyard', 'Astillero', 'Estaleiro', '造船厂', 'حوض بناء السفن', 'Верфь', '造船所'],
  ['Shop', 'Tienda', 'Loja', '商店', 'متجر', 'Лавка', '店'],
  ['Shop building', 'Edificio con tienda', 'Edifício comercial', '商铺楼', 'مبنى متجر', 'Здание с лавкой', '店舗ビル'],
  ['Shop house', 'Casa-tienda', 'Casa-loja', '店铺住宅', 'بيت ومتجر', 'Дом-лавка', '店舗兼住宅'],
  ['Shopping mall', 'Centro comercial', 'Shopping center', '购物中心', 'مركز تسوق', 'Торговый центр', 'ショッピングモール'],
  ['Shrine', 'Santuario', 'Santuário', '神龛', 'ضريح', 'Святыня', '祠'],
  ['Shuyuan (academy)', 'Shuyuan (academia)', 'Shuyuan (academia)', '书院', 'شويوان (أكاديمية)', 'Шуюань (академия)', '書院'],
  ['Siheyuan', 'Siheyuan', 'Siheyuan', '四合院', 'سيخيوان', 'Сихэюань', '四合院'],
  ['Skyscraper', 'Rascacielos', 'Arranha-céu', '摩天大楼', 'ناطحة سحاب', 'Небоскрёб', '超高層ビル'],
  ['Smithy', 'Herrería', 'Ferraria', '铁匠铺', 'مشغل حدادة', 'Кузница', '鍛冶屋'],
  ['Souk', 'Zoco', 'Souk', '苏克（集市）', 'سوق', 'Сук', 'スーク'],
  ['Souk shop', 'Tienda del zoco', 'Loja do souk', '苏克店铺', 'دكان السوق', 'Лавка в суке', 'スークの店'],
  ['Spawning garden', 'Jardín de desove', 'Jardim de desova', '孕育园', 'حديقة التفريخ', 'Сад размножения', '産卵の庭'],
  ['Spore hall', 'Sala de esporas', 'Salão de esporos', '孢子厅', 'قاعة الأبواغ', 'Зал спор', '胞子の広間'],
  ['Square', 'Plaza', 'Praça', '广场', 'ساحة', 'Площадь', '広場'],
  ['Stables', 'Caballerizas', 'Estábulos', '马厩', 'إسطبلات', 'Конюшни', '厩舎'],
  ['Stabulum (stables)', 'Stabulum (caballerizas)', 'Stabulum (estábulos)', '驿厩（斯塔布鲁姆）', 'ستابولوم (إسطبلات)', 'Стабулум (конюшни)', 'スタブルム（厩舎）'],
  ['Stadium', 'Estadio', 'Estádio', '体育场', 'ملعب', 'Стадион', 'スタジアム'],
  ['Stepwell', 'Pozo escalonado', 'Poço escalonado', '阶梯井', 'بئر مدرّج', 'Ступенчатый колодец', '階段井戸'],
  ['Storehouse', 'Almacén', 'Armazém', '仓库', 'مخزن', 'Склад', '倉庫'],
  ['Street bar', 'Bar de calle', 'Bar de rua', '街边酒吧', 'بار الشارع', 'Уличный бар', '路上のバー'],
  ['Street shop', 'Tienda de calle', 'Loja de rua', '街边店铺', 'دكان الشارع', 'Уличная лавка', '路面店'],
  ['Street taberna', 'Taberna de calle', 'Taberna de rua', '街边酒肆', 'حانة الشارع', 'Уличная таберна', '通りのタベルナ'],
  ['Street workshop', 'Taller de calle', 'Oficina de rua', '街边作坊', 'ورشة الشارع', 'Уличная мастерская', '路上の工房'],
  ['Stupa', 'Estupa', 'Estupa', '佛塔', 'ستوبا', 'Ступа', 'ストゥーパ'],
  ['Synagogue', 'Sinagoga', 'Sinagoga', '犹太会堂', 'كنيس', 'Синагога', 'シナゴーグ'],
  ['Taberna', 'Taberna', 'Taberna', '小酒馆', 'تابيرنا', 'Таберна', 'タベルナ'],
  ['Tambo (way station)', 'Tambo (posta del camino)', 'Tambo (posto de caminho)', '坦博（驿站）', 'تامبو (محطة طريق)', 'Тамбо (придорожная станция)', 'タンボ（宿駅）'],
  ['Tannery', 'Curtiduría', 'Curtume', '制革坊', 'مدبغة', 'Кожевня', '皮なめし工房'],
  ['Tavern', 'Taberna', 'Taverna', '酒馆', 'حانة', 'Таверна', '居酒屋'],
  ['Teahouse', 'Casa de té', 'Casa de chá', '茶馆', 'بيت الشاي', 'Чайный дом', '茶屋'],
  ['Television tower', 'Torre de televisión', 'Torre de televisão', '电视塔', 'برج تلفزيون', 'Телебашня', 'テレビ塔'],
  ['Temple', 'Templo', 'Templo', '寺庙', 'معبد', 'Храм', '寺院'],
  ['Temple of the Sun', 'Templo del Sol', 'Templo do Sol', '太阳神庙', 'معبد الشمس', 'Храм Солнца', '太陽の神殿'],
  ['Tenement', 'Edificio de alquiler', 'Cortiço', '出租公寓', 'عمارة سكنية', 'Доходный дом', 'テネメント（集合住宅）'],
  ['Theatre', 'Teatro', 'Teatro', '剧场', 'مسرح', 'Театр', '劇場'],
  ['Thermae', 'Termas', 'Termas', '罗马浴场', 'حمّامات رومانية', 'Термы', '公共大浴場'],
  ['Thermal power plant', 'Central térmica', 'Usina termelétrica', '火力发电厂', 'محطة طاقة حرارية', 'Тепловая электростанция', '火力発電所'],
  ['Thing (assembly ground)', 'Thing (lugar de asamblea)', 'Thing (local de assembleia)', '庭会（集会场）', 'ثينغ (مكان الجمعية)', 'Тинг (место собраний)', 'シング（集会地）'],
  ['Tianguis (market)', 'Tianguis (mercado)', 'Tianguis (mercado)', '蒂安吉斯（集市）', 'تيانغيس (سوق)', 'Тианкис (рынок)', 'ティアンギス（市場）'],
  ['Tide hall', 'Sala de las mareas', 'Salão das marés', '潮汐厅', 'قاعة المد والجزر', 'Зал приливов', '潮の広間'],
  ['Town hall', 'Ayuntamiento', 'Câmara municipal', '市政厅', 'دار البلدية', 'Ратуша', '市庁舎'],
  ['Townhouse', 'Casa urbana', 'Sobrado', '城市住宅', 'بيت حضري', 'Городской дом', 'タウンハウス'],
  ['Trade', 'Comercio', 'Comércio', '商业', 'تجارة', 'Торговля', '商業'],
  ['Transmission tower', 'Torre de transmisión', 'Torre de transmissão', '发射塔', 'برج بث', 'Передающая башня', '送信塔'],
  ['Triumphal arch', 'Arco de triunfo', 'Arco do triunfo', '凯旋门', 'قوس النصر', 'Триумфальная арка', '凱旋門'],
  ['University', 'Universidad', 'Universidade', '大学', 'جامعة', 'Университет', '大学'],
  ['Ushnu (ceremonial platform)', 'Ushnu (plataforma ceremonial)', 'Ushnu (plataforma cerimonial)', '乌什努（仪式平台）', 'أوشنو (منصة احتفالية)', 'Ушну (церемониальная платформа)', 'ウシュヌ（儀礼用の基壇）'],
  ['Vault', 'Cámara acorazada', 'Câmara-forte', '金库', 'قبو محصّن', 'Хранилище', '宝物庫'],
  ['Vertical farm', 'Granja vertical', 'Fazenda vertical', '垂直农场', 'مزرعة عمودية', 'Вертикальная ферма', '垂直農場'],
  ['Villa', 'Villa', 'Vila', '别墅', 'فيلا', 'Вилла', 'ヴィラ'],
  ['War pit', 'Foso de guerra', 'Fosso de guerra', '战坑', 'حفرة الحرب', 'Боевая яма', '戦いの穴'],
  ['Warehouse', 'Almacén', 'Armazém', '仓库', 'مستودع', 'Склад', '倉庫'],
  ['Warung', 'Warung', 'Warung', '瓦龙小吃摊', 'وارونغ', 'Варунг', 'ワルン'],
  ['Watchtower', 'Atalaya', 'Torre de vigia', '瞭望塔', 'برج مراقبة', 'Сторожевая башня', '見張り塔'],
  ['Water mill', 'Molino de agua', 'Moinho de água', '水磨坊', 'طاحونة مائية', 'Водяная мельница', '水車小屋'],
  ['Water tower', 'Torre de agua', 'Torre de água', '水塔', 'برج مياه', 'Водонапорная башня', '給水塔'],
  ['Wayside shrine', 'Humilladero', 'Capela de beira de caminho', '路边神龛', 'ضريح على الطريق', 'Придорожная часовня', '道端の祠'],
  ['Weaving workshop', 'Taller de tejeduría', 'Oficina de tecelagem', '织布坊', 'ورشة نسيج', 'Ткацкая мастерская', '織物工房'],
  ['Web spire', 'Aguja de telaraña', 'Pináculo de teia', '蛛网尖塔', 'برج شبكي', 'Шпиль из паутины', '蜘蛛の巣の尖塔'],
  ['Wizard’s tower', 'Torre del mago', 'Torre do mago', '法师塔', 'برج الساحر', 'Башня мага', '魔法使いの塔'],
  ['Workshop', 'Taller', 'Oficina', '作坊', 'ورشة', 'Мастерская', '工房'],
  ['Workshop and small factory', 'Taller y pequeña fábrica', 'Oficina e pequena fábrica', '作坊和小工厂', 'ورشة ومصنع صغير', 'Мастерская и малая фабрика', '工房と小工場'],
  ['Yamen (magistrate’s seat)', 'Yamen (sede del magistrado)', 'Yamen (sede do magistrado)', '衙门', 'ياميون (مقر القاضي)', 'Ямэнь (резиденция магистрата)', '衙門（地方官の役所）'],
  ['Yashiki (samurai residence)', 'Yashiki (residencia samurái)', 'Yashiki (residência samurai)', '武家宅邸', 'ياشيكي (مقر ساموراي)', 'Яшики (дом самурая)', '屋敷（武家屋敷）'],
  ['Yurt', 'Yurta', 'Iurta', '蒙古包', 'يورت', 'Юрта', 'ゲル'],
  ['Ziggurat', 'Zigurat', 'Zigurate', '金字形神塔', 'زقورة', 'Зиккурат', 'ジッグラト'],
];
const BUILDING_INDEX = new Map(BUILDINGS.map(r => [r[0], r]));
/** English building name in `locale` (French is handled by `cityRoles.ts`); English when untranslated. */
export function translateRole(english: string, locale: RoleLocale): string {
  if (isCommunityLocale(locale)) return communityText(locale, 'roles', 'bld', english) ?? english;
  const i = ROLE_LOCALES.indexOf(locale) - 1; // en = -1, fr = 0 (not in this table), es = 1 …
  if (i < 1) return english;
  return BUILDING_INDEX.get(english)?.[i] ?? english;
}

/** State suffixes appended to a translated role (`.ruin`, `.abandoned`): [es, pt, zh, ar, ru, ja]. */
const STATES: Record<string, readonly [string, string, string, string, string, string]> = {
  '.ruin': [' en ruinas', ' em ruínas', '（废墟）', ' (مهدّم)', ' (руины)', '（廃墟）'],
  '.abandoned': [' (abandonado)', ' (abandonado)', '（已废弃）', ' (مهجور)', ' (заброшено)', '（放棄）'],
};
export function translateState(suffix: string, locale: RoleLocale): string | undefined {
  if (isCommunityLocale(locale)) return communityText(locale, 'roles', 'state', suffix);
  const i = ROLE_LOCALES.indexOf(locale) - 2;
  return i < 0 ? undefined : STATES[suffix]?.[i];
}

// ---------------------------------------------------------------- districts, families, specialities
const DISTRICTS = index([
  ['shanty', 'Habitat informel', 'Vivienda informal', 'Habitação informal', '非正规住区', 'سكن عشوائي', 'Неформальная застройка', '非公式居住区'],
  ['civic', 'Civique', 'Cívico', 'Cívico', '公共', 'مدني', 'Гражданский', '公共'],
  ['market', 'Marché', 'Mercado', 'Mercado', '市场', 'سوق', 'Рынок', '市場'],
  ['religious', 'Religieux', 'Religioso', 'Religioso', '宗教', 'ديني', 'Религиозный', '宗教'],
  ['craft', 'Artisanat', 'Artesanía', 'Artesanato', '手工业', 'حِرَف', 'Ремёсла', '工房'],
  ['port', 'Port', 'Puerto', 'Porto', '港口', 'ميناء', 'Порт', '港'],
  ['elite', 'Notables', 'Notables', 'Notáveis', '显贵', 'الأعيان', 'Знать', '名士'],
  ['commoner', 'Commun', 'Gente común', 'Gente comum', '平民', 'العامة', 'Простолюдины', '庶民'],
  ['poor', 'Pauvre', 'Pobre', 'Pobre', '贫民', 'فقراء', 'Бедняки', '貧民'],
  ['garrison', 'Garnison', 'Guarnición', 'Guarnição', '驻军', 'حامية', 'Гарнизон', '駐屯地'],
  ['gardens', 'Jardins', 'Jardines', 'Jardins', '园林', 'حدائق', 'Сады', '庭園'],
  ['foreign', 'Étrangers', 'Extranjeros', 'Estrangeiros', '外侨', 'الأجانب', 'Иностранцы', '外国人'],
]);
/** English names of the district roles. */
export const DISTRICT_NAMES_EN: Record<string, string> = {
  shanty: 'Informal housing', civic: 'Civic', market: 'Market', religious: 'Religious', craft: 'Crafts', port: 'Port', elite: 'Notables',
  commoner: 'Commoners', poor: 'Poor', garrison: 'Garrison', gardens: 'Gardens', foreign: 'Foreigners',
};
/** Name of a district role id (`craft`, `port`…) in `locale`; undefined for an unknown id. */
export function districtName(id: string, locale: RoleLocale): string | undefined {
  const row = DISTRICTS.get(id); if (!row) return undefined;
  return locale === 'en' ? DISTRICT_NAMES_EN[id] : pick(row, locale, 'districts');
}
const FAMILIES = index([
  ['worship', 'Culte', 'Culto', 'Culto', '礼拜', 'العبادة', 'Культовые здания', '宗教施設'],
  ['commerce', 'Commerce', 'Comercio', 'Comércio', '商业', 'التجارة', 'Торговля', '商業'],
  ['craft', 'Artisanat', 'Artesanía', 'Artesanato', '手工业', 'الحرف', 'Ремёсла', '工房'],
  ['civic', 'Civique', 'Cívico', 'Cívico', '公共', 'مدني', 'Общественные здания', '公共施設'],
  ['defence', 'Défense', 'Defensa', 'Defesa', '防御', 'الدفاع', 'Оборона', '防衛'],
  ['dwelling', 'Habitat', 'Vivienda', 'Habitação', '住宅', 'السكن', 'Жильё', '住居'],
  ['garden', 'Jardin', 'Jardín', 'Jardim', '花园', 'حديقة', 'Сад', '庭園'],
]);
const FAMILY_EN: Record<string, string> = { worship: 'Worship', commerce: 'Trade', craft: 'Crafts', civic: 'Civic', defence: 'Defence', dwelling: 'Housing', garden: 'Garden' };
/** Name of a building family (`worship`, `dwelling`…) in `locale`. */
export function buildingFamilyName(id: string, locale: RoleLocale): string {
  const row = FAMILIES.get(id); if (!row) return id;
  return locale === 'en' ? FAMILY_EN[id] ?? id : pick(row, locale, 'families');
}
const SPECIALITIES = index([
  ['tanners', 'tanneurs', 'curtidores', 'curtidores', '制革匠', 'دباغون', 'кожевники', '皮なめし職人'],
  ['dyers', 'teinturiers', 'tintoreros', 'tintureiros', '染匠', 'صبّاغون', 'красильщики', '染物師'],
  ['smiths', 'forgerons', 'herreros', 'ferreiros', '铁匠', 'حدّادون', 'кузнецы', '鍛冶師'],
  ['potters', 'potiers', 'alfareros', 'oleiros', '陶工', 'خزّافون', 'гончары', '陶工'],
  ['weavers', 'tisserands', 'tejedores', 'tecelões', '织工', 'نسّاجون', 'ткачи', '織工'],
  ['butchers', 'bouchers', 'carniceros', 'açougueiros', '屠户', 'جزّارون', 'мясники', '肉屋'],
  ['masons', 'maçons', 'albañiles', 'pedreiros', '石匠', 'بنّاؤون', 'каменщики', '石工'],
  ['millers', 'meuniers', 'molineros', 'moleiros', '磨坊主', 'طحّانون', 'мельники', '粉屋'],
  ['fishers', 'pêcheurs', 'pescadores', 'pescadores', '渔民', 'صيّادو الأسماك', 'рыбаки', '漁師'],
  ['boatmen', 'bateliers', 'barqueros', 'barqueiros', '船夫', 'ملّاحو القوارب', 'лодочники', '船頭'],
  ['merchants', 'marchands', 'mercaderes', 'mercadores', '商人', 'تجّار', 'купцы', '商人'],
  ['clergy', 'clergé', 'clero', 'clero', '神职人员', 'رجال الدين', 'духовенство', '聖職者'],
  ['knappers', 'tailleurs d’obsidienne', 'talladores de obsidiana', 'lapidadores de obsidiana', '黑曜石工匠', 'نحّاتو السبج', 'обработчики обсидиана', '黒曜石の石器職人'],
  ['fullers', 'foulons', 'bataneros', 'pisoeiros', '缩绒工', 'دقّاقو الأقمشة', 'сукновалы', '縮絨工'],
]);
/** Speciality of a district (`craft:tanners` → `tanners`) in `locale`; the English id with spaces when untranslated. */
export function specialityName(id: string, locale: RoleLocale): string {
  const row = SPECIALITIES.get(id), fallback = id.replace(/[-_]/g, ' ');
  return row && locale !== 'en' ? pick(row, locale, 'specialities') : fallback;
}
/** Generic French district role label → role key, from `services.json`.
 * Named districts and labels in a culture's own language pass through unchanged. */
const FRENCH_DISTRICT_LABELS: Map<string, string> = (() => {
  const data = services as unknown as { districtLabels: Record<string, string>; familyDistrictLabels: Record<string, Record<string, string>> };
  const out = new Map<string, string>();
  for (const [role, label] of Object.entries(data.districtLabels)) out.set(label, role);
  for (const labels of Object.values(data.familyDistrictLabels)) for (const [role, label] of Object.entries(labels)) if (!out.has(label)) out.set(label, role);
  return out;
})();
/** District role (`craft:tanners`, `market`…) behind an engine French label, if known. */
export const districtRoleFromLabel = (label?: string): string | undefined => label ? FRENCH_DISTRICT_LABELS.get(label) : undefined;

// ---------------------------------------------------------------- streets, functions, captions
const STREETS = index([
  ['street', 'rue', 'calle', 'rua', '街道', 'شارع', 'улица', '通り'],
  ['lane', 'ruelle', 'callejón', 'ruela', '巷', 'زقاق', 'переулок', '路地'],
  ['main', 'grand-rue', 'calle mayor', 'rua principal', '主街', 'الشارع الرئيسي', 'главная улица', '大通り'],
  ['regional', 'route régionale', 'carretera regional', 'estrada regional', '区域公路', 'طريق إقليمي', 'региональная дорога', '地域道路'],
  ['market', 'rue du marché', 'calle del mercado', 'rua do mercado', '市场街', 'شارع السوق', 'рыночная улица', '市場通り'],
  ['processional', 'voie processionnelle', 'vía procesional', 'via processional', '仪仗大道', 'طريق الموكب', 'процессионная дорога', '参道'],
  ['ring', 'boulevard de ceinture', 'ronda', 'avenida de contorno', '环城大道', 'الطريق الدائري', 'кольцевой бульвар', '環状道路'],
  ['gate-street', 'rue de la porte', 'calle de la puerta', 'rua da porta', '城门街', 'شارع البوابة', 'улица у ворот', '門前通り'],
  ['quay', 'quai', 'muelle', 'cais', '码头', 'رصيف', 'набережная', '河岸'],
  ['wall-lane', 'chemin de ronde', 'camino de ronda', 'caminho de ronda', '城墙巡道', 'ممر السور', 'путь вдоль стены', '城壁沿いの道'],
  ['collective', 'passage collectif', 'pasaje colectivo', 'passagem coletiva', '共用通道', 'ممر مشترك', 'общий проход', '共用通路'],
  ['private', 'passage privé', 'pasaje privado', 'passagem privada', '私人通道', 'ممر خاص', 'частный проезд', '私道'],
  ['stairs', 'escalier', 'escalera', 'escada', '台阶', 'درج', 'лестница', '階段'],
  ['port-stairs', 'escalier du port', 'escalera del puerto', 'escada do porto', '码头台阶', 'درج الميناء', 'портовая лестница', '港の階段'],
  ['port-street', 'rue du port', 'calle del puerto', 'rua do porto', '港口街', 'شارع الميناء', 'портовая улица', '港通り'],
  ['bridge', 'pont', 'puente', 'ponte', '桥', 'جسر', 'мост', '橋'],
  ['ford', 'gué', 'vado', 'vau', '浅滩', 'مخاضة', 'брод', '浅瀬'],
  ['causeway', 'chaussée', 'calzada', 'calçada', '堤道', 'طريق مرتفع', 'дамба', '土手道'],
]);
const STREET_EN: Record<string, string> = { street: 'street', lane: 'lane', main: 'main street', regional: 'regional road', market: 'market street', processional: 'processional way',
  ring: 'ring boulevard', 'gate-street': 'gate street', quay: 'quay', 'wall-lane': 'wall walk', collective: 'shared passage', private: 'private passage', stairs: 'stairs',
  'port-stairs': 'harbour stairs', 'port-street': 'harbour street', bridge: 'bridge', ford: 'ford', causeway: 'causeway' };
/** Name of a street role of the plan (network.rs) in `locale`; the id with spaces when unknown. */
export function streetName(role: string, locale: RoleLocale): string {
  const row = STREETS.get(role);
  if (!row) return role.replace(/[-_]/g, ' ');
  return locale === 'en' ? STREET_EN[role] : pick(row, locale, 'streets');
}
const FUNCTIONS = index([
  ['domestic', 'habitat', 'vivienda', 'habitação', '住宅', 'سكن', 'жильё', '住居'],
  ['mixed', 'mixte (boutique et habitat)', 'mixto (tienda y vivienda)', 'misto (loja e moradia)', '混合（店铺与住宅）', 'مختلط (متجر وسكن)', 'смешанное (лавка и жильё)', '混合（店舗と住居）'],
  ['workshop', 'atelier', 'taller', 'oficina', '作坊', 'ورشة', 'мастерская', '工房'],
  ['warehouse', 'entrepôt', 'almacén', 'armazém', '仓库', 'مستودع', 'склад', '倉庫'],
  ['collective', 'équipement collectif', 'equipamiento colectivo', 'equipamento coletivo', '公共设施', 'مرفق جماعي', 'общественный объект', '公共施設'],
  ['open_space', 'espace ouvert', 'espacio abierto', 'espaço aberto', '开放空间', 'مساحة مفتوحة', 'открытое пространство', '開放空間'],
  ['market', 'marché', 'mercado', 'mercado', '市场', 'سوق', 'рынок', '市場'],
  ['common', 'commun', 'comunal', 'comunal', '公地', 'مشاع', 'общинное', '共有地'],
]);
const FUNCTION_EN: Record<string, string> = { domestic: 'housing', mixed: 'mixed (shop and housing)', workshop: 'workshop', warehouse: 'warehouse', collective: 'communal facility', open_space: 'open space', market: 'market', common: 'common' };
/** Name of a lot function (`domestic`, `workshop`…) in `locale`; the id when unknown. */
export function functionName(fn: string, locale: RoleLocale): string {
  const row = FUNCTIONS.get(fn);
  if (!row) return fn;
  return locale === 'en' ? FUNCTION_EN[fn] : pick(row, locale, 'functions');
}
/** Short captions and fallbacks, keyed by their English text. */
const TEXTS = index([
  ['No role', 'Sans rôle', 'Sin función', 'Sem função', '无角色', 'بلا دور', 'Без роли', '役割なし'],
  ['Building', 'Bâtiment', 'Edificio', 'Edifício', '建筑', 'مبنى', 'Здание', '建物'],
  ['Market', 'Marché', 'Mercado', 'Mercado', '集市', 'سوق', 'Рынок', '市場'],
  ['Monument', 'Monument', 'Monumento', 'Monumento', '纪念碑', 'نصب تذكاري', 'Памятник', '記念碑'],
  ['District', 'Quartier', 'Barrio', 'Bairro', '街区', 'حي', 'Район', '地区'],
  ['Role', 'Rôle', 'Función', 'Função', '角色', 'الدور', 'Роль', '役割'],
  ['Unassigned', 'non attribué', 'sin asignar', 'não atribuído', '未分配', 'غير مُعيَّن', 'не назначен', '未割り当て'],
  ['District group', 'Groupe de quartiers', 'Grupo de barrios', 'Grupo de bairros', '街区组', 'مجموعة أحياء', 'Группа районов', '地区グループ'],
  ['monument', 'monument', 'monumento', 'monumento', '纪念碑', 'نصب تذكاري', 'памятник', '記念碑'],
]);
/** Caption or fallback keyed by its English text, in `locale` (default: the UI language). */
export function roleText(english: string, locale: RoleLocale = uiRoleLocale()): string {
  const row = TEXTS.get(english);
  return row ? pick(row, locale, 'texts') : english;
}
