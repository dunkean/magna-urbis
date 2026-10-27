import { urbanText } from './urbanPanelLocale';

type Words = [string, string, string, string, string];
const labels: Words[] = [
  ['Zones de génération','Generation zones','生成区域','Zonas de generación','Zonas de geração'],
  ['Entrée','Input','输入','Entrada','Entrada'],
  ['Relief automatique','Automatic terrain','自动地形','Relieve automático','Relevo automático'],
  ['Zones peintes → génération','Painted zones → generation','绘制区域 → 生成','Zonas pintadas → generación','Zonas pintadas → geração'],
  ['Heightmap importée → conserver','Imported heightmap → preserve','导入高程图 → 保留','Mapa de altura importado → conservar','Mapa de altura importado → preservar'],
  ['Heightmap importée → éroder','Imported heightmap → erode','导入高程图 → 侵蚀','Mapa de altura importado → erosionar','Mapa de altura importado → erodir'],
  ['Ancienne esquisse d’altitude','Legacy elevation sketch','旧版高程草图','Boceto de elevación antiguo','Esboço de elevação antigo'],
  ['Dessiner les zones','Paint zones','绘制区域','Pintar zonas','Pintar zonas'],
  ['Générer le relief','Generate terrain','生成地形','Generar relieve','Gerar relevo'],
  ['Zone','Zone','区域','Zona','Zona'],
  ['Mer','Sea','海洋','Mar','Mar'], ['Plaine','Plain','平原','Llanura','Planície'], ['Collines','Hills','丘陵','Colinas','Colinas'], ['Montagnes','Mountains','山地','Montañas','Montanhas'], ['Hautes montagnes','High mountains','高山','Alta montaña','Altas montanhas'],
  ['Gomme · relief automatique','Eraser · automatic terrain','橡皮擦 · 自动地形','Borrador · relieve automático','Borracha · relevo automático'],
  ['Rayon % carte','Radius % of map','半径（地图百分比）','Radio % del mapa','Raio % do mapa'],
  ['Transition % rayon','Falloff % of radius','过渡（半径百分比）','Transición % del radio','Transição % do raio'],
  ['Exemple : côte et massifs','Example: coast and ranges','示例：海岸与山脉','Ejemplo: costa y macizos','Exemplo: costa e maciços'],
  ['Toute la carte : cette zone','Fill map with this zone','整张地图使用此区域','Toda la carta: esta zona','Mapa inteiro: esta zona'],
  ['Effacer les zones','Clear zones','清除区域','Borrar zonas','Limpar zonas'], ['Annuler','Undo','撤销','Deshacer','Desfazer'], ['Rétablir','Redo','重做','Rehacer','Refazer'],
  ['Importer les zones','Import zones','导入区域','Importar zonas','Importar zonas'], ['Exporter les zones','Export zones','导出区域','Exportar zonas','Exportar zonas'],
  ['Les couleurs sont des masques d’opération. Le moteur génère les bruits, le soulèvement, les crêtes et l’érosion dans ces zones. La gomme retrouve le relief automatique. Auto applique en fin de trait ; sinon « Générer le relief ». Molette : zoom · Échap : quitter · Ctrl+Z / Ctrl+Maj+Z : annuler / rétablir.', 'Colours are operation masks. The engine generates noise, uplift, ridges and erosion in these zones. The eraser restores automatic terrain. Auto applies at the end of a stroke; otherwise use “Generate terrain”. Wheel: zoom · Esc: exit · Ctrl+Z / Ctrl+Shift+Z: undo / redo.', '颜色表示操作遮罩。引擎在这些区域生成噪声、隆升、山脊和侵蚀。橡皮擦恢复自动地形。自动模式在笔画结束时应用；否则请使用“生成地形”。滚轮：缩放 · Esc：退出 · Ctrl+Z / Ctrl+Shift+Z：撤销 / 重做。', 'Los colores son máscaras de operación. El motor genera ruido, levantamiento, crestas y erosión en estas zonas. El borrador recupera el relieve automático. Auto aplica al terminar el trazo; si no, usa «Generar relieve». Rueda: zoom · Esc: salir · Ctrl+Z / Ctrl+Mayús+Z: deshacer / rehacer.', 'As cores são máscaras de operação. O mecanismo gera ruído, soerguimento, cristas e erosão nessas zonas. A borracha restaura o relevo automático. Auto aplica ao final do traço; caso contrário, use “Gerar relevo”. Roda: zoom · Esc: sair · Ctrl+Z / Ctrl+Shift+Z: desfazer / refazer.'],
  ['Heightmap · import / export','Heightmap · import / export','高程图 · 导入 / 导出','Mapa de altura · importar / exportar','Mapa de altura · importar / exportar'],
  ['Échange d’un raster existant. Les pinceaux de zones restent des instructions de génération.','Exchange an existing raster. Zone brushes remain generation instructions.','交换现有栅格。区域画笔仍是生成指令。','Intercambia un ráster existente. Los pinceles de zona siguen siendo instrucciones de generación.','Troque um raster existente. Os pincéis de zona continuam sendo instruções de geração.'],
  ['Utiliser le terrain affiché comme heightmap','Use displayed terrain as heightmap','将显示的地形用作高程图','Usar el terreno mostrado como mapa de altura','Usar o terreno exibido como mapa de altura'],
  ['Importer JSON / PNG','Import JSON / PNG','导入 JSON / PNG','Importar JSON / PNG','Importar JSON / PNG'], ['Exporter','Export','导出','Exportar','Exportar'],
  ['Terrain affiché (après traitement)','Displayed terrain (after processing)','显示的地形（处理后）','Terreno mostrado (tras procesar)','Terreno exibido (após processamento)'],
  ['Heightmap importée (avant traitement)','Imported heightmap (before processing)','导入的高程图（处理前）','Mapa de altura importado (antes de procesar)','Mapa de altura importado (antes do processamento)'],
  ['Exporter JSON','Export JSON','导出 JSON','Exportar JSON','Exportar JSON'], ['Exporter PNG 16 bits','Export 16-bit PNG','导出 16 位 PNG','Exportar PNG de 16 bits','Exportar PNG de 16 bits'],
  ['Noir = m','Black = m','黑色 = 米','Negro = m','Preto = m'], ['Blanc = m','White = m','白色 = 米','Blanco = m','Branco = m'],
  ['PNG gris 8/16 bits, carré 8–1024². Les exports conservent la plage d’altitude et la largeur de carte. Les zones s’exportent séparément, sans altitudes.','8/16-bit grayscale PNG, square 8–1024². Exports retain elevation range and map width. Zones are exported separately without elevations.','8/16 位灰度 PNG，正方形 8–1024²。导出保留高程范围和地图宽度。区域单独导出，不含高程。','PNG gris de 8/16 bits, cuadrado de 8–1024². Las exportaciones conservan el rango de elevación y el ancho del mapa. Las zonas se exportan por separado, sin elevaciones.','PNG em cinza de 8/16 bits, quadrado de 8–1024². As exportações mantêm a faixa de altitude e a largura do mapa. As zonas são exportadas separadamente, sem altitudes.'],
];
const byFrench = new Map(labels.map(words => [words[0], words]));

/** Translate existing text nodes without rebuilding controls or disturbing editor state. */
export function localizeTerrainSketch(host: HTMLElement): void {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const original = node.textContent ?? '';
    // The last rendered language is also a valid lookup key on subsequent changes.
    const words = byFrench.get(original.trim()) ?? labels.find(entry => entry.includes(original.trim()));
    if (words) node.textContent = original.replace(original.trim(), urbanText(words));
  }
}
export function terrainZoneName(index: number): string {
  return urbanText([['Mer','Sea','海洋','Mar','Mar'], ['Plaine','Plain','平原','Llanura','Planície'], ['Collines','Hills','丘陵','Colinas','Colinas'], ['Montagnes','Mountains','山地','Montañas','Montanhas'], ['Hautes montagnes','High mountains','高山','Alta montaña','Altas montanhas']][index] as Words);
}
