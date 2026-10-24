# Responsable 5 — matrice de recette finale préparatoire

**Aucun geste UI ni nouvelle capture exécuté.** CUA est vide ; Chrome et IAB sont indisponibles selon root. Aucun contournement, test, Cargo, serveur ou fetch dans ce lot. Les fonctions pondérées et les 11 grammaires sont promues en source ; B4 reste une proposition, sans validation navigateur. La campagne existante de 52 vues reste la seule.

Conserver les deux références exactes : cas 51 Roman, 5 000 habitants, position fractionnaire, silhouettes et parchemin ; cas 52 Java, 100 000 habitants à 8000/8000, mode détaillé et fond rendu. Relever les SHA, paramètres et caméras réellement utilisés. Toute variante de paramètres forme une sous-recette distincte.

| Recette réelle : toutes non exécutées | État attendu | Source observable ou limite |
|---|---|---|
| Fonctions : brouillon, combinaison, appliquer et reset | Distinguer les poids demandés du programme retenu ; automatique et objet zéro restent distincts. Un ancien moteur incompatible refuse explicitement. | Contrôles `data-programme-intent`, `data-programme-custom-functions`, `data-programme-function`, marqueur `data-programme-draft`, résumé `data-programme-functions-applied`, warnings. L’observateur promu `ui.programmeFunctions` décrit ces éléments ; il ne certifie pas leur résolution native. |
| Grammaires et retour automatique | Le rapport vient du plan retourné, pas du brouillon. À 100 000 habitants : classe Métropole, mais grammaire automatique de cité avant 200 000. Ancien import sans preuve : inconnu. | `[data-config="settlementForm"]`, `[data-morphology-auto]`, `[data-native-morphology]` et `[data-settlement-resolution]`. Le runner ne relève pas encore ces contrôles et textes. |
| Ouverture froide avant l’overview global | Le premier affichage local n’attend pas la reconstruction globale. Pendant celle-ci, couverture partielle ou attente explicitement indiquée. | B4 propose `overviewStatus`, progress, cache status, requesting et coverage. Les 98,6 s rapportées par root pour B3 ont été mesurées hors navigateur : ce n’est ni un temps UI ni un résultat B4. |
| Pan et zoom pendant la construction | Une ancienne génération ou caméra ne republie pas sa fenêtre. Une lecture exacte encore attendue ne produit pas un faux vide ni un faux picking définitif. | Contrat B4 en cours : viewport, IDs résidents, génération, pending, truncated et canal evidence synchrone sans I/O. Vérifier la pose monde et la source retenue ; les voisins et archives originales restent au stockage. |
| Fond, pan, zoom et scroll du panneau | Le fond, les routes, les empreintes et le picking restent attachés aux mêmes coordonnées monde. Le scroll du panneau ne déplace pas la carte. Aucun fond ou glyphe figé à l’écran. | `#map.viewBox`, `#cityBackground image`, `window.magnaCityBackground.url/style`, `#backgroundStyle`, `#showBackground` et gestes sur `#viewport`. Le runner observe view/viewBox, mais pas la pose du fond ni la position pixel d’un point monde. |
| Quota et couverture tronquée | Pending, budget ou troncature ne deviennent jamais « ville sans maisons » ni « affichage complet ». Une fenêtre exacte vide ne décrit que cette fenêtre. | B4 propose `coldCoverage`, `coldTotal`, `coldResident` et les statistiques de budgets/lectures. `buildingsPainted='unknown'` doit rester inconnu, jamais zéro. Les octets encodés ne sont pas une mesure de heap. |
| Comptes habitants et maisons | Les totaux globaux viennent du manifeste froid. Résidents et éléments peints décrivent le viewport. Population cible, ménages prévus et habitants réellement logés restent séparés. | `[data-city-building-counts]`, attributs planning/completed/total, `[data-city-frame]`. La branche froide actuelle annonce des plans de bâtiments et une capacité non évaluée. B4 ne doit pas remplacer ce total par son sous-ensemble visible. |
| Mode détaillé sur grande ville et sélection | Aucun détail natif de toute la ville. Sélection et contexte réels, calcul borné, emprise conservée ; pending et refus explicites. | `[data-city-architecture]`, données `detailCached`, `detailInFlight`, `detailCacheBytes`, `[data-city-realized]`, inspecteur et ouverture Houses. Une image sans extérieur en cache ne prouve pas le rendu détaillé. Signaler toute matérialisation globale encore nécessaire en 3D, rôles ou édition. |
| Culture, cours et programme | Comparer les mêmes IDs et caméras. Cours et fronts cohérents, défauts d’ailes ou fentes non déclarés résolus sans nouvelles images. Preview et plan admis restent distincts. | Inspecteur, culture/recette, rapports natifs, plans et refus. Les anciennes images S7 ou 8791 restent historiques. Une tolérance d’emprise ne certifie ni le programme complet ni les ménages logés. |

## Ce qui a déjà été testé

- Root : 6 tests purs des outils 52 vues et preuve de préparation des 2 URL ; puis 4 tests purs de l’observateur et 2 contrôles de syntaxe. Preuves dans `web/out/responsable5-visual-review-v2/delivery/after.json` et `web/out/responsable5-functions-review/delivery/after.json`.
- Fonctions en production : 46 tests frontend sur 7 fichiers, typecheck et bundle réussis ; `browserVerified=false` dans `web/out/city-programme-functions-production-proof/verification.json`.
- Morphologie : 43 tests frontend sur 5 fichiers, 5 tests natifs et typecheck réussis au gel isolé. La preuve `web/out/city-demography-morphology-first-proof/verification.json` indique encore `productionPromoted=false` pour cet ancien état ; la promotion ultérieure est documentée par parameters_ui. Cela ne constitue pas une recette UI du produit intégré.

Aucun de ces résultats ne clôt les neuf lignes de gestes ci-dessus.

## Deux lacunes en attente du contrat B4 final

1. Dans le runner actuel, `Number('unknown')` produit NaN, ensuite sérialisé en null, sans le warning prévu pour un compte indisponible. Il faut normaliser explicitement un compte inconnu et ne jamais le traiter comme zéro.
2. Le settled actuel regarde HTTP, les détails et 900 ms de calme ; il ne voit pas la reconstruction locale, la troncature, un changement de caméra ou une génération périmée. Un état de réception native complète ne prouve pas que la couverture globale ou la fenêtre exacte est prête.

Ces deux points ont été transmis à root et à feasibility_review. B4 a déjà un getter evidence dans sa copie évolutive, mais le contrat n’est pas encore gelé. **Le petit correctif assessCapture/settled est reporté après cette livraison. Aucun script, produit ou test ajouté dans ce lot.** Les observations supplémentaires manquantes restent la morphologie demandée/retournée et la pose du fond ; ne pas les remplacer par des métriques inventées.

Statut final : matrice figée, recette navigateur en attente, créneau libéré pour le responsable maisons. Root centralise les tests et la validation du futur correctif.

Reprise ultérieure, après gel du contrat B4 v1 : le petit correctif isolé est maintenant préparé dans `web/out/responsable5-b4-capture-proposal/`. Treize tests purs sont fournis, non exécutés ; aucun runner produit changé. Détails et nuance sur le hook universel dans `CODEX_RESPONSABLE5_B4_CAPTURE_DELIVERY.md`. Cela ne change aucun statut de recette UI ci-dessus.
