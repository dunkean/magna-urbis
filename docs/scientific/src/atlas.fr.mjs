// Atlas des méthodes, édition française. Traduction complète de atlas.en.mjs (la source anglaise fait foi).
// Jetons dans les corps : [[fig:nom|légende]] schéma en ligne, [[wide:nom|légende]] schéma pleine largeur,
// [[img:fichier|alt|légende]] une capture, [[gallery:fichier|légende;fichier|légende;…]] une grille de captures.
// Les cartes d’étape listées dans `stages` sont ajoutées depuis stages.mjs.

export const meta = {
  title: 'Comment fonctionne Magna Urbis · Atlas des méthodes',
  description: 'Comment Magna Urbis construit un monde, de la carte d’altitude au dernier toit : étapes, algorithmes, réglages, coûts et limites.',
  heroTitle: 'De la carte d’altitude au dernier toit.',
  lead: 'Magna Urbis génère des paysages, des établissements et des villes pour des cartes et des jeux de table. Cet atlas suit un monde à travers chaque étape que l’application exécute : il dit ce que l’étape calcule, quelle méthode elle emploie, ce que l’on peut modifier, et où le résultat reste une approximation.',
  heroCaption: 'Une coupe de paysage à travers les couches que construit le générateur, dans l’ordre où il les construit. Dessin original, hors échelle.',
  facts: [['47', 'étapes de génération et de carte'], ['115', 'cultures architecturales'], ['7', 'styles de rendu'], ['11 × 4', 'zones climatiques × saisons'], ['138 s', 'une ville d’un million d’habitants']],
  partRegion: 'La région', partSettle: 'Lieux et routes', partTown: 'Les villes', partMap: 'La carte', partMore: 'Mécanique et limites',
  stagesHead: 'Étapes de ce chapitre',
  labels: { what: 'Quoi et pourquoi', how: 'Méthode', io: 'Entrées et sorties', ctl: 'Réglages', cost: 'S’exécute sur', code: 'Code', required: 'Obligatoire', optional: 'Peut être désactivée',
    when: { always: 'Toujours', procedural: 'Relief procédural', neural: 'Relief neuronal', heightmap: 'Carte d’altitude', 'after-relief': 'Après le relief', 'after-sites': 'Après les sites', city: 'Par ville', display: 'Affichage' } },
  filter: 'Filtrer les chapitres et les étapes', filterPh: 'p. ex. lac, parcelle, neige', filterStatus: '{n} résultats',
  railNote: 'Chaque « ? » à côté d’une étape dans l’application ouvre sa carte ici.',
};

export const chapters = [
{ id: 'overview', part: 'region', title: 'Une recette, quatre familles, un monde conservé', kicker: 'Comment lire l’application et cet atlas.',
  body: `
<p>Un monde Magna Urbis est décrit par une <strong>recette</strong> : la graine, la taille de la carte, la source du relief et chaque réglage. La même recette sur le même moteur donne le même monde, c’est pourquoi un lien de partage ou un projet enregistré suffit à reconstruire une carte.</p>
<p>L’application exécute la recette sous forme d’<strong>étapes</strong> regroupées en quatre familles. La <em>région</em> construit le sol, ses eaux et son couvert naturel. Les <em>établissements</em> placent villes, villages, fermes et les routes qui les relient. Les <em>villes</em> se construisent une à une, de leur emprise jusqu’à leurs toits. La <em>carte</em> dessine le tout dans l’un des sept styles, en 2D ou en 3D. Chaque famille conserve ses produits : modifier un réglage ne relance donc que les étapes en aval, et changer l’aspect de la carte ne relance jamais la génération.</p>
[[wide:families|Les quatre familles d’étapes. Chaque colonne conserve ses produits ; les flèches montrent ce que lit la famille suivante.]]
<h3>Comment les étapes sont documentées</h3>
<p>Chaque étape de l’application a une carte dans cet atlas, sous le chapitre qui l’explique. Une carte dit ce que l’étape calcule et pourquoi, la méthode réellement employée dans le code, ses entrées et ses sorties, les réglages et leur effet visible, et où elle s’exécute. Les étapes facultatives peuvent être désactivées dans l’application ; les étapes obligatoires, non.</p>
<div class="callout"><b>Une précision sur les affirmations.</b> Magna Urbis combine des algorithmes publiés et ses propres heuristiques. Une rivière plausible n’est pas une prévision hydrologique, un plan de médina n’est pas une reconstitution archéologique, et une population demandée est un objectif, non un recensement. Lorsqu’un résultat est une approximation, le chapitre le dit.</div>
`, stages: [] },

{ id: 'relief', part: 'region', title: 'Relief : trois sources, une surface', kicker: 'Évolution procédurale du paysage, diffusion neuronale ou carte d’altitude importée.',
  body: `
<p>Le relief est un champ d’altitudes signé, en mètres au-dessus du niveau de la mer, conservé à une résolution physique fixe pendant toute l’exécution. Il provient d’une seule des trois sources, et toutes les trois aboutissent à la même chaîne de finition partagée : tout ce qui vient ensuite lit donc un seul type de surface.</p>
[[wide:relief|Trois sources de relief convergent vers une surface conservée. Les étapes procédurales travaillent sur deux grilles : une grille régionale grossière pour l’évolution du paysage et une grille de surface fine pour le détail et l’érosion.]]
<h3>Relief procédural</h3>
<p>La source procédurale part d’un bruit cohérent, modelé par des zones facultatives peintes (plaine, collines, montagnes, hautes montagnes). Les zones sont des masques qui orientent les opérateurs ; elles ne fixent jamais directement une altitude. Des volcans et des caldeiras tirés au sort ajoutent des rebords lobés, des brèches et des cheminées emboîtées.</p>
<p>Le cœur de la chaîne est une <strong>évolution du paysage</strong> bornée sur la grille régionale : chaque cycle applique un soulèvement tectonique, achemine l’eau vers l’aval, incise les chenaux selon une loi de puissance fluviale, puis détend les pentes par effondrement thermique et diffusion. Le résultat est reconstruit sur la grille fine avec une déformation de domaine, calibré sur l’amplitude de la famille de relief choisie, enrichi d’un détail en crêtes ou en bruit de phaseurs, puis d’une dernière passe d’érosion de surface. Depuis novembre, chaque opérateur de surface s’adapte à la taille de la cellule : la même recette donne donc les mêmes formes de terrain sur une carte de 5 km comme de 50 km.</p>
<h3>Où l’on découpe la côte</h3>
<p>Le découpage terre–mer est une étape à part entière que l’on peut déplacer le long de la chaîne : juste après le bruit initial par défaut, ou plus tard, après la détente, la calibration, le détail, l’érosion de surface ou la normalisation du niveau de référence. Quoi qu’il arrive après lui, la chaîne de finition réapplique le découpage géographique pour que le trait de côte choisi subsiste, puis l’érode.</p>
<h3>Cartes d’altitude importées</h3>
<p>Une carte d’altitude importée ou issue de la bibliothèque est rééchantillonnée dans le cadre, mise à l’échelle verticalement, dotée d’un niveau de référence et recadrée. Elle saute les étapes génératives mais passe par la même finition.</p>
`, stages: ['relief-source', 'relief-climate', 'relief-mask', 'relief-grids', 'relief-noise', 'relief-coast-cut', 'relief-regional', 'relief-relax', 'relief-reconstruct', 'relief-calibrate', 'relief-detail', 'relief-surface', 'relief-datum', 'relief-phasor', 'relief-heightmap-fit'] },

{ id: 'neural', part: 'region', title: 'Relief neuronal', kicker: 'Un modèle de diffusion conditionné par le climat et par une esquisse facultative.',
  body: `
<p>La source neuronale échantillonne un modèle de diffusion à trois étages entraîné sur des données d’altitude réelles. Un étage grossier à 7,68 km par cellule est conditionné par le climat (température, précipitations et leur variabilité) et par une esquisse facultative. Un étage de base l’affine à 240 m, et un décodeur l’amène à 30 m, avec une amplification facultative qui ajoute un résidu à la spline conservée. Chaque étage est échantillonné en coordonnées de tuiles globales avec un halo, de sorte que les tuiles se raccordent sans couture.</p>
<p>Le modèle s’exécute dans le navigateur grâce à Rust compilé en WebAssembly avec WebGPU, ou dans le service Python local facultatif avec CUDA. Seul le terrain décodé est exposé ; les étages intermédiaires n’ont pas d’aperçu séparé.</p>
<div class="callout limit"><b>Limite.</b> Un modèle appris reproduit les statistiques de ses données d’entraînement. Il ne simule pas la géologie, et sa sortie n’est pas un lieu mesuré.</div>
`, stages: ['relief-neural-coarse', 'relief-neural-base', 'relief-neural-decoder'] },

{ id: 'finishing', part: 'region', title: 'Finition de la surface, et le monde en dessous', kicker: 'Opérateurs partagés que tout relief traverse, et couche facultative du monde souterrain.',
  body: `
<p>Quelle que soit la source, quatre opérateurs finissent la surface. Le <strong>raffinement fractal</strong> ajoute un détail dépendant de la pente en deçà de la taille de cellule de la source, avec son propre exposant de Hurst, sa lacunarité et ses octaves. Le <strong>conditionnement fluvial</strong> perce ou érode les dépressions pour que l’eau puisse quitter la terre. Le <strong>transport éolien</strong> déplace la matière selon un azimut pour les dunes et le loess. L’<strong>érosion côtière</strong> façonne le rivage choisi.</p>
<h3>Monde souterrain</h3>
<p>Le monde souterrain (« underdark ») est une couche du monde, non une étape : lorsqu’on le choisit, il creuse une fois la surface finie, avant l’hydrologie, pour en faire un monde de cavernes. Le relief devient la roche au-dessus ; le drainage devient le réseau de galeries.</p>
[[wide:underdark|Le creusement du monde souterrain en sept étapes (rust/crates/terrain/src/underdark.rs). L’hydrologie s’exécute ensuite sur la surface creusée.]]
[[img:underdark.webp|Vue satellite peinte d’une carte du monde souterrain : parois rocheuses sombres, sols de cavernes pâles, lacs conservés en bleu.|Une carte du monde souterrain dans le style satellite peint. Le champ de roche est doux : les parois s’estompent au lieu de former des marches.]]
`, stages: ['relief-refine', 'relief-conditioning', 'relief-aeolian', 'relief-coasts'] },

{ id: 'water', part: 'region', title: 'Eau : drainage, lacs, rivières et embouchures', kicker: 'Un graphe de drainage et un bilan hydrique, puis des rivières vectorielles.',
  body: `
<p>L’eau est calculée une seule fois sur la surface finie par la chaîne d’eau vectorielle en Rust. Elle commence par conditionner le relief pour que chaque cellule puisse s’écouler, en perçant des cols jusqu’à 8 m de profondeur avec des berges en forme de vallée ou en gradins. Une passe <strong>Priority-Flood</strong> donne ensuite à chaque cellule une direction vers l’aval et à chaque dépression un point de débordement.</p>
<p>Les dépressions sont les endroits où des lacs peuvent se former, mais seulement si le climat peut les alimenter. Pour chaque bassin fermé, la chaîne calcule un <strong>bilan hydrique</strong> à partir de la température, de l’altitude et des précipitations ; un bassin ne garde un lac que si le ruissellement peut le soutenir et si les tests de profondeur, de surface et de couverture sont réussis. Les autres sont percés ou comblés. Le réglage d’abondance des lacs déplace ces seuils.</p>
[[wide:water|La chaîne d’eau. La formule du bilan est une évapotranspiration de type Turc corrigée de l’altitude.]]
<h3>Des rivières qui se tiennent bien</h3>
<p>Une fois les lacs décidés, les rivières qui passent à côté d’un lac y sont captées, et les aires amont sont de nouveau sommées pour que le débit reste cohérent. Les têtes de rivière peuvent se prolonger en remontant le talweg, les éperons de moins de 150 m sont supprimés, et les rivières vectorielles reçoivent une largeur, un lit et des méandres.</p>
<p>Les embouchures sont façonnées en dernier. Une rivière s’élargit vers la mer ou un lac selon un profil exponentiel, comme le font les estuaires, sans jamais se rétrécir à nouveau, et sa surface d’eau finit au niveau de la mer sans remonter vers le large. Les grandes rivières sur des côtes douces peuvent s’ouvrir en entonnoir ou en estuaire de marée.</p>
[[fig:mouth|Embouchure en plan. La largeur au niveau de l’eau dépend du débit et de la pente des berges ; deux embouchures voisines ne se chevauchent jamais.]]
<div class="callout limit"><b>Limite.</b> Le bilan est annuel et statique. Il n’y a ni crues, ni nappes, ni régime saisonnier ; la glace des rivières et la neige sont dessinées par le moteur de rendu à partir de la saison, non simulées.</div>
`, stages: ['water-hydrology'] },

{ id: 'cover', part: 'region', title: 'Climat et couvert naturel', kicker: 'Forêts, clairières et plages à partir du climat, du relief et de l’eau.',
  body: `
<p>Le climat entré avec le relief (température moyenne, son amplitude saisonnière, précipitations et leur variabilité) est réutilisé pour le couvert naturel. La densité forestière suit l’humidité, la température et la pente ; les berges et les plages ont leurs propres règles, et la largeur des plages suit le climat. Le champ forestier est un produit de la région : les établissements le défrichent, et la carte le dessine sous forme de symboles, de pinceaux peints ou de canopée procédurale selon le style.</p>
<p>Les saisons ne changent pas le monde généré. Elles sont appliquées au moment du rendu à partir d’un calendrier de onze zones climatiques, qui fixe pour chaque moment de l’année la teinte de l’herbe, les feuilles, la couverture de neige, la glace des rivières et des lacs et la banquise (voir <a href="#map">le chapitre sur la carte</a>).</p>
`, stages: ['cover-climate'] },

{ id: 'settlements', part: 'settle', title: 'Établissements et campagne', kicker: 'Où vont les lieux, quelle est leur taille, et ce qui les entoure.',
  body: `
<p>Les lieux sont choisis sur la région finie. Chaque cellule sèche reçoit un score de site (eau, pente, côte, franchissements de rivière, défense), et les lieux sont retenus de façon gloutonne avec un espacement minimal, chacun réservant une emprise urbaine. On peut demander un nombre de lieux tirés d’une loi de taille, ou donner une liste explicite ; un lieu de la liste qui tombe dans l’eau est déplacé vers le site sec convenable le plus proche, avec un avertissement, de sorte qu’une liste est toujours respectée.</p>
<p>Les tailles suivent une <strong>loi rang-taille</strong> : le lieu de rang r compte la population du plus grand divisée par r<sup>q</sup>, jusqu’à un minimum. Le nombre de rangs dépend du nombre de lieux que peut porter la terre utilisable.</p>
[[wide:settlements|À gauche : la loi rang-taille. À droite : ce qui grandit autour d’un lieu.]]
<h3>La campagne</h3>
<p>Les fermes sont placées à portée des terres cultivables de leur lieu parent, avec quelques fermes isolées plus loin. Chacune prend un type de ferme propre à sa culture, de la ferme autrichienne à quatre ailes à la longère bretonne, à la masseria des Pouilles, à la minka japonaise ou au kraal d’Afrique australe, avec son propre plan au sol et son propre volume. Les terres cultivées suivent la population et restent à distance de marche des paysans. Les hameaux et les villages reçoivent une chapelle juste à l’extérieur, et des oratoires de bord de route marquent les carrefours. Les petits lieux sont construits en arrière-plan après une exécution.</p>
<h3>Lieux reculés</h3>
<p>Des sites rares sont choisis selon leur situation : sommets, rochers, corniches, gorges, îlots, forêt profonde ou îles de marais. Leur accès est un escalier de falaise, des marches taillées, une chaussée, un pont de cordes, un tunnel ou un sentier, et une ligne d’accès qui rejoint une route s’arrête sur elle au lieu de laisser un éperon.</p>
`, stages: ['settle-sites', 'settle-hierarchy'] },

{ id: 'roads', part: 'settle', title: 'Routes régionales', kicker: 'Quels lieux relier, puis comment une route traverse réellement le terrain.',
  body: `
<p>Les routes se construisent en deux temps : décider quels lieux relier, puis trouver des tracés physiques. Les liaisons candidates forment un graphe de Delaunay des lieux, réduit à un arbre couvrant minimal, auquel s’ajoutent des raccourcis là où l’arbre impose un long détour.</p>
<p>Chaque liaison est ensuite acheminée par une recherche de moindre coût sur le terrain. Un pas peut aller vers l’un de 24 voisins (les 8 cellules adjacentes, les mouvements de cavalier et des mouvements (1, 3) plus longs), et l’état de la recherche inclut le cap d’arrivée : virages, pentes et franchissements de rivière ont donc tous un prix. Les trajets les plus importants sont acheminés en premier. Réutiliser une route existante coûte moins cher que d’en construire une, et les cellules juste à côté d’une route coûtent plus cher que la route elle-même, si bien que les itinéraires partagent un tronc commun ou gardent une distance nette.</p>
[[wide:roads|Routes régionales en quatre temps. La géométrie des cellules est illustrative.]]
<p>Tous les tracés sont écrits dans <strong>un seul graphe</strong> dont les sommets sont des cellules de la grille ancrées sur des lieux ou des sorties de carte. Les croisements deviennent des carrefours, les petits triangles perdent leur plus long côté, et les chaînes de sommets de degré deux deviennent des liaisons qui prennent la classe du trajet le plus important qui les emprunte. Le revêtement suit le niveau de développement et la culture. Péages, bacs, auberges et postes-frontières sont lus dans le réseau fini.</p>
`, stages: ['settle-roads'] },

{ id: 'town-plan', part: 'town', title: 'Le plan de la ville', kicker: 'Emprise, macroplan, rues et quartiers, puis élagage.',
  body: `
<p>Une ville est construite par le moteur Rust lorsqu’on la sélectionne, une à la fois ou toutes ensemble. La chaîne lit la région, le graphe routier et la culture du lieu.</p>
[[wide:town|La chaîne de la ville. Entrées en pointillés : revendications des villes voisines et fiche de culture. Boucles colorées : élagage et replanification.]]
<h3>Genre et emprise</h3>
<p>Le <strong>genre</strong> de la ville (d’un bâtiment isolé ou d’une ruine jusqu’à une métropole) suit sa population, sa culture, son site et sa forme d’établissement. Son <strong>emprise</strong> dépense un budget de terrain sur une trame bornée avec un champ d’arrivée anisotrope, si bien que les villes s’étirent le long des vallées, des routes et des rivages. Un relevé du terrain fixe la pente que le plan peut accepter avant le premier tracé, de sorte que les villes de montagne grimpent au lieu d’échouer.</p>
<h3>Villes voisines</h3>
<p>Les villes sont générées dans un ordre fixe, de la plus grande à la plus petite. Chaque ville reçoit les revendications des villes antérieures proches, les terres qu’elles occupent et leurs rues de bordure : elle évite ces terres, rejoint ces rues, déplace son centre si nécessaire et avertit lorsque la terre vient à manquer.</p>
[[wide:neighbours|À gauche : une ville ultérieure évite les terres revendiquées par une ville antérieure et rejoint ses rues. À droite : le gradient de densité facultatif entre les phases.]]
[[img:neighbours.webp|Deux villes côte à côte, l’une en orange et l’autre en bleu, leurs rues réunies à la limite.|Deux villes voisines générées dans l’ordre. La seconde évite les terres de la première et rejoint ses rues de bordure.]]
<h3>Macroplan, rues et quartiers</h3>
<p>Le macroplan est d’abord de la géographie : il garde les couloirs routiers régionaux, partitionne la terre ferme, place les ports sur des fronts d’eau enracinés en terrain sec, et dispose remparts, portes et phases culturelles (noyau, couronne, faubourgs). Les rues sont découpées récursivement dans chaque quartier, guidées par un champ de directions, et acheminées localement autour des obstacles. Les quartiers sont calculés en parallèle avec un flux aléatoire chacun, de sorte que le résultat ne dépend pas du nombre de fils d’exécution. Les rues ne reposent jamais sur l’eau : un tronçon mouillé devient un tablier de pont ou s’arrête avant la berge.</p>
<p>Les fortifications suivent la culture : murailles avec tours, portes, bastions et fossés, palissades ou haies. Une muraille peut prolonger une plus ancienne, les châteaux prennent les buttes, et les villes fortifiées sont remplies jusqu’à la rue d’enceinte. Les sources à l’intérieur d’une ville reçoivent un bâtiment hydraulique choisi par sa culture, et certaines cultures ajoutent des quartiers informels en bordure.</p>
<h3>Élagage</h3>
<p>Le premier plan est généreux. L’élagage lance une sonde peu coûteuse du parcellaire, transforme les îlots qui resteraient vides en champs ou en terrain libre et taille les ruelles qui les desservaient, jusqu’à ce que plus rien ne change (huit passes au plus), puis lance une passe des portes après les ponts. Les rues de berge isolées, les triangles de carrefour et les tracés doublés sont supprimés.</p>
`, stages: ['city-composition', 'city-roads', 'city-quarters', 'city-trim'] },

{ id: 'parcels', part: 'town', title: 'Parcelles et programme', kicker: 'Qui possède quelle bande de front de rue, et à quoi sert chaque lot.',
  body: `
<p>Chaque îlot est divisé en <strong>parcelles</strong> qui donnent sur une rue, avec quatre opérateurs de découpe choisis par la culture (bandes, îlots périmétriques, cours, enclos) et des variantes pour les villes organiques, les camps, les ruines et les monuments. Une parcelle doit toucher un segment d’accès sur une longueur réelle et contenir du terrain constructible ; les cellules en trop sont fusionnées dans les voisines occupées. Les identifiants de parcelle survivent au nettoyage, de sorte que les modifications tiennent.</p>
<p>Le <strong>programme</strong> attribue ensuite les usages. La demande provient de la population et des tables de rôles de la culture : les édifices marquants et les grands programmes réservent d’abord des îlots entiers, puis les métiers et les boutiques prennent les lots de rue, puis l’habitat, et les restes deviennent jardins et cours. La taille des ménages est une donnée de culture, non une constante. Pas plus de 3 % du plan ne peut transformer des îlots d’habitat en communs, parcs ou cimetières.</p>
[[wide:lot|Des parcelles à une silhouette élevée : découper, attribuer, prévisualiser l’occupation, élever.]]
<p>Une grande ville produit beaucoup de données. Les parcelles peuvent être renvoyées en JSON ou dans un paquet binaire compact ; pour une ville d’un million d’habitants, le paquet pèse 151 Mo contre 536 Mo de JSON.</p>
`, stages: ['city-parcels', 'city-programme'] },

{ id: 'buildings', part: 'town', title: 'Bâtiments et leurs formes', kicker: 'Le bâtiment affiché est la silhouette planifiée, élevée.',
  body: `
<p>Les sites de bâtiment sont des intentions de placement neutres, diffusées par le moteur sous forme de lignes typées. L’aperçu d’occupation de chaque lot (un corps sur rue, une aile arrière, une aile de cour, une nef, une tour) est élevé pièce par pièce par l’étape de <strong>volumétrie</strong> : chaque pièce reçoit son propre nombre d’étages, sa hauteur d’égout et son toit. Ce que l’on voit sur la carte est donc la silhouette voulue par le plan, et non une maison posée dans un lot.</p>
<p>Les étages suivent la fourchette de la tradition de construction de la culture. Les styles modernes ajoutent une échelle de population : des tours apparaissent à partir d’environ 50 000 habitants, les immeubles de style haussmannien gardent cinq à sept niveaux.</p>
<h3>Le moteur de formes</h3>
<p>Les maisons détaillées proviennent d’un moteur de formes qui compose des masses étiquetées en un plan (barre, L, T, cour, croix ou H) avec des extras comme des appentis, porches, bow-windows, tourelles, cheminées et lucarnes, et les couvre de toits composés : noues, croupes, demi-croupes, toits à la Mansart et mansardes. Les bâtiments singuliers (temples, mosquées, châteaux, halles, marchés, moulins, ouvrages utilitaires) viennent de familles partagées entre cultures. Une fiche de style hybride peut mêler des cultures facette par facette, par exemple les rues d’une culture avec les maisons d’une autre.</p>
[[wide:forms|Le vocabulaire du moteur de formes : plans de maisons et types de toits.]]
<p>Le <a href="catalogue-architecture-fr.html">catalogue des styles architecturaux</a> montre ce que produit chacune des 115 cultures.</p>
[[gallery:view-3d-parchment.webp|Ville d’al-Andalus en 3D, style parchemin.;view-3d-chinese.webp|Ville chinoise fortifiée en 3D, style satellite.;view-3d-satellite.webp|Oppidum celte et sa campagne en automne.]]
`, stages: ['city-buildings', 'city-houses'] },

{ id: 'map', part: 'map', title: 'Dessiner la carte', kicker: 'Sept styles, une recette par passe, des saisons, et deux moteurs de dessin.',
  body: `
<p>La carte lit le monde conservé et ne le modifie jamais. Un <strong>style</strong> n’est qu’un préréglage d’une recette par passe : sol, relief, végétation, occupation du sol rurale et urbaine, eau, routes, bâtiments, ambiance, texte et légende ont chacun leurs réglages, et un style personnalisé est marqué d’un astérisque.</p>
[[gallery:style-parchment.webp|Parchemin, la vue par défaut, adaptée au biome.;style-satellite.webp|Satellite, sol matérialisé et canopée procédurale.;style-painted.webp|Satellite peint.;style-topographic.webp|Topographique, courbes de niveau et emprises bâties.;style-cadastre.webp|Cadastre, emprises bâties et occupation du sol en couleurs de catégorie.;style-atlas.webp|Atlas.;style-night.webp|Ambiance nocturne sur parchemin.;season-snow.webp|Hiver sur le style satellite.]]
<h3>Saisons</h3>
<p>Chacune des onze zones climatiques (tempérée, méditerranéenne, continentale, nordique, alpine, arctique, steppe, désert, savane, tropicale, zone humide) a un calendrier de quatre lignes saisonnières : teinte de l’herbe, feuilles, neige, dégel et banquise. La palette de chaque style vectoriel le suit, les shaders lisent le même calendrier, et l’on peut modifier l’année d’une zone. La neige est une couverture continue modelée par le relief, les rivières et les lacs ne gèlent que là où le sol gèle, et la banquise a des chenaux, des floes et de la bouillie de glace. Sur le parchemin, les saisons ne changent que l’occupation du sol.</p>
<h3>Deux moteurs</h3>
[[wide:render|Du monde conservé aux pixels. Les exports réutilisent la carte affichée.]]
<p>Le sol est dessiné par un moteur de terrain WebGL2 ou WebGPU. Tout ce qui est vectoriel (eau, routes, parcelles, bâtiments, symboles, texte) passe par une seule interface de dessin avec deux moteurs d’arrière-plan : un moteur Canvas 2D sur le processeur, et un moteur GPU qui enregistre une fois les appels de dessin dans une liste d’affichage et la rejoue à chaque image avec la matrice de vue, en utilisant des remplissages pochoir puis couverture, des traits extrudés et des sprites instanciés. Une bande autour de la vue est enregistrée à chaque demi-octave de zoom, si bien que le panoramique et le zoom n’exigent aucune nouvelle tuile. Le moteur GPU bascule sur le processeur en cas de GL logiciel, de contexte perdu ou d’images lentes.</p>
<p>La vue 3D utilise WebGPU, avec WebGL2 en repli, plaque la carte 2D sur le relief, élève les volumes de bâtiments par secteur, et peut ajouter des arbres dans un rayon de 360 m autour de la caméra, qui suivent la saison. On peut orbiter, marcher ou voler.</p>
`, stages: ['display-terrain', 'display-relief', 'display-vegetation', 'display-landuse', 'display-water', 'display-roads', 'display-buildings', 'display-ambience'] },

{ id: 'names', part: 'map', title: 'Noms, légende et exports', kicker: 'Le texte est une couche à part entière de la composition.',
  body: `
<p>Les noms de lieux proviennent de grammaires de toponymie culturelles, une par culture, avec une importance qui décide quels noms survivent à chaque niveau de zoom. Le texte est une couche à part, en 2D et en 3D : toponymes, étiquettes de quartier et de rôle ont leur propre densité, leur taille et leur style, et la légende et le cartouche forment une passe séparée.</p>
<p>Les exports réutilisent ce qui est à l’écran : PNG et SVG de la carte affichée avec ses noms, la carte d’altitude, le projet et la recette. Un mode champ de bataille cadre la vue 3D pour le jeu de table et peut exporter des mosaïques.</p>
`, stages: ['display-text', 'display-labels', 'map-naming', 'map-export'] },

{ id: 'runtime', part: 'more', title: 'Où cela s’exécute', kicker: 'Le navigateur, un moteur natif sur la même machine, et un service neuronal facultatif.',
  body: `
<p>L’interface et le dessin s’exécutent sur le fil principal. La génération s’exécute dans un worker qui met les requêtes en file et garde le monde ; le rendu, la composition, l’export, l’occupation et l’acheminement des routes ont leurs propres workers. Le calcul lui-même est en Rust, compilé de deux façons.</p>
[[wide:runtime|Qui calcule quoi. Chaque service natif n’écoute que sur l’interface de bouclage.]]
<ul>
<li><strong>WebAssembly</strong>, dans le navigateur : multifil lorsque la page est isolée en origine croisée, sinon monofil ou en réserve de workers monofils.</li>
<li><strong>Le moteur natif</strong>, <code>magna-urbis-local</code> sur le port 8791 : relief, eau, côte, occupation du sol, forêt, choix des sites, routes et villes, avec une session par voie de ville et des réponses binaires. L’application de bureau le démarre automatiquement sur un port libre.</li>
<li><strong>Le service neuronal</strong>, facultatif, en Python avec CUDA sur le port 8793. Le relief neuronal s’exécute aussi dans le navigateur avec WebGPU.</li>
</ul>
<h3>À quelle vitesse</h3>
<p>Mesuré le 14 novembre 2026 avec huit fils d’exécution, après la campagne de performance des villes :</p>
<div class="table-wrap"><table><thead><tr><th>Ville</th><th class="num">Avant</th><th class="num">Après</th></tr></thead><tbody>
<tr><td>Médiévale organique, 10 000 habitants, carte réelle</td><td class="num">3,8 s</td><td class="num">2,7 s</td></tr>
<tr><td>Médiévale organique, 50 000 habitants, carte réelle</td><td class="num">20,6 s</td><td class="num">10,1 s</td></tr>
<tr><td>Médiévale organique, 100 000 habitants</td><td class="num">32,5 s</td><td class="num">13,5 s</td></tr>
<tr><td>Médiévale organique, 250 000 habitants</td><td class="num">117 s</td><td class="num">32,8 s</td></tr>
<tr><td>Médiévale organique, 1 000 000 d’habitants</td><td class="num">environ 9 min</td><td class="num">138 s</td></tr>
<tr><td>Halfelin, 10 000 habitants, flanc de montagne</td><td class="num">25,5 s</td><td class="num">10,9 s</td></tr>
</tbody></table></div>
[[img:megacity-1m.webp|Plan d’une ville médiévale organique d’un million d’habitants, un disque brun dense de rues autour d’une rivière.|Une ville d’un million d’habitants, générée par le moteur natif en 138 secondes.]]
<p>Les temps varient beaucoup avec la charge et le nombre de cœurs : la même ville de 50 000 habitants allait de 9,5 à 85 s selon les exécutions. Les rues et les quartiers prennent environ 80 % du temps.</p>
`, stages: [] },

{ id: 'limits', part: 'more', title: 'Limites ouvertes et suite', kicker: 'Ce que le générateur ne fait pas encore.',
  body: `
<ul>
<li><strong>Les villes ne grandissent pas.</strong> Une ville est planifiée à sa taille finale. La croissance par accrétion, où une ville plus grande conserve le plan de sa version plus petite, est conçue mais non construite ; seul existe un point d’accroche chronologique.</li>
<li><strong>Un million est un plafond pour les pages.</strong> Le moteur génère une ville d’un million d’habitants, mais aucune des deux pages ne peut encore la recevoir ; les quartiers à la demande ne sont pas implémentés.</li>
<li><strong>L’eau est annuelle.</strong> Pas de crues, de nappes ni d’écoulement saisonnier ; l’hiver est dessiné, non simulé.</li>
<li><strong>Les cultures sont des données, non de l’histoire.</strong> Une fiche de culture est une synthèse artistique à partir de sources et de références ; ce n’est pas la reconstitution d’une ville réelle.</li>
<li><strong>Le moteur d’exécution fait partie de la recette.</strong> Les chemins processeur et GPU ne sont pas promis identiques au bit près ; la même recette sur un autre moteur peut différer dans le détail.</li>
</ul>
`, stages: [] },

{ id: 'glossary', part: 'more', title: 'Glossaire', kicker: 'Chaque terme n’a qu’un sens dans cet atlas.',
  body: `
<dl class="glossary">
<dt>Recette</dt><dd>Graine, taille, sources et chaque réglage d’un monde. Le reconstruit sur le même moteur.</dd>
<dt>Produit conservé</dt><dd>Sortie d’une étape gardée en mémoire et réutilisée par les étapes et les vues suivantes jusqu’à ce qu’un réglage en amont change.</dd>
<dt>Priority-Flood</dt><dd>Algorithme qui donne à chaque cellule d’un champ d’altitudes un ordre de drainage et à chaque dépression un point de débordement.</dd>
<dt>Bilan hydrique</dt><dd>Précipitations annuelles moins évapotranspiration sur un bassin ; décide si un lac peut être conservé.</dd>
<dt>Talweg</dt><dd>Ligne joignant les points les plus bas d’une vallée.</dd>
<dt>Loi rang-taille</dt><dd>Le lieu r a la population du plus grand divisée par r<sup>q</sup>.</dd>
<dt>Emprise</dt><dd>Le terrain donné à une ville, distinct de ses rues et de ses bâtiments.</dd>
<dt>Macroplan</dt><dd>Le cadre géographique d’une ville : couloirs, ports, remparts, phases.</dd>
<dt>Îlot, parcelle</dt><dd>Terrain enclos par des rues ; une propriété qui y donne sur une rue.</dd>
<dt>Programme</dt><dd>Les usages demandés par la population et leur attribution aux parcelles.</dd>
<dt>Volumétrie</dt><dd>Élever chaque pièce planifiée d’un bâtiment en un volume avec étages, égouts et toit.</dd>
<dt>Fiche de culture</dt><dd>Les données décrivant une culture architecturale : rues, parcelles, maisons, monuments, campagne.</dd>
<dt>Fiche de style</dt><dd>Un mélange hybride de cultures, pondéré facette par facette.</dd>
<dt>Liste d’affichage</dt><dd>Appels de dessin enregistrés que le GPU rejoue à chaque image.</dd>
</dl>
`, stages: [] },

{ id: 'references', part: 'more', title: 'Références', kicker: 'Sources et influences. L’apport local est indiqué pour chacune.',
  body: `[[refs]]
<ol class="bibliography" start="18"><li id="ref-savenije"><a href="https://doi.org/10.1016/B978-0-444-52107-1.X5000-X">Savenije, H. H. G. (2005). <em>Salinity and Tides in Alluvial Estuaries.</em></a> Elsevier.<p>Élargissement exponentiel des estuaires alluviaux ; la forme des embouchures de rivière s’en inspire, sans simulation des marées.</p></li></ol>`, stages: [] },
];
