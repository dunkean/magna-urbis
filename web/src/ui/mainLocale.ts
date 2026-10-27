import { LOCALE_KEY, resolveLocale, savedLocale, type Locale } from './shellLocale';

// Static controls; dynamically generated settlement summaries and map data are
// translated separately when their message sources have been migrated.
const translations: Record<string, readonly [string, string, string, string, string]> = {
  '#newMap .lbl': ['Nouvelle carte','New map','新地图','Nuevo mapa','Novo mapa'],
  '#surprise .lbl': ['Surprise','Surprise','随机生成','Sorpresa','Surpresa'],
  '#menuBtn .lbl': ['Personnaliser','Customize','自定义','Personalizar','Personalizar'],
  '#settingsTitle': ['Personnaliser','Customize','自定义','Personalizar','Personalizar'],
  '#environmentTab': ['Monde','World','世界','Mundo','Mundo'],
  '#settlementsTab': ['Établissements','Settlements','聚落','Asentamientos','Povoamentos'],
  '#appearanceTab': ['Apparence','Look','外观','Aspecto','Aparência'],
  '#sec-pins summary .lbl': ['Repères','Pins','标记','Marcadores','Marcadores'],
  '#quickShare summary .lbl': ['Partager et exporter','Share & export','分享与导出','Compartir y exportar','Compartilhar e exportar'],
  '#pinModeBtn': ['Mode repère','Pin mode','标记模式','Modo marcador','Modo marcador'],
  '#pinsClear': ['Tout effacer','Clear all','全部清除','Borrar todo','Limpar tudo'],
  '#copyId': ['Copier l’identifiant','Copy ID','复制 ID','Copiar ID','Copiar ID'],
  '#copyLink': ['Copier le lien','Copy link','复制链接','Copiar enlace','Copiar link'],
  '#copyBug': ['Copier le rapport de bug','Copy bug report','复制错误报告','Copiar informe de error','Copiar relatório de erro'],
  '#openId': ['Ouvrir','Open','打开','Abrir','Abrir'],
  '#exportSvg': ['Exporter SVG','Export SVG','导出 SVG','Exportar SVG','Exportar SVG'],
  '#exportPng': ['Exporter PNG','Export PNG','导出 PNG','Exportar PNG','Exportar PNG'],
  '#exportJson': ['Exporter JSON','Export JSON','导出 JSON','Exportar JSON','Exportar JSON'],
  '#exportSvgFull': ['SVG, tous les quartiers (lent)','SVG, all quarters (slow)','SVG，所有街区（慢）','SVG, todos los barrios (lento)','SVG, todos os bairros (lento)'],
  '#shareControls > h3:first-of-type': ['Identifiant de carte','Map ID','地图 ID','ID del mapa','ID do mapa'],
  '#shareControls > h3:nth-of-type(2)': ['Télécharger','Download','下载','Descargar','Baixar'],
  '#exportLayers .hint': ['Combinez librement les calques. Désactivez le fond papier pour la transparence. Le relief comprend une image de terrain pleine. Le JSON contient toujours toutes les données du monde.','Combine layers freely. Turn off Paper background for transparency. Relief includes a filled terrain image. JSON always contains all world data.','可自由组合图层。关闭纸张背景以获得透明效果。地形包含填充的地形图像。JSON 始终包含所有世界数据。','Combina las capas libremente. Desactiva el fondo de papel para obtener transparencia. El relieve incluye una imagen de terreno rellena. JSON siempre contiene todos los datos del mundo.','Combine as camadas livremente. Desative o fundo de papel para obter transparência. O relevo inclui uma imagem de terreno preenchida. O JSON sempre contém todos os dados do mundo.'],
  '#sec-pins .hint': ['Les repères et la vue sont enregistrés uniquement dans le lien ; ils ne modifient jamais la carte.','Pins and the view are saved in the link only; they never change the map.','标记和视图仅保存在链接中；它们不会改变地图。','Los marcadores y la vista solo se guardan en el enlace; nunca cambian el mapa.','Os marcadores e a visualização são salvos apenas no link; nunca alteram o mapa.'],
  '#dice': ['Aléatoire','Random','随机','Aleatorio','Aleatório'],
  '#generateEnvironment': ['Générer seulement le terrain','Generate terrain only','仅生成地形','Generar solo el terreno','Gerar somente o terreno'],
  '#sec-terrain details > summary': ['Importer un terrain','Import terrain','导入地形','Importar terreno','Importar terreno'],
  '#hmImport': ['Importer une carte d’altitude (PNG/JPG)','Import heightmap (PNG/JPG)','导入高度图（PNG/JPG）','Importar mapa de alturas (PNG/JPG)','Importar mapa de elevação (PNG/JPG)'],
  '#hmClear': ['Retirer','Remove','移除','Quitar','Remover'],
  'label[for="hmScale"]': ['Échelle verticale (m, pixel blanc)','Vertical scale (m, white pixel)','垂直比例（米，白色像素）','Escala vertical (m, píxel blanco)','Escala vertical (m, pixel branco)'],
  'label[for="hmSea"]': ['Niveau de la mer (m)','Sea level (m)','海平面（米）','Nivel del mar (m)','Nível do mar (m)'],
  '#autoGenerate': ['Générer les lieux','Generate places','生成地点','Generar lugares','Gerar lugares'],
  '#placesTitle': ['Lieux','Places','地点','Lugares','Lugares'],
  '#settlClear': ['Recommencer','Start from scratch','从头开始','Empezar de cero','Começar do zero'],
  '#settlAdd': ['+ Ajouter un lieu','+ Add a place','+ 添加地点','+ Añadir lugar','+ Adicionar local'],
  '#inheritTheme': ['Revenir aux réglages généraux','Reset to general','恢复通用设置','Restablecer ajustes generales','Restaurar configurações gerais'],
  '#mapInfoTitle': ['Carte et légende','Map info & legend','地图信息与图例','Información y leyenda','Informações e legenda'],
  '#mapInfoDialog .hint': ['Le titre et les symboles de la carte affichée.','The title and symbols of the displayed map.','当前地图的标题和符号。','El título y los símbolos del mapa mostrado.','O título e os símbolos do mapa exibido.'],
  '#closeMapInfo': ['Fermer','Close','关闭','Cerrar','Fechar'],
  '#generateSettlements': ['Appliquer et générer','Apply & generate','应用并生成','Aplicar y generar','Aplicar e gerar'],
  '#cancelPlacement': ['Annuler','Cancel','取消','Cancelar','Cancelar'],
  '#coordCopy': ['Copier','Copy','复制','Copiar','Copiar'],
  '#sec-map > .hint': ['Le style et les calques modifient immédiatement la carte (les points à droite changent le style en un clic).','Style and layers update the map immediately (the dots on the right rail switch style in one click).','样式和图层会立即更新地图（右侧按钮可一键切换样式）。','El estilo y las capas actualizan el mapa de inmediato (los puntos de la derecha cambian el estilo con un clic).','O estilo e as camadas atualizam o mapa imediatamente (os pontos à direita mudam o estilo com um clique).'],
  '#sec-map > .sub': ['Calques','Layers','图层','Capas','Camadas'],
  '#sec-plan > summary': ['Styles, plan et monuments','Style mix, layout & landmarks','风格、布局和地标','Estilos, trazado y monumentos','Estilos, traçado e marcos'],
  '#exportLayers legend': ['Calques SVG / PNG','SVG / PNG layers','SVG / PNG 图层','Capas SVG / PNG','Camadas SVG / PNG'],
  'label[for="exportPreset"]': ['Sélection','Selection','选择','Selección','Seleção'],
  'label[for="seed"]': ['Graine','Seed','种子','Semilla','Semente'],
  'label[for="biome"]': ['Biome','Biome','生物群系','Bioma','Bioma'],
  'label[for="relief"]': ['Relief','Relief','地形','Relieve','Relevo'],
  'label[for="mapSize"]': ['Étendue (m)','Extent (m)','范围（米）','Extensión (m)','Extensão (m)'],
  'label[for="coast"]': ['Côte','Coast','海岸','Costa','Costa'],
  'label[for="river"]': ['Rivières','Rivers','河流','Ríos','Rios'],
  'label[for="seaLevel"]': ['Niveau de l’eau côtière','Coastal water level','沿海水位','Nivel del agua costera','Nível da água costeira'],
  'label[for="autoPop"]': ['Population cible','Target population','目标人口','Población objetivo','População alvo'],
  'label[for="settlName"]': ['Nom','Name','名称','Nombre','Nome'],
  'label[for="size"]': ['Type','Type','类型','Tipo','Tipo'],
  'label[for="population"]': ['Population','Population','人口','Población','População'],
  'label[for="language"]': ['Noms des lieux','Place names','地点名称','Nombres de lugares','Nomes dos locais'],
  'label[for="siteType"]': ['Site','Site','地点','Sitio','Local'],
  'label[for="roads"]': ['Sorties des routes régionales','Regional road exits','区域道路出口','Salidas de caminos regionales','Saídas das estradas regionais'],
  '#themeTitle': ['Général','General','常规','General','Geral'],
  '#sec-settlement .auto-block > .hint': ['Une ville de cette taille entourée de villages, hameaux et fermes. Ou ajoutez les lieux un par un ci-dessous.','A town of this size, with its villages, hamlets and farms placed around it. Or add the places one by one below.','在城镇周围放置村庄、聚落和农场。也可以在下方逐个添加地点。','Una ciudad de este tamaño, rodeada de aldeas, caseríos y granjas. También puedes añadir lugares uno por uno.','Uma cidade deste tamanho, cercada por vilas, povoados e fazendas. Ou adicione locais um a um abaixo.'],
  '#sec-plan .sub': ['Plan et monuments','Layout & landmarks','布局与地标','Trazado y monumentos','Traçado e marcos'],
  'label[for="style"]': ['Style','Style','样式','Estilo','Estilo'],
  '#paintedTextures + span': ['Textures naturelles peintes','Painted natural textures','绘制的自然纹理','Texturas naturales pintadas','Texturas naturais pintadas'],
  '#contours + span': ['Courbes de niveau','Contour lines','等高线','Curvas de nivel','Curvas de nível'],
  '#landuse + span': ['Occupation du sol (champs, bois…)','Land use (fields, woods...)','土地利用（田地、林地等）','Uso del suelo (campos, bosques...)','Uso do solo (campos, bosques...)'],
  '#labels + span': ['Noms','Names (labels)','名称','Nombres','Nomes'],
  '#legend + span': ['Légende','Legend','图例','Leyenda','Legenda'],
};
const locales: Locale[] = ['fr', 'en', 'zh', 'es', 'pt'];
type Words = readonly [string, string, string, string, string];
const dynamicMessages: Record<string, Words> = {
  reading:['Lecture de la carte d’altitude…','Reading heightmap...','正在读取高度图…','Leyendo el mapa de alturas…','Lendo o mapa de elevação…'],
  imageError:['Impossible de lire l’image : ','Could not read the image: ','无法读取图像：','No se pudo leer la imagen: ','Não foi possível ler a imagem: '],
  generated:['Généré en','Generated in','生成耗时','Generado en','Gerado em'],
  developer:['Développeur · étape','Developer · stage','开发者 · 阶段','Desarrollador · etapa','Desenvolvedor · etapa'],
  generating:['Génération','Generating','正在生成','Generando','Gerando'],
  generationFailed:['Échec de la génération','Generation failed','生成失败','Falló la generación','Falha na geração'],
  renderingFailed:['Échec du rendu','Rendering failed','渲染失败','Falló el renderizado','Falha na renderização'],
  rendererStopped:['Rendu interrompu','Renderer stopped','渲染器已停止','Renderizador detenido','Renderizador interrompido'],
  workerFailed:['Un worker a échoué','A worker failed','工作线程失败','Falló un proceso de trabajo','Um processo de trabalho falhou'],
  workerHelp:['Rechargez la page ou ajoutez ?render=main à l’adresse.','Reload the page, or add ?render=main to the address.','请重新加载页面，或在地址中添加 ?render=main。','Recarga la página o añade ?render=main a la dirección.','Recarregue a página ou adicione ?render=main ao endereço.'],
  error:['Erreur : ','Error: ','错误：','Error: ','Erro: '],
  changesApply:['Les modifications s’appliquent à la génération.','Changes apply when you generate.','更改将在生成时应用。','Los cambios se aplican al generar.','As alterações são aplicadas ao gerar.'],
  unapplied:['Modifications non appliquées','Unapplied changes','未应用的更改','Cambios sin aplicar','Alterações não aplicadas'],
  draft:['Modifications non appliquées dans Personnaliser','Unapplied changes in Customize','自定义中有未应用的更改','Cambios sin aplicar en Personalizar','Alterações não aplicadas em Personalizar'],
  invalid:['Corrigez les valeurs signalées avant de générer.','Check the highlighted values before generating.','生成前请检查标出的数值。','Comprueba los valores señalados antes de generar.','Verifique os valores destacados antes de gerar.'],
  coordinates:['Saisissez les deux coordonnées ou effacez-les pour le placement automatique.','Enter both position coordinates, or clear both for automatic placement.','请输入两个位置坐标，或将两者清空以自动放置。','Introduce ambas coordenadas o borra ambas para la colocación automática.','Informe as duas coordenadas ou apague ambas para posicionamento automático.'],
  copyFailed:['Échec de la copie','Copy failed','复制失败','Error al copiar','Falha ao copiar'],
  idCopied:['Identifiant copié','ID copied','ID 已复制','ID copiado','ID copiado'],
  linkCopied:['Lien copié','Link copied','链接已复制','Enlace copiado','Link copiado'],
  reportCopied:['Rapport copié','Report copied','报告已复制','Informe copiado','Relatório copiado'],
  customHeight:['carte d’altitude personnalisée (non incluse dans le lien)','custom heightmap (not included in the link)','自定义高度图（不包含在链接中）','mapa de alturas personalizado (no incluido en el enlace)','mapa de elevação personalizado (não incluído no link)'],
  missingHeight:['ce lien utilisait une carte d’altitude personnalisée : importez-la à nouveau pour reproduire la carte','this link used a custom heightmap: import it again to reproduce the map','此链接使用了自定义高度图：请重新导入以重现地图','este enlace usaba un mapa de alturas personalizado: impórtalo de nuevo para reproducir el mapa','este link usava um mapa de elevação personalizado: importe-o novamente para reproduzir o mapa'],
  invalidId:['Ce n’est pas un identifiant ou lien Magna Urbis.','This is not a Magna Urbis ID or link.','这不是 Magna Urbis ID 或链接。','No es un ID o enlace de Magna Urbis.','Este não é um ID ou link do Magna Urbis.'],
  copied:['Copié','Copied','已复制','Copiado','Copiado'], failed:['Échec','Failed','失败','Falló','Falhou'], copy:['Copier','Copy','复制','Copiar','Copiar'],
  exported:['Exporté','Exported','已导出','Exportado','Exportado'], exportFailed:['Échec de l’export : ','Export failed: ','导出失败：','Error al exportar: ','Falha na exportação: '],
  starting:['démarrage','starting','启动','inicio','início'], terrain:['terrain','terrain','地形','terreno','terreno'], 'site & roads':['site et routes','site & roads','地点与道路','sitio y caminos','local e estradas'], town:['ville','town','城镇','ciudad','cidade'], settlements:['établissements','settlements','聚落','asentamientos','povoados'], villages:['villages','villages','村庄','aldeas','vilas'], 'fields & woods':['champs et bois','fields & woods','田地与林地','campos y bosques','campos e bosques'], names:['noms','names','名称','nombres','nomes'], drawing:['dessin','drawing','绘制','dibujo','desenho'],
  urban:['urbain','urban','城市','urbano','urbano'], rivers:['rivières','rivers','条河流','ríos','rios'], lakes:['lacs','lakes','个湖泊','lagos','lagos'], sea:['mer','sea','海洋','mar','mar'], roads:['routes','roads','条道路','caminos','estradas'], bridges:['ponts','bridges','座桥','puentes','pontes'], population:['population','population','人口','población','população'], blocks:['îlots','blocks','个街区','manzanas','quadras'], buildings:['bâtiments','buildings','栋建筑','edificios','edifícios'], megaPlan:['plan de mégapole','megacity plan','大都市规划','plan de megaciudad','plano de megacidade'], quarters:['quartiers','quarters','个街区','barrios','bairros'], rings:['anneaux','rings','个环','anillos','anéis'], nuclei:['noyaux','nuclei','个核心','núcleos','núcleos'], zoomDetail:['zoomez pour détailler les quartiers','zoom in to detail the quarters','放大以查看街区细节','acerca para detallar los barrios','aproxime para detalhar os bairros'],
  position:['Position','Position','位置','Posición','Posição'], autoSite:['Automatique (selon le site)','Automatic (by site)','自动（根据地点）','Automático (según el sitio)','Automático (conforme o local)'], autoSiteHelp:['Laisser le générateur choisir le meilleur endroit pour le site','Let the generator find the best spot for the chosen site','让生成器为所选地点寻找最佳位置','Dejar que el generador busque el mejor lugar para el sitio','Deixar o gerador encontrar o melhor ponto para o local'],
  pickMap:['Cliquer sur la carte','Click on the map','点击地图','Haz clic en el mapa','Clique no mapa'], pickingMap:['Cliquer sur la carte… (Échap)','Click the map… (Esc)','点击地图…（Esc）','Haz clic en el mapa… (Esc)','Clique no mapa… (Esc)'], pickHelp:['Cliquer sur la carte pour placer ce lieu','Click the map where this place should be','点击地图以放置此地点','Haz clic en el mapa donde debe estar este lugar','Clique no mapa onde este local deve ficar'],
  positionX:['Position x du lieu choisi (m)','Selected place x (m)','所选地点 x 坐标（米）','Posición x del lugar seleccionado (m)','Posição x do local selecionado (m)'], positionY:['Position y du lieu choisi (m)','Selected place y (m)','所选地点 y 坐标（米）','Posición y del lugar seleccionado (m)','Posição y do local selecionado (m)'],
  coordHint:['Saisissez les deux coordonnées ou effacez-les pour une position automatique.','Enter both coordinates, or clear both for an automatic position.','请输入两个坐标，或将两者清空以自动定位。','Introduce ambas coordenadas o bórralas para una posición automática.','Informe as duas coordenadas ou apague ambas para uma posição automática.'], dragHint:['Son repère peut aussi être déplacé sur la carte.','Its marker can also be dragged on the map.','也可以在地图上拖动其标记。','También puedes arrastrar su marcador en el mapa.','Seu marcador também pode ser arrastado no mapa.'], pickingHint:['Cliquez sur le paysage à l’endroit voulu. Échap annule.','Click the landscape where it should be. Esc cancels.','点击地图上的目标位置。按 Esc 取消。','Haz clic en el paisaje donde debe estar. Esc cancela.','Clique na paisagem onde deve ficar. Esc cancela.'],
  mainTown:['Ville principale','Main town','主要城镇','Ciudad principal','Cidade principal'], place:['Lieu','Place','地点','Lugar','Local'], places:['Lieux','Places','地点','Lugares','Locais'], editPlace:['Modifier ce lieu','Edit this place','编辑此地点','Editar este lugar','Editar este local'], placeMap:['Placer sur la carte','Place it on the map','放到地图上','Situar en el mapa','Colocar no mapa'], delete:['Supprimer','Delete','删除','Eliminar','Excluir'], keepPlace:['La carte conserve au moins un lieu','The map keeps at least one place','地图至少保留一个地点','El mapa conserva al menos un lugar','O mapa mantém pelo menos um local'],
  namesFrom:['noms selon la culture','names from the culture','名称源自文化','nombres de la cultura','nomes da cultura'], placeNames:['noms','names','名称','nombres','nomes'],
  editPlacesHint:['Cliquez sur un lieu pour le modifier ou faites glisser son repère.','Click a place to edit it, or drag its marker on the map.','点击地点进行编辑，或在地图上拖动标记。','Haz clic en un lugar para editarlo o arrastra su marcador en el mapa.','Clique em um local para editá-lo ou arraste seu marcador no mapa.'], generatedPlacesHint:['Générés depuis la population cible. Cliquez sur un lieu pour modifier la liste.','Generated from the target population. Click a place to edit it: the list becomes yours.','根据目标人口生成。点击地点编辑，列表将变为可编辑。','Generados a partir de la población objetivo. Haz clic en un lugar para editar la lista.','Gerados a partir da população alvo. Clique em um local para editar a lista.'], emptyPlacesHint:['Générez les lieux automatiquement ou ajoutez-les un par un.','Generate the places automatically, or add them one by one.','自动生成地点，或逐个添加。','Genera los lugares automáticamente o añádelos uno por uno.','Gere os locais automaticamente ou adicione-os um a um.'], regenerateAll:['Tout régénérer','Regenerate all','全部重新生成','Regenerar todo','Regenerar tudo'], generatePlaces:['Générer les lieux','Generate places','生成地点','Generar lugares','Gerar locais'],
  replacePlacesHelp:['Remplacer la liste par une région automatique autour d’une ville de cette population','Replace the list by an automatic region around a town of this population','将列表替换为围绕该人口城镇自动生成的区域','Sustituir la lista por una región automática alrededor de una ciudad de esta población','Substituir a lista por uma região automática em torno de uma cidade com esta população'], generatePlacesHelp:['Générer une ville de cette population avec ses villages, hameaux et fermes','Generate a town of this population with its villages, hamlets and farms','生成该人口的城镇及其村庄、聚落和农场','Generar una ciudad de esta población con sus aldeas, caseríos y granjas','Gerar uma cidade com esta população e suas vilas, povoados e fazendas'], general:['Général','General','常规','General','Geral'], themeCulture:['Culture générale','Theme culture','主题文化','Cultura general','Cultura geral'], culture:['Culture','Culture','文化','Cultura','Cultura'], generatedName:['Nom généré','Generated name','生成的名称','Nombre generado','Nome gerado'],
};
export function mainMessage(key: string): string {
  return dynamicMessages[key]?.[locales.indexOf(savedLocale())] ?? key;
}
const choices: Record<string, Record<string, Words>> = {
  size: {
    hamlet:['Hameau','Hamlet','小聚落','Caserío','Povoado'], village:['Village','Village','村庄','Aldea','Vila'], town:['Bourg','Town','城镇','Villa','Vila urbana'], city:['Ville','City','城市','Ciudad','Cidade'], capital:['Capitale','Capital','首都','Capital','Capital'],
  },
  siteType: {
    auto:['Automatique','Automatic','自动','Automático','Automático'], bridge:['Pont','Bridge','桥梁','Puente','Ponte'], confluence:['Confluence','Confluence','汇流处','Confluencia','Confluência'], meander:['Méandre','Meander','河湾','Meandro','Meandro'], harbor:['Port','Harbor','港湾','Puerto','Porto'], estuary:['Estuaire','Estuary','河口','Estuario','Estuário'], valley:['Vallée','Valley','山谷','Valle','Vale'], hilltop:['Sommet','Hilltop','山顶','Cima','Topo de colina'], plain:['Plaine','Plain','平原','Llanura','Planície'], lakeshore:['Rive de lac','Lakeshore','湖岸','Orilla de lago','Margem de lago'], island:['Île','Island','岛屿','Isla','Ilha'], spur:['Éperon','Spur','山岬','Espolón','Esporão'], pass:['Col','Pass','山口','Paso de montaña','Passagem de montanha'],
  },
  relief: {
    flat:['Plat','Flat','平坦','Llano','Plano'], hills:['Collines','Rolling hills','丘陵','Colinas','Colinas'],
    valley:['Vallée','Valley','山谷','Valle','Vale'], mountains:['Montagnes','Mountains','山地','Montañas','Montanhas'],
  },
  biome: {
    temperate:['Campagne tempérée','Temperate countryside','温带乡野','Campiña templada','Campo temperado'],
    forest:['Forêt','Woodland','林地','Bosque','Floresta'], desert:['Désert et oasis','Desert and oases','沙漠与绿洲','Desierto y oasis','Deserto e oásis'],
    steppe:['Steppe','Steppe','草原','Estepa','Estepe'], tropical:['Forêt tropicale','Tropical forest','热带森林','Bosque tropical','Floresta tropical'],
    tundra:['Toundra','Tundra','苔原','Tundra','Tundra'], underdark:['Monde souterrain','Underdark','幽暗地域','Inframundo','Subterrâneo'],
    'underdark-caverns':['Monde souterrain et cavernes','Underdark with caverns','幽暗地域与洞穴','Inframundo con cavernas','Subterrâneo com cavernas'],
  },
  coast: {
    none:['Aucune','None','无','Ninguna','Nenhuma'], random:['Côté aléatoire','Random side','随机方向','Lado aleatorio','Lado aleatório'],
    N:['Nord','North','北','Norte','Norte'], E:['Est','East','东','Este','Leste'], S:['Sud','South','南','Sur','Sul'], W:['Ouest','West','西','Oeste','Oeste'],
  },
  river: {
    none:['Aucune','None','无','Ninguno','Nenhum'], stream:['Ruisseau','Stream','溪流','Arroyo','Riacho'],
    river:['Rivière','River','河流','Río','Rio'], major:['Grand fleuve','Major river','大河','Río principal','Rio principal'],
  },
  exportPreset: {
    all:['Carte complète','Complete map','完整地图','Mapa completo','Mapa completo'], city:['Ville seule','Town only','仅城镇','Solo ciudad','Somente cidade'],
    terrain:['Relief seul','Relief only','仅地形','Solo relieve','Somente relevo'], roads:['Routes et rues','Roads & streets only','仅道路与街道','Solo caminos y calles','Somente estradas e ruas'],
    custom:['Calques personnalisés','Custom layers','自定义图层','Capas personalizadas','Camadas personalizadas'],
  },
};
export function mainSizeLabel(size: string): string {
  return choices.size[size]?.[locales.indexOf(savedLocale())] ?? size;
}
const dockLabels: Words[] = [
  ['Biome','Biome','生物群系','Bioma','Bioma'], ['Relief','Relief','地形','Relieve','Relevo'],
  ['Côte','Coast','海岸','Costa','Costa'], ['Rivières','Rivers','河流','Ríos','Rios'],
  ['Style','Style','样式','Estilo','Estilo'],
];
const dockCoasts: Record<string, Words> = {
  none:['Sans côte','No coast','无海岸','Sin costa','Sem costa'],
  random:['Côte aléatoire','Coast on a random side','随机海岸方向','Costa en un lado aleatorio','Costa em lado aleatório'],
  N:['Côte au nord','Coast to the north','北部海岸','Costa al norte','Costa ao norte'],
  E:['Côte à l’est','Coast to the east','东部海岸','Costa al este','Costa a leste'],
  S:['Côte au sud','Coast to the south','南部海岸','Costa al sur','Costa ao sul'],
  W:['Côte à l’ouest','Coast to the west','西部海岸','Costa al oeste','Costa a oeste'],
};
const dockRivers: Record<string, Words> = { ...choices.river, none:['Sans rivière','No river','无河流','Sin río','Sem rio'] };
const attributes: Record<string, { attribute: string; words: Words }[]> = {
  '#closeSettings': [{ attribute:'aria-label', words:['Fermer les réglages','Close customize panel','关闭自定义面板','Cerrar panel de personalización','Fechar painel de personalização'] }, { attribute:'title', words:['Fermer (Échap)','Close (Esc)','关闭（Esc）','Cerrar (Esc)','Fechar (Esc)'] }],
  '.settings-tabs': [{ attribute:'aria-label', words:['Réglages de la carte','Map settings','地图设置','Ajustes del mapa','Configurações do mapa'] }],
  '#mapInfoButton': [{ attribute:'aria-label', words:['Carte et légende','Map info and legend','地图信息与图例','Información y leyenda','Informações e legenda'] }, { attribute:'title', words:['Carte et légende','Map info and legend','地图信息与图例','Información y leyenda','Informações e legenda'] }],
  '#newMap': [{ attribute:'title', words:['Nouvelle graine avec les réglages appliqués','A new seed with the applied settings','使用已应用设置生成新种子','Nueva semilla con los ajustes aplicados','Nova semente com as configurações aplicadas'] }],
  '#surprise': [{ attribute:'title', words:['Biome, culture, taille et graine aléatoires','Random biome, culture, size and seed','随机生物群系、文化、大小和种子','Bioma, cultura, tamaño y semilla aleatorios','Bioma, cultura, tamanho e semente aleatórios'] }],
  '#menuBtn': [{ attribute:'title', words:['Personnaliser le monde et ses établissements','Customize the world and its settlements','自定义世界及其聚落','Personalizar el mundo y sus asentamientos','Personalizar o mundo e seus povoados'] }],
  '#openIdInput': [{ attribute:'placeholder', words:['Coller un identifiant ou lien de carte','Paste a map ID or link','粘贴地图 ID 或链接','Pega un ID o enlace de mapa','Cole um ID ou link do mapa'] }, { attribute:'aria-label', words:['Identifiant ou lien de carte à ouvrir','Map ID or link to open','要打开的地图 ID 或链接','ID o enlace de mapa para abrir','ID ou link de mapa para abrir'] }],
  '#fit': [{ attribute:'aria-label', words:['Afficher toute la carte','Fit the whole map','显示整张地图','Mostrar todo el mapa','Mostrar o mapa inteiro'] }, { attribute:'title', words:['Afficher toute la carte (0)','Fit the whole map (0)','显示整张地图（0）','Mostrar todo el mapa (0)','Mostrar o mapa inteiro (0)'] }],
  '#generateSettlements': [{ attribute:'title', words:['Appliquer les modifications en attente et générer la carte','Apply every pending change and generate the map','应用所有待处理更改并生成地图','Aplicar los cambios pendientes y generar el mapa','Aplicar as alterações pendentes e gerar o mapa'] }],
};

export function setupMainLocale(): void {
  const select = document.querySelector<HTMLSelectElement>('#main-language');
  if (!select) return;
  function apply(locale: Locale): void {
    select!.value = locale;
    document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : locale;
    const i = locales.indexOf(locale);
    for (const [selector, values] of Object.entries(translations)) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.textContent = values[i];
    }
    for (const [id, entries] of Object.entries(choices)) {
      const field = document.getElementById(id) as HTMLSelectElement | null;
      for (const option of Array.from(field?.options ?? [])) {
        const words = entries[option.value];
        if (words) option.textContent = words[i];
      }
    }
    for (const [selector, entries] of Object.entries(attributes)) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) for (const entry of entries) element.setAttribute(entry.attribute, entry.words[i]);
    }
    const placement = document.getElementById('placementPrompt')?.firstChild;
    if (placement?.nodeType === Node.TEXT_NODE) placement.textContent = ['Cliquez sur la carte pour placer le lieu ','Click the map to place it ','点击地图放置地点 ','Haz clic en el mapa para situarlo ','Clique no mapa para posicioná-lo '][i];
    document.querySelectorAll<HTMLElement>('#dock .rail-cap').forEach((caption, index) => {
      if (dockLabels[index]) caption.textContent = dockLabels[index][i];
    });
    document.querySelectorAll<HTMLElement>('#dock .dock-row').forEach((row, index) => {
      if (dockLabels[index]) row.setAttribute('aria-label', dockLabels[index][i]);
    });
    for (const [kind, entries] of Object.entries({ biome: choices.biome, relief: choices.relief, coast: dockCoasts, river: dockRivers })) {
      for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(`#dock button[data-${kind}]`))) {
        const words = entries[button.dataset[kind] ?? ''];
        if (words) { button.dataset.tip = words[i]; button.setAttribute('aria-label', words[i]); }
      }
    }
    select!.setAttribute('aria-label', ['Langue','Language','语言','Idioma','Idioma'][i]);
  }
  apply(savedLocale());
  select.addEventListener('change', () => {
    const locale = resolveLocale(select.value);
    try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* Storage may be unavailable. */ }
    apply(locale);
    window.dispatchEvent(new Event('magna-locale-change'));
  });
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) { apply(savedLocale()); window.dispatchEvent(new Event('magna-locale-change')); } });
  // Main fills the option lists after this standalone localization entry runs.
  document.addEventListener('magna-main-options-ready', () => apply(savedLocale()));
}
