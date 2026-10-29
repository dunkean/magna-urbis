import { savedLocale, type Locale } from './shellLocale';
type Words = Record<Locale, string>;
const messages = {
  exportButton: {fr:'Copier code',en:'Copy code',zh:'复制代码',es:'Copiar código',pt:'Copiar código'},
  importButton: {fr:'Coller code',en:'Paste code',zh:'粘贴代码',es:'Pegar código',pt:'Colar código'},
  exportTitle: {fr:'Copier le code unique de cette carte',en:'Copy this map’s unique code',zh:'复制此地图的唯一代码',es:'Copiar el código único de este mapa',pt:'Copiar o código único deste mapa'},
  titleExport: {fr:'Code de génération',en:'Generation code',zh:'地图唯一代码',es:'Código único del mapa',pt:'Código único do mapa'},
  titleImport: {fr:'Coller le code d’une carte',en:'Paste a map code',zh:'粘贴地图代码',es:'Pegar el código de un mapa',pt:'Colar o código de um mapa'},
  close: {fr:'Fermer',en:'Close',zh:'关闭',es:'Cerrar',pt:'Fechar'},
  code: {fr:'Code de la recette',en:'Recipe code',zh:'配方代码',es:'Código de la receta',pt:'Código da receita'},
  copy: {fr:'Copier le code',en:'Copy code',zh:'复制代码',es:'Copiar código',pt:'Copiar código'},
  download: {fr:'Télécharger .murecipe',en:'Download .murecipe',zh:'下载 .murecipe',es:'Descargar .murecipe',pt:'Baixar .murecipe'},
  load: {fr:'Charger la recette',en:'Load recipe',zh:'加载配方',es:'Cargar receta',pt:'Carregar receita'},
  choose: {fr:'Choisir un fichier',en:'Choose a file',zh:'选择文件',es:'Elegir archivo',pt:'Escolher arquivo'},
  preparing: {fr:'Préparation du code…',en:'Preparing code…',zh:'正在准备代码…',es:'Preparando código…',pt:'Preparando código…'},
  copied: {fr:'Code copié.',en:'Code copied.',zh:'代码已复制。',es:'Código copiado.',pt:'Código copiado.'},
  copyManually: {fr:'Copiez le texte sélectionné (Ctrl+C).',en:'Copy the selected text (Ctrl+C).',zh:'复制选中的文本（Ctrl+C）。',es:'Copia el texto seleccionado (Ctrl+C).',pt:'Copie o texto selecionado (Ctrl+C).'},
  downloaded: {fr:'Fichier téléchargé · il contient le même code.',en:'File downloaded · it contains the same code.',zh:'文件已下载 · 内容为相同代码。',es:'Archivo descargado · contiene el mismo código.',pt:'Arquivo baixado · contém o mesmo código.'},
  loading: {fr:'Chargement de la recette et reconstruction de la carte…',en:'Loading recipe and reconstructing the map…',zh:'正在加载配方并重建地图…',es:'Cargando la receta y reconstruyendo el mapa…',pt:'Carregando a receita e reconstruindo o mapa…'},
  fileTooLarge: {fr:'Fichier trop volumineux.',en:'File is too large.',zh:'文件过大。',es:'El archivo es demasiado grande.',pt:'O arquivo é grande demais.'},
  embedded: {fr:'terrain intégré',en:'embedded terrain',zh:'内嵌地形',es:'terreno integrado',pt:'terreno incorporado'},
  reproducible: {fr:'terrain reproductible',en:'reproducible terrain',zh:'可重现地形',es:'terreno reproducible',pt:'terreno reproduzível'},
  settings: {fr:'réglages, pins et vue',en:'settings, pins and view',zh:'设置、标记和视图',es:'ajustes, marcadores y vista',pt:'configurações, marcadores e visualização'},
  characters: {fr:'caractères',en:'characters',zh:'字符',es:'caracteres',pt:'caracteres'},
  generationHint: {fr:'La ville sera recalculée. Pour conserver les résultats, utilisez l’export complet .decor.',en:'The city will be regenerated. Use the complete .decor export to preserve results.',zh:'城市将重新生成。请使用完整 .decor 导出以保留结果。',es:'La ciudad se regenerará. Usa la exportación completa .decor para conservar los resultados.',pt:'A cidade será regenerada. Use a exportação completa .decor para preservar os resultados.'},
  tooLarge: {fr:'Carte trop volumineuse pour un code (format limité à 1 Mo). Utilisez le partage .decor avec enregistrement direct sur disque.',en:'Map too large for a code (format limit: 1 MB). Use .decor sharing with direct disk saving.',zh:'地图过大，无法生成代码（格式限制为 1 MB）。请使用 .decor 分享并直接保存到磁盘。',es:'Mapa demasiado grande para un código (límite: 1 MB). Usa .decor y guarda directamente en disco.',pt:'Mapa grande demais para um código (limite: 1 MB). Use o compartilhamento .decor com gravação direta em disco.'},
} satisfies Record<string, Words>;
export type RecipeMessage = keyof typeof messages;
export function recipeText(key: RecipeMessage): string { return messages[key][savedLocale()]; }

// Codec errors remain stable for callers; translate known messages at the UI boundary.
const errors: Record<string, Words> = {
  'Atelier inconnu.': {fr:'Atelier inconnu.',en:'Unknown workshop.',zh:'未知工作坊。',es:'Taller desconocido.',pt:'Ateliê desconhecido.'},
  'Recette trop volumineuse (1 Mo maximum).': {fr:'Recette trop volumineuse (1 Mo maximum).',en:'Recipe too large (1 MB maximum).',zh:'配方过大（最多 1 MB）。',es:'Receta demasiado grande (máximo 1 MB).',pt:'Receita grande demais (máximo de 1 MB).'},
  'Code invalide : collez un code MU2.…': {fr:'Code invalide : collez un code MU2.…',en:'Invalid code: paste a MU2.… code.',zh:'代码无效：请粘贴 MU2.… 代码。',es:'Código no válido: pega un código MU2.…',pt:'Código inválido: cole um código MU2.…'},
  'Code trop volumineux.': {fr:'Code trop volumineux.',en:'Code is too large.',zh:'代码过大。',es:'El código es demasiado grande.',pt:'O código é grande demais.'},
  'Code incomplet, corrompu ou trop volumineux.': {fr:'Code incomplet, corrompu ou trop volumineux.',en:'Code is incomplete, corrupted or too large.',zh:'代码不完整、已损坏或过大。',es:'El código está incompleto, dañado o es demasiado grande.',pt:'O código está incompleto, corrompido ou é grande demais.'},
  'Attendez le chargement du terrain conservé.': {fr:'Attendez le chargement du terrain conservé.',en:'Wait for the retained terrain to load.',zh:'请等待保存的地形加载完成。',es:'Espera a que se cargue el terreno guardado.',pt:'Aguarde o carregamento do terreno salvo.'},
  'Délai dépassé pendant la reconstruction du terrain.': {fr:'Délai dépassé pendant la reconstruction du terrain.',en:'Terrain reconstruction timed out.',zh:'地形重建超时。',es:'Se agotó el tiempo de reconstrucción del terreno.',pt:'O tempo de reconstrução do terreno se esgotou.'},
  'Le terrain intégré ne correspond pas à la recette.': {fr:'Le terrain intégré ne correspond pas à la recette.',en:'The embedded terrain does not match the recipe.',zh:'内嵌地形与配方不匹配。',es:'El terreno integrado no coincide con la receta.',pt:'O terreno incorporado não corresponde à receita.'},
  'Terrain conservé absent du code.': {fr:'Terrain conservé absent du code.',en:'The retained terrain is missing from the code.',zh:'代码中缺少保存的地形。',es:'Falta el terreno guardado en el código.',pt:'O terreno salvo está ausente do código.'},
  'Export complet du décor avec parents non pris en charge : utilisez l’export natif dans Bâtiments.': {fr:'Export complet du décor avec parents non pris en charge : utilisez l’export natif dans Bâtiments.',en:'Full decor export with parents is not supported; use the native export in Buildings.',zh:'不支持导出包含父级的完整场景；请在建筑中使用原生导出。',es:'No se admite la exportación completa del decorado con sus elementos padre; usa la exportación nativa en Edificios.',pt:'A exportação completa do cenário com elementos pais não é suportada; use a exportação nativa em Edifícios.'},
};
export function translateRecipeError(message: string): string { return errors[message]?.[savedLocale()] ?? message; }
