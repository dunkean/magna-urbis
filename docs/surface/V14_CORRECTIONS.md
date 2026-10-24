# Corrections préparées pour V14

24 octobre 2026. État du code intégré de référence : `3246e20`. Cette note
réunit les corrections et les contrôles ciblés déjà disponibles ; elle ne donne
**aucun verdict de campagne complète ou de revue V14**. Les sorties d'une campagne
en cours ne sont pas des résultats acquis. `IMPLEMENTATION.md` reste inchangé.

La cible demeure une carte JDR en 2D/3D, avec styles et export, et non une scène
de jeu. Le sol, le couvert bas et les arbres restent trois couches distinctes.
Les corrections de rendu ci-dessous ne changent ni les hauteurs, ni les champs
physiques, ni les IDs, positions, tailles, orientations ou rangs des candidats.

## Haute LOD : tester le support, pas seulement le centre

Un arbre très proche peut remplir l'image alors que son centre est hors écran.
La sélection haute LOD teste désormais l'intersection conservatrice du support
transformé, union du vrai maillage et des cinq quads d'imposteur, avec le frustum.
Le diamètre physique projeté est calculé d'abord ; seuls les candidats éligibles
à au moins 500 pixels passent ce test. Le budget reste de 14 arbres hauts,
soit 1 880 130 triangles pour le produit de 134 295 triangles. Les autres arbres
sélectionnés gardent leur imposteur à deux triangles : aucun ID n'est supprimé
pour respecter ce budget.

Les [contrôles CPU et GPU](evidence/vegetation-tree-v13/HIGH_SUPPORT_CULLING.md)
distinguent centre, support et fragments réellement visibles. Le cas conservateur
sans feuille visible est conservé comme tel ; un second cadrage montre une vraie
feuille passant de l'imposteur à la haute géométrie avec centre hors champ.
Les contrôles source, atlas C/V et pixels sans arbres restent identiques.
Un compteur de centres à zéro n'est donc ni falsifié ni présenté comme une
mesure d'occlusion GPU.

## Feuilles : corriger l'encodage du produit exporté

Le [diagnostic d'albédo](evidence/vegetation-tree-v13/ALBEDO_ENCODING.md)
a isolé une double conversion sRGB : le GLB contenait du RGB déjà linéarisé
dans un emplacement baseColor sRGB, que le moteur décodait à nouveau. Le produit
corrigé reprend les RGB 16 bits de la texture source épinglée et conserve
l'alpha exporté. Les anciens fichiers négatifs ne sont pas écrasés.
Les positions, UV, normales, indices, masques binaires, LUT et produits
d'imposteur demeurent inchangés. Aucun gain de couleur empirique ne compense le bug.

Le nouveau digest de rendu est
`74edf966059a17fd44df22d24f4ee055f780d84196ee9c54703fa3b9e46ecbe9`.
Le [contrôle artistique sur source V13 avec GR](evidence/vegetation-tree-v14/ALBEDO_SOURCE_AB.md)
compare les deux produits sous le même consommateur, caméra et éclairage :
à 40 m, six arbres hauts changent de couleur ; à 160 m, sans haute LOD,
**le PNG toutes couches est identique octet par octet**. Les champs GR,
parents, terrain, inventaire, buffers de population et images C/V sont identiques.
Ce contrôle retenu n'est pas une nouvelle génération ni une campagne V14.

La grande différence de moyenne lumineuse est corrigée dans le contrôle commun.
Il reste une différence de normales d'environ 29° et une rugosité d'imposteur
fixée à 0,9 contre une moyenne source d'environ 0,4755. La parité BRDF sous tout
éclairage et l'absence générale de transition visible ne sont pas démontrées.

## Oblique : un plan source commun et un échantillonneur borné

Le [plan de visibilité](OBLIQUE_VISIBILITY_PLAN.md) lie caméra, enveloppes des
contrôles source, atlas et résident dans un même travail immuable. Il inclut
les noyaux positifs, les seize contrôles B-spline et les mélanges parent/enfant,
sans remplacer une hauteur manquante par une hypothèse locale. La page d'arbres
doit être couverte par l'union des vrais domaines transportés. Le résident peut
atteindre 4096² au même pas ; le plafond de 2 Gio porte sur une estimation de
buffers connus, pas sur la RSS ou la VRAM totale. Les anciens échecs phase zéro
et résident 2048 insuffisant restent conservés.

Le [batch Rust explicite](../../viewer-local/native-height/README.md) reprend
l'ordre scalaire f64 des calculs existants, sans fast-math ni génération.
La [comparaison CPU intégrale](evidence/native-height-batch-cpu.json) vérifie
16 777 216 hauteurs RF et contrôles exacts : préparation locale mesurée à
2,016 s contre 105,863 s GDScript. L'ancien résultat de 114,914 s reste enregistré.
Ce sont des durées murales de préparation, pas une promesse de latence ou de FPS.
L'exécutable, la source, les epochs, la grille et les SHA de transport sont liés ;
un échec explicite conserve l'ancien rendu et ne substitue pas du faux terrain.

Un contrôle GPU intégré du contre-exemple oblique retenu existe déjà dans
`web/out/surface/oblique-v14-first/verified.json` et ses cinq PNG : snapshot
`1eee770`, source et exécutable inchangés, exécution de 37 276 ms sans erreur
runtime. C'est un contrôle statique distinct, pas le résultat futur de V14.
Les statistiques C/V TOP ne deviennent pas une preuve d'optique oblique exacte.

## Blocs rocheux : géométrie irrégulière et PBR existant

Les prismes aériens sont remplacés par six variantes déterministes de clasts
de **80 triangles réels**, dans la boîte et le pivot historiques. La sélection
de recette utilise `sourceRock` et la lithologie source, pas la recette dominante
du sol alluvial. Les cartes PBR déjà chargées, leurs échelles métriques et le
sampler stochastique partagé sont réutilisés ; aucune texture n'est téléchargée.
Le repère TBN tient compte des échelles non uniformes et le fade utilise la
caméra principale également dans la passe d'ombre. Les glyphes cartographiques
restent inchangés.

Les [preuves clasts](evidence/vegetation-tree-v14/CLASTS.md) comprennent
1 763 assertions CPU et six captures GPU avant/après. Le cas réel est une
mudstone source, pas un granite supposé. Les buffers non rocheux et données
physiques restent exacts. En masquant les clasts **et leurs ombres dans les deux
profils**, les pixels du terrain sont strictement identiques ; les quatre états
cartographiques sont également identiques. Les variantes restent anguleuses
de près : ce n'est ni de la photogrammétrie ni un oracle GPU des normales.

## Préparation PBR : cache vérifié, identité de source inchangée

Le [cache préparé](PBR_PREPARED_CACHE.md) conserve les pixels AH16F/NR8,
tous les mips et les moyennes float32 exactes. Sa clé inclut les SHA réels des
quatre cartes et le décodeur Godot épinglé. Les enregistrements invalides sont
reconstruits ; fichiers, volume temporaire et écritures sont bornés. Les sources
ne sont jamais réécrites. Les métriques de préparation/cache sont séparées du
digest d'asset et de l'identité physique.

Sur quinze matériaux réels : référence 6 806 ms, construction froide 7 885 ms,
cache chaud 2 007 ms, avec parité exacte des pixels, mips, bindings et descripteur.
Le froid ajoute du coût ; le gain chaud local ne démontre pas la cause du warmup
complet ni une amélioration de QoS. Le plafond disque n'est pas un plafond RAM.

## Composition de carte, projection native et profil explicite

La [composition de carte](MAP_COMPOSITION.md) réutilise palettes, typographie,
placement des noms et cadres du renderer web autour d'un raster géoréférencé
épinglé. La preuve CITY419 compose une capture retenue sans inventer les noms
absents. La projection native exporte la vraie matrice caméra, le viewport,
l'origine relative et les identités. Le TOP fournit son échelle métrique ; une
perspective n'obtient ni échelle uniforme, ni grille JDR ou nord automatique.
Les limites d'altitude et d'occlusion des annotations restent déclarées.
La preuve CITY historique utilise son binding TOP explicite ; elle ne qualifie
pas rétroactivement une ancienne caméra oblique sans matrice.

Le [profil `surface-v2`](../../viewer-local/profiles/README.md) sélectionne
explicitement PBR, herbes, arbre corrigé, batch natif, présentation aérienne,
eau source-map à teinte uniforme et symboles déclarés de 1,25 px, logs threadés.
Les ressources doivent être préparées localement ; aucune détection de cache,
téléchargement ou substitution silencieuse n'a lieu. Les remplacements explicites
et leurs hashes sont validés, et le profil est transmis aux phases du harnais.
Sans profil, les anciens défauts du lanceur restent inchangés. La symbologie
de l'eau est une représentation de carte, pas sa largeur physique ; le mode
source-levels exige symbole zéro et conserve les conflits avec le lit.

## Limites et qualification restante

Les historiques négatifs V9, V10 et V11, les diagnostics intermédiaires échoués
et les [revues archivées](reviews/) ne sont ni remplacés ni requalifiés.
La campagne V13 sur `6ef8d3c` reste sa propre preuve technique ; son refus
artistique ne disparaît pas avec ces contrôles locaux.

- Les arbustes restent des boules ; diversité, éclairage des imposteurs et détails
  végétaux proches restent des limites artistiques.
- Les arbres utilisent cinq angles d'imposteur et des ombres optiques communes.
  L'anti-aliasing d'ombre ne transforme pas ce modèle en ombre forestière physique.
- Le contexte canonique régional reste à 78,125 m dans les sources considérées.
  Une image 4096², le PBR ou les millimètres par pixel caméra ne créent pas des
  observations fines de sol ; seul le petit enfant neuronal possède sa résolution
  native déclarée.
- La ville retenue garde 419 réalisations natives, 81 refus, le parent à
  15,625 m avec LOD inconnue et son sol legacy sans GR. Elle n'est pas une ville
  fraîchement décodée, et ne prouve pas les détails urbains absents du paquet.

La prochaine campagne devra donner son propre HEAD, hashes runtime/ressources,
restauration, navigation stricte, sept échelles, isolations et captures de ville.
La revue devra ouvrir les images et distinguer technique, qualité artistique,
styles JDR et production. Cette note n'annonce ni campagne V14 réussie,
ni revue V14 réalisée, ni 60 FPS, ni décision finale d'adoption de Godot.
