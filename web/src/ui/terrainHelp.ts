import { openMethodNote, type MethodNoteId } from './methodNotes';
import { savedLocale, LOCALE_KEY } from './shellLocale';
import { urbanText } from './urbanPanelLocale';
import { terrainHelpTranslations } from './terrainHelpTranslations';

function terrainHelpText(source: string): string {
  const locale = savedLocale();
  if (locale === 'fr') return source;
  return terrainHelpTranslations[source]?.[(['en','zh','es','pt'] as const).indexOf(locale)] ?? source;
}

/** Short, keyboard-accessible explanations next to the controls they describe. */
export function installTerrainHelp(): void {
  const explanations: Record<string, () => string> = {
    renderV2Season:()=> 'Calendrier annuel du paysage satellite : feuillaison, herbacées, neige et glace. Le climat annuel du preset est adapté par une amplitude continentale approximative. Aucun relief régénéré. Cliquez pour lire la méthode.',
    renderV2Diagnostic:()=> 'Affiche le paysage satellite ou un diagnostic de son substrat, de son humidité, de sa végétation ou de la neige et de la glace. Ce sont des vues du même layer Render v2 ; la saison et le terrain sont conservés.',
    terrainSource: () => {
      const value = (document.getElementById('terrainSource') as HTMLSelectElement).value;
      return value === 'procedural-phasor' ? 'Relief compact : bruit, érosion régionale sur une grille réduite et détail Phasor sur GPU. Trois qualités et six profils climatiques. Le CPU est une référence plus lente. Cliquez pour lire la méthode.'
        : value === 'procedural' ? 'Procédural : les zones modulent les propriétés locales des bruits, du soulèvement et des crêtes avant l’érosion. Les montagnes sont générées dans leur masque, avec leur géographie interne. La génération zonée utilise Rust ; l’échantillonnage peut rester GPU.'
        : value === 'neural-wasm' ? 'Neuronal WASM : Terrain Diffusion sur le GPU du navigateur. Les zones produisent le conditionnement régional et les contraintes locales de relief ; les réseaux génèrent les détails. Environ 162 Mo de modèles au premier chargement, puis cache. Le réseau produit 40 × 40 km avant découpe ou mise à l’échelle.'
        : 'Neuronal Python : Terrain Diffusion via le service local PyTorch/CUDA. Même entrée régionale que WASM, avec un modèle et une précision différents. Le résultat n’est donc pas identique. Le service doit être démarré.';
    },
    phasorQuality: () => 'Qualité du relief compact : Rapide réduit la grille et les cycles régionaux ; Détaillée les augmente. La sortie physique reste à 1024². Cliquez pour lire la méthode.',
    phasorIntensity: () => 'Amplitude du détail Phasor, de 0 à 2. Zéro conserve la même érosion régionale sans détail. Le Phasor ne garantit pas le drainage et peut ajouter des dépressions. Cliquez pour lire la méthode.',
    relief: () => 'Relief de fond dans les parties non peintes. Les zones remplacent localement ses paramètres de génération : plaine, collines, montagnes ou hautes montagnes. La gomme rend la main à ce relief de fond. Une heightmap importée conserve ses altitudes ; les cavernes utilisent un autre modèle.',
    width: () => 'Largeur de la carte carrée, en mètres. Une heightmap couvre toujours toute cette surface. Changer la largeur étire son relief horizontalement, sans changer les altitudes.',
    seed: () => 'La graine reproduit les choix aléatoires avec les mêmes paramètres et le même moteur. Elle ne remplace pas une heightmap importée.',
    auto: () => 'Recalcule quand un paramètre change ou à la fin d’un trait de zones. Désactivez Auto pour préparer plusieurs régions, puis utilisez « Générer le relief ».',
    motifSize: () => 'Taille physique des formes, indépendante de la largeur de carte. Une chaîne de 3 km garde cette taille sur une carte plus grande.',
    erosion: () => 'Dose d’érosion du relief procédural ou de la heightmap : 0 % pour observer l’entrée sans érosion, 100 % pour la dose normale, jusqu’à 200 %. La génération neuronale utilise son propre modèle ; reprenez son résultat en Heightmap → éroder pour lui appliquer l’érosion Rust.',
    generationCompute: () => 'CPU : référence Rust. GPU fine noise : petits bruits sur GPU. GPU all noise : tous les bruits sur GPU. GPU erosion : relief et érosion compatibles sur GPU. Les masques de zones pilotent la simulation Rust, avec échantillonnage GPU possible. Les sources neuronales utilisent leur runtime propre.',
    compute: () => 'Moteur d’échantillonnage du relief pour la vue. WASM calcule sur CPU ; WebGPU utilise le GPU avec repli CPU. Ce choix est distinct du calcul initial de génération et du style de rendu.',
    hydroEngine: () => 'Moteur de calcul des lacs et rivières à partir du relief résultant. Rust utilise le réseau natif ; Vector conserve l’ancien pipeline. Recalculer l’eau préserve l’entrée terrain et les côtes déjà appliquées.',
    hydroCompute: () => 'Calcule le drainage sur CPU/WASM ou GPU lorsque disponible. Le réseau final suit le relief, les dépressions et les sorties de carte.',
    hydroCondMode: () => 'Modification physique du relief avant le drainage : érosion fluviale, ouverture des seuils, ou les deux. Choisir None pour conserver le terrain avant calcul de l’eau.',
    proceduralInspector:()=> 'Pipeline de la génération principale, CPU Rust/WASM, GPU ou Rust natif (préréglages classique et compact) : paramètres dans l’ordre, opérations activables, exécution pas à pas et aperçus conservables. Tropical renforce l’érosion hydraulique ; aride ajoute le transport éolien. Le mode normal reste groupé. Cliquez pour lire la méthode.',
    climate: () => ['procedural','procedural-phasor'].includes((document.getElementById('terrainSource') as HTMLSelectElement).value) ? 'Les profils érosifs sont activables dans l’inspecteur : tropical hydraulique, aride éolien, froid thermique. La pluie détaillée module l’eau et le vent. Les paramètres de vent et de conditionnement restent réglables séparément.' : (document.getElementById('terrainSource') as HTMLSelectElement).value === 'procedural-phasor' ? 'Le profil climatique module l’incision, le lissage thermique et le détail Phasor. Ce sont des variations de morphologie, pas une simulation géologique des biomes.' : 'Le climat conditionne la génération neuronale et le bilan d’eau des lacs. Pour le relief procédural, il agit sur l’eau, pas sur les formes du relief.',
    fidelity: () => 'Bruit de conditionnement neuronal : une valeur faible suit plus étroitement l’esquisse. Le réseau voit de grandes cellules (~7,7 km), les petites côtes peintes ne sont donc pas garanties. Heightmap → conserver garde les formes exactes.',
    neuralFit: () => 'Le réseau génère 40 × 40 km. Crop prélève une fenêtre à la taille de la carte ; Scale ajuste l’ensemble des 40 km à la carte.',
    neuralSlopes: () => 'En mode Scale, multiplie aussi les altitudes par le facteur horizontal afin de conserver les pentes.',
    refine: () => 'Ajoute des détails fractals sous la taille des cellules pendant le zoom. Ce sont des détails d’affichage ; les exports heightmap contiennent les altitudes physiques, sans ce détail de zoom.',
    islandMode: () => 'Quand tous les côtés sont marins, choisit une île, plusieurs îles ou un choix seedé. En mode heightmap, les altitudes négatives définissent directement la mer.',
    environment: () => 'Relief entourant les formes locales comme plateau, volcan ou caldeira, utilisé dans la génération procédurale.',
    mountainMix: () => 'Proportion de montagnes dans le relief mixte. L’esquisse peut ensuite imposer leur emplacement général.',
    style: () => (document.getElementById('style') as HTMLSelectElement).value === 'render3d-brush'
      ? 'Render3DBrush utilise les silhouettes Fantasy adaptées au biome dans le matériau forestier de Render3D : mêmes teintes, densité, clairières et niveaux de détail. Les couronnes débordent sur les rivières et les courbes de niveau restent au-dessus. Cliquez pour lire la méthode.'
      : 'Le style définit les couleurs et matériaux de la carte, dont un même dégradé pour toutes les mers et tous les lacs. Les couches choisissent les éléments visibles. Les brushes peuvent suivre l’occupation du territoire en option.',
    brush_landuse: () => 'Les arbres suivent les forêts générées et évitent les montagnes. Champs, vergers et marais reçoivent leurs motifs. Masquer l’occupation ne désactive pas son influence. Sans occupation générée, seuls les motifs de relief restent.',
    brush_size: () => 'Multiplie la taille des motifs, indépendamment de leur densité et de leur espacement. La taille de base est réduite de 45 % ; le curseur permet de descendre jusqu’à ×0,1.',
    hydroOverlay: () => 'Un diagnostic visualise une donnée de calcul. Altitude remplace les couleurs du terrain ; les autres diagnostics se superposent à la carte. Ils ne modifient ni le style choisi ni les masques de génération.',
    showWater: () => 'Affiche ou masque toute l’eau : mer, lacs et rivières. Lakes et Oxbows permettent de masquer séparément les lacs et les anciens chenaux.',
    projection3d: () => 'Survol du relief avec raffinement progressif du maillage. Render3D utilise un matériau de sol en coordonnées monde, partagé avec la vue 2D.',
    refinement3d: () => 'Source conserve les altitudes retenues. Noise multiscale ajoute un détail procédural déterministe. Neural Earth compare Classique, Phasor, Hybride et MSE sur le même relief via le service local. Ces détails ne recalculent pas l’hydrologie régionale. Cliquez pour lire la méthode.',
    forestEnabled: () => 'Forêt procédurale de Render3D, calculée une fois sur le relief retenu : couvert, hauteur, mélange feuillus/résineux, houppiers et ombres de lisière. La carte 2D, la vue 3D et l’export raster lisent le même champ. Décochée, Render3D retrouve exactement son ancien rendu, avec la teinte forestière grossière d’origine. L’occupation agricole appliquée découpe la forêt dans l’étape Settlements, où la vue 3D n’est pas disponible.',
    forestDensity: () => 'Ajuste le couvert issu du climat et du relief, c → 1 − (1 − c)^densité : 100 % le conserve, 0 % retire la forêt naturelle, 200 % le densifie sans dépasser le couvert complet. Les bois de l’occupation appliquée restent boisés. Aucun terrain n’est régénéré.',
    forestClearings: () => 'Clairières d’environ 100 à 400 m : environ 40 % de la surface boisée à 100 % (18 % par défaut ; 85 % de moins en climat tropical humide, soit environ 3 % par défaut), ouvertes d’abord sur les terrains doux et les crêtes ; les pentes raides restent boisées. 0 % : massifs continus. Les champs, prés et bourgs appliqués restent ouverts quel que soit ce réglage.',
    tileBounds3d: () => 'Superpose les limites des tuiles affichées pour examiner leurs raccords. Cette option ne change ni le relief ni son niveau de détail.',
  };
  const tip = document.createElement('div'); tip.id = 'terrainHelpText'; tip.className = 'terrain-help-text'; tip.setAttribute('popover', 'auto'); tip.setAttribute('role', 'note'); document.body.append(tip);
  let current: HTMLButtonElement | undefined, refreshCurrent: (() => void) | undefined;
  const refreshLabels: (() => void)[] = [];
  const refreshLocale = (): void => { for (const update of refreshLabels) update(); refreshCurrent?.(); };
  window.addEventListener('magna-locale-change', refreshLocale);
  window.addEventListener('storage', event => { if (event.key === LOCALE_KEY) refreshLocale(); });
  tip.addEventListener('toggle', () => { if (!tip.matches(':popover-open')) { current?.setAttribute('aria-expanded', 'false'); current = undefined; refreshCurrent = undefined; } });
  function attach(control: Element, explain: () => string): void {
    const label = control.closest('label') ?? control;
    const row = document.createElement('div'); row.className = 'terrain-help-row'; label.before(row); row.append(label);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'terrain-help'; button.textContent = '?';
    const refreshLabel = (): void => {
      const title = Array.from(label.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
      button.setAttribute('aria-label', `${urbanText(['Aide','Help','帮助','Ayuda','Ajuda'])} : ${title || urbanText(['terrain','terrain','地形','terreno','terreno'])}`);
    };
    refreshLabels.push(refreshLabel); refreshLabel(); button.setAttribute('aria-controls', tip.id); button.setAttribute('aria-expanded', 'false');
    row.append(button);
    const method = (): MethodNoteId | undefined => control.id === 'proceduralInspector' ? 'procedural-generation-stages' : ['phasorQuality','phasorIntensity'].includes(control.id) || control.id === 'terrainSource' && (control as HTMLSelectElement).value === 'procedural-phasor' ? 'compact-terrain-phasor' : control.id === 'refinement3d' ? 'neural-earth-amplification' : control.id==='renderV2Season'||control.id==='renderV2Diagnostic'||control.id==='style'&&(control as HTMLSelectElement).value.startsWith('render-v2')?'render-v2': control.id === 'style' && (control as HTMLSelectElement).value === 'render3d-brush' ? 'render3d-brush'
      : ['brush_landuse', 'brush_size'].includes(control.id) ? 'fantasy-landuse'
      : ['forestEnabled', 'forestDensity', 'forestClearings'].includes(control.id) ? 'render3d-vegetation' : ['projection3d', 'refinement3d', 'tileBounds3d'].includes(control.id)
      || control.id === 'style' && (control as HTMLSelectElement).value === 'render3d' ? 'render3d-ground' : undefined;
    const refresh = (): void => {
      tip.textContent = terrainHelpText(explain());
      if (method()) tip.append(urbanText([' Cliquez sur ? pour lire la note scientifique en anglais.',' Click ? to read the scientific note in English.',' 点击 ? 阅读英文科学说明。',' Pulsa ? para leer la nota científica en inglés.',' Clique em ? para ler a nota científica em inglês.']));
    };
    const show = (): void => {
      current?.setAttribute('aria-expanded', 'false'); current = button; refreshCurrent = refresh; refresh();
      tip.showPopover(); button.setAttribute('aria-expanded', 'true');
      const b = button.getBoundingClientRect(); tip.style.left = `${Math.min(b.left, Math.max(8, innerWidth - Math.min(340, innerWidth - 16) - 8))}px`;
      tip.style.top = `${Math.max(8, Math.min(b.bottom + 6, innerHeight - tip.offsetHeight - 8))}px`;
    };
    const hide = (): void => {
      if (current !== button) return;
      tip.hidePopover(); button.setAttribute('aria-expanded', 'false'); current = undefined; refreshCurrent = undefined;
    };
    button.addEventListener('mouseenter', show);
    button.addEventListener('mouseleave', hide);
    button.addEventListener('focus', () => { if (button.matches(':focus-visible')) show(); });
    button.addEventListener('blur', hide);
    button.addEventListener('click', () => {
      const note = method();
      if (note) { hide(); openMethodNote(note); }
      else show();
    });
    control.addEventListener('input', () => { if (current === button) refresh(); });
  }
  for (const [id, explain] of Object.entries(explanations)) { const control = document.getElementById(id); if (control) attach(control, explain); }
  const input = document.querySelector('#terrainSketchEditor [data-id=input]');
  if (input) attach(input, () => 'Relief automatique : la famille choisie définit la carte. Zones peintes : vous dessinez des masques d’opération ; le moteur génère leurs reliefs. Les zones ne contiennent aucune altitude. Heightmap : import/export d’un raster existant, conservé ou érodé séparément.');
  for (const [id, explanation] of Object.entries({
    tool: 'Choisit l’opération locale : mer, plaine, collines, montagnes ou hautes montagnes. Le moteur produit ses propres formes dans chaque zone. La gomme retire les opérations et retrouve le relief de fond.',
    radius: 'Rayon du pinceau en pourcentage de la largeur de carte. Le cercle montre la zone touchée. Avec le neuronal, préférez de larges régions correspondant à ses cellules de conditionnement.',
    feather: 'Partie extérieure du rayon où le poids du masque décroît progressivement. Une transition large raccorde les régimes de relief ; une transition courte crée des limites plus marquées.',
  })) {
    const control = document.querySelector(`#terrainSketchEditor [data-id=${id}]`);
    if (control) attach(control, () => explanation);
  }
  const coasts = document.getElementById('coastControl');
  if (coasts) attach(coasts, () => 'Ces directions définissent les côtes automatiques. Le masque Mer ajoute des régions marines à la génération et le moteur construit leur littoral. La gomme retire une zone manuelle ; elle ne retire pas les côtes automatiques.');
}
