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

## Sol procédural Render3D

La [note scientifique en anglais](methods/render3d-ground.md) décrit le champ,
les équations, le filtrage, les références et les limites de cette intégration.

`Render3D` possède un matériau de sol évalué dans le shader de perspective :
albédo, normales et rugosité suivent des structures partagées en mètres. Le
shader utilise la position physique, avant exagération verticale, et l'empreinte
du pixel sur cette surface pour filtrer les détails. Les autres styles et le
matériau `Render` conservent leur chemin cartographique.
Le zoom maximal de `Render3D` est de 128 pixels CSS par mètre, en 2D et en 3D ;
les autres styles conservent leur limite de 8 pixels CSS par mètre.

La classification des matériaux utilise les coefficients B-spline du champ
source global stocké en R32F, indépendamment de la résolution du maillage.
Changer de niveau de détail ne redéfinit donc pas les zones de roche ou d'herbe.

`rust/bridge/terrainGround.ts` définit le champ de détail CPU/GLSL commun. Le
maillage échantillonne une hauteur canonique indépendante de la caméra ; les
transitions parent/enfant interpolent ses approximations. Le matériau suit la
normale physique canonique et conserve la variance des pentes non résolues.
Des graviers elliptiques compacts complètent les bandes de bruit analytique.
Les plaines restent lisses et les déplacements fins sont atténués
près de l'eau. Ce détail de présentation ne recalcule ni relief Rust ni hydrologie.
La réflectance emploie GGX, Smith et Schlick avec un albédo linéaire, selon le
[modèle temps réel décrit par Filament](https://google.github.io/filament/main/filament.html).
La variance non résolue élargit la distribution des pentes. Les gradients du
détail sont analytiques ; les variations de son enveloppe pente/climat sont
traitées comme des variations macroscopiques, sans en dériver tous les termes.

Le matériau 3D reçoit une capture RGBA contenant uniquement eau, courbes et
superpositions. Son alpha porte leur couverture explicite : la couleur du sol
ne sert pas à reconnaître l'eau. Les captures conservent des voisins réels dans
une bordure de deux texels et les textures sont composées avec alpha prémultiplié.
Le diagnostic « Tuiles » superpose les limites sans changer les hauteurs.

Les méthodes de référence sont [Wave Noise, SIGGRAPH 2025](https://pascalguehl.github.io/siggraph2025-wave-noise/),
le [mélange laplacien, JCGT 2025](https://jcgt.org/published/0014/01/02/) et
[LEADR, SIGGRAPH Asia 2013](https://perso.liris.cnrs.fr/victor.ostromoukhov/publications/pdf/SAsia2013-LEADR.pdf).
L'implémentation locale utilise une synthèse spectrale bornée, un mélange par
bandes et une approximation de variance des pentes ; elle ne constitue pas un
port complet de ces trois travaux. Elle ne simule pas l'érosion, les ombres de
chaque grain ou des surplombs. Un détail sous-pixel influence la réflectance,
sans créer une silhouette que le maillage ne pourrait représenter.

## Vérification

Depuis `web/`, `node scripts/styles_ui_check.mjs` vérifie les couleurs mer/lac
des douze styles sur le GPU, l'indépendance des couches, la composition d'un
diagnostic et la relecture des liens dans les renderers WebGL et SVG.
`tests/render.water-style.test.ts` couvre les palettes, caches, anciens décors et
portions successives. Les suites de rendu et d'export existantes restent applicables.
