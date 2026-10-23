# Revue indépendante — récupération initiale terrain

23 octobre 2026. Lecture seulement des fichiers de `proposals/initial_terrain_recovery/` et des helpers appelés ; aucun Rust actif modifié, aucun test, build ou calcul natif lancé par cette revue.

**Pas de bloqueur restant identifié dans le périmètre proposé**, après les corrections ci-dessous. Cela autorise une validation dans la copie isolée, pas une annonce de récupération des refus.

## Deux risques corrigés pendant la revue

1. Un succès de `plan_one_initial` repartait normalement dans `improve_domestic_budget`, ce qui pouvait engager un second guide de huit évaluations après le nouveau repli. Le raccord renvoie maintenant un résultat typé `(building, recovered)` ; seuls les succès récupérés sautent cette amélioration, puis passent par la finalisation d’entrée habituelle. Les succès antérieurs gardent leur séquence.
2. `native_ground_preparation_allowed` regarde le mode culturel, mais pas le mode original de `request.config`, normalisé ensuite par la voie historique. `Recovery::new` exige désormais explicitement un mode original inspired et un pack cohérent, en plus des exclusions recette, workshop, overrides, exact, empreinte imposée et `parcel_fit=false`. Des négatifs spécifiques sont préparés.

Le test frère accédait aussi au champ privé `enabled`. Un getter `cfg(test)` et ses deux appels ont remplacé cet accès ; constat de lecture, compilation encore à effectuer par la racine.

## Invariants relus

- **Admissions préexistantes :** les voies initiale, dimensions anciennes et famille simple supplémentaire gardent leurs retours ordinaires. L’observateur reçoit seulement les nombres déjà calculés au garde fondation. Aucun nouveau calcul terrain ni construction avant l’échec de toute la séquence ; la première architecture compatible est seulement mémorisée. Pas de nouvelle sélection de source ou de variante, ni de tirage.
- **Budget unique du repli :** un état partagé entre les passes ; `finish` non réinitialisable ; au plus huit évaluations supplémentaires du guide, une reconstruction et une admission finale. Le premier corps compatible peut ne pas fournir de réduction : aucun autre témoin n’est alors essayé. Ce choix borné ne démontre ni optimalité ni impossibilité du site.
- **Dimensions et source :** largeur/profondeur lues dans les coordonnées du vrai corps retenu ; bornes de la variante × taille et permission inspirée ×2, relevées aux minima natifs. Le garde impose Single/RECT/Ground, un corps, niveaux identiques, aucun vide, cour, passage, cellule ou feature, toit simple gable/hip. Le constructeur redimensionne ce corps natif ; étages, matériaux et choix de toiture restent ceux du témoin.
- **Façade et grille :** `lower_front` exige l’accès du côté extérieur du y=0 natif. La réduction conserve centre de façade et angle ; les rectangles sont emboîtés. Rapport de source, minima et dimensions quantifiées sont revérifiés avant construction. Aucun portail nouveau n’est choisi par le guide.
- **Droits et physique :** le témoin vient du vrai rejet fondation, après les droits du corps/occupation. Le guide ne remplace pas l’admission finale : droits constructibles/cadastre/réserves, voisins, toit, eau, terrain et raccord public sont à nouveau contrôlés. Une erreur de lecture raster reste absence de proposition, pas terrain favorable.

## Limites à conserver dans la preuve

Observation limitée aux **poses de façade préférée des sources initiales** (programme Row ou continuité élevée). Les poses centrées et candidats adaptés ne sont pas récupérés. Le contrat explicite `native_minimum_candidates` conserve son court-circuit indépendant. Un refus uniquement dû à l’eau ne déclenche pas cet observateur de pente/dénivelé.

Le témoin1050 conserve les demandes enrichies du lot016 et les21 occupations antérieures reconstruites. Son test distingue explicitement absence de témoin, réduction impossible, refus final et succès réel. Les valeurs publiées après compilation devront donner corps/pose/assise natifs, évaluations et contrôles finaux. Toute conservation byte-à-byte des succès historiques reste à confirmer par les comparaisons de la racine ; elle n’est pas revendiquée comme mesure par cette lecture.
