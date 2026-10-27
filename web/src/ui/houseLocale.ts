import { installWorkshopLocale, savedLocale, type Locale } from './shellLocale';

// Labels in the architectural form. Runtime-generated catalogue descriptions
// remain in their source language until their own message catalog is migrated.
const fields: Record<string, Record<Locale, string>> = {
  source: {fr:'Parcours',en:'Source',zh:'来源',es:'Fuente',pt:'Origem'},
  'workshop-preset': {fr:'Preset libre',en:'Workshop preset',zh:'工作坊预设',es:'Preajuste del taller',pt:'Predefinição do ateliê'},
  'workshop-width': {fr:'Largeur · m',en:'Width · m',zh:'宽度 · 米',es:'Anchura · m',pt:'Largura · m'},
  'workshop-depth': {fr:'Profondeur · m',en:'Depth · m',zh:'深度 · 米',es:'Profundidad · m',pt:'Profundidade · m'},
  pack: {fr:'Tradition architecturale',en:'Architectural tradition',zh:'建筑传统',es:'Tradición arquitectónica',pt:'Tradição arquitetônica'},
  recipe: {fr:'Type de maison',en:'House type',zh:'房屋类型',es:'Tipo de casa',pt:'Tipo de casa'},
  seed: {fr:'Graine',en:'Seed',zh:'种子',es:'Semilla',pt:'Semente'},
  orientation: {fr:'Orientation',en:'Orientation',zh:'朝向',es:'Orientación',pt:'Orientação'},
  count: {fr:'Maisons',en:'Houses',zh:'房屋数量',es:'Casas',pt:'Casas'},
  mode: {fr:'Contexte',en:'Context',zh:'背景',es:'Contexto',pt:'Contexto'},
  era: {fr:'Époque locale',en:'Local period',zh:'当地时代',es:'Época local',pt:'Época local'},
  variant: {fr:'Variante',en:'Variant',zh:'变体',es:'Variante',pt:'Variante'},
  footprint: {fr:'Plan',en:'Footprint',zh:'平面布局',es:'Planta',pt:'Planta'},
  roof: {fr:'Toiture',en:'Roof',zh:'屋顶',es:'Cubierta',pt:'Telhado'},
  frame: {fr:'Structure porteuse',en:'Load-bearing structure',zh:'承重结构',es:'Estructura portante',pt:'Estrutura de suporte'},
  infill: {fr:'Remplissage',en:'Infill',zh:'填充材料',es:'Relleno',pt:'Vedação'},
  coating: {fr:'Enduit',en:'Coating',zh:'饰面',es:'Revestimiento',pt:'Revestimento'},
  cladding: {fr:'Couverture',en:'Roof covering',zh:'屋面材料',es:'Material de cubierta',pt:'Cobertura'},
  floors: {fr:'Niveaux',en:'Floors',zh:'楼层',es:'Plantas',pt:'Pavimentos'},
  bodies: {fr:'Corps',en:'Building volumes',zh:'建筑体量',es:'Volúmenes',pt:'Volumes'},
  'courtyard-ratio': {fr:'Ratio de cour',en:'Courtyard ratio',zh:'庭院比例',es:'Proporción del patio',pt:'Proporção do pátio'},
  overhang: {fr:'Débord du toit · m',en:'Roof overhang · m',zh:'屋檐伸出 · 米',es:'Alero · m',pt:'Beiral · m'},
  'roof-pitch': {fr:'Pente du toit · °',en:'Roof pitch · °',zh:'屋顶坡度 · °',es:'Pendiente del techo · °',pt:'Inclinação do telhado · °'},
  'site-slope': {fr:'Pente du site · °',en:'Site slope · °',zh:'场地坡度 · °',es:'Pendiente del terreno · °',pt:'Inclinação do terreno · °'},
  level: {fr:'Niveau',en:'Floor',zh:'楼层',es:'Planta',pt:'Pavimento'},
  'detail-level': {fr:'Niveau',en:'Floor',zh:'楼层',es:'Planta',pt:'Pavimento'},
  'workshop-roof-frame': {fr:'Porteur du toit',en:'Roof support',zh:'屋顶支撑',es:'Soporte del techo',pt:'Suporte do telhado'},
  'workshop-base': {fr:'Matériau de base',en:'Base material',zh:'底部材料',es:'Material de base',pt:'Material da base'},
  'workshop-support': {fr:'Support',en:'Support',zh:'支撑',es:'Soporte',pt:'Suporte'},
  'workshop-support-material': {fr:'Matériau des supports',en:'Support material',zh:'支撑材料',es:'Material de los soportes',pt:'Material dos suportes'},
  'workshop-support-height': {fr:'Hauteur du support · m',en:'Support height · m',zh:'支撑高度 · 米',es:'Altura del soporte · m',pt:'Altura do suporte · m'},
};
const buttons: Record<string, Record<Locale, string>> = {
  'reset-overrides': {fr:'Réinitialiser les substitutions',en:'Reset overrides',zh:'重置覆盖设置',es:'Restablecer cambios',pt:'Redefinir substituições'},
  'view-roof': {fr:'Toitures',en:'Roofs',zh:'屋顶',es:'Cubiertas',pt:'Telhados'},
  'view-plan': {fr:'Plan',en:'Plan',zh:'平面图',es:'Plano',pt:'Planta'},
  'detail-view-roof': {fr:'Toitures',en:'Roofs',zh:'屋顶',es:'Cubiertas',pt:'Telhados'},
  'detail-view-plan': {fr:'Plan',en:'Plan',zh:'平面图',es:'Plano',pt:'Planta'},
  'copy-link': {fr:'Lien',en:'Link',zh:'链接',es:'Enlace',pt:'Link'},
  'detail-svg': {fr:'Exporter ce détail',en:'Export this detail',zh:'导出此细节',es:'Exportar este detalle',pt:'Exportar este detalhe'},
  'show-catalogue': {fr:'Explorer le catalogue ↗',en:'Explore the catalogue ↗',zh:'浏览目录 ↗',es:'Explorar el catálogo ↗',pt:'Explorar o catálogo ↗'},
  tour: {fr:'Lancer la tournée',en:'Start the tour',zh:'开始巡览',es:'Iniciar el recorrido',pt:'Iniciar o percurso'},
  'stop-tour': {fr:'Arrêter après ce pack',en:'Stop after this pack',zh:'完成此包后停止',es:'Detener tras este paquete',pt:'Parar após este pacote'},
};

const options: Record<string, Record<string, Record<Locale, string>>> = {
  source: {
    atlas: {fr:'Atlas · traditions sourcées',en:'Atlas · sourced traditions',zh:'图集 · 有来源的传统',es:'Atlas · tradiciones documentadas',pt:'Atlas · tradições documentadas'},
    workshop: {fr:'Atelier libre · primitives',en:'Free workshop · primitives',zh:'自由工作坊 · 基元',es:'Taller libre · primitivas',pt:'Ateliê livre · primitivas'},
  },
  mode: {
    historical_inspired: {fr:'Historique inspiré',en:'Historically inspired',zh:'历史启发',es:'Inspirado en la historia',pt:'Inspirado na história'},
    historical_strict: {fr:'Historique strict · avant 1500',en:'Strict historical · before 1500',zh:'严格历史 · 1500 年以前',es:'Histórico estricto · antes de 1500',pt:'Histórico estrito · antes de 1500'},
    fantasy_mix: {fr:'Fantasy · mélanges libres',en:'Fantasy · free mixing',zh:'奇幻 · 自由混合',es:'Fantasía · mezclas libres',pt:'Fantasia · misturas livres'},
  },
  era: {
    any: {fr:'Toutes les époques admises',en:'All allowed periods',zh:'所有允许的时代',es:'Todas las épocas admitidas',pt:'Todas as épocas permitidas'},
    A: {fr:'Antiquité locale',en:'Local antiquity',zh:'当地古代',es:'Antigüedad local',pt:'Antiguidade local'},
    M: {fr:'Moyen Âge / équivalent local',en:'Middle Ages / local equivalent',zh:'中世纪 / 当地相应时代',es:'Edad Media / equivalente local',pt:'Idade Média / equivalente local'},
  },
  'workshop-support': {
    ground: {fr:'Sol',en:'Ground',zh:'地面',es:'Suelo',pt:'Solo'},
    posts: {fr:'Poteaux',en:'Posts',zh:'柱',es:'Postes',pt:'Postes'},
    piers: {fr:'Piles',en:'Piers',zh:'墩',es:'Pilares',pt:'Pilares'},
    raft: {fr:'Radeau',en:'Raft',zh:'筏',es:'Balsa',pt:'Balsa'},
    rock: {fr:'Roche',en:'Rock',zh:'岩石',es:'Roca',pt:'Rocha'},
  },
};

const generateLabels = {
  fr: ['Générer les maisons ↗', 'Relancer la génération ↗'], en: ['Generate houses ↗', 'Restart generation ↗'],
  zh: ['生成房屋 ↗', '重新生成 ↗'], es: ['Generar casas ↗', 'Reiniciar generación ↗'],
  pt: ['Gerar casas ↗', 'Reiniciar geração ↗'],
} satisfies Record<Locale, readonly [string, string]>;
export function houseGenerateLabel(busy: boolean): string { return generateLabels[savedLocale()][busy ? 1 : 0]; }

const rangeLabels: Record<string, Record<Locale, string>> = {
  size: {fr:'Taille',en:'Size',zh:'大小',es:'Tamaño',pt:'Tamanho'},
  variation: {fr:'Variation',en:'Variation',zh:'变化',es:'Variación',pt:'Variação'},
  wealth: {fr:'Richesse',en:'Wealth',zh:'财富',es:'Riqueza',pt:'Riqueza'},
};

const staticText: Record<string, Record<Locale, string>> = {
  '.masthead .eyebrow': {fr:'ATELIER ARCHITECTURAL',en:'ARCHITECTURE WORKSHOP',zh:'建筑工作坊',es:'TALLER DE ARQUITECTURA',pt:'ATELIÊ DE ARQUITETURA'},
  '.masthead h1': {fr:'Atlas des maisons',en:'House atlas',zh:'房屋图集',es:'Atlas de casas',pt:'Atlas de casas'},
  '.section-title h2': {fr:'Composer un lot',en:'Compose a batch',zh:'组合一批房屋',es:'Componer un lote',pt:'Compor um lote'},
  '#workshop-controls .hint': {fr:'Dimensions absolues. Une valeur vide utilise le preset natif ; une emprise trop étroite est refusée.',en:'Absolute dimensions. An empty value uses the native preset; a footprint that is too narrow is rejected.',zh:'绝对尺寸。留空时使用原生预设；过窄的平面范围将被拒绝。',es:'Dimensiones absolutas. Un valor vacío usa el preajuste nativo; se rechaza una planta demasiado estrecha.',pt:'Dimensões absolutas. Um valor vazio usa a predefinição nativa; uma planta estreita demais é rejeitada.'},
  '#footprint-hint': {fr:'L’organisation de l’ensemble reste celle de la recette. Une substitution non appliquée est refusée.',en:'The overall layout remains that of the recipe. A substitution that cannot be applied is rejected.',zh:'整体布局仍遵循配方。无法应用的替换将被拒绝。',es:'La organización general sigue la receta. Se rechaza una sustitución que no se pueda aplicar.',pt:'A organização geral segue a receita. Uma substituição que não possa ser aplicada é rejeitada.'},
  '#workshop-advanced .hint': {fr:'Un support surélevé exige un matériau porteur et une hauteur déclarée. Le moteur vérifie sa compatibilité.',en:'A raised support requires a load-bearing material and a declared height. The engine checks compatibility.',zh:'抬高的支撑需要承重材料和指定高度。引擎会检查其兼容性。',es:'Un soporte elevado requiere un material portante y una altura declarada. El motor comprueba su compatibilidad.',pt:'Um suporte elevado exige material resistente e altura declarada. O motor verifica a compatibilidade.'},
  '.aside-foot .eyebrow': {fr:'UN ATLAS, PAS UNE RECONSTRUCTION',en:'AN ATLAS, NOT A RECONSTRUCTION',zh:'图集，而非复原',es:'UN ATLAS, NO UNA RECONSTRUCCIÓN',pt:'UM ATLAS, NÃO UMA RECONSTRUÇÃO'},
  '.aside-foot p': {fr:'Plans géométriques en mètres, dérivés des recettes de l’atlas. Les sources et degrés de confiance sont consultables.',en:'Geometric plans in meters, derived from atlas recipes. Sources and confidence levels can be inspected.',zh:'以米为单位的几何平面图，依据图集配方生成。可查看来源和可信度。',es:'Planos geométricos en metros, derivados de las recetas del atlas. Se pueden consultar las fuentes y los grados de confianza.',pt:'Plantas geométricas em metros, derivadas das receitas do atlas. As fontes e os níveis de confiança podem ser consultados.'},
  '.atlas-heading .eyebrow': {fr:'PLANCHE DE GÉNÉRATION',en:'GENERATION SHEET',zh:'生成图版',es:'LÁMINA DE GENERACIÓN',pt:'PRANCHA DE GERAÇÃO'},
  '#detail-dialog .eyebrow': {fr:'DÉTAIL ARCHITECTURAL',en:'ARCHITECTURAL DETAIL',zh:'建筑细节',es:'DETALLE ARQUITECTÓNICO',pt:'DETALHE ARQUITETÔNICO'},
  '#catalogue-dialog .eyebrow': {fr:'SOURCE ET COUVERTURE',en:'SOURCES AND COVERAGE',zh:'来源与覆盖范围',es:'FUENTES Y COBERTURA',pt:'FONTES E COBERTURA'},
  '#catalogue-dialog h2': {fr:'Catalogue architectural',en:'Architecture catalogue',zh:'建筑目录',es:'Catálogo arquitectónico',pt:'Catálogo arquitetônico'},
  '#link-dialog h2': {fr:'Lien rejouable',en:'Replayable link',zh:'可重现链接',es:'Enlace reproducible',pt:'Link reproduzível'},
  '#link-dialog p': {fr:'Copiez le lien. Il conserve les réglages du lot affiché et les options de vue.',en:'Copy the link. It retains the displayed batch settings and view options.',zh:'复制链接。链接保留当前批次设置和视图选项。',es:'Copia el enlace. Conserva los ajustes del lote mostrado y las opciones de vista.',pt:'Copie o link. Ele mantém as configurações do lote exibido e as opções de visualização.'},
};

const checkLabels: Record<string, Record<Locale, string>> = {
  'allow-late': {fr:'Autoriser les profils tardifs L',en:'Allow late L profiles',zh:'允许晚期 L 类型',es:'Permitir perfiles tardíos L',pt:'Permitir perfis tardios L'},
  graph: {fr:'Accès',en:'Access',zh:'出入口',es:'Accesos',pt:'Acessos'},
  dimensions: {fr:'Cotes',en:'Dimensions',zh:'尺寸',es:'Cotas',pt:'Dimensões'},
};

export function setupHouseLocale(): void {
  function apply(locale: Locale): void {
    for (const [id, translations] of Object.entries(fields)) {
      const label = document.getElementById(id)?.closest('label');
      const node = label?.firstChild;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = translations[locale];
    }
    for (const [id, translations] of Object.entries(buttons)) {
      const button = document.getElementById(id);
      if (button) button.textContent = translations[locale];
    }
    for (const [id, values] of Object.entries(options)) {
      const select = document.getElementById(id) as HTMLSelectElement | null;
      for (const option of Array.from(select?.options ?? [])) {
        const translation = values[option.value];
        if (translation) option.textContent = translation[locale];
      }
    }
    for (const [id, translations] of Object.entries(rangeLabels)) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
      if (label?.firstChild?.nodeType === Node.TEXT_NODE) label.firstChild.textContent = `${translations[locale]} `;
    }
    for (const [selector, translations] of Object.entries(staticText)) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.textContent = translations[locale];
    }
    for (const [id, translations] of Object.entries(checkLabels)) {
      const input = document.getElementById(id);
      const node = input?.nextSibling;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = translations[locale];
    }
    const generate = document.getElementById('generate');
    if (generate) generate.textContent = generateLabels[locale][generate.dataset.busy === 'true' ? 1 : 0];
  }
  const header = document.querySelector('header');
  if (header) installWorkshopLocale(header, apply);
}
