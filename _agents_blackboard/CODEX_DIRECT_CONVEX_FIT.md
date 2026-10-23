# Pose constructive : noyau proposé, sans changement de production

22 octobre 2026, conception préparée après le baseline de 128 sites. La clarification utilisateur conserve les essais lorsqu'ils donnent un meilleur résultat. L'objectif est donc un chemin direct certifié pour les cas couverts, comparé au chemin actuel, avec un repli explicite pour les autres. Un premier noyau autonome est maintenant écrit (périmètre ci-dessous) ; aucun point d'entrée de production n'est raccordé.

## Ce que montrent les données

Le baseline figé (`web/out/strip-initial-budget-proof/`) compte118 admissions/10 refus,386ms natifs,1 194 poses de budget sur98 admissions. Le ratio emprise/cible médian est0,5143 et31 cibles sont à±10%. Ce n'est pas un taux de ville. Sur les128 demandes :47 domaines constructibles moins obstacles déclarés sont convexes ;128 sont simples sans trous ;89 couvertures activent potentiellement l'infill ; tous ont un raster physique. Seuls2 patches raster **entiers** ont un dénivelé sous la limite de fondation. Cela ne signifie pas que les126 maisons restantes sont physiquement impossibles : leur empreinte n'occupe qu'une partie du patch.

Un opérateur limité aux rectangles détachés sur terrain entièrement plat manquerait donc le besoin. Il faut partager le vrai modèle Strip/infill avec le générateur, et distinguer certificat géométrique et certificat de terrain.

## Contrat entre sélection, source et géométrie

Proposition de nouveau module `houses/src/direct_convex_fit.rs`, autonome :

```text
solve(descriptor: AffineArchitecture, site: ConvexSite, wish: FootprintWish)
  -> CertifiedFit | Unsupported(reason) | EmptyCertifiedDomain(reason)

CertifiedFit {
  descriptor_identity, regime_id, dimensions_m, transform, frontage_segment,
  contact, body_area_m2, architectural_domain_area_m2,
  attainable_body_area_range_m2, target_met, certified_constraints, pending_checks
}
```

Le descripteur appartient à la source : corps obligatoires et facultatifs déjà décidés, cour, passage, toit, appuis et portail ; chaque sommet est affine en deux dimensions natives `W,D`. L'aire des corps est distincte de celle de l'enveloppe et n'est jamais interprétée en ménages. Pour une bande simple, l'aire est `(W−1,25)×0,75D`. Pour l'infill, elle vient du modèle partagé `UrbanFrontageInfillDraws`, **avec les mêmes tirages conditionnels, clamps, seuils et corps arrière**. Ne pas employer la formule simple pour une source qui ajoute des ailes.

L'infill comporte des régimes affines finis (présence des corps et branches des clamps). Les expliciter dans le descripteur ou commencer par un régime certifié ; une capacité inconnue conserve le chemin actuel. Une énumération de quelques régimes scalaires déclarés n'est pas une construction puis un rejet de maisons. Aucune suppression de composant obligatoire. La galerie déjà prouvée garde son chemin tant que son portail et ses couvertures ne sont pas décrits par le même contrat.

Attention : le seuil natif `area(back)≥4m²` est bilinéaire, pas un simple demi-plan. Le premier noyau linéaire doit recevoir un sous-domaine où ce seuil est déjà prouvé, ou signaler ce régime non couvert. Il ne peut pas ignorer cette condition ni déclarer toute l'infill affine par simplification.

## Calcul dans un seul repère

1. Choisir un vrai segment d'accès utilisable, avec son identité **et sa géométrie**, et un repère une fois. Pour éviter la régression du lot01, utiliser le grand côté intérieur du lot lorsqu'il est presque parallèle à la profondeur de la maison ; sinon le front. Il s'agit d'une règle déterministe sur la parcelle, pas d'essais de bâtiments. Un certificat ne prétend pas couvrir les autres orientations.
2. Convertir les domaines convexes réels en demi-plans. Corps dans constructible, ensemble architectural dans cadastral sans obstacles, toits dans droits de toit : un sommet affine produit une inégalité linéaire en `x,y,W,D`. Pas de hull utilisé comme domaine admissible, pas de découpage final du corps. Les réserves/trous/domaines concaves nécessitent une cellule convexe intérieure certifiée ou le chemin existant.
3. Fixer le recul du front par une égalité de support : l'extrémité complète côté rue, y compris le palier natif, est à la distance déclarée. Cette égalité élimine `y`. Les contraintes restantes sont `a*x+b*W+c*D≤d`. Ajouter dimensions sources/minima, largeur de cour/passages, débords et fenêtre utile du segment d'accès.
4. Éliminer `x` par combinaison des bornes inférieures/supérieures (Fourier–Motzkin), puis découper le rectangle des dimensions par les demi-plans résultants. On obtient le polygone **de dimensions faisables**, sans créer de `LayoutPlan`, de toit ou de pièce. Le noyau est borné par le nombre d'arêtes/source ; les entrées hors limite explicite retournent `Unsupported`, sans nouvelle recherche cachée.
5. Sur ce polygone, l'aire native d'un régime est bilinéaire `A=aWD+bW+cD+e`. Pour les régimes monotones certifiés, son maximum est sur le bord ; chaque arête donne un quadratique dont les extrémités et l'éventuel extremum intérieur se calculent directement. Pour une cible atteignable, résoudre les intersections `A=cible` avec les arêtes et la proportion native préférée ; choisir la solution la plus proche de cette proportion. Ce sont des racines scalaires, aucune maison matérialisée ni balayage de poses.
6. Récupérer l'intervalle exact de `x` aux dimensions retenues, puis choisir l'origine la plus proche de l'ancrage sur rue. Construire **une seule fois** la source avec ces dimensions, seed et régime. Les arrondis millimétriques nécessitent une marge calculée dans les contraintes et une vérification finale ; ils ne doivent pas rouvrir une boucle d'essais.

L'accès oblique utilise les caps déjà corrigés : ouverture native conservée, contact projeté sur la partie utile du front, cap sur l'ouverture et cap sur le segment de rue. Avec une direction de raccord fixée par la normale du front, leurs sommets sont affines aussi. La largeur réelle, l'absence de croisement des caps et le passage entier doivent être dans le descripteur. Un portail seulement proxy ne devient pas certifié par ce calcul.

## Terrain et intégration : limites à conserver

Sur un terrain affine, les différences de hauteur entre sommets du domaine porteur sont linéaires en `W,D` ; elles peuvent limiter directement les dimensions, avec pente et eau inchangées. Pour un raster, une enveloppe affine avec résidu borné est sûre mais peut être trop conservatrice. Le résidu du patch entier n'est pas une preuve d'impossibilité locale. Première intégration possible : certificat géométrique, une vérification physique sur l'unique construction, puis repli actuel si le terrain n'est pas certifié. Ne pas classer cet échec comme impossibilité de la recette.

Point d'insertion proposé : après résolution unique des tirages de la source, **avant** `resolve_urban_architecture` matérialisant son plan, donc avant les tentatives64+16 et avant la passe8/24. Le constructeur et le sélectionneur consomment le même descripteur/certificat ; aucun deuxième choix de dimensions dans `initial_*_programme_dimensions`. Un résultat certifié qui atteint la cible peut court-circuiter ces recherches. Pour une cible non atteinte ou une capacité inconnue, le repli actuel reste comparé au résultat direct et conserve le meilleur plan valide.

La sélection directe prépare un filtre de capacités, pas une exclusion à partir d'un modèle approximatif. Seules les contraintes effectivement certifiées permettent un refus définitif ; `Unsupported` reste distinct. Pins, strict/exact, emprise imposée, niveaux et matériaux explicites gardent leur contrat.

## Premier noyau autonome, sans intégration production

La comparaison initial-Strip seule conserve118/10 mais perd2 admissions et en récupère2. Les poses de budget passent de1194 à1162 seulement ; aucune accélération n'est démontrée. La reprise historique des échecs est traitée séparément dans `CODEX_STRIP_INITIAL_RECOVERY.md`.

`houses/src/direct_convex_fit.rs` expose maintenant `solve_rectangle(RectangleModel, FixedFrontSite, target, aspect)`. Ce premier périmètre est **un corps rectangulaire exact**, des marges rectangulaires architecturales/toit fournies par la source, trois domaines réellement convexes d'au plus16 sommets, et un repère/front déjà fixé. Il n'est pas un descripteur Strip/infill, de cour ou de galerie. Il n'infère aucune capacité par le nom d'un style et ne transforme jamais une enveloppe approximative en certificat de corps.

Le noyau élimine l'origine x, découpe le domaine continu W/D, calcule les extrema exacts de WD sur les arêtes puis les racines d'aire, et récupère l'intervalle admissible de x. Il ne construit aucun plan et ne lance aucun essai de pose. `EmptyFixedDomain` ne vaut que pour cette cellule, orientation et recul. `Unsupported` couvre trous, concavité, limites de complexité ou résolution numérique incertaine. Les dimensions restent continues ; `NativeSourceConstruction`, `CoordinateQuantization`, `PhysicalTerrain`, `NativeRoof`, `EntranceAndAccess` figurent explicitement dans les vérifications restantes.

Cinq tests mathématiques ciblés sont écrits : optimum quadratique dans un triangle, cible et origine, domaines/marges séparés avec dimensions fixes, contour oblique inversé/déterminisme, trous/concavité non certifiés, cibles hors plage. Compilation et exécution coordonnées par root ; ne pas annoncer la validation avant son résultat. L'extension au modèle partagé Strip/infill et le raccord de production nécessitent un accord distinct.
