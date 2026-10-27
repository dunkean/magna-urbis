import { LOCALE_KEY, savedLocale, type Locale } from './shellLocale';

type Words = readonly [string, string, string, string, string];
const languages: Locale[] = ['fr', 'en', 'zh', 'es', 'pt'];
export function urbanText(words: Words): string { return words[languages.indexOf(typeof window === 'undefined' ? 'fr' : savedLocale())]; }
const labels: Record<string, Words> = {
  composition:['Génération','Generation','生成方式','Generación','Geração'],
  culture:['Profil culturel','Cultural profile','文化配置','Perfil cultural','Perfil cultural'],
  recipe:['Recette du plan / parcellaire','Plan / parcel recipe','规划 / 地块配方','Receta del plan / parcelario','Receita do plano / parcelamento'],
  preset:['Préréglage','Preset','预设','Preajuste','Predefinição'],
  zone:['Zones','Zones','区域','Zonas','Zonas'],
  density:['Multiplicateur de densité','Density multiplier','密度倍数','Multiplicador de densidad','Multiplicador de densidade'],
  settlementForm:['Grammaire morphologique','Morphological grammar','形态语法','Gramática morfológica','Gramática morfológica'],
  suburbs:['Faubourgs','Suburbs','郊区','Arrabales','Subúrbios'],
  phases:['Phases du noyau (0 = culture)','Core phases (0 = culture)','核心阶段（0 = 文化）','Fases del núcleo (0 = cultura)','Fases do núcleo (0 = cultura)'],
  tissue:['Maillage des rues','Street network','街道网络','Red de calles','Rede de ruas'],
  accessMode:['Accessibilité des îlots','Block accessibility','街区通达性','Accesibilidad de las manzanas','Acessibilidade das quadras'],
  accessDepth:['Profondeur accessible (m · 0 = culture)','Accessible depth (m · 0 = culture)','可达深度（米 · 0 = 文化）','Profundidad accesible (m · 0 = cultura)','Profundidade acessível (m · 0 = cultura)'],
  accessBudget:['Accès ajoutés au plus par îlot','Maximum access additions per block','每个街区最多增加的通道','Accesos añadidos como máximo por manzana','Máximo de acessos adicionados por quadra'],
  mixCulture:['Seconde influence','Second influence','第二种影响','Segunda influencia','Segunda influência'],
  mixMode:['Répartition','Distribution','分布','Distribución','Distribuição'],
  mixShare:['Part de la seconde influence','Share of second influence','第二种影响的比例','Proporción de la segunda influencia','Proporção da segunda influência'],
  mixAngle:['Orientation des secteurs (°)','Sector orientation (°)','分区方向（°）','Orientación de sectores (°)','Orientação dos setores (°)'],
  exitTreatment:['Sorties de rues','Street exits','街道出口','Salidas de calles','Saídas das ruas'],
  peripheralRoad:['Chemin périphérique','Peripheral road','外围道路','Camino periférico','Caminho periférico'],
  axisAlignment:['Orientation des axes urbains','Urban axis orientation','城市轴线方向','Orientación de ejes urbanos','Orientação dos eixos urbanos'],
  siteAdaptation:['Adaptation au relief et aux berges','Adaptation to terrain and banks','适应地形和河岸','Adaptación al relieve y las riberas','Adaptação ao relevo e às margens'],
  fortification:['Enceinte du noyau','Core enclosure','核心围墙','Recinto del núcleo','Recinto do núcleo'],
  fortificationStyle:['Style de l’enceinte','Enclosure style','围墙样式','Estilo del recinto','Estilo do recinto'],
  operator:['Opérateur parcellaire','Parcel operator','地块划分方式','Operador parcelario','Operador de parcelamento'],
  count:['Secteurs de calcul visés','Target calculation sectors','目标计算分区数','Sectores de cálculo previstos','Setores de cálculo previstos'],
  rings:['Anneaux de la scène','Scene rings','场景环数','Anillos de la escena','Anéis da cena'],
  placement:['Disposition','Layout','布局','Disposición','Disposição'],
  radius:['Rayon d’emprise (m · 0 = lieu)','Footprint radius (m · 0 = place)','范围半径（米 · 0 = 地点）','Radio de ocupación (m · 0 = lugar)','Raio da área (m · 0 = local)'],
  radiusScale:['Échelle de l’emprise','Footprint scale','范围比例','Escala de ocupación','Escala da área'],
  monument:['Réservation monument','Monument reservation','预留纪念建筑','Reserva para monumento','Reserva para monumento'],
  maxStreetGrade:['Pente maximale des rues (m/m)','Maximum street grade (m/m)','最大街道坡度（米/米）','Pendiente máxima de calles (m/m)','Inclinação máxima das ruas (m/m)'],
  maxLaneGrade:['Pente maximale des ruelles (m/m)','Maximum lane grade (m/m)','最大小巷坡度（米/米）','Pendiente máxima de callejones (m/m)','Inclinação máxima das vielas (m/m)'],
  maxStairGrade:['Pente maximale des escaliers (m/m)','Maximum stair grade (m/m)','最大楼梯坡度（米/米）','Pendiente máxima de escaleras (m/m)','Inclinação máxima das escadas (m/m)'],
};
const footprint: Record<string, Words> = {
  family:['Forme de ville','City shape','城市形状','Forma de la ciudad','Forma da cidade'],
  mechanism:['Croissance','Growth','增长','Crecimiento','Crescimento'],
  budget:['Budget spatial','Spatial budget','空间预算','Presupuesto espacial','Orçamento espacial'],
  grossDensity:['Densité brute (hab./ha · 0 = culture)','Gross density (people/ha · 0 = culture)','毛密度（人/公顷 · 0 = 文化）','Densidad bruta (hab./ha · 0 = cultura)','Densidade bruta (hab./ha · 0 = cultura)'],
  aspect:['Allongement','Elongation','延展度','Alargamiento','Alongamento'], orientation:['Orientation (°)','Orientation (°)','方向（°）','Orientación (°)','Orientação (°)'],
  nuclei:['Noyaux de croissance','Growth centers','增长中心','Núcleos de crecimiento','Núcleos de crescimento'],
  irregularity:['Irrégularité','Irregularity','不规则度','Irregularidad','Irregularidade'],
  anisotropy:['Attraction des axes','Axis attraction','轴线吸引力','Atracción de ejes','Atração dos eixos'],
  separation:['Écartement des noyaux','Center spacing','中心间距','Separación de núcleos','Espaçamento dos núcleos'],
  epochs:['Étapes de croissance','Growth stages','增长阶段','Etapas de crecimiento','Etapas de crescimento'],
  cohesion:['Cohésion','Cohesion','聚合度','Cohesión','Coesão'], satellites:['Propension aux satellites','Satellite tendency','卫星聚落倾向','Tendencia a satélites','Tendência a satélites'],
  branchDepth:['Profondeur des branches','Branch depth','分支深度','Profundidad de ramas','Profundidade dos ramos'],
  gapSize:['Taille des coupures (m)','Gap size (m)','间隙大小（米）','Tamaño de interrupciones (m)','Tamanho das lacunas (m)'],
};
const options: Record<string, Record<string, Words>> = {
  composition:{settlement:['Agglomération complète','Complete settlement','完整聚落','Asentamiento completo','Povoado completo'], district:['Secteur isolé · ancien banc','Single sector · legacy bench','单个分区 · 旧工作台','Sector aislado · banco antiguo','Setor isolado · bancada antiga']},
  accessMode:{adaptive:['Adaptative selon le parcellaire','Adapt to parcels','根据地块自适应','Adaptativa según parcelas','Adaptativa conforme os lotes'], cultural:['Dessertes culturelles','Cultural access patterns','文化通达方式','Accesos culturales','Acessos culturais'], none:['Conserver les accès existants','Keep existing access','保留现有通道','Conservar accesos existentes','Manter acessos existentes']},
  fortification:{culture:['Selon la culture','According to culture','按文化','Según la cultura','Conforme a cultura'],none:['Sans enceinte','No enclosure','无围墙','Sin recinto','Sem recinto'],wall:['Muraille','Wall','城墙','Muralla','Muralha'],palisade:['Palissade','Palisade','栅栏','Empalizada','Paliçada']},
  mixMode:{phases:['Chronologique · extensions plus récentes','Chronological · newer extensions','按时间 · 较新的扩展','Cronológico · extensiones más recientes','Cronológico · expansões mais recentes'],sectors:['Géométrique · secteurs','Geometric · sectors','按几何 · 分区','Geométrico · sectores','Geométrico · setores']},
  peripheralRoad:{auto:['Selon les accès','According to access','根据通道','Según los accesos','Conforme os acessos'],none:['Aucun','None','无','Ninguno','Nenhum'],partial:['Partiel','Partial','部分','Parcial','Parcial'],full:['Complet si le terrain le permet','Complete if terrain permits','地形允许时完整','Completo si lo permite el terreno','Completo se o terreno permitir']},
  zone:{auto:['Du centre vers la campagne','From center to countryside','从中心到乡村','Del centro al campo','Do centro ao campo'],core:['Cœur','Core','核心','Núcleo','Núcleo'],middle:['Quartiers intermédiaires','Intermediate neighborhoods','中间街区','Barrios intermedios','Bairros intermediários'],edge:['Périphérie','Outskirts','外围','Periferia','Periferia'],faubourg:['Faubourgs','Suburbs','郊区','Arrabales','Subúrbios'],village:['Village','Village','村庄','Pueblo','Vila']},
  suburbs:{auto:['Croissance variable','Variable growth','可变增长','Crecimiento variable','Crescimento variável'],none:['Aucun','None','无','Ninguno','Nenhum'],few:['Quelques faubourgs','A few suburbs','少量郊区','Algunos arrabales','Alguns subúrbios'],many:['Faubourgs étendus','Extensive suburbs','大片郊区','Arrabales extensos','Subúrbios extensos']},
  exitTreatment:{adaptive:['Raccordements, chemins et impasses','Connections, paths and dead ends','连接、道路和尽头','Conexiones, caminos y calles sin salida','Conexões, caminhos e ruas sem saída'],closed:['Impasses fermées','Closed dead ends','封闭尽头','Calles sin salida cerradas','Ruas sem saída fechadas'],legacy:['Ancien comportement','Legacy behavior','旧版行为','Comportamiento anterior','Comportamento anterior']},
  axisAlignment:{regional:['Routes régionales principales','Main regional roads','主要区域道路','Rutas regionales principales','Estradas regionais principais'],culture:['Orientation culturelle','Cultural orientation','文化方向','Orientación cultural','Orientação cultural']},
  placement:{center:['Plan culturel adapté au terrain','Cultural plan adapted to terrain','适应地形的文化规划','Plan cultural adaptado al terreno','Plano cultural adaptado ao terreno'],rectangle:['Rectangle','Rectangle','矩形','Rectángulo','Retângulo'],skew:['Oblique','Oblique','倾斜','Oblicuo','Oblíquo'],notched:['Avec encoche','Notched','带缺口','Con muesca','Com entalhe']},
  budget:{population:['Population / densité brute','Population / gross density','人口 / 毛密度','Población / densidad bruta','População / densidade bruta'],radius:['Rayon artistique','Artistic radius','艺术半径','Radio artístico','Raio artístico']},
};
const stageTitles: Record<string, Words> = {
  urbanQuarterStage:['3 · Plan urbain ','3 · Urban plan ','3 · 城市规划 ','3 · Plan urbano ','3 · Plano urbano '],
  cityFootprintStage:['4 · Emprise et croissance ','4 · Footprint and growth ','4 · 范围与增长 ','4 · Ocupación y crecimiento ','4 · Área e crescimento '],
  cityStreetStage:['5 · Rues et îlots ','5 · Streets and blocks ','5 · 街道与街区 ','5 · Calles y manzanas ','5 · Ruas e quadras '],
  cityEdgeStage:['6 · Enceinte, sorties et influences ','6 · Enclosure, exits and influences ','6 · 围墙、出口与影响 ','6 · Recinto, salidas e influencias ','6 · Recinto, saídas e influências '],
  cityDisplayStage:['👁 Affichage ','👁 Display ','👁 显示 ','👁 Visualización ','👁 Exibição '],
  urbanParcelStage:['7 · Parcelles ','7 · Parcels ','7 · 地块 ','7 · Parcelas ','7 · Lotes '],
};
const quarterTitle: Words = ['6 · Empreinte, quartiers et îlots ','6 · Footprint, neighborhoods and blocks ','6 · 范围、街区与街坊 ','6 · Ocupación, barrios y manzanas ','6 · Área, bairros e quadras '];
const actions: Record<string, Words> = {
  '#urbanFocus':['Centrer sur la ville','Center on city','定位到城市','Centrar en la ciudad','Centralizar na cidade'],
  '[data-morphology-auto]':['Grammaire automatique','Automatic grammar','自动语法','Gramática automática','Gramática automática'],
  '[data-remove-enclosure]':['Retirer l’enceinte','Remove enclosure','移除围墙','Quitar recinto','Remover recinto'],
  '[data-explore="seed"]':['Nouvelle graine','New seed','新种子','Nueva semilla','Nova semente'],
  '[data-explore="plan"]':['Motif au hasard','Random pattern','随机模式','Patrón aleatorio','Padrão aleatório'],
  '[data-explore="back"]':['Tirage précédent','Previous draw','上一次抽取','Sorteo anterior','Sorteio anterior'],
  '[data-reset]':['Réinitialiser les paramètres','Reset settings','重置设置','Restablecer ajustes','Redefinir configurações'],
  '[data-plan-culture-site]':['Plan : comme le lieu','Plan: use place culture','规划：使用地点文化','Plan: usar cultura del lugar','Plano: usar cultura do local'],
};
const enabledText: Words[] = [
  ['Générer les quartiers','Generate neighborhoods','生成街区','Generar barrios','Gerar bairros'],
  ['Générer les parcelles','Generate parcels','生成地块','Generar parcelas','Gerar lotes'],
];
const seedText: Words[] = [
  ['Graine quartiers','Neighborhood seed','街区种子','Semilla de barrios','Semente dos bairros'],
  ['Graine parcelles','Parcel seed','地块种子','Semilla de parcelas','Semente dos lotes'],
];
const summaries: Record<string, Words> = {
  'Graine':['Graine','Seed','种子','Semilla','Semente'],
  'Dimensions et budget':['Dimensions et budget','Dimensions and budget','尺寸与预算','Dimensiones y presupuesto','Dimensões e orçamento'],
  'Dispersion et coupures':['Dispersion et coupures','Dispersion and gaps','分散与间隙','Dispersión e interrupciones','Dispersão e lacunas'],
  'Réglages des accès':['Réglages des accès','Access settings','通道设置','Ajustes de acceso','Configurações de acesso'],
  'Influences et sorties':['Influences et sorties','Influences and exits','影响与出口','Influencias y salidas','Influências e saídas'],
  'Enceinte':['Enceinte','Enclosure','围墙','Recinto','Recinto'],
  'Composition historique':['Composition historique','Historical composition','历史组合','Composición histórica','Composição histórica'],
  'Diagnostic du plan':['Diagnostic du plan','Plan diagnostics','规划诊断','Diagnóstico del plan','Diagnóstico do plano'],
  'Recettes et dimensions avancées':['Recettes et dimensions avancées','Advanced recipes and dimensions','高级配方与尺寸','Recetas y dimensiones avanzadas','Receitas e dimensões avançadas'],
  'Rues et relief':['Rues et relief','Streets and terrain','街道与地形','Calles y relieve','Ruas e relevo'],
  'Tous les paramètres natifs':['Tous les paramètres natifs','All native parameters','所有原生参数','Todos los parámetros nativos','Todos os parâmetros nativos'],
  'Profil culturel du plan · surcharge':['Profil culturel du plan · surcharge','Plan cultural profile · override','规划文化配置 · 覆盖','Perfil cultural del plan · sustitución','Perfil cultural do plano · substituição'],
  'Secteur isolé · ancien banc':['Secteur isolé · ancien banc','Single sector · legacy bench','单个分区 · 旧工作台','Sector aislado · banco antiguo','Setor isolado · bancada antiga'],
  'Recettes du plan':['Recettes du plan','Plan recipes','规划配方','Recetas del plan','Receitas do plano'],
  'Pentes et escaliers':['Pentes et escaliers','Slopes and stairs','坡度与楼梯','Pendientes y escaleras','Inclinações e escadas'],
  'Paramètres natifs des rues et îlots':['Paramètres natifs des rues et îlots','Native street and block settings','原生街道与街区参数','Parámetros nativos de calles y manzanas','Parâmetros nativos de ruas e quadras'],
  'Sorties et axes':['Sorties et axes','Exits and axes','出口与轴线','Salidas y ejes','Saídas e eixos'],
  'Seconde influence':['Seconde influence','Second influence','第二种影响','Segunda influencia','Segunda influência'],
  'Recettes du parcellaire':['Recettes du parcellaire','Parcel recipes','地块配方','Recetas del parcelario','Receitas de parcelamento'],
  'Paramètres natifs du parcellaire':['Paramètres natifs du parcellaire','Native parcel settings','原生地块参数','Parámetros nativos del parcelario','Parâmetros nativos do parcelamento'],
};

/** Translate existing controls without recreating them or changing their values. */
export function setupUrbanPanelLocale(roots: HTMLElement[], city: boolean): void {
  const summaryTranslations = roots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>('details > summary')))
    .map(summary => ({ summary, words: summaries[summary.textContent?.trim() ?? ''] })).filter(item => item.words);
  function apply(): void {
    const i = languages.indexOf(savedLocale());
    for (const { summary, words } of summaryTranslations) summary.textContent = words[i];
    for (const root of roots) {
      const title = root.id === 'urbanQuarterStage' && !city ? quarterTitle : stageTitles[root.id];
      const summary = root.querySelector(':scope > summary');
      if (title && summary?.firstChild?.nodeType === Node.TEXT_NODE) summary.firstChild.textContent = title[i];
      for (const [attribute, translations] of [['config', labels], ['footprint', footprint]] as const) {
        for (const [key, words] of Object.entries(translations)) {
          for (const control of Array.from(root.querySelectorAll<HTMLElement>(`[data-${attribute}="${key}"]`))) {
            const first = control.closest('label')?.firstChild;
            if (first?.nodeType === Node.TEXT_NODE) first.textContent = words[i];
            const choices = options[key];
            if (choices && control instanceof HTMLSelectElement) for (const option of Array.from(control.options)) {
              if (choices[option.value]) option.textContent = choices[option.value][i];
            }
          }
        }
      }
      for (const [selector, words] of Object.entries(actions)) for (const button of Array.from(root.querySelectorAll<HTMLElement>(selector))) button.textContent = words[i];
      const focus = root.querySelector<HTMLElement>('#urbanFocus');
      if (focus && !city) focus.textContent = ['Centrer sur la sélection','Center on selection','定位到所选项目','Centrar en la selección','Centralizar na seleção'][i];
      const parcel = root.id === 'urbanParcelStage' ? 1 : 0;
      const enabled = root.querySelector<HTMLInputElement>('[data-enabled]');
      if (enabled?.nextSibling?.nodeType === Node.TEXT_NODE) enabled.nextSibling.textContent = enabledText[parcel][i];
      const seed = root.querySelector<HTMLInputElement>('[data-seed]');
      if (seed) {
        const first = seed.closest('label')?.firstChild;
        if (first?.nodeType === Node.TEXT_NODE) first.textContent = seedText[parcel][i];
        seed.placeholder = ['Graine de la carte','Map seed','地图种子','Semilla del mapa','Semente do mapa'][i];
      }
      const stairs = root.querySelector<HTMLInputElement>('[data-config="allowStairs"]');
      if (stairs?.nextSibling?.nodeType === Node.TEXT_NODE) stairs.nextSibling.textContent = ['Autoriser les escaliers piétons','Allow pedestrian stairs','允许行人楼梯','Permitir escaleras peatonales','Permitir escadas para pedestres'][i];
      const applyButton = root.querySelector<HTMLElement>('[data-apply]');
      if (applyButton) applyButton.textContent = (root.id === 'urbanParcelStage' ? ['Régénérer les parcelles','Regenerate parcels','重新生成地块','Regenerar parcelas','Regenerar lotes'] : ['Régénérer la ville','Regenerate city','重新生成城市','Regenerar ciudad','Regenerar cidade'])[i];
    }
  }
  apply();
  window.addEventListener('magna-locale-change', apply);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) apply(); });
}
