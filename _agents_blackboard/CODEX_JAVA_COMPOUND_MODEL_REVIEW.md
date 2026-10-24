# Java : programme d’habitat, compound et calibration

23 octobre 2026 — revue documentaire, sans code ni données modifiées. Relecture de `docs/CITY_VARIATION_VARIABLES.md`, `docs/methods/urban-programme-allocation.md`, du contrat de besoin utile et des consommateurs Core. Recommandations, pas calibration nouvelle.

**Décision proposée : conserver le diagnostic du modèle de jeu, mais ne pas transformer son manque de surface en nombre de personnes non logées.** Le compound doit être décrit par les usages de ses membres ; agrandir indistinctement tous ses pavillons ne valide pas un programme d’habitat.

## Ce que les sources établissent

Les notices ci-dessous sont des inventaires officiels avec description de bâtiments, fonctions et transformations. Elles documentent des témoins de Yogyakarta/Sleman, pas un échantillon représentatif de Java à toutes les époques.

| Membre | Observation primaire et conséquence pour le générateur |
|---|---|
| **Pendopo** | Chez Cokro Subroto, réception, réunions et pratiques artistiques ; le **dalem** est le bâtiment de résidence. Le pendopo est de type limasan, le dalem de type joglo et le gandok de type kampung : type de toiture/construction et fonction ne sont donc pas interchangeables. [Inventaire DIY, sections1 et3](https://jogjacagar.jogjaprov.go.id/detail/3974/rumah-tradisional-milik-cokro-subroto). |
| **Pringgitan** | Le même relevé mentionne les représentations de wayang. À Kotagede KG III/776, le pringgitan ouvert reçoit les invités. Conserver un rôle de transition/réception, avec usage documenté par variante ; aucun couchage automatique. [Inventaire Kotagede](https://jogjacagar.jogjaprov.go.id/detail/4971/displayrecords-i-nama-warisan). |
| **Dalem / senthong** | Dans cette maison de Kotagede, les senthong latéraux servent de chambres ; le central est passé d’un espace rituel à la prière. Tout « intérieur » n’est donc pas une surface résidentielle interchangeable. La notice indique aussi des reconversions récentes : ne pas les projeter sur un état historique inconnu. [Même inventaire](https://jogjacagar.jogjaprov.go.id/detail/4971/displayrecords-i-nama-warisan). |
| **Gandok, pawon, espaces ouverts** | Chez Cokro Subroto : gandok pour sommeil et stockage, usage administratif passé, pawon/cuisine ; cour avant pour séchage du riz ou activités publiques. Une dépendance peut avoir plusieurs usages ; une cour n’est ni du plancher brut ni un ménage supplémentaire. [Inventaire DIY, sections4–6](https://jogjacagar.jogjaprov.go.id/detail/3974/rumah-tradisional-milik-cokro-subroto). |

Mijosastran fournit un contre-exemple utile à « beaucoup de surface = beaucoup de logements » : pendhapa public178,69m², pringgitan65,10m², dalem61,67m². Ce sont des mesures de ce bâtiment, dont la notice décrit reconstruction et modifications ; aucun effectif d’habitants n’est donné. Ne pas en déduire un ratio universel. [Relevé officiel Mijosastran, sectionsA–B et histoire](https://jogjacagar.jogjaprov.go.id/detail/3061/rumah-limasan-mijosastran).

La maison noble « complète » est un contexte social particulier : la municipalité décrit les dalem princiers avec leurs pavillons et dépendances. Ce témoignage ne justifie pas d’imposer ce programme complet à chaque parcelle urbaine ordinaire. [Dinas Kebudayaan Yogyakarta, notice des dalem](https://kebudayaan.jogjakota.go.id/detail/index/546/nama-kampung-berdasarkan-nama-dalem-pangeran-di-kecamatan-keraton-yogyakarta-2019-04-12).

## Trois modèles à garder distincts

**Jeu.** L’actuel profil `insular` annonce `generic-compatibility-defaults`, `not-culture-calibrated` :4,5personnes/ménage, base60m² utiles/ménage. Le besoin figé de chaque allocation positive est `ménages alloués ×60×(0,7+0,8×richesse)`.60 n’est donc pas toujours la cible effective. Ce sont des conventions de simulation ; aucune source consultée ne valide ces coefficients, le plafond par parcelle ou la richesse comme norme javanaise. La note d’allocation du21octobre décrit encore certaines hypothèses antérieures (« une unité/parcelle ») : le programme retenu et son modèle versionné font foi, pas cette phrase comme règle courante.

**Calibration culturelle.** Il faudrait un corpus localisé et daté distinguant statut social, habitat ordinaire/noble, rural/urbain, état observé/restauré, usages, surfaces et occupants effectivement documentés. Les relevés consultés renseignent surtout la forme et l’usage ; ils ne suffisent pas à calibrer60m² ou4,5personnes. Garder ces paramètres explicitement artistiques tant que cette enquête manque. Aucune norme moderne n’est substituée à une connaissance historique.

**Programme architectural.** Une seule allocation peut demander plusieurs membres complémentaires, sans que chacun crée un ménage. Prévoir fonctions requises/optionnelles, compatibilités d’usage et accès public/privé ; permettre des variantes modestes et des extensions documentées. Le brut actuel inclut optimistement tous les niveaux de corps, y compris mixtes ou de réception : il ne prouve ni chambres, ni utile résidentiel. Sa borne `max(0, besoin indicatif−brut)` reste valable seulement dans le périmètre déclaré `housing_in_body_levels`. Les features hors corps restent hors de ce compte. Un brut suffisant n’est jamais une validation fonctionnelle.

## Conséquences UI et dimensionnement

- Afficher ensemble **population demandée**, **ménages alloués selon modèle**, **besoin utile indicatif**, **brut mesuré**, **capacité résidentielle inconnue** ; aucune conversion du déficit en habitants « sans logement ».
- Montrer « Modèle de jeu générique — non calibré pour Java », version/provenance,60 de base, facteur de richesse et cible effective ; garder le modèle appliqué avec URL/export/import, sans recalculer un ancien plan depuis les réglages courants.
- Dans l’inspecteur : composition demandée/réalisée et usages des membres ; une annexe ou un pavillon ne doit pas être étiqueté logement sans preuve. Distinguer refus physique, membre fonctionnel manquant, manque selon modèle et inventaire inconnu.
- Un futur ajustement automatique peut viser le **modèle de jeu choisi**, explicitement ; il doit conserver ses demandes et contraintes physiques, privilégier les membres compatibles et déclarer le reste manquant. Ne pas gonfler un pavillon de réception pour solder artificiellement du logement, ni diminuer la population pour faire disparaître l’écart.
