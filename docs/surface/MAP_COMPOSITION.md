# Composer une carte finale sur une capture SurfaceWorld

## Composition v2 : clé visuelle liée au rendu, panneaux externes

La version 2 du compositeur et de la preuve exportée garde le binding de capture en version 1. Le PNG source conserve sa taille et ses octets ; le canvas de sortie est agrandi autour de lui. `evidence.canvas.rasterBounds` donne son origine et ses dimensions : un pixel source reste un pixel de sortie. Le titre, la légende, le nord et la règle sont tous hors de ce rectangle. Les matrices natives continuent de projeter dans les pixels du raster original ; on ajoute seulement cette origine pour obtenir les coordonnées composées. Il ne faut pas recalculer l’échelle à partir de la largeur totale du nouveau canvas.

Une clé visuelle exige `content.visualLegend`, format `surface-visual-legend` version 1, lié aux SHA de l’image et des métriques ainsi qu’au monde. L’adaptateur `nativeVisualLegend` lit la palette réellement capturée et les représentations natives soumises : contour/remplissage de toiture, bande routière à deux bords intérieurs de 1/8, disque de couronne cartographique. Les icônes sont schématiques, pas une mesure des objets. Leurs couleurs ne changent pas quand la palette décorative de la marge change. Ce contrat concerne la politique native cartographique actuelle, pas un classificateur universel de pixels ou d’occlusion.

Les recettes de sol et potentiels canoniques restent dans les métadonnées `legend`, avec qualifications et comptes ; ils ne sont plus dessinés comme une fausse clé. Sans glyphes certifiables, la légende visuelle est omise et la raison conservée. En particulier, l’oblique CITY14 ne présente plus « Eau » ou des recettes invisibles : sa clé visuelle est vide, tandis que huit entrées de contexte restent consultables dans la preuve. Aucun toponyme n’est inventé.

La [preuve v2 CITY14](evidence/map-quality-city419-v2.json) comporte le TOP et la perspective réels. Le TOP devient 1 672 × 920 pixels autour du raster inchangé de 1 280 × 800 ; ses trois glyphes représentent Bâtiments, Voirie et Arbres. La barre reste 25 m = 80 pixels et la grille explicite 5 m. La perspective devient 1 328 × 920, sans fausse règle, grille ou nord ; son crop raster est identique au PNG source sur les 1 024 000 pixels RGB. Pour le TOP, un contrôle CPU ôtant seulement la grille donne également zéro différence RGB. Tous les panneaux ont une intersection vide avec le raster, donc ne peuvent masquer ses empreintes ou POIs.

![Blueprint avec clé native et panneaux hors carte](evidence/map-quality-city419-v2-blueprint.png)

Les sections et preuves historiques ci-dessous décrivent aussi la version 1 ; elles ne doivent pas être utilisées pour réintroduire ses panneaux sur le raster ou ses légendes de potentiels.


Le bridge `web/src/surface/mapComposition.ts` compose un SVG autonome sur un PNG géoréférencé, sans génération ni modification du monde. Il réutilise les palettes, piles de polices, moteur de placement des noms, sérialiseur de labels, primitives de panneaux et cadres du renderer web. Le CLI produit SVG, PNG via resvg et preuve JSON. Il ne remplace ni les styles web ni le pipeline SVG existant.

## Entrées et API

`composeSurfaceMap(capture, pngBytes, content, { style?, gridMeters?, title? })` retourne `{ svg, evidence }`. Le binding `SurfaceMapCapture` lie les SHA256 du paquet source, des métriques et du PNG aux identifiants de monde et de contexte canonique. Le PNG est vérifié et embarqué dans le SVG avec ses octets originaux. Le CLI vérifie aussi les octets du paquet et des métriques ; aucune URL de raster externe n’est acceptée.

Le TOP est un rectangle métrique exact dans le repère du paquet, jamais dans l’origine de rendu locale. Son rapport largeur/hauteur doit correspondre au PNG. L’échelle est en mètres ou kilomètres ; une grille JDR optionnelle est ancrée sur les coordonnées métriques source, avec un budget de 2 048 lignes. Le nord est explicitement le nord de grille local, `-Z`, sans prétention géodésique.

`surfaceMapContent(packet, capture)` extrait les recettes réellement présentes dans les nœuds canoniques voisins du cadre, les potentiels arbre/couvert et les records natifs/voirie source. Les comptes ne sont ni des aires ni une visibilité GPU. La légende distingue ces sémantiques de leur apparence ; les recettes de sol n’ont pas de fausse couleur de raster attribuée. Les noms sont lus seulement dans `source.meta.names.entries`. Un producteur possédant un vrai `World` peut appeler `sourceMapLabels(world.names.entries, 'world.names', translation)` ; le bridge n’appelle aucune grammaire de noms. Les IDs, textes et chemins restent conservés, avec translation de repère explicite et sans mutation.

## Projection native et vues 3D

`nativeSurfaceMapCapture(identity, projection)` joint le sidecar natif suivant :

```ts
{
  format: 'surface-map-projection', version: 1, worldId,
  projectionMode: 'orthographic-top' | 'perspective',
  viewportPixels: { width, height },
  worldToClip: [/* 16 nombres, column-major */],
  renderOrigin: { x, y, z }, // float64, soustraite AVANT la matrice
  clipRange: [-1, 1], focus: { x, z },
  uniformMetricScale: null // perspective
  // TOP : { metresPerPixel, bounds:{minX,minZ,maxX,maxZ}, north:'local-negative-z' }
}
```

La matrice doit être réellement exportée par la caméra native et inversible. Un test à coordonnées ±1e9 vérifie la soustraction de l’origine avant multiplication. La perspective ne reçoit pas de règle métrique uniforme, nord automatique ou grille JDR. Les annotations ponctuelles exigent une altitude source ; à défaut elles sont omises et diagnostiquées. Le drapé des labels linéaires et l’occlusion par les volumes ne sont pas reconstruits. Les anciennes captures obliques sans matrice sont refusées par l’auto-binding ; aucun calcul approximatif de caméra ne les remplace.

Le CLI utilise `metrics.mapProjection` quand il existe, avec contrôle des identités. Sinon, un `--capture-proof` permet uniquement le TOP explicitement demandé dans la commande native, avec SHA du PNG et des métriques. Un `--binding fichier.json` explicite peut fournir un binding moteur neutre ; s’il existe une projection native dans les métriques, les deux doivent coïncider.

## Exemple reproductible CITY419

Depuis `web/`, les entrées restent dans les sorties ignorées du worktree ROOT :

```powershell
node --import tsx scripts/compose_surface_map.ts `
  --source <ROOT>/web/out/surface/native-current-419-v12-final/source.surfacebin `
  --capture <ROOT>/web/out/surface/native-current-419-v13-final/blueprint-native-close-top.png `
  --metrics <ROOT>/web/out/surface/native-current-419-v13-final/blueprint-native-close-top.json `
  --capture-proof <ROOT>/web/out/surface/native-current-419-v13-final/capture-run.json `
  --view blueprint-native-close-top --grid-m 5 `
  --out out/surface/map-composition/city419-blueprint
```

La [preuve CITY](evidence/map-composition-city419.json) conserve le paquet de 419 réalisations natives et 81 refus, le parent retenu à 15,625 m et le sol legacy 1.5.3. Elle produit un plan de 400 m avec cadre blueprint, nord de grille, barre de 25 m, grille de 5 m et cinq entrées de légende. Le paquet n’archive aucun nom à l’emplacement prévu : zéro toponyme et zéro POI sont ajoutés. Le SHA du raster embarqué est exactement `c69ecb23fc11944e7553908834b1fa934634869b9ef121ce8068e909fb0d2452`. Le PNG composé est `75621009d8f089f98e7949f152ea2af9cff72b00dfbf4d0a6c32263aa98fbb26`.

Neuf palettes de carte sont partagées (`styles.ts`), distinctes des quinze terrain styles. Les tests exercent les neuf surcouches ; ils ne qualifient pas quinze réalisations natives finales. Changer la palette du cadre ne repeint pas le raster. Les pinceaux SVG, hachures de relief et noms absents ne sont pas inventés. Les polices utilisent les piles système existantes et ne sont pas embarquées : aucune identité PNG entre machines n’est promise. Cette preuve est une composition CPU sur une capture retenue, sans nouveau rendu GPU, génération neuronale, acceptation artistique globale ou promesse de FPS.

## Finition de présentation

`--title "Plan urbain"` ajoute un titre explicitement fourni, avec la palette et la police communes. Son espace est réservé avant placement des labels ; sans option, aucun titre n’est inventé. Les légendes visibles utilisent des libellés lisibles (Bâtiments, Voirie, Arbres, Couvert bas, Sol minéral). Les qualifications de source et de potentiel, les comptes et chemins restent dans les métadonnées. Les noms de recette fournis (`displayName`, `label`, `name`) sont prioritaires ; une recette inconnue sans nom fourni conserve son identifiant. La [preuve avec titre](evidence/map-composition-city419-title.json) est une composition CPU du même raster V13, distincte d’une future capture native V14.
