import { LOCALE_KEY, savedLocale, type Locale } from './shellLocale';
type Words = readonly [string, string, string, string, string];
const languages: Locale[] = ['fr', 'en', 'zh', 'es', 'pt'];
const fields: Record<string, Words> = {
  setCulture:['Culture','Culture','文化','Cultura','Cultura'],
  setMode:['Composition','Composition','组合方式','Composición','Composição'],
  setDistribution:['Distribution','Distribution','分布','Distribución','Distribuição'],
  setMainPop:['Population principale','Main population','主要聚落人口','Población principal','População principal'],
};
const settings: Record<string, Words> = {
  density:['Densité ×','Density ×','密度 ×','Densidad ×','Densidade ×'],
  zipfExponent:['Exposant rang-taille q','Rank-size exponent q','位序规模指数 q','Exponente rango-tamaño q','Expoente posição-tamanho q'],
  minPopulation:['Plus petit lieu','Smallest place','最小聚落','Lugar más pequeño','Menor povoado'],
  populationJitter:['Dispersion des populations','Population spread','人口离散度','Dispersión de población','Dispersão populacional'],
  spread:['Espacement ×','Spacing ×','间距 ×','Separación ×','Espaçamento ×'],
  mainClear:['Distance du lieu principal × rayon','Main settlement clearance × radius','主要聚落间距 × 半径','Separación del asentamiento principal × radio','Distância do povoado principal × raio'],
  clustering:['Regroupement','Clustering','聚集','Agrupamiento','Agrupamento'],
  edgeMargin:['Marge au bord (part de la largeur)','Border margin (share of width)','边界留白（宽度比例）','Margen del borde (proporción de anchura)','Margem da borda (fração da largura)'],
  flatnessWeight:['Terrain plat','Flat ground','平坦地形','Terreno llano','Terreno plano'],
  buildableWeight:['Terrain constructible','Buildable land','可建设土地','Terreno edificable','Terreno edificável'],
  freshWaterWeight:['Eau douce','Fresh water','淡水','Agua dulce','Água doce'],
  riverWeight:['Accès aux rivières','River access','河流可达性','Acceso al río','Acesso ao rio'],
  coastWeight:['Côte et ports','Coast & harbors','海岸与港口','Costa y puertos','Costa e portos'],
  floodWeight:['Éviter les inondations','Flood avoidance','避开洪水','Evitar inundaciones','Evitar inundações'],
  defenseWeight:['Hauteurs défensives','Defensible heights','防御高地','Alturas defendibles','Alturas defensáveis'],
  elevation:['Altitude (−1 basse · +1 haute)','Elevation (−1 low · +1 high)','海拔（−1 低 · +1 高）','Altitud (−1 baja · +1 alta)','Altitude (−1 baixa · +1 alta)'],
  variationWeight:['Variation de graine','Seed variation','种子变化','Variación de semilla','Variação da semente'],
};
const checks: Record<string, Words> = {
  setEnabled:['Générer les établissements','Generate settlements','生成聚落','Generar asentamientos','Gerar povoamentos'],
  setAutoRefresh:['Régénération automatique des établissements et routes','Automatically regenerate settlements and roads','自动重新生成聚落和道路','Regenerar asentamientos y caminos automáticamente','Regenerar povoados e estradas automaticamente'],
  setShowPoints:['Repères et noms des établissements','Settlement markers & names','聚落标记与名称','Marcadores y nombres de asentamientos','Marcadores e nomes dos povoados'],
};
const buttons: Record<string, Words> = {
  setRefresh:['Appliquer et recalculer les établissements','Apply and recalculate settlements','应用并重新计算聚落','Aplicar y recalcular asentamientos','Aplicar e recalcular povoados'],
  setGenerate:['Recalculer les établissements','Recalculate settlements','重新计算聚落','Recalcular asentamientos','Recalcular povoados'],
  setTakeOver:['Modifier la liste générée','Edit generated list','编辑生成的列表','Editar lista generada','Editar lista gerada'],
  setExportDecor:['Exporter le décor','Export decor','导出场景','Exportar decorado','Exportar cenário'],
};
const choices: Record<string, Record<string, Words>> = {
  setMode: {
    auto:['Automatique','Automatic','自动','Automático','Automático'],
    counts:['Par nombre de classes','By class counts','按类别数量','Por número de cada clase','Por contagem de classes'],
    list:['Liste modifiable','Editable list','可编辑列表','Lista editable','Lista editável'],
  },
  setDistribution: {
    zipf:['Rang-taille (Zipf)','Rank-size (Zipf)','位序规模（Zipf）','Rango-tamaño (Zipf)','Posição-tamanho (Zipf)'],
    classes:['Tranches par classe','Class bands','类别分段','Bandas por clase','Faixas por classe'],
  },
};
export function setupSettlementLocale(panel: HTMLElement, city: boolean): void {
  function apply(locale: Locale): void {
    const i = languages.indexOf(locale);
    for (const [id, words] of Object.entries(fields)) {
      const node = document.getElementById(id)?.closest('label')?.firstChild;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = words[i] + ' ';
    }
    for (const [key, words] of Object.entries(settings)) {
      const node = panel.querySelector('[data-setting="' + key + '"]')?.closest('label')?.firstChild;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = words[i];
    }
    for (const [id, words] of Object.entries(checks)) {
      const node = document.getElementById(id)?.nextSibling;
      if (node?.nodeType === Node.TEXT_NODE) node.textContent = words[i];
    }
    for (const [id, words] of Object.entries(buttons)) {
      // City uses this button for placement search, with state-dependent wording.
      if (city && id === 'setGenerate') continue;
      const button = document.getElementById(id);
      if (button) button.textContent = words[i];
    }
    for (const [id, entries] of Object.entries(choices)) {
      const select = document.getElementById(id) as HTMLSelectElement | null;
      for (const option of Array.from(select?.options ?? [])) if (entries[option.value]) option.textContent = entries[option.value][i];
    }
    const headings = panel.querySelectorAll<HTMLElement>('.map-detail > details.advanced > summary');
    const labels: Words[] = [
      ['Espacement','Spacing','间距','Separación','Espaçamento'],
      ['Géographie','Geography','地理','Geografía','Geografia'],
      ['Types de sites','Site types','选址类型','Tipos de sitio','Tipos de local'],
    ];
    headings.forEach((heading, index) => { if (labels[index]) heading.textContent = labels[index][i]; });
  }
  apply(savedLocale());
  window.addEventListener('magna-locale-change', () => apply(savedLocale()));
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) apply(savedLocale()); });
}
