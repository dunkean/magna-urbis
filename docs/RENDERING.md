# Styles, couches, diagnostics et masques

Le rendu combine quatre notions distinctes, sans modifier la génération :

| Notion | Rôle | Exemple |
| --- | --- | --- |
| Style | Définit les couleurs et matériaux des éléments | Atlas, Parchment, Render |
| Couche | Contenu dont on choisit la visibilité | Fond de terrain, eau, courbes, bâtiments |
| Diagnostic | Visualise une donnée de calcul | Altitude, bassin versant, identité des quartiers |
| Masque | Donnée spatiale qui délimite ou pondère une opération | Zones de génération, emprise lacustre |

Un diagnostic peut remplacer la coloration du terrain, comme Altitude, ou se
superposer à la carte. Il conserve le style sélectionné. Les masques internes
ne deviennent pas des styles lorsqu'un diagnostic les affiche.

## Définitions communes

- `web/src/render/styles.ts` : palettes cartographiques et leurs matériaux d'eau.
- `web/src/render/terrainStyle.ts` : catalogue commun des styles du terrain,
  incluant le compositeur de matériaux Render et les illustrations Fantasy.
- `web/src/render/waterStyle.ts` : contrat, interpolation CPU et GLSL des palettes
  d'eau ; uniformes préparés une seule fois par matériau.
- `web/src/render/displayLayers.ts` : vocabulaire et commandes de visibilité.
- `web/src/render/displayDiagnostics.ts` : diagnostics hydrologiques et
  d'altitude, données requises, légendes et mode de composition.

Terrain et Settlements utilisent le même panneau et les mêmes renderers.
L'atelier urbain distingue aussi le style cartographique de l'identité colorée
des quartiers et des diagnostics d'îlots, de parcelles et d'orientation.

## Un matériau d'eau par style

`WaterStyle` porte une liste de points `[position, couleur]` et une largeur de
transition. La position est la distance à la rive divisée par la largeur de
référence de la carte et `bandFraction`. Les segments utilisent une interpolation
lissée identique en CPU et en GLSL. Les rivières utilisent la couleur de rive.

Une mer et un lac évaluent le même matériau à la même distance de la rive.
L'ombrage du fond marin ne modifie pas cette couleur. Le style Render fournit
sa propre palette, sans chemin de coloration réservé aux lacs. Les brushes
restent une couche d'illustration indépendante du matériau d'eau.

`terrainWater.ts` adapte les surfaces aux images SVG/PNG et au Canvas de
l'application. `TerrainGl` utilise les mêmes points de couleur. Les rives et
les trous restent définis par leurs géométries ; changer de style ne les recalcule
pas. La case Eau inclut la mer, les lacs et les rivières. Masquer le fond de
terrain conserve l'eau lorsqu'elle est activée.

## Échelles, portions et fichiers conservés

La largeur de référence et les coordonnées du matériau appartiennent à la carte
source. Le zoom et les portions successives traduisent ce repère sans resserrer
le dégradé. Les surfaces de distance et les images sont mises en cache par leurs
données et leurs dimensions.

Les nouveaux `.decor` conservent les champs neutres en FP32 encodé en base64,
leurs rives et le repère source. Leur compression reste celle du fichier decor.
Le style est évalué à l'affichage, y compris après une portion ou un changement
de vue. Les recettes qui régénèrent le terrain omettent ces données dérivées.
Les anciens fichiers restent lisibles : leurs matériaux lacustres sont reconstruits
depuis le masque disponible. Un ancien fichier déjà découpé ne permet pas de
retrouver des données de rive extérieures qu'il ne contenait pas.

Les liens utilisent `style` pour l'apparence et `diagnostic` pour la visualisation
de calcul. Les anciens `overlay` et `style=copernicus` sont encore lus ; ce
dernier devient le diagnostic Altitude avec le style Parchment.

## Vérification

Depuis `web/`, `node scripts/styles_ui_check.mjs` vérifie les couleurs mer/lac
des douze styles sur le GPU, l'indépendance des couches, la composition d'un
diagnostic et la relecture des liens dans les renderers WebGL et SVG.
`tests/render.water-style.test.ts` couvre les palettes, caches, anciens décors et
portions successives. Les suites de rendu et d'export existantes restent applicables.
