# Cœur d’affichage V2

L’optimisation porte sur la présentation et l’ordonnancement. Les générateurs,
la géométrie, les shaders et les règles de dessin des couches restent les
mêmes.

## Chemins de présentation

Le chemin composite utilise `Viewer.setDirectSource`. Le terrain WebGPU ou
WebGL reste dans son canvas visible, sous les surcouches CPU. Le navigateur
compose ces surfaces. Le chemin composite CPU présente directement sa surface
2D. Ces deux chemins évitent `createImageBitmap`, le transfert vers un autre
canvas de présentation et, pour le GPU, la copie du terrain vers le canvas 2D.

Le canvas d’entrée conserve les événements souris, tactiles et clavier. Les
couches visibles sont ses voisines dans le même viewport. Il faut donc
capturer le viewport complet, plutôt que lire uniquement le canvas d’entrée.
L’illustration prépare explicitement le canvas GPU avant de figer les couches.
Les exports conservent une composition raster explicite.

Le chemin classique conserve son worker et le transfert de bitmap depuis
`OffscreenCanvas`. Il garde une seule requête en vol et suit immédiatement la
caméra par transformation CSS. Une réponse d’une ancienne source est fermée
sans remplacer l’image ni libérer la requête de la nouvelle source.

## Travail évité

- Une seule présentation par frame sale ; le moteur GPU dessine dans cette
  frame sans ajouter un second `requestAnimationFrame`.
- Les pipelines sont préparés de façon asynchrone lors d’un changement de
  rendu ; la navigation n’utilise plus le mode capture synchrone.
- La miniature dispose de sa surface et n’est recalculée qu’au changement
  de contenu, d’apparence ou de taille.
- Les surfaces 2D ne sont redimensionnées que si leur taille change.
- Les modifications du composite ne reconstruisent plus la scène cachée du
  worker classique. Cette scène est libérée à la sortie du chemin classique ;
  le worker et ses assets décodés restent disponibles.
- Le couple apparence/monde est envoyé atomiquement au worker lors d’un
  changement de projet. Les modifications d’affichage identiques sont ignorées.
- Les résolutions d’apparence des anciens mondes sont libérées au changement
  de monde et à la fermeture du projet.

## Vérifications

`web/scripts/v2_display_core_check.mjs` utilise un projet conservé contenant
une ville et des maisons natives, sans lancer de générateur. Il vérifie les
déplacements et zooms, la parité avec une capture composée, les transitions
classique/composite et le redimensionnement. Options : `--backend=webgl`,
`--backend=webgpu`, `--backend=cpu`, `--dpr=2`, `--exports`.

Sur la machine de validation, chaque série de 90 mouvements a produit
90 rendus composites et **zéro** appel à `createImageBitmap`, contre 90 avant
la modification. CPU, WebGL et WebGPU ont passé le contrôle. Le CPU est
identique pixel par pixel à la capture de référence ; les différences GPU
restent inférieures ou égales à deux niveaux par canal. Les intervalles médians
de frame sont proches de 16,7 ms sur ce projet. Ces mesures décrivent ce cas
local et ne mesurent pas le coût intrinsèque de chaque couche ou des cartes
beaucoup plus grandes.

Les rapports et captures de validation sont dans `web/out/v2-display-core/`.
Les tests unitaires couvrent notamment le regroupement des demandes, les
réponses obsolètes, la libération des scènes et la préparation des captures.
