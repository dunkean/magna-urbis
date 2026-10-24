# Remplacement explicite d’un profil — carte des setters, en attente de diagnostic justifié

Lecture seule du produit après UI growth5 ; aucun code/produit/test/build/natif/serveur/browser modifié ou exécuté. Les cinq fichiers growth validés restent intégrés. Demande : abandonner les très grandes villes pour les combinaisons non couvertes en laissant l’utilisateur remplacer explicitement un profil, sans baisser sa population.

## Ce qui existe réellement

`cityPlanCulture.ts:7–37` / `terrainUrban.ts:1754–1756` conservent déjà la surcharge du plan sans modifier les autres étages. `urbanBuildingsPanel.ts:286–292,467–476,519–529` expose le vrai select architectural, son brouillon et sa restauration. `terrainUrban.ts:1903–1916,1954` distingue brouillons et valeurs appliquées sérialisées ; les liens exportent l’état appliqué. `CITY_VARIATION_VARIABLES.md:1.5` décrit ces précédences.

Deux chemins ne conviennent pas à un remplacement conservateur : **style global** (`terrainUrban.ts:746–754`, `urbanSettlementStyles.ts:15–20`) réinitialise volontairement recettes/surcharges ; **onchange générique du parcellaire** (`terrainUrban.ts:1723–1735`) efface params/JSON puis remet recipe/zone/preset. Il faut un setter ciblé comme celui du plan, pas déclencher ces handlers pour fabriquer un changement de culture.

## Mécanisme conservateur possible — insuffisant seul, non autorisé à coder

Ajouter dans CityBench un petit volet « Remplacer un profil », à proximité des profils existants :

1. Choisir **un seul axe** : plan, parcelles ou architecture. Le profil du lieu reste distinct et conservé ; aucun remplacement global implicite. Un choix multiple est une option ultérieure, pas nécessaire à cette tranche.
2. Sélectionner un autre ID du catalogue **existant**, avec label/ID visibles et sans classement « approprié/garanti » tant que la preuve manque. Les IDs inconnus de la configuration actuelle restent affichés, sans substitution automatique. L’éventuelle couverture sera affichée par étape/configuration, pas comme un plafond de la culture entière.
3. Avant le bouton d’action, montrer les trois valeurs demandées avant→après, le profil du lieu inchangé, les surcharges/recettes explicites conservées et le niveau de régénération nécessaire. `site` du plan/parcellaire et chaîne vide/absence architecturale gardent leurs vrais sens d’héritage ; aucune fusion des axes.
4. Bouton explicite « Préparer ce remplacement » : ne change que le champ de l’axe choisi, en utilisant les vrais contrôles/configs. Aucune génération cachée liée à un refus ni remplacement choisi automatiquement. La génération manuelle reste un acte séparé ; si l’autoapplication existante reste active, il faut l’annoncer avant le bouton, ou préparer ce changement sans la déclencher. Une archive ancienne ne devient jamais la preuve d’application du nouveau choix.

| Axe choisi | Champ qui change | Régénération requise | Conservé |
|---|---|---|---|
| Plan | `layoutConfig.culture` uniquement | plan, parcelles, puis bâtiments | lieu/population/centre/graines, recette/preset/JSON, mix, parcellaire et architecture explicites |
| Parcelles | `parcelConfig.culture` uniquement | parcelles puis bâtiments ; rues conservées | même conservation, dont surcharges params/JSON/recipe/preset |
| Architecture | vrai select/brouillon `culture` des bâtiments | bâtiments seuls | rues/parcelles et autres champs du brouillon : seed, floors, typology, replay, fit |

Les combinaisons restées incompatibles ne sont pas silencieusement réinitialisées : le refus natif est affiché. La population exacte reste identique. Remplacer l’architecture ne prouve pas que le plan est adapté, et remplacer le plan ne certifie pas les archives de bâtiments déjà conservées. Les liens/MU1/imports continuent à porter leurs valeurs explicites ; l’intention temporaire du volet ne devient pas une seconde source de configuration. Après application réussie, les chemins existants partagent la configuration réellement appliquée.

## Raccord et contrat de couverture

Feasibility_review confirme provisoirement : pas de plafond culturel natif ; `Culture.scale.max=megacity` historique n’est pas un certificat et son clamp peut changer la population. Défaut **inconnu**. **Non couvert** seulement sur refus/capabilité réellement déclaré dans une portée donnée ; un déficit Java100k ou une absence de benchmark ne suffit pas. **Établi** exige preuve/version/configuration exactes, jamais un verdict global par ID de culture.

Je lui ai transmis ce scope UI et demandé son petit shape partagé/provenance avant édition. La première implémentation ne créera ni seuils, ni recommandations, ni registre de couverture parallèle. Elle peut fonctionner comme remplacement manuel honnêtement inconnu ; les motifs attestés se brancheront sur les données effectivement disponibles. Le libellé « autre profil » remplace toute promesse « culture compatible » non établie.

Fichiers probables bornés : nouveau helper/binding UI ; `terrainUrban.ts` pour setters conservateurs et emplacement ; `urbanBuildingsPanel.ts` pour modifier seulement son vrai champ de culture en conservant le reste du brouillon ; tests ciblés et paragraphe de doc. Aucune source Rust/Houses, aucune nouvelle limite technique/historique.

Tests à préparer pour root : chaque axe ne change que son champ ; population/centre/graines/pins/mix/période/replay restent byte-identiques ; absent/null/chaîne vide/ID inconnu restent distincts ; annulation/fermeture ne modifie rien ; changement de source invalide la proposition ; vrai callback génération reçoit le remplacement choisi et conserve refus natif ; roundtrip URL/MU1/import puis restauration du brouillon. Pas de million, campagne visuelle ou benchmark dans ce lot.

## Arbitrage root après cette première lecture

Le seul sélecteur non classé décrit ci-dessus est **insuffisant** et trop proche des contrôles existants. Root demande un vrai point d’entrée lié au diagnostic : pourquoi le profil courant dépasse une portée attestée, et quel motif documenté justifie chaque autre choix. Un statut `unknown/no_scoped_evidence` ne signifie ni incompatibilité ni alternative compatible. Aucun code ne sera commencé sur cette seule base.

Feasibility_review propose un objet `technical-coverage-1` distinct du routage `CultureMapping.coverage`, scoped par profil/population/classe/grammaire/étape/mode/période/chemin/version/preuve. Les statuts envisagés sont established/not_covered/unknown ; aujourd’hui la seule valeur universellement justifiée est unknown/no_scoped_evidence. L’UI ne doit pas matérialiser un registre positif/refus ou une liste de remplaçants en le déduisant des noms. Demande complémentaire transmise : trouver des intentions/contraintes explicitement déclarées, des refus natifs exacts ou des preuves gelées avec portée suffisante pour motiver le diagnostic et des remplaçants, sans plafond historique arbitraire. Root accepte un avertissement d’intention ou de couverture technique justifié.

La carte des setters, les axes indépendants, la conservation des liens et le résumé de régénération restent valides pour le raccord ultérieur. Aucun formulaire générique ni dataset de recommandations n’est implémenté.
