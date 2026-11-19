/** Coast profile copy consumed by localeMessages; terrainControlSchema registers the English/French source pairs. */
const sources = [
  'Coastal smoothing',
  '0 keeps cliffs; 1 creates low coastal ground for beaches and harbours, without smoothing the shoreline.',
  'Coastal transition width (m)',
  'Inland distance to recover the original relief. The first quarter stays low; wider bands make room below mountains.',
  'Coves and headlands',
  'Shoreline detail independent of elevation: 0 follows the broad shape or hand drawing; higher values add indentations and rocky points.',
  'Relief influence on coastline',
  'Let the sea follow valleys and leave ridges as headlands. Set to 0 to follow a hand-drawn coast more closely.',
  'Cliff coverage',
  'With smoothing enabled: 0 beaches, 1 cliffs, intermediate values alternate low coves and rocky stretches.',
  'Beaches', 'Mixed coast', 'Cliffs',
];
const translations = {
  es: [
    'Suavizado costero', '0 conserva los acantilados; 1 crea terrenos bajos para playas y puertos sin suavizar el trazado de la costa.',
    'Anchura de transición costera (m)', 'Distancia hacia el interior para recuperar el relieve original. El primer cuarto permanece bajo; una franja ancha deja espacio al pie de las montañas.',
    'Calas y cabos', 'Detalle costero independiente de la altitud: 0 sigue la forma general o el dibujo manual; valores altos acentúan las calas y las puntas rocosas.',
    'Influencia del relieve en la costa', 'El mar sigue los valles y deja las crestas como promontorios. Use 0 para seguir más fielmente una costa dibujada.',
    'Presencia de acantilados', 'Con el suavizado activo: 0 playas, 1 acantilados; los valores intermedios alternan calas bajas y tramos rocosos.', 'Playas', 'Costa mixta', 'Acantilados',
  ],
  pt: [
    'Suavização costeira', '0 mantém as falésias; 1 cria terrenos baixos para praias e portos sem suavizar o traçado da costa.',
    'Largura da transição costeira (m)', 'Distância para o interior até recuperar o relevo original. O primeiro quarto permanece baixo; faixas largas abrem espaço ao pé das montanhas.',
    'Enseadas e cabos', 'Detalhe costeiro independente da altitude: 0 segue a forma geral ou o desenho manual; valores altos acentuam enseadas e pontas rochosas.',
    'Influência do relevo na costa', 'O mar segue os vales e deixa as cristas como promontórios. Use 0 para seguir mais fielmente uma costa desenhada.',
    'Presença de falésias', 'Com a suavização ativa: 0 praias, 1 falésias; valores intermediários alternam enseadas baixas e trechos rochosos.', 'Praias', 'Costa mista', 'Falésias',
  ],
  zh: [
    '海岸平缓程度', '0保留悬崖；1在不平滑海岸线轮廓的情况下，形成适合海滩和港口的低地。',
    '海岸过渡宽度（米）', '向内陆恢复原始地形的距离。前四分之一保持低平；较宽的过渡带可在山脚留出空间。',
    '海湾与岬角', '独立于海拔的海岸细节：0遵循整体形状或手绘轮廓；较高值增加凹湾和岩石尖角。',
    '地形对海岸线的影响', '让海水沿山谷深入，山脊形成岬角。设为0可更忠实地遵循手绘海岸线。',
    '悬崖占比', '启用海岸平缓处理时：0为海滩，1为悬崖，中间值使低洼海湾与岩石岸段交替出现。', '海滩', '混合海岸', '悬崖',
  ],
  ar: [
    'تلطيف تضاريس الساحل', 'القيمة 0 تُبقي الجروف؛ والقيمة 1 تنشئ أرضاً ساحلية منخفضة للشواطئ والموانئ دون تنعيم خط الساحل.',
    'عرض الانتقال الساحلي (م)', 'المسافة نحو الداخل لاستعادة التضاريس الأصلية. يبقى الربع الأول منخفضاً؛ وتتيح الأشرطة الأعرض مساحة عند سفوح الجبال.',
    'الخلجان الصغيرة والرؤوس', 'تفاصيل الساحل مستقلة عن الارتفاع: 0 يتبع الشكل العام أو الرسم اليدوي؛ والقيم الأعلى تزيد التعاريج والرؤوس الصخرية.',
    'تأثير التضاريس على خط الساحل', 'دع البحر يتبع الوديان وتبقى الحواف الجبلية رؤوساً ساحلية. اضبط على 0 لاتباع الساحل المرسوم يدوياً بدقة أكبر.',
    'انتشار الجروف', 'عند تفعيل التلطيف: 0 شواطئ، 1 جروف، والقيم بينهما تُناوب بين الخلجان المنخفضة والمقاطع الصخرية.', 'شواطئ', 'ساحل مختلط', 'جروف',
  ],
  ru: [
    'Сглаживание прибрежного рельефа', '0 сохраняет обрывы; 1 создаёт низкий берег для пляжей и портов, не сглаживая очертания береговой линии.',
    'Ширина прибрежного перехода (м)', 'Расстояние вглубь суши до исходного рельефа. Первая четверть остаётся низкой; широкая полоса освобождает место у подножия гор.',
    'Бухты и мысы', 'Детализация берега не зависит от высоты: 0 следует общей форме или ручному рисунку; большие значения добавляют бухты и скалистые выступы.',
    'Влияние рельефа на береговую линию', 'Море следует долинам, а хребты образуют мысы. Значение 0 точнее сохраняет нарисованную вручную береговую линию.',
    'Доля обрывистых берегов', 'При включённом сглаживании: 0 — пляжи, 1 — обрывы, промежуточные значения чередуют низкие бухты и скалистые участки.', 'Пляжи', 'Смешанный берег', 'Обрывы',
  ],
  ja: [
    '沿岸地形の緩和', '0は崖を残し、1は海岸線の輪郭を滑らかにせずに、砂浜や港向けの低地を作ります。',
    '沿岸の遷移幅（m）', '内陸に向かって元の地形に戻るまでの距離です。最初の4分の1は低地を保ち、幅を広げると山麓に空間ができます。',
    '入り江と岬', '標高とは独立した海岸線の細かさです。0は大まかな形や手描きの線に従い、値を上げると入り江や岩の突端が増えます。',
    '海岸線への地形の影響', '海が谷に入り込み、尾根を岬として残します。手描きの海岸線に忠実に従うには0に設定します。',
    '崖の割合', '地形緩和が有効な場合、0は砂浜、1は崖になり、中間の値では低い入り江と岩場が交互に現れます。', '砂浜', '混合海岸', '崖',
  ],
};
export const localeCoasts = Object.fromEntries(Object.entries(translations).map(([language, values]) =>
  [language, Object.fromEntries(sources.map((source, i) => [source, values[i]]))]));
