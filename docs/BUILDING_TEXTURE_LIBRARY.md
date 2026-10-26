# Banque de textures de bâtiments

Cette collecte prépare les textures de toitures, murs et bois pour l’intégration
future. Les fichiers sont dans [`assets/materials/buildings/`](../assets/materials/buildings/README.md),
hors des assets chargés par le navigateur. Aucun renderer ni générateur de
bâtiments n’est modifié.

Elle suit les recommandations de [RENDER_SURFACE_DESIGN §7.1](RENDER_SURFACE_DESIGN.md#71-un-catalogue-de-recettes-alimenté-par-les-assets-existants)
et de [RENDER_REVIEW](RENDER_REVIEW.md) : matériaux existants de Poly Haven et
ambientCG, provenance et dimensions conservées. Le périmètre architectural est
celui des **32 packs et 39 matériaux** de
[`recipes.json`](../rust/crates/houses/data/recipes.json), utilisés par les
[cultures urbaines](CITY_CULTURES.md). Les associations sont documentaires ;
elles ne remplacent pas les choix de matériaux des recettes natives.

## Contenu et consultation

- [Inventaire des types, sources et usages](../assets/materials/buildings/README.md) :
  une ligne par jeu PBR, puis couverture des matériaux et des packs.
- [Planche des cartes couleur](../assets/materials/buildings/contact-sheet.jpg) :
  comparaison visuelle des matières réellement téléchargées.
- [Catalogue JSON](../assets/materials/buildings/catalog.json) : chemins de toutes
  les cartes, dimensions en pixels, tailles, empreintes SHA-256, URL de téléchargement,
  auteur, licence, emprise physique connue, qualification des correspondances et
  inventaire complet par pack.
- [Sélection JSON](../assets/materials/buildings/selection.json) : types en français,
  usages candidats et limites de chaque texture. Chaque sous-dossier dispose aussi
  de son `material.json` autonome.

Les dossiers sont classés par usage principal ; une matière peut servir ailleurs :

| Dossier | Types |
|---|---|
| `roof/` | tuiles terre cuite et céramique grise, ardoises, chaume/paille/roseaux, bardeaux de bois |
| `wall/` | argile et enduits de terre, enduits blancs/colorés, briques cuites, pierre de taille, moellons, pierres empilées, grès, pierre corallienne et volcanique |
| `wood/` | bois brut et ancien, bardages clairs/sombres/patinés, cèdre et hinoki, rondins, bambou rond/tressé, écorce |
| `special/` | feutre, toile tissée, cuir/suède, neige, couverture herbeuse, terre sèche, roche naturelle et cordage |

## Formats et conventions conservées

La résolution retenue est **1K**, pour disposer de la collection complète à une
taille raisonnable. Les liens et identifiants permettent de télécharger ensuite
des variantes 2K/4K dans les banques. Les cartes de fournisseurs ne sont ni
recolorées, ni rééchantillonnées, ni empaquetées pour le GPU.

Chaque jeu comprend `base_color`, `normal_gl`, `roughness` et `height`. L’AO et les
autres cartes utiles présentes sont conservées. Chez Poly Haven, la couleur est en
JPEG et les données en PNG lorsqu’elles sont proposées. Chez ambientCG, les fichiers
proviennent de l’archive officielle `1K-JPG` ; les formats d’origine sont conservés,
y compris les cartes PNG éventuellement contenues dans cette archive. Il s’agit
d’une collection de travail ; on pourra préférer les archives PNG ou les résolutions
supérieures pour préparer les assets définitifs.

- `base_color` est en **sRGB** ; normale, rugosité, hauteur, AO et opacité sont des
  **données linéaires**.
- Les normales retenues sont les cartes **OpenGL (+Y)**, pas DirectX. Toute
  conversion future doit être explicite.
- `physical_extent_m` correspond à une répétition entière. Les dimensions API
  Poly Haven sont converties de millimètres en mètres ; celles d’ambientCG de
  centimètres en mètres. Une dimension non renseignée reste `null`, sans inventer
  un carré de 1 m. Par exemple,
  [RoofingTiles015A](https://ambientcg.com/view?id=RoofingTiles015A) annonce environ
  2,9 × 2,9 m, soit `290` × `290` dans son API.
- Une carte de hauteur ne suffit pas à connaître son amplitude physique. Cette
  amplitude reste `null` lorsqu’elle n’est pas renseignée par la source ; elle
  devra être calibrée avant déplacement géométrique.
- Les cartes d’un jeu doivent partager les mêmes UV, orientation et échelle.
  Les rangs de tuiles/ardoises/bardeaux et les fibres de chaume suivent la pente ;
  le bois suit le fil de chaque pièce. Inspecter l’orientation de l’image source
  avant de fixer le repère. Une rotation de normale doit transformer ses
  composantes tangentes.

## Couverture et limites

L’inventaire inclut les matériaux des variantes et des composants, pas seulement
la maison par défaut de chaque culture. Chaque pack a donc une liste explicite de
matières disponibles, approchées et absentes dans le catalogue. **Une couverture
documentée n’est pas une reproduction historique validée.**

Les textures de terre/enduit servent d’approximation au torchis, à la bauge, à
l’adobe et au pisé ; elles ne contiennent pas les joints de briques crues ni les
strates du pisé. Les roseaux approchent les couvertures de palmes, sans représenter
leurs feuilles. Le grès clair approche la craie et le calcaire ; la pierre
corallienne approche la pierre coquillière. La pierre volcanique n’est pas
certifiée basaltique et ne restitue pas à elle seule des scories. Bois patiné,
cuir moderne, herbe/terre et neige de surface sont aussi qualifiés comme
approximations du bois flotté, des peaux de tente, des mottes de tourbe et de la
neige compactée de construction.

**Aucun os architectural n’a été acquis.** Les résultats de recherche « bone »
dans ambientCG renvoyaient à des panneaux de danger, écartés de la sélection.
`MAT-BONE` reste explicitement `missing` dans le catalogue des matériaux, qui le
rattache aux sources arctiques `AM-ARC-B01` et `AM-ARC-B06`. Les recettes actuelles
ne le référencent pas dans leurs paramètres ; cette réserve n’est donc pas
comptée comme un manque de texture dans un pack actif.

Les tuiles grises fournissent une matière pour les styles chinois, coréens et
japonais ; elles n’en reproduisent pas tous les modules ou profils. Les textures
de charpente ne fabriquent ni colombage, ni assemblage, ni pilotis. Les textures
de rondins, pierre sèche, monolithes et neige ne remplacent pas la géométrie.
Les couvertures vernissées spécifiques, lauzes épaisses, motifs de façade et
autres variantes culturelles devront être sélectionnés ou complétés selon le
besoin précis lors de l’intégration.

## Provenance et licences

Les fichiers d’assets collectés sont sous **CC0 1.0**, selon les conditions de
[Poly Haven](https://polyhaven.com/license) et
[ambientCG](https://docs.ambientcg.com/license/). Cette licence de tiers est
consignée dans chaque `material.json`, indépendamment de la licence du code du
projet. Les cartes restent redistribuables ; conserver la provenance aide à
retrouver leurs variantes.

**Powered by [Poly Haven](https://polyhaven.com/)** et
[ambientCG](https://ambientcg.com/). L’outil utilise leurs API publiques et les
liens officiels de téléchargement. La planche d’aperçus est produite localement
depuis les cartes couleur ; aucun rendu de présentation du site n’est repris.

## Reproduire et vérifier

Prérequis : Python 3 et Pillow. Depuis la racine :

```powershell
python scripts/fetch_building_textures.py
python scripts/fetch_building_textures.py --verify
```

La première commande réutilise les jeux déjà présents et intacts. Elle collecte
les jeux manquants avec deux téléchargements simultanés au maximum et reconstruit
le catalogue, les tables et la planche. La seconde est entièrement hors ligne :
elle vérifie le SHA-256 et la taille de chaque fichier, le décodage des images,
l’alignement des dimensions des cartes, la présence des quatre cartes PBR de base
et la couverture du catalogue natif. Poly Haven fournit aussi les MD5 des cartes,
contrôlés à l’acquisition ; les ZIP ambientCG sont vérifiés par leur taille et
leur CRC, puis leurs SHA-256 et ceux des cartes sont enregistrés.

Pour ajouter une texture, compléter `selection.json`, qualifier ses associations
aux `MAT-*`, puis relancer la collecte. Une évolution de `recipes.json` demande
de revoir la couverture : le catalogue conserve son SHA-256 pour détecter les
changements.
