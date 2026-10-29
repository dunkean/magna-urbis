import { installWorkshopLocale, type Locale } from './shellLocale';
type Words = readonly [string, string, string, string, string];
const locales: Locale[] = ['fr', 'en', 'zh', 'es', 'pt'];
const fields: Record<string, Words> = {
  seed:['Graine','Seed','种子','Semilla','Semente'],
  terrainSource:['Source','Source','来源','Fuente','Origem'],
  phasorQuality:['Grille compacte','Compact grid','紧凑网格','Malla compacta','Grade compacta'],
  proceduralPreset:['Préréglage procédural','Procedural preset','程序预设','Preajuste procedural','Predefinição procedural'],
  proceduralPhasor:['Détail Phasor','Phasor detail','Phasor 细节','Detalle Phasor','Detalhe Phasor'],
  phasorIntensity:['Intensité Phasor','Phasor intensity','Phasor 强度','Intensidad Phasor','Intensidade Phasor'],
  motifSize:['Échelle du relief · m','Landform scale · m','地貌尺度 · 米','Escala del relieve · m','Escala do relevo · m'],
  relief:['Relief de fond','Background relief','背景地形','Relieve de fondo','Relevo de fundo'],
  neuralFit:['Étendue','Extent','范围','Extensión','Extensão'],
  climate:['Climat','Climate','气候','Clima','Clima'],
  environment:['Environnement','Surroundings','周边地形','Entorno','Entorno'],
  mountainMix:['Montagnes','Mountains','山地','Montañas','Montanhas'],
  erosion:['Érosion','Erosion','侵蚀','Erosión','Erosão'],
  width:['Carte · m','Map · m','地图 · 米','Mapa · m','Mapa · m'],
  renderV2Season:['Saison','Season','季节','Estación','Estação'],
  renderV2Diagnostic:['Diagnostic','Diagnostic','诊断','Diagnóstico','Diagnóstico'],
  hydroEngine:['Moteur','Engine','引擎','Motor','Motor'],
  hydroCondMode:['Préhydrologie','Pre-hydrology','水文预处理','Prehidrología','Pré-hidrologia'],
  hydroCondStrength:['Intensité','Strength','强度','Intensidad','Intensidade'],
  hydroRiverArea:['Rivière à partir de km²','River from km²','河流起始面积 km²','Río a partir de km²','Rio a partir de km²'],
  hydroRiverMode:['Tracé','Path','路径','Trazado','Traçado'],
  hydroBraiding:['Tresses','Braids','辫状河道','Trenzado','Canais entrelaçados'],
  hydroConfluence:['Confluences','Confluences','汇流','Confluencias','Confluências'],
  hydroMain:['Cours principal','Main channel','主河道','Cauce principal','Canal principal'],
  hydroDensity:['Affluents','Tributaries','支流','Afluentes','Afluentes'],
  hydroCoastal:['Cours côtiers','Coastal streams','沿海溪流','Cursos costeros','Cursos costeiros'],
  hydroLakes:['Lacs','Lakes','湖泊','Lagos','Lagos'],
  hydroLakeAbundance:['Nombre de lacs','Lake amount','湖泊数量','Cantidad de lagos','Quantidade de lagos'],
  hydroMeanders:['Méandres','Meanders','曲流','Meandros','Meandros'],
  hydroEstuary:['Embouchures','River mouths','河口','Desembocaduras','Foz dos rios'],
  hydroCondDepth:['Seuil · profondeur max. m','Sill · max depth m','门槛 · 最大深度 m','Umbral · profundidad máx. m','Soleira · profundidade máx. m'],
  hydroCondLength:['Seuil · longueur max. m','Sill · max length m','门槛 · 最大长度 m','Umbral · longitud máx. m','Soleira · comprimento máx. m'],
  hydroLakeDepth:['Lac · profondeur min. m','Lake · min depth m','湖泊 · 最小深度 m','Lago · profundidad mín. m','Lago · profundidade mín. m'],
  hydroLakeArea:['Lac · superficie min. ha','Lake · min area ha','湖泊 · 最小面积 ha','Lago · superficie mín. ha','Lago · área mín. ha'],
  hydroFlatSlope:['Méandres sous m/km','Meanders below m/km','曲流低于 m/km','Meandros por debajo de m/km','Meandros abaixo de m/km'],
  hydroSinuosity:['Sinuosité','Sinuosity','弯曲度','Sinuosidad','Sinuosidade'],
  hydroVectorWidth:['Largeur ×','Width ×','宽度 ×','Anchura ×','Largura ×'],
  hydroVectorResolution:['Grille vectorielle','Vector grid','矢量网格','Cuadrícula vectorial','Grade vetorial'],
  hydroWetness:['Apport d’eau','Water supply','水量补给','Aporte de agua','Aporte de água'],
  hydroWidthScale:['Largeurs ×','Widths ×','宽度 ×','Anchuras ×','Larguras ×'],
  hydroIncision:['Incision','Incision','下切','Incisión','Incisão'],
  hydroMeanderIntensity:['Intensité des méandres','Meander intensity','曲流强度','Intensidad de meandros','Intensidade dos meandros'],
  hydroMinLakeArea:['Lac · superficie min. m²','Lake · min area m²','湖泊 · 最小面积 m²','Lago · superficie mín. m²','Lago · área mín. m²'],
  hydroMinLakeDepth:['Lac · profondeur min. m','Lake · min depth m','湖泊 · 最小深度 m','Lago · profundidad mín. m','Lago · profundidade mín. m'],
  hydroLakeCoverage:['Lacs · superficie totale max. %','Lakes · max total area %','湖泊 · 最大总面积 %','Lagos · superficie total máx. %','Lagos · área total máx. %'],
  hydroMaxLakeArea:['Un lac · taille max. %','One lake · max size %','单湖 · 最大面积 %','Un lago · tamaño máx. %','Um lago · tamanho máx. %'],
  hydroDepressionPolicy:['Dépressions sans lac','Depressions without lakes','无湖泊的洼地','Depresiones sin lagos','Depressões sem lagos'],
  hydroMaxBreachDepth:['Brèche · profondeur max. m','Breach · max depth m','切口 · 最大深度 m','Apertura · profundidad máx. m','Abertura · profundidade máx. m'],
  hydroMaxBreachLength:['Brèche · longueur max. m','Breach · max length m','切口 · 最大长度 m','Apertura · longitud máx. m','Abertura · comprimento máx. m'],
  hydroResolution:['Grille','Grid','网格','Cuadrícula','Grade'],
  hydroCompute:['Calcul','Compute','计算','Cálculo','Cálculo'],
};
const checks: Record<string, Words> = {
  auto:['Auto','Auto','自动','Auto','Auto'],
  showOxbows:['Bras morts','Oxbows','牛轭湖','Meandros abandonados','Meandros abandonados'],
  showLakes:['Lacs','Lakes','湖泊','Lagos','Lagos'],
  showWater:['Eau · mer, lacs et rivières','Water · sea, lakes and rivers','水域 · 海洋、湖泊和河流','Agua · mar, lagos y ríos','Água · mar, lagos e rios'],
  showContours:['Courbes de niveau','Contour lines','等高线','Curvas de nivel','Curvas de nível'],
  showRelief:['Fond de terrain','Terrain background','地形背景','Fondo del terreno','Fundo do terreno'],
  showHypsometry:['Couleur du terrain','Terrain color','地形颜色','Color del terreno','Cor do terreno'],
  showFrame:['Cadre','Map frame','地图边框','Marco del mapa','Moldura do mapa'],
  showLegend:['Légende du diagnostic','Diagnostic legend','诊断图例','Leyenda del diagnóstico','Legenda do diagnóstico'],
  showShading:['Ombrage','Hillshade','地形晕渲','Sombreado','Sombreamento'],
  neuralSlopes:['Conserver les pentes','Preserve slopes','保留坡度','Conservar pendientes','Preservar encostas'],
  refine:['Raffinement fractal','Fractal refinement','分形细化','Refinamiento fractal','Refinamento fractal'],
  forestEnabled:['Canopée détaillée','Detailed canopy','详细树冠','Dosel detallado','Dossel detalhado'],
  hydroEnabled:['Activer','Enable','启用','Activar','Ativar'],
  hydroErosionEnabled:['Érosion pour le calcul','Erosion for computation','计算时侵蚀','Erosión para el cálculo','Erosão para cálculo'],
  hydroShowErosion:['Afficher le relief érodé','Show eroded terrain','显示侵蚀地形','Mostrar terreno erosionado','Exibir terreno erodido'],
  hydroBalance:['Bilan hydrique','Water balance','水量平衡','Balance hídrico','Balanço hídrico'],
  hydroAnabranching:['Anabranches','Anabranches','分汊河道','Anabranches','Anabranches'],
  hydroTerrainInfluence:['Méandres guidés par le terrain','Terrain-guided meanders','地形引导的曲流','Meandros guiados por el terreno','Meandros guiados pelo terreno'],
  hydroAvulsions:['Avulsions','Avulsions','河道改道','Avulsiones','Avulsões'],
  hydroDeltas:['Deltas','Deltas','三角洲','Deltas','Deltas'],
};
const buttons: Record<string, Words> = {
  generateRelief:['Recalculer le relief','Recalculate terrain','重新计算地形','Recalcular terreno','Recalcular terreno'],
  resetLighting:['Réinitialiser l’éclairage','Reset lighting','重置光照','Restablecer iluminación','Redefinir iluminação'],
  erReset:['Valeurs par défaut','Reset defaults','恢复默认值','Restablecer valores','Restaurar padrões'],
  dnReset:['Valeurs par défaut','Reset defaults','恢复默认值','Restablecer valores','Restaurar padrões'],
  retryRefinement:['Réessayer','Retry','重试','Reintentar','Tentar novamente'],
  generateCoasts:['Recalculer les côtes','Recalculate coasts','重新计算海岸','Recalcular costas','Recalcular costas'],
  generateHydrology:['Recalculer l’eau','Recalculate water','重新计算水系','Recalcular agua','Recalcular água'],
};
const choices: Record<string, Record<string, Words>> = {
  refinement3d: {
    source:['Source','Source','源地形','Fuente','Fonte'],
    noise:['Noise multiscale','Multiscale noise','多尺度噪声','Ruido multiescala','Ruído multiescala'],
    'neural-earth':['Neural Earth · Classique','Neural Earth · Classic','Neural Earth · 经典','Neural Earth · Clásico','Neural Earth · Clássico'],
    'neural-earth-phasor':['Neural Earth · Phasor','Neural Earth · Phasor','Neural Earth · Phasor','Neural Earth · Phasor','Neural Earth · Phasor'],
    'neural-earth-hybrid':['Neural Earth · Hybride','Neural Earth · Hybrid','Neural Earth · 混合','Neural Earth · Híbrido','Neural Earth · Híbrido'],
    'neural-earth-mse':['Neural Earth · MSE (expérimental)','Neural Earth · MSE (experimental)','Neural Earth · MSE（实验）','Neural Earth · MSE (experimental)','Neural Earth · MSE (experimental)'],
  },
  phasorQuality: {fast:['Rapide','Fast','快速','Rápida','Rápida'],balanced:['Équilibrée','Balanced','均衡','Equilibrada','Equilibrada'],detailed:['Détaillée','Detailed','详细','Detallada','Detalhada']},
  terrainSource: {
    'procedural-phasor':['Procédural Phasor · compact','Procedural Phasor · compact','程序化 Phasor · 紧凑','Procedural Phasor · compacto','Procedural Phasor · compacto'],
    procedural:['Procédural','Procedural','程序生成','Procedural','Procedural'],
    'neural-wasm':['Neuronal WASM · navigateur','Neural WASM · browser','神经 WASM · 浏览器','Neuronal WASM · navegador','Neural WASM · navegador'],
    'neural-python':['Neuronal Python · CUDA','Neural Python · CUDA','神经 Python · CUDA','Neuronal Python · CUDA','Neural Python · CUDA'],
  },
  relief: {
    flat:['Plaine','Plain','平原','Llanura','Planície'], hills:['Collines','Hills','丘陵','Colinas','Colinas'], valley:['Vallée','Valley','山谷','Valle','Vale'],
    canyon:['Canyon','Canyon','峡谷','Cañón','Cânion'], mountains:['Montagnes','Mountains','山地','Montañas','Montanhas'], mixed:['Collines et montagnes','Hills and mountains','丘陵与山地','Colinas y montañas','Colinas e montanhas'],
    plateau:['Plateau','Plateau','高原','Meseta','Planalto'], 'high-mountains':['Hautes montagnes','High mountains','高山','Altas montañas','Altas montanhas'], volcano:['Volcan','Volcano','火山','Volcán','Vulcão'], caldera:['Caldeira','Caldera','破火山口','Caldera','Caldeira'], cavern:['Caverne','Cavern','洞穴','Caverna','Caverna'],
  },
  climate: {
    temperate:['Tempéré chaud (référence)','Warm temperate (reference)','暖温带（参考）','Templado cálido (referencia)','Temperado quente (referência)'],
    oceanic:['Océanique','Oceanic','海洋性','Oceánico','Oceânico'], mediterranean:['Méditerranéen','Mediterranean','地中海','Mediterráneo','Mediterrâneo'],
    arid:['Aride','Arid','干旱','Árido','Árido'], cold:['Froid','Cold','寒冷','Frío','Frio'], tropical:['Tropical humide','Humid tropical','湿润热带','Tropical húmedo','Tropical úmido'], custom:['Personnalisé','Custom','自定义','Personalizado','Personalizado'],
  },
  neuralFit: {crop:['Découper','Crop','裁剪','Recortar','Recortar'],scale:['Mettre à l’échelle','Scale','缩放','Escalar','Dimensionar']},
  hydroOverlay: {
    none:['Aucun','None','无','Ninguno','Nenhum'],
    'v-accumulation':['Accumulation','Accumulation','汇流累积','Acumulación','Acumulação'],
    'v-basins':['Bassins versants','Watersheds','流域','Cuencas','Bacias hidrográficas'],
    'v-depth':['Remplissage des dépressions','Depression filling','洼地填充','Relleno de depresiones','Preenchimento de depressões'],
    'v-conditioning':['Conditionnement préhydrologique','Pre-hydrology conditioning','水文前预处理','Acondicionamiento prehidrológico','Condicionamento pré-hidrológico'],
    'v-lakes':['Bilan hydrique des lacs','Lake water balance','湖泊水量平衡','Balance hídrico de lagos','Balanço hídrico dos lagos'],
    'v-styles':['Styles de chenaux','Channel styles','河道样式','Estilos de cauce','Estilos de canais'],
    basins:['Bassins versants','Watersheds','流域','Cuencas','Bacias hidrográficas'],
    accumulation:['Accumulation','Accumulation','汇流累积','Acumulación','Acumulação'],
    flow:['Écoulement','Flow','水流','Flujo','Escoamento'], channels:['Réseau','Network','河网','Red','Rede'],
    depressions:['Dépressions','Depressions','洼地','Depresiones','Depressões'], lakes:['Lacs','Lakes','湖泊','Lagos','Lagos'],
    flats:['Zones plates','Flat areas','平坦区域','Zonas llanas','Áreas planas'], 'flat-rank':['Rangs des zones plates','Flat-area ranks','平坦区域排序','Orden de zonas llanas','Ordenação de áreas planas'],
    'raw-basins':['Bassins bruts','Raw watersheds','原始流域','Cuencas iniciales','Bacias iniciais'],
    'raw-accumulation':['Accumulation brute','Raw accumulation','原始汇流累积','Acumulación inicial','Acumulação inicial'],
    'raw-flow':['Écoulement brut','Raw flow','原始水流','Flujo inicial','Escoamento inicial'],
    'raw-depressions':['Dépressions brutes','Raw depressions','原始洼地','Depresiones iniciales','Depressões iniciais'],
  },
  hydroCondMode: {
    none:['Aucun','None','无','Ninguno','Nenhum'], erosion:['Érosion fluviale','Fluvial erosion','河流侵蚀','Erosión fluvial','Erosão fluvial'],
    breach:['Brèche de seuil','Sill breaching','切穿地形门槛','Apertura de umbral','Abertura de soleira'], both:['Les deux','Both','两者','Ambos','Ambos'],
  },
  hydroRiverMode: {vector:['Vectoriel','Vector','矢量','Vectorial','Vetorial'],grid:['Grille (D8)','Grid (D8)','网格 (D8)','Cuadrícula (D8)','Grade (D8)']},
  hydroBraiding: {'0':['Aucune','None','无','Ninguno','Nenhum'],'1':['Naturelles','Natural','自然','Natural','Natural'],'2':['Fréquentes','Frequent','频繁','Frecuente','Frequente']},
  hydroConfluence: {climate:['Selon le climat','By climate','依据气候','Según el clima','Pelo clima'],drainage:['Selon le drainage','From drainage','依据排水','Según el drenaje','Pela drenagem']},
  hydroMain: {auto:['Auto','Auto','自动','Auto','Auto'],none:['Sans cours principal','No main channel','无主河道','Sin cauce principal','Sem canal principal'],stream:['Ruisseau','Stream','溪流','Arroyo','Riacho'],river:['Rivière','River','河流','Río','Rio'],major:['Grand fleuve','Major river','大河','Río principal','Rio principal']},
  hydroLakes: {auto:['Bilan hydrique','Water budget','水量平衡','Balance hídrico','Balanço hídrico'],none:['Aucun','None','无','Ninguno','Nenhum'],some:['Quelques lacs','Some lakes','少量湖泊','Algunos lagos','Alguns lagos']},
  hydroMeanders: {natural:['Naturels','Natural','自然','Naturales','Naturais'],reduced:['Réduits','Reduced','减少','Reducidos','Reduzidos'],none:['Sans méandres ajoutés','No added meanders','不增加曲流','Sin meandros añadidos','Sem meandros adicionais']},
  hydroEstuary: {auto:['Auto','Auto','自动','Auto','Auto'],simple:['Simple','Simple','简单','Simple','Simples'],widening:['Élargissement','Widening','拓宽','Ensanchamiento','Alargamento'],funnel:['Entonnoir','Funnel','漏斗形','Embudo','Funil'],tidal:['Marée','Tidal','潮汐','Marea','Maré']},
  hydroDepressionPolicy: {auto:['Brèche limitée ou remplissage','Bounded breach or fill','有限切口或填充','Apertura limitada o relleno','Abertura limitada ou preenchimento'],fill:['Remplissage seul','Fill only','仅填充','Solo relleno','Somente preenchimento']},
};
export function setupTerrainLocale(): void {
  function apply(locale: Locale): void {
    const i = locales.indexOf(locale);
    for (const [id, words] of Object.entries(fields)) {
      const control = document.getElementById(id);
      const node = control?.closest('label')?.firstChild;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = words[i] + ' ';
    }
    for (const [id, words] of Object.entries(checks)) {
      const node = document.getElementById(id)?.nextSibling;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = words[i];
    }
    for (const [id, words] of Object.entries(buttons)) {
      const button = document.getElementById(id);
      if (button) button.textContent = words[i];
    }
    for (const [id, values] of Object.entries(choices)) {
      const select = document.getElementById(id) as HTMLSelectElement | null;
      for (const option of Array.from(select?.options ?? [])) if (values[option.value]) option.textContent = values[option.value][i];
    }
    const groups = document.querySelectorAll<HTMLOptGroupElement>('#hydroOverlay optgroup');
    const groupNames: Words[] = [
      ['Chaîne vectorielle','Vector pipeline','矢量流程','Proceso vectorial','Fluxo vetorial'],
      ['Rust · réseau final','Rust · final network','Rust · 最终河网','Rust · red final','Rust · rede final'],
      ['Rust · terrain et traitement','Rust · terrain and processing','Rust · 地形与处理','Rust · terreno y procesamiento','Rust · terreno e processamento'],
      ['Rust · drainage initial','Rust · initial drainage','Rust · 初始排水','Rust · drenaje inicial','Rust · drenagem inicial'],
    ];
    groups.forEach((group, index) => { if (groupNames[index]) group.label = groupNames[index][i]; });
    const layers = document.querySelector('#lightingControls > summary');
    if (layers) layers.textContent = ['Couches et éclairage','Layers and lighting','图层与光照','Capas e iluminación','Camadas e iluminação'][i];
    const hydrology = document.querySelector('#hydroControls > details.advanced > summary');
    if (hydrology) hydrology.textContent = ['Hydrologie avancée','Advanced hydrology','高级水文','Hidrología avanzada','Hidrologia avançada'][i];
    const stageLabels: Words[] = [
      ['1 · Terrain','1 · Terrain','1 · 地形','1 · Terreno','1 · Terreno'],
      ['2 · Côtes','2 · Coasts','2 · 海岸','2 · Costas','2 · Costas'],
      ['3 · Hydrologie','3 · Hydrology','3 · 水文','3 · Hidrología','3 · Hidrologia'],
      ['Calcul du terrain','Terrain compute','地形计算','Cálculo del terreno','Cálculo do terreno'],
    ];
    ['#reliefState', '#coastState', '#hydroState', '.stages > .backend'].forEach((selector, index) => {
      const target = document.querySelector(selector);
      const summary = index === 3 ? target?.querySelector('summary') : target?.parentElement;
      const node = summary?.firstChild;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = stageLabels[index][i] + ' ';
    });
  }
  const header = document.querySelector('header');
  if (header) installWorkshopLocale(header, apply);
}
