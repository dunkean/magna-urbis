# Contrat d’édition urbaine

Ce document définit les commandes et leur portée dans la V2. Le panneau principal doit refléter ce contrat, sans demander de connaître les packs, les identifiants de rôles ou les étapes internes du moteur.

## Hiérarchie et commandes principales

**Ville → quartier → îlot → parcelle → bâtiment.** Un quartier contient plusieurs îlots ; un îlot contient plusieurs parcelles ; une parcelle peut contenir plusieurs bâtiments.

| Sélection | Réglages principaux | Ce qui est reconstruit | Ce qui sert de limite |
|---|---|---|---|
| Ville | Culture, population, densité, croissance, trame des rues | Plan urbain, quartiers, rues, îlots, parcelles et bâtiments | Terrain, implantation régionale et connexions extérieures |
| Quartier | Culture, densité, trame des rues intérieures | Rues intérieures, îlots, parcelles et bâtiments du quartier | Contour du quartier et routes qui le délimitent |
| Îlot | Culture, densité, découpage parcellaire, type des bâtiments | Parcelles et bâtiments de cet îlot | Contour de l’îlot et rues périphériques |
| Parcelle | Culture, type de bâtiment, occupation domestique si pertinente | Programme et bâtiments de la parcelle | Terrain disponible, accès et contour de la parcelle |
| Bâtiment | Culture, type de bâtiment, toit et étages si compatibles | Bâtiment sélectionné pour ses réglages architecturaux | Parcelle, accès et constructions voisines |

**Limite actuelle pour le type depuis un bâtiment :** le programme est porté par la parcelle. Changer son type agit donc sur sa parcelle et ses bâtiments. Le panneau doit l’annoncer, plutôt que prétendre modifier isolément un bâtiment lorsque plusieurs occupent le même terrain. Les réglages de toit, d’étages et de variation restent propres au bâtiment sélectionné.

Un quartier n’est pas un bâtiment agrandi : on peut lui donner une fonction dominante en avancé, mais pas proposer « arène » comme s’il s’agissait d’un type de quartier. Un îlot entier peut accueillir un seul ensemble si son découpage est « îlot entier » ; autrement, son type est appliqué à chacune de ses parcelles.

## Trois actions, sans ambiguïté

- **Régénérer** applique les réglages de la sélection avec la graine actuelle. Même version du moteur, mêmes entrées et même graine : même résultat.
- **Le gros dé** choisit une nouvelle graine locale et régénère la sélection et ses descendants avec les réglages choisis. Il ne signifie jamais « seulement les maisons ».
- **Réglages du parent** retire les modifications locales de ce périmètre et de ses descendants, puis régénère avec les valeurs héritées. Il n’y a qu’une commande de ce type par sélection.

Modifier un contrôle prépare une modification ; le panneau affiche **modifications en attente** jusqu’à la régénération. La commande indique la sélection concernée. Une régénération réussie remplace le résultat en une seule fois. Un refus conserve la carte précédente et explique le blocage.

## Propagation systématique vers le bas

Une modification appliquée à un niveau remplace les éditions des niveaux inférieurs dans **cette sélection seulement**. Les sélections voisines et les niveaux supérieurs conservent leurs réglages.

1. Identifier la sélection et ses descendants à partir des liens du moteur, pas des noms affichés.
2. Conserver les réglages explicites du niveau sélectionné.
3. Retirer les surcharges de ses descendants : cultures, types, modèles imposés et graines propres aux anciens objets.
4. Recalculer depuis le premier produit affecté jusqu’aux bâtiments.
5. Réinstaller le résultat et rétablir la sélection si elle existe encore.

**Changer la culture** signifie changer toute l’identité de la sélection : trame culturelle lorsqu’il existe des rues intérieures, découpage culturel et architecture. Les anciens packs, recettes et cultures architecturales imposés à ce niveau sont retirés ; une trame ou un découpage de l’ancienne culture revient au choix culturel. Un type explicitement demandé, par exemple un temple, est réévalué dans la nouvelle culture et doit être compatible.

Le rendu reste indépendant : textures, détail, palette, affichage 2D/3D, saison et éclairage ne sont pas remis à zéro par une édition urbaine.

## Options compatibles et valeurs affichées

Une liste principale n’est **jamais la liste brute des libellés du catalogue**. La présence du mot « arène » dans un fichier ne prouve ni une source disponible pour la culture, ni la place suffisante sur le terrain sélectionné.

Pour proposer un type, vérifier :

- sa déclaration effective dans le catalogue de génération et la culture concernée ;
- la politique historique et le contexte requis, notamment l’accès navigable ;
- la surface disponible, avec une exigence par parcelle si plusieurs sont modifiées ;
- la validation finale du moteur sur le contour réel, l’accès, le relief et les voisins.

Les contrôles principaux proposent les types déclarés pour la culture et compatibles avec la surface connue. La validation géométrique finale appartient au moteur : une entrée compatible sur le papier peut encore être refusée sur une parcelle étroite ou mal desservie. Le refus doit être expliqué et ne doit pas transformer silencieusement la sélection en terrain vide. Une incompatibilité connue ne doit pas être présentée comme une option normale.

Les contrôles affichent la valeur effective ou un choix automatique explicitement nommé. « Selon la culture » est une règle héritée, pas une donnée manquante. Ne pas inventer une valeur unique lorsque les bâtiments d’une zone ont des valeurs différentes. Les listes et libellés suivent la langue de l’interface ; les identifiants internes restent stables dans les données.

## Répartition de l’interface

Le panneau principal contient uniquement les réglages du tableau, le gros dé, Régénérer, le retour au parent et l’état des modifications. La trame se choisit par icônes, sans liste déroulante identique à côté.

**Avancé** contient les fonctions de quartier, paramètres fins de croissance, graines manuelles, modèles architecturaux, recettes, matériaux, politique historique et diagnostics. Un pack est une bibliothèque de modèles ; une recette est un modèle particulier ; ils ne constituent pas une deuxième culture. Le chargement technique du catalogue n’est pas une action principale.

Aucun tableau de sommets, coordonnées ou outil de modification de contour n’est exposé à ce stade.

Le contour de sélection 2D disparaît à la désactivation de « sélectionner sur la carte » et au passage en 3D. Les contrôles de saison et de lumière restent accessibles en 3D lorsqu’ils pilotent le rendu.

## Partage et vérification

Le code de partage conserve les réglages de chaque périmètre, les types choisis, les graines locales et les choix de rendu et de scène. Il transporte une recette, pas les géométries calculées. La reproduction s’entend avec la même version du moteur.

La validation couvre l’aller-retour du code, l’isolation d’une édition d’îlot, la propagation de culture, la régénération déterministe des rues intérieures, le changement de type compatible, le refus d’un type impossible sans terrain vide et la conservation du rendu complexe texturé.

Le profil elfique privilégie les habitations arboricoles : part cible de 85 %, contre 15 % de maisons ordinaires, avec un tirage reproductible par parcelle.
