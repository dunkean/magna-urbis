# Habitat javanais : sources et modèle minimal

Recherche du 22 octobre 2026 ; aucune modification du catalogue.

Le catalogue local distingue explicitement B05 « Maison balinaise en concession » de B06 « Joglo javanais » (`docs/styles_architecturaux_mondiaux_city_mapper.md:932–933`). B05 ne doit donc pas servir de substitut javanais. Les recettes doivent distinguer forme de toiture, fonction du corps et unité résidentielle.

## Ce que les sources établissent

**Maison, ménage, parcelle.** Weichart décrit les maisons kampung simples des populations ordinaires, les limasan de familles plus aisées et le prestige historique du joglo. L’unité résidentielle privilégiée est la famille nucléaire, éventuellement élargie. Les familles disposant de moyens et de terrain pouvaient habiter un ensemble clos comprenant plusieurs bâtiments. Cela ne fournit aucun coefficient universel « cinq ménages par cour ». Le pendapa reçoit les visiteurs et les réunions ; le pringgitan constitue la transition et accueille notamment le wayang ; l’omah/dalem contient la vie domestique plus privée. [Weichart, *Fabrications* 30(1), 2020, p. 25–43](https://doi.org/10.1080/10331867.2020.1726626).

**Géométrie documentée.** Kampung : deux pans et pignons triangulaires ; variantes avec emper sur un côté ou autour des quatre côtés. [Dinas Kebudayaan DIY, 2021, d’après les manuscrits étudiés au musée Sonobudoyo](https://budaya.jogjaprov.go.id/artikel/detail/Mengenal-Bangunan-Berarsitektur-Tradisional-Jawa-Bangunan-Kampung). Limasan : plan quadrangulaire, quatre versants et faîtage ; extensions distinctes selon les variantes. [Inventaire officiel *Arsitektur Tradisional Daerah Jawa Tengah*](https://repositori.kemendikdasmen.go.id/5552/1/ARSIKTEKTUR%20TRADISIONAL%20DAERAH%20JAWA%20TENGAH.pdf). Le limasan n’a pas le tumpang sari du joglo ; les variantes d’emper sont documentées. [Dinas Kebudayaan DIY, 2021](https://budaya.jogjaprov.go.id/artikel/detail/Mengenal-Bangunan-Berarsitektur-Tradisional-Jawa-Bangunan-Limasan).

**Mesures ponctuelles, pas normes.** L’inventaire patrimonial Cokro Subroto relève : pendopo limasan 10,07 × 11,84 m, hauteur 6 m ; dalem joglo 8,20 × 9,60 m, hauteur 6,98 m ; gandok kampung latéral 11,69 × 3,55 m, hauteur 4,84 m. Ce gandok sert au couchage et au stockage. Les passages autrefois ouverts mesurent 2,25 et 2,06 m. Ce cas montre aussi qu’un pendopo n’est pas obligatoirement joglo. [Registre officiel Jogjacagar, Cokro Subroto](https://jogjacagar.jogjaprov.go.id/detail/3974/rumah-tradisional-milik-cokro-subroto). Autre composition attestée : lintring → joglo → omah arrière limasan, sans pringgitan intermédiaire. [Jogjacagar, Sutinah R. Sukardi](https://jogjacagar.jogjaprov.go.id/detail/2385/rumah-tradisional-sutinah-r-sukardi).

## Proposition procédurale, explicitement interprétative

| Recette native | Composition minimale | Variantes bornées proposées |
|---|---|---|
| Maison kampung | Corps résidentiel rectangulaire fermé, toiture à deux pans | Simple ; emper d’un côté ; emper périphérique. Cuisine arrière facultative. |
| Maison limasan | Corps résidentiel rectangulaire fermé, toiture à croupes | Simple ; emper d’un côté ; emper périphérique. Cuisine arrière facultative. |
| Ensemble javanais avec joglo | Pendopo antérieur, transition éventuelle, dalem fermé derrière ; espace de cour conservé | Sans annexe ; un gandok latéral ; gandok et cuisine arrière. Toitures attribuées par corps. |

Ces plafonds de variantes sont des choix de production, pas des maxima ethnographiques. Conserver les maisons modestes dans la sélection résidentielle ; ne pas généraliser l’ensemble de prestige.

Modèle minimal : `plotId`, `residentialUnitId`, `bodyRole`, `roofType`, `variantId`, `footprint`, `sourceRefs`, `evidenceStatus`. Compter séparément ménages, unités résidentielles et corps construits ; un pendopo ou une cuisine n’ajoute pas automatiquement un ménage. La capacité démographique demeure une hypothèse indépendante à justifier.

Les plages métriques, probabilités, retraits, espacements et plafonds d’annexes généralisés restent **réglages artistiques** tant qu’aucun relevé représentatif ne les étaye. Les bâtiments inventoriés sont des témoins historiques tardifs : ils ne prouvent pas directement un habitat du VIIIe–XVe siècle.
