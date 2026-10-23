# Palette Java : traditions déclarées et sélection — 22 octobre

**Conclusion : AS-ISL est un regroupement géographique, pas une palette javanaise.** Il contient **10 recettes exécutables**, et non 11 : B01–B11 sauf B08. Le document source décrit 13 types ; B08/B12/B13 sont explicitement `outside_houses`. B06 est la seule recette exécutable dont la tradition est explicitement Java. Rien dans les sources consultées n’autorise à appeler B05 balinais une maison javanaise par défaut. Lecture seule de `recipes.json`, `source-inventory.json`, du mapper local et du code ; aucun run, aucune modification de mapping/catalogue.

## Inventaire source → programme effectivement disponible

Les lignes renvoient à `docs/styles_architecturaux_mondiaux_city_mapper.md`. Toutes les recettes exécutables ont `confidence=stylized`, des dates exactes absentes et un seul étage. Les noms des layouts ci-dessous sont des catégories techniques du moteur, pas des attributions historiques nouvelles.

| ID | Tradition explicitement déclarée | Composition native actuelle | Source / statut Java |
|---|---|---|---|
| B01 | Austronésienne, archipels tropicaux ; S01 | Platform, rectangle, 1 corps ; variante bambou | L928/911. Générique régional, **Java non spécifié** |
| B02 | Longhouse de Bornéo ; S02 | Platform, rectangle long, 1 corps à 8–20 pièces ; bardeaux | L929/912. Autre tradition, programme communautaire |
| B03 | Tongkonan toraja, Sulawesi ; S03 | Platform, rectangle, 1 corps, toit selle | L930/913. Autre tradition |
| B04 | Alang, grenier toraja ; S03 | Platform, petit corps `facing_main` ; annexe, poids0 | L931/913. Autre tradition ; pas logement automatique |
| B05 | Concession balinaise ; S04 | Layout technique Kancha, 4–8 corps, enclos ; variante palmes | L932/914. **Bali, pas Java** |
| B06 | Joglo javanais ; S05 | Single, rectangle14–22 ×14–22 m, 1 corps, RF-HIP, pas de variante | L933/915. **Seul logement explicitement Java** |
| B07 | Maison malaise, Malaisie/Sumatra ; S06 | Platform, rectangle, 1 corps, galerie ; tuiles/bambou | L934/916. Autre tradition |
| B08 | Candi javanais | Sanctuaire carré sur socle étagé décrit, **aucune recette exécutable** | L935 ; `outside_houses`. Pas un substitut domestique |
| B09 | Omo hada, Nias ; S08 | Platform, 1 corps rectangulaire ou variante ovale | L936/918. Autre tradition |
| B10 | Rumah gadang minangkabau dans le libellé | Platform, rectangle large, 1 corps ; `late_only=true` | L937. **Association S12/« iconographie toraja » incohérente** avec le libellé ; ne pas propager cette association comme vérité |
| B11 | Batak dans le libellé ; S09 plus vague (« plusieurs îles ») | Platform, rectangle, 1 corps à hauts pignons | L938/919. Pas Java ; facette S09 insuffisamment précise pour une attribution locale |

B12 (salle/temple balinais meru, L939) et B13 (analogue tambaran, région à préciser, L940) sont également `outside_houses`. Le settlement **S07 ville royale javanaise** décrit palais, places et temples séparés (L917), mais aucune recette résidentielle exécutable ne lui est associée. S05 décrit maison principale et ateliers autour d’une cour ; **B06 n’en réalise actuellement qu’un corps**, malgré la mention « + annexes » de sa description. Ses détails `open_sides` et sa catégorie native `envelope=walled` ne suffisent pas à certifier une halle ouverte. La palette seule ne fournira donc ni les habitats populaires manquants, ni les annexes, ni une vraie ville royale.

## Pourquoi le mélange actuel ne déclare pas ses emprunts

`core/urban/culture.rs::MAPPINGS` route `javanese-courts → AS-ISL`, famille compound, **borrowed=false**. `from_profile` inscrit `coverage=shared-pack` et une chaîne borrowing vide. Le rôle `stilt-town`, lui, utilise le même pack avec un emprunt explicitement déclaré : ce statut existe, mais **n’est pas celui de Java**. Le document `docs/methods/urban-programme-allocation.md:31,88` dit expressément qu’un shared-pack ne prouve pas chaque recette dans chaque contexte.

`houses/plans.rs:911–949` filtre pack, recette/variante explicites, mode, ère, late et typologie ; puis classe les souhaits de composition/étages avant au plus quatre recettes distinctes. **Aucune tradition locale n’entre dans la requête.** `style_index.rs` expose pourtant les valeurs exactes `settlement_archetype`, `subtradition` et leurs index ; `StyleQuery.settlement_archetype` est déjà utilisable. `subtradition` est indexé mais n’a pas son propre champ de requête. Les contrôles stricts actuels portent sur la configuration/ère/late et l’emprunt explicitement marqué, sans déduire une frontière Java/Bali à l’intérieur du pack.

Dans le cas exact8791, B06 représente124 des484 bâtiments (25,6 %), B01 en représente200 et les autres traditions160. **360 bâtiments sont donc génériques ou attribués ailleurs, sans emprunt déclaré dans la requête.** Cela décrit le mélange actuel, pas une preuve que chaque forme serait historiquement impossible à Java.

## Proposition minimale, à convenir avant code

1. **Ajouter une liaison de palette explicite à la frontière culture→architecture**, sourcée et versionnée, puis employer la facette existante plutôt qu’une recherche de mots dans les labels. Exemple de donnée proposée, pas d’API déjà implémentée :

   ```json
   {"version":1,"culture":"javanese-courts","pack":"AS-ISL",
    "native_archetypes":["AS-ISL-S05"],"declared_borrowings":[],
    "sources":[{"path":"docs/styles_architecturaux_mondiaux_city_mapper.md","line":915}]}
   ```

   Pour ce seul cas, `StyleQuery.settlement_archetype="AS-ISL-S05"` suffit : il trouve B06 et conserve ses variantes futures sans dupliquer une liste de recettes. La liaison doit avoir **une seule source d’autorité**, validée contre l’index et exportée/réutilisée pour l’admission parcellaire ; éviter une palette Houses et une table core divergentes. La capacité géométrique et les minima restent les contraintes réelles de B06, sans gonflement pour remplir les lots.
2. **Distinguer sélection locale et emprunts artistiques.** Aucun emprunt spécifique vers Java n’est documenté ici : liste vide par défaut. B01 pourrait être proposé comme *option artistique régionale explicitement choisie en inspired*, avec provenance/diagnostic ; ce serait une décision de produit, pas une nouvelle affirmation historique. Idem pour Bali/Bornéo/Toraja, jamais ajoutés silencieusement pour atteindre quatre essais ou améliorer le taux. Une palette à une recette fait un essai, puis explique ses lacunes. Le mode inspired autorise des emprunts déclarés, il n’oblige pas à mélanger tout le pack.
3. **Préserver les choix explicites et les limites de source.** La palette ne s’applique qu’à la sélection automatique ; ne pas remplacer un pin recette/variante, `house_config` exact ou workshop. Conserver les contrôles natifs de mode/ère/late/overrides et tracer un choix explicite hors palette. Pas de requalification de B05 en Java ni de candi dessiné avec une maison. Les métadonnées actuelles donnent globalement A/M, alors que S05 dit M/T et avertit de survivances tardives : une restriction locale précise en strict demande un travail de sources supplémentaire, pas une inférence de cet audit.

**Portée honnête :** cette palette corrigerait le mélange culturel automatique ; elle ne résout ni les 54 094 habitants de déficit parcellaire indicatif, ni les 1 261 refus de plans du cas8791. Il manque des programmes javanais résidentiels/composites plus divers et suffisamment documentés. B05 n’est pas ce programme manquant.
