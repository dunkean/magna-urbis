# Importer un bourg d’Azgaar FMG

Magna Urbis peut construire une ville à partir d’un bourg du [Fantasy Map Generator d’Azgaar](https://azgaar.github.io/Fantasy-Map-Generator/) (FMG).
Dans la page V2, ouvrez **Ouvrir un code ou un lien**, collez l’une des entrées ci-dessous et cliquez sur **Charger la recette**.
La ville importée démarre une nouvelle recette : une seule ville, sur une carte dimensionnée selon sa population.

## Entrées acceptées

| Entrée | Comment l’obtenir dans FMG | Ce qu’elle transmet |
|---|---|---|
| **Résultat du script d’export** (recommandé) | Dans Magna Urbis, cliquez sur **Copier le script d’export Azgaar**. Dans FMG, appuyez sur F12, collez le script dans la console et validez avec Entrée, puis saisissez le nom ou l’identifiant du bourg (le bourg ouvert dans l’éditeur de bourg est proposé). Le résultat est copié dans le presse-papiers ; collez-le dans Magna Urbis. | Tout ce qui suit, y compris le biome, les précipitations, la rivière, le côté de la côte, ainsi que la base de noms et le type de la culture. |
| **Ligne CSV de la vue d’ensemble des bourgs** | Vue d’ensemble des bourgs → **Télécharger** (CSV). Copiez la ligne d’en-tête et la ligne du bourg, ou la ligne du bourg seule. | Nom, population, nom de la culture, type, altitude, température, capitale, port, citadelle, remparts, place, temple, bidonville, lien d’aperçu. |
| **Lien watabou** | Éditeur de bourg → ouvrez l’aperçu de la ville, copiez l’URL du générateur de villes ou de villages de watabou. | Nom, population, graine, rivière, côté de la côte, remparts, citadelle, place, temple, bidonville, cultures, carrefour routier. |

Une ligne sans son en-tête est lue selon l’ordre des colonnes de FMG ; la version actuelle de FMG et le site classique (azgaar.github.io) sont reconnus par leur nombre de colonnes.
Le script d’export se contente de lire la page (`pack`, `grid`, et `options` ou les variables globales classiques lorsqu’elles existent). Il n’envoie rien sur le réseau.

## Correspondances

- **Culture** : la base de noms FMG de la culture (German, Arabic, Elven, …) choisit la culture Magna Urbis et la langue des toponymes. Les noms de culture par défaut de FMG sont aussi reconnus.
- **Type de culture** : Naval ajoute un port sur une côte maritime (ou une côte lorsqu’aucune n’est connue) ; River ajoute une rivière lorsqu’aucune n’est connue ; Nomadic et Hunting desserrent la ville ; Highland relève le relief lorsque l’altitude est inconnue. Lake n’a pas encore d’effet.
- **Biome et climat** : le biome FMG donne le biome et la zone climatique Magna Urbis (Hot desert → désert, Cold desert → zone steppe, Savanna → savane, Grassland → steppe ou tempéré selon la pluie, forêts → tempéré, continental ou méditerranéen selon la température, Taiga → nordique, Tundra et Glacier → arctique, Wetland → zone humide). Sans biome, la zone vient de la température et de la pluie. Les villes situées au-dessus de 1 500 m dans une zone tempérée, continentale ou méditerranéenne passent en zone alpine.
- **Température et précipitations** deviennent des valeurs climatiques personnalisées : température ramenée au niveau de la mer avec les 6,5 °C par km de FMG, précipitations en mm par an (valeur de cellule FMG × 100, comme FMG l’affiche).
- **Altitude** : moins de 250 m plat, moins de 1 000 m collines, au-delà montagnes (une vallée pour une ville sur une rivière).
- **Rivière, côte, bâtiments, population** : comme dans la source ; la graine watabou est conservée lorsque FMG en fournit une.
