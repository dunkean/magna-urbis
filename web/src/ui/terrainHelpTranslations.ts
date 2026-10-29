// Localized terrain-control help, keyed by the French source.
export const terrainHelpTranslations: Record<string, readonly [string,string,string,string]> = {
  "Relief compact : bruit, érosion régionale sur une grille réduite et détail Phasor sur GPU. Trois qualités et six profils climatiques. Le CPU est une référence plus lente. Cliquez pour lire la méthode.": ["Compact terrain: noise, regional erosion on a reduced grid and GPU Phasor detail. Three quality levels and six climate presets. CPU is a slower reference. Click to read the method.", "紧凑地形：噪声、低分辨率区域侵蚀与 GPU Phasor 细节。三种质量和六种气候预设。CPU 参考实现较慢。点击阅读方法。", "Relieve compacto: ruido, erosión regional en una rejilla reducida y detalle Phasor en GPU. Tres calidades y seis climas. La referencia CPU es más lenta. Pulsa para leer el método.", "Relevo compacto: ruído, erosão regional em grade reduzida e detalhe Phasor na GPU. Três qualidades e seis climas. A referência CPU é mais lenta. Clique para ler o método."],
  "Qualité du relief compact : Rapide réduit la grille et les cycles régionaux ; Détaillée les augmente. La sortie physique reste à 1024². Cliquez pour lire la méthode.": ["Compact terrain quality: Fast reduces the regional grid and cycles; Detailed increases them. Physical output stays at 1024². Click to read the method.", "紧凑地形质量：快速模式减少区域网格和迭代；详细模式增加它们。物理输出保持 1024²。点击阅读方法。", "Calidad compacta: Rápida reduce rejilla y ciclos regionales; Detallada los aumenta. La salida física sigue en 1024². Pulsa para leer el método.", "Qualidade compacta: Rápida reduz a grade e os ciclos regionais; Detalhada os aumenta. A saída física continua em 1024². Clique para ler o método."],
  "Amplitude du détail Phasor, de 0 à 2. Zéro conserve la même érosion régionale sans détail. Le Phasor ne garantit pas le drainage et peut ajouter des dépressions. Cliquez pour lire la méthode.": ["Phasor detail amplitude, from 0 to 2. Zero keeps the same regional erosion without detail. Phasor does not guarantee drainage and may introduce depressions. Click to read the method.", "Phasor 细节振幅，范围 0–2。零保留相同区域侵蚀且不加细节。Phasor 不保证排水连通性，并可能产生洼地。点击阅读方法。", "Amplitud Phasor de 0 a 2. Cero conserva la misma erosión regional sin detalle. Phasor no garantiza el drenaje y puede crear depresiones. Pulsa para leer el método.", "Amplitude Phasor de 0 a 2. Zero mantém a mesma erosão regional sem detalhe. Phasor não garante a drenagem e pode criar depressões. Clique para ler o método."],
  "Le profil climatique module l’incision, le lissage thermique et le détail Phasor. Ce sont des variations de morphologie, pas une simulation géologique des biomes.": ["The climate preset changes incision, thermal smoothing and Phasor detail. These are morphology variations, not a geological biome simulation.", "气候预设调整切蚀、热平滑与 Phasor 细节。这是形态变化，而非生物群落地质模拟。", "El clima modifica incisión, suavizado térmico y detalle Phasor. Son variantes morfológicas, no una simulación geológica de biomas.", "O clima modifica incisão, suavização térmica e detalhe Phasor. São variações morfológicas, não uma simulação geológica de biomas."],

  "Source conserve les altitudes retenues. Noise multiscale ajoute un détail procédural déterministe. Neural Earth compare Classique, Phasor, Hybride et MSE sur le même relief via le service local. Ces détails ne recalculent pas l’hydrologie régionale. Cliquez pour lire la méthode.": [
    "Source retains the selected heights. Multiscale noise adds deterministic procedural detail. Neural Earth compares Classic, Phasor, Hybrid and MSE on the same terrain through the local service. These details do not recompute regional hydrology. Click to read the method.",
    "源模式保留当前高程。多尺度噪声添加确定性的程序细节。Neural Earth 通过本地服务在同一地形上比较经典、Phasor、混合和 MSE 模式。这些细节不会重新计算区域水文。点击阅读方法。",
    "Fuente conserva las alturas seleccionadas. El ruido multiescala añade detalle determinista. Neural Earth compara Clásico, Phasor, Híbrido y MSE sobre el mismo relieve mediante el servicio local. Estos detalles no recalculan la hidrología regional. Pulsa para leer el método.",
    "Fonte mantém as alturas selecionadas. O ruído multiescala adiciona detalhes determinísticos. Neural Earth compara Clássico, Phasor, Híbrido e MSE no mesmo relevo pelo serviço local. Esses detalhes não recalculam a hidrologia regional. Clique para ler o método."
  ],
  "Calendrier annuel du paysage satellite : feuillaison, herbacées, neige et glace. Le climat annuel du preset est adapté par une amplitude continentale approximative. Aucun relief régénéré. Cliquez pour lire la méthode.": [
    "Annual satellite landscape cycle: foliage, grass, snow and ice. The preset’s annual climate is adjusted using an approximate continental range. Terrain is not regenerated. Click to read the method.",
    "卫星景观的年度周期：树叶、草本植物、雪和冰。预设的年气候通过近似大陆性振幅进行调整。不会重新生成地形。点击阅读方法。",
    "Ciclo anual del paisaje satelital: follaje, herbáceas, nieve y hielo. El clima anual del preajuste se adapta mediante una amplitud continental aproximada. El terreno no se regenera. Pulsa para leer el método.",
    "Ciclo anual da paisagem de satélite: folhagem, herbáceas, neve e gelo. O clima anual da predefinição é ajustado por uma amplitude continental aproximada. O terreno não é regenerado. Clique para ler o método."
  ],
  "Affiche le paysage satellite ou un diagnostic de son substrat, de son humidité, de sa végétation ou de la neige et de la glace. Ce sont des vues du même layer Render v2 ; la saison et le terrain sont conservés.": [
    "Displays the satellite landscape or a diagnosis of its substrate, moisture, vegetation or snow and ice. These are views of the same Render v2 layer; the season and the terrain are preserved.",
    "显示卫星景观或其基质、水分、植被或冰雪的诊断。这些是同一 Render v2 层的视图；季节和地形得以保留。",
    "Muestra el paisaje satelital o un diagnóstico de su sustrato, humedad, vegetación o nieve y hielo. Estas son vistas de la misma capa de Render v2; Se conservan la temporada y el terreno.",
    "Exibe a paisagem do satélite ou um diagnóstico do seu substrato, umidade, vegetação ou neve e gelo. Estas são visualizações da mesma camada Render v2; a estação e o terreno são preservados."
  ],
  "Procédural : les zones modulent les propriétés locales des bruits, du soulèvement et des crêtes avant l’érosion. Les montagnes sont générées dans leur masque, avec leur géographie interne. La génération zonée utilise Rust ; l’échantillonnage peut rester GPU.": [
    "Procedural: zones modulate local noise, uplift and ridge properties before erosion. Mountains are generated inside their masks with their internal geography. Zoned generation uses Rust; sampling can use the GPU.",
    "程序化：区域在侵蚀前调节局部噪声、隆升和山脊属性。山脉在其遮罩内生成，具有内部地形。分区生成使用 Rust；采样可使用 GPU。",
    "Procedural: las zonas modulan el ruido, levantamiento y crestas locales antes de la erosión. Las montañas se generan dentro de sus máscaras con su geografía interna. La generación por zonas usa Rust; el muestreo puede usar la GPU.",
    "Procedural: as zonas modulam ruído, soerguimento e cristas locais antes da erosão. As montanhas são geradas em suas máscaras com sua geografia interna. A geração por zonas usa Rust; a amostragem pode usar a GPU."
  ],
  "Neuronal WASM : Terrain Diffusion sur le GPU du navigateur. Les zones produisent le conditionnement régional et les contraintes locales de relief ; les réseaux génèrent les détails. Environ 162 Mo de modèles au premier chargement, puis cache. Le réseau produit 40 × 40 km avant découpe ou mise à l’échelle.": [
    "Neural WASM: Terrain Diffusion on the browser GPU. Zones provide regional conditioning and local terrain constraints; the networks generate details. About 162 MB of models are downloaded on first load, then cached. The network generates 40 × 40 km before cropping or scaling.",
    "神经 WASM：在浏览器 GPU 上运行 Terrain Diffusion。区域提供区域条件和局部地形约束；网络生成细节。首次加载约下载 162 MB 模型，之后使用缓存。网络先生成 40 × 40 公里，再裁剪或缩放。",
    "WASM neuronal: Terrain Diffusion en la GPU del navegador. Las zonas aportan condicionamiento regional y restricciones locales del terreno; las redes generan los detalles. Se descargan unos 162 MB de modelos al inicio y después se usa la caché. La red genera 40 × 40 km antes de recortar o escalar.",
    "WASM neural: Terrain Diffusion na GPU do navegador. As zonas fornecem condicionamento regional e restrições locais do terreno; as redes geram os detalhes. Cerca de 162 MB de modelos são baixados na primeira carga e depois ficam em cache. A rede gera 40 × 40 km antes do recorte ou redimensionamento."
  ],
  "Neuronal Python : Terrain Diffusion via le service local PyTorch/CUDA. Même entrée régionale que WASM, avec un modèle et une précision différents. Le résultat n’est donc pas identique. Le service doit être démarré.": [
    "Neural Python: Terrain Diffusion via the local PyTorch/CUDA service. It uses the same regional input as WASM, with a different model and precision, so the result differs. The service must be started.",
    "神经 Python：通过本地 PyTorch/CUDA 服务运行 Terrain Diffusion。使用与 WASM 相同的区域输入，但模型和精度不同，因此结果不同。必须启动服务。",
    "Python neuronal: Terrain Diffusion mediante el servicio local PyTorch/CUDA. Usa la misma entrada regional que WASM, con modelo y precisión diferentes, por lo que el resultado varía. Hay que iniciar el servicio.",
    "Python neural: Terrain Diffusion pelo serviço local PyTorch/CUDA. Usa a mesma entrada regional do WASM, com modelo e precisão diferentes, portanto o resultado varia. O serviço deve ser iniciado."
  ],
  "Relief de fond dans les parties non peintes. Les zones remplacent localement ses paramètres de génération : plaine, collines, montagnes ou hautes montagnes. La gomme rend la main à ce relief de fond. Une heightmap importée conserve ses altitudes ; les cavernes utilisent un autre modèle.": [
    "Background terrain in unpainted areas. Zones locally replace its generation parameters with plains, hills, mountains or high mountains. The eraser restores the background terrain. An imported heightmap retains its elevations; caves use a different model.",
    "未绘制区域使用背景地形。区域会在局部替换生成参数：平原、丘陵、山地或高山。橡皮擦恢复背景地形。导入的高程图保留高度；洞穴使用其他模型。",
    "Relieve de fondo en las zonas sin pintar. Las zonas reemplazan localmente sus parámetros de generación: llanura, colinas, montañas o alta montaña. El borrador recupera el relieve de fondo. Un mapa de altura importado conserva sus altitudes; las cavernas usan otro modelo.",
    "Relevo de fundo nas áreas não pintadas. As zonas substituem localmente seus parâmetros de geração: planície, colinas, montanhas ou altas montanhas. A borracha restaura o relevo de fundo. Um mapa de altura importado mantém suas altitudes; cavernas usam outro modelo."
  ],
  "Largeur de la carte carrée, en mètres. Une heightmap couvre toujours toute cette surface. Changer la largeur étire son relief horizontalement, sans changer les altitudes.": [
    "Width of the square map, in meters. A heightmap always covers this entire area. Changing the width stretches its relief horizontally, without changing the altitudes.",
    "方形地图的宽度，以米为单位。高度图始终覆盖整个区域。改变宽度会水平拉伸其起伏，而不改变高度。",
    "Ancho del mapa cuadrado, en metros. Un mapa de altura siempre cubre toda esta área. Cambiar el ancho estira su relieve horizontalmente, sin cambiar las altitudes.",
    "Largura do mapa quadrado, em metros. Um mapa de altura sempre cobre toda esta área. Alterar a largura alonga seu relevo horizontalmente, sem alterar as altitudes."
  ],
  "La graine reproduit les choix aléatoires avec les mêmes paramètres et le même moteur. Elle ne remplace pas une heightmap importée.": [
    "The seed reproduces the random choices with the same parameters and the same engine. It does not replace an imported heightmap.",
    "种子使用相同的参数和相同的引擎再现随机选择。它不会替换导入的高度图。",
    "La semilla reproduce las elecciones aleatorias con los mismos parámetros y el mismo motor. No reemplaza un mapa de altura importado.",
    "A semente reproduz as escolhas aleatórias com os mesmos parâmetros e o mesmo motor. Ele não substitui um mapa de altura importado."
  ],
  "Recalcule quand un paramètre change ou à la fin d’un trait de zones. Désactivez Auto pour préparer plusieurs régions, puis utilisez « Générer le relief ».": [
    "Recalculates when a parameter changes or at the end of a zone line. Turn off Auto to prepare multiple regions, then use “Generate Relief”.",
    "当参数更改或在区域线末尾时重新计算。关闭“自动”以准备多个区域，然后使用“生成地形”。",
    "Se vuelve a calcular cuando cambia un parámetro o al final de una línea de zona. Desactive Auto para preparar varias regiones, luego use \"Generar relieve\".",
    "Recalcula quando um parâmetro muda ou no final de uma linha de zona. Desligue Auto para preparar múltiplas regiões e use “Gerar Relevo”."
  ],
  "Taille physique des formes, indépendante de la largeur de carte. Une chaîne de 3 km garde cette taille sur une carte plus grande.": [
    "Physical size of shapes, independent of map width. A 3 km chain keeps this size on a larger map.",
    "形状的物理尺寸，与地图宽度无关。 3 公里长的链条在更大的地图上保持了这个尺寸。",
    "Tamaño físico de las formas, independiente del ancho del mapa. Una cadena de 3 km mantiene este tamaño en un mapa más grande.",
    "Tamanho físico das formas, independente da largura do mapa. Uma cadeia de 3 km mantém esse tamanho em um mapa maior."
  ],
  "Dose d’érosion du relief procédural ou de la heightmap : 0 % pour observer l’entrée sans érosion, 100 % pour la dose normale, jusqu’à 200 %. La génération neuronale utilise son propre modèle ; reprenez son résultat en Heightmap → éroder pour lui appliquer l’érosion Rust.": [
    "Amount of erosion for procedural terrain or the heightmap: 0% shows the input without erosion, 100% applies the normal amount, up to 200%. Neural generation uses its own model; use Heightmap → erode on its result to apply Rust erosion.",
    "程序化地形或高程图的侵蚀量：0% 显示未经侵蚀的输入，100% 为正常侵蚀量，最高 200%。神经生成使用自己的模型；可将结果用于“高程图 → 侵蚀”，以应用 Rust 侵蚀。",
    "Cantidad de erosión del relieve procedural o mapa de altura: 0% muestra la entrada sin erosión, 100% aplica la cantidad normal y se permite hasta 200%. La generación neuronal usa su propio modelo; usa Mapa de altura → erosionar con su resultado para aplicar la erosión de Rust.",
    "Quantidade de erosão do relevo procedural ou mapa de altura: 0% mostra a entrada sem erosão, 100% aplica a quantidade normal e permite até 200%. A geração neural usa seu próprio modelo; use Mapa de altura → erodir com o resultado para aplicar a erosão Rust."
  ],
  "CPU : référence Rust. GPU fine noise : petits bruits sur GPU. GPU all noise : tous les bruits sur GPU. GPU erosion : relief et érosion compatibles sur GPU. Les masques de zones pilotent la simulation Rust, avec échantillonnage GPU possible. Les sources neuronales utilisent leur runtime propre.": [
    "CPU: Rust reference. GPU fine noise: fine noise on the GPU. GPU all noise: all noise on the GPU. GPU erosion: compatible terrain and erosion on the GPU. Zone masks drive the Rust simulation, optionally with GPU sampling. Neural sources use their own runtime.",
    "CPU：Rust 参考实现。GPU 细噪声：在 GPU 上计算细噪声。GPU 全噪声：在 GPU 上计算所有噪声。GPU 侵蚀：在 GPU 上计算兼容的地形和侵蚀。区域遮罩控制 Rust 模拟，可选用 GPU 采样。神经源使用自己的运行环境。",
    "CPU: referencia Rust. GPU ruido fino: ruido fino en GPU. GPU todo el ruido: todo el ruido en GPU. GPU erosión: relieve y erosión compatibles en GPU. Las máscaras de zonas controlan la simulación Rust, con muestreo GPU opcional. Las fuentes neuronales usan su propio entorno de ejecución.",
    "CPU: referência Rust. GPU ruído fino: ruído fino na GPU. GPU todo o ruído: todo o ruído na GPU. GPU erosão: relevo e erosão compatíveis na GPU. As máscaras de zonas controlam a simulação Rust, com amostragem opcional na GPU. As fontes neurais usam seu próprio ambiente de execução."
  ],
  "Moteur d’échantillonnage du relief pour la vue. WASM calcule sur CPU ; WebGPU utilise le GPU avec repli CPU. Ce choix est distinct du calcul initial de génération et du style de rendu.": [
    "Terrain sampling engine for view. WASM calculates on CPU; WebGPU uses GPU with CPU fallback. This choice is separate from the initial generation calculation and rendering style.",
    "用于视图的地形采样引擎。 WASM在CPU上计算； WebGPU 使用具有 CPU 回退功能的 GPU。这种选择与初始生成计算和渲染风格是分开的。",
    "Motor de muestreo de terreno para ver. WASM calcula en la CPU; WebGPU utiliza GPU con respaldo de CPU. Esta elección es independiente del cálculo de generación inicial y del estilo de renderizado.",
    "Mecanismo de amostragem de terreno para visualização. WASM calcula na CPU; WebGPU usa GPU com substituto de CPU. Esta escolha é separada do cálculo de geração inicial e do estilo de renderização."
  ],
  "Moteur de calcul des lacs et rivières à partir du relief résultant. Rust utilise le réseau natif ; Vector conserve l’ancien pipeline. Recalculer l’eau préserve l’entrée terrain et les côtes déjà appliquées.": [
    "Computes lakes and rivers from the resulting terrain. Rust uses the native network; Vector retains the older pipeline. Recomputing water preserves the terrain input and already applied coasts.",
    "根据生成的地形计算湖泊和河流。Rust 使用原生水系；Vector 保留旧流程。重新计算水系会保留地形输入和已应用的海岸。",
    "Calcula lagos y ríos a partir del relieve resultante. Rust usa la red nativa; Vector conserva el flujo anterior. Recalcular el agua conserva la entrada del terreno y las costas ya aplicadas.",
    "Calcula lagos e rios a partir do relevo resultante. Rust usa a rede nativa; Vector mantém o fluxo anterior. Recalcular a água preserva a entrada do terreno e as costas já aplicadas."
  ],
  "Calcule le drainage sur CPU/WASM ou GPU lorsque disponible. Le réseau final suit le relief, les dépressions et les sorties de carte.": [
    "Calculates drainage on CPU/WASM or GPU when available. The final network follows the relief, depressions and map outflows.",
    "计算 CPU/WASM 或 GPU 上的消耗（如果可用）。最终的网络遵循地势、洼地和地图流出。",
    "Calcula el drenaje en CPU/WASM o GPU cuando esté disponible. La red final sigue el relieve, las depresiones y las salidas del mapa.",
    "Calcula a drenagem em CPU/WASM ou GPU quando disponível. A rede final acompanha o relevo, as depressões e as vazões do mapa."
  ],
  "Modification physique du relief avant le drainage : érosion fluviale, ouverture des seuils, ou les deux. Choisir None pour conserver le terrain avant calcul de l’eau.": [
    "Physical terrain modification before drainage: river erosion, opening sills, or both. Choose None to preserve the terrain before water computation.",
    "排水计算前对地形进行物理修改：河流侵蚀、开通地形障碍，或两者同时进行。选择 None 可在计算水系前保留原地形。",
    "Modificación física del terreno antes del drenaje: erosión fluvial, apertura de umbrales o ambas. Elige None para conservar el terreno antes del cálculo del agua.",
    "Modificação física do terreno antes da drenagem: erosão fluvial, abertura de soleiras ou ambas. Escolha None para preservar o terreno antes do cálculo da água."
  ],
  "Le climat conditionne la génération neuronale et le bilan d’eau des lacs. Pour le relief procédural, il agit sur l’eau, pas sur les formes du relief.": [
    "Climate conditions neural generation and the water balance of lakes. For procedural terrain it affects water, not landforms.",
    "气候影响神经生成和湖泊水平衡。对于程序化地形，它影响水系，不影响地貌。",
    "El clima condiciona la generación neuronal y el balance hídrico de los lagos. En el relieve procedural afecta al agua, no a las formas del terreno.",
    "O clima condiciona a geração neural e o balanço hídrico dos lagos. No relevo procedural, afeta a água, não as formas do terreno."
  ],
  "Bruit de conditionnement neuronal : une valeur faible suit plus étroitement l’esquisse. Le réseau voit de grandes cellules (~7,7 km), les petites côtes peintes ne sont donc pas garanties. Heightmap → conserver garde les formes exactes.": [
    "Neural conditioning noise: A lower value follows the sketch more closely. The network sees large cells (~7.7 km), so small painted coastlines are not guaranteed. Heightmap → preserve keeps the exact shapes.",
    "神经调节噪声：值越低，越接近草图。该网络存在较大的小区（约 7.7 公里），因此无法保证绘制较小的海岸线。高度图 → 保留保持精确的形状。",
    "Ruido de acondicionamiento neuronal: un valor más bajo sigue más de cerca el boceto. La red ve células grandes (~7,7 km), por lo que no se garantizan líneas costeras pequeñas pintadas. Mapa de altura → preservar mantiene las formas exactas.",
    "Ruído de condicionamento neural: um valor mais baixo segue o esboço mais de perto. A rede possui grandes células (~7,7 km), portanto pequenas linhas costeiras pintadas não são garantidas. Heightmap → preservar mantém as formas exatas."
  ],
  "Le réseau génère 40 × 40 km. Crop prélève une fenêtre à la taille de la carte ; Scale ajuste l’ensemble des 40 km à la carte.": [
    "The network generates 40 × 40 km. Crop takes a window to the size of the map; Scale adjusts the entire 40 km to the map.",
    "该网络产生 40 × 40 公里。裁剪将窗口调整为地图大小；比例尺将整个 40 公里调整到地图上。",
    "La red genera 40 × 40 km. Recortar toma una ventana del tamaño del mapa; La escala ajusta los 40 km completos al mapa.",
    "A rede gera 40 × 40 km. O Crop ocupa uma janela do tamanho do mapa; A escala ajusta todos os 40 km do mapa."
  ],
  "Ajoute des détails fractals sous la taille des cellules pendant le zoom. Ce sont des détails d’affichage ; les exports heightmap contiennent les altitudes physiques, sans ce détail de zoom.": [
    "Adds fractal details below cell size while zooming. These are display details; heightmap exports contain physical altitudes, without this zoom detail.",
    "缩放时在像元大小下方添加分形细节。这些是显示细节；高度图导出包含物理高度，没有此缩放细节。",
    "Agrega detalles fractales debajo del tamaño de la celda mientras hace zoom. Estos son detalles de visualización; Las exportaciones de mapas de altura contienen altitudes físicas, sin este detalle de zoom.",
    "Adiciona detalhes fractais abaixo do tamanho da célula durante o zoom. Estes são detalhes de exibição; As exportações de mapas de altura contêm altitudes físicas, sem esse detalhe de zoom."
  ],
  "Quand tous les côtés sont marins, choisit une île, plusieurs îles ou un choix seedé. En mode heightmap, les altitudes négatives définissent directement la mer.": [
    "When all sides are sea, choose one island, several islands or a seed-based choice. In heightmap mode, negative elevations directly define the sea.",
    "当所有边界都是海洋时，可选择单岛、多岛或根据种子选择。高程图模式中，负高度直接定义海洋。",
    "Cuando todos los lados son marinos, elige una isla, varias islas o una opción determinada por la semilla. En modo mapa de altura, las altitudes negativas definen directamente el mar.",
    "Quando todos os lados são marítimos, escolha uma ilha, várias ilhas ou uma opção determinada pela semente. No modo mapa de altura, altitudes negativas definem diretamente o mar."
  ],
  "Relief entourant les formes locales comme plateau, volcan ou caldeira, utilisé dans la génération procédurale.": [
    "Landforms surrounding local shapes like plateau, volcano or caldera, used in procedural generation.",
    "围绕高原、火山或火山口等局部形状的地形，用于程序生成。",
    "Accidentes geográficos que rodean formas locales como meseta, volcán o caldera, utilizados en la generación de procedimientos.",
    "Formas de relevo em torno de formas locais como planalto, vulcão ou caldeira, usadas na geração procedural."
  ],
  "Proportion de montagnes dans le relief mixte. L’esquisse peut ensuite imposer leur emplacement général.": [
    "Proportion of mountains in mixed relief. The sketch can then dictate their general location.",
    "混合地形中山脉的比例。然后草图可以指示它们的大致位置。",
    "Proporción de montañas en relieve mixto. Luego, el boceto puede dictar su ubicación general.",
    "Proporção de montanhas em relevo misto. O esboço pode então ditar sua localização geral."
  ],
  "Render3DBrush utilise les silhouettes Fantasy adaptées au biome dans le matériau forestier de Render3D : mêmes teintes, densité, clairières et niveaux de détail. Les couronnes débordent sur les rivières et les courbes de niveau restent au-dessus. Cliquez pour lire la méthode.": [
    "Render3DBrush uses biome-adapted Fantasy silhouettes in Render3D's forest material: same hues, density, clearings and levels of detail. The crowns overflow onto the rivers and the contour lines remain above them. Click to read the method.",
    "Render3DBrush 在 Render3D 的森林材质中使用适应生物群落的幻想剪影：相同的色调、密度、空地和细节级别。树冠溢出到河流上，等高线保留在它们之上。点击阅读方法。",
    "Render3DBrush utiliza siluetas Fantasy adaptadas al bioma en el material forestal de Render3D: los mismos tonos, densidad, claros y niveles de detalle. Las copas se desbordan sobre los ríos y las curvas de nivel permanecen sobre ellos. Haga clic para leer el método.",
    "Render3DBrush usa silhuetas Fantasy adaptadas ao bioma no material florestal do Render3D: mesmos tons, densidade, clareiras e níveis de detalhe. As copas transbordam para os rios e as curvas de nível permanecem acima deles. Clique para ler o método."
  ],
  "Le style définit les couleurs et matériaux de la carte, dont un même dégradé pour toutes les mers et tous les lacs. Les couches choisissent les éléments visibles. Les brushes peuvent suivre l’occupation du territoire en option.": [
    "The style defines the colors and materials of the map, including the same gradient for all seas and lakes. Layers choose visible elements. The brushes can follow the occupation of the territory as an option.",
    "该样式定义了地图的颜色和材质，包括所有海洋和湖泊的相同渐变。图层选择可见元素。刷子可以跟随占领领土作为一个选项。",
    "El estilo define los colores y materiales del mapa, incluido el mismo degradado para todos los mares y lagos. Las capas eligen elementos visibles. Los pinceles pueden seguir la ocupación del territorio como opción.",
    "O estilo define as cores e materiais do mapa, incluindo o mesmo gradiente para todos os mares e lagos. As camadas escolhem elementos visíveis. Os pincéis podem acompanhar a ocupação do território como opção."
  ],
  "Les arbres suivent les forêts générées et évitent les montagnes. Champs, vergers et marais reçoivent leurs motifs. Masquer l’occupation ne désactive pas son influence. Sans occupation générée, seuls les motifs de relief restent.": [
    "Trees follow generated forests and avoid mountains. Fields, orchards and marshes receive their patterns. Hiding land use does not disable its influence. Without generated land use, only terrain patterns remain.",
    "树木遵循生成的森林并避开山地。田地、果园和沼泽使用各自的图案。隐藏土地利用不会禁用其影响。没有生成土地利用时，只保留地形图案。",
    "Los árboles siguen los bosques generados y evitan las montañas. Campos, huertos y marismas reciben sus patrones. Ocultar el uso del suelo no desactiva su influencia. Sin uso generado, solo quedan los patrones del relieve.",
    "As árvores seguem as florestas geradas e evitam montanhas. Campos, pomares e pântanos recebem seus padrões. Ocultar o uso do solo não desativa sua influência. Sem uso gerado, restam apenas padrões do relevo."
  ],
  "Multiplie la taille des motifs, indépendamment de leur densité et de leur espacement. La taille de base est réduite de 45 % ; le curseur permet de descendre jusqu’à ×0,1.": [
    "Multiply the size of patterns, regardless of their density and spacing. Base size reduced by 45%; the cursor allows you to go down to ×0.1.",
    "乘以图案的大小，无论其密度和间距如何。底座尺寸缩小45%；光标允许您向下移动到 ×0.1。",
    "Multiplica el tamaño de los patrones, independientemente de su densidad y espaciado. El tamaño de la base se redujo en un 45 %; el cursor le permite bajar a ×0.1.",
    "Multiplique o tamanho dos padrões, independentemente da sua densidade e espaçamento. Tamanho da base reduzido em 45%; o cursor permite que você desça até ×0,1."
  ],
  "Un diagnostic visualise une donnée de calcul. Altitude remplace les couleurs du terrain ; les autres diagnostics se superposent à la carte. Ils ne modifient ni le style choisi ni les masques de génération.": [
    "A diagnosis visualizes calculation data. Altitude replaces terrain colors; the other diagnostics are superimposed on the map. They do not modify the chosen style or the generation masks.",
    "诊断将计算数据可视化。海拔高度取代地形颜色；其他诊断叠加在地图上。它们不会修改所选样式或生成蒙版。",
    "Un diagnóstico visualiza los datos de cálculo. La altitud reemplaza los colores del terreno; los demás diagnósticos están superpuestos en el mapa. No modifican el estilo elegido ni las máscaras de generación.",
    "Um diagnóstico visualiza dados de cálculo. A altitude substitui as cores do terreno; os demais diagnósticos ficam sobrepostos no mapa. Não modificam o estilo escolhido nem as máscaras de geração."
  ],
  "Affiche ou masque toute l’eau : mer, lacs et rivières. Lakes et Oxbows permettent de masquer séparément les lacs et les anciens chenaux.": [
    "Show or hide all water: sea, lakes and rivers. Lakes and Oxbows separately hide lakes and old river channels.",
    "显示或隐藏所有水体：海洋、湖泊和河流。Lakes 和 Oxbows 可分别隐藏湖泊和旧河道。",
    "Muestra u oculta toda el agua: mar, lagos y ríos. Lakes y Oxbows permiten ocultar por separado lagos y antiguos cauces.",
    "Mostra ou oculta toda a água: mar, lagos e rios. Lakes e Oxbows permitem ocultar separadamente lagos e antigos canais."
  ],
  "Survol du relief avec raffinement progressif du maillage. Render3D utilise un matériau de sol en coordonnées monde, partagé avec la vue 2D.": [
    "Overview of the relief with progressive refinement of the mesh. Render3D uses a ground material in world coordinates, shared with the 2D view.",
    "逐步细化网格的地形概览。 Render3D 使用世界坐标中的地面材质，与 2D 视图共享。",
    "Visión general del relieve con progresivo perfeccionamiento de la malla. Render3D utiliza un material terrestre en coordenadas mundiales, compartido con la vista 2D.",
    "Visão geral do relevo com refinamento progressivo da malha. Render3D usa um material terrestre em coordenadas mundiais, compartilhado com a visualização 2D."
  ],
  "Source conserve les altitudes retenues. Noise multiscale ajoute un détail procédural déterministe. Neural Earth raffine le relief via le service CUDA ; le matériau de sol de Render3D reste indépendant de cette source.": [
    "Source retains the selected altitudes. Multiscale Noise adds deterministic procedural detail. Neural Earth refines the relief via the CUDA service; Render3D's ground material remains independent of this source.",
    "源保留选定的高度。多尺度噪声添加了确定性的程序细节。 Neural Earth 通过 CUDA 服务完善地形； Render3D 的地面材质仍然独立于该源。",
    "La fuente conserva las altitudes seleccionadas. El ruido multiescala añade detalles procedurales deterministas. Neural Earth refina el relieve a través del servicio CUDA; El material base de Render3D permanece independiente de esta fuente.",
    "A fonte mantém as altitudes selecionadas. Multiscale Noise adiciona detalhes procedurais determinísticos. Neural Earth refina o relevo através do serviço CUDA; O material de base do Render3D permanece independente desta fonte."
  ],
  "Forêt procédurale de Render3D, calculée une fois sur le relief retenu : couvert, hauteur, mélange feuillus/résineux, houppiers et ombres de lisière. La carte 2D, la vue 3D et l’export raster lisent le même champ. Décochée, Render3D retrouve exactement son ancien rendu, avec la teinte forestière grossière d’origine. L’occupation agricole appliquée découpe la forêt dans l’étape Settlements, où la vue 3D n’est pas disponible.": [
    "Render3D procedural forest, computed once on the retained terrain: cover, height, deciduous/conifer mix, crowns and edge shadows. The 2D map, 3D view and raster export use the same field. When unchecked, Render3D returns to its previous rendering and original coarse forest tint. Applied agricultural land use cuts the forest in the Settlements stage, where the 3D view is unavailable.",
    "Render3D 程序化森林，在保留地形上计算一次：覆盖度、高度、阔叶树与针叶树比例、树冠和林缘阴影。二维地图、三维视图和栅格导出使用同一字段。取消勾选后，Render3D 恢复原来的渲染及粗略森林色调。应用的农业用地会在聚落阶段裁切森林，该阶段不提供三维视图。",
    "Bosque procedural de Render3D, calculado una vez sobre el terreno conservado: cobertura, altura, mezcla de frondosas y coníferas, copas y sombras de borde. El mapa 2D, la vista 3D y la exportación ráster usan el mismo campo. Al desmarcarlo, Render3D recupera su renderizado anterior y el tono forestal grueso original. El uso agrícola aplicado recorta el bosque en la etapa Asentamientos, donde la vista 3D no está disponible.",
    "Floresta procedural do Render3D, calculada uma vez no terreno mantido: cobertura, altura, mistura de árvores de folhas largas e coníferas, copas e sombras de borda. O mapa 2D, a visualização 3D e a exportação raster usam o mesmo campo. Ao desmarcar, o Render3D recupera sua renderização anterior e a tonalidade florestal grosseira original. O uso agrícola aplicado recorta a floresta na etapa Assentamentos, onde a visualização 3D não está disponível."
  ],
  "Ajuste le couvert issu du climat et du relief, c → 1 − (1 − c)^densité : 100 % le conserve, 0 % retire la forêt naturelle, 200 % le densifie sans dépasser le couvert complet. Les bois de l’occupation appliquée restent boisés. Aucun terrain n’est régénéré.": [
    "Adjusts the cover resulting from climate and relief, c → 1 − (1 − c)^density: 100% preserves it, 0% removes the natural forest, 200% densifies it without exceeding complete cover. The woods of the applied occupation remain forested. No land is regenerated.",
    "调整气候和地形造成的覆盖率，c → 1 − (1 − c)^密度：100% 保留，0% 去除天然林，200% 使其密实，但不超过完全覆盖。所申请职业的树林仍然茂密。没有土地得到再生。",
    "Ajusta la cobertura resultante del clima y relieve, c → 1 − (1 − c)^densidad: 100% la preserva, 0% elimina el bosque natural, 200% lo densifica sin exceder la cobertura completa. Los bosques de la ocupación aplicada siguen siendo boscosos. No se regenera ninguna tierra.",
    "Ajusta a cobertura resultante do clima e do relevo, c → 1 − (1 − c)^densidade: 100% preserva, 0% remove a floresta natural, 200% adensa sem ultrapassar a cobertura completa. As matas da ocupação aplicada permanecem arborizadas. Nenhuma terra é regenerada."
  ],
  "Clairières d’environ 100 à 400 m : environ 40 % de la surface boisée à 100 % (18 % par défaut ; 85 % de moins en climat tropical humide, soit environ 3 % par défaut), ouvertes d’abord sur les terrains doux et les crêtes ; les pentes raides restent boisées. 0 % : massifs continus. Les champs, prés et bourgs appliqués restent ouverts quel que soit ce réglage.": [
    "Clearings about 100–400 m wide cover about 40% of the wooded area at 100% (18% by default; 85% less in humid tropical climate, about 3% by default). They open first on gentle ground and ridges; steep slopes stay wooded. 0% gives continuous forest. Applied fields, meadows and settlements remain open regardless of this setting.",
    "林间空地宽约 100–400 米：设为 100% 时约占林地面积的 40%（默认 18%；湿润热带气候减少 85%，默认约 3%）。优先在缓坡和山脊开辟空地；陡坡保持森林。0% 表示连续森林。已应用的田地、草地和聚落不受此设置影响，保持开阔。",
    "Claros de unos 100–400 m: al 100% ocupan aproximadamente el 40% del área boscosa (18% por defecto; 85% menos en clima tropical húmedo, alrededor del 3% por defecto). Se abren primero en terrenos suaves y crestas; las pendientes pronunciadas siguen arboladas. El 0% conserva bosques continuos. Los campos, prados y asentamientos aplicados permanecen abiertos con cualquier ajuste.",
    "Clareiras de cerca de 100–400 m: a 100% ocupam aproximadamente 40% da área arborizada (18% por padrão; 85% menos em clima tropical úmido, cerca de 3% por padrão). Abrem primeiro em terrenos suaves e cristas; encostas íngremes continuam arborizadas. 0% mantém florestas contínuas. Campos, prados e assentamentos aplicados permanecem abertos em qualquer ajuste."
  ],
  "Superpose les limites des tuiles affichées pour examiner leurs raccords. Cette option ne change ni le relief ni son niveau de détail.": [
    "Overlap the boundaries of the displayed tiles to examine their connections. This option does not change the relief or its level of detail.",
    "重叠显示图块的边界以检查它们的连接。此选项不会更改地形或其细节级别。",
    "Superponga los límites de los mosaicos mostrados para examinar sus conexiones. Esta opción no cambia el relieve ni su nivel de detalle.",
    "Sobreponha os limites dos blocos exibidos para examinar suas conexões. Esta opção não altera o relevo nem o seu nível de detalhe."
  ],
  "Relief automatique : la famille choisie définit la carte. Zones peintes : vous dessinez des masques d’opération ; le moteur génère leurs reliefs. Les zones ne contiennent aucune altitude. Heightmap : import/export d’un raster existant, conservé ou érodé séparément.": [
    "Automatic relief: the chosen family defines the map. Painted areas: you draw operation masks; the engine generates their reliefs. The zones do not contain any altitude. Heightmap: import/export of an existing raster, kept or eroded separately.",
    "自动地形：所选系列定义地图。绘制区域：您绘制操作蒙版；引擎生成地形。这些区域不包含任何海拔。高度图：导入/导出现有栅格，单独保留或侵蚀。",
    "Relieve automático: la familia elegida define el mapa. Áreas pintadas: dibujas máscaras de operación; el motor genera sus relieves. Las zonas no contienen ninguna altitud. Mapa de altura: importación/exportación de un ráster existente, mantenido o erosionado por separado.",
    "Relevo automático: a família escolhida define o mapa. Áreas pintadas: você desenha máscaras de operação; o motor gera seus relevos. As zonas não contêm nenhuma altitude. Heightmap: importação/exportação de um raster existente, mantido ou erodido separadamente."
  ],
  "Choisit l’opération locale : mer, plaine, collines, montagnes ou hautes montagnes. Le moteur produit ses propres formes dans chaque zone. La gomme retire les opérations et retrouve le relief de fond.": [
    "Chooses the local operation: sea, plain, hills, mountains or high mountains. The engine produces its own shapes in each zone. The eraser removes the operations and regains the background relief.",
    "选择本地操作：海洋、平原、丘陵、山区或高山。引擎在每个区域产生自己的形状。橡皮擦删除操作并恢复背景地形。",
    "Elige la operación local: mar, llanura, colina, montaña o alta montaña. El motor produce sus propias formas en cada zona. El borrador elimina las operaciones y recupera el relieve del fondo.",
    "Escolhe o local de operação: mar, planície, morros, montanhas ou altas montanhas. O motor produz suas próprias formas em cada zona. A borracha remove as operações e recupera o relevo do fundo."
  ],
  "Rayon du pinceau en pourcentage de la largeur de carte. Le cercle montre la zone touchée. Avec le neuronal, préférez de larges régions correspondant à ses cellules de conditionnement.": [
    "Brush radius as a percentage of map width. The circle shows the affected area. For neural generation, prefer large regions matching its conditioning cells.",
    "画笔半径占地图宽度的百分比。圆圈显示受影响的区域。使用神经生成时，建议绘制与其条件网格相匹配的大区域。",
    "Radio del pincel como porcentaje del ancho del mapa. El círculo muestra el área afectada. Para la generación neuronal, convienen regiones amplias acordes con sus celdas de condicionamiento.",
    "Raio do pincel como porcentagem da largura do mapa. O círculo mostra a área afetada. Para geração neural, prefira regiões amplas compatíveis com suas células de condicionamento."
  ],
  "Partie extérieure du rayon où le poids du masque décroît progressivement. Une transition large raccorde les régimes de relief ; une transition courte crée des limites plus marquées.": [
    "Outer part of the radius where the mask weight gradually decreases. A wide transition blends terrain regimes; a short transition creates sharper boundaries.",
    "半径外围的遮罩权重逐渐降低。宽过渡连接不同地形类型；短过渡形成更明显的边界。",
    "Parte exterior del radio donde el peso de la máscara disminuye gradualmente. Una transición amplia une los tipos de relieve; una corta crea límites más definidos.",
    "Parte externa do raio onde o peso da máscara diminui gradualmente. Uma transição ampla conecta os tipos de relevo; uma curta cria limites mais definidos."
  ],
  "Ces directions définissent les côtes automatiques. Le masque Mer ajoute des régions marines à la génération et le moteur construit leur littoral. La gomme retire une zone manuelle ; elle ne retire pas les côtes automatiques.": [
    "These directions define the automatic coasts. The Sea mask adds marine regions to generation and the engine builds their shorelines. The eraser removes a manual zone; it does not remove automatic coasts.",
    "这些方向定义自动海岸。海洋遮罩为生成过程添加海洋区域，引擎构建其海岸线。橡皮擦移除手绘区域，不会移除自动海岸。",
    "Estas direcciones definen las costas automáticas. La máscara Mar añade regiones marinas a la generación y el motor construye su litoral. El borrador elimina una zona manual, no las costas automáticas.",
    "Estas direções definem as costas automáticas. A máscara Mar adiciona regiões marítimas à geração e o mecanismo constrói seu litoral. A borracha remove uma zona manual, não as costas automáticas."
  ]
};
