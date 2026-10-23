# Premier pont natif vers le solveur convexe — isolé, non activé

23 octobre 2026. `native_single_fit.rs` et `native_single_fit_tests.rs` sont écrits et formatés. Aucun raccord à `plans.rs`, changement de catalogue, compilation, serveur ou rejeu n'a été effectué pour cette tranche. L'enregistrement proposé est exclusivement `#[cfg(test)] mod native_single_fit;`, à côté du noyau `direct_convex_fit` déjà enregistré en test.

## Périmètre exact

Le premier opérateur couvre les déclarations Single / FP-RECT, Ground / Walled, un corps à un étage, sans détail ni galerie, cour, annexe, enclos, programme structurel ou accès vertical. Gable et Hip simples uniquement. Il ne reconnaît pas de nom culturel : AS-ISL-B14 et B15 sont deux témoins réels qui satisfont ces capacités. Les variations et styles hors périmètre conservent le chemin actuel.

Pour ce constructeur, les dimensions natives `W,D` sont celles du corps `(0,0)–(W,D)`. `primitive_with_options` en fait l'union native canonique, puis `spec` conserve ce domaine à l'unique niveau. Il n'y a ni cour ni passage à réserver. Le lot d'atelier est plus large de 6 m de chaque côté mais, en l'absence d'enclos et de structure extérieure, ce lot n'est pas une occupation à faire entrer dans le parcellaire.

Le débord de toit est le tirage existant `overhang_m[0]`, identique pour chaque arête puisque les cas mitoyens, cours, couvertures ajoutées et spécifications spéciales sont exclus. Le descripteur réserve une boîte extérieure avec ce débord arrondi vers l'extérieur et un millimètre supplémentaire pour les coordonnées natives. Il s'agit d'une enveloppe conservatrice, pas d'un mesh certifié. La construction native du toit reste contrôlée par les gardes existants ; le test rejoue les vrais toits Gable et Hip pour comparer leur projection avec le domaine fourni.

## API et coût causal

`prepare(original_request, resolved, native_layout_seed, exact_or_imposed, parcel_fit)` retourne un descripteur lié à l'architecture immuable ou `Unsupported(reason)`. La requête doit être l'originale avant sélection interne : demande automatique inspired domestique/mixte, sans recette, atelier ni override. Strict, exact, empreinte imposée et `parcel_fit=false` restent hors périmètre. Le seed natif est fourni par son propriétaire, sans le recalculer ni le tirer à nouveau.

Les intervalles proviennent de `resolve_variant_parameters` pour la variante déjà retenue : minima source × `size`, maxima source × `size` × l'extension inspired existante de 2. Ils sont intersectés avec `minimum_domain`, les limites natives de primitive 2–200 m et la grille millimétrique. Le minimum d'admission ne devient jamais un plafond. Les matériaux, proportions de toiture, nombre de pièces et autres tirages sont clonés sans modification.

`descriptor.solve(FixedFrontSite, target_m2)` effectue une résolution continue du noyau, arrondit les deux dimensions vers l'intérieur, puis appelle **une fois** `build_layout` sur la même recette et le même seed. Il vérifie le rectangle natif et ses droits après quantification. Il ne construit ni intérieurs ni mesh de toit. Les résultats distinguent `Candidate`, `EmptyFixedDomain` et `Unsupported`; une cellule vide ne prouve rien sur une autre orientation, un autre recul ou le terrain.

Les trois domaines sont déjà dans un repère orthonormal fixé : corps dans constructible, occupation dans cadastral sans obstacles, débords dans droits de toit. Le front est à `front_y`, avec +y vers l'intérieur. Le corps natif est posé par une rotation rigide de 180° et une translation `(x+W,y+D)`, car sa rue d'atelier est du côté natif +y. Ce choix ne certifie pas une vraie porte. Le caller devra sélectionner un **vrai** accès et conserver la validation géométrique du raccord, y compris les caps obliques déjà corrigés. Le helper n'invente pas de passage pour obtenir une admission.

Le résultat garde l'aire analytique continue séparée de l'aire du corps natif réellement construit et de son écart à la cible. Aucun nombre de ménages n'est déduit. Terrain, eau, accès natif, toit et contraintes non représentées restent explicitement à vérifier ; le helper ne cherche pas un autre candidat après leur échec.

## Plus petit raccord envisageable après preuve

À court terme, utiliser ce pont pour remplacer la passe de dimensions après la résolution native déjà disponible : une seule construction supplémentaire, puis l'admission complète existante. Si le candidat valide atteint la cible, les essais de dimensions deviennent inutiles sur ce périmètre. Si le candidat est moins bon, refusé ou inconnu, conserver le plan valide et le parcours courant. L'activation exige une comparaison qualité/coût, pas seulement les tests géométriques.

L'étape suivante pour éviter aussi le prototype initial consiste à préparer le même descripteur directement à la sortie de `selected_draws`, avant `build_layout`, avec la recette, les paramètres et le seed possédés par engine. Cette extraction n'est pas faite ici. Elle ne doit pas rappeler la sélection ni choisir les dimensions une seconde fois.

## Pourquoi le Strip n'est pas encore raccordé

Le Strip simple conserve `b = W−1,25`, `h = 0,75D`, un corps `[0,b] × [D/4,D]`, une cour `[0,W] × [0,D/4]` et un passage latéral de 1,25 m. En coordonnées corps, la profondeur de cour vaut `h/3` : elle n'est **pas une marge constante** acceptée par le premier noyau. B02 ajoute aussi des murs latéraux de 0,2 m, et `side_corridor` une galerie et ses poteaux natifs. Une couverture/infill éventuelle change encore les domaines et l'aire bâtie.

La bonne extension doit ajouter aux contraintes du noyau des sommets affines en `b,h` pour chaque domaine réel (corps, cour, passage, galerie/appuis, toit). Elle réutilisera les primitives natives ou un descripteur scalaire partagé, sans recopier leurs formules et sans imposer leur boîte englobante aux droits du corps. L'infill garde ses régimes et seuils bilinéaires ; il n'est pas couvert par le certificat Single. Aucun essai historique Strip n'a été supprimé.

## Témoins préparés

Trois tests : construction et toit natifs B14/B15 dans un trapèze convexe, mêmes tirages et résultat déterministe ; minima/maxima réels, cellule vide et trous explicitement non couverts ; pins/strict/exact/fit désactivé et programmes Strip/porche exclus. Les tests attendent la compilation commune root. Aucun gain de vitesse ni taux d'admission n'est annoncé.
