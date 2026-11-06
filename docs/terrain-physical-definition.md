# Définition physique du terrain

La largeur de région est exprimée en mètres. `terrain.sampleSpacing` choisit le
pas demandé de la source physique ; `terrain.resolution` choisit uniquement la
grille d’aperçu (64 à 1024). Le nombre d’échantillons physiques est
`ceil(width / sampleSpacing)` et le pas effectif est `width / n`.

Les contraintes sont vérifiées avant génération : au moins 16 échantillons par
côté, au plus 8192, et un budget estimé de rasters de travail de 1536 Mio. Cette
estimation exclut les poids et activations des modèles ainsi que les caches du
rendu. Une combinaison impossible est refusée, sans réduire silencieusement la
définition demandée.

| Technologie | Étendue | Définition |
| --- | --- | --- |
| Procédural Rust | 500 m à 100 km | Pas choisi, sous réserve du budget |
| Neuronal régional conventionnel | 500 m à 200 km | Source native 30 m, sortie éventuellement moins dense |
| Profil expérimental Tile40 / residual8k | 40 km | Sortie fixe 1024² ; contrat propre au modèle |
| Heightmap | 500 m à 100 km | Limitée par les échantillons réellement importés |
| TypeScript classique | 600 m à 40 km | Définition propre au moteur ; pas de promesse de source Rust plus fine |

Les fenêtres neuronales se recouvrent : coarse 64/48, base 64/32, décodeur
512/384. La région conventionnelle est placée de manière déterministe dans une
seule fenêtre coarse avec les contributions nécessaires à la reconstruction.
La borne de 200 km conserve les marges de ce placement. Tile40 conserve son
propre contexte d’inférence et ne doit pas être assimilé au profil régional.
Ce profil expérimental évalue quatre fenêtres coarse ; son conditionnement
couvre aussi leurs marges, sans réplication artificielle du bord.
Ce champ de contexte contient 113² cellules coarse, distinctes des 1024²
échantillons de sa sortie physique.
Les facteurs 32 puis 8 décrivent les rapports de résolution entre cellules,
pas une subdivision en tuiles indépendantes. Une fenêtre coarse couvre
491,52 km (cellules de 7,68 km), mais les fenêtres voisines se recouvrent sur
122,88 km. Une fenêtre base couvre 15,36 km avec un pas de 7,68 km ; une fenêtre
décodeur couvre aussi 15,36 km avec un pas de 11,52 km. Les marges requises à
chaque étage s’ajoutent : soustraire seulement deux marges de 15,36 km à la
fenêtre coarse ne donne donc pas sa zone exploitable avec une unique inférence
coarse. Le plan régional testé reste dans une fenêtre jusqu’à 6688 cellules
natives (200,64 km) ; le produit borne cette largeur à 200 km.
Le conditionnement neuronal reste à 7,68 km : un pas de sortie de 30 m ne
garantit pas un contrôle de l’esquisse ou du littoral à cette finesse.
Une sortie neuronale plus grossière réduit les données conservées et transmises
aux villes ; elle ne réduit pas le travail initial du modèle à 30 m. Les rasters
intermédiaires de cette inférence ne sont pas inclus dans le budget de la source
conservée.

Le calcul procédural GPU produit toute source de 16² à 4096². La taille est lue
dans le bloc uniforme : la changer ne recompile aucun pipeline. L’appareil
demande les limites de buffers de l’adaptateur. En automatique, une taille que
l’adaptateur refuse, ou dont le coût fixe GPU dépasse le calcul CPU estimé,
utilise le pipeline CPU et l’activité indique ce choix. Un forçage GPU impossible
est refusé avec la taille maximale de l’adaptateur.

La grille régionale ne dépend pas de la source. La grille d’érosion de surface
vaut sa base physique (640² à 1024²), jamais plus que la source ; au-delà de
1024², elle suit 0,6 × la source, plafonnée à 2048². Une itération de surface
représente le même temps physique sur toute grille : l’incision implicite suit
1/pas et la reptation thermique et la diffusion 1/pas², dans leurs limites de
stabilité. Les budgets et coefficients d’érosion sont dans les contrôles
« Super avancé ». La définition effective de l’érosion peut être moins fine que
celle de la source ; elle est indiquée séparément.
Changer le pas peut changer le drainage, même avec la même graine.
La pleine mer reste grossière : une fois la côte découpée, un masque de 128²
marque les cellules de mer plus éloignées de la terre que ce qu’atteignent les
étapes ignorées (détail, Phasor, surface). Elles gardent leur bathymétrie
reconstruite. Tant que la côte n’est pas connue, rien n’est ignoré.
L’hydrologie garde sa propre grille, plafonnée à 1024² dans les moteurs actuels :
à 200 km, son meilleur pas régional est donc 195,31 m, même avec une source
neuronale à 30 m. Elle ne dépasse pas non plus la puissance de deux qui contient
la source, avec un minimum de 256² : une source de 200² draine sur 256². Le
panneau affiche séparément ce pas ; une source plus dense ne signifie pas que les
bassins et écoulements ont été calculés à la même finesse.

## Transmission aux villes

Le monde conserve la source physique indépendamment de l’aperçu. Les grilles
de planification, de routage et de ressources restent bornées à 1024² : il
n’est pas nécessaire de dupliquer chaque masque à la définition des altitudes.
Les requêtes urbaines transmettent séparément la surface continue utilisée
pour les hauteurs, les pentes locales et les fondations. Les contrôles
B-spline, lorsqu’ils sont disponibles, utilisent le même noyau et le même
plancher que la surface du terrain. Les patchs de sol contiennent des mètres
évalués, et non des coefficients d’interpolation.

Le transport natif `/raster` ajoute `physicalN`, éventuellement
`physicalInterpolation: "bspline"` et `physicalFloor`, puis une couche float32
après les couches de planification existantes. Une seule couche physique est
conservée dans le moteur urbain. Les pools de workers sont soumis à un budget
de copies.

Le moteur urbain TypeScript classique refuse une surface physique différente
de sa grille de planification. Il faut alors choisir Rust ou le moteur natif.
Les détails visuels sous la maille source restent distincts des informations
de génération ; augmenter les pixels d’un aperçu ne crée pas de relief.

## Vérifications du 6 novembre 2026

Choix revus avec Opus 5.5 high via CLI. Validation : 605 tests Rust réussis
(23 ignorés), 80 tests TypeScript, 5 tests Python, vérification TypeScript
complète, contrôles navigateur V2 et rustBench, transport physique natif et
vérifications CPU des binaires WASM, dont les bornes du contexte Tile40.
Les artefacts natifs et les trois variantes WASM sont reconstruits. Les services
déjà lancés restent en place pendant le chantier de rendu ; leur mise à jour
et leur redémarrage restent à faire ensuite. Une inférence neuronale complète
sur 200 km n’a pas été exécutée pendant ce chantier.
