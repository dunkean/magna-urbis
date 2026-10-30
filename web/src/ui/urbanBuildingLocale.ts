import { LOCALE_KEY } from './shellLocale';
import { urbanText } from './urbanPanelLocale';

type Words = readonly [string, string, string, string, string];
const labels: Record<string, Words> = {
  '[data-building-seed]':['Graine','Seed','种子','Semilla','Semente'],
  '[data-building-typology]':['Typologie','Typology','类型','Tipología','Tipologia'],
  '[data-building-floors]':['Niveaux demandés','Requested levels','要求的楼层','Niveles solicitados','Níveis solicitados'],
  '[data-building-house-model]':['Code ou lien replay','Replay code or link','重放代码或链接','Código o enlace de reproducción','Código ou link de replay'],
  '[data-building-culture]':['Style unique des maisons · toute la ville (ancien réglage)','Single house style · whole city (legacy setting)','统一房屋样式 · 整座城市（旧设置）','Estilo único de casas · toda la ciudad (ajuste antiguo)','Estilo único das casas · toda a cidade (configuração antiga)'],
  '[data-building-style]':['Rendu Maisons','House rendering','房屋渲染','Renderizado de casas','Renderização de casas'],
  '[data-building-diagnostic]':['Diagnostic','Diagnostic','诊断','Diagnóstico','Diagnóstico'],
  '[data-building-parent-import]':['Importer des archives parent natives','Import native parent archives','导入原生父对象档案','Importar archivos de elementos principales nativos','Importar arquivos de objetos principais nativos'],
  '[data-programme="resources"]':['Ressources connues','Known resources','已知资源','Recursos conocidos','Recursos conhecidos'],
  '[data-programme="lore"]':['Choix du lieu','Place choices','地点选择','Opciones del lugar','Escolhas do local'],
  '[data-programme-intent]':['Intention d’implantation','Settlement intent','聚落意图','Intención de asentamiento','Intenção de povoamento'],
  '[data-programme="mode"]':['Politique d’admission','Admission policy','接纳策略','Política de admisión','Política de admissão'],
  '[data-programme="period"]':['Filtre d’époque','Period filter','时期筛选','Filtro de época','Filtro de período'],
  '[data-condition-state]':['État demandé','Requested state','请求状态','Estado solicitado','Estado solicitado'],
  '[data-condition-decay-mode]':['Vacance demandée','Requested vacancy','请求的空置率','Vacancia solicitada','Vacância solicitada'],
  '[data-condition-decay]':['Taux de vacance','Vacancy rate','空置率','Tasa de vacancia','Taxa de vacância'],
  '[data-programme-function="agricultural"]':['Espaces communs et stockage rural','Commons and rural storage','公共空间与乡村储存','Espacios comunes y almacenamiento rural','Espaços comuns e armazenamento rural'],
  '[data-programme-function="commerce"]':['Commerce et marchés','Commerce and markets','商业与市场','Comercio y mercados','Comércio e mercados'],
  '[data-programme-function="artisan"]':['Artisanat','Craft','手工业','Artesanía','Artesanato'],
  '[data-programme-function="riverine"]':['Moulins hydrauliques','Water mills','水磨坊','Molinos hidráulicos','Moinhos hidráulicos'],
  '[data-programme-function="port"]':['Activité portuaire','Port activity','港口活动','Actividad portuaria','Atividade portuária'],
  '[data-programme-function="capital"]':['Capitale · équipements institutionnels','Capital · institutional facilities','首都 · 机构设施','Capital · equipamientos institucionales','Capital · instalações institucionais'],
};
const choices: Record<string, Record<string, Words>> = {
  '[data-building-typology]': {
    '':['Selon le programme culturel','According to cultural program','按文化规划','Según el programa cultural','Conforme o programa cultural'],
    common:['Famille courante','Common family','常见类型','Familia común','Família comum'], row:['Lanière / mitoyenne','Strip / attached','条带式 / 连排','Parcela estrecha / adosada','Faixa / geminada'],
    courtyard:['Maison à cour','Courtyard house','庭院住宅','Casa con patio','Casa com pátio'], compound:['Enclos / ensemble','Enclosure / compound','围合 / 建筑群','Recinto / conjunto','Recinto / conjunto'], detached:['Maison indépendante','Detached house','独立住宅','Casa independiente','Casa independente'],
  },
  '[data-building-diagnostic]': {
    none:['Aucun','None','无','Ninguno','Nenhum'], uses:['Usages','Uses','用途','Usos','Usos'], access:['Entrées et refus','Entrances and refusals','入口与拒绝','Entradas y rechazos','Entradas e recusas'], height:['Hauteurs physiques','Physical heights','物理高度','Alturas físicas','Alturas físicas'],
  },
  '[data-building-style]': { cartographic:['Rendu Maisons partagé','Shared house rendering','共享房屋渲染','Renderizado compartido de casas','Renderização compartilhada de casas'], silhouette:['Silhouettes à plat','Flat silhouettes','平面轮廓','Siluetas planas','Silhuetas planas'] },
  '[data-building-culture]': { '':['Selon le routage du programme appliqué','According to the applied program routing','按已应用规划的分配','Según la asignación del programa aplicado','Conforme a distribuição do programa aplicado'] },
  '[data-programme-intent]': {
    settlement:['Agglomération · selon population et culture','Settlement · according to population and culture','聚落 · 根据人口和文化','Asentamiento · según población y cultura','Povoado · conforme população e cultura'],
    'isolated-farm':['Ferme isolée','Isolated farm','孤立农场','Granja aislada','Fazenda isolada'], 'roadside-temple':['Temple de bord de route','Roadside temple','路边寺庙','Templo junto al camino','Templo à beira da estrada'],
    'isolated-shrine':['Sanctuaire isolé','Isolated shrine','孤立神龛','Santuario aislado','Santuário isolado'], 'isolated-mill':['Moulin isolé','Isolated mill','孤立磨坊','Molino aislado','Moinho isolado'],
    'isolated-inn':['Auberge isolée','Isolated inn','孤立客栈','Posada aislada','Estalagem isolada'], 'isolated-tower':['Tour isolée','Isolated tower','孤立塔楼','Torre aislada','Torre isolada'],
  },
  '[data-programme="mode"]': {
    strict:['Strict · contrôles de sources et d’emprunts','Strict · source and borrowing checks','严格 · 来源与借用检查','Estricto · controles de fuentes y préstamos','Estrito · verificações de fontes e empréstimos'],
    inspired:['Inspiré · adaptations permises par les sources','Inspired · source-permitted adaptations','灵感模式 · 来源允许的改编','Inspirado · adaptaciones permitidas por las fuentes','Inspirado · adaptações permitidas pelas fontes'],
    fantasy:['Fantasy · mélanges déclarés','Fantasy · declared mixes','奇幻 · 声明的混合','Fantasía · mezclas declaradas','Fantasia · misturas declaradas'],
  },
  '[data-programme="period"]': {
    '':['Non précisée · aucun filtre','Unspecified · no filter','未指定 · 无筛选','No especificada · sin filtro','Não especificado · sem filtro'],
    any:['Toutes les époques · code any conservé','All periods · retained code any','所有时期 · 保留代码 any','Todas las épocas · código any conservado','Todos os períodos · código any mantido'],
    A:['Antiquité locale · code A','Local antiquity · code A','当地古代 · 代码 A','Antigüedad local · código A','Antiguidade local · código A'],
    M:['Moyen Âge / équivalent local · code M','Middle Ages / local equivalent · code M','中世纪 / 当地对应时期 · 代码 M','Edad Media / equivalente local · código M','Idade Média / equivalente local · código M'],
  },
  '[data-condition-state]': {
    '@absent':['Non précisé · défaut natif thriving','Unspecified · native default thriving','未指定 · 原生默认 thriving','No especificado · valor nativo thriving','Não especificado · padrão nativo thriving'],
    thriving:['En activité · thriving','Thriving · thriving','繁荣 · thriving','En actividad · thriving','Em atividade · thriving'], declining:['En déclin · declining','Declining · declining','衰退 · declining','En declive · declining','Em declínio · declining'],
    abandoned:['À l’abandon · abandoned','Abandoned · abandoned','废弃 · abandoned','Abandonado · abandoned','Abandonado · abandoned'], ruined:['En ruine · ruined','Ruined · ruined','废墟 · ruined','En ruinas · ruined','Em ruínas · ruined'],
  },
  '[data-condition-decay-mode]': {
    '@absent':['Non précisée · champ omis','Unspecified · field omitted','未指定 · 省略字段','No especificada · campo omitido','Não especificada · campo omitido'],
    null:['Défaut de l’état · null explicite','State default · explicit null','状态默认值 · 显式 null','Valor del estado · null explícito','Padrão do estado · null explícito'],
    value:['Taux explicite · 0 à 1','Explicit rate · 0 to 1','明确比例 · 0 至 1','Tasa explícita · 0 a 1','Taxa explícita · 0 a 1'],
  },
};
const buttons: Record<string, Words> = {
  '[data-programme-apply]':['Appliquer le programme au plan','Apply program to plan','将规划应用于方案','Aplicar programa al plan','Aplicar programa ao plano'],
  '[data-building-house-bench]':['Ouvrir le banc Maisons','Open Houses bench','打开房屋工作台','Abrir taller de casas','Abrir bancada de casas'],
  '[data-programme-functions-auto]':['Revenir au profil culturel automatique','Restore automatic cultural profile','恢复自动文化配置','Restablecer el perfil cultural automático','Restaurar o perfil cultural automático'],
  '[data-programme-period-clear]':['Retirer le filtre d’époque','Clear period filter','清除时期筛选','Quitar filtro de época','Remover filtro de período'],
  '[data-condition-reset]':['État et vacance non précisés','Leave state and vacancy unspecified','不指定状态和空置率','Dejar estado y vacancia sin especificar','Deixar estado e vacância não especificados'],
};
const headings: Record<string, Words> = {
  'Culture, époque et ressources':['Culture, époque et ressources','Culture, period and resources','文化、时期与资源','Cultura, época y recursos','Cultura, período e recursos'],
  'Implantation et niveaux':['Implantation et niveaux','Placement and levels','布局与楼层','Implantación y niveles','Implantação e níveis'],
  'Modèle du banc Maisons':['Modèle du banc Maisons','Houses bench model','房屋工作台模型','Modelo del taller de casas','Modelo da bancada de casas'],
  'Refus d’implantation':['Refus d’implantation','Placement refusals','布局拒绝','Rechazos de implantación','Recusas de implantação'],
  'Déficits architecturaux déclarés':['Déficits architecturaux déclarés','Reported architectural deficits','已报告的建筑缺口','Déficits arquitectónicos declarados','Déficits arquitetônicos declarados'],
  'État du lieu et vacance':['État du lieu et vacance','Place condition and vacancy','地点状态与空置率','Estado del lugar y vacancia','Estado do local e vacância'],
};
const notes: Record<string, Words> = {
  '[data-programme-draft]':['Modifications non appliquées.','Unapplied changes.','未应用的更改。','Cambios sin aplicar.','Alterações não aplicadas.'],
  '[data-building-draft]':['Modifications non appliquées · utilisez « Implanter les bâtiments ».','Unapplied changes · use “Place buildings”.','未应用的更改 · 请使用“放置建筑”。','Cambios sin aplicar · usa «Implantar edificios».','Alterações não aplicadas · use “Implantar edifícios”.'],
};
const inspection: Record<string, Words> = {
  parcel:['Parcelle','Parcel','地块','Parcela','Lote'], culture:['Culture et recette','Culture and recipe','文化与配方','Cultura y receta','Cultura e receita'],
  height:['Sol / hauteur physique','Ground / physical height','地面 / 物理高度','Suelo / altura física','Solo / altura física'],
  domestic:['Indicateurs domestiques','Domestic indicators','居住指标','Indicadores domésticos','Indicadores domésticos'],
  access:['Accès','Access','通道','Acceso','Acesso'], open:['Ouvrir dans Maisons','Open in Houses','在房屋中打开','Abrir en Casas','Abrir em Casas'],
  assembly:['Essai assemblage natif · parent sélectionné','Native assembly test · selected parent','原生装配测试 · 所选父对象','Prueba de ensamblaje nativo · elemento principal seleccionado','Teste de montagem nativa · objeto principal selecionado'],
  empty:['Cliquer sur un bâtiment pour l’inspecter.','Click a building to inspect it.','点击建筑查看详情。','Haz clic en un edificio para inspeccionarlo.','Clique em um edifício para inspecioná-lo.'],
  pending:['Chargement du bâtiment sélectionné…','Loading selected building…','正在加载所选建筑…','Cargando el edificio seleccionado…','Carregando o edifício selecionado…'],
  missing:['Le bâtiment sélectionné est absent de cette scène.','The selected building is missing from this scene.','此场景中没有所选建筑。','El edificio seleccionado no está en esta escena.','O edifício selecionado não está nesta cena.'],
};
export function urbanProgrammeLabel(kind: 'intent' | 'function' | 'policy' | 'period' | 'state', key: string, fallback: string): string {
  const words = kind === 'function' ? labels[`[data-programme-function="${key}"]`] : choices[{
    intent:'[data-programme-intent]', policy:'[data-programme="mode"]', period:'[data-programme="period"]', state:'[data-condition-state]',
  }[kind]]?.[key];
  return words ? urbanText(words) : fallback;
}

/** Translate existing controls without replacing inputs, selections or drafts. */
export function setupUrbanBuildingLocale(programme: HTMLElement, panel: HTMLElement, silhouettes: boolean): void {
  const summaries = [programme,panel].flatMap(root => Array.from(root.querySelectorAll<HTMLElement>('details > summary')))
    .map(summary => ({summary, words:headings[summary.textContent?.trim() ?? '']})).filter(item => item.words);
  function apply(): void {
    for (const {summary, words} of summaries) summary.textContent = urbanText(words);
    const programTitle = programme.querySelector<HTMLElement>(':scope > summary');
    if (programTitle) programTitle.textContent = silhouettes ? urbanText(['8 · Programme et usages','8 · Program and uses','8 · 规划与用途','8 · Programa y usos','8 · Programa e usos']) : urbanText(['Programme et usages','Program and uses','规划与用途','Programa y usos','Programa e usos']);
    if (!silhouettes) { const title=panel.querySelector<HTMLElement>(':scope > summary'); if(title) title.textContent=urbanText(['Bâtiments','Buildings','建筑','Edificios','Edifícios']); }
    for (const [selector, words] of Object.entries(labels)) for (const control of Array.from(document.querySelectorAll<HTMLElement>(`#urbanProgrammeStage ${selector}, #urbanBuildingStage ${selector}`))) {
      const label=control.closest('label'); if(label?.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent=urbanText(words);
    }
    for (const [selector, entries] of Object.entries(choices)) for (const root of [programme,panel]) for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>(selector))) for (const option of Array.from(select.options)) if(entries[option.value])option.textContent=urbanText(entries[option.value]);
    for (const [selector, words] of Object.entries(buttons)) { const button=programme.querySelector<HTMLElement>(selector) ?? panel.querySelector<HTMLElement>(selector); if(button)button.textContent=urbanText(words); }
    for (const [selector, words] of Object.entries(notes)) { const note=programme.querySelector<HTMLElement>(selector) ?? panel.querySelector<HTMLElement>(selector); if(note)note.textContent=urbanText(words); }
    for (const element of Array.from(panel.querySelectorAll<HTMLElement>('[data-building-i18n]'))) {
      const words=inspection[element.dataset.buildingI18n ?? '']; if(words)element.textContent=urbanText(words);
    }
    if(!silhouettes) {
      const generate=panel.querySelector<HTMLElement>('[data-buildings-generate]'); if(generate)generate.textContent=urbanText(['Implanter les bâtiments','Place buildings','放置建筑','Implantar edificios','Implantar edifícios']);
    }
    const projection=panel.querySelector<HTMLElement>('[data-building-3d]'); if(projection)projection.textContent=silhouettes?urbanText(['Vue 3D','3D view','三维视图','Vista 3D','Visão 3D']):'3D';
    const seed=panel.querySelector<HTMLInputElement>('[data-building-seed]'); if(seed)seed.placeholder=urbanText(['Graine des parcelles','Parcel seed','地块种子','Semilla de parcelas','Semente dos lotes']);
    const floors=panel.querySelector<HTMLInputElement>('[data-building-floors]'); if(floors)floors.placeholder=urbanText(['Selon la recette','According to recipe','按配方','Según la receta','Conforme a receita']);
    const model=panel.querySelector<HTMLInputElement>('[data-building-house-model]'); if(model)model.placeholder=urbanText(['Code replay ou lien du banc Maisons','Replay code or Houses bench link','重放代码或房屋工作台链接','Código de reproducción o enlace del taller de casas','Código de replay ou link da bancada de casas']);
    for(const [selector, words] of [
      ['[data-building-visible]',['Afficher les bâtiments','Show buildings','显示建筑','Mostrar edificios','Mostrar edifícios']],
      ['[data-building-fit]',['Adapter les dimensions au lot','Fit dimensions to the lot','调整尺寸以适应地块','Adaptar dimensiones a la parcela','Ajustar dimensões ao lote']],
      ['[data-programme="navigableAccess"]',['Implanter comme port (quais sur l’eau réelle)','Site as a port (quays on real water)','按港口布局（仅在真实水域建码头）','Implantar como puerto (muelles en agua real)','Implantar como porto (cais em água real)']],
      ['[data-programme-custom-functions]',['Combiner les fonctions du lieu','Combine place functions','组合地点功能','Combinar funciones del lugar','Combinar funções do local']],
    ] as [string, Words][]) { const input=programme.querySelector(selector) ?? panel.querySelector(selector); if(input?.nextSibling?.nodeType===Node.TEXT_NODE)input.nextSibling.textContent=urbanText(words); }
    const functionsLegend=programme.querySelector<HTMLElement>('[data-programme-functions] > legend'); if(functionsLegend)functionsLegend.textContent=urbanText(['Intensité des fonctions · 0 = aucune, 1 = accentuée','Function intensity · 0 = none, 1 = emphasized','功能强度 · 0 = 无，1 = 强调','Intensidad de funciones · 0 = ninguna, 1 = destacada','Intensidade das funções · 0 = nenhuma, 1 = destacada']);
    const placementNote=panel.querySelector('[data-building-typology]')?.closest('details')?.querySelector('small');
    if(placementNote)placementNote.textContent=urbanText(['Un choix incompatible avec le terrain, le lot ou la tradition retourne un refus. Les rues et parcelles sont conservées.','A choice incompatible with terrain, lot or tradition is refused. Streets and parcels are retained.','与地形、地块或传统不兼容的选择会被拒绝。街道和地块将保留。','Una opción incompatible con el terreno, la parcela o la tradición se rechaza. Se conservan las calles y parcelas.','Uma escolha incompatível com o terreno, lote ou tradição é recusada. Ruas e lotes são mantidos.']);
    const importNote=panel.querySelector('[data-building-parent-import]')?.closest('label')?.nextElementSibling;
    if(importNote)importNote.textContent=urbanText(['Import exact, sans réadmission au terrain actuel ; conserve la provenance du plan.','Exact import without readmission to the current terrain; retains plan provenance.','精确导入，不重新按当前地形验证；保留方案来源。','Importación exacta sin readmisión al terreno actual; conserva la procedencia del plan.','Importação exata sem readmissão ao terreno atual; preserva a origem do plano.']);
    const modelNote=panel.querySelector('[data-building-house-model]')?.closest('details')?.querySelector('small');
    if(modelNote)modelNote.textContent=urbanText(['Modèle culturel : les habitats domestiques / mixtes doivent appartenir au pack du replay. Les lots d’un autre pack sont refusés explicitement, y compris dans un lieu à cultures mêlées. Les autres fonctions gardent leur programme. Appliqué uniquement au clic « Implanter les bâtiments ». Preset libre : choisir Fantasy dans Maisons et appliquer le programme Fantasy du lieu ; ses dimensions restent exactes. La graine et le placement restent ceux de la ville.','Cultural model: domestic / mixed housing must belong to the replay pack. Lots from another pack are explicitly refused, including in a mixed-culture place. Other functions retain their program. Applied only when “Place buildings” is clicked. Free preset: select Fantasy in Houses and apply the place’s Fantasy program; its dimensions remain exact. Seed and placement remain those of the city.','文化模型：居住或混合住宅必须属于重放包。其他包的地块会明确拒绝，包括混合文化地点。其他用途保留其规划。仅点击“放置建筑”时应用。自由预设：在房屋中选择奇幻，并应用地点的奇幻规划；尺寸保持精确。种子和位置仍使用城市设置。','Modelo cultural: las viviendas domésticas o mixtas deben pertenecer al paquete de reproducción. Las parcelas de otro paquete se rechazan explícitamente, incluso en lugares con culturas mezcladas. Las demás funciones conservan su programa. Solo se aplica al pulsar «Implantar edificios». Preajuste libre: elige Fantasía en Casas y aplica el programa de fantasía del lugar; sus dimensiones siguen siendo exactas. La semilla y la ubicación son las de la ciudad.','Modelo cultural: moradias domésticas ou mistas devem pertencer ao pacote de replay. Lotes de outro pacote são recusados explicitamente, inclusive em locais de culturas mistas. Outras funções mantêm seu programa. Aplicado apenas ao clicar em “Implantar edifícios”. Predefinição livre: escolha Fantasia em Casas e aplique o programa de fantasia do local; suas dimensões continuam exatas. A semente e o posicionamento permanecem os da cidade.']);
    const navigableNote=programme.querySelector('[data-programme="navigableAccess"]')?.closest('label')?.nextElementSibling;
    if(navigableNote)navigableNote.textContent=urbanText(['Le stockage portuaire n’est alloué que sur un quai mesuré au bord d’un chenal navigable ; ni la case ni la fonction portuaire ne créent d’eau, de chenal ou de route. Un mot inconnu est conservé sans effet.','Port storage is allocated only on a measured quay beside a navigable channel; neither the box nor the port function creates water, a channel or a road. An unknown word is kept with no effect.','港口仓储仅分配在可通航水道旁实测的码头上；此选项和港口功能都不会创建水域、航道或道路。未知词语会保留但无效果。','El almacenamiento portuario solo se asigna en un muelle medido junto a un canal navegable; ni la casilla ni la función portuaria crean agua, canal o camino. Una palabra desconocida se conserva sin efecto.','O armazenamento portuário só é alocado num cais medido junto a um canal navegável; nem a caixa nem a função portuária criam água, canal ou estrada. Uma palavra desconhecida é mantida sem efeito.']);
    const fit=panel.querySelector<HTMLElement>('[data-building-fit]')?.closest('label');
    if(fit)fit.title=urbanText(['En mode inspiré ou fantasy, adapte les corps simples jusqu’à deux fois les dimensions du catalogue. Les modèles exacts et le mode historique strict gardent leurs dimensions.','In inspired or fantasy mode, adapts simple building bodies up to twice catalogue dimensions. Exact models and strict historical mode retain their dimensions.','在灵感或奇幻模式下，简单建筑体量可调整至目录尺寸的两倍。精确模型和严格历史模式保留原尺寸。','En modo inspirado o fantasía, adapta cuerpos simples hasta el doble de las dimensiones del catálogo. Los modelos exactos y el modo histórico estricto conservan sus dimensiones.','Nos modos inspirado ou fantasia, adapta corpos simples até o dobro das dimensões do catálogo. Modelos exatos e o modo histórico estrito mantêm suas dimensões.']);
    const architectureNote=panel.querySelector('[data-building-culture]')?.closest('label')?.nextElementSibling;
    if(architectureNote)architectureNote.textContent=silhouettes ? urbanText(['Emprise proposée par chaque lot (rectangle d’admission, sinon surface constructible). Les maisons détaillées seront réintégrées plus tard.','Footprint proposed by each lot (admission rectangle, otherwise buildable area). Detailed houses will be reintegrated later.','每个地块提出的占地范围（接纳矩形，否则为可建设面积）。详细房屋将在以后重新集成。','Ocupación propuesta por cada parcela (rectángulo de admisión o superficie edificable). Las casas detalladas se reincorporarán más adelante.','Área proposta por cada lote (retângulo de admissão ou área edificável). Casas detalhadas serão reintegradas mais tarde.']) : urbanText(['Ce profil nommé route les bâtiments vers des sources/variantes ; ce n’est ni une recette imposée ni une certification historique. Le plan et les parcelles sont conservés, l’accès et les droits restent requis.','This named profile routes buildings to sources/variants; it is neither a forced recipe nor historical certification. Plan and parcels are retained; access and rights are still required.','此命名配置将建筑分配到来源或变体；它不是强制配方，也不是历史认证。规划和地块会保留，仍需要通道和权利。','Este perfil asigna edificios a fuentes o variantes; no es una receta obligatoria ni una certificación histórica. Se conservan el plan y las parcelas; siguen siendo necesarios el acceso y los derechos.','Este perfil encaminha edifícios para fontes ou variantes; não é uma receita obrigatória nem certificação histórica. Plano e lotes são mantidos; acesso e direitos continuam necessários.']);
    for(const help of Array.from(document.querySelectorAll<HTMLButtonElement>('#urbanProgrammeStage .stage-controls > button:first-child, #urbanBuildingStage .stage-controls > button:first-child'))) { help.title=urbanText(['Méthode et limites','Method and limitations','方法与局限','Método y limitaciones','Método e limitações']);help.setAttribute('aria-label',urbanText(['Lire la note de méthode','Read the method note','阅读方法说明','Leer la nota de método','Ler a nota de método'])); }
  }
  apply();
  window.addEventListener('magna-locale-change',apply);
  window.addEventListener('storage',event=>{if(event.key===LOCALE_KEY)apply();});
}
