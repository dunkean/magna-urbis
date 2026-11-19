/** Coastal smoothing copy shared with the terrain control schema. */
const sources = [
  'Median smoothing width (m)',
  'Wider bands create gentler slopes toward the sea; narrower bands preserve relief closer to the shore. 0 cuts directly at the shoreline.',
  'Smoothing variability',
  '0 keeps a constant width; higher values make it oscillate slowly along the coast, with smooth seeded stretches of irregular length.',
];
const translations = {
  es: ['Anchura mediana del suavizado (m)', 'Las franjas anchas crean pendientes suaves hacia el mar; las estrechas conservan el relieve cerca de la costa. 0 corta directamente en la orilla.', 'Variabilidad del suavizado', '0 mantiene una anchura constante; los valores altos la hacen oscilar lentamente a lo largo de la costa, con tramos suaves de longitud irregular determinados por la semilla.'],
  pt: ['Largura mediana da suavização (m)', 'Faixas largas criam declives suaves para o mar; faixas estreitas preservam o relevo perto da costa. 0 corta diretamente na costa.', 'Variabilidade da suavização', '0 mantém uma largura constante; valores altos fazem a largura oscilar lentamente ao longo da costa, em trechos suaves de comprimento irregular definidos pela semente.'],
  zh: ['平滑带宽度中值（米）', '宽过渡带形成朝向海洋的缓坡；窄过渡带在更靠近海岸处保留地形。0在海岸线直接切割。', '平滑带宽度变化', '0保持宽度不变；较高值使宽度沿海岸缓慢变化，种子决定长度不规则且平滑相连的区段。'],
  ar: ['العرض الوسيط للتنعيم (م)', 'تنتج الأشرطة العريضة منحدرات ألطف نحو البحر؛ وتحافظ الأشرطة الضيقة على التضاريس أقرب إلى الشاطئ. تقطع القيمة 0 مباشرة عند خط الساحل.', 'تفاوت التنعيم', 'تحافظ القيمة 0 على عرض ثابت؛ وتجعل القيم الأعلى العرض يتذبذب ببطء على طول الساحل بمقاطع سلسة غير منتظمة الطول تحددها البذرة.'],
  ru: ['Медианная ширина сглаживания (м)', 'Широкая полоса создаёт пологий спуск к морю; узкая сохраняет рельеф ближе к берегу. 0 обрезает рельеф по береговой линии.', 'Изменчивость сглаживания', '0 сохраняет постоянную ширину; большие значения медленно меняют её вдоль берега плавными участками неодинаковой длины, заданными зерном.'],
  ja: ['平滑化幅の中央値（m）', '幅を広げると海への傾斜が緩やかになり、狭くすると海岸の近くまで地形が残ります。0は海岸線で直接切り取ります。', '平滑化幅の変動', '0は一定の幅を保ち、値を上げると海岸に沿って幅がゆっくり変動します。不規則な長さの滑らかな区間はシードで決まります。'],
};
export const localeCoasts = Object.fromEntries(Object.entries(translations).map(([language, values]) =>
  [language, Object.fromEntries(sources.map((source, i) => [source, values[i]]))]));
